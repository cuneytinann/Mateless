//! Mateless's lock detector, in its simplest form.
//!
//! Can a side never be mated? The lock detector answers yes when pawns, kings and bishops form a
//! structure that no series of legal moves can open (FIDE 5.2.2 dead position, 6.9 flag fall). It
//! reads bitboards only: it generates no move and searches nothing.
//!
//! Each king's reach (every square it may ever stand on) is grown from its square, never onto a
//! square that a pawn which can never move attacks. The pawns that can never move are those
//! blocked by a wall: a pawn the other side can never take. The squares where a side may take a
//! pawn grow from its king's reach, and so on, until nothing changes. The structure leaks if a
//! pawn can promote or capture, a frozen king can move, a bishop can reach a pawn's path, or the
//! king of the side asked about can reach a square the other side attacks where it has no sure
//! flight. It is tried with both kings free, then with each king frozen on its square (a wall for
//! both sides) when every square around that king is held or attacked by a pawn.
//!
//! A knight, rook or queen on the board, two bishops of one side on squares of one colour, or a
//! possible en passant capture fails it at once. Sound, not complete: a structure it passes can
//! never be opened; one it fails may still be dead.
//!
//! Squares: a1 = 0, b1 = 1, ..., h8 = 63. A set of squares (a bitboard) is a `u64`.

const Set = u64;

const file_a: Set = 0x0101010101010101;
const file_h: Set = 0x8080808080808080;
const rank_1: Set = 0x00000000000000FF;
const rank_8: Set = 0xFF00000000000000;
const dark: Set = 0xAA55AA55AA55AA55; // the dark squares; a1 is dark

fn north(s: Set) Set {
    return s << 8;
}
fn south(s: Set) Set {
    return s >> 8;
}
fn sideways(s: Set) Set {
    return ((s << 1) & ~file_a) | ((s >> 1) & ~file_h);
}
/// s and every square next to it
fn zone(s: Set) Set {
    const v = s | north(s) | south(s);
    return v | sideways(v);
}
/// the squares diagonally next to s
fn diagonal(s: Set) Set {
    return sideways(north(s) | south(s));
}
fn count(s: Set) u32 {
    return @popCount(s);
}

/// Every square reachable from g by steps north through squares of p.
fn fillNorth(g0: Set, p0: Set) Set {
    var g = g0;
    var p = p0;
    g |= p & (g << 8);
    p &= p << 8;
    g |= p & (g << 16);
    p &= p << 16;
    return g | (p & (g << 32));
}

/// Every square reachable from g by steps south through squares of p.
fn fillSouth(g0: Set, p0: Set) Set {
    var g = g0;
    var p = p0;
    g |= p & (g >> 8);
    p &= p >> 8;
    g |= p & (g >> 16);
    p &= p >> 16;
    return g | (p & (g >> 32));
}

/// What the lock detector reads from a position.
pub const Pieces = struct {
    white_pawns: u64 = 0,
    black_pawns: u64 = 0,
    white_king: u64 = 0,
    black_king: u64 = 0,
    white_bishops: u64 = 0,
    black_bishops: u64 = 0,
    others: u64 = 0, // knights, rooks and queens of both sides
    en_passant: bool = false, // the side to move can capture en passant
};

/// The pieces of a FEN. The en passant square counts only if a pawn can capture onto it.
pub fn fromFen(fen: []const u8) Pieces {
    var p: Pieces = .{};
    var rank: u6 = 7;
    var file: u6 = 0;
    var c: usize = 0;
    while (c < fen.len and fen[c] != ' ') : (c += 1) {
        if (fen[c] == '/') {
            rank -= 1;
            file = 0;
            continue;
        }
        if (fen[c] >= '1' and fen[c] <= '8') {
            file += @intCast(fen[c] - '0');
            continue;
        }
        const sq = @as(Set, 1) << (8 * rank + file);
        file += 1;
        switch (fen[c]) {
            'P' => p.white_pawns |= sq,
            'p' => p.black_pawns |= sq,
            'K' => p.white_king |= sq,
            'k' => p.black_king |= sq,
            'B' => p.white_bishops |= sq,
            'b' => p.black_bishops |= sq,
            else => p.others |= sq, // N R Q n r q
        }
    }
    while (c < fen.len and fen[c] == ' ') c += 1;
    const white_to_move = c == fen.len or fen[c] != 'b';
    var field: u32 = 0;
    while (field < 2 and c < fen.len) : (field += 1) { // past the side to move and castling
        while (c < fen.len and fen[c] != ' ') c += 1;
        while (c < fen.len and fen[c] == ' ') c += 1;
    }
    if (c + 1 < fen.len and fen[c] >= 'a' and fen[c] <= 'h' and fen[c + 1] >= '1' and fen[c + 1] <= '8') {
        const target = @as(Set, 1) << @intCast((fen[c] - 'a') + 8 * (fen[c + 1] - '1'));
        p.en_passant = if (white_to_move)
            (sideways(south(target)) & p.white_pawns) != 0
        else
            (sideways(north(target)) & p.black_pawns) != 0;
    }
    return p;
}

/// Two bishops on squares of one colour (only a promotion makes them).
fn twinBishops(b: Set) bool {
    return count(b & dark) > 1 or count(b & ~dark) > 1;
}

/// Can White (white = true) or Black never be mated, by the lock detector?
pub fn cannotBeMated(p: Pieces, white: bool) bool {
    if (p.others != 0 or p.en_passant) return false;
    if (twinBishops(p.white_bishops) or twinBishops(p.black_bishops)) return false;
    if (!leaks(p, white, 0)) return true;
    // A king may be frozen only if every square around it is held or attacked by a pawn.
    const held = p.white_pawns | p.black_pawns | sideways(north(p.white_pawns) | south(p.black_pawns));
    const kings = [2]Set{ p.white_king, p.black_king };
    for (kings) |king| {
        if ((zone(king) & ~king & ~held) == 0 and !leaks(p, white, king)) return true;
    }
    return false;
}

/// Does the structure leak to the king asked about, with the king `frozen` frozen (0: none)?
fn leaks(p: Pieces, white: bool, frozen: Set) bool {
    const wp, const bp, const wk, const bk = .{ p.white_pawns, p.black_pawns, p.white_king, p.black_king };
    const frozen_white = (frozen & wk) != 0;
    const frozen_black = !frozen_white and frozen != 0;
    const near_frozen_black: Set = if (frozen_black) zone(bk) else 0;
    const near_frozen_white: Set = if (frozen_white) zone(wk) else 0;

    // Quick: the pawns' paths against the first walls already show a promotion or a capture.
    var w_cone = fillNorth(wp, ~((bp & ~wk) | frozen));
    var b_cone = fillSouth(bp, ~((wp & ~bk) | frozen));
    if (((w_cone & rank_8) | (b_cone & rank_1) | (north(sideways(w_cone)) & b_cone)) != 0) return true;

    // The cycle: walls -> pawns that can never move -> king reaches -> capture squares -> walls.
    var w_fixed, var b_fixed = .{ wp, bp }; // pawns that can never move      (shrink)
    var w_king, var b_king = .{ wk, bk }; // squares each king may reach    (grow)
    var w_take, var b_take = .{ wk, bk }; // squares where a side may take an enemy pawn (grow)
    var w_wall, var b_wall = .{ ~@as(Set, 0), ~@as(Set, 0) }; // pawns the other side can never take, and the frozen king
    while (true) {
        const last_w_wall, const last_b_wall = .{ w_wall, b_wall };
        w_wall = (wp & ~b_take) | frozen;
        b_wall = (bp & ~w_take) | frozen;
        const new_w_fixed = w_fixed & w_wall & south(b_wall | w_fixed);
        const new_b_fixed = b_fixed & b_wall & north(w_wall | b_fixed);
        if (w_wall == last_w_wall and b_wall == last_b_wall and new_w_fixed == w_fixed and new_b_fixed == b_fixed)
            break;
        // Both kings' reaches, flooded: never onto a fixed pawn, a square it attacks, or next to
        // the frozen king.
        const w_mask = ~(new_w_fixed | sideways(south(new_b_fixed)) | near_frozen_black);
        const b_mask = ~(new_b_fixed | sideways(north(new_w_fixed)) | near_frozen_white);
        var new_w_king, var new_b_king = .{ w_king, b_king };
        while (true) {
            const a = new_w_king | (zone(new_w_king) & w_mask);
            const d = new_b_king | (zone(new_b_king) & b_mask);
            if (a == new_w_king and d == new_b_king) break;
            new_w_king = a;
            new_b_king = d;
        }
        if ((frozen_white and new_w_king != wk) or (frozen_black and new_b_king != bk))
            return true; // the frozen king can move
        // A side may take a pawn where its king goes, and on any square a pawn may walk into.
        var t = b_take | new_b_king;
        const new_b_take = t | south(fillSouth(t & ~b_wall, ~b_wall));
        t = w_take | new_w_king;
        const new_w_take = t | north(fillNorth(t & ~w_wall, ~w_wall));
        const changed = new_w_fixed != w_fixed or new_b_fixed != b_fixed or new_w_king != w_king or
            new_b_king != b_king or new_w_take != w_take or new_b_take != b_take;
        w_fixed, b_fixed, w_king, b_king = .{ new_w_fixed, new_b_fixed, new_w_king, new_b_king };
        w_take, b_take = .{ new_w_take, new_b_take };
        if (!changed) break;
    }

    // The pawns' cones: every square they may still reach.
    w_cone = fillNorth(wp, ~b_wall);
    b_cone = fillSouth(bp, ~w_wall);
    if (((w_cone & rank_8) | (b_cone & rank_1)) != 0) return true; // a pawn can promote
    if ((north(sideways(w_cone)) & b_cone) != 0) return true; // a pawn can capture
    // The bishops' reaches: every square they may reach, around the fixed pawns.
    var w_bish, var b_bish, const open = .{ p.white_bishops, p.black_bishops, ~(w_fixed | b_fixed) };
    while (true) {
        const a = w_bish | (diagonal(w_bish) & open);
        const d = b_bish | (diagonal(b_bish) & open);
        if (a == w_bish and d == b_bish) break;
        w_bish = a;
        b_bish = d;
    }
    if (((diagonal(w_bish) & b_cone) | (diagonal(b_bish) & w_cone)) != 0) return true; // a bishop meets a pawn's path

    // The mating net: can the other side's pawns and bishops catch the king asked about?
    var attack: Set = undefined;
    var reach: Set = undefined;
    var free: Set = undefined;
    var spare: Set = undefined;
    if (white) {
        attack = diagonal(b_bish) | sideways(south(b_cone));
        reach = w_king;
        free = ~(w_cone | zone(b_king) | attack); // never occupied, attacked or next to the mater
        spare = free & ~w_bish; // ... nor reached by the king's own bishops
    } else {
        attack = diagonal(w_bish) | sideways(north(w_cone));
        reach = b_king;
        free = ~(b_cone | zone(w_king) | attack);
        spare = free & ~b_bish;
    }
    // A king next to a spare square, or with free squares beside it both ways, always has a flight.
    const flight = sideways(spare) | north(spare) | south(spare) | ((north(free) | south(free)) & sideways(free));
    return (attack & reach & ~flight) != 0;
}
