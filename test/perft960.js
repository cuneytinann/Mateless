'use strict';
/* Chess960 move generation against python-chess: perft 3 of the positions perft_python.py writes
   (Chess960 starts and random middlegames from them, as Shredder-FEN), against the engine's perft.
     python3 perft_python.py > cases.json && node perft960.js cases.json        (pip install chess) */
const E = require(process.env.ENGINE || '../mateless.js'), fs = require('fs');
const cases = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
let problems = 0;
for (const [fen, want] of cases) {
  const r = E.fromFen(fen);
  if (r.error) { problems++; console.log('FEN error', fen, r.error); continue; }
  const got = E.perft(r.position, 3);
  if (got !== want) { problems++; console.log('MISMATCH', fen, 'engine', got, 'python-chess', want); }
}
console.log(`${cases.length} positions, perft 3 against python-chess: ${problems} problems`);
