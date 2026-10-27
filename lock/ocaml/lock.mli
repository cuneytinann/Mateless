(* Mateless's lock detector, in its simplest form. See lock.ml and ../README.md.
   Squares: a1 = 0, b1 = 1, ..., h8 = 63. A set of squares (a bitboard) is an int64. *)

(** What the lock detector reads from a position. *)
type pieces = {
  white_pawns : int64; black_pawns : int64;
  white_king : int64; black_king : int64;
  white_bishops : int64; black_bishops : int64;
  others : int64;     (** knights, rooks and queens of both sides *)
  en_passant : bool;  (** the side to move can capture en passant *)
}

(** The pieces of a FEN. The en passant square counts only if a pawn can capture onto it. *)
val from_fen : string -> pieces

(** Can White ([white] = true) or Black never be mated, by the lock detector? *)
val cannot_be_mated : pieces -> bool -> bool
