/**
 * A connection's free-text note, made safe to put in a list row.
 *
 * ⚠ Nothing here reads the note for MEANING. `connections.notes` is display-only
 * (see the column's own comment); this module shortens a string and collapses
 * its whitespace, and that is the whole of its business. It must never grow a
 * parser, a keyword, or a "if the note says X" branch — the moment a note is
 * acted upon, people stop writing notes and start writing incantations.
 */

/**
 * The longest note that will store, mirroring `connections.notes`'
 * `varchar(4000)`.
 *
 * Spelled here so a form's `maxlength` and the column agree by construction —
 * Postgres does not truncate an over-long varchar, it raises, so a form that
 * lets someone type past the cap turns a paste into a failed save with a
 * database error where a note should be.
 */
export const NOTE_MAX_LENGTH = 4000

/**
 * How much of a note a picker row shows before it gives up and defers to the
 * full text.
 *
 * Two lines of a sidebar-width dropdown, roughly. The column caps notes at 4000
 * characters, which is a paste, not a typo: the row has to survive the paste
 * without the popup turning into a wall of text, so the row's budget is set
 * here rather than left to whatever the note happens to be.
 */
export const NOTE_PREVIEW_LIMIT = 120

/**
 * The note as one line, short enough for a picker row.
 *
 * Newlines and runs of spaces collapse to single spaces FIRST, because a pasted
 * note is usually paragraphs: without this a `<option>` renders the raw
 * newlines as nothing at all (native options are single-line) and a CSS
 * line-clamp is measuring lines the author did not intend. Collapsing makes
 * every surface agree on what "the first 120 characters" means.
 *
 * Cut at a word boundary where there is one near the limit, so the preview ends
 * mid-sentence rather than mid-word; a single unbroken 4000-character token —
 * a pasted URL, a base64 blob — has no boundary to find, and is cut flat at the
 * limit rather than being shown in full.
 *
 * Returns `""` for a null, undefined, or whitespace-only note, which every
 * caller can test directly for "show nothing".
 */
export function notePreview(
	note: string | null | undefined,
	limit: number = NOTE_PREVIEW_LIMIT
): string {
	const flat = (note ?? "").replace(/\s+/g, " ").trim()
	if (flat.length <= limit) return flat
	const cut = flat.slice(0, limit)
	// Only accept a boundary in the last quarter of the budget. Further back
	// than that and honouring it would throw away most of the preview to avoid
	// clipping one word.
	const space = cut.lastIndexOf(" ")
	const body = space > limit * 0.75 ? cut.slice(0, space) : cut
	return `${body.trimEnd()}…`
}

/**
 * True when the preview is not the whole note, i.e. the full text is only
 * reachable somewhere else. Callers use it to decide whether a row needs to
 * offer that "somewhere else" at all.
 */
export function noteIsTruncated(
	note: string | null | undefined,
	limit: number = NOTE_PREVIEW_LIMIT
): boolean {
	const flat = (note ?? "").replace(/\s+/g, " ").trim()
	return flat.length > limit
}

/**
 * What the form should store for what was typed: the trimmed text, or NULL for
 * nothing.
 *
 * "Never wrote a note" and "wrote a note then deleted it" are the same fact,
 * and storing `""` for the second spells it a second way — every reader would
 * then have to check both. Whitespace-only counts as nothing for the same
 * reason.
 */
export function normalizeNote(note: string | null | undefined): string | null {
	const trimmed = (note ?? "").trim()
	return trimmed.length ? trimmed : null
}
