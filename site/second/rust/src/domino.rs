//! Rung 3, the Domino search (`src/domino.js`): a helpmate search of 3 plies and 10 nodes, by
//! default with no move-count rules, that asks at its nodes the static tests the move just made can
//! have changed (lock::tests_after), while no en passant square is set. From the board it needs the
//! legal moves one piece at a time in a fixed order, moves made and taken back in place, "is there
//! a legal move?", and the exact code of a position. Under the rules (`run_rules`, the second
//! version) a line also ends, drawn, where the move rule or the repetition set ends the game.

use crate::board::{BLACK, compute_context, Ctx, FLAG_CASTLE, FLAG_EP, FLAG_PROMO, flags_of,
    has_legal_move, hash_key, Key, legal_targets, lsb, make, NO_SQUARE, PAWN, Position,
    PROMOTION_ORDER, rights_from_skeleton, STANDARD_SKELETON, stuck_pawns, unmake, WHITE, write_key};
use crate::lock::{flagged_bit, FLAGGED_BLACK, FLAGGED_WHITE, pawn_check, static_tests,
    static_tests2, tests_after, TESTS_BOTH};

/// The Domino search's defaults: ply ceiling and node budget.
pub const DOMINO_PLY: u32 = 3;
pub const DOMINO_BUDGET: i64 = 10;
/// The second tier (the second version, see ladder.rs): 9 plies, 5,000 nodes.
pub const DOMINO_DEEP_PLY: u32 = 9;
pub const DOMINO_DEEP_BUDGET: i64 = 5_000;
/// The search under a move rule (the second version, see ladder.rs): at least 200,000 nodes.
pub const DOMINO_RULE_BUDGET: i64 = 200_000;


/// A set of positions: open addressing, linear probing, cleared in constant time by a generation
/// number. A slot holds its generation and the full code side by side (one cache line), and the
/// first table has 256 slots (12 KB, in the first-level cache): a Domino search meets at most a
/// hundred and one positions. The table doubles when it is 70% full. Under a move rule a slot also
/// keeps the halfmove clock its position was met with (add_clock). (PositionSet)
#[derive(Clone, Copy, Default)]
struct Slot { gen: u32, clock: u16, sides: u8, key: Key }

pub struct PositionSet { slots: Vec<Slot>, shift: u32, mask: usize, generation: u32, count: usize, limit: usize }

impl Default for PositionSet { fn default() -> Self { Self::new() } }

impl PositionSet {
    pub fn new() -> PositionSet {
        let bits = 8;
        PositionSet { slots: vec![Slot::default(); 1 << bits], shift: 64 - bits, mask: (1 << bits) - 1, generation: 0, count: 0,
                      limit: (1 << bits) * 7 / 10 }
    }
    pub fn clear(&mut self) {
        if self.generation == u32::MAX { self.slots.iter_mut().for_each(|x| x.gen = 0); self.generation = 0; }
        self.generation += 1;
        self.count = 0;
    }
    /// The positions in the set.
    pub fn count(&self) -> usize { self.count }
    /// Is the position in the set?
    #[inline(always)]
    pub fn has(&self, k: &Key) -> bool {
        let gen = self.generation;
        let mut slot = (hash_key(k) >> self.shift) as usize;
        loop {
            let x = &self.slots[slot];
            if x.gen != gen { return false; }
            if x.key == *k { return true; }
            slot = (slot + 1) & self.mask;
        }
    }
    /// Adds the position met with halfmove clock `clock` (a search under a move rule): false when it
    /// was met before with a clock no lower; met before with a higher one, it counts as new and
    /// keeps the lower clock (its lines now run longer before the rule ends them).
    #[inline(always)]
    pub fn add_clock(&mut self, k: Key, clock: u16) -> bool {
        let gen = self.generation;
        let mut slot = (hash_key(&k) >> self.shift) as usize;
        loop {
            let x = &mut self.slots[slot];
            if x.gen != gen { x.gen = gen; x.key = k; x.clock = clock; break; }
            if x.key == k { if x.clock <= clock { return false; } x.clock = clock; return true; }
            slot = (slot + 1) & self.mask;
        }
        self.count += 1;
        if self.count > self.limit { self.grow(); }
        true
    }
    /// Adds the position; false when it was there already.
    #[inline(always)]
    pub fn add(&mut self, k: Key) -> bool {
        let gen = self.generation;
        let mut slot = (hash_key(&k) >> self.shift) as usize;
        loop {
            let x = &mut self.slots[slot];
            if x.gen != gen { x.gen = gen; x.key = k; break; }
            if x.key == k { return false; }
            slot = (slot + 1) & self.mask;
        }
        self.count += 1;
        if self.count > self.limit { self.grow(); }
        true
    }
    /// Adds the position for the sides in `live` (FLAGGED_* bits) and returns those of them that
    /// had not met it yet: one probe serves both searches of Domino::run2, and for each side the
    /// answer is the one its own set would give.
    #[inline(always)]
    fn add2(&mut self, k: Key, live: u8) -> u8 {
        let gen = self.generation;
        let mut slot = (hash_key(&k) >> self.shift) as usize;
        loop {
            let x = &mut self.slots[slot];
            if x.gen != gen { x.gen = gen; x.sides = live; x.key = k; break; }
            if x.key == k { let new = live & !x.sides; x.sides |= new; return new; }
            slot = (slot + 1) & self.mask;
        }
        self.count += 1;
        if self.count > self.limit { self.grow(); }
        live
    }
    fn grow(&mut self) {
        let bits = 64 - self.shift + 1;
        let (old, gen) = (std::mem::take(&mut self.slots), self.generation);
        self.slots = vec![Slot::default(); 1 << bits];
        self.shift = 64 - bits; self.mask = (1 << bits) - 1; self.limit = (1usize << bits) * 7 / 10;
        for x in old.iter().filter(|x| x.gen == gen) {
            let mut slot = (hash_key(&x.key) >> self.shift) as usize;
            while self.slots[slot].gen == gen { slot = (slot + 1) & self.mask; }
            self.slots[slot] = *x;
        }
    }
}


#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Failure { None, Mate, Horizon, Budget }

/// A search's answer; `ruled`: a rule ended a line (run_rules; the clock search: its proof).
#[derive(Clone, Copy, Debug)]
pub struct SearchResult { pub proven: bool, pub failure: Failure, pub budget_left: i64, pub ruled: bool }

/// A short helpmate search, by default without move-count rules (Domino, src/domino.js).
pub struct Domino {
    pos: Position, seen: PositionSet, flagged: u8, budget: i64, failure: Failure,
    /// For run2: each side's budget and failure (index 0: White flagged, 1: Black flagged), and the
    /// sides whose search has failed.
    budgets: [i64; 2], failures: [Failure; 2], dead: u8,
    /// Under the rules (run_rules): the move rule (0: none), whether the repetition set ends lines,
    /// and whether a rule has ended one.
    move_rule: u32, use_repeat: bool, ruled: bool,
    /// The repetition set of the searches under the rules: the positions the game has had N - 1
    /// times (ladder::repetition_set fills it).
    pub(crate) repeat: PositionSet,
    /// The clock search (clock.rs), made the first time the ladder needs it.
    pub(crate) clock: Option<Box<crate::clock::ClockSearch>>,
}

impl Default for Domino { fn default() -> Self { Self::new() } }

impl Domino {
    pub fn new() -> Domino {
        Domino { pos: Position::empty(rights_from_skeleton(&STANDARD_SKELETON)), seen: PositionSet::new(), flagged: WHITE, budget: 0,
                 failure: Failure::None, budgets: [0; 2], failures: [Failure::None; 2], dead: 0,
                 move_rule: 0, use_repeat: false, ruled: false, repeat: PositionSet::new(), clock: None }
    }

    /// Runs the search from `root`; root_static: false when the caller has already asked the
    /// static tests at the root.
    pub fn run(&mut self, root: &Position, flagged: u8, max_ply: u32, budget: i64, root_static: bool) -> SearchResult {
        self.run_rules(root, flagged, max_ply, budget, root_static, 0, false)
    }

    /// run under the rules (Domino.run's moveRule and repeat): `move_rule` 0 (none), 150 or 100 ends
    /// a line, drawn, at a position whose halfmove clock has reached it and that has a legal move;
    /// with `use_repeat` the positions of the repetition set (`repeat`, filled by
    /// ladder::repetition_set) end a line, drawn. The memory then keeps each position with the
    /// clock it was first met with.
    #[allow(clippy::too_many_arguments)]
    pub fn run_rules(&mut self, root: &Position, flagged: u8, max_ply: u32, budget: i64, root_static: bool,
                     move_rule: u32, use_repeat: bool) -> SearchResult {
        self.pos.copy_from(root);
        self.seen.clear();
        self.flagged = flagged;
        self.budget = budget;
        self.failure = Failure::None;
        self.move_rule = move_rule;
        self.use_repeat = use_repeat && self.repeat.count() > 0;
        self.ruled = false;
        let proven = self.node(0, max_ply, if root_static { TESTS_BOTH } else { 0 });
        debug_assert!(proven || self.failure != Failure::None);
        let r = SearchResult { proven, failure: if proven { Failure::None } else { self.failure }, budget_left: self.budget.max(0), ruled: self.ruled };
        self.move_rule = 0; self.use_repeat = false;
        r
    }

    /// `tests`: the static tests whose answer can have changed since the parent (tests_after).
    fn node(&mut self, ply: u32, depth: u32, tests: u8) -> bool {
        let k = write_key(&self.pos);
        if self.use_repeat && self.repeat.has(&k) { self.ruled = true; return true; }   // the repetition rule ends the game: drawn
        let rule = self.move_rule;
        let fresh = if rule > 0 { self.seen.add_clock(k, self.pos.halfmove.min(0xfffe) as u16) } else { self.seen.add(k) };
        if !fresh { return true; }                                      // met before: covered there
        if tests != 0 && static_tests(&self.pos, self.flagged, tests) { return true; }
        let rule_ends = rule > 0 && self.pos.halfmove >= rule;
        if depth == 0 || rule_ends {                                    // only "is there a legal move?" matters
            let mut ctx = Ctx::default();
            if !has_legal_move(&self.pos, &mut ctx) { return self.no_legal_move(&ctx); }
            if rule_ends { self.ruled = true; return true; }            // the move rule ends the game: drawn
            self.failure = Failure::Horizon;
            return false;
        }
        let ctx = compute_context(&self.pos);
        let checked = ctx.checks > 0 && pawn_check(&self.pos);
        let mut own = self.pos.bb[self.pos.side as usize] & !stuck_pawns(&self.pos);
        let mut any = false;
        while own != 0 {
            let from = lsb(own); own &= own - 1;
            let mut tg = legal_targets(&self.pos, from, &ctx);
            if tg == 0 { continue; }
            any = true;
            let ty = self.pos.board[from] & 7;
            while tg != 0 {
                let to = lsb(tg); tg &= tg - 1;
                let flags = flags_of(&self.pos, ty, from, to);
                let mv = from as u32 | (to as u32) << 6 | flags << 12;
                let choices = if flags & FLAG_PROMO != 0 { 4 } else { 1 };
                let tests = self.tests_after(checked, ty, to, flags);
                let mut k = 0;
                loop {
                    let b = self.budget;
                    self.budget = b - 1;
                    if b <= 0 { self.failure = Failure::Budget; return false; }
                    let u = make(&mut self.pos, mv, PROMOTION_ORDER[k & 3]);
                    let ok = self.node(ply + 1, depth - 1, if self.pos.ep == NO_SQUARE { tests } else { 0 });
                    unmake(&mut self.pos, &u);
                    if !ok { return false; }
                    k += 1;
                    if k == choices { break; }
                }
            }
        }
        any || self.no_legal_move(&ctx)
    }

    /// The static tests the move from the current position, of a piece of type `ty` to `to` with
    /// `flags`, can change (lock::tests_after; `checked`: the side to move is in a pawn's check);
    /// asked after it only while no en passant square stands.
    #[inline(always)]
    fn tests_after(&self, checked: bool, ty: u8, to: usize, flags: u32) -> u8 {
        let capture = (self.pos.board[to] != 0 && flags & FLAG_CASTLE == 0) || flags & FLAG_EP != 0;
        tests_after(capture, flags & FLAG_PROMO != 0, ty == PAWN, self.pos.ep != NO_SQUARE, checked)
    }

    /// A node without legal moves ends its line; it fails only if the flagged king is mated.
    fn no_legal_move(&mut self, ctx: &Ctx) -> bool {
        if self.pos.side == self.flagged && ctx.checks > 0 { self.failure = Failure::Mate; return false; }
        true
    }

    /// Both searches at once: for each side in `ask` (FLAGGED_* bits), the same verdict, failure
    /// and budget left as `run` with that side flagged; index 0 answers for White flagged, 1 for
    /// Black (a side not asked: not proven, its budget untouched).
    ///
    /// The two searches generate the same moves in the same order; they differ only where the
    /// static tests prove one side and not the other, where a mate fails one of them, and once one
    /// of them has failed. So one walk serves both: each node carries the sides still searching it,
    /// a move is made once for both, each side pays its own budget for it and keeps its own record
    /// of the positions it has met (one probe, two bits), and a side that fails stops paying and
    /// searching, as its own search would stop.
    pub fn run2(&mut self, root: &Position, ask: u8, max_ply: u32, budget: i64, root_static: bool) -> [SearchResult; 2] {
        let ask = ask & (FLAGGED_WHITE | FLAGGED_BLACK);
        if ask == FLAGGED_WHITE || ask == FLAGGED_BLACK {
            // One side: its own search, without the bookkeeping for two.
            let mut out = [SearchResult { proven: false, failure: Failure::None, budget_left: budget, ruled: false }; 2];
            out[(ask >> 1) as usize] = self.run(root, if ask == FLAGGED_WHITE { WHITE } else { BLACK }, max_ply, budget, root_static);
            return out;
        }
        self.pos.copy_from(root);
        self.seen.clear();
        self.budgets = [budget; 2];
        self.failures = [Failure::None; 2];
        self.dead = 0;
        if ask != 0 { self.node2(0, max_ply, ask, if root_static { TESTS_BOTH } else { 0 }); }
        let result = |i: usize| {
            let proven = ask & (1 << i) != 0 && self.dead & (1 << i) == 0;
            SearchResult { proven, failure: if proven { Failure::None } else { self.failures[i] }, budget_left: self.budgets[i].max(0), ruled: false }
        };
        [result(0), result(1)]
    }

    fn node2(&mut self, ply: u32, depth: u32, live: u8, tests: u8) {
        let mut live = self.seen.add2(write_key(&self.pos), live);   // a side that met it before: covered there
        if live == 0 { return; }
        if tests != 0 { live &= !static_tests2(&self.pos, live, tests); if live == 0 { return; } }
        if depth == 0 {
            let mut ctx = Ctx::default();
            if !has_legal_move(&self.pos, &mut ctx) { self.no_legal_move2(&ctx, live); } else { self.fail(live, Failure::Horizon); }
            return;
        }
        let ctx = compute_context(&self.pos);
        let checked = ctx.checks > 0 && pawn_check(&self.pos);
        let mut own = self.pos.bb[self.pos.side as usize] & !stuck_pawns(&self.pos);
        let mut any = false;
        while own != 0 {
            let from = lsb(own); own &= own - 1;
            let mut tg = legal_targets(&self.pos, from, &ctx);
            if tg == 0 { continue; }
            any = true;
            let ty = self.pos.board[from] & 7;
            while tg != 0 {
                let to = lsb(tg); tg &= tg - 1;
                let flags = flags_of(&self.pos, ty, from, to);
                let mv = from as u32 | (to as u32) << 6 | flags << 12;
                let choices = if flags & FLAG_PROMO != 0 { 4 } else { 1 };
                let tests = self.tests_after(checked, ty, to, flags);
                let mut k = 0;
                loop {
                    let mut spent = 0;
                    if live & FLAGGED_WHITE != 0 { let b = self.budgets[0]; self.budgets[0] = b - 1; if b <= 0 { spent |= FLAGGED_WHITE; } }
                    if live & FLAGGED_BLACK != 0 { let b = self.budgets[1]; self.budgets[1] = b - 1; if b <= 0 { spent |= FLAGGED_BLACK; } }
                    if spent != 0 { self.fail(spent, Failure::Budget); live &= !spent; if live == 0 { return; } }
                    let u = make(&mut self.pos, mv, PROMOTION_ORDER[k & 3]);
                    let t = if self.pos.ep == NO_SQUARE { tests } else { 0 };
                    self.node2(ply + 1, depth - 1, live, t);
                    unmake(&mut self.pos, &u);
                    live &= !self.dead;                    // a side that failed in there searches no more
                    if live == 0 { return; }
                    k += 1;
                    if k == choices { break; }
                }
            }
        }
        if !any { self.no_legal_move2(&ctx, live); }
    }

    /// run2's no_legal_move: a mate fails the search in which the mated side is flagged.
    fn no_legal_move2(&mut self, ctx: &Ctx, live: u8) {
        let mated = flagged_bit(self.pos.side);
        if ctx.checks > 0 && live & mated != 0 { self.fail(mated, Failure::Mate); }
    }

    /// The searches of the sides in `mask` fail, for `why`.
    fn fail(&mut self, mask: u8, why: Failure) {
        let m = mask & !self.dead;
        if m & FLAGGED_WHITE != 0 { self.failures[0] = why; }
        if m & FLAGGED_BLACK != 0 { self.failures[1] = why; }
        self.dead |= m;
    }
}
