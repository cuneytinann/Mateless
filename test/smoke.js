'use strict';
const L = require(process.argv[2] || '../mateless.js');
const t0 = performance.now();
const cases = [
  ['rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', [20, 400, 8902, 197281, 4865609]],
  ['r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', [48, 2039, 97862, 4085603]],
  ['8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', [14, 191, 2812, 43238, 674624]],
  ['r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', [6, 264, 9467, 422333]],
  ['rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', [44, 1486, 62379, 2103487]],
];
let total = 0, bad = 0;
for (const [fen, want] of cases) {
  const p = L.fromFen(fen).position;
  want.forEach((n, d) => { const got = L.perft(p, d + 1); total += got; if (got !== n) { bad++; console.log('PERFT MISMATCH', fen, d + 1, n, got); } });
}
const ms = performance.now() - t0;
console.log('perft', bad ? 'FAILED' : 'ok', (total / 1e6).toFixed(1) + 'M leaves in', ms.toFixed(0), 'ms');
