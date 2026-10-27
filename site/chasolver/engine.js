/* chasolver-js engine (board.js, deduction.js, search.js, winnability.js), bundled unchanged.
   Each file runs inside its own function with module/exports/require, as under Node. */
var CHA=(function(){var defs={},cache={};
function req(n){var m=cache[n];if(m)return m.exports;m=cache[n]={exports:{}};defs[n](m,m.exports,req);return m.exports}
defs['./board.js']=function(module,exports,require){
'use strict';
// ---------------------------------------------------------------------------
// Board, FEN parsing, legal move generation and move making.
//
// Independent re-implementation of the parts of the Rust `chess` crate (v3.2)
// that chasolver relies on, with the crate's observable behaviour:
//   * legal moves come out in exactly the crate's MoveGen order,
//   * en passant is stored as the square of the pawn that may be captured, and
//     only when a capture is actually available,
//   * checkers / pinned pieces follow the crate's definitions,
//   * FEN validation mirrors BoardBuilder + Board::is_sane.
// The search's node budgets make chasolver's verdicts depend on move order, so
// this fidelity is what lets the port reproduce the Rust results exactly.
//
// Representation. A benchmark of every common choice (bench/: 64-square and
// 10x12 mailboxes, 0x88, plain 8x8 arrays, nibble boards, BigInt bitboards,
// strings) put bitboards stored as two 32-bit halves first, so each position
// keeps one set per piece code and per colour as (lo, hi) Int32 pairs, plus a
// mailbox for "what stands on this square". Squares are a1 = 0 .. h8 = 63;
// `lo` holds a1..h4 and `hi` holds a5..h8, so scanning lo then hi from the
// lowest bit visits squares in the crate's iteration order.
//
// Two ways to make a move:
//   * makeMove(b, m) returns a new board (for code that keeps positions),
//   * doMove(b, m) / undoMove(b, m) work in place (for the recursive searches),
// and genLegal(b, buffer, start) writes legal moves into a shared Int32Array
// so the searches allocate nothing per node.
// ---------------------------------------------------------------------------

const WHITE = 0, BLACK = 1;
const PAWN = 0, KNIGHT = 1, BISHOP = 2, ROOK = 3, QUEEN = 4, KING = 5;

/** Piece code stored in a square: 0 = empty, else (type + 1) | (color << 3). */
const pieceCode = (type, color) => (type + 1) | (color << 3);
const typeOf = (p) => (p & 7) - 1;
const colorOf = (p) => p >> 3;

const fileOf = (s) => s & 7;
const rankOf = (s) => s >> 3;
const makeSquare = (rank, file) => (rank << 3) | file;
const SQUARE_NAMES = [];
for (let s = 0; s < 64; s++) SQUARE_NAMES.push('abcdefgh'[fileOf(s)] + (rankOf(s) + 1));

// Directions: 0..3 orthogonal (N, S, E, W), 4..7 diagonal (NE, NW, SE, SW).
const DIR_DF = [0, 0, 1, -1, 1, -1, 1, -1];
const DIR_DR = [1, -1, 0, 0, 1, 1, -1, -1];
const OPPOSITE_DIRECTION = [1, 0, 3, 2, 7, 6, 5, 4];
/** Directions that move toward higher square indices: their nearest blocker is the lowest set bit. */
const TOWARD_HIGHER = [1, 0, 1, 0, 1, 1, 0, 0];

/** RAYS[dir * 64 + sq]: squares from `sq` outward in direction `dir` (kept for other modules). */
const RAYS = new Array(8 * 64);
for (let d = 0; d < 8; d++) {
  for (let s = 0; s < 64; s++) {
    const ray = [];
    let f = fileOf(s) + DIR_DF[d], r = rankOf(s) + DIR_DR[d];
    while (f >= 0 && f < 8 && r >= 0 && r < 8) { ray.push(makeSquare(r, f)); f += DIR_DF[d]; r += DIR_DR[d]; }
    RAYS[d * 64 + s] = Int8Array.from(ray);
  }
}

/** DIRECTION[a * 64 + b]: direction index from a towards b if aligned, else -1. */
const DIRECTION = new Int8Array(64 * 64).fill(-1);
for (let d = 0; d < 8; d++) for (let a = 0; a < 64; a++) for (const b of RAYS[d * 64 + a]) DIRECTION[a * 64 + b] = d;

const DISTANCE = new Int8Array(64 * 64);
for (let a = 0; a < 64; a++) for (let b = 0; b < 64; b++)
  DISTANCE[a * 64 + b] = Math.max(Math.abs(fileOf(a) - fileOf(b)), Math.abs(rankOf(a) - rankOf(b)));

const jumpTargets = (deltas) => {
  const out = new Array(64);
  for (let s = 0; s < 64; s++) {
    const t = [];
    for (const [df, dr] of deltas) {
      const f = fileOf(s) + df, r = rankOf(s) + dr;
      if (f >= 0 && f < 8 && r >= 0 && r < 8) t.push(makeSquare(r, f));
    }
    out[s] = Int8Array.from(t.sort((x, y) => x - y));
  }
  return out;
};
const KNIGHT_TARGETS = jumpTargets([[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]]);
const KING_TARGETS = jumpTargets([[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]]);

/** Squares attacked by a pawn of `color` standing on `sq` (ascending). */
const PAWN_ATTACK_TARGETS = [[], []];
for (let s = 0; s < 64; s++) {
  for (const c of [WHITE, BLACK]) {
    const r = rankOf(s) + (c === WHITE ? 1 : -1), t = [];
    if (r >= 0 && r < 8) { if (fileOf(s) > 0) t.push(makeSquare(r, fileOf(s) - 1)); if (fileOf(s) < 7) t.push(makeSquare(r, fileOf(s) + 1)); }
    PAWN_ATTACK_TARGETS[c][s] = Int8Array.from(t);
  }
}

/** Castle rights (NoRights=0, KingSide=1, QueenSide=2, Both=3) touched by a square, per color. */
const CASTLES_PER_SQUARE = [new Int8Array(64), new Int8Array(64)];
CASTLES_PER_SQUARE[WHITE][0] = 2; CASTLES_PER_SQUARE[WHITE][4] = 3; CASTLES_PER_SQUARE[WHITE][7] = 1;
CASTLES_PER_SQUARE[BLACK][56] = 2; CASTLES_PER_SQUARE[BLACK][60] = 3; CASTLES_PER_SQUARE[BLACK][63] = 1;
const IS_CASTLE_MOVE_SQUARE = new Uint8Array(64);
for (const s of [2, 4, 6, 58, 60, 62]) IS_CASTLE_MOVE_SQUARE[s] = 1;

// ---------------------------------------------------------------------------
// 64-bit sets as two 32-bit halves.
// ---------------------------------------------------------------------------

const bitLo = (s) => (s < 32 ? 1 << s : 0);
const bitHi = (s) => (s < 32 ? 0 : 1 << (s - 32));
function popcount32(v) {
  v = v - ((v >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return (((v + (v >>> 4)) & 0x0F0F0F0F) * 0x01010101) >>> 24;
}
const lowestSquare = (lo, hi) => (lo !== 0 ? 31 - Math.clz32(lo & -lo) : 63 - Math.clz32(hi & -hi));
const highestSquare = (lo, hi) => (hi !== 0 ? 63 - Math.clz32(hi) : 31 - Math.clz32(lo));

/** Build a (lo, hi) table: fill(index, addSquare) is called for every index. */
function halvesTable(size, fill) {
  const lo = new Int32Array(size), hi = new Int32Array(size);
  for (let i = 0; i < size; i++) fill(i, (s) => { if (s < 32) lo[i] |= 1 << s; else hi[i] |= 1 << (s - 32); });
  return [lo, hi];
}
const [RAY_LO, RAY_HI] = halvesTable(8 * 64, (i, add) => { for (const s of RAYS[i]) add(s); });
const [ROOK_RAYS_LO, ROOK_RAYS_HI] = halvesTable(64, (s, add) => { for (let d = 0; d < 4; d++) for (const x of RAYS[d * 64 + s]) add(x); });
const [BISHOP_RAYS_LO, BISHOP_RAYS_HI] = halvesTable(64, (s, add) => { for (let d = 4; d < 8; d++) for (const x of RAYS[d * 64 + s]) add(x); });
const [KNIGHT_LO, KNIGHT_HI] = halvesTable(64, (s, add) => { for (const x of KNIGHT_TARGETS[s]) add(x); });
const [KING_LO, KING_HI] = halvesTable(64, (s, add) => { for (const x of KING_TARGETS[s]) add(x); });
/** [color * 64 + sq]: squares a pawn of `color` on `sq` attacks. */
const [PAWN_ATTACKS_LO, PAWN_ATTACKS_HI] = halvesTable(128, (i, add) => { for (const x of PAWN_ATTACK_TARGETS[i >> 6][i & 63]) add(x); });
/** [color * 64 + sq]: the crate's PAWN_MOVES (single push, plus double push from the start rank). */
const [PAWN_PUSHES_LO, PAWN_PUSHES_HI] = halvesTable(128, (i, add) => {
  const c = i >> 6, s = i & 63, r = rankOf(s), step = c === WHITE ? 8 : -8;
  if (r === (c === WHITE ? 1 : 6)) { add(s + step); add(s + 2 * step); }
  else if (c === WHITE ? r < 7 : r > 0) add(s + step);
});
/** [a * 64 + b]: squares strictly between aligned a and b (crate `between`). */
const [BETWEEN_LO, BETWEEN_HI] = halvesTable(64 * 64, (i, add) => {
  const a = i >> 6, b = i & 63, d = DIRECTION[a * 64 + b];
  if (d < 0) return;
  for (const x of RAYS[d * 64 + a]) { if (x === b) break; add(x); }
});
/** [a * 64 + b]: the whole line through aligned a and b, both included (crate `line`). */
const [LINE_LO, LINE_HI] = halvesTable(64 * 64, (i, add) => {
  const a = i >> 6, b = i & 63, d = DIRECTION[a * 64 + b];
  if (d < 0) return;
  add(a);
  for (const x of RAYS[d * 64 + a]) add(x);
  for (const x of RAYS[OPPOSITE_DIRECTION[d] * 64 + a]) add(x);
});
const KINGSIDE_EMPTY_LO = [bitLo(5) | bitLo(6), 0], KINGSIDE_EMPTY_HI = [0, bitHi(61) | bitHi(62)];
const QUEENSIDE_EMPTY_LO = [bitLo(1) | bitLo(2) | bitLo(3), 0], QUEENSIDE_EMPTY_HI = [0, bitHi(57) | bitHi(58) | bitHi(59)];

/** Slider attacks from `sq` over directions [d0, d1) with the given occupancy; result in attackLo/attackHi. */
let attackLo = 0, attackHi = 0;
function sliderAttacks(sq, d0, d1, occLo, occHi) {
  let aLo = 0, aHi = 0;
  for (let d = d0; d < d1; d++) {
    const i = d * 64 + sq;
    let lo = RAY_LO[i], hi = RAY_HI[i];
    const blockLo = lo & occLo, blockHi = hi & occHi;
    if ((blockLo | blockHi) !== 0) {
      const x = TOWARD_HIGHER[d] ? lowestSquare(blockLo, blockHi) : highestSquare(blockLo, blockHi);
      lo ^= RAY_LO[d * 64 + x]; hi ^= RAY_HI[d * 64 + x];
    }
    aLo |= lo; aHi |= hi;
  }
  attackLo = aLo; attackHi = aHi;
}

/** Moves are 15-bit integers: source | dest << 6 | promotionType << 12 (0 = none). */
const moveSource = (m) => m & 63;
const moveDest = (m) => (m >> 6) & 63;
const movePromotion = (m) => (m >> 12) & 7;   // KNIGHT..QUEEN, or 0
const makeMoveCode = (src, dst, promo) => src | (dst << 6) | (promo << 12);
const PROMOTION_ORDER = [QUEEN, KNIGHT, ROOK, BISHOP];   // the crate's PROMOTION_PIECES
function moveToUci(m) {
  const p = movePromotion(m);
  return SQUARE_NAMES[moveSource(m)] + SQUARE_NAMES[moveDest(m)] + (p ? 'pnbrqk'[p] : '');
}


// ---------------------------------------------------------------------------
// Zobrist hashing and an exact position table.
//
// Rust keys its transposition table and "seen" sets by the whole Board, so a
// lookup can never confuse two positions. Here a 64-bit Zobrist hash (two
// 32-bit halves, updated incrementally in makeMove) picks the bucket, and every
// hit is confirmed against the position's exact identity (the same 17 codes
// Board.key() packs), so the table behaves exactly like the Rust HashMap.
// ---------------------------------------------------------------------------

let zState = 0x2545F491;
const zNext = () => { zState ^= zState << 13; zState ^= zState >>> 17; zState ^= zState << 5; return zState | 0; };
const Z_PIECE_LO = new Int32Array(16 * 64), Z_PIECE_HI = new Int32Array(16 * 64);
for (let i = 0; i < 16 * 64; i++) { Z_PIECE_LO[i] = zNext(); Z_PIECE_HI[i] = zNext(); }
const Z_SIDE_LO = [0, zNext()], Z_SIDE_HI = [0, zNext()];
const Z_CASTLE_LO = new Int32Array(8), Z_CASTLE_HI = new Int32Array(8);   // [color * 4 + rights]
for (let i = 0; i < 8; i++) { Z_CASTLE_LO[i] = zNext(); Z_CASTLE_HI[i] = zNext(); }
const Z_EP_LO = new Int32Array(65), Z_EP_HI = new Int32Array(65);          // [ep + 1]
for (let i = 1; i < 65; i++) { Z_EP_LO[i] = zNext(); Z_EP_HI[i] = zNext(); }

const IDENTITY_CODES = 17;
const scratchIdentity = new Uint16Array(IDENTITY_CODES);

/** Pack a position's exact identity (pieces, side, castle rights, ep) into scratchIdentity. */
function packIdentity(b) {
  const sq = b.sq;
  for (let i = 0, j = 0; i < 64; i += 4, j++) scratchIdentity[j] = sq[i] | (sq[i + 1] << 4) | (sq[i + 2] << 8) | (sq[i + 3] << 12);
  scratchIdentity[16] = b.stm | (b.castle[0] << 1) | (b.castle[1] << 3) | ((b.ep + 1) << 5);
}

const fullHashLo = (b) => b.zLo ^ Z_SIDE_LO[b.stm] ^ Z_CASTLE_LO[b.castle[0]] ^ Z_CASTLE_LO[4 + b.castle[1]] ^ Z_EP_LO[b.ep + 1];
const fullHashHi = (b) => b.zHi ^ Z_SIDE_HI[b.stm] ^ Z_CASTLE_HI[b.castle[0]] ^ Z_CASTLE_HI[4 + b.castle[1]] ^ Z_EP_HI[b.ep + 1];

/** Hash map from exact positions to a small integer (or a set, ignoring values). */
class PositionTable {
  constructor(capacity = 1 << 10) { this.allocate(capacity); }

  allocate(capacity) {
    this.capacity = capacity; this.mask = capacity - 1; this.size = 0;
    this.used = new Uint8Array(capacity);
    this.hashLo = new Int32Array(capacity); this.hashHi = new Int32Array(capacity);
    this.identity = new Uint16Array(capacity * IDENTITY_CODES);
    this.value = new Int16Array(capacity);
  }

  /**
   * Slot holding board `b`, or the empty slot where it would go. The exact
   * identity is packed lazily, only once some stored hash matches.
   */
  slotOf(b, lo, hi) {
    let i = (lo ^ Math.imul(hi, 0x9E3779B1)) & this.mask;
    const used = this.used, id = this.identity;
    let packed = false;
    for (;;) {
      if (used[i] === 0) return i;
      if (this.hashLo[i] === lo && this.hashHi[i] === hi) {
        if (!packed) { packIdentity(b); packed = true; }
        const base = i * IDENTITY_CODES;
        let same = true;
        for (let k = 0; k < IDENTITY_CODES; k++) if (id[base + k] !== scratchIdentity[k]) { same = false; break; }
        if (same) return i;
      }
      i = (i + 1) & this.mask;
    }
  }

  /** Stored value for board `b`, or -1 if absent. */
  get(b) {
    const i = this.slotOf(b, fullHashLo(b), fullHashHi(b));
    return this.used[i] ? this.value[i] : -1;
  }

  has(b) { return this.get(b) !== -1; }

  /** Insert or overwrite; returns true if the position was new. */
  set(b, v) {
    if ((this.size + 1) * 2 > this.capacity) this.grow();
    const lo = fullHashLo(b), hi = fullHashHi(b);
    const i = this.slotOf(b, lo, hi);
    const isNew = this.used[i] === 0;
    if (isNew) {
      packIdentity(b);
      this.used[i] = 1; this.hashLo[i] = lo; this.hashHi[i] = hi;
      this.identity.set(scratchIdentity, i * IDENTITY_CODES);
      this.size++;
    }
    this.value[i] = v;
    return isNew;
  }

  add(b) { return this.set(b, 0); }

  /** Empty the table, keeping its capacity for the next search. */
  clear() { if (this.size > 0) { this.used.fill(0); this.size = 0; } }

  grow() {
    const old = this;
    const { used, hashLo, hashHi, identity, value, capacity } = old;
    this.allocate(capacity * 2);
    for (let j = 0; j < capacity; j++) {
      if (!used[j]) continue;
      let i = (hashLo[j] ^ Math.imul(hashHi[j], 0x9E3779B1)) & this.mask;
      while (this.used[i]) i = (i + 1) & this.mask;
      this.used[i] = 1; this.hashLo[i] = hashLo[j]; this.hashHi[i] = hashHi[j]; this.value[i] = value[j];
      this.identity.set(identity.subarray(j * IDENTITY_CODES, (j + 1) * IDENTITY_CODES), i * IDENTITY_CODES);
      this.size++;
    }
  }
}

class Board {
  constructor() {
    this.sq = new Int8Array(64);          // mailbox: piece code per square
    this.count = new Int8Array(16);       // pieces per piece code
    this.bbLo = new Int32Array(16);       // squares per piece code, low half (a1..h4)
    this.bbHi = new Int32Array(16);       //                          high half (a5..h8)
    this.occLo = new Int32Array(2);       // squares per colour
    this.occHi = new Int32Array(2);
    this.stm = WHITE;
    this.castle = [0, 0];
    this.ep = -1;                         // square of the pawn that may be captured en passant
    this.ksq = [-1, -1];
    this.nCheckers = 0;
    this.checker = -1;                    // lowest checker square, when in check
    this.checkersLo = 0; this.checkersHi = 0;
    this.pinLo = 0; this.pinHi = 0;       // crate's `pinned` bitboard
    this._key = null;
    this.darkCornerCache = -1;            // search heuristics: -1 = not computed yet
    this.zLo = 0; this.zHi = 0;           // Zobrist hash of the pieces only
    this.undo = null;                     // in-place move records (allocated on first doMove)
    this.ply = 0;
  }

  clone() {
    const b = new Board();
    b.sq.set(this.sq); b.count.set(this.count);
    b.bbLo.set(this.bbLo); b.bbHi.set(this.bbHi); b.occLo.set(this.occLo); b.occHi.set(this.occHi);
    b.stm = this.stm; b.castle[0] = this.castle[0]; b.castle[1] = this.castle[1];
    b.ep = this.ep; b.ksq[0] = this.ksq[0]; b.ksq[1] = this.ksq[1];
    b.nCheckers = this.nCheckers; b.checker = this.checker; b.checkersLo = this.checkersLo; b.checkersHi = this.checkersHi;
    b.pinLo = this.pinLo; b.pinHi = this.pinHi; b.zLo = this.zLo; b.zHi = this.zHi;
    return b;
  }

  pieceOn(s) { const p = this.sq[s]; return p ? typeOf(p) : -1; }
  colorOn(s) { const p = this.sq[s]; return p ? colorOf(p) : -1; }
  isPinned(s) { return s < 32 ? (this.pinLo >>> s) & 1 : (this.pinHi >>> (s - 32)) & 1; }
  inCheck() { return this.nCheckers > 0; }
  numPieces() { let n = 0; for (let i = 1; i < 16; i++) n += this.count[i]; return n; }
  numColor(c) { let n = 0; for (let t = 0; t < 6; t++) n += this.count[pieceCode(t, c)]; return n; }
  numType(t) { return this.count[pieceCode(t, WHITE)] + this.count[pieceCode(t, BLACK)]; }

  /** Exact identity of the position, matching the crate's derived Board equality. */
  key() {
    if (this._key !== null) return this._key;
    const sq = this.sq, codes = new Array(17);
    for (let i = 0, j = 0; i < 64; i += 4, j++) codes[j] = sq[i] | (sq[i + 1] << 4) | (sq[i + 2] << 8) | (sq[i + 3] << 12);
    codes[16] = this.stm | (this.castle[0] << 1) | (this.castle[1] << 3) | ((this.ep + 1) << 5);
    return (this._key = String.fromCharCode.apply(null, codes));
  }
}

/** Flip piece `code` on square `s` in the bitboards (not the mailbox, counts or hash). */
function toggleBits(b, code, s) {
  const c = code >> 3;
  if (s < 32) { const bit = 1 << s; b.bbLo[code] ^= bit; b.occLo[c] ^= bit; }
  else { const bit = 1 << (s - 32); b.bbHi[code] ^= bit; b.occHi[c] ^= bit; }
}
/** Flip piece `code` on square `s` in the bitboards and the Zobrist hash. */
function togglePiece(b, code, s) {
  toggleBits(b, code, s);
  b.zLo ^= Z_PIECE_LO[code * 64 + s]; b.zHi ^= Z_PIECE_HI[code * 64 + s];
}

/** Board::update_pin_info for the side to move: checkers, and pieces alone between a slider and the king. */
function updatePinInfo(b) {
  const me = b.stm, opp = 1 - me, k = b.ksq[me];
  const allLo = b.occLo[0] | b.occLo[1], allHi = b.occHi[0] | b.occHi[1];
  const queen = pieceCode(QUEEN, opp), rook = pieceCode(ROOK, opp), bishop = pieceCode(BISHOP, opp);
  let sliderLo = (ROOK_RAYS_LO[k] & (b.bbLo[rook] | b.bbLo[queen])) | (BISHOP_RAYS_LO[k] & (b.bbLo[bishop] | b.bbLo[queen]));
  let sliderHi = (ROOK_RAYS_HI[k] & (b.bbHi[rook] | b.bbHi[queen])) | (BISHOP_RAYS_HI[k] & (b.bbHi[bishop] | b.bbHi[queen]));
  let cLo = 0, cHi = 0, pLo = 0, pHi = 0;
  while ((sliderLo | sliderHi) !== 0) {
    const s = lowestSquare(sliderLo, sliderHi);
    if (s < 32) sliderLo ^= 1 << s; else sliderHi ^= 1 << (s - 32);
    const i = s * 64 + k, betweenLo = BETWEEN_LO[i] & allLo, betweenHi = BETWEEN_HI[i] & allHi;
    if ((betweenLo | betweenHi) === 0) { if (s < 32) cLo ^= 1 << s; else cHi ^= 1 << (s - 32); }
    else if (popcount32(betweenLo) + popcount32(betweenHi) === 1) { pLo ^= betweenLo; pHi ^= betweenHi; }
  }
  cLo ^= KNIGHT_LO[k] & b.bbLo[pieceCode(KNIGHT, opp)]; cHi ^= KNIGHT_HI[k] & b.bbHi[pieceCode(KNIGHT, opp)];
  cLo ^= PAWN_ATTACKS_LO[me * 64 + k] & b.bbLo[pieceCode(PAWN, opp)]; cHi ^= PAWN_ATTACKS_HI[me * 64 + k] & b.bbHi[pieceCode(PAWN, opp)];
  b.checkersLo = cLo; b.checkersHi = cHi; b.pinLo = pLo; b.pinHi = pHi;
  b.nCheckers = popcount32(cLo) + popcount32(cHi);
  b.checker = b.nCheckers > 0 ? lowestSquare(cLo, cHi) : -1;
}

/** KingType::legal_king_move: is `dest` safe for the side to move's king? (`noKing*`: occupancy without that king) */
function kingSquareSafe(b, dest, noKingLo, noKingHi) {
  const me = b.stm, opp = 1 - me;
  if (((KNIGHT_LO[dest] & b.bbLo[pieceCode(KNIGHT, opp)]) | (KNIGHT_HI[dest] & b.bbHi[pieceCode(KNIGHT, opp)])) !== 0) return false;
  if (((KING_LO[dest] & b.bbLo[pieceCode(KING, opp)]) | (KING_HI[dest] & b.bbHi[pieceCode(KING, opp)])) !== 0) return false;
  if (((PAWN_ATTACKS_LO[me * 64 + dest] & b.bbLo[pieceCode(PAWN, opp)]) | (PAWN_ATTACKS_HI[me * 64 + dest] & b.bbHi[pieceCode(PAWN, opp)])) !== 0) return false;
  const queen = pieceCode(QUEEN, opp);
  const occLo = noKingLo | bitLo(dest), occHi = noKingHi | bitHi(dest);
  const rqLo = b.bbLo[pieceCode(ROOK, opp)] | b.bbLo[queen], rqHi = b.bbHi[pieceCode(ROOK, opp)] | b.bbHi[queen];
  if (((ROOK_RAYS_LO[dest] & rqLo) | (ROOK_RAYS_HI[dest] & rqHi)) !== 0) {
    sliderAttacks(dest, 0, 4, occLo, occHi);
    if (((attackLo & rqLo) | (attackHi & rqHi)) !== 0) return false;
  }
  const bqLo = b.bbLo[pieceCode(BISHOP, opp)] | b.bbLo[queen], bqHi = b.bbHi[pieceCode(BISHOP, opp)] | b.bbHi[queen];
  if (((BISHOP_RAYS_LO[dest] & bqLo) | (BISHOP_RAYS_HI[dest] & bqHi)) !== 0) {
    sliderAttacks(dest, 4, 8, occLo, occHi);
    if (((attackLo & bqLo) | (attackHi & bqHi)) !== 0) return false;
  }
  return true;
}

/** PawnType::legal_ep_move: sliders only, after removing both pawns and adding the destination. */
function legalEpMove(b, source, dest) {
  const me = b.stm, opp = 1 - me, k = b.ksq[me], queen = pieceCode(QUEEN, opp);
  const occLo = (b.occLo[0] | b.occLo[1]) ^ bitLo(b.ep) ^ bitLo(source) ^ bitLo(dest);
  const occHi = (b.occHi[0] | b.occHi[1]) ^ bitHi(b.ep) ^ bitHi(source) ^ bitHi(dest);
  const rqLo = b.bbLo[pieceCode(ROOK, opp)] | b.bbLo[queen], rqHi = b.bbHi[pieceCode(ROOK, opp)] | b.bbHi[queen];
  if (((ROOK_RAYS_LO[k] & rqLo) | (ROOK_RAYS_HI[k] & rqHi)) !== 0) {
    sliderAttacks(k, 0, 4, occLo, occHi);
    if (((attackLo & rqLo) | (attackHi & rqHi)) !== 0) return false;
  }
  const bqLo = b.bbLo[pieceCode(BISHOP, opp)] | b.bbLo[queen], bqHi = b.bbHi[pieceCode(BISHOP, opp)] | b.bbHi[queen];
  if (((BISHOP_RAYS_LO[k] & bqLo) | (BISHOP_RAYS_HI[k] & bqHi)) !== 0) {
    sliderAttacks(k, 4, 8, occLo, occHi);
    if (((attackLo & bqLo) | (attackHi & bqHi)) !== 0) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Legal move generation (MoveGen::new_legal order).
// ---------------------------------------------------------------------------

let out = null, outN = 0;   // destination buffer of the genLegal call in progress

/** Emit one crate MoveList entry: every destination in ascending order, 4 promotions each if promoting. */
function emit(src, lo, hi, promotion) {
  while ((lo | hi) !== 0) {
    const s = lowestSquare(lo, hi);
    if (s < 32) lo ^= 1 << s; else hi ^= 1 << (s - 32);
    if (promotion) for (let k = 0; k < 4; k++) out[outN++] = makeMoveCode(src, s, PROMOTION_ORDER[k]);
    else out[outN++] = makeMoveCode(src, s, 0);
  }
}

// Shared per-call context (set by genLegal).
let gAllLo = 0, gAllHi = 0, gMaskLo = 0, gMaskHi = 0, gCheckLo = -1, gCheckHi = -1;

/** get_pawn_moves(src, color, combined) & mask, into attackLo/attackHi. */
function pawnPseudoLegals(src, me) {
  const i = me * 64 + src;
  let lo = PAWN_ATTACKS_LO[i] & gAllLo, hi = PAWN_ATTACKS_HI[i] & gAllHi;
  const fwd = (src + (me === WHITE ? 8 : -8) + 64) & 63;   // Square::uforward wraps around the board
  const fwdOccupied = fwd < 32 ? (gAllLo >>> fwd) & 1 : (gAllHi >>> (fwd - 32)) & 1;
  if (fwdOccupied === 0) { lo ^= PAWN_PUSHES_LO[i] & ~gAllLo; hi ^= PAWN_PUSHES_HI[i] & ~gAllHi; }
  attackLo = lo & gMaskLo; attackHi = hi & gMaskHi;
}

function genPawns(b, inCheck) {
  const me = b.stm, code = pieceCode(PAWN, me), k = b.ksq[me], promoRank = me === WHITE ? 6 : 1;
  let lo = b.bbLo[code] & ~b.pinLo, hi = b.bbHi[code] & ~b.pinHi;
  while ((lo | hi) !== 0) {
    const src = lowestSquare(lo, hi);
    if (src < 32) lo ^= 1 << src; else hi ^= 1 << (src - 32);
    pawnPseudoLegals(src, me);
    const mLo = attackLo & gCheckLo, mHi = attackHi & gCheckHi;
    if ((mLo | mHi) !== 0) emit(src, mLo, mHi, rankOf(src) === promoRank);
  }
  if (!inCheck) {
    lo = b.bbLo[code] & b.pinLo; hi = b.bbHi[code] & b.pinHi;
    while ((lo | hi) !== 0) {
      const src = lowestSquare(lo, hi);
      if (src < 32) lo ^= 1 << src; else hi ^= 1 << (src - 32);
      pawnPseudoLegals(src, me);
      const i = k * 64 + src, mLo = attackLo & LINE_LO[i], mHi = attackHi & LINE_HI[i];
      if ((mLo | mHi) !== 0) emit(src, mLo, mHi, rankOf(src) === promoRank);
    }
  }
  if (b.ep >= 0) {
    const f = fileOf(b.ep), dest = b.ep + (me === WHITE ? 8 : -8);
    if (f > 0 && b.sq[b.ep - 1] === code && legalEpMove(b, b.ep - 1, dest)) out[outN++] = makeMoveCode(b.ep - 1, dest, 0);
    if (f < 7 && b.sq[b.ep + 1] === code && legalEpMove(b, b.ep + 1, dest)) out[outN++] = makeMoveCode(b.ep + 1, dest, 0);
  }
}

function genKnights(b) {
  const code = pieceCode(KNIGHT, b.stm);
  let lo = b.bbLo[code] & ~b.pinLo, hi = b.bbHi[code] & ~b.pinHi;
  while ((lo | hi) !== 0) {
    const src = lowestSquare(lo, hi);
    if (src < 32) lo ^= 1 << src; else hi ^= 1 << (src - 32);
    const mLo = KNIGHT_LO[src] & gMaskLo & gCheckLo, mHi = KNIGHT_HI[src] & gMaskHi & gCheckHi;
    if ((mLo | mHi) !== 0) emit(src, mLo, mHi, false);
  }
}

function genSliders(b, type, inCheck) {
  const code = pieceCode(type, b.stm), k = b.ksq[b.stm];
  const d0 = type === BISHOP ? 4 : 0, d1 = type === ROOK ? 4 : 8;
  let lo = b.bbLo[code] & ~b.pinLo, hi = b.bbHi[code] & ~b.pinHi;
  while ((lo | hi) !== 0) {
    const src = lowestSquare(lo, hi);
    if (src < 32) lo ^= 1 << src; else hi ^= 1 << (src - 32);
    sliderAttacks(src, d0, d1, gAllLo, gAllHi);
    const mLo = attackLo & gMaskLo & gCheckLo, mHi = attackHi & gMaskHi & gCheckHi;
    if ((mLo | mHi) !== 0) emit(src, mLo, mHi, false);
  }
  if (!inCheck) {
    lo = b.bbLo[code] & b.pinLo; hi = b.bbHi[code] & b.pinHi;
    while ((lo | hi) !== 0) {
      const src = lowestSquare(lo, hi);
      if (src < 32) lo ^= 1 << src; else hi ^= 1 << (src - 32);
      sliderAttacks(src, d0, d1, gAllLo, gAllHi);
      const i = src * 64 + k, mLo = attackLo & gMaskLo & LINE_LO[i], mHi = attackHi & gMaskHi & LINE_HI[i];
      if ((mLo | mHi) !== 0) emit(src, mLo, mHi, false);
    }
  }
}

function genKing(b, inCheck) {
  const me = b.stm, k = b.ksq[me];
  const noKingLo = gAllLo ^ bitLo(k), noKingHi = gAllHi ^ bitHi(k);
  let mLo = KING_LO[k] & gMaskLo, mHi = KING_HI[k] & gMaskHi;
  let lo = mLo, hi = mHi;
  while ((lo | hi) !== 0) {
    const d = lowestSquare(lo, hi);
    if (d < 32) lo ^= 1 << d; else hi ^= 1 << (d - 32);
    if (!kingSquareSafe(b, d, noKingLo, noKingHi)) { if (d < 32) mLo ^= 1 << d; else mHi ^= 1 << (d - 32); }
  }
  if (!inCheck) {
    const rights = b.castle[me], back = me === WHITE ? 0 : 56;
    if ((rights & 1) && ((gAllLo & KINGSIDE_EMPTY_LO[me]) | (gAllHi & KINGSIDE_EMPTY_HI[me])) === 0) {
      const middle = back + ((fileOf(k) + 1) & 7) + (k - back - fileOf(k)), right = back + ((fileOf(k) + 2) & 7) + (k - back - fileOf(k));
      if (kingSquareSafe(b, middle, noKingLo, noKingHi) && kingSquareSafe(b, right, noKingLo, noKingHi)) { mLo ^= bitLo(right); mHi ^= bitHi(right); }
    }
    if ((rights & 2) && ((gAllLo & QUEENSIDE_EMPTY_LO[me]) | (gAllHi & QUEENSIDE_EMPTY_HI[me])) === 0) {
      const middle = k - fileOf(k) + ((fileOf(k) + 7) & 7), left = k - fileOf(k) + ((fileOf(k) + 6) & 7);
      if (kingSquareSafe(b, middle, noKingLo, noKingHi) && kingSquareSafe(b, left, noKingLo, noKingHi)) { mLo ^= bitLo(left); mHi ^= bitHi(left); }
    }
  }
  if ((mLo | mHi) !== 0) emit(k, mLo, mHi, false);
}

/** Write the legal moves of `b` into `buffer` from index `start`, in MoveGen order; returns the end index. */
function genLegal(b, buffer, start) {
  out = buffer; outN = start;
  const me = b.stm;
  gAllLo = b.occLo[0] | b.occLo[1]; gAllHi = b.occHi[0] | b.occHi[1];
  gMaskLo = ~b.occLo[me]; gMaskHi = ~b.occHi[me];
  if (b.nCheckers === 0) {
    gCheckLo = -1; gCheckHi = -1;
    genPawns(b, false); genKnights(b);
    genSliders(b, BISHOP, false); genSliders(b, ROOK, false); genSliders(b, QUEEN, false);
    genKing(b, false);
  } else if (b.nCheckers === 1) {
    const i = b.checker * 64 + b.ksq[me];   // check mask: between(checker, king) ^ checker
    gCheckLo = BETWEEN_LO[i] ^ bitLo(b.checker); gCheckHi = BETWEEN_HI[i] ^ bitHi(b.checker);
    genPawns(b, true); genKnights(b);
    genSliders(b, BISHOP, true); genSliders(b, ROOK, true); genSliders(b, QUEEN, true);
    genKing(b, true);
  } else {
    genKing(b, true);
  }
  return outN;
}

const SCRATCH_MOVES = new Int32Array(512);
/** All legal moves as a fresh array, in the crate's MoveGen::new_legal iteration order. */
function legalMoves(b) {
  const n = genLegal(b, SCRATCH_MOVES, 0);
  return Array.from(SCRATCH_MOVES.subarray(0, n));
}

// ---------------------------------------------------------------------------
// Making moves (Board::make_move_new), in place or as a copy.
// ---------------------------------------------------------------------------

function setEp(b, s, capturerColor) {
  // Board::set_ep: record `s` only if a pawn of `capturerColor` stands next to it on its rank.
  const code = pieceCode(PAWN, capturerColor), f = fileOf(s);
  if ((f > 0 && b.sq[s - 1] === code) || (f < 7 && b.sq[s + 1] === code)) b.ep = s;
}

const UNDO_FIELDS = 16;

/** Apply `m` to `b` in place, saving what undo needs into u[base..base+UNDO_FIELDS). */
function applyMove(b, m, u, base) {
  const src = moveSource(m), dst = moveDest(m), promo = movePromotion(m);
  const me = b.stm, opp = 1 - me;
  const moved = b.sq[src], captured = b.sq[dst], mt = typeOf(moved), oldEp = b.ep;
  u[base] = captured; u[base + 1] = b.castle[0]; u[base + 2] = b.castle[1]; u[base + 3] = oldEp;
  u[base + 4] = b.nCheckers; u[base + 5] = b.checker; u[base + 6] = b.checkersLo; u[base + 7] = b.checkersHi;
  u[base + 8] = b.pinLo; u[base + 9] = b.pinHi; u[base + 10] = b.zLo; u[base + 11] = b.zHi;
  u[base + 12] = b.darkCornerCache; u[base + 13] = -1; u[base + 14] = -1; u[base + 15] = b.ksq[me];

  b.ep = -1; b._key = null; b.darkCornerCache = -1;
  if (captured !== 0) { togglePiece(b, captured, dst); b.count[captured]--; }
  togglePiece(b, moved, src); togglePiece(b, moved, dst);
  b.sq[src] = 0; b.sq[dst] = moved;
  b.castle[opp] &= ~CASTLES_PER_SQUARE[opp][dst];
  b.castle[me] &= ~CASTLES_PER_SQUARE[me][src];
  if (mt === PAWN) {
    if (promo !== 0) {
      const promoted = pieceCode(promo, me);
      togglePiece(b, moved, dst); togglePiece(b, promoted, dst);
      b.sq[dst] = promoted; b.count[moved]--; b.count[promoted]++;
    } else if ((rankOf(src) === 1 || rankOf(src) === 6) && (rankOf(dst) === 3 || rankOf(dst) === 4)) {
      setEp(b, dst, opp);
    } else if (oldEp >= 0 && ((dst + (me === WHITE ? -8 : 8)) & 63) === oldEp) {
      const pawn = pieceCode(PAWN, opp);
      togglePiece(b, pawn, oldEp); b.sq[oldEp] = 0; b.count[pawn]--;
      u[base + 13] = oldEp;
    }
  } else if (mt === KING) {
    b.ksq[me] = dst;
    if (IS_CASTLE_MOVE_SQUARE[src] && IS_CASTLE_MOVE_SQUARE[dst]) {
      const back = me === WHITE ? 0 : 56, fidx = fileOf(dst);
      const start = back + (fidx < 4 ? 0 : 7), end = back + (fidx < 4 ? 3 : 5), rook = b.sq[start];
      togglePiece(b, rook, start); togglePiece(b, rook, end);
      b.sq[end] = rook; b.sq[start] = 0;
      u[base + 14] = start;
    }
  }
  b.stm = opp;
  updatePinInfo(b);
}

/** Make `m` on `b` in place; undo with undoMove(b, m). */
function doMove(b, m) {
  if (b.undo === null) b.undo = new Int32Array(UNDO_FIELDS * 64);
  else if ((b.ply + 1) * UNDO_FIELDS > b.undo.length) { const bigger = new Int32Array(b.undo.length * 2); bigger.set(b.undo); b.undo = bigger; }
  applyMove(b, m, b.undo, b.ply++ * UNDO_FIELDS);
}

/** Take back the last doMove(b, m). */
function undoMove(b, m) {
  const u = b.undo, base = --b.ply * UNDO_FIELDS;
  const src = moveSource(m), dst = moveDest(m), promo = movePromotion(m);
  b.stm ^= 1;
  const me = b.stm, opp = 1 - me;
  const rookStart = u[base + 14];
  if (rookStart >= 0) {
    const back = me === WHITE ? 0 : 56, end = rookStart === back ? back + 3 : back + 5, rook = b.sq[end];
    toggleBits(b, rook, end); toggleBits(b, rook, rookStart);
    b.sq[rookStart] = rook; b.sq[end] = 0;
  }
  const epCaptured = u[base + 13];
  if (epCaptured >= 0) { const pawn = pieceCode(PAWN, opp); toggleBits(b, pawn, epCaptured); b.sq[epCaptured] = pawn; b.count[pawn]++; }
  const placed = b.sq[dst], moved = promo !== 0 ? pieceCode(PAWN, me) : placed;
  if (promo !== 0) { b.count[placed]--; b.count[moved]++; }
  toggleBits(b, placed, dst); toggleBits(b, moved, src);
  b.sq[src] = moved;
  const captured = u[base];
  b.sq[dst] = captured;
  if (captured !== 0) { toggleBits(b, captured, dst); b.count[captured]++; }
  b.castle[0] = u[base + 1]; b.castle[1] = u[base + 2]; b.ep = u[base + 3];
  b.nCheckers = u[base + 4]; b.checker = u[base + 5]; b.checkersLo = u[base + 6]; b.checkersHi = u[base + 7];
  b.pinLo = u[base + 8]; b.pinHi = u[base + 9]; b.zLo = u[base + 10]; b.zHi = u[base + 11];
  b.darkCornerCache = u[base + 12]; b.ksq[me] = u[base + 15]; b._key = null;
}

const SCRATCH_UNDO = new Int32Array(UNDO_FIELDS);
/** Board::make_move_new: a new board with `m` played. */
function makeMove(b, m) {
  const r = b.clone();
  applyMove(r, m, SCRATCH_UNDO, 0);
  return r;
}

// ---------------------------------------------------------------------------
// FEN parsing (BoardBuilder::from_str + TryFrom<BoardBuilder> + is_sane).
// ---------------------------------------------------------------------------

const FEN_PIECES = { p: PAWN, n: KNIGHT, b: BISHOP, r: ROOK, q: QUEEN, k: KING };

function finishBoard(b, epFile) {
  // Mirrors TryFrom<&BoardBuilder>: derived sets, ep square from the file, pin info, sanity.
  for (let s = 0; s < 64; s++) { const p = b.sq[s]; if (p) { b.count[p]++; togglePiece(b, p, s); } }
  let wk = 0, bk = 0;
  for (let s = 0; s < 64; s++) { if (b.sq[s] === pieceCode(KING, WHITE)) { wk++; b.ksq[WHITE] = s; } if (b.sq[s] === pieceCode(KING, BLACK)) { bk++; b.ksq[BLACK] = s; } }
  if (wk !== 1 || bk !== 1) return null;
  if (epFile >= 0) {
    const epSquare = makeSquare(b.stm === WHITE ? 4 : 3, epFile);
    setEp(b, epSquare, b.stm);
  }
  // is_sane: the en passant square must hold a pawn of the side that just moved.
  if (b.ep >= 0 && b.sq[b.ep] !== pieceCode(PAWN, 1 - b.stm)) return null;
  // The opponent may not be in check.
  b.stm ^= 1; updatePinInfo(b); const oppInCheck = b.nCheckers !== 0; b.stm ^= 1;
  if (oppInCheck) return null;
  updatePinInfo(b);
  for (const c of [WHITE, BLACK]) {
    const rights = b.castle[c], back = c === WHITE ? 0 : 56;
    if ((rights & 1) && b.sq[back + 7] !== pieceCode(ROOK, c)) return null;
    if ((rights & 2) && b.sq[back] !== pieceCode(ROOK, c)) return null;
    if (rights !== 0 && b.ksq[c] !== back + 4) return null;
  }
  if (DISTANCE[b.ksq[WHITE] * 64 + b.ksq[BLACK]] <= 1) return null;
  return b;
}

function boardFromFen(fen) {
  const tokens = fen.split(' ');
  if (tokens.length < 4) return null;
  const b = new Board();
  let rank = 7, file = 0;
  for (const ch of tokens[0]) {
    if (ch === '/') { rank = (rank + 7) & 7; file = 0; }
    else if (ch >= '1' && ch <= '8') { file = (file + (ch.charCodeAt(0) - 48)) & 7; }
    else {
      const t = FEN_PIECES[ch.toLowerCase()];
      if (t === undefined) return null;
      b.sq[makeSquare(rank, file)] = pieceCode(t, ch === ch.toLowerCase() ? BLACK : WHITE);
      file = (file + 1) & 7;
    }
  }
  const side = tokens[1];
  if (side === 'w' || side === 'W') b.stm = WHITE; else if (side === 'b' || side === 'B') b.stm = BLACK; else return null;
  const cs = tokens[2];
  b.castle[WHITE] = (cs.includes('K') ? 1 : 0) | (cs.includes('Q') ? 2 : 0);
  b.castle[BLACK] = (cs.includes('k') ? 1 : 0) | (cs.includes('q') ? 2 : 0);
  let epFile = -1;
  const ep = tokens[3];
  if (ep.length === 2 && ep[0] >= 'a' && ep[0] <= 'h' && ep[1] >= '1' && ep[1] <= '8') epFile = ep.charCodeAt(0) - 97;
  return finishBoard(b, epFile);
}

/** utils::mirror_board: reflect ranks, swap colors, side to move and castle rights. */
function mirrorBoard(b) {
  const r = new Board();
  for (let s = 0; s < 64; s++) { const p = b.sq[s]; if (p) r.sq[s ^ 56] = pieceCode(typeOf(p), 1 - colorOf(p)); }
  r.stm = 1 - b.stm;
  r.castle[WHITE] = b.castle[BLACK]; r.castle[BLACK] = b.castle[WHITE];
  return finishBoard(r, b.ep >= 0 ? fileOf(b.ep) : -1);
}

/** Reflect a move across the horizontal axis (utils::mirror_moves). */
const mirrorMove = (m) => makeMoveCode(moveSource(m) ^ 56, moveDest(m) ^ 56, movePromotion(m));

module.exports = {
  WHITE, BLACK, PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING,
  pieceCode, typeOf, colorOf, fileOf, rankOf, makeSquare, SQUARE_NAMES,
  RAYS, DIRECTION, DISTANCE, KNIGHT_TARGETS, KING_TARGETS, PAWN_ATTACK_TARGETS,
  moveSource, moveDest, movePromotion, makeMoveCode, moveToUci, mirrorMove,
  Board, legalMoves, genLegal, makeMove, doMove, undoMove, boardFromFen, mirrorBoard, updatePinInfo, PositionTable,
  // (lo, hi) geometry tables shared with the static analysis
  tables: {
    RAY_LO, RAY_HI, TOWARD_HIGHER, KNIGHT_LO, KNIGHT_HI, KING_LO, KING_HI, PAWN_ATTACKS_LO, PAWN_ATTACKS_HI,
    PAWN_PUSHES_LO, PAWN_PUSHES_HI, BETWEEN_LO, BETWEEN_HI, LINE_LO, LINE_HI,
    bitLo, bitHi, popcount32, lowestSquare, highestSquare,
    /** Move generation's slider attacks as [lo, hi] (for tests). */
    sliderAttacksOf: (sq, d0, d1, occLo, occHi) => { sliderAttacks(sq, d0, d1, occLo, occHi); return [attackLo, attackHi]; },
  },
};

};
defs['./deduction.js']=function(module,exports,require){
'use strict';
// ---------------------------------------------------------------------------
// Static analysis for helpmate winnability (chasolver src/deduction/*).
//
// Designed for White as the intended winner; a Black-intended-winner query is
// mirrored before reaching this module. Sound but incomplete: `true` from
// isStaticallyUnwinnable guarantees unwinnability, `false` is inconclusive.
//
// Every 64-bit set of the Rust code is a pair of Int32 halves here, named
// fooLo / fooHi (lo = a1..h4, hi = a5..h8), the representation board.js uses.
// Field names and control flow follow the Rust source. A loop over a set
// always iterates a snapshot taken when the loop starts, exactly like
// iterating a `Copy` BitBoard in Rust, even when the body mutates the field.
// Helpers return sets through the module-level registers rLo / rHi.
// ---------------------------------------------------------------------------

const B = require('./board.js');
const { WHITE, BLACK, PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING, pieceCode, typeOf, colorOf } = B;
const {
  RAY_LO, RAY_HI, TOWARD_HIGHER, KNIGHT_LO, KNIGHT_HI, KING_LO, KING_HI, PAWN_ATTACKS_LO, PAWN_ATTACKS_HI,
  PAWN_PUSHES_LO, PAWN_PUSHES_HI, BETWEEN_LO, BETWEEN_HI, LINE_LO, LINE_HI,
  bitLo, bitHi, popcount32, lowestSquare, highestSquare,
} = B.tables;

const FILE_LO = new Int32Array(8), FILE_HI = new Int32Array(8);
for (let s = 0; s < 64; s++) { FILE_LO[s & 7] |= bitLo(s); FILE_HI[s & 7] |= bitHi(s); }
const PROMOTION_RANKS_LO = 0x000000FF, PROMOTION_RANKS_HI = 0xFF000000 | 0;
const popcount = (lo, hi) => popcount32(lo) + popcount32(hi);

let rLo = 0, rHi = 0;   // result register of the helpers below

/** Slider attacks (first blocker included, like the crate's magic lookups) over directions [d0, d1). */
function slide(sq, d0, d1, blockersLo, blockersHi) {
  let aLo = 0, aHi = 0;
  for (let d = d0; d < d1; d++) {
    const i = d * 64 + sq;
    let lo = RAY_LO[i], hi = RAY_HI[i];
    const hitLo = lo & blockersLo, hitHi = hi & blockersHi;
    if ((hitLo | hitHi) !== 0) {
      const x = TOWARD_HIGHER[d] ? lowestSquare(hitLo, hitHi) : highestSquare(hitLo, hitHi);
      lo ^= RAY_LO[d * 64 + x]; hi ^= RAY_HI[d * 64 + x];
    }
    aLo |= lo; aHi |= hi;
  }
  rLo = aLo; rHi = aHi;
}

/** get_piece_moves: quiet pushes for pawns, full move geometry for every other piece. */
function pieceMoves(piece, color, square, blockersLo, blockersHi) {
  if (piece === KING) { rLo = KING_LO[square]; rHi = KING_HI[square]; }
  else if (piece === KNIGHT) { rLo = KNIGHT_LO[square]; rHi = KNIGHT_HI[square]; }
  else if (piece === PAWN) {
    const forward = (square + (color === WHITE ? 8 : -8) + 64) & 63;   // Square::uforward wraps
    const blocked = forward < 32 ? (blockersLo >>> forward) & 1 : (blockersHi >>> (forward - 32)) & 1;
    if (blocked !== 0) { rLo = 0; rHi = 0; }
    else { const i = color * 64 + square; rLo = PAWN_PUSHES_LO[i] & ~blockersLo; rHi = PAWN_PUSHES_HI[i] & ~blockersHi; }
  } else slide(square, piece === BISHOP ? 4 : 0, piece === ROOK ? 4 : 8, blockersLo, blockersHi);
}

/** get_piece_attacks: diagonal captures for pawns, the king's own square included. */
function pieceAttacks(piece, color, square, blockersLo, blockersHi) {
  if (piece === KING) { rLo = KING_LO[square] | bitLo(square); rHi = KING_HI[square] | bitHi(square); }
  else if (piece === PAWN) { const i = color * 64 + square; rLo = PAWN_ATTACKS_LO[i]; rHi = PAWN_ATTACKS_HI[i]; }
  else pieceMoves(piece, color, square, blockersLo, blockersHi);
}

class Analysis {
  constructor(board) {
    const wk = pieceCode(KING, WHITE), bk = pieceCode(KING, BLACK);
    this.board = board;
    this.sq = board.sq;
    this.bbLo = board.bbLo; this.bbHi = board.bbHi;
    this.colorLo = new Int32Array(board.occLo); this.colorHi = new Int32Array(board.occHi);
    this.combinedLo = board.occLo[0] | board.occLo[1]; this.combinedHi = board.occHi[0] | board.occHi[1];
    this.kingsLo = board.bbLo[wk] | board.bbLo[bk]; this.kingsHi = board.bbHi[wk] | board.bbHi[bk];
    this.whiteKingLo = board.bbLo[wk]; this.whiteKingHi = board.bbHi[wk];
    this.blackKingLo = board.bbLo[bk]; this.blackKingHi = board.bbHi[bk];
    this.whiteKingSq = board.ksq[WHITE]; this.blackKingSq = board.ksq[BLACK];
    this.whiteCount = popcount(board.occLo[WHITE], board.occHi[WHITE]);

    this.reachLo = new Int32Array(64); this.reachHi = new Int32Array(64);   // over-approx: squares each piece may reach
    this.steadyLo = this.combinedLo; this.steadyHi = this.combinedHi;        // under-approx: never moves nor gets captured
    this.clearLo = ~this.combinedLo; this.clearHi = ~this.combinedHi;        // under-approx: nothing ever enters
    this.attackedLo = new Int32Array(2); this.attackedHi = new Int32Array(2); // under-approx: always attacked, per colour
    this.capturableLo = 0; this.capturableHi = 0;                           // over-approx
    this.movableLo = 0; this.movableHi = 0;                                 // over-approx
    this.nonBishopLo = new Int32Array(2); this.nonBishopHi = new Int32Array(2); // reachable_by_non_bishop, over-approx
    this.sacrificableLo = new Int32Array(2); this.sacrificableHi = new Int32Array(2);
    this.hasUncapturable = false; this.uncapturableLo = 0; this.uncapturableHi = 0;       // uncapturable_while_steady
    this.hasCapturableOnly = false; this.capturableOnlyLo = 0; this.capturableOnlyHi = 0; // capturable_only_while_steady
    this.hasFirst = false; this.firstLo = 0; this.firstHi = 0;                            // first_steady_capturable
    this.promotable = false;
    this.progress = false;

    let lo = this.combinedLo, hi = this.combinedHi;
    while ((lo | hi) !== 0) {
      const s = lowestSquare(lo, hi);
      if (s < 32) lo ^= 1 << s; else hi ^= 1 << (s - 32);
      this.reachLo[s] |= bitLo(s); this.reachHi[s] |= bitHi(s);
    }
    this.updateAttackedSquares();
  }

  setUncapturableWhileSteady(lo, hi) { this.hasUncapturable = true; this.uncapturableLo = lo; this.uncapturableHi = hi; }
  setCapturableOnlyWhileSteady(lo, hi) { this.hasCapturableOnly = true; this.capturableOnlyLo = lo; this.capturableOnlyHi = hi; }

  /** Recompute squares that stay attacked, from pieces guaranteed to remain on the board. */
  updateAttackedSquares() {
    this.attackedLo[0] = 0; this.attackedLo[1] = 0; this.attackedHi[0] = 0; this.attackedHi[1] = 0;
    let lo = this.combinedLo & ~this.capturableLo, hi = this.combinedHi & ~this.capturableHi;
    while ((lo | hi) !== 0) {
      const s = lowestSquare(lo, hi);
      if (s < 32) lo ^= 1 << s; else hi ^= 1 << (s - 32);
      const piece = typeOf(this.sq[s]), color = colorOf(this.sq[s]);
      let obstaclesLo = ~this.clearLo, obstaclesHi = ~this.clearHi;
      // Same-colour bishops are transparent to each other when no other piece can ever stand there.
      if (piece === BISHOP) {
        const code = pieceCode(BISHOP, color);
        obstaclesLo &= ~(this.bbLo[code] & ~this.nonBishopLo[color] & ~this.capturableLo);
        obstaclesHi &= ~(this.bbHi[code] & ~this.nonBishopHi[color] & ~this.capturableHi);
      }
      let attackedLo = -1, attackedHi = -1;
      let tLo = this.reachLo[s], tHi = this.reachHi[s];
      while ((tLo | tHi) !== 0) {
        const t = lowestSquare(tLo, tHi);
        if (t < 32) tLo ^= 1 << t; else tHi ^= 1 << (t - 32);
        pieceAttacks(piece, color, t, obstaclesLo, obstaclesHi);
        attackedLo &= rLo; attackedHi &= rHi;
      }
      this.attackedLo[color] |= attackedLo; this.attackedHi[color] |= attackedHi;
    }
  }

  /** Fixpoint iteration growing every reachable set and the state derived from them. */
  saturate() {
    const whiteCount = this.whiteCount;
    for (;;) {
      this.progress = false;
      let pLo = this.combinedLo, pHi = this.combinedHi;
      while ((pLo | pHi) !== 0) {
        const s = lowestSquare(pLo, pHi);
        if (s < 32) pLo ^= 1 << s; else pHi ^= 1 << (s - 32);
        const piece = typeOf(this.sq[s]), color = colorOf(this.sq[s]);

        let srcLo = this.reachLo[s], srcHi = this.reachHi[s];
        while ((srcLo | srcHi) !== 0) {
          const source = lowestSquare(srcLo, srcHi);
          if (source < 32) srcLo ^= 1 << source; else srcHi ^= 1 << (source - 32);
          pieceMoves(piece, color, source, this.steadyLo, this.steadyHi);
          let tLo = rLo, tHi = rHi;
          // Do not consider pawn attacks if White has one only non-king piece left.
          if (piece === PAWN && (color === WHITE || whiteCount > 2)) {
            const i = color * 64 + source;
            tLo |= PAWN_ATTACKS_LO[i] & this.sacrificableLo[1 - color];
            tHi |= PAWN_ATTACKS_HI[i] & this.sacrificableHi[1 - color];
          }
          this.filterTargets(s, piece, color, source, tLo, tHi);
          tLo = rLo; tHi = rHi;
          this.updateReachable(s, tLo, tHi);
          this.updateMovable(s, tLo, tHi);
        }

        const reachLo = this.reachLo[s], reachHi = this.reachHi[s], sLo = bitLo(s), sHi = bitHi(s);
        if (((reachLo & ~sLo) | (reachHi & ~sHi)) !== 0) this.updateNonSteady(sLo, sHi);

        let capLo = 0, capHi = 0;
        let maskLo = ~this.kingsLo, maskHi = ~this.kingsHi;
        if (piece === PAWN) { maskLo &= ~FILE_LO[s & 7]; maskHi &= ~FILE_HI[s & 7]; }
        if (color === WHITE || whiteCount > 2) {
          let oLo = this.colorLo[1 - color] & maskLo, oHi = this.colorHi[1 - color] & maskHi;
          while ((oLo | oHi) !== 0) {
            const opp = lowestSquare(oLo, oHi);
            if (opp < 32) oLo ^= 1 << opp; else oHi ^= 1 << (opp - 32);
            if (((reachLo & this.reachLo[opp]) | (reachHi & this.reachHi[opp])) !== 0) { capLo |= bitLo(opp); capHi |= bitHi(opp); }
          }
        }
        this.updateCapturable(capLo, capHi);
        this.updateNonSteady(reachLo & ~sLo & ~this.kingsLo, reachHi & ~sHi & ~this.kingsHi);
        this.updateNonClear(reachLo, reachHi);
        if (piece !== KING) this.updateSacrificable(color, reachLo, reachHi);

        // A pawn that can promote may reach anything but squares of steady friends or steady kings.
        if (piece === PAWN && ((this.reachLo[s] & PROMOTION_RANKS_LO) | (this.reachHi[s] & PROMOTION_RANKS_HI)) !== 0) {
          this.promotable = true;
          const lockedLo = this.steadyLo & (this.colorLo[color] | this.kingsLo), lockedHi = this.steadyHi & (this.colorHi[color] | this.kingsHi);
          this.updateReachable(s, ~lockedLo, ~lockedHi);
        }
      }
      this.updateAttackedSquares();
      if (!this.progress) break;
    }
  }

  /** Narrow candidate destinations of the piece that started on `initial`, now on `source`; result in rLo/rHi. */
  filterTargets(initial, piece, color, source, tLo, tHi) {
    const sq = this.sq;
    const clearNotLo = ~this.clearLo, clearNotHi = ~this.clearHi;
    tLo &= ~this.reachLo[initial]; tHi &= ~this.reachHi[initial];
    tLo &= ~(this.colorLo[color] & this.steadyLo); tHi &= ~(this.colorHi[color] & this.steadyHi);
    if (piece === KING) { tLo &= ~this.attackedLo[1 - color]; tHi &= ~this.attackedHi[1 - color]; }

    const wkLo = this.whiteKingLo, wkHi = this.whiteKingHi;

    // Filter targets if we are mating the white king (Black may never give check).
    if (color === BLACK && ((wkLo & this.steadyLo) | (wkHi & this.steadyHi)) !== 0) {
      let lo = tLo, hi = tHi;
      while ((lo | hi) !== 0) {
        const t = lowestSquare(lo, hi);
        if (t < 32) lo ^= 1 << t; else hi ^= 1 << (t - 32);
        pieceAttacks(piece, color, t, clearNotLo, clearNotHi);
        if (((wkLo & rLo) | (wkHi & rHi)) !== 0 && ((bitLo(t) & this.sacrificableLo[WHITE]) | (bitHi(t) & this.sacrificableHi[WHITE])) === 0) {
          tLo &= ~bitLo(t); tHi &= ~bitHi(t);
        }
      }
      const blockersLo = clearNotLo & ~bitLo(source), blockersHi = clearNotHi & ~bitHi(source);
      const li = this.whiteKingSq * 64 + source;
      const checkersLo = this.colorLo[BLACK] & this.steadyLo & ~bitLo(source) & LINE_LO[li];
      const checkersHi = this.colorHi[BLACK] & this.steadyHi & ~bitHi(source) & LINE_HI[li];
      lo = tLo; hi = tHi;
      while ((lo | hi) !== 0) {
        const t = lowestSquare(lo, hi);
        if (t < 32) lo ^= 1 << t; else hi ^= 1 << (t - 32);
        let cLo = checkersLo, cHi = checkersHi;
        while ((cLo | cHi) !== 0) {
          const checker = lowestSquare(cLo, cHi);
          if (checker < 32) cLo ^= 1 << checker; else cHi ^= 1 << (checker - 32);
          pieceAttacks(typeOf(sq[checker]), BLACK, checker, blockersLo | bitLo(t), blockersHi | bitHi(t));
          if (((rLo & wkLo) | (rHi & wkHi)) !== 0) { tLo &= ~bitLo(t); tHi &= ~bitHi(t); break; }
        }
      }
    }

    // Last white piece checking a steady black king at distance 1 would just be captured.
    const bkLo = this.blackKingLo, bkHi = this.blackKingHi;
    if (color === WHITE && this.whiteCount === 2) {
      let lo = tLo, hi = tHi;
      while ((lo | hi) !== 0) {
        const t = lowestSquare(lo, hi);
        if (t < 32) lo ^= 1 << t; else hi ^= 1 << (t - 32);
        const wk = this.whiteKingSq;
        if (((this.reachLo[wk] & KING_LO[t]) | (this.reachHi[wk] & KING_HI[t])) !== 0) {
          let aLo = this.steadyLo & this.colorLo[BLACK] & ~bkLo, aHi = this.steadyHi & this.colorHi[BLACK] & ~bkHi;
          let noSteadyAttacker = true;
          while ((aLo | aHi) !== 0) {
            const a = lowestSquare(aLo, aHi);
            if (a < 32) aLo ^= 1 << a; else aHi ^= 1 << (a - 32);
            pieceAttacks(typeOf(sq[a]), BLACK, a, clearNotLo, clearNotHi);
            if (((rLo & bitLo(t)) | (rHi & bitHi(t))) !== 0) { noSteadyAttacker = false; break; }
          }
          if (noSteadyAttacker) continue;
        }
        if (((bkLo & this.steadyLo) | (bkHi & this.steadyHi)) !== 0) {
          pieceAttacks(piece, color, t, clearNotLo, clearNotHi);
          if (((rLo & bkLo & KING_LO[t]) | (rHi & bkHi & KING_HI[t])) !== 0) { tLo &= ~bitLo(t); tHi &= ~bitHi(t); }
        }
      }
    }

    // Filter king moves that would stalemate an opponent who can only move the king.
    if (piece === KING) {
      const oppLo = this.colorLo[1 - color], oppHi = this.colorHi[1 - color];
      const oppKingLo = oppLo & this.kingsLo, oppKingHi = oppHi & this.kingsHi;
      const oppCanOnlyMoveKing = ((~oppKingLo & oppLo & this.movableLo) | (~oppKingHi & oppHi & this.movableHi)) === 0;
      const oppKing = lowestSquare(oppKingLo, oppKingHi);
      const regionLo = this.reachLo[oppKing] | (KING_LO[oppKing] & ~this.attackedLo[color] & ~this.steadyLo);
      const regionHi = this.reachHi[oppKing] | (KING_HI[oppKing] & ~this.attackedHi[color] & ~this.steadyHi);
      const bq = pieceCode(BISHOP, color), rq = pieceCode(ROOK, color), qq = pieceCode(QUEEN, color);
      const diagLo = this.bbLo[bq] | this.bbLo[qq], diagHi = this.bbHi[bq] | this.bbHi[qq];
      const lineLo = this.bbLo[rq] | this.bbLo[qq], lineHi = this.bbHi[rq] | this.bbHi[qq];
      if (oppCanOnlyMoveKing) {
        let lo = tLo, hi = tHi;
        while ((lo | hi) !== 0) {
          const t = lowestSquare(lo, hi);
          if (t < 32) lo ^= 1 << t; else hi ^= 1 << (t - 32);
          const fromTargetLo = KING_LO[t] | bitLo(t), fromTargetHi = KING_HI[t] | bitHi(t);
          if (((KING_LO[oppKing] & fromTargetLo) | (KING_HI[oppKing] & fromTargetHi)) === 0) continue;
          const blockersLo = clearNotLo | bitLo(t), blockersHi = clearNotHi | bitHi(t);
          // Vacating `source` may open a line for a friendly slider: that would be mate, not stalemate.
          slide(source, 4, 8, blockersLo, blockersHi);
          if (this.anyReaches(diagLo, diagHi, rLo & ~blockersLo, rHi & ~blockersHi)) continue;
          slide(source, 0, 4, blockersLo, blockersHi);
          if (this.anyReaches(lineLo, lineHi, rLo & ~blockersLo, rHi & ~blockersHi)) continue;
          if (popcount(regionLo & ~fromTargetLo, regionHi & ~fromTargetHi) <= 1) { tLo &= ~bitLo(t); tHi &= ~bitHi(t); }
        }
      }
    }

    // Filter targets behind a piece that can neither move out of the way nor be captured.
    let lo = tLo, hi = tHi;
    while ((lo | hi) !== 0) {
      const t = lowestSquare(lo, hi);
      if (t < 32) lo ^= 1 << t; else hi ^= 1 << (t - 32);
      const bi = source * 64 + t;
      const wayLo = BETWEEN_LO[bi] | bitLo(source) | bitLo(t), wayHi = BETWEEN_HI[bi] | bitHi(source) | bitHi(t);
      let oLo = this.combinedLo & wayLo & ~bitLo(initial) & ~this.capturableLo;
      let oHi = this.combinedHi & wayHi & ~bitHi(initial) & ~this.capturableHi;
      while ((oLo | oHi) !== 0) {
        const obstacle = lowestSquare(oLo, oHi);
        if (obstacle < 32) oLo ^= 1 << obstacle; else oHi ^= 1 << (obstacle - 32);
        let realLo = wayLo, realHi = wayHi;
        const obstaclePiece = typeOf(sq[obstacle]);
        if (colorOf(sq[obstacle]) !== color && (obstaclePiece !== PAWN || piece !== PAWN || (source & 7) !== (t & 7))) {
          realLo &= ~bitLo(obstacle); realHi &= ~bitHi(obstacle);
        }
        if (piece === PAWN && obstaclePiece === PAWN && ((this.reachLo[initial] & ~FILE_LO[t & 7]) | (this.reachHi[initial] & ~FILE_HI[t & 7])) === 0) {
          const li = initial * 64 + obstacle;
          realLo |= LINE_LO[li]; realHi |= LINE_HI[li];
        }
        if (((this.reachLo[obstacle] & ~realLo) | (this.reachHi[obstacle] & ~realHi)) === 0) { tLo &= ~bitLo(t); tHi &= ~bitHi(t); }
      }
      if (this.hasUncapturable) { tLo &= ~(this.uncapturableLo & this.steadyLo); tHi &= ~(this.uncapturableHi & this.steadyHi); }
    }

    if (this.hasCapturableOnly && ((bitLo(initial) & this.capturableOnlyLo) | (bitHi(initial) & this.capturableOnlyHi)) !== 0) {
      tLo = 0; tHi = 0;
    }
    rLo = tLo; rHi = tHi;
  }

  /** Does any piece standing on (piecesLo, piecesHi) have a reachable square in (lo, hi)? */
  anyReaches(piecesLo, piecesHi, lo, hi) {
    while ((piecesLo | piecesHi) !== 0) {
      const s = lowestSquare(piecesLo, piecesHi);
      if (s < 32) piecesLo ^= 1 << s; else piecesHi ^= 1 << (s - 32);
      if (((this.reachLo[s] & lo) | (this.reachHi[s] & hi)) !== 0) return true;
    }
    return false;
  }

  updateReachable(square, lo, hi) {
    const nLo = this.reachLo[square] | lo, nHi = this.reachHi[square] | hi;
    if (nLo !== this.reachLo[square] || nHi !== this.reachHi[square]) { this.reachLo[square] = nLo; this.reachHi[square] = nHi; this.progress = true; }
    if (typeOf(this.sq[square]) !== BISHOP) {
      const c = colorOf(this.sq[square]);
      const bLo = this.nonBishopLo[c] | lo, bHi = this.nonBishopHi[c] | hi;
      if (bLo !== this.nonBishopLo[c] || bHi !== this.nonBishopHi[c]) { this.nonBishopLo[c] = bLo; this.nonBishopHi[c] = bHi; this.progress = true; }
    }
  }

  updateMovable(s, tLo, tHi) {
    if (((tLo & ~bitLo(s)) | (tHi & ~bitHi(s))) !== 0) {
      const nLo = this.movableLo | bitLo(s), nHi = this.movableHi | bitHi(s);
      if (nLo !== this.movableLo || nHi !== this.movableHi) { this.movableLo = nLo; this.movableHi = nHi; this.progress = true; }
    }
  }

  updateNonSteady(lo, hi) {
    const nLo = this.steadyLo & ~lo, nHi = this.steadyHi & ~hi;
    if (nLo !== this.steadyLo || nHi !== this.steadyHi) { this.steadyLo = nLo; this.steadyHi = nHi; this.progress = true; }
  }

  updateCapturable(lo, hi) {
    if (((lo & this.steadyLo) | (hi & this.steadyHi)) !== 0) {
      if (!this.hasFirst) { this.hasFirst = true; this.firstLo = lo & this.steadyLo; this.firstHi = hi & this.steadyHi; }
      else if (!this.promotable) { this.firstLo |= lo & this.steadyLo; this.firstHi |= hi & this.steadyHi; }
    }
    const nLo = this.capturableLo | lo, nHi = this.capturableHi | hi;
    if (nLo !== this.capturableLo || nHi !== this.capturableHi) { this.capturableLo = nLo; this.capturableHi = nHi; this.progress = true; }
  }

  updateSacrificable(color, lo, hi) {
    const nLo = this.sacrificableLo[color] | lo, nHi = this.sacrificableHi[color] | hi;
    if (nLo !== this.sacrificableLo[color] || nHi !== this.sacrificableHi[color]) { this.sacrificableLo[color] = nLo; this.sacrificableHi[color] = nHi; this.progress = true; }
  }

  updateNonClear(lo, hi) {
    const nLo = this.clearLo & ~lo, nHi = this.clearHi & ~hi;
    if (nLo !== this.clearLo || nHi !== this.clearHi) { this.clearLo = nLo; this.clearHi = nHi; this.progress = true; }
  }

  /** Is there a square where Black's king could be mated? Must be called after saturation. */
  blackCouldGetMated() {
    const wk = this.whiteKingSq, bk = this.blackKingSq;
    const wkReachLo = this.reachLo[wk], wkReachHi = this.reachHi[wk];
    const regionLo = this.reachLo[bk], regionHi = this.reachHi[bk];
    this.visitors(regionLo, regionHi);
    if ((this.visitorsLo | this.visitorsHi) === 0) return false;
    const visitedLo = this.visitedLo, visitedHi = this.visitedHi;
    let mLo = visitedLo, mHi = visitedHi;
    while ((mLo | mHi) !== 0) {
      const matingSquare = lowestSquare(mLo, mHi);
      if (matingSquare < 32) mLo ^= 1 << matingSquare; else mHi ^= 1 << (matingSquare - 32);
      const escapeLo = KING_LO[matingSquare] & regionLo & ~visitedLo, escapeHi = KING_HI[matingSquare] & regionHi & ~visitedHi;
      this.blockers(escapeLo, escapeHi);
      const n = Math.min(popcount(this.blockersLo, this.blockersHi), popcount(this.blockingLo, this.blockingHi));
      // Try all ways to put n black pieces on n squares of the blocking region (Gosper's hack).
      const squares = [];
      let bl = this.blockingLo, bh = this.blockingHi;
      while ((bl | bh) !== 0) { const s = lowestSquare(bl, bh); if (s < 32) bl ^= 1 << s; else bh ^= 1 << (s - 32); squares.push(s); }
      const k = squares.length;
      if (n > k) continue;
      let mask = n > 0 ? (1 << n) - 1 : 0;
      for (;;) {
        let coveredLo = 0, coveredHi = 0;
        for (let i = 0; i < k; i++) if ((mask >>> i) & 1) { coveredLo |= bitLo(squares[i]); coveredHi |= bitHi(squares[i]); }
        const remainingLo = escapeLo & ~coveredLo, remainingHi = escapeHi & ~coveredHi;
        if ((remainingLo | remainingHi) === 0) return true;
        // Can the white king cover all remaining squares from one reachable square?
        let candLo = 0, candHi = 0, rl = remainingLo, rh = remainingHi;
        while ((rl | rh) !== 0) { const r = lowestSquare(rl, rh); if (r < 32) rl ^= 1 << r; else rh ^= 1 << (r - 32); candLo |= KING_LO[r]; candHi |= KING_HI[r]; }
        candLo &= ~(bitLo(matingSquare) | KING_LO[matingSquare]); candHi &= ~(bitHi(matingSquare) | KING_HI[matingSquare]);
        let cl = candLo & wkReachLo, ch = candHi & wkReachHi;
        while ((cl | ch) !== 0) {
          const s = lowestSquare(cl, ch);
          if (s < 32) cl ^= 1 << s; else ch ^= 1 << (s - 32);
          if ((KING_LO[s] & remainingLo) === remainingLo && (KING_HI[s] & remainingHi) === remainingHi) return true;
        }
        if (n === 0) break;
        const c = mask & -mask, r = mask + c, next = (((r ^ mask) >>> 2) / c) | r;
        if (!(next < 2 ** k)) break;
        mask = next;
      }
    }
    return false;
  }

  /** White non-king pieces that can attack `region` (visitorsLo/Hi) and the part they attack (visitedLo/Hi). */
  visitors(regionLo, regionHi) {
    let visLo = 0, visHi = 0, vLo = 0, vHi = 0;
    const clearNotLo = ~this.clearLo, clearNotHi = ~this.clearHi;
    let wLo = this.colorLo[WHITE], wHi = this.colorHi[WHITE];
    while ((wLo | wHi) !== 0) {
      const s = lowestSquare(wLo, wHi);
      if (s < 32) wLo ^= 1 << s; else wHi ^= 1 << (s - 32);
      const piece = typeOf(this.sq[s]);
      if (piece === KING) continue;
      if (this.reachLo[s] === bitLo(s) && this.reachHi[s] === bitHi(s)) continue;
      let tLo = this.reachLo[s], tHi = this.reachHi[s];
      while ((tLo | tHi) !== 0) {
        const t = lowestSquare(tLo, tHi);
        if (t < 32) tLo ^= 1 << t; else tHi ^= 1 << (t - 32);
        pieceAttacks(piece, WHITE, t, clearNotLo, clearNotHi);
        const xLo = regionLo & rLo, xHi = regionHi & rHi;
        if ((xLo | xHi) !== 0) { visLo |= bitLo(s); visHi |= bitHi(s); vLo |= xLo; vHi |= xHi; }
      }
    }
    this.visitorsLo = visLo; this.visitorsHi = visHi; this.visitedLo = vLo; this.visitedHi = vHi;
  }

  /** Black non-king pieces that can reach `region` (blockersLo/Hi) and the part they reach (blockingLo/Hi). */
  blockers(regionLo, regionHi) {
    let bLo = 0, bHi = 0, gLo = 0, gHi = 0;
    let pLo = this.colorLo[BLACK] & ~this.kingsLo, pHi = this.colorHi[BLACK] & ~this.kingsHi;
    while ((pLo | pHi) !== 0) {
      const s = lowestSquare(pLo, pHi);
      if (s < 32) pLo ^= 1 << s; else pHi ^= 1 << (s - 32);
      const xLo = regionLo & this.reachLo[s], xHi = regionHi & this.reachHi[s];
      if ((xLo | xHi) !== 0) { bLo |= bitLo(s); bHi |= bitHi(s); gLo |= xLo; gHi |= xHi; }
    }
    this.blockersLo = bLo; this.blockersHi = bHi; this.blockingLo = gLo; this.blockingHi = gHi;
  }
}

/** Saturate under the given case-split assumptions and ask whether Black could get mated. */
function blackCouldGetMatedAssuming(board, uncapturable, capturableOnly) {
  const a = new Analysis(board);
  if (uncapturable !== null) a.setUncapturableWhileSteady(uncapturable[0], uncapturable[1]);
  if (capturableOnly !== null) a.setCapturableOnlyWhileSteady(capturableOnly[0], capturableOnly[1]);
  a.saturate();
  return a.blackCouldGetMated();
}

/** deduction::is_statically_unwinnable, with its case splits on steady-and-capturable pieces. */
function isStaticallyUnwinnable(board) {
  if (board.ep >= 0) return false;
  const analysis = new Analysis(board);
  if (analysis.whiteCount === 2) {
    analysis.setUncapturableWhileSteady(analysis.colorLo[WHITE] & ~analysis.kingsLo, analysis.colorHi[WHITE] & ~analysis.kingsHi);
  }
  analysis.saturate();
  if (!analysis.blackCouldGetMated()) return true;
  if (!analysis.hasFirst) return false;

  const firstLo = analysis.firstLo, firstHi = analysis.firstHi;
  let lo = firstLo, hi = firstHi;
  while ((lo | hi) !== 0) {
    const s = lowestSquare(lo, hi);
    if (s < 32) lo ^= 1 << s; else hi ^= 1 << (s - 32);
    if (blackCouldGetMatedAssuming(board, [bitLo(s), bitHi(s)], null)) continue;
    // Case B: the piece can only be captured while still on its starting square.
    if (!blackCouldGetMatedAssuming(board, null, [bitLo(s), bitHi(s)])) return true;
  }

  if (popcount(firstLo, firstHi) === 2) {
    const s1 = lowestSquare(firstLo, firstHi);
    const s2 = lowestSquare(firstLo & ~bitLo(s1), firstHi & ~bitHi(s1));
    const one = [bitLo(s1), bitHi(s1)], two = [bitLo(s2), bitHi(s2)], both = [firstLo, firstHi];
    if (blackCouldGetMatedAssuming(board, both, null)) return false;
    if (blackCouldGetMatedAssuming(board, one, two)) return false;
    if (blackCouldGetMatedAssuming(board, two, one)) return false;
    return !blackCouldGetMatedAssuming(board, null, both);
  }
  return false;
}

/** Bishop moves from `sq` given blockers, as [lo, hi] (for the search's bishop distances). */
function bishopMoves(sq, blockersLo, blockersHi) { slide(sq, 4, 8, blockersLo, blockersHi); return [rLo, rHi]; }

/** get_piece_moves as [lo, hi] (for tests). */
function pieceMovesOf(piece, color, sq, blockersLo, blockersHi) { pieceMoves(piece, color, sq, blockersLo, blockersHi); return [rLo, rHi]; }

module.exports = { Analysis, isStaticallyUnwinnable, bishopMoves, pieceMovesOf };

};
defs['./search.js']=function(module,exports,require){
'use strict';
// ---------------------------------------------------------------------------
// Helpmate search (chasolver src/search/*): the Search state, iterative
// deepening, the recursive helpmate search with its depth-adjustment
// heuristics, forced-move playout, probes, and board/material queries.
// Designed for White as the intended winner.
// ---------------------------------------------------------------------------

const B = require('./board.js');
const { isStaticallyUnwinnable, bishopMoves } = require('./deduction.js');
const { bitLo, bitHi, lowestSquare } = B.tables;
const { WHITE, BLACK, PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING, pieceCode, legalMoves, makeMove, moveSource, moveDest } = B;

const U64_MAX = Number.MAX_SAFE_INTEGER;   // stands in for u64::MAX ("no limit")
const NORMAL = 0, REWARD = 1, PUNISH = 2;

// ---------------------------------------------------------------------------
// Board / material queries.
// ---------------------------------------------------------------------------

const isDarkSquare = (s) => ((B.fileOf(s) + B.rankOf(s)) & 1) === 0;
/** DARK_SQUARES = 0xAA55AA55AA55AA55 as (lo, hi) halves. */
const DARK_LO = 0xAA55AA55 | 0, DARK_HI = 0xAA55AA55 | 0;
const LIGHT_LO = ~DARK_LO, LIGHT_HI = ~DARK_HI;

/** No knights, rooks or queens on the board. */
function onlyPawnsAndBishops(b) {
  return b.numType(KNIGHT) === 0 && b.numType(ROOK) === 0 && b.numType(QUEEN) === 0;
}

/** White pawns with a black pawn or the black king directly in front. */
function nbBlockedPawns(b) {
  let n = 0;
  const wp = pieceCode(PAWN, WHITE), bp = pieceCode(PAWN, BLACK), bk = pieceCode(KING, BLACK);
  for (let s = 0; s < 56; s++) if (b.sq[s] === wp && (b.sq[s + 8] === bp || b.sq[s + 8] === bk)) n++;
  return n;
}

/** Some pawn has no opposing pawn on its file (white pawns on rank 7 and black on rank 2 ignored). */
function hasLonelyPawns(b) {
  let wf = 0, bf = 0;
  const wp = pieceCode(PAWN, WHITE), bp = pieceCode(PAWN, BLACK);
  for (let s = 0; s < 64; s++) {
    if (b.sq[s] === wp && B.rankOf(s) !== 6) wf |= 1 << B.fileOf(s);
    if (b.sq[s] === bp && B.rankOf(s) !== 1) bf |= 1 << B.fileOf(s);
  }
  return wf !== bf;
}

/** White has insufficient material to mate Black. */
function insufficientWhiteMaterial(b) {
  const white = b.numColor(WHITE);
  if (white === 1) return true;
  const c = b.count;
  if (white === 2 && c[pieceCode(KNIGHT, WHITE)] > 0 &&
      c[pieceCode(KNIGHT, BLACK)] + c[pieceCode(BISHOP, BLACK)] + c[pieceCode(ROOK, BLACK)] + c[pieceCode(PAWN, BLACK)] === 0) {
    return true;
  }
  const whiteBishops = c[pieceCode(BISHOP, WHITE)];
  if (whiteBishops > 0) {
    if (white === whiteBishops + 1 && b.numType(KNIGHT) === 0 && b.numType(PAWN) === 0) {
      // Colour of White's bishops: dark if any of them stands on a dark square; every bishop must share it.
      const wb = pieceCode(BISHOP, WHITE), bb = pieceCode(BISHOP, BLACK);
      const anyDark = ((b.bbLo[wb] & DARK_LO) | (b.bbHi[wb] & DARK_HI)) !== 0;
      const allLo = b.bbLo[wb] | b.bbLo[bb], allHi = b.bbHi[wb] | b.bbHi[bb];
      const otherColour = anyDark ? (allLo & LIGHT_LO) | (allHi & LIGHT_HI) : (allLo & DARK_LO) | (allHi & DARK_HI);
      return otherColour === 0;
    }
  }
  return false;
}

const isCapture = (b, m) => b.sq[moveDest(m)] !== 0;
function isPawnAdvance(b, m) {
  const p = b.sq[moveSource(m)];
  return p === pieceCode(PAWN, WHITE) && B.rankOf(moveDest(m)) > B.rankOf(moveSource(m));
}

/** Legal moves from `b` that immediately lead to a statically unwinnable position. */
function computePunishable(b) {
  const set = new Set();
  for (const m of legalMoves(b)) if (isStaticallyUnwinnable(makeMove(b, m))) set.add(m);
  return set;
}

// ---------------------------------------------------------------------------
// Distance helpers.
// ---------------------------------------------------------------------------

const kingDistance = (a, b) => B.DISTANCE[a * 64 + b];

function computeKnightDistance(x, y) {
  const fileDist = Math.abs(B.fileOf(x) - B.fileOf(y)), rankDist = Math.abs(B.rankOf(x) - B.rankOf(y));
  const minD = Math.min(fileDist, rankDist), maxD = Math.max(fileDist, rankDist);
  const isCorner = (s) => s === 0 || s === 7 || s === 56 || s === 63;
  if (minD === 1 && maxD === 1 && (isCorner(x) || isCorner(y))) return 4;
  if (minD % 2 === maxD % 2) {
    const key = `${minD},${maxD}`;
    const table = { '0,0': 0, '0,2': 2, '0,4': 2, '2,4': 2, '1,1': 2, '1,3': 2, '3,3': 2, '7,7': 6 };
    return key in table ? table[key] : 4;
  }
  if (maxD === 7) return 5;
  if (minD === 1 && maxD === 2) return 1;
  if (minD === 5 && maxD === 6) return 5;
  return 3;
}
const KNIGHT_DISTANCE = new Uint8Array(64 * 64);
for (let a = 0; a < 64; a++) for (let b = 0; b < 64; b++) KNIGHT_DISTANCE[a * 64 + b] = computeKnightDistance(a, b);

/** Change in distance to `target` after the move (negative = closer); 0 for other pieces. */
function movesTowardSquare(m, piece, target) {
  if (piece === KING) return kingDistance(moveDest(m), target) - kingDistance(moveSource(m), target);
  if (piece === KNIGHT) return KNIGHT_DISTANCE[moveDest(m) * 64 + target] - KNIGHT_DISTANCE[moveSource(m) * 64 + target];
  return 0;
}

const flipSquareFile = (s) => B.makeSquare(B.rankOf(s), 7 - B.fileOf(s));

/** Corner selection shared by the heuristics: dark-square corner or light-square corner. */
function darkCorner(b) {
  if (b.darkCornerCache !== -1) return b.darkCornerCache === 1;
  const result = computeDarkCorner(b);
  b.darkCornerCache = result ? 1 : 0;
  return result;
}

function computeDarkCorner(b) {
  const wb = pieceCode(BISHOP, WHITE), bb = pieceCode(BISHOP, BLACK);
  const whiteDark = ((b.bbLo[wb] & DARK_LO) | (b.bbHi[wb] & DARK_HI)) !== 0;
  const whiteAny = (b.bbLo[wb] | b.bbHi[wb]) !== 0;
  const blackLight = ((b.bbLo[bb] & LIGHT_LO) | (b.bbHi[bb] & LIGHT_HI)) !== 0;
  return whiteDark || (!whiteAny && blackLight);
}

/** Bishop distances (in moves through non-steady squares) from the mating corner. */
function computeBishopDistances(b, steadyLo, steadyHi) {
  const corner = darkCorner(b) ? [63, 62, 55] : [56, 57, 48];
  const distances = new Uint8Array(64).fill(255);
  let visitedLo = 0, visitedHi = 0, activeLo = 0, activeHi = 0;
  for (const s of corner) { activeLo |= bitLo(s); activeHi |= bitHi(s); }
  let d = 0;
  for (;;) {
    const activeSquares = [];
    for (let lo = activeLo, hi = activeHi; (lo | hi) !== 0;) {
      const s = lowestSquare(lo, hi);
      if (s < 32) lo ^= 1 << s; else hi ^= 1 << (s - 32);
      activeSquares.push(s);
    }
    for (const s of activeSquares) distances[s] = d;
    visitedLo |= activeLo; visitedHi |= activeHi;
    d++;
    let nextLo = 0, nextHi = 0;
    for (const s of activeSquares) { const [lo, hi] = bishopMoves(s, steadyLo, steadyHi); nextLo |= lo & ~steadyLo; nextHi |= hi & ~steadyHi; }
    activeLo = nextLo & ~visitedLo; activeHi = nextHi & ~visitedHi;
    if ((activeLo | activeHi) === 0) break;
  }
  return distances;
}

// ---------------------------------------------------------------------------
// Move classification heuristics.
// ---------------------------------------------------------------------------

/** Heuristic target square for the moved piece, or -1. */
function setTarget(b, movedPiece) {
  let target = -1;
  if (b.stm === WHITE) { if (movedPiece === KING) target = 54; else if (movedPiece === KNIGHT) target = 36; }   // G7, E5
  else { if (movedPiece === KING) target = 63; else if (movedPiece === KNIGHT) target = 62; }                   // H8, G8
  if (target >= 0 && !darkCorner(b)) target = flipSquareFile(target);
  return target;
}

function classifyWhiteMove(b, m, ds) {
  const movedPiece = B.typeOf(b.sq[moveSource(m)]);
  if (isPawnAdvance(b, m) || isCapture(b, m)) return REWARD;
  const target = setTarget(b, movedPiece);
  if (target >= 0 && movesTowardSquare(m, movedPiece, target) < 0) return REWARD;
  if (ds !== null && movedPiece === BISHOP) {
    const src = ds[moveSource(m)], dst = ds[moveDest(m)];
    if (src > 200) return NORMAL;
    if (src <= 1 && src < dst) return REWARD;
    if (src > 2 && src > dst) return REWARD;
  }
  return NORMAL;
}

function classifyBlackMove(b, m, ds) {
  const movedPiece = B.typeOf(b.sq[moveSource(m)]);
  if (ds !== null && b.numPieces() > 5 && isCapture(b, m) && (movedPiece === PAWN || B.typeOf(b.sq[moveDest(m)]) === PAWN)) return REWARD;
  if (ds !== null && movedPiece === BISHOP && ds[moveSource(m)] > ds[moveDest(m)]) return REWARD;
  const target = setTarget(b, movedPiece);
  if (target >= 0 && movesTowardSquare(m, movedPiece, target) < 0) return REWARD;
  if (isCapture(b, m) || isPawnAdvance(b, m)) return PUNISH;
  return NORMAL;
}

function classifyMove(b, m, punishable, ds) {
  if (punishable !== null && punishable.has(m)) return PUNISH;
  return b.stm === WHITE ? classifyWhiteMove(b, m, ds) : classifyBlackMove(b, m, ds);
}

// ---------------------------------------------------------------------------
// Search state and the recursive helpmate search.
// ---------------------------------------------------------------------------

class Search {
  constructor() {
    this.maxDepth = 0;
    this.depthNodeLimit = U64_MAX;
    this.globalNodeLimit = 1000000;
    this.iterationNodes = 0;
    this.globalNodes = 0;
    this.interrupted = false;
    this.moves = [];
    this.pastProgress = false;
    this.transpositionTable = null;   // PositionTable: position -> numMovesLeft
    this.punishable = null;           // Set<move>
    this.bishopDistances = null;      // Uint8Array(64)
  }
  resetIteration() { this.globalNodes += this.iterationNodes; this.iterationNodes = 0; this.interrupted = false; }
  resetGlobalNodes() { this.globalNodes = 0; }
  isLimitReached() {
    const depthLimit = this.depthNodeLimit !== U64_MAX && this.iterationNodes > this.maxDepth * this.depthNodeLimit;
    return depthLimit || this.globalNodes + this.iterationNodes > this.globalNodeLimit;
  }
}

/**
 * Legal moves of every open recursion level live in one shared buffer: a
 * level writes its moves from `sp` and hands the index after them to its
 * children. Recursions play moves in place (doMove/undoMove), so a search
 * node allocates nothing.
 */
const MOVE_STACK = new Int32Array(1 << 20);

/** Returns the move sequence leading to checkmate of Black, or null. Leaves `b` unchanged. */
function helpmate(b, search, depth, sp = 0) {
  const numMovesLeft = Math.max(0, search.maxDepth - depth);
  const tt = search.transpositionTable;
  if (tt !== null) {
    const entry = tt.get(b);
    if (entry !== -1 && entry >= numMovesLeft) return null;
  }
  const end = B.genLegal(b, MOVE_STACK, sp);
  if (end === sp) {
    if (b.stm === BLACK && b.nCheckers !== 0) return search.moves.slice();   // checkmate
    return null;                                                             // stalemate or White mated
  }
  if (insufficientWhiteMaterial(b)) return null;
  if (depth >= search.maxDepth || search.moves.length >= 128) { search.interrupted = true; return null; }
  if (tt !== null) tt.set(b, numMovesLeft);

  for (let i = sp; i < end; i++) {
    const m = MOVE_STACK[i];
    search.iterationNodes++;
    if (search.isLimitReached()) { search.interrupted = true; return null; }
    const variation = classifyMove(b, m, search.punishable, search.bishopDistances);
    const newDepth = variation === REWARD ? depth : variation === PUNISH ? depth + 4 : depth + (search.pastProgress ? 0 : 1);
    search.moves.push(m);
    const savedPastProgress = search.pastProgress;
    search.pastProgress = variation === REWARD;
    B.doMove(b, m);
    const found = helpmate(b, search, newDepth, end);
    B.undoMove(b, m);
    if (found !== null) return found;
    search.pastProgress = savedPastProgress;
    search.moves.pop();
  }
  return null;
}

/** Fast-forward through positions with exactly one legal move; repetition marks `interrupted`. */
function playForcedMoves(board, search) {
  let b = board;
  let seen = null;
  for (let i = 0; i < 16; i++) {
    const moves = legalMoves(b);
    if (moves.length !== 1) break;
    if (seen === null) seen = new Set([b.key()]);
    b = makeMove(b, moves[0]);
    search.moves.push(moves[0]);
    search.iterationNodes++;
    const k = b.key();
    if (seen.has(k)) { search.resetIteration(); search.interrupted = true; return b; }
    seen.add(k);
  }
  if (seen !== null) search.resetIteration();
  return b;
}

/** Iterative deepening over [fromDepth, toDepth]; {winnable, helpmate} | {unwinnable} | null. */
function iterativeDeepening(b, search, fromDepth, toDepth) {
  for (let depth = fromDepth; depth <= toDepth; depth++) {
    search.maxDepth = depth;
    search.resetIteration();
    const found = helpmate(b, search, 0);
    if (found !== null) return { winnable: true, helpmate: found };
    if (!search.interrupted) return { winnable: false };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Probes.
// ---------------------------------------------------------------------------

/** Record, per color, whether any non-pawn move shows up within `maxNodes` nodes. Leaves `b` unchanged. */
function probeNonPawnMoves(b, nonPawnSeen, counter, maxNodes, sp = 0) {
  const end = B.genLegal(b, MOVE_STACK, sp);
  for (let i = sp; i < end; i++) {
    const m = MOVE_STACK[i];
    if (B.typeOf(b.sq[moveSource(m)]) !== PAWN) nonPawnSeen[b.stm] = true;
    counter.nodes++;
    if (counter.nodes >= maxNodes || (nonPawnSeen[0] && nonPawnSeen[1])) return;
    B.doMove(b, m);
    probeNonPawnMoves(b, nonPawnSeen, counter, maxNodes, end);
    B.undoMove(b, m);
    if (counter.nodes >= maxNodes || (nonPawnSeen[0] && nonPawnSeen[1])) return;
  }
}

/** Follow check chains; non-check leaves must be statically unwinnable. */
function checkChainSearch(b, visited, depth) {
  if (depth > 16) return null;
  visited.add(b.key());
  const moves = legalMoves(b);
  if (moves.length === 0) {
    if (b.stm === BLACK && b.nCheckers !== 0) return { winnable: true, helpmate: [] };
    return { winnable: false };
  }
  for (let i = 0; i < moves.length; i++) {
    const next = makeMove(b, moves[i]);
    if (visited.has(next.key())) continue;
    if (next.nCheckers !== 0 || depth === 0) {
      const r = checkChainSearch(next, visited, depth + 1);
      if (r === null) return null;
      if (r.winnable) return r;
      continue;
    }
    if (!isStaticallyUnwinnable(next)) return null;
  }
  return { winnable: false };
}

module.exports = {
  Search, helpmate, playForcedMoves, iterativeDeepening, probeNonPawnMoves, checkChainSearch,
  onlyPawnsAndBishops, nbBlockedPawns, hasLonelyPawns, insufficientWhiteMaterial,
  computePunishable, computeBishopDistances, classifyMove, U64_MAX, MOVE_STACK,
};

};
defs['./winnability.js']=function(module,exports,require){
'use strict';
// ---------------------------------------------------------------------------
// Winnability analyses (chasolver src/winnability/{fast,full}.rs) and the
// public API (src/lib.rs). Both analyses are written for White as the
// intended winner; Black queries mirror the board first.
// ---------------------------------------------------------------------------

const B = require('./board.js');
const { isStaticallyUnwinnable, Analysis } = require('./deduction.js');
const S = require('./search.js');
const { WHITE, BLACK, PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING, legalMoves, makeMove, moveSource } = B;

// ---------------------------------------------------------------------------
// fast.rs
// ---------------------------------------------------------------------------

/** Exhaustive search to `depth`; true only if every branch is proven unwinnable. Leaves `b` unchanged. */
function isDynamicallyUnwinnable(b, depth, pawnMoveSeen, moved, sp = 0) {
  if (S.insufficientWhiteMaterial(b)) return true;
  const end = B.genLegal(b, S.MOVE_STACK, sp);
  if (end === sp) return !(b.stm === BLACK && b.nCheckers !== 0);
  if (depth === 0) return false;
  for (let i = sp; i < end; i++) {
    const m = S.MOVE_STACK[i];
    const movedPiece = B.typeOf(b.sq[moveSource(m)]);
    if (movedPiece === KING) moved.king[b.stm] = true;
    else if (movedPiece === PAWN) moved.twoPawnMovesInALine = moved.twoPawnMovesInALine || pawnMoveSeen;
    else if (movedPiece === BISHOP) moved.bishop = true;
    else moved.qrn = true;
    B.doMove(b, m);
    const proven = isDynamicallyUnwinnable(b, depth - 1, pawnMoveSeen || movedPiece === PAWN, moved, end);
    B.undoMove(b, m);
    if (!proven) return false;
  }
  return true;
}

/** Full reachability closure (capped at 3,000 positions): unwinnable iff no Black checkmate is reachable. */
function exhaustivelyUnwinnable(board) {
  const seen = new Set([board.key()]);
  let table = [board];
  while (table.length > 0) {
    const nextTable = [];
    for (const b of table) {
      if (S.insufficientWhiteMaterial(b)) continue;
      const moves = legalMoves(b);
      if (moves.length === 0) {
        if (b.stm === BLACK && b.nCheckers !== 0) return false;
        continue;
      }
      for (let i = 0; i < moves.length; i++) {
        const next = makeMove(b, moves[i]);
        const k = next.key();
        if (!seen.has(k)) {
          seen.add(k);
          if (seen.size > 3000) return false;
          nextTable.push(next);
        }
      }
    }
    table = nextTable;
  }
  return true;
}

/** fast::is_unwinnable (White as intended winner). */
function fastIsUnwinnable(board) {
  const search = new S.Search();
  const b = S.playForcedMoves(board, search);
  if (search.interrupted) return true;

  const moves = legalMoves(b);
  if (moves.length === 0) return !(b.stm === BLACK && b.nCheckers !== 0);

  const onlyPB = S.onlyPawnsAndBishops(b);
  const nbPawns = b.numType(PAWN);
  const initialDepth = onlyPB ? 7 : 4;

  const moved = { king: [false, false], bishop: false, qrn: false, twoPawnMovesInALine: false };
  if (isDynamicallyUnwinnable(b, initialDepth, false, moved)) return true;

  // No QRN moved, and enough mutually blocked pawn pairs relative to the pawn count.
  const lowEntropyCandidate = !moved.qrn && S.nbBlockedPawns(b) >= Math.max(1, Math.trunc(nbPawns / 2) - 2);

  if (onlyPB && lowEntropyCandidate && !(moved.king[0] && moved.king[1]) && moves.length <= 8 &&
      isDynamicallyUnwinnable(b, 15, false, moved)) {
    return true;
  }

  const blockedCandidate = lowEntropyCandidate && !S.hasLonelyPawns(b);
  if (blockedCandidate && isStaticallyUnwinnable(b)) return true;

  if (b.nCheckers !== 0 && blockedCandidate && nbPawns >= 6 && onlyPB) {
    const r = S.checkChainSearch(b, new Set(), 0);
    if (r !== null && !r.winnable) return true;
  }

  if (blockedCandidate && onlyPB && nbPawns >= 10 && b.numType(BISHOP) === 0 && !moved.twoPawnMovesInALine) {
    return exhaustivelyUnwinnable(b);
  }
  return false;
}

// One transposition table reused by every search (Rust builds a new empty map
// each time; clearing ours keeps the grown capacity and skips the rehashing).
let transpositionTable = null;
function sharedTranspositionTable() {
  if (transpositionTable === null) transpositionTable = new B.PositionTable(1 << 14);
  else transpositionTable.clear();
  return transpositionTable;
}

// ---------------------------------------------------------------------------
// full.rs
// ---------------------------------------------------------------------------

/** full::analysis (White as intended winner): {winnable, helpmate} | {winnable:false} | null. */
function fullAnalysis(board) {
  const search = new S.Search();
  let pos = S.playForcedMoves(board, search);

  // Phase 1: forced moves; a repetition means unwinnable.
  if (search.interrupted) return { winnable: false };

  // Phase 2: depth-1 search with heuristic extensions.
  search.depthNodeLimit = 1000;
  search.transpositionTable = null;
  search.resetGlobalNodes();
  let result = S.iterativeDeepening(pos, search, 1, 1);
  if (result !== null) return result;

  // Phase 3: early static analysis, unless queens, rooks or knights are present.
  const hasQRN = pos.numType(QUEEN) + pos.numType(ROOK) + pos.numType(KNIGHT) > 0;
  if (!hasQRN && isStaticallyUnwinnable(pos)) return { winnable: false };

  // Phase 4: iterative deepening with a transposition table.
  search.depthNodeLimit = 7000;
  search.transpositionTable = sharedTranspositionTable();
  search.resetGlobalNodes();
  result = S.iterativeDeepening(pos, search, 2, 128);
  if (result !== null) return result;

  // Phase 5: static analysis for positions that skipped phase 3.
  if (hasQRN && isStaticallyUnwinnable(pos)) return { winnable: false };

  // Phase 6: exhaustive check when one side seems to move only pawns.
  const nonPawnSeen = [false, false];
  S.probeNonPawnMoves(pos, nonPawnSeen, { nodes: 0 }, 1000);
  if ((!nonPawnSeen[0] || !nonPawnSeen[1]) && exhaustivelyUnwinnable(pos)) return { winnable: false };

  // Phase 7: follow all check chains; evaluate non-check leaves statically.
  result = S.checkChainSearch(pos, new Set(), 0);
  if (result !== null) return result;

  // Phase 8: guided deep search using bishop distances and punishable moves.
  const analysis = new Analysis(pos);
  analysis.saturate();
  search.bishopDistances = S.computeBishopDistances(pos, analysis.steadyLo, analysis.steadyHi);
  search.punishable = S.computePunishable(pos);
  search.depthNodeLimit = S.U64_MAX;
  search.globalNodeLimit = 1 << 24;
  search.transpositionTable = sharedTranspositionTable();
  search.resetGlobalNodes();
  return S.iterativeDeepening(pos, search, 2, 128);
}

// ---------------------------------------------------------------------------
// Public API (lib.rs).
// ---------------------------------------------------------------------------

/**
 * Full helpmate analysis for `intendedWinner` (B.WHITE / B.BLACK).
 * Returns {result: 'winnable', helpmate: [uci...]}, {result: 'unwinnable'} or {result: 'undetermined'}.
 */
function winnability(board, intendedWinner) {
  const target = intendedWinner === WHITE ? board : B.mirrorBoard(board);
  const r = fullAnalysis(target);
  if (r === null) return { result: 'undetermined' };
  if (!r.winnable) return { result: 'unwinnable' };
  const line = intendedWinner === WHITE ? r.helpmate : r.helpmate.map(B.mirrorMove);
  return { result: 'winnable', helpmate: line.map(B.moveToUci) };
}

/** Fast, sound but incomplete: true only if provably unwinnable for `intendedWinner`. */
function isUnwinnableFast(board, intendedWinner) {
  return fastIsUnwinnable(intendedWinner === WHITE ? board : B.mirrorBoard(board));
}

module.exports = { winnability, isUnwinnableFast, fullAnalysis, fastIsUnwinnable, exhaustivelyUnwinnable };

};
return{B:req('./board.js'),W:req('./winnability.js')}})();
