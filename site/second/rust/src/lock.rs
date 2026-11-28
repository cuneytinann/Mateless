//! Rung 2, the lock detector (`src/lock.js`), and the two static tests together: pawns, kings and
//! bishops form a structure that no series of legal moves can open. It reads the bitboards, the
//! side to move and the en passant square only; it generates no move and searches nothing.
//! This is the second version (the second-version branch): open pawn pairs, boxed knights, rooks and
//! queens, twin bishops, and the four rules of kings and pawns (the stalemate guard, the check
//! seed, the stuck mater, the forced step), line for line as in src/lock.js.

use crate::board::{BISHOP, BLACK, DARK_SQUARES, diagonal, FILE_A, FILE_H, KING, KNIGHT, lsb,
    NO_SQUARE, north, PAWN, Position, QUEEN, RANK_1, RANK_8, ROOK, sideways, south, tables, WHITE,
    zone};
use crate::material::material_test;
use crate::stuck::tempo_stalemate;

/// Bits naming the side that is to be proven unable to be mated (the flagged side), for the
/// functions that answer for both sides at once (cannot_mate2, Domino::run2, prove_both): a game's
/// two flags, and a dead position, need both answers.
pub const FLAGGED_WHITE: u8 = 1;
pub const FLAGGED_BLACK: u8 = 2;
/// The bit of `flagged` (WHITE or BLACK).
#[inline(always)]
pub fn flagged_bit(flagged: u8) -> u8 { if flagged == WHITE { FLAGGED_WHITE } else { FLAGGED_BLACK } }


/// Twin bishops (noPairSquares): two bishops of one side on one colour come only from a promotion.
/// The mating net's second flight rule (a free square vertically and one horizontally next to the
/// king) counts on the flagged side having at most one bishop on their colour, which is the colour
/// opposite the king's square: with two there they may hold both flights at once. So for each side,
/// the king squares where that rule is not counted: the light squares if it has two or more bishops
/// on dark squares, the dark ones if on light squares.
#[inline(always)]
fn no_pair_squares(b: u64) -> u64 {
    (if (b & DARK_SQUARES).count_ones() > 1 { !DARK_SQUARES } else { 0 })
        | (if (b & !DARK_SQUARES).count_ones() > 1 { DARK_SQUARES } else { 0 })
}

/// What the lock detector reads of a position: the bitboards, the side to move, the en passant
/// square (a position after the forced step is one of these, not a Position).
#[derive(Clone, Copy)]
/// castling: the castling rights (the boxed pieces' test reads them).
struct View<'a> { bb: &'a [u64; 16], side: u8, ep: i32, castling: u8 }
impl<'a> View<'a> {
    #[inline(always)]
    fn of(pos: &'a Position) -> View<'a> { View { bb: &pos.bb, side: pos.side, ep: pos.ep, castling: pos.castling } }
}

/// The census: the pawns, kings and bishops, the side to move (the check seed reads it), and each
/// side's twin-bishop squares (w_np, b_np).
struct Census { wp: u64, bp: u64, wk: u64, bk: u64, wb: u64, bb: u64, side: u8, w_np: u64, b_np: u64 }

#[inline(always)]
fn census(x: &View) -> Census {
    let b = x.bb;
    let (wb, bb) = (b[(WHITE | BISHOP) as usize], b[(BLACK | BISHOP) as usize]);
    Census { wp: b[(WHITE | PAWN) as usize], bp: b[(BLACK | PAWN) as usize], wk: b[(WHITE | KING) as usize],
             bk: b[(BLACK | KING) as usize], wb, bb, side: x.side,
             w_np: if wb != 0 { no_pair_squares(wb) } else { 0 }, b_np: if bb != 0 { no_pair_squares(bb) } else { 0 } }
}

/// One level of the lock detector by the plain loop (all ten sets updated on every pass, and the
/// stalemate guards): does the structure leak with king `fr` frozen (0: none)? Kept as the
/// reference for `lock_leaks` below.
fn lock_leaks_reference(c: &Census, flagged: u8, fr: u64) -> bool {
    let (wp, bp, wk, bk) = (c.wp, c.bp, c.wk, c.bk);
    let frozen_white = fr & wk != 0;
    let frozen_black = !frozen_white && fr != 0;
    let near_frozen_black = if frozen_black { zone(bk) } else { 0 };
    let near_frozen_white = if frozen_white { zone(wk) } else { 0 };
    let (w_seed, b_seed) = check_seed(c, fr);
    let (mut w_cone, mut b_cone, mut w_fixed, mut b_fixed) = (wp, bp, wp, bp);
    let (mut w_king, mut b_king, mut w_bish, mut b_bish) = (w_seed, b_seed, c.wb, c.bb);
    let (mut b_take, mut w_take) = (b_seed, w_seed);
    let (mut w_guard, mut b_guard) = (!0u64, !0u64);
    let (w_bishops, b_bishops) = (c.wb != 0, c.bb != 0);
    loop {
        let w_wall = (wp & !(b_take & !w_guard)) | fr;
        let b_wall = (bp & !(w_take & !b_guard)) | fr;
        let nw_fixed = w_fixed & w_wall & south(b_wall | w_fixed);
        let nb_fixed = b_fixed & b_wall & north(w_wall | b_fixed);
        let mut nw_cone = w_cone;
        loop { let a = nw_cone | (north(nw_cone) & !b_wall); if a == nw_cone { break; } nw_cone = a; }
        let mut nb_cone = b_cone;
        loop { let a = nb_cone | (south(nb_cone) & !w_wall); if a == nb_cone { break; } nb_cone = a; }
        let b_hit = sideways(south(nb_fixed));
        let mut nw_king = w_king;
        { let m = !(nw_fixed | b_hit | near_frozen_black);
          loop { let a = nw_king | (zone(nw_king) & m); if a == nw_king { break; } nw_king = a; } }
        let w_hit = sideways(north(nw_fixed));
        let mut nb_king = b_king;
        { let m = !(nb_fixed | w_hit | near_frozen_white);
          loop { let a = nb_king | (zone(nb_king) & m); if a == nb_king { break; } nb_king = a; } }
        let (mut nw_bish, mut nb_bish) = (w_bish, b_bish);
        if nw_bish | nb_bish != 0 {
            let m = !(nw_fixed | nb_fixed);
            loop {
                let a = nw_bish | (diagonal(nw_bish) & m);
                let d = nb_bish | (diagonal(nb_bish) & m);
                if a == nw_bish && d == nb_bish { break; }
                nw_bish = a; nb_bish = d;
            }
        }
        let mut nb_take = b_take | nb_king;
        loop { let a = nb_take | south(nb_take & !b_wall); if a == nb_take { break; } nb_take = a; }
        let mut nw_take = w_take | nw_king;
        loop { let a = nw_take | north(nw_take & !w_wall); if a == nw_take { break; } nw_take = a; }
        let block = nw_fixed | nb_fixed;
        // (a guard needs a candidate, and every pawn of its owner fixed: tested here, before the call)
        let (wc, bc) = (wp & nb_take & nw_fixed, bp & nw_take & nb_fixed);
        let ngw = if w_bishops || wc == 0 || wp & !nw_fixed != 0 { 0 } else {
            stalemate_guard(wc, wp, nw_fixed, nw_king, nw_fixed | b_hit, nb_king, b_bishops, block) };
        let ngb = if b_bishops || bc == 0 || bp & !nb_fixed != 0 { 0 } else {
            stalemate_guard(bc, bp, nb_fixed, nb_king, nb_fixed | w_hit, nw_king, w_bishops, block) };
        let changed = (nw_cone ^ w_cone) | (nb_cone ^ b_cone) | (nw_fixed ^ w_fixed) | (nb_fixed ^ b_fixed)
            | (nw_king ^ w_king) | (nb_king ^ b_king) | (nw_bish ^ w_bish) | (nb_bish ^ b_bish)
            | (nb_take ^ b_take) | (nw_take ^ w_take) | (ngw ^ w_guard) | (ngb ^ b_guard);
        w_cone = nw_cone; b_cone = nb_cone; w_fixed = nw_fixed; b_fixed = nb_fixed;
        w_king = nw_king; b_king = nb_king; w_bish = nw_bish; b_bish = nb_bish;
        b_take = nb_take; w_take = nw_take; w_guard = ngw; b_guard = ngb;
        if changed == 0 { break; }
    }
    if (w_cone & RANK_8) | (b_cone & RANK_1) != 0 { return true; }                 // a pawn can promote
    if north(sideways(w_cone)) & b_cone != 0 { return true; }                       // a pawn can capture
    if frozen_white && w_king != wk { return true; }                                // the frozen king can move
    if frozen_black && b_king != bk { return true; }
    if diagonal(w_bish) & b_cone != 0 || diagonal(b_bish) & w_cone != 0 { return true; }   // a bishop meets a pawn's path
    if w_guard | b_guard != 0 {                                                     // the reaches stop at guarded pawns
        let m = !(w_fixed | sideways(south(b_fixed)) | near_frozen_black | (bp & b_guard));
        let mut a = w_seed; loop { let x = a | (zone(a) & m); if x == a { break; } a = x; }
        let m = !(b_fixed | sideways(north(w_fixed)) | near_frozen_white | (wp & w_guard));
        let mut d = b_seed; loop { let x = d | (zone(d) & m); if x == d { break; } d = x; }
        w_king = a; b_king = d;
    }
    net_leaks(&LockSets { w_cone, b_cone, w_king, b_king, w_bish, b_bish, occ: 0, w_np: c.w_np, b_np: c.b_np }, flagged)
}

/// Occluded fills (Kogge-Stone): every square reachable from `g` by steps north (south) through
/// squares of `p`, in three shifts instead of up to six dependent steps.
#[inline(always)]
fn fill_north(mut g: u64, mut p: u64) -> u64 { g |= p & (g << 8); p &= p << 8; g |= p & (g << 16); p &= p << 16; g | (p & (g << 32)) }
#[inline(always)]
fn fill_south(mut g: u64, mut p: u64) -> u64 { g |= p & (g >> 8); p &= p >> 8; g |= p & (g >> 16); p &= p >> 16; g | (p & (g >> 32)) }

/// Both kings' reaches at once: two independent chains in one loop. A step is
/// `k | (zone(k) & m)`, with the file masks of `zone` folded into `m` once, outside the loop,
/// which shortens the chain of dependent operations in each step.
#[inline(always)]
fn king_fill2(mut w: u64, mw: u64, mut b: u64, mb: u64) -> (u64, u64) {
    let (mwa, mwh, mba, mbh) = (mw & !FILE_A, mw & !FILE_H, mb & !FILE_A, mb & !FILE_H);
    loop {
        let v = w | (w << 8) | (w >> 8);
        let a = w | (v & mw) | ((v << 1) & mwa) | ((v >> 1) & mwh);
        let u = b | (b << 8) | (b >> 8);
        let d = b | (u & mb) | ((u << 1) & mba) | ((u >> 1) & mbh);
        if a == w && d == b { return (w, b); }
        w = a; b = d;
    }
}

/// One level of the lock detector: the same fixed point as `lock_leaks_reference`, by fewer steps.
///
/// The ten sets do not all depend on each other. The cycle is walls → fixed pawns → king reaches →
/// capture squares → walls; the pawn cones and the bishops' reaches are read only by the leak
/// tests, never by the cycle. So the cycle runs alone, on six sets, and the cones and bishop
/// reaches are computed once, from the final walls and fixed pawns. That gives the reference's sets
/// exactly: the walls only shrink and the fixed pawns only shrink, so the masks the cones and the
/// bishops are flooded against only grow, and flooding step by step against growing masks ends
/// where one flood against the last mask ends.
/// Also: the cones against the first (largest) walls are a lower bound of the final cones, so a
/// promotion or a capture they already show is a leak at once; and a frozen king that moves leaks
/// in whichever pass it does. Pawn-only structures never touch the bishop code.
#[inline(always)]
fn lock_leaks(c: &Census, flagged: u8, fr: u64) -> bool {
    match lock_level(c, fr) { None => true, Some(s) => net_leaks(&s, flagged) }
}

/// The same level for both sides: of the sides in `ask` (FLAGGED_* bits), those whose king the
/// structure leaks to. Everything up to the mating net is the same whichever side is flagged, so
/// it is computed once.
#[inline(always)]
fn lock_leaks2(c: &Census, fr: u64, ask: u8) -> u8 {
    match lock_level(c, fr) {
        None => ask,
        Some(s) => (if ask & FLAGGED_WHITE != 0 && net_leaks(&s, WHITE) { FLAGGED_WHITE } else { 0 })
            | (if ask & FLAGGED_BLACK != 0 && net_leaks(&s, BLACK) { FLAGGED_BLACK } else { 0 }),
    }
}

/// What the mating net reads at the end of a level; `occ`: squares occupied for good besides (the
/// boxed pieces' squares, 0 in every other level); w_np, b_np: the census's twin-bishop squares.
#[derive(Clone, Copy)]
struct LockSets { w_cone: u64, b_cone: u64, w_king: u64, b_king: u64, w_bish: u64, b_bish: u64, occ: u64, w_np: u64, b_np: u64 }

// ─── The stalemate guard and the check seed (the second version; src/lock.js) ───────────────
//
// A pawn the enemy king may take leaves the wall (the takeable pawns). It need not, if taking it
// always ends the game: when the owner's king, wherever it may stand, either defends the pawn or has
// no square left to step to once the enemy king stands on the pawn's square, and the owner has
// nothing else that moves (no bishop; every other pawn fixed). The capture is then a stalemate (the
// owner is to move, and a king's capture gives no check unless it uncovers an enemy bishop, which
// the rays below rule out), so no line of play goes through it: the pawn is as good as a wall. Only
// a fixed pawn is guarded. The guard only shrinks as the reaches grow and the fixed pawns shrink, so
// the cycle stays monotone.

/// Does a diagonal ray from `k`, stopped by the squares `block`, meet a square of `o`? (rayMeets)
#[inline(always)]
fn ray_meets(k: usize, block: u64, o: u64) -> bool {
    let (f0, r0) = ((k & 7) as i32, (k >> 3) as i32);
    for d in 0..4 {
        let (df, dr) = (if d & 1 != 0 { 1 } else { -1 }, if d & 2 != 0 { 1 } else { -1 });
        let (mut f, mut r) = (f0 + df, r0 + dr);
        while (0..8).contains(&f) && (0..8).contains(&r) {
            let b = 1u64 << (8 * r + f);
            if o & b != 0 { return true; }
            if block & b != 0 { break; }
            f += df; r += dr;
        }
    }
    false
}

/// Of the owner's fixed pawns `cand` (which the enemy king may take), those whose capture always
/// stalemates the owner (stalemateGuard). reach: where the owner's king may stand; shut: squares its
/// king can never step to with the enemy king elsewhere (own fixed pawns, squares the enemy's fixed
/// pawns attack); enemy_king: the enemy king's reach; block: squares a bishop's line never crosses.
#[inline(never)]
fn stalemate_guard(cand: u64, own_p: u64, own_fixed: u64, reach: u64, shut: u64, enemy_king: u64,
                   enemy_bishops: bool, block: u64) -> u64 {
    if own_p & !own_fixed != 0 { return 0; }               // another pawn of the owner's may move
    let t = tables();
    let mut guard = 0;
    let mut c = cand;
    while c != 0 {
        let p = lsb(c); c &= c - 1;
        let pb = 1u64 << p;
        let n = t.king[p];
        let o = n & enemy_king;                            // where the enemy king takes from
        let mut k = reach & !(n | pb);                     // the owner's king, not defending the pawn
        let x = shut | n | pb;                             // ... and not stepping next to the enemy king
        let mut held = true;
        while k != 0 {
            let q = lsb(k); k &= k - 1;
            if t.king[q] & !x != 0 { held = false; break; }
            if enemy_bishops && ray_meets(q, block | pb, o) { held = false; break; }
        }
        if held { guard |= pb; }
    }
    guard
}

/// The check seed: the side to move is in a pawn's check, so its king must step out now, to one of
/// the squares it can step to now (exact: its own pawns, the enemy pawns' attacks, the enemy king's
/// neighbours); its reach starts there, not on its square. Not when it has no such step (that may be
/// a mate now), when one of its pawns can take a checking pawn (the king would stay), at a frozen
/// level, or with a bishop on the board (no knight, rook or queen comes here). The kings' starting
/// sets: (White's, Black's).
#[inline(always)]
fn check_seed(c: &Census, fr: u64) -> (u64, u64) {
    let (wp, bp, wk, bk) = (c.wp, c.bp, c.wk, c.bk);
    if fr != 0 || c.wb | c.bb != 0 { return (wk, bk); }
    let white = c.side == WHITE;
    let (k, ek) = if white { (wk, bk) } else { (bk, wk) };
    let chk = if white { sideways(north(k)) & bp } else { sideways(south(k)) & wp };   // the checking pawns
    if chk == 0 { return (wk, bk); }
    let t = tables();
    let atk = if white { sideways(south(bp)) } else { sideways(north(wp)) };
    let own = if white { wp } else { bp };
    let d = t.king[lsb(k)] & !own & !atk & !t.king[lsb(ek)];
    let take = if white { sideways(south(chk)) & wp } else { sideways(north(chk)) & bp };
    if d == 0 || take != 0 { return (wk, bk); }
    if white { (d, bk) } else { (wk, d) }
}

/// A level of the lock detector up to the mating net: None when the structure leaks whichever side
/// is flagged (a pawn can promote or capture, the frozen king can move, a bishop meets a pawn's
/// path), otherwise the sets the net reads.
#[inline(always)]
fn lock_level(c: &Census, fr: u64) -> Option<LockSets> {
    let (wp, bp, wk, bk) = (c.wp, c.bp, c.wk, c.bk);
    let frozen_white = fr & wk != 0;
    let frozen_black = !frozen_white && fr != 0;
    let near_frozen_black = if frozen_black { zone(bk) } else { 0 };
    let near_frozen_white = if frozen_white { zone(wk) } else { 0 };
    // Quick reject with the first walls (the capture squares are only the kings' squares yet).
    {
        let w_wall = (wp & !bk) | fr;
        let b_wall = (bp & !wk) | fr;
        let wc = fill_north(wp, !b_wall);
        let bc = fill_south(bp, !w_wall);
        if (wc & RANK_8) | (bc & RANK_1) != 0 || north(sideways(wc)) & bc != 0 { return None; }
    }
    // The check seed.
    let (w_seed, b_seed) = check_seed(c, fr);
    // The cycle: walls -> fixed pawns -> king reaches -> capture squares, with each side's stalemate
    // guard (all of its pawns at first: nothing is taken yet).
    let (mut w_fixed, mut b_fixed, mut w_king, mut b_king, mut w_take, mut b_take) = (wp, bp, w_seed, b_seed, w_seed, b_seed);
    let (mut w_wall, mut b_wall) = (!0u64, !0u64);
    let (mut w_guard, mut b_guard) = (!0u64, !0u64);
    let (w_bishops, b_bishops) = (c.wb != 0, c.bb != 0);
    loop {
        let (pw, pb) = (w_wall, b_wall);
        // white pawns Black can never take (or whose capture stalemates White) | frozen king; likewise
        w_wall = (wp & !(b_take & !w_guard)) | fr;
        b_wall = (bp & !(w_take & !b_guard)) | fr;
        let nw_fixed = w_fixed & w_wall & south(b_wall | w_fixed);
        let nb_fixed = b_fixed & b_wall & north(w_wall | b_fixed);
        // Same walls and same fixed pawns as the pass before: the kings and the capture squares are
        // already closed under the same masks, so nothing can change any more.
        if w_wall == pw && b_wall == pb && nw_fixed == w_fixed && nb_fixed == b_fixed { break; }
        let (b_hit, w_hit) = (sideways(south(nb_fixed)), sideways(north(nw_fixed)));
        let mw = !(nw_fixed | b_hit | near_frozen_black);
        let mb = !(nb_fixed | w_hit | near_frozen_white);
        let (nw_king, nb_king) = king_fill2(w_king, mw, b_king, mb);
        if (frozen_white && nw_king != wk) || (frozen_black && nb_king != bk) { return None; }   // the frozen king can move
        let t = b_take | nb_king;
        let nb_take = t | south(fill_south(t & !b_wall, !b_wall));
        let t = w_take | nw_king;
        let nw_take = t | north(fill_north(t & !w_wall, !w_wall));
        // The guards for the next pass, from this pass's reaches and fixed pawns.
        let block = nw_fixed | nb_fixed;
        // (a guard needs a candidate, and every pawn of its owner fixed: tested here, before the call)
        let (wc, bc) = (wp & nb_take & nw_fixed, bp & nw_take & nb_fixed);
        let ngw = if w_bishops || wc == 0 || wp & !nw_fixed != 0 { 0 } else {
            stalemate_guard(wc, wp, nw_fixed, nw_king, nw_fixed | b_hit, nb_king, b_bishops, block) };
        let ngb = if b_bishops || bc == 0 || bp & !nb_fixed != 0 { 0 } else {
            stalemate_guard(bc, bp, nb_fixed, nb_king, nb_fixed | w_hit, nw_king, w_bishops, block) };
        let changed = (ngw ^ w_guard) | (ngb ^ b_guard) | (nw_fixed ^ w_fixed) | (nb_fixed ^ b_fixed)
            | (nw_king ^ w_king) | (nb_king ^ b_king) | (nb_take ^ b_take) | (nw_take ^ w_take);
        w_fixed = nw_fixed; b_fixed = nb_fixed; w_king = nw_king; b_king = nb_king; w_take = nw_take; b_take = nb_take;
        w_guard = ngw; b_guard = ngb;
        if changed == 0 { break; }
    }
    // A king that takes a guarded pawn ends the game: for the mating net, the kings' reaches again, now
    // stopping at the enemy's guarded pawns (the walls and fixed pawns stay as they are).
    if w_guard | b_guard != 0 {
        let mw = !(w_fixed | sideways(south(b_fixed)) | near_frozen_black | (bp & b_guard));
        let mb = !(b_fixed | sideways(north(w_fixed)) | near_frozen_white | (wp & w_guard));
        let (a, d) = king_fill2(w_seed, mw, b_seed, mb);
        w_king = a; b_king = d;
    }
    // The cones, once, against the final walls.
    let w_cone = fill_north(wp, !b_wall);
    let b_cone = fill_south(bp, !w_wall);
    if (w_cone & RANK_8) | (b_cone & RANK_1) != 0 { return None; }                 // a pawn can promote
    if north(sideways(w_cone)) & b_cone != 0 { return None; }                       // a pawn can capture
    // The bishops' reaches, once, against the final fixed pawns.
    let (mut w_bish, mut b_bish) = (c.wb, c.bb);
    if w_bish | b_bish != 0 {
        let m = !(w_fixed | b_fixed);
        loop {
            let a = w_bish | (diagonal(w_bish) & m);
            let d = b_bish | (diagonal(b_bish) & m);
            if a == w_bish && d == b_bish { break; }
            w_bish = a; b_bish = d;
        }
        if diagonal(w_bish) & b_cone != 0 || diagonal(b_bish) & w_cone != 0 { return None; }   // a bishop meets a pawn's path
    }
    Some(LockSets { w_cone, b_cone, w_king, b_king, w_bish, b_bish, occ: 0, w_np: c.w_np, b_np: c.b_np })
}

/// The mating net: can the flagged king be caught by the pawns and bishops of the other side?
#[inline(always)]
fn net_leaks(s: &LockSets, flagged: u8) -> bool {
    let LockSets { w_cone, b_cone, w_king, b_king, w_bish, b_bish, occ, w_np, b_np } = *s;
    let (attack, reach, free, spare);
    if flagged == WHITE {
        attack = diagonal(b_bish) | sideways(south(b_cone));
        reach = w_king;
        free = !(w_cone | occ | zone(b_king) | attack);
        spare = free & !w_bish;
    } else {
        attack = diagonal(w_bish) | sideways(north(w_cone));
        reach = b_king;
        free = !(b_cone | occ | zone(w_king) | attack);
        spare = free & !b_bish;
    }
    // the second rule, not on the squares where the flagged side's twin bishops may hold both flights
    let np = if flagged == WHITE { w_np } else { b_np };
    let flight = sideways(spare) | north(spare) | south(spare) | ((north(free) | south(free)) & sideways(free) & !np);
    attack & reach & !flight != 0
}

// ─── Open pawn pairs (the second version; gapLevel and the functions before it in src/lock.js) ──
//
// An open pair: a white pawn and a black pawn on one file with one square between them (the gap)
// that holds no pawn. The reachable positions are split into three families by what the pair's
// pawns have done: A, neither has moved (both held, the gap a wall for both sides' pawns but not
// for the kings); B, the white pawn has stepped into the gap; C, the black pawn has. B's and C's
// kings, capture squares and bishops start from A's final sets (minus the gap). With k pairs the
// families are the 3^k combinations, each started from the families one step before it.
// With an open pair, each level tries the families first and itself after them, except for the
// sides family A leaked to: A is the level with more walls, so the level leaks to them too.

/// The most open pairs the rule splits on (3^3 = 27 families).
pub const MAX_GAP_PAIRS: usize = 3;
const POW3: [usize; 4] = [1, 3, 9, 27];

/// A family's input: the pawns, the walls for both sides (the gaps that stay), and the sets the
/// kings' reaches, the capture squares and the bishops' reaches start from.
#[derive(Clone, Copy)]
struct GapIn { wp: u64, bp: u64, v: u64, wk0: u64, bk0: u64, wt0: u64, bt0: u64, wb0: u64, bb0: u64 }

/// A family's output: the final sets.
#[derive(Clone, Copy, Default)]
struct GapOut { w_cone: u64, b_cone: u64, w_king: u64, b_king: u64, w_bish: u64, b_bish: u64,
                w_take: u64, b_take: u64, w_fixed: u64, b_fixed: u64 }

/// One level on a family (gapLevelLeaks): `lock_level`'s cycle from the family's pawns, walls and
/// starting sets. None when the structure leaks whichever side is flagged.
#[inline(always)]
fn gap_level(c: &Census, g: &GapIn, fr: u64) -> Option<GapOut> {
    let (wp, bp, wk, bk) = (g.wp, g.bp, c.wk, c.bk);
    let v = g.v | fr;
    let frozen_white = fr & wk != 0;
    let frozen_black = !frozen_white && fr != 0;
    let near_frozen_black = if frozen_black { zone(bk) } else { 0 };
    let near_frozen_white = if frozen_white { zone(wk) } else { 0 };
    {
        let w_wall = (wp & !g.bt0) | v;
        let b_wall = (bp & !g.wt0) | v;
        let wc = fill_north(wp, !b_wall);
        let bc = fill_south(bp, !w_wall);
        if (wc & RANK_8) | (bc & RANK_1) != 0 || north(sideways(wc)) & bc != 0 { return None; }
    }
    let (mut w_fixed, mut b_fixed, mut w_king, mut b_king, mut w_take, mut b_take) = (wp, bp, g.wk0, g.bk0, g.wt0, g.bt0);
    let (mut w_wall, mut b_wall) = (!0u64, !0u64);
    loop {
        let (pw, pb) = (w_wall, b_wall);
        w_wall = (wp & !b_take) | v;
        b_wall = (bp & !w_take) | v;
        let nw_fixed = w_fixed & w_wall & south(b_wall | w_fixed);
        let nb_fixed = b_fixed & b_wall & north(w_wall | b_fixed);
        if w_wall == pw && b_wall == pb && nw_fixed == w_fixed && nb_fixed == b_fixed { break; }
        let mw = !(nw_fixed | sideways(south(nb_fixed)) | near_frozen_black);
        let mb = !(nb_fixed | sideways(north(nw_fixed)) | near_frozen_white);
        let (nw_king, nb_king) = king_fill2(w_king, mw, b_king, mb);
        if (frozen_white && nw_king != wk) || (frozen_black && nb_king != bk) { return None; }
        let t = b_take | nb_king;
        let nb_take = t | south(fill_south(t & !b_wall, !b_wall));
        let t = w_take | nw_king;
        let nw_take = t | north(fill_north(t & !w_wall, !w_wall));
        let changed = (nw_fixed ^ w_fixed) | (nb_fixed ^ b_fixed) | (nw_king ^ w_king) | (nb_king ^ b_king)
            | (nb_take ^ b_take) | (nw_take ^ w_take);
        w_fixed = nw_fixed; b_fixed = nb_fixed; w_king = nw_king; b_king = nb_king; w_take = nw_take; b_take = nb_take;
        if changed == 0 { break; }
    }
    let w_cone = fill_north(wp, !b_wall);
    let b_cone = fill_south(bp, !w_wall);
    if (w_cone & RANK_8) | (b_cone & RANK_1) != 0 { return None; }
    if north(sideways(w_cone)) & b_cone != 0 { return None; }
    let (mut w_bish, mut b_bish) = (g.wb0, g.bb0);
    if w_bish | b_bish != 0 {
        let m = !(w_fixed | b_fixed);
        loop {
            let a = w_bish | (diagonal(w_bish) & m);
            let d = b_bish | (diagonal(b_bish) & m);
            if a == w_bish && d == b_bish { break; }
            w_bish = a; b_bish = d;
        }
        if diagonal(w_bish) & b_cone != 0 || diagonal(b_bish) & w_cone != 0 { return None; }
    }
    Some(GapOut { w_cone, b_cone, w_king, b_king, w_bish, b_bish, w_take, b_take, w_fixed, b_fixed })
}

/// The same level by the plain loop (all ten sets on every pass), as `lock_leaks_reference` is
/// for `lock_level`: the reference `gap_level` is checked against (examples/lockcheck.rs).
fn gap_level_reference(c: &Census, g: &GapIn, fr: u64) -> Option<GapOut> {
    let (wp, bp, wk, bk) = (g.wp, g.bp, c.wk, c.bk);
    let v = g.v | fr;
    let frozen_white = fr & wk != 0;
    let frozen_black = !frozen_white && fr != 0;
    let near_frozen_black = if frozen_black { zone(bk) } else { 0 };
    let near_frozen_white = if frozen_white { zone(wk) } else { 0 };
    let (mut w_cone, mut b_cone, mut w_fixed, mut b_fixed) = (wp, bp, wp, bp);
    let (mut w_king, mut b_king, mut w_bish, mut b_bish) = (g.wk0, g.bk0, g.wb0, g.bb0);
    let (mut b_take, mut w_take) = (g.bt0, g.wt0);
    loop {
        let w_wall = (wp & !b_take) | v;
        let b_wall = (bp & !w_take) | v;
        let nw_fixed = w_fixed & w_wall & south(b_wall | w_fixed);
        let nb_fixed = b_fixed & b_wall & north(w_wall | b_fixed);
        let mut nw_cone = w_cone;
        loop { let a = nw_cone | (north(nw_cone) & !b_wall); if a == nw_cone { break; } nw_cone = a; }
        let mut nb_cone = b_cone;
        loop { let a = nb_cone | (south(nb_cone) & !w_wall); if a == nb_cone { break; } nb_cone = a; }
        let b_hit = sideways(south(nb_fixed));
        let mut nw_king = w_king;
        { let m = !(nw_fixed | b_hit | near_frozen_black);
          loop { let a = nw_king | (zone(nw_king) & m); if a == nw_king { break; } nw_king = a; } }
        let w_hit = sideways(north(nw_fixed));
        let mut nb_king = b_king;
        { let m = !(nb_fixed | w_hit | near_frozen_white);
          loop { let a = nb_king | (zone(nb_king) & m); if a == nb_king { break; } nb_king = a; } }
        let (mut nw_bish, mut nb_bish) = (w_bish, b_bish);
        if nw_bish | nb_bish != 0 {
            let m = !(nw_fixed | nb_fixed);
            loop {
                let a = nw_bish | (diagonal(nw_bish) & m);
                let d = nb_bish | (diagonal(nb_bish) & m);
                if a == nw_bish && d == nb_bish { break; }
                nw_bish = a; nb_bish = d;
            }
        }
        let mut nb_take = b_take | nb_king;
        loop { let a = nb_take | south(nb_take & !b_wall); if a == nb_take { break; } nb_take = a; }
        let mut nw_take = w_take | nw_king;
        loop { let a = nw_take | north(nw_take & !w_wall); if a == nw_take { break; } nw_take = a; }
        let changed = (nw_cone ^ w_cone) | (nb_cone ^ b_cone) | (nw_fixed ^ w_fixed) | (nb_fixed ^ b_fixed)
            | (nw_king ^ w_king) | (nb_king ^ b_king) | (nw_bish ^ w_bish) | (nb_bish ^ b_bish)
            | (nb_take ^ b_take) | (nw_take ^ w_take);
        w_cone = nw_cone; b_cone = nb_cone; w_fixed = nw_fixed; b_fixed = nb_fixed;
        w_king = nw_king; b_king = nb_king; w_bish = nw_bish; b_bish = nb_bish;
        b_take = nb_take; w_take = nw_take;
        if changed == 0 { break; }
    }
    if (w_cone & RANK_8) | (b_cone & RANK_1) != 0 { return None; }
    if north(sideways(w_cone)) & b_cone != 0 { return None; }
    if frozen_white && w_king != wk { return None; }
    if frozen_black && b_king != bk { return None; }
    if diagonal(w_bish) & b_cone != 0 || diagonal(b_bish) & w_cone != 0 { return None; }
    Some(GapOut { w_cone, b_cone, w_king, b_king, w_bish, b_bish, w_take, b_take, w_fixed, b_fixed })
}

/// The families of the k open pairs at one level (gapLevel): of the sides in `ask`, those that no
/// family leaks to, and those family A leaks to (gapRefuted: A is the level with more walls, so
/// its sets are subsets of the level's and the level leaks to them too). `pairs`: per pair the
/// gap, the white pawn and the black pawn.
#[inline(always)]
fn gap_families<F: Fn(&Census, &GapIn, u64) -> Option<GapOut>>(c: &Census, pairs: &[(u64, u64, u64)], fr: u64, ask: u8, level: &F) -> (u8, u8) {
    // The families' results live on the stack, sized for k pairs (3^k): nothing to clear beyond them.
    match pairs.len() {
        1 => gap_families_n::<3, F>(c, pairs, fr, ask, level),
        2 => gap_families_n::<9, F>(c, pairs, fr, ask, level),
        _ => gap_families_n::<27, F>(c, pairs, fr, ask, level),
    }
}

#[inline(always)]
fn gap_families_n<const N: usize, F: Fn(&Census, &GapIn, u64) -> Option<GapOut>>(c: &Census, pairs: &[(u64, u64, u64)], fr: u64, mut ask: u8, level: &F) -> (u8, u8) {
    let k = pairs.len();
    // Set up once family A has passed: most positions with an open pair stop at A.
    let mut res: Option<[GapOut; N]> = None;
    let mut refuted = 0u8;
    for f in 0..POW3[k] {
        let mut g = GapIn { wp: c.wp, bp: c.bp, v: 0, wk0: 0, bk0: 0, wt0: 0, bt0: 0, wb0: 0, bb0: 0 };
        if f == 0 { g.wk0 = c.wk; g.wt0 = c.wk; g.bk0 = c.bk; g.bt0 = c.bk; g.wb0 = c.wb; g.bb0 = c.bb; }
        let mut q = f;
        for (i, &(gap, w, b)) in pairs.iter().enumerate() {
            let d = q % 3; q /= 3;
            if d == 0 { g.v |= gap; continue; }
            if d == 1 { g.wp = (g.wp & !w) | gap; } else { g.bp = (g.bp & !b) | gap; }
            let r = &res.as_ref().expect("the family before")[f - d * POW3[i]];
            g.wk0 |= r.w_king & !gap; g.bk0 |= r.b_king & !gap;
            g.wt0 |= r.w_take; g.bt0 |= r.b_take;
            g.wb0 |= r.w_bish & !gap; g.bb0 |= r.b_bish & !gap;
        }
        let Some(o) = level(c, &g, fr) else { return (0, if f == 0 { ask } else { refuted }) };
        // The pairs that stay: both pawns must be walls (held, they are fixed exactly when walls).
        let mut q = f;
        for &(_, w, b) in pairs {
            if q % 3 == 0 && ((w & !o.w_fixed) | (b & !o.b_fixed)) != 0 { return (0, refuted); }
            q /= 3;
        }
        let s = LockSets { w_cone: o.w_cone, b_cone: o.b_cone, w_king: o.w_king, b_king: o.b_king, w_bish: o.w_bish, b_bish: o.b_bish, occ: 0, w_np: c.w_np, b_np: c.b_np };
        if ask & FLAGGED_WHITE != 0 && net_leaks(&s, WHITE) { ask &= !FLAGGED_WHITE; if f == 0 { refuted |= FLAGGED_WHITE; } }
        if ask & FLAGGED_BLACK != 0 && net_leaks(&s, BLACK) { ask &= !FLAGGED_BLACK; if f == 0 { refuted |= FLAGGED_BLACK; } }
        if ask == 0 { return (0, refuted); }
        res.get_or_insert([GapOut::default(); N])[f] = o;
    }
    (ask, refuted)
}

/// The open pairs of the gaps (gapPairs): per pair the gap, the white pawn below it and the black
/// pawn above it; None when there are more than MAX_GAP_PAIRS.
#[inline(always)]
fn gap_pairs(mut gaps: u64) -> Option<([(u64, u64, u64); MAX_GAP_PAIRS], usize)> {
    if gaps.count_ones() as usize > MAX_GAP_PAIRS { return None; }
    let mut pairs = [(0u64, 0u64, 0u64); MAX_GAP_PAIRS];
    let mut k = 0;
    while gaps != 0 { let g = gaps & gaps.wrapping_neg(); gaps ^= g; pairs[k] = (g, g >> 8, g << 8); k += 1; }
    Some((pairs, k))
}

// ─── Boxed knights, rooks and queens (the second version; boxedTest in src/lock.js) ─────────────
//
// A knight, rook or queen whose every step square holds one of its own men that never moves (a
// fixed pawn, or another boxed piece) never moves and attacks only squares its own men hold for
// good: it only stands in the way. Only with such a piece on the board, and only past a quick check
// that all of them are boxed in by their own pawns and pieces, a level is computed: the plain loop,
// with the bishops in the cycle (the boxed pieces are those no enemy king or bishop reaches), boxed
// pieces walls for the pawns of both sides, own boxed pieces and still bishops squares the king
// never steps to, two more leaks (a pawn can capture on a piece's square; a piece has a step square
// not held by a fixed pawn, a boxed piece or a still bishop of its colour, or its frozen king when
// its side has no castling right left and the king does not stand where a castle leaves it beside
// its rook) and no flight onto a piece's square. A quiet move of such a piece leaves it an empty step
// square; a bishop that has just moved has one empty diagonal neighbour, and a king that has just
// stepped can step back; a castle leaves king and rook on g1 and f1 or c1 and d1 (g8, f8, c8, d8),
// where the king holds nothing. So the trigger (tests_after) is unchanged.

/// Is every knight, rook and queen of one side boxed in by its own pawns and pieces (`own`)? Their
/// step squares, or None. Rooks' and queens' orthogonal neighbours first: in a game one of them
/// almost always has an empty one.
#[inline(always)]
fn boxed_in(n: u64, r: u64, q: u64, own: u64) -> Option<u64> {
    let mut s = 0;
    let o = r | q;
    if o != 0 {
        s = sideways(o) | north(o) | south(o);
        if s & !own != 0 { return None; }
        if q != 0 { let d = diagonal(q); if d & !own != 0 { return None; } s |= d; }
    }
    if n != 0 {
        let t = tables();
        let mut m = n;
        while m != 0 { let k = t.knight[lsb(m)]; m &= m - 1; if k & !own != 0 { return None; } s |= k; }
    }
    Some(s)
}

/// A side's knights, rooks and queens (x), the squares they step to (steps), and whether its king may
/// hold a step square when frozen (no castling right left, not beside its rook where a castle leaves them).
struct Boxes { wx: u64, bx: u64, ws: u64, bs: u64, wk_wall: bool, bk_wall: bool }

/// The still bishops among `b` (stillBishops): every diagonal neighbour held for good by `held`
/// (fixed pawns and boxed pieces of their colour) or by another still bishop, and out of the enemy
/// king's and bishops' `reach`. Such a bishop never moves and is never taken (a pawn taking it fails
/// the bishop contact test). The largest such set.
#[inline]
fn still_bishops(b: u64, held: u64, reach: u64) -> u64 {
    let mut s = b & !reach;
    loop {
        let h = held | s;
        let (mut n, mut m) = (0, s);
        while m != 0 { let q = m & m.wrapping_neg(); m &= m - 1; if diagonal(q) & !h == 0 { n |= q; } }
        if n == s { return s; }
        s = n;
    }
}

/// One level with boxed pieces (boxedLevelLeaks), king `fr` frozen (0: none): None when the
/// structure leaks whichever side is flagged, otherwise the net's sets and the boxed pieces.
fn boxed_level(c: &Census, x: &Boxes, fr: u64) -> Option<(LockSets, u64, u64, u64)> {
    let (wp, bp, wk, bk, wx, bx) = (c.wp, c.bp, c.wk, c.bk, x.wx, x.bx);
    let frozen_white = fr & wk != 0;
    let frozen_black = !frozen_white && fr != 0;
    let near_frozen_black = if frozen_black { zone(bk) } else { 0 };
    let near_frozen_white = if frozen_white { zone(wk) } else { 0 };
    let (mut w_cone, mut b_cone, mut w_fixed, mut b_fixed) = (wp, bp, wp, bp);
    let (mut w_king, mut b_king, mut w_bish, mut b_bish) = (wk, bk, c.wb, c.bb);
    let (mut b_take, mut w_take) = (bk, wk);
    loop {
        let boxed = (wx & !(b_king | b_bish)) | (bx & !(w_king | w_bish));
        let w_wall = (wp & !b_take) | fr | boxed;
        let b_wall = (bp & !w_take) | fr | boxed;
        let nw_fixed = w_fixed & w_wall & south(b_wall | w_fixed);
        let nb_fixed = b_fixed & b_wall & north(w_wall | b_fixed);
        let nw_cone = fill_north(w_cone, !b_wall);
        let nb_cone = fill_south(b_cone, !w_wall);
        // Own boxed pieces and still bishops (as of the sets before this pass) are squares the king never steps to.
        let w_still = still_bishops(c.wb, nw_fixed | (wx & boxed), b_king | b_bish);
        let b_still = still_bishops(c.bb, nb_fixed | (bx & boxed), w_king | w_bish);
        let mw = !(nw_fixed | sideways(south(nb_fixed)) | near_frozen_black | (wx & boxed) | w_still);
        let mb = !(nb_fixed | sideways(north(nw_fixed)) | near_frozen_white | (bx & boxed) | b_still);
        let (nw_king, nb_king) = king_fill2(w_king, mw, b_king, mb);
        let (mut nw_bish, mut nb_bish) = (w_bish, b_bish);
        if nw_bish | nb_bish != 0 {
            let m = !(nw_fixed | nb_fixed);
            loop {
                let a = nw_bish | (diagonal(nw_bish) & m);
                let d = nb_bish | (diagonal(nb_bish) & m);
                if a == nw_bish && d == nb_bish { break; }
                nw_bish = a; nb_bish = d;
            }
        }
        let t = b_take | nb_king;
        let nb_take = t | south(fill_south(t & !b_wall, !b_wall));
        let t = w_take | nw_king;
        let nw_take = t | north(fill_north(t & !w_wall, !w_wall));
        let changed = (nw_cone ^ w_cone) | (nb_cone ^ b_cone) | (nw_fixed ^ w_fixed) | (nb_fixed ^ b_fixed)
            | (nw_king ^ w_king) | (nb_king ^ b_king) | (nw_bish ^ w_bish) | (nb_bish ^ b_bish)
            | (nb_take ^ b_take) | (nw_take ^ w_take);
        w_cone = nw_cone; b_cone = nb_cone; w_fixed = nw_fixed; b_fixed = nb_fixed;
        w_king = nw_king; b_king = nb_king; w_bish = nw_bish; b_bish = nb_bish;
        b_take = nb_take; w_take = nw_take;
        if changed == 0 { break; }
    }
    let boxed = (wx & !(b_king | b_bish)) | (bx & !(w_king | w_bish));
    if (w_cone & RANK_8) | (b_cone & RANK_1) != 0 { return None; }                       // a pawn can promote
    if north(sideways(w_cone)) & (b_cone | bx) != 0 { return None; }                       // a white pawn can capture
    if south(sideways(b_cone)) & wx != 0 { return None; }                                  // a black pawn can take a piece
    if (frozen_white && w_king != wk) || (frozen_black && b_king != bk) { return None; }  // the frozen king can move
    if diagonal(w_bish) & b_cone != 0 || diagonal(b_bish) & w_cone != 0 { return None; }  // a bishop meets a pawn's path
    // a piece may step: a step square not held by a fixed pawn, a boxed piece or a still bishop of its
    // colour, or by its frozen king (where a king may be such a wall)
    let w_still = still_bishops(c.wb, w_fixed | (wx & boxed), b_king | b_bish);
    let b_still = still_bishops(c.bb, b_fixed | (bx & boxed), w_king | w_bish);
    let w_kw = if frozen_white && x.wk_wall { wk } else { 0 };
    let b_kw = if frozen_black && x.bk_wall { bk } else { 0 };
    if x.ws & !(w_fixed | (wx & boxed) | w_still | w_kw) != 0 || x.bs & !(b_fixed | (bx & boxed) | b_still | b_kw) != 0 { return None; }
    Some((LockSets { w_cone, b_cone, w_king, b_king, w_bish, b_bish, occ: wx | bx, w_np: c.w_np, b_np: c.b_np }, boxed, w_fixed, b_fixed))
}

/// A first look before the boxed pieces' test, on words the caller has just read: a rook or queen
/// with a square beside it (east or west) not held by its own pawns and pieces. In a game that
/// settles it nearly always (96% of chasolver's Lichess positions with such pieces).
#[inline(always)]
fn rook_or_queen_free(b: &[u64; 16]) -> bool {
    // Own men: pawns, knights, rooks, queens, bishops and the king (whether a bishop or the king
    // really holds the square for good is the level's question).
    let (wo, bo) = (b[(WHITE | ROOK) as usize] | b[(WHITE | QUEEN) as usize], b[(BLACK | ROOK) as usize] | b[(BLACK | QUEEN) as usize]);
    let w_own = wo | b[(WHITE | PAWN) as usize] | b[(WHITE | KNIGHT) as usize] | b[(WHITE | BISHOP) as usize] | b[(WHITE | KING) as usize];
    let b_own = bo | b[(BLACK | PAWN) as usize] | b[(BLACK | KNIGHT) as usize] | b[(BLACK | BISHOP) as usize] | b[(BLACK | KING) as usize];
    sideways(wo) & !w_own != 0 || sideways(bo) & !b_own != 0
}

/// The lock detector with knights, rooks or queens on the board (boxedTest): of the sides in `ask`,
/// those it proves (0 at once unless every such piece is boxed in by its own men).
#[inline(never)]
fn boxed_test(x: &View, ask: u8) -> u8 {
    let b = x.bb;
    let (wn, wr, wq) = (b[(WHITE | KNIGHT) as usize], b[(WHITE | ROOK) as usize], b[(WHITE | QUEEN) as usize]);
    let (bn, br, bq) = (b[(BLACK | KNIGHT) as usize], b[(BLACK | ROOK) as usize], b[(BLACK | QUEEN) as usize]);
    let (wx, bx) = (wn | wr | wq, bn | br | bq);
    // A king may hold a step square (when frozen) only if its side has no castling right left (a
    // castling rook may stand beside its king, Chess960, and castling moves it) and if it does not
    // stand where a castle leaves it beside its rook (g1 with a rook on f1, c1 with one on d1; g8,
    // f8, c8, d8): the static tests are not asked after a castle (tests_after), so no lock may need it.
    let (wk, bk) = (b[(WHITE | KING) as usize], b[(BLACK | KING) as usize]);
    let wk_wall = x.castling & 3 == 0 && wr & (((wk & (1 << 6)) >> 1) | ((wk & (1 << 2)) << 1)) == 0;
    let bk_wall = x.castling & 12 == 0 && br & (((bk & (1 << 62)) >> 1) | ((bk & (1 << 58)) << 1)) == 0;
    let w_own = b[(WHITE | PAWN) as usize] | wx | b[(WHITE | BISHOP) as usize] | if wk_wall { wk } else { 0 };
    let b_own = b[(BLACK | PAWN) as usize] | bx | b[(BLACK | BISHOP) as usize] | if bk_wall { bk } else { 0 };
    let ws = match boxed_in(wn, wr, wq, w_own) { Some(s) => s, None => return 0 };
    let bs = match boxed_in(bn, br, bq, b_own) { Some(s) => s, None => return 0 };
    if x.ep != NO_SQUARE { return 0; }
    let c = census(x);
    let x = Boxes { wx, bx, ws, bs, wk_wall, bk_wall };
    let held = c.wp | c.bp | sideways(north(c.wp) | south(c.bp));
    let t = tables();
    let mut open = ask;
    for fr in [0, c.wk, c.bk] {
        if open == 0 { break; }
        // the frozen king's own knights, rooks, queens and bishops may hold its neighbours too
        let own = if fr == c.wk { wx | c.wb } else { bx | c.bb };
        if fr != 0 && t.king[lsb(fr)] & !(held | own) != 0 { continue; }
        if let Some((s, _, _, _)) = boxed_level(&c, &x, fr) {
            if open & FLAGGED_WHITE != 0 && !net_leaks(&s, WHITE) { open &= !FLAGGED_WHITE; }
            if open & FLAGGED_BLACK != 0 && !net_leaks(&s, BLACK) { open &= !FLAGGED_BLACK; }
        }
    }
    ask & !open
}

/// The lock detector: kings, pawns and bishops that no series of legal moves can open. (lockTest)
/// Kept out of line: inlined into the recursive Domino search it would bloat every level of it.
#[inline(never)]
pub fn lock_test(pos: &Position, flagged: u8) -> bool {
    let x = View::of(pos);
    // The forced step (rare: kings and pawns, a pawn's check, one king move): the lock of the position after it.
    if let Some((bb, side)) = forced_step(&x) { return lock_test_after(&bb, side, flagged, &lock_leaks, &gap_level); }
    lock_test_with(&x, flagged, &lock_leaks, &gap_level)
}

/// lock_test on the position after a forced step (another may follow it).
#[cold]
#[inline(never)]
fn lock_test_after<F: Fn(&Census, u8, u64) -> bool, G: Fn(&Census, &GapIn, u64) -> Option<GapOut>>(bb: &[u64; 16], side: u8, flagged: u8, leaks: &F, gap: &G) -> bool {
    let x = View { bb, side, ep: NO_SQUARE, castling: 0 };
    if let Some((nb, ns)) = forced_step(&x) { return lock_test_after(&nb, ns, flagged, leaks, gap); }
    lock_test_with(&x, flagged, leaks, gap)
}

/// The lock detector with the reference fixed point (the plain loop), for checking that
/// `lock_test` gives the same verdict everywhere (examples/lockcheck.rs).
pub fn lock_test_reference(pos: &Position, flagged: u8) -> bool {
    let x = View::of(pos);
    if let Some((bb, side)) = forced_step(&x) { return lock_test_after(&bb, side, flagged, &lock_leaks_reference, &gap_level_reference); }
    lock_test_with(&x, flagged, &lock_leaks_reference, &gap_level_reference)
}

#[inline(always)]
fn lock_test_with<F: Fn(&Census, u8, u64) -> bool, G: Fn(&Census, &GapIn, u64) -> Option<GapOut>>(x: &View, flagged: u8, leaks: &F, gap: &G) -> bool {
    let b = x.bb;
    // A knight, rook or queen on the board (the usual case in a game): only boxed ones may stay.
    if b[(WHITE | KNIGHT) as usize] | b[(BLACK | KNIGHT) as usize] | b[(WHITE | ROOK) as usize] | b[(BLACK | ROOK) as usize]
        | b[(WHITE | QUEEN) as usize] | b[(BLACK | QUEEN) as usize] != 0 { return !rook_or_queen_free(b) && boxed_test(x, flagged_bit(flagged)) != 0; }
    if x.ep != NO_SQUARE { return false; }
    let c = census(x);
    // With an open pair the levels below almost never prove a lock: the open-pair rule first.
    let gaps = open_pairs(&c);
    if gaps != 0 { return lock_test_pairs_first(&c, flagged, leaks, gap, gaps) || mater_stuck(x, flagged); }
    if !leaks(&c, flagged, 0) { return true; }
    let held = c.wp | c.bp | sideways(north(c.wp) | south(c.bp));
    let t = tables();
    for king in [c.wk, c.bk] {
        if t.king[lsb(king)] & !held != 0 { continue; }
        if !leaks(&c, flagged, king) { return true; }
    }
    mater_stuck(x, flagged)
}

// ─── The stuck mater and the forced step (the second version; src/lock.js) ────────────────────
//
// The stuck mater: with the flagged side to move, the game may end at the mater's very next turn:
// whatever the flagged side plays, the mater has no legal move (a stalemate, or a mate of the
// mater). Then the flagged side is never mated. Proven from the bitboards alone, for kings and pawns:
//   - the flagged side has no pawn capture now (so its pawns that cannot push stay where they are);
//   - every pawn of the mater's is blocked by a man that stays and attacks no flagged man;
//   - each square next to the mater's king holds a man of its own, or is attacked by a flagged pawn
//     that has no move now, or is next to the flagged king wherever that king goes;
//   - no push of the flagged side's lands where a mater's pawn attacks or next to the mater's king,
//     and no double push gives the mater an en passant capture;
//   - the flagged side is not mated now: in a pawn's check, its king has a square to step to.
//
// The forced step: the side to move is in a pawn's check and has exactly one legal move, its king's
// step to one square (kings and pawns only, so the steps are exact; and no pawn of its own can take
// a checking pawn). Every line goes through that step, and the position is no mate now, so the lock
// of the position after it proves this one.

const RANK_3: u64 = 0xff << 16;
const RANK_6: u64 = 0xff << 40;

/// Knights, rooks, queens or bishops on the board?
#[inline(always)]
fn pieces(b: &[u64; 16]) -> bool {
    b[(WHITE | BISHOP) as usize] | b[(BLACK | BISHOP) as usize] | b[(WHITE | KNIGHT) as usize] | b[(BLACK | KNIGHT) as usize]
        | b[(WHITE | ROOK) as usize] | b[(BLACK | ROOK) as usize] | b[(WHITE | QUEEN) as usize] | b[(BLACK | QUEEN) as usize] != 0
}

/// The stuck mater (materStuck).
#[inline(always)]
fn mater_stuck(x: &View, flagged: u8) -> bool {
    x.side == flagged && x.ep == NO_SQUARE && mater_stuck_rest(x, flagged)   // an en passant capture is a move too
}
#[inline(never)]
fn mater_stuck_rest(x: &View, flagged: u8) -> bool {
    let b = x.bb;
    if pieces(b) { return false; }                                      // kings and pawns only
    let white = flagged == WHITE;
    let mater = flagged ^ WHITE;
    let (fp, mp) = (b[(flagged | PAWN) as usize], b[(mater | PAWN) as usize]);
    let (fk, mk) = (b[(flagged | KING) as usize], b[(mater | KING) as usize]);
    let occ = fp | mp | fk | mk;
    // A mater's pawn with an empty square in front can never be stuck (rule 2 below); then only a
    // flagged side that is stalemated now is left to find, which a flagged push rules out at once.
    let free = if white { south(mp) } else { north(mp) } & !occ;
    if free != 0 && (if white { north(fp) } else { south(fp) }) & !occ != 0 { return false; }
    // pawn attacks (White's go north, Black's south) and forward squares
    let f_atk = if white { sideways(north(fp)) } else { sideways(south(fp)) };
    let m_atk = if white { sideways(south(mp)) } else { sideways(north(mp)) };
    let f_fwd = if white { north(fp) } else { south(fp) };
    let m_fwd = if white { south(mp) } else { north(mp) };
    // 1. the flagged side has no pawn capture now
    if f_atk & (mp | mk) != 0 { return false; }
    // the flagged pushes: single, and double from the start rank (through rank 3 / 6)
    let sg = f_fwd & !occ;
    let db = if white { north(sg & RANK_3) } else { south(sg & RANK_6) } & !occ;
    let push = sg | db;
    // the flagged king's steps now (exact): not onto its pawns, the mater's pawn attacks, next to the mater's king
    let t = tables();
    let n = t.king[lsb(mk)];
    let fq = lsb(fk);
    let kd = t.king[fq] & !fp & !m_atk & !n;
    let in_check = fk & m_atk != 0;
    if in_check && kd == 0 { return false; }                            // mated now
    let stays = push != 0 && !in_check;                                 // a pawn moves instead: the king stays
    if kd == 0 && !stays { return true; }                               // no legal move, no check: stalemate now
    // where the flagged king may stand after its move, and the squares next to all of them
    let mut cov = !0u64;
    if stays { cov &= t.king[fq]; }
    let mut m = kd;
    while m != 0 { cov &= t.king[lsb(m)]; m &= m - 1; }
    // 2. the mater's pawns: blocked by men that stay (pawns, its own king; the flagged king only if it never moves)
    let blk = fp | mp | mk | (if kd == 0 { fk } else { 0 });
    if m_fwd & !blk != 0 { return false; }
    if m_atk & fp != 0 { return false; }                                // and they attack no flagged pawn
    // the flagged pawns that cannot move this turn (forward square occupied) keep their attacks
    let st = fp & if white { south(f_fwd & occ) } else { north(f_fwd & occ) };
    let s_atk = if white { sideways(north(st)) } else { sideways(south(st)) };
    // 3. every square next to the mater's king: its own pawn, attacked by such a pawn, or next to the flagged king wherever it goes
    if n & !(mp | s_atk | cov) != 0 { return false; }
    // 4. no push lands where a mater's pawn attacks or next to its king, and no double push allows en passant
    if push & (m_atk | n) != 0 { return false; }
    if db & sideways(mp) != 0 { return false; }
    true
}

/// The forced step (forcedStep): the bitboards and the side to move after it, or None.
#[inline(always)]
fn forced_step(x: &View) -> Option<([u64; 16], u8)> {
    let b = x.bb;
    if x.ep != NO_SQUARE { return None; }
    let (us, them) = (x.side, x.side ^ WHITE);
    let white = us == WHITE;
    let (op, ep) = (b[(us | PAWN) as usize], b[(them | PAWN) as usize]);
    let k = b[(us | KING) as usize];
    let chk = if white { sideways(north(k)) } else { sideways(south(k)) } & ep;    // the checking pawns
    if chk == 0 || pieces(b) { return None; }
    let t = tables();
    let atk = if white { sideways(south(ep)) } else { sideways(north(ep)) };
    let d = t.king[lsb(k)] & !op & !atk & !t.king[lsb(b[(them | KING) as usize])];
    if d.count_ones() != 1 { return None; }
    // an own pawn that takes a checking pawn would be a second move
    if (if white { sideways(south(chk)) } else { sideways(north(chk)) }) & op != 0 { return None; }
    // the position after the step: the king moved, an enemy pawn on its square taken, the other side to move
    let mut n = *b;
    n[(us | KING) as usize] = d;
    n[us as usize] = (b[us as usize] & !k) | d;
    n[(them | PAWN) as usize] &= !d;
    n[them as usize] &= !d;
    Some((n, them))
}

/// The gaps of the open pairs: squares with a white pawn below, a black pawn above, and no pawn.
#[inline(always)]
fn open_pairs(c: &Census) -> u64 { north(c.wp) & south(c.bp) & !(c.wp | c.bp) }

/// lock_test with open pairs (lockTestPairsFirst): at each level (free, then the frozen kings'
/// whose neighbours are all held) the open-pair rule first, then the level itself unless family A
/// already leaked to the flagged side (then the level leaks to it too).
#[inline(never)]
fn lock_test_pairs_first<F: Fn(&Census, u8, u64) -> bool, G: Fn(&Census, &GapIn, u64) -> Option<GapOut>>(c: &Census, flagged: u8, leaks: &F, gap: &G, gaps: u64) -> bool {
    let held = c.wp | c.bp | sideways(north(c.wp) | south(c.bp));
    let pairs = gap_pairs(gaps);
    let bit = flagged_bit(flagged);
    let t = tables();
    for fr in [0, c.wk, c.bk] {
        if fr != 0 && t.king[lsb(fr)] & !held != 0 { continue; }
        let mut refuted = 0;
        if let Some((p, k)) = &pairs {
            let (proven, r) = gap_families(c, &p[..*k], fr, bit, gap);
            if proven != 0 { return true; }
            refuted = r;
        }
        if refuted & bit == 0 && !leaks(c, flagged, fr) { return true; }
    }
    false
}

/// The lock detector for both sides at once: of the sides in `ask` (FLAGGED_* bits), those it
/// proves unable to be mated, the same answers as lock_test with each side flagged. A level is
/// computed once for both sides; a side is proven at the first level that does not leak to it.
#[inline(never)]
pub fn lock_test2(pos: &Position, ask: u8) -> u8 {
    let x = View::of(pos);
    if let Some((bb, side)) = forced_step(&x) { return lock_test2_after(&bb, side, ask); }
    lock_test2_view(&x, ask)
}

/// lock_test2 on the position after a forced step.
#[cold]
#[inline(never)]
fn lock_test2_after(bb: &[u64; 16], side: u8, ask: u8) -> u8 {
    let x = View { bb, side, ep: NO_SQUARE, castling: 0 };
    if let Some((nb, ns)) = forced_step(&x) { return lock_test2_after(&nb, ns, ask); }
    lock_test2_view(&x, ask)
}

#[inline(always)]
fn lock_test2_view(x: &View, ask: u8) -> u8 {
    let b = x.bb;
    if b[(WHITE | KNIGHT) as usize] | b[(BLACK | KNIGHT) as usize] | b[(WHITE | ROOK) as usize] | b[(BLACK | ROOK) as usize]
        | b[(WHITE | QUEEN) as usize] | b[(BLACK | QUEEN) as usize] != 0 { return if rook_or_queen_free(b) { 0 } else { boxed_test(x, ask) }; }
    if x.ep != NO_SQUARE { return 0; }
    let c = census(x);
    let gaps = open_pairs(&c);
    let got = if gaps != 0 { lock_test2_pairs_first(&c, ask, gaps) } else {
        let mut open = lock_leaks2(&c, 0, ask);       // the asked sides not proven yet
        if open != 0 {
            let held = c.wp | c.bp | sideways(north(c.wp) | south(c.bp));
            let t = tables();
            for king in [c.wk, c.bk] {
                if open == 0 { break; }
                if t.king[lsb(king)] & !held != 0 { continue; }
                open = lock_leaks2(&c, king, open);
            }
        }
        ask & !open
    };
    // the stuck mater, for the side to move, when the lock left it open
    let me = flagged_bit(x.side);
    if ask & me != 0 && got & me == 0 && mater_stuck(x, x.side) { got | me } else { got }
}

/// lock_test2 with open pairs: as lock_test_pairs_first, for the sides still open.
#[inline(never)]
fn lock_test2_pairs_first(c: &Census, ask: u8, gaps: u64) -> u8 {
    let held = c.wp | c.bp | sideways(north(c.wp) | south(c.bp));
    let pairs = gap_pairs(gaps);
    let t = tables();
    let mut open = ask;
    for fr in [0, c.wk, c.bk] {
        if open == 0 { break; }
        if fr != 0 && t.king[lsb(fr)] & !held != 0 { continue; }
        let mut refuted = 0;
        if let Some((p, k)) = &pairs {
            let (proven, r) = gap_families(c, &p[..*k], fr, open, &gap_level);
            open &= !proven; refuted = r;
        }
        let rest = open & !refuted;
        if rest != 0 { open &= !(rest & !lock_leaks2(c, fr, rest)); }
    }
    ask & !open
}

/// The static tests for both sides at once: of the sides in `ask` (FLAGGED_* bits), those that
/// cannot be mated by the material test or the lock detector (cannot_mate with each side flagged).
pub fn cannot_mate2(pos: &Position, ask: u8) -> u8 { tempo2(pos, ask, static_tests2(pos, ask, TESTS_BOTH)) }

/// Of the sides in `ask` the static tests left open (not in `proven`), those the stalemated flagged
/// side proves: `proven` with them. Not part of the static tests inside the search (static_tests,
/// static_tests2): a quiet move can complete it, where the search does not ask them. (tempo2)
#[inline]
pub fn tempo2(pos: &Position, ask: u8, mut proven: u8) -> u8 {
    if ask & !proven & FLAGGED_WHITE != 0 && tempo_stalemate(pos, WHITE) { proven |= FLAGGED_WHITE; }
    if ask & !proven & FLAGGED_BLACK != 0 && tempo_stalemate(pos, BLACK) { proven |= FLAGGED_BLACK; }
    proven
}

/// The flagged side cannot be mated: the lock detector certifies it, or the stalemated flagged side. (lockCannotMate)
#[inline]
pub fn lock_cannot_mate(pos: &Position, flagged: u8) -> bool { lock_test(pos, flagged) || tempo_stalemate(pos, flagged) }

/// The static tests: either of the two (the lock with the stalemated flagged side). (cannotMate)
#[inline]
pub fn cannot_mate(pos: &Position, flagged: u8) -> bool { material_test(pos, flagged) || lock_test(pos, flagged) || tempo_stalemate(pos, flagged) }

// ─── When the static tests can change ────────────────────────────────────────────────────

/// Bits naming static tests, for the callers that ask only those whose answer can have changed.
pub const TEST_MATERIAL: u8 = 1;
pub const TEST_LOCK: u8 = 2;
pub const TESTS_BOTH: u8 = TEST_MATERIAL | TEST_LOCK;

/// The static tests whose answer a move can change (testsAfter). The material test reads the
/// pieces only, so only a capture or a promotion changes it. The lock detector reads the pawns,
/// the kings' and bishops' squares and the en passant square: a capture or a pawn move changes the
/// structure; a move after a double step can let the en passant right lapse (the detector fails
/// while it stands); and a king in a pawn's check stands on a square its reach would leave out, so
/// its step out of the check can complete a lock (pawn_check: the mover was in a pawn's check). Any
/// other king or bishop move stays inside its reach and leaves the fixed point as it was (the
/// reaches do not look at bishops, so a bishop's check changes nothing). A knight, rook or queen
/// fails the first version whatever it does; in the second, one that has just moved quietly has an
/// empty step square, so the boxed rule fails after it too. Asking only then proves the
/// same positions with the same node counts as asking after every capture or pawn move and one ply
/// later (the clock rule, halfmove <= 1, which needs no memory of the move before); a
/// pawn's check comes only from the move just played, so that rule covers the step out of it. A
/// test not asked can only cost a proof, never make a false one.
#[inline(always)]
pub fn tests_after(capture: bool, promotion: bool, pawn: bool, ep_before: bool, pawn_check: bool) -> u8 {
    (if capture || promotion { TEST_MATERIAL } else { 0 }) | (if capture || pawn || ep_before || pawn_check { TEST_LOCK } else { 0 })
}

/// Is the side to move in check by a pawn? (pawnCheck)
#[inline]
pub fn pawn_check(pos: &Position) -> bool {
    if pos.side == WHITE { sideways(north(pos.bb[(WHITE | KING) as usize])) & pos.bb[(BLACK | PAWN) as usize] != 0 }
    else { sideways(south(pos.bb[(BLACK | KING) as usize])) & pos.bb[(WHITE | PAWN) as usize] != 0 }
}

/// The static tests in `tests` for `flagged`.
#[inline]
pub fn static_tests(pos: &Position, flagged: u8, tests: u8) -> bool {
    (tests & TEST_MATERIAL != 0 && material_test(pos, flagged)) || (tests & TEST_LOCK != 0 && lock_test(pos, flagged))
}

/// The static tests in `tests` for the sides in `ask`: the sides proven.
pub fn static_tests2(pos: &Position, ask: u8, tests: u8) -> u8 {
    let mut proven = 0;
    if tests & TEST_MATERIAL != 0 {
        if ask & FLAGGED_WHITE != 0 && material_test(pos, WHITE) { proven |= FLAGGED_WHITE; }
        if ask & FLAGGED_BLACK != 0 && material_test(pos, BLACK) { proven |= FLAGGED_BLACK; }
    }
    let rest = ask & !proven;
    if rest != 0 && tests & TEST_LOCK != 0 { proven |= lock_test2(pos, rest); }
    proven
}
