'use strict';
/* Opens index.html, the whole site in one page, in headless Chromium and exercises every tab;
   fails on any console error, on a lock explorer that disagrees with mateless.js, or on a tab
   that does not answer:
     arbiter    one position, a labelled batch, the detail dialog, a FEN the engine puts right
                (the positions box and the board editor, when left) and one it refuses, the PGN
                replay, the engine source
     chasolver  a position handed over by the arbiter's "Ask chasolver" link (#chasolver?fen=…)
     lock       every example, both sides, every level and pass of the explorer, in both languages;
                the download of the detector alone (mateless-lock.zip) and its section
     rules      an anchor link inside the tab
     scan       a small Lichess-style PGN through the workers: a timeout in a lock and a draw
                played on after one
     language   English by default; every tab in Turkish too
   Google Fonts is answered with an empty style sheet, so the check needs no network.
     node page_check.js [dir]        (default: the repository root) */
const { chromium } = require('playwright');
const fs = require('fs'), os = require('os'), path = require('path');
const dir = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const fail = [];
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.goto('file://' + path.join(dir, 'index.html'));
  console.log('default language:', await page.inputValue('#lang'), '| tab:', await page.evaluate(() => MatelessSite.active()));

  // 1. the arbiter: the example
  await page.click('#example');
  await page.click('#go');
  await page.waitForSelector('#solo .score', { timeout: 60000 });
  console.log('single:', await page.textContent('#solo .score'), '|', await page.textContent('#solo .vword'), '|', await page.textContent('#solo .chip'));
  console.log('steps:', (await page.$$eval('#solo .steps li', ls => ls.map(l => l.querySelector('b').textContent + '=' + l.querySelector('.stag').textContent))).join(', '));
  // a labelled batch with an invalid line, a forced capture into a lock and a dead position by the Domino effect
  await page.fill('#fen', [
    '-- 3k4/8/8/1p1p1p1p/1P1P1P1P/8/3q4/3K4 w - - 0 1',
    'WB rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    '-- 8/8/4k3/8/8/4K3/8/8 w - - 0 1',
    'W- 8/8/8/8/8/2k5/1q6/K7 b - - 0 1',
    'bogus line',
    '4k3/8/8/8/8/8/8/R3K2R w KQ - 0 1',
    '8/8/8/8/6qK/8/5k2/8 w - - 2 63',
  ].join('\n'));
  await page.fill('#ply', '60'); await page.fill('#bud', '20000');
  await page.click('#go');
  await page.waitForSelector('#out:not(.hide) #perfile tr', { timeout: 60000 });
  console.log('status:', await page.textContent('#stat'));
  console.log('reasons:', (await page.$$eval('#outcome .ok1', ks => ks.map(k => k.querySelector('.ol').textContent + ' ' + k.querySelector('b').textContent))).join(', '));
  await page.selectOption('#fshow', '');
  await page.click('#grid .card');
  await page.waitForSelector('#lb:not(.hide) .score');
  console.log('dialog:', await page.textContent('#lbpos'), await page.textContent('#lbbody .vword'));
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Escape');
  // the FEN layer (fromFen): a FEN the engine puts right is written as it reads it once the box is
  // left; a position no game reaches is refused in words, in the positions and on the board
  const putRight = ['k7/8/8/8/8/8/8/K7 w KQ e3 9 1', 'W- 4k3/8/8/8/8/8/8/R3K2R w KQkq - 0 1', '5R2/R4k2/8/8/8/8/PPPPPPPP/7K b - - 0 1'];
  await page.fill('#fen', putRight.join('\n'));
  await page.focus('#fen'); await page.focus('#ply');
  const box = await page.inputValue('#fen'), boxWant = ['k7/8/8/8/8/8/8/K7 w - - 9 6', 'W- 4k3/8/8/8/8/8/8/R3K2R w KQ - 0 1', putRight[2]].join('\n');
  if (box !== boxWant) fail.push('the positions box was not put right when left: ' + JSON.stringify(box));
  await page.click('#go');
  await page.waitForSelector('#out:not(.hide) #perfile tr', { timeout: 60000 });
  const refused = await page.textContent('#out');
  if (!/impossible check/.test(refused)) fail.push('the impossible double check is not counted as an impossible check');
  for (const [fen, want] of [['k7/8/8/4pP2/8/8/8/K7 w - e6 3 2', 'k7/8/8/4pP2/8/8/8/K7 w - - 3 3'],
                             ['k7/1P6/8/8/8/8/8/K7 b - - 9 2', 'k7/1P6/8/8/8/8/8/K7 b - - 0 2']]) {
    await page.fill('#edFen', fen); await page.focus('#edClock');
    const ed = await page.inputValue('#edFen');
    if (ed !== want) fail.push('the board editor read ' + fen + ' as ' + ed + ', not ' + want);
  }
  await page.fill('#edFen', putRight[2]);
  const edBad = await page.textContent('#edBad');
  if (!/double check/.test(edBad)) fail.push('the board editor does not refuse the impossible double check in words: ' + edBad);
  console.log('fen layer: positions box and board editor put right, refusals in words:', box === boxWant && /double check/.test(edBad));
  await page.click('#edStart');
  // games
  await page.fill('#pgntext', [
    '[Event "fool"]\n[Result "0-1"]\n\n1. f3 e5 2. g4 Qh4# 0-1\n',
    '[Event "dead"]\n[Result "1-0"]\n[FEN "8/8/4k3/8/8/2K5/3Q4/8 w - - 0 1"]\n\n1. Qd5+ Kxd5 2. Kd3 Kc5 1-0\n',
  ].join('\n'));
  await page.click('#pgngo');
  await page.waitForSelector('#pgnout:not(.hide) #pgntab tr[data-pk]', { timeout: 60000 });
  console.log('games:', await page.textContent('#pstat'));
  await page.click('#fold-engine summary');
  await page.waitForFunction(() => document.getElementById('srcbox').textContent.length > 0, null, { timeout: 10000 });
  console.log('engine source chars:', (await page.textContent('#srcbox')).length);

  // 2. chasolver, asked from the arbiter's link
  await page.click('#example'); await page.click('#go'); await page.waitForSelector('#solo .score');
  const href = await page.getAttribute('#solo a[href^="#chasolver"]', 'href');
  if (!href) fail.push('no "Ask chasolver" link');
  else {
    await page.click('#solo a[href^="#chasolver"]');
    await page.waitForSelector('#cha-out .verdict:not(.v-pending)', { timeout: 120000 });
    console.log('chasolver:', await page.evaluate(() => MatelessSite.active()), '|', await page.textContent('#cha-out .verdict'), '|',
      (await page.textContent('#cha-out .vtext')).slice(0, 90));
  }

  // 3. the lock detector: every example, both sides, every level and pass
  const explore = async lang => {
    await page.click('.tabs a[data-tab="lock"]');
    const opts = await page.$$eval('#exsel option', o => o.map(x => x.value));
    let n = 0, disagree = 0;
    for (const v of opts) {
      await page.selectOption('#exsel', v);
      const er = await page.$eval('#fenerr', e => (e.classList.contains('hide') ? '' : e.textContent));
      if (/does not read|okunmuyor/.test(er)) fail.push('the lock example ' + v + ' does not read: ' + er);
      for (const fl of ['w', 'b']) {
        await page.selectOption('#flsel', fl);
        const nl = await page.$$eval('#lvls button[data-lv]:not([disabled])', x => x.length);
        for (let i = 0; i < nl; i++) {
          await page.locator('#lvls button[data-lv]:not([disabled])').nth(i).click();
          const np = await page.$$eval('#passes button', x => x.length);
          for (let k = 0; k < np; k++) { await page.locator('#passes button').nth(k).click(); n++; }
        }
        const t = await page.textContent('#vd');
        if (/disagrees|aynı fikirde değil/.test(t) || !t.trim()) disagree++;
      }
    }
    console.log('lock (' + lang + '):', n, 'passes shown,', disagree, 'disagreements |', (await page.textContent('#vd')).replace(/\s+/g, ' ').slice(0, 100));
    if (disagree) fail.push('the lock explorer disagrees with mateless.js (' + lang + ')');
  };
  await explore('en');
  // the lock detector alone: the download, and its section
  const zip = await page.getAttribute('#lockzip', 'href');
  console.log('lock zip:', zip);
  if (!/mateless-lock\.zip$/.test(zip || '')) fail.push('the lock tab has no download of mateless-lock.zip');
  await page.locator('#tab-lock a[href="#code"]:visible').first().click();
  await page.waitForTimeout(200);
  if (!await page.evaluate(() => { const r = document.getElementById('code').getBoundingClientRect(); return r.top >= -20 && r.top < innerHeight; }))
    fail.push('the lock tab\'s "In your own code" link does not scroll there');

  // 4. the rules: an anchor inside the tab
  await page.click('.tabs a[data-tab="rules"]');
  await page.locator('#tab-rules a[href="#r-material"]:visible').first().click();
  await page.waitForTimeout(200);
  console.log('rules:', await page.evaluate(() => MatelessSite.active()), '| r-material in view:',
    await page.evaluate(() => { const r = document.getElementById('r-material').getBoundingClientRect(); return r.top >= -20 && r.top < innerHeight; }));

  // 5. the Lichess scan: a small PGN through the workers
  const pgn = path.join(os.tmpdir(), 'mateless-page-check.pgn');
  const lock = '8/8/4k3/3p2p1/1p1P1pP1/1P3P2/8/3K4 b - - 0 92';
  const head = (id, res, term) => '[Event "Rated Blitz game"]\n[Site "https://lichess.org/' + id + '"]\n[UTCDate "2026.09.01"]\n[TimeControl "180+0"]\n' +
    '[Result "' + res + '"]\n[Termination "' + term + '"]\n[SetUp "1"]\n[FEN "' + lock + '"]\n\n';
  fs.writeFileSync(pgn, head('aaaaaaaa', '1-0', 'Time forfeit') + '92... Kf6 93. Ke2 Ke6 1-0\n\n' +
    head('bbbbbbbb', '1/2-1/2', 'Normal') + '92... Kf6 93. Ke2 Ke6 94. Kd1 Kf6 1/2-1/2\n\n' +
    '[Event "Rated Blitz game"]\n[Site "https://lichess.org/cccccccc"]\n[Result "0-1"]\n[Termination "Normal"]\n\n1. f3 e5 2. g4 Qh4# 0-1\n\n');
  await page.click('.tabs a[data-tab="scan"]');
  await page.setInputFiles('#scan-fileInput', pgn);
  await page.click('#scan-start');
  await page.waitForFunction(() => !document.getElementById('scan-start').disabled, null, { timeout: 120000 });
  const scan = await page.evaluate(() => ['mw', 'ml', 'cw', 'cl'].map(k => k + ' ' + document.getElementById('scan-n-' + k).textContent).join(', '));
  console.log('scan:', scan, '|', await page.textContent('#scan-status'));
  if (!/mw 1, ml 1/.test(scan)) fail.push('the scan did not find the timeout and the late draw: ' + scan);
  fs.unlinkSync(pgn);

  // 6. Turkish, every tab
  await page.selectOption('#lang', 'tr');
  for (const t of ['arbiter', 'lock', 'rules', 'scan', 'chasolver']) {
    await page.click('.tabs a[data-tab="' + t + '"]');
    await page.waitForFunction(t => MatelessSite.active() === t, t);
    const h1 = await page.evaluate(t => document.querySelector('#tab-' + t + ' h1').innerText, t);
    console.log('tr', t + ':', h1, '|', await page.title());
  }
  console.log('tr limit note:', await page.textContent('#limnote'));
  await explore('tr');
  await page.selectOption('#lang', 'en');

  // 7. no tab is wider than the screen on a phone
  await page.setViewportSize({ width: 390, height: 800 });
  for (const t of ['arbiter', 'lock', 'rules', 'scan', 'chasolver']) {
    await page.click('.tabs a[data-tab="' + t + '"]');
    const w = await page.evaluate(() => document.documentElement.scrollWidth);
    if (w > 390) fail.push(t + ' is ' + w + ' px wide at 390');
  }

  console.log('console errors:', errors.length ? errors : 'none');
  console.log(fail.length ? 'FAILED:\n  ' + fail.join('\n  ') : 'all tabs answer');
  await browser.close();
  process.exit(errors.length || fail.length ? 1 : 0);
})();
