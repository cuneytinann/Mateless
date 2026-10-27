# The lock detector, alone

The lock detector of [Mateless](https://github.com/cuneytinann/Mateless), in its simplest form,
in 20 languages. Each version is about two hundred lines and uses its language's standard library
only. All of them are the same algorithm, line for line, and all give Mateless's answers on the
36,405 positions of `positions.tsv`.

[Türkçe](README.tr.md) · [How it works, with pictures](https://cuneytinann.github.io/Mateless/#lock)

## What it answers

**Can this side never be mated?** Yes, when the pawns, the kings and the bishops form a structure
that no series of legal moves can open. That is the question FIDE asks:

- **when a flag falls** (Article 6.9). Ask it for the player whose time ran out. If the answer is
  yes, the opponent cannot mate, and the game is drawn;
- **after every move** (Article 5.2.2). If neither side can ever be mated, the position is dead
  and the game ends at once, drawn. A lock appears only after a capture or a pawn move, at once or
  one move later, so ask it for both sides when the halfmove clock is 0 or 1.

It reads bitboards only. It generates no move and searches nothing. A knight, rook or queen on
the board fails it at once, and so do two bishops of one side on squares of one colour or a
possible en passant capture. It is **sound, not complete**: a structure it passes can never be
opened, but a position it fails may still be dead. Mateless's
[full ladder](https://github.com/cuneytinann/Mateless#the-ladder) adds a short search behind it.

## Calling it

```
pieces = fromFen(fen)              // or fill Pieces from your own bitboards
cannotBeMated(pieces, white)       // true: White (false: Black) can never be mated
```

`Pieces` holds eight fields:

| field | what |
|---|---|
| white pawns, black pawns | the pawns of each side |
| white king, black king | each king's square, as a set of one square |
| white bishops, black bishops | the bishops of each side |
| others | the knights, rooks and queens of both sides |
| en passant | true when the side to move can capture en passant |

A set of squares is a 64-bit integer, with a1 = 0, b1 = 1, …, h8 = 63: the layout of most chess
programs. `fromFen` counts the en passant square only when a pawn of the side to move stands
ready to take onto it. It does not ask whether that capture would be legal. When your program
knows that, pass it.

## The languages

| language | folder | test, from inside the folder | tested with |
|---|---|---|---|
| C | [`c/`](c/) | `cc -O2 -o test test.c lock.c && ./test` | GCC 13.3 |
| C++ | [`cpp/`](cpp/) | `c++ -std=c++17 -O2 -o test test.cpp && ./test` | GCC 13.3, Clang 18 |
| C# | [`csharp/`](csharp/) | `dotnet run -c Release -- ../positions.tsv` | .NET 8 |
| Crystal | [`crystal/`](crystal/) | `crystal run --release test.cr -- ../positions.tsv` | Crystal 1.11 |
| Go | [`go/`](go/) | `go test -v` | Go 1.24 |
| Haskell | [`haskell/`](haskell/) | `ghc -O2 -outputdir build -o test Test.hs && ./test` | GHC 9.4 |
| Java | [`java/`](java/) | `javac Lock.java Test.java && java Test` | Java 21 (needs 17 or later) |
| JavaScript | [`javascript/`](javascript/) | `node test.mjs` | Node 22 |
| Kotlin | [`kotlin/`](kotlin/) | `kotlinc Lock.kt Test.kt -include-runtime -d lock.jar && java -jar lock.jar` | Kotlin 1.3 |
| Lua | [`lua/`](lua/) | `lua test.lua` | Lua 5.4 (needs 5.3 or later) |
| Nim | [`nim/`](nim/) | `nim c -d:release --hints:off -r test.nim` | Nim 1.6 |
| OCaml | [`ocaml/`](ocaml/) | `ocamlopt -o test lock.mli lock.ml test.ml && ./test` | OCaml 4.14 |
| Pascal | [`pascal/`](pascal/) | `fpc -O2 test.pas && ./test` | Free Pascal 3.2 |
| PHP | [`php/`](php/) | `php test.php` | PHP 8.3 |
| Python | [`python/`](python/) | `python3 test.py` | Python 3.13 |
| Ruby | [`ruby/`](ruby/) | `ruby test.rb` | Ruby 3.3 (needs 3.0 or later) |
| Rust | [`rust/`](rust/) | `cargo test --release -- --nocapture` | Rust 1.97 |
| Scala | [`scala/`](scala/) | `scalac Lock.scala Test.scala && scala Test` | Scala 2.11; written for 2.12, 2.13 and 3 too, but not compiled with 3 yet |
| TypeScript | [`typescript/`](typescript/) | `node test.ts` | Node 22.18 or later (it strips the types); `tsc --strict` checks them |
| Zig | [`zig/`](zig/) | `zig run -O ReleaseFast test.zig` | Zig 0.17 |

`sh test-all.sh` runs every test whose compiler is installed. Each test answers both sides for
every position and prints `<language>: 36405 positions, 0 wrong`.

## How it was tested

`positions.tsv` has one position per line: the FEN, then 1 if White can never be mated or 0,
then the same for Black. The positions are:

- locks from Lichess games and their mirror images;
- the same locks changed in small ways that open some structures and not others: a pawn
  pushed, a king moved, a bishop added, an en passant right made;
- closed structures built at random;
- random positions of kings, pawns and bishops.

Every one is labelled by Mateless's engine, `mateless.js`. Together they make every gate, every
level and every leak decide the answer many times. The file is written by
`tools/lock-positions.js` in the Mateless repository.

## The algorithm in a paragraph

Each king's reach (every square it may ever stand on) is grown from its square. It never grows
onto a square that a pawn which can never move attacks. The pawns that can never move are those
blocked by a wall, and a wall is a pawn the other side can never take. The squares where a side
may take a pawn grow from its king's reach, and so on, until nothing changes. The structure
leaks if any of these holds:

- a pawn can promote or capture;
- a frozen king can move;
- a bishop can reach a pawn's path;
- the king asked about can reach a square the other side attacks, where it has no sure flight.

It is tried with both kings free. It is then tried with each king frozen on its square (a wall for
both sides), when every square around that king is held or attacked by a pawn. The
[Lock detector tab](https://cuneytinann.github.io/Mateless/#lock) explains each step, with
boards, and lets you step through any position.

These versions are meant to be read and carried into other programs. The fast versions are
Mateless's own: `src/lock.js` (JavaScript, on pairs of 32-bit words) and `rust/src/lock.rs`. For
Lichess there is a version on scalachess's own types,
[`Lock.scala`](https://github.com/cuneytinann/scalachess/blob/dead-position-lock/core/src/main/scala/mateless/Lock.scala).

## Licence

MIT, © 2026 Cüneyt İnan. The licence text is in `LICENSE`: beside this file in the zip, at the
root of the repository on GitHub.
