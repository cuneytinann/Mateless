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

/// What the mating net reads at the end of a level; `occ`: squares occupied for good besides (the
/// boxed pieces' squares, 0 in every other level).
#[derive(Clone, Copy)]
struct LockSets { w_cone: u64, b_cone: u64, w_king: u64, b_king: u64, w_bish: u64, b_bish: u64, occ: u64 }

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
    Some(LockSets { w_cone, b_cone, w_king, b_king, w_bish, b_bish, occ: 0 })
}

/// The mating net: can the flagged king be caught by the pawns and bishops of the other side?
#[inline(always)]
fn net_leaks(s: &LockSets, flagged: u8) -> bool {
    let LockSets { w_cone, b_cone, w_king, b_king, w_bish, b_bish, occ } = *s;
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
    let flight = sideways(spare) | north(spare) | south(spare) | ((north(free) | south(free)) & sideways(free));
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
        let s = LockSets { w_cone: o.w_cone, b_cone: o.b_cone, w_king: o.w_king, b_king: o.b_king, w_bish: o.w_bish, b_bish: o.b_bish, occ: 0 };
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
// pieces walls for the pawns of both sides, two more leaks (a pawn can capture on a piece's square;
// a piece has a step square not held by a fixed pawn or a boxed piece of its colour) and no flight
// onto a piece's square. A quiet move of such a piece leaves it an empty step square, so the trigger
// (tests_after) is unchanged.

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

/// A side's knights, rooks and queens (x) and the squares they step to (steps).
struct Boxes { wx: u64, bx: u64, ws: u64, bs: u64 }

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
        let mw = !(nw_fixed | sideways(south(nb_fixed)) | near_frozen_black);
        let mb = !(nb_fixed | sideways(north(nw_fixed)) | near_frozen_white);
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
    if x.ws & !(w_fixed | (wx & boxed)) != 0 || x.bs & !(b_fixed | (bx & boxed)) != 0 { return None; }   // a piece may step
    Some((LockSets { w_cone, b_cone, w_king, b_king, w_bish, b_bish, occ: wx | bx }, boxed, w_fixed, b_fixed))
}

/// A first look before the boxed pieces' test, on words the caller has just read: a rook or queen
/// with a square beside it (east or west) not held by its own pawns and pieces. In a game that
/// settles it nearly always (96% of chasolver's Lichess positions with such pieces).
#[inline(always)]
fn rook_or_queen_free(b: &[u64; 16]) -> bool {
    let (wo, bo) = (b[(WHITE | ROOK) as usize] | b[(WHITE | QUEEN) as usize], b[(BLACK | ROOK) as usize] | b[(BLACK | QUEEN) as usize]);
    let w_own = wo | b[(WHITE | PAWN) as usize] | b[(WHITE | KNIGHT) as usize];
    let b_own = bo | b[(BLACK | PAWN) as usize] | b[(BLACK | KNIGHT) as usize];
    sideways(wo) & !w_own != 0 || sideways(bo) & !b_own != 0
}

/// The lock detector with knights, rooks or queens on the board (boxedTest): of the sides in `ask`,
/// those it proves (0 at once unless every such piece is boxed in by its own men).
#[inline(never)]
fn boxed_test(pos: &Position, ask: u8) -> u8 {
    let b = &pos.bb;
    let (wn, wr, wq) = (b[(WHITE | KNIGHT) as usize], b[(WHITE | ROOK) as usize], b[(WHITE | QUEEN) as usize]);
    let (bn, br, bq) = (b[(BLACK | KNIGHT) as usize], b[(BLACK | ROOK) as usize], b[(BLACK | QUEEN) as usize]);
    let (wx, bx) = (wn | wr | wq, bn | br | bq);
    let (w_own, b_own) = (b[(WHITE | PAWN) as usize] | wx, b[(BLACK | PAWN) as usize] | bx);
    let ws = match boxed_in(wn, wr, wq, w_own) { Some(s) => s, None => return 0 };
    let bs = match boxed_in(bn, br, bq, b_own) { Some(s) => s, None => return 0 };
    if pos.ep != NO_SQUARE { return 0; }
    if twin_bishops(b[(WHITE | BISHOP) as usize]) || twin_bishops(b[(BLACK | BISHOP) as usize]) { return 0; }
    let c = Census { wp: b[(WHITE | PAWN) as usize], bp: b[(BLACK | PAWN) as usize], wk: b[(WHITE | KING) as usize],
                     bk: b[(BLACK | KING) as usize], wb: b[(WHITE | BISHOP) as usize], bb: b[(BLACK | BISHOP) as usize] };
    let x = Boxes { wx, bx, ws, bs };
    let held = c.wp | c.bp | sideways(north(c.wp) | south(c.bp));
    let t = tables();
    let mut open = ask;
    for fr in [0, c.wk, c.bk] {
        if open == 0 { break; }
        if fr != 0 && t.king[lsb(fr)] & !held != 0 { continue; }
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
pub fn lock_test(pos: &Position, flagged: u8) -> bool { lock_test_with(pos, flagged, lock_leaks, gap_level) }

/// The lock detector with the reference fixed point (the plain loop), for checking that
/// `lock_test` gives the same verdict everywhere (examples/lockcheck.rs).
pub fn lock_test_reference(pos: &Position, flagged: u8) -> bool { lock_test_with(pos, flagged, lock_leaks_reference, gap_level_reference) }

#[inline(always)]
fn lock_test_with<F: Fn(&Census, u8, u64) -> bool, G: Fn(&Census, &GapIn, u64) -> Option<GapOut>>(pos: &Position, flagged: u8, leaks: F, gap: G) -> bool {
    let b = &pos.bb;
    // A knight, rook or queen on the board (the usual case in a game): only boxed ones may stay.
    if b[(WHITE | KNIGHT) as usize] | b[(BLACK | KNIGHT) as usize] | b[(WHITE | ROOK) as usize] | b[(BLACK | ROOK) as usize]
        | b[(WHITE | QUEEN) as usize] | b[(BLACK | QUEEN) as usize] != 0 { return !rook_or_queen_free(b) && boxed_test(pos, flagged_bit(flagged)) != 0; }
    if pos.ep != NO_SQUARE { return false; }
    if twin_bishops(b[(WHITE | BISHOP) as usize]) || twin_bishops(b[(BLACK | BISHOP) as usize]) { return false; }
    let c = Census { wp: b[(WHITE | PAWN) as usize], bp: b[(BLACK | PAWN) as usize], wk: b[(WHITE | KING) as usize],
                     bk: b[(BLACK | KING) as usize], wb: b[(WHITE | BISHOP) as usize], bb: b[(BLACK | BISHOP) as usize] };
    // With an open pair the levels below almost never prove a lock: the open-pair rule first.
    let gaps = open_pairs(&c);
    if gaps != 0 { return lock_test_pairs_first(&c, flagged, &leaks, &gap, gaps); }
    if !leaks(&c, flagged, 0) { return true; }
    let held = c.wp | c.bp | sideways(north(c.wp) | south(c.bp));
    let t = tables();
    for king in [c.wk, c.bk] {
        if t.king[lsb(king)] & !held != 0 { continue; }
        if !leaks(&c, flagged, king) { return true; }
    }
    false
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
    let b = &pos.bb;
    if b[(WHITE | KNIGHT) as usize] | b[(BLACK | KNIGHT) as usize] | b[(WHITE | ROOK) as usize] | b[(BLACK | ROOK) as usize]
        | b[(WHITE | QUEEN) as usize] | b[(BLACK | QUEEN) as usize] != 0 { return if rook_or_queen_free(b) { 0 } else { boxed_test(pos, ask) }; }
    if pos.ep != NO_SQUARE { return 0; }
    if twin_bishops(b[(WHITE | BISHOP) as usize]) || twin_bishops(b[(BLACK | BISHOP) as usize]) { return 0; }
    let c = Census { wp: b[(WHITE | PAWN) as usize], bp: b[(BLACK | PAWN) as usize], wk: b[(WHITE | KING) as usize],
                     bk: b[(BLACK | KING) as usize], wb: b[(WHITE | BISHOP) as usize], bb: b[(BLACK | BISHOP) as usize] };
    let gaps = open_pairs(&c);
    if gaps != 0 { return lock_test2_pairs_first(&c, ask, gaps); }
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
