// Both sides at once against each side alone (mateless.js): the same answers, field by field.
//   node twosided_check.js <files...>
// A line is "<fen>" followed by anything after a tab, or a game: FENs joined by "|". For every
// position and both sides it compares lockTest2 and cannotMate2 (each subset of sides) with
// lockTest and cannotMate, proveBoth with proveCannotBeMated (every field), isDeadPosition with
// the two proofs, and Domino.run2 with run (root tests asked or not; and on
// every 64th position also at 9 plies / 2,000 nodes, where the two sides' trees part more often).
const fs = require('fs'), path = require('path');
const E = require(path.resolve(__dirname, process.env.ENGINE || '../mateless.js'));
const I = E._internal, W = E.WHITE, B = E.BLACK, FW = E.FLAGGED_WHITE, FB = E.FLAGGED_BLACK;
const bits = (w, b) => (w ? FW : 0) | (b ? FB : 0);
const s1 = new E.Domino(), s2 = new E.Domino();
let n = 0, bad = 0, big = 0, partVerdict = 0, partFailure = 0, partBudget = 0;
const report = (what, pos) => { bad++; if (bad <= 10) console.log('MISMATCH', what, E.toFen(pos)); };
for (const file of process.argv.slice(2)) {
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line) continue;
    for (const fen of line.split('\t')[0].split('|')) {
      const parsed = E.fromFen(fen);
      if (!parsed.position) continue;
      const pos = parsed.position;
      n++;
      const lock = [I.lockTest(pos, W), I.lockTest(pos, B)], st = [E.cannotMate(pos, W), E.cannotMate(pos, B)];
      for (let ask = 1; ask <= 3; ask++) {
        if (I.lockTest2(pos, ask) !== (ask & bits(lock[0], lock[1]))) report('lockTest2', pos);
        if (E.cannotMate2(pos, ask) !== (ask & bits(st[0], st[1]))) report('cannotMate2', pos);
      }
      const both = E.proveBoth(pos), alone = [E.proveCannotBeMated(pos, W), E.proveCannotBeMated(pos, B)];
      for (let i = 0; i < 2; i++) {
        const p = alone[i], q = both[i];
        if (p.proven !== q.proven || p.staticProof !== q.staticProof || p.failure !== q.failure || p.foundBy !== q.foundBy ||
            p.nodes !== q.nodes) report('proveBoth', pos);
      }
      if (E.isDeadPosition(pos) !== (alone[0].proven && alone[1].proven)) report('isDeadPosition', pos);
      const limits = [[6, 100]];
      if (n % 64 === 0) { limits.push([9, 2000]); big++; }
      for (const [ply, budget] of limits) {
        for (const rootStatic of [false, true]) {
          const one = [s1.run(pos, W, ply, budget, { rootStatic }), s1.run(pos, B, ply, budget, { rootStatic })];
          partVerdict += one[0].proven !== one[1].proven;
          partFailure += one[0].failure !== one[1].failure;
          partBudget += one[0].budgetLeft !== one[1].budgetLeft;
          for (let ask = 1; ask <= 3; ask++) {
            const q = s2.run2(pos, ask, ply, budget, { rootStatic });
            for (let i = 0; i < 2; i++) {
              const want = ask & (1 << i) ? one[i] : { proven: false, failure: null, budgetLeft: budget };
              if (want.proven !== q[i].proven || want.failure !== q[i].failure || want.budgetLeft !== q[i].budgetLeft) report('run2', pos);
            }
          }
        }
      }
    }
  }
}
console.log(`${n} positions, both sides (${big} also at 9 plies / 2,000 nodes): ${bad} mismatches`);
console.log(`searches compared in pairs where the two sides part: verdict ${partVerdict}, failure ${partFailure}, budget spent ${partBudget}`);
process.exit(bad ? 1 : 0);
