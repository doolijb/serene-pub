/**
 * 🚧 The write half of a **seat name** (2026-10-14): a player's character
 * name in ONE session, on their player seat (the `session_personas` row, `seat_name`), set
 * without a card. A seat with no card (`persona_id` null) is a player
 * character that exists only in this session; its stats are written against
 * the `player_seat` owner (`state/owners.ts`), by the same row's id.
 *
 * The read half is the client's speaker resolution (`messageSpeaker`,
 * `personLineOf`): a seat name wins over the voiced card's name and the
 * genre's player label.
 */

import { and, desc, eq, isNull, sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"

export { isCardlessPlayerSeat } from "$lib/shared/sessions/playerSeat"
import { ownCardlessPlayerSeats } from "$lib/shared/sessions/playerSeat"

/**
 * 🚧 A seat's card as the prompt reads it: a seat name wins over the card's
 * name (the card still lends the rest). Applied once, where a read takes
 * the seats in (`loadAdapterSession`, the host's cast read).
 */
export const withSeatName = <P extends { name?: string } | null | undefined>(
	persona: P,
	seatName: string | null | undefined
): P => (persona && seatName?.trim() ? { ...persona, name: seatName.trim() } : persona)

/** Thrown with the sentence the caller shows. */
export class SeatNameRefusal extends Error {}

/**
 * Set (trimmed, non-blank) or clear (blank or null) a seat's name.
 *
 * - `playerSeatId` given: that seat, which must be a live seat of this session —
 *   the session's owner may name any seat; anyone else only their own (its
 *   `user_id`, or, on a row from before that column, the voiced card's
 *   owner).
 * - `playerSeatId` absent: the caller's own seat — their card-less one first,
 *   else their first by position. With none, a name opens a card-less player seat
 *   for them (a player only: the owner, or a guest who plays); clearing
 *   with no seat does nothing.
 *
 * Returns the seat's id, or null when nothing was there to clear.
 */
export async function writeSeatName(
	db: Db,
	params: {
		sessionId: number
		userId: number
		isOwner: boolean
		playerSeatId?: number | null
		name: string | null
		/**
		 * 🚧 One of the person's own live seats this name replaces (a new
		 * character after a death, owner ruling 2026-10-18): it leaves the
		 * table — `removed_at` set, its row and so its lines' name kept — and
		 * the name opens a NEW card-less seat for them.
		 */
		retireSeatId?: number | null
	}
): Promise<number | null> {
	const { sessionId, userId, isOwner } = params
	const name = params.name?.trim() || null
	if (params.retireSeatId != null) {
		if (!name) throw new SeatNameRefusal("A new character needs a name.")
		return await db.transaction(async (tx) => {
			const t = tx as unknown as Db
			const [old] = await t
				.select({
					id: schema.sessionPersonas.id,
					userId: schema.sessionPersonas.userId,
					cardUserId: schema.characters.userId,
					removedAt: schema.sessionPersonas.removedAt
				})
				.from(schema.sessionPersonas)
				.leftJoin(schema.characters, eq(schema.characters.id, schema.sessionPersonas.personaId))
				.where(
					and(
						eq(schema.sessionPersonas.sessionId, sessionId),
						eq(schema.sessionPersonas.id, params.retireSeatId!)
					)
				)
				.limit(1)
			if (!old || old.removedAt) throw new SeatNameRefusal("That seat is not at this table any more.")
			if ((old.userId ?? old.cardUserId) !== userId)
				throw new SeatNameRefusal("Only your own character's seat can make way for a new one.")
			await t
				.update(schema.sessionPersonas)
				.set({ removedAt: new Date() })
				.where(eq(schema.sessionPersonas.id, old.id))
			const [last] = await t
				.select({ position: schema.sessionPersonas.position })
				.from(schema.sessionPersonas)
				.where(eq(schema.sessionPersonas.sessionId, sessionId))
				.orderBy(desc(schema.sessionPersonas.position))
				.limit(1)
			const [created] = await t
				.insert(schema.sessionPersonas)
				.values({
					sessionId,
					personaId: null,
					userId,
					seatName: name,
					position: (last?.position ?? -1) + 1
				})
				.returning({ id: schema.sessionPersonas.id })
			return created.id
		})
	}

	const seats = await db
		.select({
			id: schema.sessionPersonas.id,
			personaId: schema.sessionPersonas.personaId,
			userId: schema.sessionPersonas.userId,
			cardUserId: schema.characters.userId,
			position: schema.sessionPersonas.position
		})
		.from(schema.sessionPersonas)
		.leftJoin(
			schema.characters,
			eq(schema.characters.id, schema.sessionPersonas.personaId)
		)
		.where(
			and(
				eq(schema.sessionPersonas.sessionId, sessionId),
				isNull(schema.sessionPersonas.removedAt)
			)
		)
	const whose = (s: (typeof seats)[number]) => s.userId ?? s.cardUserId

	let seat: (typeof seats)[number] | undefined
	if (params.playerSeatId != null) {
		seat = seats.find((s) => s.id === params.playerSeatId)
		if (!seat) throw new SeatNameRefusal("That seat is not in this session.")
		if (!isOwner && whose(seat) !== userId)
			throw new SeatNameRefusal("You can only name your own seat.")
	} else {
		const mine = seats
			.filter((s) => whose(s) === userId)
			.sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
		seat = mine.find((s) => s.personaId === null) ?? mine[0]
	}

	if (seat) {
		await db
			.update(schema.sessionPersonas)
			.set({
				seatName: name,
				// A row from before `user_id`: its user is the card's owner.
				...(seat.userId === null && seat.cardUserId !== null
					? { userId: seat.cardUserId }
					: {})
			})
			.where(eq(schema.sessionPersonas.id, seat.id))
		return seat.id
	}

	if (!name) return null
	if (!isOwner) {
		const [guest] = await db
			.select({ isPlayer: schema.sessionGuests.isPlayer })
			.from(schema.sessionGuests)
			.where(
				and(
					eq(schema.sessionGuests.sessionId, sessionId),
					eq(schema.sessionGuests.userId, userId)
				)
			)
			.limit(1)
		if (!guest?.isPlayer)
			throw new SeatNameRefusal("Only a player of this session can take a seat.")
	}
	const [last] = await db
		.select({ position: schema.sessionPersonas.position })
		.from(schema.sessionPersonas)
		.where(eq(schema.sessionPersonas.sessionId, sessionId))
		.orderBy(desc(schema.sessionPersonas.position))
		.limit(1)
	const [created] = await db
		.insert(schema.sessionPersonas)
		.values({
			sessionId,
			personaId: null,
			userId,
			seatName: name,
			position: (last?.position ?? -1) + 1
		})
		.returning({ id: schema.sessionPersonas.id })
	return created.id
}

/**
 * 🚧 The caller's card-less player seat in this session — the one a line they send
 * with no persona is sent from, stamped on it as `speaker: player-seat:<id>` so the
 * turn order reads it as that seat's turn. The first by position
 * (`isCardlessPlayerSeat`); null when they have none.
 */
export async function cardlessPlayerSeatOf(
	db: Db,
	sessionId: number,
	userId: number
): Promise<number | null> {
	const rows = await db
		.select({
			id: schema.sessionPersonas.id,
			personaId: schema.sessionPersonas.personaId,
			userId: schema.sessionPersonas.userId,
			seatName: schema.sessionPersonas.seatName,
			removedAt: schema.sessionPersonas.removedAt
		})
		.from(schema.sessionPersonas)
		.where(
			and(
				eq(schema.sessionPersonas.sessionId, sessionId),
				eq(schema.sessionPersonas.userId, userId)
			)
		)
		.orderBy(schema.sessionPersonas.position, schema.sessionPersonas.id)
	// The page's send gate reads the same rule (`ownCardlessPlayerSeats`).
	return ownCardlessPlayerSeats(rows, userId)[0]?.id ?? null
}

/** 🚧 The reference a card-less player seat's line is stamped with (`metadata.speaker`). */
export const playerSeatSpeaker = (seatId: number): string => `player-seat:${seatId}`

/** 🚧 The seat a `metadata.speaker` names (`player-seat:<id>`), else null. */
export function playerSeatIdOfSpeaker(speaker: unknown): number | null {
	if (typeof speaker !== "string") return null
	const m = /^player-seat:(\d+)$/.exec(speaker)
	return m ? Number(m[1]) : null
}

/**
 * 🚧 Give a card-less player seat a card: when the card's owner has a card-less
 * seat in this session (`cardlessPlayerSeatOf`) and the card has no row here yet,
 * that seat takes the card — its `persona_id` filled, its `player_seat` stat rows
 * moved to the card's session layer (`session_cast`) with its pending
 * proposals, and the lines it sent restamped as the card's — so the seat keeps its
 * name, its place and its stats, and its reference becomes the card's
 * (`character:<id>`). Returns whether a seat took it; on false the caller
 * seats the card on a row of its own, as before.
 */
export async function givePlayerSeatACard(
	db: Db,
	sessionId: number,
	personaId: number
): Promise<boolean> {
	const [card] = await db
		.select({ userId: schema.characters.userId })
		.from(schema.characters)
		.where(eq(schema.characters.id, personaId))
		.limit(1)
	if (card?.userId == null) return false
	const [taken] = await db
		.select({ id: schema.sessionPersonas.id })
		.from(schema.sessionPersonas)
		.where(
			and(
				eq(schema.sessionPersonas.sessionId, sessionId),
				eq(schema.sessionPersonas.personaId, personaId)
			)
		)
		.limit(1)
	if (taken) return false
	const seatId = await cardlessPlayerSeatOf(db, sessionId, card.userId)
	if (seatId == null) return false
	await db.transaction(async (tx) => {
		await tx
			.update(schema.sessionPersonas)
			.set({ personaId })
			.where(eq(schema.sessionPersonas.id, seatId))
		for (const table of [schema.attributeValues, schema.attributeConfigs, schema.ownerSheets])
			await tx
				.update(table)
				.set({ ownerKind: "session_cast", ownerId: personaId })
				.where(
					and(
						eq(table.ownerKind, "player_seat"),
						eq(table.ownerId, seatId),
						eq(table.sessionId, sessionId)
					)
				)
		// Its waiting stat changes follow its stats: a pending proposal's
		// owner is in its payload (`{ owner: { kind, id }, … }`).
		await tx
			.update(schema.stateProposals)
			.set({
				payload: sql`jsonb_set(${schema.stateProposals.payload}, '{owner}', jsonb_build_object('kind', 'session_cast', 'id', ${personaId}::int))`
			})
			.where(
				and(
					eq(schema.stateProposals.sessionId, sessionId),
					eq(schema.stateProposals.status, "pending"),
					sql`${schema.stateProposals.payload}->'owner'->>'kind' = 'player_seat'`,
					sql`${schema.stateProposals.payload}->'owner'->>'id' = ${String(seatId)}`
				)
			)
		// …and the lines it sent before: a carded seat is never `player-seat:<id>`,
		// so each becomes what a line sent as the card is — `persona_id` set,
		// no `speaker` — through the store, which re-mirrors it.
		const { updateLegacy } = await import("$lib/server/messages/store")
		const lines = await tx
			.select({ id: schema.sessionMessages.id, metadata: schema.sessionMessages.metadata })
			.from(schema.sessionMessages)
			.where(
				and(
					eq(schema.sessionMessages.sessionId, sessionId),
					sql`${schema.sessionMessages.metadata}->>'speaker' = ${playerSeatSpeaker(seatId)}`
				)
			)
		for (const line of lines) {
			if (playerSeatIdOfSpeaker(line.metadata?.speaker) !== seatId) continue
			const { speaker: _speaker, ...metadata } = line.metadata ?? {}
			await updateLegacy(tx, line.id, { personaId, metadata })
		}
	})
	return true
}

/**
 * 🚧 Edit Session's card-less player seats: each renamed (a non-blank
 * `seatName`) or removed (`remove`: soft, `removed_at` and `removed_name`,
 * so its lines keep their name). The session's owner may edit any seat;
 * anyone else only their own (`user_id`). Refuses a seat that is not a live
 * card-less player seat of this session — a seat with a card is edited as
 * its card. Returns the ids removed, for the caller's `member-removed`.
 */
export async function editCardlessPlayerSeats(
	db: Db,
	params: {
		sessionId: number
		userId: number
		isOwner: boolean
		changes: ReadonlyArray<{ playerSeatId: number; seatName?: string; remove?: boolean }>
	}
): Promise<number[]> {
	const { sessionId, userId, isOwner } = params
	if (!params.changes.length) return []
	const seats = await db
		.select({
			id: schema.sessionPersonas.id,
			personaId: schema.sessionPersonas.personaId,
			userId: schema.sessionPersonas.userId,
			seatName: schema.sessionPersonas.seatName,
			removedAt: schema.sessionPersonas.removedAt
		})
		.from(schema.sessionPersonas)
		.where(eq(schema.sessionPersonas.sessionId, sessionId))
	const removed: number[] = []
	for (const change of params.changes) {
		const seat = seats.find((s) => s.id === change.playerSeatId)
		if (!seat || seat.removedAt || seat.personaId !== null)
			throw new SeatNameRefusal("That player seat is not in this session.")
		if (!isOwner && seat.userId !== userId)
			throw new SeatNameRefusal("You can only change your own seat.")
		if (change.remove) {
			await db
				.update(schema.sessionPersonas)
				.set({ removedAt: new Date(), removedName: seat.seatName })
				.where(eq(schema.sessionPersonas.id, seat.id))
			removed.push(seat.id)
			continue
		}
		const name = change.seatName?.trim()
		if (name && name !== seat.seatName)
			await db
				.update(schema.sessionPersonas)
				.set({ seatName: name })
				.where(eq(schema.sessionPersonas.id, seat.id))
	}
	return removed
}
