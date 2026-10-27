// Tests lock.hpp on ../positions.tsv:  g++ -std=c++17 -O2 -Wall -Wextra -pedantic -o test test.cpp && ./test [positions.tsv]
#include <fstream>
#include <iostream>
#include <string>
#include "lock.hpp"

int main(int argc, char **argv) {
    const char *path = argc > 1 ? argv[1] : "../positions.tsv";
    std::ifstream f(path);
    if (!f) { std::cerr << path << ": cannot open\n"; return 2; }
    std::string line;
    long n = 0, bad = 0;
    while (std::getline(f, line)) {
        if (line.empty() || line[0] == '#') continue;
        std::size_t tab = line.find('\t');
        if (tab == std::string::npos) continue;
        std::string fen = line.substr(0, tab);
        bool white = line[tab + 1] == '1', black = line[tab + 3] == '1';
        mateless::lock::Pieces p = mateless::lock::from_fen(fen);
        bool w = mateless::lock::cannot_be_mated(p, true), b = mateless::lock::cannot_be_mated(p, false);
        if (w != white || b != black) {
            if (++bad <= 10)
                std::cout << "wrong: " << fen << " expected " << white << ' ' << black << " got " << w << ' ' << b << '\n';
        }
        n++;
    }
    std::cout << "c++: " << n << " positions, " << bad << " wrong\n";
    return bad ? 1 : 0;
}
