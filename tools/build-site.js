'use strict';
/* Builds index.html, the whole site in one file, from site/ (see site/README.md) and the engines:
     mateless.js             the engine, as <script id="mateless-engine"> (test/build_check.js
                             checks that it is the current one)
     site/chasolver/*.js     chasolver's JavaScript port, run by the chasolver tab and, as text,
                             by the Lichess scan's workers
   Each tab's style sheet is scoped to its tab (#tab-arbiter, #tab-lock, …), so the tabs cannot restyle
   one another; site/site.css and site/shell.css are the look they share.
   Usage: node tools/build-site.js [--check]    (--check: fail if index.html is not what it builds) */
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), S = path.join(root, 'site');
const read = f => fs.readFileSync(path.join(S, f), 'utf8');
const TABS = ['arbiter', 'lock', 'rules', 'scan', 'chasolver'];

/* the end of the block that opens at s[at] ('{') */
function closing(s, at) {
  for (let d = 0, i = at; i < s.length; i++) {
    if (s[i] === '{') d++;
    else if (s[i] === '}' && --d === 0) return i;
  }
  throw new Error('unbalanced braces in a style sheet');
}
/* a selector list split at its top-level commas */
function selectors(list) {
  const out = []; let d = 0, from = 0;
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (c === '(' || c === '[') d++; else if (c === ')' || c === ']') d--;
    else if (c === ',' && d === 0) { out.push(list.slice(from, i)); from = i + 1; }
  }
  out.push(list.slice(from));
  return out.map(x => x.trim()).filter(Boolean);
}
/* every rule of css made to apply inside the element `scope` only; :root, html and body mean the tab */
function scoped(css, scope) {
  css = css.replace(/\/\*[\s\S]*?\*\//g, '');
  let out = '', i = 0;
  for (;;) {
    while (i < css.length && /\s/.test(css[i])) i++;
    if (i >= css.length) return out;
    const brace = css.indexOf('{', i);
    if (css[i] === '@') {
      const semi = css.indexOf(';', i);
      if (semi >= 0 && (brace < 0 || semi < brace)) { out += css.slice(i, semi + 1) + '\n'; i = semi + 1; continue; }
      const head = css.slice(i, brace).trim(), end = closing(css, brace), body = css.slice(brace + 1, end);
      out += /^@(media|supports|container)\b/.test(head) ? head + '{\n' + scoped(body, scope) + '}\n' : head + '{' + body.trim() + '}\n';
      i = end + 1; continue;
    }
    const end = closing(css, brace);
    const sel = selectors(css.slice(i, brace)).map(x => {
      if (x === ':root' || x === 'html' || x === 'body') return scope;
      if (/^(:root|html|body)[\s>+~]/.test(x)) return scope + x.replace(/^(:root|html|body)/, '');
      return scope + ' ' + x;
    });
    out += sel.join(',') + '{' + css.slice(brace + 1, end).trim() + '}\n';
    i = end + 1;
  }
}
const script = (s, id, type) => {
  if (/<\/script/i.test(s)) throw new Error((id || 'a script') + ' contains "</script"');
  return '<script' + (id ? ' id="' + id + '"' : '') + (type ? ' type="' + type + '"' : '') + '>\n' + s.trim() + '\n</script>\n';
};

function build() {
  const engine = fs.readFileSync(path.join(root, 'mateless.js'), 'utf8').trim();
  let body = read('shell.html');
  for (const t of TABS) body = body.replace('%%' + t.toUpperCase() + '%%', () => read(t + '/' + t + '.html').trim());
  if (/%%[A-Z]+%%/.test(body)) throw new Error('a tab is missing from site/shell.html');
  const css = TABS.map(t => '/* ' + t + ' */\n' + scoped(read(t + '/' + t + '.css'), '#tab-' + t)).join('');
  return '<!DOCTYPE html>\n<html lang="en">\n<!--\n' + read('head-comment.txt').trim() + '\n\n' +
    '—————————————————————————————————————————————————————————————————————————————————————\n\n' +
    read('chasolver/LICENSE.txt').trim() + '\n\n' +
    '—————————————————————————————————————————————————————————————————————————————————————\n\n' +
    read('scan/LICENSE-fzstd.txt').trim() + '\n-->\n' +
    read('head.html').trim() + '\n' +
    '<style id="site">\n' + read('site.css').trim() + '\n</style>\n' +
    '<style id="shell">\n' + read('shell.css').trim() + '\n</style>\n' +
    '<style id="tabs">\n' + css.trim() + '\n</style>\n' +
    '<body>\n' + body.trim() + '\n\n' +
    '<script id="mateless-engine">\n' + engine + '\n</script>\n' +
    script(read('chasolver/engine.js'), 'cha-engine') +
    script(read('chasolver/glue.js'), 'cha-glue') +
    script(read('scan/fzstd.js'), 'scan-fzstd', 'text/plain') +
    script(read('scan/scan-core.js'), 'scan-core', 'text/plain') +
    script(read('scan/worker-glue.js'), 'scan-worker', 'text/plain') +
    script(read('shell.js')) +
    script(read('arbiter/arbiter.js')) +
    script(read('lock/lockviz.js')) +
    script(read('lock/lock.js')) +
    script(read('scan/scan.js')) +
    script(read('chasolver/chasolver.js')) +
    script('MatelessSite.start();') +
    '</body>\n</html>\n';
}

const out = build(), target = path.join(root, 'index.html');
if (process.argv.includes('--check')) {
  const now = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
  if (now !== out) { console.log('index.html is not what site/ builds: run node tools/build-site.js'); process.exit(1); }
  console.log('index.html is up to date');
} else {
  fs.writeFileSync(target, out);
  console.log('index.html', Buffer.byteLength(out), 'B');
}
