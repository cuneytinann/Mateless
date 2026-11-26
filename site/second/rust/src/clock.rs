//! The search under a move rule, bounded by the clock (`src/clock.js`, the second version).
//!
//! Under a move rule the question for one side is: can it be mated before the game ends by
//! itself? From a position with the clock at c, the lines that make no capture and no pawn move
//! stay in the region: there the pawns stand still and the material does not change, and a line
//! lasts at most move_rule - c plies. A capture or a pawn move (an exit) puts the clock back to 0,
//! and the ladder's searches without the rule judge what may follow. The search walks the region
//! depth first, closed by the clock rather than by a ply ceiling, and cuts a position when a lower
//! bound on the plies to a mate or to an exit that is not dead by material is above the plies
//! left. src/clock.js explains the bound; each item here names its JavaScript counterpart, and the
//! moves, the budget and the cuts are the same, so a search plays the same nodes.

// The loops over squares, pieces and flights index several arrays at once, as clock.js does.
#![allow(clippy::needless_range_loop)]

use std::collections::HashMap;
use crate::board::{BISHOP, Ctx, FLAG_CASTLE, FLAG_EP, FLAG_PROMO, generate_legal_moves, has_legal_move, in_check, KING,
    KNIGHT, make, MOVE_STRIDE, NO_SQUARE, PAWN, Position, PROMOTION_ORDER, QUEEN, rights_from_skeleton, ROOK,
    STANDARD_SKELETON, unmake, WHITE, write_key};
use crate::domino::{Failure, PositionSet, SearchResult};

/// No bound: more plies than any rule allows. (CLOCK_INF)
const INF: i16 = 1000;
/// The search under a move rule runs where the rule can end a line within this many plies (or the
/// caller's ply ceiling, if higher): 20 moves of each side. (REGION_REACH)
pub const REGION_REACH: u32 = 40;
/// More of the mater's pieces than this, and a net's cover is only its dearest single target.
const EXACT_PIECES: usize = 4;

const KNIGHT_STEPS: [(i32, i32); 8] = [(1, 2), (2, 1), (2, -1), (1, -2), (-1, -2), (-2, -1), (-2, 1), (-1, 2)];
const KING_STEPS: [(i32, i32); 8] = [(1, 0), (1, 1), (0, 1), (-1, 1), (-1, 0), (-1, -1), (0, -1), (1, -1)];
const ROOK_DIRS: [(i32, i32); 4] = [(1, 0), (-1, 0), (0, 1), (0, -1)];
const BISHOP_DIRS: [(i32, i32); 4] = [(1, 1), (1, -1), (-1, 1), (-1, -1)];
const QUEEN_DIRS: [(i32, i32); 8] = [(1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)];

#[inline(always)]
fn king_distance(a: usize, b: usize) -> i32 {
    ((a & 7) as i32 - (b & 7) as i32).abs().max(((a >> 3) as i32 - (b >> 3) as i32).abs())
}

/// The plies of a line in which the mater makes m moves (the last one mates) and the defender f.
/// (pliesFor)
#[inline(always)]
fn plies_for(m: i16, f: i16, mater_to_move: bool) -> i16 {
    if m >= INF || f >= INF { return INF; }
    if mater_to_move { 2 * m.max(f + 1).max(1) - 1 } else { 2 * m.max(f).max(1) }
}

/// The mater's pieces as a key: (type index * 64 + square) for each, in board order.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
struct Placement { n: u8, p: [u16; 16] }

/// The region of one pawn structure and one mater (regionBuild). Type indices: the piece types,
/// 7 for the mater's king, 0 for the defender's.
struct Region {
    is_pawn: [bool; 64], pawn_of: [u8; 64], pawn_att: [[bool; 64]; 2],
    dist: Vec<Vec<u8>>, att: Vec<Vec<u8>>,
    targets: Vec<Vec<u8>>, king_list: Vec<u8>, by_distance: Vec<Option<Box<[u8]>>>, mater: u8,
    cover: Vec<Option<Box<[i16]>>>, front: Vec<Option<Box<[u32]>>>, block: Vec<Option<Box<[i16]>>>,
    take: Vec<i16>, meet: Vec<Option<Box<[i16]>>>, trap: Option<Box<[i16]>>,
}

/// What a search keeps per placement of the mater's pieces (in its region): for each k the
/// cheapest check, the dearest single flight, the whole net, the second and third dearest flights
/// (5 x 64); and, with one defending piece, the net without flight i (64 x 9).
#[derive(Default)]
struct Known { nets: HashMap<Placement, Box<[i16; 320]>>, blocked: HashMap<Placement, Box<[i16; 576]>> }

impl Region {
    fn build(pos: &Position, mater: u8) -> Region {
        let board = &pos.board;
        let (mut is_pawn, mut pawn_of) = ([false; 64], [0u8; 64]);
        for s in 0..64 { if board[s] & 7 == PAWN { is_pawn[s] = true; pawn_of[s] = board[s] & WHITE; } }
        let mut pawn_att = [[false; 64]; 2];
        for s in 0..64 {
            if !is_pawn[s] { continue; }
            let c = pawn_of[s];
            let r = (s >> 3) as i32 + if c == WHITE { 1 } else { -1 };
            if !(0..8).contains(&r) { continue; }
            for df in [-1, 1] { let f = (s & 7) as i32 + df; if (0..8).contains(&f) { pawn_att[(c >> 3) as usize][(r * 8 + f) as usize] = true; } }
        }
        let dirs = |ty: u8| -> &'static [(i32, i32)] { if ty == ROOK { &ROOK_DIRS } else if ty == BISHOP { &BISHOP_DIRS } else { &QUEEN_DIRS } };
        let steps = |ty: u8, s: usize, king_colour: u8| -> Vec<usize> {
            let (f0, r0) = ((s & 7) as i32, (s >> 3) as i32);
            let mut out = Vec::new();
            if ty == KNIGHT || ty == KING {
                for &(df, dr) in if ty == KNIGHT { &KNIGHT_STEPS } else { &KING_STEPS } {
                    let (f, r) = (f0 + df, r0 + dr);
                    if !(0..8).contains(&f) || !(0..8).contains(&r) { continue; }
                    let t = (r * 8 + f) as usize;
                    if is_pawn[t] || (ty == KING && pawn_att[((king_colour ^ WHITE) >> 3) as usize][t]) { continue; }
                    out.push(t);
                }
                return out;
            }
            for &(df, dr) in dirs(ty) {
                let (mut f, mut r) = (f0 + df, r0 + dr);
                while (0..8).contains(&f) && (0..8).contains(&r) && !is_pawn[(r * 8 + f) as usize] { out.push((r * 8 + f) as usize); f += df; r += dr; }
            }
            out
        };
        let attack_row = |ty: u8, s: usize, out: &mut [u8]| {
            let (f0, r0) = ((s & 7) as i32, (s >> 3) as i32);
            if ty == KNIGHT || ty == KING {
                for &(df, dr) in if ty == KNIGHT { &KNIGHT_STEPS } else { &KING_STEPS } {
                    let (f, r) = (f0 + df, r0 + dr);
                    if (0..8).contains(&f) && (0..8).contains(&r) { out[(r * 8 + f) as usize] = 1; }
                }
                return;
            }
            for &(df, dr) in dirs(ty) {
                let (mut f, mut r) = (f0 + df, r0 + dr);
                while (0..8).contains(&f) && (0..8).contains(&r) { let t = (r * 8 + f) as usize; out[t] = 1; if is_pawn[t] { break; } f += df; r += dr; }
            }
        };
        let dist_table = |ty: u8, king_colour: u8| -> Vec<u8> {
            let mut d = vec![255u8; 4096];
            let adj: Vec<Vec<usize>> = (0..64).map(|s| if is_pawn[s] { Vec::new() } else { steps(ty, s, king_colour) }).collect();
            for s in 0..64 {
                if is_pawn[s] { continue; }
                let mut q = vec![s]; d[s * 64 + s] = 0;
                let mut h = 0;
                while h < q.len() {
                    let u = q[h]; h += 1;
                    let du = d[s * 64 + u];
                    for &v in &adj[u] { if d[s * 64 + v] == 255 { d[s * 64 + v] = du + 1; q.push(v); } }
                }
            }
            d
        };
        let defender = mater ^ WHITE;
        let mut dist = vec![Vec::new(); 8];
        let mut att = vec![Vec::new(); 8];
        for ty in [QUEEN, ROOK, BISHOP, KNIGHT] {
            dist[ty as usize] = dist_table(ty, 0);
            let mut a = vec![0u8; 4096];
            for s in 0..64 { attack_row(ty, s, &mut a[s * 64..s * 64 + 64]); }
            att[ty as usize] = a;
        }
        dist[7] = dist_table(KING, mater);
        dist[0] = dist_table(KING, defender);
        let mut a = vec![0u8; 4096];
        for s in 0..64 { attack_row(KING, s, &mut a[s * 64..s * 64 + 64]); }
        att[7] = a;
        let mater_pawn_att = pawn_att[(mater >> 3) as usize];
        let mut targets = Vec::with_capacity(64);
        let mut king_list = Vec::with_capacity(64);
        for k in 0..64usize {
            let mut t = vec![k as u8];
            if !is_pawn[k] && !mater_pawn_att[k] {
                king_list.push(k as u8);
                for &(df, dr) in &KING_STEPS {
                    let (f, r) = ((k & 7) as i32 + df, (k >> 3) as i32 + dr);
                    if !(0..8).contains(&f) || !(0..8).contains(&r) { continue; }
                    let x = (r * 8 + f) as usize;
                    if (is_pawn[x] && pawn_of[x] == defender) || mater_pawn_att[x] { continue; }
                    t.push(x as u8);
                }
            }
            targets.push(t);
        }
        Region { is_pawn, pawn_of, pawn_att, dist, att, targets, king_list, by_distance: vec![None; 64], mater,
                 cover: vec![None; 8 * 4096], front: vec![None; 8 * 4096], block: vec![None; 8 * 4096],
                 take: vec![-1; 8 * 4096], meet: vec![None; 8 * 64], trap: None }
    }

    /// The squares the defending king may stand on, nearest to fk first (ties from a1), the
    /// unreachable ones left out: mate_bound stops at the first that is too far. (kingOrder)
    fn king_order(&mut self, fk: usize) {
        let d = &self.dist[0];
        let mut out: Vec<u8> = self.king_list.iter().copied().filter(|&k| d[fk * 64 + k as usize] != 255).collect();
        // insertion sort by distance (the list is already from a1, and stays so within a distance)
        for i in 1..out.len() {
            let (x, dx) = (out[i], d[fk * 64 + out[i] as usize]);
            let mut j = i;
            while j > 0 && d[fk * 64 + out[j - 1] as usize] > dx { out[j] = out[j - 1]; j -= 1; }
            out[j] = x;
        }
        self.by_distance[fk] = Some(out.into_boxed_slice());
    }

    /// One mating piece (type index t, on s) against the net on k: its cover costs and its front.
    /// (pieceNet)
    fn piece_net(&mut self, t: usize, s: usize, k: usize) {
        let key = (t * 64 + s) * 64 + k;
        let tg = &self.targets[k];
        let n = tg.len();
        let size = 1usize << n;
        let mut c = vec![INF; size];
        let (d, a, is_king) = (&self.dist[t], &self.att[t], t == 7);
        let mut options: Vec<u32> = vec![0];
        for to in 0..64 {
            let dd = d[s * 64 + to];
            if dd == 255 || to == k || (is_king && king_distance(to, k) <= 1) { continue; }
            let mut mask = 0usize;
            for i in (if is_king { 1 } else { 0 })..n { if a[to * 64 + tg[i] as usize] != 0 { mask |= 1 << i; } }
            if mask == 0 { continue; }
            if (dd as i16) < c[mask] { c[mask] = dd as i16; }
            options.push((dd as u32) << 16 | mask as u32);
        }
        for b in 0..n { for sub in 0..size { if sub & (1 << b) == 0 && c[sub | (1 << b)] < c[sub] { c[sub] = c[sub | (1 << b)]; } } }
        c[0] = 0;
        options.sort_by(|x, y| (x >> 16).cmp(&(y >> 16)).then(((y & 0xffff).count_ones()).cmp(&(x & 0xffff).count_ones())));
        let mut front: Vec<u32> = Vec::new();
        for &o in &options {
            let m = o & 0xffff;
            if !front.iter().any(|&q| (q & 0xffff) & m == m) { front.push(o); }
        }
        self.cover[key] = Some(c.into_boxed_slice());
        self.front[key] = Some(front.into_boxed_slice());
    }
    #[inline(always)]
    fn cover_of(&mut self, t: usize, s: usize, k: usize, mask: usize) -> i16 {
        let key = (t * 64 + s) * 64 + k;
        if self.cover[key].is_none() { self.piece_net(t, s, k); }
        self.cover[key].as_ref().unwrap()[mask]
    }

    /// The mater's fewest moves to cover the targets `need` of the net on k. (materCover)
    fn mater_cover(&mut self, mt: &[usize], ms: &[usize], k: usize, need: usize) -> i16 {
        if need == 0 { return 0; }
        let n = mt.len();
        if n > EXACT_PIECES {
            let mut worst = 0;
            let mut b = need;
            while b != 0 {
                let bit = b & b.wrapping_neg(); b &= b - 1;
                let mut m = INF;
                for j in 0..n { let c = self.cover_of(mt[j], ms[j], k, bit); if c < m { m = c; } }
                if m > worst { worst = m; }
            }
            return worst;
        }
        for j in 0..n { if self.cover[(mt[j] * 64 + ms[j]) * 64 + k].is_none() { self.piece_net(mt[j], ms[j], k); } }
        let last: &[i16] = self.cover[(mt[n - 1] * 64 + ms[n - 1]) * 64 + k].as_ref().unwrap();
        let mut best = last[need];
        if n == 1 { return best; }
        let mut fronts: [&[u32]; EXACT_PIECES] = [&[]; EXACT_PIECES];
        for j in 0..n - 1 { fronts[j] = self.front[(mt[j] * 64 + ms[j]) * 64 + k].as_ref().unwrap(); }
        fn walk(fronts: &[&[u32]], last: &[i16], j: usize, left: usize, cost: i16, best: &mut i16) {
            if j == fronts.len() { let v = cost + last[left]; if v < *best { *best = v; } return; }
            for &o in fronts[j].iter() {
                let c = cost + (o >> 16) as i16;
                if c >= *best { break; }
                walk(fronts, last, j + 1, left & !((o & 0xffff) as usize), c, best);
            }
        }
        walk(&fronts[..n - 1], last, 0, need, 0, &mut best);
        best
    }

    /// The fewest moves for one defending piece to stand on each flight of the net on k. (blockerCost)
    fn blocker_cost(&mut self, ty: usize, s: usize, k: usize) -> [i16; 9] {
        let key = (ty * 64 + s) * 64 + k;
        if self.block[key].is_none() {
            let tg = &self.targets[k];
            let d = &self.dist[ty];
            let mut c = vec![INF; tg.len()];
            for i in 1..tg.len() { let dd = d[s * 64 + tg[i] as usize]; if dd != 255 { c[i] = dd as i16; } }
            self.block[key] = Some(c.into_boxed_slice());
        }
        let mut out = [INF; 9];
        out[..self.targets[k].len()].copy_from_slice(self.block[key].as_ref().unwrap());
        out
    }

    /// Moves for a piece (type t of colour `colour`, on s) to take the pawn on v. (takeMoves)
    fn take_moves(&mut self, t: u8, colour: u8, s: usize, v: usize) -> i16 {
        let ti = if t == KING { if colour == self.mater { 7 } else { 0 } } else { t as usize };
        let key = (ti * 64 + s) * 64 + v;
        let m = self.take[key];
        if m != -1 { return m; }
        let (d, a) = (&self.dist[ti], &self.att[if ti == 0 { 7 } else { ti }]);
        let mut m = INF;
        if a[s * 64 + v] != 0 { m = 1; } else {
            for to in 0..64 { if a[to * 64 + v] != 0 { let x = d[s * 64 + to]; if x != 255 && (x as i16) + 1 < m { m = x as i16 + 1; } } }
        }
        self.take[key] = m;
        m
    }

    /// The plies for a piece (type index ta, on sa) to take a piece (type tv, on sv) that may come
    /// to meet it. (meetPlies)
    fn meet_plies(&mut self, ta: usize, sa: usize, tv: usize, sv: usize, capturer_to_move: bool) -> i16 {
        let key = ((tv * 64 + sv) << 1) | capturer_to_move as usize;
        if let Some(row) = &self.meet[ta * 64 + sa] { let m = row[key]; if m != -1 { return m; } }
        let (da, dv) = (&self.dist[ta], &self.dist[tv]);
        let mut m = INF;
        for x in 0..64 {
            if x == sa { continue; }
            let (a, v) = (da[sa * 64 + x], dv[sv * 64 + x]);
            if a == 255 || v == 255 { continue; }
            let p = plies_for(a as i16, v as i16, capturer_to_move);
            if p < m { m = p; }
        }
        self.meet[ta * 64 + sa].get_or_insert_with(|| vec![-1i16; 8 * 64 * 2].into_boxed_slice())[key] = m;
        m
    }

    /// The plies for a piece (type tv of colour `colour`, on sv) to step where an enemy pawn takes
    /// it. (trapPlies)
    fn trap_plies(&mut self, tv: usize, colour: u8, sv: usize, capturer_to_move: bool) -> i16 {
        let key = (((((colour >> 3) as usize) * 8 + tv) * 64 + sv) << 1) | capturer_to_move as usize;
        if let Some(t) = &self.trap { let m = t[key]; if m != -1 { return m; } }
        let (dv, pa) = (&self.dist[tv], &self.pawn_att[((colour ^ WHITE) >> 3) as usize]);
        let mut m = INF;
        for x in 0..64 { if pa[x] { let v = dv[sv * 64 + x]; if v != 255 { let p = plies_for(1, v as i16, capturer_to_move); if p < m { m = p; } } } }
        self.trap.get_or_insert_with(|| vec![-1i16; 2 * 8 * 64 * 2].into_boxed_slice())[key] = m;
        m
    }
}

/// Material, for the exits that leave the mater without mating material. (materialOf)
#[derive(Clone, Copy, Default)]
struct Material { q: i32, r: i32, b: i32, n: i32, p: i32, other: i32 }

fn material_of(pos: &Position, mater: u8) -> Material {
    let mut m = Material::default();
    for s in 0..64 {
        let p = pos.board[s]; if p == 0 { continue; }
        let t = p & 7;
        if p & WHITE == mater {
            match t { QUEEN => m.q += 1, ROOK => m.r += 1, BISHOP => m.b += 1, KNIGHT => m.n += 1, PAWN => m.p += 1, _ => {} }
        } else if t != KING { m.other += 1; }
    }
    m
}
/// (deadByMaterial)
fn dead_by_material(m: &Material, mater: u8, victim: u8, victim_colour: u8) -> bool {
    let mut x = *m;
    if victim_colour == mater {
        match victim { QUEEN => x.q -= 1, ROOK => x.r -= 1, BISHOP => x.b -= 1, KNIGHT => x.n -= 1, PAWN => x.p -= 1, _ => {} }
    } else { x.other -= 1; }
    if x.q + x.r + x.b + x.n + x.p == 0 { return true; }
    x.p == 0 && x.q + x.r == 0 && x.b + x.n <= 1 && x.other == 0
}

/// The exits of one search. (exitPlanOf)
struct ExitPlan { pushes: Vec<(usize, u8)>, pawn_takes: [bool; 2], victims: [bool; 16], pawns: Vec<(usize, u8)>, has_pawn: [bool; 2] }

fn exit_plan(r: &Region, pos: &Position) -> ExitPlan {
    let (board, mater) = (&pos.board, r.mater);
    let mat = material_of(pos, mater);
    let mut x = ExitPlan { pushes: Vec::new(), pawn_takes: [false; 2], victims: [false; 16], pawns: Vec::new(), has_pawn: [false; 2] };
    for s in 0..64 {
        let p = board[s]; if p == 0 { continue; }
        let (t, c) = (p & 7, p & WHITE);
        if t == PAWN {
            let ahead = s as i32 + if c == WHITE { 8 } else { -8 };
            if !(0..64).contains(&ahead) { continue; }
            let ahead = ahead as usize;
            if !r.is_pawn[ahead] { x.pushes.push((ahead, c)); }
            for df in [-1i32, 1] {
                let f = (s & 7) as i32 + df; if !(0..8).contains(&f) { continue; }
                let v = (ahead as i32 + df) as usize;
                if r.is_pawn[v] && r.pawn_of[v] != c && !dead_by_material(&mat, mater, PAWN, r.pawn_of[v]) { x.pawn_takes[(c >> 3) as usize] = true; }
            }
            if !dead_by_material(&mat, mater, PAWN, c) { x.pawns.push((s, c ^ WHITE)); }
            x.has_pawn[(c >> 3) as usize] = true;
        } else if t != KING && !dead_by_material(&mat, mater, t, c) { x.victims[(c | t) as usize] = true; }
    }
    x
}

/// The search under a move rule (ClockSearch). Keeps the regions it has built, by pawn structure
/// and mater, for the searches that follow.
pub struct ClockSearch {
    pos: Position, seen: PositionSet, dead: PositionSet, moves: Vec<[u32; MOVE_STRIDE]>,
    regions: HashMap<(u8, u64, u64), Region>, known: HashMap<(u8, u64, u64), Known>, region: (u8, u64, u64), plan: Option<ExitPlan>,
    flagged: u8, move_rule: u32, budget: i64, failure: Failure, bounded: bool,
    mt: [usize; 16], ms: [usize; 16], nm: usize, ft: [usize; 16], fs: [usize; 16], nf: usize, fk: usize,
    pieces: [[usize; 16]; 2], np: [usize; 2], placement: Placement,
}

impl Default for ClockSearch { fn default() -> Self { Self::new() } }

impl ClockSearch {
    pub fn new() -> ClockSearch {
        ClockSearch { pos: Position::empty(rights_from_skeleton(&STANDARD_SKELETON)), seen: PositionSet::new(), dead: PositionSet::new(),
                      moves: vec![[0; MOVE_STRIDE]; 160], regions: HashMap::new(), known: HashMap::new(), region: (0, 0, 0), plan: None,
                      flagged: WHITE, move_rule: 0, budget: 0, failure: Failure::None, bounded: false,
                      mt: [0; 16], ms: [0; 16], nm: 0, ft: [0; 16], fs: [0; 16], nf: 0, fk: 0,
                      pieces: [[0; 16]; 2], np: [0; 2], placement: Placement { n: 0, p: [0; 16] } }
    }

    /// Can `flagged` be mated before the move rule ends the game? (ClockSearch.run) `repeat`: the
    /// repetition set, or None; `exit_dead(pos, flagged)`: the ladder at an exit, (proven, nodes).
    pub fn run(&mut self, root: &Position, flagged: u8, move_rule: u32, budget: i64, repeat: Option<&PositionSet>,
               exit_dead: &mut dyn FnMut(&Position, u8) -> (bool, i64)) -> SearchResult {
        self.pos.copy_from(root);
        self.flagged = flagged; self.move_rule = move_rule; self.budget = budget; self.failure = Failure::None;
        self.seen.clear(); self.dead.clear();
        let repeat = repeat.filter(|r| r.count() > 0);
        let mut ctx = Ctx::default();
        if !has_legal_move(&self.pos, &mut ctx) {
            let mated = self.pos.side == flagged && ctx.checks > 0;
            return SearchResult { proven: !mated, failure: if mated { Failure::Mate } else { Failure::None }, budget_left: budget, ruled: false };
        }
        let mater = flagged ^ WHITE;
        let b = &self.pos.bb;
        self.region = (mater, b[(WHITE | PAWN) as usize], b[PAWN as usize]);
        if !self.regions.contains_key(&self.region) {
            if self.regions.len() >= 64 { self.regions.clear(); self.known.clear(); }
            self.regions.insert(self.region, Region::build(&self.pos, mater));
            self.known.insert(self.region, Known::default());
        }
        self.plan = Some(exit_plan(&self.regions[&self.region], &self.pos));
        self.bounded = self.pos.castling == 0;
        let hit = self.node(0, repeat, exit_dead);
        let proven = !hit;
        SearchResult { proven, failure: if proven { Failure::None } else { self.failure }, budget_left: self.budget.max(0), ruled: proven }
    }

    fn node(&mut self, ply: usize, repeat: Option<&PositionSet>, exit_dead: &mut dyn FnMut(&Position, u8) -> (bool, i64)) -> bool {
        let k = write_key(&self.pos);
        if let Some(r) = repeat { if r.has(&k) { return false; } }          // the repetition rule ends the game: drawn
        if !self.seen.add_clock(k, self.pos.halfmove.min(0xfffe) as u16) { return false; }   // met before: covered there
        let rem = self.move_rule as i32 - self.pos.halfmove as i32;
        if rem <= 0 { return false; }                                      // the move rule ends the game
        if self.bounded && self.bound(rem as i16) > rem as i16 { return false; }
        if ply >= self.moves.len() { self.moves.push([0; MOVE_STRIDE]); }
        let n = generate_legal_moves(&self.pos, &mut self.moves[ply]);
        let flagged = self.flagged;
        for pass in 0..2 {
            for i in 0..n {
                let mv = self.moves[ply][i];
                let (from, to, flags) = ((mv & 63) as usize, ((mv >> 6) & 63) as usize, mv >> 12);
                let exit = (self.pos.board[to] != 0 && flags & FLAG_CASTLE == 0) || flags & FLAG_EP != 0 || self.pos.board[from] & 7 == PAWN;
                if exit != (pass == 0) { continue; }
                let choices = if flags & FLAG_PROMO != 0 { 4 } else { 1 };
                for c in 0..choices {
                    let b = self.budget; self.budget = b - 1;
                    if b <= 0 { self.failure = Failure::Budget; return true; }
                    let u = make(&mut self.pos, mv, PROMOTION_ORDER[c]);
                    let mut ctx = Ctx::default();
                    let hit = if self.pos.side == flagged && in_check(&self.pos) && !has_legal_move(&self.pos, &mut ctx) {
                        self.failure = Failure::Mate; true
                    } else if exit {
                        if !self.exit_is_dead(exit_dead) { self.failure = Failure::Horizon; true } else { false }
                    } else { self.node(ply + 1, repeat, exit_dead) };
                    unmake(&mut self.pos, &u);
                    if hit { return true; }
                }
            }
        }
        false
    }

    /// Is the exit on the board dead? Its nodes are paid from the budget. (exitIsDead)
    fn exit_is_dead(&mut self, exit_dead: &mut dyn FnMut(&Position, u8) -> (bool, i64)) -> bool {
        let k = write_key(&self.pos);
        if self.dead.has(&k) { return true; }
        let (proven, nodes) = exit_dead(&self.pos, self.flagged);
        self.budget -= nodes;
        if proven { self.dead.add(k); }
        proven
    }

    /// A lower bound on the plies to a mate or a live exit, or any value above rem. (bound)
    fn bound(&mut self, rem: i16) -> i16 {
        self.scan();
        let he = self.exit_bound();
        if he <= rem { return he; }
        he.min(self.mate_bound(rem))
    }

    /// The pieces on the board, all but the pawns, square by square from a1 (the bitboard's order).
    /// (scan)
    fn scan(&mut self) {
        let mater = self.region.0;
        let (mut nm, mut nf, mut fk) = (0, 0, 0);
        self.np = [0, 0];
        let bb = &self.pos.bb;
        let mut w = (bb[WHITE as usize] | bb[0]) & !(bb[(WHITE | PAWN) as usize] | bb[PAWN as usize]);
        while w != 0 {
            let s = w.trailing_zeros() as usize;
            w &= w - 1;
            let p = self.pos.board[s];
            let t = p & 7;
            let c = p & WHITE;
            let ci = (c >> 3) as usize;
            self.pieces[ci][self.np[ci]] = s; self.np[ci] += 1;
            if c == mater { self.mt[nm] = if t == KING { 7 } else { t as usize }; self.ms[nm] = s; nm += 1; }
            else if t == KING { fk = s; } else { self.ft[nf] = t as usize; self.fs[nf] = s; nf += 1; }
        }
        self.nm = nm; self.nf = nf; self.fk = fk;
        let mut pl = Placement { n: nm as u8, p: [0; 16] };
        for j in 0..nm { pl.p[j] = (self.mt[j] * 64 + self.ms[j]) as u16; }
        self.placement = pl;
    }

    /// The plies to an exit that is not dead by material. (exitBound)
    fn exit_bound(&mut self) -> i16 {
        if self.pos.ep != NO_SQUARE { return 1; }
        let side = self.pos.side;
        let r = self.regions.get_mut(&self.region).unwrap();
        let x = self.plan.as_ref().unwrap();
        let board = &self.pos.board;
        let mut best = INF;
        for &(ahead, c) in &x.pushes {
            let v = if board[ahead] != 0 { 2 } else if side == c { 1 } else { 2 };
            if v < best { if v == 1 { return 1; } best = v; }
        }
        for ci in 0..2 { if x.pawn_takes[ci] { let v = if side == (ci as u8) << 3 { 1 } else { 2 }; if v < best { if v == 1 { return 1; } best = v; } } }
        for vi in 0..2usize {
            let vcol = (vi as u8) << 3;
            let ccol = vcol ^ WHITE;
            let to_move = side == ccol;
            for j in 0..self.np[vi] {
                let sv = self.pieces[vi][j];
                let tv = board[sv] & 7;
                if tv == KING || !x.victims[(vcol | tv) as usize] { continue; }
                let cj = (ccol >> 3) as usize;
                for q in 0..self.np[cj] {
                    let sa = self.pieces[cj][q];
                    let t = board[sa] & 7;
                    let ta = if t == KING { if ccol == r.mater { 7 } else { 0 } } else { t as usize };
                    let m = r.meet_plies(ta, sa, tv as usize, sv, to_move);
                    if m < best { if m == 1 { return 1; } best = m; }
                }
                if x.has_pawn[cj] { let m = r.trap_plies(tv as usize, vcol, sv, to_move); if m < best { if m == 1 { return 1; } best = m; } }
            }
        }
        for &(v, by) in &x.pawns {
            let bi = (by >> 3) as usize;
            for j in 0..self.np[bi] {
                let s = self.pieces[bi][j];
                let m = r.take_moves(board[s] & 7, by, s, v);
                if m >= INF { continue; }
                let p = if side == by { 2 * m - 1 } else { 2 * m };
                if p < best { if p == 1 { return 1; } best = p; }
            }
        }
        best
    }

    /// The plies to a mate in the region, or any value above limit. (mateBound)
    fn mate_bound(&mut self, limit: i16) -> i16 {
        let (nm, nf, fk) = (self.nm, self.nf, self.fk);
        let (mt, ms) = (&self.mt[..nm], &self.ms[..nm]);
        if !mt.iter().any(|&t| t != 7) { return INF; }                    // a king alone gives no check
        let r = self.regions.get_mut(&self.region).unwrap();
        let kn = self.known.get_mut(&self.region).unwrap();
        // plies_for(m, f) <= limit exactly when max(m, f + (1 with the mater to move), 1) <= most
        let mater_to_move = self.pos.side == r.mater;
        let most = if mater_to_move { (limit + 1) >> 1 } else { limit >> 1 };
        let max_f = if mater_to_move { most - 1 } else { most };
        if kn.nets.len() >= 300_000 && !kn.nets.contains_key(&self.placement) { kn.nets.clear(); }
        let known = kn.nets.entry(self.placement).or_insert_with(|| Box::new([-1i16; 320]));
        if most < 1 { return INF; }
        if r.by_distance[fk].is_none() { r.king_order(fk); }
        let kings = r.by_distance[fk].take().unwrap();       // taken out while r is borrowed, put back below
        let found = 'search: { for &k8 in kings.iter() {
            let k = k8 as usize;
            let f_k = r.dist[0][fk * 64 + k] as i16;
            if f_k > max_f { break; }                                    // the rest are as far or farther
            let mut check = known[k];
            if check == -1 {
                check = INF;
                for j in 0..nm { if mt[j] != 7 { let c = r.cover_of(mt[j], ms[j], k, 1); if c < check { check = c; } } }
                known[k] = check;
            }
            if check > most { continue; }
            let n = r.targets[k].len();
            let full = (1usize << n) - 1;
            if known[64 + k] == -1 {
                let (mut a, mut b, mut c3) = (0i16, 0i16, 0i16);       // the three dearest single flights
                for i in 1..n {
                    let mut m = INF;
                    for j in 0..nm { let c = r.cover_of(mt[j], ms[j], k, 1 << i); if c < m { m = c; } }
                    if m > a { c3 = b; b = a; a = m; } else if m > b { c3 = b; b = m; } else if m > c3 { c3 = m; }
                }
                known[64 + k] = a; known[192 + k] = b; known[256 + k] = c3;
            }
            let single = match nf { 0 => known[64 + k], 1 => known[192 + k], 2 => known[256 + k], _ => 0 };
            if single > most { continue; }
            if nf <= 1 {
                let mut net = known[128 + k];
                if net == -1 { net = r.mater_cover(mt, ms, k, full); known[128 + k] = net; }
                let p = plies_for(net, f_k, mater_to_move);
                if p <= limit { break 'search p; }
                if nf == 1 {
                    // one defending piece: it takes no flight, or flight i
                    if kn.blocked.len() >= 50_000 && !kn.blocked.contains_key(&self.placement) { kn.blocked.clear(); }
                    let rest = kn.blocked.entry(self.placement).or_insert_with(|| Box::new([-1i16; 576]));
                    let c = r.blocker_cost(self.ft[0], self.fs[0], k);
                    for i in 1..n {
                        if c[i] >= INF || plies_for(check, f_k + c[i], mater_to_move) > limit { continue; }
                        let mut v = rest[k * 9 + i];
                        if v == -1 { v = r.mater_cover(mt, ms, k, full & !(1 << i)); rest[k * 9 + i] = v; }
                        let p = plies_for(v, f_k + c[i], mater_to_move);
                        if p <= limit { break 'search p; }
                    }
                }
            } else {
                // the defending pieces may stand on flights instead, each on one
                let mut costs = [[INF; 9]; 16];
                for j in 0..nf { costs[j] = r.blocker_cost(self.ft[j], self.fs[j], k); }
                let mut found = INF;
                #[allow(clippy::too_many_arguments)]
                fn place(r: &mut Region, mt: &[usize], ms: &[usize], k: usize, n: usize, full: usize, costs: &[[i16; 9]], check: i16,
                         mater_to_move: bool, limit: i16, j: usize, taken: usize, f: i16, found: &mut i16) {
                    if *found <= limit { return; }
                    if j == costs.len() {
                        let p = plies_for(r.mater_cover(mt, ms, k, full & !taken), f, mater_to_move);
                        if p < *found { *found = p; }
                        return;
                    }
                    place(r, mt, ms, k, n, full, costs, check, mater_to_move, limit, j + 1, taken, f, found);
                    let c = costs[j];
                    for i in 1..n {
                        if taken & (1 << i) == 0 && c[i] < INF && plies_for(check, f + c[i], mater_to_move) <= limit {
                            place(r, mt, ms, k, n, full, costs, check, mater_to_move, limit, j + 1, taken | (1 << i), f + c[i], found);
                        }
                    }
                }
                place(r, mt, ms, k, n, full, &costs[..nf], check, mater_to_move, limit, 0, 0, f_k, &mut found);
                if found <= limit { break 'search found; }
            }
        } INF };
        r.by_distance[fk] = Some(kings);
        found
    }
}
