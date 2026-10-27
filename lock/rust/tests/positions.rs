// Tests the lock detector on ../positions.tsv:  cargo test --release -- --nocapture
// (or on another file:  POSITIONS=path/to/positions.tsv cargo test --release -- --nocapture)
use mateless_lock::{cannot_be_mated, from_fen};

#[test]
fn positions() {
    let path = std::env::var("POSITIONS")
        .unwrap_or_else(|_| concat!(env!("CARGO_MANIFEST_DIR"), "/../positions.tsv").to_string());
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{path}: {e}"));
    let (mut n, mut bad) = (0, 0);
    for line in text.lines() {
        if line.starts_with('#') || line.trim().is_empty() {
            continue;
        }
        let fields: Vec<&str> = line.split('\t').collect();
        let (fen, white, black) = (fields[0], fields[1], fields[2]);
        let p = from_fen(fen);
        let (w, b) = (cannot_be_mated(&p, true), cannot_be_mated(&p, false));
        if (w, b) != (white == "1", black == "1") {
            bad += 1;
            if bad <= 10 {
                println!(
                    "wrong: {fen} expected {white} {black} got {} {}",
                    w as u8, b as u8
                );
            }
        }
        n += 1;
    }
    println!("rust: {n} positions, {bad} wrong");
    assert_eq!(bad, 0, "{bad} wrong");
}
