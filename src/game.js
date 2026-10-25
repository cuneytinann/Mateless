/* ═══ Mateless · game.js — a reference game: results, repetitions, the move rules ═════════════

   What the ladder's answers mean for the result of a game, and the endings that need no claim:
   checkmate, stalemate, a dead position (both flags down), the 75-move rule and fivefold
   repetition. Claims (threefold repetition, the 50-move rule) and agreed draws are left to the
   platform, which has the repetition count and the halfmove clock to decide them.
     repetition    a game keeps an exact code of every position and counts repetitions by looking
                   back only over the moves since the last capture or pawn move, every other ply
                   (the side to move must match). */

import { BLACK, checkPromotion, doMove, fail, findLegalMove, hasLegalMove, KEY_WORDS, keysEqual,
         legalMoves, MOVE_STRIDE, QUEEN, SHARED_CONTEXT, squareName, WHITE, writeKey } from './board.js';
import { cannotMate } from './lock.js';
import { DOMINO_BUDGET, DOMINO_PLY } from './domino.js';
import { Flags, isDeadPosition, proveCannotBeMated } from './ladder.js';

/* The twelve results the engine decides, as it numbers them; 0 means the game goes on.
     the board ends the game         1, 2 checkmate; 3 stalemate; 4 the 75-move rule; 5 fivefold
                                     repetition (FIDE 9.6); 6 a dead position (FIDE 5.2.2)
     a flag falls (FIDE 6.9)         7, 8 a win on time; 11 a draw: the opponent can never mate
     a side resigns (FIDE 5.1.2)     9, 10 a win; 12 a draw: the opponent can never mate
   RESULT_NAMES gives each one in words. Draws that need a claim (threefold repetition, FIDE 9.2;
   the 50-move rule, 9.3) or an agreement are the platform's to decide: a Game counts repetitions
   and every position keeps its halfmove clock. */
export const RESULT_NAMES = Object.freeze(['ongoing', 'white checkmates', 'black checkmates', 'stalemate', '75-move rule', 'fivefold repetition', 'dead position', 'white wins on time', 'black wins on time', 'white wins by resignation', 'black wins by resignation', 'draw on time', 'draw on resignation']);
export const Result = Object.freeze({
  NONE: 0,
  WHITE_MATES: 1, BLACK_MATES: 2, STALEMATE: 3,
  SEVENTY_FIVE_MOVES: 4, FIVEFOLD: 5, DEAD_POSITION: 6,
  WHITE_ON_TIME: 7, BLACK_ON_TIME: 8, WHITE_BY_RESIGNATION: 9, BLACK_BY_RESIGNATION: 10,
  DRAW_ON_TIME: 11, DRAW_ON_RESIGNATION: 12,
});


/** How the game stands: checkmate, stalemate, dead position, fivefold repetition,
    the 75-move rule, in that order: the endings that need no claim. Returns a Result code, 0
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
  let dead;
  if (memory) { memory.updateFlags(); dead = memory.neverMates(WHITE) && memory.neverMates(BLACK); }
  else if (deadPositionSearch) dead = isDeadPosition(pos);
  else dead = cannotMate(pos, WHITE) && cannotMate(pos, BLACK);
  if (dead) return Result.DEAD_POSITION;
  if (repetitions >= 5) return Result.FIVEFOLD;
  if (pos.halfmove >= 150) return Result.SEVENTY_FIVE_MOVES;
  return Result.NONE;
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
    to move. */
export class Game {
  constructor(position) {
    this.position = position.clone();
    this.history = new Int32Array(KEY_WORDS * 64);
    this.length = 0;
    this.buffer = new Int32Array(MOVE_STRIDE);
    this.record();
    /** How many times the current position has occurred. */
    this.repetitions = 1;
    /** Plies played since the first position. */
    this.ply = 0;
    /** The two flags "may still mate" (ladder.js). */
    this.flags = new Flags();
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
  /** The verdict if `side`'s flag falls now, or `side` resigns: read from the opponent's flag. */
  flagVerdict(side, { resigned = false } = {}) {
    this.updateFlags();
    return verdictCode(side, this.neverMates(side ^ WHITE), resigned);
  }
}
