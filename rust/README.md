# Mateless in Rust

A port of `mateless.js` to Rust: the same rules, the same static tests (material test, lock
detector) and the same Domino search (3 plies, 10 nodes), with the game's two flags (`Flags`),
and on request the rules a game ends at by itself, with the clock search. Legal moves are generated in the same order as in the JavaScript engine, so a
search plays the same nodes: on chasolver's 201,060 Lichess rows and the 3,000 of the August and
September scan, on chasolver's labelled test
positions and in thousands of games played move by move, the two engines print the same lines,
node counts included (`test/rust_compare.js`). Bitboards are plain `u64`; nothing is module state
(the lock detector's census and the move-generation context live on the stack, each `Domino`
search owns its memory), so the library can be used from many threads, one `Domino` per thread.

Both versions are here, as in `mateless.js`: the first version's lock detector and search, and the
second version's rules, each run only when its own situation is on the board (open pawn pairs and
boxed knights, rooks and queens in `lock`; after a first search that fails without a mate, the
stuck mater move by move in `stuck` (`stuck_every`: pure bit work, no node) and the search's second
tier, 9 plies and 5,000 nodes, in `ladder`: `prove_cannot_be_mated_deep` and `prove_both_deep` take
its size as a `Tiers`, `Tiers::DEFAULT` or `Tiers::second(ply, budget)`, a budget of 0 for none; a
`Proof` says which ran, `deep` and `stuck`). There is no third tier: the arbiter page's third
(150 plies, 5,000,000 nodes, for analysis after the game) is the page's own, one more call after a
ladder that fails without a mate.

The rules a game ends at by itself are here too, as in `mateless.js` (the second version's
README: "The move rules, on request"): `Rules { move_rule, repetition, history }` (150 or 100, 0
for none; 5 or 3, 0 for none; the codes of the game's positions before this one since its last
capture or pawn move, `board::position_key`) for `prove_cannot_be_mated_rules`, `prove_both_rules`
and `is_dead_position_rules`, and `Flags::with_rules(move_rule, repetition)` with
`update_with_history(pos, ply, history)`. Near the move rule they run the clock search (`clock`,
`ClockSearch`); the functions without `_rules` are those with `Rules::NONE`, node for node.
`mateless rules <file>` and `mateless games <file> <rule> <rep>` print what
`test/rust_compare.js` prints: on 20,972 positions with the clock near a rule and 1,200 games under
four settings, the same lines, node counts included.

A whole game under a platform's own rules is `game` (`Game` in `src/game.js`): `GameOptions` for
the move and repetition rules the game ends at (and its proofs are made under), the claims (which
no proof assumes), how much of the ladder runs and whether the searches wait for the end; `play`,
`status`, `claimable`, `flag_verdict`, `legal_moves`. `mateless play <file>` and `node
../test/rust_compare.js play <file>` play the same games and print the same lines
(`test/game_check.js` writes such a file).

The modules are the layers of the JavaScript sources (`src/`): `material` (rung 1, the material
test), `lock` (rung 2, the lock detector and the two static tests together), `domino` (rung 3, the
Domino search), `clock` (the clock search, near the move rule), `ladder` (`prove_cannot_be_mated`,
`prove_both`, `is_dead_position`, `Flags`, rung 4, the further tiers, and the rules), and under them
`board`, a
reference board (bitboards, magic bitboards, legal moves, FEN as written: `read_fen`), and over
them `fen`, the outer layer, as `src/fen.js`: `from_fen` reads a FEN into a position some game can
reach, refusing the rest (`"oppcheck"`, `"pawns"`, `"pieces"`, `"promo"`, `"captures"`,
`"checks"`, besides `"syntax"`, `"kings"`, `"pawnrank"`), and `from_fen_with(fen, strict)` gives
the `FenRead` (position, move number, what was put right as `FIXED_*` bits; `strict: false` for
composed positions). Each module's `use` lines say what it
takes from the board. Every public item is also re-exported at the crate root (`mateless::Flags`).

No dependencies. The dev-dependencies (`chasolver`, `chess`) are only for the examples that run
chasolver: the speed comparison (`vs_chasolver`) and its full analysis line by line (`oracle`, for
`test/fuzz_lock_gen.js`).

`wasm/` is a thin C ABI over the crate for WebAssembly (`mateless.wasm`, used through
`mateless-wasm.js`): positions and the flags of games kept in two tables behind handles, a FEN in
through one input buffer, answers out as return values or in one array. `node tools/build-wasm.js`
builds it: with the `wasm32-unknown-unknown` target installed, a plain release build; without it,
from the standard library's source (`-Zbuild-std`, see the script).

```sh
cargo build --release
target/release/mateless perft 5                                   # the six CPW positions
target/release/mateless layers chasolver-data.csv > rs.tsv        # per row: layer, nodes, failure
node ../test/rust_compare.js layers chasolver-data.csv > js.tsv && cmp js.tsv rs.tsv
target/release/mateless fen fens.txt > rs.tsv                    # the FEN readers: strict and loose, per FEN
node ../test/rust_compare.js fen fens.txt > js.tsv && cmp js.tsv rs.tsv
target/release/mateless rules cases.tsv > rs.tsv                  # under the rules: <fen> <w|b> <rule> <rep> <ply> <budget>
node ../test/rust_compare.js rules cases.tsv > js.tsv && cmp js.tsv rs.tsv
target/release/mateless games games.txt 100 3 > rs.tsv           # a game's flags under the 50-move rule and threefold
node ../test/rust_compare.js games games.txt 100 3 > js.tsv && cmp js.tsv rs.tsv
cargo run --release --example vs_chasolver -- positions.txt  # against chasolver's fast check
BOTH=1 cargo run --release --example vs_chasolver -- positions.txt   # both sides: chasolver per colour, Mateless prove_both
```

`positions.txt` for the comparison: lines `<fen>\t<w|b>`, the second field the side that should
be unable to mate (e.g. `../data/locked_positions.tsv`).

The lock detector runs the cycle walls → fixed pawns → king reaches → capture squares on six sets
only, and computes the pawn cones and the bishops' reaches once at the end (they never feed the
cycle); a pass that finds the walls and fixed pawns unchanged stops at once; the cones and capture
squares are occluded fills; both kings are flooded in one loop. `mateless.js` uses the same
algorithm. The plain loop (all ten sets updated on every pass) is kept as `lock_test_reference`,
and the two agree on every position tested:

```sh
cargo run --release --example lockcheck -- chasolver-data.csv positions.txt lichess.txt   # fast = reference
HOT=512 cargo run --release --example vs_chasolver -- locked.txt   # against chasolver, hot cache
```

A game's two flags and a dead position need the answer for both sides. `cannot_mate2`, `lock_test2`,
`Domino::run2` and `prove_both` give both in one pass (bits `FLAGGED_WHITE`, `FLAGGED_BLACK`), with the
same answers as asking each side alone: a level of the lock detector is computed once (only the
mating net depends on the side), and the two searches share one walk, each side paying its own
budget and keeping its own bit in the set of positions met. `Flags::update` uses them, as
`Game.updateFlags` uses `cannotMate2` and `Domino.run2` in `mateless.js`. A platform that
lets moves be taken back calls `Flags::rewind(ply)` with the ply the game is back at.

```sh
cargo run --release --example twosided -- check positions.txt games.txt   # both at once = each side alone, every field
cargo run --release --example twosided -- time positions.txt              # static tests and ladder, both sides
cargo run --release --example twosided -- games games.txt                 # a game's flags, ply by ply
```

The search plays the same nodes in the same order as before every speedup; the proven count and the
nodes played are its checksum:

```sh
cargo run --release --example dominobench -- positions.txt   # the ladder at its defaults: proven, nodes, ns per position
```

```rust
let pos = mateless::from_fen("8/8/4k3/3p2p1/1p1P1pP1/1P3P2/8/3K4 b - - 47 92").unwrap();
let mut search = mateless::Domino::new();
let proof = mateless::prove_cannot_be_mated(&mut search, &pos, mateless::BLACK, mateless::DOMINO_PLY, mateless::DOMINO_BUDGET);
assert!(proof.proven && proof.static_proof);    // the lock detector: White can never mate
```
