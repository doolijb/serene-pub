/**
 * The sentences an overwrite-import's confirmation shows about what it will
 * delete, or change, that the file cannot bring back (`conflict.losses` from
 * `lorebooks:import`): what goes — a session's stats on a place and the stat
 * sheets from any file, since no file carries them — then, for a file older
 * than places and items, what comes back as world lore, then what sessions
 * lose of what they hold from the book, since every entry comes back new.
 * Null when there is nothing of that kind to lose, so the prompt says nothing
 * rather than "deletes 0 branches".
 */
export function describeOverwriteLosses(
	losses: Sockets.Lorebooks.OverwriteLosses | null | undefined
): string | null {
	if (!losses) return null
	const plural = (n: number, one: string, many: string) =>
		`${n} ${n === 1 ? one : many}`
	const parts = [
		losses.amendments > 0 &&
			plural(losses.amendments, "dated change", "dated changes"),
		losses.presences > 0 &&
			plural(losses.presences, "presence", "presences"),
		losses.branches > 0 && plural(losses.branches, "branch", "branches"),
		losses.sceneLinks > 0 &&
			plural(
				losses.sceneLinks,
				"scene captured from a session",
				"scenes captured from a session"
			),
		losses.stats > 0 && plural(losses.stats, "stat", "stats"),
		losses.sessionStats > 0 &&
			plural(
				losses.sessionStats,
				"stat a session set on its places",
				"stats sessions set on its places"
			),
		losses.sheets > 0 && plural(losses.sheets, "stat sheet", "stat sheets")
	].filter((p): p is string => !!p)
	const retyped = [
		losses.places > 0 && plural(losses.places, "place", "places"),
		losses.items > 0 && plural(losses.items, "item", "items")
	].filter((p): p is string => !!p)
	const listOf = (items: string[]) =>
		items.length === 1
			? items[0]
			: `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`
	const sentences: string[] = []
	if (parts.length) {
		const total =
			losses.amendments +
			losses.presences +
			losses.branches +
			losses.sceneLinks +
			losses.stats +
			losses.sessionStats +
			losses.sheets
		sentences.push(
			total === 1
				? `Overwriting also deletes ${listOf(parts)}. The file does not carry it, so it cannot come back.`
				: `Overwriting also deletes ${listOf(parts)}. The file does not carry them, so they cannot come back.`
		)
	}
	if (retyped.length)
		sentences.push(
			`${listOf(retyped)} ${losses.places + losses.items === 1 ? "comes" : "come"} back as world lore, because this file is older than places and items.`
		)
	const held = losses.sessionLoreRefs
	if (held > 0)
		sentences.push(
			held === 1
				? "A session loses 1 thing it holds from this book, such as an item carried or the place someone is in, because overwriting replaces every entry."
				: `Sessions lose ${held} things they hold from this book, such as an item carried or the place someone is in, because overwriting replaces every entry.`
		)
	// Either choice rewrites them: the file's embedded cards are restored by
	// uuid whether the book is overwritten or imported as new.
	const rewritten = losses.charactersRewritten ?? 0
	if (rewritten > 0)
		sentences.push(
			rewritten === 1
				? "Importing this file also rewrites 1 of your characters from the copy it carries, whichever you choose."
				: `Importing this file also rewrites ${rewritten} of your characters from the copies it carries, whichever you choose.`
		)
	return sentences.length ? sentences.join(" ") : null
}
