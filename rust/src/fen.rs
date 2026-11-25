//! Reading a FEN: a position some game can reach (fen.js). The outer layer every position from
//! outside comes in through; the ladder never calls it. from_fen reads the FEN (board::read_fen:
//! its syntax, one king a side, no pawn on an edge rank), puts right what can be read only one way
//! (castling rights, an en passant square, the move number: FenRead::fixed), and refuses a
//! position no game of chess or Chess960 can reach, by the known necessary conditions:
//! "oppcheck" (the side not to move is in check), "pawns", "pieces", "promo" (material, bishops
//! by the colour of their squares), "captures" (pawns off their files need more captures than
//! enemy men are missing) and "checks" (no last move of the other side, made back, leaves the
//! side to move out of check). from_fen_with(fen, false) keeps only the first four (the syntax,
//! the kings, the edge ranks, the side not to move out of check).

use crate::board::*;

const LEAPS_N: [(i32, i32); 8] = [(1, 2), (2, 1), (2, -1), (1, -2), (-1, -2), (-2, -1), (-2, 1), (-1, 2)];
const STEPS_K: [(i32, i32); 8] = [(1, 0), (1, 1), (0, 1), (-1, 1), (-1, 0), (-1, -1), (0, -1), (1, -1)];
const RAYS_D: [(i32, i32); 4] = [(1, 1), (1, -1), (-1, 1), (-1, -1)];
const RAYS_S: [(i32, i32); 4] = [(1, 0), (-1, 0), (0, 1), (0, -1)];
#[inline] fn on(f: i32, r: i32) -> bool { (0..8).contains(&f) && (0..8).contains(&r) }
#[inline] fn at(f: i32, r: i32) -> usize { (8 * r + f) as usize }

/// Is square k attacked by colour `by` on the mailbox board b?
fn attacked(b: &[u8; 64], k: usize, by: u8) -> bool {
    let (kf, kr) = ((k & 7) as i32, (k >> 3) as i32);
    for i in 0..8 {
        let (f, r) = (kf + LEAPS_N[i].0, kr + LEAPS_N[i].1);
        if on(f, r) && b[at(f, r)] == by | KNIGHT { return true; }
        let (f, r) = (kf + STEPS_K[i].0, kr + STEPS_K[i].1);
        if on(f, r) && b[at(f, r)] == by | KING { return true; }
    }
    let pr = kr + if by == WHITE { -1 } else { 1 };
    if (0..8).contains(&pr) && ((kf > 0 && b[at(kf - 1, pr)] == by | PAWN) || (kf < 7 && b[at(kf + 1, pr)] == by | PAWN)) { return true; }
    for &(df, dr) in &STEPS_K {
        let slider = if df != 0 && dr != 0 { BISHOP } else { ROOK };
        let (mut f, mut r) = (kf + df, kr + dr);
        while on(f, r) {
            let p = b[at(f, r)];
            if p != 0 { if p == by | QUEEN || p == by | slider { return true; } break; }
            f += df; r += dr;
        }
    }
    false
}

/// A man attacking a square: where it stands, and when it attacks along a line (ray), the squares
/// between as a bitboard.
#[derive(Clone, Copy)]
struct Checker { sq: usize, ray: bool, line: u64 }

/// The men of colour `by` that attack square k on the mailbox board b (at most 16), and how many.
fn attackers(b: &[u8; 64], k: usize, by: u8) -> ([Checker; 16], usize) {
    let (kf, kr) = ((k & 7) as i32, (k >> 3) as i32);
    let mut out = [Checker { sq: 0, ray: false, line: 0 }; 16];
    let mut n = 0;
    let mut add = |sq: usize, ray: bool, line: u64| { if n < 16 { out[n] = Checker { sq, ray, line }; n += 1; } };
    for &(df, dr) in &LEAPS_N { if on(kf + df, kr + dr) && b[at(kf + df, kr + dr)] == by | KNIGHT { add(at(kf + df, kr + dr), false, 0); } }
    for &(df, dr) in &STEPS_K { if on(kf + df, kr + dr) && b[at(kf + df, kr + dr)] == by | KING { add(at(kf + df, kr + dr), false, 0); } }
    let pr = kr + if by == WHITE { -1 } else { 1 };
    for df in [-1, 1] { if on(kf + df, pr) && b[at(kf + df, pr)] == by | PAWN { add(at(kf + df, pr), false, 0); } }
    for &(df, dr) in &STEPS_K {
        let slider = if df != 0 && dr != 0 { BISHOP } else { ROOK };
        let (mut f, mut r, mut line) = (kf + df, kr + dr, 0u64);
        while on(f, r) {
            let p = b[at(f, r)];
            if p != 0 { if p == by | slider || p == by | QUEEN { add(at(f, r), true, line); } break; }
            line |= 1u64 << at(f, r);
            f += df; r += dr;
        }
    }
    (out, n)
}

/// b with the squares set to the pieces: is the king out of check there?
#[inline(never)]
fn quiet(b: &[u8; 64], king: usize, mover: u8, set: &[(usize, u8)]) -> bool {
    let mut c = *b;
    for &(q, p) in set { c[q] = p; }
    !attacked(&c, king, mover)
}

fn count(pos: &Position, i: u8) -> u32 { pos.bb[i as usize].count_ones() }

/// Material: at most 8 pawns and 16 men a side, the men beyond the starting set paid for by
/// missing pawns (bishops by the colour of their squares), and the captures the pawns' files need.
fn material_problem(pos: &Position) -> Option<&'static str> {
    for c in [WHITE, BLACK] {
        let pawns = count(pos, c | PAWN);
        if pawns > 8 { return Some("pawns"); }
        if count(pos, c) > 16 { return Some("pieces"); }
        let dark = (pos.bb[(c | BISHOP) as usize] & DARK_SQUARES).count_ones();
        let light = count(pos, c | BISHOP) - dark;
        let extra = count(pos, c | QUEEN).saturating_sub(1) + count(pos, c | ROOK).saturating_sub(2) + count(pos, c | KNIGHT).saturating_sub(2)
            + light.saturating_sub(1) + dark.saturating_sub(1);
        if extra > 8 - pawns { return Some("promo"); }
    }
    for c in [WHITE, BLACK] {
        let (mut files, mut n) = ([0i64; 8], 0);   // the pawns' files, in order (at most 8: checked above)
        for f in 0..8 { for _ in 0..(pos.bb[(c | PAWN) as usize] & (0x0101_0101_0101_0101u64 << f)).count_ones() { files[n] = f as i64; n += 1; } }
        // row[j]: the fewest file changes for the pawns so far, from the first j starting files
        let mut row = [0i64; 9];
        for i in 1..=n {
            let mut next = [1_000_000_000i64; 9];
            for j in i..=8 { next[j] = next[j - 1].min(row[j - 1] + (files[i - 1] - (j as i64 - 1)).abs()); }
            row = next;
        }
        let need = if n == 0 { 0 } else { row[8] };
        if need > 16 - count(pos, c ^ WHITE) as i64 { return Some("captures"); }
    }
    None
}

/// Did the checks on the side to move come from a last move (checksExplained in fen.js)? ep: the
/// en passant square kept (NO_SQUARE: none); then only the two-square advance it records.
/// quiet_only: only moves that leave the halfmove clock running (a piece's move or castling).
fn checks_explained(b: &[u8; 64], side: u8, ep: i32, quiet_only: bool) -> bool {
    let mover = side ^ WHITE;
    let king = b.iter().position(|&p| p == side | KING).unwrap();
    let up: i32 = if mover == WHITE { 8 } else { -8 };
    let (first, last) = if mover == WHITE { (0i32, 7i32) } else { (7, 0) };
    if ep != NO_SQUARE {
        let (from, to) = ((ep - up) as usize, (ep + up) as usize);
        return quiet(b, king, mover, &[(from, b[to]), (to, 0)]);
    }
    let (checkers, nc) = attackers(b, king, mover);
    let checkers = &checkers[..nc];
    // could the move from s, filling the squares filled, take every check away?
    let helps = |s: usize, filled: u64| checkers.iter().all(|c| c.sq == s || (c.ray && c.line & filled != 0));
    let men = b.iter().filter(|&&p| p != 0 && p & WHITE == side).count();
    let pawns = b.iter().filter(|&&p| p == side | PAWN).count();
    let mover_pawns = b.iter().filter(|&&p| p == mover | PAWN).count();
    let blocker = if men < 16 && !quiet_only { side | KNIGHT } else { 0 };   // a man captured by the last move, put back (any man blocks)
    let (passant, promotion) = (men < 16 && pawns < 8, mover_pawns < 8);   // the pawn taken en passant; the pawn that promoted
    // the piece `moved` came to s from x; s held `captured` (0: nothing)
    let back = |s: usize, x: usize, moved: u8, captured: u8| helps(s, 1u64 << x) && quiet(b, king, mover, &[(x, moved), (s, captured)]);
    for s in 0..64usize {
        let p = b[s];
        if p == 0 || p & WHITE != mover { continue; }
        let (t, sf, sr) = (p & 7, (s & 7) as i32, (s >> 3) as i32);
        let behind = sr - up / 8;
        if t == PAWN {
            if quiet_only { continue; }
            let one = (s as i32 - up) as usize;
            let rel = if mover == WHITE { sr } else { 7 - sr };
            if rel >= 2 && b[one] == 0 && back(s, one, p, 0) { return true; }
            if rel == 3 && b[one] == 0 && b[(one as i32 - up) as usize] == 0 && back(s, (one as i32 - up) as usize, p, 0) { return true; }
            if rel < 2 { continue; }
            for df in [-1i32, 1] {
                if !on(sf + df, behind) { continue; }
                let x = (one as i32 + df) as usize;
                if b[x] != 0 { continue; }
                if blocker != 0 && back(s, x, p, blocker) { return true; }
                if passant && rel == 5 && b[one] == 0 && helps(s, (1u64 << x) | (1u64 << one))
                    && quiet(b, king, mover, &[(x, p), (s, 0), (one, side | PAWN)]) { return true; }
            }
            continue;
        }
        if t == KNIGHT || t == KING {
            for &(df, dr) in if t == KNIGHT { &LEAPS_N } else { &STEPS_K } {
                if !on(sf + df, sr + dr) { continue; }
                let x = at(sf + df, sr + dr);
                if b[x] == 0 && back(s, x, p, blocker) { return true; }
            }
        } else {
            let rays: &[(i32, i32)] = if t == BISHOP { &RAYS_D } else if t == ROOK { &RAYS_S } else { &STEPS_K };
            for &(df, dr) in rays {
                let (mut f, mut r) = (sf + df, sr + dr);
                while on(f, r) && b[at(f, r)] == 0 { if back(s, at(f, r), p, blocker) { return true; } f += df; r += dr; }
            }
        }
        if promotion && !quiet_only && t != KING && sr == last {         // a promotion, by an advance or a capture
            let one = (s as i32 - up) as usize;
            if b[one] == 0 && back(s, one, mover | PAWN, 0) { return true; }
            for df in [-1i32, 1] {
                if blocker != 0 && on(sf + df, behind) && b[(one as i32 + df) as usize] == 0 && back(s, (one as i32 + df) as usize, mover | PAWN, blocker) { return true; }
            }
        }
        if t == KING && sr == first && (sf == 2 || sf == 6) {             // castling: the king beside its rook
            let rook_sq = if sf == 6 { s - 1 } else { s + 1 };
            if b[rook_sq] != mover | ROOK { continue; }
            let base = (8 * first) as usize;
            for kx in 1..=6usize { for rx in 0..=7usize {
                if rx == kx || (if sf == 6 { rx < kx } else { rx > kx }) { continue; }
                let (k_sq, r_sq) = (base + kx, base + rx);
                if (b[k_sq] != 0 && k_sq != s && k_sq != rook_sq) || (b[r_sq] != 0 && r_sq != s && r_sq != rook_sq) { continue; }
                let filled = (1u64 << k_sq) | (1u64 << r_sq);
                if !checkers.iter().all(|c| c.sq == rook_sq || (c.ray && c.line & filled != 0)) { continue; }
                if quiet(b, king, mover, &[(s, 0), (rook_sq, 0), (k_sq, mover | KING), (r_sq, mover | ROOK)]) { return true; }
            } }
        }
    }
    false
}

/// Reads a FEN into a position some game can reach (fromFen in mateless.js); strict: false keeps
/// only the syntax, the kings, the edge ranks and the side not to move out of check.
pub fn from_fen_with(fen: &str, strict: bool) -> Result<FenRead, &'static str> {
    let mut r = read_fen(fen)?;
    let side = r.pos.side;
    if is_attacked(&r.pos, r.pos.king_square(side ^ WHITE), side) { return Err("oppcheck"); }
    if strict {
        if let Some(e) = material_problem(&r.pos) { return Err(e); }
        let mut ep = r.ep_declared;
        let check = in_check(&r.pos);
        if ep != NO_SQUARE || check {
            let b = r.pos.board;
            if ep != NO_SQUARE && !checks_explained(&b, side, ep, false) { ep = NO_SQUARE; r.pos.ep = NO_SQUARE; r.ep_declared = NO_SQUARE; r.fixed |= FIXED_EN_PASSANT; }
            if ep == NO_SQUARE && check && !(r.pos.halfmove > 0 && checks_explained(&b, side, NO_SQUARE, true)) {
                if !checks_explained(&b, side, NO_SQUARE, false) { return Err("checks"); }
                if r.pos.halfmove > 0 {   // only a capture or a pawn move gives these checks: the clock starts again
                    r.pos.halfmove = 0;
                    r.fixed = (r.fixed & !FIXED_FULLMOVE) | FIXED_HALFMOVE;
                    r.fullmove = r.fullmove_read.max(1);
                    if r.fullmove_read < 1 { r.fixed |= FIXED_FULLMOVE; }
                }
            }
        }
    }
    Ok(r)
}

/// Reads a FEN into a position some game can reach (fromFen in mateless.js).
pub fn from_fen(fen: &str) -> Result<Position, &'static str> { from_fen_with(fen, true).map(|r| r.pos) }
