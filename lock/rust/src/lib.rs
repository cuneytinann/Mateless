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

type Set = u64;

const FILE_A: Set = 0x0101010101010101;
const FILE_H: Set = 0x8080808080808080;
const RANK_1: Set = 0x00000000000000FF;
const RANK_8: Set = 0xFF00000000000000;
const DARK: Set = 0xAA55AA55AA55AA55; // the dark squares; a1 is dark

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
/// the squares diagonally next to s
fn diagonal(s: Set) -> Set {
    sideways(north(s) | south(s))
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

/// What the lock detector reads from a position.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Pieces {
    pub white_pawns: u64,
    pub black_pawns: u64,
    pub white_king: u64,
    pub black_king: u64,
    pub white_bishops: u64,
    pub black_bishops: u64,
    /// knights, rooks and queens of both sides
    pub others: u64,
    /// the side to move can capture en passant
    pub en_passant: bool,
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
            _ => p.others |= sq, // N R Q n r q
        }
    }
    let mut rest = rest.trim_start_matches(' ');
    let white_to_move = !rest.starts_with('b');
    // past the side to move and castling
    for _field in 0..2 {
        rest = rest
            .trim_start_matches(|c| c != ' ')
            .trim_start_matches(' ');
    }
    if let [f @ b'a'..=b'h', r @ b'1'..=b'8', ..] = *rest.as_bytes() {
        let target: Set = 1 << ((f - b'a') + 8 * (r - b'1'));
        p.en_passant = if white_to_move {
            sideways(south(target)) & p.white_pawns != 0
        } else {
            sideways(north(target)) & p.black_pawns != 0
        };
    }
    p
}

/// Two bishops on squares of one colour (only a promotion makes them).
fn twin_bishops(b: Set) -> bool {
    count(b & DARK) > 1 || count(b & !DARK) > 1
}

/// Can White (`white` = true) or Black never be mated, by the lock detector?
pub fn cannot_be_mated(p: &Pieces, white: bool) -> bool {
    if p.others != 0 || p.en_passant {
        return false;
    }
    if twin_bishops(p.white_bishops) || twin_bishops(p.black_bishops) {
        return false;
    }
    if !leaks(p, white, 0) {
        return true;
    }
    // A king may be frozen only if every square around it is held or attacked by a pawn.
    let held =
        p.white_pawns | p.black_pawns | sideways(north(p.white_pawns) | south(p.black_pawns));
    for king in [p.white_king, p.black_king] {
        if zone(king) & !king & !held == 0 && !leaks(p, white, king) {
            return true;
        }
    }
    false
}

/// Does the structure leak to the king asked about, with the king `frozen` frozen (0: none)?
fn leaks(p: &Pieces, white: bool, frozen: Set) -> bool {
    let (wp, bp, wk, bk) = (p.white_pawns, p.black_pawns, p.white_king, p.black_king);
    let frozen_white = frozen & wk != 0;
    let frozen_black = !frozen_white && frozen != 0;
    let near_frozen_black = if frozen_black { zone(bk) } else { 0 };
    let near_frozen_white = if frozen_white { zone(wk) } else { 0 };

    // Quick: the pawns' paths against the first walls already show a promotion or a capture.
    let w_cone = fill_north(wp, !((bp & !wk) | frozen));
    let b_cone = fill_south(bp, !((wp & !bk) | frozen));
    if (w_cone & RANK_8) | (b_cone & RANK_1) | (north(sideways(w_cone)) & b_cone) != 0 {
        return true;
    }

    // The cycle: walls -> pawns that can never move -> king reaches -> capture squares -> walls.
    let (mut w_fixed, mut b_fixed) = (wp, bp); // pawns that can never move      (shrink)
    let (mut w_king, mut b_king) = (wk, bk); // squares each king may reach    (grow)
    let (mut w_take, mut b_take) = (wk, bk); // squares where a side may take an enemy pawn (grow)
    let (mut w_wall, mut b_wall): (Set, Set) = (!0, !0); // pawns the other side can never take, and the frozen king
    loop {
        let (last_w_wall, last_b_wall) = (w_wall, b_wall);
        w_wall = (wp & !b_take) | frozen;
        b_wall = (bp & !w_take) | frozen;
        let new_w_fixed = w_fixed & w_wall & south(b_wall | w_fixed);
        let new_b_fixed = b_fixed & b_wall & north(w_wall | b_fixed);
        if w_wall == last_w_wall
            && b_wall == last_b_wall
            && new_w_fixed == w_fixed
            && new_b_fixed == b_fixed
        {
            break;
        }
        // Both kings' reaches, flooded: never onto a fixed pawn, a square it attacks, or next to
        // the frozen king.
        let w_mask = !(new_w_fixed | sideways(south(new_b_fixed)) | near_frozen_black);
        let b_mask = !(new_b_fixed | sideways(north(new_w_fixed)) | near_frozen_white);
        let (mut new_w_king, mut new_b_king) = (w_king, b_king);
        loop {
            let a = new_w_king | (zone(new_w_king) & w_mask);
            let d = new_b_king | (zone(new_b_king) & b_mask);
            if a == new_w_king && d == new_b_king {
                break;
            }
            new_w_king = a;
            new_b_king = d;
        }
        if (frozen_white && new_w_king != wk) || (frozen_black && new_b_king != bk) {
            return true; // the frozen king can move
        }
        // A side may take a pawn where its king goes, and on any square a pawn may walk into.
        let mut t = b_take | new_b_king;
        let new_b_take = t | south(fill_south(t & !b_wall, !b_wall));
        t = w_take | new_w_king;
        let new_w_take = t | north(fill_north(t & !w_wall, !w_wall));
        let changed = new_w_fixed != w_fixed
            || new_b_fixed != b_fixed
            || new_w_king != w_king
            || new_b_king != b_king
            || new_w_take != w_take
            || new_b_take != b_take;
        (w_fixed, b_fixed, w_king, b_king) = (new_w_fixed, new_b_fixed, new_w_king, new_b_king);
        (w_take, b_take) = (new_w_take, new_b_take);
        if !changed {
            break;
        }
    }

    // The pawns' cones: every square they may still reach.
    let w_cone = fill_north(wp, !b_wall);
    let b_cone = fill_south(bp, !w_wall);
    if (w_cone & RANK_8) | (b_cone & RANK_1) != 0 {
        return true; // a pawn can promote
    }
    if north(sideways(w_cone)) & b_cone != 0 {
        return true; // a pawn can capture
    }
    // The bishops' reaches: every square they may reach, around the fixed pawns.
    let (mut w_bish, mut b_bish, open) = (p.white_bishops, p.black_bishops, !(w_fixed | b_fixed));
    loop {
        let a = w_bish | (diagonal(w_bish) & open);
        let d = b_bish | (diagonal(b_bish) & open);
        if a == w_bish && d == b_bish {
            break;
        }
        w_bish = a;
        b_bish = d;
    }
    if (diagonal(w_bish) & b_cone) | (diagonal(b_bish) & w_cone) != 0 {
        return true; // a bishop meets a pawn's path
    }

    // The mating net: can the other side's pawns and bishops catch the king asked about?
    let (attack, reach, free, spare);
    if white {
        attack = diagonal(b_bish) | sideways(south(b_cone));
        reach = w_king;
        free = !(w_cone | zone(b_king) | attack); // never occupied, attacked or next to the mater
        spare = free & !w_bish; // ... nor reached by the king's own bishops
    } else {
        attack = diagonal(w_bish) | sideways(north(w_cone));
        reach = b_king;
        free = !(b_cone | zone(w_king) | attack);
        spare = free & !b_bish;
    }
    // A king next to a spare square, or with free squares beside it both ways, always has a flight.
    let flight = sideways(spare)
        | north(spare)
        | south(spare)
        | ((north(free) | south(free)) & sideways(free));
    attack & reach & !flight != 0
}
