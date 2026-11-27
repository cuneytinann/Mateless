//! Mateless's lock detector, second version, in its simplest form.
//!
//! Can a side never be mated? The lock detector answers yes when pawns, kings and bishops (and
//! knights, rooks or queens boxed in by their own men) form a structure that no series of legal
//! moves can open (FIDE 5.2.2 dead position, 6.9 flag fall). It reads bitboards and the side to
//! move: it generates no move and searches nothing.
//!
//! The first version (../../rust) grows each king's reach, the pawns that can never move, and the
//! squares where each side may take a pawn, until nothing changes; the structure leaks if a pawn
//! can promote or capture, a frozen king can move, a bishop can reach a pawn's path, or the king
//! asked about can reach a square the other side attacks without a sure flight. This version keeps
//! all of it and adds, each only where its situation is on the board:
//!   - open pawn pairs: a white and a black pawn on one file with one empty square between them;
//!     the reachable positions split into families by what the pair's pawns have done (neither
//!     moved, the white one stepped into the gap, the black one did), up to 3 pairs;
//!   - boxed knights, rooks and queens: a piece whose every step square holds one of its own men
//!     that never moves, and that no enemy king or bishop reaches, never moves nor falls; such a
//!     man is a fixed pawn, another boxed piece, a still bishop (every diagonal neighbour held so,
//!     and out of the enemy king's and bishops' reach) or the piece's own frozen king (its side
//!     with no castling right left and not standing where a castle leaves it beside its rook);
//!   - twin bishops: two bishops of one side on one colour no longer fail it; the mating net
//!     leaves out its second flight rule where they may hold both flights;
//!   - the stalemate guard: a pawn the enemy king may take stays a wall if taking it always
//!     stalemates its owner;
//!   - the check seed: a king in a pawn's check starts its reach from the squares it can step to;
//!   - the stuck mater: whatever the flagged side plays, the mater is left without a move;
//!   - the forced step: a king in a pawn's check with one legal move, a step: the lock of the
//!     position after it.
//!
//! A possible en passant capture fails it at once. Sound, not complete: a structure it passes can
//! never be opened; one it fails may still be dead.
//!
//! Squares: a1 = 0, b1 = 1, ..., h8 = 63. A set of squares (a bitboard) is a `u64`.

type Set = u64;

const FILE_A: Set = 0x0101010101010101;
const FILE_H: Set = 0x8080808080808080;
const RANK_1: Set = 0x00000000000000FF;
const RANK_3: Set = 0x0000000000FF0000;
const RANK_6: Set = 0x0000FF0000000000;
const RANK_8: Set = 0xFF00000000000000;
const DARK: Set = 0xAA55AA55AA55AA55; // the dark squares; a1 is dark
const MAX_PAIRS: usize = 3; // the most open pairs the families are split on (3^3 = 27)

fn north(s: Set) -> Set {
    s << 8
}
fn south(s: Set) -> Set {
    s >> 8
}
fn sideways(s: Set) -> Set {
    ((s << 1) & !FILE_A) | ((s >> 1) & !FILE_H)
}
/// s and every square next to it
fn zone(s: Set) -> Set {
    let v = s | north(s) | south(s);
    v | sideways(v)
}
/// the squares next to s
fn steps(s: Set) -> Set {
    zone(s) & !s
}
/// the squares diagonally next to s
fn diagonal(s: Set) -> Set {
    sideways(north(s) | south(s))
}
/// the squares a knight on s goes to
fn knight(s: Set) -> Set {
    let one = sideways(s);
    let two = ((s << 2) & !(FILE_A | (FILE_A << 1))) | ((s >> 2) & !(FILE_H | (FILE_H >> 1)));
    north(north(one)) | south(south(one)) | north(two) | south(two)
}
fn count(s: Set) -> u32 {
    s.count_ones()
}

/// Every square reachable from g by steps north through squares of p.
fn fill_north(mut g: Set, mut p: Set) -> Set {
    g |= p & (g << 8);
    p &= p << 8;
    g |= p & (g << 16);
    p &= p << 16;
    g | (p & (g << 32))
}

/// Every square reachable from g by steps south through squares of p.
fn fill_south(mut g: Set, mut p: Set) -> Set {
    g |= p & (g >> 8);
    p &= p >> 8;
    g |= p & (g >> 16);
    p &= p >> 16;
    g | (p & (g >> 32))
}

/// Every square a king may reach from k through squares of m.
fn flood(mut k: Set, m: Set) -> Set {
    loop {
        let a = k | (zone(k) & m);
        if a == k {
            return k;
        }
        k = a;
    }
}

/// What the lock detector reads from a position.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Pieces {
    pub white_pawns: u64,
    pub black_pawns: u64,
    pub white_king: u64,
    pub black_king: u64,
    pub white_bishops: u64,
    pub black_bishops: u64,
    pub white_knights: u64,
    pub black_knights: u64,
    pub white_rooks: u64,
    pub black_rooks: u64,
    pub white_queens: u64,
    pub black_queens: u64,
    pub white_to_move: bool,
    /// the side to move can capture en passant
    pub en_passant: bool,
    /// White has a castling right (its king and that rook in place)
    pub white_castles: bool,
    pub black_castles: bool,
}

/// What one level leaves for the mating net (and for the families after it).
#[derive(Clone, Copy, Default)]
struct Sets {
    w_cone: Set,
    b_cone: Set,
    w_fixed: Set,
    b_fixed: Set,
    w_king: Set,
    b_king: Set,
    w_bish: Set,
    b_bish: Set,
    w_take: Set,
    b_take: Set,
}

/// The inputs of a level beyond the position: see `level`.
#[derive(Clone, Copy, Default)]
struct Level {
    pawns: Option<(Set, Set)>,
    v: Set,
    start: Option<[Set; 6]>,
    wx: Set,
    bx: Set,
    ws: Set,
    bs: Set,
    guard: bool,
}

/// The pieces of a FEN. The en passant square counts only if a pawn can capture onto it.
pub fn from_fen(fen: &str) -> Pieces {
    let mut p = Pieces::default();
    let (mut rank, mut file) = (7, 0);
    let (board, rest) = fen.split_once(' ').unwrap_or((fen, ""));
    for c in board.bytes() {
        if c == b'/' {
            rank -= 1;
            file = 0;
            continue;
        }
        if (b'1'..=b'8').contains(&c) {
            file += i32::from(c - b'0');
            continue;
        }
        let sq: Set = 1 << (8 * rank + file);
        file += 1;
        match c {
            b'P' => p.white_pawns |= sq,
            b'p' => p.black_pawns |= sq,
            b'K' => p.white_king |= sq,
            b'k' => p.black_king |= sq,
            b'B' => p.white_bishops |= sq,
            b'b' => p.black_bishops |= sq,
            b'N' => p.white_knights |= sq,
            b'n' => p.black_knights |= sq,
            b'R' => p.white_rooks |= sq,
            b'r' => p.black_rooks |= sq,
            b'Q' => p.white_queens |= sq,
            _ => p.black_queens |= sq, // q
        }
    }
    let mut rest = rest.trim_start_matches(' ');
    p.white_to_move = !rest.starts_with('b');
    // past the side to move
    rest = rest
        .trim_start_matches(|c| c != ' ')
        .trim_start_matches(' ');
    let (rights, after) = rest.split_once(' ').unwrap_or((rest, ""));
    for c in rights.bytes().filter(|&c| c != b'-') {
        let white = c.is_ascii_uppercase();
        let back = if white { RANK_1 } else { RANK_8 };
        let (king, rooks) = if white {
            (p.white_king & back, p.white_rooks & back)
        } else {
            (p.black_king & back, p.black_rooks & back)
        };
        if king == 0 {
            continue; // a right without its king in place does not count
        }
        let (kf, up) = (king.trailing_zeros() % 8, c.to_ascii_uppercase());
        let ok = squares(rooks).any(|r| {
            let f = r.trailing_zeros() % 8;
            match up {
                b'K' => f > kf,
                b'Q' => f < kf,
                _ => f == u32::from(up - b'A') && f != kf,
            }
        });
        if white {
            p.white_castles |= ok;
        } else {
            p.black_castles |= ok;
        }
    }
    rest = after.trim_start_matches(' ');
    if let [f @ b'a'..=b'h', r @ b'1'..=b'8', ..] = *rest.as_bytes() {
        let target: Set = 1 << ((f - b'a') + 8 * (r - b'1'));
        p.en_passant = if p.white_to_move {
            sideways(south(target)) & p.white_pawns != 0
        } else {
            sideways(north(target)) & p.black_pawns != 0
        };
    }
    p
}

/// Can White (`white` = true) or Black never be mated, by the lock detector?
pub fn cannot_be_mated(p: &Pieces, white: bool) -> bool {
    if let Some(after) = forced_step(p) {
        return cannot_be_mated(&after, white);
    }
    let wx = p.white_knights | p.white_rooks | p.white_queens;
    let bx = p.black_knights | p.black_rooks | p.black_queens;
    if wx | bx != 0 {
        return boxed_lock(p, white, wx, bx);
    }
    if p.en_passant {
        return false;
    }
    let gaps = north(p.white_pawns) & south(p.black_pawns) & !(p.white_pawns | p.black_pawns);
    for frozen in levels(p, 0, 0) {
        if gaps != 0 {
            match families(p, gaps, frozen, white) {
                Family::Lock => return true,
                Family::Refuted => continue, // family A, the level with more walls, leaked: the level leaks too
                Family::None => {}
            }
        }
        let guard = Level {
            guard: true,
            ..Level::default()
        };
        if let Some(s) = level(p, frozen, &guard) {
            if !net_leaks(p, &s, white, 0) {
                return true;
            }
        }
    }
    stuck_mater(p, white)
}

/// The levels: both kings free (0), then each king frozen on its square (a wall for both sides)
/// when every square around it is held or attacked by a pawn (or holds one of its own pieces,
/// `w_own` or `b_own`, where boxed pieces are on the board).
fn levels(p: &Pieces, w_own: Set, b_own: Set) -> Vec<Set> {
    let held =
        p.white_pawns | p.black_pawns | sideways(north(p.white_pawns) | south(p.black_pawns));
    let mut out = vec![0];
    for (king, own) in [(p.white_king, w_own), (p.black_king, b_own)] {
        if steps(king) & !(held | own) == 0 {
            out.push(king);
        }
    }
    out
}

/// The one-square sets of s.
fn squares(mut s: Set) -> impl Iterator<Item = Set> {
    std::iter::from_fn(move || {
        let b = s & s.wrapping_neg();
        s ^= b;
        (b != 0).then_some(b)
    })
}

/// May this side's king hold a boxed piece's step square (when frozen)? Not with a castling right
/// left (a castling rook may stand beside its king, in Chess960, and castling moves it), and not
/// where a castle leaves it beside its rook (g1 with a rook on f1, c1 with one on d1; g8, f8, c8,
/// d8): a castle leaves the halfmove clock as it is, so the lock is not asked after one.
fn king_wall(p: &Pieces, white: bool) -> bool {
    let (king, rooks, castles, g, c) = if white {
        (p.white_king, p.white_rooks, p.white_castles, 1 << 6, 1 << 2)
    } else {
        (
            p.black_king,
            p.black_rooks,
            p.black_castles,
            1 << 62,
            1 << 58,
        )
    };
    !castles && rooks & (((king & g) >> 1) | ((king & c) << 1)) == 0
}

/// The still bishops among b: every diagonal neighbour held for good (held: fixed pawns and boxed
/// pieces of their colour) or by another still bishop, and out of the enemy king's and bishops'
/// reach. Such a bishop never moves and is never taken (a pawn taking it fails the bishop contact
/// test). The largest such set.
fn still_bishops(b: Set, held: Set, reach: Set) -> Set {
    let mut s = b & !reach;
    loop {
        let n = squares(s)
            .filter(|&q| diagonal(q) & !(held | s) == 0)
            .fold(0, |n, q| n | q);
        if n == s {
            return s;
        }
        s = n;
    }
}

/// One level: the fixed point of the walls, the pawns that can never move, the kings' reaches, the
/// squares where each side may take a pawn, the pawns' cones and the bishops' reaches. The sets the
/// mating net reads, or None when the structure leaks whichever side is asked about.
/// o.pawns: the pawns (a family has a pair's pawn moved into its gap); o.v: walls for both sides
/// (the gaps of a family's pairs that stay); o.start: where the kings' reaches, capture squares and
/// bishops' reaches start (a family's); o.wx, bx, ws, bs: the boxed pieces' candidates and their
/// step squares; o.guard: the stalemate guard and the check seed (plain levels only).
fn level(p: &Pieces, frozen: Set, o: &Level) -> Option<Sets> {
    let (wp, bp) = o.pawns.unwrap_or((p.white_pawns, p.black_pawns));
    let (wk, bk) = (p.white_king, p.black_king);
    let (wx, bx, v) = (o.wx, o.bx, o.v | frozen);
    let frozen_white = frozen & wk != 0;
    let frozen_black = !frozen_white && frozen != 0;
    let near_frozen_black = if frozen_black { zone(bk) } else { 0 };
    let near_frozen_white = if frozen_white { zone(wk) } else { 0 };
    let (w_seed, b_seed) = if o.guard && frozen == 0 {
        check_seed(p)
    } else {
        (wk, bk)
    };
    let [mut w_king, mut b_king, mut w_take, mut b_take, mut w_bish, mut b_bish] =
        o.start.unwrap_or([
            w_seed,
            b_seed,
            w_seed,
            b_seed,
            p.white_bishops,
            p.black_bishops,
        ]);
    let (mut w_cone, mut b_cone, mut w_fixed, mut b_fixed) = (wp, bp, wp, bp);
    let (mut w_guard, mut b_guard) = if o.guard { (!0, !0) } else { (0, 0) }; // nothing is taken yet
    loop {
        // Boxed: the pieces no enemy king or bishop reaches. Walls: pawns the other side can never
        // take (or whose capture stalemates their owner), the frozen king, the gaps, boxed pieces.
        let boxed = (wx & !(b_king | b_bish)) | (bx & !(w_king | w_bish));
        let w_wall = (wp & !(b_take & !w_guard)) | v | boxed;
        let b_wall = (bp & !(w_take & !b_guard)) | v | boxed;
        let nw_fixed = w_fixed & w_wall & south(b_wall | w_fixed);
        let nb_fixed = b_fixed & b_wall & north(w_wall | b_fixed);
        let nw_cone = fill_north(w_cone, !b_wall);
        let nb_cone = fill_south(b_cone, !w_wall);
        // The kings: never onto a fixed pawn, a square it attacks, or next to the frozen king; with
        // boxed pieces on the board, never onto its own boxed pieces and still bishops either.
        let (b_hit, w_hit) = (sideways(south(nb_fixed)), sideways(north(nw_fixed)));
        let (w_still, b_still) = if wx | bx != 0 {
            (
                still_bishops(p.white_bishops, nw_fixed | (wx & boxed), b_king | b_bish),
                still_bishops(p.black_bishops, nb_fixed | (bx & boxed), w_king | w_bish),
            )
        } else {
            (0, 0)
        };
        let nw_king = flood(
            w_king,
            !(nw_fixed | b_hit | near_frozen_black | (wx & boxed) | w_still),
        );
        let nb_king = flood(
            b_king,
            !(nb_fixed | w_hit | near_frozen_white | (bx & boxed) | b_still),
        );
        let (mut nw_bish, mut nb_bish) = (w_bish, b_bish);
        let open = !(nw_fixed | nb_fixed);
        loop {
            let a = nw_bish | (diagonal(nw_bish) & open);
            let d = nb_bish | (diagonal(nb_bish) & open);
            if a == nw_bish && d == nb_bish {
                break;
            }
            nw_bish = a;
            nb_bish = d;
        }
        // A side may take a pawn where its king goes, and on any square a pawn may walk into.
        let t = b_take | nb_king;
        let nb_take = t | south(fill_south(t & !b_wall, !b_wall));
        let t = w_take | nw_king;
        let nw_take = t | north(fill_north(t & !w_wall, !w_wall));
        let (mut nw_guard, mut nb_guard) = (w_guard, b_guard);
        if o.guard {
            let block = nw_fixed | nb_fixed;
            let (w_has_b, b_has_b) = (p.white_bishops != 0, p.black_bishops != 0);
            nw_guard = if w_has_b {
                0
            } else {
                stalemate_guard(
                    wp & nb_take & nw_fixed,
                    wp,
                    nw_fixed,
                    nw_king,
                    nw_fixed | b_hit,
                    nb_king,
                    b_has_b,
                    block,
                )
            };
            nb_guard = if b_has_b {
                0
            } else {
                stalemate_guard(
                    bp & nw_take & nb_fixed,
                    bp,
                    nb_fixed,
                    nb_king,
                    nb_fixed | w_hit,
                    nw_king,
                    w_has_b,
                    block,
                )
            };
        }
        let new = [
            nw_cone, nb_cone, nw_fixed, nb_fixed, nw_king, nb_king, nw_bish, nb_bish, nw_take,
            nb_take, nw_guard, nb_guard,
        ];
        let old = [
            w_cone, b_cone, w_fixed, b_fixed, w_king, b_king, w_bish, b_bish, w_take, b_take,
            w_guard, b_guard,
        ];
        [
            w_cone, b_cone, w_fixed, b_fixed, w_king, b_king, w_bish, b_bish, w_take, b_take,
            w_guard, b_guard,
        ] = new;
        if new == old {
            break;
        }
    }
    let boxed = (wx & !(b_king | b_bish)) | (bx & !(w_king | w_bish));
    if (w_cone & RANK_8) | (b_cone & RANK_1) != 0 {
        return None; // a pawn can promote
    }
    if (north(sideways(w_cone)) & (b_cone | bx)) | (south(sideways(b_cone)) & wx) != 0 {
        return None; // a pawn can capture
    }
    if (frozen_white && w_king != wk) || (frozen_black && b_king != bk) {
        return None; // the frozen king can move
    }
    if (diagonal(w_bish) & b_cone) | (diagonal(b_bish) & w_cone) != 0 {
        return None; // a bishop meets a pawn's path
    }
    // A piece may step: a step square not held by a fixed pawn, a boxed piece or a still bishop of
    // its colour, or by its frozen king (where the king may be a wall).
    let (w_still, b_still) = if wx | bx != 0 {
        (
            still_bishops(p.white_bishops, w_fixed | (wx & boxed), b_king | b_bish),
            still_bishops(p.black_bishops, b_fixed | (bx & boxed), w_king | w_bish),
        )
    } else {
        (0, 0)
    };
    let w_kw = if frozen_white && king_wall(p, true) {
        wk
    } else {
        0
    };
    let b_kw = if frozen_black && king_wall(p, false) {
        bk
    } else {
        0
    };
    if (o.ws & !(w_fixed | (wx & boxed) | w_still | w_kw))
        | (o.bs & !(b_fixed | (bx & boxed) | b_still | b_kw))
        != 0
    {
        return None; // a piece may step
    }
    if w_guard | b_guard != 0 {
        // A king that takes a guarded pawn ends the game: for the mating net, the kings' reaches
        // again, now stopping at the enemy's guarded pawns.
        w_king = flood(
            w_seed,
            !(w_fixed | sideways(south(b_fixed)) | near_frozen_black | (bp & b_guard)),
        );
        b_king = flood(
            b_seed,
            !(b_fixed | sideways(north(w_fixed)) | near_frozen_white | (wp & w_guard)),
        );
    }
    Some(Sets {
        w_cone,
        b_cone,
        w_fixed,
        b_fixed,
        w_king,
        b_king,
        w_bish,
        b_bish,
        w_take,
        b_take,
    })
}

/// The mating net: can the other side's pawns and bishops catch the king asked about? occ: squares
/// that stand occupied for good besides (the boxed pieces').
fn net_leaks(p: &Pieces, s: &Sets, white: bool, occ: Set) -> bool {
    let (attack, reach, free, spare, twins);
    if white {
        attack = diagonal(s.b_bish) | sideways(south(s.b_cone));
        reach = s.w_king;
        free = !(s.w_cone | occ | zone(s.b_king) | attack); // never occupied, attacked or next to the mater
        spare = free & !s.w_bish; // ... nor reached by the king's own bishops
        twins = p.white_bishops;
    } else {
        attack = diagonal(s.w_bish) | sideways(north(s.w_cone));
        reach = s.b_king;
        free = !(s.b_cone | occ | zone(s.w_king) | attack);
        spare = free & !s.b_bish;
        twins = p.black_bishops;
    }
    // A king next to a spare square, or with free squares beside it both ways, always has a flight.
    // The second rule counts on at most one of the king's own bishops on the colour of those two
    // squares (the colour opposite the king's): not on the king squares where it has two or more.
    let no_pair = (if count(twins & DARK) > 1 { !DARK } else { 0 })
        | (if count(twins & !DARK) > 1 { DARK } else { 0 });
    let flight = sideways(spare)
        | north(spare)
        | south(spare)
        | ((north(free) | south(free)) & sideways(free) & !no_pair);
    attack & reach & !flight != 0
}

/// The check seed: the side to move is in a pawn's check, so its king must step now, to a square it
/// can step to (not its own pawn, not a square an enemy pawn attacks, not next to the enemy king);
/// its reach starts there. Not when it has no such square (that may be a mate now), when one of its
/// pawns can take a checking pawn, or with a bishop on the board. The kings' starting sets.
fn check_seed(p: &Pieces) -> (Set, Set) {
    let (wp, bp, wk, bk, white) = (
        p.white_pawns,
        p.black_pawns,
        p.white_king,
        p.black_king,
        p.white_to_move,
    );
    if p.white_bishops | p.black_bishops != 0 {
        return (wk, bk);
    }
    let (k, own) = if white { (wk, wp) } else { (bk, bp) };
    let checkers = if white {
        sideways(north(k)) & bp
    } else {
        sideways(south(k)) & wp
    };
    if checkers == 0 {
        return (wk, bk);
    }
    let attacked = if white {
        sideways(south(bp))
    } else {
        sideways(north(wp))
    };
    let to = steps(k) & !own & !attacked & !steps(if white { bk } else { wk });
    let takers = (if white {
        sideways(south(checkers))
    } else {
        sideways(north(checkers))
    }) & own;
    if to == 0 || takers != 0 {
        return (wk, bk);
    }
    if white {
        (to, bk)
    } else {
        (wk, to)
    }
}

/// The stalemate guard: of the owner's fixed pawns `cand` (which the enemy king may take), those
/// whose capture always stalemates the owner. The owner must have nothing else that moves (every
/// other pawn fixed; no bishop, which the caller sees to). reach: where the owner's king may stand;
/// shut: squares it can never step to (own fixed pawns, squares the enemy's fixed pawns attack);
/// enemy_king: the enemy king's reach; block: squares a bishop's line never crosses.
#[allow(clippy::too_many_arguments)]
fn stalemate_guard(
    cand: Set,
    own: Set,
    own_fixed: Set,
    reach: Set,
    shut: Set,
    enemy_king: Set,
    enemy_bishops: bool,
    block: Set,
) -> Set {
    if own & !own_fixed != 0 {
        return 0;
    }
    let mut guard = 0;
    let mut c = cand;
    while c != 0 {
        let pawn = c & c.wrapping_neg();
        c &= c - 1;
        let near = steps(pawn);
        let from = near & enemy_king; // where the enemy king takes from
        let x = shut | near | pawn; // after the capture, the owner's king may not step there
        let mut held = true;
        let mut k = reach & !(near | pawn); // the owner's king, not defending the pawn
        while k != 0 {
            let king = k & k.wrapping_neg();
            k &= k - 1;
            if steps(king) & !x != 0 || (enemy_bishops && ray_meets(king, block | pawn, from)) {
                held = false; // it has a square to step to, or the capture uncovers a check
                break;
            }
        }
        if held {
            guard |= pawn;
        }
    }
    guard
}

/// Does a diagonal line from the square `king`, stopped by `block`, meet a square of `o`?
fn ray_meets(king: Set, block: Set, o: Set) -> bool {
    let sq = king.trailing_zeros() as i32;
    let (f0, r0) = (sq & 7, sq >> 3);
    for (df, dr) in [(-1, -1), (1, -1), (-1, 1), (1, 1)] {
        let (mut f, mut r) = (f0 + df, r0 + dr);
        while (0..8).contains(&f) && (0..8).contains(&r) {
            let s: Set = 1 << (8 * r + f);
            if o & s != 0 {
                return true;
            }
            if block & s != 0 {
                break;
            }
            f += df;
            r += dr;
        }
    }
    false
}

/// What the families of the open pairs say at one level.
enum Family {
    /// none of them leaks to the king asked about
    Lock,
    /// family A (no pair's pawn has moved) leaks to it
    Refuted,
    /// another family leaks
    None,
}

/// The families of the open pairs at one level.
fn families(p: &Pieces, gaps: Set, frozen: Set, white: bool) -> Family {
    let mut pairs = Vec::new(); // per pair: the gap, the white pawn below it, the black pawn above it
    let mut g = gaps;
    while g != 0 {
        let gap = g & g.wrapping_neg();
        g &= g - 1;
        pairs.push((gap, south(gap), north(gap)));
    }
    if pairs.len() > MAX_PAIRS {
        return Family::None;
    }
    let k = pairs.len();
    let mut sets: Vec<Sets> = Vec::new();
    for f in 0..3usize.pow(k as u32) {
        // Family f: digit i (base 3) says what pair i's pawns have done: 0 neither, 1 the white one
        // stepped into the gap, 2 the black one did. Its sets start from those of the family it is
        // reached from (the same with pair i's pawns in place), minus the gap.
        let (mut wp, mut bp, mut v) = (p.white_pawns, p.black_pawns, 0);
        let mut start = if f == 0 {
            [
                p.white_king,
                p.black_king,
                p.white_king,
                p.black_king,
                p.white_bishops,
                p.black_bishops,
            ]
        } else {
            [0; 6]
        };
        let mut q = f;
        for (i, &(gap, w, b)) in pairs.iter().enumerate() {
            let d = q % 3;
            q /= 3;
            if d == 0 {
                v |= gap; // the gap stays: a wall for both sides' pawns
                continue;
            }
            if d == 1 {
                wp = (wp & !w) | gap;
            } else {
                bp = (bp & !b) | gap;
            }
            let r = sets[f - d * 3usize.pow(i as u32)];
            start[0] |= r.w_king & !gap;
            start[1] |= r.b_king & !gap;
            start[2] |= r.w_take;
            start[3] |= r.b_take;
            start[4] |= r.w_bish & !gap;
            start[5] |= r.b_bish & !gap;
        }
        let o = Level {
            pawns: Some((wp, bp)),
            v,
            start: Some(start),
            ..Level::default()
        };
        let Some(s) = level(p, frozen, &o) else {
            return if f == 0 {
                Family::Refuted
            } else {
                Family::None
            };
        };
        // The pairs that stay: both pawns must never move.
        let mut q = f;
        for &(_, w, b) in &pairs {
            if q % 3 == 0 && (w & !s.w_fixed) | (b & !s.b_fixed) != 0 {
                return Family::None;
            }
            q /= 3;
        }
        if net_leaks(p, &s, white, 0) {
            return if f == 0 {
                Family::Refuted
            } else {
                Family::None
            };
        }
        sets.push(s);
    }
    Family::Lock
}

/// With knights, rooks or queens on the board: every one of them must be boxed in by its own pawns
/// and pieces (bishops and the king among them: the level checks that they never move); then the
/// levels, with the boxed pieces as walls and no flight onto their squares.
fn boxed_lock(p: &Pieces, white: bool, wx: Set, bx: Set) -> bool {
    let w_king = if king_wall(p, true) { p.white_king } else { 0 };
    let b_king = if king_wall(p, false) { p.black_king } else { 0 };
    let ws = box_steps(
        p.white_knights,
        p.white_rooks | p.white_queens,
        p.white_queens,
        p.white_pawns | wx | p.white_bishops | w_king,
    );
    let bs = box_steps(
        p.black_knights,
        p.black_rooks | p.black_queens,
        p.black_queens,
        p.black_pawns | bx | p.black_bishops | b_king,
    );
    let (Some(ws), Some(bs)) = (ws, bs) else {
        return false;
    };
    if p.en_passant {
        return false;
    }
    let o = Level {
        wx,
        bx,
        ws,
        bs,
        ..Level::default()
    };
    levels(p, wx | p.white_bishops, bx | p.black_bishops)
        .into_iter()
        .any(|frozen| level(p, frozen, &o).is_some_and(|s| !net_leaks(p, &s, white, wx | bx)))
}

/// The step squares of one side's knights, rooks (and queens: o) and queens, or None when one of
/// them is not held by its own men (own).
fn box_steps(knights: Set, o: Set, queens: Set, own: Set) -> Option<Set> {
    let s = sideways(o) | north(o) | south(o) | diagonal(queens) | knight(knights);
    if s & !own == 0 {
        Some(s)
    } else {
        None
    }
}

/// The stuck mater: the flagged side is to move and, whatever it plays, the mater has no legal move
/// left (kings and pawns only): the game ends at the mater's turn.
fn stuck_mater(p: &Pieces, white: bool) -> bool {
    if p.white_to_move != white || p.en_passant {
        return false;
    }
    if p.white_bishops
        | p.black_bishops
        | p.white_knights
        | p.black_knights
        | p.white_rooks
        | p.black_rooks
        | p.white_queens
        | p.black_queens
        != 0
    {
        return false;
    }
    let (fp, mp) = if white {
        (p.white_pawns, p.black_pawns)
    } else {
        (p.black_pawns, p.white_pawns)
    };
    let (fk, mk) = if white {
        (p.white_king, p.black_king)
    } else {
        (p.black_king, p.white_king)
    };
    let occ = fp | mp | fk | mk;
    let fwd = |s: Set| if white { north(s) } else { south(s) }; // ahead, for the flagged side
    let back = |s: Set| if white { south(s) } else { north(s) }; // behind
                                                                 // A mater's pawn with an empty square ahead is never stuck; then only a stalemate now is left
                                                                 // to find, which a flagged pawn's push rules out.
    if back(mp) & !occ != 0 && fwd(fp) & !occ != 0 {
        return false;
    }
    let (f_attack, m_attack) = (sideways(fwd(fp)), sideways(back(mp)));
    if f_attack & (mp | mk) != 0 {
        return false; // 1. the flagged side has no capture
    }
    let single = fwd(fp) & !occ;
    let double = fwd(single & if white { RANK_3 } else { RANK_6 }) & !occ;
    let pushes = single | double;
    let near = steps(mk);
    let king_to = steps(fk) & !fp & !m_attack & !near; // the flagged king's steps now
    let in_check = fk & m_attack != 0;
    if in_check && king_to == 0 {
        return false; // mated now
    }
    let stays = pushes != 0 && !in_check; // a pawn may move instead of the king
    if king_to == 0 && !stays {
        return true; // no move, no check: stalemate now
    }
    // The squares next to every square the flagged king may stand on after its move.
    let mut cover = if stays { steps(fk) } else { !0 };
    let mut k = king_to;
    while k != 0 {
        cover &= steps(k & k.wrapping_neg());
        k &= k - 1;
    }
    // 2. the mater's pawns are blocked by men that stay, and attack no flagged pawn
    let blockers = fp | mp | mk | if king_to == 0 { fk } else { 0 };
    if (back(mp) & !blockers) | (m_attack & fp) != 0 {
        return false;
    }
    // 3. every square next to the mater's king: its own pawn, attacked by a flagged pawn that
    //    cannot move now, or next to the flagged king wherever it goes
    let still = fp & back(fwd(fp) & occ);
    if near & !(mp | sideways(fwd(still)) | cover) != 0 {
        return false;
    }
    // 4. no push lands where a mater's pawn attacks or next to its king, nor lets it take en passant
    (pushes & (m_attack | near)) | (double & sideways(mp)) == 0
}

/// The forced step: the side to move is in a pawn's check, with kings and pawns only, and its one
/// legal move is a step of its king. The position after it, or None.
fn forced_step(p: &Pieces) -> Option<Pieces> {
    if p.en_passant
        || p.white_bishops
            | p.black_bishops
            | p.white_knights
            | p.black_knights
            | p.white_rooks
            | p.black_rooks
            | p.white_queens
            | p.black_queens
            != 0
    {
        return None;
    }
    let white = p.white_to_move;
    let (k, ek) = if white {
        (p.white_king, p.black_king)
    } else {
        (p.black_king, p.white_king)
    };
    let (own, enemy) = if white {
        (p.white_pawns, p.black_pawns)
    } else {
        (p.black_pawns, p.white_pawns)
    };
    let checkers = (if white {
        sideways(north(k))
    } else {
        sideways(south(k))
    }) & enemy;
    if checkers == 0 {
        return None;
    }
    let attacked = if white {
        sideways(south(enemy))
    } else {
        sideways(north(enemy))
    };
    let to = steps(k) & !own & !attacked & !steps(ek);
    if count(to) != 1 {
        return None;
    }
    if (if white {
        sideways(south(checkers))
    } else {
        sideways(north(checkers))
    }) & own
        != 0
    {
        return None; // a pawn may take instead
    }
    let mut q = Pieces {
        white_to_move: !white,
        en_passant: false,
        ..*p
    };
    if white {
        q.white_king = to;
        q.black_pawns &= !to;
    } else {
        q.black_king = to;
        q.white_pawns &= !to;
    }
    Some(q)
}
