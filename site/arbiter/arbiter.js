(function () {
'use strict';
const E = window.Mateless;
if (!E) throw new Error('The Mateless engine did not load.');

/* ═══════════════════════════════ FEN checks ═══════════════════════════════
   Is this FEN a position that some game could have reached? Only necessary conditions are
   tested: a line that fails one is certainly not a legal position; passing all of them does
   not prove that it is (that takes retrograde analysis). Returns null, or {k: reason, a: [details]}.
   Squares are numbered a1 = 0 … h8 = 63; upper case is White. */
const fenProblem = (function () {
  function fenProblem(str) {
    var A = String(str).trim().split(/\s+/), sq = new Array(64), rows, r, f, i, x, ch, w;
    if (A.length < 2) return { k: 'syntax', a: ['fields'] };
    rows = A[0].split('/');
    if (rows.length != 8) return { k: 'syntax', a: ['nranks', rows.length] };
    for (r = 0; r < 8; r++) { w = 0;
      for (i = 0; i < rows[r].length && w <= 8; i++) { ch = rows[r][i];
        if (ch >= '1' && ch <= '8') { for (x = 0; x < +ch && w + x < 8; x++) sq[(7 - r) * 8 + w + x] = ''; w += +ch }
        else if ('pnbrqkPNBRQK'.indexOf(ch) >= 0) { if (w < 8) sq[(7 - r) * 8 + w] = ch; w++ }
        else return { k: 'syntax', a: ['char', ch] } }
      if (w != 8 || i < rows[r].length) return { k: 'syntax', a: ['rankw', 8 - r] } }
    if (A[1] != 'w' && A[1] != 'b') return { k: 'syntax', a: ['side', A[1]] };
    var white = A[1] == 'w', ep = A[3] || '-';
    if (ep != '-' && !/^[a-h][36]$/.test(ep)) return { k: 'syntax', a: ['epf', ep] };
    for (i = 4; i < A.length && i < 6; i++) if (A[i] != '-' && !/^\d+$/.test(A[i])) return { k: 'syntax', a: ['num', A[i]] };
    /* the halfmove clock cannot exceed the plies played since the start: 2×(fullmove − 1), plus one when Black is to move */
    if (A.length > 5 && A[5] != '-' && A[5] < 1) return { k: 'syntax', a: ['full', A[5]] };
    if (A.length > 5 && A[4] != '-' && A[5] != '-') { var hm = +A[4], pl = 2 * (A[5] - 1) + !white; if (hm > pl) return { k: 'clock', a: [hm, pl] } }

    var cnt = {}; for (i = 0; i < 64; i++) if (sq[i]) cnt[sq[i]] = (cnt[sq[i]] || 0) + 1;
    if ((cnt.K || 0) != 1 || (cnt.k || 0) != 1) return { k: 'kings', a: [cnt.K || 0, cnt.k || 0] };
    for (i = 0; i < 64; i++) if ((sq[i] == 'P' || sq[i] == 'p') && (i < 8 || i > 55)) return { k: 'pawnrank', a: [sqName(i)] };

    /* material: at most 8 pawns and 16 pieces a side, and every piece beyond the starting set
       (one queen, two rooks, two knights, one bishop on each colour; bishops never change colour)
       must be a promotion paid for by a missing pawn */
    var sides = ['w', 'b'];
    for (var s = 0; s < 2; s++) { var up = s == 0, c = function (L) { return cnt[up ? L.toUpperCase() : L] || 0 },
        P = c('p'), tot = P + c('n') + c('b') + c('r') + c('q') + 1, bl = 0, bd = 0;
      if (P > 8) return { k: 'pawns', a: [sides[s], P] };
      if (tot > 16) return { k: 'pieces', a: [sides[s], tot] };
      for (i = 0; i < 64; i++) if (sq[i] == (up ? 'B' : 'b')) { if (((i & 7) + (i >> 3)) & 1) bl++; else bd++ }
      var extra = Math.max(0, c('q') - 1) + Math.max(0, c('r') - 2) + Math.max(0, c('n') - 2) + Math.max(0, bl - 1) + Math.max(0, bd - 1);
      if (extra > 8 - P) return { k: 'promo', a: [sides[s], extra, 8 - P] } }

    /* en passant: the square must sit behind a pawn that has just advanced two squares */
    var e = -1;
    if (ep != '-') { e = (ep.charCodeAt(0) - 97) + (+ep[1] - 1) * 8;
      if (white ? (ep[1] != '6' || sq[e] || sq[e + 8] || sq[e - 8] != 'p') : (ep[1] != '3' || sq[e] || sq[e - 8] || sq[e + 8] != 'P')) return { k: 'ep' } }

    /* the side not to move may not be in check */
    var kw = sq.indexOf('K'), kb = sq.indexOf('k'), kt = white ? kw : kb, ko = white ? kb : kw;
    if (attackers(sq, ko, white).length) return { k: 'oppcheck' };

    /* checks on the side to move */
    var chk = attackers(sq, kt, !white);
    if (e >= 0) {
      /* the last move was a two-square advance: it can give at most one check, and that check must
         not have existed before the pawn moved */
      if (chk.length > 1) return { k: 'epcheck' };
      if (chk.length == 1) { var to = white ? e - 8 : e + 8, from = white ? e + 8 : e - 8;
        if (chk[0].at != to) { var bef = sq.slice(); bef[from] = bef[to]; bef[to] = '';
          if (attackers(bef, kt, !white).length) return { k: 'epcheck' } } } }
    else if (chk.length > 2) return { k: 'check3' };
    if (chk.length == 2) { var a = chk[0], b = chk[1];
      if (!a.ray && !b.ray) return { k: 'checkleap' };
      if (a.fam == b.fam) {
        if (a.fam == 'D') return { k: 'checkdiag' };
        if (a.fam == 'S' && !promoted(a, b) && !promoted(b, a)) return { k: 'checkstraight' } } }
    return null;

    /* two straight checks: X stands on the promotion rank and a pawn could have come to it by a
       diagonal capture from a square on Y's ray, opening that ray */
    function promoted(X, Y) {
      var pr = white ? 0 : 7, or = white ? 1 : 6;            // the checking side is the side not to move
      if ((X.at >> 3) != pr) return false;
      for (var df = -1; df <= 1; df += 2) { var of = (X.at & 7) + df; if (of < 0 || of > 7) continue;
        var o = or * 8 + of; if (sq[o]) continue;
        if (between(o, kt, Y.at)) return true }
      return false }
  }
  function sqName(i) { return 'abcdefgh'[i & 7] + ((i >> 3) + 1) }
  function between(o, k, y) {
    if ((k & 7) == (y & 7)) return (o & 7) == (k & 7) && (o >> 3) > Math.min(k >> 3, y >> 3) && (o >> 3) < Math.max(k >> 3, y >> 3);
    if ((k >> 3) == (y >> 3)) return (o >> 3) == (k >> 3) && (o & 7) > Math.min(k & 7, y & 7) && (o & 7) < Math.max(k & 7, y & 7);
    return false }
  /* the pieces of one colour attacking a square: each with its family (N leap, D diagonal, S straight,
     K king) and whether it attacks along a ray; a pawn's capture is the one-step diagonal */
  function attackers(sq, to, byWhite) {
    var out = [], tf = to & 7, tr = to >> 3, f, r, p, i, d;
    function mine(p) { return p && (p == p.toUpperCase()) == byWhite }
    function at(f, r) { return f >= 0 && f < 8 && r >= 0 && r < 8 ? r * 8 + f : -1 }
    var N = [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]];
    for (i = 0; i < 8; i++) { d = at(tf + N[i][0], tr + N[i][1]); if (d >= 0 && mine(sq[d]) && sq[d].toLowerCase() == 'n') out.push({ at: d, fam: 'N', ray: false }) }
    for (i = -1; i <= 1; i += 2) { d = at(tf + i, byWhite ? tr - 1 : tr + 1); if (d >= 0 && mine(sq[d]) && sq[d].toLowerCase() == 'p') out.push({ at: d, fam: 'D', ray: false }) }
    for (f = -1; f <= 1; f++) for (r = -1; r <= 1; r++) { if (!f && !r) continue; d = at(tf + f, tr + r); if (d >= 0 && mine(sq[d]) && sq[d].toLowerCase() == 'k') out.push({ at: d, fam: 'K', ray: false }) }
    var R = [[1, 0, 'S'], [-1, 0, 'S'], [0, 1, 'S'], [0, -1, 'S'], [1, 1, 'D'], [1, -1, 'D'], [-1, 1, 'D'], [-1, -1, 'D']];
    for (i = 0; i < 8; i++) { f = tf; r = tr;
      for (;;) { f += R[i][0]; r += R[i][1]; d = at(f, r); if (d < 0) break; p = sq[d]; if (!p) continue;
        if (mine(p)) { var t = p.toLowerCase(); if (t == 'q' || (R[i][2] == 'S' ? t == 'r' : t == 'b')) out.push({ at: d, fam: R[i][2], ray: true }) }
        break } }
    return out }
  return fenProblem;
})();

/* ═══════════════════════════════ the verdict ═══════════════════════════════
   judge() answers for one FEN line what the arbiter answers when the flag of `side` falls, and
   records every test on the way. It returns null for a line that is not a valid FEN, and then
   badReason says which condition it breaks.

   draw    the flagged side's opponent can never mate; reason: the first rung that proves it:
             material   the material test (insufficient material),
             lock       the lock detector (a locked position),
             domino     the Domino search (a short forced line: the Domino effect),
             stalemate  no legal move and no check at the root;
   dead    a draw where the flagged side cannot mate either: a dead position (FIDE 5.2.2);
   win     otherwise; reason: mate (the search found a mating line) or open (no proof within the
           limits, so the win stands by default). */
let badReason = null;
function readFen(fen) {
  badReason = fenProblem(fen);
  if (badReason) return null;
  const setup = E.fromFen(fen);
  if (setup.error) { badReason = setup.error === 'castling' ? { k: 'castle' } : { k: 'engine', a: [setup.error] }; return null; }
  return setup;
}
function judge(fen, ply, bud, forced) {
  const setup = readFen(fen);
  if (!setup) return null;
  const pos = setup.position, limits = { maxPly: ply, budget: bud };
  const side = forced === 0 || forced === 1 ? forced : (pos.side === E.WHITE ? 1 : 0);
  const flagged = side ? E.WHITE : E.BLACK, other = side ? E.BLACK : E.WHITE;
  const moves = E.legalMoves(pos).length;
  const t0 = performance.now();
  const proof = E.proveCannotBeMated(pos, flagged, limits);
  const ms = performance.now() - t0;
  let reason;
  if (proof.proven) reason = proof.nodes > 0 ? 'domino' : E.materialCannotMate(pos, flagged) ? 'material' : proof.staticProof ? 'lock' : 'stalemate';
  else reason = proof.failure === 'mate' ? 'mate' : 'open';
  const dead = proof.proven && E.proveCannotBeMated(pos, other, limits).proven;
  return {
    side, n: pos.halfmove, nGiven: setup.halfmoveGiven, ep: pos.ep, moves,
    draw: proof.proven, dead, reason, used: proof.nodes, ms,
    why: proof.proven ? '' : proof.failure,
    castle: E.castlingField(pos),
  };
}
/* For the detail view only, never for the verdict: how the game stood before the flag (status
   without the dead-position search, which belongs to a game played move by move) and the two
   static tests against the flagged side, each on its own. */
function inspect(fen, side) {
  const setup = E.fromFen(fen);
  if (setup.error) return null;
  const pos = setup.position, flagged = side ? E.WHITE : E.BLACK;
  return { status: E.gameStatus(pos, { deadPositionSearch: false }),
           material: E.materialCannotMate(pos, flagged), lock: E.lockCannotMate(pos, flagged) };
}

var GLYPH = ' ♝♜♛♟♚♞', VAL = { b: 1, r: 2, q: 3, p: 4, k: 5, n: 6 };
var $ = function (id) { return document.getElementById(id) }, ROOT = document.getElementById('tab-arbiter');
var ENGINE_FILE = 'mateless.js';
var ENGINE_BYTES = new Blob([$('mateless-engine').textContent]).size;
var LIMITS = [E.DOMINO_PLY, E.DOMINO_BUDGET];     /* the game's own Domino search: plies, nodes */
var REPO = 'https://github.com/cuneytinann/Mateless';
var UNFAIR = 'https://chasolver.org/unfair-games';

/* ═══════════════════════════════ i18n ═══════════════════════════════ */
var DICT = {
en: {
 title: "Mateless arbiter",
 navArb: "Arbiter",
 navCha: "chasolver",
 lblLang: "Language",
 h1: "When a flag falls, can the other side still mate?",
 lede: "If it cannot, by any series of legal moves, the game is drawn (FIDE 6.9). Mateless proves that in three ways: <b>insufficient material</b>, a <b>locked position</b> of pawns, kings and bishops that no move can open, or a short <b>forced line</b>, the Domino effect. Paste positions or drop chasolver’s CSV files and see each verdict with the test that settled it.",
 sp1n: "~90 ns",
 sp1t: "to prove a locked position in Rust (0.3–0.8 µs in this page’s JavaScript)",
 sp2n: "~70×",
 sp2t: "faster than chasolver’s fast check on locked positions; ~17× on all of the data",
 sp3n: "99.98%",
 sp3t: "of the 195,287 Lichess games lost on time that should have been drawn, proven",
 hPos: "Positions",
 posHint: "One FEN per line. A line may start with a chasolver label (<code>WB</code>, <code>W-</code>, <code>-B</code>, <code>--</code>) to give the expected answer; lines starting with <code>#</code> are skipped. Ctrl+Enter judges.",
 hFiles: "Files",
 dropBig: "Drop CSV or TXT files here, or click to choose",
 dropSmall: "CSV: the <code>fen</code> column is read, with <code>gameId</code> and <code>label</code> if present. TXT: chasolver’s format, <code>WB &lt;fen&gt;</code> per line. Each file becomes a set named after it.",
 dataHint: "chasolver lists every Lichess game lost on time that should have been drawn: download the CSV files from <a href=\"" + UNFAIR + "\">chasolver.org/unfair-games</a> and drop them here.",
 fRows: "{0} positions",
 fBad: "{0} unreadable lines skipped",
 fLabels: "reference: the labels in the file",
 fRef: "reference",
 fRefNone: "none",
 fRefDraw: "every row is a draw",
 fRemove: "Remove {0}",
 fClear: "Remove all files",
 fReading: "Reading {0}…",
 fFail: "Could not read {0}: {1}",
 assumeH: "Whose flag fell",
 assume: "The side to move in the FEN (its second field, <code>w</code> or <code>b</code>): in a game only the clock of the side to move runs. The verdict answers one question: can the other side still mate by some series of legal moves? If it can, or if no proof is found, the other side wins on time; if it cannot, the game is drawn.",
 assumeBoth: "With “judge both flags” on, each labelled position is judged twice, once for each side’s flag, whoever is to move.",
 lblPly: "ply ceiling",
 lblBud: "node budget",
 limNote: "in a game, Mateless searches {0} plies and {1} nodes after every move",
 lblRange: "positions",
 lblRangeTo: "to",
 lblRangeNote: "in input order, pasted lines first; 0 = to the end",
 lblLab: "labels",
 lblBoth: "judge both flags",
 go1: "Judge 1 position",
 goN: "Judge {0} positions",
 go0: "Nothing to judge yet",
 goSplit: "{0} pasted + {1} from files",
 useEx: "Try an example",
 exNote: "White’s flag fell; Black cannot mate",
 goStop: "Stop",
 sProg: "{0} of {1} · {2} per second · about {3} s left",
 sDone: "Judged {0} positions in {1}: {2} µs each on average, page included.",
 sDone1: "Judged in {0} µs.",
 sStopped: "Stopped after {0} of {1} positions; the report covers those.",
 sBadN: "Invalid FEN: {0} lines ({1}). They get no verdict and stay out of every comparison with the reference.",
 rs_material: "Insufficient material",
 rs_lock: "Locked position",
 rs_domino: "Domino effect",
 rs_stalemate: "Stalemate",
 rs_mate: "Mate found",
 rs_open: "No proof",
 rs_bad: "Invalid FEN",
 rd_material: "the other side has too little material to mate at all",
 rd_lock: "pawns, kings and bishops that no series of moves can open",
 rd_domino: "every line the Domino search followed ended without mate",
 rd_stalemate: "no legal move and no check: no mate can follow",
 rd_mate: "a series of legal moves that ends in mate: the win is proven",
 rd_open: "the search hit the ply ceiling or the node budget first: the win stands by default",
 rd_bad: "set aside, with the broken condition",
 v_draw: "Draw on time",
 v_dead: "Dead position",
 v_win: "{0} wins on time",
 gDraws: "Drawn: the other side cannot mate",
 gWins: "Won on time",
 deadOf: "{0} of the {1} draws are dead positions: neither side can mate, so in a game they would have ended before the flag fell (FIDE 5.2.2).",
 secResults: "Verdicts",
 secRef: "Against the reference",
 refIntro: "{0} of {1} judged positions carry a reference: a chasolver label, or a file marked “every row is a draw”.",
 refNoRef: "None of the judged positions carries a reference, so none can be scored right or wrong. Give lines a chasolver label, or mark a file “every row is a draw”.",
 mxDraw: "draw proven",
 mxMate: "mate found",
 mxOpen: "no proof",
 mxRefDraw: "reference: draw",
 mxRefDrawS: "the other side cannot mate",
 mxRefWin: "reference: win",
 mxRefWinS: "the other side can mate",
 kOk: "agrees",
 kOkDef: "agrees, by default",
 kMiss: "missed draw",
 kBad: "false draw",
 kContra: "contradiction",
 refBad: "<b>False draws: {0}.</b> Mateless declared a draw where the reference says the other side can still mate. That would break soundness: read these first.",
 refClean: "<b>No false draw.</b> Every draw Mateless declared is backed by the reference.",
 refContra: "<b>Contradictions: {0}.</b> The search found a mate where the reference says mate is impossible. Either the reference or the move generation is wrong; each one is worth reading.",
 refMiss: "<b>Missed draws: {0}.</b> The reference says draw, but no proof was found within the limits, so the verdict fell to the win. That costs completeness, never soundness.",
 secPer: "Set by set",
 thSet: "set",
 thRows: "positions",
 thRef: "reference",
 thHor: "ply ceiling",
 thBud: "budget",
 thTot: "total",
 refKindLab: "labels",
 refKindDraw: "all draws",
 refKindMix: "partly",
 secCost: "Cost",
 thMeasure: "measure",
 thAvg: "mean",
 thMed: "median",
 thP99: "99%",
 thMax: "max",
 mNodes: "nodes spent",
 mUs: "time per position (µs)",
 costNote: "Time is the proof alone, in this page’s JavaScript, averaged over the positions: a browser rounds its clock to about 0.1 ms, so a single position’s time is measured in its detail view by repeating the proof. The Rust engine is 3–5 times faster.",
 secBrowse: "The positions",
 fShow: "show",
 fSet: "set",
 fWhy: "reason",
 fAll: "all",
 browseNote: "Open a position to see how its verdict was reached. In the detail view, ← and → step through this list.",
 noneHere: "No position matches these filters.",
 prev: "Previous",
 next: "Next",
 pgOf: "page {0} of {1} · {2} positions",
 secExp: "Download",
 expUn: "no-proof.csv",
 expMate: "mate-found.csv",
 expMiss: "missed-draw.csv",
 expBad: "false-draw.csv",
 expAll: "all-verdicts.csv",
 expInv: "invalid-fen.csv",
 expNote: "Every file has one row per position: the set, the game id, the flagged side, the verdict, its reason (<code>material</code>, <code>lock</code>, <code>domino</code>, <code>stalemate</code>, <code>mate</code>, <code>open</code>) and the nodes spent. <code>invalid-fen.csv</code> lists the lines set aside, with the broken condition.",
 vt_draw: "{0}’s flag fell, but {1} cannot mate by any series of legal moves. The game is drawn (FIDE 6.9).",
 vt_dead: "Neither side can mate by any series of legal moves: the position is dead (FIDE 5.2.2). In a game it would have ended in a draw before any flag fell.",
 vt_mate: "{0}’s flag fell, and {1} can still mate: the search found a series of legal moves that ends in mate. {1} wins on time.",
 vt_open: "{0}’s flag fell. Within the limits below nothing proved that {1} cannot mate, so {1} wins on time, by default. No false draw is possible this way; a draw may have been missed, and a complete solver can settle it after the game.",
 hSteps: "How it was decided",
 stepsNote: "The rungs of the ladder, in the order they run. The first that settles the question gives the verdict.",
 s1n: "Material",
 s2n: "Lock",
 s3n: "Domino search",
 s4n: "The other side",
 st1Yes: "{0} has too little material to mate at all. Draw.",
 st1No: "{0} still has mating material.",
 st2Yes: "Pawns, kings and bishops are locked against {0}: no series of moves opens the structure. Draw, without a single move generated.",
 st2Also: "Also locked against {0}, but material had already settled it.",
 st2No: "Not locked against {0}.",
 st2Ep: "No lock while an en passant square ({0}) stands.",
 st2Skip: "Not needed: material settled it.",
 st3Ok: "Followed every line until mate became impossible, {0} in all: {1} cannot mate. Draw by the Domino effect.",
 st3Mate: "Found a line in which {0} mates. Win on time, proven.",
 st3Hor: "A line reached the ply ceiling ({0}) without a proof. Nothing proven: the win for {1} stands by default.",
 st3Bud: "The node budget ({0}) ran out without a proof. Nothing proven: the win for {1} stands by default.",
 st3Skip: "Not needed: a static test settled it without a search.",
 st3SM: "The side to move has no legal move and is not in check: stalemate, no mate can follow. Draw.",
 st3Mated: "The side to move is already checkmated.",
 st3Root: "Returned at its root without spending a node.",
 st4Dead: "{0} cannot mate either: a dead position.",
 st4Live: "{0} could still mate, so the position is not dead; only the flag-fall rule makes it a draw.",
 tDec: "settles it",
 tNo: "no",
 tAlso: "also yes",
 tSkip: "not needed",
 tOpen: "no proof",
 tDead: "dead",
 tLive: "not dead",
 hPosition: "Position",
 kFlag: "flag fell for",
 flagToMove: "{0}, the side to move",
 flagForced: "{0}, by “judge both flags”; {1} is to move",
 kMoves: "legal moves",
 kStatus: "before the flag",
 stat0: "the game is on",
 statOver: "{0}: in a game it is already over, so no flag could fall",
 kCastle: "castling",
 kEp: "en passant",
 epNote: "{0}; while it stands, the lock detector proves nothing",
 kClock: "halfmove clock",
 noN: "0, assumed: the FEN does not give it",
 z75: "{0}; the 75-move rule has ended the game",
 kFull: "move number",
 hRun: "The proof",
 kLimits: "limits",
 limits: "{0} plies, {1} nodes",
 kUsed: "nodes spent",
 nodesN: "{0} nodes",
 node1: "1 node",
 usedOf: "{0} of {1}",
 kTime: "time",
 kStop: "search stopped by",
 rHorizon: "the ply ceiling",
 rBudget: "the node budget",
 rMate: "a mate",
 hRefD: "Reference",
 kLabel: "label",
 lab_WB: "both sides can mate",
 "lab_W-": "only White can mate",
 "lab_-B": "only Black can mate",
 "lab_--": "neither side can mate",
 refFile: "the file is marked “every row is a draw”",
 kExpect: "expected",
 expDraw: "a draw",
 expWin: "{0} wins on time: it can mate",
 kResult: "result",
 rOk: "agrees",
 rOkDef: "agrees, by default: no proof was found, and the win is the default",
 rMiss: "missed draw: the reference says draw, but no proof was found within the limits",
 rFalse: "false draw: the reference says {0} can mate, yet a draw was declared",
 rContra: "contradiction: the search found a mate that the reference says is impossible",
 hSource: "Source",
 kSet: "set",
 kId: "row",
 lbCopy: "Copy FEN",
 lbCopied: "Copied",
 openEditor: "Lichess board editor",
 openGame: "The game on Lichess",
 askCha: "Ask chasolver",
 lbClose: "Close",
 lbPrev: "Previous",
 lbNext: "Next",
 lbPos: "{0} of {1}",
 badFen: "This line is not a valid FEN: {0}",
 badNec: "These checks are necessary conditions: a line that fails one is certainly not a legal position; passing all of them does not prove that it is.",
 bad_syntax: "the FEN is malformed ({0}).",
 sx_fields: "the piece placement and the side to move are required",
 sx_nranks: "{0} ranks instead of 8",
 sx_rankw: "rank {0} does not have exactly 8 squares",
 sx_char: "unknown piece letter “{0}”",
 sx_side: "side to move “{0}”; it must be w or b",
 sx_epf: "en passant field “{0}”",
 sx_num: "number field “{0}”",
 sx_full: "fullmove number “{0}”; it starts at 1",
 bad_clock: "the halfmove clock ({0}) is larger than the number of plies played so far ({1}).",
 bad_kings: "each side must have exactly one king (White {0}, Black {1}).",
 bad_pawnrank: "a pawn stands on the first or last rank ({0}).",
 bad_pawns: "{0} has {1} pawns; at most 8 are possible.",
 bad_pieces: "{0} has {1} pieces; at most 16 are possible.",
 bad_promo: "{0} has {1} more pieces than the starting set of one queen, two rooks, two knights and one bishop on each colour; only promotions explain them, but only {2} of its pawns are missing.",
 bad_oppcheck: "the side not to move is in check; two kings standing side by side count as this too.",
 bad_check3: "the king is in check from more than two pieces.",
 bad_checkleap: "neither of the two checking pieces attacks along a ray (knight or pawn); such a double check cannot be opened.",
 bad_checkdiag: "both checking pieces move diagonally; no move can produce such a double check.",
 bad_checkstraight: "both checking pieces move along ranks and files, and the geometry of a capturing promotion does not hold.",
 bad_ep: "the en passant square is inconsistent: there is no pawn in front of it that has just advanced two squares, or the squares behind it are not empty.",
 bad_epcheck: "the en passant square says the last move was a two-square pawn advance, but that move cannot explain the check.",
 bad_castle: "the castling field could not be read or contradicts itself.",
 bad_engine: "the engine could not read it ({0}).",
 bk_syntax: "malformed",
 bk_clock: "move counters",
 bk_kings: "kings",
 bk_pawnrank: "pawn on an edge rank",
 bk_material: "material count",
 bk_oppcheck: "side not to move in check",
 bk_check: "impossible check",
 bk_ep: "en passant",
 bk_castle: "castling",
 white: "White",
 black: "Black",
 res0: "the game goes on",
 res1: "White checkmates",
 res2: "Black checkmates",
 res3: "stalemate",
 res4: "the 75-move rule",
 res5: "fivefold repetition",
 res6: "a dead position",
 secPgn: "Games",
 pgnSub: "A test of its own, separate from the positions above. Every game is replayed move by move with Mateless. After each move it checks the endings that need no claim: checkmate, stalemate, a dead position, the 75-move rule and fivefold repetition. The first one met is where the rules end the game, and any moves played after it are reported. If none comes first, the final position is judged as a flag fall: the side whose flag fell is the loser named in the Result tag, or the side to move when the result is a draw or <code>*</code>. After every move Mateless also keeps a flag per side: once a side is proven unable to mate, it stays so for the rest of the game, and the other side’s flag fall is a draw at once.",
 pgnHPaste: "PGN",
 pgnDropBig: "Drop PGN files here, or click to choose",
 pgnDropSmall: "Any number of games per file. Comments, variations and NAGs are skipped; the <code>FEN</code> and <code>Variant</code> tags are read. Chess960 works too: castling is <code>O-O</code> / <code>O-O-O</code>, and the FEN tag may give the rights as KQkq or as Shredder file letters.",
 pgnGo: "Replay {0} games",
 pgnGo1: "Replay 1 game",
 pgnGo0: "Add a PGN to replay",
 pgnN: "{0} games",
 pgnProg: "{0} of {1} games · {2} per second",
 pgnDone: "{0} games replayed in {1}.",
 pgnStopped: "Stopped after {0} of {1} games.",
 pgnFilt: "show",
 pgnFiltAll: "all games",
 pgnExp: "Download games.csv",
 pgnThCat: "finding",
 pgnThN: "games",
 pgnThGame: "game",
 pgnThPlayers: "players",
 pgnThRes: "result",
 pgnThTerm: "termination",
 pgnThPlies: "plies",
 pgnThEnd: "the rules end it",
 pgnThExtra: "plies after",
 pgnThRight: "correct result",
 pc_ok: "ended where the rules end it",
 pc_lateDP: "played on after a dead position",
 pc_lateRule: "played on after the 75-move rule or fivefold repetition",
 pc_wrongtm: "won on time or by resignation, should be a draw",
 pc_wrongres: "the result does not match the final position",
 pc_drawn: "drawn by agreement or claim (not judged)",
 pc_open: "unfinished (*)",
 pc_illegal: "illegal or ambiguous move",
 pc_unread: "unreadable or unsupported",
 perr_illegal: "Ply {0} ({1}) is not legal in this position.",
 perr_ambiguous: "Ply {0} ({1}) fits more than one legal move.",
 perr_aftermate: "Ply {0} ({1}) comes after the game was already over.",
 perr_badstart: "The starting FEN is not valid: {0}",
 perr_variant: "The variant “{0}” is not supported.",
 perr_parse: "No moves could be read.",
 pd_late: "The rules end this game after {0}: {1}. {2} more plies were played after it.",
 pd_lateStart: "The rules already end this game at the starting position: {0}. {1} plies were played after it.",
 pd_here: "The game ended where the rules end it, after {0}: {1}.",
 pd_hereStart: "The starting position is already over: {0}.",
 pd_startShort: "start",
 pd_endFirst: "The rules had already ended the game after {0}: {1}.",
 pd_final: "No ending came first, so the final position is judged as if {0}’s flag had fallen: {1}.",
 pd_known: "{0} had been proven unable to mate earlier in the game, so no new search was needed.",
 pk_players: "players",
 pk_res: "PGN result",
 pk_right: "correct result",
 pk_moves: "Moves",
 secEngine: "The engine on this page",
 engineNote: "<code>mateless.js</code>, exactly as it runs here ({0} bytes): a reference board, the material test, the lock detector, the Domino search and a flag per side that a game keeps move by move. The same engine is in the repository, with its Rust port and WebAssembly build.",
 foot: "Mateless never declares a draw without a proof: a position it cannot prove falls to the win and is left to a complete solver after the game. Its verdicts were checked against chasolver’s labels, and every flag that came down in thousands of games against chasolver’s full analysis, with no false draw. MIT License, © 2026 Cüneyt İnan. Source, Rust port and data: <a href=\"" + REPO + "\">github.com/cuneytinann/Mateless</a>. Lichess data: Miguel Ambrona’s <a href=\"" + UNFAIR + "\">chasolver.org/unfair-games</a>.",
},
tr: {
 title: "Mateless hakemi",
 navArb: "Hakem",
 navCha: "chasolver",
 lblLang: "Dil",
 h1: "Bayrak düştüğünde öbür taraf hâlâ mat edebilir mi?",
 lede: "Hiçbir legal hamle dizisiyle edemiyorsa oyun berabere biter (FIDE 6.9). Mateless bunu üç yoldan ispatlıyor: <b>yetersiz materyal</b>; piyon, şah ve fillerden hiçbir hamlenin açamayacağı <b>kilitli bir pozisyon</b>; ya da kısa bir <b>zorunlu hat</b>, yani Domino etkisi. Pozisyonları yapıştır ya da chasolver’ın CSV dosyalarını bırak; her hükmü, onu belirleyen testle birlikte gör.",
 sp1n: "~90 ns",
 sp1t: "Rust’ta kilitli bir pozisyonu ispatlama süresi (bu sayfanın JavaScript’inde 0,3–0,8 µs)",
 sp2n: "~70×",
 sp2t: "kilitli pozisyonlarda chasolver’ın hızlı kontrolünden hızlı; verinin tamamında ~17×",
 sp3n: "%99,98",
 sp3t: "berabere bitmesi gerekirken süreden kaybedilmiş 195.287 Lichess oyununun ispatlanan payı",
 hPos: "Pozisyonlar",
 posHint: "Her satıra bir FEN. Satır, beklenen cevabı vermek için bir chasolver etiketiyle (<code>WB</code>, <code>W-</code>, <code>-B</code>, <code>--</code>) başlayabilir; <code>#</code> ile başlayan satırlar atlanır. Ctrl+Enter hüküm verir.",
 hFiles: "Dosyalar",
 dropBig: "CSV ya da TXT dosyalarını buraya bırak ya da seçmek için tıkla",
 dropSmall: "CSV: <code>fen</code> sütunu, varsa <code>gameId</code> ve <code>label</code> da okunur. TXT: chasolver biçimi, satır başına <code>WB &lt;fen&gt;</code>. Her dosya, adını taşıyan bir küme olur.",
 dataHint: "chasolver, berabere bitmesi gerekirken süreden kaybedilmiş bütün Lichess oyunlarını listeliyor: CSV dosyalarını <a href=\"" + UNFAIR + "\">chasolver.org/unfair-games</a> adresinden indirip buraya bırak.",
 fRows: "{0} pozisyon",
 fBad: "{0} okunamayan satır atlandı",
 fLabels: "referans: dosyadaki etiketler",
 fRef: "referans",
 fRefNone: "yok",
 fRefDraw: "her satır berabere",
 fRemove: "{0} dosyasını kaldır",
 fClear: "Tüm dosyaları kaldır",
 fReading: "{0} okunuyor…",
 fFail: "{0} okunamadı: {1}",
 assumeH: "Kimin bayrağı düştü",
 assume: "FEN’de sırası gelen taraf (ikinci alan, <code>w</code> ya da <code>b</code>): oyunda yalnızca sırası gelenin saati işler. Hüküm tek bir soruyu cevaplar: öbür taraf herhangi bir legal hamle dizisiyle hâlâ mat edebilir mi? Edebiliyorsa ya da ispat bulunamazsa öbür taraf süreden kazanır; edemiyorsa oyun berabere biter.",
 assumeBoth: "“İki bayrağı da dene” açıkken etiketli her pozisyon, sıra kimde olursa olsun, iki kez yargılanır: her iki tarafın bayrağı için birer kez.",
 lblPly: "ply tavanı",
 lblBud: "düğüm bütçesi",
 limNote: "oyunda Mateless her hamleden sonra {0} ply ve {1} düğümle arar",
 lblRange: "pozisyonlar",
 lblRangeTo: "–",
 lblRangeNote: "giriş sırasıyla, yapıştırılanlar önce; 0 = sona kadar",
 lblLab: "etiketler",
 lblBoth: "iki bayrağı da dene",
 go1: "1 pozisyona hüküm ver",
 goN: "{0} pozisyona hüküm ver",
 go0: "Henüz yargılanacak pozisyon yok",
 goSplit: "{0} yapıştırılan + {1} dosyalardan",
 useEx: "Bir örnek dene",
 exNote: "Beyaz’ın bayrağı düştü; Siyah mat edemez",
 goStop: "Durdur",
 sProg: "{0} / {1} · saniyede {2} · kalan ~{3} sn",
 sDone: "{0} pozisyon {1} içinde yargılandı: sayfa dahil ortalama {2} µs.",
 sDone1: "{0} µs’de yargılandı.",
 sStopped: "{1} pozisyonun {0} tanesinden sonra durduruldu; rapor onları kapsıyor.",
 sBadN: "Geçersiz FEN: {0} satır ({1}). Bu satırlar hüküm almaz ve referansla hiçbir karşılaştırmaya girmez.",
 rs_material: "Yetersiz materyal",
 rs_lock: "Kilitli pozisyon",
 rs_domino: "Domino etkisi",
 rs_stalemate: "Pat",
 rs_mate: "Mat bulundu",
 rs_open: "İspat yok",
 rs_bad: "Geçersiz FEN",
 rd_material: "öbür tarafın mat edecek kadar materyali hiç yok",
 rd_lock: "piyon, şah ve fillerden hiçbir hamle dizisinin açamayacağı bir yapı",
 rd_domino: "Domino aramasının izlediği her hat matsız bitti",
 rd_stalemate: "legal hamle yok, şah da yok: ardından mat gelemez",
 rd_mate: "matla biten bir legal hamle dizisi: galibiyet ispatlı",
 rd_open: "arama önce ply tavanına ya da düğüm bütçesine çarptı: galibiyet varsayılan olarak kalıyor",
 rd_bad: "bozulan şartla birlikte ayrıldı",
 v_draw: "Süreden beraberlik",
 v_dead: "Ölü pozisyon",
 v_win: "{0} süreden kazanır",
 gDraws: "Berabere: öbür taraf mat edemez",
 gWins: "Süreden kazanılan",
 deadOf: "{1} beraberliğin {0} tanesi ölü pozisyon: iki taraf da mat edemiyor; oyunda bayrak düşmeden önce bitmiş olurlardı (FIDE 5.2.2).",
 secResults: "Hükümler",
 secRef: "Referansa karşı",
 refIntro: "Yargılanan {1} pozisyonun {0} tanesinde referans var: bir chasolver etiketi ya da “her satır berabere” diye işaretlenmiş bir dosya.",
 refNoRef: "Yargılanan pozisyonların hiçbirinde referans yok; hiçbiri doğru ya da yanlış diye puanlanamaz. Satırlara chasolver etiketi ver ya da bir dosyayı “her satır berabere” diye işaretle.",
 mxDraw: "beraberlik ispatlandı",
 mxMate: "mat bulundu",
 mxOpen: "ispat yok",
 mxRefDraw: "referans: berabere",
 mxRefDrawS: "öbür taraf mat edemez",
 mxRefWin: "referans: galibiyet",
 mxRefWinS: "öbür taraf mat edebilir",
 kOk: "uyuşuyor",
 kOkDef: "uyuşuyor, varsayılanla",
 kMiss: "kaçan beraberlik",
 kBad: "yanlış beraberlik",
 kContra: "çelişki",
 refBad: "<b>Yanlış beraberlik: {0}.</b> Mateless, referansın öbür tarafın hâlâ mat edebileceğini söylediği yerde beraberlik ilan etti. Bu sağlamlığı bozardı: önce bunları oku.",
 refClean: "<b>Yanlış beraberlik yok.</b> Mateless’in ilan ettiği her beraberliği referans doğruluyor.",
 refContra: "<b>Çelişki: {0}.</b> Arama, referansın mat imkânsız dediği yerde mat buldu. Ya referans ya hamle üretimi yanlış; her biri okunmaya değer.",
 refMiss: "<b>Kaçan beraberlik: {0}.</b> Referans berabere diyor ama sınırlar içinde ispat bulunamadı; hüküm galibiyete düştü. Bu tamlıktan götürür, sağlamlıktan asla.",
 secPer: "Küme küme",
 thSet: "küme",
 thRows: "pozisyon",
 thRef: "referans",
 thHor: "ply tavanı",
 thBud: "bütçe",
 thTot: "toplam",
 refKindLab: "etiket",
 refKindDraw: "hepsi berabere",
 refKindMix: "kısmen",
 secCost: "Maliyet",
 thMeasure: "ölçü",
 thAvg: "ortalama",
 thMed: "medyan",
 thP99: "%99",
 thMax: "en çok",
 mNodes: "harcanan düğüm",
 mUs: "pozisyon başına süre (µs)",
 costNote: "Süre yalnızca ispatın kendisi; bu sayfanın JavaScript’inde, pozisyonların ortalaması: tarayıcı saatini ~0,1 ms’ye yuvarlar, bu yüzden tek bir pozisyonun süresi ayrıntı görünümünde ispat tekrarlanarak ölçülür. Rust motoru 3–5 kat hızlı.",
 secBrowse: "Pozisyonlar",
 fShow: "göster",
 fSet: "küme",
 fWhy: "gerekçe",
 fAll: "hepsi",
 browseNote: "Hükmün nasıl çıktığını görmek için bir pozisyonu aç. Ayrıntı görünümünde ← ve → bu listede gezinir.",
 noneHere: "Bu süzgeçlere uyan pozisyon yok.",
 prev: "Önceki",
 next: "Sonraki",
 pgOf: "sayfa {0} / {1} · {2} pozisyon",
 secExp: "İndir",
 expUn: "no-proof.csv",
 expMate: "mate-found.csv",
 expMiss: "missed-draw.csv",
 expBad: "false-draw.csv",
 expAll: "all-verdicts.csv",
 expInv: "invalid-fen.csv",
 expNote: "Her dosyada pozisyon başına bir satır var: küme, oyun kimliği, bayrağı düşen taraf, hüküm, gerekçesi (<code>material</code>, <code>lock</code>, <code>domino</code>, <code>stalemate</code>, <code>mate</code>, <code>open</code>) ve harcanan düğüm. <code>invalid-fen.csv</code> ayrılan satırları bozulan şartla birlikte listeler.",
 vt_draw: "{0} tarafının bayrağı düştü, ama {1} hiçbir legal hamle dizisiyle mat edemez. Oyun berabere (FIDE 6.9).",
 vt_dead: "İki taraf da hiçbir legal hamle dizisiyle mat edemez: pozisyon ölü (FIDE 5.2.2). Oyunda bayrak düşmeden önce berabere bitmiş olurdu.",
 vt_mate: "{0} tarafının bayrağı düştü ve {1} hâlâ mat edebilir: arama matla biten bir legal hamle dizisi buldu. {1} süreden kazanır.",
 vt_open: "{0} tarafının bayrağı düştü. Aşağıdaki sınırlar içinde {1} tarafının mat edemeyeceğini hiçbir şey ispatlamadı; {1} varsayılan olarak süreden kazanır. Bu yoldan yanlış beraberlik olmaz; bir beraberlik kaçmış olabilir, onu oyundan sonra tam bir çözücü çözer.",
 hSteps: "Nasıl karar verildi",
 stepsNote: "Merdivenin basamakları, çalıştıkları sırayla. Soruyu ilk çözen hükmü verir.",
 s1n: "Materyal",
 s2n: "Kilit",
 s3n: "Domino araması",
 s4n: "Öbür taraf",
 st1Yes: "{0} tarafının mat edecek kadar materyali hiç yok. Berabere.",
 st1No: "{0} tarafında hâlâ mat edecek materyal var.",
 st2Yes: "Piyon, şah ve filler {0} tarafına karşı kilitli: hiçbir hamle dizisi yapıyı açamaz. Berabere; tek bir hamle üretilmeden.",
 st2Also: "{0} tarafına karşı da kilitli, ama materyal zaten çözmüştü.",
 st2No: "{0} tarafına karşı kilitli değil.",
 st2Ep: "Geçerken alma karesi ({0}) dururken kilit olmaz.",
 st2Skip: "Gerek yok: materyal çözdü.",
 st3Ok: "Her hat mat imkânsızlaşana dek izlendi, toplam {0}: {1} mat edemez. Domino etkisiyle berabere.",
 st3Mate: "{0} tarafının mat ettiği bir hat bulundu. Süreden galibiyet, ispatlı.",
 st3Hor: "Bir hat ispat olmadan ply tavanına ({0}) ulaştı. Hiçbir şey ispatlanmadı: {1} lehine galibiyet varsayılan olarak kalıyor.",
 st3Bud: "Düğüm bütçesi ({0}) ispat olmadan tükendi. Hiçbir şey ispatlanmadı: {1} lehine galibiyet varsayılan olarak kalıyor.",
 st3Skip: "Gerek yok: statik bir test aramasız çözdü.",
 st3SM: "Sırası gelenin legal hamlesi yok ve şah altında değil: pat; ardından mat gelemez. Berabere.",
 st3Mated: "Sırası gelen zaten mat olmuş.",
 st3Root: "Kökünde, tek düğüm harcamadan döndü.",
 st4Dead: "{0} da mat edemez: ölü pozisyon.",
 st4Live: "{0} hâlâ mat edebilirdi; pozisyon ölü değil, beraberliği yalnızca bayrak kuralı getiriyor.",
 tDec: "çözdü",
 tNo: "hayır",
 tAlso: "bu da evet",
 tSkip: "gerek yok",
 tOpen: "ispat yok",
 tDead: "ölü",
 tLive: "ölü değil",
 hPosition: "Pozisyon",
 kFlag: "bayrağı düşen",
 flagToMove: "{0}, sırası gelen",
 flagForced: "{0}, “iki bayrağı da dene” ile; sıra {1} tarafında",
 kMoves: "legal hamle",
 kStatus: "bayraktan önce",
 stat0: "oyun sürüyor",
 statOver: "{0}: oyunda zaten bitmiş olurdu; bayrak düşemezdi",
 kCastle: "rok",
 kEp: "geçerken alma",
 epNote: "{0}; dururken kilit dedektörü hiçbir şey ispatlamaz",
 kClock: "yarım hamle sayacı",
 noN: "0, varsayıldı: FEN’de yok",
 z75: "{0}; 75 hamle kuralı oyunu bitirmiş",
 kFull: "hamle numarası",
 hRun: "İspat",
 kLimits: "sınırlar",
 limits: "{0} ply, {1} düğüm",
 kUsed: "harcanan düğüm",
 nodesN: "{0} düğüm",
 node1: "1 düğüm",
 usedOf: "{1} düğümün {0} tanesi",
 kTime: "süre",
 kStop: "aramayı durduran",
 rHorizon: "ply tavanı",
 rBudget: "düğüm bütçesi",
 rMate: "bir mat",
 hRefD: "Referans",
 kLabel: "etiket",
 lab_WB: "iki taraf da mat edebilir",
 "lab_W-": "yalnız Beyaz mat edebilir",
 "lab_-B": "yalnız Siyah mat edebilir",
 "lab_--": "iki taraf da mat edemez",
 refFile: "dosya “her satır berabere” diye işaretli",
 kExpect: "beklenen",
 expDraw: "beraberlik",
 expWin: "{0} süreden kazanır: mat edebilir",
 kResult: "sonuç",
 rOk: "uyuşuyor",
 rOkDef: "uyuşuyor, varsayılanla: ispat bulunamadı, galibiyet de varsayılan hüküm",
 rMiss: "kaçan beraberlik: referans berabere diyor ama sınırlar içinde ispat bulunamadı",
 rFalse: "yanlış beraberlik: referansa göre {0} mat edebilir, ama beraberlik ilan edildi",
 rContra: "çelişki: arama, referansın imkânsız dediği bir mat buldu",
 hSource: "Kaynak",
 kSet: "küme",
 kId: "satır",
 lbCopy: "FEN’i kopyala",
 lbCopied: "Kopyalandı",
 openEditor: "Lichess tahta düzenleyicisi",
 openGame: "Lichess’teki oyun",
 askCha: "chasolver’a sor",
 lbClose: "Kapat",
 lbPrev: "Önceki",
 lbNext: "Sonraki",
 lbPos: "{0} / {1}",
 badFen: "Bu satır geçerli bir FEN değil: {0}",
 badNec: "Bu denetimler zorunlu şartlardır: birini bozan satır kesinlikle geçerli bir pozisyon değildir; hepsinden geçmek ise geçerliliği kanıtlamaz.",
 bad_syntax: "FEN’in yazımı bozuk ({0}).",
 sx_fields: "taş dizilimi ve sıra alanı gerekli",
 sx_nranks: "8 yerine {0} yatay var",
 sx_rankw: "{0}. yatayda tam 8 kare yok",
 sx_char: "tanınmayan taş harfi “{0}”",
 sx_side: "sıra alanı “{0}”; w ya da b olmalı",
 sx_epf: "geçerken alma alanı “{0}”",
 sx_num: "sayı alanı “{0}”",
 sx_full: "tam hamle numarası “{0}”; 1’den başlar",
 bad_clock: "yarım hamle sayacı ({0}) şimdiye kadar oynanmış yarım hamle sayısından ({1}) büyük.",
 bad_kings: "her tarafta tam bir şah olmalı (Beyaz {0}, Siyah {1}).",
 bad_pawnrank: "ilk ya da son yatayda piyon var ({0}).",
 bad_pawns: "{0} tarafında {1} piyon var; en fazla 8 olabilir.",
 bad_pieces: "{0} tarafında {1} taş var; en fazla 16 olabilir.",
 bad_promo: "{0} tarafında başlangıç takımından (bir vezir, iki kale, iki at, her renkte bir fil) {1} fazla taş var; bunları ancak terfi açıklar, ama yalnızca {2} piyonu eksik.",
 bad_oppcheck: "sırası olmayan taraf şah altında; yan yana duran iki şah da bu sayılır.",
 bad_check3: "şah ikiden fazla taştan tehdit ediliyor.",
 bad_checkleap: "şah çeken iki taşın hiçbiri ışın boyunca tehdit etmiyor (at ya da piyon); böyle bir çifte şah açılamaz.",
 bad_checkdiag: "şah çeken iki taş da çapraz gidiyor; böyle bir çifte şah hiçbir hamleyle oluşamaz.",
 bad_checkstraight: "şah çeken iki taş da düz gidiyor ve alarak terfi geometrisi tutmuyor.",
 bad_ep: "geçerken alma karesi tutarsız: önünde iki kare ilerlemiş bir piyon yok ya da arkasındaki kareler boş değil.",
 bad_epcheck: "geçerken alma karesi son hamlenin iki kare piyon ilerleyişi olduğunu söylüyor, ama şah bu hamleyle açıklanamıyor.",
 bad_castle: "rok alanı okunamadı ya da kendi içinde çelişiyor.",
 bad_engine: "motor bu FEN’i okuyamadı ({0}).",
 bk_syntax: "yazım",
 bk_clock: "sayaçlar",
 bk_kings: "şah sayısı",
 bk_pawnrank: "kenar yatayda piyon",
 bk_material: "materyal sayımı",
 bk_oppcheck: "sırası olmayan taraf şah altında",
 bk_check: "imkânsız şah",
 bk_ep: "geçerken alma",
 bk_castle: "rok",
 white: "Beyaz",
 black: "Siyah",
 res0: "oyun sürüyor",
 res1: "Beyaz mat etti",
 res2: "Siyah mat etti",
 res3: "pat",
 res4: "75 hamle kuralı",
 res5: "beşli tekrar",
 res6: "ölü pozisyon",
 secPgn: "Oyunlar",
 pgnSub: "Yukarıdaki pozisyonlardan ayrı, kendi başına bir test. Her oyun Mateless ile hamle hamle yeniden oynanır. Her hamleden sonra talep gerektirmeyen bitişlere bakılır: mat, pat, ölü pozisyon, 75 hamle kuralı ve beşli tekrar. İlk karşılaşılan, kuralların oyunu bitirdiği yerdir; ondan sonra oynanan hamleler raporlanır. Hiçbiri önce gelmezse son pozisyon bayrak düşüşü olarak değerlendirilir: bayrağı düşen, Result etiketindeki kaybedendir; sonuç berabere ya da <code>*</code> ise sırası gelen taraftır. Mateless her hamleden sonra taraf başına bir bayrak da tutar: bir tarafın mat edemeyeceği ispatlanınca oyunun geri kalanında da öyle kalır ve öbür tarafın bayrak düşüşü o an beraberliktir.",
 pgnHPaste: "PGN",
 pgnDropBig: "PGN dosyalarını buraya bırak ya da seçmek için tıkla",
 pgnDropSmall: "Bir dosyada istediğin kadar oyun olabilir. Yorumlar, varyantlar ve NAG’ler atlanır; <code>FEN</code> ve <code>Variant</code> etiketleri okunur. Chess960 da olur: rok <code>O-O</code> / <code>O-O-O</code> diye yazılır, FEN etiketi de hakları KQkq ya da Shredder sütun harfleriyle verebilir.",
 pgnGo: "{0} oyunu yeniden oynat",
 pgnGo1: "1 oyunu yeniden oynat",
 pgnGo0: "Yeniden oynatmak için PGN ekle",
 pgnN: "{0} oyun",
 pgnProg: "{0} / {1} oyun · saniyede {2}",
 pgnDone: "{0} oyun {1} içinde yeniden oynandı.",
 pgnStopped: "{1} oyunun {0} tanesinden sonra durduruldu.",
 pgnFilt: "göster",
 pgnFiltAll: "bütün oyunlar",
 pgnExp: "games.csv indir",
 pgnThCat: "bulgu",
 pgnThN: "oyun",
 pgnThGame: "oyun",
 pgnThPlayers: "oyuncular",
 pgnThRes: "sonuç",
 pgnThTerm: "bitiş nedeni",
 pgnThPlies: "yarım hamle",
 pgnThEnd: "kuralların bitirdiği yer",
 pgnThExtra: "sonrasında",
 pgnThRight: "doğru sonuç",
 pc_ok: "kuralların bitirdiği yerde bitmiş",
 pc_lateDP: "ölü pozisyondan sonra oynanmış",
 pc_lateRule: "75 hamle kuralından ya da beşli tekrardan sonra oynanmış",
 pc_wrongtm: "süreden ya da terkle kazanılmış, berabere olmalıydı",
 pc_wrongres: "sonuç son pozisyonla uyuşmuyor",
 pc_drawn: "anlaşma ya da taleple berabere (değerlendirilmedi)",
 pc_open: "bitmemiş (*)",
 pc_illegal: "yasadışı ya da belirsiz hamle",
 pc_unread: "okunamayan ya da desteklenmeyen",
 perr_illegal: "{0}. yarım hamle ({1}) bu pozisyonda yasal değil.",
 perr_ambiguous: "{0}. yarım hamle ({1}) birden fazla yasal hamleye uyuyor.",
 perr_aftermate: "{0}. yarım hamle ({1}) oyun zaten bittikten sonra geliyor.",
 perr_badstart: "Başlangıç FEN’i geçerli değil: {0}",
 perr_variant: "“{0}” varyantı desteklenmiyor.",
 perr_parse: "Hiç hamle okunamadı.",
 pd_late: "Kurallar bu oyunu {0} hamlesinden sonra bitiriyor: {1}. Ondan sonra {2} yarım hamle daha oynanmış.",
 pd_lateStart: "Kurallar bu oyunu daha başlangıç pozisyonunda bitiriyor: {0}. Ondan sonra {1} yarım hamle oynanmış.",
 pd_here: "Oyun kuralların bitirdiği yerde, {0} hamlesinden sonra bitmiş: {1}.",
 pd_hereStart: "Oyun başlangıç pozisyonunda zaten bitmiş: {0}.",
 pd_startShort: "başlangıç",
 pd_endFirst: "Kurallar oyunu zaten {0} hamlesinden sonra bitirmişti: {1}.",
 pd_final: "Daha önce bir bitiş gelmedi; son pozisyon, {0} tarafının bayrağı düşmüş gibi değerlendirildi: {1}.",
 pd_known: "{0} tarafının mat edemeyeceği oyunun daha önceki bir anında ispatlanmıştı; yeni arama gerekmedi.",
 pk_players: "oyuncular",
 pk_res: "PGN sonucu",
 pk_right: "doğru sonuç",
 pk_moves: "Hamleler",
 secEngine: "Bu sayfadaki motor",
 engineNote: "<code>mateless.js</code>, burada çalıştığı haliyle ({0} bayt): bir referans tahta, materyal testi, kilit dedektörü, Domino araması ve bir oyunun hamle hamle tuttuğu taraf başına bir bayrak. Aynı motor, Rust çevirisi ve WebAssembly derlemesiyle birlikte repoda.",
 foot: "Mateless ispatı olmadan hiçbir zaman beraberlik demez: ispatlayamadığı pozisyon galibiyete düşer ve oyundan sonra tam bir çözücüye kalır. Hükümleri chasolver’ın etiketlerine, binlerce oyunda düşen her bayrak da chasolver’ın tam analizine karşı denetlendi; hiç yanlış beraberlik çıkmadı. MIT Lisansı, © 2026 Cüneyt İnan. Kaynak, Rust çevirisi ve veri: <a href=\"" + REPO + "\">github.com/cuneytinann/Mateless</a>. Lichess verisi: Miguel Ambrona’nın <a href=\"" + UNFAIR + "\">chasolver.org/unfair-games</a> sayfası.",
}};
var lang = 'en';
function T(k) { var v = DICT[lang][k]; return v === undefined ? DICT.en[k] : v }
function F(k) { var A = arguments; return T(k).replace(/\{(\d+)\}/g, function (_, i) { return A[+i + 1] }) }
function num(x) { return Number(x).toLocaleString(lang == 'tr' ? 'tr-TR' : 'en-US') }
function dec(x, f) { return Number(x).toLocaleString(lang == 'tr' ? 'tr-TR' : 'en-US', { minimumFractionDigits: f, maximumFractionDigits: f }) }
function nodes(n) { return n === 1 ? T('node1') : F('nodesN', num(n)) }
function dur(secs) { return secs < 1 ? num(Math.round(secs * 1000)) + ' ms' : dec(secs, secs < 10 ? 1 : 0) + (lang == 'tr' ? ' sn' : ' s') }
function us(ms) { var u = ms * 1000; return u < 10 ? dec(u, 1) : num(Math.round(u)) }
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') }
function pct(x, y) { return y ? dec(100 * x / y, 2) + '%' : '—' }
function sideName(g) { return g ? T('white') : T('black') }
/* the reason an invalid line was set aside, in words; p is what fenProblem or readFen returned */
function badText(p) {
  if (!p) return T('bad_castle');
  var a = p.a || [];
  if (p.k == 'syntax') return F('bad_syntax', F('sx_' + a[0], a[1], a[2]));
  if (p.k == 'pawns' || p.k == 'pieces' || p.k == 'promo') return F('bad_' + p.k, sideName(a[0] == 'w' ? 1 : 0), num(a[1]), num(a[2]));
  if (p.k == 'kings' || p.k == 'pawnrank' || p.k == 'clock') return F('bad_' + p.k, num(a[0]), num(a[1]));
  if (p.k == 'engine') return F('bad_engine', esc(a[0]));
  return T('bad_' + p.k) }
/* the short group a reason is counted under in the summary and on the cards */
function bkOf(k) { return { syntax: 'bk_syntax', kings: 'bk_kings', pawnrank: 'bk_pawnrank', pawns: 'bk_material', pieces: 'bk_material',
  promo: 'bk_material', clock: 'bk_clock', oppcheck: 'bk_oppcheck', check3: 'bk_check', checkleap: 'bk_check', checkdiag: 'bk_check',
  checkstraight: 'bk_check', ep: 'bk_ep', epcheck: 'bk_ep', castle: 'bk_castle', engine: 'bk_syntax' }[k] || 'bk_syntax' }

/* ═══════════════════════════════ verdicts in words ═══════════════════════════════ */
/* outcome: what the arbiter established, with no reference involved */
function outcome(r) { return !r ? 'bad' : r.draw ? 'draw' : r.reason == 'mate' ? 'mate' : 'open' }
/* the colour class of an outcome */
function kind(o) { return o == 'draw' ? 'k-draw' : o == 'mate' ? 'k-win' : o == 'open' ? 'k-open' : 'k-bad' }
/* the result as a chess score: White's flag fell (side 1), so a win is Black's, 0–1 */
function score(r) { return r.draw ? '½–½' : r.side ? '0–1' : '1–0' }
/* the result in words */
function verdictWords(r) { return r.draw ? T(r.dead ? 'v_dead' : 'v_draw') : F('v_win', sideName(1 - r.side)) }
function reasonOf(r) { return r ? r.reason : 'bad' }

/* ═══════════════════════════════ board ═══════════════════════════════ */
function sqName(i) { return 'abcdefgh'.charAt(i % 8) + (1 + (i >> 3)) }
/* flag: the side whose flag fell (1 White, 0 Black) gets its king's square marked; big: coordinates */
function drawBoard(fen, flag, big) {
  var board = String(fen).split(/\s+/)[0], sq = new Array(64).fill(0), rk = 7, fl = 0, k, ch, ty, out = '';
  for (k = 0; k < board.length; k++) { ch = board[k];
    if (ch == '/') { rk--; fl = 0 } else if (ch >= '1' && ch <= '8') { fl += +ch }
    else { ty = VAL[ch.toLowerCase()]; if (ty && rk >= 0 && fl < 8) sq[rk * 8 + fl] = ty * 2 + (ch == ch.toUpperCase() ? 1 : 0); fl++ } }
  for (rk = 7; rk >= 0; rk--) for (fl = 0; fl < 8; fl++) { var u = rk * 8 + fl, p = sq[u], cls = ((fl + rk) % 2) == 0 ? 'd' : 'l';
    if (p) cls += (p & 1) ? ' w' : ' b';
    if (p >> 1 == 5 && (p & 1) === flag) cls += ' fk';
    out += '<i class="' + cls + '">' + (p ? GLYPH[p >> 1] + '︎' : '') +
      (big && fl == 0 ? '<s class="rk">' + (rk + 1) + '</s>' : '') + (big && rk == 0 ? '<s class="fl">' + 'abcdefgh'.charAt(fl) + '</s>' : '') + '</i>' }
  return '<div class="bd' + (big ? ' big' : '') + '" role="img" aria-label="' + esc(board) + '">' + out + '</div>' }
var editor = function (f) { return 'https://lichess.org/editor/' + f.replace(/ /g, '_') };
/* chasolver's page, asked whether the flagged side's opponent can mate */
var askCha = function (f, side) { return '#chasolver?fen=' + encodeURIComponent(f) + '&side=' + (side ? 'black' : 'white') };
function ply() { return +$('ply').value | 0 } function bud() { return +$('bud').value | 0 }
function say(s) { $('stat').innerHTML = s }

/* ═══════════════════════════════ input: pasted lines and files ═══════════════════════════════ */
var LABS = ['WB', 'W-', '-B', '--'], labSel = { WB: 1, 'W-': 1, '-B': 1, '--': 1 };
var files = [], fileSeq = 0;
function sideOf(fen) { return (String(fen).split(/\s+/)[1] || 'w') == 'w' ? 1 : 0 }
/* the reference's answer for the side g whose flag fell: can g's opponent mate?
   g=1 (White's flag) → can Black mate → the label's second letter; g=0 → its first letter */
function refDraw(lab, g) { return lab.charAt(g ? 1 : 0) == '-' }
function parsePaste() {
  var lines = $('fen').value.split(/\r?\n/), out = [], i, L, m;
  for (i = 0; i < lines.length; i++) { L = lines[i].trim();
    if (!L || L.charAt(0) == '#') continue;
    m = L.match(/^(WB|W-|-B|--)[ \t]+(\S.*)$/);
    out.push({ set: 'pasted', id: 'pasted:' + (i + 1), fen: m ? m[2].trim() : L, lab: m ? m[1] : undefined }) }
  return out }
function parseTXT(text, f) {
  var lines = text.split(/\r?\n/), out = [], bad = 0, i, L, m;
  for (i = 0; i < lines.length; i++) { L = lines[i].trim();
    if (!L || L.charAt(0) == '#') continue;
    m = L.match(/^(WB|W-|-B|--)[ \t]+(\S.*)$/);
    if (!m) { bad++; continue }
    out.push({ set: f.set, id: f.set + ':' + (out.length + 1), fen: m[2].trim(), lab: m[1], file: f }) }
  return { rows: out, bad: bad, head: '' } }
function looksTXT(text) {
  var lines = text.split(/\r?\n/), i, L;
  for (i = 0; i < lines.length && i < 400; i++) { L = lines[i].trim();
    if (!L || L.charAt(0) == '#') continue;
    return /^(WB|W-|-B|--)[ \t]/.test(L) }
  return false }
function parseCSV(text, f) {
  var lines = text.split(/\r?\n/), head = lines[0].split(',').map(function (s) { return s.trim() }),
      fi = head.indexOf('fen'), gi = head.indexOf('gameId'), li = head.indexOf('label');
  if (fi < 0) fi = head.length - 1;
  var out = [], bad = 0;
  for (var i = 1; i < lines.length; i++) { if (!lines[i].trim()) continue;
    var col = lines[i].split(','); if (col.length < head.length || !col[fi]) { bad++; continue }
    var o = { set: f.set, id: gi >= 0 ? col[gi] : f.set + ':' + i, fen: col[fi].trim(), file: f };
    if (li >= 0 && LABS.indexOf((col[li] || '').trim()) >= 0) o.lab = col[li].trim();
    out.push(o) }
  return { rows: out, bad: bad, head: head.join(',') } }
function addFiles(list) {
  var pending = list.length;
  if (!pending) return;
  say(F('fReading', esc(Array.prototype.map.call(list, function (f) { return f.name }).join(', '))));
  Array.prototype.forEach.call(list, function (file) {
    file.text().then(function (txt) {
      var base = file.name.replace(/\.(csv|txt)$/i, ''), set = base, n = 2;
      while (files.some(function (x) { return x.set === set })) set = base + ' (' + (n++) + ')';
      var f = { key: ++fileSeq, name: file.name, set: set, rows: [], bad: 0, labs: 0, ref: 'none' };
      var P = (/\.txt$/i.test(file.name) || looksTXT(txt)) ? parseTXT(txt, f) : parseCSV(txt, f);
      f.rows = P.rows; f.bad = P.bad;
      f.rows.forEach(function (r) { if (r.lab) f.labs++ });
      /* chasolver's unfair games (and the missed-draw downloads of this page) are draws by construction */
      if (!f.labs && (/(^|,)lastMove(,|$)/.test(P.head) || /chasolver|unfair|missed-draw/i.test(file.name))) f.ref = 'draw';
      files.push(f);
      if (!--pending) { say(''); inputChanged() }
    }).catch(function (err) { say(F('fFail', esc(file.name), esc(err.message))); if (!--pending) inputChanged() })
  }) }
function renderFiles() {
  var h = '';
  files.forEach(function (f) {
    h += '<li><span class="fname">' + esc(f.name) + '</span><span class="fmeta">' + F('fRows', num(f.rows.length)) +
       (f.bad ? '; ' + F('fBad', num(f.bad)) : '') + '</span><span class="fref">' +
       (f.labs ? T('fLabels') : '<label>' + T('fRef') + ' <select data-fk="' + f.key + '"><option value="none"' + (f.ref == 'none' ? ' selected' : '') + '>' +
         T('fRefNone') + '</option><option value="draw"' + (f.ref == 'draw' ? ' selected' : '') + '>' + T('fRefDraw') + '</option></select></label>') +
       '</span><button class="x" data-rm="' + f.key + '" aria-label="' + esc(F('fRemove', f.name)) + '" title="' + esc(F('fRemove', f.name)) + '">×</button></li>' });
  if (files.length > 1) h += '<li class="clr"><button class="link" id="clrall">' + T('fClear') + '</button></li>';
  $('flist').innerHTML = h;
  if ($('clrall')) $('clrall').onclick = function () { if (busy) return; files = []; inputChanged() };
}
$('flist').addEventListener('click', function (ev) {
  var k = ev.target.getAttribute && ev.target.getAttribute('data-rm'); if (!k || busy) return;
  files = files.filter(function (f) { return f.key != k }); inputChanged() });
$('flist').addEventListener('change', function (ev) {
  var k = ev.target.getAttribute && ev.target.getAttribute('data-fk'); if (!k) return;
  files.forEach(function (f) { if (f.key == k) f.ref = ev.target.value }); inputChanged() });

function allRows() { var r = parsePaste(); files.forEach(function (f) { r = r.concat(f.rows) }); return r }
function expand(src) {
  var two = $('bothdir').checked, out = [];
  src.forEach(function (r) {
    if (r.lab) {
      if (!labSel[r.lab]) return;
      if (two) { [1, 0].forEach(function (g) { out.push({ set: r.set, id: r.id + (g ? '/w' : '/b'), fen: r.fen, lab: r.lab, g: g, draw: refDraw(r.lab, g), rs: 'lab' }) }) }
      else out.push({ set: r.set, id: r.id, fen: r.fen, lab: r.lab, draw: refDraw(r.lab, sideOf(r.fen)), rs: 'lab' });
      return }
    if (r.file && r.file.ref == 'draw') out.push({ set: r.set, id: r.id, fen: r.fen, draw: true, rs: 'file' });
    else out.push({ set: r.set, id: r.id, fen: r.fen }) });
  return out }
function workset() {
  var rows = allRows(), a = +$('rowA').value | 0, b = +$('rowB').value | 0, n = rows.length;
  if (a < 1) a = 1; if (b < 1 || b > n) b = n;
  return b < a ? [] : expand(rows.slice(a - 1, b)) }
function labBar(rows) {
  var have = {}, any = 0;
  rows.forEach(function (r) { if (r.lab) { have[r.lab] = (have[r.lab] || 0) + 1; any++ } });
  $('labrow').classList.toggle('hide', !any);
  $('assumeBoth').classList.toggle('hide', !any);
  if (!any) return;
  var h = '';
  LABS.forEach(function (L) { if (!have[L]) return;
    h += '<label title="' + esc(T('lab_' + L)) + '"><input type="checkbox" class="labf" value="' + L + '"' + (labSel[L] ? ' checked' : '') +
       '> <code>' + L + '</code> ' + num(have[L]) + '</label>' });
  $('labs').innerHTML = h }
$('labs').addEventListener('change', function (ev) {
  if (ev.target.classList.contains('labf')) { labSel[ev.target.value] = ev.target.checked ? 1 : 0; refreshCount() } });
function refreshCount() {
  if (busy) return;
  var W = workset(), n = W.length, g = $('go'), p = 0, k;
  for (k = 0; k < n; k++) if (W[k].set === 'pasted') p++;
  g.textContent = n === 1 ? T('go1') : n ? F('goN', num(n)) : T('go0');
  g.disabled = !n;
  /* say where the count comes from whenever pasted lines and files are judged together */
  $('split').textContent = p && p < n ? F('goSplit', num(p), num(n - p)) : '' }
/* a Lichess timeout from chasolver's unfair games (game ijyj0mHa) */
var EXAMPLE = '# ijyj0mHa: {0}\n5b2/p7/Pp3k2/1Pp1pBp1/2P1P1P1/5K2/8/8 w - -';
$('example').onclick = function () { if (busy) return; $('fen').value = EXAMPLE.replace('{0}', T('exNote')); $('fen').focus(); labBar(allRows()); refreshCount() };
function inputChanged() { renderFiles(); labBar(allRows()); refreshCount() }
var pasteT = 0;
$('fen').addEventListener('input', function () { clearTimeout(pasteT); pasteT = setTimeout(function () { labBar(allRows()); refreshCount() }, 150) });
$('fen').addEventListener('keydown', function (ev) { if (ev.key == 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); if (!$('go').disabled) go() } });
['rowA', 'rowB', 'bothdir'].forEach(function (id) { $(id).addEventListener('input', refreshCount); $(id).addEventListener('change', refreshCount) });
var dropEl = $('drop'), fileEl = $('file');
dropEl.onclick = function () { if (!busy) fileEl.click() };
dropEl.onkeydown = function (ev) { if (ev.key == 'Enter' || ev.key == ' ') { ev.preventDefault(); if (!busy) fileEl.click() } };
fileEl.onchange = function () { if (fileEl.files.length) addFiles(fileEl.files); fileEl.value = '' };
dropEl.ondragover = function (ev) { ev.preventDefault(); dropEl.classList.add('over') };
dropEl.ondragleave = function () { dropEl.classList.remove('over') };
dropEl.ondrop = function (ev) { ev.preventDefault(); dropEl.classList.remove('over');
  if (!busy && ev.dataTransfer.files.length) addFiles(ev.dataTransfer.files) };

/* ═══════════════════════════════ running ═══════════════════════════════ */
var results = null, busy = false, cancel = false, page = 0;
function lock(on) { busy = on; cancel = false;
  ['ply', 'bud', 'rowA', 'rowB', 'bothdir', 'fen', 'example'].forEach(function (id) { $(id).disabled = on });
  Array.prototype.forEach.call(ROOT.querySelectorAll('.labf,#flist select,#flist button'), function (x) { x.disabled = on });
  dropEl.classList.toggle('off', on);
  var g = $('go'); g.classList.toggle('stop', on);
  if (on) { g.textContent = T('goStop'); g.disabled = false } else refreshCount() }
function runBatch(work, P, B, done) {
  $('bar').classList.toggle('hide', work.length < 2);
  var res = new Array(work.length), i = 0, T0 = 0;
  /* time-sliced: at least one position, then yield after ~50 ms, so Stop and the progress bar stay live */
  function chunk() {
    if (!T0) T0 = performance.now();
    var until = performance.now() + 50;
    do { res[i] = judge(work[i].fen, P, B, work[i].g); work[i].bad = res[i] ? null : badReason; i++ } while (i < work.length && !cancel && performance.now() < until);
    var secs = (performance.now() - T0) / 1000, r = i / Math.max(secs, .001);
    $('barf').style.width = (100 * i / work.length) + '%';
    say(F('sProg', num(i), num(work.length), num(r < 10 ? r.toFixed(1) : Math.round(r)), num(Math.round((work.length - i) / Math.max(r, .01)))));
    if (i < work.length && !cancel) setTimeout(chunk, 0);
    else { $('bar').classList.add('hide'); done(i < work.length ? res.slice(0, i) : res, (performance.now() - T0) / 1000, i < work.length) }
  }
  setTimeout(chunk, 20) }
function go() {
  if (PGN.busy) return;
  if (busy) { cancel = true; return }
  var work = workset(); if (!work.length) return;
  var P = ply(), B = bud();
  results = null; showResults();
  lock(true);
  runBatch(work, P, B, function (res, secs, stopped) { finish(work, res, secs, P, B, stopped) }) }
$('go').onclick = go;
/* One position's proof, timed: browsers round their clock to ~0.1 ms and the first call pays for the
   JIT, so the proof is repeated for ~30 ms and the time divided by the number of runs. */
function warmTime(w, P, B) {
  var setup = E.fromFen(w.fen); if (setup.error) return null;
  var pos = setup.position, g = w.g === 0 || w.g === 1 ? w.g : (pos.side === E.WHITE ? 1 : 0), flagged = g ? E.WHITE : E.BLACK, lim = { maxPly: P, budget: B };
  var block = function (k) { for (var i = 0; i < k; i++) E.proveCannotBeMated(pos, flagged, lim) };
  /* a block of calls between two readings of the clock; the first ~15 ms only warm the JIT up */
  var t0 = performance.now(), k = 1, n = 0, t;
  while (performance.now() - t0 < 15 && k < 1 << 16) { block(k); k *= 2 }
  t0 = performance.now();
  do { block(k); n += k; t = performance.now() - t0 } while (t < 40);
  return t / n }
function finish(work, res, secs, P, B, stopped) {
  results = { rows: work.slice(0, res.length), total: work.length, res: res, secs: secs, P: P, B: B, stopped: stopped };
  page = 0; filt = { show: '', set: '', why: '' }; renderBrowse.touched = false;
  lock(false);
  showResults() }
function showResults() {
  if (!results) { $('solo').classList.add('hide'); $('out').classList.add('hide'); return }
  var R = results, single = R.total === 1 && R.res.length === 1, s;
  if (single) {
    $('out').classList.add('hide'); $('solo').classList.remove('hide');
    $('solo').innerHTML = detailHTML(0);
    s = R.res[0] ? F('sDone1', us(R.res[0].warm === undefined ? (R.res[0].warm = warmTime(R.rows[0], R.P, R.B)) : R.res[0].warm)) : '';
  } else {
    $('solo').classList.add('hide'); $('solo').innerHTML = '';
    $('out').classList.remove('hide');
    renderBatch();
    s = (R.stopped ? F('sStopped', num(R.res.length), num(R.total)) + ' ' : '') +
      F('sDone', num(R.res.length), dur(R.secs), us(R.secs * 1000 / Math.max(R.res.length, 1)));
  }
  say(s) }

/* against the reference, when there is one: draw means the flagged side's opponent cannot mate */
function refCat(w, r) {
  if (!r || w.draw === undefined) return '';
  var o = outcome(r);
  if (w.draw) return o == 'draw' ? 'ok' : o == 'open' ? 'miss' : 'contra';
  return o == 'draw' ? 'false' : o == 'mate' ? 'ok' : 'okd' }

/* ═══════════════════════════════ batch report ═══════════════════════════════ */
var filt = { show: '', set: '', why: '' };
var DRAW_REASONS = ['material', 'lock', 'domino', 'stalemate'], WIN_REASONS = ['mate', 'open'];
function renderBatch() {
  var R = results.res, W = results.rows, n = R.length, k, o, c;
  var why = {}, rc = { ok: 0, okd: 0, miss: 0, contra: 0, false: 0 }, mx = {}, refN = 0, stop = { horizon: 0, budget: 0 }, draws = 0, dead = 0, bad = 0;
  for (k = 0; k < n; k++) { var x = reasonOf(R[k]); why[x] = (why[x] || 0) + 1; o = outcome(R[k]);
    if (o == 'bad') bad++;
    if (o == 'draw') { draws++; if (R[k].dead) dead++ }
    if (o == 'open') stop[R[k].why] = (stop[R[k].why] || 0) + 1;
    c = refCat(W[k], R[k]); if (c) { refN++; rc[c]++; mx[(W[k].draw ? 'd' : 'w') + o] = (mx[(W[k].draw ? 'd' : 'w') + o] || 0) + 1 } }
  var judged = n - bad;
  /* the composition bar, then the reasons grouped by result */
  var seg = function (r) { return why[r] ? '<span class="r-' + r + '" style="flex:' + why[r] + '" title="' + esc(T('rs_' + r) + ': ' + num(why[r])) + '"></span>' : '' };
  var h = '<div class="obar">' + DRAW_REASONS.concat(WIN_REASONS, ['bad']).map(seg).join('') + '</div>';
  var key = function (r) { if (!why[r]) return '';
    return '<div class="ok1"><span class="sw r-' + r + '"></span><span><b>' + num(why[r]) + '</b> <span class="dim small">' + pct(why[r], judged) + '</span></span>' +
      '<span class="ol">' + T('rs_' + r) + '</span><p>' + T('rd_' + r) + (r == 'open' ? ' (' + T('thHor') + ' ' + num(stop.horizon || 0) + ', ' + T('thBud') + ' ' + num(stop.budget || 0) + ')' : '') + '</p></div>' };
  if (draws) h += '<p class="group">' + T('gDraws') + '</p><div class="okey">' + DRAW_REASONS.map(key).join('') + '</div>';
  if (why.mate || why.open) h += '<p class="group">' + T('gWins') + '</p><div class="okey">' + WIN_REASONS.map(key).join('') + '</div>';
  if (draws) h += '<p class="note">' + F('deadOf', num(dead), num(draws)) + '</p>';
  if (bad) { var bk = {}, bko = [];
    for (k = 0; k < n; k++) if (!R[k] && W[k].bad) { var g = bkOf(W[k].bad.k); if (!bk[g]) { bk[g] = 0; bko.push(g) } bk[g]++ }
    h += '<p class="note warn">' + F('sBadN', num(bad), bko.map(function (g) { return T(g) + ' ' + num(bk[g]) }).join(', ')) + '</p>' }
  $('outcome').innerHTML = h;
  /* reference */
  var rb = '';
  if (refN) {
    rb = '<p class="dim small">' + F('refIntro', num(refN), num(judged)) + '</p><div class="scroll"><table class="mx"><tr><th></th>' +
       '<th>' + T('mxDraw') + '</th><th>' + T('mxMate') + '</th><th>' + T('mxOpen') + '</th></tr>' +
       '<tr><th class="lf">' + T('mxRefDraw') + '<small>' + T('mxRefDrawS') + '</small></th>' + cell('ok', mx.ddraw, T('kOk')) + cell('contra', mx.dmate, T('kContra')) + cell('miss', mx.dopen, T('kMiss')) + '</tr>' +
       '<tr><th class="lf">' + T('mxRefWin') + '<small>' + T('mxRefWinS') + '</small></th>' + cell('false', mx.wdraw, T('kBad')) + cell('ok', mx.wmate, T('kOk')) + cell('okd', mx.wopen, T('kOkDef')) + '</tr></table></div>';
    rb += '<p class="note ' + (rc.false ? 'bad' : 'good') + '">' + (rc.false ? F('refBad', num(rc.false)) : T('refClean')) + '</p>';
    if (rc.contra) rb += '<p class="note bad">' + F('refContra', num(rc.contra)) + '</p>';
    if (rc.miss) rb += '<p class="note warn">' + F('refMiss', num(rc.miss)) + '</p>';
  } else rb = '<p class="dim">' + T('refNoRef') + '</p>';
  $('refbox').innerHTML = rb;
  renderPer(); renderCost(); renderBrowse() }
function cell(cls, v, lab) { v = v || 0; return '<td class="c-' + cls + (v ? '' : ' zero') + '"><b>' + num(v) + '</b><span>' + lab + '</span></td>' }
function renderPer() {
  var R = results.res, W = results.rows, per = {}, order = [], k, s, o, c, v;
  for (k = 0; k < R.length; k++) { s = W[k].set;
    if (!per[s]) { per[s] = { n: 0, draw: 0, mate: 0, open: 0, hor: 0, bud: 0, bad: 0, miss: 0, false: 0, contra: 0, lab: 0, file: 0 }; order.push(s) }
    v = per[s]; v.n++; o = outcome(R[k]); v[o]++;
    if (o == 'open') { if (R[k].why == 'budget') v.bud++; else v.hor++ }
    c = refCat(W[k], R[k]); if (c && v[c] !== undefined) v[c]++;
    if (W[k].rs == 'lab') v.lab++; else if (W[k].rs == 'file') v.file++ }
  var cols = ['n', 'draw', 'mate', 'open', 'hor', 'bud', 'miss', 'false', 'contra'], badAll = 0,
      h = '<tr><th>' + T('thSet') + '</th><th class="lf">' + T('thRef') + '</th><th>' + T('thRows') + '</th><th>' + T('mxDraw') + '</th><th>' + T('mxMate') + '</th><th>' + T('mxOpen') +
        '</th><th>' + T('thHor') + '</th><th>' + T('thBud') + '</th><th>' + T('kMiss') + '</th><th>' + T('kBad') + '</th><th>' + T('kContra') + '</th></tr>',
      TT = {}; cols.forEach(function (x) { TT[x] = 0 });
  order.forEach(function (s) { v = per[s]; badAll += v.bad;
    cols.forEach(function (x) { TT[x] += v[x] });
    var ref = v.lab + v.file === 0 ? '—' : (v.lab + v.file < v.n ? T('refKindMix') : (v.lab ? T('refKindLab') : T('refKindDraw')));
    h += '<tr><td>' + esc(s) + '</td><td class="lf">' + ref + '</td>' + cols.map(function (x) { return '<td' + (x == 'false' && v[x] ? ' class="badn"' : '') + '>' + num(v[x]) + (x == 'draw' ? ' <span class="dim small">' + pct(v.draw, v.n - v.bad) + '</span>' : '') + '</td>' }).join('') + '</tr>' });
  if (order.length > 1)
    h += '<tr class="tot"><td>' + T('thTot') + '</td><td></td>' + cols.map(function (x) { return '<td>' + num(TT[x]) + (x == 'draw' ? ' <span class="dim small">' + pct(TT.draw, TT.n - badAll) + '</span>' : '') + '</td>' }).join('') + '</tr>';
  $('perfile').innerHTML = h }
function renderCost() {
  var R = results.res, used = [], t = 0, k;
  for (k = 0; k < R.length; k++) if (R[k]) { used.push(R[k].used); t += R[k].ms * 1000 }
  if (!used.length) { $('cost').innerHTML = ''; return }
  used.sort(function (a, b) { return a - b });
  var u = [dec(used.reduce(function (x, y) { return x + y }, 0) / used.length, 1), num(used[used.length >> 1]), num(used[Math.floor(used.length * .99)]), num(used[used.length - 1])];
  $('cost').innerHTML = '<tr><th>' + T('thMeasure') + '</th><th>' + T('thAvg') + '</th><th>' + T('thMed') + '</th><th>' + T('thP99') + '</th><th>' + T('thMax') + '</th></tr>' +
    '<tr><td>' + T('mNodes') + '</td><td>' + u.join('</td><td>') + '</td></tr>' +
    '<tr><td>' + T('mUs') + '</td><td>' + us(t / 1000 / used.length) + '</td><td>—</td><td>—</td><td>—</td></tr>' }

/* ═══════════════════════════════ browsing ═══════════════════════════════ */
function catOf(k) { var r = results.res[k], w = results.rows[k];
  return { o: outcome(r), c: refCat(w, r) } }
function matches(k) {
  var r = results.res[k], w = results.rows[k], x = catOf(k), f = filt.show;
  if (filt.set && w.set !== filt.set) return false;
  if (filt.why && reasonOf(r) !== filt.why) return false;
  if (!f) return true;
  if (f.charAt(0) == 'o') return x.o === f.slice(2);
  return x.c === f.slice(2) || (f == 'r:ok' && x.c == 'okd') }
function listNow() { var out = [], n = results.res.length, k; for (k = 0; k < n; k++) if (matches(k)) out.push(k); return out }
function renderBrowse() {
  var R = results.res, n = R.length, k, x, cnt = {}, sets = {}, whys = {};
  for (k = 0; k < n; k++) { x = catOf(k);
    cnt['o:' + x.o] = (cnt['o:' + x.o] || 0) + 1; if (x.c) cnt['r:' + x.c] = (cnt['r:' + x.c] || 0) + 1;
    sets[results.rows[k].set] = 1; whys[reasonOf(R[k])] = (whys[reasonOf(R[k])] || 0) + 1 }
  cnt['r:ok'] = (cnt['r:ok'] || 0) + (cnt['r:okd'] || 0);
  /* default view: what most needs reading */
  if (filt.show === '' && !renderBrowse.touched) {
    filt.show = ['r:false', 'r:contra', 'r:miss', 'o:open'].filter(function (f) { return cnt[f] })[0] || '' }
  var opts = [['', T('fAll'), n], ['o:draw', T('mxDraw')], ['o:mate', T('mxMate')], ['o:open', T('mxOpen')], ['o:bad', T('rs_bad')],
            ['r:ok', T('kOk')], ['r:miss', T('kMiss')], ['r:false', T('kBad')], ['r:contra', T('kContra')]];
  var h = '<label>' + T('fShow') + ' <select id="fshow">';
  opts.forEach(function (o) { var c = o[0] ? cnt[o[0]] || 0 : n; if (!c && o[0] && filt.show !== o[0]) return;
    h += '<option value="' + o[0] + '"' + (filt.show === o[0] ? ' selected' : '') + '>' + o[1] + ' (' + num(c) + ')</option>' });
  h += '</select></label>';
  var sl = Object.keys(sets);
  if (sl.length > 1) { h += '<label>' + T('fSet') + ' <select id="fset"><option value="">' + T('fAll') + '</option>';
    sl.forEach(function (s) { h += '<option' + (filt.set === s ? ' selected' : '') + '>' + esc(s) + '</option>' }); h += '</select></label>' }
  if (Object.keys(whys).length > 1) { h += '<label>' + T('fWhy') + ' <select id="fwhy"><option value="">' + T('fAll') + '</option>';
    DRAW_REASONS.concat(WIN_REASONS, ['bad']).forEach(function (s) { if (whys[s]) h += '<option value="' + s + '"' + (filt.why === s ? ' selected' : '') + '>' + T('rs_' + s) + ' (' + num(whys[s]) + ')</option>' });
    h += '</select></label>' }
  $('filters').innerHTML = h;
  ['fshow', 'fset', 'fwhy'].forEach(function (id) { var el = $(id); if (!el) return;
    el.onchange = function () { renderBrowse.touched = true; filt[{ fshow: 'show', fset: 'set', fwhy: 'why' }[id]] = el.value; page = 0; renderGrid() } });
  renderGrid() }
function renderGrid() {
  var list = listNow(), per = 48, pages = Math.max(1, Math.ceil(list.length / per));
  if (page >= pages) page = pages - 1;
  var h = '';
  list.slice(page * per, (page + 1) * per).forEach(function (k) {
    var w = results.rows[k], r = results.res[k], o = outcome(r), c = refCat(w, r);
    h += '<button class="card' + (c == 'false' || c == 'contra' ? ' ref-' + c : '') + '" data-k="' + k + '">' + drawBoard(w.fen, r ? r.side : -1, false) +
       '<span class="ct"><span class="cs ' + kind(o) + '">' + (r ? score(r) : '—') + '</span><span class="cr ' + kind(o) + '">' + T('rs_' + reasonOf(r)) + '</span></span>' +
       '<span class="cm">' + (c && c != 'ok' && c != 'okd' ? '<em>' + T({ miss: 'kMiss', false: 'kBad', contra: 'kContra' }[c]) + '</em><br>' : '') +
       (o == 'bad' && w.bad ? '<em>' + T(bkOf(w.bad.k)) + '</em><br>' : '') +
       esc(w.set) + ', ' + esc(w.id) + (r && r.used ? '<br>' + nodes(r.used) : '') + '</span></button>' });
  $('grid').innerHTML = h || '<p class="dim">' + T('noneHere') + '</p>';
  $('pg').innerHTML = pages > 1
    ? '<button id="pv"' + (page ? '' : ' disabled') + '>' + T('prev') + '</button><span>' + F('pgOf', page + 1, pages, num(list.length)) +
      '</span><button id="nx"' + (page < pages - 1 ? '' : ' disabled') + '>' + T('next') + '</button>' : (list.length ? '<span class="dim">' + F('pgOf', 1, 1, num(list.length)) + '</span>' : '');
  if (pages > 1) { $('pv').onclick = function () { if (page > 0) { page--; renderGrid() } };
               $('nx').onclick = function () { if (page < pages - 1) { page++; renderGrid() } } } }
$('grid').addEventListener('click', function (ev) {
  var c = ev.target.closest && ev.target.closest('.card[data-k]'); if (c) lbOpen(+c.getAttribute('data-k')) });

/* ═══════════════════════════════ detail ═══════════════════════════════ */
function stepRow(state, name, call, text) {
  var tag = { dec: 'tDec', win: 'tDec', no: 'tNo', also: 'tAlso', skip: 'tSkip', open: 'tOpen', dead: 'tDead', live: 'tLive' }[state];
  return '<li class="st-' + state + '"><div class="sh"><b>' + name + '</b> <code>' + call + '</code> <span class="stag">' + T(tag) + '</span></div><p>' + text + '</p></li>' }
function detailHTML(k) {
  var w = results.rows[k], r = results.res[k], P = results.P, B = results.B;
  if (!r) return '<div class="detail"><div></div><div><p class="vword k-bad">' + T('rs_bad') + '</p><p class="note bad">' + F('badFen', badText(w.bad)) + ' ' + T('badNec') + '</p>' + srcBlock(w, null) + '</div></div>';
  var ins = inspect(w.fen, r.side) || { status: 0, material: false, lock: false };
  var A = String(w.fen).trim().split(/\s+/), tm = A[1] == 'w' ? 1 : 0, o = outcome(r), fl = sideName(r.side), op = sideName(1 - r.side), c = refCat(w, r);
  var who = r.side ? 'WHITE' : 'BLACK';
  var vt = r.draw ? (r.dead ? T('vt_dead') : F('vt_draw', fl, op)) : F(o == 'mate' ? 'vt_mate' : 'vt_open', fl, op);
  var h = '<div class="detail"><div class="dboard">' + drawBoard(w.fen, r.side, true) +
        '<p class="cap"><b>⚑</b> ' + T('kFlag') + ' ' + fl + '</p></div><div>' +
        '<div class="vhead"><span class="score ' + kind(o) + '">' + score(r) + '</span><div><div class="vword">' + verdictWords(r) + '</div>' +
        '<span class="chip ' + kind(o) + '">' + T('rs_' + r.reason) + '</span>' +
        (c && c != 'ok' && c != 'okd' ? ' <span class="chip k-flag">' + T({ miss: 'kMiss', false: 'kBad', contra: 'kContra' }[c]) + '</span>' : '') + '</div></div>' +
        '<p class="vtext">' + vt + '</p>';
  /* the rungs, in the order they run */
  var done = false, s = '', ep = r.ep >= 0 ? sqName(r.ep) : '';
  if (ins.material) { s += stepRow('dec', T('s1n'), 'materialCannotMate(' + who + ')', F('st1Yes', op)); done = true }
  else s += stepRow('no', T('s1n'), 'materialCannotMate(' + who + ')', F('st1No', op));
  var c2 = 'lockCannotMate(' + who + ')';
  if (done) s += ins.lock ? stepRow('also', T('s2n'), c2, F('st2Also', op)) : stepRow('skip', T('s2n'), c2, T('st2Skip'));
  else if (ins.lock) { s += stepRow('dec', T('s2n'), c2, F('st2Yes', op)); done = true }
  else s += stepRow('no', T('s2n'), c2, ep ? F('st2Ep', ep) : F('st2No', op));
  var c3 = 'Domino(' + who + ', ' + P + ', ' + num(B) + ')';
  if (done) s += stepRow('skip', T('s3n'), c3, T('st3Skip'));
  else if (r.reason == 'domino') s += stepRow('dec', T('s3n'), c3, F('st3Ok', nodes(r.used), op));
  else if (r.reason == 'stalemate') s += stepRow('dec', T('s3n'), c3, T('st3SM'));
  else if (r.reason == 'mate') s += stepRow('win', T('s3n'), c3, r.used ? F('st3Mate', op) : T('st3Mated'));
  else if (r.why == 'budget') s += stepRow('open', T('s3n'), c3, F('st3Bud', num(B), op));
  else if (r.why == 'horizon') s += stepRow('open', T('s3n'), c3, F('st3Hor', P, op));
  else s += stepRow('open', T('s3n'), c3, T('st3Root'));
  if (r.draw) s += stepRow(r.dead ? 'dead' : 'live', T('s4n'), 'proveCannotBeMated(' + (r.side ? 'BLACK' : 'WHITE') + ')', F(r.dead ? 'st4Dead' : 'st4Live', fl));
  h += '<h4>' + T('hSteps') + '</h4><p class="dim small">' + T('stepsNote') + '</p><ol class="steps">' + s + '</ol>';
  /* reference */
  if (w.draw !== undefined) {
    var res = { ok: T('rOk'), okd: T('rOkDef'), miss: T('rMiss'), false: F('rFalse', op), contra: T('rContra') }[c];
    h += '<h4>' + T('hRefD') + '</h4><dl class="kv">' +
       (w.lab ? '<dt>' + T('kLabel') + '</dt><dd><code>' + w.lab + '</code>, ' + T('lab_' + w.lab) + '</dd>' : '<dt>' + T('kLabel') + '</dt><dd>' + T('refFile') + '</dd>') +
       '<dt>' + T('kExpect') + '</dt><dd>' + (w.draw ? T('expDraw') : F('expWin', op)) + '</dd>' +
       '<dt>' + T('kResult') + '</dt><dd class="ref-' + c + '">' + res + '</dd></dl>';
  }
  /* position */
  var st = ins.status | 0, n = r.n;
  h += '<h4>' + T('hPosition') + '</h4><dl class="kv">' +
     '<dt>' + T('kFlag') + '</dt><dd>' + (w.g !== undefined && w.g !== tm ? F('flagForced', fl, sideName(tm)) : F('flagToMove', fl)) + '</dd>' +
     '<dt>' + T('kMoves') + '</dt><dd>' + r.moves + '</dd>' +
     '<dt>' + T('kStatus') + '</dt><dd>' + (st ? F('statOver', T('res' + st)) : T('stat0')) + '</dd>' +
     '<dt>' + T('kCastle') + '</dt><dd>' + esc(r.castle) + '</dd>' +
     '<dt>' + T('kEp') + '</dt><dd>' + (ep ? F('epNote', '<code>' + ep + '</code>') : '—') + '</dd>' +
     '<dt>' + T('kClock') + '</dt><dd>' + (r.nGiven ? (n > 149 ? F('z75', n) : n) : T('noN')) + '</dd>' +
     '<dt>' + T('kFull') + '</dt><dd>' + (A[5] && /^\d+$/.test(A[5]) ? A[5] : '—') + '</dd></dl>';
  /* the proof */
  h += '<h4>' + T('hRun') + '</h4><dl class="kv">' +
     '<dt>' + T('kLimits') + '</dt><dd>' + F('limits', P, num(B)) + '</dd>' +
     '<dt>' + T('kUsed') + '</dt><dd>' + F('usedOf', num(r.used), num(B)) + '</dd>' +
     '<dt>' + T('kTime') + '</dt><dd>' + (r.warm === undefined ? (r.warm = warmTime(w, P, B)) : r.warm, us(r.warm)) + ' µs</dd>' +
     (r.why ? '<dt>' + T('kStop') + '</dt><dd>' + T({ horizon: 'rHorizon', budget: 'rBudget', mate: 'rMate' }[r.why]) + '</dd>' : '') + '</dl>';
  h += srcBlock(w, r) + '</div></div>';
  return h }
function srcBlock(w, r) {
  var game = /^[A-Za-z0-9]{8}$/.test(w.id) ? 'https://lichess.org/' + w.id : '';
  return '<h4>' + T('hSource') + '</h4><dl class="kv"><dt>' + T('kSet') + '</dt><dd>' + esc(w.set) + '</dd><dt>' + T('kId') + '</dt><dd>' + esc(w.id) + '</dd></dl>' +
    '<p class="fenbox">' + esc(w.fen) + '</p><div class="acts"><button class="cp" data-fen="' + esc(w.fen) + '">' + T('lbCopy') + '</button>' +
    '<a class="btn" target="_blank" rel="noopener" href="' + esc(editor(w.fen)) + '">' + T('openEditor') + '</a>' +
    (game ? '<a class="btn" target="_blank" rel="noopener" href="' + game + '">' + T('openGame') + '</a>' : '') +
    (r ? '<a class="btn" href="' + esc(askCha(w.fen, r.side)) + '">' + T('askCha') + '</a>' : '') + '</div>' }
ROOT.addEventListener('click', function (ev) {
  var b = ev.target.closest && ev.target.closest('button.cp'); if (!b) return;
  var t = b.getAttribute('data-fen');
  if (navigator.clipboard) navigator.clipboard.writeText(t).catch(function () {});
  else { var a = document.createElement('textarea'); a.value = t; document.body.appendChild(a); a.select(); document.execCommand('copy'); document.body.removeChild(a) }
  b.textContent = T('lbCopied'); setTimeout(function () { b.textContent = T('lbCopy') }, 1200) });

/* ═══════════════════════════════ detail dialog ═══════════════════════════════ */
var lbList = [], lbAt = -1, lbFrom = null;
function lbOpen(k) {
  lbList = listNow(); lbAt = lbList.indexOf(k); if (lbAt < 0) { lbList = [k]; lbAt = 0 }
  lbFrom = document.activeElement; lbShow(); $('lb').classList.remove('hide'); $('lbx').focus() }
function lbShow() {
  $('lbbody').innerHTML = detailHTML(lbList[lbAt]);
  $('lbpos').textContent = F('lbPos', num(lbAt + 1), num(lbList.length));
  $('lbprev').disabled = lbAt <= 0; $('lbnext').disabled = lbAt >= lbList.length - 1 }
function lbClose() { $('lb').classList.add('hide'); if (lbFrom && lbFrom.focus) lbFrom.focus() }
$('lbprev').onclick = function () { if (lbAt > 0) { lbAt--; lbShow() } };
$('lbnext').onclick = function () { if (lbAt < lbList.length - 1) { lbAt++; lbShow() } };
$('lbx').onclick = lbClose;
$('lb').addEventListener('click', function (ev) { if (ev.target === $('lb')) lbClose() });
document.addEventListener('keydown', function (ev) {
  if ($('lb').classList.contains('hide') || MatelessSite.active() != 'arbiter') return;
  if (ev.key == 'Escape') lbClose();
  else if (ev.key == 'ArrowLeft') $('lbprev').onclick();
  else if (ev.key == 'ArrowRight') $('lbnext').onclick();
  else if (ev.key == 'Tab') { /* keep focus inside the dialog */
    var f = $('lb').querySelectorAll('button:not([disabled]),a[href]'); if (!f.length) return;
    if (ev.shiftKey && document.activeElement === f[0]) { ev.preventDefault(); f[f.length - 1].focus() }
    else if (!ev.shiftKey && document.activeElement === f[f.length - 1]) { ev.preventDefault(); f[0].focus() } } });

/* ═══════════════════════════════ downloads ═══════════════════════════════ */
function download(name, txt) { var url = URL.createObjectURL(new Blob([txt], { type: 'text/csv' })), A = document.createElement('a');
  A.href = url; A.download = name; document.body.appendChild(A); A.click(); document.body.removeChild(A); setTimeout(function () { URL.revokeObjectURL(url) }, 1000) }
function csvf(x) { x = String(x == null ? '' : x); return /[",\n]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x }
var CSV_HEAD = 'set,gameId,flagged,label,verdict,dead_position,reason,agreement,stopped_by,halfmove,nodes,fen';
function csvRow(w, r) {
  var c = refCat(w, r), agr = { ok: 'agrees', okd: 'agrees by default', miss: 'missed draw', false: 'false draw', contra: 'contradiction' }[c] || '';
  var v = r.draw ? (r.dead ? 'dead position' : 'draw on time') : (r.side ? 'black' : 'white') + ' wins on time';
  return [w.set, w.id, r.side ? 'white' : 'black', w.lab || '', v, r.dead ? 'yes' : 'no', r.reason, agr, r.why, r.n, r.used, w.fen].map(csvf).join(',') }
function exportWhere(name, keep) { if (!results) return;
  var o = [CSV_HEAD], R = results.res, W = results.rows;
  for (var k = 0; k < R.length; k++) if (R[k] && keep(W[k], R[k])) o.push(csvRow(W[k], R[k]));
  download(name, o.join('\n') + '\n') }
$('expAll').onclick = function () { exportWhere('all-verdicts.csv', function () { return true }) };
$('expUn').onclick = function () { exportWhere('no-proof.csv', function (w, r) { return outcome(r) == 'open' }) };
$('expMate').onclick = function () { exportWhere('mate-found.csv', function (w, r) { return outcome(r) == 'mate' }) };
$('expMiss').onclick = function () { exportWhere('missed-draw.csv', function (w, r) { return refCat(w, r) == 'miss' }) };
$('expBad').onclick = function () { exportWhere('false-draw.csv', function (w, r) { return refCat(w, r) == 'false' }) };
$('expInv').onclick = function () { if (!results) return;
  var o = ['set,gameId,label,reason,fen'], R = results.res, W = results.rows;
  for (var k = 0; k < R.length; k++) if (!R[k]) { var w = W[k], p = w.bad;
    o.push([w.set, w.id, w.lab || '', p ? p.k + (p.a ? ':' + p.a.join(':') : '') : 'castle', w.fen].map(csvf).join(',')) }
  download('invalid-fen.csv', o.join('\n') + '\n') };

/* ═══════════════════════════════ games (PGN): a test of its own ═══════════════════════════════
   Every game is replayed move by move with the engine's Game, whose play() returns the game
   status after the move: checkmate, stalemate, a dead position, the 75-move rule or fivefold
   repetition, the endings that need no claim. The first one met is where the rules end the game.
   If none comes first, the final position is judged as a flag fall: the loser named by Result is
   the side whose flag fell (on a draw or *, the side to move). Time-outs and resignations are not
   told apart; both ask whether the opponent can still mate. Nothing here reads or writes the
   positions above. */
var PGN = { files: [], seq: 0, res: null, busy: false, cancel: false, page: 0, filt: '', sel: -1, P: 0, B: 0, secs: 0, stopped: false };
var PGN_START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
var PGN_CATS = ['ok', 'lateDP', 'lateRule', 'wrongtm', 'wrongres', 'drawn', 'open', 'illegal', 'unread'];
var RES = E.Result;

/* split a PGN text into games: a tag line after movetext starts the next game */
function pgnSplit(text, set) {
  var lines = String(text).replace(/\r/g, '').split('\n'), games = [], g = null, moves = false, m, i, L;
  for (i = 0; i < lines.length; i++) { L = lines[i];
    if (/^%/.test(L)) continue;
    m = L.match(/^\s*\[(\w+)\s+"((?:[^"\\]|\\.)*)"\s*\]\s*$/);
    if (m) { if (!g || moves) { g = { set: set, tags: {}, text: '' }; games.push(g); moves = false }
      g.tags[m[1]] = m[2].replace(/\\(.)/g, '$1'); continue }
    if (!L.trim()) continue;
    if (!g) { g = { set: set, tags: {}, text: '' }; games.push(g) }
    moves = true; g.text += L + '\n' }
  games.forEach(function (g, k) {
    var s = g.tags.Site || '', id = g.tags.GameId || (s.match(/lichess\.org\/(\w{8})/) || [])[1] || (s && s != '?' ? s : '');
    g.id = id || String(k + 1);
    /* a link to the game only when it really is a Lichess game */
    g.lid = (s.match(/lichess\.org\/(\w{8})/) || [])[1] || (/^[A-Za-z0-9]{8}$/.test(g.tags.GameId || '') ? g.tags.GameId : '') });
  return games }
/* movetext → SAN tokens and the result token; comments, variations, NAGs, move numbers and !? go */
function pgnTokens(s) {
  s = s.replace(/\{[^}]*\}/g, ' ').replace(/;[^\n]*/g, ' ');
  var d = 0, o = '', i, ch, out = [], res = '';
  for (i = 0; i < s.length; i++) { ch = s[i]; if (ch == '(') d++; else if (ch == ')') { if (d) d-- } else if (!d) o += ch }
  o.replace(/\$\d+/g, ' ').split(/\s+/).forEach(function (x) {
    if (!x) return;
    if (/^(1-0|0-1|1\/2-1\/2|½-½|\*)$/.test(x)) { res = x; return }
    x = x.replace(/^\d+\.+/, '').replace(/e\.p\.$/, '').replace(/[!?+#]+$/, '');
    if (x) out.push(x) });
  return { moves: out, res: res } }
function pgnResult(r) { r = String(r || '').trim(); return r == '½-½' ? '1/2-1/2' : /^(1-0|0-1|1\/2-1\/2)$/.test(r) ? r : '*' }

var PGN_TYPE = { K: E.KING, Q: E.QUEEN, R: E.ROOK, B: E.BISHOP, N: E.KNIGHT, P: E.PAWN },
    PGN_PROMO = { Q: E.QUEEN, R: E.ROOK, B: E.BISHOP, N: E.KNIGHT };
/* one SAN token → the legal moves it can mean: [{from, to, promo}]. A castle is the king's move
   onto its own rook; O-O-O is the one whose rook stands on the king's queen side. */
function pgnMatch(pos, tok) {
  var legal = E.legalMoves(pos), cand = [], m;
  if (/^([O0]-[O0])(-[O0])?$/.test(tok)) { var long = tok.length > 3;
    legal.forEach(function (mv) { if (mv.castle && ((mv.to & 7) < (mv.from & 7)) === long) cand.push({ from: mv.from, to: mv.to, promo: E.QUEEN }) });
    return cand }
  m = tok.match(/^([KQRBNP])?([a-h])?([1-8])?x?([a-h][1-8])(?:=?([QRBNqrbn]))?$/);
  if (!m) return cand;
  var ty = PGN_TYPE[m[1] || 'P'], to = E.parseSquare(m[4]),
      ff = m[2] ? m[2].charCodeAt(0) - 97 : -1, fr = m[3] ? +m[3] - 1 : -1, pr = m[5] ? PGN_PROMO[m[5].toUpperCase()] : 0;
  legal.forEach(function (mv) {
    if (E.typeOf(pos.board[mv.from]) !== ty || mv.to !== to || mv.castle || ff >= 0 && (mv.from & 7) !== ff || fr >= 0 && (mv.from >> 3) !== fr) return;
    if (mv.promotion) cand.push({ from: mv.from, to: mv.to, promo: pr || E.QUEEN }); else if (!pr) cand.push({ from: mv.from, to: mv.to, promo: E.QUEEN }) });
  return cand }

/* replay one game; end.code and the flag-fall verdict fin are kept as the engine numbers them */
function pgnGame(G, P, B) {
  var o = { set: G.set, id: G.id, lid: G.lid, tags: G.tags, plies: 0, moves: [], end: null, err: null, fin: null };
  var tk = pgnTokens(G.text), v = String(G.tags.Variant || '').toLowerCase(), k, code;
  o.moves = tk.moves; o.res = pgnResult(G.tags.Result || tk.res);
  if (v && !/^(standard|chess ?960|fischerandom|from position)$/.test(v)) { o.err = { k: 'variant', a: [G.tags.Variant] }; return pgnClass(o) }
  var start = G.tags.FEN || PGN_START, setup = readFen(start);
  if (!setup) { o.err = { k: 'badstart', p: badReason }; return pgnClass(o) }
  if (!tk.moves.length && !G.tags.FEN) { o.err = { k: 'parse' }; return pgnClass(o) }
  var game = new E.Game(setup.position), full = +(start.split(/\s+/)[5]) || 1;
  o.start = start; o.s0 = game.position.side === E.WHITE ? 1 : 0; o.full0 = full;
  code = game.status(); if (code) o.end = { ply: 0, code: code, fen: start };
  for (k = 0; k < tk.moves.length; k++) {
    var cand = pgnMatch(game.position, tk.moves[k]);
    if (cand.length !== 1) {
      var over = o.end && (o.end.code == RES.WHITE_MATES || o.end.code == RES.BLACK_MATES || o.end.code == RES.STALEMATE);
      o.err = { k: over ? 'aftermate' : cand.length ? 'ambiguous' : 'illegal', a: [k + 1, tk.moves[k]] }; break }
    var black = game.position.side === E.BLACK;
    code = game.play(cand[0].from, cand[0].to, cand[0].promo);
    if (black) full++;
    o.plies = k + 1;
    if (code && !o.end) o.end = { ply: k + 1, code: code, fen: E.toFen(game.position, full) } }
  o.fen = E.toFen(game.position, full);
  if (!o.err && !o.end) {
    var g = o.res == '1-0' ? 0 : o.res == '0-1' ? 1 : game.position.side === E.WHITE ? 1 : 0;
    /* a side proven unable to mate earlier in the game stays unable: the draw needs no new search */
    if (game.neverMates(g ? E.BLACK : E.WHITE)) o.fin = { draw: true, dead: false, side: g, known: true };
    else { var r = judge(o.fen, P, B, g); o.fin = r ? { draw: r.draw, dead: r.dead, reason: r.reason, side: g } : { side: g, bad: badReason } } }
  return pgnClass(o) }
function pgnRight(o) {
  if (o.end) return o.end.code == RES.WHITE_MATES ? '1-0' : o.end.code == RES.BLACK_MATES ? '0-1' : '1/2-1/2';
  if (o.fin && !o.fin.bad) return o.fin.draw ? '1/2-1/2' : o.fin.side ? '0-1' : '1-0';
  return '' }
function pgnClass(o) {
  o.right = pgnRight(o);
  /* a game drawn by agreement or claim, or left unfinished, did not end on a flag: the flag verdict is
     kept for the detail view as a what-if, but it is not the game's correct result */
  if (!o.end && !o.err && (o.res == '1/2-1/2' || o.res == '*')) o.right = '';
  if (o.err) o.cat = /illegal|ambiguous|aftermate/.test(o.err.k) ? 'illegal' : 'unread';
  else if (o.end && o.end.ply < o.plies) o.cat = o.end.code == RES.DEAD_POSITION ? 'lateDP' : 'lateRule';
  else if (!o.end && o.fin && o.fin.bad !== undefined) o.cat = 'unread';
  else if (o.res == '*') o.cat = 'open';
  else if (!o.end && o.res == '1/2-1/2') o.cat = 'drawn';
  else if (o.res == o.right) o.cat = 'ok';
  else o.cat = !o.end && o.right == '1/2-1/2' ? 'wrongtm' : 'wrongres';
  return o }
/* the flag-fall verdict of a game in words */
function finWords(f) {
  if (!f || f.bad) return '';
  var r = { draw: f.draw, dead: f.dead, side: f.side };
  return verdictWords(r) + (f.reason ? ' (' + T('rs_' + f.reason).toLowerCase() + ')' : '') }

/* ---- input ---- */
function pgnPasted() { var s = $('pgntext').value; return s.trim() ? pgnSplit(s, 'pasted') : [] }
function pgnAll() { var g = pgnPasted(); PGN.files.forEach(function (f) { g = g.concat(f.games) }); return g }
function pgnRefresh() {
  var g = $('pgngo');
  if (PGN.busy) { g.textContent = T('goStop'); g.disabled = false; return }
  var n = pgnAll().length; g.textContent = n > 1 ? F('pgnGo', num(n)) : n ? T('pgnGo1') : T('pgnGo0'); g.disabled = !n }
function pgnFiles(list) {
  Array.prototype.forEach.call(list, function (file) {
    file.text().then(function (txt) {
      var f = { key: ++PGN.seq, name: file.name, games: pgnSplit(txt, file.name.replace(/\.pgn$/i, '')) };
      PGN.files.push(f); pgnFileList(); pgnRefresh() }) }) }
function pgnFileList() {
  $('pgnflist').innerHTML = PGN.files.map(function (f) {
    return '<li><span class="fname">' + esc(f.name) + '</span><span class="fmeta">' + F('pgnN', num(f.games.length)) + '</span>' +
      '<button class="x" data-prm="' + f.key + '" aria-label="' + esc(F('fRemove', f.name)) + '">×</button></li>' }).join('') }

/* ---- run ---- */
function pgnRun() {
  if (PGN.busy) { PGN.cancel = true; return }
  if (busy) return;
  var games = pgnAll(); if (!games.length) return;
  var P = ply(), B = bud();
  PGN.busy = true; PGN.cancel = false; PGN.res = null; pgnLock(true); pgnRender();
  var res = [], i = 0, T0 = performance.now();
  $('pbar').classList.toggle('hide', games.length < 2);
  (function chunk() {
    var until = performance.now() + 50;
    do { res.push(pgnGame(games[i], P, B)); i++ } while (i < games.length && !PGN.cancel && performance.now() < until);
    var secs = (performance.now() - T0) / 1000;
    $('pbarf').style.width = (100 * i / games.length) + '%';
    $('pstat').textContent = F('pgnProg', num(i), num(games.length), num(Math.round(i / Math.max(secs, .001))));
    if (i < games.length && !PGN.cancel) setTimeout(chunk, 0);
    else { $('pbar').classList.add('hide');
      PGN.res = res; PGN.P = P; PGN.B = B; PGN.secs = secs; PGN.stopped = i < games.length;
      PGN.busy = false; PGN.page = 0; PGN.filt = ''; PGN.sel = -1; pgnLock(false); pgnRender() } })() }
function pgnLock(on) {
  ['pgntext', 'go'].forEach(function (id) { $(id).disabled = on });
  Array.prototype.forEach.call(ROOT.querySelectorAll('#pgnflist button'), function (x) { x.disabled = on });
  $('pdrop').classList.toggle('off', on); $('pgngo').classList.toggle('stop', on);
  if (!on) refreshCount(); pgnRefresh() }

/* ---- report ---- */
function pgnMoveNo(o, p) { var h = p - 1 + (o.s0 ? 0 : 1); return (o.full0 + (h >> 1)) + (h % 2 ? '…' : '.') }
/* a ply as the scoresheet writes it: 41.Bxe5 or 41…Kf6; ply 0 is the starting position */
function pgnRef(o, p) { return p ? pgnMoveNo(o, p) + o.moves[p - 1] : T('pd_startShort') }
function pgnEndText(o) { return o.end ? pgnRef(o, o.end.ply) + ': ' + T('res' + o.end.code) : finWords(o.fin) }
function pgnRender() {
  var R0 = PGN.res, box = $('pgnout');
  if (!R0) { box.classList.add('hide'); if (!PGN.busy) $('pstat').textContent = ''; return }
  box.classList.remove('hide');
  $('pstat').textContent = PGN.stopped ? F('pgnStopped', num(R0.length), num(pgnAll().length)) : F('pgnDone', num(R0.length), dur(PGN.secs));
  var cnt = {}; PGN_CATS.forEach(function (k) { cnt[k] = 0 }); R0.forEach(function (o) { cnt[o.cat]++ });
  $('pgnsum').innerHTML = '<table><tr><th>' + T('pgnThCat') + '</th><th>' + T('pgnThN') + '</th></tr>' +
    PGN_CATS.filter(function (k) { return cnt[k] }).map(function (k) {
      return '<tr class="pc-' + k + '"><td>' + T('pc_' + k) + '</td><td>' + num(cnt[k]) + '</td></tr>' }).join('') + '</table>';
  $('pgnfilt').innerHTML = '<option value="">' + T('pgnFiltAll') + ' (' + num(R0.length) + ')</option>' +
    PGN_CATS.filter(function (k) { return cnt[k] }).map(function (k) {
      return '<option value="' + k + '"' + (PGN.filt == k ? ' selected' : '') + '>' + T('pc_' + k) + ' (' + num(cnt[k]) + ')</option>' }).join('');
  var list = [], k; for (k = 0; k < R0.length; k++) if (!PGN.filt || R0[k].cat == PGN.filt) list.push(k);
  var per = 50, pages = Math.max(1, Math.ceil(list.length / per)); if (PGN.page >= pages) PGN.page = pages - 1;
  var h = '<tr><th>#</th><th>' + T('pgnThGame') + '</th><th>' + T('pgnThPlayers') + '</th><th>' + T('pgnThRes') + '</th><th>' + T('pgnThTerm') +
        '</th><th>' + T('pgnThPlies') + '</th><th>' + T('pgnThEnd') + '</th><th>' + T('pgnThExtra') + '</th><th>' + T('pgnThRight') + '</th><th>' + T('pgnThCat') + '</th></tr>';
  list.slice(PGN.page * per, (PGN.page + 1) * per).forEach(function (k) { var o = R0[k], g = o.tags;
    h += '<tr class="pc-' + o.cat + (k == PGN.sel ? ' act' : '') + '" data-pk="' + k + '" tabindex="0"><td>' + (k + 1) + '</td><td>' + esc(o.set) + ', ' + esc(o.id) + '</td><td>' +
       esc((g.White || '?') + ' – ' + (g.Black || '?')) + '</td><td>' + esc(o.res) + '</td><td>' + esc(g.Termination || '') + '</td><td>' + num(o.plies) +
       '</td><td>' + esc(pgnEndText(o)) + '</td><td>' + (o.end && o.end.ply < o.plies ? num(o.plies - o.end.ply) : '') + '</td><td>' + esc(o.right) +
       '</td><td>' + T('pc_' + o.cat) + '</td></tr>' });
  $('pgntab').innerHTML = h;
  $('pgnpg').innerHTML = pages > 1 ? '<button data-ppg="-1"' + (PGN.page ? '' : ' disabled') + '>' + T('prev') + '</button><span>' +
    F('pgOf', PGN.page + 1, pages, num(list.length)) + '</span><button data-ppg="1"' + (PGN.page < pages - 1 ? '' : ' disabled') + '>' + T('next') + '</button>' : '';
  pgnDetail() }
function pgnErrText(err) {
  if (err.k == 'badstart') return F('perr_badstart', badText(err.p));
  if (err.k == 'variant') return F('perr_variant', esc(err.a[0]));
  if (err.k == 'parse') return T('perr_parse');
  return F('perr_' + err.k, num(err.a[0]), esc(err.a[1])) }
function pgnDetail() {
  var box = $('pgndet'), o = PGN.res && PGN.res[PGN.sel];
  if (!o) { box.innerHTML = ''; return }
  var g = o.tags, fen = o.end ? o.end.fen : o.fen, flag = o.fin ? o.fin.side : -1, h = '<h3>' + esc(o.set) + ', ' + esc(o.id) + '</h3><p class="note">';
  if (o.err) h += pgnErrText(o.err) + (o.end ? ' ' + F('pd_endFirst', pgnRef(o, o.end.ply), T('res' + o.end.code)) : '');
  else if (o.end && o.end.ply < o.plies) h += o.end.ply ? F('pd_late', pgnRef(o, o.end.ply), T('res' + o.end.code), num(o.plies - o.end.ply))
                                              : F('pd_lateStart', T('res' + o.end.code), num(o.plies));
  else if (o.end) h += o.end.ply ? F('pd_here', pgnRef(o, o.end.ply), T('res' + o.end.code)) : F('pd_hereStart', T('res' + o.end.code));
  else if (o.fin) h += F('pd_final', sideName(o.fin.side), o.fin.bad ? badText(o.fin.bad) : finWords(o.fin)) + (o.fin.known ? ' ' + F('pd_known', sideName(1 - o.fin.side)) : '');
  h += '</p><div class="pdet">' + (fen ? drawBoard(fen, flag, true) : '') + '<div><dl class="kv">' +
    '<dt>' + T('pk_players') + '</dt><dd>' + esc((g.White || '?') + ' – ' + (g.Black || '?')) + '</dd>' +
    '<dt>' + T('pk_res') + '</dt><dd>' + esc(o.res) + (g.Termination ? ' (' + esc(g.Termination) + ')' : '') + '</dd>' +
    '<dt>' + T('pk_right') + '</dt><dd>' + esc(o.right || '—') + '</dd></dl>';
  if (fen) { var lid = o.lid ? 'https://lichess.org/' + o.lid : '';
    h += '<p class="fenbox">' + esc(fen) + '</p><div class="acts"><button class="cp" data-fen="' + esc(fen) + '">' + T('lbCopy') + '</button>' +
       '<a class="btn" target="_blank" rel="noopener" href="' + esc(editor(fen)) + '">' + T('openEditor') + '</a>' +
       (lid ? '<a class="btn" target="_blank" rel="noopener" href="' + lid + (o.end ? '#' + o.end.ply : '') + '">' + T('openGame') + '</a>' : '') + '</div>' }
  h += '</div></div><h4>' + T('pk_moves') + '</h4><p class="mvs">';
  o.moves.forEach(function (m, k) { var p = k + 1, cls = o.end && p == o.end.ply ? 'e' : o.end && p > o.end.ply ? 'a' : o.err && o.err.a && p == o.err.a[0] ? 'x' : '';
    var h2 = p - 1 + (o.s0 ? 0 : 1); if (h2 % 2 == 0 || k == 0) h += '<span class="n">' + pgnMoveNo(o, p) + '</span>';
    h += '<span' + (cls ? ' class="' + cls + '"' : '') + '>' + esc(m) + '</span> ' });
  box.innerHTML = h + '</p>' }
$('pgntab').addEventListener('click', function (ev) { var r = ev.target.closest('tr[data-pk]'); if (!r) return;
  PGN.sel = +r.getAttribute('data-pk'); pgnRender(); $('pgndet').scrollIntoView({ behavior: 'smooth', block: 'nearest' }) });
$('pgntab').addEventListener('keydown', function (ev) { if (ev.key == 'Enter' || ev.key == ' ') { var r = ev.target.closest('tr[data-pk]'); if (r) { ev.preventDefault(); r.click() } } });
$('pgnpg').addEventListener('click', function (ev) { var x = ev.target.closest('[data-ppg]'); if (!x || x.disabled) return; PGN.page += +x.getAttribute('data-ppg'); pgnRender() });
$('pgnfilt').onchange = function () { PGN.filt = this.value; PGN.page = 0; pgnRender() };
$('pgngo').onclick = pgnRun;
$('pgntext').addEventListener('input', function () { clearTimeout(this._t); this._t = setTimeout(pgnRefresh, 200) });
$('pgnflist').addEventListener('click', function (ev) { var x = ev.target.closest('[data-prm]'); if (!x || PGN.busy) return;
  PGN.files = PGN.files.filter(function (f) { return f.key != x.getAttribute('data-prm') }); pgnFileList(); pgnRefresh() });
(function () { var d = $('pdrop'), f = $('pfile');
  d.onclick = function () { if (!PGN.busy) f.click() };
  d.onkeydown = function (ev) { if (ev.key == 'Enter' || ev.key == ' ') { ev.preventDefault(); if (!PGN.busy) f.click() } };
  f.onchange = function () { if (f.files.length) pgnFiles(f.files); f.value = '' };
  d.ondragover = function (ev) { ev.preventDefault(); if (!PGN.busy) d.classList.add('over') };
  d.ondragleave = function () { d.classList.remove('over') };
  d.ondrop = function (ev) { ev.preventDefault(); d.classList.remove('over'); if (!PGN.busy && ev.dataTransfer.files.length) pgnFiles(ev.dataTransfer.files) } })();
$('pgnexp').onclick = function () { if (!PGN.res) return;
  var o = ['set,gameId,white,black,result,termination,plies,finding,end_ply,end_move,ended_by,extra_plies,correct,flag_fall_verdict,flagged,error,fen_at_end'];
  PGN.res.forEach(function (r) { var g = r.tags, f = r.fin;
    o.push([r.set, r.id, g.White || '', g.Black || '', r.res, g.Termination || '', r.plies, r.cat,
      r.end ? r.end.ply : '', r.end && r.end.ply ? pgnRef(r, r.end.ply) : '', r.end ? E.RESULT_NAMES[r.end.code] : '', r.end && r.end.ply < r.plies ? r.plies - r.end.ply : '',
      r.right, f && !f.bad ? (f.draw ? (f.dead ? 'dead position' : 'draw on time') : (f.side ? 'black' : 'white') + ' wins on time') : '', f ? (f.side ? 'white' : 'black') : '',
      r.err ? r.err.k + (r.err.a ? ':' + r.err.a.join(':') : '') : '', r.end ? r.end.fen : r.fen || ''].map(csvf).join(',')) });
  download('games.csv', o.join('\n') + '\n') };

/* ═══════════════════════════════ wiring ═══════════════════════════════ */
function limNote() { $('limnote').textContent = F('limNote', LIMITS[0], num(LIMITS[1])) }
$('fold-engine').addEventListener('toggle', function () {
  if (this.open && !$('srcbox').textContent) $('srcbox').textContent = $('mateless-engine').textContent.trim() });
function applyI18n() {
  var els = ROOT.querySelectorAll('[data-i]'), i, el, k;
  for (i = 0; i < els.length; i++) { el = els[i]; k = els[i].getAttribute('data-i');
    if (el.hasAttribute('data-ihtml')) el.innerHTML = T(k); else el.textContent = T(k) }
  ROOT.querySelector('[data-i="engineNote"]').innerHTML = F('engineNote', num(ENGINE_BYTES));
  limNote(); inputChanged();
  if (results) { var s = $('stat').innerHTML; showResults(); if (busy) say(s) }
  if (!$('lb').classList.contains('hide')) lbShow();
  pgnRefresh(); if (PGN.res) pgnRender() }
/* the language is the site's (English unless the reader chose Turkish) */
lang = MatelessSite.lang;
MatelessSite.onLang(function (l) { lang = l; applyI18n() });
applyI18n();
})();
