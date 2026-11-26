// mateless.js is built from src/ by tools/build.js: edit the sources there, then run
// node tools/build.js (and node tools/embed-engine.js for the page).
/*!
 * Mateless — can this side still mate? Static proofs and a short search for FIDE's dead position
 * (5.2.2), flag fall (6.9) and resignation (5.1.2).
 *
 * After every move Mateless climbs a ladder for each side: the material test, the lock detector,
 * then a short helpmate search of 3 plies and 10 nodes (the Domino search). A side proven unable
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
 *   fen.js        reading a FEN into a position some game can reach: it puts right what can be
 *                 read only one way and refuses what no game reaches (the outer layer; the
 *                 rungs never call it)
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
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Mateless = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
'use strict';

/* ═══ Mateless · board.js — the reference board ═════════════════════════════════════════════

   Everything Mateless stands on and nothing it adds: pieces, bitboards, magic bitboards, legal
   move generation, moves made and taken back in place, the exact code of a position, FEN. These
   are standard techniques (the Chess Programming Wiki describes each); a platform with a board of
   its own keeps it, and gives each Mateless layer what that layer imports from here.

   Each part uses the fastest method known for it:
     board          a 64-square mailbox plus bitboards held as two 32-bit words, which
                    JavaScript computes on in its integer fast path;
     sliders        magic bitboards: the attacks of a rook or bishop (a queen is both) are one
                    table lookup, indexed by a multiply of each 32-bit half of the occupancy;
     legality       legal moves are generated directly from the checking pieces and the pinned
                    pieces, so no move has to be played and taken back to test it; only
                    en passant and castling are tested by computing the position after them;
     king moves     the squares the enemy attacks are computed once, as whole sets;
     moves          made and unmade in place, with an undo stack;
     mate/stalemate "is there a legal move?" stops at the first one: out of check a pawn's push,
                    a knight's step or a slider's ray first, then the king, then the rest;
     en passant     the square is kept only when a legal capture onto it exists, tested only
                    after a double step and only for the pawns beside it;
     50/75 moves    the halfmove clock, kept with every move and restored with every take-back;
     identity       an exact 9-word code of a position, and a 32-bit hash of it. */

// ═══════════════════════════════════════════════════════════════════════════════════════
// 1. Pieces, colours, squares
// ═══════════════════════════════════════════════════════════════════════════════════════

/* A piece is colour | type: black pieces are 1..6, white
   pieces 9..14, and 0 is an empty square. Codes 0 and 8 are no piece; the bitboard arrays use
   those two slots for all black and all white pieces. */
const BLACK = 0;
const WHITE = 8;
const PAWN = 1, KING = 2, QUEEN = 3, KNIGHT = 4, ROOK = 5, BISHOP = 6;

/** The order in which the search tries the four promotions. */
const PROMOTION_ORDER = Object.freeze([QUEEN, ROOK, BISHOP, KNIGHT]);

/** Index = piece code; ' ' marks codes that are no piece. */
const PIECE_LETTERS = ' pkqnrb  PKQNRB';

const NO_SQUARE = -1;

/* Squares: a1 = 0, b1 = 1, …, h1 = 7, a2 = 8, …, h8 = 63. */
const fileOf = sq => sq & 7;
const rankOf = sq => sq >> 3;
const squareName = sq => 'abcdefgh'[sq & 7] + ((sq >> 3) + 1);
function parseSquare(text) {
  return /^[a-h][1-8]$/.test(text) ? (text.charCodeAt(0) - 97) + 8 * (text.charCodeAt(1) - 49) : NO_SQUARE;
}
const colorOf = piece => piece & WHITE;
const typeOf = piece => piece & 7;
const opponent = color => color ^ WHITE;

/** Thrown when the engine meets a state it must never be in. It never fails silently. */
class EngineError extends Error {}
function fail(message) { throw new EngineError(message); }

// ═══════════════════════════════════════════════════════════════════════════════════════
// 2. Bitboards as two 32-bit words
// ═══════════════════════════════════════════════════════════════════════════════════════

/* A set of squares is held in two int32 words: lo for squares 0..31 (ranks 1-4) and hi for
   squares 32..63 (ranks 5-8). Bitwise operators in JavaScript work on exactly 32 bits, so a
   set is always handled as such a pair. Words are only compared with 0 or with each other,
   so their sign never matters.

   Moving a set east or west never carries a bit from one word to the other: the bit would
   land on a file the file masks clear anyway. Only vertical shifts carry bits between the
   words; a bit shifted past the 8th or 1st rank falls off the board. */
const NOT_FILE_A = ~0x01010101;
const NOT_FILE_H = ~(0x80808080 | 0);
const NOT_FILE_AB = ~0x03030303;
const NOT_FILE_GH = ~(0xc0c0c0c0 | 0);
const RANK_1 = 0x000000ff;            // in the lo word
const RANK_8 = 0xff000000 | 0;        // in the hi word
const DARK_SQUARES = 0xaa55aa55 | 0;  // the same pattern in both words; a1 is dark

/** The single-square sets: SQ_LO[sq] | SQ_HI[sq] is the bit of sq, one of the two is 0. */
const SQ_LO = new Int32Array(64), SQ_HI = new Int32Array(64);
for (let sq = 0; sq < 64; sq++) { if (sq < 32) SQ_LO[sq] = 1 << sq; else SQ_HI[sq] = 1 << (sq - 32); }

/** Both horizontal neighbours of every square of one word. */
const sideways = w => ((w << 1) & NOT_FILE_A) | ((w >>> 1) & NOT_FILE_H);
/** Two files east and west of every square of one word. */
const sideways2 = w => ((w << 2) & NOT_FILE_AB) | ((w >>> 2) & NOT_FILE_GH);
/** One rank up / down: each returns one word of the shifted set. */
const northLo = lo => lo << 8;
const northHi = (lo, hi) => (hi << 8) | (lo >>> 24);
const southLo = (lo, hi) => (lo >>> 8) | (hi << 24);
const southHi = hi => hi >>> 8;
/** Every square of the set together with its eight neighbours (the king's zone). */
function zoneLo(lo, hi) { const v = lo | (lo << 8) | (lo >>> 8) | (hi << 24); return v | sideways(v); }
function zoneHi(lo, hi) { const v = hi | (hi << 8) | (lo >>> 24) | (hi >>> 8); return v | sideways(v); }
/** The four diagonal neighbours of every square of the set. */
const diagonalLo = (lo, hi) => sideways((lo << 8) | (lo >>> 8) | (hi << 24));
const diagonalHi = (lo, hi) => sideways((hi << 8) | (lo >>> 24) | (hi >>> 8));

/** Index of the lowest set bit of a non-zero word. */
const lowestBit = w => 31 - Math.clz32(w & -w);
function popcount(w) {
  w -= (w >>> 1) & 0x55555555;
  w = (w & 0x33333333) + ((w >>> 2) & 0x33333333);
  return Math.imul((w + (w >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24;
}
/** Does the set have exactly one square? */
const isSingle = (lo, hi) => (lo ? hi === 0 && (lo & (lo - 1)) === 0 : hi !== 0 && (hi & (hi - 1)) === 0);
/** The lowest square of a non-empty set. */
const firstSquare = (lo, hi) => (lo ? lowestBit(lo) : 32 + lowestBit(hi));

/* Step tables: for each square, the set of squares one step away. Stored flat:
   table[2 * sq] is the lo word, table[2 * sq + 1] the hi word. */
function stepTable(steps) {
  const table = new Int32Array(128);
  for (let sq = 0; sq < 64; sq++) {
    for (const [df, dr] of steps) {
      const f = fileOf(sq) + df, r = rankOf(sq) + dr;
      if (f < 0 || f > 7 || r < 0 || r > 7) continue;
      const to = 8 * r + f;
      table[2 * sq] |= SQ_LO[to];
      table[2 * sq + 1] |= SQ_HI[to];
    }
  }
  return table;
}
const KNIGHT_STEPS = stepTable([[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]]);
const KING_STEPS = stepTable([[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]]);
/** The squares a pawn of each colour attacks from each square. */
const WHITE_PAWN_ATTACKS = stepTable([[-1, 1], [1, 1]]);
const BLACK_PAWN_ATTACKS = stepTable([[-1, -1], [1, -1]]);

/** BETWEEN[2 * (64 * a + b)] (and + 1): the squares strictly between a and b when they share a
    rank, file or diagonal; empty otherwise. LINE: the whole line through a and b, edge to edge. */
const BETWEEN = new Int32Array(64 * 64 * 2), LINE = new Int32Array(64 * 64 * 2);
for (let a = 0; a < 64; a++) {
  for (let b = 0; b < 64; b++) {
    const df = fileOf(b) - fileOf(a), dr = rankOf(b) - rankOf(a);
    if (a === b || (df && dr && Math.abs(df) !== Math.abs(dr))) continue;
    const sf = Math.sign(df), sr = Math.sign(dr), i = 2 * (64 * a + b);
    for (let f = fileOf(a) + sf, r = rankOf(a) + sr; f !== fileOf(b) || r !== rankOf(b); f += sf, r += sr) {
      BETWEEN[i] |= SQ_LO[8 * r + f];
      BETWEEN[i + 1] |= SQ_HI[8 * r + f];
    }
    for (const s of [1, -1])
      for (let f = fileOf(a), r = rankOf(a); f >= 0 && f < 8 && r >= 0 && r < 8; f += s * sf, r += s * sr) {
        LINE[i] |= SQ_LO[8 * r + f];
        LINE[i + 1] |= SQ_HI[8 * r + f];
      }
  }
}

/* ─── Magic bitboards for rooks and bishops ───────────────────────────────────────────

   The squares a rook (or bishop) attacks from sq depend only on which "relevant" squares are
   occupied: those on its rays, without the last square of each ray. For each square a magic
   pair (mLo, mHi) maps every occupancy of the relevant squares to a slot of that square's
   table:  index = (imul(occLo & maskLo, mLo) ^ imul(occHi & maskHi, mHi)) >>> (32 - bits).
   This is the 32-bit form of magic bitboards: two 32-bit multiplies instead of one 64-bit one.
   The numbers below were found by random search. The tables are built when the engine loads,
   and building them checks every occupancy: if two occupancies with different attacks met in
   one slot, the engine would refuse to load. */
const ROOK_MAGICS = Int32Array.from([
  -1853865952, 4196480, 12,  -2143272928, 1074008064, 11,  2099236, 570437760, 11,  1141375108, 79757320, 11,
  1107299330, 1150459908, 11,  136318977, 655392, 11,  1350598738, 134254848, 11,  541066273, 536904768, 12,
  25182240, -2147432320, 11,  285483024, 541327659, 10,  92282884, 277610656, 10,  268444168, 302252064, 10,
  32788, 8521728, 10,  33570881, 402432, 10,  285344002, -2147415804, 10,  1073774593, 16512, 11,
  4554880, 4196385, 11,  1074790464, 12591186, 10,  553654304, 19399744, 10,  83918978, -1476356864, 10,
  1627523080, 272663808, 10,  524802, 1107824708, 10,  5634, 1761739080, 10,  18092545, 17409, 11,
  65666, 1375936840, 11,  33025, 2113600, 10,  134414357, 4726785, 10,  135690, 1107370050, 10,
  8389649, 604504352, 10,  1208090690, -1072692216, 10,  67174401, 33588226, 10,  -1878753214, -1862236671, 11,
  671159648, 1090551808, 11,  4292651, 1082146824, 10,  4718768, 807404547, 10,  1605904, 545261568, 10,
  269587464, 16778496, 10,  75778, -1577057260, 10,  304130, 100672777, 10,  153092161, 541087872, 11,
  25166112, 37765120, 11,  4325856, -2134867840, 10,  196640, 1078001745, 10,  201335816, 285221378, 10,
  525380, 33570820, 10,  67110919, 264224, 10,  75563014, 65540, 10,  536921089, 536903808, 11,
  143655202, 1078231104, 11,  1067537, 270565888, 10,  -2146955260, 27264032, 10,  131364, 1052704, 10,
  8390708, -1069456383, 10,  1314881, 159653904, 10,  34116097, 262400, 10,  33563201, 3309632, 11,
  -1870626558, 34883746, 12,  -2146843494, 145031234, 11,  65568, -2143143915, 11,  51445776, 270345, 11,
  536882182, 67637250, 11,  268599812, 589825, 11,  -2139060731, 696833, 11,  1082806359, 1358962817, 12,
]);
const BISHOP_MAGICS = Int32Array.from([
  537468936, 8396928, 6,  -2146815988, 138690560, 5,  19136788, 3211264, 5,  2230786, 570511872, 5,
  405015584, 134742016, 5,  117719304, 1103626240, 5,  33604136, 1145045028, 5,  16847169, 68173920, 6,
  4725776, -2125967104, 5,  -1342168060, 339771432, 5,  33558532, -796906624, 5,  150996100, 545292296, 5,
  1107297794, 1208484096, 5,  16649, 1480601600, 5,  88096904, 1212289024, 5,  2171140, 33720836, 5,
  807403593, -1996291808, 5,  163848, 673710512, 5,  268994628, -737132536, 7,  -2010906614, -1072680960, 7,
  570695714, -2107113454, 7,  536938498, 134415396, 7,  -2146824124, -2129065984, 5,  18892801, 83985408, 5,
  8536064, 537399808, 5,  5310466, 336068768, 5,  -2147220992, -2071911424, 7,  68232192, 16793988, 9,
  1077977121, 68427776, 9,  591880, 4460577, 7,  6326400, 352604416, 5,  33685632, 298058116, 5,
  1145247936, 537399364, 5,  67668036, 2106432, 5,  -905641724, -2145370048, 7,  1160, 1057344, 9,
  -2142224124, 278592, 9,  197649, 20465936, 7,  346194050, 263809, 5,  132113, 538984512, 5,
  33820692, -1877998520, 5,  49672, 571081928, 5,  -2130702196, 16786432, 7,  131138, 46137856, 7,
  25167897, 541066240, 7,  807404290, 33564808, 7,  1244659976, 813703491, 5,  -2137775934, 113247364, 5,
  411174416, -1970765696, 5,  98369, 77594752, 5,  1048658, 139526912, 5,  5382167, 167904256, 5,
  71958547, 167911552, 5,  4264976, 36046848, 5,  67375110, 402849920, 5,  202387457, -1781366528, 5,
  8454210, 33636368, 6,  19006084, 589369476, 5,  571738113, 1082282240, 5,  16, 1082393604, 5,
  277217792, 1074594568, 5,  -2140651000, 810877440, 5,  17831200, -1744492480, 5,  -1541111280, 571499072, 6,
]);

/* The rays of the eight directions on an empty board, used to build the magic tables:
   RAY_LO[64 * d + sq]. Directions 0-3 run towards higher squares (E, N, NE, NW), 4-7 towards
   lower ones (W, S, SW, SE), so the nearest blocker is the lowest or the highest bit. */
const DIRECTIONS = [1, 0, 0, 1, 1, 1, -1, 1, -1, 0, 0, -1, -1, -1, 1, -1];
const RAY_LO = new Int32Array(8 * 64), RAY_HI = new Int32Array(8 * 64);
for (let d = 0; d < 8; d++)
  for (let sq = 0; sq < 64; sq++)
    for (let f = fileOf(sq) + DIRECTIONS[2 * d], r = rankOf(sq) + DIRECTIONS[2 * d + 1]; f >= 0 && f < 8 && r >= 0 && r < 8;
         f += DIRECTIONS[2 * d], r += DIRECTIONS[2 * d + 1]) {
      RAY_LO[64 * d + sq] |= SQ_LO[8 * r + f];
      RAY_HI[64 * d + sq] |= SQ_HI[8 * r + f];
    }

function buildSliderTable(directions, magics, name) {
  const maskLo = new Int32Array(64), maskHi = new Int32Array(64);
  const magicLo = new Int32Array(64), magicHi = new Int32Array(64);
  const shift = new Int32Array(64), base = new Int32Array(64);
  let total = 0;
  for (let sq = 0; sq < 64; sq++) { base[sq] = total; total += 1 << magics[3 * sq + 2]; }
  const attackLo = new Int32Array(total), attackHi = new Int32Array(total), filled = new Uint8Array(total);
  // Per direction, every occupancy of its ray's relevant squares with the attacks it leaves:
  // a ray's attacks depend only on its own squares, so a whole occupancy is one entry per ray.
  const parts = directions.map(() => ({ count: 0, oLo: new Int32Array(64), oHi: new Int32Array(64), aLo: new Int32Array(64), aHi: new Int32Array(64) }));
  for (let sq = 0; sq < 64; sq++) {
    let mLo = 0, mHi = 0, relevantCount = 0;
    directions.forEach((d, k) => {
      const i = 64 * d + sq, part = parts[k];
      // the relevant squares of the ray: all but its last (edge) square
      let rLo = RAY_LO[i], rHi = RAY_HI[i];
      if (rLo | rHi) {
        const last = d < 4 ? (rHi ? 63 - Math.clz32(rHi) : 31 - Math.clz32(rLo)) : firstSquare(rLo, rHi);
        rLo &= ~SQ_LO[last]; rHi &= ~SQ_HI[last];
      }
      mLo |= rLo; mHi |= rHi; relevantCount += popcount(rLo) + popcount(rHi);
      // every subset of them, by the carry-rippler: next = (subset - mask) & mask, on 64 bits
      let oLo = 0, oHi = 0, n = 0;
      do {
        let aLo = RAY_LO[i], aHi = RAY_HI[i];
        const bLo = aLo & oLo, bHi = aHi & oHi;
        if (bLo | bHi) {   // cut the ray behind its nearest blocker
          const s = d < 4 ? firstSquare(bLo, bHi) : (bHi ? 63 - Math.clz32(bHi) : 31 - Math.clz32(bLo));
          aLo ^= RAY_LO[64 * d + s]; aHi ^= RAY_HI[64 * d + s];
        }
        part.oLo[n] = oLo; part.oHi[n] = oHi; part.aLo[n] = aLo; part.aHi[n] = aHi; n++;
        const tLo = ((oLo | ~rLo) >>> 0) + 1, carry = tLo > 0xffffffff ? 1 : 0;
        oLo = tLo & rLo;
        oHi = (((oHi | ~rHi) >>> 0) + carry) & rHi;
      } while (oLo | oHi);
      part.count = n;
    });
    const bits = magics[3 * sq + 2];
    if (bits < relevantCount || bits > 12) fail(name + ' magic for ' + squareName(sq) + ' has too few index bits');
    maskLo[sq] = mLo; maskHi[sq] = mHi;
    const mgLo = magicLo[sq] = magics[3 * sq], mgHi = magicHi[sq] = magics[3 * sq + 1];
    const sh = shift[sq] = 32 - bits, b0 = base[sq];
    const [p0, p1, p2, p3] = parts;
    for (let a = 0; a < p0.count; a++)
      for (let b = 0; b < p1.count; b++)
        for (let c = 0; c < p2.count; c++)
          for (let e = 0; e < p3.count; e++) {
            const oLo = p0.oLo[a] | p1.oLo[b] | p2.oLo[c] | p3.oLo[e], oHi = p0.oHi[a] | p1.oHi[b] | p2.oHi[c] | p3.oHi[e];
            const aLo = p0.aLo[a] | p1.aLo[b] | p2.aLo[c] | p3.aLo[e], aHi = p0.aHi[a] | p1.aHi[b] | p2.aHi[c] | p3.aHi[e];
            const index = b0 + ((Math.imul(oLo, mgLo) ^ Math.imul(oHi, mgHi)) >>> sh);
            if (filled[index]) {
              if (attackLo[index] !== aLo || attackHi[index] !== aHi) fail(name + ' magic for ' + squareName(sq) + ' collides');
            } else {
              filled[index] = 1; attackLo[index] = aLo; attackHi[index] = aHi;
            }
          }
  }
  return { maskLo, maskHi, magicLo, magicHi, shift, base, attackLo, attackHi };
}
const ROOK_TABLE = buildSliderTable([0, 1, 4, 5], ROOK_MAGICS, 'rook');           // E, N, W, S
const BISHOP_TABLE = buildSliderTable([2, 3, 6, 7], BISHOP_MAGICS, 'bishop');     // NE, NW, SW, SE

const R_MASK_LO = ROOK_TABLE.maskLo, R_MASK_HI = ROOK_TABLE.maskHi, R_MAGIC_LO = ROOK_TABLE.magicLo,
      R_MAGIC_HI = ROOK_TABLE.magicHi, R_SHIFT = ROOK_TABLE.shift, R_BASE = ROOK_TABLE.base;
const B_MASK_LO = BISHOP_TABLE.maskLo, B_MASK_HI = BISHOP_TABLE.maskHi, B_MAGIC_LO = BISHOP_TABLE.magicLo,
      B_MAGIC_HI = BISHOP_TABLE.magicHi, B_SHIFT = BISHOP_TABLE.shift, B_BASE = BISHOP_TABLE.base;
/** The rook attacks from sq are ROOK_LO[i], ROOK_HI[i] with i = rookIndex(sq, occupancy). */
const ROOK_LO = ROOK_TABLE.attackLo, ROOK_HI = ROOK_TABLE.attackHi;
const BISHOP_LO = BISHOP_TABLE.attackLo, BISHOP_HI = BISHOP_TABLE.attackHi;
function rookIndex(sq, occLo, occHi) {
  return R_BASE[sq] + ((Math.imul(occLo & R_MASK_LO[sq], R_MAGIC_LO[sq]) ^ Math.imul(occHi & R_MASK_HI[sq], R_MAGIC_HI[sq])) >>> R_SHIFT[sq]);
}
function bishopIndex(sq, occLo, occHi) {
  return B_BASE[sq] + ((Math.imul(occLo & B_MASK_LO[sq], B_MAGIC_LO[sq]) ^ Math.imul(occHi & B_MASK_HI[sq], B_MAGIC_HI[sq])) >>> B_SHIFT[sq]);
}
/** The rays of a rook and a bishop on an empty board, used to find pinning pieces. */
const ROOK_EMPTY_LO = new Int32Array(64), ROOK_EMPTY_HI = new Int32Array(64);
const BISHOP_EMPTY_LO = new Int32Array(64), BISHOP_EMPTY_HI = new Int32Array(64);
for (let sq = 0; sq < 64; sq++) {
  const r = rookIndex(sq, 0, 0), b = bishopIndex(sq, 0, 0);
  ROOK_EMPTY_LO[sq] = ROOK_LO[r]; ROOK_EMPTY_HI[sq] = ROOK_HI[r];
  BISHOP_EMPTY_LO[sq] = BISHOP_LO[b]; BISHOP_EMPTY_HI[sq] = BISHOP_HI[b];
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// 3. Castling files
// ═══════════════════════════════════════════════════════════════════════════════════════

/* Every game castles by Chess960 rules: the king moves onto its own rook, and ends on the g- or
   c-file with the rook beside it on the f- or d-file. Which files hold the castling king and
   rooks is fixed for the whole game by its starting arrangement, the skeleton: eight digits,
   one per file, where 3 marks the king, 1 the king-side rook, 2 the queen-side rook and 0
   anything else. Standard chess is "20003001".

   Castling rights are four bits: 1 White king-side, 2 White queen-side, 4 Black king-side,
   8 Black queen-side. rightsAt[sq] holds the rights that are lost for good when any piece
   leaves sq or lands on it: on the first rank the skeleton digit itself, on the eighth rank the
   digit shifted by two, elsewhere nothing. */
const STANDARD_SKELETON = '20003001';
class CastlingFiles {
  constructor(skeleton = STANDARD_SKELETON) {
    if (!/^[0-3]{8}$/.test(skeleton)) fail('invalid castling skeleton: ' + skeleton);
    this.skeleton = skeleton;
    this.rightsAt = new Uint8Array(64);
    for (let file = 0; file < 8; file++) {
      this.rightsAt[file] = +skeleton[file];
      this.rightsAt[56 + file] = +skeleton[file] << 2;
    }
  }
  get isStandard() { return this.skeleton === STANDARD_SKELETON; }
}
const STANDARD_FILES = new CastlingFiles();

// ═══════════════════════════════════════════════════════════════════════════════════════
// 4. Position
// ═══════════════════════════════════════════════════════════════════════════════════════

/* One undo record: the move, the piece that moved, the piece it captured, the castling rights
   and en passant square before it; the halfmove clock is kept beside, in a Float64Array. */
const UNDO_STRIDE = 5;
const NO_UNDO = new Int32Array(0), NO_UNDO_HALFMOVE = new Float64Array(0);

class Position {
  constructor(castlingFiles = STANDARD_FILES) {
    /** The piece on each square, 0 when empty. */
    this.board = new Uint8Array(64);
    /** Bitboard words by piece code: lo[piece] / hi[piece] hold the squares of that piece;
        lo[BLACK] = lo[0] all black pieces, lo[WHITE] = lo[8] all white pieces. */
    this.lo = new Int32Array(16);
    this.hi = new Int32Array(16);
    /** WHITE or BLACK: the side to move. */
    this.side = WHITE;
    /** Castling rights, see CastlingFiles. */
    this.castling = 0;
    /** The en passant square, kept only while a legal capture onto it exists. */
    this.ep = NO_SQUARE;
    /** Half-moves since the last capture or pawn move. */
    this.halfmove = 0;
    this.castlingFiles = castlingFiles;
    /** The undo stack of moves made in place; it is allocated by the first move and grows as
        needed. */
    this.undo = NO_UNDO;
    this.undoHalfmove = NO_UNDO_HALFMOVE;
    this.undoTop = 0;
  }

  /** Copies the position (not its undo stack, which starts empty). */
  copyFrom(other) {
    this.board.set(other.board);
    this.lo.set(other.lo);
    this.hi.set(other.hi);
    this.side = other.side;
    this.castling = other.castling;
    this.ep = other.ep;
    this.halfmove = other.halfmove;
    this.castlingFiles = other.castlingFiles;
    this.undoTop = 0;
    return this;
  }

  clone() { return new Position(this.castlingFiles).copyFrom(this); }

  put(sq, piece) {
    if (this.board[sq]) fail('put: square ' + squareName(sq) + ' is occupied');
    if (!PIECE_LETTERS[piece] || PIECE_LETTERS[piece] === ' ') fail('put: no piece has code ' + piece);
    this.board[sq] = piece;
    this.lo[piece] |= SQ_LO[sq]; this.hi[piece] |= SQ_HI[sq];
    this.lo[piece & WHITE] |= SQ_LO[sq]; this.hi[piece & WHITE] |= SQ_HI[sq];
  }

  remove(sq) {
    const piece = this.board[sq];
    if (!piece) fail('remove: square ' + squareName(sq) + ' is empty');
    this.board[sq] = 0;
    this.lo[piece] &= ~SQ_LO[sq]; this.hi[piece] &= ~SQ_HI[sq];
    this.lo[piece & WHITE] &= ~SQ_LO[sq]; this.hi[piece & WHITE] &= ~SQ_HI[sq];
  }

  /** The square of the king of `color`. */
  kingSquare(color) {
    const lo = this.lo[color | KING];
    if (lo) return lowestBit(lo);
    const hi = this.hi[color | KING];
    if (hi) return 32 + lowestBit(hi);
    return fail('no ' + (color === WHITE ? 'white' : 'black') + ' king on the board');
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// 5. Attacks
// ═══════════════════════════════════════════════════════════════════════════════════════

/** Is `sq` attacked by a piece of colour `by`, with the board occupied as (occLo, occHi)? The
    occupancy can differ from the board's: a king's move is tested with the king lifted off. */
function attackedBy(pos, sq, by, occLo, occHi) {
  const lo = pos.lo, hi = pos.hi, i = 2 * sq;
  // A pawn of `by` attacks sq from the squares a pawn of the other colour on sq would attack.
  const pawnFrom = by === WHITE ? BLACK_PAWN_ATTACKS : WHITE_PAWN_ATTACKS;
  if ((pawnFrom[i] & lo[by | PAWN]) | (pawnFrom[i + 1] & hi[by | PAWN])) return true;
  if ((KNIGHT_STEPS[i] & lo[by | KNIGHT]) | (KNIGHT_STEPS[i + 1] & hi[by | KNIGHT])) return true;
  if ((KING_STEPS[i] & lo[by | KING]) | (KING_STEPS[i + 1] & hi[by | KING])) return true;
  const qLo = lo[by | QUEEN], qHi = hi[by | QUEEN];
  const rLo = lo[by | ROOK] | qLo, rHi = hi[by | ROOK] | qHi;
  if (rLo | rHi) {
    const r = rookIndex(sq, occLo, occHi);
    if ((ROOK_LO[r] & rLo) | (ROOK_HI[r] & rHi)) return true;
  }
  const bLo = lo[by | BISHOP] | qLo, bHi = hi[by | BISHOP] | qHi;
  if (bLo | bHi) {
    const b = bishopIndex(sq, occLo, occHi);
    if ((BISHOP_LO[b] & bLo) | (BISHOP_HI[b] & bHi)) return true;
  }
  return false;
}

/** Is `sq` attacked by a piece of colour `by`? Pieces block rays as they stand. */
function isAttacked(pos, sq, by) {
  return attackedBy(pos, sq, by, pos.lo[0] | pos.lo[8], pos.hi[0] | pos.hi[8]);
}

/** Is the side to move in check? */
const inCheck = pos => isAttacked(pos, pos.kingSquare(pos.side), pos.side ^ WHITE);

/** Is the en passant capture from → epSq legal for the side to move? It computes the
    occupancy after the capture, with both pawns gone and the capturer on epSq, and asks whether
    the king is attacked then. */
function epCaptureLegal(pos, from, epSq) {
  const us = pos.side, them = us ^ WHITE, lo = pos.lo, hi = pos.hi, captured = epSq ^ 8;
  const k = pos.kingSquare(us), i = 2 * k;
  const occLo = ((lo[0] | lo[8]) & ~SQ_LO[from] & ~SQ_LO[captured]) | SQ_LO[epSq];
  const occHi = ((hi[0] | hi[8]) & ~SQ_HI[from] & ~SQ_HI[captured]) | SQ_HI[epSq];
  const pawnFrom = us === WHITE ? WHITE_PAWN_ATTACKS : BLACK_PAWN_ATTACKS;
  if ((pawnFrom[i] & lo[them | PAWN] & ~SQ_LO[captured]) | (pawnFrom[i + 1] & hi[them | PAWN] & ~SQ_HI[captured])) return false;
  if ((KNIGHT_STEPS[i] & lo[them | KNIGHT]) | (KNIGHT_STEPS[i + 1] & hi[them | KNIGHT])) return false;
  if ((KING_STEPS[i] & lo[them | KING]) | (KING_STEPS[i + 1] & hi[them | KING])) return false;
  const qLo = lo[them | QUEEN], qHi = hi[them | QUEEN];
  const r = rookIndex(k, occLo, occHi);
  if ((ROOK_LO[r] & (lo[them | ROOK] | qLo)) | (ROOK_HI[r] & (hi[them | ROOK] | qHi))) return false;
  const b = bishopIndex(k, occLo, occHi);
  if ((BISHOP_LO[b] & (lo[them | BISHOP] | qLo)) | (BISHOP_HI[b] & (hi[them | BISHOP] | qHi))) return false;
  return true;
}

/** True when a pawn of the side to move can legally capture onto `epSq`. */
function canCaptureEnPassant(pos, epSq) {
  const us = pos.side, i = 2 * epSq;
  const from = us === WHITE ? BLACK_PAWN_ATTACKS : WHITE_PAWN_ATTACKS;   // where our pawns would stand
  let pLo = from[i] & pos.lo[us | PAWN], pHi = from[i + 1] & pos.hi[us | PAWN];
  while (pLo | pHi) {
    let sq;
    if (pLo) { sq = lowestBit(pLo); pLo &= pLo - 1; } else { sq = 32 + lowestBit(pHi); pHi &= pHi - 1; }
    if (epCaptureLegal(pos, sq, epSq)) return true;
  }
  return false;
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// 6. Legal move generation
// ═══════════════════════════════════════════════════════════════════════════════════════

/* A generated move is from | to << 6 | flags << 12. Promotions are not listed separately:
   whoever plays the move chooses the piece. */
const FLAG_CASTLE = 1;   // the king moves onto its own rook
const FLAG_EP = 2;       // a pawn captures en passant
const FLAG_DOUBLE = 4;   // a pawn advances two squares
const FLAG_PROMO = 8;    // a pawn reaches the last rank
const moveFrom = move => move & 63;
const moveTo = move => (move >> 6) & 63;
const moveFlags = move => move >> 12;
/** Room for the moves of one position (at most 218 legal moves exist; promotions count once). */
const MOVE_STRIDE = 256;

/* What move generation needs to know about the side to move, computed once per position by
   computeContext(). The search keeps one per ply, so that a node can go on generating its
   moves after its children have used theirs. */
class MoveContext {
  constructor() {
    /** The king's square. */
    this.king = 0;
    /** 0, 1 or 2: how many enemy pieces give check. */
    this.checks = 0;
    /** The squares a non-king move must land on: anywhere without check, the checker or a
        square between it and the king with one check, nowhere with two. */
    this.evLo = 0; this.evHi = 0;
    /** The pinned pieces. A pinned piece may only move along the line through it and its king
        (LINE): it cannot pass its king, and the pinner stops it. */
    this.pinLo = 0; this.pinHi = 0;
  }
}
const SHARED_CONTEXT = new MoveContext();

function computeContext(pos, ctx) {
  const us = pos.side, them = us ^ WHITE, lo = pos.lo, hi = pos.hi;
  const k = pos.kingSquare(us), i = 2 * k;
  const occLo = lo[0] | lo[8], occHi = hi[0] | hi[8];
  const rqLo = lo[them | ROOK] | lo[them | QUEEN], rqHi = hi[them | ROOK] | hi[them | QUEEN];
  const bqLo = lo[them | BISHOP] | lo[them | QUEEN], bqHi = hi[them | BISHOP] | hi[them | QUEEN];
  const pawnFrom = us === WHITE ? WHITE_PAWN_ATTACKS : BLACK_PAWN_ATTACKS;
  const r = rookIndex(k, occLo, occHi), b = bishopIndex(k, occLo, occHi);
  const checkLo = (KNIGHT_STEPS[i] & lo[them | KNIGHT]) | (pawnFrom[i] & lo[them | PAWN]) |
                  (ROOK_LO[r] & rqLo) | (BISHOP_LO[b] & bqLo);
  const checkHi = (KNIGHT_STEPS[i + 1] & hi[them | KNIGHT]) | (pawnFrom[i + 1] & hi[them | PAWN]) |
                  (ROOK_HI[r] & rqHi) | (BISHOP_HI[b] & bqHi);
  ctx.king = k;
  if (!(checkLo | checkHi)) {
    ctx.checks = 0; ctx.evLo = -1; ctx.evHi = -1;
  } else if (isSingle(checkLo, checkHi)) {
    const c = firstSquare(checkLo, checkHi), j = 2 * (64 * k + c);
    ctx.checks = 1; ctx.evLo = BETWEEN[j] | SQ_LO[c]; ctx.evHi = BETWEEN[j + 1] | SQ_HI[c];
  } else {
    ctx.checks = 2; ctx.evLo = 0; ctx.evHi = 0;
  }
  // Pins: an enemy slider on a line with the king, with exactly one piece between, ours.
  let pinLo = 0, pinHi = 0;
  let snLo = (ROOK_EMPTY_LO[k] & rqLo) | (BISHOP_EMPTY_LO[k] & bqLo);
  let snHi = (ROOK_EMPTY_HI[k] & rqHi) | (BISHOP_EMPTY_HI[k] & bqHi);
  while (snLo | snHi) {
    let s;
    if (snLo) { s = lowestBit(snLo); snLo &= snLo - 1; } else { s = 32 + lowestBit(snHi); snHi &= snHi - 1; }
    const j = 2 * (64 * k + s), bl = BETWEEN[j] & occLo, bh = BETWEEN[j + 1] & occHi;
    if (isSingle(bl, bh) && ((bl & lo[us]) | (bh & hi[us]))) { pinLo |= bl; pinHi |= bh; }
  }
  ctx.pinLo = pinLo; ctx.pinHi = pinHi;
}

/** May the king on kingSq castle with its rook on rookSq right now? The rights are checked by
    the caller. It needs:
    – every square the king or the rook passes over or lands on to be empty, apart from the
      king and the rook themselves;
    – no square of the king's path, its start and its destination included, to be attacked,
      with king and rook still standing where they are;
    – the king not to be attacked on its destination after the castle. */
function castlingLegal(pos, kingSq, rookSq) {
  const us = pos.side, them = us ^ WHITE, board = pos.board, lo = pos.lo, hi = pos.hi;
  const kingSide = rookSq > kingSq, rank = kingSq & 56;
  const kingTo = rank | (kingSide ? 6 : 2), rookTo = rank | (kingSide ? 5 : 3);
  const kingLow = Math.min(kingSq, kingTo), kingHigh = Math.max(kingSq, kingTo);
  const rookLow = Math.min(rookSq, rookTo), rookHigh = Math.max(rookSq, rookTo);
  for (let sq = kingLow; sq <= kingHigh; sq++) if (board[sq] && sq !== kingSq && sq !== rookSq) return false;
  for (let sq = rookLow; sq <= rookHigh; sq++) if (board[sq] && sq !== kingSq && sq !== rookSq) return false;
  const occLo = lo[0] | lo[8], occHi = hi[0] | hi[8];
  for (let sq = kingLow; sq <= kingHigh; sq++) if (attackedBy(pos, sq, them, occLo, occHi)) return false;
  const afterLo = (occLo & ~SQ_LO[kingSq] & ~SQ_LO[rookSq]) | SQ_LO[kingTo] | SQ_LO[rookTo];
  const afterHi = (occHi & ~SQ_HI[kingSq] & ~SQ_HI[rookSq]) | SQ_HI[kingTo] | SQ_HI[rookTo];
  return !attackedBy(pos, kingTo, them, afterLo, afterHi);
}

/* Every square attacked by colour `by` with the board occupied as (occLo, occHi), returned
   through attacksLo / attacksHi. Pawns, knights and the king are handled as whole sets; each
   slider costs one table lookup. */
let attacksLo = 0, attacksHi = 0;
function enemyAttacks(pos, by, occLo, occHi) {
  const lo = pos.lo, hi = pos.hi;
  const pL = lo[by | PAWN], pH = hi[by | PAWN];
  let aLo, aHi;
  if (by === WHITE) { aLo = sideways(northLo(pL)); aHi = sideways(northHi(pL, pH)); }
  else { aLo = sideways(southLo(pL, pH)); aHi = sideways(southHi(pH)); }
  const nL = lo[by | KNIGHT], nH = hi[by | KNIGHT];
  if (nL | nH) {
    const one = sideways(nL), oneH = sideways(nH), two = sideways2(nL), twoH = sideways2(nH);
    aLo |= (one << 16) | ((one >>> 16) | (oneH << 16)) | (two << 8) | ((two >>> 8) | (twoH << 24));
    aHi |= ((oneH << 16) | (one >>> 16)) | (oneH >>> 16) | ((twoH << 8) | (two >>> 24)) | (twoH >>> 8);
  }
  const k = 2 * pos.kingSquare(by);
  aLo |= KING_STEPS[k]; aHi |= KING_STEPS[k + 1];
  const qL = lo[by | QUEEN], qH = hi[by | QUEEN];
  let sL = lo[by | ROOK] | qL, sH = hi[by | ROOK] | qH;
  while (sL | sH) {
    let sq;
    if (sL) { sq = lowestBit(sL); sL &= sL - 1; } else { sq = 32 + lowestBit(sH); sH &= sH - 1; }
    const r = rookIndex(sq, occLo, occHi);
    aLo |= ROOK_LO[r]; aHi |= ROOK_HI[r];
  }
  sL = lo[by | BISHOP] | qL; sH = hi[by | BISHOP] | qH;
  while (sL | sH) {
    let sq;
    if (sL) { sq = lowestBit(sL); sL &= sL - 1; } else { sq = 32 + lowestBit(sH); sH &= sH - 1; }
    const b = bishopIndex(sq, occLo, occHi);
    aLo |= BISHOP_LO[b]; aHi |= BISHOP_HI[b];
  }
  attacksLo = aLo; attacksHi = aHi;
}

/* The legal targets of one piece, returned through these two words. */
let targetsLo = 0, targetsHi = 0;

/** Fills targetsLo/targetsHi with the legal targets of the piece on `from` (a piece of the side
    to move). computeContext(pos, ctx) must have run for this position. */
function legalTargets(pos, from, ctx) {
  const board = pos.board, lo = pos.lo, hi = pos.hi, us = pos.side, them = us ^ WHITE;
  const type = board[from] & 7, i = 2 * from;
  const occLo = lo[0] | lo[8], occHi = hi[0] | hi[8];
  let tLo = 0, tHi = 0;

  if (type === KING) {
    // A king's step is legal when the square is not attacked once the king has left its own:
    // the squares the enemy attacks are computed once, with the king lifted off the board, so
    // that a slider's ray runs on through the king's square.
    const cLo = KING_STEPS[i] & ~lo[us], cHi = KING_STEPS[i + 1] & ~hi[us];
    if (cLo | cHi) {
      enemyAttacks(pos, them, occLo & ~SQ_LO[from], occHi & ~SQ_HI[from]);
      tLo = cLo & ~attacksLo; tHi = cHi & ~attacksHi;
    }
    // Castling targets: own rooks on the king's rank whose right is alive. A king in check
    // never castles: its start square is part of the path that must not be attacked.
    if (pos.castling && ctx.checks === 0) {
      const rightsAt = pos.castlingFiles.rightsAt, rank = from & 56, rook = us | ROOK;
      for (let sq = rank; sq < rank + 8; sq++)
        if (board[sq] === rook && (pos.castling & rightsAt[sq]) && castlingLegal(pos, from, sq)) { tLo |= SQ_LO[sq]; tHi |= SQ_HI[sq]; }
    }
    targetsLo = tLo; targetsHi = tHi;
    return;
  }

  // Any other piece must answer a check and, when pinned, stay on its line.
  let mLo = ctx.evLo, mHi = ctx.evHi;
  if ((ctx.pinLo & SQ_LO[from]) | (ctx.pinHi & SQ_HI[from])) {
    const j = 2 * (64 * ctx.king + from);
    mLo &= LINE[j]; mHi &= LINE[j + 1];
  }
  switch (type) {
    case PAWN: {
      const ahead = us === WHITE ? from + 8 : from - 8;
      if (!board[ahead]) {
        tLo = SQ_LO[ahead]; tHi = SQ_HI[ahead];
        if ((from >> 3) === (us === WHITE ? 1 : 6)) {
          const twoAhead = us === WHITE ? from + 16 : from - 16;
          if (!board[twoAhead]) { tLo |= SQ_LO[twoAhead]; tHi |= SQ_HI[twoAhead]; }
        }
      }
      const attacks = us === WHITE ? WHITE_PAWN_ATTACKS : BLACK_PAWN_ATTACKS;
      tLo = (tLo | (attacks[i] & lo[them])) & mLo;
      tHi = (tHi | (attacks[i + 1] & hi[them])) & mHi;
      // En passant is tested by computing the position after it: it removes a pawn that is
      // not on its target square, which neither the check nor the pin masks describe.
      const ep = pos.ep;
      if (ep !== NO_SQUARE && ((attacks[i] & SQ_LO[ep]) | (attacks[i + 1] & SQ_HI[ep])) && epCaptureLegal(pos, from, ep)) {
        tLo |= SQ_LO[ep]; tHi |= SQ_HI[ep];
      }
      break;
    }
    case KNIGHT:
      tLo = KNIGHT_STEPS[i] & ~lo[us] & mLo;
      tHi = KNIGHT_STEPS[i + 1] & ~hi[us] & mHi;
      break;
    case BISHOP: {
      const b = bishopIndex(from, occLo, occHi);
      tLo = BISHOP_LO[b] & ~lo[us] & mLo;
      tHi = BISHOP_HI[b] & ~hi[us] & mHi;
      break;
    }
    case ROOK: {
      const r = rookIndex(from, occLo, occHi);
      tLo = ROOK_LO[r] & ~lo[us] & mLo;
      tHi = ROOK_HI[r] & ~hi[us] & mHi;
      break;
    }
    case QUEEN: {
      const r = rookIndex(from, occLo, occHi), b = bishopIndex(from, occLo, occHi);
      tLo = (ROOK_LO[r] | BISHOP_LO[b]) & ~lo[us] & mLo;
      tHi = (ROOK_HI[r] | BISHOP_HI[b]) & ~hi[us] & mHi;
      break;
    }
    default: fail('unknown piece ' + board[from] + ' on ' + squareName(from));
  }
  targetsLo = tLo; targetsHi = tHi;
}

/** Writes the legal moves of the side to move into out[base…] and returns their number.
    The order: by origin square a1, b1 … h8, then by target square in the same order. The
    search's node counts depend on this order (every port keeps it). */
function generateLegalMoves(pos, out, base, ctx = SHARED_CONTEXT) {
  computeContext(pos, ctx);
  const us = pos.side, board = pos.board, ep = pos.ep, end = base + MOVE_STRIDE;
  let n = base;
  for (let half = 0; half < 2; half++) {
    let own = half ? pos.hi[us] : pos.lo[us];
    while (own) {
      const from = 32 * half + lowestBit(own);
      own &= own - 1;
      legalTargets(pos, from, ctx);
      if (end - n < 28) fail('move list overflow');   // one piece has at most 27 targets
      const type = board[from] & 7;
      let tLo = targetsLo, tHi = targetsHi;
      if (type === PAWN) {
        while (tLo | tHi) {
          let to;
          if (tLo) { to = lowestBit(tLo); tLo &= tLo - 1; } else { to = 32 + lowestBit(tHi); tHi &= tHi - 1; }
          const flags = to === ep ? FLAG_EP : to - from === 16 || from - to === 16 ? FLAG_DOUBLE : to < 8 || to > 55 ? FLAG_PROMO : 0;
          out[n++] = from | (to << 6) | (flags << 12);
        }
      } else if (type === KING) {
        while (tLo | tHi) {
          let to;
          if (tLo) { to = lowestBit(tLo); tLo &= tLo - 1; } else { to = 32 + lowestBit(tHi); tHi &= tHi - 1; }
          const flags = board[to] && (board[to] & WHITE) === us ? FLAG_CASTLE : 0;
          out[n++] = from | (to << 6) | (flags << 12);
        }
      } else {
        while (tLo) { out[n++] = from | (lowestBit(tLo) << 6); tLo &= tLo - 1; }
        while (tHi) { out[n++] = from | ((32 + lowestBit(tHi)) << 6); tHi &= tHi - 1; }
      }
    }
  }
  return n - base;
}

/* The pawns of the side to move with no move even before pins and checks are considered: the
   square ahead taken, nothing to capture, no en passant square. Their legal targets are empty, so
   a loop over the pieces may skip them and still visit the others in the same order. Returned
   through stuckLo / stuckHi. */
let stuckLo = 0, stuckHi = 0;
function stuckPawns(pos) {
  if (pos.ep !== NO_SQUARE) { stuckLo = 0; stuckHi = 0; return; }
  const us = pos.side, lo = pos.lo, hi = pos.hi;
  const eL = ~(lo[0] | lo[8]), eH = ~(hi[0] | hi[8]), xL = lo[us ^ WHITE], xH = hi[us ^ WHITE];
  let fL, fH;
  if (us === WHITE) { fL = southLo(eL, eH) | sideways(southLo(xL, xH)); fH = southHi(eH) | sideways(southHi(xH)); }
  else { fL = northLo(eL) | sideways(northLo(xL)); fH = northHi(eL, eH) | sideways(northHi(xL, xH)); }
  stuckLo = lo[us | PAWN] & ~fL; stuckHi = hi[us | PAWN] & ~fH;
}

/** Does the side to move have any legal move? It stops at the first one. Out of check, a piece that is not pinned may make any of its moves,
    so a pawn's push, a knight's step or a slider's ray is looked for first; then the king, whose
    moves need the enemy's attacks; then the other pieces. The answer is the same yes or no. */
function hasLegalMove(pos, ctx = SHARED_CONTEXT) {
  computeContext(pos, ctx);
  const us = pos.side, lo = pos.lo, hi = pos.hi;
  if (ctx.checks === 0) {
    const occL = lo[0] | lo[8], occH = hi[0] | hi[8], ownL = lo[us], ownH = hi[us], fL = ~ctx.pinLo, fH = ~ctx.pinHi;
    const pL = lo[us | PAWN] & fL, pH = hi[us | PAWN] & fH;
    if (us === WHITE ? (northLo(pL) & ~occL) | (northHi(pL, pH) & ~occH) : (southLo(pL, pH) & ~occL) | (southHi(pH) & ~occH)) return true;
    let sL = lo[us | KNIGHT] & fL, sH = hi[us | KNIGHT] & fH;
    while (sL | sH) {
      let sq;
      if (sL) { sq = lowestBit(sL); sL &= sL - 1; } else { sq = 32 + lowestBit(sH); sH &= sH - 1; }
      if ((KNIGHT_STEPS[2 * sq] & ~ownL) | (KNIGHT_STEPS[2 * sq + 1] & ~ownH)) return true;
    }
    sL = (lo[us | BISHOP] | lo[us | QUEEN]) & fL; sH = (hi[us | BISHOP] | hi[us | QUEEN]) & fH;
    while (sL | sH) {
      let sq;
      if (sL) { sq = lowestBit(sL); sL &= sL - 1; } else { sq = 32 + lowestBit(sH); sH &= sH - 1; }
      const b = bishopIndex(sq, occL, occH);
      if ((BISHOP_LO[b] & ~ownL) | (BISHOP_HI[b] & ~ownH)) return true;
    }
    sL = (lo[us | ROOK] | lo[us | QUEEN]) & fL; sH = (hi[us | ROOK] | hi[us | QUEEN]) & fH;
    while (sL | sH) {
      let sq;
      if (sL) { sq = lowestBit(sL); sL &= sL - 1; } else { sq = 32 + lowestBit(sH); sH &= sH - 1; }
      const r = rookIndex(sq, occL, occH);
      if ((ROOK_LO[r] & ~ownL) | (ROOK_HI[r] & ~ownH)) return true;
    }
  }
  legalTargets(pos, ctx.king, ctx);
  if (targetsLo | targetsHi) return true;
  if (ctx.checks === 2 && pos.ep === NO_SQUARE) return false;   // only the king could move
  const king = ctx.king;
  stuckPawns(pos);
  for (let half = 0; half < 2; half++) {
    let own = half ? hi[us] & ~stuckHi : lo[us] & ~stuckLo;
    while (own) {
      const from = 32 * half + lowestBit(own);
      own &= own - 1;
      if (from === king) continue;
      legalTargets(pos, from, ctx);
      if (targetsLo | targetsHi) return true;
    }
  }
  return false;
}

/** The flags of the generated move from → to (see FLAG_*), for a piece of type `type`. */
function flagsOf(pos, type, from, to) {
  if (type === PAWN) {
    if (to === pos.ep) return FLAG_EP;
    if (to - from === 16 || from - to === 16) return FLAG_DOUBLE;
    return to < 8 || to > 55 ? FLAG_PROMO : 0;
  }
  if (type === KING) { const target = pos.board[to]; return target && (target & WHITE) === pos.side ? FLAG_CASTLE : 0; }
  return 0;
}

/** The legal moves, in the engine's order: [{from, to, castle, promotion}], where promotion
    says that the mover must choose a piece. */
function legalMoves(pos) {
  const list = new Int32Array(MOVE_STRIDE), count = generateLegalMoves(pos, list, 0), out = [];
  for (let k = 0; k < count; k++) {
    const flags = moveFlags(list[k]);
    out.push({ from: moveFrom(list[k]), to: moveTo(list[k]),
               castle: (flags & FLAG_CASTLE) !== 0, promotion: (flags & FLAG_PROMO) !== 0 });
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// 7. Making and unmaking moves
// ═══════════════════════════════════════════════════════════════════════════════════════

/** Plays a generated move in place and pushes what is needed to take it back.
    A castle is the king moving onto its own rook; a promotion becomes `promotion`. Bitboards
    are updated with XOR, which is its own inverse, so undoMove applies the same toggles. */
function doMove(pos, move, promotion) {
  if ((pos.undoTop + 1) * UNDO_STRIDE > pos.undo.length) growUndo(pos);
  const from = move & 63, to = (move >> 6) & 63, flags = move >> 12;
  const board = pos.board, lo = pos.lo, hi = pos.hi, us = pos.side, them = us ^ WHITE;
  const piece = board[from];
  const u = pos.undoTop++, U = pos.undo, at = u * UNDO_STRIDE;
  U[at] = move; U[at + 1] = piece; U[at + 3] = pos.castling; U[at + 4] = pos.ep;
  pos.undoHalfmove[u] = pos.halfmove;
  const fLo = SQ_LO[from], fHi = SQ_HI[from], tLo = SQ_LO[to], tHi = SQ_HI[to];
  let captured = 0;
  if (flags & FLAG_CASTLE) {
    const rook = board[to], rank = from & 56, kingSide = to > from;
    const kingTo = rank | (kingSide ? 6 : 2), rookTo = rank | (kingSide ? 5 : 3);
    // XOR handles a king or rook that already stands on its destination.
    lo[piece] ^= fLo ^ SQ_LO[kingTo]; hi[piece] ^= fHi ^ SQ_HI[kingTo];
    lo[rook] ^= tLo ^ SQ_LO[rookTo]; hi[rook] ^= tHi ^ SQ_HI[rookTo];
    lo[us] ^= fLo ^ tLo ^ SQ_LO[kingTo] ^ SQ_LO[rookTo];
    hi[us] ^= fHi ^ tHi ^ SQ_HI[kingTo] ^ SQ_HI[rookTo];
    board[from] = 0; board[to] = 0; board[kingTo] = piece; board[rookTo] = rook;
    pos.halfmove = pos.halfmove + 1;
  } else {
    captured = board[to];
    if (captured) {
      lo[captured] ^= tLo; hi[captured] ^= tHi; lo[them] ^= tLo; hi[them] ^= tHi;
    } else if (flags & FLAG_EP) {
      const sq = to ^ 8, pawn = board[sq];   // the pawn beside, which has just advanced two squares
      lo[pawn] ^= SQ_LO[sq]; hi[pawn] ^= SQ_HI[sq]; lo[them] ^= SQ_LO[sq]; hi[them] ^= SQ_HI[sq];
      board[sq] = 0;
    }
    const moved = flags & FLAG_PROMO ? us | promotion : piece;
    lo[piece] ^= fLo; hi[piece] ^= fHi;
    lo[moved] ^= tLo; hi[moved] ^= tHi;
    lo[us] ^= fLo | tLo; hi[us] ^= fHi | tHi;
    board[from] = 0; board[to] = moved;
    // The clock restarts after a capture or a pawn move.
    pos.halfmove = captured || (piece & 7) === PAWN ? 0 : pos.halfmove + 1;
  }
  U[at + 2] = captured;
  const rightsAt = pos.castlingFiles.rightsAt;
  pos.castling &= ~(rightsAt[from] | rightsAt[to]);
  pos.side = them;
  pos.ep = NO_SQUARE;
  if (flags & FLAG_DOUBLE) {
    const passed = (from + to) >> 1;
    if (canCaptureEnPassant(pos, passed)) pos.ep = passed;
  }
}

/** Takes back the last move made with doMove. */
function undoMove(pos) {
  if (pos.undoTop === 0) fail('undoMove: no move to take back');
  const u = --pos.undoTop, U = pos.undo, at = u * UNDO_STRIDE;
  const move = U[at], piece = U[at + 1], captured = U[at + 2];
  const from = move & 63, to = (move >> 6) & 63, flags = move >> 12;
  const board = pos.board, lo = pos.lo, hi = pos.hi, them = pos.side, us = them ^ WHITE;
  const fLo = SQ_LO[from], fHi = SQ_HI[from], tLo = SQ_LO[to], tHi = SQ_HI[to];
  if (flags & FLAG_CASTLE) {
    const rook = us | ROOK, rank = from & 56, kingSide = to > from;
    const kingTo = rank | (kingSide ? 6 : 2), rookTo = rank | (kingSide ? 5 : 3);
    lo[piece] ^= fLo ^ SQ_LO[kingTo]; hi[piece] ^= fHi ^ SQ_HI[kingTo];
    lo[rook] ^= tLo ^ SQ_LO[rookTo]; hi[rook] ^= tHi ^ SQ_HI[rookTo];
    lo[us] ^= fLo ^ tLo ^ SQ_LO[kingTo] ^ SQ_LO[rookTo];
    hi[us] ^= fHi ^ tHi ^ SQ_HI[kingTo] ^ SQ_HI[rookTo];
    board[kingTo] = 0; board[rookTo] = 0; board[from] = piece; board[to] = rook;
  } else {
    const moved = board[to];
    lo[moved] ^= tLo; hi[moved] ^= tHi;
    lo[piece] ^= fLo; hi[piece] ^= fHi;
    lo[us] ^= fLo | tLo; hi[us] ^= fHi | tHi;
    board[from] = piece; board[to] = captured;
    if (captured) {
      lo[captured] ^= tLo; hi[captured] ^= tHi; lo[them] ^= tLo; hi[them] ^= tHi;
    } else if (flags & FLAG_EP) {
      const sq = to ^ 8, pawn = them | PAWN;
      lo[pawn] ^= SQ_LO[sq]; hi[pawn] ^= SQ_HI[sq]; lo[them] ^= SQ_LO[sq]; hi[them] ^= SQ_HI[sq];
      board[sq] = pawn;
    }
  }
  pos.side = us;
  pos.castling = U[at + 3];
  pos.ep = U[at + 4];
  pos.halfmove = pos.undoHalfmove[u];
}

function growUndo(pos) {
  const records = Math.max(8, 2 * pos.undoHalfmove.length);
  const undo = new Int32Array(records * UNDO_STRIDE), half = new Float64Array(records);
  undo.set(pos.undo); half.set(pos.undoHalfmove);
  pos.undo = undo; pos.undoHalfmove = half;
}

/** The generated move from → to, or -1 when it is not legal. */
function findLegalMove(pos, from, to, buffer = new Int32Array(MOVE_STRIDE)) {
  const count = generateLegalMoves(pos, buffer, 0), wanted = from | (to << 6);
  for (let k = 0; k < count; k++) if ((buffer[k] & 4095) === wanted) return buffer[k];
  return -1;
}

function checkPromotion(promotion) {
  if (PROMOTION_ORDER.indexOf(promotion) < 0) fail('promotion must be QUEEN, ROOK, BISHOP or KNIGHT');
}

/** Plays from → to on a copy: writes the position after the move into dst and returns dst; src
    is left unchanged. Throws when the move is not legal. */
function makeMove(src, dst, from, to, promotion = QUEEN) {
  checkPromotion(promotion);
  const move = findLegalMove(src, from, to);
  if (move < 0) fail('illegal move ' + squareName(from) + squareName(to));
  dst.copyFrom(src);
  doMove(dst, move, promotion);
  dst.undoTop = 0;
  return dst;
}

/** Number of leaf positions after `depth` plies, promotions counted separately. */
function perft(pos, depth) {
  if (depth === 0) return 1;
  const work = pos.clone(), buffer = new Int32Array(MOVE_STRIDE * depth);
  const walk = (ply, left) => {
    const base = ply * MOVE_STRIDE, count = generateLegalMoves(work, buffer, base);
    if (left === 1) {
      let nodes = count;
      for (let k = 0; k < count; k++) if (moveFlags(buffer[base + k]) & FLAG_PROMO) nodes += 3;
      return nodes;
    }
    let nodes = 0;
    for (let k = 0; k < count; k++) {
      const move = buffer[base + k], choices = moveFlags(move) & FLAG_PROMO ? 4 : 1;
      for (let p = 0; p < choices; p++) {
        doMove(work, move, PROMOTION_ORDER[p]);
        nodes += walk(ply + 1, left - 1);
        undoMove(work);
      }
    }
    return nodes;
  };
  return walk(0, depth);
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// 8. Position identity
// ═══════════════════════════════════════════════════════════════════════════════════════

/* Two positions are the same position when board, side to move, castling rights and en
   passant square are all equal. The exact code of a position is nine
   words: three bit planes of the piece types (a type is three bits: plane 0 holds pawns, queens
   and rooks, plane 1 kings, queens and bishops, plane 2 knights, rooks and bishops), the white
   pieces, and one word for side, castling and en passant. Equal codes mean equal positions. */
const KEY_WORDS = 9;

function writeKey(pos, out, at) {
  const lo = pos.lo, hi = pos.hi;
  out[at]     = lo[1] | lo[9] | lo[3] | lo[11] | lo[5] | lo[13];
  out[at + 1] = hi[1] | hi[9] | hi[3] | hi[11] | hi[5] | hi[13];
  out[at + 2] = lo[2] | lo[10] | lo[3] | lo[11] | lo[6] | lo[14];
  out[at + 3] = hi[2] | hi[10] | hi[3] | hi[11] | hi[6] | hi[14];
  out[at + 4] = lo[4] | lo[12] | lo[5] | lo[13] | lo[6] | lo[14];
  out[at + 5] = hi[4] | hi[12] | hi[5] | hi[13] | hi[6] | hi[14];
  out[at + 6] = lo[8];
  out[at + 7] = hi[8];
  out[at + 8] = ((pos.ep + 1) << 5) | (pos.side === WHITE ? 16 : 0) | pos.castling;
}

function keysEqual(a, at, b, bt) {
  for (let j = 0; j < KEY_WORDS; j++) if (a[at + j] !== b[bt + j]) return false;
  return true;
}

/** A 32-bit hash of a code: each word times its own odd constant, summed by XOR, then
    MurmurHash3's finalizer. Only for spreading codes over the table: a match is always
    confirmed on the full code. */
function hashKey(k, at) {
  let h = Math.imul(k[at], 0x9e3779b1) ^ Math.imul(k[at + 1], 0x85ebca77) ^ Math.imul(k[at + 2], 0xc2b2ae3d) ^
          Math.imul(k[at + 3], 0x27d4eb2f) ^ Math.imul(k[at + 4], 0x165667b1) ^ Math.imul(k[at + 5], 0xd3a2646d) ^
          Math.imul(k[at + 6], 0xfd7046c5) ^ Math.imul(k[at + 7], 0xb55a4f09) ^ Math.imul(k[at + 8], 0x7feb352d);
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
  return h ^ (h >>> 16);
}

/** A string that is equal for two positions exactly when they are the same position. */
function positionKey(pos) {
  const k = new Int32Array(KEY_WORDS);
  writeKey(pos, k, 0);
  return Array.from(k).join(',');
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// 9. FEN
// ═══════════════════════════════════════════════════════════════════════════════════════

const FEN_PIECES = { p: PAWN, k: KING, q: QUEEN, n: KNIGHT, r: ROOK, b: BISHOP };

/** Reads a FEN as it is written: the first step of fromFen (fen.js), which then refuses a
    position no game can reach. Returns { position, halfmoveGiven, fullmove, fullmoveRead, fixed,
    epDeclared } (fullmoveRead: the move number as written, 1 if absent) or { error, detail }:
    'syntax' (detail: what is malformed), 'kings' (not one king a side; detail: the counts) or
    'pawnrank' (a pawn on the first or last rank; detail: its square).

    What can be read only one way is put right instead of refused, and named in `fixed`:
      castling     KQkq (the outermost rook on that side of the king, as in X-FEN) or Shredder-FEN
                   file letters (HAha). Every right is read against the board: its king must stand
                   on its first rank and its rook on the same rank; the files found become the
                   castling skeleton, shared by both colours. A right the board does not allow, or
                   one that would put a king or a rook on another file than the skeleton, is
                   dropped.
      en passant   kept only behind a pawn of the side not to move that has just advanced two
                   squares (the square and the one the pawn left empty), and only with a halfmove
                   clock of 0 (a two-square advance resets it); otherwise dropped. epDeclared is
                   the square that remains (NO_SQUARE: none); the position keeps it as its en
                   passant square only when a legal capture onto it exists.
      fullmove     at least 1, and at least what the halfmove clock needs (the clock counts plies
                   played: at most 2 × (fullmove − 1), plus one with Black to move). */
function readFen(fen) {
  const fields = String(fen).trim().split(/\s+/), fixed = [];
  if (fields.length < 2 || !fields[0]) return { error: 'syntax', detail: ['fields'] };
  const rows = fields[0].split('/');
  if (rows.length !== 8) return { error: 'syntax', detail: ['nranks', rows.length] };
  const pieces = new Uint8Array(64);
  let whiteKings = 0, blackKings = 0;
  for (let r = 0; r < 8; r++) {
    const rank = 7 - r;
    let file = 0;
    for (const ch of rows[r]) {
      if (ch >= '1' && ch <= '8') { file += +ch; if (file > 8) return { error: 'syntax', detail: ['rankw', rank + 1] }; continue; }
      const type = FEN_PIECES[ch.toLowerCase()];
      if (!type) return { error: 'syntax', detail: ['char', ch] };
      if (file > 7) return { error: 'syntax', detail: ['rankw', rank + 1] };
      const piece = type | (ch === ch.toUpperCase() ? WHITE : BLACK);
      if (piece === (WHITE | KING)) whiteKings++; else if (piece === (BLACK | KING)) blackKings++;
      pieces[8 * rank + file++] = piece;
    }
    if (file !== 8) return { error: 'syntax', detail: ['rankw', rank + 1] };
  }
  if (fields[1] !== 'w' && fields[1] !== 'b') return { error: 'syntax', detail: ['side', fields[1]] };
  const castlingField = fields[2] || '-', epField = fields[3] || '-';
  if (castlingField !== '-' && !/^[KQkqA-Ha-h]+$/.test(castlingField)) return { error: 'syntax', detail: ['castling', castlingField] };
  if (epField !== '-' && !/^[a-h][1-8]$/.test(epField)) return { error: 'syntax', detail: ['epf', epField] };
  for (let i = 4; i < 6 && i < fields.length; i++)
    if (fields[i] !== '-' && !/^\d+$/.test(fields[i])) return { error: 'syntax', detail: ['num', fields[i]] };
  if (whiteKings !== 1 || blackKings !== 1) return { error: 'kings', detail: [whiteKings, blackKings] };
  for (let f = 0; f < 8; f++) for (const sq of [f, 56 + f])
    if ((pieces[sq] & 7) === PAWN) return { error: 'pawnrank', detail: [squareName(sq)] };

  // Castling rights and the skeleton they imply.
  const skeleton = [0, 0, 0, 0, 0, 0, 0, 0];
  let castling = 0;
  for (const ch of castlingField === '-' ? '' : castlingField) {
    const up = ch.toUpperCase(), white = ch === up, base = white ? 0 : 56;
    const king = pieces.indexOf(white ? WHITE | KING : BLACK | KING) - base;
    const rook = white ? WHITE | ROOK : BLACK | ROOK;
    let rookFile = -1;
    if (king >= 0 && king <= 7) {
      if (up === 'K') { for (let f = 7; f > king; f--) if (pieces[base + f] === rook) { rookFile = f; break; } }
      else if (up === 'Q') { for (let f = 0; f < king; f++) if (pieces[base + f] === rook) { rookFile = f; break; } }
      else { const f = up.charCodeAt(0) - 65; if (f !== king && pieces[base + f] === rook) rookFile = f; }
    }
    if (rookFile < 0) { fixed.push('castling'); continue; }          // its king or its rook is not there
    const digit = rookFile > king ? 1 : 2, bit = digit << (white ? 0 : 2);
    if ((castling & bit) && skeleton[rookFile] === digit) continue;  // the same right written twice
    // a second rook for one side, or files the skeleton has already given to another king or rook
    if ((castling & bit) || (skeleton[king] && skeleton[king] !== 3) || (skeleton[rookFile] && skeleton[rookFile] !== digit) ||
        skeleton.some((d, f) => (d === 3 && f !== king) || (d === digit && f !== rookFile))) { fixed.push('castling'); continue; }
    skeleton[king] = 3;
    skeleton[rookFile] = digit;
    castling |= bit;
  }

  const pos = new Position(castling ? new CastlingFiles(skeleton.join('')) : STANDARD_FILES);
  for (let sq = 0; sq < 64; sq++) if (pieces[sq]) pos.put(sq, pieces[sq]);
  pos.side = fields[1] === 'w' ? WHITE : BLACK;
  pos.castling = castling;
  const clock = fields[4], halfmoveGiven = clock !== undefined && clock !== '-';
  pos.halfmove = halfmoveGiven ? +clock : 0;
  let epDeclared = NO_SQUARE;
  if (epField !== '-') {
    // The square must lie behind an enemy pawn that has just advanced two squares from its start.
    const sq = parseSquare(epField), dir = pos.side === WHITE ? 8 : -8, pawnSq = sq - dir, startSq = sq + dir;
    if (rankOf(sq) === (pos.side === WHITE ? 5 : 2) && !pos.board[sq] && !pos.board[startSq] &&
        pos.board[pawnSq] === ((pos.side ^ WHITE) | PAWN) && pos.halfmove === 0) {
      epDeclared = sq;
      if (canCaptureEnPassant(pos, sq)) pos.ep = sq;
    } else fixed.push('en passant');
  }
  const fullmoveRead = fields[5] !== undefined && fields[5] !== '-' ? +fields[5] : 1;
  let fullmove = fullmoveRead;
  const least = Math.max(1, Math.ceil((pos.halfmove - (pos.side === BLACK ? 1 : 0)) / 2) + 1);
  if (fullmove < least) { if (fields[5] !== undefined && fields[5] !== '-') fixed.push('fullmove'); fullmove = least; }
  return { position: pos, halfmoveGiven, fullmove, fullmoveRead, fixed: [...new Set(fixed)], epDeclared };
}

/** The castling field: KQkq for the standard skeleton, Shredder file letters otherwise. */
function castlingField(pos) {
  const c = pos.castling, files = pos.castlingFiles;
  let out = '';
  if (files.isStandard) {
    if (c & 1) out += 'K'; if (c & 2) out += 'Q'; if (c & 4) out += 'k'; if (c & 8) out += 'q';
  } else {
    const kingRook = 'ABCDEFGH'.charAt(files.skeleton.indexOf('1'));
    const queenRook = 'ABCDEFGH'.charAt(files.skeleton.indexOf('2'));
    if (c & 1) out += kingRook; if (c & 2) out += queenRook;
    if (c & 4) out += kingRook.toLowerCase(); if (c & 8) out += queenRook.toLowerCase();
  }
  return out || '-';
}

function toFen(pos, fullmove = 1) {
  let placement = '';
  for (let rank = 7; rank >= 0; rank--) {
    let empty = 0;
    for (let file = 0; file < 8; file++) {
      const piece = pos.board[8 * rank + file];
      if (!piece) { empty++; continue; }
      if (empty) { placement += empty; empty = 0; }
      placement += PIECE_LETTERS[piece];
    }
    if (empty) placement += empty;
    if (rank) placement += '/';
  }
  return [placement, pos.side === WHITE ? 'w' : 'b', castlingField(pos),
          pos.ep === NO_SQUARE ? '-' : squareName(pos.ep), pos.halfmove, fullmove].join(' ');
}

/** Chess960 starting arrangement number n (0..959) by Scharnagl's numbering; 518 is standard
    chess. Returns the white back rank, e.g. "RNBQKBNR". */
function chess960Arrangement(n) {
  if (!Number.isInteger(n) || n < 0 || n > 959) fail('Chess960 number out of range: ' + n);
  const rank = new Array(8).fill('');
  const free = () => rank.map((p, i) => (p ? -1 : i)).filter(i => i >= 0);
  rank[2 * (n % 4) + 1] = 'B'; n = Math.floor(n / 4);
  rank[2 * (n % 4)] = 'B'; n = Math.floor(n / 4);
  rank[free()[n % 6]] = 'Q'; n = Math.floor(n / 6);
  const knightPairs = [[0, 1], [0, 2], [0, 3], [0, 4], [1, 2], [1, 3], [1, 4], [2, 3], [2, 4], [3, 4]];
  const [a, b] = knightPairs[n], squares = free();
  rank[squares[a]] = 'N'; rank[squares[b]] = 'N';
  const rest = free();
  rank[rest[0]] = 'R'; rank[rest[1]] = 'K'; rank[rest[2]] = 'R';
  return rank.join('');
}


/* ═══ Mateless · fen.js — reading a FEN: a position some game can reach ════════════════════

   The outer layer every position from outside comes in through. The ladder (material test, lock
   detector, Domino search) never calls it: those take a Position and answer for it, and a
   position reached by legal moves from one this layer let in needs no second look.

   fromFen reads the FEN (board.js's readFen: its syntax, one king a side, no pawn on the first or
   last rank), puts right what can be read only one way (castling rights the board does not
   allow, an en passant square no two-square advance left, a move number below what the halfmove
   clock needs, and, strict, a halfmove clock above 0 where only a capture or a pawn move can
   have given the checks: `fixed` names them), and refuses a position no game of chess or
   Chess960 can reach, by the known necessary conditions:

     oppcheck   the side not to move is in check (two kings side by side are this too);
     pawns      more than 8 pawns a side;
     pieces     more than 16 men a side;
     promo      more men than the starting set (one queen, two rooks, two knights, one bishop on
                each colour: a bishop never changes colour) than missing pawns could have become;
     captures   a pawn off its file has captured on the way: the side's pawns, each from a file
                of its own, need more captures than the enemy men missing;
     checks     the checks on the side to move did not come from a last move. Made back, some move
                of the other side (a move, a capture, a promotion, an en passant capture, castling)
                must leave a position in which the side to move was not in check (a man captured
                comes back only if its side has fewer than 16, a pawn taken en passant only if
                also fewer than 8 pawns, a promotion is made back only if the mover has fewer than
                8 pawns). That refuses
                three checks and more, every double check no single move gives (two knights, a
                knight and a pawn, two bishops, a bishop and a pawn, two rooks but by a capturing
                promotion, two pieces on one line through the king, a discovered check whose line
                the moved piece never stood on), a pawn checking from its starting rank, and, with
                an en passant square, any check the two-square advance it records cannot give
                (then the square is dropped instead, if the position stands without it).

   These are necessary conditions only: a position that passes them all may still be unreachable
   (that takes a retrograde analysis further back). { strict: false } keeps only what the engine
   needs to work (the syntax, the kings, no pawn on an edge rank, the side not to move out of
   check), for composed positions and test sets. */

const LEAPS_N = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
const STEPS_K = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
const RAYS_D = [[1, 1], [1, -1], [-1, 1], [-1, -1]], RAYS_S = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const on = (f, r) => f >= 0 && f < 8 && r >= 0 && r < 8;
const BOARD = new Uint8Array(64);                             // the board the last move is made back on

/** The men of colour `by` that attack square k on the mailbox board b (64 piece codes): their
    squares, each with the squares strictly between it and k when it attacks along a line. With
    first: stops at the first one. */
function attackers(b, k, by, first = false) {
  const kf = k & 7, kr = k >> 3, out = [];
  for (const [df, dr] of LEAPS_N) if (on(kf + df, kr + dr) && b[8 * (kr + dr) + kf + df] === (by | KNIGHT)) { out.push({ sq: 8 * (kr + dr) + kf + df, line: null }); if (first) return out; }
  for (const [df, dr] of STEPS_K) if (on(kf + df, kr + dr) && b[8 * (kr + dr) + kf + df] === (by | KING)) { out.push({ sq: 8 * (kr + dr) + kf + df, line: null }); if (first) return out; }
  const pr = kr + (by === WHITE ? -1 : 1);                    // a white pawn attacks from one rank below
  for (const df of [-1, 1]) if (on(kf + df, pr) && b[8 * pr + kf + df] === (by | PAWN)) { out.push({ sq: 8 * pr + kf + df, line: null }); if (first) return out; }
  for (const [rays, slider] of [[RAYS_D, BISHOP], [RAYS_S, ROOK]])
    for (const [df, dr] of rays) {
      let f = kf + df, r = kr + dr;
      const line = [];
      while (on(f, r)) {
        const p = b[8 * r + f];
        if (p) { if (p === (by | slider) || p === (by | QUEEN)) { out.push({ sq: 8 * r + f, line }); if (first) return out; } break; }
        line.push(8 * r + f);
        f += df; r += dr;
      }
    }
  return out;
}
/** Is square k attacked by colour `by` on the mailbox board b? */
function attacked(b, k, by) {
  const kf = k & 7, kr = k >> 3;
  for (let i = 0; i < 8; i++) {
    let f = kf + LEAPS_N[i][0], r = kr + LEAPS_N[i][1];
    if (on(f, r) && b[8 * r + f] === (by | KNIGHT)) return true;
    f = kf + STEPS_K[i][0]; r = kr + STEPS_K[i][1];
    if (on(f, r) && b[8 * r + f] === (by | KING)) return true;
  }
  const pr = kr + (by === WHITE ? -1 : 1);
  if (pr >= 0 && pr < 8 && ((kf > 0 && b[8 * pr + kf - 1] === (by | PAWN)) || (kf < 7 && b[8 * pr + kf + 1] === (by | PAWN)))) return true;
  for (let i = 0; i < 8; i++) {
    const [df, dr] = STEPS_K[i], diagonal = df !== 0 && dr !== 0;
    let f = kf + df, r = kr + dr;
    while (on(f, r)) {
      const p = b[8 * r + f];
      if (p) { if (p === (by | QUEEN) || p === (by | (diagonal ? BISHOP : ROOK))) return true; break; }
      f += df; r += dr;
    }
  }
  return false;
}

/** Material: at most 8 pawns and 16 men a side, the men beyond the starting set paid for by
    missing pawns (bishops counted by the colour of their squares), and captures: a pawn that left
    its file captured once for each file it moved; the side's pawns start on files of their own (a
    fewest-moves matching of their files to the eight starting files), and each capture took an
    enemy man, so they need no more captures than enemy men are missing. */
function materialProblem(pos) {
  const lo = pos.lo, hi = pos.hi, count = i => popcount(lo[i]) + popcount(hi[i]);
  for (const c of [WHITE, BLACK]) {
    const side = c === WHITE ? 'w' : 'b', pawns = count(c | PAWN), men = count(c);
    if (pawns > 8) return { error: 'pawns', detail: [side, pawns] };
    if (men > 16) return { error: 'pieces', detail: [side, men] };
    const dark = popcount(lo[c | BISHOP] & DARK_SQUARES) + popcount(hi[c | BISHOP] & DARK_SQUARES), light = count(c | BISHOP) - dark;
    const extra = Math.max(0, count(c | QUEEN) - 1) + Math.max(0, count(c | ROOK) - 2) + Math.max(0, count(c | KNIGHT) - 2) +
                  Math.max(0, light - 1) + Math.max(0, dark - 1);
    if (extra > 8 - pawns) return { error: 'promo', detail: [side, extra, 8 - pawns] };
  }
  for (const c of [WHITE, BLACK]) {
    // the pawns' files, from a to h: a pawn on each file the bits of each half say
    const files = [];
    for (let f = 0; f < 8; f++) {
      const mask = 0x01010101 << f;
      for (let k = popcount(lo[c | PAWN] & mask) + popcount(hi[c | PAWN] & mask); k > 0; k--) files.push(f);
    }
    // row[j]: the fewest file changes for the pawns so far, from the first j starting files
    let row = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (let i = 1; i <= files.length; i++) {
      const next = [1e9, 1e9, 1e9, 1e9, 1e9, 1e9, 1e9, 1e9, 1e9];
      for (let j = i; j <= 8; j++) next[j] = Math.min(next[j - 1], row[j - 1] + Math.abs(files[i - 1] - (j - 1)));
      row = next;
    }
    const need = files.length ? row[8] : 0, missing = 16 - count(c ^ WHITE);
    if (need > missing) return { error: 'captures', detail: [c === WHITE ? 'w' : 'b', need, missing] };
  }
  return null;
}

/** Did the checks on the side to move come from a last move? True when some move of the other
    side (the mover), made back, leaves a position where the side to move's king was not attacked.
    ep: the en passant square the FEN keeps (NO_SQUARE: none); then the last move is the two-square
    advance it records, and only that move is made back. A move made back can only help when every
    checking man is the man that moved, or attacks along a line that a square the move fills again
    lies on; the others are not tried. quiet: only moves that leave the halfmove clock running (no
    pawn move, no capture: a piece's move or castling). */
function checksExplained(b, side, ep, quietOnly = false) {
  const mover = side ^ WHITE, king = b.indexOf(side | KING), up = mover === WHITE ? 8 : -8;
  const first = mover === WHITE ? 0 : 7, last = 7 - first;
  // b with the squares sq set to the pieces ps: is the king out of check there?
  const quiet = (sqs, ps) => {
    const old = sqs.map(q => b[q]);
    sqs.forEach((q, i) => { b[q] = ps[i]; });
    const free = !attacked(b, king, mover);
    sqs.forEach((q, i) => { b[q] = old[i]; });
    return free;
  };
  if (ep !== NO_SQUARE) return quiet([ep - up, ep + up], [b[ep + up], 0]);
  const checkers = attackers(b, king, mover);
  // could the move from s, filling the squares filled, take every check away?
  const helps = (s, filled) => checkers.every(c => c.sq === s || (c.line && filled.some(q => c.line.includes(q))));
  let men = 0, pawns = 0, moverPawns = 0;
  for (let q = 0; q < 64; q++) {
    const p = b[q];
    if (!p) continue;
    if ((p & WHITE) === side) { men++; pawns += (p & 7) === PAWN; } else moverPawns += (p & 7) === PAWN;
  }
  const blocker = men < 16 && !quietOnly ? side | KNIGHT : 0;   // a man captured by the last move, put back (any man blocks)
  const passant = men < 16 && pawns < 8, promotion = moverPawns < 8;   // the pawn taken en passant; the pawn that promoted
  // the piece `moved` came to s from x; s held `captured` (0: nothing); extra: more squares filled
  const back = (s, x, moved, captured, extraSq = [], extraPiece = []) =>
    helps(s, [x, ...extraSq]) && quiet([x, s, ...extraSq], [moved, captured, ...extraPiece]);
  for (let s = 0; s < 64; s++) {
    const p = b[s];
    if (!p || (p & WHITE) !== mover) continue;
    const t = p & 7, sf = s & 7, sr = s >> 3, behind = sr - up / 8;
    if (t === PAWN) {
      if (quietOnly) continue;
      const one = s - up, rel = mover === WHITE ? sr : 7 - sr;         // rel: the pawn's rank from its side
      if (rel >= 2 && !b[one] && back(s, one, p, 0)) return true;      // a one-square advance
      if (rel === 3 && !b[one] && !b[one - up] && back(s, one - up, p, 0)) return true;   // two squares
      if (rel < 2) continue;
      for (const df of [-1, 1]) {
        if (!on(sf + df, behind) || b[one + df]) continue;
        if (blocker && back(s, one + df, p, blocker)) return true;     // a capture
        if (passant && rel === 5 && !b[one] && back(s, one + df, p, 0, [one], [side | PAWN])) return true;   // en passant
      }
      continue;
    }
    if (t === KNIGHT || t === KING) {
      for (const [df, dr] of t === KNIGHT ? LEAPS_N : STEPS_K) {
        if (!on(sf + df, sr + dr)) continue;
        const x = 8 * (sr + dr) + sf + df;
        if (!b[x] && back(s, x, p, blocker)) return true;
      }
    } else {
      const rays = t === BISHOP ? RAYS_D : t === ROOK ? RAYS_S : RAYS_D.concat(RAYS_S);
      for (const [df, dr] of rays) {
        let f = sf + df, r = sr + dr;
        while (on(f, r) && !b[8 * r + f]) { if (back(s, 8 * r + f, p, blocker)) return true; f += df; r += dr; }
      }
    }
    if (promotion && !quietOnly && t !== KING && sr === last) {                      // a promotion, by an advance or a capture
      const one = s - up;
      if (!b[one] && back(s, one, mover | PAWN, 0)) return true;
      for (const df of [-1, 1]) if (blocker && on(sf + df, behind) && !b[one + df] && back(s, one + df, mover | PAWN, blocker)) return true;
    }
    if (t === KING && sr === first && (sf === 2 || sf === 6)) {        // castling: the king beside its rook
      const rookSq = s + (sf === 6 ? -1 : 1), base = 8 * first;
      if (b[rookSq] !== (mover | ROOK)) continue;
      for (let kx = 1; kx <= 6; kx++) for (let rx = 0; rx <= 7; rx++) {
        if (rx === kx || (sf === 6 ? rx < kx : rx > kx)) continue;   // the rook started beyond the king, on its side
        const kSq = base + kx, rSq = base + rx;
        if ((b[kSq] && kSq !== s && kSq !== rookSq) || (b[rSq] && rSq !== s && rSq !== rookSq)) continue;
        const sqs = [s, rookSq, kSq, rSq], ps = [0, 0, mover | KING, mover | ROOK];
        if (!checkers.every(c => c.line ? c.line.includes(kSq) || c.line.includes(rSq) || c.sq === rookSq : c.sq === rookSq)) continue;
        if (quiet(sqs, ps)) return true;
      }
    }
  }
  return false;
}

/** Reads a FEN into a position some game can reach. Returns { position, halfmoveGiven, fullmove,
    fixed, fen } (fixed: 'castling', 'en passant', 'halfmove', 'fullmove', in this order, those put right; fen:
    the FEN as read, with what was put right) or { error, detail }: error is
    'syntax', 'kings', 'pawnrank' (from readFen), or 'oppcheck', 'pawns', 'pieces', 'promo',
    'captures', 'checks' (see above). strict: false keeps the first four only. */
function fromFen(fen, { strict = true } = {}) {
  const r = readFen(fen);
  if (r.error) return r;
  const pos = r.position, side = pos.side;
  let fixed = r.fixed, fullmove = r.fullmove;
  if (isAttacked(pos, pos.kingSquare(side ^ WHITE), side)) return { error: 'oppcheck', detail: [] };
  if (strict) {
    const m = materialProblem(pos);
    if (m) return m;
    let ep = r.epDeclared;
    const check = inCheck(pos);
    if (ep !== NO_SQUARE || check) {
      const b = BOARD;
      b.set(pos.board);
      if (ep !== NO_SQUARE && !checksExplained(b, side, ep)) { ep = NO_SQUARE; pos.ep = NO_SQUARE; fixed.push('en passant'); }
      if (ep === NO_SQUARE && check && !(pos.halfmove > 0 && checksExplained(b, side, NO_SQUARE, true))) {
        if (!checksExplained(b, side, NO_SQUARE)) return { error: 'checks', detail: [attackers(b, pos.kingSquare(side), side ^ WHITE).length] };
        if (pos.halfmove > 0) {   // only a capture or a pawn move gives these checks: the clock starts again
          pos.halfmove = 0;
          fixed = fixed.filter(f => f !== 'fullmove');   // the move number that clock needed is needed no more
          fixed.push('halfmove');
          fullmove = Math.max(1, r.fullmoveRead);
          if (r.fullmoveRead < 1) fixed.push('fullmove');
        }
      }
    }
  }
  return { position: pos, halfmoveGiven: r.halfmoveGiven, fullmove,
           fixed: FIXED_ORDER.filter(f => fixed.includes(f)), fen: toFen(pos, fullmove) };
}
const FIXED_ORDER = ['castling', 'en passant', 'halfmove', 'fullmove'];


/* ═══ Mateless · material.js — rung 1: the material test ═══════════════════════════════════

   Can the flagged side never be mated because the other side has too little material to mate at
   all? The first rung of the ladder (ladder.js), and the cheapest: a few reads of the piece sets,
   deciding on the first fact that settles it. Material never grows back (only a promotion adds a
   piece, and it needs a pawn, which the test counts), so a proof holds for the rest of the game.

   From the board it needs the piece sets and the colour of the squares; it generates no move. */

/** The material test. It holds when
      – the mater has nothing but its king; or
      – there are no pawns at all, the mater has bishops of one colour and nothing else, and the
        flagged side has no knight and no bishop of the other colour; or
      – there are no pawns at all, the mater has one knight and nothing else, and the flagged
        side has no bishop, knight or rook (queens do not count).
    Each of those facts is read straight off the bitboards, the commonest first. */
function materialTest(pos, flagged) {
  const lo = pos.lo, hi = pos.hi, mater = flagged ^ WHITE;
  if (lo[mater | ROOK] | hi[mater | ROOK] | lo[mater | QUEEN] | hi[mater | QUEEN]) return false;   // a rook or a queen
  const nL = lo[mater | KNIGHT], nH = hi[mater | KNIGHT], bL = lo[mater | BISHOP], bH = hi[mater | BISHOP];
  if (!(nL | nH | bL | bH)) return !(lo[mater | PAWN] | hi[mater | PAWN]);                          // king (and pawns)
  if (lo[WHITE | PAWN] | hi[WHITE | PAWN] | lo[BLACK | PAWN] | hi[BLACK | PAWN]) return false;
  const knights = lo[flagged | KNIGHT] | hi[flagged | KNIGHT];
  const fbL = lo[flagged | BISHOP], fbH = hi[flagged | BISHOP];
  if (nL | nH) {
    if (bL | bH || !isSingle(nL, nH)) return false;                                               // more than one knight
    return !(knights | fbL | fbH | lo[flagged | ROOK] | hi[flagged | ROOK]);
  }
  const dark = (bL | bH) & DARK_SQUARES, light = (bL | bH) & ~DARK_SQUARES;   // both words share the pattern
  if (dark && light) return false;                                                                 // bishops on both colours
  const otherColour = dark ? ~DARK_SQUARES : DARK_SQUARES;
  return !(knights | ((fbL | fbH) & otherColour));
}

/** The flagged side cannot be mated: its opponent has too little material. */
function materialCannotMate(pos, flagged) { return materialTest(pos, flagged); }


/* ═══ Mateless · lock.js — rung 2: the lock detector, and the two static tests together ═════

   Two tests prove, without searching, that the flagged side can never be mated:
     the material test (material.js): the mating side lacks the material to mate at all;
     the lock detector (here): pawns, kings and bishops form a structure that no series of legal
     moves can open. A knight, rook or queen on the board makes it fail at once. It reads the bitboards only: it generates no move and searches nothing.
   They are the first two rungs of a ladder: the material test, the lock detector, then the
   Domino search (domino.js), which asks the same two tests at its nodes. A king that must step
   out of a pawn's check into a lock, or must take the last queen or rook, is left to the search
   (one ply). Most positions fail
   them on a fact or two, so both read the bitboards directly and return at the first fact that
   decides. Only a position that passes the lock detector's quick checks gets the full census
   below, which its fixed point reads.

   From the board it needs the piece sets, the en passant square and a few shifts of a set of
   squares; it generates no move and searches nothing. */

/* The census of the lock detector, taken into this typed array (pairs of words, see the C_
   indices), so that its fixed-point loop reads plain int32 values. It is module state, shared by
   every call: the engine is not re-entrant (see the notes on porting in index.js). */
const census = new Int32Array(12);
const C_WHITE_PAWNS = 0, C_BLACK_PAWNS = 2, C_WHITE_KING = 4, C_BLACK_KING = 6,
      C_WHITE_BISHOPS = 8, C_BLACK_BISHOPS = 10;

function takeCensus(pos) {
  const lo = pos.lo, hi = pos.hi, c = census;
  for (let side = 0; side < 2; side++) {
    const color = side ? BLACK : WHITE, at = 2 * side;   // White's entries first, Black's two words later
    c[C_WHITE_PAWNS + at] = lo[color | PAWN];   c[C_WHITE_PAWNS + at + 1] = hi[color | PAWN];
    c[C_WHITE_KING + at] = lo[color | KING];    c[C_WHITE_KING + at + 1] = hi[color | KING];
    c[C_WHITE_BISHOPS + at] = lo[color | BISHOP]; c[C_WHITE_BISHOPS + at + 1] = hi[color | BISHOP];
  }
}

/** Does a side have two bishops on squares of one colour (only a promotion makes that)? */
function twinBishops(lo, hi) {
  if (!(lo | hi)) return false;
  return popcount(lo & DARK_SQUARES) + popcount(hi & DARK_SQUARES) > 1 ||
         popcount(lo & ~DARK_SQUARES) + popcount(hi & ~DARK_SQUARES) > 1;
}

/* ─── The lock detector ────────────────────────────────────────────────────────────────

   It certifies that the flagged side can never be mated, in positions with kings, pawns and
   bishops only. Any knight, rook or queen on the board fails it at once. (Boxed-in knights,
   rooks and queens, whose every square is walled in by fixed pawns, could be allowed too; that
   rule was measured and left out: one practical row in 201,060. Two more rules were measured
   and left to the Domino search: a lock the flagged king enters by stepping out of a pawn's
   check, and a last knight, rook or queen that must be captured. On chasolver's 201,060 Lichess
   rows they prove no row the search does not, and in games played move by move the flags come
   down at the same plies, at the same cost per move within the noise.)

   The certificate is tried up to three times: once with both kings free, then assuming the
   white king, then the black king, frozen on its square (a frozen king is a wall for both
   sides and must turn out not to be able to move). A level is tried only when its frozen king
   has no neighbouring square that some pawn neither holds nor attacks: otherwise it would fail
   its own check anyway.

   Each level grows these sets to a fixed point:
     wCone   squares White's pawns may still reach              grows
     bCone   squares Black's pawns may still reach              grows
     wFixed  white pawns that can never move                    shrinks
     bFixed  black pawns that can never move                    shrinks
     wKing   squares the white king may reach                   grows
     bKing   squares the black king may reach                   grows
     wBish   squares White's bishops may reach                  grows
     bBish   squares Black's bishops may reach                  grows
     bTake   squares where Black may capture a white pawn       grows
     wTake   squares where White may capture a black pawn       grows
   and recomputes two derived sets on every pass:
     wWall   white men that are walls: untakeable white pawns and the frozen king
     bWall   the same for Black
   The plain loop updates all ten sets on every pass (the Rust engine keeps it as
   lock_leaks_reference, and rust/examples/lockcheck.rs compares the two). They do not all
   depend on each other, though. The cycle is walls -> fixed pawns -> king reaches ->
   capture squares -> walls; the cones and the bishops' reaches are read only by the leak tests,
   never by the cycle. So the cycle runs alone, on six sets, flooding each king reach and capture
   set to its end against the walls of the pass, until a pass changes nothing; a pass that finds
   the walls and the fixed pawns as they were stops at once, since the kings and the capture
   squares are then already closed. The cones and the bishops' reaches are computed once, at the
   end, from the final walls and fixed pawns. This changes no verdict: every update is monotone
   (the walls and the fixed pawns only shrink, everything else only grows), so the cycle reaches
   the plain loop's fixed point, and a set flooded step by step against growing masks ends where one
   flood against the last mask ends. Two cheap leaks come first or early: the cones against the
   first (largest) walls are a lower bound of the final cones, so a promotion or a capture they
   show is a leak at once; and a frozen king that moves leaks in whichever pass it does. The
   cones and the capture squares are occluded fills (Kogge-Stone, three shifts each). On Lichess
   locks the cycle runs one full pass and one that stops at once (growing every set by one step
   per pass takes ~11 passes). Pawn-only structures never touch the bishop code.

   At the fixed point the structure leaks, and the level fails, if any of these holds:
     a pawn can promote; a pawn can capture; the frozen king can move; a bishop can reach a
     pawn's path; or the flagged king can reach a square the mater attacks where it has no
     guaranteed flight. */
/* Occluded fills on (lo, hi) pairs, returned through fillLo / fillHi: every square reachable from
   g by steps north (south) through squares of p, in three shifts (8, 16, 32) instead of up to six
   dependent steps. */
let fillLo = 0, fillHi = 0;
function fillNorth(gL, gH, pL, pH) {
  let sH = (gH << 8) | (gL >>> 24);
  gL |= pL & (gL << 8); gH |= pH & sH;
  const qL = pL & (pL << 8), qH = pH & ((pH << 8) | (pL >>> 24));
  sH = (gH << 16) | (gL >>> 16);
  gL |= qL & (gL << 16); gH |= qH & sH;
  gH |= qH & ((qH << 16) | (qL >>> 16)) & gL;          // the 32-step only fills the hi word from lo
  fillLo = gL; fillHi = gH;
}
function fillSouth(gL, gH, pL, pH) {
  let sL = (gL >>> 8) | (gH << 24);
  gH |= pH & (gH >>> 8); gL |= pL & sL;
  const qL = pL & ((pL >>> 8) | (pH << 24)), qH = pH & (pH >>> 8);
  sL = (gL >>> 16) | (gH << 16);
  gH |= qH & (gH >>> 16); gL |= qL & sL;
  gL |= qL & ((qL >>> 16) | (qH << 16)) & gH;          // the 32-step only fills the lo word from hi
  fillLo = gL; fillHi = gH;
}

/** Bits naming the side to be proven unable to be mated (the flagged side), for the functions
    that answer for both sides at once (cannotMate2, Domino.run2, proveBoth): a game's two
    flags, and a dead position, need both answers. */
const FLAGGED_WHITE = 1, FLAGGED_BLACK = 2;

/* A level is computed in two parts. lockLevelLeaks runs everything that does not depend on which
   side is flagged and reports the leaks that fail the level for either side; when there is none,
   it leaves the sets the mating net reads in these variables (module state, like the census), and
   netLeaks reads them for one side. Both sides at once (lockTest2) compute a level once and its
   net twice. */
let netWConeL = 0, netWConeH = 0, netBConeL = 0, netBConeH = 0, netWKingL = 0, netWKingH = 0,
    netBKingL = 0, netBKingH = 0, netWBishL = 0, netWBishH = 0, netBBishL = 0, netBBishH = 0;
// The fixed pawns of the same level: the net does not read them, lockSets does.
let netWFixedL = 0, netWFixedH = 0, netBFixedL = 0, netBFixedH = 0;

/** Does the structure leak to the flagged king at this level (king frL/frH frozen; 0: none)? */
function lockLeaks(flagged, frL, frH) { return lockLevelLeaks(frL, frH) || netLeaks(flagged); }

/** The same level for both sides: of the sides in `ask` (FLAGGED_* bits), those whose king the
    structure leaks to. */
function lockLeaks2(ask, frL, frH) {
  if (lockLevelLeaks(frL, frH)) return ask;
  return ((ask & FLAGGED_WHITE) && netLeaks(WHITE) ? FLAGGED_WHITE : 0) |
         ((ask & FLAGGED_BLACK) && netLeaks(BLACK) ? FLAGGED_BLACK : 0);
}

/** A level up to the mating net: true when the structure leaks whichever side is flagged. */
function lockLevelLeaks(frL, frH) {
  const c = census;
  const wpL = c[C_WHITE_PAWNS], wpH = c[C_WHITE_PAWNS + 1], bpL = c[C_BLACK_PAWNS], bpH = c[C_BLACK_PAWNS + 1];
  const wkL = c[C_WHITE_KING], wkH = c[C_WHITE_KING + 1], bkL = c[C_BLACK_KING], bkH = c[C_BLACK_KING + 1];

  // Which king, if any, is frozen at this level, and the zone the other king may never enter.
  const frozenWhite = ((frL & wkL) | (frH & wkH)) !== 0;
  const frozenBlack = !frozenWhite && (frL | frH) !== 0;
  const nearFrozenBlackL = frozenBlack ? zoneLo(bkL, bkH) : 0, nearFrozenBlackH = frozenBlack ? zoneHi(bkL, bkH) : 0;
  const nearFrozenWhiteL = frozenWhite ? zoneLo(wkL, wkH) : 0, nearFrozenWhiteH = frozenWhite ? zoneHi(wkL, wkH) : 0;

  // Quick leak: the cones against the first walls (the capture squares are only the kings' squares yet).
  {
    const wwL = (wpL & ~bkL) | frL, wwH = (wpH & ~bkH) | frH, bwL = (bpL & ~wkL) | frL, bwH = (bpH & ~wkH) | frH;
    fillNorth(wpL, wpH, ~bwL, ~bwH); const wcL = fillLo, wcH = fillHi;
    fillSouth(bpL, bpH, ~wwL, ~wwH); const bcL = fillLo, bcH = fillHi;
    if ((wcH & RANK_8) | (bcL & RANK_1)) return true;
    const sL = sideways(wcL), sH = sideways(wcH);
    if ((northLo(sL) & bcL) | (northHi(sL, sH) & bcH)) return true;
  }

  // The cycle: walls -> fixed pawns -> king reaches -> capture squares.
  let wFixedL = wpL, wFixedH = wpH, bFixedL = bpL, bFixedH = bpH;
  let wKingL = wkL, wKingH = wkH, bKingL = bkL, bKingH = bkH;
  let bTakeL = bkL, bTakeH = bkH, wTakeL = wkL, wTakeH = wkH;
  let wWallL = -1, wWallH = -1, bWallL = -1, bWallH = -1;
  for (;;) {
    const pwL = wWallL, pwH = wWallH, pbL = bWallL, pbH = bWallH;
    // wWall = white pawns Black can never take | frozen king; bWall likewise
    wWallL = (wpL & ~bTakeL) | frL; wWallH = (wpH & ~bTakeH) | frH;
    bWallL = (bpL & ~wTakeL) | frL; bWallH = (bpH & ~wTakeH) | frH;
    // wFixed &= wWall & south(bWall | wFixed); bFixed &= bWall & north(wWall | bFixed)
    let tL = bWallL | wFixedL, tH = bWallH | wFixedH;
    const nwFixedL = wFixedL & wWallL & southLo(tL, tH), nwFixedH = wFixedH & wWallH & southHi(tH);
    tL = wWallL | bFixedL; tH = wWallH | bFixedH;
    const nbFixedL = bFixedL & bWallL & northLo(tL), nbFixedH = bFixedH & bWallH & northHi(tL, tH);
    // The same walls and fixed pawns as the pass before: kings and capture squares are closed.
    if (wWallL === pwL && wWallH === pwH && bWallL === pbL && bWallH === pbH &&
        nwFixedL === wFixedL && nwFixedH === wFixedH && nbFixedL === bFixedL && nbFixedH === bFixedH) break;
    // wKing |= zone(wKing) & ~(wFixed | black fixed pawns' captures | zone of a frozen black king)
    const bHitL = sideways(southLo(nbFixedL, nbFixedH)), bHitH = sideways(southHi(nbFixedH));
    const wHitL = sideways(northLo(nwFixedL)), wHitH = sideways(northHi(nwFixedL, nwFixedH));
    const mwL = ~(nwFixedL | bHitL | nearFrozenBlackL), mwH = ~(nwFixedH | bHitH | nearFrozenBlackH);
    const mbL = ~(nbFixedL | wHitL | nearFrozenWhiteL), mbH = ~(nbFixedH | wHitH | nearFrozenWhiteH);
    let nwKingL = wKingL, nwKingH = wKingH, nbKingL = bKingL, nbKingH = bKingH;
    for (;;) {   // both kings at once
      const aL = nwKingL | (zoneLo(nwKingL, nwKingH) & mwL), aH = nwKingH | (zoneHi(nwKingL, nwKingH) & mwH);
      const dL = nbKingL | (zoneLo(nbKingL, nbKingH) & mbL), dH = nbKingH | (zoneHi(nbKingL, nbKingH) & mbH);
      if (aL === nwKingL && aH === nwKingH && dL === nbKingL && dH === nbKingH) break;
      nwKingL = aL; nwKingH = aH; nbKingL = dL; nbKingH = dH;
    }
    // The frozen king can move after all.
    if (frozenWhite && ((nwKingL ^ wkL) | (nwKingH ^ wkH))) return true;
    if (frozenBlack && ((nbKingL ^ bkL) | (nbKingH ^ bkH))) return true;
    // bTake |= bKing | south(bTake & ~bWall); wTake |= wKing | north(wTake & ~wWall)
    tL = bTakeL | nbKingL; tH = bTakeH | nbKingH;
    fillSouth(tL & ~bWallL, tH & ~bWallH, ~bWallL, ~bWallH);
    const nbTakeL = tL | southLo(fillLo, fillHi), nbTakeH = tH | southHi(fillHi);
    tL = wTakeL | nwKingL; tH = wTakeH | nwKingH;
    fillNorth(tL & ~wWallL, tH & ~wWallH, ~wWallL, ~wWallH);
    const nwTakeL = tL | northLo(fillLo), nwTakeH = tH | northHi(fillLo, fillHi);
    const changed =
      (nwFixedL ^ wFixedL) | (nwFixedH ^ wFixedH) | (nbFixedL ^ bFixedL) | (nbFixedH ^ bFixedH) |
      (nwKingL ^ wKingL) | (nwKingH ^ wKingH) | (nbKingL ^ bKingL) | (nbKingH ^ bKingH) |
      (nbTakeL ^ bTakeL) | (nbTakeH ^ bTakeH) | (nwTakeL ^ wTakeL) | (nwTakeH ^ wTakeH);
    wFixedL = nwFixedL; wFixedH = nwFixedH; bFixedL = nbFixedL; bFixedH = nbFixedH;
    wKingL = nwKingL; wKingH = nwKingH; bKingL = nbKingL; bKingH = nbKingH;
    bTakeL = nbTakeL; bTakeH = nbTakeH; wTakeL = nwTakeL; wTakeH = nwTakeH;
    if (!changed) break;
  }

  // The cones, once, against the final walls.
  fillNorth(wpL, wpH, ~bWallL, ~bWallH); const wConeL = fillLo, wConeH = fillHi;
  fillSouth(bpL, bpH, ~wWallL, ~wWallH); const bConeL = fillLo, bConeH = fillHi;
  // A pawn can still promote.
  if ((wConeH & RANK_8) | (bConeL & RANK_1)) return true;
  // A white pawn can capture on a square a black pawn may reach.
  let tL = sideways(wConeL), tH = sideways(wConeH);
  if ((northLo(tL) & bConeL) | (northHi(tL, tH) & bConeH)) return true;
  // The bishops' reaches, once, against the final fixed pawns.
  let wBishL = c[C_WHITE_BISHOPS], wBishH = c[C_WHITE_BISHOPS + 1];
  let bBishL = c[C_BLACK_BISHOPS], bBishH = c[C_BLACK_BISHOPS + 1];
  if (wBishL | wBishH | bBishL | bBishH) {
    const mL = ~(wFixedL | bFixedL), mH = ~(wFixedH | bFixedH);
    for (;;) { const aL = wBishL | (diagonalLo(wBishL, wBishH) & mL), aH = wBishH | (diagonalHi(wBishL, wBishH) & mH);
      const dL = bBishL | (diagonalLo(bBishL, bBishH) & mL), dH = bBishH | (diagonalHi(bBishL, bBishH) & mH);
      if (aL === wBishL && aH === wBishH && dL === bBishL && dH === bBishH) break;
      wBishL = aL; wBishH = aH; bBishL = dL; bBishH = dH; }
    // A bishop is diagonally next to a square an enemy pawn may reach.
    if ((diagonalLo(wBishL, wBishH) & bConeL) | (diagonalHi(wBishL, wBishH) & bConeH)) return true;
    if ((diagonalLo(bBishL, bBishH) & wConeL) | (diagonalHi(bBishL, bBishH) & wConeH)) return true;
  }

  netWConeL = wConeL; netWConeH = wConeH; netBConeL = bConeL; netBConeH = bConeH;
  netWKingL = wKingL; netWKingH = wKingH; netBKingL = bKingL; netBKingH = bKingH;
  netWBishL = wBishL; netWBishH = wBishH; netBBishL = bBishL; netBBishH = bBishH;
  netWFixedL = wFixedL; netWFixedH = wFixedH; netBFixedL = bFixedL; netBFixedH = bFixedH;
  return false;
}

/* The mating net, on the sets lockLevelLeaks left. attack: squares the mater's bishops and pawns
   attack; reach: where the flagged king may go; free: squares that nothing ever occupies or
   attacks and that the mater's king never comes next to; spare: free squares the flagged side's
   own bishops never reach. A king on a square next to a spare square, or with free squares both
   vertically and horizontally next to it, always has a flight. Any attacked square the flagged
   king may reach without such a flight could host a mate. */
function netLeaks(flagged) {
  const wConeL = netWConeL, wConeH = netWConeH, bConeL = netBConeL, bConeH = netBConeH;
  const wKingL = netWKingL, wKingH = netWKingH, bKingL = netBKingL, bKingH = netBKingH;
  const wBishL = netWBishL, wBishH = netWBishH, bBishL = netBBishL, bBishH = netBBishH;
  let attackL, attackH, reachL, reachH, freeL, freeH, spareL, spareH;
  if (flagged === WHITE) {
    attackL = diagonalLo(bBishL, bBishH) | sideways(southLo(bConeL, bConeH));
    attackH = diagonalHi(bBishL, bBishH) | sideways(southHi(bConeH));
    reachL = wKingL; reachH = wKingH;
    freeL = ~(wConeL | zoneLo(bKingL, bKingH) | attackL);
    freeH = ~(wConeH | zoneHi(bKingL, bKingH) | attackH);
    spareL = freeL & ~wBishL; spareH = freeH & ~wBishH;
  } else {
    attackL = diagonalLo(wBishL, wBishH) | sideways(northLo(wConeL));
    attackH = diagonalHi(wBishL, wBishH) | sideways(northHi(wConeL, wConeH));
    reachL = bKingL; reachH = bKingH;
    freeL = ~(bConeL | zoneLo(wKingL, wKingH) | attackL);
    freeH = ~(bConeH | zoneHi(wKingL, wKingH) | attackH);
    spareL = freeL & ~bBishL; spareH = freeH & ~bBishH;
  }
  const flightL = sideways(spareL) | northLo(spareL) | southLo(spareL, spareH) |
                  ((northLo(freeL) | southLo(freeL, freeH)) & sideways(freeL));
  const flightH = sideways(spareH) | northHi(spareL, spareH) | southHi(spareH) |
                  ((northHi(freeL, freeH) | southHi(freeH)) & sideways(freeH));
  return ((attackL & reachL & ~flightL) | (attackH & reachH & ~flightH)) !== 0;
}

/** The lock detector: can `flagged` never be mated, by the structure of pawns, kings and bishops? */
function lockTest(pos, flagged) {
  const lo = pos.lo, hi = pos.hi;
  // No knight, rook or queen may stand on the board (the usual case in a game: tested first).
  if (lo[WHITE | KNIGHT] | hi[WHITE | KNIGHT] | lo[BLACK | KNIGHT] | hi[BLACK | KNIGHT] |
      lo[WHITE | ROOK] | hi[WHITE | ROOK] | lo[BLACK | ROOK] | hi[BLACK | ROOK] |
      lo[WHITE | QUEEN] | hi[WHITE | QUEEN] | lo[BLACK | QUEEN] | hi[BLACK | QUEEN]) return false;
  if (pos.ep !== NO_SQUARE) return false;
  if (twinBishops(lo[WHITE | BISHOP], hi[WHITE | BISHOP]) || twinBishops(lo[BLACK | BISHOP], hi[BLACK | BISHOP])) return false;
  takeCensus(pos);
  const c = census;
  const wpL = c[C_WHITE_PAWNS], wpH = c[C_WHITE_PAWNS + 1], bpL = c[C_BLACK_PAWNS], bpH = c[C_BLACK_PAWNS + 1];
  if (!lockLeaks(flagged, 0, 0)) return true;
  // Squares held or attacked by some pawn: a frozen king needs all its neighbours among them.
  const pawnL = northLo(wpL) | southLo(bpL, bpH), pawnH = northHi(wpL, wpH) | southHi(bpH);
  const heldL = wpL | bpL | sideways(pawnL), heldH = wpH | bpH | sideways(pawnH);
  for (let kingAt = C_WHITE_KING; kingAt <= C_BLACK_KING; kingAt += 2) {   // White's king frozen, then Black's
    const kL = c[kingAt], kH = c[kingAt + 1], sq = firstSquare(kL, kH);
    if ((KING_STEPS[2 * sq] & ~heldL) | (KING_STEPS[2 * sq + 1] & ~heldH)) continue;
    if (!lockLeaks(flagged, kL, kH)) return true;
  }
  return false;
}

/** The certificate itself, for tests and for showing a lock: null when the lock detector does not
    prove `flagged` unable to be mated, otherwise the sets of the level that proves it, each a
    [lo, hi] pair of words: the pawns' cones (wCone, bCone: every square a pawn may still reach),
    the pawns that can never move (wFixed, bFixed), the kings' reaches (wKing, bKing), the bishops'
    reaches (wBish, bBish), and the frozen king's square (frozen; [0, 0] when both kings are free).
    It computes the levels again, so it costs a few lock tests; the arbiter never calls it. */
function lockSets(pos, flagged) {
  if (!lockTest(pos, flagged)) return null;
  takeCensus(pos);
  const c = census;
  const wpL = c[C_WHITE_PAWNS], wpH = c[C_WHITE_PAWNS + 1], bpL = c[C_BLACK_PAWNS], bpH = c[C_BLACK_PAWNS + 1];
  const pawnL = northLo(wpL) | southLo(bpL, bpH), pawnH = northHi(wpL, wpH) | southHi(bpH);
  const heldL = wpL | bpL | sideways(pawnL), heldH = wpH | bpH | sideways(pawnH);
  const levels = [[0, 0]];
  for (let kingAt = C_WHITE_KING; kingAt <= C_BLACK_KING; kingAt += 2) {
    const kL = c[kingAt], kH = c[kingAt + 1], sq = firstSquare(kL, kH);
    if (!((KING_STEPS[2 * sq] & ~heldL) | (KING_STEPS[2 * sq + 1] & ~heldH))) levels.push([kL, kH]);
  }
  for (const [frL, frH] of levels) {
    if (lockLeaks(flagged, frL, frH)) continue;
    return {
      wCone: [netWConeL, netWConeH], bCone: [netBConeL, netBConeH],
      wFixed: [netWFixedL, netWFixedH], bFixed: [netBFixedL, netBFixedH],
      wKing: [netWKingL, netWKingH], bKing: [netBKingL, netBKingH],
      wBish: [netWBishL, netWBishH], bBish: [netBBishL, netBBishH],
      frozen: [frL, frH],
    };
  }
  throw new Error('lockSets: the lock test and its levels disagree');
}

/** The flagged side cannot be mated: the lock detector certifies it. */
function lockCannotMate(pos, flagged) { return lockTest(pos, flagged); }
/** The static tests, the first two rungs of the ladder: either of the two. */
function cannotMate(pos, flagged) { return materialTest(pos, flagged) || lockTest(pos, flagged); }

/** The lock detector for both sides at once: of the sides in `ask` (FLAGGED_* bits), those it
    proves unable to be mated, the same answers as lockTest with each side flagged. A level is
    computed once for both; a side is proven at the first level that does not leak to it. */
function lockTest2(pos, ask) {
  const lo = pos.lo, hi = pos.hi;
  if (lo[WHITE | KNIGHT] | hi[WHITE | KNIGHT] | lo[BLACK | KNIGHT] | hi[BLACK | KNIGHT] |
      lo[WHITE | ROOK] | hi[WHITE | ROOK] | lo[BLACK | ROOK] | hi[BLACK | ROOK] |
      lo[WHITE | QUEEN] | hi[WHITE | QUEEN] | lo[BLACK | QUEEN] | hi[BLACK | QUEEN]) return 0;
  if (pos.ep !== NO_SQUARE) return 0;
  if (twinBishops(lo[WHITE | BISHOP], hi[WHITE | BISHOP]) || twinBishops(lo[BLACK | BISHOP], hi[BLACK | BISHOP])) return 0;
  takeCensus(pos);
  const c = census;
  let open = lockLeaks2(ask, 0, 0);            // the asked sides not proven yet
  if (!open) return ask;
  const wpL = c[C_WHITE_PAWNS], wpH = c[C_WHITE_PAWNS + 1], bpL = c[C_BLACK_PAWNS], bpH = c[C_BLACK_PAWNS + 1];
  const pawnL = northLo(wpL) | southLo(bpL, bpH), pawnH = northHi(wpL, wpH) | southHi(bpH);
  const heldL = wpL | bpL | sideways(pawnL), heldH = wpH | bpH | sideways(pawnH);
  for (let kingAt = C_WHITE_KING; kingAt <= C_BLACK_KING; kingAt += 2) {
    const kL = c[kingAt], kH = c[kingAt + 1], sq = firstSquare(kL, kH);
    if ((KING_STEPS[2 * sq] & ~heldL) | (KING_STEPS[2 * sq + 1] & ~heldH)) continue;
    open = lockLeaks2(open, kL, kH);
    if (!open) return ask;
  }
  return ask & ~open;
}

/** The static tests for both sides at once: of the sides in `ask` (FLAGGED_* bits), those the
    material test or the lock detector proves unable to be mated (cannotMate with each side flagged). */
function cannotMate2(pos, ask) { return staticTests2(pos, ask, TESTS_BOTH); }

/* ─── When the static tests can change ─────────────────────────────────────────────────

   The material test reads the pieces only, so only a capture or a promotion changes its answer.
   The lock detector reads the pawns, the kings' and bishops' squares and the en passant square:
   a capture or a pawn move changes the structure; a move after a double step can let the en
   passant right lapse (the detector fails while it stands); and a king in a pawn's check stands on
   a square its reach would leave out, so its step out of the check can complete a lock. Any other
   king or bishop move stays inside its reach and leaves the fixed point as it was, and a knight,
   rook or queen on the board fails the detector whatever it does.

   (A check by a bishop changes nothing: the kings' reaches do not look at bishops. A check by a
   knight, rook or queen neither: the detector fails while one stands.)

   So the search asks after a move only the tests it can have changed (testsAfter). That proves
   the same positions with the same node counts as asking both after every capture or pawn move
   and one ply later (the clock rule, halfmove <= 1, which needs no memory of the move before: a pawn's check comes only from the move just played, so the ply after covers the
   step out of it). A test not asked can only cost a proof, never make a false one. */
const TEST_MATERIAL = 1, TEST_LOCK = 2, TESTS_BOTH = 3;

/** The static tests whose answer a move can change: a capture, a promotion, a pawn's move, a move
    made while an en passant square stood (epBefore) or while in a pawn's check (pawnCheck). */
function testsAfter(capture, promotion, pawn, epBefore, pawnCheck) {
  return (capture || promotion ? TEST_MATERIAL : 0) | (capture || pawn || epBefore || pawnCheck ? TEST_LOCK : 0);
}

/** Is the side to move in check by a pawn? */
function pawnCheck(pos) {
  const lo = pos.lo, hi = pos.hi;
  if (pos.side === WHITE) {
    const kL = lo[WHITE | KING], kH = hi[WHITE | KING];   // black pawns attack it from the diagonals ahead
    return ((sideways(northLo(kL)) & lo[BLACK | PAWN]) | (sideways(northHi(kL, kH)) & hi[BLACK | PAWN])) !== 0;
  }
  const kL = lo[BLACK | KING], kH = hi[BLACK | KING];
  return ((sideways(southLo(kL, kH)) & lo[WHITE | PAWN]) | (sideways(southHi(kH)) & hi[WHITE | PAWN])) !== 0;
}

/** The static tests in `tests` (TEST_* bits) for `flagged`. */
function staticTests(pos, flagged, tests) {
  return ((tests & TEST_MATERIAL) !== 0 && materialTest(pos, flagged)) || ((tests & TEST_LOCK) !== 0 && lockTest(pos, flagged));
}

/** The static tests in `tests` for the sides in `ask`: the sides proven. */
function staticTests2(pos, ask, tests) {
  let proven = 0;
  if (tests & TEST_MATERIAL) {
    if ((ask & FLAGGED_WHITE) && materialTest(pos, WHITE)) proven |= FLAGGED_WHITE;
    if ((ask & FLAGGED_BLACK) && materialTest(pos, BLACK)) proven |= FLAGGED_BLACK;
  }
  const rest = ask & ~proven;
  return rest && (tests & TEST_LOCK) ? proven | lockTest2(pos, rest) : proven;
}


/* ═══ Mateless · domino.js — rung 3: the Domino search ═════════════════════════════════════

   A short helpmate search, with a memory of the positions it has met: it settles the positions
   the static tests leave and a few forced moves decide (see Domino below).

   From the board it needs the legal moves of a position, one piece at a time and in a fixed order
   (MoveContext, computeContext, legalTargets, stuckPawns, flagsOf), moves made and taken back in
   place (doMove, undoMove), "is there a legal move?" (hasLegalMove), and an exact code of a
   position with its hash (writeKey, hashKey). With another board, in another order, the node
   counts can change; what a proof proves does not. */

/* The search's memory of positions: a set, held as an open-addressing hash table with linear
   probing. A slot is twelve words: the number of the search that filled it, the hash, the nine
   words of the position's code, and the sides that have met it (FLAGGED_* bits, for run2, whose
   two searches share the table). A lookup compares the full code, so it can only find the very
   same position.

   Because slots carry the number of their search, starting a new search clears the table in
   constant time. A Domino search plays at most a hundred moves, so it stays in its first table
   (256 slots, 12 KB, in the first-level cache); the table still doubles when it is 70% full, into a table of the next size
   (tables of each size are kept for later searches), for callers that give a larger budget. */
const MEMO_START_BITS = 8, SLOT = 12;
class PositionSet {
  constructor() {
    this.tables = [];
    this.generation = 1;
    this.bits = MEMO_START_BITS;
    this.slots = this.table(MEMO_START_BITS);
    this.mask = (1 << MEMO_START_BITS) - 1;
    this.count = 0;
    this.limit = 0;
  }

  table(bits) {
    if (bits > 26) fail('position set too large');
    return this.tables[bits] || (this.tables[bits] = new Int32Array(SLOT << bits));
  }

  clear() {
    if (this.generation === 0x7fffffff) {
      for (const t of this.tables) if (t) for (let i = 0; i < t.length; i += SLOT) t[i] = 0;
      this.generation = 0;
    }
    this.generation++;
    this.bits = MEMO_START_BITS;
    this.slots = this.table(MEMO_START_BITS);
    this.mask = (1 << MEMO_START_BITS) - 1;
    this.limit = Math.floor(0.7 * (this.mask + 1));
    this.count = 0;
  }

  /** Adds the position with code k[at…] and hash h. Returns false when it was there already. */
  add(k, at, h) {
    const slots = this.slots, gen = this.generation, mask = this.mask;
    let slot = h & mask;
    for (;;) {
      const i = slot * SLOT;
      if (slots[i] !== gen) break;
      if (slots[i + 1] === h && slots[i + 2] === k[at] && slots[i + 3] === k[at + 1] && slots[i + 4] === k[at + 2] &&
          slots[i + 5] === k[at + 3] && slots[i + 6] === k[at + 4] && slots[i + 7] === k[at + 5] &&
          slots[i + 8] === k[at + 6] && slots[i + 9] === k[at + 7] && slots[i + 10] === k[at + 8]) return false;
      slot = (slot + 1) & mask;
    }
    const i = slot * SLOT;
    slots[i] = gen;
    slots[i + 1] = h;
    for (let j = 0; j < KEY_WORDS; j++) slots[i + 2 + j] = k[at + j];
    if (++this.count > this.limit) this.grow();
    return true;
  }

  /** Adds the position for the sides in `live` (FLAGGED_* bits) and returns those of them that
      had not met it yet: one probe serves both searches of run2, and for each side the answer is
      the one its own set would give. */
  add2(k, at, h, live) {
    const slots = this.slots, gen = this.generation, mask = this.mask;
    let slot = h & mask;
    for (;;) {
      const i = slot * SLOT;
      if (slots[i] !== gen) break;
      if (slots[i + 1] === h && slots[i + 2] === k[at] && slots[i + 3] === k[at + 1] && slots[i + 4] === k[at + 2] &&
          slots[i + 5] === k[at + 3] && slots[i + 6] === k[at + 4] && slots[i + 7] === k[at + 5] &&
          slots[i + 8] === k[at + 6] && slots[i + 9] === k[at + 7] && slots[i + 10] === k[at + 8]) {
        const fresh = live & ~slots[i + 11];
        slots[i + 11] |= fresh;
        return fresh;
      }
      slot = (slot + 1) & mask;
    }
    const i = slot * SLOT;
    slots[i] = gen;
    slots[i + 1] = h;
    for (let j = 0; j < KEY_WORDS; j++) slots[i + 2 + j] = k[at + j];
    slots[i + 11] = live;
    if (++this.count > this.limit) this.grow();
    return live;
  }

  /** Moves every slot of this search into the table of the next size. */
  grow() {
    const from = this.slots, oldSize = this.mask + 1, gen = this.generation;
    this.bits++;
    const to = this.table(this.bits), mask = (1 << this.bits) - 1;
    for (let s = 0; s < oldSize; s++) {
      const i = s * SLOT;
      if (from[i] !== gen) continue;
      let slot = from[i + 1] & mask;
      while (to[slot * SLOT] === gen) slot = (slot + 1) & mask;
      const j = slot * SLOT;
      for (let w = 0; w < SLOT; w++) to[j + w] = from[i + w];
    }
    this.slots = to;
    this.mask = mask;
    this.limit = Math.floor(0.7 * (mask + 1));
  }
}

/* A short helpmate search, the third rung of the ladder (material test, lock detector, Domino
   search). It settles the positions the static tests do not, but a few forced moves do: a king
   that must take the last queen or rook, a king that must step out of a pawn's check into a
   lock, a capture that leaves stalemate or bare material ("Domino" positions).

   It proves that the flagged side can never be mated by following every line in which both
   sides cooperate, and returns true only when every line ends without mating the flagged king:
     – in a position already met in this search (its lines are covered where it was first met);
     – in a position the static tests prove (see below);
     – in a position without legal moves that is not the flagged side checkmated.
   Any other end fails the proof, and the search stops at the first failure:
     'mate'     a line mates the flagged king;
     'horizon'  a line still has moves at the ply ceiling;
     'budget'   the node budget runs out.
   A failure proves nothing the arbiter acts on: it only ever acts on a proof.

   No move-count rule ends a line: the 50- and 75-move rules and repetitions play no part. A
   proof without them holds with them too, since they only cut lines short, so leaving them out
   can cost a proof but never make a false one; and the search's memory is a plain set of
   positions.

   After a move, a node asks only the static tests that move can have changed, and only while no
   en passant square is set (testsAfter in lock.js: the material test after a capture or a
   promotion; the lock detector after a capture, a pawn move, the lapse of an en passant right or
   a step out of a pawn's check). Asked at every node instead, they prove the same positions with
   the same node counts, about 15% slower (chasolver's 201,060 Lichess rows); asked by the clock
   rule (after a capture or a pawn move and one ply later) they do too. At the root they are asked
   unless the caller has settled them already (rootStatic: false, see ladder.js).

   The ply ceiling and node budget default to 3 and 10 (DOMINO_PLY, DOMINO_BUDGET; 6 and 100
   until 26 November 2026). With them the ladder proves 203,828 of the 204,484 wrongly decided
   Lichess timeouts of chasolver's list of 19 November 2026 (99.68%; at 6 and 100, 204,448); a
   proof takes 1 node at the median, at most 8 nodes in 99% of the rows. The rest is for the full
   version, whose further gates (8 plies and 500 nodes, 25 and 10,000, 150 and 5,000,000) leave 1.
   In an open position the first line runs to the ceiling and fails there, after about as many
   nodes as plies. The budget pays for every move played, each promotion separately.

   Moves are generated lazily, one piece at a time, in the generator's order (from a1, b1, …
   to h8): a node plays the first piece's moves before it works out the second piece's, and so
   on. Most searches that fail, fail on their first line, and then the other moves of the nodes
   on that line are never generated. */
const DOMINO_PLY = 3, DOMINO_BUDGET = 10;

/** The static tests the move of a piece of type `type` to `to` (with `flags`) from `pos` can
    change (testsAfter in lock.js); checked: the side to move is in a pawn's check. */
function movedTests(pos, checked, type, to, flags) {
  const capture = (pos.board[to] !== 0 && (flags & FLAG_CASTLE) === 0) || (flags & FLAG_EP) !== 0;
  return testsAfter(capture, (flags & FLAG_PROMO) !== 0, type === PAWN, pos.ep !== NO_SQUARE, checked);
}

class Domino {
  constructor() {
    this.pos = new Position();
    this.seen = new PositionSet();
    /** One move-generation context per ply. */
    this.contexts = [];
    this.key = new Int32Array(KEY_WORDS);
    this.flagged = WHITE;
    this.budget = 0;
    this.failure = null;
    this.running = false;
    /** For run2: each side's budget and failure, and the sides whose search has failed. */
    this.budgetWhite = 0; this.budgetBlack = 0;
    this.failureWhite = null; this.failureBlack = null;
    this.dead = 0;
  }

  /** Runs the search from `root` and reports { proven, failure, budgetLeft }.
      rootStatic: false when the caller has already asked the static tests at the root. */
  run(root, flagged, maxPly = DOMINO_PLY, budget = DOMINO_BUDGET, { rootStatic = true } = {}) {
    if (flagged !== WHITE && flagged !== BLACK) fail('flagged must be WHITE or BLACK');
    if (!(maxPly >= 0) || !(budget >= 0)) fail('maxPly and budget must be numbers ≥ 0');
    if (!Number.isInteger(root.halfmove)) fail('the halfmove clock must be an integer');
    if (this.running) fail('the search was started again while running');
    this.running = true;
    try {
      while (this.contexts.length <= maxPly) this.contexts.push(new MoveContext());
      this.pos.copyFrom(root);
      this.seen.clear();
      this.flagged = flagged;
      this.budget = budget;
      this.failure = null;
      const proven = this.node(0, maxPly, rootStatic ? TESTS_BOTH : 0);
      if (!proven && !this.failure) fail('search failed without a reason');
      if (this.pos.undoTop !== 0) fail('search left moves on the board');
      return { proven, failure: proven ? null : this.failure, budgetLeft: Math.max(this.budget, 0) };
    } finally {
      this.running = false;
    }
  }

  /** tests: the static tests whose answer can have changed since the parent (testsAfter). */
  node(ply, depth, tests) {
    const pos = this.pos, key = this.key;
    writeKey(pos, key, 0);
    if (!this.seen.add(key, 0, hashKey(key, 0))) return true;     // met before: covered there
    if (tests && staticTests(pos, this.flagged, tests)) return true;

    const ctx = this.contexts[ply];
    if (depth === 0) {                                             // only "is there a legal move?" matters
      if (!hasLegalMove(pos, ctx)) return this.noLegalMove(ctx);
      this.failure = 'horizon';
      return false;
    }
    computeContext(pos, ctx);
    const us = pos.side, board = pos.board, checked = ctx.checks > 0 && pawnCheck(pos);
    stuckPawns(pos);                                               // pawns without a move are skipped
    const ownLo = pos.lo[us] & ~stuckLo, ownHi = pos.hi[us] & ~stuckHi;   // this node's pieces, in order
    let anyMove = false;
    for (let half = 0; half < 2; half++) {
      let own = half ? ownHi : ownLo;
      while (own) {
        const from = 32 * half + lowestBit(own);
        own &= own - 1;
        legalTargets(pos, from, ctx);
        let tLo = targetsLo, tHi = targetsHi;
        if (!(tLo | tHi)) continue;
        anyMove = true;
        const type = board[from] & 7;
        while (tLo | tHi) {
          let to;
          if (tLo) { to = lowestBit(tLo); tLo &= tLo - 1; } else { to = 32 + lowestBit(tHi); tHi &= tHi - 1; }
          const flags = flagsOf(pos, type, from, to), move = from | (to << 6) | (flags << 12);
          const choices = flags & FLAG_PROMO ? 4 : 1;
          const tests = movedTests(pos, checked, type, to, flags);
          for (let p = 0; p < choices; p++) {
            if (!(this.budget-- > 0)) { this.failure = 'budget'; return false; }
            doMove(pos, move, PROMOTION_ORDER[p]);
            const ok = this.node(ply + 1, depth - 1, pos.ep === NO_SQUARE ? tests : 0);
            undoMove(pos);
            if (!ok) return false;
          }
        }
      }
    }
    return anyMove || this.noLegalMove(ctx);
  }

  /** A node without legal moves ends its line. It fails only if the flagged king is mated. */
  noLegalMove(ctx) {
    if (this.pos.side === this.flagged && ctx.checks > 0) { this.failure = 'mate'; return false; }
    return true;
  }

  /** Both searches at once: for each side in `ask` (FLAGGED_* bits), the same result as run()
      with that side flagged. Returns [White flagged, Black flagged]; a side not asked is not
      proven and its budget is untouched.

      The two searches generate the same moves in the same order. They part only where the
      static tests prove one side and not the other, where a mate fails one of them, and once one
      of them has failed. So one walk serves both: each node carries the sides still searching it,
      a move is made once for both, each side pays its own budget for it and keeps its own mark in
      the set of positions met (one probe, two bits), and a side that fails stops paying and
      searching, as its own search would stop. With one side asked, that side's own search runs. */
  run2(root, ask, maxPly = DOMINO_PLY, budget = DOMINO_BUDGET, { rootStatic = true } = {}) {
    ask &= FLAGGED_WHITE | FLAGGED_BLACK;
    if (ask !== (FLAGGED_WHITE | FLAGGED_BLACK)) {
      const out = [{ proven: false, failure: null, budgetLeft: budget }, { proven: false, failure: null, budgetLeft: budget }];
      if (ask) out[ask >> 1] = this.run(root, ask === FLAGGED_WHITE ? WHITE : BLACK, maxPly, budget, { rootStatic });
      return out;
    }
    if (!(maxPly >= 0) || !(budget >= 0)) fail('maxPly and budget must be numbers ≥ 0');
    if (!Number.isInteger(root.halfmove)) fail('the halfmove clock must be an integer');
    if (this.running) fail('the search was started again while running');
    this.running = true;
    try {
      while (this.contexts.length <= maxPly) this.contexts.push(new MoveContext());
      this.pos.copyFrom(root);
      this.seen.clear();
      this.budgetWhite = budget; this.budgetBlack = budget;
      this.failureWhite = null; this.failureBlack = null;
      this.dead = 0;
      this.node2(0, maxPly, FLAGGED_WHITE | FLAGGED_BLACK, rootStatic ? TESTS_BOTH : 0);
      if (this.pos.undoTop !== 0) fail('search left moves on the board');
    } finally {
      this.running = false;
    }
    const result = (bit, failure, left) => {
      const proven = (this.dead & bit) === 0;
      return { proven, failure: proven ? null : failure, budgetLeft: Math.max(left, 0) };
    };
    return [result(FLAGGED_WHITE, this.failureWhite, this.budgetWhite), result(FLAGGED_BLACK, this.failureBlack, this.budgetBlack)];
  }

  node2(ply, depth, live, tests) {
    const pos = this.pos, key = this.key;
    writeKey(pos, key, 0);
    live = this.seen.add2(key, 0, hashKey(key, 0), live);         // a side that met it before: covered there
    if (!live) return;
    if (tests) { live &= ~staticTests2(pos, live, tests); if (!live) return; }

    const ctx = this.contexts[ply];
    if (depth === 0) {
      if (!hasLegalMove(pos, ctx)) this.noLegalMove2(ctx, live); else this.fail2(live, 'horizon');
      return;
    }
    computeContext(pos, ctx);
    const us = pos.side, board = pos.board, checked = ctx.checks > 0 && pawnCheck(pos);
    stuckPawns(pos);
    const ownLo = pos.lo[us] & ~stuckLo, ownHi = pos.hi[us] & ~stuckHi;
    let anyMove = false;
    for (let half = 0; half < 2; half++) {
      let own = half ? ownHi : ownLo;
      while (own) {
        const from = 32 * half + lowestBit(own);
        own &= own - 1;
        legalTargets(pos, from, ctx);
        let tLo = targetsLo, tHi = targetsHi;
        if (!(tLo | tHi)) continue;
        anyMove = true;
        const type = board[from] & 7;
        while (tLo | tHi) {
          let to;
          if (tLo) { to = lowestBit(tLo); tLo &= tLo - 1; } else { to = 32 + lowestBit(tHi); tHi &= tHi - 1; }
          const flags = flagsOf(pos, type, from, to), move = from | (to << 6) | (flags << 12);
          const choices = flags & FLAG_PROMO ? 4 : 1;
          const tests = movedTests(pos, checked, type, to, flags);
          for (let p = 0; p < choices; p++) {
            let spent = 0;
            if ((live & FLAGGED_WHITE) && !(this.budgetWhite-- > 0)) spent |= FLAGGED_WHITE;
            if ((live & FLAGGED_BLACK) && !(this.budgetBlack-- > 0)) spent |= FLAGGED_BLACK;
            if (spent) { this.fail2(spent, 'budget'); live &= ~spent; if (!live) return; }
            doMove(pos, move, PROMOTION_ORDER[p]);
            this.node2(ply + 1, depth - 1, live, pos.ep === NO_SQUARE ? tests : 0);
            undoMove(pos);
            live &= ~this.dead;                                      // a side that failed in there searches no more
            if (!live) return;
          }
        }
      }
    }
    if (!anyMove) this.noLegalMove2(ctx, live);
  }

  /** run2's noLegalMove: a mate fails the search in which the mated side is flagged. */
  noLegalMove2(ctx, live) {
    const mated = this.pos.side === WHITE ? FLAGGED_WHITE : FLAGGED_BLACK;
    if (ctx.checks > 0 && (live & mated)) this.fail2(mated, 'mate');
  }

  /** The searches of the sides in `mask` fail, for `why`. */
  fail2(mask, why) {
    const m = mask & ~this.dead;
    if (m & FLAGGED_WHITE) this.failureWhite = why;
    if (m & FLAGGED_BLACK) this.failureBlack = why;
    this.dead |= m;
  }
}


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

/* The flagged side is the one to be proven unable to be mated: "White can never mate" is the
   proof with Black flagged. The search is shared by every call (see the notes on porting in
   index.js). */
const sharedSearch = new Domino();

/** Can `flagged` never be mated? The static tests at the root, then the Domino search (by
    default 3 plies, 10 nodes). Returns { proven, staticProof, failure, foundBy, nodes }:
    staticProof says the static tests proved it at the root; failure is 'mate', 'horizon' or
    'budget' when nothing was proven ('mate' with foundBy 'search': the search played a line
    that mates); nodes counts the moves the search played. */
function proveCannotBeMated(pos, flagged, { maxPly = DOMINO_PLY, budget = DOMINO_BUDGET } = {}) {
  if (cannotMate(pos, flagged)) return { proven: true, staticProof: true, failure: null, foundBy: null, nodes: 0 };
  const r = sharedSearch.run(pos, flagged, maxPly, budget, { rootStatic: false });
  return { proven: r.proven, staticProof: false, failure: r.failure, foundBy: r.failure === 'mate' ? 'search' : null,
           nodes: budget - r.budgetLeft };
}

/** proveCannotBeMated for both sides at once: one pass of the static tests, then one walk of the
    search (Domino.run2) for the sides they leave open. Returns [White flagged, Black
    flagged], each the same proof as proveCannotBeMated gives. */
function proveBoth(pos, { maxPly = DOMINO_PLY, budget = DOMINO_BUDGET } = {}) {
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
function isDeadPosition(pos) {
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
class Flags {
  /** rungs: how much of the ladder the flags climb: 1 the material test, 2 the material test and
      the lock detector, 3 (the default) the whole ladder, the Domino search too. */
  constructor({ rungs = 3 } = {}) {
    if (rungs !== 1 && rungs !== 2 && rungs !== 3) fail('Flags: rungs must be 1, 2 or 3');
    this.rungs = rungs;
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
    const asked = this.rungs === 1 ? tests & TEST_MATERIAL : tests;
    let proven = asked ? staticTests2(pos, open, asked) : 0;
    if ((open & ~proven) && this.rungs === 3) {
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


/* ═══ Mateless · game.js — a reference game: results, repetitions, the move rules ═════════════

   What the ladder's answers mean for the result of a game, and the endings that need no claim:
   checkmate, stalemate, a dead position (both flags down), the 75-move rule and fivefold
   repetition. Claims (threefold repetition, the 50-move rule) and agreed draws are left to the
   platform, which has the repetition count and the halfmove clock to decide them.
     repetition    a game keeps an exact code of every position and counts repetitions by looking
                   back only over the moves since the last capture or pawn move, every other ply
                   (the side to move must match). */

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
const RESULT_NAMES = Object.freeze(['ongoing', 'white checkmates', 'black checkmates', 'stalemate', '75-move rule', 'fivefold repetition', 'dead position', 'white wins on time', 'black wins on time', 'white wins by resignation', 'black wins by resignation', 'draw on time', 'draw on resignation', '50-move rule', 'threefold repetition']);
const Result = Object.freeze({
  NONE: 0,
  WHITE_MATES: 1, BLACK_MATES: 2, STALEMATE: 3,
  SEVENTY_FIVE_MOVES: 4, FIVEFOLD: 5, DEAD_POSITION: 6,
  WHITE_ON_TIME: 7, BLACK_ON_TIME: 8, WHITE_BY_RESIGNATION: 9, BLACK_BY_RESIGNATION: 10,
  DRAW_ON_TIME: 11, DRAW_ON_RESIGNATION: 12, FIFTY_MOVES: 13, THREEFOLD: 14,
});
/** The draws a player may claim now (Game.claimable), as bits. */
const Claim = Object.freeze({ FIFTY_MOVES: 1, THREEFOLD: 2 });

/* A game's own rules (Game's options), each checked once. */
function checkGameOptions({ moveRule, repetition, claimMoves, claimRepetition, rungs }) {
  if (moveRule !== 0 && moveRule !== 100 && moveRule !== 150) fail('Game: moveRule must be 0, 100 or 150');
  if (repetition !== 0 && repetition !== 3 && repetition !== 5) fail('Game: repetition must be 0, 3 or 5');
  if (claimMoves !== 0 && claimMoves !== 100) fail('Game: claimMoves must be 0 or 100');
  if (claimRepetition !== 0 && claimRepetition !== 3) fail('Game: claimRepetition must be 0 or 3');
  if (rungs !== 1 && rungs !== 2 && rungs !== 3) fail('Game: rungs must be 1, 2 or 3');
}

/** How the game stands: checkmate, stalemate, dead position, fivefold repetition,
    the 75-move rule, in that order: the endings that need no claim. Returns a Result code, 0
    while the game goes on. Threefold repetition and the 50-move rule are claims, left to the
    platform.
      repetitions         how many times the current position has occurred;
      memory              a Game: its flags decide the dead position (see Flags.update);
      deadPositionSearch  false: only the static tests (material, lock) can find a dead
                          position, with no Domino search (a single position only). */
function gameStatus(pos, { repetitions = 1, deadPositionSearch = true, memory = null } = {}) {
  if (!hasLegalMove(pos)) {
    if (SHARED_CONTEXT.checks === 0) return Result.STALEMATE;
    return pos.side === WHITE ? Result.BLACK_MATES : Result.WHITE_MATES;
  }
  let dead;
  if (memory) { memory.updateFlags(); dead = memory.neverMates(WHITE) && memory.neverMates(BLACK); }
  else if (deadPositionSearch) dead = isDeadPosition(pos);
  else dead = cannotMate(pos, WHITE) && cannotMate(pos, BLACK);
  if (dead) return Result.DEAD_POSITION;
  // A Game's own rules may end it sooner: threefold repetition, the 50-move rule.
  const rep = memory && memory.repetition === 3 ? 3 : 5, rule = memory && memory.moveRule === 100 ? 100 : 150;
  if (repetitions >= rep) return rep === 3 ? Result.THREEFOLD : Result.FIVEFOLD;
  if (pos.halfmove >= rule) return rule === 100 ? Result.FIFTY_MOVES : Result.SEVENTY_FIVE_MOVES;
  return Result.NONE;
}

/** The verdict when the flag of `side` falls (FIDE 6.9), or `side` resigns (FIDE 5.1.2), in a
    single position with no game around it: a draw if the ladder proves that the
    opponent can never mate, otherwise a win for the opponent. In a game, Game.flagVerdict reads
    the flags instead. */
function flagVerdict(pos, side, { resigned = false, maxPly = DOMINO_PLY, budget = DOMINO_BUDGET } = {}) {
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
class Game {
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


// ═══ The public API (src/index.js) ═══════════════════════════════════════════════════════════

return Object.freeze({
  // constants
  WHITE, BLACK, PAWN, KING, QUEEN, KNIGHT, ROOK, BISHOP, NO_SQUARE, PROMOTION_ORDER,
  PIECE_LETTERS, RESULT_NAMES, Result, Claim, STANDARD_SKELETON,
  // squares and pieces
  fileOf, rankOf, squareName, parseSquare, colorOf, typeOf, opponent,
  // positions and moves
  EngineError, CastlingFiles, Position, fromFen, toFen, castlingField, chess960Arrangement,
  isAttacked, inCheck, makeMove, legalMoves, hasLegalMove, perft, positionKey,
  // the arbiter
  materialCannotMate, lockCannotMate, cannotMate, FLAGGED_WHITE, FLAGGED_BLACK, cannotMate2,
  DOMINO_PLY, DOMINO_BUDGET, Domino, proveCannotBeMated, proveBoth, isDeadPosition, Flags, gameStatus, flagVerdict, Game,
  // internals exposed for tests
  _internal: Object.freeze({ generateLegalMoves, doMove, undoMove, writeKey, hashKey, PositionSet, enemyAttacks, hasLegalMove, materialTest,
                             lockTest, lockTest2, lockSets, SHARED_CONTEXT,
                             FLAG_CASTLE, FLAG_EP, FLAG_DOUBLE, FLAG_PROMO, MOVE_STRIDE, KEY_WORDS, readFen }),
});
});
