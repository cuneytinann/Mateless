/** Mateless's lock detector, in its simplest form.
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
 * Squares: a1 = 0, b1 = 1, ..., h8 = 63. A set of squares (a bitboard) is a `Long`. It is signed,
 * so a set is shifted right with `>>>`.
 */
object Lock {
  private val FileA = 0x0101010101010101L
  private val FileH = 0x8080808080808080L
  private val Rank1 = 0x00000000000000FFL
  private val Rank8 = 0xFF00000000000000L
  private val Dark = 0xAA55AA55AA55AA55L   // the dark squares; a1 is dark

  private def north(s: Long): Long = s << 8
  private def south(s: Long): Long = s >>> 8
  private def sideways(s: Long): Long = ((s << 1) & ~FileA) | ((s >>> 1) & ~FileH)
  private def zone(s: Long): Long = { val v = s | north(s) | south(s); v | sideways(v) }  // s and every square next to it
  private def diagonal(s: Long): Long = sideways(north(s) | south(s))                   // the squares diagonally next to s
  private def count(s: Long): Int = java.lang.Long.bitCount(s)

  /** Every square reachable from g by steps north through squares of p. */
  private def fillNorth(g: Long, p: Long): Long = {
    val g1 = g | (p & (g << 8))
    val p1 = p & (p << 8)
    val g2 = g1 | (p1 & (g1 << 16))
    val p2 = p1 & (p1 << 16)
    g2 | (p2 & (g2 << 32))
  }

  /** Every square reachable from g by steps south through squares of p. */
  private def fillSouth(g: Long, p: Long): Long = {
    val g1 = g | (p & (g >>> 8))
    val p1 = p & (p >>> 8)
    val g2 = g1 | (p1 & (g1 >>> 16))
    val p2 = p1 & (p1 >>> 16)
    g2 | (p2 & (g2 >>> 32))
  }

  /** What the lock detector reads from a position. */
  final case class Pieces(
    whitePawns: Long, blackPawns: Long,
    whiteKing: Long, blackKing: Long,
    whiteBishops: Long, blackBishops: Long,
    others: Long,          // knights, rooks and queens of both sides
    enPassant: Boolean     // the side to move can capture en passant
  )

  /** The pieces of a FEN. The en passant square counts only if a pawn can capture onto it. */
  def fromFen(fen: String): Pieces = {
    val fields = fen.split(" ")
    var whitePawns, blackPawns, whiteKing, blackKing, whiteBishops, blackBishops, others = 0L
    var rank = 7
    var file = 0
    for (c <- fields(0)) {
      if (c == '/') { rank -= 1; file = 0 }
      else if (c >= '1' && c <= '8') file += c - '0'
      else {
        val sq = 1L << (8 * rank + file)
        file += 1
        c match {
          case 'P' => whitePawns |= sq
          case 'p' => blackPawns |= sq
          case 'K' => whiteKing |= sq
          case 'k' => blackKing |= sq
          case 'B' => whiteBishops |= sq
          case 'b' => blackBishops |= sq
          case _ => others |= sq   // N R Q n r q
        }
      }
    }
    val whiteToMove = fields.length < 2 || fields(1) == "w"
    var enPassant = false
    if (fields.length > 3 && fields(3) != "-") {   // past the side to move and castling
      val target = 1L << ((fields(3).charAt(0) - 'a') + 8 * (fields(3).charAt(1) - '1'))
      enPassant = if (whiteToMove) (sideways(south(target)) & whitePawns) != 0L
                  else (sideways(north(target)) & blackPawns) != 0L
    }
    Pieces(whitePawns, blackPawns, whiteKing, blackKing, whiteBishops, blackBishops, others, enPassant)
  }

  /** Two bishops on squares of one colour (only a promotion makes them). */
  private def twinBishops(b: Long): Boolean = count(b & Dark) > 1 || count(b & ~Dark) > 1

  /** Can White (white = true) or Black never be mated, by the lock detector? */
  def cannotBeMated(p: Pieces, white: Boolean): Boolean = {
    if (p.others != 0L || p.enPassant) return false
    if (twinBishops(p.whiteBishops) || twinBishops(p.blackBishops)) return false
    if (!leaks(p, white, 0L)) return true
    // A king may be frozen only if every square around it is held or attacked by a pawn.
    val held = p.whitePawns | p.blackPawns | sideways(north(p.whitePawns) | south(p.blackPawns))
    val kings = Array(p.whiteKing, p.blackKing)
    var i = 0
    while (i < 2) {
      if ((zone(kings(i)) & ~kings(i) & ~held) == 0L && !leaks(p, white, kings(i))) return true
      i += 1
    }
    false
  }

  /** Does the structure leak to the king asked about, with the king `frozen` frozen (0: none)? */
  private def leaks(p: Pieces, white: Boolean, frozen: Long): Boolean = {
    val wp = p.whitePawns; val bp = p.blackPawns; val wk = p.whiteKing; val bk = p.blackKing
    val frozenWhite = (frozen & wk) != 0L
    val frozenBlack = !frozenWhite && frozen != 0L
    val nearFrozenBlack = if (frozenBlack) zone(bk) else 0L
    val nearFrozenWhite = if (frozenWhite) zone(wk) else 0L

    // Quick: the pawns' paths against the first walls already show a promotion or a capture.
    var wCone = fillNorth(wp, ~((bp & ~wk) | frozen))
    var bCone = fillSouth(bp, ~((wp & ~bk) | frozen))
    if (((wCone & Rank8) | (bCone & Rank1) | (north(sideways(wCone)) & bCone)) != 0L) return true

    // The cycle: walls -> pawns that can never move -> king reaches -> capture squares -> walls.
    var wFixed = wp; var bFixed = bp     // pawns that can never move      (shrink)
    var wKing = wk; var bKing = bk       // squares each king may reach    (grow)
    var wTake = wk; var bTake = bk       // squares where a side may take an enemy pawn (grow)
    var wWall = ~0L; var bWall = ~0L     // pawns the other side can never take, and the frozen king
    var cycling = true
    while (cycling) {
      val lastWWall = wWall; val lastBWall = bWall
      wWall = (wp & ~bTake) | frozen
      bWall = (bp & ~wTake) | frozen
      val newWFixed = wFixed & wWall & south(bWall | wFixed)
      val newBFixed = bFixed & bWall & north(wWall | bFixed)
      if (wWall == lastWWall && bWall == lastBWall && newWFixed == wFixed && newBFixed == bFixed) {
        cycling = false
      } else {
        // Both kings' reaches, flooded: never onto a fixed pawn, a square it attacks, or next to
        // the frozen king.
        val wMask = ~(newWFixed | sideways(south(newBFixed)) | nearFrozenBlack)
        val bMask = ~(newBFixed | sideways(north(newWFixed)) | nearFrozenWhite)
        var newWKing = wKing; var newBKing = bKing
        var flooding = true
        while (flooding) {
          val a = newWKing | (zone(newWKing) & wMask)
          val d = newBKing | (zone(newBKing) & bMask)
          if (a == newWKing && d == newBKing) flooding = false
          else {
            newWKing = a
            newBKing = d
          }
        }
        if ((frozenWhite && newWKing != wk) || (frozenBlack && newBKing != bk))
          return true   // the frozen king can move
        // A side may take a pawn where its king goes, and on any square a pawn may walk into.
        var t = bTake | newBKing
        val newBTake = t | south(fillSouth(t & ~bWall, ~bWall))
        t = wTake | newWKing
        val newWTake = t | north(fillNorth(t & ~wWall, ~wWall))
        val changed = newWFixed != wFixed || newBFixed != bFixed || newWKing != wKing ||
                      newBKing != bKing || newWTake != wTake || newBTake != bTake
        wFixed = newWFixed; bFixed = newBFixed; wKing = newWKing; bKing = newBKing
        wTake = newWTake; bTake = newBTake
        if (!changed) cycling = false
      }
    }

    // The pawns' cones: every square they may still reach.
    wCone = fillNorth(wp, ~bWall)
    bCone = fillSouth(bp, ~wWall)
    if (((wCone & Rank8) | (bCone & Rank1)) != 0L) return true   // a pawn can promote
    if ((north(sideways(wCone)) & bCone) != 0L) return true      // a pawn can capture
    // The bishops' reaches: every square they may reach, around the fixed pawns.
    var wBish = p.whiteBishops; var bBish = p.blackBishops; val openSquares = ~(wFixed | bFixed)
    var spreading = true
    while (spreading) {
      val a = wBish | (diagonal(wBish) & openSquares)
      val d = bBish | (diagonal(bBish) & openSquares)
      if (a == wBish && d == bBish) spreading = false
      else {
        wBish = a
        bBish = d
      }
    }
    if (((diagonal(wBish) & bCone) | (diagonal(bBish) & wCone)) != 0L) return true   // a bishop meets a pawn's path

    // The mating net: can the other side's pawns and bishops catch the king asked about?
    var attack, reach, free, spare = 0L
    if (white) {
      attack = diagonal(bBish) | sideways(south(bCone))
      reach = wKing
      free = ~(wCone | zone(bKing) | attack)   // never occupied, attacked or next to the mater
      spare = free & ~wBish                    // ... nor reached by the king's own bishops
    } else {
      attack = diagonal(wBish) | sideways(north(wCone))
      reach = bKing
      free = ~(bCone | zone(wKing) | attack)
      spare = free & ~bBish
    }
    // A king next to a spare square, or with free squares beside it both ways, always has a flight.
    val flight = sideways(spare) | north(spare) | south(spare) | ((north(free) | south(free)) & sideways(free))
    (attack & reach & ~flight) != 0L
  }
}
