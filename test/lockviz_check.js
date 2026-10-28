'use strict';
/* The lock tab's display copy of the detector (site/lock/lockviz.js) against mateless.js's first-version
   detector (_internal.coreLockTest, without the second version's open pairs and boxed pieces): the
   verdict for both flagged sides, and on a proof the sets of the proving level (cones, fixed
   pawns, king reaches, bishop reaches, frozen king). Positions: the 52,050 Lichess locks, the
   final positions of the August and September scan, and three random mutations of every lock.
     node lockviz_check.js        (ENGINE: the engine, default ../mateless.js) */
const fs = require('fs'), path = require('path');
const Mt = require(path.resolve(__dirname, process.env.ENGINE || '../mateless.js'));
const V = require('../site/lock/lockviz.js');
const data = f => fs.readFileSync(path.join(__dirname, '..', 'data', f), 'utf8');
const lockedRows = data('locked_positions.tsv').trim().split('\n').map(l => l.split('\t')[0]).filter(f => f.includes('/'));
const scanRows = data('lichess_2026-08_09.tsv').trim().split('\n');
const head = scanRows[0].split('\t'), fenCol = head.indexOf('fen');
const scanFens = scanRows.slice(1).map(l => l.split('\t')[fenCol]);

let seed = 12345;
const rnd = n => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
const big = ([lo, hi]) => (BigInt(hi >>> 0) << 32n) | BigInt(lo >>> 0);

function boardOf(fen) { // 64 chars, a1 first
  const b = Array(64).fill('.');
  fen.split(' ')[0].split('/').forEach((row, r) => { let f = 0; for (const ch of row) { if (/\d/.test(ch)) f += +ch; else b[(7 - r) * 8 + f++] = ch; } });
  return b;
}
function fenOf(b, rest) {
  const rows = [];
  for (let r = 7; r >= 0; r--) { let s = '', e = 0; for (let f = 0; f < 8; f++) { const c = b[r * 8 + f]; if (c === '.') e++; else { if (e) s += e; e = 0; s += c; } } if (e) s += e; rows.push(s); }
  return rows.join('/') + ' ' + rest;
}
function mutate(fen) {
  const b = boardOf(fen), parts = fen.split(' '), rest = [parts[1] || 'w', '-', '-', '0', '1'].join(' ');
  const occ = [], empty = [];
  b.forEach((c, i) => (c === '.' ? empty : occ).push(i));
  const kind = rnd(5);
  if (kind === 0) { const pawns = occ.filter(i => 'Pp'.includes(b[i])); if (pawns.length) b[pawns[rnd(pawns.length)]] = '.'; }
  else if (kind === 1 || kind === 2) { // move a pawn or a king to an empty square nearby
    const movers = occ.filter(i => (kind === 1 ? 'Pp' : 'Kk').includes(b[i]));
    if (movers.length) { const i = movers[rnd(movers.length)], d = [-9, -8, -7, -1, 1, 7, 8, 9][rnd(8)], j = i + d;
      if (j >= 0 && j < 64 && b[j] === '.' && Math.abs((j % 8) - (i % 8)) <= 1) { b[j] = b[i]; b[i] = '.'; } }
  } else if (kind === 3) { if (empty.length) b[empty[rnd(empty.length)]] = 'Bb'[rnd(2)]; }
  else { if (empty.length) b[empty[rnd(empty.length)]] = 'Pp'[rnd(2)]; }
  // no pawns on the back ranks
  for (let i = 0; i < 8; i++) { if ('Pp'.includes(b[i])) b[i] = '.'; if ('Pp'.includes(b[56 + i])) b[56 + i] = '.'; }
  return fenOf(b, rest);
}

const stats = { positions: 0, sides: 0, proved: 0, gated: 0, levelProofs: [0, 0, 0], leakKinds: {}, setChecks: 0 };
const bad = [];
function check(fen) {
  const r = Mt.fromFen(fen);
  if (!r || r.error || !r.position) return;
  const pos = r.position;
  stats.positions++;
  const s = V.setsOfBoard(fen.split(' ')[0]);
  s.ep = pos.ep !== Mt.NO_SQUARE;
  for (const [flag, F] of [['w', Mt.WHITE], ['b', Mt.BLACK]]) {
    stats.sides++;
    const want = Mt._internal.coreLockTest(pos, F);   // the explorer shows the first version's detector
    const t = V.trace(s, flag);
    if (t.gate) stats.gated++;
    for (const lv of t.levels) if (lv.leak) stats.leakKinds[lv.leak] = (stats.leakKinds[lv.leak] || 0) + 1;
    if (t.proved !== want) { bad.push(['verdict', fen, flag, want, t.proved]); continue; }
    if (!want) continue;
    stats.proved++;
    stats.levelProofs[t.levels.indexOf(t.level)]++;
    const c = Mt._internal.lockSets(pos, F), lv = t.level;
    const pairs = [['wCone', lv.cones.wCone], ['bCone', lv.cones.bCone], ['wFixed', lv.final.wFixed], ['bFixed', lv.final.bFixed],
                   ['wKing', lv.final.wKing], ['bKing', lv.final.bKing], ['wBish', lv.bishops.wBish], ['bBish', lv.bishops.bBish]];
    for (const [k, v] of pairs) { stats.setChecks++; if (big(c[k]) !== v) bad.push(['set ' + k, fen, flag, V.hex(big(c[k])), V.hex(v)]); }
    const frozenWant = big(c.frozen), frozenGot = lv.frozen === 'none' ? 0n : lv.frozen === 'white' ? s.wk : s.bk;
    if (frozenWant !== frozenGot) bad.push(['frozen', fen, flag]);
  }
}

for (const fen of lockedRows) check(fen);
const afterLocked = { ...stats };
for (const fen of scanFens) check(fen);
for (let k = 0; k < 3; k++) for (const fen of lockedRows) check(mutate(fen));
console.log(JSON.stringify({ afterLocked: { positions: afterLocked.positions, proved: afterLocked.proved }, ...stats }, null, 1));
console.log('mismatches:', bad.length);
for (const b of bad.slice(0, 50)) console.log(b.join(' | '));
process.exit(bad.length ? 1 : 0);
