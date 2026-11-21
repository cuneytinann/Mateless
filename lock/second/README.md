# The lock detector, second version, alone

The second version of [Mateless](https://github.com/cuneytinann/Mateless)'s lock detector, in its
simplest form, in the same 20 languages as the first version (one folder up, [`../`](../)). Each
version is 430 to 650 lines and uses its language's standard library only. All of them are the same
algorithm, line for line, and all give the answers of Mateless's second version on the 60,471
positions of `positions.tsv`.

[Türkçe](README.tr.md) · [The first version](../README.md)

## What it answers

The same question as the first version: **can this side never be mated?** Yes, when the men on
the board form a structure that no series of legal moves can open (FIDE 5.2.2 dead position, 6.9
flag fall). It reads bitboards and the side to move. It generates no move and searches nothing, and
it is **sound, not complete**: a structure it passes can never be opened, but a position it fails
may still be dead.

It keeps all of the first version and adds seven rules. Each runs only where its own situation is
on the board, so on any other position it gives the first version's answer.

- **Open pawn pairs.** A white and a black pawn on one file with one empty square between them.
  The positions that can follow split into families by what the pair's pawns have done: neither
  moved, the white one stepped into the gap, or the black one did. Each family is tried like a
  lock. Up to 3 pairs (27 families).
- **Boxed knights, rooks and queens.** A piece whose every step square holds one of its own men that
  never moves, and that no enemy king or bishop reaches, never moves and never falls. Any other
  knight, rook or queen still fails the detector at once.
- **Twin bishops.** Two bishops of one side on squares of one colour no longer fail it. Where they
  could block both of their own king's flights, the mating net does not count on those flights.
- **The stalemate guard.** A pawn the enemy king may take stays a wall if taking it always
  stalemates its owner.
- **The check seed.** A king in a pawn's check starts its reach from the squares it can step to.
- **The stuck mater.** Whatever the flagged side plays, the mater is left without a legal move.
- **The forced step.** A king in a pawn's check whose one legal move is a step: the answer is the
  lock of the position after it.

A possible en passant capture still fails it at once.

When to ask it is as for the first version: when a flag falls, for the player whose time ran out;
and after every move for both sides when the halfmove clock is 0 or 1 (both yes: the position is
dead).

## Calling it

```
pieces = fromFen(fen)              // or fill Pieces from your own bitboards
cannotBeMated(pieces, white)       // true: White (false: Black) can never be mated
```

`Pieces` holds fourteen fields. The second version needs each kind of piece apart, and the side to
move:

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

A set of squares is a 64-bit integer, with a1 = 0, b1 = 1, …, h8 = 63. `fromFen` counts the en
passant square only when a pawn of the side to move stands ready to take onto it. It does not ask
whether that capture would be legal. When your program knows that, pass it.

## The languages

| language | folder | test, from inside the folder | tested with |
|---|---|---|---|
| C | [`c/`](c/) | `cc -O2 -o test test.c lock.c && ./test` | GCC 13.3, Clang 18 |
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
| Scala | [`scala/`](scala/) | `scalac Lock.scala Test.scala && scala Test` | Scala 2.11 |
| TypeScript | [`typescript/`](typescript/) | `node test.ts` | Node 22.18 or later (it strips the types); `tsc --strict` checks them |
| Zig | [`zig/`](zig/) | `zig run -O ReleaseFast test.zig` | Zig 0.17 |

`sh test-all.sh` runs every test whose compiler is installed. Each test answers both sides for
every position and prints `<language>: 60471 positions, 0 wrong`.

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
  rule proves and one it does not.

Of the 37,793 answers "can never be mated", 31,252 are the first version's. The rest come from the
new rules:

| rule | answers |
|---|---|
| the new level: twin bishops, the stalemate guard, the check seed | 5,651 |
| the forced step | 618 |
| boxed knights, rooks and queens | 114 |
| open pawn pairs | 92 |
| the stuck mater | 66 |

The file is written by `tools/lock-positions.js` in the Mateless repository.

These versions are meant to be read and carried into other programs. The fast versions are
Mateless's own, on its `second-version` branch: `src/lock.js` and `rust/src/lock.rs` (also as WebAssembly).
How each rule works, and how it was checked:
[docs/DESIGN.md, section 12](https://github.com/cuneytinann/Mateless/blob/second-version/docs/DESIGN.md#12-the-second-version).

## Licence

MIT, © 2026 Cüneyt İnan. The licence text is in `LICENSE`: one folder up in the zip, at the root
of the repository on GitHub.
