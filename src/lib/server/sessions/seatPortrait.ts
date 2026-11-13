/**
 * 🚧 The write half of a **seat portrait** (PLAN-sheet-widget-redesign §12,
 * 2026-10-17): the one picture every widget draws for a player seat —
 * `session_personas.portrait_media_id` — set by the `set-owner-face` widget
 * request through `state:setOwnerFace`.
 *
 * Who: the seat's own player for their own seat, the session's owner for
 * any; nobody else. Which picture: one the session may show — the rule a
 * backdrop's file keeps (`backdropFileFor`: the session's, the person's own
 * uploads, one already shown here, or a cast member's gallery image). Null
 * clears it, and the seat falls back to its card's art (or none).
 *
 * The world and a place have no face; a cast member who is no player seat
 * shows its card's art, which is the card's to change, never this write's.
 */

import { and, eq, isNull } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { BackdropRefusal, backdropFileFor } from "./backdrop"
import { memberAsRead } from "$lib/server/cast/memberAsRead"
import { storedSeatOwner } from "$lib/server/state/seatRefs"

/** Thrown with the sentence the caller shows. */
export class SeatPortraitRefusal extends Error {}

/** The owner a face is set for (`OwnerRefV1`). */
export interface FaceOwner {
	kind: "session" | "session_cast" | "player_seat" | "session_location"
	id: number
}

/**
 * Set or clear one seat's portrait. Returns the seat's id and the file now
 * on it; refuses, in words, everything else.
 */
export async function writeSeatPortrait(
	db: Db,
	params: {
		sessionId: number
		userId: number
		isOwner: boolean
		/** 🚧 Or a `seated_member` owner (plan §27 S2), read as its seat's stored one. */
		owner: FaceOwner | { kind: "seated_member"; id: number }
		mediaRef: string | null
	}
): Promise<{ playerSeatId: number; portraitMediaId: number | null }> {
	const { sessionId, userId, isOwner } = params
	// 🚧 A member with no seat in the session is a seat that is gone.
	const stored = (await storedSeatOwner(db, sessionId, params.owner)) as FaceOwner | null
	if (!stored) throw new SeatPortraitRefusal("That seat is no longer in this session.")
	const owner = stored
	if (owner.kind === "session" || owner.kind === "session_location")
		throw new SeatPortraitRefusal("The world and its places have no face to set.")
	if (owner.kind !== "session_cast" && owner.kind !== "player_seat")
		throw new SeatPortraitRefusal("That is not an owner in this session.")
	const [seat] = await db
		.select({
			id: schema.sessionPersonas.id,
			userId: schema.sessionPersonas.userId,
			personaId: schema.sessionPersonas.personaId,
			castMemberId: schema.sessionPersonas.castMemberId,
			cardOwner: schema.characters.userId
		})
		.from(schema.sessionPersonas)
		.leftJoin(schema.characters, eq(schema.characters.id, schema.sessionPersonas.personaId))
		.where(
			and(
				eq(schema.sessionPersonas.sessionId, sessionId),
				isNull(schema.sessionPersonas.removedAt),
				owner.kind === "player_seat"
					? eq(schema.sessionPersonas.id, owner.id)
					: eq(schema.sessionPersonas.personaId, owner.id)
			)
		)
		.limit(1)
	if (!seat)
		throw new SeatPortraitRefusal(
			owner.kind === "player_seat"
				? "That seat is no longer in this session."
				: "Only a player's seat has a portrait to set; a character's face is its card's picture."
		)
	// 🚧 Whose card the seat is: its cast member's active card, else the card as today;
	// a card-less member has no card to read and falls back to the seat's.
	let cardOwner = seat.cardOwner
	if (seat.castMemberId != null && seat.personaId != null) {
		const read = await memberAsRead(db, seat.castMemberId, { sessionId })
		if (read?.activeCardId != null && read.activeCardId !== seat.personaId) {
			const [card] = await db
				.select({ userId: schema.characters.userId })
				.from(schema.characters)
				.where(eq(schema.characters.id, read.activeCardId))
				.limit(1)
			cardOwner = card?.userId ?? null
		}
	}
	if (!isOwner && (seat.userId ?? cardOwner) !== userId)
		throw new SeatPortraitRefusal("Only that seat's player or the session's owner can change its portrait.")

	let portraitMediaId: number | null = null
	if (params.mediaRef !== null) {
		if (typeof params.mediaRef !== "string" || !params.mediaRef.trim())
			throw new SeatPortraitRefusal("Name the picture by its id, or nothing to clear the portrait.")
		let file: { id: number } | null
		try {
			file = await backdropFileFor(db, params.mediaRef, { sessionId, userId, castImages: true })
		} catch (e) {
			if (e instanceof BackdropRefusal)
				throw new SeatPortraitRefusal("That picture belongs to neither this session nor you, so it cannot be a portrait here.")
			throw e
		}
		if (!file) throw new SeatPortraitRefusal("That picture is not an image this session can show.")
		portraitMediaId = file.id
	}
	await db
		.update(schema.sessionPersonas)
		.set({ portraitMediaId })
		.where(eq(schema.sessionPersonas.id, seat.id))
	return { playerSeatId: seat.id, portraitMediaId }
}
