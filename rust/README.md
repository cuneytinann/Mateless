# Mateless in Rust

A port of `mateless.js` to Rust: the same rules, the same static tests (material test, lock
detector) and the same Domino search (6 plies, 100 nodes, no move-count rules), with the game's
two flags (`Flags`). Legal moves are generated in the same order as in the JavaScript engine, so a
search plays the same nodes: on chasolver's 201,060 Lichess rows, on chasolver's labelled test
positions and in thousands of games played move by move, the two engines print the same lines,
node counts included (`test/rust_compare.js`). Bitboards are plain `u64`; nothing is module state
(the lock detector's census and the move-generation context live on the stack, each `Domino`
search owns its memory), so the library can be used from many threads, one `Domino` per thread.

The modules are the layers of the JavaScript sources (`src/`): `material` (rung 1, the material
test), `lock` (rung 2, the lock detector and the two static tests together), `domino` (rung 3, the
Domino search), `ladder` (`prove_cannot_be_mated`, `prove_both`, `Flags`), and under them `board`, a
reference board (bitboards, magic bitboards, legal moves, FEN). Each module's `use` lines say what it
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
cargo run --release --example dominobench -- positions.txt   # the ladder at 6/100: proven, nodes, ns per position
```

```rust
let pos = mateless::from_fen("8/8/4k3/3p2p1/1p1P1pP1/1P3P2/8/3K4 b - - 47 92").unwrap();
let mut search = mateless::Domino::new();
let proof = mateless::prove_cannot_be_mated(&mut search, &pos, mateless::BLACK, mateless::DOMINO_PLY, mateless::DOMINO_BUDGET);
assert!(proof.proven && proof.static_proof);    // the lock detector: White can never mate
```
