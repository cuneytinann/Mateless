/* The Download tab: the choices, then the package, made here by MatelessBuilder (builder.js) from
   the engines the page already holds (#mateless-engine, #mateless-engine-2) and the other files
   of each version, packed by tools/build-site.js into #pkg-data (gzip, base64: the type
   declarations, the WebAssembly module and its wrapper, the Rust sources, the licence). */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id) };
  var site = window.MatelessSite, tr = function () { return site.lang === 'tr' };
  var data = null, fullEngine = null;

  function pick(name) { var el = document.querySelector('input[name="' + name + '"]:checked'); return el ? el.value : null }
  function choice() {
    return { lang: pick('dl-lang'), version: pick('dl-version'), rungs: +pick('dl-rungs'), dominoAtEnd: pick('dl-when') === 'end',
             moves: pick('dl-moves'), repetition: pick('dl-rep') };
  }
  function notes() {
    var c = choice(), full = c.version === 'full';
    $('dl-when').disabled = c.rungs !== 3;
    $('dl-rungs-note').textContent = full
      ? (tr() ? '(materyal, ek kurallarıyla kilit, Domino araması, hamlesiz rakip, ikinci kademe)' : '(material, the lock with more rules, the Domino search, the stuck mater, a second tier)')
      : (tr() ? '(materyal, kilit, Domino araması)' : '(material, lock, the Domino search)');
    $('dl-rules-note').textContent = full
      ? (tr() ? 'Tam sürümde otomatik eşikler ispatları da belirler: oyun kendiliğinden bittikten sonra gelebilecek bir mat hiç gelmez. İddia hiçbir ispata girmez: onu yapmak oyuncunun elinde.'
              : 'In the full version the automatic ends shape the proofs too: a mate that could only come after the game has ended by itself never comes. A claim never does: it is the player’s to make.')
      : (tr() ? 'Hızlı sürümde kurallar yalnızca oyunun ne zaman bittiğini belirler; hiçbir ispat onlara dayanmaz.'
              : 'In the fast version the rules only decide when the game ends; no proof uses them.');
    $('dl-files').textContent = '';
  }

  function bytesOf(b64) { var s = atob(b64), out = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i); return out }
  async function load() {
    if (data) return data;
    var gz = bytesOf($('pkg-data').textContent.trim());
    var text = await new Response(new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
    var d = JSON.parse(text);
    ['fast', 'full'].forEach(function (v) { d[v].wasm = bytesOf(d[v].wasm) });
    return (data = d);
  }
  /* an engine's own text, as the repository has it (the page wraps it in newlines) */
  function engineText(id) { return $(id).textContent.trim() + '\n' }
  function engineOf(version) {
    if (version === 'fast') return window.Mateless;
    if (!fullEngine) { var m = { exports: {} }; new Function('module', 'exports', engineText('mateless-engine-2'))(m, m.exports); fullEngine = m.exports }
    return fullEngine;
  }

  async function go() {
    var c = choice(), btn = $('dl-go');
    btn.disabled = true; $('dl-status').textContent = tr() ? 'hazırlanıyor…' : 'making the package…';
    try {
      var d = await load();
      var src = Object.assign({ license: d.license, engine: engineText(c.version === 'fast' ? 'mateless-engine' : 'mateless-engine-2') }, d[c.version]);
      var pkg = await MatelessBuilder.build(c, src, engineOf(c.version));
      var bytes = MatelessBuilder.zip(pkg.files, pkg.dir);
      var url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' })), a = document.createElement('a');
      a.href = url; a.download = pkg.name; document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url) }, 2000);
      $('dl-status').textContent = pkg.name + ' · ' + Math.round(bytes.length / 1024) + ' KB · ' + pkg.files.length + (tr() ? ' dosya' : ' files');
      $('dl-files').innerHTML = '';
      pkg.files.forEach(function (f) {
        var div = document.createElement('div'), size = typeof f[1] === 'string' ? new TextEncoder().encode(f[1]).length : f[1].length;
        div.textContent = pkg.dir + '/' + f[0] + ' · ' + (size < 1024 ? size + ' B' : Math.round(size / 1024) + ' KB');
        $('dl-files').appendChild(div);
      });
    } catch (e) {
      $('dl-status').textContent = (tr() ? 'olmadı: ' : 'failed: ') + e.message;
    } finally { btn.disabled = false }
  }

  document.querySelectorAll('#dl-form input').forEach(function (el) { el.addEventListener('change', notes) });
  $('dl-go').addEventListener('click', go);
  site.onLang(notes);
  notes();
  /* for tests: the package for a choice, without the download */
  window.MatelessDownload = { choice: choice, build: async function (c) {
    var d = await load();
    var src = Object.assign({ license: d.license, engine: engineText(c.version === 'fast' ? 'mateless-engine' : 'mateless-engine-2') }, d[c.version]);
    return MatelessBuilder.build(c, src, engineOf(c.version));
  } };
})();
