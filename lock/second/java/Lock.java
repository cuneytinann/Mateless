import java.util.ArrayList;
import java.util.List;

/**
 * Mateless's lock detector, second version, in its simplest form.
 *
 * <p>Can a side never be mated? The lock detector answers yes when pawns, kings and bishops (and
 * knights, rooks or queens boxed in by their own men) form a structure that no series of legal
 * moves can open (FIDE 5.2.2 dead position, 6.9 flag fall). It reads bitboards and the side to
 * move: it generates no move and searches nothing.
 *
 * <p>The first version (../../java/Lock.java) grows each king's reach, the pawns that can never
 * move, and the squares where each side may take a pawn, until nothing changes; the structure leaks
 * if a pawn can promote or capture, a frozen king can move, a bishop can reach a pawn's path, or
 * the king asked about can reach a square the other side attacks without a sure flight. This
 * version keeps all of it and adds, each only where its situation is on the board:
 * <ul>
 * <li>open pawn pairs: a white and a black pawn on one file with one empty square between them;
 *     the reachable positions split into families by what the pair's pawns have done (neither
 *     moved, the white one stepped into the gap, the black one did), up to 3 pairs;
 * <li>boxed knights, rooks and queens: a piece whose every step square holds one of its own men
 *     that never moves, and that no enemy king or bishop reaches, never moves nor falls;
 * <li>twin bishops: two bishops of one side on one colour no longer fail it; the mating net leaves
 *     out its second flight rule where they may hold both flights;
 * <li>the stalemate guard: a pawn the enemy king may take stays a wall if taking it always
 *     stalemates its owner;
 * <li>the check seed: a king in a pawn's check starts its reach from the squares it can step to;
 * <li>the stuck mater: whatever the flagged side plays, the mater is left without a move;
 * <li>the forced step: a king in a pawn's check with one legal move, a step: the lock of the
 *     position after it.
 * </ul>
 * A possible en passant capture fails it at once. Sound, not complete: a structure it passes can
 * never be opened; one it fails may still be dead.
 *
 * <p>Squares: a1 = 0, b1 = 1, ..., h8 = 63. A set of squares (a bitboard) is a {@code long}. Java
 * has no unsigned {@code long}, so a set is shifted right with {@code >>>}.
 */
public final class Lock {
    private static final long FILE_A = 0x0101010101010101L;
    private static final long FILE_H = 0x8080808080808080L;
    private static final long RANK_1 = 0x00000000000000FFL;
    private static final long RANK_3 = 0x0000000000FF0000L;
    private static final long RANK_6 = 0x0000FF0000000000L;
    private static final long RANK_8 = 0xFF00000000000000L;
    private static final long DARK = 0xAA55AA55AA55AA55L;   // the dark squares; a1 is dark
    private static final int MAX_PAIRS = 3;                 // the most open pairs the families are split on (3^3 = 27)

    private Lock() {}

    private static long north(long s) { return s << 8; }
    private static long south(long s) { return s >>> 8; }
    private static long sideways(long s) { return ((s << 1) & ~FILE_A) | ((s >>> 1) & ~FILE_H); }
    private static long zone(long s) { long v = s | north(s) | south(s); return v | sideways(v); }  // s and every square next to it
    private static long steps(long s) { return zone(s) & ~s; }                                      // the squares next to s
    private static long diagonal(long s) { return sideways(north(s) | south(s)); }                // the squares diagonally next to s
    private static int count(long s) { return Long.bitCount(s); }

    /** The squares a knight on s goes to. */
    private static long knight(long s) {
        long one = sideways(s);
        long two = ((s << 2) & ~(FILE_A | (FILE_A << 1))) | ((s >>> 2) & ~(FILE_H | (FILE_H >>> 1)));
        return north(north(one)) | south(south(one)) | north(two) | south(two);
    }

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

    /** Every square a king may reach from k through squares of m. */
    private static long flood(long k, long m) {
        for (;;) { long a = k | (zone(k) & m); if (a == k) return k; k = a; }
    }

    /** What the lock detector reads from a position. */
    public record Pieces(
            long whitePawns, long blackPawns,
            long whiteKing, long blackKing,
            long whiteBishops, long blackBishops,
            long whiteKnights, long blackKnights,
            long whiteRooks, long blackRooks,
            long whiteQueens, long blackQueens,
            boolean whiteToMove,
            boolean enPassant     // the side to move can capture en passant
    ) {}

    /** What one level leaves for the mating net (and for the families after it). */
    private record Sets(long wCone, long bCone, long wFixed, long bFixed, long wKing, long bKing,
                        long wBish, long bBish, long wTake, long bTake) {}

    /** The inputs of a level beyond the position: see {@link #level}. */
    private record Level(long[] pawns, long v, long[] start, long wx, long bx, long ws, long bs, boolean guard) {}

    /** The pieces of a FEN. The en passant square counts only if a pawn can capture onto it. */
    public static Pieces fromFen(String fen) {
        String[] fields = fen.split(" ");
        long[] sets = new long[128];
        int rank = 7, file = 0;
        for (char c : fields[0].toCharArray()) {
            if (c == '/') { rank--; file = 0; continue; }
            if (c >= '1' && c <= '8') { file += c - '0'; continue; }
            sets[c] |= 1L << (8 * rank + file++);
        }
        boolean whiteToMove = fields.length < 2 || fields[1].equals("w");
        boolean enPassant = false;
        if (fields.length > 3 && !fields[3].equals("-")) {   // past the side to move and castling
            long target = 1L << ((fields[3].charAt(0) - 'a') + 8 * (fields[3].charAt(1) - '1'));
            enPassant = whiteToMove ? (sideways(south(target)) & sets['P']) != 0
                                    : (sideways(north(target)) & sets['p']) != 0;
        }
        return new Pieces(sets['P'], sets['p'], sets['K'], sets['k'], sets['B'], sets['b'], sets['N'], sets['n'],
                          sets['R'], sets['r'], sets['Q'], sets['q'], whiteToMove, enPassant);
    }

    /** Can White (white = true) or Black never be mated, by the lock detector? */
    public static boolean cannotBeMated(Pieces p, boolean white) {
        Pieces after = forcedStep(p);
        if (after != null) return cannotBeMated(after, white);
        long wx = p.whiteKnights() | p.whiteRooks() | p.whiteQueens(), bx = p.blackKnights() | p.blackRooks() | p.blackQueens();
        if ((wx | bx) != 0) return boxedLock(p, white, wx, bx);
        if (p.enPassant()) return false;
        long gaps = north(p.whitePawns()) & south(p.blackPawns()) & ~(p.whitePawns() | p.blackPawns());
        for (long frozen : levels(p)) {
            if (gaps != 0) {
                Family f = families(p, gaps, frozen, white);
                if (f == Family.LOCK) return true;
                if (f == Family.REFUTED) continue;   // family A, the level with more walls, leaked: the level leaks too
            }
            Sets s = level(p, frozen, new Level(null, 0, null, 0, 0, 0, 0, true));
            if (s != null && !netLeaks(p, s, white, 0)) return true;
        }
        return stuckMater(p, white);
    }

    /** The levels: both kings free (0), then each king frozen on its square (a wall for both sides)
        when every square around it is held or attacked by a pawn. */
    private static List<Long> levels(Pieces p) {
        long held = p.whitePawns() | p.blackPawns() | sideways(north(p.whitePawns()) | south(p.blackPawns()));
        List<Long> out = new ArrayList<>(List.of(0L));
        for (long king : new long[] { p.whiteKing(), p.blackKing() })
            if ((steps(king) & ~held) == 0) out.add(king);
        return out;
    }

    /**
     * One level: the fixed point of the walls, the pawns that can never move, the kings' reaches,
     * the squares where each side may take a pawn, the pawns' cones and the bishops' reaches. The
     * sets the mating net reads, or null when the structure leaks whichever side is asked about.
     * o.pawns: the pawns (a family has a pair's pawn moved into its gap); o.v: walls for both sides
     * (the gaps of a family's pairs that stay); o.start: where the kings' reaches, capture squares
     * and bishops' reaches start (a family's); o.wx, bx, ws, bs: the boxed pieces' candidates and
     * their step squares; o.guard: the stalemate guard and the check seed (plain levels only).
     */
    private static Sets level(Pieces p, long frozen, Level o) {
        long wp = o.pawns() != null ? o.pawns()[0] : p.whitePawns(), bp = o.pawns() != null ? o.pawns()[1] : p.blackPawns();
        long wk = p.whiteKing(), bk = p.blackKing();
        long wx = o.wx(), bx = o.bx(), v = o.v() | frozen;
        boolean frozenWhite = (frozen & wk) != 0;
        boolean frozenBlack = !frozenWhite && frozen != 0;
        long nearFrozenBlack = frozenBlack ? zone(bk) : 0, nearFrozenWhite = frozenWhite ? zone(wk) : 0;
        long[] seed = o.guard() && frozen == 0 ? checkSeed(p) : new long[] { wk, bk };
        long wSeed = seed[0], bSeed = seed[1];
        long wKing = wSeed, bKing = bSeed, wTake = wSeed, bTake = bSeed, wBish = p.whiteBishops(), bBish = p.blackBishops();
        if (o.start() != null) {
            wKing = o.start()[0]; bKing = o.start()[1]; wTake = o.start()[2]; bTake = o.start()[3];
            wBish = o.start()[4]; bBish = o.start()[5];
        }
        long wCone = wp, bCone = bp, wFixed = wp, bFixed = bp;
        long wGuard = o.guard() ? ~0L : 0, bGuard = o.guard() ? ~0L : 0;   // nothing is taken yet
        for (;;) {
            // Boxed: the pieces no enemy king or bishop reaches. Walls: pawns the other side can
            // never take (or whose capture stalemates their owner), the frozen king, the gaps, boxed pieces.
            long boxed = (wx & ~(bKing | bBish)) | (bx & ~(wKing | wBish));
            long wWall = (wp & ~(bTake & ~wGuard)) | v | boxed;
            long bWall = (bp & ~(wTake & ~bGuard)) | v | boxed;
            long nwFixed = wFixed & wWall & south(bWall | wFixed);
            long nbFixed = bFixed & bWall & north(wWall | bFixed);
            long nwCone = fillNorth(wCone, ~bWall), nbCone = fillSouth(bCone, ~wWall);
            // The kings: never onto a fixed pawn, a square it attacks, or next to the frozen king.
            long bHit = sideways(south(nbFixed)), wHit = sideways(north(nwFixed));
            long nwKing = flood(wKing, ~(nwFixed | bHit | nearFrozenBlack));
            long nbKing = flood(bKing, ~(nbFixed | wHit | nearFrozenWhite));
            long nwBish = wBish, nbBish = bBish, open = ~(nwFixed | nbFixed);
            for (;;) {
                long a = nwBish | (diagonal(nwBish) & open), d = nbBish | (diagonal(nbBish) & open);
                if (a == nwBish && d == nbBish) break;
                nwBish = a;
                nbBish = d;
            }
            // A side may take a pawn where its king goes, and on any square a pawn may walk into.
            long t = bTake | nbKing;
            long nbTake = t | south(fillSouth(t & ~bWall, ~bWall));
            t = wTake | nwKing;
            long nwTake = t | north(fillNorth(t & ~wWall, ~wWall));
            long nwGuard = wGuard, nbGuard = bGuard;
            if (o.guard()) {
                long block = nwFixed | nbFixed;
                boolean wHasB = p.whiteBishops() != 0, bHasB = p.blackBishops() != 0;
                nwGuard = wHasB ? 0 : stalemateGuard(wp & nbTake & nwFixed, wp, nwFixed, nwKing, nwFixed | bHit, nbKing, bHasB, block);
                nbGuard = bHasB ? 0 : stalemateGuard(bp & nwTake & nbFixed, bp, nbFixed, nbKing, nbFixed | wHit, nwKing, wHasB, block);
            }
            boolean changed = nwCone != wCone || nbCone != bCone || nwFixed != wFixed || nbFixed != bFixed
                    || nwKing != wKing || nbKing != bKing || nwBish != wBish || nbBish != bBish
                    || nwTake != wTake || nbTake != bTake || nwGuard != wGuard || nbGuard != bGuard;
            wCone = nwCone; bCone = nbCone; wFixed = nwFixed; bFixed = nbFixed; wKing = nwKing; bKing = nbKing;
            wBish = nwBish; bBish = nbBish; wTake = nwTake; bTake = nbTake; wGuard = nwGuard; bGuard = nbGuard;
            if (!changed) break;
        }
        long boxed = (wx & ~(bKing | bBish)) | (bx & ~(wKing | wBish));
        if (((wCone & RANK_8) | (bCone & RANK_1)) != 0) return null;                             // a pawn can promote
        if (((north(sideways(wCone)) & (bCone | bx)) | (south(sideways(bCone)) & wx)) != 0) return null;  // a pawn can capture
        if ((frozenWhite && wKing != wk) || (frozenBlack && bKing != bk)) return null;          // the frozen king can move
        if (((diagonal(wBish) & bCone) | (diagonal(bBish) & wCone)) != 0) return null;           // a bishop meets a pawn's path
        if (((o.ws() & ~(wFixed | (wx & boxed))) | (o.bs() & ~(bFixed | (bx & boxed)))) != 0) return null;  // a piece may step
        if ((wGuard | bGuard) != 0) {
            // A king that takes a guarded pawn ends the game: for the mating net, the kings'
            // reaches again, now stopping at the enemy's guarded pawns.
            wKing = flood(wSeed, ~(wFixed | sideways(south(bFixed)) | nearFrozenBlack | (bp & bGuard)));
            bKing = flood(bSeed, ~(bFixed | sideways(north(wFixed)) | nearFrozenWhite | (wp & wGuard)));
        }
        return new Sets(wCone, bCone, wFixed, bFixed, wKing, bKing, wBish, bBish, wTake, bTake);
    }

    /** The mating net: can the other side's pawns and bishops catch the king asked about? occ:
        squares that stand occupied for good besides (the boxed pieces'). */
    private static boolean netLeaks(Pieces p, Sets s, boolean white, long occ) {
        long attack, reach, free, spare, twins;
        if (white) {
            attack = diagonal(s.bBish()) | sideways(south(s.bCone()));
            reach = s.wKing();
            free = ~(s.wCone() | occ | zone(s.bKing()) | attack);   // never occupied, attacked or next to the mater
            spare = free & ~s.wBish();                              // ... nor reached by the king's own bishops
            twins = p.whiteBishops();
        } else {
            attack = diagonal(s.wBish()) | sideways(north(s.wCone()));
            reach = s.bKing();
            free = ~(s.bCone() | occ | zone(s.wKing()) | attack);
            spare = free & ~s.bBish();
            twins = p.blackBishops();
        }
        // A king next to a spare square, or with free squares beside it both ways, always has a
        // flight. The second rule counts on at most one of the king's own bishops on the colour of
        // those two squares (the colour opposite the king's): not on the king squares where it has
        // two or more.
        long noPair = (count(twins & DARK) > 1 ? ~DARK : 0) | (count(twins & ~DARK) > 1 ? DARK : 0);
        long flight = sideways(spare) | north(spare) | south(spare)
                | ((north(free) | south(free)) & sideways(free) & ~noPair);
        return (attack & reach & ~flight) != 0;
    }

    /** The check seed: the side to move is in a pawn's check, so its king must step now, to a
        square it can step to (not its own pawn, not a square an enemy pawn attacks, not next to the
        enemy king); its reach starts there. Not when it has no such square (that may be a mate
        now), when one of its pawns can take a checking pawn, or with a bishop on the board. The
        kings' starting sets. */
    private static long[] checkSeed(Pieces p) {
        long wp = p.whitePawns(), bp = p.blackPawns(), wk = p.whiteKing(), bk = p.blackKing();
        boolean white = p.whiteToMove();
        if ((p.whiteBishops() | p.blackBishops()) != 0) return new long[] { wk, bk };
        long k = white ? wk : bk, own = white ? wp : bp;
        long checkers = white ? sideways(north(k)) & bp : sideways(south(k)) & wp;
        if (checkers == 0) return new long[] { wk, bk };
        long attacked = white ? sideways(south(bp)) : sideways(north(wp));
        long to = steps(k) & ~own & ~attacked & ~steps(white ? bk : wk);
        long takers = (white ? sideways(south(checkers)) : sideways(north(checkers))) & own;
        if (to == 0 || takers != 0) return new long[] { wk, bk };
        return white ? new long[] { to, bk } : new long[] { wk, to };
    }

    /** The stalemate guard: of the owner's fixed pawns cand (which the enemy king may take), those
        whose capture always stalemates the owner. The owner must have nothing else that moves (every
        other pawn fixed; no bishop, which the caller sees to). reach: where the owner's king may
        stand; shut: squares it can never step to (own fixed pawns, squares the enemy's fixed pawns
        attack); enemyKing: the enemy king's reach; block: squares a bishop's line never crosses. */
    private static long stalemateGuard(long cand, long own, long ownFixed, long reach, long shut, long enemyKing,
                                       boolean enemyBishops, long block) {
        if ((own & ~ownFixed) != 0) return 0;
        long guard = 0;
        for (long c = cand; c != 0; c &= c - 1) {
            long pawn = c & -c, near = steps(pawn);
            long from = near & enemyKing;              // where the enemy king takes from
            long x = shut | near | pawn;               // after the capture, the owner's king may not step there
            boolean held = true;
            for (long k = reach & ~(near | pawn); k != 0; k &= k - 1) {   // the owner's king, not defending the pawn
                long king = k & -k;
                if ((steps(king) & ~x) != 0 || (enemyBishops && rayMeets(king, block | pawn, from))) {
                    held = false;                      // it has a square to step to, or the capture uncovers a check
                    break;
                }
            }
            if (held) guard |= pawn;
        }
        return guard;
    }

    /** Does a diagonal line from the square king, stopped by block, meet a square of o? */
    private static boolean rayMeets(long king, long block, long o) {
        int sq = Long.numberOfTrailingZeros(king), f0 = sq & 7, r0 = sq >> 3;
        for (int[] d : new int[][] { { -1, -1 }, { 1, -1 }, { -1, 1 }, { 1, 1 } }) {
            for (int f = f0 + d[0], r = r0 + d[1]; f >= 0 && f < 8 && r >= 0 && r < 8; f += d[0], r += d[1]) {
                long s = 1L << (8 * r + f);
                if ((o & s) != 0) return true;
                if ((block & s) != 0) break;
            }
        }
        return false;
    }

    /** What the families of the open pairs say at one level. */
    private enum Family {
        LOCK,      // none of them leaks to the king asked about
        REFUTED,   // family A (no pair's pawn has moved) leaks to it
        NONE       // another family leaks
    }

    /** The families of the open pairs at one level. */
    private static Family families(Pieces p, long gaps, long frozen, boolean white) {
        List<long[]> pairs = new ArrayList<>();   // per pair: the gap, the white pawn below it, the black pawn above it
        for (long g = gaps; g != 0; g &= g - 1) { long gap = g & -g; pairs.add(new long[] { gap, south(gap), north(gap) }); }
        if (pairs.size() > MAX_PAIRS) return Family.NONE;
        int k = pairs.size(), n = (int) Math.pow(3, k);
        List<Sets> sets = new ArrayList<>();
        for (int f = 0; f < n; f++) {
            // Family f: digit i (base 3) says what pair i's pawns have done: 0 neither, 1 the white
            // one stepped into the gap, 2 the black one did. Its sets start from those of the family
            // it is reached from (the same with pair i's pawns in place), minus the gap.
            long wp = p.whitePawns(), bp = p.blackPawns(), v = 0;
            long[] start = f == 0
                    ? new long[] { p.whiteKing(), p.blackKing(), p.whiteKing(), p.blackKing(), p.whiteBishops(), p.blackBishops() }
                    : new long[6];
            for (int i = 0, q = f, pow = 1; i < k; i++, q /= 3, pow *= 3) {
                int d = q % 3;
                long gap = pairs.get(i)[0], w = pairs.get(i)[1], b = pairs.get(i)[2];
                if (d == 0) { v |= gap; continue; }   // the gap stays: a wall for both sides' pawns
                if (d == 1) wp = (wp & ~w) | gap; else bp = (bp & ~b) | gap;
                Sets r = sets.get(f - d * pow);
                start[0] |= r.wKing() & ~gap;
                start[1] |= r.bKing() & ~gap;
                start[2] |= r.wTake();
                start[3] |= r.bTake();
                start[4] |= r.wBish() & ~gap;
                start[5] |= r.bBish() & ~gap;
            }
            Sets s = level(p, frozen, new Level(new long[] { wp, bp }, v, start, 0, 0, 0, 0, false));
            if (s == null) return f == 0 ? Family.REFUTED : Family.NONE;
            // The pairs that stay: both pawns must never move.
            for (int i = 0, q = f; i < k; i++, q /= 3)
                if (q % 3 == 0 && ((pairs.get(i)[1] & ~s.wFixed()) | (pairs.get(i)[2] & ~s.bFixed())) != 0) return Family.NONE;
            if (netLeaks(p, s, white, 0)) return f == 0 ? Family.REFUTED : Family.NONE;
            sets.add(s);
        }
        return Family.LOCK;
    }

    /** With knights, rooks or queens on the board: every one of them must be boxed in by its own
        pawns and pieces; then the levels, with the boxed pieces as walls and no flight onto their
        squares. */
    private static boolean boxedLock(Pieces p, boolean white, long wx, long bx) {
        long ws = boxSteps(p.whiteKnights(), p.whiteRooks() | p.whiteQueens(), p.whiteQueens());
        long bs = boxSteps(p.blackKnights(), p.blackRooks() | p.blackQueens(), p.blackQueens());
        if ((ws & ~(p.whitePawns() | wx)) != 0 || (bs & ~(p.blackPawns() | bx)) != 0 || p.enPassant()) return false;
        for (long frozen : levels(p)) {
            Sets s = level(p, frozen, new Level(null, 0, null, wx, bx, ws, bs, false));
            if (s != null && !netLeaks(p, s, white, wx | bx)) return true;
        }
        return false;
    }

    /** The step squares of one side's knights, rooks (and queens: o) and queens; each must hold one
        of its own men. */
    private static long boxSteps(long knights, long o, long queens) {
        return sideways(o) | north(o) | south(o) | diagonal(queens) | knight(knights);
    }

    /** The stuck mater: the flagged side is to move and, whatever it plays, the mater has no legal
        move left (kings and pawns only): the game ends at the mater's turn. */
    private static boolean stuckMater(Pieces p, boolean white) {
        if (p.whiteToMove() != white || p.enPassant()) return false;
        if ((p.whiteBishops() | p.blackBishops() | p.whiteKnights() | p.blackKnights() | p.whiteRooks()
                | p.blackRooks() | p.whiteQueens() | p.blackQueens()) != 0) return false;
        long fp = white ? p.whitePawns() : p.blackPawns(), mp = white ? p.blackPawns() : p.whitePawns();
        long fk = white ? p.whiteKing() : p.blackKing(), mk = white ? p.blackKing() : p.whiteKing();
        long occ = fp | mp | fk | mk;
        // Ahead and behind, for the flagged side.
        java.util.function.LongUnaryOperator fwd = s -> white ? north(s) : south(s), back = s -> white ? south(s) : north(s);
        // A mater's pawn with an empty square ahead is never stuck; then only a stalemate now is
        // left to find, which a flagged pawn's push rules out.
        if ((back.applyAsLong(mp) & ~occ) != 0 && (fwd.applyAsLong(fp) & ~occ) != 0) return false;
        long fAttack = sideways(fwd.applyAsLong(fp)), mAttack = sideways(back.applyAsLong(mp));
        if ((fAttack & (mp | mk)) != 0) return false;                     // 1. the flagged side has no capture
        long single = fwd.applyAsLong(fp) & ~occ;
        long dbl = fwd.applyAsLong(single & (white ? RANK_3 : RANK_6)) & ~occ;
        long pushes = single | dbl;
        long near = steps(mk);
        long kingTo = steps(fk) & ~fp & ~mAttack & ~near;                  // the flagged king's steps now
        boolean inCheck = (fk & mAttack) != 0;
        if (inCheck && kingTo == 0) return false;                         // mated now
        boolean stays = pushes != 0 && !inCheck;                          // a pawn may move instead of the king
        if (kingTo == 0 && !stays) return true;                           // no move, no check: stalemate now
        // The squares next to every square the flagged king may stand on after its move.
        long cover = stays ? steps(fk) : ~0L;
        for (long k = kingTo; k != 0; k &= k - 1) cover &= steps(k & -k);
        // 2. the mater's pawns are blocked by men that stay, and attack no flagged pawn
        long blockers = fp | mp | mk | (kingTo == 0 ? fk : 0);
        if (((back.applyAsLong(mp) & ~blockers) | (mAttack & fp)) != 0) return false;
        // 3. every square next to the mater's king: its own pawn, attacked by a flagged pawn that
        //    cannot move now, or next to the flagged king wherever it goes
        long still = fp & back.applyAsLong(fwd.applyAsLong(fp) & occ);
        if ((near & ~(mp | sideways(fwd.applyAsLong(still)) | cover)) != 0) return false;
        // 4. no push lands where a mater's pawn attacks or next to its king, nor lets it take en passant
        return ((pushes & (mAttack | near)) | (dbl & sideways(mp))) == 0;
    }

    /** The forced step: the side to move is in a pawn's check, with kings and pawns only, and its
        one legal move is a step of its king. The position after it, or null. */
    private static Pieces forcedStep(Pieces p) {
        if (p.enPassant() || (p.whiteBishops() | p.blackBishops() | p.whiteKnights() | p.blackKnights()
                | p.whiteRooks() | p.blackRooks() | p.whiteQueens() | p.blackQueens()) != 0) return null;
        boolean white = p.whiteToMove();
        long k = white ? p.whiteKing() : p.blackKing(), ek = white ? p.blackKing() : p.whiteKing();
        long own = white ? p.whitePawns() : p.blackPawns(), enemy = white ? p.blackPawns() : p.whitePawns();
        long checkers = (white ? sideways(north(k)) : sideways(south(k))) & enemy;
        if (checkers == 0) return null;
        long attacked = white ? sideways(south(enemy)) : sideways(north(enemy));
        long to = steps(k) & ~own & ~attacked & ~steps(ek);
        if (count(to) != 1) return null;
        if (((white ? sideways(south(checkers)) : sideways(north(checkers))) & own) != 0) return null;  // a pawn may take instead
        return white
                ? new Pieces(p.whitePawns(), p.blackPawns() & ~to, to, p.blackKing(), 0, 0, 0, 0, 0, 0, 0, 0, false, false)
                : new Pieces(p.whitePawns() & ~to, p.blackPawns(), p.whiteKing(), to, 0, 0, 0, 0, 0, 0, 0, 0, true, false);
    }
}
