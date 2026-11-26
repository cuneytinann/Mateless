'use strict';
/* The Download tab's packages (site/download/builder.js), built and run: for both versions and the
   three languages, under several settings, each package is written out and its self-test run
   (node selftest.js; cargo run --release --example selftest), and the .zip is checked (unzip -t).
   The ES module made from mateless.js must export what mateless.js does.
     node package_check.js [--no-rust]        (the Rust packages need cargo; ~1 minute each) */
const fs = require('fs'), os = require('os'), path = require('path'), { execFileSync } = require('child_process');
const B = require('../site/download/builder.js');
const { packageSources } = require('../tools/package-sources.js');
const S = packageSources();
const ENGINES = { fast: require('../mateless.js'), full: require('../site/second/mateless.js') };
const CHOICES = [
  { rungs: 3, dominoAtEnd: false, moves: 'a', repetition: 'a' },
  { rungs: 3, dominoAtEnd: true, moves: 'b', repetition: 'c' },
  { rungs: 2, dominoAtEnd: false, moves: 'c', repetition: 'b' },
  { rungs: 1, dominoAtEnd: false, moves: 'a', repetition: 'b' },
];
const noRust = process.argv.includes('--no-rust');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'mateless-packages-'));
let problems = 0, built = 0;
const problem = m => { problems++; console.log('PROBLEM', m); };
(async () => {
  for (const version of ['fast', 'full']) {
    const src = Object.assign({ license: S.license }, S[version]);
    for (const lang of ['js', 'wasm', 'rust']) {
      if (lang === 'rust' && noRust) continue;
      for (const [k, ch] of CHOICES.entries()) {
        if (lang === 'rust' && k > 1) continue;   // the Rust packages differ only in settings.rs: two are enough
        const choice = Object.assign({ lang, version }, ch);
        const pkg = await B.build(choice, src, ENGINES[version]);
        const dir = path.join(work, pkg.dir + '-' + k);
        for (const [p, d] of pkg.files) { fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true }); fs.writeFileSync(path.join(dir, p), d); }
        const zipFile = path.join(work, pkg.dir + '-' + k + '.zip');
        fs.writeFileSync(zipFile, B.zip(pkg.files, pkg.dir));
        try { execFileSync('unzip', ['-tq', zipFile], { stdio: 'pipe' }); } catch (e) { problem(pkg.name + ': unzip -t: ' + e.stdout); }
        try {
          const out = lang === 'rust'
            ? execFileSync('cargo', ['run', '--quiet', '--release', '--example', 'selftest'], { cwd: dir, stdio: 'pipe', env: Object.assign({}, process.env, { CARGO_TARGET_DIR: path.join(work, 'target-' + version) }) }).toString()
            : execFileSync(process.execPath, ['selftest.js'], { cwd: dir, stdio: 'pipe' }).toString();
          if (!/checks passed/.test(out)) problem(pkg.dir + '-' + k + ': ' + out.trim());
          else console.log(version.padEnd(5), lang.padEnd(5), JSON.stringify(ch), '→', out.trim());
        } catch (e) { problem(pkg.dir + '-' + k + ': ' + (e.stdout || '') + (e.stderr || '')); }
        if (lang === 'js') {
          const m = await import(path.join(dir, 'mateless.mjs'));
          const want = Object.keys(ENGINES[version]).sort().join(), got = Object.keys(m).filter(x => x !== 'default').sort().join();
          if (want !== got) problem(pkg.dir + ': mateless.mjs exports differ');
          if (m.default.Game !== m.Game) problem(pkg.dir + ': mateless.mjs default export');
        }
        built++;
      }
    }
  }
  console.log(`${built} packages built and run (in ${work}): ${problems} problems`);
  process.exit(problems ? 1 : 0);
})();
