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

**[The site](https://cuneytinann.github.io/Mateless/)** · [Türkçe](README.tr.md) ·
[Design](docs/DESIGN.md) · [Results](docs/RESULTS.md) ·
[for Lichess: mateless-scalachess](https://github.com/cuneytinann/mateless-scalachess)

## The whole structure, not its smallest parts

The centre of Mateless is a **lock detector**: it recognises structures of pawns, kings and
bishops that no series of legal moves can open, without generating a single move, in about 90
nanoseconds.

[chasolver](https://github.com/miguel-ambrona/chasolver) (Miguel Ambrona, FUN 2022), the reference
in this field, works up from the smallest parts: after a short search it analyses the position
piece by piece, a reach for every piece, then a combinatorial check of the mating net. Mateless
looks at the whole at once: all the pawns of a side form one cone, a king has one reach, and a
few bitboard operations take the whole structure to a fixed point. On the locked positions of the
Lichess data below that is **~70× faster** than chasolver's fast check (Rust against Rust), and
with the short search behind it Mateless covers **99.98%** of that data ~17–18× faster.

chasolver is complete: it solves composed problems that Mateless does not try to. Mateless is the
fast layer in front of a complete solver, small enough to run inside a game server on every move.

## Speed

A locked position is proven in **about 90 nanoseconds** (Rust; ~60 ns with the position already in
the cache). A position from a real game, with a knight, rook or queen on the board, is set aside
by the lock detector in **~9 ns**. The whole ladder averages **~0.23 µs** per Lichess timeout,
and following a game costs **~0.35 µs per move** for both sides' flags. The speeds were
measured on chasolver's list up to July 2026 (201,060 rows, 50,970 locks), before the rows of the
August–September scan were added.

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

chasolver proves all 201,060 rows, Mateless 201,024. Coverage is counted on chasolver's list
alone: the 3,000 rows of the August–September scan were chosen as rows that both chasolver and
Mateless prove. The browser runs the same engine: the
arbiter page proves a locked position in under a microsecond, and WebAssembly is 2.5–4× faster
than JavaScript for whole proofs. Details, and why a JavaScript-against-JavaScript comparison
flatters Mateless (~85–95×), in [docs/RESULTS.md](docs/RESULTS.md).

## The ladder

After every move each side whose flag is still up climbs a ladder. The first rung that proves the
side can never mate brings its flag down, for good.

| rung | asked | what it proves | cost (JS; Rust 3–5× less) |
|---|---|---|---|
| **1. material test** | after a capture or a pawn move (in the search: after a capture or a promotion) | the side lacks the material to mate at all | ~0.1 µs |
| **2. lock detector** | after a capture, a pawn move, the lapse of an en passant right, or a king's step out of a pawn's check | pawns, kings and bishops form a structure no series of legal moves can open (any knight, rook or queen fails it at once) | ~0.3–0.8 µs |
| **3. Domino search** | after every move | a helpmate search of 6 plies and 100 nodes finds no mate, and every line ends in a position already seen, a static proof or a stalemate | ~1–5 µs |

- **Both flags down** means a dead position (FIDE 5.2.2): the game ends in a draw.
- **When a flag falls, or a player resigns,** nothing is computed: if the opponent's flag is
  down the game is drawn (FIDE 6.9, 5.1.2), otherwise it is lost.
- Both sides are examined in one pass: the side-independent part of the lock detector and the
  walk of the two searches are shared.
- The static tests are asked only after a move that can have changed their answer
  (`testsAfter`). For that the flags remember two facts of the ply before: whether an en passant
  square stood, and whether the side to move was in a pawn's check. After plies left out or a
  takeback, the position alone decides (both tests when the halfmove clock is at most 1).
- **No move-count rule takes part in a proof:** the 50- and 75-move rules and repetitions only cut
  lines short, so leaving them out can cost a proof but never make a false one.

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

| class | rows | share | drawn by Lichess today (scalachess 18.0.1) | with the lock patch (in-game) | at the flag instead (a-lock) |
|---|---|---|---|---|---|
| **locked positions** (the lock detector) | **52,050** | 26.7% | 141 | **52,034** | 52,050 |
| forced lines (the Domino search) | 143,201 | 73.3% | 138,431 | 138,431 | 138,669 |
| unproven | 36 | 0.018% | 0 | 0 | 0 |
| **all** | **195,287** | | **138,572** (71.0%) | **190,465** (97.5%) | 190,719 (97.7%) |

Lichess today draws most forced lines: scalachess #821 (merged in August 2026; on Lichess from
6 September, judging by the data) added a one-move lookahead to the test that lila asks when a
flag falls. What it still misses is, almost entirely, **locked positions**: 51,909 of its 56,715
misses. From 7 to 30 September, with #821 in use, 460 games were still lost on time this way;
422 of them (92%) were locks.

The lock patch proposed for Lichess is
[mateless-scalachess](https://github.com/cuneytinann/mateless-scalachess)'s `in-game`: the lock
detector alone (181 lines of Scala) as a dead-position check (FIDE 5.2.2) in scalachess's
`autoDraw`, asked for both sides when the halfmove clock is 0 or 1, right after a capture or a
pawn move and one move later: a lock can appear only then. The game ends in a draw the moment it
locks, so 52,034 of the rows above would have ended before the flag fell: 51,893 that Lichess
scores as wins today, the 422 of September among them, and 141 it draws at the flag. It leaves
16 locks of one side only (not dead: the flagged side could still mate) and 238 rows where the
lock comes one move after the flag. The alternative, `a-lock`, asks the same
detector only when a flag falls, at the position and in #821's lookahead; it draws those 254 too,
but a dead game is still played on until it ends some other way: in August and September,
8,718 drawn games went on for a median of 14 plies after such a lock had appeared. The whole
ladder, Mateless itself or that repository's `c-ladder` patch, draws 195,251 rows (99.98%).

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
detector alone on top of today's Lichess, 4,822 (`in-game`) or 4,568 (`a-lock`).

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
  in 20 languages, downloads from there as `mateless-lock.zip`.
- **Rules**: FIDE 5.2.2, 6.9 and 5.1.2, what the book says and how an algorithm can read it.
- **Lichess scan**: drop one of Lichess's monthly databases (`.pgn.zst`) and it is scanned in
  the browser, on every core, without unpacking it first: the games won although the winner could
  never mate, and the draws played on after the position had died, by Mateless and by chasolver,
  as CSV files.
- **chasolver**: a JavaScript port of Miguel Ambrona's chasolver 3.0.0 (not official; MIT),
  the complete solver, with a mating line for every winnable position. On 398,960 inputs its fast
  check gave the official Rust build's answer on every row. The arbiter's "Ask chasolver" button
  hands a position over to it.

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

// A platform with its own game object keeps only the flags: the new position and its ply.
const flags = new E.Flags();
flags.update(position, 0);                          // the first position (ply 0): both sides locked
flags.neverMates(E.WHITE) && flags.neverMates(E.BLACK);   // true: a dead position
```

`mateless.js` runs as a classic `<script>` (`globalThis.Mateless`) and as a Node module;
`mateless.mjs` is the same single file as an ES module (`import { fromFen, proveBoth } from
'./mateless.mjs'`, or `import Mateless from './mateless.mjs'`). The source modules
(`./src/index.js`) give the same answers but run ~10–30% slower in V8.

**WebAssembly.** The Rust port compiled to `mateless.wasm` (84 KB), with `mateless-wasm.js` as
its dependency-free bridge: the whole ladder (static tests, Domino, both proofs, a game's flags,
perft), with `mateless.js`'s answers to the node count. Proofs run ~2.5–4× faster than in JS, a
game's flags ~3.2× per ply; native Rust is another ~1.5–1.9× faster. Rebuild with
`node tools/build-wasm.js`.

```js
const W = require('./mateless-wasm.js').instantiate(require('fs').readFileSync('mateless.wasm'));   // browser: await MatelessWasm.load('mateless.wasm')
W.proveBoth('8/8/4k3/3p2p1/1p1P1pP1/1P3P2/8/3K4 b - - 47 92');   // [White flagged, Black flagged], as in mateless.js
const flags = new W.Flags();                                // a game's flags
flags.update(fen, ply);                                     // after every move, with a FEN or W.fromFen(fen).position
```

**Rust** ([rust/README.md](rust/README.md)):

```rust
let pos = mateless::from_fen("8/8/4k3/3p2p1/1p1P1pP1/1P3P2/8/3K4 b - - 47 92").unwrap();
let mut search = mateless::Domino::new();
let proof = mateless::prove_cannot_be_mated(&mut search, &pos, mateless::BLACK, mateless::DOMINO_PLY, mateless::DOMINO_BUDGET);
assert!(proof.proven && proof.static_proof);    // the lock detector: White can never mate
```

**TypeScript.** The types are in `mateless.d.ts`, beside the engine, so TypeScript finds them:

```ts
import Mateless = require('./mateless');      // or: import { fromFen, proveBoth } from './mateless';
const r = Mateless.fromFen('8/8/4k3/3p2p1/1p1P1pP1/1P3P2/8/3K4 b - - 47 92');
if (r.error === undefined) Mateless.proveCannotBeMated(r.position, Mateless.BLACK);   // Proof
```

**scalachess (Lichess)** has its own repository,
[mateless-scalachess](https://github.com/cuneytinann/mateless-scalachess), with patch sets on
scalachess 18.0.1: the lock detector alone as a dead-position check in `autoDraw` (`in-game`,
proposed), the same detector when a flag falls (`a-lock`, the alternative), and the whole ladder
(`c-ladder`, for reference).

## Taking only the lock detector

For a platform that wants the lock detector without the rest of the ladder.

**The simplest way:** [`mateless-lock.zip`](mateless-lock.zip) (the folder [`lock/`](lock/)) holds
the detector alone, in its simplest form, in 20 languages: C, C++, C#, Crystal, Go, Haskell, Java,
JavaScript, Kotlin, Lua, Nim, OCaml, Pascal, PHP, Python, Ruby, Rust, Scala, TypeScript, Zig. Each
is about two hundred lines on its language's standard library, and all give the same answers on the
same 36,406 test positions ([lock/README.md](lock/README.md)). The table below is the fast versions
inside Mateless.

**What it needs:** the bitboards of the pawns, kings and bishops (by colour), whether any knight,
rook or queen is on the board, and the en passant square (only when a legal capture onto it
exists). It generates no move and searches nothing.

| language | function |
|---|---|
| JS | `lockCannotMate(pos, flagged)` (`src/lock.js`) |
| WebAssembly | `lockCannotMate(fen or Position, flagged)` (`mateless-wasm.js`) |
| Rust | `lock_test(&pos, flagged)` (`rust/src/lock.rs`) |
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
- **A dead-position check after every move** (the `in-game` patch proposed for Lichess, in
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
- **At the flag, with a one-move lookahead** (the `a-lock` alternative; scalachess #821 looks at
  every move of the flagged side): ask the lock at the position and at every child. All three
  cases come by themselves; in a child no en passant right is left. On the Lichess data the
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
| `src/domino.js` | **rung 3:** the Domino search (6 plies / 100 nodes) | legal moves piece by piece in a fixed order, made and taken back in place, "is there a legal move?", an exact code of a position |
| `src/ladder.js` | **the ladder:** when each rung is asked, the proofs for one position, a game's two flags (`Flags`) | the halfmove clock and the en passant square |
| `src/board.js` | a reference board: bitboards, magic bitboards, legal moves, FEN, Chess960 | — |
| `src/game.js` | a reference game: result codes, repetitions, the 75-move rule, fivefold repetition, `Game` | — |
| `src/index.js` | the public API | |

`tools/build.js` joins the layers into one file, `mateless.js` (and `mateless.mjs`): the same
code, line for line, with the import lines and `export` keywords taken out. The Rust port has the
same layers (`rust/src/board.rs`, `material.rs`, `lock.rs`, `domino.rs`, `ladder.rs`).

## Files

```
src/                 the source: board, material, lock, domino, ladder, game, index (ES modules)
mateless.js          the engine, one file (built from src/ by tools/build.js; never edited by hand)
mateless.mjs         the same file as an ES module (also from tools/build.js)
mateless.d.ts        TypeScript types
mateless.wasm        the Rust port as WebAssembly (tools/build-wasm.js); bridge: mateless-wasm.js
index.html           the whole site in one page: arbiter, lock detector, rules, Lichess scan, chasolver
lock/                the lock detector alone, in its simplest form, in 20 languages, and the
                     positions that test them all (lock/README.md)
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
node classify.js 6 100 1                         # against chasolver's labels: FALSE DRAWS must be 0
node game_flags_check.js 1 3000 200              # every flag that comes down, against chasolver's full solver
node twosided_check.js <files>                   # both sides in one pass = each side alone, every field
node trigger_check.js                            # testsAfter = the clock rule, takebacks included
node build_check.js                              # mateless.js and .mjs = a build of src/, the page carries the same engine,
                                                 # lock/positions.tsv and mateless-lock.zip are up to date
(cd ../lock && sh test-all.sh)                   # the lock detector alone, every language, on lock/positions.tsv
node page_check.js                               # the page, every tab, in headless Chromium
node wasm_check.js                               # mateless.wasm = mateless.js
node types_check.js                              # mateless.d.ts against the engine (npm i --no-save typescript)
node lock_invariant.js ../data/locked_positions.tsv 50   # the invariant check, every 50th lock
```

## What comes next

This version is the fast layer: sound, small, and meant to run on a game server after every
move. A second version will come beside it. It will not be complete either, but it will be wider
in scope, with completeness as its goal, and it will keep growing as new rules are added. This
version already covers 99.98% of the Lichess data, so in practice the wider one will matter
mostly to the curious and to research; it will not be rushed.

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
