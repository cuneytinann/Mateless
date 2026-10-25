//! Mateless — can this side still mate? Rust port of `mateless.js`.
//!
//! The same rules, the same static tests (material test, lock detector) and the same Domino search
//! as the JavaScript engine, move for move: legal moves are generated in the same order (from a1,
//! b1, … h8, then by target square), so a search plays the same nodes and spends the same budget.
//! Bitboards are plain `u64` here instead of two 32-bit words. The JavaScript engine's comments
//! explain each rule; each item here names the JavaScript function it comes from.
//!
//! The modules are the layers of the JavaScript sources (`src/`). Mateless itself:
//!   - [`material`]  rung 1: the material test
//!   - [`lock`]      rung 2: the lock detector, and the two static tests together
//!   - [`domino`]    rung 3: the Domino search, 6 plies and 100 nodes, no move-count rules
//!   - [`ladder`]    the rungs put together: [`prove_cannot_be_mated`] and [`prove_both`] for one
//!                   position, [`Flags`] for the two flags of a game played move by move
//!
//! and under it [`board`], a reference board (bitboards, magic bitboards, legal moves, FEN). Every
//! public item is also re-exported here, at the crate root.
//!
//! Unlike the JavaScript engine, nothing here is module state: the lock detector's census and the
//! move-generation context live on the stack, and each `Domino` search owns its memory.
//!
//! MIT License.

pub mod board;
pub mod material;
pub mod lock;
pub mod domino;
pub mod ladder;

pub use board::*;
pub use material::*;
pub use lock::*;
pub use domino::*;
pub use ladder::*;
