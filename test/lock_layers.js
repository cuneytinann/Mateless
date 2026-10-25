'use strict';
// For every chasolver position and both flags: which layer first proves "the mater can never mate"?
//   material  – materialCannotMate (static)
//   lock      – lockCannotMate (static)
//   domino    – the Domino search, 6 plies / 100 nodes (the engine's defaults)
// False positives (proven while chasolver says a helpmate exists) counted per layer.
const E = require(process.env.ENGINE || '../mateless.js'), fs = require('fs');
const rows = [];
for (const f of ['positions.txt', 'lichess.txt'])
  for (const l of fs.readFileSync((process.env.CHASOLVER || require('path').join(__dirname, '../../chasolver/tests')) + '/' + f, 'utf8').split('\n'))
    if (/^(WB|W-|-B|--) /.test(l)) rows.push([l.slice(0, 2), l.slice(3).trim(), f]);
const search = new E.Domino();
const stat = {}; const add = k => stat[k] = (stat[k] || 0) + 1;
const fp = []; const unproven = [];
const T = { lock: 0n, domino: 0n }; const N = { lock: 0, domino: 0 };
const tm = (k, f) => { const t = process.hrtime.bigint(); const r = f(); T[k] += process.hrtime.bigint() - t; N[k]++; return r; };
for (const [lab, fen, file] of rows) {
  const s = E.fromFen(fen); if (s.error) { add('fen error ' + s.error); continue; }
  const pos = s.position;
  for (const z of [E.WHITE, E.BLACK]) {
    const canMate = lab[z === E.WHITE ? 1 : 0] !== '-';
    const side = z === E.WHITE ? 'W-flag' : 'B-flag';
    let layer = null;
    if (E.materialCannotMate(pos, z)) layer = 'material';
    else if (tm('lock', () => E.lockCannotMate(pos, z))) layer = 'lock';
    else if (tm('domino', () => search.run(pos, z, E.DOMINO_PLY, E.DOMINO_BUDGET, { rootStatic: false }).proven)) layer = 'domino';
    add((canMate ? 'helpmate exists  : ' : 'helpmate impossible: ') + (layer || 'unproven'));
    if (layer && canMate) fp.push([layer, lab, side, fen]);
    if (!canMate && !layer) unproven.push([side, lab, file, fen]);
  }
}
for (const k of Object.keys(stat).sort()) console.log(k.padEnd(36), stat[k]);
console.log('false positives:', fp.length); fp.slice(0, 30).forEach(x => console.log('   ', x.join(' | ')));
for (const k in T) console.log(k, 'calls', N[k], 'avg µs', N[k] ? (Number(T[k]) / N[k] / 1000).toFixed(2) : '-');
fs.writeFileSync('unproven.txt', unproven.map(x => x.join('\t')).join('\n') + '\n');
