"""Tests lock.py on ../positions.tsv: python3 test.py [positions.tsv]"""
import os
import sys

from lock import cannot_be_mated, from_fen

path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '..', 'positions.tsv')
n = bad = 0
for line in open(path):
    if line.startswith('#') or not line.strip():
        continue
    fen, white, black = line.rstrip('\n').split('\t')
    p = from_fen(fen)
    got = (cannot_be_mated(p, True), cannot_be_mated(p, False))
    if got != (white == '1', black == '1'):
        bad += 1
        if bad <= 10:
            print('wrong:', fen, 'expected', white, black, 'got', int(got[0]), int(got[1]))
    n += 1
print(f'python: {n} positions, {bad} wrong')
sys.exit(1 if bad else 0)
