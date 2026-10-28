'use strict';
/* The second version's rules, held to what they were measured to do.
   - data/second_version.tsv: the 36 Lichess timeouts that the first version leaves unproven. The
     ladder must prove each one as the file says (lock-open-pair, lock-boxed, domino-deep), with the
     same node count, and leave the 6 cages unproven; the first version's detector
     (_internal.coreLockTest) must prove none of the locks, and a ladder without the second tier
     (deepBudget 0) none of the domino-deep rows.
   - A few positions of each rule, with the answer for both sides, and the certificate's shape
     (lockSets: families for an open pair; boxed, the pieces no enemy king or bishop reaches,
     for knights, rooks and queens).
   - Where the second tier is allowed: never after a mate, after a budget failure, after a horizon
     failure only with no knight, rook or queen and a king shut in.
     node second_version_check.js        (ENGINE: the engine, default ../mateless.js) */
const fs = require('fs'), path = require('path');
const E = require(path.resolve(__dirname, process.env.ENGINE || '../mateless.js')), I = E._internal;
let problems = 0;
const problem = m => { problems++; if (problems <= 20) console.log('PROBLEM', m); };

// 1. The 36 rows.
const rows = fs.readFileSync(path.join(__dirname, '..', 'data', 'second_version.tsv'), 'utf8').trim().split('\n').slice(1);
const kinds = {};
for (const line of rows) {
  const [id, , want, nodes, fen] = line.split('\t');
  const p = E.fromFen(fen).position, fl = p.side;
  kinds[want] = (kinds[want] || 0) + 1;
  const proof = E.proveCannotBeMated(p, fl), lock = E.lockCannotMate(p, fl), sets = I.lockSets(p, fl);
  const got = lock ? (sets.families ? 'lock-open-pair' : sets.boxed ? 'lock-boxed' : 'lock')
    : proof.proven ? (proof.deep ? 'domino-deep' : 'domino') : 'unproven';
  if (got !== want) problem(`${id}: ${got}, the file says ${want}`);
  if (!lock && proof.nodes !== +nodes) problem(`${id}: ${proof.nodes} nodes, the file says ${nodes}`);
  if (I.coreLockTest(p, fl)) problem(`${id}: the first version's detector proves it`);
  if (want === 'domino-deep' && E.proveCannotBeMated(p, fl, { deepBudget: 0 }).proven) problem(`${id}: proven without the second tier`);
}

// 2. Positions of each rule: [fen, white cannot be mated, black cannot be mated, certificate kind for each proven side].
const CASES = [
  // an open pair on the h-file (19dcoW9q, ply 64): dead, seen only by the open-pair rule
  ['8/4k1p1/1p2p1Pp/1p1pPp2/1P1P1P1P/4K3/8/8 w - - 0 33', true, true, 'families'],
  // the same with the h-pawn pushed: an ordinary lock
  ['8/4k1p1/1p2p1PP/1p1pPp2/1P1P1P2/4K3/8/8 b - - 0 33', false, false, null],
  // hPiwD75i: a knight boxed in on b8 by its own pawns (the white bishop reaches it, so it is no
  // wall: it may be taken, and until then it stands still)
  ['1n6/2Bp4/p1pPp1k1/PpP1Pp1p/1P3P1P/2K5/8/8 w - - 7 53', true, true, 'boxed'],
  // the knight's pawn on c6 gone: the knight is free
  ['1n6/2Bp4/p2Pp1k1/PpP1Pp1p/1P3P1P/2K5/8/8 w - - 7 53', false, false, null],
  // a rook in the corner, boxed in by its own pawn and a knight that is boxed in too
  ['4k3/8/8/1p3p1p/1P1p1P1P/3PpP1P/1K2P2P/6NR b - - 0 1', true, true, 'walls'],
  // the same rook without the knight: an empty square beside it
  ['4k3/8/8/1p3p1p/1P1p1P1P/3PpP1P/1K2P2P/7R b - - 0 1', false, false, null],
];
for (const [fen, w, b, kind] of CASES) {
  const s = E.fromFen(fen); if (s.error) { problem('bad FEN ' + fen); continue; }
  const p = s.position;
  for (const [side, want] of [[E.WHITE, w], [E.BLACK, b]]) {
    const got = E.lockCannotMate(p, side);
    if (got !== want) { problem(`${fen} ${side === E.WHITE ? 'White' : 'Black'}: ${got}, want ${want}`); continue; }
    if (!got) continue;
    const c = I.lockSets(p, side);
    if (kind === 'families' && !c.families) problem(`${fen}: no families in the certificate`);
    if ((kind === 'boxed' || kind === 'walls') && !c.boxed) problem(`${fen}: no boxed pieces in the certificate`);
    if (kind === 'walls' && !(c.boxed[0] | c.boxed[1])) problem(`${fen}: no boxed piece is a wall`);
    if (I.coreLockTest(p, side)) problem(`${fen}: the first version proves it too`);
  }
}

// 3. When the second tier runs.
const deepRan = fen => E.proveCannotBeMated(E.fromFen(fen).position, E.fromFen(fen).position.side).deep;
if (deepRan('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')) problem('the second tier ran at the start position');
if (deepRan('8/8/4k3/8/3PK3/8/8/8 w - - 0 1')) problem('the second tier ran in an open king and pawn ending');
if (!deepRan('8/p1p5/6k1/8/8/6p1/P5Pp/7K w - - 0 44')) problem('the second tier did not run with a king shut in (w1GmdvNK)');
if (!deepRan('8/7p/6k1/7P/8/1q6/2q5/K7 b - - 0 47')) problem('the second tier did not run after a budget failure (WPNvLYdo)');

console.log(`${rows.length} rows (${Object.entries(kinds).map(([k, n]) => n + ' ' + k).join(', ')}), ${CASES.length} positions: ${problems} problems`);
process.exit(problems ? 1 : 0);
