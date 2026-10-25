//! Mateless as WebAssembly: the Rust port's ladder behind a small C ABI, for `mateless-wasm.js`.
//!
//! Strings go in through one input buffer (`input(len)` returns where to write `len` bytes), and
//! answers come out as return values or in one output array of i32 (`out()`). Positions and the
//! flags of games live here, in two tables, and JavaScript holds their indices (handles); a handle
//! is valid until it is freed. Nothing else is kept between calls.
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
    match e { "syntax" => -1, "kings" => -2, "pawns" => -3, "castling" => -4, "en passant" => -5, _ => -1 }
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
    positions: Table<Position>,
    flags: Table<Flags>,
    search: Domino,
}

struct Global(UnsafeCell<Option<State>>);
// WebAssembly here is single-threaded and no export re-enters another: one &mut at a time.
unsafe impl Sync for Global {}
static GLOBAL: Global = Global(UnsafeCell::new(None));

fn state() -> &'static mut State {
    unsafe {
        (*GLOBAL.0.get()).get_or_insert_with(|| State {
            input: Vec::new(), out: [0; 16], positions: Table::new(), flags: Table::new(), search: Domino::new(),
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
#[no_mangle]
pub extern "C" fn position_from_fen(len: u32) -> i32 {
    let s = state();
    let text = match std::str::from_utf8(&s.input[..len as usize]) { Ok(t) => t, Err(_) => return -1 };
    match from_fen(text) { Ok(p) => s.positions.add(p), Err(e) => fen_error_code(e) }
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
