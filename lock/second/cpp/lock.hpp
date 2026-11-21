// Mateless's lock detector, second version, in its simplest form.
//
// Can a side never be mated? The lock detector answers yes when pawns, kings and bishops (and
// knights, rooks or queens boxed in by their own men) form a structure that no series of legal
// moves can open (FIDE 5.2.2 dead position, 6.9 flag fall). It reads bitboards and the side to
// move: it generates no move and searches nothing.
//
// The first version (../../cpp/lock.hpp) grows each king's reach, the pawns that can never move,
// and the squares where each side may take a pawn, until nothing changes; the structure leaks if a
// pawn can promote or capture, a frozen king can move, a bishop can reach a pawn's path, or the
// king asked about can reach a square the other side attacks without a sure flight. This version
// keeps all of it and adds, each only where its situation is on the board:
//   - open pawn pairs: a white and a black pawn on one file with one empty square between them;
//     the reachable positions split into families by what the pair's pawns have done (neither
//     moved, the white one stepped into the gap, the black one did), up to 3 pairs;
//   - boxed knights, rooks and queens: a piece whose every step square holds one of its own men
//     that never moves, and that no enemy king or bishop reaches, never moves nor falls;
//   - twin bishops: two bishops of one side on one colour no longer fail it; the mating net leaves
//     out its second flight rule where they may hold both flights;
//   - the stalemate guard: a pawn the enemy king may take stays a wall if taking it always
//     stalemates its owner;
//   - the check seed: a king in a pawn's check starts its reach from the squares it can step to;
//   - the stuck mater: whatever the flagged side plays, the mater is left without a move;
//   - the forced step: a king in a pawn's check with one legal move, a step: the lock of the
//     position after it.
// A possible en passant capture fails it at once. Sound, not complete: a structure it passes can
// never be opened; one it fails may still be dead.
//
// Squares: a1 = 0, b1 = 1, ..., h8 = 63. A set of squares (a bitboard) is a std::uint64_t.
#ifndef MATELESS_LOCK_SECOND_HPP
#define MATELESS_LOCK_SECOND_HPP

#include <array>
#include <cstdint>
#include <optional>
#include <string_view>
#include <utility>
#include <vector>

namespace mateless::lock_second {

// What the lock detector reads from a position.
struct Pieces {
    std::uint64_t white_pawns = 0, black_pawns = 0;
    std::uint64_t white_king = 0, black_king = 0;
    std::uint64_t white_bishops = 0, black_bishops = 0;
    std::uint64_t white_knights = 0, black_knights = 0;
    std::uint64_t white_rooks = 0, black_rooks = 0;
    std::uint64_t white_queens = 0, black_queens = 0;
    bool white_to_move = true;
    bool en_passant = false;   // the side to move can capture en passant
};

namespace detail {

using Set = std::uint64_t;

constexpr Set FILE_A = 0x0101010101010101ULL;
constexpr Set FILE_H = 0x8080808080808080ULL;
constexpr Set RANK_1 = 0x00000000000000FFULL;
constexpr Set RANK_3 = 0x0000000000FF0000ULL;
constexpr Set RANK_6 = 0x0000FF0000000000ULL;
constexpr Set RANK_8 = 0xFF00000000000000ULL;
constexpr Set DARK = 0xAA55AA55AA55AA55ULL;  // the dark squares; a1 is dark
constexpr int MAX_PAIRS = 3;                 // the most open pairs the families are split on (3^3 = 27)

inline Set north(Set s) { return s << 8; }
inline Set south(Set s) { return s >> 8; }
inline Set sideways(Set s) { return ((s << 1) & ~FILE_A) | ((s >> 1) & ~FILE_H); }
inline Set zone(Set s) { Set v = s | north(s) | south(s); return v | sideways(v); }  // s and every square next to it
inline Set steps(Set s) { return zone(s) & ~s; }                                     // the squares next to s
inline Set diagonal(Set s) { return sideways(north(s) | south(s)); }               // the squares diagonally next to s
inline int count(Set s) { int n = 0; for (; s; s &= s - 1) n++; return n; }
inline Set lowest(Set s) { return s & (~s + 1); }                                  // the lowest square of s

// The squares a knight on s goes to.
inline Set knight(Set s) {
    Set one = sideways(s);
    Set two = ((s << 2) & ~(FILE_A | (FILE_A << 1))) | ((s >> 2) & ~(FILE_H | (FILE_H >> 1)));
    return north(north(one)) | south(south(one)) | north(two) | south(two);
}

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

// Every square a king may reach from k through squares of m.
inline Set flood(Set k, Set m) {
    for (;;) { Set a = k | (zone(k) & m); if (a == k) return k; k = a; }
}

// What one level leaves for the mating net (and for the families after it).
struct Sets { Set w_cone, b_cone, w_fixed, b_fixed, w_king, b_king, w_bish, b_bish, w_take, b_take; };

// The inputs of a level beyond the position: see level().
struct Level {
    std::optional<std::pair<Set, Set>> pawns;
    Set v = 0;
    std::optional<std::array<Set, 6>> start;
    Set wx = 0, bx = 0, ws = 0, bs = 0;
    bool guard = false;
};

enum class Family { lock, refuted, none };   // what the families of the open pairs say at one level

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
        case 'N': p.white_knights |= sq; break;
        case 'n': p.black_knights |= sq; break;
        case 'R': p.white_rooks |= sq; break;
        case 'r': p.black_rooks |= sq; break;
        case 'Q': p.white_queens |= sq; break;
        default: p.black_queens |= sq; break;   // q
        }
    }
    while (c < end && fen[c] == ' ') c++;
    p.white_to_move = c == end || fen[c] != 'b';
    for (int field = 0; field < 2 && c < end; field++) {   // past the side to move and castling
        while (c < end && fen[c] != ' ') c++;
        while (c < end && fen[c] == ' ') c++;
    }
    if (c + 1 < end && fen[c] >= 'a' && fen[c] <= 'h' && fen[c + 1] >= '1' && fen[c + 1] <= '8') {
        Set target = Set{1} << ((fen[c] - 'a') + 8 * (fen[c + 1] - '1'));
        p.en_passant = p.white_to_move ? (sideways(south(target)) & p.white_pawns) != 0
                                       : (sideways(north(target)) & p.black_pawns) != 0;
    }
    return p;
}

namespace detail {

// The levels: both kings free (0), then each king frozen on its square (a wall for both sides)
// when every square around it is held or attacked by a pawn.
inline std::vector<Set> levels(const Pieces& p) {
    Set held = p.white_pawns | p.black_pawns | sideways(north(p.white_pawns) | south(p.black_pawns));
    std::vector<Set> out{0};
    for (Set king : {p.white_king, p.black_king})
        if ((steps(king) & ~held) == 0) out.push_back(king);
    return out;
}

// The check seed: the side to move is in a pawn's check, so its king must step now, to a square it
// can step to (not its own pawn, not a square an enemy pawn attacks, not next to the enemy king);
// its reach starts there. Not when it has no such square (that may be a mate now), when one of its
// pawns can take a checking pawn, or with a bishop on the board. The kings' starting sets.
inline std::pair<Set, Set> check_seed(const Pieces& p) {
    Set wp = p.white_pawns, bp = p.black_pawns, wk = p.white_king, bk = p.black_king;
    bool white = p.white_to_move;
    if (p.white_bishops | p.black_bishops) return {wk, bk};
    Set k = white ? wk : bk, own = white ? wp : bp;
    Set checkers = white ? sideways(north(k)) & bp : sideways(south(k)) & wp;
    if (!checkers) return {wk, bk};
    Set attacked = white ? sideways(south(bp)) : sideways(north(wp));
    Set to = steps(k) & ~own & ~attacked & ~steps(white ? bk : wk);
    Set takers = (white ? sideways(south(checkers)) : sideways(north(checkers))) & own;
    if (!to || takers) return {wk, bk};
    return white ? std::pair<Set, Set>{to, bk} : std::pair<Set, Set>{wk, to};
}

// Does a diagonal line from the square king, stopped by block, meet a square of o?
inline bool ray_meets(Set king, Set block, Set o) {
    int sq = 0;
    while (!((king >> sq) & 1)) sq++;
    const int d[4][2] = {{-1, -1}, {1, -1}, {-1, 1}, {1, 1}};
    for (const auto& dir : d) {
        for (int f = (sq & 7) + dir[0], r = (sq >> 3) + dir[1]; f >= 0 && f < 8 && r >= 0 && r < 8; f += dir[0], r += dir[1]) {
            Set s = Set{1} << (8 * r + f);
            if (o & s) return true;
            if (block & s) break;
        }
    }
    return false;
}

// The stalemate guard: of the owner's fixed pawns cand (which the enemy king may take), those whose
// capture always stalemates the owner. The owner must have nothing else that moves (every other
// pawn fixed; no bishop, which the caller sees to). reach: where the owner's king may stand; shut:
// squares it can never step to (own fixed pawns, squares the enemy's fixed pawns attack);
// enemy_king: the enemy king's reach; block: squares a bishop's line never crosses.
inline Set stalemate_guard(Set cand, Set own, Set own_fixed, Set reach, Set shut, Set enemy_king,
                           bool enemy_bishops, Set block) {
    if (own & ~own_fixed) return 0;
    Set guard = 0;
    for (Set c = cand; c; c &= c - 1) {
        Set pawn = lowest(c), near = steps(pawn);
        Set from = near & enemy_king;              // where the enemy king takes from
        Set x = shut | near | pawn;                // after the capture, the owner's king may not step there
        bool held = true;
        for (Set k = reach & ~(near | pawn); k; k &= k - 1) {   // the owner's king, not defending the pawn
            Set king = lowest(k);
            if ((steps(king) & ~x) || (enemy_bishops && ray_meets(king, block | pawn, from))) {
                held = false;                      // it has a square to step to, or the capture uncovers a check
                break;
            }
        }
        if (held) guard |= pawn;
    }
    return guard;
}

// One level: the fixed point of the walls, the pawns that can never move, the kings' reaches, the
// squares where each side may take a pawn, the pawns' cones and the bishops' reaches. The sets the
// mating net reads, or nothing when the structure leaks whichever side is asked about.
// o.pawns: the pawns (a family has a pair's pawn moved into its gap); o.v: walls for both sides
// (the gaps of a family's pairs that stay); o.start: where the kings' reaches, capture squares and
// bishops' reaches start (a family's); o.wx, bx, ws, bs: the boxed pieces' candidates and their
// step squares; o.guard: the stalemate guard and the check seed (plain levels only).
inline std::optional<Sets> level(const Pieces& p, Set frozen, const Level& o) {
    auto [wp, bp] = o.pawns.value_or(std::pair<Set, Set>{p.white_pawns, p.black_pawns});
    Set wk = p.white_king, bk = p.black_king, wx = o.wx, bx = o.bx, v = o.v | frozen;
    bool frozen_white = (frozen & wk) != 0;
    bool frozen_black = !frozen_white && frozen != 0;
    Set near_frozen_black = frozen_black ? zone(bk) : 0, near_frozen_white = frozen_white ? zone(wk) : 0;
    auto [w_seed, b_seed] = o.guard && frozen == 0 ? check_seed(p) : std::pair<Set, Set>{wk, bk};
    auto [w_king, b_king, w_take, b_take, w_bish, b_bish] =
        o.start.value_or(std::array<Set, 6>{w_seed, b_seed, w_seed, b_seed, p.white_bishops, p.black_bishops});
    Set w_cone = wp, b_cone = bp, w_fixed = wp, b_fixed = bp;
    Set w_guard = o.guard ? ~Set{0} : 0, b_guard = o.guard ? ~Set{0} : 0;   // nothing is taken yet
    for (;;) {
        // Boxed: the pieces no enemy king or bishop reaches. Walls: pawns the other side can never
        // take (or whose capture stalemates their owner), the frozen king, the gaps, boxed pieces.
        Set boxed = (wx & ~(b_king | b_bish)) | (bx & ~(w_king | w_bish));
        Set w_wall = (wp & ~(b_take & ~w_guard)) | v | boxed;
        Set b_wall = (bp & ~(w_take & ~b_guard)) | v | boxed;
        Set nw_fixed = w_fixed & w_wall & south(b_wall | w_fixed);
        Set nb_fixed = b_fixed & b_wall & north(w_wall | b_fixed);
        Set nw_cone = fill_north(w_cone, ~b_wall), nb_cone = fill_south(b_cone, ~w_wall);
        // The kings: never onto a fixed pawn, a square it attacks, or next to the frozen king.
        Set b_hit = sideways(south(nb_fixed)), w_hit = sideways(north(nw_fixed));
        Set nw_king = flood(w_king, ~(nw_fixed | b_hit | near_frozen_black));
        Set nb_king = flood(b_king, ~(nb_fixed | w_hit | near_frozen_white));
        Set nw_bish = w_bish, nb_bish = b_bish, open = ~(nw_fixed | nb_fixed);
        for (;;) {
            Set a = nw_bish | (diagonal(nw_bish) & open), d = nb_bish | (diagonal(nb_bish) & open);
            if (a == nw_bish && d == nb_bish) break;
            nw_bish = a;
            nb_bish = d;
        }
        // A side may take a pawn where its king goes, and on any square a pawn may walk into.
        Set t = b_take | nb_king;
        Set nb_take = t | south(fill_south(t & ~b_wall, ~b_wall));
        t = w_take | nw_king;
        Set nw_take = t | north(fill_north(t & ~w_wall, ~w_wall));
        Set nw_guard = w_guard, nb_guard = b_guard;
        if (o.guard) {
            Set block = nw_fixed | nb_fixed;
            bool w_has_b = p.white_bishops != 0, b_has_b = p.black_bishops != 0;
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
    if ((w_cone & RANK_8) | (b_cone & RANK_1)) return std::nullopt;                             // a pawn can promote
    if ((north(sideways(w_cone)) & (b_cone | bx)) | (south(sideways(b_cone)) & wx)) return std::nullopt;  // a pawn can capture
    if ((frozen_white && w_king != wk) || (frozen_black && b_king != bk)) return std::nullopt;  // the frozen king can move
    if ((diagonal(w_bish) & b_cone) | (diagonal(b_bish) & w_cone)) return std::nullopt;          // a bishop meets a pawn's path
    if ((o.ws & ~(w_fixed | (wx & boxed))) | (o.bs & ~(b_fixed | (bx & boxed)))) return std::nullopt;  // a piece may step
    if (w_guard | b_guard) {
        // A king that takes a guarded pawn ends the game: for the mating net, the kings' reaches
        // again, now stopping at the enemy's guarded pawns.
        w_king = flood(w_seed, ~(w_fixed | sideways(south(b_fixed)) | near_frozen_black | (bp & b_guard)));
        b_king = flood(b_seed, ~(b_fixed | sideways(north(w_fixed)) | near_frozen_white | (wp & w_guard)));
    }
    return Sets{w_cone, b_cone, w_fixed, b_fixed, w_king, b_king, w_bish, b_bish, w_take, b_take};
}

// The mating net: can the other side's pawns and bishops catch the king asked about? occ: squares
// that stand occupied for good besides (the boxed pieces').
inline bool net_leaks(const Pieces& p, const Sets& s, bool white, Set occ) {
    Set attack, reach, free, spare, twins;
    if (white) {
        attack = diagonal(s.b_bish) | sideways(south(s.b_cone));
        reach = s.w_king;
        free = ~(s.w_cone | occ | zone(s.b_king) | attack);   // never occupied, attacked or next to the mater
        spare = free & ~s.w_bish;                             // ... nor reached by the king's own bishops
        twins = p.white_bishops;
    } else {
        attack = diagonal(s.w_bish) | sideways(north(s.w_cone));
        reach = s.b_king;
        free = ~(s.b_cone | occ | zone(s.w_king) | attack);
        spare = free & ~s.b_bish;
        twins = p.black_bishops;
    }
    // A king next to a spare square, or with free squares beside it both ways, always has a flight.
    // The second rule counts on at most one of the king's own bishops on the colour of those two
    // squares (the colour opposite the king's): not on the king squares where it has two or more.
    Set no_pair = (count(twins & DARK) > 1 ? ~DARK : 0) | (count(twins & ~DARK) > 1 ? DARK : 0);
    Set flight = sideways(spare) | north(spare) | south(spare) |
                 ((north(free) | south(free)) & sideways(free) & ~no_pair);
    return (attack & reach & ~flight) != 0;
}

// The families of the open pairs at one level.
inline Family families(const Pieces& p, Set gaps, Set frozen, bool white) {
    std::vector<std::array<Set, 3>> pairs;   // per pair: the gap, the white pawn below it, the black pawn above it
    for (Set g = gaps; g; g &= g - 1) { Set gap = lowest(g); pairs.push_back({gap, south(gap), north(gap)}); }
    if (static_cast<int>(pairs.size()) > MAX_PAIRS) return Family::none;
    int k = static_cast<int>(pairs.size()), n = 1;
    for (int i = 0; i < k; i++) n *= 3;
    std::vector<Sets> sets;
    for (int f = 0; f < n; f++) {
        // Family f: digit i (base 3) says what pair i's pawns have done: 0 neither, 1 the white one
        // stepped into the gap, 2 the black one did. Its sets start from those of the family it is
        // reached from (the same with pair i's pawns in place), minus the gap.
        Set wp = p.white_pawns, bp = p.black_pawns, v = 0;
        std::array<Set, 6> start{};
        if (f == 0) start = {p.white_king, p.black_king, p.white_king, p.black_king, p.white_bishops, p.black_bishops};
        for (int i = 0, q = f, pow = 1; i < k; i++, q /= 3, pow *= 3) {
            int d = q % 3;
            auto [gap, w, b] = pairs[i];
            if (d == 0) { v |= gap; continue; }   // the gap stays: a wall for both sides' pawns
            if (d == 1) wp = (wp & ~w) | gap; else bp = (bp & ~b) | gap;
            const Sets& r = sets[f - d * pow];
            start[0] |= r.w_king & ~gap;
            start[1] |= r.b_king & ~gap;
            start[2] |= r.w_take;
            start[3] |= r.b_take;
            start[4] |= r.w_bish & ~gap;
            start[5] |= r.b_bish & ~gap;
        }
        Level o;
        o.pawns = std::pair<Set, Set>{wp, bp};
        o.v = v;
        o.start = start;
        auto s = level(p, frozen, o);
        if (!s) return f == 0 ? Family::refuted : Family::none;
        // The pairs that stay: both pawns must never move.
        for (int i = 0, q = f; i < k; i++, q /= 3)
            if (q % 3 == 0 && ((pairs[i][1] & ~s->w_fixed) | (pairs[i][2] & ~s->b_fixed))) return Family::none;
        if (net_leaks(p, *s, white, 0)) return f == 0 ? Family::refuted : Family::none;
        sets.push_back(*s);
    }
    return Family::lock;
}

// The step squares of one side's knights, rooks (and queens: o) and queens.
inline Set box_steps(Set knights, Set o, Set queens) {
    return sideways(o) | north(o) | south(o) | diagonal(queens) | knight(knights);
}

// With knights, rooks or queens on the board: every one of them must be boxed in by its own pawns
// and pieces; then the levels, with the boxed pieces as walls and no flight onto their squares.
inline bool boxed_lock(const Pieces& p, bool white, Set wx, Set bx) {
    Set ws = box_steps(p.white_knights, p.white_rooks | p.white_queens, p.white_queens);
    Set bs = box_steps(p.black_knights, p.black_rooks | p.black_queens, p.black_queens);
    if ((ws & ~(p.white_pawns | wx)) || (bs & ~(p.black_pawns | bx)) || p.en_passant) return false;
    Level o;
    o.wx = wx; o.bx = bx; o.ws = ws; o.bs = bs;
    for (Set frozen : levels(p)) {
        auto s = level(p, frozen, o);
        if (s && !net_leaks(p, *s, white, wx | bx)) return true;
    }
    return false;
}

// The stuck mater: the flagged side is to move and, whatever it plays, the mater has no legal move
// left (kings and pawns only): the game ends at the mater's turn.
inline bool stuck_mater(const Pieces& p, bool white) {
    if (p.white_to_move != white || p.en_passant) return false;
    if (p.white_bishops | p.black_bishops | p.white_knights | p.black_knights | p.white_rooks |
        p.black_rooks | p.white_queens | p.black_queens) return false;
    Set fp = white ? p.white_pawns : p.black_pawns, mp = white ? p.black_pawns : p.white_pawns;
    Set fk = white ? p.white_king : p.black_king, mk = white ? p.black_king : p.white_king;
    Set occ = fp | mp | fk | mk;
    auto fwd = [white](Set s) { return white ? north(s) : south(s); };   // ahead, for the flagged side
    auto back = [white](Set s) { return white ? south(s) : north(s); };  // behind
    // A mater's pawn with an empty square ahead is never stuck; then only a stalemate now is left to
    // find, which a flagged pawn's push rules out.
    if ((back(mp) & ~occ) && (fwd(fp) & ~occ)) return false;
    Set f_attack = sideways(fwd(fp)), m_attack = sideways(back(mp));
    if (f_attack & (mp | mk)) return false;                      // 1. the flagged side has no capture
    Set single = fwd(fp) & ~occ;
    Set dbl = fwd(single & (white ? RANK_3 : RANK_6)) & ~occ;
    Set pushes = single | dbl;
    Set near = steps(mk);
    Set king_to = steps(fk) & ~fp & ~m_attack & ~near;            // the flagged king's steps now
    bool in_check = (fk & m_attack) != 0;
    if (in_check && !king_to) return false;                      // mated now
    bool stays = pushes != 0 && !in_check;                       // a pawn may move instead of the king
    if (!king_to && !stays) return true;                         // no move, no check: stalemate now
    // The squares next to every square the flagged king may stand on after its move.
    Set cover = stays ? steps(fk) : ~Set{0};
    for (Set k = king_to; k; k &= k - 1) cover &= steps(lowest(k));
    // 2. the mater's pawns are blocked by men that stay, and attack no flagged pawn
    Set blockers = fp | mp | mk | (king_to ? 0 : fk);
    if ((back(mp) & ~blockers) | (m_attack & fp)) return false;
    // 3. every square next to the mater's king: its own pawn, attacked by a flagged pawn that cannot
    //    move now, or next to the flagged king wherever it goes
    Set still = fp & back(fwd(fp) & occ);
    if (near & ~(mp | sideways(fwd(still)) | cover)) return false;
    // 4. no push lands where a mater's pawn attacks or next to its king, nor lets it take en passant
    return ((pushes & (m_attack | near)) | (dbl & sideways(mp))) == 0;
}

// The forced step: the side to move is in a pawn's check, with kings and pawns only, and its one
// legal move is a step of its king. The position after it, or nothing.
inline std::optional<Pieces> forced_step(const Pieces& p) {
    if (p.en_passant || (p.white_bishops | p.black_bishops | p.white_knights | p.black_knights |
                         p.white_rooks | p.black_rooks | p.white_queens | p.black_queens)) return std::nullopt;
    bool white = p.white_to_move;
    Set k = white ? p.white_king : p.black_king, ek = white ? p.black_king : p.white_king;
    Set own = white ? p.white_pawns : p.black_pawns, enemy = white ? p.black_pawns : p.white_pawns;
    Set checkers = (white ? sideways(north(k)) : sideways(south(k))) & enemy;
    if (!checkers) return std::nullopt;
    Set attacked = white ? sideways(south(enemy)) : sideways(north(enemy));
    Set to = steps(k) & ~own & ~attacked & ~steps(ek);
    if (count(to) != 1) return std::nullopt;
    if ((white ? sideways(south(checkers)) : sideways(north(checkers))) & own) return std::nullopt;  // a pawn may take instead
    Pieces q = p;
    q.white_to_move = !white;
    q.en_passant = false;
    if (white) { q.white_king = to; q.black_pawns &= ~to; }
    else { q.black_king = to; q.white_pawns &= ~to; }
    return q;
}

}  // namespace detail

// Can White (white = true) or Black never be mated, by the lock detector?
inline bool cannot_be_mated(const Pieces& p, bool white) {
    using namespace detail;
    if (auto after = forced_step(p)) return cannot_be_mated(*after, white);
    Set wx = p.white_knights | p.white_rooks | p.white_queens, bx = p.black_knights | p.black_rooks | p.black_queens;
    if (wx | bx) return boxed_lock(p, white, wx, bx);
    if (p.en_passant) return false;
    Set gaps = north(p.white_pawns) & south(p.black_pawns) & ~(p.white_pawns | p.black_pawns);
    for (Set frozen : levels(p)) {
        if (gaps) {
            Family f = families(p, gaps, frozen, white);
            if (f == Family::lock) return true;
            if (f == Family::refuted) continue;   // family A, the level with more walls, leaked: the level leaks too
        }
        Level o;
        o.guard = true;
        auto s = level(p, frozen, o);
        if (s && !net_leaks(p, *s, white, 0)) return true;
    }
    return stuck_mater(p, white);
}

}  // namespace mateless::lock_second

#endif
