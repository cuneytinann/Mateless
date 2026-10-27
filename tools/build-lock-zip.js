'use strict';
/* Builds mateless-lock.zip, the lock detector alone in every language, from lock/:
     node tools/build-lock-zip.js            writes mateless-lock.zip
     node tools/build-lock-zip.js --check    says whether mateless-lock.zip is up to date
   The archive holds one folder, mateless-lock/: everything in lock/ (build products left out)
   and the licence. It comes out byte for byte the same from the same files: the entries are in
   name order and carry no dates (1 January 1980, the zip format's first day). */
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const ROOT = path.join(__dirname, '..'), SRC = path.join(ROOT, 'lock'), OUT = path.join(ROOT, 'mateless-lock.zip');
const SKIP = /(^|\/)(target|bin|obj|_build|node_modules|zig-out|\.zig-cache|\.crystal|nimcache|__pycache__)(\/|$)|\.(class|o|obj|ppu|cmi|cmx|cmo|hi|exe|dll|jar|pyc)$|(^|\/)(Cargo\.lock|test)$/;

function files(dir, rel = '') {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
    const r = rel ? rel + '/' + e.name : e.name;
    if (SKIP.test(r)) continue;
    if (e.isDirectory()) out.push(...files(path.join(dir, e.name), r));
    else if (e.isFile()) out.push(r);
  }
  return out;
}

const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = buf => { let c = -1; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };

function zip(entries) {   // entries: [name, Buffer, executable]
  const parts = [], central = [];
  let offset = 0;
  for (const [name, data, exec] of entries) {
    const nameBuf = Buffer.from(name, 'utf8'), packed = zlib.deflateRawSync(data, { level: 9 }), crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);  // UTF-8 names
    local.writeUInt16LE(8, 8); local.writeUInt16LE(0, 10); local.writeUInt16LE(33, 12);               // deflate, 1980-01-01 00:00
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28);
    parts.push(local, nameBuf, packed);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(0x0314, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(8, 10); c.writeUInt16LE(0, 12); c.writeUInt16LE(33, 14);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(packed.length, 20); c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(nameBuf.length, 28); c.writeUInt16LE(0, 30); c.writeUInt16LE(0, 32); c.writeUInt16LE(0, 34); c.writeUInt16LE(0, 36);
    c.writeUInt32LE(((exec ? 0o100755 : 0o100644) << 16) >>> 0, 38);                                  // Unix permissions
    c.writeUInt32LE(offset, 42);
    central.push(c, nameBuf);
    offset += 30 + nameBuf.length + packed.length;
  }
  const size = central.reduce((n, b) => n + b.length, 0), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(size, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, ...central, end]);
}

function build() {
  const entries = files(SRC).map(r => [ 'mateless-lock/' + r, fs.readFileSync(path.join(SRC, r)), r.endsWith('.sh') ]);
  entries.push(['mateless-lock/LICENSE', fs.readFileSync(path.join(ROOT, 'LICENSE')), false]);
  entries.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  return { bytes: zip(entries), count: entries.length };
}

const { bytes, count } = build();
if (process.argv.includes('--check')) {
  const now = fs.existsSync(OUT) ? fs.readFileSync(OUT) : Buffer.alloc(0);
  if (!now.equals(bytes)) { console.log('mateless-lock.zip is out of date: run node tools/build-lock-zip.js'); process.exit(1); }
  console.log('mateless-lock.zip is up to date (' + count + ' files)');
} else {
  fs.writeFileSync(OUT, bytes);
  console.log('mateless-lock.zip: ' + count + ' files, ' + bytes.length + ' bytes');
}
