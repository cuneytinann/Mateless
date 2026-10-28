'use strict';
/* The lock detector's proof obligation, checked position by position.
   A lock certificate is the fixed point of one level: pawn cones, fixed pawns, king and bishop
   reaches, frozen king. The reasoning behind it is an inductive invariant: in EVERY
   position reachable from the root by legal moves (both sides cooperating)
     I1  every white pawn stands in wCone, every black pawn in bCone
     I2  every pawn of wFixed / bFixed still stands on its root square
     I3  each king stands in its reach; a frozen king on its root square
     I4  every bishop stands in its side's bishop reach
     I5  no knight, rook or queen appears or moves (boxed pieces stand still); the boxed ones
         (lockSets: boxed, the pieces no enemy king or bishop reaches) are never taken
     I6  no piece count has grown (no promotion)
     I7  the flagged king is not checkmated
   I7 is what the arbiter needs; I1–I6 are what the reasoning says. A hole in the reasoning shows
   up as a violated invariant, even when it never leads to a false draw. The reachable positions
   are enumerated completely (move clocks ignored) by an iterative depth-first search, up to CAP
   positions per root; a root whose positions are all enumerated is proven a lock outright.
   The certificate's sets come from the engine itself (_internal.lockSets), so no engine carries
   test code. Any build may be checked (ENGINE=...).
   Usage: node lock_invariant.js <file> [every] [cap]
     <file>: lines "<fen>\t<w|b>", the second field the side that cannot mate; or chasolver's
     format ("WB <fen>"), then both sides are tried. Env ENGINE (default ../mateless.js), OFFSET. */
const fs = require('fs'), path = require('path');
const E = require(process.env.ENGINE ? path.resolve(process.env.ENGINE) : path.join(__dirname, '..', 'mateless.js'));
const I = E._internal, { WHITE, BLACK, PAWN, KING, QUEEN, KNIGHT, ROOK, BISHOP } = E;
const [file, everyArg, capArg] = process.argv.slice(2);
const EVERY = +(everyArg || 1), CAP = +(capArg || 200000);
const rows = [];
for (const l of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
  if (/^(WB|W-|-B|--) /.test(l)) { rows.push([l.slice(3).trim(), 'w'], [l.slice(3).trim(), 'b']); continue; }
  const [fen, w] = l.split('\t'); if (fen && (w === 'w' || w === 'b')) rows.push([fen, w]);
}

const sub = (aL, aH, sL, sH) => ((aL & ~sL) | (aH & ~sH)) === 0;        // a ⊆ s
const PROMO = [QUEEN, ROOK, BISHOP, KNIGHT];
const key = new Int32Array(I.KEY_WORDS);
const keyStr = pos => { I.writeKey(pos, key, 0); return key.join(','); };

function counts(pos) { const c = []; for (const col of [WHITE, BLACK]) for (const t of [PAWN, KNIGHT, BISHOP, ROOK, QUEEN]) {
  let n = 0, w = pos.lo[col | t]; while (w) { w &= w - 1; n++; } w = pos.hi[col | t]; while (w) { w &= w - 1; n++; } c.push(n); } return c; }

// A certificate of the open-pair rule holds several families (lockSets: { families }): every
// reachable position must satisfy the invariant of at least one of them.
function violation(pos, S, root) {
  if (!S.families) return violation1(pos, S, root);
  let first = null;
  for (const F of S.families) { const v = violation1(pos, F, root); if (!v) return null; first = first || `${v} (in every family; first: ${F.pairs})`; }
  return first;
}
function violation1(pos, S, root) {
  const lo = pos.lo, hi = pos.hi;
  if (!sub(lo[WHITE | PAWN], hi[WHITE | PAWN], S.wCone[0], S.wCone[1])) return 'I1 white pawn outside its cone';
  if (!sub(lo[BLACK | PAWN], hi[BLACK | PAWN], S.bCone[0], S.bCone[1])) return 'I1 black pawn outside its cone';
  if (!sub(S.wFixed[0], S.wFixed[1], lo[WHITE | PAWN], hi[WHITE | PAWN])) return 'I2 a fixed white pawn moved or fell';
  if (!sub(S.bFixed[0], S.bFixed[1], lo[BLACK | PAWN], hi[BLACK | PAWN])) return 'I2 a fixed black pawn moved or fell';
  if (!sub(lo[WHITE | KING], hi[WHITE | KING], S.wKing[0], S.wKing[1])) return 'I3 white king outside its reach';
  if (!sub(lo[BLACK | KING], hi[BLACK | KING], S.bKing[0], S.bKing[1])) return 'I3 black king outside its reach';
  if ((S.frozen[0] | S.frozen[1]) && !sub(S.frozen[0], S.frozen[1], lo[WHITE | KING] | lo[BLACK | KING], hi[WHITE | KING] | hi[BLACK | KING])) return 'I3 the frozen king moved';
  if (!sub(lo[WHITE | BISHOP], hi[WHITE | BISHOP], S.wBish[0], S.wBish[1])) return 'I4 white bishop outside its reach';
  if (!sub(lo[BLACK | BISHOP], hi[BLACK | BISHOP], S.bBish[0], S.bBish[1])) return 'I4 black bishop outside its reach';
  for (const t of [KNIGHT, ROOK, QUEEN]) for (const col of [WHITE, BLACK])
    if (!sub(lo[col | t], hi[col | t], root.lo[col | t], root.hi[col | t])) return 'I5 a knight, rook or queen appeared or moved';
  if (S.boxed) {
    const xL = lo[WHITE | KNIGHT] | lo[WHITE | ROOK] | lo[WHITE | QUEEN] | lo[BLACK | KNIGHT] | lo[BLACK | ROOK] | lo[BLACK | QUEEN];
    const xH = hi[WHITE | KNIGHT] | hi[WHITE | ROOK] | hi[WHITE | QUEEN] | hi[BLACK | KNIGHT] | hi[BLACK | ROOK] | hi[BLACK | QUEEN];
    if (!sub(S.boxed[0], S.boxed[1], xL, xH)) return 'I5 a boxed piece fell';
  }
  const c = counts(pos); for (let i = 0; i < c.length; i++) if (c[i] > root.counts[i]) return 'I6 a piece count grew';
  return null;
}

const MOVES = new Int32Array(1 << 24);
function explore(rootPos, S, flagged) {
  const pos = rootPos.clone();
  const root = { lo: Int32Array.from(pos.lo), hi: Int32Array.from(pos.hi), counts: counts(pos) };
  const seen = new Set([keyStr(pos)]);
  // frames: [base, count, index, promo]
  const fb = [], fc = [], fi = [], fp = [];
  const push = () => {
    const base = fb.length ? fb[fb.length - 1] + fc[fc.length - 1] : 0;
    if (base + 256 > MOVES.length) throw new Error('move stack overflow');
    const n = I.generateLegalMoves(pos, MOVES, base);
    if (n === 0 && pos.side === flagged && E.inCheck(pos)) return 'I7 the flagged king is checkmated';
    fb.push(base); fc.push(n); fi.push(0); fp.push(0);
    return null;
  };
  let v = violation(pos, S, root) || push(); if (v) return { v, states: 1, closed: true };
  while (fb.length) {
    const d = fb.length - 1;
    if (fi[d] >= fc[d]) { fb.pop(); fc.pop(); fi.pop(); fp.pop(); if (fb.length) I.undoMove(pos); continue; }
    const m = MOVES[fb[d] + fi[d]], promo = (m >> 12) & I.FLAG_PROMO;
    I.doMove(pos, m, PROMO[fp[d]]);
    if (promo && ++fp[d] < 4) {} else { fp[d] = 0; fi[d]++; }
    const k = keyStr(pos);
    if (seen.has(k)) { I.undoMove(pos); continue; }
    seen.add(k);
    if (seen.size > CAP) return { v: null, states: seen.size, closed: false };
    v = violation(pos, S, root) || push();
    if (v) return { v, states: seen.size, closed: true, fen: E.toFen(pos) };
  }
  return { v: null, states: seen.size, closed: true };
}

let done = 0, closed = 0, states = 0, bad = []; const t0 = Date.now();
for (let i = +(process.env.OFFSET || 0); i < rows.length; i += EVERY) {
  const [fen, w] = rows[i]; const s = E.fromFen(fen); if (s.error) continue;
  const flagged = w === 'w' ? BLACK : WHITE;
  const S = I.lockSets(s.position, flagged); if (!S) continue;      // only lock certificates
  const r = explore(s.position, S, flagged);
  done++; states += r.states; if (r.closed) closed++;
  if (r.v) bad.push([r.v, fen, w, r.fen]);
}
console.log(`certificates checked ${done}, reachable sets enumerated completely ${closed}, positions visited ${states}, violations ${bad.length}, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
bad.slice(0, 20).forEach(b => console.log('  ', b.join(' | ')));
