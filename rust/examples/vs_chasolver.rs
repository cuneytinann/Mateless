//! Mateless (Rust) against chasolver's fast check (`is_unwinnable_fast`), in one process, on the same
//! positions: the boards are parsed once, only the decision is timed. The rows are cut into chunks
//! of 64; every chunk is run by every engine, in an order that rotates from chunk to chunk, so all
//! engines see the same caches and machine load. The median of the rounds is reported, then the
//! slowest single position of each engine (each call timed alone, the fastest of three calls).
//!   cargo run --release --example vs_chasolver -- <positions> [rounds]
//! <positions>: lines "<fen>\t<w|b>", the second field the side that should be unable to mate
//! (chasolver's intended winner; Mateless's flagged side is its opponent).
//! Engines: chasolver fast check; Mateless static tests only; Mateless static tests + Domino search at its
//! defaults (6 plies, 100 nodes); the same with a larger search (9 plies, 2,000 nodes); the whole
//! ladder (prove_cannot_be_mated: the search's second tier too, where it runs).
//! BOTH=1: both sides of every position (a dead position, a game's two flags; the side field is
//! ignored): chasolver's fast check called for each colour; Mateless for each side alone; Mateless both at
//! once (prove_both). "proven" then counts the positions proven for both sides.
use std::io::{BufRead, BufReader};
use std::str::FromStr;
use std::time::Instant;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let file = args.get(1).expect("usage: vs_chasolver <positions> [rounds]");
    let rounds: usize = args.get(2).and_then(|r| r.parse().ok()).unwrap_or(7);
    let mut rows: Vec<(String, bool)> = BufReader::new(std::fs::File::open(file).expect("positions")).lines()
        .filter_map(|l| { let l = l.ok()?; let mut it = l.split('\t'); let fen = it.next()?.to_string(); let w = it.next()? == "w"; Some((fen, w)) })
        .collect();
    // HOT=n: the first n rows only, each round running them HOT_REPEAT times, so that both engines
    // work from the cache: the cost of the decision alone, without memory traffic.
    let hot: usize = std::env::var("HOT").ok().and_then(|h| h.parse().ok()).unwrap_or(0);
    if hot > 0 { rows.truncate(hot); }
    let repeat: usize = if hot > 0 { std::env::var("HOT_REPEAT").ok().and_then(|h| h.parse().ok()).unwrap_or(200) } else { 1 };
    mateless::init();
    let cha: Vec<(chess::Board, chess::Color)> = rows.iter()
        .map(|(f, w)| (chess::Board::from_str(f).expect("chess fen"), if *w { chess::Color::White } else { chess::Color::Black })).collect();
    let lx: Vec<(mateless::Position, u8)> = rows.iter()
        .map(|(f, w)| (mateless::from_fen(f).expect("fen"), if *w { mateless::BLACK } else { mateless::WHITE })).collect();
    let lxr = &lx;
    let mut s1 = mateless::Domino::new();
    let mut s2 = mateless::Domino::new();
    type Run<'a> = Box<dyn FnMut(usize) -> bool + 'a>;
    let both = std::env::var("BOTH").map(|b| b == "1").unwrap_or(false);
    let (mut s3, mut s4, mut s5) = (mateless::Domino::new(), mateless::Domino::new(), mateless::Domino::new());
    let mut engines: Vec<(&str, Run)> = if both { vec![
        ("chasolver fast, each colour", Box::new(|i: usize| {
            let w = chasolver::is_unwinnable_fast(&cha[i].0, chess::Color::White);
            let b = chasolver::is_unwinnable_fast(&cha[i].0, chess::Color::Black);
            w && b })),
        ("Mateless ladder, each side alone", Box::new(move |i: usize| {
            let w = mateless::prove_cannot_be_mated(&mut s3, &lxr[i].0, mateless::WHITE, mateless::DOMINO_PLY, mateless::DOMINO_BUDGET).proven;
            let b = mateless::prove_cannot_be_mated(&mut s3, &lxr[i].0, mateless::BLACK, mateless::DOMINO_PLY, mateless::DOMINO_BUDGET).proven;
            w && b })),
        ("Mateless ladder, both at once", Box::new(move |i: usize| {
            let q = mateless::prove_both(&mut s4, &lxr[i].0, mateless::DOMINO_PLY, mateless::DOMINO_BUDGET);
            q[0].proven && q[1].proven })),
    ] } else { vec![
        ("chasolver fast", Box::new(|i: usize| chasolver::is_unwinnable_fast(&cha[i].0, cha[i].1))),
        ("Mateless static only", Box::new(|i: usize| mateless::cannot_mate(&lx[i].0, lx[i].1))),
        ("Mateless static + Domino 6/100", Box::new(move |i: usize| mateless::cannot_mate(&lxr[i].0, lxr[i].1)
            || s1.run(&lxr[i].0, lxr[i].1, mateless::DOMINO_PLY, mateless::DOMINO_BUDGET, false).proven)),
        ("Mateless static + Domino 9/2000", Box::new(move |i: usize| mateless::cannot_mate(&lxr[i].0, lxr[i].1)
            || s2.run(&lxr[i].0, lxr[i].1, 9, 2000, false).proven)),
        ("Mateless ladder (second tier too)", Box::new(move |i: usize|
            mateless::prove_cannot_be_mated(&mut s5, &lxr[i].0, lxr[i].1, mateless::DOMINO_PLY, mateless::DOMINO_BUDGET).proven)),
    ] };
    let n = rows.len();
    let proven: Vec<usize> = engines.iter_mut().map(|(_, f)| (0..n).filter(|&i| f(i)).count()).collect();
    const CHUNK: usize = 64;
    let mut res: Vec<Vec<f64>> = vec![Vec::new(); engines.len()];
    let mut sink = 0usize;
    for r in 0..rounds {
        let mut t = vec![0u128; engines.len()];
        for (k, c) in (0..n).step_by(CHUNK).enumerate() {
            let end = (c + CHUNK).min(n);
            for j in 0..engines.len() {
                let e = (j + k + r) % engines.len();
                let f = &mut engines[e].1;
                let t0 = Instant::now();
                for _ in 0..repeat { for i in c..end { if f(i) { sink += 1; } } }
                t[e] += t0.elapsed().as_nanos();
            }
        }
        for (e, v) in t.iter().enumerate() { res[e].push(*v as f64 / (n * repeat) as f64); }
    }
    let mut worst = vec![(0u128, 0usize); engines.len()];
    for (e, (_, f)) in engines.iter_mut().enumerate() {
        // each position's time is the fastest of three calls, so that an interruption of the machine
        // does not pass for a slow position
        for i in 0..n {
            let mut d = u128::MAX;
            for _ in 0..3 { let t0 = Instant::now(); if f(i) { sink += 1; } d = d.min(t0.elapsed().as_nanos()); }
            if d > worst[e].0 { worst[e] = (d, i); }
        }
    }
    println!("{}{}: {} positions{}, {} rounds (sink {})", file, if both { " (both sides)" } else { "" }, n, if hot > 0 { format!(" (hot cache, x{})", repeat) } else { String::new() }, rounds, sink % 10);
    for (e, (name, _)) in engines.iter().enumerate() {
        let mut v = res[e].clone();
        v.sort_by(|a, b| a.partial_cmp(b).unwrap());
        println!("  {:28} proven {:>7}   median {:>10.3} µs/pos   worst {:>10.1} µs ({})", name, proven[e], v[v.len() / 2] / 1000.0,
                 worst[e].0 as f64 / 1000.0, rows[worst[e].1].0);
    }
}
