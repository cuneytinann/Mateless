<?php
/**
 * Mateless's lock detector, second version, in its simplest form.
 *
 * Can a side never be mated? The lock detector answers yes when pawns, kings and bishops (and
 * knights, rooks or queens boxed in by their own men) form a structure that no series of legal
 * moves can open (FIDE 5.2.2 dead position, 6.9 flag fall). It reads bitboards and the side to
 * move and searches nothing: only its last rule looks at moves, those of kings, pawns and bishops,
 * two plies at most.
 *
 * The first version (../../php/lock.php) grows each king's reach, the pawns that can never move,
 * and the squares where each side may take a pawn, until nothing changes; the structure leaks if a
 * pawn can promote or capture, a frozen king can move, a bishop can reach a pawn's path, or the
 * king asked about can reach a square the other side attacks without a sure flight. This version
 * keeps all of it and adds, each only where its situation is on the board:
 *   - open pawn pairs: a white and a black pawn on one file with one empty square between them;
 *     the reachable positions split into families by what the pair's pawns have done (neither
 *     moved, the white one stepped into the gap, the black one did), up to 3 pairs;
 *   - boxed knights, rooks and queens: a piece whose every step square holds one of its own men
 *     that never moves, and that no enemy king or bishop reaches, never moves nor falls; such a man
 *     is a fixed pawn, another boxed piece, a still bishop (every diagonal neighbour held so, and out
 *     of the enemy king's and bishops' reach) or the piece's own frozen king (its side with no
 *     castling right left and not standing where a castle leaves it beside its rook);
 *   - twin bishops: two bishops of one side on one colour no longer fail it; the mating net leaves
 *     out its second flight rule where they may hold both flights;
 *   - the stalemate guard: a pawn the enemy king may take stays a wall if taking it always
 *     stalemates its owner;
 *   - the check seed: a king in a pawn's check starts its reach from the squares it can step to;
 *   - the stuck mater: whatever the flagged side plays, the mater is left without a move;
 *   - the forced step: a king in a pawn's check with one legal move, a step: the lock of the
 *     position after it;
 *   - the stalemated flagged side: a king and pawns that, whatever the mater (a king, pawns and
 *     bishops) plays, is left without a legal move and out of check, now or after the one legal
 *     move it has.
 * A possible en passant capture fails it at once. Sound, not complete: a structure it passes can
 * never be opened; one it fails may still be dead.
 *
 * Squares: a1 = 0, b1 = 1, ..., h8 = 63. A set of squares (a bitboard) is an int (signed 64 bits:
 * h8 is the sign bit).
 */

declare(strict_types=1);

namespace Mateless\Lock\Second;

// A hex literal above PHP_INT_MAX is a float: the sets that hold h8 are written as exact ints.
const FILE_A = 0x0101010101010101;
const FILE_H = FILE_A << 7;          // 0x8080808080808080
const RANK_1 = 0x00000000000000FF;
const RANK_3 = RANK_1 << 16;
const RANK_6 = RANK_1 << 40;
const RANK_8 = RANK_1 << 56;         // 0xFF00000000000000
const DARK = ~0x55AA55AA55AA55AA;    // 0xAA55AA55AA55AA55: the dark squares; a1 is dark
const MAX_PAIRS = 3;                 // the most open pairs the families are split on (3^3 = 27)

/** s shifted right by n with zeros coming in: PHP's >> copies the sign bit. */
function shiftRight(int $s, int $n): int { return ($s >> $n) & (PHP_INT_MAX >> ($n - 1)); }

function north(int $s): int { return $s << 8; }
function south(int $s): int { return shiftRight($s, 8); }
function sideways(int $s): int { return (($s << 1) & ~FILE_A) | (shiftRight($s, 1) & ~FILE_H); }
function zone(int $s): int { $v = $s | north($s) | south($s); return $v | sideways($v); }  // s and every square next to it
function steps(int $s): int { return zone($s) & ~$s; }                                     // the squares next to s
function diagonal(int $s): int { return sideways(north($s) | south($s)); }                // the squares diagonally next to s
function count(int $s): int { return substr_count(decbin($s), '1'); }
/** The lowest square of s (h8 alone is PHP_INT_MIN, whose negation is no int). */
function lowest(int $s): int { return $s === PHP_INT_MIN ? $s : $s & -$s; }
/** The index of the square of the set of one square s. */
function index(int $s): int { for ($i = 0; ; $i++) if (($s >> $i) & 1) return $i; }

/** The squares a knight on s goes to. */
function knight(int $s): int
{
    $one = sideways($s);
    $two = (($s << 2) & ~(FILE_A | (FILE_A << 1))) | (shiftRight($s, 2) & ~(FILE_H | shiftRight(FILE_H, 1)));
    return north(north($one)) | south(south($one)) | north($two) | south($two);
}

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

/** Every square a king may reach from k through squares of m. */
function flood(int $k, int $m): int
{
    for (;;) { $a = $k | (zone($k) & $m); if ($a === $k) return $k; $k = $a; }
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
    public int $whiteKnights = 0;
    public int $blackKnights = 0;
    public int $whiteRooks = 0;
    public int $blackRooks = 0;
    public int $whiteQueens = 0;
    public int $blackQueens = 0;
    public bool $whiteToMove = true;
    public bool $enPassant = false;  // the side to move can capture en passant
    public bool $whiteCastles = false;  // White has a castling right (its king and that rook in place)
    public bool $blackCastles = false;
}

/** What one level leaves for the mating net (and for the families after it). */
final class Sets
{
    public function __construct(
        public int $wCone, public int $bCone, public int $wFixed, public int $bFixed,
        public int $wKing, public int $bKing, public int $wBish, public int $bBish,
        public int $wTake, public int $bTake,
    ) {}
}

/** The pieces of a FEN. The en passant square counts only if a pawn can capture onto it. */
function fromFen(string $fen): Pieces
{
    $fields = explode(' ', $fen);
    $p = new Pieces();
    $names = ['P' => 'whitePawns', 'p' => 'blackPawns', 'K' => 'whiteKing', 'k' => 'blackKing',
              'B' => 'whiteBishops', 'b' => 'blackBishops', 'N' => 'whiteKnights', 'n' => 'blackKnights',
              'R' => 'whiteRooks', 'r' => 'blackRooks', 'Q' => 'whiteQueens', 'q' => 'blackQueens'];
    $rank = 7;
    $file = 0;
    foreach (str_split($fields[0]) as $c) {
        if ($c === '/') { $rank--; $file = 0; continue; }
        if (ctype_digit($c)) { $file += (int) $c; continue; }
        $p->{$names[$c]} |= 1 << (8 * $rank + $file++);
    }
    $p->whiteToMove = ($fields[1] ?? 'w') !== 'b';
    $ep = $fields[3] ?? '-';
    if ($ep !== '-') {
        $target = 1 << (ord($ep[0]) - ord('a') + 8 * ((int) $ep[1] - 1));
        $p->enPassant = $p->whiteToMove ? (sideways(south($target)) & $p->whitePawns) !== 0
                                        : (sideways(north($target)) & $p->blackPawns) !== 0;
    }
    $rights = $fields[2] ?? '-';
    foreach ($rights === '-' ? [] : str_split($rights) as $c) {
        $white = ctype_upper($c);
        $back = $white ? RANK_1 : RANK_8;
        $king = ($white ? $p->whiteKing : $p->blackKing) & $back;
        $rooks = ($white ? $p->whiteRooks : $p->blackRooks) & $back;
        if ($king === 0) continue;   // a right without its king in place does not count
        $kf = squareOf($king) % 8;
        $files = array_map(fn($r) => squareOf($r) % 8, squares($rooks));
        $up = strtoupper($c);
        if ($up === 'K') $ok = array_filter($files, fn($f) => $f > $kf) !== [];
        elseif ($up === 'Q') $ok = array_filter($files, fn($f) => $f < $kf) !== [];
        else $ok = ord($up) - ord('A') !== $kf && in_array(ord($up) - ord('A'), $files, true);
        if ($ok) { if ($white) $p->whiteCastles = true; else $p->blackCastles = true; }
    }
    return $p;
}

/** The one-square sets of s. */
function squares(int $s): array
{
    $out = [];
    while ($s !== 0) { $b = lowest($s); $out[] = $b; $s ^= $b; }
    return $out;
}

/** The square of a one-square set. */
function squareOf(int $b): int { return strlen(decbin($b)) - 1; }

/** Can White ($white = true) or Black never be mated, by the lock detector? */
function cannotBeMated(Pieces $p, bool $white): bool
{
    return locked($p, $white) || stalematedFlagged($p, $white);
}

/** The lock: no series of legal moves opens the structure for the side asked about. */
function locked(Pieces $p, bool $white): bool
{
    $after = forcedStep($p);
    if ($after !== null) return locked($after, $white);
    $wx = $p->whiteKnights | $p->whiteRooks | $p->whiteQueens;
    $bx = $p->blackKnights | $p->blackRooks | $p->blackQueens;
    if (($wx | $bx) !== 0) return boxedLock($p, $white, $wx, $bx);
    if ($p->enPassant) return false;
    $gaps = north($p->whitePawns) & south($p->blackPawns) & ~($p->whitePawns | $p->blackPawns);
    foreach (levels($p) as $frozen) {
        if ($gaps !== 0) {
            $f = families($p, $gaps, $frozen, $white);
            if ($f === 'lock') return true;
            if ($f === 'refuted') continue;   // family A, the level with more walls, leaked: the level leaks too
        }
        $s = level($p, $frozen, guard: true);
        if ($s !== null && !netLeaks($p, $s, $white, 0)) return true;
    }
    return stuckMater($p, $white);
}

/** The levels: both kings free (0), then each king frozen on its square (a wall for both sides)
    when every square around it is held or attacked by a pawn (or holds one of its own pieces, wOwn
    or bOwn, where boxed pieces are on the board). */
function levels(Pieces $p, int $wOwn = 0, int $bOwn = 0): array
{
    $held = $p->whitePawns | $p->blackPawns | sideways(north($p->whitePawns) | south($p->blackPawns));
    $out = [0];
    foreach ([[$p->whiteKing, $wOwn], [$p->blackKing, $bOwn]] as [$king, $own]) if ((steps($king) & ~($held | $own)) === 0) $out[] = $king;
    return $out;
}

/** May this side's king hold a boxed piece's step square (when frozen)? Not with a castling right
    left (a castling rook may stand beside its king, in Chess960, and castling moves it), and not
    where a castle leaves it beside its rook (g1 with a rook on f1, c1 with one on d1; g8, f8, c8,
    d8): a castle leaves the halfmove clock as it is, so the lock is not asked after one. */
function kingWall(Pieces $p, bool $white): bool
{
    [$king, $rooks, $castles, $g, $c] = $white ? [$p->whiteKing, $p->whiteRooks, $p->whiteCastles, 1 << 6, 1 << 2]
                                                : [$p->blackKing, $p->blackRooks, $p->blackCastles, 1 << 62, 1 << 58];
    return !$castles && ($rooks & ((($king & $g) >> 1) | (($king & $c) << 1))) === 0;
}

/** The still bishops among b: every diagonal neighbour held for good (held: fixed pawns and boxed
    pieces of their colour) or by another still bishop, and out of the enemy king's and bishops'
    reach. Such a bishop never moves and is never taken (a pawn taking it fails the bishop contact
    test). The largest such set. */
function stillBishops(int $b, int $held, int $reach): int
{
    $s = $b & ~$reach;
    for (;;) {
        $n = 0;
        foreach (squares($s) as $q) if ((diagonal($q) & ~($held | $s)) === 0) $n |= $q;
        if ($n === $s) return $s;
        $s = $n;
    }
}

/**
 * One level: the fixed point of the walls, the pawns that can never move, the kings' reaches, the
 * squares where each side may take a pawn, the pawns' cones and the bishops' reaches. The sets the
 * mating net reads, or null when the structure leaks whichever side is asked about.
 * wp, bp: the pawns (a family has a pair's pawn moved into its gap); v: walls for both sides (the
 * gaps of a family's pairs that stay); start: where the kings' reaches, capture squares and
 * bishops' reaches start (a family's); wx, bx, ws, bs: the boxed pieces' candidates and their step
 * squares; guard: the stalemate guard and the check seed (plain levels only).
 */
function level(Pieces $p, int $frozen, ?int $wp = null, ?int $bp = null, int $v = 0, ?array $start = null,
               int $wx = 0, int $bx = 0, int $ws = 0, int $bs = 0, bool $guard = false): ?Sets
{
    $wp ??= $p->whitePawns;
    $bp ??= $p->blackPawns;
    [$wk, $bk] = [$p->whiteKing, $p->blackKing];
    $v |= $frozen;
    $frozenWhite = ($frozen & $wk) !== 0;
    $frozenBlack = !$frozenWhite && $frozen !== 0;
    $nearFrozenBlack = $frozenBlack ? zone($bk) : 0;
    $nearFrozenWhite = $frozenWhite ? zone($wk) : 0;
    [$wSeed, $bSeed] = $guard && $frozen === 0 ? checkSeed($p) : [$wk, $bk];
    [$wKing, $bKing, $wTake, $bTake] = [$wSeed, $bSeed, $wSeed, $bSeed];
    [$wBish, $bBish] = [$p->whiteBishops, $p->blackBishops];
    if ($start !== null) [$wKing, $bKing, $wTake, $bTake, $wBish, $bBish] = $start;
    [$wCone, $bCone, $wFixed, $bFixed] = [$wp, $bp, $wp, $bp];
    $wGuard = $bGuard = $guard ? ~0 : 0;   // nothing is taken yet
    for (;;) {
        // Boxed: the pieces no enemy king or bishop reaches. Walls: pawns the other side can never
        // take (or whose capture stalemates their owner), the frozen king, the gaps, boxed pieces.
        $boxed = ($wx & ~($bKing | $bBish)) | ($bx & ~($wKing | $wBish));
        $wWall = ($wp & ~($bTake & ~$wGuard)) | $v | $boxed;
        $bWall = ($bp & ~($wTake & ~$bGuard)) | $v | $boxed;
        $nwFixed = $wFixed & $wWall & south($bWall | $wFixed);
        $nbFixed = $bFixed & $bWall & north($wWall | $bFixed);
        $nwCone = fillNorth($wCone, ~$bWall);
        $nbCone = fillSouth($bCone, ~$wWall);
        // The kings: never onto a fixed pawn, a square it attacks, or next to the frozen king.
        $bHit = sideways(south($nbFixed));
        $wHit = sideways(north($nwFixed));
        // With boxed pieces on the board, never onto its own boxed pieces and still bishops either.
        $wStill = ($wx | $bx) !== 0 ? stillBishops($p->whiteBishops, $nwFixed | ($wx & $boxed), $bKing | $bBish) : 0;
        $bStill = ($wx | $bx) !== 0 ? stillBishops($p->blackBishops, $nbFixed | ($bx & $boxed), $wKing | $wBish) : 0;
        $nwKing = flood($wKing, ~($nwFixed | $bHit | $nearFrozenBlack | ($wx & $boxed) | $wStill));
        $nbKing = flood($bKing, ~($nbFixed | $wHit | $nearFrozenWhite | ($bx & $boxed) | $bStill));
        [$nwBish, $nbBish, $open] = [$wBish, $bBish, ~($nwFixed | $nbFixed)];
        for (;;) {
            $a = $nwBish | (diagonal($nwBish) & $open);
            $d = $nbBish | (diagonal($nbBish) & $open);
            if ($a === $nwBish && $d === $nbBish) break;
            $nwBish = $a;
            $nbBish = $d;
        }
        // A side may take a pawn where its king goes, and on any square a pawn may walk into.
        $t = $bTake | $nbKing;
        $nbTake = $t | south(fillSouth($t & ~$bWall, ~$bWall));
        $t = $wTake | $nwKing;
        $nwTake = $t | north(fillNorth($t & ~$wWall, ~$wWall));
        [$nwGuard, $nbGuard] = [$wGuard, $bGuard];
        if ($guard) {
            $block = $nwFixed | $nbFixed;
            $wHasB = $p->whiteBishops !== 0;
            $bHasB = $p->blackBishops !== 0;
            $nwGuard = $wHasB ? 0 : stalemateGuard($wp & $nbTake & $nwFixed, $wp, $nwFixed, $nwKing, $nwFixed | $bHit, $nbKing, $bHasB, $block);
            $nbGuard = $bHasB ? 0 : stalemateGuard($bp & $nwTake & $nbFixed, $bp, $nbFixed, $nbKing, $nbFixed | $wHit, $nwKing, $wHasB, $block);
        }
        $new = [$nwCone, $nbCone, $nwFixed, $nbFixed, $nwKing, $nbKing, $nwBish, $nbBish, $nwTake, $nbTake, $nwGuard, $nbGuard];
        $old = [$wCone, $bCone, $wFixed, $bFixed, $wKing, $bKing, $wBish, $bBish, $wTake, $bTake, $wGuard, $bGuard];
        [$wCone, $bCone, $wFixed, $bFixed, $wKing, $bKing, $wBish, $bBish, $wTake, $bTake, $wGuard, $bGuard] = $new;
        if ($new === $old) break;
    }
    $boxed = ($wx & ~($bKing | $bBish)) | ($bx & ~($wKing | $wBish));
    if ((($wCone & RANK_8) | ($bCone & RANK_1)) !== 0) return null;                              // a pawn can promote
    if (((north(sideways($wCone)) & ($bCone | $bx)) | (south(sideways($bCone)) & $wx)) !== 0) return null;  // a pawn can capture
    if (($frozenWhite && $wKing !== $wk) || ($frozenBlack && $bKing !== $bk)) return null;    // the frozen king can move
    if (((diagonal($wBish) & $bCone) | (diagonal($bBish) & $wCone)) !== 0) return null;       // a bishop meets a pawn's path
    // A piece may step: a step square not held by a fixed pawn, a boxed piece or a still bishop of
    // its colour, or by its frozen king (where the king may be a wall).
    $wStill = ($wx | $bx) !== 0 ? stillBishops($p->whiteBishops, $wFixed | ($wx & $boxed), $bKing | $bBish) : 0;
    $bStill = ($wx | $bx) !== 0 ? stillBishops($p->blackBishops, $bFixed | ($bx & $boxed), $wKing | $wBish) : 0;
    $wKw = $frozenWhite && kingWall($p, true) ? $wk : 0;
    $bKw = $frozenBlack && kingWall($p, false) ? $bk : 0;
    if ((($ws & ~($wFixed | ($wx & $boxed) | $wStill | $wKw)) | ($bs & ~($bFixed | ($bx & $boxed) | $bStill | $bKw))) !== 0) return null;  // a piece may step
    if (($wGuard | $bGuard) !== 0) {
        // A king that takes a guarded pawn ends the game: for the mating net, the kings' reaches
        // again, now stopping at the enemy's guarded pawns.
        $wKing = flood($wSeed, ~($wFixed | sideways(south($bFixed)) | $nearFrozenBlack | ($bp & $bGuard)));
        $bKing = flood($bSeed, ~($bFixed | sideways(north($wFixed)) | $nearFrozenWhite | ($wp & $wGuard)));
    }
    return new Sets($wCone, $bCone, $wFixed, $bFixed, $wKing, $bKing, $wBish, $bBish, $wTake, $bTake);
}

/** The mating net: can the other side's pawns and bishops catch the king asked about? occ: squares
    that stand occupied for good besides (the boxed pieces'). */
function netLeaks(Pieces $p, Sets $s, bool $white, int $occ): bool
{
    if ($white) {
        $attack = diagonal($s->bBish) | sideways(south($s->bCone));
        $reach = $s->wKing;
        $free = ~($s->wCone | $occ | zone($s->bKing) | $attack);   // never occupied, attacked or next to the mater
        $spare = $free & ~$s->wBish;                               // ... nor reached by the king's own bishops
        $twins = $p->whiteBishops;
    } else {
        $attack = diagonal($s->wBish) | sideways(north($s->wCone));
        $reach = $s->bKing;
        $free = ~($s->bCone | $occ | zone($s->wKing) | $attack);
        $spare = $free & ~$s->bBish;
        $twins = $p->blackBishops;
    }
    // A king next to a spare square, or with free squares beside it both ways, always has a flight.
    // The second rule counts on at most one of the king's own bishops on the colour of those two
    // squares (the colour opposite the king's): not on the king squares where it has two or more.
    $noPair = (count($twins & DARK) > 1 ? ~DARK : 0) | (count($twins & ~DARK) > 1 ? DARK : 0);
    $flight = sideways($spare) | north($spare) | south($spare) |
              ((north($free) | south($free)) & sideways($free) & ~$noPair);
    return ($attack & $reach & ~$flight) !== 0;
}

/** The check seed: the side to move is in a pawn's check, so its king must step now, to a square it
    can step to (not its own pawn, not a square an enemy pawn attacks, not next to the enemy king);
    its reach starts there. Not when it has no such square (that may be a mate now), when one of its
    pawns can take a checking pawn, or with a bishop on the board. The kings' starting sets. */
function checkSeed(Pieces $p): array
{
    [$wp, $bp, $wk, $bk, $white] = [$p->whitePawns, $p->blackPawns, $p->whiteKing, $p->blackKing, $p->whiteToMove];
    if (($p->whiteBishops | $p->blackBishops) !== 0) return [$wk, $bk];
    [$k, $own] = $white ? [$wk, $wp] : [$bk, $bp];
    $checkers = $white ? sideways(north($k)) & $bp : sideways(south($k)) & $wp;
    if ($checkers === 0) return [$wk, $bk];
    $attacked = $white ? sideways(south($bp)) : sideways(north($wp));
    $to = steps($k) & ~$own & ~$attacked & ~steps($white ? $bk : $wk);
    $takers = ($white ? sideways(south($checkers)) : sideways(north($checkers))) & $own;
    if ($to === 0 || $takers !== 0) return [$wk, $bk];
    return $white ? [$to, $bk] : [$wk, $to];
}

/** The stalemate guard: of the owner's fixed pawns cand (which the enemy king may take), those whose
    capture always stalemates the owner. The owner must have nothing else that moves (every other
    pawn fixed; no bishop, which the caller sees to). reach: where the owner's king may stand; shut:
    squares it can never step to (own fixed pawns, squares the enemy's fixed pawns attack);
    enemyKing: the enemy king's reach; block: squares a bishop's line never crosses. */
function stalemateGuard(int $cand, int $own, int $ownFixed, int $reach, int $shut, int $enemyKing,
                        bool $enemyBishops, int $block): int
{
    if (($own & ~$ownFixed) !== 0) return 0;
    $guard = 0;
    for ($c = $cand; $c !== 0; $c ^= $pawn) {
        $pawn = lowest($c);
        $near = steps($pawn);
        $from = $near & $enemyKing;           // where the enemy king takes from
        $x = $shut | $near | $pawn;           // after the capture, the owner's king may not step there
        $held = true;
        for ($k = $reach & ~($near | $pawn); $k !== 0; $k ^= $king) {   // the owner's king, not defending the pawn
            $king = lowest($k);
            if ((steps($king) & ~$x) !== 0 || ($enemyBishops && rayMeets($king, $block | $pawn, $from))) {
                $held = false;                // it has a square to step to, or the capture uncovers a check
                break;
            }
        }
        if ($held) $guard |= $pawn;
    }
    return $guard;
}

/** Does a diagonal line from the square king, stopped by block, meet a square of o? */
function rayMeets(int $king, int $block, int $o): bool
{
    $sq = index($king);
    [$f0, $r0] = [$sq & 7, $sq >> 3];
    foreach ([[-1, -1], [1, -1], [-1, 1], [1, 1]] as [$df, $dr]) {
        for ($f = $f0 + $df, $r = $r0 + $dr; $f >= 0 && $f < 8 && $r >= 0 && $r < 8; $f += $df, $r += $dr) {
            $s = 1 << (8 * $r + $f);
            if (($o & $s) !== 0) return true;
            if (($block & $s) !== 0) break;
        }
    }
    return false;
}

/** The families of the open pairs at one level: 'lock' when none of them leaks to the king asked
    about, 'refuted' when family A (no pair's pawn has moved) does, 'none' otherwise. */
function families(Pieces $p, int $gaps, int $frozen, bool $white): string
{
    $pairs = [];   // per pair: the gap, the white pawn below it, the black pawn above it
    for ($g = $gaps; $g !== 0; $g ^= $gap) { $gap = lowest($g); $pairs[] = [$gap, south($gap), north($gap)]; }
    $k = \count($pairs);
    if ($k > MAX_PAIRS) return 'none';
    $sets = [];
    for ($f = 0; $f < 3 ** $k; $f++) {
        // Family f: digit i (base 3) says what pair i's pawns have done: 0 neither, 1 the white one
        // stepped into the gap, 2 the black one did. Its sets start from those of the family it is
        // reached from (the same with pair i's pawns in place), minus the gap.
        [$wp, $bp, $v] = [$p->whitePawns, $p->blackPawns, 0];
        $start = $f === 0 ? [$p->whiteKing, $p->blackKing, $p->whiteKing, $p->blackKing, $p->whiteBishops, $p->blackBishops]
                          : [0, 0, 0, 0, 0, 0];
        for ($i = 0, $q = $f; $i < $k; $i++, $q = intdiv($q, 3)) {
            $d = $q % 3;
            [$gap, $w, $b] = $pairs[$i];
            if ($d === 0) { $v |= $gap; continue; }           // the gap stays: a wall for both sides' pawns
            if ($d === 1) $wp = ($wp & ~$w) | $gap; else $bp = ($bp & ~$b) | $gap;
            $r = $sets[$f - $d * 3 ** $i];
            $start[0] |= $r->wKing & ~$gap;
            $start[1] |= $r->bKing & ~$gap;
            $start[2] |= $r->wTake;
            $start[3] |= $r->bTake;
            $start[4] |= $r->wBish & ~$gap;
            $start[5] |= $r->bBish & ~$gap;
        }
        $s = level($p, $frozen, wp: $wp, bp: $bp, v: $v, start: $start);
        if ($s === null) return $f === 0 ? 'refuted' : 'none';
        // The pairs that stay: both pawns must never move.
        for ($i = 0, $q = $f; $i < $k; $i++, $q = intdiv($q, 3)) {
            if ($q % 3 === 0 && (($pairs[$i][1] & ~$s->wFixed) | ($pairs[$i][2] & ~$s->bFixed)) !== 0) return 'none';
        }
        if (netLeaks($p, $s, $white, 0)) return $f === 0 ? 'refuted' : 'none';
        $sets[] = $s;
    }
    return 'lock';
}

/** With knights, rooks or queens on the board: every one of them must be boxed in by its own pawns
    and pieces (bishops and the king among them: the level checks that they never move); then the
    levels, with the boxed pieces as walls and no flight onto their squares. */
function boxedLock(Pieces $p, bool $white, int $wx, int $bx): bool
{
    $wOwn = $p->whitePawns | $wx | $p->whiteBishops | (kingWall($p, true) ? $p->whiteKing : 0);
    $bOwn = $p->blackPawns | $bx | $p->blackBishops | (kingWall($p, false) ? $p->blackKing : 0);
    $ws = boxSteps($p->whiteKnights, $p->whiteRooks | $p->whiteQueens, $p->whiteQueens, $wOwn);
    $bs = boxSteps($p->blackKnights, $p->blackRooks | $p->blackQueens, $p->blackQueens, $bOwn);
    if ($ws === null || $bs === null || $p->enPassant) return false;
    foreach (levels($p, $wx | $p->whiteBishops, $bx | $p->blackBishops) as $frozen) {
        $s = level($p, $frozen, wx: $wx, bx: $bx, ws: $ws, bs: $bs);
        if ($s !== null && !netLeaks($p, $s, $white, $wx | $bx)) return true;
    }
    return false;
}

/** The step squares of one side's knights, rooks (and queens: o) and queens, or null when one of
    them is not held by its own men (own). */
function boxSteps(int $knights, int $o, int $queens, int $own): ?int
{
    $s = sideways($o) | north($o) | south($o) | diagonal($queens) | knight($knights);
    return ($s & ~$own) === 0 ? $s : null;
}

/** The stuck mater: the flagged side is to move and, whatever it plays, the mater has no legal move
    left (kings and pawns only): the game ends at the mater's turn. */
function stuckMater(Pieces $p, bool $white): bool
{
    if ($p->whiteToMove !== $white || $p->enPassant) return false;
    if (($p->whiteBishops | $p->blackBishops | $p->whiteKnights | $p->blackKnights | $p->whiteRooks |
         $p->blackRooks | $p->whiteQueens | $p->blackQueens) !== 0) return false;
    [$fp, $mp] = $white ? [$p->whitePawns, $p->blackPawns] : [$p->blackPawns, $p->whitePawns];
    [$fk, $mk] = $white ? [$p->whiteKing, $p->blackKing] : [$p->blackKing, $p->whiteKing];
    $occ = $fp | $mp | $fk | $mk;
    $fwd = fn (int $s): int => $white ? north($s) : south($s);   // ahead, for the flagged side
    $back = fn (int $s): int => $white ? south($s) : north($s);  // behind
    // A mater's pawn with an empty square ahead is never stuck; then only a stalemate now is left to
    // find, which a flagged pawn's push rules out.
    if (($back($mp) & ~$occ) !== 0 && ($fwd($fp) & ~$occ) !== 0) return false;
    $fAttack = sideways($fwd($fp));
    $mAttack = sideways($back($mp));
    if (($fAttack & ($mp | $mk)) !== 0) return false;              // 1. the flagged side has no capture
    $single = $fwd($fp) & ~$occ;
    $double = $fwd($single & ($white ? RANK_3 : RANK_6)) & ~$occ;
    $pushes = $single | $double;
    $near = steps($mk);
    $kingTo = steps($fk) & ~$fp & ~$mAttack & ~$near;              // the flagged king's steps now
    $inCheck = ($fk & $mAttack) !== 0;
    if ($inCheck && $kingTo === 0) return false;                   // mated now
    $stays = $pushes !== 0 && !$inCheck;                           // a pawn may move instead of the king
    if ($kingTo === 0 && !$stays) return true;                     // no move, no check: stalemate now
    // The squares next to every square the flagged king may stand on after its move.
    $cover = $stays ? steps($fk) : ~0;
    for ($k = $kingTo; $k !== 0; $k ^= $one) { $one = lowest($k); $cover &= steps($one); }
    // 2. the mater's pawns are blocked by men that stay, and attack no flagged pawn
    $blockers = $fp | $mp | $mk | ($kingTo === 0 ? $fk : 0);
    if ((($back($mp) & ~$blockers) | ($mAttack & $fp)) !== 0) return false;
    // 3. every square next to the mater's king: its own pawn, attacked by a flagged pawn that cannot
    //    move now, or next to the flagged king wherever it goes
    $still = $fp & $back($fwd($fp) & $occ);
    if (($near & ~($mp | sideways($fwd($still)) | $cover)) !== 0) return false;
    // 4. no push lands where a mater's pawn attacks or next to its king, nor lets it take en passant
    return (($pushes & ($mAttack | $near)) | ($double & sideways($mp))) === 0;
}

/** The forced step: the side to move is in a pawn's check, with kings and pawns only, and its one
    legal move is a step of its king. The position after it, or null. */
function forcedStep(Pieces $p): ?Pieces
{
    if ($p->enPassant || ($p->whiteBishops | $p->blackBishops | $p->whiteKnights | $p->blackKnights |
                          $p->whiteRooks | $p->blackRooks | $p->whiteQueens | $p->blackQueens) !== 0) return null;
    $white = $p->whiteToMove;
    [$k, $ek] = $white ? [$p->whiteKing, $p->blackKing] : [$p->blackKing, $p->whiteKing];
    [$own, $enemy] = $white ? [$p->whitePawns, $p->blackPawns] : [$p->blackPawns, $p->whitePawns];
    $checkers = ($white ? sideways(north($k)) : sideways(south($k))) & $enemy;
    if ($checkers === 0) return null;
    $attacked = $white ? sideways(south($enemy)) : sideways(north($enemy));
    $to = steps($k) & ~$own & ~$attacked & ~steps($ek);
    if (count($to) !== 1) return null;
    if ((($white ? sideways(south($checkers)) : sideways(north($checkers))) & $own) !== 0) return null;  // a pawn may take instead
    $q = clone $p;
    $q->whiteToMove = !$white;
    $q->enPassant = false;
    if ($white) { $q->whiteKing = $to; $q->blackPawns = $p->blackPawns & ~$to; }
    else { $q->blackKing = $to; $q->whitePawns = $p->whitePawns & ~$to; }
    return $q;
}

// ─── The stalemated flagged side ────────────────────────────────────────────────────────────
// Men as an array of 12 sets: White's pawns, knights, bishops, rooks, queens and king, then Black's.
// A move: [from, to, kind, kind after it, a pawn taken en passant, the square a double step passes].
const PAWN = 0, KNIGHT = 1, BISHOP = 2, ROOK = 3, QUEEN = 4, KING = 5;
const DIAGONALS = [[1, 1], [-1, 1], [1, -1], [-1, -1]];
const LINES = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** The squares from the square s in the direction (df, dr), up to the first man (included). */
function ray(int $s, int $df, int $dr, int $occ): int
{
    $sq = squareOf($s);
    $f = $sq % 8 + $df;
    $r = intdiv($sq, 8) + $dr;
    $out = 0;
    while ($f >= 0 && $f < 8 && $r >= 0 && $r < 8) {
        $t = 1 << (8 * $r + $f);
        $out |= $t;
        if (($occ & $t) !== 0) break;
        $f += $df;
        $r += $dr;
    }
    return $out;
}

/** Every man of side (0 White, 1 Black). */
function men(array $m, int $side): int
{
    $b = 6 * $side;
    return $m[$b] | $m[$b + 1] | $m[$b + 2] | $m[$b + 3] | $m[$b + 4] | $m[$b + 5];
}

function forward(int $side, int $s): int { return $side === 0 ? north($s) : south($s); }

/** Every square the men of side attack, the board occupied as occ. */
function attacks(array $m, int $side, int $occ): int
{
    $b = 6 * $side;
    $a = sideways(forward($side, $m[$b])) | knight($m[$b + KNIGHT]) | steps($m[$b + KING]);
    foreach (squares($m[$b + BISHOP] | $m[$b + QUEEN]) as $s) foreach (DIAGONALS as [$df, $dr]) $a |= ray($s, $df, $dr, $occ);
    foreach (squares($m[$b + ROOK] | $m[$b + QUEEN]) as $s) foreach (LINES as [$df, $dr]) $a |= ray($s, $df, $dr, $occ);
    return $a;
}

/** The legal moves of side, to move, which has a king, pawns and bishops only; a promotion is four
    moves. ep: the square behind the other side's double step (0: none). */
function legalMoves(array $m, int $side, int $ep): array
{
    $b = 6 * $side;
    $o = 6 * (1 - $side);
    $own = men($m, $side);
    $occ = men($m, 0) | men($m, 1);
    $k = $m[$b + KING];
    $them = men($m, 1 - $side) & ~$m[$o + KING];
    $moves = [];
    foreach (squares(steps($k) & ~$own & ~attacks($m, 1 - $side, $occ & ~$k)) as $t) $moves[] = [$k, $t, KING, KING, 0, 0];
    // checks on the king, and the men pinned to it (each may move along its line only)
    $checkers = (sideways(forward($side, $k)) & $m[$o + PAWN]) | (knight($k) & $m[$o + KNIGHT]);
    $block = -1;
    $pins = [];
    foreach ([[DIAGONALS, $m[$o + BISHOP] | $m[$o + QUEEN]], [LINES, $m[$o + ROOK] | $m[$o + QUEEN]]] as [$dirs, $sliders]) {
        foreach ($dirs as [$df, $dr]) {
            $r = ray($k, $df, $dr, $occ);
            $first = $r & $occ;
            if (($first & $sliders) !== 0) { $checkers |= $first; $block = $r; }
            elseif (($first & $own) !== 0) {
                $beyond = ray($first, $df, $dr, $occ);
                if (($beyond & $occ & $sliders) !== 0) $pins[$first] = $r | $beyond;
            }
        }
    }
    if (count($checkers) >= 2) return $moves;
    $evade = $checkers !== 0 ? ($block !== -1 ? $block : $checkers) : -1;
    foreach (squares($m[$b + BISHOP]) as $s) {
        $to = 0;
        foreach (DIAGONALS as [$df, $dr]) $to |= ray($s, $df, $dr, $occ);
        foreach (squares($to & ~$own & ~$m[$o + KING] & $evade & ($pins[$s] ?? -1)) as $t) $moves[] = [$s, $t, BISHOP, BISHOP, 0, 0];
    }
    foreach (squares($m[$b + PAWN]) as $s) {
        $line = $pins[$s] ?? -1;
        $one = forward($side, $s) & ~$occ;
        $two = forward($side, $one & ($side === 0 ? RANK_3 : RANK_6)) & ~$occ;
        $hit = sideways(forward($side, $s));
        foreach (squares(($one | ($hit & $them)) & $evade & $line) as $t) {
            foreach (($t & (RANK_1 | RANK_8)) !== 0 ? [QUEEN, ROOK, BISHOP, KNIGHT] : [PAWN] as $now) $moves[] = [$s, $t, PAWN, $now, 0, 0];
        }
        foreach (squares($two & $evade & $line) as $t) $moves[] = [$s, $t, PAWN, PAWN, 0, $one];
        $e = $hit & $ep & $line;
        if ($e !== 0) {
            $victim = $side === 0 ? south($e) : north($e);
            if ($checkers === 0 || ($checkers & $victim) !== 0 || ($e & $evade) !== 0) $moves[] = [$s, $e, PAWN, PAWN, $victim, 0];
        }
    }
    return $moves;
}

/** The men after side plays move. */
function play(array $m, int $side, array $move): array
{
    [$s, $t, $kind, $now, $victim] = $move;
    $o = 6 * (1 - $side);
    for ($i = $o; $i < $o + 6; $i++) $m[$i] &= ~($t | $victim);
    $m[6 * $side + $kind] &= ~$s;
    $m[6 * $side + $now] |= $t;
    return $m;
}

/** Has side, to move, no legal move, its king in no check? */
function stalemated(array $m, int $side, int $ep): bool
{
    return (attacks($m, 1 - $side, men($m, 0) | men($m, 1)) & $m[6 * $side + KING]) === 0 && legalMoves($m, $side, $ep) === [];
}

/** Does every move of moves (side's) leave the other side stalemated? */
function everyMoveStalemates(array $m, int $side, array $moves): bool
{
    foreach ($moves as $mv) if (!stalemated(play($m, $side, $mv), 1 - $side, $mv[5])) return false;
    return true;
}

/** The stalemated flagged side: a king and pawns that, whatever the mater (a king, pawns and
    bishops) plays, is left without a legal move and out of check, a stalemate. With the mater to
    move: it has a legal move, and each one does that. With the flagged side to move: it has
    exactly one legal move (a promotion is four), after which every move of the mater's, if it has
    any, does that (with none, that one move ended the game). Not with an en passant right. */
function stalematedFlagged(Pieces $p, bool $white): bool
{
    $m = [$p->whitePawns, $p->whiteKnights, $p->whiteBishops, $p->whiteRooks, $p->whiteQueens, $p->whiteKing,
          $p->blackPawns, $p->blackKnights, $p->blackBishops, $p->blackRooks, $p->blackQueens, $p->blackKing];
    $f = $white ? 0 : 1;
    $b = 6 * $f;
    $o = 6 * (1 - $f);
    if ($p->enPassant || ($m[$b + KNIGHT] | $m[$b + BISHOP] | $m[$b + ROOK] | $m[$b + QUEEN]) !== 0
        || ($m[$o + KNIGHT] | $m[$o + ROOK] | $m[$o + QUEEN]) !== 0) return false;
    if ($p->whiteToMove !== $white) {
        $moves = legalMoves($m, 1 - $f, 0);
        return $moves !== [] && everyMoveStalemates($m, 1 - $f, $moves);
    }
    $only = legalMoves($m, $f, 0);
    if (\count($only) !== 1) return false;
    $q = play($m, $f, $only[0]);
    return everyMoveStalemates($q, 1 - $f, legalMoves($q, 1 - $f, $only[0][5]));
}
