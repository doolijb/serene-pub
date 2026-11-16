/**
 * 🚧 The workspace's side of **Move down the tree**: the book's stored rows as
 * the shared rule (`shared/lorebooks/moveDownTheTree`) reads them, and the
 * words the dialog joins. Pure.
 */
import { HISTORY_TYPE_ID } from "$lib/shared/entries/types"
import type { TreeRow } from "$lib/shared/lorebooks/moveDownTheTree"
import type { PoolSource } from "../sections/types"

/** Every wire row of every type, as the rule's `TreeRow`. */
export function treeRowsOf(
	rawRows: Readonly<Record<string, PoolSource[]>>
): TreeRow[] {
	const out: TreeRow[] = []
	for (const rows of Object.values(rawRows))
		for (const row of rows)
			out.push({
				id: row.id,
				name: row.name?.trim() || "Untitled",
				isHistory: row.typeId === HISTORY_TYPE_ID,
				branchId: row.branchId ?? null,
				anchorEntryId: row.anchorEntryId ?? null,
				date:
					typeof row.year === "number"
						? {
								year: row.year,
								month: row.month ?? null,
								day: row.day ?? null
							}
						: null
			})
	return out
}

/** `A`, `A and B`, `A, B and C`. */
export function joinNames(names: readonly string[]): string {
	if (names.length <= 1) return names.join("")
	return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
}

/** The sentences under the list for one chosen line; `along` = entries taken with the asked one. */
export function consequenceSentences(input: {
	along: readonly string[]
	reading: readonly string[]
	source: string
}): string[] {
	const many = input.along.length > 0
	const out: string[] = []
	if (many)
		out.push(
			`Also moves ${joinNames(input.along)}: entries filed under one another move together.`
		)
	if (input.reading.length > 0)
		out.push(
			`${joinNames(input.reading)} will start reading ${many ? "them" : "it"}, and so will the sessions playing on ${input.reading.length === 1 ? "it" : "them"}.`
		)
	out.push(
		`${many ? "Their" : "Its"} dated changes and links written on ${input.source} stay on ${input.source}.`,
		`${many ? "They" : "It"} can't be moved back.`
	)
	return out
}
