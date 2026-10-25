/**
 * 🚧 Admin › Rulesets › one ruleset: the **library** form (PLAN-ruleset-
 * editor §6.3 step 7, lane P2) — the ruleset's `compendium`: where its rows
 * come from (`source`, once, at the top) and, per repertoire, its rows
 * (`{ id, version, source?, lang?, piece }`).
 *
 * A row's piece is edited **exactly as the same piece is edited as a
 * lorebook entry** (ruling 6, 2026-10-21): the fields of the derived entry
 * type the server sends (`detail.derivedEntryTypes`), minus the universal
 * entry parts a lorebook adds (priority, supply) — what `pieceListOf`
 * hands the lorebook's own piece helpers (`lorebooks/sections/derivedPiece`).
 * The form keeps each row's piece as STORED (cleaned values), so a row
 * nobody touched writes the object it was read from.
 *
 * Rows also arrive by **Import rows from JSON** (`parseImportedRows`): an
 * array of rows (or one), checked for shape here; a row whose id the list
 * already has replaces it.
 *
 * Pure, pinned by `rulesetContentForms.test.ts`.
 */
import type { FieldDecl } from "@serene-pub/sdk"
import type { PieceList } from "$lib/client/lorebooks/sections/derivedPiece"
import { isObject, newRowUid, setOrDrop, textOf, unchanged, type Json } from "./rulesetFormParts"

export interface LibraryRow {
	uid: string
	id: string
	version: string
	lang: string
	/** The row's own source; blank → the library's. */
	sourceDocument: string
	sourceLicence: string
	/** The piece as stored: what the row form writes cleaned values into. */
	piece: Json
	original: Json | null
}

export interface LibraryList {
	repertoireId: string
	rows: LibraryRow[]
}

export interface LibraryForm {
	/** `compendium.source`: the document the rows come from, and its licence. */
	sourceDocument: string
	sourceLicence: string
	lists: LibraryList[]
}

/** The bookkeeping the dirty check never compares (paths under `RulesetForm`). */
export const LIBRARY_IGNORE = ["library.lists.rows.uid"]

/** A row id: lowercase words joined by '-' (the SDK's `bad-row` rule). */
export const ROW_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const obj = (v: unknown): Json => (isObject(v) ? v : {})
const str = (v: unknown): string => (typeof v === "string" ? v : "")

export function libraryRow(r: Json | null, i: number): LibraryRow {
	const o = obj(r)
	const source = obj(o.source)
	return {
		uid: `library-row-${i}`,
		id: str(o.id),
		version: str(o.version),
		lang: str(o.lang),
		sourceDocument: str(source.document),
		sourceLicence: str(source.licence),
		piece: { ...obj(o.piece) },
		original: r
	}
}

export function newLibraryRow(): LibraryRow {
	return {
		uid: newRowUid(),
		id: "",
		version: "1.0.0",
		lang: "",
		sourceDocument: "",
		sourceLicence: "",
		piece: { name: "", description: "" },
		original: null
	}
}

/** The repertoires whose pieces become lorebook entries (`rulesetEntryable`). */
export function entryableIds(doc: Json): string[] {
	if (Array.isArray(doc.entryable)) return doc.entryable.filter((x): x is string => typeof x === "string")
	return (Array.isArray(doc.repertoires) ? doc.repertoires : [])
		.filter((r) => isObject(r) && r.entryable === true)
		.map((r) => str((r as Json).id))
}

/**
 * The library as the form holds it: a list per entryable repertoire and per
 * repertoire that already has rows, in the draft's repertoire order, then
 * any rows filed under an id the draft does not declare (kept, shown).
 */
export function libraryFormOf(doc: Json): LibraryForm {
	const comp = obj(doc.compendium)
	const source = obj(comp.source)
	const rows = obj(comp.rows)
	const entryable = new Set(entryableIds(doc))
	const repIds = (Array.isArray(doc.repertoires) ? doc.repertoires : []).map((r) => str(obj(r).id)).filter(Boolean)
	const order = [
		...repIds.filter((id) => entryable.has(id) || id in rows),
		...Object.keys(rows).filter((id) => !repIds.includes(id))
	]
	return {
		sourceDocument: str(source.document),
		sourceLicence: str(source.licence),
		lists: [...new Set(order)].map((repertoireId) => ({
			repertoireId,
			rows: (Array.isArray(rows[repertoireId]) ? (rows[repertoireId] as unknown[]) : []).map((r, i) =>
				libraryRow(isObject(r) ? r : null, i)
			)
		}))
	}
}

/** The piece as stored: values the row form cleared (`null`) are left out. */
function storedPiece(piece: Json): Json {
	return Object.fromEntries(Object.entries(piece).filter(([, v]) => v !== null && v !== undefined))
}

export function writeLibraryRow(row: LibraryRow, i: number): unknown {
	if (row.original && unchanged(row, libraryRow(row.original, i))) return row.original
	const orig = row.original ?? {}
	const o: Json = { ...orig, id: row.id.trim(), version: row.version.trim() }
	const doc = row.sourceDocument.trim()
	const licence = row.sourceLicence.trim()
	setOrDrop(o, "source", doc || licence ? { ...obj(orig.source), document: doc, licence } : undefined)
	setOrDrop(o, "lang", row.lang.trim() || undefined)
	o.piece = storedPiece(row.piece)
	return o
}

/** The library over the draft: `compendium.source` and every list's rows. */
export function applyLibrary(out: Json, src: Json, f: LibraryForm): void {
	const was = obj(src.compendium)
	const comp: Json = { ...was }
	const doc = f.sourceDocument.trim()
	const licence = f.sourceLicence.trim()
	setOrDrop(comp, "source", doc || licence ? { ...obj(was.source), document: doc, licence } : undefined)
	const wasRows = obj(was.rows)
	const rows: Json = {}
	for (const list of f.lists) {
		if (!list.rows.length && !(list.repertoireId in wasRows)) continue
		rows[list.repertoireId] = list.rows.map(writeLibraryRow)
	}
	comp.rows = rows
	if (!Object.keys(rows).length && comp.source === undefined && !isObject(src.compendium)) delete out.compendium
	else out.compendium = comp
}

/* ── the row form's fields ───────────────────────────────────────── */

/** What the server sends per entryable repertoire (`RulesetDetail.derivedEntryTypes`). */
export interface DerivedEntryTypeShape {
	repertoireId: string
	entryTypeId: string
	fields: Record<string, FieldDecl>
}

/**
 * The fields a library row of `repertoireId` is edited with, as the
 * lorebook's piece helpers take them: the derived entry type's fields minus
 * the universal entry parts (only the keys the saved repertoire's piece
 * declares), or — for a repertoire that becomes no entry type — its saved
 * piece shape itself, which is the same set. Null for a repertoire the saved
 * draft does not have yet.
 */
export function pieceListOf(
	repertoireId: string,
	savedDoc: Json,
	derived: readonly DerivedEntryTypeShape[]
): PieceList | null {
	const rep = (Array.isArray(savedDoc.repertoires) ? savedDoc.repertoires : []).find(
		(r) => isObject(r) && r.id === repertoireId
	) as Json | undefined
	if (!rep) return null
	const pieceFields = obj(obj(rep.piece).fields) as Record<string, FieldDecl>
	const type = derived.find((d) => d.repertoireId === repertoireId)
	const fields = type
		? (Object.fromEntries(Object.entries(type.fields).filter(([k]) => k in pieceFields)) as Record<string, FieldDecl>)
		: pieceFields
	return {
		typeId: type?.entryTypeId ?? repertoireId,
		label: textOf(rep.label) || repertoireId,
		repertoireId,
		piece: { type: "object", fields } as FieldDecl
	}
}

/* ── Import rows from JSON ───────────────────────────────────────── */

export type ImportedRows = { ok: true; rows: Json[] } | { ok: false; errors: string[] }

const ROW_KEYS = new Set(["id", "version", "source", "lang", "piece"])

/**
 * Rows pasted as JSON — an array of `{ id, version, source?, lang?, piece }`,
 * or one — checked for shape (what the piece's own fields say is the
 * server's check, after Save). Every problem is one sentence, by row.
 */
export function parseImportedRows(text: string): ImportedRows {
	let value: unknown
	try {
		value = JSON.parse(text)
	} catch (e) {
		return { ok: false, errors: [`This is not valid JSON (${e instanceof Error ? e.message : String(e)}).`] }
	}
	const list = Array.isArray(value) ? value : isObject(value) ? [value] : null
	if (!list || !list.length)
		return { ok: false, errors: ["Paste one row, or a list of rows: [{ \"id\": …, \"version\": …, \"piece\": { … } }]."] }
	const errors: string[] = []
	const seen = new Set<string>()
	list.forEach((r, i) => {
		const at = `Row ${i + 1}`
		if (!isObject(r)) {
			errors.push(`${at} is not an object.`)
			return
		}
		const extra = Object.keys(r).filter((k) => !ROW_KEYS.has(k))
		if (extra.length)
			errors.push(
				`${at} says ${extra.map((k) => `“${k}”`).join(", ")} beside its bookkeeping. A row is { id, version, source?, lang?, piece }: its fields go inside “piece”.`
			)
		if (typeof r.id !== "string" || !ROW_ID.test(r.id))
			errors.push(`${at}: its id is ${JSON.stringify(r.id ?? null)}. An id is lowercase words joined by “-”, like long-sword.`)
		else if (seen.has(r.id)) errors.push(`${at} repeats the id “${r.id}”.`)
		else seen.add(r.id)
		if (typeof r.version !== "string" || !r.version.trim()) errors.push(`${at} has no version, like "1.0.0".`)
		if (r.source !== undefined) {
			const s = r.source
			if (!isObject(s) || typeof s.document !== "string" || !s.document.trim() || typeof s.licence !== "string" || !s.licence.trim())
				errors.push(`${at}: its source is { "document", "licence" }, both said.`)
		}
		if (r.lang !== undefined && (typeof r.lang !== "string" || !r.lang.trim())) errors.push(`${at}: its lang is a language tag, like "en".`)
		if (!isObject(r.piece)) errors.push(`${at} has no piece: { "name", "description", … }.`)
		else if (typeof r.piece.name !== "string" || !r.piece.name.trim()) errors.push(`${at}: its piece has no name.`)
	})
	return errors.length ? { ok: false, errors } : { ok: true, rows: list as Json[] }
}

/** Imported rows into a list: a row whose id is there replaces it, the rest are added. */
export function mergeImported(rows: LibraryRow[], imported: readonly Json[]): { rows: LibraryRow[]; added: number; replaced: number } {
	const next = [...rows]
	let added = 0
	let replaced = 0
	for (const raw of imported) {
		const row = { ...libraryRow(raw, 0), uid: newRowUid(), original: null }
		const at = next.findIndex((r) => r.id === row.id)
		if (at >= 0) {
			next[at] = row
			replaced++
		} else {
			next.push(row)
			added++
		}
	}
	return { rows: next, added, replaced }
}
