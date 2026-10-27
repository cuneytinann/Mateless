## Mateless's lock detector, in its simplest form.
##
## Can a side never be mated? The lock detector answers yes when pawns, kings and bishops form a
## structure that no series of legal moves can open (FIDE 5.2.2 dead position, 6.9 flag fall). It
## reads bitboards only: it generates no move and searches nothing.
##
## Each king's reach (every square it may ever stand on) is grown from its square, never onto a
## square that a pawn which can never move attacks. The pawns that can never move are those
## blocked by a wall: a pawn the other side can never take. The squares where a side may take a
## pawn grow from its king's reach, and so on, until nothing changes. The structure leaks if a
## pawn can promote or capture, a frozen king can move, a bishop can reach a pawn's path, or the
## king of the side asked about can reach a square the other side attacks where it has no sure
## flight. It is tried with both kings free, then with each king frozen on its square (a wall for
## both sides) when every square around that king is held or attacked by a pawn.
##
## A knight, rook or queen on the board, two bishops of one side on squares of one colour, or a
## possible en passant capture fails it at once. Sound, not complete: a structure it passes can
## never be opened; one it fails may still be dead.
##
## Squares: a1 = 0, b1 = 1, ..., h8 = 63. A set of squares (a bitboard) is a uint64.

import std/[bitops, strutils]

type
  Pieces* = object
    ## What the lock detector reads from a position.
    whitePawns*, blackPawns*: uint64
    whiteKing*, blackKing*: uint64
    whiteBishops*, blackBishops*: uint64
    others*: uint64    ## knights, rooks and queens of both sides
    enPassant*: bool   ## the side to move can capture en passant

const
  fileA = 0x0101010101010101'u64
  fileH = 0x8080808080808080'u64
  rank1 = 0x00000000000000FF'u64
  rank8 = 0xFF00000000000000'u64
  dark = 0xAA55AA55AA55AA55'u64   # the dark squares; a1 is dark

proc north(s: uint64): uint64 = s shl 8
proc south(s: uint64): uint64 = s shr 8
proc sideways(s: uint64): uint64 = ((s shl 1) and not fileA) or ((s shr 1) and not fileH)
proc zone(s: uint64): uint64 =   # s and every square next to it
  let v = s or north(s) or south(s)
  v or sideways(v)
proc diagonal(s: uint64): uint64 = sideways(north(s) or south(s))   # the squares diagonally next to s
proc count(s: uint64): int = countSetBits(s)

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
      else: result.others = result.others or sq   # N R Q n r q
  let whiteToMove = fields.len < 2 or fields[1] != "b"
  let ep = if fields.len > 3: fields[3] else: ""   # past the side to move and castling
  if ep.len >= 2 and ep[0] in 'a'..'h' and ep[1] in '1'..'8':
    let target = 1'u64 shl ((ord(ep[0]) - ord('a')) + 8 * (ord(ep[1]) - ord('1')))
    result.enPassant =
      if whiteToMove: (sideways(south(target)) and result.whitePawns) != 0
      else: (sideways(north(target)) and result.blackPawns) != 0

proc twinBishops(b: uint64): bool =
  ## Two bishops on squares of one colour (only a promotion makes them).
  count(b and dark) > 1 or count(b and not dark) > 1

proc leaks(p: Pieces, white: bool, frozen: uint64): bool

proc cannotBeMated*(p: Pieces, white: bool): bool =
  ## Can White (white = true) or Black never be mated, by the lock detector?
  if p.others != 0 or p.enPassant: return false
  if twinBishops(p.whiteBishops) or twinBishops(p.blackBishops): return false
  if not leaks(p, white, 0): return true
  # A king may be frozen only if every square around it is held or attacked by a pawn.
  let held = p.whitePawns or p.blackPawns or sideways(north(p.whitePawns) or south(p.blackPawns))
  let kings = [p.whiteKing, p.blackKing]
  for king in kings:
    if (zone(king) and not king and not held) == 0 and not leaks(p, white, king): return true
  false

proc leaks(p: Pieces, white: bool, frozen: uint64): bool =
  ## Does the structure leak to the king asked about, with the king `frozen` frozen (0: none)?
  let (wp, bp, wk, bk) = (p.whitePawns, p.blackPawns, p.whiteKing, p.blackKing)
  let frozenWhite = (frozen and wk) != 0
  let frozenBlack = not frozenWhite and frozen != 0
  let nearFrozenBlack = if frozenBlack: zone(bk) else: 0
  let nearFrozenWhite = if frozenWhite: zone(wk) else: 0

  # Quick: the pawns' paths against the first walls already show a promotion or a capture.
  var wCone = fillNorth(wp, not ((bp and not wk) or frozen))
  var bCone = fillSouth(bp, not ((wp and not bk) or frozen))
  if ((wCone and rank8) or (bCone and rank1) or (north(sideways(wCone)) and bCone)) != 0: return true

  # The cycle: walls -> pawns that can never move -> king reaches -> capture squares -> walls.
  var (wFixed, bFixed) = (wp, bp)                # pawns that can never move      (shrink)
  var (wKing, bKing) = (wk, bk)                  # squares each king may reach    (grow)
  var (wTake, bTake) = (wk, bk)                  # squares where a side may take an enemy pawn (grow)
  var (wWall, bWall) = (not 0'u64, not 0'u64)    # pawns the other side can never take, and the frozen king
  while true:
    let (lastWWall, lastBWall) = (wWall, bWall)
    wWall = (wp and not bTake) or frozen
    bWall = (bp and not wTake) or frozen
    let newWFixed = wFixed and wWall and south(bWall or wFixed)
    let newBFixed = bFixed and bWall and north(wWall or bFixed)
    if wWall == lastWWall and bWall == lastBWall and newWFixed == wFixed and newBFixed == bFixed:
      break
    # Both kings' reaches, flooded: never onto a fixed pawn, a square it attacks, or next to
    # the frozen king.
    let wMask = not (newWFixed or sideways(south(newBFixed)) or nearFrozenBlack)
    let bMask = not (newBFixed or sideways(north(newWFixed)) or nearFrozenWhite)
    var (newWKing, newBKing) = (wKing, bKing)
    while true:
      let a = newWKing or (zone(newWKing) and wMask)
      let d = newBKing or (zone(newBKing) and bMask)
      if a == newWKing and d == newBKing: break
      newWKing = a
      newBKing = d
    if (frozenWhite and newWKing != wk) or (frozenBlack and newBKing != bk):
      return true   # the frozen king can move
    # A side may take a pawn where its king goes, and on any square a pawn may walk into.
    var t = bTake or newBKing
    let newBTake = t or south(fillSouth(t and not bWall, not bWall))
    t = wTake or newWKing
    let newWTake = t or north(fillNorth(t and not wWall, not wWall))
    let changed = newWFixed != wFixed or newBFixed != bFixed or newWKing != wKing or
                  newBKing != bKing or newWTake != wTake or newBTake != bTake
    wFixed = newWFixed; bFixed = newBFixed; wKing = newWKing; bKing = newBKing
    wTake = newWTake; bTake = newBTake
    if not changed: break

  # The pawns' cones: every square they may still reach.
  wCone = fillNorth(wp, not bWall)
  bCone = fillSouth(bp, not wWall)
  if ((wCone and rank8) or (bCone and rank1)) != 0: return true   # a pawn can promote
  if (north(sideways(wCone)) and bCone) != 0: return true         # a pawn can capture
  # The bishops' reaches: every square they may reach, around the fixed pawns.
  var (wBish, bBish) = (p.whiteBishops, p.blackBishops)
  let open = not (wFixed or bFixed)
  while true:
    let a = wBish or (diagonal(wBish) and open)
    let d = bBish or (diagonal(bBish) and open)
    if a == wBish and d == bBish: break
    wBish = a
    bBish = d
  if ((diagonal(wBish) and bCone) or (diagonal(bBish) and wCone)) != 0: return true   # a bishop meets a pawn's path

  # The mating net: can the other side's pawns and bishops catch the king asked about?
  var attack, reach, free, spare: uint64
  if white:
    attack = diagonal(bBish) or sideways(south(bCone))
    reach = wKing
    free = not (wCone or zone(bKing) or attack)   # never occupied, attacked or next to the mater
    spare = free and not wBish                    # ... nor reached by the king's own bishops
  else:
    attack = diagonal(wBish) or sideways(north(wCone))
    reach = bKing
    free = not (bCone or zone(wKing) or attack)
    spare = free and not bBish
  # A king next to a spare square, or with free squares beside it both ways, always has a flight.
  let flight = sideways(spare) or north(spare) or south(spare) or ((north(free) or south(free)) and sideways(free))
  (attack and reach and not flight) != 0
