/**
 * What a copy of a book is called before anybody renames it.
 *
 * The same default the server falls back to when the ask carries no name, said
 * here so the prompt shows what is about to happen rather than an empty box
 * the reader has to guess at. Pure, because a name is the one thing the reader
 * changes in that box and the suggestion has to be right whatever they started
 * from.
 */

/** "Umber City" becomes "Umber City (copy)". */
export function copyName(name: string): string {
	const trimmed = (name ?? "").trim()
	// A book with no name is not a book the reader can recognise in a list, so
	// the copy is given the same stand-in a nameless book is shown under
	// rather than a name that begins with a bracket.
	return trimmed ? `${trimmed} (copy)` : "Lorebook (copy)"
}
