//! The stuck mater, move by move (the second version; `stuckEvery` in src/lock.js): with the
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
//!
//! And the other way round, the stalemated flagged side (`tempoStalemate`): whatever the mater
//! plays, the flagged side (a king and pawns) is left without a legal move and not in check, a
//! stalemate. With the mater to move, the stuck mater's test with the roles swapped and every move
//! also kept from giving check (quiet); with the flagged side to move, it must have exactly one
//! legal move, and the same holds after it.

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
/// With `quiet`, a move that gives check counts as one that leaves the mater a move.
#[inline(always)]
#[allow(clippy::too_many_arguments)]
fn after_move(b: &[u64; 16], flagged: u8, from: usize, to: usize, ty: u8, now: u8, double: bool, epcap: bool, quiet: bool) -> bool {
    let mater = flagged ^ WHITE;
    let mw = mater == WHITE;
    let mut nb = *b;
    let (fb, tb) = (1u64 << from, 1u64 << to);
    nb[(flagged | ty) as usize] ^= fb;
    nb[flagged as usize] ^= fb;
    // a capture takes a mater pawn (en passant: the one beside the double-stepped square)
    let cap = if epcap { if mw { tb << 8 } else { tb >> 8 } } else { tb & nb[mater as usize] };
    nb[(mater | PAWN) as usize] &= !cap;
    nb[mater as usize] &= !cap;
    nb[(flagged | now) as usize] |= tb;
    nb[flagged as usize] |= tb;
    if mater_can_move(&nb, flagged, if double { (from + to) / 2 } else { 64 }) { return true; }
    if !quiet { return false; }
    // quiet: the move must not give check either (a check without an answer would be a mate)
    attack_set(&nb, flagged, nb[0] | nb[8]) & nb[(mater | KING) as usize] != 0
}

/// With `flagged` to move and the mater a king and pawns: does every legal move of the flagged side
/// leave the mater without a legal move? (No legal move now: true when it is a stalemate, false
/// when a mate.) (stuckEvery)
pub fn stuck_every(pos: &Position, flagged: u8) -> bool { stuck_every_bb(&pos.bb, pos.side, pos.castling, pos.ep, flagged, false).0 }

/// stuck_every on the bitboards `b`, `side` to move, with the castling rights and the en passant
/// square given. With `quiet` (the stalemated flagged side, the roles swapped): must every move also
/// give no check, a stalemate each? Then the quick refusals are left out and a double check is
/// answered exactly, so the answer is exact; no legal move now is true (the game is over, and the
/// side not to move was not mated). Returns the answer and whether the side to move had a legal
/// move (when the answer is true).
fn stuck_every_bb(b: &[u64; 16], side: u8, castling: u8, ep: i32, flagged: u8, quiet: bool) -> (bool, bool) {
    if side != flagged { return (false, false); }
    let t = tables();
    let mater = flagged ^ WHITE;
    let (mw, fw) = (mater == WHITE, flagged == WHITE);
    let (mp, mk) = (b[(mater | PAWN) as usize], b[(mater | KING) as usize]);
    if b[mater as usize] != mp | mk { return (false, false); }
    if castling & (if fw { 3 } else { 12 }) != 0 { return (false, false); }
    let occ = b[0] | b[8];
    let ma = pawn_attacks(mp, mw);
    // two mater pawns with an empty square ahead, two flagged men a mater pawn can take: no single move mends either
    if !quiet {
        let ahead = if mw { mp << 8 } else { mp >> 8 };
        if (ahead & !occ).count_ones() >= 2 { return (false, false); }
        if (ma & b[flagged as usize]).count_ones() >= 2 { return (false, false); }
    }
    let fkb = b[(flagged | KING) as usize];
    let (fk, mki) = (lsb(fkb), lsb(mk));
    let mat = ma | t.king[mki];
    // a pawn's check on the flagged king: then its steps and the captures of the checking pawn
    let ck = pawn_attacks(fkb, fw) & mp;
    let check = ck != 0;
    let double = ck.count_ones() >= 2;
    if double && !quiet { return (false, false); }
    // in check only the king's steps and the captures of the checking pawn (in a double check, the steps only)
    let mask = if check { if double { 0 } else { ck } } else { !0 };
    let own = b[flagged as usize];
    let mut any = false;
    // the king
    let mut tg = t.king[fk] & !own & !mat;
    while tg != 0 { let to = lsb(tg); tg &= tg - 1; any = true; if after_move(b, flagged, fk, to, KING, KING, false, false, quiet) { return (false, true); } }
    // knights, bishops, rooks, queens
    for ty in [KNIGHT, BISHOP, ROOK, QUEEN] {
        let mut ps = b[(flagged | ty) as usize];
        while ps != 0 {
            let from = lsb(ps); ps &= ps - 1;
            let mut tg = match ty { KNIGHT => t.knight[from], BISHOP => t.bishop_attacks(from, occ), ROOK => t.rook_attacks(from, occ),
                                    _ => t.bishop_attacks(from, occ) | t.rook_attacks(from, occ) } & !own & mask;
            while tg != 0 { let to = lsb(tg); tg &= tg - 1; any = true; if after_move(b, flagged, from, to, ty, ty, false, false, quiet) { return (false, true); } }
        }
    }
    // the pawns: pushes (none in check), captures, en passant (in check only of the checking pawn)
    let epb = if ep != NO_SQUARE { 1u64 << ep } else { 0 };
    let ok_ep = if check && epb != 0 { let v = if fw { epb >> 8 } else { epb << 8 }; if !double && v & ck != 0 { epb } else { 0 } } else { epb };
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
                for now in [QUEEN, ROOK, BISHOP, KNIGHT] { if after_move(b, flagged, from, to, PAWN, now, false, false, quiet) { return (false, true); } }
            } else if after_move(b, flagged, from, to, PAWN, PAWN, tb & two != 0, tb & epc != 0, quiet) { return (false, true); }
        }
    }
    (quiet || any || !check, any)
}

/// The legal moves of a side of a king and pawns, to move, with the bitboards `b` and the en
/// passant square `ep`: counted up to two (a promotion counts four), and the first one (from, to, a
/// double step, an en passant capture). Exact as mater_can_move is: pins along the lines to the
/// king, checks answered by the king, by taking the checking man or by stepping between; only an
/// en passant capture is counted even where it would uncover a check (one move too many refuses a
/// proof, never makes one). (kpMoves)
fn kp_moves(b: &[u64; 16], side: u8, ep: i32) -> (u32, usize, usize, bool, bool) {
    let t = tables();
    let opp = side ^ WHITE;
    let sw = side == WHITE;
    let (sp, sk) = (b[(side | PAWN) as usize], b[(side | KING) as usize]);
    let occ = b[0] | b[8];
    let k = lsb(sk);
    let mut n = 0u32;
    let mut first = (0usize, 0usize, false, false);
    let mut one = |n: &mut u32, from: usize, to: usize, d: bool, e: bool| { if *n == 0 { first = (from, to, d, e); } *n += 1; };
    // the king: a step to a square the other side neither attacks nor defends (its sliders see through the king)
    let steps = t.king[k] & !b[side as usize];
    if steps != 0 {
        let mut tg = steps & !attack_set(b, opp, occ & !sk);
        while tg != 0 {
            let to = lsb(tg); tg &= tg - 1;
            one(&mut n, k, to, false, false);
            if n >= 2 { return (n, first.0, first.1, first.2, first.3); }
        }
    }
    if sp != 0 {
        // checks on the king, and the squares that answer one
        let diag = b[(opp | BISHOP) as usize] | b[(opp | QUEEN) as usize];
        let orth = b[(opp | ROOK) as usize] | b[(opp | QUEEN) as usize];
        let checkers = (pawn_attacks(sk, sw) & b[(opp | PAWN) as usize]) | (t.knight[k] & b[(opp | KNIGHT) as usize])
            | (t.bishop_attacks(k, occ) & diag) | (t.rook_attacks(k, occ) & orth);
        let checks = checkers.count_ones();
        if checks >= 2 { return (n, first.0, first.1, first.2, first.3); }
        let evade = if checks == 1 { t.between[k][lsb(checkers)] | checkers } else { !0 };
        // pins: a slider of the other side on a line through the king with one man between, a pawn of this side
        let mut pinned = 0u64;
        let mut pins = [(0u64, 0u64); 8];
        let mut np = 0;
        let mut s = (t.bishop_attacks(k, 0) & diag) | (t.rook_attacks(k, 0) & orth);
        while s != 0 {
            let q = lsb(s); s &= s - 1;
            let bl = t.between[k][q] & occ;
            if bl.count_ones() == 1 && bl & sp != 0 { pinned |= bl; pins[np] = (bl, t.line[k][q]); np += 1; }
        }
        // the pawns
        let x = b[opp as usize];
        let epb = if ep != NO_SQUARE { 1u64 << ep } else { 0 };
        let mut ps = sp;
        while ps != 0 {
            let p = lsb(ps); ps &= ps - 1;
            let pb = 1u64 << p;
            let push = (if sw { pb << 8 } else { pb >> 8 }) & !occ;
            let start = if sw { 0x0000_0000_0000_ff00u64 } else { 0x00ff_0000_0000_0000u64 };
            let two = if pb & start != 0 { (if sw { push << 8 } else { push >> 8 }) & !occ } else { 0 };
            let atk = pawn_attacks(pb, sw);
            let mut m = push | two | (atk & x);
            let mut e = atk & epb;
            if pinned & pb != 0 {
                let line = pins[..np].iter().find(|y| y.0 == pb).map_or(!0, |y| y.1);
                m &= line; e &= line;
            }
            m &= evade;
            // en passant answers a check by the double-stepped pawn too
            if e != 0 && checks != 0 {
                let victim = if sw { e >> 8 } else { e << 8 };
                if checkers & victim == 0 && evade & e == 0 { e = 0; }
            }
            while m != 0 {
                let to = lsb(m); m &= m - 1;
                if !(8..56).contains(&to) { one(&mut n, p, to, false, false); n += 3; }   // the four promotions
                else { one(&mut n, p, to, (1u64 << to) & two != 0, false); }
                if n >= 2 { return (n, first.0, first.1, first.2, first.3); }
            }
            if e != 0 { one(&mut n, p, lsb(e), false, true); if n >= 2 { return (n, first.0, first.1, first.2, first.3); } }
        }
    }
    (n, first.0, first.1, first.2, first.3)
}

/// The stalemated flagged side: with the mater to move, has it a legal move, and does each leave the
/// flagged side (a king and pawns) without a legal move and not in check? With the flagged side to
/// move: has it exactly one legal move, after which every move of the mater's (if any) does that?
/// Kings, pawns and the mater's bishops only, and no en passant right. (tempoStalemate)
pub fn tempo_stalemate(pos: &Position, flagged: u8) -> bool {
    let b = &pos.bb;
    let mater = flagged ^ WHITE;
    // the flagged side a king and pawns, the mater without a knight, rook or queen, no en passant right
    if b[flagged as usize] != b[(flagged | PAWN) as usize] | b[(flagged | KING) as usize] { return false; }
    if b[(mater | KNIGHT) as usize] | b[(mater | ROOK) as usize] | b[(mater | QUEEN) as usize] != 0 { return false; }
    if pos.ep != NO_SQUARE { return false; }
    if pos.side != flagged { let (stalemates, any) = stuck_every_bb(b, pos.side, pos.castling, NO_SQUARE, mater, true); return stalemates && any; }
    let (n, from, to, double, ep) = kp_moves(b, flagged, NO_SQUARE);
    if n != 1 { return false; }
    // the position after the one move, the mater to move
    let mut nb = *b;
    let (fb, tb) = (1u64 << from, 1u64 << to);
    let ty = if b[(flagged | KING) as usize] & fb != 0 { KING } else { PAWN };
    let victim = if ep { if flagged == WHITE { tb >> 8 } else { tb << 8 } } else { tb & b[mater as usize] };
    for t in [PAWN, BISHOP] { nb[(mater | t) as usize] &= !victim; }
    nb[mater as usize] &= !victim;
    nb[(flagged | ty) as usize] ^= fb | tb;
    nb[flagged as usize] ^= fb | tb;
    stuck_every_bb(&nb, mater, pos.castling, if double { ((from + to) / 2) as i32 } else { NO_SQUARE }, mater, true).0
}
