//! The stuck mater, move by move (the second version; `stuckEvery` in src/ladder.js): with the
//! flagged side to move and a mater of a king and pawns only, does every legal move of the flagged
//! side leave the mater without a legal move? Then the game ends at the mater's turn (a stalemate,
//! or a mate of the mater) and the flagged side is never mated. Decided on the bitboards: no move
//! is made and no position searched. With a mater of a king and pawns no flagged man is pinned,
//! and the flagged king's steps are exact; in a pawn's check the flagged side has those steps and
//! the captures of the checking pawn. For each move the bitboards after it are written out and the
//! mater's legal moves looked for (pins and checks counted; an en passant capture counted even
//! where a horizontal pin forbids it, so that "stuck" is always right). No answer (false) with a
//! castling right of the flagged side's, two mater pawns with an empty square ahead, or two flagged
//! men a mater pawn can take.

use crate::board::{lsb, sideways, tables, Position, BISHOP, KING, KNIGHT, NO_SQUARE, PAWN, QUEEN, ROOK, WHITE};

#[inline(always)]
fn pawn_attacks(p: u64, white: bool) -> u64 { if white { sideways(p << 8) } else { sideways(p >> 8) } }

/// Every square colour `by` attacks or defends with the bitboards `b`, the board occupied as `occ`.
#[inline(always)]
fn attack_set(b: &[u64; 16], by: u8, occ: u64) -> u64 {
    let t = tables();
    let mut a = pawn_attacks(b[(by | PAWN) as usize], by == WHITE) | t.king[lsb(b[(by | KING) as usize])];
    let mut n = b[(by | KNIGHT) as usize];
    while n != 0 { let s = lsb(n); n &= n - 1; a |= t.knight[s]; }
    let mut d = b[(by | BISHOP) as usize] | b[(by | QUEEN) as usize];
    while d != 0 { let s = lsb(d); d &= d - 1; a |= t.bishop_attacks(s, occ); }
    let mut r = b[(by | ROOK) as usize] | b[(by | QUEEN) as usize];
    while r != 0 { let s = lsb(r); r &= r - 1; a |= t.rook_attacks(s, occ); }
    a
}

/// Has the mater (a king and pawns, to move) a legal move, with the bitboards `nb` after a flagged
/// move? `ep`: the square behind a flagged double step (64: none). (materCanMove)
fn mater_can_move(nb: &[u64; 16], flagged: u8, ep: usize) -> bool {
    let t = tables();
    let mater = flagged ^ WHITE;
    let mw = mater == WHITE;
    let (mp, mk) = (nb[(mater | PAWN) as usize], nb[(mater | KING) as usize]);
    let occ = nb[0] | nb[8];
    let k = lsb(mk);
    // the king: a step to a square the flagged side neither attacks nor defends
    let free = t.king[k] & !nb[mater as usize];
    if free != 0 && free & !attack_set(nb, flagged, occ & !mk) != 0 { return true; }
    if mp == 0 { return false; }
    // checks on the mater's king, and the squares that answer one
    let diag = nb[(flagged | BISHOP) as usize] | nb[(flagged | QUEEN) as usize];
    let orth = nb[(flagged | ROOK) as usize] | nb[(flagged | QUEEN) as usize];
    let checkers = (pawn_attacks(mk, mw) & nb[(flagged | PAWN) as usize]) | (t.knight[k] & nb[(flagged | KNIGHT) as usize])
        | (t.bishop_attacks(k, occ) & diag) | (t.rook_attacks(k, occ) & orth);
    let checks = checkers.count_ones();
    if checks >= 2 { return false; }
    let evade = if checks == 1 { t.between[k][lsb(checkers)] | checkers } else { !0 };
    // pins: a flagged slider on a line through the king with one man between, a mater pawn
    let mut pinned = 0u64;
    let mut pins = [(0u64, 0u64); 8];   // (the pinned pawn, its line)
    let mut np = 0;
    let mut s = (t.bishop_attacks(k, 0) & diag) | (t.rook_attacks(k, 0) & orth);
    while s != 0 {
        let q = lsb(s); s &= s - 1;
        let bl = t.between[k][q] & occ;
        if bl.count_ones() == 1 && bl & mp != 0 { pinned |= bl; pins[np] = (bl, t.line[k][q]); np += 1; }
    }
    // the pawns
    let epb = if ep < 64 { 1u64 << ep } else { 0 };
    let mut ps = mp;
    while ps != 0 {
        let pb = 1u64 << lsb(ps); ps &= ps - 1;
        let one = (if mw { pb << 8 } else { pb >> 8 }) & !occ;
        let start = if mw { 0x0000_0000_0000_ff00u64 } else { 0x00ff_0000_0000_0000u64 };
        let two = if pb & start != 0 { (if mw { one << 8 } else { one >> 8 }) & !occ } else { 0 };
        let atk = pawn_attacks(pb, mw);
        let mut tg = one | two | (atk & nb[flagged as usize]);
        let mut epc = atk & epb;
        if pinned & pb != 0 {
            let line = pins[..np].iter().find(|x| x.0 == pb).map_or(!0, |x| x.1);
            tg &= line; epc &= line;
        }
        tg &= evade;
        // en passant answers a check by the double-stepped pawn too
        if epc != 0 && checks != 0 {
            let victim = if mw { epc >> 8 } else { epc << 8 };
            if checkers & victim == 0 && evade & epc == 0 { epc = 0; }
        }
        if tg | epc != 0 { return true; }
    }
    false
}

/// One flagged move from → to by a man of type `ty`, which stands on `to` as `now`; `double` a
/// pawn's double step, `epcap` an en passant capture. Does the mater have a legal move after it?
#[inline(always)]
#[allow(clippy::too_many_arguments)]
fn after_move(pos: &Position, flagged: u8, from: usize, to: usize, ty: u8, now: u8, double: bool, epcap: bool) -> bool {
    let mater = flagged ^ WHITE;
    let mw = mater == WHITE;
    let mut nb = pos.bb;
    let (fb, tb) = (1u64 << from, 1u64 << to);
    nb[(flagged | ty) as usize] ^= fb;
    nb[flagged as usize] ^= fb;
    // a capture takes a mater pawn (en passant: the one beside the double-stepped square)
    let cap = if epcap { if mw { tb << 8 } else { tb >> 8 } } else { tb & nb[mater as usize] };
    nb[(mater | PAWN) as usize] &= !cap;
    nb[mater as usize] &= !cap;
    nb[(flagged | now) as usize] |= tb;
    nb[flagged as usize] |= tb;
    mater_can_move(&nb, flagged, if double { (from + to) / 2 } else { 64 })
}

/// With `flagged` to move and the mater a king and pawns: does every legal move of the flagged side
/// leave the mater without a legal move? (No legal move now: true when it is a stalemate, false
/// when a mate.) (stuckEvery)
pub fn stuck_every(pos: &Position, flagged: u8) -> bool {
    if pos.side != flagged { return false; }
    let t = tables();
    let b = &pos.bb;
    let mater = flagged ^ WHITE;
    let (mw, fw) = (mater == WHITE, flagged == WHITE);
    let (mp, mk) = (b[(mater | PAWN) as usize], b[(mater | KING) as usize]);
    if b[mater as usize] != mp | mk { return false; }
    if pos.castling & (if fw { 3 } else { 12 }) != 0 { return false; }
    let occ = b[0] | b[8];
    // two mater pawns with an empty square ahead, two flagged men a mater pawn can take: no single move mends either
    let ahead = if mw { mp << 8 } else { mp >> 8 };
    if (ahead & !occ).count_ones() >= 2 { return false; }
    let ma = pawn_attacks(mp, mw);
    if (ma & b[flagged as usize]).count_ones() >= 2 { return false; }
    let fkb = b[(flagged | KING) as usize];
    let (fk, mki) = (lsb(fkb), lsb(mk));
    let mat = ma | t.king[mki];
    // a pawn's check on the flagged king: then its steps and the captures of the checking pawn
    let ck = pawn_attacks(fkb, fw) & mp;
    let check = ck != 0;
    if ck.count_ones() >= 2 { return false; }
    let mask = if check { ck } else { !0 };
    let own = b[flagged as usize];
    let mut any = false;
    // the king
    let mut tg = t.king[fk] & !own & !mat;
    while tg != 0 { let to = lsb(tg); tg &= tg - 1; any = true; if after_move(pos, flagged, fk, to, KING, KING, false, false) { return false; } }
    // knights, bishops, rooks, queens
    for ty in [KNIGHT, BISHOP, ROOK, QUEEN] {
        let mut ps = b[(flagged | ty) as usize];
        while ps != 0 {
            let from = lsb(ps); ps &= ps - 1;
            let mut tg = match ty { KNIGHT => t.knight[from], BISHOP => t.bishop_attacks(from, occ), ROOK => t.rook_attacks(from, occ),
                                    _ => t.bishop_attacks(from, occ) | t.rook_attacks(from, occ) } & !own & mask;
            while tg != 0 { let to = lsb(tg); tg &= tg - 1; any = true; if after_move(pos, flagged, from, to, ty, ty, false, false) { return false; } }
        }
    }
    // the pawns: pushes (none in check), captures, en passant (in check only of the checking pawn)
    let epb = if pos.ep != NO_SQUARE { 1u64 << pos.ep } else { 0 };
    let ok_ep = if check && epb != 0 { let v = if fw { epb >> 8 } else { epb << 8 }; if v & ck != 0 { epb } else { 0 } } else { epb };
    let mut ps = b[(flagged | PAWN) as usize];
    while ps != 0 {
        let from = lsb(ps); ps &= ps - 1;
        let pb = 1u64 << from;
        let (mut one, mut two) = (0u64, 0u64);
        if !check {
            one = (if fw { pb << 8 } else { pb >> 8 }) & !occ;
            let start = if fw { 0x0000_0000_0000_ff00u64 } else { 0x00ff_0000_0000_0000u64 };
            if pb & start != 0 { two = (if fw { one << 8 } else { one >> 8 }) & !occ; }
        }
        let atk = pawn_attacks(pb, fw);
        let cp = atk & b[mater as usize] & mask;
        let epc = atk & ok_ep;
        let mut tg = one | two | cp | epc;
        while tg != 0 {
            let to = lsb(tg); tg &= tg - 1; any = true;
            let tb = 1u64 << to;
            if !(8..56).contains(&to) {
                for now in [QUEEN, ROOK, BISHOP, KNIGHT] { if after_move(pos, flagged, from, to, PAWN, now, false, false) { return false; } }
            } else if after_move(pos, flagged, from, to, PAWN, PAWN, tb & two != 0, tb & epc != 0) { return false; }
        }
    }
    any || !check
}
