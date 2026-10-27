// Tests Lock.cs on ../positions.tsv:  dotnet run -c Release -- [positions.tsv]
using System;
using System.IO;
using Mateless;

string path = args.Length > 0 ? args[0] : "../positions.tsv";
int n = 0, bad = 0;
foreach (string line in File.ReadLines(path))
{
    if (line.StartsWith('#') || line.Length == 0) continue;
    int tab = line.IndexOf('\t');
    if (tab < 0) continue;
    string fen = line[..tab];
    bool white = line[tab + 1] == '1', black = line[tab + 3] == '1';
    Pieces p = Lock.FromFen(fen);
    bool w = Lock.CannotBeMated(p, true), b = Lock.CannotBeMated(p, false);
    if (w != white || b != black)
    {
        if (++bad <= 10)
            Console.WriteLine($"wrong: {fen} expected {(white ? 1 : 0)} {(black ? 1 : 0)} got {(w ? 1 : 0)} {(b ? 1 : 0)}");
    }
    n++;
}
Console.WriteLine($"csharp: {n} positions, {bad} wrong");
return bad > 0 ? 1 : 0;
