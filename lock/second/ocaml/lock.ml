(* Mateless's lock detector, second version, in its simplest form.

   Can a side never be mated? The lock detector answers yes when pawns, kings and bishops (and
   knights, rooks or queens boxed in by their own men) form a structure that no series of legal
   moves can open (FIDE 5.2.2 dead position, 6.9 flag fall). It reads bitboards and the side to
   move: it generates no move and searches nothing.

   The first version (../../ocaml/lock.ml) grows each king's reach, the pawns that can never move,
   and the squares where each side may take a pawn, until nothing changes; the structure leaks if a
   pawn can promote or capture, a frozen king can move, a bishop can reach a pawn's path, or the
   king asked about can reach a square the other side attacks without a sure flight. This version
   keeps all of it and adds, each only where its situation is on the board:
     - open pawn pairs: a white and a black pawn on one file with one empty square between them;
       the reachable positions split into families by what the pair's pawns have done (neither
       moved, the white one stepped into the gap, the black one did), up to 3 pairs;
     - boxed knights, rooks and queens: a piece whose every step square holds one of its own men
       that never moves, and that no enemy king or bishop reaches, never moves nor falls;
     - twin bishops: two bishops of one side on one colour no longer fail it; the mating net
       leaves out its second flight rule where they may hold both flights;
     - the stalemate guard: a pawn the enemy king may take stays a wall if taking it always
       stalemates its owner;
     - the check seed: a king in a pawn's check starts its reach from the squares it can step to;
     - the stuck mater: whatever the flagged side plays, the mater is left without a move;
     - the forced step: a king in a pawn's check with one legal move, a step: the lock of the
       position after it.
   A possible en passant capture fails it at once. Sound, not complete: a structure it passes can
   never be opened; one it fails may still be dead. *)

type pieces = {
  white_pawns : int64; black_pawns : int64;
  white_king : int64; black_king : int64;
  white_bishops : int64; black_bishops : int64;
  white_knights : int64; black_knights : int64;
  white_rooks : int64; black_rooks : int64;
  white_queens : int64; black_queens : int64;
  white_to_move : bool;
  en_passant : bool;  (* the side to move can capture en passant *)
}

(* What one level leaves for the mating net (and for the families after it). *)
type sets = {
  w_cone : int64; b_cone : int64; w_fixed : int64; b_fixed : int64; w_king : int64; b_king : int64;
  w_bish : int64; b_bish : int64; w_take : int64; b_take : int64;
}

(* What the families of the open pairs say at one level. *)
type family =
  | Lock      (* none of them leaks to the king asked about *)
  | Refuted   (* family A (no pair's pawn has moved) leaks to it *)
  | Other     (* another family leaks *)

(* C's & | ~ << >> on int64 (>>> shifts in zeros). They bind as in C, except that a comparison
   binds tighter than &&& and |||: comparisons keep their parentheses. *)
let ( &&& ) = Int64.logand
let ( ||| ) = Int64.logor
let ( ~~~ ) = Int64.lognot
let ( <<< ) = Int64.shift_left
let ( >>> ) = Int64.shift_right_logical

let file_a = 0x0101010101010101L
let file_h = 0x8080808080808080L
let rank_1 = 0x00000000000000FFL
let rank_3 = 0x0000000000FF0000L
let rank_6 = 0x0000FF0000000000L
let rank_8 = 0xFF00000000000000L
let dark = 0xAA55AA55AA55AA55L   (* the dark squares; a1 is dark *)
let max_pairs = 3                (* the most open pairs the families are split on (3^3 = 27) *)

let north s = s <<< 8
let south s = s >>> 8
let sideways s = ((s <<< 1) &&& ~~~file_a) ||| ((s >>> 1) &&& ~~~file_h)
let zone s = let v = s ||| north s ||| south s in v ||| sideways v   (* s and every square next to it *)
let steps s = zone s &&& ~~~s                                       (* the squares next to s *)
let diagonal s = sideways (north s ||| south s)                     (* the squares diagonally next to s *)
let count s =
  let rec go s n = if s = 0L then n else go (s &&& Int64.sub s 1L) (n + 1) in
  go s 0
let lowest s = s &&& Int64.neg s                                    (* the lowest square of s *)
let rest s = s &&& Int64.sub s 1L                                   (* s without its lowest square *)

(* The squares a knight on s goes to. *)
let knight s =
  let one = sideways s in
  let two = ((s <<< 2) &&& ~~~(file_a ||| (file_a <<< 1))) ||| ((s >>> 2) &&& ~~~(file_h ||| (file_h >>> 1))) in
  north (north one) ||| south (south one) ||| north two ||| south two

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

(* Every square a king may reach from k through squares of m. *)
let rec flood k m = let a = k ||| (zone k &&& m) in if a = k then k else flood a m

let from_fen fen =
  let fields = List.filter (fun f -> f <> "") (String.split_on_char ' ' fen) in
  let sets = Array.make 128 0L in
  let rank = ref 7 and file = ref 0 in
  String.iter
    (fun c ->
      if c = '/' then begin decr rank; file := 0 end
      else if c >= '1' && c <= '8' then file := !file + Char.code c - Char.code '0'
      else begin
        sets.(Char.code c) <- sets.(Char.code c) ||| (1L <<< (8 * !rank + !file));
        incr file
      end)
    (List.hd fields);
  let s c = sets.(Char.code c) in
  let white_to_move = List.nth_opt fields 1 <> Some "b" in
  let en_passant =
    match List.nth_opt fields 3 with   (* past the side to move and castling *)
    | Some ep when String.length ep >= 2 && ep.[0] >= 'a' && ep.[0] <= 'h' && ep.[1] >= '1' && ep.[1] <= '8' ->
      let target = 1L <<< (Char.code ep.[0] - Char.code 'a' + 8 * (Char.code ep.[1] - Char.code '1')) in
      if white_to_move then (sideways (south target) &&& s 'P') <> 0L
      else (sideways (north target) &&& s 'p') <> 0L
    | _ -> false
  in
  { white_pawns = s 'P'; black_pawns = s 'p'; white_king = s 'K'; black_king = s 'k';
    white_bishops = s 'B'; black_bishops = s 'b'; white_knights = s 'N'; black_knights = s 'n';
    white_rooks = s 'R'; black_rooks = s 'r'; white_queens = s 'Q'; black_queens = s 'q';
    white_to_move; en_passant }

(* The levels: both kings free (0), then each king frozen on its square (a wall for both sides)
   when every square around it is held or attacked by a pawn. *)
let levels p =
  let held = p.white_pawns ||| p.black_pawns ||| sideways (north p.white_pawns ||| south p.black_pawns) in
  0L :: List.filter (fun king -> (steps king &&& ~~~held) = 0L) [ p.white_king; p.black_king ]

(* The check seed: the side to move is in a pawn's check, so its king must step now, to a square it
   can step to (not its own pawn, not a square an enemy pawn attacks, not next to the enemy king);
   its reach starts there. Not when it has no such square (that may be a mate now), when one of its
   pawns can take a checking pawn, or with a bishop on the board. The kings' starting sets. *)
let check_seed p =
  let wp = p.white_pawns and bp = p.black_pawns and wk = p.white_king and bk = p.black_king in
  let white = p.white_to_move in
  let k, own = if white then (wk, wp) else (bk, bp) in
  let checkers = if white then sideways (north k) &&& bp else sideways (south k) &&& wp in
  if (p.white_bishops ||| p.black_bishops) <> 0L || checkers = 0L then (wk, bk)
  else begin
    let attacked = if white then sideways (south bp) else sideways (north wp) in
    let dest = steps k &&& ~~~own &&& ~~~attacked &&& ~~~(steps (if white then bk else wk)) in
    let takers = (if white then sideways (south checkers) else sideways (north checkers)) &&& own in
    if dest = 0L || takers <> 0L then (wk, bk) else if white then (dest, bk) else (wk, dest)
  end

(* Does a diagonal line from the square king, stopped by block, meet a square of o? *)
let ray_meets king block o =
  let rec index s i = if Int64.logand (Int64.shift_right_logical s i) 1L = 1L then i else index s (i + 1) in
  let sq = index king 0 in
  let rec walk f r df dr =
    if f < 0 || f > 7 || r < 0 || r > 7 then false
    else
      let s = 1L <<< (8 * r + f) in
      if (o &&& s) <> 0L then true
      else if (block &&& s) <> 0L then false
      else walk (f + df) (r + dr) df dr
  in
  List.exists (fun (df, dr) -> walk ((sq land 7) + df) ((sq lsr 3) + dr) df dr) [ (-1, -1); (1, -1); (-1, 1); (1, 1) ]

(* The stalemate guard: of the owner's fixed pawns cand (which the enemy king may take), those whose
   capture always stalemates the owner. The owner must have nothing else that moves (every other
   pawn fixed; no bishop, which the caller sees to). reach: where the owner's king may stand; shut:
   squares it can never step to (own fixed pawns, squares the enemy's fixed pawns attack);
   enemy_king: the enemy king's reach; block: squares a bishop's line never crosses. *)
let stalemate_guard cand own own_fixed reach shut enemy_king enemy_bishops block =
  if (own &&& ~~~own_fixed) <> 0L then 0L
  else begin
    let held pawn =
      let near = steps pawn in
      let source = near &&& enemy_king in   (* where the enemy king takes from *)
      let x = shut ||| near ||| pawn in     (* after the capture, the owner's king may not step there *)
      (* the owner's king, not defending the pawn, has a square to step to, or the capture uncovers a check *)
      let rec ok k =
        k = 0L ||
        (let king = lowest k in
         (steps king &&& ~~~x) = 0L && not (enemy_bishops && ray_meets king (block ||| pawn) source) && ok (rest k))
      in
      ok (reach &&& ~~~(near ||| pawn))
    in
    let rec go c guard = if c = 0L then guard else go (rest c) (if held (lowest c) then guard ||| lowest c else guard) in
    go cand 0L
  end

(* One level: the fixed point of the walls, the pawns that can never move, the kings' reaches, the
   squares where each side may take a pawn, the pawns' cones and the bishops' reaches. The sets the
   mating net reads, or None when the structure leaks whichever side is asked about.
   pawns: the pawns (a family has a pair's pawn moved into its gap); v: walls for both sides (the
   gaps of a family's pairs that stay); start: where the kings' reaches, capture squares and
   bishops' reaches start (a family's); wx, bx, ws, bs: the boxed pieces' candidates and their step
   squares; guard: the stalemate guard and the check seed (plain levels only). *)
let level ?pawns ?(v = 0L) ?start ?(wx = 0L) ?(bx = 0L) ?(ws = 0L) ?(bs = 0L) ?(guard = false) p frozen =
  let wp, bp = match pawns with Some pw -> pw | None -> (p.white_pawns, p.black_pawns) in
  let wk = p.white_king and bk = p.black_king and v = v ||| frozen in
  let frozen_white = (frozen &&& wk) <> 0L in
  let frozen_black = not frozen_white && frozen <> 0L in
  let near_frozen_black = if frozen_black then zone bk else 0L in
  let near_frozen_white = if frozen_white then zone wk else 0L in
  let w_seed, b_seed = if guard && frozen = 0L then check_seed p else (wk, bk) in
  let st = match start with Some a -> a | None -> [| w_seed; b_seed; w_seed; b_seed; p.white_bishops; p.black_bishops |] in
  let w_king = ref st.(0) and b_king = ref st.(1) and w_take = ref st.(2) and b_take = ref st.(3) in
  let w_bish = ref st.(4) and b_bish = ref st.(5) in
  let w_cone = ref wp and b_cone = ref bp and w_fixed = ref wp and b_fixed = ref bp in
  let w_guard = ref (if guard then -1L else 0L) and b_guard = ref (if guard then -1L else 0L) in   (* nothing is taken yet *)
  let changed = ref true in
  while !changed do
    (* Boxed: the pieces no enemy king or bishop reaches. Walls: pawns the other side can never
       take (or whose capture stalemates their owner), the frozen king, the gaps, boxed pieces. *)
    let boxed = (wx &&& ~~~(!b_king ||| !b_bish)) ||| (bx &&& ~~~(!w_king ||| !w_bish)) in
    let w_wall = (wp &&& ~~~(!b_take &&& ~~~ !w_guard)) ||| v ||| boxed in
    let b_wall = (bp &&& ~~~(!w_take &&& ~~~ !b_guard)) ||| v ||| boxed in
    let nw_fixed = !w_fixed &&& w_wall &&& south (b_wall ||| !w_fixed) in
    let nb_fixed = !b_fixed &&& b_wall &&& north (w_wall ||| !b_fixed) in
    let nw_cone = fill_north !w_cone ~~~b_wall and nb_cone = fill_south !b_cone ~~~w_wall in
    (* The kings: never onto a fixed pawn, a square it attacks, or next to the frozen king. *)
    let b_hit = sideways (south nb_fixed) and w_hit = sideways (north nw_fixed) in
    let nw_king = flood !w_king ~~~(nw_fixed ||| b_hit ||| near_frozen_black) in
    let nb_king = flood !b_king ~~~(nb_fixed ||| w_hit ||| near_frozen_white) in
    let open_squares = ~~~(nw_fixed ||| nb_fixed) in
    let rec bishops a d =
      let a' = a ||| (diagonal a &&& open_squares) and d' = d ||| (diagonal d &&& open_squares) in
      if a' = a && d' = d then (a, d) else bishops a' d'
    in
    let nw_bish, nb_bish = bishops !w_bish !b_bish in
    (* A side may take a pawn where its king goes, and on any square a pawn may walk into. *)
    let t = !b_take ||| nb_king in
    let nb_take = t ||| south (fill_south (t &&& ~~~b_wall) ~~~b_wall) in
    let t = !w_take ||| nw_king in
    let nw_take = t ||| north (fill_north (t &&& ~~~w_wall) ~~~w_wall) in
    let nw_guard, nb_guard =
      if guard then begin
        let block = nw_fixed ||| nb_fixed in
        let w_has_b = p.white_bishops <> 0L and b_has_b = p.black_bishops <> 0L in
        ((if w_has_b then 0L else stalemate_guard (wp &&& nb_take &&& nw_fixed) wp nw_fixed nw_king (nw_fixed ||| b_hit) nb_king b_has_b block),
         (if b_has_b then 0L else stalemate_guard (bp &&& nw_take &&& nb_fixed) bp nb_fixed nb_king (nb_fixed ||| w_hit) nw_king w_has_b block))
      end else (!w_guard, !b_guard)
    in
    changed := nw_cone <> !w_cone || nb_cone <> !b_cone || nw_fixed <> !w_fixed || nb_fixed <> !b_fixed ||
               nw_king <> !w_king || nb_king <> !b_king || nw_bish <> !w_bish || nb_bish <> !b_bish ||
               nw_take <> !w_take || nb_take <> !b_take || nw_guard <> !w_guard || nb_guard <> !b_guard;
    w_cone := nw_cone; b_cone := nb_cone; w_fixed := nw_fixed; b_fixed := nb_fixed; w_king := nw_king; b_king := nb_king;
    w_bish := nw_bish; b_bish := nb_bish; w_take := nw_take; b_take := nb_take; w_guard := nw_guard; b_guard := nb_guard
  done;
  let boxed = (wx &&& ~~~(!b_king ||| !b_bish)) ||| (bx &&& ~~~(!w_king ||| !w_bish)) in
  if ((!w_cone &&& rank_8) ||| (!b_cone &&& rank_1)) <> 0L then None                             (* a pawn can promote *)
  else if ((north (sideways !w_cone) &&& (!b_cone ||| bx)) ||| (south (sideways !b_cone) &&& wx)) <> 0L then None  (* a pawn can capture *)
  else if (frozen_white && !w_king <> wk) || (frozen_black && !b_king <> bk) then None           (* the frozen king can move *)
  else if ((diagonal !w_bish &&& !b_cone) ||| (diagonal !b_bish &&& !w_cone)) <> 0L then None    (* a bishop meets a pawn's path *)
  else if ((ws &&& ~~~(!w_fixed ||| (wx &&& boxed))) ||| (bs &&& ~~~(!b_fixed ||| (bx &&& boxed)))) <> 0L then None  (* a piece may step *)
  else begin
    if (!w_guard ||| !b_guard) <> 0L then begin
      (* A king that takes a guarded pawn ends the game: for the mating net, the kings' reaches
         again, now stopping at the enemy's guarded pawns. *)
      w_king := flood w_seed ~~~(!w_fixed ||| sideways (south !b_fixed) ||| near_frozen_black ||| (bp &&& !b_guard));
      b_king := flood b_seed ~~~(!b_fixed ||| sideways (north !w_fixed) ||| near_frozen_white ||| (wp &&& !w_guard))
    end;
    Some { w_cone = !w_cone; b_cone = !b_cone; w_fixed = !w_fixed; b_fixed = !b_fixed; w_king = !w_king; b_king = !b_king;
           w_bish = !w_bish; b_bish = !b_bish; w_take = !w_take; b_take = !b_take }
  end

(* The mating net: can the other side's pawns and bishops catch the king asked about? occ: squares
   that stand occupied for good besides (the boxed pieces'). *)
let net_leaks p s white occ =
  let attack, reach, free, spare, twins =
    if white then begin
      let attack = diagonal s.b_bish ||| sideways (south s.b_cone) in
      let free = ~~~(s.w_cone ||| occ ||| zone s.b_king ||| attack) in   (* never occupied, attacked or next to the mater *)
      (attack, s.w_king, free, free &&& ~~~(s.w_bish), p.white_bishops)  (* spare: ... nor reached by the king's own bishops *)
    end else begin
      let attack = diagonal s.w_bish ||| sideways (north s.w_cone) in
      let free = ~~~(s.b_cone ||| occ ||| zone s.w_king ||| attack) in
      (attack, s.b_king, free, free &&& ~~~(s.b_bish), p.black_bishops)
    end
  in
  (* A king next to a spare square, or with free squares beside it both ways, always has a flight.
     The second rule counts on at most one of the king's own bishops on the colour of those two
     squares (the colour opposite the king's): not on the king squares where it has two or more. *)
  let no_pair = (if count (twins &&& dark) > 1 then ~~~dark else 0L) ||| (if count (twins &&& ~~~dark) > 1 then dark else 0L) in
  let flight = sideways spare ||| north spare ||| south spare |||
               ((north free ||| south free) &&& sideways free &&& ~~~no_pair) in
  (attack &&& reach &&& ~~~flight) <> 0L

(* The families of the open pairs at one level. *)
let families p gaps frozen white =
  let rec split g = if g = 0L then [] else let gap = lowest g in (gap, south gap, north gap) :: split (rest g) in
  let pairs = Array.of_list (split gaps) in   (* per pair: the gap, the white pawn below it, the black pawn above it *)
  let k = Array.length pairs in
  if k > max_pairs then Other
  else begin
    let n = int_of_float (3. ** float_of_int k) in
    let sets = Array.make n None in
    let rec family f =
      if f = n then Lock
      else begin
        (* Family f: digit i (base 3) says what pair i's pawns have done: 0 neither, 1 the white one
           stepped into the gap, 2 the black one did. Its sets start from those of the family it is
           reached from (the same with pair i's pawns in place), minus the gap. *)
        let wp = ref p.white_pawns and bp = ref p.black_pawns and v = ref 0L in
        let start = if f = 0 then [| p.white_king; p.black_king; p.white_king; p.black_king; p.white_bishops; p.black_bishops |]
                    else Array.make 6 0L in
        let q = ref f and pow = ref 1 in
        for i = 0 to k - 1 do
          let d = !q mod 3 and (gap, w, b) = pairs.(i) in
          if d = 0 then v := !v ||| gap   (* the gap stays: a wall for both sides' pawns *)
          else begin
            if d = 1 then wp := (!wp &&& ~~~w) ||| gap else bp := (!bp &&& ~~~b) ||| gap;
            let r = Option.get sets.(f - d * !pow) in
            start.(0) <- start.(0) ||| (r.w_king &&& ~~~gap);
            start.(1) <- start.(1) ||| (r.b_king &&& ~~~gap);
            start.(2) <- start.(2) ||| r.w_take;
            start.(3) <- start.(3) ||| r.b_take;
            start.(4) <- start.(4) ||| (r.w_bish &&& ~~~gap);
            start.(5) <- start.(5) ||| (r.b_bish &&& ~~~gap)
          end;
          q := !q / 3;
          pow := !pow * 3
        done;
        match level ~pawns:(!wp, !bp) ~v:!v ~start p frozen with
        | None -> if f = 0 then Refuted else Other
        | Some s ->
          (* The pairs that stay: both pawns must never move. *)
          let stay = ref true and q = ref f in
          for i = 0 to k - 1 do
            let (_, w, b) = pairs.(i) in
            if !q mod 3 = 0 && ((w &&& ~~~(s.w_fixed)) ||| (b &&& ~~~(s.b_fixed))) <> 0L then stay := false;
            q := !q / 3
          done;
          if not !stay then Other
          else if net_leaks p s white 0L then (if f = 0 then Refuted else Other)
          else begin sets.(f) <- Some s; family (f + 1) end
      end
    in
    family 0
  end

(* The step squares of one side's knights, rooks (and queens: o) and queens. *)
let box_steps knights o queens = sideways o ||| north o ||| south o ||| diagonal queens ||| knight knights

(* With knights, rooks or queens on the board: every one of them must be boxed in by its own pawns
   and pieces; then the levels, with the boxed pieces as walls and no flight onto their squares. *)
let boxed_lock p white wx bx =
  let ws = box_steps p.white_knights (p.white_rooks ||| p.white_queens) p.white_queens in
  let bs = box_steps p.black_knights (p.black_rooks ||| p.black_queens) p.black_queens in
  (ws &&& ~~~(p.white_pawns ||| wx)) = 0L && (bs &&& ~~~(p.black_pawns ||| bx)) = 0L && not p.en_passant &&
  List.exists
    (fun frozen ->
      match level ~wx ~bx ~ws ~bs p frozen with
      | Some s -> not (net_leaks p s white (wx ||| bx))
      | None -> false)
    (levels p)

(* The stuck mater: the flagged side is to move and, whatever it plays, the mater has no legal move
   left (kings and pawns only): the game ends at the mater's turn. *)
let stuck_mater p white =
  if p.white_to_move <> white || p.en_passant then false
  else if (p.white_bishops ||| p.black_bishops ||| p.white_knights ||| p.black_knights ||| p.white_rooks |||
           p.black_rooks ||| p.white_queens ||| p.black_queens) <> 0L then false
  else begin
    let fp, mp = if white then (p.white_pawns, p.black_pawns) else (p.black_pawns, p.white_pawns) in
    let fk, mk = if white then (p.white_king, p.black_king) else (p.black_king, p.white_king) in
    let occ = fp ||| mp ||| fk ||| mk in
    let fwd s = if white then north s else south s in    (* ahead, for the flagged side *)
    let back s = if white then south s else north s in   (* behind *)
    (* A mater's pawn with an empty square ahead is never stuck; then only a stalemate now is left
       to find, which a flagged pawn's push rules out. *)
    if (back mp &&& ~~~occ) <> 0L && (fwd fp &&& ~~~occ) <> 0L then false
    else
      let f_attack = sideways (fwd fp) and m_attack = sideways (back mp) in
      if (f_attack &&& (mp ||| mk)) <> 0L then false                     (* 1. the flagged side has no capture *)
      else begin
        let single = fwd fp &&& ~~~occ in
        let double = fwd (single &&& (if white then rank_3 else rank_6)) &&& ~~~occ in
        let pushes = single ||| double in
        let near = steps mk in
        let king_to = steps fk &&& ~~~fp &&& ~~~m_attack &&& ~~~near in   (* the flagged king's steps now *)
        let in_check = (fk &&& m_attack) <> 0L in
        let stays = pushes <> 0L && not in_check in                     (* a pawn may move instead of the king *)
        if in_check && king_to = 0L then false                          (* mated now *)
        else if king_to = 0L && not stays then true                     (* no move, no check: stalemate now *)
        else begin
          (* The squares next to every square the flagged king may stand on after its move. *)
          let rec cover k c = if k = 0L then c else cover (rest k) (c &&& steps (lowest k)) in
          let cover = cover king_to (if stays then steps fk else -1L) in
          (* 2. the mater's pawns are blocked by men that stay, and attack no flagged pawn *)
          let blockers = fp ||| mp ||| mk ||| (if king_to = 0L then fk else 0L) in
          if ((back mp &&& ~~~blockers) ||| (m_attack &&& fp)) <> 0L then false
          else
            (* 3. every square next to the mater's king: its own pawn, attacked by a flagged pawn that
                  cannot move now, or next to the flagged king wherever it goes *)
            let still = fp &&& back (fwd fp &&& occ) in
            if (near &&& ~~~(mp ||| sideways (fwd still) ||| cover)) <> 0L then false
            else
              (* 4. no push lands where a mater's pawn attacks or next to its king, nor lets it take en passant *)
              ((pushes &&& (m_attack ||| near)) ||| (double &&& sideways mp)) = 0L
        end
      end
  end

(* The forced step: the side to move is in a pawn's check, with kings and pawns only, and its one
   legal move is a step of its king. The position after it, or None. *)
let forced_step p =
  if p.en_passant || (p.white_bishops ||| p.black_bishops ||| p.white_knights ||| p.black_knights |||
                      p.white_rooks ||| p.black_rooks ||| p.white_queens ||| p.black_queens) <> 0L then None
  else begin
    let white = p.white_to_move in
    let k, ek = if white then (p.white_king, p.black_king) else (p.black_king, p.white_king) in
    let own, enemy = if white then (p.white_pawns, p.black_pawns) else (p.black_pawns, p.white_pawns) in
    let checkers = (if white then sideways (north k) else sideways (south k)) &&& enemy in
    let attacked = if white then sideways (south enemy) else sideways (north enemy) in
    let dest = steps k &&& ~~~own &&& ~~~attacked &&& ~~~(steps ek) in
    let takers = (if white then sideways (south checkers) else sideways (north checkers)) &&& own in   (* a pawn may take instead *)
    if checkers = 0L || count dest <> 1 || takers <> 0L then None
    else if white then Some { p with white_king = dest; black_pawns = p.black_pawns &&& ~~~dest; white_to_move = false; en_passant = false }
    else Some { p with black_king = dest; white_pawns = p.white_pawns &&& ~~~dest; white_to_move = true; en_passant = false }
  end

let rec cannot_be_mated p white =
  match forced_step p with
  | Some after -> cannot_be_mated after white
  | None ->
    let wx = p.white_knights ||| p.white_rooks ||| p.white_queens
    and bx = p.black_knights ||| p.black_rooks ||| p.black_queens in
    if (wx ||| bx) <> 0L then boxed_lock p white wx bx
    else if p.en_passant then false
    else begin
      let gaps = north p.white_pawns &&& south p.black_pawns &&& ~~~(p.white_pawns ||| p.black_pawns) in
      List.exists
        (fun frozen ->
          match if gaps <> 0L then families p gaps frozen white else Other with
          | Lock -> true
          | Refuted -> false   (* family A, the level with more walls, leaked: the level leaks too *)
          | Other ->
            (match level ~guard:true p frozen with
             | Some s -> not (net_leaks p s white 0L)
             | None -> false))
        (levels p)
      || stuck_mater p white
    end
