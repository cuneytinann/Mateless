/* ═══ Mateless · lock.js — rung 2: the lock detector, and the two static tests together ═════

   Two tests prove, without searching, that the flagged side can never be mated:
     the material test (material.js): the mating side lacks the material to mate at all;
     the lock detector (here): pawns, kings and bishops form a structure that no series of legal
     moves can open. It reads the bitboards only: it generates no move and searches nothing.

   The detector comes in two versions in this file. The first is the lock detector proper, the one
   proposed to Lichess (Lock.scala) and kept alone in 20 languages in lock/: a knight, rook or queen
   on the board fails it at once (coreLockTest below runs it alone). The second version adds two
   rules, each entered only when its own situation is on the board, so that every other position
   runs the first version's code: open pawn pairs (when the pawns hold one) and boxed knights,
   rooks and queens (when one stands). It is not complete either; it sees more.
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
         NOT_FILE_A, NOT_FILE_H, sideways, sideways2, southHi, southLo, WHITE, zoneHi, zoneLo } from './board.js';
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
/** takeCensus, and do the pawns hold an open pair (non-zero: yes)? */
function takeCensusPairs(pos) {
  takeCensus(pos);
  const lo = pos.lo, hi = pos.hi;
  const wpL = lo[WHITE | PAWN], wpH = hi[WHITE | PAWN], bpL = lo[BLACK | PAWN], bpH = hi[BLACK | PAWN];
  return (northLo(wpL) & southLo(bpL, bpH) & ~(wpL | bpL)) | (northHi(wpL, wpH) & southHi(bpH) & ~(wpH | bpH));
}

/** Does a side have two bishops on squares of one colour (only a promotion makes that)? */
function twinBishops(lo, hi) {
  if (!(lo | hi)) return false;
  return popcount(lo & DARK_SQUARES) + popcount(hi & DARK_SQUARES) > 1 ||
         popcount(lo & ~DARK_SQUARES) + popcount(hi & ~DARK_SQUARES) > 1;
}

/* ─── The lock detector ────────────────────────────────────────────────────────────────

   It certifies that the flagged side can never be mated, in positions with kings, pawns and
   bishops only. In the first version any knight, rook or queen on the board fails it at once;
   the second version lets boxed-in ones stay (see "Boxed knights, rooks and queens" below). Two
   more rules were measured and left to the Domino search: a lock the flagged king enters by
   stepping out of a pawn's check, and a last knight, rook or queen that must be captured. On
   chasolver's 201,060 Lichess rows they prove no row the search does not, and in games played
   move by move the flags come down at the same plies, at the same cost per move within the noise.

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
function lockLeaks(flagged, frL, frH) { return lockLevelLeaks(frL, frH) || netLeaks(flagged, 0, 0); }

/** The same level for both sides: of the sides in `ask` (FLAGGED_* bits), those whose king the
    structure leaks to. */
function lockLeaks2(ask, frL, frH) {
  if (lockLevelLeaks(frL, frH)) return ask;
  return ((ask & FLAGGED_WHITE) && netLeaks(WHITE, 0, 0) ? FLAGGED_WHITE : 0) |
         ((ask & FLAGGED_BLACK) && netLeaks(BLACK, 0, 0) ? FLAGGED_BLACK : 0);
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
   king may reach without such a flight could host a mate. occL/occH: squares that stand occupied
   for good besides (the boxed pieces' squares, see below; 0 in every other level). */
function netLeaks(flagged, occL, occH) {
  const wConeL = netWConeL, wConeH = netWConeH, bConeL = netBConeL, bConeH = netBConeH;
  const wKingL = netWKingL, wKingH = netWKingH, bKingL = netBKingL, bKingH = netBKingH;
  const wBishL = netWBishL, wBishH = netWBishH, bBishL = netBBishL, bBishH = netBBishH;
  let attackL, attackH, reachL, reachH, freeL, freeH, spareL, spareH;
  if (flagged === WHITE) {
    attackL = diagonalLo(bBishL, bBishH) | sideways(southLo(bConeL, bConeH));
    attackH = diagonalHi(bBishL, bBishH) | sideways(southHi(bConeH));
    reachL = wKingL; reachH = wKingH;
    freeL = ~(wConeL | occL | zoneLo(bKingL, bKingH) | attackL);
    freeH = ~(wConeH | occH | zoneHi(bKingL, bKingH) | attackH);
    spareL = freeL & ~wBishL; spareH = freeH & ~wBishH;
  } else {
    attackL = diagonalLo(wBishL, wBishH) | sideways(northLo(wConeL));
    attackH = diagonalHi(wBishL, wBishH) | sideways(northHi(wConeL, wConeH));
    reachL = bKingL; reachH = bKingH;
    freeL = ~(bConeL | occL | zoneLo(wKingL, wKingH) | attackL);
    freeH = ~(bConeH | occH | zoneHi(wKingL, wKingH) | attackH);
    spareL = freeL & ~bBishL; spareH = freeH & ~bBishH;
  }
  const flightL = sideways(spareL) | northLo(spareL) | southLo(spareL, spareH) |
                  ((northLo(freeL) | southLo(freeL, freeH)) & sideways(freeL));
  const flightH = sideways(spareH) | northHi(spareL, spareH) | southHi(spareH) |
                  ((northHi(freeL, freeH) | southHi(freeH)) & sideways(freeH));
  return ((attackL & reachL & ~flightL) | (attackH & reachH & ~flightH)) !== 0;
}

/* ─── Open pawn pairs (the second version) ─────────────────────────────────────────────

   An open pair: a white pawn and a black pawn on one file with one square between them, the gap,
   that holds no pawn. The levels above let the white king step onto its own pawn's square (the
   pawn may move) and on into the gap, where it would stand next to the black pawn; so the black
   pawn counts as one White may take, it is no wall, and the white pawn's cone runs to the
   promotion rank. That cannot happen: the white pawn can only ever leave its square for the gap,
   and then the gap is taken. The king may enter the pawn's square or the gap, never pass through
   both. Only when one of the pawns moves is the file shut.

   So the reachable positions are split by what the pair's pawns have done, three families:
     A  neither pawn has moved: both are held in place, the gap is a wall for both sides' pawns
        (as a frozen king is), not for the kings, which may step into it from beside;
     B  the white pawn has moved into the gap: an ordinary ram;
     C  the black pawn has moved into the gap.
   A pawn of the pair can only move into the gap, and once one has, the other is blocked for good,
   so a position is in A, or got to B or C from a position of A by that pawn's step. The pair's
   pawns must be walls in A (no one can ever take them there; for a held pawn, being a wall is
   being fixed): a pawn taken in A would let the other one through. B's and C's kings, bishops and
   capture squares start from A's final reaches and capture squares (minus the gap, which the step
   fills), not from their squares: every king square of A is a square the king may stand on when the
   pawn moves. The rest of each level is unchanged. If no family leaks to the flagged king, every
   reachable position is covered by a family whose certificate rules the mate out.

   With k open pairs the families are the 3^k combinations, each started from the families one
   step before it (one pair's pawns back in place); up to MAX_GAP_PAIRS pairs.

   When it runs: the census also tells whether the pawns hold an open pair (two shifts, three ANDs;
   without one the levels run exactly as before). With one, the levels above almost never prove a
   lock, so at each level (free, then a frozen king's) the families come first and the level itself
   after them, for the sides they did not prove; and not for the sides family A leaked to: A is
   the level with more walls (the gaps), every set it grows is a subset of the level's (cones,
   reaches, capture squares; its walls and fixed pawns a superset), and every leak test grows with
   those sets, so a leak A finds the level finds too. The verdicts are those of trying every level
   and then the families; only the work differs.

   In practice: of chasolver's 201,060 Lichess rows it proves 3 that nothing else proves (GyWj6Ymz,
   azjorRHB, lBSDAx07), and in August and September 2026 it sees the death of 5 drawn games at the
   ply it happens instead of a few plies later (one of them, 19dcoW9q, never before). Checked on
   130,858 locks it adds: every reachable position enumerated (393.5 million), no mate, no
   violation of a family's certificate; chasolver's full analysis agrees. Not covered: a pair with
   two empty squares between its pawns, a gap that a capture can enter, more than 3 pairs. */
export const MAX_GAP_PAIRS = 3;
const POW3 = [1, 3, 9, 27];
// A family's input, pairs of words: the pawns, the walls for both sides (the gaps of the pairs that
// stay), and where the kings' reaches, the capture squares and the bishops' reaches start.
const GS = new Int32Array(18);
const G_WP = 0, G_BP = 2, G_V = 4, G_WK = 6, G_BK = 8, G_WT = 10, G_BT = 12, G_WB = 14, G_BB = 16;
// A family's output, pairs of words: the final king reaches, capture squares, bishop reaches and
// fixed pawns (the cones and reaches the net reads go to the net variables, as for a level above).
const GO = new Int32Array(16);
const O_WK = 0, O_BK = 2, O_WT = 4, O_BT = 6, O_WB = 8, O_BB = 10, O_WF = 12, O_BF = 14;
// Each family's kings, capture squares and bishops (12 words), for the families after it.
const RES = new Int32Array(27 * 12);
// The open pairs: per pair the gap's bit, the white pawn's bit, the black pawn's bit (pairs of words).
const PAIR = new Int32Array(MAX_GAP_PAIRS * 6);
// lockSets: when set, every family that does not leak is recorded here.
let gapRecord = null;
// The sides the last gapLevel's family A leaked to. A is the level above with more walls (the
// gaps), so every set it grows is a subset of the level's and every leak it finds the level finds
// too: for these sides the level itself need not be tried.
let gapRefuted = 0;

/** One level of the lock detector on the family in GS (king frL/frH frozen; 0: none): the same
    cycle as lockLevelLeaks, from GS's pawns, walls and starting sets. */
function gapLevelLeaks(frL, frH) {
  const c = census, g = GS;
  const wpL = g[G_WP], wpH = g[G_WP + 1], bpL = g[G_BP], bpH = g[G_BP + 1];
  const wkL = c[C_WHITE_KING], wkH = c[C_WHITE_KING + 1], bkL = c[C_BLACK_KING], bkH = c[C_BLACK_KING + 1];
  const vL = g[G_V] | frL, vH = g[G_V + 1] | frH;      // walls for both sides: the gaps that stay, a frozen king
  const frozenWhite = ((frL & wkL) | (frH & wkH)) !== 0;
  const frozenBlack = !frozenWhite && (frL | frH) !== 0;
  const nearFrozenBlackL = frozenBlack ? zoneLo(bkL, bkH) : 0, nearFrozenBlackH = frozenBlack ? zoneHi(bkL, bkH) : 0;
  const nearFrozenWhiteL = frozenWhite ? zoneLo(wkL, wkH) : 0, nearFrozenWhiteH = frozenWhite ? zoneHi(wkL, wkH) : 0;
  let bTakeL = g[G_BT], bTakeH = g[G_BT + 1], wTakeL = g[G_WT], wTakeH = g[G_WT + 1];

  // Quick leak: the cones against the first walls.
  {
    const wwL = (wpL & ~bTakeL) | vL, wwH = (wpH & ~bTakeH) | vH, bwL = (bpL & ~wTakeL) | vL, bwH = (bpH & ~wTakeH) | vH;
    fillNorth(wpL, wpH, ~bwL, ~bwH); const wcL = fillLo, wcH = fillHi;
    fillSouth(bpL, bpH, ~wwL, ~wwH); const bcL = fillLo, bcH = fillHi;
    if ((wcH & RANK_8) | (bcL & RANK_1)) return true;
    const sL = sideways(wcL), sH = sideways(wcH);
    if ((northLo(sL) & bcL) | (northHi(sL, sH) & bcH)) return true;
  }

  // The cycle: walls -> fixed pawns -> king reaches -> capture squares.
  let wFixedL = wpL, wFixedH = wpH, bFixedL = bpL, bFixedH = bpH;
  let wKingL = g[G_WK], wKingH = g[G_WK + 1], bKingL = g[G_BK], bKingH = g[G_BK + 1];
  let wWallL = -1, wWallH = -1, bWallL = -1, bWallH = -1;
  for (;;) {
    const pwL = wWallL, pwH = wWallH, pbL = bWallL, pbH = bWallH;
    wWallL = (wpL & ~bTakeL) | vL; wWallH = (wpH & ~bTakeH) | vH;
    bWallL = (bpL & ~wTakeL) | vL; bWallH = (bpH & ~wTakeH) | vH;
    let tL = bWallL | wFixedL, tH = bWallH | wFixedH;
    const nwFixedL = wFixedL & wWallL & southLo(tL, tH), nwFixedH = wFixedH & wWallH & southHi(tH);
    tL = wWallL | bFixedL; tH = wWallH | bFixedH;
    const nbFixedL = bFixedL & bWallL & northLo(tL), nbFixedH = bFixedH & bWallH & northHi(tL, tH);
    if (wWallL === pwL && wWallH === pwH && bWallL === pbL && bWallH === pbH &&
        nwFixedL === wFixedL && nwFixedH === wFixedH && nbFixedL === bFixedL && nbFixedH === bFixedH) break;
    const bHitL = sideways(southLo(nbFixedL, nbFixedH)), bHitH = sideways(southHi(nbFixedH));
    const wHitL = sideways(northLo(nwFixedL)), wHitH = sideways(northHi(nwFixedL, nwFixedH));
    const mwL = ~(nwFixedL | bHitL | nearFrozenBlackL), mwH = ~(nwFixedH | bHitH | nearFrozenBlackH);
    const mbL = ~(nbFixedL | wHitL | nearFrozenWhiteL), mbH = ~(nbFixedH | wHitH | nearFrozenWhiteH);
    let nwKingL = wKingL, nwKingH = wKingH, nbKingL = bKingL, nbKingH = bKingH;
    for (;;) {
      const aL = nwKingL | (zoneLo(nwKingL, nwKingH) & mwL), aH = nwKingH | (zoneHi(nwKingL, nwKingH) & mwH);
      const dL = nbKingL | (zoneLo(nbKingL, nbKingH) & mbL), dH = nbKingH | (zoneHi(nbKingL, nbKingH) & mbH);
      if (aL === nwKingL && aH === nwKingH && dL === nbKingL && dH === nbKingH) break;
      nwKingL = aL; nwKingH = aH; nbKingL = dL; nbKingH = dH;
    }
    if (frozenWhite && ((nwKingL ^ wkL) | (nwKingH ^ wkH))) return true;
    if (frozenBlack && ((nbKingL ^ bkL) | (nbKingH ^ bkH))) return true;
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

  fillNorth(wpL, wpH, ~bWallL, ~bWallH); const wConeL = fillLo, wConeH = fillHi;
  fillSouth(bpL, bpH, ~wWallL, ~wWallH); const bConeL = fillLo, bConeH = fillHi;
  if ((wConeH & RANK_8) | (bConeL & RANK_1)) return true;
  let tL = sideways(wConeL), tH = sideways(wConeH);
  if ((northLo(tL) & bConeL) | (northHi(tL, tH) & bConeH)) return true;
  let wBishL = g[G_WB], wBishH = g[G_WB + 1], bBishL = g[G_BB], bBishH = g[G_BB + 1];
  if (wBishL | wBishH | bBishL | bBishH) {
    const mL = ~(wFixedL | bFixedL), mH = ~(wFixedH | bFixedH);
    for (;;) { const aL = wBishL | (diagonalLo(wBishL, wBishH) & mL), aH = wBishH | (diagonalHi(wBishL, wBishH) & mH);
      const dL = bBishL | (diagonalLo(bBishL, bBishH) & mL), dH = bBishH | (diagonalHi(bBishL, bBishH) & mH);
      if (aL === wBishL && aH === wBishH && dL === bBishL && dH === bBishH) break;
      wBishL = aL; wBishH = aH; bBishL = dL; bBishH = dH; }
    if ((diagonalLo(wBishL, wBishH) & bConeL) | (diagonalHi(wBishL, wBishH) & bConeH)) return true;
    if ((diagonalLo(bBishL, bBishH) & wConeL) | (diagonalHi(bBishL, bBishH) & wConeH)) return true;
  }

  netWConeL = wConeL; netWConeH = wConeH; netBConeL = bConeL; netBConeH = bConeH;
  netWKingL = wKingL; netWKingH = wKingH; netBKingL = bKingL; netBKingH = bKingH;
  netWBishL = wBishL; netWBishH = wBishH; netBBishL = bBishL; netBBishH = bBishH;
  netWFixedL = wFixedL; netWFixedH = wFixedH; netBFixedL = bFixedL; netBFixedH = bFixedH;
  const o = GO;
  o[O_WK] = wKingL; o[O_WK + 1] = wKingH; o[O_BK] = bKingL; o[O_BK + 1] = bKingH;
  o[O_WT] = wTakeL; o[O_WT + 1] = wTakeH; o[O_BT] = bTakeL; o[O_BT + 1] = bTakeH;
  o[O_WB] = wBishL; o[O_WB + 1] = wBishH; o[O_BB] = bBishL; o[O_BB + 1] = bBishH;
  o[O_WF] = wFixedL; o[O_WF + 1] = wFixedH; o[O_BF] = bFixedL; o[O_BF + 1] = bFixedH;
  return false;
}

/** The open pairs of the census's pawns into PAIR: their number, MAX_GAP_PAIRS + 1 when more. */
function gapPairs() {
  const c = census;
  const wpL = c[C_WHITE_PAWNS], wpH = c[C_WHITE_PAWNS + 1], bpL = c[C_BLACK_PAWNS], bpH = c[C_BLACK_PAWNS + 1];
  let gL = northLo(wpL) & southLo(bpL, bpH) & ~(wpL | bpL), gH = northHi(wpL, wpH) & southHi(bpH) & ~(wpH | bpH);
  let k = 0;
  while (gL | gH) {
    if (k === MAX_GAP_PAIRS) return k + 1;
    let bL = 0, bH = 0;
    if (gL) { bL = gL & -gL; gL ^= bL; } else { bH = gH & -gH; gH ^= bH; }
    const p = 6 * k++;
    PAIR[p] = bL; PAIR[p + 1] = bH;                                  // the gap
    PAIR[p + 2] = southLo(bL, bH); PAIR[p + 3] = southHi(bH);        // the white pawn, below it
    PAIR[p + 4] = northLo(bL); PAIR[p + 5] = northHi(bL, bH);        // the black pawn, above it
  }
  return k;
}

/** The families of k open pairs at one level (king frL/frH frozen; 0: none): of the sides in
    `ask`, those that no family leaks to (0 as soon as a family leaks to all of them). */
function gapLevel(ask, k, frL, frH) {
  const c = census, g = GS, n = POW3[k];
  gapRefuted = 0;
  for (let f = 0; f < n; f++) {
    let wpL = c[C_WHITE_PAWNS], wpH = c[C_WHITE_PAWNS + 1], bpL = c[C_BLACK_PAWNS], bpH = c[C_BLACK_PAWNS + 1];
    let vL = 0, vH = 0;
    if (f === 0) {               // A: the kings, capture squares and bishops start where they stand
      g[G_WK] = g[G_WT] = c[C_WHITE_KING]; g[G_WK + 1] = g[G_WT + 1] = c[C_WHITE_KING + 1];
      g[G_BK] = g[G_BT] = c[C_BLACK_KING]; g[G_BK + 1] = g[G_BT + 1] = c[C_BLACK_KING + 1];
      g[G_WB] = c[C_WHITE_BISHOPS]; g[G_WB + 1] = c[C_WHITE_BISHOPS + 1];
      g[G_BB] = c[C_BLACK_BISHOPS]; g[G_BB + 1] = c[C_BLACK_BISHOPS + 1];
    } else {
      for (let i = G_WK; i < 18; i++) g[i] = 0;
    }
    for (let i = 0, q = f; i < k; i++, q = (q / 3) | 0) {
      const d = q % 3, p = 6 * i, gL = PAIR[p], gH = PAIR[p + 1];
      if (d === 0) { vL |= gL; vH |= gH; continue; }
      if (d === 1) { wpL = (wpL & ~PAIR[p + 2]) | gL; wpH = (wpH & ~PAIR[p + 3]) | gH; }
      else { bpL = (bpL & ~PAIR[p + 4]) | gL; bpH = (bpH & ~PAIR[p + 5]) | gH; }
      // Start from the family this one is reached from: the same with this pair's pawns in place.
      const r = 12 * (f - d * POW3[i]);
      g[G_WK] |= RES[r] & ~gL; g[G_WK + 1] |= RES[r + 1] & ~gH; g[G_BK] |= RES[r + 2] & ~gL; g[G_BK + 1] |= RES[r + 3] & ~gH;
      g[G_WT] |= RES[r + 4]; g[G_WT + 1] |= RES[r + 5]; g[G_BT] |= RES[r + 6]; g[G_BT + 1] |= RES[r + 7];
      g[G_WB] |= RES[r + 8] & ~gL; g[G_WB + 1] |= RES[r + 9] & ~gH; g[G_BB] |= RES[r + 10] & ~gL; g[G_BB + 1] |= RES[r + 11] & ~gH;
    }
    g[G_WP] = wpL; g[G_WP + 1] = wpH; g[G_BP] = bpL; g[G_BP + 1] = bpH; g[G_V] = vL; g[G_V + 1] = vH;
    if (gapLevelLeaks(frL, frH)) { if (f === 0) gapRefuted = ask; return 0; }
    // The pairs that stay: both pawns must be walls (held, they are fixed exactly when they are walls).
    for (let i = 0, q = f; i < k; i++, q = (q / 3) | 0) {
      if (q % 3) continue;
      const p = 6 * i;
      if ((PAIR[p + 2] & ~GO[O_WF]) | (PAIR[p + 3] & ~GO[O_WF + 1]) | (PAIR[p + 4] & ~GO[O_BF]) | (PAIR[p + 5] & ~GO[O_BF + 1])) return 0;
    }
    if ((ask & FLAGGED_WHITE) && netLeaks(WHITE, 0, 0)) { ask &= ~FLAGGED_WHITE; if (f === 0) gapRefuted |= FLAGGED_WHITE; }
    if ((ask & FLAGGED_BLACK) && netLeaks(BLACK, 0, 0)) { ask &= ~FLAGGED_BLACK; if (f === 0) gapRefuted |= FLAGGED_BLACK; }
    if (!ask) return 0;
    const r = 12 * f;
    for (let i = 0; i < 12; i++) RES[r + i] = GO[i];
    if (gapRecord) {
      const pairs = []; for (let i = 0, q = f; i < k; i++, q = (q / 3) | 0) pairs.push('ABC'[q % 3]);
      gapRecord.push({
        wCone: [netWConeL, netWConeH], bCone: [netBConeL, netBConeH],
        wFixed: [netWFixedL, netWFixedH], bFixed: [netBFixedL, netBFixedH],
        wKing: [netWKingL, netWKingH], bKing: [netBKingL, netBKingH],
        wBish: [netWBishL, netWBishH], bBish: [netBBishL, netBBishH],
        frozen: [frL, frH], pairs: pairs.join(''),
      });
    }
  }
  return ask;
}

/* ─── Boxed knights, rooks and queens (the second version) ────────────────────────────────

   A knight, rook or queen is boxed in when every square it could step to holds one of its own men
   that never moves: a fixed pawn, or another boxed piece. It never moves, and it attacks only the
   squares its own men hold for good, so it never gives check and takes no part in a mate: it only
   stands in the way. The levels above fail at once with a knight, rook or queen on the board; this
   rule lets boxed ones stay. In practice they are rare: one row of chasolver's 201,060 Lichess rows
   (hPiwD75i, a knight boxed in on b8). The rule is the golfed engine's (the source of the lock
   detector), kept in the development history and brought back as it was.

   When it runs: only with a knight, rook or queen on the board, and only past a quick check that
   every one of them is boxed in by its own pawns and pieces (step squares against the side's
   pawns, knights, rooks and queens): first the squares beside each rook and queen, east and west,
   then all of them (rooks' and queens' orthogonal neighbours, queens' diagonal ones, knights'
   squares). In a game a rook or queen almost always has a square beside it that is empty or holds
   another man, and that ends it at a few operations; the levels above are not touched.

   A level is the plain loop (every set updated on every pass, as rust/src/lock.rs keeps it in
   lock_leaks_reference), with these additions:
     boxed   the pieces that no enemy king or bishop can ever reach: they never move nor fall.
             It depends on the bishops' reaches, so here the bishops are in the cycle.
     walls   boxed pieces are walls for the pawns of both sides (a pawn they block is fixed, and
             the capture squares stop at them).
     leaks   a pawn can capture on a boxed piece's square; a piece has a step square not held by a
             fixed pawn or a boxed piece of its colour.
     the net no flight onto any knight, rook or queen's square.
   A piece whose step squares are all held but that an enemy king or bishop may reach is no wall: it
   may be taken (by the king or bishop that reaches it), and until then it stands still.

   Where the trigger stands (testsAfter): a knight, rook or queen that has just moved quietly has an
   empty step square, the square it came from or one it slid over (a rook castling stands next to
   its king), so the quick check fails after any such move: only a capture or a pawn move (a
   promotion included) can complete a boxed lock, and those already ask the lock detector. */
const BOX = new Int32Array(8);
const X_WHITE = 0, X_BLACK = 2, X_WHITE_STEPS = 4, X_BLACK_STEPS = 6;
// The boxed pieces of the last level that did not leak, and (lockSets) where the level that proves
// a side records its certificate.
let netBoxedL = 0, netBoxedH = 0, boxedRecord = null;
let stepLo = 0, stepHi = 0;

/** Is every knight, rook and queen of one side boxed in by its own pawns and pieces (ownL/ownH)?
    Their step squares go to stepLo/stepHi. */
function boxedIn(nL, nH, rL, rH, qL, qH, ownL, ownH) {
  let sL = 0, sH = 0;
  const oL = rL | qL, oH = rH | qH;
  if (oL | oH) {                    // rooks' and queens' orthogonal neighbours
    sL = sideways(oL) | northLo(oL) | southLo(oL, oH); sH = sideways(oH) | northHi(oL, oH) | southHi(oH);
    if ((sL & ~ownL) | (sH & ~ownH)) return false;
    if (qL | qH) {                  // queens' diagonal neighbours
      const dL = diagonalLo(qL, qH), dH = diagonalHi(qL, qH);
      if ((dL & ~ownL) | (dH & ~ownH)) return false;
      sL |= dL; sH |= dH;
    }
  }
  if (nL | nH) {                    // knights' squares
    const one = sideways(nL), oneH = sideways(nH), two = sideways2(nL), twoH = sideways2(nH);
    const kL = (one << 16) | ((one >>> 16) | (oneH << 16)) | (two << 8) | ((two >>> 8) | (twoH << 24));
    const kH = ((oneH << 16) | (one >>> 16)) | (oneH >>> 16) | ((twoH << 8) | (two >>> 24)) | (twoH >>> 8);
    if ((kL & ~ownL) | (kH & ~ownH)) return false;
    sL |= kL; sH |= kH;
  }
  stepLo = sL; stepHi = sH;
  return true;
}

/** One level with boxed pieces (king frL/frH frozen; 0: none), up to the mating net: true when the
    structure leaks whichever side is flagged; otherwise the net's sets are left as by the levels above. */
function boxedLevelLeaks(frL, frH) {
  const c = census, x = BOX;
  const wpL = c[C_WHITE_PAWNS], wpH = c[C_WHITE_PAWNS + 1], bpL = c[C_BLACK_PAWNS], bpH = c[C_BLACK_PAWNS + 1];
  const wkL = c[C_WHITE_KING], wkH = c[C_WHITE_KING + 1], bkL = c[C_BLACK_KING], bkH = c[C_BLACK_KING + 1];
  const wxL = x[X_WHITE], wxH = x[X_WHITE + 1], bxL = x[X_BLACK], bxH = x[X_BLACK + 1];
  const frozenWhite = ((frL & wkL) | (frH & wkH)) !== 0;
  const frozenBlack = !frozenWhite && (frL | frH) !== 0;
  const nearFrozenBlackL = frozenBlack ? zoneLo(bkL, bkH) : 0, nearFrozenBlackH = frozenBlack ? zoneHi(bkL, bkH) : 0;
  const nearFrozenWhiteL = frozenWhite ? zoneLo(wkL, wkH) : 0, nearFrozenWhiteH = frozenWhite ? zoneHi(wkL, wkH) : 0;

  let wConeL = wpL, wConeH = wpH, bConeL = bpL, bConeH = bpH;
  let wFixedL = wpL, wFixedH = wpH, bFixedL = bpL, bFixedH = bpH;
  let wKingL = wkL, wKingH = wkH, bKingL = bkL, bKingH = bkH;
  let wBishL = c[C_WHITE_BISHOPS], wBishH = c[C_WHITE_BISHOPS + 1];
  let bBishL = c[C_BLACK_BISHOPS], bBishH = c[C_BLACK_BISHOPS + 1];
  let bTakeL = bkL, bTakeH = bkH, wTakeL = wkL, wTakeH = wkH;
  let boxedL = 0, boxedH = 0;
  for (;;) {
    // boxed = white pieces out of Black's king and bishop reach | black pieces out of White's
    boxedL = (wxL & ~(bKingL | bBishL)) | (bxL & ~(wKingL | wBishL));
    boxedH = (wxH & ~(bKingH | bBishH)) | (bxH & ~(wKingH | wBishH));
    const wWallL = (wpL & ~bTakeL) | frL | boxedL, wWallH = (wpH & ~bTakeH) | frH | boxedH;
    const bWallL = (bpL & ~wTakeL) | frL | boxedL, bWallH = (bpH & ~wTakeH) | frH | boxedH;
    let tL = bWallL | wFixedL, tH = bWallH | wFixedH;
    const nwFixedL = wFixedL & wWallL & southLo(tL, tH), nwFixedH = wFixedH & wWallH & southHi(tH);
    tL = wWallL | bFixedL; tH = wWallH | bFixedH;
    const nbFixedL = bFixedL & bWallL & northLo(tL), nbFixedH = bFixedH & bWallH & northHi(tL, tH);
    fillNorth(wConeL, wConeH, ~bWallL, ~bWallH); const nwConeL = fillLo, nwConeH = fillHi;
    fillSouth(bConeL, bConeH, ~wWallL, ~wWallH); const nbConeL = fillLo, nbConeH = fillHi;
    const bHitL = sideways(southLo(nbFixedL, nbFixedH)), bHitH = sideways(southHi(nbFixedH));
    const wHitL = sideways(northLo(nwFixedL)), wHitH = sideways(northHi(nwFixedL, nwFixedH));
    const mwL = ~(nwFixedL | bHitL | nearFrozenBlackL), mwH = ~(nwFixedH | bHitH | nearFrozenBlackH);
    const mbL = ~(nbFixedL | wHitL | nearFrozenWhiteL), mbH = ~(nbFixedH | wHitH | nearFrozenWhiteH);
    let nwKingL = wKingL, nwKingH = wKingH, nbKingL = bKingL, nbKingH = bKingH;
    for (;;) {
      const aL = nwKingL | (zoneLo(nwKingL, nwKingH) & mwL), aH = nwKingH | (zoneHi(nwKingL, nwKingH) & mwH);
      const dL = nbKingL | (zoneLo(nbKingL, nbKingH) & mbL), dH = nbKingH | (zoneHi(nbKingL, nbKingH) & mbH);
      if (aL === nwKingL && aH === nwKingH && dL === nbKingL && dH === nbKingH) break;
      nwKingL = aL; nwKingH = aH; nbKingL = dL; nbKingH = dH;
    }
    let nwBishL = wBishL, nwBishH = wBishH, nbBishL = bBishL, nbBishH = bBishH;
    if (nwBishL | nwBishH | nbBishL | nbBishH) {
      const mL = ~(nwFixedL | nbFixedL), mH = ~(nwFixedH | nbFixedH);
      for (;;) { const aL = nwBishL | (diagonalLo(nwBishL, nwBishH) & mL), aH = nwBishH | (diagonalHi(nwBishL, nwBishH) & mH);
        const dL = nbBishL | (diagonalLo(nbBishL, nbBishH) & mL), dH = nbBishH | (diagonalHi(nbBishL, nbBishH) & mH);
        if (aL === nwBishL && aH === nwBishH && dL === nbBishL && dH === nbBishH) break;
        nwBishL = aL; nwBishH = aH; nbBishL = dL; nbBishH = dH; }
    }
    tL = bTakeL | nbKingL; tH = bTakeH | nbKingH;
    fillSouth(tL & ~bWallL, tH & ~bWallH, ~bWallL, ~bWallH);
    const nbTakeL = tL | southLo(fillLo, fillHi), nbTakeH = tH | southHi(fillHi);
    tL = wTakeL | nwKingL; tH = wTakeH | nwKingH;
    fillNorth(tL & ~wWallL, tH & ~wWallH, ~wWallL, ~wWallH);
    const nwTakeL = tL | northLo(fillLo), nwTakeH = tH | northHi(fillLo, fillHi);
    const changed =
      (nwConeL ^ wConeL) | (nwConeH ^ wConeH) | (nbConeL ^ bConeL) | (nbConeH ^ bConeH) |
      (nwFixedL ^ wFixedL) | (nwFixedH ^ wFixedH) | (nbFixedL ^ bFixedL) | (nbFixedH ^ bFixedH) |
      (nwKingL ^ wKingL) | (nwKingH ^ wKingH) | (nbKingL ^ bKingL) | (nbKingH ^ bKingH) |
      (nwBishL ^ wBishL) | (nwBishH ^ wBishH) | (nbBishL ^ bBishL) | (nbBishH ^ bBishH) |
      (nbTakeL ^ bTakeL) | (nbTakeH ^ bTakeH) | (nwTakeL ^ wTakeL) | (nwTakeH ^ wTakeH);
    wConeL = nwConeL; wConeH = nwConeH; bConeL = nbConeL; bConeH = nbConeH;
    wFixedL = nwFixedL; wFixedH = nwFixedH; bFixedL = nbFixedL; bFixedH = nbFixedH;
    wKingL = nwKingL; wKingH = nwKingH; bKingL = nbKingL; bKingH = nbKingH;
    wBishL = nwBishL; wBishH = nwBishH; bBishL = nbBishL; bBishH = nbBishH;
    bTakeL = nbTakeL; bTakeH = nbTakeH; wTakeL = nwTakeL; wTakeH = nwTakeH;
    if (!changed) break;
  }
  // The boxed pieces of the fixed point (the loop's last pass computed them from the sets before it).
  boxedL = (wxL & ~(bKingL | bBishL)) | (bxL & ~(wKingL | wBishL));
  boxedH = (wxH & ~(bKingH | bBishH)) | (bxH & ~(wKingH | wBishH));
  // A pawn can still promote.
  if ((wConeH & RANK_8) | (bConeL & RANK_1)) return true;
  // A white pawn can capture on a square a black pawn may reach or a black piece holds.
  let tL = sideways(wConeL), tH = sideways(wConeH);
  if ((northLo(tL) & (bConeL | bxL)) | (northHi(tL, tH) & (bConeH | bxH))) return true;
  // A black pawn can capture a white piece.
  tL = sideways(bConeL); tH = sideways(bConeH);
  if ((southLo(tL, tH) & wxL) | (southHi(tH) & wxH)) return true;
  // The frozen king can move after all.
  if (frozenWhite && ((wKingL ^ wkL) | (wKingH ^ wkH))) return true;
  if (frozenBlack && ((bKingL ^ bkL) | (bKingH ^ bkH))) return true;
  // A bishop is diagonally next to a square an enemy pawn may reach.
  if ((diagonalLo(wBishL, wBishH) & bConeL) | (diagonalHi(wBishL, wBishH) & bConeH)) return true;
  if ((diagonalLo(bBishL, bBishH) & wConeL) | (diagonalHi(bBishL, bBishH) & wConeH)) return true;
  // A piece has a step square not held by a fixed pawn or a boxed piece of its colour.
  const wsL = x[X_WHITE_STEPS], wsH = x[X_WHITE_STEPS + 1], bsL = x[X_BLACK_STEPS], bsH = x[X_BLACK_STEPS + 1];
  if ((wsL & ~(wFixedL | (wxL & boxedL))) | (wsH & ~(wFixedH | (wxH & boxedH)))) return true;
  if ((bsL & ~(bFixedL | (bxL & boxedL))) | (bsH & ~(bFixedH | (bxH & boxedH)))) return true;

  netWConeL = wConeL; netWConeH = wConeH; netBConeL = bConeL; netBConeH = bConeH;
  netWKingL = wKingL; netWKingH = wKingH; netBKingL = bKingL; netBKingH = bKingH;
  netWBishL = wBishL; netWBishH = wBishH; netBBishL = bBishL; netBBishH = bBishH;
  netWFixedL = wFixedL; netWFixedH = wFixedH; netBFixedL = bFixedL; netBFixedH = bFixedH;
  netBoxedL = boxedL; netBoxedH = boxedH;
  return false;
}

/** The lock detector with knights, rooks or queens on the board: of the sides in `ask`, those it
    proves (0 at once unless every such piece is boxed in by its own men). */
function boxedTest(pos, ask) {
  const lo = pos.lo, hi = pos.hi;
  const wnL = lo[WHITE | KNIGHT], wnH = hi[WHITE | KNIGHT], wrL = lo[WHITE | ROOK], wrH = hi[WHITE | ROOK];
  const wqL = lo[WHITE | QUEEN], wqH = hi[WHITE | QUEEN];
  const wxL = wnL | wrL | wqL, wxH = wnH | wrH | wqH, wownL = lo[WHITE | PAWN] | wxL, wownH = hi[WHITE | PAWN] | wxH;
  const bnL = lo[BLACK | KNIGHT], bnH = hi[BLACK | KNIGHT], brL = lo[BLACK | ROOK], brH = hi[BLACK | ROOK];
  const bqL = lo[BLACK | QUEEN], bqH = hi[BLACK | QUEEN];
  const bxL = bnL | brL | bqL, bxH = bnH | brH | bqH, bownL = lo[BLACK | PAWN] | bxL, bownH = hi[BLACK | PAWN] | bxH;
  // A first look: a rook or queen with a square beside it (east or west) not held by its own men.
  // In a game that ends it nearly always (96% of chasolver's Lichess positions with such pieces),
  // with no shift across the two words.
  const woL = wrL | wqL, woH = wrH | wqH, boL = brL | bqL, boH = brH | bqH;
  if (((((woL << 1) & NOT_FILE_A) | ((woL >>> 1) & NOT_FILE_H)) & ~wownL) | ((((woH << 1) & NOT_FILE_A) | ((woH >>> 1) & NOT_FILE_H)) & ~wownH) |
      ((((boL << 1) & NOT_FILE_A) | ((boL >>> 1) & NOT_FILE_H)) & ~bownL) | ((((boH << 1) & NOT_FILE_A) | ((boH >>> 1) & NOT_FILE_H)) & ~bownH)) return 0;
  if (!boxedIn(wnL, wnH, wrL, wrH, wqL, wqH, wownL, wownH)) return 0;
  const wsL = stepLo, wsH = stepHi;
  if (!boxedIn(bnL, bnH, brL, brH, bqL, bqH, bownL, bownH)) return 0;
  if (pos.ep !== NO_SQUARE) return 0;
  if (twinBishops(lo[WHITE | BISHOP], hi[WHITE | BISHOP]) || twinBishops(lo[BLACK | BISHOP], hi[BLACK | BISHOP])) return 0;
  takeCensus(pos);
  const x = BOX;
  x[X_WHITE] = wxL; x[X_WHITE + 1] = wxH; x[X_BLACK] = bxL; x[X_BLACK + 1] = bxH;
  x[X_WHITE_STEPS] = wsL; x[X_WHITE_STEPS + 1] = wsH; x[X_BLACK_STEPS] = stepLo; x[X_BLACK_STEPS + 1] = stepHi;
  const occL = wxL | bxL, occH = wxH | bxH;
  let open = ask;
  for (let level = 0; level < 3 && open; level++) {
    let frL = 0, frH = 0;
    if (level) {
      const c = census, kingAt = level === 1 ? C_WHITE_KING : C_BLACK_KING;
      frL = c[kingAt]; frH = c[kingAt + 1];
      const wpL = c[C_WHITE_PAWNS], wpH = c[C_WHITE_PAWNS + 1], bpL = c[C_BLACK_PAWNS], bpH = c[C_BLACK_PAWNS + 1];
      const pawnL = northLo(wpL) | southLo(bpL, bpH), pawnH = northHi(wpL, wpH) | southHi(bpH);
      const heldL = wpL | bpL | sideways(pawnL), heldH = wpH | bpH | sideways(pawnH), sq = firstSquare(frL, frH);
      if ((KING_STEPS[2 * sq] & ~heldL) | (KING_STEPS[2 * sq + 1] & ~heldH)) continue;
    }
    if (boxedLevelLeaks(frL, frH)) continue;
    const was = open;
    if ((open & FLAGGED_WHITE) && !netLeaks(WHITE, occL, occH)) open &= ~FLAGGED_WHITE;
    if ((open & FLAGGED_BLACK) && !netLeaks(BLACK, occL, occH)) open &= ~FLAGGED_BLACK;
    if (boxedRecord && open !== was) boxedRecord.push({ ...levelSets(frL, frH), boxed: [netBoxedL, netBoxedH] });
  }
  return ask & ~open;
}

/** The lock detector: can `flagged` never be mated, by the structure of pawns, kings and bishops? */
export function lockTest(pos, flagged) {
  const lo = pos.lo, hi = pos.hi;
  // A knight, rook or queen on the board (the usual case in a game: tested first): only boxed ones may stay.
  if (lo[WHITE | KNIGHT] | hi[WHITE | KNIGHT] | lo[BLACK | KNIGHT] | hi[BLACK | KNIGHT] |
      lo[WHITE | ROOK] | hi[WHITE | ROOK] | lo[BLACK | ROOK] | hi[BLACK | ROOK] |
      lo[WHITE | QUEEN] | hi[WHITE | QUEEN] | lo[BLACK | QUEEN] | hi[BLACK | QUEEN])
    return boxedTest(pos, flagged === WHITE ? FLAGGED_WHITE : FLAGGED_BLACK) !== 0;
  if (pos.ep !== NO_SQUARE) return false;
  if (twinBishops(lo[WHITE | BISHOP], hi[WHITE | BISHOP]) || twinBishops(lo[BLACK | BISHOP], hi[BLACK | BISHOP])) return false;
  if (takeCensusPairs(pos)) return lockTestPairsFirst(flagged === WHITE ? FLAGGED_WHITE : FLAGGED_BLACK) !== 0;
  if (!lockLeaks(flagged, 0, 0)) return true;
  return lockTestRest(flagged === WHITE ? FLAGGED_WHITE : FLAGGED_BLACK) !== 0;
}

/** With an open pair the levels above almost never prove a lock: at each level (free, then the
    frozen kings' whose neighbours are all held) the open-pair rule first, then the level itself for
    the sides it did not prove and its family A did not refute (A leaking means the level leaks).
    Of the sides in `ask`, those proven. */
function lockTestPairsFirst(ask) {
  const c = census;
  const k = gapPairs();
  const wpL = c[C_WHITE_PAWNS], wpH = c[C_WHITE_PAWNS + 1], bpL = c[C_BLACK_PAWNS], bpH = c[C_BLACK_PAWNS + 1];
  const pawnL = northLo(wpL) | southLo(bpL, bpH), pawnH = northHi(wpL, wpH) | southHi(bpH);
  const heldL = wpL | bpL | sideways(pawnL), heldH = wpH | bpH | sideways(pawnH);
  let open = pairsLevel(ask, k, 0, 0);
  for (let kingAt = C_WHITE_KING; open && kingAt <= C_BLACK_KING; kingAt += 2) {
    const kL = c[kingAt], kH = c[kingAt + 1], sq = firstSquare(kL, kH);
    if ((KING_STEPS[2 * sq] & ~heldL) | (KING_STEPS[2 * sq + 1] & ~heldH)) continue;
    open = pairsLevel(open, k, kL, kH);
  }
  return ask & ~open;
}

/** One level with open pairs: of the sides in `open`, those still not proven. */
function pairsLevel(open, k, frL, frH) {
  let refuted = 0;
  if (k <= MAX_GAP_PAIRS) { open &= ~gapLevel(open, k, frL, frH); refuted = gapRefuted; }
  const rest = open & ~refuted;
  return rest ? open & ~(rest & ~lockLeaks2(rest, frL, frH)) : open;
}

/** The levels after the first, out of line (most calls return before them): the frozen kings'
    levels (no open pair: the open-pair rule has nothing to split). Of the sides in `ask`, those
    proven. */
function lockTestRest(ask) {
  const c = census;
  const wpL = c[C_WHITE_PAWNS], wpH = c[C_WHITE_PAWNS + 1], bpL = c[C_BLACK_PAWNS], bpH = c[C_BLACK_PAWNS + 1];
  // Squares held or attacked by some pawn: a frozen king needs all its neighbours among them.
  const pawnL = northLo(wpL) | southLo(bpL, bpH), pawnH = northHi(wpL, wpH) | southHi(bpH);
  const heldL = wpL | bpL | sideways(pawnL), heldH = wpH | bpH | sideways(pawnH);
  let open = ask;
  for (let kingAt = C_WHITE_KING; kingAt <= C_BLACK_KING; kingAt += 2) {   // White's king frozen, then Black's
    const kL = c[kingAt], kH = c[kingAt + 1], sq = firstSquare(kL, kH);
    if ((KING_STEPS[2 * sq] & ~heldL) | (KING_STEPS[2 * sq + 1] & ~heldH)) continue;
    open = lockLeaks2(open, kL, kH);
    if (!open) return ask;
  }
  return ask & ~open;
}

/** The sets of the last level computed (the net's variables), as lockSets returns them. */
function levelSets(frL, frH) {
  return {
    wCone: [netWConeL, netWConeH], bCone: [netBConeL, netBConeH],
    wFixed: [netWFixedL, netWFixedH], bFixed: [netBFixedL, netBFixedH],
    wKing: [netWKingL, netWKingH], bKing: [netBKingL, netBKingH],
    wBish: [netWBishL, netWBishH], bBish: [netBBishL, netBBishH],
    frozen: [frL, frH],
  };
}

/** The certificate itself, for tests and for showing a lock: null when the lock detector does not
    prove `flagged` unable to be mated, otherwise the sets of the level that proves it, each a
    [lo, hi] pair of words: the pawns' cones (wCone, bCone: every square a pawn may still reach),
    the pawns that can never move (wFixed, bFixed), the kings' reaches (wKing, bKing), the bishops'
    reaches (wBish, bBish), and the frozen king's square (frozen; [0, 0] when both kings are free).
    With knights, rooks or queens on the board (the second version) also boxed: the boxed ones no
    enemy king or bishop reaches. A lock proven by the open-pair rule gives { families, frozen }:
    one set of sets per family, each with its pairs ('A', 'B' or 'C' for each pair).
    It computes the levels again, so it costs a few lock tests; the arbiter never calls it. */
export function lockSets(pos, flagged) {
  if (!lockTest(pos, flagged)) return null;
  const lo = pos.lo, hi = pos.hi;
  if (lo[WHITE | KNIGHT] | hi[WHITE | KNIGHT] | lo[BLACK | KNIGHT] | hi[BLACK | KNIGHT] |
      lo[WHITE | ROOK] | hi[WHITE | ROOK] | lo[BLACK | ROOK] | hi[BLACK | ROOK] |
      lo[WHITE | QUEEN] | hi[WHITE | QUEEN] | lo[BLACK | QUEEN] | hi[BLACK | QUEEN]) {
    boxedRecord = [];
    boxedTest(pos, flagged === WHITE ? FLAGGED_WHITE : FLAGGED_BLACK);
    const found = boxedRecord; boxedRecord = null;
    if (found.length === 1) return found[0];
    throw new Error('lockSets: the lock test and its boxed levels disagree');
  }
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
    return levelSets(frL, frH);
  }
  // Proven by the open-pair rule: every family of the level that proves it.
  const k = gapPairs(), bit = flagged === WHITE ? FLAGGED_WHITE : FLAGGED_BLACK;
  for (const [frL, frH] of levels) {
    gapRecord = [];
    const ok = k <= MAX_GAP_PAIRS && gapLevel(bit, k, frL, frH) === bit;
    const families = gapRecord; gapRecord = null;
    if (ok) return { families, frozen: [frL, frH] };
  }
  throw new Error('lockSets: the lock test and its levels disagree');
}

/** The first version's lock detector alone (the rules of the scalachess patch's Lock.scala and of
    lock/, the detector in 20 languages): the levels above, without the open-pair rule and boxed
    pieces. For lock/positions.tsv and the lock tab's explorer; the ladder asks lockTest. */
export function coreLockTest(pos, flagged) {
  const lo = pos.lo, hi = pos.hi;
  if (lo[WHITE | KNIGHT] | hi[WHITE | KNIGHT] | lo[BLACK | KNIGHT] | hi[BLACK | KNIGHT] |
      lo[WHITE | ROOK] | hi[WHITE | ROOK] | lo[BLACK | ROOK] | hi[BLACK | ROOK] |
      lo[WHITE | QUEEN] | hi[WHITE | QUEEN] | lo[BLACK | QUEEN] | hi[BLACK | QUEEN]) return false;
  if (pos.ep !== NO_SQUARE) return false;
  if (twinBishops(lo[WHITE | BISHOP], hi[WHITE | BISHOP]) || twinBishops(lo[BLACK | BISHOP], hi[BLACK | BISHOP])) return false;
  takeCensus(pos);
  if (!lockLeaks(flagged, 0, 0)) return true;
  return lockTestRest(flagged === WHITE ? FLAGGED_WHITE : FLAGGED_BLACK) !== 0;
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
      lo[WHITE | QUEEN] | hi[WHITE | QUEEN] | lo[BLACK | QUEEN] | hi[BLACK | QUEEN]) return boxedTest(pos, ask);
  if (pos.ep !== NO_SQUARE) return 0;
  if (twinBishops(lo[WHITE | BISHOP], hi[WHITE | BISHOP]) || twinBishops(lo[BLACK | BISHOP], hi[BLACK | BISHOP])) return 0;
  if (takeCensusPairs(pos)) return lockTestPairsFirst(ask);
  const open = lockLeaks2(ask, 0, 0);          // the asked sides not proven yet
  if (!open) return ask;
  return (ask & ~open) | lockTestRest(open);
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
   king or bishop move stays inside its reach and leaves the fixed point as it was. A knight, rook
   or queen fails the first version whatever it does; in the second, one that has just moved
   quietly has an empty step square (where it came from, or one it slid over), so the boxed rule
   fails after it too (see the boxed pieces above).

   (A check by a bishop changes nothing: the kings' reaches do not look at bishops. A check by a
   knight, rook or queen neither: a piece that gives check is not boxed in.)

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
