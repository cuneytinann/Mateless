-- Mateless's lock detector, second version, in its simplest form.
--
-- Can a side never be mated? The lock detector answers yes when pawns, kings and bishops (and
-- knights, rooks or queens boxed in by their own men) form a structure that no series of legal
-- moves can open (FIDE 5.2.2 dead position, 6.9 flag fall). It reads bitboards and the side to
-- move and searches nothing: only its last rule looks at moves, those of kings, pawns and bishops,
-- two plies at most.
--
-- The first version (../../lua/lock.lua) grows each king's reach, the pawns that can never move,
-- and the squares where each side may take a pawn, until nothing changes; the structure leaks if a
-- pawn can promote or capture, a frozen king can move, a bishop can reach a pawn's path, or the
-- king asked about can reach a square the other side attacks without a sure flight. This version
-- keeps all of it and adds, each only where its situation is on the board:
--   - open pawn pairs: a white and a black pawn on one file with one empty square between them;
--     the reachable positions split into families by what the pair's pawns have done (neither
--     moved, the white one stepped into the gap, the black one did), up to 3 pairs;
--   - boxed knights, rooks and queens: a piece whose every step square holds one of its own men
--     that never moves, and that no enemy king or bishop reaches, never moves nor falls; such a man
--     is a fixed pawn, another boxed piece, a still bishop (every diagonal neighbour held so, and out
--     of the enemy king's and bishops' reach) or the piece's own frozen king (its side with no
--     castling right left and not standing where a castle leaves it beside its rook);
--   - twin bishops: two bishops of one side on one colour no longer fail it; the mating net leaves
--     out its second flight rule where they may hold both flights;
--   - the stalemate guard: a pawn the enemy king may take stays a wall if taking it always
--     stalemates its owner;
--   - the check seed: a king in a pawn's check starts its reach from the squares it can step to;
--   - the stuck mater: whatever the flagged side plays, the mater is left without a move;
--   - the forced step: a king in a pawn's check with one legal move, a step: the lock of the
--     position after it;
--   - the stalemated flagged side: a king and pawns that, whatever the mater (a king, pawns and
--     bishops) plays, is left without a legal move and out of check, now or after the one legal
--     move it has.
-- A possible en passant capture fails it at once. Sound, not complete: a structure it passes can
-- never be opened; one it fails may still be dead.
--
-- Squares: a1 = 0, b1 = 1, ..., h8 = 63. A set of squares (a bitboard) is a 64-bit integer.
-- Needs Lua 5.3 or later, for its 64-bit integers and bitwise operators (>> is logical).

local lock = {}

-- FILE_H, RANK_8 and DARK do not fit a signed integer: they wrap to negative ones, with the same bits.
local FILE_A = 0x0101010101010101
local FILE_H = 0x8080808080808080
local RANK_1 = 0x00000000000000FF
local RANK_3 = 0x0000000000FF0000
local RANK_6 = 0x0000FF0000000000
local RANK_8 = 0xFF00000000000000
local DARK = 0xAA55AA55AA55AA55     -- the dark squares; a1 is dark
local MAX_PAIRS = 3                 -- the most open pairs the families are split on (3^3 = 27)

local function north(s) return s << 8 end
local function south(s) return s >> 8 end
local function sideways(s) return ((s << 1) & ~FILE_A) | ((s >> 1) & ~FILE_H) end
local function zone(s) local v = s | north(s) | south(s); return v | sideways(v) end  -- s and every square next to it
local function steps(s) return zone(s) & ~s end                                      -- the squares next to s
local function diagonal(s) return sideways(north(s) | south(s)) end                  -- the squares diagonally next to s
local function count(s) local n = 0; while s ~= 0 do s = s & (s - 1); n = n + 1 end; return n end

-- The squares a knight on s goes to.
local function knight(s)
  local one = sideways(s)
  local two = ((s << 2) & ~(FILE_A | (FILE_A << 1))) | ((s >> 2) & ~(FILE_H | (FILE_H >> 1)))
  return north(north(one)) | south(south(one)) | north(two) | south(two)
end

-- Every square reachable from g by steps north through squares of p.
local function fill_north(g, p)
  g = g | (p & (g << 8))
  p = p & (p << 8)
  g = g | (p & (g << 16))
  p = p & (p << 16)
  return g | (p & (g << 32))
end

-- Every square reachable from g by steps south through squares of p.
local function fill_south(g, p)
  g = g | (p & (g >> 8))
  p = p & (p >> 8)
  g = g | (p & (g >> 16))
  p = p & (p >> 16)
  return g | (p & (g >> 32))
end

-- Every square a king may reach from k through squares of m.
local function flood(k, m)
  while true do
    local a = k | (zone(k) & m)
    if a == k then return k end
    k = a
  end
end

--- What the lock detector reads from a position.
---@class Pieces
---@field white_pawns integer
---@field black_pawns integer
---@field white_king integer
---@field black_king integer
---@field white_bishops integer
---@field black_bishops integer
---@field white_knights integer
---@field black_knights integer
---@field white_rooks integer
---@field black_rooks integer
---@field white_queens integer
---@field black_queens integer
---@field white_to_move boolean
---@field en_passant boolean  the side to move can capture en passant
---@field white_castles boolean  White has a castling right (its king and that rook in place)
---@field black_castles boolean

-- The one-square sets of s.
local function squares(s)
  local out = {}
  while s ~= 0 do
    local b = s & -s
    out[#out + 1] = b
    s = s ~ b
  end
  return out
end

-- The square of a one-square set.
local function square_of(b)
  local n = 0
  while b ~= 1 do b = b >> 1; n = n + 1 end
  return n
end

-- The pieces of a FEN. The en passant square counts only if a pawn can capture onto it.
function lock.from_fen(fen)
  local fields = {}
  for field in fen:gmatch("%S+") do fields[#fields + 1] = field end
  local sets = { P = 0, p = 0, K = 0, k = 0, B = 0, b = 0, N = 0, n = 0, R = 0, r = 0, Q = 0, q = 0 }
  local rank, file = 7, 0
  for c in fields[1]:gmatch(".") do
    if c == "/" then
      rank, file = rank - 1, 0
    elseif c:match("%d") then
      file = file + tonumber(c)
    else
      sets[c] = sets[c] | 1 << (8 * rank + file)
      file = file + 1
    end
  end
  local white_to_move = #fields < 2 or fields[2] == "w"
  local en_passant = false
  if #fields > 3 and fields[4] ~= "-" then
    local target = 1 << (fields[4]:byte(1) - ("a"):byte() + 8 * (tonumber(fields[4]:sub(2, 2)) - 1))
    if white_to_move then
      en_passant = (sideways(south(target)) & sets.P) ~= 0
    else
      en_passant = (sideways(north(target)) & sets.p) ~= 0
    end
  end
  local castles = { [true] = false, [false] = false }
  local rights = fields[3] or "-"
  if rights ~= "-" then
    for c in rights:gmatch(".") do
      local white = c == c:upper()
      local back = white and RANK_1 or RANK_8
      local king = (white and sets.K or sets.k) & back
      local rooks = (white and sets.R or sets.r) & back
      if king ~= 0 then   -- a right without its king in place does not count
        local kf, up, ok = square_of(king) % 8, c:upper(), false
        for _, r in ipairs(squares(rooks)) do
          local f = square_of(r) % 8
          if (up == "K" and f > kf) or (up == "Q" and f < kf) or
             (up ~= "K" and up ~= "Q" and f == up:byte() - ("A"):byte() and f ~= kf) then ok = true end
        end
        castles[white] = castles[white] or ok
      end
    end
  end
  return {
    white_pawns = sets.P, black_pawns = sets.p, white_king = sets.K, black_king = sets.k,
    white_bishops = sets.B, black_bishops = sets.b, white_knights = sets.N, black_knights = sets.n,
    white_rooks = sets.R, black_rooks = sets.r, white_queens = sets.Q, black_queens = sets.q,
    white_to_move = white_to_move, en_passant = en_passant,
    white_castles = castles[true], black_castles = castles[false],
  }
end

-- The levels: both kings free (0), then each king frozen on its square (a wall for both sides)
-- when every square around it is held or attacked by a pawn (or holds one of its own pieces, w_own
-- or b_own, where boxed pieces are on the board).
local function levels(p, w_own, b_own)
  local held = p.white_pawns | p.black_pawns | sideways(north(p.white_pawns) | south(p.black_pawns))
  local out = { 0 }
  for _, ko in ipairs({ { p.white_king, w_own or 0 }, { p.black_king, b_own or 0 } }) do
    if steps(ko[1]) & ~(held | ko[2]) == 0 then out[#out + 1] = ko[1] end
  end
  return out
end

-- May this side's king hold a boxed piece's step square (when frozen)? Not with a castling right
-- left (a castling rook may stand beside its king, in Chess960, and castling moves it), and not
-- where a castle leaves it beside its rook (g1 with a rook on f1, c1 with one on d1; g8, f8, c8,
-- d8): a castle leaves the halfmove clock as it is, so the lock is not asked after one.
local function king_wall(p, white)
  local king, rooks, castles, g, c
  if white then
    king, rooks, castles, g, c = p.white_king, p.white_rooks, p.white_castles, 1 << 6, 1 << 2
  else
    king, rooks, castles, g, c = p.black_king, p.black_rooks, p.black_castles, 1 << 62, 1 << 58
  end
  return not castles and rooks & (((king & g) >> 1) | ((king & c) << 1)) == 0
end

-- The still bishops among b: every diagonal neighbour held for good (held: fixed pawns and boxed
-- pieces of their colour) or by another still bishop, and out of the enemy king's and bishops'
-- reach. Such a bishop never moves and is never taken (a pawn taking it fails the bishop contact
-- test). The largest such set.
local function still_bishops(b, held, reach)
  local s = b & ~reach
  while true do
    local n = 0
    for _, q in ipairs(squares(s)) do
      if diagonal(q) & ~(held | s) == 0 then n = n | q end
    end
    if n == s then return s end
    s = n
  end
end

-- The check seed: the side to move is in a pawn's check, so its king must step now, to a square it
-- can step to (not its own pawn, not a square an enemy pawn attacks, not next to the enemy king);
-- its reach starts there. Not when it has no such square (that may be a mate now), when one of its
-- pawns can take a checking pawn, or with a bishop on the board. The kings' starting sets.
local function check_seed(p)
  local wp, bp, wk, bk, white = p.white_pawns, p.black_pawns, p.white_king, p.black_king, p.white_to_move
  if p.white_bishops | p.black_bishops ~= 0 then return wk, bk end
  local k, own = bk, bp
  if white then k, own = wk, wp end
  local checkers = white and (sideways(north(k)) & bp) or (sideways(south(k)) & wp)
  if checkers == 0 then return wk, bk end
  local attacked = white and sideways(south(bp)) or sideways(north(wp))
  local to = steps(k) & ~own & ~attacked & ~steps(white and bk or wk)
  local takers = (white and sideways(south(checkers)) or sideways(north(checkers))) & own
  if to == 0 or takers ~= 0 then return wk, bk end
  if white then return to, bk end
  return wk, to
end

-- Does a diagonal line from the square king, stopped by block, meet a square of o?
local function ray_meets(king, block, o)
  local sq = 0
  while (king >> sq) & 1 == 0 do sq = sq + 1 end
  for _, d in ipairs({ { -1, -1 }, { 1, -1 }, { -1, 1 }, { 1, 1 } }) do
    local f, r = (sq & 7) + d[1], (sq >> 3) + d[2]
    while f >= 0 and f < 8 and r >= 0 and r < 8 do
      local s = 1 << (8 * r + f)
      if o & s ~= 0 then return true end
      if block & s ~= 0 then break end
      f, r = f + d[1], r + d[2]
    end
  end
  return false
end

-- The stalemate guard: of the owner's fixed pawns cand (which the enemy king may take), those whose
-- capture always stalemates the owner. The owner must have nothing else that moves (every other
-- pawn fixed; no bishop, which the caller sees to). reach: where the owner's king may stand; shut:
-- squares it can never step to (own fixed pawns, squares the enemy's fixed pawns attack);
-- enemy_king: the enemy king's reach; block: squares a bishop's line never crosses.
local function stalemate_guard(cand, own, own_fixed, reach, shut, enemy_king, enemy_bishops, block)
  if own & ~own_fixed ~= 0 then return 0 end
  local guard, c = 0, cand
  while c ~= 0 do
    local pawn = c & -c
    c = c & (c - 1)
    local near = steps(pawn)
    local from = near & enemy_king     -- where the enemy king takes from
    local x = shut | near | pawn       -- after the capture, the owner's king may not step there
    local held = true
    local k = reach & ~(near | pawn)   -- the owner's king, not defending the pawn
    while k ~= 0 do
      local king = k & -k
      k = k & (k - 1)
      if steps(king) & ~x ~= 0 or (enemy_bishops and ray_meets(king, block | pawn, from)) then
        held = false                   -- it has a square to step to, or the capture uncovers a check
        break
      end
    end
    if held then guard = guard | pawn end
  end
  return guard
end

-- One level: the fixed point of the walls, the pawns that can never move, the kings' reaches, the
-- squares where each side may take a pawn, the pawns' cones and the bishops' reaches. The sets the
-- mating net reads, or nil when the structure leaks whichever side is asked about.
-- o.wp, o.bp: the pawns (a family has a pair's pawn moved into its gap); o.v: walls for both sides
-- (the gaps of a family's pairs that stay); o.start: where the kings' reaches, capture squares and
-- bishops' reaches start (a family's); o.wx, bx, ws, bs: the boxed pieces' candidates and their
-- step squares; o.guard: the stalemate guard and the check seed (plain levels only).
local function level(p, frozen, o)
  local wp, bp = o.wp or p.white_pawns, o.bp or p.black_pawns
  local wk, bk = p.white_king, p.black_king
  local wx, bx, ws, bs, v = o.wx or 0, o.bx or 0, o.ws or 0, o.bs or 0, (o.v or 0) | frozen
  local frozen_white = frozen & wk ~= 0
  local frozen_black = not frozen_white and frozen ~= 0
  local near_frozen_black = frozen_black and zone(bk) or 0
  local near_frozen_white = frozen_white and zone(wk) or 0
  local w_seed, b_seed = wk, bk
  if o.guard and frozen == 0 then w_seed, b_seed = check_seed(p) end
  local w_king, b_king, w_take, b_take, w_bish, b_bish = w_seed, b_seed, w_seed, b_seed, p.white_bishops, p.black_bishops
  if o.start then
    w_king, b_king, w_take, b_take, w_bish, b_bish = o.start[1], o.start[2], o.start[3], o.start[4], o.start[5], o.start[6]
  end
  local w_cone, b_cone, w_fixed, b_fixed = wp, bp, wp, bp
  local w_guard, b_guard = 0, 0
  if o.guard then w_guard, b_guard = ~0, ~0 end   -- nothing is taken yet
  while true do
    -- Boxed: the pieces no enemy king or bishop reaches. Walls: pawns the other side can never
    -- take (or whose capture stalemates their owner), the frozen king, the gaps, boxed pieces.
    local boxed = (wx & ~(b_king | b_bish)) | (bx & ~(w_king | w_bish))
    local w_wall = (wp & ~(b_take & ~w_guard)) | v | boxed
    local b_wall = (bp & ~(w_take & ~b_guard)) | v | boxed
    local nw_fixed = w_fixed & w_wall & south(b_wall | w_fixed)
    local nb_fixed = b_fixed & b_wall & north(w_wall | b_fixed)
    local nw_cone, nb_cone = fill_north(w_cone, ~b_wall), fill_south(b_cone, ~w_wall)
    -- The kings: never onto a fixed pawn, a square it attacks, or next to the frozen king.
    local b_hit, w_hit = sideways(south(nb_fixed)), sideways(north(nw_fixed))
    -- With boxed pieces on the board, never onto its own boxed pieces and still bishops either.
    local w_still, b_still = 0, 0
    if wx | bx ~= 0 then
      w_still = still_bishops(p.white_bishops, nw_fixed | (wx & boxed), b_king | b_bish)
      b_still = still_bishops(p.black_bishops, nb_fixed | (bx & boxed), w_king | w_bish)
    end
    local nw_king = flood(w_king, ~(nw_fixed | b_hit | near_frozen_black | (wx & boxed) | w_still))
    local nb_king = flood(b_king, ~(nb_fixed | w_hit | near_frozen_white | (bx & boxed) | b_still))
    local nw_bish, nb_bish, open = w_bish, b_bish, ~(nw_fixed | nb_fixed)
    while true do
      local a, d = nw_bish | (diagonal(nw_bish) & open), nb_bish | (diagonal(nb_bish) & open)
      if a == nw_bish and d == nb_bish then break end
      nw_bish, nb_bish = a, d
    end
    -- A side may take a pawn where its king goes, and on any square a pawn may walk into.
    local t = b_take | nb_king
    local nb_take = t | south(fill_south(t & ~b_wall, ~b_wall))
    t = w_take | nw_king
    local nw_take = t | north(fill_north(t & ~w_wall, ~w_wall))
    local nw_guard, nb_guard = w_guard, b_guard
    if o.guard then
      local block = nw_fixed | nb_fixed
      local w_has_b, b_has_b = p.white_bishops ~= 0, p.black_bishops ~= 0
      nw_guard = w_has_b and 0 or stalemate_guard(wp & nb_take & nw_fixed, wp, nw_fixed, nw_king, nw_fixed | b_hit, nb_king, b_has_b, block)
      nb_guard = b_has_b and 0 or stalemate_guard(bp & nw_take & nb_fixed, bp, nb_fixed, nb_king, nb_fixed | w_hit, nw_king, w_has_b, block)
    end
    local changed = nw_cone ~= w_cone or nb_cone ~= b_cone or nw_fixed ~= w_fixed or nb_fixed ~= b_fixed or
                    nw_king ~= w_king or nb_king ~= b_king or nw_bish ~= w_bish or nb_bish ~= b_bish or
                    nw_take ~= w_take or nb_take ~= b_take or nw_guard ~= w_guard or nb_guard ~= b_guard
    w_cone, b_cone, w_fixed, b_fixed, w_king, b_king = nw_cone, nb_cone, nw_fixed, nb_fixed, nw_king, nb_king
    w_bish, b_bish, w_take, b_take, w_guard, b_guard = nw_bish, nb_bish, nw_take, nb_take, nw_guard, nb_guard
    if not changed then break end
  end
  local boxed = (wx & ~(b_king | b_bish)) | (bx & ~(w_king | w_bish))
  if (w_cone & RANK_8) | (b_cone & RANK_1) ~= 0 then return nil end                              -- a pawn can promote
  if (north(sideways(w_cone)) & (b_cone | bx)) | (south(sideways(b_cone)) & wx) ~= 0 then return nil end  -- a pawn can capture
  if (frozen_white and w_king ~= wk) or (frozen_black and b_king ~= bk) then return nil end     -- the frozen king can move
  if (diagonal(w_bish) & b_cone) | (diagonal(b_bish) & w_cone) ~= 0 then return nil end          -- a bishop meets a pawn's path
  -- A piece may step: a step square not held by a fixed pawn, a boxed piece or a still bishop of its
  -- colour, or by its frozen king (where the king may be a wall).
  local w_still, b_still = 0, 0
  if wx | bx ~= 0 then
    w_still = still_bishops(p.white_bishops, w_fixed | (wx & boxed), b_king | b_bish)
    b_still = still_bishops(p.black_bishops, b_fixed | (bx & boxed), w_king | w_bish)
  end
  local w_kw = (frozen_white and king_wall(p, true)) and wk or 0
  local b_kw = (frozen_black and king_wall(p, false)) and bk or 0
  if (ws & ~(w_fixed | (wx & boxed) | w_still | w_kw)) | (bs & ~(b_fixed | (bx & boxed) | b_still | b_kw)) ~= 0 then return nil end  -- a piece may step
  if w_guard | b_guard ~= 0 then
    -- A king that takes a guarded pawn ends the game: for the mating net, the kings' reaches
    -- again, now stopping at the enemy's guarded pawns.
    w_king = flood(w_seed, ~(w_fixed | sideways(south(b_fixed)) | near_frozen_black | (bp & b_guard)))
    b_king = flood(b_seed, ~(b_fixed | sideways(north(w_fixed)) | near_frozen_white | (wp & w_guard)))
  end
  return { w_cone = w_cone, b_cone = b_cone, w_fixed = w_fixed, b_fixed = b_fixed, w_king = w_king, b_king = b_king,
           w_bish = w_bish, b_bish = b_bish, w_take = w_take, b_take = b_take }
end

-- The mating net: can the other side's pawns and bishops catch the king asked about? occ: squares
-- that stand occupied for good besides (the boxed pieces').
local function net_leaks(p, s, white, occ)
  local attack, reach, free, spare, twins
  if white then
    attack = diagonal(s.b_bish) | sideways(south(s.b_cone))
    reach = s.w_king
    free = ~(s.w_cone | occ | zone(s.b_king) | attack)   -- never occupied, attacked or next to the mater
    spare = free & ~s.w_bish                             -- ... nor reached by the king's own bishops
    twins = p.white_bishops
  else
    attack = diagonal(s.w_bish) | sideways(north(s.w_cone))
    reach = s.b_king
    free = ~(s.b_cone | occ | zone(s.w_king) | attack)
    spare = free & ~s.b_bish
    twins = p.black_bishops
  end
  -- A king next to a spare square, or with free squares beside it both ways, always has a flight.
  -- The second rule counts on at most one of the king's own bishops on the colour of those two
  -- squares (the colour opposite the king's): not on the king squares where it has two or more.
  local no_pair = (count(twins & DARK) > 1 and ~DARK or 0) | (count(twins & ~DARK) > 1 and DARK or 0)
  local flight = sideways(spare) | north(spare) | south(spare) |
                 ((north(free) | south(free)) & sideways(free) & ~no_pair)
  return attack & reach & ~flight ~= 0
end

-- The families of the open pairs at one level: "lock" when none of them leaks to the king asked
-- about, "refuted" when family A (no pair's pawn has moved) does, "none" otherwise.
local function families(p, gaps, frozen, white)
  local pair = {}   -- per pair: the gap, the white pawn below it, the black pawn above it
  local g = gaps
  while g ~= 0 do
    local gap = g & -g
    g = g & (g - 1)
    pair[#pair + 1] = { gap, south(gap), north(gap) }
  end
  if #pair > MAX_PAIRS then return "none" end
  local k, sets = #pair, {}
  for f = 0, 3 ^ k - 1 do
    -- Family f: digit i (base 3) says what pair i's pawns have done: 0 neither, 1 the white one
    -- stepped into the gap, 2 the black one did. Its sets start from those of the family it is
    -- reached from (the same with pair i's pawns in place), minus the gap.
    local wp, bp, v = p.white_pawns, p.black_pawns, 0
    local start = { 0, 0, 0, 0, 0, 0 }
    if f == 0 then start = { p.white_king, p.black_king, p.white_king, p.black_king, p.white_bishops, p.black_bishops } end
    local q, pow = f, 1
    for i = 1, k do
      local d = q % 3
      local gap, w, b = pair[i][1], pair[i][2], pair[i][3]
      if d == 0 then
        v = v | gap   -- the gap stays: a wall for both sides' pawns
      else
        if d == 1 then wp = (wp & ~w) | gap else bp = (bp & ~b) | gap end
        local r = sets[f - d * pow]
        start[1] = start[1] | (r.w_king & ~gap)
        start[2] = start[2] | (r.b_king & ~gap)
        start[3] = start[3] | r.w_take
        start[4] = start[4] | r.b_take
        start[5] = start[5] | (r.w_bish & ~gap)
        start[6] = start[6] | (r.b_bish & ~gap)
      end
      q, pow = q // 3, pow * 3
    end
    local s = level(p, frozen, { wp = wp, bp = bp, v = v, start = start })
    if not s then return f == 0 and "refuted" or "none" end
    -- The pairs that stay: both pawns must never move.
    q = f
    for i = 1, k do
      if q % 3 == 0 and (pair[i][2] & ~s.w_fixed) | (pair[i][3] & ~s.b_fixed) ~= 0 then return "none" end
      q = q // 3
    end
    if net_leaks(p, s, white, 0) then return f == 0 and "refuted" or "none" end
    sets[f] = s
  end
  return "lock"
end

-- The step squares of one side's knights, rooks (and queens: o) and queens.
local function box_steps(knights, o, queens)
  return sideways(o) | north(o) | south(o) | diagonal(queens) | knight(knights)
end

-- With knights, rooks or queens on the board: every one of them must be boxed in by its own pawns
-- and pieces (bishops and the king among them: the level checks that they never move); then the
-- levels, with the boxed pieces as walls and no flight onto their squares.
local function boxed_lock(p, white, wx, bx)
  local w_own = p.white_pawns | wx | p.white_bishops | (king_wall(p, true) and p.white_king or 0)
  local b_own = p.black_pawns | bx | p.black_bishops | (king_wall(p, false) and p.black_king or 0)
  local ws = box_steps(p.white_knights, p.white_rooks | p.white_queens, p.white_queens)
  local bs = box_steps(p.black_knights, p.black_rooks | p.black_queens, p.black_queens)
  if ws & ~w_own ~= 0 or bs & ~b_own ~= 0 or p.en_passant then return false end
  for _, frozen in ipairs(levels(p, wx | p.white_bishops, bx | p.black_bishops)) do
    local s = level(p, frozen, { wx = wx, bx = bx, ws = ws, bs = bs })
    if s and not net_leaks(p, s, white, wx | bx) then return true end
  end
  return false
end

-- The stuck mater: the flagged side is to move and, whatever it plays, the mater has no legal move
-- left (kings and pawns only): the game ends at the mater's turn.
local function stuck_mater(p, white)
  if p.white_to_move ~= white or p.en_passant then return false end
  if p.white_bishops | p.black_bishops | p.white_knights | p.black_knights | p.white_rooks |
     p.black_rooks | p.white_queens | p.black_queens ~= 0 then return false end
  local fp, mp, fk, mk = p.white_pawns, p.black_pawns, p.white_king, p.black_king
  local fwd, back, start = north, south, RANK_3   -- ahead and behind, for the flagged side; its double steps' rank
  if not white then fp, mp, fk, mk, fwd, back, start = p.black_pawns, p.white_pawns, p.black_king, p.white_king, south, north, RANK_6 end
  local occ = fp | mp | fk | mk
  -- A mater's pawn with an empty square ahead is never stuck; then only a stalemate now is left to
  -- find, which a flagged pawn's push rules out.
  if back(mp) & ~occ ~= 0 and fwd(fp) & ~occ ~= 0 then return false end
  local f_attack, m_attack = sideways(fwd(fp)), sideways(back(mp))
  if f_attack & (mp | mk) ~= 0 then return false end              -- 1. the flagged side has no capture
  local single = fwd(fp) & ~occ
  local double = fwd(single & start) & ~occ
  local pushes = single | double
  local near = steps(mk)
  local king_to = steps(fk) & ~fp & ~m_attack & ~near              -- the flagged king's steps now
  local in_check = fk & m_attack ~= 0
  if in_check and king_to == 0 then return false end              -- mated now
  local stays = pushes ~= 0 and not in_check                      -- a pawn may move instead of the king
  if king_to == 0 and not stays then return true end              -- no move, no check: stalemate now
  -- The squares next to every square the flagged king may stand on after its move.
  local cover = stays and steps(fk) or ~0
  local k = king_to
  while k ~= 0 do
    cover = cover & steps(k & -k)
    k = k & (k - 1)
  end
  -- 2. the mater's pawns are blocked by men that stay, and attack no flagged pawn
  local blockers = fp | mp | mk | (king_to == 0 and fk or 0)
  if (back(mp) & ~blockers) | (m_attack & fp) ~= 0 then return false end
  -- 3. every square next to the mater's king: its own pawn, attacked by a flagged pawn that cannot
  --    move now, or next to the flagged king wherever it goes
  local still = fp & back(fwd(fp) & occ)
  if near & ~(mp | sideways(fwd(still)) | cover) ~= 0 then return false end
  -- 4. no push lands where a mater's pawn attacks or next to its king, nor lets it take en passant
  return (pushes & (m_attack | near)) | (double & sideways(mp)) == 0
end

-- The forced step: the side to move is in a pawn's check, with kings and pawns only, and its one
-- legal move is a step of its king. The position after it, or nil.
local function forced_step(p)
  if p.en_passant or p.white_bishops | p.black_bishops | p.white_knights | p.black_knights | p.white_rooks |
     p.black_rooks | p.white_queens | p.black_queens ~= 0 then return nil end
  local white = p.white_to_move
  local k, ek, own, enemy = p.black_king, p.white_king, p.black_pawns, p.white_pawns
  if white then k, ek, own, enemy = p.white_king, p.black_king, p.white_pawns, p.black_pawns end
  local checkers = (white and sideways(north(k)) or sideways(south(k))) & enemy
  if checkers == 0 then return nil end
  local attacked = white and sideways(south(enemy)) or sideways(north(enemy))
  local to = steps(k) & ~own & ~attacked & ~steps(ek)
  if count(to) ~= 1 then return nil end
  if (white and sideways(south(checkers)) or sideways(north(checkers))) & own ~= 0 then return nil end  -- a pawn may take instead
  local q = {}
  for key, value in pairs(p) do q[key] = value end
  q.white_to_move, q.en_passant = not white, false
  if white then
    q.white_king, q.black_pawns = to, p.black_pawns & ~to
  else
    q.black_king, q.white_pawns = to, p.white_pawns & ~to
  end
  return q
end

-- ─── The stalemated flagged side ────────────────────────────────────────────────────────────
-- Men as 12 sets, from index 0: White's pawns, knights, bishops, rooks, queens and king, then Black's.
local PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING = 0, 1, 2, 3, 4, 5
local DIAGONALS = { { 1, 1 }, { -1, 1 }, { 1, -1 }, { -1, -1 } }
local LINES = { { 1, 0 }, { -1, 0 }, { 0, 1 }, { 0, -1 } }

-- The squares from the square s in the direction (df, dr), up to the first man (included).
local function ray(s, df, dr, occ)
  local sq = square_of(s)
  local f, r, out = sq % 8 + df, sq // 8 + dr, 0
  while f >= 0 and f < 8 and r >= 0 and r < 8 do
    local t = 1 << (8 * r + f)
    out = out | t
    if occ & t ~= 0 then break end
    f, r = f + df, r + dr
  end
  return out
end

-- Every man of side (0 White, 1 Black).
local function men(m, side)
  local b = 6 * side
  return m[b] | m[b + 1] | m[b + 2] | m[b + 3] | m[b + 4] | m[b + 5]
end

local function forward(side, s) if side == 0 then return north(s) end return south(s) end

-- Every square the men of side attack, the board occupied as occ.
local function attacks(m, side, occ)
  local b = 6 * side
  local a = sideways(forward(side, m[b])) | knight(m[b + KNIGHT]) | steps(m[b + KING])
  for _, s in ipairs(squares(m[b + BISHOP] | m[b + QUEEN])) do
    for _, d in ipairs(DIAGONALS) do a = a | ray(s, d[1], d[2], occ) end
  end
  for _, s in ipairs(squares(m[b + ROOK] | m[b + QUEEN])) do
    for _, d in ipairs(LINES) do a = a | ray(s, d[1], d[2], occ) end
  end
  return a
end

-- The legal moves of side, to move, which has a king, pawns and bishops only: { from, to, kind, now
-- (the kind after it), victim (a pawn taken en passant), passed (the square a double step passes) };
-- a promotion is four moves. ep: the square behind the other side's double step (0: none).
local function legal_moves(m, side, ep)
  local b, o = 6 * side, 6 * (1 - side)
  local own, occ, k = men(m, side), men(m, 0) | men(m, 1), m[b + KING]
  local them = men(m, 1 - side) & ~m[o + KING]
  local moves = {}
  local function add(from, to, kind, now, victim, passed)
    moves[#moves + 1] = { from = from, to = to, kind = kind, now = now, victim = victim, passed = passed }
  end
  for _, t in ipairs(squares(steps(k) & ~own & ~attacks(m, 1 - side, occ & ~k))) do add(k, t, KING, KING, 0, 0) end
  -- checks on the king, and the men pinned to it (each may move along its line only)
  local checkers = (sideways(forward(side, k)) & m[o + PAWN]) | (knight(k) & m[o + KNIGHT])
  local block, pins = ~0, {}
  for l = 1, 2 do
    local sliders = l == 1 and (m[o + BISHOP] | m[o + QUEEN]) or (m[o + ROOK] | m[o + QUEEN])
    for _, d in ipairs(l == 1 and DIAGONALS or LINES) do
      local r = ray(k, d[1], d[2], occ)
      local first = r & occ
      if first & sliders ~= 0 then
        checkers, block = checkers | first, r
      elseif first & own ~= 0 then
        local beyond = ray(first, d[1], d[2], occ)
        if beyond & occ & sliders ~= 0 then pins[first] = r | beyond end
      end
    end
  end
  if count(checkers) >= 2 then return moves end
  local evade = ~0
  if checkers ~= 0 then evade = block ~= ~0 and block or checkers end
  for _, s in ipairs(squares(m[b + BISHOP])) do
    local to = 0
    for _, d in ipairs(DIAGONALS) do to = to | ray(s, d[1], d[2], occ) end
    for _, t in ipairs(squares(to & ~own & ~m[o + KING] & evade & (pins[s] or ~0))) do add(s, t, BISHOP, BISHOP, 0, 0) end
  end
  for _, s in ipairs(squares(m[b + PAWN])) do
    local line = pins[s] or ~0
    local one = forward(side, s) & ~occ
    local two = forward(side, one & (side == 0 and RANK_3 or RANK_6)) & ~occ
    local hit = sideways(forward(side, s))
    for _, t in ipairs(squares((one | (hit & them)) & evade & line)) do
      if t & (RANK_1 | RANK_8) ~= 0 then
        for _, now in ipairs({ QUEEN, ROOK, BISHOP, KNIGHT }) do add(s, t, PAWN, now, 0, 0) end
      else
        add(s, t, PAWN, PAWN, 0, 0)
      end
    end
    for _, t in ipairs(squares(two & evade & line)) do add(s, t, PAWN, PAWN, 0, one) end
    local e = hit & ep & line
    if e ~= 0 then
      local victim = side == 0 and south(e) or north(e)
      if checkers == 0 or checkers & victim ~= 0 or e & evade ~= 0 then add(s, e, PAWN, PAWN, victim, 0) end
    end
  end
  return moves
end

-- The men after side plays mv.
local function play(m, side, mv)
  local r, o = {}, 6 * (1 - side)
  for i = 0, 11 do r[i] = m[i] end
  for i = o, o + 5 do r[i] = r[i] & ~(mv.to | mv.victim) end
  r[6 * side + mv.kind] = r[6 * side + mv.kind] & ~mv.from
  r[6 * side + mv.now] = r[6 * side + mv.now] | mv.to
  return r
end

-- Has side, to move, no legal move, its king in no check?
local function stalemated(m, side, ep)
  return attacks(m, 1 - side, men(m, 0) | men(m, 1)) & m[6 * side + KING] == 0 and #legal_moves(m, side, ep) == 0
end

-- Does every move of moves (side's) leave the other side stalemated?
local function every_move_stalemates(m, side, moves)
  for _, mv in ipairs(moves) do
    if not stalemated(play(m, side, mv), 1 - side, mv.passed) then return false end
  end
  return true
end

-- The stalemated flagged side: a king and pawns that, whatever the mater (a king, pawns and
-- bishops) plays, is left without a legal move and out of check, a stalemate. With the mater to
-- move: it has a legal move, and each one does that. With the flagged side to move: it has exactly
-- one legal move (a promotion is four), after which every move of the mater's, if it has any, does
-- that (with none, that one move ended the game). Not with an en passant right.
local function stalemated_flagged(p, white)
  local m = { [0] = p.white_pawns, p.white_knights, p.white_bishops, p.white_rooks, p.white_queens, p.white_king,
              p.black_pawns, p.black_knights, p.black_bishops, p.black_rooks, p.black_queens, p.black_king }
  local f = white and 0 or 1
  local b, o = 6 * f, 6 * (1 - f)
  if p.en_passant or m[b + KNIGHT] | m[b + BISHOP] | m[b + ROOK] | m[b + QUEEN] ~= 0
     or m[o + KNIGHT] | m[o + ROOK] | m[o + QUEEN] ~= 0 then return false end
  if p.white_to_move ~= white then
    local moves = legal_moves(m, 1 - f, 0)
    return #moves > 0 and every_move_stalemates(m, 1 - f, moves)
  end
  local only = legal_moves(m, f, 0)
  if #only ~= 1 then return false end
  local q = play(m, f, only[1])
  return every_move_stalemates(q, 1 - f, legal_moves(q, 1 - f, only[1].passed))
end

-- The lock: no series of legal moves opens the structure for the side asked about.
local function locked(p, white)
  local after = forced_step(p)
  if after then return locked(after, white) end
  local wx = p.white_knights | p.white_rooks | p.white_queens
  local bx = p.black_knights | p.black_rooks | p.black_queens
  if wx | bx ~= 0 then return boxed_lock(p, white, wx, bx) end
  if p.en_passant then return false end
  local gaps = north(p.white_pawns) & south(p.black_pawns) & ~(p.white_pawns | p.black_pawns)
  for _, frozen in ipairs(levels(p)) do
    local f = gaps ~= 0 and families(p, gaps, frozen, white) or "none"
    if f == "lock" then return true end
    if f ~= "refuted" then   -- refuted: family A, the level with more walls, leaked; the level leaks too
      local s = level(p, frozen, { guard = true })
      if s and not net_leaks(p, s, white, 0) then return true end
    end
  end
  return stuck_mater(p, white)
end

-- Can White (white = true) or Black never be mated, by the lock detector?
function lock.cannot_be_mated(p, white)
  return locked(p, white) or stalemated_flagged(p, white)
end

return lock
