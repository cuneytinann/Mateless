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

import { BISHOP, BLACK, DARK_SQUARES, inCheck, isAttacked, KING, KNIGHT, lowestBit, NO_SQUARE, PAWN, popcount, QUEEN, readFen,
         ROOK, toFen, WHITE } from './board.js';

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
export function fromFen(fen, { strict = true } = {}) {
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
