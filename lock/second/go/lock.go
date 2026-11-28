// Mateless's lock detector, second version, in its simplest form.
//
// Can a side never be mated? The lock detector answers yes when pawns, kings and bishops (and
// knights, rooks or queens boxed in by their own men) form a structure that no series of legal
// moves can open (FIDE 5.2.2 dead position, 6.9 flag fall). It reads bitboards and the side to
// move and searches nothing: only its last rule looks at moves, those of kings, pawns and bishops,
// two plies at most.
//
// The first version (../../go) grows each king's reach, the pawns that can never move, and the
// squares where each side may take a pawn, until nothing changes; the structure leaks if a pawn can
// promote or capture, a frozen king can move, a bishop can reach a pawn's path, or the king asked
// about can reach a square the other side attacks without a sure flight. This version keeps all of
// it and adds, each only where its situation is on the board:
//   - open pawn pairs: a white and a black pawn on one file with one empty square between them;
//     the reachable positions split into families by what the pair's pawns have done (neither
//     moved, the white one stepped into the gap, the black one did), up to 3 pairs;
//   - boxed knights, rooks and queens: a piece whose every step square holds one of its own men
//     that never moves, and that no enemy king or bishop reaches, never moves nor falls; such a man
//     is a fixed pawn, another boxed piece, a still bishop (every diagonal neighbour held so, and out
//     of the enemy king's and bishops' reach) or the piece's own frozen king (its side with no
//     castling right left and not standing where a castle leaves it beside its rook);
//   - twin bishops: two bishops of one side on one colour no longer fail it; the mating net leaves
//     out its second flight rule where they may hold both flights;
//   - the stalemate guard: a pawn the enemy king may take stays a wall if taking it always
//     stalemates its owner;
//   - the check seed: a king in a pawn's check starts its reach from the squares it can step to;
//   - the stuck mater: whatever the flagged side plays, the mater is left without a move;
//   - the forced step: a king in a pawn's check with one legal move, a step: the lock of the
//     position after it;
//   - the stalemated flagged side: a king and pawns that, whatever the mater (a king, pawns and
//     bishops) plays, is left without a legal move and out of check, now or after the one legal
//     move it has.
//
// A possible en passant capture fails it at once. Sound, not complete: a structure it passes can
// never be opened; one it fails may still be dead.
//
// Squares: a1 = 0, b1 = 1, ..., h8 = 63. A set of squares (a bitboard) is a uint64.
package lock

import (
	"math/bits"
	"strings"
)

// Pieces is what the lock detector reads from a position.
type Pieces struct {
	WhitePawns, BlackPawns     uint64
	WhiteKing, BlackKing       uint64
	WhiteBishops, BlackBishops uint64
	WhiteKnights, BlackKnights uint64
	WhiteRooks, BlackRooks     uint64
	WhiteQueens, BlackQueens   uint64
	WhiteToMove                bool
	EnPassant                  bool // the side to move can capture en passant
	WhiteCastles               bool // White has a castling right (its king and that rook in place)
	BlackCastles               bool
}

const (
	fileA    uint64 = 0x0101010101010101
	fileH    uint64 = 0x8080808080808080
	rank1    uint64 = 0x00000000000000FF
	rank3    uint64 = 0x0000000000FF0000
	rank6    uint64 = 0x0000FF0000000000
	rank8    uint64 = 0xFF00000000000000
	dark     uint64 = 0xAA55AA55AA55AA55 // the dark squares; a1 is dark
	maxPairs        = 3                  // the most open pairs the families are split on (3^3 = 27)
)

func north(s uint64) uint64    { return s << 8 }
func south(s uint64) uint64    { return s >> 8 }
func sideways(s uint64) uint64 { return ((s << 1) &^ fileA) | ((s >> 1) &^ fileH) }
func zone(s uint64) uint64     { v := s | north(s) | south(s); return v | sideways(v) } // s and every square next to it
func steps(s uint64) uint64    { return zone(s) &^ s }                                  // the squares next to s
func diagonal(s uint64) uint64 { return sideways(north(s) | south(s)) }                 // the squares diagonally next to s
func count(s uint64) int       { return bits.OnesCount64(s) }

// The squares a knight on s goes to.
func knight(s uint64) uint64 {
	one := sideways(s)
	two := ((s << 2) &^ (fileA | fileA<<1)) | ((s >> 2) &^ (fileH | fileH>>1))
	return north(north(one)) | south(south(one)) | north(two) | south(two)
}

// Every square reachable from g by steps north through squares of p.
func fillNorth(g, p uint64) uint64 {
	g |= p & (g << 8)
	p &= p << 8
	g |= p & (g << 16)
	p &= p << 16
	return g | (p & (g << 32))
}

// Every square reachable from g by steps south through squares of p.
func fillSouth(g, p uint64) uint64 {
	g |= p & (g >> 8)
	p &= p >> 8
	g |= p & (g >> 16)
	p &= p >> 16
	return g | (p & (g >> 32))
}

// Every square a king may reach from k through squares of m.
func flood(k, m uint64) uint64 {
	for {
		a := k | (zone(k) & m)
		if a == k {
			return k
		}
		k = a
	}
}

// sets is what one level leaves for the mating net (and for the families after it).
type sets struct {
	wCone, bCone, wFixed, bFixed, wKing, bKing, wBish, bBish, wTake, bTake uint64
}

// levelIn holds the inputs of a level beyond the position: see level.
type levelIn struct {
	pawns          *[2]uint64
	v              uint64
	start          *[6]uint64
	wx, bx, ws, bs uint64
	guard          bool
}

// FromFen returns the pieces of a FEN. The en passant square counts only if a pawn can capture
// onto it.
func FromFen(fen string) Pieces {
	var p Pieces
	rank, file := 7, 0
	c := 0
	for ; c < len(fen) && fen[c] != ' '; c++ {
		if fen[c] == '/' {
			rank--
			file = 0
			continue
		}
		if fen[c] >= '1' && fen[c] <= '8' {
			file += int(fen[c] - '0')
			continue
		}
		sq := uint64(1) << (8*rank + file)
		file++
		switch fen[c] {
		case 'P':
			p.WhitePawns |= sq
		case 'p':
			p.BlackPawns |= sq
		case 'K':
			p.WhiteKing |= sq
		case 'k':
			p.BlackKing |= sq
		case 'B':
			p.WhiteBishops |= sq
		case 'b':
			p.BlackBishops |= sq
		case 'N':
			p.WhiteKnights |= sq
		case 'n':
			p.BlackKnights |= sq
		case 'R':
			p.WhiteRooks |= sq
		case 'r':
			p.BlackRooks |= sq
		case 'Q':
			p.WhiteQueens |= sq
		default: // q
			p.BlackQueens |= sq
		}
	}
	for c < len(fen) && fen[c] == ' ' {
		c++
	}
	p.WhiteToMove = c == len(fen) || fen[c] != 'b'
	for field := 0; field < 2 && c < len(fen); field++ { // past the side to move and castling
		for c < len(fen) && fen[c] != ' ' {
			c++
		}
		for c < len(fen) && fen[c] == ' ' {
			c++
		}
	}
	if c+1 < len(fen) && fen[c] >= 'a' && fen[c] <= 'h' && fen[c+1] >= '1' && fen[c+1] <= '8' {
		target := uint64(1) << (int(fen[c]-'a') + 8*int(fen[c+1]-'1'))
		if p.WhiteToMove {
			p.EnPassant = sideways(south(target))&p.WhitePawns != 0
		} else {
			p.EnPassant = sideways(north(target))&p.BlackPawns != 0
		}
	}
	if fields := strings.Fields(fen); len(fields) > 2 && fields[2] != "-" {
		for _, c := range fields[2] {
			white := c >= 'A' && c <= 'Z'
			back, king, rooks := rank1, p.WhiteKing, p.WhiteRooks
			if !white {
				back, king, rooks = rank8, p.BlackKing, p.BlackRooks
			}
			king, rooks = king&back, rooks&back
			if king == 0 {
				continue // a right without its king in place does not count
			}
			kf, up, ok := bits.TrailingZeros64(king)%8, c&^0x20, false
			for r := rooks; r != 0; r &= r - 1 {
				f := bits.TrailingZeros64(r) % 8
				if (up == 'K' && f > kf) || (up == 'Q' && f < kf) || (up != 'K' && up != 'Q' && f == int(up-'A') && f != kf) {
					ok = true
				}
			}
			if ok && white {
				p.WhiteCastles = true
			} else if ok {
				p.BlackCastles = true
			}
		}
	}
	return p
}

// CannotBeMated answers: can White (white = true) or Black never be mated, by the lock detector?
func CannotBeMated(p Pieces, white bool) bool {
	return locked(p, white) || stalematedFlagged(p, white)
}

// The lock: no series of legal moves opens the structure for the side asked about.
func locked(p Pieces, white bool) bool {
	if after, ok := forcedStep(p); ok {
		return locked(after, white)
	}
	wx := p.WhiteKnights | p.WhiteRooks | p.WhiteQueens
	bx := p.BlackKnights | p.BlackRooks | p.BlackQueens
	if wx|bx != 0 {
		return boxedLock(p, white, wx, bx)
	}
	if p.EnPassant {
		return false
	}
	gaps := north(p.WhitePawns) & south(p.BlackPawns) &^ (p.WhitePawns | p.BlackPawns)
	for _, frozen := range levels(p, 0, 0) {
		if gaps != 0 {
			switch families(p, gaps, frozen, white) {
			case familyLock:
				return true
			case familyRefuted:
				continue // family A, the level with more walls, leaked: the level leaks too
			}
		}
		if s, ok := level(p, frozen, levelIn{guard: true}); ok && !netLeaks(p, s, white, 0) {
			return true
		}
	}
	return stuckMater(p, white)
}

// The levels: both kings free (0), then each king frozen on its square (a wall for both sides)
// when every square around it is held or attacked by a pawn (or holds one of its own pieces, wOwn
// or bOwn, where boxed pieces are on the board).
func levels(p Pieces, wOwn, bOwn uint64) []uint64 {
	held := p.WhitePawns | p.BlackPawns | sideways(north(p.WhitePawns)|south(p.BlackPawns))
	out := []uint64{0}
	for _, ko := range [][2]uint64{{p.WhiteKing, wOwn}, {p.BlackKing, bOwn}} {
		if steps(ko[0])&^(held|ko[1]) == 0 {
			out = append(out, ko[0])
		}
	}
	return out
}

// May this side's king hold a boxed piece's step square (when frozen)? Not with a castling right
// left (a castling rook may stand beside its king, in Chess960, and castling moves it), and not
// where a castle leaves it beside its rook (g1 with a rook on f1, c1 with one on d1; g8, f8, c8,
// d8): a castle leaves the halfmove clock as it is, so the lock is not asked after one.
func kingWall(p Pieces, white bool) bool {
	king, rooks, castles, g, c := p.BlackKing, p.BlackRooks, p.BlackCastles, uint64(1)<<62, uint64(1)<<58
	if white {
		king, rooks, castles, g, c = p.WhiteKing, p.WhiteRooks, p.WhiteCastles, 1<<6, 1<<2
	}
	return !castles && rooks&(((king&g)>>1)|((king&c)<<1)) == 0
}

// The still bishops among b: every diagonal neighbour held for good (held: fixed pawns and boxed
// pieces of their colour) or by another still bishop, and out of the enemy king's and bishops'
// reach. Such a bishop never moves and is never taken (a pawn taking it fails the bishop contact
// test). The largest such set.
func stillBishops(b, held, reach uint64) uint64 {
	s := b &^ reach
	for {
		n := uint64(0)
		for m := s; m != 0; m &= m - 1 {
			q := m & -m
			if diagonal(q)&^(held|s) == 0 {
				n |= q
			}
		}
		if n == s {
			return s
		}
		s = n
	}
}

// One level: the fixed point of the walls, the pawns that can never move, the kings' reaches, the
// squares where each side may take a pawn, the pawns' cones and the bishops' reaches. The sets the
// mating net reads, and false when the structure leaks whichever side is asked about.
// o.pawns: the pawns (a family has a pair's pawn moved into its gap); o.v: walls for both sides
// (the gaps of a family's pairs that stay); o.start: where the kings' reaches, capture squares and
// bishops' reaches start (a family's); o.wx, bx, ws, bs: the boxed pieces' candidates and their
// step squares; o.guard: the stalemate guard and the check seed (plain levels only).
func level(p Pieces, frozen uint64, o levelIn) (sets, bool) {
	wp, bp := p.WhitePawns, p.BlackPawns
	if o.pawns != nil {
		wp, bp = o.pawns[0], o.pawns[1]
	}
	wk, bk := p.WhiteKing, p.BlackKing
	wx, bx, v := o.wx, o.bx, o.v|frozen
	frozenWhite := frozen&wk != 0
	frozenBlack := !frozenWhite && frozen != 0
	var nearFrozenBlack, nearFrozenWhite uint64
	if frozenBlack {
		nearFrozenBlack = zone(bk)
	}
	if frozenWhite {
		nearFrozenWhite = zone(wk)
	}
	wSeed, bSeed := wk, bk
	if o.guard && frozen == 0 {
		wSeed, bSeed = checkSeed(p)
	}
	wKing, bKing, wTake, bTake, wBish, bBish := wSeed, bSeed, wSeed, bSeed, p.WhiteBishops, p.BlackBishops
	if o.start != nil {
		wKing, bKing, wTake, bTake, wBish, bBish = o.start[0], o.start[1], o.start[2], o.start[3], o.start[4], o.start[5]
	}
	wCone, bCone, wFixed, bFixed := wp, bp, wp, bp
	var wGuard, bGuard uint64
	if o.guard {
		wGuard, bGuard = ^uint64(0), ^uint64(0) // nothing is taken yet
	}
	for {
		// Boxed: the pieces no enemy king or bishop reaches. Walls: pawns the other side can never
		// take (or whose capture stalemates their owner), the frozen king, the gaps, boxed pieces.
		boxed := (wx &^ (bKing | bBish)) | (bx &^ (wKing | wBish))
		wWall := (wp &^ (bTake &^ wGuard)) | v | boxed
		bWall := (bp &^ (wTake &^ bGuard)) | v | boxed
		nwFixed := wFixed & wWall & south(bWall|wFixed)
		nbFixed := bFixed & bWall & north(wWall|bFixed)
		nwCone, nbCone := fillNorth(wCone, ^bWall), fillSouth(bCone, ^wWall)
		// The kings: never onto a fixed pawn, a square it attacks, or next to the frozen king.
		bHit, wHit := sideways(south(nbFixed)), sideways(north(nwFixed))
		// With boxed pieces on the board, never onto its own boxed pieces and still bishops either.
		wStill, bStill := uint64(0), uint64(0)
		if wx|bx != 0 {
			wStill = stillBishops(p.WhiteBishops, nwFixed|(wx&boxed), bKing|bBish)
			bStill = stillBishops(p.BlackBishops, nbFixed|(bx&boxed), wKing|wBish)
		}
		nwKing := flood(wKing, ^(nwFixed | bHit | nearFrozenBlack | (wx & boxed) | wStill))
		nbKing := flood(bKing, ^(nbFixed | wHit | nearFrozenWhite | (bx & boxed) | bStill))
		nwBish, nbBish := wBish, bBish
		open := ^(nwFixed | nbFixed)
		for {
			a, d := nwBish|(diagonal(nwBish)&open), nbBish|(diagonal(nbBish)&open)
			if a == nwBish && d == nbBish {
				break
			}
			nwBish, nbBish = a, d
		}
		// A side may take a pawn where its king goes, and on any square a pawn may walk into.
		t := bTake | nbKing
		nbTake := t | south(fillSouth(t&^bWall, ^bWall))
		t = wTake | nwKing
		nwTake := t | north(fillNorth(t&^wWall, ^wWall))
		nwGuard, nbGuard := wGuard, bGuard
		if o.guard {
			block := nwFixed | nbFixed
			wHasB, bHasB := p.WhiteBishops != 0, p.BlackBishops != 0
			nwGuard, nbGuard = 0, 0
			if !wHasB {
				nwGuard = stalemateGuard(wp&nbTake&nwFixed, wp, nwFixed, nwKing, nwFixed|bHit, nbKing, bHasB, block)
			}
			if !bHasB {
				nbGuard = stalemateGuard(bp&nwTake&nbFixed, bp, nbFixed, nbKing, nbFixed|wHit, nwKing, wHasB, block)
			}
		}
		next := [12]uint64{nwCone, nbCone, nwFixed, nbFixed, nwKing, nbKing, nwBish, nbBish, nwTake, nbTake, nwGuard, nbGuard}
		last := [12]uint64{wCone, bCone, wFixed, bFixed, wKing, bKing, wBish, bBish, wTake, bTake, wGuard, bGuard}
		wCone, bCone, wFixed, bFixed, wKing, bKing = nwCone, nbCone, nwFixed, nbFixed, nwKing, nbKing
		wBish, bBish, wTake, bTake, wGuard, bGuard = nwBish, nbBish, nwTake, nbTake, nwGuard, nbGuard
		if next == last {
			break
		}
	}
	boxed := (wx &^ (bKing | bBish)) | (bx &^ (wKing | wBish))
	if (wCone&rank8)|(bCone&rank1) != 0 {
		return sets{}, false // a pawn can promote
	}
	if (north(sideways(wCone))&(bCone|bx))|(south(sideways(bCone))&wx) != 0 {
		return sets{}, false // a pawn can capture
	}
	if (frozenWhite && wKing != wk) || (frozenBlack && bKing != bk) {
		return sets{}, false // the frozen king can move
	}
	if (diagonal(wBish)&bCone)|(diagonal(bBish)&wCone) != 0 {
		return sets{}, false // a bishop meets a pawn's path
	}
	// A piece may step: a step square not held by a fixed pawn, a boxed piece or a still bishop of
	// its colour, or by its frozen king (where the king may be a wall).
	wStill, bStill, wKw, bKw := uint64(0), uint64(0), uint64(0), uint64(0)
	if wx|bx != 0 {
		wStill = stillBishops(p.WhiteBishops, wFixed|(wx&boxed), bKing|bBish)
		bStill = stillBishops(p.BlackBishops, bFixed|(bx&boxed), wKing|wBish)
	}
	if frozenWhite && kingWall(p, true) {
		wKw = wk
	}
	if frozenBlack && kingWall(p, false) {
		bKw = bk
	}
	if (o.ws&^(wFixed|(wx&boxed)|wStill|wKw))|(o.bs&^(bFixed|(bx&boxed)|bStill|bKw)) != 0 {
		return sets{}, false // a piece may step
	}
	if wGuard|bGuard != 0 {
		// A king that takes a guarded pawn ends the game: for the mating net, the kings' reaches
		// again, now stopping at the enemy's guarded pawns.
		wKing = flood(wSeed, ^(wFixed | sideways(south(bFixed)) | nearFrozenBlack | (bp & bGuard)))
		bKing = flood(bSeed, ^(bFixed | sideways(north(wFixed)) | nearFrozenWhite | (wp & wGuard)))
	}
	return sets{wCone, bCone, wFixed, bFixed, wKing, bKing, wBish, bBish, wTake, bTake}, true
}

// The mating net: can the other side's pawns and bishops catch the king asked about? occ: squares
// that stand occupied for good besides (the boxed pieces').
func netLeaks(p Pieces, s sets, white bool, occ uint64) bool {
	var attack, reach, free, spare, twins uint64
	if white {
		attack = diagonal(s.bBish) | sideways(south(s.bCone))
		reach = s.wKing
		free = ^(s.wCone | occ | zone(s.bKing) | attack) // never occupied, attacked or next to the mater
		spare = free &^ s.wBish                          // ... nor reached by the king's own bishops
		twins = p.WhiteBishops
	} else {
		attack = diagonal(s.wBish) | sideways(north(s.wCone))
		reach = s.bKing
		free = ^(s.bCone | occ | zone(s.wKing) | attack)
		spare = free &^ s.bBish
		twins = p.BlackBishops
	}
	// A king next to a spare square, or with free squares beside it both ways, always has a flight.
	// The second rule counts on at most one of the king's own bishops on the colour of those two
	// squares (the colour opposite the king's): not on the king squares where it has two or more.
	var noPair uint64
	if count(twins&dark) > 1 {
		noPair |= ^dark
	}
	if count(twins&^dark) > 1 {
		noPair |= dark
	}
	flight := sideways(spare) | north(spare) | south(spare) | ((north(free) | south(free)) & sideways(free) &^ noPair)
	return attack&reach&^flight != 0
}

// The check seed: the side to move is in a pawn's check, so its king must step now, to a square it
// can step to (not its own pawn, not a square an enemy pawn attacks, not next to the enemy king);
// its reach starts there. Not when it has no such square (that may be a mate now), when one of its
// pawns can take a checking pawn, or with a bishop on the board. The kings' starting sets.
func checkSeed(p Pieces) (uint64, uint64) {
	wp, bp, wk, bk := p.WhitePawns, p.BlackPawns, p.WhiteKing, p.BlackKing
	if p.WhiteBishops|p.BlackBishops != 0 {
		return wk, bk
	}
	var to, takers uint64
	if p.WhiteToMove {
		checkers := sideways(north(wk)) & bp
		if checkers == 0 {
			return wk, bk
		}
		to = steps(wk) &^ wp &^ sideways(south(bp)) &^ steps(bk)
		takers = sideways(south(checkers)) & wp
	} else {
		checkers := sideways(south(bk)) & wp
		if checkers == 0 {
			return wk, bk
		}
		to = steps(bk) &^ bp &^ sideways(north(wp)) &^ steps(wk)
		takers = sideways(north(checkers)) & bp
	}
	if to == 0 || takers != 0 {
		return wk, bk
	}
	if p.WhiteToMove {
		return to, bk
	}
	return wk, to
}

// The stalemate guard: of the owner's fixed pawns cand (which the enemy king may take), those whose
// capture always stalemates the owner. The owner must have nothing else that moves (every other
// pawn fixed; no bishop, which the caller sees to). reach: where the owner's king may stand; shut:
// squares it can never step to (own fixed pawns, squares the enemy's fixed pawns attack);
// enemyKing: the enemy king's reach; block: squares a bishop's line never crosses.
func stalemateGuard(cand, own, ownFixed, reach, shut, enemyKing uint64, enemyBishops bool, block uint64) uint64 {
	if own&^ownFixed != 0 {
		return 0
	}
	var guard uint64
	for c := cand; c != 0; c &= c - 1 {
		pawn := c & -c
		near := steps(pawn)
		from := near & enemyKing // where the enemy king takes from
		x := shut | near | pawn  // after the capture, the owner's king may not step there
		held := true
		for k := reach &^ (near | pawn); k != 0; k &= k - 1 { // the owner's king, not defending the pawn
			king := k & -k
			if steps(king)&^x != 0 || (enemyBishops && rayMeets(king, block|pawn, from)) {
				held = false // it has a square to step to, or the capture uncovers a check
				break
			}
		}
		if held {
			guard |= pawn
		}
	}
	return guard
}

// Does a diagonal line from the square king, stopped by block, meet a square of o?
func rayMeets(king, block, o uint64) bool {
	sq := bits.TrailingZeros64(king)
	f0, r0 := sq&7, sq>>3
	for _, d := range [4][2]int{{-1, -1}, {1, -1}, {-1, 1}, {1, 1}} {
		for f, r := f0+d[0], r0+d[1]; f >= 0 && f < 8 && r >= 0 && r < 8; f, r = f+d[0], r+d[1] {
			s := uint64(1) << (8*r + f)
			if o&s != 0 {
				return true
			}
			if block&s != 0 {
				break
			}
		}
	}
	return false
}

// What the families of the open pairs say at one level.
const (
	familyLock    = iota // none of them leaks to the king asked about
	familyRefuted        // family A (no pair's pawn has moved) leaks to it
	familyNone           // another family leaks
)

// The families of the open pairs at one level.
func families(p Pieces, gaps, frozen uint64, white bool) int {
	var pairs [][3]uint64 // per pair: the gap, the white pawn below it, the black pawn above it
	for g := gaps; g != 0; g &= g - 1 {
		gap := g & -g
		pairs = append(pairs, [3]uint64{gap, south(gap), north(gap)})
	}
	if len(pairs) > maxPairs {
		return familyNone
	}
	k := len(pairs)
	n := 1
	for i := 0; i < k; i++ {
		n *= 3
	}
	var all []sets
	for f := 0; f < n; f++ {
		// Family f: digit i (base 3) says what pair i's pawns have done: 0 neither, 1 the white one
		// stepped into the gap, 2 the black one did. Its sets start from those of the family it is
		// reached from (the same with pair i's pawns in place), minus the gap.
		wp, bp, v := p.WhitePawns, p.BlackPawns, uint64(0)
		var start [6]uint64
		if f == 0 {
			start = [6]uint64{p.WhiteKing, p.BlackKing, p.WhiteKing, p.BlackKing, p.WhiteBishops, p.BlackBishops}
		}
		for i, q, pow := 0, f, 1; i < k; i, q, pow = i+1, q/3, pow*3 {
			d, gap, w, b := q%3, pairs[i][0], pairs[i][1], pairs[i][2]
			if d == 0 {
				v |= gap // the gap stays: a wall for both sides' pawns
				continue
			}
			if d == 1 {
				wp = (wp &^ w) | gap
			} else {
				bp = (bp &^ b) | gap
			}
			r := all[f-d*pow]
			start[0] |= r.wKing &^ gap
			start[1] |= r.bKing &^ gap
			start[2] |= r.wTake
			start[3] |= r.bTake
			start[4] |= r.wBish &^ gap
			start[5] |= r.bBish &^ gap
		}
		s, ok := level(p, frozen, levelIn{pawns: &[2]uint64{wp, bp}, v: v, start: &start})
		if !ok {
			if f == 0 {
				return familyRefuted
			}
			return familyNone
		}
		// The pairs that stay: both pawns must never move.
		for i, q := 0, f; i < k; i, q = i+1, q/3 {
			if q%3 == 0 && (pairs[i][1]&^s.wFixed)|(pairs[i][2]&^s.bFixed) != 0 {
				return familyNone
			}
		}
		if netLeaks(p, s, white, 0) {
			if f == 0 {
				return familyRefuted
			}
			return familyNone
		}
		all = append(all, s)
	}
	return familyLock
}

// With knights, rooks or queens on the board: every one of them must be boxed in by its own pawns
// and pieces (bishops and the king among them: the level checks that they never move); then the
// levels, with the boxed pieces as walls and no flight onto their squares.
func boxedLock(p Pieces, white bool, wx, bx uint64) bool {
	wOwn, bOwn := p.WhitePawns|wx|p.WhiteBishops, p.BlackPawns|bx|p.BlackBishops
	if kingWall(p, true) {
		wOwn |= p.WhiteKing
	}
	if kingWall(p, false) {
		bOwn |= p.BlackKing
	}
	ws, wok := boxSteps(p.WhiteKnights, p.WhiteRooks|p.WhiteQueens, p.WhiteQueens, wOwn)
	bs, bok := boxSteps(p.BlackKnights, p.BlackRooks|p.BlackQueens, p.BlackQueens, bOwn)
	if !wok || !bok || p.EnPassant {
		return false
	}
	for _, frozen := range levels(p, wx|p.WhiteBishops, bx|p.BlackBishops) {
		if s, ok := level(p, frozen, levelIn{wx: wx, bx: bx, ws: ws, bs: bs}); ok && !netLeaks(p, s, white, wx|bx) {
			return true
		}
	}
	return false
}

// The step squares of one side's knights, rooks (and queens: o) and queens, and false when one of
// them is not held by its own men (own).
func boxSteps(knights, o, queens, own uint64) (uint64, bool) {
	s := sideways(o) | north(o) | south(o) | diagonal(queens) | knight(knights)
	return s, s&^own == 0
}

// The stuck mater: the flagged side is to move and, whatever it plays, the mater has no legal move
// left (kings and pawns only): the game ends at the mater's turn.
func stuckMater(p Pieces, white bool) bool {
	if p.WhiteToMove != white || p.EnPassant {
		return false
	}
	if p.WhiteBishops|p.BlackBishops|p.WhiteKnights|p.BlackKnights|p.WhiteRooks|p.BlackRooks|p.WhiteQueens|p.BlackQueens != 0 {
		return false
	}
	fp, mp, fk, mk := p.WhitePawns, p.BlackPawns, p.WhiteKing, p.BlackKing
	fwd, back, start := north, south, rank3 // ahead and behind, for the flagged side; its double steps' rank
	if !white {
		fp, mp, fk, mk = p.BlackPawns, p.WhitePawns, p.BlackKing, p.WhiteKing
		fwd, back, start = south, north, rank6
	}
	occ := fp | mp | fk | mk
	// A mater's pawn with an empty square ahead is never stuck; then only a stalemate now is left to
	// find, which a flagged pawn's push rules out.
	if back(mp)&^occ != 0 && fwd(fp)&^occ != 0 {
		return false
	}
	fAttack, mAttack := sideways(fwd(fp)), sideways(back(mp))
	if fAttack&(mp|mk) != 0 {
		return false // 1. the flagged side has no capture
	}
	single := fwd(fp) &^ occ
	double := fwd(single&start) &^ occ
	pushes := single | double
	near := steps(mk)
	kingTo := steps(fk) &^ fp &^ mAttack &^ near // the flagged king's steps now
	inCheck := fk&mAttack != 0
	if inCheck && kingTo == 0 {
		return false // mated now
	}
	stays := pushes != 0 && !inCheck // a pawn may move instead of the king
	if kingTo == 0 && !stays {
		return true // no move, no check: stalemate now
	}
	// The squares next to every square the flagged king may stand on after its move.
	cover := ^uint64(0)
	if stays {
		cover = steps(fk)
	}
	for k := kingTo; k != 0; k &= k - 1 {
		cover &= steps(k & -k)
	}
	// 2. the mater's pawns are blocked by men that stay, and attack no flagged pawn
	blockers := fp | mp | mk
	if kingTo == 0 {
		blockers |= fk
	}
	if (back(mp)&^blockers)|(mAttack&fp) != 0 {
		return false
	}
	// 3. every square next to the mater's king: its own pawn, attacked by a flagged pawn that cannot
	//    move now, or next to the flagged king wherever it goes
	still := fp & back(fwd(fp)&occ)
	if near&^(mp|sideways(fwd(still))|cover) != 0 {
		return false
	}
	// 4. no push lands where a mater's pawn attacks or next to its king, nor lets it take en passant
	return (pushes&(mAttack|near))|(double&sideways(mp)) == 0
}

// The forced step: the side to move is in a pawn's check, with kings and pawns only, and its one
// legal move is a step of its king. The position after it, and false when there is none.
func forcedStep(p Pieces) (Pieces, bool) {
	if p.EnPassant || p.WhiteBishops|p.BlackBishops|p.WhiteKnights|p.BlackKnights|p.WhiteRooks|p.BlackRooks|p.WhiteQueens|p.BlackQueens != 0 {
		return p, false
	}
	var k, ek, own, enemy, checkers, attacked uint64
	if p.WhiteToMove {
		k, ek, own, enemy = p.WhiteKing, p.BlackKing, p.WhitePawns, p.BlackPawns
		checkers, attacked = sideways(north(k))&enemy, sideways(south(enemy))
	} else {
		k, ek, own, enemy = p.BlackKing, p.WhiteKing, p.BlackPawns, p.WhitePawns
		checkers, attacked = sideways(south(k))&enemy, sideways(north(enemy))
	}
	if checkers == 0 {
		return p, false
	}
	to := steps(k) &^ own &^ attacked &^ steps(ek)
	if count(to) != 1 {
		return p, false
	}
	takers := sideways(south(checkers)) & own
	if !p.WhiteToMove {
		takers = sideways(north(checkers)) & own
	}
	if takers != 0 {
		return p, false // a pawn may take instead
	}
	q := p
	q.EnPassant = false
	if p.WhiteToMove {
		q.WhiteKing, q.BlackPawns = to, p.BlackPawns&^to
	} else {
		q.BlackKing, q.WhitePawns = to, p.WhitePawns&^to
	}
	q.WhiteToMove = !p.WhiteToMove
	return q, true
}

// ─── The stalemated flagged side ────────────────────────────────────────────────────────────
// Men as 12 sets: White's pawns, knights, bishops, rooks, queens and king, then Black's.

type men [12]uint64

const (
	pawn = iota
	knightKind
	bishop
	rook
	queen
	king
)

var diagonals = [4][2]int{{1, 1}, {-1, 1}, {1, -1}, {-1, -1}}
var lines = [4][2]int{{1, 0}, {-1, 0}, {0, 1}, {0, -1}}

// A move: from, to, a pawn taken en passant, the square a double step passes, the kind and the kind after it.
type move struct {
	from, to, victim, passed uint64
	kind, now                int
}

// The squares from the square s in the direction (df, dr), up to the first man (included).
func ray(s uint64, df, dr int, occ uint64) uint64 {
	sq := bits.TrailingZeros64(s)
	f, r, out := sq%8+df, sq/8+dr, uint64(0)
	for f >= 0 && f < 8 && r >= 0 && r < 8 {
		t := uint64(1) << (8*r + f)
		out |= t
		if occ&t != 0 {
			break
		}
		f, r = f+df, r+dr
	}
	return out
}

// Every man of side (0 White, 1 Black).
func (m *men) of(side int) uint64 {
	b := 6 * side
	return m[b] | m[b+1] | m[b+2] | m[b+3] | m[b+4] | m[b+5]
}

func fwd(side int, s uint64) uint64 {
	if side == 0 {
		return north(s)
	}
	return south(s)
}

// Every square the men of side attack, the board occupied as occ.
func (m *men) attacks(side int, occ uint64) uint64 {
	b := 6 * side
	a := sideways(fwd(side, m[b])) | knight(m[b+knightKind]) | steps(m[b+king])
	for s := m[b+bishop] | m[b+queen]; s != 0; s &= s - 1 {
		for _, d := range diagonals {
			a |= ray(s&-s, d[0], d[1], occ)
		}
	}
	for s := m[b+rook] | m[b+queen]; s != 0; s &= s - 1 {
		for _, d := range lines {
			a |= ray(s&-s, d[0], d[1], occ)
		}
	}
	return a
}

// The legal moves of side, to move, which has a king, pawns and bishops only. A promotion is four
// moves. ep: the square behind the other side's double step (0: none).
func (m *men) legalMoves(side int, ep uint64) []move {
	b, o := 6*side, 6*(1-side)
	own, occ, k := m.of(side), m.of(0)|m.of(1), m[b+king]
	them := m.of(1-side) &^ m[o+king]
	var moves []move
	for t := steps(k) &^ own &^ m.attacks(1-side, occ&^k); t != 0; t &= t - 1 {
		moves = append(moves, move{k, t & -t, 0, 0, king, king})
	}
	// checks on the king, and the men pinned to it (each may move along its line only)
	checkers := (sideways(fwd(side, k)) & m[o+pawn]) | (knight(k) & m[o+knightKind])
	block := ^uint64(0)
	pins := map[uint64]uint64{}
	for l, dirs := range [2][4][2]int{diagonals, lines} {
		sliders := m[o+bishop] | m[o+queen]
		if l == 1 {
			sliders = m[o+rook] | m[o+queen]
		}
		for _, d := range dirs {
			r := ray(k, d[0], d[1], occ)
			first := r & occ
			if first&sliders != 0 {
				checkers |= first
				block = r
			} else if first&own != 0 {
				if beyond := ray(first, d[0], d[1], occ); beyond&occ&sliders != 0 {
					pins[first] = r | beyond
				}
			}
		}
	}
	if count(checkers) >= 2 {
		return moves
	}
	evade := ^uint64(0)
	if checkers != 0 {
		evade = checkers
		if block != ^uint64(0) {
			evade = block
		}
	}
	lineOf := func(s uint64) uint64 {
		if l, ok := pins[s]; ok {
			return l
		}
		return ^uint64(0)
	}
	for s := m[b+bishop]; s != 0; s &= s - 1 {
		from, to := s&-s, uint64(0)
		for _, d := range diagonals {
			to |= ray(from, d[0], d[1], occ)
		}
		for t := to &^ own &^ m[o+king] & evade & lineOf(from); t != 0; t &= t - 1 {
			moves = append(moves, move{from, t & -t, 0, 0, bishop, bishop})
		}
	}
	for s := m[b+pawn]; s != 0; s &= s - 1 {
		from := s & -s
		line := lineOf(from)
		one := fwd(side, from) &^ occ
		start := rank3
		if side == 1 {
			start = rank6
		}
		two := fwd(side, one&start) &^ occ
		hit := sideways(fwd(side, from))
		for t := (one | (hit & them)) & evade & line; t != 0; t &= t - 1 {
			to := t & -t
			if to&(rank1|rank8) != 0 {
				for _, now := range []int{queen, rook, bishop, knightKind} {
					moves = append(moves, move{from, to, 0, 0, pawn, now})
				}
			} else {
				moves = append(moves, move{from, to, 0, 0, pawn, pawn})
			}
		}
		for t := two & evade & line; t != 0; t &= t - 1 {
			moves = append(moves, move{from, t & -t, 0, one, pawn, pawn})
		}
		if e := hit & ep & line; e != 0 {
			victim := south(e)
			if side == 1 {
				victim = north(e)
			}
			if checkers == 0 || checkers&victim != 0 || e&evade != 0 {
				moves = append(moves, move{from, e, victim, 0, pawn, pawn})
			}
		}
	}
	return moves
}

// The men after side plays mv.
func (m *men) play(side int, mv move) men {
	r := *m
	o := 6 * (1 - side)
	for i := o; i < o+6; i++ {
		r[i] &^= mv.to | mv.victim
	}
	r[6*side+mv.kind] &^= mv.from
	r[6*side+mv.now] |= mv.to
	return r
}

// Has side, to move, no legal move, its king in no check?
func (m *men) stalemated(side int, ep uint64) bool {
	return m.attacks(1-side, m.of(0)|m.of(1))&m[6*side+king] == 0 && len(m.legalMoves(side, ep)) == 0
}

// Does every move of moves (side's) leave the other side stalemated?
func (m *men) everyMoveStalemates(side int, moves []move) bool {
	for _, mv := range moves {
		r := m.play(side, mv)
		if !r.stalemated(1-side, mv.passed) {
			return false
		}
	}
	return true
}

// The stalemated flagged side: a king and pawns that, whatever the mater (a king, pawns and
// bishops) plays, is left without a legal move and out of check, a stalemate. With the mater to
// move: it has a legal move, and each one does that. With the flagged side to move: it has exactly
// one legal move (a promotion is four), after which every move of the mater's, if it has any, does
// that (with none, that one move ended the game). Not with an en passant right.
func stalematedFlagged(p Pieces, white bool) bool {
	m := men{p.WhitePawns, p.WhiteKnights, p.WhiteBishops, p.WhiteRooks, p.WhiteQueens, p.WhiteKing,
		p.BlackPawns, p.BlackKnights, p.BlackBishops, p.BlackRooks, p.BlackQueens, p.BlackKing}
	f := 1
	if white {
		f = 0
	}
	b, o := 6*f, 6*(1-f)
	if p.EnPassant || m[b+knightKind]|m[b+bishop]|m[b+rook]|m[b+queen] != 0 || m[o+knightKind]|m[o+rook]|m[o+queen] != 0 {
		return false
	}
	if p.WhiteToMove != white {
		moves := m.legalMoves(1-f, 0)
		return len(moves) > 0 && m.everyMoveStalemates(1-f, moves)
	}
	only := m.legalMoves(f, 0)
	if len(only) != 1 {
		return false
	}
	q := m.play(f, only[0])
	return q.everyMoveStalemates(1-f, q.legalMoves(1-f, only[0].passed))
}
