/* ═══ Mateless · game.js — a reference game: results, repetitions, the move rules ═════════════

   What the ladder's answers mean for the result of a game, and the endings that need no claim:
   checkmate, stalemate, the 75-move rule, fivefold repetition and a dead position (both flags
   down). Claims (threefold repetition, the 50-move rule) and agreed draws are left to the
   platform, which has the repetition count and the halfmove clock to decide them.
     repetition    a game keeps an exact code of every position and counts repetitions by looking
                   back only over the moves since the last capture or pawn move, every other ply
                   (the side to move must match). */

import { BLACK, checkPromotion, doMove, fail, findLegalMove, hasLegalMove, KEY_WORDS, keysEqual,
         legalMoves, MOVE_STRIDE, QUEEN, SHARED_CONTEXT, squareName, WHITE, writeKey } from './board.js';
import { cannotMate } from './lock.js';
import { DOMINO_BUDGET, DOMINO_PLY } from './domino.js';
import { Flags, isDeadPosition, proveCannotBeMated } from './ladder.js';

/* The fourteen results the engine decides, as it numbers them; 0 means the game goes on.
     the board ends the game         1, 2 checkmate; 3 stalemate; 4 the 75-move rule; 5 fivefold
                                     repetition (FIDE 9.6); 6 a dead position (FIDE 5.2.2);
                                     13 the 50-move rule, only in a game that ends at it (moveRule
                                     100); 14 threefold repetition, only in a game that ends at it
                                     (repetition 3)
     a flag falls (FIDE 6.9)         7, 8 a win on time; 11 a draw: the opponent can never mate
     a side resigns (FIDE 5.1.2)     9, 10 a win; 12 a draw: the opponent can never mate
   RESULT_NAMES gives each one in words. Draws that need a claim (threefold repetition, FIDE 9.2;
   the 50-move rule, 9.3) or an agreement are the platform's to decide: a Game says when a claim
   may be made (claimable) and every position keeps its halfmove clock. */
export const RESULT_NAMES = Object.freeze(['ongoing', 'white checkmates', 'black checkmates', 'stalemate', '75-move rule', 'fivefold repetition', 'dead position', 'white wins on time', 'black wins on time', 'white wins by resignation', 'black wins by resignation', 'draw on time', 'draw on resignation', '50-move rule', 'threefold repetition']);
export const Result = Object.freeze({
  NONE: 0,
  WHITE_MATES: 1, BLACK_MATES: 2, STALEMATE: 3,
  SEVENTY_FIVE_MOVES: 4, FIVEFOLD: 5, DEAD_POSITION: 6,
  WHITE_ON_TIME: 7, BLACK_ON_TIME: 8, WHITE_BY_RESIGNATION: 9, BLACK_BY_RESIGNATION: 10,
  DRAW_ON_TIME: 11, DRAW_ON_RESIGNATION: 12, FIFTY_MOVES: 13, THREEFOLD: 14,
});
/** The draws a player may claim now (Game.claimable), as bits. */
export const Claim = Object.freeze({ FIFTY_MOVES: 1, THREEFOLD: 2 });

/* A game's own rules (Game's options), each checked once. */
function checkGameOptions({ moveRule, repetition, claimMoves, claimRepetition, rungs }) {
  if (moveRule !== 0 && moveRule !== 100 && moveRule !== 150) fail('Game: moveRule must be 0, 100 or 150');
  if (repetition !== 0 && repetition !== 3 && repetition !== 5) fail('Game: repetition must be 0, 3 or 5');
  if (claimMoves !== 0 && claimMoves !== 100) fail('Game: claimMoves must be 0 or 100');
  if (claimRepetition !== 0 && claimRepetition !== 3) fail('Game: claimRepetition must be 0 or 3');
  if (rungs !== 1 && rungs !== 2 && rungs !== 3) fail('Game: rungs must be 1, 2 or 3');
}


/** How the game stands: checkmate, stalemate, the move rule, repetition, dead position, in
    that order: the endings that need no claim (a mate on the move that reaches the move rule
    stands, FIDE 9.6.2; the rules cost nothing, a dead position a proof). Returns a Result code, 0
    while the game goes on. Threefold repetition and the 50-move rule are claims, left to the
    platform.
      repetitions         how many times the current position has occurred;
      memory              a Game: its flags decide the dead position (see Flags.update);
      deadPositionSearch  false: only the static tests (material, lock) can find a dead
                          position, with no Domino search (a single position only). */
export function gameStatus(pos, { repetitions = 1, deadPositionSearch = true, memory = null } = {}) {
  if (!hasLegalMove(pos)) {
    if (SHARED_CONTEXT.checks === 0) return Result.STALEMATE;
    return pos.side === WHITE ? Result.BLACK_MATES : Result.WHITE_MATES;
  }
  // The move rule, then repetition (a Game's own rules may end it sooner: the 50-move rule,
  // threefold repetition), before the dead position.
  if (memory) memory.updateFlags();
  const rep = memory && memory.repetition === 3 ? 3 : 5, rule = memory && memory.moveRule === 100 ? 100 : 150;
  if (pos.halfmove >= rule) return rule === 100 ? Result.FIFTY_MOVES : Result.SEVENTY_FIVE_MOVES;
  if (repetitions >= rep) return rep === 3 ? Result.THREEFOLD : Result.FIVEFOLD;
  let dead;
  if (memory) dead = memory.neverMates(WHITE) && memory.neverMates(BLACK);
  else if (deadPositionSearch) dead = isDeadPosition(pos);
  else dead = cannotMate(pos, WHITE) && cannotMate(pos, BLACK);
  return dead ? Result.DEAD_POSITION : Result.NONE;
}

/** The verdict when the flag of `side` falls (FIDE 6.9), or `side` resigns (FIDE 5.1.2), in a
    single position with no game around it: a draw if the ladder proves that the
    opponent can never mate, otherwise a win for the opponent. In a game, Game.flagVerdict reads
    the flags instead. */
export function flagVerdict(pos, side, { resigned = false, maxPly = DOMINO_PLY, budget = DOMINO_BUDGET } = {}) {
  return verdictCode(side, proveCannotBeMated(pos, side, { maxPly, budget }).proven, resigned);
}

function verdictCode(side, draw, resigned) {
  if (draw) return resigned ? Result.DRAW_ON_RESIGNATION : Result.DRAW_ON_TIME;
  if (side === WHITE) return resigned ? Result.BLACK_BY_RESIGNATION : Result.BLACK_ON_TIME;
  return resigned ? Result.WHITE_BY_RESIGNATION : Result.WHITE_ON_TIME;
}

/** A game: the current position, the exact code of every position since the start, from which
    it counts how many times the current position has occurred, and
    the two flags (Flags, ladder.js). A position before the last capture or pawn move can never
    come back, so only the positions since then are compared, every other one, with the same side
    to move.
    The options are a platform's own rules; the defaults are FIDE's and the ladder's.
      moveRule          when the game ends by itself without a capture or a pawn move: 150 plies
                        (the 75-move rule) or 100 (the 50-move rule); 0, the default, is 150.
      repetition        at which occurrence of a position the game ends by itself: 5 or 3; 0, the
                        default, is 5. (In this version neither rule changes a proof.)
      claimMoves        from which halfmove clock a player may claim a draw (claimable): 100 (the
                        default, FIDE 9.3) or 0 (no claim).
      claimRepetition   from which occurrence a player may claim it: 3 (the default, FIDE 9.2) or
                        0 (no claim).
      rungs             how much of the ladder the flags climb: 1 the material test, 2 and the lock
                        detector, 3 (the default) the whole ladder.
      dominoAtEnd       with rungs 3: the Domino search runs only when a flag falls or a side
                        resigns (flagVerdict), not after every move; a dead position is then
                        found by the static tests alone. */
export class Game {
  constructor(position, { moveRule = 0, repetition = 0, claimMoves = 100, claimRepetition = 3, rungs = 3,
                          dominoAtEnd = false } = {}) {
    checkGameOptions({ moveRule, repetition, claimMoves, claimRepetition, rungs });
    this.moveRule = moveRule;
    this.repetition = repetition;
    this.claimMoves = claimMoves;
    this.claimRepetition = claimRepetition;
    this.rungs = rungs;
    this.dominoAtEnd = rungs === 3 && !!dominoAtEnd;
    this.position = position.clone();
    this.history = new Int32Array(KEY_WORDS * 64);
    this.length = 0;
    this.buffer = new Int32Array(MOVE_STRIDE);
    this.record();
    /** How many times the current position has occurred. */
    this.repetitions = 1;
    /** Plies played since the first position. */
    this.ply = 0;
    /** The two flags "may still mate" (ladder.js), climbing the game's rungs (the Domino search
        only at the end with dominoAtEnd). */
    this.flags = new Flags({ rungs: this.dominoAtEnd ? 2 : rungs });
  }
  /** The ply at which each side was proven unable to mate; -1 while its flag is up (this.flags). */
  get whiteDownAt() { return this.flags.whiteDownAt; }
  set whiteDownAt(ply) { this.flags.whiteDownAt = ply; }
  get blackDownAt() { return this.flags.blackDownAt; }
  set blackDownAt(ply) { this.flags.blackDownAt = ply; }
  /** The ply whose position the flags were last brought up to date for; -1 before the first. */
  get flagsPly() { return this.flags.updatedPly; }
  set flagsPly(ply) { this.flags.updatedPly = ply; }
  /** Has `color` been proven unable to mate, for the rest of the game? */
  neverMates(color) { return this.flags.neverMates(color); }
  /** Climbs the ladder for each side whose flag is still up, once per position (Flags.update). */
  updateFlags() { this.flags.update(this.position, this.ply); }
  record() {
    if ((this.length + 1) * KEY_WORDS > this.history.length) {
      const grown = new Int32Array(this.history.length * 2);
      grown.set(this.history);
      this.history = grown;
    }
    writeKey(this.position, this.history, this.length * KEY_WORDS);
    this.length++;
  }
  countRepetitions() {
    const h = this.history, last = (this.length - 1) * KEY_WORDS;
    const reach = Math.min(this.position.halfmove, this.length - 1);
    let count = 1;
    for (let back = 2; back <= reach; back += 2)
      if (keysEqual(h, last - back * KEY_WORDS, h, last)) count++;
    return count;
  }
  legalMoves() { return legalMoves(this.position); }
  /** Plays a legal move and returns the game status after it. */
  play(from, to, promotion = QUEEN) {
    checkPromotion(promotion);
    const move = findLegalMove(this.position, from, to, this.buffer);
    if (move < 0) fail('illegal move ' + squareName(from) + squareName(to));
    doMove(this.position, move, promotion);
    this.position.undoTop = 0;
    this.ply++;
    this.record();
    this.repetitions = this.countRepetitions();
    return this.status();
  }
  /** The game status of the current position; brings the flags up to date. */
  status() { return gameStatus(this.position, { repetitions: this.repetitions, memory: this }); }
  /** The draws a player may claim in the current position (Claim bits): the 50-move rule from the
      game's claimMoves, threefold repetition from its claimRepetition. Whether the game is still
      on is status()'s to say. */
  claimable() {
    return (this.claimMoves && this.position.halfmove >= this.claimMoves ? Claim.FIFTY_MOVES : 0) |
           (this.claimRepetition && this.repetitions >= this.claimRepetition ? Claim.THREEFOLD : 0);
  }
  /** The verdict if `side`'s flag falls now, or `side` resigns: read from the opponent's flag
      (with dominoAtEnd, the Domino search runs now if the flag is still up). */
  flagVerdict(side, { resigned = false } = {}) {
    this.updateFlags();
    let draw = this.neverMates(side ^ WHITE);
    if (!draw && this.dominoAtEnd) draw = proveCannotBeMated(this.position, side).proven;
    return verdictCode(side, draw, resigned);
  }
}
