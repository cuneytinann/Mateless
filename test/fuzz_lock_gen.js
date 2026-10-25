'use strict';
// Generates positions the lock detector certifies (lockCannotMate true for some flagged side),
// by mutating seeds and by building random locked pawn structures. Output: "<fen>\t<winner w|b>" lines,
// winner = the mater whose mate the lock detector rules out. Usage: node fuzz_lock_gen.js <seed> <count> <out>
// Then: rust/target/release/examples/oracle < <out>   (chasolver's full analysis: every line must be "U")
const E = require(process.env.ENGINE || '../mateless.js'), fs = require('fs');
let rng = +process.argv[2] || 1;
const rand = () => { rng ^= rng << 13; rng ^= rng >>> 17; rng ^= rng << 5; return (rng >>> 0) / 4294967296; };
const ri = n => Math.floor(rand() * n);
const want = +process.argv[3] || 10000, out = process.argv[4] || 'cand.txt';

const parse = fen => { const [b, s] = fen.split(' '); const a = []; for (const row of b.split('/').reverse()) for (const ch of row) { if (/\d/.test(ch)) for (let i = 0; i < +ch; i++) a.push('.'); else a.push(ch); } return { a, side: s || 'w' }; };
const ser = ({ a, side }) => { const rows = []; for (let r = 7; r >= 0; r--) { let s = '', e = 0; for (let f = 0; f < 8; f++) { const c = a[r * 8 + f]; if (c === '.') e++; else { if (e) s += e; e = 0; s += c; } } if (e) s += e; rows.push(s); } return rows.join('/') + ' ' + side + ' - - 0 1'; };

function legalish(p) {
  const fen = ser(p); const s = E.fromFen(fen); if (s.error) return null;
  // the side not to move must not be in check
  const flip = E.fromFen(ser({ a: p.a, side: p.side === 'w' ? 'b' : 'w' })); if (flip.error || E.inCheck(flip.position)) return null;
  return s.position;
}

const seeds = [];
for (const f of ['positions.txt', 'lichess.txt'])
  for (const l of fs.readFileSync((process.env.CHASOLVER || require('path').join(__dirname, '../../chasolver/tests')) + '/' + f, 'utf8').split('\n')) {
    if (!/^(WB|W-|-B|--) /.test(l)) continue; const fen = l.slice(3).trim(); const s = E.fromFen(fen); if (s.error) continue;
    if (E.lockCannotMate(s.position, E.WHITE) || E.lockCannotMate(s.position, E.BLACK) || l.startsWith('--')) seeds.push(fen);
  }

function randomLocked() {
  const a = Array(64).fill('.');
  for (let f = 0; f < 8; f++) {
    const u = rand();
    if (u < 0.75) { const r = 1 + ri(5); a[r * 8 + f] = 'P'; a[(r + 1) * 8 + f] = 'p';            // a ram
      if (rand() < 0.15 && r > 1) a[(r - 1) * 8 + f] = 'P';                                        // doubled behind
      if (rand() < 0.15 && r + 2 < 7) a[(r + 2) * 8 + f] = 'p'; }
    else if (u < 0.85) { const r = 1 + ri(6); a[r * 8 + f] = rand() < 0.5 ? 'P' : 'p'; }            // a loose pawn
  }
  const empties = () => a.map((c, i) => c === '.' ? i : -1).filter(i => i >= 0);
  const put = c => { const e = empties(); a[e[ri(e.length)]] = c; };
  put('K'); put('k');
  const nb = ri(4); for (let i = 0; i < nb; i++) put(rand() < 0.5 ? 'B' : 'b');
  if (rand() < 0.2) put('NRQnrq'[ri(6)]);
  return { a, side: rand() < 0.5 ? 'w' : 'b' };
}

function mutate(p) {
  const a = p.a.slice(); let side = p.side;
  const k = 1 + ri(3);
  for (let t = 0; t < k; t++) {
    const op = ri(7);
    const occ = a.map((c, i) => c !== '.' ? i : -1).filter(i => i >= 0), emp = a.map((c, i) => c === '.' ? i : -1).filter(i => i >= 0);
    if (op === 0 || op === 1) { const i = occ[ri(occ.length)], j = emp[ri(emp.length)]; a[j] = a[i]; a[i] = '.'; }          // move any man
    else if (op === 2) { a[emp[ri(emp.length)]] = rand() < 0.5 ? 'B' : 'b'; }                                              // add a bishop
    else if (op === 3) { const j = emp[ri(emp.length)]; if (j >= 8 && j < 56) a[j] = rand() < 0.5 ? 'P' : 'p'; }          // add a pawn
    else if (op === 4) { const i = occ[ri(occ.length)]; if (!/k/i.test(a[i])) a[i] = '.'; }                                // remove one
    else if (op === 5) { a[emp[ri(emp.length)]] = 'NRQnrq'[ri(6)]; }                                                       // add N/R/Q
    else side = side === 'w' ? 'b' : 'w';
    // king step to a neighbouring square (small moves matter most)
    if (rand() < 0.3) { const kc = rand() < 0.5 ? 'K' : 'k'; const i = a.indexOf(kc); const d = [1, -1, 8, -8, 7, 9, -7, -9][ri(8)]; const j = i + d;
      if (j >= 0 && j < 64 && Math.abs((j & 7) - (i & 7)) <= 1 && a[j] === '.') { a[j] = kc; a[i] = '.'; } }
  }
  return { a, side };
}

const seen = new Set(); const lines = []; let tried = 0;
const pool = seeds.map(parse);
while (lines.length < want && tried < want * 400) {
  tried++;
  let p;
  const u = rand();
  if (u < 0.45) p = mutate(pool[ri(pool.length)]);
  else if (u < 0.85) p = randomLocked();
  else p = mutate(randomLocked());
  const pos = legalish(p); if (!pos) continue;
  for (const z of [E.WHITE, E.BLACK]) {
    if (E.materialCannotMate(pos, z)) continue;           // only what the lock detector alone certifies
    if (!E.lockCannotMate(pos, z)) continue;
    const fen = ser(p), key = fen + z; if (seen.has(key)) continue; seen.add(key);
    lines.push(fen + '\t' + (z === E.WHITE ? 'b' : 'w'));
    if (lines.length % 50 === 0 && rand() < 0.5) pool.push(p);   // certified positions become seeds too
  }
}
fs.writeFileSync(out, lines.join('\n') + '\n');
console.error('seeds', seeds.length, 'tried', tried, 'certified', lines.length);
