<?php
/**
 * Mateless's lock detector, in its simplest form.
 *
 * Can a side never be mated? The lock detector answers yes when pawns, kings and bishops form a
 * structure that no series of legal moves can open (FIDE 5.2.2 dead position, 6.9 flag fall). It
 * reads bitboards only: it generates no move and searches nothing.
 *
 * Each king's reach (every square it may ever stand on) is grown from its square, never onto a
 * square that a pawn which can never move attacks. The pawns that can never move are those
 * blocked by a wall: a pawn the other side can never take. The squares where a side may take a
 * pawn grow from its king's reach, and so on, until nothing changes. The structure leaks if a
 * pawn can promote or capture, a frozen king can move, a bishop can reach a pawn's path, or the
 * king of the side asked about can reach a square the other side attacks where it has no sure
 * flight. It is tried with both kings free, then with each king frozen on its square (a wall for
 * both sides) when every square around that king is held or attacked by a pawn.
 *
 * A knight, rook or queen on the board, two bishops of one side on squares of one colour, or a
 * possible en passant capture fails it at once. Sound, not complete: a structure it passes can
 * never be opened; one it fails may still be dead.
 *
 * Squares: a1 = 0, b1 = 1, ..., h8 = 63. A set of squares (a bitboard) is an int (signed 64 bits:
 * h8 is the sign bit).
 */

declare(strict_types=1);

namespace Mateless\Lock;

// A hex literal above PHP_INT_MAX is a float: the three sets that hold h8 are written as exact ints.
const FILE_A = 0x0101010101010101;
const FILE_H = FILE_A << 7;          // 0x8080808080808080
const RANK_1 = 0x00000000000000FF;
const RANK_8 = RANK_1 << 56;         // 0xFF00000000000000
const DARK = ~0x55AA55AA55AA55AA;    // 0xAA55AA55AA55AA55: the dark squares; a1 is dark

/** s shifted right by n with zeros coming in: PHP's >> copies the sign bit. */
function shiftRight(int $s, int $n): int { return ($s >> $n) & (PHP_INT_MAX >> ($n - 1)); }

function north(int $s): int { return $s << 8; }
function south(int $s): int { return shiftRight($s, 8); }
function sideways(int $s): int { return (($s << 1) & ~FILE_A) | (shiftRight($s, 1) & ~FILE_H); }
function zone(int $s): int { $v = $s | north($s) | south($s); return $v | sideways($v); }  // s and every square next to it
function diagonal(int $s): int { return sideways(north($s) | south($s)); }                // the squares diagonally next to s
function count(int $s): int { return substr_count(decbin($s), '1'); }

/** Every square reachable from g by steps north through squares of p. */
function fillNorth(int $g, int $p): int
{
    $g |= $p & ($g << 8);
    $p &= $p << 8;
    $g |= $p & ($g << 16);
    $p &= $p << 16;
    return $g | ($p & ($g << 32));
}

/** Every square reachable from g by steps south through squares of p. */
function fillSouth(int $g, int $p): int
{
    $g |= $p & shiftRight($g, 8);
    $p &= shiftRight($p, 8);
    $g |= $p & shiftRight($g, 16);
    $p &= shiftRight($p, 16);
    return $g | ($p & shiftRight($g, 32));
}

/** What the lock detector reads from a position. */
final class Pieces
{
    public int $whitePawns = 0;
    public int $blackPawns = 0;
    public int $whiteKing = 0;
    public int $blackKing = 0;
    public int $whiteBishops = 0;
    public int $blackBishops = 0;
    public int $others = 0;          // knights, rooks and queens of both sides
    public bool $enPassant = false;  // the side to move can capture en passant
}

/** The pieces of a FEN. The en passant square counts only if a pawn can capture onto it. */
function fromFen(string $fen): Pieces
{
    $fields = explode(' ', $fen);
    $p = new Pieces();
    $rank = 7;
    $file = 0;
    foreach (str_split($fields[0]) as $c) {
        if ($c === '/') { $rank--; $file = 0; continue; }
        if (ctype_digit($c)) { $file += (int) $c; continue; }
        $sq = 1 << (8 * $rank + $file++);
        match ($c) {
            'P' => $p->whitePawns |= $sq,
            'p' => $p->blackPawns |= $sq,
            'K' => $p->whiteKing |= $sq,
            'k' => $p->blackKing |= $sq,
            'B' => $p->whiteBishops |= $sq,
            'b' => $p->blackBishops |= $sq,
            default => $p->others |= $sq,   // N R Q n r q
        };
    }
    $whiteToMove = ($fields[1] ?? 'w') !== 'b';
    $ep = $fields[3] ?? '-';
    if ($ep !== '-') {
        $target = 1 << (ord($ep[0]) - ord('a') + 8 * ((int) $ep[1] - 1));
        $p->enPassant = $whiteToMove ? (sideways(south($target)) & $p->whitePawns) !== 0
                                     : (sideways(north($target)) & $p->blackPawns) !== 0;
    }
    return $p;
}

/** Two bishops on squares of one colour (only a promotion makes them). */
function twinBishops(int $b): bool { return count($b & DARK) > 1 || count($b & ~DARK) > 1; }

/** Can White ($white = true) or Black never be mated, by the lock detector? */
function cannotBeMated(Pieces $p, bool $white): bool
{
    if ($p->others || $p->enPassant) return false;
    if (twinBishops($p->whiteBishops) || twinBishops($p->blackBishops)) return false;
    if (!leaks($p, $white, 0)) return true;
    // A king may be frozen only if every square around it is held or attacked by a pawn.
    $held = $p->whitePawns | $p->blackPawns | sideways(north($p->whitePawns) | south($p->blackPawns));
    foreach ([$p->whiteKing, $p->blackKing] as $king) {
        if ((zone($king) & ~$king & ~$held) === 0 && !leaks($p, $white, $king)) return true;
    }
    return false;
}

/** Does the structure leak to the king asked about, with the king $frozen frozen (0: none)? */
function leaks(Pieces $p, bool $white, int $frozen): bool
{
    [$wp, $bp, $wk, $bk] = [$p->whitePawns, $p->blackPawns, $p->whiteKing, $p->blackKing];
    $frozenWhite = ($frozen & $wk) !== 0;
    $frozenBlack = !$frozenWhite && $frozen !== 0;
    $nearFrozenBlack = $frozenBlack ? zone($bk) : 0;
    $nearFrozenWhite = $frozenWhite ? zone($wk) : 0;

    // Quick: the pawns' paths against the first walls already show a promotion or a capture.
    $wCone = fillNorth($wp, ~(($bp & ~$wk) | $frozen));
    $bCone = fillSouth($bp, ~(($wp & ~$bk) | $frozen));
    if (($wCone & RANK_8) | ($bCone & RANK_1) | (north(sideways($wCone)) & $bCone)) return true;

    // The cycle: walls -> pawns that can never move -> king reaches -> capture squares -> walls.
    [$wFixed, $bFixed] = [$wp, $bp];  // pawns that can never move      (shrink)
    [$wKing, $bKing] = [$wk, $bk];    // squares each king may reach    (grow)
    [$wTake, $bTake] = [$wk, $bk];    // squares where a side may take an enemy pawn (grow)
    $wWall = $bWall = ~0;             // pawns the other side can never take, and the frozen king
    for (;;) {
        [$lastWWall, $lastBWall] = [$wWall, $bWall];
        $wWall = ($wp & ~$bTake) | $frozen;
        $bWall = ($bp & ~$wTake) | $frozen;
        $newWFixed = $wFixed & $wWall & south($bWall | $wFixed);
        $newBFixed = $bFixed & $bWall & north($wWall | $bFixed);
        if ($wWall === $lastWWall && $bWall === $lastBWall && $newWFixed === $wFixed && $newBFixed === $bFixed) {
            break;
        }
        // Both kings' reaches, flooded: never onto a fixed pawn, a square it attacks, or next to
        // the frozen king.
        $wMask = ~($newWFixed | sideways(south($newBFixed)) | $nearFrozenBlack);
        $bMask = ~($newBFixed | sideways(north($newWFixed)) | $nearFrozenWhite);
        [$newWKing, $newBKing] = [$wKing, $bKing];
        for (;;) {
            $a = $newWKing | (zone($newWKing) & $wMask);
            $d = $newBKing | (zone($newBKing) & $bMask);
            if ($a === $newWKing && $d === $newBKing) break;
            $newWKing = $a;
            $newBKing = $d;
        }
        if (($frozenWhite && $newWKing !== $wk) || ($frozenBlack && $newBKing !== $bk)) {
            return true;   // the frozen king can move
        }
        // A side may take a pawn where its king goes, and on any square a pawn may walk into.
        $t = $bTake | $newBKing;
        $newBTake = $t | south(fillSouth($t & ~$bWall, ~$bWall));
        $t = $wTake | $newWKing;
        $newWTake = $t | north(fillNorth($t & ~$wWall, ~$wWall));
        $changed = $newWFixed !== $wFixed || $newBFixed !== $bFixed || $newWKing !== $wKing ||
                   $newBKing !== $bKing || $newWTake !== $wTake || $newBTake !== $bTake;
        [$wFixed, $bFixed, $wKing, $bKing] = [$newWFixed, $newBFixed, $newWKing, $newBKing];
        [$wTake, $bTake] = [$newWTake, $newBTake];
        if (!$changed) break;
    }

    // The pawns' cones: every square they may still reach.
    $wCone = fillNorth($wp, ~$bWall);
    $bCone = fillSouth($bp, ~$wWall);
    if (($wCone & RANK_8) | ($bCone & RANK_1)) return true;   // a pawn can promote
    if (north(sideways($wCone)) & $bCone) return true;        // a pawn can capture
    // The bishops' reaches: every square they may reach, around the fixed pawns.
    [$wBish, $bBish, $open] = [$p->whiteBishops, $p->blackBishops, ~($wFixed | $bFixed)];
    for (;;) {
        $a = $wBish | (diagonal($wBish) & $open);
        $d = $bBish | (diagonal($bBish) & $open);
        if ($a === $wBish && $d === $bBish) break;
        $wBish = $a;
        $bBish = $d;
    }
    if ((diagonal($wBish) & $bCone) | (diagonal($bBish) & $wCone)) return true;   // a bishop meets a pawn's path

    // The mating net: can the other side's pawns and bishops catch the king asked about?
    if ($white) {
        $attack = diagonal($bBish) | sideways(south($bCone));
        $reach = $wKing;
        $free = ~($wCone | zone($bKing) | $attack);   // never occupied, attacked or next to the mater
        $spare = $free & ~$wBish;                     // ... nor reached by the king's own bishops
    } else {
        $attack = diagonal($wBish) | sideways(north($wCone));
        $reach = $bKing;
        $free = ~($bCone | zone($wKing) | $attack);
        $spare = $free & ~$bBish;
    }
    // A king next to a spare square, or with free squares beside it both ways, always has a flight.
    $flight = sideways($spare) | north($spare) | south($spare) | ((north($free) | south($free)) & sideways($free));
    return ($attack & $reach & ~$flight) !== 0;
}
