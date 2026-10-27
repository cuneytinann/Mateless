{ Mateless's lock detector, in its simplest form.

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
    Others: QWord;       // knights, rooks and queens of both sides
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
  Rank8 = QWord($FF00000000000000);
  Dark  = QWord($AA55AA55AA55AA55);  // the dark squares; a1 is dark

function North(s: QWord): QWord; begin Result := s shl 8; end;
function South(s: QWord): QWord; begin Result := s shr 8; end;
function Sideways(s: QWord): QWord; begin Result := ((s shl 1) and not FileA) or ((s shr 1) and not FileH); end;
function Zone(s: QWord): QWord; var v: QWord; begin v := s or North(s) or South(s); Result := v or Sideways(v); end;  // s and every square next to it
function Diagonal(s: QWord): QWord; begin Result := Sideways(North(s) or South(s)); end;                            // the squares diagonally next to s
function Count(s: QWord): Integer; begin Result := PopCnt(s); end;

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

function FromFen(const fen: string): TPieces;
var
  p: TPieces;
  rank, fileNo, c, field: Integer;
  sq, target: QWord;
  whiteToMove: Boolean;
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
      else
        p.Others := p.Others or sq;  // N R Q n r q
      end;
    end;
    Inc(c);
  end;
  while (c <= Length(fen)) and (fen[c] = ' ') do Inc(c);
  whiteToMove := (c > Length(fen)) or (fen[c] <> 'b');
  for field := 0 to 1 do  // past the side to move and castling
  begin
    while (c <= Length(fen)) and (fen[c] <> ' ') do Inc(c);
    while (c <= Length(fen)) and (fen[c] = ' ') do Inc(c);
  end;
  if (c + 1 <= Length(fen)) and (fen[c] in ['a'..'h']) and (fen[c + 1] in ['1'..'8']) then
  begin
    target := QWord(1) shl ((Ord(fen[c]) - Ord('a')) + 8 * (Ord(fen[c + 1]) - Ord('1')));
    if whiteToMove then
      p.EnPassant := (Sideways(South(target)) and p.WhitePawns) <> 0
    else
      p.EnPassant := (Sideways(North(target)) and p.BlackPawns) <> 0;
  end;
  Result := p;
end;

{ Two bishops on squares of one colour (only a promotion makes them). }
function TwinBishops(b: QWord): Boolean;
begin
  Result := (Count(b and Dark) > 1) or (Count(b and not Dark) > 1);
end;

function Leaks(const p: TPieces; white: Boolean; frozen: QWord): Boolean; forward;

function CannotBeMated(const p: TPieces; white: Boolean): Boolean;
var
  held: QWord;
  kings: array[0..1] of QWord;
  i: Integer;
begin
  if (p.Others <> 0) or p.EnPassant then Exit(False);
  if TwinBishops(p.WhiteBishops) or TwinBishops(p.BlackBishops) then Exit(False);
  if not Leaks(p, white, 0) then Exit(True);
  // A king may be frozen only if every square around it is held or attacked by a pawn.
  held := p.WhitePawns or p.BlackPawns or Sideways(North(p.WhitePawns) or South(p.BlackPawns));
  kings[0] := p.WhiteKing;
  kings[1] := p.BlackKing;
  for i := 0 to 1 do
    if ((Zone(kings[i]) and not kings[i] and not held) = 0) and not Leaks(p, white, kings[i]) then Exit(True);
  Result := False;
end;

{ Does the structure leak to the king asked about, with the king `frozen` frozen (0: none)? }
function Leaks(const p: TPieces; white: Boolean; frozen: QWord): Boolean;
var
  wp, bp, wk, bk: QWord;
  frozenWhite, frozenBlack: Boolean;
  nearFrozenBlack, nearFrozenWhite: QWord;
  wCone, bCone: QWord;
  wFixed, bFixed: QWord;  // pawns that can never move      (shrink)
  wKing, bKing: QWord;    // squares each king may reach    (grow)
  wTake, bTake: QWord;    // squares where a side may take an enemy pawn (grow)
  wWall, bWall: QWord;    // pawns the other side can never take, and the frozen king
  lastWWall, lastBWall, newWFixed, newBFixed, wMask, bMask, newWKing, newBKing: QWord;
  a, d, t, newBTake, newWTake: QWord;
  changed: Boolean;
  wBish, bBish, open: QWord;
  attack, reach, free, spare, flight: QWord;
begin
  wp := p.WhitePawns; bp := p.BlackPawns; wk := p.WhiteKing; bk := p.BlackKing;
  frozenWhite := (frozen and wk) <> 0;
  frozenBlack := not frozenWhite and (frozen <> 0);
  if frozenBlack then nearFrozenBlack := Zone(bk) else nearFrozenBlack := 0;
  if frozenWhite then nearFrozenWhite := Zone(wk) else nearFrozenWhite := 0;

  // Quick: the pawns' paths against the first walls already show a promotion or a capture.
  wCone := FillNorth(wp, not ((bp and not wk) or frozen));
  bCone := FillSouth(bp, not ((wp and not bk) or frozen));
  if ((wCone and Rank8) or (bCone and Rank1) or (North(Sideways(wCone)) and bCone)) <> 0 then Exit(True);

  // The cycle: walls -> pawns that can never move -> king reaches -> capture squares -> walls.
  wFixed := wp; bFixed := bp;
  wKing := wk; bKing := bk;
  wTake := wk; bTake := bk;
  wWall := not QWord(0); bWall := not QWord(0);
  while True do
  begin
    lastWWall := wWall; lastBWall := bWall;
    wWall := (wp and not bTake) or frozen;
    bWall := (bp and not wTake) or frozen;
    newWFixed := wFixed and wWall and South(bWall or wFixed);
    newBFixed := bFixed and bWall and North(wWall or bFixed);
    if (wWall = lastWWall) and (bWall = lastBWall) and (newWFixed = wFixed) and (newBFixed = bFixed) then
      Break;
    // Both kings' reaches, flooded: never onto a fixed pawn, a square it attacks, or next to
    // the frozen king.
    wMask := not (newWFixed or Sideways(South(newBFixed)) or nearFrozenBlack);
    bMask := not (newBFixed or Sideways(North(newWFixed)) or nearFrozenWhite);
    newWKing := wKing; newBKing := bKing;
    while True do
    begin
      a := newWKing or (Zone(newWKing) and wMask);
      d := newBKing or (Zone(newBKing) and bMask);
      if (a = newWKing) and (d = newBKing) then Break;
      newWKing := a;
      newBKing := d;
    end;
    if (frozenWhite and (newWKing <> wk)) or (frozenBlack and (newBKing <> bk)) then
      Exit(True);  // the frozen king can move
    // A side may take a pawn where its king goes, and on any square a pawn may walk into.
    t := bTake or newBKing;
    newBTake := t or South(FillSouth(t and not bWall, not bWall));
    t := wTake or newWKing;
    newWTake := t or North(FillNorth(t and not wWall, not wWall));
    changed := (newWFixed <> wFixed) or (newBFixed <> bFixed) or (newWKing <> wKing) or
               (newBKing <> bKing) or (newWTake <> wTake) or (newBTake <> bTake);
    wFixed := newWFixed; bFixed := newBFixed; wKing := newWKing; bKing := newBKing;
    wTake := newWTake; bTake := newBTake;
    if not changed then Break;
  end;

  // The pawns' cones: every square they may still reach.
  wCone := FillNorth(wp, not bWall);
  bCone := FillSouth(bp, not wWall);
  if ((wCone and Rank8) or (bCone and Rank1)) <> 0 then Exit(True);  // a pawn can promote
  if (North(Sideways(wCone)) and bCone) <> 0 then Exit(True);        // a pawn can capture
  // The bishops' reaches: every square they may reach, around the fixed pawns.
  wBish := p.WhiteBishops; bBish := p.BlackBishops; open := not (wFixed or bFixed);
  while True do
  begin
    a := wBish or (Diagonal(wBish) and open);
    d := bBish or (Diagonal(bBish) and open);
    if (a = wBish) and (d = bBish) then Break;
    wBish := a;
    bBish := d;
  end;
  if ((Diagonal(wBish) and bCone) or (Diagonal(bBish) and wCone)) <> 0 then Exit(True);  // a bishop meets a pawn's path

  // The mating net: can the other side's pawns and bishops catch the king asked about?
  if white then
  begin
    attack := Diagonal(bBish) or Sideways(South(bCone));
    reach := wKing;
    free := not (wCone or Zone(bKing) or attack);  // never occupied, attacked or next to the mater
    spare := free and not wBish;                   // ... nor reached by the king's own bishops
  end
  else
  begin
    attack := Diagonal(wBish) or Sideways(North(wCone));
    reach := bKing;
    free := not (bCone or Zone(wKing) or attack);
    spare := free and not bBish;
  end;
  // A king next to a spare square, or with free squares beside it both ways, always has a flight.
  flight := Sideways(spare) or North(spare) or South(spare) or ((North(free) or South(free)) and Sideways(free));
  Result := (attack and reach and not flight) <> 0;
end;

end.
