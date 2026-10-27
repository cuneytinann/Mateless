/**
 * Mateless's lock detector, in its simplest form.
 *
 * <p>Can a side never be mated? The lock detector answers yes when pawns, kings and bishops form a
 * structure that no series of legal moves can open (FIDE 5.2.2 dead position, 6.9 flag fall). It
 * reads bitboards only: it generates no move and searches nothing.
 *
 * <p>Each king's reach (every square it may ever stand on) is grown from its square, never onto a
 * square that a pawn which can never move attacks. The pawns that can never move are those
 * blocked by a wall: a pawn the other side can never take. The squares where a side may take a
 * pawn grow from its king's reach, and so on, until nothing changes. The structure leaks if a
 * pawn can promote or capture, a frozen king can move, a bishop can reach a pawn's path, or the
 * king of the side asked about can reach a square the other side attacks where it has no sure
 * flight. It is tried with both kings free, then with each king frozen on its square (a wall for
 * both sides) when every square around that king is held or attacked by a pawn.
 *
 * <p>A knight, rook or queen on the board, two bishops of one side on squares of one colour, or a
 * possible en passant capture fails it at once. Sound, not complete: a structure it passes can
 * never be opened; one it fails may still be dead.
 *
 * <p>Squares: a1 = 0, b1 = 1, ..., h8 = 63. A set of squares (a bitboard) is a {@code long}. Java
 * has no unsigned {@code long}, so a set is shifted right with {@code >>>}.
 */
public final class Lock {
    private static final long FILE_A = 0x0101010101010101L;
    private static final long FILE_H = 0x8080808080808080L;
    private static final long RANK_1 = 0x00000000000000FFL;
    private static final long RANK_8 = 0xFF00000000000000L;
    private static final long DARK = 0xAA55AA55AA55AA55L;   // the dark squares; a1 is dark

    private Lock() {}

    private static long north(long s) { return s << 8; }
    private static long south(long s) { return s >>> 8; }
    private static long sideways(long s) { return ((s << 1) & ~FILE_A) | ((s >>> 1) & ~FILE_H); }
    private static long zone(long s) { long v = s | north(s) | south(s); return v | sideways(v); }  // s and every square next to it
    private static long diagonal(long s) { return sideways(north(s) | south(s)); }                // the squares diagonally next to s
    private static int count(long s) { return Long.bitCount(s); }

    /** Every square reachable from g by steps north through squares of p. */
    private static long fillNorth(long g, long p) {
        g |= p & (g << 8);
        p &= p << 8;
        g |= p & (g << 16);
        p &= p << 16;
        return g | (p & (g << 32));
    }

    /** Every square reachable from g by steps south through squares of p. */
    private static long fillSouth(long g, long p) {
        g |= p & (g >>> 8);
        p &= p >>> 8;
        g |= p & (g >>> 16);
        p &= p >>> 16;
        return g | (p & (g >>> 32));
    }

    /** What the lock detector reads from a position. */
    public record Pieces(
            long whitePawns, long blackPawns,
            long whiteKing, long blackKing,
            long whiteBishops, long blackBishops,
            long others,          // knights, rooks and queens of both sides
            boolean enPassant     // the side to move can capture en passant
    ) {}

    /** The pieces of a FEN. The en passant square counts only if a pawn can capture onto it. */
    public static Pieces fromFen(String fen) {
        String[] fields = fen.split(" ");
        long whitePawns = 0, blackPawns = 0, whiteKing = 0, blackKing = 0;
        long whiteBishops = 0, blackBishops = 0, others = 0;
        int rank = 7, file = 0;
        for (char c : fields[0].toCharArray()) {
            if (c == '/') { rank--; file = 0; continue; }
            if (c >= '1' && c <= '8') { file += c - '0'; continue; }
            long sq = 1L << (8 * rank + file++);
            switch (c) {
                case 'P' -> whitePawns |= sq;
                case 'p' -> blackPawns |= sq;
                case 'K' -> whiteKing |= sq;
                case 'k' -> blackKing |= sq;
                case 'B' -> whiteBishops |= sq;
                case 'b' -> blackBishops |= sq;
                default -> others |= sq;   // N R Q n r q
            }
        }
        boolean whiteToMove = fields.length < 2 || fields[1].equals("w");
        boolean enPassant = false;
        if (fields.length > 3 && !fields[3].equals("-")) {   // past the side to move and castling
            long target = 1L << ((fields[3].charAt(0) - 'a') + 8 * (fields[3].charAt(1) - '1'));
            enPassant = whiteToMove ? (sideways(south(target)) & whitePawns) != 0
                                    : (sideways(north(target)) & blackPawns) != 0;
        }
        return new Pieces(whitePawns, blackPawns, whiteKing, blackKing, whiteBishops, blackBishops, others, enPassant);
    }

    /** Two bishops on squares of one colour (only a promotion makes them). */
    private static boolean twinBishops(long b) { return count(b & DARK) > 1 || count(b & ~DARK) > 1; }

    /** Can White (white = true) or Black never be mated, by the lock detector? */
    public static boolean cannotBeMated(Pieces p, boolean white) {
        if (p.others() != 0 || p.enPassant()) return false;
        if (twinBishops(p.whiteBishops()) || twinBishops(p.blackBishops())) return false;
        if (!leaks(p, white, 0)) return true;
        // A king may be frozen only if every square around it is held or attacked by a pawn.
        long held = p.whitePawns() | p.blackPawns() | sideways(north(p.whitePawns()) | south(p.blackPawns()));
        long[] kings = { p.whiteKing(), p.blackKing() };
        for (long king : kings)
            if ((zone(king) & ~king & ~held) == 0 && !leaks(p, white, king)) return true;
        return false;
    }

    /** Does the structure leak to the king asked about, with the king {@code frozen} frozen (0: none)? */
    private static boolean leaks(Pieces p, boolean white, long frozen) {
        long wp = p.whitePawns(), bp = p.blackPawns(), wk = p.whiteKing(), bk = p.blackKing();
        boolean frozenWhite = (frozen & wk) != 0;
        boolean frozenBlack = !frozenWhite && frozen != 0;
        long nearFrozenBlack = frozenBlack ? zone(bk) : 0;
        long nearFrozenWhite = frozenWhite ? zone(wk) : 0;

        // Quick: the pawns' paths against the first walls already show a promotion or a capture.
        long wCone = fillNorth(wp, ~((bp & ~wk) | frozen));
        long bCone = fillSouth(bp, ~((wp & ~bk) | frozen));
        if (((wCone & RANK_8) | (bCone & RANK_1) | (north(sideways(wCone)) & bCone)) != 0) return true;

        // The cycle: walls -> pawns that can never move -> king reaches -> capture squares -> walls.
        long wFixed = wp, bFixed = bp;     // pawns that can never move      (shrink)
        long wKing = wk, bKing = bk;       // squares each king may reach    (grow)
        long wTake = wk, bTake = bk;       // squares where a side may take an enemy pawn (grow)
        long wWall = ~0L, bWall = ~0L;     // pawns the other side can never take, and the frozen king
        for (;;) {
            long lastWWall = wWall, lastBWall = bWall;
            wWall = (wp & ~bTake) | frozen;
            bWall = (bp & ~wTake) | frozen;
            long newWFixed = wFixed & wWall & south(bWall | wFixed);
            long newBFixed = bFixed & bWall & north(wWall | bFixed);
            if (wWall == lastWWall && bWall == lastBWall && newWFixed == wFixed && newBFixed == bFixed)
                break;
            // Both kings' reaches, flooded: never onto a fixed pawn, a square it attacks, or next to
            // the frozen king.
            long wMask = ~(newWFixed | sideways(south(newBFixed)) | nearFrozenBlack);
            long bMask = ~(newBFixed | sideways(north(newWFixed)) | nearFrozenWhite);
            long newWKing = wKing, newBKing = bKing;
            for (;;) {
                long a = newWKing | (zone(newWKing) & wMask);
                long d = newBKing | (zone(newBKing) & bMask);
                if (a == newWKing && d == newBKing) break;
                newWKing = a;
                newBKing = d;
            }
            if ((frozenWhite && newWKing != wk) || (frozenBlack && newBKing != bk))
                return true;   // the frozen king can move
            // A side may take a pawn where its king goes, and on any square a pawn may walk into.
            long t = bTake | newBKing;
            long newBTake = t | south(fillSouth(t & ~bWall, ~bWall));
            t = wTake | newWKing;
            long newWTake = t | north(fillNorth(t & ~wWall, ~wWall));
            boolean changed = newWFixed != wFixed || newBFixed != bFixed || newWKing != wKing ||
                              newBKing != bKing || newWTake != wTake || newBTake != bTake;
            wFixed = newWFixed; bFixed = newBFixed; wKing = newWKing; bKing = newBKing;
            wTake = newWTake; bTake = newBTake;
            if (!changed) break;
        }

        // The pawns' cones: every square they may still reach.
        wCone = fillNorth(wp, ~bWall);
        bCone = fillSouth(bp, ~wWall);
        if (((wCone & RANK_8) | (bCone & RANK_1)) != 0) return true;   // a pawn can promote
        if ((north(sideways(wCone)) & bCone) != 0) return true;        // a pawn can capture
        // The bishops' reaches: every square they may reach, around the fixed pawns.
        long wBish = p.whiteBishops(), bBish = p.blackBishops(), open = ~(wFixed | bFixed);
        for (;;) {
            long a = wBish | (diagonal(wBish) & open);
            long d = bBish | (diagonal(bBish) & open);
            if (a == wBish && d == bBish) break;
            wBish = a;
            bBish = d;
        }
        if (((diagonal(wBish) & bCone) | (diagonal(bBish) & wCone)) != 0) return true;   // a bishop meets a pawn's path

        // The mating net: can the other side's pawns and bishops catch the king asked about?
        long attack, reach, free, spare;
        if (white) {
            attack = diagonal(bBish) | sideways(south(bCone));
            reach = wKing;
            free = ~(wCone | zone(bKing) | attack);   // never occupied, attacked or next to the mater
            spare = free & ~wBish;                    // ... nor reached by the king's own bishops
        } else {
            attack = diagonal(wBish) | sideways(north(wCone));
            reach = bKing;
            free = ~(bCone | zone(wKing) | attack);
            spare = free & ~bBish;
        }
        // A king next to a spare square, or with free squares beside it both ways, always has a flight.
        long flight = sideways(spare) | north(spare) | south(spare) | ((north(free) | south(free)) & sideways(free));
        return (attack & reach & ~flight) != 0;
    }
}
