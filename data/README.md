# Data

Mateless's classification of chasolver's Lichess data: the 192,457 rated Lichess games up to
31 July 2026 that were lost on time although the opponent could never have mated (the set without
its material and server-stalemate rows; see [docs/RESULTS.md](../docs/RESULTS.md)). The data itself
comes from Miguel Ambrona's [chasolver](https://github.com/miguel-ambrona/chasolver) project, which
publishes it as CSV files at [chasolver.org/unfair-games](https://chasolver.org/unfair-games); the
files here key into it by game id (`https://lichess.org/<gameId>`).

## `timeouts_classified.tsv`

One line per game, with a header:

| column | meaning |
|---|---|
| `gameId` | the Lichess game id |
| `date` | the date the game was played |
| `mateless` | the first rung that proves the flagged side's opponent can never mate: `lock` (a locked position), `domino` (a forced line, the Domino search at 6 plies / 100 nodes) or `unproven` |
| `scalachess_18_0_1` | 1 if Lichess today draws it: scalachess 18.0.1's `opponentHasInsufficientMaterial` (with #821's one-move lookahead), which lila asks when a flag falls |
| `with_lock_patch` | 1 if it is drawn with mateless-scalachess's `a-lock` patch (the lock detector at the position and in #821's lookahead) |
| `dead_position` | 1 if the final position is already dead: Mateless proves that neither side can mate (FIDE 5.2.2) |

## `locked_positions.tsv`

The 50,970 locked positions: `<fen>\t<w|b>\t<gameId>`. The FEN is the final position, the flagged
side to move; the second field is the side that cannot mate (the flagged side's opponent). It is
the input of `test/lock_invariant.js`, `test/fair_lock_bench.js` and
`rust/examples/vs_chasolver.rs`.

## Reproducing

With chasolver's CSV (columns `gameId,date,utcTime,white,whiteElo,whiteTitle,black,blackElo,
blackTitle,timeControl,eco,lastMove,fen`):

```sh
cd rust && cargo build --release
target/release/mateless layers timeouts.csv > layers.tsv     # per row: gameId, class, nodes, failure
cut -f2 layers.tsv | sort | uniq -c                            # 141451 domino, 50970 lock, 36 none
```

`node test/rust_compare.js layers timeouts.csv` prints the same lines from `mateless.js`. The two
scalachess columns come from mateless-scalachess (`check/lock/LockCheck.scala`: `rows`, with the
`a` build for the patch and today's scalachess for the other).
