'use strict';
/* Opens the two pages in headless Chromium and exercises them; fails on any console error.
     index.html      one position, a labelled batch, the detail dialog, the PGN replay, the
                     language switch and the engine source
     chasolver.html  a position handed over in the address (#fen=…&side=…), as the arbiter's
                     "Ask chasolver" link does
   Google Fonts is answered with an empty style sheet, so the check needs no network.
     node page_check.js [dir]        (default: the repository root) */
const { chromium } = require('playwright');
const path = require('path');
const dir = path.resolve(process.argv[2] || path.join(__dirname, '..'));
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.goto('file://' + path.join(dir, 'index.html'));
  console.log('default language:', await page.inputValue('#lang'));
  // 1. the example
  await page.click('#example');
  await page.click('#go');
  await page.waitForSelector('#solo .score', { timeout: 60000 });
  console.log('single:', await page.textContent('#solo .score'), '|', await page.textContent('#solo .vword'), '|', await page.textContent('#solo .chip'));
  console.log('steps:', (await page.$$eval('#solo .steps li', ls => ls.map(l => l.querySelector('b').textContent + '=' + l.querySelector('.stag').textContent))).join(', '));
  console.log('status:', await page.textContent('#stat'));
  // 2. a labelled batch with an invalid line, a forced capture into a lock and a dead position by the Domino effect
  await page.fill('#fen', [
    '-- 3k4/8/8/1p1p1p1p/1P1P1P1P/8/3q4/3K4 w - - 0 1',   // only move Kxd2, then a lock: found by search, not a static lock
    'WB rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    '-- 8/8/4k3/8/8/4K3/8/8 w - - 0 1',
    'W- 8/8/8/8/8/2k5/1q6/K7 b - - 0 1',
    'bogus line',
    '4k3/8/8/8/8/8/8/R3K2R w KQ - 0 1',
    '8/8/8/8/6qK/8/5k2/8 w - - 2 63',                       // forced Kxg4, then bare kings: dead by the Domino effect
  ].join('\n'));
  await page.fill('#ply', '60'); await page.fill('#bud', '20000');
  await page.click('#go');
  await page.waitForSelector('#out:not(.hide) #perfile tr', { timeout: 60000 });
  console.log('status:', await page.textContent('#stat'));
  console.log('reasons:', (await page.$$eval('#outcome .ok1', ks => ks.map(k => k.querySelector('.ol').textContent + ' ' + k.querySelector('b').textContent))).join(', '));
  console.log('dead:', await page.textContent('#outcome .note'));
  console.log('ref:', await page.textContent('#refbox .note'));
  await page.selectOption('#fshow', '');
  const cards = await page.$$eval('#grid .card', cs => cs.map(c => c.querySelector('.ct').textContent + ' | ' + c.querySelector('.cm').textContent.replace(/\s+/g, ' ')));
  console.log('cards:\n  ' + cards.join('\n  '));
  await page.click('#grid .card');
  await page.waitForSelector('#lb:not(.hide) .score');
  console.log('dialog:', await page.textContent('#lbpos'), await page.textContent('#lbbody .vword'));
  await page.keyboard.press('ArrowRight');
  console.log('dialog next:', await page.textContent('#lbpos'), await page.textContent('#lbbody .vword'));
  await page.keyboard.press('Escape');
  // 3. games: a mate, a game played on after a dead position, a Chess960 castle
  await page.fill('#pgntext', [
    '[Event "fool"]\n[Result "0-1"]\n\n1. f3 e5 2. g4 Qh4# 0-1\n',
    '[Event "dead"]\n[Result "1-0"]\n[FEN "8/8/4k3/8/8/2K5/3Q4/8 w - - 0 1"]\n\n1. Qd5+ Kxd5 2. Kd3 Kc5 1-0\n',
    '[Event "960"]\n[Variant "Chess960"]\n[Result "*"]\n[FEN "rkr5/pppppppp/8/8/8/8/PPPPPPPP/RKR5 w KQkq - 0 1"]\n\n1. O-O O-O 2. a3 *\n',
  ].join('\n'));
  await page.click('#pgngo');
  await page.waitForSelector('#pgnout:not(.hide) #pgntab tr[data-pk]', { timeout: 60000 });
  console.log('games:', await page.textContent('#pstat'));
  console.log((await page.$$eval('#pgntab tr[data-pk]', rs => rs.map(r => [...r.cells].map(c => c.textContent).join(' | ')))).join('\n'));
  await page.click('#pgntab tr[data-pk="1"]');
  console.log('game detail:', (await page.textContent('#pgndet .note')).slice(0, 140));
  // 4. language and engine source
  await page.selectOption('#lang', 'tr');
  console.log('tr:', await page.textContent('h1'), '|', await page.textContent('#limnote'));
  await page.click('#fold-engine summary');
  await page.waitForFunction(() => document.getElementById('srcbox').textContent.length > 0, null, { timeout: 10000 });
  console.log('engine source chars:', (await page.textContent('#srcbox')).length);
  await page.selectOption('#lang', 'en');
  // 5. chasolver, asked from the arbiter's link
  const href = await (async () => { await page.click('#example'); await page.click('#go'); await page.waitForSelector('#solo .score');
    return page.getAttribute('#solo a[href^="chasolver.html"]', 'href'); })();
  await page.goto('file://' + path.join(dir, href));
  await page.waitForSelector('#out .verdict:not(.v-pending)', { timeout: 120000 });
  console.log('chasolver:', await page.textContent('#out .verdict'), '|', (await page.textContent('#out .vtext')).slice(0, 90));
  console.log('console errors:', errors.length ? errors : 'none');
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})();
