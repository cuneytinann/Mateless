/**
 * Type declarations for mateless.js, the Mateless rules engine and FIDE arbiter.
 *
 * The engine is a CommonJS module (`require('./mateless.js')`) and, loaded with a classic
 * <script>, the global `Mateless`. Squares are numbered a1 = 0, b1 = 1, …, h8 = 63; a piece is
 * colour | type (black 1..6, white 9..14, 0 an empty square).
 *
 * Kept in step with mateless.js by test/types_check.js: every runtime export must be declared
 * here and every declaration must exist at runtime.
 */
export as namespace Mateless;
export = Mateless;

declare namespace Mateless {
  // ─── Pieces, colours, squares, results ──────────────────────────────────────────────────

  /** BLACK (0) or WHITE (8). */
  type Color = 0 | 8;
  /** PAWN 1, KING 2, QUEEN 3, KNIGHT 4, ROOK 5, BISHOP 6. */
  type PieceType = 1 | 2 | 3 | 4 | 5 | 6;
  /** A piece promoted to: QUEEN, ROOK, BISHOP or KNIGHT. */
  type Promotion = 3 | 5 | 6 | 4;
  /** colour | type: black pieces 1..6, white pieces 9..14; 0 is an empty square. */
  type Piece = number;
  /** a1 = 0, b1 = 1, …, h1 = 7, a2 = 8, …, h8 = 63; NO_SQUARE (-1) where there is none. */
  type Square = number;
  /** How a game ended, or 0 while it goes on (see Result and RESULT_NAMES). */
  type ResultCode = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;
  /** The results in words, by code. */
  type ResultName = 'ongoing' | 'white checkmates' | 'black checkmates' | 'stalemate' | '75-move rule' | 'fivefold repetition' | 'dead position' | 'white wins on time' | 'black wins on time' | 'white wins by resignation' | 'black wins by resignation' | 'draw on time' | 'draw on resignation' | '50-move rule' | 'threefold repetition';

  const BLACK: 0;
  const WHITE: 8;
  const PAWN: 1;
  const KING: 2;
  const QUEEN: 3;
  const KNIGHT: 4;
  const ROOK: 5;
  const BISHOP: 6;
  const NO_SQUARE: -1;
  /** The order in which the search tries the four promotions. */
  const PROMOTION_ORDER: readonly [3, 5, 6, 4];
  /** Index = piece code; ' ' marks codes that are no piece. */
  const PIECE_LETTERS: string;
  /** Each result in words: RESULT_NAMES[code]. */
  const RESULT_NAMES: readonly ['ongoing', 'white checkmates', 'black checkmates', 'stalemate', '75-move rule', 'fivefold repetition', 'dead position', 'white wins on time', 'black wins on time', 'white wins by resignation', 'black wins by resignation', 'draw on time', 'draw on resignation', '50-move rule', 'threefold repetition'];
  /** The result codes by name. Claims (threefold repetition, the 50-move rule) and agreed draws are the platform's. */
  const Result: {
    readonly NONE: 0;
    readonly WHITE_MATES: 1;
    readonly BLACK_MATES: 2;
    readonly STALEMATE: 3;
    readonly SEVENTY_FIVE_MOVES: 4;
    readonly FIVEFOLD: 5;
    readonly DEAD_POSITION: 6;
    readonly WHITE_ON_TIME: 7;
    readonly BLACK_ON_TIME: 8;
    readonly WHITE_BY_RESIGNATION: 9;
    readonly BLACK_BY_RESIGNATION: 10;
    readonly DRAW_ON_TIME: 11;
    readonly DRAW_ON_RESIGNATION: 12;
    /** Only in a game under the 50-move rule (moveRule 100). */
    readonly FIFTY_MOVES: 13;
    /** Only in a game under threefold repetition (repetition 3). */
    readonly THREEFOLD: 14;
  };
  /** The draws a player may claim now (Game.claimable), as bits. */
  const Claim: {
    readonly FIFTY_MOVES: 1;
    readonly THREEFOLD: 2;
  };
  /** The castling skeleton of standard chess: one digit per file, 3 king, 1 king-side rook, 2 queen-side rook. */
  const STANDARD_SKELETON: '20003001';

  function fileOf(sq: Square): number;
  function rankOf(sq: Square): number;
  /** 'a1' … 'h8'. */
  function squareName(sq: Square): string;
  /** The square named 'a1' … 'h8', or NO_SQUARE. */
  function parseSquare(text: string): Square;
  function colorOf(piece: Piece): Color;
  function typeOf(piece: Piece): number;
  function opponent(color: Color): Color;

  // ─── Positions and moves ────────────────────────────────────────────────────────────────

  /** Thrown when the engine meets a state it must never be in (an illegal move, a bad argument). */
  class EngineError extends Error {}

  /** Which files hold the castling king and rooks for a whole game (Chess960 rules for all games). */
  class CastlingFiles {
    /** skeleton: eight digits, one per file (default STANDARD_SKELETON). Throws EngineError on a bad skeleton. */
    constructor(skeleton?: string);
    readonly skeleton: string;
    /** The castling rights lost for good when a piece leaves or lands on each square. */
    readonly rightsAt: Uint8Array;
    readonly isStandard: boolean;
  }

  class Position {
    constructor(castlingFiles?: CastlingFiles);
    /** The piece on each square, 0 when empty. */
    board: Uint8Array;
    /** Bitboard words by piece code (squares 0..31 in lo, 32..63 in hi); lo[0]/hi[0] all black pieces, lo[8]/hi[8] all white pieces. */
    lo: Int32Array;
    hi: Int32Array;
    /** The side to move. */
    side: Color;
    /** Castling rights: 1 White king-side, 2 White queen-side, 4 Black king-side, 8 Black queen-side. */
    castling: number;
    /** The en passant square, kept only while a legal capture onto it exists; NO_SQUARE otherwise. */
    ep: Square;
    /** Half-moves since the last capture or pawn move. */
    halfmove: number;
    castlingFiles: CastlingFiles;
    /** The number of moves made in place and not taken back. */
    undoTop: number;
    /** Copies the position (not its undo stack) and returns this. */
    copyFrom(other: Position): this;
    clone(): Position;
    /** Puts a piece on an empty square (EngineError when it is taken). */
    put(sq: Square, piece: Piece): void;
    /** Removes the piece from a square (EngineError when it is empty). */
    remove(sq: Square): void;
    /** The square of the king of `color`. */
    kingSquare(color: Color): Square;
  }

  /** A legal move: promotion says the mover must choose a piece; castle is the king moving onto its own rook. */
  interface Move {
    from: Square;
    to: Square;
    castle: boolean;
    promotion: boolean;
  }

  /** Why a FEN was refused. syntax: not a FEN; kings: not one king a side; pawnrank: a pawn on the
      first or last rank; oppcheck: the side not to move is in check. With strict (the default) also
      the positions no game can reach: pawns (more than 8 a side), pieces (more than 16 men a side),
      promo (more men than the starting set than missing pawns could have become, bishops by the
      colour of their squares), captures (pawns off their files need more captures than the enemy
      men missing), checks (no last move of the other side gives the checks on the side to move). */
  type FenError = 'syntax' | 'kings' | 'pawnrank' | 'oppcheck' | 'pawns' | 'pieces' | 'promo' | 'captures' | 'checks';
  /** What the reader put right instead of refusing: castling rights the board does not allow, an en
      passant square no two-square advance (or, strict, no last move) left, a halfmove clock above 0
      where (strict) only a capture or a pawn move can have given the checks, a move number below
      what the halfmove clock needs. */
  type FenFix = 'castling' | 'en passant' | 'halfmove' | 'fullmove';
  type FenResult =
    | { position: Position; halfmoveGiven: boolean; fullmove: number; fixed: FenFix[]; fen: string; error?: undefined; detail?: undefined }
    | { error: FenError; detail: (string | number)[]; position?: undefined; halfmoveGiven?: undefined; fullmove?: undefined; fixed?: undefined; fen?: undefined };

  /** Reads a FEN (KQkq or Shredder-FEN castling) into a position some game of chess or Chess960 can
      reach: { position, halfmoveGiven, fullmove, fixed, fen } (fen: the FEN with what was put right)
      or { error, detail }. strict: false keeps only syntax, kings, pawnrank and oppcheck. */
  function fromFen(fen: string, options?: { strict?: boolean }): FenResult;
  function toFen(pos: Position, fullmove?: number): string;
  /** The castling field: KQkq for the standard skeleton, Shredder file letters otherwise; '-' without rights. */
  function castlingField(pos: Position): string;
  /** Chess960 starting arrangement n (0..959, Scharnagl's numbering; 518 is standard chess): the white back rank, e.g. 'RNBQKBNR'. */
  function chess960Arrangement(n: number): string;

  /** Is `sq` attacked by a piece of colour `by`? */
  function isAttacked(pos: Position, sq: Square, by: Color): boolean;
  /** Is the side to move in check? */
  function inCheck(pos: Position): boolean;
  /** Plays from → to into dst (a copy of src) and returns dst; src is unchanged. Throws EngineError when the move is not legal. */
  function makeMove(src: Position, dst: Position, from: Square, to: Square, promotion?: Promotion): Position;
  /** The legal moves, in the engine's order (by origin a1 … h8, then by target). */
  function legalMoves(pos: Position): Move[];
  /** Does the side to move have any legal move? */
  function hasLegalMove(pos: Position, ctx?: MoveContext): boolean;
  /** Number of leaf positions after `depth` plies, promotions counted separately. */
  function perft(pos: Position, depth: number): number;
  /** A string equal for two positions exactly when they are the same position (board, side, castling, en passant). */
  function positionKey(pos: Position): string;

  // ─── The arbiter ────────────────────────────────────────────────────────────────────────

  /** The flagged side cannot be mated: its opponent has too little material. */
  function materialCannotMate(pos: Position, flagged: Color): boolean;
  /** The flagged side cannot be mated: the lock detector certifies it (or, a king and pawns, it is
      stalemated by every move the mater can make: see _internal.tempoStalemate). */
  function lockCannotMate(pos: Position, flagged: Color): boolean;
  /** The static tests (material test or lock detector): the flagged side can never be mated. */
  function cannotMate(pos: Position, flagged: Color): boolean;

  /** Bit of the proof that White cannot be mated, for the functions that answer for both sides at once. */
  const FLAGGED_WHITE: 1;
  /** Bit of the proof that Black cannot be mated. */
  const FLAGGED_BLACK: 2;
  /** A set of flagged sides: FLAGGED_WHITE | FLAGGED_BLACK bits. An `ask` argument takes any number
      (FLAGGED_WHITE | FLAGGED_BLACK is a number to TypeScript); only these two bits are read. */
  type FlaggedSides = 0 | 1 | 2 | 3;
  /** The static tests for both sides at once: of the sides in `ask`, those that cannot be mated (cannotMate for each). */
  function cannotMate2(pos: Position, ask: number): FlaggedSides;

  /** The ply ceiling of the Domino search (3). */
  const DOMINO_PLY: number;
  /** The node budget of the Domino search (10); every move played counts, each promotion separately. */
  const DOMINO_BUDGET: number;
  /** The ply ceiling of the Domino search's second tier (9): asked after a failure without a mate that the stuck mater does not mend. */
  const DOMINO_DEEP_PLY: number;
  /** The node budget of the second tier (5,000). */
  const DOMINO_DEEP_BUDGET: number;

  /** Why a search proved nothing: a line mates the flagged king, a line still has moves at the ply ceiling, or the budget ran out. */
  type Failure = 'mate' | 'horizon' | 'budget';

  interface SearchResult {
    proven: boolean;
    /** null when proven. */
    failure: Failure | null;
    budgetLeft: number;
  }

  interface SearchOptions {
    /** false when the caller has already asked the static tests at the root (default true). */
    rootStatic?: boolean;
  }

  /** The Domino search: a short helpmate search without move-count rules. Not re-entrant; one per thread of work. */
  class Domino {
    constructor();
    /** Proves that `flagged` can never be mated, or reports why not. */
    run(root: Position, flagged: Color, maxPly?: number, budget?: number, options?: SearchOptions): SearchResult;
    /** Both searches in one walk: for each side in `ask`, the result run() gives with that side flagged.
        [White flagged, Black flagged]; a side not asked is not proven and keeps its budget. */
    run2(root: Position, ask: number, maxPly?: number, budget?: number, options?: SearchOptions): [SearchResult, SearchResult];
  }

  interface Proof {
    proven: boolean;
    /** The static tests proved it at the root. */
    staticProof: boolean;
    /** null when proven. */
    failure: Failure | null;
    /** 'search' when the search played a line that mates. */
    foundBy: 'search' | null;
    /** The moves the searches played (both tiers). */
    nodes: number;
    /** The second tier ran. */
    deep: boolean;
    /** The stuck mater proved it, after a first search that failed without a mate: whatever the flagged side plays, the mater has no legal move. */
    stuck: boolean;
    /** The searches under the move rule ran, and the answer is theirs. */
    ruled: boolean;
  }

  interface ProofOptions {
    maxPly?: number;
    budget?: number;
    /** The second tier's ply ceiling (default DOMINO_DEEP_PLY). */
    deepPly?: number;
    /** The second tier's node budget (default DOMINO_DEEP_BUDGET); 0: no second tier. */
    deepBudget?: number;
    /** The halfmove clock at which the game ends by itself: 150 (the 75-move rule), 100 (the 50-move rule) or 0 (default: no rule). */
    moveRule?: MoveRule;
    /** The repetition at which the game ends by itself: 5, 3, or 0 (default: no rule). Needs a history. */
    repetition?: Repetition;
    /** The game's positions before this one since its last capture or pawn move (Game.repetitionHistory). */
    history?: RepetitionHistory | null;
  }
  /** A move rule: 0 none, 100 the 50-move rule, 150 the 75-move rule (halfmove clocks). */
  type MoveRule = 0 | 100 | 150;
  /** A repetition rule: 0 none, 3 threefold, 5 fivefold. */
  type Repetition = 0 | 3 | 5;
  /** Position codes (KEY_WORDS words each), n of them. */
  interface RepetitionHistory { keys: Int32Array; n: number; }

  /** Can `flagged` never be mated? The static tests, then the Domino search (6 plies, 100 nodes by
      default) and, where it allows, its second tier (9 plies, 10,000 nodes). */
  function proveCannotBeMated(pos: Position, flagged: Color, options?: ProofOptions): Proof;
  /** proveCannotBeMated for both sides in one pass: [White flagged, Black flagged]. */
  function proveBoth(pos: Position, options?: ProofOptions): [Proof, Proof];
  /** Is the position dead (FIDE 5.2.2)? Both sides proven unable to mate; a single position, no game around it. */
  function isDeadPosition(pos: Position, options?: { moveRule?: MoveRule; repetition?: Repetition; history?: RepetitionHistory | null }): boolean;

  interface StatusOptions {
    /** How many times the current position has occurred (default 1). */
    repetitions?: number;
    /** false: only the static tests can find a dead position (default true). */
    deadPositionSearch?: boolean;
    /** A game whose flags decide the dead position. */
    memory?: Game | null;
    /** 0 (default): the game ends at the 75-move rule, proofs without a rule; 150 or 100: it ends at that rule, proofs under it. With a memory, the game's rule. */
    moveRule?: MoveRule;
    /** 0 (default): the game ends at fivefold repetition; 5 or 3: it ends at that repetition. With a memory, the game's. */
    repetition?: Repetition;
  }

  /** How the game stands: mate, stalemate, dead position, fivefold repetition, the 75-move rule (the endings that need no claim); 0 while it goes on. */
  function gameStatus(pos: Position, options?: StatusOptions): ResultCode;

  interface VerdictOptions {
    /** The side resigned (FIDE 5.1.2) instead of losing on time (FIDE 6.9) (default false). */
    resigned?: boolean;
    maxPly?: number;
    budget?: number;
    deepPly?: number;
    deepBudget?: number;
    moveRule?: MoveRule;
    repetition?: Repetition;
    history?: RepetitionHistory | null;
  }

  /** The verdict when the flag of `side` falls (or it resigns), in a single position: a draw if its opponent can never mate. */
  function flagVerdict(pos: Position, side: Color, options?: VerdictOptions): ResultCode;

  /** The two flags of a game played move by move ("may still mate"): a side whose flag is down has
      been proven unable to mate for the rest of the game. */
  class Flags {
    /** moveRule: the proofs hold for a game that ends at that rule (default 0: no rule). */
    constructor(options?: { moveRule?: MoveRule; repetition?: Repetition; rungs?: 1 | 2 | 3 });
    /** How much of the ladder the flags climb: 1 the material test, 2 and the lock detector, 3 (the default) the whole ladder. */
    readonly rungs: 1 | 2 | 3;
    /** The move rule the flags are proven under. */
    readonly moveRule: MoveRule;
    /** The repetition rule the flags are proven under. */
    readonly repetition: Repetition;
    /** The ply at which White was proven unable to mate; -1 while its flag is up. */
    whiteDownAt: number;
    /** The ply at which Black was proven unable to mate; -1 while its flag is up. */
    blackDownAt: number;
    /** The ply whose position the flags were last brought up to date for; -1 before the first update. */
    updatedPly: number;
    /** The ply whose position updatedEp and updatedCheck describe (the last update's). */
    readonly memoryPly: number;
    /** In that position: did an en passant square stand? */
    readonly updatedEp: boolean;
    /** In that position: was the side to move in a pawn's check? */
    readonly updatedCheck: boolean;
    /** Has `color` been proven unable to mate, for the rest of the game? */
    neverMates(color: Color): boolean;
    /** Climbs the ladder for each side whose flag is still up, at `pos`, the position of game ply `ply`; once per ply. */
    update(pos: Position, ply: number, history?: RepetitionHistory | null): void;
    /** The game is back at ply `ply` (moves taken back): a flag that came down after it goes up again, and the next update is for ply + 1. */
    rewind(ply: number): void;
  }

  /** A platform's own rules for a Game. */
  interface GameOptions {
    /** 150 or 100: the game ends at that rule and its flags are proven under it; 0 (default): it ends at the 75-move rule, flags without a rule. */
    moveRule?: MoveRule;
    /** 5 or 3: the game ends at that repetition and its flags are proven under it; 0 (default): it ends at fivefold, flags without the rule. */
    repetition?: Repetition;
    /** From which halfmove clock a draw may be claimed: 100 (the default) or 0 (no claim). No proof assumes a claim. */
    claimMoves?: 0 | 100;
    /** From which occurrence a draw may be claimed: 3 (the default) or 0 (no claim). */
    claimRepetition?: 0 | 3;
    /** 1 the material test, 2 and the lock detector, 3 (the default) the whole ladder. */
    rungs?: 1 | 2 | 3;
    /** With rungs 3: the searches run only when a flag falls or a side resigns. */
    dominoAtEnd?: boolean;
  }
  /** A game played move by move: its positions, repetitions and the two flags ("may still mate"). */
  class Game {
    /** moveRule 150 or 100: the game ends at that rule and its flags are proven under it; 0 (default): it ends at the 75-move rule, flags without a rule. */
    constructor(position: Position, options?: GameOptions);
    readonly claimMoves: 0 | 100;
    readonly claimRepetition: 0 | 3;
    readonly rungs: 1 | 2 | 3;
    readonly dominoAtEnd: boolean;
    /** The draws a player may claim now: Claim bits (the 50-move rule, threefold repetition). */
    claimable(): number;
    /** The game's move rule. */
    readonly moveRule: MoveRule;
    /** The game's repetition rule. */
    readonly repetition: Repetition;
    /** The positions before the current one that it can still repeat (for a repetition rule). */
    repetitionHistory(): RepetitionHistory;
    /** The current position. */
    position: Position;
    /** How many times the current position has occurred. */
    repetitions: number;
    /** Plies played since the first position. */
    ply: number;
    /** The two flags; the three fields below are this.flags' own. */
    readonly flags: Flags;
    /** The ply at which White was proven unable to mate; -1 while its flag is up. */
    whiteDownAt: number;
    /** The ply at which Black was proven unable to mate; -1 while its flag is up. */
    blackDownAt: number;
    /** The ply whose position the flags were last brought up to date for; -1 before the first update. */
    flagsPly: number;
    /** Has `color` been proven unable to mate, for the rest of the game? */
    neverMates(color: Color): boolean;
    /** Climbs the ladder for each side whose flag is still up, once per position. */
    updateFlags(): void;
    legalMoves(): Move[];
    /** Plays a legal move and returns the game status after it. Throws EngineError when it is not legal. */
    play(from: Square, to: Square, promotion?: Promotion): ResultCode;
    /** The game status of the current position; brings the flags up to date. */
    status(): ResultCode;
    /** The verdict if `side`'s flag falls now (or it resigns), read from the opponent's flag. */
    flagVerdict(side: Color, options?: { resigned?: boolean }): ResultCode;
  }

  // ─── Internals exposed for tests (no stability promise) ─────────────────────────────────

  /** What move generation knows about the side to move. */
  interface MoveContext {
    king: Square;
    checks: 0 | 1 | 2;
    evLo: number;
    evHi: number;
    pinLo: number;
    pinHi: number;
  }

  /** The search's set of positions, keyed by the exact 9-word code. */
  interface PositionSet {
    clear(): void;
    /** Adds code k[at…] with hash h; false when it was there already. */
    add(k: Int32Array, at: number, h: number): boolean;
    /** Adds it for the sides in `live`; returns those of them that had not met it. */
    add2(k: Int32Array, at: number, h: number, live: number): FlaggedSides;
  }

  /** The search under a move rule, bounded by the clock (the second version, src/clock.js): can `flagged`
      be mated before the rule ends the game? Not re-entrant; the ladder keeps one. */
  interface ClockSearch {
    /** repeat: null, or the repetition set; exitDead: the ladder at a position after a capture or a pawn move.
        failure 'horizon': an exit in time that exitDead does not prove dead. */
    run(root: Position, flagged: Color, moveRule: number, budget: number, repeat: PositionSet | null,
        exitDead: (pos: Position, flagged: Color) => { proven: boolean; nodes: number }): SearchResult & { ruled: boolean };
  }

  /** A lock certificate (see lockSets in src/lock.js): squares as [lo, hi], a1 = bit 0 of lo. */
  interface LockSets {
    /** Every square each side's pawns may still reach. */
    readonly wCone: [number, number]; readonly bCone: [number, number];
    /** The pawns that can never move. */
    readonly wFixed: [number, number]; readonly bFixed: [number, number];
    /** Every square each king may ever stand on. */
    readonly wKing: [number, number]; readonly bKing: [number, number];
    /** Every square each side's bishops may ever stand on. */
    readonly wBish: [number, number]; readonly bBish: [number, number];
    /** The frozen king's square, [0, 0] when both kings are free. */
    readonly frozen: [number, number];
    /** With knights, rooks or queens on the board: the boxed ones no enemy king or bishop reaches. */
    readonly boxed?: [number, number];
    /** With boxed pieces: the still bishops, every diagonal neighbour held for good (own fixed pawns,
        boxed pieces or still bishops) and out of the enemy king's and bishops' reach; walls of the boxed pieces. */
    readonly still?: [number, number];
  }

  /** The stuck mater's certificate: the game ends at the mater's next turn. */
  interface LockStuck { readonly stuck: true; }
  /** The stalemated flagged side's certificate: the game ends in a stalemate after the mater's next move. */
  interface LockTempo { readonly tempo: true; }
  /** The forced step's certificate: the one of the position after the only legal move. */
  interface LockForced { readonly forced: LockSets | LockFamilies | LockStuck | LockForced; }

  /** A certificate of the open-pair rule: one family per combination of what the pairs' pawns have done. */
  interface LockFamilies {
    /** Each family's sets; pairs: per open pair 'A' (neither pawn moved), 'B' (the white one stepped into the gap) or 'C' (the black one). */
    readonly families: ReadonlyArray<LockSets & { readonly pairs: string }>;
    readonly frozen: [number, number];
  }

  const _internal: {
    /** fromFen's first step: the FEN as it is written (syntax, kings, pawnrank; what it put right), no reachability checks and no oppcheck; epDeclared: the en passant square written and kept (-1: none), even where no capture onto it is legal. */
    readonly readFen: (fen: string) =>
      | { position: Position; halfmoveGiven: boolean; fullmove: number; fullmoveRead: number; fixed: FenFix[]; epDeclared: number; error?: undefined }
      | { error: 'syntax' | 'kings' | 'pawnrank'; detail: (string | number)[]; position?: undefined };
    /** Writes the legal moves (from | to << 6 | flags << 12) into out[base…] and returns their number. */
    readonly generateLegalMoves: (pos: Position, out: Int32Array, base: number, ctx?: MoveContext) => number;
    /** Plays a generated move in place; promotion is used only by a promoting move. */
    readonly doMove: (pos: Position, move: number, promotion?: number) => void;
    readonly undoMove: (pos: Position) => void;
    readonly writeKey: (pos: Position, out: Int32Array, at: number) => void;
    readonly hashKey: (k: Int32Array, at: number) => number;
    readonly PositionSet: new () => PositionSet;
    /** Computes the squares `by` attacks (into module state). */
    readonly enemyAttacks: (pos: Position, by: Color, occLo: number, occHi: number) => void;
    readonly hasLegalMove: (pos: Position, ctx?: MoveContext) => boolean;
    readonly materialTest: (pos: Position, flagged: Color) => boolean;
    readonly lockTest: (pos: Position, flagged: Color) => boolean;
    readonly lockTest2: (pos: Position, ask: number) => FlaggedSides;
    /** The lock certificate's sets, each a [lo, hi] pair of words; null when there is no lock. With
        first, the first version's (coreLockTest's) certificate. The stuck mater's is { stuck: true },
        the forced step's { forced: <the certificate after the step> }, the stalemated flagged side's { tempo: true }. */
    readonly lockSets: (pos: Position, flagged: Color, first?: boolean) => LockSets | LockFamilies | LockStuck | LockForced | LockTempo | null;
    /** The stuck mater (the second version): the flagged side is to move and, whatever it plays, the mater has no legal move. */
    readonly materStuck: (pos: Position, flagged: Color) => boolean;
    /** The stuck mater, move by move: with the flagged side to move and the mater a king and pawns, every move of the flagged side leaves the mater without a legal move (with quiet, and out of check: a stalemate). */
    readonly stuckEvery: (pos: Position, flagged: Color, quiet?: boolean) => boolean;
    /** The stalemated flagged side (the second version): the flagged side a king and pawns, the mater without a knight, rook or
        queen, no en passant right; with the mater to move, it has a legal move and each one leaves the flagged side without one and
        out of check (a stalemate); with the flagged side to move, it has exactly one legal move, after which every move of the
        mater's (if any) does so. In lockCannotMate, cannotMate and a game's flags, not in the search's static tests. */
    readonly tempoStalemate: (pos: Position, flagged: Color) => boolean;
    /** The first version's lock detector alone (lock/, the scalachess patch): no open pairs, no boxed pieces. */
    readonly coreLockTest: (pos: Position, flagged: Color) => boolean;
    readonly SHARED_CONTEXT: MoveContext;
    readonly FLAG_CASTLE: 1;
    readonly FLAG_EP: 2;
    readonly FLAG_DOUBLE: 4;
    readonly FLAG_PROMO: 8;
    readonly MOVE_STRIDE: 256;
    readonly KEY_WORDS: 9;
    /** The clock search (src/clock.js). */
    readonly ClockSearch: new () => ClockSearch;
    /** The clock search runs where the move rule can end a line within this many plies (or the ply ceiling): 40. */
    readonly REGION_REACH: 40;
  };
}
