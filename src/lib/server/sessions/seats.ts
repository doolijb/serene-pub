/**
 * 🚧 **The one seat writer** (plan §27 v2, S1; owner ruling 2026-11-05: "Move
 * to seating cast instead of cards. Every session has a lorebook or [own book]
 * now. Cards seed cast, cast defaults to reading active linked card.").
 *
 * A session seats a CARD (`session_characters.character_id`,
 * `session_personas.persona_id`); the book holds MEMBERS. This module writes
 * the member beside the card, so a seat names who it is as well as which card
 * draws them. S1 is the dual write: `character_id` and `cast_member_id` both,
 * and behaviour otherwise unchanged — no reader looks at the member yet (S2).
 *
 * ## What it owns
 * Every write of a seat row's `character_id`, `envoy_slug`, `cast_member_id`
 * and `merged_into`, on both tables of seats:
 * - a **character seat** (`session_characters`) and an **envoy seat** — `seatCast`;
 * - a **player seat** (`session_personas`) — `seatPlayer`;
 * - the settling of a session's seats whose member is missing or doubled —
 *   `settleSeats`, which the boot pass (`seatMembers.ts`) and the session cast
 *   check call;
 * - one compatibility read of a seat — `seatOf`, a participant ref resolved to
 *   its seat (S2; S5 removes the card form);
 * - 🚧 the removal of a seat by a person — `unseat` (a live seat is benched; only a benched seat with no lines is removed);
 * - 🚧 the one writer of the bench on both seat tables — `setSeatBench` (owner 2026-11-10, benched seats);
 * - 🚧 saying what changed — every writer returns the `SeatChange`s of its call,
 *   and the doors that change a living session's seats (`sessions:update`,
 *   `sessions:addPersona`, `sessions:reassignRemovedParticipant`, the fold)
 *   hand them to `announceSeatChanges` (the member events), so no door diffs
 *   seats itself. A session being born (create, branch, import) announces with
 *   its own birth event instead, never a member event per seat.
 *
 * 🚧 (S4, plan §34.2) A seat can also be asked for by **member**
 * (`castMemberId`): a card-less character seat has `character_id` and
 * `envoy_slug` null and `cast_member_id` set; the player seat mints a new
 * card-less member for a named seat (`mintCardless`, ★6). "A character seat" is
 * a row that is not an envoy and has a member or a card.
 *
 * ## What it does not own
 * Other readers of `cast_member_id` (S2). A speaker's lines and the attribute values
 * on a seat (S4: it re-stamps lines to the survivor and merges values after a
 * merge, reading `merged_into`). The member rows themselves, beyond minting one
 * for a card nobody has yet (`findOrInsertBinding`).
 *
 * ## Which member a card is — `resolveSeatMember`
 * In order: the card's member in the session's attached book; else, when
 * asked to, a new one there when the session's owner owns it and it is not a
 * plugin's provided book (the gate `runLorebookBindingCheck` already had);
 * else the card's member in the session's own book; else, when asked to, a new
 * one in the own book (★B-5, 2026-11-08). "The card's member" is
 * `memberOfCard`: linked, or drawn by a dated change. Its find-only half is
 * `findSeatMembers` (the prompt's readers use it too). A deleted card is never
 * minted for, but the member the attached book lacks is still found in the own
 * book or an ancestor's, even when the attached book could mint (★RF-1,
 * 2026-11-09); `seatMembers.ts` `resolvable` mirrors this. 🚧 The one
 * exception is the boot fill of seats whose card was deleted with no member
 * anywhere (`fillSeatsBeforeCardDelete`, `mintDeleted`; owner 2026-11-10).
 *
 * ## The merge rule (owner, 2026-11-05)
 * One cast member is one seat. A **new** character seat whose member already
 * sits in the session is refused in words (`seatCast`, `secondCard: "refuse"`).
 * A bulk path (import, branch) seats with `"allow"` and settles fill-only
 * after (`settleSeats`): two live seats on one member stay seated, nothing
 * departs. **Only the boot pass merges** (`settleSeats(tx, id, { merge: true })`):
 * it departs every live character seat of a member but one — as a removal
 * does, plus `merged_into` pointing at the survivor. (Owner, ★S1-1,
 * 2026-11-05: a second card of a person already seated is refused in words,
 * never merged silently.) A player seat is never refused and never merged
 * into a character seat.
 *
 * ⚠ **No static import of `$lib/server/db`**, here or through anything this
 * module imports: every function takes its handle first, and a caller inside
 * a transaction hands its `tx` (the outer handle deadlocks PGlite). Modules
 * that do import it (`utils/ownedBook.ts`) are not used; `lorebooks/ownBook.ts`
 * is imported inside the function that needs it.
 */
import {
	and,
	asc,
	desc,
	eq,
	inArray,
	isNotNull,
	isNull,
	ne,
	or,
	sql,
	type Column,
	type SQL
} from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { memberOfCard } from "$lib/server/utils/castMemberCards"
import { cardsNow } from "$lib/server/cast/seatedCast"
import { membersAsRead } from "$lib/server/cast/memberAsRead"
import {
	findOrInsertBinding,
	syncLorebookBindingsForCharacter
} from "$lib/server/utils/characterBindingSync"
import { markedBook } from "$lib/server/plugins/providedMarks"
import { insertCastMember } from "$lib/server/characters/versions"
import { deriveNextBindingToken } from "$lib/server/utils/lorebookBindingToken"
import { resolveCharacterName } from "$lib/shared/utils/resolveCharacterName"
import type { SessionIo } from "$lib/server/pipelines/runtime/liveRow"

/** The books a session's seats are resolved against. */
export interface SeatBook {
	sessionId: number
	/** The session's owner (`sessions.user_id`). */
	ownerId: number
	/** The lorebook the session reads (`sessions.lorebook_id`), if any. */
	attachedId: number | null
	/**
	 * Whether a member may be minted into the attached book: it exists, its
	 * owner is the session's owner, and it is not a genuinely provided book.
	 */
	attachedMintable: boolean
	/** The session's own book (`lorebooks.session_id`), if it has one yet. */
	ownBookId: number | null
	/**
	 * 🚧 The own books of the session's ancestors (`sessions.branch_ancestry`),
	 * nearest first, each with that ancestor's mark (the write order taken at
	 * the fork). Empty for a session that is not a branch. A branch's seats
	 * point at the parent's own-book people, read through the cut
	 * (`findSeatMembers`; plan §32 §5d, ★CV-14).
	 */
	ancestorBooks: { lorebookId: number; mark: number }[]
}

/** 🚧 The sentences a refused seat is answered with. ★ copy for the owner. */
export const SEAT_REFUSALS = {
	/** A second card of a member who is already in the session. */
	sameMember(memberName: string, seatedName: string): string {
		return memberName.trim().toLowerCase() ===
			seatedName.trim().toLowerCase()
			? `${memberName} is already in this session.`
			: `${memberName} is already in this session as ${seatedName}.`
	},
	/** A member row that is the session's notes on someone (an overlay row), not a person. */
	overlayRow(name: string): string {
		return `That row is this session's notes on ${name}. Seat ${name} instead.`
	},
	/** A member of a book the session does not read. */
	outsideBooks(name: string): string {
		return `${name} isn't in this session's lorebook. Seat someone from its cast instead.`
	},
	/** A member id nothing holds any more. */
	memberGone(): string {
		return "That cast member is no longer in this session's lorebook."
	}
}

/** 🚧 A member a seat just minted in an attached book: its name waits for `syncMintedSeatMembers`. */
export interface MintedSeatMember {
	cardId: number
	lorebookId: number
}

/** 🚧 One seat that joined or left the roster in a writer's call; `cardId` is `character_id` for a character seat, `persona_id` for a player seat. */
export interface SeatChange {
	kind: "character" | "player"
	/** "added" / "removed": joined or left the roster. 🚧 "enabled": a live seat benched (`value` false) or brought back (`value` true) — `cast-changed`'s own word. */
	change: "added" | "removed" | "enabled"
	seatId: number
	castMemberId: number | null
	cardId: number | null
	/** 🚧 Only on `"enabled"`: true = in play, false = benched. */
	value?: boolean
}

export type SeatResult =
	| {
			ok: true
			seatId: number
			castMemberId: number | null
			minted: boolean
			mintedMembers: MintedSeatMember[]
			/** 🚧 `"added"` only when the seat was not live before the call (new, or revived); an envoy seat reports none. */
			changes: SeatChange[]
	  }
	| {
			ok: false
			refusal: string
			/** The member refused (null: a member id that names no member). */
			memberId: number | null
			/** The seat already holding the member (null: a refusal that is not about a seated pair). */
			seatedSeatId: number | null
	  }

/**
 * The refusal for a set of cards about to be a session's live character seats
 * when two of them are one cast member (the merge rule, asked BEFORE anything
 * is written — `sessions:create` and `sessions:update` check their whole list
 * first, so a refusal leaves no half-made cast). Find-only: nothing is minted.
 * With `sessionId`, the session's books (`resolveSeatMember`); without one (a
 * session not made yet), the book it will read (`lorebookId`, `memberOfCard`).
 * Null when every card is a different person, or no book knows them.
 *
 * `castMemberIds` are members listed for a card-less seat (plan §34.2): they
 * are checked together with the cards, so a card whose member is also listed
 * by id is refused as two cards of one person are.
 */
export async function sameMemberRefusal(
	tx: Db,
	input: {
		sessionId?: number
		lorebookId?: number | null
		cardIds: readonly number[]
		castMemberIds?: readonly number[]
	}
): Promise<string | null> {
	const book =
		input.sessionId != null ? await seatBookOf(tx, input.sessionId) : null
	const firstCardOf = new Map<number, number>()
	for (const cardId of new Set(input.cardIds)) {
		const memberId = book
			? (await resolveSeatMember(tx, book, cardId, { mint: false }))
					.memberId
			: input.lorebookId != null
				? await memberOfCard(tx, input.lorebookId, cardId)
				: null
		if (memberId == null) continue
		const first = firstCardOf.get(memberId)
		if (first === undefined) {
			firstCardOf.set(memberId, cardId)
			continue
		}
		return SEAT_REFUSALS.sameMember(
			await memberNameOf(tx, memberId, cardId, input.sessionId),
			await cardNameOf(tx, first)
		)
	}
	for (const memberId of new Set(input.castMemberIds ?? [])) {
		const first = firstCardOf.get(memberId)
		if (first === undefined) continue
		return SEAT_REFUSALS.sameMember(
			await memberNameOf(tx, memberId, first, input.sessionId),
			await cardNameOf(tx, first)
		)
	}
	return null
}

/** The books a session's seats resolve against; null for a session that does not exist. */
export async function seatBookOf(
	tx: Db,
	sessionId: number
): Promise<SeatBook | null> {
	const [session] = await tx
		.select({
			userId: schema.sessions.userId,
			lorebookId: schema.sessions.lorebookId,
			branchAncestry: schema.sessions.branchAncestry
		})
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	if (!session) return null
	let attachedMintable = false
	if (session.lorebookId != null) {
		const [book] = await tx
			.select({
				userId: schema.lorebooks.userId,
				uuid: schema.lorebooks.uuid,
				extraJson: schema.lorebooks.extraJson
			})
			.from(schema.lorebooks)
			.where(eq(schema.lorebooks.id, session.lorebookId))
			.limit(1)
		attachedMintable =
			!!book &&
			book.userId === session.userId &&
			!markedBook(book.extraJson, book.uuid)
	}
	const { ownBookOf } = await import("$lib/server/lorebooks/ownBook")
	const own = await ownBookOf(tx, sessionId)
	const ancestry = session.branchAncestry ?? []
	const ancestorBooks: SeatBook["ancestorBooks"] = []
	if (ancestry.length > 0) {
		const books = await tx
			.select({
				id: schema.lorebooks.id,
				sessionId: schema.lorebooks.sessionId
			})
			.from(schema.lorebooks)
			.where(
				inArray(
					schema.lorebooks.sessionId,
					ancestry.map((a) => a.sessionId)
				)
			)
			.orderBy(asc(schema.lorebooks.id))
		for (const a of ancestry) {
			const book = books.find((b) => b.sessionId === a.sessionId)
			if (book) ancestorBooks.push({ lorebookId: book.id, mark: a.mark })
		}
	}
	return {
		sessionId,
		ownerId: session.userId,
		attachedId: session.lorebookId ?? null,
		attachedMintable,
		ownBookId: own?.id ?? null,
		ancestorBooks
	}
}

/**
 * 🚧 Find-only: the member each card is in this session — its member in the
 * attached book, else in the session's own book, else in the own books of its
 * ancestry, nearest first (`resolveSeatMember`'s find order, never minting). A
 * card with none is absent from the map. Each card is asked once per call.
 * "The card's member" is `memberOfCard`.
 *
 * A member found in an ancestor's book counts only when it **passes that
 * ancestor's cut** (plan §32 §5d): the lowest `write_order` of its
 * `character_versions` rows is at or below the ancestor's `mark` (made before
 * the fork). A member with no version at all predates versions and counts.
 */
export async function findSeatMembers(
	tx: Db,
	book: SeatBook,
	cardIds: readonly number[]
): Promise<Map<number, { memberId: number; lorebookId: number }>> {
	const found = new Map<number, { memberId: number; lorebookId: number }>()
	const asked: number[] = []
	const places: { lorebookId: number | null; mark: number | null }[] = [
		{ lorebookId: book.attachedId, mark: null },
		{ lorebookId: book.ownBookId, mark: null },
		...book.ancestorBooks.map((a) => ({
			lorebookId: a.lorebookId as number | null,
			mark: a.mark as number | null
		}))
	]
	for (const { lorebookId, mark } of places) {
		if (lorebookId == null || asked.includes(lorebookId)) continue
		asked.push(lorebookId)
		for (const cardId of new Set(cardIds)) {
			if (found.has(cardId)) continue
			const memberId = await memberOfCard(tx, lorebookId, cardId)
			if (memberId == null) continue
			if (mark != null && !(await memberMadeBy(tx, memberId, mark)))
				continue
			found.set(cardId, { memberId, lorebookId })
		}
	}
	return found
}

/** Whether a member was made at or before a mark: its earliest version's `write_order` ≤ `mark`; no version at all counts. */
async function memberMadeBy(
	tx: Db,
	memberId: number,
	mark: number
): Promise<boolean> {
	const [first] = await tx
		.select({
			lowest: sql<number | null>`min(${schema.characterVersions.writeOrder})`
		})
		.from(schema.characterVersions)
		.where(eq(schema.characterVersions.castMemberId, memberId))
	const lowest = first?.lowest
	if (lowest == null) return true
	return Number(lowest) <= mark
}

/**
 * The cast member a card is in this session, found or — with `mint` — made.
 *
 * In order: (1) the card's member in the attached book; (2) with `mint`, when
 * the attached book is `attachedMintable`, a new member there; (3) the card's
 * member in the session's own book or an ancestor's (a value write's own-book
 * row, a kit's copy); (4) with `mint`, a new member in the own book, when
 * there is one — the session's book is fixed at start, so the own book may hold
 * a minted member (owner ★B-5, 2026-11-08). When step 2 cannot mint (a deleted
 * card the attached book has no member for) it falls through to step 3's
 * found member (★RF-1, 2026-11-09). A null `memberId` is a card nothing holds
 * yet, or a deleted card no book knows. 🚧 `mintDeleted` (only the boot fill,
 * `fillSeatsBeforeCardDelete`) mints for a deleted card in steps 2 and 4 too.
 *
 * A minted member has no name yet: its name and aliases come from the card
 * after the caller's transaction commits (`syncMintedSeatMembers`, from
 * `mintedIn`) — `syncLorebookBindingsForCharacter` opens its own transaction
 * and takes a per-character lock, which must not run inside this one's
 * lorebook lock.
 */
export async function resolveSeatMember(
	tx: Db,
	book: SeatBook,
	cardId: number,
	{ mint, mintDeleted = false }: { mint: boolean; mintDeleted?: boolean }
): Promise<{
	memberId: number | null
	minted: boolean
	/** The lorebook a member was minted into, if one was. */
	mintedIn: number | null
}> {
	const found = (await findSeatMembers(tx, book, [cardId])).get(cardId)
	if (found && found.lorebookId === book.attachedId)
		return { memberId: found.memberId, minted: false, mintedIn: null }
	if (book.attachedId != null && mint && book.attachedMintable) {
		const lorebookId = book.attachedId
		await tx.execute(sql`select pg_advisory_xact_lock(${lorebookId})`)
		const made = await findOrInsertBinding(tx, lorebookId, cardId, {
			mintDeleted
		})
		// A deleted card gets no new member here: fall through to the found one.
		if (made)
			return {
				memberId: made.row.id,
				minted: made.created,
				mintedIn: made.created ? lorebookId : null
			}
	}
	if (found)
		return { memberId: found.memberId, minted: false, mintedIn: null }
	if (mint && book.ownBookId != null) {
		const lorebookId = book.ownBookId
		await tx.execute(sql`select pg_advisory_xact_lock(${lorebookId})`)
		const made = await findOrInsertBinding(tx, lorebookId, cardId, {
			mintDeleted
		})
		if (!made) return { memberId: null, minted: false, mintedIn: null }
		return {
			memberId: made.row.id,
			minted: made.created,
			mintedIn: made.created ? lorebookId : null
		}
	}
	return { memberId: null, minted: false, mintedIn: null }
}

/** A member's shown name, falling back to the card's. */
async function memberNameOf(
	tx: Db,
	memberId: number,
	cardId: number,
	sessionId?: number
): Promise<string> {
	// The member as read (the session's reading when there is one), else the card's current version.
	const member = (
		await membersAsRead(
			tx,
			[memberId],
			sessionId != null ? { sessionId } : {}
		)
	).get(memberId)
	if (member?.name?.trim()) return member.name.trim()
	return cardNameOf(tx, cardId)
}

async function cardNameOf(tx: Db, cardId: number): Promise<string> {
	const card = (await cardsNow(tx, [cardId])).get(cardId)
	return resolveCharacterName(card, "Unknown")
}

/**
 * A member a seat is asked for by id (`castMemberId`), checked against the
 * session's books: it exists, is not an overlay row, and lives in the attached
 * book, the session's own book or an ancestor's. `characterId` is its linked
 * card (null: card-less).
 */
async function checkSeatMember(
	tx: Db,
	book: SeatBook,
	castMemberId: number
): Promise<
	{ ok: true; characterId: number | null } | { ok: false; refusal: string }
> {
	const [row] = await tx
		.select({
			id: schema.lorebookBindings.id,
			lorebookId: schema.lorebookBindings.lorebookId,
			characterId: schema.lorebookBindings.characterId,
			overlayOf: schema.lorebookBindings.overlayOf,
			name: schema.lorebookBindings.name
		})
		.from(schema.lorebookBindings)
		.where(eq(schema.lorebookBindings.id, castMemberId))
		.limit(1)
	if (!row) return { ok: false, refusal: SEAT_REFUSALS.memberGone() }
	const readName = async (id: number, fallback: string) =>
		(
			(await membersAsRead(tx, [id], { sessionId: book.sessionId })).get(
				id
			)?.shownName ?? ""
		).trim() ||
		fallback.trim() ||
		"That person"
	if (row.overlayOf != null) {
		const name = await readName(row.overlayOf, row.name)
		return { ok: false, refusal: SEAT_REFUSALS.overlayRow(name) }
	}
	const lives = [
		book.attachedId,
		book.ownBookId,
		...book.ancestorBooks.map((a) => a.lorebookId)
	].includes(row.lorebookId)
	if (!lives) {
		const name = await readName(row.id, row.name)
		return { ok: false, refusal: SEAT_REFUSALS.outsideBooks(name) }
	}
	return { ok: true, characterId: row.characterId }
}

/**
 * Seat a character or an envoy — the one writer of a character seat and an
 * envoy seat. A character seat writes `character_id` and `cast_member_id`
 * together; an envoy seat has no member. Both are upserts on the table's
 * unique index, reviving a soft-removed row unless `onExisting: "keep"`.
 *
 * ⚠ With `secondCard: "refuse"` (the default) a card whose member already has
 * a live seat here under another card is refused and nothing is written.
 */
export async function seatCast(
	tx: Db,
	input: {
		sessionId: number
		cardId?: number | null
		envoySlug?: string | null
		/**
		 * 🚧 Seat this cast member of the session's books (plan §34.2); it needs
		 * `seatedBy`, and a card-less one is seated with no card.
		 */
		castMemberId?: number | null
		position?: number
		isActive?: boolean
		onExisting?: "revive" | "keep"
		secondCard?: "refuse" | "allow"
		/**
		 * 🚧 The person seating it (owner §33.4: acting rights follow the
		 * seater). Written to `seated_by_user_id` on a new seat; a revive with it
		 * overwrites, without it keeps the row's (filling a null). Callers that
		 * don't pass it yet get today's rule: the held card's owner (an envoy
		 * seat: null).
		 */
		seatedBy?: number | null
		/**
		 * Write the row without its member, and refuse nothing: the caller runs
		 * `settleSeats` in the same transaction once the session's books exist
		 * (a branch, whose own book is copied after its seats).
		 */
		deferMember?: boolean
	}
): Promise<SeatResult> {
	const { sessionId } = input
	let cardId = input.cardId ?? null
	const envoySlug = input.envoySlug ?? null
	const castMemberId = input.castMemberId ?? null
	if ([cardId, envoySlug, castMemberId].filter((v) => v != null).length !== 1)
		throw new Error(
			"seatCast takes exactly one of a cardId, an envoySlug or a castMemberId"
		)
	const onExisting = input.onExisting ?? "revive"
	const t = schema.sessionCharacters

	// The member form: the member is checked against the session's books, and
	// its linked card (null: card-less) is the seat's card. ⏳ `character_id`
	// stays the linked card until S5 drops the card column.
	let givenMember: number | null = null
	if (castMemberId != null) {
		if (typeof input.seatedBy !== "number")
			throw new Error(
				"seatCast by castMemberId needs seatedBy: the person who seats a member keeps acting for the seat"
			)
		const book = await seatBookOf(tx, sessionId)
		if (!book) throw new Error(`Session ${sessionId} not found`)
		const checked = await checkSeatMember(tx, book, castMemberId)
		if (!checked.ok)
			return {
				ok: false,
				refusal: checked.refusal,
				memberId: null,
				seatedSeatId: null
			}
		givenMember = castMemberId
		cardId = checked.characterId
		if (cardId == null)
			return seatCardlessMember(tx, {
				sessionId,
				castMemberId,
				seatedBy: input.seatedBy,
				position: input.position,
				isActive: input.isActive,
				onExisting,
				secondCard: input.secondCard ?? "refuse"
			})
	}

	const existingSeat = async () => {
		const [row] = await tx
			.select({
				id: t.id,
				castMemberId: t.castMemberId,
				removedAt: t.removedAt
			})
			.from(t)
			.where(
				and(
					eq(t.sessionId, sessionId),
					cardId != null
						? eq(t.characterId, cardId)
						: eq(t.envoySlug, envoySlug!)
				)
			)
			.limit(1)
		return row
	}

	// "Keep" leaves a seat that is there exactly as it is — nothing resolved, nothing minted.
	if (onExisting === "keep") {
		const row = await existingSeat()
		if (row)
			return {
				ok: true,
				seatId: row.id,
				castMemberId: row.castMemberId,
				minted: false,
				mintedMembers: [],
				changes: []
			}
	}

	let memberId: number | null = null
	let minted = false
	let mintedIn: number | null = null
	if (cardId != null && (givenMember != null || !input.deferMember)) {
		if (givenMember != null) memberId = givenMember
		else {
			const book = await seatBookOf(tx, sessionId)
			if (!book) throw new Error(`Session ${sessionId} not found`)
			;({ memberId, minted, mintedIn } = await resolveSeatMember(
				tx,
				book,
				cardId,
				{ mint: true }
			))
		}
		if (memberId != null && (input.secondCard ?? "refuse") === "refuse") {
			// Another live character seat of the member: under another card, or
			// card-less (a seat of the member with no card).
			const [seated] = await tx
				.select({ id: t.id, characterId: t.characterId })
				.from(t)
				.where(
					and(
						eq(t.sessionId, sessionId),
						eq(t.castMemberId, memberId),
						isNull(t.removedAt),
						isNull(t.envoySlug),
						or(isNull(t.characterId), ne(t.characterId, cardId))
					)
				)
				.orderBy(asc(t.id))
				.limit(1)
			if (seated) {
				return {
					ok: false,
					refusal: SEAT_REFUSALS.sameMember(
						await memberNameOf(tx, memberId, cardId, sessionId),
						seated.characterId != null
							? await cardNameOf(tx, seated.characterId)
							: await memberNameOf(
									tx,
									memberId,
									cardId,
									sessionId
								)
					),
					memberId,
					seatedSeatId: seated.id
				}
			}
		}
	}

	const seatedBy =
		input.seatedBy !== undefined
			? input.seatedBy
			: cardId != null
				? ((
						await tx
							.select({ userId: schema.characters.userId })
							.from(schema.characters)
							.where(eq(schema.characters.id, cardId))
							.limit(1)
					)[0]?.userId ?? null)
				: null
	const values = {
		sessionId,
		characterId: cardId,
		envoySlug,
		castMemberId: memberId,
		seatedByUserId: seatedBy,
		...(input.position !== undefined ? { position: input.position } : {}),
		...(input.isActive !== undefined ? { isActive: input.isActive } : {})
	}
	const target = [t.sessionId, cardId != null ? t.characterId : t.envoySlug]
	const before = await existingSeat()
	const written =
		onExisting === "keep"
			? await tx
					.insert(t)
					.values(values)
					.onConflictDoNothing({ target })
					.returning({ id: t.id, castMemberId: t.castMemberId })
			: await tx
					.insert(t)
					.values(values)
					.onConflictDoUpdate({
						target,
						set: {
							removedAt: null,
							removedName: null,
							// A revived seat is merged into no other seat.
							mergedInto: null,
							isActive: input.isActive ?? true,
							...(input.position !== undefined
								? { position: input.position }
								: {}),
							// A null answer never clears a member the row already has.
							...(memberId != null
								? { castMemberId: memberId }
								: {}),
							// A seater given overwrites; none given keeps the row's own
							// (filling a null one).
							seatedByUserId:
								input.seatedBy !== undefined
									? input.seatedBy
									: sql`coalesce(${t.seatedByUserId}, excluded.seated_by_user_id)`
						}
					})
					.returning({ id: t.id, castMemberId: t.castMemberId })
	const row = written[0] ?? (await existingSeat())
	if (!row) throw new Error("A seat was neither written nor found")
	// A conflict kept the row: whatever was minted for it is still the member's.
	const mintedNow = written[0] ? minted : false
	// An envoy seat reports none; a character seat is added when it was not live before.
	const joined = envoySlug == null && (!before || before.removedAt != null)
	return {
		ok: true,
		seatId: row.id,
		castMemberId: row.castMemberId,
		minted: mintedNow,
		mintedMembers:
			mintedNow && cardId != null && mintedIn != null
				? [{ cardId, lorebookId: mintedIn }]
				: [],
		changes: joined
			? [
					{
						kind: "character",
						change: "added",
						seatId: row.id,
						castMemberId: row.castMemberId,
						cardId
					}
				]
			: []
	}
}

/**
 * A card-less character seat of a member (`seatCast`'s member form with no
 * linked card): `character_id` and `envoy_slug` null, `cast_member_id` set. It
 * has no unique key to conflict on, so it is revived by (session, member): the
 * newest departed character seat of the member. The merge rule applies up
 * front — a live character seat already holding the member (any card) is kept
 * (`onExisting: "keep"`, or `secondCard: "allow"`) or refuses.
 */
async function seatCardlessMember(
	tx: Db,
	input: {
		sessionId: number
		castMemberId: number
		seatedBy: number
		position?: number
		isActive?: boolean
		onExisting: "revive" | "keep"
		secondCard: "refuse" | "allow"
	}
): Promise<SeatResult> {
	const { sessionId, castMemberId } = input
	const t = schema.sessionCharacters
	const done = (seatId: number, joined = false): SeatResult => ({
		ok: true,
		seatId,
		castMemberId,
		minted: false,
		mintedMembers: [],
		changes: joined
			? [
					{
						kind: "character",
						change: "added",
						seatId,
						castMemberId,
						cardId: null
					}
				]
			: []
	})
	const [live] = await tx
		.select({ id: t.id, characterId: t.characterId })
		.from(t)
		.where(
			and(
				eq(t.sessionId, sessionId),
				eq(t.castMemberId, castMemberId),
				isNull(t.envoySlug),
				isNull(t.removedAt)
			)
		)
		.orderBy(asc(t.id))
		.limit(1)
	if (live) {
		if (input.onExisting === "keep" || input.secondCard === "allow")
			return done(live.id)
		const name = await memberNameOf(
			tx,
			castMemberId,
			live.characterId ?? 0,
			sessionId
		)
		return {
			ok: false,
			refusal: SEAT_REFUSALS.sameMember(name, name),
			memberId: castMemberId,
			seatedSeatId: live.id
		}
	}
	const [departed] = await tx
		.select({ id: t.id })
		.from(t)
		.where(
			and(
				eq(t.sessionId, sessionId),
				eq(t.castMemberId, castMemberId),
				isNull(t.envoySlug),
				isNotNull(t.removedAt)
			)
		)
		.orderBy(desc(t.id))
		.limit(1)
	if (departed) {
		// "Keep" leaves a departed seat as it is; only a revive brings it back.
		if (input.onExisting === "keep") return done(departed.id)
		await tx
			.update(t)
			.set({
				removedAt: null,
				removedName: null,
				mergedInto: null,
				// The member is card-less now: a seat that held a card it was
				// unlinked from comes back holding none (⏳ until S5).
				characterId: null,
				isActive: input.isActive ?? true,
				...(input.position !== undefined
					? { position: input.position }
					: {}),
				seatedByUserId: input.seatedBy
			})
			.where(eq(t.id, departed.id))
		return done(departed.id, true)
	}
	const [row] = await tx
		.insert(t)
		.values({
			sessionId,
			characterId: null,
			envoySlug: null,
			castMemberId,
			seatedByUserId: input.seatedBy,
			...(input.position !== undefined
				? { position: input.position }
				: {}),
			...(input.isActive !== undefined
				? { isActive: input.isActive }
				: {})
		})
		.returning({ id: t.id })
	return done(row!.id, true)
}

/**
 * Seat a player — the one writer of a player seat (`session_personas`). The
 * seat carries its card's member when it has a card; a **live** seat mints
 * one, a departed copy (`removedAt` set) only finds. ⚠ Never refused and never
 * merged into a character seat: a player seat and a character seat on one
 * card both carry the member.
 *
 * `onExisting: "revive"` (default) upserts on (session, persona), reviving a
 * soft-removed row and leaving its other columns as they were; `"insert"` is
 * a plain insert (a branch copies retired seats with their `removedAt`).
 */
export async function seatPlayer(
	tx: Db,
	input: {
		sessionId: number
		personaId: number | null
		position?: number
		userId?: number | null
		seatName?: string | null
		portraitMediaId?: number | null
		removedAt?: Date | null
		removedName?: string | null
		onExisting?: "revive" | "insert"
		/** As `seatCast`'s: written without its member; the caller settles after. */
		deferMember?: boolean
		/**
		 * 🚧 Seat this cast member of the session's books (plan §34.2): its
		 * linked card is the persona, none is a card-less seat. A refusal is thrown.
		 */
		castMemberId?: number | null
		/**
		 * 🚧 ★6 (owner 2026-11-08): "Take a seat" with a seat name mints a new
		 * card-less member named by it in the session's own book.
		 */
		mintCardless?: boolean
		/** As `seatCast`'s: a revive brings the seat back in play (true unless given); 🚧 false seats it benched. */
		isActive?: boolean
	}
): Promise<{
	seatId: number
	castMemberId: number | null
	minted: boolean
	mintedMembers: MintedSeatMember[]
	/** 🚧 `"added"` only when the seat was not live before the call (new, or revived); `"enabled"` (true) when a live benched seat came back. */
	changes: SeatChange[]
}> {
	const { sessionId } = input
	let personaId = input.personaId ?? null
	const castMemberId = input.castMemberId ?? null
	const t = schema.sessionPersonas
	let memberId: number | null = null
	let minted = false
	let mintedIn: number | null = null
	// The member form: checked against the session's books; a refusal is thrown
	// carrying its sentence (a player seat has no refusal return).
	if (castMemberId != null) {
		const book = await seatBookOf(tx, sessionId)
		if (!book) throw new Error(`Session ${sessionId} not found`)
		const checked = await checkSeatMember(tx, book, castMemberId)
		if (!checked.ok) throw new Error(checked.refusal)
		if (personaId != null && personaId !== checked.characterId)
			throw new Error(
				"seatPlayer: personaId and castMemberId name different cards"
			)
		// ⏳ `persona_id` stays the linked card until S5.
		personaId = checked.characterId
		memberId = castMemberId
	} else if (personaId != null && !input.deferMember) {
		const book = await seatBookOf(tx, sessionId)
		if (!book) throw new Error(`Session ${sessionId} not found`)
		;({ memberId, minted, mintedIn } = await resolveSeatMember(
			tx,
			book,
			personaId,
			{ mint: input.removedAt == null }
		))
	} else if (
		personaId == null &&
		input.mintCardless &&
		input.removedAt == null &&
		!input.deferMember &&
		input.seatName?.trim()
	) {
		// ★6: always a new member, never matched by name.
		const book = await seatBookOf(tx, sessionId)
		if (!book) throw new Error(`Session ${sessionId} not found`)
		const lorebookId =
			book.ownBookId ?? (book.attachedMintable ? book.attachedId : null)
		if (lorebookId != null) {
			await tx.execute(sql`select pg_advisory_xact_lock(${lorebookId})`)
			const { member } = await insertCastMember(tx, {
				lorebookId,
				characterId: null,
				binding: await deriveNextBindingToken(lorebookId, tx),
				name: input.seatName.trim()
			})
			memberId = member.id
			minted = true
		}
	}
	const values = {
		sessionId,
		personaId,
		castMemberId: memberId,
		...(input.position !== undefined ? { position: input.position } : {}),
		...(input.userId !== undefined ? { userId: input.userId } : {}),
		...(input.seatName !== undefined ? { seatName: input.seatName } : {}),
		...(input.portraitMediaId !== undefined
			? { portraitMediaId: input.portraitMediaId }
			: {}),
		...(input.removedAt !== undefined
			? { removedAt: input.removedAt }
			: {}),
		...(input.removedName !== undefined
			? { removedName: input.removedName }
			: {}),
		...(input.isActive !== undefined ? { isActive: input.isActive } : {})
	}
	// A card-less seat of a given member has no unique key to conflict on:
	// revive by (session, member) — a live row first, else the newest departed.
	if (
		castMemberId != null &&
		personaId == null &&
		(input.onExisting ?? "revive") === "revive"
	) {
		const [held] = await tx
			.select({ id: t.id, removedAt: t.removedAt, isActive: t.isActive })
			.from(t)
			.where(
				and(
					eq(t.sessionId, sessionId),
					eq(t.castMemberId, castMemberId),
					isNull(t.personaId)
				)
			)
			.orderBy(asc(sql`(${t.removedAt} is not null)`), desc(t.id))
			.limit(1)
		if (held) {
			await tx
				.update(t)
				.set({
					removedAt: null,
					removedName: null,
					isActive: input.isActive ?? true,
					...(input.position !== undefined
						? { position: input.position }
						: {})
				})
				.where(eq(t.id, held.id))
			return {
				seatId: held.id,
				castMemberId,
				minted: false,
				mintedMembers: [],
				changes:
					held.removedAt != null
						? [
								{
									kind: "player",
									change: "added",
									seatId: held.id,
									castMemberId,
									cardId: null
								}
							]
						: !held.isActive && (input.isActive ?? true)
							? [
									{
										kind: "player",
										change: "enabled",
										value: true,
										seatId: held.id,
										castMemberId,
										cardId: null
									}
								]
							: []
			}
		}
	}
	const insertOnly =
		(input.onExisting ?? "revive") === "insert" || personaId == null
	// A seat on a card that was not live before the call joins (a plain insert is always new).
	const before =
		!insertOnly && personaId != null
			? (
					await tx
						.select({ removedAt: t.removedAt, isActive: t.isActive })
						.from(t)
						.where(
							and(
								eq(t.sessionId, sessionId),
								eq(t.personaId, personaId)
							)
						)
						.limit(1)
				)[0]
			: undefined
	const insert = tx.insert(t).values(values)
	// A card-less seat has no unique key to conflict on.
	const [row] = insertOnly
		? await insert.returning({ id: t.id, castMemberId: t.castMemberId })
		: await insert
				.onConflictDoUpdate({
					target: [t.sessionId, t.personaId],
					set: {
						removedAt: null,
						removedName: null,
						isActive: input.isActive ?? true,
						...(input.position !== undefined
							? { position: input.position }
							: {}),
						...(memberId != null ? { castMemberId: memberId } : {})
					}
				})
				.returning({ id: t.id, castMemberId: t.castMemberId })
	return {
		seatId: row!.id,
		castMemberId: row!.castMemberId,
		minted,
		mintedMembers:
			minted && personaId != null && mintedIn != null
				? [{ cardId: personaId, lorebookId: mintedIn }]
				: [],
		changes:
			// A plain insert is new, unless it is a retired copy (`removedAt` given); an upsert always leaves the row live, so it joins when no live row was there.
			(
				insertOnly
					? (input.removedAt ?? null) == null
					: !before || before.removedAt != null
			)
				? [
						{
							kind: "player",
							change: "added",
							seatId: row!.id,
							castMemberId: row!.castMemberId,
							cardId: personaId
						}
					]
				: // A live benched row the upsert brought back in play.
					before && !before.isActive && (input.isActive ?? true)
					? [
							{
								kind: "player",
								change: "enabled",
								value: true,
								seatId: row!.id,
								castMemberId: row!.castMemberId,
								cardId: personaId
							}
						]
					: []
	}
}

/** What `settleSeats` did to one session. */
export interface SettleReport {
	/** Seats that were given (or moved to) the member their card resolves to. */
	filled: number
	/** Members made for a live seat's card. */
	minted: number
	/** Those members, for `syncMintedSeatMembers` once the transaction has committed. */
	mintedMembers: MintedSeatMember[]
	/** Live character seats departed because another seat of the session holds the same member (`merge: true` only). */
	merged: {
		departedSeatId: number
		survivorSeatId: number
		castMemberId: number
	}[]
	/** Live seats with a card still without a member (a deleted card no member has). Left as they are. */
	unexplained: number
	/** 🚧 A merge depart (boot only) is `"removed"`; a fill reports nothing — the seat did not join or leave. */
	changes: SeatChange[]
}

/**
 * Settle one session's seats — what the boot pass and the session cast check
 * both run, in one handle:
 * 1. every live seat with a card gets the member that card resolves to
 *    (minting one when none), a null answer never clearing a stored member;
 * 2. every departed seat with a card and no member is given one if the card
 *    has one — never minted for;
 * 3. only with `{ merge: true }` — the boot pass alone passes it — the merge
 *    rule: of the live character seats sharing a member, the one holding the
 *    member's linked card survives (else the active one, then the lowest
 *    position, then the lowest id); each other departs as a removal does,
 *    with `merged_into` naming the survivor. Messages, values and sheets are
 *    not touched (S4).
 *
 * **Fill-only by default**: a live path (attach, overwrite, create, import,
 * branch) never departs a seat — two live seats on one member stay seated
 * (the boot pass and S4 handle the pair). Owner, ★S1-1, 2026-11-05: never
 * merged silently.
 *
 * Deterministic: a second call on the same data changes nothing. The members
 * it minted (`mintedMembers`) are named by the caller after its transaction
 * commits (`syncMintedSeatMembers`).
 *
 * 🚧 `seatMembers` (card id → member id) seeds the per-call cache: those cards
 * take exactly those members, live and departed seats alike — a branch passes
 * its parent's seat members (plan §32 §5d, ★CV-14).
 */
export async function settleSeats(
	tx: Db,
	sessionId: number,
	opts: { merge?: boolean; seatMembers?: ReadonlyMap<number, number> } = {}
): Promise<SettleReport> {
	const report: SettleReport = {
		filled: 0,
		minted: 0,
		mintedMembers: [],
		merged: [],
		unexplained: 0,
		changes: []
	}
	const book = await seatBookOf(tx, sessionId)
	if (!book) return report
	const cs = schema.sessionCharacters
	const ps = schema.sessionPersonas

	// A card's member, asked once per call. Only an answer is kept: a departed
	// seat's "no member" must not stand in for a live seat's mint.
	const known = new Map<number, number>(opts.seatMembers)
	const memberOf = async (cardId: number, mint: boolean) => {
		const cached = known.get(cardId)
		if (cached != null) return cached
		const r = await resolveSeatMember(tx, book, cardId, { mint })
		if (r.minted) {
			report.minted++
			if (r.mintedIn != null)
				report.mintedMembers.push({ cardId, lorebookId: r.mintedIn })
		}
		if (r.memberId != null) known.set(cardId, r.memberId)
		return r.memberId
	}

	// 1. Live seats. (Steps 1–2 fill members by card, so they read only seats
	// with a card: a card-less seat already carries its member.)
	const liveCharacterSeats = await tx
		.select({
			id: cs.id,
			cardId: cs.characterId,
			memberId: cs.castMemberId
		})
		.from(cs)
		.where(
			and(
				eq(cs.sessionId, sessionId),
				isNull(cs.removedAt),
				isNotNull(cs.characterId)
			)
		)
		.orderBy(asc(cs.id))
	for (const seat of liveCharacterSeats) {
		const memberId = await memberOf(seat.cardId!, true)
		if (memberId != null && memberId !== seat.memberId) {
			await tx
				.update(cs)
				.set({ castMemberId: memberId })
				.where(eq(cs.id, seat.id))
			report.filled++
		} else if (memberId == null && seat.memberId == null)
			report.unexplained++
	}
	const livePlayerSeats = await tx
		.select({ id: ps.id, cardId: ps.personaId, memberId: ps.castMemberId })
		.from(ps)
		.where(
			and(
				eq(ps.sessionId, sessionId),
				isNull(ps.removedAt),
				isNotNull(ps.personaId)
			)
		)
		.orderBy(asc(ps.id))
	for (const seat of livePlayerSeats) {
		const memberId = await memberOf(seat.cardId!, true)
		if (memberId != null && memberId !== seat.memberId) {
			await tx
				.update(ps)
				.set({ castMemberId: memberId })
				.where(eq(ps.id, seat.id))
			report.filled++
		} else if (memberId == null && seat.memberId == null)
			report.unexplained++
	}

	// 2. Departed seats: found, never minted for.
	const departedCharacterSeats = await tx
		.select({ id: cs.id, cardId: cs.characterId })
		.from(cs)
		.where(
			and(
				eq(cs.sessionId, sessionId),
				isNotNull(cs.removedAt),
				isNotNull(cs.characterId),
				isNull(cs.castMemberId)
			)
		)
		.orderBy(asc(cs.id))
	for (const seat of departedCharacterSeats) {
		const memberId = await memberOf(seat.cardId!, false)
		if (memberId == null) continue
		await tx
			.update(cs)
			.set({ castMemberId: memberId })
			.where(eq(cs.id, seat.id))
		report.filled++
	}
	const departedPlayerSeats = await tx
		.select({ id: ps.id, cardId: ps.personaId })
		.from(ps)
		.where(
			and(
				eq(ps.sessionId, sessionId),
				isNotNull(ps.removedAt),
				isNotNull(ps.personaId),
				isNull(ps.castMemberId)
			)
		)
		.orderBy(asc(ps.id))
	for (const seat of departedPlayerSeats) {
		const memberId = await memberOf(seat.cardId!, false)
		if (memberId == null) continue
		await tx
			.update(ps)
			.set({ castMemberId: memberId })
			.where(eq(ps.id, seat.id))
		report.filled++
	}

	// 3. The merge rule, over the live character seats as they now stand: the
	// seat filter (not an envoy, and has a member or a card), so a card-less
	// seat of a member counts as a seat of it.
	if (!opts.merge) return report
	const live = await tx
		.select({
			id: cs.id,
			cardId: cs.characterId,
			memberId: cs.castMemberId,
			isActive: cs.isActive,
			position: cs.position
		})
		.from(cs)
		.where(
			and(
				eq(cs.sessionId, sessionId),
				isNull(cs.removedAt),
				isNull(cs.envoySlug),
				or(isNotNull(cs.characterId), isNotNull(cs.castMemberId)),
				isNotNull(cs.castMemberId)
			)
		)
		.orderBy(asc(cs.id))
	const groups = new Map<number, typeof live>()
	for (const seat of live) {
		const group = groups.get(seat.memberId!) ?? []
		group.push(seat)
		groups.set(seat.memberId!, group)
	}
	const doubled = [...groups.entries()].filter(
		([, seats]) => seats.length > 1
	)
	if (doubled.length === 0) return report
	const linked = new Map(
		(
			await tx
				.select({
					id: schema.lorebookBindings.id,
					characterId: schema.lorebookBindings.characterId
				})
				.from(schema.lorebookBindings)
				.where(
					inArray(
						schema.lorebookBindings.id,
						doubled.map(([memberId]) => memberId)
					)
				)
		).map((row) => [row.id, row.characterId] as const)
	)
	// Departing seats are named as their member reads on the session, else as the card's current version.
	const memberRead = await membersAsRead(
		tx,
		doubled.map(([memberId]) => memberId),
		{ sessionId }
	)
	const cardRead = await cardsNow(
		tx,
		live.flatMap((seat) => (seat.cardId != null ? [seat.cardId] : []))
	)
	for (const [memberId, seats] of doubled.sort((a, b) => a[0] - b[0])) {
		const linkedCard = linked.get(memberId) ?? null
		// A seat holds the member's linked card when its card is that card; a
		// card-less seat holds it only when the member has none (card-less too).
		// A null card never counts as holding a card the member does have.
		const holdsLinked = (seat: { cardId: number | null }) =>
			seat.cardId == null
				? linkedCard == null
				: seat.cardId === linkedCard
		const ranked = [...seats].sort(
			(a, b) =>
				Number(holdsLinked(b)) - Number(holdsLinked(a)) ||
				Number(b.isActive) - Number(a.isActive) ||
				(a.position ?? 0) - (b.position ?? 0) ||
				a.id - b.id
		)
		const [survivor, ...departing] = ranked
		for (const seat of departing) {
			await tx
				.update(cs)
				.set({
					removedAt: new Date(),
					removedName: resolveCharacterName(
						memberRead.get(memberId) ??
							(seat.cardId != null
								? cardRead.get(seat.cardId)
								: undefined),
						"Unknown"
					),
					isActive: false,
					mergedInto: survivor!.id
				})
				.where(eq(cs.id, seat.id))
			report.merged.push({
				departedSeatId: seat.id,
				survivorSeatId: survivor!.id,
				castMemberId: memberId
			})
			report.changes.push({
				kind: "character",
				change: "removed",
				seatId: seat.id,
				castMemberId: memberId,
				cardId: seat.cardId
			})
		}
	}
	return report
}

/**
 * Name the members `seatCast`, `seatPlayer` and `settleSeats` just minted
 * (their `mintedMembers`): the name and aliases come from the card, as
 * `resolveOrCreateBindingRow` does. 🚧
 *
 * ⚠ Call it **after** the writer's transaction has committed, with the outer
 * handle: `syncLorebookBindingsForCharacter` opens its own transaction and
 * takes a per-character advisory lock, which must not be taken inside the
 * lorebook lock a mint holds. A failure is logged (naming the card and the
 * book) and the loop goes on: the seat is committed, and the member's name
 * catches up on the card's next sync.
 */
export async function syncMintedSeatMembers(
	db: Db,
	minted: readonly MintedSeatMember[]
): Promise<void> {
	const seen = new Set<string>()
	for (const { cardId, lorebookId } of minted) {
		const key = `${cardId}:${lorebookId}`
		if (seen.has(key)) continue
		seen.add(key)
		try {
			await syncLorebookBindingsForCharacter(cardId, db, { lorebookId })
		} catch (err) {
			console.error(
				`[seats] could not name the member minted for card ${cardId} in lorebook ${lorebookId}:`,
				err
			)
		}
	}
}

/**
 * 🚧 Gives every live seat of a card that has no cast member one, before the card is deleted (★RF-1, 2026-11-09): per session, the card's member found in the attached book, else the session's own book, else an ancestor's, else a new one minted (attached book when it may mint, else the own book) and named from the card inside this transaction. Departed seats are left as they are (a session holds one seat row per card, so a session visited here has no departed seat of it). Runs inside the caller's delete transaction, before the card is marked deleted, so the card is still live and linked; a fill reports no `SeatChange`; uses only `tx`. Seats that have a member, card-less seats, other cards and other sessions are never touched.
 *
 * 🚧 `mintDeleted`: the boot pass (`seatMembers.ts`) fills the seats of a card deleted before this step existed (★RF-1 at startup, owner 2026-11-10: "One startup pass fills those seats"). The card is already soft-deleted, so the mint reads it anyway; the caller then turns each member in `mintedMemberIds` card-less (`makeMemberCardless`, cause `card-delete`) in the same transaction, as the delete paths do after marking the card.
 */
export async function fillSeatsBeforeCardDelete(
	tx: Db,
	cardId: number,
	{ mintDeleted = false }: { mintDeleted?: boolean } = {}
): Promise<{
	filled: number
	minted: number
	/** 🚧 The members minted here, named; still linked to the card. */
	mintedMemberIds: number[]
	/** 🚧 The sessions whose seats were written. */
	filledSessions: number[]
}> {
	await tx.execute(
		sql`select pg_advisory_xact_lock(hashtext('charBindingSync:character'), ${cardId})`
	)
	const sc = schema.sessionCharacters
	const sp = schema.sessionPersonas
	const chars = await tx
		.selectDistinct({ id: sc.sessionId })
		.from(sc)
		.where(
			and(
				eq(sc.characterId, cardId),
				isNull(sc.removedAt),
				isNull(sc.castMemberId)
			)
		)
	const players = await tx
		.selectDistinct({ id: sp.sessionId })
		.from(sp)
		.where(
			and(
				eq(sp.personaId, cardId),
				isNull(sp.removedAt),
				isNull(sp.castMemberId)
			)
		)
	const sessionIds = [
		...new Set([...chars, ...players].map((r) => r.id))
	].sort((a, b) => a - b)
	let filled = 0
	let minted = 0
	const mintedMemberIds: number[] = []
	const filledSessions: number[] = []
	for (const sessionId of sessionIds) {
		const book = await seatBookOf(tx, sessionId)
		if (!book) continue
		let memberId: number | null =
			(await findSeatMembers(tx, book, [cardId])).get(cardId)?.memberId ??
			null
		if (memberId == null) {
			const made = await resolveSeatMember(tx, book, cardId, {
				mint: true,
				mintDeleted
			})
			memberId = made.memberId
			if (made.minted && made.mintedIn != null && made.memberId != null) {
				minted++
				mintedMemberIds.push(made.memberId)
				await syncLorebookBindingsForCharacter(cardId, tx, {
					lorebookId: made.mintedIn
				})
			}
		}
		if (memberId == null) continue
		const rowsC = await tx
			.update(sc)
			.set({ castMemberId: memberId })
			.where(
				and(
					eq(sc.sessionId, sessionId),
					eq(sc.characterId, cardId),
					isNull(sc.removedAt),
					isNull(sc.castMemberId)
				)
			)
			.returning({ id: sc.id })
		const rowsP = await tx
			.update(sp)
			.set({ castMemberId: memberId })
			.where(
				and(
					eq(sp.sessionId, sessionId),
					eq(sp.personaId, cardId),
					isNull(sp.removedAt),
					isNull(sp.castMemberId)
				)
			)
			.returning({ id: sp.id })
		filled += rowsC.length + rowsP.length
		if (rowsC.length + rowsP.length > 0) filledSessions.push(sessionId)
	}
	return { filled, minted, mintedMemberIds, filledSessions }
}

/**
 * 🚧 Re-points one session's seats onto the members a fold copied: `cast_member_id` of its character and player seats named in `moves` takes the target; nothing else on a seat changes. Returns the seats moved, and the changes of the live ones: a character seat's ref (`seated-member:<id>`) changes with its member, so it is `"removed"` with the old member then `"added"` with the new; a player seat's ref (`player-seat:<seatId>`) does not change, so it reports nothing.
 */
export async function reseatOnto(
	tx: Db,
	sessionId: number,
	moves: ReadonlyMap<number, number>
): Promise<{ moved: number; changes: SeatChange[] }> {
	let moved = 0
	const changes: SeatChange[] = []
	for (const [from, to] of moves) {
		const rows = await tx
			.update(schema.sessionCharacters)
			.set({ castMemberId: to })
			.where(
				and(
					eq(schema.sessionCharacters.sessionId, sessionId),
					eq(schema.sessionCharacters.castMemberId, from)
				)
			)
			.returning({
				id: schema.sessionCharacters.id,
				cardId: schema.sessionCharacters.characterId,
				removedAt: schema.sessionCharacters.removedAt
			})
		moved += rows.length
		for (const row of rows) {
			if (row.removedAt != null || from === to) continue
			const seat = {
				kind: "character",
				seatId: row.id,
				cardId: row.cardId
			} as const
			changes.push(
				{ ...seat, change: "removed", castMemberId: from },
				{ ...seat, change: "added", castMemberId: to }
			)
		}
	}
	for (const [from, to] of moves) {
		const rows = await tx
			.update(schema.sessionPersonas)
			.set({ castMemberId: to })
			.where(
				and(
					eq(schema.sessionPersonas.sessionId, sessionId),
					eq(schema.sessionPersonas.castMemberId, from)
				)
			)
			.returning({ id: schema.sessionPersonas.id })
		moved += rows.length
	}
	return { moved, changes }
}

/**
 * 🚧 Is there any line of this seat in the session? Any `session_messages`
 * row, hidden or not, that `messages/store.ts` `speakerSeatOf` would give to
 * it: by card, by member (a row with no persona), or by the speaker mark.
 */
export async function seatHasLines(
	tx: Db,
	input: {
		sessionId: number
		kind: "character" | "player"
		seatId: number
		castMemberId: number | null
		cardId: number | null
	}
): Promise<boolean> {
	const m = schema.sessionMessages
	const { kind, seatId, castMemberId, cardId } = input
	const marks =
		kind === "character"
			? castMemberId != null
				? [
						and(isNull(m.personaId), eq(m.castMemberId, castMemberId)),
						sql`${m.metadata}->>'speaker' = ${`seated-member:${castMemberId}`}`
					]
				: []
			: [sql`${m.metadata}->>'speaker' = ${`player-seat:${seatId}`}`]
	const byCard =
		cardId != null
			? [kind === "character" ? eq(m.characterId, cardId) : eq(m.personaId, cardId)]
			: []
	const any = or(...byCard, ...marks)
	if (!any) return false
	const rows = await tx
		.select({ id: m.id })
		.from(m)
		.where(and(eq(m.sessionId, input.sessionId), any))
		.limit(1)
	return rows.length > 0
}

/**
 * 🚧 A person's removal of one seat (owner 2026-11-10, benched seats): removing
 * means benching. A live seat in play is benched (`setSeatBench`; an envoy
 * seat's refusal is thrown). A benched seat with no lines is soft-removed:
 * `removedAt` now and `removedName`. A benched seat with lines is never
 * removed: it throws "has lines". Returns the `SeatChange`s of what it did;
 * `[]` when the seat is already removed or missing.
 */
export async function unseat(
	tx: Db,
	input: {
		sessionId: number
		kind: "character" | "player"
		seatId: number
		removedName: string | null
	}
): Promise<SeatChange[]> {
	const { sessionId, kind, seatId, removedName } = input
	const row =
		kind === "character"
			? (
					await tx
						.select({
							castMemberId: schema.sessionCharacters.castMemberId,
							cardId: schema.sessionCharacters.characterId,
							removedAt: schema.sessionCharacters.removedAt,
							isActive: schema.sessionCharacters.isActive
						})
						.from(schema.sessionCharacters)
						.where(
							and(
								eq(schema.sessionCharacters.id, seatId),
								eq(schema.sessionCharacters.sessionId, sessionId)
							)
						)
						.limit(1)
				)[0]
			: (
					await tx
						.select({
							castMemberId: schema.sessionPersonas.castMemberId,
							cardId: schema.sessionPersonas.personaId,
							removedAt: schema.sessionPersonas.removedAt,
							isActive: schema.sessionPersonas.isActive
						})
						.from(schema.sessionPersonas)
						.where(
							and(
								eq(schema.sessionPersonas.id, seatId),
								eq(schema.sessionPersonas.sessionId, sessionId)
							)
						)
						.limit(1)
				)[0]
	if (!row || row.removedAt != null) return []
	if (row.isActive) {
		const benched = await setSeatBench(tx, {
			sessionId,
			kind,
			seatId,
			benched: true
		})
		if (!benched.ok) throw new Error(benched.refusal)
		return benched.changes
	}
	if (
		await seatHasLines(tx, {
			sessionId,
			kind,
			seatId,
			castMemberId: row.castMemberId,
			cardId: row.cardId
		})
	)
		throw new Error(
			`${removedName?.trim() || "This seat"} has lines in this session, so they can be benched but not removed.`
		)
	const t =
		kind === "character" ? schema.sessionCharacters : schema.sessionPersonas
	await tx
		.update(t)
		.set({ removedAt: new Date(), removedName })
		.where(and(eq(t.id, seatId), eq(t.sessionId, sessionId), isNull(t.removedAt)))
	return [
		{
			kind,
			change: "removed",
			seatId,
			castMemberId: row.castMemberId,
			cardId: row.cardId
		}
	]
}

/**
 * 🚧 **In play**, as SQL (owner 2026-11-10, benched seats): a live seat
 * (`removed_at IS NULL`) that is not benched (`is_active`), on either seat
 * table (a table, or the fields a relational `where` hands you). The pure form is `inPlay` (`$lib/shared/sessions/inPlay`); every
 * reader of turns, speaking seats, the prompt and the lore gate uses one of
 * the two and never spells the condition again.
 */
export const seatInPlay = (t: { removedAt: Column; isActive: Column }): SQL =>
	and(isNull(t.removedAt), eq(t.isActive, true)) as SQL

export { inPlay } from "$lib/shared/sessions/inPlay"

/**
 * 🚧 The one writer of the bench on both seat tables (owner 2026-11-10,
 * benched seats): sets `is_active` to `!benched` on one live seat and writes
 * nothing else. Refuses in words, never throws: no such seat in this session;
 * an envoy seat (switched off, not benched); a removed seat. A seat already
 * in the asked state is a no-op: `changes: []`, no write. Otherwise returns
 * one `"enabled"` change, `value` true = in play, false = benched.
 */
export async function setSeatBench(
	tx: Db,
	input: {
		sessionId: number
		kind: "character" | "player"
		seatId: number
		benched: boolean
	}
): Promise<
	{ ok: true; changes: SeatChange[] } | { ok: false; refusal: string }
> {
	const { sessionId, kind, seatId, benched } = input
	const row =
		kind === "character"
			? (
					await tx
						.select({
							castMemberId: schema.sessionCharacters.castMemberId,
							cardId: schema.sessionCharacters.characterId,
							envoySlug: schema.sessionCharacters.envoySlug,
							removedAt: schema.sessionCharacters.removedAt,
							isActive: schema.sessionCharacters.isActive
						})
						.from(schema.sessionCharacters)
						.where(
							and(
								eq(schema.sessionCharacters.id, seatId),
								eq(schema.sessionCharacters.sessionId, sessionId)
							)
						)
						.limit(1)
				)[0]
			: (
					await tx
						.select({
							castMemberId: schema.sessionPersonas.castMemberId,
							cardId: schema.sessionPersonas.personaId,
							envoySlug: sql<string | null>`null`,
							removedAt: schema.sessionPersonas.removedAt,
							isActive: schema.sessionPersonas.isActive
						})
						.from(schema.sessionPersonas)
						.where(
							and(
								eq(schema.sessionPersonas.id, seatId),
								eq(schema.sessionPersonas.sessionId, sessionId)
							)
						)
						.limit(1)
				)[0]
	if (!row) return { ok: false, refusal: "That seat is not in this session." }
	if (row.envoySlug != null)
		return {
			ok: false,
			refusal: "An envoy isn't benched: switch it off instead."
		}
	if (row.removedAt != null)
		return {
			ok: false,
			refusal:
				"That seat has left this session. Seat them again to bring them back."
		}
	if (row.isActive === !benched) return { ok: true, changes: [] }
	const t =
		kind === "character" ? schema.sessionCharacters : schema.sessionPersonas
	await tx
		.update(t)
		.set({ isActive: !benched })
		.where(
			and(eq(t.id, seatId), eq(t.sessionId, sessionId), isNull(t.removedAt))
		)
	return {
		ok: true,
		changes: [
			{
				kind,
				change: "enabled",
				value: !benched,
				seatId,
				castMemberId: row.castMemberId,
				cardId: row.cardId
			}
		]
	}
}

/**
 * 🚧 Announces what seat writers changed (`SeatChange`s) as `member-added` /
 * `member-removed`, plus `cast-changed` `enabled` for a bench (last value per
 * ref wins, sent after the member events), each under the person's `settings` cause, with the seat's
 * member-form ref (`hostSeatRefOf`). Nets by ref first: an add and a remove of
 * one ref cancel, repeats collapse. Best-effort and never throws; call it
 * after the writers' transaction has committed, never inside one.
 */
export async function announceSeatChanges(
	db: Db,
	io: SessionIo,
	who: { sessionId: number; userId: number },
	changes: readonly SeatChange[]
): Promise<void> {
	try {
		if (changes.length === 0) return
		const { hostSeatRefOf } = await import(
			"$lib/server/pipelines/prompt/seatCards"
		)
		const { emitSessionEvent } = await import(
			"$lib/server/pipelines/runtime/sessionEvents"
		)
		const { sessionEvents } = await import("@serene-pub/sdk")
		const net = new Map<string, "added" | "removed" | null>()
		const benchNet = new Map<string, boolean>()
		for (const c of changes) {
			const ref =
				hostSeatRefOf(c) ??
				(c.kind === "player" && c.cardId != null
					? `character:${c.cardId}`
					: null)
			if (ref == null) continue
			// 🚧 The bench: the last word per ref wins, announced after the member events.
			if (c.change === "enabled") {
				if (c.value !== undefined) benchNet.set(ref, c.value)
				continue
			}
			const seen = net.get(ref)
			if (seen === undefined) net.set(ref, c.change)
			else if (seen !== c.change) net.set(ref, null)
		}
		for (const [ref, change] of net) {
			if (change == null) continue
			try {
				const event =
					change === "added"
						? sessionEvents.memberAdded
						: sessionEvents.memberRemoved
				await emitSessionEvent(db, {
					sessionId: who.sessionId,
					userId: who.userId,
					event,
					payload: {
						sessionId: who.sessionId,
						ref,
						change,
						cause: { kind: "settings", userId: who.userId }
					},
					io
				})
			} catch (err) {
				console.warn(`member-${change} emit failed:`, err)
			}
		}
		for (const [ref, value] of benchNet) {
			try {
				await emitSessionEvent(db, {
					sessionId: who.sessionId,
					userId: who.userId,
					event: sessionEvents.castChanged,
					payload: {
						sessionId: who.sessionId,
						ref,
						change: "enabled",
						value,
						cause: { kind: "settings", userId: who.userId }
					},
					io
				})
			} catch (err) {
				console.warn("cast-changed emit failed:", err)
			}
		}
	} catch (err) {
		console.warn("announceSeatChanges failed:", err)
	}
}

/** 🚧 A session participant ref resolved to its seat (S2's compatibility read; S5 removes the card form). */
export interface ResolvedSeat {
	kind: "character" | "player"
	/** `session_characters.id` | `session_personas.id`. */
	seatId: number
	castMemberId: number | null
	/** `character_id` | `persona_id` (null: a card-less player seat). */
	cardId: number | null
	/** `removed_at` is set. */
	departed: boolean
	/**
	 * 🚧 Who acts for the seat: a character seat's `seated_by_user_id`, a
	 * player seat's `user_id`; null when unset (`seatActorOf` falls back).
	 */
	actingUserId: number | null
}

/**
 * 🚧 Pure: `character:<n>` · `seated-member:<n>` · `player-seat:<n>` →
 * `{ form, id }`; anything else → null. The ref is trimmed; `n` is a positive
 * safe integer written in digits. (The SDK's `parseParticipantRef` does not
 * know `seated-member:` yet.)
 */
export function parseSeatRef(
	ref: string
): { form: "character" | "seated-member" | "player-seat"; id: number } | null {
	const m = /^(character|seated-member|player-seat):(\d+)$/.exec(ref.trim())
	if (!m) return null
	const id = Number(m[2])
	if (!Number.isSafeInteger(id) || id <= 0) return null
	return { form: m[1] as "character" | "seated-member" | "player-seat", id }
}

/**
 * 🚧 A participant ref resolved to the session's seat (S2's compatibility
 * read). Always scoped to `sessionId`; null when nothing matches.
 * - `character:<cardId>` — a card; a player seat with a card is that card. The
 *   character seat whose `character_id` is the card, else the player seat
 *   whose `persona_id` is.
 * - `seated-member:<memberId>` — the character seat whose `cast_member_id` is
 *   the member, else the player seat whose is.
 * - `player-seat:<seatId>` — `session_personas.id`, of this session.
 *
 * In each form a live seat (`removed_at` null) wins over a departed one, in
 * either table; then the character seat over the player seat; among several,
 * the lowest `position`, then the lowest `id` (two live seats can share a
 * member until the boot pass settles them). An envoy seat is never returned.
 *
 * `cardFormRefInCast` (`pipelines/prompt/seatCards.ts`) mirrors this order over
 * a `session_cast` read in hand — change both together.
 */
export async function seatOf(
	tx: Db,
	sessionId: number,
	ref: string
): Promise<ResolvedSeat | null> {
	const parsed = parseSeatRef(ref)
	if (!parsed) return null
	const cs = schema.sessionCharacters
	const ps = schema.sessionPersonas

	const characterSeat = async (
		match: ReturnType<typeof eq>,
		departed: boolean
	): Promise<ResolvedSeat | null> => {
		const [row] = await tx
			.select({
				id: cs.id,
				castMemberId: cs.castMemberId,
				cardId: cs.characterId,
				removedAt: cs.removedAt,
				seatedBy: cs.seatedByUserId
			})
			.from(cs)
			.where(
				and(
					eq(cs.sessionId, sessionId),
					isNull(cs.envoySlug),
					match,
					departed ? isNotNull(cs.removedAt) : isNull(cs.removedAt)
				)
			)
			.orderBy(asc(sql`coalesce(${cs.position}, 0)`), asc(cs.id))
			.limit(1)
		return row
			? {
					kind: "character",
					seatId: row.id,
					castMemberId: row.castMemberId,
					cardId: row.cardId,
					departed: row.removedAt != null,
					actingUserId: row.seatedBy ?? null
				}
			: null
	}
	const playerSeat = async (
		match: ReturnType<typeof eq>,
		departed: boolean
	): Promise<ResolvedSeat | null> => {
		const [row] = await tx
			.select({
				id: ps.id,
				castMemberId: ps.castMemberId,
				cardId: ps.personaId,
				removedAt: ps.removedAt,
				userId: ps.userId
			})
			.from(ps)
			.where(
				and(
					eq(ps.sessionId, sessionId),
					match,
					departed ? isNotNull(ps.removedAt) : isNull(ps.removedAt)
				)
			)
			.orderBy(asc(sql`coalesce(${ps.position}, 0)`), asc(ps.id))
			.limit(1)
		return row
			? {
					kind: "player",
					seatId: row.id,
					castMemberId: row.castMemberId,
					cardId: row.cardId,
					departed: row.removedAt != null,
					actingUserId: row.userId ?? null
				}
			: null
	}

	for (const departed of [false, true]) {
		if (parsed.form === "player-seat") {
			const found = await playerSeat(eq(ps.id, parsed.id), departed)
			if (found) return found
			continue
		}
		const found =
			parsed.form === "character"
				? ((await characterSeat(
						eq(cs.characterId, parsed.id),
						departed
					)) ??
					(await playerSeat(eq(ps.personaId, parsed.id), departed)))
				: ((await characterSeat(
						eq(cs.castMemberId, parsed.id),
						departed
					)) ??
					(await playerSeat(
						eq(ps.castMemberId, parsed.id),
						departed
					)))
		if (found) return found
	}
	return null
}

/**
 * 🚧 Who acts for a seat (owner §33.4, "The person who seated it"): the seat's
 * `actingUserId` — a character seat's seater, a player seat's player. Where
 * that is unset (a seater whose account went; a player seat from before
 * `user_id`) the owner of its cast member's **active card** on the session's
 * reading, else the owner of the seat's own card. Null when none.
 */
export async function seatActorOf(
	tx: Db,
	sessionId: number,
	seat: ResolvedSeat
): Promise<number | null> {
	if (seat.actingUserId != null) return seat.actingUserId
	const cardOwner = async (cardId: number | null | undefined) => {
		if (cardId == null) return null
		const [card] = await tx
			.select({ userId: schema.characters.userId })
			.from(schema.characters)
			.where(eq(schema.characters.id, cardId))
			.limit(1)
		return card?.userId ?? null
	}
	if (seat.castMemberId != null) {
		const { memberAsRead } = await import("$lib/server/cast/memberAsRead")
		const active = (
			await memberAsRead(tx, seat.castMemberId, { sessionId })
		)?.activeCardId
		const owner = await cardOwner(active)
		if (owner != null) return owner
	}
	return cardOwner(seat.cardId)
}
