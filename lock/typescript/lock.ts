/* Mateless's lock detector, in its simplest form.

   Can a side never be mated? The lock detector answers yes when pawns, kings and bishops form a
   structure that no series of legal moves can open (FIDE 5.2.2 dead position, 6.9 flag fall). It
   reads bitboards only: it generates no move and searches nothing.

   Each king's reach (every square it may ever stand on) is grown from its square, never onto a
   square that a pawn which can never move attacks. The pawns that can never move are those
   blocked by a wall: a pawn the other side can never take. The squares where a side may take a
   pawn grow from its king's reach, and so on, until nothing changes. The structure leaks if a
   pawn can promote or capture, a frozen king can move, a bishop can reach a pawn's path, or the
   king of the side asked about can reach a square the other side attacks where it has no sure
   flight. It is tried with both kings free, then with each king frozen on its square (a wall for
   both sides) when every square around that king is held or attacked by a pawn.

   A knight, rook or queen on the board, two bishops of one side on squares of one colour, or a
   possible en passant capture fails it at once. Sound, not complete: a structure it passes can
   never be opened; one it fails may still be dead.

   Squares: a1 = 0, b1 = 1, ..., h8 = 63. A set of squares (a bitboard) is a bigint kept to 64 bits.

   This is the simple version on bigint; Mateless's own engine (mateless.js, src/lock.js) is the
   fast JavaScript version, on pairs of 32-bit words. */

const ALL = (1n << 64n) - 1n;  // bigints have no size: every set is kept to 64 bits
const FILE_A = 0x0101010101010101n;
const FILE_H = 0x8080808080808080n;
const RANK_1 = 0x00000000000000FFn;
const RANK_8 = 0xFF00000000000000n;
const DARK = 0xAA55AA55AA55AA55n;  // the dark squares; a1 is dark

function north(s: bigint): bigint { return (s << 8n) & ALL; }
function south(s: bigint): bigint { return s >> 8n; }
function sideways(s: bigint): bigint { return ((s << 1n) & ~FILE_A & ALL) | ((s >> 1n) & ~FILE_H); }
function zone(s: bigint): bigint { const v = s | north(s) | south(s); return v | sideways(v); }  // s and every square next to it
function diagonal(s: bigint): bigint { return sideways(north(s) | south(s)); }                 // the squares diagonally next to s
function count(s: bigint): number { let n = 0; for (; s; s &= s - 1n) n++; return n; }
function no(s: bigint): bigint { return ~s & ALL; }  // every square not in s

/** Every square reachable from g by steps north through squares of p. */
function fillNorth(g: bigint, p: bigint): bigint {
  g |= p & north(g);
  p &= north(p);
  g |= p & ((g << 16n) & ALL);
  p &= (p << 16n) & ALL;
  return g | (p & ((g << 32n) & ALL));
}

/** Every square reachable from g by steps south through squares of p. */
function fillSouth(g: bigint, p: bigint): bigint {
  g |= p & south(g);
  p &= south(p);
  g |= p & (g >> 16n);
  p &= p >> 16n;
  return g | (p & (g >> 32n));
}

/** What the lock detector reads from a position. */
export interface Pieces {
  whitePawns: bigint;
  blackPawns: bigint;
  whiteKing: bigint;
  blackKing: bigint;
  whiteBishops: bigint;
  blackBishops: bigint;
  others: bigint;      // knights, rooks and queens of both sides
  enPassant: boolean;  // the side to move can capture en passant
}

/** The pieces of a FEN. The en passant square counts only if a pawn can capture onto it. */
export function fromFen(fen: string): Pieces {
  const fields = fen.split(' ');
  const p: Pieces = { whitePawns: 0n, blackPawns: 0n, whiteKing: 0n, blackKing: 0n,
                      whiteBishops: 0n, blackBishops: 0n, others: 0n, enPassant: false };
  let rank = 7, file = 0;
  for (const c of fields[0]) {
    if (c === '/') { rank--; file = 0; continue; }
    if (c >= '1' && c <= '8') { file += Number(c); continue; }
    const sq = 1n << BigInt(8 * rank + file++);
    switch (c) {
      case 'P': p.whitePawns |= sq; break;
      case 'p': p.blackPawns |= sq; break;
      case 'K': p.whiteKing |= sq; break;
      case 'k': p.blackKing |= sq; break;
      case 'B': p.whiteBishops |= sq; break;
      case 'b': p.blackBishops |= sq; break;
      default: p.others |= sq; break;   // N R Q n r q
    }
  }
  const whiteToMove = fields[1] !== 'b';
  const ep = fields[3] ?? '-';
  if (ep !== '-') {
    const target = 1n << BigInt(ep.charCodeAt(0) - 'a'.charCodeAt(0) + 8 * (Number(ep[1]) - 1));
    p.enPassant = whiteToMove ? (sideways(south(target)) & p.whitePawns) !== 0n
                              : (sideways(north(target)) & p.blackPawns) !== 0n;
  }
  return p;
}

/** Two bishops on squares of one colour (only a promotion makes them). */
function twinBishops(b: bigint): boolean { return count(b & DARK) > 1 || count(b & ~DARK) > 1; }

/** Can White (white = true) or Black never be mated, by the lock detector? */
export function cannotBeMated(p: Pieces, white: boolean): boolean {
  if (p.others || p.enPassant) return false;
  if (twinBishops(p.whiteBishops) || twinBishops(p.blackBishops)) return false;
  if (!leaks(p, white, 0n)) return true;
  // A king may be frozen only if every square around it is held or attacked by a pawn.
  const held = p.whitePawns | p.blackPawns | sideways(north(p.whitePawns) | south(p.blackPawns));
  for (const king of [p.whiteKing, p.blackKing])
    if ((zone(king) & no(king) & no(held)) === 0n && !leaks(p, white, king)) return true;
  return false;
}

/** Does the structure leak to the king asked about, with the king `frozen` frozen (0: none)? */
function leaks(p: Pieces, white: boolean, frozen: bigint): boolean {
  const wp = p.whitePawns, bp = p.blackPawns, wk = p.whiteKing, bk = p.blackKing;
  const frozenWhite = (frozen & wk) !== 0n;
  const frozenBlack = !frozenWhite && frozen !== 0n;
  const nearFrozenBlack = frozenBlack ? zone(bk) : 0n;
  const nearFrozenWhite = frozenWhite ? zone(wk) : 0n;

  // Quick: the pawns' paths against the first walls already show a promotion or a capture.
  let wCone = fillNorth(wp, no((bp & no(wk)) | frozen));
  let bCone = fillSouth(bp, no((wp & no(bk)) | frozen));
  if ((wCone & RANK_8) | (bCone & RANK_1) | (north(sideways(wCone)) & bCone)) return true;

  // The cycle: walls -> pawns that can never move -> king reaches -> capture squares -> walls.
  let wFixed = wp, bFixed = bp;  // pawns that can never move      (shrink)
  let wKing = wk, bKing = bk;    // squares each king may reach    (grow)
  let wTake = wk, bTake = bk;    // squares where a side may take an enemy pawn (grow)
  let wWall = ALL, bWall = ALL;  // pawns the other side can never take, and the frozen king
  for (;;) {
    const lastWWall = wWall, lastBWall = bWall;
    wWall = (wp & no(bTake)) | frozen;
    bWall = (bp & no(wTake)) | frozen;
    const newWFixed = wFixed & wWall & south(bWall | wFixed);
    const newBFixed = bFixed & bWall & north(wWall | bFixed);
    if (wWall === lastWWall && bWall === lastBWall && newWFixed === wFixed && newBFixed === bFixed)
      break;
    // Both kings' reaches, flooded: never onto a fixed pawn, a square it attacks, or next to
    // the frozen king.
    const wMask = no(newWFixed | sideways(south(newBFixed)) | nearFrozenBlack);
    const bMask = no(newBFixed | sideways(north(newWFixed)) | nearFrozenWhite);
    let newWKing = wKing, newBKing = bKing;
    for (;;) {
      const a = newWKing | (zone(newWKing) & wMask);
      const d = newBKing | (zone(newBKing) & bMask);
      if (a === newWKing && d === newBKing) break;
      newWKing = a;
      newBKing = d;
    }
    if ((frozenWhite && newWKing !== wk) || (frozenBlack && newBKing !== bk))
      return true;   // the frozen king can move
    // A side may take a pawn where its king goes, and on any square a pawn may walk into.
    let t = bTake | newBKing;
    const newBTake = t | south(fillSouth(t & no(bWall), no(bWall)));
    t = wTake | newWKing;
    const newWTake = t | north(fillNorth(t & no(wWall), no(wWall)));
    const changed = newWFixed !== wFixed || newBFixed !== bFixed || newWKing !== wKing ||
                    newBKing !== bKing || newWTake !== wTake || newBTake !== bTake;
    wFixed = newWFixed; bFixed = newBFixed; wKing = newWKing; bKing = newBKing;
    wTake = newWTake; bTake = newBTake;
    if (!changed) break;
  }

  // The pawns' cones: every square they may still reach.
  wCone = fillNorth(wp, no(bWall));
  bCone = fillSouth(bp, no(wWall));
  if ((wCone & RANK_8) | (bCone & RANK_1)) return true;   // a pawn can promote
  if (north(sideways(wCone)) & bCone) return true;        // a pawn can capture
  // The bishops' reaches: every square they may reach, around the fixed pawns.
  let wBish = p.whiteBishops, bBish = p.blackBishops;
  const open = no(wFixed | bFixed);
  for (;;) {
    const a = wBish | (diagonal(wBish) & open);
    const d = bBish | (diagonal(bBish) & open);
    if (a === wBish && d === bBish) break;
    wBish = a;
    bBish = d;
  }
  if ((diagonal(wBish) & bCone) | (diagonal(bBish) & wCone)) return true;   // a bishop meets a pawn's path

  // The mating net: can the other side's pawns and bishops catch the king asked about?
  let attack: bigint, reach: bigint, free: bigint, spare: bigint;
  if (white) {
    attack = diagonal(bBish) | sideways(south(bCone));
    reach = wKing;
    free = no(wCone | zone(bKing) | attack);   // never occupied, attacked or next to the mater
    spare = free & no(wBish);                  // ... nor reached by the king's own bishops
  } else {
    attack = diagonal(wBish) | sideways(north(wCone));
    reach = bKing;
    free = no(bCone | zone(wKing) | attack);
    spare = free & no(bBish);
  }
  // A king next to a spare square, or with free squares beside it both ways, always has a flight.
  const flight = sideways(spare) | north(spare) | south(spare) | ((north(free) | south(free)) & sideways(free));
  return (attack & reach & no(flight)) !== 0n;
}
