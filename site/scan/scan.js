/* The Lichess scan tab: a month's database file split into its zstd frames, each frame decoded
   and scanned in a worker (scan-core.js through worker-glue.js), the rows gathered here. */
(function () {
  'use strict';
  const $ = id => document.getElementById('scan-' + id), ROOT = document.getElementById('tab-scan');
  const tr = () => MatelessSite.lang === 'tr', L = (en, t) => tr() ? t : en;
  const HEAD = {
    mw: ['gameId', 'link', 'date', 'speed', 'timeControl', 'result', 'end', 'class', 'dead_position', 'lichess_rule_today', 'with_a_lock', 'fen'],
    ml: ['gameId', 'link_to_dead_ply', 'date', 'speed', 'timeControl', 'end', 'dead_at_ply', 'plies', 'plies_after', 'seconds_after', 'repetitions', 'fen_end'],
    cw: ['gameId', 'link', 'date', 'speed', 'timeControl', 'result', 'end', 'mateless_agrees', 'fen'],
    cl: ['gameId', 'link_to_dead_ply', 'date', 'speed', 'timeControl', 'end', 'dead_at_ply', 'plies', 'plies_after', 'seconds_after', 'repetitions', 'mateless_dead_at_ply', 'fen_end'],
  };
  const NAME = { mw: 'mateless_wrong_results', ml: 'mateless_late_ends', cw: 'chasolver_wrong_results', cl: 'chasolver_late_ends' };
  const END_TR = { timeout: 'süre', resignation: 'terk', abandoned: 'bırakma', other: 'diğer', threefold: 'üçlü tekrar', agreement: 'anlaşma',
                   stalemate: 'pat', 'insufficient material': 'yetersiz materyal', '50-move': '50 hamle', '75-move': '75 hamle', fivefold: 'beşli tekrar' };

  const hc = navigator.hardwareConcurrency || 4;
  for (let i = 1; i <= hc; i++) { const o = document.createElement('option'); o.value = i; o.textContent = i; $('workers').appendChild(o); }
  $('workers').value = String(Math.max(1, hc - 2));

  let file = null, run = null;
  const pick = f => {
    if (!f) return;
    file = f;
    $('fileName').textContent = f.name + ' · ' + (f.size / 1e9).toFixed(2) + ' GB';
    $('start').disabled = false;
    say(() => L('Ready.', 'Hazır.'));
    $('error').textContent = '';
  };
  $('drop').addEventListener('click', () => $('fileInput').click());
  $('drop').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('fileInput').click(); } });
  $('fileInput').addEventListener('change', e => pick(e.target.files[0]));
  ['dragenter', 'dragover'].forEach(t => $('drop').addEventListener(t, e => { e.preventDefault(); $('drop').classList.add('over'); }));
  ['dragleave', 'drop'].forEach(t => $('drop').addEventListener(t, e => { e.preventDefault(); $('drop').classList.remove('over'); }));
  $('drop').addEventListener('drop', e => { e.stopPropagation(); pick(e.dataTransfer.files[0]); });
  /* a file dropped anywhere on the page counts while this tab shows */
  window.addEventListener('dragover', e => { if (MatelessSite.active() === 'scan') e.preventDefault(); });
  window.addEventListener('drop', e => { if (MatelessSite.active() !== 'scan') return; e.preventDefault(); pick(e.dataTransfer.files[0]); });

  const fmtN = n => n.toLocaleString(tr() ? 'tr-TR' : 'en-US');
  const fmtT = s => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
    return (h ? h + L(' h ', ' sa ') : '') + (h || m ? m + L(' min ', ' dk ') : '') + x + L(' s', ' sn'); };
  const endName = x => tr() ? END_TR[x] || x : x;
  /* the status line, written again when the language changes */
  let status = () => L('Choose a file.', 'Bir dosya seç.');
  const say = f => { status = f; $('status').textContent = f(); };
  const month = () => ((file && file.name.match(/(\d{4}-\d{2})/)) || [, 'scan'])[1];

  /** The frames of a Lichess .pgn.zst (pzstd: each zstd frame after a skippable frame with its
      size), or chunks of a plain .pgn. */
  async function frames(f) {
    const head = new DataView(await f.slice(0, 12).arrayBuffer());
    const magic = head.getUint32(0, true);
    if ((magic & 0xFFFFFFF0) >>> 0 === 0x184D2A50) {
      const list = [];
      let at = 0, t = performance.now();
      while (at < f.size) {
        const h = new DataView(await f.slice(at, at + 12).arrayBuffer());
        if (((h.getUint32(0, true) & 0xFFFFFFF0) >>> 0) !== 0x184D2A50 || h.getUint32(4, true) !== 4) throw new Error(L('No frame header where one was expected, at byte ' + at + ' of the file.', 'Dosyanın ' + at + '. baytında beklenen parça başlığı yok.'));
        const size = 12 + h.getUint32(8, true);
        list.push([at, size]); at += size;
        if (performance.now() - t > 250) { t = performance.now(); const n = list.length, p = (100 * at / f.size).toFixed(0); say(() => L('Reading the frames: ', 'Parçalar okunuyor: ') + fmtN(n) + ' (' + p + '%)'); }
      }
      return { list, compressed: true, skip: 12 };
    }
    if (magic === 0xFD2FB528) throw new Error(L('This .zst is not in the Lichess database’s format (pzstd). Use the file as downloaded from Lichess.', 'Bu .zst, Lichess veritabanının biçiminde (pzstd) değil. Lichess’ten indirilen dosyayı olduğu gibi kullan.'));
    const CH = 32 << 20, list = [];
    for (let at = 0; at < f.size; at += CH) list.push([at, Math.min(CH, f.size - at)]);
    return { list, compressed: false, skip: 0 };
  }

  /* the worker runs the same engines as the page: fzstd, mateless.js, chasolver, the scan */
  const SRC = ['scan-fzstd', 'mateless-engine', 'cha-engine', 'scan-core', 'scan-worker'].map(id => document.getElementById(id).textContent).join('\n;\n');
  const WORKER_URL = URL.createObjectURL(new Blob([SRC], { type: 'text/javascript' }));

  function addStats(a, b) {
    for (const k of Object.keys(b)) {
      const v = b[k];
      if (typeof v === 'number') a[k] = (a[k] || 0) + v;
      else if (Array.isArray(v)) { a[k] = (a[k] || []).concat(v).slice(0, 30); }
      else if (v && typeof v === 'object') { a[k] = a[k] || {}; for (const j of Object.keys(v)) a[k][j] = (a[k][j] || 0) + v[j]; }
    }
  }
  const concat = (x, y) => { const z = new Uint8Array(x.length + y.length); z.set(x, 0); z.set(y, x.length); return z; };

  async function start() {
    if (!file) return;
    $('error').textContent = '';
    $('start').disabled = true; $('stop').disabled = false; $('workers').disabled = true; $('useCha').disabled = true;
    ROOT.querySelectorAll('.card button, #scan-summary').forEach(b => b.disabled = true);
    const R = run = { rows: { mw: [], ml: [], cw: [], cl: [] }, stats: {}, t0: performance.now(), done: false, stopped: false, workers: [],
                      opts: { chasolver: $('useCha').checked }, file, bytesDone: 0, framesDone: 0 };
    let wake = null;
    const lock = async () => { try { wake = await navigator.wakeLock.request('screen'); } catch (e) { /* not offered */ } };
    lock();
    document.addEventListener('visibilitychange', () => { if (!R.done && document.visibilityState === 'visible') lock(); });
    let F;
    try { F = await frames(file); } catch (e) { $('error').textContent = e.message; finish(R, true); return; }
    R.F = F;
    const N = F.list.length, total = F.list.reduce((s, x) => s + x[1], 0);
    const heads = new Map(), tails = new Map(), texts = [];
    let next = 0, inflight = 0, jobId = 0;
    const tryStitch = k => {
      if (tails.has(k) && heads.has(k + 1)) {
        const t = tails.get(k), h = heads.get(k + 1);
        tails.delete(k); heads.delete(k + 1);
        if (t.length + h.length) texts.push(concat(t, h));
      }
    };
    const dispatch = w => {
      if (R.stopped) return;
      let job = null;
      if (texts.length) { const b = texts.shift(); job = { kind: 'text', bytes: b }; }
      else if (next < N) { const [off, size] = F.list[next]; job = { kind: 'frame', k: next, blob: file.slice(off, off + size), compressed: F.compressed, skip: F.skip }; next++; }
      if (!job) { w.busy = false; return; }
      job.id = ++jobId; job.opts = R.opts; w.busy = true; inflight++;
      if (job.kind === 'text') w.postMessage(job, [job.bytes.buffer]); else w.postMessage(job);
    };
    const idle = () => R.workers.forEach(w => { if (!w.busy) dispatch(w); });
    const n = +$('workers').value;
    for (let i = 0; i < n; i++) {
      const w = new Worker(WORKER_URL);
      w.busy = false;
      w.onmessage = e => {
        const m = e.data;
        inflight--;
        if (m.error) { $('error').textContent = L('Error: ', 'Hata: ') + m.error; stop(); return; }
        for (const k of ['mw', 'ml', 'cw', 'cl']) for (const r of m.out[k]) R.rows[k].push(r);
        addStats(R.stats, m.st);
        if (m.kind === 'frame') {
          R.framesDone++; R.bytesDone += F.list[m.k][1];
          heads.set(m.k, m.head); tails.set(m.k, m.tail);
          if (m.k === 0) { if (m.head.length) texts.push(m.head); heads.delete(0); }
          if (m.k === N - 1) { if (m.tail.length) texts.push(m.tail); tails.delete(N - 1); }
          tryStitch(m.k - 1); tryStitch(m.k);
        }
        w.busy = false;
        dispatch(w); idle();
        show(R, N, total);
        if (next >= N && !texts.length && inflight === 0 && R.framesDone === N) finish(R, false);
      };
      w.onerror = e => { $('error').textContent = L('Error: ', 'Hata: ') + (e.message || e); stop(); };
      R.workers.push(w);
    }
    idle();
    R.timer = setInterval(() => show(R, N, total), 1000);
    R.release = () => { try { wake && wake.release(); } catch (e) { /* gone */ } };
  }

  function show(R, N, total) {
    const s = (performance.now() - R.t0) / 1000, frac = total ? R.bytesDone / total : 0;
    $('bar').style.width = (100 * frac).toFixed(1) + '%';
    const g = R.stats.games || 0;
    const eta = frac > 0.002 ? s / frac - s : 0;
    say(() => (R.done ? L('Done · ', 'Bitti · ') : '') + fmtN(R.framesDone) + ' / ' + fmtN(N) + L(' frames · ', ' parça · ') + fmtN(g) + L(' games · ', ' oyun · ') +
      fmtN(Math.round(g / Math.max(s, 1e-3))) + L(' games/s · elapsed ', ' oyun/sn · geçen ') + fmtT(s) + (R.done || !eta ? '' : L(' · left ~', ' · kalan ~') + fmtT(eta)));
    for (const k of ['mw', 'ml', 'cw', 'cl']) {
      $('n-' + k).textContent = fmtN(R.rows[k].length);
      const by = R.stats[k + 'By'] || {};
      $('by-' + k).textContent = Object.keys(by).sort((a, b) => by[b] - by[a]).map(x => endName(x) + ' ' + fmtN(by[x])).join(' · ');
    }
    if (!R.opts.chasolver) { $('by-cw').textContent = $('by-cl').textContent = L('off', 'kapalı'); }
  }

  function finish(R, failed) {
    if (R.done) return;
    R.done = true;
    clearInterval(R.timer);
    R.workers.forEach(w => w.terminate());
    R.release && R.release();
    $('start').disabled = !file; $('stop').disabled = true; $('workers').disabled = false; $('useCha').disabled = false;
    if (!failed) {
      ROOT.querySelectorAll('.card button, #scan-summary').forEach(b => b.disabled = false);
      $('partial').textContent = R.stopped ? L('The scan was stopped: the files hold what was found until then.', 'Tarama durduruldu: dosyalar o ana kadar bulunanları içerir.') : '';
      if (R.F) show(R, R.F.list.length, R.F.list.reduce((s, x) => s + x[1], 0));
    }
  }
  function stop() { if (!run || run.done) return; run.stopped = true; finish(run, false); }

  const cell = v => { const s = v === undefined || v === null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  function download(name, text) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  }
  ROOT.querySelectorAll('.card button').forEach(b => b.addEventListener('click', () => {
    if (!run) return;
    const k = b.dataset.k;
    download(NAME[k] + '-' + month() + '.csv', [HEAD[k]].concat(run.rows[k]).map(r => r.map(cell).join(',')).join('\n') + '\n');
  }));
  $('summary').addEventListener('click', () => {
    if (!run) return;
    const st = run.stats, s = (performance.now() - run.t0) / 1000, O = [];
    O.push(L('Mateless · Lichess scan · ', 'Mateless · Lichess taraması · ') + (run.file ? run.file.name : ''));
    O.push(L('time ', 'süre ') + fmtT(s) + (run.stopped ? L(' (stopped)', ' (durduruldu)') : '') + L(', threads ', ', iş parçacığı ') + run.workers.length +
      ', chasolver ' + (run.opts.chasolver ? L('on', 'açık') : L('off', 'kapalı')));
    O.push(L('games ', 'oyun ') + (st.games || 0) + ', ply ' + (st.plies || 0) + L(', mates (skipped) ', ', mat (atlandı) ') + (st.mates || 0) +
      L(', unreadable ', ', okunamayan ') + (st.errors || 0) + L(', variants (skipped) ', ', varyant (atlandı) ') + (st.skipped || 0));
    if (st.errorIds && st.errorIds.length) O.push(L('unreadable examples: ', 'okunamayan örnekler: ') + st.errorIds.join(' '));
    O.push(L('chasolver full-search calls ', 'chasolver tam arama çağrısı ') + (st.chaFull || 0) + L(', FEN errors ', ', FEN hatası ') + (st.chaErrors || 0));
    O.push(L('wrong results of games ended for a rules violation (mostly cheating), left out of the lists: Mateless ',
             'kural ihlaliyle (çoğunlukla hile) biten, listelere alınmayan yanlış sonuçlar: Mateless ') + (st.bannedMw || 0) + ', chasolver ' + (st.bannedCw || 0));
    for (const k of ['mw', 'ml', 'cw', 'cl']) {
      O.push(''); O.push(NAME[k] + ': ' + run.rows[k].length);
      const by = st[k + 'By'] || {};
      Object.keys(by).sort((a, b) => by[b] - by[a]).forEach(x => O.push('  ' + x + '\t' + by[x]));
    }
    O.push(''); O.push(L('termination and result (every game):', 'bitiş ve sonuç (bütün oyunlar):'));
    const bt = st.byTerm || {};
    Object.keys(bt).sort((a, b) => bt[b] - bt[a]).forEach(x => O.push('  ' + x + '\t' + bt[x]));
    download('summary-' + month() + '.txt', O.join('\n') + '\n');
  });
  $('start').addEventListener('click', start);
  $('stop').addEventListener('click', stop);
  say(status);
  MatelessSite.onLang(() => { say(status); if (run && run.F) show(run, run.F.list.length, run.F.list.reduce((s, x) => s + x[1], 0)); });
})();
