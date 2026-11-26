/* Mateless · builder.js — makes the engine package the Download tab offers (and test/package_check.js
   checks): one version of the engine (fast or full) in one language (JavaScript, Rust or
   WebAssembly), the whole engine unchanged, with a settings file for a platform's own rules, a
   README, the licence, a self-test and SHA256SUMS, as a .zip.

   The engine is never cut down: the choices go into the settings file (the options of a Game: how
   much of the ladder runs, when the Domino search runs, the move and repetition rules), so every
   package runs the code that is tested, and JavaScript, Rust and WebAssembly give the same answers.

     MatelessBuilder.build(choice, sources, E) → Promise<{ name, files: [[path, string | Uint8Array]] }>
     MatelessBuilder.zip(files) → Uint8Array (a .zip, stored)
   choice: { lang: 'js' | 'rust' | 'wasm', version: 'fast' | 'full', rungs: 1 | 2 | 3,
             dominoAtEnd: boolean, moves: 'a' | 'b' | 'c', repetition: 'a' | 'b' | 'c' }
   sources: the files of that version (see build-site.js: engine, dts, wasmJs, wasm, rust, license)
   E: that version's engine (mateless.js), which computes the self-test's expected answers. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MatelessBuilder = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
'use strict';

/* ─── the choices ───────────────────────────────────────────────────────────────────────────── */

/* The move and repetition rules: a FIDE's (a claim, then the automatic end), b the automatic end
   at the claim's threshold, c no claim. */
const MOVES = { a: { moveRule: 150, claimMoves: 100 }, b: { moveRule: 100, claimMoves: 0 }, c: { moveRule: 150, claimMoves: 0 } };
const REPS = { a: { repetition: 5, claimRepetition: 3 }, b: { repetition: 3, claimRepetition: 0 }, c: { repetition: 5, claimRepetition: 0 } };

function check(c) {
  if (!['js', 'rust', 'wasm'].includes(c.lang)) throw new Error('lang: js, rust or wasm');
  if (!['fast', 'full'].includes(c.version)) throw new Error('version: fast or full');
  if (![1, 2, 3].includes(c.rungs)) throw new Error('rungs: 1, 2 or 3');
  if (!MOVES[c.moves] || !REPS[c.repetition]) throw new Error('moves, repetition: a, b or c');
}

/** The options of a Game for a choice. */
function gameOptions(c) {
  return Object.assign({}, MOVES[c.moves], REPS[c.repetition], { rungs: c.rungs, dominoAtEnd: c.rungs === 3 && !!c.dominoAtEnd });
}

const LANG = { js: 'JavaScript', rust: 'Rust', wasm: 'WebAssembly' };
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/* ─── the self-test ─────────────────────────────────────────────────────────────────────────── */

/* Positions and games whose answers the package must give, computed here with the same engine (and
   the same settings) in JavaScript; in Rust and WebAssembly they check the port too. */
const POSITIONS = [
  ['a lock (Lichess yCnBCwGd)', '8/8/4k3/3p2p1/1p1P1pP1/1P3P2/8/3K4 b - - 0 92'],
  ['insufficient material', '8/8/8/4k3/8/8/2N5/4K3 b - - 0 60'],
  ['a forced capture, then bare kings', '8/8/8/8/6qK/8/5k2/8 w - - 2 63'],
  ['a stuck mater (full version)', '8/8/5k1p/3b1p1P/3n1PpK/6P1/8/8 b - - 0 38'],
  ['the start position', START],
];
const GAMES = [
  ['knights out and back, twice', START, 'g1f3 g8f6 f3g1 f6g8 g1f3 g8f6 f3g1 f6g8'],
  ['a rook ending near the 50-move rule', '8/8/8/4k3/8/8/8/R3K3 w - - 98 80', 'a1a2 e5e6 a2a3 e6e5'],
  ['a pawn move that locks (LockTest)', '8/8/4k3/3p2p1/1p1P1pP1/1P6/5P2/3K4 w - - 3 91', 'f2f3'],
];
const sq = s => 'abcdefgh'.indexOf(s[0]) + 8 * (+s[1] - 1);

/** The single-position verdict under a choice's ladder: what the settings file's verdict() gives. */
function verdictOf(E, c, fen, side, resigned) {
  const pos = E.fromFen(fen).position, o = gameOptions(c);
  let draw;
  if (o.rungs === 1) draw = E.materialCannotMate(pos, side);
  else if (o.rungs === 2) draw = E.cannotMate(pos, side);
  else draw = E.proveCannotBeMated(pos, side, c.version === 'full' ? { moveRule: o.moveRule } : {}).proven;
  if (draw) return resigned ? E.Result.DRAW_ON_RESIGNATION : E.Result.DRAW_ON_TIME;
  if (side === E.WHITE) return resigned ? E.Result.BLACK_BY_RESIGNATION : E.Result.BLACK_ON_TIME;
  return resigned ? E.Result.WHITE_BY_RESIGNATION : E.Result.WHITE_ON_TIME;
}

/** The expected answers: per position the verdicts if White's flag falls and if Black resigns; per
    game the status and the claims after each move, then the verdict if the side to move's flag falls. */
function expected(E, c) {
  const o = gameOptions(c);
  const positions = POSITIONS.map(([what, fen]) => ({ what, fen, white: verdictOf(E, c, fen, E.WHITE, false), black: verdictOf(E, c, fen, E.BLACK, true) }));
  const games = GAMES.map(([what, fen, moves]) => {
    const g = new E.Game(E.fromFen(fen).position, o), after = [];
    for (const m of moves.split(' ')) after.push([g.play(sq(m.slice(0, 2)), sq(m.slice(2, 4))), g.claimable()]);
    return { what, fen, moves, after, verdict: g.flagVerdict(g.position.side) };
  });
  return { positions, games };
}

/* ─── the files ─────────────────────────────────────────────────────────────────────────────── */

const optionsJs = o => `{ moveRule: ${o.moveRule}, claimMoves: ${o.claimMoves}, repetition: ${o.repetition}, ` +
  `claimRepetition: ${o.claimRepetition}, rungs: ${o.rungs}, dominoAtEnd: ${o.dominoAtEnd} }`;

function settingsJs(c, o, wasm) {
  const head = `/* mateless-settings.js: a platform's own rules for Mateless (${c.version} version), as chosen on the
   Mateless site. Edit OPTIONS to change them; the engine reads nothing else.
     moveRule          the game ends by itself at this halfmove clock: 150 (75 moves) or 100 (50 moves)
     claimMoves        from this halfmove clock a draw may be claimed: 100, or 0 for no claim
     repetition        the game ends by itself at this occurrence of a position: 5 or 3
     claimRepetition   from this occurrence a draw may be claimed: 3, or 0 for no claim
     rungs             1 the material test, 2 and the lock detector, 3 the whole ladder
     dominoAtEnd       with rungs 3: the search runs only when a flag falls or a side resigns${c.version === 'full' ? `
   In this version the automatic ends (moveRule, repetition) shape the proofs too: a mate that could
   only come after the game has ended by itself never comes. A claim never does: it is the player's.` : ''} */
`;
  const verdictBody = `    const p = typeof position === 'string' ? fen(position) : position;
    let draw;
    if (OPTIONS.rungs === 1) draw = M.materialCannotMate(p, side);
    else if (OPTIONS.rungs === 2) draw = M.cannotMate(p, side);
    else draw = M.proveCannotBeMated(p, side${c.version === 'full' ? ', { moveRule: OPTIONS.moveRule }' : ''}).proven;
    if (draw) return resigned ? M.Result.DRAW_ON_RESIGNATION : M.Result.DRAW_ON_TIME;
    if (side === M.WHITE) return resigned ? M.Result.BLACK_BY_RESIGNATION : M.Result.BLACK_ON_TIME;
    return resigned ? M.Result.WHITE_BY_RESIGNATION : M.Result.WHITE_ON_TIME;`;
  return !wasm ? head + `(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./mateless.js'));
  else root.MatelessSettings = factory(root.Mateless);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (M) {
'use strict';
const OPTIONS = Object.freeze(${optionsJs(o)});
const START = '${START}';
function fen(text) {
  const r = M.fromFen(text);
  if (r.error) throw new Error('mateless: invalid FEN (' + r.error + '): ' + text);
  return r.position;
}
/** A game from a FEN (default: the start position) or a Position, under OPTIONS. */
function newGame(start = START) { return new M.Game(typeof start === 'string' ? fen(start) : start, OPTIONS); }
/** The result if the flag of \`side\` (M.WHITE or M.BLACK) falls in a single position (a FEN or a
    Position), or if \`side\` resigns: a draw when the ladder (up to OPTIONS.rungs) proves that the
    opponent can never mate. In a game played move by move, game.flagVerdict(side) reads the flags. */
function verdict(position, side, resigned = false) {
${verdictBody}
}
return Object.freeze({ Mateless: M, OPTIONS, START, newGame, verdict });
});
` : head + `(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./mateless-wasm.js'));
  else root.MatelessSettings = factory(root.MatelessWasm);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (W) {
'use strict';
const OPTIONS = Object.freeze(${optionsJs(o)});
const START = '${START}';
/** Loads mateless.wasm (see mateless-wasm.js's load: a path in Node, a URL in a browser) and returns
    { Mateless, OPTIONS, START, newGame, verdict }, as mateless-settings.js does in JavaScript. */
async function load(source) {
  const M = await W.load(source);
  function fen(text) {
    const r = M.fromFen(text);
    if (r.error) throw new Error('mateless: invalid FEN (' + r.error + '): ' + text);
    return r.position;
  }
  /** A game from a FEN (default: the start position) under OPTIONS; free() it when done. */
  function newGame(start = START) { return new M.Game(start, OPTIONS); }
  /** The result if the flag of \`side\` (M.WHITE or M.BLACK) falls in a single position (a FEN), or
      if \`side\` resigns: a draw when the ladder (up to OPTIONS.rungs) proves that the opponent can
      never mate. In a game, game.flagVerdict(side) reads the flags. */
  function verdict(position, side, resigned = false) {
    const p = typeof position === 'string' ? fen(position) : position;
    try {
      let draw;
      if (OPTIONS.rungs === 1) draw = M.materialCannotMate(p, side);
      else if (OPTIONS.rungs === 2) draw = M.cannotMate(p, side);
      else draw = M.proveCannotBeMated(p, side${c.version === 'full' ? ', { moveRule: OPTIONS.moveRule }' : ''}).proven;
      if (draw) return resigned ? M.Result.DRAW_ON_RESIGNATION : M.Result.DRAW_ON_TIME;
      if (side === M.WHITE) return resigned ? M.Result.BLACK_BY_RESIGNATION : M.Result.BLACK_ON_TIME;
      return resigned ? M.Result.WHITE_BY_RESIGNATION : M.Result.WHITE_ON_TIME;
    } finally { if (p !== position) p.free(); }
  }
  return Object.freeze({ Mateless: M, OPTIONS, START, newGame, verdict });
}
return Object.freeze({ load, OPTIONS });
});
`;
}

function selftestJs(exp, wasm) {
  return `'use strict';
/* The self-test: positions and games with the answers this package must give (computed on the
   Mateless site with the same engine and settings). Run: node selftest.js */
const CASES = ${JSON.stringify(exp, null, 1)};
const sq = s => 'abcdefgh'.indexOf(s[0]) + 8 * (+s[1] - 1);
${wasm ? '(async () => {\nconst S = await require(\'./mateless-settings.js\').load();' : '(() => {\nconst S = require(\'./mateless-settings.js\');'}
const M = S.Mateless;
let ok = 0, bad = 0;
const same = (what, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) ok++; else { bad++; console.log('FAIL', what, 'got', JSON.stringify(got), 'want', JSON.stringify(want)); } };
for (const p of CASES.positions) same(p.what, [S.verdict(p.fen, M.WHITE, false), S.verdict(p.fen, M.BLACK, true)], [p.white, p.black]);
for (const g of CASES.games) {
  const game = S.newGame(g.fen), after = [];
  for (const m of g.moves.split(' ')) after.push([game.play(sq(m.slice(0, 2)), sq(m.slice(2, 4))), game.claimable()]);
  same(g.what, [after, game.flagVerdict(${wasm ? 'game.side' : 'game.position.side'})], [g.after, g.verdict]);${wasm ? '\n  game.free();' : ''}
}
console.log(bad ? bad + ' of ' + (ok + bad) + ' checks failed' : 'self-test: ' + ok + ' checks passed');
process.exit(bad ? 1 : 0);
})();
`;
}

function settingsRs(c, o) {
  const full = c.version === 'full';
  return `//! A platform's own rules for Mateless (${c.version} version), as chosen on the Mateless site. Edit
//! GAME_OPTIONS to change them; the engine reads nothing else (GameOptions in game.rs).${full ? `
//! In this version the automatic ends (move_rule, repetition) shape the proofs too: a mate that
//! could only come after the game has ended by itself never comes. A claim never does.` : ''}

use crate::{cannot_mate, from_fen, material_test, Domino, Game, GameOptions, Position, DOMINO_BUDGET, DOMINO_PLY${full ? ', prove_cannot_be_mated_rules, Rules, Tiers' : ', prove_cannot_be_mated'}};
use crate::game::verdict_code;

pub const GAME_OPTIONS: GameOptions = GameOptions {
    move_rule: ${o.moveRule},
    claim_moves: ${o.claimMoves},
    repetition: ${o.repetition},
    claim_repetition: ${o.claimRepetition},
    rungs: ${o.rungs},
    domino_at_end: ${o.dominoAtEnd},
};

pub const START: &str = "${START}";

/// A game from a FEN under GAME_OPTIONS.
pub fn new_game(fen: &str) -> Result<Game, &'static str> { Game::new(&from_fen(fen)?, GAME_OPTIONS) }

/// The result if the flag of \`side\` (WHITE or BLACK) falls in a single position, or if \`side\`
/// resigns: a draw when the ladder (up to GAME_OPTIONS.rungs) proves that the opponent can never
/// mate. In a game played move by move, Game::flag_verdict reads the flags.
pub fn verdict(pos: &Position, side: u8, resigned: bool) -> u8 {
    let draw = match GAME_OPTIONS.rungs {
        1 => material_test(pos, side),
        2 => cannot_mate(pos, side),
        _ => {
            let mut search = Domino::new();
            ${full ? `let rules = Rules { move_rule: GAME_OPTIONS.move_rule, repetition: 0, history: &[] };
            prove_cannot_be_mated_rules(&mut search, pos, side, DOMINO_PLY, DOMINO_BUDGET, &Tiers::DEFAULT, &rules).proven`
         : 'prove_cannot_be_mated(&mut search, pos, side, DOMINO_PLY, DOMINO_BUDGET).proven'}
        }
    };
    verdict_code(side, draw, resigned)
}
`;
}

function selftestRs(exp) {
  const str = s => JSON.stringify(s);
  const pos = exp.positions.map(p => `    (${str(p.what)}, ${str(p.fen)}, ${p.white}, ${p.black}),`).join('\n');
  const games = exp.games.map(g => `    (${str(g.what)}, ${str(g.fen)}, ${str(g.moves)}, &[${g.after.map(([s, k]) => `(${s}, ${k})`).join(', ')}], ${g.verdict}),`).join('\n');
  return `//! The self-test: positions and games with the answers this package must give (computed on the
//! Mateless site with the same engine and settings, in JavaScript). Run:
//!   cargo run --release --example selftest
use mateless::settings::{new_game, verdict};
use mateless::{from_fen, BLACK, WHITE};

const POSITIONS: &[(&str, &str, u8, u8)] = &[
${pos}
];
#[allow(clippy::type_complexity)]
const GAMES: &[(&str, &str, &str, &[(u8, u8)], u8)] = &[
${games}
];

fn sq(s: &str) -> usize { let b = s.as_bytes(); (b[0] - b'a') as usize + 8 * (b[1] - b'1') as usize }

fn main() {
    let (mut ok, mut bad) = (0, 0);
    for &(what, fen, white, black) in POSITIONS {
        let pos = from_fen(fen).expect("FEN");
        let got = (verdict(&pos, WHITE, false), verdict(&pos, BLACK, true));
        if got == (white, black) { ok += 1; } else { bad += 1; println!("FAIL {}: got {:?}, want {:?}", what, got, (white, black)); }
    }
    for &(what, fen, moves, after, want) in GAMES {
        let mut g = new_game(fen).expect("FEN");
        let mut got = Vec::new();
        for m in moves.split(' ') { let s = g.play(sq(&m[0..2]), sq(&m[2..4]), mateless::QUEEN).expect("legal move"); got.push((s, g.claimable())); }
        let side = g.position.side;
        let v = g.flag_verdict(side, false);
        if got == after && v == want { ok += 1; } else { bad += 1; println!("FAIL {}: got {:?} {}, want {:?} {}", what, got, v, after, want); }
    }
    if bad > 0 { println!("{} of {} checks failed", bad, ok + bad); std::process::exit(1); }
    println!("self-test: {} checks passed", ok);
}
`;
}

function cargoToml(c) {
  return `[package]
name = "mateless"
version = "0.1.0"
edition = "2021"
authors = ["Cüneyt İnan"]
repository = "https://github.com/cuneytinann/Mateless"
description = "Mateless (${c.version} version): a chess engine for a game server, with proofs that a side can never mate (FIDE 6.9, 5.1.2, 5.2.2)"
license = "MIT"

[lib]
name = "mateless"
path = "src/lib.rs"

[dependencies]

[profile.release]
lto = true
codegen-units = 1
`;
}

/** mateless.mjs from mateless.js: the same code, as an ES module exporting the same names. */
function esm(js, keys) {
  const head = js.indexOf('(function (root, factory) {'), body = js.indexOf('function () {', head);
  const end = js.lastIndexOf('});');
  if (head < 0 || body < 0 || end < 0) throw new Error('mateless.js: not the expected wrapper');
  return js.slice(0, head).replace('// mateless.js is built', '// mateless.mjs is built') + 'const Mateless = (function () {' +
    js.slice(body + 'function () {'.length, end) + '})();\n\nexport const {\n  ' + keys.join(', ') + ',\n} = Mateless;\n' +
    '/** The same exports as one frozen object, as mateless.js gives it. */\nexport default Mateless;\n';
}

/* ─── the README ────────────────────────────────────────────────────────────────────────────── */

function readme(c, o, files) {
  const full = c.version === 'full';
  const ladder = { 1: 'the material test only', 2: 'the material test and the lock detector',
                   3: full ? 'the whole ladder: the material test, the lock detector (with the full version\'s rules), the Domino search, then the stuck mater move by move and a second tier of the search'
                           : 'the whole ladder: the material test, the lock detector and the Domino search' }[o.rungs];
  const moves = { a: 'a draw may be claimed at 50 moves; the game ends by itself at 75 (FIDE 9.3, 9.6.2)', b: 'the game ends by itself at 50 moves', c: 'no claim; the game ends by itself at 75 moves' }[c.moves];
  const reps = { a: 'a draw may be claimed at threefold repetition; the game ends by itself at fivefold (FIDE 9.2, 9.6.1)', b: 'the game ends by itself at threefold repetition', c: 'no claim; the game ends by itself at fivefold repetition' }[c.repetition];
  const when = o.rungs < 3 ? 'no search' : o.dominoAtEnd ? 'only when a flag falls or a side resigns' : 'after every move (recommended)';
  const use = {
    js: '```js\nconst S = require(\'./mateless-settings.js\');      // in a browser: <script src="mateless.js"> then <script src="mateless-settings.js">: window.MatelessSettings\nconst M = S.Mateless;\nconst game = S.newGame();                            // or S.newGame(fen)\nlet status = game.play(M.parseSquare(\'e2\'), M.parseSquare(\'e4\'));   // 0 while the game goes on\nif (game.claimable() & M.Claim.THREEFOLD) { /* offer the claim */ }\nconst result = game.flagVerdict(M.WHITE);            // White\'s flag fell: a win for Black, or a draw\nS.verdict(fen, M.BLACK, true);                       // one position: Black resigns\n```\n\nAs an ES module: `import Mateless from \'./mateless.mjs\'`, then `new Mateless.Game(Mateless.fromFen(fen).position, OPTIONS)` with the options of mateless-settings.js. Types: mateless.d.ts.',
    wasm: '```js\nconst S = await require(\'./mateless-settings.js\').load();   // in a browser: load mateless-wasm.js and mateless-settings.js, then MatelessSettings.load(\'mateless.wasm\')\nconst M = S.Mateless;\nconst game = S.newGame();                     // or S.newGame(fen); game.free() when done\nconst e2 = 12, e4 = 28;                       // squares: a1 = 0, b1 = 1 ... h8 = 63\nlet status = game.play(e2, e4);               // 0 while the game goes on\nif (game.claimable() & M.Claim.THREEFOLD) { /* offer the claim */ }\nconst result = game.flagVerdict(M.WHITE);     // White\'s flag fell\nconsole.log(game.fen(), M.RESULT_NAMES[result]);\n```',
    rust: '```rust\nuse mateless::settings::{new_game, verdict, START};\nuse mateless::{from_fen, WHITE, BLACK, QUEEN, CLAIM_THREEFOLD, RESULT_NAMES};\n\nlet mut game = new_game(START)?;\nlet status = game.play(12, 28, QUEEN)?;          // e2-e4; squares a1 = 0 ... h8 = 63; 0 while the game goes on\nif game.claimable() & CLAIM_THREEFOLD != 0 { /* offer the claim */ }\nlet result = game.flag_verdict(WHITE, false);     // White\'s flag fell\nprintln!("{}", RESULT_NAMES[result as usize]);\nlet v = verdict(&from_fen(fen)?, BLACK, true);    // one position: Black resigns\n```\n\nCall `mateless::init()` once at start-up to build the attack tables (otherwise the first position does).',
  }[c.lang];
  const budget = {
    js: 'In mateless.js: `const DOMINO_PLY = 3, DOMINO_BUDGET = 10;`' + (full ? ' and `const DOMINO_DEEP_PLY = 9, DOMINO_DEEP_BUDGET = 5000;` (the second tier).' : '.') + ' The same lines are in mateless.mjs.',
    rust: 'In src/domino.rs: `DOMINO_PLY` and `DOMINO_BUDGET`' + (full ? ', and `DOMINO_DEEP_PLY` and `DOMINO_DEEP_BUDGET` (the second tier).' : '.'),
    wasm: 'They are compiled into mateless.wasm. To change them, build it again from the Rust sources (the Rust package, or rust/wasm in the repository) after editing `DOMINO_PLY` and `DOMINO_BUDGET`' + (full ? ' (and the second tier\'s `DOMINO_DEEP_PLY`, `DOMINO_DEEP_BUDGET`)' : '') + ' in src/domino.rs.',
  }[c.lang];
  const test = { js: '`node selftest.js`', wasm: '`node selftest.js`', rust: '`cargo run --release --example selftest`' }[c.lang];
  return `# Mateless: the ${c.version} version in ${LANG[c.lang]}

A chess engine for a game server: the board, legal moves, FEN, a game with its results and its draw
rules, and Mateless's ladder, which proves when a side can never mate: a flag fall or a resignation
against it is a draw (FIDE 6.9, 5.1.2), and when neither side can, the position is dead and the game
ends at once (5.2.2). "Cannot mate" is always a proof; what the ladder cannot prove it leaves to the
platform's rule, and to an analysis after the game.

Made on the Mateless site (https://cuneytinann.github.io/Mateless/) with these settings:

| | |
|---|---|
| version | ${full ? 'full (the second-version branch): more rules in the lock detector, the stuck mater and a second tier of the search; no third tier (that one is for the analysis after the game)' : 'fast: the rules proposed to Lichess'} |
| ladder | ${ladder} |
| the search runs | ${when} |
| 50/75 moves | ${moves} |
| repetition | ${reps} |

${full ? 'In this version the automatic ends shape the proofs too: a mate that could only come after the game\nhas ended by itself never comes. A claim never does: it is the player\'s to make.\n\n' : ''}The engine is the one the site runs and the repository tests, unchanged: the settings are the options
of a Game, in ${c.lang === 'rust' ? 'src/settings.rs' : 'mateless-settings.js'}. JavaScript, Rust and WebAssembly give the same answers.

## Files

${files.map(f => '- `' + f + '`').join('\n')}

## Use

${use}

Results (RESULT_NAMES): 0 ongoing; 1, 2 checkmate; 3 stalemate; 4 the 75-move rule; 5 fivefold
repetition; 6 dead position; 7, 8 a win on time; 9, 10 a win by resignation; 11 a draw on time; 12 a
draw on resignation; 13 the 50-move rule; 14 threefold repetition. Claims (claimable): 1 the 50-move
rule, 2 threefold repetition; the platform ends the game when a player makes one.

## The search's budget

Not a setting: the defaults (3 plies and 10 nodes${full ? ', then 9 plies and 5,000 nodes' : ''}) cost a few microseconds a move and are
the ones measured. ${budget}

## Self-test

${test} checks the answers this package must give with these settings.

## Licence

MIT (LICENSE). SHA256SUMS lists every file's checksum.
`;
}

/* ─── the package ───────────────────────────────────────────────────────────────────────────── */

async function sha256(data) {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const d = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
  return Array.from(d, b => b.toString(16).padStart(2, '0')).join('');
}

async function build(choice, sources, E) {
  check(choice);
  const c = Object.assign({}, choice, { dominoAtEnd: choice.rungs === 3 && !!choice.dominoAtEnd }), o = gameOptions(c);
  const exp = expected(E, c), files = [];
  if (c.lang === 'js') {
    files.push(['mateless.js', sources.engine], ['mateless.mjs', esm(sources.engine, Object.keys(E))], ['mateless.d.ts', sources.dts],
               ['mateless-settings.js', settingsJs(c, o, false)], ['selftest.js', selftestJs(exp, false)]);
  } else if (c.lang === 'wasm') {
    files.push(['mateless.wasm', sources.wasm], ['mateless-wasm.js', sources.wasmJs],
               ['mateless-settings.js', settingsJs(c, o, true)], ['selftest.js', selftestJs(exp, true)]);
  } else {
    let lib = sources.rust['src/lib.rs'];
    lib = lib.replace(/\n*$/, '\n') + '\n/// The platform\'s own rules, as chosen on the Mateless site.\npub mod settings;\n';
    files.push(['Cargo.toml', cargoToml(c)]);
    for (const [p, text] of Object.entries(sources.rust)) files.push([p, p === 'src/lib.rs' ? lib : text]);
    files.push(['src/settings.rs', settingsRs(c, o)], ['examples/selftest.rs', selftestRs(exp)]);
  }
  files.push(['LICENSE', sources.license]);
  const names = files.map(f => f[0]).concat(['README.md', 'SHA256SUMS']);
  files.push(['README.md', readme(c, o, names)]);
  const sums = [];
  for (const [p, d] of files) sums.push((await sha256(d)) + '  ' + p);
  files.push(['SHA256SUMS', sums.join('\n') + '\n']);
  const dir = 'mateless-' + c.version + '-' + c.lang;
  return { name: dir + '.zip', dir, files };
}

/* ─── .zip (stored, no compression) ──────────────────────────────────────────────────────────── */

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

/** A .zip of [path, string | Uint8Array] files (UTF-8 names, stored), under the folder `dir`. */
function zip(files, dir) {
  const enc = new TextEncoder(), parts = [], central = [];
  let offset = 0;
  const u16 = (v, a, i) => { a[i] = v & 255; a[i + 1] = (v >>> 8) & 255; };
  const u32 = (v, a, i) => { a[i] = v & 255; a[i + 1] = (v >>> 8) & 255; a[i + 2] = (v >>> 16) & 255; a[i + 3] = (v >>> 24) & 255; };
  for (const [p, d] of files) {
    const name = enc.encode((dir ? dir + '/' : '') + p), data = typeof d === 'string' ? enc.encode(d) : d, crc = crc32(data);
    const h = new Uint8Array(30 + name.length);
    u32(0x04034b50, h, 0); u16(20, h, 4); u16(0x0800, h, 6); u16(0, h, 8); u16(0, h, 10); u16(0x21, h, 12);
    u32(crc, h, 14); u32(data.length, h, 18); u32(data.length, h, 22); u16(name.length, h, 26); u16(0, h, 28); h.set(name, 30);
    const ch = new Uint8Array(46 + name.length);
    u32(0x02014b50, ch, 0); u16(20, ch, 4); u16(20, ch, 6); u16(0x0800, ch, 8); u16(0, ch, 10); u16(0, ch, 12); u16(0x21, ch, 14);
    u32(crc, ch, 16); u32(data.length, ch, 20); u32(data.length, ch, 24); u16(name.length, ch, 28); u16(0, ch, 30); u16(0, ch, 32);
    u16(0, ch, 34); u16(0, ch, 36); u32(0, ch, 38); u32(offset, ch, 42); ch.set(name, 46);
    parts.push(h, data); central.push(ch); offset += h.length + data.length;
  }
  const size = central.reduce((n, c) => n + c.length, 0), end = new Uint8Array(22);
  u32(0x06054b50, end, 0); u16(files.length, end, 8); u16(files.length, end, 10); u32(size, end, 12); u32(offset, end, 16);
  const all = parts.concat(central, [end]), out = new Uint8Array(all.reduce((n, a) => n + a.length, 0));
  let at = 0; for (const a of all) { out.set(a, at); at += a.length; }
  return out;
}

return Object.freeze({ build, zip, gameOptions, expected, esm, MOVES, REPS });
});
