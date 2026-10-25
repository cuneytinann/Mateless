//! Both sides at once against each side alone: the same answers, and what one pass saves.
//!   cargo run --release --example twosided -- check <files...>          every position, both sides, every field
//!   cargo run --release --example twosided -- time <positions> [rounds]  the static tests and the ladder, both sides
//!   cargo run --release --example twosided -- games <games> [rounds]     a game's flags, ply by ply
//!   cargo run --release --example twosided -- census <files...>         lock proofs: both sides, one side, neither
//! A line is either "<fen>" followed by anything after a tab, or a game: FENs joined by "|".
use mateless::*;
use std::io::{BufRead, BufReader};
use std::time::Instant;

fn read(file: &str) -> Vec<Vec<Position>> {
    BufReader::new(std::fs::File::open(file).expect("file")).lines().filter_map(|l| {
        let l = l.ok()?;
        if l.is_empty() { return None; }
        let first = l.split('\t').next()?;
        Some(first.split('|').filter_map(|f| from_fen(f).ok()).collect::<Vec<_>>())
    }).filter(|g: &Vec<Position>| !g.is_empty()).collect()
}

fn bits(w: bool, b: bool) -> u8 { (w as u8) * FLAGGED_WHITE | (b as u8) * FLAGGED_BLACK }

fn median(mut v: Vec<f64>) -> f64 { v.sort_by(|a, b| a.partial_cmp(b).unwrap()); v[v.len() / 2] }

/// The flags as they were climbed before: each side alone (cannot_mate, then Domino::run).
struct OneSided { white_down_at: i64, black_down_at: i64, updated_ply: i64 }
impl OneSided {
    fn update(&mut self, search: &mut Domino, pos: &Position, ply: i64) {
        if self.updated_ply == ply { return; }
        let first = self.updated_ply < 0;
        self.updated_ply = ply;
        let ask_static = first || (pos.halfmove <= 1 && pos.ep == NO_SQUARE);
        for mater in [WHITE, BLACK] {
            if (if mater == WHITE { self.white_down_at } else { self.black_down_at }) >= 0 { continue; }
            let flagged = mater ^ WHITE;
            if (ask_static && cannot_mate(pos, flagged)) || search.run(pos, flagged, DOMINO_PLY, DOMINO_BUDGET, false).proven {
                if mater == WHITE { self.white_down_at = ply; } else { self.black_down_at = ply; }
            }
        }
    }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    init();
    let (mut s1, mut s2) = (Domino::new(), Domino::new());
    match args.get(1).map(|s| s.as_str()) {
        Some("check") => {
            let (mut n, mut bad, mut big) = (0u64, 0u64, 0u64);
            // How often the two sides' searches part: different verdicts, different failures,
            // different budgets spent. The check means something only where they do.
            let (mut part_verdict, mut part_failure, mut part_budget) = (0u64, 0u64, 0u64);
            let report = |what: &str, fen: String, bad: &mut u64| { *bad += 1; if *bad <= 10 { println!("MISMATCH {}: {}", what, fen); } };
            for file in &args[2..] {
                for game in read(file) {
                    for pos in &game {
                        n += 1;
                        let fen = || placement(pos);
                        let one = [lock_test(pos, WHITE), lock_test(pos, BLACK)];
                        let st = [cannot_mate(pos, WHITE), cannot_mate(pos, BLACK)];
                        for ask in 1..=3u8 {
                            if lock_test2(pos, ask) != ask & bits(one[0], one[1]) { report("lock_test2", fen(), &mut bad); }
                            if cannot_mate2(pos, ask) != ask & bits(st[0], st[1]) { report("cannot_mate2", fen(), &mut bad); }
                        }
                        let both = prove_both(&mut s2, pos, DOMINO_PLY, DOMINO_BUDGET);
                        for (i, flagged) in [WHITE, BLACK].into_iter().enumerate() {
                            let p = prove_cannot_be_mated(&mut s1, pos, flagged, DOMINO_PLY, DOMINO_BUDGET);
                            let q = both[i];
                            if (p.proven, p.static_proof, p.failure, p.nodes) != (q.proven, q.static_proof, q.failure, q.nodes) { report("prove_both", fen(), &mut bad); }
                        }
                        // The walk itself, root tests asked or not, one side or both; and, on every 64th
                        // position, a larger search (9 plies, 2,000 nodes) whose trees part more often.
                        let mut limits = vec![(DOMINO_PLY, DOMINO_BUDGET)];
                        if n % 64 == 0 { limits.push((9, 2000)); big += 1; }
                        for (ply, budget) in limits {
                            for root_static in [false, true] {
                                let r = [s1.run(pos, WHITE, ply, budget, root_static), s1.run(pos, BLACK, ply, budget, root_static)];
                                part_verdict += (r[0].proven != r[1].proven) as u64;
                                part_failure += (r[0].failure != r[1].failure) as u64;
                                part_budget += (r[0].budget_left != r[1].budget_left) as u64;
                                for ask in 1..=3u8 {
                                    let q = s2.run2(pos, ask, ply, budget, root_static);
                                    for i in 0..2 {
                                        let want = if ask & (1 << i) != 0 { (r[i].proven, r[i].failure, r[i].budget_left) } else { (false, Failure::None, budget) };
                                        if want != (q[i].proven, q[i].failure, q[i].budget_left) { report("run2", fen(), &mut bad); }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            println!("{} positions, both sides ({} also at 9 plies / 2,000 nodes): {} mismatches", n, big, bad);
            println!("searches compared in pairs where the two sides part: verdict {}, failure {}, budget spent {}", part_verdict, part_failure, part_budget);
        }
        Some("time") => {
            let v: Vec<Position> = read(&args[2]).into_iter().flatten().collect();
            let rounds: usize = args.get(3).and_then(|r| r.parse().ok()).unwrap_or(7);
            type Run<'a> = Box<dyn FnMut(&Position) -> u64 + 'a>;
            let mut pairs: Vec<(&str, Run, Run)> = vec![
                ("lock test, both sides", Box::new(|p: &Position| bits(lock_test(p, WHITE), lock_test(p, BLACK)) as u64),
                                          Box::new(|p: &Position| lock_test2(p, 3) as u64)),
                ("static tests, both sides", Box::new(|p: &Position| bits(cannot_mate(p, WHITE), cannot_mate(p, BLACK)) as u64),
                                             Box::new(|p: &Position| cannot_mate2(p, 3) as u64)),
                ("both proofs (prove_both)", Box::new(move |p: &Position| {
                    let w = prove_cannot_be_mated(&mut s1, p, WHITE, DOMINO_PLY, DOMINO_BUDGET);
                    let b = prove_cannot_be_mated(&mut s1, p, BLACK, DOMINO_PLY, DOMINO_BUDGET);
                    bits(w.proven, b.proven) as u64 + 4 * (w.nodes + b.nodes) as u64 }),
                  Box::new(move |p: &Position| { let q = prove_both(&mut s2, p, DOMINO_PLY, DOMINO_BUDGET);
                    bits(q[0].proven, q[1].proven) as u64 + 4 * (q[0].nodes + q[1].nodes) as u64 })),
            ];
            println!("{}: {} positions, {} rounds (ns per position; checksums must match)", args[2].rsplit('/').next().unwrap(), v.len(), rounds);
            for (name, one, two) in pairs.iter_mut() {
                let (c1, c2): (u64, u64) = (v.iter().map(|p| one(p)).sum(), v.iter().map(|p| two(p)).sum());
                let (mut t1, mut t2) = (Vec::new(), Vec::new());
                for r in 0..rounds {
                    for k in 0..2 {
                        let t0 = Instant::now();
                        let c: u64 = if (r + k) % 2 == 0 { v.iter().map(|p| one(p)).sum() } else { v.iter().map(|p| two(p)).sum() };
                        let t = t0.elapsed().as_nanos() as f64 / v.len() as f64;
                        if (r + k) % 2 == 0 { assert_eq!(c, c1); t1.push(t); } else { assert_eq!(c, c2); t2.push(t); }
                    }
                }
                println!("  {:36} each side alone {:8.1}   both at once {:8.1}   ({:.2}x)   checksum {} {}", name, median(t1.clone()), median(t2.clone()),
                         median(t1) / median(t2), c1, if c1 == c2 { "=" } else { "DIFFERENT" });
            }
        }
        Some("games") => {
            let games = read(&args[2]);
            let rounds: usize = args.get(3).and_then(|r| r.parse().ok()).unwrap_or(5);
            let plies: usize = games.iter().map(|g| g.len()).sum();
            let mut one = |games: &[Vec<Position>]| -> (i64, u64) {
                let mut sum = 0; let mut searches = 0u64;
                for g in games {
                    let mut f = OneSided { white_down_at: -1, black_down_at: -1, updated_ply: -1 };
                    for (ply, pos) in g.iter().enumerate() {
                        searches += (f.white_down_at < 0) as u64 + (f.black_down_at < 0) as u64;
                        f.update(&mut s1, pos, ply as i64);
                    }
                    sum += f.white_down_at * 1000 + f.black_down_at;
                }
                (sum, searches)
            };
            let two = |games: &[Vec<Position>]| -> (i64, u64) {
                let mut sum = 0; let mut walks = 0u64;
                for g in games {
                    let mut f = Flags::new();
                    for (ply, pos) in g.iter().enumerate() {
                        walks += (f.white_down_at < 0 || f.black_down_at < 0) as u64;
                        f.update(pos, ply as i64);
                    }
                    sum += f.white_down_at * 1000 + f.black_down_at;
                }
                (sum, walks)
            };
            // ONLY=one or ONLY=two: run just that procedure once (for an instruction count).
            if let Ok(only) = std::env::var("ONLY") {
                if only == "none" { println!("parsed {} plies", plies); return; }
                let (c, _) = if only == "one" { one(&games) } else { two(&games) };
                println!("{} only: checksum {}", only, c);
                return;
            }
            let (c1, sides) = one(&games);
            let (c2, walks) = two(&games);
            let (mut t1, mut t2) = (Vec::new(), Vec::new());
            for r in 0..rounds {
                for k in 0..2 {
                    let t0 = Instant::now();
                    if (r + k) % 2 == 0 { assert_eq!(one(&games).0, c1); t1.push(t0.elapsed().as_nanos() as f64 / plies as f64); }
                    else { assert_eq!(two(&games).0, c2); t2.push(t0.elapsed().as_nanos() as f64 / plies as f64); }
                }
            }
            println!("{}: {} games, {} plies; side-updates (one side, one ply) {}, plies with a flag up {}", args[2].rsplit('/').next().unwrap(),
                     games.len(), plies, sides, walks);
            println!("  flags, each side alone {:8.1} ns/ply   both at once {:8.1} ns/ply   ({:.2}x)   flags {}", median(t1.clone()), median(t2.clone()),
                     median(t1) / median(t2), if c1 == c2 { "identical" } else { "DIFFERENT" });
        }
        Some("census") => {
            // How many positions the lock detector proves for both sides (a dead lock), for one side
            // only (the other side may still mate), for neither.
            for file in &args[2..] {
                let mut c = [0u64; 4];
                for pos in read(file).into_iter().flatten() { c[lock_test2(&pos, 3) as usize] += 1; }
                println!("{}: lock proves both sides {}, White flagged only {}, Black flagged only {}, neither {}",
                         file.rsplit('/').next().unwrap(), c[3], c[1], c[2], c[0]);
            }
        }
        _ => eprintln!("usage: twosided check <files...> | twosided time <positions> [rounds] | twosided games <games> [rounds]"),
    }
}
