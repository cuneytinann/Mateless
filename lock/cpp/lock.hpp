// Mateless's lock detector, in its simplest form.
//
// Can a side never be mated? The lock detector answers yes when pawns, kings and bishops form a
// structure that no series of legal moves can open (FIDE 5.2.2 dead position, 6.9 flag fall). It
// reads bitboards only: it generates no move and searches nothing.
//
// Each king's reach (every square it may ever stand on) is grown from its square, never onto a
// square that a pawn which can never move attacks. The pawns that can never move are those
// blocked by a wall: a pawn the other side can never take. The squares where a side may take a
// pawn grow from its king's reach, and so on, until nothing changes. The structure leaks if a
// pawn can promote or capture, a frozen king can move, a bishop can reach a pawn's path, or the
// king of the side asked about can reach a square the other side attacks where it has no sure
// flight. It is tried with both kings free, then with each king frozen on its square (a wall for
// both sides) when every square around that king is held or attacked by a pawn.
//
// A knight, rook or queen on the board, two bishops of one side on squares of one colour, or a
// possible en passant capture fails it at once. Sound, not complete: a structure it passes can
// never be opened; one it fails may still be dead.
//
// Squares: a1 = 0, b1 = 1, ..., h8 = 63. A set of squares (a bitboard) is a std::uint64_t.
#ifndef MATELESS_LOCK_HPP
#define MATELESS_LOCK_HPP

#include <cstdint>
#include <string_view>

namespace mateless::lock {

// What the lock detector reads from a position.
struct Pieces {
    std::uint64_t white_pawns = 0, black_pawns = 0;
    std::uint64_t white_king = 0, black_king = 0;
    std::uint64_t white_bishops = 0, black_bishops = 0;
    std::uint64_t others = 0;  // knights, rooks and queens of both sides
    bool en_passant = false;   // the side to move can capture en passant
};

namespace detail {

using Set = std::uint64_t;

constexpr Set FILE_A = 0x0101010101010101ULL;
constexpr Set FILE_H = 0x8080808080808080ULL;
constexpr Set RANK_1 = 0x00000000000000FFULL;
constexpr Set RANK_8 = 0xFF00000000000000ULL;
constexpr Set DARK = 0xAA55AA55AA55AA55ULL;  // the dark squares; a1 is dark

inline Set north(Set s) { return s << 8; }
inline Set south(Set s) { return s >> 8; }
inline Set sideways(Set s) { return ((s << 1) & ~FILE_A) | ((s >> 1) & ~FILE_H); }
inline Set zone(Set s) { Set v = s | north(s) | south(s); return v | sideways(v); }  // s and every square next to it
inline Set diagonal(Set s) { return sideways(north(s) | south(s)); }               // the squares diagonally next to s
inline int count(Set s) { int n = 0; for (; s; s &= s - 1) n++; return n; }

// Every square reachable from g by steps north through squares of p.
inline Set fill_north(Set g, Set p) {
    g |= p & (g << 8);
    p &= p << 8;
    g |= p & (g << 16);
    p &= p << 16;
    return g | (p & (g << 32));
}

// Every square reachable from g by steps south through squares of p.
inline Set fill_south(Set g, Set p) {
    g |= p & (g >> 8);
    p &= p >> 8;
    g |= p & (g >> 16);
    p &= p >> 16;
    return g | (p & (g >> 32));
}

}  // namespace detail

// The pieces of a FEN. The en passant square counts only if a pawn can capture onto it.
inline Pieces from_fen(std::string_view fen) {
    using namespace detail;
    Pieces p;
    int rank = 7, file = 0;
    std::size_t c = 0, end = fen.size();
    for (; c < end && fen[c] != ' '; c++) {
        if (fen[c] == '/') { rank--; file = 0; continue; }
        if (fen[c] >= '1' && fen[c] <= '8') { file += fen[c] - '0'; continue; }
        Set sq = Set{1} << (8 * rank + file++);
        switch (fen[c]) {
        case 'P': p.white_pawns |= sq; break;
        case 'p': p.black_pawns |= sq; break;
        case 'K': p.white_king |= sq; break;
        case 'k': p.black_king |= sq; break;
        case 'B': p.white_bishops |= sq; break;
        case 'b': p.black_bishops |= sq; break;
        default: p.others |= sq; break;   // N R Q n r q
        }
    }
    while (c < end && fen[c] == ' ') c++;
    bool white_to_move = c == end || fen[c] != 'b';
    for (int field = 0; field < 2 && c < end; field++) {   // past the side to move and castling
        while (c < end && fen[c] != ' ') c++;
        while (c < end && fen[c] == ' ') c++;
    }
    if (c + 1 < end && fen[c] >= 'a' && fen[c] <= 'h' && fen[c + 1] >= '1' && fen[c + 1] <= '8') {
        Set target = Set{1} << ((fen[c] - 'a') + 8 * (fen[c + 1] - '1'));
        p.en_passant = white_to_move ? (sideways(south(target)) & p.white_pawns) != 0
                                     : (sideways(north(target)) & p.black_pawns) != 0;
    }
    return p;
}

namespace detail {

// Two bishops on squares of one colour (only a promotion makes them).
inline bool twin_bishops(Set b) { return count(b & DARK) > 1 || count(b & ~DARK) > 1; }

inline bool leaks(const Pieces& p, bool white, Set frozen);

}  // namespace detail

// Can White (white = true) or Black never be mated, by the lock detector?
inline bool cannot_be_mated(const Pieces& p, bool white) {
    using namespace detail;
    if (p.others || p.en_passant) return false;
    if (twin_bishops(p.white_bishops) || twin_bishops(p.black_bishops)) return false;
    if (!leaks(p, white, 0)) return true;
    // A king may be frozen only if every square around it is held or attacked by a pawn.
    Set held = p.white_pawns | p.black_pawns | sideways(north(p.white_pawns) | south(p.black_pawns));
    Set kings[2] = { p.white_king, p.black_king };
    for (Set king : kings)
        if ((zone(king) & ~king & ~held) == 0 && !leaks(p, white, king)) return true;
    return false;
}

namespace detail {

// Does the structure leak to the king asked about, with the king `frozen` frozen (0: none)?
inline bool leaks(const Pieces& p, bool white, Set frozen) {
    Set wp = p.white_pawns, bp = p.black_pawns, wk = p.white_king, bk = p.black_king;
    bool frozen_white = (frozen & wk) != 0;
    bool frozen_black = !frozen_white && frozen != 0;
    Set near_frozen_black = frozen_black ? zone(bk) : 0;
    Set near_frozen_white = frozen_white ? zone(wk) : 0;

    // Quick: the pawns' paths against the first walls already show a promotion or a capture.
    Set w_cone = fill_north(wp, ~((bp & ~wk) | frozen));
    Set b_cone = fill_south(bp, ~((wp & ~bk) | frozen));
    if ((w_cone & RANK_8) | (b_cone & RANK_1) | (north(sideways(w_cone)) & b_cone)) return true;

    // The cycle: walls -> pawns that can never move -> king reaches -> capture squares -> walls.
    Set w_fixed = wp, b_fixed = bp;     // pawns that can never move      (shrink)
    Set w_king = wk, b_king = bk;       // squares each king may reach    (grow)
    Set w_take = wk, b_take = bk;       // squares where a side may take an enemy pawn (grow)
    Set w_wall = ~Set{0}, b_wall = ~Set{0};  // pawns the other side can never take, and the frozen king
    for (;;) {
        Set last_w_wall = w_wall, last_b_wall = b_wall;
        w_wall = (wp & ~b_take) | frozen;
        b_wall = (bp & ~w_take) | frozen;
        Set new_w_fixed = w_fixed & w_wall & south(b_wall | w_fixed);
        Set new_b_fixed = b_fixed & b_wall & north(w_wall | b_fixed);
        if (w_wall == last_w_wall && b_wall == last_b_wall && new_w_fixed == w_fixed && new_b_fixed == b_fixed)
            break;
        // Both kings' reaches, flooded: never onto a fixed pawn, a square it attacks, or next to
        // the frozen king.
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
            return true;   // the frozen king can move
        // A side may take a pawn where its king goes, and on any square a pawn may walk into.
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

    // The pawns' cones: every square they may still reach.
    w_cone = fill_north(wp, ~b_wall);
    b_cone = fill_south(bp, ~w_wall);
    if ((w_cone & RANK_8) | (b_cone & RANK_1)) return true;   // a pawn can promote
    if (north(sideways(w_cone)) & b_cone) return true;        // a pawn can capture
    // The bishops' reaches: every square they may reach, around the fixed pawns.
    Set w_bish = p.white_bishops, b_bish = p.black_bishops, open = ~(w_fixed | b_fixed);
    for (;;) {
        Set a = w_bish | (diagonal(w_bish) & open);
        Set d = b_bish | (diagonal(b_bish) & open);
        if (a == w_bish && d == b_bish) break;
        w_bish = a;
        b_bish = d;
    }
    if ((diagonal(w_bish) & b_cone) | (diagonal(b_bish) & w_cone)) return true;   // a bishop meets a pawn's path

    // The mating net: can the other side's pawns and bishops catch the king asked about?
    Set attack, reach, free, spare;
    if (white) {
        attack = diagonal(b_bish) | sideways(south(b_cone));
        reach = w_king;
        free = ~(w_cone | zone(b_king) | attack);   // never occupied, attacked or next to the mater
        spare = free & ~w_bish;                     // ... nor reached by the king's own bishops
    } else {
        attack = diagonal(w_bish) | sideways(north(w_cone));
        reach = b_king;
        free = ~(b_cone | zone(w_king) | attack);
        spare = free & ~b_bish;
    }
    // A king next to a spare square, or with free squares beside it both ways, always has a flight.
    Set flight = sideways(spare) | north(spare) | south(spare) | ((north(free) | south(free)) & sideways(free));
    return (attack & reach & ~flight) != 0;
}

}  // namespace detail

}  // namespace mateless::lock

#endif
