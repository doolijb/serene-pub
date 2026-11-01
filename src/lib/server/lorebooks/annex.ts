/**
 * 🚧 The **lorebook annex** (M0, SHAPES L9): a lorebook's own
 * owner → document store (`lorebooks.annex`, with `lorebooks.annex_audiences`
 * beside it), the **session annex**'s model at book scope — world-level engine
 * state that is neither an attribute nor prose.
 *
 * ## Three homes
 *
 *  - A write FROM A SESSION is a change: routed like every lore write (the
 *    attached book when the session may write it, else its own book — the
 *    caller asks `sessionLoreWriteTo`), anchored to the turn and filed as a
 *    `lore_imprints` row (subject `annex`, field `<owner>/<key>`), so the one
 *    retraction rule takes it back and the settle line settles it.
 *  - A write from a book-level run (no session, so no anchor) is lasting at
 *    once: no imprint.
 *  - A session READS the union: its attached book's document for an owner,
 *    overlaid key by key by its own book's when the own book overlays it.
 *
 * Owners may hold `/` (`core:genre/story`); keys never do.
 *
 * ⚠ Every function takes its handle: inside `writeLorebookAnnex`'s
 * transaction only `tx` is used (the outer `db` deadlocks PGlite). Never
 * statically imports `$lib/server/db`.
 */
import { eq, or, sql } from "drizzle-orm"
import { annexVersionOf, bumpedAnnexVersionsSql } from "$lib/server/sessions/annexVersions"
import * as schema from "$lib/server/db/schema"
import {
	audienceHolds,
	canonicalParticipantRef,
	isParticipantRef,
	visibleTo,
	type DataAudiences,
	type ParticipantRef
} from "@serene-pub/sdk"
import { imprintField, type ImprintAnchor } from "$lib/server/lorebooks/imprints"
import { resolvePortrayals } from "$lib/server/pipelines/runtime/portrayals"
import { checkSessionAccess } from "$lib/server/utils/sessionAccess"
import type { SessionIo } from "$lib/server/pipelines/runtime/liveRow"
import { emitToUserRedacted } from "$lib/server/sockets/utils/broadcastHelpers"
import type { AnnexView } from "$lib/server/sessions/annexViews"

/** One write of one owner's document in one lorebook's annex. */
export interface LorebookAnnexWrite {
	lorebookId: number
	owner: string
	value: Record<string, unknown>
	/** Merge into the held document, or replace its declared keys. */
	merge: boolean
	/** Per key written, the audience its declaration gives it. */
	audienceOf: Record<string, readonly string[]>
	/** The keys the owner's declaration covers; any other held key is legacy and survives a replace. */
	declared: ReadonlySet<string>
	/** The turn the change is filed under; null is a lasting write (a press, an action-family run, a book-level run). */
	anchor: ImprintAnchor | null
	/** 🚧 (M2b) Compare-and-set: the owner's annex document version the writer read; another stored version writes nothing (`stale`). */
	base?: number
}

/** Deep equality for plain JSON values, key order ignored — what jsonb compares. */
function sameJson(a: unknown, b: unknown): boolean {
	const norm = (v: unknown): unknown =>
		Array.isArray(v)
			? v.map(norm)
			: v && typeof v === "object"
				? Object.fromEntries(
						Object.keys(v as object)
							.sort()
							.map((k) => [k, norm((v as Record<string, unknown>)[k])])
					)
				: v
	return JSON.stringify(norm(a)) === JSON.stringify(norm(b))
}

const isDocument = (v: unknown): v is Record<string, unknown> =>
	!!v && typeof v === "object" && !Array.isArray(v)

/**
 * Write one owner's document into a lorebook's annex, under the
 * lorebook-annex lock, and file an imprint per changed key when the write
 * has an anchor. `keys` are the keys whose value changed.
 */
export async function writeLorebookAnnex(
	db: Db,
	w: LorebookAnnexWrite
): Promise<{ changed: boolean; keys: string[]; annex: Record<string, unknown>; stale?: true; version: number }> {
	const { lorebookId, owner } = w
	// Stored in each reference's one spelling, so every reader's lookup finds it.
	const canonical = (refs: readonly string[] | undefined) =>
		[...new Set((refs ?? []).map((r) => canonicalParticipantRef(r)))].sort()
	return db.transaction(async (tx) => {
		await tx.execute(sql`select pg_advisory_xact_lock(hashtext('lorebook-annex'), ${lorebookId})`)
		const [current] = await tx
			.select({
				annex: schema.lorebooks.annex,
				audiences: schema.lorebooks.annexAudiences,
				versions: schema.lorebooks.annexVersions
			})
			.from(schema.lorebooks)
			.where(eq(schema.lorebooks.id, lorebookId))
			.limit(1)
		if (!current) throw new Error(`Lorebook ${lorebookId} no longer exists`)
		const held = (current.annex ?? {}) as Record<string, unknown>
		const previous = isDocument(held[owner]) ? (held[owner] as Record<string, unknown>) : {}
		const version = annexVersionOf(current.versions, owner)
		// 🚧 (M2b) A write built on a read the document has since moved past.
		if (w.base !== undefined && w.base !== version) return { changed: false, keys: [], annex: previous, stale: true, version }
		const heldAudiences = ((current.audiences ?? {}) as Record<string, Record<string, string[]>>)[owner] ?? {}
		// Legacy keys (no declaration covers them) survive a replace.
		const legacy = Object.fromEntries(Object.entries(previous).filter(([k]) => !w.declared.has(k)))
		const next = w.merge ? { ...previous, ...w.value } : { ...legacy, ...w.value }
		const nextAudiences: Record<string, string[]> = w.merge
			? { ...heldAudiences }
			: Object.fromEntries(Object.entries(heldAudiences).filter(([k]) => !w.declared.has(k)))
		for (const key of Object.keys(w.value)) {
			const see = canonical(w.audienceOf[key])
			if (see.length) nextAudiences[key] = see
			else delete nextAudiences[key]
		}
		if (sameJson(previous, next) && Object.hasOwn(held, owner)) return { changed: false, keys: [], annex: next, version }
		const keys = [...new Set([...Object.keys(previous), ...Object.keys(next)])].filter(
			(k) => !sameJson(previous[k], next[k])
		)
		await tx.execute(sql`
			update ${schema.lorebooks}
			set ${sql.identifier("annex")} = jsonb_set(
				coalesce(${schema.lorebooks.annex}, '{}'::jsonb),
				ARRAY[${owner}]::text[],
				${JSON.stringify(next)}::jsonb,
				true
			),
			${sql.identifier("annex_audiences")} = jsonb_set(
				coalesce(${schema.lorebooks.annexAudiences}, '{}'::jsonb),
				ARRAY[${owner}]::text[],
				${JSON.stringify(nextAudiences)}::jsonb,
				true
			),
			${sql.identifier("annex_versions")} = ${bumpedAnnexVersionsSql(schema.lorebooks.annexVersions, owner)}
			where ${schema.lorebooks.id} = ${lorebookId}
		`)
		// A session's write is a change, filed per key; a lasting write files nothing.
		if (w.anchor)
			for (const key of keys)
				await imprintField(
					tx as unknown as Db,
					w.anchor,
					{ lorebookId, subject: "annex", subjectId: lorebookId, field: `${owner}/${key}` },
					previous[key],
					next[key]
				)
		return { changed: true, keys, annex: next, version: version + 1 }
	})
}

/**
 * 🚧 (M2b) One owner's annex document version on one book (0 before the first
 * write) — what `lorebook-annex`'s `version` reads for `set-lorebook-annex`'s `base`.
 */
export async function lorebookAnnexVersion(db: Db, lorebookId: number, owner: string): Promise<number> {
	const [row] = await db
		.select({ versions: schema.lorebooks.annexVersions })
		.from(schema.lorebooks)
		.where(eq(schema.lorebooks.id, lorebookId))
		.limit(1)
	return annexVersionOf(row?.versions, owner)
}

/** The books a session reads the lorebook annex from, in overlay order (later wins), with their annex columns. */
async function booksOfSession(
	db: Db,
	sessionId: number
): Promise<{ annex: Record<string, unknown>; audiences: Record<string, Record<string, string[]>> }[]> {
	const [session] = await db
		.select({ lorebookId: schema.sessions.lorebookId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	if (!session) return []
	const attachedId = session.lorebookId ?? null
	const rows = await db
		.select({
			id: schema.lorebooks.id,
			sessionId: schema.lorebooks.sessionId,
			overlayOf: schema.lorebooks.overlayOf,
			annex: schema.lorebooks.annex,
			audiences: schema.lorebooks.annexAudiences
		})
		.from(schema.lorebooks)
		.where(
			attachedId === null
				? eq(schema.lorebooks.sessionId, sessionId)
				: or(eq(schema.lorebooks.id, attachedId), eq(schema.lorebooks.sessionId, sessionId))
		)
	const attached = attachedId === null ? undefined : rows.find((r) => r.id === attachedId)
	const own = rows.find((r) => r.sessionId === sessionId && r.id !== attachedId)
	// The own book is read alone when nothing is attached, and over the attached book only when it overlays it.
	const chosen =
		attachedId === null
			? own
				? [own]
				: []
			: [...(attached ? [attached] : []), ...(own && own.overlayOf === attachedId ? [own] : [])]
	return chosen.map((r) => ({
		annex: (r.annex ?? {}) as Record<string, unknown>,
		audiences: (r.audiences ?? {}) as Record<string, Record<string, string[]>>
	}))
}

/**
 * What a session reads of one owner's lorebook annex: its attached book's
 * document overlaid key by key by its own book's (when the own book overlays
 * it); with no attached book, the own book's alone.
 */
export async function sessionLorebookAnnex(
	db: Db,
	sessionId: number,
	owner: string
): Promise<Record<string, unknown>> {
	let out: Record<string, unknown> = {}
	for (const book of await booksOfSession(db, sessionId))
		if (isDocument(book.annex[owner])) out = { ...out, ...(book.annex[owner] as Record<string, unknown>) }
	return out
}

/** What a book-level run reads of one owner's lorebook annex: that book's document. */
export async function bookLorebookAnnex(
	db: Db,
	lorebookId: number,
	owner: string
): Promise<Record<string, unknown>> {
	const [row] = await db
		.select({ annex: schema.lorebooks.annex })
		.from(schema.lorebooks)
		.where(eq(schema.lorebooks.id, lorebookId))
		.limit(1)
	const doc = ((row?.annex ?? {}) as Record<string, unknown>)[owner]
	return isDocument(doc) ? doc : {}
}

/** The union of a session's books' stored audiences, the later book's key winning. */
function unionAudiences(books: readonly { audiences: Record<string, Record<string, string[]>> }[]): DataAudiences {
	const out: Record<string, Record<string, ParticipantRef[]>> = {}
	for (const book of books)
		for (const [owner, keys] of Object.entries(book.audiences))
			for (const [key, refs] of Object.entries(keys ?? {}))
				(out[owner] ??= {})[key] = (refs ?? []).filter((r) => isParticipantRef(r)) as ParticipantRef[]
	return out
}

/**
 * One member's view of the lorebook annex their session reads, or null when
 * they cannot reach the session: the values whose stored audience (the
 * declaration's `see`) holds for them, as `annexViewFor` does for the session
 * annex. A key stored with no audience is pipelines only.
 */
export async function lorebookAnnexViewFor(
	db: Db,
	sessionId: number,
	userId: number
): Promise<AnnexView | null> {
	const access = await checkSessionAccess(sessionId, userId)
	if (!access.hasAccess) return null
	const books = await booksOfSession(db, sessionId)
	const values: Record<string, unknown> = {}
	for (const book of books)
		for (const [owner, doc] of Object.entries(book.annex))
			if (isDocument(doc)) values[owner] = { ...(isDocument(values[owner]) ? values[owner] : {}), ...doc }
	const audiences = unionAudiences(books)
	// Only well-formed references reach the resolver: one malformed row must
	// not fail every member's view (it holds for nobody instead).
	const refs = [...new Set(Object.values(audiences).flatMap((keys) => Object.values(keys).flat()))]
	if (!refs.length) return {}
	const portrayals = await resolvePortrayals(db, { sessionId, runOwnerUserId: userId, refs })
	return visibleTo(values, audiences, (held) => audienceHolds(held, portrayals, { userId }))
}

/**
 * Re-send every member their own view of the lorebook annex, after it
 * changed. Each gets theirs alone, through the per-recipient emit.
 */
export async function pushLorebookAnnexViews(db: Db, io: SessionIo, sessionId: number): Promise<void> {
	if (!io) return
	const [session] = await db
		.select({ ownerId: schema.sessions.userId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	if (!session) return
	// Nothing anybody may see: every view is `{}`, and was before.
	const audiences = unionAudiences(await booksOfSession(db, sessionId))
	if (!Object.values(audiences).some((keys) => Object.keys(keys ?? {}).length)) return
	const guests = await db
		.select({ userId: schema.sessionGuests.userId })
		.from(schema.sessionGuests)
		.where(eq(schema.sessionGuests.sessionId, sessionId))
	const members = new Set<number>([session.ownerId, ...guests.map((g) => g.userId)])
	// Lazy: the view is built only for a member with a tab that wants it.
	for (const userId of members)
		await emitToUserRedacted(io, userId, "sessions:lorebookAnnex", async () => {
			const annex = await lorebookAnnexViewFor(db, sessionId, userId)
			return annex === null ? null : { sessionId, annex }
		})
}
