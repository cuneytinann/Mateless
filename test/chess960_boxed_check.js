'use strict';
/* Castling never moves a boxed rook, in Chess960 too. A rook counts as boxed in the lock detector
   only when every square it could step to holds one of its own men that never moves: a fixed pawn,
   another boxed piece, a still bishop, or its king, but the king only when frozen, with no castling
   right left for its side, and not where a castle leaves it beside its rook (g1 and f1, c1 and d1;
   g8, f8, c8, d8). A castling rook needs the square beside it towards its king or its destination
   empty or holding the king, so a rook boxed in by other men can never castle; one walled in with
   its king can, which is why the king counts only without a castling right. Here every castling
   layout of Chess960 (king on the b- to g-file, the castling rook on any other file of the first
   rank, both colours) with every way of filling the rest of the rank with the side's own knights,
   a pawn above the rook: the engine's own move generator says whether the rook castles. Expected:
   no castling move from a rook whose neighbours on the rank are all its own men; and some from a
   rook walled in by its pawn and its own king (the rook that looks boxed and is not).
   Then that rook in a whole position, on each wing, where the castling right decides whether it is
   dead:
     8/8/8/4k3/p1p5/P1Pp1p1p/3PpP1P/2B1B1KR w - - 0 1   dead: none of the positions it can reach
                                                         is a mate (no capture, no pawn move);
     8/8/8/4k3/p1p5/P1Pp1p1p/3PpP1P/2B1B1KR w K - 0 1   (Chess960, start 442, RNNQBBKR) not dead:
       1.O-O exf1=N 2.Bb2 Ne3 3.dxe3 d2 4.Kh1 dxe1=Q#;
     8/8/8/4k3/p1p3p1/PpPp1pP1/1P1PpP2/BRK1B1B1 w - - 0 1   the queenside twin, dead;
     8/8/8/4k3/p1p3p1/PpPp1pP1/1P1PpP2/BRK1B1B1 w Q - 0 1   not dead: 1.O-O-O Ke4 2.Kb1 exd1=Q#.
   The engine must never prove the positions with the right: no static test, no search, not the
   dead-position test. It may some day prove the ones without it (that would be right); it does
   not today.
   Last, a castle asks no static test (testsAfter), so it may never complete a lock: in Chess960 it
   can leave a frozen king between its rooks (4bkrr/1p1p1p1p/1P1P1P1P/8/8/8/8/K7 b g: after the
   castle, 4brkr; on the queenside, the composed brrkb3/1p1p1p1p/1P1P1P1P/8/8/4K3/8/8 b c: brkrb3). After each, the lock
   detector may prove no side the position before it did not.
     node chess960_boxed_check.js        (ENGINE: the engine, default ../mateless.js) */
const path = require('path');
const E = require(path.resolve(__dirname, process.env.ENGINE || '../mateless.js'));
let layouts = 0, castling = 0, boxed = 0, boxedCastles = 0, byKing = 0, byKingCastles = 0;
const row = cells => { let s = '', e = 0; for (const c of cells) { if (!c) { e++; continue; } if (e) { s += e; e = 0; } s += c; } return s + (e || ''); };
for (const colour of ['w', 'b']) for (let kf = 1; kf <= 6; kf++) for (let rf = 0; rf < 8; rf++) {
  if (rf === kf) continue;
  const others = [0, 1, 2, 3, 4, 5, 6, 7].filter(f => f !== kf && f !== rf);
  for (let mask = 0; mask < 1 << others.length; mask++) {
    const back = Array(8).fill(''), above = Array(8).fill('');
    back[kf] = 'K'; back[rf] = 'R'; above[rf] = 'P';
    others.forEach((f, i) => { if (mask >> i & 1) back[f] = 'N'; });
    let ranks = ['k7', '8', '8', '8', '8', '8', row(above), row(back)];
    if (colour === 'b') ranks = ranks.slice().reverse().map(r => r.replace(/[A-Za-z]/g, c => c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase()));
    const s = E.fromFen(ranks.join('/') + ' ' + colour + ' ' + (colour === 'w' ? 'ABCDEFGH' : 'abcdefgh')[rf] + ' - 0 1');
    if (s.error) continue;
    layouts++;
    const rookSq = (colour === 'w' ? 0 : 56) + rf;
    const castles = E.legalMoves(s.position).some(m => m.castle && m.to === rookSq);
    if (castles) castling++;
    const beside = [rf - 1, rf + 1].filter(f => f >= 0 && f < 8);
    if (beside.every(f => back[f] === 'N')) { boxed++; if (castles) boxedCastles++; }
    else if (beside.every(f => back[f] === 'N' || back[f] === 'K')) { byKing++; if (castles) byKingCastles++; }
  }
}
let problems = (boxedCastles ? 1 : 0) + (castling && byKingCastles ? 0 : 1);
console.log(`${layouts} layouts, ${castling} with a castling move; rook walled in by its own men: ${boxed}, castling ${boxedCastles}; ` +
            `walled in with its king: ${byKing}, castling ${byKingCastles}`);

// The whole position, on each wing, without and with the castling right.
const problem = text => { problems++; console.log('PROBLEM ' + text); };
const WINGS = [
  ['8/8/8/4k3/p1p5/P1Pp1p1p/3PpP1P/2B1B1KR w - - 0 1', '8/8/8/4k3/p1p5/P1Pp1p1p/3PpP1P/2B1B1KR w K - 0 1',
   ['g1h1', 'e2f1n', 'c1b2', 'f1e3', 'd2e3', 'd3d2', 'g1h1', 'd2e1q'], 'kingside'],
  ['8/8/8/4k3/p1p3p1/PpPp1pP1/1P1PpP2/BRK1B1B1 w - - 0 1', '8/8/8/4k3/p1p3p1/PpPp1pP1/1P1PpP2/BRK1B1B1 w Q - 0 1',
   ['c1b1', 'e5e4', 'c1b1', 'e2d1q'], 'queenside'],
];
const report = [];
for (const [dead, live, line, wing] of WINGS) {
  // without the right: every position it can reach (the side to move, castling and en passant
  // included in the code), none a mate
  const start = E.fromFen(dead).position, code = p => E.toFen(p).split(' ').slice(0, 4).join(' ');
  if (E.legalMoves(start).some(m => m.castle)) problem(wing + ': a castling move without the castling right');
  const seen = new Set([code(start)]), todo = [start];
  let mates = 0, irreversible = 0;
  while (todo.length) {
    const p = todo.pop(), moves = E.legalMoves(p);
    if (!moves.length && E.inCheck(p)) mates++;
    for (const m of moves) {
      if (p.board[m.to] || (p.board[m.from] & 7) === E.PAWN) irreversible++;
      const q = p.clone(); E.makeMove(p, q, m.from, m.to, E.QUEEN);
      const k = code(q); if (!seen.has(k)) { seen.add(k); todo.push(q); }
    }
  }
  if (mates || irreversible) problem(`${wing}: without the castling right ${mates} mates and ${irreversible} captures or pawn moves`);
  // with it: the mate, and nothing that claims White can never be mated
  const g = new E.Game(E.fromFen(live).position);
  let status = 0;
  for (const u of line)
    status = g.play(E.parseSquare(u.slice(0, 2)), E.parseSquare(u.slice(2, 4)), u[4] === 'n' ? E.KNIGHT : E.QUEEN);
  if (status !== E.Result.BLACK_MATES) problem(wing + ': the mate with the castling right does not end in mate');
  const p = E.fromFen(live).position;
  const claims = [E.cannotMate(p, E.WHITE), E.proveCannotBeMated(p, E.WHITE).proven,
                  E.proveCannotBeMated(p, E.WHITE, { maxPly: 9, budget: 200000 }).proven,
                  E.proveBoth(p)[0].proven, E.isDeadPosition(p)];
  if (claims.some(Boolean)) problem(`${wing}: with the castling right White is claimed never to be mated: ` + claims.join(','));
  report.push(`${wing}, without the right: ${seen.size} positions reachable, no mate, ` +
              `${E.isDeadPosition(start) ? 'proven dead' : 'not proven dead'}; with it: a mate in ${line.length / 2}, never claimed`);
}
console.log('the rook beside its king: ' + report.join('; '));

// A castle completes no lock: after it, the lock detector proves no side the position before did not.
const CASTLES = [['4bkrr/1p1p1p1p/1P1P1P1P/8/8/8/8/K7 b g - 0 1', 'f8', 'g8'],
                 ['brrkb3/1p1p1p1p/1P1P1P1P/8/8/4K3/8/8 b c - 0 1', 'd8', 'c8']];   // composed: two light bishops
for (const [fen, king, rook] of CASTLES) {
  const p = E.fromFen(fen, { strict: false }).position, from = E.parseSquare(king), to = E.parseSquare(rook);
  if (!E.legalMoves(p).some(m => m.castle && m.from === from && m.to === to)) { problem('no castle ' + king + rook + ' in ' + fen); continue; }
  const q = p.clone(); E.makeMove(p, q, from, to, E.QUEEN);
  for (const side of [E.WHITE, E.BLACK])
    if (E.lockCannotMate(q, side) && !E.lockCannotMate(p, side)) problem('a castle completes a lock: ' + fen + ' -> ' + E.toFen(q));
}
console.log(`a castle that leaves its king frozen beside its rook: ${CASTLES.length} positions, no lock after it: ${problems} problems`);
process.exitCode = problems ? 1 : 0;
