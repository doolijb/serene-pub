/**
 * Ceilings a lorebook's shape is held to, shared by every writer that holds it.
 */

/**
 * How deep **Part of** nests (`anchor_entry_id`), and how far a walk up a
 * chain of parents goes before it calls the chain a loop.
 *
 * A tree that deep is not a tree anybody is reading, and an unbounded walk over
 * a chain that already contains a cycle never returns. Refusing at the ceiling
 * is the same answer as refusing a cycle: this parent cannot be set.
 *
 * One number for the re-parent (`assertAnchorEntry`, which `entries:*` and a
 * dated re-parent in `amendments:*` both call) and for the import
 * (`resolveAnchorEntryLinks`): the import refuses exactly what the editor
 * would.
 */
export const MAX_ANCHOR_DEPTH = 32
