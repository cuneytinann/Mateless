//! chasolver's full analysis, line by line: reads lines "<fen>\t<w|b>" from stdin (the second field:
//! the side whose win is tested; in Mateless's files, the side claimed unable to mate) and prints
//! "W" (winnable), "U" (unwinnable), "?" (undecided) or "E" (FEN error) per line.
//!     cargo run --release --example oracle < candidates.txt > verdicts.txt
//! Every line that test/fuzz_lock_gen.js writes must come back "U".
use std::io::{self, BufRead, Write};
use std::str::FromStr;
use chasolver::{winnability, Winnability};
use chess::{Board, Color};

fn main() {
    let stdin = io::stdin();
    let mut out = io::BufWriter::new(io::stdout());
    for line in stdin.lock().lines() {
        let line = line.unwrap();
        let mut it = line.split('\t');
        let fen = it.next().unwrap_or("");
        let color = if it.next() == Some("b") { Color::Black } else { Color::White };
        let verdict = match Board::from_str(fen) {
            Err(_) => "E",
            Ok(b) => match winnability(&b, color) {
                Some(Winnability::Winnable { .. }) => "W",
                Some(Winnability::Unwinnable) => "U",
                None => "?",
            },
        };
        writeln!(out, "{}", verdict).unwrap();
    }
}
