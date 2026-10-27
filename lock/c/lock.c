/* Mateless's lock detector, in its simplest form.

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
   never be opened; one it fails may still be dead. */
#include "lock.h"

typedef uint64_t Set;

#define FILE_A 0x0101010101010101ULL
#define FILE_H 0x8080808080808080ULL
#define RANK_1 0x00000000000000FFULL
#define RANK_8 0xFF00000000000000ULL
#define DARK   0xAA55AA55AA55AA55ULL   /* the dark squares; a1 is dark */

static Set north(Set s) { return s << 8; }
static Set south(Set s) { return s >> 8; }
static Set sideways(Set s) { return ((s << 1) & ~FILE_A) | ((s >> 1) & ~FILE_H); }
static Set zone(Set s) { Set v = s | north(s) | south(s); return v | sideways(v); }  /* s and every square next to it */
static Set diagonal(Set s) { return sideways(north(s) | south(s)); }               /* the squares diagonally next to s */
static int count(Set s) { int n = 0; for (; s; s &= s - 1) n++; return n; }

/* Every square reachable from g by steps north through squares of p. */
static Set fill_north(Set g, Set p) {
    g |= p & (g << 8);
    p &= p << 8;
    g |= p & (g << 16);
    p &= p << 16;
    return g | (p & (g << 32));
}

/* Every square reachable from g by steps south through squares of p. */
static Set fill_south(Set g, Set p) {
    g |= p & (g >> 8);
    p &= p >> 8;
    g |= p & (g >> 16);
    p &= p >> 16;
    return g | (p & (g >> 32));
}

Pieces lock_from_fen(const char *fen) {
    Pieces p = {0};
    int rank = 7, file = 0;
    const char *c = fen;
    for (; *c && *c != ' '; c++) {
        if (*c == '/') { rank--; file = 0; continue; }
        if (*c >= '1' && *c <= '8') { file += *c - '0'; continue; }
        Set sq = 1ULL << (8 * rank + file++);
        switch (*c) {
        case 'P': p.white_pawns |= sq; break;
        case 'p': p.black_pawns |= sq; break;
        case 'K': p.white_king |= sq; break;
        case 'k': p.black_king |= sq; break;
        case 'B': p.white_bishops |= sq; break;
        case 'b': p.black_bishops |= sq; break;
        default: p.others |= sq; break;   /* N R Q n r q */
        }
    }
    while (*c == ' ') c++;
    bool white_to_move = *c != 'b';
    for (int field = 0; field < 2 && *c; field++) {       /* past the side to move and castling */
        while (*c && *c != ' ') c++;
        while (*c == ' ') c++;
    }
    if (c[0] >= 'a' && c[0] <= 'h' && c[1] >= '1' && c[1] <= '8') {
        Set target = 1ULL << ((c[0] - 'a') + 8 * (c[1] - '1'));
        p.en_passant = white_to_move ? (sideways(south(target)) & p.white_pawns) != 0
                                     : (sideways(north(target)) & p.black_pawns) != 0;
    }
    return p;
}

/* Two bishops on squares of one colour (only a promotion makes them). */
static bool twin_bishops(Set b) { return count(b & DARK) > 1 || count(b & ~DARK) > 1; }

static bool leaks(const Pieces *p, bool white, Set frozen);

bool lock_cannot_be_mated(const Pieces *p, bool white) {
    if (p->others || p->en_passant) return false;
    if (twin_bishops(p->white_bishops) || twin_bishops(p->black_bishops)) return false;
    if (!leaks(p, white, 0)) return true;
    /* A king may be frozen only if every square around it is held or attacked by a pawn. */
    Set held = p->white_pawns | p->black_pawns | sideways(north(p->white_pawns) | south(p->black_pawns));
    Set kings[2] = { p->white_king, p->black_king };
    for (int i = 0; i < 2; i++)
        if ((zone(kings[i]) & ~kings[i] & ~held) == 0 && !leaks(p, white, kings[i])) return true;
    return false;
}

/* Does the structure leak to the king asked about, with the king `frozen` frozen (0: none)? */
static bool leaks(const Pieces *p, bool white, Set frozen) {
    Set wp = p->white_pawns, bp = p->black_pawns, wk = p->white_king, bk = p->black_king;
    bool frozen_white = (frozen & wk) != 0;
    bool frozen_black = !frozen_white && frozen != 0;
    Set near_frozen_black = frozen_black ? zone(bk) : 0;
    Set near_frozen_white = frozen_white ? zone(wk) : 0;

    /* Quick: the pawns' paths against the first walls already show a promotion or a capture. */
    Set w_cone = fill_north(wp, ~((bp & ~wk) | frozen));
    Set b_cone = fill_south(bp, ~((wp & ~bk) | frozen));
    if ((w_cone & RANK_8) | (b_cone & RANK_1) | (north(sideways(w_cone)) & b_cone)) return true;

    /* The cycle: walls -> pawns that can never move -> king reaches -> capture squares -> walls. */
    Set w_fixed = wp, b_fixed = bp;     /* pawns that can never move      (shrink) */
    Set w_king = wk, b_king = bk;       /* squares each king may reach    (grow) */
    Set w_take = wk, b_take = bk;       /* squares where a side may take an enemy pawn (grow) */
    Set w_wall = ~0ULL, b_wall = ~0ULL; /* pawns the other side can never take, and the frozen king */
    for (;;) {
        Set last_w_wall = w_wall, last_b_wall = b_wall;
        w_wall = (wp & ~b_take) | frozen;
        b_wall = (bp & ~w_take) | frozen;
        Set new_w_fixed = w_fixed & w_wall & south(b_wall | w_fixed);
        Set new_b_fixed = b_fixed & b_wall & north(w_wall | b_fixed);
        if (w_wall == last_w_wall && b_wall == last_b_wall && new_w_fixed == w_fixed && new_b_fixed == b_fixed)
            break;
        /* Both kings' reaches, flooded: never onto a fixed pawn, a square it attacks, or next to
           the frozen king. */
        Set w_mask = ~(new_w_fixed | sideways(south(new_b_fixed)) | near_frozen_black);
        Set b_mask = ~(new_b_fixed | sideways(north(new_w_fixed)) | near_frozen_white);
        Set new_w_king = w_king, new_b_king = b_king;
        for (;;) {
            Set a = new_w_king | (zone(new_w_king) & w_mask);
            Set d = new_b_king | (zone(new_b_king) & b_mask);
            if (a == new_w_king && d == new_b_king) break;
            new_w_king = a;
            new_b_king = d;
        }
        if ((frozen_white && new_w_king != wk) || (frozen_black && new_b_king != bk))
            return true;   /* the frozen king can move */
        /* A side may take a pawn where its king goes, and on any square a pawn may walk into. */
        Set t = b_take | new_b_king;
        Set new_b_take = t | south(fill_south(t & ~b_wall, ~b_wall));
        t = w_take | new_w_king;
        Set new_w_take = t | north(fill_north(t & ~w_wall, ~w_wall));
        bool changed = new_w_fixed != w_fixed || new_b_fixed != b_fixed || new_w_king != w_king ||
                       new_b_king != b_king || new_w_take != w_take || new_b_take != b_take;
        w_fixed = new_w_fixed; b_fixed = new_b_fixed; w_king = new_w_king; b_king = new_b_king;
        w_take = new_w_take; b_take = new_b_take;
        if (!changed) break;
    }

    /* The pawns' cones: every square they may still reach. */
    w_cone = fill_north(wp, ~b_wall);
    b_cone = fill_south(bp, ~w_wall);
    if ((w_cone & RANK_8) | (b_cone & RANK_1)) return true;   /* a pawn can promote */
    if (north(sideways(w_cone)) & b_cone) return true;        /* a pawn can capture */
    /* The bishops' reaches: every square they may reach, around the fixed pawns. */
    Set w_bish = p->white_bishops, b_bish = p->black_bishops, open = ~(w_fixed | b_fixed);
    for (;;) {
        Set a = w_bish | (diagonal(w_bish) & open);
        Set d = b_bish | (diagonal(b_bish) & open);
        if (a == w_bish && d == b_bish) break;
        w_bish = a;
        b_bish = d;
    }
    if ((diagonal(w_bish) & b_cone) | (diagonal(b_bish) & w_cone)) return true;   /* a bishop meets a pawn's path */

    /* The mating net: can the other side's pawns and bishops catch the king asked about? */
    Set attack, reach, free, spare;
    if (white) {
        attack = diagonal(b_bish) | sideways(south(b_cone));
        reach = w_king;
        free = ~(w_cone | zone(b_king) | attack);   /* never occupied, attacked or next to the mater */
        spare = free & ~w_bish;                     /* ... nor reached by the king's own bishops */
    } else {
        attack = diagonal(w_bish) | sideways(north(w_cone));
        reach = b_king;
        free = ~(b_cone | zone(w_king) | attack);
        spare = free & ~b_bish;
    }
    /* A king next to a spare square, or with free squares beside it both ways, always has a flight. */
    Set flight = sideways(spare) | north(spare) | south(spare) | ((north(free) | south(free)) & sideways(free));
    return (attack & reach & ~flight) != 0;
}
