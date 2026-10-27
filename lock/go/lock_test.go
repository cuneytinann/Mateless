// Tests lock.go on ../positions.tsv:  go test -v  (another file: POSITIONS=positions.tsv go test -v)

package lock

import (
	"bufio"
	"fmt"
	"os"
	"strings"
	"testing"
)

func bit(b bool) int {
	if b {
		return 1
	}
	return 0
}

func TestPositions(t *testing.T) {
	path := os.Getenv("POSITIONS")
	if path == "" {
		path = "../positions.tsv"
	}
	f, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	n, bad := 0, 0
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "#") || line == "" {
			continue
		}
		fen, labels, found := strings.Cut(line, "\t")
		if !found {
			continue
		}
		white, black := labels[0] == '1', labels[2] == '1'
		p := FromFen(fen)
		w, b := CannotBeMated(p, true), CannotBeMated(p, false)
		if w != white || b != black {
			bad++
			if bad <= 10 {
				fmt.Printf("wrong: %s expected %d %d got %d %d\n", fen, bit(white), bit(black), bit(w), bit(b))
			}
		}
		n++
	}
	if err := scanner.Err(); err != nil {
		t.Fatal(err)
	}
	fmt.Printf("go: %d positions, %d wrong\n", n, bad)
	if bad > 0 {
		t.Fail()
	}
}
