/**
 * 🚧 The Characters view's read (plan §34.4): one page of rows, a row being a
 * **character** — a card and every cast member linked to it, or one cast
 * member with no card the asker may see as one (owner 2026-11-05: "the cast
 * badge is probably redundant, any card that's been used will be a cast").
 * Reads only. The types are `$lib/shared/characters/characterRows`.
 *
 * ## Who may see what
 *
 * The asker's **reach set R** is the books they may read (their own and shared
 * ones with `kind = 'book'`, the live provided books) plus the notes of the
 * sessions they own or play in. Nothing outside R is counted, named or listed —
 * an administrator sees no one else's books here. The **listing set** is the
 * readable books, plus the story notes when `inMyStories` is on.
 *
 * ## Paging
 *
 * One keyset over `(favourite rank, lower(stored name) COLLATE "C", kind rank,
 * id)` — the asker's own favourite cards (rank 0) first, everything else
 * (rank 1) after, each group by name — the cards (kind rank 0) and the cast
 * members (kind rank 1) in one `UNION ALL`. The cursor is the
 * last candidate a page *scanned*, so a `follows` post-filter can drop rows and
 * the next page still starts after them.
 *
 * ⚠ Must not statically import `$lib/server/db`; every function takes its
 * handle first.
 */
import { and, eq, inArray, or, sql, type SQL } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { rawRows } from "$lib/server/db/rawRows"
import { cardsNow } from "./seatedCast"
import { membersAsRead, type MemberAsRead } from "./memberAsRead"
import {
	genuineProvidedMarkSql,
	providedBooksReadableBy,
	shownLorebook
} from "$lib/server/plugins/providedMarks"
import {
	sharedCharacterIdsFor,
	sharedLorebookIdsFor
} from "$lib/server/utils/shares"
import { characterSummary } from "$lib/shared/characters/characterSummary"
import { RETOLD_FIELDS } from "$lib/shared/lorebooks/retold"
import {
	CHARACTER_ROWS_DEFAULT_LIMIT,
	CHARACTER_ROWS_MAX_LIMIT,
	CHARACTER_ROWS_STALE_CURSOR,
	type CharacterRow,
	type CharacterRowsFilters
} from "$lib/shared/characters/characterRows"

/** 🚧 A `characters:page` ask that can't be answered as sent (an out-of-date cursor). */
export class CharacterRowsRefusal extends Error {}

/** How many batches a `follows` post-filter may read to fill one page. */
const MAX_BATCHES = 5

/** The last candidate a page scanned: its favourite rank (0 the asker's favourite card, 1 any other), lowercased stored name, kind rank (0 card, 1 cast member), id. */
interface Key {
	f: 0 | 1
	n: string
	k: 0 | 1
	i: number
}

function encodeCursor(key: Key): string {
	return Buffer.from(
		JSON.stringify({ f: key.f, n: key.n, k: key.k, i: key.i })
	).toString("base64url")
}

function decodeCursor(cursor: string): Key {
	const refusal = () => new CharacterRowsRefusal(CHARACTER_ROWS_STALE_CURSOR)
	let parsed: unknown
	try {
		parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"))
	} catch {
		throw refusal()
	}
	const o = parsed as Record<string, unknown> | null
	if (
		!o ||
		typeof o !== "object" ||
		Array.isArray(o) ||
		Object.keys(o).sort().join() !== "f,i,k,n" ||
		(o.f !== 0 && o.f !== 1) ||
		typeof o.n !== "string" ||
		(o.k !== 0 && o.k !== 1) ||
		typeof o.i !== "number" ||
		!Number.isInteger(o.i)
	)
		throw refusal()
	return { f: o.f, n: o.n, k: o.k, i: o.i }
}

/** `col IN (ids)`; false for no ids. */
function inList(col: SQL | unknown, ids: readonly number[]): SQL {
	if (!ids.length) return sql`false`
	return sql`${col} IN (${sql.join(
		ids.map((id) => sql`${id}`),
		sql`, `
	)})`
}

/**
 * A: books the asker may READ — their own and the ones shared with them
 * (`kind = 'book'`, never a session's notes) and the live provided ones — as
 * a predicate on a lorebook id column. A switched-off provided book is hidden.
 */
function readableBookSql(
	col: SQL | unknown,
	askerId: number,
	sharedIds: readonly number[],
	providedIds: readonly number[]
): SQL {
	const L = schema.lorebooks
	return sql`${col} IN (
		SELECT ${L.id} FROM ${L}
		WHERE ${L.kind} = 'book' AND ${L.sessionId} IS NULL AND ${shownLorebook()}
		AND (${L.userId} = ${askerId} OR ${inList(L.id, sharedIds)} OR ${inList(L.id, providedIds)})
	)`
}

/**
 * S: the own books (notes) of the sessions the asker owns or is a guest of —
 * the membership `ownBookAccessFor` checks — as one set predicate.
 */
function storyBookSql(col: SQL | unknown, askerId: number): SQL {
	const L = schema.lorebooks
	return sql`${col} IN (
		SELECT ${L.id} FROM ${L}
		WHERE ${L.sessionId} IS NOT NULL AND ${shownLorebook()}
		AND ${L.sessionId} IN (
			SELECT ${schema.sessions.id} FROM ${schema.sessions} WHERE ${schema.sessions.userId} = ${askerId}
			UNION
			SELECT ${schema.sessionGuests.sessionId} FROM ${schema.sessionGuests} WHERE ${schema.sessionGuests.userId} = ${askerId}
		)
	)`
}

/** A name search as a LIKE pattern: `%`, `_` and `\` literal. */
function likePattern(q: string): string {
	return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
}

/** What a page's candidate query is narrowed by, worked out once per ask. */
interface Plan {
	askerId: number
	/** Predicate on a lorebook id column: the books whose cast members are listed. */
	listedBooks: (col: SQL | unknown) => SQL
	/** Own cards are listed without a cast member (no book filter). */
	ownCardsListed: boolean
	cards: boolean
	members: boolean
	favorites: boolean
	personas: boolean
	tags: string[]
	q: string
	/** The reach set R as a predicate on a lorebook id column. */
	reach: (col: SQL | unknown) => SQL
	/** A: the books the asker may read, as a predicate on a lorebook id column. */
	readable: (col: SQL | unknown) => SQL
	/** S: the notes of the asker's sessions, as a predicate on a lorebook id column. */
	story: (col: SQL | unknown) => SQL
	/** Cards other people shared with the asker (a share row each). */
	sharedCardIds: readonly number[]
}

function candidateSql(plan: Plan, after: Key | null, limit: number): SQL {
	const C = schema.characters
	const B = schema.lorebookBindings
	const pattern = plan.q ? likePattern(plan.q) : null
	const branches: SQL[] = []

	if (plan.cards) {
		const where: SQL[] = [
			sql`${C.isDeleted} = false`,
			sql`NOT ${genuineProvidedMarkSql()}`
		]
		const hasMember = sql`EXISTS (SELECT 1 FROM ${B} WHERE ${B.characterId} = ${C.id} AND ${plan.listedBooks(B.lorebookId)})`
		// A card shared with the asker is listed like an own card: whenever no
		// lorebook / session filter narrows to a member. (`favorites` /
		// `personas` below keep to the asker's own cards.)
		const sharedWithMe = sql`(${C.userId} <> ${plan.askerId} AND ${inList(C.id, plan.sharedCardIds)})`
		where.push(
			plan.ownCardsListed
				? sql`(${C.userId} = ${plan.askerId} OR ${sharedWithMe} OR ${hasMember})`
				: hasMember
		)
		if (plan.favorites)
			where.push(
				sql`${C.userId} = ${plan.askerId} AND ${C.isFavorite} = true`
			)
		if (plan.personas)
			where.push(
				sql`${C.userId} = ${plan.askerId} AND ${C.isPersona} = true`
			)
		for (const tag of plan.tags)
			where.push(
				sql`EXISTS (SELECT 1 FROM ${schema.characterTags} INNER JOIN ${schema.tags} ON ${schema.tags.id} = ${schema.characterTags.tagId} WHERE ${schema.characterTags.characterId} = ${C.id} AND lower(${schema.tags.name}) = lower(${tag}))`
			)
		if (pattern)
			where.push(
				sql`(lower(${C.name}) LIKE lower(${pattern}) OR EXISTS (SELECT 1 FROM ${schema.characterTags} INNER JOIN ${schema.tags} ON ${schema.tags.id} = ${schema.characterTags.tagId} WHERE ${schema.characterTags.characterId} = ${C.id} AND lower(${schema.tags.name}) LIKE lower(${pattern})))`
			)
		branches.push(
			sql`SELECT CASE WHEN ${C.userId} = ${plan.askerId} AND ${C.isFavorite} = true THEN 0 ELSE 1 END AS fav_rank, lower(${C.name}) AS sort_name, 0 AS kind_rank, ${C.id} AS id FROM ${C} WHERE ${sql.join(where, sql` AND `)}`
		)
	}

	if (plan.members) {
		const where: SQL[] = [
			sql`${B.overlayOf} IS NULL`,
			plan.listedBooks(B.lorebookId),
			sql`(${B.characterId} IS NULL OR ${C.isDeleted} = true OR ${genuineProvidedMarkSql()})`
		]
		if (pattern) where.push(sql`lower(${B.name}) LIKE lower(${pattern})`)
		branches.push(
			sql`SELECT 1 AS fav_rank, lower(${B.name}) AS sort_name, 1 AS kind_rank, ${B.id} AS id FROM ${B} LEFT JOIN ${C} ON ${C.id} = ${B.characterId} WHERE ${sql.join(where, sql` AND `)}`
		)
	}

	const afterSql = after
		? sql`WHERE (u.fav_rank, u.sort_name COLLATE "C", u.kind_rank, u.id) > (${after.f}::int, ${after.n}::text COLLATE "C", ${after.k}::int, ${after.i}::int)`
		: sql``
	return sql`SELECT u.fav_rank AS f, u.sort_name AS n, u.kind_rank AS k, u.id AS i FROM (${sql.join(branches, sql` UNION ALL `)}) u ${afterSql} ORDER BY u.fav_rank, u.sort_name COLLATE "C", u.kind_rank, u.id LIMIT ${limit + 1}`
}

/** Which of `ids` the asker may read as a book (a) or as a story's notes (s). */
async function bookReachOf(
	db: Db,
	readable: (col: SQL | unknown) => SQL,
	story: (col: SQL | unknown) => SQL,
	ids: readonly number[]
): Promise<{ a: Set<number>; s: Set<number> }> {
	const L = schema.lorebooks
	const out = { a: new Set<number>(), s: new Set<number>() }
	if (!ids.length) return out
	const rows = await db
		.select({
			id: L.id,
			a: sql<boolean>`${readable(L.id)}`,
			s: sql<boolean>`${story(L.id)}`
		})
		.from(L)
		.where(inArray(L.id, [...ids]))
	for (const r of rows) {
		if (r.a) out.a.add(r.id)
		if (r.s) out.s.add(r.id)
	}
	return out
}

const EMPTY_PAGE = { rows: [], nextCursor: null }

/** 🚧 One page of the Characters view's rows for `askerId` (plan §34.4). Reads only. */
export async function characterRowsPage(
	db: Db,
	askerId: number,
	ask: {
		cursor?: string | null
		limit?: number
		filters?: CharacterRowsFilters
	}
): Promise<{ rows: CharacterRow[]; nextCursor: string | null }> {
	const filters = ask.filters ?? {}
	const after = ask.cursor != null ? decodeCursor(ask.cursor) : null
	const limit =
		typeof ask.limit === "number" && Number.isInteger(ask.limit)
			? Math.min(Math.max(ask.limit, 1), CHARACTER_ROWS_MAX_LIMIT)
			: CHARACTER_ROWS_DEFAULT_LIMIT

	const idFilter = (v: unknown): number | null | "none" =>
		v == null ? null : Number.isInteger(v) ? (v as number) : "none"
	const lorebookId = idFilter(filters.lorebookId)
	const sessionId = idFilter(filters.sessionId)
	if (lorebookId === "none" || sessionId === "none") return EMPTY_PAGE

	const tags = (filters.tags ?? [])
		.map((t) => (typeof t === "string" ? t.trim() : ""))
		.filter(Boolean)
	const cardOnly =
		filters.favorites === true ||
		filters.personas === true ||
		tags.length > 0
	if (filters.hasCard === false && cardOnly) return EMPTY_PAGE

	const [sharedIds, providedSet, sharedCardIds] = await Promise.all([
		sharedLorebookIdsFor(db, askerId),
		providedBooksReadableBy(db, askerId),
		sharedCharacterIdsFor(db, askerId)
	])
	const providedIds = [...providedSet]
	const readable = (col: SQL | unknown) =>
		readableBookSql(col, askerId, sharedIds, providedIds)
	const story = (col: SQL | unknown) => storyBookSql(col, askerId)
	const reach = (col: SQL | unknown) =>
		sql`(${readable(col)} OR ${story(col)})`

	// The books a lorebook / session filter names: an explicit id list.
	let explicit: number[] | null = null
	if (lorebookId != null) {
		const r = await bookReachOf(db, readable, story, [lorebookId])
		explicit =
			r.a.has(lorebookId) || r.s.has(lorebookId) ? [lorebookId] : []
	}
	if (sessionId != null) {
		const [member] = await db
			.select({
				id: schema.sessions.id,
				lorebookId: schema.sessions.lorebookId
			})
			.from(schema.sessions)
			.where(
				and(
					eq(schema.sessions.id, sessionId),
					or(
						eq(schema.sessions.userId, askerId),
						sql`EXISTS (SELECT 1 FROM ${schema.sessionGuests} WHERE ${schema.sessionGuests.sessionId} = ${schema.sessions.id} AND ${schema.sessionGuests.userId} = ${askerId})`
					)
				)
			)
		if (!member) return EMPTY_PAGE
		const [own] = await db
			.select({ id: schema.lorebooks.id })
			.from(schema.lorebooks)
			.where(eq(schema.lorebooks.sessionId, sessionId))
		const named = [own?.id, member.lorebookId].filter(
			(v): v is number => typeof v === "number"
		)
		const r = await bookReachOf(db, readable, story, named)
		const kept = [...new Set(named)].filter(
			(id) => r.a.has(id) || r.s.has(id)
		)
		explicit = explicit ? explicit.filter((id) => kept.includes(id)) : kept
	}
	if (explicit && !explicit.length) return EMPTY_PAGE
	const explicitBooks = explicit
	const listedBooks = explicitBooks
		? (col: SQL | unknown) => inList(col, explicitBooks)
		: (col: SQL | unknown) =>
				filters.inMyStories === true
					? sql`(${readable(col)} OR ${story(col)})`
					: readable(col)

	const plan: Plan = {
		askerId,
		listedBooks,
		ownCardsListed: !explicitBooks,
		cards: filters.hasCard !== false,
		members: filters.hasCard !== true && !cardOnly,
		favorites: filters.favorites === true,
		personas: filters.personas === true,
		tags,
		q: typeof filters.q === "string" ? filters.q.trim() : "",
		reach,
		readable,
		story,
		sharedCardIds
	}

	const held: CharacterRow[] = []
	let last: Key | null = after
	let nextCursor: string | null = null
	const batches = filters.follows ? MAX_BATCHES : 1
	for (let batch = 0; batch < batches; batch++) {
		const found = rawRows<{ f: number; n: string; k: number; i: number }>(
			await db.execute(candidateSql(plan, last, limit))
		).map(
			(r): Key => ({
				f: r.f === 0 ? 0 : 1,
				n: r.n,
				k: r.k === 1 ? 1 : 0,
				i: Number(r.i)
			})
		)
		const moreSource = found.length > limit
		const scan = found.slice(0, limit)
		const built = await buildRows(db, askerId, scan, plan)
		let full = false
		for (let x = 0; x < scan.length; x++) {
			last = scan[x]!
			const row = built.get(scan[x]!)
			if (
				row &&
				(!filters.follows ||
					row.hasOwnWords === (filters.follows === "own"))
			)
				held.push(row)
			if (held.length >= limit) {
				full = true
				nextCursor =
					x < scan.length - 1 || moreSource
						? encodeCursor(last)
						: null
				break
			}
		}
		if (full) return { rows: held, nextCursor }
		if (!moreSource) return { rows: held, nextCursor: null }
	}
	return { rows: held, nextCursor: last ? encodeCursor(last) : null }
}

/** The rows for one scan of candidates, details read in batches (no per-row query). */
async function buildRows(
	db: Db,
	askerId: number,
	scan: readonly Key[],
	plan: Pick<Plan, "reach" | "readable" | "story">
): Promise<Map<Key, CharacterRow>> {
	const out = new Map<Key, CharacterRow>()
	if (!scan.length) return out
	const B = schema.lorebookBindings
	const cardIds = scan.filter((s) => s.k === 0).map((s) => s.i)
	const memberRowIds = scan.filter((s) => s.k === 1).map((s) => s.i)

	const [cards, storedMembers, cardMembers] = await Promise.all([
		cardsNow(db, cardIds),
		memberRowIds.length
			? db
					.select({
						id: B.id,
						lorebookId: B.lorebookId,
						characterId: B.characterId,
						name: B.name,
						summary: B.summary
					})
					.from(B)
					.where(inArray(B.id, memberRowIds))
			: Promise.resolve([]),
		cardIds.length
			? db
					.select({
						id: B.id,
						lorebookId: B.lorebookId,
						characterId: B.characterId,
						overlayOf: B.overlayOf
					})
					.from(B)
					.where(
						and(
							inArray(B.characterId, cardIds),
							plan.reach(B.lorebookId)
						)
					)
			: Promise.resolve([])
	])

	// Every member the page needs read: the rows' own and each card row's listed members.
	const needed = [
		...memberRowIds,
		...cardMembers.filter((m) => m.overlayOf == null).map((m) => m.id)
	]
	const asRead = await membersAsRead(db, needed)

	const bookIds = [
		...new Set([
			...cardMembers.map((m) => m.lorebookId),
			...storedMembers.map((m) => m.lorebookId)
		])
	]
	const books = bookIds.length
		? await db
				.select({
					id: schema.lorebooks.id,
					name: schema.lorebooks.name,
					sessionId: schema.lorebooks.sessionId
				})
				.from(schema.lorebooks)
				.where(inArray(schema.lorebooks.id, bookIds))
		: []
	const sessionIds = [
		...new Set(
			books.map((b) => b.sessionId).filter((s): s is number => s != null)
		)
	]
	const sessionNames = new Map<number, string | null>(
		sessionIds.length
			? (
					await db
						.select({
							id: schema.sessions.id,
							name: schema.sessions.name
						})
						.from(schema.sessions)
						.where(inArray(schema.sessions.id, sessionIds))
				).map((s) => [s.id, s.name])
			: []
	)
	const bookById = new Map(books.map((b) => [b.id, b]))
	const reachOfBooks = (ids: readonly number[]) => {
		const distinct = [...new Set(ids)]
		const one =
			distinct.length === 1 ? bookById.get(distinct[0]!) : undefined
		return {
			lorebookCount: distinct.length,
			lorebook: one
				? {
						id: one.id,
						name: one.name,
						sessionId: one.sessionId,
						sessionName:
							one.sessionId != null
								? (sessionNames.get(one.sessionId) ?? null)
								: null
					}
				: null
		}
	}

	const tagRows = cardIds.length
		? await db
				.select({
					cardId: schema.characterTags.characterId,
					name: schema.tags.name,
					colorPreset: schema.tags.colorPreset
				})
				.from(schema.characterTags)
				.innerJoin(
					schema.tags,
					eq(schema.tags.id, schema.characterTags.tagId)
				)
				.where(inArray(schema.characterTags.characterId, cardIds))
				.orderBy(schema.tags.name)
		: []
	const tagsOf = new Map<
		number,
		{ name: string; colorPreset: string | null }[]
	>()
	for (const t of tagRows)
		(tagsOf.get(t.cardId) ?? tagsOf.set(t.cardId, []).get(t.cardId)!).push({
			name: t.name,
			colorPreset: t.colorPreset
		})

	const mediaIds = [
		...new Set(
			[
				...[...cards.values()].map((c) => c.avatarMediaId),
				...[...asRead.values()].map((m) => m.faceMediaId)
			].filter((v): v is number => typeof v === "number")
		)
	]
	const faceFiles = mediaIds.length
		? await db
				.select({
					id: schema.files.id,
					uuid: schema.files.uuid,
					rev: schema.files.rev,
					frame: schema.files.frame
				})
				.from(schema.files)
				.where(inArray(schema.files.id, mediaIds))
		: []
	const faceOf = (mediaId: number | null | undefined) => {
		const f = faceFiles.find((x) => x.id === mediaId)
		return f ? { uuid: f.uuid, rev: f.rev, frame: f.frame ?? null } : null
	}

	// Which listed members sit in a readable book (A) rather than only a story's notes (S).
	const memberBookReach = await bookReachOf(
		db,
		plan.readable,
		plan.story,
		cardMembers.filter((m) => m.overlayOf == null).map((m) => m.lorebookId)
	)

	// The owners of the cards shared with the asker: one read each.
	const otherCards = [...cards.values()].filter((c) => c.userId !== askerId)
	const ownerIds = [
		...new Set(
			otherCards
				.map((c) => c.userId)
				.filter((u): u is number => typeof u === "number")
		)
	]
	const [shareRows, ownerRows] = await Promise.all([
		otherCards.length
			? db
					.select({ cardId: schema.characterShares.characterId })
					.from(schema.characterShares)
					.where(
						and(
							inArray(
								schema.characterShares.characterId,
								otherCards.map((c) => c.id)
							),
							eq(schema.characterShares.userId, askerId)
						)
					)
			: Promise.resolve([]),
		ownerIds.length
			? db
					.select({
						id: schema.users.id,
						username: schema.users.username,
						displayName: schema.users.displayName
					})
					.from(schema.users)
					.where(inArray(schema.users.id, ownerIds))
			: Promise.resolve([])
	])
	const sharedWithMe = new Set(shareRows.map((r) => r.cardId))
	const ownerNameOf = new Map(
		ownerRows.map((u) => [u.id, u.displayName || u.username || null])
	)

	const ownWords = (m: MemberAsRead) =>
		m.cardless || m.followsCard.length < RETOLD_FIELDS.length

	for (const key of scan) {
		if (key.k === 0) {
			const card = cards.get(key.i)
			if (!card) continue
			const mine = card.userId === askerId
			const members = cardMembers.filter((m) => m.characterId === card.id)
			const listed = members
				.filter((m) => m.overlayOf == null)
				.map((m) => asRead.get(m.id))
				.filter((m): m is MemberAsRead => !!m)
			const shared = !mine && sharedWithMe.has(card.id)
			const readableMember =
				members
					.filter((m) => m.overlayOf == null && asRead.has(m.id))
					.sort(
						(x, y) =>
							Number(memberBookReach.a.has(y.lorebookId)) -
								Number(memberBookReach.a.has(x.lorebookId)) ||
							x.id - y.id
					)
					.map((m) => ({
						castMemberId: m.id,
						lorebookId: m.lorebookId
					}))[0] ?? null
			out.set(key, {
				rowKey: `card:${card.id}`,
				hasCard: true,
				cardId: card.id,
				castMemberId: null,
				cardIsMine: mine,
				shownName: card.name ?? "",
				nickname: card.nickname?.trim() || null,
				summary: characterSummary({
					name: card.name,
					summary: card.summary,
					creatorNotes: card.creatorNotes,
					description: card.description
				}),
				face: faceOf(card.avatarMediaId),
				reach: reachOfBooks(members.map((m) => m.lorebookId)),
				hasOwnWords: listed.some(ownWords),
				isFavorite: mine && card.isFavorite,
				isPersona: mine && card.isPersona,
				isDefaultPersona: mine && card.isDefaultPersona === true,
				embeddingModel: mine ? (card.embeddingModel ?? null) : null,
				folderId: mine ? (card.folderId ?? null) : null,
				isSharedWithMe: shared,
				ownerName:
					shared && card.userId != null
						? (ownerNameOf.get(card.userId) ?? null)
						: null,
				readableMember,
				tags: tagsOf.get(card.id) ?? []
			})
		} else {
			const stored = storedMembers.find((m) => m.id === key.i)
			if (!stored) continue
			const read = asRead.get(stored.id)
			out.set(key, {
				rowKey: `member:${stored.id}`,
				hasCard: false,
				cardId: null,
				castMemberId: stored.id,
				cardIsMine: false,
				shownName: read ? read.shownName : stored.name,
				nickname: read?.nickname?.trim() || null,
				summary: read
					? characterSummary({
							name: read.name,
							summary: read.summary,
							description: read.description
						})
					: characterSummary({
							name: stored.name,
							summary: stored.summary
						}),
				face: read ? faceOf(read.faceMediaId) : null,
				reach: reachOfBooks([stored.lorebookId]),
				hasOwnWords: read ? ownWords(read) : stored.characterId == null,
				isFavorite: false,
				isPersona: false,
				isDefaultPersona: false,
				embeddingModel: null,
				folderId: null,
				isSharedWithMe: false,
				ownerName: null,
				readableMember: null,
				tags: []
			})
		}
	}
	return out
}
