/**
 * 🚧 The write half of a session's two **guest seat switches** (owner rulings
 * G3, G4, 2026-11-16), and the checks a guest's seat action is held to. The
 * read half and the sentences are `$lib/shared/sessions/guestSeats`.
 *
 * The switches live on `sessions.metadata` as their own keys, written as SQL
 * `jsonb_set` / `-` like `writePlayerLabel`, so the row's other keys never move.
 */

import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	GUESTS_BRING_OWN_METADATA_KEY,
	GUESTS_TAKE_CAST_METADATA_KEY,
	GUEST_SEAT_SENTENCES,
	storedGuestSeatSwitches,
	type GuestSeatSwitches
} from "$lib/shared/sessions/guestSeats"
import { membersAsRead } from "$lib/server/cast/memberAsRead"
import {
	checkSeatMember,
	handOverSeat,
	SEAT_MOVE_REFUSALS,
	SEAT_REFUSALS,
	seatMoveCheck,
	seatMoveToPersonCheck,
	seatBookOf
} from "$lib/server/sessions/seats"
import { cardsNow } from "$lib/server/cast/seatedCast"
import { resolveCharacterName } from "$lib/shared/utils/resolveCharacterName"

/** A session's two switches, read from its row; a missing key is on. */
export async function guestSeatSwitchesOf(
	db: Db,
	sessionId: number
): Promise<GuestSeatSwitches> {
	const [row] = await db
		.select({ metadata: schema.sessions.metadata })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	return storedGuestSeatSwitches(row?.metadata)
}

async function writeSwitch(
	db: Db,
	sessionId: number,
	key: string,
	on: boolean
): Promise<void> {
	// Off stores `false`; on removes the key, so a session switched back on
	// reads exactly as one never touched.
	if (!on)
		await db.execute(sql`
			update ${schema.sessions}
			set ${sql.identifier("metadata")} = jsonb_set(
				coalesce(${schema.sessions.metadata}, '{}')::jsonb,
				${`{${key}}`}::text[],
				'false'::jsonb,
				true
			)::json
			where ${schema.sessions.id} = ${sessionId}
		`)
	else
		await db.execute(sql`
			update ${schema.sessions}
			set ${sql.identifier("metadata")} = (
				coalesce(${schema.sessions.metadata}, '{}')::jsonb - ${key}::text
			)::json
			where ${schema.sessions.id} = ${sessionId}
		`)
}

/** The ONE writer of the two switches. A switch not given is left alone. */
export async function writeGuestSeatSwitches(
	db: Db,
	sessionId: number,
	switches: { bringOwn?: boolean; takeCast?: boolean }
): Promise<void> {
	if (typeof switches.bringOwn === "boolean")
		await writeSwitch(
			db,
			sessionId,
			GUESTS_BRING_OWN_METADATA_KEY,
			switches.bringOwn
		)
	if (typeof switches.takeCast === "boolean")
		await writeSwitch(
			db,
			sessionId,
			GUESTS_TAKE_CAST_METADATA_KEY,
			switches.takeCast
		)
}

/** Every cast member a NOT-removed seat holds, benched seats included (a benched seat still holds its member). */
export async function heldMemberIds(
	db: Db,
	sessionId: number
): Promise<Set<number>> {
	const characters = await db
		.select({ id: schema.sessionCharacters.castMemberId })
		.from(schema.sessionCharacters)
		.where(
			and(
				eq(schema.sessionCharacters.sessionId, sessionId),
				isNull(schema.sessionCharacters.removedAt),
				isNull(schema.sessionCharacters.envoySlug),
				isNotNull(schema.sessionCharacters.castMemberId)
			)
		)
	const players = await db
		.select({ id: schema.sessionPersonas.castMemberId })
		.from(schema.sessionPersonas)
		.where(
			and(
				eq(schema.sessionPersonas.sessionId, sessionId),
				isNull(schema.sessionPersonas.removedAt),
				isNotNull(schema.sessionPersonas.castMemberId)
			)
		)
	return new Set([...characters, ...players].map((r) => r.id!))
}

/**
 * The card-less members of the session's books nobody plays: what a guest may
 * take. A member is listed when it is unseated, or held only by an in-play
 * card-less character seat the session's owner seated (no person plays it). A
 * benched seat still holds its member, and a player seat or another seater's
 * seat does too. Id, shown name and face only, never a profile field.
 */
export async function castToTakeOf(
	db: Db,
	sessionId: number
): Promise<Sockets.Sessions.CastToTake.Member[]> {
	const book = await seatBookOf(db, sessionId)
	if (!book) return []
	const books = [book.attachedId, book.ownBookId].filter(
		(id): id is number => id != null
	)
	if (!books.length) return []
	const rows = await db
		.select({
			id: schema.lorebookBindings.id,
			name: schema.lorebookBindings.name
		})
		.from(schema.lorebookBindings)
		.where(
			and(
				inArray(schema.lorebookBindings.lorebookId, books),
				isNull(schema.lorebookBindings.overlayOf),
				isNull(schema.lorebookBindings.characterId)
			)
		)
	const [owner] = await db
		.select({ userId: schema.sessions.userId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	const held = await heldMemberIds(db, sessionId)
	const characterSeats = await db
		.select({
			castMemberId: schema.sessionCharacters.castMemberId,
			characterId: schema.sessionCharacters.characterId,
			isActive: schema.sessionCharacters.isActive,
			seatedBy: schema.sessionCharacters.seatedByUserId
		})
		.from(schema.sessionCharacters)
		.where(
			and(
				eq(schema.sessionCharacters.sessionId, sessionId),
				isNull(schema.sessionCharacters.removedAt),
				isNull(schema.sessionCharacters.envoySlug),
				isNotNull(schema.sessionCharacters.castMemberId)
			)
		)
	const players = await db
		.select({ id: schema.sessionPersonas.castMemberId })
		.from(schema.sessionPersonas)
		.where(
			and(
				eq(schema.sessionPersonas.sessionId, sessionId),
				isNull(schema.sessionPersonas.removedAt),
				isNotNull(schema.sessionPersonas.castMemberId)
			)
		)
	const playerHeld = new Set(players.map((p) => p.id!))
	const seatsOf = new Map<number, typeof characterSeats>()
	for (const c of characterSeats)
		seatsOf.set(c.castMemberId!, [
			...(seatsOf.get(c.castMemberId!) ?? []),
			c
		])
	const free = rows.filter((r) => {
		if (!held.has(r.id)) return true
		if (playerHeld.has(r.id)) return false
		const seats = seatsOf.get(r.id) ?? []
		return (
			seats.length === 1 &&
			seats[0]!.characterId == null &&
			seats[0]!.isActive &&
			owner?.userId != null &&
			seats[0]!.seatedBy === owner.userId
		)
	})
	if (!free.length) return []
	const read = await membersAsRead(
		db,
		free.map((r) => r.id),
		{ sessionId }
	)
	const out: Sockets.Sessions.CastToTake.Member[] = []
	for (const r of free) {
		const m = read.get(r.id)
		if (!m || !m.cardless) continue
		out.push({
			castMemberId: r.id,
			name: m.shownName?.trim() || r.name?.trim() || "Unnamed character",
			faceMediaId: m.faceMediaId ?? null
		})
	}
	return out.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Why a guest may not take this member's seat, in words; null when they may.
 * A guest adds a card-less member nobody holds, never a carded one; a member
 * a seat holds is taken by a handover (`resolveSeatHandovers`).
 */
export async function guestTakeRefusal(
	db: Db,
	sessionId: number,
	castMemberId: number
): Promise<string | null> {
	const book = await seatBookOf(db, sessionId)
	if (!book) return null
	const checked = await checkSeatMember(db, book, castMemberId)
	if (!checked.ok) return checked.refusal
	const read = (await membersAsRead(db, [castMemberId], { sessionId })).get(
		castMemberId
	)
	const name = read?.shownName?.trim() || "That person"
	if (checked.characterId != null || !read?.cardless)
		return GUEST_SEAT_SENTENCES.cardedMember(name)
	if ((await heldMemberIds(db, sessionId)).has(castMemberId))
		return GUEST_SEAT_SENTENCES.memberHeld(name)
	return null
}

/**
 * The genre's opt-in, on adds only: a kind the genre's shape does not have
 * (omitted, or `max` 0) refuses a new seat of it, the owner's too, in the
 * sentence a session outside its shape is told. Existing seats are never
 * re-checked. No genre found: null.
 */
export async function seatKindAddRefusal(
	db: Db,
	sessionId: number,
	adds: { characters: number; personas: number }
): Promise<string | null> {
	if (adds.characters <= 0 && adds.personas <= 0) return null
	const [
		{ getSessionGenre, shapeViolations, sessionShapeFacts },
		{ sessionGenreOf }
	] = await Promise.all([
		import("$lib/server/pipelines/entities/sessionGenres"),
		import("$lib/server/sessions/annexFields")
	])
	const genre = await getSessionGenre(db, await sessionGenreOf(db, sessionId))
	if (!genre) return null
	const none = (cap?: { max?: number }) => !cap || cap.max === 0
	const shape = genre.shape as {
		characters?: { max?: number }
		personas?: { max?: number }
	}
	const noCharacters = adds.characters > 0 && none(shape.characters)
	const noPersonas = adds.personas > 0 && none(shape.personas)
	if (!noCharacters && !noPersonas) return null
	const facts = await sessionShapeFacts(db, sessionId)
	const violations = shapeViolations(genre.shape, {
		characters: noCharacters ? facts.characters + adds.characters : 0,
		personas: noPersonas ? facts.personas + adds.personas : 0,
		hasLorebook: false
	}).filter((v) => v.includes("has no "))
	if (!violations.length) return null
	return `This session does not fit '${genre.name}': ${violations.join("; ")}.`
}

/**
 * 🚧 The sentences of a seat handover (★ copy for the owner; owner rulings S1,
 * S2, S4, 2026-11-17).
 */
export const SEAT_HANDOVER_REFUSALS = {
	oneSeat: "Name one seat to hand over.",
	seatGone: "That seat is no longer in the session.",
	notInSession: "That person is not in this session.",
	watcher: (name: string): string =>
		`${name} is watching this session, so they can't be given a seat.`,
	ownerOnly:
		"Only the session's owner can give a seat to someone else. Ask them.",
	notYourCard: (name: string): string =>
		`${name} is someone else's character card, so its seat stays with the person who seated it.`,
	cardedPlayerSeat: (name: string): string =>
		`${name} is a persona with a card, so its seat stays with the card's owner.`
} as const

export type SeatHandoverWrite = {
	kind: "character" | "player"
	seatId: number
	/** The person the check saw playing it; the write matches only while they still do. */
	fromUserId: number | null
	toUserId: number
	/** A guest's take: the seat must still be in play. */
	requireActive: boolean
}

/**
 * Writes the checked handovers inside `tx`, each guarded by what the check saw.
 * A seat that changed since (gone, benched, or taken by someone else) throws
 * the sentence the check would have given, so the transaction rolls back.
 * Returns whether any row changed.
 */
export async function writeSeatHandovers(
	tx: Db,
	sessionId: number,
	writes: SeatHandoverWrite[]
): Promise<boolean> {
	let changed = false
	for (const w of writes) {
		if (await handOverSeat(tx, { sessionId, ...w })) {
			changed = true
			continue
		}
		const [row] =
			w.kind === "character"
				? await tx
						.select({
							memberId: schema.sessionCharacters.castMemberId
						})
						.from(schema.sessionCharacters)
						.where(
							and(
								eq(schema.sessionCharacters.id, w.seatId),
								eq(schema.sessionCharacters.sessionId, sessionId),
								isNull(schema.sessionCharacters.removedAt)
							)
						)
						.limit(1)
				: await tx
						.select({
							memberId: schema.sessionPersonas.castMemberId
						})
						.from(schema.sessionPersonas)
						.where(
							and(
								eq(schema.sessionPersonas.id, w.seatId),
								eq(schema.sessionPersonas.sessionId, sessionId),
								isNull(schema.sessionPersonas.removedAt)
							)
						)
						.limit(1)
		if (!row) throw new Error(SEAT_HANDOVER_REFUSALS.seatGone)
		const read =
			row.memberId != null
				? (await membersAsRead(tx, [row.memberId], { sessionId })).get(
						row.memberId
					)
				: undefined
		throw new Error(
			GUEST_SEAT_SENTENCES.memberHeld(
				read?.shownName?.trim() || "That seat"
			)
		)
	}
	return changed
}

/**
 * Checks every seat handover of a save before any is written; reads only, the
 * first refusal wins. A handover that changes nothing is dropped. The owner
 * gives a seat holding their own card or a card-less member to themselves or a
 * guest; a guest takes a card-less character seat the owner seated, or hands
 * one they seated back, while *Guests can take cast members* is on. Cross-kind
 * moves do not exist here: a seat keeps its kind.
 */
export async function resolveSeatHandovers(
	db: Db,
	args: {
		sessionId: number
		callerId: number
		isOwner: boolean
		handovers: Sockets.Sessions.Update.Params["seatHandovers"]
	}
): Promise<
	{ ok: false; refusal: string } | { ok: true; writes: SeatHandoverWrite[] }
> {
	const { sessionId, callerId, isOwner } = args
	const handovers = args.handovers ?? []
	const writes: SeatHandoverWrite[] = []
	if (!handovers.length) return { ok: true, writes }
	const refuse = (refusal: string) => ({ ok: false as const, refusal })
	const R = SEAT_HANDOVER_REFUSALS

	const [session] = await db
		.select({ userId: schema.sessions.userId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	if (!session) return refuse(R.seatGone)
	const ownerId = session.userId
	const guests = await db
		.select({
			userId: schema.sessionGuests.userId,
			isPlayer: schema.sessionGuests.isPlayer
		})
		.from(schema.sessionGuests)
		.where(eq(schema.sessionGuests.sessionId, sessionId))
	const switches = isOwner ? null : await guestSeatSwitchesOf(db, sessionId)

	for (const h of handovers) {
		const given = [h.characterId, h.castMemberId, h.playerSeatId].filter(
			(v) => v != null
		)
		if (given.length !== 1) return refuse(R.oneSeat)

		let kind: "character" | "player"
		let seat: {
			id: number
			current: number | null
			isActive: boolean
			cardId: number | null
			memberId: number | null
			seatName: string | null
			cardOwner: number | null
		} | null = null
		if (h.playerSeatId != null) {
			kind = "player"
			const [row] = await db
				.select({
					id: schema.sessionPersonas.id,
					current: schema.sessionPersonas.userId,
					isActive: schema.sessionPersonas.isActive,
					cardId: schema.sessionPersonas.personaId,
					seatName: schema.sessionPersonas.seatName,
					memberId: schema.sessionPersonas.castMemberId,
					cardOwner: schema.characters.userId
				})
				.from(schema.sessionPersonas)
				.leftJoin(
					schema.characters,
					eq(schema.characters.id, schema.sessionPersonas.personaId)
				)
				.where(
					and(
						eq(schema.sessionPersonas.id, h.playerSeatId),
						eq(schema.sessionPersonas.sessionId, sessionId),
						isNull(schema.sessionPersonas.removedAt)
					)
				)
				.limit(1)
			if (row)
				seat = {
					...row,
					cardOwner: row.cardOwner
				}
		} else {
			kind = "character"
			const [row] = await db
				.select({
					id: schema.sessionCharacters.id,
					current: schema.sessionCharacters.seatedByUserId,
					isActive: schema.sessionCharacters.isActive,
					cardId: schema.sessionCharacters.characterId,
					memberId: schema.sessionCharacters.castMemberId,
					cardOwner: schema.characters.userId
				})
				.from(schema.sessionCharacters)
				.leftJoin(
					schema.characters,
					eq(
						schema.characters.id,
						schema.sessionCharacters.characterId
					)
				)
				.where(
					and(
						eq(schema.sessionCharacters.sessionId, sessionId),
						isNull(schema.sessionCharacters.removedAt),
						isNull(schema.sessionCharacters.envoySlug),
						h.characterId != null
							? eq(
									schema.sessionCharacters.characterId,
									h.characterId
								)
							: and(
									eq(
										schema.sessionCharacters.castMemberId,
										h.castMemberId!
									),
									isNull(schema.sessionCharacters.characterId)
								)
					)
				)
				.limit(1)
			if (row) {
				seat = {
					id: row.id,
					current: row.current,
					isActive: row.isActive,
					cardId: row.cardId,
					memberId: row.memberId,
					seatName: null,
					cardOwner: row.cardOwner
				}
			}
		}
		if (!seat) return refuse(R.seatGone)

		const to = h.toUserId
		if (to !== ownerId) {
			const guest = guests.find((g) => g.userId === to)
			if (!guest) return refuse(R.notInSession)
			if (!guest.isPlayer) {
				const [u] = await db
					.select({
						displayName: schema.users.displayName,
						username: schema.users.username
					})
					.from(schema.users)
					.where(eq(schema.users.id, to))
					.limit(1)
				return refuse(
					R.watcher(
						u?.displayName?.trim() ||
							u?.username?.trim() ||
							"That person"
					)
				)
			}
		}

		// The person who plays a seat now: a character seat's seater, a player seat's
		// player (a row from before `user_id` reads its card's owner).
		if ((kind === "player" ? (seat.current ?? seat.cardOwner) : seat.current) === to)
			continue

		const nameOf = async (): Promise<string> => {
			if (seat!.cardId != null) {
				const card = (await cardsNow(db, [seat!.cardId])).get(seat!.cardId)
				const shown = card?.nickname?.trim() || card?.name?.trim()
				if (shown) return shown
			}
			if (seat!.seatName?.trim()) return seat!.seatName.trim()
			if (seat!.memberId != null) {
				const read = (
					await membersAsRead(db, [seat!.memberId], { sessionId })
				).get(seat!.memberId)
				if (read?.shownName?.trim()) return read.shownName.trim()
			}
			return "That seat"
		}

		if (isOwner) {
			if (
				kind === "player" &&
				seat.cardId != null &&
				seat.cardOwner !== ownerId
			)
				return refuse(R.cardedPlayerSeat(await nameOf()))
			if (
				kind === "character" &&
				seat.cardId != null &&
				seat.cardOwner !== ownerId
			)
				return refuse(R.notYourCard(await nameOf()))
		} else {
			if (h.castMemberId == null || (to !== callerId && to !== ownerId))
				return refuse(R.ownerOnly)
			if (!switches!.takeCast)
				return refuse(GUEST_SEAT_SENTENCES.takeCastOff)
			if (to === callerId) {
				if (!seat.isActive || seat.current !== ownerId)
					return refuse(
						GUEST_SEAT_SENTENCES.memberHeld(await nameOf())
					)
			} else if (seat.current !== callerId) return refuse(R.ownerOnly)
		}
		writes.push({
			kind,
			seatId: seat.id,
			fromUserId: seat.current,
			toUserId: to,
			requireActive: !isOwner && to === callerId
		})
	}
	return { ok: true, writes }
}

/**
 * 🚧 Why `toUserId` cannot be given a player seat in this session: not in it
 * (neither its owner nor a guest), or a watcher. Null when they can play. Reads
 * only; the sentences are a handover's.
 */
export async function seatPersonRefusal(
	db: Db,
	sessionId: number,
	toUserId: number
): Promise<string | null> {
	const R = SEAT_HANDOVER_REFUSALS
	const [session] = await db
		.select({ userId: schema.sessions.userId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	if (!session) return R.seatGone
	if (session.userId === toUserId) return null
	const [guest] = await db
		.select({ isPlayer: schema.sessionGuests.isPlayer })
		.from(schema.sessionGuests)
		.where(
			and(
				eq(schema.sessionGuests.sessionId, sessionId),
				eq(schema.sessionGuests.userId, toUserId)
			)
		)
		.limit(1)
	if (!guest) return R.notInSession
	if (guest.isPlayer) return null
	const [u] = await db
		.select({
			displayName: schema.users.displayName,
			username: schema.users.username
		})
		.from(schema.users)
		.where(eq(schema.users.id, toUserId))
		.limit(1)
	return R.watcher(
		u?.displayName?.trim() || u?.username?.trim() || "That person"
	)
}

/** One checked entry of `seatMoves`: the seat and what the check saw of it. */
export type SeatMoveWrite =
	| {
			to: "character"
			playerSeatId: number
			seen: { personaId: number | null; castMemberId: number | null }
	  }
	| {
			to: "player"
			characterSeatId: number
			toUserId: number
			seen: { characterId: number | null; castMemberId: number | null }
	  }

/**
 * 🚧 Checks every seat move of a save before any is written (owner rulings S2,
 * MV1, MV2, 2026-11-17); reads only, the first refusal wins. Only the session's
 * owner moves a seat: a non-owner with an entry to the AI is told
 * `ownerOnly`, with only entries to a person `ownerOnlyToPerson`. A player seat
 * moves to the AI when it is live, has a card or a member, is not already played
 * by the AI (a live character seat on its card or member, benched or not), does
 * not hold the turn, and no counted run is in progress (`seatMoveCheck`). A
 * character seat moves to a person (`seatMoveToPersonCheck`) when the person
 * plays in this session, the card is the session owner's, the person's, or none,
 * and the same holds. Each seat is checked once per direction (a player seat and a
 * character seat are different rows, so a seat cannot be named in both; the
 * card or member they share is refused by both checks as a pair). Then the genre's opt-in for
 * the new seats of each kind, once. `moveSeatKind` runs each check again inside
 * its write.
 */
export async function resolveSeatMoves(
	db: Db,
	args: {
		sessionId: number
		callerId: number
		isOwner: boolean
		moves: Sockets.Sessions.Update.Params["seatMoves"]
	}
): Promise<
	{ ok: false; refusal: string } | { ok: true; writes: SeatMoveWrite[] }
> {
	const { sessionId, isOwner } = args
	const writes: SeatMoveWrite[] = []
	const moves = args.moves ?? []
	if (!moves.length) return { ok: true, writes }
	const refuse = (refusal: string) => ({ ok: false as const, refusal })
	const R = SEAT_MOVE_REFUSALS
	if (!isOwner)
		return refuse(
			moves.some((m) => "playerSeatId" in m)
				? R.ownerOnly
				: R.ownerOnlyToPerson
		)

	const seenPlayer = new Set<number>()
	const seenCharacter = new Set<number>()
	let toAi = 0
	let toPerson = 0
	for (const m of moves) {
		if ("playerSeatId" in m) {
			const id = m.playerSeatId
			if (seenPlayer.has(id)) continue
			seenPlayer.add(id)
			const checked = await seatMoveCheck(db, sessionId, id)
			if (!checked.ok) return refuse(checked.refusal)
			writes.push({
				to: "character",
				playerSeatId: id,
				seen: {
					personaId: checked.seat.personaId,
					castMemberId: checked.seat.castMemberId
				}
			})
			toAi++
		} else {
			const id = m.characterSeatId
			if (seenCharacter.has(id)) continue
			seenCharacter.add(id)
			const checked = await seatMoveToPersonCheck(
				db,
				sessionId,
				id,
				m.toUserId
			)
			if (!checked.ok) return refuse(checked.refusal)
			writes.push({
				to: "player",
				characterSeatId: id,
				toUserId: m.toUserId,
				seen: {
					characterId: checked.seat.characterId,
					castMemberId: checked.seat.castMemberId
				}
			})
			toPerson++
		}
	}
	const shape = await seatKindAddRefusal(db, sessionId, {
		characters: toAi,
		personas: toPerson
	})
	if (shape) return refuse(shape)
	return { ok: true, writes }
}

/**
 * 🚧 The sentences of opening a persona for someone (★ copy; owner rulings S1,
 * PS1, 2026-11-17). Those of a handover are reused where they say the same.
 */
export const PLAYER_SEATS_FOR_REFUSALS = {
	oneKey: "Pick one character, cast member or seat name to seat.",
	notYourCard: (name: string): string =>
		`${name} is not your card, so it can't be seated for someone else.`,
	alreadySeated: (name: string): string =>
		`${name} already has a seat in this session.`,
	blankName: "A new character needs a name."
} as const

/** One checked entry of `playerSeatsFor`, ready to write. */
export type PlayerSeatForWrite = {
	toUserId: number
	/** The owner's card seated linked, directly or as the member's linked card. */
	cardId: number | null
	/** The member seated, when the entry named one. */
	castMemberId: number | null
	/** A new named card-less seat, or a card-less member's shown name. */
	seatName: string | null
}

/**
 * Checks every `playerSeatsFor` entry of a save before any is written; reads
 * only, the first refusal wins. The session's owner opens a seat for someone
 * who is in the session and plays: one of their own cards (seated linked), a
 * cast member of the session's books, or a new named seat. A card or member
 * that a live seat already holds is refused.
 */
export async function resolvePlayerSeatsFor(
	db: Db,
	args: {
		sessionId: number
		callerId: number
		isOwner: boolean
		entries: Sockets.Sessions.Update.Params["playerSeatsFor"]
	}
): Promise<
	{ ok: false; refusal: string } | { ok: true; seats: PlayerSeatForWrite[] }
> {
	const { sessionId, isOwner } = args
	const entries = args.entries ?? []
	const seats: PlayerSeatForWrite[] = []
	if (!entries.length) return { ok: true, seats }
	const refuse = (refusal: string) => ({ ok: false as const, refusal })
	const R = SEAT_HANDOVER_REFUSALS
	const F = PLAYER_SEATS_FOR_REFUSALS
	if (!isOwner) return refuse(R.ownerOnly)

	const [session] = await db
		.select({ userId: schema.sessions.userId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	if (!session) return refuse(R.seatGone)
	const ownerId = session.userId
	const guests = await db
		.select({
			userId: schema.sessionGuests.userId,
			isPlayer: schema.sessionGuests.isPlayer
		})
		.from(schema.sessionGuests)
		.where(eq(schema.sessionGuests.sessionId, sessionId))
	const live = await db
		.select({
			cardId: schema.sessionPersonas.personaId,
			memberId: schema.sessionPersonas.castMemberId
		})
		.from(schema.sessionPersonas)
		.where(
			and(
				eq(schema.sessionPersonas.sessionId, sessionId),
				isNull(schema.sessionPersonas.removedAt)
			)
		)
	const heldCards = new Set(live.map((r) => r.cardId).filter((v) => v != null))
	const heldMembers = new Set(
		live.map((r) => r.memberId).filter((v) => v != null)
	)
	const book = entries.some((e) => e.castMemberId != null)
		? await seatBookOf(db, sessionId)
		: null

	for (const e of entries) {
		const given = [e.characterId, e.castMemberId, e.seatName].filter(
			(v) => v != null
		)
		if (given.length !== 1) return refuse(F.oneKey)

		const to = e.toUserId
		if (to !== ownerId) {
			const guest = guests.find((g) => g.userId === to)
			if (!guest) return refuse(R.notInSession)
			if (!guest.isPlayer) {
				const [u] = await db
					.select({
						displayName: schema.users.displayName,
						username: schema.users.username
					})
					.from(schema.users)
					.where(eq(schema.users.id, to))
					.limit(1)
				return refuse(
					R.watcher(
						u?.displayName?.trim() ||
							u?.username?.trim() ||
							"That person"
					)
				)
			}
		}

		if (e.seatName != null) {
			const name = e.seatName.trim()
			if (!name) return refuse(F.blankName)
			seats.push({ toUserId: to, cardId: null, castMemberId: null, seatName: name })
			continue
		}

		let cardId: number | null = e.characterId ?? null
		let memberId: number | null = null
		let memberName: string | null = null
		if (e.castMemberId != null) {
			if (!book) return refuse(SEAT_REFUSALS.memberGone())
			const checked = await checkSeatMember(db, book, e.castMemberId)
			if (!checked.ok) return refuse(checked.refusal)
			memberId = e.castMemberId
			cardId = checked.characterId
			const read = (
				await membersAsRead(db, [memberId], { sessionId })
			).get(memberId)
			memberName = read?.shownName?.trim() || "That person"
		}
		if (cardId != null) {
			const [card] = await db
				.select({ userId: schema.characters.userId })
				.from(schema.characters)
				.where(eq(schema.characters.id, cardId))
				.limit(1)
			const name =
				memberName ??
				resolveCharacterName(
					(await cardsNow(db, [cardId])).get(cardId),
					"That card"
				)
			if (!card || card.userId !== ownerId)
				return refuse(F.notYourCard(name))
			if (heldCards.has(cardId) || (memberId != null && heldMembers.has(memberId)))
				return refuse(F.alreadySeated(name))
			heldCards.add(cardId)
			if (memberId != null) heldMembers.add(memberId)
			seats.push({ toUserId: to, cardId, castMemberId: memberId, seatName: null })
			continue
		}
		// A card-less member.
		if (heldMembers.has(memberId!)) return refuse(F.alreadySeated(memberName!))
		heldMembers.add(memberId!)
		seats.push({
			toUserId: to,
			cardId: null,
			castMemberId: memberId,
			seatName: memberName
		})
	}
	return { ok: true, seats }
}
