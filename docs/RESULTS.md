# Results

Measured on a shared cloud machine (2 vCPU Xeon 2.8 GHz, Node 22, rustc 1.97, one thread);
separate runs move by ±5–10%, so ranges are given where runs differed. How the engine works is in
[DESIGN.md](DESIGN.md).

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
| the rest | 192,457 | the set Mateless classifies below |

### Classification

The class is the first rung that proves the flagged side's opponent can never mate. JS, Rust and
WebAssembly give the same class, node count and failure on every row.

| class | rows | share | Lichess today | with the lock patch | with the whole ladder |
|---|---|---|---|---|---|
| locked positions | 50,970 | 26.5% | 141 | 50,970 | 50,970 |
| forced lines (Domino) | 141,451 | 73.5% | 136,772 | 137,007 | 141,451 |
| unproven | 36 | 0.019% | 0 | 0 | 0 |
| **all** | **192,457** | | **136,913 (71.1%)** | **187,977 (97.7%)** | **192,421 (99.98%)** |

- *Lichess today*: scalachess 18.0.1's `opponentHasInsufficientMaterial`, which lila asks when a
  flag falls (`Finisher.outOfTime`), with the one-move lookahead of #821 (August 2026). The data
  predates #821: scalachess would have drawn ~70% of the rows of every month from 2017 to 2026.
- *The lock patch*: [mateless-scalachess](https://github.com/cuneytinann/mateless-scalachess)'s
  `a-lock`, the lock detector asked at the position and in #821's lookahead. Of the 51,064 rows it
  adds, 50,829 are locks at the position itself, 235 come through the lookahead (234 kings stepping
  out of a pawn's check into a lock, one lock after a forced capture of a rook).
- *The whole ladder*: `c-ladder`, or Mateless itself. No row that scalachess draws is missed.
- What the lock patch leaves: 4,444 forced lines of more than one move, and the 36 unproven rows.

By year (the lock class is a quarter of every year):

| year | rows | locked | forced lines | unproven | Lichess today | with the lock patch |
|---|---|---|---|---|---|---|
| 2013–2016 | 2,845 | 1,039 | 1,805 | 1 | 1,726 | 2,767 |
| 2017 | 3,509 | 926 | 2,583 | 0 | 2,502 | 3,430 |
| 2018 | 6,397 | 1,618 | 4,779 | 0 | 4,624 | 6,250 |
| 2019 | 10,825 | 2,812 | 8,012 | 1 | 7,744 | 10,558 |
| 2020 | 20,518 | 5,163 | 15,352 | 3 | 14,875 | 20,047 |
| 2021 | 26,920 | 6,424 | 20,489 | 7 | 19,767 | 26,200 |
| 2022 | 26,171 | 6,801 | 19,364 | 6 | 18,730 | 25,542 |
| 2023 | 28,224 | 7,595 | 20,616 | 13 | 19,938 | 27,543 |
| 2024 | 26,669 | 7,362 | 19,304 | 3 | 18,739 | 26,111 |
| 2025 | 26,417 | 7,473 | 18,942 | 2 | 18,367 | 25,868 |
| 2026 (to 31 July) | 13,962 | 3,757 | 10,205 | 0 | 9,901 | 13,661 |

By the move number at the flag fall:

| move | forced lines | locked | unproven |
|---|---|---|---|
| < 20 | 17 | 0 | 0 |
| 20–29 | 402 | 3 | 0 |
| 30–39 | 5,270 | 828 | 2 |
| ≥ 40 | 135,762 | 50,139 | 34 |

**Dead before the flag fell.** In 115,524 rows (60.0%) the final position is already dead: the
ladder proves that neither side can mate. Under FIDE 5.2.2 those games had ended, drawn, before
the flag fell, and a check after every move would have ended them then. In the other 76,933 only
the flagged side's opponent cannot mate; the flagged side still could, so only the flag-fall rule
(FIDE 6.9) draws them.

**The 36 unproven rows** (20 by the budget, 16 by the ply ceiling): 29 have only kings, pawns and
bishops, mostly corner cages (a king shut in a corner where taking the last pawn gives stalemate;
`FKr42ZRT`, `RwnQJq1k`) and pawn structures not yet locked; 7 have a queen or a rook. Their
halfmove clocks run from 0 to 70: none is lost to a move-count rule. chasolver's full search
proves all of them; a refund after the game would cover them.

**Files** ([data/](../data)): `timeouts_classified.tsv` (every row: game id, date, class, Lichess
today, with the lock patch, dead position) and `locked_positions.tsv` (the 50,970 locked
positions, with the side that cannot mate and the game id).

## 2. Speed against chasolver

**Rust against Rust.** Mateless's Rust port and the official chasolver 3.0.0 in one binary, with
chasolver's own build settings (LTO, one codegen unit). Positions are read beforehand and only the
decision is timed; positions run in chunks of 64, every chunk by both engines in an order that
rotates from chunk to chunk; the median of 7 rounds, two runs (`rust/examples/vs_chasolver.rs`).
The slowest position: the shortest of three calls on each.

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

- **Coverage:** chasolver proves all 201,060 rows, Mateless 201,024. On `lichess.txt` both prove
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

**JavaScript against JavaScript** (`test/fair_lock_bench.js`, chasolver from `chasolver.html`):
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
the scalachess port ~30–35 ns and ~150–190 ns.

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
| the locked rows of the data (cap 200,000) | 50,970 | 50,692 | 271.8 million | 0 |
| locks of chasolver's hard set (earlier run) | 636 | 538 | 15.4 million | 0 |

A certificate whose reachable set is enumerated completely is a proof for that position (no mate
anywhere in it); the rest are checked up to the cap. The general proof (the invariant holds at the
root, every legal move keeps it, no position that keeps it is a mate) is still to be written, and
then to be checked by machine.

**Equal answers across ports.**
- JS = Rust, byte for byte with node counts: the 201,060 rows, chasolver's labelled positions, the
  flags of thousands of games (`test/rust_compare.js`).
- JS = WebAssembly: chasolver's positions and the 192,457 rows (every field, both sides), the flags
  of games ply by ply (`test/wasm_check.js`).
- Both sides in one pass = each side alone: 929,595 positions, every field (`test/twosided_check.js`,
  `rust/examples/twosided.rs`).
- Rust's fast lock loop = the plain loop: 14.1 million side-positions (`rust/examples/lockcheck.rs`).
- The scalachess port (mateless-scalachess): the whole ladder = Rust byte for byte; the lock
  patch = `mateless.js` on 636,146 positions, both sides.
