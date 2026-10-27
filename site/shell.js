/* The page's frame: which tab shows, and in which language. Runs before the tabs' scripts.
   Address: #arbiter (the default), #lock, #rules, #scan, #chasolver; #<tab>?k=v&… hands values
   to that tab (#chasolver?fen=…&side=white is the arbiter's "Ask chasolver"); #<id> of anything
   inside a tab opens that tab and scrolls there. The language is English unless the reader
   chose Turkish; the choice is kept in this browser. */
(function () {
  'use strict';
  var TABS = ['arbiter', 'lock', 'rules', 'scan', 'chasolver'];
  var TITLE = {
    arbiter: ['Mateless arbiter', 'Mateless hakem'],
    lock: ['Mateless lock detector', 'Mateless kilit dedektörü'],
    rules: ['Mateless: the rules', 'Mateless: kurallar'],
    scan: ['Mateless Lichess scan', 'Mateless Lichess taraması'],
    chasolver: ['chasolver', 'chasolver']
  };
  var $ = function (id) { return document.getElementById(id) };
  var saved = function () { try { return localStorage.getItem('mateless-lang') } catch (x) { return null } };
  var lang = saved() === 'tr' ? 'tr' : 'en', cur = 'arbiter', langFns = [], routeFns = {}, showFns = {};

  function title() { document.title = TITLE[cur][lang === 'tr' ? 1 : 0] }
  function applyLang() {
    document.documentElement.lang = lang;
    $('lang').value = lang;
    var i = lang === 'tr' ? 1 : 0;
    Array.prototype.forEach.call(document.querySelectorAll('[data-l]'), function (el) {
      var p = el.getAttribute('data-l').split('|'); el.textContent = p[i] || p[0] });
    Array.prototype.forEach.call(document.querySelectorAll('[data-lt]'), function (el) {
      var p = el.getAttribute('data-lt').split('|'); el.title = p[i] || p[0] });
    title();
  }
  function show(t) {
    var changed = t !== cur; cur = t;
    TABS.forEach(function (k) { $('tab-' + k).hidden = k !== t });
    Array.prototype.forEach.call(document.querySelectorAll('.tabs a[data-tab]'), function (a) {
      if (a.getAttribute('data-tab') === t) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current') });
    document.body.setAttribute('data-tab', t);
    title();
    (showFns[t] || []).forEach(function (f) { f() });
    return changed;
  }
  function params(s) {
    var p = {};
    s.split('&').forEach(function (kv) { var i = kv.indexOf('='); if (i > 0) try { p[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1)) } catch (x) {} });
    return p;
  }
  function route() {
    var h = (location.hash || '').replace(/^#/, ''), q = h.indexOf('?'), name = q < 0 ? h : h.slice(0, q);
    try { name = decodeURIComponent(name) } catch (x) {}
    if (!name || TABS.indexOf(name) >= 0) {
      var t = name || 'arbiter';
      if (show(t)) window.scrollTo(0, 0);
      if (q >= 0 && routeFns[t]) routeFns[t](params(h.slice(q + 1)));
      return;
    }
    var el = $(name), tab = el && el.closest ? el.closest('.tab') : null;
    if (tab) { show(tab.id.replace(/^tab-/, '')); requestAnimationFrame(function () { el.scrollIntoView({ block: 'start' }) }); return }
    show('arbiter');
  }

  window.MatelessSite = {
    get lang() { return lang },
    active: function () { return cur },
    onLang: function (f) { langFns.push(f) },
    onRoute: function (tab, f) { routeFns[tab] = f },
    onShow: function (tab, f) { (showFns[tab] = showFns[tab] || []).push(f) },
    /* the tabs' scripts have registered: apply the language and the address */
    start: function () {
      $('lang').onchange = function () {
        lang = $('lang').value === 'tr' ? 'tr' : 'en';
        try { localStorage.setItem('mateless-lang', lang) } catch (x) {}
        applyLang(); langFns.forEach(function (f) { f(lang) });
      };
      applyLang();
      window.addEventListener('hashchange', route);
      route();
    }
  };
})();
