/**
 * 🚧 **World-scope writes** (M0, SHAPES F1): a slot whose declaration
 * says `scope: 'world'` keeps its values on the book, not on the session. A
 * session write names the session's own layer (`session`, `session_cast`,
 * `session_location`); `worldOwnerOf` re-owns it onto the book layer, dated
 * like any other.
 *
 * Where it lands (m3b-V2, ★M3b-W-1, owner 2026-11-05): in the session's own
 * notes when the session can't write its book (`keepsValuesInOwnBook`: no
 * book, or one its owner does not own); on the attached book, under its write
 * mode, when it is the owner's own — shared between the owner's sessions. A
 * character is filed on its cast member row in the notes, minted there on
 * first write, after the writer is checked and never before: a refused write
 * makes no row. The attached book gains no member row for anyone. A card-less
 * player seat has no card to be a member, so it holds nothing that lives on
 * the world. A place of the attached book is kept there too (★pl-1, owner
 * 2026-11-05), not as a row: in the notes' rule-fed overlay, by the book's
 * place id (`write.ts` `setOverlaidPlaceValue`) — after the writer is checked.
 *
 * Applied only where the slot says `scope: 'world'`; the callers decide.
 */
import { lorebookLinks, normalizeOwner } from "$lib/server/state/lorebookState"
import { attachedOrOwnBookOf, keepsValuesInOwnBook, ownBookFor } from "$lib/server/lorebooks/ownBook"
import { memberFormOn } from "$lib/server/state/memberForm"
import type { StateOwner } from "$lib/server/state/owners"
import { StateRefusal, assertOwnBookWriter, assertSessionOwner } from "$lib/server/state/write"
import { resolveOrCreateBindingRow } from "$lib/server/utils/characterBindingSync"
import { and, asc, eq, isNull } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"

const NO_CAST_SENTENCE =
	"This character is not in this world's cast, so a value that lives on the world has nowhere to go."

/**
 * The owner a world-scope value is filed under, for a write the session made against `owner`.
 * `userId` is the person writing; null for a run (the session's owner then).
 */
export async function worldOwnerOf(
	db: Db,
	sessionId: number,
	owner: StateOwner,
	userId: number | null
): Promise<StateOwner> {
	// 🚧 ⏳ S4, flip on (`memberForm.ts`): a seat in member form is filed on the world by its card, as its card-form `session_cast` always was; where that owner comes back unchanged (nothing to re-own it onto) the seat's own owner is answered, not the card's.
	if (memberFormOn() && (owner.kind === "seated_member" || owner.kind === "player_seat")) {
		if (owner.kind === "seated_member") await assertSessionOwner(db, sessionId, owner)
		const cardId = await cardOfSeatOwner(db, sessionId, owner)
		if (cardId == null) throw new StateRefusal("A player's seat holds nothing that lives on the world.")
		const asCard: StateOwner = { kind: "session_cast", id: cardId }
		const filed = await worldOwnerFiled(db, sessionId, asCard, userId)
		return filed === asCard ? owner : filed
	}
	return worldOwnerFiled(db, sessionId, owner, userId)
}

/** 🚧 ⏳ S4: the card a seat owner (`seated_member` by its member, `player_seat` by its seat) holds in this session; null for a card-less seat or none. */
async function cardOfSeatOwner(db: Db, sessionId: number, owner: StateOwner): Promise<number | null> {
	const cs = schema.sessionCharacters
	const ps = schema.sessionPersonas
	if (owner.kind === "player_seat") {
		const [seat] = await db
			.select({ personaId: ps.personaId })
			.from(ps)
			.where(and(eq(ps.id, owner.id), eq(ps.sessionId, sessionId), isNull(ps.removedAt)))
			.limit(1)
		return seat?.personaId ?? null
	}
	const [character] = await db
		.select({ characterId: cs.characterId })
		.from(cs)
		.where(and(eq(cs.castMemberId, owner.id), eq(cs.sessionId, sessionId), isNull(cs.envoySlug)))
		.orderBy(asc(cs.removedAt), asc(cs.id))
		.limit(1)
	if (character?.characterId != null) return character.characterId
	const [persona] = await db
		.select({ personaId: ps.personaId })
		.from(ps)
		.where(and(eq(ps.castMemberId, owner.id), eq(ps.sessionId, sessionId)))
		.orderBy(asc(ps.removedAt), asc(ps.id))
		.limit(1)
	return persona?.personaId ?? null
}

async function worldOwnerFiled(
	db: Db,
	sessionId: number,
	owner: StateOwner,
	userId: number | null
): Promise<StateOwner> {
	if (owner.kind === "player_seat") {
		const [seat] = await db
			.select({ personaId: schema.sessionPersonas.personaId })
			.from(schema.sessionPersonas)
			.where(
				and(
					eq(schema.sessionPersonas.id, owner.id),
					eq(schema.sessionPersonas.sessionId, sessionId),
					isNull(schema.sessionPersonas.removedAt)
				)
			)
			.limit(1)
		if (seat?.personaId == null) throw new StateRefusal("A player's seat holds nothing that lives on the world.")
		owner = { kind: "session_cast", id: seat.personaId }
	}
	if (await keepsValuesInOwnBook(db, sessionId)) {
		// The session can't write its book: its values live in its own notes.
		if (owner.kind === "session") {
			await assertOwnBookWriter(db, sessionId, userId)
			return { kind: "lorebook", id: (await ownBookFor(db, sessionId)).id }
		}
		if (owner.kind === "session_cast") return ownBookMemberOf(db, sessionId, owner, userId)
		// 🚧 (★pl-1) A place of the attached book: the write judges the writer, and lays it in the notes' overlay.
		if (owner.kind === "session_location" || owner.kind === "location") {
			await assertOwnBookWriter(db, sessionId, userId)
			return { kind: "location", id: owner.id }
		}
		// An explicit book, member or card goes where it is named; `setValue` judges it.
		// Never on to `attachedOrOwnBookOf`, which makes the notes before any writer is checked.
		return owner
	}
	const book = await attachedOrOwnBookOf(db, sessionId)
	if (book == null) return owner
	const links = await lorebookLinks(db, book)
	const filter = normalizeOwner({ kind: owner.kind, id: owner.id }, links)
	if (!filter) return owner
	if (filter.kind === "lorebook") {
		// Only the session's own layer is re-owned; a book, member or place named already is where it goes.
		return owner.kind === "session" ? { kind: "lorebook", id: book } : owner
	}
	if (filter.kind === "cast_member" && (filter.id === undefined || filter.id < 0)) {
		if (owner.kind !== "session_cast") throw new StateRefusal(NO_CAST_SENTENCE)
		// The attached book holds no member for them: their row is the session's own book's.
		return ownBookMemberOf(db, sessionId, owner, userId)
	}
	if (owner.kind === "session_cast" || owner.kind === "session_location") return { kind: filter.kind, id: filter.id! }
	return owner
}

/**
 * A character's cast member row in the session's own book — ★M3b-W-2: the
 * writer is checked first, then the row is made, so a refused write leaves no
 * empty cast row behind.
 */
async function ownBookMemberOf(
	db: Db,
	sessionId: number,
	owner: StateOwner,
	userId: number | null
): Promise<StateOwner> {
	// Nothing is minted for a character the session does not hold.
	await assertSessionOwner(db, sessionId, owner)
	// The writer is checked before the own book is made or touched.
	await assertOwnBookWriter(db, sessionId, userId)
	const own = await ownBookFor(db, sessionId)
	const row = await resolveOrCreateBindingRow({ lorebookId: own.id, characterId: owner.id }, db)
	if (!row) throw new StateRefusal(NO_CAST_SENTENCE)
	return { kind: "cast_member", id: row.id }
}
