# The lock detector, second version, alone

The second version of [Mateless](https://github.com/cuneytinann/Mateless)'s lock detector, in its
simplest form, in the same 20 languages as the first version (one folder up, [`../`](../)). Each
version is 600 to 1,000 lines (Rust, as rustfmt lays it out, 1,170) and uses its language's
standard library only. All of them are the same algorithm, line for line, and all give the answers
of Mateless's second version on the 66,100 positions of `positions.tsv`.

[Türkçe](README.tr.md) · [The first version](../README.md)

## What it answers

The same question as the first version: **can this side never be mated?** Yes, when the men on
the board form a structure that no series of legal moves can open (FIDE 5.2.2 dead position, 6.9
flag fall). It reads bitboards and the side to move and searches nothing: only its last rule looks
at moves, those of kings, pawns and bishops, two plies at most. It is **sound, not complete**: a
structure it passes can never be opened, but a position it fails may still be dead.

It keeps all of the first version and adds eight rules. Each runs only where its own situation is
on the board, so on any other position it gives the first version's answer.

- **Open pawn pairs.** A white and a black pawn on one file with one empty square between them.
  The positions that can follow split into families by what the pair's pawns have done: neither
  moved, the white one stepped into the gap, or the black one did. Each family is tried like a
  lock. Up to 3 pairs (27 families).
- **Boxed knights, rooks and queens.** A piece whose every step square holds one of its own men that
  never moves, and that no enemy king or bishop reaches, never moves and never falls. Such a man is
  a fixed pawn, another boxed piece, a still bishop (each of its diagonal neighbours held in the same
  way, and no enemy king or bishop reaching it) or the piece's own king, when that king is frozen,
  its side has no castling right left, and it does not stand where a castle leaves it beside its
  rook (g1 with a rook on f1, c1 with one on d1; g8, f8, c8, d8): a castle leaves the halfmove clock
  as it is, so the detector is not asked after one (see below). Any other knight, rook or queen
  still fails the detector at once.
- **Twin bishops.** Two bishops of one side on squares of one colour no longer fail it. Where they
  could block both of their own king's flights, the mating net does not count on those flights.
- **The stalemate guard.** A pawn the enemy king may take stays a wall if taking it always
  stalemates its owner.
- **The check seed.** A king in a pawn's check starts its reach from the squares it can step to.
- **The stuck mater.** Whatever the flagged side plays, the mater is left without a legal move.
- **The forced step.** A king in a pawn's check whose one legal move is a step: the answer is the
  lock of the position after it.
- **The stalemated flagged side.** The flagged side has its king and pawns only, the mater no
  knight, rook or queen, and whatever the mater plays, the flagged side is left without a legal
  move and out of check: a stalemate. With the mater to move, it has a legal move and each one does
  that. With the flagged side to move, it has exactly one legal move (a promotion counts four),
  after which every move of the mater's does that; if the mater has none, that one move ended the
  game. Only this rule looks at moves: the flagged side's one move, then each of the mater's
  answers, with pins and checks counted.

A possible en passant capture still fails it at once.

When to ask it is as for the first version: when a flag falls, for the player whose time ran out;
and after every move for both sides when the halfmove clock is 0 or 1 (both yes: the position is
dead). The stalemated flagged side can also come after a quiet move (a king's step that leaves its
opponent one move): Mateless asks that rule after every move, so asked only at those times, the
detector proves a little less, never wrongly.

## Calling it

```
pieces = fromFen(fen)              // or fill Pieces from your own bitboards
cannotBeMated(pieces, white)       // true: White (false: Black) can never be mated
```

`Pieces` holds sixteen fields. The second version needs each kind of piece apart, the side to move
and whether each side may still castle:

| field | what |
|---|---|
| white pawns, black pawns | the pawns of each side |
| white king, black king | each king's square, as a set of one square |
| white bishops, black bishops | the bishops of each side |
| white knights, black knights | the knights of each side |
| white rooks, black rooks | the rooks of each side |
| white queens, black queens | the queens of each side |
| white to move | true when White is to move |
| en passant | true when the side to move can capture en passant |
| white castles, black castles | true when that side still has a castling right |

A set of squares is a 64-bit integer, with a1 = 0, b1 = 1, …, h8 = 63. `fromFen` counts the en
passant square only when a pawn of the side to move stands ready to take onto it. It does not ask
whether that capture would be legal. When your program knows that, pass it. It reads the castling
field as KQkq or as file letters (Shredder-FEN, Chess960) and counts a right only when its king
stands on its first rank and a rook of its colour on the same rank, on that side of the king (a
letter: on that file). A right matters only to a king that boxes in a piece of its own: while it
stands, the king may still castle away, so it holds nothing. Mateless also drops a right whose
files disagree with the other side's (one castling skeleton for both); this version keeps such a
right, so on such a FEN it may prove less than Mateless, never more.

## The languages

| language | folder | test, from inside the folder | tested with |
|---|---|---|---|
| C | [`c/`](c/) | `cc -O2 -o test test.c lock.c && ./test` | GCC 13.3, Clang 18 |
| C++ | [`cpp/`](cpp/) | `c++ -std=c++17 -O2 -o test test.cpp && ./test` | GCC 13.3, Clang 18 |
| C# | [`csharp/`](csharp/) | `dotnet run -c Release -- ../positions.tsv` | .NET 8 |
| Crystal | [`crystal/`](crystal/) | `crystal run --release test.cr -- ../positions.tsv` | Crystal 1.14 |
| Go | [`go/`](go/) | `go test -v` | Go 1.24 |
| Haskell | [`haskell/`](haskell/) | `ghc -O2 -outputdir build -o test Test.hs && ./test` | GHC 9.4 |
| Java | [`java/`](java/) | `javac Lock.java Test.java && java Test` | Java 21 (needs 17 or later) |
| JavaScript | [`javascript/`](javascript/) | `node test.mjs` | Node 22 |
| Kotlin | [`kotlin/`](kotlin/) | `kotlinc Lock.kt Test.kt -include-runtime -d lock.jar && java -jar lock.jar` | Kotlin 1.3, 2.1 |
| Lua | [`lua/`](lua/) | `lua test.lua` | Lua 5.4 (needs 5.3 or later) |
| Nim | [`nim/`](nim/) | `nim c -d:release --hints:off -r test.nim` | Nim 1.6 |
| OCaml | [`ocaml/`](ocaml/) | `ocamlopt -o test lock.mli lock.ml test.ml && ./test` | OCaml 4.14 |
| Pascal | [`pascal/`](pascal/) | `fpc -O2 test.pas && ./test` | Free Pascal 3.2 |
| PHP | [`php/`](php/) | `php test.php` | PHP 8.3 |
| Python | [`python/`](python/) | `python3 test.py` | Python 3.13 |
| Ruby | [`ruby/`](ruby/) | `ruby test.rb` | Ruby 3.3 (needs 3.0 or later) |
| Rust | [`rust/`](rust/) | `cargo test --release -- --nocapture` | Rust 1.97 |
| Scala | [`scala/`](scala/) | `scalac Lock.scala Test.scala && scala Test` | Scala 2.11, 3.8 (from 3.5 on: `scala run -cp . -M Test`) |
| TypeScript | [`typescript/`](typescript/) | `node test.ts` | Node 22.18 or later (it strips the types); `tsc --strict` checks them |
| Zig | [`zig/`](zig/) | `zig run -O ReleaseFast test.zig` | Zig 0.17 |

`sh test-all.sh` runs every test whose compiler is installed. Each test answers both sides for
every position and prints `<language>: 66100 positions, 0 wrong`.

## How it was tested

`positions.tsv` has one position per line: the FEN, then 1 if White can never be mated or 0, then
the same for Black. Every one is labelled by the second version's detector in Mateless's engine,
`mateless.js` (`lockCannotMate`). The positions are:

- every position of the first version's file (`../positions.tsv`), labelled again;
- the positions of Mateless's second-version data and of its rule examples, with their mirror
  images;
- the Lichess locks changed so that one rule has a chance: a pawn ram pulled apart into an open
  pair, a knight, rook or queen boxed in by its own pawns, the king of the side to move stepped
  into a pawn's check, both kings moved anywhere. For each lock and each change, one position the
  rule proves and one it does not;
- the walls of a boxed piece that are not pawns: a knight, rook or queen boxed in partly by a still
  bishop of its colour or by its own king, put into the Lichess locks the same way; a rook boxed in
  by its pawn and a bishop, and a king, rook and bishop holding one another, each also without the
  bishop or the king; the same with a castling right left, and with one the board cannot have; and
  a king between two rooks, where a castle leaves king and rook and where it does not;
- the stalemated flagged side: one or two positions of each kind (the one move a king's step, a
  push, a double step, a capture, a check, or a move that ends the game at once; the mater with or
  without bishops, with a promotion or a double step among its moves), from chasolver's list of 19
  November and positions a move or two on, with their mirror images and near misses.

Of the 38,403 answers "can never be mated", 31,260 are the first version's. The rest come from the
new rules:

| rule | answers |
|---|---|
| the new level: twin bishops, the stalemate guard, the check seed | 5,663 |
| the forced step | 618 |
| boxed knights, rooks and queens (466 of them with a still bishop or a king among the walls) | 580 |
| the stalemated flagged side | 112 |
| open pawn pairs | 92 |
| the stuck mater | 78 |

Every language also gives Mateless's answers on 183,461 other positions, on 206,149 positions
written to try the castling field (king, rooks and bishops on the first rank over a pawn chain,
under every castling field the board allows) and on 848,240 positions of kings, pawns and bishops
only (the endings of chasolver's lists and of Lichess, and positions one and two moves on), where
the stalemated flagged side proves 785 answers.

The file is written by `tools/lock-positions.js` in the Mateless repository.

These versions are meant to be read and carried into other programs. The fast versions are
Mateless's own, on its `second-version` branch: `src/lock.js` and `rust/src/lock.rs` (also as WebAssembly).
How each rule works, and how it was checked:
[docs/DESIGN.md, section 12](https://github.com/cuneytinann/Mateless/blob/second-version/docs/DESIGN.md#12-the-second-version).

## Licence

MIT, © 2026 Cüneyt İnan. The licence text is in `LICENSE`: one folder up in the zip, at the root
of the repository on GitHub.
