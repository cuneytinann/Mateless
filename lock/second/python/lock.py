"""Mateless's lock detector, second version, in its simplest form.

Can a side never be mated? The lock detector answers yes when pawns, kings and bishops (and
knights, rooks or queens boxed in by their own men) form a structure that no series of legal moves
can open (FIDE 5.2.2 dead position, 6.9 flag fall). It reads bitboards and the side to move: it
generates no move and searches nothing.

The first version (../../python/lock.py) grows each king's reach, the pawns that can never move,
and the squares where each side may take a pawn, until nothing changes; the structure leaks if a
pawn can promote or capture, a frozen king can move, a bishop can reach a pawn's path, or the king
asked about can reach a square the other side attacks without a sure flight. This version keeps
all of it and adds, each only where its situation is on the board:
  - open pawn pairs: a white and a black pawn on one file with one empty square between them; the
    reachable positions split into families by what the pair's pawns have done (neither moved, the
    white one stepped into the gap, the black one did), up to 3 pairs;
  - boxed knights, rooks and queens: a piece whose every step square holds one of its own men that
    never moves, and that no enemy king or bishop reaches, never moves nor falls; such a man is a
    fixed pawn, another boxed piece, a still bishop (every diagonal neighbour held so, and out of
    the enemy king's and bishops' reach) or the piece's own frozen king (its side with no castling
    right left and not standing where a castle leaves it beside its rook);
  - twin bishops: two bishops of one side on one colour no longer fail it; the mating net leaves
    out its second flight rule where they may hold both flights;
  - the stalemate guard: a pawn the enemy king may take stays a wall if taking it always
    stalemates its owner;
  - the check seed: a king in a pawn's check starts its reach from the squares it can step to;
  - the stuck mater: whatever the flagged side plays, the mater is left without a move;
  - the forced step: a king in a pawn's check with one legal move, a step: the lock of the
    position after it.
A possible en passant capture fails it at once. Sound, not complete: a structure it passes can
never be opened; one it fails may still be dead.

Squares: a1 = 0, b1 = 1, ..., h8 = 63. A set of squares (a bitboard) is a 64-bit integer.
"""
from dataclasses import dataclass, replace

ALL = (1 << 64) - 1  # Python's integers have no size: every set is kept to 64 bits
FILE_A = 0x0101010101010101
FILE_H = 0x8080808080808080
RANK_1 = 0x00000000000000FF
RANK_3 = 0x0000000000FF0000
RANK_6 = 0x0000FF0000000000
RANK_8 = 0xFF00000000000000
DARK = 0xAA55AA55AA55AA55  # the dark squares; a1 is dark
MAX_PAIRS = 3              # the most open pairs the families are split on (3^3 = 27)


def north(s): return (s << 8) & ALL
def south(s): return s >> 8
def sideways(s): return ((s << 1) & ~FILE_A & ALL) | ((s >> 1) & ~FILE_H)
def zone(s): v = s | north(s) | south(s); return v | sideways(v)  # s and every square next to it
def steps(s): return zone(s) & no(s)  # the squares next to s
def diagonal(s): return sideways(north(s) | south(s))  # the squares diagonally next to s
def count(s): return bin(s).count('1')
def no(s): return ~s & ALL  # every square not in s


def knight(s):
    """The squares a knight on s goes to."""
    one = sideways(s)
    two = ((s << 2) & ~(FILE_A | (FILE_A << 1)) & ALL) | ((s >> 2) & ~(FILE_H | (FILE_H >> 1)))
    return north(north(one)) | south(south(one)) | north(two) | south(two)


def fill_north(g, p):
    """Every square reachable from g by steps north through squares of p."""
    g |= p & north(g)
    p &= north(p)
    g |= p & ((g << 16) & ALL)
    p &= (p << 16) & ALL
    return g | (p & ((g << 32) & ALL))


def fill_south(g, p):
    """Every square reachable from g by steps south through squares of p."""
    g |= p & south(g)
    p &= south(p)
    g |= p & (g >> 16)
    p &= p >> 16
    return g | (p & (g >> 32))


def flood(k, m):
    """Every square a king may reach from k through squares of m."""
    while True:
        a = k | (zone(k) & m)
        if a == k:
            return k
        k = a


@dataclass
class Pieces:
    """What the lock detector reads from a position."""
    white_pawns: int = 0
    black_pawns: int = 0
    white_king: int = 0
    black_king: int = 0
    white_bishops: int = 0
    black_bishops: int = 0
    white_knights: int = 0
    black_knights: int = 0
    white_rooks: int = 0
    black_rooks: int = 0
    white_queens: int = 0
    black_queens: int = 0
    white_to_move: bool = True
    en_passant: bool = False  # the side to move can capture en passant
    white_castles: bool = False  # White has a castling right (its king and that rook in place)
    black_castles: bool = False


@dataclass
class Sets:
    """What one level leaves for the mating net (and for the families after it)."""
    w_cone: int
    b_cone: int
    w_fixed: int
    b_fixed: int
    w_king: int
    b_king: int
    w_bish: int
    b_bish: int
    w_take: int
    b_take: int


def from_fen(fen):
    """The pieces of a FEN. The en passant square counts only if a pawn can capture onto it."""
    fields = fen.split()
    sets = dict.fromkeys('PpKkBbNnRrQq', 0)
    rank, file = 7, 0
    for c in fields[0]:
        if c == '/':
            rank, file = rank - 1, 0
        elif c.isdigit():
            file += int(c)
        else:
            sets[c] |= 1 << (8 * rank + file)
            file += 1
    white_to_move = len(fields) < 2 or fields[1] == 'w'
    en_passant = False
    if len(fields) > 3 and fields[3] != '-':
        target = 1 << (ord(fields[3][0]) - ord('a') + 8 * (int(fields[3][1]) - 1))
        if white_to_move:
            en_passant = sideways(south(target)) & sets['P'] != 0
        else:
            en_passant = sideways(north(target)) & sets['p'] != 0
    castles = {True: False, False: False}
    for c in fields[2] if len(fields) > 2 and fields[2] != '-' else '':
        white = c.isupper()
        back = RANK_1 if white else RANK_8
        king, rooks = sets['K' if white else 'k'] & back, sets['R' if white else 'r'] & back
        if king == 0:
            continue  # a right without its king in place does not count
        kf, files = (king.bit_length() - 1) % 8, [(r.bit_length() - 1) % 8 for r in squares(rooks)]
        if c.upper() == 'K':
            ok = any(f > kf for f in files)
        elif c.upper() == 'Q':
            ok = any(f < kf for f in files)
        else:
            f = ord(c.upper()) - ord('A')
            ok = f != kf and f in files
        castles[white] |= ok
    return Pieces(sets['P'], sets['p'], sets['K'], sets['k'], sets['B'], sets['b'],
                  sets['N'], sets['n'], sets['R'], sets['r'], sets['Q'], sets['q'],
                  white_to_move, en_passant, castles[True], castles[False])


def squares(s):
    """The one-square sets of s."""
    while s:
        b = s & -s
        yield b
        s ^= b


def cannot_be_mated(p, white):
    """Can White (white=True) or Black never be mated, by the lock detector?"""
    after = forced_step(p)
    if after is not None:
        return cannot_be_mated(after, white)
    wx = p.white_knights | p.white_rooks | p.white_queens
    bx = p.black_knights | p.black_rooks | p.black_queens
    if wx | bx:
        return boxed_lock(p, white, wx, bx)
    if p.en_passant:
        return False
    gaps = north(p.white_pawns) & south(p.black_pawns) & no(p.white_pawns | p.black_pawns)
    for frozen in levels(p):
        if gaps:
            f = families(p, gaps, frozen, white)
            if f == 'lock':
                return True
            if f == 'refuted':
                continue  # family A, the level with more walls, leaked: the level leaks too
        s = level(p, frozen, guard=True)
        if s is not None and not net_leaks(p, s, white, 0):
            return True
    return stuck_mater(p, white)


def levels(p, w_own=0, b_own=0):
    """The levels: both kings free (0), then each king frozen on its square (a wall for both sides)
    when every square around it is held or attacked by a pawn (or holds one of its own pieces,
    w_own or b_own, where boxed pieces are on the board)."""
    held = p.white_pawns | p.black_pawns | sideways(north(p.white_pawns) | south(p.black_pawns))
    return [0] + [king for king, own in ((p.white_king, w_own), (p.black_king, b_own))
                  if steps(king) & no(held | own) == 0]


def king_wall(p, white):
    """May this side's king hold a boxed piece's step square (when frozen)? Not with a castling right
    left (a castling rook may stand beside its king, in Chess960, and castling moves it), and not
    where a castle leaves it beside its rook (g1 with a rook on f1, c1 with one on d1; g8, f8, c8,
    d8): a castle leaves the halfmove clock as it is, so the lock is not asked after one."""
    if white:
        king, rooks, castles, g, c = p.white_king, p.white_rooks, p.white_castles, 1 << 6, 1 << 2
    else:
        king, rooks, castles, g, c = p.black_king, p.black_rooks, p.black_castles, 1 << 62, 1 << 58
    return not castles and rooks & (((king & g) >> 1) | ((king & c) << 1)) == 0


def still_bishops(b, held, reach):
    """The still bishops among b: every diagonal neighbour held for good (held: fixed pawns and boxed
    pieces of their colour) or by another still bishop, and out of the enemy king's and bishops'
    reach. Such a bishop never moves and is never taken (a pawn taking it fails the bishop contact
    test). The largest such set."""
    s = b & no(reach)
    while True:
        n = 0
        for q in squares(s):
            if diagonal(q) & no(held | s) == 0:
                n |= q
        if n == s:
            return s
        s = n


def level(p, frozen, wp=None, bp=None, v=0, start=None, wx=0, bx=0, ws=0, bs=0, guard=False):
    """One level: the fixed point of the walls, the pawns that can never move, the kings' reaches,
    the squares where each side may take a pawn, the pawns' cones and the bishops' reaches. The sets
    the mating net reads, or None when the structure leaks whichever side is asked about.
    wp, bp: the pawns (a family has a pair's pawn moved into its gap); v: walls for both sides (the
    gaps of a family's pairs that stay); start: where the kings' reaches, capture squares and bishops'
    reaches start (a family's); wx, bx, ws, bs: the boxed pieces' candidates and their step squares;
    guard: the stalemate guard and the check seed (plain levels only)."""
    wp = p.white_pawns if wp is None else wp
    bp = p.black_pawns if bp is None else bp
    wk, bk = p.white_king, p.black_king
    v |= frozen
    frozen_white = frozen & wk != 0
    frozen_black = not frozen_white and frozen != 0
    near_frozen_black = zone(bk) if frozen_black else 0
    near_frozen_white = zone(wk) if frozen_white else 0
    w_seed, b_seed = check_seed(p) if guard and frozen == 0 else (wk, bk)
    w_king, b_king, w_take, b_take = w_seed, b_seed, w_seed, b_seed
    w_bish, b_bish = p.white_bishops, p.black_bishops
    if start is not None:
        w_king, b_king, w_take, b_take, w_bish, b_bish = start
    w_cone, b_cone, w_fixed, b_fixed = wp, bp, wp, bp
    w_guard = b_guard = ALL if guard else 0  # nothing is taken yet
    while True:
        # Boxed: the pieces no enemy king or bishop reaches. Walls: pawns the other side can never
        # take (or whose capture stalemates their owner), the frozen king, the gaps, boxed pieces.
        boxed = (wx & no(b_king | b_bish)) | (bx & no(w_king | w_bish))
        w_wall = (wp & no(b_take & no(w_guard))) | v | boxed
        b_wall = (bp & no(w_take & no(b_guard))) | v | boxed
        nw_fixed = w_fixed & w_wall & south(b_wall | w_fixed)
        nb_fixed = b_fixed & b_wall & north(w_wall | b_fixed)
        nw_cone, nb_cone = fill_north(w_cone, no(b_wall)), fill_south(b_cone, no(w_wall))
        # The kings: never onto a fixed pawn, a square it attacks, or next to the frozen king; with
        # boxed pieces on the board, never onto its own boxed pieces and still bishops either.
        b_hit, w_hit = sideways(south(nb_fixed)), sideways(north(nw_fixed))
        w_still = b_still = 0
        if wx | bx:
            w_still = still_bishops(p.white_bishops, nw_fixed | (wx & boxed), b_king | b_bish)
            b_still = still_bishops(p.black_bishops, nb_fixed | (bx & boxed), w_king | w_bish)
        nw_king = flood(w_king, no(nw_fixed | b_hit | near_frozen_black | (wx & boxed) | w_still))
        nb_king = flood(b_king, no(nb_fixed | w_hit | near_frozen_white | (bx & boxed) | b_still))
        nw_bish, nb_bish = w_bish, b_bish
        open_squares = no(nw_fixed | nb_fixed)
        while True:
            a = nw_bish | (diagonal(nw_bish) & open_squares)
            d = nb_bish | (diagonal(nb_bish) & open_squares)
            if a == nw_bish and d == nb_bish:
                break
            nw_bish, nb_bish = a, d
        # A side may take a pawn where its king goes, and on any square a pawn may walk into.
        t = b_take | nb_king
        nb_take = t | south(fill_south(t & no(b_wall), no(b_wall)))
        t = w_take | nw_king
        nw_take = t | north(fill_north(t & no(w_wall), no(w_wall)))
        nw_guard, nb_guard = w_guard, b_guard
        if guard:
            block = nw_fixed | nb_fixed
            w_has_b, b_has_b = p.white_bishops != 0, p.black_bishops != 0
            nw_guard = 0 if w_has_b else stalemate_guard(
                wp & nb_take & nw_fixed, wp, nw_fixed, nw_king, nw_fixed | b_hit, nb_king, b_has_b, block)
            nb_guard = 0 if b_has_b else stalemate_guard(
                bp & nw_take & nb_fixed, bp, nb_fixed, nb_king, nb_fixed | w_hit, nw_king, w_has_b, block)
        new = (nw_cone, nb_cone, nw_fixed, nb_fixed, nw_king, nb_king, nw_bish, nb_bish, nw_take, nb_take,
               nw_guard, nb_guard)
        old = (w_cone, b_cone, w_fixed, b_fixed, w_king, b_king, w_bish, b_bish, w_take, b_take, w_guard, b_guard)
        (w_cone, b_cone, w_fixed, b_fixed, w_king, b_king, w_bish, b_bish, w_take, b_take,
         w_guard, b_guard) = new
        if new == old:
            break
    boxed = (wx & no(b_king | b_bish)) | (bx & no(w_king | w_bish))
    if (w_cone & RANK_8) | (b_cone & RANK_1):
        return None  # a pawn can promote
    if (north(sideways(w_cone)) & (b_cone | bx)) | (south(sideways(b_cone)) & wx):
        return None  # a pawn can capture
    if (frozen_white and w_king != wk) or (frozen_black and b_king != bk):
        return None  # the frozen king can move
    if (diagonal(w_bish) & b_cone) | (diagonal(b_bish) & w_cone):
        return None  # a bishop meets a pawn's path
    # A piece may step: a step square not held by a fixed pawn, a boxed piece or a still bishop of
    # its colour, or by its frozen king (where the king may be a wall).
    w_still = still_bishops(p.white_bishops, w_fixed | (wx & boxed), b_king | b_bish) if wx | bx else 0
    b_still = still_bishops(p.black_bishops, b_fixed | (bx & boxed), w_king | w_bish) if wx | bx else 0
    w_kw = wk if frozen_white and king_wall(p, True) else 0
    b_kw = bk if frozen_black and king_wall(p, False) else 0
    if (ws & no(w_fixed | (wx & boxed) | w_still | w_kw)) | (bs & no(b_fixed | (bx & boxed) | b_still | b_kw)):
        return None  # a piece may step
    if w_guard | b_guard:
        # A king that takes a guarded pawn ends the game: for the mating net, the kings' reaches
        # again, now stopping at the enemy's guarded pawns.
        w_king = flood(w_seed, no(w_fixed | sideways(south(b_fixed)) | near_frozen_black | (bp & b_guard)))
        b_king = flood(b_seed, no(b_fixed | sideways(north(w_fixed)) | near_frozen_white | (wp & w_guard)))
    return Sets(w_cone, b_cone, w_fixed, b_fixed, w_king, b_king, w_bish, b_bish, w_take, b_take)


def net_leaks(p, s, white, occ):
    """The mating net: can the other side's pawns and bishops catch the king asked about? occ:
    squares that stand occupied for good besides (the boxed pieces')."""
    if white:
        attack = diagonal(s.b_bish) | sideways(south(s.b_cone))
        reach = s.w_king
        free = no(s.w_cone | occ | zone(s.b_king) | attack)  # never occupied, attacked or next to the mater
        spare = free & no(s.w_bish)                          # ... nor reached by the king's own bishops
        twins = p.white_bishops
    else:
        attack = diagonal(s.w_bish) | sideways(north(s.w_cone))
        reach = s.b_king
        free = no(s.b_cone | occ | zone(s.w_king) | attack)
        spare = free & no(s.b_bish)
        twins = p.black_bishops
    # A king next to a spare square, or with free squares beside it both ways, always has a flight.
    # The second rule counts on at most one of the king's own bishops on the colour of those two
    # squares (the colour opposite the king's): not on the king squares where it has two or more.
    no_pair = (no(DARK) if count(twins & DARK) > 1 else 0) | (DARK if count(twins & no(DARK)) > 1 else 0)
    flight = (sideways(spare) | north(spare) | south(spare)
              | ((north(free) | south(free)) & sideways(free) & no(no_pair)))
    return attack & reach & no(flight) != 0


def check_seed(p):
    """The check seed: the side to move is in a pawn's check, so its king must step now, to a square
    it can step to (not its own pawn, not a square an enemy pawn attacks, not next to the enemy
    king); its reach starts there. Not when it has no such square (that may be a mate now), when one
    of its pawns can take a checking pawn, or with a bishop on the board. The kings' starting sets."""
    wp, bp, wk, bk, white = p.white_pawns, p.black_pawns, p.white_king, p.black_king, p.white_to_move
    if p.white_bishops | p.black_bishops:
        return wk, bk
    k, own = (wk, wp) if white else (bk, bp)
    checkers = sideways(north(k)) & bp if white else sideways(south(k)) & wp
    if not checkers:
        return wk, bk
    attacked = sideways(south(bp)) if white else sideways(north(wp))
    to = steps(k) & no(own) & no(attacked) & no(steps(bk if white else wk))
    takers = (sideways(south(checkers)) if white else sideways(north(checkers))) & own
    if not to or takers:
        return wk, bk
    return (to, bk) if white else (wk, to)


def stalemate_guard(cand, own, own_fixed, reach, shut, enemy_king, enemy_bishops, block):
    """The stalemate guard: of the owner's fixed pawns `cand` (which the enemy king may take), those
    whose capture always stalemates the owner. The owner must have nothing else that moves (every
    other pawn fixed; no bishop, which the caller sees to). reach: where the owner's king may stand;
    shut: squares it can never step to (own fixed pawns, squares the enemy's fixed pawns attack);
    enemy_king: the enemy king's reach; block: squares a bishop's line never crosses."""
    if own & no(own_fixed):
        return 0
    guard = 0
    c = cand
    while c:
        pawn = c & -c
        c &= c - 1
        near = steps(pawn)
        frm = near & enemy_king            # where the enemy king takes from
        x = shut | near | pawn             # after the capture, the owner's king may not step there
        held = True
        k = reach & no(near | pawn)        # the owner's king, not defending the pawn
        while k:
            king = k & -k
            k &= k - 1
            if steps(king) & no(x):
                held = False               # it has a square to step to
                break
            if enemy_bishops and ray_meets(king, block | pawn, frm):
                held = False               # the capture uncovers a check
                break
        if held:
            guard |= pawn
    return guard


def ray_meets(king, block, o):
    """Does a diagonal line from the square `king`, stopped by `block`, meet a square of `o`?"""
    sq = king.bit_length() - 1
    f0, r0 = sq & 7, sq >> 3
    for df, dr in ((-1, -1), (1, -1), (-1, 1), (1, 1)):
        f, r = f0 + df, r0 + dr
        while 0 <= f < 8 and 0 <= r < 8:
            s = 1 << (8 * r + f)
            if o & s:
                return True
            if block & s:
                break
            f, r = f + df, r + dr
    return False


def families(p, gaps, frozen, white):
    """The families of the open pairs at one level: 'lock' when none of them leaks to the king asked
    about, 'refuted' when family A (no pair's pawn has moved) does, 'none' otherwise."""
    pairs = []  # per pair: the gap, the white pawn below it, the black pawn above it
    g = gaps
    while g:
        gap = g & -g
        g &= g - 1
        pairs.append((gap, south(gap), north(gap)))
    if len(pairs) > MAX_PAIRS:
        return 'none'
    k, sets = len(pairs), []
    for f in range(3 ** k):
        # Family f: digit i (base 3) says what pair i's pawns have done: 0 neither, 1 the white one
        # stepped into the gap, 2 the black one did. Its sets start from those of the family it is
        # reached from (the same with pair i's pawns in place), minus the gap.
        wp, bp, v = p.white_pawns, p.black_pawns, 0
        if f == 0:
            start = [p.white_king, p.black_king, p.white_king, p.black_king, p.white_bishops, p.black_bishops]
        else:
            start = [0] * 6
        q = f
        for i in range(k):
            d, q = q % 3, q // 3
            gap, w, b = pairs[i]
            if d == 0:
                v |= gap  # the gap stays: a wall for both sides' pawns
                continue
            if d == 1:
                wp = (wp & no(w)) | gap
            else:
                bp = (bp & no(b)) | gap
            r = sets[f - d * 3 ** i]
            start[0] |= r.w_king & no(gap)
            start[1] |= r.b_king & no(gap)
            start[2] |= r.w_take
            start[3] |= r.b_take
            start[4] |= r.w_bish & no(gap)
            start[5] |= r.b_bish & no(gap)
        s = level(p, frozen, wp=wp, bp=bp, v=v, start=start)
        if s is None:
            return 'refuted' if f == 0 else 'none'
        # The pairs that stay: both pawns must never move.
        q = f
        for i in range(k):
            if q % 3 == 0 and (pairs[i][1] & no(s.w_fixed)) | (pairs[i][2] & no(s.b_fixed)):
                return 'none'
            q //= 3
        if net_leaks(p, s, white, 0):
            return 'refuted' if f == 0 else 'none'
        sets.append(s)
    return 'lock'


def boxed_lock(p, white, wx, bx):
    """With knights, rooks or queens on the board: every one of them must be boxed in by its own
    pawns and pieces (bishops and the king among them: the level checks that they never move);
    then the levels, with the boxed pieces as walls and no flight onto their squares."""
    w_own = p.white_pawns | wx | p.white_bishops | (p.white_king if king_wall(p, True) else 0)
    b_own = p.black_pawns | bx | p.black_bishops | (p.black_king if king_wall(p, False) else 0)
    ws = box_steps(p.white_knights, p.white_rooks | p.white_queens, p.white_queens, w_own)
    bs = box_steps(p.black_knights, p.black_rooks | p.black_queens, p.black_queens, b_own)
    if ws is None or bs is None or p.en_passant:
        return False
    for frozen in levels(p, wx | p.white_bishops, bx | p.black_bishops):
        s = level(p, frozen, wx=wx, bx=bx, ws=ws, bs=bs)
        if s is not None and not net_leaks(p, s, white, wx | bx):
            return True
    return False


def box_steps(knights, o, queens, own):
    """The step squares of one side's knights, rooks (and queens: o) and queens, or None when one
    of them is not held by its own men (own)."""
    s = sideways(o) | north(o) | south(o)  # rooks' and queens' orthogonal neighbours
    d = diagonal(queens)                   # queens' diagonal neighbours
    k = knight(knights)                    # knights' squares
    if (s | d | k) & no(own):
        return None
    return s | d | k


def stuck_mater(p, white):
    """The stuck mater: the flagged side is to move and, whatever it plays, the mater has no legal
    move left (kings and pawns only): the game ends at the mater's turn."""
    if p.white_to_move != white or p.en_passant:
        return False
    if (p.white_bishops | p.black_bishops | p.white_knights | p.black_knights | p.white_rooks
            | p.black_rooks | p.white_queens | p.black_queens):
        return False
    fp, mp = (p.white_pawns, p.black_pawns) if white else (p.black_pawns, p.white_pawns)
    fk, mk = (p.white_king, p.black_king) if white else (p.black_king, p.white_king)
    occ = fp | mp | fk | mk
    fwd = north if white else south   # ahead, for the flagged side
    back = south if white else north  # behind
    # A mater's pawn with an empty square ahead is never stuck; then only a stalemate now is left
    # to find, which a flagged pawn's push rules out.
    if back(mp) & no(occ) and fwd(fp) & no(occ):
        return False
    f_attack, m_attack = sideways(fwd(fp)), sideways(back(mp))
    if f_attack & (mp | mk):
        return False                                  # 1. the flagged side has no capture
    single = fwd(fp) & no(occ)
    double = fwd(single & (RANK_3 if white else RANK_6)) & no(occ)
    pushes = single | double
    near = steps(mk)
    king_to = steps(fk) & no(fp) & no(m_attack) & no(near)  # the flagged king's steps now
    in_check = fk & m_attack != 0
    if in_check and not king_to:
        return False                                  # mated now
    stays = pushes != 0 and not in_check              # a pawn may move instead of the king
    if not king_to and not stays:
        return True                                   # no move, no check: stalemate now
    # The squares next to every square the flagged king may stand on after its move.
    cover = steps(fk) if stays else ALL
    k = king_to
    while k:
        cover &= steps(k & -k)
        k &= k - 1
    # 2. the mater's pawns are blocked by men that stay, and attack no flagged pawn
    blockers = fp | mp | mk | (0 if king_to else fk)
    if (back(mp) & no(blockers)) | (m_attack & fp):
        return False
    # 3. every square next to the mater's king: its own pawn, attacked by a flagged pawn that
    #    cannot move now, or next to the flagged king wherever it goes
    still = fp & back(fwd(fp) & occ)
    if near & no(mp | sideways(fwd(still)) | cover):
        return False
    # 4. no push lands where a mater's pawn attacks or next to its king, nor lets it take en passant
    if (pushes & (m_attack | near)) | (double & sideways(mp)):
        return False
    return True


def forced_step(p):
    """The forced step: the side to move is in a pawn's check, with kings and pawns only, and its
    one legal move is a step of its king. The position after it, or None."""
    if p.en_passant or (p.white_bishops | p.black_bishops | p.white_knights | p.black_knights
                        | p.white_rooks | p.black_rooks | p.white_queens | p.black_queens):
        return None
    white = p.white_to_move
    k, ek = (p.white_king, p.black_king) if white else (p.black_king, p.white_king)
    own, enemy = (p.white_pawns, p.black_pawns) if white else (p.black_pawns, p.white_pawns)
    checkers = (sideways(north(k)) if white else sideways(south(k))) & enemy
    if not checkers:
        return None
    attacked = sideways(south(enemy)) if white else sideways(north(enemy))
    to = steps(k) & no(own) & no(attacked) & no(steps(ek))
    if count(to) != 1:
        return None
    if (sideways(south(checkers)) if white else sideways(north(checkers))) & own:
        return None  # a pawn may take instead
    if white:
        return replace(p, white_king=to, black_pawns=p.black_pawns & no(to), white_to_move=False, en_passant=False)
    return replace(p, black_king=to, white_pawns=p.white_pawns & no(to), white_to_move=True, en_passant=False)
