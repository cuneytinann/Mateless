# Tests lock.nim on ../positions.tsv:  nim c -d:release --hints:off -r test.nim [positions.tsv]
import std/[os, strutils]
import lock

let path = if paramCount() > 0: paramStr(1) else: "../positions.tsv"
var n, bad = 0
for line in lines(path):
  if line.len == 0 or line[0] == '#': continue
  let cols = line.split('\t')
  if cols.len < 3: continue
  let (fen, white, black) = (cols[0], cols[1] == "1", cols[2] == "1")
  let p = fromFen(fen)
  let (w, b) = (cannotBeMated(p, true), cannotBeMated(p, false))
  if w != white or b != black:
    inc bad
    if bad <= 10: echo "wrong: ", fen, " expected ", ord(white), " ", ord(black), " got ", ord(w), " ", ord(b)
  inc n
echo "nim: ", n, " positions, ", bad, " wrong"
quit(if bad > 0: 1 else: 0)
