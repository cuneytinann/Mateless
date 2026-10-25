'use strict';
/* chasolver's fast check against Mateless's static test, in one Node process, on the same positions.
     node fair_lock_bench.js <chasolver.html> <positions> [rounds]
   <positions>: lines "<fen>\t<w|b>", the second field being the side that should be unable to mate
   (the opponent of the side whose flag fell). The chasolver engine is taken from the page's
   <script id="engine"> block. Mateless engines: MATELESS_ENGINES=a.js,b.js (default ../mateless.js).
   Boards are parsed once; only the decision is timed. The rows are cut into chunks of 64; every
   chunk is run by every engine, in an order that rotates from chunk to chunk, so all engines see
   the same JIT state, caches and machine load. The median of the rounds is reported. */
const fs = require('fs'), path = require('path'), os = require('os');
const [page, file, roundsArg] = process.argv.slice(2);
const src = fs.readFileSync(page, 'utf8').match(/<script id="engine">([\s\S]*?)<\/script>/)[1];
const tmp = path.join(os.tmpdir(), 'cha-engine-' + process.pid + '.js');
fs.writeFileSync(tmp, src + '\nmodule.exports = CHA;\n');
const C = require(tmp); fs.unlinkSync(tmp);
const engineFiles = (process.env.MATELESS_ENGINES || '../mateless.js').split(',');
const rows = fs.readFileSync(file, 'utf8').trim().split('\n').map(l => l.split('\t'));
const ROUNDS = +(roundsArg || 7), CHUNK = 64;
const engines = [['chasolver fast', rows.map(([f, w]) => [C.B.boardFromFen(f), w === 'w' ? C.B.WHITE : C.B.BLACK]), x => C.W.isUnwinnableFast(x[0], x[1])]];
for (const lf of engineFiles) { const E = require(path.resolve(lf));
  engines.push(['Mateless[' + engines.length + '] ' + path.basename(lf), rows.map(([f, w]) => [E.fromFen(f).position, w === 'w' ? E.BLACK : E.WHITE]), x => E.cannotMate(x[0], x[1])]); }
const proven = engines.map(([, inp, f]) => inp.reduce((n, x) => n + (f(x) ? 1 : 0), 0));
for (let r = 0; r < 2; r++) for (const [, inp, f] of engines) for (const x of inp) f(x);   // warm-up
const res = engines.map(() => []); let sink = 0;
for (let r = 0; r < ROUNDS; r++) {
  const t = engines.map(() => 0n);
  for (let c = 0, k = 0; c < rows.length; c += CHUNK, k++) {
    const end = Math.min(rows.length, c + CHUNK);
    for (let j = 0; j < engines.length; j++) {
      const e = (j + k) % engines.length, [, inp, f] = engines[e], t0 = process.hrtime.bigint();
      for (let i = c; i < end; i++) if (f(inp[i])) sink++;
      t[e] += process.hrtime.bigint() - t0;
    }
  }
  t.forEach((v, e) => res[e].push(Number(v) / rows.length));
}
const med = a => a.slice().sort((x, y) => x - y)[a.length >> 1];
console.log(`${rows.length} positions, ${ROUNDS} rounds, ${os.cpus()[0].model}, Node ${process.version}`);
engines.forEach(([n], e) => console.log(n.padEnd(28), 'proven', String(proven[e]).padStart(7), '  median', (med(res[e]) / 1000).toFixed(3).padStart(8), 'µs/pos'));
