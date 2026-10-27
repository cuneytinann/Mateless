/* lockviz.js: the lock detector of scalachess's Lock.scala (Mateless's lock.js), written out on
   64-bit BigInt sets, square a1 = bit 0 ... h8 = bit 63, with every pass of the fixed point kept
   so that a page can paint the sets round by round. It decides nothing that the engine does not:
   test/verify.js checks its verdicts and final sets against mateless.js. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LockViz = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const M = (1n << 64n) - 1n;
  const FILE_A = 0x0101010101010101n, FILE_H = 0x8080808080808080n;
  const RANK_1 = 0xffn, RANK_8 = 0xff00000000000000n, DARK = 0xaa55aa55aa55aa55n;

  const not = w => M ^ w;
  const north = w => (w << 8n) & M;
  const south = w => w >> 8n;
  const sideways = w => ((w << 1n) & M & not(FILE_A)) | ((w >> 1n) & not(FILE_H));
  const zone = w => { const v = w | north(w) | south(w); return v | sideways(v); };
  const diagonal = w => sideways(north(w) | south(w));
  const count = w => { let n = 0; while (w) { w &= w - 1n; n++; } return n; };

  /* Every square reachable from g by steps north (south) through squares of p: Kogge-Stone. */
  function fillNorth(g, p) {
    g |= p & north(g);
    p &= north(p);
    g |= p & ((g << 16n) & M);
    p &= (p << 16n) & M;
    return g | (p & ((g << 32n) & M));
  }
  function fillSouth(g, p) {
    g |= p & south(g);
    p &= south(p);
    g |= p & (g >> 16n);
    p &= p >> 16n;
    return g | (p & (g >> 32n));
  }
  const twinBishops = b => count(b & DARK) > 1 || count(b & not(DARK)) > 1;

  /* One level of the certificate (fr: the frozen king's square, 0n for none), with its passes. */
  function leaks(s, flagged, fr) {
    const { wp, bp, wk, bk, wb, bb } = s;
    const out = { frozen: fr === 0n ? 'none' : (fr & wk) ? 'white' : 'black', rounds: [], leak: null };
    const frozenWhite = (fr & wk) !== 0n;
    const frozenBlack = !frozenWhite && fr !== 0n;
    const nearFrozenBlack = frozenBlack ? zone(bk) : 0n;
    const nearFrozenWhite = frozenWhite ? zone(wk) : 0n;
    // Quick reject with the first walls (the capture squares are only the kings' squares yet).
    const wc0 = fillNorth(wp, not((bp & not(wk)) | fr));
    const bc0 = fillSouth(bp, not((wp & not(bk)) | fr));
    out.quick = { wCone: wc0, bCone: bc0 };
    if ((wc0 & RANK_8) | (bc0 & RANK_1)) { out.leak = 'quick: a pawn can promote'; return out; }
    if (north(sideways(wc0)) & bc0) { out.leak = 'quick: two pawns can meet'; return out; }

    let wFixed = wp, bFixed = bp, wKing = wk, bKing = bk, wTake = wk, bTake = bk;
    let wWall = M, bWall = M, leak = false, done = false;
    out.rounds.push({ wWall, bWall, wFixed, bFixed, wKing, bKing, wTake, bTake, start: true });
    while (!done) {
      const pw = wWall, pb = bWall;
      wWall = (wp & not(bTake)) | fr;
      bWall = (bp & not(wTake)) | fr;
      const nwFixed = wFixed & wWall & south(bWall | wFixed);
      const nbFixed = bFixed & bWall & north(wWall | bFixed);
      if (wWall === pw && bWall === pb && nwFixed === wFixed && nbFixed === bFixed) {
        done = true;
        out.rounds.push({ wWall, bWall, wFixed, bFixed, wKing, bKing, wTake, bTake, stable: true });
      } else {
        const mw = not(nwFixed | sideways(south(nbFixed)) | nearFrozenBlack);
        const mb = not(nbFixed | sideways(north(nwFixed)) | nearFrozenWhite);
        let nwKing = wKing, nbKing = bKing, steps = 0;
        for (;;) {
          const a = nwKing | (zone(nwKing) & mw);
          const d = nbKing | (zone(nbKing) & mb);
          if (a === nwKing && d === nbKing) break;
          nwKing = a; nbKing = d; steps++;
        }
        if ((frozenWhite && nwKing !== wk) || (frozenBlack && nbKing !== bk)) {
          leak = true; done = true;
          out.rounds.push({ wWall, bWall, wFixed: nwFixed, bFixed: nbFixed, wKing: nwKing, bKing: nbKing,
                            wTake, bTake, mw, mb, steps });
        } else {
          const tb = bTake | nbKing;
          const nbTake = tb | south(fillSouth(tb & not(bWall), not(bWall)));
          const tw = wTake | nwKing;
          const nwTake = tw | north(fillNorth(tw & not(wWall), not(wWall)));
          const changed = (nwFixed ^ wFixed) | (nbFixed ^ bFixed) | (nwKing ^ wKing) | (nbKing ^ bKing) |
            (nbTake ^ bTake) | (nwTake ^ wTake);
          wFixed = nwFixed; bFixed = nbFixed; wKing = nwKing; bKing = nbKing; wTake = nwTake; bTake = nbTake;
          out.rounds.push({ wWall, bWall, wFixed, bFixed, wKing, bKing, wTake, bTake, mw, mb, steps });
          if (changed === 0n) done = true;
        }
      }
    }
    out.final = { wWall, bWall, wFixed, bFixed, wKing, bKing, wTake, bTake };
    if (leak) { out.leak = 'the frozen king can move'; return out; }
    // The pawns' cones (the squares they may still reach) and the bishops' reaches, once.
    const wCone = fillNorth(wp, not(bWall));
    const bCone = fillSouth(bp, not(wWall));
    out.cones = { wCone, bCone };
    if ((wCone & RANK_8) | (bCone & RANK_1)) { out.leak = 'a pawn can promote'; return out; }
    if (north(sideways(wCone)) & bCone) { out.leak = 'two pawns can meet (a capture)'; return out; }
    let wBish = wb, bBish = bb;
    if (wBish | bBish) {
      const m = not(wFixed | bFixed);
      for (;;) {
        const a = wBish | (diagonal(wBish) & m);
        const d = bBish | (diagonal(bBish) & m);
        if (a === wBish && d === bBish) break;
        wBish = a; bBish = d;
      }
    }
    out.bishops = { wBish, bBish };
    if ((diagonal(wBish) & bCone) || (diagonal(bBish) & wCone)) { out.leak = 'a bishop meets a pawn\'s path'; return out; }
    // The mating net: can the flagged king be caught by the other side's pawns and bishops?
    const white = flagged === 'w';
    const attack = white ? diagonal(bBish) | sideways(south(bCone)) : diagonal(wBish) | sideways(north(wCone));
    const reach = white ? wKing : bKing;
    const free = white ? not(wCone | zone(bKing) | attack) : not(bCone | zone(wKing) | attack);
    const spare = free & not(white ? wBish : bBish);
    const flight = sideways(spare) | north(spare) | south(spare) | ((north(free) | south(free)) & sideways(free));
    const caught = attack & reach & not(flight);
    out.net = { attack, reach, free, spare, flight, caught };
    if (caught) out.leak = 'the flagged king may be mated';
    return out;
  }

  /* The whole detector: the gates, then up to three levels. s: { wp, bp, wk, bk, wb, bb, others, ep }
     (others: any knight, rook or queen; ep: an en passant capture is possible). flagged: 'w' | 'b'. */
  function trace(s, flagged) {
    if (s.others) return { gate: 'a knight, rook or queen is on the board', levels: [], proved: false };
    if (twinBishops(s.wb) || twinBishops(s.bb)) return { gate: 'two bishops of one side on one colour', levels: [], proved: false };
    if (s.ep) return { gate: 'an en passant capture is possible', levels: [], proved: false };
    const levels = [];
    const first = leaks(s, flagged, 0n);
    levels.push(first);
    if (!first.leak) return { gate: null, levels, proved: true, level: first };
    const held = s.wp | s.bp | sideways(north(s.wp) | south(s.bp));
    for (const k of [s.wk, s.bk]) {
      if (zone(k) & not(k) & not(held)) { levels.push({ frozen: k === s.wk ? 'white' : 'black', skipped: true, held }); continue; }
      const lv = leaks(s, flagged, k);
      levels.push(lv);
      if (!lv.leak) return { gate: null, levels, proved: true, level: lv };
    }
    return { gate: null, levels, proved: false };
  }

  /* The sets of a FEN's board field (no other parsing: the page asks mateless.js for the rest). */
  function setsOfBoard(boardField) {
    const s = { wp: 0n, bp: 0n, wk: 0n, bk: 0n, wb: 0n, bb: 0n, others: false, ep: false };
    const ranks = boardField.split('/');
    for (let r = 0; r < 8; r++) {
      let f = 0;
      for (const ch of ranks[r]) {
        if (ch >= '1' && ch <= '8') { f += +ch; continue; }
        const bit = 1n << BigInt((7 - r) * 8 + f);
        switch (ch) {
          case 'P': s.wp |= bit; break; case 'p': s.bp |= bit; break;
          case 'K': s.wk |= bit; break; case 'k': s.bk |= bit; break;
          case 'B': s.wb |= bit; break; case 'b': s.bb |= bit; break;
          default: s.others = true;
        }
        f++;
      }
    }
    return s;
  }

  const squares = w => { const out = []; for (let i = 0; i < 64; i++) if ((w >> BigInt(i)) & 1n) out.push(i); return out; };
  const name = i => 'abcdefgh'[i % 8] + (1 + (i >> 3));
  const hex = w => '0x' + w.toString(16).padStart(16, '0');

  return { M, north, south, sideways, zone, diagonal, fillNorth, fillSouth, count, not,
           trace, leaks, setsOfBoard, squares, name, hex, FILE_A, FILE_H, RANK_1, RANK_8, DARK };
});
