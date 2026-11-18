//! `piece-hash`: the BLAKE3 a browser needs to verify one piece of a file
//! against its `blake3:` address, built as a WebAssembly module.
//!
//! A `blake3:` address is the root of BLAKE3's binary tree over 1 KiB chunks.
//! Cut at 1 MiB, the tree's pieces are complete subtrees, so the chaining value
//! of each piece can be computed on its own, in any order and on any worker,
//! and the pieces' chaining values fold to the address with BLAKE3's parent
//! rule. That is all this crate does: [`piece_cv`] and [`parent`], on the
//! official implementation's supported `hazmat` API. Everything about which
//! bytes may be used is decided by `Pieces::pieceDecision` in the kernel,
//! whose guarantees Lean proves (HK-39 to HK-42); `web/pieces.mjs` asks this
//! module only for chaining values.
//!
//! On `wasm32` the module exports two buffers and two functions, with no
//! allocator: the caller writes a piece into [`wasm::input`], calls
//! [`wasm::hash_piece`], and reads 32 bytes from [`wasm::cv`]; or writes two
//! chaining values into [`wasm::cv`] and calls [`wasm::merge`].

#![cfg_attr(target_arch = "wasm32", no_std)]

use blake3::hazmat::{merge_subtrees_non_root, merge_subtrees_root, HasherExt, Mode};

/// Bytes per piece: 1 MiB, as in `hologram-space`'s piece tree.
pub const PIECE_LEN: usize = 1 << 20;

/// The chaining value of `bytes` as the BLAKE3 subtree whose first chunk is
/// chunk `chunk_offset` of the whole input, or the input's root hash when
/// `root` is set, which is only meaningful for an input that is one piece.
///
/// An empty non-root subtree does not exist in BLAKE3's tree; asking for one
/// panics, which on `wasm32` traps.
pub fn piece_cv(bytes: &[u8], chunk_offset: u64, root: bool) -> [u8; 32] {
    if root {
        return *blake3::hash(bytes).as_bytes();
    }
    let mut hasher = blake3::Hasher::new();
    hasher.set_input_offset(chunk_offset * blake3::CHUNK_LEN as u64);
    hasher.update(bytes);
    hasher.finalize_non_root()
}

/// The parent of two subtree chaining values: a non-root node, or the root
/// hash when `root` is set.
pub fn parent(left: &[u8; 32], right: &[u8; 32], root: bool) -> [u8; 32] {
    if root {
        *merge_subtrees_root(left, right, Mode::Hash).as_bytes()
    } else {
        merge_subtrees_non_root(left, right, Mode::Hash)
    }
}

/// The exports a page instantiates.
#[cfg(target_arch = "wasm32")]
pub mod wasm {
    use core::ptr::{addr_of, addr_of_mut};

    /// One piece of input. The page writes up to [`super::PIECE_LEN`] bytes
    /// here before calling [`hash_piece`].
    static mut INPUT: [u8; super::PIECE_LEN] = [0; super::PIECE_LEN];
    /// Two chaining values in, one out: [`merge`] reads 64 bytes and writes 32;
    /// [`hash_piece`] writes 32.
    static mut CV: [u8; 64] = [0; 64];

    /// The address of the input buffer, in the module's memory.
    #[no_mangle]
    pub extern "C" fn input() -> *mut u8 {
        addr_of_mut!(INPUT).cast()
    }

    /// The address of the chaining-value buffer, in the module's memory.
    #[no_mangle]
    pub extern "C" fn cv() -> *mut u8 {
        addr_of_mut!(CV).cast()
    }

    /// Hash the first `len` bytes of the input buffer as the piece whose first
    /// chunk is `chunk_offset_hi << 32 | chunk_offset_lo`, as the root when
    /// `root` is not zero, and write the 32-byte result to the start of the
    /// chaining-value buffer.
    #[no_mangle]
    pub extern "C" fn hash_piece(len: u32, chunk_offset_lo: u32, chunk_offset_hi: u32, root: u32) {
        let len = (len as usize).min(super::PIECE_LEN);
        let offset = (u64::from(chunk_offset_hi) << 32) | u64::from(chunk_offset_lo);
        // SAFETY: a WebAssembly instance runs one call at a time, and no
        // reference into INPUT or CV outlives a call, so these are the only
        // references to the two statics while they live; `len` is clamped to
        // INPUT's length.
        let input: &[u8; super::PIECE_LEN] = unsafe { &*addr_of!(INPUT) };
        let out = super::piece_cv(&input[..len], offset, root != 0);
        // SAFETY: as above; `input` is not used after this point.
        let cv: &mut [u8; 64] = unsafe { &mut *addr_of_mut!(CV) };
        cv[..32].copy_from_slice(&out);
    }

    /// Merge the two chaining values at the start of the chaining-value buffer
    /// into their parent, the root hash when `root` is not zero, and write it
    /// over the first 32 bytes.
    #[no_mangle]
    pub extern "C" fn merge(root: u32) {
        // SAFETY: one call at a time, and no reference outlives it.
        let both = unsafe { &mut *addr_of_mut!(CV) };
        let mut left = [0u8; 32];
        let mut right = [0u8; 32];
        left.copy_from_slice(&both[..32]);
        right.copy_from_slice(&both[32..]);
        both[..32].copy_from_slice(&super::parent(&left, &right, root != 0));
    }

    #[panic_handler]
    fn panic(_: &core::panic::PanicInfo) -> ! {
        core::arch::wasm32::unreachable()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// BLAKE3's own fold over pieces: split at the largest power of two below
    /// the count, as `hologram-space`'s `merge` does.
    fn fold(cvs: &[[u8; 32]], root: bool) -> [u8; 32] {
        if cvs.len() == 1 {
            return cvs[0];
        }
        let left = 1usize << (usize::BITS - 1 - (cvs.len() - 1).leading_zeros());
        parent(&fold(&cvs[..left], false), &fold(&cvs[left..], false), root)
    }

    fn root_of(data: &[u8]) -> [u8; 32] {
        let pieces: Vec<&[u8]> = data.chunks(PIECE_LEN).collect();
        if pieces.len() <= 1 {
            return piece_cv(data, 0, true);
        }
        let chunks_per_piece = (PIECE_LEN / blake3::CHUNK_LEN) as u64;
        let cvs: Vec<[u8; 32]> = pieces
            .iter()
            .enumerate()
            .map(|(i, p)| piece_cv(p, i as u64 * chunks_per_piece, false))
            .collect();
        fold(&cvs, true)
    }

    /// Pieces hashed apart and folded give the one-shot hash, at every piece
    /// count from one to nine and across the edges of a piece.
    #[test]
    fn pieces_fold_to_the_one_shot_hash() {
        for len in [
            0,
            1,
            1023,
            1024,
            PIECE_LEN - 1,
            PIECE_LEN,
            PIECE_LEN + 1,
            2 * PIECE_LEN,
            3 * PIECE_LEN + 7,
            5 * PIECE_LEN,
            8 * PIECE_LEN,
            9 * PIECE_LEN - 1,
        ] {
            let data: Vec<u8> = (0..len).map(|i| (i % 251) as u8).collect();
            assert_eq!(
                root_of(&data),
                *blake3::hash(&data).as_bytes(),
                "{len} bytes"
            );
        }
    }

    /// A changed byte in any piece changes that piece's chaining value and the
    /// root, so a verifier holding the table names the piece.
    #[test]
    fn one_changed_byte_changes_its_piece_and_the_root() {
        let data: Vec<u8> = (0..3 * PIECE_LEN).map(|i| (i % 251) as u8).collect();
        let mut bad = data.clone();
        bad[PIECE_LEN + 5] ^= 1;
        let c = (PIECE_LEN / blake3::CHUNK_LEN) as u64;
        assert_eq!(
            piece_cv(&data[..PIECE_LEN], 0, false),
            piece_cv(&bad[..PIECE_LEN], 0, false)
        );
        assert_ne!(
            piece_cv(&data[PIECE_LEN..2 * PIECE_LEN], c, false),
            piece_cv(&bad[PIECE_LEN..2 * PIECE_LEN], c, false)
        );
        assert_ne!(root_of(&data), root_of(&bad));
    }
}
