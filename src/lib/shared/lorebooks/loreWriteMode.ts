/**
 * 🚧 **Lore write mode** — how a session may write to its lorebook (owner
 * ruling 2026-09-30, plan A22): **Full**, **Review changes** (the default) or
 * **Off**.
 *
 * One person's answer, for every book they own: a pub default
 * (`system_settings.lore_write_mode_default`) and a per-user override
 * (`user_settings.lore_write_mode`, NULL = follow the pub). A session's
 * book is its owner's, so the mode that governs a session's book writes is the
 * book owner's — never a guest's who took the turn.
 *
 * What each mode does to each flow is the plan's A22 table:
 *
 * - **Full** — a session writes the book as it plays.
 * - **Review changes** — what a session changes on its own waits as a
 *   proposal to accept or reject; what a person saves from a review screen
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
export const DEFAULT_LORE_WRITE_MODE: LoreWriteMode = "review"

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

/** Where the setting lives, as the refusals name it. */
export const LORE_WRITE_MODE_SETTING = "Settings › User › Lorebook writes from sessions"

/**
 * Refused under Off: a save, an apply, a run's change. The mode is the BOOK
 * OWNER's, and this sentence reaches whoever reads the refusal — a guest, a
 * run's receipt — so it names the owner's setting, never the reader's own.
 */
export const LORE_WRITES_OFF =
	`Lorebook writes from sessions are off for this lorebook, so nothing was saved to it. ` +
	`Its owner can change this in ${LORE_WRITE_MODE_SETTING}.`

/**
 * Said before the work, by a review screen that could not save under Off —
 * screens only the lorebook's owner opens, so it names their own setting.
 */
export const LORE_WRITES_OFF_NOTICE =
	`Lorebook writes from sessions are off, so this can't be saved to the lorebook. ` +
	`Change this in ${LORE_WRITE_MODE_SETTING}.`

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
