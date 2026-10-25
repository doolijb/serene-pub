/**
 * 🚧 The book's **rules library**, as rows of the pool (PLAN-lorebook-kinds
 * §C, ruling 10, lane C2).
 *
 * Owner, 2026-10-21: "lorebooks can show the items still owned by the
 * compendium, but they are hidden by default, when shown they are read only.
 * On edit, they are imported." So a library piece is listed under the book
 * while the **‹Rules› library** chip is on (*Vis Itineris library*,
 * NOMENCLATURE §28 — never bare *Library*), opens read only, and **Edit a
 * copy** (`entries:copyFromLibrary`) copies it in as the book's own entry.
 * Once the book holds a copy (matched on `derivedFrom.piece`), the library's
 * piece is left out: the copy stands in its place.
 *
 * ⚠ A library piece is never lore for a session: retrieval reads what the
 * book holds, and an un-copied piece is not held (owner default).
 */
import type { PoolSource } from "./sections/types"
import { libraryKey, type PoolItem } from "./poolFilter"

/** One piece of the book's rules library, as `lorebooks:library` sends it. */
export type LibraryRow = Sockets.Lorebooks.Library.Response["rows"][number]

/** The book's rules library: its name in the interface, source line and pieces. */
export interface BookLibrary {
	/** "Vis Itineris library" — always qualified; null for rules with none. */
	name: string | null
	source: { document: string; licence: string } | null
	rows: readonly LibraryRow[]
}

/**
 * The pieces the book already holds a copy of, on the line being read, as
 * `<typeId>/<pieceId>` — the copies' `derivedFrom.piece`, under their list.
 */
export function heldLibraryPieces(
	rowsByKind: Record<string, readonly PoolSource[]>
): Set<string> {
	const held = new Set<string>()
	for (const [typeId, rows] of Object.entries(rowsByKind))
		for (const row of rows) {
			const piece = (row as { derivedFrom?: { piece?: unknown } | null })
				.derivedFrom?.piece
			if (typeof piece === "string") held.add(`${typeId}/${piece}`)
		}
	return held
}

/**
 * A library piece as an entry row reads — what the editor draws, read only:
 * the SDK's copy mapping (`primerDerivedEntries`, the one the server's
 * `entries:copyFromLibrary` uses): the piece is the entry's fields, its name
 * the title, its description the content. So what is read is what a copy
 * holds.
 */
export function librarySource(row: LibraryRow, lorebookId: number): PoolSource {
	const piece = row.piece ?? {}
	return {
		...piece,
		id: 0,
		lorebookId,
		typeId: row.typeId,
		name: typeof piece.name === "string" ? piece.name : row.id,
		content: typeof piece.description === "string" ? piece.description : "",
		keys: [],
		enabled: true,
		constant: false,
		archived: false,
		branchId: null,
		libraryPiece: {
			id: row.id,
			version: row.version,
			source: row.source ?? null
		}
	}
}

/** A library piece as a pool row: its own key space, never filed or counted. */
export function libraryPoolItem(row: LibraryRow): PoolItem {
	const piece = row.piece ?? {}
	return {
		key: libraryKey(row.typeId, row.id),
		id: 0,
		kind: row.typeId,
		name: typeof piece.name === "string" ? piece.name : row.id,
		content: typeof piece.description === "string" ? piece.description : "",
		keys: [],
		pinned: false,
		off: false,
		archived: false,
		machineWritten: false,
		parentKey: null,
		branchId: null,
		order: 0,
		position: 0,
		priority: 0,
		createdAt: 0,
		updatedAt: 0,
		fromLibrary: true
	}
}

/**
 * The library pieces a list can show: those of its kinds the book holds no
 * copy of. `kinds` empty is no list at all, never every kind.
 */
export function libraryRowsFor(
	library: BookLibrary | null,
	kinds: ReadonlySet<string>,
	held: ReadonlySet<string>
): LibraryRow[] {
	if (!library) return []
	return library.rows.filter(
		(row) => kinds.has(row.typeId) && !held.has(`${row.typeId}/${row.id}`)
	)
}

/** Whether a list has a library to offer at all — what draws its chip. */
export function libraryOffered(
	library: BookLibrary | null,
	kinds: ReadonlySet<string>
): boolean {
	return !!library?.name && library.rows.some((row) => kinds.has(row.typeId))
}

/**
 * The source line under a library piece: the document and its licence
 * ("System Reference Document 5.2.1 · CC-BY-4.0"), the piece's own before
 * the library's. Null when neither names one.
 */
export function librarySourceLine(
	row: Pick<LibraryRow, "source">,
	library: Pick<BookLibrary, "source"> | null
): string | null {
	const source = row.source ?? library?.source ?? null
	if (!source) return null
	return [source.document, source.licence].filter(Boolean).join(" · ") || null
}
