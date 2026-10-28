/* ═══ Mateless · domino.js — rung 3: the Domino search ═════════════════════════════════════

   A short helpmate search, with a memory of the positions it has met: it settles the positions
   the static tests leave and a few forced moves decide (see Domino below).

   From the board it needs the legal moves of a position, one piece at a time and in a fixed order
   (MoveContext, computeContext, legalTargets, stuckPawns, flagsOf), moves made and taken back in
   place (doMove, undoMove), "is there a legal move?" (hasLegalMove), and an exact code of a
   position with its hash (writeKey, hashKey). With another board, in another order, the node
   counts can change; what a proof proves does not. */

import { BLACK, computeContext, doMove, fail, FLAG_CASTLE, FLAG_EP, FLAG_PROMO, flagsOf, hashKey,
         hasLegalMove, KEY_WORDS, legalTargets, lowestBit, MoveContext, NO_SQUARE, PAWN, Position,
         PROMOTION_ORDER, stuckHi, stuckLo, stuckPawns, targetsHi, targetsLo, undoMove, WHITE,
         writeKey } from './board.js';
import { FLAGGED_BLACK, FLAGGED_WHITE, pawnCheck, staticTests, staticTests2, TESTS_BOTH, testsAfter } from './lock.js';

/* The search's memory of positions: a set, held as an open-addressing hash table with linear
   probing. A slot is twelve words: the number of the search that filled it, the hash, the nine
   words of the position's code, and the sides that have met it (FLAGGED_* bits, for run2, whose
   two searches share the table). A lookup compares the full code, so it can only find the very
   same position.

   Because slots carry the number of their search, starting a new search clears the table in
   constant time. A Domino search plays at most a hundred moves, so it stays in its first table
   (256 slots, 12 KB, in the first-level cache); the table still doubles when it is 70% full, into a table of the next size
   (tables of each size are kept for later searches), for callers that give a larger budget. */
const MEMO_START_BITS = 8, SLOT = 12;
export class PositionSet {
  constructor() {
    this.tables = [];
    this.generation = 1;
    this.bits = MEMO_START_BITS;
    this.slots = this.table(MEMO_START_BITS);
    this.mask = (1 << MEMO_START_BITS) - 1;
    this.count = 0;
    this.limit = 0;
  }

  table(bits) {
    if (bits > 26) fail('position set too large');
    return this.tables[bits] || (this.tables[bits] = new Int32Array(SLOT << bits));
  }

  clear() {
    if (this.generation === 0x7fffffff) {
      for (const t of this.tables) if (t) for (let i = 0; i < t.length; i += SLOT) t[i] = 0;
      this.generation = 0;
    }
    this.generation++;
    this.bits = MEMO_START_BITS;
    this.slots = this.table(MEMO_START_BITS);
    this.mask = (1 << MEMO_START_BITS) - 1;
    this.limit = Math.floor(0.7 * (this.mask + 1));
    this.count = 0;
  }

  /** Adds the position with code k[at…] and hash h. Returns false when it was there already. */
  add(k, at, h) {
    const slots = this.slots, gen = this.generation, mask = this.mask;
    let slot = h & mask;
    for (;;) {
      const i = slot * SLOT;
      if (slots[i] !== gen) break;
      if (slots[i + 1] === h && slots[i + 2] === k[at] && slots[i + 3] === k[at + 1] && slots[i + 4] === k[at + 2] &&
          slots[i + 5] === k[at + 3] && slots[i + 6] === k[at + 4] && slots[i + 7] === k[at + 5] &&
          slots[i + 8] === k[at + 6] && slots[i + 9] === k[at + 7] && slots[i + 10] === k[at + 8]) return false;
      slot = (slot + 1) & mask;
    }
    const i = slot * SLOT;
    slots[i] = gen;
    slots[i + 1] = h;
    for (let j = 0; j < KEY_WORDS; j++) slots[i + 2 + j] = k[at + j];
    if (++this.count > this.limit) this.grow();
    return true;
  }

  /** Adds the position for the sides in `live` (FLAGGED_* bits) and returns those of them that
      had not met it yet: one probe serves both searches of run2, and for each side the answer is
      the one its own set would give. */
  add2(k, at, h, live) {
    const slots = this.slots, gen = this.generation, mask = this.mask;
    let slot = h & mask;
    for (;;) {
      const i = slot * SLOT;
      if (slots[i] !== gen) break;
      if (slots[i + 1] === h && slots[i + 2] === k[at] && slots[i + 3] === k[at + 1] && slots[i + 4] === k[at + 2] &&
          slots[i + 5] === k[at + 3] && slots[i + 6] === k[at + 4] && slots[i + 7] === k[at + 5] &&
          slots[i + 8] === k[at + 6] && slots[i + 9] === k[at + 7] && slots[i + 10] === k[at + 8]) {
        const fresh = live & ~slots[i + 11];
        slots[i + 11] |= fresh;
        return fresh;
      }
      slot = (slot + 1) & mask;
    }
    const i = slot * SLOT;
    slots[i] = gen;
    slots[i + 1] = h;
    for (let j = 0; j < KEY_WORDS; j++) slots[i + 2 + j] = k[at + j];
    slots[i + 11] = live;
    if (++this.count > this.limit) this.grow();
    return live;
  }

  /** Moves every slot of this search into the table of the next size. */
  grow() {
    const from = this.slots, oldSize = this.mask + 1, gen = this.generation;
    this.bits++;
    const to = this.table(this.bits), mask = (1 << this.bits) - 1;
    for (let s = 0; s < oldSize; s++) {
      const i = s * SLOT;
      if (from[i] !== gen) continue;
      let slot = from[i + 1] & mask;
      while (to[slot * SLOT] === gen) slot = (slot + 1) & mask;
      const j = slot * SLOT;
      for (let w = 0; w < SLOT; w++) to[j + w] = from[i + w];
    }
    this.slots = to;
    this.mask = mask;
    this.limit = Math.floor(0.7 * (mask + 1));
  }
}


/* A short helpmate search, the third rung of the ladder (material test, lock detector, Domino
   search). It settles the positions the static tests do not, but a few forced moves do: a king
   that must take the last queen or rook, a king that must step out of a pawn's check into a
   lock, a capture that leaves stalemate or bare material ("Domino" positions).

   It proves that the flagged side can never be mated by following every line in which both
   sides cooperate, and returns true only when every line ends without mating the flagged king:
     – in a position already met in this search (its lines are covered where it was first met);
     – in a position the static tests prove (see below);
     – in a position without legal moves that is not the flagged side checkmated.
   Any other end fails the proof, and the search stops at the first failure:
     'mate'     a line mates the flagged king;
     'horizon'  a line still has moves at the ply ceiling;
     'budget'   the node budget runs out.
   A failure proves nothing the arbiter acts on: it only ever acts on a proof.

   No move-count rule ends a line: the 50- and 75-move rules and repetitions play no part. A
   proof without them holds with them too, since they only cut lines short, so leaving them out
   can cost a proof but never make a false one; and the search's memory is a plain set of
   positions.

   After a move, a node asks only the static tests that move can have changed, and only while no
   en passant square is set (testsAfter in lock.js: the material test after a capture or a
   promotion; the lock detector after a capture, a pawn move, the lapse of an en passant right or
   a step out of a pawn's check). Asked at every node instead, they prove the same positions with
   the same node counts, about 15% slower (chasolver's 201,060 Lichess rows); asked by the clock
   rule (after a capture or a pawn move and one ply later) they do too. At the root they are asked
   unless the caller has settled them already (rootStatic: false, see ladder.js).

   The ply ceiling and node budget default to 6 and 100 (DOMINO_PLY, DOMINO_BUDGET). With them
   the ladder proves 201,024 of chasolver's 201,060 wrongly decided Lichess timeouts; a proof
   takes 1 node at the median, at most 8 nodes in 99% of the rows, and a ceiling above 6 plies
   proves no more rows. In an open position the first line runs to the ceiling and fails there,
   after about as many nodes as plies. The budget pays for every move played, each promotion
   separately.

   Moves are generated lazily, one piece at a time, in the generator's order (from a1, b1, …
   to h8): a node plays the first piece's moves before it works out the second piece's, and so
   on. Most searches that fail, fail on their first line, and then the other moves of the nodes
   on that line are never generated. */
export const DOMINO_PLY = 6, DOMINO_BUDGET = 100;
/** The second tier (the second version, see ladder.js): 9 plies, 10,000 nodes. */
export const DOMINO_DEEP_PLY = 9, DOMINO_DEEP_BUDGET = 10000;

/** The static tests the move of a piece of type `type` to `to` (with `flags`) from `pos` can
    change (testsAfter in lock.js); checked: the side to move is in a pawn's check. */
function movedTests(pos, checked, type, to, flags) {
  const capture = (pos.board[to] !== 0 && (flags & FLAG_CASTLE) === 0) || (flags & FLAG_EP) !== 0;
  return testsAfter(capture, (flags & FLAG_PROMO) !== 0, type === PAWN, pos.ep !== NO_SQUARE, checked);
}

export class Domino {
  constructor() {
    this.pos = new Position();
    this.seen = new PositionSet();
    /** One move-generation context per ply. */
    this.contexts = [];
    this.key = new Int32Array(KEY_WORDS);
    this.flagged = WHITE;
    this.budget = 0;
    this.failure = null;
    this.running = false;
    /** For run2: each side's budget and failure, and the sides whose search has failed. */
    this.budgetWhite = 0; this.budgetBlack = 0;
    this.failureWhite = null; this.failureBlack = null;
    this.dead = 0;
  }

  /** Runs the search from `root` and reports { proven, failure, budgetLeft }.
      rootStatic: false when the caller has already asked the static tests at the root. */
  run(root, flagged, maxPly = DOMINO_PLY, budget = DOMINO_BUDGET, { rootStatic = true } = {}) {
    if (flagged !== WHITE && flagged !== BLACK) fail('flagged must be WHITE or BLACK');
    if (!(maxPly >= 0) || !(budget >= 0)) fail('maxPly and budget must be numbers ≥ 0');
    if (!Number.isInteger(root.halfmove)) fail('the halfmove clock must be an integer');
    if (this.running) fail('the search was started again while running');
    this.running = true;
    try {
      while (this.contexts.length <= maxPly) this.contexts.push(new MoveContext());
      this.pos.copyFrom(root);
      this.seen.clear();
      this.flagged = flagged;
      this.budget = budget;
      this.failure = null;
      const proven = this.node(0, maxPly, rootStatic ? TESTS_BOTH : 0);
      if (!proven && !this.failure) fail('search failed without a reason');
      if (this.pos.undoTop !== 0) fail('search left moves on the board');
      return { proven, failure: proven ? null : this.failure, budgetLeft: Math.max(this.budget, 0) };
    } finally {
      this.running = false;
    }
  }

  /** tests: the static tests whose answer can have changed since the parent (testsAfter). */
  node(ply, depth, tests) {
    const pos = this.pos, key = this.key;
    writeKey(pos, key, 0);
    if (!this.seen.add(key, 0, hashKey(key, 0))) return true;     // met before: covered there
    if (tests && staticTests(pos, this.flagged, tests)) return true;

    const ctx = this.contexts[ply];
    if (depth === 0) {                                             // only "is there a legal move?" matters
      if (!hasLegalMove(pos, ctx)) return this.noLegalMove(ctx);
      this.failure = 'horizon';
      return false;
    }
    computeContext(pos, ctx);
    const us = pos.side, board = pos.board, checked = ctx.checks > 0 && pawnCheck(pos);
    stuckPawns(pos);                                               // pawns without a move are skipped
    const ownLo = pos.lo[us] & ~stuckLo, ownHi = pos.hi[us] & ~stuckHi;   // this node's pieces, in order
    let anyMove = false;
    for (let half = 0; half < 2; half++) {
      let own = half ? ownHi : ownLo;
      while (own) {
        const from = 32 * half + lowestBit(own);
        own &= own - 1;
        legalTargets(pos, from, ctx);
        let tLo = targetsLo, tHi = targetsHi;
        if (!(tLo | tHi)) continue;
        anyMove = true;
        const type = board[from] & 7;
        while (tLo | tHi) {
          let to;
          if (tLo) { to = lowestBit(tLo); tLo &= tLo - 1; } else { to = 32 + lowestBit(tHi); tHi &= tHi - 1; }
          const flags = flagsOf(pos, type, from, to), move = from | (to << 6) | (flags << 12);
          const choices = flags & FLAG_PROMO ? 4 : 1;
          const tests = movedTests(pos, checked, type, to, flags);
          for (let p = 0; p < choices; p++) {
            if (!(this.budget-- > 0)) { this.failure = 'budget'; return false; }
            doMove(pos, move, PROMOTION_ORDER[p]);
            const ok = this.node(ply + 1, depth - 1, pos.ep === NO_SQUARE ? tests : 0);
            undoMove(pos);
            if (!ok) return false;
          }
        }
      }
    }
    return anyMove || this.noLegalMove(ctx);
  }

  /** A node without legal moves ends its line. It fails only if the flagged king is mated. */
  noLegalMove(ctx) {
    if (this.pos.side === this.flagged && ctx.checks > 0) { this.failure = 'mate'; return false; }
    return true;
  }

  /** Both searches at once: for each side in `ask` (FLAGGED_* bits), the same result as run()
      with that side flagged. Returns [White flagged, Black flagged]; a side not asked is not
      proven and its budget is untouched.

      The two searches generate the same moves in the same order. They part only where the
      static tests prove one side and not the other, where a mate fails one of them, and once one
      of them has failed. So one walk serves both: each node carries the sides still searching it,
      a move is made once for both, each side pays its own budget for it and keeps its own mark in
      the set of positions met (one probe, two bits), and a side that fails stops paying and
      searching, as its own search would stop. With one side asked, that side's own search runs. */
  run2(root, ask, maxPly = DOMINO_PLY, budget = DOMINO_BUDGET, { rootStatic = true } = {}) {
    ask &= FLAGGED_WHITE | FLAGGED_BLACK;
    if (ask !== (FLAGGED_WHITE | FLAGGED_BLACK)) {
      const out = [{ proven: false, failure: null, budgetLeft: budget }, { proven: false, failure: null, budgetLeft: budget }];
      if (ask) out[ask >> 1] = this.run(root, ask === FLAGGED_WHITE ? WHITE : BLACK, maxPly, budget, { rootStatic });
      return out;
    }
    if (!(maxPly >= 0) || !(budget >= 0)) fail('maxPly and budget must be numbers ≥ 0');
    if (!Number.isInteger(root.halfmove)) fail('the halfmove clock must be an integer');
    if (this.running) fail('the search was started again while running');
    this.running = true;
    try {
      while (this.contexts.length <= maxPly) this.contexts.push(new MoveContext());
      this.pos.copyFrom(root);
      this.seen.clear();
      this.budgetWhite = budget; this.budgetBlack = budget;
      this.failureWhite = null; this.failureBlack = null;
      this.dead = 0;
      this.node2(0, maxPly, FLAGGED_WHITE | FLAGGED_BLACK, rootStatic ? TESTS_BOTH : 0);
      if (this.pos.undoTop !== 0) fail('search left moves on the board');
    } finally {
      this.running = false;
    }
    const result = (bit, failure, left) => {
      const proven = (this.dead & bit) === 0;
      return { proven, failure: proven ? null : failure, budgetLeft: Math.max(left, 0) };
    };
    return [result(FLAGGED_WHITE, this.failureWhite, this.budgetWhite), result(FLAGGED_BLACK, this.failureBlack, this.budgetBlack)];
  }

  node2(ply, depth, live, tests) {
    const pos = this.pos, key = this.key;
    writeKey(pos, key, 0);
    live = this.seen.add2(key, 0, hashKey(key, 0), live);         // a side that met it before: covered there
    if (!live) return;
    if (tests) { live &= ~staticTests2(pos, live, tests); if (!live) return; }

    const ctx = this.contexts[ply];
    if (depth === 0) {
      if (!hasLegalMove(pos, ctx)) this.noLegalMove2(ctx, live); else this.fail2(live, 'horizon');
      return;
    }
    computeContext(pos, ctx);
    const us = pos.side, board = pos.board, checked = ctx.checks > 0 && pawnCheck(pos);
    stuckPawns(pos);
    const ownLo = pos.lo[us] & ~stuckLo, ownHi = pos.hi[us] & ~stuckHi;
    let anyMove = false;
    for (let half = 0; half < 2; half++) {
      let own = half ? ownHi : ownLo;
      while (own) {
        const from = 32 * half + lowestBit(own);
        own &= own - 1;
        legalTargets(pos, from, ctx);
        let tLo = targetsLo, tHi = targetsHi;
        if (!(tLo | tHi)) continue;
        anyMove = true;
        const type = board[from] & 7;
        while (tLo | tHi) {
          let to;
          if (tLo) { to = lowestBit(tLo); tLo &= tLo - 1; } else { to = 32 + lowestBit(tHi); tHi &= tHi - 1; }
          const flags = flagsOf(pos, type, from, to), move = from | (to << 6) | (flags << 12);
          const choices = flags & FLAG_PROMO ? 4 : 1;
          const tests = movedTests(pos, checked, type, to, flags);
          for (let p = 0; p < choices; p++) {
            let spent = 0;
            if ((live & FLAGGED_WHITE) && !(this.budgetWhite-- > 0)) spent |= FLAGGED_WHITE;
            if ((live & FLAGGED_BLACK) && !(this.budgetBlack-- > 0)) spent |= FLAGGED_BLACK;
            if (spent) { this.fail2(spent, 'budget'); live &= ~spent; if (!live) return; }
            doMove(pos, move, PROMOTION_ORDER[p]);
            this.node2(ply + 1, depth - 1, live, pos.ep === NO_SQUARE ? tests : 0);
            undoMove(pos);
            live &= ~this.dead;                                      // a side that failed in there searches no more
            if (!live) return;
          }
        }
      }
    }
    if (!anyMove) this.noLegalMove2(ctx, live);
  }

  /** run2's noLegalMove: a mate fails the search in which the mated side is flagged. */
  noLegalMove2(ctx, live) {
    const mated = this.pos.side === WHITE ? FLAGGED_WHITE : FLAGGED_BLACK;
    if (ctx.checks > 0 && (live & mated)) this.fail2(mated, 'mate');
  }

  /** The searches of the sides in `mask` fail, for `why`. */
  fail2(mask, why) {
    const m = mask & ~this.dead;
    if (m & FLAGGED_WHITE) this.failureWhite = why;
    if (m & FLAGGED_BLACK) this.failureBlack = why;
    this.dead |= m;
  }
}
