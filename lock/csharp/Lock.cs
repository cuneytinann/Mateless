// Mateless's lock detector, in its simplest form.
//
// Can a side never be mated? The lock detector answers yes when pawns, kings and bishops form a
// structure that no series of legal moves can open (FIDE 5.2.2 dead position, 6.9 flag fall). It
// reads bitboards only: it generates no move and searches nothing.
//
// Each king's reach (every square it may ever stand on) is grown from its square, never onto a
// square that a pawn which can never move attacks. The pawns that can never move are those
// blocked by a wall: a pawn the other side can never take. The squares where a side may take a
// pawn grow from its king's reach, and so on, until nothing changes. The structure leaks if a
// pawn can promote or capture, a frozen king can move, a bishop can reach a pawn's path, or the
// king of the side asked about can reach a square the other side attacks where it has no sure
// flight. It is tried with both kings free, then with each king frozen on its square (a wall for
// both sides) when every square around that king is held or attacked by a pawn.
//
// A knight, rook or queen on the board, two bishops of one side on squares of one colour, or a
// possible en passant capture fails it at once. Sound, not complete: a structure it passes can
// never be opened; one it fails may still be dead.
//
// Squares: a1 = 0, b1 = 1, ..., h8 = 63. A set of squares (a bitboard) is a ulong.

using System.Numerics;

namespace Mateless;

/// <summary>What the lock detector reads from a position.</summary>
public readonly record struct Pieces(
    ulong WhitePawns, ulong BlackPawns,
    ulong WhiteKing, ulong BlackKing,
    ulong WhiteBishops, ulong BlackBishops,
    ulong Others,      // knights, rooks and queens of both sides
    bool EnPassant);   // the side to move can capture en passant

public static class Lock
{
    const ulong FileA = 0x0101010101010101UL;
    const ulong FileH = 0x8080808080808080UL;
    const ulong Rank1 = 0x00000000000000FFUL;
    const ulong Rank8 = 0xFF00000000000000UL;
    const ulong Dark = 0xAA55AA55AA55AA55UL;   // the dark squares; a1 is dark

    static ulong North(ulong s) => s << 8;
    static ulong South(ulong s) => s >> 8;
    static ulong Sideways(ulong s) => ((s << 1) & ~FileA) | ((s >> 1) & ~FileH);
    static ulong Zone(ulong s) { ulong v = s | North(s) | South(s); return v | Sideways(v); }  // s and every square next to it
    static ulong Diagonal(ulong s) => Sideways(North(s) | South(s));                            // the squares diagonally next to s
    static int Count(ulong s) => BitOperations.PopCount(s);

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

    /// <summary>The pieces of a FEN. The en passant square counts only if a pawn can capture onto it.</summary>
    public static Pieces FromFen(string fen)
    {
        ulong whitePawns = 0, blackPawns = 0, whiteKing = 0, blackKing = 0, whiteBishops = 0, blackBishops = 0, others = 0;
        bool enPassant = false;
        int rank = 7, file = 0;
        int c = 0;
        for (; c < fen.Length && fen[c] != ' '; c++)
        {
            if (fen[c] == '/') { rank--; file = 0; continue; }
            if (fen[c] >= '1' && fen[c] <= '8') { file += fen[c] - '0'; continue; }
            ulong sq = 1UL << (8 * rank + file++);
            switch (fen[c])
            {
                case 'P': whitePawns |= sq; break;
                case 'p': blackPawns |= sq; break;
                case 'K': whiteKing |= sq; break;
                case 'k': blackKing |= sq; break;
                case 'B': whiteBishops |= sq; break;
                case 'b': blackBishops |= sq; break;
                default: others |= sq; break;   // N R Q n r q
            }
        }
        while (c < fen.Length && fen[c] == ' ') c++;
        bool whiteToMove = c == fen.Length || fen[c] != 'b';
        for (int field = 0; field < 2 && c < fen.Length; field++)   // past the side to move and castling
        {
            while (c < fen.Length && fen[c] != ' ') c++;
            while (c < fen.Length && fen[c] == ' ') c++;
        }
        if (c + 1 < fen.Length && fen[c] >= 'a' && fen[c] <= 'h' && fen[c + 1] >= '1' && fen[c + 1] <= '8')
        {
            ulong target = 1UL << ((fen[c] - 'a') + 8 * (fen[c + 1] - '1'));
            enPassant = whiteToMove ? (Sideways(South(target)) & whitePawns) != 0
                                    : (Sideways(North(target)) & blackPawns) != 0;
        }
        return new Pieces(whitePawns, blackPawns, whiteKing, blackKing, whiteBishops, blackBishops, others, enPassant);
    }

    // Two bishops on squares of one colour (only a promotion makes them).
    static bool TwinBishops(ulong b) => Count(b & Dark) > 1 || Count(b & ~Dark) > 1;

    /// <summary>Can White (white = true) or Black never be mated, by the lock detector?</summary>
    public static bool CannotBeMated(Pieces p, bool white)
    {
        if (p.Others != 0 || p.EnPassant) return false;
        if (TwinBishops(p.WhiteBishops) || TwinBishops(p.BlackBishops)) return false;
        if (!Leaks(p, white, 0)) return true;
        // A king may be frozen only if every square around it is held or attacked by a pawn.
        ulong held = p.WhitePawns | p.BlackPawns | Sideways(North(p.WhitePawns) | South(p.BlackPawns));
        ulong[] kings = { p.WhiteKing, p.BlackKing };
        foreach (ulong king in kings)
            if ((Zone(king) & ~king & ~held) == 0 && !Leaks(p, white, king)) return true;
        return false;
    }

    // Does the structure leak to the king asked about, with the king `frozen` frozen (0: none)?
    static bool Leaks(Pieces p, bool white, ulong frozen)
    {
        ulong wp = p.WhitePawns, bp = p.BlackPawns, wk = p.WhiteKing, bk = p.BlackKing;
        bool frozenWhite = (frozen & wk) != 0;
        bool frozenBlack = !frozenWhite && frozen != 0;
        ulong nearFrozenBlack = frozenBlack ? Zone(bk) : 0;
        ulong nearFrozenWhite = frozenWhite ? Zone(wk) : 0;

        // Quick: the pawns' paths against the first walls already show a promotion or a capture.
        ulong wCone = FillNorth(wp, ~((bp & ~wk) | frozen));
        ulong bCone = FillSouth(bp, ~((wp & ~bk) | frozen));
        if (((wCone & Rank8) | (bCone & Rank1) | (North(Sideways(wCone)) & bCone)) != 0) return true;

        // The cycle: walls -> pawns that can never move -> king reaches -> capture squares -> walls.
        ulong wFixed = wp, bFixed = bp;     // pawns that can never move      (shrink)
        ulong wKing = wk, bKing = bk;       // squares each king may reach    (grow)
        ulong wTake = wk, bTake = bk;       // squares where a side may take an enemy pawn (grow)
        ulong wWall = ~0UL, bWall = ~0UL;   // pawns the other side can never take, and the frozen king
        while (true)
        {
            ulong lastWWall = wWall, lastBWall = bWall;
            wWall = (wp & ~bTake) | frozen;
            bWall = (bp & ~wTake) | frozen;
            ulong newWFixed = wFixed & wWall & South(bWall | wFixed);
            ulong newBFixed = bFixed & bWall & North(wWall | bFixed);
            if (wWall == lastWWall && bWall == lastBWall && newWFixed == wFixed && newBFixed == bFixed)
                break;
            // Both kings' reaches, flooded: never onto a fixed pawn, a square it attacks, or next to
            // the frozen king.
            ulong wMask = ~(newWFixed | Sideways(South(newBFixed)) | nearFrozenBlack);
            ulong bMask = ~(newBFixed | Sideways(North(newWFixed)) | nearFrozenWhite);
            ulong newWKing = wKing, newBKing = bKing;
            while (true)
            {
                ulong a = newWKing | (Zone(newWKing) & wMask);
                ulong d = newBKing | (Zone(newBKing) & bMask);
                if (a == newWKing && d == newBKing) break;
                newWKing = a;
                newBKing = d;
            }
            if ((frozenWhite && newWKing != wk) || (frozenBlack && newBKing != bk))
                return true;   // the frozen king can move
            // A side may take a pawn where its king goes, and on any square a pawn may walk into.
            ulong t = bTake | newBKing;
            ulong newBTake = t | South(FillSouth(t & ~bWall, ~bWall));
            t = wTake | newWKing;
            ulong newWTake = t | North(FillNorth(t & ~wWall, ~wWall));
            bool changed = newWFixed != wFixed || newBFixed != bFixed || newWKing != wKing ||
                           newBKing != bKing || newWTake != wTake || newBTake != bTake;
            wFixed = newWFixed; bFixed = newBFixed; wKing = newWKing; bKing = newBKing;
            wTake = newWTake; bTake = newBTake;
            if (!changed) break;
        }

        // The pawns' cones: every square they may still reach.
        wCone = FillNorth(wp, ~bWall);
        bCone = FillSouth(bp, ~wWall);
        if (((wCone & Rank8) | (bCone & Rank1)) != 0) return true;   // a pawn can promote
        if ((North(Sideways(wCone)) & bCone) != 0) return true;      // a pawn can capture
        // The bishops' reaches: every square they may reach, around the fixed pawns.
        ulong wBish = p.WhiteBishops, bBish = p.BlackBishops, open = ~(wFixed | bFixed);
        while (true)
        {
            ulong a = wBish | (Diagonal(wBish) & open);
            ulong d = bBish | (Diagonal(bBish) & open);
            if (a == wBish && d == bBish) break;
            wBish = a;
            bBish = d;
        }
        if (((Diagonal(wBish) & bCone) | (Diagonal(bBish) & wCone)) != 0) return true;   // a bishop meets a pawn's path

        // The mating net: can the other side's pawns and bishops catch the king asked about?
        ulong attack, reach, free, spare;
        if (white)
        {
            attack = Diagonal(bBish) | Sideways(South(bCone));
            reach = wKing;
            free = ~(wCone | Zone(bKing) | attack);   // never occupied, attacked or next to the mater
            spare = free & ~wBish;                    // ... nor reached by the king's own bishops
        }
        else
        {
            attack = Diagonal(wBish) | Sideways(North(wCone));
            reach = bKing;
            free = ~(bCone | Zone(wKing) | attack);
            spare = free & ~bBish;
        }
        // A king next to a spare square, or with free squares beside it both ways, always has a flight.
        ulong flight = Sideways(spare) | North(spare) | South(spare) | ((North(free) | South(free)) & Sideways(free));
        return (attack & reach & ~flight) != 0;
    }
}
