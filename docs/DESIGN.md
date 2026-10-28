# Design

How Mateless works, and why it works that way. The measurements behind the choices are here;
the results on the Lichess data are in [RESULTS.md](RESULTS.md). Measured on a shared cloud
machine (2 vCPU Xeon 2.8 GHz, Node 22, rustc 1.97); absolute times move from run to run, the
ratios within one run do not.

## 1. The question

*Can this side still mate by some series of legal moves?* Both sides may cooperate: the question
is a helpmate, not a fight. That is FIDE's test for a dead position (5.2.2: neither side can
mate), for a flag fall (6.9: the player whose time runs out loses unless the opponent cannot mate)
and for a resignation (5.1.2, the same).

It is a much stricter condition than a **fortress**, where a side cannot win against best
defence. Fortress detection belongs to engines; used by an arbiter it would declare false
draws. Mateless answers only the helpmate question, and only with a proof: a side's flag comes
down when a rung of the ladder proves the side can never mate, and never otherwise. A position it
cannot prove keeps its flag up: the platform's rule applies (the flag loses), and a complete
solver can judge it after the game.

### Related work

| work | what it does | difference |
|---|---|---|
| [chasolver](https://github.com/miguel-ambrona/chasolver) (Miguel Ambrona, [FUN 2022](https://drops.dagstuhl.de/storage/00lipics/lipics-vol226-fun2022/LIPIcs.FUN.2022.2/LIPIcs.FUN.2022.2.pdf); Rust, MIT) | Searches for a helpmate in the given position or proves there is none; complete. Version 3.0 has a sound but incomplete fast check, `is_unwinnable_fast`. | On locked positions the fast check runs a search first, then a static analysis piece by piece. Mateless does not search for a lock, and reasons about a whole side at once. |
| Blockage detection (David-Tabibi, Felner, Netanyahu, ICGA 2004; [CPW](https://chessprogramming.org/Blockage_Detection)) | Finds pawn-endgame blockades in engines, with fences and flood fills on bitboards. | "Unwinnable against best defence": a fortress test, not a dead-position test. |
| D3-Chess, [clean-chess](https://github.com/dlbbld/clean-chess) | chasolver's predecessor (CHA) in C++, and in Java | |
| [lila #4640](https://github.com/lichess-org/lila/issues/4640) | A proposal to check pawn fortresses on Lichess | Not implemented. |
| [lila #9249](https://github.com/lichess-org/lila/issues/9249) | Ambrona's proposal (2021) to use chasolver on Lichess | The discussion stalled on how: a separate service, or thousands of lines of search to port to Scala. |

## 2. The ladder

| rung | file | reads | cost |
|---|---|---|---|
| 1. material test | `src/material.js` | the piece sets | ~0.1 µs (JS), 1–3 ns above an empty loop (Rust) |
| 2. lock detector | `src/lock.js` | pawns, kings, bishops, the en passant square | ~0.3–0.8 µs (JS), ~50–110 ns (Rust) on a lock; a few ns when a knight, rook or queen stands |
| 3. Domino search | `src/domino.js` | legal moves, made and taken back in place | ~1–5 µs (JS) |
| 4. second tier (second version) | `src/ladder.js` | the same, 9 plies and 10,000 nodes, only after a failure the deeper search can mend | up to 10,000 nodes, at a few plies of a game |

Rungs 2 and 4 carry the second version's rules (section 12); the first version is rungs 1–3 with
the lock detector's first version.

Each proof is permanent. Material never grows back (only a promotion adds a piece, and that needs
a pawn the test counts). A lock or a Domino proof says that no series of legal moves from here
leads to a mate, and every later position of the game is reached from here by legal moves. So a
side's flag, once down, stays down, and that side is never examined again; when a flag falls the
verdict is read from the opponent's flag, with nothing to compute.

## 3. Rung 1: the material test

The mater cannot mate when
- it has nothing but its king; or
- there are no pawns at all, it has bishops of one colour and nothing else, and the flagged side
  has no knight and no bishop of the other colour; or
- there are no pawns at all, it has one knight and nothing else, and the flagged side has no
  bishop, knight or rook (queens do not count).

It is the same set as scalachess's `InsufficientMatingMaterial`: 0 differences on every
combination of material with each side 0–2 pawns, knights, light and dark bishops and queens and
0–1 rooks, either side to move (944,784 questions), and on 1.27 million questions from real
positions. Each fact is read straight off the bitboards, the commonest first: a rook or a queen
of the mater answers at the first read.

## 4. Rung 2: the lock detector

It certifies, in positions with kings, pawns and bishops only, that the flagged side can never be
mated. Any knight, rook or queen on the board, two bishops of one side on squares of one colour
(only a promotion makes that), or an en passant square fails it at once.

### The whole structure at once

chasolver's static analysis keeps a reach for every piece and derives from them the pieces that
cannot move, the squares that cannot be entered, the pieces that can be captured or sacrificed;
then it tries every way the flight squares of a candidate mating square could be covered. That is
fine-grained and combinatorial. Mateless keeps one set per side and kind:

| set | meaning | moves |
|---|---|---|
| `wCone`, `bCone` | every square a side's pawns may still reach | grows |
| `wFixed`, `bFixed` | a side's pawns that can never move | shrinks |
| `wKing`, `bKing` | every square a king may ever stand on | grows |
| `wBish`, `bBish` | every square a side's bishops may ever stand on | grows |
| `bTake`, `wTake` | squares where a side may ever take an enemy pawn | grows |
| `wWall`, `bWall` | a side's pawns the other side can never take, and a frozen king | shrinks |

They feed each other in one cycle: the walls decide which pawns are fixed; a king's reach floods
from its square, never onto a square that a fixed enemy pawn attacks; the squares where a side
may take grow from its king's reach; a pawn that can be taken is no wall. Every update is
monotone, so the cycle reaches a fixed point whatever the order of the steps.

At the fixed point the structure **leaks**, and the certificate fails, if a pawn can promote, a
pawn can capture, a bishop can reach a pawn's path, or the flagged king can reach a square the
mater's pawns or bishops attack where it has no guaranteed flight. A square is *free* when the
flagged side's pawns never reach it, the mater's pawns and bishops never attack it and the mater's
king never comes next to it. A king has a guaranteed flight when a free square that its own
bishops never reach lies beside, above or below it, or when two free squares do, one above or
below and one beside.

The certificate is tried up to three times: with both kings free, then with the white king, then
the black king **frozen** on its square (a wall for both sides, which must turn out unable to
move). A level is tried only when every square around its king holds a pawn or is attacked by
one; otherwise it would fail its own check anyway.

What each part buys on the 50,970 locked Lichess rows: without the frozen-king levels 271 are
lost, without the flights of the mating net 1,164, without the bishops 3,563. The twin-bishop
guard is needed: without it the detector finds 64 false locks (two bishops of one colour can
block their own king's flights).

### Fast, and the same fixed point

The plain loop updates all ten sets on every pass. They do not all depend on each other: the
cycle is walls → fixed pawns → king reaches → capture squares → walls, and the cones and the
bishops' reaches are read only by the leak tests. So the cycle runs alone, on six sets, flooding
each reach to its end against the walls of the pass; a pass that finds the walls and the fixed
pawns as they were stops at once. The cones and the bishops' reaches are computed once, at the
end. The cones and the capture squares are occluded fills (Kogge-Stone, three shifts each); both
kings flood in one loop. On Lichess locks the cycle runs one full pass and one that stops at once
(growing every set by one step per pass takes ~11 passes); 99.5% of the locks are proven at the
first level.

The Rust engine keeps the plain loop as `lock_test_reference`; on 14.1 million side-positions the
two give the same verdict (`rust/examples/lockcheck.rs`). Per call, on a lock (Rust): ~53 ns with
a hot cache, ~81–105 ns cold.

### Independent of the search

The detector generates no move. The search uses it as a leaf test, not the other way round. In
`3k4/8/8/1p1p1p1p/1P1P1P1P/8/3q4/3K4 w` White's only move is Kxd2, then a lock stands. The
detector says "no lock" at the root (a queen is on the board); the Domino search proves the draw
in one node; and in a game played move by move this position is already a dead position.

## 5. Rung 3: the Domino search

A helpmate search, depth first, named for the chains of forced moves it mostly follows: the king
must take, then the position falls into a lock or bare material. The side to move tries its pieces
in board order (a1, b1 … h8), each piece's targets in the same order, promotions queen, rook,
bishop, knight; no heuristics. A line ends safely in a position already met, a static proof
(rungs 1 and 2) or a stalemate. A mate, the ply ceiling (`horizon`) or the node budget (`budget`)
fails the proof at once: the answer is then "unknown", never "a win". Plies are half-moves; a node
is one move played, each promotion counted apart.

**No move-count rule.** To say "no mate", the search must show that no line mates even if the
game went on for ever. The 75-move rule and fivefold repetition only cut lines short, so a proof
without them holds with them too; leaving them out can cost a proof (a mate that comes after the
75-move limit makes the search fail), never make a false one. chasolver's fast check does not read
the halfmove clock either. On the Lichess data the clock at the flag fall: 0–49 in 191,527 rows,
50–99 in 9,532, 100–139 in 1, none above.

**6 plies, 100 nodes.** Nodes a proof needs (the 141,951 rows the static tests miss, at 9 plies):
median 1, 90% ≤ 4, 99% ≤ 8, 99.9% ≤ 33, at most 1,354.

| ply (budget 100) | rows unproven (of 201,060) | cost per move (random games, both sides) |
|---|---|---|
| 2 | 328 | |
| 3 | 54 | |
| 4 | 38 | 3.2 µs |
| **6** | **36** | **4.3 µs** |
| 8 | 36 | 5.4 µs |
| 20 | 36 | 12.1 µs |

| budget (9 plies) | rows unproven | worst search |
|---|---|---|
| 50 | 55 | ~70 µs |
| **100** | **36** | ~100 µs |
| 500 | 18 | ~290 µs |
| 2,000 | 10 | ~480 µs |

Above 6 plies the budget, not the ceiling, ends the proofs; a failing search in an open position
runs its first line down to the ceiling, so the cost grows linearly with the plies.

The search plays the same nodes in the same order in every port (JS, Rust, WebAssembly, Scala):
that is what makes their outputs comparable byte for byte, node counts included. Every speedup kept
that order: moves recorded in the search's own frame, a set of positions met that starts at 256
slots (it fits in the first-level cache), pawns that cannot move skipped, and "is there a
legal move?" looking first at the pawn pushes, knight steps and slider rays of pieces that are not
pinned (the king's moves need the enemy's attacks, so they come later).

## 6. When the static tests are asked

A test is asked only after a move that can have changed its answer (`testsAfter`, `src/lock.js`):

- the **material test** reads the pieces only: after a capture or a promotion;
- the **lock detector** reads the pawns, the squares of the kings and bishops, and the en passant
  square: after a capture, a pawn move, a move made while an en passant right stood (the right
  lapses; the detector fails while it stands), and **a king's step out of a pawn's check**;
- neither while an en passant square stands.

Any other king or bishop move stays inside its reach and leaves the fixed point as it was; a
bishop's check changes nothing (the kings' reaches do not look at bishops); a knight, rook or
queen fails the detector whatever it does.

**The pawn's check.** In `8/2b5/kp1p1p2/1PpP1Pp1/K1P3P1/3B4/8/8 b` the pawns are locked, Black's
king stands on a6 and the b5 pawn gives check. A king's reach floods from the square it stands on,
and its starting square counts even when it is attacked. From a6 the reach runs to a5 (no white
pawn attacks it), b4, a3, behind White's pawns: no lock. After Ka7 or Kb7, a6 is outside the reach
(b5 attacks it) and b6 is Black's own pawn: the king is shut in on the 7th and 8th ranks, the
position is dead. A king move alone changed the answer, but only because the king started in a
pawn's check.

**The clock rule.** The rule before was: both tests whenever the halfmove clock is at most 1 and
no en passant square stands, that is after every capture or pawn move and one ply later. It needs
no memory of the move before, and it covered the pawn's check without knowing it: a pawn's check
comes only from a pawn move (clock 0), the step out of it one ply later (clock 1).

**In the search** the last move is known, so the rule costs nothing. **In a game** (`Flags.update`)
only the position is given. Both tests are asked when the clock is 0; the lock also when the ply
before had an en passant square or the side to move was in a pawn's check. The flags remember those
two facts (`updatedEp`, `updatedCheck`). The first update asks both, whatever the last move was.

**Takebacks.** That memory brought a new danger. In `4k3/8/8/p1p1p3/P1P1Pp1p/1B3P1P/8/4K3 b - e3`
Black plays fxe3, the move is taken back, and Kf8 is played instead. The en passant right lapses
and the position is dead: both flags should come down at ply 1. But the flags, remembering "no en
passant square the ply before" from the line taken back, would not ask the lock; no capture or
pawn move follows in a locked position, so the lock would never be asked again, and a flag fall
would be scored as a win. Two parts fix it, in every port:
- the memory is used only when it belongs to the ply just before (`memoryPly`); otherwise (plies
  left out, a rewind, `updatedPly` written by hand) that ply follows the clock rule;
- `Flags.rewind(ply)`: the game is back at `ply`; the flags that came down after it go up again,
  and the next update is for ply + 1.

Without the guard `test/trigger_check.js` finds 5 differences, this one among them; with it, 0.

**Asks saved, time not.** On chasolver's positions (both proofs) the material test is asked 59%
less often, the lock 33% less; in 40,381 games 67% and 39% less. The time does not move (Rust,
instruction counts: −1.7% to +1.3%): a static test costs a few tens of nanoseconds, about what the
small reckoning of which tests to ask costs. The gain is in the rule itself: each test is asked
exactly when its answer can have changed, and the rule says why.

**And not asking at all?** Measured on 24,392 real games (2,255,724 positions: TWIC 1664–1666, the
2010 World Blitz, a bullet collection), `Flags::update` only, instruction counts:

| variant | instructions (games) | in the games | flag falls unproven (of 192,457) |
|---|---|---|---|
| the rule now | 9.141 G (4,052 per ply) | — | 36 |
| the clock rule | +2.4% | the same | 36 |
| at every node and every ply | +3.1% | the same | 36 |
| no material test | −0.6% | 1,759 games differ | 82,964 |
| no lock detector | −5.6% | the same | 51,087 |
| no static test in the search | −8.7% | 15 games: a flag one ply late | 117,762 |
| no static test at all | −10.1% | 1,761 games differ | 168,591 |

The tests themselves are cheap (lock 1.9%, material 1.2% of the instructions; ~29 and ~16
instructions per call). Asking too often is almost free; asking too little breaks the verdicts: most
Domino proofs end at a leaf in a static test (bare material after a forced capture, a lock after
a forced move). Without the tests a search does not run longer, it fails earlier.

## 7. Rules measured and left out of the first version

The first version's lock detector stays a pure static test. Four rules were built, measured and
left out of it; two of them, boxed pieces and the open pawn pair, are in the second version
(section 12):

| rule | what it did | why it was left out |
|---|---|---|
| boxed pieces | let knights, rooks and queens stay when every square they could step to is held by their own fixed men | one practical row in the Lichess data (`hPiwD75i`); without it the detector is shorter and ~1.5× faster in game positions (in the second version, behind a quick look that keeps most of that speed) |
| pawn's check | started a king's reach in a pawn's check from its legal moves, so a lock entered by stepping out was proven statically | the Domino search proves those 212 rows in one ply; the rule made the detector generate moves and slowed it ~13% on locks |
| forced capture | at the root, when every legal move takes the only knight, rook or queen, proved each position after the capture statically | the Domino search proves those ~61,000 rows in one ply; static use needed a trigger of its own ("the side to move is in check") |
| open pawn pair | a white and a black pawn on one file with one empty square between them, the rest locked: split the reachable positions into three families (both pawns in place, the white one in the gap, the black one in the gap) and proved each like a lock; up to three pairs (27 families) | kept out of the first version (it is in the second). It proves 3 of the 36 unproven timeouts (2023–2024). In 5 drawn games of August and September 2026 it sees the dead position at once, where without it Mateless sees it 1–8 plies late in four and not at all in one (`19dcoW9q`). It costs ~300 more lines in JS (256 in Rust) and 18 KB of WebAssembly; per move in games no measurable time, +0.2 µs (JS) on each new lock |

Why the open pair is missed: a king's reach may enter its own pawn's square ("the pawn may
advance") and, separately, the empty square in front of it. Taken together the king walks through
the file, the opposite pawn is counted as capturable, the wall falls and both pawns seem to
promote. In fact the king can have only one of the two: while the pawn stands, its square is
closed; once it steps into the gap, the gap is.

With the pawn's check and the forced capture on or off: the same 36 rows unproven; in ~5,000
games the flags come down at the same plies; the cost per move differs within the noise (±3%).
The only gain was in judging one position at a flag fall (pawn's-check rows 2.2 → 0.5 µs, forced
captures 1.0 → 0.6 µs), and with the flags nothing is computed then. Boxed pieces would prove one
of the 36 (`hPiwD75i`), the open pawn pair three. An exhaustive enumeration of the reachable
positions closes all 36, the largest at 7,950 positions ([RESULTS.md](RESULTS.md)).

## 8. Both sides in one pass

A game's two flags and a dead position need the answer for both sides. Much of the work is the
same: a level of the lock detector does not depend on which side is flagged (only its mating net
does), and the two searches generate the same moves in the same order until a static test proves
one side and not the other, a mate fails one side only, or one side's search is over.

- `lockTest2` / `cannotMate2` (Rust `lock_test2`, `cannot_mate2`): a level once, its net per side;
  a side is proven at the first level that does not leak to it.
- `Domino.run2`: both searches in one walk. A move is made once for both; each side pays its own
  budget and keeps its own bit in the set of positions met (one probe, two bits). A side that fails
  stops as its own search would.
- `proveBoth`, `Flags.update` and `Game.updateFlags` use them, with the answers each side would
  get alone: 929,595 positions, every field equal, in both engines; the trees diverge in verdict in
  294,218 pairs, in failure kind in 301,942, in budget spent in 388,997.

| Rust, ns | each side alone | both at once | ratio |
|---|---|---|---|
| lock test, locked rows (50,970) | 142–146 | 82–85 | ~1.7× |
| static tests, all 201,060 rows | 68–81 | 54–69 | ~1.2× |
| both proofs, all rows | 463–467 | 376–386 | ~1.2× |
| both proofs, `lichess.txt` (131,072) | 909–964 | 552–633 | ~1.5–1.65× |
| flags, 6,000 games (546,492 plies), per ply | 494–580 | 333–364 | ~1.4–1.65× |

`isDeadPosition` (JS) asks the static tests for both sides in one pass but runs the two searches
one after the other: the first failure already answers "no", which is the usual case in a game.

## 9. Flags and the game

`Flags` holds `whiteDownAt` and `blackDownAt` (the ply each flag came down; −1 while up) and
`updatedPly`. `Game` keeps the position, the exact code of every position since the last capture
or pawn move (repetitions), and its `Flags`. A platform with its own game object keeps only a
`Flags` and calls `update(position, ply)` after every move.

**Starting the search late** (in the first 20 moves of a game, say) was measured and not made a
rule: on the Lichess data, 17 wrong results come before move 20 (`r1k4r/pp3ppp/3Qbn2/3p2q1/6P1/P2P3P/1P2PPB1/2R1K2R b K - 4 18`, a forcing early finish),
the gain is small (in an open position the search hits its ceiling after ~6 nodes: both sides
~0.4 µs per ply in Rust), and move numbers mean nothing in games from a FEN. A platform may start
calling `Flags.update` later; the first update asks the static tests whatever the last move was.

## 10. Builds

- **One file, inside a function.** `tools/build.js` joins the layers in import order in one scope.
  V8 runs the code ~10–30% slower from the ES modules directly and ~10–15% slower at the top level
  of a single module; inside a function the difference is gone. So `mateless.js` runs the code in
  a function and returns the API object, and `mateless.mjs` runs the same function once and exports
  its object (default) and each member (named). `test/build_check.js` checks that both are what the
  sources build, that the page embeds exactly `mateless.js`, and that all forms export the same
  names with the same source text and give the same answers.
- **Rust** has no module state: the census and the move context live on the stack, each `Domino`
  owns its memory, so the crate can be used from many threads (one `Domino` per thread). With LTO
  and one codegen unit the module boundaries cost nothing (instruction counts within 0.2%).
- **WebAssembly.** `rust/wasm` is a thin C ABI over the crate; positions and the flags of games live
  in two tables behind handles, a FEN comes in through one buffer. Proofs run ~2.5–4× faster than
  in JS, a game's flags ~3.2× per ply; the static tests alone not at all (a call across the
  boundary costs what the test costs). The arbiter page does not embed it: it judges chasolver's
  192,457 Lichess rows in about 4 s in Chromium (~20 µs a row, reading, tests and report
  included), of which the proof itself is ~1.7 µs, so WebAssembly would make the page only a few
  percent faster. Its place is a server or a client that follows games move by move.

## 11. Porting notes

- The JavaScript engine keeps module state that every call shares (the lock detector's census and
  the sets its net reads, the shared move context, the shared Domino search). JavaScript runs one
  call at a time; a port to a language with threads must give each thread, or each game, its own.
- Keep the move order (pieces by square a1 … h8, each piece's targets by square, promotions Q, R,
  B, N) and the node counts will match, which makes a port testable against `mateless.js` line by
  line (`test/rust_compare.js`).
- The set of positions met needs an exact key (pieces, side, castling rights, legal en passant
  square), not a Zobrist hash: a collision could prove a false draw.
- An en passant square counts only when a legal capture onto it exists.
- The scalachess port ([mateless-scalachess](https://github.com/cuneytinann/mateless-scalachess))
  meets two more: scalachess gives a standard castle as two moves (to the king's square and to the
  rook's), taken once; and `Fen.read` drops the halfmove clock, `Fen.readWithMoveNumber` keeps it.

## 12. The second version

The first version is what a game server needs: the material test, the lock detector, a 6-ply
search. The second version adds what is known to see more, toward completeness, without making
the first slower where its rules do not apply. Every rule here keeps three properties: it never
makes a false proof (each is checked like the first version's rules, below); it runs only when its
own situation is on the board, so any other position takes the first version's path through the
same code; and JS, Rust and WebAssembly give the same answers, node counts included.
`_internal.coreLockTest` runs the first version's detector alone (it labels `lock/positions.tsv`
and is what the lock tab draws).

### Open pawn pairs

As in section 7: the families A (neither pawn of the pair has moved; the gap is a wall for both
sides' pawns but not for the kings), B (the white pawn stepped into the gap) and C (the black one).
A pawn of the pair can only ever move into the gap, and once one has the other is blocked, so every
reachable position is in A, or reached B or C from A by that step: B's and C's kings, capture
squares and bishops start from A's final sets. The pair's pawns must be walls in A (taken, they
would let the other through). k pairs give 3^k families, up to 3 pairs.

*When:* the census tells in two shifts and three ANDs whether the pawns hold a gap. Without one the
levels run as before. With one, each level tries the families first and itself after them, but not
for the sides family A leaked to: A is the level with more walls, every set it grows is a subset
of the level's and every leak grows with those sets, so a leak in A is a leak of the level. The
answers are those of trying every level and then the families; only the work differs.

### Boxed knights, rooks and queens

A piece whose every step square holds one of its own men that never moves (a fixed pawn, or
another boxed piece) never moves; it attacks only those squares, which its own men hold for good,
so it never gives check and takes no part in a mate. The rule is the golfed engine's, kept in the
history (`[boxed]`): the boxed pieces are those no enemy king or bishop reaches, recomputed on every
pass, so the bishops join the cycle; they are walls for both sides' pawns; two more leaks (a pawn
can capture on a piece's square; a piece has a step square not held by a fixed pawn or a boxed
piece of its colour); and the mating net counts no flight onto a piece's square. A piece whose
steps are all held but that an enemy king or bishop reaches is no wall: it may be taken, and until
then it stands still.

*When:* only with a knight, rook or queen on the board (the first version stops there). A first
look at the squares beside each rook and queen, east and west, against the side's own pawns and
pieces, ends 96% of game positions at a few operations; then all step squares; only a position
that passes them all gets a level, the plain loop.

*The trigger stays as it is.* The static tests are asked after a capture, a pawn move, the lapse of
an en passant right or a step out of a pawn's check (section 6). A knight, rook or queen that has
just moved quietly has an empty step square: the square it came from, for a knight; for a rook or
queen, the neighbour on the side it came from, which it came from or slid over; a rook that has
castled stands next to its king. So after such a move the boxed rule fails, and no other quiet
move changes what it reads (a king or bishop stays inside its reach). Checked: after 2,436,600
quiet knight, rook and queen moves from boxed and chasolver positions, no lock; `trigger_check.js`
with boxed and open-pair positions, 57,000 games: no difference from the clock rule.

### A second tier of the Domino search

Where the 6-ply, 100-node search fails without a mate, the same search runs once more at 9 plies
and 10,000 nodes. A failure on a mate proves nothing can be proven, so it never runs then. In the
positions of real games the first search almost always fails on its horizon at its first line,
where the deeper one fails on its horizon too after ~9 nodes: run there, it would double the
search's cost in every ending. So it runs only

- after a failure on the budget (every line ended within 6 plies, but more than 100 nodes of them:
  21 of chasolver's 131,000 winnable Lichess positions), or
- after a failure on the horizon on a board with no knight, rook or queen where some king has no
  square to step to: each square next to it holds one of its own pawns or bishops, is attacked by an
  enemy pawn or is next to the enemy king.

Of the 36 rows the first version leaves, the second tier proves 26: 19 after a budget failure and
7 after a horizon failure, all 7 with a king shut in. In 1,000 games played from chasolver's
Lichess positions the first search failed on its horizon 14,755 times on boards of kings, pawns and
bishops, and a king was shut in at 6 of them. Without the shut-in condition the second tier would
also prove 8 composed positions of chasolver's test set; none of the Lichess data.

In a game the second tier is one more walk of `Domino.run2`, for the sides it is allowed for; the
gate is one look at the failures and, after a horizon failure, at the piece sets, and the rest is
out of line (Rust: `second_tier`, so that the first search stays the one inlined into
`Flags::update`).

### What it costs

Measured on the shared machine of section 1 (±5% between runs): a game's two flags per move,
1,000 games from chasolver's Lichess positions, each engine in its own process, pinned to one core:

| | first version | second version |
|---|---|---|
| Rust, per move (fastest of 12 runs) | ~422 ns | ~439 ns |
| JS, per move (fastest of 12 runs) | ~2,060 ns | ~2,170 ns |

Most of the difference is the quick look for boxed pieces: ~1.8 lock tests per move meet a knight,
rook or queen, each ~2 ns longer in Rust (3.5 → 5.5 ns) and ~10 ns in JS (22 → 33 ns). The second
tier's gate is under 1%. The open-pair rule costs nothing measurable without a pair; with a pair
and no lock (rare in games: 1,169 lock tests in those 1,000 games) ~30 ns in Rust and ~100 ns in JS.
Against chasolver the second version's ratios are the first's within the noise
([RESULTS.md](RESULTS.md#the-second-version)).
