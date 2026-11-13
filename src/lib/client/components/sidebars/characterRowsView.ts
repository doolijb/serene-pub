/**
 * 🚧 The Characters view's row, as pure functions: the lines a row says, what a
 * click opens, whether Copy to my characters is offered, and how rows group.
 * No Svelte, no sockets; the rows come from 🚧 `characters:page`
 * (`$lib/shared/characters/characterRows`).
 */
import type { CharacterRow } from "$lib/shared/characters/characterRows"
import { sharedFromLine } from "$lib/shared/utils/sharedRows"

/** The row's reach line: where this character lives, as the asker may see it. */
export function reachLine(row: CharacterRow): string {
	const { lorebookCount, lorebook } = row.reach
	if (lorebookCount === 0) return "Not in a lorebook yet"
	if (lorebookCount === 1) {
		if (!lorebook) return "In 1 lorebook"
		if (lorebook.sessionId != null) {
			return lorebook.sessionName
				? `In ${lorebook.sessionName}'s notes`
				: "In a session's notes"
		}
		return `In ${lorebook.name}`
	}
	return `In ${lorebookCount} lorebooks`
}

/** The meta line's lead: who shared a shared card, else the row's summary. */
export function rowLead(row: CharacterRow): string {
	return row.isSharedWithMe ? sharedFromLine(row) : row.summary
}

/** What a click on a row opens. */
export type CharacterRowDoor =
	| { kind: "card"; cardId: number }
	| { kind: "member"; lorebookId: number; castId: number }
	| null

/** What a click on the row opens: its card where the asker may read it as one, else a cast member in Lorebooks. */
export function rowDoor(row: CharacterRow): CharacterRowDoor {
	if (row.hasCard && row.cardId != null) {
		if (row.cardIsMine || row.isSharedWithMe) {
			return { kind: "card", cardId: row.cardId }
		}
		return row.readableMember
			? {
					kind: "member",
					lorebookId: row.readableMember.lorebookId,
					castId: row.readableMember.castMemberId
				}
			: null
	}
	if (row.castMemberId == null || !row.reach.lorebook) return null
	return {
		kind: "member",
		lorebookId: row.reach.lorebook.id,
		castId: row.castMemberId
	}
}

/** What Copy to my characters is asked to copy. */
export type CopyAsk = { characterId: number } | { castMemberId: number } | null

/** What Copy to my characters would copy, or null where it is not offered (the asker's own card). */
export function copyAsk(row: CharacterRow): CopyAsk {
	if (row.hasCard && row.cardId != null) {
		if (row.cardIsMine) return null
		if (row.isSharedWithMe) return { characterId: row.cardId }
		return row.readableMember
			? { castMemberId: row.readableMember.castMemberId }
			: null
	}
	return row.castMemberId != null ? { castMemberId: row.castMemberId } : null
}

/** The Characters view's groups, each keeping the input order. */
export function rowGroups(
	rows: CharacterRow[],
	folders: { id: number; name: string }[]
): {
	ungrouped: CharacterRow[]
	folders: { folder: { id: number; name: string }; rows: CharacterRow[] }[]
	onlyInLorebooks: CharacterRow[]
	shared: CharacterRow[]
} {
	const ungrouped: CharacterRow[] = []
	const onlyInLorebooks: CharacterRow[] = []
	const shared: CharacterRow[] = []
	const byFolder = new Map<number, CharacterRow[]>()
	for (const f of folders) byFolder.set(f.id, [])
	for (const row of rows) {
		if (row.isSharedWithMe) shared.push(row)
		else if (row.cardIsMine) {
			const bucket =
				row.folderId != null ? byFolder.get(row.folderId) : null
			;(bucket ?? ungrouped).push(row)
		} else onlyInLorebooks.push(row)
	}
	return {
		ungrouped,
		folders: folders
			.map((folder) => ({ folder, rows: byFolder.get(folder.id)! }))
			.filter((g) => g.rows.length > 0),
		onlyInLorebooks,
		shared
	}
}

/** The row's chips in order (Card, then tag names): `first` is the one drawn, `rest` the names behind the +N. */
export function chipsOf(row: CharacterRow): {
	first: string | null
	rest: string[]
} {
	const chips = [
		...(row.hasCard ? ["Card"] : []),
		...row.tags.map((t) => t.name)
	]
	return { first: chips[0] ?? null, rest: chips.slice(1) }
}
