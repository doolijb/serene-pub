/**
 * 🚧 A rules list entry's own fields (PLAN-lorebook-kinds §C, lane C1).
 *
 * An entry of a rules list — a Vis Itineris weapon, a Freeform condition — is
 * a lorebook entry whose type is derived from one of its rules' lists: the
 * universal entry fields (name, content, keywords, priority, supply), and
 * beside them the list's **piece shape** (description, damage, range…). This
 * is the plain-TypeScript half of its editor (`DerivedEntryEditor.svelte`),
 * built on the piece helpers core-catalog exports for exactly this
 * (`@serene-pub/core-catalog/session-state`): which fields the form draws
 * (`pieceFormFields`), the form's draft (`pieceDraftOf`), and what saving it
 * writes, refusal included (`pieceFromDraft` → `checkPiece`, the write
 * gate's own check).
 *
 * ⚠ The piece's `name` is the entry's title — it rides the row's `name`
 * column and the core fields' Name box, never a second box here.
 */
import {
	pieceDraftOf,
	pieceFormFields,
	pieceFromDraft,
	type PieceContext
} from "@serene-pub/core-catalog/session-state"
import type { FieldDecl } from "@serene-pub/sdk"
import { SvelteMap } from "svelte/reactivity"
import { i18nTextIn } from "$lib/shared/i18n/i18nText"
import { rememberRulesListLabels } from "./kinds"

/** What the editor needs of a list: its label and its piece shape. */
export interface PieceList {
	typeId: string
	label: string
	repertoireId: string
	piece: FieldDecl
}

/**
 * The piece fields that are its HOLDER's, never the entry's: whether it is
 * worn or wielded, and how long it lasts on them (the universal `equipped`
 * and `duration` parts — "how long a piece lasts on its holder"). A book's
 * weapon is the weapon; who holds it, and how, is a sheet's.
 */
const HOLDER_FIELDS = new Set(["equipped", "duration"])

/** The piece's own title field, which is the entry's Name. */
const TITLE_FIELD = "name"

const contextOf = (
	list: PieceList,
	piece: FieldDecl = list.piece
): PieceContext => ({
	repertoireId: list.repertoireId,
	repertoire: { label: list.label, piece }
})

/** A list of words, typed as one line ("finesse, light"). */
export const isWordList = (decl: FieldDecl): boolean =>
	decl.type === "list" && (!decl.item || decl.item.type === "string")

/**
 * The fields the editor draws, in the list's own order: the piece shape's,
 * without its name (the Name box), the holder's parts, or a list of records
 * (no control draws one yet — its value is kept as stored).
 */
export function pieceFields(list: PieceList): Array<[string, FieldDecl]> {
	return pieceFormFields(contextOf(list), {
		kind: "inline",
		name: ""
	} as never).filter(
		([key, decl]) =>
			key !== TITLE_FIELD &&
			!HOLDER_FIELDS.has(key) &&
			(decl.type !== "list" || isWordList(decl))
	)
}

/** The piece half of an entry row: its piece fields, as stored. */
function pieceValuesOf(
	row: Record<string, unknown>,
	list: PieceList
): Record<string, unknown> {
	const out: Record<string, unknown> = {}
	for (const [key] of pieceFields(list))
		if (row[key] !== undefined && row[key] !== null) out[key] = row[key]
	return out
}

/**
 * The form's draft for one entry: its piece values, a list of words as one
 * line (`pieceDraftOf` does `traits`; every list of words reads the same).
 */
export function pieceFormDraft(
	row: Record<string, unknown>,
	list: PieceList
): Record<string, unknown> {
	const values = pieceDraftOf(
		{ kind: "inline", ...pieceValuesOf(row, list) } as never,
		contextOf(list)
	)
	for (const [key, decl] of pieceFields(list))
		if (isWordList(decl) && Array.isArray(values[key]))
			values[key] = (values[key] as unknown[]).join(", ")
	return values
}

/** The shape with nothing required and no bounds: what cleans a draft without judging it. */
function relaxed(decl: FieldDecl): FieldDecl {
	const {
		required: _r,
		min: _min,
		max: _max,
		...rest
	} = decl as FieldDecl & {
		required?: boolean
		min?: number
		max?: number
	}
	const out = { ...rest } as FieldDecl
	if (decl.fields)
		out.fields = Object.fromEntries(
			Object.entries(decl.fields).map(([k, d]) => [k, relaxed(d)])
		)
	return out
}

/**
 * What the form holds, as the entry stores it: each drawn field's value
 * cleaned (blanks dropped, numbers read, a line of words split), or `null`
 * where the form holds nothing — a cleared field, absent-not-null on the
 * server. Never judged: a draft half typed is still the draft.
 */
export function pieceStorageValues(
	form: Record<string, unknown>,
	list: PieceList
): Record<string, unknown> {
	const loose = pieceFromDraft(
		{ kind: "inline", name: "" } as never,
		{ ...form, [TITLE_FIELD]: "draft" },
		1,
		contextOf(list, relaxed(list.piece))
	)
	const cleaned = (loose.piece ?? {}) as Record<string, unknown>
	const out: Record<string, unknown> = {}
	for (const [key] of pieceFields(list)) out[key] = cleaned[key] ?? null
	return out
}

/** Why an entry's piece half would be refused, said for a person, and which field it is about. */
export interface PieceProblem {
	/** The top-level field the refusal names, when it names one the form draws. */
	field: string | null
	message: string
}

/**
 * Whether an entry's piece half can be saved: the write gate's own check
 * (`pieceFromDraft` → `checkPiece`) over its name and stored piece values.
 * Null when it can.
 */
export function pieceProblem(
	row: Record<string, unknown>,
	list: PieceList
): PieceProblem | null {
	const values: Record<string, unknown> = { [TITLE_FIELD]: row.name ?? "" }
	for (const [key] of pieceFields(list))
		if (row[key] !== undefined && row[key] !== null) values[key] = row[key]
	// The stored values, as the form would hold them, so the one cleaning
	// path reads them (a list of words is already a list here).
	const { refusal } = pieceFromDraft(
		{ kind: "inline", name: "" } as never,
		values,
		1,
		contextOf(list)
	)
	return refusal ? explainRefusal(refusal, list) : null
}

/** A field's label, by its path in the piece shape ("damage.dice" → "Dice"). */
function labelAt(list: PieceList, path: string[]): string | null {
	let decl: FieldDecl | undefined = list.piece
	for (const key of path) decl = decl?.fields?.[key]
	return decl
		? (i18nTextIn(decl.label as never) ?? path[path.length - 1] ?? null)
		: null
}

/**
 * The checker's refusal, said for a person. The checker names a field by
 * its path in quotes (`'damage.dice' is required and not set`); the common
 * ones are worded from the field's label, anything else is shown as the
 * checker said it.
 */
export function explainRefusal(refusal: string, list: PieceList): PieceProblem {
	const m = /'([A-Za-z0-9_.[\]]+)'\s+(.*?)\.?$/.exec(
		refusal.split("; ")[0] ?? refusal
	)
	if (!m) return { field: null, message: refusal }
	const path = m[1]!.replace(/\[\d+\]/g, "").split(".")
	const drawn = pieceFields(list).some(([key]) => key === path[0])
	const field = drawn ? path[0]! : null
	const label = labelAt(list, path)
	const why = m[2]!
	if (!label) return { field, message: refusal }
	let message: string | null = null
	if (why === "is required and not set")
		message = `Add ${label.toLowerCase()} to save this.`
	else if (/^is below the minimum (.+)$/.test(why))
		message = `${label} is ${why.replace(/^is below the minimum /, "")} or more.`
	else if (/^is above the maximum (.+)$/.test(why))
		message = `${label} is ${why.replace(/^is above the maximum /, "")} or less.`
	else if (why === "should be a whole number")
		message = `${label} is a whole number.`
	return { field, message: message ?? refusal }
}

/** What the New menu offers for a list: "New entry in Weapons". */
export const newRulesListEntryLabel = (label: string): string =>
	`New entry in ${label}`

/**
 * 🚧 Every rules list the workspace has been told about, by derived entry
 * type — what a list's door and editor read its piece shape from. A type id
 * names the same list in every book (its rules declare it), so one map
 * serves them all. Written only from a socket reply, never inside a derived.
 */
const RULES_LISTS = new SvelteMap<string, PieceList>()

/** Remembers a book's rules lists, their labels with them (`kindLabel`). */
export function rememberRulesLists(lists: readonly PieceList[]): void {
	for (const list of lists) {
		const held = RULES_LISTS.get(list.typeId)
		if (
			!held ||
			held.label !== list.label ||
			JSON.stringify(held.piece) !== JSON.stringify(list.piece)
		)
			RULES_LISTS.set(list.typeId, list)
	}
	rememberRulesListLabels(lists)
}

/** The rules list a derived entry type belongs to, once told about it. */
export const rulesListOf = (typeId: string): PieceList | undefined =>
	RULES_LISTS.get(typeId)
