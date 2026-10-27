/* Tests lock.c on ../positions.tsv:  cc -O2 -o test test.c lock.c && ./test [positions.tsv] */
#include <stdio.h>
#include <string.h>
#include "lock.h"

int main(int argc, char **argv) {
    const char *path = argc > 1 ? argv[1] : "../positions.tsv";
    FILE *f = fopen(path, "r");
    if (!f) { perror(path); return 2; }
    char line[256];
    long n = 0, bad = 0;
    while (fgets(line, sizeof line, f)) {
        if (line[0] == '#' || line[0] == '\n') continue;
        char *tab = strchr(line, '\t');
        if (!tab) continue;
        *tab = 0;
        bool white = tab[1] == '1', black = tab[3] == '1';
        Pieces p = lock_from_fen(line);
        bool w = lock_cannot_be_mated(&p, true), b = lock_cannot_be_mated(&p, false);
        if (w != white || b != black) {
            if (++bad <= 10) printf("wrong: %s expected %d %d got %d %d\n", line, white, black, w, b);
        }
        n++;
    }
    fclose(f);
    printf("c: %ld positions, %ld wrong\n", n, bad);
    return bad ? 1 : 0;
}
