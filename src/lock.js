/* ═══ Mateless · lock.js — rung 2: the lock detector, and the two static tests together ═════

   Two tests prove, without searching, that the flagged side can never be mated:
     the material test (material.js): the mating side lacks the material to mate at all;
     the lock detector (here): pawns, kings and bishops form a structure that no series of legal
     moves can open. A knight, rook or queen on the board makes it fail at once. It reads the bitboards only: it generates no move and searches nothing.
   They are the first two rungs of a ladder: the material test, the lock detector, then the
   Domino search (domino.js), which asks the same two tests at its nodes. A king that must step
   out of a pawn's check into a lock, or must take the last queen or rook, is left to the search
   (one ply). Most positions fail
   them on a fact or two, so both read the bitboards directly and return at the first fact that
   decides. Only a position that passes the lock detector's quick checks gets the full census
   below, which its fixed point reads.

   From the board it needs the piece sets, the en passant square and a few shifts of a set of
   squares; it generates no move and searches nothing. */

import { BISHOP, BLACK, DARK_SQUARES, diagonalHi, diagonalLo, firstSquare, KING, KING_STEPS,
         KNIGHT, NO_SQUARE, northHi, northLo, PAWN, popcount, QUEEN, RANK_1, RANK_8, ROOK,
         sideways, southHi, southLo, WHITE, zoneHi, zoneLo } from './board.js';
import { materialTest } from './material.js';

/* The census of the lock detector, taken into this typed array (pairs of words, see the C_
   indices), so that its fixed-point loop reads plain int32 values. It is module state, shared by
   every call: the engine is not re-entrant (see the notes on porting in index.js). */
const census = new Int32Array(12);
const C_WHITE_PAWNS = 0, C_BLACK_PAWNS = 2, C_WHITE_KING = 4, C_BLACK_KING = 6,
      C_WHITE_BISHOPS = 8, C_BLACK_BISHOPS = 10;

function takeCensus(pos) {
  const lo = pos.lo, hi = pos.hi, c = census;
  for (let side = 0; side < 2; side++) {
    const color = side ? BLACK : WHITE, at = 2 * side;   // White's entries first, Black's two words later
    c[C_WHITE_PAWNS + at] = lo[color | PAWN];   c[C_WHITE_PAWNS + at + 1] = hi[color | PAWN];
    c[C_WHITE_KING + at] = lo[color | KING];    c[C_WHITE_KING + at + 1] = hi[color | KING];
    c[C_WHITE_BISHOPS + at] = lo[color | BISHOP]; c[C_WHITE_BISHOPS + at + 1] = hi[color | BISHOP];
  }
}

/** Does a side have two bishops on squares of one colour (only a promotion makes that)? */
function twinBishops(lo, hi) {
  if (!(lo | hi)) return false;
  return popcount(lo & DARK_SQUARES) + popcount(hi & DARK_SQUARES) > 1 ||
         popcount(lo & ~DARK_SQUARES) + popcount(hi & ~DARK_SQUARES) > 1;
}

/* ─── The lock detector ────────────────────────────────────────────────────────────────

   It certifies that the flagged side can never be mated, in positions with kings, pawns and
   bishops only. Any knight, rook or queen on the board fails it at once. (Boxed-in knights,
   rooks and queens, whose every square is walled in by fixed pawns, could be allowed too; that
   rule was measured and left out: one practical row in 201,060. Two more rules were measured
   and left to the Domino search: a lock the flagged king enters by stepping out of a pawn's
   check, and a last knight, rook or queen that must be captured. On chasolver's 201,060 Lichess
   rows they prove no row the search does not, and in games played move by move the flags come
   down at the same plies, at the same cost per move within the noise.)

   The certificate is tried up to three times: once with both kings free, then assuming the
   white king, then the black king, frozen on its square (a frozen king is a wall for both
   sides and must turn out not to be able to move). A level is tried only when its frozen king
   has no neighbouring square that some pawn neither holds nor attacks: otherwise it would fail
   its own check anyway.

   Each level grows these sets to a fixed point:
     wCone   squares White's pawns may still reach              grows
     bCone   squares Black's pawns may still reach              grows
     wFixed  white pawns that can never move                    shrinks
     bFixed  black pawns that can never move                    shrinks
     wKing   squares the white king may reach                   grows
     bKing   squares the black king may reach                   grows
     wBish   squares White's bishops may reach                  grows
     bBish   squares Black's bishops may reach                  grows
     bTake   squares where Black may capture a white pawn       grows
     wTake   squares where White may capture a black pawn       grows
   and recomputes two derived sets on every pass:
     wWall   white men that are walls: untakeable white pawns and the frozen king
     bWall   the same for Black
   The plain loop updates all ten sets on every pass (the Rust engine keeps it as
   lock_leaks_reference, and rust/examples/lockcheck.rs compares the two). They do not all
   depend on each other, though. The cycle is walls -> fixed pawns -> king reaches ->
   capture squares -> walls; the cones and the bishops' reaches are read only by the leak tests,
   never by the cycle. So the cycle runs alone, on six sets, flooding each king reach and capture
   set to its end against the walls of the pass, until a pass changes nothing; a pass that finds
   the walls and the fixed pawns as they were stops at once, since the kings and the capture
   squares are then already closed. The cones and the bishops' reaches are computed once, at the
   end, from the final walls and fixed pawns. This changes no verdict: every update is monotone
   (the walls and the fixed pawns only shrink, everything else only grows), so the cycle reaches
   the plain loop's fixed point, and a set flooded step by step against growing masks ends where one
   flood against the last mask ends. Two cheap leaks come first or early: the cones against the
   first (largest) walls are a lower bound of the final cones, so a promotion or a capture they
   show is a leak at once; and a frozen king that moves leaks in whichever pass it does. The
   cones and the capture squares are occluded fills (Kogge-Stone, three shifts each). On Lichess
   locks the cycle runs one full pass and one that stops at once (growing every set by one step
   per pass takes ~11 passes). Pawn-only structures never touch the bishop code.

   At the fixed point the structure leaks, and the level fails, if any of these holds:
     a pawn can promote; a pawn can capture; the frozen king can move; a bishop can reach a
     pawn's path; or the flagged king can reach a square the mater attacks where it has no
     guaranteed flight. */
/* Occluded fills on (lo, hi) pairs, returned through fillLo / fillHi: every square reachable from
   g by steps north (south) through squares of p, in three shifts (8, 16, 32) instead of up to six
   dependent steps. */
let fillLo = 0, fillHi = 0;
function fillNorth(gL, gH, pL, pH) {
  let sH = (gH << 8) | (gL >>> 24);
  gL |= pL & (gL << 8); gH |= pH & sH;
  const qL = pL & (pL << 8), qH = pH & ((pH << 8) | (pL >>> 24));
  sH = (gH << 16) | (gL >>> 16);
  gL |= qL & (gL << 16); gH |= qH & sH;
  gH |= qH & ((qH << 16) | (qL >>> 16)) & gL;          // the 32-step only fills the hi word from lo
  fillLo = gL; fillHi = gH;
}
function fillSouth(gL, gH, pL, pH) {
  let sL = (gL >>> 8) | (gH << 24);
  gH |= pH & (gH >>> 8); gL |= pL & sL;
  const qL = pL & ((pL >>> 8) | (pH << 24)), qH = pH & (pH >>> 8);
  sL = (gL >>> 16) | (gH << 16);
  gH |= qH & (gH >>> 16); gL |= qL & sL;
  gL |= qL & ((qL >>> 16) | (qH << 16)) & gH;          // the 32-step only fills the lo word from hi
  fillLo = gL; fillHi = gH;
}

/** Bits naming the side to be proven unable to be mated (the flagged side), for the functions
    that answer for both sides at once (cannotMate2, Domino.run2, proveBoth): a game's two
    flags, and a dead position, need both answers. */
export const FLAGGED_WHITE = 1, FLAGGED_BLACK = 2;

/* A level is computed in two parts. lockLevelLeaks runs everything that does not depend on which
   side is flagged and reports the leaks that fail the level for either side; when there is none,
   it leaves the sets the mating net reads in these variables (module state, like the census), and
   netLeaks reads them for one side. Both sides at once (lockTest2) compute a level once and its
   net twice. */
let netWConeL = 0, netWConeH = 0, netBConeL = 0, netBConeH = 0, netWKingL = 0, netWKingH = 0,
    netBKingL = 0, netBKingH = 0, netWBishL = 0, netWBishH = 0, netBBishL = 0, netBBishH = 0;
// The fixed pawns of the same level: the net does not read them, lockSets does.
let netWFixedL = 0, netWFixedH = 0, netBFixedL = 0, netBFixedH = 0;

/** Does the structure leak to the flagged king at this level (king frL/frH frozen; 0: none)? */
function lockLeaks(flagged, frL, frH) { return lockLevelLeaks(frL, frH) || netLeaks(flagged); }

/** The same level for both sides: of the sides in `ask` (FLAGGED_* bits), those whose king the
    structure leaks to. */
function lockLeaks2(ask, frL, frH) {
  if (lockLevelLeaks(frL, frH)) return ask;
  return ((ask & FLAGGED_WHITE) && netLeaks(WHITE) ? FLAGGED_WHITE : 0) |
         ((ask & FLAGGED_BLACK) && netLeaks(BLACK) ? FLAGGED_BLACK : 0);
}

/** A level up to the mating net: true when the structure leaks whichever side is flagged. */
function lockLevelLeaks(frL, frH) {
  const c = census;
  const wpL = c[C_WHITE_PAWNS], wpH = c[C_WHITE_PAWNS + 1], bpL = c[C_BLACK_PAWNS], bpH = c[C_BLACK_PAWNS + 1];
  const wkL = c[C_WHITE_KING], wkH = c[C_WHITE_KING + 1], bkL = c[C_BLACK_KING], bkH = c[C_BLACK_KING + 1];

  // Which king, if any, is frozen at this level, and the zone the other king may never enter.
  const frozenWhite = ((frL & wkL) | (frH & wkH)) !== 0;
  const frozenBlack = !frozenWhite && (frL | frH) !== 0;
  const nearFrozenBlackL = frozenBlack ? zoneLo(bkL, bkH) : 0, nearFrozenBlackH = frozenBlack ? zoneHi(bkL, bkH) : 0;
  const nearFrozenWhiteL = frozenWhite ? zoneLo(wkL, wkH) : 0, nearFrozenWhiteH = frozenWhite ? zoneHi(wkL, wkH) : 0;

  // Quick leak: the cones against the first walls (the capture squares are only the kings' squares yet).
  {
    const wwL = (wpL & ~bkL) | frL, wwH = (wpH & ~bkH) | frH, bwL = (bpL & ~wkL) | frL, bwH = (bpH & ~wkH) | frH;
    fillNorth(wpL, wpH, ~bwL, ~bwH); const wcL = fillLo, wcH = fillHi;
    fillSouth(bpL, bpH, ~wwL, ~wwH); const bcL = fillLo, bcH = fillHi;
    if ((wcH & RANK_8) | (bcL & RANK_1)) return true;
    const sL = sideways(wcL), sH = sideways(wcH);
    if ((northLo(sL) & bcL) | (northHi(sL, sH) & bcH)) return true;
  }

  // The cycle: walls -> fixed pawns -> king reaches -> capture squares.
  let wFixedL = wpL, wFixedH = wpH, bFixedL = bpL, bFixedH = bpH;
  let wKingL = wkL, wKingH = wkH, bKingL = bkL, bKingH = bkH;
  let bTakeL = bkL, bTakeH = bkH, wTakeL = wkL, wTakeH = wkH;
  let wWallL = -1, wWallH = -1, bWallL = -1, bWallH = -1;
  for (;;) {
    const pwL = wWallL, pwH = wWallH, pbL = bWallL, pbH = bWallH;
    // wWall = white pawns Black can never take | frozen king; bWall likewise
    wWallL = (wpL & ~bTakeL) | frL; wWallH = (wpH & ~bTakeH) | frH;
    bWallL = (bpL & ~wTakeL) | frL; bWallH = (bpH & ~wTakeH) | frH;
    // wFixed &= wWall & south(bWall | wFixed); bFixed &= bWall & north(wWall | bFixed)
    let tL = bWallL | wFixedL, tH = bWallH | wFixedH;
    const nwFixedL = wFixedL & wWallL & southLo(tL, tH), nwFixedH = wFixedH & wWallH & southHi(tH);
    tL = wWallL | bFixedL; tH = wWallH | bFixedH;
    const nbFixedL = bFixedL & bWallL & northLo(tL), nbFixedH = bFixedH & bWallH & northHi(tL, tH);
    // The same walls and fixed pawns as the pass before: kings and capture squares are closed.
    if (wWallL === pwL && wWallH === pwH && bWallL === pbL && bWallH === pbH &&
        nwFixedL === wFixedL && nwFixedH === wFixedH && nbFixedL === bFixedL && nbFixedH === bFixedH) break;
    // wKing |= zone(wKing) & ~(wFixed | black fixed pawns' captures | zone of a frozen black king)
    const bHitL = sideways(southLo(nbFixedL, nbFixedH)), bHitH = sideways(southHi(nbFixedH));
    const wHitL = sideways(northLo(nwFixedL)), wHitH = sideways(northHi(nwFixedL, nwFixedH));
    const mwL = ~(nwFixedL | bHitL | nearFrozenBlackL), mwH = ~(nwFixedH | bHitH | nearFrozenBlackH);
    const mbL = ~(nbFixedL | wHitL | nearFrozenWhiteL), mbH = ~(nbFixedH | wHitH | nearFrozenWhiteH);
    let nwKingL = wKingL, nwKingH = wKingH, nbKingL = bKingL, nbKingH = bKingH;
    for (;;) {   // both kings at once
      const aL = nwKingL | (zoneLo(nwKingL, nwKingH) & mwL), aH = nwKingH | (zoneHi(nwKingL, nwKingH) & mwH);
      const dL = nbKingL | (zoneLo(nbKingL, nbKingH) & mbL), dH = nbKingH | (zoneHi(nbKingL, nbKingH) & mbH);
      if (aL === nwKingL && aH === nwKingH && dL === nbKingL && dH === nbKingH) break;
      nwKingL = aL; nwKingH = aH; nbKingL = dL; nbKingH = dH;
    }
    // The frozen king can move after all.
    if (frozenWhite && ((nwKingL ^ wkL) | (nwKingH ^ wkH))) return true;
    if (frozenBlack && ((nbKingL ^ bkL) | (nbKingH ^ bkH))) return true;
    // bTake |= bKing | south(bTake & ~bWall); wTake |= wKing | north(wTake & ~wWall)
    tL = bTakeL | nbKingL; tH = bTakeH | nbKingH;
    fillSouth(tL & ~bWallL, tH & ~bWallH, ~bWallL, ~bWallH);
    const nbTakeL = tL | southLo(fillLo, fillHi), nbTakeH = tH | southHi(fillHi);
    tL = wTakeL | nwKingL; tH = wTakeH | nwKingH;
    fillNorth(tL & ~wWallL, tH & ~wWallH, ~wWallL, ~wWallH);
    const nwTakeL = tL | northLo(fillLo), nwTakeH = tH | northHi(fillLo, fillHi);
    const changed =
      (nwFixedL ^ wFixedL) | (nwFixedH ^ wFixedH) | (nbFixedL ^ bFixedL) | (nbFixedH ^ bFixedH) |
      (nwKingL ^ wKingL) | (nwKingH ^ wKingH) | (nbKingL ^ bKingL) | (nbKingH ^ bKingH) |
      (nbTakeL ^ bTakeL) | (nbTakeH ^ bTakeH) | (nwTakeL ^ wTakeL) | (nwTakeH ^ wTakeH);
    wFixedL = nwFixedL; wFixedH = nwFixedH; bFixedL = nbFixedL; bFixedH = nbFixedH;
    wKingL = nwKingL; wKingH = nwKingH; bKingL = nbKingL; bKingH = nbKingH;
    bTakeL = nbTakeL; bTakeH = nbTakeH; wTakeL = nwTakeL; wTakeH = nwTakeH;
    if (!changed) break;
  }

  // The cones, once, against the final walls.
  fillNorth(wpL, wpH, ~bWallL, ~bWallH); const wConeL = fillLo, wConeH = fillHi;
  fillSouth(bpL, bpH, ~wWallL, ~wWallH); const bConeL = fillLo, bConeH = fillHi;
  // A pawn can still promote.
  if ((wConeH & RANK_8) | (bConeL & RANK_1)) return true;
  // A white pawn can capture on a square a black pawn may reach.
  let tL = sideways(wConeL), tH = sideways(wConeH);
  if ((northLo(tL) & bConeL) | (northHi(tL, tH) & bConeH)) return true;
  // The bishops' reaches, once, against the final fixed pawns.
  let wBishL = c[C_WHITE_BISHOPS], wBishH = c[C_WHITE_BISHOPS + 1];
  let bBishL = c[C_BLACK_BISHOPS], bBishH = c[C_BLACK_BISHOPS + 1];
  if (wBishL | wBishH | bBishL | bBishH) {
    const mL = ~(wFixedL | bFixedL), mH = ~(wFixedH | bFixedH);
    for (;;) { const aL = wBishL | (diagonalLo(wBishL, wBishH) & mL), aH = wBishH | (diagonalHi(wBishL, wBishH) & mH);
      const dL = bBishL | (diagonalLo(bBishL, bBishH) & mL), dH = bBishH | (diagonalHi(bBishL, bBishH) & mH);
      if (aL === wBishL && aH === wBishH && dL === bBishL && dH === bBishH) break;
      wBishL = aL; wBishH = aH; bBishL = dL; bBishH = dH; }
    // A bishop is diagonally next to a square an enemy pawn may reach.
    if ((diagonalLo(wBishL, wBishH) & bConeL) | (diagonalHi(wBishL, wBishH) & bConeH)) return true;
    if ((diagonalLo(bBishL, bBishH) & wConeL) | (diagonalHi(bBishL, bBishH) & wConeH)) return true;
  }

  netWConeL = wConeL; netWConeH = wConeH; netBConeL = bConeL; netBConeH = bConeH;
  netWKingL = wKingL; netWKingH = wKingH; netBKingL = bKingL; netBKingH = bKingH;
  netWBishL = wBishL; netWBishH = wBishH; netBBishL = bBishL; netBBishH = bBishH;
  netWFixedL = wFixedL; netWFixedH = wFixedH; netBFixedL = bFixedL; netBFixedH = bFixedH;
  return false;
}

/* The mating net, on the sets lockLevelLeaks left. attack: squares the mater's bishops and pawns
   attack; reach: where the flagged king may go; free: squares that nothing ever occupies or
   attacks and that the mater's king never comes next to; spare: free squares the flagged side's
   own bishops never reach. A king on a square next to a spare square, or with free squares both
   vertically and horizontally next to it, always has a flight. Any attacked square the flagged
   king may reach without such a flight could host a mate. */
function netLeaks(flagged) {
  const wConeL = netWConeL, wConeH = netWConeH, bConeL = netBConeL, bConeH = netBConeH;
  const wKingL = netWKingL, wKingH = netWKingH, bKingL = netBKingL, bKingH = netBKingH;
  const wBishL = netWBishL, wBishH = netWBishH, bBishL = netBBishL, bBishH = netBBishH;
  let attackL, attackH, reachL, reachH, freeL, freeH, spareL, spareH;
  if (flagged === WHITE) {
    attackL = diagonalLo(bBishL, bBishH) | sideways(southLo(bConeL, bConeH));
    attackH = diagonalHi(bBishL, bBishH) | sideways(southHi(bConeH));
    reachL = wKingL; reachH = wKingH;
    freeL = ~(wConeL | zoneLo(bKingL, bKingH) | attackL);
    freeH = ~(wConeH | zoneHi(bKingL, bKingH) | attackH);
    spareL = freeL & ~wBishL; spareH = freeH & ~wBishH;
  } else {
    attackL = diagonalLo(wBishL, wBishH) | sideways(northLo(wConeL));
    attackH = diagonalHi(wBishL, wBishH) | sideways(northHi(wConeL, wConeH));
    reachL = bKingL; reachH = bKingH;
    freeL = ~(bConeL | zoneLo(wKingL, wKingH) | attackL);
    freeH = ~(bConeH | zoneHi(wKingL, wKingH) | attackH);
    spareL = freeL & ~bBishL; spareH = freeH & ~bBishH;
  }
  const flightL = sideways(spareL) | northLo(spareL) | southLo(spareL, spareH) |
                  ((northLo(freeL) | southLo(freeL, freeH)) & sideways(freeL));
  const flightH = sideways(spareH) | northHi(spareL, spareH) | southHi(spareH) |
                  ((northHi(freeL, freeH) | southHi(freeH)) & sideways(freeH));
  return ((attackL & reachL & ~flightL) | (attackH & reachH & ~flightH)) !== 0;
}

/** The lock detector: can `flagged` never be mated, by the structure of pawns, kings and bishops? */
export function lockTest(pos, flagged) {
  const lo = pos.lo, hi = pos.hi;
  // No knight, rook or queen may stand on the board (the usual case in a game: tested first).
  if (lo[WHITE | KNIGHT] | hi[WHITE | KNIGHT] | lo[BLACK | KNIGHT] | hi[BLACK | KNIGHT] |
      lo[WHITE | ROOK] | hi[WHITE | ROOK] | lo[BLACK | ROOK] | hi[BLACK | ROOK] |
      lo[WHITE | QUEEN] | hi[WHITE | QUEEN] | lo[BLACK | QUEEN] | hi[BLACK | QUEEN]) return false;
  if (pos.ep !== NO_SQUARE) return false;
  if (twinBishops(lo[WHITE | BISHOP], hi[WHITE | BISHOP]) || twinBishops(lo[BLACK | BISHOP], hi[BLACK | BISHOP])) return false;
  takeCensus(pos);
  const c = census;
  const wpL = c[C_WHITE_PAWNS], wpH = c[C_WHITE_PAWNS + 1], bpL = c[C_BLACK_PAWNS], bpH = c[C_BLACK_PAWNS + 1];
  if (!lockLeaks(flagged, 0, 0)) return true;
  // Squares held or attacked by some pawn: a frozen king needs all its neighbours among them.
  const pawnL = northLo(wpL) | southLo(bpL, bpH), pawnH = northHi(wpL, wpH) | southHi(bpH);
  const heldL = wpL | bpL | sideways(pawnL), heldH = wpH | bpH | sideways(pawnH);
  for (let kingAt = C_WHITE_KING; kingAt <= C_BLACK_KING; kingAt += 2) {   // White's king frozen, then Black's
    const kL = c[kingAt], kH = c[kingAt + 1], sq = firstSquare(kL, kH);
    if ((KING_STEPS[2 * sq] & ~heldL) | (KING_STEPS[2 * sq + 1] & ~heldH)) continue;
    if (!lockLeaks(flagged, kL, kH)) return true;
  }
  return false;
}

/** The certificate itself, for tests and for showing a lock: null when the lock detector does not
    prove `flagged` unable to be mated, otherwise the sets of the level that proves it, each a
    [lo, hi] pair of words: the pawns' cones (wCone, bCone: every square a pawn may still reach),
    the pawns that can never move (wFixed, bFixed), the kings' reaches (wKing, bKing), the bishops'
    reaches (wBish, bBish), and the frozen king's square (frozen; [0, 0] when both kings are free).
    It computes the levels again, so it costs a few lock tests; the arbiter never calls it. */
export function lockSets(pos, flagged) {
  if (!lockTest(pos, flagged)) return null;
  takeCensus(pos);
  const c = census;
  const wpL = c[C_WHITE_PAWNS], wpH = c[C_WHITE_PAWNS + 1], bpL = c[C_BLACK_PAWNS], bpH = c[C_BLACK_PAWNS + 1];
  const pawnL = northLo(wpL) | southLo(bpL, bpH), pawnH = northHi(wpL, wpH) | southHi(bpH);
  const heldL = wpL | bpL | sideways(pawnL), heldH = wpH | bpH | sideways(pawnH);
  const levels = [[0, 0]];
  for (let kingAt = C_WHITE_KING; kingAt <= C_BLACK_KING; kingAt += 2) {
    const kL = c[kingAt], kH = c[kingAt + 1], sq = firstSquare(kL, kH);
    if (!((KING_STEPS[2 * sq] & ~heldL) | (KING_STEPS[2 * sq + 1] & ~heldH))) levels.push([kL, kH]);
  }
  for (const [frL, frH] of levels) {
    if (lockLeaks(flagged, frL, frH)) continue;
    return {
      wCone: [netWConeL, netWConeH], bCone: [netBConeL, netBConeH],
      wFixed: [netWFixedL, netWFixedH], bFixed: [netBFixedL, netBFixedH],
      wKing: [netWKingL, netWKingH], bKing: [netBKingL, netBKingH],
      wBish: [netWBishL, netWBishH], bBish: [netBBishL, netBBishH],
      frozen: [frL, frH],
    };
  }
  throw new Error('lockSets: the lock test and its levels disagree');
}

/** The flagged side cannot be mated: the lock detector certifies it. */
export function lockCannotMate(pos, flagged) { return lockTest(pos, flagged); }
/** The static tests, the first two rungs of the ladder: either of the two. */
export function cannotMate(pos, flagged) { return materialTest(pos, flagged) || lockTest(pos, flagged); }

/** The lock detector for both sides at once: of the sides in `ask` (FLAGGED_* bits), those it
    proves unable to be mated, the same answers as lockTest with each side flagged. A level is
    computed once for both; a side is proven at the first level that does not leak to it. */
export function lockTest2(pos, ask) {
  const lo = pos.lo, hi = pos.hi;
  if (lo[WHITE | KNIGHT] | hi[WHITE | KNIGHT] | lo[BLACK | KNIGHT] | hi[BLACK | KNIGHT] |
      lo[WHITE | ROOK] | hi[WHITE | ROOK] | lo[BLACK | ROOK] | hi[BLACK | ROOK] |
      lo[WHITE | QUEEN] | hi[WHITE | QUEEN] | lo[BLACK | QUEEN] | hi[BLACK | QUEEN]) return 0;
  if (pos.ep !== NO_SQUARE) return 0;
  if (twinBishops(lo[WHITE | BISHOP], hi[WHITE | BISHOP]) || twinBishops(lo[BLACK | BISHOP], hi[BLACK | BISHOP])) return 0;
  takeCensus(pos);
  const c = census;
  let open = lockLeaks2(ask, 0, 0);            // the asked sides not proven yet
  if (!open) return ask;
  const wpL = c[C_WHITE_PAWNS], wpH = c[C_WHITE_PAWNS + 1], bpL = c[C_BLACK_PAWNS], bpH = c[C_BLACK_PAWNS + 1];
  const pawnL = northLo(wpL) | southLo(bpL, bpH), pawnH = northHi(wpL, wpH) | southHi(bpH);
  const heldL = wpL | bpL | sideways(pawnL), heldH = wpH | bpH | sideways(pawnH);
  for (let kingAt = C_WHITE_KING; kingAt <= C_BLACK_KING; kingAt += 2) {
    const kL = c[kingAt], kH = c[kingAt + 1], sq = firstSquare(kL, kH);
    if ((KING_STEPS[2 * sq] & ~heldL) | (KING_STEPS[2 * sq + 1] & ~heldH)) continue;
    open = lockLeaks2(open, kL, kH);
    if (!open) return ask;
  }
  return ask & ~open;
}

/** The static tests for both sides at once: of the sides in `ask` (FLAGGED_* bits), those the
    material test or the lock detector proves unable to be mated (cannotMate with each side flagged). */
export function cannotMate2(pos, ask) { return staticTests2(pos, ask, TESTS_BOTH); }

/* ─── When the static tests can change ─────────────────────────────────────────────────

   The material test reads the pieces only, so only a capture or a promotion changes its answer.
   The lock detector reads the pawns, the kings' and bishops' squares and the en passant square:
   a capture or a pawn move changes the structure; a move after a double step can let the en
   passant right lapse (the detector fails while it stands); and a king in a pawn's check stands on
   a square its reach would leave out, so its step out of the check can complete a lock. Any other
   king or bishop move stays inside its reach and leaves the fixed point as it was, and a knight,
   rook or queen on the board fails the detector whatever it does.

   (A check by a bishop changes nothing: the kings' reaches do not look at bishops. A check by a
   knight, rook or queen neither: the detector fails while one stands.)

   So the search asks after a move only the tests it can have changed (testsAfter). That proves
   the same positions with the same node counts as asking both after every capture or pawn move
   and one ply later (the clock rule, halfmove <= 1, which needs no memory of the move before: a pawn's check comes only from the move just played, so the ply after covers the
   step out of it). A test not asked can only cost a proof, never make a false one. */
export const TEST_MATERIAL = 1, TEST_LOCK = 2, TESTS_BOTH = 3;

/** The static tests whose answer a move can change: a capture, a promotion, a pawn's move, a move
    made while an en passant square stood (epBefore) or while in a pawn's check (pawnCheck). */
export function testsAfter(capture, promotion, pawn, epBefore, pawnCheck) {
  return (capture || promotion ? TEST_MATERIAL : 0) | (capture || pawn || epBefore || pawnCheck ? TEST_LOCK : 0);
}

/** Is the side to move in check by a pawn? */
export function pawnCheck(pos) {
  const lo = pos.lo, hi = pos.hi;
  if (pos.side === WHITE) {
    const kL = lo[WHITE | KING], kH = hi[WHITE | KING];   // black pawns attack it from the diagonals ahead
    return ((sideways(northLo(kL)) & lo[BLACK | PAWN]) | (sideways(northHi(kL, kH)) & hi[BLACK | PAWN])) !== 0;
  }
  const kL = lo[BLACK | KING], kH = hi[BLACK | KING];
  return ((sideways(southLo(kL, kH)) & lo[WHITE | PAWN]) | (sideways(southHi(kH)) & hi[WHITE | PAWN])) !== 0;
}

/** The static tests in `tests` (TEST_* bits) for `flagged`. */
export function staticTests(pos, flagged, tests) {
  return ((tests & TEST_MATERIAL) !== 0 && materialTest(pos, flagged)) || ((tests & TEST_LOCK) !== 0 && lockTest(pos, flagged));
}

/** The static tests in `tests` for the sides in `ask`: the sides proven. */
export function staticTests2(pos, ask, tests) {
  let proven = 0;
  if (tests & TEST_MATERIAL) {
    if ((ask & FLAGGED_WHITE) && materialTest(pos, WHITE)) proven |= FLAGGED_WHITE;
    if ((ask & FLAGGED_BLACK) && materialTest(pos, BLACK)) proven |= FLAGGED_BLACK;
  }
  const rest = ask & ~proven;
  return rest && (tests & TEST_LOCK) ? proven | lockTest2(pos, rest) : proven;
}
