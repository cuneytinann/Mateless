/* ═══ Mateless · ladder.js — the ladder: when each rung is asked, and the flags a game keeps ═══

   The three rungs answer one question for one side, "can it never be mated?":
     1. the material test   (material.js)
     2. the lock detector   (lock.js)
     3. the Domino search   (domino.js)
   This layer puts them together: for one position (proveCannotBeMated, proveBoth, isDeadPosition)
   and for a game played move by move (Flags). What a proof means for the result of a game is the
   game layer's business (game.js); here a side is only proven unable to mate, or not.

   From the board it needs nothing beyond what the rungs need, and the halfmove clock and the en
   passant square, which say when the static tests can have changed. */

import { BLACK, NO_SQUARE, WHITE } from './board.js';
import { cannotMate, cannotMate2, FLAGGED_BLACK, FLAGGED_WHITE, pawnCheck, staticTests2, TEST_LOCK,
         TESTS_BOTH } from './lock.js';
import { DOMINO_BUDGET, DOMINO_PLY, Domino } from './domino.js';

/* The flagged side is the one to be proven unable to be mated: "White can never mate" is the
   proof with Black flagged. The search is shared by every call (see the notes on porting in
   index.js). */
const sharedSearch = new Domino();

/** Can `flagged` never be mated? The static tests at the root, then the Domino search (by
    default 6 plies, 100 nodes). Returns { proven, staticProof, failure, foundBy, nodes }:
    staticProof says the static tests proved it at the root; failure is 'mate', 'horizon' or
    'budget' when nothing was proven ('mate' with foundBy 'search': the search played a line
    that mates); nodes counts the moves the search played. */
export function proveCannotBeMated(pos, flagged, { maxPly = DOMINO_PLY, budget = DOMINO_BUDGET } = {}) {
  if (cannotMate(pos, flagged)) return { proven: true, staticProof: true, failure: null, foundBy: null, nodes: 0 };
  const r = sharedSearch.run(pos, flagged, maxPly, budget, { rootStatic: false });
  return { proven: r.proven, staticProof: false, failure: r.failure, foundBy: r.failure === 'mate' ? 'search' : null,
           nodes: budget - r.budgetLeft };
}

/** proveCannotBeMated for both sides at once: one pass of the static tests, then one walk of the
    search (Domino.run2) for the sides they leave open. Returns [White flagged, Black
    flagged], each the same proof as proveCannotBeMated gives. */
export function proveBoth(pos, { maxPly = DOMINO_PLY, budget = DOMINO_BUDGET } = {}) {
  const both = FLAGGED_WHITE | FLAGGED_BLACK, st = cannotMate2(pos, both);
  const r = st !== both ? sharedSearch.run2(pos, both & ~st, maxPly, budget, { rootStatic: false }) : null;
  const proof = i => (st >> i) & 1 ? { proven: true, staticProof: true, failure: null, foundBy: null, nodes: 0 }
    : { proven: r[i].proven, staticProof: false, failure: r[i].failure, foundBy: r[i].failure === 'mate' ? 'search' : null,
        nodes: budget - r[i].budgetLeft };
  return [proof(0), proof(1)];
}

/** Is the position dead (FIDE 5.2.2)? For each side, the static tests, then the Domino search;
    both sides must be proven unable to mate. A single position, with no game around it. The
    static tests run for both sides in one pass (cannotMate2); the searches run one at a time,
    Black flagged first: the first that fails already answers no, and one search costs less than
    the shared walk of two (run2 pays off only when both answers are needed: proveBoth, Flags). */
export function isDeadPosition(pos) {
  const open = (FLAGGED_WHITE | FLAGGED_BLACK) & ~cannotMate2(pos, FLAGGED_WHITE | FLAGGED_BLACK);
  if ((open & FLAGGED_BLACK) && !sharedSearch.run(pos, BLACK, DOMINO_PLY, DOMINO_BUDGET, { rootStatic: false }).proven) return false;
  return !(open & FLAGGED_WHITE) || sharedSearch.run(pos, WHITE, DOMINO_PLY, DOMINO_BUDGET, { rootStatic: false }).proven;
}

/* ─── The flags of a game ────────────────────────────────────────────────────────────────

   A game keeps, for each side, a flag "may still mate". A flag starts up, and comes down for
   good once the ladder proves that side can never mate:
     1. the material test   }  both asked after a capture or a pawn move (a promotion
     2. the lock detector   }  included: the halfmove clock is 0); the lock detector also
                               after a move made while an en passant square stood (the right
                               lapsed) or out of a pawn's check; neither while an en passant
                               square is set; both, whatever the last move was, the first time
                               a game's flags are brought up to date;
     3. the Domino search      after every move.
   Only those moves change what the static tests look at (testsAfter in lock.js), so the flags
   remember of the ply before only whether an en passant square stood and the side to move was in
   a pawn's check. A platform that leaves plies out gets the clock rule (both tests whenever the
   halfmove clock is at most 1), which needs no memory of the ply before. Both sides are examined
   after every move, until their flags are down, in one pass: the parts of the static tests that
   do not depend on the side are computed once, and the two Domino searches share one walk
   (Domino.run2), with the answers each side would get alone.

   A flag that is down stays down: every later position is reached from this one by legal moves,
   so no series of moves from it can mate where none from here could. Its side is never examined
   again. Both flags down is a dead position (FIDE 5.2.2): the game ends there. When a flag falls
   on the clock (FIDE 6.9), or a side resigns (FIDE 5.1.2), the verdict is read from the
   opponent's flag: down, a draw; up, a win for the opponent. Nothing is computed at that moment.

   A flag left up is no claim that a mate exists: the ladder found no proof within its limits.
   On chasolver's 201,060 Lichess rows that leaves 36 positions, for a complete solver (and a
   rating refund) after the game.

   A platform that lets moves be taken back calls rewind(ply) with the ply the game is back at:
   the flags that came down after it go up again, and the next update is for the ply after it.
   What the flags remember of the ply before is then not used: that update asks the static tests
   by the clock rule, as after plies left out. (The same holds when updatedPly is
   written by hand.) */
export class Flags {
  constructor() {
    /** The ply at which each side was proven unable to mate; -1 while its flag is up. */
    this.whiteDownAt = -1;
    this.blackDownAt = -1;
    /** The ply whose position the flags were last brought up to date for; -1 before the first. */
    this.updatedPly = -1;
    /** Of the position of game ply memoryPly (the last update's): did an en passant square stand,
        was the side to move in a pawn's check? Used by the update for the next ply only. */
    this.memoryPly = -1;
    this.updatedEp = false;
    this.updatedCheck = false;
  }
  /** Has `color` been proven unable to mate, for the rest of the game? */
  neverMates(color) { return (color === WHITE ? this.whiteDownAt : this.blackDownAt) >= 0; }
  /** Climbs the ladder (see above) for each side whose flag is still up, at `pos`, the position
      of game ply `ply`, once per ply: both sides in one pass (cannotMate2, then
      Domino.run2), with the answers each side would get alone. */
  update(pos, ply) {
    if (this.updatedPly === ply) return;
    const first = this.updatedPly < 0;
    // The memory of the ply before: only if the last update was for it, and nothing since
    // (rewind, updatedPly written by hand) has made it another ply's.
    const next = ply === this.updatedPly + 1 && this.memoryPly === this.updatedPly;
    const epBefore = this.updatedEp, checkBefore = this.updatedCheck;
    this.updatedPly = this.memoryPly = ply;
    this.updatedEp = pos.ep !== NO_SQUARE;
    // Only a pawn's check matters (lock.js), and it comes only from a pawn move: halfmove 0.
    this.updatedCheck = pos.halfmove === 0 && pos.ep === NO_SQUARE && pawnCheck(pos);
    // The static tests whose answer can have changed since the ply before (testsAfter in lock.js;
    // the halfmove clock is 0 after a capture or a pawn move, a promotion included). The first
    // update asks both, whatever the last move was; after plies left out or a rewind, the position
    // alone decides, by the clock rule (halfmove <= 1: a step out of a pawn's check and the
    // lapse of an en passant right both come one ply after a pawn move).
    const tests = first ? TESTS_BOTH
      : pos.ep !== NO_SQUARE ? 0
      : !next ? (pos.halfmove <= 1 ? TESTS_BOTH : 0)
      : (pos.halfmove === 0 ? TESTS_BOTH : 0) | (epBefore || checkBefore ? TEST_LOCK : 0);
    // White's flag (may White still mate?) is the proof with Black flagged, and the other way round.
    let open = 0;
    if (!this.neverMates(WHITE)) open |= FLAGGED_BLACK;
    if (!this.neverMates(BLACK)) open |= FLAGGED_WHITE;
    if (!open) return;
    let proven = tests ? staticTests2(pos, open, tests) : 0;
    if (open & ~proven) {
      const r = sharedSearch.run2(pos, open & ~proven, DOMINO_PLY, DOMINO_BUDGET, { rootStatic: false });
      if (r[0].proven) proven |= FLAGGED_WHITE;
      if (r[1].proven) proven |= FLAGGED_BLACK;
    }
    if (proven & FLAGGED_BLACK) this.whiteDownAt = ply;
    if (proven & FLAGGED_WHITE) this.blackDownAt = ply;
  }
  /** The game is back at ply `ply` (moves taken back): a flag that came down after it goes up
      again, and the next update is for ply + 1 (by the clock rule, see above). */
  rewind(ply) {
    if (this.whiteDownAt > ply) this.whiteDownAt = -1;
    if (this.blackDownAt > ply) this.blackDownAt = -1;
    if (this.updatedPly > ply) this.updatedPly = ply;
  }
}
