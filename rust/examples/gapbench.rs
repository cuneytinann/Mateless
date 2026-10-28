//! Speed of the lock detector by category (lines "<fen>\t<flagged w|b>"), and of the ladder in games
//! replayed move by move (Flags at every ply). One line per measurement:
//!   "<key>\t<median ns>\t<min ns>\t<max ns>\t<n>\t<checksum>"
//!   cargo run --release --example gapbench -- <rounds> <games.tsv> <ngames> <category files...>
use std::hint::black_box;
use std::io::{BufRead, BufReader};
use std::time::Instant;

fn lines(f: &str) -> Vec<String> { BufReader::new(std::fs::File::open(f).unwrap()).lines().map(|l| l.unwrap()).filter(|l| !l.is_empty()).collect() }
fn summary(mut t: Vec<f64>) -> (f64, f64, f64) { t.sort_by(|a, b| a.partial_cmp(b).unwrap()); (t[t.len() / 2], t[0], t[t.len() - 1]) }

fn main() {
    mateless::init();
    let args: Vec<String> = std::env::args().collect();
    let rounds: usize = args[1].parse().unwrap();
    let games_file = &args[2];
    let ngames: usize = args[3].parse().unwrap();
    for f in &args[4..] {
        let v: Vec<(mateless::Position, u8)> = lines(f).iter().filter_map(|l| {
            let mut it = l.split('\t'); let fen = it.next()?; let z = if it.next()? == "w" { mateless::WHITE } else { mateless::BLACK };
            Some((mateless::from_fen(fen).ok()?, z)) }).collect();
        let n = v.len();
        let name = f.rsplit('/').next().unwrap().trim_start_matches("cat_").trim_end_matches(".tsv");
        let locks = v.iter().filter(|(p, z)| mateless::lock_test(p, *z)).count();
        // repetitions so that one measurement takes ~25 ms
        let t0 = Instant::now(); let mut acc = 0usize;
        for (p, z) in &v { if mateless::lock_test(black_box(p), *z) { acc += 1; } }
        let one = t0.elapsed().as_secs_f64().max(1e-6);
        let rep = ((0.025 / one).round() as usize).max(1);
        for what in ["lock", "both"] {
            let pass = || -> usize {
                let mut acc = 0usize;
                if what == "lock" { for (p, z) in &v { if mateless::lock_test(black_box(p), black_box(*z)) { acc += 1; } } }
                else { for (p, _) in &v { acc += mateless::cannot_mate2(black_box(p), black_box(3)) as usize; } }
                acc
            };
            for _ in 0..3 { acc += black_box(pass()); }
            let mut t = Vec::new();
            for _ in 0..rounds {
                let t0 = Instant::now();
                for _ in 0..rep { acc += black_box(pass()); }
                t.push(t0.elapsed().as_nanos() as f64 / (rep * n) as f64);
            }
            let (m, lo, hi) = summary(t);
            println!("{}/{}\t{:.2}\t{:.2}\t{:.2}\t{}\t{}", name, what, m, lo, hi, n, locks);
        }
        black_box(acc);
    }
    // Games: moves (from, to, promotion) found among the legal moves, then Flags at every ply.
    let games: Vec<Vec<(u8, u8, u8)>> = lines(games_file).iter().take(ngames).map(|l| {
        let sq = |s: &[u8]| -> u8 { (s[0] - b'a') + 8 * (s[1] - b'1') };
        l.split('\t').nth(1).unwrap_or("").split(' ').filter(|u| !u.is_empty()).map(|u| { let b = u.as_bytes();
            let pr = if b.len() > 4 { match b[4] { b'r' => mateless::ROOK, b'b' => mateless::BISHOP, b'n' => mateless::KNIGHT, _ => mateless::QUEEN } } else { mateless::QUEEN };
            (sq(&b[0..2]), sq(&b[2..4]), pr) }).collect() }).collect();
    let plies: usize = games.iter().map(|g| g.len() + 1).sum();
    let start = mateless::from_fen("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1").unwrap();
    let replay = |with_flags: bool| -> i64 {
        let mut down = 0i64; let mut buf = [0u32; mateless::MOVE_STRIDE];
        let mut flags = mateless::Flags::new();
        for g in &games {
            let mut pos = start.clone();
            if with_flags { flags = mateless::Flags::new(); flags.update(&pos, 0); }
            for (i, &(from, to, pr)) in g.iter().enumerate() {
                let k = mateless::generate_legal_moves(&pos, &mut buf);
                let mv = *buf[..k].iter().find(|&&m| (m & 63) as u8 == from && ((m >> 6) & 63) as u8 == to).expect("illegal move");
                mateless::do_move(&mut pos, mv, pr);
                if with_flags { flags.update(&pos, i as i64 + 1); }
            }
            if with_flags { down += flags.white_down_at.max(0) + flags.black_down_at.max(0); }
        }
        down
    };
    let down = replay(true); black_box(replay(false));
    let (mut tf, mut tb) = (Vec::new(), Vec::new());
    for _ in 0..(rounds / 2).max(3) {
        let t0 = Instant::now(); black_box(replay(true)); tf.push(t0.elapsed().as_nanos() as f64 / plies as f64);
        let t0 = Instant::now(); black_box(replay(false)); tb.push(t0.elapsed().as_nanos() as f64 / plies as f64);
    }
    let (m, lo, hi) = summary(tf); println!("replay/flags\t{:.2}\t{:.2}\t{:.2}\t{}\t{}", m, lo, hi, plies, down);
    let (m, lo, hi) = summary(tb); println!("replay/moves\t{:.2}\t{:.2}\t{:.2}\t{}\t0", m, lo, hi, plies);
}
