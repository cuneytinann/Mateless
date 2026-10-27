# Mateless's lock detector, in its simplest form.
#
# Can a side never be mated? The lock detector answers yes when pawns, kings and bishops form a
# structure that no series of legal moves can open (FIDE 5.2.2 dead position, 6.9 flag fall). It
# reads bitboards only: it generates no move and searches nothing.
#
# Each king's reach (every square it may ever stand on) is grown from its square, never onto a
# square that a pawn which can never move attacks. The pawns that can never move are those blocked
# by a wall: a pawn the other side can never take. The squares where a side may take a pawn grow
# from its king's reach, and so on, until nothing changes. The structure leaks if a pawn can
# promote or capture, a frozen king can move, a bishop can reach a pawn's path, or the king of the
# side asked about can reach a square the other side attacks where it has no sure flight. It is
# tried with both kings free, then with each king frozen on its square (a wall for both sides) when
# every square around that king is held or attacked by a pawn.
#
# A knight, rook or queen on the board, two bishops of one side on squares of one colour, or a
# possible en passant capture fails it at once. Sound, not complete: a structure it passes can
# never be opened; one it fails may still be dead.
#
# Squares: a1 = 0, b1 = 1, ..., h8 = 63. A set of squares (a bitboard) is a 64-bit Integer.
module Lock
  ALL = 2**64 - 1 # Ruby's integers have no size: every set is kept to 64 bits
  FILE_A = 0x0101010101010101
  FILE_H = 0x8080808080808080
  RANK_1 = 0x00000000000000FF
  RANK_8 = 0xFF00000000000000
  DARK = 0xAA55AA55AA55AA55 # the dark squares; a1 is dark

  def self.north(s) = (s << 8) & ALL
  def self.south(s) = s >> 8
  def self.sideways(s) = ((s << 1) & ~FILE_A & ALL) | ((s >> 1) & ~FILE_H)

  def self.zone(s) # s and every square next to it
    v = s | north(s) | south(s)
    v | sideways(v)
  end

  def self.diagonal(s) = sideways(north(s) | south(s)) # the squares diagonally next to s
  def self.count(s) = s.to_s(2).count('1')
  def self.no(s) = ~s & ALL # every square not in s

  # Every square reachable from g by steps north through squares of p.
  def self.fill_north(g, p)
    g |= p & north(g)
    p &= north(p)
    g |= p & ((g << 16) & ALL)
    p &= (p << 16) & ALL
    g | (p & ((g << 32) & ALL))
  end

  # Every square reachable from g by steps south through squares of p.
  def self.fill_south(g, p)
    g |= p & south(g)
    p &= south(p)
    g |= p & (g >> 16)
    p &= p >> 16
    g | (p & (g >> 32))
  end

  # What the lock detector reads from a position.
  Pieces = Struct.new(
    :white_pawns, :black_pawns,
    :white_king, :black_king,
    :white_bishops, :black_bishops,
    :others,     # knights, rooks and queens of both sides
    :en_passant, # the side to move can capture en passant
    keyword_init: true
  )

  # The pieces of a FEN. The en passant square counts only if a pawn can capture onto it.
  def self.from_fen(fen)
    fields = fen.split
    sets = Hash.new(0)
    rank = 7
    file = 0
    fields[0].each_char do |c|
      case c
      when '/' then rank, file = rank - 1, 0
      when '1'..'8' then file += c.to_i
      else
        sets[c] |= 1 << (8 * rank + file)
        file += 1
      end
    end
    white_to_move = fields.size < 2 || fields[1] == 'w'
    en_passant = false
    if fields.size > 3 && fields[3] != '-'
      target = 1 << (fields[3][0].ord - 'a'.ord + 8 * (fields[3][1].to_i - 1))
      en_passant = if white_to_move
                     (sideways(south(target)) & sets['P']) != 0
                   else
                     (sideways(north(target)) & sets['p']) != 0
                   end
    end
    Pieces.new(white_pawns: sets['P'], black_pawns: sets['p'],
               white_king: sets['K'], black_king: sets['k'],
               white_bishops: sets['B'], black_bishops: sets['b'],
               others: sets['N'] | sets['n'] | sets['R'] | sets['r'] | sets['Q'] | sets['q'],
               en_passant: en_passant)
  end

  # Two bishops on squares of one colour (only a promotion makes them).
  def self.twin_bishops(b) = count(b & DARK) > 1 || count(b & ~DARK) > 1

  # Can White (white = true) or Black never be mated, by the lock detector?
  def self.cannot_be_mated(p, white)
    return false if p.others != 0 || p.en_passant
    return false if twin_bishops(p.white_bishops) || twin_bishops(p.black_bishops)
    return true unless leaks(p, white, 0)

    # A king may be frozen only if every square around it is held or attacked by a pawn.
    held = p.white_pawns | p.black_pawns | sideways(north(p.white_pawns) | south(p.black_pawns))
    [p.white_king, p.black_king].each do |king|
      return true if (zone(king) & no(king) & no(held)) == 0 && !leaks(p, white, king)
    end
    false
  end

  # Does the structure leak to the king asked about, with the king `frozen` frozen (0: none)?
  def self.leaks(p, white, frozen)
    wp, bp, wk, bk = p.white_pawns, p.black_pawns, p.white_king, p.black_king
    frozen_white = (frozen & wk) != 0
    frozen_black = !frozen_white && frozen != 0
    near_frozen_black = frozen_black ? zone(bk) : 0
    near_frozen_white = frozen_white ? zone(wk) : 0

    # Quick: the pawns' paths against the first walls already show a promotion or a capture.
    w_cone = fill_north(wp, no((bp & no(wk)) | frozen))
    b_cone = fill_south(bp, no((wp & no(bk)) | frozen))
    return true if ((w_cone & RANK_8) | (b_cone & RANK_1) | (north(sideways(w_cone)) & b_cone)) != 0

    # The cycle: walls -> pawns that can never move -> king reaches -> capture squares -> walls.
    w_fixed, b_fixed = wp, bp # pawns that can never move      (shrink)
    w_king, b_king = wk, bk   # squares each king may reach    (grow)
    w_take, b_take = wk, bk   # squares where a side may take an enemy pawn (grow)
    w_wall = b_wall = ALL     # pawns the other side can never take, and the frozen king
    loop do
      last_w_wall, last_b_wall = w_wall, b_wall
      w_wall = (wp & no(b_take)) | frozen
      b_wall = (bp & no(w_take)) | frozen
      new_w_fixed = w_fixed & w_wall & south(b_wall | w_fixed)
      new_b_fixed = b_fixed & b_wall & north(w_wall | b_fixed)
      break if w_wall == last_w_wall && b_wall == last_b_wall && new_w_fixed == w_fixed && new_b_fixed == b_fixed

      # Both kings' reaches, flooded: never onto a fixed pawn, a square it attacks, or next to
      # the frozen king.
      w_mask = no(new_w_fixed | sideways(south(new_b_fixed)) | near_frozen_black)
      b_mask = no(new_b_fixed | sideways(north(new_w_fixed)) | near_frozen_white)
      new_w_king, new_b_king = w_king, b_king
      loop do
        a = new_w_king | (zone(new_w_king) & w_mask)
        d = new_b_king | (zone(new_b_king) & b_mask)
        break if a == new_w_king && d == new_b_king

        new_w_king, new_b_king = a, d
      end
      if (frozen_white && new_w_king != wk) || (frozen_black && new_b_king != bk)
        return true # the frozen king can move
      end

      # A side may take a pawn where its king goes, and on any square a pawn may walk into.
      t = b_take | new_b_king
      new_b_take = t | south(fill_south(t & no(b_wall), no(b_wall)))
      t = w_take | new_w_king
      new_w_take = t | north(fill_north(t & no(w_wall), no(w_wall)))
      changed = new_w_fixed != w_fixed || new_b_fixed != b_fixed || new_w_king != w_king ||
                new_b_king != b_king || new_w_take != w_take || new_b_take != b_take
      w_fixed, b_fixed, w_king, b_king = new_w_fixed, new_b_fixed, new_w_king, new_b_king
      w_take, b_take = new_w_take, new_b_take
      break unless changed
    end

    # The pawns' cones: every square they may still reach.
    w_cone = fill_north(wp, no(b_wall))
    b_cone = fill_south(bp, no(w_wall))
    return true if ((w_cone & RANK_8) | (b_cone & RANK_1)) != 0 # a pawn can promote
    return true if (north(sideways(w_cone)) & b_cone) != 0      # a pawn can capture

    # The bishops' reaches: every square they may reach, around the fixed pawns.
    w_bish, b_bish = p.white_bishops, p.black_bishops
    open = no(w_fixed | b_fixed)
    loop do
      a = w_bish | (diagonal(w_bish) & open)
      d = b_bish | (diagonal(b_bish) & open)
      break if a == w_bish && d == b_bish

      w_bish, b_bish = a, d
    end
    return true if ((diagonal(w_bish) & b_cone) | (diagonal(b_bish) & w_cone)) != 0 # a bishop meets a pawn's path

    # The mating net: can the other side's pawns and bishops catch the king asked about?
    if white
      attack = diagonal(b_bish) | sideways(south(b_cone))
      reach = w_king
      free = no(w_cone | zone(b_king) | attack) # never occupied, attacked or next to the mater
      spare = free & no(w_bish)                 # ... nor reached by the king's own bishops
    else
      attack = diagonal(w_bish) | sideways(north(w_cone))
      reach = b_king
      free = no(b_cone | zone(w_king) | attack)
      spare = free & no(b_bish)
    end
    # A king next to a spare square, or with free squares beside it both ways, always has a flight.
    flight = sideways(spare) | north(spare) | south(spare) | ((north(free) | south(free)) & sideways(free))
    (attack & reach & no(flight)) != 0
  end

  private_class_method :north, :south, :sideways, :zone, :diagonal, :count, :no,
                       :fill_north, :fill_south, :twin_bishops, :leaks
end
