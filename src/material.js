/* ═══ Mateless · material.js — rung 1: the material test ═══════════════════════════════════

   Can the flagged side never be mated because the other side has too little material to mate at
   all? The first rung of the ladder (ladder.js), and the cheapest: a few reads of the piece sets,
   deciding on the first fact that settles it. Material never grows back (only a promotion adds a
   piece, and it needs a pawn, which the test counts), so a proof holds for the rest of the game.

   From the board it needs the piece sets and the colour of the squares; it generates no move. */

import { BISHOP, BLACK, DARK_SQUARES, isSingle, KNIGHT, PAWN, QUEEN, ROOK, WHITE } from './board.js';

/** The material test. It holds when
      – the mater has nothing but its king; or
      – there are no pawns at all, the mater has bishops of one colour and nothing else, and the
        flagged side has no knight and no bishop of the other colour; or
      – there are no pawns at all, the mater has one knight and nothing else, and the flagged
        side has no bishop, knight or rook (queens do not count).
    Each of those facts is read straight off the bitboards, the commonest first. */
export function materialTest(pos, flagged) {
  const lo = pos.lo, hi = pos.hi, mater = flagged ^ WHITE;
  if (lo[mater | ROOK] | hi[mater | ROOK] | lo[mater | QUEEN] | hi[mater | QUEEN]) return false;   // a rook or a queen
  const nL = lo[mater | KNIGHT], nH = hi[mater | KNIGHT], bL = lo[mater | BISHOP], bH = hi[mater | BISHOP];
  if (!(nL | nH | bL | bH)) return !(lo[mater | PAWN] | hi[mater | PAWN]);                          // king (and pawns)
  if (lo[WHITE | PAWN] | hi[WHITE | PAWN] | lo[BLACK | PAWN] | hi[BLACK | PAWN]) return false;
  const knights = lo[flagged | KNIGHT] | hi[flagged | KNIGHT];
  const fbL = lo[flagged | BISHOP], fbH = hi[flagged | BISHOP];
  if (nL | nH) {
    if (bL | bH || !isSingle(nL, nH)) return false;                                               // more than one knight
    return !(knights | fbL | fbH | lo[flagged | ROOK] | hi[flagged | ROOK]);
  }
  const dark = (bL | bH) & DARK_SQUARES, light = (bL | bH) & ~DARK_SQUARES;   // both words share the pattern
  if (dark && light) return false;                                                                 // bishops on both colours
  const otherColour = dark ? ~DARK_SQUARES : DARK_SQUARES;
  return !(knights | ((fbL | fbH) & otherColour));
}

/** The flagged side cannot be mated: its opponent has too little material. */
export function materialCannotMate(pos, flagged) { return materialTest(pos, flagged); }
