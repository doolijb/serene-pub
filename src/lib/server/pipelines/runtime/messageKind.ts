/**
 * 🚧 A row's **kind** (`core:outlet/create-message@1`'s `kind` port,
 * 2026-10-17): one word stored as `metadata.kind` — the Dungeon Crawler's
 * journal writes `did` · `found` · `met` · `changed` · `time` · `lead` — which
 * a Messages copy filters on (`rowKinds`) and groups under. Absent (or
 * blank) writes no kind, and a row with none always shows.
 */

/** One word: a letter, then letters, digits or hyphens; at most 32. */
const ONE_WORD = /^[a-z][a-z0-9-]{0,31}$/i

/**
 * The kind a create-message input names: the word, lower-cased; `null` when
 * the port was unwired or blank; `{ refused }` with the sentence when it is
 * not one word (the row is then not written).
 */
export function messageKindOf(raw: unknown): string | null | { refused: string } {
	if (raw == null) return null
	if (typeof raw !== "string") return { refused: "kind takes one word, such as 'did' or 'found'" }
	const word = raw.trim()
	if (!word) return null
	if (!ONE_WORD.test(word)) return { refused: `kind takes one word, such as 'did' or 'found'; '${word.slice(0, 40)}' is not one` }
	return word.toLowerCase()
}
