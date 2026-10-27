// Tests lock.mjs on ../positions.tsv:  node test.mjs [positions.tsv]
import { readFileSync } from 'node:fs';
import { cannotBeMated, fromFen } from './lock.mjs';

const path = process.argv[2] ?? '../positions.tsv';
let n = 0, bad = 0;
for (const line of readFileSync(path, 'utf8').split('\n')) {
  if (line.startsWith('#') || line.trim() === '') continue;
  const [fen, white, black] = line.split('\t');
  const p = fromFen(fen);
  const w = cannotBeMated(p, true), b = cannotBeMated(p, false);
  if (w !== (white === '1') || b !== (black === '1')) {
    if (++bad <= 10) console.log(`wrong: ${fen} expected ${white} ${black} got ${Number(w)} ${Number(b)}`);
  }
  n++;
}
console.log(`javascript: ${n} positions, ${bad} wrong`);
process.exitCode = bad ? 1 : 0;
