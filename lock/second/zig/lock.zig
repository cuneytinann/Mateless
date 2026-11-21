//! Mateless's lock detector, second version, in its simplest form.
//!
//! Can a side never be mated? The lock detector answers yes when pawns, kings and bishops (and
//! knights, rooks or queens boxed in by their own men) form a structure that no series of legal
//! moves can open (FIDE 5.2.2 dead position, 6.9 flag fall). It reads bitboards and the side to
//! move: it generates no move and searches nothing.
//!
//! The first version (../../zig/lock.zig) grows each king's reach, the pawns that can never move,
//! and the squares where each side may take a pawn, until nothing changes; the structure leaks if a
//! pawn can promote or capture, a frozen king can move, a bishop can reach a pawn's path, or the
//! king asked about can reach a square the other side attacks without a sure flight. This version
//! keeps all of it and adds, each only where its situation is on the board:
//!   - open pawn pairs: a white and a black pawn on one file with one empty square between them;
//!     the reachable positions split into families by what the pair's pawns have done (neither
//!     moved, the white one stepped into the gap, the black one did), up to 3 pairs;
//!   - boxed knights, rooks and queens: a piece whose every step square holds one of its own men
//!     that never moves, and that no enemy king or bishop reaches, never moves nor falls;
//!   - twin bishops: two bishops of one side on one colour no longer fail it; the mating net leaves
//!     out its second flight rule where they may hold both flights;
//!   - the stalemate guard: a pawn the enemy king may take stays a wall if taking it always
//!     stalemates its owner;
//!   - the check seed: a king in a pawn's check starts its reach from the squares it can step to;
//!   - the stuck mater: whatever the flagged side plays, the mater is left without a move;
//!   - the forced step: a king in a pawn's check with one legal move, a step: the lock of the
//!     position after it.
//! A possible en passant capture fails it at once. Sound, not complete: a structure it passes can
//! never be opened; one it fails may still be dead.
//!
//! Squares: a1 = 0, b1 = 1, ..., h8 = 63. A set of squares (a bitboard) is a `u64`.

const Set = u64;

const file_a: Set = 0x0101010101010101;
const file_h: Set = 0x8080808080808080;
const rank_1: Set = 0x00000000000000FF;
const rank_3: Set = 0x0000000000FF0000;
const rank_6: Set = 0x0000FF0000000000;
const rank_8: Set = 0xFF00000000000000;
const dark: Set = 0xAA55AA55AA55AA55; // the dark squares; a1 is dark
const max_pairs = 3; // the most open pairs the families are split on (3^3 = 27)

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
/// the squares next to s
fn steps(s: Set) Set {
    return zone(s) & ~s;
}
/// the squares diagonally next to s
fn diagonal(s: Set) Set {
    return sideways(north(s) | south(s));
}
/// the squares a knight on s goes to
fn knight(s: Set) Set {
    const one = sideways(s);
    const two = ((s << 2) & ~(file_a | (file_a << 1))) | ((s >> 2) & ~(file_h | (file_h >> 1)));
    return north(north(one)) | south(south(one)) | north(two) | south(two);
}
fn count(s: Set) u32 {
    return @popCount(s);
}
/// the lowest square of s
fn lowest(s: Set) Set {
    return s & (0 -% s);
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

/// Every square a king may reach from k through squares of m.
fn flood(k0: Set, m: Set) Set {
    var k = k0;
    while (true) {
        const a = k | (zone(k) & m);
        if (a == k) return k;
        k = a;
    }
}

/// What the lock detector reads from a position.
pub const Pieces = struct {
    white_pawns: u64 = 0,
    black_pawns: u64 = 0,
    white_king: u64 = 0,
    black_king: u64 = 0,
    white_bishops: u64 = 0,
    black_bishops: u64 = 0,
    white_knights: u64 = 0,
    black_knights: u64 = 0,
    white_rooks: u64 = 0,
    black_rooks: u64 = 0,
    white_queens: u64 = 0,
    black_queens: u64 = 0,
    white_to_move: bool = true,
    en_passant: bool = false, // the side to move can capture en passant
};

/// What one level leaves for the mating net (and for the families after it).
const Sets = struct { w_cone: Set, b_cone: Set, w_fixed: Set, b_fixed: Set, w_king: Set, b_king: Set, w_bish: Set, b_bish: Set, w_take: Set, b_take: Set };

/// The inputs of a level beyond the position: see `level`.
const Level = struct {
    family: bool = false, // wp, bp and start below are a family's
    wp: Set = 0,
    bp: Set = 0,
    v: Set = 0,
    start: [6]Set = .{ 0, 0, 0, 0, 0, 0 },
    wx: Set = 0,
    bx: Set = 0,
    ws: Set = 0,
    bs: Set = 0,
    guard: bool = false,
};

/// What the families of the open pairs say at one level.
const Family = enum {
    lock, // none of them leaks to the king asked about
    refuted, // family A (no pair's pawn has moved) leaks to it
    none, // another family leaks
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
        file +%= 1;
        switch (fen[c]) {
            'P' => p.white_pawns |= sq,
            'p' => p.black_pawns |= sq,
            'K' => p.white_king |= sq,
            'k' => p.black_king |= sq,
            'B' => p.white_bishops |= sq,
            'b' => p.black_bishops |= sq,
            'N' => p.white_knights |= sq,
            'n' => p.black_knights |= sq,
            'R' => p.white_rooks |= sq,
            'r' => p.black_rooks |= sq,
            'Q' => p.white_queens |= sq,
            else => p.black_queens |= sq, // q
        }
    }
    while (c < fen.len and fen[c] == ' ') c += 1;
    p.white_to_move = c == fen.len or fen[c] != 'b';
    var field: u32 = 0;
    while (field < 2 and c < fen.len) : (field += 1) { // past the side to move and castling
        while (c < fen.len and fen[c] != ' ') c += 1;
        while (c < fen.len and fen[c] == ' ') c += 1;
    }
    if (c + 1 < fen.len and fen[c] >= 'a' and fen[c] <= 'h' and fen[c + 1] >= '1' and fen[c + 1] <= '8') {
        const target = @as(Set, 1) << @intCast((fen[c] - 'a') + 8 * (fen[c + 1] - '1'));
        p.en_passant = if (p.white_to_move)
            (sideways(south(target)) & p.white_pawns) != 0
        else
            (sideways(north(target)) & p.black_pawns) != 0;
    }
    return p;
}

/// Can White (white = true) or Black never be mated, by the lock detector?
pub fn cannotBeMated(p: Pieces, white: bool) bool {
    if (forcedStep(p)) |after| return cannotBeMated(after, white);
    const wx = p.white_knights | p.white_rooks | p.white_queens;
    const bx = p.black_knights | p.black_rooks | p.black_queens;
    if ((wx | bx) != 0) return boxedLock(p, white, wx, bx);
    if (p.en_passant) return false;
    const gaps = north(p.white_pawns) & south(p.black_pawns) & ~(p.white_pawns | p.black_pawns);
    var lv: [3]Set = undefined;
    for (lv[0..levels(p, &lv)]) |frozen| {
        if (gaps != 0) {
            switch (families(p, gaps, frozen, white)) {
                .lock => return true,
                .refuted => continue, // family A, the level with more walls, leaked: the level leaks too
                .none => {},
            }
        }
        if (level(p, frozen, .{ .guard = true })) |s| {
            if (!netLeaks(p, s, white, 0)) return true;
        }
    }
    return stuckMater(p, white);
}

/// The levels: both kings free (0), then each king frozen on its square (a wall for both sides)
/// when every square around it is held or attacked by a pawn. Their number.
fn levels(p: Pieces, out: *[3]Set) usize {
    const held = p.white_pawns | p.black_pawns | sideways(north(p.white_pawns) | south(p.black_pawns));
    var n: usize = 0;
    out[n] = 0;
    n += 1;
    for ([2]Set{ p.white_king, p.black_king }) |king| {
        if ((steps(king) & ~held) == 0) {
            out[n] = king;
            n += 1;
        }
    }
    return n;
}

/// The check seed: the side to move is in a pawn's check, so its king must step now, to a square it
/// can step to (not its own pawn, not a square an enemy pawn attacks, not next to the enemy king);
/// its reach starts there. Not when it has no such square (that may be a mate now), when one of its
/// pawns can take a checking pawn, or with a bishop on the board. The kings' starting sets.
fn checkSeed(p: Pieces) [2]Set {
    const wp, const bp, const wk, const bk = .{ p.white_pawns, p.black_pawns, p.white_king, p.black_king };
    const white = p.white_to_move;
    if ((p.white_bishops | p.black_bishops) != 0) return .{ wk, bk };
    const k = if (white) wk else bk;
    const own = if (white) wp else bp;
    const checkers = if (white) sideways(north(k)) & bp else sideways(south(k)) & wp;
    if (checkers == 0) return .{ wk, bk };
    const attacked = if (white) sideways(south(bp)) else sideways(north(wp));
    const to = steps(k) & ~own & ~attacked & ~steps(if (white) bk else wk);
    const takers = (if (white) sideways(south(checkers)) else sideways(north(checkers))) & own;
    if (to == 0 or takers != 0) return .{ wk, bk };
    return if (white) .{ to, bk } else .{ wk, to };
}

/// Does a diagonal line from the square king, stopped by block, meet a square of o?
fn rayMeets(king: Set, block: Set, o: Set) bool {
    const sq: i32 = @ctz(king);
    const dirs = [4][2]i32{ .{ -1, -1 }, .{ 1, -1 }, .{ -1, 1 }, .{ 1, 1 } };
    for (dirs) |d| {
        var f = (sq & 7) + d[0];
        var r = (sq >> 3) + d[1];
        while (f >= 0 and f < 8 and r >= 0 and r < 8) : ({
            f += d[0];
            r += d[1];
        }) {
            const s = @as(Set, 1) << @intCast(8 * r + f);
            if ((o & s) != 0) return true;
            if ((block & s) != 0) break;
        }
    }
    return false;
}

/// The stalemate guard: of the owner's fixed pawns cand (which the enemy king may take), those whose
/// capture always stalemates the owner. The owner must have nothing else that moves (every other
/// pawn fixed; no bishop, which the caller sees to). reach: where the owner's king may stand; shut:
/// squares it can never step to (own fixed pawns, squares the enemy's fixed pawns attack);
/// enemy_king: the enemy king's reach; block: squares a bishop's line never crosses.
fn stalemateGuard(cand: Set, own: Set, own_fixed: Set, reach: Set, shut: Set, enemy_king: Set, enemy_bishops: bool, block: Set) Set {
    if ((own & ~own_fixed) != 0) return 0;
    var guard: Set = 0;
    var c = cand;
    while (c != 0) : (c &= c - 1) {
        const pawn = lowest(c);
        const near = steps(pawn);
        const from = near & enemy_king; // where the enemy king takes from
        const x = shut | near | pawn; // after the capture, the owner's king may not step there
        var held = true;
        var k = reach & ~(near | pawn); // the owner's king, not defending the pawn
        while (k != 0) : (k &= k - 1) {
            const king = lowest(k);
            if ((steps(king) & ~x) != 0 or (enemy_bishops and rayMeets(king, block | pawn, from))) {
                held = false; // it has a square to step to, or the capture uncovers a check
                break;
            }
        }
        if (held) guard |= pawn;
    }
    return guard;
}

/// One level: the fixed point of the walls, the pawns that can never move, the kings' reaches, the
/// squares where each side may take a pawn, the pawns' cones and the bishops' reaches. The sets the
/// mating net reads, or null when the structure leaks whichever side is asked about.
/// o.family: o.wp, bp are the pawns (a family has a pair's pawn moved into its gap) and o.start
/// where the kings' reaches, capture squares and bishops' reaches start; o.v: walls for both sides
/// (the gaps of a family's pairs that stay); o.wx, bx, ws, bs: the boxed pieces' candidates and
/// their step squares; o.guard: the stalemate guard and the check seed (plain levels only).
fn level(p: Pieces, frozen: Set, o: Level) ?Sets {
    const wp = if (o.family) o.wp else p.white_pawns;
    const bp = if (o.family) o.bp else p.black_pawns;
    const wk, const bk, const wx, const bx, const v = .{ p.white_king, p.black_king, o.wx, o.bx, o.v | frozen };
    const frozen_white = (frozen & wk) != 0;
    const frozen_black = !frozen_white and frozen != 0;
    const near_frozen_black: Set = if (frozen_black) zone(bk) else 0;
    const near_frozen_white: Set = if (frozen_white) zone(wk) else 0;
    const seed: [2]Set = if (o.guard and frozen == 0) checkSeed(p) else .{ wk, bk };
    const start: [6]Set = if (o.family) o.start else .{ seed[0], seed[1], seed[0], seed[1], p.white_bishops, p.black_bishops };
    var w_king, var b_king, var w_take, var b_take, var w_bish, var b_bish = start;
    var w_cone, var b_cone, var w_fixed, var b_fixed = .{ wp, bp, wp, bp };
    var w_guard: Set = if (o.guard) ~@as(Set, 0) else 0; // nothing is taken yet
    var b_guard: Set = w_guard;
    while (true) {
        // Boxed: the pieces no enemy king or bishop reaches. Walls: pawns the other side can never
        // take (or whose capture stalemates their owner), the frozen king, the gaps, boxed pieces.
        const boxed = (wx & ~(b_king | b_bish)) | (bx & ~(w_king | w_bish));
        const w_wall = (wp & ~(b_take & ~w_guard)) | v | boxed;
        const b_wall = (bp & ~(w_take & ~b_guard)) | v | boxed;
        const nw_fixed = w_fixed & w_wall & south(b_wall | w_fixed);
        const nb_fixed = b_fixed & b_wall & north(w_wall | b_fixed);
        const nw_cone = fillNorth(w_cone, ~b_wall);
        const nb_cone = fillSouth(b_cone, ~w_wall);
        // The kings: never onto a fixed pawn, a square it attacks, or next to the frozen king.
        const b_hit = sideways(south(nb_fixed));
        const w_hit = sideways(north(nw_fixed));
        const nw_king = flood(w_king, ~(nw_fixed | b_hit | near_frozen_black));
        const nb_king = flood(b_king, ~(nb_fixed | w_hit | near_frozen_white));
        var nw_bish = w_bish;
        var nb_bish = b_bish;
        const open = ~(nw_fixed | nb_fixed);
        while (true) {
            const a = nw_bish | (diagonal(nw_bish) & open);
            const d = nb_bish | (diagonal(nb_bish) & open);
            if (a == nw_bish and d == nb_bish) break;
            nw_bish = a;
            nb_bish = d;
        }
        // A side may take a pawn where its king goes, and on any square a pawn may walk into.
        var t = b_take | nb_king;
        const nb_take = t | south(fillSouth(t & ~b_wall, ~b_wall));
        t = w_take | nw_king;
        const nw_take = t | north(fillNorth(t & ~w_wall, ~w_wall));
        var nw_guard = w_guard;
        var nb_guard = b_guard;
        if (o.guard) {
            const block = nw_fixed | nb_fixed;
            const w_has_b = p.white_bishops != 0;
            const b_has_b = p.black_bishops != 0;
            nw_guard = if (w_has_b) 0 else stalemateGuard(wp & nb_take & nw_fixed, wp, nw_fixed, nw_king, nw_fixed | b_hit, nb_king, b_has_b, block);
            nb_guard = if (b_has_b) 0 else stalemateGuard(bp & nw_take & nb_fixed, bp, nb_fixed, nb_king, nb_fixed | w_hit, nw_king, w_has_b, block);
        }
        const changed = nw_cone != w_cone or nb_cone != b_cone or nw_fixed != w_fixed or nb_fixed != b_fixed or
            nw_king != w_king or nb_king != b_king or nw_bish != w_bish or nb_bish != b_bish or
            nw_take != w_take or nb_take != b_take or nw_guard != w_guard or nb_guard != b_guard;
        w_cone = nw_cone;
        b_cone = nb_cone;
        w_fixed = nw_fixed;
        b_fixed = nb_fixed;
        w_king = nw_king;
        b_king = nb_king;
        w_bish = nw_bish;
        b_bish = nb_bish;
        w_take = nw_take;
        b_take = nb_take;
        w_guard = nw_guard;
        b_guard = nb_guard;
        if (!changed) break;
    }
    const boxed = (wx & ~(b_king | b_bish)) | (bx & ~(w_king | w_bish));
    if (((w_cone & rank_8) | (b_cone & rank_1)) != 0) return null; // a pawn can promote
    if (((north(sideways(w_cone)) & (b_cone | bx)) | (south(sideways(b_cone)) & wx)) != 0) return null; // a pawn can capture
    if ((frozen_white and w_king != wk) or (frozen_black and b_king != bk)) return null; // the frozen king can move
    if (((diagonal(w_bish) & b_cone) | (diagonal(b_bish) & w_cone)) != 0) return null; // a bishop meets a pawn's path
    if (((o.ws & ~(w_fixed | (wx & boxed))) | (o.bs & ~(b_fixed | (bx & boxed)))) != 0) return null; // a piece may step
    if ((w_guard | b_guard) != 0) {
        // A king that takes a guarded pawn ends the game: for the mating net, the kings' reaches
        // again, now stopping at the enemy's guarded pawns.
        w_king = flood(seed[0], ~(w_fixed | sideways(south(b_fixed)) | near_frozen_black | (bp & b_guard)));
        b_king = flood(seed[1], ~(b_fixed | sideways(north(w_fixed)) | near_frozen_white | (wp & w_guard)));
    }
    return .{ .w_cone = w_cone, .b_cone = b_cone, .w_fixed = w_fixed, .b_fixed = b_fixed, .w_king = w_king, .b_king = b_king, .w_bish = w_bish, .b_bish = b_bish, .w_take = w_take, .b_take = b_take };
}

/// The mating net: can the other side's pawns and bishops catch the king asked about? occ: squares
/// that stand occupied for good besides (the boxed pieces').
fn netLeaks(p: Pieces, s: Sets, white: bool, occ: Set) bool {
    var attack: Set = undefined;
    var reach: Set = undefined;
    var free: Set = undefined;
    var spare: Set = undefined;
    var twins: Set = undefined;
    if (white) {
        attack = diagonal(s.b_bish) | sideways(south(s.b_cone));
        reach = s.w_king;
        free = ~(s.w_cone | occ | zone(s.b_king) | attack); // never occupied, attacked or next to the mater
        spare = free & ~s.w_bish; // ... nor reached by the king's own bishops
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
    const no_pair: Set = (if (count(twins & dark) > 1) ~dark else 0) | (if (count(twins & ~dark) > 1) dark else 0);
    const flight = sideways(spare) | north(spare) | south(spare) |
        ((north(free) | south(free)) & sideways(free) & ~no_pair);
    return (attack & reach & ~flight) != 0;
}

/// The families of the open pairs at one level.
fn families(p: Pieces, gaps: Set, frozen: Set, white: bool) Family {
    var pairs: [max_pairs][3]Set = undefined; // per pair: the gap, the white pawn below it, the black pawn above it
    var k: usize = 0;
    var g = gaps;
    while (g != 0) : (g &= g - 1) {
        if (k == max_pairs) return .none;
        const gap = lowest(g);
        pairs[k] = .{ gap, south(gap), north(gap) };
        k += 1;
    }
    var n: usize = 1;
    for (0..k) |_| n *= 3;
    var sets: [27]Sets = undefined;
    for (0..n) |f| {
        // Family f: digit i (base 3) says what pair i's pawns have done: 0 neither, 1 the white one
        // stepped into the gap, 2 the black one did. Its sets start from those of the family it is
        // reached from (the same with pair i's pawns in place), minus the gap.
        var o: Level = .{ .family = true, .wp = p.white_pawns, .bp = p.black_pawns };
        if (f == 0) o.start = .{ p.white_king, p.black_king, p.white_king, p.black_king, p.white_bishops, p.black_bishops };
        var q = f;
        var pow: usize = 1;
        for (0..k) |i| {
            const d = q % 3;
            const gap = pairs[i][0];
            if (d == 0) {
                o.v |= gap; // the gap stays: a wall for both sides' pawns
            } else {
                if (d == 1) o.wp = (o.wp & ~pairs[i][1]) | gap else o.bp = (o.bp & ~pairs[i][2]) | gap;
                const r = sets[f - d * pow];
                o.start[0] |= r.w_king & ~gap;
                o.start[1] |= r.b_king & ~gap;
                o.start[2] |= r.w_take;
                o.start[3] |= r.b_take;
                o.start[4] |= r.w_bish & ~gap;
                o.start[5] |= r.b_bish & ~gap;
            }
            q /= 3;
            pow *= 3;
        }
        const s = level(p, frozen, o) orelse return if (f == 0) .refuted else .none;
        // The pairs that stay: both pawns must never move.
        q = f;
        for (0..k) |i| {
            if (q % 3 == 0 and ((pairs[i][1] & ~s.w_fixed) | (pairs[i][2] & ~s.b_fixed)) != 0) return .none;
            q /= 3;
        }
        if (netLeaks(p, s, white, 0)) return if (f == 0) .refuted else .none;
        sets[f] = s;
    }
    return .lock;
}

/// The step squares of one side's knights, rooks (and queens: o) and queens.
fn boxSteps(knights: Set, o: Set, queens: Set) Set {
    return sideways(o) | north(o) | south(o) | diagonal(queens) | knight(knights);
}

/// With knights, rooks or queens on the board: every one of them must be boxed in by its own pawns
/// and pieces; then the levels, with the boxed pieces as walls and no flight onto their squares.
fn boxedLock(p: Pieces, white: bool, wx: Set, bx: Set) bool {
    const ws = boxSteps(p.white_knights, p.white_rooks | p.white_queens, p.white_queens);
    const bs = boxSteps(p.black_knights, p.black_rooks | p.black_queens, p.black_queens);
    if ((ws & ~(p.white_pawns | wx)) != 0 or (bs & ~(p.black_pawns | bx)) != 0 or p.en_passant) return false;
    var lv: [3]Set = undefined;
    for (lv[0..levels(p, &lv)]) |frozen| {
        if (level(p, frozen, .{ .wx = wx, .bx = bx, .ws = ws, .bs = bs })) |s| {
            if (!netLeaks(p, s, white, wx | bx)) return true;
        }
    }
    return false;
}

/// Ahead, for the flagged side (White's pawns go north).
fn fwd(white: bool, s: Set) Set {
    return if (white) north(s) else south(s);
}
/// Behind, for the flagged side.
fn back(white: bool, s: Set) Set {
    return if (white) south(s) else north(s);
}

/// The stuck mater: the flagged side is to move and, whatever it plays, the mater has no legal move
/// left (kings and pawns only): the game ends at the mater's turn.
fn stuckMater(p: Pieces, white: bool) bool {
    if (p.white_to_move != white or p.en_passant) return false;
    if ((p.white_bishops | p.black_bishops | p.white_knights | p.black_knights | p.white_rooks |
        p.black_rooks | p.white_queens | p.black_queens) != 0) return false;
    const fp = if (white) p.white_pawns else p.black_pawns;
    const mp = if (white) p.black_pawns else p.white_pawns;
    const fk = if (white) p.white_king else p.black_king;
    const mk = if (white) p.black_king else p.white_king;
    const occ = fp | mp | fk | mk;
    // A mater's pawn with an empty square ahead is never stuck; then only a stalemate now is left to
    // find, which a flagged pawn's push rules out.
    if ((back(white, mp) & ~occ) != 0 and (fwd(white, fp) & ~occ) != 0) return false;
    const f_attack = sideways(fwd(white, fp));
    const m_attack = sideways(back(white, mp));
    if ((f_attack & (mp | mk)) != 0) return false; // 1. the flagged side has no capture
    const single = fwd(white, fp) & ~occ;
    const double = fwd(white, single & (if (white) rank_3 else rank_6)) & ~occ;
    const pushes = single | double;
    const near = steps(mk);
    const king_to = steps(fk) & ~fp & ~m_attack & ~near; // the flagged king's steps now
    const in_check = (fk & m_attack) != 0;
    if (in_check and king_to == 0) return false; // mated now
    const stays = pushes != 0 and !in_check; // a pawn may move instead of the king
    if (king_to == 0 and !stays) return true; // no move, no check: stalemate now
    // The squares next to every square the flagged king may stand on after its move.
    var cover: Set = if (stays) steps(fk) else ~@as(Set, 0);
    var k = king_to;
    while (k != 0) : (k &= k - 1) cover &= steps(lowest(k));
    // 2. the mater's pawns are blocked by men that stay, and attack no flagged pawn
    const blockers = fp | mp | mk | (if (king_to == 0) fk else 0);
    if (((back(white, mp) & ~blockers) | (m_attack & fp)) != 0) return false;
    // 3. every square next to the mater's king: its own pawn, attacked by a flagged pawn that cannot
    //    move now, or next to the flagged king wherever it goes
    const still = fp & back(white, fwd(white, fp) & occ);
    if ((near & ~(mp | sideways(fwd(white, still)) | cover)) != 0) return false;
    // 4. no push lands where a mater's pawn attacks or next to its king, nor lets it take en passant
    return ((pushes & (m_attack | near)) | (double & sideways(mp))) == 0;
}

/// The forced step: the side to move is in a pawn's check, with kings and pawns only, and its one
/// legal move is a step of its king. The position after it, or null.
fn forcedStep(p: Pieces) ?Pieces {
    if (p.en_passant or (p.white_bishops | p.black_bishops | p.white_knights | p.black_knights |
        p.white_rooks | p.black_rooks | p.white_queens | p.black_queens) != 0) return null;
    const white = p.white_to_move;
    const k = if (white) p.white_king else p.black_king;
    const ek = if (white) p.black_king else p.white_king;
    const own = if (white) p.white_pawns else p.black_pawns;
    const enemy = if (white) p.black_pawns else p.white_pawns;
    const checkers = (if (white) sideways(north(k)) else sideways(south(k))) & enemy;
    if (checkers == 0) return null;
    const attacked = if (white) sideways(south(enemy)) else sideways(north(enemy));
    const to = steps(k) & ~own & ~attacked & ~steps(ek);
    if (count(to) != 1) return null;
    if (((if (white) sideways(south(checkers)) else sideways(north(checkers))) & own) != 0) return null; // a pawn may take instead
    var q = p;
    q.white_to_move = !white;
    q.en_passant = false;
    if (white) {
        q.white_king = to;
        q.black_pawns &= ~to;
    } else {
        q.black_king = to;
        q.white_pawns &= ~to;
    }
    return q;
}
