/*!
 * Mateless — can this side still mate? Static proofs and a short search for FIDE's dead position
 * (5.2.2), flag fall (6.9) and resignation (5.1.2).
 *
 * After every move Mateless climbs a ladder for each side: the material test, the lock detector,
 * then a short helpmate search of 6 plies and 100 nodes (the Domino search). A side proven unable
 * to mate keeps that flag for the rest of the game; a flag fall is judged from the flags, with
 * nothing to compute. It never declares a draw where a mate is possible: it acts only on a proof,
 * and what it cannot prove it leaves to a complete solver.
 *
 * The source is in layers, one ES module each (src/); tools/build.js joins them into mateless.js,
 * one dependency-free file. Mateless itself, what this library adds:
 *   material.js   rung 1: the material test
 *   lock.js       rung 2: the lock detector, and the two static tests together
 *   domino.js     rung 3: the Domino search
 *   ladder.js     when each rung is asked, and the two flags a game keeps
 * Around it, so that it runs on its own:
 *   board.js      a reference board: bitboards, magic bitboards, legal moves, FEN (standard
 *                 techniques; a platform may keep its own board)
 *   game.js       a reference game: results, repetitions, the 75-move rule, fivefold repetition
 *
 * What Mateless needs from a board (each layer's imports say it exactly):
 *   material test, lock detector   the piece sets and the en passant square; no move generation
 *   Domino search                  legal moves, made and taken back in place, an exact code of a
 *                                  position, and "is there a legal move?"
 *   flags                          the halfmove clock and the en passant square, which say when
 *                                  the static tests can have changed
 * No rule of the move counters (50 or 75 moves, repetitions) takes part in a proof: those rules
 * only cut lines short, so leaving them out can cost a proof but never make a false one.
 *
 * Notes on porting. The engine keeps module state that every call shares: the lock detector's
 * census and the sets its mating net reads (lock.js), the shared move-generation context
 * (SHARED_CONTEXT, with targetsLo/targetsHi, board.js) and the shared Domino search (ladder.js).
 * JavaScript runs one call at a time, so that is safe here; a port to a language with threads
 * (Scala on the JVM, for one) must give each thread, or each game, its own copies. Nothing else
 * is shared: a Game holds its own history and flags.
 *
 * Works as a classic <script> (it defines globalThis.Mateless) and as a Node module; the sources
 * are ES modules (import from src/index.js).
 * MIT License, © 2026 Cüneyt İnan. https://github.com/cuneytinann/Mateless
 */

import { BISHOP, BLACK, castlingField, CastlingFiles, chess960Arrangement, colorOf, doMove,
         enemyAttacks, EngineError, fileOf, FLAG_CASTLE, FLAG_DOUBLE, FLAG_EP, FLAG_PROMO, fromFen,
         generateLegalMoves, hashKey, hasLegalMove, inCheck, isAttacked, KEY_WORDS, KING, KNIGHT,
         legalMoves, makeMove, MOVE_STRIDE, NO_SQUARE, opponent, parseSquare, PAWN, perft,
         PIECE_LETTERS, Position, positionKey, PROMOTION_ORDER, QUEEN, rankOf, ROOK,
         SHARED_CONTEXT, squareName, STANDARD_SKELETON, toFen, typeOf, undoMove, WHITE, writeKey } from './board.js';
import { materialCannotMate, materialTest } from './material.js';
import { cannotMate, cannotMate2, FLAGGED_BLACK, FLAGGED_WHITE, lockCannotMate, lockSets, lockTest, lockTest2 } from './lock.js';
import { DOMINO_BUDGET, DOMINO_PLY, Domino, PositionSet } from './domino.js';
import { Flags, isDeadPosition, proveBoth, proveCannotBeMated } from './ladder.js';
import { flagVerdict, Game, gameStatus, Result, RESULT_NAMES } from './game.js';

// The public API (tools/build.js turns this list into the object mateless.js returns).
export {
  // constants
  WHITE, BLACK, PAWN, KING, QUEEN, KNIGHT, ROOK, BISHOP, NO_SQUARE, PROMOTION_ORDER,
  PIECE_LETTERS, RESULT_NAMES, Result, STANDARD_SKELETON,
  // squares and pieces
  fileOf, rankOf, squareName, parseSquare, colorOf, typeOf, opponent,
  // positions and moves
  EngineError, CastlingFiles, Position, fromFen, toFen, castlingField, chess960Arrangement,
  isAttacked, inCheck, makeMove, legalMoves, hasLegalMove, perft, positionKey,
  // the arbiter
  materialCannotMate, lockCannotMate, cannotMate, FLAGGED_WHITE, FLAGGED_BLACK, cannotMate2,
  DOMINO_PLY, DOMINO_BUDGET, Domino, proveCannotBeMated, proveBoth, isDeadPosition, Flags, gameStatus, flagVerdict, Game,
};
// internals exposed for tests
export const _internal = Object.freeze({ generateLegalMoves, doMove, undoMove, writeKey, hashKey, PositionSet, enemyAttacks, hasLegalMove, materialTest,
                                         lockTest, lockTest2, lockSets, SHARED_CONTEXT,
                                         FLAG_CASTLE, FLAG_EP, FLAG_DOUBLE, FLAG_PROMO, MOVE_STRIDE, KEY_WORDS });
