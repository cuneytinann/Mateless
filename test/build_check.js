'use strict';
/* The single-file engine against its sources:
     1. mateless.js and mateless.mjs are what tools/build.js builds from src/ now;
     2. index.html embeds exactly mateless.js, and index.html and chasolver.html share one look
        (the same <style id="site">);
     3. src/index.js (the ES modules), mateless.mjs (its named and its default exports) and
        mateless.js export the same names, the same constants and, for every function and class,
        the same source text;
     4. all of them give the same answers on chasolver's positions (CHASOLVER, every 16th) and on
        games played from them.
   Usage: node build_check.js */
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const root = path.join(__dirname, '..');
let problems = 0;
const problem = m => { problems++; if (problems <= 20) console.log('PROBLEM', m); };

(async () => {
  // 1. the build is up to date
  const b = spawnSync(process.execPath, [path.join(root, 'tools', 'build.js'), '--check'], { encoding: 'utf8' });
  if (b.status !== 0) problem((b.stdout + b.stderr).trim());

  // 2. the page runs the same engine, and the two pages share their look
  const page = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const m = page.match(/<script id="mateless-engine">\n([\s\S]*?)\n<\/script>/);
  if (!m) problem('index.html has no <script id="mateless-engine">');
  else if (m[1] !== fs.readFileSync(path.join(root, 'mateless.js'), 'utf8').trim()) problem('index.html embeds another engine: run node tools/embed-engine.js');
  const site = f => (fs.readFileSync(path.join(root, f), 'utf8').match(/<style id="site">[\s\S]*?<\/style>/) || [''])[0];
  if (!site('index.html') || site('index.html') !== site('chasolver.html')) problem('index.html and chasolver.html carry different <style id="site"> blocks');

  // 3. the same exports
  const A = require(path.join(root, 'mateless.js'));
  const mjs = await import(path.join(root, 'mateless.mjs'));
  const others = [['src/index.js', await import(path.join(root, 'src', 'index.js'))],
                  ['mateless.mjs', mjs], ['mateless.mjs default', mjs.default]];
  const same = (a, b, name) => {
    if (typeof a !== typeof b) return problem(name + ': ' + typeof a + ' against ' + typeof b);
    if (typeof a === 'function') { if (a.toString() !== b.toString()) problem(name + ': another source text'); return; }
    if (a && typeof a === 'object') {
      if (ArrayBuffer.isView(a) || Array.isArray(a)) { if (JSON.stringify(Array.from(a)) !== JSON.stringify(Array.from(b))) problem(name + ': another value'); return; }
      const ka = Object.keys(a), kb = Object.keys(b);
      if (ka.join() !== kb.join()) return problem(name + ': keys ' + ka.join() + ' against ' + kb.join());
      for (const k of ka) same(a[k], b[k], name + '.' + k);
      return;
    }
    if (!Object.is(a, b)) problem(name + ': ' + a + ' against ' + b);
  };
  const ka = Object.keys(A).sort();
  for (const [where, B] of others) {
    const kb = Object.keys(B).filter(k => k !== 'default').sort();
    if (ka.join() !== kb.join()) problem(where + ': exports differ: ' + ka.filter(k => !kb.includes(k)).concat(kb.filter(k => !ka.includes(k))).join(', '));
    for (const k of ka) if (k in B) {
      if (k === '_internal') { for (const j of Object.keys(A._internal)) if (j !== 'SHARED_CONTEXT') same(A._internal[j], B._internal[j], where + ' _internal.' + j); continue; }
      same(A[k], B[k], where + ' ' + k);
    }
  }

  // 4. the same answers
  const fens = [];
  for (const f of ['positions.txt', 'lichess.txt'])
    for (const l of fs.readFileSync((process.env.CHASOLVER || require('path').join(__dirname, '../../chasolver/tests')) + '/' + f, 'utf8').split('\n'))
      if (/^(WB|W-|-B|--) /.test(l)) fens.push(l.slice(3).trim());
  let positions = 0, plies = 0;
  const answer = (E, fen) => {
    const p = E.fromFen(fen).position;
    const g = new E.Game(p), out = [JSON.stringify(E.proveBoth(p)), E.isDeadPosition(p), E.gameStatus(p)];
    for (let k = 0, st = g.status(); k < 40 && !st; k++) {   // a game from it, a move chosen by a fixed rule
      const moves = g.legalMoves(), mv = moves[(k * 7 + fen.length) % moves.length];
      st = g.play(mv.from, mv.to, E.QUEEN);
      out.push([st, g.repetitions, g.whiteDownAt, g.blackDownAt, g.flagVerdict(E.WHITE), g.flagVerdict(E.BLACK, { resigned: true })].join(','));
    }
    return out;
  };
  for (let i = 0; i < fens.length; i += 16) {
    if (A.fromFen(fens[i]).error) continue;
    const a = answer(A, fens[i]).join('|');
    positions++; plies += a.split('|').length - 3;
    for (const [where, B] of others.slice(0, 2)) if (answer(B, fens[i]).join('|') !== a) problem(where + ': another answer for ' + fens[i]);
  }
  console.log(`build up to date: ${b.status === 0}; ${ka.length} exports compared in ${others.length} forms; ${positions} positions, ${plies} plies played in 3 forms: ${problems} problems`);
  process.exit(problems ? 1 : 0);
})();
