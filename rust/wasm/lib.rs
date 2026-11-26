//! Mateless as WebAssembly: the Rust port's ladder behind a small C ABI, for `mateless-wasm.js`.
//!
//! Strings go in through one input buffer (`input(len)` returns where to write `len` bytes), and
//! answers come out as return values, in one output array of i32 (`out()`), in a list of i32
//! (`list()`, moves) or in a text buffer (`text()`, a FEN). Positions, the flags of games and games
//! live here, in three tables, and JavaScript holds their indices (handles); a handle is valid
//! until it is freed. Nothing else is kept between calls.
//!
//! WebAssembly runs one call at a time, so the state is one global, reached through `state()`;
//! no call here calls back into JavaScript, so two calls never overlap.

use mateless::*;
use std::cell::UnsafeCell;

/// Failure codes in `out()`: 0 none, 1 mate, 2 horizon, 3 budget.
fn failure_code(f: Failure) -> i32 {
    match f { Failure::None => 0, Failure::Mate => 1, Failure::Horizon => 2, Failure::Budget => 3 }
}

/// FEN errors as negative handles: -1 syntax, -2 kings, -3 pawns, -4 castling, -5 en passant.
fn fen_error_code(e: &str) -> i32 {
    match e { "syntax" => -1, "kings" => -2, "pawnrank" => -3, "oppcheck" => -4, "pawns" => -5, "pieces" => -6,
              "promo" => -7, "captures" => -8, "checks" => -9, _ => -1 }
}

/// A table of values with handles: the index of a slot; freed slots are reused, last freed first.
struct Table<T> { slots: Vec<Option<T>>, free: Vec<usize> }

impl<T> Table<T> {
    const fn new() -> Self { Table { slots: Vec::new(), free: Vec::new() } }
    fn add(&mut self, value: T) -> i32 {
        match self.free.pop() {
            Some(i) => { self.slots[i] = Some(value); i as i32 }
            None => { self.slots.push(Some(value)); (self.slots.len() - 1) as i32 }
        }
    }
    fn remove(&mut self, h: i32) {
        if let Some(slot) = self.slots.get_mut(h as usize) { if slot.take().is_some() { self.free.push(h as usize); } }
    }
    fn get(&mut self, h: i32) -> Option<&mut T> { self.slots.get_mut(h as usize).and_then(|x| x.as_mut()) }
}

struct State {
    input: Vec<u8>,
    out: [i32; 16],
    list: Vec<i32>,
    text: Vec<u8>,
    positions: Table<Position>,
    flags: Table<Flags>,
    games: Table<Game>,
    search: Domino,
}

struct Global(UnsafeCell<Option<State>>);
// WebAssembly here is single-threaded and no export re-enters another: one &mut at a time.
unsafe impl Sync for Global {}
static GLOBAL: Global = Global(UnsafeCell::new(None));

fn state() -> &'static mut State {
    unsafe {
        (*GLOBAL.0.get()).get_or_insert_with(|| State {
            input: Vec::new(), out: [0; 16], list: Vec::new(), text: Vec::new(), positions: Table::new(), flags: Table::new(),
            games: Table::new(), search: Domino::new(),
        })
    }
}

fn position(h: i32) -> &'static Position {
    state().positions.get(h).map(|p| &*p).expect("mateless-wasm: no position with this handle")
}

/// Builds the attack tables now (otherwise the first FEN does).
#[no_mangle]
pub extern "C" fn init() { mateless::init(); }

/// Where to write `len` bytes of input (a FEN, as UTF-8).
#[no_mangle]
pub extern "C" fn input(len: u32) -> *mut u8 {
    let s = state();
    s.input.resize(len as usize, 0);
    s.input.as_mut_ptr()
}

/// The output array: 16 i32.
#[no_mangle]
pub extern "C" fn out() -> *const i32 { state().out.as_ptr() }

/// Reads the FEN in the input buffer (its first `len` bytes): a handle (>= 0), or a FEN error (< 0).
/// strict: 0 keeps only the syntax, the kings, the edge ranks and the side not to move out of
/// check (from_fen_with). What was put right (FIXED_* bits) goes to out[0].
#[no_mangle]
pub extern "C" fn position_from_fen(len: u32, strict: i32) -> i32 {
    let s = state();
    let text = match std::str::from_utf8(&s.input[..len as usize]) { Ok(t) => t, Err(_) => return -1 };
    match from_fen_with(text, strict != 0) {
        Ok(r) => { s.out[0] = r.fixed as i32; s.positions.add(r.pos) }
        Err(e) => fen_error_code(e),
    }
}

#[no_mangle]
pub extern "C" fn position_free(h: i32) { state().positions.remove(h); }

/// The side to move: WHITE (8) or BLACK (0).
#[no_mangle]
pub extern "C" fn position_side(h: i32) -> i32 { position(h).side as i32 }

#[no_mangle]
pub extern "C" fn position_halfmove(h: i32) -> i32 { position(h).halfmove as i32 }

/// Rung 1 for `flagged` (WHITE or BLACK): 1 when the material test proves it can never be mated.
#[no_mangle]
pub extern "C" fn material_test(h: i32, flagged: i32) -> i32 { mateless::material_test(position(h), flagged as u8) as i32 }

/// Rung 2 for `flagged`.
#[no_mangle]
pub extern "C" fn lock_test(h: i32, flagged: i32) -> i32 { mateless::lock_test(position(h), flagged as u8) as i32 }

/// Rungs 1 and 2 for `flagged`.
#[no_mangle]
pub extern "C" fn cannot_mate(h: i32, flagged: i32) -> i32 { mateless::cannot_mate(position(h), flagged as u8) as i32 }

/// Rungs 1 and 2 for the sides in `ask` (FLAGGED_WHITE 1, FLAGGED_BLACK 2): the sides proven.
#[no_mangle]
pub extern "C" fn cannot_mate2(h: i32, ask: i32) -> i32 { mateless::cannot_mate2(position(h), ask as u8) as i32 }

fn write_proof(at: usize, p: &Proof) {
    let o = &mut state().out;
    o[at] = p.proven as i32;
    o[at + 1] = p.static_proof as i32;
    o[at + 2] = failure_code(p.failure);
    o[at + 3] = p.nodes as i32;
}

/// The ladder for `flagged`: out[0..4] = proven, static proof, failure, nodes. Returns proven.
#[no_mangle]
pub extern "C" fn prove(h: i32, flagged: i32, max_ply: u32, budget: i32) -> i32 {
    let p = prove_cannot_be_mated(&mut state().search, position(h), flagged as u8, max_ply, budget as i64);
    write_proof(0, &p);
    p.proven as i32
}

/// The ladder for both sides in one pass: out[0..4] White flagged, out[4..8] Black flagged.
/// Returns the sides proven (FLAGGED_* bits).
#[no_mangle]
pub extern "C" fn prove_both(h: i32, max_ply: u32, budget: i32) -> i32 {
    let r = mateless::prove_both(&mut state().search, position(h), max_ply, budget as i64);
    write_proof(0, &r[0]);
    write_proof(4, &r[1]);
    (r[0].proven as i32) | ((r[1].proven as i32) << 1)
}

/// Is the position dead (FIDE 5.2.2)? The static tests for both sides in one pass, then the
/// searches one at a time, Black flagged first, as isDeadPosition in mateless.js.
#[no_mangle]
pub extern "C" fn is_dead(h: i32) -> i32 {
    let pos = position(h);
    let search = &mut state().search;
    let open = (FLAGGED_WHITE | FLAGGED_BLACK) & !mateless::cannot_mate2(pos, FLAGGED_WHITE | FLAGGED_BLACK);
    if open & FLAGGED_BLACK != 0 && !search.run(pos, BLACK, DOMINO_PLY, DOMINO_BUDGET, false).proven { return 0; }
    (open & FLAGGED_WHITE == 0 || search.run(pos, WHITE, DOMINO_PLY, DOMINO_BUDGET, false).proven) as i32
}

/// Leaf positions after `depth` plies (as a double: exact below 2^53).
#[no_mangle]
pub extern "C" fn perft(h: i32, depth: u32) -> f64 { mateless::perft(position(h), depth) as f64 }

/// The two flags of a new game: a handle.
#[no_mangle]
pub extern "C" fn flags_new() -> i32 { state().flags.add(Flags::new()) }

#[no_mangle]
pub extern "C" fn flags_free(f: i32) { state().flags.remove(f); }

fn flags(f: i32) -> &'static mut Flags {
    state().flags.get(f).expect("mateless-wasm: no flags with this handle")
}

/// Climbs the ladder for the position `h` of game ply `ply` (Flags::update). Returns the flags
/// that are down: 1 White (can never mate), 2 Black.
#[no_mangle]
pub extern "C" fn flags_update(f: i32, h: i32, ply: i32) -> i32 {
    let fl = flags(f);
    fl.update(position(h), ply as i64);
    (fl.white_down_at >= 0) as i32 | (((fl.black_down_at >= 0) as i32) << 1)
}

#[no_mangle]
pub extern "C" fn flags_white_down_at(f: i32) -> i32 { flags(f).white_down_at as i32 }

#[no_mangle]
pub extern "C" fn flags_black_down_at(f: i32) -> i32 { flags(f).black_down_at as i32 }

/// The game is back at ply `ply` (moves taken back): Flags::rewind.
#[no_mangle]
pub extern "C" fn flags_rewind(f: i32, ply: i32) { flags(f).rewind(ply as i64); }

/// Sets the plies at which the flags came down (-1: up).
#[no_mangle]
pub extern "C" fn flags_set(f: i32, white_down_at: i32, black_down_at: i32) {
    let fl = flags(f);
    fl.white_down_at = white_down_at as i64;
    fl.black_down_at = black_down_at as i64;
}

// ─── Moves, FEN, games ──────────────────────────────────────────────────────────────────────────

/// The list of i32 the last call filled (legal moves: from | to << 6 | promotion << 12).
#[no_mangle]
pub extern "C" fn list() -> *const i32 { state().list.as_ptr() }

/// The text the last call wrote (a FEN, UTF-8).
#[no_mangle]
pub extern "C" fn text() -> *const u8 { state().text.as_ptr() }

fn put_moves(moves: Vec<(usize, usize, bool)>) -> i32 {
    let s = state();
    s.list.clear();
    s.list.extend(moves.iter().map(|&(f, t, p)| f as i32 | (t as i32) << 6 | (p as i32) << 12));
    s.list.len() as i32
}

fn put_text(t: String) -> i32 {
    let s = state();
    s.text.clear();
    s.text.extend_from_slice(t.as_bytes());
    s.text.len() as i32
}

/// The legal moves of the position `h` into list(); returns how many.
#[no_mangle]
pub extern "C" fn position_legal_moves(h: i32) -> i32 {
    let mut buf = [0u32; MOVE_STRIDE];
    let n = generate_legal_moves(position(h), &mut buf);
    put_moves(buf[..n].iter().map(|&m| ((m & 63) as usize, ((m >> 6) & 63) as usize, (m >> 12) & FLAG_PROMO != 0)).collect())
}

/// The FEN of the position `h` with move number `fullmove` into text(); returns its length.
#[no_mangle]
pub extern "C" fn position_fen(h: i32, fullmove: u32) -> i32 { put_text(to_fen(position(h), fullmove as u64)) }

fn game(g: i32) -> &'static mut Game {
    state().games.get(g).expect("mateless-wasm: no game with this handle")
}

/// A game from the position `h` under its own rules (GameOptions): a handle, or -1 when the
/// rules are not ones a Game accepts.
#[no_mangle]
pub extern "C" fn game_new(h: i32, move_rule: u32, repetition: u32, claim_moves: u32, claim_repetition: u32, rungs: u32,
                           domino_at_end: i32) -> i32 {
    let options = GameOptions { move_rule, repetition, claim_moves, claim_repetition, rungs: rungs as u8, domino_at_end: domino_at_end != 0 };
    match Game::new(position(h), options) { Ok(g) => state().games.add(g), Err(_) => -1 }
}

#[no_mangle]
pub extern "C" fn game_free(g: i32) { state().games.remove(g); }

/// Plays from → to (promotion: QUEEN, ROOK, BISHOP or KNIGHT) and returns the game status after
/// it; -1 when the move is not legal.
#[no_mangle]
pub extern "C" fn game_play(g: i32, from: u32, to: u32, promotion: u32) -> i32 {
    if from > 63 || to > 63 { return -1; }
    game(g).play(from as usize, to as usize, promotion as u8).map(|r| r as i32).unwrap_or(-1)
}

#[no_mangle]
pub extern "C" fn game_status(g: i32) -> i32 { game(g).status() as i32 }

#[no_mangle]
pub extern "C" fn game_claimable(g: i32) -> i32 { game(g).claimable() as i32 }

#[no_mangle]
pub extern "C" fn game_repetitions(g: i32) -> i32 { game(g).repetitions as i32 }

#[no_mangle]
pub extern "C" fn game_ply(g: i32) -> i32 { game(g).ply as i32 }

#[no_mangle]
pub extern "C" fn game_halfmove(g: i32) -> i32 { game(g).position.halfmove as i32 }

#[no_mangle]
pub extern "C" fn game_side(g: i32) -> i32 { game(g).position.side as i32 }

/// Brings the flags up to date; returns those that are down: 1 White (can never mate), 2 Black.
#[no_mangle]
pub extern "C" fn game_update_flags(g: i32) -> i32 {
    let gm = game(g);
    gm.update_flags();
    gm.never_mates(WHITE) as i32 | ((gm.never_mates(BLACK) as i32) << 1)
}

#[no_mangle]
pub extern "C" fn game_white_down_at(g: i32) -> i32 { game(g).flags.white_down_at as i32 }

#[no_mangle]
pub extern "C" fn game_black_down_at(g: i32) -> i32 { game(g).flags.black_down_at as i32 }

/// The verdict if the flag of `side` falls now (resigned 0), or `side` resigns (1).
#[no_mangle]
pub extern "C" fn game_verdict(g: i32, side: i32, resigned: i32) -> i32 { game(g).flag_verdict(side as u8, resigned != 0) as i32 }

/// The legal moves of the game's position into list(); returns how many.
#[no_mangle]
pub extern "C" fn game_legal_moves(g: i32) -> i32 { let m = game(g).legal_moves(); put_moves(m) }

/// The FEN of the game's position with move number `fullmove` into text(); returns its length.
#[no_mangle]
pub extern "C" fn game_fen(g: i32, fullmove: u32) -> i32 { let t = to_fen(&game(g).position, fullmove as u64); put_text(t) }
