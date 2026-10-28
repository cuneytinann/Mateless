'use strict';
/* Writes lock/positions.tsv: the positions every version of the simple lock detector (lock/) is
   tested on, each labelled for both sides by mateless.js's first-version lock detector
   (_internal.coreLockTest: the rules of lock/, without the second version's open pairs and boxed pieces).
     node tools/lock-positions.js            writes lock/positions.tsv (the same file every time)
     node tools/lock-positions.js --check    says whether it is up to date
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
  const r = E.fromFen(fen);
  if (r.error) return null;
  const other = E.fromFen(write({ a: p.a, side: p.side === 'w' ? 'b' : 'w', ep: '-' }));
  if (other.error || E.inCheck(other.position)) return null;   // the side not to move is in check
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
  const pos = E.fromFen(fen).position;
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

const rows = [...out].map(([fen, label]) => fen + '\t' + label);
const both = rows.filter(r => r.endsWith('1\t1')).length, white = rows.filter(r => /\t1\t0$/.test(r)).length,
      black = rows.filter(r => /\t0\t1$/.test(r)).length;
const head = [
  '# The positions the lock detector is tested on, in every language: written by tools/lock-positions.js,',
  '# labelled by mateless.js. One line per position: the FEN, then 1 if White can never be mated (the',
  '# lock detector proves it) or 0, then the same for Black.',
  '# ' + rows.length + ' positions: ' + both + ' locked for both sides, ' + white + ' for White only, ' + black + ' for Black only, ' +
    (rows.length - both - white - black) + ' for neither.',
];
const text = head.join('\n') + '\n' + rows.join('\n') + '\n', file = path.join(ROOT, 'lock/positions.tsv');
if (process.argv.includes('--check')) {
  if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== text) { console.log('lock/positions.tsv is out of date: run node tools/lock-positions.js'); process.exit(1); }
  console.log('lock/positions.tsv is up to date (' + rows.length + ' positions)');
} else {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  console.log(head[3].slice(2));
}
