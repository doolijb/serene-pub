/**
 * What a delete confirmation says before the question (less-confusing G5):
 * the thing by its name, and everything that goes with it. A reader must not
 * discover the cascade afterwards.
 *
 * Pure, so the sentences are tested as sentences and the dialogs only draw
 * them.
 */

/** A lorebook as the book list knows it: its name and its figures. */
export interface DeletingBook {
	name?: string | null
	/** 🚧 The book kind (`lorebooks.kind`): a starter lorebook is said as one. */
	kind?: string | null
	/** Non-archived entries of every type, places included. */
	entryCount?: number | null
	/** Non-archived entries, keyed by entry type id. */
	entryCounts?: Record<string, number> | null
	/** The book's cast members (one binding each). */
	lorebookBindings?: readonly unknown[] | null
}

export interface DeleteBookCopy {
	title: string
	/** One paragraph each, in the order they are read. */
	lines: string[]
}

const plural = (n: number, one: string, many: string) =>
	`${n} ${n === 1 ? one : many}`

/** A name as a title shows it, or null when there is none to show. */
function shownName(name: string | null | undefined): string | null {
	const trimmed = (name ?? "").trim()
	return trimmed ? trimmed : null
}

/**
 * The delete-lorebook confirmation.
 *
 * `book` is the list's row, or null when the list has not got it (the
 * sentence then names what goes without figures). `placeTypeId` picks the
 * places out of `entryCounts`, so they are said as places and still counted
 * among the entries, as the rail counts them. `openSessionName` is the open
 * session's name when THAT session reads this book.
 */
export function deleteBookCopy(
	book: DeletingBook | null,
	opts: { placeTypeId: string; openSessionName?: string | null }
): DeleteBookCopy {
	const name = shownName(book?.name)
	const title = name ? `Delete "${name}"?` : "Delete this lorebook?"

	const lines: string[] = []
	const entries = book?.entryCount
	const cast = book?.lorebookBindings?.length
	if (book && typeof entries === "number" && typeof cast === "number") {
		const places = book.entryCounts?.[opts.placeTypeId] ?? 0
		const entryPart =
			entries === 0
				? "no entries"
				: places > 0
					? `${plural(entries, "entry", "entries")} (${places} of them ${places === 1 ? "a place" : "places"})`
					: plural(entries, "entry", "entries")
		lines.push(
			`Everything in it is deleted with it: ${entryPart}, ${plural(cast, "cast member", "cast members")}, and its history, scenes, relationships and branches.`
		)
	} else {
		lines.push(
			"Everything in it is deleted with it: its entries, cast, places, history, scenes, relationships and branches."
		)
	}

	const session = shownName(opts.openSessionName)
	lines.push(
		session
			? `Sessions reading it, "${session}" among them, keep their messages but stop reading lore from it.`
			: "Sessions reading it keep their messages but stop reading lore from it."
	)
	lines.push("This cannot be undone.")
	return { title, lines }
}

/** The delete-entry confirmation's title: the entry by its name. */
export function deleteEntryTitle(name: string | null | undefined): string {
	const shown = shownName(name)
	return shown ? `Delete "${shown}"?` : "Delete this entry?"
}
