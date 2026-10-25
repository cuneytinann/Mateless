//! The ladder at its defaults (static tests, then the Domino search, 6 plies / 100 nodes) on a file
//! of positions, timed over several rounds (median), with the number proven and the nodes played as
//! a checksum: a faster build must print the same two numbers.
//!   cargo run --release --example dominobench -- <positions> [rounds]     (lines "<fen>\t<w|b>")
use std::io::{BufRead, BufReader};
use std::time::Instant;
fn main() {
    let args: Vec<String> = std::env::args().collect();
    let rounds: usize = args.get(2).and_then(|r| r.parse().ok()).unwrap_or(7);
    let v: Vec<(mateless::Position, u8)> = BufReader::new(std::fs::File::open(&args[1]).unwrap()).lines().filter_map(|l| {
        let l = l.ok()?; let mut it = l.split('\t'); let fen = it.next()?; let w = it.next()? == "w";
        Some((mateless::from_fen(fen).ok()?, if w { mateless::BLACK } else { mateless::WHITE })) }).collect();
    let mut s = mateless::Domino::new();
    let (mut proven, mut nodes) = (0u64, 0i64);
    for (p, z) in &v { let r = mateless::prove_cannot_be_mated(&mut s, p, *z, mateless::DOMINO_PLY, mateless::DOMINO_BUDGET); if r.proven { proven += 1; } nodes += r.nodes; }
    let mut t = Vec::new();
    for _ in 0..rounds {
        let t0 = Instant::now(); let mut k = 0u64;
        for (p, z) in &v { if mateless::prove_cannot_be_mated(&mut s, p, *z, mateless::DOMINO_PLY, mateless::DOMINO_BUDGET).proven { k += 1; } }
        t.push(t0.elapsed().as_nanos() as f64 / v.len() as f64); assert_eq!(k, proven);
    }
    t.sort_by(|a, b| a.partial_cmp(b).unwrap());
    println!("{:20} {:7} positions  proven {:7}  nodes {:9}  median {:7.1} ns/pos  (best {:.1})", args[1].rsplit('/').next().unwrap(), v.len(), proven, nodes, t[rounds / 2], t[0]);
}
