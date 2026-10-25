'use strict';
/* The static tests' trigger: asking only the tests a move can have changed (testsAfter in
   src/lock.js) against the clock rule, both tests after every capture or pawn move and
   one ply later (halfmove <= 1, no en passant square). A copy of the engine is patched at run time
   to the clock rule (in both searches and in Flags.update); the two must agree everywhere, node
   counts included:
     positions  chasolver's positions.txt and lichess.txt (CHASOLVER), and DATA's last positions
                when DATA is given: both proofs (every field); every 64th also at 9 plies / 2,000
                nodes;
     games      from every position in check among them, each reply and two more plies (the
                step out of a pawn's check is the case the clock rule covers by its ply after),
                and games played from the positions, a move chosen by a seeded rule: the plies at
                which the two flags come down.
     takebacks  a move taken back (Flags.rewind) and another one played: from every position
                in check or with an en passant square among them, the first legal move, taken
                back, then each other move and two more plies; and from games played as above,
                a rewind to a ply with an en passant square or in check (else any) and another
                line. The flags, of both rules and of mateless.wasm (unless NO_WASM), must be
                those of flags fed the game as it stands, from its start.
   With the patched copy it also counts how often each rule asks the static tests.
   Usage: node trigger_check.js [games]      (default 2000 games of at most 120 plies) */
const fs = require('fs'), path = require('path'), os = require('os');
const file = path.resolve(__dirname, process.env.ENGINE || '../mateless.js');
const GAMES = +(process.argv[2] || 2000);

function load(clockRule) {
  let src = fs.readFileSync(file, 'utf8');
  const patch = (from, to) => { if (src.split(from).length !== 2) throw new Error('trigger_check: anchor not found: ' + from); src = src.replace(from, to); };
  patch("'use strict';\n\n", "'use strict';\nconst ASKED = { material: 0, lock: 0 };\n");
  patch('function materialTest(pos, flagged) {\n', 'function materialTest(pos, flagged) {\n  ASKED.material++;\n');
  patch('function lockTest2(pos, ask) {\n', 'function lockTest2(pos, ask) {\n  ASKED.lock++;\n');
  patch('function lockTest(pos, flagged) {\n', 'function lockTest(pos, flagged) {\n  ASKED.lock++;\n');
  if (clockRule) {
    const old = 'pos.halfmove <= 1 && pos.ep === NO_SQUARE ? TESTS_BOTH : 0';
    patch('this.node(ply + 1, depth - 1, pos.ep === NO_SQUARE ? tests : 0)', 'this.node(ply + 1, depth - 1, ' + old + ')');
    patch('this.node2(ply + 1, depth - 1, live, pos.ep === NO_SQUARE ? tests : 0)', 'this.node2(ply + 1, depth - 1, live, ' + old + ')');
    patch('    const tests = first ? TESTS_BOTH\n', '    const tests = first || (' + old.replace(' ? TESTS_BOTH : 0', '') + ') ? TESTS_BOTH : 0; void next; void epBefore; void checkBefore;\n    const unused = first ? TESTS_BOTH\n');
  }
  patch('return Object.freeze({\n', 'return Object.freeze({\n  ASKED,\n');
  const tmp = path.join(os.tmpdir(), 'mateless-trigger-' + process.pid + (clockRule ? '-clock' : '') + '.js');
  fs.writeFileSync(tmp, src);
  try { return require(tmp); } finally { fs.unlinkSync(tmp); }
}
const A = load(false), B = load(true);   // A: testsAfter, B: the clock rule

let problems = 0;
const problem = m => { problems++; if (problems <= 20) console.log('PROBLEM', m); };
const fens = [];
for (const f of ['positions.txt', 'lichess.txt'])
  for (const l of fs.readFileSync((process.env.CHASOLVER || require('path').join(__dirname, '../../chasolver/tests')) + '/' + f, 'utf8').split('\n'))
    if (/^(WB|W-|-B|--) /.test(l)) fens.push(l.slice(3).trim());
if (process.env.DATA)
  for (const l of fs.readFileSync(process.env.DATA, 'utf8').split('\n').slice(1)) if (l) fens.push(l.split(',')[12].trim());

const proof = p => [p.proven, p.staticProof, p.failure, p.nodes].join(',');
const asked = () => [{ ...A.ASKED }, { ...B.ASKED }];
const zero = () => { for (const E of [A, B]) { E.ASKED.material = 0; E.ASKED.lock = 0; } };

// positions
zero();
let positions = 0;
for (let i = 0; i < fens.length; i++) {
  const sa = A.fromFen(fens[i]), sb = B.fromFen(fens[i]);
  if (sa.error) continue;
  positions++;
  let a = A.proveBoth(sa.position).map(proof).join('|'), b = B.proveBoth(sb.position).map(proof).join('|');
  if (i % 64 === 0) {
    a += '|' + proof(A.proveCannotBeMated(sa.position, A.WHITE, { maxPly: 9, budget: 2000 }));
    b += '|' + proof(B.proveCannotBeMated(sb.position, B.WHITE, { maxPly: 9, budget: 2000 }));
  }
  if (a !== b) problem(fens[i] + '\n  testsAfter ' + a + '\n  clock rule ' + b);
}
const askedPositions = asked();

// games: the flags, ply by ply, fed the same positions; asks counted here only (the games are
// played with A's Game, whose own flags would count too)
const askedGames = [{ material: 0, lock: 0 }, { material: 0, lock: 0 }];
function flagsOf(E, seq) {
  const fl = new E.Flags(), sum = askedGames[E === A ? 0 : 1], m = E.ASKED.material, l = E.ASKED.lock;
  seq.forEach((fen, ply) => fl.update(E.fromFen(fen).position, ply));
  sum.material += E.ASKED.material - m; sum.lock += E.ASKED.lock - l;
  return fl.whiteDownAt + ',' + fl.blackDownAt;
}
let games = 0, plies = 0, down = 0;
const play = (start, choose, max) => {
  const g = new A.Game(A.fromFen(start).position), seq = [A.toFen(g.position)];
  for (let k = 0; k < max; k++) {
    const moves = g.legalMoves();
    if (!moves.length) break;
    const m = choose(moves, k, seq.length);
    const st = g.play(m.from, m.to, A.QUEEN);
    seq.push(A.toFen(g.position));
    if (st) break;
  }
  return seq;
};
const compare = seq => {
  const a = flagsOf(A, seq), b = flagsOf(B, seq);
  games++; plies += seq.length; if (a !== '-1,-1') down++;
  if (a !== b) problem('flags ' + a + ' against ' + b + ' in ' + seq.join(' | '));
};
for (const fen of fens) {                       // replies to every check
  const s = A.fromFen(fen);
  if (s.error || !A.inCheck(s.position)) continue;
  for (const m of A.legalMoves(s.position)) {
    const first = A.makeMove(s.position, new A.Position(s.position.castlingFiles), m.from, m.to);
    compare([fen, ...play(A.toFen(first), (ms, k, n) => ms[(5 * k + n) % ms.length], 2)]);
  }
}
let seed = 3;
const rand = n => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return (seed >>> 8) % n; };
for (let i = 0; i < GAMES; i++) compare(play(fens[rand(fens.length)], ms => ms[rand(ms.length)], 120));

const askedInGames = askedGames.map(o => ({ ...o }));

// takebacks
const W = process.env.NO_WASM ? null
  : require('../mateless-wasm.js').instantiate(fs.readFileSync(path.join(__dirname, '..', 'mateless.wasm')));
let takebacks = 0;
const rewound = (E, before, k, after) => {         // before: plies 0..j; then back to k; after: plies k+1..
  const fl = new E.Flags(), pos = f => E === W ? f : E.fromFen(f).position;
  before.forEach((fen, ply) => fl.update(pos(fen), ply));
  fl.rewind(k);
  after.forEach((fen, i) => fl.update(pos(fen), k + 1 + i));
  const r = fl.whiteDownAt + ',' + fl.blackDownAt;
  if (E === W) fl.free();
  return r;
};
const takeback = (before, k, after) => {
  takebacks++;
  const fresh = flagsOf(A, [...before.slice(0, k + 1), ...after]);
  for (const [name, E] of [['testsAfter', A], ['clock rule', B], ['wasm', W]]) {
    if (!E) continue;
    const r = rewound(E, before, k, after);
    if (r !== fresh) problem(`takeback (${name}): ${r} against ${fresh}, back to ${k} in ${before.join(' | ')} then ${after.join(' | ')}`);
  }
};
const epOf = fen => fen.split(' ')[3] !== '-';
for (const fen of fens) {                       // one move taken back, every other one played
  const s = A.fromFen(fen);
  if (s.error || !(A.inCheck(s.position) || epOf(fen))) continue;
  const moves = A.legalMoves(s.position);
  if (moves.length < 2) continue;
  const after = m => A.toFen(A.makeMove(s.position, new A.Position(s.position.castlingFiles), m.from, m.to));
  const before = [fen, after(moves[0])];
  for (const m of moves.slice(1)) takeback(before, 0, play(after(m), (ms, k, n) => ms[(3 * k + n) % ms.length], 2));
}
seed = 5;
for (let i = 0; i < GAMES / 2; i++) {           // games, a rewind to a ply of interest
  const before = play(fens[rand(fens.length)], ms => ms[rand(ms.length)], 60);
  if (before.length < 3) continue;
  const at = before.map((f, k) => k).filter(k => k < before.length - 1 && (epOf(before[k]) || A.inCheck(A.fromFen(before[k]).position)));
  const k = at.length ? at[rand(at.length)] : rand(before.length - 1);
  takeback(before, k, play(before[k], ms => ms[rand(ms.length)], 12).slice(1));
}

const show = ([a, b]) => `material ${a.material} against ${b.material}, lock ${a.lock} against ${b.lock}`;
console.log(`asked, testsAfter against the clock rule: positions ${show(askedPositions)}; games ${show(askedInGames)}`);
console.log(`${positions} positions, ${games} games (${plies} plies, ${down} with a flag down), ${takebacks} takebacks${W ? '' : ' (no wasm)'}: ${problems} problems`);
process.exit(problems ? 1 : 0);
