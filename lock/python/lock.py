"""Mateless's lock detector, in its simplest form.

Can a side never be mated? The lock detector answers yes when pawns, kings and bishops form a
structure that no series of legal moves can open (FIDE 5.2.2 dead position, 6.9 flag fall). It
reads bitboards only: it generates no move and searches nothing.

Each king's reach (every square it may ever stand on) is grown from its square, never onto a
square that a pawn which can never move attacks. The pawns that can never move are those blocked
by a wall: a pawn the other side can never take. The squares where a side may take a pawn grow
from its king's reach, and so on, until nothing changes. The structure leaks if a pawn can
promote or capture, a frozen king can move, a bishop can reach a pawn's path, or the king of the
side asked about can reach a square the other side attacks where it has no sure flight. It is
tried with both kings free, then with each king frozen on its square (a wall for both sides) when
every square around that king is held or attacked by a pawn.

A knight, rook or queen on the board, two bishops of one side on squares of one colour, or a
possible en passant capture fails it at once. Sound, not complete: a structure it passes can
never be opened; one it fails may still be dead.

Squares: a1 = 0, b1 = 1, ..., h8 = 63. A set of squares (a bitboard) is a 64-bit integer.
"""

ALL = (1 << 64) - 1  # Python's integers have no size: every set is kept to 64 bits
FILE_A = 0x0101010101010101
FILE_H = 0x8080808080808080
RANK_1 = 0x00000000000000FF
RANK_8 = 0xFF00000000000000
DARK = 0xAA55AA55AA55AA55  # the dark squares; a1 is dark


def north(s): return (s << 8) & ALL
def south(s): return s >> 8
def sideways(s): return ((s << 1) & ~FILE_A & ALL) | ((s >> 1) & ~FILE_H)
def zone(s): v = s | north(s) | south(s); return v | sideways(v)  # s and every square next to it
def diagonal(s): return sideways(north(s) | south(s))  # the squares diagonally next to s
def count(s): return bin(s).count('1')
def no(s): return ~s & ALL  # every square not in s


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


class Pieces:
    """What the lock detector reads from a position."""

    def __init__(self, white_pawns=0, black_pawns=0, white_king=0, black_king=0,
                 white_bishops=0, black_bishops=0, others=0, en_passant=False):
        self.white_pawns, self.black_pawns = white_pawns, black_pawns
        self.white_king, self.black_king = white_king, black_king
        self.white_bishops, self.black_bishops = white_bishops, black_bishops
        self.others = others            # knights, rooks and queens of both sides
        self.en_passant = en_passant    # the side to move can capture en passant


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
    return Pieces(sets['P'], sets['p'], sets['K'], sets['k'], sets['B'], sets['b'],
                  sets['N'] | sets['n'] | sets['R'] | sets['r'] | sets['Q'] | sets['q'],
                  en_passant)


def twin_bishops(b):
    """Two bishops on squares of one colour (only a promotion makes them)."""
    return count(b & DARK) > 1 or count(b & ~DARK) > 1


def cannot_be_mated(p, white):
    """Can White (white=True) or Black never be mated, by the lock detector?"""
    if p.others or p.en_passant:
        return False
    if twin_bishops(p.white_bishops) or twin_bishops(p.black_bishops):
        return False
    if not leaks(p, white, 0):
        return True
    # A king may be frozen only if every square around it is held or attacked by a pawn.
    held = p.white_pawns | p.black_pawns | sideways(north(p.white_pawns) | south(p.black_pawns))
    for king in (p.white_king, p.black_king):
        if zone(king) & no(king) & no(held) == 0 and not leaks(p, white, king):
            return True
    return False


def leaks(p, white, frozen):
    """Does the structure leak to the king asked about, with the king `frozen` frozen (0: none)?"""
    wp, bp, wk, bk = p.white_pawns, p.black_pawns, p.white_king, p.black_king
    frozen_white = frozen & wk != 0
    frozen_black = not frozen_white and frozen != 0
    near_frozen_black = zone(bk) if frozen_black else 0
    near_frozen_white = zone(wk) if frozen_white else 0

    # Quick: the pawns' paths against the first walls already show a promotion or a capture.
    w_cone = fill_north(wp, no((bp & no(wk)) | frozen))
    b_cone = fill_south(bp, no((wp & no(bk)) | frozen))
    if (w_cone & RANK_8) | (b_cone & RANK_1) or north(sideways(w_cone)) & b_cone:
        return True

    # The cycle: walls -> pawns that can never move -> king reaches -> capture squares -> walls.
    w_fixed, b_fixed = wp, bp          # pawns that can never move      (shrink)
    w_king, b_king = wk, bk            # squares each king may reach    (grow)
    w_take, b_take = wk, bk            # squares where a side may take an enemy pawn (grow)
    w_wall = b_wall = ALL              # pawns the other side can never take, and the frozen king
    while True:
        last_w_wall, last_b_wall = w_wall, b_wall
        w_wall = (wp & no(b_take)) | frozen
        b_wall = (bp & no(w_take)) | frozen
        new_w_fixed = w_fixed & w_wall & south(b_wall | w_fixed)
        new_b_fixed = b_fixed & b_wall & north(w_wall | b_fixed)
        if (w_wall == last_w_wall and b_wall == last_b_wall
                and new_w_fixed == w_fixed and new_b_fixed == b_fixed):
            break
        # Both kings' reaches, flooded: never onto a fixed pawn, a square it attacks, or next to
        # the frozen king.
        w_mask = no(new_w_fixed | sideways(south(new_b_fixed)) | near_frozen_black)
        b_mask = no(new_b_fixed | sideways(north(new_w_fixed)) | near_frozen_white)
        new_w_king, new_b_king = w_king, b_king
        while True:
            a = new_w_king | (zone(new_w_king) & w_mask)
            d = new_b_king | (zone(new_b_king) & b_mask)
            if a == new_w_king and d == new_b_king:
                break
            new_w_king, new_b_king = a, d
        if (frozen_white and new_w_king != wk) or (frozen_black and new_b_king != bk):
            return True  # the frozen king can move
        # A side may take a pawn where its king goes, and on any square a pawn may walk into.
        t = b_take | new_b_king
        new_b_take = t | south(fill_south(t & no(b_wall), no(b_wall)))
        t = w_take | new_w_king
        new_w_take = t | north(fill_north(t & no(w_wall), no(w_wall)))
        changed = (new_w_fixed != w_fixed or new_b_fixed != b_fixed or new_w_king != w_king
                   or new_b_king != b_king or new_w_take != w_take or new_b_take != b_take)
        w_fixed, b_fixed, w_king, b_king = new_w_fixed, new_b_fixed, new_w_king, new_b_king
        w_take, b_take = new_w_take, new_b_take
        if not changed:
            break

    # The pawns' cones: every square they may still reach.
    w_cone = fill_north(wp, no(b_wall))
    b_cone = fill_south(bp, no(w_wall))
    if (w_cone & RANK_8) | (b_cone & RANK_1):
        return True  # a pawn can promote
    if north(sideways(w_cone)) & b_cone:
        return True  # a pawn can capture
    # The bishops' reaches: every square they may reach, around the fixed pawns.
    w_bish, b_bish = p.white_bishops, p.black_bishops
    open_squares = no(w_fixed | b_fixed)
    while True:
        a = w_bish | (diagonal(w_bish) & open_squares)
        d = b_bish | (diagonal(b_bish) & open_squares)
        if a == w_bish and d == b_bish:
            break
        w_bish, b_bish = a, d
    if diagonal(w_bish) & b_cone or diagonal(b_bish) & w_cone:
        return True  # a bishop meets a pawn's path

    # The mating net: can the other side's pawns and bishops catch the king asked about?
    if white:
        attack = diagonal(b_bish) | sideways(south(b_cone))
        reach = w_king
        free = no(w_cone | zone(b_king) | attack)   # never occupied, attacked or next to the mater
        spare = free & no(w_bish)                   # ... nor reached by the king's own bishops
    else:
        attack = diagonal(w_bish) | sideways(north(w_cone))
        reach = b_king
        free = no(b_cone | zone(w_king) | attack)
        spare = free & no(b_bish)
    # A king next to a spare square, or with free squares beside it both ways, always has a flight.
    flight = sideways(spare) | north(spare) | south(spare) | ((north(free) | south(free)) & sideways(free))
    return attack & reach & no(flight) != 0
