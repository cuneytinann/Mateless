'use strict';
/* Perft of the six test positions of the Chess Programming Wiki
   (https://www.chessprogramming.org/Perft_Results), with mateless.js.

   Usage:  node perft_cpw.js [engine.js] [maxDepth] [--only=N] [--divide] [--all]
     engine.js   default: mateless.js in the folder above this script
     maxDepth    default 5; every position runs depths 1..maxDepth
     --only=N    only position N (1-6)
     --divide    on a mismatch, print the count after each first move at that depth
     --all       also run depths that have no reference value (position 5 has none past 5)

   Promotions count as four moves, as in the reference numbers. The exit code is 0 when every
   count with a reference value matches, 1 otherwise. */
const path = require('path'), os = require('os');

const args = process.argv.slice(2);
const enginePath = path.resolve(args.find(a => a.endsWith('.js')) || path.join(__dirname, '..', 'mateless.js'));
const maxDepth = +(args.find(a => /^\d+$/.test(a)) || 5);
const only = +((args.find(a => a.startsWith('--only=')) || '--only=0').slice(7));
const divide = args.includes('--divide');
const all = args.includes('--all');

const POSITIONS = [
  { n: 1, name: 'Start position', fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    expect: [20, 400, 8902, 197281, 4865609, 119060324, 3195901860] },
  { n: 2, name: 'Kiwipete', fen: 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
    expect: [48, 2039, 97862, 4085603, 193690690, 8031647685] },
  { n: 3, name: 'Position 3', fen: '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
    expect: [14, 191, 2812, 43238, 674624, 11030083, 178633661, 3009794393] },
  { n: 4, name: 'Position 4', fen: 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1',
    expect: [6, 264, 9467, 422333, 15833292, 706045033] },
  { n: 5, name: 'Position 5', fen: 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8',
    expect: [44, 1486, 62379, 2103487, 89941194] },
  { n: 6, name: 'Position 6', fen: 'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10',
    expect: [46, 2079, 89890, 3894594, 164075551, 6923051137] },
];

const fmt = x => String(x).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const pad = (s, n) => String(s).padStart(n);

let t = process.hrtime.bigint();
const E = require(enginePath);
const loadMs = Number(process.hrtime.bigint() - t) / 1e6;
console.log('engine   ' + enginePath + '  (loaded in ' + loadMs.toFixed(1) + ' ms)');
console.log('node     ' + process.version + '   cpu ' + (os.cpus()[0] || {}).model);
console.log('depths   1..' + maxDepth + (only ? '   position ' + only : '') + '\n');
console.log(['pos', 'depth', 'nodes', 'expected', 'seconds', 'M nodes/s', ''].map((h, i) => pad(h, [3, 6, 16, 16, 9, 10, 0][i])).join(' '));

/** Count after each first move: name, count. Promotions are listed once per piece. */
function divideCounts(pos, depth) {
  const out = [];
  for (const m of E.legalMoves(pos)) {
    const pieces = m.promotion ? E.PROMOTION_ORDER : [E.QUEEN];
    for (const p of pieces) {
      const next = E.makeMove(pos, new E.Position(), m.from, m.to, p);
      const name = E.squareName(m.from) + E.squareName(m.to) + (m.promotion ? 'qrbn'[E.PROMOTION_ORDER.indexOf(p)] : '');
      out.push([name, depth > 1 ? E.perft(next, depth - 1) : 1]);
    }
  }
  return out.sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

let failures = 0, totalNodes = 0, totalSeconds = 0;
for (const P of POSITIONS) {
  if (only && P.n !== only) continue;
  const setup = E.fromFen(P.fen);
  if (setup.error) { console.log(pad(P.n, 3) + '  could not read the FEN: ' + setup.error); failures++; continue; }
  for (let d = 1; d <= maxDepth; d++) {
    if (P.expect[d - 1] === undefined && !all) { console.log(pad(P.n, 3) + pad(d, 7) + '   skipped: no reference value (--all runs it)'); break; }
    t = process.hrtime.bigint();
    const nodes = E.perft(setup.position, d);
    const sec = Number(process.hrtime.bigint() - t) / 1e9;
    totalNodes += nodes; totalSeconds += sec;
    const want = P.expect[d - 1];
    const verdict = want === undefined ? '(no reference)' : nodes === want ? 'ok' : 'MISMATCH';
    if (verdict === 'MISMATCH') failures++;
    console.log([pad(P.n, 3), pad(d, 6), pad(fmt(nodes), 16), pad(want === undefined ? '-' : fmt(want), 16),
                 pad(sec.toFixed(3), 9), pad(sec > 0.001 ? (nodes / sec / 1e6).toFixed(1) : '-', 10), verdict].join(' '));
    if (verdict === 'MISMATCH') {
      if (divide) for (const [name, c] of divideCounts(setup.position, d)) console.log('        ' + name.padEnd(7) + fmt(c));
      break;   // deeper counts would be wrong too
    }
  }
  console.log('    ' + P.name + ': ' + P.fen);
}

console.log('\ntotal    ' + fmt(totalNodes) + ' nodes in ' + totalSeconds.toFixed(1) + ' s  (' +
            (totalNodes / Math.max(totalSeconds, 1e-9) / 1e6).toFixed(1) + ' M nodes/s)');
console.log(failures ? failures + ' MISMATCH(ES)' : 'all counts match');
process.exitCode = failures ? 1 : 0;
