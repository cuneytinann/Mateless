//! The ladder (`src/ladder.js`): the rungs put together, for one position
//! (`prove_cannot_be_mated`, `prove_both`, `is_dead_position`) and for a game played move by move
//! (`Flags`). The fourth rung is the Domino search's second tier (the second version); the fifth,
//! on request, the searches under the rules a game ends at by itself (`Rules`: the 75- or
//! 50-move rule, fivefold or threefold repetition with the game's history), the clock search
//! (clock.rs) near the move rule.

use crate::board::{BISHOP, BLACK, Key, KING, KNIGHT, lsb, NO_SQUARE, north, PAWN, Position, QUEEN, ROOK, sideways, south, tables, WHITE, zone};
use crate::lock::{cannot_mate, cannot_mate2, FLAGGED_BLACK, FLAGGED_WHITE, pawn_check,
    static_tests2, TEST_LOCK, TESTS_BOTH};
use crate::domino::{Domino, DOMINO_BUDGET, DOMINO_DEEP_BUDGET, DOMINO_DEEP_PLY, DOMINO_PLY, DOMINO_RULE_BUDGET, Failure, SearchResult};
use crate::clock::{ClockSearch, REGION_REACH};

/// A proof or its failure; `deep`: the second tier ran; `ruled`: the searches under the rules ran,
/// and the answer is theirs.
#[derive(Clone, Copy, Debug)]
pub struct Proof { pub proven: bool, pub static_proof: bool, pub failure: Failure, pub nodes: i64, pub deep: bool, pub ruled: bool }

/// The rules a game ends at by itself (the second version; src/ladder.js): `move_rule` 0 (none), 150
/// (the 75-move rule) or 100 (the 50-move rule); `repetition` 0 (none), 5 or 3; `history` the codes
/// of the game's positions before the root since its last capture or pawn move
/// (board::position_key), for the repetition rule. The proofs hold for a game that ends at them.
#[derive(Clone, Copy)]
pub struct Rules<'a> { pub move_rule: u32, pub repetition: u32, pub history: &'a [Key] }

impl Rules<'_> {
    /// No rule: the answers of the functions without rules.
    pub const NONE: Rules<'static> = Rules { move_rule: 0, repetition: 0, history: &[] };
    fn any(&self) -> bool { self.move_rule > 0 || self.repetition > 0 }
}

/// Fills the search's repetition set with the positions of `history` that occur there at least
/// repetition - 1 times; false when there are none (or no rule). A position comes back at the
/// earliest 4 plies later, so with fewer than 4 (repetition - 2) + 1 positions none can. (repetitionSet)
fn repetition_set(search: &mut Domino, repetition: u32, history: &[Key]) -> bool {
    if repetition < 3 { return false; }
    let (n, need) = (history.len(), repetition as usize - 1);
    if n < 4 * (repetition as usize - 2) + 1 { return false; }
    search.repeat.clear();
    for k in history {
        if history.iter().filter(|h| *h == k).take(need).count() >= need { search.repeat.add(*k); }
    }
    search.repeat.count() > 0
}

/// The ladder without the rules at an exit of the clock search: the static tests, the first tier,
/// the second where it is allowed. Returns (proven, nodes). (exitProof)
fn exit_proof(search: &mut Domino, pos: &Position, flagged: u8, max_ply: u32, budget: i64, deep_ply: u32, deep_budget: i64) -> (bool, i64) {
    if cannot_mate(pos, flagged) { return (true, 0); }
    let r = search.run(pos, flagged, max_ply, budget, false);
    let mut nodes = budget - r.budget_left;
    if !r.proven && deep_budget > 0 && deep_allowed(pos, r.failure) {
        let d = search.run(pos, flagged, deep_ply, deep_budget, false);
        nodes += deep_budget - d.budget_left;
        return (d.proven, nodes);
    }
    (r.proven, nodes)
}

/// The searches again under the rules, once, for a side the searches without them left unproven
/// (`failure`: why the first tier failed; `repeat`: the repetition set is filled). Where the move
/// rule can end a line within REGION_REACH plies or the ply ceiling, the clock search; with only a
/// repetition set, the Domino search with it. Returns (result, nodes), or None. (ruleSearch)
#[allow(clippy::too_many_arguments)]
fn rule_search(search: &mut Domino, pos: &Position, flagged: u8, move_rule: u32, repeat: bool, failure: Failure,
               max_ply: u32, budget: i64, deep_ply: u32, deep_budget: i64) -> Option<(SearchResult, i64)> {
    let ply = if deep_budget > 0 { max_ply.max(deep_ply) } else { max_ply };
    let near = move_rule > 0 && pos.halfmove + ply.max(REGION_REACH) >= move_rule;
    if !near && !repeat { return None; }
    if near {
        let nodes = budget.max(deep_budget).max(DOMINO_RULE_BUDGET);
        let mut clock = search.clock.take().unwrap_or_else(|| Box::new(ClockSearch::new()));
        let set = if repeat { Some(std::mem::take(&mut search.repeat)) } else { None };
        let r = clock.run(pos, flagged, move_rule, nodes, set.as_ref(),
                          &mut |p: &Position, f: u8| exit_proof(search, p, f, max_ply, budget, deep_ply, deep_budget));
        if let Some(x) = set { search.repeat = x; }
        search.clock = Some(clock);
        return Some((r, nodes - r.budget_left));
    }
    let nodes = budget.max(if deep_budget > 0 && deep_allowed(pos, failure) { deep_budget } else { 0 });
    let r = search.run_rules(pos, flagged, ply, nodes, false, 0, true);
    Some((r, nodes - r.budget_left))
}

/// Has some king no square to step to, counting as closed its own pawns and bishops, the squares the
/// enemy pawns attack and those next to the enemy king? (kingShutIn; asked only with no knight, rook
/// or queen on the board.)
#[inline]
fn king_shut_in(pos: &Position) -> bool {
    let b = &pos.bb;
    let (wp, bp, wk, bk) = (b[(WHITE | PAWN) as usize], b[(BLACK | PAWN) as usize], b[(WHITE | KING) as usize], b[(BLACK | KING) as usize]);
    let t = tables();
    t.king[lsb(wk)] & !(wp | b[(WHITE | BISHOP) as usize] | sideways(south(bp)) | zone(bk)) == 0
        || t.king[lsb(bk)] & !(bp | b[(BLACK | BISHOP) as usize] | sideways(north(wp)) | zone(wk)) == 0
}

/// No knight, rook or queen on the board?
#[inline(always)]
fn no_knight_rook_queen(pos: &Position) -> bool {
    let b = &pos.bb;
    b[(WHITE | KNIGHT) as usize] | b[(BLACK | KNIGHT) as usize] | b[(WHITE | ROOK) as usize] | b[(BLACK | ROOK) as usize]
        | b[(WHITE | QUEEN) as usize] | b[(BLACK | QUEEN) as usize] == 0
}

/// Does the second tier run after a first search that failed for `failure` in `pos`? After a
/// failure on the budget; after one on the horizon only with no knight, rook or queen on the board
/// and a king shut in. (deepAllowed: why, in src/ladder.js.)
#[inline]
fn deep_allowed(pos: &Position, failure: Failure) -> bool {
    match failure {
        Failure::Budget => true,
        Failure::Horizon => no_knight_rook_queen(pos) && king_shut_in(pos),
        _ => false,
    }
}

/// Can `flagged` never be mated? The static tests at the root, then the Domino search and, where
/// it allows, its second tier at the default size. (proveCannotBeMated)
pub fn prove_cannot_be_mated(search: &mut Domino, pos: &Position, flagged: u8, max_ply: u32, budget: i64) -> Proof {
    prove_cannot_be_mated_deep(search, pos, flagged, max_ply, budget, DOMINO_DEEP_PLY, DOMINO_DEEP_BUDGET)
}

/// prove_cannot_be_mated with the second tier's size given (deep_budget 0: no second tier).
pub fn prove_cannot_be_mated_deep(search: &mut Domino, pos: &Position, flagged: u8, max_ply: u32, budget: i64,
                                  deep_ply: u32, deep_budget: i64) -> Proof {
    prove_cannot_be_mated_rules(search, pos, flagged, max_ply, budget, deep_ply, deep_budget, &Rules::NONE)
}

/// prove_cannot_be_mated_deep under the rules: a side the searches without them leave unproven is
/// searched again under them, where a rule can end a line (rule_search).
#[allow(clippy::too_many_arguments)]
pub fn prove_cannot_be_mated_rules(search: &mut Domino, pos: &Position, flagged: u8, max_ply: u32, budget: i64,
                                   deep_ply: u32, deep_budget: i64, rules: &Rules) -> Proof {
    if cannot_mate(pos, flagged) { return Proof { proven: true, static_proof: true, failure: Failure::None, nodes: 0, deep: false, ruled: false }; }
    let mut r = search.run(pos, flagged, max_ply, budget, false);
    let mut nodes = budget - r.budget_left;
    let first = r.failure;
    let mut deep = false;
    if !r.proven && deep_budget > 0 && deep_allowed(pos, r.failure) {
        r = search.run(pos, flagged, deep_ply, deep_budget, false);
        nodes += deep_budget - r.budget_left;
        deep = true;
    }
    let mut ruled = false;
    if !r.proven && rules.any() {
        let repeat = repetition_set(search, rules.repetition, rules.history);
        if let Some((u, n)) = rule_search(search, pos, flagged, rules.move_rule, repeat, first, max_ply, budget, deep_ply, deep_budget) {
            r = u; nodes += n; ruled = true;
        }
    }
    Proof { proven: r.proven, static_proof: false, failure: r.failure, nodes, deep, ruled }
}

/// prove_cannot_be_mated for both sides at once (a dead position needs both): one pass of the
/// static tests, then one walk of the search for the sides they leave open, and one of the second
/// tier for the sides it is allowed for. Index 0: White flagged, 1: Black flagged; each the same
/// proof as prove_cannot_be_mated gives.
pub fn prove_both(search: &mut Domino, pos: &Position, max_ply: u32, budget: i64) -> [Proof; 2] {
    prove_both_deep(search, pos, max_ply, budget, DOMINO_DEEP_PLY, DOMINO_DEEP_BUDGET)
}

/// prove_both with the second tier's size given (deep_budget 0: no second tier).
pub fn prove_both_deep(search: &mut Domino, pos: &Position, max_ply: u32, budget: i64, deep_ply: u32, deep_budget: i64) -> [Proof; 2] {
    prove_both_rules(search, pos, max_ply, budget, deep_ply, deep_budget, &Rules::NONE)
}

/// prove_both_deep under the rules: then, for each side still open, the searches under them.
pub fn prove_both_rules(search: &mut Domino, pos: &Position, max_ply: u32, budget: i64, deep_ply: u32, deep_budget: i64,
                        rules: &Rules) -> [Proof; 2] {
    let both = FLAGGED_WHITE | FLAGGED_BLACK;
    let st = cannot_mate2(pos, both);
    let none = [SearchResult { proven: false, failure: Failure::None, budget_left: budget, ruled: false }; 2];
    let r = if st != both { search.run2(pos, both & !st, max_ply, budget, false) } else { none };
    let mut deep_ask = 0u8;
    if st != both && deep_budget > 0 {
        for i in 0..2 { if st & (1 << i) == 0 && !r[i].proven && deep_allowed(pos, r[i].failure) { deep_ask |= 1 << i; } }
    }
    let d = if deep_ask != 0 { search.run2(pos, deep_ask, deep_ply, deep_budget, false) } else { none };
    let mut proof = |i: usize| {
        if st & (1 << i) != 0 { return Proof { proven: true, static_proof: true, failure: Failure::None, nodes: 0, deep: false, ruled: false }; }
        let first = budget - r[i].budget_left;
        let mut p = if deep_ask & (1 << i) != 0 {
            Proof { proven: d[i].proven, static_proof: false, failure: d[i].failure, nodes: first + deep_budget - d[i].budget_left, deep: true, ruled: false }
        } else {
            Proof { proven: r[i].proven, static_proof: false, failure: r[i].failure, nodes: first, deep: false, ruled: false }
        };
        if !p.proven && rules.any() {
            let repeat = repetition_set(search, rules.repetition, rules.history);
            if let Some((u, n)) = rule_search(search, pos, if i == 1 { BLACK } else { WHITE }, rules.move_rule, repeat, r[i].failure,
                                              max_ply, budget, deep_ply, deep_budget) {
                p.proven = u.proven; p.failure = u.failure; p.nodes += n; p.ruled = true;
            }
        }
        p
    };
    let w = proof(0);
    [w, proof(1)]
}

/// One side's searches for is_dead_position: the first tier, then the second where it allows,
/// then, with rules, the searches under them.
fn search_proves(search: &mut Domino, pos: &Position, flagged: u8, rules: &Rules) -> bool {
    let r = search.run(pos, flagged, DOMINO_PLY, DOMINO_BUDGET, false);
    if r.proven { return true; }
    if deep_allowed(pos, r.failure) && search.run(pos, flagged, DOMINO_DEEP_PLY, DOMINO_DEEP_BUDGET, false).proven { return true; }
    if !rules.any() { return false; }
    let repeat = repetition_set(search, rules.repetition, rules.history);
    rule_search(search, pos, flagged, rules.move_rule, repeat, r.failure, DOMINO_PLY, DOMINO_BUDGET, DOMINO_DEEP_PLY, DOMINO_DEEP_BUDGET)
        .is_some_and(|(u, _)| u.proven)
}

/// Is the position dead (FIDE 5.2.2)? The static tests for both sides in one pass, then the
/// searches one side at a time, Black flagged first. (isDeadPosition)
pub fn is_dead_position(search: &mut Domino, pos: &Position) -> bool { is_dead_position_rules(search, pos, &Rules::NONE) }

/// is_dead_position under the rules.
pub fn is_dead_position_rules(search: &mut Domino, pos: &Position, rules: &Rules) -> bool {
    let open = (FLAGGED_WHITE | FLAGGED_BLACK) & !cannot_mate2(pos, FLAGGED_WHITE | FLAGGED_BLACK);
    if open & FLAGGED_BLACK != 0 && !search_proves(search, pos, BLACK, rules) { return false; }
    open & FLAGGED_WHITE == 0 || search_proves(search, pos, WHITE, rules)
}


/// The second tier in a game (Flags::update): of the sides in `open`, whose first searches failed
/// for `fw` (White flagged) and `fb`, those it is allowed for and proves, both in one walk. Out of
/// line: it runs at a few plies of a game, and the first tier's search stays the only one inlined
/// into Flags::update.
#[inline(never)]
fn second_tier(search: &mut Domino, pos: &Position, open: u8, fw: Failure, fb: Failure) -> u8 {
    let mut deep = 0;
    if open & FLAGGED_WHITE != 0 && deep_allowed(pos, fw) { deep |= FLAGGED_WHITE; }
    if open & FLAGGED_BLACK != 0 && deep_allowed(pos, fb) { deep |= FLAGGED_BLACK; }
    if deep == 0 { return 0; }
    let d = search.run2(pos, deep, DOMINO_DEEP_PLY, DOMINO_DEEP_BUDGET, false);
    (if d[0].proven { FLAGGED_WHITE } else { 0 }) | (if d[1].proven { FLAGGED_BLACK } else { 0 })
}

/// The two flags of a game played move by move (Flags in src/ladder.js): a side
/// whose flag is down has been proven unable to mate for the rest of the game. The static tests
/// are asked after a capture or a pawn move (halfmove 0), the lock detector also after a move made
/// while an en passant square stood or out of a pawn's check; the Domino search after every move,
/// and its second tier where the search failed on its budget, or on its horizon with no knight,
/// rook or queen on the board and a king shut in.
pub struct Flags {
    pub white_down_at: i64,
    pub black_down_at: i64,
    /// The ply whose position the flags were last brought up to date for (-1 before the first).
    updated_ply: i64,
    /// Of the position of game ply memory_ply (the last update's): did an en passant square stand,
    /// was the side to move in a pawn's check? Used by the update for the next ply only.
    memory_ply: i64,
    updated_ep: bool,
    updated_check: bool,
    /// The rules the game ends at (0: none): the move rule (150, 100) and the repetition rule (5, 3).
    move_rule: u32,
    repetition: u32,
    search: Domino,
}

impl Default for Flags { fn default() -> Self { Self::new() } }

impl Flags {
    pub fn new() -> Flags { Flags::with_rules(0, 0) }
    /// The flags of a game that ends at these rules (move_rule 0, 150 or 100; repetition 0, 5 or 3).
    pub fn with_rules(move_rule: u32, repetition: u32) -> Flags {
        Flags { white_down_at: -1, black_down_at: -1, updated_ply: -1, memory_ply: -1, updated_ep: false, updated_check: false,
                move_rule, repetition, search: Domino::new() }
    }
    pub fn never_mates(&self, color: u8) -> bool { if color == WHITE { self.white_down_at >= 0 } else { self.black_down_at >= 0 } }
    /// Climbs the ladder for each side whose flag is still up, at the position of game ply `ply`:
    /// both sides in one pass (cannot_mate2, then Domino::run2, then the second tier's run2), with
    /// the same answers as climbing it for each side alone.
    pub fn update(&mut self, pos: &Position, ply: i64) { self.update_with_history(pos, ply, &[]); }
    /// update with the game's history (its positions before this one since its last capture or pawn
    /// move), for a repetition rule.
    pub fn update_with_history(&mut self, pos: &Position, ply: i64, history: &[Key]) {
        if self.updated_ply == ply { return; }
        let first = self.updated_ply < 0;
        // The memory of the ply before: only if the last update was for it (not after a rewind).
        let next = ply == self.updated_ply + 1 && self.memory_ply == self.updated_ply;
        let (ep_before, check_before) = (self.updated_ep, self.updated_check);
        self.updated_ply = ply;
        self.memory_ply = ply;
        self.updated_ep = pos.ep != NO_SQUARE;
        // Only a pawn's check matters (lock::tests_after), and it comes only from a pawn move.
        self.updated_check = pos.halfmove == 0 && pos.ep == NO_SQUARE && pawn_check(pos);
        // The static tests whose answer can have changed since the ply before (lock::tests_after;
        // the halfmove clock is 0 after a capture or a pawn move, a promotion included). The first
        // update asks both; after plies left out or a rewind, the position alone decides, by the
        // clock rule (halfmove <= 1).
        let tests = if first { TESTS_BOTH }
            else if pos.ep != NO_SQUARE { 0 }
            else if !next { if pos.halfmove <= 1 { TESTS_BOTH } else { 0 } }
            else { (if pos.halfmove == 0 { TESTS_BOTH } else { 0 }) | (if ep_before || check_before { TEST_LOCK } else { 0 }) };
        // The flagged side of a search is the one the other side would mate: White's flag (may
        // White still mate?) is the search with Black flagged.
        let mut open = 0;
        if !self.never_mates(WHITE) { open |= FLAGGED_BLACK; }
        if !self.never_mates(BLACK) { open |= FLAGGED_WHITE; }
        if open == 0 { return; }
        let mut proven = if tests != 0 { static_tests2(pos, open, tests) } else { 0 };
        if open & !proven != 0 {
            let r = self.search.run2(pos, open & !proven, DOMINO_PLY, DOMINO_BUDGET, false);
            if r[0].proven { proven |= FLAGGED_WHITE; }
            if r[1].proven { proven |= FLAGGED_BLACK; }
            // The second tier: only after a failure on the budget, or on the horizon with no knight,
            // rook or queen on the board (in a game, almost never: one look at the piece sets).
            let (fw, fb) = (r[0].failure, r[1].failure);
            if (fw == Failure::Budget || fb == Failure::Budget || ((fw == Failure::Horizon || fb == Failure::Horizon) && no_knight_rook_queen(pos)))
                && open & !proven != 0 {
                proven |= second_tier(&mut self.search, pos, open & !proven, fw, fb);
            }
            // Under the rules, the searches again with them, only where a rule can end a line.
            let rule = self.move_rule;
            let near = rule > 0 && pos.halfmove + DOMINO_DEEP_PLY.max(REGION_REACH) >= rule;
            let repeat = open & !proven != 0 && self.repetition > 0 && repetition_set(&mut self.search, self.repetition, history);
            if near || repeat {
                for i in 0..2 {
                    let bit = if i == 1 { FLAGGED_BLACK } else { FLAGGED_WHITE };
                    if open & !proven & bit == 0 { continue; }
                    let u = rule_search(&mut self.search, pos, if i == 1 { BLACK } else { WHITE }, rule, repeat, if i == 1 { fb } else { fw },
                                        DOMINO_PLY, DOMINO_BUDGET, DOMINO_DEEP_PLY, DOMINO_DEEP_BUDGET);
                    if u.is_some_and(|(r, _)| r.proven) { proven |= bit; }
                }
            }
        }
        if proven & FLAGGED_BLACK != 0 { self.white_down_at = ply; }
        if proven & FLAGGED_WHITE != 0 { self.black_down_at = ply; }
    }
    /// The game is back at ply `ply` (moves taken back): a flag that came down after it goes up
    /// again, and the next update is for ply + 1, by the clock rule. (rewind)
    pub fn rewind(&mut self, ply: i64) {
        if self.white_down_at > ply { self.white_down_at = -1; }
        if self.black_down_at > ply { self.black_down_at = -1; }
        if self.updated_ply > ply { self.updated_ply = ply; }
    }
}
