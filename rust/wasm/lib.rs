//! Mateless as WebAssembly: the Rust port's ladder behind a small C ABI, for `mateless-wasm.js`.
//!
//! Strings go in through one input buffer (`input(len)` returns where to write `len` bytes), and
//! answers come out as return values or in one output array of i32 (`out()`). Positions and the
//! flags of games live here, in two tables, and JavaScript holds their indices (handles); a handle
//! is valid until it is freed. Under the rules (the second version) a game's history goes in
//! before the call that needs it: the codes of its positions (`history_keys(n)` and
//! `history_from_keys(n)`, nine i32 words each as mateless.js writes them, or `history_push(h)`
//! position by position, after `history_clear()`). Nothing else is kept between calls.
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
    positions: Table<Position>,
    flags: Table<Flags>,
    search: Domino,
    /// The game's history for the next call under a repetition rule, and the words it is read from.
    history: Vec<Key>,
    words: Vec<i32>,
}

struct Global(UnsafeCell<Option<State>>);
// WebAssembly here is single-threaded and no export re-enters another: one &mut at a time.
unsafe impl Sync for Global {}
static GLOBAL: Global = Global(UnsafeCell::new(None));

fn state() -> &'static mut State {
    unsafe {
        (*GLOBAL.0.get()).get_or_insert_with(|| State {
            input: Vec::new(), out: [0; 16], positions: Table::new(), flags: Table::new(), search: Domino::new(),
            history: Vec::new(), words: Vec::new(),
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
    o[at + 4] = p.ruled as i32;
}

/// Where to write the codes of `n` positions of a game's history, nine i32 words each (writeKey in
/// mateless.js: three bit planes and the white pieces, each as its low then its high word, then the
/// word of side, castling and en passant).
#[no_mangle]
pub extern "C" fn history_keys(n: u32) -> *mut i32 {
    let s = state();
    s.words.resize(9 * n as usize, 0);
    s.words.as_mut_ptr()
}

/// The history is the `n` codes written there.
#[no_mangle]
pub extern "C" fn history_from_keys(n: u32) {
    let s = state();
    s.history.clear();
    for i in 0..n as usize {
        let w = &s.words[9 * i..9 * i + 9];
        let word = |j: usize| (w[2 * j] as u32 as u64) | ((w[2 * j + 1] as u32 as u64) << 32);
        s.history.push(key_from_words([word(0), word(1), word(2), word(3), w[8] as u32 as u64]));
    }
}

/// An empty history; then history_push adds positions to it.
#[no_mangle]
pub extern "C" fn history_clear() { state().history.clear(); }

/// Adds the position `h` to the history.
#[no_mangle]
pub extern "C" fn history_push(h: i32) { let k = position_key(position(h)); state().history.push(k); }

/// The ladder for `flagged` with the limits given, under the rules given (0, 0: none; the history
/// set before): out[0..5] = proven, static proof, failure, nodes, the searches under the rules ran.
/// Returns proven.
#[no_mangle]
pub extern "C" fn prove(h: i32, flagged: i32, max_ply: u32, budget: i32, move_rule: u32, repetition: u32) -> i32 {
    let s = state();
    let pos = s.positions.get(h).map(|p| &*p).expect("mateless-wasm: no position with this handle");
    let p = prove_cannot_be_mated_rules(&mut s.search, pos, flagged as u8, max_ply, budget as i64,
                                        &Rules { move_rule, repetition, history: &s.history });
    write_proof(0, &p);
    p.proven as i32
}

/// The ladder for both sides in one pass: out[0..5] White flagged, out[5..10] Black flagged.
/// Returns the sides proven (FLAGGED_* bits).
#[no_mangle]
pub extern "C" fn prove_both(h: i32, max_ply: u32, budget: i32, move_rule: u32, repetition: u32) -> i32 {
    let s = state();
    let pos = s.positions.get(h).map(|p| &*p).expect("mateless-wasm: no position with this handle");
    let r = prove_both_rules(&mut s.search, pos, max_ply, budget as i64,
                             &Rules { move_rule, repetition, history: &s.history });
    write_proof(0, &r[0]);
    write_proof(5, &r[1]);
    (r[0].proven as i32) | ((r[1].proven as i32) << 1)
}

/// Is the position dead (FIDE 5.2.2)? The static tests for both sides in one pass, then the
/// searches one side at a time, Black flagged first, as isDeadPosition in mateless.js; under the
/// rules given.
#[no_mangle]
pub extern "C" fn is_dead(h: i32, move_rule: u32, repetition: u32) -> i32 {
    let s = state();
    let pos = s.positions.get(h).map(|p| &*p).expect("mateless-wasm: no position with this handle");
    is_dead_position_rules(&mut s.search, pos, &Rules { move_rule, repetition, history: &s.history }) as i32
}

/// Leaf positions after `depth` plies (as a double: exact below 2^53).
#[no_mangle]
pub extern "C" fn perft(h: i32, depth: u32) -> f64 { mateless::perft(position(h), depth) as f64 }

/// The two flags of a new game that ends at these rules (0, 0: none): a handle.
#[no_mangle]
pub extern "C" fn flags_new(move_rule: u32, repetition: u32) -> i32 { state().flags.add(Flags::with_rules(move_rule, repetition)) }

#[no_mangle]
pub extern "C" fn flags_free(f: i32) { state().flags.remove(f); }

fn flags(f: i32) -> &'static mut Flags {
    state().flags.get(f).expect("mateless-wasm: no flags with this handle")
}

/// Climbs the ladder for the position `h` of game ply `ply` (Flags::update), with the history set
/// before (under a repetition rule). Returns the flags that are down: 1 White (can never mate), 2 Black.
#[no_mangle]
pub extern "C" fn flags_update(f: i32, h: i32, ply: i32) -> i32 {
    let s = state();
    let pos = s.positions.get(h).map(|p| &*p).expect("mateless-wasm: no position with this handle");
    let fl = s.flags.get(f).expect("mateless-wasm: no flags with this handle");
    fl.update_with_history(pos, ply as i64, &s.history);
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
