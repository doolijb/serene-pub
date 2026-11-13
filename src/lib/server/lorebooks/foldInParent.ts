/**
 * 🚧 **Merge the attached book into a session's notes** (code word: *fold*;
 * `merge` already means graph merge, the seat merge rule and `scenes:merge`).
 *
 * Rulings. ★27-10 (2026-11-05): "All sessions have a lorebook, [own book] or
 * overlay. No exceptions so SDK data storage API is predictable. No swapping
 * lorebooks. But [own books] can be surfaced and **overlays can have their
 * parent merged in place**." ★B-1 (2026-11-08): the fold copies the whole
 * parent, every line, the session's line remapped. ★B-2: the button says
 * *Merge ‹book› into these notes*.
 *
 * `foldInParent` copies the session's attached book P into the session's own
 * book O (`copyLorebookTables`, the turn ties kept), moves the session's own
 * rows and the seats, speakers and state refs that named P's rows onto the
 * copies, re-files O's own world values above the copied ones (★bk-fold-4),
 * then sets `sessions.lorebook_id` null: from then on the session reads only its
 * notes, on its own line and moment. One transaction; every statement runs on
 * its `tx`. P is never written, except that this session's scene captures move
 * out of it (★bk-fold-5, "P byte-identical except this session's captures").
 *
 * The guard: before the first write and after the last, the session's reads are
 * taken with the readers the session page uses (`seatMembersAsRead` for every
 * live seat, `membersAsRead` for every member of P and every own member,
 * `sessionEntriesAsRead`) and compared as a content projection. The before ids
 * go through the copy's id maps; these fields are dropped because they name the
 * book or are meant to change: members: `castMemberId`, `lorebookId`,
 * `castVersionId` and each sprite set's `id`; entries: `entryId` (the key) and
 * `sessionOnly`. Everything else (shown name, name, profile fields, active card,
 * follows, face, voice, sprite sets, tags; an entry's type, name, keys, why it is
 * unseen) must be equal, or the fold throws `readsDifferently` and rolls
 * back. Reads are compared at the session's current reading; "at every live
 * message" is covered by the Back and Forward tests.
 *
 * The guard also reads each entry's text and fields as the session reads them (dated amendments applied) and the
 * resolved values (`stateFor`: the world, each seat, each place). Text the copy renumbered (`maps.tags`) is compared
 * after the same renumbering.
 *
 * Members of O fold into the copy of a member of P (★bk-fold-3): a *notes member* (a non-overlay member of O holding
 * a card a member of P holds) and a *member overlay* (`overlay_of` a member of P). Both let go of the card before the
 * copy (`lorebook_bindings_character_unique`), and from the copy on `maps.bindings` also maps them to the copy of the
 * member they sit beside, so every step that moves a reference moves theirs too. A notes member's values, configs and
 * zones are re-filed above the copy's, its sheets and scene casts re-owned, and it is deleted. An overlay's versions
 * are carried onto the copy; the overlay and its versions stay where a branch of this session still reads them.
 */
import { and, asc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm"
import { qualifiedSlotKey, slotKey } from "$lib/server/state/keys"
import { alias } from "drizzle-orm/pg-core"
import * as schema from "$lib/server/db/schema"
import { FOLD_REFUSALS } from "$lib/shared/lorebooks/sessionNotes"
import type { IdMap, IdMaps } from "$lib/server/lorebooks/tableRegistry"
import type { SeatChange } from "$lib/server/sessions/seats"

type OwnBookModule = typeof import("$lib/server/lorebooks/ownBook")

/** A source id's copy, where the map holds it; else the id as it was. */
const through = (
	map: ReadonlyMap<number, number>,
	id: number | null | undefined
): number | null => (id == null ? null : (map.get(id) ?? id))

const isRecord = (v: unknown): v is Record<string, unknown> =>
	!!v && typeof v === "object" && !Array.isArray(v)

/** Which ids an owner kind names: a member, a place, or the book. */
function ownerThrough(
	kind: string,
	id: number,
	c: { parentId: number; ownId: number; maps: IdMaps }
): number {
	if (kind === "cast_member") return c.maps.bindings.get(id) ?? id
	if (kind === "location" || kind === "session_location")
		return c.maps.entries.get(id) ?? id
	if (kind === "lorebook") return id === c.parentId ? c.ownId : id
	return id
}

/** What the fold keeps while it runs. */
interface FoldContext {
	t: Db
	sessionId: number
	parentId: number
	ownId: number
	maps: IdMaps
	/** Rows O held before the copy: the ones whose references to P's rows are rewritten. */
	preCopy: {
		entries: number[]
		bindings: number[]
		scenes: number[]
		relationships: number[]
		suggestions: number[]
		worldValues: number[]
		worldConfigs: number[]
	}
	/** This session's captures moved out of P: their ids. */
	captured: Set<number>
	/** Members of O that fold into the copy of a member of P. */
	folded: FoldedMember[]
	/** The member number each folded notes member's tags carry, by member id. */
	notesNumbers: ReadonlyMap<number, number>
	/** The ids of the folded members' attribute rows and zones, before anything moved. */
	memberRows: { values: number[]; configs: number[]; zones: number[] }
	/** The session's line after the move (null = main). */
	lineId: number | null
}

/** A member of O that folds into the copy of `from`, a member of P: a notes member holding the card of one, or a member overlay of one. */
interface FoldedMember {
	id: number
	from: number
	kind: "notes" | "overlay"
}

// ── Step 1: lock ────────────────────────────────────────────────────────────

/** Lock P and O (lower id first) and re-read the session; a fold that raced finds `lorebook_id` already null. */
async function lockAndRead(t: Db, sessionId: number, mod: OwnBookModule) {
	const [pre] = await t
		.select({ lorebookId: schema.sessions.lorebookId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	if (!pre) throw new mod.OwnBookRefusal(FOLD_REFUSALS.missing)
	if (pre.lorebookId == null)
		throw new mod.OwnBookRefusal(FOLD_REFUSALS.alreadyOwn)
	const own =
		(await mod.ownBookOf(t, sessionId)) ??
		(await mod.ownBookFor(t, sessionId))
	for (const id of [pre.lorebookId, own.id].sort((a, b) => a - b))
		await t.execute(
			sql`select pg_advisory_xact_lock(hashtext('lorebook-fold'), ${id})`
		)
	const [session] = await t
		.select({
			lorebookId: schema.sessions.lorebookId,
			lorebookBranchId: schema.sessions.lorebookBranchId
		})
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	if (!session || session.lorebookId == null)
		throw new mod.OwnBookRefusal(FOLD_REFUSALS.alreadyOwn)
	const [parent] = await t
		.select({ id: schema.lorebooks.id, name: schema.lorebooks.name })
		.from(schema.lorebooks)
		.where(eq(schema.lorebooks.id, session.lorebookId))
		.limit(1)
	if (!parent) throw new mod.OwnBookRefusal(FOLD_REFUSALS.missing)
	return { parent, ownId: own.id, lorebookBranchId: session.lorebookBranchId }
}

// ── Steps 2 and 13: the guard ───────────────────────────────────────────────

/** The session's reads, each in its own key; compared before and after. */
interface Reads {
	/** A live seat → the member it seats (id) and as read. */
	seats: Map<string, { member: number | null; value: unknown }>
	members: Map<number, unknown>
	/** An entry as listed → whether the notes hold it, and its list fields and text as read. */
	entries: Map<number, { own: boolean; value: unknown }>
	/** The resolved state, raw: projected at the compare, where the before ids are mapped. */
	state: import("$lib/server/state/resolve").ResolvedState
}

/** A projection with every object's keys in one order, so two equal values stringify equally. */
function canon(v: unknown): unknown {
	if (Array.isArray(v)) return v.map(canon)
	if (v instanceof Date) return v.toISOString()
	if (isRecord(v))
		return Object.fromEntries(
			Object.keys(v)
				.sort()
				.map((k) => [k, canon(v[k])])
		)
	return v
}

/** The first path at which two canonical values differ; null when equal. */
function firstDifference(a: unknown, b: unknown, path = ""): string | null {
	if (JSON.stringify(a) === JSON.stringify(b)) return null
	if (isRecord(a) && isRecord(b)) {
		for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
			const d = firstDifference(a[k], b[k], path ? `${path}.${k}` : k)
			if (d) return d
		}
	}
	return path || "(whole)"
}

function memberProjection(
	m: import("$lib/server/cast/memberAsRead").MemberAsRead | null | undefined
): unknown {
	if (!m) return null
	const {
		castMemberId: _m,
		lorebookId: _b,
		castVersionId: _v,
		spriteSets,
		...rest
	} = m
	return canon({
		...rest,
		spriteSets: spriteSets.map(({ id: _i, ...s }) => s)
	})
}

/** The members to read: every member of P (mapped after the copy), and the own members that are neither overlays nor folded. */
async function memberIdsOf(
	t: Db,
	lorebookIds: readonly number[],
	ownId: number,
	folded: ReadonlySet<number>
): Promise<number[]> {
	const b = schema.lorebookBindings
	const rows = await t
		.select({ id: b.id, lorebookId: b.lorebookId, overlayOf: b.overlayOf })
		.from(b)
		.where(inArray(b.lorebookId, [...lorebookIds]))
		.orderBy(asc(b.id))
	return rows
		.filter(
			(r) =>
				(r.lorebookId !== ownId || r.overlayOf == null) &&
				!folded.has(r.id)
		)
		.map((r) => r.id)
}

/** Fields an amendment overlays that name a row by id: left out of the text projection, since the copy renumbers them. */
const ID_FIELDS = [
	"lorebookBindingId",
	"anchorBindingId",
	"parentNodeId",
	"anchorEntryId",
	"historyEntryId",
	"sceneId"
]

/** The listed entries' text and fields as the session reads them: the base row with the line's dated amendments applied, as the prompt's retrieval reads it. */
async function entryTextsOf(
	t: Db,
	sessionId: number,
	entryIds: readonly number[]
): Promise<Map<number, unknown>> {
	const out = new Map<number, unknown>()
	if (!entryIds.length) return out
	const [
		{ entryOverlaysFor, entryAt, MAIN_HEAD },
		{ sessionReadingOf },
		own
	] = await Promise.all([
		import("$lib/server/state/entriesOnReading"),
		import("$lib/server/state/reading"),
		import("$lib/server/lorebooks/ownBook")
	])
	const books = await own.lorebooksReadBy(t, sessionId)
	const reading = await sessionReadingOf(t, sessionId)
	const e = schema.lorebookEntries
	const reads: Array<[number, typeof MAIN_HEAD]> = []
	if (books.attachedId != null && reading)
		reads.push([reading.lorebookId, reading])
	if (books.ownBookId != null)
		reads.push([
			books.ownBookId,
			books.attachedId == null ? (reading ?? MAIN_HEAD) : MAIN_HEAD
		])
	for (const [bookId, at] of reads) {
		const rows = await t
			.select({
				id: e.id,
				title: e.title,
				content: e.content,
				fields: e.fields,
				enabled: e.enabled,
				archived: e.archived
			})
			.from(e)
			.where(and(eq(e.lorebookId, bookId), inArray(e.id, [...entryIds])))
		const overlays = await entryOverlaysFor(t, bookId, at, entryIds)
		for (const r of rows) {
			const seen = entryAt(
				{
					id: r.id,
					name: r.title ?? "",
					content: r.content,
					enabled: r.enabled,
					archived: r.archived,
					...((r.fields ?? {}) as Record<string, unknown>)
				} as Record<string, unknown> & { id: number },
				overlays,
				at
			)
			const { id: _id, ...rest } = seen
			for (const k of ID_FIELDS) delete rest[k]
			out.set(r.id, canon(rest))
		}
	}
	return out
}

/** Take the session's reads on its current reading. `memberIds` are the members to read; `seats` are the seat rows. */
async function readSession(
	t: Db,
	sessionId: number,
	memberIds: readonly number[]
): Promise<Reads> {
	const [
		{ seatMembersAsRead },
		{ membersAsRead },
		{ sessionEntriesAsRead },
		{ stateFor }
	] = await Promise.all([
		import("$lib/server/pipelines/prompt/seatCards"),
		import("$lib/server/cast/memberAsRead"),
		import("$lib/server/lorebooks/ownBook"),
		import("$lib/server/state/resolve")
	])
	const seats = new Map<string, { member: number | null; value: unknown }>()
	const sc = schema.sessionCharacters
	const sp = schema.sessionPersonas
	const rows = [
		...(
			await t
				.select({
					id: sc.id,
					castMemberId: sc.castMemberId,
					cardId: sc.characterId
				})
				.from(sc)
				.where(and(eq(sc.sessionId, sessionId), isNull(sc.removedAt)))
				.orderBy(asc(sc.id))
		).map((r) => ({
			key: `character:${r.id}`,
			castMemberId: r.castMemberId,
			cardId: r.cardId
		})),
		...(
			await t
				.select({
					id: sp.id,
					castMemberId: sp.castMemberId,
					cardId: sp.personaId
				})
				.from(sp)
				.where(and(eq(sp.sessionId, sessionId), isNull(sp.removedAt)))
				.orderBy(asc(sp.id))
		).map((r) => ({
			key: `player:${r.id}`,
			castMemberId: r.castMemberId,
			cardId: r.cardId
		}))
	]
	const read = await seatMembersAsRead(
		t,
		sessionId,
		rows.map((r) => ({
			castMemberId: r.castMemberId,
			character: r.cardId != null ? { id: r.cardId } : null
		})),
		{ cardless: true }
	)
	rows.forEach((r, i) =>
		seats.set(r.key, {
			member: r.castMemberId,
			value: memberProjection(read[i])
		})
	)
	const members = new Map<number, unknown>()
	const asRead = await membersAsRead(t, memberIds, { sessionId })
	for (const id of memberIds)
		members.set(id, memberProjection(asRead.get(id)))
	const listed = await sessionEntriesAsRead(t, sessionId, "session", null)
	const texts = await entryTextsOf(
		t,
		sessionId,
		listed.map((e) => e.entryId)
	)
	const entries = new Map<number, { own: boolean; value: unknown }>()
	for (const e of listed)
		entries.set(e.entryId, {
			own: e.sessionOnly === true,
			value: canon({
				typeId: e.typeId,
				name: e.name,
				keys: e.keys,
				unseen: e.unseen,
				text: texts.get(e.entryId) ?? null
			})
		})
	return { seats, members, entries, state: await stateFor(t, sessionId) }
}

/** The resolved values the session reads, with the ids a copy renumbers passed through `rekey`. */
function stateProjection(
	state: Reads["state"],
	rekey: (key: string) => string,
	skip: ReadonlySet<string>
): unknown {
	const without = (o: unknown, drop: string[]) =>
		isRecord(o)
			? Object.fromEntries(
					Object.entries(o).filter(([k]) => !drop.includes(k))
				)
			: o
	const keyed = (o: Record<string, unknown> | undefined) =>
		Object.fromEntries(
			Object.entries(o ?? {}).map(([k, v]) => [rekey(k), v])
		)
	// A slot the notes held a row of their own for reads the notes' row on top after the fold: not compared.
	const skipped = new Set(
		[...skip].flatMap((id) => [slotKey(id), qualifiedSlotKey(id)])
	)
	const slots = (o: unknown): unknown =>
		isRecord(o)
			? Object.fromEntries(
					Object.entries(o).filter(
						([k]) => !skipped.has(k) && !skip.has(k)
					)
				)
			: o
	return canon({
		world: slots(state.world),
		cast: keyed(
			Object.fromEntries(
				Object.entries(state.cast.byId).map(([k, v]) => {
					const entry = without(v, [
						"castMemberId",
						"playerSeatId"
					]) as Record<string, unknown>
					return [
						k,
						slots(
							typeof entry.ref === "string"
								? { ...entry, ref: rekey(entry.ref) }
								: entry
						)
					]
				})
			)
		),
		locations: Object.values(state.locations.byId)
			.map((l) => without(l, ["id"]) as Record<string, unknown>)
			.sort((a, b) =>
				`${a.name}|${a.key}`.localeCompare(`${b.name}|${b.key}`)
			),
		configs: Object.fromEntries(
			Object.entries(keyed(state.configs as Record<string, unknown>)).map(
				([k, v]) => [k, slots(v)]
			)
		),
		notCarried: Object.fromEntries(
			Object.entries(
				keyed(state.notCarried as Record<string, unknown>)
			).map(([k, v]) => [
				k,
				Array.isArray(v) ? v.filter((id) => !skip.has(id)) : v
			])
		)
	})
}

/**
 * The first difference between the reads before and after (the before ids mapped through the copy), or null. A
 * before value read from P is compared after `retag` (the copy renumbered the cast tags in its text).
 */
function compareReads(
	before: Reads,
	after: Reads,
	maps: IdMaps,
	parentMembers: ReadonlySet<number>,
	retag: <T>(v: T) => T,
	retagOwn: <T>(v: T) => T,
	notesSlots: ReadonlySet<string>
): string | null {
	for (const [key, was] of before.seats) {
		const value =
			was.member != null && parentMembers.has(was.member)
				? retag(was.value)
				: retagOwn(was.value)
		const d = firstDifference(value, after.seats.get(key)?.value)
		if (d) return `seat ${key}: ${d}`
	}
	for (const [id, was] of before.members) {
		const to = maps.bindings.get(id) ?? id
		const value = parentMembers.has(id) ? retag(was) : retagOwn(was)
		const d = firstDifference(value, after.members.get(to))
		if (d) return `member ${id} (now ${to}): ${d}`
	}
	const wasEntries = new Map<number, { own: boolean; value: unknown }>()
	for (const [id, was] of before.entries)
		wasEntries.set(maps.entries.get(id) ?? id, {
			own: was.own || !maps.entries.has(id),
			value: was.value
		})
	for (const [id, was] of wasEntries) {
		const now = after.entries.get(id)
		if (!now) return `entry ${id}: no longer read`
		const d = firstDifference(
			was.own ? retagOwn(was.value) : retag(was.value),
			now.value
		)
		if (d) return `entry ${id}: ${d}`
	}
	for (const id of after.entries.keys())
		if (!wasEntries.has(id)) return `entry ${id}: newly read`
	const rekey = (key: string): string => {
		for (const [prefix, map] of [
			["seated_member:", maps.bindings],
			["seated-member:", maps.bindings],
			["cast_member:", maps.bindings],
			["location:", maps.entries],
			["session_location:", maps.entries]
		] as const) {
			if (!key.startsWith(prefix)) continue
			const id = Number(key.slice(prefix.length))
			return `${prefix}${map.get(id) ?? id}`
		}
		return key
	}
	const d = firstDifference(
		stateProjection(before.state, rekey, notesSlots),
		stateProjection(after.state, (k) => k, notesSlots)
	)
	return d ? `values ${d}` : null
}

// ── Step 4: the copy ────────────────────────────────────────────────────────

/** Rows O holds before the copy, by table. */
async function snapshotOwn(
	t: Db,
	ownId: number
): Promise<FoldContext["preCopy"]> {
	const ids = async (table: any, where: unknown) =>
		(
			await t
				.select({ id: table.id })
				.from(table)
				.where(where as any)
				.orderBy(asc(table.id))
		).map((r: { id: number }) => r.id)
	const V = schema.attributeValues
	const C = schema.attributeConfigs
	const book = (kind: typeof V | typeof C) =>
		and(
			eq(kind.ownerKind, "lorebook"),
			eq(kind.ownerId, ownId),
			isNull(kind.sessionId)
		)
	return {
		entries: await ids(
			schema.lorebookEntries,
			eq(schema.lorebookEntries.lorebookId, ownId)
		),
		bindings: await ids(
			schema.lorebookBindings,
			eq(schema.lorebookBindings.lorebookId, ownId)
		),
		scenes: await ids(schema.scenes, eq(schema.scenes.lorebookId, ownId)),
		relationships: await ids(
			schema.narrativeRelationships,
			eq(schema.narrativeRelationships.lorebookId, ownId)
		),
		suggestions: await ids(
			schema.bindingSuggestions,
			eq(schema.bindingSuggestions.lorebookId, ownId)
		),
		worldValues: await ids(V, book(V)),
		worldConfigs: await ids(C, book(C))
	}
}

/**
 * The members of O that fold into the copy of a member of P (★bk-fold-3): a notes member (not an overlay) that holds a
 * card a member of P holds, and a member overlay (`overlay_of` a member of P). `released` are the ones holding a card
 * a member of P holds, which `releaseCards` lets go of before the copy.
 */
async function findFoldedMembers(
	t: Db,
	parentId: number,
	ownId: number
): Promise<{ folded: FoldedMember[]; released: number[] }> {
	const b = schema.lorebookBindings
	const p = alias(b, "parent_member")
	const clashes = await t
		.select({ id: b.id, from: p.id, overlayOf: b.overlayOf })
		.from(b)
		.innerJoin(p, eq(p.characterId, b.characterId))
		.where(
			and(
				eq(b.lorebookId, ownId),
				eq(p.lorebookId, parentId),
				isNotNull(b.characterId)
			)
		)
		.orderBy(asc(b.id))
	const inParent = new Set(
		(
			await t
				.select({ id: b.id })
				.from(b)
				.where(eq(b.lorebookId, parentId))
		).map((r) => r.id)
	)
	const overlays = (
		await t
			.select({ id: b.id, from: b.overlayOf })
			.from(b)
			.where(and(eq(b.lorebookId, ownId), isNotNull(b.overlayOf)))
			.orderBy(asc(b.id))
	).filter((r) => r.from != null && inParent.has(r.from))
	const folded = new Map<number, FoldedMember>()
	for (const o of overlays)
		folded.set(o.id, { id: o.id, from: o.from!, kind: "overlay" })
	for (const c of clashes)
		if (c.overlayOf == null)
			folded.set(c.id, { id: c.id, from: c.from, kind: "notes" })
	return {
		folded: [...folded.values()].sort((x, y) => x.id - y.id),
		released: clashes.map((c) => c.id)
	}
}

/** The slots the notes held a row of their own for: on the world (the notes' book) and on a folded member. */
async function slotsHeldByNotes(
	t: Db,
	ownId: number,
	folded: readonly FoldedMember[]
): Promise<Set<string>> {
	const out = new Set<string>()
	for (const table of [
		schema.attributeValues,
		schema.attributeConfigs
	] as const) {
		const rows = await t
			.selectDistinct({ slotId: table.slotId })
			.from(table)
			.where(
				or(
					and(
						eq(table.ownerKind, "lorebook"),
						eq(table.ownerId, ownId),
						isNull(table.sessionId)
					),
					folded.length
						? and(
								eq(table.ownerKind, "cast_member"),
								inArray(
									table.ownerId,
									folded.map((f) => f.id)
								)
							)
						: undefined
				)
			)
		for (const r of rows) out.add(r.slotId)
	}
	return out
}

/** A member of O lets go of its card before the copy: `lorebook_bindings_character_unique` is per book and card. */
async function releaseCards(t: Db, ids: readonly number[]): Promise<void> {
	if (!ids.length) return
	await t
		.update(schema.lorebookBindings)
		.set({ characterId: null })
		.where(inArray(schema.lorebookBindings.id, [...ids]))
}

// ── Step 5: P's book facts into O ───────────────────────────────────────────

/** A document per owner: P's under O's, key by key, as the session read them. */
function mergedDocuments(
	parent: Record<string, unknown>,
	own: Record<string, unknown>
): Record<string, unknown> {
	const out: Record<string, unknown> = {}
	for (const owner of new Set([
		...Object.keys(parent),
		...Object.keys(own)
	])) {
		const a = parent[owner]
		const b = own[owner]
		out[owner] = isRecord(a) && isRecord(b) ? { ...a, ...b } : (b ?? a)
	}
	return out
}

async function carryBookFacts(c: FoldContext): Promise<void> {
	const { t } = c
	const L = schema.lorebooks
	const [parent] = await t.select().from(L).where(eq(L.id, c.parentId))
	const [own] = await t.select().from(L).where(eq(L.id, c.ownId))
	if (!parent || !own) return
	const audiences: Record<string, Record<string, string[]>> = {}
	const parentAudiences = (parent.annexAudiences ?? {}) as Record<
		string,
		Record<string, string[]>
	>
	const ownAudiences = (own.annexAudiences ?? {}) as Record<
		string,
		Record<string, string[]>
	>
	for (const owner of new Set([
		...Object.keys(parentAudiences),
		...Object.keys(ownAudiences)
	]))
		audiences[owner] = {
			...(parentAudiences[owner] ?? {}),
			...(ownAudiences[owner] ?? {})
		}
	// A merged document is a new document: its version moves, so a write built on the old read is stale.
	const parentVersions = (parent.annexVersions ?? {}) as Record<
		string,
		number
	>
	const ownVersions = (own.annexVersions ?? {}) as Record<string, number>
	const parentAnnex = (parent.annex ?? {}) as Record<string, unknown>
	const ownAnnex = (own.annex ?? {}) as Record<string, unknown>
	const versions: Record<string, number> = {}
	for (const owner of new Set([
		...Object.keys(parentVersions),
		...Object.keys(ownVersions)
	])) {
		const both = isRecord(parentAnnex[owner]) && isRecord(ownAnnex[owner])
		const top = Math.max(
			parentVersions[owner] ?? 0,
			ownVersions[owner] ?? 0
		)
		versions[owner] = both ? top + 1 : top
	}
	// `next_binding_number`: above every tag the book now holds.
	const { castTagNumber } = await import("$lib/server/utils/castTags")
	const tags = await t
		.select({ binding: schema.lorebookBindings.binding })
		.from(schema.lorebookBindings)
		.where(eq(schema.lorebookBindings.lorebookId, c.ownId))
	const top = Math.max(0, ...tags.map((r) => castTagNumber(r.binding) ?? 0))
	await t
		.update(L)
		.set({
			storyCalendar: parent.storyCalendar,
			storyClockYear: parent.storyClockYear,
			storyClockMonth: parent.storyClockMonth,
			storyClockDay: parent.storyClockDay,
			storyClockHour: parent.storyClockHour,
			storyClockMinute: parent.storyClockMinute,
			primaryRuleset: parent.primaryRuleset,
			rulesetVersion: parent.rulesetVersion,
			annex: mergedDocuments(parentAnnex, ownAnnex),
			annexAudiences: audiences,
			annexVersions: versions,
			nextBindingNumber: Math.max(
				own.nextBindingNumber,
				parent.nextBindingNumber,
				top + 1
			)
		})
		.where(eq(L.id, c.ownId))
}

// ── Step 6: the session's line ──────────────────────────────────────────────

async function moveSessionLine(
	c: FoldContext,
	lorebookBranchId: number | null
): Promise<void> {
	await c.t
		.update(schema.sessions)
		.set({
			lorebookBranchId:
				lorebookBranchId == null
					? null
					: (c.maps.branches.get(lorebookBranchId) ?? null)
		})
		.where(eq(schema.sessions.id, c.sessionId))
}

// ── Step 7: the captures ────────────────────────────────────────────────────

/** This session's scenes filed in P move to O; the copy's capture-less duplicate of each goes. */
async function moveCaptures(c: FoldContext): Promise<void> {
	const { t, maps } = c
	const sc = schema.scenes
	const moving = await t
		.select({
			id: sc.id,
			branchId: sc.branchId,
			historyEntryId: sc.historyEntryId
		})
		.from(sc)
		.where(
			and(eq(sc.sessionId, c.sessionId), eq(sc.lorebookId, c.parentId))
		)
	for (const scene of moving) {
		const duplicate = maps.scenes.get(scene.id)
		if (duplicate != null) {
			// What the copy tied to the duplicate is tied to the capture.
			await t
				.update(schema.lorebookBindings)
				.set({ sceneId: scene.id })
				.where(eq(schema.lorebookBindings.sceneId, duplicate))
			await t
				.update(schema.narrativeRelationships)
				.set({ sceneId: scene.id })
				.where(eq(schema.narrativeRelationships.sceneId, duplicate))
			await t
				.update(schema.attributeValues)
				.set({ sceneId: scene.id })
				.where(eq(schema.attributeValues.sceneId, duplicate))
			await t
				.update(schema.attributeConfigs)
				.set({ sceneId: scene.id })
				.where(eq(schema.attributeConfigs.sceneId, duplicate))
			await t.delete(sc).where(eq(sc.id, duplicate))
		}
		await t
			.update(sc)
			.set({
				lorebookId: c.ownId,
				branchId:
					scene.branchId == null
						? null
						: (maps.branches.get(scene.branchId) ?? null),
				historyEntryId:
					scene.historyEntryId == null
						? null
						: (maps.entries.get(scene.historyEntryId) ?? null)
			})
			.where(eq(sc.id, scene.id))
		const cast = await t
			.select({
				id: schema.sceneCharacters.id,
				bindingId: schema.sceneCharacters.bindingId
			})
			.from(schema.sceneCharacters)
			.where(eq(schema.sceneCharacters.sceneId, scene.id))
		for (const member of cast) {
			const bindingId = through(maps.bindings, member.bindingId)!
			if (bindingId !== member.bindingId)
				await t
					.update(schema.sceneCharacters)
					.set({ bindingId })
					.where(eq(schema.sceneCharacters.id, member.id))
		}
		c.captured.add(scene.id)
	}
}

// ── Step 8: O's own rows that named P's rows ────────────────────────────────

/**
 * O's own rows name the copies. Rewritten: entries (`anchor_entry_id`, `anchor_binding_id`); links (`from/to_entry_id`,
 * `from/to_node_id`, `history_entry_id`, `scene_id`); members (`parent_node_id`, `history_entry_id`, `scene_id`); scenes
 * (`history_entry_id`); annotations (`entity_key`, `ref_entry_id`); suggestions (`entity_key`, `resolved_binding_id`,
 * `example_source_id`); the rule-fed overlay in `extra_json` (entry fields, cast states, place values). A reference to
 * a scene is never moved to the duplicate of a capture, which is gone.
 */
async function rewriteOwnRows(c: FoldContext): Promise<void> {
	const { t, maps, preCopy } = c
	const sceneTo: IdMap = new Map(
		[...maps.scenes].filter(([k]) => !c.captured.has(k))
	)

	const e = schema.lorebookEntries
	for (const row of preCopy.entries.length
		? await t
				.select({
					id: e.id,
					anchorEntryId: e.anchorEntryId,
					anchorBindingId: e.anchorBindingId
				})
				.from(e)
				.where(inArray(e.id, preCopy.entries))
		: []) {
		const anchorEntryId = through(maps.entries, row.anchorEntryId)
		const anchorBindingId = through(maps.bindings, row.anchorBindingId)
		if (
			anchorEntryId !== row.anchorEntryId ||
			anchorBindingId !== row.anchorBindingId
		)
			await t
				.update(e)
				.set({ anchorEntryId, anchorBindingId })
				.where(eq(e.id, row.id))
	}

	const r = schema.narrativeRelationships
	const pairKey = (x: {
		fromEntryId: number | null
		toEntryId: number | null
		relationshipType: string
		title: string | null
		branchId: number | null
		historyEntryId: number | null
	}) =>
		`${x.fromEntryId}|${x.toEntryId}|${x.relationshipType.toLowerCase()}|${(x.title ?? "").toLowerCase()}|${x.branchId ?? 0}|${x.historyEntryId ?? 0}`
	const held = new Set(
		(
			await t
				.select({
					fromEntryId: r.fromEntryId,
					toEntryId: r.toEntryId,
					relationshipType: r.relationshipType,
					title: r.title,
					branchId: r.branchId,
					historyEntryId: r.historyEntryId,
					id: r.id
				})
				.from(r)
				.where(
					and(
						eq(r.lorebookId, c.ownId),
						isNotNull(r.fromEntryId),
						isNotNull(r.toEntryId)
					)
				)
		)
			.filter((x) => !preCopy.relationships.includes(x.id))
			.map(pairKey)
	)
	for (const l of preCopy.relationships.length
		? await t.select().from(r).where(inArray(r.id, preCopy.relationships))
		: []) {
		const next = {
			fromEntryId: through(maps.entries, l.fromEntryId),
			toEntryId: through(maps.entries, l.toEntryId),
			fromNodeId: through(maps.bindings, l.fromNodeId),
			toNodeId: through(maps.bindings, l.toNodeId),
			historyEntryId: through(maps.entries, l.historyEntryId),
			sceneId: through(sceneTo, l.sceneId)
		}
		if (
			next.fromEntryId === l.fromEntryId &&
			next.toEntryId === l.toEntryId &&
			next.fromNodeId === l.fromNodeId &&
			next.toNodeId === l.toNodeId &&
			next.historyEntryId === l.historyEntryId &&
			next.sceneId === l.sceneId
		)
			continue
		// The copy already holds this link between the copies: one link per pair.
		if (
			next.fromEntryId != null &&
			next.toEntryId != null &&
			held.has(pairKey({ ...l, ...next }))
		) {
			await t.delete(r).where(eq(r.id, l.id))
			continue
		}
		await t.update(r).set(next).where(eq(r.id, l.id))
	}

	const b = schema.lorebookBindings
	for (const m of preCopy.bindings.length
		? await t
				.select({
					id: b.id,
					parentNodeId: b.parentNodeId,
					historyEntryId: b.historyEntryId,
					sceneId: b.sceneId
				})
				.from(b)
				.where(inArray(b.id, preCopy.bindings))
		: []) {
		const next = {
			parentNodeId: through(maps.bindings, m.parentNodeId),
			historyEntryId: through(maps.entries, m.historyEntryId),
			sceneId: through(sceneTo, m.sceneId)
		}
		if (
			next.parentNodeId !== m.parentNodeId ||
			next.historyEntryId !== m.historyEntryId ||
			next.sceneId !== m.sceneId
		)
			await t.update(b).set(next).where(eq(b.id, m.id))
	}

	const sc = schema.scenes
	for (const s of preCopy.scenes.length
		? await t
				.select({ id: sc.id, historyEntryId: sc.historyEntryId })
				.from(sc)
				.where(inArray(sc.id, preCopy.scenes))
		: []) {
		const historyEntryId = through(maps.entries, s.historyEntryId)
		if (historyEntryId !== s.historyEntryId)
			await t.update(sc).set({ historyEntryId }).where(eq(sc.id, s.id))
	}

	// An entity key names an entry or a member; any other key is kept.
	const rekeyEntity = (key: string): string => {
		for (const [kind, map] of [
			["entry", maps.entries],
			["cast_member", maps.bindings]
		] as const) {
			if (!key.startsWith(`${kind}:`)) continue
			const id = Number(key.slice(kind.length + 1))
			return `${kind}:${map.get(id) ?? id}`
		}
		return key
	}
	const a = schema.entryAnnotations
	for (const row of preCopy.entries.length
		? await t.select().from(a).where(inArray(a.entryId, preCopy.entries))
		: []) {
		const entityKey = rekeyEntity(row.entityKey)
		const refEntryId = through(maps.entries, row.refEntryId)
		if (entityKey !== row.entityKey || refEntryId !== row.refEntryId)
			await t
				.update(a)
				.set({ entityKey, refEntryId })
				.where(
					and(
						eq(a.entryId, row.entryId),
						eq(a.entityKey, row.entityKey)
					)
				)
	}

	const g = schema.bindingSuggestions
	const keys = new Set(
		(
			await t
				.select({ key: g.entityKey, id: g.id })
				.from(g)
				.where(eq(g.lorebookId, c.ownId))
		)
			.filter((x) => !preCopy.suggestions.includes(x.id))
			.map((x) => x.key)
	)
	for (const row of preCopy.suggestions.length
		? await t.select().from(g).where(inArray(g.id, preCopy.suggestions))
		: []) {
		const entityKey = rekeyEntity(row.entityKey)
		const resolvedBindingId = through(maps.bindings, row.resolvedBindingId)
		const exampleSourceId =
			row.exampleSourceKind === "entry"
				? through(maps.entries, row.exampleSourceId)
				: row.exampleSourceId
		// A key the copy already holds stays as it was: one suggestion per key.
		const key =
			entityKey !== row.entityKey && keys.has(entityKey)
				? row.entityKey
				: entityKey
		if (
			key !== row.entityKey ||
			resolvedBindingId !== row.resolvedBindingId ||
			exampleSourceId !== row.exampleSourceId
		)
			await t
				.update(g)
				.set({ entityKey: key, resolvedBindingId, exampleSourceId })
				.where(eq(g.id, row.id))
	}

	// The rule-fed overlay: entry fields and place values keyed by entry id, cast states by member id.
	const L = schema.lorebooks
	const [own] = await t
		.select({ extraJson: L.extraJson })
		.from(L)
		.where(eq(L.id, c.ownId))
	const extra = (own?.extraJson ?? {}) as Record<string, unknown>
	const fed = extra.ruleFed
	if (isRecord(fed)) {
		const rekey = (
			o: unknown,
			map: IdMap
		): Record<string, unknown> | undefined => {
			if (!isRecord(o)) return undefined
			const out: Record<string, unknown> = {}
			for (const [k, v] of Object.entries(o)) {
				const n = Number(k)
				out[
					Number.isInteger(n) && map.has(n) ? String(map.get(n)) : k
				] = v
			}
			return out
		}
		const next: Record<string, unknown> = { ...fed }
		for (const [field, map] of [
			["entryFields", maps.entries],
			["castStates", maps.bindings],
			["placeValues", maps.entries]
		] as const) {
			const keyed = rekey(fed[field], map)
			if (keyed) next[field] = keyed
		}
		await t
			.update(L)
			.set({ extraJson: { ...extra, ruleFed: next } })
			.where(eq(L.id, c.ownId))
	}
}

// ── Step 9: the session's own rows that named P's rows ──────────────────────

/**
 * The session layer, by table. Moved: attribute values and configs of this session (`owner_id` by owner kind:
 * `cast_member` to the copy of the member, `location` and `session_location` to the copy of the entry, `lorebook`
 * P to O; and their `scene_id`, `history_entry_id`, `branch_id`), owner sheets, attribute carries and zone contents
 * (`owner_id` by kind), imprints (member and entry subjects, `lorebook_id`, the paths of the rule-fed overlay, the
 * annex subject P to O), lore sources (`lorebook_id`, entry subjects), pending and decided state proposals
 * (`payload.owner`), ranking evidence of this session's entries (`lore-entry` subjects). Judged not to name P's rows:
 * `session_tags`, `session_changes`, `session_imprints` and `widget_settings` (member refs only, done by
 * `rekeySessionRefs`; a chosen image is a label, never a sprite set id), `scene_cues` (this session's own scenes,
 * which keep their ids), `session_attribute_picks` (slot ids), `tray_items`, `session_functions`, `registrations`,
 * `pipeline_runs` and `channel_lanes`. Not mappable: an imprint or lore source of a link (relationship); the copy
 * keeps no map of link ids, so those rows keep naming P's link and its book.
 */
async function moveSessionRows(c: FoldContext): Promise<void> {
	const { t, maps } = c
	const owner = (kind: string, id: number) => ownerThrough(kind, id, c)

	for (const table of [
		schema.attributeValues,
		schema.attributeConfigs
	] as const) {
		const rows = await t
			.select({
				id: table.id,
				ownerKind: table.ownerKind,
				ownerId: table.ownerId,
				sceneId: table.sceneId,
				historyEntryId: table.historyEntryId,
				branchId: table.branchId
			})
			.from(table)
			.where(eq(table.sessionId, c.sessionId))
		for (const row of rows) {
			const next = {
				ownerId: owner(row.ownerKind, row.ownerId),
				sceneId:
					row.sceneId != null && c.captured.has(row.sceneId)
						? row.sceneId
						: through(maps.scenes, row.sceneId),
				historyEntryId: through(maps.entries, row.historyEntryId),
				branchId: through(maps.branches, row.branchId)
			}
			if (
				next.ownerId !== row.ownerId ||
				next.sceneId !== row.sceneId ||
				next.historyEntryId !== row.historyEntryId ||
				next.branchId !== row.branchId
			)
				await t.update(table).set(next).where(eq(table.id, row.id))
		}
	}

	for (const table of [
		schema.ownerSheets,
		schema.attributeCarries,
		schema.zoneContents
	] as const) {
		const rows = await t
			.select({
				id: table.id,
				ownerKind: table.ownerKind,
				ownerId: table.ownerId
			})
			.from(table)
			.where(eq(table.sessionId, c.sessionId))
		for (const row of rows) {
			const ownerId = owner(row.ownerKind, row.ownerId)
			if (ownerId !== row.ownerId)
				await t
					.update(table)
					.set({ ownerId })
					.where(eq(table.id, row.id))
		}
	}

	// Imprints: the rule-fed overlay's field paths name entries and members by id.
	const rekeyPath = (field: string | null): string | null => {
		if (field == null) return null
		const [kind, id, ...rest] = field.split(".")
		const map =
			kind === "castStates"
				? maps.bindings
				: kind === "entryFields" || kind === "placeValues"
					? maps.entries
					: null
		const n = Number(id)
		if (!map || !Number.isInteger(n) || !map.has(n)) return field
		return [kind, String(map.get(n)), ...rest].join(".")
	}
	const li = schema.loreImprints
	for (const row of await t
		.select()
		.from(li)
		.where(eq(li.sessionId, c.sessionId))) {
		let next: {
			subjectId?: number
			lorebookId?: number
			field?: string | null
		} | null = null
		if (row.subjectKind === "entry" || row.subjectKind === "member") {
			const to = (
				row.subjectKind === "entry" ? maps.entries : maps.bindings
			).get(row.subjectId)
			if (to != null) next = { subjectId: to, lorebookId: c.ownId }
		} else if (row.subjectKind === "annex") {
			if (row.subjectId === c.parentId)
				next = { subjectId: c.ownId, lorebookId: c.ownId }
		} else if (row.subjectKind === "overlay") {
			const field = rekeyPath(row.field)
			if (field !== row.field) next = { field }
		}
		if (next) await t.update(li).set(next).where(eq(li.id, row.id))
	}

	const ls = schema.loreSources
	for (const row of await t
		.select()
		.from(ls)
		.where(eq(ls.sessionId, c.sessionId))) {
		if (row.subjectKind === "entry") {
			const to = maps.entries.get(row.subjectId)
			if (to != null)
				await t
					.update(ls)
					.set({ subjectId: to, lorebookId: c.ownId })
					.where(eq(ls.id, row.id))
		} else if (
			row.subjectKind === "scene" &&
			row.lorebookId === c.parentId &&
			c.captured.has(row.subjectId)
		) {
			await t
				.update(ls)
				.set({ lorebookId: c.ownId })
				.where(eq(ls.id, row.id))
		}
	}

	// State proposals name their owner in the payload.
	const p = schema.stateProposals
	for (const row of await t
		.select({ id: p.id, payload: p.payload })
		.from(p)
		.where(eq(p.sessionId, c.sessionId))) {
		const o = (row.payload as Record<string, unknown>).owner
		if (
			!isRecord(o) ||
			typeof o.kind !== "string" ||
			typeof o.id !== "number"
		)
			continue
		const id = owner(o.kind, o.id)
		if (id !== o.id)
			await t
				.update(p)
				.set({ payload: { ...row.payload, owner: { ...o, id } } })
				.where(eq(p.id, row.id))
	}

	// Ranking evidence: the entries this session's runs judged.
	const LORE_ENTRY_SUBJECT = "lore-entry"
	const st = schema.rankingSubjectStats
	for (const row of await t
		.select({ id: st.id, subjectId: st.subjectId })
		.from(st)
		.where(
			and(
				eq(st.sessionId, c.sessionId),
				eq(st.subjectKind, LORE_ENTRY_SUBJECT)
			)
		)) {
		const to = maps.entries.get(Number(row.subjectId))
		if (to != null)
			await t
				.update(st)
				.set({ subjectId: String(to) })
				.where(eq(st.id, row.id))
	}
	const d = schema.rankingDecisions
	const mine = t
		.select({ id: schema.rankings.id })
		.from(schema.rankings)
		.where(eq(schema.rankings.sessionId, c.sessionId))
	for (const row of await t
		.select({ id: d.id, subjectId: d.subjectId })
		.from(d)
		.where(
			and(
				eq(d.subjectKind, LORE_ENTRY_SUBJECT),
				inArray(d.rankingId, mine)
			)
		)) {
		const to = maps.entries.get(Number(row.subjectId))
		if (to != null)
			await t
				.update(d)
				.set({ subjectId: String(to) })
				.where(eq(d.id, row.id))
	}
}

// ── Step 10: members re-pointed ─────────────────────────────────────────────

/**
 * Seats, speaker stamps and state refs go from each member of P, and each folded member of O, to its copy. The stamps
 * are set directly through `moves` rather than re-stamped from the seats: a line spoken by a seat that has since
 * departed keeps its speaker, which a re-stamp from the live seats would lose.
 */
async function repointMembers(c: FoldContext): Promise<SeatChange[]> {
	const { t } = c
	const moves = new Map(c.maps.bindings)
	const { reseatOnto } = await import("$lib/server/sessions/seats")
	const { changes } = await reseatOnto(t, c.sessionId, moves)
	const { repointSpeakerStamps } = await import("$lib/server/messages/store")
	await repointSpeakerStamps(t, c.sessionId, moves)
	const { rekeySessionRefs, memberMoveTranslator } = await import(
		"$lib/server/sessions/seatKeys"
	)
	await rekeySessionRefs(t, c.sessionId, memberMoveTranslator(moves))
	return changes
}

// ── Step 10b: the folded members of O ───────────────────────────────────────

/**
 * Each folded member of O joins `maps.bindings` as a source of the copy of the member it sits beside, so every step
 * that moves a reference to a member of P moves a reference to it too. What no other step moves is moved here: the
 * sheets (the folded member's row wins a clash on the same sheet and session; the copy's and the book's row go), the
 * casts of scenes, and the cast presences. The ids of its attribute rows and zones are noted for `refileMemberRows`.
 * Not moved: sprite sets, files, cast amendments and character versions of a notes member (the seat read the book's
 * member, never these), the dismissed duplicate pairs (a pair with the member is gone with it), merge logs
 * (`survivor_id` is set null) and carries (their owner kinds name no member row).
 */
async function foldMembers(c: FoldContext): Promise<void> {
	const { t, maps } = c
	for (const f of c.folded) {
		const to = maps.bindings.get(f.from)
		if (to == null)
			throw new Error(
				`foldInParent: member ${f.id} sits beside ${f.from}, which the copy holds no member for`
			)
		maps.bindings.set(f.id, to)
	}
	const ids = c.folded.map((f) => f.id)
	if (!ids.length) return

	const V = schema.attributeValues
	const C = schema.attributeConfigs
	const Z = schema.zoneContents
	const mine = (
		table: typeof V | typeof C | typeof Z | typeof schema.ownerSheets
	) => and(eq(table.ownerKind, "cast_member"), inArray(table.ownerId, ids))
	const idsOf = async (table: typeof V | typeof C | typeof Z) =>
		(
			await t
				.select({ id: table.id })
				.from(table)
				.where(mine(table))
				.orderBy(asc(table.id))
		).map((r) => r.id)
	c.memberRows = {
		values: await idsOf(V),
		configs: await idsOf(C),
		zones: await idsOf(Z)
	}

	const S = schema.ownerSheets
	const sheets = await t.select().from(S).where(mine(S)).orderBy(asc(S.id))
	for (const row of sheets) {
		const f = c.folded.find((x) => x.id === row.ownerId)!
		const to = maps.bindings.get(f.from)!
		const clashing = (owner: number) =>
			and(
				eq(S.ownerKind, "cast_member"),
				eq(S.ownerId, owner),
				eq(S.sheetId, row.sheetId),
				row.sessionId == null
					? isNull(S.sessionId)
					: eq(S.sessionId, row.sessionId)
			)
		await t.delete(S).where(clashing(to))
		// The session's own layer on the book's member is the session's to drop, never the book's template row.
		if (row.sessionId === c.sessionId)
			await t.delete(S).where(clashing(f.from))
		await t.update(S).set({ ownerId: to }).where(eq(S.id, row.id))
	}

	const SC = schema.sceneCharacters
	for (const row of await t
		.select()
		.from(SC)
		.where(inArray(SC.bindingId, ids))
		.orderBy(asc(SC.id))) {
		const to = maps.bindings.get(row.bindingId)!
		const [held] = await t
			.select({ id: SC.id })
			.from(SC)
			.where(
				and(
					eq(SC.sceneId, row.sceneId),
					eq(SC.bindingId, to),
					eq(SC.role, row.role)
				)
			)
			.limit(1)
		if (held) await t.delete(SC).where(eq(SC.id, row.id))
		else await t.update(SC).set({ bindingId: to }).where(eq(SC.id, row.id))
	}

	const P = schema.castPresences
	for (const row of await t
		.select({ id: P.id, memberId: P.lorebookBindingId })
		.from(P)
		.where(inArray(P.lorebookBindingId, ids)))
		await t
			.update(P)
			.set({ lorebookBindingId: maps.bindings.get(row.memberId)! })
			.where(eq(P.id, row.id))
}

/**
 * The folded members' values, configs and zones are written again after the copy, in their order, owned by the
 * copy of the member they sit beside, and the old rows deleted: as the chain read the notes' member before the
 * book's, the notes' changes keep the higher ids and stay on top (as `refileOwnWorldRows` does for the world).
 */
async function refileMemberRows(c: FoldContext): Promise<void> {
	const { t, maps } = c
	for (const [table, ids] of [
		[schema.attributeValues, c.memberRows.values],
		[schema.attributeConfigs, c.memberRows.configs],
		[schema.zoneContents, c.memberRows.zones]
	] as const) {
		if (!ids.length) continue
		const rows = await t
			.select()
			.from(table)
			.where(inArray(table.id, [...ids]))
			.orderBy(asc(table.id))
		for (const { id: _id, ...row } of rows)
			await t.insert(table).values({
				...row,
				ownerId: maps.bindings.get(row.ownerId) ?? row.ownerId
			} as never)
		await t.delete(table).where(inArray(table.id, [...ids]))
	}
}

/**
 * Each overlay's versions the session read (on main, not retired) are carried onto the copy of the member it
 * overlays, through the versions module's one INSERT: filed on the session's own line (null = main), so S, reading
 * the notes alone, still picks the overlay's row where it picked it before (a row on the session's line is its
 * nearest holder, as the overlay was), with a fresh write order above the copy's rows. A row on another line was
 * never read and is not carried. Then each overlay goes through the owning writers when no session branched from
 * this one (`branch_ancestry` holds it); when one did, the overlay and its versions stay where it reads them.
 */
async function carryOverlays(c: FoldContext): Promise<void> {
	const overlays = c.folded.filter((f) => f.kind === "overlay")
	if (!overlays.length) return
	const { t, maps } = c
	const { insertCharacterVersions, retireOrTakeVersions } = await import(
		"$lib/server/characters/versions"
	)
	const V = schema.characterVersions
	const rows = await t
		.select()
		.from(V)
		.where(
			and(
				inArray(
					V.castMemberId,
					overlays.map((o) => o.id)
				),
				isNull(V.retiredOrder),
				isNull(V.branchId)
			)
		)
		.orderBy(asc(V.id))
	await insertCharacterVersions(
		t,
		rows.map(({ id: _id, writeOrder: _w, ...row }) => ({
			...row,
			castMemberId: maps.bindings.get(row.castMemberId!)!,
			lorebookId: c.ownId,
			branchId: c.lineId,
			historyEntryId: through(maps.entries, row.historyEntryId)
		}))
	)
	const [ridden] = await t
		.select({ id: schema.sessions.id })
		.from(schema.sessions)
		.where(
			sql`${schema.sessions.branchAncestry} @> ${JSON.stringify([{ sessionId: c.sessionId }])}::jsonb`
		)
		.limit(1)
	if (ridden) return
	const own = await t
		.select()
		.from(V)
		.where(
			inArray(
				V.castMemberId,
				overlays.map((o) => o.id)
			)
		)
	await retireOrTakeVersions(t, own)
	await t.delete(schema.lorebookBindings).where(
		inArray(
			schema.lorebookBindings.id,
			overlays.map((o) => o.id)
		)
	)
}

/**
 * The member overlays of S's ancestors (their own books, `overlayChainOf` less the notes) on a member of P: S read them
 * through the overlay chain, and the chain does not reach them once S's members are the copies. The rows S reads
 * (the book's main, the retire mark and S's session cuts as `rowPassesSessionCut` applies them) are carried onto the
 * copy of the member, on S's own line, as S's own: source session S, no source message, no anchor, so S's own cuts
 * never cut them. The deepest ancestor's rows go first and the nearer ones after, so the nearer holder keeps the higher
 * write order, which breaks the tie the chain broke by distance; S's own overlays are carried after (`carryOverlays`).
 * The ancestors' rows are only read, never written: they are the ancestors' own and other branches read them.
 */
async function carryAncestorOverlays(c: FoldContext): Promise<void> {
	const { t, maps } = c
	const { overlayChainOf, sessionCutsOf } = await import(
		"$lib/server/state/reading"
	)
	const chain = (await overlayChainOf(t, c.sessionId)).filter(
		(id) => id !== c.ownId
	)
	if (!chain.length) return
	const { rowPassesSessionCut, MAIN_LINE } = await import(
		"$lib/shared/lorebooks/lineReading"
	)
	const { insertCharacterVersions } = await import(
		"$lib/server/characters/versions"
	)
	const line = {
		...MAIN_LINE,
		sessionCuts: await sessionCutsOf(t, c.sessionId)
	}
	const V = schema.characterVersions
	const b = schema.lorebookBindings
	const held = await t
		.select({ version: V, overlayOf: b.overlayOf })
		.from(V)
		.innerJoin(b, eq(b.id, V.castMemberId))
		.where(
			and(
				inArray(V.lorebookId, chain),
				isNull(V.branchId),
				inArray(b.overlayOf, [...maps.bindings.keys()])
			)
		)
	const rank = (id: number | null) => chain.indexOf(id ?? -1)
	const rows = held
		.filter(
			({ version, overlayOf }) =>
				overlayOf != null &&
				maps.bindings.has(overlayOf) &&
				rowPassesSessionCut(version, line)
		)
		.sort(
			(x, y) =>
				rank(y.version.lorebookId) - rank(x.version.lorebookId) ||
				x.version.writeOrder - y.version.writeOrder ||
				x.version.id - y.version.id
		)
	await insertCharacterVersions(
		t,
		rows.map(
			({
				version: {
					id: _id,
					writeOrder: _w,
					retiredOrder: _r,
					sourceMessageId: _m,
					validFromMessageId: _v,
					...row
				},
				overlayOf
			}) => ({
				...row,
				castMemberId: maps.bindings.get(overlayOf!)!,
				lorebookId: c.ownId,
				branchId: c.lineId,
				sourceSessionId: c.sessionId,
				sourceMessageId: null,
				validFromMessageId: null,
				historyEntryId: through(maps.entries, row.historyEntryId)
			})
		)
	)
}

/** The member number of each folded notes member, read before anything moves. */
async function notesMemberNumbers(
	t: Db,
	folded: readonly FoldedMember[]
): Promise<Map<number, number>> {
	const { castTagNumber } = await import("$lib/server/utils/castTags")
	const ids = folded.filter((f) => f.kind === "notes").map((f) => f.id)
	const out = new Map<number, number>()
	if (!ids.length) return out
	const B = schema.lorebookBindings
	for (const r of await t
		.select({ id: B.id, binding: B.binding })
		.from(B)
		.where(inArray(B.id, ids))) {
		const n = castTagNumber(r.binding)
		if (n != null) out.set(r.id, n)
	}
	return out
}

/**
 * A notes member's `{{char:N}}` tags in O's lore text name the copy of the member it sat beside once it is gone. The
 * book-wide tag writer runs under the lock `lockAndRead` took on O; the copied text of P never names N's number, as
 * the copy minted fresh numbers above O's.
 */
async function retagNotesMembers(c: FoldContext): Promise<void> {
	const { castTag, castTagNumber, rewriteBookCastTags } = await import(
		"$lib/server/utils/castTags"
	)
	const B = schema.lorebookBindings
	for (const f of c.folded.filter((x) => x.kind === "notes")) {
		const [copy] = await c.t
			.select({ binding: B.binding })
			.from(B)
			.where(eq(B.id, c.maps.bindings.get(f.from)!))
		const from = c.notesNumbers.get(f.id)
		const to = castTagNumber(copy?.binding)
		if (from == null || to == null) continue
		await rewriteBookCastTags(c.t, c.ownId, from, castTag(to))
	}
}

/** A notes member is deleted once everything it held has moved; its versions go with it (the versions module has no member delete). */
async function dropNotesMembers(c: FoldContext): Promise<void> {
	const ids = c.folded.filter((f) => f.kind === "notes").map((f) => f.id)
	if (!ids.length) return
	await c.t
		.delete(schema.lorebookBindings)
		.where(inArray(schema.lorebookBindings.id, ids))
}

// ── Step 11: O's own world rows stay on top ─────────────────────────────────

/**
 * ★bk-fold-4: `inForce` ties on the higher id, so O's own undated world values and configs are written again after
 * the copy, in their order, and the old rows deleted: the notes' changes keep the higher ids.
 */
async function refileOwnWorldRows(c: FoldContext): Promise<void> {
	const { t } = c
	for (const [table, ids] of [
		[schema.attributeValues, c.preCopy.worldValues],
		[schema.attributeConfigs, c.preCopy.worldConfigs]
	] as const) {
		if (!ids.length) continue
		const rows = await t
			.select()
			.from(table)
			.where(inArray(table.id, [...ids]))
			.orderBy(asc(table.id))
		for (const { id: _id, ...row } of rows)
			await t.insert(table).values(row as never)
		await t.delete(table).where(inArray(table.id, [...ids]))
	}
}

// ── Step 12: the session reads only its notes ───────────────────────────────

async function readOnlyNotes(c: FoldContext): Promise<void> {
	await c.t
		.update(schema.sessions)
		.set({ lorebookId: null, updatedAt: new Date() })
		.where(eq(schema.sessions.id, c.sessionId))
	await c.t
		.update(schema.lorebooks)
		.set({ overlayOf: null })
		.where(eq(schema.lorebooks.id, c.ownId))
}

/**
 * 🚧 Merge the session's attached book into its own notes and make the notes the only book it reads (see the file
 * header). Returns the notes' id and the book it was merged from. Refusals are `OwnBookRefusal`s with the sentences
 * in `FOLD_REFUSALS`.
 */
export async function foldInParent(
	db: Db,
	input: { sessionId: number; userId: number }
): Promise<{
	lorebookId: number
	foldedFrom: { id: number; name: string }
	/** 🚧 The seats whose member ref moved in the fold (a character seat's `seated-member:<id>` changes), for the caller to announce after the fold commits. */
	seatChanges: SeatChange[]
}> {
	const mod = await import("$lib/server/lorebooks/ownBook")
	const [session] = await db
		.select({
			userId: schema.sessions.userId,
			lorebookId: schema.sessions.lorebookId
		})
		.from(schema.sessions)
		.where(eq(schema.sessions.id, input.sessionId))
		.limit(1)
	if (!session) throw new mod.OwnBookRefusal(FOLD_REFUSALS.missing)
	if (session.userId !== input.userId)
		throw new mod.OwnBookRefusal(FOLD_REFUSALS.notOwner)
	if (session.lorebookId == null)
		throw new mod.OwnBookRefusal(FOLD_REFUSALS.alreadyOwn)
	const { assertReadableBook } = await import("$lib/server/utils/ownedBook")
	await assertReadableBook(db, input.userId, session.lorebookId, {
		isAdmin: false
	})

	return db.transaction(async (tx) => {
		const t = tx as unknown as Db
		const sessionId = input.sessionId
		const { parent, ownId, lorebookBranchId } = await lockAndRead(
			t,
			sessionId,
			mod
		)

		const { folded, released } = await findFoldedMembers(
			t,
			parent.id,
			ownId
		)
		const notesNumbers = await notesMemberNumbers(t, folded)
		const memberIds = await memberIdsOf(
			t,
			[parent.id, ownId],
			ownId,
			new Set(folded.map((f) => f.id))
		)
		const before = await readSession(t, sessionId, memberIds)

		const { discardForwardStack } = await import(
			"$lib/server/messages/store"
		)
		await discardForwardStack(t, sessionId)

		const preCopy = await snapshotOwn(t, ownId)
		const notesSlots = await slotsHeldByNotes(t, ownId, folded)
		await releaseCards(t, released)
		const { copyLorebookTables } = await import(
			"$lib/server/lorebooks/tableRegistry"
		)
		const maps = await copyLorebookTables(t, parent.id, ownId, {
			keepTurnTies: true
		})
		const parentMembers = new Set(maps.bindings.keys())
		const c: FoldContext = {
			t,
			sessionId,
			parentId: parent.id,
			ownId,
			maps,
			preCopy,
			captured: new Set(),
			folded,
			notesNumbers,
			memberRows: { values: [], configs: [], zones: [] },
			lineId:
				lorebookBranchId == null
					? null
					: (maps.branches.get(lorebookBranchId) ?? null)
		}

		await carryBookFacts(c)
		await moveSessionLine(c, lorebookBranchId)
		await moveCaptures(c)
		await foldMembers(c)
		await rewriteOwnRows(c)
		await moveSessionRows(c)
		const seatChanges = await repointMembers(c)
		await refileOwnWorldRows(c)
		await refileMemberRows(c)
		await carryAncestorOverlays(c)
		await carryOverlays(c)
		await retagNotesMembers(c)
		await dropNotesMembers(c)
		await readOnlyNotes(c)

		const after = await readSession(
			t,
			sessionId,
			memberIds.map((id) => maps.bindings.get(id) ?? id)
		)
		const { castTag, castTagNumber, rewriteCastTagsDeep } = await import(
			"$lib/server/utils/castTags"
		)
		const retag = <T>(v: T): T =>
			maps.tags.size === 0
				? v
				: rewriteCastTagsDeep(v, (n) => {
						const to = maps.tags.get(n)
						return to == null ? null : castTag(to)
					})
		const ownTags = new Map<number, number>()
		for (const f of folded.filter((x) => x.kind === "notes")) {
			const [row] = await t
				.select({ binding: schema.lorebookBindings.binding })
				.from(schema.lorebookBindings)
				.where(
					eq(schema.lorebookBindings.id, maps.bindings.get(f.from)!)
				)
			const own = notesNumbers.get(f.id)
			const copy = castTagNumber(row?.binding)
			if (own != null && copy != null) ownTags.set(own, copy)
		}
		const retagOwn = <T>(v: T): T =>
			ownTags.size === 0
				? v
				: rewriteCastTagsDeep(v, (n) => {
						const to = ownTags.get(n)
						return to == null ? null : castTag(to)
					})
		const difference = compareReads(
			before,
			after,
			maps,
			parentMembers,
			retag,
			retagOwn,
			notesSlots
		)
		if (difference)
			throw new mod.OwnBookRefusal(
				FOLD_REFUSALS.readsDifferently(parent.name),
				{
					cause: difference
				}
			)
		return {
			lorebookId: ownId,
			foldedFrom: { id: parent.id, name: parent.name },
			seatChanges
		}
	})
}
