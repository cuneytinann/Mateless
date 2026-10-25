'use strict';
/* Builds mateless.wasm, the Rust port as WebAssembly, for mateless-wasm.js:
     node tools/build-wasm.js
   It compiles rust/wasm (a thin C ABI over the mateless crate) for wasm32-unknown-unknown and copies
   the result beside mateless.js. With the target installed (rustup target add
   wasm32-unknown-unknown) that is a plain cargo build. Without it, when only the standard
   library's source is at hand (rustup component add rust-src, or the library/ folder of the
   compiler's own commit copied to <sysroot>/lib/rustlib/src/rust/library), the standard library is
   built from source with -Zbuild-std; RUSTC_BOOTSTRAP=1 lets a stable compiler do that.
   The built mateless.wasm is kept in the repository, like mateless.js, so the page and the tests
   need no Rust. */
const { spawnSync } = require('child_process');
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), crate = path.join(root, 'rust', 'wasm');
const TARGET = 'wasm32-unknown-unknown';

// Panic messages name source files: their paths are written relative to rust/, so the binary does
// not depend on (or reveal) the folder it was built in.
const REMAP = '--remap-path-prefix=' + path.join(root, 'rust') + '=rust';
const run = (cmd, args, env) => {
  const flags = [process.env.RUSTFLAGS, REMAP].filter(Boolean).join(' ');
  const r = spawnSync(cmd, args, { cwd: crate, stdio: 'inherit', env: { ...process.env, ...env, RUSTFLAGS: flags } });
  if (r.status !== 0) process.exit(r.status || 1);
};
const installed = spawnSync('rustup', ['target', 'list', '--installed'], { encoding: 'utf8' });
if ((installed.stdout || '').split('\n').includes(TARGET)) {
  run('cargo', ['build', '--release', '--target', TARGET]);
} else {
  console.log('the ' + TARGET + ' target is not installed: building the standard library from source (-Zbuild-std)');
  run('cargo', ['build', '--release', '--target', TARGET, '-Zbuild-std=std,panic_abort'], { RUSTC_BOOTSTRAP: '1' });
}
const built = path.join(crate, 'target', TARGET, 'release', 'mateless_wasm.wasm');
fs.copyFileSync(built, path.join(root, 'mateless.wasm'));
console.log('wrote mateless.wasm (' + fs.statSync(built).size + ' B)');
