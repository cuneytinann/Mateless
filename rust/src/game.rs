//! A game played move by move (`Game` in `src/game.js`): its positions, how many times the
//! current one has occurred, the two flags, and the platform's own rules (when the game ends by
//! itself, when a draw may be claimed, how much of the ladder runs).

use crate::board::{compute_context, do_move, generate_legal_moves, has_legal_move, write_key, Key, Position,
    BLACK, FLAG_PROMO, MOVE_STRIDE, PROMOTION_ORDER, WHITE};
use crate::domino::{Domino, DOMINO_BUDGET, DOMINO_PLY};
use crate::ladder::{prove_cannot_be_mated, Flags};

/// The results a game can end with, as `src/game.js` numbers them; 0 while it goes on.
pub mod result {
    pub const NONE: u8 = 0;
    pub const WHITE_MATES: u8 = 1;
    pub const BLACK_MATES: u8 = 2;
    pub const STALEMATE: u8 = 3;
    pub const SEVENTY_FIVE_MOVES: u8 = 4;
    pub const FIVEFOLD: u8 = 5;
    pub const DEAD_POSITION: u8 = 6;
    pub const WHITE_ON_TIME: u8 = 7;
    pub const BLACK_ON_TIME: u8 = 8;
    pub const WHITE_BY_RESIGNATION: u8 = 9;
    pub const BLACK_BY_RESIGNATION: u8 = 10;
    pub const DRAW_ON_TIME: u8 = 11;
    pub const DRAW_ON_RESIGNATION: u8 = 12;
    pub const FIFTY_MOVES: u8 = 13;
    pub const THREEFOLD: u8 = 14;
}

/// Each result in words: RESULT_NAMES[code].
pub const RESULT_NAMES: [&str; 15] = ["ongoing", "white checkmates", "black checkmates", "stalemate", "75-move rule",
    "fivefold repetition", "dead position", "white wins on time", "black wins on time", "white wins by resignation",
    "black wins by resignation", "draw on time", "draw on resignation", "50-move rule", "threefold repetition"];

/// The draws a player may claim now (Game::claimable), as bits.
pub const CLAIM_FIFTY_MOVES: u8 = 1;
pub const CLAIM_THREEFOLD: u8 = 2;

/// A platform's own rules for a game; GameOptions::DEFAULT is FIDE's and the whole ladder.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct GameOptions {
    /// The game ends by itself at this halfmove clock: 150 (the 75-move rule) or 100 (the 50-move
    /// rule); 0 is 150. (In this version no rule changes a proof.)
    pub move_rule: u32,
    /// The game ends by itself at this occurrence of a position: 5 or 3; 0 is 5.
    pub repetition: u32,
    /// From which halfmove clock a draw may be claimed: 100 (FIDE 9.3) or 0 (no claim).
    pub claim_moves: u32,
    /// From which occurrence a draw may be claimed: 3 (FIDE 9.2) or 0 (no claim).
    pub claim_repetition: u32,
    /// How much of the ladder the flags climb: 1 the material test, 2 and the lock detector, 3
    /// the whole ladder.
    pub rungs: u8,
    /// With rungs 3: the Domino search runs only when a flag falls or a side resigns
    /// (flag_verdict), not after every move; a dead position is then found by the static tests.
    pub domino_at_end: bool,
}

impl GameOptions {
    pub const DEFAULT: GameOptions =
        GameOptions { move_rule: 0, repetition: 0, claim_moves: 100, claim_repetition: 3, rungs: 3, domino_at_end: false };
    /// The options a Game accepts, or why not.
    pub fn check(&self) -> Result<(), &'static str> {
        if !matches!(self.move_rule, 0 | 100 | 150) { return Err("Game: move_rule must be 0, 100 or 150"); }
        if !matches!(self.repetition, 0 | 3 | 5) { return Err("Game: repetition must be 0, 3 or 5"); }
        if !matches!(self.claim_moves, 0 | 100) { return Err("Game: claim_moves must be 0 or 100"); }
        if !matches!(self.claim_repetition, 0 | 3) { return Err("Game: claim_repetition must be 0 or 3"); }
        if !(1..=3).contains(&self.rungs) { return Err("Game: rungs must be 1, 2 or 3"); }
        Ok(())
    }
}

impl Default for GameOptions { fn default() -> Self { GameOptions::DEFAULT } }

/// A game: the current position, the code of every position since the start (a position before
/// the last capture or pawn move can never come back, so only those since are compared, every
/// other one, with the same side to move), and the two flags.
pub struct Game {
    pub position: Position,
    keys: Vec<Key>,
    /// How many times the current position has occurred.
    pub repetitions: u32,
    /// Plies played since the first position.
    pub ply: i64,
    /// The two flags "may still mate" (Flags), climbing the game's rungs (the Domino search only at
    /// the end with domino_at_end).
    pub flags: Flags,
    options: GameOptions,
    moves: [u32; MOVE_STRIDE],
    search: Domino,
}

impl Game {
    /// A game from `position` under `options` (GameOptions::check says which it refuses).
    pub fn new(position: &Position, options: GameOptions) -> Result<Game, &'static str> {
        options.check()?;
        let mut options = options;
        options.domino_at_end = options.rungs == 3 && options.domino_at_end;
        let mut p = position.clone();
        p.forget_undo();
        let keys = vec![write_key(&p)];
        Ok(Game { position: p, keys, repetitions: 1, ply: 0, flags: Flags::with_rungs(if options.domino_at_end { 2 } else { options.rungs }),
                  options, moves: [0; MOVE_STRIDE], search: Domino::new() })
    }
    pub fn options(&self) -> GameOptions { self.options }
    /// Has `color` been proven unable to mate, for the rest of the game?
    pub fn never_mates(&self, color: u8) -> bool { self.flags.never_mates(color) }
    /// Climbs the ladder for each side whose flag is still up, once per position (Flags::update).
    pub fn update_flags(&mut self) { self.flags.update(&self.position, self.ply); }
    fn count_repetitions(&self) -> u32 {
        let last = self.keys.len() - 1;
        let reach = (self.position.halfmove as usize).min(last);
        let mut count = 1;
        let mut back = 2;
        while back <= reach {
            if self.keys[last - back] == self.keys[last] { count += 1; }
            back += 2;
        }
        count
    }
    /// The legal moves of the current position, as (from, to, promotion?) squares a1 = 0 ... h8 = 63.
    pub fn legal_moves(&mut self) -> Vec<(usize, usize, bool)> {
        let n = generate_legal_moves(&self.position, &mut self.moves);
        self.moves[..n].iter().map(|&m| ((m & 63) as usize, ((m >> 6) & 63) as usize, (m >> 12) & FLAG_PROMO != 0)).collect()
    }
    /// Plays a legal move and returns the game status after it; Err when it is not legal.
    pub fn play(&mut self, from: usize, to: usize, promotion: u8) -> Result<u8, &'static str> {
        if !PROMOTION_ORDER.contains(&promotion) { return Err("promotion must be QUEEN, ROOK, BISHOP or KNIGHT"); }
        let n = generate_legal_moves(&self.position, &mut self.moves);
        let wanted = (from | (to << 6)) as u32;
        let mv = match self.moves[..n].iter().find(|&&m| m & 4095 == wanted) { Some(&m) => m, None => return Err("illegal move") };
        do_move(&mut self.position, mv, promotion);
        self.position.forget_undo();
        self.ply += 1;
        self.keys.push(write_key(&self.position));
        self.repetitions = self.count_repetitions();
        Ok(self.status())
    }
    /// The game status of the current position (the result codes above); brings the flags up to
    /// date. Checkmate and stalemate first, then a dead position (both flags down), then the
    /// repetition rule and the move rule.
    pub fn status(&mut self) -> u8 {
        let mut ctx = compute_context(&self.position);
        if !has_legal_move(&self.position, &mut ctx) {
            if ctx.checks == 0 { return result::STALEMATE; }
            return if self.position.side == WHITE { result::BLACK_MATES } else { result::WHITE_MATES };
        }
        self.update_flags();
        if self.never_mates(WHITE) && self.never_mates(BLACK) { return result::DEAD_POSITION; }
        let (rep, rule) = (if self.options.repetition == 3 { 3 } else { 5 }, if self.options.move_rule == 100 { 100 } else { 150 });
        if self.repetitions >= rep { return if rep == 3 { result::THREEFOLD } else { result::FIVEFOLD }; }
        if self.position.halfmove >= rule { return if rule == 100 { result::FIFTY_MOVES } else { result::SEVENTY_FIVE_MOVES }; }
        result::NONE
    }
    /// The draws a player may claim in the current position (CLAIM_* bits). Whether the game is
    /// still on is status()'s to say.
    pub fn claimable(&self) -> u8 {
        (if self.options.claim_moves != 0 && self.position.halfmove >= self.options.claim_moves { CLAIM_FIFTY_MOVES } else { 0 })
            | (if self.options.claim_repetition != 0 && self.repetitions >= self.options.claim_repetition { CLAIM_THREEFOLD } else { 0 })
    }
    /// The verdict if `side`'s flag falls now, or `side` resigns: read from the opponent's flag
    /// (with domino_at_end, the Domino search runs now if the flag is still up).
    pub fn flag_verdict(&mut self, side: u8, resigned: bool) -> u8 {
        self.update_flags();
        let mut draw = self.never_mates(side ^ WHITE);
        if !draw && self.options.domino_at_end {
            draw = prove_cannot_be_mated(&mut self.search, &self.position, side, DOMINO_PLY, DOMINO_BUDGET).proven;
        }
        verdict_code(side, draw, resigned)
    }
}

/// The result when the flag of `side` falls or `side` resigns: a draw if the opponent can never
/// mate, otherwise a win for the opponent.
pub fn verdict_code(side: u8, draw: bool, resigned: bool) -> u8 {
    if draw { return if resigned { result::DRAW_ON_RESIGNATION } else { result::DRAW_ON_TIME }; }
    match (side == WHITE, resigned) {
        (true, false) => result::BLACK_ON_TIME,
        (true, true) => result::BLACK_BY_RESIGNATION,
        (false, false) => result::WHITE_ON_TIME,
        (false, true) => result::WHITE_BY_RESIGNATION,
    }
}
