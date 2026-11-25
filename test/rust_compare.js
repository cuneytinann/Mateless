'use strict';
/* The JavaScript side of the Rust port's equality check: prints exactly what `mateless layers` and
   `mateless labels` (rust/src/bin/mateless.rs) print, so the two outputs can be compared line by line.
     node rust_compare.js layers <chasolver-data.csv> > js.tsv
     ../rust/target/release/mateless layers <chasolver-data.csv> > rs.tsv
     cmp js.tsv rs.tsv
   The same with `labels <chasolver tests/positions.txt or lichess.txt>` and `games <file>` (a game per
   line, its FENs joined by |: the plies at which the two flags came down). Every line carries the
   layer or verdict and the nodes the Domino search played, so equal outputs mean the two engines
   searched the same trees. The labelled lines are read with { strict: false }, so the search is
   compared on composed positions too; `fen <file>` compares the two readers themselves: per FEN (a
   line, its first tab field, a labelled line or a game's FENs joined by |) the strict reading and
   the loose one, each as the error or the fixed bits (1 castling, 2 en passant, 4 move number,
   8 halfmove clock) and the FEN.  (env ENGINE, default ../mateless.js) */
const fs = require('fs'), path = require('path');
const E = require(path.resolve(__dirname, process.env.ENGINE || '../mateless.js'));
const [mode, file] = process.argv.slice(2);
const out = [];
const LOOSE = { strict: false };   // composed positions (labelled lines): the search on all of them
const FIXED = { castling: 1, 'en passant': 2, fullmove: 4, halfmove: 8 };
if (mode === 'fen') {   // per FEN: the strict reading and the loose one (the error, or the fixed bits and the FEN)
  const show = r => (r.error ? r.error : [r.fixed.reduce((a, f) => a | FIXED[f], 0), r.fen].join('\t'));
  fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    const body = /^(WB|W-|-B|--) /.test(line) && line.length > 3 ? line.slice(3) : line.split('\t')[0];
    for (const fen of body.trim().split('|')) if (fen) out.push([i, show(E.fromFen(fen)), show(E.fromFen(fen, LOOSE))].join('\t'));
  });
} else if (mode === 'layers') {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const c = lines[i].split(','), id = c[0], s = E.fromFen(c[12].trim());
    if (s.error) { out.push([id, 'fen-error', s.error, '-'].join('\t')); continue; }
    const p = s.position, z = p.side;
    if (E.materialCannotMate(p, z)) out.push([id, 'material', 0, '-'].join('\t'));
    else if (E.cannotMate(p, z)) out.push([id, 'lock', 0, '-'].join('\t'));
    else { const r = E.proveCannotBeMated(p, z); out.push([id, r.proven ? 'domino' : 'none', r.nodes, r.failure || '-'].join('\t')); }
  }
} else if (mode === 'labels') {
  fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    if (!/^(WB|W-|-B|--) /.test(line)) return;
    const s = E.fromFen(line.slice(3).trim(), LOOSE);
    if (s.error) { out.push([i, 'fen-error', s.error].join('\t')); return; }
    const both = E.proveBoth(s.position);   // both flags in one pass: the same lines as proveCannotBeMated for each
    for (const [z, r] of [[E.WHITE, both[0]], [E.BLACK, both[1]]])
      out.push([i, z === E.WHITE ? 'w' : 'b', r.proven ? 1 : 0, r.staticProof ? 1 : 0, r.failure || '-', r.nodes].join('\t'));
  });
} else if (mode === 'games') {   // a game per line, FENs joined by |: the plies at which the flags came down (Game)
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line) continue;
    const fens = line.split('|'), g = new E.Game(E.fromFen(fens[0]).position);
    g.updateFlags();
    for (let k = 1; k < fens.length; k++) { g.position = E.fromFen(fens[k]).position; g.ply = k; g.updateFlags(); }
    out.push([g.whiteDownAt, g.blackDownAt].join('\t'));
  }
} else { console.log('usage: node rust_compare.js layers <csv> | labels <file> | games <file> | fen <file>'); process.exit(1); }
process.stdout.write(out.join('\n') + '\n');
