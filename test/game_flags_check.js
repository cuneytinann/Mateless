'use strict';
/* The game flags against chasolver's full analysis. Games are played move by move with the
   engine's Game, from chasolver's test positions and from the standard start, with random moves
   (mostly quiet ones, so that structures close). Every time a flag comes down ("this side can
   never mate"), chasolver's full helpmate analysis (winnability, its port in site/chasolver/engine.js) is asked
   about that side in that position: it must never find a mate. A dead position (both flags
   down) is checked for both sides.
     node game_flags_check.js [seed] [games] [plies]
   CHASOLVER: chasolver's tests folder (default ../../chasolver/tests, a clone beside this one); CHA_ENGINE: chasolver's
   port (default ../site/chasolver/engine.js); ENGINE: the engine (default ../mateless.js); DATA: the
   chasolver-data CSV, to start from its positions (real endgames) instead of the test files. */
const fs = require('fs'), path = require('path'), os = require('os');
const E = require(path.resolve(__dirname, process.env.ENGINE || '../mateless.js'));
const src = fs.readFileSync(path.resolve(__dirname, process.env.CHA_ENGINE || '../site/chasolver/engine.js'), 'utf8');
const tmp = path.join(os.tmpdir(), 'cha-engine-' + process.pid + '.js');
fs.writeFileSync(tmp, src + '\nmodule.exports = CHA;\n');
const C = require(tmp); fs.unlinkSync(tmp);

let seed = +(process.argv[2] || 1);
const rand = n => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * n); };
const GAMES = +(process.argv[3] || 600), PLIES = +(process.argv[4] || 160);
const starts = ['rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'];
for (const f of ['positions.txt', 'lichess.txt'])
  for (const l of fs.readFileSync((process.env.CHASOLVER || require('path').join(__dirname, '../../chasolver/tests')) + '/' + f, 'utf8').split('\n'))
    if (/^(WB|W-|-B|--) /.test(l)) starts.push(l.slice(3).trim());
if (process.env.DATA) {   // start from chasolver-data's final positions instead (real endgames)
  starts.length = 1;
  for (const l of fs.readFileSync(process.env.DATA, 'utf8').split('\n').slice(1)) if (l) starts.push(l.split(',')[12].trim());
}

const st = { games: 0, plies: 0, flagsDown: 0, deadPositions: 0, oracleUnwinnable: 0, oracleUndetermined: 0, ms: 0 };
const checked = new Set();
function oracle(game, mater) {
  const fen = E.toFen(game.position), key = fen + ' ' + mater;
  if (checked.has(key)) return; checked.add(key);
  const r = C.W.winnability(C.B.boardFromFen(fen), mater === E.WHITE ? C.B.WHITE : C.B.BLACK);
  if (r.result === 'winnable') {
    console.log('UNSOUND: flag down but chasolver mates', fen, mater === E.WHITE ? 'white' : 'black', r.helpmate.join(' '));
    process.exit(1);
  }
  if (r.result === 'unwinnable') st.oracleUnwinnable++; else st.oracleUndetermined++;
}
for (let g = 0; g < GAMES; g++) {
  const fen = g % 4 === 0 ? starts[0] : starts[1 + rand(starts.length - 1)], s = E.fromFen(fen);
  if (s.error) continue;
  const game = new E.Game(s.position); st.games++;
  let code = game.status();
  const down = [false, false];
  for (let ply = 0; ; ply++) {
    for (const [i, mater] of [[0, E.WHITE], [1, E.BLACK]])
      if (!down[i] && game.neverMates(mater)) { down[i] = true; st.flagsDown++; oracle(game, mater); }
    if (code || ply >= PLIES) { if (code === E.Result.DEAD_POSITION) st.deadPositions++; break; }
    const ms = game.legalMoves();
    const quiet = ms.filter(m => !game.position.board[m.to] && (game.position.board[m.from] & 7) !== E.PAWN);
    const m = quiet.length && rand(3) ? quiet[rand(quiet.length)] : ms[rand(ms.length)];
    const t = process.hrtime.bigint();
    code = game.play(m.from, m.to);
    st.ms += Number(process.hrtime.bigint() - t) / 1e6;
    st.plies++;
  }
}
st.ms = Math.round(st.ms);
console.log(st, 'µs per move', (1000 * st.ms / st.plies).toFixed(2));
console.log('no flag came down where chasolver finds a mate');
