'use strict';
const LOOSE = { strict: false };   // chasolver's positions include composed ones: read without the reachability checks
/* Writes lock/positions.tsv: the positions every version of the simple lock detector (lock/) is
   tested on, each labelled for both sides by mateless.js's first-version lock detector
   (_internal.coreLockTest: the rules of lock/, without the second version's open pairs and boxed pieces);
   and lock/second/positions.tsv, those of the second version (lock/second/), labelled by the second
   version's detector (lockCannotMate), with more positions where its rules decide (see the end).
     node tools/lock-positions.js            writes both files (the same files every time)
     node tools/lock-positions.js --check    says whether they are up to date
   The positions:
     - the lock tab's examples, and a few positions of a rare kind (LATE_CAPTURES below);
     - an even sample of data/locked_positions.tsv (locks from Lichess games) and their mirror
       images (colours and ranks swapped);
     - near misses: those locks changed in one or two ways (a pawn pushed, pulled, moved sideways,
       added, doubled or taken away; a king moved; a bishop added, taken away or doubled on one colour; a
       knight, rook or queen added; an en passant right made; the side to move swapped), which
       open some structures and not others;
     - closed structures (rams along a chain on most files, the kings on their own sides, a few
       bishops; half of them diagonal chains, whose pawns stand on one colour, with a bishop of
       that colour), where frozen kings and the mating net decide, and near misses of them;
     - random positions of kings, pawns and bishops.
   Every FEN is written as mateless.js writes it, so the en passant square appears only when a
   legal capture onto it exists. Positions where the side not to move is in check are left out. */
const fs = require('fs'), path = require('path');
const E = require('../mateless.js'), I = E._internal;
const ROOT = path.join(__dirname, '..');

let rng = 20261028;
const rand = () => { rng ^= rng << 13; rng ^= rng >>> 17; rng ^= rng << 5; return (rng >>> 0) / 4294967296; };
const ri = n => Math.floor(rand() * n);
const pick = a => a[ri(a.length)];

// A board as 64 characters, a1 first; '.' is empty.
function parse(fen) {
  const f = fen.split(' '), a = Array(64).fill('.');
  let sq = 56;
  for (const c of f[0]) {
    if (c === '/') sq -= 16;
    else if (/\d/.test(c)) sq += +c;
    else a[sq++] = c;
  }
  return { a, side: f[1] || 'w', ep: '-' };
}
function write({ a, side, ep }) {
  const rows = [];
  for (let r = 7; r >= 0; r--) {
    let s = '', e = 0;
    for (let f = 0; f < 8; f++) { const c = a[r * 8 + f]; if (c === '.') e++; else { if (e) s += e; e = 0; s += c; } }
    rows.push(s + (e ? e : ''));
  }
  return rows.join('/') + ' ' + side + ' - ' + ep + ' 0 1';
}
const swapCase = c => c === '.' ? c : c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase();
function mirror(p) {
  const a = Array(64).fill('.');
  for (let sq = 0; sq < 64; sq++) a[sq ^ 56] = swapCase(p.a[sq]);
  return { a, side: p.side === 'w' ? 'b' : 'w', ep: '-' };
}
const empties = a => a.map((c, i) => c === '.' ? i : -1).filter(i => i >= 0);
const squaresOf = (a, re) => a.map((c, i) => re.test(c) ? i : -1).filter(i => i >= 0);
const dark = sq => ((sq >> 3) + (sq & 7)) % 2 === 0;

// The position as the engine reads and writes it, or null if it is not one it accepts.
function normal(p) {
  const fen = write(p);
  if (p.a.filter(c => c === 'K').length !== 1 || p.a.filter(c => c === 'k').length !== 1) return null;
  if (p.a.some((c, i) => (c === 'P' || c === 'p') && (i < 8 || i > 55))) return null;
  const r = E.fromFen(fen, LOOSE);   // refuses a position whose side not to move is in check, among others
  if (r.error || r.fixed.length) return null;   // an en passant square a later mutation spoiled: not put right, left out
  return E.toFen(r.position);
}

const MUTATIONS = [
  function push(p) { const s = pick(squaresOf(p.a, /[Pp]/)), t = p.a[s] === 'P' ? s + 8 : s - 8;
    if (s === undefined || t < 8 || t > 55 || p.a[t] !== '.') return false; p.a[t] = p.a[s]; p.a[s] = '.'; return true; },
  function pull(p) { const s = pick(squaresOf(p.a, /[Pp]/)), t = p.a[s] === 'P' ? s - 8 : s + 8;
    if (s === undefined || t < 8 || t > 55 || p.a[t] !== '.') return false; p.a[t] = p.a[s]; p.a[s] = '.'; return true; },
  function sideStep(p) { const s = pick(squaresOf(p.a, /[Pp]/)); if (s === undefined) return false;
    const t = s + (rand() < 0.5 ? -1 : 1); if ((t >> 3) !== (s >> 3) || p.a[t] !== '.') return false; p.a[t] = p.a[s]; p.a[s] = '.'; return true; },
  function addPawn(p) { const e = empties(p.a).filter(i => i >= 8 && i < 56); if (!e.length) return false; p.a[pick(e)] = rand() < 0.5 ? 'P' : 'p'; return true; },
  function doubleBehind(p) { const s = pick(squaresOf(p.a, /[Pp]/)); if (s === undefined) return false;
    const t = p.a[s] === 'P' ? s - 16 : s + 16; if (t < 8 || t > 55 || p.a[t] !== '.') return false; p.a[t] = p.a[s]; return true; },
  function dropPawn(p) { const s = pick(squaresOf(p.a, /[Pp]/)); if (s === undefined) return false; p.a[s] = '.'; return true; },
  function moveKing(p) { const s = pick(squaresOf(p.a, /[Kk]/)); const e = empties(p.a);
    const t = rand() < 0.6 ? s + pick([-9, -8, -7, -1, 1, 7, 8, 9]) : pick(e);
    if (t < 0 || t > 63 || p.a[t] !== '.' || Math.abs((t & 7) - (s & 7)) > 1 && Math.abs(t - s) < 10) return false;
    p.a[t] = p.a[s]; p.a[s] = '.'; return true; },
  function addBishop(p) { const e = empties(p.a), c = rand() < 0.5 ? 'B' : 'b', own = squaresOf(p.a, c === 'B' ? /B/ : /b/);
    const ok = e.filter(i => !own.some(o => dark(o) === dark(i))); if (!ok.length) return false; p.a[pick(ok)] = c; return true; },
  function dropBishop(p) { const s = pick(squaresOf(p.a, /[Bb]/)); if (s === undefined) return false; p.a[s] = '.'; return true; },
  function twinBishop(p) { const s = pick(squaresOf(p.a, /[Bb]/)); if (s === undefined) return false;
    const e = empties(p.a).filter(i => dark(i) === dark(s)); if (!e.length) return false; p.a[pick(e)] = p.a[s]; return true; },
  function addPiece(p) { const e = empties(p.a); p.a[pick(e)] = pick('NRQnrq'); return true; },
  function swapSide(p) { p.side = p.side === 'w' ? 'b' : 'w'; return true; },
  function enPassant(p) {
    // A pawn that has just made a double step, beside an enemy pawn that may take it.
    const white = rand() < 0.5, us = white ? 'P' : 'p', them = white ? 'p' : 'P';
    const ranks = white ? [24, 32] : [32, 40];                       // White's pawn on rank 4, Black's on rank 5
    const cands = squaresOf(p.a, white ? /P/ : /p/).filter(s => s >= ranks[0] && s < ranks[1]);
    const s = pick(cands); if (s === undefined) return false;
    const over = white ? s - 8 : s + 8, from = white ? s - 16 : s + 16;
    if (p.a[over] !== '.' || p.a[from] !== '.') return false;
    const sides = [s - 1, s + 1].filter(t => (t >> 3) === (s >> 3));
    if (!sides.some(t => p.a[t] === them)) { const t = pick(sides); if (p.a[t] !== '.') return false; p.a[t] = them; }
    p.side = white ? 'b' : 'w'; p.ep = 'abcdefgh'[over & 7] + ((over >> 3) + 1); void us; return true; },
];

// A closed structure: rams along a chain (each file's ram one rank above or below the last; now and
// then beside it, which a pawn can capture), the kings on their own sides, in pockets that pawns
// hold all round (the frozen kings) or anywhere, and a few bishops. In half of them the chain is
// diagonal, so each side's pawns stand on one colour, and the first bishop of a side is of its
// pawns' colour: it never meets the enemy's pawns, and the mating net decides.
function closedPosition(diagonalChain) {
  const a = Array(64).fill('.');
  let r = 1 + ri(5);
  for (let f = 0; f < 8; f++) {
    const step = diagonalChain || rand() < 0.9 ? (rand() < 0.5 ? -1 : 1) : 0;
    r = r + step < 1 || r + step > 5 ? r - step : r + step;
    const u = rand();
    if (u < (diagonalChain ? 0.96 : 0.9)) {
      a[r * 8 + f] = 'P'; a[(r + 1) * 8 + f] = 'p';
      if (!diagonalChain && rand() < 0.05 && r > 1) a[(r - 1) * 8 + f] = 'P';
      if (!diagonalChain && rand() < 0.05 && r < 5) a[(r + 2) * 8 + f] = 'p';
    } else if (u < (diagonalChain ? 0.98 : 0.95)) a[(1 + ri(6)) * 8 + f] = rand() < 0.5 ? 'P' : 'p';
  }
  const held = new Set();
  for (const s of squaresOf(a, /[Pp]/)) {
    held.add(s);
    const t = a[s] === 'P' ? s + 8 : s - 8;
    if ((s & 7) > 0) held.add(t - 1);
    if ((s & 7) < 7) held.add(t + 1);
  }
  const around = sq => [-9, -8, -7, -1, 1, 7, 8, 9].map(d => sq + d).filter(t => t >= 0 && t < 64 && Math.abs((t & 7) - (sq & 7)) <= 1);
  const pocket = sq => around(sq).every(t => held.has(t));
  const below = sq => { const w = squaresOf(a, /P/).filter(s => (s & 7) === (sq & 7)); return w.length > 0 && sq < Math.min(...w); };
  const above = sq => { const b = squaresOf(a, /p/).filter(s => (s & 7) === (sq & 7)); return b.length > 0 && sq > Math.max(...b); };
  for (const [king, side] of [['K', below], ['k', above]]) {
    const e = empties(a), u = rand();
    const pockets = e.filter(pocket), own = e.filter(side);
    const choice = u < 0.25 && pockets.length ? pockets : u < 0.8 && own.length ? own : e;
    a[pick(choice)] = king;
  }
  for (const c of 'Bb') {
    const pawns = squaresOf(a, c === 'B' ? /P/ : /p/), bad = pawns.length > 0 && dark(pawns[0]);
    const n = diagonalChain ? (rand() < 0.75 ? 1 : ri(3)) : ri(3), placed = [];
    for (let i = 0; i < n; i++) {
      const ok = empties(a).filter(s => !placed.some(o => dark(o) === dark(s)) && (!diagonalChain || i > 0 || dark(s) === bad));
      if (!ok.length) break;
      const s = pick(ok); a[s] = c; placed.push(s);
    }
  }
  return { a, side: rand() < 0.5 ? 'w' : 'b', ep: '-' };
}

function randomPosition() {
  const a = Array(64).fill('.');
  const put = (c, lo = 0, hi = 64) => { const e = empties(a).filter(i => i >= lo && i < hi); if (e.length) a[pick(e)] = c; };
  put('K'); put('k');
  const n = 2 + ri(12);
  for (let i = 0; i < n; i++) put(rand() < 0.5 ? 'P' : 'p', 8, 56);
  if (rand() < 0.4) put('B'); if (rand() < 0.4) put('b');
  return { a, side: rand() < 0.5 ? 'w' : 'b', ep: '-' };
}

const out = new Map();   // fen -> label; a position once
function add(fen) {
  if (!fen || out.has(fen)) return;
  const pos = E.fromFen(fen, LOOSE).position;
  out.set(fen, (I.coreLockTest(pos, E.WHITE) ? '1' : '0') + '\t' + (I.coreLockTest(pos, E.BLACK) ? '1' : '0'));
}

/* Positions where a pawn can capture only once the cycle has run (a pawn a king can take is no
   wall, so the enemy's cone passes it): a rare way to leak, found by changing every Lichess lock
   up to four times (185,919 positions, 31 of this kind). */
const LATE_CAPTURES = [
  '1k6/1p2p3/1P4p1/1Pp1PpP1/2P1pP2/4P3/K7/8 b - - 0 1',
  '1k6/2bp4/8/1p1Pp2p/1P1pP2P/3P4/1K6/8 w - - 0 1',
  '2k5/8/2p1p3/p1PpP1p1/P2Pp1P1/2K5/4P3/8 w - - 0 1',
  '2k5/8/4p3/1p1pP1p1/1p1Pp1P1/1P5K/4P3/8 w - - 0 1',
  '3b4/4k3/1p1p4/pP1Pp1p1/P2pPpP1/1K3P2/3P4/3B4 w - - 0 1',
  '3k4/4p3/8/p2pP3/P2Pp1p1/4P1P1/8/6K1 b - - 0 1',
  '3k4/8/2p1p2p/1pPpP2P/pP1Pp3/P7/4PK2/8 w - - 0 1',
  '3k4/8/2p1p3/p1P1Pp2/Pp2pPp1/1P2pBP1/4PK2/8 w - - 0 1',
  '5k2/4p3/8/p2pP1p1/P2Pp1Pp/4P2P/3K4/8 b - - 0 1',
  '5k2/8/3p1p1p/1p1PpP1P/1P1pP1K1/8/3P4/8 b - - 0 1',
  '7k/8/1p2p3/1P1pP1p1/3Pp1P1/8/4P3/4b1K1 b - - 0 1',
  '8/1k1b4/p1p1p3/P1P1PpBp/4pP1P/8/1K2P3/8 b - - 0 1',
  '8/2k1p3/p1p5/P1PpP1p1/3Pp1Pp/4P2P/6K1/8 b - - 0 1',
  '8/2k1pb2/p1pB4/P1PpP2p/3Pp1pP/K3P1P1/8/1B6 b - - 0 1',
  '8/2kp4/8/1p1Pp1p1/1P1pPpP1/3P1P2/8/5K2 w - - 0 1',
  '8/3k4/2p1p3/1pP1Pp1p/1P2pPpP/6P1/KP2P3/8 w - - 0 1',
  '8/3k4/3p2p1/p1pP1pP1/P1Pp1P2/1K6/3P4/3B4 w - - 0 1',
  '8/3p2k1/4b1p1/p2Pp1P1/Pp1pP3/1P1P1K2/8/8 w - - 0 1',
  '8/4k3/4p1p1/p2pP1Pp/P2Pp2P/8/2K1P3/8 b - - 0 1',
  '8/4p3/1k6/3pP3/1p1Pp2p/1P2P2P/8/K7 b - - 0 1',
  '8/4p3/2k5/3pP1p1/p1pPp1Pp/P1P1P2P/3K4/8 w - - 0 1',
  '8/4pk2/1p6/pP1pP1p1/P2Pp1Pp/4P2P/8/7K w - - 0 1',
  '8/4pk2/8/1p1pP3/1P1Pp1p1/1P2P1P1/8/5K2 w - - 0 1',
  '8/4pk2/8/3pP1B1/2pPp1p1/1pP1P1P1/1P3K2/8 b - - 0 1',
  '8/5k2/4p1p1/3pP1Pp/1p1Pp2P/1P5K/4P3/8 b - - 0 1',
  '8/6p1/2k1p1P1/1p1pP1P1/1PpPp1K1/2P3B1/4P3/8 w - - 0 1',
  '8/7k/1p1p4/pPpP1p2/P1Pp1Pp1/6P1/1K1P4/8 w - - 0 1',
  '8/8/2k3p1/p1p2pP1/P1P2Pp1/1K6/6P1/8 b - - 0 1',
  '8/p2k4/P1p1p3/2PpP1p1/3Pp1P1/2K3b1/4P3/8 w - - 0 1',
  '8/p2k4/Pp2p1p1/1P2PpPp/5PpP/8/6P1/5K2 b - - 0 1',
  'k7/3p4/p7/p1pP1p1p/P1Pp1P1P/3P1K2/8/8 b - - 0 1',
];

// The lock tab's examples.
for (const m of fs.readFileSync(path.join(ROOT, 'site/lock/lock.js'), 'utf8').matchAll(/fen: '([^']+)'/g)) add(normal(parse(m[1])));
for (const fen of LATE_CAPTURES) { add(normal(parse(fen))); add(normal(mirror(parse(fen)))); }
// A sample of the Lichess locks, and their mirror images.
const locks = fs.readFileSync(path.join(ROOT, 'data/locked_positions.tsv'), 'utf8').split('\n').filter(Boolean).map(l => l.split('\t')[0]);
const seeds = locks.filter((_, i) => i % 10 === 0);
seeds.forEach((fen, i) => { add(normal(parse(fen))); if (i % 2) add(normal(mirror(parse(fen)))); });
// Near misses: each seed changed once and twice.
for (const fen of seeds) for (const k of [1, 2]) {
  for (let tries = 0; tries < 20; tries++) {
    const p = rand() < 0.5 ? parse(fen) : mirror(parse(fen));
    let done = 0;
    for (let g = 0; g < 40 && done < k; g++) if (pick(MUTATIONS)(p)) done++;
    const n = done === k ? normal(p) : null;
    if (n && !out.has(n)) { add(n); break; }
  }
}
// Closed structures, and near misses of them.
for (let i = 0; i < 16000; i++) {
  const p = closedPosition(i % 2 === 1); if (!p) continue;
  const fen = normal(p); if (!fen || out.has(fen)) continue;
  add(fen);
  if (rand() < 0.5) { const q = parse(fen); q.side = p.side; if (pick(MUTATIONS)(q)) add(normal(q)); }
}
// Random positions.
for (let i = 0; i < 4000; i++) add(normal(randomPosition()));

/* The second version's positions: every position above, relabelled, and positions where its rules
   decide: the rows of data/second_version.tsv and the rule examples of test/second_version_check.js
   (each with its mirror image), and the Lichess locks changed so that a rule has a chance: a ram
   pulled apart into an open pair, a knight, rook or queen boxed in by its own pawns, the king of the
   side to move stepped into a pawn's check, both kings moved anywhere (stalemate guards and stuck
   maters come from those); for each lock and change, one position the rule proves and one it does
   not, when they come within a few tries. Last (with a seed of its own, so the lines above stay as
   they were), the walls of a boxed piece that are not pawns: WALL_CASES and a piece boxed in partly
   by a still bishop of its colour or by its own king (wallPiece). */
const SECOND_CASES = [
  '8/4k1p1/1p2p1Pp/1p1pPp2/1P1P1P1P/4K3/8/8 w - - 0 33', '8/4k1p1/1p2p1PP/1p1pPp2/1P1P1P2/4K3/8/8 b - - 0 33',
  '1n6/2Bp4/p1pPp1k1/PpP1Pp1p/1P3P1P/2K5/8/8 w - - 7 53', '1n6/2Bp4/p2Pp1k1/PpP1Pp1p/1P3P1P/2K5/8/8 w - - 7 53',
  '4k3/8/8/1p3p1p/1P1p1P1P/3PpP1P/1K2P2P/6NR b - - 0 1', '4k3/8/8/1p3p1p/1P1p1P1P/3PpP1P/1K2P2P/7R b - - 0 1',
  '8/8/7p/5p1P/5p1K/5Pp1/6P1/1k6 w - - 70 83', '8/8/8/5p1P/5p1K/5Pp1/6P1/1k6 w - - 70 83',
  '8/8/5k2/p2p2p1/P2P1KP1/8/8/8 w - - 0 51', '8/8/5k2/p2p4/P2P1K2/8/8/8 w - - 0 51',
  '8/7p/5p1P/5kpK/6P1/8/8/8 b - - 0 48', '8/7p/5p1P/5kpK/6P1/8/P7/8 b - - 0 48',
  '8/8/8/8/8/6p1/4k1Pp/6K1 w - - 0 64', '8/8/8/8/8/6p1/k5Pp/6K1 w - - 0 64',
  'k3b1b1/Pp1b1b1p/1Pb1p1pP/1p1pP1P1/1P1P4/8/8/4K3 w - - 0 1', '5k2/2b4B/1p3b2/pPp1p1p1/P1P1P1P1/7K/8/8 w - - 0 1',
];
// The squares a knight, rook or queen on sq steps to.
function stepSquares(kind, sq) {
  const f = sq & 7, r = sq >> 3, out = [];
  const d = kind === 'N' ? [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]]
          : kind === 'R' ? [[1, 0], [-1, 0], [0, 1], [0, -1]]
          : [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  for (const [df, dr] of d) if (f + df >= 0 && f + df < 8 && r + dr >= 0 && r + dr < 8) out.push(8 * (r + dr) + f + df);
  return out;
}
const SECOND_MUTATIONS = [
  function openPair(p) {    // a ram pulled apart: one empty square between its two pawns
    const s = pick(squaresOf(p.a, /P/).filter(s => s < 56 && p.a[s + 8] === 'p')); if (s === undefined) return false;
    if (rand() < 0.5) { if (s - 8 < 8 || p.a[s - 8] !== '.') return false; p.a[s - 8] = 'P'; p.a[s] = '.'; }
    else { if (s + 16 > 55 || p.a[s + 16] !== '.') return false; p.a[s + 16] = 'p'; p.a[s + 8] = '.'; }
    return true; },
  function boxPiece(p) {    // a knight, rook or queen with its own pawns on all its step squares
    const white = rand() < 0.5, kind = pick(['N', 'N', 'R', 'Q']), own = white ? 'P' : 'p', sq = pick(empties(p.a));
    const st = stepSquares(kind, sq);
    if (st.some(t => t < 8 || t > 55 || (p.a[t] !== '.' && p.a[t] !== own)) || st.filter(t => p.a[t] === '.').length > 4) return false;
    for (const t of st) p.a[t] = own;
    p.a[sq] = white ? kind : kind.toLowerCase(); return true; },
  function checkKing(p) {   // the king of the side to move steps into a pawn's check
    const white = p.side === 'w', k = p.a.indexOf(white ? 'K' : 'k'), to = [];
    for (const s of squaresOf(p.a, white ? /p/ : /P/)) {
      const t = white ? s - 8 : s + 8;
      for (const u of [t - 1, t + 1]) if (u >= 0 && u < 64 && (u >> 3) === (t >> 3) && p.a[u] === '.') to.push(u);
    }
    const t = pick(to); if (t === undefined) return false;
    p.a[k] = '.'; p.a[t] = white ? 'K' : 'k'; return true; },
  function moveKings(p) {   // both kings anywhere, either side to move
    for (const c of 'Kk') { p.a[p.a.indexOf(c)] = '.'; p.a[pick(empties(p.a))] = c; }
    p.side = rand() < 0.5 ? 'w' : 'b'; return true; },
];
const second = new Map();
function add2(fen) {
  if (!fen || second.has(fen)) return;
  const pos = E.fromFen(fen, LOOSE).position;
  second.set(fen, (E.lockCannotMate(pos, E.WHITE) ? '1' : '0') + '\t' + (E.lockCannotMate(pos, E.BLACK) ? '1' : '0'));
}
for (const fen of out.keys()) add2(fen);
const secondRows = fs.readFileSync(path.join(ROOT, 'data/second_version.tsv'), 'utf8').split('\n').slice(1).filter(Boolean).map(l => l.split('\t')[4]);
for (const fen of [...secondRows, ...SECOND_CASES]) { add2(normal(parse(fen))); add2(normal(mirror(parse(fen)))); }
rng = 20261121;
// For each seed and each mutation: one position where the rule the mutation aims at proves a side
// (a hit, if one comes within 30 tries) and one where it does not (a near miss).
const HIT = {
  openPair: c => c.families, boxPiece: c => c.boxed, checkKing: c => c.forced || c.level, moveKings: c => c.stuck || c.level,
};
function secondKind(fen) {   // the certificate kinds of the second version's proofs that the first version lacks
  const pos = E.fromFen(fen, LOOSE).position, kind = {};
  for (const side of [E.WHITE, E.BLACK]) {
    if (!E.lockCannotMate(pos, side) || I.coreLockTest(pos, side)) continue;
    const c = I.lockSets(pos, side);
    if (c.boxed && ((c.still[0] | c.still[1]) || (c.frozen[0] | c.frozen[1]))) kind.wall = true;
    if (c.families) kind.families = true; else if (c.boxed) kind.boxed = true;
    else if (c.stuck) kind.stuck = true; else if (c.forced) kind.forced = true; else kind.level = true;
  }
  return kind;
}
for (const fen of seeds) for (const mutation of SECOND_MUTATIONS) {
  let hits = 0, misses = 0;
  const most = mutation.name === 'openPair' || mutation.name === 'boxPiece' ? 100 : 30;
  for (let tries = 0; tries < most && (!hits || !misses); tries++) {
    const p = rand() < 0.5 ? parse(fen) : mirror(parse(fen));
    if (rand() < 0.5) p.side = p.side === 'w' ? 'b' : 'w';
    if (!mutation(p)) continue;
    const n = normal(p);
    if (!n || second.has(n)) continue;
    if (HIT[mutation.name](secondKind(n))) { if (!hits++) add2(n); }
    else if (!misses++) add2(n);
  }
}

/* Walls of a boxed piece that are not pawns: a still bishop (every diagonal neighbour held for good)
   or its own frozen king. WALL_CASES: the rook of a screenshot boxed in by its pawn and a bishop, a
   king, rook and bishop holding one another, and what each is without the bishop or the king; a
   king between two rooks, where a castle leaves king and rook (g8 and f8, c8 and d8: the king holds
   nothing there) and where it does not (f8 and g8, d8 and c8). */
const WALL_CASES = [
  'rb2k3/p1p1p1p1/P1P1P1P1/8/8/1K6/8/8 w - - 0 1', 'r3k3/p1p1p1p1/P1P1P1P1/8/8/1K6/8/8 w - - 0 1',
  'krb5/1p1p1p1p/1P1P1P1P/8/8/8/8/4K3 w - - 0 1', 'kr6/1p1p1p1p/1P1P1P1P/8/8/8/8/4K3 w - - 0 1',
  'k1b5/1p1p1p1p/1P1P1P1P/8/8/8/8/4K3 w - - 0 1', 'krb5/1p1p1p1p/1P1P1P1P/8/8/8/8/2K5 b - - 0 1',
  '4brkr/1p1p1p1p/1P1P1P1P/8/8/8/8/K7 w - - 0 1', 'brkrb3/1p1p1p1p/1P1P1P1P/8/8/2K5/8/8 b - - 0 1',
  '3brkrb/p1p1p1p1/P1P1P1P1/8/8/2K5/8/8 w - - 0 1', '1brkrb2/p1p1p1p1/P1P1P1P1/8/8/2K5/8/8 b - - 0 1',
];
rng = 20261127;
for (const fen of WALL_CASES) { add2(normal(parse(fen))); add2(normal(mirror(parse(fen)))); }
// A castling right left keeps the king from being a wall: the same positions with one (written as
// mateless.js writes it, a file letter here), and a right that cannot stand (no rook there), dropped.
for (const fen of ['krb5/1p1p1p1p/1P1P1P1P/8/8/8/8/4K3 w k - 0 1', 'krb5/1p1p1p1p/1P1P1P1P/8/8/8/8/4K3 w K - 0 1',
                   '4k3/8/8/8/1p1p1p1p/1P1P1P1P/8/KRB5 b B - 0 1', '4k3/8/8/8/1p1p1p1p/1P1P1P1P/8/KRB5 b q - 0 1']) {
  const r = E.fromFen(fen, LOOSE); if (!r.error) add2(E.toFen(r.position));
}
// A knight, rook or queen whose step squares hold its own pawns, and one or two of them a bishop of its
// colour (with its own pawns on the bishop's diagonal neighbours) or its own king.
function wallPiece(p) {
  const white = rand() < 0.5, kind = pick(['N', 'R', 'R', 'Q']), own = white ? 'P' : 'p', sq = pick(empties(p.a));
  const st = stepSquares(kind, sq), bishop = white ? 'B' : 'b', king = white ? 'K' : 'k';
  const walls = st.filter(t => p.a[t] === '.' || p.a[t] === own);
  if (walls.length !== st.length || st.filter(t => p.a[t] === '.').length > 5) return false;
  const pawnOk = t => t >= 8 && t <= 55;
  const diagonal = t => [[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([df, dr]) => [(t & 7) + df, (t >> 3) + dr])
    .filter(([f, r]) => f >= 0 && f < 8 && r >= 0 && r < 8).map(([f, r]) => 8 * r + f);
  const free = st.filter(t => p.a[t] === '.');
  if (!free.length) return false;
  const special = pick(free);
  if (rand() < 0.6) {                          // a bishop there, its diagonal neighbours its own pawns
    for (const u of diagonal(special)) { if (u === sq) return false; if (p.a[u] === '.') { if (!pawnOk(u)) return false; p.a[u] = own; } else if (p.a[u] !== own) return false; }
    p.a[special] = bishop;
  } else {                                     // its own king there
    p.a[p.a.indexOf(king)] = '.'; p.a[special] = king;
  }
  for (const t of st) if (p.a[t] === '.') { if (!pawnOk(t)) return false; p.a[t] = own; }
  p.a[sq] = white ? kind : kind.toLowerCase(); return true;
}
for (const fen of seeds) {
  let hits = 0, misses = 0;
  for (let tries = 0; tries < 100 && (!hits || !misses); tries++) {
    const p = rand() < 0.5 ? parse(fen) : mirror(parse(fen));
    if (rand() < 0.5) p.side = p.side === 'w' ? 'b' : 'w';
    if (!wallPiece(p)) continue;
    const n = normal(p);
    if (!n || second.has(n)) continue;
    if (secondKind(n).wall) { if (!hits++) add2(n); }
    else if (!misses++) add2(n);
  }
}

function fileText(map, labelledBy) {
  const rows = [...map].map(([fen, label]) => fen + '\t' + label);
  const both = rows.filter(r => r.endsWith('1\t1')).length, white = rows.filter(r => /\t1\t0$/.test(r)).length,
        black = rows.filter(r => /\t0\t1$/.test(r)).length;
  const head = [
    '# The positions the lock detector is tested on, in every language: written by tools/lock-positions.js,',
    '# labelled by mateless.js' + labelledBy + '. One line per position: the FEN, then 1 if White can never be mated (the',
    '# lock detector proves it) or 0, then the same for Black.',
    '# ' + rows.length + ' positions: ' + both + ' locked for both sides, ' + white + ' for White only, ' + black + ' for Black only, ' +
      (rows.length - both - white - black) + ' for neither.',
  ];
  return { text: head.join('\n') + '\n' + rows.join('\n') + '\n', summary: head[3].slice(2) };
}
const files = [
  [path.join(ROOT, 'lock/positions.tsv'), fileText(out, ''), 'lock/positions.tsv'],
  [path.join(ROOT, 'lock/second/positions.tsv'), fileText(second, " (the second version's detector)"), 'lock/second/positions.tsv'],
];
let stale = false;
for (const [file, { text, summary }, name] of files) {
  if (process.argv.includes('--check')) {
    if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== text) { console.log(name + ' is out of date: run node tools/lock-positions.js'); stale = true; }
    else console.log(name + ' is up to date (' + summary.split(':')[0] + ')');
  } else {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    console.log(name + ': ' + summary);
  }
}
if (stale) process.exit(1);
