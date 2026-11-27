/**
 * Mateless's lock detector, second version, in its simplest form.
 *
 * Can a side never be mated? The lock detector answers yes when pawns, kings and bishops (and
 * knights, rooks or queens boxed in by their own men) form a structure that no series of legal
 * moves can open (FIDE 5.2.2 dead position, 6.9 flag fall). It reads bitboards and the side to
 * move: it generates no move and searches nothing.
 *
 * The first version (../../scala/Lock.scala) grows each king's reach, the pawns that can never
 * move, and the squares where each side may take a pawn, until nothing changes; the structure leaks
 * if a pawn can promote or capture, a frozen king can move, a bishop can reach a pawn's path, or
 * the king asked about can reach a square the other side attacks without a sure flight. This
 * version keeps all of it and adds, each only where its situation is on the board:
 *   - open pawn pairs: a white and a black pawn on one file with one empty square between them;
 *     the reachable positions split into families by what the pair's pawns have done (neither
 *     moved, the white one stepped into the gap, the black one did), up to 3 pairs;
 *   - boxed knights, rooks and queens: a piece whose every step square holds one of its own men
 *     that never moves, and that no enemy king or bishop reaches, never moves nor falls; such a
 *     man is a fixed pawn, another boxed piece, a still bishop (every diagonal neighbour held so,
 *     and out of the enemy king's and bishops' reach) or the piece's own frozen king (its side
 *     with no castling right left and not standing where a castle leaves it beside its rook);
 *   - twin bishops: two bishops of one side on one colour no longer fail it; the mating net leaves
 *     out its second flight rule where they may hold both flights;
 *   - the stalemate guard: a pawn the enemy king may take stays a wall if taking it always
 *     stalemates its owner;
 *   - the check seed: a king in a pawn's check starts its reach from the squares it can step to;
 *   - the stuck mater: whatever the flagged side plays, the mater is left without a move;
 *   - the forced step: a king in a pawn's check with one legal move, a step: the lock of the
 *     position after it.
 * A possible en passant capture fails it at once. Sound, not complete: a structure it passes can
 * never be opened; one it fails may still be dead.
 *
 * Squares: a1 = 0, b1 = 1, ..., h8 = 63. A set of squares (a bitboard) is a `Long`. It is signed,
 * so a set is shifted right with `>>>`.
 */
object Lock {
  private val FileA = 0x0101010101010101L
  private val FileH = 0x8080808080808080L
  private val Rank1 = 0x00000000000000FFL
  private val Rank3 = 0x0000000000FF0000L
  private val Rank6 = 0x0000FF0000000000L
  private val Rank8 = 0xFF00000000000000L
  private val Dark = 0xAA55AA55AA55AA55L   // the dark squares; a1 is dark
  private val MaxPairs = 3                 // the most open pairs the families are split on (3^3 = 27)

  private def north(s: Long): Long = s << 8
  private def south(s: Long): Long = s >>> 8
  private def sideways(s: Long): Long = ((s << 1) & ~FileA) | ((s >>> 1) & ~FileH)
  private def zone(s: Long): Long = { val v = s | north(s) | south(s); v | sideways(v) }  // s and every square next to it
  private def steps(s: Long): Long = zone(s) & ~s                                         // the squares next to s
  private def diagonal(s: Long): Long = sideways(north(s) | south(s))                   // the squares diagonally next to s
  private def count(s: Long): Int = java.lang.Long.bitCount(s)

  /** The squares a knight on s goes to. */
  private def knight(s: Long): Long = {
    val one = sideways(s)
    val two = ((s << 2) & ~(FileA | (FileA << 1))) | ((s >>> 2) & ~(FileH | (FileH >>> 1)))
    north(north(one)) | south(south(one)) | north(two) | south(two)
  }

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

  /** Every square a king may reach from k through squares of m. */
  private def flood(k: Long, m: Long): Long = {
    var r = k
    var a = r | (zone(r) & m)
    while (a != r) { r = a; a = r | (zone(r) & m) }
    r
  }

  /** What the lock detector reads from a position. */
  final case class Pieces(
    whitePawns: Long, blackPawns: Long,
    whiteKing: Long, blackKing: Long,
    whiteBishops: Long, blackBishops: Long,
    whiteKnights: Long, blackKnights: Long,
    whiteRooks: Long, blackRooks: Long,
    whiteQueens: Long, blackQueens: Long,
    whiteToMove: Boolean,
    enPassant: Boolean,    // the side to move can capture en passant
    whiteCastles: Boolean = false,   // White has a castling right (its king and that rook in place)
    blackCastles: Boolean = false
  )

  /** What one level leaves for the mating net (and for the families after it). */
  private final case class Sets(wCone: Long, bCone: Long, wFixed: Long, bFixed: Long, wKing: Long, bKing: Long,
                                wBish: Long, bBish: Long, wTake: Long, bTake: Long)

  /** The inputs of a level beyond the position: see `level`. */
  private final case class Level(pawns: Option[(Long, Long)] = None, v: Long = 0L, start: Option[Array[Long]] = None,
                                 wx: Long = 0L, bx: Long = 0L, ws: Long = 0L, bs: Long = 0L, guard: Boolean = false)

  // What the families of the open pairs say at one level.
  private val FamilyLock = 0      // none of them leaks to the king asked about
  private val FamilyRefuted = 1   // family A (no pair's pawn has moved) leaks to it
  private val FamilyNone = 2      // another family leaks

  /** The pieces of a FEN. The en passant square counts only if a pawn can capture onto it. */
  def fromFen(fen: String): Pieces = {
    val fields = fen.split(" ")
    val sets = new Array[Long](128)
    var rank = 7
    var file = 0
    for (c <- fields(0)) {
      if (c == '/') { rank -= 1; file = 0 }
      else if (c >= '1' && c <= '8') file += c - '0'
      else { sets(c.toInt) |= 1L << (8 * rank + file); file += 1 }
    }
    val whiteToMove = fields.length < 2 || fields(1) == "w"
    var enPassant = false
    if (fields.length > 3 && fields(3) != "-") {   // past the side to move and castling
      val target = 1L << ((fields(3).charAt(0) - 'a') + 8 * (fields(3).charAt(1) - '1'))
      enPassant = if (whiteToMove) (sideways(south(target)) & sets('P')) != 0 else (sideways(north(target)) & sets('p')) != 0
    }
    // A castling right counts only with its king and a rook on the side's back rank.
    def castles(white: Boolean): Boolean = fields.length > 2 && fields(2).exists { c =>
      val back = if (white) Rank1 else Rank8
      val king = sets(if (white) 'K' else 'k') & back
      val kf = java.lang.Long.numberOfTrailingZeros(king) % 8
      val files = (0 until 64).filter(sq => ((sets(if (white) 'R' else 'r') & back) >>> sq & 1L) != 0).map(_ % 8)
      val up = c.toUpper
      c != '-' && c.isUpper == white && king != 0 &&
        (if (up == 'K') files.exists(_ > kf) else if (up == 'Q') files.exists(_ < kf) else files.contains(up - 'A') && up - 'A' != kf)
    }
    Pieces(sets('P'), sets('p'), sets('K'), sets('k'), sets('B'), sets('b'), sets('N'), sets('n'), sets('R'), sets('r'),
           sets('Q'), sets('q'), whiteToMove, enPassant, castles(true), castles(false))
  }

  /** Can White (white = true) or Black never be mated, by the lock detector? */
  def cannotBeMated(p: Pieces, white: Boolean): Boolean = forcedStep(p) match {
    case Some(after) => cannotBeMated(after, white)
    case None =>
      val wx = p.whiteKnights | p.whiteRooks | p.whiteQueens
      val bx = p.blackKnights | p.blackRooks | p.blackQueens
      if ((wx | bx) != 0) boxedLock(p, white, wx, bx)
      else if (p.enPassant) false
      else {
        val gaps = north(p.whitePawns) & south(p.blackPawns) & ~(p.whitePawns | p.blackPawns)
        levels(p).exists { frozen =>
          val f = if (gaps != 0) families(p, gaps, frozen, white) else FamilyNone
          // refuted: family A, the level with more walls, leaked; the level leaks too
          f == FamilyLock || (f != FamilyRefuted && level(p, frozen, Level(guard = true)).exists(s => !netLeaks(p, s, white, 0L)))
        } || stuckMater(p, white)
      }
  }

  /** The levels: both kings free (0), then each king frozen on its square (a wall for both sides)
      when every square around it is held or attacked by a pawn (or holds one of its own pieces,
      wOwn or bOwn, where boxed pieces are on the board). */
  private def levels(p: Pieces, wOwn: Long = 0L, bOwn: Long = 0L): List[Long] = {
    val held = p.whitePawns | p.blackPawns | sideways(north(p.whitePawns) | south(p.blackPawns))
    0L :: List((p.whiteKing, wOwn), (p.blackKing, bOwn)).collect { case (king, own) if (steps(king) & ~(held | own)) == 0 => king }
  }

  /** May this side's king hold a boxed piece's step square (when frozen)? Not with a castling
      right left (a castling rook may stand beside its king, in Chess960, and castling moves it), and
      not where a castle leaves it beside its rook (g1 with a rook on f1, c1 with one on d1; g8, f8,
      c8, d8): a castle leaves the halfmove clock as it is, so the lock is not asked after one. */
  private def kingWall(p: Pieces, white: Boolean): Boolean = {
    val (king, rooks, castles, g, c) =
      if (white) (p.whiteKing, p.whiteRooks, p.whiteCastles, 1L << 6, 1L << 2)
      else (p.blackKing, p.blackRooks, p.blackCastles, 1L << 62, 1L << 58)
    !castles && (rooks & (((king & g) >>> 1) | ((king & c) << 1))) == 0
  }

  /** The still bishops among b: every diagonal neighbour held for good (held: fixed pawns and
      boxed pieces of their colour) or by another still bishop, and out of the enemy king's and
      bishops' reach. Such a bishop never moves and is never taken (a pawn taking it fails the
      bishop contact test). The largest such set. */
  @annotation.tailrec
  private def stillBishops(b: Long, held: Long, reach: Long): Long = {
    val s = b & ~reach
    var n = 0L
    var m = s
    while (m != 0) {
      val q = m & -m
      if ((diagonal(q) & ~(held | s)) == 0) n |= q
      m ^= q
    }
    if (n == s) s else stillBishops(n, held, reach)
  }

  /**
   * One level: the fixed point of the walls, the pawns that can never move, the kings' reaches,
   * the squares where each side may take a pawn, the pawns' cones and the bishops' reaches. The
   * sets the mating net reads, or None when the structure leaks whichever side is asked about.
   * o.pawns: the pawns (a family has a pair's pawn moved into its gap); o.v: walls for both sides
   * (the gaps of a family's pairs that stay); o.start: where the kings' reaches, capture squares
   * and bishops' reaches start (a family's); o.wx, bx, ws, bs: the boxed pieces' candidates and
   * their step squares; o.guard: the stalemate guard and the check seed (plain levels only).
   */
  private def level(p: Pieces, frozen: Long, o: Level): Option[Sets] = {
    val (wp, bp) = o.pawns.getOrElse((p.whitePawns, p.blackPawns))
    val wk = p.whiteKing
    val bk = p.blackKing
    val wx = o.wx
    val bx = o.bx
    val v = o.v | frozen
    val frozenWhite = (frozen & wk) != 0
    val frozenBlack = !frozenWhite && frozen != 0
    val nearFrozenBlack = if (frozenBlack) zone(bk) else 0L
    val nearFrozenWhite = if (frozenWhite) zone(wk) else 0L
    val (wSeed, bSeed) = if (o.guard && frozen == 0) checkSeed(p) else (wk, bk)
    val start = o.start.getOrElse(Array(wSeed, bSeed, wSeed, bSeed, p.whiteBishops, p.blackBishops))
    var wKing = start(0)
    var bKing = start(1)
    var wTake = start(2)
    var bTake = start(3)
    var wBish = start(4)
    var bBish = start(5)
    var wCone = wp
    var bCone = bp
    var wFixed = wp
    var bFixed = bp
    var wGuard = if (o.guard) -1L else 0L   // nothing is taken yet
    var bGuard = if (o.guard) -1L else 0L
    var changed = true
    while (changed) {
      // Boxed: the pieces no enemy king or bishop reaches. Walls: pawns the other side can never
      // take (or whose capture stalemates their owner), the frozen king, the gaps, boxed pieces.
      val boxed = (wx & ~(bKing | bBish)) | (bx & ~(wKing | wBish))
      val wWall = (wp & ~(bTake & ~wGuard)) | v | boxed
      val bWall = (bp & ~(wTake & ~bGuard)) | v | boxed
      val nwFixed = wFixed & wWall & south(bWall | wFixed)
      val nbFixed = bFixed & bWall & north(wWall | bFixed)
      val nwCone = fillNorth(wCone, ~bWall)
      val nbCone = fillSouth(bCone, ~wWall)
      // The kings: never onto a fixed pawn, a square it attacks, or next to the frozen king; with
      // boxed pieces on the board, never onto its own boxed pieces and still bishops either.
      val bHit = sideways(south(nbFixed))
      val wHit = sideways(north(nwFixed))
      val wStill = if ((wx | bx) != 0) stillBishops(p.whiteBishops, nwFixed | (wx & boxed), bKing | bBish) else 0L
      val bStill = if ((wx | bx) != 0) stillBishops(p.blackBishops, nbFixed | (bx & boxed), wKing | wBish) else 0L
      val nwKing = flood(wKing, ~(nwFixed | bHit | nearFrozenBlack | (wx & boxed) | wStill))
      val nbKing = flood(bKing, ~(nbFixed | wHit | nearFrozenWhite | (bx & boxed) | bStill))
      var nwBish = wBish
      var nbBish = bBish
      val open = ~(nwFixed | nbFixed)
      var growing = true
      while (growing) {
        val a = nwBish | (diagonal(nwBish) & open)
        val d = nbBish | (diagonal(nbBish) & open)
        growing = a != nwBish || d != nbBish
        nwBish = a
        nbBish = d
      }
      // A side may take a pawn where its king goes, and on any square a pawn may walk into.
      val tb = bTake | nbKing
      val nbTake = tb | south(fillSouth(tb & ~bWall, ~bWall))
      val tw = wTake | nwKing
      val nwTake = tw | north(fillNorth(tw & ~wWall, ~wWall))
      var nwGuard = wGuard
      var nbGuard = bGuard
      if (o.guard) {
        val block = nwFixed | nbFixed
        val wHasB = p.whiteBishops != 0
        val bHasB = p.blackBishops != 0
        nwGuard = if (wHasB) 0L else stalemateGuard(wp & nbTake & nwFixed, wp, nwFixed, nwKing, nwFixed | bHit, nbKing, bHasB, block)
        nbGuard = if (bHasB) 0L else stalemateGuard(bp & nwTake & nbFixed, bp, nbFixed, nbKing, nbFixed | wHit, nwKing, wHasB, block)
      }
      changed = nwCone != wCone || nbCone != bCone || nwFixed != wFixed || nbFixed != bFixed ||
        nwKing != wKing || nbKing != bKing || nwBish != wBish || nbBish != bBish ||
        nwTake != wTake || nbTake != bTake || nwGuard != wGuard || nbGuard != bGuard
      wCone = nwCone; bCone = nbCone; wFixed = nwFixed; bFixed = nbFixed; wKing = nwKing; bKing = nbKing
      wBish = nwBish; bBish = nbBish; wTake = nwTake; bTake = nbTake; wGuard = nwGuard; bGuard = nbGuard
    }
    val boxed = (wx & ~(bKing | bBish)) | (bx & ~(wKing | wBish))
    // A piece may step: a step square not held by a fixed pawn, a boxed piece or a still bishop of
    // its colour, or by its frozen king (where the king may be a wall).
    val wStill = if ((wx | bx) != 0) stillBishops(p.whiteBishops, wFixed | (wx & boxed), bKing | bBish) else 0L
    val bStill = if ((wx | bx) != 0) stillBishops(p.blackBishops, bFixed | (bx & boxed), wKing | wBish) else 0L
    val wKw = if (frozenWhite && kingWall(p, true)) wk else 0L
    val bKw = if (frozenBlack && kingWall(p, false)) bk else 0L
    if (((wCone & Rank8) | (bCone & Rank1)) != 0) None                                           // a pawn can promote
    else if (((north(sideways(wCone)) & (bCone | bx)) | (south(sideways(bCone)) & wx)) != 0) None  // a pawn can capture
    else if ((frozenWhite && wKing != wk) || (frozenBlack && bKing != bk)) None                 // the frozen king can move
    else if (((diagonal(wBish) & bCone) | (diagonal(bBish) & wCone)) != 0) None                  // a bishop meets a pawn's path
    else if (((o.ws & ~(wFixed | (wx & boxed) | wStill | wKw)) | (o.bs & ~(bFixed | (bx & boxed) | bStill | bKw))) != 0) None  // a piece may step
    else {
      if ((wGuard | bGuard) != 0) {
        // A king that takes a guarded pawn ends the game: for the mating net, the kings' reaches
        // again, now stopping at the enemy's guarded pawns.
        wKing = flood(wSeed, ~(wFixed | sideways(south(bFixed)) | nearFrozenBlack | (bp & bGuard)))
        bKing = flood(bSeed, ~(bFixed | sideways(north(wFixed)) | nearFrozenWhite | (wp & wGuard)))
      }
      Some(Sets(wCone, bCone, wFixed, bFixed, wKing, bKing, wBish, bBish, wTake, bTake))
    }
  }

  /** The mating net: can the other side's pawns and bishops catch the king asked about? occ:
      squares that stand occupied for good besides (the boxed pieces'). */
  private def netLeaks(p: Pieces, s: Sets, white: Boolean, occ: Long): Boolean = {
    val (attack, reach, free, spare, twins) =
      if (white) {
        val attack = diagonal(s.bBish) | sideways(south(s.bCone))
        val free = ~(s.wCone | occ | zone(s.bKing) | attack)   // never occupied, attacked or next to the mater
        (attack, s.wKing, free, free & ~s.wBish, p.whiteBishops)   // spare: ... nor reached by the king's own bishops
      } else {
        val attack = diagonal(s.wBish) | sideways(north(s.wCone))
        val free = ~(s.bCone | occ | zone(s.wKing) | attack)
        (attack, s.bKing, free, free & ~s.bBish, p.blackBishops)
      }
    // A king next to a spare square, or with free squares beside it both ways, always has a flight.
    // The second rule counts on at most one of the king's own bishops on the colour of those two
    // squares (the colour opposite the king's): not on the king squares where it has two or more.
    val noPair = (if (count(twins & Dark) > 1) ~Dark else 0L) | (if (count(twins & ~Dark) > 1) Dark else 0L)
    val flight = sideways(spare) | north(spare) | south(spare) |
      ((north(free) | south(free)) & sideways(free) & ~noPair)
    (attack & reach & ~flight) != 0
  }

  /** The check seed: the side to move is in a pawn's check, so its king must step now, to a square
      it can step to (not its own pawn, not a square an enemy pawn attacks, not next to the enemy
      king); its reach starts there. Not when it has no such square (that may be a mate now), when
      one of its pawns can take a checking pawn, or with a bishop on the board. The kings' starting
      sets. */
  private def checkSeed(p: Pieces): (Long, Long) = {
    val wp = p.whitePawns
    val bp = p.blackPawns
    val wk = p.whiteKing
    val bk = p.blackKing
    val white = p.whiteToMove
    val k = if (white) wk else bk
    val own = if (white) wp else bp
    val checkers = if (white) sideways(north(k)) & bp else sideways(south(k)) & wp
    if ((p.whiteBishops | p.blackBishops) != 0 || checkers == 0) (wk, bk)
    else {
      val attacked = if (white) sideways(south(bp)) else sideways(north(wp))
      val to = steps(k) & ~own & ~attacked & ~steps(if (white) bk else wk)
      val takers = (if (white) sideways(south(checkers)) else sideways(north(checkers))) & own
      if (to == 0 || takers != 0) (wk, bk) else if (white) (to, bk) else (wk, to)
    }
  }

  /** The stalemate guard: of the owner's fixed pawns cand (which the enemy king may take), those
      whose capture always stalemates the owner. The owner must have nothing else that moves (every
      other pawn fixed; no bishop, which the caller sees to). reach: where the owner's king may
      stand; shut: squares it can never step to (own fixed pawns, squares the enemy's fixed pawns
      attack); enemyKing: the enemy king's reach; block: squares a bishop's line never crosses. */
  private def stalemateGuard(cand: Long, own: Long, ownFixed: Long, reach: Long, shut: Long, enemyKing: Long,
                             enemyBishops: Boolean, block: Long): Long = {
    if ((own & ~ownFixed) != 0) 0L
    else {
      var guard = 0L
      var c = cand
      while (c != 0) {
        val pawn = c & -c
        c &= c - 1
        val near = steps(pawn)
        val from = near & enemyKing     // where the enemy king takes from
        val x = shut | near | pawn      // after the capture, the owner's king may not step there
        var held = true
        var k = reach & ~(near | pawn)  // the owner's king, not defending the pawn
        while (held && k != 0) {
          val king = k & -k
          k &= k - 1
          // it has a square to step to, or the capture uncovers a check
          if ((steps(king) & ~x) != 0 || (enemyBishops && rayMeets(king, block | pawn, from))) held = false
        }
        if (held) guard |= pawn
      }
      guard
    }
  }

  /** Does a diagonal line from the square king, stopped by block, meet a square of o? */
  private def rayMeets(king: Long, block: Long, o: Long): Boolean = {
    val sq = java.lang.Long.numberOfTrailingZeros(king)
    List((-1, -1), (1, -1), (-1, 1), (1, 1)).exists { case (df, dr) =>
      var f = (sq & 7) + df
      var r = (sq >> 3) + dr
      var met = false
      var stopped = false
      while (!met && !stopped && f >= 0 && f < 8 && r >= 0 && r < 8) {
        val s = 1L << (8 * r + f)
        if ((o & s) != 0) met = true
        else if ((block & s) != 0) stopped = true
        f += df
        r += dr
      }
      met
    }
  }

  /** The families of the open pairs at one level. */
  private def families(p: Pieces, gaps: Long, frozen: Long, white: Boolean): Int = {
    val pairs = scala.collection.mutable.ArrayBuffer[Array[Long]]()   // per pair: the gap, the white pawn below it, the black pawn above it
    var g = gaps
    while (g != 0) { val gap = g & -g; g &= g - 1; pairs += Array(gap, south(gap), north(gap)) }
    if (pairs.length > MaxPairs) FamilyNone
    else {
      val k = pairs.length
      val n = (1 to k).foldLeft(1)((a, _) => a * 3)
      val sets = scala.collection.mutable.ArrayBuffer[Sets]()
      var result = FamilyLock
      var f = 0
      while (result == FamilyLock && f < n) {
        // Family f: digit i (base 3) says what pair i's pawns have done: 0 neither, 1 the white one
        // stepped into the gap, 2 the black one did. Its sets start from those of the family it is
        // reached from (the same with pair i's pawns in place), minus the gap.
        var wp = p.whitePawns
        var bp = p.blackPawns
        var v = 0L
        val start = if (f == 0) Array(p.whiteKing, p.blackKing, p.whiteKing, p.blackKing, p.whiteBishops, p.blackBishops)
                    else new Array[Long](6)
        var q = f
        var pow = 1
        for (i <- 0 until k) {
          val d = q % 3
          val gap = pairs(i)(0)
          if (d == 0) v |= gap   // the gap stays: a wall for both sides' pawns
          else {
            if (d == 1) wp = (wp & ~pairs(i)(1)) | gap else bp = (bp & ~pairs(i)(2)) | gap
            val r = sets(f - d * pow)
            start(0) |= r.wKing & ~gap
            start(1) |= r.bKing & ~gap
            start(2) |= r.wTake
            start(3) |= r.bTake
            start(4) |= r.wBish & ~gap
            start(5) |= r.bBish & ~gap
          }
          q /= 3
          pow *= 3
        }
        level(p, frozen, Level(pawns = Some((wp, bp)), v = v, start = Some(start))) match {
          case None => result = if (f == 0) FamilyRefuted else FamilyNone
          case Some(s) =>
            // The pairs that stay: both pawns must never move.
            var stay = true
            var qq = f
            for (i <- 0 until k) {
              if (qq % 3 == 0 && ((pairs(i)(1) & ~s.wFixed) | (pairs(i)(2) & ~s.bFixed)) != 0) stay = false
              qq /= 3
            }
            if (!stay) result = FamilyNone
            else if (netLeaks(p, s, white, 0L)) result = if (f == 0) FamilyRefuted else FamilyNone
            else sets += s
        }
        f += 1
      }
      result
    }
  }

  /** The step squares of one side's knights, rooks (and queens: o) and queens. */
  private def boxSteps(knights: Long, o: Long, queens: Long): Long =
    sideways(o) | north(o) | south(o) | diagonal(queens) | knight(knights)

  /** With knights, rooks or queens on the board: every one of them must be boxed in by its own
      pawns and pieces (bishops and the king among them: the level checks that they never move);
      then the levels, with the boxed pieces as walls and no flight onto their squares. */
  private def boxedLock(p: Pieces, white: Boolean, wx: Long, bx: Long): Boolean = {
    val ws = boxSteps(p.whiteKnights, p.whiteRooks | p.whiteQueens, p.whiteQueens)
    val bs = boxSteps(p.blackKnights, p.blackRooks | p.blackQueens, p.blackQueens)
    val wOwn = p.whitePawns | wx | p.whiteBishops | (if (kingWall(p, true)) p.whiteKing else 0L)
    val bOwn = p.blackPawns | bx | p.blackBishops | (if (kingWall(p, false)) p.blackKing else 0L)
    (ws & ~wOwn) == 0 && (bs & ~bOwn) == 0 && !p.enPassant &&
      levels(p, wx | p.whiteBishops, bx | p.blackBishops).exists(frozen => level(p, frozen, Level(wx = wx, bx = bx, ws = ws, bs = bs)).exists(s => !netLeaks(p, s, white, wx | bx)))
  }

  /** The stuck mater: the flagged side is to move and, whatever it plays, the mater has no legal
      move left (kings and pawns only): the game ends at the mater's turn. */
  private def stuckMater(p: Pieces, white: Boolean): Boolean = {
    if (p.whiteToMove != white || p.enPassant) return false
    if ((p.whiteBishops | p.blackBishops | p.whiteKnights | p.blackKnights | p.whiteRooks |
         p.blackRooks | p.whiteQueens | p.blackQueens) != 0) return false
    val fp = if (white) p.whitePawns else p.blackPawns
    val mp = if (white) p.blackPawns else p.whitePawns
    val fk = if (white) p.whiteKing else p.blackKing
    val mk = if (white) p.blackKing else p.whiteKing
    val occ = fp | mp | fk | mk
    def fwd(s: Long): Long = if (white) north(s) else south(s)    // ahead, for the flagged side
    def back(s: Long): Long = if (white) south(s) else north(s)   // behind
    // A mater's pawn with an empty square ahead is never stuck; then only a stalemate now is left
    // to find, which a flagged pawn's push rules out.
    if ((back(mp) & ~occ) != 0 && (fwd(fp) & ~occ) != 0) return false
    val fAttack = sideways(fwd(fp))
    val mAttack = sideways(back(mp))
    if ((fAttack & (mp | mk)) != 0) return false                        // 1. the flagged side has no capture
    val single = fwd(fp) & ~occ
    val double = fwd(single & (if (white) Rank3 else Rank6)) & ~occ
    val pushes = single | double
    val near = steps(mk)
    val kingTo = steps(fk) & ~fp & ~mAttack & ~near                       // the flagged king's steps now
    val inCheck = (fk & mAttack) != 0
    if (inCheck && kingTo == 0) return false                              // mated now
    val stays = pushes != 0 && !inCheck                                   // a pawn may move instead of the king
    if (kingTo == 0 && !stays) return true                                // no move, no check: stalemate now
    // The squares next to every square the flagged king may stand on after its move.
    var cover = if (stays) steps(fk) else -1L
    var k = kingTo
    while (k != 0) { cover &= steps(k & -k); k &= k - 1 }
    // 2. the mater's pawns are blocked by men that stay, and attack no flagged pawn
    val blockers = fp | mp | mk | (if (kingTo == 0) fk else 0L)
    if (((back(mp) & ~blockers) | (mAttack & fp)) != 0) return false
    // 3. every square next to the mater's king: its own pawn, attacked by a flagged pawn that
    //    cannot move now, or next to the flagged king wherever it goes
    val still = fp & back(fwd(fp) & occ)
    if ((near & ~(mp | sideways(fwd(still)) | cover)) != 0) return false
    // 4. no push lands where a mater's pawn attacks or next to its king, nor lets it take en passant
    ((pushes & (mAttack | near)) | (double & sideways(mp))) == 0
  }

  /** The forced step: the side to move is in a pawn's check, with kings and pawns only, and its
      one legal move is a step of its king. The position after it, or None. */
  private def forcedStep(p: Pieces): Option[Pieces] = {
    val white = p.whiteToMove
    val k = if (white) p.whiteKing else p.blackKing
    val ek = if (white) p.blackKing else p.whiteKing
    val own = if (white) p.whitePawns else p.blackPawns
    val enemy = if (white) p.blackPawns else p.whitePawns
    val checkers = (if (white) sideways(north(k)) else sideways(south(k))) & enemy
    val attacked = if (white) sideways(south(enemy)) else sideways(north(enemy))
    val to = steps(k) & ~own & ~attacked & ~steps(ek)
    val takers = (if (white) sideways(south(checkers)) else sideways(north(checkers))) & own   // a pawn may take instead
    if (p.enPassant || (p.whiteBishops | p.blackBishops | p.whiteKnights | p.blackKnights | p.whiteRooks |
                        p.blackRooks | p.whiteQueens | p.blackQueens) != 0 || checkers == 0 || count(to) != 1 || takers != 0) None
    else if (white) Some(p.copy(whiteKing = to, blackPawns = p.blackPawns & ~to, whiteToMove = false, enPassant = false))
    else Some(p.copy(blackKing = to, whitePawns = p.whitePawns & ~to, whiteToMove = true, enPassant = false))
  }
}
