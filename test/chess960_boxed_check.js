'use strict';
/* Castling never moves a boxed rook, in Chess960 too. A rook counts as boxed in the lock detector
   only when its own pawns, knights, rooks or queens hold every square it could step to; its king
   never counts as a wall. A castling rook needs the square beside it towards its king or its
   destination empty or holding the king, so a boxed rook can never castle. Here every castling
   layout of Chess960 (king on the b- to g-file, the castling rook on any other file of the first
   rank, both colours) with every way of filling the rest of the rank with the side's own knights,
   a pawn above the rook: the engine's own move generator says whether the rook castles. Expected:
   no castling move from a rook whose neighbours on the rank are all its own men; and some from a
   rook walled in by its pawn and its own king (the rook that looks boxed and is not).
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
const problems = (boxedCastles ? 1 : 0) + (castling && byKingCastles ? 0 : 1);
console.log(`${layouts} layouts, ${castling} with a castling move; rook walled in by its own men: ${boxed}, castling ${boxedCastles}; ` +
            `walled in with its king: ${byKing}, castling ${byKingCastles}: ${problems} problems`);
process.exitCode = problems ? 1 : 0;
