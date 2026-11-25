"""Reference positions for fen_check.js, from python-chess (pip install chess):
    python3 fen_python.py [games] [random] [seed] | node fen_check.js -
Lines, tab-separated:
  legal  <fen>  <fen with the traditional en passant square>
         every position of random games, standard chess and Chess960 by turns, that give check
         whenever they can most of the time and play promotions and en passant captures when
         offered; after every move of a position that gives check in a special way (a double
         check, castling, en passant, a promotion) that position too. fromFen must read both FENs
         as they are: nothing refused, nothing put right, the same position.
  status <fen>  <python-chess's status bits>
         random boards (two kings and up to ten men, either side to move): wherever python-chess
         finds the position invalid (beyond castling and en passant, which fromFen puts right),
         fromFen must refuse it too.
Defaults: 600 games, 60,000 random boards, seed 7 (about a minute)."""
import chess, random, sys

games = int(sys.argv[1]) if len(sys.argv) > 1 else 600
boards = int(sys.argv[2]) if len(sys.argv) > 2 else 60000
random.seed(int(sys.argv[3]) if len(sys.argv) > 3 else 7)
out = sys.stdout


def emit(b):
    out.write('legal\t%s\t%s\n' % (b.shredder_fen(), b.shredder_fen(en_passant='fen')))


for g in range(games):
    b = chess.Board.from_chess960_pos(random.randrange(960) if g % 2 else 518)
    b.chess960 = True
    for ply in range(200):
        moves = list(b.legal_moves)
        emit(b)
        if not moves or b.is_insufficient_material():
            break
        for m in moves:
            if not b.gives_check(m):
                continue
            special = b.is_castling(m) or b.is_en_passant(m) or m.promotion
            b.push(m)
            if special or len(b.checkers()) == 2:
                emit(b)
            b.pop()
        checks = [m for m in moves if b.gives_check(m)]
        special = [m for m in moves if m.promotion or b.is_en_passant(m) or b.is_castling(m)]
        if special and random.random() < 0.6:
            m = random.choice(special)
        elif checks and random.random() < 0.7:
            m = random.choice(checks)
        else:
            m = random.choice(moves)
        b.push(m)

types = [chess.PAWN, chess.KNIGHT, chess.BISHOP, chess.ROOK, chess.QUEEN]
for i in range(boards):
    b = chess.Board(None)
    sqs = random.sample(range(64), 2 + random.randint(1, 10))
    b.set_piece_at(sqs[0], chess.Piece(chess.KING, chess.WHITE))
    b.set_piece_at(sqs[1], chess.Piece(chess.KING, chess.BLACK))
    for s in sqs[2:]:
        t = random.choice(types)
        if t == chess.PAWN and chess.square_rank(s) in (0, 7):
            t = chess.KNIGHT
        b.set_piece_at(s, chess.Piece(t, random.random() < 0.5))
    b.turn = random.random() < 0.5
    out.write('status\t%s\t%d\n' % (b.fen(), int(b.status())))
