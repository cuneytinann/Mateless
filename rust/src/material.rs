//! Rung 1, the material test (`src/material.js`): the flagged side can never be mated because the
//! other side has too little material to mate at all. It reads the piece sets only.

use crate::board::{BISHOP, BLACK, DARK_SQUARES, KNIGHT, PAWN, Position, QUEEN, ROOK, WHITE};

/// The material test: the mater lacks the material to mate at all. (materialTest)
pub fn material_test(pos: &Position, flagged: u8) -> bool {
    let b = &pos.bb;
    let mater = flagged ^ WHITE;
    if b[(mater | ROOK) as usize] | b[(mater | QUEEN) as usize] != 0 { return false; }
    let (n, bi) = (b[(mater | KNIGHT) as usize], b[(mater | BISHOP) as usize]);
    if n | bi == 0 { return b[(mater | PAWN) as usize] == 0; }
    if b[(WHITE | PAWN) as usize] | b[(BLACK | PAWN) as usize] != 0 { return false; }
    let knights = b[(flagged | KNIGHT) as usize];
    let fb = b[(flagged | BISHOP) as usize];
    if n != 0 {
        if bi != 0 || n.count_ones() != 1 { return false; }
        return knights | fb | b[(flagged | ROOK) as usize] == 0;
    }
    let (dark, light) = (bi & DARK_SQUARES != 0, bi & !DARK_SQUARES != 0);
    if dark && light { return false; }
    let other = if dark { !DARK_SQUARES } else { DARK_SQUARES };
    knights | (fb & other) == 0
}
