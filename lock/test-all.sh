#!/bin/sh
# Tests every version of the lock detector whose compiler or interpreter is installed, on
# positions.tsv:   sh test-all.sh
# Each version is copied to a temporary folder and built there, so nothing is left behind here.
# A version whose tools are missing is skipped. Exits 1 if any version gives a wrong answer.

here=$(cd "$(dirname "$0")" && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
ln -s "$here/positions.tsv" "$tmp/positions.tsv"
export DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1 CRYSTAL_CACHE_DIR="$tmp/.crystal" CARGO_TARGET_DIR="$tmp/target"

has() { command -v "$1" >/dev/null 2>&1; }
lua=$(for l in lua5.4 lua5.3 lua; do has $l && { echo $l; break; }; done)
passed=0 failed=0 skipped=""

# run <folder> <tool that must be installed> <commands, run inside the copied folder>
run() {
  folder=$1 tool=$2; shift 2
  if [ -z "$tool" ] || ! has "$tool"; then skipped="$skipped $folder"; return; fi
  cp -R "$here/$folder" "$tmp/$folder"
  if (cd "$tmp/$folder" && eval "$*") > "$tmp/$folder.log" 2>&1; then
    passed=$((passed + 1)); grep ' positions, ' "$tmp/$folder.log" | tail -n 1
  else
    failed=$((failed + 1)); echo "$folder: FAILED"; tail -n 15 "$tmp/$folder.log" | sed 's/^/  /'
  fi
}

run c          cc       'cc -std=c99 -O2 -o test test.c lock.c && ./test'
run cpp        c++      'c++ -std=c++17 -O2 -o test test.cpp && ./test'
run csharp     dotnet   'dotnet run -c Release -- ../positions.tsv'
run crystal    crystal  'crystal run --release test.cr -- ../positions.tsv'
run go         go       'go test -v'
run haskell    ghc      'ghc -O2 -outputdir build -o test Test.hs && ./test'
run java       javac    'javac Lock.java Test.java && java Test'
run javascript node     'node test.mjs'
run kotlin     kotlinc  'kotlinc Lock.kt Test.kt -include-runtime -d lock.jar && java -jar lock.jar'
run lua        "$lua"   '$lua test.lua'
run nim        nim      'nim c -d:release --hints:off --nimcache:nimcache -o:test test.nim && ./test'
run ocaml      ocamlopt 'ocamlopt -o test lock.mli lock.ml test.ml && ./test'
run pascal     fpc      'fpc -O2 test.pas && ./test'
run php        php      'php test.php'
run python     python3  'python3 test.py'
run ruby       ruby     'ruby test.rb'
run rust       cargo    'cargo test --release -q -- --nocapture'
run scala      scalac   'scalac -d . Lock.scala Test.scala && scala -cp . Test'
run typescript node     'node test.ts'
run zig        zig      'zig run -O ReleaseFast --cache-dir zig-cache test.zig'

echo "$passed passed, $failed failed${skipped:+, skipped (not installed):$skipped}"
[ "$failed" -eq 0 ]
