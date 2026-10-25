//! Rung 2, the lock detector (`src/lock.js`), and the two static tests together: pawns, kings and
//! bishops form a structure that no series of legal moves can open. It reads the bitboards and the
//! en passant square only; it generates no move and searches nothing.

use crate::board::{BISHOP, BLACK, DARK_SQUARES, diagonal, FILE_A, FILE_H, KING, KNIGHT, lsb,
    NO_SQUARE, north, PAWN, Position, QUEEN, RANK_1, RANK_8, ROOK, sideways, south, tables, WHITE,
    zone};
use crate::material::material_test;

/// Bits naming the side that is to be proven unable to be mated (the flagged side), for the
/// functions that answer for both sides at once (cannot_mate2, Domino::run2, prove_both): a game's
/// two flags, and a dead position, need both answers.
pub const FLAGGED_WHITE: u8 = 1;
pub const FLAGGED_BLACK: u8 = 2;
/// The bit of `flagged` (WHITE or BLACK).
#[inline(always)]
pub fn flagged_bit(flagged: u8) -> u8 { if flagged == WHITE { FLAGGED_WHITE } else { FLAGGED_BLACK } }


/// Two bishops of one side on squares of one colour? (twinBishops)
fn twin_bishops(b: u64) -> bool { (b & DARK_SQUARES).count_ones() > 1 || (b & !DARK_SQUARES).count_ones() > 1 }

struct Census { wp: u64, bp: u64, wk: u64, bk: u64, wb: u64, bb: u64 }

/// One level of the lock detector by the plain loop (all ten sets updated on every pass): does the
/// structure leak with king `fr` frozen (0: none)? Kept as the reference for `lock_leaks` below.
fn lock_leaks_reference(c: &Census, flagged: u8, fr: u64) -> bool {
    let (wp, bp, wk, bk) = (c.wp, c.bp, c.wk, c.bk);
    let frozen_white = fr & wk != 0;
    let frozen_black = !frozen_white && fr != 0;
    let near_frozen_black = if frozen_black { zone(bk) } else { 0 };
    let near_frozen_white = if frozen_white { zone(wk) } else { 0 };
    let (mut w_cone, mut b_cone, mut w_fixed, mut b_fixed) = (wp, bp, wp, bp);
    let (mut w_king, mut b_king, mut w_bish, mut b_bish) = (wk, bk, c.wb, c.bb);
    let (mut b_take, mut w_take) = (bk, wk);
    loop {
        let w_wall = (wp & !b_take) | fr;
        let b_wall = (bp & !w_take) | fr;
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
    if (w_cone & RANK_8) | (b_cone & RANK_1) != 0 { return true; }                 // a pawn can promote
    if north(sideways(w_cone)) & b_cone != 0 { return true; }                       // a pawn can capture
    if frozen_white && w_king != wk { return true; }                                // the frozen king can move
    if frozen_black && b_king != bk { return true; }
    if diagonal(w_bish) & b_cone != 0 || diagonal(b_bish) & w_cone != 0 { return true; }   // a bishop meets a pawn's path
    // The mating net.
    let (attack, reach, free, spare);
    if flagged == WHITE {
        attack = diagonal(b_bish) | sideways(south(b_cone));
        reach = w_king;
        free = !(w_cone | zone(b_king) | attack);
        spare = free & !w_bish;
    } else {
        attack = diagonal(w_bish) | sideways(north(w_cone));
        reach = b_king;
        free = !(b_cone | zone(w_king) | attack);
        spare = free & !b_bish;
    }
    let flight = sideways(spare) | north(spare) | south(spare) | ((north(free) | south(free)) & sideways(free));
    attack & reach & !flight != 0
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

/// What the mating net reads at the end of a level.
#[derive(Clone, Copy)]
struct LockSets { w_cone: u64, b_cone: u64, w_king: u64, b_king: u64, w_bish: u64, b_bish: u64 }

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
    // The cycle.
    let (mut w_fixed, mut b_fixed, mut w_king, mut b_king, mut w_take, mut b_take) = (wp, bp, wk, bk, wk, bk);
    let (mut w_wall, mut b_wall) = (!0u64, !0u64);
    loop {
        let (pw, pb) = (w_wall, b_wall);
        w_wall = (wp & !b_take) | fr;
        b_wall = (bp & !w_take) | fr;
        let nw_fixed = w_fixed & w_wall & south(b_wall | w_fixed);
        let nb_fixed = b_fixed & b_wall & north(w_wall | b_fixed);
        // Same walls and same fixed pawns as the pass before: the kings and the capture squares are
        // already closed under the same masks, so nothing can change any more.
        if w_wall == pw && b_wall == pb && nw_fixed == w_fixed && nb_fixed == b_fixed { break; }
        let mw = !(nw_fixed | sideways(south(nb_fixed)) | near_frozen_black);
        let mb = !(nb_fixed | sideways(north(nw_fixed)) | near_frozen_white);
        let (nw_king, nb_king) = king_fill2(w_king, mw, b_king, mb);
        if (frozen_white && nw_king != wk) || (frozen_black && nb_king != bk) { return None; }   // the frozen king can move
        let t = b_take | nb_king;
        let nb_take = t | south(fill_south(t & !b_wall, !b_wall));
        let t = w_take | nw_king;
        let nw_take = t | north(fill_north(t & !w_wall, !w_wall));
        let changed = (nw_fixed ^ w_fixed) | (nb_fixed ^ b_fixed) | (nw_king ^ w_king) | (nb_king ^ b_king)
            | (nb_take ^ b_take) | (nw_take ^ w_take);
        w_fixed = nw_fixed; b_fixed = nb_fixed; w_king = nw_king; b_king = nb_king; w_take = nw_take; b_take = nb_take;
        if changed == 0 { break; }
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
    Some(LockSets { w_cone, b_cone, w_king, b_king, w_bish, b_bish })
}

/// The mating net: can the flagged king be caught by the pawns and bishops of the other side?
#[inline(always)]
fn net_leaks(s: &LockSets, flagged: u8) -> bool {
    let LockSets { w_cone, b_cone, w_king, b_king, w_bish, b_bish } = *s;
    let (attack, reach, free, spare);
    if flagged == WHITE {
        attack = diagonal(b_bish) | sideways(south(b_cone));
        reach = w_king;
        free = !(w_cone | zone(b_king) | attack);
        spare = free & !w_bish;
    } else {
        attack = diagonal(w_bish) | sideways(north(w_cone));
        reach = b_king;
        free = !(b_cone | zone(w_king) | attack);
        spare = free & !b_bish;
    }
    let flight = sideways(spare) | north(spare) | south(spare) | ((north(free) | south(free)) & sideways(free));
    attack & reach & !flight != 0
}

/// The lock detector: kings, pawns and bishops that no series of legal moves can open. (lockTest)
/// Kept out of line: inlined into the recursive Domino search it would bloat every level of it.
#[inline(never)]
pub fn lock_test(pos: &Position, flagged: u8) -> bool { lock_test_with(pos, flagged, lock_leaks) }

/// The lock detector with the reference fixed point (the plain loop), for checking that
/// `lock_test` gives the same verdict everywhere (examples/lockcheck.rs).
pub fn lock_test_reference(pos: &Position, flagged: u8) -> bool { lock_test_with(pos, flagged, lock_leaks_reference) }

#[inline(always)]
fn lock_test_with<F: Fn(&Census, u8, u64) -> bool>(pos: &Position, flagged: u8, leaks: F) -> bool {
    let b = &pos.bb;
    if b[(WHITE | KNIGHT) as usize] | b[(BLACK | KNIGHT) as usize] | b[(WHITE | ROOK) as usize] | b[(BLACK | ROOK) as usize]
        | b[(WHITE | QUEEN) as usize] | b[(BLACK | QUEEN) as usize] != 0 { return false; }
    if pos.ep != NO_SQUARE { return false; }
    if twin_bishops(b[(WHITE | BISHOP) as usize]) || twin_bishops(b[(BLACK | BISHOP) as usize]) { return false; }
    let c = Census { wp: b[(WHITE | PAWN) as usize], bp: b[(BLACK | PAWN) as usize], wk: b[(WHITE | KING) as usize],
                     bk: b[(BLACK | KING) as usize], wb: b[(WHITE | BISHOP) as usize], bb: b[(BLACK | BISHOP) as usize] };
    if !leaks(&c, flagged, 0) { return true; }
    let held = c.wp | c.bp | sideways(north(c.wp) | south(c.bp));
    let t = tables();
    for king in [c.wk, c.bk] {
        if t.king[lsb(king)] & !held != 0 { continue; }
        if !leaks(&c, flagged, king) { return true; }
    }
    false
}

/// The lock detector for both sides at once: of the sides in `ask` (FLAGGED_* bits), those it
/// proves unable to be mated, the same answers as lock_test with each side flagged. A level is
/// computed once for both sides; a side is proven at the first level that does not leak to it.
#[inline(never)]
pub fn lock_test2(pos: &Position, ask: u8) -> u8 {
    let b = &pos.bb;
    if b[(WHITE | KNIGHT) as usize] | b[(BLACK | KNIGHT) as usize] | b[(WHITE | ROOK) as usize] | b[(BLACK | ROOK) as usize]
        | b[(WHITE | QUEEN) as usize] | b[(BLACK | QUEEN) as usize] != 0 { return 0; }
    if pos.ep != NO_SQUARE { return 0; }
    if twin_bishops(b[(WHITE | BISHOP) as usize]) || twin_bishops(b[(BLACK | BISHOP) as usize]) { return 0; }
    let c = Census { wp: b[(WHITE | PAWN) as usize], bp: b[(BLACK | PAWN) as usize], wk: b[(WHITE | KING) as usize],
                     bk: b[(BLACK | KING) as usize], wb: b[(WHITE | BISHOP) as usize], bb: b[(BLACK | BISHOP) as usize] };
    let mut open = lock_leaks2(&c, 0, ask);       // the asked sides not proven yet
    if open == 0 { return ask; }
    let held = c.wp | c.bp | sideways(north(c.wp) | south(c.bp));
    let t = tables();
    for king in [c.wk, c.bk] {
        if t.king[lsb(king)] & !held != 0 { continue; }
        open = lock_leaks2(&c, king, open);
        if open == 0 { return ask; }
    }
    ask & !open
}

/// The static tests for both sides at once: of the sides in `ask` (FLAGGED_* bits), those that
/// cannot be mated by the material test or the lock detector (cannot_mate with each side flagged).
pub fn cannot_mate2(pos: &Position, ask: u8) -> u8 { static_tests2(pos, ask, TESTS_BOTH) }

/// The static tests: either of the two. (cannotMate)
#[inline]
pub fn cannot_mate(pos: &Position, flagged: u8) -> bool { material_test(pos, flagged) || lock_test(pos, flagged) }

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
/// reaches do not look at bishops, so a bishop's check changes nothing), and a knight, rook or
/// queen on the board fails the detector whatever it does. Asking only then proves the
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
