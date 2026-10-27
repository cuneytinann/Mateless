'use strict';
/* Flag verdicts on chasolver positions, both flags, by label: is the flagged side's opponent
   able to mate (chasolver)? Reports outcomes and the time each kind of outcome costs.
   chasolver's positions.txt holds some positions no game can reach (two bishops giving check at
   once, say); they are set aside with the arbiter's FEN checks (fenProblem in site/arbiter/arbiter.js).
     CHASOLVER=<chasolver>/tests node classify.js <ply> <budget> <every> */
const E = require(process.env.ENGINE || '../mateless.js'), fs = require('fs'), path = require('path');
const fenProblem = new Function(fs.readFileSync(path.join(__dirname, '..', 'site', 'arbiter', 'arbiter.js'), 'utf8')
  .match(/\nconst fenProblem = (\(function \(\) \{[\s\S]*?\n\}\)\(\));\n/)[1].replace(/^/, 'return '))();
if (!process.env.CHASOLVER) throw new Error('set CHASOLVER to the folder of chasolver\'s tests/positions.txt and tests/lichess.txt');
const [ply, bud, every] = [+process.argv[2], +process.argv[3], +process.argv[4]];
const rows = [];
for (const f of ['positions.txt', 'lichess.txt'])
  for (const l of fs.readFileSync(path.join(process.env.CHASOLVER, f), 'utf8').split('\n'))
    if (/^(WB|W-|-B|--) /.test(l)) rows.push([l.slice(0, 2), l.slice(3).trim(), f]);
const stat = {};
const add = (k, ms, nodes) => { const s = stat[k] || (stat[k] = { n: 0, ms: 0, nodes: 0 }); s.n++; s.ms += ms; s.nodes += nodes; };
let falseDraw = 0;
for (let i = 0; i < rows.length; i += every) {
  const [lab, fen] = rows[i]; if (fenProblem(fen)) continue; const s = E.fromFen(fen); if (s.error) continue;
  for (const z of [E.WHITE, E.BLACK]) {
    const canMate = lab[z === E.WHITE ? 1 : 0] !== '-';   // White's flag: can Black mate? → second letter
    const t = performance.now(); const r = E.proveCannotBeMated(s.position, z, { maxPly: ply, budget: bud }); const ms = performance.now() - t;
    const out = r.proven ? (r.staticProof ? 'static' : 'proven') : r.failure;
    add((canMate ? 'winnable  ' : 'drawn     ') + out, ms, r.nodes);
    if (r.proven && canMate) falseDraw++;
  }
}
console.log('ply', ply, 'budget', bud, 'every', every, 'FALSE DRAWS', falseDraw);
for (const k of Object.keys(stat).sort()) { const s = stat[k]; console.log(k.padEnd(20), String(s.n).padStart(7), 'verdicts', (s.ms / 1000).toFixed(1).padStart(7), 's', String(Math.round(s.nodes / s.n)).padStart(8), 'nodes avg'); }
