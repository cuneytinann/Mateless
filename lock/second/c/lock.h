/* Mateless's lock detector, second version, in its simplest form. See lock.c and ../README.md.
   Squares: a1 = 0, b1 = 1, ..., h8 = 63. A set of squares (a bitboard) is a uint64_t. */
#ifndef MATELESS_LOCK_SECOND_H
#define MATELESS_LOCK_SECOND_H

#include <stdbool.h>
#include <stdint.h>

/* What the lock detector reads from a position. */
typedef struct {
    uint64_t white_pawns, black_pawns;
    uint64_t white_king, black_king;
    uint64_t white_bishops, black_bishops;
    uint64_t white_knights, black_knights;
    uint64_t white_rooks, black_rooks;
    uint64_t white_queens, black_queens;
    bool white_to_move;
    bool en_passant;     /* the side to move can capture en passant */
    bool white_castles;  /* White has a castling right (its king and that rook in place) */
    bool black_castles;
} Pieces;

/* The pieces of a FEN. The en passant square counts only if a pawn can capture onto it. */
Pieces lock_from_fen(const char *fen);

/* Can White (white = true) or Black never be mated, by the lock detector? */
bool lock_cannot_be_mated(const Pieces *p, bool white);

#endif
