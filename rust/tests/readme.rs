// The example of rust/README.md, and a few positions from mateless.js's README.
#[test]
fn readme_example() {
    let pos = mateless::from_fen("8/8/4k3/3p2p1/1p1P1pP1/1P3P2/8/3K4 b - - 47 92").unwrap();
    let mut search = mateless::Domino::new();
    let proof = mateless::prove_cannot_be_mated(&mut search, &pos, mateless::BLACK, mateless::DOMINO_PLY, mateless::DOMINO_BUDGET);
    assert!(proof.proven && proof.static_proof);
    assert!(mateless::lock_test(&pos, mateless::BLACK));
}

#[test]
fn domino_examples() {
    let mut search = mateless::Domino::new();
    // forced Kxg4, then bare kings: 1 node
    let p = mateless::from_fen("8/8/8/8/6qK/8/5k2/8 w - - 2 63").unwrap();
    let r = mateless::prove_cannot_be_mated(&mut search, &p, mateless::WHITE, 6, 100);
    assert!(r.proven && !r.static_proof && r.nodes == 1);
    // a pawn's check, three king moves, each into a lock: 3 nodes
    let p = mateless::from_fen("8/8/1k6/p2p2p1/PK1P2Pp/7P/8/8 w - - 0 49").unwrap();
    let r = mateless::prove_cannot_be_mated(&mut search, &p, mateless::WHITE, 6, 100);
    assert!(r.proven && r.nodes == 3);
    // an open position: the first line runs to the ceiling
    let p = mateless::from_fen("rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2").unwrap();
    let r = mateless::prove_cannot_be_mated(&mut search, &p, mateless::WHITE, 6, 100);
    assert!(!r.proven && r.failure == mateless::Failure::Horizon && r.nodes == 6);
}

#[test]
fn flags() {
    let p = mateless::from_fen("7k/8/8/8/3q4/8/8/7K w - - 0 60").unwrap();
    let mut f = mateless::Flags::new();
    f.update(&p, 0);
    assert!(f.never_mates(mateless::WHITE) && !f.never_mates(mateless::BLACK));
}
