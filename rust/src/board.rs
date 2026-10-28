//! The reference board (`src/board.js`): pieces, bitboards, magic bitboards, legal move generation,
//! moves made and taken back, the exact code of a position, FEN. Everything Mateless stands on
//! and nothing it adds; standard techniques. A platform with a board of its own keeps it, and
//! gives each Mateless layer what that layer uses from here.

use std::sync::OnceLock;

// ─── 1. Pieces, colours, squares ─────────────────────────────────────────────────────────

pub const BLACK: u8 = 0;
pub const WHITE: u8 = 8;
pub const PAWN: u8 = 1;
pub const KING: u8 = 2;
pub const QUEEN: u8 = 3;
pub const KNIGHT: u8 = 4;
pub const ROOK: u8 = 5;
pub const BISHOP: u8 = 6;
pub const NO_SQUARE: i32 = -1;
pub const PROMOTION_ORDER: [u8; 4] = [QUEEN, ROOK, BISHOP, KNIGHT];


const PIECE_LETTERS: &[u8; 15] = b" pkqnrb  PKQNRB";


// ─── 2. Bitboards ────────────────────────────────────────────────────────────────────────

pub(crate) const FILE_A: u64 = 0x0101_0101_0101_0101;
pub(crate) const FILE_H: u64 = FILE_A << 7;
const FILE_AB: u64 = FILE_A | (FILE_A << 1);
const FILE_GH: u64 = FILE_H | (FILE_H >> 1);
pub(crate) const RANK_1: u64 = 0xff;
pub(crate) const RANK_8: u64 = 0xff << 56;
/// a1 is dark.
pub(crate) const DARK_SQUARES: u64 = 0xAA55_AA55_AA55_AA55;

#[inline(always)]
const fn bit(sq: usize) -> u64 { 1u64 << sq }
#[inline(always)]
pub(crate) fn lsb(w: u64) -> usize { (w.trailing_zeros() & 63) as usize }
/// Both horizontal neighbours of every square of the set.
#[inline(always)]
pub(crate) fn sideways(w: u64) -> u64 { ((w << 1) & !FILE_A) | ((w >> 1) & !FILE_H) }
/// Two files east and west.
#[inline(always)]
fn sideways2(w: u64) -> u64 { ((w << 2) & !FILE_AB) | ((w >> 2) & !FILE_GH) }
#[inline(always)]
pub(crate) fn north(w: u64) -> u64 { w << 8 }
#[inline(always)]
pub(crate) fn south(w: u64) -> u64 { w >> 8 }
/// Every square of the set together with its eight neighbours.
#[inline(always)]
pub(crate) fn zone(w: u64) -> u64 { let v = w | (w << 8) | (w >> 8); v | sideways(v) }
/// The four diagonal neighbours of every square of the set.
#[inline(always)]
pub(crate) fn diagonal(w: u64) -> u64 { sideways((w << 8) | (w >> 8)) }

struct Magic { mask: u64, magic: u64, shift: u32, offset: usize }

pub(crate) struct Tables {
    pub(crate) knight: [u64; 64],
    pub(crate) king: [u64; 64],
    white_pawn_attacks: [u64; 64],
    black_pawn_attacks: [u64; 64],
    between: Box<[[u64; 64]; 64]>,
    line: Box<[[u64; 64]; 64]>,
    rook: Vec<Magic>,
    bishop: Vec<Magic>,
    slider_attacks: Vec<u64>,
    rook_empty: [u64; 64],
    bishop_empty: [u64; 64],
}

const ROOK_DIRS: [(i32, i32); 4] = [(1, 0), (0, 1), (-1, 0), (0, -1)];
const BISHOP_DIRS: [(i32, i32); 4] = [(1, 1), (-1, 1), (-1, -1), (1, -1)];

fn step_table(steps: &[(i32, i32)]) -> [u64; 64] {
    let mut t = [0u64; 64];
    for sq in 0..64 {
        for &(df, dr) in steps {
            let (f, r) = ((sq & 7) as i32 + df, (sq >> 3) as i32 + dr);
            if (0..8).contains(&f) && (0..8).contains(&r) { t[sq] |= bit((8 * r + f) as usize); }
        }
    }
    t
}

fn slide(sq: usize, occ: u64, dirs: &[(i32, i32)]) -> u64 {
    let mut a = 0;
    for &(df, dr) in dirs {
        let (mut f, mut r) = ((sq & 7) as i32 + df, (sq >> 3) as i32 + dr);
        while (0..8).contains(&f) && (0..8).contains(&r) {
            let s = bit((8 * r + f) as usize);
            a |= s;
            if occ & s != 0 { break; }
            f += df; r += dr;
        }
    }
    a
}

fn relevant_mask(sq: usize, dirs: &[(i32, i32)]) -> u64 {
    let mut m = 0;
    for &(df, dr) in dirs {
        let (mut f, mut r) = ((sq & 7) as i32 + df, (sq >> 3) as i32 + dr);
        while (0..8).contains(&(f + df)) && (0..8).contains(&(r + dr)) {
            m |= bit((8 * r + f) as usize);
            f += df; r += dr;
        }
    }
    m
}

/// Magic numbers for the slider tables, found once by random search (seed 0x9E3779B97F4A7C15) and
/// kept here, so that building the tables takes about a millisecond. Building them checks every
/// occupancy: a magic that sent two different attack sets to one slot would stop the program.
const ROOK_MAGICS: [u64; 64] = [
    0x1080004008801020, 0x0840092002C03000, 0x1900200010400900, 0x0880100008000480,
    0x4200100420080200, 0x8100020100080400, 0x0200040110886200, 0x0200008040220411,
    0x0404800084400220, 0x0000401000402000, 0x0086001081220440, 0x0408800800100280,
    0x000A001201040820, 0x8848800200840080, 0x4001000100040200, 0x0442000102105084,
    0x9080010020804100, 0x0040404000201009, 0x0000808010002009, 0x2200090021D00100,
    0x0008008008040080, 0x0004004002010040, 0x0011040008015042, 0x00000A0001768104,
    0x0000800080204009, 0x2010004140002001, 0x9800200280100080, 0x1000100080080080,
    0x0442000A00049020, 0x2100040080020080, 0x0800120400900148, 0x0010040A00128541,
    0x2800804000800030, 0x1010002000400041, 0x4000200011004100, 0x0610008410800800,
    0x0400802402800800, 0xC100020080800400, 0x0002000802000401, 0x0182085882000401,
    0x0220204000808000, 0x2860100040024022, 0x0001002004110040, 0x99101042000A0020,
    0x0004080004008080, 0x0010040002008080, 0x2012004881020004, 0x8300842444820011,
    0x0088403882010200, 0x0820400080210100, 0x0110910040A00300, 0x0801100280080480,
    0x0242009008200600, 0x1002000489500200, 0x0040800200010080, 0x0091800041000080,
    0x0000209300488001, 0x04C1002414824001, 0x020020000B001041, 0x7000100004200901,
    0x8002002004100802, 0x30010002084C0007, 0x0888221800813004, 0x4000002840840112,
];
const BISHOP_MAGICS: [u64; 64] = [
    0xA010041108003100, 0x006082020A002900, 0x6810010619200000, 0x08281A0520000408,
    0x0001104001000400, 0x0018901008048400, 0x00040A0210245280, 0x000200210808A402,
    0x9140048410821200, 0x0800091010820041, 0x20504804832202C0, 0x0100091401081000,
    0x8021011140000012, 0x0810020804450400, 0x208B0542109008A2, 0x0080084A08040204,
    0x0040E2A80811244C, 0x2505022008008108, 0x0430220100420040, 0x010A040420220040,
    0x1105000290400000, 0x0093001200822120, 0x4000A62048043004, 0x280120048A015004,
    0x006090002A020814, 0x44042000240800D0, 0x01102800040A4400, 0x1004080080220040,
    0x0001001011004024, 0x0010044000805040, 0x0914041200820100, 0x0004821012821480,
    0x0024040500C05021, 0x0088611002080200, 0x0116080A00040020, 0x4000020080080080,
    0x2450450140840040, 0x0000880201484100, 0x0222020404020092, 0x8081110600002E00,
    0x2842101105000801, 0x1100809008001025, 0x00020202221C0400, 0x0422014022009020,
    0x0210046102100C00, 0xC004008082029102, 0x00AA461801101200, 0x0404080080201108,
    0x020542108C205002, 0x0410544804100100, 0x0040910841100000, 0x0400200042021100,
    0x00004204850400C0, 0x0200100410A42102, 0x1040020801210102, 0x0805040410420000,
    0x2884804130100200, 0x800C262201242000, 0x1058000194108800, 0x0014221054420204,
    0x0104000012A02200, 0x0200881003300100, 0x0140400202840100, 0x0402020801010201,
];

fn build_magics(dirs: &[(i32, i32)], magics: &[u64; 64], attacks: &mut Vec<u64>) -> Vec<Magic> {
    let mut out = Vec::with_capacity(64);
    for sq in 0..64 {
        let mask = relevant_mask(sq, dirs);
        let bits = mask.count_ones();
        let (magic, offset, size) = (magics[sq], attacks.len(), 1usize << bits);
        attacks.resize(offset + size, 0);
        let mut filled = vec![false; size];
        let mut sub = 0u64;
        loop {
            let a = slide(sq, sub, dirs);
            let i = (sub.wrapping_mul(magic) >> (64 - bits)) as usize;
            assert!(!filled[i] || attacks[offset + i] == a, "magic collision on square {}", sq);
            filled[i] = true;
            attacks[offset + i] = a;
            sub = sub.wrapping_sub(mask) & mask;
            if sub == 0 { break; }
        }
        out.push(Magic { mask, magic, shift: 64 - bits, offset });
    }
    out
}

fn build_tables() -> Tables {
    let knight = step_table(&[(1, 2), (2, 1), (2, -1), (1, -2), (-1, -2), (-2, -1), (-2, 1), (-1, 2)]);
    let king = step_table(&[(1, 0), (1, 1), (0, 1), (-1, 1), (-1, 0), (-1, -1), (0, -1), (1, -1)]);
    let white_pawn_attacks = step_table(&[(-1, 1), (1, 1)]);
    let black_pawn_attacks = step_table(&[(-1, -1), (1, -1)]);
    let mut between = Box::new([[0u64; 64]; 64]);
    let mut line = Box::new([[0u64; 64]; 64]);
    for a in 0..64usize {
        for b in 0..64usize {
            let (df, dr) = ((b & 7) as i32 - (a & 7) as i32, (b >> 3) as i32 - (a >> 3) as i32);
            if a == b || (df != 0 && dr != 0 && df.abs() != dr.abs()) { continue; }
            let (sf, sr) = (df.signum(), dr.signum());
            let (mut f, mut r) = ((a & 7) as i32 + sf, (a >> 3) as i32 + sr);
            while f != (b & 7) as i32 || r != (b >> 3) as i32 { between[a][b] |= bit((8 * r + f) as usize); f += sf; r += sr; }
            for s in [1, -1] {
                let (mut f, mut r) = ((a & 7) as i32, (a >> 3) as i32);
                while (0..8).contains(&f) && (0..8).contains(&r) { line[a][b] |= bit((8 * r + f) as usize); f += s * sf; r += s * sr; }
            }
        }
    }
    let mut slider_attacks = Vec::new();
    let rook = build_magics(&ROOK_DIRS, &ROOK_MAGICS, &mut slider_attacks);
    let bishop = build_magics(&BISHOP_DIRS, &BISHOP_MAGICS, &mut slider_attacks);
    let mut t = Tables { knight, king, white_pawn_attacks, black_pawn_attacks, between, line, rook, bishop, slider_attacks,
                         rook_empty: [0; 64], bishop_empty: [0; 64] };
    for sq in 0..64 { t.rook_empty[sq] = t.rook_attacks(sq, 0); t.bishop_empty[sq] = t.bishop_attacks(sq, 0); }
    t
}

impl Tables {
    #[inline(always)]
    fn rook_attacks(&self, sq: usize, occ: u64) -> u64 {
        let m = &self.rook[sq & 63];
        let i = m.offset + ((occ & m.mask).wrapping_mul(m.magic) >> m.shift) as usize;
        debug_assert!(i < self.slider_attacks.len());
        // SAFETY: build_magics filled offset .. offset + 2^(64 - shift) for this square, and the
        // index above is below that end for every occupancy.
        unsafe { *self.slider_attacks.get_unchecked(i) }
    }
    #[inline(always)]
    fn bishop_attacks(&self, sq: usize, occ: u64) -> u64 {
        let m = &self.bishop[sq & 63];
        let i = m.offset + ((occ & m.mask).wrapping_mul(m.magic) >> m.shift) as usize;
        debug_assert!(i < self.slider_attacks.len());
        // SAFETY: as in rook_attacks.
        unsafe { *self.slider_attacks.get_unchecked(i) }
    }
}

static TABLES: OnceLock<Tables> = OnceLock::new();
#[inline(always)]
pub(crate) fn tables() -> &'static Tables { TABLES.get_or_init(build_tables) }
/// Builds the tables now (otherwise the first call does).
pub fn init() { tables(); }

// ─── 3–4. Castling files, position ───────────────────────────────────────────────────────

#[derive(Clone, Copy)]
pub(crate) struct Undo { mv: u32, piece: u8, captured: u8, castling: u8, ep: i32, halfmove: u32 }

/// The fields the static tests read (the bitboards and the en passant square) come first, so that
/// a test reads two adjacent cache lines and the start of a third.
#[derive(Clone)]
#[repr(C)]
pub struct Position {
    /// Bitboards by piece code; bb[BLACK] = all black pieces, bb[WHITE] = all white pieces.
    pub bb: [u64; 16],
    /// The en passant square, kept only while a legal capture onto it exists.
    pub ep: i32,
    pub halfmove: u32,
    pub side: u8,
    /// Castling rights: 1 White king-side, 2 White queen-side, 4 Black king-side, 8 Black queen-side.
    pub castling: u8,
    /// The piece on each square, 0 when empty.
    pub board: [u8; 64],
    /// The rights lost for good when a piece leaves or lands on each square (the castling skeleton).
    rights_at: [u8; 64],
    undo: Vec<Undo>,
}

impl Position {
    pub(crate) fn empty(rights_at: [u8; 64]) -> Position {
        Position { board: [0; 64], bb: [0; 16], side: WHITE, castling: 0, ep: NO_SQUARE, halfmove: 0, rights_at, undo: Vec::new() }
    }
    /// Copies the position, not its undo stack (which starts empty, keeping its capacity).
    pub fn copy_from(&mut self, o: &Position) {
        self.board = o.board; self.bb = o.bb; self.side = o.side; self.castling = o.castling;
        self.ep = o.ep; self.halfmove = o.halfmove; self.rights_at = o.rights_at; self.undo.clear();
    }
    fn put(&mut self, sq: usize, piece: u8) {
        self.board[sq] = piece;
        self.bb[piece as usize] |= bit(sq);
        self.bb[(piece & WHITE) as usize] |= bit(sq);
    }
    #[inline(always)]
    pub fn king_square(&self, color: u8) -> usize { lsb(self.bb[(color | KING) as usize]) }
    #[inline(always)]
    fn occupied(&self) -> u64 { self.bb[0] | self.bb[8] }
}

pub(crate) fn rights_from_skeleton(skeleton: &[u8; 8]) -> [u8; 64] {
    let mut r = [0u8; 64];
    for f in 0..8 { r[f] = skeleton[f]; r[56 + f] = skeleton[f] << 2; }
    r
}
pub(crate) const STANDARD_SKELETON: [u8; 8] = [2, 0, 0, 0, 3, 0, 0, 1];

// ─── 5. Attacks ──────────────────────────────────────────────────────────────────────────

/// Is `sq` attacked by colour `by`, with the board occupied as `occ`? (attackedBy)
fn attacked_by(pos: &Position, sq: usize, by: u8, occ: u64) -> bool {
    let t = tables();
    let b = &pos.bb;
    let pawn_from = if by == WHITE { &t.black_pawn_attacks } else { &t.white_pawn_attacks };
    if pawn_from[sq] & b[(by | PAWN) as usize] != 0 { return true; }
    if t.knight[sq] & b[(by | KNIGHT) as usize] != 0 { return true; }
    if t.king[sq] & b[(by | KING) as usize] != 0 { return true; }
    let q = b[(by | QUEEN) as usize];
    let r = b[(by | ROOK) as usize] | q;
    if r != 0 && t.rook_attacks(sq, occ) & r != 0 { return true; }
    let bi = b[(by | BISHOP) as usize] | q;
    bi != 0 && t.bishop_attacks(sq, occ) & bi != 0
}

pub fn is_attacked(pos: &Position, sq: usize, by: u8) -> bool { attacked_by(pos, sq, by, pos.occupied()) }
pub fn in_check(pos: &Position) -> bool { is_attacked(pos, pos.king_square(pos.side), pos.side ^ WHITE) }

/// Is the en passant capture from → ep legal for the side to move? (epCaptureLegal)
fn ep_capture_legal(pos: &Position, from: usize, ep: usize) -> bool {
    let t = tables();
    let (us, them, b) = (pos.side, pos.side ^ WHITE, &pos.bb);
    let captured = ep ^ 8;
    let k = pos.king_square(us);
    let occ = (pos.occupied() & !bit(from) & !bit(captured)) | bit(ep);
    let pawn_from = if us == WHITE { &t.white_pawn_attacks } else { &t.black_pawn_attacks };
    if pawn_from[k] & b[(them | PAWN) as usize] & !bit(captured) != 0 { return false; }
    if t.knight[k] & b[(them | KNIGHT) as usize] != 0 { return false; }
    if t.king[k] & b[(them | KING) as usize] != 0 { return false; }
    let q = b[(them | QUEEN) as usize];
    if t.rook_attacks(k, occ) & (b[(them | ROOK) as usize] | q) != 0 { return false; }
    if t.bishop_attacks(k, occ) & (b[(them | BISHOP) as usize] | q) != 0 { return false; }
    true
}

/// Can a pawn of the side to move legally capture onto `ep`? (canCaptureEnPassant)
fn can_capture_en_passant(pos: &Position, ep: usize) -> bool {
    let t = tables();
    let from = if pos.side == WHITE { &t.black_pawn_attacks } else { &t.white_pawn_attacks };
    let mut p = from[ep] & pos.bb[(pos.side | PAWN) as usize];
    while p != 0 { let sq = lsb(p); p &= p - 1; if ep_capture_legal(pos, sq, ep) { return true; } }
    false
}

// ─── 6. Legal move generation ────────────────────────────────────────────────────────────

pub const FLAG_CASTLE: u32 = 1;
pub const FLAG_EP: u32 = 2;
pub const FLAG_DOUBLE: u32 = 4;
pub const FLAG_PROMO: u32 = 8;
pub const MOVE_STRIDE: usize = 256;

/// What move generation needs to know about the side to move (MoveContext).
#[derive(Clone, Copy, Default)]
pub struct Ctx { pub king: usize, pub checks: u8, ev: u64, pin: u64 }

/// (computeContext)
pub(crate) fn compute_context(pos: &Position) -> Ctx {
    let t = tables();
    let (us, them, b) = (pos.side, pos.side ^ WHITE, &pos.bb);
    let k = pos.king_square(us);
    let occ = pos.occupied();
    let rq = b[(them | ROOK) as usize] | b[(them | QUEEN) as usize];
    let bq = b[(them | BISHOP) as usize] | b[(them | QUEEN) as usize];
    let pawn_from = if us == WHITE { &t.white_pawn_attacks } else { &t.black_pawn_attacks };
    let check = (t.knight[k] & b[(them | KNIGHT) as usize]) | (pawn_from[k] & b[(them | PAWN) as usize])
        | (t.rook_attacks(k, occ) & rq) | (t.bishop_attacks(k, occ) & bq);
    let (checks, ev) = if check == 0 { (0, !0u64) }
        else if check & (check - 1) == 0 { let c = lsb(check); (1, t.between[k][c] | bit(c)) }
        else { (2, 0) };
    let mut pin = 0;
    let mut sn = (t.rook_empty[k] & rq) | (t.bishop_empty[k] & bq);
    while sn != 0 {
        let s = lsb(sn); sn &= sn - 1;
        let bl = t.between[k][s] & occ;
        if bl != 0 && bl & (bl - 1) == 0 && bl & b[us as usize] != 0 { pin |= bl; }
    }
    Ctx { king: k, checks, ev, pin }
}

/// May the king on king_sq castle with its rook on rook_sq right now? (castlingLegal)
fn castling_legal(pos: &Position, king_sq: usize, rook_sq: usize) -> bool {
    let them = pos.side ^ WHITE;
    let king_side = rook_sq > king_sq;
    let rank = king_sq & 56;
    let king_to = rank | if king_side { 6 } else { 2 };
    let rook_to = rank | if king_side { 5 } else { 3 };
    let (kl, kh) = (king_sq.min(king_to), king_sq.max(king_to));
    let (rl, rh) = (rook_sq.min(rook_to), rook_sq.max(rook_to));
    for sq in kl..=kh { if pos.board[sq] != 0 && sq != king_sq && sq != rook_sq { return false; } }
    for sq in rl..=rh { if pos.board[sq] != 0 && sq != king_sq && sq != rook_sq { return false; } }
    let occ = pos.occupied();
    for sq in kl..=kh { if attacked_by(pos, sq, them, occ) { return false; } }
    let after = (occ & !bit(king_sq) & !bit(rook_sq)) | bit(king_to) | bit(rook_to);
    !attacked_by(pos, king_to, them, after)
}

/// Every square attacked by `by` with the board occupied as `occ`. (enemyAttacks)
fn enemy_attacks(pos: &Position, by: u8, occ: u64) -> u64 {
    let t = tables();
    let b = &pos.bb;
    let p = b[(by | PAWN) as usize];
    let mut a = if by == WHITE { sideways(north(p)) } else { sideways(south(p)) };
    let n = b[(by | KNIGHT) as usize];
    if n != 0 {
        let (one, two) = (sideways(n), sideways2(n));
        a |= (one << 16) | (one >> 16) | (two << 8) | (two >> 8);
    }
    a |= t.king[pos.king_square(by)];
    let q = b[(by | QUEEN) as usize];
    let mut s = b[(by | ROOK) as usize] | q;
    while s != 0 { let sq = lsb(s); s &= s - 1; a |= t.rook_attacks(sq, occ); }
    s = b[(by | BISHOP) as usize] | q;
    while s != 0 { let sq = lsb(s); s &= s - 1; a |= t.bishop_attacks(sq, occ); }
    a
}

/// The legal targets of the piece on `from`, a piece of the side to move. (legalTargets)
#[inline(always)]
pub(crate) fn legal_targets(pos: &Position, from: usize, ctx: &Ctx) -> u64 {
    let ty = pos.board[from & 63] & 7;
    if ty == KING { return king_targets(pos, from, ctx); }
    let t = tables();
    let (us, them, b) = (pos.side, pos.side ^ WHITE, &pos.bb);
    let occ = pos.occupied();
    let mut m = ctx.ev;
    if ctx.pin & bit(from) != 0 { m &= t.line[ctx.king & 63][from & 63]; }
    match ty {
        PAWN => {
            let mut tg = 0;
            let ahead = if us == WHITE { from + 8 } else { from - 8 } & 63;
            if pos.board[ahead] == 0 {
                tg = bit(ahead);
                if (from >> 3) == if us == WHITE { 1 } else { 6 } {
                    let two = if us == WHITE { from + 16 } else { from - 16 } & 63;
                    if pos.board[two] == 0 { tg |= bit(two); }
                }
            }
            let attacks = if us == WHITE { &t.white_pawn_attacks } else { &t.black_pawn_attacks };
            tg = (tg | (attacks[from & 63] & b[them as usize])) & m;
            if pos.ep != NO_SQUARE {
                let ep = pos.ep as usize;
                if attacks[from & 63] & bit(ep) != 0 && ep_capture_legal(pos, from, ep) { tg |= bit(ep); }
            }
            tg
        }
        KNIGHT => t.knight[from & 63] & !b[us as usize] & m,
        BISHOP => t.bishop_attacks(from, occ) & !b[us as usize] & m,
        ROOK => t.rook_attacks(from, occ) & !b[us as usize] & m,
        QUEEN => (t.rook_attacks(from, occ) | t.bishop_attacks(from, occ)) & !b[us as usize] & m,
        _ => panic!("unknown piece {} on {}", pos.board[from & 63], from),
    }
}

/// The legal targets of the king of the side to move, on `from`: its steps to squares the enemy
/// does not attack (with the king off the board), and its castlings.
#[inline(never)]
fn king_targets(pos: &Position, from: usize, ctx: &Ctx) -> u64 {
    let t = tables();
    let (us, them, b) = (pos.side, pos.side ^ WHITE, &pos.bb);
    let occ = pos.occupied();
    {
        let mut targets = 0;
        let c = t.king[from & 63] & !b[us as usize];
        if c != 0 { targets = c & !enemy_attacks(pos, them, occ & !bit(from)); }
        if pos.castling != 0 && ctx.checks == 0 {
            let rank = from & 56;
            let rook = us | ROOK;
            for sq in rank..rank + 8 {
                if pos.board[sq] == rook && pos.castling & pos.rights_at[sq] != 0 && castling_legal(pos, from, sq) { targets |= bit(sq); }
            }
        }
        targets
    }
}

/// The flags of the move from → to for a piece of type `ty`. (flagsOf)
#[inline(always)]
pub(crate) fn flags_of(pos: &Position, ty: u8, from: usize, to: usize) -> u32 {
    if ty == PAWN {
        if to as i32 == pos.ep { return FLAG_EP; }
        if to == from + 16 || from == to + 16 { return FLAG_DOUBLE; }
        return if to < 8 || to > 55 { FLAG_PROMO } else { 0 };
    }
    if ty == KING { let target = pos.board[to]; if target != 0 && (target & WHITE) == pos.side { return FLAG_CASTLE; } }
    0
}

/// Writes the legal moves into `out` and returns their number, in the engine's order. (generateLegalMoves)
pub fn generate_legal_moves(pos: &Position, out: &mut [u32; MOVE_STRIDE]) -> usize {
    let ctx = compute_context(pos);
    let mut n = 0;
    let mut own = pos.bb[pos.side as usize];
    while own != 0 {
        let from = lsb(own); own &= own - 1;
        let ty = pos.board[from] & 7;
        let mut tg = legal_targets(pos, from, &ctx);
        while tg != 0 {
            let to = lsb(tg); tg &= tg - 1;
            out[n] = from as u32 | (to as u32) << 6 | flags_of(pos, ty, from, to) << 12;
            n += 1;
        }
    }
    n
}

/// The pawns of the side to move with no move even before pins and checks are considered: the
/// square ahead taken, nothing to capture, no en passant square. Their legal targets are empty, so a
/// loop over the pieces may skip them and still visit the others in the same order.
#[inline(always)]
pub(crate) fn stuck_pawns(pos: &Position) -> u64 {
    if pos.ep != NO_SQUARE { return 0; }
    let (us, b) = (pos.side, &pos.bb);
    let (empty, enemies) = (!pos.occupied(), b[(us ^ WHITE) as usize]);
    let free = if us == WHITE { (empty >> 8) | sideways(enemies >> 8) } else { (empty << 8) | sideways(enemies << 8) };
    b[(us | PAWN) as usize] & !free
}

/// Does the side to move have any legal move? (hasLegalMove)
pub(crate) fn has_legal_move(pos: &Position, ctx: &mut Ctx) -> bool {
    *ctx = compute_context(pos);
    if ctx.checks == 0 {
        // Out of check, a piece that is not pinned may make any of its moves: look for one among the
        // pieces that need no attack map (a pawn's push, a knight's step, a slider's ray) before the
        // king, whose moves need the enemy's attacks. The answer is the same yes or no.
        let t = tables();
        let (us, b, occ) = (pos.side, &pos.bb, pos.occupied());
        let (own, free) = (b[us as usize], !ctx.pin);
        let pawns = b[(us | PAWN) as usize] & free;
        if (if us == WHITE { pawns << 8 } else { pawns >> 8 }) & !occ != 0 { return true; }
        let mut n = b[(us | KNIGHT) as usize] & free;
        while n != 0 { let sq = lsb(n); n &= n - 1; if t.knight[sq] & !own != 0 { return true; } }
        let mut d = (b[(us | BISHOP) as usize] | b[(us | QUEEN) as usize]) & free;
        while d != 0 { let sq = lsb(d); d &= d - 1; if t.bishop_attacks(sq, occ) & !own != 0 { return true; } }
        let mut r = (b[(us | ROOK) as usize] | b[(us | QUEEN) as usize]) & free;
        while r != 0 { let sq = lsb(r); r &= r - 1; if t.rook_attacks(sq, occ) & !own != 0 { return true; } }
    }
    if legal_targets(pos, ctx.king, ctx) != 0 { return true; }
    if ctx.checks == 2 && pos.ep == NO_SQUARE { return false; }
    let mut own = pos.bb[pos.side as usize] & !stuck_pawns(pos);
    while own != 0 {
        let from = lsb(own); own &= own - 1;
        if from == ctx.king { continue; }
        if legal_targets(pos, from, ctx) != 0 { return true; }
    }
    false
}

// ─── 7. Making and unmaking moves ────────────────────────────────────────────────────────

/// Plays a generated move in place and keeps what is needed to take it back on the position's
/// undo stack. (doMove)
pub fn do_move(pos: &mut Position, mv: u32, promotion: u8) { let u = make(pos, mv, promotion); pos.undo.push(u); }

/// Takes back the last move made with do_move. (undoMove)
pub fn undo_move(pos: &mut Position) { let u = pos.undo.pop().expect("undo_move: no move to take back"); unmake(pos, &u); }

/// Plays a generated move in place and returns what is needed to take it back: the search keeps
/// that record in its own stack frame, with no undo stack to push to.
#[inline(always)]
pub(crate) fn make(pos: &mut Position, mv: u32, promotion: u8) -> Undo {
    let (from, to, flags) = ((mv & 63) as usize, ((mv >> 6) & 63) as usize, mv >> 12);
    let (us, them) = (pos.side, pos.side ^ WHITE);
    let piece = pos.board[from];
    let mut u = Undo { mv, piece, captured: 0, castling: pos.castling, ep: pos.ep, halfmove: pos.halfmove };
    let (f, t) = (bit(from), bit(to));
    if flags & FLAG_CASTLE != 0 {
        let rook = pos.board[to];
        let rank = from & 56;
        let king_to = rank | if to > from { 6 } else { 2 };
        let rook_to = rank | if to > from { 5 } else { 3 };
        pos.bb[piece as usize] ^= f ^ bit(king_to);
        pos.bb[rook as usize] ^= t ^ bit(rook_to);
        pos.bb[us as usize] ^= f ^ t ^ bit(king_to) ^ bit(rook_to);
        pos.board[from] = 0; pos.board[to] = 0; pos.board[king_to] = piece; pos.board[rook_to] = rook;
        pos.halfmove += 1;
    } else {
        let captured = pos.board[to];
        if captured != 0 {
            pos.bb[captured as usize] ^= t; pos.bb[them as usize] ^= t;
        } else if flags & FLAG_EP != 0 {
            let sq = to ^ 8;
            let pawn = pos.board[sq];
            pos.bb[pawn as usize] ^= bit(sq); pos.bb[them as usize] ^= bit(sq);
            pos.board[sq] = 0;
        }
        let moved = if flags & FLAG_PROMO != 0 { us | promotion } else { piece };
        pos.bb[piece as usize] ^= f;
        pos.bb[moved as usize] ^= t;
        pos.bb[us as usize] ^= f | t;
        pos.board[from] = 0; pos.board[to] = moved;
        pos.halfmove = if captured != 0 || piece & 7 == PAWN { 0 } else { pos.halfmove + 1 };
        u.captured = captured;
    }
    pos.castling &= !(pos.rights_at[from] | pos.rights_at[to]);
    pos.side = them;
    pos.ep = NO_SQUARE;
    if flags & FLAG_DOUBLE != 0 {
        let passed = (from + to) >> 1;
        if can_capture_en_passant(pos, passed) { pos.ep = passed as i32; }
    }
    u
}

/// Takes back a move made with make, from its record.
#[inline(always)]
pub(crate) fn unmake(pos: &mut Position, u: &Undo) {
    let (from, to, flags) = ((u.mv & 63) as usize, ((u.mv >> 6) & 63) as usize, u.mv >> 12);
    let them = pos.side;
    let us = them ^ WHITE;
    let (f, t) = (bit(from), bit(to));
    let piece = u.piece;
    if flags & FLAG_CASTLE != 0 {
        let rook = us | ROOK;
        let rank = from & 56;
        let king_to = rank | if to > from { 6 } else { 2 };
        let rook_to = rank | if to > from { 5 } else { 3 };
        pos.bb[piece as usize] ^= f ^ bit(king_to);
        pos.bb[rook as usize] ^= t ^ bit(rook_to);
        pos.bb[us as usize] ^= f ^ t ^ bit(king_to) ^ bit(rook_to);
        pos.board[king_to] = 0; pos.board[rook_to] = 0; pos.board[from] = piece; pos.board[to] = rook;
    } else {
        let moved = pos.board[to];
        pos.bb[moved as usize] ^= t;
        pos.bb[piece as usize] ^= f;
        pos.bb[us as usize] ^= f | t;
        pos.board[from] = piece; pos.board[to] = u.captured;
        if u.captured != 0 {
            pos.bb[u.captured as usize] ^= t; pos.bb[them as usize] ^= t;
        } else if flags & FLAG_EP != 0 {
            let sq = to ^ 8;
            let pawn = them | PAWN;
            pos.bb[pawn as usize] ^= bit(sq); pos.bb[them as usize] ^= bit(sq);
            pos.board[sq] = pawn;
        }
    }
    pos.side = us;
    pos.castling = u.castling;
    pos.ep = u.ep;
    pos.halfmove = u.halfmove;
}

/// Number of leaf positions after `depth` plies, promotions counted separately.
pub fn perft(pos: &Position, depth: u32) -> u64 {
    fn walk(p: &mut Position, left: u32) -> u64 {
        let mut moves = [0u32; MOVE_STRIDE];
        let n = generate_legal_moves(p, &mut moves);
        if left == 1 { return moves[..n].iter().map(|&m| if (m >> 12) & FLAG_PROMO != 0 { 4 } else { 1 }).sum(); }
        let mut nodes = 0;
        for &m in &moves[..n] {
            let choices = if (m >> 12) & FLAG_PROMO != 0 { 4 } else { 1 };
            for &promo in PROMOTION_ORDER.iter().take(choices) {
                let u = make(p, m, promo);
                nodes += walk(p, left - 1);
                unmake(p, &u);
            }
        }
        nodes
    }
    if depth == 0 { return 1; }
    let mut p = pos.clone();
    walk(&mut p, depth)
}

// ─── 8. Position identity ────────────────────────────────────────────────────────────────

/// The exact code of a position: three bit planes of the piece types, the white pieces, and one
/// word for side, castling and en passant. Equal codes mean equal positions. (writeKey)
#[derive(Clone, Copy, PartialEq, Eq, Default)]
pub(crate) struct Key([u64; 5]);

#[inline(always)]
pub(crate) fn write_key(pos: &Position) -> Key {
    let b = &pos.bb;
    Key([
        b[1] | b[9] | b[3] | b[11] | b[5] | b[13],
        b[2] | b[10] | b[3] | b[11] | b[6] | b[14],
        b[4] | b[12] | b[5] | b[13] | b[6] | b[14],
        b[8],
        (((pos.ep + 1) as u64) << 5) | if pos.side == WHITE { 16 } else { 0 } | pos.castling as u64,
    ])
}

/// A 64-bit hash of a code, one multiply; the table takes its top bits. Only for spreading codes
/// over the table: a match is always confirmed on the full code.
#[inline(always)]
pub(crate) fn hash_key(k: &Key) -> u64 {
    (k.0[0] ^ k.0[1].rotate_left(16) ^ k.0[2].rotate_left(32) ^ k.0[3].rotate_left(48) ^ k.0[4]).wrapping_mul(0x9E37_79B9_7F4A_7C15)
}


// ─── 12. FEN ─────────────────────────────────────────────────────────────────────────────

/// Reads a FEN, as fromFen in mateless.js: castling as KQkq (X-FEN) or Shredder file letters,
/// each right read against the board; the en passant square kept only when a legal capture exists.
pub fn from_fen(fen: &str) -> Result<Position, &'static str> {
    tables();
    let fields: Vec<&str> = fen.split_whitespace().collect();
    if fields.len() < 2 { return Err("syntax"); }
    let mut pieces = [0u8; 64];
    let (mut rank, mut file) = (7i32, 0i32);
    let (mut wk, mut bk) = (0, 0);
    for ch in fields[0].chars() {
        if ch == '/' { rank -= 1; file = 0; continue; }
        if ('1'..='8').contains(&ch) { file += ch as i32 - '0' as i32; continue; }
        let ty = match ch.to_ascii_lowercase() { 'p' => PAWN, 'k' => KING, 'q' => QUEEN, 'n' => KNIGHT, 'r' => ROOK, 'b' => BISHOP, _ => 0 };
        if ty == 0 || rank < 0 || file > 7 { return Err("syntax"); }
        let piece = ty | if ch.is_ascii_uppercase() { WHITE } else { BLACK };
        if piece == WHITE | KING { wk += 1; } else if piece == BLACK | KING { bk += 1; }
        pieces[(8 * rank + file) as usize] = piece;
        file += 1;
    }
    if wk != 1 || bk != 1 { return Err("kings"); }
    for f in 0..8 { if pieces[f] & 7 == PAWN || pieces[56 + f] & 7 == PAWN { return Err("pawns"); } }
    let mut skeleton = [0u8; 8];
    let mut castling = 0u8;
    for ch in fields.get(2).copied().unwrap_or("-").chars() {
        if ch == '-' { continue; }
        let up = ch.to_ascii_uppercase();
        let white = ch == up;
        let base = if white { 0 } else { 56 };
        let king_piece = if white { WHITE | KING } else { BLACK | KING };
        let king = pieces.iter().position(|&p| p == king_piece).unwrap() as i32 - base as i32;
        let rook = if white { WHITE | ROOK } else { BLACK | ROOK };
        if !(0..=7).contains(&king) { continue; }
        if up != 'K' && up != 'Q' && !('A'..='H').contains(&up) { return Err("castling"); }
        let mut rook_file = -1i32;
        if up == 'K' { for f in (king + 1..8).rev() { if pieces[(base + f) as usize] == rook { rook_file = f; break; } } }
        else if up == 'Q' { for f in 0..king { if pieces[(base + f) as usize] == rook { rook_file = f; break; } } }
        else { let f = up as i32 - 'A' as i32; if f != king && pieces[(base + f) as usize] == rook { rook_file = f; } }
        if rook_file < 0 { continue; }
        let digit = if rook_file > king { 1 } else { 2 };
        let (k, r) = (king as usize, rook_file as usize);
        if (skeleton[k] != 0 && skeleton[k] != 3) || (skeleton[r] != 0 && skeleton[r] != digit) { return Err("castling"); }
        skeleton[k] = 3;
        skeleton[r] = digit;
        castling |= digit << if white { 0 } else { 2 };
    }
    for d in [1, 2, 3] { if skeleton.iter().filter(|&&x| x == d).count() > 1 { return Err("castling"); } }
    let rights = if castling != 0 { rights_from_skeleton(&skeleton) } else { rights_from_skeleton(&STANDARD_SKELETON) };
    let mut pos = Position::empty(rights);
    for sq in 0..64 { if pieces[sq] != 0 { pos.put(sq, pieces[sq]); } }
    pos.side = match fields[1] { "w" => WHITE, "b" => BLACK, _ => return Err("syntax") };
    pos.castling = castling;
    let ep = fields.get(3).copied().unwrap_or("-");
    if ep != "-" {
        let e = ep.as_bytes();
        if e.len() != 2 || !(b'a'..=b'h').contains(&e[0]) || !(b'1'..=b'8').contains(&e[1]) { return Err("en passant"); }
        let sq = (8 * (e[1] - b'1') + (e[0] - b'a')) as i32;
        let behind = if pos.side == WHITE { sq - 8 } else { sq + 8 };
        if (sq >> 3) != if pos.side == WHITE { 5 } else { 2 } || pos.board[sq as usize] != 0
            || pos.board[behind as usize] != ((pos.side ^ WHITE) | PAWN) { return Err("en passant"); }
        if can_capture_en_passant(&pos, sq as usize) { pos.ep = sq; }
    }
    match fields.get(4) {
        None | Some(&"-") => {}
        Some(c) => { if !c.bytes().all(|b| b.is_ascii_digit()) || c.is_empty() { return Err("syntax"); } pos.halfmove = c.parse().unwrap_or(0); }
    }
    Ok(pos)
}

/// The board field of a FEN (for messages and tests).
pub fn placement(pos: &Position) -> String {
    let mut s = String::new();
    for rank in (0..8).rev() {
        let mut empty = 0;
        for file in 0..8 {
            let p = pos.board[8 * rank + file];
            if p == 0 { empty += 1; continue; }
            if empty > 0 { s.push((b'0' + empty) as char); empty = 0; }
            s.push(PIECE_LETTERS[p as usize] as char);
        }
        if empty > 0 { s.push((b'0' + empty) as char); }
        if rank > 0 { s.push('/'); }
    }
    s
}
