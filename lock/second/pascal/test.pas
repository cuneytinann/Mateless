{ Tests lock.pas on ../positions.tsv:  fpc -O2 -vw test.pas && ./test [positions.tsv] }
program Test;

{$mode objfpc}{$H+}

uses
  Lock;

var
  path, line, fen: string;
  f: TextFile;
  tab, n, bad: Integer;
  white, black, w, b: Boolean;
  p: TPieces;
begin
  if ParamCount > 0 then path := ParamStr(1) else path := '../positions.tsv';
  AssignFile(f, path);
  Reset(f);
  n := 0;
  bad := 0;
  while not Eof(f) do
  begin
    ReadLn(f, line);
    if (line = '') or (line[1] = '#') then Continue;
    tab := Pos(#9, line);
    if tab = 0 then Continue;
    fen := Copy(line, 1, tab - 1);
    white := line[tab + 1] = '1';
    black := line[tab + 3] = '1';
    p := FromFen(fen);
    w := CannotBeMated(p, True);
    b := CannotBeMated(p, False);
    if (w <> white) or (b <> black) then
    begin
      Inc(bad);
      if bad <= 10 then
        WriteLn('wrong: ', fen, ' expected ', Ord(white), ' ', Ord(black), ' got ', Ord(w), ' ', Ord(b));
    end;
    Inc(n);
  end;
  CloseFile(f);
  WriteLn('pascal: ', n, ' positions, ', bad, ' wrong');
  if bad > 0 then Halt(1);
end.
