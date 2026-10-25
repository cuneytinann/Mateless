//! The ladder (`src/ladder.js`): the three rungs put together, for one position
//! (`prove_cannot_be_mated`, `prove_both`) and for a game played move by move (`Flags`).

use crate::board::{BLACK, NO_SQUARE, Position, WHITE};
use crate::lock::{cannot_mate, cannot_mate2, FLAGGED_BLACK, FLAGGED_WHITE, pawn_check,
    static_tests2, TEST_LOCK, TESTS_BOTH};
use crate::domino::{Domino, DOMINO_BUDGET, DOMINO_PLY, Failure, SearchResult};

#[derive(Clone, Copy, Debug)]
pub struct Proof { pub proven: bool, pub static_proof: bool, pub failure: Failure, pub nodes: i64 }

/// Can `flagged` never be mated? The static tests at the root, then the Domino search. (proveCannotBeMated)
pub fn prove_cannot_be_mated(search: &mut Domino, pos: &Position, flagged: u8, max_ply: u32, budget: i64) -> Proof {
    if cannot_mate(pos, flagged) { return Proof { proven: true, static_proof: true, failure: Failure::None, nodes: 0 }; }
    let r = search.run(pos, flagged, max_ply, budget, false);
    Proof { proven: r.proven, static_proof: false, failure: r.failure, nodes: budget - r.budget_left }
}

/// prove_cannot_be_mated for both sides at once (a dead position needs both): one pass of the
/// static tests, then one walk of the search for the sides they leave open. Index 0: White
/// flagged, 1: Black flagged; each the same proof as prove_cannot_be_mated gives.
pub fn prove_both(search: &mut Domino, pos: &Position, max_ply: u32, budget: i64) -> [Proof; 2] {
    let both = FLAGGED_WHITE | FLAGGED_BLACK;
    let st = cannot_mate2(pos, both);
    let r = if st != both { search.run2(pos, both & !st, max_ply, budget, false) }
            else { [SearchResult { proven: false, failure: Failure::None, budget_left: budget }; 2] };
    let proof = |i: usize| if st & (1 << i) != 0 { Proof { proven: true, static_proof: true, failure: Failure::None, nodes: 0 } }
        else { Proof { proven: r[i].proven, static_proof: false, failure: r[i].failure, nodes: budget - r[i].budget_left } };
    [proof(0), proof(1)]
}


/// The two flags of a game played move by move (Flags in src/ladder.js): a side
/// whose flag is down has been proven unable to mate for the rest of the game. The static tests
/// are asked after a capture or a pawn move (halfmove 0), the lock detector also after a move made
/// while an en passant square stood or out of a pawn's check; the Domino search after every move.
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
    search: Domino,
}

impl Default for Flags { fn default() -> Self { Self::new() } }

impl Flags {
    pub fn new() -> Flags {
        Flags { white_down_at: -1, black_down_at: -1, updated_ply: -1, memory_ply: -1, updated_ep: false, updated_check: false, search: Domino::new() }
    }
    pub fn never_mates(&self, color: u8) -> bool { if color == WHITE { self.white_down_at >= 0 } else { self.black_down_at >= 0 } }
    /// Climbs the ladder for each side whose flag is still up, at the position of game ply `ply`:
    /// both sides in one pass (cannot_mate2, then Domino::run2), with the same answers as climbing
    /// it for each side alone.
    pub fn update(&mut self, pos: &Position, ply: i64) {
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
