/**
 * 🚧 **Session notes** — a session's own book as a person meets it, and the
 * Share verbs (pr-6; audit pass 11, rulings R-f and R-p, 2026-10-24). One copy
 * of each sentence: the server answers with them and the client draws them by
 * import, never retyped.
 *
 * Pass 11: "the own book is the session's **Notes** … **Create lorebook from
 * session** becomes **Share as a lorebook**." · R-f: "own books listed in their
 * own section "Session notes", never in pickers; Share as a lorebook moves one
 * to the main list." · R-p: "*Share as a lorebook* becomes a DROP-DOWN with two
 * choices when the own book overlays an attached book: (1) **Share to the
 * attached book** … (2) **Clone with changes and attach**".
 */

/** The Lorebooks view's section of own books. */
export const SESSION_NOTES_LABEL = "Session notes"

export const SHARE_LABELS = Object.freeze({
	/** The one verb when the own book overlays nothing. */
	asLorebook: "Share as a lorebook",
	/** Verb 1 of the drop-down, named by the attached book. */
	toAttached: (book: string): string => `Share to ${book}`,
	/** Verb 2 of the drop-down. */
	cloneWithChanges: "Clone with changes and attach"
})

/** Asked before each verb. */
export const SHARE_CONFIRMS = Object.freeze({
	asLorebook:
		"Share this session's notes as a lorebook? They become a lorebook of your own in Lorebooks, the session reads it from now on, and its notes start again empty.",
	toAttached: (book: string): string =>
		`Share this session's notes to ${book}? Every change in them is written into ${book} at once.`,
	cloneWithChanges: (book: string): string =>
		`Clone ${book} with this session's notes? The copy is a lorebook of your own with every change written in, and the session reads it in place of ${book}. ${book} itself is not changed.`
})

export const SHARE_REFUSALS = Object.freeze({
	missing: "Session not found.",
	notOwner: "Only the session's owner can share its notes.",
	attached:
		"This session reads a lorebook, so its notes are shared to that lorebook or with a copy of it.",
	noBook:
		"This session reads no lorebook, so there is nothing to clone. Share its notes as a lorebook instead."
})

/**
 * The book lock's two refusals (sessions/bookLock.ts re-exports them; pass 11:
 * "refusal offers *Share as a lorebook*"). Said when a session already under way
 * is asked to read another book, or none.
 */
/** No shared book: the session's world is its own book. */
export const NOTES_KEEP_THE_WORLD =
	"This story is already under way in its session notes, so it can't start reading a lorebook now. Share its notes as a lorebook to keep building on them."

/** A shared book: the session keeps reading it. `bookName` arrives quoted (`'Brackenvale'`) or as "its lorebook". */
export const bookFixedSentence = (bookName: string): string =>
	`This story is under way with ${bookName}, so it keeps reading it. Use Share to carry its session notes into ${bookName}, or to clone ${bookName} with them.`
