/**
 * 🚧 **Lore write mode** — how a session may write to its lorebook (owner
 * ruling 2026-09-30, plan A22): **Full** (the default since 2026-10-16,
 * PLAN-rulesets §27: trust the narrator — the timeline makes every change
 * reversible), **Review changes** or **Off**.
 *
 * Three levels, each only ever tightening the one above (owner ruling
 * 2026-10-21, "Personal > Lorebook > Session"):
 *
 * 1. **Personal** — the book owner's own mode (`user_settings.lore_write_mode`,
 *    NULL = follow the pub's `system_settings.lore_write_mode_default`).
 * 2. **Lorebook** — the book's own (`lorebooks.lore_write_mode`, default
 *    Full): it can make writes to THIS book stricter, never looser.
 * 3. **Session** — writes at the stricter of the two (`loreWriteLimit`).
 *
 * A session's book is its owner's, so the personal mode is the BOOK OWNER's
 * — never a guest's who took the turn. Each level says when one above it is
 * stricter (Book settings: the personal mode; session settings: either).
 *
 * What each mode does to each flow is the plan's A22 table:
 *
 * - **Full** — a session writes the book as it plays.
 * - **Review changes** — what a session changes on its own waits in the
 *   session's own notes (🚧 PLAN-rulesets §26) or as a proposal, to accept
 *   or reject; what a person saves from a review screen
 *   (summarize, compile, graph apply) saves, because that screen IS the
 *   review.
 * - **Off** — nothing a session does writes the book; a save or an apply is
 *   refused with `LORE_WRITES_OFF` and an automatic write is skipped.
 *
 * ⚠ Not a genre's **declared writes** (`writes.lore`, `messages/writes.ts`):
 * those say whether a genre's sessions write their book AT ALL; the mode says
 * how, per person, when they may.
 */

/** The three modes, in the order a picker lists them. */
export const LORE_WRITE_MODES = ["full", "review", "off"] as const

export type LoreWriteMode = (typeof LORE_WRITE_MODES)[number]

/** What a pub starts at, and what a user with no choice of their own follows. */
export const DEFAULT_LORE_WRITE_MODE: LoreWriteMode = "full"

/** The picker's words: a label and one line saying what it does. */
export const LORE_WRITE_MODE_CHOICES: Readonly<
	Record<LoreWriteMode, { label: string; description: string }>
> = Object.freeze({
	full: {
		label: "Full",
		description: "Sessions write to your lorebooks as they play."
	},
	review: {
		label: "Review changes",
		description:
			"Changes a session makes on its own wait for you to accept them; what you save yourself is saved."
	},
	off: {
		label: "Off",
		description: "Sessions never write to your lorebooks."
	}
})

/**
 * A lorebook's own choices (Book settings): the same three modes, worded for
 * one book. Full leaves the owner's own setting as the answer.
 */
export const BOOK_LORE_WRITE_MODE_CHOICES: Readonly<
	Record<LoreWriteMode, { label: string; description: string }>
> = Object.freeze({
	full: {
		label: "Full",
		description: "Sessions write to this book as their own settings allow."
	},
	review: {
		label: "Review changes",
		description:
			"Changes a session makes on its own wait for you to accept them, even where your setting is Full."
	},
	off: {
		label: "Off",
		description: "Sessions never write to this book, whatever your setting."
	}
})

/** How strict each mode is: a higher number allows less. */
const STRICTNESS: Readonly<Record<LoreWriteMode, number>> = { full: 0, review: 1, off: 2 }

/** The stricter of two modes — the one that allows less. */
export function stricterLoreWriteMode(a: LoreWriteMode, b: LoreWriteMode): LoreWriteMode {
	return STRICTNESS[a] >= STRICTNESS[b] ? a : b
}

/**
 * What a session may write to a book, and which level set it: the personal
 * mode, tightened by the book's (`stricterLoreWriteMode`). `limitedBy` names
 * the level that is STRICTER than the other — what a screen below annotates —
 * and is null when the two agree. A book with no mode of its own (absent:
 * a session reading none) leaves the personal mode as the answer.
 */
export function loreWriteLimit(opts: {
	personal: LoreWriteMode
	book?: LoreWriteMode | null
}): { mode: LoreWriteMode; limitedBy: "personal" | "lorebook" | null } {
	const book = isLoreWriteMode(opts.book) ? opts.book : null
	if (!book) return { mode: opts.personal, limitedBy: null }
	const mode = stricterLoreWriteMode(opts.personal, book)
	const limitedBy =
		STRICTNESS[book] > STRICTNESS[opts.personal]
			? "lorebook"
			: STRICTNESS[opts.personal] > STRICTNESS[book]
				? "personal"
				: null
	return { mode, limitedBy }
}

/** Where the setting lives, as the refusals name it. */
export const LORE_WRITE_MODE_SETTING = "Settings › User › Lorebook writes from sessions"

/** Where a book's own setting lives. */
export const BOOK_LORE_WRITE_MODE_SETTING = "the lorebook's Book settings"

/**
 * Refused under Off: a save, an apply, a run's change. The mode is the BOOK
 * OWNER's, and this sentence reaches whoever reads the refusal — a guest, a
 * run's receipt — so it names the owner's settings, never the reader's own.
 * Either level can be what is Off, so it names both.
 */
export const LORE_WRITES_OFF =
	`Lorebook writes from sessions are off for this lorebook, so nothing was saved to it. ` +
	`Its owner can change this in ${LORE_WRITE_MODE_SETTING}, or in ${BOOK_LORE_WRITE_MODE_SETTING}.`

/**
 * The notice's sentence on its own: what Off means for this screen. The
 * notice draws it beside a button that opens the setting (less-confusing
 * G6), so the button, not the sentence, says where the setting is.
 */
export const LORE_WRITES_OFF_NOTICE_LEAD =
	"Lorebook writes from sessions are off, so this can't be saved to the lorebook."

/** The notice's button: opens Settings › User, where the setting lives. */
export const LORE_WRITES_OFF_NOTICE_ACTION = "Change it in Settings › User"

/**
 * Said before the work, by a review screen that could not save under Off —
 * screens only the lorebook's owner opens, so it names their own setting.
 * The whole sentence, for a surface that cannot open Settings (an error
 * line, a notice drawn with no shell around it).
 */
export const LORE_WRITES_OFF_NOTICE =
	`${LORE_WRITES_OFF_NOTICE_LEAD} ` +
	`Change this in ${LORE_WRITE_MODE_SETTING}, or in ${BOOK_LORE_WRITE_MODE_SETTING}.`

/** The notice's sentence when it is the BOOK that is Off: its button opens Book settings. */
export const BOOK_LORE_WRITES_OFF_NOTICE_LEAD =
	"This lorebook takes no writes from sessions, so this can't be saved to it."

/** The notice's button when the book is what is Off. */
export const BOOK_LORE_WRITES_OFF_NOTICE_ACTION = "Change it in Book settings"

/** Whether a value is one of the three modes. */
export function isLoreWriteMode(value: unknown): value is LoreWriteMode {
	return typeof value === "string" && (LORE_WRITE_MODES as readonly string[]).includes(value)
}

/**
 * A person's mode: their own choice, else the pub's, else the default.
 * The one resolution rule — the server's `loreWriteModeFor` and a client
 * reading its two settings rows both call it.
 */
export function effectiveLoreWriteMode(
	own: string | null | undefined,
	pub: string | null | undefined
): LoreWriteMode {
	if (isLoreWriteMode(own)) return own
	if (isLoreWriteMode(pub)) return pub
	return DEFAULT_LORE_WRITE_MODE
}
