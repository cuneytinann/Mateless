//! The ladder (`src/ladder.js`): the rungs put together, for one position
//! (`prove_cannot_be_mated`, `prove_both`, `is_dead_position`) and for a game played move by move
//! (`Flags`). The fourth rung, on request, is the searches under the rules a game ends at by itself
//! (`Rules`: the 75- or 50-move rule, fivefold or threefold repetition with the game's history), the
//! clock search (clock.rs) near the move rule. Every search runs with the limits it is given.

use crate::board::{BLACK, Key, NO_SQUARE, Position, WHITE};
use crate::lock::{cannot_mate, cannot_mate2, FLAGGED_BLACK, FLAGGED_WHITE, pawn_check,
    static_tests2, TEST_LOCK, TESTS_BOTH};
use crate::domino::{Domino, DOMINO_BUDGET, DOMINO_PLY, Failure, SearchResult};
use crate::clock::ClockSearch;

/// A proof or its failure; `ruled`: the searches under the rules ran, and the answer is theirs.
#[derive(Clone, Copy, Debug)]
pub struct Proof { pub proven: bool, pub static_proof: bool, pub failure: Failure, pub nodes: i64, pub ruled: bool }

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

/// The ladder without the rules at an exit of the clock search: the static tests, then the Domino
/// search with the caller's limits. Returns (proven, nodes). (exitProof)
fn exit_proof(search: &mut Domino, pos: &Position, flagged: u8, max_ply: u32, budget: i64) -> (bool, i64) {
    if cannot_mate(pos, flagged) { return (true, 0); }
    let r = search.run(pos, flagged, max_ply, budget, false);
    (r.proven, budget - r.budget_left)
}

/// The searches again under the rules, once, for a side the searches without them left unproven
/// (`repeat`: the repetition set is filled). Where the move rule can end a line within the ply
/// ceiling, the clock search; with only a repetition set, the Domino search with it. Both with the
/// limits given: the budget is this search's own, and pays for the exits too. Returns (result,
/// nodes), or None. (ruleSearch)
fn rule_search(search: &mut Domino, pos: &Position, flagged: u8, move_rule: u32, repeat: bool,
               max_ply: u32, budget: i64) -> Option<(SearchResult, i64)> {
    let near = move_rule > 0 && pos.halfmove + max_ply >= move_rule;
    if !near && !repeat { return None; }
    if near {
        let mut clock = search.clock.take().unwrap_or_else(|| Box::new(ClockSearch::new()));
        let set = if repeat { Some(std::mem::take(&mut search.repeat)) } else { None };
        let r = clock.run(pos, flagged, move_rule, budget, set.as_ref(),
                          &mut |p: &Position, f: u8| exit_proof(search, p, f, max_ply, budget));
        if let Some(x) = set { search.repeat = x; }
        search.clock = Some(clock);
        return Some((r, budget - r.budget_left));
    }
    let r = search.run_rules(pos, flagged, max_ply, budget, false, 0, true);
    Some((r, budget - r.budget_left))
}

/// Can `flagged` never be mated? The static tests at the root, then the Domino search with the
/// limits given. (proveCannotBeMated)
pub fn prove_cannot_be_mated(search: &mut Domino, pos: &Position, flagged: u8, max_ply: u32, budget: i64) -> Proof {
    prove_cannot_be_mated_rules(search, pos, flagged, max_ply, budget, &Rules::NONE)
}

/// prove_cannot_be_mated under the rules: a side the search without them leaves unproven is
/// searched again under them, with the same limits, where a rule can end a line (rule_search).
pub fn prove_cannot_be_mated_rules(search: &mut Domino, pos: &Position, flagged: u8, max_ply: u32, budget: i64,
                                   rules: &Rules) -> Proof {
    if cannot_mate(pos, flagged) { return Proof { proven: true, static_proof: true, failure: Failure::None, nodes: 0, ruled: false }; }
    let mut r = search.run(pos, flagged, max_ply, budget, false);
    let mut nodes = budget - r.budget_left;
    let mut ruled = false;
    if !r.proven && rules.any() {
        let repeat = repetition_set(search, rules.repetition, rules.history);
        if let Some((u, n)) = rule_search(search, pos, flagged, rules.move_rule, repeat, max_ply, budget) {
            r = u; nodes += n; ruled = true;
        }
    }
    Proof { proven: r.proven, static_proof: false, failure: r.failure, nodes, ruled }
}

/// prove_cannot_be_mated for both sides at once (a dead position needs both): one pass of the
/// static tests, then one walk of the search for the sides they leave open. Index 0: White
/// flagged, 1: Black flagged; each the same proof as prove_cannot_be_mated gives.
pub fn prove_both(search: &mut Domino, pos: &Position, max_ply: u32, budget: i64) -> [Proof; 2] {
    prove_both_rules(search, pos, max_ply, budget, &Rules::NONE)
}

/// prove_both under the rules: then, for each side still open, the searches under them.
pub fn prove_both_rules(search: &mut Domino, pos: &Position, max_ply: u32, budget: i64, rules: &Rules) -> [Proof; 2] {
    let both = FLAGGED_WHITE | FLAGGED_BLACK;
    let st = cannot_mate2(pos, both);
    let none = [SearchResult { proven: false, failure: Failure::None, budget_left: budget, ruled: false }; 2];
    let r = if st != both { search.run2(pos, both & !st, max_ply, budget, false) } else { none };
    let mut proof = |i: usize| {
        if st & (1 << i) != 0 { return Proof { proven: true, static_proof: true, failure: Failure::None, nodes: 0, ruled: false }; }
        let mut p = Proof { proven: r[i].proven, static_proof: false, failure: r[i].failure, nodes: budget - r[i].budget_left, ruled: false };
        if !p.proven && rules.any() {
            let repeat = repetition_set(search, rules.repetition, rules.history);
            if let Some((u, n)) = rule_search(search, pos, if i == 1 { BLACK } else { WHITE }, rules.move_rule, repeat, max_ply, budget) {
                p.proven = u.proven; p.failure = u.failure; p.nodes += n; p.ruled = true;
            }
        }
        p
    };
    let w = proof(0);
    [w, proof(1)]
}

/// One side's searches for is_dead_position, with the default limits: the Domino search, then,
/// with rules, the search under them.
fn search_proves(search: &mut Domino, pos: &Position, flagged: u8, rules: &Rules) -> bool {
    let r = search.run(pos, flagged, DOMINO_PLY, DOMINO_BUDGET, false);
    if r.proven { return true; }
    if !rules.any() { return false; }
    let repeat = repetition_set(search, rules.repetition, rules.history);
    rule_search(search, pos, flagged, rules.move_rule, repeat, DOMINO_PLY, DOMINO_BUDGET).is_some_and(|(u, _)| u.proven)
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


/// The two flags of a game played move by move (Flags in src/ladder.js): a side
/// whose flag is down has been proven unable to mate for the rest of the game. The static tests
/// are asked after a capture or a pawn move (halfmove 0), the lock detector also after a move made
/// while an en passant square stood or out of a pawn's check; the Domino search after every move
/// (the default limits: 60 plies, 10,000 nodes); under the rules, where a rule can end a line, the
/// searches under them with the same limits.
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
    /// both sides in one pass (cannot_mate2, then Domino::run2), with the same answers as climbing
    /// it for each side alone.
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
            // Under the rules, the searches again with them, only where a rule can end a line.
            let rule = self.move_rule;
            let near = rule > 0 && pos.halfmove + DOMINO_PLY >= rule;
            let repeat = open & !proven != 0 && self.repetition > 0 && repetition_set(&mut self.search, self.repetition, history);
            if near || repeat {
                for i in 0..2 {
                    let bit = if i == 1 { FLAGGED_BLACK } else { FLAGGED_WHITE };
                    if open & !proven & bit == 0 { continue; }
                    let u = rule_search(&mut self.search, pos, if i == 1 { BLACK } else { WHITE }, rule, repeat, DOMINO_PLY, DOMINO_BUDGET);
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
