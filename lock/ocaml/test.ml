(* Tests lock.ml on ../positions.tsv:  ocamlopt -o test lock.mli lock.ml test.ml && ./test [positions.tsv] *)

let () =
  let path = if Array.length Sys.argv > 1 then Sys.argv.(1) else "../positions.tsv" in
  let ic = open_in path in
  let n = ref 0 and bad = ref 0 in
  let check line =
    if line <> "" && line.[0] <> '#' then
      match String.split_on_char '\t' line with
      | fen :: white :: black :: _ ->
        let p = Lock.from_fen fen in
        let w = Lock.cannot_be_mated p true and b = Lock.cannot_be_mated p false in
        if w <> (white = "1") || b <> (black = "1") then begin
          incr bad;
          if !bad <= 10 then
            Printf.printf "wrong: %s expected %s %s got %d %d\n" fen white black (Bool.to_int w) (Bool.to_int b)
        end;
        incr n
      | _ -> ()
  in
  let rec loop () =
    match input_line ic with
    | line -> check line; loop ()
    | exception End_of_file -> ()
  in
  loop ();
  close_in ic;
  Printf.printf "ocaml: %d positions, %d wrong\n" !n !bad;
  exit (if !bad > 0 then 1 else 0)
