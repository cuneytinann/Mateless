'use strict';
/* The speed of mateless.wasm against mateless.js, in one process: 64 items at a time, the two
   engines in turn (which goes first changes from chunk to chunk), median of 7 rounds, ns per item.
     proveBoth   both proofs of a position (chasolver's lichess.txt, or DATA's last positions)
     flags       a game's two flags, ply by ply (games played from those positions, seeded)
     static      cannotMate2 for both sides (the static tests alone)
   Positions are read beforehand (each engine its own); the "+FEN" lines read the FEN in the call,
   as a page does with a list of FENs.
   Usage: node wasm_bench.js [positions] [games]     (default 20000 positions, 400 games) */
const fs = require('fs'), path = require('path');
const E = require(path.resolve(__dirname, process.env.ENGINE || '../mateless.js'));
const W = require('../mateless-wasm.js').instantiate(fs.readFileSync(path.join(__dirname, '..', 'mateless.wasm')));
const N = +(process.argv[2] || 20000), GAMES = +(process.argv[3] || 400);

let fens = [];
if (process.env.DATA) fens = fs.readFileSync(process.env.DATA, 'utf8').split('\n').slice(1).filter(Boolean).map(l => l.split(',')[12].trim());
else for (const l of fs.readFileSync((process.env.CHASOLVER || require('path').join(__dirname, '../../chasolver/tests')) + '/lichess.txt', 'utf8').split('\n'))
  if (/^(WB|W-|-B|--) /.test(l)) fens.push(l.slice(3).trim());
fens = fens.filter(f => !E.fromFen(f).error).slice(0, N);
const jsPos = fens.map(f => E.fromFen(f).position), wPos = fens.map(f => W.fromFen(f).position);

// games: FENs ply by ply
let seed = 11;
const rand = n => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return (seed >>> 8) % n; };
const games = [];
for (let g = 0; g < GAMES; g++) {
  const game = new E.Game(E.fromFen(fens[rand(fens.length)]).position), seq = [E.toFen(game.position)];
  for (let ply = 1; ply <= 120; ply++) {
    const moves = game.legalMoves();
    if (!moves.length) break;
    const m = moves[rand(moves.length)];
    const st = game.play(m.from, m.to, E.QUEEN);
    seq.push(E.toFen(game.position));
    if (st) break;
  }
  games.push(seq);
}
const jsGames = games.map(s => s.map(f => E.fromFen(f).position)), wGames = games.map(s => s.map(f => W.fromFen(f).position));

let sink = 0;
const work = [
  ['proveBoth', fens.length, [i => { const r = E.proveBoth(jsPos[i]); sink += r[0].nodes; return 1; },
                              i => { const r = W.proveBoth(wPos[i]); sink += r[0].nodes; return 1; }]],
  ['proveBoth +FEN', fens.length, [i => { const r = E.proveBoth(E.fromFen(fens[i]).position); sink += r[0].nodes; return 1; },
                                   i => { const r = W.proveBoth(fens[i]); sink += r[0].nodes; return 1; }]],
  ['flags, per ply', games.length, [i => { const f = new E.Flags(), g = jsGames[i]; for (let k = 0; k < g.length; k++) f.update(g[k], k); sink += f.whiteDownAt; return g.length; },
                                    i => { const f = new W.Flags(), g = wGames[i]; for (let k = 0; k < g.length; k++) f.update(g[k], k); sink += f.whiteDownAt; f.free(); return g.length; }]],
  ['static (cannotMate2)', fens.length, [i => { sink += E.cannotMate2(jsPos[i], 3); return 1; },
                                         i => { sink += W.cannotMate2(wPos[i], 3); return 1; }]],
];
const med = a => a.slice().sort((x, y) => x - y)[a.length >> 1];
console.log('item'.padEnd(22), 'mateless.js'.padStart(12), 'mateless.wasm'.padStart(14), '   js / wasm');
for (const [name, n, fns] of work) {
  const rounds = [[], []];
  for (let r = 0; r < 7; r++) {
    const t = [0, 0], count = [0, 0];
    for (let c = 0; c < n; c += 64) for (let k = 0; k < 2; k++) {
      const e = (k + (c >> 6) + r) & 1, t0 = process.hrtime.bigint();
      for (let i = c; i < Math.min(n, c + 64); i++) count[e] += fns[e](i);
      t[e] += Number(process.hrtime.bigint() - t0);
    }
    rounds[0].push(t[0] / count[0]); rounds[1].push(t[1] / count[1]);
  }
  const a = med(rounds[0]), b = med(rounds[1]);
  console.log(name.padEnd(22), (a.toFixed(0) + ' ns').padStart(12), (b.toFixed(0) + ' ns').padStart(14), ('   ' + (a / b).toFixed(2) + '×'));
}
if (sink === 0.5) console.log(sink);
