/* Mateless's lock detector, second version, in its simplest form.

   Can a side never be mated? The lock detector answers yes when pawns, kings and bishops (and
   knights, rooks or queens boxed in by their own men) form a structure that no series of legal
   moves can open (FIDE 5.2.2 dead position, 6.9 flag fall). It reads bitboards and the side to
   move: it generates no move and searches nothing.

   The first version (../../c/lock.c) grows each king's reach, the pawns that can never move, and
   the squares where each side may take a pawn, until nothing changes; the structure leaks if a
   pawn can promote or capture, a frozen king can move, a bishop can reach a pawn's path, or the
   king asked about can reach a square the other side attacks without a sure flight. This version
   keeps all of it and adds, each only where its situation is on the board:
     - open pawn pairs: a white and a black pawn on one file with one empty square between them;
       the reachable positions split into families by what the pair's pawns have done (neither
       moved, the white one stepped into the gap, the black one did), up to 3 pairs;
     - boxed knights, rooks and queens: a piece whose every step square holds one of its own men
       that never moves, and that no enemy king or bishop reaches, never moves nor falls; such a
       man is a fixed pawn, another boxed piece, a still bishop (every diagonal neighbour held so,
       and out of the enemy king's and bishops' reach) or the piece's own frozen king (its side
       with no castling right left and not standing where a castle leaves it beside its rook);
     - twin bishops: two bishops of one side on one colour no longer fail it; the mating net
       leaves out its second flight rule where they may hold both flights;
     - the stalemate guard: a pawn the enemy king may take stays a wall if taking it always
       stalemates its owner;
     - the check seed: a king in a pawn's check starts its reach from the squares it can step to;
     - the stuck mater: whatever the flagged side plays, the mater is left without a move;
     - the forced step: a king in a pawn's check with one legal move, a step: the lock of the
       position after it.
   A possible en passant capture fails it at once. Sound, not complete: a structure it passes can
   never be opened; one it fails may still be dead. */
#include "lock.h"

typedef uint64_t Set;

#define FILE_A 0x0101010101010101ULL
#define FILE_H 0x8080808080808080ULL
#define RANK_1 0x00000000000000FFULL
#define RANK_3 0x0000000000FF0000ULL
#define RANK_6 0x0000FF0000000000ULL
#define RANK_8 0xFF00000000000000ULL
#define DARK   0xAA55AA55AA55AA55ULL   /* the dark squares; a1 is dark */
#define MAX_PAIRS 3                    /* the most open pairs the families are split on (3^3 = 27) */

static Set north(Set s) { return s << 8; }
static Set south(Set s) { return s >> 8; }
static Set sideways(Set s) { return ((s << 1) & ~FILE_A) | ((s >> 1) & ~FILE_H); }
static Set zone(Set s) { Set v = s | north(s) | south(s); return v | sideways(v); }  /* s and every square next to it */
static Set steps(Set s) { return zone(s) & ~s; }                                     /* the squares next to s */
static Set diagonal(Set s) { return sideways(north(s) | south(s)); }               /* the squares diagonally next to s */
static int count(Set s) { int n = 0; for (; s; s &= s - 1) n++; return n; }
static Set lowest(Set s) { return s & (~s + 1); }                                  /* the lowest square of s */
static int square_of(Set s) { int n = 0; while (!((s >> n) & 1)) n++; return n; }  /* the lowest square's number */

/* The squares a knight on s goes to. */
static Set knight(Set s) {
    Set one = sideways(s);
    Set two = ((s << 2) & ~(FILE_A | (FILE_A << 1))) | ((s >> 2) & ~(FILE_H | (FILE_H >> 1)));
    return north(north(one)) | south(south(one)) | north(two) | south(two);
}

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

/* Every square a king may reach from k through squares of m. */
static Set flood(Set k, Set m) {
    for (;;) { Set a = k | (zone(k) & m); if (a == k) return k; k = a; }
}

/* What one level leaves for the mating net (and for the families after it). */
typedef struct { Set w_cone, b_cone, w_fixed, b_fixed, w_king, b_king, w_bish, b_bish, w_take, b_take; } Sets;

/* The inputs of a level beyond the position: see level(). */
typedef struct {
    bool family;             /* the pawns and starting sets below are a family's */
    Set wp, bp, v;
    Set start[6];
    Set wx, bx, ws, bs;
    bool guard;
} Level;

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
        case 'N': p.white_knights |= sq; break;
        case 'n': p.black_knights |= sq; break;
        case 'R': p.white_rooks |= sq; break;
        case 'r': p.black_rooks |= sq; break;
        case 'Q': p.white_queens |= sq; break;
        default: p.black_queens |= sq; break;   /* q */
        }
    }
    while (*c == ' ') c++;
    p.white_to_move = *c != 'b';
    while (*c && *c != ' ') c++;                          /* past the side to move */
    while (*c == ' ') c++;
    for (; *c && *c != ' '; c++) {                        /* the castling rights */
        bool white = *c >= 'A' && *c <= 'Z';
        char up = (char)(*c & ~0x20);
        Set king = (white ? p.white_king : p.black_king) & (white ? RANK_1 : RANK_8);
        Set rooks = (white ? p.white_rooks : p.black_rooks) & (white ? RANK_1 : RANK_8);
        if (*c == '-' || !king) continue;                 /* a right without its king in place does not count */
        int kf = square_of(king) % 8;
        bool ok = false;
        for (Set r = rooks; r; r &= r - 1) {
            int f = square_of(r) % 8;
            if ((up == 'K' && f > kf) || (up == 'Q' && f < kf) || (up != 'K' && up != 'Q' && f == up - 'A' && f != kf)) ok = true;
        }
        if (ok && white) p.white_castles = true;
        else if (ok) p.black_castles = true;
    }
    while (*c == ' ') c++;
    if (c[0] >= 'a' && c[0] <= 'h' && c[1] >= '1' && c[1] <= '8') {
        Set target = 1ULL << ((c[0] - 'a') + 8 * (c[1] - '1'));
        p.en_passant = p.white_to_move ? (sideways(south(target)) & p.white_pawns) != 0
                                       : (sideways(north(target)) & p.black_pawns) != 0;
    }
    return p;
}

static bool forced_step(const Pieces *p, Pieces *after);
static int levels(const Pieces *p, Set w_own, Set b_own, Set out[3]);
static bool level(const Pieces *p, Set frozen, const Level *o, Sets *s);
static bool net_leaks(const Pieces *p, const Sets *s, bool white, Set occ);
static int families(const Pieces *p, Set gaps, Set frozen, bool white);
static bool boxed_lock(const Pieces *p, bool white, Set wx, Set bx);
static bool stuck_mater(const Pieces *p, bool white);

enum { FAMILY_LOCK, FAMILY_REFUTED, FAMILY_NONE };   /* what the families of the open pairs say at one level */

bool lock_cannot_be_mated(const Pieces *p, bool white) {
    Pieces after;
    if (forced_step(p, &after)) return lock_cannot_be_mated(&after, white);
    Set wx = p->white_knights | p->white_rooks | p->white_queens, bx = p->black_knights | p->black_rooks | p->black_queens;
    if (wx | bx) return boxed_lock(p, white, wx, bx);
    if (p->en_passant) return false;
    Set gaps = north(p->white_pawns) & south(p->black_pawns) & ~(p->white_pawns | p->black_pawns);
    Set lv[3];
    int n = levels(p, 0, 0, lv);
    for (int i = 0; i < n; i++) {
        if (gaps) {
            int f = families(p, gaps, lv[i], white);
            if (f == FAMILY_LOCK) return true;
            if (f == FAMILY_REFUTED) continue;   /* family A, the level with more walls, leaked: the level leaks too */
        }
        Level o = {0};
        o.guard = true;
        Sets s;
        if (level(p, lv[i], &o, &s) && !net_leaks(p, &s, white, 0)) return true;
    }
    return stuck_mater(p, white);
}

/* The levels: both kings free (0), then each king frozen on its square (a wall for both sides)
   when every square around it is held or attacked by a pawn (or holds one of its own pieces, w_own
   or b_own, where boxed pieces are on the board). Their number. */
static int levels(const Pieces *p, Set w_own, Set b_own, Set out[3]) {
    Set held = p->white_pawns | p->black_pawns | sideways(north(p->white_pawns) | south(p->black_pawns));
    int n = 0;
    out[n++] = 0;
    if ((steps(p->white_king) & ~(held | w_own)) == 0) out[n++] = p->white_king;
    if ((steps(p->black_king) & ~(held | b_own)) == 0) out[n++] = p->black_king;
    return n;
}

/* May this side's king hold a boxed piece's step square (when frozen)? Not with a castling right
   left (a castling rook may stand beside its king, in Chess960, and castling moves it), and not
   where a castle leaves it beside its rook (g1 with a rook on f1, c1 with one on d1; g8, f8, c8,
   d8): a castle leaves the halfmove clock as it is, so the lock is not asked after one. */
static bool king_wall(const Pieces *p, bool white) {
    Set king = white ? p->white_king : p->black_king, rooks = white ? p->white_rooks : p->black_rooks;
    Set g = white ? 1ULL << 6 : 1ULL << 62, c = white ? 1ULL << 2 : 1ULL << 58;
    return !(white ? p->white_castles : p->black_castles) && !(rooks & (((king & g) >> 1) | ((king & c) << 1)));
}

/* The still bishops among b: every diagonal neighbour held for good (held: fixed pawns and boxed
   pieces of their colour) or by another still bishop, and out of the enemy king's and bishops'
   reach. Such a bishop never moves and is never taken (a pawn taking it fails the bishop contact
   test). The largest such set. */
static Set still_bishops(Set b, Set held, Set reach) {
    Set s = b & ~reach;
    for (;;) {
        Set n = 0;
        for (Set m = s; m; m &= m - 1) {
            Set q = lowest(m);
            if (!(diagonal(q) & ~(held | s))) n |= q;
        }
        if (n == s) return s;
        s = n;
    }
}

/* The check seed: the side to move is in a pawn's check, so its king must step now, to a square it
   can step to (not its own pawn, not a square an enemy pawn attacks, not next to the enemy king);
   its reach starts there. Not when it has no such square (that may be a mate now), when one of its
   pawns can take a checking pawn, or with a bishop on the board. The kings' starting sets. */
static void check_seed(const Pieces *p, Set *w_seed, Set *b_seed) {
    Set wp = p->white_pawns, bp = p->black_pawns, wk = p->white_king, bk = p->black_king;
    bool white = p->white_to_move;
    *w_seed = wk;
    *b_seed = bk;
    if (p->white_bishops | p->black_bishops) return;
    Set k = white ? wk : bk, own = white ? wp : bp;
    Set checkers = white ? sideways(north(k)) & bp : sideways(south(k)) & wp;
    if (!checkers) return;
    Set attacked = white ? sideways(south(bp)) : sideways(north(wp));
    Set to = steps(k) & ~own & ~attacked & ~steps(white ? bk : wk);
    Set takers = (white ? sideways(south(checkers)) : sideways(north(checkers))) & own;
    if (!to || takers) return;
    if (white) *w_seed = to; else *b_seed = to;
}

/* Does a diagonal line from the square king, stopped by block, meet a square of o? */
static bool ray_meets(Set king, Set block, Set o) {
    int sq = 0;
    while (!((king >> sq) & 1)) sq++;
    static const int d[4][2] = { { -1, -1 }, { 1, -1 }, { -1, 1 }, { 1, 1 } };
    for (int i = 0; i < 4; i++) {
        for (int f = (sq & 7) + d[i][0], r = (sq >> 3) + d[i][1]; f >= 0 && f < 8 && r >= 0 && r < 8; f += d[i][0], r += d[i][1]) {
            Set s = 1ULL << (8 * r + f);
            if (o & s) return true;
            if (block & s) break;
        }
    }
    return false;
}

/* The stalemate guard: of the owner's fixed pawns cand (which the enemy king may take), those whose
   capture always stalemates the owner. The owner must have nothing else that moves (every other
   pawn fixed; no bishop, which the caller sees to). reach: where the owner's king may stand; shut:
   squares it can never step to (own fixed pawns, squares the enemy's fixed pawns attack);
   enemy_king: the enemy king's reach; block: squares a bishop's line never crosses. */
static Set stalemate_guard(Set cand, Set own, Set own_fixed, Set reach, Set shut, Set enemy_king,
                           bool enemy_bishops, Set block) {
    if (own & ~own_fixed) return 0;
    Set guard = 0;
    for (Set c = cand; c; c &= c - 1) {
        Set pawn = lowest(c), near = steps(pawn);
        Set from = near & enemy_king;              /* where the enemy king takes from */
        Set x = shut | near | pawn;                /* after the capture, the owner's king may not step there */
        bool held = true;
        for (Set k = reach & ~(near | pawn); k; k &= k - 1) {   /* the owner's king, not defending the pawn */
            Set king = lowest(k);
            if ((steps(king) & ~x) || (enemy_bishops && ray_meets(king, block | pawn, from))) {
                held = false;                      /* it has a square to step to, or the capture uncovers a check */
                break;
            }
        }
        if (held) guard |= pawn;
    }
    return guard;
}

/* One level: the fixed point of the walls, the pawns that can never move, the kings' reaches, the
   squares where each side may take a pawn, the pawns' cones and the bishops' reaches. False when
   the structure leaks whichever side is asked about; otherwise true, and in s the sets the mating
   net reads. o->family: o->wp, bp are the pawns (a family has a pair's pawn moved into its gap) and
   o->start where the kings' reaches, capture squares and bishops' reaches start; o->v: walls for
   both sides (the gaps of a family's pairs that stay); o->wx, bx, ws, bs: the boxed pieces'
   candidates and their step squares; o->guard: the stalemate guard and the check seed (plain
   levels only). */
static bool level(const Pieces *p, Set frozen, const Level *o, Sets *s) {
    Set wp = o->family ? o->wp : p->white_pawns, bp = o->family ? o->bp : p->black_pawns;
    Set wk = p->white_king, bk = p->black_king, wx = o->wx, bx = o->bx, v = o->v | frozen;
    bool frozen_white = (frozen & wk) != 0;
    bool frozen_black = !frozen_white && frozen != 0;
    Set near_frozen_black = frozen_black ? zone(bk) : 0, near_frozen_white = frozen_white ? zone(wk) : 0;
    Set w_seed = wk, b_seed = bk;
    if (o->guard && frozen == 0) check_seed(p, &w_seed, &b_seed);
    Set w_king = w_seed, b_king = b_seed, w_take = w_seed, b_take = b_seed, w_bish = p->white_bishops, b_bish = p->black_bishops;
    if (o->family) {
        w_king = o->start[0]; b_king = o->start[1]; w_take = o->start[2]; b_take = o->start[3];
        w_bish = o->start[4]; b_bish = o->start[5];
    }
    Set w_cone = wp, b_cone = bp, w_fixed = wp, b_fixed = bp;
    Set w_guard = o->guard ? ~0ULL : 0, b_guard = o->guard ? ~0ULL : 0;   /* nothing is taken yet */
    for (;;) {
        /* Boxed: the pieces no enemy king or bishop reaches. Walls: pawns the other side can never
           take (or whose capture stalemates their owner), the frozen king, the gaps, boxed pieces. */
        Set boxed = (wx & ~(b_king | b_bish)) | (bx & ~(w_king | w_bish));
        Set w_wall = (wp & ~(b_take & ~w_guard)) | v | boxed;
        Set b_wall = (bp & ~(w_take & ~b_guard)) | v | boxed;
        Set nw_fixed = w_fixed & w_wall & south(b_wall | w_fixed);
        Set nb_fixed = b_fixed & b_wall & north(w_wall | b_fixed);
        Set nw_cone = fill_north(w_cone, ~b_wall), nb_cone = fill_south(b_cone, ~w_wall);
        /* The kings: never onto a fixed pawn, a square it attacks, or next to the frozen king; with
           boxed pieces on the board, never onto its own boxed pieces and still bishops either. */
        Set b_hit = sideways(south(nb_fixed)), w_hit = sideways(north(nw_fixed));
        Set w_still = 0, b_still = 0;
        if (wx | bx) {
            w_still = still_bishops(p->white_bishops, nw_fixed | (wx & boxed), b_king | b_bish);
            b_still = still_bishops(p->black_bishops, nb_fixed | (bx & boxed), w_king | w_bish);
        }
        Set nw_king = flood(w_king, ~(nw_fixed | b_hit | near_frozen_black | (wx & boxed) | w_still));
        Set nb_king = flood(b_king, ~(nb_fixed | w_hit | near_frozen_white | (bx & boxed) | b_still));
        Set nw_bish = w_bish, nb_bish = b_bish, open = ~(nw_fixed | nb_fixed);
        for (;;) {
            Set a = nw_bish | (diagonal(nw_bish) & open), d = nb_bish | (diagonal(nb_bish) & open);
            if (a == nw_bish && d == nb_bish) break;
            nw_bish = a;
            nb_bish = d;
        }
        /* A side may take a pawn where its king goes, and on any square a pawn may walk into. */
        Set t = b_take | nb_king;
        Set nb_take = t | south(fill_south(t & ~b_wall, ~b_wall));
        t = w_take | nw_king;
        Set nw_take = t | north(fill_north(t & ~w_wall, ~w_wall));
        Set nw_guard = w_guard, nb_guard = b_guard;
        if (o->guard) {
            Set block = nw_fixed | nb_fixed;
            bool w_has_b = p->white_bishops != 0, b_has_b = p->black_bishops != 0;
            nw_guard = w_has_b ? 0 : stalemate_guard(wp & nb_take & nw_fixed, wp, nw_fixed, nw_king, nw_fixed | b_hit, nb_king, b_has_b, block);
            nb_guard = b_has_b ? 0 : stalemate_guard(bp & nw_take & nb_fixed, bp, nb_fixed, nb_king, nb_fixed | w_hit, nw_king, w_has_b, block);
        }
        bool changed = nw_cone != w_cone || nb_cone != b_cone || nw_fixed != w_fixed || nb_fixed != b_fixed ||
                       nw_king != w_king || nb_king != b_king || nw_bish != w_bish || nb_bish != b_bish ||
                       nw_take != w_take || nb_take != b_take || nw_guard != w_guard || nb_guard != b_guard;
        w_cone = nw_cone; b_cone = nb_cone; w_fixed = nw_fixed; b_fixed = nb_fixed; w_king = nw_king; b_king = nb_king;
        w_bish = nw_bish; b_bish = nb_bish; w_take = nw_take; b_take = nb_take; w_guard = nw_guard; b_guard = nb_guard;
        if (!changed) break;
    }
    Set boxed = (wx & ~(b_king | b_bish)) | (bx & ~(w_king | w_bish));
    if ((w_cone & RANK_8) | (b_cone & RANK_1)) return false;                             /* a pawn can promote */
    if ((north(sideways(w_cone)) & (b_cone | bx)) | (south(sideways(b_cone)) & wx)) return false;  /* a pawn can capture */
    if ((frozen_white && w_king != wk) || (frozen_black && b_king != bk)) return false;  /* the frozen king can move */
    if ((diagonal(w_bish) & b_cone) | (diagonal(b_bish) & w_cone)) return false;          /* a bishop meets a pawn's path */
    /* A piece may step: a step square not held by a fixed pawn, a boxed piece or a still bishop of
       its colour, or by its frozen king (where the king may be a wall). */
    Set w_still = 0, b_still = 0;
    if (wx | bx) {
        w_still = still_bishops(p->white_bishops, w_fixed | (wx & boxed), b_king | b_bish);
        b_still = still_bishops(p->black_bishops, b_fixed | (bx & boxed), w_king | w_bish);
    }
    Set w_kw = frozen_white && king_wall(p, true) ? wk : 0, b_kw = frozen_black && king_wall(p, false) ? bk : 0;
    if ((o->ws & ~(w_fixed | (wx & boxed) | w_still | w_kw)) | (o->bs & ~(b_fixed | (bx & boxed) | b_still | b_kw))) return false;
    if (w_guard | b_guard) {
        /* A king that takes a guarded pawn ends the game: for the mating net, the kings' reaches
           again, now stopping at the enemy's guarded pawns. */
        w_king = flood(w_seed, ~(w_fixed | sideways(south(b_fixed)) | near_frozen_black | (bp & b_guard)));
        b_king = flood(b_seed, ~(b_fixed | sideways(north(w_fixed)) | near_frozen_white | (wp & w_guard)));
    }
    Sets r = { w_cone, b_cone, w_fixed, b_fixed, w_king, b_king, w_bish, b_bish, w_take, b_take };
    *s = r;
    return true;
}

/* The mating net: can the other side's pawns and bishops catch the king asked about? occ: squares
   that stand occupied for good besides (the boxed pieces'). */
static bool net_leaks(const Pieces *p, const Sets *s, bool white, Set occ) {
    Set attack, reach, free, spare, twins;
    if (white) {
        attack = diagonal(s->b_bish) | sideways(south(s->b_cone));
        reach = s->w_king;
        free = ~(s->w_cone | occ | zone(s->b_king) | attack);   /* never occupied, attacked or next to the mater */
        spare = free & ~s->w_bish;                              /* ... nor reached by the king's own bishops */
        twins = p->white_bishops;
    } else {
        attack = diagonal(s->w_bish) | sideways(north(s->w_cone));
        reach = s->b_king;
        free = ~(s->b_cone | occ | zone(s->w_king) | attack);
        spare = free & ~s->b_bish;
        twins = p->black_bishops;
    }
    /* A king next to a spare square, or with free squares beside it both ways, always has a flight.
       The second rule counts on at most one of the king's own bishops on the colour of those two
       squares (the colour opposite the king's): not on the king squares where it has two or more. */
    Set no_pair = (count(twins & DARK) > 1 ? ~DARK : 0) | (count(twins & ~DARK) > 1 ? DARK : 0);
    Set flight = sideways(spare) | north(spare) | south(spare) |
                 ((north(free) | south(free)) & sideways(free) & ~no_pair);
    return (attack & reach & ~flight) != 0;
}

/* The families of the open pairs at one level. */
static int families(const Pieces *p, Set gaps, Set frozen, bool white) {
    Set pairs[MAX_PAIRS][3];   /* per pair: the gap, the white pawn below it, the black pawn above it */
    int k = 0;
    for (Set g = gaps; g; g &= g - 1) {
        if (k == MAX_PAIRS) return FAMILY_NONE;
        Set gap = lowest(g);
        pairs[k][0] = gap; pairs[k][1] = south(gap); pairs[k][2] = north(gap);
        k++;
    }
    int n = 1;
    for (int i = 0; i < k; i++) n *= 3;
    Sets sets[27];
    for (int f = 0; f < n; f++) {
        /* Family f: digit i (base 3) says what pair i's pawns have done: 0 neither, 1 the white one
           stepped into the gap, 2 the black one did. Its sets start from those of the family it is
           reached from (the same with pair i's pawns in place), minus the gap. */
        Level o = {0};
        o.family = true;
        o.wp = p->white_pawns; o.bp = p->black_pawns;
        if (f == 0) {
            o.start[0] = o.start[2] = p->white_king; o.start[1] = o.start[3] = p->black_king;
            o.start[4] = p->white_bishops; o.start[5] = p->black_bishops;
        }
        for (int i = 0, q = f, pow = 1; i < k; i++, q /= 3, pow *= 3) {
            int d = q % 3;
            Set gap = pairs[i][0];
            if (d == 0) { o.v |= gap; continue; }   /* the gap stays: a wall for both sides' pawns */
            if (d == 1) o.wp = (o.wp & ~pairs[i][1]) | gap; else o.bp = (o.bp & ~pairs[i][2]) | gap;
            const Sets *r = &sets[f - d * pow];
            o.start[0] |= r->w_king & ~gap;
            o.start[1] |= r->b_king & ~gap;
            o.start[2] |= r->w_take;
            o.start[3] |= r->b_take;
            o.start[4] |= r->w_bish & ~gap;
            o.start[5] |= r->b_bish & ~gap;
        }
        if (!level(p, frozen, &o, &sets[f])) return f == 0 ? FAMILY_REFUTED : FAMILY_NONE;
        /* The pairs that stay: both pawns must never move. */
        for (int i = 0, q = f; i < k; i++, q /= 3)
            if (q % 3 == 0 && ((pairs[i][1] & ~sets[f].w_fixed) | (pairs[i][2] & ~sets[f].b_fixed))) return FAMILY_NONE;
        if (net_leaks(p, &sets[f], white, 0)) return f == 0 ? FAMILY_REFUTED : FAMILY_NONE;
    }
    return FAMILY_LOCK;
}

/* The step squares of one side's knights, rooks (and queens: o) and queens. */
static Set box_steps(Set knights, Set o, Set queens) {
    return sideways(o) | north(o) | south(o) | diagonal(queens) | knight(knights);
}

/* With knights, rooks or queens on the board: every one of them must be boxed in by its own pawns
   and pieces (bishops and the king among them: the level checks that they never move); then the
   levels, with the boxed pieces as walls and no flight onto their squares. */
static bool boxed_lock(const Pieces *p, bool white, Set wx, Set bx) {
    Set ws = box_steps(p->white_knights, p->white_rooks | p->white_queens, p->white_queens);
    Set bs = box_steps(p->black_knights, p->black_rooks | p->black_queens, p->black_queens);
    Set w_own = p->white_pawns | wx | p->white_bishops | (king_wall(p, true) ? p->white_king : 0);
    Set b_own = p->black_pawns | bx | p->black_bishops | (king_wall(p, false) ? p->black_king : 0);
    if ((ws & ~w_own) || (bs & ~b_own) || p->en_passant) return false;
    Set lv[3];
    int n = levels(p, wx | p->white_bishops, bx | p->black_bishops, lv);
    for (int i = 0; i < n; i++) {
        Level o = {0};
        o.wx = wx; o.bx = bx; o.ws = ws; o.bs = bs;
        Sets s;
        if (level(p, lv[i], &o, &s) && !net_leaks(p, &s, white, wx | bx)) return true;
    }
    return false;
}

/* The stuck mater: the flagged side is to move and, whatever it plays, the mater has no legal move
   left (kings and pawns only): the game ends at the mater's turn. */
static bool stuck_mater(const Pieces *p, bool white) {
    if (p->white_to_move != white || p->en_passant) return false;
    if (p->white_bishops | p->black_bishops | p->white_knights | p->black_knights | p->white_rooks |
        p->black_rooks | p->white_queens | p->black_queens) return false;
    Set fp = white ? p->white_pawns : p->black_pawns, mp = white ? p->black_pawns : p->white_pawns;
    Set fk = white ? p->white_king : p->black_king, mk = white ? p->black_king : p->white_king;
    Set occ = fp | mp | fk | mk;
    Set (*fwd)(Set) = white ? north : south, (*back)(Set) = white ? south : north;   /* ahead and behind, for the flagged side */
    /* A mater's pawn with an empty square ahead is never stuck; then only a stalemate now is left to
       find, which a flagged pawn's push rules out. */
    if ((back(mp) & ~occ) && (fwd(fp) & ~occ)) return false;
    Set f_attack = sideways(fwd(fp)), m_attack = sideways(back(mp));
    if (f_attack & (mp | mk)) return false;                      /* 1. the flagged side has no capture */
    Set single = fwd(fp) & ~occ;
    Set dbl = fwd(single & (white ? RANK_3 : RANK_6)) & ~occ;
    Set pushes = single | dbl;
    Set near = steps(mk);
    Set king_to = steps(fk) & ~fp & ~m_attack & ~near;            /* the flagged king's steps now */
    bool in_check = (fk & m_attack) != 0;
    if (in_check && !king_to) return false;                      /* mated now */
    bool stays = pushes != 0 && !in_check;                       /* a pawn may move instead of the king */
    if (!king_to && !stays) return true;                         /* no move, no check: stalemate now */
    /* The squares next to every square the flagged king may stand on after its move. */
    Set cover = stays ? steps(fk) : ~0ULL;
    for (Set k = king_to; k; k &= k - 1) cover &= steps(lowest(k));
    /* 2. the mater's pawns are blocked by men that stay, and attack no flagged pawn */
    Set blockers = fp | mp | mk | (king_to ? 0 : fk);
    if ((back(mp) & ~blockers) | (m_attack & fp)) return false;
    /* 3. every square next to the mater's king: its own pawn, attacked by a flagged pawn that cannot
          move now, or next to the flagged king wherever it goes */
    Set still = fp & back(fwd(fp) & occ);
    if (near & ~(mp | sideways(fwd(still)) | cover)) return false;
    /* 4. no push lands where a mater's pawn attacks or next to its king, nor lets it take en passant */
    return ((pushes & (m_attack | near)) | (dbl & sideways(mp))) == 0;
}

/* The forced step: the side to move is in a pawn's check, with kings and pawns only, and its one
   legal move is a step of its king. True, and in after the position after it, or false. */
static bool forced_step(const Pieces *p, Pieces *after) {
    if (p->en_passant || (p->white_bishops | p->black_bishops | p->white_knights | p->black_knights |
                          p->white_rooks | p->black_rooks | p->white_queens | p->black_queens)) return false;
    bool white = p->white_to_move;
    Set k = white ? p->white_king : p->black_king, ek = white ? p->black_king : p->white_king;
    Set own = white ? p->white_pawns : p->black_pawns, enemy = white ? p->black_pawns : p->white_pawns;
    Set checkers = (white ? sideways(north(k)) : sideways(south(k))) & enemy;
    if (!checkers) return false;
    Set attacked = white ? sideways(south(enemy)) : sideways(north(enemy));
    Set to = steps(k) & ~own & ~attacked & ~steps(ek);
    if (count(to) != 1) return false;
    if ((white ? sideways(south(checkers)) : sideways(north(checkers))) & own) return false;  /* a pawn may take instead */
    *after = *p;
    after->white_to_move = !white;
    after->en_passant = false;
    if (white) { after->white_king = to; after->black_pawns &= ~to; }
    else { after->black_king = to; after->white_pawns &= ~to; }
    return true;
}
