/* ═══ Mateless · lock.js — rung 2: the lock detector, and the two static tests together ═════

   Two tests prove, without searching, that the flagged side can never be mated:
     the material test (material.js): the mating side lacks the material to mate at all;
     the lock detector (here): pawns, kings and bishops form a structure that no series of legal
     moves can open. It reads the bitboards only: it generates no move and searches nothing (the
     second version's stalemated flagged side looks two plies ahead, on the bitboards: below).

   The detector comes in two versions in this file. The first is the lock detector proper, the one
   proposed to Lichess (Lock.scala) and kept alone in 20 languages in lock/: a knight, rook or queen
   on the board fails it at once (coreLockTest below runs it alone). The second version adds rules,
   each entered only when its own situation is on the board, so that every other position runs the
   first version's code: open pawn pairs (when the pawns hold one) and boxed knights, rooks and
   queens (when one stands); and four rules for the ways a game of kings and pawns runs into a
   stalemate or a lock: the stalemate guard (a pawn whose capture always stalemates its owner stays
   a wall), the check seed (a king in a pawn's check starts its reach from the squares it can step
   to), the stuck mater (whatever the flagged side plays, the mater has no move) and the forced step
   (a king in a pawn's check with one legal move: the position after it); and twin bishops (two or
   more of one side on one colour, which the first version refuses: the mating net then leaves out its
   second flight rule where they may hold both flights). Beside the detector, in this file too: the
   stuck mater move by move (stuckEvery, which the ladder asks after the first search) and the
   stalemated flagged side (tempoStalemate: whatever the mater plays, the flagged side, a king and
   pawns, is stalemated, now or after its one legal move), which lockCannotMate, cannotMate and a
   game's flags ask but the search's static tests do not. It is not complete either; it sees more.
   They are the first two rungs of a ladder: the material test, the lock detector, then the
   Domino search (domino.js), which asks the same two tests at its nodes. In the first version a
   king that must step out of a pawn's check into a lock, or must take the last queen or rook, is
   left to the search (one ply). Most positions fail
   them on a fact or two, so both read the bitboards directly and return at the first fact that
   decides. Only a position that passes the lock detector's quick checks gets the full census
   below, which its fixed point reads.

   From the board it needs the piece sets, the en passant square and a few shifts of a set of
   squares; the lock generates no move and searches nothing. */

import { BETWEEN, BISHOP, bishopRay, BLACK, DARK_SQUARES, diagonalHi, diagonalLo, firstSquare, KING, KING_STEPS,
         KNIGHT, KNIGHT_STEPS, LINE, lowestBit, NO_SQUARE, northHi, northLo, PAWN, popcount, QUEEN, RANK_1, RANK_8,
         rayHi, rayLo, ROOK, rookRay, NOT_FILE_A, NOT_FILE_H, sideways, sideways2, southHi, southLo, WHITE, zoneHi,
         zoneLo } from './board.js';
import { materialTest } from './material.js';

/* The census of the lock detector, taken into this typed array (pairs of words, see the C_
   indices), so that its fixed-point loop reads plain int32 values. It is module state, shared by
   every call: the engine is not re-entrant (see the notes on porting in index.js). */
const census = new Int32Array(12);
const C_WHITE_PAWNS = 0, C_BLACK_PAWNS = 2, C_WHITE_KING = 4, C_BLACK_KING = 6,
      C_WHITE_BISHOPS = 8, C_BLACK_BISHOPS = 10;

let censusPos = null;      // the position of the last census (the check seed reads its side to move)
/* Twin bishops (the second version). Two bishops of one side on one colour come only from a promotion.
   The mating net's second flight rule (a free square vertically and one horizontally next to the
   king) counts on the flagged side having at most one bishop on their colour, which is the colour
   opposite the king's square: with two there they may hold both flights at once. So for each side,
   the king squares where that rule is not counted: the light squares if it has two or more bishops
   on dark squares, the dark ones if on light squares. Everything else in the detector counts a
   side's bishops through their reach, whatever their number. */
let wNoPairL = 0, wNoPairH = 0, bNoPairL = 0, bNoPairH = 0;
function noPairSquares(lo, hi) {
  const dark = popcount(lo & DARK_SQUARES) + popcount(hi & DARK_SQUARES) > 1;
  const light = popcount(lo & ~DARK_SQUARES) + popcount(hi & ~DARK_SQUARES) > 1;
  return (dark ? ~DARK_SQUARES : 0) | (light ? DARK_SQUARES : 0);   // the same pattern in both words
}
function takeCensus(pos) {
  censusPos = pos;
  wNoPairL = wNoPairH = noPairSquares(pos.lo[WHITE | BISHOP], pos.hi[WHITE | BISHOP]);
  bNoPairL = bNoPairH = noPairSquares(pos.lo[BLACK | BISHOP], pos.hi[BLACK | BISHOP]);
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
  censusPos = pos;
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
/* ─── The stalemate guard (second version) ─────────────────────────────────────────────────

   A pawn the enemy king may take leaves the wall (the takeable pawns above). It need not, if taking
   it always ends the game: when the owner's king, wherever it may stand, either defends the pawn or
   has no square left to step to once the enemy king stands on the pawn's square, and the owner has
   nothing else that moves (no bishop; every other pawn fixed). The capture is then a stalemate (the
   owner is to move, and a king's capture gives no check unless it uncovers an enemy bishop, which
   the rays below rule out), so no line of play goes through it: the pawn is as good as a wall.
   Only a fixed pawn is guarded (a pawn that may still move could be taken elsewhere). The guard
   only shrinks as the reaches grow and the fixed pawns shrink, so the cycle stays monotone. */
let GUARD = true;
let guardL = 0, guardH = 0;
const bitAt = (L, H, s) => (s < 32 ? (L >>> s) : (H >>> (s - 32))) & 1;
/** Does a diagonal ray from k, stopped by the squares (bL, bH), meet a square of (oL, oH)? */
function rayMeets(k, bL, bH, oL, oH) {
  const f0 = k & 7, r0 = k >> 3;
  for (let d = 0; d < 4; d++) {
    const df = d & 1 ? 1 : -1, dr = d & 2 ? 1 : -1;
    for (let f = f0 + df, r = r0 + dr; f >= 0 && f < 8 && r >= 0 && r < 8; f += df, r += dr) {
      const s = 8 * r + f;
      if (bitAt(oL, oH, s)) return true;
      if (bitAt(bL, bH, s)) break;
    }
  }
  return false;
}
/** Of the owner's fixed pawns (candL/H, which the enemy king may take), those whose capture always
    stalemates the owner. reach: where the owner's king may stand; shut: squares its king can never
    step to with the enemy king elsewhere (own fixed pawns, squares the enemy's fixed pawns attack);
    enemyKing: the enemy king's reach; block: squares a bishop's line never crosses (fixed pawns). */
function stalemateGuard(candL, candH, ownPL, ownPH, ownFixedL, ownFixedH, reachL, reachH,
                        shutL, shutH, enemyKingL, enemyKingH, enemyBishops, blockL, blockH) {
  guardL = 0; guardH = 0;
  if ((ownPL & ~ownFixedL) | (ownPH & ~ownFixedH)) return;     // another pawn of the owner's may move
  let cL = candL, cH = candH;
  while (cL | cH) {
    let p;
    if (cL) { p = 31 - Math.clz32(cL & -cL); cL &= cL - 1; } else { p = 63 - Math.clz32(cH & -cH); cH &= cH - 1; }
    const pL = p < 32 ? 1 << p : 0, pH = p < 32 ? 0 : 1 << (p - 32);
    const nL = KING_STEPS[2 * p], nH = KING_STEPS[2 * p + 1];
    const oL = nL & enemyKingL, oH = nH & enemyKingH;           // where the enemy king takes from
    let kL = reachL & ~(nL | pL), kH = reachH & ~(nH | pH);     // the owner's king, not defending the pawn
    const xL = shutL | nL | pL, xH = shutH | nH | pH;            // ... and not stepping next to the enemy king
    let held = true;
    while (kL | kH) {
      let k;
      if (kL) { k = 31 - Math.clz32(kL & -kL); kL &= kL - 1; } else { k = 63 - Math.clz32(kH & -kH); kH &= kH - 1; }
      if ((KING_STEPS[2 * k] & ~xL) | (KING_STEPS[2 * k + 1] & ~xH)) { held = false; break; }
      if (enemyBishops && rayMeets(k, blockL | pL, blockH | pH, oL, oH)) { held = false; break; }
    }
    if (held) { guardL |= pL; guardH |= pH; }
  }
}

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

  // The check seed (second version): the side to move is in a pawn's check, so its king must step out now, to
  // one of the squares it can step to now (exact: its own pawns, the enemy pawns' attacks, the enemy
  // king's neighbours); its reach starts there, not on its square, which a fixed pawn keeps attacked.
  // Not when it has no such step (that may be a mate now), when one of its pawns can take a checking
  // pawn (the king would stay), at a frozen level, or with a bishop on the board.
  let wSeedL = wkL, wSeedH = wkH, bSeedL = bkL, bSeedH = bkH;
  if (GUARD && !(frL | frH) && censusPos !== null && pawnCheck(censusPos) &&
      !(c[C_WHITE_BISHOPS] | c[C_WHITE_BISHOPS + 1] | c[C_BLACK_BISHOPS] | c[C_BLACK_BISHOPS + 1])) {
    const white = censusPos.side === WHITE;
    const kL = white ? wkL : bkL, kH = white ? wkH : bkH, k = firstSquare(kL, kH);
    const ek = white ? firstSquare(bkL, bkH) : firstSquare(wkL, wkH);
    const atkL = white ? sideways(southLo(bpL, bpH)) : sideways(northLo(wpL));
    const atkH = white ? sideways(southHi(bpH)) : sideways(northHi(wpL, wpH));
    const ownL = white ? wpL : bpL, ownH = white ? wpH : bpH;
    const dL = KING_STEPS[2 * k] & ~ownL & ~atkL & ~KING_STEPS[2 * ek], dH = KING_STEPS[2 * k + 1] & ~ownH & ~atkH & ~KING_STEPS[2 * ek + 1];
    // the checking pawns, and whether an own pawn attacks one of them
    const chkL = white ? sideways(northLo(kL)) & bpL : sideways(southLo(kL, kH)) & wpL;
    const chkH = white ? sideways(northHi(kL, kH)) & bpH : sideways(southHi(kH)) & wpH;
    const takeL = white ? sideways(southLo(chkL, chkH)) & wpL : sideways(northLo(chkL)) & bpL;
    const takeH = white ? sideways(southHi(chkH)) & wpH : sideways(northHi(chkL, chkH)) & bpH;
    if ((dL | dH) && !(takeL | takeH)) {
      if (white) { wSeedL = dL; wSeedH = dH; } else { bSeedL = dL; bSeedH = dH; }
    }
  }

  // The cycle: walls -> fixed pawns -> king reaches -> capture squares.
  let wFixedL = wpL, wFixedH = wpH, bFixedL = bpL, bFixedH = bpH;
  let wKingL = wSeedL, wKingH = wSeedH, bKingL = bSeedL, bKingH = bSeedH;
  let bTakeL = bSeedL, bTakeH = bSeedH, wTakeL = wSeedL, wTakeH = wSeedH;
  let wWallL = -1, wWallH = -1, bWallL = -1, bWallH = -1;
  // The stalemate guard of each side's pawns (all of them at first: nothing is taken yet).
  let wGuardL = -1, wGuardH = -1, bGuardL = -1, bGuardH = -1;
  const wBishops = (c[C_WHITE_BISHOPS] | c[C_WHITE_BISHOPS + 1]) !== 0, bBishops = (c[C_BLACK_BISHOPS] | c[C_BLACK_BISHOPS + 1]) !== 0;
  for (;;) {
    const pwL = wWallL, pwH = wWallH, pbL = bWallL, pbH = bWallH;
    // wWall = white pawns Black can never take (or whose capture stalemates White) | frozen king; bWall likewise
    wWallL = (wpL & ~(bTakeL & ~wGuardL)) | frL; wWallH = (wpH & ~(bTakeH & ~wGuardH)) | frH;
    bWallL = (bpL & ~(wTakeL & ~bGuardL)) | frL; bWallH = (bpH & ~(wTakeH & ~bGuardH)) | frH;
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
    // The guards for the next pass, from this pass's reaches and fixed pawns.
    let ngwL = 0, ngwH = 0, ngbL = 0, ngbH = 0;
    if (GUARD) {
      const blL = nwFixedL | nbFixedL, blH = nwFixedH | nbFixedH;
      if (!wBishops) {
        stalemateGuard(wpL & nbTakeL & nwFixedL, wpH & nbTakeH & nwFixedH, wpL, wpH, nwFixedL, nwFixedH,
                       nwKingL, nwKingH, nwFixedL | bHitL, nwFixedH | bHitH, nbKingL, nbKingH, bBishops, blL, blH);
        ngwL = guardL; ngwH = guardH;
      }
      if (!bBishops) {
        stalemateGuard(bpL & nwTakeL & nbFixedL, bpH & nwTakeH & nbFixedH, bpL, bpH, nbFixedL, nbFixedH,
                       nbKingL, nbKingH, nbFixedL | wHitL, nbFixedH | wHitH, nwKingL, nwKingH, wBishops, blL, blH);
        ngbL = guardL; ngbH = guardH;
      }
    }
    const changed = (ngwL ^ wGuardL) | (ngwH ^ wGuardH) | (ngbL ^ bGuardL) | (ngbH ^ bGuardH) |
      (nwFixedL ^ wFixedL) | (nwFixedH ^ wFixedH) | (nbFixedL ^ bFixedL) | (nbFixedH ^ bFixedH) |
      (nwKingL ^ wKingL) | (nwKingH ^ wKingH) | (nbKingL ^ bKingL) | (nbKingH ^ bKingH) |
      (nbTakeL ^ bTakeL) | (nbTakeH ^ bTakeH) | (nwTakeL ^ wTakeL) | (nwTakeH ^ wTakeH);
    wFixedL = nwFixedL; wFixedH = nwFixedH; bFixedL = nbFixedL; bFixedH = nbFixedH;
    wKingL = nwKingL; wKingH = nwKingH; bKingL = nbKingL; bKingH = nbKingH;
    bTakeL = nbTakeL; bTakeH = nbTakeH; wTakeL = nwTakeL; wTakeH = nwTakeH;
    wGuardL = ngwL; wGuardH = ngwH; bGuardL = ngbL; bGuardH = ngbH;
    if (!changed) break;
  }

  // A king that takes a guarded pawn ends the game: for the mating net, the kings' reaches again, now
  // stopping at the enemy's guarded pawns (smaller reaches; the walls and fixed pawns stay as they are).
  if (GUARD && (wGuardL | wGuardH | bGuardL | bGuardH)) {
    const bHitL = sideways(southLo(bFixedL, bFixedH)), bHitH = sideways(southHi(bFixedH));
    const wHitL = sideways(northLo(wFixedL)), wHitH = sideways(northHi(wFixedL, wFixedH));
    const mwL = ~(wFixedL | bHitL | nearFrozenBlackL | (bpL & bGuardL)), mwH = ~(wFixedH | bHitH | nearFrozenBlackH | (bpH & bGuardH));
    const mbL = ~(bFixedL | wHitL | nearFrozenWhiteL | (wpL & wGuardL)), mbH = ~(bFixedH | wHitH | nearFrozenWhiteH | (wpH & wGuardH));
    let aL = wSeedL, aH = wSeedH, dL = bSeedL, dH = bSeedH;
    for (;;) {
      const xL = aL | (zoneLo(aL, aH) & mwL), xH = aH | (zoneHi(aL, aH) & mwH);
      const yL = dL | (zoneLo(dL, dH) & mbL), yH = dH | (zoneHi(dL, dH) & mbH);
      if (xL === aL && xH === aH && yL === dL && yH === dH) break;
      aL = xL; aH = xH; dL = yL; dH = yH;
    }
    wKingL = aL; wKingH = aH; bKingL = dL; bKingH = dH;
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
  // the second rule, not on the squares where the flagged side's twin bishops may hold both flights
  const noL = flagged === WHITE ? wNoPairL : bNoPairL, noH = flagged === WHITE ? wNoPairH : bNoPairH;
  const flightL = sideways(spareL) | northLo(spareL) | southLo(spareL, spareH) |
                  ((northLo(freeL) | southLo(freeL, freeH)) & sideways(freeL) & ~noL);
  const flightH = sideways(spareH) | northHi(spareL, spareH) | southHi(spareH) |
                  ((northHi(freeL, freeH) | southHi(freeH)) & sideways(freeH) & ~noH);
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
   that never moves: a fixed pawn, another boxed piece, a still bishop (every diagonal neighbour held
   so, and out of the enemy king's and bishops' reach), or its own king when that king is frozen and
   may be a wall (see castling below). It never moves, and it attacks only the
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

   Castling, Chess960's too, never moves a boxed rook: a castling rook needs the square beside it
   towards its king or its destination empty or holding the king, and a boxed rook has its own
   men on both sides. Its king is one of them only when frozen, when its side has no castling right
   left (under Chess960 rules a rook beside its king may castle: 256 of the 896 such layouts), and
   when it does not stand where a castle leaves it beside its rook (g1 with a rook on f1, c1 with a
   rook on d1; g8 and f8, c8 and d8 for Black). (In standard chess a castling rook never stands
   beside its king and a frozen king never castles, but a lock with a castling right left is too
   rare to be worth the difference.)
   test/chess960_boxed_check.js tries every castling layout of Chess960 with the engine's own moves.

   A level is the plain loop (every set updated on every pass, as rust/src/lock.rs keeps it in
   lock_leaks_reference), with these additions:
     boxed   the pieces that no enemy king or bishop can ever reach: they never move nor fall.
             It depends on the bishops' reaches, so here the bishops are in the cycle.
     walls   boxed pieces are walls for the pawns of both sides (a pawn they block is fixed, and
             the capture squares stop at them).
     kings   own boxed pieces and still bishops are squares the king never steps to, so they may
             hold a frozen king's neighbours.
     leaks   a pawn can capture on a boxed piece's square; a piece has a step square not held by a
             fixed pawn, a boxed piece or a still bishop of its colour, or its frozen king.
     the net no flight onto any knight, rook or queen's square.
   A piece whose step squares are all held but that an enemy king or bishop may reach is no wall: it
   may be taken (by the king or bishop that reaches it), and until then it stands still.

   Where the trigger stands (testsAfter): a knight, rook or queen that has just moved quietly has an
   empty step square, the square it came from or one it slid over, so the quick check fails after
   any such move: only a capture or a pawn move (a promotion included) can complete a boxed lock,
   and those already ask the lock detector. A bishop that has just moved has that square empty
   beside it, so it is no still bishop. A king that has just stepped can step back to the square it
   came from (an enemy pawn attacking it would have been a check, after which the lock detector is
   asked), so its frozen level fails. A castle is the one move that leaves the king's square or the
   rook's next to it filled: it leaves the two on g1 and f1 or on c1 and d1 (g8, f8, c8, d8), where
   the king holds nothing; the rook then has its king beside it and is not boxed. */
const BOX = new Int32Array(8);
const X_WHITE = 0, X_BLACK = 2, X_WHITE_STEPS = 4, X_BLACK_STEPS = 6;
// The boxed pieces of the last level that did not leak, and (lockSets) where the level that proves
// a side records its certificate.
let netBoxedL = 0, netBoxedH = 0, boxedRecord = null;
// The still bishops of that level, and the kings that may hold a boxed piece's step square when
// frozen (see boxedTest).
let netStillL = 0, netStillH = 0, kingWallWhite = false, kingWallBlack = false;

/** The still bishops among bishops bL/bH: every diagonal neighbour held for good by heldL/heldH
    (fixed pawns and boxed pieces of their colour) or by another still bishop, and out of the enemy
    king's and bishops' reach (reachL/reachH). Such a bishop never moves and is never taken (a pawn
    taking it fails the bishop contact test). The largest such set, as [lo, hi]. */
function stillBishops(bL, bH, heldL, heldH, reachL, reachH) {
  let sL = bL & ~reachL, sH = bH & ~reachH;
  for (;;) {
    let nL = 0, nH = 0, m = sL;
    const hL = heldL | sL, hH = heldH | sH;
    while (m) { const b = m & -m; m ^= b; if (((diagonalLo(b, 0) & ~hL) | (diagonalHi(b, 0) & ~hH)) === 0) nL |= b; }
    m = sH;
    while (m) { const b = m & -m; m ^= b; if (((diagonalLo(0, b) & ~hL) | (diagonalHi(0, b) & ~hH)) === 0) nH |= b; }
    if (nL === sL && nH === sH) return [sL, sH];
    sL = nL; sH = nH;
  }
}
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
    // Own boxed pieces and still bishops (as of the sets before this pass) are squares the king never steps to.
    const [wsbL, wsbH] = stillBishops(c[C_WHITE_BISHOPS], c[C_WHITE_BISHOPS + 1], nwFixedL | (wxL & boxedL), nwFixedH | (wxH & boxedH), bKingL | bBishL, bKingH | bBishH);
    const [bsbL, bsbH] = stillBishops(c[C_BLACK_BISHOPS], c[C_BLACK_BISHOPS + 1], nbFixedL | (bxL & boxedL), nbFixedH | (bxH & boxedH), wKingL | wBishL, wKingH | wBishH);
    const mwL = ~(nwFixedL | bHitL | nearFrozenBlackL | (wxL & boxedL) | wsbL), mwH = ~(nwFixedH | bHitH | nearFrozenBlackH | (wxH & boxedH) | wsbH);
    const mbL = ~(nbFixedL | wHitL | nearFrozenWhiteL | (bxL & boxedL) | bsbL), mbH = ~(nbFixedH | wHitH | nearFrozenWhiteH | (bxH & boxedH) | bsbH);
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
  // A piece has a step square not held by a fixed pawn, a boxed piece or a still bishop of its
  // colour, or by its frozen king (where a king may be such a wall: kingWallWhite, kingWallBlack).
  const [wsbL, wsbH] = stillBishops(c[C_WHITE_BISHOPS], c[C_WHITE_BISHOPS + 1], wFixedL | (wxL & boxedL), wFixedH | (wxH & boxedH), bKingL | bBishL, bKingH | bBishH);
  const [bsbL, bsbH] = stillBishops(c[C_BLACK_BISHOPS], c[C_BLACK_BISHOPS + 1], bFixedL | (bxL & boxedL), bFixedH | (bxH & boxedH), wKingL | wBishL, wKingH | wBishH);
  const wkwL = frozenWhite && kingWallWhite ? wkL : 0, wkwH = frozenWhite && kingWallWhite ? wkH : 0;
  const bkwL = frozenBlack && kingWallBlack ? bkL : 0, bkwH = frozenBlack && kingWallBlack ? bkH : 0;
  const wsL = x[X_WHITE_STEPS], wsH = x[X_WHITE_STEPS + 1], bsL = x[X_BLACK_STEPS], bsH = x[X_BLACK_STEPS + 1];
  if ((wsL & ~(wFixedL | (wxL & boxedL) | wsbL | wkwL)) | (wsH & ~(wFixedH | (wxH & boxedH) | wsbH | wkwH))) return true;
  if ((bsL & ~(bFixedL | (bxL & boxedL) | bsbL | bkwL)) | (bsH & ~(bFixedH | (bxH & boxedH) | bsbH | bkwH))) return true;

  netWConeL = wConeL; netWConeH = wConeH; netBConeL = bConeL; netBConeH = bConeH;
  netWKingL = wKingL; netWKingH = wKingH; netBKingL = bKingL; netBKingH = bKingH;
  netWBishL = wBishL; netWBishH = wBishH; netBBishL = bBishL; netBBishH = bBishH;
  netWFixedL = wFixedL; netWFixedH = wFixedH; netBFixedL = bFixedL; netBFixedH = bFixedH;
  netBoxedL = boxedL; netBoxedH = boxedH;
  netStillL = wsbL | bsbL; netStillH = wsbH | bsbH;
  return false;
}

/** The lock detector with knights, rooks or queens on the board: of the sides in `ask`, those it
    proves (0 at once unless every such piece is boxed in by its own men). */
function boxedTest(pos, ask) {
  const lo = pos.lo, hi = pos.hi;
  const wnL = lo[WHITE | KNIGHT], wnH = hi[WHITE | KNIGHT], wrL = lo[WHITE | ROOK], wrH = hi[WHITE | ROOK];
  const wqL = lo[WHITE | QUEEN], wqH = hi[WHITE | QUEEN];
  const bnL = lo[BLACK | KNIGHT], bnH = hi[BLACK | KNIGHT], brL = lo[BLACK | ROOK], brH = hi[BLACK | ROOK];
  const bqL = lo[BLACK | QUEEN], bqH = hi[BLACK | QUEEN];
  // A king may hold a step square (when frozen) only if its side has no castling right left (a
  // castling rook may stand beside its king, Chess960, and castling moves it) and if it does not
  // stand where a castle leaves it beside its rook (g1 with a rook on f1, c1 with one on d1; g8,
  // f8, c8, d8): the static tests are not asked after a castle (testsAfter), so no lock may need it.
  const wkL = lo[WHITE | KING], bkH = hi[BLACK | KING];
  kingWallWhite = (pos.castling & 3) === 0 && (wrL & (((wkL & 0x40) >>> 1) | ((wkL & 0x04) << 1))) === 0;
  kingWallBlack = (pos.castling & 12) === 0 && (brH & (((bkH & 0x40000000) >>> 1) | ((bkH & 0x04000000) << 1))) === 0;
  const wxL = wnL | wrL | wqL, wxH = wnH | wrH | wqH;
  const wownL = lo[WHITE | PAWN] | wxL | lo[WHITE | BISHOP] | (kingWallWhite ? wkL : 0);
  const wownH = hi[WHITE | PAWN] | wxH | hi[WHITE | BISHOP] | (kingWallWhite ? hi[WHITE | KING] : 0);
  const bxL = bnL | brL | bqL, bxH = bnH | brH | bqH;
  const bownL = lo[BLACK | PAWN] | bxL | lo[BLACK | BISHOP] | (kingWallBlack ? lo[BLACK | KING] : 0);
  const bownH = hi[BLACK | PAWN] | bxH | hi[BLACK | BISHOP] | (kingWallBlack ? bkH : 0);
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
      // its own knights, rooks, queens and bishops may hold its neighbours too (checked in the level)
      const ownL = level === 1 ? wxL | c[C_WHITE_BISHOPS] : bxL | c[C_BLACK_BISHOPS];
      const ownH = level === 1 ? wxH | c[C_WHITE_BISHOPS + 1] : bxH | c[C_BLACK_BISHOPS + 1];
      const heldL = wpL | bpL | sideways(pawnL) | ownL, heldH = wpH | bpH | sideways(pawnH) | ownH, sq = firstSquare(frL, frH);
      if ((KING_STEPS[2 * sq] & ~heldL) | (KING_STEPS[2 * sq + 1] & ~heldH)) continue;
    }
    if (boxedLevelLeaks(frL, frH)) continue;
    const was = open;
    if ((open & FLAGGED_WHITE) && !netLeaks(WHITE, occL, occH)) open &= ~FLAGGED_WHITE;
    if ((open & FLAGGED_BLACK) && !netLeaks(BLACK, occL, occH)) open &= ~FLAGGED_BLACK;
    if (boxedRecord && open !== was) boxedRecord.push({ ...levelSets(frL, frH), boxed: [netBoxedL, netBoxedH], still: [netStillL, netStillH] });
  }
  return ask & ~open;
}

/** The lock detector: can `flagged` never be mated, by the structure of pawns, kings and bishops? */
export function lockTest(pos, flagged) {
  const after = forcedStep(pos);
  if (after !== null) return lockTest(after, flagged);
  const lo = pos.lo, hi = pos.hi;
  // A knight, rook or queen on the board (the usual case in a game: tested first): only boxed ones may stay.
  if (lo[WHITE | KNIGHT] | hi[WHITE | KNIGHT] | lo[BLACK | KNIGHT] | hi[BLACK | KNIGHT] |
      lo[WHITE | ROOK] | hi[WHITE | ROOK] | lo[BLACK | ROOK] | hi[BLACK | ROOK] |
      lo[WHITE | QUEEN] | hi[WHITE | QUEEN] | lo[BLACK | QUEEN] | hi[BLACK | QUEEN])
    return boxedTest(pos, flagged === WHITE ? FLAGGED_WHITE : FLAGGED_BLACK) !== 0;
  if (pos.ep !== NO_SQUARE) return false;
  if (takeCensusPairs(pos)) return lockTestPairsFirst(flagged === WHITE ? FLAGGED_WHITE : FLAGGED_BLACK) !== 0 || materStuck(pos, flagged);
  if (!lockLeaks(flagged, 0, 0)) return true;
  return lockTestRest(flagged === WHITE ? FLAGGED_WHITE : FLAGGED_BLACK) !== 0 || materStuck(pos, flagged);
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
export function lockSets(pos, flagged, first = false) {
  if (first) {               // the first version's certificate: its detector, without the second version's rules
    if (!coreLockTest(pos, flagged)) return null;
    takeCensus(pos);
    GUARD = false;
    try { return levelsSets(flagged, frozenLevels()); } finally { GUARD = true; }
  }
  if (!lockTest(pos, flagged)) return tempoStalemate(pos, flagged) ? { tempo: true } : null;
  // The forced step: the certificate of the position after it.
  const after = forcedStep(pos);
  if (after !== null) return { forced: lockSets(after, flagged) };
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
  const levels = frozenLevels(), sets = levelsSets(flagged, levels);
  if (sets) return sets;
  // Proven by the open-pair rule: every family of the level that proves it.
  const k = gapPairs(), bit = flagged === WHITE ? FLAGGED_WHITE : FLAGGED_BLACK;
  for (const [frL, frH] of levels) {
    gapRecord = [];
    const ok = k <= MAX_GAP_PAIRS && gapLevel(bit, k, frL, frH) === bit;
    const families = gapRecord; gapRecord = null;
    if (ok) return { families, frozen: [frL, frH] };
  }
  // Proven by the stuck mater: no sets, the game ends at the mater's next turn.
  if (materStuck(pos, flagged)) return { stuck: true };
  throw new Error('lockSets: the lock test and its levels disagree');
}

/** The levels a certificate may come from (from the census): both kings free, then each king frozen
    whose neighbours some pawn holds or attacks. */
function frozenLevels() {
  const c = census;
  const wpL = c[C_WHITE_PAWNS], wpH = c[C_WHITE_PAWNS + 1], bpL = c[C_BLACK_PAWNS], bpH = c[C_BLACK_PAWNS + 1];
  const pawnL = northLo(wpL) | southLo(bpL, bpH), pawnH = northHi(wpL, wpH) | southHi(bpH);
  const heldL = wpL | bpL | sideways(pawnL), heldH = wpH | bpH | sideways(pawnH);
  const levels = [[0, 0]];
  for (let kingAt = C_WHITE_KING; kingAt <= C_BLACK_KING; kingAt += 2) {
    const kL = c[kingAt], kH = c[kingAt + 1], sq = firstSquare(kL, kH);
    if (!((KING_STEPS[2 * sq] & ~heldL) | (KING_STEPS[2 * sq + 1] & ~heldH))) levels.push([kL, kH]);
  }
  return levels;
}
/** The sets of the first level that proves the lock, or null. */
function levelsSets(flagged, levels) {
  for (const [frL, frH] of levels) {
    if (lockLeaks(flagged, frL, frH)) continue;
    return levelSets(frL, frH);
  }
  return null;
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
  GUARD = false;
  try {
    if (!lockLeaks(flagged, 0, 0)) return true;
    return lockTestRest(flagged === WHITE ? FLAGGED_WHITE : FLAGGED_BLACK) !== 0;
  } finally { GUARD = true; }
}


/* ─── The stuck mater (second version) ─────────────────────────────────────────────────────

   With the flagged side to move, the game may end at the mater's very next turn: whatever the
   flagged side plays, the mater has no legal move (a stalemate, or a mate of the mater). Then the
   flagged side is never mated. Proven from the bitboards alone, for kings and pawns (no bishop):
     - the flagged side has no pawn capture now (so its pawns that cannot push stay where they are);
     - every pawn of the mater's is blocked by a man that stays (a flagged pawn, which cannot leave
       without a capture, or a man of its own) and attacks no flagged man;
     - each square next to the mater's king holds a man of its own, or is attacked by a flagged pawn
       that has no move now, or holds a flagged pawn defended by such a pawn;
     - no push of the flagged side's lands where a mater's pawn attacks or next to the mater's king,
       and no double push gives the mater an en passant capture;
     - the flagged side is not mated now: in a pawn's check, its king has a square to step to.
   One flagged move, then a mater without a move: nothing is searched. */
export function materStuck(pos, flagged) {
  if (pos.side !== flagged || !GUARD || pos.ep !== NO_SQUARE) return false;   // an en passant capture is a move too
  const lo = pos.lo, hi = pos.hi, mater = flagged ^ WHITE;
  // kings and pawns only
  if (lo[WHITE | BISHOP] | hi[WHITE | BISHOP] | lo[BLACK | BISHOP] | hi[BLACK | BISHOP] |
      lo[WHITE | KNIGHT] | hi[WHITE | KNIGHT] | lo[BLACK | KNIGHT] | hi[BLACK | KNIGHT] |
      lo[WHITE | ROOK] | hi[WHITE | ROOK] | lo[BLACK | ROOK] | hi[BLACK | ROOK] |
      lo[WHITE | QUEEN] | hi[WHITE | QUEEN] | lo[BLACK | QUEEN] | hi[BLACK | QUEEN]) return false;
  const white = flagged === WHITE;
  const fpL = lo[flagged | PAWN], fpH = hi[flagged | PAWN], mpL = lo[mater | PAWN], mpH = hi[mater | PAWN];
  const fkL = lo[flagged | KING], fkH = hi[flagged | KING], mkL = lo[mater | KING], mkH = hi[mater | KING];
  const occL = fpL | mpL | fkL | mkL, occH = fpH | mpH | fkH | mkH;
  // A mater's pawn with an empty square in front can never be stuck (rule 2 below); then only a flagged
  // side that is stalemated now is left to find, which a flagged push rules out at once.
  const freeL = white ? southLo(mpL, mpH) & ~occL : northLo(mpL) & ~occL, freeH = white ? southHi(mpH) & ~occH : northHi(mpL, mpH) & ~occH;
  if (freeL | freeH) {
    const fwL = white ? northLo(fpL) : southLo(fpL, fpH), fwH = white ? northHi(fpL, fpH) : southHi(fpH);
    if ((fwL & ~occL) | (fwH & ~occH)) return false;
  }
  // pawn attacks (White's go north, Black's south) and forward squares
  const fAtkL = white ? sideways(northLo(fpL)) : sideways(southLo(fpL, fpH)), fAtkH = white ? sideways(northHi(fpL, fpH)) : sideways(southHi(fpH));
  const mAtkL = white ? sideways(southLo(mpL, mpH)) : sideways(northLo(mpL)), mAtkH = white ? sideways(southHi(mpH)) : sideways(northHi(mpL, mpH));
  const fFwdL = white ? northLo(fpL) : southLo(fpL, fpH), fFwdH = white ? northHi(fpL, fpH) : southHi(fpH);
  const mFwdL = white ? southLo(mpL, mpH) : northLo(mpL), mFwdH = white ? southHi(mpH) : northHi(mpL, mpH);
  // 1. the flagged side has no pawn capture now
  if ((fAtkL & (mpL | mkL)) | (fAtkH & (mpH | mkH))) return false;
  // the flagged pushes: single, and double from the start rank (through rank 3 / 6)
  const sgL = fFwdL & ~occL, sgH = fFwdH & ~occH;
  const dbL = white ? northLo(sgL & 0x00ff0000) & ~occL : southLo(0, sgH & 0x0000ff00) & ~occL;
  const dbH = white ? northHi(sgL & 0x00ff0000, 0) & ~occH : southHi(sgH & 0x0000ff00) & ~occH;
  const pushL = sgL | dbL, pushH = sgH | dbH, pushes = (pushL | pushH) !== 0;
  // the flagged king's steps now (no bishop: exact): not onto its pawns, the mater's pawn attacks, next to the mater's king
  const mk = firstSquare(mkL, mkH), nL = KING_STEPS[2 * mk], nH = KING_STEPS[2 * mk + 1];
  const fk = firstSquare(fkL, fkH);
  const kdL = KING_STEPS[2 * fk] & ~fpL & ~mAtkL & ~nL, kdH = KING_STEPS[2 * fk + 1] & ~fpH & ~mAtkH & ~nH;
  const inCheck = ((fkL & mAtkL) | (fkH & mAtkH)) !== 0;
  if (inCheck && !(kdL | kdH)) return false;                       // mated now (a pawn's check is met by the king alone here)
  const stays = pushes && !inCheck;                                // a pawn moves instead: the king stays
  if (!(kdL | kdH) && !stays) return true;                         // no legal move, no check: stalemate now
  // where the flagged king may stand after its move, and the squares next to all of them
  let covL = -1, covH = -1;
  if (stays) { covL &= KING_STEPS[2 * fk]; covH &= KING_STEPS[2 * fk + 1]; }
  for (let xL = kdL, xH = kdH; xL | xH;) {
    let d; if (xL) { d = 31 - Math.clz32(xL & -xL); xL &= xL - 1; } else { d = 63 - Math.clz32(xH & -xH); xH &= xH - 1; }
    covL &= KING_STEPS[2 * d]; covH &= KING_STEPS[2 * d + 1];
  }
  // 2. the mater's pawns: blocked by men that stay (pawns, its own king; the flagged king only if it never moves)
  const kingFixed = !(kdL | kdH);
  const blkL = fpL | mpL | mkL | (kingFixed ? fkL : 0), blkH = fpH | mpH | mkH | (kingFixed ? fkH : 0);
  if ((mFwdL & ~blkL) | (mFwdH & ~blkH)) return false;
  if ((mAtkL & fpL) | (mAtkH & fpH)) return false;                 // and they attack no flagged pawn
  // the flagged pawns that cannot move this turn (forward square occupied) keep their attacks
  const stL = fpL & (white ? southLo(fFwdL & occL, fFwdH & occH) : northLo(fFwdL & occL)),
        stH = fpH & (white ? southHi(fFwdH & occH) : northHi(fFwdL & occL, fFwdH & occH));
  const sAtkL = white ? sideways(northLo(stL)) : sideways(southLo(stL, stH)), sAtkH = white ? sideways(northHi(stL, stH)) : sideways(southHi(stH));
  // 3. every square next to the mater's king: its own pawn, attacked by such a pawn, or next to the flagged king wherever it goes
  const okL = mpL | sAtkL | covL, okH = mpH | sAtkH | covH;
  if ((nL & ~okL) | (nH & ~okH)) return false;
  // 4. no push lands where a mater's pawn attacks or next to its king, and no double push allows en passant
  if ((pushL & (mAtkL | nL)) | (pushH & (mAtkH | nH))) return false;
  if ((dbL & sideways(mpL)) | (dbH & sideways(mpH))) return false;
  return true;
}


/* ─── The stuck mater, move by move (the second version) ──────────────────────────────────

   With the flagged side to move and a mater of a king and pawns only: when every move of the
   flagged side leaves the mater without a legal move, the game ends at the mater's turn (a
   stalemate, or a mate of the mater) and the flagged side is never mated. There a search with
   many flagged moves (a bishop free to go anywhere, a king free to step) runs out of its budget
   before it has tried them all, though each is over at once: the lock-like rows of group D
   (chasolver's list of 19 November: 183 rows, 175 of them proven here; of the 8 left, in 6 one
   move leads to a lock, in 2 the mater has a bishop).

   Decided on the bitboards; no move is made and no position searched. With a mater of a king and
   pawns no flagged man is pinned, and the flagged king's steps are exact: not onto its own men,
   not where a mater pawn or the mater's king attacks. In a pawn's check the flagged side has those
   steps and the captures of the checking pawn (en passant too). For each move the bitboards after
   it are written out, and the mater's legal moves looked for: a king's step to a square the
   flagged side neither attacks nor defends, its sliders seeing through the king's own square; a
   pawn's push, capture or en passant capture, a pinned pawn only along its pin, and in check only
   onto the checking man or between it and the king. The en passant capture is counted even where
   a horizontal pin forbids it, so the answer "stuck" is always right. No answer (false) with a
   castling right of the flagged side's, two mater pawns with an empty square ahead, or two flagged
   men a mater pawn can take (no single move mends either). */

/* the bitboards after a flagged move, and the lines a pinned mater pawn may move along */
const AFTER_LO = new Int32Array(16), AFTER_HI = new Int32Array(16);
const PIN_LO = new Int32Array(64), PIN_HI = new Int32Array(64);
/* the squares a pawn of colour `white` attacks from the squares of (lo, hi): through pawnLo / pawnHi */
let pawnLo = 0, pawnHi = 0;
function pawnAttacks(lo, hi, white) {
  if (white) { pawnLo = sideways(northLo(lo)); pawnHi = sideways(northHi(lo, hi)); }
  else { pawnLo = sideways(southLo(lo, hi)); pawnHi = sideways(southHi(hi)); }
}
/* every square colour `by` attacks or defends with the bitboards (lo, hi), the board occupied as
   (occLo, occHi): through atkLo / atkHi */
let atkLo = 0, atkHi = 0;
function attackSet(lo, hi, by, occLo, occHi) {
  pawnAttacks(lo[by | PAWN], hi[by | PAWN], by === WHITE);
  let aL = pawnLo, aH = pawnHi;
  const k = 2 * firstSquare(lo[by | KING], hi[by | KING]);
  aL |= KING_STEPS[k]; aH |= KING_STEPS[k + 1];
  let sL = lo[by | KNIGHT], sH = hi[by | KNIGHT];
  while (sL | sH) {
    let q; if (sL) { q = lowestBit(sL); sL &= sL - 1; } else { q = 32 + lowestBit(sH); sH &= sH - 1; }
    aL |= KNIGHT_STEPS[2 * q]; aH |= KNIGHT_STEPS[2 * q + 1];
  }
  sL = lo[by | BISHOP] | lo[by | QUEEN]; sH = hi[by | BISHOP] | hi[by | QUEEN];
  while (sL | sH) {
    let q; if (sL) { q = lowestBit(sL); sL &= sL - 1; } else { q = 32 + lowestBit(sH); sH &= sH - 1; }
    bishopRay(q, occLo, occHi); aL |= rayLo; aH |= rayHi;
  }
  sL = lo[by | ROOK] | lo[by | QUEEN]; sH = hi[by | ROOK] | hi[by | QUEEN];
  while (sL | sH) {
    let q; if (sL) { q = lowestBit(sL); sL &= sL - 1; } else { q = 32 + lowestBit(sH); sH &= sH - 1; }
    rookRay(q, occLo, occHi); aL |= rayLo; aH |= rayHi;
  }
  atkLo = aL; atkHi = aH;
}

/** Has the mater (a king and pawns, to move) a legal move, with the bitboards AFTER_LO / AFTER_HI?
    ep: the square behind a flagged double step, where a mater pawn beside it may capture en
    passant (-1: none). */
function materCanMove(flagged, ep) {
  const lo = AFTER_LO, hi = AFTER_HI, mater = flagged ^ WHITE, mw = mater === WHITE;
  const mpL = lo[mater | PAWN], mpH = hi[mater | PAWN], mkL = lo[mater | KING], mkH = hi[mater | KING];
  const occL = lo[0] | lo[8], occH = hi[0] | hi[8];
  const k = firstSquare(mkL, mkH);
  // the king: a step to a square the flagged side neither attacks nor defends
  const frL = KING_STEPS[2 * k] & ~lo[mater], frH = KING_STEPS[2 * k + 1] & ~hi[mater];
  if (frL | frH) {
    attackSet(lo, hi, flagged, occL & ~mkL, occH & ~mkH);
    if ((frL & ~atkLo) | (frH & ~atkHi)) return true;
  }
  if (!(mpL | mpH)) return false;
  // checks on the mater's king, and the squares that answer one
  const dL = lo[flagged | BISHOP] | lo[flagged | QUEEN], dH = hi[flagged | BISHOP] | hi[flagged | QUEEN];
  const oL = lo[flagged | ROOK] | lo[flagged | QUEEN], oH = hi[flagged | ROOK] | hi[flagged | QUEEN];
  pawnAttacks(mkL, mkH, mw);
  let cL = (pawnLo & lo[flagged | PAWN]) | (KNIGHT_STEPS[2 * k] & lo[flagged | KNIGHT]);
  let cH = (pawnHi & hi[flagged | PAWN]) | (KNIGHT_STEPS[2 * k + 1] & hi[flagged | KNIGHT]);
  bishopRay(k, occL, occH); cL |= rayLo & dL; cH |= rayHi & dH;
  rookRay(k, occL, occH); cL |= rayLo & oL; cH |= rayHi & oH;
  const checks = popcount(cL) + popcount(cH);
  if (checks >= 2) return false;
  let evL = -1, evH = -1;
  if (checks) { const j = 2 * (64 * k + firstSquare(cL, cH)); evL = BETWEEN[j] | cL; evH = BETWEEN[j + 1] | cH; }
  // pins: a flagged slider on a line through the king with one man between, a mater pawn
  let pinL = 0, pinH = 0;
  bishopRay(k, 0, 0); let sL = rayLo & dL, sH = rayHi & dH;
  rookRay(k, 0, 0); sL |= rayLo & oL; sH |= rayHi & oH;
  while (sL | sH) {
    let q; if (sL) { q = lowestBit(sL); sL &= sL - 1; } else { q = 32 + lowestBit(sH); sH &= sH - 1; }
    const j = 2 * (64 * k + q), bl = BETWEEN[j] & occL, bh = BETWEEN[j + 1] & occH;
    if (popcount(bl) + popcount(bh) === 1 && ((bl & mpL) | (bh & mpH))) {
      const p = firstSquare(bl, bh);
      pinL |= bl; pinH |= bh; PIN_LO[p] = LINE[j]; PIN_HI[p] = LINE[j + 1];
    }
  }
  // the pawns
  const fL = lo[flagged], fH = hi[flagged];
  const epL = ep >= 0 && ep < 32 ? 1 << ep : 0, epH = ep >= 32 ? 1 << (ep - 32) : 0;
  let psL = mpL, psH = mpH;
  while (psL | psH) {
    let p; if (psL) { p = lowestBit(psL); psL &= psL - 1; } else { p = 32 + lowestBit(psH); psH &= psH - 1; }
    const bL = p < 32 ? 1 << p : 0, bH = p >= 32 ? 1 << (p - 32) : 0;
    let oneL, oneH;
    if (mw) { oneL = northLo(bL) & ~occL; oneH = northHi(bL, bH) & ~occH; }
    else { oneL = southLo(bL, bH) & ~occL; oneH = southHi(bH) & ~occH; }
    let twoL = 0, twoH = 0;
    if (mw ? (bL & 0x0000ff00) : (bH & 0x00ff0000)) {
      if (mw) { twoL = northLo(oneL) & ~occL; twoH = northHi(oneL, oneH) & ~occH; }
      else { twoL = southLo(oneL, oneH) & ~occL; twoH = southHi(oneH) & ~occH; }
    }
    pawnAttacks(bL, bH, mw);
    let tL = oneL | twoL | (pawnLo & fL), tH = oneH | twoH | (pawnHi & fH);
    let eL = pawnLo & epL, eH = pawnHi & epH;
    if ((bL & pinL) | (bH & pinH)) { tL &= PIN_LO[p]; tH &= PIN_HI[p]; eL &= PIN_LO[p]; eH &= PIN_HI[p]; }
    tL &= evL; tH &= evH;
    // en passant answers a check by the double-stepped pawn too
    if ((eL | eH) && checks) {
      const vL = mw ? southLo(eL, eH) : northLo(eL), vH = mw ? southHi(eH) : northHi(eL, eH);
      if (!((cL & vL) | (cH & vH)) && !((evL & eL) | (evH & eH))) { eL = 0; eH = 0; }
    }
    if (tL | tH | eL | eH) return true;
  }
  return false;
}

/** One flagged move written into AFTER_LO / AFTER_HI: from → to by a man of type `type`, which is a
    man of type `now` on `to` (a promotion), `double` a pawn's double step, `epcap` an en passant
    capture. Returns: does the mater have a legal move after it? */
function afterMove(pos, flagged, from, to, type, now, double, epcap, quiet = false) {
  const mater = flagged ^ WHITE, mw = mater === WHITE;
  AFTER_LO.set(pos.lo); AFTER_HI.set(pos.hi);
  const fL = from < 32 ? 1 << from : 0, fH = from >= 32 ? 1 << (from - 32) : 0;
  const tL = to < 32 ? 1 << to : 0, tH = to >= 32 ? 1 << (to - 32) : 0;
  AFTER_LO[flagged | type] ^= fL; AFTER_HI[flagged | type] ^= fH; AFTER_LO[flagged] ^= fL; AFTER_HI[flagged] ^= fH;
  // a capture takes a mater pawn (en passant: the one beside the double-stepped square)
  let xL, xH;
  if (epcap) { if (mw) { xL = northLo(tL); xH = northHi(tL, tH); } else { xL = southLo(tL, tH); xH = southHi(tH); } }
  else { xL = tL & AFTER_LO[mater]; xH = tH & AFTER_HI[mater]; }
  AFTER_LO[mater | PAWN] &= ~xL; AFTER_HI[mater | PAWN] &= ~xH; AFTER_LO[mater] &= ~xL; AFTER_HI[mater] &= ~xH;
  AFTER_LO[flagged | now] |= tL; AFTER_HI[flagged | now] |= tH; AFTER_LO[flagged] |= tL; AFTER_HI[flagged] |= tH;
  if (materCanMove(flagged, double ? (from + to) >> 1 : -1)) return true;
  if (!quiet) return false;
  // quiet: the move must not give check either (a check without an answer would be a mate)
  attackSet(AFTER_LO, AFTER_HI, flagged, AFTER_LO[0] | AFTER_LO[8], AFTER_HI[0] | AFTER_HI[8]);
  return ((atkLo & AFTER_LO[mater | KING]) | (atkHi & AFTER_HI[mater | KING])) !== 0;
}

/** The stuck mater, move by move: with `flagged` to move and the mater a king and pawns, does every
    legal move of the flagged side leave the mater without a legal move? (No legal move now: true
    when it is a stalemate, false when a mate.) With quiet (the stalemated flagged side, the roles
    swapped): must every move also give no check, a stalemate each? Then the quick refusals below
    are left out and a double check is answered exactly, so the answer is exact; no legal move now
    is true (the game is over, and the side not to move was not mated), and quietAny says whether
    there was one. */
let quietAny = false;
export function stuckEvery(pos, flagged, quiet = false) {
  if (pos.side !== flagged) return false;
  const lo = pos.lo, hi = pos.hi, mater = flagged ^ WHITE, mw = mater === WHITE, fw = !mw;
  const mpL = lo[mater | PAWN], mpH = hi[mater | PAWN], mkL = lo[mater | KING], mkH = hi[mater | KING];
  if (lo[mater] !== (mpL | mkL) || hi[mater] !== (mpH | mkH)) return false;
  if (pos.castling & (fw ? 3 : 12)) return false;
  const occL = lo[0] | lo[8], occH = hi[0] | hi[8];
  pawnAttacks(mpL, mpH, mw);
  const maL = pawnLo, maH = pawnHi;
  // two mater pawns with an empty square ahead, two flagged men a mater pawn can take: no single move mends either
  if (!quiet) {
    const aL = mw ? northLo(mpL) : southLo(mpL, mpH), aH = mw ? northHi(mpL, mpH) : southHi(mpH);
    if (popcount(aL & ~occL) + popcount(aH & ~occH) >= 2) return false;
    if (popcount(maL & lo[flagged]) + popcount(maH & hi[flagged]) >= 2) return false;
  }
  const fkL = lo[flagged | KING], fkH = hi[flagged | KING], fk = firstSquare(fkL, fkH), mk = firstSquare(mkL, mkH);
  const matL = maL | KING_STEPS[2 * mk], matH = maH | KING_STEPS[2 * mk + 1];
  // a pawn's check on the flagged king: then its steps and the captures of the checking pawn
  pawnAttacks(fkL, fkH, fw);
  const ckL = pawnLo & mpL, ckH = pawnHi & mpH, check = (ckL | ckH) !== 0, double = popcount(ckL) + popcount(ckH) >= 2;
  if (double && !quiet) return false;
  // in check only the king's steps and the captures of the checking pawn (in a double check, the steps only)
  const mskL = check ? (double ? 0 : ckL) : -1, mskH = check ? (double ? 0 : ckH) : -1;
  const ownL = lo[flagged], ownH = hi[flagged];
  let any = false, tL, tH;
  // the king
  tL = KING_STEPS[2 * fk] & ~ownL & ~matL; tH = KING_STEPS[2 * fk + 1] & ~ownH & ~matH;
  while (tL | tH) {
    let to; if (tL) { to = lowestBit(tL); tL &= tL - 1; } else { to = 32 + lowestBit(tH); tH &= tH - 1; }
    any = true; if (afterMove(pos, flagged, fk, to, KING, KING, false, false, quiet)) return false;
  }
  // knights, bishops, rooks, queens
  for (const type of [KNIGHT, BISHOP, ROOK, QUEEN]) {
    let sL = lo[flagged | type], sH = hi[flagged | type];
    while (sL | sH) {
      let from; if (sL) { from = lowestBit(sL); sL &= sL - 1; } else { from = 32 + lowestBit(sH); sH &= sH - 1; }
      if (type === KNIGHT) { tL = KNIGHT_STEPS[2 * from]; tH = KNIGHT_STEPS[2 * from + 1]; }
      else if (type === BISHOP) { bishopRay(from, occL, occH); tL = rayLo; tH = rayHi; }
      else if (type === ROOK) { rookRay(from, occL, occH); tL = rayLo; tH = rayHi; }
      else { bishopRay(from, occL, occH); tL = rayLo; tH = rayHi; rookRay(from, occL, occH); tL |= rayLo; tH |= rayHi; }
      tL &= ~ownL & mskL; tH &= ~ownH & mskH;
      while (tL | tH) {
        let to; if (tL) { to = lowestBit(tL); tL &= tL - 1; } else { to = 32 + lowestBit(tH); tH &= tH - 1; }
        any = true; if (afterMove(pos, flagged, from, to, type, type, false, false, quiet)) return false;
      }
    }
  }
  // the pawns: pushes (none in check), captures, en passant (in check only of the checking pawn)
  const epL = pos.ep !== NO_SQUARE && pos.ep < 32 ? 1 << pos.ep : 0, epH = pos.ep >= 32 ? 1 << (pos.ep - 32) : 0;
  let okEpL = epL, okEpH = epH;
  if (check && (epL | epH)) {
    const vL = fw ? southLo(epL, epH) : northLo(epL), vH = fw ? southHi(epH) : northHi(epL, epH);
    if (double || !((vL & ckL) | (vH & ckH))) { okEpL = 0; okEpH = 0; }
  }
  let psL = lo[flagged | PAWN], psH = hi[flagged | PAWN];
  while (psL | psH) {
    let from; if (psL) { from = lowestBit(psL); psL &= psL - 1; } else { from = 32 + lowestBit(psH); psH &= psH - 1; }
    const bL = from < 32 ? 1 << from : 0, bH = from >= 32 ? 1 << (from - 32) : 0;
    let oneL = 0, oneH = 0, twoL = 0, twoH = 0;
    if (!check) {
      if (fw) { oneL = northLo(bL) & ~occL; oneH = northHi(bL, bH) & ~occH; }
      else { oneL = southLo(bL, bH) & ~occL; oneH = southHi(bH) & ~occH; }
      if (fw ? (bL & 0x0000ff00) : (bH & 0x00ff0000)) {
        if (fw) { twoL = northLo(oneL) & ~occL; twoH = northHi(oneL, oneH) & ~occH; }
        else { twoL = southLo(oneL, oneH) & ~occL; twoH = southHi(oneH) & ~occH; }
      }
    }
    pawnAttacks(bL, bH, fw);
    const cpL = pawnLo & lo[mater] & mskL, cpH = pawnHi & hi[mater] & mskH;
    const epcL = pawnLo & okEpL, epcH = pawnHi & okEpH;
    tL = oneL | twoL | cpL | epcL; tH = oneH | twoH | cpH | epcH;
    while (tL | tH) {
      let to; if (tL) { to = lowestBit(tL); tL &= tL - 1; } else { to = 32 + lowestBit(tH); tH &= tH - 1; }
      any = true;
      const toL = to < 32 ? 1 << to : 0, toH = to >= 32 ? 1 << (to - 32) : 0;
      if (to < 8 || to > 55) {
        for (const now of [QUEEN, ROOK, BISHOP, KNIGHT]) if (afterMove(pos, flagged, from, to, PAWN, now, false, false, quiet)) return false;
      } else if (afterMove(pos, flagged, from, to, PAWN, PAWN, ((toL & twoL) | (toH & twoH)) !== 0, ((toL & epcL) | (toH & epcH)) !== 0, quiet)) return false;
    }
  }
  quietAny = any;
  return quiet || any || !check;
}

/* ─── The stalemated flagged side (the second version) ─────────────────────────────────────

   The other way round from the stuck mater: whatever the mater plays, the flagged side is left
   without a legal move and not in check, a stalemate, so the flagged side is never mated. The
   flagged side has its king and pawns only, the mater no knight, rook or queen, and no en passant
   right stands. With the mater to move: it has a legal move, and after each one the flagged side
   has none and stands in no check (stuckEvery with the roles swapped, quiet). With the flagged
   side to move: it has exactly one legal move (the tempo: a king or pawn with one move left, a
   promotion counting four), and after it every move of the mater's, if it has any, leaves the
   flagged side so (with none, that one move ended the game: a stalemate, or a mate of the mater).
   Exact for these men: the flagged side
   pins nothing and checks only with a pawn, so the mater's moves are counted exactly; the
   mater's bishops pin and check along the diagonals, and the flagged side's moves are counted
   with them. */
const TEMPO_LO = new Int32Array(16), TEMPO_HI = new Int32Array(16);
const TEMPO = { lo: TEMPO_LO, hi: TEMPO_HI, ep: NO_SQUARE, side: WHITE, castling: 0 };
/* the one legal move kpMoves found (from, to, a double step, an en passant capture) */
let oneFrom = 0, oneTo = 0, oneDouble = false, oneEp = false;

/** The legal moves of a side of a king and pawns, to move, with the bitboards (lo, hi) and the en
    passant square ep (NO_SQUARE: none): counted up to two (a promotion counts four), the first
    kept in oneFrom … oneEp. Exact as materCanMove is: pins along the lines to the king, checks
    answered by the king, by taking the checking man or by stepping between; only an en passant
    capture is counted even where it would uncover a check (one move too many refuses a proof,
    never makes one). */
function kpMoves(lo, hi, side, ep) {
  const opp = side ^ WHITE, sw = side === WHITE;
  const spL = lo[side | PAWN], spH = hi[side | PAWN], skL = lo[side | KING], skH = hi[side | KING];
  const occL = lo[0] | lo[8], occH = hi[0] | hi[8];
  const k = firstSquare(skL, skH);
  let n = 0;
  const one = (from, to, d, e) => { if (!n) { oneFrom = from; oneTo = to; oneDouble = d; oneEp = e; } n++; };
  // the king: a step to a square the other side neither attacks nor defends (its sliders see through the king)
  let tL = KING_STEPS[2 * k] & ~lo[side], tH = KING_STEPS[2 * k + 1] & ~hi[side];
  if (tL | tH) {
    attackSet(lo, hi, opp, occL & ~skL, occH & ~skH);
    tL &= ~atkLo; tH &= ~atkHi;
    while (tL | tH) {
      let to; if (tL) { to = lowestBit(tL); tL &= tL - 1; } else { to = 32 + lowestBit(tH); tH &= tH - 1; }
      one(k, to, false, false); if (n >= 2) return n;
    }
  }
  if (!(spL | spH)) return n;
  // checks on the king, and the squares that answer one
  const dL = lo[opp | BISHOP] | lo[opp | QUEEN], dH = hi[opp | BISHOP] | hi[opp | QUEEN];
  const oL = lo[opp | ROOK] | lo[opp | QUEEN], oH = hi[opp | ROOK] | hi[opp | QUEEN];
  pawnAttacks(skL, skH, sw);
  let cL = (pawnLo & lo[opp | PAWN]) | (KNIGHT_STEPS[2 * k] & lo[opp | KNIGHT]);
  let cH = (pawnHi & hi[opp | PAWN]) | (KNIGHT_STEPS[2 * k + 1] & hi[opp | KNIGHT]);
  bishopRay(k, occL, occH); cL |= rayLo & dL; cH |= rayHi & dH;
  rookRay(k, occL, occH); cL |= rayLo & oL; cH |= rayHi & oH;
  const checks = popcount(cL) + popcount(cH);
  if (checks >= 2) return n;
  let evL = -1, evH = -1;
  if (checks) { const j = 2 * (64 * k + firstSquare(cL, cH)); evL = BETWEEN[j] | cL; evH = BETWEEN[j + 1] | cH; }
  // pins: a slider of the other side on a line through the king with one man between, a pawn of this side
  let pinL = 0, pinH = 0;
  bishopRay(k, 0, 0); let sL = rayLo & dL, sH = rayHi & dH;
  rookRay(k, 0, 0); sL |= rayLo & oL; sH |= rayHi & oH;
  while (sL | sH) {
    let q; if (sL) { q = lowestBit(sL); sL &= sL - 1; } else { q = 32 + lowestBit(sH); sH &= sH - 1; }
    const j = 2 * (64 * k + q), bl = BETWEEN[j] & occL, bh = BETWEEN[j + 1] & occH;
    if (popcount(bl) + popcount(bh) === 1 && ((bl & spL) | (bh & spH))) {
      const p = firstSquare(bl, bh);
      pinL |= bl; pinH |= bh; PIN_LO[p] = LINE[j]; PIN_HI[p] = LINE[j + 1];
    }
  }
  // the pawns
  const xL = lo[opp], xH = hi[opp];
  const epL = ep !== NO_SQUARE && ep < 32 ? 1 << ep : 0, epH = ep !== NO_SQUARE && ep >= 32 ? 1 << (ep - 32) : 0;
  let psL = spL, psH = spH;
  while (psL | psH) {
    let p; if (psL) { p = lowestBit(psL); psL &= psL - 1; } else { p = 32 + lowestBit(psH); psH &= psH - 1; }
    const bL = p < 32 ? 1 << p : 0, bH = p >= 32 ? 1 << (p - 32) : 0;
    let oneL, oneH;
    if (sw) { oneL = northLo(bL) & ~occL; oneH = northHi(bL, bH) & ~occH; }
    else { oneL = southLo(bL, bH) & ~occL; oneH = southHi(bH) & ~occH; }
    let twoL = 0, twoH = 0;
    if (sw ? (bL & 0x0000ff00) : (bH & 0x00ff0000)) {
      if (sw) { twoL = northLo(oneL) & ~occL; twoH = northHi(oneL, oneH) & ~occH; }
      else { twoL = southLo(oneL, oneH) & ~occL; twoH = southHi(oneH) & ~occH; }
    }
    pawnAttacks(bL, bH, sw);
    let mL = oneL | twoL | (pawnLo & xL), mH = oneH | twoH | (pawnHi & xH);
    let eL = pawnLo & epL, eH = pawnHi & epH;
    if ((bL & pinL) | (bH & pinH)) { mL &= PIN_LO[p]; mH &= PIN_HI[p]; eL &= PIN_LO[p]; eH &= PIN_HI[p]; }
    mL &= evL; mH &= evH;
    // en passant answers a check by the double-stepped pawn too
    if ((eL | eH) && checks) {
      const vL = sw ? southLo(eL, eH) : northLo(eL), vH = sw ? southHi(eH) : northHi(eL, eH);
      if (!((cL & vL) | (cH & vH)) && !((evL & eL) | (evH & eH))) { eL = 0; eH = 0; }
    }
    while (mL | mH) {
      let to; if (mL) { to = lowestBit(mL); mL &= mL - 1; } else { to = 32 + lowestBit(mH); mH &= mH - 1; }
      if (to < 8 || to > 55) { one(p, to, false, false); n += 3; }   // the four promotions
      else one(p, to, ((twoL & (to < 32 ? 1 << to : 0)) | (twoH & (to >= 32 ? 1 << (to - 32) : 0))) !== 0, false);
      if (n >= 2) return n;
    }
    if (eL | eH) { one(p, eL ? lowestBit(eL) : 32 + lowestBit(eH), false, true); if (n >= 2) return n; }
  }
  return n;
}

/** The stalemated flagged side: with the mater to move, has it a legal move, and does each leave the
    flagged side (a king and pawns) without a legal move and not in check? With the flagged side to
    move: has it exactly one legal move, after which every move of the mater's (if any) does that? */
export function tempoStalemate(pos, flagged) {
  const lo = pos.lo, hi = pos.hi, mater = flagged ^ WHITE;
  // the flagged side a king and pawns, the mater without a knight, rook or queen, no en passant right
  if (lo[flagged] !== (lo[flagged | PAWN] | lo[flagged | KING]) || hi[flagged] !== (hi[flagged | PAWN] | hi[flagged | KING])) return false;
  if (lo[mater | KNIGHT] | hi[mater | KNIGHT] | lo[mater | ROOK] | hi[mater | ROOK] | lo[mater | QUEEN] | hi[mater | QUEEN]) return false;
  if (pos.ep !== NO_SQUARE) return false;
  if (pos.side !== flagged) return stuckEvery(pos, mater, true) && quietAny;
  if (kpMoves(lo, hi, flagged, NO_SQUARE) !== 1) return false;
  // the position after the one move, the mater to move
  TEMPO_LO.set(lo); TEMPO_HI.set(hi);
  const fL = oneFrom < 32 ? 1 << oneFrom : 0, fH = oneFrom >= 32 ? 1 << (oneFrom - 32) : 0;
  const tL = oneTo < 32 ? 1 << oneTo : 0, tH = oneTo >= 32 ? 1 << (oneTo - 32) : 0;
  const type = (lo[flagged | KING] & fL) | (hi[flagged | KING] & fH) ? KING : PAWN;
  let vL = tL & lo[mater], vH = tH & hi[mater];                    // a capture
  if (oneEp) { if (flagged === WHITE) { vL = southLo(tL, tH); vH = southHi(tH); } else { vL = northLo(tL); vH = northHi(tL, tH); } }
  for (const t of [PAWN, BISHOP]) { TEMPO_LO[mater | t] &= ~vL; TEMPO_HI[mater | t] &= ~vH; }
  TEMPO_LO[mater] &= ~vL; TEMPO_HI[mater] &= ~vH;
  TEMPO_LO[flagged | type] ^= fL | tL; TEMPO_HI[flagged | type] ^= fH | tH;
  TEMPO_LO[flagged] ^= fL | tL; TEMPO_HI[flagged] ^= fH | tH;
  TEMPO.ep = oneDouble ? (oneFrom + oneTo) >> 1 : NO_SQUARE;
  TEMPO.side = mater;
  TEMPO.castling = pos.castling;
  return stuckEvery(TEMPO, mater, true);
}

/* ─── The forced step (second version) ───────────────────────────────────────────────────────

   The side to move is in a pawn's check and has exactly one legal move: its king's step to one
   square (kings and pawns only, so the steps are exact: not onto its pawns, not where an enemy pawn
   attacks, not next to the enemy king; and no pawn of its own can take a checking pawn). Every line
   goes through that step, and the position is no mate now, so the lock of the position after it
   proves this one. Returns that position (bitboards only), or null. With a bishop, knight, rook or
   queen on the board the steps counted here would not be exact (a piece may hold a square, stand on
   it, or take the checking pawn), so then there is no forced step. */
function forcedStep(pos) {
  if (!GUARD || pos.ep !== NO_SQUARE || !pawnCheck(pos)) return null;
  const lo = pos.lo, hi = pos.hi;
  if (lo[WHITE | BISHOP] | hi[WHITE | BISHOP] | lo[BLACK | BISHOP] | hi[BLACK | BISHOP] |
      lo[WHITE | KNIGHT] | hi[WHITE | KNIGHT] | lo[BLACK | KNIGHT] | hi[BLACK | KNIGHT] |
      lo[WHITE | ROOK] | hi[WHITE | ROOK] | lo[BLACK | ROOK] | hi[BLACK | ROOK] |
      lo[WHITE | QUEEN] | hi[WHITE | QUEEN] | lo[BLACK | QUEEN] | hi[BLACK | QUEEN]) return null;
  const us = pos.side, them = us ^ WHITE, white = us === WHITE;
  const opL = lo[us | PAWN], opH = hi[us | PAWN], epL = lo[them | PAWN], epH = hi[them | PAWN];
  const kL = lo[us | KING], kH = hi[us | KING], k = firstSquare(kL, kH), ek = firstSquare(lo[them | KING], hi[them | KING]);
  const atkL = white ? sideways(southLo(epL, epH)) : sideways(northLo(epL)), atkH = white ? sideways(southHi(epH)) : sideways(northHi(epL, epH));
  const dL = KING_STEPS[2 * k] & ~opL & ~atkL & ~KING_STEPS[2 * ek], dH = KING_STEPS[2 * k + 1] & ~opH & ~atkH & ~KING_STEPS[2 * ek + 1];
  if (!(dL | dH) || popcount(dL) + popcount(dH) !== 1) return null;
  // an own pawn that takes a checking pawn would be a second move
  const chkL = white ? sideways(northLo(kL)) & epL : sideways(southLo(kL, kH)) & epL;
  const chkH = white ? sideways(northHi(kL, kH)) & epH : sideways(southHi(kH)) & epH;
  const tkL = white ? sideways(southLo(chkL, chkH)) & opL : sideways(northLo(chkL)) & opL;
  const tkH = white ? sideways(southHi(chkH)) & opH : sideways(northHi(chkL, chkH)) & opH;
  if (tkL | tkH) return null;
  // the position after the step: the king moved, an enemy pawn on its square taken, the other side to move
  const nlo = Int32Array.from(lo), nhi = Int32Array.from(hi);
  nlo[us | KING] = dL; nhi[us | KING] = dH;
  nlo[us] = (lo[us] & ~kL) | dL; nhi[us] = (hi[us] & ~kH) | dH;
  nlo[them | PAWN] &= ~dL; nhi[them | PAWN] &= ~dH; nlo[them] &= ~dL; nhi[them] &= ~dH;
  return { lo: nlo, hi: nhi, ep: NO_SQUARE, side: them };
}

/** The flagged side cannot be mated: the lock detector certifies it, or the stalemated flagged side. */
export function lockCannotMate(pos, flagged) { return lockTest(pos, flagged) || tempoStalemate(pos, flagged); }
/** The static tests, the first two rungs of the ladder: either of the two (the lock with the stalemated flagged side). */
export function cannotMate(pos, flagged) { return materialTest(pos, flagged) || lockTest(pos, flagged) || tempoStalemate(pos, flagged); }

/** The lock detector for both sides at once: of the sides in `ask` (FLAGGED_* bits), those it
    proves unable to be mated, the same answers as lockTest with each side flagged. A level is
    computed once for both; a side is proven at the first level that does not leak to it. */
export function lockTest2(pos, ask) {
  const after = forcedStep(pos);
  if (after !== null) return lockTest2(after, ask);
  const lo = pos.lo, hi = pos.hi;
  if (lo[WHITE | KNIGHT] | hi[WHITE | KNIGHT] | lo[BLACK | KNIGHT] | hi[BLACK | KNIGHT] |
      lo[WHITE | ROOK] | hi[WHITE | ROOK] | lo[BLACK | ROOK] | hi[BLACK | ROOK] |
      lo[WHITE | QUEEN] | hi[WHITE | QUEEN] | lo[BLACK | QUEEN] | hi[BLACK | QUEEN]) return boxedTest(pos, ask);
  if (pos.ep !== NO_SQUARE) return 0;
  let got;
  if (takeCensusPairs(pos)) got = lockTestPairsFirst(ask);
  else { const open = lockLeaks2(ask, 0, 0); got = !open ? ask : (ask & ~open) | lockTestRest(open); }
  // the stuck mater, for the side to move, when the lock left it open
  const me = pos.side === WHITE ? FLAGGED_WHITE : FLAGGED_BLACK;
  if ((ask & me) && !(got & me) && materStuck(pos, pos.side)) got |= me;
  return got;
}

/** The static tests for both sides at once: of the sides in `ask` (FLAGGED_* bits), those the
    material test or the lock detector proves unable to be mated (cannotMate with each side flagged). */
export function cannotMate2(pos, ask) { return tempo2(pos, ask, staticTests2(pos, ask, TESTS_BOTH)); }

/** Of the sides in `ask` the static tests left open (not in `proven`), those the stalemated flagged
    side proves: `proven` with them. Not part of the static tests inside the search (staticTests,
    staticTests2): a quiet move can complete it, where the search does not ask them. */
export function tempo2(pos, ask, proven) {
  if ((ask & ~proven & FLAGGED_WHITE) && tempoStalemate(pos, WHITE)) proven |= FLAGGED_WHITE;
  if ((ask & ~proven & FLAGGED_BLACK) && tempoStalemate(pos, BLACK)) proven |= FLAGGED_BLACK;
  return proven;
}

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
