/**
 * **Cast tags** — the `{{char:N}}` a lore text names a cast member by.
 *
 * A tag names a `lorebook_bindings` row by its per-book number (the row's
 * `binding` column; the counter is `lorebooks.next_binding_number`, see
 * `lorebookBindingToken.ts`).
 *
 * ⚠ **One spelling, `{{char:N}}`, and only it is a tag.** It is what every
 * writer stores, what the prompt substitutes and what the editor draws as a
 * chip. 0.5 also wrote `{char:N}`, and its reader took the half-braced slips
 * between the two; 0200 rewrote the stored 0.5 spelling, and the 0.5 import
 * is the one reader left for it (`importedCastTagNumber`,
 * `rewriteImportedCastTagsDeep` — a boundary, R5). Anywhere else a `{char:N}`
 * is prose: a server scan that read it would mint a member the prompt and the
 * editor never connect to that text.
 *
 * Only the `char` prefix is a tag. `{{roll:20}}` is a dice macro and names
 * nobody: the old scan matched `{{word:N}}` and minted a blank member for it,
 * pushing the counter to 21 on the way (A16).
 *
 * The book-wide half (`rewriteBookCastTags`) is how a tag follows its member:
 * a merge rewrites the absorbed member's tags to the survivor's, a delete
 * writes the member's name in their place. Without it the next entry save
 * found a tag with no row and minted a blank member under it — the member
 * came back from the dead (A16).
 */
import * as schema from "$lib/server/db/schema"
import { and, eq, inArray, or, sql, type SQL } from "drizzle-orm"
import { sortKeysDeep } from "$lib/server/utils/contentHash"

/** The stored spelling. Built fresh per use: a `/g` regex carries `lastIndex`. */
const CAST_TAG_SOURCE = String.raw`\{\{char:(\d+)\}\}`

/** What 0.5's reader took: both spellings and the half-braced slips. */
const IMPORTED_CAST_TAG_SOURCE = String.raw`\{\{?char:(\d+)\}?\}`

/** The one spelling every writer stores. */
export function castTag(n: number): string {
	return `{{char:${n}}}`
}

/**
 * The largest member number: `next_binding_number` is an `integer` and must
 * reach one past it. A larger "tag" is prose, not a member.
 */
export const MAX_MEMBER_NUMBER = 2_147_483_646

/**
 * The largest number a tag TYPED into an entry may create a member under.
 *
 * The counter only ever moves up, so a member minted from text spends every
 * number below it. Past nine digits a typed tag is a ledger number, not a
 * member the book counted towards, and minting it would leave the counter
 * next to `MAX_MEMBER_NUMBER` — one step from a book that can never add
 * anyone again. Up to here, the counter keeps over a billion numbers after.
 */
export const MAX_TYPED_MEMBER_NUMBER = 999_999_999

/** A valid member number: 1 … MAX_MEMBER_NUMBER. */
function memberNumber(digits: string): number | null {
	const n = Number(digits)
	return Number.isSafeInteger(n) && n > 0 && n <= MAX_MEMBER_NUMBER ? n : null
}

function wholeTagNumber(source: string, text: unknown): number | null {
	if (typeof text !== "string") return null
	const m = new RegExp(`^${source}$`).exec(text)
	return m ? memberNumber(m[1]) : null
}

/**
 * The member number a whole string names as a cast tag; null for anything
 * else (`{char:3}`, `{{roll:20}}`, `""`, prose around a tag).
 */
export function castTagNumber(text: unknown): number | null {
	return wholeTagNumber(CAST_TAG_SOURCE, text)
}

/** The same, for a 0.5 file's binding, in any spelling 0.5 read. */
export function importedCastTagNumber(text: unknown): number | null {
	return wholeTagNumber(IMPORTED_CAST_TAG_SOURCE, text)
}

/** Every member number `text` tags, once each, in the order first seen. */
export function castTagsIn(text: string): number[] {
	const seen = new Set<number>()
	rewriteCastTags(text, (n) => {
		seen.add(n)
		return null
	})
	return [...seen]
}

/**
 * Every member number a 0.5 file's value tags (strings anywhere in it, any
 * spelling 0.5 read), once each, in the order first seen.
 */
export function importedCastTagsIn(value: unknown): number[] {
	const seen = new Set<number>()
	rewriteImportedCastTagsDeep(value, (n) => {
		seen.add(n)
		return null
	})
	return [...seen]
}

/**
 * What a tag becomes: a string replaces it, `null`/`undefined` leaves it as
 * written. `written` is the tag's own spelling, for the 0.5 import, which
 * must tell `{char:1}` from `{{char:1}}` (0.5 bound both).
 */
export type CastTagReplacer = (
	n: number,
	written: string
) => string | null | undefined

function rewriteWith(
	source: string,
	text: string,
	replace: CastTagReplacer
): string {
	if (!text.includes("char:")) return text
	return text.replace(
		new RegExp(source, "g"),
		(written: string, digits: string) => {
			const n = memberNumber(digits)
			if (n === null) return written
			return replace(n, written) ?? written
		}
	)
}

/**
 * Every string in a JSON value through `rewrite` — an amendment's `fields`,
 * an entry's typed `fields`, a keys array. Object keys are left alone; a
 * value that is not a string, array or plain object comes back as it was.
 * Strings are visited in the value's own order (arrays in order, objects in
 * key order).
 */
function mapStringsDeep<T>(value: T, rewrite: (s: string) => string): T {
	if (typeof value === "string") return rewrite(value) as unknown as T
	if (Array.isArray(value))
		return value.map((v) => mapStringsDeep(v, rewrite)) as unknown as T
	if (value !== null && typeof value === "object") {
		const proto = Object.getPrototypeOf(value)
		if (proto !== Object.prototype && proto !== null) return value
		const out: Record<string, unknown> = {}
		for (const [k, v] of Object.entries(value as Record<string, unknown>))
			out[k] = mapStringsDeep(v, rewrite)
		return out as T
	}
	return value
}

/** One cast tag in a text: the member number, and where it is written. */
export interface CastTagSpan {
	n: number
	start: number
	end: number
}

/** Every cast tag in `text`, in reading order, with its offsets. */
export function castTagSpans(text: string): CastTagSpan[] {
	if (!text.includes("char:")) return []
	const out: CastTagSpan[] = []
	for (const m of text.matchAll(new RegExp(CAST_TAG_SOURCE, "g"))) {
		const n = memberNumber(m[1]!)
		if (n !== null)
			out.push({ n, start: m.index!, end: m.index! + m[0].length })
	}
	return out
}

/** `text` with each cast tag handed to `replace`. */
export function rewriteCastTags(
	text: string,
	replace: CastTagReplacer
): string {
	return rewriteWith(CAST_TAG_SOURCE, text, replace)
}

/** The same, through every string in a JSON value. */
export function rewriteCastTagsDeep<T>(value: T, replace: CastTagReplacer): T {
	return mapStringsDeep(value, (s) =>
		rewriteWith(CAST_TAG_SOURCE, s, replace)
	)
}

/** A 0.5 file's value with each tag, in any spelling 0.5 read, handed over. */
export function rewriteImportedCastTagsDeep<T>(
	value: T,
	replace: CastTagReplacer
): T {
	return mapStringsDeep(value, (s) =>
		rewriteWith(IMPORTED_CAST_TAG_SOURCE, s, replace)
	)
}

/**
 * A stored value read as its **tag positions**: the tags in reading order,
 * and everything around them (`around`). Keys are sorted first, so two reads
 * of one `jsonb` value line up whatever order they gave the keys.
 *
 * A merge swaps one tag for another and never moves the text around it, so a
 * value nobody has edited since a merge keeps its `around` through that merge
 * and through every merge after it — which is how an undo finds, by position,
 * the very tags its merge rewrote.
 */
function tagPositions(value: unknown): { around: string; tags: number[] } {
	const tags: number[] = []
	const masked = rewriteCastTagsDeep(sortKeysDeep(value ?? null), (n) => {
		tags.push(n)
		return "\u0000"
	})
	return { around: JSON.stringify(masked), tags }
}

// ─── Where lore text lives ───────────────────────────────────────────────────

/**
 * Every column of a book that holds lore text a tag can sit in.
 *
 * ⚠ The list IS the contract: a column missing here keeps an absorbed or
 * deleted member's tag after a merge or delete, and the tag outlives its
 * member. Add a column here when a lore text column is added. (A merge log's
 * saved copy of a member is lore text too, kept apart: `narrativeGraph.ts`
 * `rewriteMergeLogCastTags`.)
 */
const CAST_TAG_SITES = {
	/** Every entry type: the body, its title, its keys, its typed fields. */
	entry: {
		table: schema.lorebookEntries,
		columns: ["content", "title", "keys", "secondaryKeys", "fields"]
	},
	/** A dated overlay of an entry's writable columns. */
	entryAmendment: {
		table: schema.entryAmendments,
		columns: ["fields"]
	},
	/** A dated overlay of a cast member (their summary, name, aliases). */
	castAmendment: {
		table: schema.castAmendments,
		columns: ["fields"]
	},
	castMember: {
		table: schema.lorebookBindings,
		columns: ["summary"]
	},
	castPresence: {
		table: schema.castPresences,
		columns: ["note"]
	},
	scene: {
		table: schema.scenes,
		columns: ["name", "summary"]
	},
	relationship: {
		table: schema.narrativeRelationships,
		columns: ["title", "description", "reason"]
	},
	/** The book's own description; keyed by its id, not a lorebook_id. */
	lorebook: {
		table: schema.lorebooks,
		columns: ["description"]
	}
} as const

export type CastTagSite = keyof typeof CAST_TAG_SITES

/** Some rows of some sites, by id — a rewrite limited to them. */
export type CastTagRows = Partial<Record<CastTagSite, readonly number[]>>

/**
 * One rewritten column of one row — an **undo note** a merge keeps in
 * `binding_merge_logs.tag_rewrites` so undoMerge can put the absorbed
 * member's tags back.
 *
 * `before` is the column as the merge found it: its tags where `from` stood
 * are the positions the merge rewrote. A later delete writes its member's
 * name into `before` as it does into the row (`rewriteMergeLogCastTags`), so
 * the two keep their tags in the same positions.
 */
export interface CastTagRewrite {
	site: CastTagSite
	id: number
	column: string
	/** The member number whose tags were rewritten. */
	from: number
	/** What they were rewritten to — the survivor's tag. */
	to: string
	before: unknown
}

/** What a book-wide rewrite changed. */
export interface CastTagRewriteResult {
	/** One per changed column, for a merge's undo notes. */
	rewrites: CastTagRewrite[]
	/** The entry types whose rows changed, for the lists a client holds. */
	entryTypeIds: Set<string>
}

function siteOwner(site: CastTagSite, lorebookId: number): SQL {
	const { table } = CAST_TAG_SITES[site]
	return site === "lorebook"
		? eq((table as any).id, lorebookId)
		: eq((table as any).lorebookId, lorebookId)
}

/**
 * Rewrite member `from`'s tags across every lore text of one book — or, with
 * `only`, across just those rows (an undo's restored rows).
 *
 * Run it on the transaction that changes the cast, under the book's lock, so
 * no entry write lands between the rewrite and the member going — the entry
 * save's `syncLorebookBindings` takes the same lock.
 *
 * `to` is the replacement text: the survivor's tag for a merge, the member's
 * name for a delete. Only rows that name `char:` at all are read.
 */
export async function rewriteBookCastTags(
	tx: Db,
	lorebookId: number,
	from: number,
	to: string,
	only?: CastTagRows
): Promise<CastTagRewriteResult> {
	const rewrites: CastTagRewrite[] = []
	const entryTypeIds = new Set<string>()
	const replace: CastTagReplacer = (n) => (n === from ? to : null)

	for (const site of Object.keys(CAST_TAG_SITES) as CastTagSite[]) {
		const ids = only?.[site]
		if (only && !ids?.length) continue
		const { table, columns } = CAST_TAG_SITES[site]
		const t = table as any
		const mentions = columns.map(
			(c) => sql`${t[c]}::text LIKE ${"%char:%"}`
		)
		const picked: Record<string, any> = { id: t.id }
		for (const c of columns) picked[c] = t[c]
		if (site === "entry") picked.typeId = t.typeId
		const rows: Record<string, any>[] = await tx
			.select(picked)
			.from(t)
			.where(
				and(
					siteOwner(site, lorebookId),
					ids ? inArray(t.id, [...ids]) : undefined,
					or(...mentions)
				)
			)

		for (const row of rows) {
			const set: Record<string, unknown> = {}
			for (const column of columns) {
				const before = row[column]
				if (before == null) continue
				const after = rewriteCastTagsDeep(before, replace)
				if (sameValue(before, after)) continue
				set[column] = after
				rewrites.push({ site, id: row.id, column, from, to, before })
			}
			if (Object.keys(set).length === 0) continue
			await tx.update(t).set(set).where(eq(t.id, row.id))
			if (site === "entry") entryTypeIds.add(row.typeId)
		}
	}
	return { rewrites, entryTypeIds }
}

/** Two stored values the same, whatever order a `jsonb` read gave the keys. */
function sameValue(a: unknown, b: unknown): boolean {
	return (
		JSON.stringify(sortKeysDeep(a ?? null)) ===
		JSON.stringify(sortKeysDeep(b ?? null))
	)
}

/**
 * Put a merge's rewritten tags back.
 *
 * By position: the tags where `before` read `from` are the ones the merge
 * rewrote. A column goes back when nothing around its tags has changed since
 * and each of those positions still reads the survivor's tag; its other tags
 * stay as they read now, so a later merge's rewrite of a different member
 * stands, and undoing merges in any order puts every tag back. Text edited
 * since keeps the survivor's tag — the edit is the author's, and which of its
 * tags were once the absorbed member's cannot be told any more — and the row is
 * counted once, however many of its columns were edited, so the undo can say
 * so. A row deleted since has nothing to put back and is not counted.
 *
 * `restoredAs` is the tag the absorbed member returns under — their own, or a
 * fresh one when a member who is not blank holds it now.
 */
export async function revertCastTagRewrites(
	tx: Db,
	notes: readonly CastTagRewrite[],
	restoredAs: (from: number) => string
): Promise<{ unrestored: number; entryTypeIds: Set<string> }> {
	const unrestored = new Set<string>()
	const entryTypeIds = new Set<string>()
	for (const note of notes) {
		const spec = CAST_TAG_SITES[note.site]
		if (!spec || !(spec.columns as readonly string[]).includes(note.column))
			continue
		const t = spec.table as any
		const picked: Record<string, any> = { value: t[note.column] }
		if (note.site === "entry") picked.typeId = t.typeId
		const [row] = await tx
			.select(picked)
			.from(t)
			.where(eq(t.id, note.id))
			.limit(1)
		if (!row) continue

		const was = tagPositions(note.before)
		const at = new Set(
			was.tags.flatMap((n, i) => (n === note.from ? [i] : []))
		)
		if (at.size === 0) continue
		const now = tagPositions(row.value)
		const survivor = castTagNumber(note.to)
		if (
			now.around !== was.around ||
			now.tags.length !== was.tags.length ||
			[...at].some((i) => now.tags[i] !== survivor)
		) {
			unrestored.add(`${note.site}:${note.id}`)
			continue
		}

		const back = restoredAs(note.from)
		let i = 0
		const value = rewriteCastTagsDeep(sortKeysDeep(row.value), () =>
			at.has(i++) ? back : null
		)
		await tx
			.update(t)
			.set({ [note.column]: value })
			.where(eq(t.id, note.id))
		if (note.site === "entry") entryTypeIds.add(row.typeId)
	}
	return { unrestored: unrestored.size, entryTypeIds }
}
