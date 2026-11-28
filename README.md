# Mateless

**Can this side still mate?** Mateless answers that question after every move of a chess game,
for both sides, and keeps the answer: a side proven unable to mate stays so for the rest of the
game. That is what FIDE's rules ask at three moments:

- **flag fall** (FIDE 6.9): a player whose time runs out loses, unless the opponent cannot mate
  by any series of legal moves; then the game is drawn;
- **resignation** (FIDE 5.1.2): the same question, the same answer;
- **dead position** (FIDE 5.2.2): when neither side can mate, the game ends in a draw at once.

Mateless is a library (JavaScript, Rust, WebAssembly; no dependencies) and an arbiter page.
It is **sound but incomplete**: it never declares a draw without a proof, and what it cannot
prove it leaves to the platform's rule (the flag loses) and to a complete solver after the game.

It comes in two versions, side by side in one library. The **fast** version (the first) is the
layer proposed for Lichess: the lock detector of [`lock/`](lock/) and of the scalachess patch, and
a short search. The **full** version (the second) adds rules that see more: open pawn pairs, boxed
knights, rooks and queens, the stuck mater move by move and a second tier of the search, and, on request, the move and repetition
rules, with a search bounded by the clock near the move rule. It is not complete either; its name
is its goal, and each of its rules runs only when its own situation is on the board, so every
other position goes through the fast version's code ([the second version](#the-second-version)).

**[The site](https://cuneytinann.github.io/Mateless/)** · [Türkçe](README.tr.md) ·
[Design](docs/DESIGN.md) · [Results](docs/RESULTS.md) ·
[for Lichess: mateless-scalachess](https://github.com/cuneytinann/mateless-scalachess)

## Bit-level detection of the whole structure

The centre of Mateless is a **lock detector**: it recognises structures of pawns, kings and
bishops that no series of legal moves can open, without generating a single move, in about 90
nanoseconds.

It looks at the whole structure at once, at the level of bits: all the pawns of a side form one
cone, a king has one reach, and a few operations on 64-bit sets take the whole structure to a
fixed point. As far as we know that makes it the fastest method of its kind: with the short
search behind the detector (at 6 plies and 100 nodes, its default until 26 November 2026; now 3
and 10), Mateless covers **99.98%** of the Lichess data below **~17–18×
faster** than the nearest known method (Rust against Rust).

[chasolver](https://github.com/miguel-ambrona/chasolver) (Miguel Ambrona, FUN 2022) is the
reference in this field, and a complete solver: it settles composed problems that Mateless does
not try to. Mateless is the fast layer in front of such a solver, small enough to run inside a
game server on every move.

## Speed

A locked position is proven in **about 90 nanoseconds** (Rust; ~60 ns with the position already in
the cache). A position from a real game, with a knight, rook or queen on the board, is set aside
by the lock detector in **~9 ns**. The whole ladder averages **~0.23 µs** per Lichess timeout,
and following a game costs **~0.35 µs per move** for both sides' flags. The speeds were
measured on chasolver's list up to July 2026 (201,060 rows, 50,970 locks), before the rows of the
August–September scan were added.

The tables below were measured on the first version. The second version costs about 2% more per
move on the positions of a game, most of it a quick look for boxed pieces where a knight, rook or
queen stands (~2 ns in Rust, ~10 ns in JavaScript); against chasolver its ratios are the same
within the noise, and its whole ladder (then: 6 plies and 100 nodes, a second tier of 9 and 10,000)
proved 201,054 of chasolver's 201,060 rows, at ~0.22 µs a
row over the 204,060 rows up to September (Rust; [docs/RESULTS.md](docs/RESULTS.md#the-second-version)).
The four rules added in November (below) make it 201,058. They cost ~13% more per lock test in
JavaScript and ~30% in Rust (both sides of the 204,060 rows: ~40 → ~54 ns), ~4% per row on the whole
ladder in JavaScript and nothing measurable in Rust.

| | Rust | JavaScript |
|---|---|---|
| a locked position, proven | ~60–90 ns | ~0.2–0.8 µs |
| a real-game position, lock detector (knight, rook or queen on the board) | ~9 ns | |
| the whole ladder, per Lichess timeout (201,060 rows) | ~0.23 µs | ~0.9 µs |
| a game's two flags, per move | ~0.35 µs | ~1.6 µs |

Against chasolver's fast check, both in Rust, in one binary with chasolver's own build settings
(positions read beforehand, chunks of 64 in rotating order, median of 7 rounds;
`rust/examples/vs_chasolver.rs`):

| set | positions | chasolver fast check | Mateless | ratio |
|---|---|---|---|---|
| **locked** | 50,970 | 6.46–6.52 µs | 0.093 µs | **~70×** |
| locked, computation only (512, hot cache) | 512 | 5.70–5.77 µs | 0.058–0.062 µs | **~93–100×** |
| forced lines | 141,941 | 0.90–0.91 µs | 0.237 µs | ~3.8× |
| material | 8,139 | 0.30 µs | 0.011 µs | ~27× |
| **all 201,060 Lichess rows** | 201,060 | 3.97–4.05 µs | 0.224–0.235 µs | **~17–18×** |
| both sides at once, all rows | 201,060 | 6.52 µs (two calls) | 0.41 µs | **~16×** |
| real game positions (chasolver's `lichess.txt`, both sides) | 131,072 | 2.41 µs | 0.563 µs | ~4.3× |

chasolver proves all 201,060 rows, Mateless 201,024 (the second version 201,058; at 6 plies and 100 nodes, as the whole table). Coverage is
counted on chasolver's list alone: the 3,000 rows of the August–September scan were chosen as rows
that both chasolver and Mateless prove. The browser runs the same engine: the
arbiter page proves a locked position in under a microsecond, and WebAssembly is 2.5–4× faster
than JavaScript for whole proofs. Details, and why a JavaScript-against-JavaScript comparison
flatters Mateless (~85–95×), in [docs/RESULTS.md](docs/RESULTS.md).

## The ladder

After every move each side whose flag is still up climbs a ladder. The first rung that proves the
side can never mate brings its flag down, for good.

| rung | asked | what it proves | cost (JS; Rust 3–5× less) |
|---|---|---|---|
| **1. material test** | after a capture or a pawn move (in the search: after a capture or a promotion) | the side lacks the material to mate at all | ~0.1 µs |
| **2. lock detector** | after a capture, a pawn move, the lapse of an en passant right, or a king's step out of a pawn's check | pawns, kings and bishops form a structure no series of legal moves can open (first version: any knight, rook or queen fails it at once; the second version lets boxed ones stay and splits open pawn pairs) | ~0.3–0.8 µs |
| **3. Domino search** | after every move | a helpmate search of 3 plies and 10 nodes (6 and 100 until 26 November 2026) finds no mate, and every line ends in a position already seen, a static proof or a stalemate | ~1–5 µs |
| **4. stuck mater, second tier** (second version) | after the Domino search fails without a mate (budget or horizon) | first the stuck mater move by move: the flagged side is to move, the mater has only its king and pawns, and after every move of the flagged side the mater has no legal move (read from the bitboards; no node); then the same search at 9 plies and 5,000 nodes. That is the whole ladder: a third tier (150 plies, 5,000,000 nodes) is the arbiter page's, for analysis after the game, and in no engine | the stuck mater: bit work, no search; the second tier up to 5,000 nodes; a search ends when its lines do |

- **Both flags down** means a dead position (FIDE 5.2.2): the game ends in a draw.
- **When a flag falls, or a player resigns,** nothing is computed: if the opponent's flag is
  down the game is drawn (FIDE 6.9, 5.1.2), otherwise it is lost.
- Both sides are examined in one pass: the side-independent part of the lock detector and the
  walk of the two searches are shared.
- The static tests are asked only after a move that can have changed their answer
  (`testsAfter`). For that the flags remember two facts of the ply before: whether an en passant
  square stood, and whether the side to move was in a pawn's check. After plies left out or a
  takeback, the position alone decides (both tests when the halfmove clock is at most 1).
- **By default no move-count rule takes part in a proof:** the 50- and 75-move rules and repetitions
  only cut lines short, so leaving them out can cost a proof but never make a false one. On request
  the second version takes them into account (`moveRule`, `repetition`, see The second version).

> **Takebacks.** A flag that is down holds for every position reached from that one. A platform
> that lets moves be taken back calls `flags.rewind(ply)` with the ply the game is back at
> (`game.flags.rewind(ply)` in a `Game`; the same in JS, Rust and WebAssembly): the flags that
> came down after it go up again.

**End-of-game rules.** Mateless decides only the endings that need no claim: checkmate,
stalemate, dead position, the 75-move rule and fivefold repetition (FIDE 9.6). Threefold
repetition (9.2) and the 50-move rule (9.3) are claims, a draw by agreement an agreement: those
are the platform's. `Game` keeps the repetition count and every position its halfmove clock.

## Results

**The data.** Miguel Ambrona's chasolver project collects the rated Lichess games lost on time
although the opponent could never have mated, and publishes them as CSV files at
[chasolver.org/unfair-games](https://chasolver.org/unfair-games): 201,060 games up to 31 July 2026,
all of them wrongly scored. Two classes no longer occur on Lichess and are left out of the published set:
material (8,139 rows; Lichess fixed that around 2020) and server stalemates (464 rows; a
short-lived bug). August and September 2026 come from a scan of Lichess's own monthly databases
(181.5 million rated games): 2,830 games lost on time where both chasolver and Mateless prove that
the winner could never have mated (games won by a rules infraction left out). The 195,287 rows,
classified by Mateless (JS, Rust and WebAssembly give the same answer on every row):

| class | rows | share | drawn by Lichess today (scalachess 18.1.0) | lock check in the game (in-game) | lock check at the flag (a-lock) |
|---|---|---|---|---|---|
| **locked positions** (the lock detector) | **52,050** | 26.7% | 141 | **52,034** | 52,050 |
| forced lines (the Domino search) | 143,201 | 73.3% | 138,431 | 138,431 | 138,669 |
| unproven | 36 | 0.018% | 0 | 0 | 0 |
| **all** | **195,287** | | **138,572** (71.0%) | **190,465** (97.5%) | 190,719 (97.7%) |

The table is the first version's classification (the data files keep it). The second version
proves 34 of the 36 unproven rows; 2 remain ([`data/second_version.tsv`](data/second_version.tsv)).

Lichess today draws most forced lines: scalachess #821 (merged in August 2026; on Lichess from
6 September, judging by the data) added a one-move lookahead to the test that lila asks when a
flag falls. What it still misses is, almost entirely, **locked positions**: 51,909 of its 56,715
misses. From 7 to 30 September, with #821 in use, 460 games were still lost on time this way;
422 of them (92%) were locks.

The lock patch proposed for Lichess,
[lichess-org/scalachess#916](https://github.com/lichess-org/scalachess/pull/916) (it replaced
#907), asks the lock detector alone (181 lines of Scala) in two places, in Standard, Chess960 and
From Position games. **In the game** it is
[mateless-scalachess](https://github.com/cuneytinann/mateless-scalachess)'s `in-game`: a
dead-position check (FIDE 5.2.2) in scalachess's `autoDraw`, asked for both sides when the
halfmove clock is 0 or 1, right after a capture or a pawn move and one move later: a lock can
appear only then. The game ends in a draw the moment it locks, so 52,034 of the rows above would
have ended before the flag fell: 51,893 that Lichess scores as wins today, the 422 of September
among them, and 141 it draws at the flag. **When a flag falls or a player resigns** it is
`a-lock`: the same detector asked once more, at the position and in #821's lookahead. That draws
what the game check cannot see: 16 locks of one side only (not dead: the flagged side could still
mate, so it is the flag's question, FIDE 6.9) and 238 rows where the lock comes one move after the
flag. Together: 190,719 rows (97.7%). Asked only at the flag, a dead game would still be played on
until it ended some other way: in August and September, 8,718 drawn games went on for a median of
14 plies after such a lock had appeared. The whole ladder, Mateless itself or that repository's
`c-ladder` patch, draws 195,251 rows (99.98%).

In 117,455 rows (60%) the final position was already dead, neither side able to mate: under
FIDE 5.2.2 those games had ended in a draw before the flag fell.

The classification is in [`data/`](data), newest game first: `timeouts_classified.tsv` (every
row: game id, date, class, Lichess today, at the flag with `a-lock`, dead position, with
`in-game`), `locked_positions.tsv` (the 52,050 locked positions with the side that cannot mate) and
`lichess_2026-08_09.tsv` (the scanned rows with their final positions; with them 170 games
resigned where the opponent could never mate, a draw under FIDE 5.1.2 that Lichess scores as a
loss). The 36 unproven rows all come from chasolver's list up to July (the scanned rows were
chosen as rows Mateless proves). Of them, 32 are cages whose reachable positions include stalemates (mostly
a king shut in a corner, where taking the last pawn gives stalemate; 6 of them with a queen or a
rook), 3 hold an open pawn pair (one empty square between a white and a black pawn on a file,
the rest locked), and 1 a knight boxed in by its own pawns. They, and whatever a platform's own
rules leave, are what a refund after the game would cover: a complete solver (chasolver) judges
them once the game is over. With the whole ladder that is 36 rows of 195,287; with the lock
detector alone on top of today's Lichess, 4,822 (`in-game` alone) or 4,568 (`a-lock`, and #916,
which does both). The second version proves 34 of the 36: the search 27 of the cages (with its
second tier), the stalemate guard 3 more, the open-pair rule the 3 pairs, the boxed rule the knight.
Two are left, both bishops' cages: bKHPqNEw, which the arbiter page's third tier proves (150 plies,
5,000,000 nodes: analysis after the game), and RwnQJq1k, which falls to the 75-move rule once the
search reaches the rule's end (in the game's position, clock 11, with the page's third tier; by
itself from clock 120 on). (At 3 plies and 10 nodes, the default since 26 November 2026, the first
version leaves 656 of chasolver's 204,484-row list of 19 November, the second 2, those same two,
with the 75-move rule or without it; with the page's third tier and the 75-move rule, none.) So in
play even the full version may, very rarely, leave a position unproven that cannot be mated; the
analysis after the game, with the third tier and if need be a larger budget, catches it.

**Soundness.** There is no written proof yet; there is strong test evidence.
- No false draw against chasolver's labels (its 68,950 labelled positions, both sides;
  `test/classify.js`), and in ~10,000 games played move by move, chasolver's full solver found no
  mate at any of the ~5,700 flags that came down (`test/game_flags_check.js`).
- The lock detector's certificates on fuzzed positions (mutations of chasolver's positions and
  random locked structures) all come back unwinnable from chasolver's full search: 23,001 of
  23,001 in a fresh run, 54,587 in earlier ones (`test/fuzz_lock_gen.js`,
  `rust/examples/oracle.rs`).
- **The invariant check** (`test/lock_invariant.js`) tests the reasoning, not the verdict: from
  every lock certificate it enumerates the reachable positions and checks that each one keeps
  what the certificate claims (pawns in their cones, fixed pawns in place, kings and bishops in
  their reaches, no promotion, no mate). On all 50,970 locked positions up to July 2026: no
  violation in 271.8 million positions visited; for 50,692 of them the reachable set was
  enumerated completely, which is a proof for that position. On the 1,175 locks of August and
  September (timeouts and resignations): no violation in 5.8 million positions, 1,171 enumerated
  completely.
- **The second version's rules** went through the same checks: no false draw against chasolver's
  labels; JS, Rust and WebAssembly give the same answers, node counts included, on 538,094
  positions and 3,000 games; the invariant check finds no violation on 5,081 boxed-piece and
  13,085 open-pair certificates (61 million positions, all but 15 enumerated completely);
  chasolver's full analysis calls every new lock unwinnable (5,081 boxed locks and 20,000 fuzzed
  certificates; for the open pairs' 130,858 new locks, an exhaustive enumeration of every
  reachable position in their own experiment, and chasolver on samples), and finds no mate at any
  flag that came down in 7,000 games played move by move (`test/second_version_check.js` holds
  the 36 rows to their measured proofs).

## Usage

**The page.** One file, `index.html`, holds the whole site: open it in a browser, nothing to
install. It is the site's front page,
[cuneytinann.github.io/Mateless](https://cuneytinann.github.io/Mateless/), and its Download link
saves the same file, which runs offline (only the fonts come from the internet). English by default,
Turkish to choose. Five tabs:
- **Arbiter**: a FEN, CSV or TXT files of positions, or PGN games. Each verdict is
  shown as a score with its reason (insufficient material, locked position, Domino effect, mate
  found, no proof) and the rungs that led to it; dead positions are marked; results download as
  CSV. chasolver's lists of the Lichess games lost on time that should have been drawn,
  [chasolver.org/unfair-games](https://chasolver.org/unfair-games), drop straight in.
- **Lock detector**: rung 2 from the simplest up. What the Lichess locks hold, and why knights,
  rooks, queens and twin bishops are left out; then pawns and kings on bitboards (a capture means
  no lock; the cones; the fixed point of walls, fixed pawns, king reaches and take squares; one wall
  and two halves; the frozen king); then bishops (contact, the mating net), en passant and a move
  that mates; every assumption and why it is safe. An explorer steps through the passes for any FEN; its boards are
  computed in the browser and checked against mateless.js as they are drawn. The detector alone,
  in 20 languages (the first version, and the second in its folder `second/`), downloads from
  there as `mateless-lock.zip`.
- **Rules**: FIDE 5.2.2, 6.9 and 5.1.2, what the book says and how an algorithm can read it.
- **Lichess scan**: drop one of Lichess's monthly databases (`.pgn.zst`) and it is scanned in
  the browser, on every core, without unpacking it first: the games won although the winner could
  never mate, and the draws played on after the position had died, by Mateless and by chasolver,
  as CSV files.
- **chasolver**: a JavaScript port of Miguel Ambrona's chasolver 3.0.0 (not official; MIT), with
  the stalemate-filter fix of its main branch (11 November 2026) and one more fix of ours to that
  filter, not yet in chasolver: pieces the enemy king can capture no longer count as its walls. That
  ends the 44 wrong "cannot win" claims main still made on 57 Lichess games we reported. It is the
  complete solver, with a mating line for every winnable position. Against the Rust build with the
  same fix it gave the same answer on every row: the fast check on 342,559 inputs, the full
  analysis, mating lines included, on 138,075. The arbiter's "Ask chasolver" button hands a
  position over to it.

The page is built from `site/` (one folder per tab, see [site/README.md](site/README.md)) and
embeds the engine; after changing `src/` or `site/`:

```sh
node tools/build.js && node tools/build-site.js
```

**Node:**

```js
const E = require('./mateless.js');
const { position } = E.fromFen('8/8/4k3/3p2p1/1p1P1pP1/1P3P2/8/3K4 b - - 47 92');

E.cannotMate(position, E.BLACK);          // true: Black's flag may fall, White can never mate (static)
E.lockCannotMate(position, E.BLACK);      // true: the lock detector proves it
E.proveCannotBeMated(position, E.BLACK);  // { proven: true, staticProof: true, failure: null, foundBy: null, nodes: 0 }
E.cannotMate2(position, E.FLAGGED_WHITE | E.FLAGGED_BLACK);   // 3: neither side can be mated (both in one pass)
E.proveBoth(position);                    // [White flagged, Black flagged]: the two proofs in one pass
E.RESULT_NAMES[E.flagVerdict(position, E.BLACK)];   // 'draw on time'
E.RESULT_NAMES[E.gameStatus(position)];             // 'dead position': the game is already over

// A game played move by move: the flags follow every move, a flag fall is read from them.
const game = new E.Game(E.fromFen('7k/8/8/8/3q4/8/8/7K w - - 0 60').position);
E.RESULT_NAMES[game.status()];                      // 'ongoing'
game.neverMates(E.WHITE);                           // true: White has a bare king, its flag is down
game.neverMates(E.BLACK);                           // false
E.RESULT_NAMES[game.flagVerdict(E.BLACK)];          // 'draw on time': if Black's time runs out
E.RESULT_NAMES[game.flagVerdict(E.WHITE)];          // 'black wins on time': if White's runs out
E.RESULT_NAMES[game.flagVerdict(E.BLACK, { resigned: true })];   // 'draw on resignation' (FIDE 5.1.2)
game.play(E.parseSquare('h1'), E.parseSquare('g2'));   // White is never examined again

// A platform's own rules: when the game ends by itself (and the proofs with it), when a draw may be
// claimed (no proof assumes a claim), how much of the ladder runs.
const g2 = new E.Game(position, { moveRule: 100, repetition: 3, claimMoves: 0, claimRepetition: 0, rungs: 2 });
g2.claimable() & E.Claim.THREEFOLD;                 // a claim the player may make now (here: none, it ends by itself)
new E.Game(position, { moveRule: 150, repetition: 5, dominoAtEnd: true });   // the searches only when a flag falls or a side resigns

// A platform with its own game object keeps only the flags: the new position and its ply.
const flags = new E.Flags();
flags.update(position, 0);                          // the first position (ply 0): both sides locked
flags.neverMates(E.WHITE) && flags.neverMates(E.BLACK);   // true: a dead position
```

`mateless.js` runs as a classic `<script>` (`globalThis.Mateless`) and as a Node module;
`mateless.mjs` is the same single file as an ES module (`import { fromFen, proveBoth } from
'./mateless.mjs'`, or `import Mateless from './mateless.mjs'`). The source modules
(`./src/index.js`) give the same answers but run ~10–30% slower in V8.

**WebAssembly.** The Rust port compiled to `mateless.wasm` (269 KB, 87 KB gzipped), with
`mateless-wasm.js` as its dependency-free bridge: the whole ladder (static tests, Domino, both
proofs, a game's flags, perft), a whole game (`W.Game`: the same options, results and claims, legal
moves, FEN; `test/game_check.js`) and, on request, the rules a game ends at by itself, with
`mateless.js`'s answers to the node count. Proofs run ~2.5–4× faster than in JS, a game's flags
~3.2× per ply, and under the rules (the clock search) ~2–3×; native Rust is another ~1.4–1.9×
faster. Rebuild with `node tools/build-wasm.js`.

```js
const W = require('./mateless-wasm.js').instantiate(require('fs').readFileSync('mateless.wasm'));   // browser: await MatelessWasm.load('mateless.wasm')
W.proveBoth('8/8/4k3/3p2p1/1p1P1pP1/1P3P2/8/3K4 b - - 47 92');   // [White flagged, Black flagged], as in mateless.js
const flags = new W.Flags();                                // a game's flags
flags.update(fen, ply);                                     // after every move, with a FEN or W.fromFen(fen).position
// under the rules, the options of mateless.js; history: game.repetitionHistory() from mateless.js,
// or the FENs of the positions before this one since the last capture or pawn move
W.proveCannotBeMated(fen, W.BLACK, { moveRule: 100, repetition: 3, history });
const ruled = new W.Flags({ moveRule: 150, repetition: 5 });
ruled.update(fen, ply, history);
```

**Rust** ([rust/README.md](rust/README.md)):

```rust
let pos = mateless::from_fen("8/8/4k3/3p2p1/1p1P1pP1/1P3P2/8/3K4 b - - 47 92").unwrap();
let mut search = mateless::Domino::new();
let proof = mateless::prove_cannot_be_mated(&mut search, &pos, mateless::BLACK, mateless::DOMINO_PLY, mateless::DOMINO_BUDGET);
assert!(proof.proven && proof.static_proof);    // the lock detector: White can never mate

// A game under a platform's own rules (GameOptions::DEFAULT: FIDE's, the whole ladder).
let mut game = mateless::Game::new(&pos, mateless::GameOptions::DEFAULT).unwrap();
let result = game.flag_verdict(mateless::BLACK, false);   // 11: a draw on time
```

**TypeScript.** The types are in `mateless.d.ts`, beside the engine, so TypeScript finds them:

```ts
import Mateless = require('./mateless');      // or: import { fromFen, proveBoth } from './mateless';
const r = Mateless.fromFen('8/8/4k3/3p2p1/1p1P1pP1/1P3P2/8/3K4 b - - 47 92');
if (r.error === undefined) Mateless.proveCannotBeMated(r.position, Mateless.BLACK);   // Proof
```

**Reading a FEN.** `fromFen` (`src/fen.js`) is the outer layer every position from outside comes
in through; the ladder never calls it, and a position reached by legal moves from one it let in
needs no second look. It returns `{ position, halfmoveGiven, fullmove, fixed, fen }` or
`{ error, detail }`, and refuses a position no game of chess or Chess960 can reach, by the known
necessary conditions:

| error | the position |
|---|---|
| `syntax`, `kings`, `pawnrank` | not a FEN; not one king a side; a pawn on the first or last rank |
| `oppcheck` | the side not to move is in check (two kings side by side are this too) |
| `pawns`, `pieces` | more than 8 pawns, or more than 16 men, a side |
| `promo` | more men than the starting set (one queen, two rooks, two knights, one bishop on each colour: a bishop never changes colour) than missing pawns could have become |
| `captures` | pawns off their files: each from a file of its own, they need more captures than the other side has men missing |
| `checks` | no last move of the other side gives the checks: made back, every move (a move, a capture, a promotion, an en passant capture, castling) leaves the side to move in check, or needs a man that is not there (a captured man comes back only if its side has fewer than 16, a promotion is made back only if the mover has fewer than 8 pawns). So three checks, every double check no single move gives (two knights, two men on one line through the king, a discovered check whose line the moved man never stood on, two rooks without a capturing promotion), a pawn checking from its starting rank, a piece that came from nowhere |

What can be read only one way is put right instead, and named in `fixed`: castling rights the
board does not allow (`castling`); an en passant square no two-square advance left: the wrong
rank, the squares not empty, a halfmove clock above 0, or a check the advance cannot give
(`en passant`); a halfmove clock above 0 where only a capture or a pawn move can have given the
check (`halfmove`, set to 0); a move number below what the halfmove clock needs (`fullmove`).
`fen` is the FEN with these put right. These are necessary conditions only: a position that
passes them all may still be unreachable (that takes a retrograde analysis further back).
`fromFen(fen, { strict: false })` keeps only `syntax`, `kings`, `pawnrank` and `oppcheck`, for
composed positions and test sets.

No legal position is refused or changed: every position of python-chess's random games, standard
and Chess960, check-heavy, with every double check, castling, en passant and promotion check they
offer, in both forms of the en passant field (`test/fen_check.js`; 2.17 million FENs in longer
runs); and every random board python-chess finds invalid is refused. The Rust port (`from_fen`,
`from_fen_with`) and `mateless.wasm` (`W.fromFen(fen, { strict })`) read the same, on 2.27
million FENs. On the page, the positions box writes a FEN as the engine put it right once the box
is left.

**scalachess (Lichess)** has its own repository,
[mateless-scalachess](https://github.com/cuneytinann/mateless-scalachess), with patch sets on
scalachess 18.0.1: the lock detector alone as a dead-position check in `autoDraw` (`in-game`),
the same detector when a flag falls (`a-lock`), and the whole ladder (`c-ladder`, for reference).
The patch proposed for Lichess, #916, is `in-game` and `a-lock` together.

## Taking only the lock detector

For a platform that wants the lock detector without the rest of the ladder.

**The simplest way:** [`mateless-lock.zip`](mateless-lock.zip) (the folder [`lock/`](lock/)) holds
the detector alone, in its simplest form, in 20 languages: C, C++, C#, Crystal, Go, Haskell, Java,
JavaScript, Kotlin, Lua, Nim, OCaml, Pascal, PHP, Python, Ruby, Rust, Scala, TypeScript, Zig. Each
is about two hundred lines on its language's standard library, and all give the same answers on the
same 36,406 test positions ([lock/README.md](lock/README.md)). Its folder `second/` holds the
second version the same way: 600 to 1,000 lines in each of the same 20 languages, the same answers
on 66,100 test positions ([lock/second/README.md](lock/second/README.md)). The table below is the fast
versions inside Mateless.

**What it needs:** the bitboards of the pawns, kings and bishops (by colour), whether any knight,
rook or queen is on the board, and the en passant square (only when a legal capture onto it
exists). It generates no move and searches nothing (the second version's last rule, the stalemated
flagged side, looks at the moves of kings, pawns and bishops, two plies at most).

| language | function |
|---|---|
| JS | `lockCannotMate(pos, flagged)` (`src/lock.js`) |
| WebAssembly | `lockCannotMate(fen or Position, flagged)` (`mateless-wasm.js`) |
| Rust | `lock_cannot_mate(&pos, flagged)` (`rust/src/lock.rs`) |
| Scala (scalachess) | `chess.mateless.Lock.cannotBeMated(position, flagged)` (mateless-scalachess: `in-game`, `a-lock`) |

**Cost** per call:

| | Rust | JS | Scala (scalachess) |
|---|---|---|---|
| a knight, rook or queen on the board (most of a game): it returns at once | ~9 ns | | ~30–35 ns |
| a locked position (the whole fixed point) | ~105 ns | ~0.3–0.8 µs | ~150–190 ns |

**What it sees on its own:** a lock standing in the position itself: 52,050 of the 195,287 Lichess
rows above, the 51,909 that Lichess misses today among them.

**What it does not see:** a lock one move away.
1. **A step out of a pawn's check.** A king in a pawn's check stands on a square a pawn attacks,
   and its reach floods from there, through squares it could not enter otherwise; stepping out
   can complete the lock. `8/8/1k6/p2p2p1/PK1P2Pp/7P/8/8 w`: every king move of White enters a
   lock.
2. **A forced capture.** When taking the last knight, rook or queen is the only move, a lock (or
   bare material) follows it. `8/8/6R1/1p1p1k2/1P1Pp3/4P1p1/6P1/6K1 b`: Kxg6 is the only move.
3. **The lapse of an en passant right.** The detector fails while the right stands; any next move
   ends it.

**Three ways to ask it:**
- **A dead-position check after every move** (`in-game`, the first half of #916, in
  scalachess's `autoDraw`): when the halfmove clock is 0 or 1, ask the lock for both sides; if
  neither side can be mated, the position is dead (FIDE 5.2.2) and the game ends at once. A lock
  appears only after a capture or a pawn move, at once or one move later: a pawn's check and an en
  passant right both come from the pawn move just played, so the ply after covers their end. The
  clock alone says when to ask; nothing has to be remembered. All three cases above are caught when
  the move is played. It does not see a lock of one side only (that is the flag's question, FIDE
  6.9), nor a lock that only the move after the flag fall would have completed. On the Lichess
  data: 190,465 rows (97.5%); 52,034 of them would have ended before the flag fell, 51,893 of
  these lost on time today.
  ```
  dead by lock  ⇔  halfmove clock ≤ 1  and  lock(position, White)  and  lock(position, Black)
  ```
- **At the flag, with a one-move lookahead** (`a-lock`, the second half of #916; scalachess #821
  looks at every move of the flagged side): ask the lock at the position and at every child. All
  three cases come by themselves; in a child no en passant right is left. On the Lichess data the
  children added 238 rows: 237 steps out of a pawn's check and 1 forced capture of a rook. A dead
  game, though, goes on until a flag falls or it ends some other way.
  ```
  drawn on time  ⇔  lock(position)
                    or, after every legal move of the flagged side: a checkmate it gave, a
                    stalemate, too little material for the opponent, or lock(that position)
  ```
- **A platform that follows the game move by move:** ask the lock after a capture, a pawn move, a
  move made while an en passant right stood and a step out of a pawn's check, and keep the proof
  for the rest of the game. That is exactly Mateless's trigger and flags (`testsAfter`, `Flags`).
  It catches all three cases when the move is played; but if the flag falls just before it (the
  king still in the pawn's check, the capture not yet made, the right still standing), only a
  lookahead or the Domino search sees it.

**Beyond:** forced lines of more than one move (4,532 rows of the data) need a short search: the
Domino search.

## Layers

The source is in `src/`, one ES module per layer. Mateless itself is four of them; the rest is
standard infrastructure it stands on. Each layer's `import` lines say exactly what it takes from
the board.

| file | layer | what it needs from the board |
|---|---|---|
| `src/material.js` | **rung 1:** the material test | the piece sets; no move generation |
| `src/lock.js` | **rung 2:** the lock detector; the two static tests together | the piece sets, the en passant square, a few shifts; no move generation |
| `src/domino.js` | **rung 3:** the Domino search (3 plies / 10 nodes) | legal moves piece by piece in a fixed order, made and taken back in place, "is there a legal move?", an exact code of a position |
| `src/ladder.js` | **the ladder:** when each rung is asked, the stuck mater move by move and the second tier (rung 4), the proofs for one position, a game's two flags (`Flags`) | the halfmove clock and the en passant square |
| `src/board.js` | a reference board: bitboards, magic bitboards, legal moves, FEN, Chess960 | — |
| `src/fen.js` | **the outer layer:** reading a FEN into a position some game can reach (`fromFen`): what it puts right, what it refuses | the board's FEN reader and attack test |
| `src/game.js` | a reference game: result codes, repetitions, the 75-move rule, fivefold repetition, `Game` | — |
| `src/index.js` | the public API | |

`tools/build.js` joins the layers into one file, `mateless.js` (and `mateless.mjs`): the same
code, line for line, with the import lines and `export` keywords taken out. The Rust port has the
same layers (`rust/src/board.rs`, `material.rs`, `lock.rs`, `domino.rs`, `ladder.rs`).

## Files

```
src/                 the source: board, fen, material, lock, domino, ladder, game, index (ES modules)
mateless.js          the engine, one file (built from src/ by tools/build.js; never edited by hand)
mateless.mjs         the same file as an ES module (also from tools/build.js)
mateless.d.ts        TypeScript types
mateless.wasm        the Rust port as WebAssembly (tools/build-wasm.js); bridge: mateless-wasm.js
index.html           the whole site in one page: arbiter, lock detector, rules, Lichess scan, chasolver
lock/                the lock detector alone, in its simplest form, in 20 languages, and the
                     positions that test them all (lock/README.md); lock/second/: the second
                     version, the same way (lock/second/README.md)
mateless-lock.zip    lock/ as one download (tools/build-lock-zip.js)
site/                its sources, one folder per tab; tools/build-site.js joins them (site/README.md)
rust/                the Rust port: library, command-line tool, comparisons with chasolver;
                     rust/wasm: a thin C ABI for WebAssembly
tools/               build.js, build-wasm.js, build-site.js, build-lock-zip.js, lock-positions.js
test/                the test suite (test/README.md)
data/                the classification of the Lichess data (data/README.md)
docs/                DESIGN.md (how it works and why), RESULTS.md (measurements)
README.tr.md         this file in Turkish
LICENSE              MIT
```

## Tests

Details in [test/README.md](test/README.md). The most used, from `test/` (chasolver's test files
with `CHASOLVER=<chasolver>/tests`):

```sh
node smoke.js                                    # perft
node perft_cpw.js 5                              # the six Chess Programming Wiki positions
python3 perft_python.py | node perft960.js -     # Chess960 moves = python-chess's (every start, ~780,000 positions)
python3 fen_python.py | node fen_check.js -      # fromFen: python-chess's legal games read as they are, its invalid boards refused
node classify.js 6 100 1                         # against chasolver's labels: FALSE DRAWS must be 0
node game_flags_check.js 1 3000 200              # every flag that comes down, against chasolver's full solver
node twosided_check.js <files>                   # both sides in one pass = each side alone, every field
node trigger_check.js                            # testsAfter = the clock rule, takebacks included
node build_check.js                              # mateless.js and .mjs = a build of src/, the page carries the same engine,
                                                 # lock/positions.tsv, lock/second/positions.tsv and mateless-lock.zip are up to date
(cd ../lock && sh test-all.sh)                   # the lock detector alone, every language, on lock/positions.tsv
(cd ../lock/second && sh test-all.sh)            # its second version, every language, on lock/second/positions.tsv
node page_check.js                               # the page, every tab, in headless Chromium
node wasm_check.js                               # mateless.wasm = mateless.js, under the rules too
node types_check.js                              # mateless.d.ts against the engine (npm i --no-save typescript)
node lock_invariant.js ../data/locked_positions.tsv 50   # the invariant check, every 50th lock
node second_version_check.js                     # the second version's rules: the 36 rows, each rule's positions
node chess960_boxed_check.js                     # castling never moves a boxed rook (every Chess960 layout; the rook beside its king, both wings);
                                                 # no castle completes a lock
```

The November rules and twin bishops are in the Rust and WebAssembly builds too: `rust_compare.js`,
`wasm_check.js` and `trigger_check.js` (with `mateless.wasm`) find no difference. So are the move
rules and the clock search: `rust_compare.js rules` and `games <file> <rule> <rep>`, and
`wasm_check.js`'s positions and games under the rules, find none either.

## The second version

The fast version (the first) is the layer for a game server: sound, small, and meant to run after
every move; it proves 99.68% of chasolver's list of 19 November (99.98% of the Lichess data
below at 6 plies and 100 nodes, its default until 26 November 2026). The full version (the second) stands beside it
in the same library. It is not complete either, and does not claim to be: "full" names its goal,
completeness, and it keeps growing as rules are added. In practice it matters mostly to
the curious and to research, so it is not rushed: each rule comes in only when it is known and
measured, and only where its own situation is on the board.

| rule | runs only when | proves (of the first version's 36 unproven rows) | cost elsewhere |
|---|---|---|---|
| **open pawn pairs**: a white and a black pawn on a file with one square between them, the rest locked; the reachable positions split into three families by what the pair's pawns have done (neither moved, the white one stepped into the gap, the black one did), each an ordinary level with walls of its own, up to 3 pairs | the pawns hold such a pair (two shifts tell) | 3 (and the death of 5 drawn games of August and September at the ply it happens) | none measurable |
| **boxed knights, rooks and queens**: a piece whose every step square holds one of its own men that never moves never moves and attacks only its own men's squares, so it may stay on the board (the golfed engine's rule, from the history). Such a man is a fixed pawn, another boxed piece, a still bishop (every diagonal neighbour held the same way, and no enemy king or bishop reaching it) or its own king, when the king is frozen, its side has no castling right left and it does not stand where a castle leaves it beside its rook (g1 and f1, c1 and d1; g8, f8, c8, d8: no static test is asked after a castle). So castling, Chess960's too, never moves a boxed rook (`test/chess960_boxed_check.js`). A rook beside its own king may look boxed and still castle: `8/8/8/4k3/p1p5/P1Pp1p1p/3PpP1P/2B1B1KR w - - 0 1` is dead, and with the castling right (`w K`, Chess960) it has a mate in four (1.O-O exf1=N 2.Bb2 Ne3 3.dxe3 d2 4.Kh1 dxe1=Q#); no test claims it, and the same check keeps it so | a knight, rook or queen stands, past a look at the squares beside each rook and queen (96% of game positions end there) | 1 (hPiwD75i), and 84 composed locks of chasolver's test positions; the still bishop and the king, 72 more lock answers there (66 proven by nothing else) | ~2 ns (Rust) / ~10 ns (JS) per lock test with such a piece |
| **after the Domino search, the stuck mater move by move and a second tier**: the flagged side is to move and the mater has only its king and pawns; after each of the flagged side's moves, made on the bitboards, the mater has no legal move (no pins are possible against the flagged side; the mater's pawns are tried with their pins and checks). Then the search again at 9 plies and 5,000 nodes | the search failed without a mate (budget or horizon); the stuck mater only with the flagged side to move, the mater left with king and pawns, and no castling right for the flagged side | 27 (the second tier); on the list of 19 November, of the 645 rows the full version's first search leaves without a mate, the stuck mater 345 and the second tier all but 2 of the other 300 (bKHPqNEw and RwnQJq1k) | a game's failing searches go on to 9 plies: ~6 µs a move in JavaScript, both sides; the stuck mater is bit work |
| **the stalemate guard**: a pawn the enemy king may take stays a wall if taking it always stalemates its owner (its king, wherever it may stand, defends the pawn or has no square left; nothing else of the owner's moves; the capture uncovers no bishop's check) | the cycle meets a takeable fixed pawn of a side without bishops | 3 (chikSuUd, f6c1lu7R, FKr42ZRT) | |
| **the check seed**: a king in a pawn's check starts its reach from the squares it can step to now, not from its own, which the fixed pawn keeps attacked | the side to move is in a pawn's check (no bishop on the board) | | |
| **the stuck mater**: the flagged side is to move and, whatever it plays, the mater has no legal move (the game ends at the mater's turn); read from the bitboards, no move is made | kings and pawns, the flagged side to move, the lock found nothing | | |
| **the forced step**: a king in a pawn's check with one legal move, a step: the lock of the position after it | as for the check seed, with kings and pawns only | | |
| **the stalemated flagged side**: whatever the mater plays, the flagged side is left without a legal move and out of check, a stalemate; with the flagged side to move, after the one legal move it has (a promotion counts four; if the mater then has no move, that move ended the game). Exact: the legal moves of the two plies, pins and checks counted, on the bitboards. Not in the search: a quiet move can complete it, so a game's flags ask it at every ply | the flagged side has only its king and pawns, the mater no knight, rook or queen, no en passant right | none of the 36; on chasolver's list of 19 November 90 more lock answers (75 of the 76 rows where the flagged side is stalemated within two plies), on its composed positions 7 | ~15 ns per call outside such positions (JS); a game's flags: none measurable |
| **twin bishops**: two or more bishops of one side on one colour (only a promotion makes them) no longer fail the detector; the mating net does not count its second flight rule (a free square vertically and one horizontally next to the king, two squares of one colour) for the flagged side on the king squares where its twins may hold both | a side has twin bishops | none in the Lichess data; 227 more answers on chasolver's labelled positions (899 of them have twins) | |

In the code: `lockTest` runs the second version's rules where they apply, and `lockCannotMate` that
and the stalemated flagged side (`_internal.tempoStalemate`); `_internal.coreLockTest`
is the first version's detector alone (the one in `lock/` and in the scalachess patch, which the
lock tab draws); `proveCannotBeMated(pos, side, { deepBudget: 0 })` leaves the second tier out (the
stuck mater still runs), and `_internal.stuckEvery(pos, side)` is the stuck mater rule alone. A
proof says which ran: `deep` (the second tier) and `stuck`. The third tier is in no engine: the
arbiter page runs it, when its box is ticked, as one more call after a ladder that fails without a
mate, `proveCannotBeMated(pos, side, { maxPly: 150, budget: 5000000, deepBudget: 0 })`, under the
same rules.

**The move rules, on request.** A game ends by itself, drawn, after 75 moves of
each side with no capture and no pawn move (FIDE 9.6.2) and when a position occurs for the fifth
time (9.6.1); some platforms already at 50 moves, or at threefold repetition. A mate that could come
only later never comes. With `moveRule: 150` or `100` and `repetition: 5` or `3` (and, for
repetitions, the game's history: `history: game.repetitionHistory()`), `proveCannotBeMated`,
`proveBoth`, `isDeadPosition`, `flagVerdict`, `Flags` and `Game` take that into account:
- a line of the search ends, drawn, at a position whose halfmove clock has reached the rule and that
  has a legal move (a mate on that very move still counts), and at a position the game has already
  had N − 1 times before;
- the search under the rules runs only after the searches without them have failed, and only where
  a rule can end a line: the clock within 40 plies of the move rule (`REGION_REACH`: 20 moves of
  each side, or the search's plies if they are more), or a position of the history that has
  occurred N − 1 times. So every proof without the rules stands, with the same nodes, and with the
  rules off (the default) the answers are those of before, node for node;
- near the move rule it is the **clock search** (`src/clock.js`), a search closed by the clock
  rather than by a ply ceiling. It walks the positions reachable without a capture or a pawn move,
  where the pawns stand still, as far as the clock lets a line go, and cuts a position when a lower
  bound on the plies to a mate or to an exit (a capture or a pawn move, which puts the clock back)
  is above the plies left. For a mate: for each square the defending king can reach in time, the
  mater's fewest moves to check it there and close its flights, each piece covering from one
  square, the pawns the only obstacles. For an exit: the plies to a pawn move, to a piece reaching
  a pawn or meeting a piece to take it, leaving out captures after which the mater has no mating
  material. An exit is judged by the searches without the rule, with the caller's limits: where
  they do not prove the side can never be mated after it, the answer is "may mate". Its budget is
  at least 200,000 nodes (`DOMINO_RULE_BUDGET`), the exits' searches included. With only a
  repetition position, the Domino search runs with it, the first tier's limits (the second's where
  it was allowed without the rules);
- a `Game` under the rules ends at them: the 75-move rule and fivefold repetition keep their codes
  (4, 5); the 50-move rule is 13 and threefold repetition 14.

The same in Rust (`prove_cannot_be_mated_rules`, `prove_both_rules`, `is_dead_position_rules` with
`Rules { move_rule, repetition, history }`, `Flags::with_rules`; `rust/src/clock.rs`) and in
WebAssembly (the options above, through `mateless-wasm.js`), with the same answers and node counts:
on 20,972 positions with the clock near a rule and 1,200 games under four settings (150/5, 100/3,
100, 3), the three engines print the same lines.

It is sound, and complete only within those limits. A proof under the rules holds for a game that
ends at them (fivefold's holds under threefold, the 75-move rule's under the 50-move rule, not the
other way round). It can still miss one: where the clock is further from the rule than its reach,
where the position after an exit needs more than the searches without the rule prove, or where the
proof needs more nodes, the answer stays "may mate", on the safe side. King and rook against king
(`7k/8/8/8/8/8/8/K5R1 w`, a helpmate of 11 plies at the shortest) under the 50-move rule: White can
mate in time with the clock at 89, not at 90, and with the default limits the answer is right at
every clock, from 90 on in 6 nodes (the Domino search under the rule, before it, was wrong at 90,
10 plies away, beyond its 9, and needed 331,592 nodes at 91). On 12,962 cases of endings with
three to five men (KQK, KRK, KBBK, KBNK, KRRK, KRKB, KRKN, KQKN, KQKR, KBNKN, either side mating),
each a position with a rule and a clock around its rule distance (the fewest plies to a mate, or
to a capture or a pawn move into a position chasolver's full analysis calls winnable, from an
exact search of every position reachable without one), it proves 6,966 of the 6,978 that cannot be
mated in time (99.8%) and none that can, with the arbiter page's limits (4 plies, 8 nodes); the
Domino search under the rule proved 5,976 (85.6%), with 20 times the nodes. On 2,628 such cases
from 400 endings with pawns of chasolver's positions it proves 1,018 of 1,028 (the Domino search:
1,014), and on 5,382 from 650 positions whose pawns are all locked against pawns, 2,670 of 2,798
(2,270); none wrong. Checked against that exact search on the cases above; against the clocked
search of the engine this one grew from on every proof the rules give for chasolver's positions at
clocks near the rules and up to 38 plies from them (33,454 proofs: it found a mate in none); and on
games played to the rules (6,888 under the move rules, 13,776 under the repetition rules, every flag
that came down watched to the end): no false draw.

Twin bishops matter where the mater can check on the other colour: in a composed position of
chasolver's kind, Black's two dark bishops on a7 and b8 hold both flights of a king on a8 while
White's light bishop gives check from c6, a mate the net would miss if it counted the flights; the
rule leaves them out there, and nowhere else.

The four rules of November (stalemate guard, check seed, stuck mater, forced step) move 481 of the
204,060 rows from the search to the lock and prove 4 of the 6 cages that were left; every new lock
was checked by walking all the positions reachable from it, chasolver's labels give no false draw,
and the invariant check knows their certificates ([docs/RESULTS.md](docs/RESULTS.md#the-four-rules-of-november)).
They are in the JavaScript, Rust and WebAssembly engines, with the same answers and node counts, and
in the simple detector's 20 languages (`lock/second/`, the same answers on 66,100 positions).

The walls of a boxed piece that are not pawns (27 November): a still bishop of its colour and its
own frozen king, as in the table above. A rook shut in by its pawn and its bishop
(`rb2k3/p1p1p1p1/P1P1P1P1/8/8/1K6/8/8`) is now a lock. They prove none of the Lichess rows (no row
needs them) and 72 more answers of chasolver's composed positions; every new lock of the test
files was checked by walking all the positions reachable from it, by chasolver's full analysis and
by the invariant check ([docs/RESULTS.md](docs/RESULTS.md#the-walls-of-a-boxed-piece)). The same in
JavaScript, Rust, WebAssembly and the 20 languages.

The stalemated flagged side (28 November), as in the table above: the flagged side, a king and
pawns, is stalemated whatever the mater plays, now or after its one legal move. On chasolver's list
of 19 November it moves 90 rows from the search to the lock (none lost); the rule is exact, and a
brute force with the engine's own moves agrees on 1.34 million sides; chasolver's full analysis and
an independent move generator (shakmaty) find no mate after any of its proofs, and the invariant
check knows its certificate ([docs/RESULTS.md](docs/RESULTS.md#the-stalemated-flagged-side)). The
same in JavaScript, Rust, WebAssembly and the 20 languages.

**What comes next**, in order: the 2 cages left (RwnQJq1k, bKHPqNEw), a bounded full closure for
what stays open, and a written proof of soundness for the detector and the rules above.

## License and credits

- MIT License, © 2026 Cüneyt İnan ([LICENSE](LICENSE)).
- Inspired by FideLite.Art's golfstack engine.
- The Lichess data and the labelled test positions come from Miguel Ambrona's
  [chasolver](https://github.com/miguel-ambrona/chasolver). The chasolver tab runs a port of
  chasolver's MIT-licensed code (`site/chasolver/`); its license text is in
  `site/chasolver/LICENSE.txt` and at the top of `index.html`. chasolver's own site:
  [chasolver.org](https://chasolver.org).
- The Rules tab is adapted from the rules of FideLite.Art (its sections 5 and 6).
- The Lichess scan decompresses with [fzstd](https://github.com/101arrowz/fzstd) (MIT, Arjun Barrett).
