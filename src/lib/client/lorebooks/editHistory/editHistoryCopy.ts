/**
 * 🚧 The words of an entry's or a scene's **Edit history** (`lore_redlines`): the fold,
 * its rows, the three clear confirmations and the Admin › Data row. All
 * provisional copy (owner has not seen it). One file, so the fold, Book
 * settings and the admin row read alike.
 */
import { formatBytes } from "$lib/client/components/media/spokenLines"

type Cause = Sockets.RedlineView["cause"]

/** What the edit was, beside who made it: *You · Saved · 5 minutes ago*. */
export const REDLINE_CAUSE_LABELS: Readonly<Record<Cause, string>> =
	Object.freeze({
		save: "Saved",
		routine: "Wrote",
		apply: "Applied",
		revert: "Reverted",
		"take-back": "Took back",
		restore: "Restored",
		"scene-compiler": "Listed who spoke"
	})

/** "1 edit", "3 edits". */
export const editsCount = (n: number): string =>
	`${n} ${n === 1 ? "edit" : "edits"}`

/** The fold's summary: "Edit history · 3 edits". */
export const editHistoryFoldLabel = (n: number): string =>
	`Edit history · ${editsCount(n)}`

/** A dated change's row says which: "On the change from Year 7". */
export const versionLine = (version: string): string => `On ${version}`

export const RESTORE_LABEL = "Restore"
export const RESTORE_TITLE = "Put back what this edit replaced"
export const SHOW_LABEL = "Show"
export const HIDE_LABEL = "Hide"
export const BEFORE_LABEL = "Before"
export const AFTER_LABEL = "After"

/** The ⋯ menu's item and Book settings' action. */
export const CLEAR_ACTION_LABEL = "Clear edit history…"
export const CLEAR_CONFIRM_LABEL = "Clear edit history"

export const CLEAR_ENTRY_QUESTION = "Clear this entry's edit history?"
export const clearEntrySentence = (n: number): string =>
	`Removes its ${editsCount(n)}. The entry stays as it is now; its earlier versions can no longer be restored.`

export const CLEAR_VERSION_QUESTION = "Clear this version's edit history?"
export const clearVersionSentence = (n: number): string =>
	`Removes its ${editsCount(n)}. The version stays as it is now; what it said before can no longer be restored.`

/** A cast version's key that reads its card's value says so instead of a value. */
export const FOLLOWS_CARD_TEXT = "(follows the card)"
/** A picture's change: only that it changed. */
export const NO_PREVIEW_TEXT = "changed"
/** Why Restore waits while a form holds unsaved typing. */
export const RESTORE_BLOCKED_UNSAVED = "Save or discard your changes first."

export const CLEAR_BOOK_QUESTION = "Clear this lorebook's edit history?"
export const clearBookSentence = (n: number): string =>
	`Removes ${editsCount(n)} across its entries, cast and scenes. Every entry, cast member and scene stays as it is now; what they said before can no longer be restored.`

export const CLEAR_ALL_QUESTION = "Clear every edit history on this pub?"
export const clearAllSentence = (n: number): string =>
	`Removes ${editsCount(n)} across this pub. Entries, cast members and cards stay as they are now; what they said before can no longer be restored.`

/** Book settings' hint under its action. */
export const CLEAR_BOOK_HINT =
	"What this lorebook's entries, cast and scenes said before each edit."

/** Admin › Data: the card, the row, and what clearing loses. */
export const ADMIN_CARD_TITLE = "Edit history"
export const ADMIN_CARD_HELP =
	"What entries, cast members and cards said before each edit, kept on this pub."
export const adminRowLabel = (count: number, bytes: number): string =>
	`Edit history · ${editsCount(count)} · ${formatBytes(bytes)}`
export const ADMIN_CLEAR_LOSES =
	"Clearing removes every kept edit; entries, cast members and cards stay as they are now."

/** A kept value in words: absent, empty, a list, a switch, a number or text. */
export function redlineValueText(value: unknown, absent: boolean): string {
	if (absent) return "(not set)"
	if (value === null || value === undefined || value === "") return "(empty)"
	if (Array.isArray(value))
		return value.length ? value.map((v) => String(v)).join(", ") : "(empty)"
	if (typeof value === "boolean") return value ? "Yes" : "No"
	if (typeof value === "number" || typeof value === "string")
		return String(value)
	return JSON.stringify(value)
}

/** Short enough to read as *before → after* on one line; longer text sits behind **Show**. */
export function isShortChange(before: string, after: string): boolean {
	const short = (s: string) => s.length <= 80 && !s.includes("\n")
	return short(before) && short(after)
}
