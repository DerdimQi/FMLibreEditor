//! The maps the game keeps by id (`std::map`), whose nodes the C++ library it was built with lays out its own way.
//!
//! On the Mac (libc++) the map holds its root, a node keeps its left child at `+0` and its right at `+8`, and a
//! missing child is null. On Windows (MSVC) the map holds a head node, which is no entry: the root is the head's
//! `+8`, a node keeps its left child at `+0` and its right at `+0x10`, and a missing child points back at the head,
//! which alone has the byte at `+0x19` set. Both keep a node's key at `+0x20`; the layouts place it.

use fmlibre_mem::{Process, Result, is_user_pointer};
use serde::Deserialize;

/// Where a node of MSVC's tree keeps its right child, and the byte that marks the head.
const MSVC_RIGHT: u64 = 0x10;
const MSVC_IS_HEAD: u64 = 0x19;

/// Whose layout a map's nodes have. A layout that does not say has the Mac's.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Tree {
    /// libc++, the Mac's: the layout places the map's root.
    #[default]
    Libcxx,
    /// MSVC, on Windows: the layout places the map's pointer to its head node.
    Msvc,
}

/// A map being walked: its kind, and the head node its missing children point at (0 where they are null).
#[derive(Debug, Clone, Copy)]
pub(crate) struct Walk {
    tree: Tree,
    head: u64,
}

impl Tree {
    /// The walk of the map the layout places at `at`, and its root, which [`Walk::is_node`] tells from none.
    pub(crate) fn root(self, process: &Process, at: u64) -> Result<(Walk, u64)> {
        match self {
            Tree::Libcxx => Ok((Walk { tree: self, head: 0 }, process.read_u64(at)?)),
            Tree::Msvc => {
                let head = process.read_u64(at)?;
                if !is_user_pointer(head) {
                    return Ok((Walk { tree: self, head }, 0));
                }
                Ok((Walk { tree: self, head }, process.read_u64(head + 8)?))
            }
        }
    }
}

impl Walk {
    /// Whether `node` is an entry of the map: not a missing child, nor the head.
    pub(crate) fn is_node(&self, process: &Process, node: u64) -> Result<bool> {
        if !is_user_pointer(node) || node == self.head {
            return Ok(false);
        }
        Ok(match self.tree {
            Tree::Libcxx => true,
            Tree::Msvc => process.read_bytes(node + MSVC_IS_HEAD, 1)?[0] == 0,
        })
    }

    /// The left and the right child of `node`.
    pub(crate) fn children(&self, process: &Process, node: u64) -> Result<[u64; 2]> {
        let right = match self.tree {
            Tree::Libcxx => 8,
            Tree::Msvc => MSVC_RIGHT,
        };
        Ok([process.read_u64(node)?, process.read_u64(node + right)?])
    }
}
