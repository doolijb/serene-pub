/**
 * 🚧 A book's **rules lists** and its **rules library** (PLAN-lorebook-kinds §C,
 * owner rulings 2026-10-21).
 *
 * - A **rules list** is one of the book's rules' entryable repertoires, drawn
 *   as entries of its derived entry type (`<creator>:entry/<rules>.<list>`):
 *   Vis Itineris's Weapons, Spells…; Freeform's Things, Conditions. The person
 *   reads the list's own label (NOMENCLATURE §28), never "repertoire".
 * - The **‹Rules› library** is the rules' shipped catalogue of pieces (the
 *   compendium), shown under a book read-only and copied into it when someone
 *   edits one (`entries:copyFromLibrary`). Only rows of entryable lists are
 *   offered: a non-entryable list (Vis Itineris's classes) has no entries to
 *   copy into.
 *
 * Which lists a book DRAWS (only where it has something in it — ruled
 * 2026-10-21) is the workspace's call from `libraryRows` and its own counts;
 * this module answers what the rules declare.
 */
import { eq } from "drizzle-orm"
import "@serene-pub/core-catalog"
import {
	getRuleset,
	i18nText,
	rulesetEntryable,
	rulesetEntryTypeId,
	rulesets,
	type FieldDecl,
	type RulesetDecl
} from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"
import { isDerivedEntryTypeId } from "$lib/shared/entries/types"

/** One list of a book's rules, as `entries:types` sends it. */
export interface BookRulesList {
	typeId: string
	/** The list's own label: "Weapons". */
	label: string
	repertoireId: string
	/** The list's piece shape — what its entries' own fields are. */
	piece: FieldDecl
	/** How many pieces the rules' library offers for it (0: none). */
	libraryRows: number
}

/** The rules a book is told by, as declared — undefined when not installed. */
export async function bookRulesOf(db: Db, lorebookId: number): Promise<RulesetDecl | undefined> {
	const [book] = await db
		.select({ primaryRuleset: schema.lorebooks.primaryRuleset })
		.from(schema.lorebooks)
		.where(eq(schema.lorebooks.id, lorebookId))
		.limit(1)
	return book ? getRuleset(book.primaryRuleset) : undefined
}

/** Every entryable list of these rules, in the rules' own order. */
export function rulesListsOf(rules: RulesetDecl | undefined): BookRulesList[] {
	if (!rules) return []
	const lists: BookRulesList[] = []
	for (const repertoireId of rulesetEntryable(rules)) {
		const repertoire = rules.repertoires.find((r) => r.id === repertoireId)
		if (!repertoire) continue
		lists.push({
			// Stored the way every entry type id is, without its `@1`
			// (`entries/declarations.ts` `splitPin`).
			typeId: rulesetEntryTypeId(rules.id, repertoireId).replace(/@\d+$/, ""),
			label: i18nText(repertoire.label) ?? repertoireId,
			repertoireId,
			piece: repertoire.piece,
			libraryRows: rules.compendium?.rows[repertoireId]?.length ?? 0
		})
	}
	return lists
}

export async function bookRulesLists(db: Db, lorebookId: number): Promise<BookRulesList[]> {
	return rulesListsOf(await bookRulesOf(db, lorebookId))
}

/**
 * What `entries:types` sends: the book's rules lists, and what its rules are
 * called — the name the workspace's rail heads them with (*Vis Itineris*).
 * Null when the book's rules are not installed.
 */
export async function bookRulesListsRead(
	db: Db,
	lorebookId: number
): Promise<{ rulesName: string | null; types: BookRulesList[]; otherRules: OtherRulesLists[] }> {
	const rules = await bookRulesOf(db, lorebookId)
	return {
		rulesName: rules ? (i18nText(rules.name) ?? rules.id) : null,
		types: rulesListsOf(rules),
		otherRules: await otherRulesListsOf(db, lorebookId, rules)
	}
}

/** 🚧 ★50 The lists of OTHER rules than the book's that it holds entries of, under those rules' name. */
export interface OtherRulesLists {
	rulesName: string
	types: BookRulesList[]
}

/**
 * 🚧 ★50 (owner ruling 2026-11-04): a book may hold entries of rules it is not
 * told by — a provided book's package-ruleset entries, a converted book's —
 * and they were counted in Everything but listed in no view. Every installed
 * rules other than the book's own whose lists the book holds an entry of is
 * sent, with only the lists the book holds an entry of; the workspace draws them
 * under those rules' name, never as a list the book may add to (`rulesListRefusal` still refuses).
 */
export async function otherRulesListsOf(
	db: Db,
	lorebookId: number,
	own: RulesetDecl | undefined
): Promise<OtherRulesLists[]> {
	const held = new Set<string>(
		(
			await db
				.selectDistinct({ typeId: schema.lorebookEntries.typeId })
				.from(schema.lorebookEntries)
				.where(eq(schema.lorebookEntries.lorebookId, lorebookId))
		)
			.map((r) => r.typeId)
			.filter((t) => isDerivedEntryTypeId(t))
	)
	if (!held.size) return []
	const out: OtherRulesLists[] = []
	for (const rules of rulesets()) {
		if (own && rules.id === own.id) continue
		// Only the lists the book holds something of: a foreign list with
		// nothing in it is not drawn (★50: "lists with something in them").
		const types = rulesListsOf(rules).filter((t) => held.has(t.typeId))
		if (!types.length) continue
		out.push({ rulesName: i18nText(rules.name) ?? rules.id, types })
	}
	return out.sort((a, b) => a.rulesName.localeCompare(b.rulesName))
}

/**
 * Why a derived entry type may not be written to this book — it belongs to
 * other rules than the book's — or null when it may (a core type, or one of
 * the book's own lists).
 */
export async function rulesListRefusal(
	db: Db,
	lorebookId: number,
	typeId: string
): Promise<string | null> {
	if (!isDerivedEntryTypeId(typeId)) return null
	const rules = await bookRulesOf(db, lorebookId)
	if (rulesListsOf(rules).some((l) => l.typeId === typeId)) return null
	return `This book is told by ${rules ? (i18nText(rules.name) ?? "its own rules") : "its own rules"}, so its entries come from those rules' lists. Change the book's Rules in Book settings to use another's.`
}

/** One library piece, as `lorebooks:library` sends it. */
export interface BookLibraryRow {
	typeId: string
	repertoireId: string
	/** The piece's id in the library — what a copy's `derived_from.piece` names. */
	id: string
	version: string
	piece: Record<string, unknown>
	source?: { document: string; licence: string }
}

/**
 * The book's rules library: its name in the interface (*Vis Itineris library*,
 * NOMENCLATURE §28 — always qualified), its source line, and its rows for the
 * book's entryable lists. Empty for rules with no library (Freeform).
 */
export async function bookLibrary(
	db: Db,
	lorebookId: number
): Promise<{
	name: string | null
	compendium: string | null
	source: { document: string; licence: string } | null
	rows: BookLibraryRow[]
}> {
	const rules = await bookRulesOf(db, lorebookId)
	const compendium = rules?.compendium
	if (!rules || !compendium) return { name: null, compendium: null, source: null, rows: [] }
	const rows: BookLibraryRow[] = []
	for (const list of rulesListsOf(rules))
		for (const row of compendium.rows[list.repertoireId] ?? [])
			rows.push({
				typeId: list.typeId,
				repertoireId: list.repertoireId,
				id: row.id,
				version: row.version,
				piece: { ...(row.piece as Record<string, unknown>) },
				...(row.source ? { source: { ...row.source } } : {})
			})
	return {
		name: `${i18nText(rules.name) ?? rules.id} library`,
		compendium: rules.id,
		source: compendium.source ? { ...compendium.source } : null,
		rows
	}
}

/** One library row of the book's rules, by list type and piece id — undefined when absent. */
export async function libraryRowOf(
	db: Db,
	lorebookId: number,
	typeId: string,
	pieceId: string
): Promise<{ row: BookLibraryRow; compendium: string } | undefined> {
	const library = await bookLibrary(db, lorebookId)
	const row = library.rows.find((r) => r.typeId === typeId && r.id === pieceId)
	return row && library.compendium ? { row, compendium: library.compendium } : undefined
}
