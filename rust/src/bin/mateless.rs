//! Command-line checks of the Rust port against the JavaScript engine.
//!   mateless perft [depth]              perft of the six Chess Programming Wiki positions
//!   mateless layers <chasolver-data.csv>  per row: gameId, layer (material|lock|domino|none), nodes, failure
//!   mateless labels <positions.txt>       per labelled line and flag: line, flag, proven, static, failure, nodes
//!   mateless games <file>                 per line (a game: FENs joined by |): the plies at which the flags came down
//! The JavaScript side of the comparison is test/rust_compare.js, which prints the same lines.
use mateless::*;
use std::io::{BufRead, BufReader, Write};

const CPW: [(&str, [u64; 6]); 6] = [
    ("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", [20, 400, 8902, 197281, 4865609, 119060324]),
    ("r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1", [48, 2039, 97862, 4085603, 193690690, 0]),
    ("8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1", [14, 191, 2812, 43238, 674624, 11030083]),
    ("r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1", [6, 264, 9467, 422333, 15833292, 0]),
    ("rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8", [44, 1486, 62379, 2103487, 89941194, 0]),
    ("r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10", [46, 2079, 89890, 3894594, 164075551, 0]),
];

fn failure(f: Failure) -> &'static str {
    match f { Failure::None => "-", Failure::Mate => "mate", Failure::Horizon => "horizon", Failure::Budget => "budget" }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let out = std::io::stdout();
    let mut out = std::io::BufWriter::new(out.lock());
    init();
    match args.get(1).map(|s| s.as_str()) {
        Some("perft") => {
            let depth: usize = args.get(2).and_then(|d| d.parse().ok()).unwrap_or(5);
            let mut all = true;
            for (fen, counts) in CPW.iter() {
                let pos = from_fen(fen).expect("fen");
                for d in 1..=depth.min(6) {
                    if counts[d - 1] == 0 { continue; }
                    let t = std::time::Instant::now();
                    let n = perft(&pos, d as u32);
                    let ok = n == counts[d - 1];
                    all &= ok;
                    writeln!(out, "{} d{} {} {} {:.3}s", if ok { "ok  " } else { "FAIL" }, d, n, counts[d - 1], t.elapsed().as_secs_f64()).unwrap();
                }
            }
            writeln!(out, "{}", if all { "all counts match" } else { "MISMATCH" }).unwrap();
        }
        Some("layers") => {
            let f = BufReader::new(std::fs::File::open(&args[2]).expect("csv"));
            let mut search = Domino::new();
            for (i, line) in f.lines().enumerate() {
                let line = line.unwrap();
                if i == 0 || line.is_empty() { continue; }
                let cols: Vec<&str> = line.split(',').collect();
                let (id, fen) = (cols[0], cols[12].trim());
                let pos = match from_fen(fen) { Ok(p) => p, Err(e) => { writeln!(out, "{}\tfen-error\t{}\t-", id, e).unwrap(); continue; } };
                let z = pos.side;
                let (layer, nodes, fail) = if material_test(&pos, z) { ("material", 0, Failure::None) }
                    else if cannot_mate(&pos, z) { ("lock", 0, Failure::None) }
                    else {
                        let p = prove_cannot_be_mated(&mut search, &pos, z, DOMINO_PLY, DOMINO_BUDGET);
                        (if p.proven { "domino" } else { "none" }, p.nodes, p.failure)
                    };
                writeln!(out, "{}\t{}\t{}\t{}", id, layer, nodes, failure(fail)).unwrap();
            }
        }
        Some("labels") => {
            let f = BufReader::new(std::fs::File::open(&args[2]).expect("file"));
            let mut search = Domino::new();
            for (i, line) in f.lines().enumerate() {
                let line = line.unwrap();
                if line.len() < 4 || !matches!(&line[..3], "WB " | "W- " | "-B " | "-- ") { continue; }
                let pos = match from_fen(line[3..].trim()) { Ok(p) => p, Err(e) => { writeln!(out, "{}\tfen-error\t{}", i, e).unwrap(); continue; } };
                // Both flags in one pass (prove_both): the same lines as prove_cannot_be_mated for each.
                let both = prove_both(&mut search, &pos, DOMINO_PLY, DOMINO_BUDGET);
                for (flagged, p) in [(WHITE, both[0]), (BLACK, both[1])] {
                    writeln!(out, "{}\t{}\t{}\t{}\t{}\t{}", i, if flagged == WHITE { "w" } else { "b" }, p.proven as u8, p.static_proof as u8,
                             failure(p.failure), p.nodes).unwrap();
                }
            }
        }
        Some("games") => {
            let f = BufReader::new(std::fs::File::open(&args[2]).expect("file"));
            for line in f.lines() {
                let line = line.unwrap();
                if line.is_empty() { continue; }
                let mut flags = Flags::new();
                for (ply, fen) in line.split('|').enumerate() {
                    let pos = from_fen(fen).expect("fen");
                    flags.update(&pos, ply as i64);
                }
                writeln!(out, "{}\t{}", flags.white_down_at, flags.black_down_at).unwrap();
            }
        }
        _ => eprintln!("usage: mateless perft [depth] | mateless layers <csv> | mateless labels <file> | mateless games <file>"),
    }
}
