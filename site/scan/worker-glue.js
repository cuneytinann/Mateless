/* ═══ The worker: one job at a time, from the page ═══════════════════════════════════════════
   A job is a frame of the file (a Blob: decompressed here when it is a zstd frame) or a piece of
   text the page stitched together (the end of one frame and the start of the next). A frame's
   own complete games are scanned here; the text before its first game (head) and its last game,
   which may go on in the next frame (tail), go back to the page as bytes. */
const SCANNER = makeScanner(Mateless, typeof CHA !== 'undefined' ? CHA : null);
const DECODER = new TextDecoder('utf-8');
const EVENT = [10, 91, 69, 118, 101, 110, 116, 32];      // "\n[Event "

/** The index of the "[" of the first line that begins "[Event " after position 0, or -1. */
function firstGame(u, from) {
  for (let i = u.indexOf(10, from); i >= 0 && i + 8 <= u.length; i = u.indexOf(10, i + 1)) {
    let ok = true;
    for (let j = 1; j < 8; j++) if (u[i + j] !== EVENT[j]) { ok = false; break; }
    if (ok) return i + 1;
  }
  return -1;
}
/** The index of the "[" of the last line that begins "[Event " after position 0, or -1. */
function lastGame(u) {
  for (let i = u.lastIndexOf(10); i >= 0; i = i > 0 ? u.lastIndexOf(10, i - 1) : -1) {
    if (i + 8 > u.length) continue;
    let ok = true;
    for (let j = 1; j < 8; j++) if (u[i + j] !== EVENT[j]) { ok = false; break; }
    if (ok) return i + 1;
  }
  return -1;
}
const startsWithGame = u => u.length >= 7 && EVENT.slice(1).every((c, j) => u[j] === c);

self.onmessage = async (e) => {
  const job = e.data;
  try {
    let bytes;
    if (job.kind === 'frame') {
      const buf = new Uint8Array(await job.blob.arrayBuffer());
      bytes = job.compressed ? fzstd.decompress(buf.subarray(job.skip)) : buf;
    } else {
      bytes = job.bytes;
    }
    const out = { mw: [], ml: [], cw: [], cl: [] }, st = SCANNER.newStats();
    let head = new Uint8Array(0), tail = new Uint8Array(0), body = bytes;
    if (job.kind === 'frame') {
      const a = startsWithGame(bytes) ? 0 : firstGame(bytes, 0);
      if (a < 0) { head = bytes.slice(); body = new Uint8Array(0); }
      else {
        head = bytes.slice(0, a);
        body = bytes.subarray(a);
        const b = lastGame(body);
        const cut = b < 0 ? 0 : b;                        // the last game may go on in the next frame
        tail = body.slice(cut);
        body = body.subarray(0, cut);
      }
    }
    if (body.length) SCANNER.scanGames(DECODER.decode(body), job.opts, out, st);
    self.postMessage({ id: job.id, kind: job.kind, k: job.k, head, tail, out, st, bytes: bytes.length }, [head.buffer, tail.buffer]);
  } catch (err) {
    self.postMessage({ id: job.id, error: String((err && err.stack) || err) });
  }
};
