'use strict';
/* Copies mateless.js into index.html (the arbiter page), between <script id="mateless-engine"> and its </script>,
   so the page always runs exactly the engine that the tests check.
   Usage: node tools/embed-engine.js [engine.js] [page.html] */
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const enginePath = process.argv[2] || path.join(root, 'mateless.js');
const pagePath = process.argv[3] || path.join(root, 'index.html');
const engine = fs.readFileSync(enginePath, 'utf8').trim();
if (/<\/script/i.test(engine)) throw new Error('the engine source contains "</script"; it cannot be embedded as is');
const page = fs.readFileSync(pagePath, 'utf8');
const open = '<script id="mateless-engine">', start = page.indexOf(open);
if (start < 0) throw new Error('no <script id="mateless-engine"> in ' + pagePath);
const end = page.indexOf('</script>', start);
if (end < 0) throw new Error('the engine script in ' + pagePath + ' is not closed');
fs.writeFileSync(pagePath, page.slice(0, start + open.length) + '\n' + engine + '\n' + page.slice(end));
console.log('embedded', path.basename(enginePath), '(' + Buffer.byteLength(engine) + ' B) into', path.basename(pagePath));
