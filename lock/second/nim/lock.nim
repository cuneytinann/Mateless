## Mateless's lock detector, second version, in its simplest form.
##
## Can a side never be mated? The lock detector answers yes when pawns, kings and bishops (and
## knights, rooks or queens boxed in by their own men) form a structure that no series of legal
## moves can open (FIDE 5.2.2 dead position, 6.9 flag fall). It reads bitboards and the side to
## move: it generates no move and searches nothing.
##
## The first version (../../nim/lock.nim) grows each king's reach, the pawns that can never move,
## and the squares where each side may take a pawn, until nothing changes; the structure leaks if a
## pawn can promote or capture, a frozen king can move, a bishop can reach a pawn's path, or the
## king asked about can reach a square the other side attacks without a sure flight. This version
## keeps all of it and adds, each only where its situation is on the board:
##   - open pawn pairs: a white and a black pawn on one file with one empty square between them;
##     the reachable positions split into families by what the pair's pawns have done (neither
##     moved, the white one stepped into the gap, the black one did), up to 3 pairs;
##   - boxed knights, rooks and queens: a piece whose every step square holds one of its own men
##     that never moves, and that no enemy king or bishop reaches, never moves nor falls; such a man
##     is a fixed pawn, another boxed piece, a still bishop (every diagonal neighbour held so, and out
##     of the enemy king's and bishops' reach) or the piece's own frozen king (its side with no
##     castling right left and not standing where a castle leaves it beside its rook);
##   - twin bishops: two bishops of one side on one colour no longer fail it; the mating net leaves
##     out its second flight rule where they may hold both flights;
##   - the stalemate guard: a pawn the enemy king may take stays a wall if taking it always
##     stalemates its owner;
##   - the check seed: a king in a pawn's check starts its reach from the squares it can step to;
##   - the stuck mater: whatever the flagged side plays, the mater is left without a move;
##   - the forced step: a king in a pawn's check with one legal move, a step: the lock of the
##     position after it.
## A possible en passant capture fails it at once. Sound, not complete: a structure it passes can
## never be opened; one it fails may still be dead.
##
## Squares: a1 = 0, b1 = 1, ..., h8 = 63. A set of squares (a bitboard) is a uint64.

import std/[bitops, options, strutils]

type
  Pieces* = object
    ## What the lock detector reads from a position.
    whitePawns*, blackPawns*: uint64
    whiteKing*, blackKing*: uint64
    whiteBishops*, blackBishops*: uint64
    whiteKnights*, blackKnights*: uint64
    whiteRooks*, blackRooks*: uint64
    whiteQueens*, blackQueens*: uint64
    whiteToMove*: bool
    enPassant*: bool   ## the side to move can capture en passant
    whiteCastles*: bool   ## White has a castling right (its king and that rook in place)
    blackCastles*: bool

  Sets = object
    ## What one level leaves for the mating net (and for the families after it).
    wCone, bCone, wFixed, bFixed, wKing, bKing, wBish, bBish, wTake, bTake: uint64

  LevelIn = object
    ## The inputs of a level beyond the position: see level.
    family: bool                 # wp, bp and start below are a family's
    wp, bp, v: uint64
    start: array[6, uint64]
    wx, bx, ws, bs: uint64
    guard: bool

  Family = enum
    ## What the families of the open pairs say at one level.
    familyLock,      # none of them leaks to the king asked about
    familyRefuted,   # family A (no pair's pawn has moved) leaks to it
    familyNone       # another family leaks

const
  fileA = 0x0101010101010101'u64
  fileH = 0x8080808080808080'u64
  rank1 = 0x00000000000000FF'u64
  rank3 = 0x0000000000FF0000'u64
  rank6 = 0x0000FF0000000000'u64
  rank8 = 0xFF00000000000000'u64
  dark = 0xAA55AA55AA55AA55'u64   # the dark squares; a1 is dark
  maxPairs = 3                    # the most open pairs the families are split on (3^3 = 27)

proc north(s: uint64): uint64 = s shl 8
proc south(s: uint64): uint64 = s shr 8
proc sideways(s: uint64): uint64 = ((s shl 1) and not fileA) or ((s shr 1) and not fileH)
proc zone(s: uint64): uint64 =   # s and every square next to it
  let v = s or north(s) or south(s)
  v or sideways(v)
proc steps(s: uint64): uint64 = zone(s) and not s   # the squares next to s
proc diagonal(s: uint64): uint64 = sideways(north(s) or south(s))   # the squares diagonally next to s
proc count(s: uint64): int = countSetBits(s)
proc lowest(s: uint64): uint64 = s and (0'u64 - s)   # the lowest square of s

proc knight(s: uint64): uint64 =
  ## The squares a knight on s goes to.
  let one = sideways(s)
  let two = ((s shl 2) and not (fileA or (fileA shl 1))) or ((s shr 2) and not (fileH or (fileH shr 1)))
  north(north(one)) or south(south(one)) or north(two) or south(two)

proc fillNorth(g, p: uint64): uint64 =
  ## Every square reachable from g by steps north through squares of p.
  var g = g
  var p = p
  g = g or (p and (g shl 8))
  p = p and (p shl 8)
  g = g or (p and (g shl 16))
  p = p and (p shl 16)
  g or (p and (g shl 32))

proc fillSouth(g, p: uint64): uint64 =
  ## Every square reachable from g by steps south through squares of p.
  var g = g
  var p = p
  g = g or (p and (g shr 8))
  p = p and (p shr 8)
  g = g or (p and (g shr 16))
  p = p and (p shr 16)
  g or (p and (g shr 32))

proc flood(k, m: uint64): uint64 =
  ## Every square a king may reach from k through squares of m.
  result = k
  while true:
    let a = result or (zone(result) and m)
    if a == result: return
    result = a

proc fromFen*(fen: string): Pieces =
  ## The pieces of a FEN. The en passant square counts only if a pawn can capture onto it.
  let fields = fen.splitWhitespace()
  var rank = 7
  var file = 0
  for c in fields[0]:
    case c
    of '/':
      dec rank
      file = 0
    of '1'..'8':
      file += ord(c) - ord('0')
    else:
      let sq = 1'u64 shl (8 * rank + file)
      inc file
      case c
      of 'P': result.whitePawns = result.whitePawns or sq
      of 'p': result.blackPawns = result.blackPawns or sq
      of 'K': result.whiteKing = result.whiteKing or sq
      of 'k': result.blackKing = result.blackKing or sq
      of 'B': result.whiteBishops = result.whiteBishops or sq
      of 'b': result.blackBishops = result.blackBishops or sq
      of 'N': result.whiteKnights = result.whiteKnights or sq
      of 'n': result.blackKnights = result.blackKnights or sq
      of 'R': result.whiteRooks = result.whiteRooks or sq
      of 'r': result.blackRooks = result.blackRooks or sq
      of 'Q': result.whiteQueens = result.whiteQueens or sq
      else: result.blackQueens = result.blackQueens or sq   # q
  result.whiteToMove = fields.len < 2 or fields[1] != "b"
  let ep = if fields.len > 3: fields[3] else: ""   # past the side to move and castling
  if ep.len >= 2 and ep[0] in 'a'..'h' and ep[1] in '1'..'8':
    let target = 1'u64 shl ((ord(ep[0]) - ord('a')) + 8 * (ord(ep[1]) - ord('1')))
    result.enPassant =
      if result.whiteToMove: (sideways(south(target)) and result.whitePawns) != 0
      else: (sideways(north(target)) and result.blackPawns) != 0
  if fields.len > 2 and fields[2] != "-":
    for c in fields[2]:
      let white = c in 'A'..'Z'
      let home = if white: rank1 else: rank8
      let king = (if white: result.whiteKing else: result.blackKing) and home
      var rooks = (if white: result.whiteRooks else: result.blackRooks) and home
      if king == 0: continue   # a right without its king in place does not count
      let kf = countTrailingZeroBits(king) mod 8
      let up = toUpperAscii(c)
      var ok = false
      while rooks != 0:
        let f = countTrailingZeroBits(rooks) mod 8
        if (up == 'K' and f > kf) or (up == 'Q' and f < kf) or
           (up != 'K' and up != 'Q' and f == ord(up) - ord('A') and f != kf): ok = true
        rooks = rooks and (rooks - 1)
      if white: result.whiteCastles = result.whiteCastles or ok
      else: result.blackCastles = result.blackCastles or ok

proc levels(p: Pieces, wOwn = 0'u64, bOwn = 0'u64): seq[uint64] =
  ## The levels: both kings free (0), then each king frozen on its square (a wall for both sides)
  ## when every square around it is held or attacked by a pawn (or holds one of its own pieces,
  ## wOwn or bOwn, where boxed pieces are on the board).
  let held = p.whitePawns or p.blackPawns or sideways(north(p.whitePawns) or south(p.blackPawns))
  result = @[0'u64]
  for (king, own) in [(p.whiteKing, wOwn), (p.blackKing, bOwn)]:
    if (steps(king) and not (held or own)) == 0: result.add king

proc kingWall(p: Pieces, white: bool): bool =
  ## May this side's king hold a boxed piece's step square (when frozen)? Not with a castling right
  ## left (a castling rook may stand beside its king, in Chess960, and castling moves it), and not
  ## where a castle leaves it beside its rook (g1 with a rook on f1, c1 with one on d1; g8, f8, c8,
  ## d8): a castle leaves the halfmove clock as it is, so the lock is not asked after one.
  let (king, rooks, castles, g, c) =
    if white: (p.whiteKing, p.whiteRooks, p.whiteCastles, 1'u64 shl 6, 1'u64 shl 2)
    else: (p.blackKing, p.blackRooks, p.blackCastles, 1'u64 shl 62, 1'u64 shl 58)
  not castles and (rooks and (((king and g) shr 1) or ((king and c) shl 1))) == 0

proc stillBishops(b, held, reach: uint64): uint64 =
  ## The still bishops among b: every diagonal neighbour held for good (held: fixed pawns and boxed
  ## pieces of their colour) or by another still bishop, and out of the enemy king's and bishops'
  ## reach. Such a bishop never moves and is never taken (a pawn taking it fails the bishop contact
  ## test). The largest such set.
  var s = b and not reach
  while true:
    var n = 0'u64
    var m = s
    while m != 0:
      let q = lowest(m)
      if (diagonal(q) and not (held or s)) == 0: n = n or q
      m = m xor q
    if n == s: return s
    s = n

proc checkSeed(p: Pieces): (uint64, uint64) =
  ## The check seed: the side to move is in a pawn's check, so its king must step now, to a square
  ## it can step to (not its own pawn, not a square an enemy pawn attacks, not next to the enemy
  ## king); its reach starts there. Not when it has no such square (that may be a mate now), when
  ## one of its pawns can take a checking pawn, or with a bishop on the board. The kings' starting
  ## sets.
  let (wp, bp, wk, bk, white) = (p.whitePawns, p.blackPawns, p.whiteKing, p.blackKing, p.whiteToMove)
  result = (wk, bk)
  if (p.whiteBishops or p.blackBishops) != 0: return
  let (k, own) = if white: (wk, wp) else: (bk, bp)
  let checkers = if white: sideways(north(k)) and bp else: sideways(south(k)) and wp
  if checkers == 0: return
  let attacked = if white: sideways(south(bp)) else: sideways(north(wp))
  let to = steps(k) and not own and not attacked and not steps(if white: bk else: wk)
  let takers = (if white: sideways(south(checkers)) else: sideways(north(checkers))) and own
  if to == 0 or takers != 0: return
  result = if white: (to, bk) else: (wk, to)

proc rayMeets(king, blocks, o: uint64): bool =
  ## Does a diagonal line from the square king, stopped by blocks, meet a square of o?
  let sq = countTrailingZeroBits(king)
  for (df, dr) in [(-1, -1), (1, -1), (-1, 1), (1, 1)]:
    var f = (sq and 7) + df
    var r = (sq shr 3) + dr
    while f >= 0 and f < 8 and r >= 0 and r < 8:
      let s = 1'u64 shl (8 * r + f)
      if (o and s) != 0: return true
      if (blocks and s) != 0: break
      f += df
      r += dr
  false

proc stalemateGuard(cand, own, ownFixed, reach, shut, enemyKing: uint64, enemyBishops: bool, blocks: uint64): uint64 =
  ## The stalemate guard: of the owner's fixed pawns cand (which the enemy king may take), those
  ## whose capture always stalemates the owner. The owner must have nothing else that moves (every
  ## other pawn fixed; no bishop, which the caller sees to). reach: where the owner's king may
  ## stand; shut: squares it can never step to (own fixed pawns, squares the enemy's fixed pawns
  ## attack); enemyKing: the enemy king's reach; blocks: squares a bishop's line never crosses.
  if (own and not ownFixed) != 0: return 0
  var c = cand
  while c != 0:
    let pawn = lowest(c)
    c = c and (c - 1)
    let near = steps(pawn)
    let source = near and enemyKing   # where the enemy king takes from
    let x = shut or near or pawn      # after the capture, the owner's king may not step there
    var held = true
    var k = reach and not (near or pawn)   # the owner's king, not defending the pawn
    while k != 0:
      let king = lowest(k)
      k = k and (k - 1)
      if (steps(king) and not x) != 0 or (enemyBishops and rayMeets(king, blocks or pawn, source)):
        held = false   # it has a square to step to, or the capture uncovers a check
        break
    if held: result = result or pawn

proc level(p: Pieces, frozen: uint64, o: LevelIn): Option[Sets] =
  ## One level: the fixed point of the walls, the pawns that can never move, the kings' reaches,
  ## the squares where each side may take a pawn, the pawns' cones and the bishops' reaches. The
  ## sets the mating net reads, or none when the structure leaks whichever side is asked about.
  ## o.family: o.wp, bp are the pawns (a family has a pair's pawn moved into its gap) and o.start
  ## where the kings' reaches, capture squares and bishops' reaches start; o.v: walls for both
  ## sides (the gaps of a family's pairs that stay); o.wx, bx, ws, bs: the boxed pieces'
  ## candidates and their step squares; o.guard: the stalemate guard and the check seed (plain
  ## levels only).
  let (wp, bp) = if o.family: (o.wp, o.bp) else: (p.whitePawns, p.blackPawns)
  let (wk, bk, wx, bx, v) = (p.whiteKing, p.blackKing, o.wx, o.bx, o.v or frozen)
  let frozenWhite = (frozen and wk) != 0
  let frozenBlack = not frozenWhite and frozen != 0
  let nearFrozenBlack = if frozenBlack: zone(bk) else: 0'u64
  let nearFrozenWhite = if frozenWhite: zone(wk) else: 0'u64
  let (wSeed, bSeed) = if o.guard and frozen == 0: checkSeed(p) else: (wk, bk)
  let start = if o.family: o.start else: [wSeed, bSeed, wSeed, bSeed, p.whiteBishops, p.blackBishops]
  var (wKing, bKing, wTake, bTake, wBish, bBish) = (start[0], start[1], start[2], start[3], start[4], start[5])
  var (wCone, bCone, wFixed, bFixed) = (wp, bp, wp, bp)
  var wGuard = if o.guard: not 0'u64 else: 0'u64   # nothing is taken yet
  var bGuard = wGuard
  while true:
    # Boxed: the pieces no enemy king or bishop reaches. Walls: pawns the other side can never
    # take (or whose capture stalemates their owner), the frozen king, the gaps, boxed pieces.
    let boxed = (wx and not (bKing or bBish)) or (bx and not (wKing or wBish))
    let wWall = (wp and not (bTake and not wGuard)) or v or boxed
    let bWall = (bp and not (wTake and not bGuard)) or v or boxed
    let nwFixed = wFixed and wWall and south(bWall or wFixed)
    let nbFixed = bFixed and bWall and north(wWall or bFixed)
    let nwCone = fillNorth(wCone, not bWall)
    let nbCone = fillSouth(bCone, not wWall)
    # The kings: never onto a fixed pawn, a square it attacks, or next to the frozen king; with
    # boxed pieces on the board, never onto its own boxed pieces and still bishops either.
    let bHit = sideways(south(nbFixed))
    let wHit = sideways(north(nwFixed))
    let boxedNow = (wx or bx) != 0
    let wStill = if boxedNow: stillBishops(p.whiteBishops, nwFixed or (wx and boxed), bKing or bBish) else: 0'u64
    let bStill = if boxedNow: stillBishops(p.blackBishops, nbFixed or (bx and boxed), wKing or wBish) else: 0'u64
    let nwKing = flood(wKing, not (nwFixed or bHit or nearFrozenBlack or (wx and boxed) or wStill))
    let nbKing = flood(bKing, not (nbFixed or wHit or nearFrozenWhite or (bx and boxed) or bStill))
    var (nwBish, nbBish) = (wBish, bBish)
    let open = not (nwFixed or nbFixed)
    while true:
      let a = nwBish or (diagonal(nwBish) and open)
      let d = nbBish or (diagonal(nbBish) and open)
      if a == nwBish and d == nbBish: break
      nwBish = a
      nbBish = d
    # A side may take a pawn where its king goes, and on any square a pawn may walk into.
    var t = bTake or nbKing
    let nbTake = t or south(fillSouth(t and not bWall, not bWall))
    t = wTake or nwKing
    let nwTake = t or north(fillNorth(t and not wWall, not wWall))
    var (nwGuard, nbGuard) = (wGuard, bGuard)
    if o.guard:
      let blocks = nwFixed or nbFixed
      let (wHasB, bHasB) = (p.whiteBishops != 0, p.blackBishops != 0)
      nwGuard = if wHasB: 0'u64 else: stalemateGuard(wp and nbTake and nwFixed, wp, nwFixed, nwKing, nwFixed or bHit, nbKing, bHasB, blocks)
      nbGuard = if bHasB: 0'u64 else: stalemateGuard(bp and nwTake and nbFixed, bp, nbFixed, nbKing, nbFixed or wHit, nwKing, wHasB, blocks)
    let changed = nwCone != wCone or nbCone != bCone or nwFixed != wFixed or nbFixed != bFixed or
                  nwKing != wKing or nbKing != bKing or nwBish != wBish or nbBish != bBish or
                  nwTake != wTake or nbTake != bTake or nwGuard != wGuard or nbGuard != bGuard
    (wCone, bCone, wFixed, bFixed, wKing, bKing) = (nwCone, nbCone, nwFixed, nbFixed, nwKing, nbKing)
    (wBish, bBish, wTake, bTake, wGuard, bGuard) = (nwBish, nbBish, nwTake, nbTake, nwGuard, nbGuard)
    if not changed: break
  let boxed = (wx and not (bKing or bBish)) or (bx and not (wKing or wBish))
  if ((wCone and rank8) or (bCone and rank1)) != 0: return none(Sets)                                  # a pawn can promote
  if ((north(sideways(wCone)) and (bCone or bx)) or (south(sideways(bCone)) and wx)) != 0: return none(Sets)  # a pawn can capture
  if (frozenWhite and wKing != wk) or (frozenBlack and bKing != bk): return none(Sets)                 # the frozen king can move
  if ((diagonal(wBish) and bCone) or (diagonal(bBish) and wCone)) != 0: return none(Sets)               # a bishop meets a pawn's path
  # A piece may step: a step square not held by a fixed pawn, a boxed piece or a still bishop of
  # its colour, or by its frozen king (where the king may be a wall).
  let wStill = if (wx or bx) != 0: stillBishops(p.whiteBishops, wFixed or (wx and boxed), bKing or bBish) else: 0'u64
  let bStill = if (wx or bx) != 0: stillBishops(p.blackBishops, bFixed or (bx and boxed), wKing or wBish) else: 0'u64
  let wKw = if frozenWhite and kingWall(p, true): wk else: 0'u64
  let bKw = if frozenBlack and kingWall(p, false): bk else: 0'u64
  if ((o.ws and not (wFixed or (wx and boxed) or wStill or wKw)) or
      (o.bs and not (bFixed or (bx and boxed) or bStill or bKw))) != 0: return none(Sets)
  if (wGuard or bGuard) != 0:
    # A king that takes a guarded pawn ends the game: for the mating net, the kings' reaches
    # again, now stopping at the enemy's guarded pawns.
    wKing = flood(wSeed, not (wFixed or sideways(south(bFixed)) or nearFrozenBlack or (bp and bGuard)))
    bKing = flood(bSeed, not (bFixed or sideways(north(wFixed)) or nearFrozenWhite or (wp and wGuard)))
  some(Sets(wCone: wCone, bCone: bCone, wFixed: wFixed, bFixed: bFixed, wKing: wKing, bKing: bKing,
            wBish: wBish, bBish: bBish, wTake: wTake, bTake: bTake))

proc netLeaks(p: Pieces, s: Sets, white: bool, occ: uint64): bool =
  ## The mating net: can the other side's pawns and bishops catch the king asked about? occ:
  ## squares that stand occupied for good besides (the boxed pieces').
  var attack, reach, free, spare, twins: uint64
  if white:
    attack = diagonal(s.bBish) or sideways(south(s.bCone))
    reach = s.wKing
    free = not (s.wCone or occ or zone(s.bKing) or attack)   # never occupied, attacked or next to the mater
    spare = free and not s.wBish                             # ... nor reached by the king's own bishops
    twins = p.whiteBishops
  else:
    attack = diagonal(s.wBish) or sideways(north(s.wCone))
    reach = s.bKing
    free = not (s.bCone or occ or zone(s.wKing) or attack)
    spare = free and not s.bBish
    twins = p.blackBishops
  # A king next to a spare square, or with free squares beside it both ways, always has a flight.
  # The second rule counts on at most one of the king's own bishops on the colour of those two
  # squares (the colour opposite the king's): not on the king squares where it has two or more.
  let noPair = (if count(twins and dark) > 1: not dark else: 0'u64) or (if count(twins and not dark) > 1: dark else: 0'u64)
  let flight = sideways(spare) or north(spare) or south(spare) or
               ((north(free) or south(free)) and sideways(free) and not noPair)
  (attack and reach and not flight) != 0

proc families(p: Pieces, gaps, frozen: uint64, white: bool): Family =
  ## The families of the open pairs at one level.
  var pairs: seq[array[3, uint64]]   # per pair: the gap, the white pawn below it, the black pawn above it
  var g = gaps
  while g != 0:
    let gap = lowest(g)
    g = g and (g - 1)
    pairs.add [gap, south(gap), north(gap)]
  if pairs.len > maxPairs: return familyNone
  let k = pairs.len
  var n = 1
  for i in 0 ..< k: n *= 3
  var sets: seq[Sets]
  for f in 0 ..< n:
    # Family f: digit i (base 3) says what pair i's pawns have done: 0 neither, 1 the white one
    # stepped into the gap, 2 the black one did. Its sets start from those of the family it is
    # reached from (the same with pair i's pawns in place), minus the gap.
    var o = LevelIn(family: true, wp: p.whitePawns, bp: p.blackPawns)
    if f == 0: o.start = [p.whiteKing, p.blackKing, p.whiteKing, p.blackKing, p.whiteBishops, p.blackBishops]
    var q = f
    var pow = 1
    for i in 0 ..< k:
      let d = q mod 3
      let gap = pairs[i][0]
      if d == 0:
        o.v = o.v or gap   # the gap stays: a wall for both sides' pawns
      else:
        if d == 1: o.wp = (o.wp and not pairs[i][1]) or gap
        else: o.bp = (o.bp and not pairs[i][2]) or gap
        let r = sets[f - d * pow]
        o.start[0] = o.start[0] or (r.wKing and not gap)
        o.start[1] = o.start[1] or (r.bKing and not gap)
        o.start[2] = o.start[2] or r.wTake
        o.start[3] = o.start[3] or r.bTake
        o.start[4] = o.start[4] or (r.wBish and not gap)
        o.start[5] = o.start[5] or (r.bBish and not gap)
      q = q div 3
      pow *= 3
    let s = level(p, frozen, o)
    if s.isNone: return (if f == 0: familyRefuted else: familyNone)
    # The pairs that stay: both pawns must never move.
    q = f
    for i in 0 ..< k:
      if q mod 3 == 0 and ((pairs[i][1] and not s.get.wFixed) or (pairs[i][2] and not s.get.bFixed)) != 0: return familyNone
      q = q div 3
    if netLeaks(p, s.get, white, 0): return (if f == 0: familyRefuted else: familyNone)
    sets.add s.get
  familyLock

proc boxSteps(knights, o, queens: uint64): uint64 =
  ## The step squares of one side's knights, rooks (and queens: o) and queens.
  sideways(o) or north(o) or south(o) or diagonal(queens) or knight(knights)

proc boxedLock(p: Pieces, white: bool, wx, bx: uint64): bool =
  ## With knights, rooks or queens on the board: every one of them must be boxed in by its own
  ## pawns and pieces (bishops and the king among them: the level checks that they never move);
  ## then the levels, with the boxed pieces as walls and no flight onto their squares.
  let ws = boxSteps(p.whiteKnights, p.whiteRooks or p.whiteQueens, p.whiteQueens)
  let bs = boxSteps(p.blackKnights, p.blackRooks or p.blackQueens, p.blackQueens)
  let wOwn = p.whitePawns or wx or p.whiteBishops or (if kingWall(p, true): p.whiteKing else: 0'u64)
  let bOwn = p.blackPawns or bx or p.blackBishops or (if kingWall(p, false): p.blackKing else: 0'u64)
  if (ws and not wOwn) != 0 or (bs and not bOwn) != 0 or p.enPassant: return false
  for frozen in levels(p, wx or p.whiteBishops, bx or p.blackBishops):
    let s = level(p, frozen, LevelIn(wx: wx, bx: bx, ws: ws, bs: bs))
    if s.isSome and not netLeaks(p, s.get, white, wx or bx): return true
  false

proc stuckMater(p: Pieces, white: bool): bool =
  ## The stuck mater: the flagged side is to move and, whatever it plays, the mater has no legal
  ## move left (kings and pawns only): the game ends at the mater's turn.
  if p.whiteToMove != white or p.enPassant: return false
  if (p.whiteBishops or p.blackBishops or p.whiteKnights or p.blackKnights or p.whiteRooks or
      p.blackRooks or p.whiteQueens or p.blackQueens) != 0: return false
  let (fp, mp) = if white: (p.whitePawns, p.blackPawns) else: (p.blackPawns, p.whitePawns)
  let (fk, mk) = if white: (p.whiteKing, p.blackKing) else: (p.blackKing, p.whiteKing)
  let occ = fp or mp or fk or mk
  proc fwd(s: uint64): uint64 = (if white: north(s) else: south(s))    # ahead, for the flagged side
  proc back(s: uint64): uint64 = (if white: south(s) else: north(s))   # behind
  # A mater's pawn with an empty square ahead is never stuck; then only a stalemate now is left to
  # find, which a flagged pawn's push rules out.
  if (back(mp) and not occ) != 0 and (fwd(fp) and not occ) != 0: return false
  let fAttack = sideways(fwd(fp))
  let mAttack = sideways(back(mp))
  if (fAttack and (mp or mk)) != 0: return false                     # 1. the flagged side has no capture
  let single = fwd(fp) and not occ
  let double = fwd(single and (if white: rank3 else: rank6)) and not occ
  let pushes = single or double
  let near = steps(mk)
  let kingTo = steps(fk) and not fp and not mAttack and not near      # the flagged king's steps now
  let inCheck = (fk and mAttack) != 0
  if inCheck and kingTo == 0: return false                           # mated now
  let stays = pushes != 0 and not inCheck                            # a pawn may move instead of the king
  if kingTo == 0 and not stays: return true                          # no move, no check: stalemate now
  # The squares next to every square the flagged king may stand on after its move.
  var cover = if stays: steps(fk) else: not 0'u64
  var k = kingTo
  while k != 0:
    cover = cover and steps(lowest(k))
    k = k and (k - 1)
  # 2. the mater's pawns are blocked by men that stay, and attack no flagged pawn
  let blockers = fp or mp or mk or (if kingTo == 0: fk else: 0'u64)
  if ((back(mp) and not blockers) or (mAttack and fp)) != 0: return false
  # 3. every square next to the mater's king: its own pawn, attacked by a flagged pawn that cannot
  #    move now, or next to the flagged king wherever it goes
  let still = fp and back(fwd(fp) and occ)
  if (near and not (mp or sideways(fwd(still)) or cover)) != 0: return false
  # 4. no push lands where a mater's pawn attacks or next to its king, nor lets it take en passant
  ((pushes and (mAttack or near)) or (double and sideways(mp))) == 0

proc forcedStep(p: Pieces): Option[Pieces] =
  ## The forced step: the side to move is in a pawn's check, with kings and pawns only, and its one
  ## legal move is a step of its king. The position after it, or none.
  if p.enPassant or (p.whiteBishops or p.blackBishops or p.whiteKnights or p.blackKnights or
                     p.whiteRooks or p.blackRooks or p.whiteQueens or p.blackQueens) != 0: return none(Pieces)
  let white = p.whiteToMove
  let (k, ek) = if white: (p.whiteKing, p.blackKing) else: (p.blackKing, p.whiteKing)
  let (own, enemy) = if white: (p.whitePawns, p.blackPawns) else: (p.blackPawns, p.whitePawns)
  let checkers = (if white: sideways(north(k)) else: sideways(south(k))) and enemy
  if checkers == 0: return none(Pieces)
  let attacked = if white: sideways(south(enemy)) else: sideways(north(enemy))
  let to = steps(k) and not own and not attacked and not steps(ek)
  if count(to) != 1: return none(Pieces)
  if ((if white: sideways(south(checkers)) else: sideways(north(checkers))) and own) != 0:
    return none(Pieces)   # a pawn may take instead
  var q = p
  q.whiteToMove = not white
  q.enPassant = false
  if white:
    q.whiteKing = to
    q.blackPawns = p.blackPawns and not to
  else:
    q.blackKing = to
    q.whitePawns = p.whitePawns and not to
  some(q)

proc cannotBeMated*(p: Pieces, white: bool): bool =
  ## Can White (white = true) or Black never be mated, by the lock detector?
  let after = forcedStep(p)
  if after.isSome: return cannotBeMated(after.get, white)
  let wx = p.whiteKnights or p.whiteRooks or p.whiteQueens
  let bx = p.blackKnights or p.blackRooks or p.blackQueens
  if (wx or bx) != 0: return boxedLock(p, white, wx, bx)
  if p.enPassant: return false
  let gaps = north(p.whitePawns) and south(p.blackPawns) and not (p.whitePawns or p.blackPawns)
  for frozen in levels(p):
    if gaps != 0:
      let f = families(p, gaps, frozen, white)
      if f == familyLock: return true
      if f == familyRefuted: continue   # family A, the level with more walls, leaked: the level leaks too
    let s = level(p, frozen, LevelIn(guard: true))
    if s.isSome and not netLeaks(p, s.get, white, 0): return true
  stuckMater(p, white)
