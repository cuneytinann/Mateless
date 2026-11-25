/* ═══ Mateless · clock.js — the search under a move rule, bounded by the clock (the second version) ═══

   Under a move rule (the game ends by itself, drawn, when the halfmove clock reaches 150 or 100;
   a mate on that move still counts) the question for one side is: can it be mated before the
   game ends?

   From a position with the clock at c, the lines that make no capture and no pawn move stay in
   the region: there the pawns stand still and the material does not change, and a line lasts at
   most moveRule - c plies. A capture or a pawn move (an exit) puts the clock back to 0: what can
   follow is the question without the rule, which the ladder's searches without it answer (the
   exit is dead when they prove the side can never be mated there). So the side cannot be mated
   before the rule when, within moveRule - c plies of the region, no line mates it and no exit
   leads to a position the ladder does not prove dead. That is a finite search, closed by the
   clock rather than by a ply ceiling, and ClockSearch makes it.

   It walks the region depth first, and cuts a position when a lower bound on the plies its lines
   need to reach a mate or an exit is above the plies left:
     the plies to a mate   for each square k the defending king can reach in time, the mating net
                           there: a check on k and every flight of k closed, covered by an attack
                           or taken by a defending piece. Each mating piece that helps ends on one
                           square, so the mater's moves are at least the sum of the pieces'
                           distances (on a board whose only obstacles are the pawns) to squares
                           from which they cover their share of the net; the defender's moves are
                           its king's distance to k and its pieces' to the flights they take. The
                           plies follow from the two counts and who is to move.
     the plies to an exit  that is not dead whatever the position: a pawn push (a pawn with no pawn
                           ahead), a pawn taking a pawn, a piece reaching a pawn to take it, a
                           piece taking a piece that comes to meet it, a piece stepping where a
                           pawn takes it, an en passant capture. An exit that leaves the mater a
                           bare king, or a single minor piece and no pawn against a bare king, is
                           dead whatever the position.
   Both are lower bounds: pieces other than pawns never block in them, a piece may cover from any
   square it can reach, and the defender helps. What they need of the pawns (distances, the
   squares the pawns attack, each net's targets) is worked out once per pawn structure and kept
   for the searches that follow; the mater's cheapest cover of each net, once per placement of its
   pieces.

   The positions met are kept with the clock they were met with (the set of domino.js): one met
   again with a clock no lower is covered by the first visit. With a repetition rule, the positions
   of the repetition set end a line, drawn, as in the Domino search. The budget pays for every
   move played, and for the nodes of the ladder's searches at the exits.

   On 12,962 cases of endings with three to five men (a position, a rule and a clock around the
   position's rule distance: the fewest plies to a mate or to an exit into a position chasolver's
   full analysis calls winnable, from an exact search of the region), with the arbiter page's
   limits (4 plies, 8 nodes), it proves 6,966 of the 6,978 that cannot be mated in time (99.8%) and
   none that can; the Domino search under the rule, with a ply ceiling for its horizon, proved
   5,976 (85.6%) with 20 times the nodes. */

import { BISHOP, doMove, FLAG_CASTLE, FLAG_EP, FLAG_PROMO, generateLegalMoves, hashKey, hasLegalMove, inCheck,
         KEY_WORDS, KING, KNIGHT, lowestBit, MOVE_STRIDE, NO_SQUARE, PAWN, popcount, Position, PROMOTION_ORDER, QUEEN,
         ROOK, undoMove, WHITE, writeKey } from './board.js';
import { PositionSet } from './domino.js';

/** No bound: more plies than any rule allows. */
const CLOCK_INF = 1000;

const KNIGHT_STEPS_FR = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
const KING_STEPS_FR = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
const ROOK_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]], BISHOP_DIRS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const QUEEN_DIRS = ROOK_DIRS.concat(BISHOP_DIRS);
const kingDistance = (a, b) => Math.max(Math.abs((a & 7) - (b & 7)), Math.abs((a >> 3) - (b >> 3)));

/* ─── The region: what the pawns make of the board ───────────────────────────────────────

   For one pawn structure and one mater: the squares each colour's pawns attack; the distance of
   every piece type from every square to every other, the pawns the only obstacles (a king avoids
   the squares the enemy pawns attack); the squares each type attacks from each square (a slider's
   ray stops at the first pawn, which it attacks); and for each square k the defending king may
   stand on, the net's targets: k itself (the check, index 0) and the flights the pawns leave open
   (a defending pawn takes a flight for good, a mating pawn's attack closes it). The defending king
   never stands on a pawn or where a mating pawn attacks: it cannot go there within the region.
   Type indices: the piece types, 7 for the mater's king and 0 for the defender's. */
function regionBuild(pos, mater) {
  const board = pos.board, isPawn = new Uint8Array(64), pawnOf = new Int8Array(64).fill(-1);
  for (let s = 0; s < 64; s++) if ((board[s] & 7) === PAWN) { isPawn[s] = 1; pawnOf[s] = board[s] & WHITE; }
  const pawnAtt = [new Uint8Array(64), new Uint8Array(64)];          // by colour >> 3
  for (let s = 0; s < 64; s++) if (isPawn[s]) {
    const c = pawnOf[s], r = (s >> 3) + (c === WHITE ? 1 : -1);
    if (r < 0 || r > 7) continue;
    for (const df of [-1, 1]) { const f = (s & 7) + df; if (f >= 0 && f < 8) pawnAtt[c >> 3][r * 8 + f] = 1; }
  }
  const dirsOf = type => type === ROOK ? ROOK_DIRS : type === BISHOP ? BISHOP_DIRS : QUEEN_DIRS;
  const steps = (type, s, kingColour) => {                         // where a piece on s can go
    const out = [], f0 = s & 7, r0 = s >> 3;
    if (type === KNIGHT || type === KING) {
      for (const [df, dr] of type === KNIGHT ? KNIGHT_STEPS_FR : KING_STEPS_FR) {
        const f = f0 + df, r = r0 + dr;
        if (f < 0 || f > 7 || r < 0 || r > 7) continue;
        const t = r * 8 + f;
        if (isPawn[t] || (type === KING && pawnAtt[(kingColour ^ WHITE) >> 3][t])) continue;
        out.push(t);
      }
      return out;
    }
    for (const [df, dr] of dirsOf(type)) {
      let f = f0 + df, r = r0 + dr;
      while (f >= 0 && f < 8 && r >= 0 && r < 8 && !isPawn[r * 8 + f]) { out.push(r * 8 + f); f += df; r += dr; }
    }
    return out;
  };
  const attackRow = (type, s, out, at) => {                        // what a piece on s attacks
    const f0 = s & 7, r0 = s >> 3;
    if (type === KNIGHT || type === KING) {
      for (const [df, dr] of type === KNIGHT ? KNIGHT_STEPS_FR : KING_STEPS_FR) {
        const f = f0 + df, r = r0 + dr;
        if (f >= 0 && f < 8 && r >= 0 && r < 8) out[at + r * 8 + f] = 1;
      }
      return;
    }
    for (const [df, dr] of dirsOf(type)) {
      let f = f0 + df, r = r0 + dr;
      while (f >= 0 && f < 8 && r >= 0 && r < 8) { out[at + r * 8 + f] = 1; if (isPawn[r * 8 + f]) break; f += df; r += dr; }
    }
  };
  const distTable = (type, kingColour) => {
    const d = new Uint8Array(4096).fill(255), adj = [];
    for (let s = 0; s < 64; s++) adj.push(isPawn[s] ? [] : steps(type, s, kingColour));
    for (let s = 0; s < 64; s++) {
      if (isPawn[s]) continue;
      const q = [s]; d[s * 64 + s] = 0;
      for (let h = 0; h < q.length; h++) {
        const u = q[h], du = d[s * 64 + u];
        for (const v of adj[u]) if (d[s * 64 + v] === 255) { d[s * 64 + v] = du + 1; q.push(v); }
      }
    }
    return d;
  };
  const defender = mater ^ WHITE, dist = [], att = [];
  for (const t of [QUEEN, ROOK, BISHOP, KNIGHT]) {
    dist[t] = distTable(t, 0);
    const a = new Uint8Array(4096);
    for (let s = 0; s < 64; s++) attackRow(t, s, a, s * 64);
    att[t] = a;
  }
  dist[7] = distTable(KING, mater); dist[0] = distTable(KING, defender);
  att[7] = new Uint8Array(4096);
  for (let s = 0; s < 64; s++) attackRow(KING, s, att[7], s * 64);
  const targets = [], materPawnAtt = pawnAtt[mater >> 3], kingList = [];
  for (let k = 0; k < 64; k++) {
    const T = [k];
    if (!isPawn[k] && !materPawnAtt[k]) {
      kingList.push(k);
      for (const [df, dr] of KING_STEPS_FR) {
        const f = (k & 7) + df, r = (k >> 3) + dr;
        if (f < 0 || f > 7 || r < 0 || r > 7) continue;
        const t = r * 8 + f;
        if ((isPawn[t] && pawnOf[t] === defender) || materPawnAtt[t]) continue;
        T.push(t);
      }
    }
    targets.push(T);
  }
  return { isPawn, pawnOf, pawnAtt, dist, att, targets, kingList: Uint8Array.from(kingList), byDistance: [], mater,
           cover: new Array(8 * 4096), front: new Array(8 * 4096), block: new Array(8 * 4096),
           take: new Int16Array(8 * 4096).fill(-1), meet: new Array(8 * 64), trap: null, placements: new Map(),
           blocked: new Map() };
}

/* One mating piece (type index t, on s) against the net on k: cover[S], its fewest moves to stand
   where it covers the targets S (a mask over the net's targets; the king never checks, never
   stands next to the other king); and its front, the squares worth standing on as
   (moves << 16 | mask), fewest moves first, none covering only part of what a cheaper or as
   cheap one covers. The front starts with "stay out of it" (0 moves, nothing covered). */
function pieceNet(R, t, s, k) {
  const key = (t * 64 + s) * 64 + k, T = R.targets[k], n = T.length, size = 1 << n;
  const c = new Int16Array(size).fill(CLOCK_INF), d = R.dist[t], a = R.att[t], isKing = t === 7;
  const options = [0];
  for (let to = 0; to < 64; to++) {
    const dd = d[s * 64 + to];
    if (dd === 255 || to === k || (isKing && kingDistance(to, k) <= 1)) continue;
    let mask = 0;
    for (let i = isKing ? 1 : 0; i < n; i++) if (a[to * 64 + T[i]]) mask |= 1 << i;
    if (!mask) continue;
    if (dd < c[mask]) c[mask] = dd;
    options.push(dd << 16 | mask);
  }
  for (let b = 0; b < n; b++) for (let S = 0; S < size; S++) if (!(S & (1 << b)) && c[S | (1 << b)] < c[S]) c[S] = c[S | (1 << b)];
  c[0] = 0;
  options.sort((x, y) => (x >>> 16) - (y >>> 16) || popcount(y & 0xffff) - popcount(x & 0xffff));
  const front = [];
  for (const o of options) {
    const m = o & 0xffff;
    if (!front.some(q => ((q & 0xffff) & m) === m)) front.push(o);
  }
  R.cover[key] = c; R.front[key] = Int32Array.from(front);
}
/* The squares the defending king may stand on, nearest to its square fk first (in the region; ties
   from a1), the unreachable ones left out: mateBound stops at the first that is too far. */
function kingOrder(R, fk) {
  const d = R.dist[0], row = fk * 64, out = [];
  for (const k of R.kingList) if (d[row + k] !== 255) out.push(k);
  out.sort((a, b) => d[row + a] - d[row + b] || a - b);
  return (R.byDistance[fk] = Uint8Array.from(out));
}
function coverOf(R, t, s, k) { const key = (t * 64 + s) * 64 + k; if (!R.cover[key]) pieceNet(R, t, s, k); return R.cover[key]; }
function frontOf(R, t, s, k) { const key = (t * 64 + s) * 64 + k; if (!R.front[key]) pieceNet(R, t, s, k); return R.front[key]; }

/* The mater's fewest moves to cover the targets `need` of the net on k with its pieces (type
   indices mt, squares ms, count n): every piece but the last walks its front, the last looks its
   cost up; a branch stops once it costs as much as the best cover found. With more than
   CLOCK_EXACT_PIECES pieces (a composed position: the walk would grow with the product of their
   fronts) it is only the dearest single target, at its cheapest piece: still a lower bound. */
const CLOCK_EXACT_PIECES = 4;
function materCover(R, mt, ms, n, k, need) {
  if (!need) return 0;
  if (n > CLOCK_EXACT_PIECES) {
    let worst = 0;
    for (let b = need; b; b &= b - 1) {
      const bit = b & -b;
      let m = CLOCK_INF;
      for (let j = 0; j < n; j++) { const c = coverOf(R, mt[j], ms[j], k)[bit]; if (c < m) m = c; }
      if (m > worst) worst = m;
    }
    return worst;
  }
  const last = coverOf(R, mt[n - 1], ms[n - 1], k);
  let best = last[need];
  if (n === 1) return best;
  if (n === 2) {
    const f0 = frontOf(R, mt[0], ms[0], k);
    for (let i = 0; i < f0.length; i++) {
      const c0 = f0[i] >>> 16; if (c0 >= best) break;
      const v = c0 + last[need & ~(f0[i] & 0xffff)]; if (v < best) best = v;
    }
    return best;
  }
  if (n === 3) {
    const f0 = frontOf(R, mt[0], ms[0], k), f1 = frontOf(R, mt[1], ms[1], k);
    for (let i = 0; i < f0.length; i++) {
      const c0 = f0[i] >>> 16; if (c0 >= best) break;
      const n0 = need & ~(f0[i] & 0xffff);
      for (let j = 0; j < f1.length; j++) {
        const c1 = c0 + (f1[j] >>> 16); if (c1 >= best) break;
        const v = c1 + last[n0 & ~(f1[j] & 0xffff)]; if (v < best) best = v;
      }
    }
    return best;
  }
  const fronts = [];
  for (let j = 0; j < n - 1; j++) fronts.push(frontOf(R, mt[j], ms[j], k));
  const walk = (j, left, cost) => {
    if (j === n - 1) { const v = cost + last[left]; if (v < best) best = v; return; }
    const f = fronts[j];
    for (let i = 0; i < f.length; i++) { const c = cost + (f[i] >>> 16); if (c >= best) break; walk(j + 1, left & ~(f[i] & 0xffff), c); }
  };
  walk(0, need, 0);
  return best;
}

/* The fewest moves for one defending piece (type, on s) to stand on each flight of the net on k. */
function blockerCost(R, type, s, k) {
  const key = (type * 64 + s) * 64 + k;
  let c = R.block[key];
  if (c) return c;
  const T = R.targets[k], d = R.dist[type];
  c = new Int16Array(T.length).fill(CLOCK_INF);
  for (let i = 1; i < T.length; i++) { const dd = d[s * 64 + T[i]]; if (dd !== 255) c[i] = dd; }
  R.block[key] = c;
  return c;
}

/* The plies of a line in which the mater makes m moves (the last one mates) and the defender f,
   with the mater to move or not: the two alternate, and either may wait. */
function pliesFor(m, f, materToMove) {
  if (m >= CLOCK_INF || f >= CLOCK_INF) return CLOCK_INF;
  return materToMove ? 2 * Math.max(m, f + 1, 1) - 1 : 2 * Math.max(m, f, 1);
}

/* Material, for the exits that leave the mater without mating material whatever the position. */
function materialOf(pos, mater) {
  const m = { Q: 0, R: 0, B: 0, N: 0, P: 0, other: 0 };
  for (let s = 0; s < 64; s++) {
    const p = pos.board[s]; if (!p) continue;
    const t = p & 7;
    if ((p & WHITE) === mater) { if (t === QUEEN) m.Q++; else if (t === ROOK) m.R++; else if (t === BISHOP) m.B++; else if (t === KNIGHT) m.N++; else if (t === PAWN) m.P++; }
    else if (t !== KING) m.other++;
  }
  return m;
}
function deadByMaterial(m, mater, victimType, victimColour) {
  let Q = m.Q, R = m.R, B = m.B, N = m.N, P = m.P, other = m.other;
  if (victimColour === mater) { if (victimType === QUEEN) Q--; else if (victimType === ROOK) R--; else if (victimType === BISHOP) B--; else if (victimType === KNIGHT) N--; else if (victimType === PAWN) P--; }
  else other--;
  if (Q + R + B + N + P === 0) return true;
  return P === 0 && Q + R === 0 && B + N <= 1 && other === 0;
}

/* The exits of one search (the material and the pawns stand still in the region): the pushes
   (the square ahead, the pawn's colour), the colours whose pawns can take a pawn without the exit
   being dead by material, the pieces (by colour | type) whose capture is not, the pawns whose
   capture is not (the pawn's square, the capturing colour), and the colours that have pawns. */
function exitPlanOf(R, pos) {
  const board = pos.board, mater = R.mater, mat = materialOf(pos, mater);
  const pushes = [], pawnTakes = [false, false], victims = new Uint8Array(16), pawns = [], hasPawn = [false, false];
  for (let s = 0; s < 64; s++) {
    const p = board[s]; if (!p) continue;
    const t = p & 7, c = p & WHITE;
    if (t === PAWN) {
      const ahead = s + (c === WHITE ? 8 : -8);
      if (ahead < 0 || ahead > 63) continue;
      if (!R.isPawn[ahead]) pushes.push(ahead, c);
      for (const df of [-1, 1]) {
        const f = (s & 7) + df; if (f < 0 || f > 7) continue;
        const v = ahead + df;
        if (R.isPawn[v] && R.pawnOf[v] !== c && !deadByMaterial(mat, mater, PAWN, R.pawnOf[v])) pawnTakes[c >> 3] = true;
      }
      if (!deadByMaterial(mat, mater, PAWN, c)) pawns.push(s, c ^ WHITE);
      hasPawn[c >> 3] = true;
    } else if (t !== KING && !deadByMaterial(mat, mater, t, c)) victims[c | t] = 1;
  }
  return { pushes, pawnTakes, victims, pawns, hasPawn };
}
/* The plies for a piece (type index ta, on sa) to take a piece (type tv, on sv) that may come to
   meet it: the fewest over the squares x of a line in which the capturer makes its moves to x,
   the last one the capture, and the victim its moves to x before it. */
function meetPlies(R, ta, sa, tv, sv, capturerToMove) {
  let row = R.meet[ta * 64 + sa];
  if (!row) row = R.meet[ta * 64 + sa] = new Int16Array(8 * 64 * 2).fill(-1);
  const key = ((tv * 64 + sv) << 1) | (capturerToMove ? 1 : 0);
  let m = row[key];
  if (m !== -1) return m;
  const da = R.dist[ta], dv = R.dist[tv];
  m = CLOCK_INF;
  for (let x = 0; x < 64; x++) {
    if (x === sa) continue;
    const a = da[sa * 64 + x], v = dv[sv * 64 + x];
    if (a === 255 || v === 255) continue;
    const p = pliesFor(a, v, capturerToMove); if (p < m) m = p;
  }
  row[key] = m;
  return m;
}
/* The plies for a piece (type tv of colour `colour`, on sv) to step where an enemy pawn takes it. */
function trapPlies(R, tv, colour, sv, capturerToMove) {
  if (!R.trap) R.trap = new Int16Array(2 * 8 * 64 * 2).fill(-1);
  const key = ((((colour >> 3) * 8 + tv) * 64 + sv) << 1) | (capturerToMove ? 1 : 0);
  let m = R.trap[key];
  if (m !== -1) return m;
  const dv = R.dist[tv], pa = R.pawnAtt[(colour ^ WHITE) >> 3];
  m = CLOCK_INF;
  for (let x = 0; x < 64; x++) if (pa[x]) { const v = dv[sv * 64 + x]; if (v !== 255) { const p = pliesFor(1, v, capturerToMove); if (p < m) m = p; } }
  R.trap[key] = m;
  return m;
}
/* Moves for a piece (type t of colour `colour`, on s) to take the pawn on v: reach a square
   attacking it, then take. */
function takeMoves(R, t, colour, s, v) {
  const ti = t === KING ? (colour === R.mater ? 7 : 0) : t, key = (ti * 64 + s) * 64 + v;
  let m = R.take[key];
  if (m !== -1) return m;
  const d = R.dist[ti], a = R.att[ti === 0 ? 7 : ti];
  m = CLOCK_INF;
  if (a[s * 64 + v]) m = 1;
  else for (let to = 0; to < 64; to++) if (a[to * 64 + v]) { const x = d[s * 64 + to]; if (x !== 255 && x + 1 < m) m = x + 1; }
  R.take[key] = m;
  return m;
}

/* The regions met, by pawn structure and mater (a few dozen at most). */
const regions = new Map();
function regionOf(pos, mater) {
  let key = String(mater);
  for (let s = 0; s < 64; s++) if ((pos.board[s] & 7) === PAWN) key += String.fromCharCode(65 + s + (pos.board[s] & WHITE ? 64 : 0));
  let R = regions.get(key);
  if (!R) { if (regions.size >= 64) regions.clear(); R = regionBuild(pos, mater); regions.set(key, R); }
  return R;
}

export class ClockSearch {
  constructor() {
    this.pos = new Position();
    this.seen = new PositionSet();
    this.dead = new PositionSet();
    this.key = new Int32Array(KEY_WORDS);
    this.moves = new Int32Array(MOVE_STRIDE * 160);
    this.running = false;
    // the pieces of the node being bounded: the mater's (type index, square), the defender's
    // (type, square) and king, all non-pawn pieces by colour, and the mater's placement as a key
    this.mt = new Int32Array(16); this.ms = new Int32Array(16); this.nm = 0;
    this.ft = new Int32Array(16); this.fs = new Int32Array(16); this.nf = 0; this.fk = -1;
    this.pieces = [new Int32Array(16), new Int32Array(16)]; this.np = [0, 0];
    this.placement = 0;
  }

  /** Can `flagged` be mated before the move rule ends the game? Searches the region of `root`
      (see above) and reports { proven, failure, budgetLeft, ruled } as Domino.run does: proven,
      no mate can come in time; failure 'mate' (a mate in time), 'horizon' (an exit in time that
      the ladder does not prove dead: where this search sees no further) or 'budget'. repeat: null, or the repetition set (domino.js);
      exitDead(pos, flagged) the ladder at an exit: { proven, nodes }. */
  run(root, flagged, moveRule, budget, repeat, exitDead) {
    if (this.running) throw new Error('the clock search was started again while running');
    this.running = true;
    try {
      const pos = this.pos;
      pos.copyFrom(root);
      this.flagged = flagged; this.moveRule = moveRule; this.budget = budget; this.failure = null;
      this.repeat = repeat && repeat.count > 0 ? repeat : null; this.exitDead = exitDead;
      this.seen.clear(); this.dead.clear();
      const mater = flagged ^ WHITE;
      if (!hasLegalMove(pos)) {
        const mated = pos.side === flagged && inCheck(pos);
        return { proven: !mated, failure: mated ? 'mate' : null, budgetLeft: budget, ruled: false };
      }
      this.R = regionOf(pos, mater);
      this.X = exitPlanOf(this.R, pos);
      this.bounded = pos.castling === 0;                 // castling would let a king or rook jump
      const hit = this.node(0);
      if (pos.undoTop !== 0) throw new Error('the clock search left moves on the board');
      return { proven: !hit, failure: hit ? this.failure : null, budgetLeft: Math.max(this.budget, 0), ruled: !hit };
    } finally {
      this.running = false;
      this.exitDead = null;
    }
  }

  /** The search from the position on the board: true when it found a mate or a live exit in time
      (or ran out of budget), false when none can come from here. */
  node(ply) {
    const pos = this.pos, key = this.key;
    writeKey(pos, key, 0);
    const h = hashKey(key, 0);
    if (this.repeat && this.repeat.has(key, 0, h)) return false;        // the repetition rule ends the game: drawn
    if (!this.seen.add(key, 0, h, Math.min(pos.halfmove, 0x7fffffff))) return false;   // met before: covered there
    const rem = this.moveRule - pos.halfmove;
    if (rem <= 0) return false;                       // the move rule ends the game (a mate was seen when made)
    if (this.bounded && this.bound(rem) > rem) return false;
    const moves = this.moves, base = ply * MOVE_STRIDE, n = generateLegalMoves(pos, moves, base), flagged = this.flagged;
    // the exits first: one that is alive ends the search at once
    for (let pass = 0; pass < 2; pass++) for (let i = 0; i < n; i++) {
      const move = moves[base + i], from = move & 63, to = (move >> 6) & 63, flags = move >> 12;
      const exit = (pos.board[to] !== 0 && !(flags & FLAG_CASTLE)) || (flags & FLAG_EP) !== 0 || (pos.board[from] & 7) === PAWN;
      if (exit !== (pass === 0)) continue;
      const choices = flags & FLAG_PROMO ? 4 : 1;
      for (let c = 0; c < choices; c++) {
        if (!(this.budget-- > 0)) { this.failure = 'budget'; return true; }
        doMove(pos, move, PROMOTION_ORDER[c]);
        let hit = false;
        if (pos.side === flagged && inCheck(pos) && !hasLegalMove(pos)) { this.failure = 'mate'; hit = true; }
        else if (exit) { if (!this.exitIsDead()) { this.failure = 'horizon'; hit = true; } }
        else hit = this.node(ply + 1);
        undoMove(pos);
        if (hit) return true;
      }
    }
    return false;
  }

  /** Is the exit on the board dead (the ladder proves the flagged side can never be mated there)?
      Its nodes are paid from the budget; the dead ones are kept. */
  exitIsDead() {
    const pos = this.pos, key = this.key;
    writeKey(pos, key, 0);
    const h = hashKey(key, 0);
    if (this.dead.has(key, 0, h)) return true;
    const r = this.exitDead(pos, this.flagged);
    this.budget -= r.nodes;
    if (r.proven) { writeKey(pos, key, 0); this.dead.add(key, 0, h); }
    return r.proven;
  }

  /** A lower bound on the plies from the position on the board to a mate or a live exit, or any
      value above rem once it is sure the bound is above rem. */
  bound(rem) {
    this.scan();
    const he = this.exitBound();
    if (he <= rem) return he;
    return Math.min(he, this.mateBound(rem));
  }

  /** The pieces on the board (all but the pawns, square by square from a1: the bitboards' order). */
  scan() {
    const pos = this.pos, board = pos.board, mater = this.R.mater, mt = this.mt, ms = this.ms, ft = this.ft, fs = this.fs;
    let nm = 0, nf = 0, fk = -1;
    const np = this.np; np[0] = 0; np[1] = 0;
    const lo = pos.lo, hi = pos.hi;
    for (let half = 0; half < 2; half++) {
      let w = half ? (hi[WHITE] | hi[0]) & ~(hi[WHITE | PAWN] | hi[PAWN]) : (lo[WHITE] | lo[0]) & ~(lo[WHITE | PAWN] | lo[PAWN]);
      while (w) {
        const s = 32 * half + lowestBit(w);
        w &= w - 1;
        const p = board[s], t = p & 7, c = p & WHITE;
        this.pieces[c >> 3][np[c >> 3]++] = s;
        if (c === mater) { mt[nm] = t === KING ? 7 : t; ms[nm++] = s; }
        else if (t === KING) fk = s; else { ft[nf] = t; fs[nf++] = s; }
      }
    }
    this.nm = nm; this.nf = nf; this.fk = fk;
    if (nm <= 5) { let x = 0; for (let j = 0; j < nm; j++) x = x * 512 + mt[j] * 64 + ms[j]; this.placement = x; }
    else { let x = ''; for (let j = 0; j < nm; j++) x += String.fromCharCode(mt[j] * 64 + ms[j]); this.placement = x; }
  }

  /** The plies to an exit that is not dead by material. */
  exitBound() {
    const pos = this.pos, R = this.R, X = this.X;
    if (pos.ep !== NO_SQUARE) return 1;
    const board = pos.board, side = pos.side;
    let best = CLOCK_INF;
    const pu = X.pushes;
    for (let i = 0; i < pu.length; i += 2) { const v = board[pu[i]] ? 2 : side === pu[i + 1] ? 1 : 2; if (v < best) { if (v === 1) return 1; best = v; } }
    for (let ci = 0; ci < 2; ci++) if (X.pawnTakes[ci]) { const v = side === ci << 3 ? 1 : 2; if (v < best) { if (v === 1) return 1; best = v; } }
    // a piece taken, by a piece that meets it or by a pawn it steps in front of
    for (let vi = 0; vi < 2; vi++) {
      const V = vi << 3, C = V ^ WHITE, list = this.pieces[vi], cnt = this.np[vi];
      const caps = this.pieces[C >> 3], ncap = this.np[C >> 3], toMove = side === C;
      for (let j = 0; j < cnt; j++) {
        const sv = list[j], tv = board[sv] & 7;
        if (tv === KING || !X.victims[V | tv]) continue;
        for (let q = 0; q < ncap; q++) {
          const sa = caps[q], t = board[sa] & 7, ta = t === KING ? (C === R.mater ? 7 : 0) : t;
          const x = meetPlies(R, ta, sa, tv, sv, toMove); if (x < best) { if (x === 1) return 1; best = x; }
        }
        if (X.hasPawn[C >> 3]) { const x = trapPlies(R, tv, V, sv, toMove); if (x < best) { if (x === 1) return 1; best = x; } }
      }
    }
    const pw = X.pawns;
    for (let i = 0; i < pw.length; i += 2) {
      const v = pw[i], by = pw[i + 1], list = this.pieces[by >> 3], cnt = this.np[by >> 3];
      for (let j = 0; j < cnt; j++) {
        const s = list[j], m = takeMoves(R, board[s] & 7, by, s, v);
        if (m >= CLOCK_INF) continue;
        const x = side === by ? 2 * m - 1 : 2 * m; if (x < best) { if (x === 1) return 1; best = x; }
      }
    }
    return best;
  }

  /** The plies to a mate in the region, or any value above limit once it is sure the bound is
      above limit. Per placement of the mater's pieces it keeps, for each k, the cheapest check,
      the whole net's cost, and the three dearest single flights (each at its cheapest piece):
      with j defending pieces that may each take a flight, the mater still covers the
      (j + 1)-th dearest. */
  mateBound(limit) {
    const R = this.R, pos = this.pos, mt = this.mt, ms = this.ms, nm = this.nm, nf = this.nf, fk = this.fk;
    let piece = false;
    for (let j = 0; j < nm; j++) if (mt[j] !== 7) { piece = true; break; }
    if (!piece) return CLOCK_INF;                   // a king alone (its pawns stand still) gives no check
    // pliesFor(m, f) <= limit exactly when max(m, f + (materToMove ? 1 : 0), 1) <= most
    const materToMove = pos.side === R.mater, most = materToMove ? (limit + 1) >> 1 : limit >> 1;
    const maxF = materToMove ? most - 1 : most;
    let known = R.placements.get(this.placement);
    if (!known) {
      if (R.placements.size >= 300000) R.placements.clear();
      known = new Int16Array(64 * 5).fill(-1); R.placements.set(this.placement, known);
    }
    if (most < 1) return CLOCK_INF;
    const dK = R.dist[0], kings = R.byDistance[fk] || kingOrder(R, fk), nk = kings.length, row = fk * 64;
    let rest = null;
    for (let q = 0; q < nk; q++) {
      const k = kings[q], fK = dK[row + k];
      if (fK > maxF) break;                          // the rest are as far or farther
      let check = known[k];
      if (check === -1) {
        check = CLOCK_INF;
        for (let j = 0; j < nm; j++) if (mt[j] !== 7) { const c = coverOf(R, mt[j], ms[j], k)[1]; if (c < check) check = c; }
        known[k] = check;
      }
      if (check > most) continue;
      const n = R.targets[k].length, full = (1 << n) - 1;
      if (known[64 + k] === -1) {
        let a = 0, b = 0, c3 = 0;                      // the three dearest single flights
        for (let i = 1; i < n; i++) {
          let m = CLOCK_INF;
          for (let j = 0; j < nm; j++) { const c = coverOf(R, mt[j], ms[j], k)[1 << i]; if (c < m) m = c; }
          if (m > a) { c3 = b; b = a; a = m; } else if (m > b) { c3 = b; b = m; } else if (m > c3) c3 = m;
        }
        known[64 + k] = a; known[192 + k] = b; known[256 + k] = c3;
      }
      const single = nf === 0 ? known[64 + k] : nf === 1 ? known[192 + k] : nf === 2 ? known[256 + k] : 0;
      if (single > most) continue;
      if (nf === 0) {
        let net = known[128 + k];
        if (net === -1) { net = materCover(R, mt, ms, nm, k, full); known[128 + k] = net; }
        const p = pliesFor(net, fK, materToMove);
        if (p <= limit) return p;
      } else if (nf === 1) {
        // one defending piece: it takes no flight, or flight i (the mater's cover of the rest is
        // kept per placement)
        let net = known[128 + k];
        if (net === -1) { net = materCover(R, mt, ms, nm, k, full); known[128 + k] = net; }
        let p = pliesFor(net, fK, materToMove);
        if (p <= limit) return p;
        if (!rest) {
          rest = R.blocked.get(this.placement);
          if (!rest) {
            if (R.blocked.size >= 50000) R.blocked.clear();
            rest = new Int16Array(64 * 9).fill(-1); R.blocked.set(this.placement, rest);
          }
        }
        const c = blockerCost(R, this.ft[0], this.fs[0], k);
        for (let i = 1; i < n; i++) {
          if (c[i] >= CLOCK_INF || pliesFor(check, fK + c[i], materToMove) > limit) continue;
          let v = rest[k * 9 + i];
          if (v === -1) { v = materCover(R, mt, ms, nm, k, full & ~(1 << i)); rest[k * 9 + i] = v; }
          p = pliesFor(v, fK + c[i], materToMove);
          if (p <= limit) return p;
        }
      } else {
        // the defending pieces may stand on flights instead, each on one, paid in its own moves
        const costs = [];
        for (let j = 0; j < nf; j++) costs.push(blockerCost(R, this.ft[j], this.fs[j], k));
        let found = CLOCK_INF;
        const place = (j, taken, f) => {
          if (found <= limit) return;
          if (j === nf) { const p = pliesFor(materCover(R, mt, ms, nm, k, full & ~taken), f, materToMove); if (p < found) found = p; return; }
          place(j + 1, taken, f);
          const c = costs[j];
          for (let i = 1; i < n; i++)
            if (!(taken & (1 << i)) && c[i] < CLOCK_INF && pliesFor(check, f + c[i], materToMove) <= limit) place(j + 1, taken | (1 << i), f + c[i]);
        };
        place(0, 0, fK);
        if (found <= limit) return found;
      }
    }
    return CLOCK_INF;
  }
}
