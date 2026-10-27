/* ═══ Mateless · Lichess scan: the work on one batch of games ═══════════════════════════════

   makeScanner(E, CHA) → { scanGames(text, opts) }. E is mateless.js, CHA chasolver's JavaScript
   port (chasolver.html). The same code runs in the page's workers and in Node (tests).

   For each game: replayed move by move; Mateless's two flags after every ply. Checkmates are
   skipped (a mate proves no earlier position was dead). Four kinds of rows come out:
     mw  Mateless, wrong result: decisive, not by mate, and the winner's flag was down (it could
         never mate): on time, by resignation, abandoned or otherwise
     ml  Mateless, late end: a draw that went on at least 2 plies after both flags came down
     cw  chasolver (full search, winnability): wrong result, the winner unwinnable at the end
     cl  chasolver: late end, a draw whose final position is unwinnable for both colours, with the
         earliest ply from which it stays so (searched back from the end; the full search at
         each ply probed)
   No row is checked further here: that is a separate step. */
function makeScanner(E, CHA) {
  const I = E._internal;
  const { WHITE, BLACK, PAWN, KING, QUEEN, ROOK, BISHOP, KNIGHT } = E;
  const FLAG_CASTLE = I.FLAG_CASTLE, FLAG_PROMO = I.FLAG_PROMO;
  const MOVES = new Int32Array(256), MOVES2 = new Int32Array(256), MOVES3 = new Int32Array(256);
  const KEY = new Int32Array(I.KEY_WORDS);
  const START = E.fromFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1').position;
  const pos = START.clone(), work = START.clone();
  const LETTER = { K: KING, Q: QUEEN, R: ROOK, B: BISHOP, N: KNIGHT };
  const PROMO = { Q: QUEEN, R: ROOK, B: BISHOP, N: KNIGHT };

  /* ─── PGN ─── */
  function headers(lines) {
    const h = {};
    for (const L of lines) {
      const m = /^\[(\w+)\s+"(.*)"\]\s*$/.exec(L);
      if (m) h[m[1]] = m[2];
    }
    return h;
  }
  /** SAN moves and the clock after each (seconds, -1 when absent); whether the last gave mate. */
  function tokens(text, sans, clocks) {
    sans.length = 0; clocks.length = 0;
    let mate = false, i = 0;
    const n = text.length;
    while (i < n) {
      const c = text.charCodeAt(i);
      if (c === 32 || c === 10 || c === 13 || c === 9) { i++; continue; }
      if (c === 123) {                                   // { comment }
        let e = text.indexOf('}', i); if (e < 0) e = n;
        const k = text.indexOf('[%clk ', i);
        if (k >= 0 && k < e) {
          const t = text.slice(k + 6, text.indexOf(']', k));
          let secs = 0;
          for (const part of t.split(':')) secs = secs * 60 + (parseInt(part, 10) || 0);
          if (clocks.length) clocks[clocks.length - 1] = secs;
        }
        i = e + 1; continue;
      }
      if (c === 40) {                                    // ( variation ), not in Lichess's database
        let d = 0;
        while (i < n) { const x = text.charCodeAt(i++); if (x === 40) d++; else if (x === 41 && --d === 0) break; }
        continue;
      }
      const s = i;
      while (i < n) { const x = text.charCodeAt(i); if (x === 32 || x === 10 || x === 13 || x === 9 || x === 123) break; i++; }
      let tok = text.slice(s, i);
      if (tok[0] === '$' || tok === '*' || tok === '1-0' || tok === '0-1' || tok === '1/2-1/2') continue;
      if (tok.charCodeAt(0) >= 48 && tok.charCodeAt(0) <= 57 && !tok.startsWith('0-0')) {
        tok = tok.replace(/^\d+\.*/, '');                // a move number, maybe glued to the move
        if (!tok) continue;
      }
      mate = tok.indexOf('#') >= 0;
      sans.push(tok); clocks.push(-1);
    }
    return mate;
  }
  /** The legal move a SAN names: [move, promotion] or null. */
  function resolve(p, san) {
    const n = I.generateLegalMoves(p, MOVES, 0);
    let s = san;
    while (s.length && '+#!?'.indexOf(s[s.length - 1]) >= 0) s = s.slice(0, -1);
    if (s === 'O-O' || s === '0-0' || s === 'O-O-O' || s === '0-0-0') {
      const long = s.length === 5;
      for (let i = 0; i < n; i++) {
        const mv = MOVES[i], from = mv & 63, to = (mv >> 6) & 63;
        if (((mv >> 12) & FLAG_CASTLE) && ((to < from) === long)) return [mv, QUEEN];
      }
      return null;
    }
    let ty = PAWN, body = s;
    if (LETTER[s[0]] !== undefined) { ty = LETTER[s[0]]; body = s.slice(1); }
    let promo = 0;
    const eq = body.indexOf('=');
    if (eq >= 0) { promo = PROMO[body[eq + 1]] || 0; body = body.slice(0, eq); }
    else if (ty === PAWN && body.length >= 3 && PROMO[body[body.length - 1]]) { promo = PROMO[body[body.length - 1]]; body = body.slice(0, -1); }
    if (body.length < 2) return null;
    const fc = body.charCodeAt(body.length - 2) - 97, rc = body.charCodeAt(body.length - 1) - 49;
    if (fc < 0 || fc > 7 || rc < 0 || rc > 7) return null;
    const dest = rc * 8 + fc;
    let df = -1, dr = -1;
    for (let j = 0; j < body.length - 2; j++) {
      const x = body.charCodeAt(j);
      if (x >= 97 && x <= 104) df = x - 97; else if (x >= 49 && x <= 56) dr = x - 49;
    }
    let found = -1;
    for (let i = 0; i < n; i++) {
      const mv = MOVES[i], from = mv & 63, to = (mv >> 6) & 63;
      if (((mv >> 12) & FLAG_CASTLE) || to !== dest || (p.board[from] & 7) !== ty) continue;
      if ((df >= 0 && (from & 7) !== df) || (dr >= 0 && (from >> 3) !== dr)) continue;
      if (found >= 0) return null;                       // ambiguous
      found = mv;
    }
    if (found < 0) return null;
    if (((found >> 12) & FLAG_PROMO) && !promo) return null;
    return [found, promo || QUEEN];
  }

  /** The same move from the geometry of the pieces alone: the PGN comes from Lichess, whose
      moves are legal, so no legality is checked. Only when two pieces of the kind could go there
      (the SAN names one because the other is pinned) is the full resolver asked. */
  const KNIGHT_STEPS = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
  const DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]], LINE = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  function fastResolve(p, san) {
    let s = san;
    while (s.length && '+#!?'.indexOf(s[s.length - 1]) >= 0) s = s.slice(0, -1);
    const us = p.side, board = p.board;
    if (s === 'O-O' || s === '0-0' || s === 'O-O-O' || s === '0-0-0') {
      const from = p.kingSquare(us), rook = (from & 56) | (s.length === 5 ? 0 : 7);
      if (board[rook] !== (us | ROOK)) return resolve(p, san);
      return [from | (rook << 6) | (FLAG_CASTLE << 12), QUEEN];
    }
    let ty = PAWN, body = s;
    if (LETTER[s[0]] !== undefined) { ty = LETTER[s[0]]; body = s.slice(1); }
    let promo = 0;
    const eq = body.indexOf('=');
    if (eq >= 0) { promo = PROMO[body[eq + 1]] || 0; body = body.slice(0, eq); }
    else if (ty === PAWN && body.length >= 3 && PROMO[body[body.length - 1]]) { promo = PROMO[body[body.length - 1]]; body = body.slice(0, -1); }
    if (body.length < 2) return null;
    const tf = body.charCodeAt(body.length - 2) - 97, tr = body.charCodeAt(body.length - 1) - 49;
    if (tf < 0 || tf > 7 || tr < 0 || tr > 7) return null;
    const to = tr * 8 + tf;
    let df = -1, dr = -1;
    for (let j = 0; j < body.length - 2; j++) {
      const x = body.charCodeAt(j);
      if (x >= 97 && x <= 104) df = x - 97; else if (x >= 49 && x <= 56) dr = x - 49;
    }
    const own = us | ty, back = us === WHITE ? -8 : 8;
    let from = -1;
    if (ty === PAWN) {
      if (df >= 0 && df !== tf) from = to + back + (df - tf);              // a capture, "exd5"
      else if (board[to + back] === own) from = to + back;
      else if (board[to + 2 * back] === own) from = to + 2 * back;
      if (from < 0 || from > 63 || board[from] !== own) return resolve(p, san);
      let flags = 0;
      if (to === p.ep && df >= 0 && df !== tf && !board[to]) flags = I.FLAG_EP;
      else if (to - from === 16 || from - to === 16) flags = I.FLAG_DOUBLE;
      else if (to < 8 || to > 55) flags = FLAG_PROMO;
      if ((flags & FLAG_PROMO) && !promo) return null;
      return [from | (to << 6) | (flags << 12), promo || QUEEN];
    }
    let found = -1, count = 0;
    const take = sq => {
      if (board[sq] !== own) return;
      if ((df >= 0 && (sq & 7) !== df) || (dr >= 0 && (sq >> 3) !== dr)) return;
      found = sq; count++;
    };
    if (ty === KING) take(p.kingSquare(us));
    else if (ty === KNIGHT) {
      for (const [a, b] of KNIGHT_STEPS) { const f = tf + a, r = tr + b; if (f >= 0 && f < 8 && r >= 0 && r < 8) take(r * 8 + f); }
    } else {
      const dirs = ty === BISHOP ? DIAG : ty === ROOK ? LINE : DIAG.concat(LINE);
      for (const [a, b] of dirs) {
        for (let f = tf + a, r = tr + b; f >= 0 && f < 8 && r >= 0 && r < 8; f += a, r += b) {
          const sq = r * 8 + f;
          if (board[sq]) { take(sq); break; }
        }
      }
    }
    if (count !== 1) return resolve(p, san);
    return [found | (to << 6), QUEEN];
  }

  /* ─── judgements at the final position ─── */
  function rung(p, flagged) {
    if (I.materialTest(p, flagged)) return 'material';
    if (I.lockTest(p, flagged)) return 'lock';
    return E.proveCannotBeMated(p, flagged).proven ? 'domino' : 'none';
  }
  /** scalachess 18.0.1's rule when `flagged` (to move) runs out of time (#821's lookahead), and
      the same with mateless-scalachess's a-lock. */
  function lichessDraw(p, flagged, withLock) {
    if (I.materialTest(p, flagged)) return true;
    const n = I.generateLegalMoves(p, MOVES2, 0);
    if (!n) return false;
    if (withLock && I.lockTest(p, flagged)) return true;
    const q = p.clone();
    for (let i = 0; i < n; i++) {
      const mv = MOVES2[i], promos = ((mv >> 12) & FLAG_PROMO) ? E.PROMOTION_ORDER : [QUEEN];
      for (const pr of promos) {
        I.doMove(q, mv, pr);
        const m = I.generateLegalMoves(q, MOVES3, 0), chk = E.inCheck(q);
        const ok = m === 0 || I.materialTest(q, flagged) || (withLock && I.lockTest(q, flagged));
        I.undoMove(q);
        if (!ok) return false;
      }
    }
    return true;
  }
  const CB = CHA && CHA.B, CW = CHA && CHA.W;
  const chaColor = c => (c === WHITE ? CB.WHITE : CB.BLACK);
  /** chasolver: can `col` never win at this FEN? Its fast check first (it proves no more than the
      full search does, and costs less), then the full search. 'U', 'W' or '?'. */
  function chaUnwinnable(fen, col, stats) {
    let b;
    try { b = CB.boardFromFen(fen); } catch (e) { stats.chaErrors++; return '?'; }
    if (CW.isUnwinnableFast(b, chaColor(col))) return 'U';
    stats.chaFull++;
    const r = CW.winnability(b, chaColor(col)).result;
    return r === 'unwinnable' ? 'U' : r === 'winnable' ? 'W' : '?';
  }

  /* ─── output ─── */
  const speedOf = e => { for (const s of ['UltraBullet', 'Bullet', 'Blitz', 'Rapid', 'Classical', 'Correspondence']) if (e.indexOf(s) >= 0) return s; return e; };
  function clocksAt(clocks, ply, whiteFirst) {
    let w = -1, b = -1;
    for (let i = 0; i < ply && i < clocks.length; i++) {
      if (clocks[i] < 0) continue;
      if ((i % 2 === 0) === whiteFirst) w = clocks[i]; else b = clocks[i];
    }
    return [w, b];
  }
  function secondsAfter(clocks, from, to, tc, whiteFirst) {
    const [w0, b0] = clocksAt(clocks, from, whiteFirst), [w1, b1] = clocksAt(clocks, to, whiteFirst);
    const m = /^(\d+)\+(\d+)$/.exec(tc || '');
    if (!m || Math.min(w0, b0, w1, b1) < 0) return '';
    return String(Math.max(0, (w0 - w1) + (b0 - b1) + (+m[2]) * (to - from)));
  }

  function newStats() {
    return { games: 0, plies: 0, mates: 0, errors: 0, errorIds: [], skipped: 0, chaFull: 0, chaErrors: 0,
             mw: 0, ml: 0, cw: 0, cl: 0, bannedMw: 0, bannedCw: 0, byTerm: {}, mwBy: {}, mlBy: {}, cwBy: {}, clBy: {} };
  }
  const bump = (o, k) => { o[k] = (o[k] || 0) + 1; };

  /** Every complete game in `text`. opts: { chasolver: bool } */
  function scanGames(text, opts, out, stats) {
    const lines = text.split('\n');
    let hl = [], ml = [], inMoves = false;
    const flush = () => { if (hl.length || ml.length) game(hl, ml.join('\n'), opts, out, stats); hl = []; ml = []; inMoves = false; };
    for (let L of lines) {
      if (L.endsWith('\r')) L = L.slice(0, -1);
      if (L[0] === '[') { if (inMoves) flush(); hl.push(L); }
      else if (L.trim()) { inMoves = true; ml.push(L); }
    }
    flush();
  }

  // reps: the full code of each position since the last capture or pawn move (a 32-bit hash is
  // not enough: hashKey only spreads codes over a table, and king moves in a locked structure collide)
  const sans = [], clocks = [], moveList = [], reps = [];
  function fenAt(ply, start, fullStart) {
    work.copyFrom(start);
    for (let i = 0; i < ply; i++) I.doMove(work, moveList[2 * i], moveList[2 * i + 1]);
    return E.toFen(work, fullStart + ((ply + (start.side === BLACK ? 1 : 0)) >> 1));
  }

  function game(hl, movetext, opts, out, stats) {
    stats.games++;
    const h = headers(hl);
    const variant = h.Variant || '';
    if (variant && variant !== 'Standard' && variant !== 'From Position') { stats.skipped++; return; }
    const mate = tokens(movetext, sans, clocks);
    const result = h.Result || '*', term = h.Termination || '?';
    const decisive = result === '1-0' || result === '0-1';
    bump(stats.byTerm, term + ' ' + result + (mate ? ' mate' : ''));
    if (mate && decisive) { stats.mates++; return; }
    const id = (h.Site || '').split('/').pop() || h.GameId || '?';
    let start = START, fullStart = 1;
    if (h.FEN) {
      const r = E.fromFen(h.FEN);
      if (r.error) { stats.errors++; return; }
      start = r.position; fullStart = +(h.FEN.split(/\s+/)[5]) || 1;
    }
    const whiteFirst = start.side === WHITE;
    const drawn = result === '1/2-1/2';
    pos.copyFrom(start);
    // The flags after every ply only where a draw may have come late; a decisive result is
    // judged at its final position alone.
    const flags = drawn ? new E.Flags() : null;
    if (flags) flags.update(pos, 0);
    moveList.length = 0; reps.length = 0;
    if (drawn) { I.writeKey(pos, KEY, 0); reps.push(KEY.join(',')); }
    let ply = 0;
    for (const san of sans) {
      const r = opts.checkMoves ? resolve(pos, san) : fastResolve(pos, san);
      if (!r) { stats.errors++; if (stats.errorIds.length < 30) stats.errorIds.push(id); return; }
      I.doMove(pos, r[0], r[1]);
      moveList.push(r[0], r[1]);
      ply++;
      if (drawn) {
        if (pos.halfmove === 0) reps.length = 0;
        I.writeKey(pos, KEY, 0); reps.push(KEY.join(','));
        flags.update(pos, ply);
      }
      if (pos.undoTop > 512) {                            // keep the undo stack short: the moves are kept in moveList
        const keep = pos.clone(); pos.copyFrom(keep);
      }
    }
    stats.plies += ply;
    const plies = ply, fen = E.toFen(pos, fullStart + ((plies + (whiteFirst ? 0 : 1)) >> 1));
    if (opts.collectFens) out.fens.push(id + '\t' + fen);
    const n = I.generateLegalMoves(pos, MOVES, 0);
    const stalemate = n === 0 && !E.inCheck(pos);
    const last = reps[reps.length - 1];
    let repetitions = 0; for (const x of reps) if (x === last) repetitions++;
    const banned = term === 'Rules infraction';   // ended by Lichess for a breach (mostly cheating): left out of the lists, counted
    const insufficient = I.materialTest(pos, WHITE) && I.materialTest(pos, BLACK);
    const end = term === 'Time forfeit' || term === 'Insufficient material' ? 'timeout'
      : term === 'Abandoned' ? 'abandoned' : term !== 'Normal' ? 'other' : decisive ? 'resignation'
      : result !== '1/2-1/2' ? 'other' : stalemate ? 'stalemate' : insufficient ? 'insufficient material'
      : repetitions >= 5 ? 'fivefold' : pos.halfmove >= 150 ? '75-move' : repetitions >= 3 ? 'threefold'
      : pos.halfmove >= 100 ? '50-move' : 'agreement';
    const date = h.UTCDate || h.Date || '', speed = speedOf(h.Event || ''), tc = h.TimeControl || '';
    const winner = result === '1-0' ? WHITE : result === '0-1' ? BLACK : -1;
    const loser = winner === WHITE ? BLACK : WHITE;
    const wd = flags ? flags.whiteDownAt : -1, bd = flags ? flags.blackDownAt : -1, mDead = wd >= 0 && bd >= 0 ? Math.max(wd, bd) : -1;

    // Mateless. A decisive result: the ladder at the final position (material, lock, Domino).
    let mWrong = false;
    if (decisive && E.proveCannotBeMated(pos, loser).proven) {
      mWrong = true;
      const timeout = end === 'timeout';
      const dead = E.proveCannotBeMated(pos, winner).proven;
      if (banned) stats.bannedMw++;
      else {
        out.mw.push([id, 'https://lichess.org/' + id, date, speed, tc, result, end, rung(pos, loser), dead ? 1 : 0,
                     timeout ? (lichessDraw(pos, loser, false) ? 1 : 0) : '', timeout ? (lichessDraw(pos, loser, true) ? 1 : 0) : '', fen]);
        stats.mw++; bump(stats.mwBy, end);
      }
    }
    if (!decisive && mDead >= 0 && plies - mDead >= 2) {
      out.ml.push([id, 'https://lichess.org/' + id + '#' + mDead, date, speed, tc, end, mDead, plies, plies - mDead,
                   secondsAfter(clocks, mDead, plies, tc, whiteFirst), repetitions, fen]);
      stats.ml++; bump(stats.mlBy, end);
    }

    // chasolver, its full search.
    if (opts.chasolver && CHA) {
      if (decisive) {
        if (chaUnwinnable(fen, winner, stats) === 'U') {
          if (banned) stats.bannedCw++;
          else {
            out.cw.push([id, 'https://lichess.org/' + id, date, speed, tc, result, end, mWrong ? 1 : 0, fen]);
            stats.cw++; bump(stats.cwBy, end);
          }
        }
      } else if (result === '1/2-1/2') {
        const dead = p => {
          const f = p === plies ? fen : fenAt(p, start, fullStart);
          return chaUnwinnable(f, WHITE, stats) === 'U' && chaUnwinnable(f, BLACK, stats) === 'U';
        };
        if (dead(plies)) {
          // The earliest ply from which the position stays dead: back from the end in doubling
          // steps, then halving (the dead positions of a game are the plies after some ply).
          let good = plies, step = 1, bad = -1;
          while (true) {
            const p = plies - step;
            if (p < 0) { bad = -1; break; }
            if (dead(p)) { good = p; step *= 2; } else { bad = p; break; }
          }
          let lo = bad, hi = good;                       // lo not dead (or -1), hi dead
          while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (mid >= 0 && dead(mid)) hi = mid; else lo = mid; }
          if (plies - hi >= 2) {
            out.cl.push([id, 'https://lichess.org/' + id + '#' + hi, date, speed, tc, end, hi, plies, plies - hi,
                         secondsAfter(clocks, hi, plies, tc, whiteFirst), repetitions, mDead, fen]);
            stats.cl++; bump(stats.clBy, end);
          }
        }
      }
    }
  }

  const HEAD = {
    mw: ['gameId', 'link', 'date', 'speed', 'timeControl', 'result', 'end', 'class', 'dead_position', 'lichess_rule_today', 'with_a_lock', 'fen'],
    ml: ['gameId', 'link_to_dead_ply', 'date', 'speed', 'timeControl', 'end', 'dead_at_ply', 'plies', 'plies_after', 'seconds_after', 'repetitions', 'fen_end'],
    cw: ['gameId', 'link', 'date', 'speed', 'timeControl', 'result', 'end', 'mateless_agrees', 'fen'],
    cl: ['gameId', 'link_to_dead_ply', 'date', 'speed', 'timeControl', 'end', 'dead_at_ply', 'plies', 'plies_after', 'seconds_after', 'repetitions', 'mateless_dead_at_ply', 'fen_end'],
  };
  return { scanGames, newStats, HEAD };
}
if (typeof module !== 'undefined') module.exports = { makeScanner };
