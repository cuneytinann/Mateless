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
export const BLACK = 0;
export const WHITE = 8;
export const PAWN = 1, KING = 2, QUEEN = 3, KNIGHT = 4, ROOK = 5, BISHOP = 6;

/** The order in which the search tries the four promotions. */
export const PROMOTION_ORDER = Object.freeze([QUEEN, ROOK, BISHOP, KNIGHT]);

/** Index = piece code; ' ' marks codes that are no piece. */
export const PIECE_LETTERS = ' pkqnrb  PKQNRB';

export const NO_SQUARE = -1;

/* Squares: a1 = 0, b1 = 1, …, h1 = 7, a2 = 8, …, h8 = 63. */
export const fileOf = sq => sq & 7;
export const rankOf = sq => sq >> 3;
export const squareName = sq => 'abcdefgh'[sq & 7] + ((sq >> 3) + 1);
export function parseSquare(text) {
  return /^[a-h][1-8]$/.test(text) ? (text.charCodeAt(0) - 97) + 8 * (text.charCodeAt(1) - 49) : NO_SQUARE;
}
export const colorOf = piece => piece & WHITE;
export const typeOf = piece => piece & 7;
export const opponent = color => color ^ WHITE;

/** Thrown when the engine meets a state it must never be in. It never fails silently. */
export class EngineError extends Error {}
export function fail(message) { throw new EngineError(message); }


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
export const RANK_1 = 0x000000ff;            // in the lo word
export const RANK_8 = 0xff000000 | 0;        // in the hi word
export const DARK_SQUARES = 0xaa55aa55 | 0;  // the same pattern in both words; a1 is dark

/** The single-square sets: SQ_LO[sq] | SQ_HI[sq] is the bit of sq, one of the two is 0. */
const SQ_LO = new Int32Array(64), SQ_HI = new Int32Array(64);
for (let sq = 0; sq < 64; sq++) { if (sq < 32) SQ_LO[sq] = 1 << sq; else SQ_HI[sq] = 1 << (sq - 32); }

/** Both horizontal neighbours of every square of one word. */
export const sideways = w => ((w << 1) & NOT_FILE_A) | ((w >>> 1) & NOT_FILE_H);
/** Two files east and west of every square of one word. */
const sideways2 = w => ((w << 2) & NOT_FILE_AB) | ((w >>> 2) & NOT_FILE_GH);
/** One rank up / down: each returns one word of the shifted set. */
export const northLo = lo => lo << 8;
export const northHi = (lo, hi) => (hi << 8) | (lo >>> 24);
export const southLo = (lo, hi) => (lo >>> 8) | (hi << 24);
export const southHi = hi => hi >>> 8;
/** Every square of the set together with its eight neighbours (the king's zone). */
export function zoneLo(lo, hi) { const v = lo | (lo << 8) | (lo >>> 8) | (hi << 24); return v | sideways(v); }
export function zoneHi(lo, hi) { const v = hi | (hi << 8) | (lo >>> 24) | (hi >>> 8); return v | sideways(v); }
/** The four diagonal neighbours of every square of the set. */
export const diagonalLo = (lo, hi) => sideways((lo << 8) | (lo >>> 8) | (hi << 24));
export const diagonalHi = (lo, hi) => sideways((hi << 8) | (lo >>> 24) | (hi >>> 8));

/** Index of the lowest set bit of a non-zero word. */
export const lowestBit = w => 31 - Math.clz32(w & -w);
export function popcount(w) {
  w -= (w >>> 1) & 0x55555555;
  w = (w & 0x33333333) + ((w >>> 2) & 0x33333333);
  return Math.imul((w + (w >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24;
}
/** Does the set have exactly one square? */
export const isSingle = (lo, hi) => (lo ? hi === 0 && (lo & (lo - 1)) === 0 : hi !== 0 && (hi & (hi - 1)) === 0);
/** The lowest square of a non-empty set. */
export const firstSquare = (lo, hi) => (lo ? lowestBit(lo) : 32 + lowestBit(hi));

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
export const KING_STEPS = stepTable([[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]]);
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
export const STANDARD_SKELETON = '20003001';
export class CastlingFiles {
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

export class Position {
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
export function isAttacked(pos, sq, by) {
  return attackedBy(pos, sq, by, pos.lo[0] | pos.lo[8], pos.hi[0] | pos.hi[8]);
}

/** Is the side to move in check? */
export const inCheck = pos => isAttacked(pos, pos.kingSquare(pos.side), pos.side ^ WHITE);

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
export const FLAG_CASTLE = 1;   // the king moves onto its own rook
export const FLAG_EP = 2;       // a pawn captures en passant
export const FLAG_DOUBLE = 4;   // a pawn advances two squares
export const FLAG_PROMO = 8;    // a pawn reaches the last rank
const moveFrom = move => move & 63;
const moveTo = move => (move >> 6) & 63;
const moveFlags = move => move >> 12;
/** Room for the moves of one position (at most 218 legal moves exist; promotions count once). */
export const MOVE_STRIDE = 256;

/* What move generation needs to know about the side to move, computed once per position by
   computeContext(). The search keeps one per ply, so that a node can go on generating its
   moves after its children have used theirs. */
export class MoveContext {
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
export const SHARED_CONTEXT = new MoveContext();

export function computeContext(pos, ctx) {
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
export function enemyAttacks(pos, by, occLo, occHi) {
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
export let targetsLo = 0, targetsHi = 0;

/** Fills targetsLo/targetsHi with the legal targets of the piece on `from` (a piece of the side
    to move). computeContext(pos, ctx) must have run for this position. */
export function legalTargets(pos, from, ctx) {
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
export function generateLegalMoves(pos, out, base, ctx = SHARED_CONTEXT) {
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
export let stuckLo = 0, stuckHi = 0;
export function stuckPawns(pos) {
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
export function hasLegalMove(pos, ctx = SHARED_CONTEXT) {
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
export function flagsOf(pos, type, from, to) {
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
export function legalMoves(pos) {
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
export function doMove(pos, move, promotion) {
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
export function undoMove(pos) {
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
export function findLegalMove(pos, from, to, buffer = new Int32Array(MOVE_STRIDE)) {
  const count = generateLegalMoves(pos, buffer, 0), wanted = from | (to << 6);
  for (let k = 0; k < count; k++) if ((buffer[k] & 4095) === wanted) return buffer[k];
  return -1;
}

export function checkPromotion(promotion) {
  if (PROMOTION_ORDER.indexOf(promotion) < 0) fail('promotion must be QUEEN, ROOK, BISHOP or KNIGHT');
}

/** Plays from → to on a copy: writes the position after the move into dst and returns dst; src
    is left unchanged. Throws when the move is not legal. */
export function makeMove(src, dst, from, to, promotion = QUEEN) {
  checkPromotion(promotion);
  const move = findLegalMove(src, from, to);
  if (move < 0) fail('illegal move ' + squareName(from) + squareName(to));
  dst.copyFrom(src);
  doMove(dst, move, promotion);
  dst.undoTop = 0;
  return dst;
}

/** Number of leaf positions after `depth` plies, promotions counted separately. */
export function perft(pos, depth) {
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
export const KEY_WORDS = 9;

export function writeKey(pos, out, at) {
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

export function keysEqual(a, at, b, bt) {
  for (let j = 0; j < KEY_WORDS; j++) if (a[at + j] !== b[bt + j]) return false;
  return true;
}

/** A 32-bit hash of a code: each word times its own odd constant, summed by XOR, then
    MurmurHash3's finalizer. Only for spreading codes over the table: a match is always
    confirmed on the full code. */
export function hashKey(k, at) {
  let h = Math.imul(k[at], 0x9e3779b1) ^ Math.imul(k[at + 1], 0x85ebca77) ^ Math.imul(k[at + 2], 0xc2b2ae3d) ^
          Math.imul(k[at + 3], 0x27d4eb2f) ^ Math.imul(k[at + 4], 0x165667b1) ^ Math.imul(k[at + 5], 0xd3a2646d) ^
          Math.imul(k[at + 6], 0xfd7046c5) ^ Math.imul(k[at + 7], 0xb55a4f09) ^ Math.imul(k[at + 8], 0x7feb352d);
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
  return h ^ (h >>> 16);
}

/** A string that is equal for two positions exactly when they are the same position. */
export function positionKey(pos) {
  const k = new Int32Array(KEY_WORDS);
  writeKey(pos, k, 0);
  return Array.from(k).join(',');
}


// ═══════════════════════════════════════════════════════════════════════════════════════
// 9. FEN
// ═══════════════════════════════════════════════════════════════════════════════════════

const FEN_PIECES = { p: PAWN, k: KING, q: QUEEN, n: KNIGHT, r: ROOK, b: BISHOP };

/** Reads a FEN. Returns { position, halfmoveGiven } or { error }, error being one of 'syntax',
    'kings', 'pawns' (a pawn on the first or last rank), 'castling' or 'en passant'. Only what the
    engine needs to run safely is checked here; whether some game can reach the position is a
    separate question (see the arbiter page's FEN checks).

    Castling may be written as KQkq (the outermost rook on that side of the king, as in X-FEN)
    or as Shredder-FEN file letters (HAha). Every right is read against the board: its king
    must stand on its first rank and its rook on the same rank, otherwise the right is dropped.
    The files found become the castling skeleton; both colours share it, so rights that place
    the king or a rook on different files are refused. The en passant square is kept only when a
    legal capture onto it exists. */
export function fromFen(fen) {
  const fields = String(fen).trim().split(/\s+/);
  if (fields.length < 2) return { error: 'syntax' };
  const pieces = new Uint8Array(64), placement = fields[0];
  let rank = 7, file = 0, whiteKings = 0, blackKings = 0;
  for (let i = 0; i < placement.length; i++) {
    const ch = placement[i];
    if (ch === '/') { rank--; file = 0; continue; }
    if (ch >= '1' && ch <= '8') { file += +ch; continue; }
    const type = FEN_PIECES[ch.toLowerCase()];
    if (!type || rank < 0 || file > 7) return { error: 'syntax' };
    const piece = type | (ch === ch.toUpperCase() ? WHITE : BLACK);
    if (piece === (WHITE | KING)) whiteKings++; else if (piece === (BLACK | KING)) blackKings++;
    pieces[8 * rank + file++] = piece;
  }
  if (whiteKings !== 1 || blackKings !== 1) return { error: 'kings' };
  for (let f = 0; f < 8; f++)
    if ((pieces[f] & 7) === PAWN || (pieces[56 + f] & 7) === PAWN) return { error: 'pawns' };

  // Castling rights and the skeleton they imply.
  const skeleton = [0, 0, 0, 0, 0, 0, 0, 0];
  let castling = 0;
  for (const ch of fields[2] || '-') {
    if (ch === '-') continue;
    const up = ch.toUpperCase(), white = ch === up, base = white ? 0 : 56;
    const king = pieces.indexOf(white ? WHITE | KING : BLACK | KING) - base;
    const rook = white ? WHITE | ROOK : BLACK | ROOK;
    if (king < 0 || king > 7) continue;            // the king is not on its first rank: no right
    if (up !== 'K' && up !== 'Q' && !(up >= 'A' && up <= 'H')) return { error: 'castling' };
    let rookFile = -1;
    if (up === 'K') { for (let f = 7; f > king; f--) if (pieces[base + f] === rook) { rookFile = f; break; } }
    else if (up === 'Q') { for (let f = 0; f < king; f++) if (pieces[base + f] === rook) { rookFile = f; break; } }
    else { const f = up.charCodeAt(0) - 65; if (f !== king && pieces[base + f] === rook) rookFile = f; }
    if (rookFile < 0) continue;
    const digit = rookFile > king ? 1 : 2;
    if ((skeleton[king] && skeleton[king] !== 3) || (skeleton[rookFile] && skeleton[rookFile] !== digit))
      return { error: 'castling' };
    skeleton[king] = 3;
    skeleton[rookFile] = digit;
    castling |= digit << (white ? 0 : 2);
  }
  for (const digit of [1, 2, 3])
    if (skeleton.filter(d => d === digit).length > 1) return { error: 'castling' };

  const pos = new Position(castling ? new CastlingFiles(skeleton.join('')) : STANDARD_FILES);
  for (let sq = 0; sq < 64; sq++) if (pieces[sq]) pos.put(sq, pieces[sq]);
  if (fields[1] !== 'w' && fields[1] !== 'b') return { error: 'syntax' };
  pos.side = fields[1] === 'w' ? WHITE : BLACK;
  pos.castling = castling;
  const ep = fields[3] || '-';
  if (ep !== '-') {
    // The square must lie behind an enemy pawn that has just advanced two squares.
    const sq = parseSquare(ep), behind = pos.side === WHITE ? sq - 8 : sq + 8;
    if (sq === NO_SQUARE || rankOf(sq) !== (pos.side === WHITE ? 5 : 2) || pos.board[sq] ||
        pos.board[behind] !== ((pos.side ^ WHITE) | PAWN)) return { error: 'en passant' };
    if (canCaptureEnPassant(pos, sq)) pos.ep = sq;
  }
  const clock = fields[4];
  if (clock !== undefined && clock !== '-' && !/^\d+$/.test(clock)) return { error: 'syntax' };
  pos.halfmove = +clock || 0;
  return { position: pos, halfmoveGiven: clock !== undefined && clock !== '-' };
}

/** The castling field: KQkq for the standard skeleton, Shredder file letters otherwise. */
export function castlingField(pos) {
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

export function toFen(pos, fullmove = 1) {
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
export function chess960Arrangement(n) {
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
