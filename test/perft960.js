'use strict';
/* Chess960 move generation against python-chess, from the JSON lines perft_python.py writes:
   perft 3 of the 960 starting positions and of 40 random middlegames, and the legal moves of
   every position of thousands of random Chess960 games, many of them keeping their castling
   rights long (castling is the king onto its own rook). With the WebAssembly build
   (../mateless.wasm, the Rust code) also its perft: 3 at every start against python-chess, 2 at
   every fourth position with a castling move against the engine.
     python3 perft_python.py | node perft960.js -          (or a file instead of -; pip install chess)
   ENGINE: the engine (default ../mateless.js); WASM=0: without the WebAssembly build. */
const fs = require('fs'), path = require('path'), readline = require('readline');
const E = require(path.resolve(__dirname, process.env.ENGINE || '../mateless.js'));
const wasmFile = path.join(__dirname, '..', 'mateless.wasm');
const W = process.env.WASM !== '0' && fs.existsSync(wasmFile)
  ? require(path.join(__dirname, '..', 'mateless-wasm.js')).instantiate(fs.readFileSync(wasmFile)) : null;
const input = process.argv[2] && process.argv[2] !== '-' ? fs.createReadStream(process.argv[2]) : process.stdin;

let problems = 0, perfts = 0, starts = 0, positions = 0, withCastle = 0, castles = 0, wasmStarts = 0, wasmPerfts = 0, every = 0;
const problem = text => { problems++; if (problems <= 10) console.log('PROBLEM ' + text); };
const wasmPerft = (fen, depth) => { const q = W.fromFen(fen).position; try { return W.perft(q, depth); } finally { q.free(); } };

readline.createInterface({ input, crlfDelay: Infinity }).on('line', text => {
  if (!text) return;
  const r = JSON.parse(text);
  if (r[0] === 'perft' || r[0] === 'start') {
    const fen = r[0] === 'perft' ? r[1] : r[2], want = r[0] === 'perft' ? r[2] : r[3], s = E.fromFen(fen);
    if (s.error) return problem(`FEN error ${fen}: ${s.error}`);
    const got = E.perft(s.position, 3);
    if (got !== want) problem(`perft 3 of ${fen}: engine ${got}, python-chess ${want}`);
    if (r[0] === 'perft') perfts++; else starts++;
    if (W && r[0] === 'start') {
      wasmStarts++;
      const w = wasmPerft(fen, 3);
      if (w !== want) problem(`perft 3 of ${fen}: WebAssembly ${w}, python-chess ${want}`);
    }
    return;
  }
  const [, fen, want] = r, s = E.fromFen(fen);
  if (s.error) return problem(`FEN error ${fen}: ${s.error}`);
  const list = [];
  let castle = false;
  for (const m of E.legalMoves(s.position)) {
    const u = E.squareName(m.from) + E.squareName(m.to);
    if (m.promotion) for (const c of 'qrbn') list.push(u + c); else list.push(u);
    if (m.castle) { castle = true; castles++; }
  }
  list.sort();
  positions++;
  if (castle) withCastle++;
  if (list.join(' ') !== want) problem(`legal moves of ${fen}\n  engine       ${list.join(' ')}\n  python-chess ${want}`);
  if (W && castle && (every++ & 3) === 0) {
    wasmPerfts++;
    const a = E.perft(s.position, 2), b = wasmPerft(fen, 2);
    if (a !== b) problem(`perft 2 of ${fen}: engine ${a}, WebAssembly ${b}`);
  }
}).on('close', () => {
  console.log(`perft 3 of ${starts} starts and ${perfts} middlegames; legal moves of ${positions} positions of random games ` +
              `(${withCastle} with a castling move, ${castles} castling moves)` +
              (W ? `; WebAssembly: perft 3 of ${wasmStarts} starts, perft 2 of ${wasmPerfts} positions with a castling move` : '') +
              `: ${problems} problems`);
  process.exitCode = problems ? 1 : 0;
});
