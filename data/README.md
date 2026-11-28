# Data

Mateless's classification of the rated Lichess games lost on time although the opponent could
never have mated: chasolver's list of 19 November 2026, 204,484 games up to 31 October 2026, newest
first (see [docs/RESULTS.md](../docs/RESULTS.md)).

- **The list:** the data itself comes from Miguel Ambrona's
  [chasolver](https://github.com/miguel-ambrona/chasolver) project, which publishes it as CSV files
  at [chasolver.org/unfair-games](https://chasolver.org/unfair-games); the files here key into it by
  game id (`https://lichess.org/<gameId>`). It holds 8,139 material rows (up to 2020) and 464
  server stalemates (the flagged side had no legal move).
- **August and September 2026** we also scanned ourselves, in Lichess's monthly databases
  (`lichess_db_standard_rated_2026-08`, `-09`): 2,830 games lost on time where both chasolver and
  Mateless prove that the winner could never have mated (games won by a rules infraction left out),
  game for game the list's rows of those two months. Their final positions, and 170 resignations,
  are in `lichess_2026-08_09.tsv`.

## `timeouts_classified.tsv`

One line per game, newest first, with a header:

| column | meaning |
|---|---|
| `gameId` | the Lichess game id |
| `date` | the date the game was played |
| `mateless` | the first rung that proves the flagged side's opponent can never mate: `material`, `lock` (a locked position), `domino` (a forced line, the Domino search at its default, 3 plies / 10 nodes; the server stalemates among them) or `unproven` |
| `scalachess_18_0_1` | 1 if Lichess today draws it: scalachess 18.0.1's `opponentHasInsufficientMaterial` (with #821's one-move lookahead), which lila asks when a flag falls |
| `with_lock_patch` | 1 if it is drawn with mateless-scalachess's `a-lock` patch, the alternative (the lock detector when a flag falls, at the position and in #821's lookahead) |
| `dead_position` | 1 if the final position is already dead: Mateless proves that neither side can mate (FIDE 5.2.2), the search at its default |
| `in_game` | 1 if it is drawn with mateless-scalachess's `in-game` patch, the proposal (the lock detector for both sides in `autoDraw` at halfmove clock 0 or 1): Lichess draws it today, or its final position is a lock for both sides, so the game would have ended, drawn, when it locked |

"Newest first" is by date and chasolver's UTC time.

## `locked_positions.tsv`

The 52,050 locked positions up to 30 September 2026 (the list's 559 of October are in
`timeouts_classified.tsv`), newest first: `<fen>\t<w|b>\t<gameId>`. The FEN is the final position,
the flagged side to move; the second field is the side that cannot mate (the flagged side's
opponent). It is the input of `test/lock_invariant.js`, `test/fair_lock_bench.js` and
`rust/examples/vs_chasolver.rs`. The speeds in the READMEs were measured on its first version, the
50,970 locks up to July 2026.

## `lichess_2026-08_09.tsv`

The 3,000 games of the August and September scan won other than by mate although the winner could
never have mated, newest first: the 2,830 timeouts above and 170 resignations (under FIDE 5.1.2 a
draw, on Lichess scored as a loss).

| column | meaning |
|---|---|
| `gameId`, `date` | as above |
| `end` | `timeout` or `resignation` |
| `loser` | `w` or `b`: the side that lost on time or resigned (in 22 resignations not the side to move) |
| `mateless` | `lock`, `domino` or `unproven` for the loser: the first rung that proves its opponent can never mate (the search at 6 plies / 100 nodes, its default when the months were scanned) |
| `dead_position` | as above |
| `fen` | the final position |

## Reproducing

With chasolver's CSV (columns `gameId,date,utcTime,white,whiteElo,whiteTitle,black,blackElo,
blackTitle,timeControl,eco,lastMove,fen`):

```sh
cd rust && cargo build --release
target/release/mateless layers timeouts.csv > layers.tsv     # per row: gameId, class, nodes, failure
cut -f2 layers.tsv | sort | uniq -c                            # 143080 domino, 52609 lock, 8139 material, 656 none
```

`node test/rust_compare.js layers timeouts.csv` prints the same lines from `mateless.js`. The two
scalachess columns come from mateless-scalachess (`check/lock/LockCheck.scala`: `rows` with the `a`
build for the patch; `check/ladder/Check.scala`: `rows` with the `ref` build, today's scalachess,
for the other); that is how they were made for the earlier set (195,287 rows, up to September). For
this list the same two rules were run over `mateless.js`, which gives scalachess's answer on every
one of those 195,287 rows. `in_game` is `scalachess_18_0_1`, or a `lock` row whose final
position in `locked_positions.tsv` the lock detector proves for both sides (`lockCannotMate` for
White and for Black; `Lock.scala` gives the same answers).
