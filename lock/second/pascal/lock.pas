{ Mateless's lock detector, second version, in its simplest form.

  Can a side never be mated? The lock detector answers yes when pawns, kings and bishops (and
  knights, rooks or queens boxed in by their own men) form a structure that no series of legal
  moves can open (FIDE 5.2.2 dead position, 6.9 flag fall). It reads bitboards and the side to
  move: it generates no move and searches nothing.

  The first version (../../pascal/lock.pas) grows each king's reach, the pawns that can never move,
  and the squares where each side may take a pawn, until nothing changes; the structure leaks if a
  pawn can promote or capture, a frozen king can move, a bishop can reach a pawn's path, or the
  king asked about can reach a square the other side attacks without a sure flight. This version
  keeps all of it and adds, each only where its situation is on the board:
    - open pawn pairs: a white and a black pawn on one file with one empty square between them;
      the reachable positions split into families by what the pair's pawns have done (neither
      moved, the white one stepped into the gap, the black one did), up to 3 pairs;
    - boxed knights, rooks and queens: a piece whose every step square holds one of its own men
      that never moves, and that no enemy king or bishop reaches, never moves nor falls;
    - twin bishops: two bishops of one side on one colour no longer fail it; the mating net leaves
      out its second flight rule where they may hold both flights;
    - the stalemate guard: a pawn the enemy king may take stays a wall if taking it always
      stalemates its owner;
    - the check seed: a king in a pawn's check starts its reach from the squares it can step to;
    - the stuck mater: whatever the flagged side plays, the mater is left without a move;
    - the forced step: a king in a pawn's check with one legal move, a step: the lock of the
      position after it.
  A possible en passant capture fails it at once. Sound, not complete: a structure it passes can
  never be opened; one it fails may still be dead.

  Squares: a1 = 0, b1 = 1, ..., h8 = 63. A set of squares (a bitboard) is a QWord. }
unit Lock;

{$mode objfpc}{$H+}

interface

type
  { What the lock detector reads from a position. }
  TPieces = record
    WhitePawns, BlackPawns: QWord;
    WhiteKing, BlackKing: QWord;
    WhiteBishops, BlackBishops: QWord;
    WhiteKnights, BlackKnights: QWord;
    WhiteRooks, BlackRooks: QWord;
    WhiteQueens, BlackQueens: QWord;
    WhiteToMove: Boolean;
    EnPassant: Boolean;  // the side to move can capture en passant
  end;

{ The pieces of a FEN. The en passant square counts only if a pawn can capture onto it. }
function FromFen(const fen: string): TPieces;

{ Can White (white = True) or Black never be mated, by the lock detector? }
function CannotBeMated(const p: TPieces; white: Boolean): Boolean;

implementation

const
  FileA = QWord($0101010101010101);
  FileH = QWord($8080808080808080);
  Rank1 = QWord($00000000000000FF);
  Rank3 = QWord($0000000000FF0000);
  Rank6 = QWord($0000FF0000000000);
  Rank8 = QWord($FF00000000000000);
  FileAB = QWord($0303030303030303);
  FileGH = QWord($C0C0C0C0C0C0C0C0);
  Dark  = QWord($AA55AA55AA55AA55);  // the dark squares; a1 is dark
  MaxPairs = 3;                      // the most open pairs the families are split on (3^3 = 27)

type
  { What one level leaves for the mating net (and for the families after it). }
  TSets = record
    WCone, BCone, WFixed, BFixed, WKing, BKing, WBish, BBish, WTake, BTake: QWord;
  end;

  { The inputs of a level beyond the position: see Level. }
  TLevel = record
    Family: Boolean;               // Wp, Bp and Start below are a family's
    Wp, Bp, V: QWord;
    Start: array[0..5] of QWord;
    Wx, Bx, Ws, Bs: QWord;
    Guard: Boolean;
  end;

  { What the families of the open pairs say at one level. }
  TFamily = (famLock,      // none of them leaks to the king asked about
             famRefuted,   // family A (no pair's pawn has moved) leaks to it
             famNone);     // another family leaks

function North(s: QWord): QWord; begin Result := s shl 8; end;
function South(s: QWord): QWord; begin Result := s shr 8; end;
function Sideways(s: QWord): QWord; begin Result := ((s shl 1) and not FileA) or ((s shr 1) and not FileH); end;
function Zone(s: QWord): QWord; var v: QWord; begin v := s or North(s) or South(s); Result := v or Sideways(v); end;  // s and every square next to it
function Steps(s: QWord): QWord; begin Result := Zone(s) and not s; end;                                            // the squares next to s
function Diagonal(s: QWord): QWord; begin Result := Sideways(North(s) or South(s)); end;                            // the squares diagonally next to s
function Count(s: QWord): Integer; begin Result := PopCnt(s); end;
function Lowest(s: QWord): QWord; begin Result := s and (not s + 1); end;                                           // the lowest square of s

{ The squares a knight on s goes to. }
function Knight(s: QWord): QWord;
var one, two: QWord;
begin
  one := Sideways(s);
  two := ((s shl 2) and not FileAB) or ((s shr 2) and not FileGH);
  Result := North(North(one)) or South(South(one)) or North(two) or South(two);
end;

{ Every square reachable from g by steps north through squares of p. }
function FillNorth(g, p: QWord): QWord;
begin
  g := g or (p and (g shl 8));
  p := p and (p shl 8);
  g := g or (p and (g shl 16));
  p := p and (p shl 16);
  Result := g or (p and (g shl 32));
end;

{ Every square reachable from g by steps south through squares of p. }
function FillSouth(g, p: QWord): QWord;
begin
  g := g or (p and (g shr 8));
  p := p and (p shr 8);
  g := g or (p and (g shr 16));
  p := p and (p shr 16);
  Result := g or (p and (g shr 32));
end;

{ Every square a king may reach from k through squares of m. }
function Flood(k, m: QWord): QWord;
var a: QWord;
begin
  repeat
    a := k or (Zone(k) and m);
    if a = k then Break;
    k := a;
  until False;
  Result := k;
end;

function FromFen(const fen: string): TPieces;
var
  p: TPieces;
  rank, fileNo, c, field: Integer;
  sq, target: QWord;
begin
  p := Default(TPieces);
  rank := 7;
  fileNo := 0;
  c := 1;
  while (c <= Length(fen)) and (fen[c] <> ' ') do
  begin
    if fen[c] = '/' then
    begin
      Dec(rank);
      fileNo := 0;
    end
    else if fen[c] in ['1'..'8'] then
      Inc(fileNo, Ord(fen[c]) - Ord('0'))
    else
    begin
      sq := QWord(1) shl (8 * rank + fileNo);
      Inc(fileNo);
      case fen[c] of
        'P': p.WhitePawns := p.WhitePawns or sq;
        'p': p.BlackPawns := p.BlackPawns or sq;
        'K': p.WhiteKing := p.WhiteKing or sq;
        'k': p.BlackKing := p.BlackKing or sq;
        'B': p.WhiteBishops := p.WhiteBishops or sq;
        'b': p.BlackBishops := p.BlackBishops or sq;
        'N': p.WhiteKnights := p.WhiteKnights or sq;
        'n': p.BlackKnights := p.BlackKnights or sq;
        'R': p.WhiteRooks := p.WhiteRooks or sq;
        'r': p.BlackRooks := p.BlackRooks or sq;
        'Q': p.WhiteQueens := p.WhiteQueens or sq;
      else
        p.BlackQueens := p.BlackQueens or sq;  // q
      end;
    end;
    Inc(c);
  end;
  while (c <= Length(fen)) and (fen[c] = ' ') do Inc(c);
  p.WhiteToMove := (c > Length(fen)) or (fen[c] <> 'b');
  for field := 0 to 1 do  // past the side to move and castling
  begin
    while (c <= Length(fen)) and (fen[c] <> ' ') do Inc(c);
    while (c <= Length(fen)) and (fen[c] = ' ') do Inc(c);
  end;
  if (c + 1 <= Length(fen)) and (fen[c] in ['a'..'h']) and (fen[c + 1] in ['1'..'8']) then
  begin
    target := QWord(1) shl ((Ord(fen[c]) - Ord('a')) + 8 * (Ord(fen[c + 1]) - Ord('1')));
    if p.WhiteToMove then
      p.EnPassant := (Sideways(South(target)) and p.WhitePawns) <> 0
    else
      p.EnPassant := (Sideways(North(target)) and p.BlackPawns) <> 0;
  end;
  Result := p;
end;

{ The levels: both kings free (0), then each king frozen on its square (a wall for both sides)
  when every square around it is held or attacked by a pawn. Their number. }
function Levels(const p: TPieces; out lv: array of QWord): Integer;
var held: QWord;
begin
  held := p.WhitePawns or p.BlackPawns or Sideways(North(p.WhitePawns) or South(p.BlackPawns));
  Result := 0;
  lv[Result] := 0;
  Inc(Result);
  if (Steps(p.WhiteKing) and not held) = 0 then begin lv[Result] := p.WhiteKing; Inc(Result); end;
  if (Steps(p.BlackKing) and not held) = 0 then begin lv[Result] := p.BlackKing; Inc(Result); end;
end;

{ The check seed: the side to move is in a pawn's check, so its king must step now, to a square it
  can step to (not its own pawn, not a square an enemy pawn attacks, not next to the enemy king);
  its reach starts there. Not when it has no such square (that may be a mate now), when one of its
  pawns can take a checking pawn, or with a bishop on the board. The kings' starting sets. }
procedure CheckSeed(const p: TPieces; out wSeed, bSeed: QWord);
var k, own, checkers, attacked, toSq, takers: QWord;
    white: Boolean;
begin
  wSeed := p.WhiteKing;
  bSeed := p.BlackKing;
  if (p.WhiteBishops or p.BlackBishops) <> 0 then Exit;
  white := p.WhiteToMove;
  if white then begin k := p.WhiteKing; own := p.WhitePawns; checkers := Sideways(North(k)) and p.BlackPawns; end
  else begin k := p.BlackKing; own := p.BlackPawns; checkers := Sideways(South(k)) and p.WhitePawns; end;
  if checkers = 0 then Exit;
  if white then begin
    attacked := Sideways(South(p.BlackPawns));
    toSq := Steps(k) and not own and not attacked and not Steps(p.BlackKing);
    takers := Sideways(South(checkers)) and own;
  end else begin
    attacked := Sideways(North(p.WhitePawns));
    toSq := Steps(k) and not own and not attacked and not Steps(p.WhiteKing);
    takers := Sideways(North(checkers)) and own;
  end;
  if (toSq = 0) or (takers <> 0) then Exit;
  if white then wSeed := toSq else bSeed := toSq;
end;

{ Does a diagonal line from the square king, stopped by block, meet a square of o? }
function RayMeets(king, block, o: QWord): Boolean;
const DF: array[0..3] of Integer = (-1, 1, -1, 1);
      DR: array[0..3] of Integer = (-1, -1, 1, 1);
var sq, d, f, r: Integer;
    s: QWord;
begin
  sq := BsfQWord(king);
  for d := 0 to 3 do
  begin
    f := (sq and 7) + DF[d];
    r := (sq shr 3) + DR[d];
    while (f >= 0) and (f < 8) and (r >= 0) and (r < 8) do
    begin
      s := QWord(1) shl (8 * r + f);
      if (o and s) <> 0 then Exit(True);
      if (block and s) <> 0 then Break;
      Inc(f, DF[d]);
      Inc(r, DR[d]);
    end;
  end;
  Result := False;
end;

{ The stalemate guard: of the owner's fixed pawns cand (which the enemy king may take), those whose
  capture always stalemates the owner. The owner must have nothing else that moves (every other
  pawn fixed; no bishop, which the caller sees to). reach: where the owner's king may stand; shut:
  squares it can never step to (own fixed pawns, squares the enemy's fixed pawns attack);
  enemyKing: the enemy king's reach; block: squares a bishop's line never crosses. }
function StalemateGuard(cand, own, ownFixed, reach, shut, enemyKing: QWord; enemyBishops: Boolean; block: QWord): QWord;
var c, pawn, nearSq, from, x, k, king: QWord;
    held: Boolean;
begin
  Result := 0;
  if (own and not ownFixed) <> 0 then Exit;
  c := cand;
  while c <> 0 do
  begin
    pawn := Lowest(c);
    c := c and (c - 1);
    nearSq := Steps(pawn);
    from := nearSq and enemyKing;    // where the enemy king takes from
    x := shut or nearSq or pawn;     // after the capture, the owner's king may not step there
    held := True;
    k := reach and not (nearSq or pawn);   // the owner's king, not defending the pawn
    while k <> 0 do
    begin
      king := Lowest(k);
      k := k and (k - 1);
      if ((Steps(king) and not x) <> 0) or (enemyBishops and RayMeets(king, block or pawn, from)) then
      begin
        held := False;             // it has a square to step to, or the capture uncovers a check
        Break;
      end;
    end;
    if held then Result := Result or pawn;
  end;
end;

{ One level: the fixed point of the walls, the pawns that can never move, the kings' reaches, the
  squares where each side may take a pawn, the pawns' cones and the bishops' reaches. False when the
  structure leaks whichever side is asked about; otherwise True, and in s the sets the mating net
  reads. o.Family: o.Wp, Bp are the pawns (a family has a pair's pawn moved into its gap) and
  o.Start where the kings' reaches, capture squares and bishops' reaches start; o.V: walls for both
  sides (the gaps of a family's pairs that stay); o.Wx, Bx, Ws, Bs: the boxed pieces' candidates and
  their step squares; o.Guard: the stalemate guard and the check seed (plain levels only). }
function Level(const p: TPieces; frozen: QWord; const o: TLevel; out s: TSets): Boolean;
var
  wp, bp, wk, bk, wx, bx, v, nearFrozenBlack, nearFrozenWhite, wSeed, bSeed: QWord;
  wKing, bKing, wTake, bTake, wBish, bBish, wCone, bCone, wFixed, bFixed, wGuard, bGuard: QWord;
  boxed, wWall, bWall, nwFixed, nbFixed, nwCone, nbCone, bHit, wHit, nwKing, nbKing: QWord;
  nwBish, nbBish, open, a, d, t, nbTake, nwTake, nwGuard, nbGuard, blk: QWord;
  frozenWhite, frozenBlack, changed: Boolean;
begin
  s := Default(TSets);
  if o.Family then begin wp := o.Wp; bp := o.Bp; end
  else begin wp := p.WhitePawns; bp := p.BlackPawns; end;
  wk := p.WhiteKing; bk := p.BlackKing; wx := o.Wx; bx := o.Bx; v := o.V or frozen;
  frozenWhite := (frozen and wk) <> 0;
  frozenBlack := (not frozenWhite) and (frozen <> 0);
  if frozenBlack then nearFrozenBlack := Zone(bk) else nearFrozenBlack := 0;
  if frozenWhite then nearFrozenWhite := Zone(wk) else nearFrozenWhite := 0;
  wSeed := wk; bSeed := bk;
  if o.Guard and (frozen = 0) then CheckSeed(p, wSeed, bSeed);
  if o.Family then
  begin
    wKing := o.Start[0]; bKing := o.Start[1]; wTake := o.Start[2]; bTake := o.Start[3];
    wBish := o.Start[4]; bBish := o.Start[5];
  end else begin
    wKing := wSeed; bKing := bSeed; wTake := wSeed; bTake := bSeed;
    wBish := p.WhiteBishops; bBish := p.BlackBishops;
  end;
  wCone := wp; bCone := bp; wFixed := wp; bFixed := bp;
  if o.Guard then wGuard := not QWord(0) else wGuard := 0;   // nothing is taken yet
  bGuard := wGuard;
  repeat
    // Boxed: the pieces no enemy king or bishop reaches. Walls: pawns the other side can never
    // take (or whose capture stalemates their owner), the frozen king, the gaps, boxed pieces.
    boxed := (wx and not (bKing or bBish)) or (bx and not (wKing or wBish));
    wWall := (wp and not (bTake and not wGuard)) or v or boxed;
    bWall := (bp and not (wTake and not bGuard)) or v or boxed;
    nwFixed := wFixed and wWall and South(bWall or wFixed);
    nbFixed := bFixed and bWall and North(wWall or bFixed);
    nwCone := FillNorth(wCone, not bWall);
    nbCone := FillSouth(bCone, not wWall);
    // The kings: never onto a fixed pawn, a square it attacks, or next to the frozen king.
    bHit := Sideways(South(nbFixed));
    wHit := Sideways(North(nwFixed));
    nwKing := Flood(wKing, not (nwFixed or bHit or nearFrozenBlack));
    nbKing := Flood(bKing, not (nbFixed or wHit or nearFrozenWhite));
    nwBish := wBish; nbBish := bBish;
    open := not (nwFixed or nbFixed);
    repeat
      a := nwBish or (Diagonal(nwBish) and open);
      d := nbBish or (Diagonal(nbBish) and open);
      if (a = nwBish) and (d = nbBish) then Break;
      nwBish := a;
      nbBish := d;
    until False;
    // A side may take a pawn where its king goes, and on any square a pawn may walk into.
    t := bTake or nbKing;
    nbTake := t or South(FillSouth(t and not bWall, not bWall));
    t := wTake or nwKing;
    nwTake := t or North(FillNorth(t and not wWall, not wWall));
    nwGuard := wGuard; nbGuard := bGuard;
    if o.Guard then
    begin
      blk := nwFixed or nbFixed;
      if p.WhiteBishops <> 0 then nwGuard := 0
      else nwGuard := StalemateGuard(wp and nbTake and nwFixed, wp, nwFixed, nwKing, nwFixed or bHit, nbKing, p.BlackBishops <> 0, blk);
      if p.BlackBishops <> 0 then nbGuard := 0
      else nbGuard := StalemateGuard(bp and nwTake and nbFixed, bp, nbFixed, nbKing, nbFixed or wHit, nwKing, p.WhiteBishops <> 0, blk);
    end;
    changed := (nwCone <> wCone) or (nbCone <> bCone) or (nwFixed <> wFixed) or (nbFixed <> bFixed) or
               (nwKing <> wKing) or (nbKing <> bKing) or (nwBish <> wBish) or (nbBish <> bBish) or
               (nwTake <> wTake) or (nbTake <> bTake) or (nwGuard <> wGuard) or (nbGuard <> bGuard);
    wCone := nwCone; bCone := nbCone; wFixed := nwFixed; bFixed := nbFixed; wKing := nwKing; bKing := nbKing;
    wBish := nwBish; bBish := nbBish; wTake := nwTake; bTake := nbTake; wGuard := nwGuard; bGuard := nbGuard;
  until not changed;
  boxed := (wx and not (bKing or bBish)) or (bx and not (wKing or wBish));
  Result := False;
  if ((wCone and Rank8) or (bCone and Rank1)) <> 0 then Exit;                                  // a pawn can promote
  if ((North(Sideways(wCone)) and (bCone or bx)) or (South(Sideways(bCone)) and wx)) <> 0 then Exit;  // a pawn can capture
  if (frozenWhite and (wKing <> wk)) or (frozenBlack and (bKing <> bk)) then Exit;             // the frozen king can move
  if ((Diagonal(wBish) and bCone) or (Diagonal(bBish) and wCone)) <> 0 then Exit;              // a bishop meets a pawn's path
  if ((o.Ws and not (wFixed or (wx and boxed))) or (o.Bs and not (bFixed or (bx and boxed)))) <> 0 then Exit;  // a piece may step
  if (wGuard or bGuard) <> 0 then
  begin
    // A king that takes a guarded pawn ends the game: for the mating net, the kings' reaches
    // again, now stopping at the enemy's guarded pawns.
    wKing := Flood(wSeed, not (wFixed or Sideways(South(bFixed)) or nearFrozenBlack or (bp and bGuard)));
    bKing := Flood(bSeed, not (bFixed or Sideways(North(wFixed)) or nearFrozenWhite or (wp and wGuard)));
  end;
  s.WCone := wCone; s.BCone := bCone; s.WFixed := wFixed; s.BFixed := bFixed; s.WKing := wKing; s.BKing := bKing;
  s.WBish := wBish; s.BBish := bBish; s.WTake := wTake; s.BTake := bTake;
  Result := True;
end;

{ The mating net: can the other side's pawns and bishops catch the king asked about? occ: squares
  that stand occupied for good besides (the boxed pieces'). }
function NetLeaks(const p: TPieces; const s: TSets; white: Boolean; occ: QWord): Boolean;
var attack, reach, free, spare, twins, noPair, flight: QWord;
begin
  if white then
  begin
    attack := Diagonal(s.BBish) or Sideways(South(s.BCone));
    reach := s.WKing;
    free := not (s.WCone or occ or Zone(s.BKing) or attack);   // never occupied, attacked or next to the mater
    spare := free and not s.WBish;                             // ... nor reached by the king's own bishops
    twins := p.WhiteBishops;
  end else begin
    attack := Diagonal(s.WBish) or Sideways(North(s.WCone));
    reach := s.BKing;
    free := not (s.BCone or occ or Zone(s.WKing) or attack);
    spare := free and not s.BBish;
    twins := p.BlackBishops;
  end;
  // A king next to a spare square, or with free squares beside it both ways, always has a flight.
  // The second rule counts on at most one of the king's own bishops on the colour of those two
  // squares (the colour opposite the king's): not on the king squares where it has two or more.
  noPair := 0;
  if Count(twins and Dark) > 1 then noPair := noPair or not Dark;
  if Count(twins and not Dark) > 1 then noPair := noPair or Dark;
  flight := Sideways(spare) or North(spare) or South(spare) or
            ((North(free) or South(free)) and Sideways(free) and not noPair);
  Result := (attack and reach and not flight) <> 0;
end;

{ The families of the open pairs at one level. }
function Families(const p: TPieces; gaps, frozen: QWord; white: Boolean): TFamily;
var
  pairs: array[0..MaxPairs - 1, 0..2] of QWord;   // per pair: the gap, the white pawn below it, the black pawn above it
  sets: array[0..26] of TSets;
  o: TLevel;
  s: TSets;
  g, gap: QWord;
  k, n, f, i, q, pw, d: Integer;
begin
  for i := 0 to 26 do sets[i] := Default(TSets);
  k := 0;
  g := gaps;
  while g <> 0 do
  begin
    if k = MaxPairs then Exit(famNone);
    gap := Lowest(g);
    g := g and (g - 1);
    pairs[k, 0] := gap; pairs[k, 1] := South(gap); pairs[k, 2] := North(gap);
    Inc(k);
  end;
  n := 1;
  for i := 1 to k do n := n * 3;
  for f := 0 to n - 1 do
  begin
    // Family f: digit i (base 3) says what pair i's pawns have done: 0 neither, 1 the white one
    // stepped into the gap, 2 the black one did. Its sets start from those of the family it is
    // reached from (the same with pair i's pawns in place), minus the gap.
    o := Default(TLevel);
    o.Family := True;
    o.Wp := p.WhitePawns; o.Bp := p.BlackPawns;
    if f = 0 then
    begin
      o.Start[0] := p.WhiteKing; o.Start[1] := p.BlackKing; o.Start[2] := p.WhiteKing; o.Start[3] := p.BlackKing;
      o.Start[4] := p.WhiteBishops; o.Start[5] := p.BlackBishops;
    end;
    q := f;
    pw := 1;
    for i := 0 to k - 1 do
    begin
      d := q mod 3;
      gap := pairs[i, 0];
      if d = 0 then
        o.V := o.V or gap   // the gap stays: a wall for both sides' pawns
      else
      begin
        if d = 1 then o.Wp := (o.Wp and not pairs[i, 1]) or gap else o.Bp := (o.Bp and not pairs[i, 2]) or gap;
        with sets[f - d * pw] do
        begin
          o.Start[0] := o.Start[0] or (WKing and not gap);
          o.Start[1] := o.Start[1] or (BKing and not gap);
          o.Start[2] := o.Start[2] or WTake;
          o.Start[3] := o.Start[3] or BTake;
          o.Start[4] := o.Start[4] or (WBish and not gap);
          o.Start[5] := o.Start[5] or (BBish and not gap);
        end;
      end;
      q := q div 3;
      pw := pw * 3;
    end;
    if not Level(p, frozen, o, s) then
      if f = 0 then Exit(famRefuted) else Exit(famNone);
    // The pairs that stay: both pawns must never move.
    q := f;
    for i := 0 to k - 1 do
    begin
      if (q mod 3 = 0) and (((pairs[i, 1] and not s.WFixed) or (pairs[i, 2] and not s.BFixed)) <> 0) then Exit(famNone);
      q := q div 3;
    end;
    if NetLeaks(p, s, white, 0) then
      if f = 0 then Exit(famRefuted) else Exit(famNone);
    sets[f] := s;
  end;
  Result := famLock;
end;

{ The step squares of one side's knights, rooks (and queens: o) and queens. }
function BoxSteps(knights, o, queens: QWord): QWord;
begin
  Result := Sideways(o) or North(o) or South(o) or Diagonal(queens) or Knight(knights);
end;

{ With knights, rooks or queens on the board: every one of them must be boxed in by its own pawns
  and pieces; then the levels, with the boxed pieces as walls and no flight onto their squares. }
function BoxedLock(const p: TPieces; white: Boolean; wx, bx: QWord): Boolean;
var ws, bs: QWord;
    lv: array[0..2] of QWord;
    n, i: Integer;
    o: TLevel;
    s: TSets;
begin
  Result := False;
  ws := BoxSteps(p.WhiteKnights, p.WhiteRooks or p.WhiteQueens, p.WhiteQueens);
  bs := BoxSteps(p.BlackKnights, p.BlackRooks or p.BlackQueens, p.BlackQueens);
  if ((ws and not (p.WhitePawns or wx)) <> 0) or ((bs and not (p.BlackPawns or bx)) <> 0) or p.EnPassant then Exit;
  o := Default(TLevel);
  o.Wx := wx; o.Bx := bx; o.Ws := ws; o.Bs := bs;
  n := Levels(p, lv);
  for i := 0 to n - 1 do
    if Level(p, lv[i], o, s) and not NetLeaks(p, s, white, wx or bx) then Exit(True);
end;

{ Ahead and behind, for the flagged side (White's pawns go north). }
function Fwd(white: Boolean; s: QWord): QWord; begin if white then Result := North(s) else Result := South(s); end;
function Back(white: Boolean; s: QWord): QWord; begin if white then Result := South(s) else Result := North(s); end;

{ The stuck mater: the flagged side is to move and, whatever it plays, the mater has no legal move
  left (kings and pawns only): the game ends at the mater's turn. }
function StuckMater(const p: TPieces; white: Boolean): Boolean;
var fp, mp, fk, mk, occ, fAttack, mAttack, onePush, twoPush, pushes, nearSq, kingTo, cover, k, blockers, still, rank: QWord;
    inCheck, stays: Boolean;
begin
  Result := False;
  if (p.WhiteToMove <> white) or p.EnPassant then Exit;
  if (p.WhiteBishops or p.BlackBishops or p.WhiteKnights or p.BlackKnights or p.WhiteRooks or
      p.BlackRooks or p.WhiteQueens or p.BlackQueens) <> 0 then Exit;
  if white then begin fp := p.WhitePawns; mp := p.BlackPawns; fk := p.WhiteKing; mk := p.BlackKing; rank := Rank3; end
  else begin fp := p.BlackPawns; mp := p.WhitePawns; fk := p.BlackKing; mk := p.WhiteKing; rank := Rank6; end;
  occ := fp or mp or fk or mk;
  // A mater's pawn with an empty square ahead is never stuck; then only a stalemate now is left to
  // find, which a flagged pawn's push rules out.
  if ((Back(white, mp) and not occ) <> 0) and ((Fwd(white, fp) and not occ) <> 0) then Exit;
  fAttack := Sideways(Fwd(white, fp));
  mAttack := Sideways(Back(white, mp));
  if (fAttack and (mp or mk)) <> 0 then Exit;                      // 1. the flagged side has no capture
  onePush := Fwd(white, fp) and not occ;
  twoPush := Fwd(white, onePush and rank) and not occ;
  pushes := onePush or twoPush;
  nearSq := Steps(mk);
  kingTo := Steps(fk) and not fp and not mAttack and not nearSq;     // the flagged king's steps now
  inCheck := (fk and mAttack) <> 0;
  if inCheck and (kingTo = 0) then Exit;                           // mated now
  stays := (pushes <> 0) and not inCheck;                          // a pawn may move instead of the king
  if (kingTo = 0) and not stays then Exit(True);                   // no move, no check: stalemate now
  // The squares next to every square the flagged king may stand on after its move.
  if stays then cover := Steps(fk) else cover := not QWord(0);
  k := kingTo;
  while k <> 0 do
  begin
    cover := cover and Steps(Lowest(k));
    k := k and (k - 1);
  end;
  // 2. the mater's pawns are blocked by men that stay, and attack no flagged pawn
  blockers := fp or mp or mk;
  if kingTo = 0 then blockers := blockers or fk;
  if ((Back(white, mp) and not blockers) or (mAttack and fp)) <> 0 then Exit;
  // 3. every square next to the mater's king: its own pawn, attacked by a flagged pawn that cannot
  //    move now, or next to the flagged king wherever it goes
  still := fp and Back(white, Fwd(white, fp) and occ);
  if (nearSq and not (mp or Sideways(Fwd(white, still)) or cover)) <> 0 then Exit;
  // 4. no push lands where a mater's pawn attacks or next to its king, nor lets it take en passant
  Result := ((pushes and (mAttack or nearSq)) or (twoPush and Sideways(mp))) = 0;
end;

{ The forced step: the side to move is in a pawn's check, with kings and pawns only, and its one
  legal move is a step of its king. True, and in after the position after it, or False. }
function ForcedStep(const p: TPieces; out after: TPieces): Boolean;
var k, ek, own, enemy, checkers, attacked, toSq, takers: QWord;
    white: Boolean;
begin
  after := p;
  Result := False;
  if p.EnPassant or ((p.WhiteBishops or p.BlackBishops or p.WhiteKnights or p.BlackKnights or
                      p.WhiteRooks or p.BlackRooks or p.WhiteQueens or p.BlackQueens) <> 0) then Exit;
  white := p.WhiteToMove;
  if white then
  begin
    k := p.WhiteKing; ek := p.BlackKing; own := p.WhitePawns; enemy := p.BlackPawns;
    checkers := Sideways(North(k)) and enemy;
    attacked := Sideways(South(enemy));
  end else begin
    k := p.BlackKing; ek := p.WhiteKing; own := p.BlackPawns; enemy := p.WhitePawns;
    checkers := Sideways(South(k)) and enemy;
    attacked := Sideways(North(enemy));
  end;
  if checkers = 0 then Exit;
  toSq := Steps(k) and not own and not attacked and not Steps(ek);
  if Count(toSq) <> 1 then Exit;
  if white then takers := Sideways(South(checkers)) and own else takers := Sideways(North(checkers)) and own;
  if takers <> 0 then Exit;   // a pawn may take instead
  after.WhiteToMove := not white;
  after.EnPassant := False;
  if white then
  begin
    after.WhiteKing := toSq;
    after.BlackPawns := p.BlackPawns and not toSq;
  end else begin
    after.BlackKing := toSq;
    after.WhitePawns := p.WhitePawns and not toSq;
  end;
  Result := True;
end;

function CannotBeMated(const p: TPieces; white: Boolean): Boolean;
var after: TPieces;
    wx, bx, gaps: QWord;
    lv: array[0..2] of QWord;
    n, i: Integer;
    f: TFamily;
    o: TLevel;
    s: TSets;
begin
  if ForcedStep(p, after) then Exit(CannotBeMated(after, white));
  wx := p.WhiteKnights or p.WhiteRooks or p.WhiteQueens;
  bx := p.BlackKnights or p.BlackRooks or p.BlackQueens;
  if (wx or bx) <> 0 then Exit(BoxedLock(p, white, wx, bx));
  if p.EnPassant then Exit(False);
  gaps := North(p.WhitePawns) and South(p.BlackPawns) and not (p.WhitePawns or p.BlackPawns);
  o := Default(TLevel);
  o.Guard := True;
  n := Levels(p, lv);
  for i := 0 to n - 1 do
  begin
    if gaps <> 0 then
    begin
      f := Families(p, gaps, lv[i], white);
      if f = famLock then Exit(True);
      if f = famRefuted then Continue;   // family A, the level with more walls, leaked: the level leaks too
    end;
    if Level(p, lv[i], o, s) and not NetLeaks(p, s, white, 0) then Exit(True);
  end;
  Result := StuckMater(p, white);
end;

end.
