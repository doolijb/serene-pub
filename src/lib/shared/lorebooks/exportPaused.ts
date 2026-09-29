/**
 * Lorebook export is DISABLED (owner ruling 2026-09-28) until the file format
 * settles. The Export action stays visible but disabled with this reason, and
 * the server's `lorebooks:export` handler refuses with the same sentence, so a
 * stale client (or a hand-rolled emit) is told the same thing the button says.
 *
 * Import is unaffected: SillyTavern files and 0.5.x Serene Pub exports still
 * read in. The exporter's code stays — the import's "is this file unchanged?"
 * comparison is built from it.
 */
export const LOREBOOK_EXPORT_PAUSED =
	"Export is paused while the lorebook format settles."
