{- |
Mateless's lock detector, second version, in its simplest form.

Can a side never be mated? The lock detector answers yes when pawns, kings and bishops (and
knights, rooks or queens boxed in by their own men) form a structure that no series of legal
moves can open (FIDE 5.2.2 dead position, 6.9 flag fall). It reads bitboards and the side to
move: it generates no move and searches nothing.

The first version (../../haskell/Lock.hs) grows each king's reach, the pawns that can never move,
and the squares where each side may take a pawn, until nothing changes; the structure leaks if a
pawn can promote or capture, a frozen king can move, a bishop can reach a pawn's path, or the
king asked about can reach a square the other side attacks without a sure flight. This version
keeps all of it and adds, each only where its situation is on the board:

  * open pawn pairs: a white and a black pawn on one file with one empty square between them;
    the reachable positions split into families by what the pair's pawns have done (neither
    moved, the white one stepped into the gap, the black one did), up to 3 pairs;
  * boxed knights, rooks and queens: a piece whose every step square holds one of its own men
    that never moves, and that no enemy king or bishop reaches, never moves nor falls;
  * twin bishops: two bishops of one side on one colour no longer fail it; the mating net
    leaves out its second flight rule where they may hold both flights;
  * the stalemate guard: a pawn the enemy king may take stays a wall if taking it always
    stalemates its owner;
  * the check seed: a king in a pawn's check starts its reach from the squares it can step to;
  * the stuck mater: whatever the flagged side plays, the mater is left without a move;
  * the forced step: a king in a pawn's check with one legal move, a step: the lock of the
    position after it.

A possible en passant capture fails it at once. Sound, not complete: a structure it passes can
never be opened; one it fails may still be dead.

Squares: a1 = 0, b1 = 1, ..., h8 = 63. A set of squares (a bitboard) is a 'Word64'.
-}
module Lock (Pieces(..), fromFen, cannotBeMated) where

import Data.Bits (bit, complement, countTrailingZeros, popCount, shiftL, shiftR, (.&.), (.|.))
import Data.Char (ord)
import Data.Maybe (fromMaybe, listToMaybe)
import Data.Word (Word64)

type Set = Word64

fileA, fileH, rank1, rank3, rank6, rank8, dark :: Set
fileA = 0x0101010101010101
fileH = 0x8080808080808080
rank1 = 0x00000000000000FF
rank3 = 0x0000000000FF0000
rank6 = 0x0000FF0000000000
rank8 = 0xFF00000000000000
dark  = 0xAA55AA55AA55AA55   -- the dark squares; a1 is dark

-- | The most open pairs the families are split on (3^3 = 27).
maxPairs :: Int
maxPairs = 3

north, south, sideways, zone, steps, diagonal, knight, no :: Set -> Set
north s = s `shiftL` 8
south s = s `shiftR` 8
sideways s = ((s `shiftL` 1) .&. no fileA) .|. ((s `shiftR` 1) .&. no fileH)
zone s = let v = s .|. north s .|. south s in v .|. sideways v  -- s and every square next to it
steps s = zone s .&. no s                                       -- the squares next to s
diagonal s = sideways (north s .|. south s)                     -- the squares diagonally next to s
knight s =                                                      -- the squares a knight on s goes to
  let one = sideways s
      two = ((s `shiftL` 2) .&. no (fileA .|. (fileA `shiftL` 1))) .|.
            ((s `shiftR` 2) .&. no (fileH .|. (fileH `shiftR` 1)))
  in north (north one) .|. south (south one) .|. north two .|. south two
no = complement                                                 -- every square not in s

count :: Set -> Int
count = popCount

-- | Each square of s, as a set of one square.
squares :: Set -> [Set]
squares 0 = []
squares s = (s .&. negate s) : squares (s .&. (s - 1))

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

-- | Every square a king may reach from k through squares of m.
flood :: Set -> Set -> Set
flood k m = let a = k .|. (zone k .&. m) in if a == k then k else flood a m

-- | Every square a bishop may reach from b by diagonal steps through squares of m.
glide :: Set -> Set -> Set
glide b m = let a = b .|. (diagonal b .&. m) in if a == b then b else glide a m

-- | What the lock detector reads from a position.
data Pieces = Pieces
  { whitePawns, blackPawns :: !Word64
  , whiteKing, blackKing :: !Word64
  , whiteBishops, blackBishops :: !Word64
  , whiteKnights, blackKnights :: !Word64
  , whiteRooks, blackRooks :: !Word64
  , whiteQueens, blackQueens :: !Word64
  , whiteToMove :: !Bool
  , enPassant :: !Bool   -- ^ the side to move can capture en passant
  }

-- | The pieces of a FEN. The en passant square counts only if a pawn can capture onto it.
fromFen :: String -> Pieces
fromFen fen = p { enPassant = ep }
  where
    (board, after) = break (== ' ') fen
    fields = words after
    toMove = listToMaybe fields /= Just "b"
    (_, _, p) = foldl place (7, 0, Pieces 0 0 0 0 0 0 0 0 0 0 0 0 toMove False) board
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
      'N' -> q { whiteKnights = whiteKnights q .|. sq }
      'n' -> q { blackKnights = blackKnights q .|. sq }
      'R' -> q { whiteRooks = whiteRooks q .|. sq }
      'r' -> q { blackRooks = blackRooks q .|. sq }
      'Q' -> q { whiteQueens = whiteQueens q .|. sq }
      'q' -> q { blackQueens = blackQueens q .|. sq }
      _ -> q
    ep = case drop 2 fields of   -- past the side to move and castling
      (f : r : _) : _ | f >= 'a' && f <= 'h' && r >= '1' && r <= '8' ->
        let target = bit ((ord f - ord 'a') + 8 * (ord r - ord '1'))
        in if toMove then (sideways (south target) .&. whitePawns p) /= 0
                     else (sideways (north target) .&. blackPawns p) /= 0
      _ -> False

-- | What one level grows to its fixed point, and leaves for the mating net (and for the families
-- after it).
data Sets = Sets
  { wCone, bCone :: !Set     -- ^ the pawns' cones: every square they may still reach
  , wFixed, bFixed :: !Set   -- ^ the pawns that can never move
  , wKing, bKing :: !Set     -- ^ every square each king may reach
  , wBish, bBish :: !Set     -- ^ every square each side's bishops may reach
  , wTake, bTake :: !Set     -- ^ the squares where each side may take an enemy pawn
  , wGuard, bGuard :: !Set   -- ^ the stalemate guard: each side's pawns whose capture stalemates it
  } deriving Eq

-- | What a level is asked to do besides the plain level.
data Opts = Opts
  { pawns :: Maybe (Set, Set)   -- ^ the pawns, if not the position's (a family's: a pair's pawn moved)
  , walls :: Set                -- ^ walls for both sides (the gaps of a family's pairs that stay)
  , start :: Maybe Sets         -- ^ where the kings' reaches, capture squares and bishops' reaches
                                --   start (a family's); its other sets are not read
  , boxedW, boxedB :: Set       -- ^ the boxed pieces' candidates
  , stepsW, stepsB :: Set       -- ^ their step squares
  , guarded :: Bool             -- ^ the stalemate guard and the check seed (plain levels only)
  }

plain :: Opts
plain = Opts Nothing 0 Nothing 0 0 0 0 False

-- | What the families of the open pairs say at one level.
data Families
  = Lock      -- ^ none of them leaks to the king asked about
  | Refuted   -- ^ family A (no pair's pawn has moved) leaks to it
  | Other     -- ^ another family leaks
  deriving Eq

-- | Can White (white = True) or Black never be mated, by the lock detector?
cannotBeMated :: Pieces -> Bool -> Bool
cannotBeMated p white
  | Just q <- forcedStep p = cannotBeMated q white
  | (wx .|. bx) /= 0 = boxedLock p white wx bx
  | enPassant p = False
  | otherwise = go (levels p)
  where
    wx = whiteKnights p .|. whiteRooks p .|. whiteQueens p
    bx = blackKnights p .|. blackRooks p .|. blackQueens p
    gaps = north (whitePawns p) .&. south (blackPawns p) .&. no (whitePawns p .|. blackPawns p)
    go [] = materStuck p white
    go (frozen : more)
      | gaps /= 0 && f == Lock = True
      | gaps /= 0 && f == Refuted = go more   -- family A, the level with more walls, leaked: the level leaks too
      | Just s <- level p frozen plain { guarded = True }, not (netLeaks p s white 0) = True
      | otherwise = go more
      where f = families p gaps frozen white

-- | The levels: both kings free (0), then each king frozen on its square (a wall for both sides)
-- when every square around it is held or attacked by a pawn.
levels :: Pieces -> [Set]
levels p = 0 : [king | king <- [whiteKing p, blackKing p], (steps king .&. no held) == 0]
  where held = whitePawns p .|. blackPawns p .|. sideways (north (whitePawns p) .|. south (blackPawns p))

-- | One level: the fixed point of the walls, the pawns that can never move, the kings' reaches, the
-- squares where each side may take a pawn, the pawns' cones and the bishops' reaches. The sets the
-- mating net reads, or Nothing when the structure leaks whichever side is asked about.
level :: Pieces -> Set -> Opts -> Maybe Sets
level p frozen o
  | ((wCone s .&. rank8) .|. (bCone s .&. rank1)) /= 0 = Nothing                    -- a pawn can promote
  | ((north (sideways (wCone s)) .&. (bCone s .|. bx)) .|. (south (sideways (bCone s)) .&. wx)) /= 0 =
      Nothing                                                                      -- a pawn can capture
  | (frozenWhite && wKing s /= wk) || (frozenBlack && bKing s /= bk) = Nothing     -- the frozen king can move
  | ((diagonal (wBish s) .&. bCone s) .|. (diagonal (bBish s) .&. wCone s)) /= 0 = Nothing   -- a bishop meets a pawn's path
  | ((stepsW o .&. no (wFixed s .|. (wx .&. boxedOf s))) .|. (stepsB o .&. no (bFixed s .|. (bx .&. boxedOf s)))) /= 0 =
      Nothing                                                                      -- a piece may step
  -- A king that takes a guarded pawn ends the game: for the mating net, the kings' reaches again,
  -- now stopping at the enemy's guarded pawns.
  | (wGuard s .|. bGuard s) /= 0 =
      Just s { wKing = flood wSeed (no (wFixed s .|. sideways (south (bFixed s)) .|. nearFrozenBlack .|. (bp .&. bGuard s)))
             , bKing = flood bSeed (no (bFixed s .|. sideways (north (wFixed s)) .|. nearFrozenWhite .|. (wp .&. wGuard s))) }
  | otherwise = Just s
  where
    (wp, bp) = fromMaybe (whitePawns p, blackPawns p) (pawns o)
    wk = whiteKing p
    bk = blackKing p
    wx = boxedW o
    bx = boxedB o
    v = walls o .|. frozen
    frozenWhite = (frozen .&. wk) /= 0
    frozenBlack = not frozenWhite && frozen /= 0
    nearFrozenBlack = if frozenBlack then zone bk else 0
    nearFrozenWhite = if frozenWhite then zone wk else 0
    (wSeed, bSeed) = if guarded o && frozen == 0 then checkSeed p else (wk, bk)
    nothingTaken = if guarded o then complement 0 else 0
    first = case start o of
      Just a -> a { wCone = wp, bCone = bp, wFixed = wp, bFixed = bp, wGuard = nothingTaken, bGuard = nothingTaken }
      Nothing -> Sets wp bp wp bp wSeed bSeed (whiteBishops p) (blackBishops p) wSeed bSeed nothingTaken nothingTaken
    s = settle first
    settle t = let n = pass t in if n == t then t else settle n
    -- Boxed: the pieces no enemy king or bishop reaches.
    boxedOf t = (wx .&. no (bKing t .|. bBish t)) .|. (bx .&. no (wKing t .|. wBish t))
    pass t = Sets nwCone nbCone nwFixed nbFixed nwKing nbKing nwBish nbBish nwTake nbTake nwGuard nbGuard
      where
        -- Walls: pawns the other side can never take (or whose capture stalemates their owner),
        -- the frozen king, the gaps, boxed pieces.
        boxed = boxedOf t
        wWall = (wp .&. no (bTake t .&. no (wGuard t))) .|. v .|. boxed
        bWall = (bp .&. no (wTake t .&. no (bGuard t))) .|. v .|. boxed
        nwFixed = wFixed t .&. wWall .&. south (bWall .|. wFixed t)
        nbFixed = bFixed t .&. bWall .&. north (wWall .|. bFixed t)
        nwCone = fillNorth (wCone t) (no bWall)
        nbCone = fillSouth (bCone t) (no wWall)
        -- The kings: never onto a fixed pawn, a square it attacks, or next to the frozen king.
        bHit = sideways (south nbFixed)
        wHit = sideways (north nwFixed)
        nwKing = flood (wKing t) (no (nwFixed .|. bHit .|. nearFrozenBlack))
        nbKing = flood (bKing t) (no (nbFixed .|. wHit .|. nearFrozenWhite))
        nwBish = glide (wBish t) (no (nwFixed .|. nbFixed))
        nbBish = glide (bBish t) (no (nwFixed .|. nbFixed))
        -- A side may take a pawn where its king goes, and on any square a pawn may walk into.
        tb = bTake t .|. nbKing
        nbTake = tb .|. south (fillSouth (tb .&. no bWall) (no bWall))
        tw = wTake t .|. nwKing
        nwTake = tw .|. north (fillNorth (tw .&. no wWall) (no wWall))
        block = nwFixed .|. nbFixed
        wHasB = whiteBishops p /= 0
        bHasB = blackBishops p /= 0
        nwGuard | not (guarded o) = wGuard t
                | wHasB = 0
                | otherwise = stalemateGuard (wp .&. nbTake .&. nwFixed) wp nwFixed nwKing (nwFixed .|. bHit) nbKing bHasB block
        nbGuard | not (guarded o) = bGuard t
                | bHasB = 0
                | otherwise = stalemateGuard (bp .&. nwTake .&. nbFixed) bp nbFixed nbKing (nbFixed .|. wHit) nwKing wHasB block

-- | The mating net: can the other side's pawns and bishops catch the king asked about? occ: squares
-- that stand occupied for good besides (the boxed pieces').
netLeaks :: Pieces -> Sets -> Bool -> Set -> Bool
netLeaks p s white occ = (attack .&. reach .&. no flight) /= 0
  where
    (attack, reach, ownBish, mater, ownCone, twins)
      | white = (diagonal (bBish s) .|. sideways (south (bCone s)), wKing s, wBish s, bKing s, wCone s, whiteBishops p)
      | otherwise = (diagonal (wBish s) .|. sideways (north (wCone s)), bKing s, bBish s, wKing s, bCone s, blackBishops p)
    free = no (ownCone .|. occ .|. zone mater .|. attack)   -- never occupied, attacked or next to the mater
    spare = free .&. no ownBish                             -- ... nor reached by the king's own bishops
    -- A king next to a spare square, or with free squares beside it both ways, always has a flight.
    -- The second rule counts on at most one of the king's own bishops on the colour of those two
    -- squares (the colour opposite the king's): not on the king squares where it has two or more.
    noPair = (if count (twins .&. dark) > 1 then no dark else 0) .|. (if count (twins .&. no dark) > 1 then dark else 0)
    flight = sideways spare .|. north spare .|. south spare .|.
             ((north free .|. south free) .&. sideways free .&. no noPair)

-- | The check seed: the side to move is in a pawn's check, so its king must step now, to a square
-- it can step to (not its own pawn, not a square an enemy pawn attacks, not next to the enemy
-- king); its reach starts there. Not when it has no such square (that may be a mate now), when one
-- of its pawns can take a checking pawn, or with a bishop on the board. The kings' starting sets.
checkSeed :: Pieces -> (Set, Set)
checkSeed p
  | (whiteBishops p .|. blackBishops p) /= 0 || checkers == 0 || to == 0 || takers /= 0 = (wk, bk)
  | white = (to, bk)
  | otherwise = (wk, to)
  where
    wp = whitePawns p
    bp = blackPawns p
    wk = whiteKing p
    bk = blackKing p
    white = whiteToMove p
    (k, own) = if white then (wk, wp) else (bk, bp)
    checkers = if white then sideways (north k) .&. bp else sideways (south k) .&. wp
    attacked = if white then sideways (south bp) else sideways (north wp)
    to = steps k .&. no own .&. no attacked .&. no (steps (if white then bk else wk))
    takers = (if white then sideways (south checkers) else sideways (north checkers)) .&. own

-- | The stalemate guard: of the owner's fixed pawns cand (which the enemy king may take), those
-- whose capture always stalemates the owner. The owner must have nothing else that moves (every
-- other pawn fixed; no bishop, which the caller sees to). reach: where the owner's king may stand;
-- shut: squares it can never step to (own fixed pawns, squares the enemy's fixed pawns attack);
-- enemyKing: the enemy king's reach; block: squares a bishop's line never crosses.
stalemateGuard :: Set -> Set -> Set -> Set -> Set -> Set -> Bool -> Set -> Set
stalemateGuard cand own ownFixed reach shut enemyKing enemyBishops block
  | (own .&. no ownFixed) /= 0 = 0
  | otherwise = foldr (.|.) 0 (filter held (squares cand))
  where
    -- The owner's king, wherever it stands not defending the pawn, has no square to step to, and
    -- the capture uncovers no check.
    held pawn = all stuck (squares (reach .&. no (near .|. pawn)))
      where
        near = steps pawn
        from = near .&. enemyKing   -- where the enemy king takes from
        x = shut .|. near .|. pawn  -- after the capture, the owner's king may not step there
        stuck king = (steps king .&. no x) == 0 && not (enemyBishops && rayMeets king (block .|. pawn) from)

-- | Does a diagonal line from the square king, stopped by block, meet a square of o?
rayMeets :: Set -> Set -> Set -> Bool
rayMeets king block o = any ray [(-1, -1), (1, -1), (-1, 1), (1, 1)]
  where
    sq = countTrailingZeros king
    ray (df, dr) = walk (sq `mod` 8 + df) (sq `div` 8 + dr)
      where
        walk f r
          | f < 0 || f > 7 || r < 0 || r > 7 = False
          | (o .&. s) /= 0 = True
          | (block .&. s) /= 0 = False
          | otherwise = walk (f + df) (r + dr)
          where s = bit (8 * r + f)

-- | The families of the open pairs at one level.
families :: Pieces -> Set -> Set -> Bool -> Families
families p gaps frozen white
  | k > maxPairs = Other
  | otherwise = go 0 []
  where
    pairs = [(gap, south gap, north gap) | gap <- squares gaps]   -- the gap, the white pawn below it, the black pawn above it
    k = length pairs
    -- Family f: digit i (base 3) says what pair i's pawns have done: 0 neither, 1 the white one
    -- stepped into the gap, 2 the black one did. Its sets start from those of the family it is
    -- reached from (the same with pair i's pawns in place), minus the gap. sets: families 0 .. f-1.
    go f sets
      | f == 3 ^ k = Lock
      | otherwise = case level p frozen plain { pawns = Just (wp, bp), walls = v, start = Just begin } of
          Nothing -> lost
          -- The pairs that stay: both pawns must never move.
          Just s
            | or [((w .&. no (wFixed s)) .|. (b .&. no (bFixed s))) /= 0 | (0, (_, w, b)) <- moves] -> Other
            | netLeaks p s white 0 -> lost
            | otherwise -> go (f + 1) (sets ++ [s])
      where
        lost = if f == 0 then Refuted else Other
        moves = [((f `div` (3 ^ i)) `mod` 3, pair) | (i, pair) <- zip [0 :: Int ..] pairs]
        v = foldr (.|.) 0 [gap | (0, (gap, _, _)) <- moves]   -- the gaps that stay: walls for both sides' pawns
        wp = foldl (\a (gap, w, _) -> (a .&. no w) .|. gap) (whitePawns p) [pair | (1, pair) <- moves]
        bp = foldl (\a (gap, _, b) -> (a .&. no b) .|. gap) (blackPawns p) [pair | (2, pair) <- moves]
        none = Sets 0 0 0 0 0 0 0 0 0 0 0 0
        base | f == 0 = none { wKing = whiteKing p, bKing = blackKing p, wTake = whiteKing p, bTake = blackKing p
                             , wBish = whiteBishops p, bBish = blackBishops p }
             | otherwise = none
        begin = foldl grow base [(sets !! (f - d * 3 ^ i), gap) | (i, (d, (gap, _, _))) <- zip [0 :: Int ..] moves, d /= 0]
        grow a (r, gap) = a { wKing = wKing a .|. (wKing r .&. no gap), bKing = bKing a .|. (bKing r .&. no gap)
                            , wTake = wTake a .|. wTake r, bTake = bTake a .|. bTake r
                            , wBish = wBish a .|. (wBish r .&. no gap), bBish = bBish a .|. (bBish r .&. no gap) }

-- | With knights, rooks or queens on the board: every one of them must be boxed in by its own pawns
-- and pieces; then the levels, with the boxed pieces as walls and no flight onto their squares.
boxedLock :: Pieces -> Bool -> Set -> Set -> Bool
boxedLock p white wx bx = case (ws, bs) of
  (Just w, Just b) | not (enPassant p) -> any (holds w b) (levels p)
  _ -> False
  where
    ws = boxSteps (whiteKnights p) (whiteRooks p .|. whiteQueens p) (whiteQueens p) (whitePawns p .|. wx)
    bs = boxSteps (blackKnights p) (blackRooks p .|. blackQueens p) (blackQueens p) (blackPawns p .|. bx)
    holds w b frozen = case level p frozen plain { boxedW = wx, boxedB = bx, stepsW = w, stepsB = b } of
      Just s -> not (netLeaks p s white (wx .|. bx))
      Nothing -> False

-- | The step squares of one side's knights, rooks (and queens: o) and queens, or Nothing when one of
-- them is not held by its own men (own).
boxSteps :: Set -> Set -> Set -> Set -> Maybe Set
boxSteps knights o queens own
  | (all' .&. no own) /= 0 = Nothing
  | otherwise = Just all'
  where all' = sideways o .|. north o .|. south o .|. diagonal queens .|. knight knights

-- | The stuck mater: the flagged side is to move and, whatever it plays, the mater has no legal move
-- left (kings and pawns only): the game ends at the mater's turn.
materStuck :: Pieces -> Bool -> Bool
materStuck p white
  | whiteToMove p /= white || enPassant p = False
  | (whiteBishops p .|. blackBishops p .|. whiteKnights p .|. blackKnights p .|. whiteRooks p .|.
     blackRooks p .|. whiteQueens p .|. blackQueens p) /= 0 = False
  -- A mater's pawn with an empty square ahead is never stuck; then only a stalemate now is left to
  -- find, which a flagged pawn's push rules out.
  | (back mp .&. no occ) /= 0 && (fwd fp .&. no occ) /= 0 = False
  | (fAttack .&. (mp .|. mk)) /= 0 = False                       -- 1. the flagged side has no capture
  | inCheck && kingTo == 0 = False                               -- mated now
  | kingTo == 0 && not stays = True                              -- no move, no check: stalemate now
  -- 2. the mater's pawns are blocked by men that stay, and attack no flagged pawn
  | ((back mp .&. no blockers) .|. (mAttack .&. fp)) /= 0 = False
  -- 3. every square next to the mater's king: its own pawn, attacked by a flagged pawn that cannot
  --    move now, or next to the flagged king wherever it goes
  | (near .&. no (mp .|. sideways (fwd still) .|. cover)) /= 0 = False
  -- 4. no push lands where a mater's pawn attacks or next to its king, nor lets it take en passant
  | ((pushes .&. (mAttack .|. near)) .|. (double .&. sideways mp)) /= 0 = False
  | otherwise = True
  where
    (fp, mp, fk, mk)
      | white = (whitePawns p, blackPawns p, whiteKing p, blackKing p)
      | otherwise = (blackPawns p, whitePawns p, blackKing p, whiteKing p)
    occ = fp .|. mp .|. fk .|. mk
    fwd = if white then north else south   -- ahead, for the flagged side
    back = if white then south else north  -- behind
    fAttack = sideways (fwd fp)
    mAttack = sideways (back mp)
    single = fwd fp .&. no occ
    double = fwd (single .&. (if white then rank3 else rank6)) .&. no occ
    pushes = single .|. double
    near = steps mk
    kingTo = steps fk .&. no fp .&. no mAttack .&. no near       -- the flagged king's steps now
    inCheck = (fk .&. mAttack) /= 0
    stays = pushes /= 0 && not inCheck                           -- a pawn may move instead of the king
    -- The squares next to every square the flagged king may stand on after its move.
    cover = foldl (.&.) (if stays then steps fk else complement 0) (map steps (squares kingTo))
    blockers = fp .|. mp .|. mk .|. (if kingTo == 0 then fk else 0)
    still = fp .&. back (fwd fp .&. occ)

-- | The forced step: the side to move is in a pawn's check, with kings and pawns only, and its one
-- legal move is a step of its king. The position after it, or Nothing.
forcedStep :: Pieces -> Maybe Pieces
forcedStep p
  | enPassant p = Nothing
  | (whiteBishops p .|. blackBishops p .|. whiteKnights p .|. blackKnights p .|. whiteRooks p .|.
     blackRooks p .|. whiteQueens p .|. blackQueens p) /= 0 = Nothing
  | checkers == 0 || count to /= 1 = Nothing
  | takers /= 0 = Nothing   -- a pawn may take instead
  | white = Just p { whiteToMove = False, enPassant = False, whiteKing = to, blackPawns = blackPawns p .&. no to }
  | otherwise = Just p { whiteToMove = True, enPassant = False, blackKing = to, whitePawns = whitePawns p .&. no to }
  where
    white = whiteToMove p
    (k, ek, own, enemy)
      | white = (whiteKing p, blackKing p, whitePawns p, blackPawns p)
      | otherwise = (blackKing p, whiteKing p, blackPawns p, whitePawns p)
    checkers = (if white then sideways (north k) else sideways (south k)) .&. enemy
    attacked = if white then sideways (south enemy) else sideways (north enemy)
    to = steps k .&. no own .&. no attacked .&. no (steps ek)
    takers = (if white then sideways (south checkers) else sideways (north checkers)) .&. own
