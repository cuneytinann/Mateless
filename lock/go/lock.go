// Package lock is Mateless's lock detector, in its simplest form.
//
// Can a side never be mated? The lock detector answers yes when pawns, kings and bishops form a
// structure that no series of legal moves can open (FIDE 5.2.2 dead position, 6.9 flag fall). It
// reads bitboards only: it generates no move and searches nothing.
//
// Each king's reach (every square it may ever stand on) is grown from its square, never onto a
// square that a pawn which can never move attacks. The pawns that can never move are those
// blocked by a wall: a pawn the other side can never take. The squares where a side may take a
// pawn grow from its king's reach, and so on, until nothing changes. The structure leaks if a
// pawn can promote or capture, a frozen king can move, a bishop can reach a pawn's path, or the
// king of the side asked about can reach a square the other side attacks where it has no sure
// flight. It is tried with both kings free, then with each king frozen on its square (a wall for
// both sides) when every square around that king is held or attacked by a pawn.
//
// A knight, rook or queen on the board, two bishops of one side on squares of one colour, or a
// possible en passant capture fails it at once. Sound, not complete: a structure it passes can
// never be opened; one it fails may still be dead.
//
// Squares: a1 = 0, b1 = 1, ..., h8 = 63. A set of squares (a bitboard) is a uint64.
package lock

import "math/bits"

// Pieces is what the lock detector reads from a position.
type Pieces struct {
	WhitePawns, BlackPawns     uint64
	WhiteKing, BlackKing       uint64
	WhiteBishops, BlackBishops uint64
	Others                     uint64 // knights, rooks and queens of both sides
	EnPassant                  bool   // the side to move can capture en passant
}

const (
	fileA uint64 = 0x0101010101010101
	fileH uint64 = 0x8080808080808080
	rank1 uint64 = 0x00000000000000FF
	rank8 uint64 = 0xFF00000000000000
	dark  uint64 = 0xAA55AA55AA55AA55 // the dark squares; a1 is dark
)

func north(s uint64) uint64    { return s << 8 }
func south(s uint64) uint64    { return s >> 8 }
func sideways(s uint64) uint64 { return ((s << 1) &^ fileA) | ((s >> 1) &^ fileH) }
func zone(s uint64) uint64     { v := s | north(s) | south(s); return v | sideways(v) } // s and every square next to it
func diagonal(s uint64) uint64 { return sideways(north(s) | south(s)) }                 // the squares diagonally next to s
func count(s uint64) int       { return bits.OnesCount64(s) }

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
		default: // N R Q n r q
			p.Others |= sq
		}
	}
	for c < len(fen) && fen[c] == ' ' {
		c++
	}
	whiteToMove := c == len(fen) || fen[c] != 'b'
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
		if whiteToMove {
			p.EnPassant = sideways(south(target))&p.WhitePawns != 0
		} else {
			p.EnPassant = sideways(north(target))&p.BlackPawns != 0
		}
	}
	return p
}

// Two bishops on squares of one colour (only a promotion makes them).
func twinBishops(b uint64) bool { return count(b&dark) > 1 || count(b&^dark) > 1 }

// CannotBeMated answers: can White (white = true) or Black never be mated, by the lock detector?
func CannotBeMated(p Pieces, white bool) bool {
	if p.Others != 0 || p.EnPassant {
		return false
	}
	if twinBishops(p.WhiteBishops) || twinBishops(p.BlackBishops) {
		return false
	}
	if !leaks(p, white, 0) {
		return true
	}
	// A king may be frozen only if every square around it is held or attacked by a pawn.
	held := p.WhitePawns | p.BlackPawns | sideways(north(p.WhitePawns)|south(p.BlackPawns))
	kings := [2]uint64{p.WhiteKing, p.BlackKing}
	for _, king := range kings {
		if zone(king)&^king&^held == 0 && !leaks(p, white, king) {
			return true
		}
	}
	return false
}

// Does the structure leak to the king asked about, with the king `frozen` frozen (0: none)?
func leaks(p Pieces, white bool, frozen uint64) bool {
	wp, bp, wk, bk := p.WhitePawns, p.BlackPawns, p.WhiteKing, p.BlackKing
	frozenWhite := frozen&wk != 0
	frozenBlack := !frozenWhite && frozen != 0
	var nearFrozenBlack, nearFrozenWhite uint64
	if frozenBlack {
		nearFrozenBlack = zone(bk)
	}
	if frozenWhite {
		nearFrozenWhite = zone(wk)
	}

	// Quick: the pawns' paths against the first walls already show a promotion or a capture.
	wCone := fillNorth(wp, ^((bp &^ wk) | frozen))
	bCone := fillSouth(bp, ^((wp &^ bk) | frozen))
	if (wCone&rank8)|(bCone&rank1)|(north(sideways(wCone))&bCone) != 0 {
		return true
	}

	// The cycle: walls -> pawns that can never move -> king reaches -> capture squares -> walls.
	wFixed, bFixed := wp, bp               // pawns that can never move      (shrink)
	wKing, bKing := wk, bk                 // squares each king may reach    (grow)
	wTake, bTake := wk, bk                 // squares where a side may take an enemy pawn (grow)
	wWall, bWall := ^uint64(0), ^uint64(0) // pawns the other side can never take, and the frozen king
	for {
		lastWWall, lastBWall := wWall, bWall
		wWall = (wp &^ bTake) | frozen
		bWall = (bp &^ wTake) | frozen
		newWFixed := wFixed & wWall & south(bWall|wFixed)
		newBFixed := bFixed & bWall & north(wWall|bFixed)
		if wWall == lastWWall && bWall == lastBWall && newWFixed == wFixed && newBFixed == bFixed {
			break
		}
		// Both kings' reaches, flooded: never onto a fixed pawn, a square it attacks, or next to
		// the frozen king.
		wMask := ^(newWFixed | sideways(south(newBFixed)) | nearFrozenBlack)
		bMask := ^(newBFixed | sideways(north(newWFixed)) | nearFrozenWhite)
		newWKing, newBKing := wKing, bKing
		for {
			a := newWKing | (zone(newWKing) & wMask)
			d := newBKing | (zone(newBKing) & bMask)
			if a == newWKing && d == newBKing {
				break
			}
			newWKing = a
			newBKing = d
		}
		if (frozenWhite && newWKing != wk) || (frozenBlack && newBKing != bk) {
			return true // the frozen king can move
		}
		// A side may take a pawn where its king goes, and on any square a pawn may walk into.
		t := bTake | newBKing
		newBTake := t | south(fillSouth(t&^bWall, ^bWall))
		t = wTake | newWKing
		newWTake := t | north(fillNorth(t&^wWall, ^wWall))
		changed := newWFixed != wFixed || newBFixed != bFixed || newWKing != wKing ||
			newBKing != bKing || newWTake != wTake || newBTake != bTake
		wFixed, bFixed, wKing, bKing = newWFixed, newBFixed, newWKing, newBKing
		wTake, bTake = newWTake, newBTake
		if !changed {
			break
		}
	}

	// The pawns' cones: every square they may still reach.
	wCone = fillNorth(wp, ^bWall)
	bCone = fillSouth(bp, ^wWall)
	if (wCone&rank8)|(bCone&rank1) != 0 {
		return true // a pawn can promote
	}
	if north(sideways(wCone))&bCone != 0 {
		return true // a pawn can capture
	}
	// The bishops' reaches: every square they may reach, around the fixed pawns.
	wBish, bBish, open := p.WhiteBishops, p.BlackBishops, ^(wFixed | bFixed)
	for {
		a := wBish | (diagonal(wBish) & open)
		d := bBish | (diagonal(bBish) & open)
		if a == wBish && d == bBish {
			break
		}
		wBish = a
		bBish = d
	}
	if (diagonal(wBish)&bCone)|(diagonal(bBish)&wCone) != 0 {
		return true // a bishop meets a pawn's path
	}

	// The mating net: can the other side's pawns and bishops catch the king asked about?
	var attack, reach, free, spare uint64
	if white {
		attack = diagonal(bBish) | sideways(south(bCone))
		reach = wKing
		free = ^(wCone | zone(bKing) | attack) // never occupied, attacked or next to the mater
		spare = free &^ wBish                  // ... nor reached by the king's own bishops
	} else {
		attack = diagonal(wBish) | sideways(north(wCone))
		reach = bKing
		free = ^(bCone | zone(wKing) | attack)
		spare = free &^ bBish
	}
	// A king next to a spare square, or with free squares beside it both ways, always has a flight.
	flight := sideways(spare) | north(spare) | south(spare) | ((north(free) | south(free)) & sideways(free))
	return attack&reach&^flight != 0
}
