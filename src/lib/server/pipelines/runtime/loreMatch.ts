/**
 * 🚧 **Find-or-update and filing** for `create-lore-entry@1` (pr-6 lane C1):
 * `match` (R-h) finds the entry a create would otherwise duplicate; `bind`
 * files an entry under a cast member. Both read `tx`, never the outer handle.
 */
import { and, eq, inArray } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { cardsNow } from "$lib/server/cast/seatedCast"
import { entryDeclaration } from "$lib/server/entries/declarations"
import { answeringRows, keyTerms } from "$lib/shared/lorebooks/describingRow"
import { namesName } from "@serene-pub/sdk"
import { HostScopeError } from "$lib/server/pipelines/runtime/host"

const fold = (s: string): string => s.trim().toLowerCase()

/**
 * The entry `match` names: null = none (create); an id = update it. Two or
 * more are refused, naming every candidate. Looks within this write's own
 * entry type, on the session's reading, among the entries it sees.
 *
 * 🚧 `then` (a session whose own notes take the write while it reads an
 * attached lorebook): the lorebook is looked in only when the own book
 * has no hit — "two or more" refuses within one book, never across the two.
 */
export async function findLoreMatch(
	tx: Db,
	at: { lorebookId: number; typeId: string; reading: unknown },
	match: unknown,
	nodeKey: string,
	then?: { lorebookId: number; reading: unknown }
): Promise<number | null> {
	const bad = () =>
		new HostScopeError(`${nodeKey}: match is { entryId }, { name } or { key }.`)
	if (!match || typeof match !== "object" || Array.isArray(match)) throw bad()
	const m = match as Record<string, unknown>
	const { entriesAsRead } = await import("$lib/server/state/entriesOnReading")
	type Reading = Parameters<typeof entriesAsRead>[2]
	const books: { lorebookId: number; reading: Reading }[] = [
		{ lorebookId: at.lorebookId, reading: at.reading as Reading }
	]
	if (then) books.push({ lorebookId: then.lorebookId, reading: then.reading as Reading })

	if (typeof m.entryId === "number" && Number.isInteger(m.entryId)) {
		for (const book of books) {
			const [row] = await entriesAsRead(tx, book.lorebookId, book.reading, "session", [at.typeId], [
				m.entryId
			])
			if (row) return row.entryId
		}
		throw new HostScopeError(
			`${nodeKey}: entry ${m.entryId} is not a '${at.typeId}' entry of this session's lorebook — match finds within this write's own entry type.`
		)
	}

	const byName = typeof m.name === "string" && m.name.trim() !== ""
	const byKey = typeof m.key === "string" && m.key.trim() !== ""
	if (byName === byKey) throw bad()
	const needle = (byName ? m.name : m.key) as string

	for (const book of books) {
		const all = (
			await entriesAsRead(tx, book.lorebookId, book.reading, "session", [at.typeId])
		).filter((e) => !e.unseen)
		const hits = byName
			? (answeringRows(needle, all.map((e) => ({ name: e.name, keys: e.keys, id: e.entryId }))) as {
					id: number
					name: string
				}[]).map((r) => ({ id: r.id, name: r.name }))
			: all
					.filter((e) => keyTerms(e.keys).some((k) => fold(k) === fold(needle)))
					.map((e) => ({ id: e.entryId, name: e.name }))
		if (hits.length === 0) continue
		if (hits.length === 1) return hits[0]!.id
		throw new HostScopeError(
			`${nodeKey}: ${hits.length} entries answer to '${needle.trim()}' — ${hits
				.map((h) => `'${h.name}' (entry ${h.id})`)
				.join(", ")}. Name one: match { entryId }.`
		)
	}
	return null
}

/** The cast member (`lorebook_bindings.id`) a `bind` of `character:<id>` (or 🚧 `seated-member:<id>`) files an entry under. */
export async function resolveBind(
	tx: Db,
	at: { lorebookId: number; typeId: string },
	bind: unknown,
	nodeKey: string,
	/** 🚧 The attached lorebook a session reads beside its own notes: its cast is asked second. */
	also?: { lorebookId: number }
): Promise<number> {
	if (!entryDeclaration(at.typeId)?.roles.anchor)
		throw new HostScopeError(
			`${nodeKey}: '${at.typeId}' entries are not filed under a cast member — leave bind off.`
		)
	// 🚧 (seat-cast S2) `seated-member:<memberId>` names the member itself
	// (`lorebook_bindings.id`) — it is in this book's cast or it is not.
	const seated = typeof bind === "string" ? /^seated-member:([1-9][0-9]*)$/.exec(bind.trim()) : null
	if (seated) {
		const memberId = Number(seated[1])
		if (!Number.isSafeInteger(memberId) || memberId > 2147483647)
			throw new HostScopeError(`${nodeKey}: bind names a character, as character:<id>.`)
		const [row] = await tx
			.select({ id: schema.lorebookBindings.id, lorebookId: schema.lorebookBindings.lorebookId, name: schema.lorebookBindings.name })
			.from(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.id, memberId))
			.limit(1)
		if (row && (row.lorebookId === at.lorebookId || row.lorebookId === also?.lorebookId)) return row.id
		throw new HostScopeError(
			`${nodeKey}: ${row?.name || `cast member ${memberId}`} is not in this book's cast, so there is nobody to file this under — add them to the cast, or leave bind off.`
		)
	}
	const parsed = typeof bind === "string" ? /^character:([1-9][0-9]*)$/.exec(bind.trim()) : null
	const characterId = parsed ? Number(parsed[1]) : NaN
	if (!Number.isSafeInteger(characterId) || characterId > 2147483647)
		throw new HostScopeError(`${nodeKey}: bind names a character, as character:<id>.`)
	const [member] = await tx
		.select({ id: schema.lorebookBindings.id })
		.from(schema.lorebookBindings)
		.where(
			and(
				eq(schema.lorebookBindings.lorebookId, at.lorebookId),
				eq(schema.lorebookBindings.characterId, characterId)
			)
		)
		.limit(1)
	if (member) return member.id
	if (also) {
		const [other] = await tx
			.select({ id: schema.lorebookBindings.id })
			.from(schema.lorebookBindings)
			.where(
				and(
					eq(schema.lorebookBindings.lorebookId, also.lorebookId),
					eq(schema.lorebookBindings.characterId, characterId)
				)
			)
			.limit(1)
		if (other) return other.id
	}
	const character = (await cardsNow(tx, [characterId])).get(characterId)
	throw new HostScopeError(
		`${nodeKey}: ${character?.name ?? `character ${characterId}`} is not in this book's cast, so there is nobody to file this under — add them to the cast, or leave bind off.`
	)
}

/** How a name was found among the entries a write may change. */
export type LoreLook =
	| { by: "none" }
	| { by: "name"; ids: { id: number; name: string }[]; lorebookId: number }
	| { by: "key"; ids: { id: number; name: string }[] }

/**
 * 🚧 Looks a name up the way a write that was shown the entries does: by the
 * entry's name first across the books (the own book, then the attached
 * lorebook; `answeringRows`' first two tiers, over rows offered without their
 * keys), and only when no book has a name hit, by a key term (its third tier).
 * Within one book: the same rows `findLoreMatch` reads. Reads only.
 */
export async function lookLoreMatch(
	tx: Db,
	at: { lorebookId: number; typeId: string; reading: unknown },
	name: string,
	then?: { lorebookId: number; reading: unknown }
): Promise<LoreLook> {
	const { entriesAsRead } = await import("$lib/server/state/entriesOnReading")
	type Reading = Parameters<typeof entriesAsRead>[2]
	const books = [{ lorebookId: at.lorebookId, reading: at.reading }]
	if (then) books.push(then)
	const lists: { lorebookId: number; rows: { id: number; name: string; keys: string[] }[] }[] = []
	for (const book of books) {
		const all = (
			await entriesAsRead(tx, book.lorebookId, book.reading as Reading, "session", [at.typeId])
		).filter((e) => !e.unseen)
		lists.push({
			lorebookId: book.lorebookId,
			rows: all.map((e) => ({ id: e.entryId, name: e.name, keys: e.keys }))
		})
	}
	const answers = (rows: object[]) =>
		(rows as { id: number; name: string }[]).map((r) => ({ id: r.id, name: r.name }))
	for (const list of lists) {
		const hits = answeringRows(name, list.rows.map((r) => ({ id: r.id, name: r.name })))
		if (hits.length) return { by: "name", ids: answers(hits), lorebookId: list.lorebookId }
	}
	for (const list of lists) {
		const hits = answeringRows(name, list.rows.map((r) => ({ id: r.id, name: undefined, keys: r.keys })))
		if (hits.length)
			return {
				by: "key",
				ids: (hits as { id: number }[]).map((h) => ({
					id: h.id,
					name: list.rows.find((r) => r.id === h.id)?.name ?? ""
				}))
			}
	}
	return { by: "none" }
}

/** The name a write's `match` gives when it is `{ name }` alone — what a write that was shown entries reads; else null. */
export function matchNameOf(match: unknown): string | null {
	if (!match || typeof match !== "object" || Array.isArray(match)) return null
	const m = match as Record<string, unknown>
	if (typeof m.entryId === "number" && Number.isInteger(m.entryId)) return null
	const named = typeof m.name === "string" && m.name.trim() !== ""
	const keyed = typeof m.key === "string" && m.key.trim() !== ""
	return named && !keyed ? (m.name as string) : null
}

/** The entry ids a write's `shown` port lists (non-integer members ignored); null when it is not a list. */
export function shownIdsOf(shown: unknown): number[] | null {
	return Array.isArray(shown)
		? shown.filter((x): x is number => typeof x === "number" && Number.isInteger(x))
		: null
}

/** An entry's content as a reading has it: the stored row with the line's and the session's held changes laid on. */
export async function contentAsRead(
	tx: Db,
	stored: typeof schema.lorebookEntries.$inferSelect,
	reading: unknown
): Promise<string> {
	const { entryOverlaysFor, entryAt } = await import("$lib/server/state/entriesOnReading")
	const { toEntryRow } = await import("$lib/server/utils/lorebookEntries")
	type Reading = Parameters<typeof entryAt>[2]
	const overlays = await entryOverlaysFor(tx, stored.lorebookId, reading as Reading, [stored.id])
	const read = entryAt(toEntryRow(stored), overlays, reading as Reading)
	return typeof read.content === "string" ? read.content : ""
}

/** The paragraphs of a text, as a blank line separates them. */
const paragraphsOf = (text: string): string[] => text.split(/\n[^\S\n]*\n/u).map((p) => p.trim())

/**
 * What an entry that reads `read` says after `text` is added as a new
 * paragraph; null when nothing is to change — the text is empty, or is all of
 * what the entry says, or is one of its paragraphs.
 */
export function appendedContent(read: string, text: string): string | null {
	const added = text.trim()
	if (!added || read.trim() === added || paragraphsOf(read).includes(added)) return null
	return read.trim() === "" ? added : `${read.trimEnd()}\n\n${added}`
}

/** One entry the lines name, as a write is shown it. */
export interface NamedEntry {
	entryId: number
	entryType: string
	name: string
	content: string
	byPerson: boolean
}

/** A message row's text, for the rows a `messages` port carried: flattened one level, hidden and unstored rows skipped. */
function textsOf(messages: unknown): string[] {
	if (!Array.isArray(messages)) return []
	const out: string[] = []
	for (const m of messages.flatMap((x) => (Array.isArray(x) ? x : [x]))) {
		if (!m || typeof m !== "object") continue
		const { id, isHidden, content } = m as { id?: unknown; isHidden?: unknown; content?: unknown }
		if (typeof id !== "number" || id < 0 || isHidden === true) continue
		if (typeof content === "string" && content !== "") out.push(content)
	}
	return out
}

/**
 * 🚧 The entries of `typeIds` a session reads whose name, or one of whose keys,
 * appears as whole words in one of the message rows: the own book's first, then
 * the attached lorebook's, each in entry order, each as the session reads it
 * (held changes laid on; switched-off, archived and unseen ones left out). At
 * most `maxEntries`; with `maxTokens` a number, an entry costing more than what
 * is left is skipped and the later ones are still tried. Reads only.
 */
export async function entriesNamedIn(
	db: Db,
	sessionId: number,
	opts: {
		typeIds: readonly string[]
		messages: unknown
		maxEntries: number
		maxTokens: number | null
		countTokens?: (text: string) => number
	}
): Promise<NamedEntry[]> {
	if (opts.maxEntries <= 0) return []
	const texts = textsOf(opts.messages)
	if (!texts.length) return []
	const [session] = await db
		.select({ lorebookId: schema.sessions.lorebookId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	if (!session) return []
	const { lorebooksReadBy } = await import("$lib/server/lorebooks/ownBook")
	const { sessionReadingOf } = await import("$lib/server/state/reading")
	const { entriesAsRead, entryOverlaysFor, entryAt, MAIN_HEAD } = await import(
		"$lib/server/state/entriesOnReading"
	)
	const { toEntryRow } = await import("$lib/server/utils/lorebookEntries")
	const books = await lorebooksReadBy(db, { id: sessionId, lorebookId: session.lorebookId ?? null })
	const reading = await sessionReadingOf(db, sessionId)
	// The listing rule: the book the session's reading is of at that reading, the
	// other (its own notes beside an attached lorebook) at its head.
	const order = [books.ownBookId, books.attachedId].filter((id): id is number => id != null)
	const count = opts.countTokens ?? ((t: string) => Math.ceil(t.length / 4))
	let left = opts.maxTokens
	const out: NamedEntry[] = []
	for (const bookId of order) {
		const at = bookId === reading?.lorebookId ? (reading ?? MAIN_HEAD) : MAIN_HEAD
		const seen = (await entriesAsRead(db, bookId, at, "session", opts.typeIds)).filter((e) => !e.unseen)
		if (!seen.length) continue
		// The names are looked for on the listing alone; an entry's text is read only once a line names it.
		const marks = await db
			.select({
				id: schema.lorebookEntries.id,
				matchMode: schema.lorebookEntries.matchMode,
				useRegex: schema.lorebookEntries.useRegex
			})
			.from(schema.lorebookEntries)
			.where(
				and(
					eq(schema.lorebookEntries.lorebookId, bookId),
					inArray(
						schema.lorebookEntries.id,
						seen.map((e) => e.entryId)
					)
				)
			)
		const markOf = new Map(marks.map((r) => [r.id, r]))
		const named = seen.filter((entry) => {
			const mark = markOf.get(entry.entryId)
			if (!mark) return false
			// A key kept as a regular expression is a pattern, not a word: only its name is looked for.
			const regex = mark.matchMode === "regex" || (mark.matchMode == null && mark.useRegex === true)
			const terms = [entry.name, ...(regex ? [] : keyTerms(entry.keys))]
			return texts.some((t) => terms.some((term) => namesName(t, term)))
		})
		if (!named.length) continue
		const ids = named.map((e) => e.entryId)
		const rows = await db
			.select()
			.from(schema.lorebookEntries)
			.where(and(eq(schema.lorebookEntries.lorebookId, bookId), inArray(schema.lorebookEntries.id, ids)))
		const stored = new Map(rows.map((r) => [r.id, r]))
		const overlays = await entryOverlaysFor(db, bookId, at, ids)
		for (const entry of named) {
			if (out.length >= opts.maxEntries) return out
			const row = stored.get(entry.entryId)
			if (!row) continue
			const read = entryAt(toEntryRow(row), overlays, at)
			const content = typeof read.content === "string" ? read.content : ""
			if (left !== null) {
				const cost = count(`${entry.name}\n${content}`)
				if (cost > left) continue
				left -= cost
			}
			out.push({
				entryId: entry.entryId,
				entryType: entry.typeId,
				name: entry.name,
				content,
				byPerson: row.provenance === "human"
			})
		}
	}
	return out
}
