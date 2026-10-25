//! The fast lock fixed point against the reference one: the same verdict for both flags on every
//! position of the given files (lines with a FEN: chasolver-data CSV rows, "<fen>\t<w|b>" lines,
//! chasolver's labelled lines), and in every position reached by random play from them.
//!   cargo run --release --example lockcheck -- <file>...
use std::io::{BufRead, BufReader};
fn fen_of(line: &str) -> Option<String> {
    if line.contains(',') { return line.split(',').nth(12).map(|s| s.trim().to_string()); }
    if line.len() > 3 && matches!(&line[..3], "WB " | "W- " | "-B " | "-- ") { return Some(line[3..].trim().to_string()); }
    line.split('\t').next().map(|s| s.trim().to_string())
}
fn main() {
    let mut n = 0u64; let mut locks = 0u64; let mut seed = 0x1234_5678u64;
    let mut rnd = move |m: usize| { seed ^= seed << 13; seed ^= seed >> 7; seed ^= seed << 17; (seed % m as u64) as usize };
    for f in std::env::args().skip(1) {
        for line in BufReader::new(std::fs::File::open(&f).unwrap()).lines() {
            let line = line.unwrap();
            let Some(fen) = fen_of(&line) else { continue };
            let Ok(mut pos) = mateless::from_fen(&fen) else { continue };
            for ply in 0..24 {
                for flagged in [mateless::WHITE, mateless::BLACK] {
                    let (a, b) = (mateless::lock_test(&pos, flagged), mateless::lock_test_reference(&pos, flagged));
                    assert_eq!(a, b, "lock verdicts differ: {} flagged {}", mateless::placement(&pos), flagged);
                    n += 1; if a { locks += 1; }
                }
                let mut moves = [0u32; mateless::MOVE_STRIDE];
                let k = mateless::generate_legal_moves(&pos, &mut moves);
                if k == 0 || ply == 23 { break; }
                mateless::do_move(&mut pos, moves[rnd(k)], mateless::QUEEN);
            }
        }
    }
    println!("{} side-positions, {} lock certificates, fast = reference everywhere", n, locks);
}
