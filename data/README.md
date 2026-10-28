# Data

Mateless's classification of the rated Lichess games lost on time although the opponent could
never have mated: 195,287 games, newest first (see [docs/RESULTS.md](../docs/RESULTS.md)).

- **Up to 31 July 2026:** chasolver's Lichess data, 192,457 games (the set without its material
  and server-stalemate rows). The data itself comes from Miguel Ambrona's
  [chasolver](https://github.com/miguel-ambrona/chasolver) project, which publishes it as CSV files
  at [chasolver.org/unfair-games](https://chasolver.org/unfair-games); the files here key into it by
  game id (`https://lichess.org/<gameId>`).
- **August and September 2026:** a scan of Lichess's monthly databases
  (`lichess_db_standard_rated_2026-08`, `-09`), 2,830 games lost on time where both chasolver and
  Mateless prove that the winner could never have mated (games won by a rules infraction left out).
  Their final positions are in `lichess_2026-08_09.tsv`.

## `timeouts_classified.tsv`

One line per game, newest first, with a header:

| column | meaning |
|---|---|
| `gameId` | the Lichess game id |
| `date` | the date the game was played |
| `mateless` | the first rung that proves the flagged side's opponent can never mate: `lock` (a locked position), `domino` (a forced line, the Domino search at 6 plies / 100 nodes) or `unproven` |
| `scalachess_18_0_1` | 1 if Lichess today draws it: scalachess 18.0.1's `opponentHasInsufficientMaterial` (with #821's one-move lookahead), which lila asks when a flag falls |
| `with_lock_patch` | 1 if it is drawn with mateless-scalachess's `a-lock` patch, the alternative (the lock detector when a flag falls, at the position and in #821's lookahead) |
| `dead_position` | 1 if the final position is already dead: Mateless proves that neither side can mate (FIDE 5.2.2) |
| `in_game` | 1 if it is drawn with mateless-scalachess's `in-game` patch, the proposal (the lock detector for both sides in `autoDraw` at halfmove clock 0 or 1): Lichess draws it today, or its final position is a lock for both sides, so the game would have ended, drawn, when it locked |

"Newest first" is by date and, up to July, chasolver's UTC time. The scanned months have no time:
within a day their games stand in the reverse of the database's order.

## `locked_positions.tsv`

The 52,050 locked positions, newest first: `<fen>\t<w|b>\t<gameId>`. The FEN is the final position,
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
| `mateless` | `lock`, `domino` or `unproven` for the loser: the first rung that proves its opponent can never mate |
| `dead_position` | as above |
| `fen` | the final position |

## `second_version.tsv`

The 36 rows that Mateless's first version leaves unproven, and what the second version makes of
each (`test/second_version_check.js` holds the engine to it): `gameId`, `date`, `second_version`
(`lock-open-pair`, `lock-boxed`, `domino-deep`: the search's second tier, or `unproven`), `nodes`
(the nodes the searches played) and `fen` (the final position, the flagged side to move). The
other files keep the first version's classification.

## Reproducing

With chasolver's CSV (columns `gameId,date,utcTime,white,whiteElo,whiteTitle,black,blackElo,
blackTitle,timeControl,eco,lastMove,fen`):

```sh
cd rust && cargo build --release
target/release/mateless layers timeouts.csv > layers.tsv     # per row: gameId, class, nodes, failure
cut -f2 layers.tsv | sort | uniq -c                            # 141451 domino, 50970 lock, 36 none
```

`node test/rust_compare.js layers timeouts.csv` prints the same lines from `mateless.js`. The
scanned timeouts go through the same commands once written in that CSV form (the FEN as the 13th
column). The two scalachess columns come from mateless-scalachess (`check/lock/LockCheck.scala`:
`rows` with the `a` build for the patch; `check/ladder/Check.scala`: `rows` with the `ref` build,
today's scalachess, for the other). `in_game` is `scalachess_18_0_1`, or a `lock` row whose final
position in `locked_positions.tsv` the lock detector proves for both sides (`lockCannotMate` for
White and for Black; `Lock.scala` gives the same answers).
