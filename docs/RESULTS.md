# Results

Measured on a shared cloud machine (2 vCPU Xeon 2.8 GHz, Node 22, rustc 1.97, one thread);
separate runs move by ±5–10%, so ranges are given where runs differed. How the engine works is in
[DESIGN.md](DESIGN.md).

## The stuck mater after the first search; the third tier out of the engine (26 November 2026, evening)

The engine's ladder after a first search (3 plies, 10 nodes) that fails without a mate is now the
stuck mater move by move, then the second tier (9 plies, 5,000 nodes); the third tier of the
morning (150 plies, 5,000,000 nodes) is out of every engine (JS, Rust, WebAssembly) and is the
arbiter page's own, a box off by default, for analysis after the game (DESIGN.md, "After the first
search"). On chasolver's list of 19 November 2026 (204,484 rows):

| | unproven | the stuck mater proves | reach the second tier |
|---|---|---|---|
| the second version (JS, Rust, WebAssembly) | 2 (bKHPqNEw, RwnQJq1k) | 345 of the 645 the first search leaves without a mate | 300 |
| the same under the 75-move rule | 2 | 345 | 300 |
| the arbiter page, the third tier ticked, under the 75-move rule | 0 | | |

bKHPqNEw: both tiers fail on their horizons (12 nodes); the page's third tier proves it, 8,884
nodes in all. RwnQJq1k (clock 11): the 75-move rule's search runs only within 40 plies of the
rule's end (139 plies away), so the ladder leaves it; with the page's third tier the window is 150
plies and the rule's search proves it in 1,131,402 nodes (1,131,417 with the two tiers before it);
by itself the ladder proves it from clock 120 on. Of the 36 rows of `data/second_version.tsv` the
second version proves 34 (the morning's 35 less bKHPqNEw); no node count of the others changed.

Speed (JS, Node): the proof for the side to move, 3,000 positions of real games each,

| | without the rules | under the 75-move and fivefold rules |
|---|---|---|
| Lichess positions (`lic_fens`) | 0.024 ms (worst 3.0) | 0.012 ms (worst 3.0) |
| chasolver's positions.txt | 0.030 ms (worst 6.4) | 0.016 ms (worst 2.5) |

against the morning's engine with its third tier: 2.78 ms a position under the rules (Rust 894
µs) and 17.4 ms on positions.txt. The arbiter page (Chrome, page included) judges the 204,484 rows
in 3.8–4.0 s with the full version, 3.1–3.4 s with the third tier ticked, 3.2–3.3 s with the fast
version (runs move by ±10%); 20,000 rows in 784 ms (full) and 598 ms (fast). Rust and WebAssembly
give the same answers and node counts as JavaScript, `stuck` included (`test/rust_compare.js`,
`test/wasm_check.js`, `test/twosided_check.js`); clippy's warnings stay at 19.

## The search at 3 plies and 10 nodes, and the tiers (26 November 2026)

The figures below were measured with the Domino search at 6 plies and 100 nodes, its default
until 26 November 2026, and the second version's second tier at 9 plies and 10,000 nodes after a
failure on the budget or in a king's cage. Since then the first search is 3 plies and 10 nodes in
both versions, and the second version's further tiers (9 plies and 5,000 nodes, then 150 and
5,000,000) run after every failure without a mate. On chasolver's list of 19 November 2026
(204,484 rows), the flagged side's opponent:

| | unproven | reach the second tier | reach the third |
|---|---|---|---|
| the first version, 6 plies / 100 nodes | 36 | | |
| the first version, 3 plies / 10 nodes | 656 | | |
| the second version, the second tier only after a budget failure or a cage (its condition until 26 November) | 14 | 631 | |
| the second version, every failure without a mate goes on | 1 (RwnQJq1k) | 645 | 2 |
| the same under the 75-move rule | 0 | 645 | 2 |

RwnQJq1k (`8/7p/5p1P/5p1K/5Pp1/6P1/b3k3/8 w - - 11 51`): every tier fails on its horizon (the third
after 254 nodes); the 75-move rule's search, its window widened to the third tier's 150 plies,
proves it in 1,131,417 nodes. bKHPqNEw (`1k6/1P5p/BP3p2/1P6/8/8/5PKP/8 b - - 0 41`): the third tier,
8,884 nodes in all. In the arbiter page (Chrome, page included) the 204,484 rows take 4.0 s with
the third tier ticked, 3.3 s with the first version; the page before the change, 3.5 s. With the
rules' window widened to 150 plies for every side (a version of that day, never published) they
took 165 s: the check of the other side, for a dead position, ran the 75-move rule's search at
up to 5,000,000 nodes. Rust and WebAssembly give the same answers and node counts as JavaScript
(`test/rust_compare.js`, `test/wasm_check.js`).

## 1. The Lichess data

Miguel Ambrona's [chasolver](https://github.com/miguel-ambrona/chasolver) project scans the Lichess
open database for rated games lost on time although the opponent could never have mated. Up to
31 July 2026: 201,060 games, every one of them wrongly scored (the flagged side should have
drawn). Each row gives the game id, date, players, time control, last move and the final FEN, with
the flagged side to move.

| class | rows | |
|---|---|---|
| material | 8,139 | 2013–2020, most in 2016–2019; none after 2020: Lichess fixed its material rule around then |
| server stalemates | 464 | the flagged side had no legal move and was not in check: the game had ended in stalemate |
| the rest | 192,457 | classified below |

**August and September 2026** come from a scan of Lichess's monthly databases
(`lichess_db_standard_rated_2026-08` and `-09`: 91,912,325 and 89,616,462 rated games), every game
replayed move by move. A game counts when it was won other than by mate although the winner could
never have mated, and both chasolver and Mateless prove it; games won by a rules infraction are left
out. That gives 3,000 games: 2,830 lost on time, classified below with the rest, and 170 resigned
(below).

### Classification

The class is the first rung that proves the flagged side's opponent can never mate. JS, Rust and
WebAssembly give the same class, node count and failure on every row.

| class | rows | share | Lichess today | with the lock patch (in-game) | at the flag (a-lock) | with the whole ladder |
|---|---|---|---|---|---|---|
| locked positions | 52,050 | 26.7% | 141 | 52,034 | 52,050 | 52,050 |
| forced lines (Domino) | 143,201 | 73.3% | 138,431 | 138,431 | 138,669 | 143,201 |
| unproven | 36 | 0.018% | 0 | 0 | 0 | 0 |
| **all** | **195,287** | | **138,572 (71.0%)** | **190,465 (97.5%)** | 190,719 (97.7%) | **195,251 (99.98%)** |

- *Lichess today*: scalachess 18.0.1's `opponentHasInsufficientMaterial` (unchanged in 18.1.0,
  which Lichess uses now), which lila asks when a flag falls (`Finisher.outOfTime`), with the
  one-move lookahead of #821 (merged in August 2026; on Lichess from 6 September, judging by the
  data). The data up to July predates #821: scalachess would have drawn ~70% of the rows of every
  month from 2017 to 2026.
- *The lock patch*: [mateless-scalachess](https://github.com/cuneytinann/mateless-scalachess)'s
  `in-game`, the first half of the patch proposed for Lichess
  ([#916](https://github.com/lichess-org/scalachess/pull/916)): the lock detector as a dead-position
  check (FIDE 5.2.2) in scalachess's `autoDraw`, asked for both sides when the halfmove clock is 0
  or 1. A lock can appear only then: right after a capture or a pawn move, or one move later, once
  an en passant right has lapsed or a king has stepped out of a pawn's check. A row counts when
  Lichess draws it today or when its final position is a lock for both sides: the game would have
  ended, drawn, the moment it locked. That adds 51,893 rows, every one a locked position that ends
  before the flag falls. It leaves 16 locks of one side only (not dead: the flagged side could still
  mate) and the 238 rows that come through `a-lock`'s lookahead (the lock comes one move after the
  flag).
- *At the flag*: `a-lock`, the second half of #916: the same detector asked when a flag falls, at
  the position and in #821's lookahead. Of the 52,147 rows it adds, 51,909 are locks at the position
  itself, 238 come through the lookahead (237 kings stepping out of a pawn's check into a lock, one
  lock after a forced capture of a rook). Asked alone, it lets a dead game be played on until it
  ends.
- *The whole ladder*: `c-ladder`, or Mateless itself. No row that scalachess draws is missed.
- What the lock patches leave: 4,532 forced lines of more than one move and the 36 unproven rows;
  with `in-game` alone also those 254 (4,822 in all), with `a-lock` (and #916, which does both)
  4,568.
- The Lichess today and `a-lock` columns come from scalachess itself, built with and without the
  patch (mateless-scalachess's `check/`). The `in-game` column is Lichess today plus the rows whose
  final position the lock detector proves for both sides (`mateless.js`; `Lock.scala` gives the
  same answers on 3,643,939 positions).

By year, newest first. Up to August the lock class is about a quarter of every period. From
7 September, with #821 in use, the scan holds only the games Lichess still scored wrongly: of
those 460, 422 (92%) are locks, and both lock patches draw all of them (`in-game` before the flag
falls).

| year | rows | locked | forced lines | unproven | Lichess today | in-game | a-lock |
|---|---|---|---|---|---|---|---|
| 2026 September | 864 | 533 | 331 | 0 | 282 | 815 | 816 |
| 2026 August | 1,966 | 547 | 1,419 | 0 | 1,377 | 1,924 | 1,926 |
| 2026 (to 31 July) | 13,962 | 3,757 | 10,205 | 0 | 9,901 | 13,640 | 13,661 |
| 2025 | 26,417 | 7,473 | 18,942 | 2 | 18,367 | 25,822 | 25,868 |
| 2024 | 26,669 | 7,362 | 19,304 | 3 | 18,739 | 26,081 | 26,111 |
| 2023 | 28,224 | 7,595 | 20,616 | 13 | 19,938 | 27,509 | 27,543 |
| 2022 | 26,171 | 6,801 | 19,364 | 6 | 18,730 | 25,510 | 25,542 |
| 2021 | 26,920 | 6,424 | 20,489 | 7 | 19,767 | 26,171 | 26,200 |
| 2020 | 20,518 | 5,163 | 15,352 | 3 | 14,875 | 20,021 | 20,047 |
| 2019 | 10,825 | 2,812 | 8,012 | 1 | 7,744 | 10,546 | 10,558 |
| 2018 | 6,397 | 1,618 | 4,779 | 0 | 4,624 | 6,238 | 6,250 |
| 2017 | 3,509 | 926 | 2,583 | 0 | 2,502 | 3,425 | 3,430 |
| 2013–2016 | 2,845 | 1,039 | 1,805 | 1 | 1,726 | 2,763 | 2,767 |

By the move number at the flag fall:

| move | forced lines | locked | unproven |
|---|---|---|---|
| < 20 | 17 | 0 | 0 |
| 20–29 | 407 | 3 | 0 |
| 30–39 | 5,344 | 843 | 2 |
| ≥ 40 | 137,433 | 51,204 | 34 |

**Dead before the flag fell.** In 117,455 rows (60.1%) the final position is already dead: the
ladder proves that neither side can mate. Under FIDE 5.2.2 those games had ended, drawn, before
the flag fell, and a check after every move would have ended them then. The `in-game` patch is that
check for locks: it ends the 51,893 locked ones that Lichess misses today. In the other 77,832 only
the flagged side's opponent cannot mate; the flagged side still could, so only the flag-fall rule
(FIDE 6.9) draws them.

**Dead games played on.** Not only timeouts: in August and September, 8,718 drawn games (mostly
threefold repetitions and agreed draws) went on for a median of 14 plies after their position had
become a lock for both sides, about 41 hours of clock time in all. `in-game` ends each of them the
moment the lock appears; `a-lock`, asked only at a flag, does not.

**Resignations.** Of the 3,000 scanned games, 170 were resigned in a position where the opponent
could never mate: under FIDE 5.1.2 a draw, on Lichess scored as a loss. 95 are locks and 75
forced lines; in 158 the position was already dead. In all 95 locks the final position is a lock
for both sides: `in-game` would have ended those games, drawn, before the resignation.

**The 36 unproven rows** (20 by the budget, 16 by the ply ceiling; all up to July 2026):
- 32 are cages whose reachable positions include stalemates: mostly a king shut in a corner, where
  taking the last pawn gives stalemate (`FKr42ZRT`, `RwnQJq1k`); 6 of them have a queen or a rook.
- 3 hold an open pawn pair: a white and a black pawn on one file with one empty square between
  them, the rest locked (`GyWj6Ymz`, `azjorRHB`, `lBSDAx07`). The lock detector does not take the
  pair as fixed (DESIGN.md, section 7).
- 1 has a knight boxed in by its own pawns (`hPiwD75i`; DESIGN.md, section 7).

An exhaustive enumeration of the positions reachable from each (move clocks ignored) closes every
one without a mate, the largest at 7,950 positions (under 0.1 s in JavaScript). Their halfmove
clocks run from 0 to 70: none is lost to a move-count rule. chasolver's full search proves all of
them; a refund after the game would cover them.

**Files** ([data/](../data)), newest game first: `timeouts_classified.tsv` (every row: game id,
date, class, Lichess today, at the flag with `a-lock`, dead position, with `in-game`),
`locked_positions.tsv` (the 52,050
locked positions, with the side that cannot mate and the game id) and `lichess_2026-08_09.tsv`
(the 3,000 scanned games with their final positions, resignations included).

## 2. Speed against chasolver

**Rust against Rust.** Mateless's Rust port and the official chasolver 3.0.0 in one binary, with
chasolver's own build settings (LTO, one codegen unit). Positions are read beforehand and only the
decision is timed; positions run in chunks of 64, every chunk by both engines in an order that
rotates from chunk to chunk; the median of 7 rounds, two runs (`rust/examples/vs_chasolver.rs`).
The slowest position: the shortest of three calls on each. The sets are chasolver's rows up to
31 July 2026; the speeds were measured before the August and September rows were added.

| set | positions | chasolver fast check | Mateless (static + Domino 6/100) | ratio | slowest position (chasolver / Mateless) |
|---|---|---|---|---|---|
| **locked** | 50,970 | 6.46–6.52 µs | 0.093 µs | **~70×** | 19–34 µs / 0.2 µs |
| locked, computation only (512, hot cache) | 512 | 5.70–5.77 µs | 0.058–0.062 µs | ~93–100× | |
| material | 8,139 | 0.30 µs | 0.011 µs | ~27× | 0.5 µs / 0.1 µs |
| forced lines | 141,941 | 0.90–0.91 µs | 0.237 µs | ~3.8× | 580 µs / 13 µs |
| **all 201,060 rows** | 201,060 | 3.97–4.05 µs | 0.224–0.235 µs | **~17–18×** | 302–308 ms / 13–20 µs |
| real game positions (chasolver's `lichess.txt`, both sides) | 131,072 | 2.41 µs | 0.563 µs | ~4.3× | 522–861 µs / 5–34 µs |

Both sides at once (a dead position, a game's two flags): chasolver's fast check answers for one
colour and was called twice; Mateless answers both in one pass (`BOTH=1`, 5 rounds):

| set | positions | chasolver (two calls) | Mateless (each side alone) | Mateless (both at once) | ratio |
|---|---|---|---|---|---|
| **all 201,060 rows** | 201,060 | 6.52 µs | 0.54 µs | 0.41 µs | **~16×** |
| `lichess.txt` | 131,072 | 3.90 µs | 0.95 µs | 0.54 µs | ~7.3× |
| game positions (1,500 games, every ply) | 136,000 | 3.81 µs | 0.56 µs | 0.34 µs | ~11× |

- **Coverage:** chasolver proves all 201,060 rows, Mateless 201,024. Coverage is counted on
  chasolver's list alone: the 3,000 scanned rows were chosen as rows both prove. On `lichess.txt` both prove
  all 2,410 side-positions labelled "cannot mate".
- **Cold and hot:** Mateless's lock test is so short that on 50,970 positions reading them from
  memory is ~30% of its time. 512 positions run again and again in a hot cache time the
  computation alone. In a game the position is already in the cache, closer to the hot figure.
- **The total:** most of the difference comes from 10 hard rows. chasolver proves each in ~29 ms on
  average (~0.3 s at worst); Mateless gives up on them in a few µs. Without those 10: chasolver
  2.06 µs, Mateless 0.17 µs, ~12×.
- **No equal budget exists:** chasolver's fast check has no node budget but fixed depths (4 or 7
  plies full width without memory, 15 plies on blocked structures, a closure of at most 3,000
  positions). With a budget 20 times larger (9 plies / 2,000 nodes) Mateless runs as fast on the
  data (~0.2 µs) and leaves 10 rows unproven.
- chasolver's README gives 1.4 µs on average for its fast check over 10 million real timeouts
  (Xeon w3-2435); those are mostly games really won, closer to the `lichess.txt` line here.

**Why the gap on locks is structural.** chasolver's fast check spends its time on a locked row
(measured on its JavaScript port, ~46 µs a row): forced moves 1.9 µs, a 7-ply search that finds
nothing 7.7 µs, **the static analysis 32.3 µs**, the rest 4.0 µs. Without the search, its static
analysis alone is ~45× slower than Mateless's lock test. On the 51,058 rows of chasolver's own
"blocked" list, 99.6% are proven by that static analysis.

**JavaScript against JavaScript** (`test/fair_lock_bench.js`, chasolver's JavaScript port from `site/chasolver/engine.js`):
~85–95× on locks, ~5× on forced lines. These ratios flatter Mateless: the JavaScript port of
chasolver runs 5–9× slower than the official Rust build, Mateless's JavaScript 3–5× slower than its
own Rust. Rust against Rust is the comparison to quote.

## 3. Other speeds

| | JS | WebAssembly | Rust |
|---|---|---|---|
| both proofs, `lichess.txt` (positions read beforehand) | 2,313 ns | 847 ns | 448 ns |
| the same, the FEN read in the call | 4,806 ns | 1,909 ns | |
| a game's flags, per ply (600 games) | ~1,700 ns | ~555 ns | 381 ns |
| the static tests (`cannotMate2`) | 74 ns | 72 ns | 14 ns |

(Node; in Chromium the ratios are alike: ~3.1× for both proofs.) The lock detector alone, per
call: Rust ~9 ns when a knight, rook or queen stands (most positions of a game), ~105 ns on a lock;
the scalachess port ~30–35 ns and ~150–190 ns. In scalachess's `autoDraw`, which lila asks after
every move, `in-game` adds ~7 ns per move on a mix of positions from games' openings and ~10 ns on
a mix from their endgames (medians on JVM 21: 10.1 → 16.9 and 13.8 → 23.9 ns); the detector runs
only at halfmove clock 0 or 1, and with a knight, rook or queen on the board it stops at once.

## 4. Soundness

There is no written proof; this is the test evidence.

**Verdicts.**
- chasolver's labelled positions (`positions.txt`, `lichess.txt`: 68,950 positions, both sides):
  no false draw (`test/classify.js 6 100 1`). Three positions labelled as mates are skipped: in all
  three a king stands in a double check by two bishops of one colour, which no game can reach (the
  page rejects them as invalid FENs). The material test, like scalachess's, makes no promise for
  unreachable positions.
- Games played move by move with `Game`, from chasolver's positions and from the last positions of
  the Lichess data: at every flag that came down, chasolver's full solver was asked
  (`test/game_flags_check.js`). 7,000 games and 5,338 flags with this engine, 10,300 games and
  5,706 flags with the engine before; no mate found, no undecided answer.
- On chasolver's hard set (`positions.txt`, composed positions) Mateless proves 1,368 of the 2,877
  side-positions labelled "cannot mate"; for the rest the flag stays up. That set is not its aim.

**Lock certificates against chasolver's full search.** Positions the lock detector certifies,
built by mutating chasolver's positions and as random locked structures (bishops, kings side by
side), fed to chasolver's `winnability` (`test/fuzz_lock_gen.js`, `rust/examples/oracle.rs`):
23,001 of 23,001 unwinnable in a fresh run with this build; 54,587 of 54,587 in earlier runs (with
an earlier detector whose certificates include all of today's). All 50,970 locked rows of the data:
unwinnable.

**The invariant check** (`test/lock_invariant.js`) tests the reasoning, not the verdict. The fixed
point of a certificate states an invariant: in every position reachable from it,
1. every pawn stands in its side's cone;
2. every fixed pawn stands on its square;
3. each king stands in its reach, a frozen king on its square;
4. every bishop stands in its side's bishop reach;
5. no knight, rook or queen appears;
6. no piece count grows (no promotion);
7. the flagged king is not checkmated.

From each certificate the check enumerates every reachable position (move clocks ignored), up to
a cap per certificate, and tests the seven points in each. A hole in the reasoning shows up as a
violated point even before it could lead to a false draw. The check itself was tested on two
deliberately broken detectors: without the twin-bishop guard it found 9 real mates; with a rule
"an immobile bishop protects" it caught a fixed pawn falling before any mate arose.

| set | certificates | reachable set enumerated completely | positions visited | violations |
|---|---|---|---|---|
| the locked rows of the data up to July 2026 (cap 200,000) | 50,970 | 50,692 | 271.8 million | 0 |
| the locks of August and September 2026, timeouts and resignations (cap 200,000) | 1,175 | 1,171 | 5.8 million | 0 |
| locks of chasolver's hard set (earlier run) | 636 | 538 | 15.4 million | 0 |

A certificate whose reachable set is enumerated completely is a proof for that position (no mate
anywhere in it); the rest are checked up to the cap. The general proof (the invariant holds at the
root, every legal move keeps it, no position that keeps it is a mate) is still to be written, and
then to be checked by machine.

**Equal answers across ports.**
- JS = Rust, byte for byte with node counts: the 204,060 rows (chasolver's list and the scan), chasolver's labelled positions, the
  flags of thousands of games (`test/rust_compare.js`).
- JS = WebAssembly: chasolver's positions and the 192,457 rows (every field, both sides), the flags
  of games ply by ply (`test/wasm_check.js`).
- Both sides in one pass = each side alone: 929,595 positions, every field (`test/twosided_check.js`,
  `rust/examples/twosided.rs`).
- Rust's fast lock loop = the plain loop: 14.1 million side-positions (`rust/examples/lockcheck.rs`).
- The scalachess port (mateless-scalachess): the whole ladder = Rust byte for byte; `Lock.scala`
  (one file, in `in-game` and in `a-lock`) = `mateless.js` on 3,643,939 positions, both sides. On
  the same positions `in-game`'s `autoDraw` is today's, or the halfmove clock at 0 or 1 and the
  lock for both sides, without exception.

<a id="the-second-version"></a>

## 5. The second version

The second version's rules (open pawn pairs, boxed knights, rooks and queens, a second tier of the
Domino search; [DESIGN.md](DESIGN.md), section 12), measured on the same data. The data files keep
the first version's classification; `data/second_version.tsv` lists the 36 rows it leaves and
what the second version makes of each.

**Coverage.**

| | first version | second version |
|---|---|---|
| chasolver's Lichess rows up to July (201,060), proven | 201,024 | **201,054** (201,058 with the four rules of November, below) |
| of the 36 unproven: by the open-pair rule | | 3 (GyWj6Ymz, azjorRHB, lBSDAx07) |
| by the boxed rule | | 1 (hPiwD75i) |
| by the second tier (238–1,360 nodes each) | | 26 |
| left: cages that hold only because the capture that opens them gives stalemate | 36 | 6 |
| chasolver's labels (68,950 positions, both sides): static proofs | 3,334 | 3,430 (+12 open pairs, +84 boxed) |
| the same, proven by a search | 394 | 421 |
| false draws | 0 | 0 |

Coverage is counted on chasolver's list: the 3,000 rows of the August–September scan were chosen
as rows that both chasolver and Mateless prove, so both versions prove all of them. Every other row
keeps its class: of the 204,060, only those 30 change (26 unproven → Domino,
4 unproven → lock). The four rules of November change more (below).

**Speed against chasolver**, both versions in the same runs as chasolver's fast check (Rust, one
binary, `rust/examples/vs_chasolver.rs`, median of the rounds; the machine was loud, chasolver
itself moved by up to 37% between runs, so read the ratios):

| set | chasolver fast check | first version | ratio | second version | ratio |
|---|---|---|---|---|---|
| locked (52,050) | 6.98 / 7.78 µs | 0.092 µs | ~76× | 0.097 µs | ~80× |
| all rows (204,060), static + Domino 6/100 | 4.68 / 4.40 µs | 0.264 µs | ~18× | 0.254 µs | ~17× |
| all rows, the whole ladder (second tier too) | 4.61 µs | | | 0.221 µs | ~21× |
| `lichess.txt`, both sides (65,536) | 4.80 / 6.60 µs | 0.684 µs | ~7.0× | 0.911 µs | ~7.2× |

The whole ladder's slowest row is a second-tier proof: 60 µs (w1GmdvNK, 1,360 nodes).

**A game's flags, per move** (1,000 games from chasolver's Lichess positions, 148,067 plies; each
engine in its own process, pinned to one core, 12 processes each):

| | first version | second version |
|---|---|---|
| Rust (fastest / median) | 422 / 443 ns | 439 / 448 ns |
| JS (fastest / median) | 2,064 / 2,331 ns | 2,175 / 2,393 ns |

Per move the second version asks ~1.8 lock tests that meet a knight, rook or queen (each ~2 ns
longer in Rust, ~10 ns in JS: the quick look for boxed pieces), meets an open pair in 1 of 127
moves, and runs the second tier at 3 moves in 148,067. In these 1,000 games no flag comes down at
another ply than in the first version.

**Checks.**

| check | what | result |
|---|---|---|
| chasolver's labels (`classify.js 6 100 1`) | every verdict, both sides | false draws 0 |
| boxed pieces against the golfed engine's detector (`[boxed]`, from the history) | 350,057 positions with a knight, rook or queen (chasolver's, and locks with pieces added), both sides | the same answer everywhere (5,165 boxed locks among them) |
| invariant (`lock_invariant.js`) | 5,081 boxed and 13,085 open-pair certificates | 61.2 million positions, 0 violations; all but 15 enumerated completely |
| chasolver's full analysis (`rust/examples/oracle.rs`) | the 5,081 boxed locks; 20,000 fuzzed certificates (`fuzz_lock_gen.js`: 232 open pairs, 2,372 boxed among them) | every one unwinnable |
| flags in games (`game_flags_check.js`) | 7,000 games from chasolver's positions, boxed and open-pair positions and the timeouts | no flag down where chasolver finds a mate |
| JS = Rust (`rust_compare.js`) | the 204,060 rows, chasolver's labelled files, 286,236 boxed candidates, 3,000 games | byte for byte, node counts included |
| JS = WebAssembly (`wasm_check.js`) | chasolver's positions, 2,000 games | 0 differences |
| both sides at once = each alone | 538,094 positions (JS), 482,630 (Rust) | 0 mismatches |
| trigger = clock rule (`trigger_check.js`) | with boxed and open-pair positions: 156,866 positions, 57,325 games, 66,597 takebacks | 0 differences |
| quiet knight, rook and queen moves | 2,436,600 such moves from boxed and chasolver positions | no lock after any |
| Rust fast loop = plain loop (`lockcheck.rs`) | 25.6 million side-positions | the same |
| the 36 rows and each rule's positions (`second_version_check.js`) | | 0 problems |

<a id="the-four-rules-of-november"></a>

### The four rules of November

The stalemate guard, the check seed, the stuck mater and the forced step
([DESIGN.md](DESIGN.md), section 12), in the JavaScript, Rust and WebAssembly engines (Rust and
WebAssembly since 21 November, below). On the 204,060 rows, the flagged side:

| | second version before | with the four rules |
|---|---|---|
| lock (the detector alone) | 52,176 | **52,657** (+481; none lost) |
| of chasolver's 201,060 rows, lock | 51,001 | 51,478 |
| of chasolver's 201,060 rows, the whole ladder | 201,054 | **201,058** |
| of the 36 the first version leaves, unproven | 6 | **2** (RwnQJq1k, bKHPqNEw) |
| chasolver's labels (both sides): static proofs | 3,430 | 3,488 |
| false draws | 0 | 0 |

The rows they move to the lock were proven by the Domino search before (or were a stalemate at the
root): in the search's terms the trees get shorter too, and 6 of the 36 rows that needed the second
tier now close in the first (`data/second_version.tsv`).

**Soundness.** Every one of the 481 new locks was checked by walking all the positions reachable from
it (move clocks ignored, every promotion): 224,967 positions, no mate of the flagged side. The same
for the new locks of positions made by moving the kings of the 204,060 rows' structures to random
squares, side to move at random (several seeds, ~20 variants per structure): every legal one walked
to the end, no mate. The stuck mater was checked against the moves themselves on 1,837,085 legal
positions (the rows, both sides to move; chasolver's labelled positions; king-moved variants): of
2,116 it proves, all are right. `test/lock_invariant.js` finds no violation on the 481 certificates
(all walked to the end) nor on the earlier ones it was run on (positions.txt, every 2nd: 353, 7.6
million positions; a sample of 2,053 locks of the 204,060 rows: 8.0 million). `game_flags_check.js`:
no flag comes down where chasolver's full analysis finds a mate (6,000 games); `trigger_check.js`:
0 problems.

**Speed** (JavaScript, the 204,060 rows, best of 5, three rounds): the lock test ~140 → ~160 ns
(+~13%), the whole ladder ~670 → ~700 ns per row (+~4%), a game's flags ~2% per move.

**Rust and WebAssembly** (21 November, with twin bishops): the same rules, line for line
(`rust/src/lock.rs`). JS = Rust byte for byte, node counts included (`rust_compare.js`): the 204,060
rows, chasolver's two labelled files, and 166,181 legal positions of this section's analyses (the new
locks, the king-moved variants, the twin-bishop sets). JS = WebAssembly (`wasm_check.js`): 273,010
positions and 2,000 games, 0 differences; `trigger_check.js` with `mateless.wasm`: 0 problems. The
fast loop = the plain loop (`lockcheck.rs`, both with the guard and the seed): 11.8 million
side-positions; both sides at once = each alone (`twosided.rs`): 370,241 positions, 0 mismatches.
Speed (Rust, the 204,060 rows): the lock test for both sides ~40 → ~54 ns (+~16% instructions,
counted with Valgrind); the whole ladder per row, both sides, ~300 → ~320 ns (+~5% instructions);
one side's ladder over all the rows the same within the noise (~255 ms with reading the file).

**The 20 languages** (21 November): the second version in its simplest form (`lock/second/`, one
unified level that grows every set in each pass) is written in the 20 languages of `lock/`. Its
JavaScript form matches `mateless.js`'s `lockCannotMate`, both sides, on 220,349 distinct positions
(the rows, the stress positions above, both test files of `lock/`). `lock/second/positions.tsv`
holds 60,471 positions labelled by `mateless.js`, with 6,541 answers the first version does not give
(5,651 from the new level, 618 forced steps, 114 boxed pieces, 92 open pairs, 66 stuck maters);
every language gives all of them (`sh test-all.sh`: 20 passed). The first version's language files
answer 3,353 of these positions otherwise, so the file tells the two apart.

<a id="twin-bishops"></a>

### Twin bishops

Two or more bishops of one side on one colour no longer fail the second version; the mating net
leaves out its second flight rule on the king squares where the flagged side's twins may hold both
flights ([DESIGN.md](DESIGN.md), section 12). The Lichess data has no such row that the lock could
newly prove beyond 4 answers of bishops-only positions (already won by material or the search).
chasolver's labelled positions (68,950; 899 with twins): 227 more side answers proven by the lock,
none lost, no false draw.

**Soundness.** The danger is real: with the gate gone and the second rule counted everywhere, lock
structures of the 204,060 rows given two flagged bishops of one colour and (mostly) a mater's bishop of
the other, kings at random (139,679 legal positions), yield 1,732 locks of which chasolver's full
analysis finds 190 winnable, such as `5k2/2b4B/1p3b2/pPp1p1p1/P1P1P1P1/7K/8/8 w`, Black flagged: a mate
in 23 plies ending with Black's king on a8, its dark bishops on a7 and b8, White's light bishop on c6
(replayed by the engine: checkmate). With the rule as it is, the same positions yield 1,152 locks and
chasolver finds every one unwinnable. On chasolver's 227: `test/lock_invariant.js` finds no violation
(9.1 million positions visited, cap 50,000 each); walking their reachable positions to the end (cap 2
million each), done for 101 of them, found no mate (64 walked to the end, 37 past the cap).

