/* Mateless's lock detector, second version, in its simplest form.

   Can a side never be mated? The lock detector answers yes when pawns, kings and bishops (and
   knights, rooks or queens boxed in by their own men) form a structure that no series of legal
   moves can open (FIDE 5.2.2 dead position, 6.9 flag fall). It reads bitboards and the side to
   move: it generates no move and searches nothing.

   The first version (../../javascript/lock.mjs) grows each king's reach, the pawns that can never
   move, and the squares where each side may take a pawn, until nothing changes; the structure leaks
   if a pawn can promote or capture, a frozen king can move, a bishop can reach a pawn's path, or
   the king asked about can reach a square the other side attacks without a sure flight. This
   version keeps all of it and adds, each only where its situation is on the board:
     - open pawn pairs: a white and a black pawn on one file with one empty square between them;
       the reachable positions split into families by what the pair's pawns have done (neither
       moved, the white one stepped into the gap, the black one did), up to 3 pairs;
     - boxed knights, rooks and queens: a piece whose every step square holds one of its own men
       that never moves, and that no enemy king or bishop reaches, never moves nor falls; such a man
       is a fixed pawn, another boxed piece, a still bishop (every diagonal neighbour held so, and
       out of the enemy king's and bishops' reach) or the piece's own frozen king (its side with no
       castling right left and not standing where a castle leaves it beside its rook);
     - twin bishops: two bishops of one side on one colour no longer fail it; the mating net leaves
       out its second flight rule where they may hold both flights;
     - the stalemate guard: a pawn the enemy king may take stays a wall if taking it always
       stalemates its owner;
     - the check seed: a king in a pawn's check starts its reach from the squares it can step to;
     - the stuck mater: whatever the flagged side plays, the mater is left without a move;
     - the forced step: a king in a pawn's check with one legal move, a step: the lock of the
       position after it.
   A possible en passant capture fails it at once. Sound, not complete: a structure it passes can
   never be opened; one it fails may still be dead.

   Squares: a1 = 0, b1 = 1, ..., h8 = 63. A set of squares (a bitboard) is a BigInt kept to 64 bits.
   Mateless's own engine (mateless.js, src/lock.js, on the second-version branch) is its fast implementation. */

const ALL = (1n << 64n) - 1n;  // BigInts have no size: every set is kept to 64 bits
const FILE_A = 0x0101010101010101n;
const FILE_H = 0x8080808080808080n;
const RANK_1 = 0x00000000000000FFn;
const RANK_3 = 0x0000000000FF0000n;
const RANK_6 = 0x0000FF0000000000n;
const RANK_8 = 0xFF00000000000000n;
const DARK = 0xAA55AA55AA55AA55n;  // the dark squares; a1 is dark
const MAX_PAIRS = 3;               // the most open pairs the families are split on (3^3 = 27)

function north(s) { return (s << 8n) & ALL; }
function south(s) { return s >> 8n; }
function sideways(s) { return ((s << 1n) & ~FILE_A & ALL) | ((s >> 1n) & ~FILE_H); }
function zone(s) { const v = s | north(s) | south(s); return v | sideways(v); }  // s and every square next to it
function steps(s) { return zone(s) & no(s); }                                  // the squares next to s
function diagonal(s) { return sideways(north(s) | south(s)); }                 // the squares diagonally next to s
function knight(s) {                                                           // the squares a knight on s goes to
  const one = sideways(s);
  const two = ((s << 2n) & ~(FILE_A | (FILE_A << 1n)) & ALL) | ((s >> 2n) & ~(FILE_H | (FILE_H >> 1n)));
  return north(north(one)) | south(south(one)) | north(two) | south(two);
}
function count(s) { let n = 0; for (; s; s &= s - 1n) n++; return n; }
function no(s) { return ~s & ALL; }  // every square not in s

/** Every square reachable from g by steps north through squares of p. */
function fillNorth(g, p) {
  g |= p & north(g);
  p &= north(p);
  g |= p & ((g << 16n) & ALL);
  p &= (p << 16n) & ALL;
  return g | (p & ((g << 32n) & ALL));
}

/** Every square reachable from g by steps south through squares of p. */
function fillSouth(g, p) {
  g |= p & south(g);
  p &= south(p);
  g |= p & (g >> 16n);
  p &= p >> 16n;
  return g | (p & (g >> 32n));
}

/** Every square a king may reach from k through squares of m. */
function flood(k, m) {
  for (;;) { const a = k | (zone(k) & m); if (a === k) return k; k = a; }
}

/**
 * What the lock detector reads from a position.
 * @typedef {object} Pieces
 * @property {bigint} whitePawns
 * @property {bigint} blackPawns
 * @property {bigint} whiteKing
 * @property {bigint} blackKing
 * @property {bigint} whiteBishops
 * @property {bigint} blackBishops
 * @property {bigint} whiteKnights
 * @property {bigint} blackKnights
 * @property {bigint} whiteRooks
 * @property {bigint} blackRooks
 * @property {bigint} whiteQueens
 * @property {bigint} blackQueens
 * @property {boolean} whiteToMove
 * @property {boolean} enPassant  the side to move can capture en passant
 * @property {boolean} whiteCastles  White has a castling right (its king and that rook in place)
 * @property {boolean} blackCastles
 */

/**
 * The pieces of a FEN. The en passant square counts only if a pawn can capture onto it.
 * @param {string} fen
 * @returns {Pieces}
 */
export function fromFen(fen) {
  const fields = fen.split(' ');
  const p = { whitePawns: 0n, blackPawns: 0n, whiteKing: 0n, blackKing: 0n, whiteBishops: 0n, blackBishops: 0n,
              whiteKnights: 0n, blackKnights: 0n, whiteRooks: 0n, blackRooks: 0n, whiteQueens: 0n, blackQueens: 0n,
              whiteToMove: fields[1] !== 'b', enPassant: false, whiteCastles: false, blackCastles: false };
  const names = { P: 'whitePawns', p: 'blackPawns', K: 'whiteKing', k: 'blackKing', B: 'whiteBishops', b: 'blackBishops',
                  N: 'whiteKnights', n: 'blackKnights', R: 'whiteRooks', r: 'blackRooks', Q: 'whiteQueens', q: 'blackQueens' };
  let rank = 7, file = 0;
  for (const c of fields[0]) {
    if (c === '/') { rank--; file = 0; continue; }
    if (c >= '1' && c <= '8') { file += Number(c); continue; }
    p[names[c]] |= 1n << BigInt(8 * rank + file++);
  }
  const ep = fields[3] ?? '-';
  if (ep !== '-') {
    const target = 1n << BigInt(ep.charCodeAt(0) - 'a'.charCodeAt(0) + 8 * (Number(ep[1]) - 1));
    p.enPassant = p.whiteToMove ? (sideways(south(target)) & p.whitePawns) !== 0n
                                : (sideways(north(target)) & p.blackPawns) !== 0n;
  }
  const rights = fields[2] ?? '-';
  for (const c of rights === '-' ? '' : rights) {
    const white = c === c.toUpperCase(), back = white ? RANK_1 : RANK_8;
    const king = (white ? p.whiteKing : p.blackKing) & back, rooks = (white ? p.whiteRooks : p.blackRooks) & back;
    if (!king) continue;                         // a right without its king in place does not count
    const kf = squareOf(king) % 8, files = [...squares(rooks)].map(r => squareOf(r) % 8), up = c.toUpperCase();
    const ok = up === 'K' ? files.some(f => f > kf) : up === 'Q' ? files.some(f => f < kf)
             : up.charCodeAt(0) - 65 !== kf && files.includes(up.charCodeAt(0) - 65);
    if (ok) { if (white) p.whiteCastles = true; else p.blackCastles = true; }
  }
  return p;
}

/** The one-square sets of s. */
function* squares(s) { while (s) { const b = s & -s; yield b; s ^= b; } }
/** The square of a one-square set. */
function squareOf(b) { return b.toString(2).length - 1; }

/**
 * Can White (white = true) or Black never be mated, by the lock detector?
 * @param {Pieces} p
 * @param {boolean} white
 * @returns {boolean}
 */
export function cannotBeMated(p, white) {
  const after = forcedStep(p);
  if (after) return cannotBeMated(after, white);
  const wx = p.whiteKnights | p.whiteRooks | p.whiteQueens, bx = p.blackKnights | p.blackRooks | p.blackQueens;
  if (wx | bx) return boxedLock(p, white, wx, bx);
  if (p.enPassant) return false;
  const gaps = north(p.whitePawns) & south(p.blackPawns) & no(p.whitePawns | p.blackPawns);
  for (const frozen of levels(p)) {
    if (gaps) {
      const f = families(p, gaps, frozen, white);
      if (f === 'lock') return true;
      if (f === 'refuted') continue;   // family A, the level with more walls, leaked: the level leaks too
    }
    const s = level(p, frozen, { guard: true });
    if (s && !netLeaks(p, s, white, 0n)) return true;
  }
  return materStuck(p, white);
}

/** The levels: both kings free (0), then each king frozen on its square (a wall for both sides)
    when every square around it is held or attacked by a pawn (or holds one of its own pieces, wOwn
    or bOwn, where boxed pieces are on the board). */
function levels(p, wOwn = 0n, bOwn = 0n) {
  const held = p.whitePawns | p.blackPawns | sideways(north(p.whitePawns) | south(p.blackPawns));
  const out = [0n];
  for (const [king, own] of [[p.whiteKing, wOwn], [p.blackKing, bOwn]]) if ((steps(king) & no(held | own)) === 0n) out.push(king);
  return out;
}

/** May this side's king hold a boxed piece's step square (when frozen)? Not with a castling right
    left (a castling rook may stand beside its king, in Chess960, and castling moves it), and not
    where a castle leaves it beside its rook (g1 with a rook on f1, c1 with one on d1; g8, f8, c8,
    d8): a castle leaves the halfmove clock as it is, so the lock is not asked after one. */
function kingWall(p, white) {
  const [king, rooks, castles, g, c] = white ? [p.whiteKing, p.whiteRooks, p.whiteCastles, 1n << 6n, 1n << 2n]
                                              : [p.blackKing, p.blackRooks, p.blackCastles, 1n << 62n, 1n << 58n];
  return !castles && (rooks & (((king & g) >> 1n) | ((king & c) << 1n))) === 0n;
}

/** The still bishops among b: every diagonal neighbour held for good (held: fixed pawns and boxed
    pieces of their colour) or by another still bishop, and out of the enemy king's and bishops'
    reach. Such a bishop never moves and is never taken (a pawn taking it fails the bishop contact
    test). The largest such set. */
function stillBishops(b, held, reach) {
  let s = b & no(reach);
  for (;;) {
    let n = 0n;
    for (const q of squares(s)) if ((diagonal(q) & no(held | s)) === 0n) n |= q;
    if (n === s) return s;
    s = n;
  }
}

/**
 * One level: the fixed point of the walls, the pawns that can never move, the kings' reaches, the
 * squares where each side may take a pawn, the pawns' cones and the bishops' reaches. Returns the
 * sets the mating net reads, or null when the structure leaks whichever side is asked about.
 * o: wp, bp  the pawns (a family has a pair's pawn moved into its gap); v walls for both sides (the
 *            gaps of a family's pairs that stay); start: where the kings' reaches, capture squares and
 *            bishops' reaches start (a family's); wx, bx, ws, bs: the boxed pieces' candidates and
 *            their step squares; guard: the stalemate guard and the check seed (plain levels only).
 */
function level(p, frozen, o) {
  const wp = o.wp ?? p.whitePawns, bp = o.bp ?? p.blackPawns, wk = p.whiteKing, bk = p.blackKing;
  const wx = o.wx ?? 0n, bx = o.bx ?? 0n, v = (o.v ?? 0n) | frozen;
  const frozenWhite = (frozen & wk) !== 0n;
  const frozenBlack = !frozenWhite && frozen !== 0n;
  const nearFrozenBlack = frozenBlack ? zone(bk) : 0n;
  const nearFrozenWhite = frozenWhite ? zone(wk) : 0n;
  let [wSeed, bSeed] = o.guard && frozen === 0n ? checkSeed(p) : [wk, bk];
  let wKing = wSeed, bKing = bSeed, wTake = wSeed, bTake = bSeed;
  let wBish = p.whiteBishops, bBish = p.blackBishops;
  if (o.start) ({ wKing, bKing, wTake, bTake, wBish, bBish } = o.start);
  let wCone = wp, bCone = bp, wFixed = wp, bFixed = bp;
  let wGuard = o.guard ? ALL : 0n, bGuard = o.guard ? ALL : 0n;   // nothing is taken yet
  for (;;) {
    // Boxed: the pieces no enemy king or bishop reaches. Walls: pawns the other side can never
    // take (or whose capture stalemates their owner), the frozen king, the gaps, boxed pieces.
    const boxed = (wx & no(bKing | bBish)) | (bx & no(wKing | wBish));
    const wWall = (wp & no(bTake & no(wGuard))) | v | boxed;
    const bWall = (bp & no(wTake & no(bGuard))) | v | boxed;
    const nwFixed = wFixed & wWall & south(bWall | wFixed);
    const nbFixed = bFixed & bWall & north(wWall | bFixed);
    const nwCone = fillNorth(wCone, no(bWall)), nbCone = fillSouth(bCone, no(wWall));
    // The kings: never onto a fixed pawn, a square it attacks, or next to the frozen king; with
    // boxed pieces on the board, never onto its own boxed pieces and still bishops either.
    const bHit = sideways(south(nbFixed)), wHit = sideways(north(nwFixed));
    const wStill = wx | bx ? stillBishops(p.whiteBishops, nwFixed | (wx & boxed), bKing | bBish) : 0n;
    const bStill = wx | bx ? stillBishops(p.blackBishops, nbFixed | (bx & boxed), wKing | wBish) : 0n;
    const nwKing = flood(wKing, no(nwFixed | bHit | nearFrozenBlack | (wx & boxed) | wStill));
    const nbKing = flood(bKing, no(nbFixed | wHit | nearFrozenWhite | (bx & boxed) | bStill));
    let nwBish = wBish, nbBish = bBish;
    const open = no(nwFixed | nbFixed);
    for (;;) {
      const a = nwBish | (diagonal(nwBish) & open), d = nbBish | (diagonal(nbBish) & open);
      if (a === nwBish && d === nbBish) break;
      nwBish = a; nbBish = d;
    }
    // A side may take a pawn where its king goes, and on any square a pawn may walk into.
    let t = bTake | nbKing;
    const nbTake = t | south(fillSouth(t & no(bWall), no(bWall)));
    t = wTake | nwKing;
    const nwTake = t | north(fillNorth(t & no(wWall), no(wWall)));
    let nwGuard = wGuard, nbGuard = bGuard;
    if (o.guard) {
      const block = nwFixed | nbFixed, wHasB = p.whiteBishops !== 0n, bHasB = p.blackBishops !== 0n;
      nwGuard = wHasB ? 0n : stalemateGuard(wp & nbTake & nwFixed, wp, nwFixed, nwKing, nwFixed | bHit, nbKing, bHasB, block);
      nbGuard = bHasB ? 0n : stalemateGuard(bp & nwTake & nbFixed, bp, nbFixed, nbKing, nbFixed | wHit, nwKing, wHasB, block);
    }
    const changed = nwCone !== wCone || nbCone !== bCone || nwFixed !== wFixed || nbFixed !== bFixed ||
                    nwKing !== wKing || nbKing !== bKing || nwBish !== wBish || nbBish !== bBish ||
                    nwTake !== wTake || nbTake !== bTake || nwGuard !== wGuard || nbGuard !== bGuard;
    wCone = nwCone; bCone = nbCone; wFixed = nwFixed; bFixed = nbFixed; wKing = nwKing; bKing = nbKing;
    wBish = nwBish; bBish = nbBish; wTake = nwTake; bTake = nbTake; wGuard = nwGuard; bGuard = nbGuard;
    if (!changed) break;
  }
  const boxed = (wx & no(bKing | bBish)) | (bx & no(wKing | wBish));
  if ((wCone & RANK_8) | (bCone & RANK_1)) return null;                        // a pawn can promote
  if ((north(sideways(wCone)) & (bCone | bx)) | (south(sideways(bCone)) & wx)) return null;  // a pawn can capture
  if ((frozenWhite && wKing !== wk) || (frozenBlack && bKing !== bk)) return null;   // the frozen king can move
  if ((diagonal(wBish) & bCone) | (diagonal(bBish) & wCone)) return null;        // a bishop meets a pawn's path
  // A piece may step: a step square not held by a fixed pawn, a boxed piece or a still bishop of
  // its colour, or by its frozen king (where the king may be a wall).
  const wStill = wx | bx ? stillBishops(p.whiteBishops, wFixed | (wx & boxed), bKing | bBish) : 0n;
  const bStill = wx | bx ? stillBishops(p.blackBishops, bFixed | (bx & boxed), wKing | wBish) : 0n;
  const wKw = frozenWhite && kingWall(p, true) ? wk : 0n, bKw = frozenBlack && kingWall(p, false) ? bk : 0n;
  if (((o.ws ?? 0n) & no(wFixed | (wx & boxed) | wStill | wKw)) | ((o.bs ?? 0n) & no(bFixed | (bx & boxed) | bStill | bKw)))
    return null;                                                                 // a piece may step
  if (wGuard | bGuard) {
    // A king that takes a guarded pawn ends the game: for the mating net, the kings' reaches again,
    // now stopping at the enemy's guarded pawns.
    wKing = flood(wSeed, no(wFixed | sideways(south(bFixed)) | nearFrozenBlack | (bp & bGuard)));
    bKing = flood(bSeed, no(bFixed | sideways(north(wFixed)) | nearFrozenWhite | (wp & wGuard)));
  }
  return { wCone, bCone, wFixed, bFixed, wKing, bKing, wBish, bBish, wTake, bTake };
}

/** The mating net: can the other side's pawns and bishops catch the king asked about? occ: squares
    that stand occupied for good besides (the boxed pieces'). */
function netLeaks(p, s, white, occ) {
  let attack, reach, free, spare, twins;
  if (white) {
    attack = diagonal(s.bBish) | sideways(south(s.bCone));
    reach = s.wKing;
    free = no(s.wCone | occ | zone(s.bKing) | attack);   // never occupied, attacked or next to the mater
    spare = free & no(s.wBish);                          // ... nor reached by the king's own bishops
    twins = p.whiteBishops;
  } else {
    attack = diagonal(s.wBish) | sideways(north(s.wCone));
    reach = s.bKing;
    free = no(s.bCone | occ | zone(s.wKing) | attack);
    spare = free & no(s.bBish);
    twins = p.blackBishops;
  }
  // A king next to a spare square, or with free squares beside it both ways, always has a flight.
  // The second rule counts on at most one of the king's own bishops on the colour of those two
  // squares (the colour opposite the king's): not on the king squares where it has two or more.
  const noPair = (count(twins & DARK) > 1 ? no(DARK) : 0n) | (count(twins & no(DARK)) > 1 ? DARK : 0n);
  const flight = sideways(spare) | north(spare) | south(spare) |
                 ((north(free) | south(free)) & sideways(free) & no(noPair));
  return (attack & reach & no(flight)) !== 0n;
}

/** The check seed: the side to move is in a pawn's check, so its king must step now, to a square it
    can step to (not its own pawn, not a square an enemy pawn attacks, not next to the enemy king);
    its reach starts there. Not when it has no such square (that may be a mate now), when one of its
    pawns can take a checking pawn, or with a bishop on the board. The kings' starting sets. */
function checkSeed(p) {
  const wp = p.whitePawns, bp = p.blackPawns, wk = p.whiteKing, bk = p.blackKing, white = p.whiteToMove;
  if (p.whiteBishops | p.blackBishops) return [wk, bk];
  const k = white ? wk : bk, own = white ? wp : bp;
  const checkers = white ? sideways(north(k)) & bp : sideways(south(k)) & wp;
  if (!checkers) return [wk, bk];
  const attacked = white ? sideways(south(bp)) : sideways(north(wp));
  const to = steps(k) & no(own) & no(attacked) & no(steps(white ? bk : wk));
  const takers = (white ? sideways(south(checkers)) : sideways(north(checkers))) & own;
  if (!to || takers) return [wk, bk];
  return white ? [to, bk] : [wk, to];
}

/** The stalemate guard: of the owner's fixed pawns `cand` (which the enemy king may take), those
    whose capture always stalemates the owner. The owner must have nothing else that moves (every
    other pawn fixed; no bishop, which the caller sees to). reach: where the owner's king may stand;
    shut: squares it can never step to (own fixed pawns, squares the enemy's fixed pawns attack);
    enemyKing: the enemy king's reach; block: squares a bishop's line never crosses. */
function stalemateGuard(cand, own, ownFixed, reach, shut, enemyKing, enemyBishops, block) {
  if (own & no(ownFixed)) return 0n;
  let guard = 0n;
  for (let c = cand; c; c &= c - 1n) {
    const pawn = c & -c, near = steps(pawn);
    const from = near & enemyKing;                    // where the enemy king takes from
    const x = shut | near | pawn;                     // after the capture, the owner's king may not step there
    let held = true;
    for (let k = reach & no(near | pawn); k; k &= k - 1n) {   // the owner's king, not defending the pawn
      const king = k & -k;
      if (steps(king) & no(x)) { held = false; break; }                  // it has a square to step to
      if (enemyBishops && rayMeets(king, block | pawn, from)) { held = false; break; }  // the capture uncovers a check
    }
    if (held) guard |= pawn;
  }
  return guard;
}

/** Does a diagonal line from the square `king`, stopped by `block`, meet a square of `o`? */
function rayMeets(king, block, o) {
  const sq = count(king - 1n), f0 = sq & 7, r0 = sq >> 3;
  for (const [df, dr] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    for (let f = f0 + df, r = r0 + dr; f >= 0 && f < 8 && r >= 0 && r < 8; f += df, r += dr) {
      const s = 1n << BigInt(8 * r + f);
      if (o & s) return true;
      if (block & s) break;
    }
  }
  return false;
}

/** The families of the open pairs at one level: 'lock' when none of them leaks to the king asked
    about, 'refuted' when family A (no pair's pawn has moved) does, 'none' otherwise. */
function families(p, gaps, frozen, white) {
  const pairs = [];   // per pair: the gap, the white pawn below it, the black pawn above it
  for (let g = gaps; g; g &= g - 1n) { const gap = g & -g; pairs.push([gap, south(gap), north(gap)]); }
  if (pairs.length > MAX_PAIRS) return 'none';
  const k = pairs.length, sets = [];
  for (let f = 0; f < 3 ** k; f++) {
    // Family f: digit i (base 3) says what pair i's pawns have done: 0 neither, 1 the white one
    // stepped into the gap, 2 the black one did. Its sets start from those of the family it is
    // reached from (the same with pair i's pawns in place), minus the gap.
    let wp = p.whitePawns, bp = p.blackPawns, v = 0n;
    const start = f === 0
      ? { wKing: p.whiteKing, bKing: p.blackKing, wTake: p.whiteKing, bTake: p.blackKing, wBish: p.whiteBishops, bBish: p.blackBishops }
      : { wKing: 0n, bKing: 0n, wTake: 0n, bTake: 0n, wBish: 0n, bBish: 0n };
    for (let i = 0, q = f; i < k; i++, q = Math.floor(q / 3)) {
      const d = q % 3, [gap, w, b] = pairs[i];
      if (d === 0) { v |= gap; continue; }           // the gap stays: a wall for both sides' pawns
      if (d === 1) wp = (wp & no(w)) | gap; else bp = (bp & no(b)) | gap;
      const r = sets[f - d * 3 ** i];
      start.wKing |= r.wKing & no(gap); start.bKing |= r.bKing & no(gap);
      start.wTake |= r.wTake; start.bTake |= r.bTake;
      start.wBish |= r.wBish & no(gap); start.bBish |= r.bBish & no(gap);
    }
    const s = level(p, frozen, { wp, bp, v, start });
    if (!s) return f === 0 ? 'refuted' : 'none';
    // The pairs that stay: both pawns must never move.
    for (let i = 0, q = f; i < k; i++, q = Math.floor(q / 3))
      if (q % 3 === 0 && ((pairs[i][1] & no(s.wFixed)) | (pairs[i][2] & no(s.bFixed)))) return 'none';
    if (netLeaks(p, s, white, 0n)) return f === 0 ? 'refuted' : 'none';
    sets.push(s);
  }
  return 'lock';
}

/** With knights, rooks or queens on the board: every one of them must be boxed in by its own pawns
    and pieces (bishops and the king among them: the level checks that they never move); then the
    levels, with the boxed pieces as walls and no flight onto their squares. */
function boxedLock(p, white, wx, bx) {
  const wOwn = p.whitePawns | wx | p.whiteBishops | (kingWall(p, true) ? p.whiteKing : 0n);
  const bOwn = p.blackPawns | bx | p.blackBishops | (kingWall(p, false) ? p.blackKing : 0n);
  const ws = boxSteps(p.whiteKnights, p.whiteRooks | p.whiteQueens, p.whiteQueens, wOwn);
  const bs = boxSteps(p.blackKnights, p.blackRooks | p.blackQueens, p.blackQueens, bOwn);
  if (ws === null || bs === null || p.enPassant) return false;
  for (const frozen of levels(p, wx | p.whiteBishops, bx | p.blackBishops)) {
    const s = level(p, frozen, { wx, bx, ws, bs });
    if (s && !netLeaks(p, s, white, wx | bx)) return true;
  }
  return false;
}

/** The step squares of one side's knights, rooks (and queens: o) and queens, or null when one of
    them is not held by its own men (own). */
function boxSteps(knights, o, queens, own) {
  let s = sideways(o) | north(o) | south(o);   // rooks' and queens' orthogonal neighbours
  if (s & no(own)) return null;
  const d = diagonal(queens);                  // queens' diagonal neighbours
  if (d & no(own)) return null;
  const k = knight(knights);                   // knights' squares
  if (k & no(own)) return null;
  return s | d | k;
}

/** The stuck mater: the flagged side is to move and, whatever it plays, the mater has no legal move
    left (kings and pawns only): the game ends at the mater's turn. */
function materStuck(p, white) {
  if (p.whiteToMove !== white || p.enPassant) return false;
  if (p.whiteBishops | p.blackBishops | p.whiteKnights | p.blackKnights | p.whiteRooks | p.blackRooks |
      p.whiteQueens | p.blackQueens) return false;
  const fp = white ? p.whitePawns : p.blackPawns, mp = white ? p.blackPawns : p.whitePawns;
  const fk = white ? p.whiteKing : p.blackKing, mk = white ? p.blackKing : p.whiteKing;
  const occ = fp | mp | fk | mk;
  const fwd = s => white ? north(s) : south(s), back = s => white ? south(s) : north(s);  // the flagged side's ahead, behind
  // A mater's pawn with an empty square ahead is never stuck; then only a stalemate now is left to
  // find, which a flagged pawn's push rules out.
  if ((back(mp) & no(occ)) && (fwd(fp) & no(occ))) return false;
  const fAttack = sideways(fwd(fp)), mAttack = sideways(back(mp));
  if (fAttack & (mp | mk)) return false;                         // 1. the flagged side has no capture
  const single = fwd(fp) & no(occ);
  const double = fwd(single & (white ? RANK_3 : RANK_6)) & no(occ);
  const pushes = single | double;
  const near = steps(mk);
  const kingTo = steps(fk) & no(fp) & no(mAttack) & no(near);     // the flagged king's steps now
  const inCheck = (fk & mAttack) !== 0n;
  if (inCheck && !kingTo) return false;                           // mated now
  const stays = pushes !== 0n && !inCheck;                        // a pawn may move instead of the king
  if (!kingTo && !stays) return true;                             // no move, no check: stalemate now
  // The squares next to every square the flagged king may stand on after its move.
  let cover = stays ? steps(fk) : ALL;
  for (let k = kingTo; k; k &= k - 1n) cover &= steps(k & -k);
  // 2. the mater's pawns are blocked by men that stay, and attack no flagged pawn
  const blockers = fp | mp | mk | (kingTo ? 0n : fk);
  if ((back(mp) & no(blockers)) | (mAttack & fp)) return false;
  // 3. every square next to the mater's king: its own pawn, attacked by a flagged pawn that cannot
  //    move now, or next to the flagged king wherever it goes
  const still = fp & back(fwd(fp) & occ);
  if (near & no(mp | sideways(fwd(still)) | cover)) return false;
  // 4. no push lands where a mater's pawn attacks or next to its king, nor lets it take en passant
  if ((pushes & (mAttack | near)) | (double & sideways(mp))) return false;
  return true;
}

/** The forced step: the side to move is in a pawn's check, with kings and pawns only, and its one
    legal move is a step of its king. The position after it, or null. */
function forcedStep(p) {
  if (p.enPassant || p.whiteBishops | p.blackBishops | p.whiteKnights | p.blackKnights | p.whiteRooks |
      p.blackRooks | p.whiteQueens | p.blackQueens) return null;
  const white = p.whiteToMove, k = white ? p.whiteKing : p.blackKing, ek = white ? p.blackKing : p.whiteKing;
  const own = white ? p.whitePawns : p.blackPawns, enemy = white ? p.blackPawns : p.whitePawns;
  const checkers = (white ? sideways(north(k)) : sideways(south(k))) & enemy;
  if (!checkers) return null;
  const attacked = white ? sideways(south(enemy)) : sideways(north(enemy));
  const to = steps(k) & no(own) & no(attacked) & no(steps(ek));
  if (count(to) !== 1) return null;
  if ((white ? sideways(south(checkers)) : sideways(north(checkers))) & own) return null;  // a pawn may take instead
  const q = { ...p, whiteToMove: !white, enPassant: false };
  if (white) { q.whiteKing = to; q.blackPawns = p.blackPawns & no(to); }
  else { q.blackKing = to; q.whitePawns = p.whitePawns & no(to); }
  return q;
}
