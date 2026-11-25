'use strict';
/* fromFen, the outer layer every position from outside comes in through (src/fen.js):
     hand cases   every error and every repair, with what they give; double checks a single move
                  can give (accepted) and those none can (refused); the same in mateless.wasm
     -            python-chess's references on stdin (fen_python.py): every position of random
                  games, standard and Chess960, check-heavy, with the special checks (double,
                  castling, en passant, promotion), must be read as it is (nothing refused,
                  nothing put right, the same FEN back, also with the traditional en passant
                  square); every random board python-chess finds invalid must be refused
   Usage: node fen_check.js                       the hand cases
          python3 fen_python.py | node fen_check.js -   and the references (about a minute)
   (env ENGINE, default ../mateless.js) */
const fs = require('fs'), path = require('path');
const E = require(path.resolve(__dirname, process.env.ENGINE || '../mateless.js'));
const W = fs.existsSync(path.join(__dirname, '..', 'mateless.wasm'))
  ? require('../mateless-wasm.js').instantiate(fs.readFileSync(path.join(__dirname, '..', 'mateless.wasm'))) : null;

let problems = 0;
const problem = m => { problems++; if (problems <= 30) console.log('PROBLEM', m); };

// [fen, expected]: an error code, or [fixed, the FEN given back]; strict: false where marked.
const CASES = [
  // syntax, kings, edge ranks, the side not to move in check (all readings)
  ['x', 'syntax'],
  ['8/8/8/8/8/8/8 w - - 0 1', 'syntax'],
  ['k7/8/8/8/8/8/8/K7 x - - 0 1', 'syntax'],
  ['k7/8/8/8/8/8/8/K7 w KX - 0 1', 'syntax'],
  ['k7/8/8/8/8/8/8/K7 w - e9 0 1', 'syntax'],
  ['k7/8/8/8/8/8/8/K7 w - - a 1', 'syntax'],
  ['8/8/8/8/8/8/8/K7 w - - 0 1', 'kings'],
  ['kk6/8/8/8/8/8/8/K7 w - - 0 1', 'kings'],
  ['k6P/8/8/8/8/8/8/K7 w - - 0 1', 'pawnrank'],
  ['k7/8/8/8/8/8/8/R6K w - - 0 1', 'oppcheck'],
  ['kK6/8/8/8/8/8/8/8 w - - 0 1', 'oppcheck'],                                   // kings side by side
  ['k7/8/8/8/8/8/8/R6K w - - 0 1', 'oppcheck', false],
  // material
  ['k7/8/8/8/P7/P7/PPPPPPPP/K7 w - - 0 1', 'pawns'],
  ['k7/8/8/8/8/NNNNNNNN/PPPPPPPP/K7 w - - 0 1', 'pieces'],
  ['k7/8/8/8/8/8/PPPPPPPP/QQK5 w - - 0 1', 'promo'],
  ['k7/8/8/8/8/8/PPPPPPPP/B1B1K3 w - - 0 1', 'promo'],                          // two bishops on dark squares
  ['k7/8/8/8/8/8/PPPPPPP1/B1B1K3 w - - 0 1', [[], 'k7/8/8/8/8/8/PPPPPPP1/B1B1K3 w - - 0 1']],   // one pawn promoted
  ['rnbqkbnr/pppppppp/8/8/8/P7/P1PPPPPP/RNBQKBNR w KQkq - 0 1', 'captures'],  // a3: a capture, Black has lost nothing
  ['r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', 'captures'],   // CPW position 4: 5 captures, 1 man lost
  ['r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', [[], 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1'], false],
  // checks no last move gives
  ['k7/2N5/1N6/8/8/8/8/K7 b - - 0 1', 'checks'],                                // two knights
  ['k7/2N5/1N6/8/8/8/8/R5K1 b - - 0 1', 'checks'],                              // three checks
  ['K7/8/8/8/8/1k6/2P5/8 b - - 0 1', 'checks'],                                 // a pawn checking from its starting rank
  ['8/6k1/8/8/8/n7/1B6/K1n5 b - - 0 1', 'checks'],                              // the bishop came from nowhere
  ['8/6k1/8/8/8/8/1B6/K1n5 b - - 0 1', [[], '8/6k1/8/8/8/8/1B6/K1n5 b - - 0 1']],    // it came from a3
  ['5R2/R4k2/8/8/8/8/PPPPPPPP/7K b - - 0 1', 'checks'],                         // two rooks: no pawn left to promote
  ['5R2/R4k2/8/8/8/8/PPPPPPP1/7K b - - 0 1', [[], '5R2/R4k2/8/8/8/8/PPPPPPP1/7K b - - 0 1']],   // e7xf8=R
  ['4k3/8/3N4/8/8/8/8/K3R3 b - - 12 30', [[], '4k3/8/3N4/8/8/8/8/K3R3 b - - 12 30']],   // Ne4-d6, discovered
  ['4R3/8/8/4k3/8/8/8/K3R3 b - - 0 1', 'checks'],                               // two rooks on one line through the king
  // what is put right
  ['k7/8/8/8/8/8/8/K7 w KQ - 0 1', [['castling'], 'k7/8/8/8/8/8/8/K7 w - - 0 1']],
  ['r3k3/8/8/8/8/8/8/R3K2R w KQkq - 0 1', [['castling'], 'r3k3/8/8/8/8/8/8/R3K2R w KQq - 0 1']],
  ['r3k2r/8/8/8/8/8/8/4K3 b kqK - 0 1', [['castling'], 'r3k2r/8/8/8/8/8/8/4K3 b kq - 0 1']],
  ['rk5r/8/8/8/8/8/8/RK5R w KQkq - 0 1', [[], 'rk5r/8/8/8/8/8/8/RK5R w HAha - 0 1']],   // Chess960: KQkq read as the outer rooks
  ['rk6/8/8/8/8/8/8/RK5R w HAha - 0 1', [['castling'], 'rk6/8/8/8/8/8/8/RK5R w HAa - 0 1']],
  ['k7/8/8/8/8/8/8/K7 w - e3 0 1', [['en passant'], 'k7/8/8/8/8/8/8/K7 w - - 0 1']],   // the wrong rank
  ['k7/4p3/8/4pP2/8/8/8/K7 w - e6 0 1', [['en passant'], 'k7/4p3/8/4pP2/8/8/8/K7 w - - 0 1']],   // e7 not left empty
  ['k7/8/8/4pP2/8/8/8/K7 w - e6 3 2', [['en passant', 'fullmove'], 'k7/8/8/4pP2/8/8/8/K7 w - - 3 3']],   // a clock above 0
  ['r3k3/8/8/2Pp4/8/8/8/K7 w - d6 0 2', [['en passant'], 'r3k3/8/8/2Pp4/8/8/8/K7 w - - 0 2']],   // d7-d5 cannot give the rook's check
  ['k7/8/8/4pP2/8/8/8/K7 w - e6 0 1', [[], 'k7/8/8/4pP2/8/8/8/K7 w - e6 0 1']],
  ['k7/8/8/4p3/8/8/8/K7 w - e6 0 1', [[], 'k7/8/8/4p3/8/8/8/K7 w - - 0 1']],   // right, but no capture onto it: not written
  ['k7/1P6/8/8/8/8/8/K7 b - - 9 2', [['halfmove'], 'k7/1P6/8/8/8/8/8/K7 b - - 0 2']],   // only b6-b7 or a capture gives it
  ['k7/1P6/8/8/8/8/8/K7 b - - 9 0', [['halfmove', 'fullmove'], 'k7/1P6/8/8/8/8/8/K7 b - - 0 1']],
  ['k7/8/8/8/8/8/8/K7 w - - 40 3', [['fullmove'], 'k7/8/8/8/8/8/8/K7 w - - 40 21']],
  ['k7/8/8/8/8/8/8/K7 b - - 41 3', [['fullmove'], 'k7/8/8/8/8/8/8/K7 b - - 41 21']],
  ['k7/8/8/8/8/8/8/K7 w - - 0 0', [['fullmove'], 'k7/8/8/8/8/8/8/K7 w - - 0 1']],
  ['k7/8/8/8/8/8/8/K7 w', [[], 'k7/8/8/8/8/8/8/K7 w - - 0 1']],
];

for (const [fen, want, strict = true] of CASES) {
  const r = E.fromFen(fen, { strict });
  const got = r.error ? r.error : [r.fixed, r.fen];
  if (JSON.stringify(got) !== JSON.stringify(want)) problem(`${fen} (strict ${strict}): ${JSON.stringify(got)}, not ${JSON.stringify(want)}`);
  if (W) {
    const w = W.fromFen(fen, { strict });
    const wgot = w.error ? w.error : w.fixed;
    if (JSON.stringify(wgot) !== JSON.stringify(r.error ? r.error : r.fixed)) problem(`${fen} (strict ${strict}): wasm ${JSON.stringify(wgot)}`);
    if (w.position) w.position.free();
  }
}
console.log(CASES.length + ' hand cases' + (W ? ' (and mateless.wasm)' : ''));

if (process.argv[2] === '-') {
  // python-chess: STATUS_BAD_CASTLING_RIGHTS and STATUS_INVALID_EP_SQUARE are put right, not refused;
  // the race statuses are not about legality.
  const IGNORED = (1 << 8) | (1 << 9) | (1 << 12) | (1 << 13) | (1 << 14);
  const SHREDDER = { K: 'H', Q: 'A', k: 'h', q: 'a' };
  const shredder = fen => {      // fromFen writes KQkq for the standard skeleton; python-chess HAha
    const f = fen.split(' ');
    if (/^[KQkq]+$/.test(f[2])) f[2] = f[2].replace(/[KQkq]/g, c => SHREDDER[c]);
    return f.join(' ');
  };
  let legal = 0, refusedLegal = 0, status = 0, invalid = 0, missed = 0, more = 0;
  const tally = {};
  for (const line of fs.readFileSync(0, 'utf8').split('\n')) {
    if (!line) continue;
    const c = line.split('\t');
    if (c[0] === 'legal') {
      legal++;
      for (const fen of [c[1], c[2]]) {
        const r = E.fromFen(fen);
        if (r.error || r.fixed.length || shredder(r.fen) !== c[1]) {
          refusedLegal++;
          problem(`legal ${fen}: ${r.error || (r.fixed.length ? 'fixed ' + r.fixed : 'read as ' + r.fen)}`);
        }
      }
    } else if (c[0] === 'status') {
      status++;
      const bad = (+c[2] & ~IGNORED) !== 0, r = E.fromFen(c[1]);
      if (bad) invalid++;
      if (bad && !r.error) { missed++; problem(`python-chess refuses ${c[1]} (status ${c[2]}), fromFen does not`); }
      if (!bad && r.error) { more++; tally[r.error] = (tally[r.error] || 0) + 1; }
    }
  }
  console.log(`${legal} positions of games (two FENs each): ${refusedLegal} not read as they are; ` +
              `${status} random boards: ${invalid} invalid for python-chess, ${missed} of them let in; ` +
              `${more} more refused here (${Object.entries(tally).map(([k, v]) => k + ' ' + v).join(', ') || 'none'})`);
}
console.log(problems ? problems + ' problems' : '0 problems');
process.exitCode = problems ? 1 : 0;
