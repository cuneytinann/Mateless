// Both sides at once against each side alone (mateless.js): the time per position or per ply,
// in one process, alternating, median of the rounds; the checksums must match.
//   node twosided_bench.js time <positions> [rounds]    lock test, static tests, dead position, both proofs
//   node twosided_bench.js games <games> [rounds]       a game's flags, ply by ply (Game.updateFlags)
// A line is "<fen>" followed by anything after a tab, or a game: FENs joined by "|".
const fs = require('fs'), path = require('path');
const E = require(path.resolve(__dirname, process.env.ENGINE || '../mateless.js'));
const I = E._internal, W = E.WHITE, B = E.BLACK;
const read = file => fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
  .map(l => l.split('\t')[0].split('|').map(f => E.fromFen(f).position).filter(Boolean)).filter(g => g.length);
const median = v => v.slice().sort((a, b) => a - b)[v.length >> 1];
const [mode, file] = process.argv.slice(2), rounds = +(process.argv[4] || 5);

function compare(name, n, one, two) {
  const c1 = one(), c2 = two();
  const t1 = [], t2 = [];
  for (let r = 0; r < rounds; r++) {
    for (let k = 0; k < 2; k++) {
      const first = (r + k) % 2 === 0, t0 = process.hrtime.bigint();
      const c = first ? one() : two();
      const t = Number(process.hrtime.bigint() - t0) / n;
      if (c !== (first ? c1 : c2)) throw new Error('unstable checksum');
      (first ? t1 : t2).push(t);
    }
  }
  console.log(`  ${name.padEnd(34)} each side alone ${median(t1).toFixed(1).padStart(8)}   both at once ${median(t2).toFixed(1).padStart(8)}` +
              `   (${(median(t1) / median(t2)).toFixed(2)}x)   checksum ${c1} ${c1 === c2 ? '=' : 'DIFFERENT'}`);
}

if (mode === 'time') {
  const v = read(file).flat();
  console.log(`${path.basename(file)}: ${v.length} positions, ${rounds} rounds (ns per position)`);
  compare('lock test, both sides', v.length,
    () => { let c = 0; for (const p of v) c += (I.lockTest(p, W) ? 1 : 0) + (I.lockTest(p, B) ? 2 : 0); return c; },
    () => { let c = 0; for (const p of v) c += I.lockTest2(p, 3); return c; });
  compare('static tests, both sides', v.length,
    () => { let c = 0; for (const p of v) c += (E.cannotMate(p, W) ? 1 : 0) + (E.cannotMate(p, B) ? 2 : 0); return c; },
    () => { let c = 0; for (const p of v) c += E.cannotMate2(p, 3); return c; });
  compare('dead position (isDeadPosition)', v.length,
    () => { let c = 0; for (const p of v) if (E.proveCannotBeMated(p, B).proven && E.proveCannotBeMated(p, W).proven) c++; return c; },
    () => { let c = 0; for (const p of v) if (E.isDeadPosition(p)) c++; return c; });
  compare('both proofs (proveBoth)', v.length,
    () => { let c = 0; for (const p of v) { const w = E.proveCannotBeMated(p, W), b = E.proveCannotBeMated(p, B);
                                            c += (w.proven ? 1 : 0) + (b.proven ? 2 : 0) + 4 * (w.nodes + b.nodes); } return c; },
    () => { let c = 0; for (const p of v) { const q = E.proveBoth(p); c += (q[0].proven ? 1 : 0) + (q[1].proven ? 2 : 0) + 4 * (q[0].nodes + q[1].nodes); } return c; });
} else if (mode === 'games') {
  const games = read(file), plies = games.reduce((a, g) => a + g.length, 0);
  const search = new E.Domino(), objects = games.map(g => new E.Game(g[0]));
  // The flags as they were climbed before: each side alone (cannotMate, then Domino.run).
  const one = () => {
    let sum = 0;
    for (const g of games) {
      let whiteDownAt = -1, blackDownAt = -1;
      for (let ply = 0; ply < g.length; ply++) {
        const pos = g[ply], askStatic = ply === 0 || (pos.halfmove <= 1 && pos.ep === E.NO_SQUARE);
        for (const mater of [W, B]) {
          if ((mater === W ? whiteDownAt : blackDownAt) >= 0) continue;
          const flagged = mater ^ W;
          if ((askStatic && E.cannotMate(pos, flagged)) || search.run(pos, flagged, E.DOMINO_PLY, E.DOMINO_BUDGET, { rootStatic: false }).proven) {
            if (mater === W) whiteDownAt = ply; else blackDownAt = ply;
          }
        }
      }
      sum += whiteDownAt * 1000 + blackDownAt;
    }
    return sum;
  };
  const two = () => {
    let sum = 0;
    for (let k = 0; k < games.length; k++) {
      const g = games[k], game = objects[k];
      game.whiteDownAt = -1; game.blackDownAt = -1; game.flagsPly = -1;
      for (let ply = 0; ply < g.length; ply++) { game.position = g[ply]; game.ply = ply; game.updateFlags(); }
      sum += game.whiteDownAt * 1000 + game.blackDownAt;
    }
    return sum;
  };
  console.log(`${path.basename(file)}: ${games.length} games, ${plies} plies, ${rounds} rounds (ns per ply)`);
  compare('flags (Game.updateFlags)', plies, one, two);
} else {
  console.log('usage: node twosided_bench.js time <positions> [rounds] | games <games> [rounds]');
  process.exit(1);
}
