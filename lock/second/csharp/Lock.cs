// Mateless's lock detector, second version, in its simplest form.
//
// Can a side never be mated? The lock detector answers yes when pawns, kings and bishops (and
// knights, rooks or queens boxed in by their own men) form a structure that no series of legal
// moves can open (FIDE 5.2.2 dead position, 6.9 flag fall). It reads bitboards and the side to
// move: it generates no move and searches nothing.
//
// The first version (../../csharp/Lock.cs) grows each king's reach, the pawns that can never move,
// and the squares where each side may take a pawn, until nothing changes; the structure leaks if a
// pawn can promote or capture, a frozen king can move, a bishop can reach a pawn's path, or the
// king asked about can reach a square the other side attacks without a sure flight. This version
// keeps all of it and adds, each only where its situation is on the board:
//   - open pawn pairs: a white and a black pawn on one file with one empty square between them;
//     the reachable positions split into families by what the pair's pawns have done (neither
//     moved, the white one stepped into the gap, the black one did), up to 3 pairs;
//   - boxed knights, rooks and queens: a piece whose every step square holds one of its own men
//     that never moves, and that no enemy king or bishop reaches, never moves nor falls;
//   - twin bishops: two bishops of one side on one colour no longer fail it; the mating net leaves
//     out its second flight rule where they may hold both flights;
//   - the stalemate guard: a pawn the enemy king may take stays a wall if taking it always
//     stalemates its owner;
//   - the check seed: a king in a pawn's check starts its reach from the squares it can step to;
//   - the stuck mater: whatever the flagged side plays, the mater is left without a move;
//   - the forced step: a king in a pawn's check with one legal move, a step: the lock of the
//     position after it.
// A possible en passant capture fails it at once. Sound, not complete: a structure it passes can
// never be opened; one it fails may still be dead.
//
// Squares: a1 = 0, b1 = 1, ..., h8 = 63. A set of squares (a bitboard) is a ulong.

using System.Collections.Generic;
using System.Numerics;

namespace Mateless.Second;

/// <summary>What the lock detector reads from a position.</summary>
public readonly record struct Pieces(
    ulong WhitePawns, ulong BlackPawns,
    ulong WhiteKing, ulong BlackKing,
    ulong WhiteBishops, ulong BlackBishops,
    ulong WhiteKnights, ulong BlackKnights,
    ulong WhiteRooks, ulong BlackRooks,
    ulong WhiteQueens, ulong BlackQueens,
    bool WhiteToMove,
    bool EnPassant);   // the side to move can capture en passant

public static class Lock
{
    const ulong FileA = 0x0101010101010101UL;
    const ulong FileH = 0x8080808080808080UL;
    const ulong Rank1 = 0x00000000000000FFUL;
    const ulong Rank3 = 0x0000000000FF0000UL;
    const ulong Rank6 = 0x0000FF0000000000UL;
    const ulong Rank8 = 0xFF00000000000000UL;
    const ulong Dark = 0xAA55AA55AA55AA55UL;   // the dark squares; a1 is dark
    const int MaxPairs = 3;                    // the most open pairs the families are split on (3^3 = 27)

    static ulong North(ulong s) => s << 8;
    static ulong South(ulong s) => s >> 8;
    static ulong Sideways(ulong s) => ((s << 1) & ~FileA) | ((s >> 1) & ~FileH);
    static ulong Zone(ulong s) { ulong v = s | North(s) | South(s); return v | Sideways(v); }  // s and every square next to it
    static ulong Steps(ulong s) => Zone(s) & ~s;                                                // the squares next to s
    static ulong Diagonal(ulong s) => Sideways(North(s) | South(s));                            // the squares diagonally next to s
    static int Count(ulong s) => BitOperations.PopCount(s);
    static ulong Lowest(ulong s) => s & (~s + 1);                                               // the lowest square of s

    // The squares a knight on s goes to.
    static ulong Knight(ulong s)
    {
        ulong one = Sideways(s);
        ulong two = ((s << 2) & ~(FileA | (FileA << 1))) | ((s >> 2) & ~(FileH | (FileH >> 1)));
        return North(North(one)) | South(South(one)) | North(two) | South(two);
    }

    // Every square reachable from g by steps north through squares of p.
    static ulong FillNorth(ulong g, ulong p)
    {
        g |= p & (g << 8);
        p &= p << 8;
        g |= p & (g << 16);
        p &= p << 16;
        return g | (p & (g << 32));
    }

    // Every square reachable from g by steps south through squares of p.
    static ulong FillSouth(ulong g, ulong p)
    {
        g |= p & (g >> 8);
        p &= p >> 8;
        g |= p & (g >> 16);
        p &= p >> 16;
        return g | (p & (g >> 32));
    }

    // Every square a king may reach from k through squares of m.
    static ulong Flood(ulong k, ulong m)
    {
        for (;;) { ulong a = k | (Zone(k) & m); if (a == k) return k; k = a; }
    }

    // What one level leaves for the mating net (and for the families after it).
    readonly record struct Sets(ulong WCone, ulong BCone, ulong WFixed, ulong BFixed, ulong WKing, ulong BKing,
                                ulong WBish, ulong BBish, ulong WTake, ulong BTake);

    // The inputs of a level beyond the position: see Level.
    sealed record LevelIn(ulong[]? Pawns = null, ulong V = 0, ulong[]? Start = null,
                          ulong Wx = 0, ulong Bx = 0, ulong Ws = 0, ulong Bs = 0, bool Guard = false);

    // What the families of the open pairs say at one level.
    enum Family { Lock, Refuted, None }

    /// <summary>The pieces of a FEN. The en passant square counts only if a pawn can capture onto it.</summary>
    public static Pieces FromFen(string fen)
    {
        string[] fields = fen.Split(' ');
        ulong[] sets = new ulong[128];
        int rank = 7, file = 0;
        foreach (char c in fields[0])
        {
            if (c == '/') { rank--; file = 0; continue; }
            if (c >= '1' && c <= '8') { file += c - '0'; continue; }
            sets[c] |= 1UL << (8 * rank + file++);
        }
        bool whiteToMove = fields.Length < 2 || fields[1] == "w";
        bool enPassant = false;
        if (fields.Length > 3 && fields[3] != "-")   // past the side to move and castling
        {
            ulong target = 1UL << ((fields[3][0] - 'a') + 8 * (fields[3][1] - '1'));
            enPassant = whiteToMove ? (Sideways(South(target)) & sets['P']) != 0 : (Sideways(North(target)) & sets['p']) != 0;
        }
        return new Pieces(sets['P'], sets['p'], sets['K'], sets['k'], sets['B'], sets['b'], sets['N'], sets['n'],
                          sets['R'], sets['r'], sets['Q'], sets['q'], whiteToMove, enPassant);
    }

    /// <summary>Can White (white = true) or Black never be mated, by the lock detector?</summary>
    public static bool CannotBeMated(Pieces p, bool white)
    {
        if (ForcedStep(p) is Pieces after) return CannotBeMated(after, white);
        ulong wx = p.WhiteKnights | p.WhiteRooks | p.WhiteQueens, bx = p.BlackKnights | p.BlackRooks | p.BlackQueens;
        if ((wx | bx) != 0) return BoxedLock(p, white, wx, bx);
        if (p.EnPassant) return false;
        ulong gaps = North(p.WhitePawns) & South(p.BlackPawns) & ~(p.WhitePawns | p.BlackPawns);
        foreach (ulong frozen in Levels(p))
        {
            if (gaps != 0)
            {
                Family f = Families(p, gaps, frozen, white);
                if (f == Family.Lock) return true;
                if (f == Family.Refuted) continue;   // family A, the level with more walls, leaked: the level leaks too
            }
            if (Level(p, frozen, new LevelIn(Guard: true)) is Sets s && !NetLeaks(p, s, white, 0)) return true;
        }
        return StuckMater(p, white);
    }

    // The levels: both kings free (0), then each king frozen on its square (a wall for both sides)
    // when every square around it is held or attacked by a pawn.
    static List<ulong> Levels(Pieces p)
    {
        ulong held = p.WhitePawns | p.BlackPawns | Sideways(North(p.WhitePawns) | South(p.BlackPawns));
        var output = new List<ulong> { 0 };
        foreach (ulong king in new[] { p.WhiteKing, p.BlackKing })
            if ((Steps(king) & ~held) == 0) output.Add(king);
        return output;
    }

    // One level: the fixed point of the walls, the pawns that can never move, the kings' reaches, the
    // squares where each side may take a pawn, the pawns' cones and the bishops' reaches. The sets
    // the mating net reads, or null when the structure leaks whichever side is asked about.
    // o.Pawns: the pawns (a family has a pair's pawn moved into its gap); o.V: walls for both sides
    // (the gaps of a family's pairs that stay); o.Start: where the kings' reaches, capture squares
    // and bishops' reaches start (a family's); o.Wx, Bx, Ws, Bs: the boxed pieces' candidates and
    // their step squares; o.Guard: the stalemate guard and the check seed (plain levels only).
    static Sets? Level(Pieces p, ulong frozen, LevelIn o)
    {
        ulong wp = o.Pawns?[0] ?? p.WhitePawns, bp = o.Pawns?[1] ?? p.BlackPawns;
        ulong wk = p.WhiteKing, bk = p.BlackKing, wx = o.Wx, bx = o.Bx, v = o.V | frozen;
        bool frozenWhite = (frozen & wk) != 0;
        bool frozenBlack = !frozenWhite && frozen != 0;
        ulong nearFrozenBlack = frozenBlack ? Zone(bk) : 0, nearFrozenWhite = frozenWhite ? Zone(wk) : 0;
        (ulong wSeed, ulong bSeed) = o.Guard && frozen == 0 ? CheckSeed(p) : (wk, bk);
        ulong[] start = o.Start ?? new[] { wSeed, bSeed, wSeed, bSeed, p.WhiteBishops, p.BlackBishops };
        ulong wKing = start[0], bKing = start[1], wTake = start[2], bTake = start[3], wBish = start[4], bBish = start[5];
        ulong wCone = wp, bCone = bp, wFixed = wp, bFixed = bp;
        ulong wGuard = o.Guard ? ~0UL : 0, bGuard = o.Guard ? ~0UL : 0;   // nothing is taken yet
        for (;;)
        {
            // Boxed: the pieces no enemy king or bishop reaches. Walls: pawns the other side can never
            // take (or whose capture stalemates their owner), the frozen king, the gaps, boxed pieces.
            ulong boxedNow = (wx & ~(bKing | bBish)) | (bx & ~(wKing | wBish));
            ulong wWall = (wp & ~(bTake & ~wGuard)) | v | boxedNow;
            ulong bWall = (bp & ~(wTake & ~bGuard)) | v | boxedNow;
            ulong nwFixed = wFixed & wWall & South(bWall | wFixed);
            ulong nbFixed = bFixed & bWall & North(wWall | bFixed);
            ulong nwCone = FillNorth(wCone, ~bWall), nbCone = FillSouth(bCone, ~wWall);
            // The kings: never onto a fixed pawn, a square it attacks, or next to the frozen king.
            ulong bHit = Sideways(South(nbFixed)), wHit = Sideways(North(nwFixed));
            ulong nwKing = Flood(wKing, ~(nwFixed | bHit | nearFrozenBlack));
            ulong nbKing = Flood(bKing, ~(nbFixed | wHit | nearFrozenWhite));
            ulong nwBish = wBish, nbBish = bBish, open = ~(nwFixed | nbFixed);
            for (;;)
            {
                ulong a = nwBish | (Diagonal(nwBish) & open), d = nbBish | (Diagonal(nbBish) & open);
                if (a == nwBish && d == nbBish) break;
                nwBish = a;
                nbBish = d;
            }
            // A side may take a pawn where its king goes, and on any square a pawn may walk into.
            ulong t = bTake | nbKing;
            ulong nbTake = t | South(FillSouth(t & ~bWall, ~bWall));
            t = wTake | nwKing;
            ulong nwTake = t | North(FillNorth(t & ~wWall, ~wWall));
            ulong nwGuard = wGuard, nbGuard = bGuard;
            if (o.Guard)
            {
                ulong block = nwFixed | nbFixed;
                bool wHasB = p.WhiteBishops != 0, bHasB = p.BlackBishops != 0;
                nwGuard = wHasB ? 0 : StalemateGuard(wp & nbTake & nwFixed, wp, nwFixed, nwKing, nwFixed | bHit, nbKing, bHasB, block);
                nbGuard = bHasB ? 0 : StalemateGuard(bp & nwTake & nbFixed, bp, nbFixed, nbKing, nbFixed | wHit, nwKing, wHasB, block);
            }
            bool changed = nwCone != wCone || nbCone != bCone || nwFixed != wFixed || nbFixed != bFixed ||
                           nwKing != wKing || nbKing != bKing || nwBish != wBish || nbBish != bBish ||
                           nwTake != wTake || nbTake != bTake || nwGuard != wGuard || nbGuard != bGuard;
            wCone = nwCone; bCone = nbCone; wFixed = nwFixed; bFixed = nbFixed; wKing = nwKing; bKing = nbKing;
            wBish = nwBish; bBish = nbBish; wTake = nwTake; bTake = nbTake; wGuard = nwGuard; bGuard = nbGuard;
            if (!changed) break;
        }
        ulong boxed = (wx & ~(bKing | bBish)) | (bx & ~(wKing | wBish));
        if (((wCone & Rank8) | (bCone & Rank1)) != 0) return null;                                // a pawn can promote
        if (((North(Sideways(wCone)) & (bCone | bx)) | (South(Sideways(bCone)) & wx)) != 0) return null;  // a pawn can capture
        if ((frozenWhite && wKing != wk) || (frozenBlack && bKing != bk)) return null;           // the frozen king can move
        if (((Diagonal(wBish) & bCone) | (Diagonal(bBish) & wCone)) != 0) return null;            // a bishop meets a pawn's path
        if (((o.Ws & ~(wFixed | (wx & boxed))) | (o.Bs & ~(bFixed | (bx & boxed)))) != 0) return null;  // a piece may step
        if ((wGuard | bGuard) != 0)
        {
            // A king that takes a guarded pawn ends the game: for the mating net, the kings' reaches
            // again, now stopping at the enemy's guarded pawns.
            wKing = Flood(wSeed, ~(wFixed | Sideways(South(bFixed)) | nearFrozenBlack | (bp & bGuard)));
            bKing = Flood(bSeed, ~(bFixed | Sideways(North(wFixed)) | nearFrozenWhite | (wp & wGuard)));
        }
        return new Sets(wCone, bCone, wFixed, bFixed, wKing, bKing, wBish, bBish, wTake, bTake);
    }

    // The mating net: can the other side's pawns and bishops catch the king asked about? occ:
    // squares that stand occupied for good besides (the boxed pieces').
    static bool NetLeaks(Pieces p, Sets s, bool white, ulong occ)
    {
        ulong attack, reach, free, spare, twins;
        if (white)
        {
            attack = Diagonal(s.BBish) | Sideways(South(s.BCone));
            reach = s.WKing;
            free = ~(s.WCone | occ | Zone(s.BKing) | attack);   // never occupied, attacked or next to the mater
            spare = free & ~s.WBish;                            // ... nor reached by the king's own bishops
            twins = p.WhiteBishops;
        }
        else
        {
            attack = Diagonal(s.WBish) | Sideways(North(s.WCone));
            reach = s.BKing;
            free = ~(s.BCone | occ | Zone(s.WKing) | attack);
            spare = free & ~s.BBish;
            twins = p.BlackBishops;
        }
        // A king next to a spare square, or with free squares beside it both ways, always has a
        // flight. The second rule counts on at most one of the king's own bishops on the colour of
        // those two squares (the colour opposite the king's): not on the king squares where it has
        // two or more.
        ulong noPair = (Count(twins & Dark) > 1 ? ~Dark : 0) | (Count(twins & ~Dark) > 1 ? Dark : 0);
        ulong flight = Sideways(spare) | North(spare) | South(spare) |
                       ((North(free) | South(free)) & Sideways(free) & ~noPair);
        return (attack & reach & ~flight) != 0;
    }

    // The check seed: the side to move is in a pawn's check, so its king must step now, to a square
    // it can step to (not its own pawn, not a square an enemy pawn attacks, not next to the enemy
    // king); its reach starts there. Not when it has no such square (that may be a mate now), when
    // one of its pawns can take a checking pawn, or with a bishop on the board. The kings' starting
    // sets.
    static (ulong, ulong) CheckSeed(Pieces p)
    {
        ulong wp = p.WhitePawns, bp = p.BlackPawns, wk = p.WhiteKing, bk = p.BlackKing;
        bool white = p.WhiteToMove;
        if ((p.WhiteBishops | p.BlackBishops) != 0) return (wk, bk);
        ulong k = white ? wk : bk, own = white ? wp : bp;
        ulong checkers = white ? Sideways(North(k)) & bp : Sideways(South(k)) & wp;
        if (checkers == 0) return (wk, bk);
        ulong attacked = white ? Sideways(South(bp)) : Sideways(North(wp));
        ulong to = Steps(k) & ~own & ~attacked & ~Steps(white ? bk : wk);
        ulong takers = (white ? Sideways(South(checkers)) : Sideways(North(checkers))) & own;
        if (to == 0 || takers != 0) return (wk, bk);
        return white ? (to, bk) : (wk, to);
    }

    // The stalemate guard: of the owner's fixed pawns cand (which the enemy king may take), those
    // whose capture always stalemates the owner. The owner must have nothing else that moves (every
    // other pawn fixed; no bishop, which the caller sees to). reach: where the owner's king may stand;
    // shut: squares it can never step to (own fixed pawns, squares the enemy's fixed pawns attack);
    // enemyKing: the enemy king's reach; block: squares a bishop's line never crosses.
    static ulong StalemateGuard(ulong cand, ulong own, ulong ownFixed, ulong reach, ulong shut, ulong enemyKing,
                                bool enemyBishops, ulong block)
    {
        if ((own & ~ownFixed) != 0) return 0;
        ulong guard = 0;
        for (ulong c = cand; c != 0; c &= c - 1)
        {
            ulong pawn = Lowest(c), near = Steps(pawn);
            ulong from = near & enemyKing;              // where the enemy king takes from
            ulong x = shut | near | pawn;               // after the capture, the owner's king may not step there
            bool held = true;
            for (ulong k = reach & ~(near | pawn); k != 0; k &= k - 1)   // the owner's king, not defending the pawn
            {
                ulong king = Lowest(k);
                if ((Steps(king) & ~x) != 0 || (enemyBishops && RayMeets(king, block | pawn, from)))
                {
                    held = false;                       // it has a square to step to, or the capture uncovers a check
                    break;
                }
            }
            if (held) guard |= pawn;
        }
        return guard;
    }

    // Does a diagonal line from the square king, stopped by block, meet a square of o?
    static bool RayMeets(ulong king, ulong block, ulong o)
    {
        int sq = BitOperations.TrailingZeroCount(king);
        foreach ((int df, int dr) in new[] { (-1, -1), (1, -1), (-1, 1), (1, 1) })
        {
            for (int f = (sq & 7) + df, r = (sq >> 3) + dr; f >= 0 && f < 8 && r >= 0 && r < 8; f += df, r += dr)
            {
                ulong s = 1UL << (8 * r + f);
                if ((o & s) != 0) return true;
                if ((block & s) != 0) break;
            }
        }
        return false;
    }

    // The families of the open pairs at one level.
    static Family Families(Pieces p, ulong gaps, ulong frozen, bool white)
    {
        var pairs = new List<ulong[]>();   // per pair: the gap, the white pawn below it, the black pawn above it
        for (ulong g = gaps; g != 0; g &= g - 1) { ulong gap = Lowest(g); pairs.Add(new[] { gap, South(gap), North(gap) }); }
        if (pairs.Count > MaxPairs) return Family.None;
        int k = pairs.Count, n = 1;
        for (int i = 0; i < k; i++) n *= 3;
        var sets = new List<Sets>();
        for (int f = 0; f < n; f++)
        {
            // Family f: digit i (base 3) says what pair i's pawns have done: 0 neither, 1 the white
            // one stepped into the gap, 2 the black one did. Its sets start from those of the family
            // it is reached from (the same with pair i's pawns in place), minus the gap.
            ulong wp = p.WhitePawns, bp = p.BlackPawns, v = 0;
            ulong[] start = f == 0
                ? new[] { p.WhiteKing, p.BlackKing, p.WhiteKing, p.BlackKing, p.WhiteBishops, p.BlackBishops }
                : new ulong[6];
            for (int i = 0, q = f, pow = 1; i < k; i++, q /= 3, pow *= 3)
            {
                int d = q % 3;
                ulong gap = pairs[i][0];
                if (d == 0) { v |= gap; continue; }   // the gap stays: a wall for both sides' pawns
                if (d == 1) wp = (wp & ~pairs[i][1]) | gap; else bp = (bp & ~pairs[i][2]) | gap;
                Sets r = sets[f - d * pow];
                start[0] |= r.WKing & ~gap;
                start[1] |= r.BKing & ~gap;
                start[2] |= r.WTake;
                start[3] |= r.BTake;
                start[4] |= r.WBish & ~gap;
                start[5] |= r.BBish & ~gap;
            }
            if (Level(p, frozen, new LevelIn(Pawns: new[] { wp, bp }, V: v, Start: start)) is not Sets s)
                return f == 0 ? Family.Refuted : Family.None;
            // The pairs that stay: both pawns must never move.
            for (int i = 0, q = f; i < k; i++, q /= 3)
                if (q % 3 == 0 && ((pairs[i][1] & ~s.WFixed) | (pairs[i][2] & ~s.BFixed)) != 0) return Family.None;
            if (NetLeaks(p, s, white, 0)) return f == 0 ? Family.Refuted : Family.None;
            sets.Add(s);
        }
        return Family.Lock;
    }

    // The step squares of one side's knights, rooks (and queens: o) and queens.
    static ulong BoxSteps(ulong knights, ulong o, ulong queens) =>
        Sideways(o) | North(o) | South(o) | Diagonal(queens) | Knight(knights);

    // With knights, rooks or queens on the board: every one of them must be boxed in by its own
    // pawns and pieces; then the levels, with the boxed pieces as walls and no flight onto their
    // squares.
    static bool BoxedLock(Pieces p, bool white, ulong wx, ulong bx)
    {
        ulong ws = BoxSteps(p.WhiteKnights, p.WhiteRooks | p.WhiteQueens, p.WhiteQueens);
        ulong bs = BoxSteps(p.BlackKnights, p.BlackRooks | p.BlackQueens, p.BlackQueens);
        if ((ws & ~(p.WhitePawns | wx)) != 0 || (bs & ~(p.BlackPawns | bx)) != 0 || p.EnPassant) return false;
        foreach (ulong frozen in Levels(p))
            if (Level(p, frozen, new LevelIn(Wx: wx, Bx: bx, Ws: ws, Bs: bs)) is Sets s && !NetLeaks(p, s, white, wx | bx)) return true;
        return false;
    }

    // The stuck mater: the flagged side is to move and, whatever it plays, the mater has no legal
    // move left (kings and pawns only): the game ends at the mater's turn.
    static bool StuckMater(Pieces p, bool white)
    {
        if (p.WhiteToMove != white || p.EnPassant) return false;
        if ((p.WhiteBishops | p.BlackBishops | p.WhiteKnights | p.BlackKnights | p.WhiteRooks |
             p.BlackRooks | p.WhiteQueens | p.BlackQueens) != 0) return false;
        ulong fp = white ? p.WhitePawns : p.BlackPawns, mp = white ? p.BlackPawns : p.WhitePawns;
        ulong fk = white ? p.WhiteKing : p.BlackKing, mk = white ? p.BlackKing : p.WhiteKing;
        ulong occ = fp | mp | fk | mk;
        ulong Fwd(ulong s) => white ? North(s) : South(s);    // ahead, for the flagged side
        ulong Back(ulong s) => white ? South(s) : North(s);   // behind
        // A mater's pawn with an empty square ahead is never stuck; then only a stalemate now is
        // left to find, which a flagged pawn's push rules out.
        if ((Back(mp) & ~occ) != 0 && (Fwd(fp) & ~occ) != 0) return false;
        ulong fAttack = Sideways(Fwd(fp)), mAttack = Sideways(Back(mp));
        if ((fAttack & (mp | mk)) != 0) return false;                     // 1. the flagged side has no capture
        ulong single = Fwd(fp) & ~occ;
        ulong dbl = Fwd(single & (white ? Rank3 : Rank6)) & ~occ;
        ulong pushes = single | dbl;
        ulong near = Steps(mk);
        ulong kingTo = Steps(fk) & ~fp & ~mAttack & ~near;                 // the flagged king's steps now
        bool inCheck = (fk & mAttack) != 0;
        if (inCheck && kingTo == 0) return false;                         // mated now
        bool stays = pushes != 0 && !inCheck;                             // a pawn may move instead of the king
        if (kingTo == 0 && !stays) return true;                           // no move, no check: stalemate now
        // The squares next to every square the flagged king may stand on after its move.
        ulong cover = stays ? Steps(fk) : ~0UL;
        for (ulong k = kingTo; k != 0; k &= k - 1) cover &= Steps(Lowest(k));
        // 2. the mater's pawns are blocked by men that stay, and attack no flagged pawn
        ulong blockers = fp | mp | mk | (kingTo == 0 ? fk : 0);
        if (((Back(mp) & ~blockers) | (mAttack & fp)) != 0) return false;
        // 3. every square next to the mater's king: its own pawn, attacked by a flagged pawn that
        //    cannot move now, or next to the flagged king wherever it goes
        ulong still = fp & Back(Fwd(fp) & occ);
        if ((near & ~(mp | Sideways(Fwd(still)) | cover)) != 0) return false;
        // 4. no push lands where a mater's pawn attacks or next to its king, nor lets it take en passant
        return ((pushes & (mAttack | near)) | (dbl & Sideways(mp))) == 0;
    }

    // The forced step: the side to move is in a pawn's check, with kings and pawns only, and its
    // one legal move is a step of its king. The position after it, or null.
    static Pieces? ForcedStep(Pieces p)
    {
        if (p.EnPassant || (p.WhiteBishops | p.BlackBishops | p.WhiteKnights | p.BlackKnights |
                            p.WhiteRooks | p.BlackRooks | p.WhiteQueens | p.BlackQueens) != 0) return null;
        bool white = p.WhiteToMove;
        ulong k = white ? p.WhiteKing : p.BlackKing, ek = white ? p.BlackKing : p.WhiteKing;
        ulong own = white ? p.WhitePawns : p.BlackPawns, enemy = white ? p.BlackPawns : p.WhitePawns;
        ulong checkers = (white ? Sideways(North(k)) : Sideways(South(k))) & enemy;
        if (checkers == 0) return null;
        ulong attacked = white ? Sideways(South(enemy)) : Sideways(North(enemy));
        ulong to = Steps(k) & ~own & ~attacked & ~Steps(ek);
        if (Count(to) != 1) return null;
        if (((white ? Sideways(South(checkers)) : Sideways(North(checkers))) & own) != 0) return null;  // a pawn may take instead
        return white ? p with { WhiteKing = to, BlackPawns = p.BlackPawns & ~to, WhiteToMove = false, EnPassant = false }
                     : p with { BlackKing = to, WhitePawns = p.WhitePawns & ~to, WhiteToMove = true, EnPassant = false };
    }
}
