'use strict';
/* The files the Download tab packs (site/download/builder.js), for each version of the engine:
     fast   this repository: mateless.js, mateless.d.ts, mateless-wasm.js, mateless.wasm, rust/src
     full   site/second/: the same files, copied from the second-version branch (site/README.md)
   The Rust sources are the library's (src/*.rs, without the command-line tool in src/bin).
   Used by tools/build-site.js (which embeds them in index.html, the engines apart: the page has
   those already) and by test/package_check.js. */
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');

function rustSources(dir) {
  const out = {};
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.rs')).sort()) out['src/' + f] = fs.readFileSync(path.join(dir, f), 'utf8');
  return out;
}

function packageSources() {
  const read = f => fs.readFileSync(path.join(root, f), 'utf8');
  const version = (dir, rust) => ({
    engine: read(path.join(dir, 'mateless.js')),
    dts: read(path.join(dir, 'mateless.d.ts')),
    wasmJs: read(path.join(dir, 'mateless-wasm.js')),
    wasm: new Uint8Array(fs.readFileSync(path.join(root, dir, 'mateless.wasm'))),
    rust: rustSources(path.join(root, rust)),
  });
  return { fast: version('.', 'rust/src'), full: version('site/second', 'site/second/rust/src'), license: read('LICENSE') };
}

module.exports = { packageSources };
