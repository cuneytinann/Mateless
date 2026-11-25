# Tests

What must hold:
- **Rules:** legal moves in a fixed order, repetitions, the endings that need no claim; checked by
  perft (the Chess Programming Wiki positions, Chess960 against python-chess).
- **Never a false draw:** a flag comes down only where chasolver agrees that the side can never
  mate (`classify.js` counts FALSE DRAWS; `game_flags_check.js` asks chasolver's full analysis at
  every flag that comes down; `fuzz_lock_gen.js` feeds lock certificates to chasolver's full search).
- **The reasoning, not only the verdict:** `lock_invariant.js` walks every position reachable from
  a lock certificate.
- **The same answers everywhere:** the single files and the source modules, JS and Rust, JS and
  WebAssembly, both sides in one pass and each side alone, the trigger and the clock rule, byte
  for byte with node counts.

chasolver's test positions come from https://github.com/miguel-ambrona/chasolver
(`tests/positions.txt`, `tests/lichess.txt`): point `CHASOLVER` at that folder (default
`../../chasolver/tests`, a clone beside this repository). Use its `v3.0.0` tag: chasolver's main
branch dropped `lichess.txt` on 11 November 2026 (`git -C ../../chasolver checkout v3.0.0 -- tests`). `ENGINE` selects the engine under test
(default `../mateless.js`; most tests also run on `../src/index.js`, the ES modules); `DATA` a CSV
of chasolver's Lichess data where a test reads one. Run them from this folder.

| script | what it checks |
|---|---|
| `smoke.js` | perft of five standard test positions |
| `perft_cpw.js [engine.js] [maxDepth] [--only=N] [--divide] [--all]` | perft of the six Chess Programming Wiki positions; `perft_d5.bat`, `perft_d6.bat` run it on Windows at depth 5 or 6 |
| `perft_python.py`, `perft960.js -` | Chess960 move generation, python-chess against the engine: perft 3 of all 960 starts and of 40 random middlegames, the legal moves of every position of 7,000 random Chess960 games (about 780,000 positions; 4,000 of the games keep their castling rights long, about 60,000 castling moves in all), and the WebAssembly build's perft (`python3 perft_python.py \| node perft960.js -`, about a minute; `pip install chess`) |
| `classify.js <ply> <budget> <every>` | every verdict against chasolver's labels, by outcome and time; FALSE DRAWS must be 0 (with the engine's defaults: `6 100 1`). Positions no game can reach are set aside with the arbiter page's FEN checks (`index.html`) |
| `lock_layers.js` | for chasolver's two files and both flags: the layer that first proves "cannot mate" (material, lock, Domino), and each layer's false positives |
| `game_flags_check.js [seed] [games] [plies]` | games played move by move with `Game`, from chasolver's positions (or `DATA`'s); at every flag that comes down, chasolver's full analysis (its port, `../site/chasolver/engine.js`) must find no mate |
| `fuzz_lock_gen.js <seed> <count> <out>` | positions the lock detector certifies (mutations of chasolver's positions and random locked structures), as `<fen>\t<w\|b>` lines for chasolver's full search: `../rust/target/release/examples/oracle < out` must print only `U` |
| `lock_invariant.js <file> [every] [cap]` | the lock detector's reasoning: from each certificate (the sets from `_internal.lockSets`) every reachable position is enumerated, up to `cap`, and must keep the pawns in their cones, the fixed pawns in place, kings and bishops in their reaches, no promotion and the flagged king unmated; a certificate enumerated completely is proven outright. `<file>`: lines `<fen>\t<w\|b>` (the side that cannot mate; e.g. `../data/locked_positions.tsv`) or chasolver's labelled lines |
| `twosided_check.js <files…>` | both sides at once against each side alone, for every position (a line `<fen>\t…` or a game, FENs joined by `\|`): `lockTest2` and `cannotMate2` for each set of sides, `proveBoth` against `proveCannotBeMated` (every field), `isDeadPosition` against the two proofs, `Domino.run2` against `run` (root tests asked or not; every 64th also at 9 plies / 2,000 nodes); no difference allowed |
| `trigger_check.js [games]` | the static tests' trigger (`testsAfter`) against the clock rule (both tests whenever the halfmove clock is at most 1), a copy of the engine patched at run time: both proofs on chasolver's positions (and `DATA`'s), games including every reply to every check, and takebacks (`Flags.rewind`, then another line; both rules and `mateless.wasm` against flags fed the game from its start); counts how often each rule asks the tests; no difference allowed |
| `rust_compare.js layers\|labels\|games <file>`, `games <file> <rule> <rep>`, `rules <file>` | the JavaScript side of the Rust port's check: prints what `../rust/target/release/mateless` prints for the same input (layer, failure and nodes per row; both proofs of a labelled line; the plies at which a game's flags come down; under the rules, the flags of games that end at a move rule and a repetition rule, each update with the game's history, and for lines `<fen>\t<w\|b>\t<rule>\t<rep>\t<ply>\t<budget>` the proof under the rules, both proofs and the dead-position test, every field); the two outputs must be identical byte for byte |
| `wasm_check.js [games] [plies] [rule games]` | `mateless.wasm` (through `mateless-wasm.js`) against `mateless.js`: on chasolver's positions (and `DATA`'s) the FEN error, both static tests for both sides, `cannotMate2` for each set of sides, both proofs (every field), the dead-position test, every 64th at 9 plies / 2,000 nodes, every 512th perft 3; then the two flags after every ply of games; then under the rules every 16th position with its clock 1–40 plies from the move rule (150 or 100, with or without a repetition rule: the proofs and the dead-position test, every field) and games whose positions come back, under 150/5, 100/3, 100 and 3, the flags after every ply with the game's history (as `{ keys, n }` and as a list of FENs); no difference allowed |
| `build_check.js` | `mateless.js` and `mateless.mjs` are what `tools/build.js` builds now, `index.html` is what `tools/build-site.js` builds from `site/` and embeds exactly `mateless.js`, `src/index.js` and `mateless.mjs` (named and default exports) export the same names, constants and (for every function and class) the same source text, all give the same answers on chasolver's positions and in games played from them, and `lock/positions.tsv`, `lock/second/positions.tsv` and `mateless-lock.zip` are what `tools/lock-positions.js` and `tools/build-lock-zip.js` make now |
| `types_check.js` | `mateless.d.ts` against `mateless.js`: every export declared and every declaration exported, the constants' values, and a usage file under `tsc --strict` whose misuses must be rejected (`npm i --no-save typescript`; or `TSC=<path to tsc>`) |
| `page_check.js [dir]` | `index.html`, the whole site in one page, in headless Chromium (Playwright), tab by tab: the arbiter (one position, a labelled batch, the detail dialog, the PGN replay, the engine source), chasolver on a position handed over by the arbiter's "Ask chasolver" link, every example, side, level and pass of the lock explorer in both languages (none may disagree with `mateless.js`), an anchor in the rules, a small PGN through the Lichess scan's workers, every tab in Turkish and at phone width; fails on any console error (Google Fonts is answered with an empty style sheet, so no network is needed) |
| `../lock/test-all.sh` | the lock detector alone (`lock/`, 20 languages): every version whose compiler is installed answers both sides of the 36,406 positions of `lock/positions.tsv`, which `mateless.js` labels; run it from `lock/` |
| `../lock/second/test-all.sh` | the same for its second version (`lock/second/`, 20 languages) on the 60,471 positions of `lock/second/positions.tsv`, which `mateless.js`'s second-version detector labels |
| `lockviz_check.js` | the lock tab's display copy of the detector (`site/lock/lockviz.js`) against `mateless.js`'s first-version detector (`_internal.coreLockTest`): verdicts for both sides and, on a proof, every set, on the Lichess locks, the scan's final positions and random mutations |
| `chess960_boxed_check.js` | castling never moves a boxed rook: every castling layout of Chess960 (king on the b- to g-file, the rook on any other file, both colours) with every filling of the rank by the side's own knights, through the engine's own moves; a rook walled in by its own men never castles, one walled in with its king may. Then that rook in a whole position: `8/8/8/4k3/p1p5/P1Pp1p1p/3PpP1P/2B1B1KR` is dead without the castling right (all 216 positions it reaches, none a mate) and has a mate in four with it (`w K`); nothing may claim White can never be mated there |
| `second_version_check.js` | the second version's rules: the 36 rows of `data/second_version.tsv` proven as the file says (open pair, boxed piece, second tier; node counts) and not by the first version; positions of each rule with the certificate's shape; when the second tier may run |
| `bench.js <budget> <ply> <every> <engine files…>` | speed: engines alternated position by position in one process, CPU time |
| `twosided_bench.js time <positions>`, `twosided_bench.js games <games>` | the speed of both sides at once against each side alone, in one process, alternating, median of the rounds; the checksums must match |
| `fair_lock_bench.js <chasolver> <positions> [rounds]` | the lock test against chasolver's fast check (`../site/chasolver/engine.js`, or a page that carries it), in one process, chunk by chunk in rotating order, median of the rounds; `MATELESS_ENGINES=a.js,b.js` (default `../mateless.js`) |
| `wasm_bench.js [positions] [games]` | WebAssembly against JS, in one process, alternating, median of 7 rounds: both proofs, a game's flags per ply, the static tests |

In Rust (`../rust`): `cargo run --release --example gapbench -- <rounds> <games.tsv> <ngames> <category files...>` (the lock detector by kind of position, and a game's flags; from the open-pair measurements); `cargo test`; `cargo run --release --example lockcheck -- <files>` (the fast
lock loop against the plain one); `cargo run --release --example twosided -- check <positions>
<games>`; `cargo run --release --example vs_chasolver -- <positions>` (speed against chasolver;
`BOTH=1` for both sides, `HOT=512` for a hot cache); `cargo build --release --example oracle`
(chasolver's full analysis, for `fuzz_lock_gen.js`).
