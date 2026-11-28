/*!
 * mateless-wasm.js — Mateless's ladder from WebAssembly (mateless.wasm, built from the Rust port
 * by tools/build-wasm.js). The same answers as mateless.js, node counts included, at the speed of
 * the Rust port; no dependencies.
 *
 *   const W = MatelessWasm.instantiate(bytes);   // bytes of mateless.wasm, or a WebAssembly.Module
 *   const W = await MatelessWasm.load();          // Node: reads mateless.wasm beside this file;
 *                                                 // a browser: load(url or bytes)
 *   W.proveBoth('8/8/4k3/3p2p1/1p1P1pP1/1P3P2/8/3K4 b - - 47 92');   // [White flagged, Black flagged]
 *   const flags = new W.Flags();                  // a game's two flags, ply by ply
 *   flags.update(fenOrPosition, ply);
 *
 * Positions: every function takes a FEN or a W.Position (W.fromFen(fen).position), which is
 * read once and kept in WebAssembly memory; a game played move by move should pass Positions or
 * FENs, as it has them. A FEN passed to a function is read as fromFen reads it by default (no
 * position no game reaches); a composed one goes in as W.fromFen(fen, { strict: false }).position. A Position and a Flags hold memory in the module: free() returns it, and
 * a FinalizationRegistry returns it when they are collected.
 *
 * What it covers: the ladder (material test, lock detector, Domino search and its second tier, both
 * sides at once, a game's flags), on request under the rules a game ends at by itself (moveRule 150
 * or 100, repetition 5 or 3 with the game's history: the clock search near the move rule), perft.
 * The rules engine itself (legal moves, game status, results) is mateless.js's.
 *
 * MIT License, © 2026 Cüneyt İnan. https://github.com/cuneytinann/Mateless
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MatelessWasm = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
'use strict';

const WHITE = 8, BLACK = 0, FLAGGED_WHITE = 1, FLAGGED_BLACK = 2, DOMINO_PLY = 3, DOMINO_BUDGET = 10,
      DOMINO_DEEP_PLY = 9, DOMINO_DEEP_BUDGET = 5000;
const QUEEN = 3, KNIGHT = 4, ROOK = 5, BISHOP = 6, PROMOTIONS = [0, 0, 0, QUEEN, KNIGHT, ROOK, BISHOP];
/* The results and claims, as mateless.js numbers them (game.js). */
const RESULT_NAMES = Object.freeze(['ongoing', 'white checkmates', 'black checkmates', 'stalemate', '75-move rule', 'fivefold repetition', 'dead position', 'white wins on time', 'black wins on time', 'white wins by resignation', 'black wins by resignation', 'draw on time', 'draw on resignation', '50-move rule', 'threefold repetition']);
const Result = Object.freeze({
  NONE: 0, WHITE_MATES: 1, BLACK_MATES: 2, STALEMATE: 3, SEVENTY_FIVE_MOVES: 4, FIVEFOLD: 5, DEAD_POSITION: 6,
  WHITE_ON_TIME: 7, BLACK_ON_TIME: 8, WHITE_BY_RESIGNATION: 9, BLACK_BY_RESIGNATION: 10,
  DRAW_ON_TIME: 11, DRAW_ON_RESIGNATION: 12, FIFTY_MOVES: 13, THREEFOLD: 14,
});
const Claim = Object.freeze({ FIFTY_MOVES: 1, THREEFOLD: 2 });
const FEN_ERRORS = ['', 'syntax', 'kings', 'pawnrank', 'oppcheck', 'pawns', 'pieces', 'promo', 'captures', 'checks'];
const FIXED = [[1, 'castling'], [2, 'en passant'], [8, 'halfmove'], [4, 'fullmove']];
const FAILURES = [null, 'mate', 'horizon', 'budget'];

/** Instantiates mateless.wasm (bytes or a compiled WebAssembly.Module) and returns its API. */
function instantiate(source) {
  const module = source instanceof WebAssembly.Module ? source : new WebAssembly.Module(source);
  const x = new WebAssembly.Instance(module, {}).exports;
  x.init();
  const encoder = new TextEncoder();
  const registry = typeof FinalizationRegistry === 'function'
    ? new FinalizationRegistry(([free, handle]) => free(handle)) : null;

  /* The module's input buffer, seen from here: a view kept between calls, made again when the
     buffer must grow or the module's memory has grown (which detaches the old view). */
  let view = new Uint8Array(0), viewBuffer = null;
  /** Writes a string into the module's input buffer; returns its length in bytes. */
  function put(text) {
    text = String(text);
    const room = 3 * text.length;                    // UTF-8 never needs more
    if (room > view.length || viewBuffer !== x.memory.buffer) {
      const at = x.input(Math.max(room, 256));
      viewBuffer = x.memory.buffer;
      view = new Uint8Array(viewBuffer, at, Math.max(room, 256));
    }
    return encoder.encodeInto(text, view).written;
  }
  const out = () => new Int32Array(x.memory.buffer, x.out(), 16);

  /** A position read into WebAssembly memory. */
  class Position {
    constructor(handle) {
      this.handle = handle;
      if (registry) registry.register(this, [x.position_free, handle], this);
    }
    get side() { return x.position_side(this.handle); }
    get halfmove() { return x.position_halfmove(this.handle); }
    /** Returns the memory now; the position cannot be used afterwards. */
    free() {
      if (this.handle < 0) return;
      if (registry) registry.unregister(this);
      x.position_free(this.handle);
      this.handle = -1;
    }
  }

  /** Reads a FEN as fromFen in mateless.js: { position, fixed } (what was put right: 'castling',
      'en passant', 'halfmove', 'fullmove') or { error } ('syntax', 'kings', 'pawnrank', 'oppcheck', 'pawns',
      'pieces', 'promo', 'captures', 'checks'); strict: false keeps the first four only. */
  function fromFen(fen, { strict = true } = {}) {
    const h = x.position_from_fen(put(fen), strict ? 1 : 0);
    if (h < 0) return { error: FEN_ERRORS[-h] || 'syntax' };
    const bits = out()[0];
    return { position: new Position(h), fixed: FIXED.filter(([b]) => bits & b).map(([, name]) => name) };
  }

  /* Runs fn on the handle of a Position, or of a FEN read for the call (and freed after it). */
  function withPosition(p, fn) {
    if (p instanceof Position) {
      if (p.handle < 0) throw new Error('mateless-wasm: the position was freed');
      return fn(p.handle);
    }
    const h = x.position_from_fen(put(p), 1);
    if (h < 0) throw new Error('mateless-wasm: invalid FEN (' + (FEN_ERRORS[-h] || 'syntax') + '): ' + p);
    try { return fn(h); } finally { x.position_free(h); }
  }

  const proofAt = (o, i) => ({ proven: o[i] === 1, staticProof: o[i + 1] === 1, failure: FAILURES[o[i + 2]],
                               foundBy: o[i + 2] === 1 ? 'search' : null, nodes: o[i + 3], deep: o[i + 4] === 1,
                               stuck: o[i + 6] === 1, ruled: o[i + 5] === 1 });

  /* The rules, checked as mateless.js checks them, and a game's history put into the module: null
     (none), mateless.js's { keys, n } (game.repetitionHistory()), or an array of FENs or Positions
     (the game's positions before this one since its last capture or pawn move). */
  function checkRules(moveRule, repetition) {
    if (moveRule !== 0 && moveRule !== 100 && moveRule !== 150) throw new Error('mateless-wasm: moveRule must be 0, 100 or 150');
    if (repetition !== 0 && repetition !== 3 && repetition !== 5) throw new Error('mateless-wasm: repetition must be 0, 3 or 5');
  }
  function setHistory(history) {
    if (!history) { x.history_clear(); return; }
    if (Array.isArray(history)) { x.history_clear(); for (const p of history) withPosition(p, h => x.history_push(h)); return; }
    const n = history.n | 0, at = x.history_keys(n);
    new Int32Array(x.memory.buffer, at, 9 * n).set(history.keys.subarray(0, 9 * n));
    x.history_from_keys(n);
  }

  /** Can `flagged` never be mated? The static tests, then the Domino search and, where it fails
      without a mate, the stuck mater move by move and the second tier, and with moveRule or
      repetition the searches under the rules; the same
      { proven, staticProof, failure, foundBy, nodes, deep, stuck, ruled } as mateless.js. */
  function proveCannotBeMated(p, flagged, { maxPly = DOMINO_PLY, budget = DOMINO_BUDGET, deepPly = DOMINO_DEEP_PLY,
                                            deepBudget = DOMINO_DEEP_BUDGET, moveRule = 0, repetition = 0, history = null } = {}) {
    checkRules(moveRule, repetition);
    return withPosition(p, h => {
      setHistory(repetition ? history : null);
      x.prove(h, flagged, maxPly, budget, deepPly, deepBudget, moveRule, repetition); return proofAt(out(), 0);
    });
  }
  /** Both sides in one pass: [White flagged, Black flagged]. */
  function proveBoth(p, { maxPly = DOMINO_PLY, budget = DOMINO_BUDGET, deepPly = DOMINO_DEEP_PLY, deepBudget = DOMINO_DEEP_BUDGET,
                          moveRule = 0, repetition = 0, history = null } = {}) {
    checkRules(moveRule, repetition);
    return withPosition(p, h => {
      setHistory(repetition ? history : null);
      x.prove_both(h, maxPly, budget, deepPly, deepBudget, moveRule, repetition);
      const o = out(); return [proofAt(o, 0), proofAt(o, 7)];
    });
  }
  /** Is the position dead (FIDE 5.2.2)? With moveRule or repetition (and a history), under those rules. */
  function isDeadPosition(p, { moveRule = 0, repetition = 0, history = null } = {}) {
    checkRules(moveRule, repetition);
    return withPosition(p, h => { setHistory(repetition ? history : null); return x.is_dead(h, moveRule, repetition) === 1; });
  }

  /** The two flags of a game played move by move (Flags in mateless.js); moveRule and repetition: the
      rules the game ends at (0: none). */
  class Flags {
    constructor({ moveRule = 0, repetition = 0 } = {}) {
      checkRules(moveRule, repetition);
      this.handle = x.flags_new(moveRule, repetition);
      this.repetition = repetition;
      if (registry) registry.register(this, [x.flags_free, this.handle], this);
    }
    /** Climbs the ladder at the position of game ply `ply` (a Position or a FEN), once per ply;
        history: the game's positions before it since its last capture or pawn move (see above),
        for a repetition rule. */
    update(p, ply, history = null) { withPosition(p, h => { setHistory(this.repetition ? history : null); x.flags_update(this.handle, h, ply); }); }
    /** The game is back at ply `ply` (moves taken back): a flag that came down after it goes up
        again, and the next update is for ply + 1 (Flags.rewind in mateless.js). */
    rewind(ply) { x.flags_rewind(this.handle, ply); }
    /** The ply at which each side was proven unable to mate; -1 while its flag is up. */
    get whiteDownAt() { return x.flags_white_down_at(this.handle); }
    set whiteDownAt(ply) { x.flags_set(this.handle, ply, this.blackDownAt); }
    get blackDownAt() { return x.flags_black_down_at(this.handle); }
    set blackDownAt(ply) { x.flags_set(this.handle, this.whiteDownAt, ply); }
    /** Has `color` been proven unable to mate, for the rest of the game? */
    neverMates(color) { return (color === WHITE ? this.whiteDownAt : this.blackDownAt) >= 0; }
    free() {
      if (this.handle < 0) return;
      if (registry) registry.unregister(this);
      x.flags_free(this.handle);
      this.handle = -1;
    }
  }

  /* The moves the last call put in list(): { from, to, promotion } as legalMoves in mateless.js. */
  const movesOut = n => Array.from(new Int32Array(x.memory.buffer, x.list(), n),
                                   m => ({ from: m & 63, to: (m >> 6) & 63, castle: false, promotion: (m >> 12) !== 0 }));
  const textOut = n => new TextDecoder().decode(new Uint8Array(x.memory.buffer, x.text(), n));
  /** The legal moves of a position (a Position or a FEN): { from, to, promotion } each. */
  function legalMoves(p) { return withPosition(p, h => movesOut(x.position_legal_moves(h))); }
  /** The FEN of a position, with move number `fullmove`. */
  function toFen(p, fullmove = 1) { return withPosition(p, h => textOut(x.position_fen(h, fullmove))); }

  /** A game played move by move (Game in mateless.js): from a Position or a FEN, under a
      platform's own rules (the same options and defaults: moveRule, repetition, claimMoves,
      claimRepetition, rungs, dominoAtEnd). */
  class Game {
    constructor(start, { moveRule = 0, repetition = 0, claimMoves = 100, claimRepetition = 3, rungs = 3, dominoAtEnd = false } = {}) {
      const fields = typeof start === 'string' ? start.trim().split(/\s+/) : [];
      this.startFullmove = Math.max(1, parseInt(fields[5], 10) || 1);
      this.handle = withPosition(start, h => {
        this.startSide = x.position_side(h);
        return x.game_new(h, moveRule, repetition, claimMoves, claimRepetition, rungs, dominoAtEnd ? 1 : 0);
      });
      if (this.handle < 0) throw new Error('mateless-wasm: Game options: moveRule 0, 100 or 150; repetition 0, 3 or 5; claimMoves 0 or 100; claimRepetition 0 or 3; rungs 1, 2 or 3');
      Object.assign(this, { moveRule, repetition, claimMoves, claimRepetition, rungs, dominoAtEnd: rungs === 3 && !!dominoAtEnd });
      if (registry) registry.register(this, [x.game_free, this.handle], this);
    }
    /** Plays a legal move and returns the game status after it; throws when it is not legal. */
    play(from, to, promotion = QUEEN) {
      if (!PROMOTIONS[promotion]) throw new Error('mateless-wasm: promotion must be QUEEN, ROOK, BISHOP or KNIGHT');
      const r = x.game_play(this.handle, from, to, promotion);
      if (r < 0) throw new Error('mateless-wasm: illegal move');
      return r;
    }
    /** The game status of the current position; brings the flags up to date. */
    status() { return x.game_status(this.handle); }
    /** The draws a player may claim now: Claim bits. */
    claimable() { return x.game_claimable(this.handle); }
    /** The verdict if `side`'s flag falls now, or `side` resigns. */
    flagVerdict(side, { resigned = false } = {}) { return x.game_verdict(this.handle, side, resigned ? 1 : 0); }
    /** Brings the flags up to date (once per position). */
    updateFlags() { x.game_update_flags(this.handle); }
    /** Has `color` been proven unable to mate, for the rest of the game? */
    neverMates(color) { return (color === WHITE ? this.whiteDownAt : this.blackDownAt) >= 0; }
    get whiteDownAt() { return x.game_white_down_at(this.handle); }
    get blackDownAt() { return x.game_black_down_at(this.handle); }
    get repetitions() { return x.game_repetitions(this.handle); }
    get ply() { return x.game_ply(this.handle); }
    get halfmove() { return x.game_halfmove(this.handle); }
    get side() { return x.game_side(this.handle); }
    legalMoves() { return movesOut(x.game_legal_moves(this.handle)); }
    /** The FEN of the current position (the move number counted from the start's). */
    fen() { return textOut(x.game_fen(this.handle, this.startFullmove + ((this.ply + (this.startSide === BLACK ? 1 : 0)) >> 1))); }
    free() {
      if (this.handle < 0) return;
      if (registry) registry.unregister(this);
      x.game_free(this.handle);
      this.handle = -1;
    }
  }

  return Object.freeze({
    WHITE, BLACK, FLAGGED_WHITE, FLAGGED_BLACK, DOMINO_PLY, DOMINO_BUDGET, DOMINO_DEEP_PLY, DOMINO_DEEP_BUDGET,
    QUEEN, KNIGHT, ROOK, BISHOP, RESULT_NAMES, Result, Claim,
    Position, fromFen, toFen, legalMoves, Game,
    materialCannotMate: (p, flagged) => withPosition(p, h => x.material_test(h, flagged) === 1),
    lockCannotMate: (p, flagged) => withPosition(p, h => x.lock_cannot_mate(h, flagged) === 1),
    cannotMate: (p, flagged) => withPosition(p, h => x.cannot_mate(h, flagged) === 1),
    cannotMate2: (p, ask) => withPosition(p, h => x.cannot_mate2(h, ask)),
    proveCannotBeMated, proveBoth, isDeadPosition,
    Flags,
    perft: (p, depth) => withPosition(p, h => x.perft(h, depth)),
    /** The raw exports, for measurements. */
    exports: x,
  });
}

/** Loads mateless.wasm: in Node from beside this file (or `source`: a path, bytes or a Module), in a
    browser from `source` (a URL, bytes or a Module; default 'mateless.wasm'). */
async function load(source) {
  if (source instanceof WebAssembly.Module || source instanceof ArrayBuffer || ArrayBuffer.isView(source)) return instantiate(source);
  if (typeof process === 'object' && process.versions && process.versions.node) {
    const fs = require('fs'), path = require('path');
    return instantiate(fs.readFileSync(source || path.join(__dirname, 'mateless.wasm')));
  }
  const response = await fetch(source || 'mateless.wasm');
  return instantiate(await WebAssembly.compile(await response.arrayBuffer()));
}

return Object.freeze({ instantiate, load });
});
