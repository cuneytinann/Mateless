(* Mateless's lock detector, in its simplest form.

   Can a side never be mated? The lock detector answers yes when pawns, kings and bishops form a
   structure that no series of legal moves can open (FIDE 5.2.2 dead position, 6.9 flag fall). It
   reads bitboards only: it generates no move and searches nothing.

   Each king's reach (every square it may ever stand on) is grown from its square, never onto a
   square that a pawn which can never move attacks. The pawns that can never move are those
   blocked by a wall: a pawn the other side can never take. The squares where a side may take a
   pawn grow from its king's reach, and so on, until nothing changes. The structure leaks if a
   pawn can promote or capture, a frozen king can move, a bishop can reach a pawn's path, or the
   king of the side asked about can reach a square the other side attacks where it has no sure
   flight. It is tried with both kings free, then with each king frozen on its square (a wall for
   both sides) when every square around that king is held or attacked by a pawn.

   A knight, rook or queen on the board, two bishops of one side on squares of one colour, or a
   possible en passant capture fails it at once. Sound, not complete: a structure it passes can
   never be opened; one it fails may still be dead. *)

type pieces = {
  white_pawns : int64; black_pawns : int64;
  white_king : int64; black_king : int64;
  white_bishops : int64; black_bishops : int64;
  others : int64;     (* knights, rooks and queens of both sides *)
  en_passant : bool;  (* the side to move can capture en passant *)
}

(* C's & | ~ << >> on int64 (>>> shifts in zeros). The infix ones all bind like =, so C's
   parentheses stay. *)
let ( &&& ) = Int64.logand
let ( ||| ) = Int64.logor
let ( ~~~ ) = Int64.lognot
let ( <<< ) = Int64.shift_left
let ( >>> ) = Int64.shift_right_logical

let file_a = 0x0101010101010101L
let file_h = 0x8080808080808080L
let rank_1 = 0x00000000000000FFL
let rank_8 = 0xFF00000000000000L
let dark = 0xAA55AA55AA55AA55L   (* the dark squares; a1 is dark *)

let north s = s <<< 8
let south s = s >>> 8
let sideways s = ((s <<< 1) &&& ~~~file_a) ||| ((s >>> 1) &&& ~~~file_h)
let zone s = let v = s ||| north s ||| south s in v ||| sideways v   (* s and every square next to it *)
let diagonal s = sideways (north s ||| south s)                     (* the squares diagonally next to s *)
let count s =
  let rec go s n = if s = 0L then n else go (s &&& Int64.sub s 1L) (n + 1) in
  go s 0

(* Every square reachable from g by steps north through squares of p. *)
let fill_north g p =
  let g = g ||| (p &&& (g <<< 8)) in
  let p = p &&& (p <<< 8) in
  let g = g ||| (p &&& (g <<< 16)) in
  let p = p &&& (p <<< 16) in
  g ||| (p &&& (g <<< 32))

(* Every square reachable from g by steps south through squares of p. *)
let fill_south g p =
  let g = g ||| (p &&& (g >>> 8)) in
  let p = p &&& (p >>> 8) in
  let g = g ||| (p &&& (g >>> 16)) in
  let p = p &&& (p >>> 16) in
  g ||| (p &&& (g >>> 32))

let from_fen fen =
  let fields = List.filter (fun f -> f <> "") (String.split_on_char ' ' fen) in
  let white_pawns = ref 0L and black_pawns = ref 0L and white_king = ref 0L and black_king = ref 0L
  and white_bishops = ref 0L and black_bishops = ref 0L and others = ref 0L in
  let rank = ref 7 and file = ref 0 in
  String.iter
    (fun c ->
      if c = '/' then begin decr rank; file := 0 end
      else if c >= '1' && c <= '8' then file := !file + Char.code c - Char.code '0'
      else begin
        let sq = 1L <<< (8 * !rank + !file) in
        incr file;
        let set =
          match c with
          | 'P' -> white_pawns
          | 'p' -> black_pawns
          | 'K' -> white_king
          | 'k' -> black_king
          | 'B' -> white_bishops
          | 'b' -> black_bishops
          | _ -> others   (* N R Q n r q *)
        in
        set := !set ||| sq
      end)
    (List.hd fields);
  let white_to_move = List.nth_opt fields 1 <> Some "b" in
  let en_passant =
    match List.nth_opt fields 3 with   (* past the side to move and castling *)
    | Some ep when String.length ep >= 2 && ep.[0] >= 'a' && ep.[0] <= 'h' && ep.[1] >= '1' && ep.[1] <= '8' ->
      let target = 1L <<< (Char.code ep.[0] - Char.code 'a' + 8 * (Char.code ep.[1] - Char.code '1')) in
      if white_to_move then (sideways (south target) &&& !white_pawns) <> 0L
      else (sideways (north target) &&& !black_pawns) <> 0L
    | _ -> false
  in
  { white_pawns = !white_pawns; black_pawns = !black_pawns; white_king = !white_king;
    black_king = !black_king; white_bishops = !white_bishops; black_bishops = !black_bishops;
    others = !others; en_passant }

(* Two bishops on squares of one colour (only a promotion makes them). *)
let twin_bishops b = count (b &&& dark) > 1 || count (b &&& ~~~dark) > 1

let rec cannot_be_mated p white =
  if p.others <> 0L || p.en_passant then false
  else if twin_bishops p.white_bishops || twin_bishops p.black_bishops then false
  else if not (leaks p white 0L) then true
  else begin
    (* A king may be frozen only if every square around it is held or attacked by a pawn. *)
    let held = p.white_pawns ||| p.black_pawns ||| sideways (north p.white_pawns ||| south p.black_pawns) in
    let kings = [ p.white_king; p.black_king ] in
    List.exists (fun king -> (zone king &&& ~~~king &&& ~~~held) = 0L && not (leaks p white king)) kings
  end

(* Does the structure leak to the king asked about, with the king [frozen] frozen (0: none)? *)
and leaks p white frozen =
  let wp = p.white_pawns and bp = p.black_pawns and wk = p.white_king and bk = p.black_king in
  let frozen_white = (frozen &&& wk) <> 0L in
  let frozen_black = not frozen_white && frozen <> 0L in
  let near_frozen_black = if frozen_black then zone bk else 0L in
  let near_frozen_white = if frozen_white then zone wk else 0L in

  (* Quick: the pawns' paths against the first walls already show a promotion or a capture. *)
  let w_cone = fill_north wp ~~~((bp &&& ~~~wk) ||| frozen) in
  let b_cone = fill_south bp ~~~((wp &&& ~~~bk) ||| frozen) in
  if ((w_cone &&& rank_8) ||| (b_cone &&& rank_1) ||| (north (sideways w_cone) &&& b_cone)) <> 0L then true
  else
    (* The cycle: walls -> pawns that can never move -> king reaches -> capture squares -> walls. *)
    let rec cycle w_fixed b_fixed w_king b_king w_take b_take last_w_wall last_b_wall =
      let w_wall = (wp &&& ~~~b_take) ||| frozen in
      let b_wall = (bp &&& ~~~w_take) ||| frozen in
      let new_w_fixed = w_fixed &&& w_wall &&& south (b_wall ||| w_fixed) in
      let new_b_fixed = b_fixed &&& b_wall &&& north (w_wall ||| b_fixed) in
      if w_wall = last_w_wall && b_wall = last_b_wall && new_w_fixed = w_fixed && new_b_fixed = b_fixed then
        Some (w_fixed, b_fixed, w_king, b_king, w_wall, b_wall)
      else
        (* Both kings' reaches, flooded: never onto a fixed pawn, a square it attacks, or next to
           the frozen king. *)
        let w_mask = ~~~(new_w_fixed ||| sideways (south new_b_fixed) ||| near_frozen_black) in
        let b_mask = ~~~(new_b_fixed ||| sideways (north new_w_fixed) ||| near_frozen_white) in
        let rec flood new_w_king new_b_king =
          let a = new_w_king ||| (zone new_w_king &&& w_mask) in
          let d = new_b_king ||| (zone new_b_king &&& b_mask) in
          if a = new_w_king && d = new_b_king then (new_w_king, new_b_king) else flood a d
        in
        let new_w_king, new_b_king = flood w_king b_king in
        if (frozen_white && new_w_king <> wk) || (frozen_black && new_b_king <> bk) then
          None   (* the frozen king can move *)
        else
          (* A side may take a pawn where its king goes, and on any square a pawn may walk into. *)
          let t = b_take ||| new_b_king in
          let new_b_take = t ||| south (fill_south (t &&& ~~~b_wall) ~~~b_wall) in
          let t = w_take ||| new_w_king in
          let new_w_take = t ||| north (fill_north (t &&& ~~~w_wall) ~~~w_wall) in
          let changed = new_w_fixed <> w_fixed || new_b_fixed <> b_fixed || new_w_king <> w_king ||
                        new_b_king <> b_king || new_w_take <> w_take || new_b_take <> b_take in
          if not changed then Some (new_w_fixed, new_b_fixed, new_w_king, new_b_king, w_wall, b_wall)
          else cycle new_w_fixed new_b_fixed new_w_king new_b_king new_w_take new_b_take w_wall b_wall
    in
    match cycle wp bp          (* pawns that can never move      (shrink) *)
                wk bk          (* squares each king may reach    (grow) *)
                wk bk          (* squares where a side may take an enemy pawn (grow) *)
                ~~~0L ~~~0L    (* pawns the other side can never take, and the frozen king *)
    with
    | None -> true
    | Some (w_fixed, b_fixed, w_king, b_king, w_wall, b_wall) ->
      (* The pawns' cones: every square they may still reach. *)
      let w_cone = fill_north wp ~~~b_wall in
      let b_cone = fill_south bp ~~~w_wall in
      if ((w_cone &&& rank_8) ||| (b_cone &&& rank_1)) <> 0L then true   (* a pawn can promote *)
      else if (north (sideways w_cone) &&& b_cone) <> 0L then true      (* a pawn can capture *)
      else
        (* The bishops' reaches: every square they may reach, around the fixed pawns. *)
        let open_squares = ~~~(w_fixed ||| b_fixed) in
        let rec flood w_bish b_bish =
          let a = w_bish ||| (diagonal w_bish &&& open_squares) in
          let d = b_bish ||| (diagonal b_bish &&& open_squares) in
          if a = w_bish && d = b_bish then (w_bish, b_bish) else flood a d
        in
        let w_bish, b_bish = flood p.white_bishops p.black_bishops in
        if ((diagonal w_bish &&& b_cone) ||| (diagonal b_bish &&& w_cone)) <> 0L then true   (* a bishop meets a pawn's path *)
        else
          (* The mating net: can the other side's pawns and bishops catch the king asked about? *)
          let attack, reach, free, spare =
            if white then begin
              let attack = diagonal b_bish ||| sideways (south b_cone) in
              let reach = w_king in
              let free = ~~~(w_cone ||| zone b_king ||| attack) in   (* never occupied, attacked or next to the mater *)
              let spare = free &&& ~~~w_bish in                      (* ... nor reached by the king's own bishops *)
              (attack, reach, free, spare)
            end else begin
              let attack = diagonal w_bish ||| sideways (north w_cone) in
              let reach = b_king in
              let free = ~~~(b_cone ||| zone w_king ||| attack) in
              let spare = free &&& ~~~b_bish in
              (attack, reach, free, spare)
            end
          in
          (* A king next to a spare square, or with free squares beside it both ways, always has a flight. *)
          let flight = sideways spare ||| north spare ||| south spare ||| ((north free ||| south free) &&& sideways free) in
          (attack &&& reach &&& ~~~flight) <> 0L
