'use strict';
/* A Game under a platform's own rules, in mateless.js and in mateless.wasm: the same answers ply by
   ply. Random games from the start position and from chasolver's lichess.txt (CHASOLVER), some
   with the halfmove clock moved near the move rules and with moves taken back and forth to make
   positions repeat, each under random options (moveRule 0/100/150, repetition 0/3/5, claimMoves
   0/100, claimRepetition 0/3, rungs 1/2/3, dominoAtEnd). After every ply: the status, the claims,
   the repetition count, the FEN and the legal moves; at the end the flags and the verdicts if
   White's flag falls and if Black resigns. Prints the lines for rust_compare.js's play mode too
   (GAMES_OUT: a file).
     node game_check.js [games]        (default 2000; ENGINE: the engine, default ../mateless.js) */
const fs = require('fs'), path = require('path');
const E = require(path.resolve(__dirname, process.env.ENGINE || '../mateless.js'));
const W = require('../mateless-wasm.js').instantiate(fs.readFileSync(path.join(__dirname, '..', 'mateless.wasm')));
const N = +(process.argv[2] || 2000);
let seed = 2026; const rand = n => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return (seed >>> 8) % n; };
const name = s => 'abcdefgh'[s & 7] + (1 + (s >> 3));
const LETTER = { [E.QUEEN]: 'q', [E.ROOK]: 'r', [E.BISHOP]: 'b', [E.KNIGHT]: 'n' };
const starts = ['rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'];
for (const l of fs.readFileSync((process.env.CHASOLVER || path.join(__dirname, '../../chasolver/tests')) + '/lichess.txt', 'utf8').split('\n'))
  if (/^(WB|W-|-B|--) /.test(l)) starts.push(l.slice(3).trim());
let problems = 0, games = 0, plies = 0;
const ends = {}, lines = [];
const problem = m => { problems++; if (problems <= 20) console.log('PROBLEM', m); };
const moveList = ms => ms.map(m => m.from + '-' + m.to + (m.promotion ? 'p' : '')).sort().join(' ');
while (games < N) {
  let fen = starts[rand(starts.length)];
  const f = fen.split(' ');
  if (rand(3) === 0) { f[4] = String(80 + rand(70)); fen = f.join(' '); }
  const s = E.fromFen(fen); if (s.error) continue;
  const rungs = 1 + rand(3);
  const opt = { moveRule: [0, 100, 150][rand(3)], repetition: [0, 3, 5][rand(3)], claimMoves: [0, 100][rand(2)],
                claimRepetition: [0, 3][rand(2)], rungs, dominoAtEnd: rungs === 3 && rand(2) === 1 };
  const a = new E.Game(s.position, opt), b = new W.Game(fen, opt);
  const sa = a.status(), sb = b.status();
  if (sa !== sb) problem(`${fen} ${JSON.stringify(opt)}: status ${sa} / ${sb}`);
  if (sa) { b.free(); continue; }
  games++;
  const moves = [], hist = [];
  for (let ply = 0; ply < 80; ply++) {
    const la = a.legalMoves(), lb = b.legalMoves();
    if (moveList(la) !== moveList(lb)) { problem(`${fen} ply ${ply}: legal moves differ`); break; }
    if (!la.length) break;
    let m = null;
    if (hist.length >= 2 && rand(10) < 4) { const back = hist[hist.length - 2]; m = la.find(x => x.from === back.to && x.to === back.from) || null; }
    if (!m) m = la[rand(la.length)];
    const promo = m.promotion ? [E.QUEEN, E.ROOK, E.BISHOP, E.KNIGHT][rand(4)] : E.QUEEN;
    hist.push(m); moves.push(name(m.from) + name(m.to) + (m.promotion ? LETTER[promo] : ''));
    const ra = a.play(m.from, m.to, promo), rb = b.play(m.from, m.to, promo); plies++;
    const fa = E.toFen(a.position, (+f[5] || 1) + ((a.ply + (s.position.side === E.BLACK ? 1 : 0)) >> 1)), fb = b.fen();
    if (ra !== rb || a.claimable() !== b.claimable() || a.repetitions !== b.repetitions || fa !== fb)
      problem(`${fen} ${JSON.stringify(opt)} ${moves.join(' ')}: ${ra}/${rb} ${a.claimable()}/${b.claimable()} ${a.repetitions}/${b.repetitions} ${fa} / ${fb}`);
    if (ra) { ends[E.RESULT_NAMES[ra]] = (ends[E.RESULT_NAMES[ra]] || 0) + 1; break; }
  }
  const wa = [a.whiteDownAt, a.blackDownAt, a.flagVerdict(E.WHITE), a.flagVerdict(E.BLACK, { resigned: true })].join(',');
  const wb = [b.whiteDownAt, b.blackDownAt, b.flagVerdict(W.WHITE), b.flagVerdict(W.BLACK, { resigned: true })].join(',');
  if (wa !== wb) problem(`${fen} ${JSON.stringify(opt)} ${moves.join(' ')}: flags and verdicts ${wa} / ${wb}`);
  lines.push([opt.rungs, opt.dominoAtEnd ? 1 : 0, opt.moveRule, opt.repetition, opt.claimMoves, opt.claimRepetition].join(',') + '|' + fen + '|' + moves.join(' '));
  b.free();
}
if (process.env.GAMES_OUT) fs.writeFileSync(process.env.GAMES_OUT, lines.join('\n') + '\n');
console.log(`${games} games, ${plies} plies (${Object.entries(ends).map(([k, n]) => n + ' ' + k).join(', ')}): ${problems} problems`);
process.exit(problems ? 1 : 0);
