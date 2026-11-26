'use strict';
/* The second version's rules, held to what they were measured to do.
   - data/second_version.tsv: the 36 Lichess timeouts that the first version leaves unproven. The
     ladder must prove each one as the file says (lock, lock-open-pair, lock-boxed, lock-stuck,
     lock-forced, domino, domino-deep: by the second tier, domino-third: by the third), with the
     same node count, and leave the cage left unproven (RwnQJq1k, which only the 75-move rule
     proves); the first version's detector (_internal.coreLockTest) must prove none of the locks, a
     ladder without the further tiers (deepBudget 0) none of the domino-deep rows, and one without
     the third (thirdBudget 0) none of the domino-third rows.
   - A few positions of each rule, with the answer for both sides, and the certificate's shape
     (lockSets: families for an open pair; boxed, the pieces no enemy king or bishop reaches,
     for knights, rooks and queens; stuck for the stuck mater; forced for the forced step).
   - When the further tiers run: after every failure of the tier before but a mate.
     node second_version_check.js        (ENGINE: the engine, default ../mateless.js) */
const fs = require('fs'), path = require('path');
const E = require(path.resolve(__dirname, process.env.ENGINE || '../mateless.js')), I = E._internal;
const LOOSE = { strict: false };   // the rows are composed positions: read without the reachability checks
let problems = 0;
const problem = m => { problems++; if (problems <= 20) console.log('PROBLEM', m); };

// 1. The 36 rows.
const rows = fs.readFileSync(path.join(__dirname, '..', 'data', 'second_version.tsv'), 'utf8').trim().split('\n').slice(1);
const kinds = {};
for (const line of rows) {
  const [id, , want, nodes, fen] = line.split('\t');
  const p = E.fromFen(fen, LOOSE).position, fl = p.side;
  kinds[want] = (kinds[want] || 0) + 1;
  const proof = E.proveCannotBeMated(p, fl), lock = E.lockCannotMate(p, fl), sets = I.lockSets(p, fl);
  const got = lock ? (sets.families ? 'lock-open-pair' : sets.boxed ? 'lock-boxed' : sets.stuck ? 'lock-stuck' : sets.forced ? 'lock-forced' : 'lock')
    : proof.proven ? (proof.deep === 2 ? 'domino-third' : proof.deep ? 'domino-deep' : 'domino') : 'unproven';
  if (got !== want) problem(`${id}: ${got}, the file says ${want}`);
  if (!lock && proof.nodes !== +nodes) problem(`${id}: ${proof.nodes} nodes, the file says ${nodes}`);
  if (I.coreLockTest(p, fl)) problem(`${id}: the first version's detector proves it`);
  if ((want === 'domino-deep' || want === 'domino-third') && E.proveCannotBeMated(p, fl, { deepBudget: 0 }).proven) problem(`${id}: proven without the further tiers`);
  if (want === 'domino-third' && E.proveCannotBeMated(p, fl, { thirdBudget: 0 }).proven) problem(`${id}: proven without the third tier`);
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
  // the stalemate guard (f6c1lu7R): Black's king takes g2 only with White's king on h4, and White is stalemated
  ['8/8/7p/5p1P/5p1K/5Pp1/6P1/1k6 w - - 70 83', true, true, 'levels'],
  // without the h6 pawn the white king walks out: no guard holds
  ['8/8/8/5p1P/5p1K/5Pp1/6P1/1k6 w - - 70 83', false, false, null],
  // the check seed: White's king must step out of g5's check, to e3, f3 or g3, and never comes back
  ['8/8/5k2/p2p2p1/P2P1KP1/8/8/8 w - - 0 51', true, true, 'levels'],
  // no check and an open d-pawn to take: nothing to seed
  ['8/8/5k2/p2p4/P2P1K2/8/8/8 w - - 0 51', false, false, null],
  // the stuck mater (kJOYLcJ5): whatever Black plays, White has no move
  ['8/7p/5p1P/5kpK/6P1/8/8/8 b - - 0 48', false, true, 'stuck'],
  // White's a-pawn moves: no stuck mater
  ['8/7p/5p1P/5kpK/6P1/8/P7/8 b - - 0 48', false, false, null],
  // the forced step: Kh1 is White's only move, then the king is frozen there
  ['8/8/8/8/8/6p1/4k1Pp/6K1 w - - 0 64', true, true, 'forced'],
  // with Black's king away, White has Kf1 too: no forced step
  ['8/8/8/8/8/6p1/k5Pp/6K1 w - - 0 64', false, false, null],
  // twin bishops (chasolver's positions.txt, dead): Black's four bishops, two on each colour, behind a lock;
  // the first version refuses any twins
  ['k3b1b1/Pp1b1b1p/1Pb1p1pP/1p1pP1P1/1P1P4/8/8/4K3 w - - 0 1', true, true, 'levels'],
  // Black's twins on dark may hold both flights of a8 (a7 and b8) while White's light bishop checks from
  // c6: a mate (chasolver, 23 plies), so no lock for Black; White, whom Black cannot mate, is proven
  ['5k2/2b4B/1p3b2/pPp1p1p1/P1P1P1P1/7K/8/8 w - - 0 1', true, false, 'levels'],
];
for (const [fen, w, b, kind] of CASES) {
  const s = E.fromFen(fen, LOOSE); if (s.error) { problem('bad FEN ' + fen); continue; }
  const p = s.position;
  for (const [side, want] of [[E.WHITE, w], [E.BLACK, b]]) {
    const got = E.lockCannotMate(p, side);
    if (got !== want) { problem(`${fen} ${side === E.WHITE ? 'White' : 'Black'}: ${got}, want ${want}`); continue; }
    if (!got) continue;
    const c = I.lockSets(p, side);
    if (kind === 'families' && !c.families) problem(`${fen}: no families in the certificate`);
    if ((kind === 'boxed' || kind === 'walls') && !c.boxed) problem(`${fen}: no boxed pieces in the certificate`);
    if (kind === 'walls' && !(c.boxed[0] | c.boxed[1])) problem(`${fen}: no boxed piece is a wall`);
    if (kind === 'stuck' && !c.stuck) problem(`${fen}: the certificate is not the stuck mater's`);
    if (kind === 'forced' && !c.forced) problem(`${fen}: the certificate is not the forced step's`);
    if (kind === 'levels' && (c.stuck || c.forced || c.families || c.boxed)) problem(`${fen}: the certificate is not the levels'`);
    if (I.coreLockTest(p, side)) problem(`${fen}: the first version proves it too`);
  }
}

// 3. When the further tiers run: after every failure of the tier before but a mate.
const proofOf = (fen, o) => { const p = E.fromFen(fen, LOOSE).position; return E.proveCannotBeMated(p, p.side, o); };
const tiers = (fen, o) => { const r = proofOf(fen, o); return r.deep + ' ' + (r.proven ? 'proven' : r.failure); };
const want3 = (fen, o, want, what) => { const got = tiers(fen, o); if (got !== want) problem(`${what}: ${got}, want ${want}`); };
// a mate in the first tier: no further tier
want3('8/8/8/3k4/5qK1/8/7p/8 w - - 4 1', undefined, '0 mate', 'a mate found by the first tier');
// the start position: the first two tiers fail on their horizons, the third finds the mate
want3('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', undefined, '2 mate', 'the start position');
want3('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', { thirdBudget: 0 }, '1 horizon', 'the start position without the third tier');
// a lock: the static tests, no search
want3('8/8/4k3/8/3PK3/8/8/8 w - - 0 1', undefined, '0 proven', 'an ending the static tests settle');
// a budget failure (WPNvLYdo): the second tier proves it
want3('8/7p/6k1/7P/8/1q6/2q5/K7 b - - 0 47', undefined, '1 proven', 'WPNvLYdo');
// bKHPqNEw: the third tier proves it; RwnQJq1k: only the 75-move rule, after the third tier
want3('1k6/1P5p/BP3p2/1P6/8/8/5PKP/8 b - - 0 41', undefined, '2 proven', 'bKHPqNEw');
want3('8/7p/5p1P/5p1K/5Pp1/6P1/b3k3/8 w - - 11 51', undefined, '2 horizon', 'RwnQJq1k');
const rw = proofOf('8/7p/5p1P/5p1K/5Pp1/6P1/b3k3/8 w - - 11 51', { moveRule: 150 });
if (!(rw.proven && rw.ruled)) problem('RwnQJq1k is not proven under the 75-move rule');
if (proofOf('8/7p/5p1P/5p1K/5Pp1/6P1/b3k3/8 w - - 11 51', { moveRule: 150, thirdBudget: 0 }).proven) problem('RwnQJq1k proven under the rule without the third tier');

console.log(`${rows.length} rows (${Object.entries(kinds).map(([k, n]) => n + ' ' + k).join(', ')}), ${CASES.length} positions: ${problems} problems`);
process.exit(problems ? 1 : 0);
