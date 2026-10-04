/**
 * What deleting a line does, in the words the delete confirmation shows
 * (BranchChip) — sentence by sentence, after "Deleting ‹line›". The server's
 * `amendments:deleteBranch` is what it describes; a change there is a change
 * here.
 */
import type { StoryDate } from "$lib/shared/lorebooks/storyDate"

export interface DeletedLine {
	/** The line's name. */
	name: string
	/** The name of the line it forked from ("main" for main). */
	leftFrom: string
	/** Where it forked, or null when it forked at now. */
	forkDate: StoryDate | null
	/** Whether any line forked from it. */
	hasForks: boolean
}

/**
 * The confirmation's sentences. The first continues "Deleting ‹line›"; `spell`
 * writes a date as the book does.
 */
export function deleteLineWarning(line: DeletedLine, spell: (date: StoryDate) => string): string[] {
	const out = [
		"removes everything written on it: its amendments, its own entries, its scenes, the relationships drawn on it, the placements made on it and the stats recorded on it.",
		"A place written only on it takes all its stats with it, wherever they were recorded.",
		"Shared entries stay."
	]
	if (line.forkDate === null)
		out.push(
			`Sessions played on it move to ${line.leftFrom}, the line it forked from, and keep their story clock.`
		)
	else {
		const date = spell(line.forkDate)
		out.push(
			`Sessions played on it move to ${line.leftFrom}, the line it forked from.`,
			`A session's story clock stays where it is, unless it is later than ${date}, where ${line.name} forked; then it goes back to ${date}.`
		)
	}
	if (line.hasForks)
		out.push(
			`Lines forked from it will fork straight from ${line.leftFrom}, at the earlier of the two fork dates.`,
			`They lose what was written on ${line.name} and what they wrote about its entries.`,
			`A history entry of ${line.name} that something of theirs is dated by, filed under or written about moves to them instead, so their stats, links and scenes keep their dates.`
		)
	return out
}
