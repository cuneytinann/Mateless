'use strict';
/* Builds the single-file engine from the ES modules in src/, in two forms with the same code: the
   layers are joined in the order of their imports, in one scope, with their import lines and
   `export` keywords taken out.
     mateless.js    a classic script and CommonJS module: the code runs inside one function, and
                    src/index.js's export list becomes the object it returns (globalThis.Mateless
                    in a browser, module.exports in Node);
     mateless.mjs   an ES module: the same function, run once; its object is the default export,
                    and each of its members a named export.
   Both have no dependencies, and their code is the code of the modules, line for line. Both keep it
   inside a function: V8 runs it some 10-30% slower from src/ directly, and some 10% slower at the
   top level of a single module (measured, docs/DESIGN.md).
     node tools/build.js            writes mateless.js and mateless.mjs
     node tools/build.js --check    fails if either is not what the sources build
   After a build, node tools/embed-engine.js puts the engine into index.html. */
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), src = path.join(root, 'src');
const TARGETS = { umd: path.join(root, 'mateless.js'), esm: path.join(root, 'mateless.mjs') };
const LAYERS = ['board.js', 'material.js', 'lock.js', 'domino.js', 'ladder.js', 'game.js'];

const IMPORT = /^import \{[^}]*\} from '\.\/[a-z]+\.js';\n/gm;
const read = f => fs.readFileSync(path.join(src, f), 'utf8');

/* The names a top-level declaration introduces: one for a function or class; for const and let,
   every name declared before the statement's closing semicolon, at bracket depth 0. */
function declaredNames(text, m) {
  if (m[1] === 'function' || m[1] === 'class') return [m[2]];
  const names = [m[2]];
  let depth = 0, quote = '';
  for (let i = m.index + m[0].length; i < text.length; i++) {
    const c = text[i];
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = ''; continue; }
    if (c === "'" || c === '"' || c === '`') quote = c;
    else if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (c === ';' && depth === 0) break;
    else if (c === ',' && depth === 0) { const n = text.slice(i + 1).match(/^\s*([A-Za-z_$][\w$]*)\s*=/); if (n) names.push(n[1]); }
  }
  return names;
}

function build() {
  const index = read('index.js');
  const header = index.slice(0, index.indexOf('*/') + 2);
  const list = index.match(/^export \{\n([\s\S]*?)\n\};$/m);
  const internal = index.match(/^export const _internal = (Object\.freeze\(\{[\s\S]*?\}\));$/m);
  if (!header.startsWith('/*!') || !list || !internal) throw new Error('src/index.js: header, export list or _internal not found');

  const declared = new Map();   // top-level name -> layer, to refuse two layers declaring one name
  const parts = LAYERS.map(f => {
    let text = read(f).replace(IMPORT, '');
    if (/^import /m.test(text)) throw new Error(f + ': an import the build cannot read (one per line, named, from ./x.js)');
    text = text.replace(/^export (?=(const|let|function|class) )/gm, '');
    if (/^export /m.test(text)) throw new Error(f + ': an export the build cannot read (export a declaration)');
    for (const m of text.matchAll(/^(const|let|function|class) ([A-Za-z_$][\w$]*)/gm)) {
      for (const n of declaredNames(text, m)) {
        if (declared.has(n)) throw new Error(n + ' is declared in ' + declared.get(n) + ' and in ' + f);
        declared.set(n, f);
      }
    }
    return text.replace(/\n{3,}/g, '\n\n').trim();
  });

  // The internals' list is aligned under "_internal: Object.freeze({".
  const pad = ' '.repeat('  _internal: Object.freeze({ '.length);
  const internals = internal[1].split('\n').map((l, i) => (i ? pad + l.trimStart() : l)).join('\n');

  const notice = file => [
    '// ' + file + ' is built from src/ by tools/build.js: edit the sources there, then run',
    '// node tools/build.js (and node tools/embed-engine.js for the page).',
  ];
  const umd = [
    ...notice('mateless.js'),
    header,
    '(function (root, factory) {',
    "  'use strict';",
    '  const api = factory();',
    "  if (typeof module === 'object' && module.exports) module.exports = api;",
    '  else root.Mateless = api;',
    "})(typeof globalThis !== 'undefined' ? globalThis : this, function () {",
    "'use strict';",
    '',
    parts.join('\n\n\n'),
    '',
    '',
    '// ═══ The public API (src/index.js) ═══════════════════════════════════════════════════════════',
    '',
    'return Object.freeze({',
    list[1],
    '  // internals exposed for tests',
    '  _internal: ' + internals + ',',
    '});',
    '});',
    '',
  ].join('\n');
  // The same function scope as mateless.js: V8 runs the code some 10% slower at the top level of a
  // module than inside a function (measured), so the module only exports what it returns.
  const body = umd.slice(umd.indexOf("'use strict';\n\n") + "'use strict';\n\n".length, umd.lastIndexOf('});\n') + 3);
  const esm = [
    ...notice('mateless.mjs'),
    header,
    'const Mateless = (function () {',
    "'use strict';",
    '',
    body.slice(0, body.length - 3) + '})();',
    '',
    'export const {',
    list[1],
    '  _internal,',
    '} = Mateless;',
    '/** The same exports as one frozen object, as mateless.js gives it. */',
    'export default Mateless;',
    '',
  ].join('\n');
  return { umd, esm };
}

const built = build();
if (process.argv.includes('--check')) {
  let stale = 0;
  for (const [form, file] of Object.entries(TARGETS)) {
    const now = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    if (now !== built[form]) { console.log(path.basename(file) + ' is not the build of src/: run node tools/build.js'); stale++; }
  }
  if (stale) process.exit(1);
  console.log('mateless.js and mateless.mjs are the build of src/');
} else {
  for (const [form, file] of Object.entries(TARGETS)) fs.writeFileSync(file, built[form]);
  console.log('built mateless.js (' + Buffer.byteLength(built.umd) + ' B) and mateless.mjs (' + Buffer.byteLength(built.esm) +
              ' B) from', LAYERS.length, 'layers and src/index.js');
}
