/**
 * How the workspace's one copy of the book follows a write without asking
 * for the book again (plans B4, B5). Pure, so each rule is tested on its own;
 * `LorebooksWorkspace` applies them to its state.
 */
import type { PoolSource } from "./sections/types"

type Rows = Readonly<Record<string, PoolSource[]>>

/**
 * The rows without the entry a delete took (B5). The reply names the book,
 * the row and its type; a reply without a type drops the id from every type
 * (entries are one table, so the id names one row). Unchanged when the row
 * was not held.
 */
export function dropDeletedEntry(
	rows: Rows,
	deleted: { entryId: number; typeId?: string | null }
): Record<string, PoolSource[]> {
	const drop = (list: PoolSource[]) => list.filter((row) => row.id !== deleted.entryId)
	if (deleted.typeId && rows[deleted.typeId])
		return { ...rows, [deleted.typeId]: drop(rows[deleted.typeId]!) }
	return Object.fromEntries(
		Object.entries(rows).map(([typeId, list]) => [typeId, drop(list)])
	)
}

/**
 * What about the cast the graph draws from (B5): who, named what, carded as
 * whom, in what state, folded into whom. Every entry save cascades the cast
 * list, and the graph was read again on each one; it is read again only when
 * this moves.
 */
export function castSignature(
	rows: readonly {
		id: number
		name?: string | null
		characterId?: number | null
		nodeState?: string | null
		nodeVisibility?: string | null
		parentNodeId?: number | null
	}[]
): string {
	return rows
		.map(
			(r) =>
				`${r.id}:${r.name ?? ""}:${r.characterId ?? ""}:${r.nodeState ?? ""}:${r.nodeVisibility ?? ""}:${r.parentNodeId ?? ""}`
		)
		.join("|")
}

/**
 * The rows with one entry's embedding badge moved (B4). The vectorizer
 * reports in source kinds (`worldLore` covers world lore, items and places),
 * so every type reporting under that kind is searched for the id. Null when
 * no held row is that one — nothing to patch.
 */
export function patchEmbedding(
	rows: Rows,
	msg: { type: string; id: number; embeddingModel: string | null },
	sourceKindOf: (typeId: string) => string | undefined
): Record<string, PoolSource[]> | null {
	const typeId = Object.keys(rows).find(
		(kind) =>
			sourceKindOf(kind) === msg.type &&
			rows[kind]!.some((row) => row.id === msg.id)
	)
	if (!typeId) return null
	return {
		...rows,
		[typeId]: rows[typeId]!.map((row) =>
			row.id === msg.id
				? ({ ...row, embeddingModel: msg.embeddingModel } as PoolSource)
				: row
		)
	}
}

/** The scenes with one saved scene's fields laid over its row (B4). */
export function patchScene<T extends Record<string, any>>(
	scenes: readonly T[],
	saved: { id: number } & Record<string, unknown>
): T[] {
	return scenes.map((row) => (row.id === saved.id ? ({ ...row, ...saved } as T) : row))
}
