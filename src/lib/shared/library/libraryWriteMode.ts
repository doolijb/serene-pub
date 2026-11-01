/**
 * 🚧 **Library write mode** (M2c path B): how a session may add to or change
 * the person's library — characters and lorebooks — on their behalf. Full
 * writes at once, Review waits in the session for Accept, Off writes nothing.
 * Stored as `user_settings.library_write_mode`; NULL reads Review.
 *
 * ⚠ Not the **lore write mode** (`lorebooks/loreWriteMode.ts`), which is how
 * a session may change the lorebook it reads. The two share the three words.
 */
import type { LoreWriteMode } from "$lib/shared/lorebooks/loreWriteMode"

export type LibraryWriteMode = LoreWriteMode

/** What a person with no choice of their own gets. */
export const DEFAULT_LIBRARY_WRITE_MODE: LibraryWriteMode = "review"

export function isLibraryWriteMode(value: unknown): value is LibraryWriteMode {
	return value === "full" || value === "review" || value === "off"
}

/** The mode in force for a stored value: theirs, else Review. */
export function effectiveLibraryWriteMode(stored: unknown): LibraryWriteMode {
	return isLibraryWriteMode(stored) ? stored : DEFAULT_LIBRARY_WRITE_MODE
}

/** The picker's words: a label and one plain line each. */
export const LIBRARY_WRITE_MODE_CHOICES: Readonly<
	Record<LibraryWriteMode, { label: string; description: string }>
> = Object.freeze({
	full: {
		label: "Full",
		description: "What Serene or a session adds to your library is added at once. Back takes it back."
	},
	review: {
		label: "Review (default)",
		description: "It waits in the session for you to accept it."
	},
	off: {
		label: "Off",
		description: "Nothing is added to your library."
	}
})

/** The card's heading and its one sentence. */
export const LIBRARY_WRITE_MODE_TITLE = "Library write mode"
export const LIBRARY_WRITE_MODE_HELP = "When Serene or a session adds to your library."
