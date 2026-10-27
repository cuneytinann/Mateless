-- Mateless's lock detector, in its simplest form.
--
-- Can a side never be mated? The lock detector answers yes when pawns, kings and bishops form a
-- structure that no series of legal moves can open (FIDE 5.2.2 dead position, 6.9 flag fall). It
-- reads bitboards only: it generates no move and searches nothing.
--
-- Each king's reach (every square it may ever stand on) is grown from its square, never onto a
-- square that a pawn which can never move attacks. The pawns that can never move are those blocked
-- by a wall: a pawn the other side can never take. The squares where a side may take a pawn grow
-- from its king's reach, and so on, until nothing changes. The structure leaks if a pawn can
-- promote or capture, a frozen king can move, a bishop can reach a pawn's path, or the king of the
-- side asked about can reach a square the other side attacks where it has no sure flight. It is
-- tried with both kings free, then with each king frozen on its square (a wall for both sides) when
-- every square around that king is held or attacked by a pawn.
--
-- A knight, rook or queen on the board, two bishops of one side on squares of one colour, or a
-- possible en passant capture fails it at once. Sound, not complete: a structure it passes can
-- never be opened; one it fails may still be dead.
--
-- Squares: a1 = 0, b1 = 1, ..., h8 = 63. A set of squares (a bitboard) is a 64-bit integer.
-- Needs Lua 5.3 or later, for its 64-bit integers and bitwise operators (>> is logical).

local lock = {}

-- FILE_H, RANK_8 and DARK do not fit a signed integer: they wrap to negative ones, with the same bits.
local FILE_A = 0x0101010101010101
local FILE_H = 0x8080808080808080
local RANK_1 = 0x00000000000000FF
local RANK_8 = 0xFF00000000000000
local DARK = 0xAA55AA55AA55AA55     -- the dark squares; a1 is dark

local function north(s) return s << 8 end
local function south(s) return s >> 8 end
local function sideways(s) return ((s << 1) & ~FILE_A) | ((s >> 1) & ~FILE_H) end
local function zone(s) local v = s | north(s) | south(s); return v | sideways(v) end  -- s and every square next to it
local function diagonal(s) return sideways(north(s) | south(s)) end                  -- the squares diagonally next to s
local function count(s) local n = 0; while s ~= 0 do s = s & (s - 1); n = n + 1 end; return n end

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

--- What the lock detector reads from a position.
---@class Pieces
---@field white_pawns integer
---@field black_pawns integer
---@field white_king integer
---@field black_king integer
---@field white_bishops integer
---@field black_bishops integer
---@field others integer      knights, rooks and queens of both sides
---@field en_passant boolean  the side to move can capture en passant

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
  return {
    white_pawns = sets.P, black_pawns = sets.p,
    white_king = sets.K, black_king = sets.k,
    white_bishops = sets.B, black_bishops = sets.b,
    others = sets.N | sets.n | sets.R | sets.r | sets.Q | sets.q,
    en_passant = en_passant,
  }
end

-- Two bishops on squares of one colour (only a promotion makes them).
local function twin_bishops(b) return count(b & DARK) > 1 or count(b & ~DARK) > 1 end

local leaks  -- defined below

-- Can White (white = true) or Black never be mated, by the lock detector?
function lock.cannot_be_mated(p, white)
  if p.others ~= 0 or p.en_passant then return false end
  if twin_bishops(p.white_bishops) or twin_bishops(p.black_bishops) then return false end
  if not leaks(p, white, 0) then return true end
  -- A king may be frozen only if every square around it is held or attacked by a pawn.
  local held = p.white_pawns | p.black_pawns | sideways(north(p.white_pawns) | south(p.black_pawns))
  local kings = { p.white_king, p.black_king }
  for i = 1, 2 do
    if (zone(kings[i]) & ~kings[i] & ~held) == 0 and not leaks(p, white, kings[i]) then return true end
  end
  return false
end

-- Does the structure leak to the king asked about, with the king `frozen` frozen (0: none)?
function leaks(p, white, frozen)
  local wp, bp, wk, bk = p.white_pawns, p.black_pawns, p.white_king, p.black_king
  local frozen_white = (frozen & wk) ~= 0
  local frozen_black = not frozen_white and frozen ~= 0
  local near_frozen_black = frozen_black and zone(bk) or 0
  local near_frozen_white = frozen_white and zone(wk) or 0

  -- Quick: the pawns' paths against the first walls already show a promotion or a capture.
  local w_cone = fill_north(wp, ~((bp & ~wk) | frozen))
  local b_cone = fill_south(bp, ~((wp & ~bk) | frozen))
  if ((w_cone & RANK_8) | (b_cone & RANK_1) | (north(sideways(w_cone)) & b_cone)) ~= 0 then return true end

  -- The cycle: walls -> pawns that can never move -> king reaches -> capture squares -> walls.
  local w_fixed, b_fixed = wp, bp     -- pawns that can never move      (shrink)
  local w_king, b_king = wk, bk       -- squares each king may reach    (grow)
  local w_take, b_take = wk, bk       -- squares where a side may take an enemy pawn (grow)
  local w_wall, b_wall = ~0, ~0       -- pawns the other side can never take, and the frozen king
  while true do
    local last_w_wall, last_b_wall = w_wall, b_wall
    w_wall = (wp & ~b_take) | frozen
    b_wall = (bp & ~w_take) | frozen
    local new_w_fixed = w_fixed & w_wall & south(b_wall | w_fixed)
    local new_b_fixed = b_fixed & b_wall & north(w_wall | b_fixed)
    if w_wall == last_w_wall and b_wall == last_b_wall and new_w_fixed == w_fixed and new_b_fixed == b_fixed then
      break
    end
    -- Both kings' reaches, flooded: never onto a fixed pawn, a square it attacks, or next to
    -- the frozen king.
    local w_mask = ~(new_w_fixed | sideways(south(new_b_fixed)) | near_frozen_black)
    local b_mask = ~(new_b_fixed | sideways(north(new_w_fixed)) | near_frozen_white)
    local new_w_king, new_b_king = w_king, b_king
    while true do
      local a = new_w_king | (zone(new_w_king) & w_mask)
      local d = new_b_king | (zone(new_b_king) & b_mask)
      if a == new_w_king and d == new_b_king then break end
      new_w_king = a
      new_b_king = d
    end
    if (frozen_white and new_w_king ~= wk) or (frozen_black and new_b_king ~= bk) then
      return true   -- the frozen king can move
    end
    -- A side may take a pawn where its king goes, and on any square a pawn may walk into.
    local t = b_take | new_b_king
    local new_b_take = t | south(fill_south(t & ~b_wall, ~b_wall))
    t = w_take | new_w_king
    local new_w_take = t | north(fill_north(t & ~w_wall, ~w_wall))
    local changed = new_w_fixed ~= w_fixed or new_b_fixed ~= b_fixed or new_w_king ~= w_king or
                    new_b_king ~= b_king or new_w_take ~= w_take or new_b_take ~= b_take
    w_fixed = new_w_fixed; b_fixed = new_b_fixed; w_king = new_w_king; b_king = new_b_king
    w_take = new_w_take; b_take = new_b_take
    if not changed then break end
  end

  -- The pawns' cones: every square they may still reach.
  w_cone = fill_north(wp, ~b_wall)
  b_cone = fill_south(bp, ~w_wall)
  if ((w_cone & RANK_8) | (b_cone & RANK_1)) ~= 0 then return true end   -- a pawn can promote
  if (north(sideways(w_cone)) & b_cone) ~= 0 then return true end        -- a pawn can capture
  -- The bishops' reaches: every square they may reach, around the fixed pawns.
  local w_bish, b_bish, open = p.white_bishops, p.black_bishops, ~(w_fixed | b_fixed)
  while true do
    local a = w_bish | (diagonal(w_bish) & open)
    local d = b_bish | (diagonal(b_bish) & open)
    if a == w_bish and d == b_bish then break end
    w_bish = a
    b_bish = d
  end
  if ((diagonal(w_bish) & b_cone) | (diagonal(b_bish) & w_cone)) ~= 0 then return true end   -- a bishop meets a pawn's path

  -- The mating net: can the other side's pawns and bishops catch the king asked about?
  local attack, reach, free, spare
  if white then
    attack = diagonal(b_bish) | sideways(south(b_cone))
    reach = w_king
    free = ~(w_cone | zone(b_king) | attack)   -- never occupied, attacked or next to the mater
    spare = free & ~w_bish                     -- ... nor reached by the king's own bishops
  else
    attack = diagonal(w_bish) | sideways(north(w_cone))
    reach = b_king
    free = ~(b_cone | zone(w_king) | attack)
    spare = free & ~b_bish
  end
  -- A king next to a spare square, or with free squares beside it both ways, always has a flight.
  local flight = sideways(spare) | north(spare) | south(spare) | ((north(free) | south(free)) & sideways(free))
  return (attack & reach & ~flight) ~= 0
end

return lock
