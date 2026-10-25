// Checks mateless.d.ts against mateless.js:
//   1. every runtime export (and every entry of _internal) is declared, and every declaration exists;
//   2. constants declared with literal types (colours, pieces, Result, RESULT_NAMES, …) have those values;
//   3. a usage file type-checks with tsc --strict, and the misuses in it are rejected.
//   npm i --no-save typescript      (once, in this folder or above it; TypeScript 5 or 7)
//   node types_check.js             (TSC=<path to tsc> to use another compiler)
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const enginePath = path.resolve(__dirname, process.env.ENGINE || '../mateless.js');
const dtsPath = enginePath.replace(/\.js$/, '.d.ts');
const E = require(enginePath);
let problems = 0;
const problem = text => { problems++; console.log('PROBLEM', text); };

// ── 1 and 2: the namespace's value declarations against the runtime ───────────────────────
// The declarations are read at brace depth 1 of `declare namespace Mateless { … }`; a constant's
// type runs to the `;` that closes it at that depth.
const text = fs.readFileSync(dtsPath, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const start = text.indexOf('{', text.indexOf('declare namespace Mateless'));
const declared = new Map();   // name -> type text of a constant, null for a function or class
for (let i = start + 1, depth = 1; i < text.length && depth > 0;) {
  if (depth === 1) {
    const m = /^\s*(function|class|const)\s+(\w+)/.exec(text.slice(i, i + 200));
    if (m) {
      let j = i + m[0].length, d = 0, type = null;
      if (m[1] === 'const') {
        j = text.indexOf(':', j) + 1;
        let k = j;
        for (; k < text.length; k++) { const c = text[k]; if ('{[('.includes(c)) d++; else if ('}])'.includes(c)) d--; else if (c === ';' && d === 0) break; }
        type = text.slice(j, k).trim(); j = k + 1;
      } else {
        // skip to the end of the declaration: a `;` at depth 0 (function) or the class body
        for (; j < text.length; j++) { const c = text[j]; if (c === '{') d++; else if (c === '}') { d--; if (d === 0 && m[1] === 'class') { j++; break; } } else if (c === ';' && d === 0) { j++; break; } }
      }
      declared.set(m[2], type);
      i = j;
      continue;
    }
  }
  const c = text[i++];
  if (c === '{') depth++; else if (c === '}') depth--;
}
const literal = t => {
  if (t == null) return undefined;
  t = t.trim().replace(/^readonly\s+/, '');
  if (/^-?\d+$/.test(t)) return Number(t);
  if (/^'[^']*'$/.test(t)) return t.slice(1, -1);
  if (t.startsWith('[') && t.endsWith(']')) { const v = t.slice(1, -1).split(',').map(literal); return v.every(x => x !== undefined) ? v : undefined; }
  if (t.startsWith('{') && t.endsWith('}')) {
    const o = {};
    for (const m of t.slice(1, -1).split(';').map(s => s.trim()).filter(Boolean)) {
      const p = /^(?:readonly\s+)?(\w+)\s*:\s*([\s\S]+)$/.exec(m);
      if (!p) return undefined;
      const v = literal(p[2]);
      if (v === undefined) return undefined;
      o[p[1]] = v;
    }
    return o;
  }
  return undefined;
};
for (const k of Object.keys(E)) if (!declared.has(k)) problem(`export ${k} is not declared`);
for (const k of declared.keys()) if (!(k in E)) problem(`${k} is declared but not exported`);
for (const [k, type] of declared) {
  if (k === '_internal') continue;
  const want = literal(type);
  if (want !== undefined && JSON.stringify(want) !== JSON.stringify(E[k])) problem(`${k}: declared ${JSON.stringify(want)}, runtime ${JSON.stringify(E[k])}`);
}
const internal = new Map();
{
  const body = declared.get('_internal').trim().slice(1, -1);
  for (let i = 0, depth = 0, from = 0; i <= body.length; i++) {
    const c = body[i];
    if (c === '{' || c === '(' || c === '[') depth++; else if (c === '}' || c === ')' || c === ']') depth--;
    else if ((c === ';' || i === body.length) && depth === 0) {
      const p = /^\s*(?:readonly\s+)?(\w+)\s*:\s*([\s\S]+)$/.exec(body.slice(from, i));
      if (p) internal.set(p[1], p[2].trim());
      from = i + 1;
    }
  }
}
for (const k of Object.keys(E._internal)) if (!internal.has(k)) problem(`_internal.${k} is not declared`);
for (const [k, type] of internal) {
  if (!(k in E._internal)) { problem(`_internal.${k} is declared but not exported`); continue; }
  const want = literal(type);
  if (want !== undefined && want !== E._internal[k]) problem(`_internal.${k}: declared ${want}, runtime ${E._internal[k]}`);
}

// ── 3: a usage file under tsc --strict ────────────────────────────────────────────────────
const from = JSON.stringify(enginePath.replace(/\.js$/, ''));
const usage = `
import Mateless = require(${from});
import { fromFen, cannotMate, proveBoth, Game, Domino, Result, RESULT_NAMES, WHITE, BLACK, FLAGGED_WHITE, FLAGGED_BLACK } from ${from};
const r = fromFen('8/8/4k3/3p2p1/1p1P1pP1/1P3P2/8/3K4 b - - 47 92');
if (r.error !== undefined) { const e: Mateless.FenError = r.error; throw new Error(e); }
const pos: Mateless.Position = r.position;
const side: Mateless.Color = pos.side;
const a: boolean = cannotMate(pos, BLACK) && Mateless.lockCannotMate(pos, Mateless.BLACK);
const both: Mateless.FlaggedSides = Mateless.cannotMate2(pos, FLAGGED_WHITE | FLAGGED_BLACK);
const [w, b] = proveBoth(pos);
const nodes: number = w.nodes + b.nodes + Mateless.proveCannotBeMated(pos, WHITE, { maxPly: 6, budget: 100 }).nodes;
const failure: Mateless.Failure | null = w.failure;
const name: Mateless.ResultName = RESULT_NAMES[Mateless.flagVerdict(pos, BLACK)];
const status: Mateless.ResultCode = Mateless.gameStatus(pos, { repetitions: 1 });
const dead: boolean = Mateless.isDeadPosition(pos) && status === Result.DEAD_POSITION;
const g = new Game(pos);
const moves: Mateless.Move[] = g.legalMoves();
const after: Mateless.ResultCode = g.play(moves[0].from, moves[0].to, Mateless.QUEEN);
const down: boolean = g.neverMates(WHITE) || g.whiteDownAt >= 0 || g.flags.blackDownAt >= 0;
const flags = new Mateless.Flags();
flags.update(pos, 0);
const never: boolean = flags.neverMates(BLACK) && flags.updatedPly === 0;
flags.rewind(0);
const memory: boolean = flags.memoryPly === 0 && !flags.updatedEp && !flags.updatedCheck;
const verdict: Mateless.ResultCode = g.flagVerdict(BLACK, { resigned: false });
const s = new Domino();
const one: Mateless.SearchResult = s.run(pos, BLACK, Mateless.DOMINO_PLY, Mateless.DOMINO_BUDGET, { rootStatic: false });
const pair: [Mateless.SearchResult, Mateless.SearchResult] = s.run2(pos, 3, 6, 100);
const copy: Mateless.Position = Mateless.makeMove(pos, new Mateless.Position(), moves[0].from, moves[0].to);
const fen: string = Mateless.toFen(copy, 1) + Mateless.squareName(Mateless.parseSquare('e4')) + Mateless.chess960Arrangement(518);
const files = new Mateless.CastlingFiles(Mateless.STANDARD_SKELETON);
const n: number = Mateless.perft(pos, 2) + Mateless._internal.generateLegalMoves(pos, new Int32Array(Mateless._internal.MOVE_STRIDE), 0);
try { Mateless.makeMove(pos, pos.clone(), 0, 63); } catch (e) { if (!(e instanceof Mateless.EngineError)) throw e; }
void [side, a, both, nodes, failure, name, dead, after, down, never, verdict, one, pair, fen, files.isStandard, n];
// The types must reject these:
// @ts-expect-error a FEN result may be an error: position can be undefined
cannotMate(fromFen('x').position, BLACK);
// @ts-expect-error a colour is WHITE (8) or BLACK (0)
cannotMate(pos, 1);
// @ts-expect-error a promotion is QUEEN, ROOK, BISHOP or KNIGHT
g.play(12, 28, Mateless.KING);
// @ts-expect-error claims are the platform's: there is no autoClaim
Mateless.gameStatus(pos, { autoClaim: true });
// @ts-expect-error squares are numbers
Mateless.isAttacked(pos, 'e4', WHITE);
// @ts-expect-error the answer of cannotMate2 is a set of sides, not a boolean
const wrong: boolean = Mateless.cannotMate2(pos, 3);
void wrong;
`;
let tsc = process.env.TSC;
if (!tsc) {
  try { tsc = path.join(path.dirname(require.resolve('typescript/package.json', { paths: [__dirname, process.cwd()] })), 'bin', 'tsc'); }
  catch (e) { console.log('TypeScript not found: npm i --no-save typescript (or TSC=<path to tsc>)'); process.exit(2); }
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mateless-types-'));
fs.writeFileSync(path.join(dir, 'usage.ts'), usage);
const run = spawnSync(tsc.endsWith('.js') || !process.env.TSC ? process.execPath : tsc,
  [...(tsc.endsWith('.js') || !process.env.TSC ? [tsc] : []), '--version'], { encoding: 'utf8' });
const version = (run.stdout || '').trim();
const args = ['--noEmit', '--strict', '--target', 'es2020', '--module', 'commonjs', path.join(dir, 'usage.ts')];
const check = spawnSync(tsc.endsWith('.js') || !process.env.TSC ? process.execPath : tsc,
  [...(tsc.endsWith('.js') || !process.env.TSC ? [tsc] : []), ...args], { encoding: 'utf8' });
for (const line of (check.stdout + check.stderr).split('\n').filter(l => l.trim())) problem('tsc: ' + line);
if (check.status !== 0 && !(check.stdout + check.stderr).trim()) problem('tsc exited with ' + check.status);
fs.rmSync(dir, { recursive: true, force: true });

console.log(`${Object.keys(E).length} exports, ${Object.keys(E._internal).length} internals, ${version}: ${problems} problems`);
process.exit(problems ? 1 : 0);
