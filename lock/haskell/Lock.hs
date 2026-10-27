{- |
Mateless's lock detector, in its simplest form.

Can a side never be mated? The lock detector answers yes when pawns, kings and bishops form a
structure that no series of legal moves can open (FIDE 5.2.2 dead position, 6.9 flag fall). It
reads bitboards only: it generates no move and searches nothing.

Each king's reach (every square it may ever stand on) is grown from its square, never onto a
square that a pawn which can never move attacks. The pawns that can never move are those
blocked by a wall: a pawn the other side can never take. The squares where a side may take a
pawn grow from its king's reach, and so on, until nothing changes. The structure leaks if a
pawn can promote or capture, a frozen king can move, a bishop can reach a pawn's path, or the
king of the side asked about can reach a square the other side attacks where it has no sure
flight. It is tried with both kings free, then with each king frozen on its square (a wall for
both sides) when every square around that king is held or attacked by a pawn.

A knight, rook or queen on the board, two bishops of one side on squares of one colour, or a
possible en passant capture fails it at once. Sound, not complete: a structure it passes can
never be opened; one it fails may still be dead.

Squares: a1 = 0, b1 = 1, ..., h8 = 63. A set of squares (a bitboard) is a 'Word64'.
-}
module Lock (Pieces(..), fromFen, cannotBeMated) where

import Data.Bits (bit, complement, popCount, shiftL, shiftR, (.&.), (.|.))
import Data.Char (ord)
import Data.Maybe (listToMaybe)
import Data.Word (Word64)

type Set = Word64

fileA, fileH, rank1, rank8, dark :: Set
fileA = 0x0101010101010101
fileH = 0x8080808080808080
rank1 = 0x00000000000000FF
rank8 = 0xFF00000000000000
dark  = 0xAA55AA55AA55AA55   -- the dark squares; a1 is dark

north, south, sideways, zone, diagonal :: Set -> Set
north s = s `shiftL` 8
south s = s `shiftR` 8
sideways s = ((s `shiftL` 1) .&. complement fileA) .|. ((s `shiftR` 1) .&. complement fileH)
zone s = let v = s .|. north s .|. south s in v .|. sideways v  -- s and every square next to it
diagonal s = sideways (north s .|. south s)                     -- the squares diagonally next to s

count :: Set -> Int
count = popCount

-- | Every square reachable from g by steps north through squares of p.
fillNorth :: Set -> Set -> Set
fillNorth g p =
  let g1 = g .|. (p .&. (g `shiftL` 8))
      p1 = p .&. (p `shiftL` 8)
      g2 = g1 .|. (p1 .&. (g1 `shiftL` 16))
      p2 = p1 .&. (p1 `shiftL` 16)
  in g2 .|. (p2 .&. (g2 `shiftL` 32))

-- | Every square reachable from g by steps south through squares of p.
fillSouth :: Set -> Set -> Set
fillSouth g p =
  let g1 = g .|. (p .&. (g `shiftR` 8))
      p1 = p .&. (p `shiftR` 8)
      g2 = g1 .|. (p1 .&. (g1 `shiftR` 16))
      p2 = p1 .&. (p1 `shiftR` 16)
  in g2 .|. (p2 .&. (g2 `shiftR` 32))

-- | What the lock detector reads from a position.
data Pieces = Pieces
  { whitePawns, blackPawns :: Word64
  , whiteKing, blackKing :: Word64
  , whiteBishops, blackBishops :: Word64
  , others :: Word64     -- ^ knights, rooks and queens of both sides
  , enPassant :: Bool    -- ^ the side to move can capture en passant
  }

-- | The pieces of a FEN. The en passant square counts only if a pawn can capture onto it.
fromFen :: String -> Pieces
fromFen fen = p { enPassant = ep }
  where
    (board, rest) = break (== ' ') fen
    (_, _, p) = foldl place (7, 0, Pieces 0 0 0 0 0 0 0 False) board
    place (rank, file, q) c
      | c == '/' = (rank - 1, 0, q)
      | c >= '1' && c <= '8' = (rank, file + ord c - ord '0', q)
      | otherwise = (rank, file + 1, add c (bit (8 * rank + file)) q)
    add c sq q = case c of
      'P' -> q { whitePawns = whitePawns q .|. sq }
      'p' -> q { blackPawns = blackPawns q .|. sq }
      'K' -> q { whiteKing = whiteKing q .|. sq }
      'k' -> q { blackKing = blackKing q .|. sq }
      'B' -> q { whiteBishops = whiteBishops q .|. sq }
      'b' -> q { blackBishops = blackBishops q .|. sq }
      _ -> q { others = others q .|. sq }   -- N R Q n r q
    fields = words rest
    whiteToMove = listToMaybe fields /= Just "b"
    ep = case drop 2 fields of   -- past the side to move and castling
      (f : r : _) : _ | f >= 'a' && f <= 'h' && r >= '1' && r <= '8' ->
        let target = bit ((ord f - ord 'a') + 8 * (ord r - ord '1'))
        in if whiteToMove then (sideways (south target) .&. whitePawns p) /= 0
                          else (sideways (north target) .&. blackPawns p) /= 0
      _ -> False

-- | Two bishops on squares of one colour (only a promotion makes them).
twinBishops :: Set -> Bool
twinBishops b = count (b .&. dark) > 1 || count (b .&. complement dark) > 1

-- | Can White (white = True) or Black never be mated, by the lock detector?
cannotBeMated :: Pieces -> Bool -> Bool
cannotBeMated p white
  | others p /= 0 || enPassant p = False
  | twinBishops (whiteBishops p) || twinBishops (blackBishops p) = False
  | not (leaks p white 0) = True
  -- A king may be frozen only if every square around it is held or attacked by a pawn.
  | otherwise =
      any (\king -> (zone king .&. complement king .&. complement held) == 0 && not (leaks p white king)) kings
  where
    held = whitePawns p .|. blackPawns p .|. sideways (north (whitePawns p) .|. south (blackPawns p))
    kings = [whiteKing p, blackKing p]

-- | Does the structure leak to the king asked about, with the king @frozen@ frozen (0: none)?
leaks :: Pieces -> Bool -> Set -> Bool
leaks p white frozen
  -- Quick: the pawns' paths against the first walls already show a promotion or a capture.
  | ((quickWCone .&. rank8) .|. (quickBCone .&. rank1) .|. (north (sideways quickWCone) .&. quickBCone)) /= 0 = True
  -- The cycle: walls -> pawns that can never move -> king reaches -> capture squares -> walls.
  | otherwise =
      cycleFrom wp bp                          -- pawns that can never move      (shrink)
                wk bk                          -- squares each king may reach    (grow)
                wk bk                          -- squares where a side may take an enemy pawn (grow)
                (complement 0) (complement 0)  -- pawns the other side can never take, and the frozen king
  where
    wp = whitePawns p
    bp = blackPawns p
    wk = whiteKing p
    bk = blackKing p
    frozenWhite = (frozen .&. wk) /= 0
    frozenBlack = not frozenWhite && frozen /= 0
    nearFrozenBlack = if frozenBlack then zone bk else 0
    nearFrozenWhite = if frozenWhite then zone wk else 0

    quickWCone = fillNorth wp (complement ((bp .&. complement wk) .|. frozen))
    quickBCone = fillSouth bp (complement ((wp .&. complement bk) .|. frozen))

    cycleFrom wFixed bFixed wKing bKing wTake bTake lastWWall lastBWall
      | wWall == lastWWall && bWall == lastBWall && newWFixed == wFixed && newBFixed == bFixed =
          settled wFixed bFixed wKing bKing wWall bWall
      | (frozenWhite && newWKing /= wk) || (frozenBlack && newBKing /= bk) =
          True   -- the frozen king can move
      | not changed = settled newWFixed newBFixed newWKing newBKing wWall bWall
      | otherwise = cycleFrom newWFixed newBFixed newWKing newBKing newWTake newBTake wWall bWall
      where
        wWall = (wp .&. complement bTake) .|. frozen
        bWall = (bp .&. complement wTake) .|. frozen
        newWFixed = wFixed .&. wWall .&. south (bWall .|. wFixed)
        newBFixed = bFixed .&. bWall .&. north (wWall .|. bFixed)
        -- Both kings' reaches, flooded: never onto a fixed pawn, a square it attacks, or next to
        -- the frozen king.
        wMask = complement (newWFixed .|. sideways (south newBFixed) .|. nearFrozenBlack)
        bMask = complement (newBFixed .|. sideways (north newWFixed) .|. nearFrozenWhite)
        (newWKing, newBKing) = flood wKing bKing
        flood w b
          | a == w && d == b = (w, b)
          | otherwise = flood a d
          where
            a = w .|. (zone w .&. wMask)
            d = b .|. (zone b .&. bMask)
        -- A side may take a pawn where its king goes, and on any square a pawn may walk into.
        bT = bTake .|. newBKing
        newBTake = bT .|. south (fillSouth (bT .&. complement bWall) (complement bWall))
        wT = wTake .|. newWKing
        newWTake = wT .|. north (fillNorth (wT .&. complement wWall) (complement wWall))
        changed = newWFixed /= wFixed || newBFixed /= bFixed || newWKing /= wKing ||
                  newBKing /= bKing || newWTake /= wTake || newBTake /= bTake

    settled wFixed bFixed wKing bKing wWall bWall
      | ((wCone .&. rank8) .|. (bCone .&. rank1)) /= 0 = True   -- a pawn can promote
      | (north (sideways wCone) .&. bCone) /= 0 = True          -- a pawn can capture
      | ((diagonal wBish .&. bCone) .|. (diagonal bBish .&. wCone)) /= 0 = True   -- a bishop meets a pawn's path
      | otherwise = (attack .&. reach .&. complement flight) /= 0
      where
        -- The pawns' cones: every square they may still reach.
        wCone = fillNorth wp (complement bWall)
        bCone = fillSouth bp (complement wWall)
        -- The bishops' reaches: every square they may reach, around the fixed pawns.
        open = complement (wFixed .|. bFixed)
        (wBish, bBish) = flood (whiteBishops p) (blackBishops p)
        flood w b
          | a == w && d == b = (w, b)
          | otherwise = flood a d
          where
            a = w .|. (diagonal w .&. open)
            d = b .|. (diagonal b .&. open)

        -- The mating net: can the other side's pawns and bishops catch the king asked about?
        attack | white = diagonal bBish .|. sideways (south bCone)
               | otherwise = diagonal wBish .|. sideways (north wCone)
        reach | white = wKing
              | otherwise = bKing
        free | white = complement (wCone .|. zone bKing .|. attack)   -- never occupied, attacked or next to the mater
             | otherwise = complement (bCone .|. zone wKing .|. attack)
        spare | white = free .&. complement wBish                     -- ... nor reached by the king's own bishops
              | otherwise = free .&. complement bBish
        -- A king next to a spare square, or with free squares beside it both ways, always has a flight.
        flight = sideways spare .|. north spare .|. south spare .|. ((north free .|. south free) .&. sideways free)
