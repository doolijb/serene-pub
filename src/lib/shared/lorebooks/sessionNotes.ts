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
 * attached book** … (2) **Clone with changes and attach**". Clone with changes
 * is replaced by **Merge ‹book› into these notes** (★B-2, 2026-11-08; `FOLD_LABEL`).
 */

/** The Lorebooks view's section of own books. */
export const SESSION_NOTES_LABEL = "Session notes"

export const SHARE_LABELS = Object.freeze({
	/** The one verb when the own book overlays nothing. */
	asLorebook: "Share as a lorebook",
	/** Verb 1 of the drop-down, named by the attached book. */
	toAttached: (book: string): string => `Share to ${book}`
})

/** Asked before each verb. */
export const SHARE_CONFIRMS = Object.freeze({
	asLorebook:
		"Share this session's notes as a lorebook? They become a lorebook of your own in Lorebooks, the session reads it from now on, and its notes start again empty.",
	toAttached: (book: string): string =>
		`Share this session's notes to ${book}? Every change in them is written into ${book} at once.`
})

export const SHARE_REFUSALS = Object.freeze({
	missing: "Session not found.",
	notOwner: "Only the session's owner can share its notes.",
	attached:
		"This session reads a lorebook, so its notes are shared to that lorebook, or that lorebook is merged into them."
})

/**
 * 🚧 **Merge ‹book› into these notes** (★B-2, 2026-11-08; the code says *fold*, `lorebooks/foldInParent.ts`):
 * the attached book copied into the session's own notes, which the session then reads alone.
 */
export const FOLD_LABEL = (book: string): string =>
	`Merge ${book} into these notes`

/** 🚧 Asked before the merge — the ruled sentence (★B-2, 2026-11-08). */
export const FOLD_CONFIRM = (book: string): string =>
	`${book}'s entries, cast, lines and dates are copied in, your changes stay on top, and from then on the session reads only its notes. ${book} is not changed.`

/** 🚧 Said once the merge is done (provisional wording). */
export const FOLD_DONE = (book: string): string =>
	`Merged ${book} into this session's notes.`

/** 🚧 The merge's refusals (provisional wording, for the owner's copy batch). */
export const FOLD_REFUSALS = Object.freeze({
	missing: "Session not found.",
	notOwner: "Only the session's owner can merge a lorebook into its notes.",
	/** A second merge, or a session that never read a shared lorebook. */
	alreadyOwn:
		"This session already reads only its own notes, so there is nothing to merge.",
	/** The in-transaction check found a difference; nothing was written. */
	readsDifferently: (book: string): string =>
		`Nothing was merged: this session would have read its story differently afterwards. It still reads ${book}; share its notes to ${book} instead.`
})

/** 🚧 A surfaced book read by a session that is not its own, a branch or a next chapter (★B-3, 2026-11-08). */
export const SURFACED_BOOK_REFUSAL =
	"This lorebook is another session's story. Start from a copy of it instead."

/** 🚧 The book lock's one refusal (★B-5, 2026-11-08): server, old clients and the Guide alike. */
export const BOOK_LOCK_REFUSAL = "A session keeps the lorebook it started with."

/** 🚧 The edit form's read-only Lorebook line, one per book kind (plan §34.3). `book` is the read book's plain name. */
export const BOOK_LOCK_LINES = Object.freeze({
	ownBook:
		"This session's lorebook is its own notes, and a session keeps the lorebook it started with. Share them as a lorebook to build on them in other sessions.",
	overlay: (book: string): string =>
		`This session reads ${book} and keeps it. Share its notes to ${book}, or merge ${book} into its notes to make the story its own.`
})
