'use strict';
/* Loads several engine files into one process and alternates them position by position, so
   that both see the same machine conditions. Prints CPU-time knps per engine. */
const fs = require('fs');
const [budget, ply, every] = [+process.argv[2], +process.argv[3], +process.argv[4]];
const files = process.argv.slice(5);
const engines = files.map(f => require(f));
const fens = [];
for (const f of ['positions.txt', 'lichess.txt']) for (const l of fs.readFileSync((process.env.CHASOLVER || require('path').join(__dirname, '../../chasolver/tests')) + '/' + f, 'utf8').split('\n')) if (/^(WB|W-|-B|--) /.test(l)) fens.push(l.slice(3));
const sample = fens.filter((_, i) => i % every === 0);
const pos = engines.map(L => sample.map(f => L.fromFen(f)).map(s => (s.error ? null : s.position)));
const time = engines.map(() => 0), nodes = engines.map(() => 0);
for (let rep = 0; rep < 2; rep++)
  for (let i = 0; i < sample.length; i++) {
    if (!pos[0][i]) continue;
    for (let e0 = 0; e0 < engines.length; e0++) {
      const e = (e0 + i + rep) % engines.length, L = engines[e], p = pos[e][i];
      for (const z of [L.WHITE, L.BLACK]) {
        const t = process.cpuUsage(); const r = L.proveCannotBeMated(p, z, { maxPly: ply, budget }); const d = process.cpuUsage(t);
        time[e] += d.user + d.system; nodes[e] += r.nodes;
      }
    }
  }
files.forEach((f, e) => console.log(f.split('/').pop().padEnd(18), 'nodes', nodes[e], 'cpu ms', (time[e] / 1000).toFixed(0), 'knps', (nodes[e] / (time[e] / 1000)).toFixed(0)));
