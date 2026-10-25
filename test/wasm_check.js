'use strict';
/* mateless.wasm (through mateless-wasm.js) against mateless.js: the same answers, field by field,
   node counts included.
     positions  chasolver's positions.txt and lichess.txt (CHASOLVER), and DATA's last positions
                when DATA is given (the chasolver-data CSV): the FEN error, the material test and
                the lock detector for both sides, cannotMate2 for each set of sides, both proofs
                (every field), the dead-position test; every 64th also at 9 plies / 2,000 nodes,
                every 512th perft 3;
     games      games played from those positions, a move chosen by a seeded rule: after every ply
                the two flags (Flags.update in both engines, the wasm one fed the FEN; a Game would
                not update them on the position that ends the game, these do).
   Usage: node wasm_check.js [games] [plies]      (default 2000 games of at most 120 plies) */
const fs = require('fs'), path = require('path');
const E = require(path.resolve(__dirname, process.env.ENGINE || '../mateless.js'));
const W = require('../mateless-wasm.js').instantiate(fs.readFileSync(path.join(__dirname, '..', 'mateless.wasm')));
const GAMES = +(process.argv[2] || 2000), PLIES = +(process.argv[3] || 120);

let problems = 0;
const problem = m => { problems++; if (problems <= 20) console.log('PROBLEM', m); };
const fens = [];
for (const f of ['positions.txt', 'lichess.txt'])
  for (const l of fs.readFileSync((process.env.CHASOLVER || require('path').join(__dirname, '../../chasolver/tests')) + '/' + f, 'utf8').split('\n'))
    if (/^(WB|W-|-B|--) /.test(l)) fens.push(l.slice(3).trim());
if (process.env.DATA)
  for (const l of fs.readFileSync(process.env.DATA, 'utf8').split('\n').slice(1)) if (l) fens.push(l.split(',')[12].trim());

const proof = p => [p.proven, p.staticProof, p.failure, p.foundBy, p.nodes].join(',');
let positions = 0, searched = 0;
for (let i = 0; i < fens.length; i++) {
  const fen = fens[i], a = E.fromFen(fen), b = W.fromFen(fen);
  if (a.error || b.error) { if (a.error !== b.error) problem('FEN error ' + a.error + ' against ' + b.error + ': ' + fen); continue; }
  const p = a.position, q = b.position;
  const mine = [], theirs = [];
  for (const z of [E.WHITE, E.BLACK]) {
    mine.push(E.materialCannotMate(p, z), E.lockCannotMate(p, z), E.cannotMate(p, z));
    theirs.push(W.materialCannotMate(q, z), W.lockCannotMate(q, z), W.cannotMate(q, z));
  }
  for (const ask of [1, 2, 3]) { mine.push(E.cannotMate2(p, ask)); theirs.push(W.cannotMate2(q, ask)); }
  mine.push(...E.proveBoth(p).map(proof), E.isDeadPosition(p));
  theirs.push(...W.proveBoth(q).map(proof), W.isDeadPosition(q));
  if (i % 64 === 0) {
    for (const z of [E.WHITE, E.BLACK]) {
      mine.push(proof(E.proveCannotBeMated(p, z, { maxPly: 9, budget: 2000 })));
      theirs.push(proof(W.proveCannotBeMated(q, z, { maxPly: 9, budget: 2000 })));
    }
    searched++;
  }
  if (i % 512 === 0) { mine.push(E.perft(p, 3)); theirs.push(W.perft(q, 3)); }
  if (mine.join('|') !== theirs.join('|')) problem(fen + '\n  js   ' + mine.join('|') + '\n  wasm ' + theirs.join('|'));
  q.free();
  positions++;
}

// Games: the flags ply by ply.
let seed = 7;
const rand = n => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return (seed >>> 8) % n; };
let plies = 0, down = 0;
for (let g = 0; g < GAMES; g++) {
  const start = E.fromFen(fens[rand(fens.length)]);
  if (start.error) continue;
  const game = new E.Game(start.position), mine = new E.Flags(), flags = new W.Flags();
  for (let ply = 0; ply <= PLIES; ply++) {
    let status = 0;
    if (ply > 0) {
      const moves = game.legalMoves();
      if (!moves.length) break;
      const m = moves[rand(moves.length)];
      status = game.play(m.from, m.to, E.QUEEN);
    }
    mine.update(game.position, ply);
    flags.update(E.toFen(game.position), ply);
    plies++;
    if (mine.whiteDownAt !== flags.whiteDownAt || mine.blackDownAt !== flags.blackDownAt) {
      problem('game ' + g + ' ply ' + ply + ': flags ' + mine.whiteDownAt + ',' + mine.blackDownAt + ' against ' +
              flags.whiteDownAt + ',' + flags.blackDownAt + ' at ' + E.toFen(game.position));
      break;
    }
    if (status) break;
  }
  down += (mine.whiteDownAt >= 0) + (mine.blackDownAt >= 0);
  flags.free();
}
console.log(`${positions} positions (${searched} also at 9 plies / 2,000 nodes), ${GAMES} games, ${plies} plies, ${down} flags down: ${problems} problems`);
process.exit(problems ? 1 : 0);
