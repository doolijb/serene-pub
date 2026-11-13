/**
 * 🚧 The card a seat holds, read as the cast member it seats (plan §27 S2,
 * lane s27-S2-promptText; owner 2026-11-05: "cast defaults to reading active
 * linked card", members own over card).
 *
 * The prompt's readers take a seat's CARD row (`cc.character`) — the shape
 * `BasePromptSession`, the `session_cast` read and every prompt builder name.
 * These helpers keep that shape and fill it from the member as read
 * (`cast/memberAsRead.ts`): the member's own name and nickname, and each
 * retold text field the member tells in their own words, over the member's
 * ACTIVE card on the session's reading (owner ruling 2026-11-05: "Everything
 * in session is cast -> active card" — a dated card amendment moves a seat's
 * card with the story clock; the seat's own card only supplies the row's
 * `id`).
 *
 * The member a seat seats is its stored `cast_member_id` — read only when that
 * member lives in the session's attached book or its own book (after a book
 * swap a stored member can sit in a book the session does not read). A seat
 * with none stored, or none in those books, reads the member the seat writer
 * would find for its card (`findSeatMembers`, find-only: the attached book,
 * then the session's own book), so a seat the boot pass has not filled reads
 * what it read before; none found, the card as it is.
 *
 * ⚠ No static import of `$lib/server/db`: every function takes its handle.
 */
import * as schema from "$lib/server/db/schema"
import { inArray } from "drizzle-orm"
import { profileOf } from "$lib/shared/characters/profile"
import {
	CARD_CONTENT_COLUMNS,
	cardColumnsOfProfile
} from "$lib/server/characters/cardIO"
import { membersAsRead, type MemberAsRead } from "$lib/server/cast/memberAsRead"
import { cardsNow, type CardNow } from "$lib/server/cast/seatedCast"
import {
	findSeatMembers,
	parseSeatRef,
	seatBookOf
} from "$lib/server/sessions/seats"
import { memberFormOn } from "$lib/server/state/memberForm"

/** Two content values that read the same: null, undefined and "" are one absence. */
function sameContent(a: unknown, b: unknown): boolean {
	const norm = (v: unknown) => (v === undefined || v === "" ? null : v)
	return JSON.stringify(norm(a)) === JSON.stringify(norm(b))
}

/**
 * 🚧 PURE: a seat's card row read as its member — every profile field of the
 * member as read (`asRead`: the character version in force, its followed
 * fields from the exact parent card version) laid over the row in the card's
 * column names (`cardColumnsOfProfile`): name and nickname always; each other
 * content column (description, personality, scenario, the greetings split
 * into opener / alternates / group-only, example dialogues, aliases, summary,
 * post-history instructions, creator notes, strokes, the face as
 * `avatarMediaId`, likeness and timbre under `extensions`) when the row
 * carries that key. The row keeps its `id` and every other key; returns the
 * SAME object when nothing differs.
 *
 * The member is read over ITS active card ("Everything in session is cast ->
 * active card", owner 2026-11-05) — or none (`cardless`): what a seated person
 * *is* never comes from the card the seat holds, so a card-less member's
 * post-history and likeness reach the prompt as its own.
 */
export function seatCardAsRead<T extends object>(
	card: T,
	asRead: MemberAsRead
): T {
	const c = card as Record<string, unknown>
	const shown = cardColumnsOfProfile(profileOf(asRead)) as unknown as Record<
		string,
		unknown
	>
	const out: Record<string, unknown> = {}
	for (const key of CARD_CONTENT_COLUMNS) {
		if (key !== "name" && key !== "nickname" && !(key in c)) continue
		if (!sameContent(c[key], shown[key])) out[key] = shown[key]
	}
	return Object.keys(out).length ? ({ ...card, ...out } as T) : card
}

/**
 * 🚧 The card-shaped read of a CARD-LESS member: `cardColumnsOfProfile` of the
 * member as read (name, nickname, description, personality, greetings,
 * post-history, likeness, strokes ...) with `cardless: true`. It carries NO `id`
 * and NO `userId` key — a card id and a member id share one id range, so an id
 * here would be read as the wrong person; a reader that compares
 * `character.id === x` simply gets false, and ownership comes from the seat's
 * `seatedByUserId`, never the card.
 */
export function cardlessSeatCard(asRead: MemberAsRead): {
	cardless: true
	[key: string]: unknown
} {
	return {
		...(cardColumnsOfProfile(profileOf(asRead)) as unknown as Record<
			string,
			unknown
		>),
		cardless: true
	}
}

/** What `seatMembersAsRead` / `seatCardsAsRead` may be asked for beyond the default. */
interface SeatReadOptions {
	/**
	 * Also read the member of a row that holds NO card but stores a
	 * `castMemberId` (a card-less character seat) — trusted only when the
	 * member lives in one of the session's books (attached, own, or an
	 * ancestor's own book for a branch — the books `seatCast` accepts), with no
	 * `findSeatMembers` fallback. Default off: `seatCardsAsRead` also serves
	 * player seats, and filling those would hand every card-less player seat a
	 * made-up persona.
	 */
	cardless?: boolean
}

/** A seat row as the prompt's readers carry it: the card it holds, and the member it seats. */
export interface SeatCardRow {
	/** `session_characters.cast_member_id` / `session_personas.cast_member_id`; null or absent until filled. */
	castMemberId?: number | null
	/** The card the seat holds (a `characters` row), or null. */
	character?: object | null
}

/**
 * 🚧 The member each row's seat seats, as read on the session's reading
 * (`MemberAsRead`) over its active card — one entry per row, in
 * order; null for a row with no card or whose seat seats nobody. The read
 * behind `seatCardsAsRead`, for a reader that wants the member itself
 * rather than the card filled from it.
 *
 * A seat's stored member is read only when it lives in the session's attached
 * book or its own book; otherwise (another book, a deleted member) the seat
 * counts as unfilled and reads the member `findSeatMembers` finds for its
 * card. Seat sets are the caller's (live, departed, switched off — whatever its
 * query selected); this only reads the members. Two seats on one member
 * (possible until the next boot) read the same thing.
 */
export async function seatMembersAsRead<R extends SeatCardRow>(
	db: Db,
	sessionId: number,
	rows: readonly R[],
	opts: SeatReadOptions = {}
): Promise<(MemberAsRead | null)[]> {
	const cardIdOf = (row: R): number | null => {
		const id = (row.character as { id?: unknown } | null | undefined)?.id
		return typeof id === "number" ? id : null
	}
	// The member each row's seat seats: stored — when it lives in one of the
	// session's books — else the one the seat writer would find for its card
	// (`findSeatMembers`, find-only).
	// A card-less row (option on) keeps its stored member, trusted below, and
	// is never searched for: `cardlessRow`.
	const cardlessRow = (row: R): boolean =>
		!!opts.cardless && cardIdOf(row) == null && row.castMemberId != null
	const memberIds: (number | null)[] = rows.map((row) =>
		cardIdOf(row) == null
			? cardlessRow(row)
				? (row.castMemberId ?? null)
				: null
			: (row.castMemberId ?? null)
	)
	if (rows.some((row) => cardIdOf(row) != null || cardlessRow(row))) {
		const book = await seatBookOf(db, sessionId)
		const stored = [
			...new Set(memberIds.filter((id): id is number => id != null))
		]
		const trusted = new Set<number>()
		// A card-less row's member may also live in an ancestor's own book (a
		// branch rides its parent's people; `seatCast` accepts them there).
		const trustedCardless = new Set<number>()
		const ancestorBookIds = new Set(
			(book?.ancestorBooks ?? []).map((a) => a.lorebookId)
		)
		if (book && stored.length) {
			const homes = await db
				.select({
					id: schema.lorebookBindings.id,
					lorebookId: schema.lorebookBindings.lorebookId
				})
				.from(schema.lorebookBindings)
				.where(inArray(schema.lorebookBindings.id, stored))
			for (const home of homes)
				if (
					home.lorebookId === book.attachedId ||
					home.lorebookId === book.ownBookId
				) {
					trusted.add(home.id)
					trustedCardless.add(home.id)
				} else if (ancestorBookIds.has(home.lorebookId))
					trustedCardless.add(home.id)
		}
		// A stored member of a card-less row outside the session's books reads nobody.
		rows.forEach((row, i) => {
			const id = memberIds[i]
			if (cardlessRow(row) && id != null && !trustedCardless.has(id))
				memberIds[i] = null
		})
		const unfilled = rows.flatMap((row, i) => {
			const card = cardIdOf(row)
			const memberId = memberIds[i]
			return card != null && (memberId == null || !trusted.has(memberId))
				? [{ i, card }]
				: []
		})
		const found = book
			? await findSeatMembers(db, book, [
					...new Set(unfilled.map((u) => u.card))
				])
			: new Map<number, { memberId: number; lorebookId: number }>()
		for (const { i, card } of unfilled)
			memberIds[i] = found.get(card)?.memberId ?? null
	}
	const reads = await membersAsRead(
		db,
		memberIds.filter((id): id is number => id != null),
		{ sessionId }
	)
	return memberIds.map((id) => (id == null ? null : (reads.get(id) ?? null)))
}

/**
 * 🚧 Each row's card read as the member its seat seats (`seatCardAsRead`
 * over `seatMembersAsRead`), on the session's reading. Rows keep their order
 * and every other key; a row with no card, or whose seat seats nobody, comes
 * back as it was. Which member a seat seats, and over which card, is
 * `seatMembersAsRead`'s.
 */
export async function seatCardsAsRead<R extends SeatCardRow>(
	db: Db,
	sessionId: number,
	rows: readonly R[],
	opts: SeatReadOptions = {}
): Promise<R[]> {
	const asReads = await seatMembersAsRead(db, sessionId, rows, opts)
	return rows.map((row, i) => {
		const asRead = asReads[i]
		if (!asRead) return row
		if (!row.character)
			return opts.cardless && row.castMemberId != null
				? { ...row, character: cardlessSeatCard(asRead) }
				: row
		const character = seatCardAsRead(row.character, asRead)
		return character === row.character ? row : { ...row, character }
	})
}

/** The card form of a resolved seat: its card, else a card-less player seat's own ref. */
function cardFormOfSeat(seat: {
	kind: "character" | "player"
	seatId: number
	cardId: number | null
}): string | null {
	if (seat.cardId != null) return `character:${seat.cardId}`
	return seat.kind === "player" ? `player-seat:${seat.seatId}` : null
}

/** The seat rows of a `session_cast` read that `cardFormRefInCast` reads. */
export interface SeatRefCast {
	sessionCharacters?: ReadonlyArray<{
		castMemberId?: number | null
		seatId?: number | null
		position?: number | null
		removedAt?: unknown
		character?: { id?: number | null } | null
	} | null> | null
	sessionPersonas?: ReadonlyArray<{
		castMemberId?: number | null
		seatId?: number | null
		position?: number | null
		removedAt?: unknown
		persona?: { id?: number | null } | null
	} | null> | null
}

/**
 * ⏳ PURE `storedSeatRef` (`state/seatRefs.ts`) over a `session_cast` read in hand (for a binding,
 * which holds no database handle): a `seated-member:<memberId>` ref resolved
 * among the read's seats by their `castMemberId`, in `seatOf`'s order — live
 * before departed, character seats before player seats, then position, then
 * seat id. Any other ref comes back unchanged; null when no seat in the read
 * seats that member.
 *
 * ⚠ Mirrors `seatOf`'s order (`sessions/seats.ts`) — change both together;
 * `seatCards.test.ts` pins it.
 */
export function cardFormRefInCast(
	cast: SeatRefCast | null | undefined,
	ref: string
): string | null {
	const parsed = parseSeatRef(ref)
	if (parsed?.form !== "seated-member") return ref
	const found: {
		kind: "character" | "player"
		seatId: number
		cardId: number | null
		live: boolean
		position: number
	}[] = []
	for (const cc of cast?.sessionCharacters ?? [])
		if (cc?.castMemberId === parsed.id)
			found.push({
				kind: "character",
				seatId: cc.seatId ?? 0,
				cardId: cc.character?.id ?? null,
				live: cc.removedAt == null,
				position: cc.position ?? 0
			})
	for (const cp of cast?.sessionPersonas ?? [])
		if (cp?.castMemberId === parsed.id)
			found.push({
				kind: "player",
				seatId: cp.seatId ?? 0,
				cardId: cp.persona?.id ?? null,
				live: cp.removedAt == null,
				position: cp.position ?? 0
			})
	found.sort(
		(a, b) =>
			Number(b.live) - Number(a.live) ||
			Number(a.kind === "player") - Number(b.kind === "player") ||
			a.position - b.position ||
			a.seatId - b.seatId
	)
	return found.length ? cardFormOfSeat(found[0]) : null
}

/**
 * 🚧 ⏳ (S4, plan §34.1) The participant ref core gives a seat — the host-filled
 * `ref` of a seat row, and the one rule every emit site builds a seat's ref by.
 *
 * Flip on (`state/memberForm.ts`): a player seat, carded or not, is
 * `player-seat:<seatId>`; a character seat is `seated-member:<castMemberId>`,
 * ⏳ `character:<cardId>` while it stores no member. Flip off: the card form —
 * `character:<cardId>` for a seat with a card, `player-seat:<seatId>` for a
 * card-less player seat. Null for a seat neither form names (a card-less
 * character seat with no member).
 */
export function hostSeatRefOf(seat: {
	kind: "character" | "player"
	seatId: number
	castMemberId?: number | null
	cardId?: number | null
}): string | null {
	if (memberFormOn()) {
		if (seat.kind === "player") return `player-seat:${seat.seatId}`
		if (seat.castMemberId != null)
			return `seated-member:${seat.castMemberId}`
		return seat.cardId != null ? `character:${seat.cardId}` : null
	}
	return cardFormOfSeat({
		kind: seat.kind,
		seatId: seat.seatId,
		cardId: seat.cardId ?? null
	})
}

/**
 * 🚧 ⏳ PURE `storedSeatRef` (`state/seatRefs.ts`) over a `session_cast` read in
 * hand, both ways of the flip (`state/memberForm.ts`). Off: `cardFormRefInCast`.
 * On (S4): a `character:<cardId>` is read as the seat holding that card, and a
 * `seated-member:<memberId>` as the seat storing that member — each in
 * `seatOf`'s order (live before departed, character seats before player seats,
 * then position, then seat id) — answered as that seat's `hostSeatRefOf`, so a
 * member who sits only in a player seat answers `player-seat:<seatId>`. Any
 * other ref comes back unchanged; null when no seat in the read answers.
 *
 * ⚠ Mirrors `seatOf`'s order (`sessions/seats.ts`) — change both together.
 */
export function storedSeatRefInCast(
	cast: SeatRefCast | null | undefined,
	ref: string
): string | null {
	if (!memberFormOn()) return cardFormRefInCast(cast, ref)
	const parsed = parseSeatRef(ref)
	if (parsed?.form !== "seated-member" && parsed?.form !== "character")
		return ref
	const found: {
		kind: "character" | "player"
		seatId: number
		castMemberId: number | null
		cardId: number | null
		live: boolean
		position: number
	}[] = []
	const matches = (castMemberId: number | null, cardId: number | null) =>
		parsed.form === "seated-member"
			? castMemberId === parsed.id
			: cardId === parsed.id
	for (const cc of cast?.sessionCharacters ?? []) {
		const castMemberId = cc?.castMemberId ?? null
		const cardId = cc?.character?.id ?? null
		if (cc && matches(castMemberId, cardId))
			found.push({
				kind: "character",
				seatId: cc.seatId ?? 0,
				castMemberId,
				cardId,
				live: cc.removedAt == null,
				position: cc.position ?? 0
			})
	}
	for (const cp of cast?.sessionPersonas ?? []) {
		const castMemberId = cp?.castMemberId ?? null
		const cardId = cp?.persona?.id ?? null
		if (cp && matches(castMemberId, cardId))
			found.push({
				kind: "player",
				seatId: cp.seatId ?? 0,
				castMemberId,
				cardId,
				live: cp.removedAt == null,
				position: cp.position ?? 0
			})
	}
	found.sort(
		(a, b) =>
			Number(b.live) - Number(a.live) ||
			Number(a.kind === "player") - Number(b.kind === "player") ||
			a.position - b.position ||
			a.seatId - b.seatId
	)
	return found.length ? hostSeatRefOf(found[0]) : null
}

/**
 * 🚧 Cards read as this session reads them — for a reader that has card ids
 * (a transcript's `character_id`s, the scope's speaker, a card offered
 * again) rather than seat rows. Each card is read through the member of the
 * session's seat holding it (live before departed, then position, then id);
 * a card no seat holds, or whose seat has no member stored yet, reads the
 * member the seat writer would find for it (`seatCardsAsRead`), else comes
 * back as it was. Same order.
 */
export async function cardsAsSeatsRead<C extends { id: number }>(
	db: Db,
	sessionId: number,
	cards: readonly C[]
): Promise<C[]> {
	if (!cards.length) return []
	const { and, asc, eq, sql } = await import("drizzle-orm")
	const cs = schema.sessionCharacters
	const seats = await db
		.select({
			cardId: cs.characterId,
			castMemberId: cs.castMemberId,
			removedAt: cs.removedAt
		})
		.from(cs)
		.where(
			and(
				eq(cs.sessionId, sessionId),
				inArray(
					cs.characterId,
					cards.map((c) => c.id)
				)
			)
		)
		.orderBy(asc(sql`coalesce(${cs.position}, 0)`), asc(cs.id))
	const seatOfCard = new Map<number, number | null>()
	for (const live of [true, false])
		for (const s of seats)
			if (
				s.cardId != null &&
				(s.removedAt == null) === live &&
				!seatOfCard.has(s.cardId)
			)
				seatOfCard.set(s.cardId, s.castMemberId ?? null)
	const read = await seatCardsAsRead(
		db,
		sessionId,
		cards.map((card) => ({
			castMemberId: seatOfCard.get(card.id) ?? null,
			character: card
		}))
	)
	return read.map((row) => row.character)
}

/**
 * 🚧 Cards by id, read as this session reads them: each card's current card
 * version (`cardsNow`), then — with a session — read through the member of
 * the session's seat holding it (`cardsAsSeatsRead`). The one way a session
 * reader that holds card ids (a transcript's `character_id`, a
 * `character:<id>` ref, a scope's speaker) names or draws them: never the
 * card's ⏳ copy columns. Without a session (or for a card no seat answers
 * for) the card's current version. An unknown id is absent.
 */
export async function cardsNowAsSeatsRead(
	db: Db,
	sessionId: number | null | undefined,
	cardIds: readonly number[]
): Promise<Map<number, CardNow>> {
	const now = await cardsNow(db, cardIds)
	if (sessionId == null || !now.size) return now
	const read = await cardsAsSeatsRead(db, sessionId, [...now.values()])
	return new Map(read.map((c) => [c.id, c]))
}
