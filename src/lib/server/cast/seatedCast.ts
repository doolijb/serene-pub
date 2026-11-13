/**
 * 🚧 The cast a session seats, as read (plan §27 S2): each live seat with the
 * cast member it seats, layered over that member's ACTIVE card on the
 * session's reading (owner ruling 2026-11-05: "Everything in session is cast
 * -> active card").
 *
 * ⚠ Must not statically import `$lib/server/db`; every function takes its
 * handle first.
 */
import {
	and,
	asc,
	desc,
	eq,
	getTableColumns,
	inArray,
	isNotNull,
	isNull,
	or,
	sql
} from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import * as schema from "$lib/server/db/schema"
import { membersAsRead, type MemberAsRead } from "./memberAsRead"
import { ensureCardVersion } from "$lib/server/characters/versions"
import {
	CARD_CONTENT_COLUMNS,
	cardAsOfVersion
} from "$lib/server/characters/cardIO"

/** The `characters` columns that are library facts — never the ⏳ copies or the frozen content. */
const CARD_LIBRARY_COLUMNS = (() => {
	const skip = new Set<string>([...CARD_CONTENT_COLUMNS, "characterVersion"])
	const all = getTableColumns(schema.characters)
	return Object.fromEntries(
		Object.entries(all).filter(([key]) => !skip.has(key))
	) as Omit<
		typeof all,
		(typeof CARD_CONTENT_COLUMNS)[number] | "characterVersion"
	>
})()

type CardLibraryRow = Omit<
	typeof schema.characters.$inferSelect,
	(typeof CARD_CONTENT_COLUMNS)[number] | "characterVersion"
>

/** 🚧 A card as its current card version has it, in the `characters` row shape (`cardsNow`). */
export type CardNow = ReturnType<typeof cardAsOfVersion<CardLibraryRow>>

/**
 * 🚧 Cards as their **current card version** has them (the highest `number`):
 * the `characters` row shape — its library facts from the row, its content
 * columns (name, nickname, description, face as `avatarMediaId`, greetings,
 * notes, likeness under `extensions`, …) from that version
 * (`cardAsOfVersion`), never from the ⏳ copies or the frozen columns. For a
 * session reader that has a card no seated cast member answers for (owner
 * ruling 2026-11-05: "Everything in session is cast -> active card" — a seat
 * reads its member; a card with no member reads the card).
 *
 * A card with no version yet (inserted raw, before versions) gets its v1 the
 * first time it is asked (`ensureCardVersion`). Soft-deleted cards are read
 * like any other (the copy reads never filtered them). An unknown id is
 * absent. Two queries for any number of cards.
 */
export async function cardsNow(
	db: Db,
	cardIds: readonly number[]
): Promise<Map<number, CardNow>> {
	const ids = [...new Set(cardIds)]
	const out = new Map<number, CardNow>()
	if (!ids.length) return out
	const cv = schema.characterVersions
	const [rows, versions] = await Promise.all([
		db
			.select(CARD_LIBRARY_COLUMNS)
			.from(schema.characters)
			.where(inArray(schema.characters.id, ids)),
		db
			.selectDistinctOn([cv.cardId])
			.from(cv)
			.where(inArray(cv.cardId, ids))
			.orderBy(asc(cv.cardId), desc(cv.number))
	])
	const versionOf = new Map(versions.map((v) => [v.cardId!, v]))
	for (const row of rows) {
		const version =
			versionOf.get(row.id) ?? (await ensureCardVersion(db, row.id))
		if (!version) continue
		out.set(row.id, cardAsOfVersion(row as CardLibraryRow, version))
	}
	return out
}

/** 🚧 One live seat of a session and the cast member it seats, as read. ⚠ Not the SDK's `CastEntry`. */
export interface SeatedCastEntry {
	seatId: number
	kind: "character" | "player"
	castMemberId: number | null
	cardId: number | null
	position: number
	/** null when the seat has no member yet (S1 mints none into a session's own book) — the caller reads the card. */
	asRead: MemberAsRead | null
}

/**
 * 🚧 Every live seat of a session (`removed_at IS NULL`): character seats
 * with a member or a card (an envoy seat is not one), by position then id, then player
 * seats — card-less ones too — by position then id. One read of all the seated
 * members, on the session's reading.
 */
export async function seatedCastOf(
	db: Db,
	sessionId: number
): Promise<SeatedCastEntry[]> {
	const cs = schema.sessionCharacters
	const ps = schema.sessionPersonas
	const characterSeats = await db
		.select({
			id: cs.id,
			castMemberId: cs.castMemberId,
			cardId: cs.characterId,
			position: cs.position
		})
		.from(cs)
		.where(
			and(
				eq(cs.sessionId, sessionId),
				isNull(cs.removedAt),
				isNull(cs.envoySlug),
				or(isNotNull(cs.characterId), isNotNull(cs.castMemberId))
			)
		)
		.orderBy(asc(cs.position), asc(cs.id))
	const playerSeats = await db
		.select({
			id: ps.id,
			castMemberId: ps.castMemberId,
			cardId: ps.personaId,
			position: ps.position
		})
		.from(ps)
		.where(and(eq(ps.sessionId, sessionId), isNull(ps.removedAt)))
		.orderBy(asc(ps.position), asc(ps.id))
	const seats = [
		...characterSeats.map((s) => ({ ...s, kind: "character" as const })),
		...playerSeats.map((s) => ({ ...s, kind: "player" as const }))
	]
	// Each seat reads its member over the member's active card. Two live seats
	// can share one member until the next boot; they read the same thing.
	const reads = await membersAsRead(
		db,
		seats.flatMap((s) => (s.castMemberId != null ? [s.castMemberId] : [])),
		{ sessionId }
	)
	return seats.map((s) => ({
		seatId: s.id,
		kind: s.kind,
		castMemberId: s.castMemberId ?? null,
		cardId: s.cardId ?? null,
		position: s.position ?? 0,
		asRead:
			s.castMemberId != null ? (reads.get(s.castMemberId) ?? null) : null
	}))
}

/**
 * 🚧 The sessions where a seat seats a member whom the session's reading draws
 * with card `cardId` through a cast version's parent card version (a dated card), optionally only
 * among `sessionIds`. Owner ruling 2026-11-05: "Everything in session is cast
 * -> active card" — viewing follows the member's active card.
 *
 * Seats of BOTH tables count, live or departed (`removed_at` is not asked:
 * the viewing rules count departed seats today). One SQL finds the candidates
 * (seats whose member has a cast version whose parent card version is of
 * this card); then each candidate session reads its members once on its own
 * reading (`membersAsRead`) and is kept when one of them is drawn with the
 * card now.
 *
 * ⚠ Only this ground: a member LINKED to the card and a seat HOLDING the card
 * are the callers' own SQL. Must not statically import `$lib/server/db`.
 */
export async function sessionsDrawingCard(
	db: Db,
	cardId: number,
	sessionIds?: readonly number[]
): Promise<number[]> {
	if (sessionIds && sessionIds.length === 0) return []
	const cs = schema.sessionCharacters
	const ps = schema.sessionPersonas
	const cv = schema.characterVersions
	const parent = alias(schema.characterVersions, "parent_version")
	const lb = schema.lorebookBindings
	const [characterRows, playerRows] = await Promise.all([
		db
			.selectDistinct({
				sessionId: cs.sessionId,
				memberId: cs.castMemberId
			})
			.from(cs)
			.innerJoin(cv, eq(cv.castMemberId, cs.castMemberId))
			.innerJoin(parent, eq(parent.id, cv.parentVersionId))
			.innerJoin(lb, eq(lb.id, cv.castMemberId))
			.where(
				and(
					eq(parent.cardId, cardId),
					// A member's linked card is the callers' own ground.
					sql`${parent.cardId} IS DISTINCT FROM ${lb.characterId}`,
					sessionIds
						? inArray(cs.sessionId, [...sessionIds])
						: undefined
				)
			),
		db
			.selectDistinct({
				sessionId: ps.sessionId,
				memberId: ps.castMemberId
			})
			.from(ps)
			.innerJoin(cv, eq(cv.castMemberId, ps.castMemberId))
			.innerJoin(parent, eq(parent.id, cv.parentVersionId))
			.innerJoin(lb, eq(lb.id, cv.castMemberId))
			.where(
				and(
					eq(parent.cardId, cardId),
					// A member's linked card is the callers' own ground.
					sql`${parent.cardId} IS DISTINCT FROM ${lb.characterId}`,
					sessionIds
						? inArray(ps.sessionId, [...sessionIds])
						: undefined
				)
			)
	])
	const membersBySession = new Map<number, Set<number>>()
	for (const row of [...characterRows, ...playerRows]) {
		if (row.memberId == null) continue
		const set = membersBySession.get(row.sessionId) ?? new Set<number>()
		set.add(row.memberId)
		membersBySession.set(row.sessionId, set)
	}
	const out: number[] = []
	for (const [sessionId, memberIds] of membersBySession) {
		const reads = await membersAsRead(db, [...memberIds], { sessionId })
		for (const read of reads.values()) {
			if (read.activeCardId === cardId) {
				out.push(sessionId)
				break
			}
		}
	}
	return out
}
