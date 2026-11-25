"""Chess960 move generation, python-chess's side (an independent check of the engine's moves),
as JSON lines for perft960.js:
  ["perft", fen, n]          perft 3 of 40 positions: Chess960 starts and random middlegames
  ["start", i, fen, n]       perft 3 of every Chess960 starting position, 0 to 959
  ["moves", fen, "uci ..."]  the legal moves (sorted) of every position of random Chess960 games:
                             `games` games in which castling is played half the times it is
                             offered, then `heavy` games that keep the castling rights long (king
                             and rooks seldom move, the other men leave the first rank, castling
                             a tenth of the times it is offered); castling is written as the king
                             onto its own rook
FENs are Shredder-FEN. Defaults: 3,000 and 4,000 games, about 780,000 positions, a minute.
  python3 perft_python.py [games] [heavy] | node perft960.js -          (pip install chess)"""
import chess, random, json, sys

out = sys.stdout


def perft(board, d):
    if d == 1: return board.legal_moves.count()
    n = 0
    for m in board.legal_moves:
        board.push(m); n += perft(board, d - 1); board.pop()
    return n


def line(*record):
    out.write(json.dumps(record) + '\n')


# the 40 positions of the first version of this check (same seed, same positions)
random.seed(5)
for _ in range(40):
    b = chess.Board.from_chess960_pos(random.randrange(960))
    for _ in range(random.randrange(0, 30)):
        if b.is_game_over(): break
        b.push(random.choice(list(b.legal_moves)))
    if b.is_game_over(): continue
    line('perft', b.shredder_fen(), perft(b, 3))

for i in range(960):
    b = chess.Board.from_chess960_pos(i)
    line('start', i, b.shredder_fen(), perft(b, 3))

games = int(sys.argv[1]) if len(sys.argv) > 1 else 3000
heavy = int(sys.argv[2]) if len(sys.argv) > 2 else 4000
random.seed(960)
for g in range(games + heavy):
    keep = g >= games                          # a game that keeps the castling rights long
    b = chess.Board.from_chess960_pos(random.randrange(960))
    for ply in range(80 if keep else 160):
        moves = list(b.legal_moves)
        line('moves', b.shredder_fen(), ' '.join(sorted(m.uci() for m in moves)))
        if not moves or b.is_insufficient_material(): break
        castles = [m for m in moves if b.is_castling(m)]
        if keep:
            quiet = [m for m in moves if not b.is_castling(m) and b.piece_type_at(m.from_square) not in (chess.KING, chess.ROOK)]
            if castles and random.random() < 0.1: m = random.choice(castles)
            elif quiet and random.random() < 0.9: m = random.choice(quiet)
            else: m = random.choice(moves)
        else:
            m = random.choice(castles) if castles and random.random() < 0.5 else random.choice(moves)
        b.push(m)
out.flush()
