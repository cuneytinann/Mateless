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
 * FENs, as it has them. A Position and a Flags hold memory in the module: free() returns it, and
 * a FinalizationRegistry returns it when they are collected.
 *
 * What it covers: the ladder (material test, lock detector, Domino search, both sides at once, a
 * game's flags), perft. The rules engine itself (legal moves, game status, results) is
 * mateless.js's.
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

const WHITE = 8, BLACK = 0, FLAGGED_WHITE = 1, FLAGGED_BLACK = 2, DOMINO_PLY = 6, DOMINO_BUDGET = 100;
const FEN_ERRORS = ['', 'syntax', 'kings', 'pawns', 'castling', 'en passant'];
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

  /** Reads a FEN: { position } or { error } ('syntax', 'kings', 'pawns', 'castling', 'en passant'),
      as fromFen in mateless.js. */
  function fromFen(fen) {
    const h = x.position_from_fen(put(fen));
    return h >= 0 ? { position: new Position(h) } : { error: FEN_ERRORS[-h] || 'syntax' };
  }

  /* Runs fn on the handle of a Position, or of a FEN read for the call (and freed after it). */
  function withPosition(p, fn) {
    if (p instanceof Position) {
      if (p.handle < 0) throw new Error('mateless-wasm: the position was freed');
      return fn(p.handle);
    }
    const h = x.position_from_fen(put(p));
    if (h < 0) throw new Error('mateless-wasm: invalid FEN (' + (FEN_ERRORS[-h] || 'syntax') + '): ' + p);
    try { return fn(h); } finally { x.position_free(h); }
  }

  const proofAt = (o, i) => ({ proven: o[i] === 1, staticProof: o[i + 1] === 1, failure: FAILURES[o[i + 2]],
                               foundBy: o[i + 2] === 1 ? 'search' : null, nodes: o[i + 3] });

  /** Can `flagged` never be mated? The static tests, then the Domino search; the same
      { proven, staticProof, failure, foundBy, nodes } as mateless.js. */
  function proveCannotBeMated(p, flagged, { maxPly = DOMINO_PLY, budget = DOMINO_BUDGET } = {}) {
    return withPosition(p, h => { x.prove(h, flagged, maxPly, budget); return proofAt(out(), 0); });
  }
  /** Both sides in one pass: [White flagged, Black flagged]. */
  function proveBoth(p, { maxPly = DOMINO_PLY, budget = DOMINO_BUDGET } = {}) {
    return withPosition(p, h => { x.prove_both(h, maxPly, budget); const o = out(); return [proofAt(o, 0), proofAt(o, 4)]; });
  }

  /** The two flags of a game played move by move (Flags in mateless.js). */
  class Flags {
    constructor() {
      this.handle = x.flags_new();
      if (registry) registry.register(this, [x.flags_free, this.handle], this);
    }
    /** Climbs the ladder at the position of game ply `ply` (a Position or a FEN), once per ply. */
    update(p, ply) { withPosition(p, h => x.flags_update(this.handle, h, ply)); }
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

  return Object.freeze({
    WHITE, BLACK, FLAGGED_WHITE, FLAGGED_BLACK, DOMINO_PLY, DOMINO_BUDGET,
    Position, fromFen,
    materialCannotMate: (p, flagged) => withPosition(p, h => x.material_test(h, flagged) === 1),
    lockCannotMate: (p, flagged) => withPosition(p, h => x.lock_test(h, flagged) === 1),
    cannotMate: (p, flagged) => withPosition(p, h => x.cannot_mate(h, flagged) === 1),
    cannotMate2: (p, ask) => withPosition(p, h => x.cannot_mate2(h, ask)),
    proveCannotBeMated, proveBoth,
    isDeadPosition: p => withPosition(p, h => x.is_dead(h) === 1),
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
