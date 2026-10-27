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
 * Squares: a1 = 0, b1 = 1, ..., h8 = 63. A set of squares (a bitboard) is a `Long`. It is
 * signed, so a set is shifted right with `ushr`.
 */
object Lock {
    // A Long literal stops at 0x7FFFFFFFFFFFFFFF (and ULong is experimental in Kotlin 1.3), so the
    // constants with the top bit set are parsed from their hex digits.
    private const val FILE_A = 0x0101010101010101L
    private val FILE_H = java.lang.Long.parseUnsignedLong("8080808080808080", 16)
    private const val RANK_1 = 0x00000000000000FFL
    private val RANK_8 = java.lang.Long.parseUnsignedLong("FF00000000000000", 16)
    private val DARK = java.lang.Long.parseUnsignedLong("AA55AA55AA55AA55", 16)   // the dark squares; a1 is dark

    private fun north(s: Long): Long = s shl 8
    private fun south(s: Long): Long = s ushr 8
    private fun sideways(s: Long): Long = ((s shl 1) and FILE_A.inv()) or ((s ushr 1) and FILE_H.inv())
    private fun zone(s: Long): Long { val v = s or north(s) or south(s); return v or sideways(v) }  // s and every square next to it
    private fun diagonal(s: Long): Long = sideways(north(s) or south(s))                            // the squares diagonally next to s
    private fun count(s: Long): Int = java.lang.Long.bitCount(s)

    /** Every square reachable from g by steps north through squares of p. */
    private fun fillNorth(g: Long, p: Long): Long {
        val g1 = g or (p and (g shl 8))
        val p1 = p and (p shl 8)
        val g2 = g1 or (p1 and (g1 shl 16))
        val p2 = p1 and (p1 shl 16)
        return g2 or (p2 and (g2 shl 32))
    }

    /** Every square reachable from g by steps south through squares of p. */
    private fun fillSouth(g: Long, p: Long): Long {
        val g1 = g or (p and (g ushr 8))
        val p1 = p and (p ushr 8)
        val g2 = g1 or (p1 and (g1 ushr 16))
        val p2 = p1 and (p1 ushr 16)
        return g2 or (p2 and (g2 ushr 32))
    }

    /** What the lock detector reads from a position. */
    data class Pieces(
        val whitePawns: Long, val blackPawns: Long,
        val whiteKing: Long, val blackKing: Long,
        val whiteBishops: Long, val blackBishops: Long,
        val others: Long,          // knights, rooks and queens of both sides
        val enPassant: Boolean     // the side to move can capture en passant
    )

    /** The pieces of a FEN. The en passant square counts only if a pawn can capture onto it. */
    fun fromFen(fen: String): Pieces {
        val fields = fen.split(" ")
        var whitePawns = 0L
        var blackPawns = 0L
        var whiteKing = 0L
        var blackKing = 0L
        var whiteBishops = 0L
        var blackBishops = 0L
        var others = 0L
        var rank = 7
        var file = 0
        for (c in fields[0]) {
            if (c == '/') { rank--; file = 0; continue }
            if (c in '1'..'8') { file += c - '0'; continue }
            val sq = 1L shl (8 * rank + file++)
            when (c) {
                'P' -> whitePawns = whitePawns or sq
                'p' -> blackPawns = blackPawns or sq
                'K' -> whiteKing = whiteKing or sq
                'k' -> blackKing = blackKing or sq
                'B' -> whiteBishops = whiteBishops or sq
                'b' -> blackBishops = blackBishops or sq
                else -> others = others or sq   // N R Q n r q
            }
        }
        val whiteToMove = fields.size < 2 || fields[1] == "w"
        var enPassant = false
        if (fields.size > 3 && fields[3] != "-") {   // past the side to move and castling
            val target = 1L shl ((fields[3][0] - 'a') + 8 * (fields[3][1] - '1'))
            enPassant = if (whiteToMove) (sideways(south(target)) and whitePawns) != 0L
                        else (sideways(north(target)) and blackPawns) != 0L
        }
        return Pieces(whitePawns, blackPawns, whiteKing, blackKing, whiteBishops, blackBishops, others, enPassant)
    }

    /** Two bishops on squares of one colour (only a promotion makes them). */
    private fun twinBishops(b: Long): Boolean = count(b and DARK) > 1 || count(b and DARK.inv()) > 1

    /** Can White (white = true) or Black never be mated, by the lock detector? */
    fun cannotBeMated(p: Pieces, white: Boolean): Boolean {
        if (p.others != 0L || p.enPassant) return false
        if (twinBishops(p.whiteBishops) || twinBishops(p.blackBishops)) return false
        if (!leaks(p, white, 0L)) return true
        // A king may be frozen only if every square around it is held or attacked by a pawn.
        val held = p.whitePawns or p.blackPawns or sideways(north(p.whitePawns) or south(p.blackPawns))
        val kings = longArrayOf(p.whiteKing, p.blackKing)
        for (king in kings)
            if ((zone(king) and king.inv() and held.inv()) == 0L && !leaks(p, white, king)) return true
        return false
    }

    /** Does the structure leak to the king asked about, with the king `frozen` frozen (0: none)? */
    private fun leaks(p: Pieces, white: Boolean, frozen: Long): Boolean {
        val wp = p.whitePawns; val bp = p.blackPawns; val wk = p.whiteKing; val bk = p.blackKing
        val frozenWhite = (frozen and wk) != 0L
        val frozenBlack = !frozenWhite && frozen != 0L
        val nearFrozenBlack = if (frozenBlack) zone(bk) else 0L
        val nearFrozenWhite = if (frozenWhite) zone(wk) else 0L

        // Quick: the pawns' paths against the first walls already show a promotion or a capture.
        var wCone = fillNorth(wp, ((bp and wk.inv()) or frozen).inv())
        var bCone = fillSouth(bp, ((wp and bk.inv()) or frozen).inv())
        if (((wCone and RANK_8) or (bCone and RANK_1) or (north(sideways(wCone)) and bCone)) != 0L) return true

        // The cycle: walls -> pawns that can never move -> king reaches -> capture squares -> walls.
        var wFixed = wp; var bFixed = bp                // pawns that can never move      (shrink)
        var wKing = wk; var bKing = bk                  // squares each king may reach    (grow)
        var wTake = wk; var bTake = bk                  // squares where a side may take an enemy pawn (grow)
        var wWall = 0L.inv(); var bWall = 0L.inv()      // pawns the other side can never take, and the frozen king
        while (true) {
            val lastWWall = wWall; val lastBWall = bWall
            wWall = (wp and bTake.inv()) or frozen
            bWall = (bp and wTake.inv()) or frozen
            val newWFixed = wFixed and wWall and south(bWall or wFixed)
            val newBFixed = bFixed and bWall and north(wWall or bFixed)
            if (wWall == lastWWall && bWall == lastBWall && newWFixed == wFixed && newBFixed == bFixed)
                break
            // Both kings' reaches, flooded: never onto a fixed pawn, a square it attacks, or next to
            // the frozen king.
            val wMask = (newWFixed or sideways(south(newBFixed)) or nearFrozenBlack).inv()
            val bMask = (newBFixed or sideways(north(newWFixed)) or nearFrozenWhite).inv()
            var newWKing = wKing; var newBKing = bKing
            while (true) {
                val a = newWKing or (zone(newWKing) and wMask)
                val d = newBKing or (zone(newBKing) and bMask)
                if (a == newWKing && d == newBKing) break
                newWKing = a
                newBKing = d
            }
            if ((frozenWhite && newWKing != wk) || (frozenBlack && newBKing != bk))
                return true   // the frozen king can move
            // A side may take a pawn where its king goes, and on any square a pawn may walk into.
            var t = bTake or newBKing
            val newBTake = t or south(fillSouth(t and bWall.inv(), bWall.inv()))
            t = wTake or newWKing
            val newWTake = t or north(fillNorth(t and wWall.inv(), wWall.inv()))
            val changed = newWFixed != wFixed || newBFixed != bFixed || newWKing != wKing ||
                          newBKing != bKing || newWTake != wTake || newBTake != bTake
            wFixed = newWFixed; bFixed = newBFixed; wKing = newWKing; bKing = newBKing
            wTake = newWTake; bTake = newBTake
            if (!changed) break
        }

        // The pawns' cones: every square they may still reach.
        wCone = fillNorth(wp, bWall.inv())
        bCone = fillSouth(bp, wWall.inv())
        if (((wCone and RANK_8) or (bCone and RANK_1)) != 0L) return true   // a pawn can promote
        if ((north(sideways(wCone)) and bCone) != 0L) return true           // a pawn can capture
        // The bishops' reaches: every square they may reach, around the fixed pawns.
        var wBish = p.whiteBishops; var bBish = p.blackBishops; val open = (wFixed or bFixed).inv()
        while (true) {
            val a = wBish or (diagonal(wBish) and open)
            val d = bBish or (diagonal(bBish) and open)
            if (a == wBish && d == bBish) break
            wBish = a
            bBish = d
        }
        if (((diagonal(wBish) and bCone) or (diagonal(bBish) and wCone)) != 0L) return true   // a bishop meets a pawn's path

        // The mating net: can the other side's pawns and bishops catch the king asked about?
        val attack: Long
        val reach: Long
        val free: Long
        val spare: Long
        if (white) {
            attack = diagonal(bBish) or sideways(south(bCone))
            reach = wKing
            free = (wCone or zone(bKing) or attack).inv()   // never occupied, attacked or next to the mater
            spare = free and wBish.inv()                    // ... nor reached by the king's own bishops
        } else {
            attack = diagonal(wBish) or sideways(north(wCone))
            reach = bKing
            free = (bCone or zone(wKing) or attack).inv()
            spare = free and bBish.inv()
        }
        // A king next to a spare square, or with free squares beside it both ways, always has a flight.
        val flight = sideways(spare) or north(spare) or south(spare) or ((north(free) or south(free)) and sideways(free))
        return (attack and reach and flight.inv()) != 0L
    }
}
