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
   Under the rules a game ends at by itself (the second version):
     rule positions  every 16th position with its clock put near the move rule (150 or 100, 1 to
                40 plies left), with or without a repetition rule: the proof for one side at 6
                plies / 100 nodes or the defaults, both proofs and the dead-position test, every
                field (ruled included);
     rule games      games from those positions, the clock near the rule, mostly quiet moves and
                often one that takes back the side's last move (so positions come back), under
                150/5, 100/3, 100 alone and 3 alone: the flags after every ply, each update with
                the game's history, given to the wasm engine as mateless.js's { keys, n } in one
                game and as the list of FENs in the next.
   Usage: node wasm_check.js [games] [plies] [rule games]   (default 2000 games of at most 120
          plies, 300 rule games of at most 160) */
const fs = require('fs'), path = require('path');
const E = require(path.resolve(__dirname, process.env.ENGINE || '../mateless.js'));
const W = require('../mateless-wasm.js').instantiate(fs.readFileSync(path.join(__dirname, '..', 'mateless.wasm')));
const GAMES = +(process.argv[2] || 2000), PLIES = +(process.argv[3] || 120), RULE_GAMES = +(process.argv[4] || 300);

let problems = 0;
const problem = m => { problems++; if (problems <= 20) console.log('PROBLEM', m); };
const fens = [];
for (const f of ['positions.txt', 'lichess.txt'])
  for (const l of fs.readFileSync((process.env.CHASOLVER || require('path').join(__dirname, '../../chasolver/tests')) + '/' + f, 'utf8').split('\n'))
    if (/^(WB|W-|-B|--) /.test(l)) fens.push(l.slice(3).trim());
if (process.env.DATA)
  for (const l of fs.readFileSync(process.env.DATA, 'utf8').split('\n').slice(1)) if (l) fens.push(l.split(',')[12].trim());

const proof = p => [p.proven, p.staticProof, p.failure, p.foundBy, p.nodes, p.deep, p.ruled].join(',');
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
// Under the rules: positions with the clock near the move rule.
const withClock = (fen, halfmove) => {
  const f = fen.split(/\s+/);
  while (f.length < 6) f.push(f.length === 4 ? '0' : '1');
  f[4] = String(halfmove);
  return f.join(' ');
};
const SETTINGS = [[150, 5], [100, 3], [100, 0], [0, 3]];
let rulePositions = 0, ruled = 0;
for (let i = 0; i < fens.length; i += 16) {
  const k = i >> 4, moveRule = k & 1 ? 100 : 150, repetition = [0, 3, 5][k % 3];
  const fen = withClock(fens[i], moveRule - 1 - (k * 7) % 40), a = E.fromFen(fen);
  if (a.error) continue;
  const q = W.fromFen(fen).position, rules = { moveRule, repetition };
  const opts = k % 4 ? Object.assign({ maxPly: 6, budget: 100 }, rules) : rules, z = k & 2 ? E.BLACK : E.WHITE;
  const mine = [proof(E.proveCannotBeMated(a.position, z, opts)), ...E.proveBoth(a.position, opts).map(proof), E.isDeadPosition(a.position, rules)];
  const theirs = [proof(W.proveCannotBeMated(q, z, opts)), ...W.proveBoth(q, opts).map(proof), W.isDeadPosition(q, rules)];
  if (mine.join('|') !== theirs.join('|')) problem(fen + ' (' + moveRule + '/' + repetition + ')\n  js   ' + mine.join('|') + '\n  wasm ' + theirs.join('|'));
  ruled += /,true$/.test(mine[0]);
  q.free();
  rulePositions++;
}

// Under the rules: games whose positions come back, the flags after every ply with the history.
let rulePlies = 0, ruleDown = 0;
const KW = E._internal.KEY_WORDS;
for (let g = 0; g < RULE_GAMES; g++) {
  const [moveRule, repetition] = SETTINGS[g % 4];
  const start = E.fromFen(withClock(fens[rand(fens.length)], (moveRule || 100) - 20 - rand(30)));
  if (start.error) continue;
  const game = new E.Game(start.position), mine = new E.Flags({ moveRule, repetition }), flags = new W.Flags({ moveRule, repetition });
  const keys = new Int32Array(KW * 512), seen = [], last = { [E.WHITE]: null, [E.BLACK]: null };
  let n = 0;
  for (let ply = 0; ply <= 160; ply++) {
    let status = 0;
    if (ply > 0) {
      const pos = game.position, moves = game.legalMoves();
      if (!moves.length) break;
      const back = last[pos.side] && moves.find(m => m.from === last[pos.side].to && m.to === last[pos.side].from);
      const quiet = moves.filter(m => !pos.board[m.to] && (pos.board[m.from] & 7) !== E.PAWN);
      const m = back && rand(3) ? back : quiet.length && rand(10) < 9 ? quiet[rand(quiet.length)] : moves[rand(moves.length)];
      last[pos.side] = m;
      status = game.play(m.from, m.to, E.QUEEN);
    }
    const pos = game.position, fen = E.toFen(pos);
    if (pos.halfmove === 0) { n = 0; seen.length = 0; }
    mine.update(pos, ply, { keys, n });
    flags.update(fen, ply, g & 4 ? seen.slice() : { keys, n });
    E._internal.writeKey(pos, keys, KW * n++);
    seen.push(fen);
    rulePlies++;
    if (mine.whiteDownAt !== flags.whiteDownAt || mine.blackDownAt !== flags.blackDownAt) {
      problem('rule game ' + g + ' (' + moveRule + '/' + repetition + ') ply ' + ply + ': flags ' + mine.whiteDownAt + ',' + mine.blackDownAt +
              ' against ' + flags.whiteDownAt + ',' + flags.blackDownAt + ' at ' + fen);
      break;
    }
    if (status || n >= 512) break;
  }
  ruleDown += (mine.whiteDownAt >= 0) + (mine.blackDownAt >= 0);
  flags.free();
}
console.log(`${positions} positions (${searched} also at 9 plies / 2,000 nodes), ${GAMES} games, ${plies} plies, ${down} flags down; ` +
            `under the rules ${rulePositions} positions (${ruled} proofs by the rules), ${RULE_GAMES} games, ${rulePlies} plies, ` +
            `${ruleDown} flags down: ${problems} problems`);
process.exit(problems ? 1 : 0);
