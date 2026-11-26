/* ═══ Mateless · ladder.js — the ladder: when each rung is asked, and the flags a game keeps ═══

   The rungs answer one question for one side, "can it never be mated?":
     1. the material test   (material.js)
     2. the lock detector   (lock.js)
     3. the Domino search   (domino.js), 3 plies and 10 nodes
     4. the Domino search's second tier, 9 plies and 5,000 nodes, and its third, 150 plies and
        5,000,000 nodes, each where the one before it fails without finding a mate (the second
        version, below)
     5. under a move rule (moveRule 150 or 100) or a repetition rule (repetition 5 or 3, with the
        game's history), the second version, below: a search with the rules ending lines, where
        they can end one (the clock search, clock.js, near the move rule)
   This layer puts them together: for one position (proveCannotBeMated, proveBoth, isDeadPosition)
   and for a game played move by move (Flags). What a proof means for the result of a game is the
   game layer's business (game.js); here a side is only proven unable to mate, or not.

   From the board it needs nothing beyond what the rungs need, and the halfmove clock and the en
   passant square, which say when the static tests can have changed. */

import { BLACK, fail, hashKey, KEY_WORDS, keysEqual, NO_SQUARE, WHITE } from './board.js';
import { cannotMate, cannotMate2, FLAGGED_BLACK, FLAGGED_WHITE, pawnCheck, staticTests2, TEST_LOCK,
         TESTS_BOTH } from './lock.js';
import { DOMINO_BUDGET, DOMINO_DEEP_BUDGET, DOMINO_DEEP_PLY, DOMINO_PLY, DOMINO_RULE_BUDGET, DOMINO_THIRD_BUDGET,
         DOMINO_THIRD_PLY, Domino, PositionSet } from './domino.js';
import { ClockSearch, REGION_REACH } from './clock.js';

/* The flagged side is the one to be proven unable to be mated: "White can never mate" is the
   proof with Black flagged. The search is shared by every call (see the notes on porting in
   index.js). */
const sharedSearch = new Domino();
/* The search under a move rule (clock.js), shared the same way. */
const sharedClock = new ClockSearch();

/* ─── The tiers (the second version) ───────────────────────────────────────────────────

   Where the first search (3 plies and 10 nodes, the first version's) fails without finding a
   mate, a deeper one can still prove the side: a king that must take a last queen or rook, and
   then a pawn ending that runs into stalemate or a lock, takes more than 3 plies or 10 nodes. So a
   side the first search leaves unproven goes on to the second tier (9 plies, 5,000 nodes), and
   one the second leaves unproven to the third (150 plies, 5,000,000 nodes): each position on its
   own, the moment the tier before it fails. A search that found a mate has proven nothing can be
   proven: there the ladder stops. A budget is a ceiling, not a cost: a tier ends when its search
   does, by a proof, a mate, or lines that reach its ply ceiling.

   On chasolver's list of 19 November (204,484 rows) the first tier leaves 645 rows to the second
   and 2 reach the third; none is left unproven under the 75-move rule, and without it 1
   (8/7p/5p1P/5p1K/5Pp1/6P1/b3k3/8 w, which only the rule proves, see below). Until 26 November
   2026 the second tier (then 9 plies and 10,000 nodes, after a first search of 6 plies and 100)
   ran only after a failure on the budget, or on the horizon with no knight, rook or queen on the
   board and a king shut in; after a first search of 3 plies that left 14 rows unproven.

   The third tier runs for a single position's verdict (proveCannotBeMated, proveBoth,
   flagVerdict; thirdBudget 0: none). A game's flags (Flags) and isDeadPosition stop at the
   second: they search after every move, for both sides, and the third would widen the window of
   the rules' searches (below) for every side its ply ceiling stopped.

   Like the first search the tiers prove only what they prove: a failure is no claim that a mate
   exists. */

/** Does the next tier run after a search that failed for `failure`? After any failure but a mate. */
function deepAllowed(pos, failure) {
  return failure === 'budget' || failure === 'horizon';
}

/** The second tier in a game (Flags.update): of the sides in `open`, whose first searches failed for
    fw (White flagged) and fb, those it is allowed for and proves, both in one walk. */
function secondTier(pos, open, fw, fb) {
  let deep = 0;
  if ((open & FLAGGED_WHITE) && deepAllowed(pos, fw)) deep |= FLAGGED_WHITE;
  if ((open & FLAGGED_BLACK) && deepAllowed(pos, fb)) deep |= FLAGGED_BLACK;
  if (!deep) return 0;
  const d = sharedSearch.run2(pos, deep, DOMINO_DEEP_PLY, DOMINO_DEEP_BUDGET, { rootStatic: false });
  return (d[0].proven ? FLAGGED_WHITE : 0) | (d[1].proven ? FLAGGED_BLACK : 0);
}

/* ─── The move rule (the second version) ─────────────────────────────────────────────────

   A game ends by itself, drawn, once 75 moves of each side have passed with no capture and no
   pawn move (FIDE 9.6.2: the halfmove clock at 150), and on some platforms already at 50 (100).
   Then a mate that would come later can never come, and a side that could mate only after it
   cannot mate at all. With a moveRule (0, the default: none) the ladder takes that into account:
   a side the searches above leave unproven is searched again under the rule, once, by the clock
   search (clock.js): the positions reachable without a capture or a pawn move, as far as the
   clock lets a line go, cut by a lower bound on the plies to a mate or to an exit. An exit (a
   capture or a pawn move, which puts the clock back to 0) is judged by the searches above,
   without the rule, with the caller's limits. It runs where the rule can end a line within
   REGION_REACH (40) plies, or within the deeper of the first two tiers' ply ceilings if that is
   more, or the third's when it ran, with a budget of at least DOMINO_RULE_BUDGET (200,000) nodes
   (or the third tier's, when it ran), which pays for the exits' searches too. Further from the rule a mate in time is all but certain, and the search would
   only find one. A game comes that close to the rule rarely (in chasolver's 201,060 Lichess rows,
   one flag fell with the clock above 99, none above 139). King and queen against king
   (k7/3Q4/8/8/8/8/8/K7 w, a helpmate of 9 plies at the shortest) under the 50-move rule: up to
   the clock at 91 a mate comes in time, from 92 on none can, and the clock search proves it in
   58 nodes (the Domino search under the rule, with a ply ceiling for its horizon,
   needed 160,185 at 92, and with 10,000 nodes fell to the safe side up to 95). A search that
   finds a mate under the rule has found one before the rule ends the game: no search follows
   it.

   Since it runs only after the searches without the rule have failed, every proof they make
   stands, with the same nodes; the rule can only add proofs, never take one away. A proof under
   the rule holds for a game that ends at that rule: a game that goes on past it needs the proof
   without it. So a game under a rule must end at that rule (gameStatus's moveRule, game.js).
   With the 75-move rule a proof holds under the 50-move rule too (its lines are cut sooner), not
   the other way round.

   The repetition rule works the same way. A game ends by itself, drawn, when a position occurs for
   the fifth time (FIDE 9.6.1), and on some platforms already for the third. With a repetition (0,
   the default: none) and the game's history (the positions before the root since the last capture
   or pawn move), the positions the game has already had repetition − 1 times end a line, drawn,
   wherever the search meets them (the clock search's repeat, and Domino.run's). That only
   matters with a history: a position of the line that comes back is covered by the search's
   memory already. In a cage that is what proves it; but where the only move leads, a few plies
   on, into a position the game has had four times, only the rule ends the line. The searches
   under the rules run when the move rule can end a line within the clock search's reach (then
   the clock search, with the repetition set too), or when there is such a position (then the
   Domino search with it: the first tier's limits, or the second tier's where it was allowed
   without the rules, with its budget). Same as the move rule, a proof under a repetition rule
   holds for a game that ends at it, and fivefold's holds under threefold too. */

/** The positions of a history that occur there at least repetition − 1 times: there a line ends,
    the game drawn. history: { keys, n }, the codes (KEY_WORDS words each) of the game's positions
    before the root since its last capture or pawn move. Returns null when there are none, or no
    rule or no history. A position comes back at the earliest 4 plies later, so with fewer than
    4 (repetition − 2) + 1 positions none can have occurred repetition − 1 times. */
const repeatSet = new PositionSet();
function repetitionSet(repetition, history) {
  if (!repetition || !history) return null;
  const k = history.keys, n = history.n, need = repetition - 1;
  if (!(n >= 4 * (repetition - 2) + 1)) return null;
  repeatSet.clear();
  for (let a = 0; a < n; a++) {
    let c = 0;
    for (let b = 0; b < n && c < need; b++) if (keysEqual(k, a * KEY_WORDS, k, b * KEY_WORDS)) c++;
    if (c >= need) repeatSet.add(k, a * KEY_WORDS, hashKey(k, a * KEY_WORDS));
  }
  return repeatSet.count ? repeatSet : null;
}

/** The searches again under the rules, once, for a side the searches without them left unproven
    (failure: why the first tier failed): repeat is the repetition set or null. The ply ceiling is
    the deeper of the two tiers' (deepBudget 0: the first tier's). Where the move rule can end a
    line within REGION_REACH plies or that ceiling, the clock search, with a budget of the larger
    of the tiers' and DOMINO_RULE_BUDGET; with only a repetition set, the Domino search with it, its
    budget the first tier's, or the second tier's where it was allowed without the rules. Returns
    { r, nodes }, or null when no rule can end a line. */
function ruleSearch(pos, flagged, moveRule, repeat, failure, maxPly, budget, deepPly, deepBudget, third = null) {
  // third: the third tier's [ply ceiling, node budget] when it ran, else null
  const ply = Math.max(deepBudget > 0 ? Math.max(maxPly, deepPly) : maxPly, third ? third[0] : 0);
  const near = moveRule > 0 && pos.halfmove + Math.max(ply, REGION_REACH) >= moveRule;
  if (!near && !repeat) return null;
  if (near) {
    const nodes = Math.max(budget, deepBudget, third ? third[1] : 0, DOMINO_RULE_BUDGET);
    const r = sharedClock.run(pos, flagged, moveRule, nodes, repeat,
                              (p, f) => exitProof(p, f, maxPly, budget, deepPly, deepBudget, third));
    return { r, nodes: nodes - r.budgetLeft };
  }
  const nodes = Math.max(budget, deepBudget > 0 && deepAllowed(pos, failure) ? deepBudget : 0, third ? third[1] : 0);
  const r = sharedSearch.run(pos, flagged, ply, nodes, { rootStatic: false, repeat });
  return { r, nodes: nodes - r.budgetLeft };
}

/** The ladder without the rules at an exit of the clock search (a position after a capture or a
    pawn move): the static tests, the first tier, the second where it is allowed. Returns
    { proven, nodes }. */
function exitProof(pos, flagged, maxPly, budget, deepPly, deepBudget, third) {
  if (cannotMate(pos, flagged)) return { proven: true, nodes: 0 };
  let r = sharedSearch.run(pos, flagged, maxPly, budget, { rootStatic: false }), nodes = budget - r.budgetLeft;
  if (!r.proven && deepBudget > 0 && deepAllowed(pos, r.failure)) {
    r = sharedSearch.run(pos, flagged, deepPly, deepBudget, { rootStatic: false });
    nodes += deepBudget - r.budgetLeft;
    if (!r.proven && third && deepAllowed(pos, r.failure)) {
      r = sharedSearch.run(pos, flagged, third[0], third[1], { rootStatic: false });
      nodes += third[1] - r.budgetLeft;
    }
  }
  return { proven: r.proven, nodes };
}

/** moveRule must be 0 (none), 100 or 150; repetition 0 (none), 3 or 5. */
function checkMoveRule(moveRule) {
  if (moveRule !== 0 && moveRule !== 100 && moveRule !== 150) fail('moveRule must be 0, 100 or 150');
}
function checkRepetition(repetition) {
  if (repetition !== 0 && repetition !== 3 && repetition !== 5) fail('repetition must be 0, 3 or 5');
}

/** Can `flagged` never be mated? The static tests at the root, then the Domino search (by
    default 6 plies, 100 nodes) and, where it allows, its second tier (9 plies, 10,000 nodes;
    deepBudget 0: none) and, with a moveRule or a repetition (and the game's history: { keys, n },
    see repetitionSet), the searches under the rules (see above); after a failure of the second
    tier without a mate, the third (thirdPly, thirdBudget, by default 150 plies and 5,000,000
    nodes; thirdBudget 0: none). Returns
    { proven, staticProof, failure, foundBy, nodes, deep, ruled }: staticProof says the static
    tests proved it at the root; failure is 'mate', 'horizon' or 'budget' when nothing was proven
    ('mate' with foundBy 'search': the search played a line that mates, under the rule when it
    ran: then a mate before the rule ends the game); nodes counts the moves the searches played;
    deep is how many tiers after the first ran (0, 1 or 2); ruled says the searches under the rule
    ran, and the answer is theirs. */
export function proveCannotBeMated(pos, flagged, { maxPly = DOMINO_PLY, budget = DOMINO_BUDGET,
                                                   deepPly = DOMINO_DEEP_PLY, deepBudget = DOMINO_DEEP_BUDGET,
                                                   thirdPly = DOMINO_THIRD_PLY, thirdBudget = DOMINO_THIRD_BUDGET,
                                                   moveRule = 0, repetition = 0, history = null } = {}) {
  checkMoveRule(moveRule); checkRepetition(repetition);
  if (cannotMate(pos, flagged)) return { proven: true, staticProof: true, failure: null, foundBy: null, nodes: 0, deep: 0, ruled: false };
  let r = sharedSearch.run(pos, flagged, maxPly, budget, { rootStatic: false }), nodes = budget - r.budgetLeft, deep = 0, third = null;
  const firstFailure = r.failure;
  if (!r.proven && deepBudget > 0 && deepAllowed(pos, r.failure)) {
    r = sharedSearch.run(pos, flagged, deepPly, deepBudget, { rootStatic: false });
    nodes += deepBudget - r.budgetLeft; deep = 1;
    if (!r.proven && thirdBudget > 0 && deepAllowed(pos, r.failure)) {
      r = sharedSearch.run(pos, flagged, thirdPly, thirdBudget, { rootStatic: false });
      nodes += thirdBudget - r.budgetLeft; deep = 2; third = [thirdPly, thirdBudget];
    }
  }
  let ruled = false;
  if (!r.proven && (moveRule > 0 || repetition > 0)) {
    const u = ruleSearch(pos, flagged, moveRule, repetitionSet(repetition, history), firstFailure, maxPly, budget, deepPly, deepBudget, third);
    if (u) { r = u.r; nodes += u.nodes; ruled = true; }
  }
  return { proven: r.proven, staticProof: false, failure: r.failure, foundBy: r.failure === 'mate' ? 'search' : null, nodes, deep, ruled };
}

/** proveCannotBeMated for both sides at once: one pass of the static tests, then one walk of the
    search (Domino.run2) for the sides they leave open, and one more of the second tier for the
    sides it is allowed for, then, with a moveRule or a repetition, the searches under the rules
    for each side still open. Returns [White flagged, Black flagged], each the same proof as
    proveCannotBeMated gives. */
export function proveBoth(pos, { maxPly = DOMINO_PLY, budget = DOMINO_BUDGET,
                                 deepPly = DOMINO_DEEP_PLY, deepBudget = DOMINO_DEEP_BUDGET,
                                 thirdPly = DOMINO_THIRD_PLY, thirdBudget = DOMINO_THIRD_BUDGET, moveRule = 0,
                                 repetition = 0, history = null } = {}) {
  checkMoveRule(moveRule); checkRepetition(repetition);
  const both = FLAGGED_WHITE | FLAGGED_BLACK, st = cannotMate2(pos, both);
  const r = st !== both ? sharedSearch.run2(pos, both & ~st, maxPly, budget, { rootStatic: false }) : null;
  let deepAsk = 0;
  if (r && deepBudget > 0) for (let i = 0; i < 2; i++)
    if (!((st >> i) & 1) && !r[i].proven && deepAllowed(pos, r[i].failure)) deepAsk |= 1 << i;
  const d = deepAsk ? sharedSearch.run2(pos, deepAsk, deepPly, deepBudget, { rootStatic: false }) : null;
  let thirdAsk = 0;
  if (d && thirdBudget > 0) for (let i = 0; i < 2; i++)
    if (((deepAsk >> i) & 1) && !d[i].proven && deepAllowed(pos, d[i].failure)) thirdAsk |= 1 << i;
  const t = thirdAsk ? sharedSearch.run2(pos, thirdAsk, thirdPly, thirdBudget, { rootStatic: false }) : null;
  const proof = i => {
    if ((st >> i) & 1) return { proven: true, staticProof: true, failure: null, foundBy: null, nodes: 0, deep: 0, ruled: false };
    const first = budget - r[i].budgetLeft, deep = ((deepAsk >> i) & 1) === 1, th = ((thirdAsk >> i) & 1) === 1;
    let x = th ? t[i] : deep ? d[i] : r[i], nodes = deep ? first + deepBudget - d[i].budgetLeft : first, ruled = false;
    if (th) nodes += thirdBudget - t[i].budgetLeft;
    if (!x.proven && (moveRule > 0 || repetition > 0)) {
      const u = ruleSearch(pos, i ? BLACK : WHITE, moveRule, repetitionSet(repetition, history), r[i].failure, maxPly, budget, deepPly, deepBudget,
                           th ? [thirdPly, thirdBudget] : null);
      if (u) { x = u.r; nodes += u.nodes; ruled = true; }
    }
    return { proven: x.proven, staticProof: false, failure: x.failure, foundBy: x.failure === 'mate' ? 'search' : null,
             nodes, deep: th ? 2 : deep ? 1 : 0, ruled };
  };
  return [proof(0), proof(1)];
}

/** One side's searches for isDeadPosition: the first tier, then the second where it allows, then,
    with rules, both again under them. */
function searchProves(pos, flagged, moveRule, repetition, history) {
  const r = sharedSearch.run(pos, flagged, DOMINO_PLY, DOMINO_BUDGET, { rootStatic: false });
  if (r.proven) return true;
  const deep = deepAllowed(pos, r.failure);
  if (deep && sharedSearch.run(pos, flagged, DOMINO_DEEP_PLY, DOMINO_DEEP_BUDGET, { rootStatic: false }).proven) return true;
  if (!moveRule && !repetition) return false;
  const u = ruleSearch(pos, flagged, moveRule, repetitionSet(repetition, history), r.failure, DOMINO_PLY, DOMINO_BUDGET, DOMINO_DEEP_PLY, DOMINO_DEEP_BUDGET);
  return !!u && u.r.proven;
}

/** Is the position dead (FIDE 5.2.2)? For each side, the static tests, then the Domino search
    and its second tier; both sides must be proven unable to mate. A single position, with no game
    around it. The static tests run for both sides in one pass (cannotMate2); the searches run one
    side at a time, Black flagged first: the first that fails already answers no, and one search
    costs less than the shared walk of two (run2 pays off only when both answers are needed:
    proveBoth, Flags). With a moveRule or a repetition (and a history), under those rules. */
export function isDeadPosition(pos, { moveRule = 0, repetition = 0, history = null } = {}) {
  checkMoveRule(moveRule); checkRepetition(repetition);
  const open = (FLAGGED_WHITE | FLAGGED_BLACK) & ~cannotMate2(pos, FLAGGED_WHITE | FLAGGED_BLACK);
  if ((open & FLAGGED_BLACK) && !searchProves(pos, BLACK, moveRule, repetition, history)) return false;
  return !(open & FLAGGED_WHITE) || searchProves(pos, WHITE, moveRule, repetition, history);
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
     3. the Domino search      after every move;
     4. its second tier        after a failure of the Domino search on its budget, or on its
                               horizon with no knight, rook or queen on the board and a king
                               shut in (see above);
     5. under the rules        (new Flags({ moveRule, repetition }), the history given to update)
                               the searches again, with the rules, for a side still open, where a
                               rule can end a line (see above).
   Only those moves change what the static tests look at (testsAfter in lock.js), so the flags
   remember of the ply before only whether an en passant square stood and the side to move was in
   a pawn's check. A platform that leaves plies out gets the clock rule (both tests whenever the
   halfmove clock is at most 1), which needs no memory of the ply before. Both sides are examined
   after every move, until their flags are down, in one pass: the parts of the static tests that
   do not depend on the side are computed once, and the two Domino searches share one walk
   (Domino.run2), with the answers each side would get alone; so do the two second tiers.

   A flag that is down stays down: every later position is reached from this one by legal moves,
   so no series of moves from it can mate where none from here could. Its side is never examined
   again. Both flags down is a dead position (FIDE 5.2.2): the game ends there. When a flag falls
   on the clock (FIDE 6.9), or a side resigns (FIDE 5.1.2), the verdict is read from the
   opponent's flag: down, a draw; up, a win for the opponent. Nothing is computed at that moment.

   A flag left up is no claim that a mate exists: the ladder found no proof within its limits.
   On chasolver's 201,060 Lichess rows that leaves 6 positions (the first version: 36), for a
   complete solver (and a rating refund) after the game.

   A platform that lets moves be taken back calls rewind(ply) with the ply the game is back at:
   the flags that came down after it go up again, and the next update is for the ply after it.
   What the flags remember of the ply before is then not used: that update asks the static tests
   by the clock rule, as after plies left out. (The same holds when updatedPly is
   written by hand.) */
export class Flags {
  /** moveRule: 0 (none), 150 or 100; repetition: 0 (none), 5 or 3. The proofs hold for a game that
      ends at those rules. */
  constructor({ moveRule = 0, repetition = 0 } = {}) {
    checkMoveRule(moveRule); checkRepetition(repetition);
    this.moveRule = moveRule;
    this.repetition = repetition;
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
      Domino.run2), with the answers each side would get alone. history: the game's positions
      before this one since its last capture or pawn move ({ keys, n }), for a repetition rule. */
  update(pos, ply, history = null) {
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
      // The second tier: only after a failure on the budget, or on the horizon with no knight, rook
      // or queen on the board (in a game, almost never: one look at the piece sets).
      const fw = r[0].failure, fb = r[1].failure;
      if ((fw === 'budget' || fb === 'budget' || fw === 'horizon' || fb === 'horizon') && (open & ~proven))
        proven |= secondTier(pos, open & ~proven, fw, fb);
      // Under the rules, the searches again with them, only where a rule can end a line.
      const rule = this.moveRule, near = rule && pos.halfmove + Math.max(DOMINO_DEEP_PLY, REGION_REACH) >= rule;
      const repeat = (open & ~proven) && this.repetition ? repetitionSet(this.repetition, history) : null;
      if (near || repeat)
        for (let i = 0; i < 2; i++) {
          const bit = i ? FLAGGED_BLACK : FLAGGED_WHITE;
          if (!(open & ~proven & bit)) continue;
          const u = ruleSearch(pos, i ? BLACK : WHITE, rule, repeat, i ? fb : fw, DOMINO_PLY, DOMINO_BUDGET, DOMINO_DEEP_PLY, DOMINO_DEEP_BUDGET);
          if (u && u.r.proven) proven |= bit;
        }
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
