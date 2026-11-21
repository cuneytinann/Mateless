# Mateless's lock detector, second version, in its simplest form.
#
# Can a side never be mated? The lock detector answers yes when pawns, kings and bishops (and
# knights, rooks or queens boxed in by their own men) form a structure that no series of legal
# moves can open (FIDE 5.2.2 dead position, 6.9 flag fall). It reads bitboards and the side to
# move: it generates no move and searches nothing.
#
# The first version (../../ruby/lock.rb) grows each king's reach, the pawns that can never move,
# and the squares where each side may take a pawn, until nothing changes; the structure leaks if a
# pawn can promote or capture, a frozen king can move, a bishop can reach a pawn's path, or the
# king asked about can reach a square the other side attacks without a sure flight. This version
# keeps all of it and adds, each only where its situation is on the board:
#   - open pawn pairs: a white and a black pawn on one file with one empty square between them;
#     the reachable positions split into families by what the pair's pawns have done (neither
#     moved, the white one stepped into the gap, the black one did), up to 3 pairs;
#   - boxed knights, rooks and queens: a piece whose every step square holds one of its own men
#     that never moves, and that no enemy king or bishop reaches, never moves nor falls;
#   - twin bishops: two bishops of one side on one colour no longer fail it; the mating net leaves
#     out its second flight rule where they may hold both flights;
#   - the stalemate guard: a pawn the enemy king may take stays a wall if taking it always
#     stalemates its owner;
#   - the check seed: a king in a pawn's check starts its reach from the squares it can step to;
#   - the stuck mater: whatever the flagged side plays, the mater is left without a move;
#   - the forced step: a king in a pawn's check with one legal move, a step: the lock of the
#     position after it.
# A possible en passant capture fails it at once. Sound, not complete: a structure it passes can
# never be opened; one it fails may still be dead.
#
# Squares: a1 = 0, b1 = 1, ..., h8 = 63. A set of squares (a bitboard) is a 64-bit Integer.
module Lock
  ALL = 2**64 - 1 # Ruby's integers have no size: every set is kept to 64 bits
  FILE_A = 0x0101010101010101
  FILE_H = 0x8080808080808080
  RANK_1 = 0x00000000000000FF
  RANK_3 = 0x0000000000FF0000
  RANK_6 = 0x0000FF0000000000
  RANK_8 = 0xFF00000000000000
  DARK = 0xAA55AA55AA55AA55 # the dark squares; a1 is dark
  MAX_PAIRS = 3 # the most open pairs the families are split on (3^3 = 27)

  def self.north(s) = (s << 8) & ALL
  def self.south(s) = s >> 8
  def self.sideways(s) = ((s << 1) & ~FILE_A & ALL) | ((s >> 1) & ~FILE_H)

  def self.zone(s) # s and every square next to it
    v = s | north(s) | south(s)
    v | sideways(v)
  end

  def self.steps(s) = zone(s) & no(s) # the squares next to s
  def self.diagonal(s) = sideways(north(s) | south(s)) # the squares diagonally next to s
  def self.count(s) = s.to_s(2).count('1')
  def self.no(s) = ~s & ALL # every square not in s

  # The squares a knight on s goes to.
  def self.knight(s)
    one = sideways(s)
    two = ((s << 2) & ~(FILE_A | (FILE_A << 1)) & ALL) | ((s >> 2) & ~(FILE_H | (FILE_H >> 1)))
    north(north(one)) | south(south(one)) | north(two) | south(two)
  end

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

  # Every square a king may reach from k through squares of m.
  def self.flood(k, m)
    loop do
      a = k | (zone(k) & m)
      return k if a == k

      k = a
    end
  end

  # What the lock detector reads from a position.
  Pieces = Struct.new(
    :white_pawns, :black_pawns, :white_king, :black_king, :white_bishops, :black_bishops,
    :white_knights, :black_knights, :white_rooks, :black_rooks, :white_queens, :black_queens,
    :white_to_move,
    :en_passant, # the side to move can capture en passant
    keyword_init: true
  )

  # What one level leaves for the mating net (and for the families after it).
  Sets = Struct.new(:w_cone, :b_cone, :w_fixed, :b_fixed, :w_king, :b_king, :w_bish, :b_bish, :w_take, :b_take)

  NAMES = { 'P' => :white_pawns, 'p' => :black_pawns, 'K' => :white_king, 'k' => :black_king,
            'B' => :white_bishops, 'b' => :black_bishops, 'N' => :white_knights, 'n' => :black_knights,
            'R' => :white_rooks, 'r' => :black_rooks, 'Q' => :white_queens, 'q' => :black_queens }.freeze

  # The pieces of a FEN. The en passant square counts only if a pawn can capture onto it.
  def self.from_fen(fen)
    fields = fen.split
    p = Pieces.new(**NAMES.values.to_h { |n| [n, 0] }, white_to_move: fields[1] != 'b', en_passant: false)
    rank = 7
    file = 0
    fields[0].each_char do |c|
      case c
      when '/' then rank, file = rank - 1, 0
      when '1'..'8' then file += c.to_i
      else
        p[NAMES[c]] |= 1 << (8 * rank + file)
        file += 1
      end
    end
    ep = fields[3] || '-'
    if ep != '-'
      target = 1 << (ep[0].ord - 'a'.ord + 8 * (ep[1].to_i - 1))
      p.en_passant = if p.white_to_move
                       sideways(south(target)) & p.white_pawns != 0
                     else
                       sideways(north(target)) & p.black_pawns != 0
                     end
    end
    p
  end

  # Can White (white = true) or Black never be mated, by the lock detector?
  def self.cannot_be_mated(p, white)
    after = forced_step(p)
    return cannot_be_mated(after, white) if after

    wx = p.white_knights | p.white_rooks | p.white_queens
    bx = p.black_knights | p.black_rooks | p.black_queens
    return boxed_lock(p, white, wx, bx) if (wx | bx) != 0
    return false if p.en_passant

    gaps = north(p.white_pawns) & south(p.black_pawns) & no(p.white_pawns | p.black_pawns)
    levels(p).each do |frozen|
      if gaps != 0
        f = families(p, gaps, frozen, white)
        return true if f == :lock
        next if f == :refuted # family A, the level with more walls, leaked: the level leaks too
      end
      s = level(p, frozen, guard: true)
      return true if s && !net_leaks(p, s, white, 0)
    end
    stuck_mater(p, white)
  end

  # The levels: both kings free (0), then each king frozen on its square (a wall for both sides)
  # when every square around it is held or attacked by a pawn.
  def self.levels(p)
    held = p.white_pawns | p.black_pawns | sideways(north(p.white_pawns) | south(p.black_pawns))
    [0] + [p.white_king, p.black_king].select { |king| (steps(king) & no(held)).zero? }
  end

  # One level: the fixed point of the walls, the pawns that can never move, the kings' reaches, the
  # squares where each side may take a pawn, the pawns' cones and the bishops' reaches. The sets the
  # mating net reads, or nil when the structure leaks whichever side is asked about.
  # wp, bp: the pawns (a family has a pair's pawn moved into its gap); v: walls for both sides (the
  # gaps of a family's pairs that stay); start: where the kings' reaches, capture squares and bishops'
  # reaches start (a family's); wx, bx, ws, bs: the boxed pieces' candidates and their step squares;
  # guard: the stalemate guard and the check seed (plain levels only).
  def self.level(p, frozen, wp: nil, bp: nil, v: 0, start: nil, wx: 0, bx: 0, ws: 0, bs: 0, guard: false)
    wp ||= p.white_pawns
    bp ||= p.black_pawns
    wk = p.white_king
    bk = p.black_king
    v |= frozen
    frozen_white = (frozen & wk) != 0
    frozen_black = !frozen_white && frozen != 0
    near_frozen_black = frozen_black ? zone(bk) : 0
    near_frozen_white = frozen_white ? zone(wk) : 0
    w_seed, b_seed = guard && frozen.zero? ? check_seed(p) : [wk, bk]
    w_king, b_king, w_take, b_take = w_seed, b_seed, w_seed, b_seed
    w_bish = p.white_bishops
    b_bish = p.black_bishops
    w_king, b_king, w_take, b_take, w_bish, b_bish = start if start
    w_cone, b_cone, w_fixed, b_fixed = wp, bp, wp, bp
    w_guard = b_guard = guard ? ALL : 0 # nothing is taken yet
    loop do
      # Boxed: the pieces no enemy king or bishop reaches. Walls: pawns the other side can never
      # take (or whose capture stalemates their owner), the frozen king, the gaps, boxed pieces.
      boxed = (wx & no(b_king | b_bish)) | (bx & no(w_king | w_bish))
      w_wall = (wp & no(b_take & no(w_guard))) | v | boxed
      b_wall = (bp & no(w_take & no(b_guard))) | v | boxed
      nw_fixed = w_fixed & w_wall & south(b_wall | w_fixed)
      nb_fixed = b_fixed & b_wall & north(w_wall | b_fixed)
      nw_cone = fill_north(w_cone, no(b_wall))
      nb_cone = fill_south(b_cone, no(w_wall))
      # The kings: never onto a fixed pawn, a square it attacks, or next to the frozen king.
      b_hit = sideways(south(nb_fixed))
      w_hit = sideways(north(nw_fixed))
      nw_king = flood(w_king, no(nw_fixed | b_hit | near_frozen_black))
      nb_king = flood(b_king, no(nb_fixed | w_hit | near_frozen_white))
      nw_bish = w_bish
      nb_bish = b_bish
      open = no(nw_fixed | nb_fixed)
      loop do
        a = nw_bish | (diagonal(nw_bish) & open)
        d = nb_bish | (diagonal(nb_bish) & open)
        break if a == nw_bish && d == nb_bish

        nw_bish = a
        nb_bish = d
      end
      # A side may take a pawn where its king goes, and on any square a pawn may walk into.
      t = b_take | nb_king
      nb_take = t | south(fill_south(t & no(b_wall), no(b_wall)))
      t = w_take | nw_king
      nw_take = t | north(fill_north(t & no(w_wall), no(w_wall)))
      nw_guard = w_guard
      nb_guard = b_guard
      if guard
        block = nw_fixed | nb_fixed
        w_has_b = p.white_bishops != 0
        b_has_b = p.black_bishops != 0
        nw_guard = w_has_b ? 0 : stalemate_guard(wp & nb_take & nw_fixed, wp, nw_fixed, nw_king, nw_fixed | b_hit, nb_king, b_has_b, block)
        nb_guard = b_has_b ? 0 : stalemate_guard(bp & nw_take & nb_fixed, bp, nb_fixed, nb_king, nb_fixed | w_hit, nw_king, w_has_b, block)
      end
      new = [nw_cone, nb_cone, nw_fixed, nb_fixed, nw_king, nb_king, nw_bish, nb_bish, nw_take, nb_take, nw_guard, nb_guard]
      old = [w_cone, b_cone, w_fixed, b_fixed, w_king, b_king, w_bish, b_bish, w_take, b_take, w_guard, b_guard]
      w_cone, b_cone, w_fixed, b_fixed, w_king, b_king, w_bish, b_bish, w_take, b_take, w_guard, b_guard = new
      break if new == old
    end
    boxed = (wx & no(b_king | b_bish)) | (bx & no(w_king | w_bish))
    return nil if ((w_cone & RANK_8) | (b_cone & RANK_1)) != 0                                 # a pawn can promote
    return nil if ((north(sideways(w_cone)) & (b_cone | bx)) | (south(sideways(b_cone)) & wx)) != 0 # a pawn can capture
    return nil if (frozen_white && w_king != wk) || (frozen_black && b_king != bk)              # the frozen king can move
    return nil if ((diagonal(w_bish) & b_cone) | (diagonal(b_bish) & w_cone)) != 0               # a bishop meets a pawn's path
    return nil if ((ws & no(w_fixed | (wx & boxed))) | (bs & no(b_fixed | (bx & boxed)))) != 0   # a piece may step

    if (w_guard | b_guard) != 0
      # A king that takes a guarded pawn ends the game: for the mating net, the kings' reaches
      # again, now stopping at the enemy's guarded pawns.
      w_king = flood(w_seed, no(w_fixed | sideways(south(b_fixed)) | near_frozen_black | (bp & b_guard)))
      b_king = flood(b_seed, no(b_fixed | sideways(north(w_fixed)) | near_frozen_white | (wp & w_guard)))
    end
    Sets.new(w_cone, b_cone, w_fixed, b_fixed, w_king, b_king, w_bish, b_bish, w_take, b_take)
  end

  # The mating net: can the other side's pawns and bishops catch the king asked about? occ: squares
  # that stand occupied for good besides (the boxed pieces').
  def self.net_leaks(p, s, white, occ)
    if white
      attack = diagonal(s.b_bish) | sideways(south(s.b_cone))
      reach = s.w_king
      free = no(s.w_cone | occ | zone(s.b_king) | attack) # never occupied, attacked or next to the mater
      spare = free & no(s.w_bish)                         # ... nor reached by the king's own bishops
      twins = p.white_bishops
    else
      attack = diagonal(s.w_bish) | sideways(north(s.w_cone))
      reach = s.b_king
      free = no(s.b_cone | occ | zone(s.w_king) | attack)
      spare = free & no(s.b_bish)
      twins = p.black_bishops
    end
    # A king next to a spare square, or with free squares beside it both ways, always has a flight.
    # The second rule counts on at most one of the king's own bishops on the colour of those two
    # squares (the colour opposite the king's): not on the king squares where it has two or more.
    no_pair = (count(twins & DARK) > 1 ? no(DARK) : 0) | (count(twins & no(DARK)) > 1 ? DARK : 0)
    flight = sideways(spare) | north(spare) | south(spare) |
             ((north(free) | south(free)) & sideways(free) & no(no_pair))
    (attack & reach & no(flight)) != 0
  end

  # The check seed: the side to move is in a pawn's check, so its king must step now, to a square it
  # can step to (not its own pawn, not a square an enemy pawn attacks, not next to the enemy king);
  # its reach starts there. Not when it has no such square (that may be a mate now), when one of its
  # pawns can take a checking pawn, or with a bishop on the board. The kings' starting sets.
  def self.check_seed(p)
    wp = p.white_pawns
    bp = p.black_pawns
    wk = p.white_king
    bk = p.black_king
    white = p.white_to_move
    return [wk, bk] if (p.white_bishops | p.black_bishops) != 0

    k, own = white ? [wk, wp] : [bk, bp]
    checkers = white ? sideways(north(k)) & bp : sideways(south(k)) & wp
    return [wk, bk] if checkers.zero?

    attacked = white ? sideways(south(bp)) : sideways(north(wp))
    to = steps(k) & no(own) & no(attacked) & no(steps(white ? bk : wk))
    takers = (white ? sideways(south(checkers)) : sideways(north(checkers))) & own
    return [wk, bk] if to.zero? || takers != 0

    white ? [to, bk] : [wk, to]
  end

  # The stalemate guard: of the owner's fixed pawns cand (which the enemy king may take), those whose
  # capture always stalemates the owner. The owner must have nothing else that moves (every other
  # pawn fixed; no bishop, which the caller sees to). reach: where the owner's king may stand; shut:
  # squares it can never step to (own fixed pawns, squares the enemy's fixed pawns attack);
  # enemy_king: the enemy king's reach; block: squares a bishop's line never crosses.
  def self.stalemate_guard(cand, own, own_fixed, reach, shut, enemy_king, enemy_bishops, block)
    return 0 if (own & no(own_fixed)) != 0

    guard = 0
    c = cand
    while c != 0
      pawn = c & -c
      c &= c - 1
      near = steps(pawn)
      from = near & enemy_king # where the enemy king takes from
      x = shut | near | pawn   # after the capture, the owner's king may not step there
      held = true
      k = reach & no(near | pawn) # the owner's king, not defending the pawn
      while k != 0
        king = k & -k
        k &= k - 1
        if (steps(king) & no(x)) != 0 || (enemy_bishops && ray_meets(king, block | pawn, from))
          held = false # it has a square to step to, or the capture uncovers a check
          break
        end
      end
      guard |= pawn if held
    end
    guard
  end

  # Does a diagonal line from the square king, stopped by block, meet a square of o?
  def self.ray_meets(king, block, o)
    sq = king.bit_length - 1
    f0 = sq & 7
    r0 = sq >> 3
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].each do |df, dr|
      f = f0 + df
      r = r0 + dr
      while f.between?(0, 7) && r.between?(0, 7)
        s = 1 << (8 * r + f)
        return true if (o & s) != 0
        break if (block & s) != 0

        f += df
        r += dr
      end
    end
    false
  end

  # The families of the open pairs at one level: :lock when none of them leaks to the king asked
  # about, :refuted when family A (no pair's pawn has moved) does, :none otherwise.
  def self.families(p, gaps, frozen, white)
    pairs = [] # per pair: the gap, the white pawn below it, the black pawn above it
    g = gaps
    while g != 0
      gap = g & -g
      g &= g - 1
      pairs << [gap, south(gap), north(gap)]
    end
    return :none if pairs.size > MAX_PAIRS

    k = pairs.size
    sets = []
    (3**k).times do |f|
      # Family f: digit i (base 3) says what pair i's pawns have done: 0 neither, 1 the white one
      # stepped into the gap, 2 the black one did. Its sets start from those of the family it is
      # reached from (the same with pair i's pawns in place), minus the gap.
      wp = p.white_pawns
      bp = p.black_pawns
      v = 0
      start = f.zero? ? [p.white_king, p.black_king, p.white_king, p.black_king, p.white_bishops, p.black_bishops] : [0] * 6
      q = f
      k.times do |i|
        d = q % 3
        q /= 3
        gap, w, b = pairs[i]
        if d.zero?
          v |= gap # the gap stays: a wall for both sides' pawns
          next
        end
        if d == 1
          wp = (wp & no(w)) | gap
        else
          bp = (bp & no(b)) | gap
        end
        r = sets[f - d * 3**i]
        start[0] |= r.w_king & no(gap)
        start[1] |= r.b_king & no(gap)
        start[2] |= r.w_take
        start[3] |= r.b_take
        start[4] |= r.w_bish & no(gap)
        start[5] |= r.b_bish & no(gap)
      end
      s = level(p, frozen, wp: wp, bp: bp, v: v, start: start)
      return f.zero? ? :refuted : :none unless s

      # The pairs that stay: both pawns must never move.
      q = f
      k.times do |i|
        return :none if (q % 3).zero? && ((pairs[i][1] & no(s.w_fixed)) | (pairs[i][2] & no(s.b_fixed))) != 0

        q /= 3
      end
      return f.zero? ? :refuted : :none if net_leaks(p, s, white, 0)

      sets << s
    end
    :lock
  end

  # With knights, rooks or queens on the board: every one of them must be boxed in by its own pawns
  # and pieces; then the levels, with the boxed pieces as walls and no flight onto their squares.
  def self.boxed_lock(p, white, wx, bx)
    ws = box_steps(p.white_knights, p.white_rooks | p.white_queens, p.white_queens, p.white_pawns | wx)
    bs = box_steps(p.black_knights, p.black_rooks | p.black_queens, p.black_queens, p.black_pawns | bx)
    return false if ws.nil? || bs.nil? || p.en_passant

    levels(p).any? do |frozen|
      s = level(p, frozen, wx: wx, bx: bx, ws: ws, bs: bs)
      s && !net_leaks(p, s, white, wx | bx)
    end
  end

  # The step squares of one side's knights, rooks (and queens: o) and queens, or nil when one of
  # them is not held by its own men (own).
  def self.box_steps(knights, o, queens, own)
    s = sideways(o) | north(o) | south(o) | diagonal(queens) | knight(knights)
    (s & no(own)).zero? ? s : nil
  end

  # The stuck mater: the flagged side is to move and, whatever it plays, the mater has no legal move
  # left (kings and pawns only): the game ends at the mater's turn.
  def self.stuck_mater(p, white)
    return false if p.white_to_move != white || p.en_passant
    return false if (p.white_bishops | p.black_bishops | p.white_knights | p.black_knights | p.white_rooks |
                     p.black_rooks | p.white_queens | p.black_queens) != 0

    fp, mp = white ? [p.white_pawns, p.black_pawns] : [p.black_pawns, p.white_pawns]
    fk, mk = white ? [p.white_king, p.black_king] : [p.black_king, p.white_king]
    occ = fp | mp | fk | mk
    fwd = ->(s) { white ? north(s) : south(s) }  # ahead, for the flagged side
    back = ->(s) { white ? south(s) : north(s) } # behind
    # A mater's pawn with an empty square ahead is never stuck; then only a stalemate now is left to
    # find, which a flagged pawn's push rules out.
    return false if (back.(mp) & no(occ)) != 0 && (fwd.(fp) & no(occ)) != 0

    f_attack = sideways(fwd.(fp))
    m_attack = sideways(back.(mp))
    return false if (f_attack & (mp | mk)) != 0 # 1. the flagged side has no capture

    single = fwd.(fp) & no(occ)
    double = fwd.(single & (white ? RANK_3 : RANK_6)) & no(occ)
    pushes = single | double
    near = steps(mk)
    king_to = steps(fk) & no(fp) & no(m_attack) & no(near) # the flagged king's steps now
    in_check = (fk & m_attack) != 0
    return false if in_check && king_to.zero? # mated now

    stays = pushes != 0 && !in_check # a pawn may move instead of the king
    return true if king_to.zero? && !stays # no move, no check: stalemate now

    # The squares next to every square the flagged king may stand on after its move.
    cover = stays ? steps(fk) : ALL
    k = king_to
    while k != 0
      cover &= steps(k & -k)
      k &= k - 1
    end
    # 2. the mater's pawns are blocked by men that stay, and attack no flagged pawn
    blockers = fp | mp | mk | (king_to.zero? ? fk : 0)
    return false if ((back.(mp) & no(blockers)) | (m_attack & fp)) != 0

    # 3. every square next to the mater's king: its own pawn, attacked by a flagged pawn that cannot
    #    move now, or next to the flagged king wherever it goes
    still = fp & back.(fwd.(fp) & occ)
    return false if (near & no(mp | sideways(fwd.(still)) | cover)) != 0

    # 4. no push lands where a mater's pawn attacks or next to its king, nor lets it take en passant
    ((pushes & (m_attack | near)) | (double & sideways(mp))).zero?
  end

  # The forced step: the side to move is in a pawn's check, with kings and pawns only, and its one
  # legal move is a step of its king. The position after it, or nil.
  def self.forced_step(p)
    return nil if p.en_passant || (p.white_bishops | p.black_bishops | p.white_knights | p.black_knights |
                                   p.white_rooks | p.black_rooks | p.white_queens | p.black_queens) != 0

    white = p.white_to_move
    k, ek = white ? [p.white_king, p.black_king] : [p.black_king, p.white_king]
    own, enemy = white ? [p.white_pawns, p.black_pawns] : [p.black_pawns, p.white_pawns]
    checkers = (white ? sideways(north(k)) : sideways(south(k))) & enemy
    return nil if checkers.zero?

    attacked = white ? sideways(south(enemy)) : sideways(north(enemy))
    to = steps(k) & no(own) & no(attacked) & no(steps(ek))
    return nil if count(to) != 1
    return nil if ((white ? sideways(south(checkers)) : sideways(north(checkers))) & own) != 0 # a pawn may take instead

    q = p.dup
    q.white_to_move = !white
    q.en_passant = false
    if white
      q.white_king = to
      q.black_pawns = p.black_pawns & no(to)
    else
      q.black_king = to
      q.white_pawns = p.white_pawns & no(to)
    end
    q
  end
end
