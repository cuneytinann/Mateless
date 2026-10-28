/* The lock detector tab: boards painted from lockviz.js (the detector, pass by pass) and checked
   against mateless.js (the engine) as they are drawn. Every text is in English and Turkish; a
   change of language paints the figures and the explorer again. */
(function () {
  'use strict';
  const V = window.LockViz, Mt = window.Mateless;
  const tr = () => MatelessSite.lang === 'tr', L = (en, t) => tr() ? t : en;
  const GLYPH = { K: '♚', Q: '♛', R: '♜', B: '♝', N: '♞', P: '♟' };
  const FILES = 'abcdefgh';
  const big = pair => (BigInt(pair[1] >>> 0) << 32n) | BigInt(pair[0] >>> 0);
  const hex = w => { const s = w.toString(16).padStart(16, '0'); return '0x' + s.slice(0, 4) + ' ' + s.slice(4, 8) + ' ' + s.slice(8, 12) + ' ' + s.slice(12); };
  const names = w => V.squares(w).map(V.name).join(' ') || L('none', 'yok');
  const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // The zip lies beside the page on the site; a copy of the page saved on its own fetches it from GitHub.
  if (location.protocol === 'file:')
    document.querySelectorAll('#lockzip, #tab-lock a.zip').forEach(a => { a.href = 'https://github.com/cuneytinann/Mateless/raw/main/mateless-lock.zip'; });

  const EXAMPLES = [
    { id: 'lock', fen: '8/8/4k3/3p2p1/1p1P1pP1/1P3P2/8/3K4 b - - 0 92', flagged: 'w',
      name: ['A Lichess lock', 'Bir Lichess kilidi'],
      note: ['LockTest’s first position: the end of Lichess yCnBCwGd, lost on time 47 plies after the last capture or pawn move. LockTest sets its clock to 0.',
             'LockTest’in ilk pozisyonu: Lichess yCnBCwGd’nin sonu; oyun son alış ya da piyon hamlesinden 47 ply sonra süreden kaybedildi. LockTest sayacını 0 yapıyor.'] },
    { id: 'before', fen: '8/8/4k3/3p2p1/1p1P1pP1/1P6/5P2/3K4 w - - 3 91', flagged: 'w',
      name: ['One move before it: f2 still back', 'Bir hamle öncesi: f2 hâlâ geride'],
      note: ['Step through the passes: the f-pawns lose their footing one fact at a time.',
             'Geçişleri tek tek izle: f piyonları dayanaklarını birer birer kaybediyor.'] },
    { id: 'wall', fen: '8/1p6/4k3/1P1p2p1/1p1P2P1/1P1K4/8/8 w - - 0 46', flagged: 'w',
      name: ['A wall falls, the lock holds', 'Bir duvar düşüyor, kilit duruyor'],
      note: ['Lichess 3KkCirHD. The black king may take b5 some day, so b5 is no wall; the structure holds all the same.',
             'Lichess 3KkCirHD. Siyah şah bir gün b5’i alabilir, yani b5 duvar değil; yapı yine de duruyor.'] },
    { id: 'net', fen: '3k4/8/p1p1p1p1/PbP1P1P1/3K4/8/8/8 w - - 55 70', flagged: 'w',
      name: ['A bishop loose in White’s half', 'Beyazın yarısında serbest bir fil'],
      note: ['Lichess uxkgEMs4. The bishop may attack 16 squares the white king can reach; every one has a flight.',
             'Lichess uxkgEMs4. Fil, beyaz şahın erişebildiği 16 kareye saldırabilir; her birinin bir kaçış karesi var.'] },
    { id: 'frozen', fen: '8/8/8/8/5k2/6p1/6Pp/7K b - - 1 56', flagged: 'w',
      name: ['A king boxed in a corner', 'Köşeye kapanmış bir şah'],
      note: ['Lichess UdbdvLHz. With both kings free h2 could promote; frozen, the white king is the wall in front of it.',
             'Lichess UdbdvLHz. İki şah da serbestken h2 terfi edebilirdi; donmuş beyaz şah onun önündeki duvar.'] },
    { id: 'check', fen: '8/8/1k6/p2p2p1/PK1P2Pp/7P/8/8 w - - 0 49', flagged: 'w',
      name: ['A king in a pawn’s check', 'Piyon şahındaki bir şah'],
      note: ['LockTest: a5 gives check. The king’s reach starts outside its mask and floods past the fence.',
             'LockTest: a5 şah çekiyor. Şahın erişimi maskesinin dışında başlıyor ve çitin ötesine yayılıyor.'] },
    { id: 'after', fen: '8/8/1k6/p2p2p1/P2P2Pp/2K4P/8/8 b - - 1 49', flagged: 'w',
      name: ['The same, after Kc3', 'Aynısı, Şc3’ten sonra'],
      note: ['One king move later (clock 1) the same structure is a lock.',
             'Bir şah hamlesi sonra (sayaç 1) aynı yapı bir kilit.'] },
    { id: 'bishop', fen: '3k4/8/p1p1p1p1/P1P1P1P1/1b1K4/8/8/8 w - - 0 70', flagged: 'w',
      name: ['A bishop that can take a pawn', 'Piyon alabilen bir fil'],
      note: ['uxkgEMs4 with Black’s bishop on the other colour: from b4 it reaches every white pawn, so no lock.',
             'uxkgEMs4, Siyahın fili öbür renkte: b4’ten her beyaz piyona ulaşıyor, yani kilit yok.'] },
    { id: 'knight', fen: '8/8/4k3/3p2p1/1p1P1pP1/1P3P2/8/3KN3 b - - 0 92', flagged: 'w',
      name: ['A knight on the board', 'Tahtada bir at'],
      note: ['The first gate: the model has no reach for a knight.', 'İlk kapı: modelde atın erişimi yok.'] },
  ];
  const pick2 = p => tr() ? p[1] : p[0];

  function pieceArray(fen) {
    const m = new Array(64).fill(null);
    fen.trim().split(/\s+/)[0].split('/').forEach((row, r) => {
      let f = 0;
      for (const ch of row) { if (ch >= '1' && ch <= '8') f += +ch; else { m[(7 - r) * 8 + f] = ch; f++; } }
    });
    return m;
  }

  /* A board in the site's .bd grid. paint: { w, b } a pair of sets; { reach, attack, flight, caught }
     the mating net; { one } a single set; mark: squares ringed, with any of them. */
  function boardHTML(pcs, paint, opt) {
    opt = opt || {};
    let h = '<div class="bd ' + (opt.size || 'mini') + '" role="img" aria-label="' + esc(opt.label || '') + '">';
    for (let r = 7; r >= 0; r--) for (let f = 0; f < 8; f++) {
      const i = r * 8 + f, bit = 1n << BigInt(i), cls = [(r + f) % 2 ? 'l' : 'd'];
      if (paint) {
        if (paint.w !== undefined) {
          const a = (paint.w & bit) !== 0n, b = (paint.b & bit) !== 0n;
          if (a && b) cls.push('sx'); else if (a) cls.push('sw'); else if (b) cls.push('sb');
        }
        if (paint.reach !== undefined) {
          if (paint.reach & bit) cls.push('nr');
          if (paint.attack & bit) cls.push('na');
          if (paint.caught & bit) cls.push('nc');
          else if (paint.attack & paint.reach & paint.flight & bit) cls.push('nf');
        }
        if (paint.one !== undefined && (paint.one & bit)) cls.push('sw');
        if (paint.mark !== undefined && (paint.mark & bit)) cls.push('mk');
      }
      const p = pcs ? pcs[i] : null;
      if (p) cls.push(p === p.toUpperCase() ? 'w' : 'b');
      let inner = p ? '<em>' + GLYPH[p.toUpperCase()] + '</em>' : '';
      if (opt.nums) inner = '<s class="num">' + i + '</s>';
      else if (opt.coords !== false) {
        if (f === 0) inner += '<s class="rk">' + (r + 1) + '</s>';
        if (r === 0) inner += '<s class="fl">' + FILES[f] + '</s>';
      }
      h += '<i class="' + cls.join(' ') + '">' + inner + '</i>';
    }
    return h + '</div>';
  }

  function panelHTML(title, sub, pcs, paint, hexLines, label) {
    let hx = '';
    for (const [k, w, lab] of hexLines) hx += '<span>' + (k ? '<i class="' + k + '"></i>' : '') + (lab ? lab + ' ' : '') + hex(w) + ' <b>(' + V.count(w) + ')</b></span>';
    return '<figure class="pnl"><h4>' + esc(title) + '</h4><p class="sub">' + esc(sub) + '</p>' +
      boardHTML(pcs, paint, { label: label || title }) + '<div class="hx">' + hx + '</div></figure>';
  }

  function analyse(fen, flagged) {
    const parsed = Mt.fromFen(fen.trim());
    if (!parsed || parsed.error || !parsed.position)
      return { error: L('This FEN does not read', 'Bu FEN okunmuyor') + (parsed && parsed.error ? ' (' + parsed.error + ')' : '') +
        L('. Paste a full FEN: board, side to move, castling, en passant.', '. Tam bir FEN yapıştır: tahta, sıra, rok, geçerken alma.') };
    const pos = parsed.position;
    const s = V.setsOfBoard(fen.trim().split(/\s+/)[0]);
    s.ep = pos.ep !== Mt.NO_SQUARE;
    const t = V.trace(s, flagged);
    const color = flagged === 'w' ? Mt.WHITE : Mt.BLACK;
    let agree = Mt.lockCannotMate(pos, color) === t.proved;
    if (agree && t.proved) {
      const c = Mt._internal.lockSets(pos, color), lv = t.level;
      agree = big(c.wCone) === lv.cones.wCone && big(c.bCone) === lv.cones.bCone &&
        big(c.wFixed) === lv.final.wFixed && big(c.bFixed) === lv.final.bFixed &&
        big(c.wKing) === lv.final.wKing && big(c.bKing) === lv.final.bKing &&
        big(c.wBish) === lv.bishops.wBish && big(c.bBish) === lv.bishops.bBish;
    }
    const otherProved = V.trace(s, flagged === 'w' ? 'b' : 'w').proved;
    return { s, t, agree, pcs: pieceArray(fen), otherProved, flagged };
  }

  const frozenOf = (lv, s) => lv.frozen === 'white' ? s.wk : lv.frozen === 'black' ? s.bk : 0n;
  const side = c => c === 'w' ? L('White', 'Beyaz') : L('Black', 'Siyah');
  const sideGen = c => c === 'w' ? L('White’s', 'Beyazın') : L('Black’s', 'Siyahın');
  const LEVEL_PHRASE = () => ({ none: L('with both kings free', 'iki şah da serbestken'), white: L('with White’s king frozen', 'beyaz şah donmuşken'), black: L('with Black’s king frozen', 'siyah şah donmuşken') });
  const LEVEL_NAME = () => ({ none: L('Both kings free', 'İki şah serbest'), white: L('White’s king frozen', 'Beyaz şah donmuş'), black: L('Black’s king frozen', 'Siyah şah donmuş') });
  const GATE = g => !tr() ? g : ({ 'a knight, rook or queen is on the board': 'tahtada at, kale ya da vezir var', 'two bishops of one side on one colour': 'bir tarafın aynı renkte iki fili var',
    'an en passant capture is possible': 'geçerken alma mümkün' })[g] || g;

  function wallsOf(r, lv, s) { const fr = frozenOf(lv, s); return r.start ? [s.wp | fr, s.bp | fr] : [r.wWall, r.bWall]; }
  function cyclePanels(a, lv, r) {
    const s = a.s, pcs = a.pcs, [ww, bw] = wallsOf(r, lv, s), W = side('w'), B = side('b');
    return [
      panelHTML(L('Walls', 'Duvarlar'), L('pawns the other side can never take', 'öbür tarafın hiç alamayacağı piyonlar') + (lv.frozen !== 'none' ? L(', and the frozen king', ', bir de donmuş şah') : ''),
        pcs, { w: ww, b: bw }, [['w', ww, ''], ['b', bw, '']], L('Walls', 'Duvarlar') + ': ' + W + ' ' + names(ww) + '; ' + B + ' ' + names(bw)),
      panelHTML(L('Fixed pawns', 'Sabit piyonlar'), L('pawns that can never move or be taken', 'hiç oynayamayacak ve alınamayacak piyonlar'),
        pcs, { w: r.wFixed, b: r.bFixed }, [['w', r.wFixed, ''], ['b', r.bFixed, '']], L('Fixed pawns', 'Sabit piyonlar') + ': ' + W + ' ' + names(r.wFixed) + '; ' + B + ' ' + names(r.bFixed)),
      panelHTML(L('King reaches', 'Şah erişimleri'), L('every square a king may ever stand on', 'bir şahın bir gün durabileceği her kare'), pcs, { w: r.wKing, b: r.bKing }, [['w', r.wKing, ''], ['b', r.bKing, '']]),
      panelHTML(L('Take squares', 'Alım kareleri'), L('where an enemy pawn could one day be taken', 'bir düşman piyonunun bir gün alınabileceği yerler'), pcs, { w: r.wTake, b: r.bTake }, [['w', r.wTake, ''], ['b', r.bTake, '']]),
    ].join('');
  }
  function endPanels(a, lv) {
    const pcs = a.pcs, out = [];
    const cones = lv.cones || lv.quick;
    if (cones) out.push(panelHTML(lv.cones ? L('Cones', 'Koniler') : L('Cones, first walls', 'Koniler, ilk duvarlara göre'), L('every square a pawn may still stand on', 'bir piyonun hâlâ durabileceği her kare'),
      pcs, { w: cones.wCone, b: cones.bCone }, [['w', cones.wCone, ''], ['b', cones.bCone, '']]));
    if (lv.bishops && (lv.bishops.wBish | lv.bishops.bBish)) out.push(panelHTML(L('Bishop reaches', 'Fil erişimleri'), L('every square a bishop may ever stand on', 'bir filin bir gün durabileceği her kare'),
      pcs, { w: lv.bishops.wBish, b: lv.bishops.bBish }, [['w', lv.bishops.wBish, ''], ['b', lv.bishops.bBish, '']]));
    if (lv.net) {
      const n = lv.net, fl = a.flagged, mt = a.flagged === 'w' ? 'b' : 'w';
      out.push(panelHTML(L('Mating net', 'Mat ağı'),
        L(sideGen(fl) + ' king: where ' + side(mt) + ' may attack, and the flights', sideGen(fl) + ' şahı: ' + side(mt) + ' nereye saldırabilir, kaçış kareleri nerede'), pcs, n,
        [['', n.reach, L('reach', 'erişim')], ['', n.attack & n.reach, L('attacked', 'saldırı altında')], ['', n.caught, L('no flight', 'kaçışsız')]]));
    }
    return out.join('');
  }

  const isFixed = (lv, k) => k === lv.rounds.length - 1 && !!lv.final && lv.leak !== 'the frozen king can move';
  function passNote(lv, k, s) {
    const r = lv.rounds[k];
    if (r.start) return L('Start: every pawn is a wall and fixed; each king stands on its own square, and so do its take squares.',
      'Başlangıç: her piyon duvar ve sabit; her şah kendi karesinde, alım kareleri de orada.');
    const p = lv.rounds[k - 1], bits = [];
    const [pw, pb] = wallsOf(p, lv, s), [cw, cb] = wallsOf(r, lv, s);
    const lost = (a, b) => a & V.not(b);
    const lw = lost(pw, cw), lb = lost(pb, cb), fw = lost(p.wFixed, r.wFixed), fb = lost(p.bFixed, r.bFixed);
    if (lw) bits.push(L('White’s wall ' + names(lw) + ' falls (Black may take it)', 'Beyazın duvarı ' + names(lw) + ' düşüyor (Siyah alabilir)'));
    if (lb) bits.push(L('Black’s wall ' + names(lb) + ' falls (White may take it)', 'Siyahın duvarı ' + names(lb) + ' düşüyor (Beyaz alabilir)'));
    if (fw) bits.push(L('White’s ' + names(fw) + ' may move', 'Beyazın ' + names(fw) + ' piyonu oynayabilir'));
    if (fb) bits.push(L('Black’s ' + names(fb) + ' may move', 'Siyahın ' + names(fb) + ' piyonu oynayabilir'));
    const gk = (a, b) => V.count(b & V.not(a));
    const kw = gk(p.wKing, r.wKing), kb = gk(p.bKing, r.bKing), tw = gk(p.wTake, r.wTake), tb = gk(p.bTake, r.bTake);
    if (kw || kb) bits.push(L('the king reaches grow by ' + kw + ' (White) and ' + kb + ' (Black) squares', 'şah erişimleri ' + kw + ' (Beyaz) ve ' + kb + ' (Siyah) kare büyüyor'));
    if (tw || tb) bits.push(L('the take squares by ' + tw + ' and ' + tb, 'alım kareleri ' + tw + ' ve ' + tb));
    if (r.stable) return L('Pass ' + k + ': the walls and fixed pawns are as before, so nothing else can change. This is the fixed point.',
      k + '. geçiş: duvarlar ve sabit piyonlar öncekiyle aynı, başka hiçbir şey değişemez. Sabit nokta bu.');
    const end = isFixed(lv, k) ? L(' No fixed pawn, reach or take square changed, so the loop stops: this is the fixed point.',
      ' Hiçbir sabit piyon, erişim ya da alım karesi değişmedi; döngü duruyor: sabit nokta bu.') : '';
    return L('Pass ' + k + ': ', k + '. geçiş: ') + (bits.length ? bits.join('; ') : L('nothing changes', 'hiçbir şey değişmiyor')) + '.' + end;
  }

  const LEAK_TEXT = () => ({
    'quick: a pawn can promote': L('even against the first walls a pawn’s cone reaches the last rank', 'ilk duvarlara göre bile bir piyonun konisi son yataya ulaşıyor'),
    'quick: two pawns can meet': L('even against the first walls a black cone square lies diagonally in front of a white one', 'ilk duvarlara göre bile bir siyah koni karesi bir beyaz koni karesinin çapraz önünde'),
    'a pawn can promote': L('a cone reaches the last rank: a pawn might promote', 'bir koni son yataya ulaşıyor: bir piyon terfi edebilir'),
    'two pawns can meet (a capture)': L('a black cone square lies diagonally in front of a white one: a capture is possible', 'bir siyah koni karesi bir beyaz koni karesinin çapraz önünde: alış mümkün'),
    'a bishop meets a pawn\'s path': L('a square diagonally next to a bishop’s reach lies in an enemy cone: bishop and pawn could meet', 'bir filin erişiminin çapraz komşusu olan bir kare düşman konisinde: fil ile piyon karşılaşabilir'),
    'the frozen king can move': L('the frozen king’s reach grew: it can move after all', 'donmuş şahın erişimi büyüdü: şah oynayabiliyor'),
    'the flagged king may be mated': L('some attacked square in the king’s reach has no guaranteed flight', 'şahın erişimindeki saldırı altındaki bir karenin güvenli kaçışı yok'),
  });

  /* ── the explorer ───────────────────────────────────────────────────────── */
  const st = { a: null, level: 0, pass: 0, fen: '', flagged: 'w' };
  const $ = id => document.getElementById(id);

  function showExplorer(fen, flagged) {
    st.fen = fen; st.flagged = flagged;
    const a = analyse(fen, flagged);
    const err = $('fenerr');
    if (a.error) { err.textContent = a.error; err.classList.remove('hide'); st.a = null; return; }
    err.classList.add('hide');
    st.a = a;
    const tried = a.t.levels.map((lv, i) => [lv, i]).filter(([lv]) => !lv.skipped);
    st.level = a.t.proved ? a.t.levels.indexOf(a.t.level) : (tried.length ? tried[tried.length - 1][1] : 0);
    const lv = a.t.levels[st.level];
    st.pass = lv && lv.rounds ? lv.rounds.length - 1 : 0;
    render();
  }

  function render() {
    const a = st.a; if (!a) return;
    const t = a.t, LN = LEVEL_NAME(), LT = LEAK_TEXT();
    // levels
    let lh = '<span class="lab">' + L('Level', 'Seviye') + '</span>';
    if (t.gate) lh += '<button type="button" disabled aria-pressed="false">' + L('no level: ', 'seviye yok: ') + esc(GATE(t.gate)) + '</button>';
    t.levels.forEach((lv, i) => {
      const mark = lv.skipped ? L(' (not tried)', ' (denenmedi)') : lv.leak ? ' ✗' : ' ✓';
      lh += '<button type="button" data-lv="' + i + '" aria-pressed="' + (i === st.level) + '"' + (lv.skipped ? ' class="off" disabled' : '') + '>' + LN[lv.frozen] + mark + '</button>';
    });
    $('lvls').innerHTML = lh;
    const lv = t.levels[st.level];
    // passes
    let ph = '';
    if (lv && lv.rounds && lv.rounds.length) {
      ph = '<span class="lab">' + L('Pass', 'Geçiş') + '</span>';
      lv.rounds.forEach((r, k) => {
        const lab = r.start ? L('Start', 'Başlangıç') : isFixed(lv, k) ? k + L(': fixed point', ': sabit nokta') : String(k);
        ph += '<button type="button" data-ps="' + k + '" aria-pressed="' + (k === st.pass) + '">' + lab + '</button>';
      });
    }
    $('passes').innerHTML = ph;
    // boards
    if (lv && lv.rounds && lv.rounds.length) {
      $('cyc').innerHTML = cyclePanels(a, lv, lv.rounds[st.pass]);
      $('passnote').textContent = passNote(lv, st.pass, a.s);
    } else {
      $('cyc').innerHTML = '';
      $('passnote').textContent = t.gate ? L('No sets are built: ', 'Hiç küme kurulmuyor: ') + GATE(t.gate) + '.' :
        lv && lv.leak && lv.leak.startsWith('quick') ? L('The quick test fails before the loop starts: ', 'Hızlı test döngü başlamadan düşüyor: ') + LT[lv.leak] + '.' : '';
    }
    const atEnd = lv && lv.rounds && st.pass === lv.rounds.length - 1;
    $('endp').innerHTML = lv && (atEnd || !lv.rounds.length) ? endPanels(a, lv) : '';
    $('endp').parentElement.classList.toggle('hide', !$('endp').innerHTML);
    // key
    let kh = '<span><i class="w"></i>' + L('White’s set', 'Beyazın kümesi') + '</span><span><i class="b"></i>' + L('Black’s set', 'Siyahın kümesi') + '</span><span><i class="x"></i>' + L('in both', 'ikisinde de') + '</span>';
    if (lv && lv.net && atEnd) kh += '<span><i class="r"></i>' + L('flagged king’s reach', 'bayrağı düşen şahın erişimi') + '</span><span><i class="a"></i>' + L('attacked', 'saldırı altında') +
      '</span><span><i class="f"></i>' + L('attacked, with a flight', 'saldırı altında, kaçışı var') + '</span><span><i class="c"></i>' + L('no flight', 'kaçışsız') + '</span>';
    $('key').innerHTML = kh;
    // verdict
    const fl = side(a.flagged), other = side(a.flagged === 'w' ? 'b' : 'w');
    let vh;
    if (t.proved) {
      vh = '<span class="chip k-draw">' + L('Lock', 'Kilit') + '</span><span class="why">' +
        L(fl + ' can never be mated, ' + LEVEL_PHRASE()[t.level.frozen] + '.', fl + ' hiç mat edilemez, ' + LEVEL_PHRASE()[t.level.frozen] + '.') +
        (a.otherProved ? L(' Neither can ' + other + ': a dead position (5.2.2).', ' ' + other + ' de edilemez: ölü pozisyon (5.2.2).') : '') + '</span>';
    } else {
      const why = t.gate ? GATE(t.gate) : (LT[(t.levels.filter(l => !l.skipped).pop() || {}).leak] || L('no level proves it', 'hiçbir seviye ispatlamıyor'));
      vh = '<span class="chip k-open">' + L('No proof', 'İspat yok') + '</span><span class="why">' + esc(why) + '.</span>';
    }
    vh += '<span class="agree">' + (a.agree ? L('mateless.js gives the same verdict', 'mateless.js aynı hükmü veriyor') + (t.proved ? L(' and the same sets.', ', kümeler de aynı.') : '.') :
      L('mateless.js disagrees with this drawing: please report the FEN.', 'mateless.js bu çizimle aynı fikirde değil: lütfen FEN’i bildir.')) + '</span>';
    $('vd').innerHTML = vh;
  }

  function fillExamples() {
    const sel = $('exsel'), v = sel.value;
    sel.innerHTML = EXAMPLES.map(e => '<option value="' + e.id + '">' + esc(pick2(e.name)) + '</option>').join('');
    if (v) sel.value = v;
  }
  function wireExplorer() {
    const sel = $('exsel');
    fillExamples();
    const pick = () => {
      const e = EXAMPLES.find(x => x.id === sel.value);
      $('fenin').value = e.fen; $('flsel').value = e.flagged;
      showExplorer(e.fen, e.flagged);
    };
    sel.addEventListener('change', pick);
    $('flsel').addEventListener('change', () => showExplorer($('fenin').value, $('flsel').value));
    $('fengo').addEventListener('click', () => showExplorer($('fenin').value, $('flsel').value));
    $('fenin').addEventListener('keydown', e => { if (e.key === 'Enter') showExplorer($('fenin').value, $('flsel').value); });
    $('lvls').addEventListener('click', e => {
      const b = e.target.closest('button[data-lv]'); if (!b) return;
      st.level = +b.dataset.lv; const lv = st.a.t.levels[st.level];
      st.pass = lv.rounds && lv.rounds.length ? lv.rounds.length - 1 : 0; render();
    });
    $('passes').addEventListener('click', e => {
      const b = e.target.closest('button[data-ps]'); if (!b) return;
      st.pass = +b.dataset.ps; render();
    });
    pick();
  }

  /* ── the figures in the text ──────────────────────────────────────────── */
  function figShifts() {
    const S = (1n << 42n) | (1n << 31n);   // c6 and h4
    const pan = (t, sub, w) => '<figure class="pnl"><h4>' + t + '</h4><p class="sub">' + sub + '</p>' +
      boardHTML(null, { one: w, mark: S }, { label: t + ': ' + names(w) }) + '<div class="hx"><span>' + hex(w) + '</span></div></figure>';
    $('f-shifts').innerHTML = '<div class="row r1" style="max-width:260px;margin-bottom:22px"><figure class="pnl"><h4>' + L('Square numbers', 'Kare numaraları') +
      '</h4><p class="sub">' + L('a1 = 0 … h8 = 63: bit i of a word is square i', 'a1 = 0 … h8 = 63: bir sözcüğün i. biti i. kare') + '</p>' +
      boardHTML(null, null, { nums: true, label: L('square numbers', 'kare numaraları') }) + '</figure></div>' +
      '<div class="row">' + pan('north(S)', L('every square one rank up', 'her kare bir yatay yukarı'), V.north(S)) +
      pan('sideways(S)', L('left and right; h4 does not wrap to a5', 'sola ve sağa; h4 a5’e taşmıyor'), V.sideways(S)) +
      pan('zone(S)', L('the 3×3 block around each square', 'her karenin çevresindeki 3×3 blok'), V.zone(S)) +
      pan('diagonal(S)', L('the four diagonal neighbours', 'dört çapraz komşu'), V.diagonal(S)) + '</div>' +
      '<figcaption>' + L('S = {c6, h4} = 0x0000 0400 8000 0000, ringed. Each result is one expression on the word.',
        'S = {c6, h4} = 0x0000 0400 8000 0000, halkalı. Her sonuç sözcük üzerinde tek bir ifade.') + '</figcaption>';
  }

  function levelOf(a, frozen) { return a.t.levels.find(l => l.frozen === frozen); }
  function lastRound(lv) { return lv.rounds[lv.rounds.length - 1]; }

  function figCones() {
    const a = analyse(EXAMPLES[1].fen, 'w'), lv = levelOf(a, 'none'), r = lastRound(lv), [ww, bw] = wallsOf(r, lv, a.s);
    $('f-cones').innerHTML = '<div class="row r3">' +
      panelHTML(L('Walls, at the fixed point', 'Duvarlar, sabit noktada'), L('f2 and f4 are walls no longer', 'f2 ve f4 artık duvar değil'), a.pcs, { w: ww, b: bw }, [['w', ww, ''], ['b', bw, '']]) +
      panelHTML(L('Fixed pawns', 'Sabit piyonlar'), L('neither f-pawn is fixed', 'iki f piyonu da sabit değil'), a.pcs, { w: r.wFixed, b: r.bFixed }, [['w', r.wFixed, ''], ['b', r.bFixed, '']]) +
      panelHTML(L('Cones', 'Koniler'), L('both f-pawns may reach the last rank', 'iki f piyonu da son yataya ulaşabilir'), a.pcs, { w: lv.cones.wCone, b: lv.cones.bCone }, [['w', lv.cones.wCone, ''], ['b', lv.cones.bCone, '']]) +
      '</div><figcaption>' + L('One move before a lock (LockTest’s “pawn move that locks”, White to play f2–f3). f2 has an empty square in front of it, so it is not fixed, and neither is f4; the fixed point then finds that each f-pawn could be taken, so neither is a wall. Both cones run the length of the file: a promotion cannot be ruled out, and the level fails. After f2–f3 the same test proves the lock (the explorer below has both).',
        'Kilitten bir hamle önce (LockTest’in “kilitleyen piyon hamlesi”; sıra Beyazda, f2–f3). f2’nin önü boş, yani sabit değil; f4 de değil. Sabit nokta sonra iki f piyonunun da alınabileceğini buluyor, yani ikisi de duvar değil. İki koni de dikeyin boyunca uzanıyor: terfi dışlanamıyor, seviye düşüyor. f2–f3’ten sonra aynı test kilidi ispatlıyor (aşağıdaki gezginde ikisi de var).') + '</figcaption>';
  }

  function figNet() {
    const a = analyse(EXAMPLES[3].fen, 'w'), lv = a.t.level, r = lastRound(lv);
    $('f-net').innerHTML = '<div class="row r3">' +
      panelHTML(L('King reaches', 'Şah erişimleri'), L('the white king may go anywhere on ranks 1–4', 'beyaz şah 1–4. yatayların her yerine gidebilir'), a.pcs, { w: r.wKing, b: r.bKing }, [['w', r.wKing, ''], ['b', r.bKing, '']]) +
      panelHTML(L('Bishop reaches', 'Fil erişimleri'), L('Black’s bishop: the 20 light squares of ranks 1–5', 'Siyahın fili: 1–5. yatayların 20 açık karesi'), a.pcs, { w: lv.bishops.wBish, b: lv.bishops.bBish }, [['w', lv.bishops.wBish, ''], ['b', lv.bishops.bBish, '']]) +
      panelHTML(L('Mating net', 'Mat ağı'), L('hatched: attacked in White’s reach; dot: a flight', 'taralı: Beyazın erişiminde saldırı altında; nokta: kaçış'), a.pcs, lv.net,
        [['', lv.net.attack & lv.net.reach, L('attacked', 'saldırı altında')], ['', lv.net.caught, L('no flight', 'kaçışsız')]]) +
      '</div><figcaption>' + L('A black bishop loose in White’s half (Lichess uxkgEMs4, lost on time by White). It may attack 16 of the squares the white king can reach, but each has a guaranteed flight, so White can never be mated. Both kings are free at this level.',
        'Beyazın yarısında serbest bir siyah fil (Lichess uxkgEMs4, Beyaz süreden kaybetti). Beyaz şahın erişebildiği karelerden 16’sına saldırabilir, ama her birinin güvenli bir kaçışı var; yani Beyaz hiç mat edilemez. Bu seviyede iki şah da serbest.') + '</figcaption>';
  }

  function figFrozen() {
    const a = analyse(EXAMPLES[4].fen, 'w'), l0 = levelOf(a, 'none'), l1 = levelOf(a, 'white'), r = lastRound(l1), [ww, bw] = wallsOf(r, l1, a.s);
    $('f-frozen').innerHTML = '<div class="row r3">' +
      panelHTML(L('Both kings free: cones', 'İki şah serbest: koniler'), L('h2 may promote on h1', 'h2, h1’de terfi edebilir'), a.pcs, { w: l0.quick.wCone, b: l0.quick.bCone }, [['w', l0.quick.wCone, ''], ['b', l0.quick.bCone, '']]) +
      panelHTML(L('White’s king frozen: walls', 'Beyaz şah donmuş: duvarlar'), L('the king on h1 is a wall for both sides', 'h1’deki şah iki taraf için de duvar'), a.pcs, { w: ww, b: bw }, [['w', ww, ''], ['b', bw, '']]) +
      panelHTML(L('White’s king frozen: reaches', 'Beyaz şah donmuş: erişimler'), L('h1 alone: the king never moves', 'yalnızca h1: şah hiç oynamıyor'), a.pcs, { w: r.wKing, b: r.bKing }, [['w', r.wKing, ''], ['b', r.bKing, '']]) +
      '</div><figcaption>' + L('Lichess UdbdvLHz. With both kings free, h2 could promote one day and the first level fails at once. Every square around the white king is held or attacked by a pawn, so it is tried frozen: h1 becomes a wall, h2 is fixed, and the king’s reach stays h1. White can never be mated, and neither can Black.',
        'Lichess UdbdvLHz. İki şah da serbestken h2 bir gün terfi edebilir ve ilk seviye hemen düşüyor. Beyaz şahın çevresindeki her kare bir piyonun elinde ya da bir piyonun saldırısı altında; şah bu yüzden donmuş olarak deneniyor: h1 duvar oluyor, h2 sabit, şahın erişimi h1’de kalıyor. Beyaz hiç mat edilemez, Siyah da.') + '</figcaption>';
  }

  function figCheck() {
    const a = analyse(EXAMPLES[5].fen, 'w'), lv = levelOf(a, 'none'), r = lastRound(lv);
    const b = analyse(EXAMPLES[6].fen, 'w'), lb = b.t.level, rb = lastRound(lb);
    $('f-check').innerHTML = '<div class="row r2">' +
      panelHTML(L('In check: king reaches', 'Şahta: şah erişimleri'), L('from b4 the reach floods the board', 'b4’ten erişim bütün tahtaya yayılıyor'), a.pcs, { w: r.wKing, b: r.bKing }, [['w', r.wKing, ''], ['b', r.bKing, '']]) +
      panelHTML(L('After Kc3: king reaches', 'Şc3’ten sonra: şah erişimleri'), L('ranks 1–2 and a3–f3; a lock', '1–2. yataylar ve a3–f3; kilit'), b.pcs, { w: rb.wKing, b: rb.bKing }, [['w', rb.wKing, ''], ['b', rb.bKing, '']]) +
      '</div><figcaption>' + L('LockTest’s king in a pawn’s check. On b4, attacked by a5, the white king stands outside its mask; its reach starts there, runs through a5, b5 and c5, every pawn becomes takeable and the level fails. After Kc3 (clock 1) the reach is ranks 1–2 and a3–f3, and the same test proves the lock.',
        'LockTest’in piyon şahındaki şahı. a5’in saldırdığı b4’te beyaz şah maskesinin dışında duruyor; erişimi oradan başlıyor, a5, b5 ve c5’ten geçiyor, her piyon alınabilir oluyor ve seviye düşüyor. Şc3’ten sonra (sayaç 1) erişim 1–2. yataylar ve a3–f3; aynı test kilidi ispatlıyor.') + '</figcaption>';
  }


  const sq = (...names) => names.reduce((w, n) => w | (1n << BigInt(FILES.indexOf(n[0]) + 8 * (+n[1] - 1))), 0n);
  function figBuried() {
    const B = [
      ['1n6/2Bp4/p1pPp1k1/PpP1Pp1p/1P3P1P/2K5/8/8 w - - 7 53', sq('b8'), L('Lichess hPiwD75i', 'Lichess hPiwD75i'),
        L('Black’s knight on b8: a6, c6 and d7 hold its own fixed pawns', 'Siyahın b8’deki atı: a6, c6 ve d7’de kendi sabit piyonları')],
      ['7k/8/8/8/p1p5/P1Pp2p1/P2P2Pp/RNB4K w - - 0 1', sq('a1', 'b1', 'c1'), L('Composed: buried at home', 'Bestelenmiş: evinde gömülü'),
        L('White’s rook, knight and bishop never leave a1–c1', 'Beyazın kalesi, atı ve fili a1–c1’den hiç çıkamaz')],
      ['QN1k4/PPpPp1p1/PpP1P1P1/1Pb2K2/8/8/8/8 w - - 0 1', sq('a8', 'b8'), L('Composed: buried in the enemy’s corner', 'Bestelenmiş: düşmanın köşesine gömülü'),
        L('White’s queen and knight on a8 and b8 can never move', 'Beyazın a8 ve b8’deki veziri ve atı hiç oynayamaz')],
    ];
    $('f-buried').innerHTML = '<div class="row r3">' + B.map(([fen, m, t, sub]) => panelHTML(t, sub, pieceArray(fen), { mark: m }, [])).join('') +
      '</div><figcaption>' + L('Left: Lichess hPiwD75i (2022, 1+0), the one game of the 201,060. Middle and right: two of chasolver’s composed test positions. Ringed: the buried pieces. All three positions are dead.',
        'Solda: Lichess hPiwD75i (2022, 1+0), 201.060 oyunun tek örneği. Ortada ve sağda: chasolver’ın bestelenmiş test pozisyonlarından ikisi. Halkalı: gömülü taşlar. Üç pozisyon da ölü.') + '</figcaption>';
  }

  function figHalves() {
    const a = analyse(EXAMPLES[0].fen, 'w'), r = lastRound(a.t.level);
    const ww = r.wFixed | V.sideways(V.north(r.wFixed)), bw = r.bFixed | V.sideways(V.south(r.bFixed));
    $('f-halves').innerHTML = '<div class="row r2">' +
      panelHTML(L('The wall', 'Duvar'), L('fixed pawns and the squares they attack', 'sabit piyonlar ve saldırdıkları kareler'), a.pcs, { w: ww, b: bw }, [['w', ww, ''], ['b', bw, '']]) +
      panelHTML(L('The two halves', 'İki yarı'), L('the king reaches: White’s below, Black’s above', 'şah erişimleri: Beyazınki altta, Siyahınki üstte'), a.pcs, { w: r.wKing, b: r.bKing }, [['w', r.wKing, ''], ['b', r.bKing, '']]) +
      '</div><figcaption>' + L('LockTest’s first position (Lichess yCnBCwGd) at the fixed point. Every square is in a king’s reach or in the wall; none is left between them.',
        'LockTest’in ilk pozisyonu (Lichess yCnBCwGd), sabit noktada. Her kare ya bir şahın erişiminde ya da duvarda; arada hiçbiri kalmıyor.') + '</figcaption>';
  }

  function figBishops() {
    const a = analyse(EXAMPLES[3].fen, 'w'), la = a.t.level;
    const b = analyse(EXAMPLES.find(e => e.id === 'bishop').fen, 'w'), lb = levelOf(b, 'none');
    const touch = V.diagonal(lb.bishops.bBish) & lb.cones.wCone;
    $('f-bishops').innerHTML = '<div class="row r2">' +
      panelHTML(L('A lock: bishop and pawns apart', 'Kilit: fil ve piyonlar ayrı'), L('Black’s bishop on b5, light squares; White’s pawns all on dark', 'Siyahın fili b5’te, açık karelerde; Beyazın piyonları hep koyu karelerde'),
        a.pcs, { w: 0n, b: la.bishops.bBish }, [['b', la.bishops.bBish, '']]) +
      panelHTML(L('No lock: the bishop can take', 'Kilit yok: fil alabilir'), L('the same bishop on b4, dark squares: it reaches a5, c5, e5 and g5 (ringed)', 'aynı fil b4’te, koyu karelerde: a5, c5, e5 ve g5’e ulaşıyor (halkalı)'),
        b.pcs, { w: 0n, b: lb.bishops.bBish, mark: touch }, [['b', lb.bishops.bBish, '']]) +
      '</div><figcaption>' + L('Left: Lichess uxkgEMs4. The bishop roams White’s half, but every white pawn stands on the other colour: it can never take one, and no pawn can ever take it. Right: the bishop moved to a square of the pawns’ colour. Now it can take any of them, the structure can open, and the detector gives no proof.',
        'Solda: Lichess uxkgEMs4. Fil Beyazın yarısında dolaşıyor, ama her beyaz piyon öbür renkte duruyor: hiçbirini alamaz, hiçbir piyon da onu alamaz. Sağda: fil piyonların rengindeki bir kareye taşındı. Artık herhangi birini alabilir, yapı açılabilir ve dedektör ispat vermiyor.') + '</figcaption>';
  }

  function figures() { figBuried(); figShifts(); figCones(); figHalves(); figFrozen(); figBishops(); figNet(); figCheck(); }
  function boot() {
    try { figures(); wireExplorer(); }
    catch (e) { const el = $('fenerr'); el.textContent = L('This page could not draw its boards: ', 'Bu sayfa tahtalarını çizemedi: ') + e.message; el.classList.remove('hide'); throw e; }
    MatelessSite.onLang(() => { figures(); fillExamples(); if (st.a) render(); else if (st.fen) showExplorer(st.fen, st.flagged); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
