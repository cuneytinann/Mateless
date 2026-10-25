"""Perft 3 with python-chess for Chess960 starts and random middlegames from them, as JSON
[[shredder_fen, count], ...], to compare with the engine's perft (an independent check of move
generation):  python3 perft_python.py > cases.json && node perft960.js cases.json"""
import chess, random, json, sys
random.seed(5)
cases = []
for _ in range(40):
    b = chess.Board.from_chess960_pos(random.randrange(960))
    for _ in range(random.randrange(0, 30)):
        if b.is_game_over(): break
        b.push(random.choice(list(b.legal_moves)))
    if b.is_game_over(): continue
    def perft(board, d):
        if d == 0: return 1
        n = 0
        for m in board.legal_moves:
            board.push(m); n += perft(board, d - 1); board.pop()
        return n
    cases.append([b.shredder_fen(), perft(b, 3)])
print(json.dumps(cases))
