/**
 * The session's participants and seats: adding a persona, reassigning a
 * removed participant's lines, enabling a cast seat, and the
 * account-visibility view.
 */

import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { updateLegacyWhere } from "$lib/server/messages/store"
import { and, desc, eq, inArray, isNull } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import { markCharacterAsPersona } from "$lib/server/utils/markCharacterAsPersona"
import {
	announceSeatChanges,
	seatCast,
	seatOf,
	seatPlayer,
	settleSeats,
	syncMintedSeatMembers,
	setSeatBench,
	type MintedSeatMember,
	type SeatChange
} from "$lib/server/sessions/seats"
import {
	castToTakeOf,
	guestSeatSwitchesOf,
	seatKindAddRefusal
} from "$lib/server/sessions/guestSeats"
import { GUEST_SEAT_SENTENCES } from "$lib/shared/sessions/guestSeats"
import type { Handler } from "$lib/shared/events"
import { checkSessionAccess } from "$lib/server/utils/sessionAccess"
import {
	checkCharacterOwnership,
	checkPersonaOwnership,
	getSessionFromDB,
	resendSession,
	broadcastSessionToParticipants,
	pushSessionToParticipants,
	runLorebookBindingCheck
} from "./sessions.shared"

/**
 * `characters`, joined a SECOND time as the voiced side.
 *
 * `session_messages.persona_id` and `session_personas.persona_id` both point at
 * `characters`, so a query that reads the cast AND the voice has to name the
 * table twice — one join cannot answer for both, and without the alias the
 * second one silently overwrites the first.
 */
const voicedCharacter = alias(schema.characters, "voiced_character")

export const sessionsAddPersonaHandler: Handler<
	Sockets.Sessions.AddPersona.Params,
	Sockets.Sessions.AddPersona.Response
> = {
	event: "sessions:addPersona",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = socket.user!.id
			const { sessionId, personaId } = params

			// Check if user has access to this session
			const sessionAccess = await checkSessionAccess(sessionId, userId)
			if (!sessionAccess.hasAccess) {
				const res: Sockets.Sessions.AddPersona.Response = {
					success: false,
					error: "Access denied. Session not found or no permission to access."
				}
				emitToUser("sessions:addPersona", res)
				return res
			}

			// 🚧 Guests bring their own characters only when the owner lets them
			// (owner ruling G3); this covers bringing a benched seat back too.
			if (
				!sessionAccess.isOwner &&
				!(await guestSeatSwitchesOf(db, sessionId)).bringOwn
			) {
				const res: Sockets.Sessions.AddPersona.Response = {
					success: false,
					error: GUEST_SEAT_SENTENCES.bringOwnOff
				}
				emitToUser("sessions:addPersona", res)
				return res
			}

			// Check if user owns the persona they're trying to add
			const ownsPersona = await checkPersonaOwnership(personaId, userId)
			if (!ownsPersona) {
				const res: Sockets.Sessions.AddPersona.Response = {
					success: false,
					error: "Access denied. You can only add personas you own."
				}
				emitToUser("sessions:addPersona", res)
				return res
			}

			// Check if persona is already in the session
			const existingSessionPersona =
				await db.query.sessionPersonas.findFirst({
					where: and(
						eq(schema.sessionPersonas.sessionId, sessionId),
						eq(schema.sessionPersonas.personaId, personaId)
					)
				})

			// A benched seat comes back rather than being refused (benched seats).
			if (
				existingSessionPersona &&
				existingSessionPersona.removedAt == null &&
				existingSessionPersona.isActive === false
			) {
				const back = await db.transaction(async (tx) =>
					setSeatBench(tx as unknown as Db, {
						sessionId,
						kind: "player",
						seatId: existingSessionPersona.id,
						benched: false
					})
				)
				if (!back.ok) {
					const res: Sockets.Sessions.AddPersona.Response = {
						success: false,
						error: back.refusal
					}
					emitToUser("sessions:addPersona", res)
					return res
				}
				await announceSeatChanges(
					db,
					socket.io,
					{ sessionId, userId },
					back.changes
				)
				await broadcastSessionToParticipants(socket, sessionId, userId)
				await (
					await import("$lib/server/sessions/actionsPush")
				).pushSessionActions(socket.io, sessionId)
				const res: Sockets.Sessions.AddPersona.Response = {
					success: true
				}
				emitToUser("sessions:addPersona", res)
				return res
			}

			if (existingSessionPersona) {
				const res: Sockets.Sessions.AddPersona.Response = {
					success: false,
					error: "This persona is already in the session."
				}
				emitToUser("sessions:addPersona", res)
				return res
			}

			// 🚧 The genre's opt-in: a NEW persona seat only where it has personas.
			const notFit = await seatKindAddRefusal(db, sessionId, {
				characters: 0,
				personas: 1
			})
			if (notFit) {
				const res: Sockets.Sessions.AddPersona.Response = {
					success: false,
					error: notFit
				}
				emitToUser("sessions:addPersona", res)
				return res
			}

			// Get the next position
			const maxPosition = await db
				.select({ maxPos: schema.sessionPersonas.position })
				.from(schema.sessionPersonas)
				.where(eq(schema.sessionPersonas.sessionId, sessionId))
				.orderBy(desc(schema.sessionPersonas.position))
				.limit(1)

			const nextPosition = maxPosition[0]?.maxPos
				? maxPosition[0].maxPos + 1
				: 0

			// Add persona to session — 🚧 into its player's card-less player seat
			// when they have one (`givePlayerSeatACard`), else on a row of its own.
			const { givePlayerSeatACard } = await import("$lib/server/sessions/seatName")
			const seatChanges: SeatChange[] = []
			if (await givePlayerSeatACard(db, sessionId, personaId)) {
				// The seat now has a card: it gets its cast member.
				const settled = await db.transaction(async (tx) =>
					settleSeats(tx as unknown as Db, sessionId)
				)
				seatChanges.push(...settled.changes)
				await syncMintedSeatMembers(db, settled.mintedMembers)
			} else {
				const seat = await db.transaction(async (tx) =>
					seatPlayer(tx as unknown as Db, {
						sessionId,
						personaId,
						position: nextPosition,
						onExisting: "insert"
					})
				)
				seatChanges.push(...seat.changes)
				await syncMintedSeatMembers(db, seat.mintedMembers)
			}
			await markCharacterAsPersona(personaId)

			// A member added to a session that reads a book joins that book's
			// cast (ruling 2026-09-12).
			const bookForPersona = await db.query.sessions.findFirst({
				where: eq(schema.sessions.id, sessionId),
				columns: { lorebookId: true }
			})
			if (bookForPersona?.lorebookId) {
				await runLorebookBindingCheck(
					socket,
					sessionId,
					bookForPersona.lorebookId,
					emitToUser
				).catch(console.error)
			}

			// The seat has landed: `member-added` (a card-less seat taking this
			// card changes no seat's ref, so says nothing).
			await announceSeatChanges(db, socket.io, { sessionId, userId }, seatChanges)

			// Broadcast updated session to all participants
			await broadcastSessionToParticipants(socket, sessionId, userId)
			// A member joined (U5e, review W-A5): the audience and the cast
			// a predicate may read both moved, so every member's list follows.
			await (
				await import("$lib/server/sessions/actionsPush")
			).pushSessionActions(socket.io, sessionId)

			const res: Sockets.Sessions.AddPersona.Response = {
				success: true
			}
			emitToUser("sessions:addPersona", res)
			return res
		} catch (error: any) {
			console.error("Error adding persona to session:", error)
			const res: Sockets.Sessions.AddPersona.Response = {
				success: false,
				error: "Failed to add persona to session"
			}
			emitToUser("sessions:addPersona:error", res)
			throw error
		}
	}
}

/**
 * Re-points a removed (soft-deleted) or benched session participant's message
 * history to a new character/persona, and makes the new one an active participant — the
 * "adopt this removed participant's history" flow paired with the soft
 * delete in sessionsUpdateHandler. Permission mirrors the removal path: the
 * session owner can reassign anyone's removed slot; a non-owner can only
 * reassign a removed slot they themselves originally owned (once the
 * underlying entity is globally deleted there's no more "original owner" to
 * check against, so only the session owner can act at that point).
 */
export const sessionsReassignRemovedParticipantHandler: Handler<
	Sockets.Sessions.ReassignRemovedParticipant.Params,
	Sockets.Sessions.ReassignRemovedParticipant.Response
> = {
	event: "sessions:reassignRemovedParticipant",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = socket.user!.id
			const { sessionId, type, oldId, newId } = params

			const sessionAccess = await checkSessionAccess(sessionId, userId)
			if (!sessionAccess.hasAccess) {
				const res: Sockets.Sessions.ReassignRemovedParticipant.Response =
					{
						error: "Access denied. Session not found or no permission to access."
					}
				emitToUser("sessions:reassignRemovedParticipant", res)
				return res
			}

			// 🚧 A guest swaps in their own only when the owner lets them (G3).
			if (
				!sessionAccess.isOwner &&
				!(await guestSeatSwitchesOf(db, sessionId)).bringOwn
			) {
				const res: Sockets.Sessions.ReassignRemovedParticipant.Response = {
					error: GUEST_SEAT_SENTENCES.bringOwnOff
				}
				emitToUser("sessions:reassignRemovedParticipant", res)
				return res
			}
			/**
			 * 🚧 The genre's opt-in, the owner's too: only a REMOVED seat taken
			 * back adds one. A benched seat's swap keeps the count, so it is an
			 * existing seat and never re-checked.
			 */
			const notFit = async (removed: boolean) => {
				if (!removed) return false
				const refusal = await seatKindAddRefusal(db, sessionId, {
					characters: type === "character" ? 1 : 0,
					personas: type === "character" ? 0 : 1
				})
				if (!refusal) return false
				const res: Sockets.Sessions.ReassignRemovedParticipant.Response = {
					error: refusal
				}
				emitToUser("sessions:reassignRemovedParticipant", res)
				return res
			}

			if (oldId === newId) {
				const res: Sockets.Sessions.ReassignRemovedParticipant.Response =
					{
						error: "Cannot reassign a removed participant to themselves — re-add them normally instead."
					}
				emitToUser("sessions:reassignRemovedParticipant", res)
				return res
			}

			if (type === "character") {
				const removedCC = await db.query.sessionCharacters.findFirst({
					where: (cc, { and, eq, isNotNull, or }) =>
						and(
							eq(cc.sessionId, sessionId),
							eq(cc.characterId, oldId),
							or(isNotNull(cc.removedAt), eq(cc.isActive, false))
						),
					with: { character: { columns: { id: true, userId: true } } }
				})
				if (!removedCC) {
					const res: Sockets.Sessions.ReassignRemovedParticipant.Response =
						{
							error: "Removed character not found in this session."
						}
					emitToUser("sessions:reassignRemovedParticipant", res)
					return res
				}

				const canReassign =
					sessionAccess.isOwner ||
					removedCC.character?.userId === userId
				if (!canReassign) {
					const res: Sockets.Sessions.ReassignRemovedParticipant.Response =
						{
							error: "Access denied. Only the session owner or this character's original owner can reassign it."
						}
					emitToUser("sessions:reassignRemovedParticipant", res)
					return res
				}

				const unfit = await notFit(removedCC.removedAt != null)
				if (unfit) return unfit

				const ownsNewTarget = await checkCharacterOwnership(
					newId,
					userId
				)
				if (!ownsNewTarget) {
					const res: Sockets.Sessions.ReassignRemovedParticipant.Response =
						{
							error: "Access denied. You can only reassign to a character you own."
						}
					emitToUser("sessions:reassignRemovedParticipant", res)
					return res
				}

				// Atomic: bulk-reassign history, upsert the new active
				// participant, and remove the old slot all-or-nothing. A
				// crash between these steps would otherwise either leave
				// messages repointed with the old removed row still
				// lingering, or — the dangerous ordering — delete the old
				// row while messages still reference it, which nulls out
				// via onDelete: "set null" and reverts to "Unknown": the
				// exact data loss this handler exists to prevent.
				// A refused seat (a second card of a member already seated —
				// `seatCast`) rolls the whole transaction back and is answered
				// in its own words.
				const refused: { sentence?: string } = {}
				let reassignedMinted: MintedSeatMember[] = []
				let reassignedChanges: SeatChange[] = []
				try {
					await db.transaction(async (tx) => {
						const seat = await seatCast(tx as unknown as Db, {
							sessionId,
							cardId: newId,
							position: removedCC.position ?? 0,
							seatedBy: userId
						})
						if (!seat.ok) {
							refused.sentence = seat.refusal
							throw new Error(seat.refusal)
						}
						reassignedMinted = seat.mintedMembers
						reassignedChanges = seat.changes
						// The lines are now spoken by the new seat: stamp
						// its member (the seat is written first, so it is
						// there to be read).
						await updateLegacyWhere(
							tx,
							and(
								eq(schema.sessionMessages.sessionId, sessionId),
								eq(schema.sessionMessages.characterId, oldId)
							),
							{
								characterId: newId,
								castMemberId:
									(
										await seatOf(
											tx as unknown as Db,
											sessionId,
											`character:${newId}`
										)
									)?.castMemberId ?? null
							}
						)
						await tx
							.delete(schema.sessionCharacters)
							.where(
								and(
									eq(
										schema.sessionCharacters.sessionId,
										sessionId
									),
									eq(schema.sessionCharacters.characterId, oldId)
								)
							)
					})
				} catch (e) {
					if (refused.sentence === undefined) throw e
					const res: Sockets.Sessions.ReassignRemovedParticipant.Response =
						{ error: refused.sentence }
					emitToUser("sessions:reassignRemovedParticipant", res)
					return res
				}
				// A benched seat was live: deleting it takes its member off the
				// roster, so say so (a removed row left the roster already).
				if (removedCC.removedAt === null)
					reassignedChanges.push({
						kind: "character",
						change: "removed",
						seatId: removedCC.id,
						castMemberId: removedCC.castMemberId ?? null,
						cardId: oldId
					})
				await syncMintedSeatMembers(db, reassignedMinted)
				await announceSeatChanges(
					db,
					socket.io,
					{ sessionId, userId },
					reassignedChanges
				)
			} else {
				const removedCP = await db.query.sessionPersonas.findFirst({
					where: (cp, { and, eq, isNotNull, or }) =>
						and(
							eq(cp.sessionId, sessionId),
							eq(cp.personaId, oldId),
							or(isNotNull(cp.removedAt), eq(cp.isActive, false))
						),
					with: { persona: { columns: { id: true, userId: true } } }
				})
				if (!removedCP) {
					const res: Sockets.Sessions.ReassignRemovedParticipant.Response =
						{ error: "Removed persona not found in this session." }
					emitToUser("sessions:reassignRemovedParticipant", res)
					return res
				}

				const canReassign =
					sessionAccess.isOwner ||
					removedCP.persona?.userId === userId
				if (!canReassign) {
					const res: Sockets.Sessions.ReassignRemovedParticipant.Response =
						{
							error: "Access denied. Only the session owner or this persona's original owner can reassign it."
						}
					emitToUser("sessions:reassignRemovedParticipant", res)
					return res
				}

				const unfit = await notFit(removedCP.removedAt != null)
				if (unfit) return unfit

				const ownsNewTarget = await checkPersonaOwnership(newId, userId)
				if (!ownsNewTarget) {
					const res: Sockets.Sessions.ReassignRemovedParticipant.Response =
						{
							error: "Access denied. You can only reassign to a persona you own."
						}
					emitToUser("sessions:reassignRemovedParticipant", res)
					return res
				}

				let reassignedMinted: MintedSeatMember[] = []
				let reassignedChanges: SeatChange[] = []
				await db.transaction(async (tx) => {
					const playerSeat = await seatPlayer(tx as unknown as Db, {
						sessionId,
						personaId: newId,
						position: removedCP.position ?? 0
					})
					reassignedMinted = playerSeat.mintedMembers
					reassignedChanges = playerSeat.changes
					// The lines are now spoken by the new player seat:
					// stamp the member that seat just took.
					await updateLegacyWhere(
						tx,
						and(
							eq(schema.sessionMessages.sessionId, sessionId),
							eq(schema.sessionMessages.personaId, oldId)
						),
						{
							personaId: newId,
							castMemberId: playerSeat.castMemberId
						}
					)
					await markCharacterAsPersona(newId, tx)
					await tx
						.delete(schema.sessionPersonas)
						.where(
							and(
								eq(schema.sessionPersonas.sessionId, sessionId),
								eq(schema.sessionPersonas.personaId, oldId)
							)
						)
				})
				// A benched seat was live: deleting it takes its member off the
				// roster, so say so (a removed row left the roster already).
				if (removedCP.removedAt === null)
					reassignedChanges.push({
						kind: "player",
						change: "removed",
						seatId: removedCP.id,
						castMemberId: removedCP.castMemberId ?? null,
						cardId: oldId
					})
				await syncMintedSeatMembers(db, reassignedMinted)
				await announceSeatChanges(
					db,
					socket.io,
					{ sessionId, userId },
					reassignedChanges
				)
			}

			// The replacement is a new member of this session, so it joins the
			// book's cast like any other (ruling 2026-09-12). The participant
			// it replaced keeps its binding: lore may be anchored to it.
			const bookForReassign = await db.query.sessions.findFirst({
				where: eq(schema.sessions.id, sessionId),
				columns: { lorebookId: true }
			})
			if (bookForReassign?.lorebookId) {
				await runLorebookBindingCheck(
					socket,
					sessionId,
					bookForReassign.lorebookId,
					emitToUser
				).catch(console.error)
			}

			// No rows: the reply's reader takes only `success` / `error`.
			const updatedSession = await getSessionFromDB(sessionId, userId, "none")
			const res: Sockets.Sessions.ReassignRemovedParticipant.Response = {
				success: true,
				session: updatedSession as any
			}
			emitToUser("sessions:reassignRemovedParticipant", res)
			if (updatedSession) {
				await pushSessionToParticipants(socket.io, sessionId, userId)
			}
			return res
		} catch (error: any) {
			console.error(
				"Error reassigning removed session participant:",
				error
			)
			const res: Sockets.Sessions.ReassignRemovedParticipant.Response = {
				error: "Failed to reassign removed participant."
			}
			emitToUser("sessions:reassignRemovedParticipant:error", res)
			throw error
		}
	}
}

/**
 * Switch one cast seat on or off — SET to `params.enabled`, never flipped
 * (note 34 follow-up): the Edit Session form holds the switch until Save,
 * so a flip from a stale form would invert the seat. A repeated set is a
 * no-op answered as a success. Every path answers the asker on this event,
 * refusals with `error` and the seat as it stands, so the form can close
 * on the answers (A24).
 */
export const sessionsSetCastSeatEnabledHandler: Handler<
	Sockets.Sessions.SetCastSeatEnabled.Params,
	Sockets.Sessions.SetCastSeatEnabled.Response
> = {
	event: "sessions:setCastSeatEnabled",
	handler: async (socket, params, emitToUser) => {
		const refuse = (error: string, enabled = false) => {
			const res: Sockets.Sessions.SetCastSeatEnabled.Response = {
				sessionId: params.sessionId,
				...(params.characterId != null
					? { characterId: params.characterId }
					: {}),
				...(params.castMemberId != null
					? { castMemberId: params.castMemberId }
					: {}),
				...(params.playerSeatId != null
					? { playerSeatId: params.playerSeatId }
					: {}),
				enabled,
				error
			}
			emitToUser("sessions:setCastSeatEnabled", res)
			return res
		}
		try {
			const userId = socket.user!.id
			if (typeof params.enabled !== "boolean")
				return refuse("Say whether the seat is switched on or off.")
			if (
				[params.characterId, params.castMemberId, params.playerSeatId].filter(
					(v) => v != null
				).length !== 1
			)
				return refuse(
					"Name one seat: a character, a cast member or a player seat."
				)

			// checkSessionAccess (owner OR guest), not an owner-only ad-hoc check —
			// a guest who brought their own character into a shared session must
			// be able to switch that character's own seat; only the per-row
			// escalation below decides whether *this* seat is theirs to manage.
			const sessionAccess = await checkSessionAccess(
				params.sessionId,
				userId
			)
			if (!sessionAccess.hasAccess) return refuse("Session not found.")

			let kind: "character" | "player" = "character"
			let seatId: number
			let seatIsActive: boolean
			let echo: Partial<Sockets.Sessions.SetCastSeatEnabled.Response>
			if (params.playerSeatId != null) {
				// A player seat (benched seats): by its own row, benched or in play.
				kind = "player"
				const [pseat] = await db
					.select({
						id: schema.sessionPersonas.id,
						isActive: schema.sessionPersonas.isActive,
						playerId: schema.sessionPersonas.userId,
						cardOwnerId: schema.characters.userId
					})
					.from(schema.sessionPersonas)
					.leftJoin(
						schema.characters,
						eq(schema.characters.id, schema.sessionPersonas.personaId)
					)
					.where(
						and(
							eq(schema.sessionPersonas.id, params.playerSeatId),
							eq(schema.sessionPersonas.sessionId, params.sessionId),
							isNull(schema.sessionPersonas.removedAt)
						)
					)
					.limit(1)
				if (!pseat) return refuse("That seat is not in this session.")
				if (
					!(
						sessionAccess.isOwner ||
						pseat.playerId === userId ||
						pseat.cardOwnerId === userId
					)
				)
					return refuse(
						"Only the session owner or this seat's player can change this.",
						!!pseat.isActive
					)
				seatId = pseat.id
				seatIsActive = !!pseat.isActive
				echo = { playerSeatId: params.playerSeatId }
			} else {
				// The live seat: by card, or by member (a card-less, non-envoy seat).
				const byCard = params.characterId != null
				const [seat] = await db
					.select({
						id: schema.sessionCharacters.id,
						isActive: schema.sessionCharacters.isActive,
						castMemberId: schema.sessionCharacters.castMemberId,
						seatedBy: schema.sessionCharacters.seatedByUserId,
						cardOwnerId: schema.characters.userId
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
							eq(schema.sessionCharacters.sessionId, params.sessionId),
							isNull(schema.sessionCharacters.removedAt),
							byCard
								? eq(
										schema.sessionCharacters.characterId,
										params.characterId!
									)
								: and(
										eq(
											schema.sessionCharacters.castMemberId,
											params.castMemberId!
										),
										isNull(schema.sessionCharacters.characterId),
										isNull(schema.sessionCharacters.envoySlug)
									)
						)
					)
					.limit(1)

				if (!seat) return refuse("Session character not found.")

				if (byCard) {
					if (!(sessionAccess.isOwner || seat.cardOwnerId === userId))
						return refuse(
							"Access denied. Only the session owner or this character's owner can change this.",
							!!seat.isActive
						)
				} else if (!(sessionAccess.isOwner || seat.seatedBy === userId))
					return refuse(
						"Only the session owner or the person who seated this cast member can change this.",
						!!seat.isActive
					)

				seatId = seat.id
				seatIsActive = !!seat.isActive
				echo = byCard
					? { characterId: params.characterId }
					: { castMemberId: params.castMemberId }
			}

			// 🚧 A guest's bench or bring-back is the owner's to freeze (G3,
			// G4): their own character's seat, or a cast member's. Only a set
			// that would change the seat; a repeated set stays a no-op.
			if (!sessionAccess.isOwner && seatIsActive !== params.enabled) {
				const switches = await guestSeatSwitchesOf(db, params.sessionId)
				const cardless = params.castMemberId != null
				if (cardless ? !switches.takeCast : !switches.bringOwn)
					return refuse(
						cardless
							? GUEST_SEAT_SENTENCES.takeCastOff
							: GUEST_SEAT_SENTENCES.bringOwnOff,
						seatIsActive
					)
			}

			const res: Sockets.Sessions.SetCastSeatEnabled.Response = {
				sessionId: params.sessionId,
				...echo,
				enabled: params.enabled
			}
			// Already so: nothing moved, so no write and no cast-changed —
			// the answer alone, so the asker still settles.
			const result = await db.transaction(async (tx) =>
				setSeatBench(tx as unknown as Db, {
					sessionId: params.sessionId,
					kind,
					seatId,
					benched: !params.enabled
				})
			)
			if (!result.ok) return refuse(result.refusal, seatIsActive)
			if (result.changes.length === 0) {
				emitToUser("sessions:setCastSeatEnabled", res)
				return res
			}

			emitToUser("sessions:setCastSeatEnabled", res)
			await resendSession(socket, params.sessionId, emitToUser)
			// A seat's row moved (PLAN-turn-order §4.1, A2): the seat writer's
			// change says it as `cast-changed` under the person's `settings`
			// cause, which never fires a turn.
			await announceSeatChanges(
				db,
				socket.io,
				{ sessionId: params.sessionId, userId },
				result.changes
			)

			return res
		} catch (error) {
			console.error("Error in sessionsSetCastSeatEnabledHandler:", error)
			return refuse("Failed to switch the seat.")
		}
	}
}

/**
 * 🚧 The card-less cast members a guest may take (owner ruling G4): the free
 * ones of the session's attached book and its own notes, as id, name and face
 * only. Any member of the session may ask; a guest cannot read the attached
 * book's own list, so this is their only door to it.
 */
export const sessionsCastToTakeHandler: Handler<
	Sockets.Sessions.CastToTake.Params,
	Sockets.Sessions.CastToTake.Response
> = {
	event: "sessions:castToTake",
	handler: async (socket, params, emitToUser) => {
		const sessionAccess = await checkSessionAccess(
			params.sessionId,
			socket.user!.id
		)
		const res: Sockets.Sessions.CastToTake.Response = sessionAccess.hasAccess
			? {
					sessionId: params.sessionId,
					members: await castToTakeOf(db, params.sessionId)
				}
			: {
					sessionId: params.sessionId,
					members: [],
					error: "no access to this session"
				}
		emitToUser("sessions:castToTake", res)
		return res
	}
}

// Registration function for all session handlers
/**
 * The account-visibility view (design §4). From the caller's own seat, what of
 * *their* data this session exposes to everyone else in it.
 *
 * This is the exact inverse of `canViewCharacter`: a character a person owns —
 * cast or persona — becomes viewable by every other participant, and readable
 * by the pipelines that assemble this session's prompts, the instant it is
 * bound in. A guest asking here sees only their own contributions and who
 * else can see them, so they understand the consequence before contributing.
 * Owner and guests may both ask; access is gated the same way as every other
 * session-scoped read.
 */
export const sessionsAccountVisibilityHandler: Handler<
	Sockets.Sessions.AccountVisibility.Params,
	Sockets.Sessions.AccountVisibility.Response
> = {
	event: "sessions:accountVisibility",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const res: Sockets.Sessions.AccountVisibility.Response = {
			sessionId: params.sessionId,
			isOwner: false,
			isGuest: false,
			viewers: [],
			exposed: { characters: [], personas: [], lorebooks: [] }
		}

		const access = await checkSessionAccess(params.sessionId, userId)
		if (!access.hasAccess) {
			res.error = "no access to this session"
			emitToUser("sessions:accountVisibility", res)
			return res
		}
		res.isOwner = access.isOwner
		res.isGuest = access.isGuest

		// The caller's own characters/personas bound into this session — what a
		// bound entity discloses to the rest of the participants.
		// A seat exposes the card it holds AND the card its cast member is
		// linked to, like `canViewCharacter`; each card is listed once.
		// Names are the cards' current card versions (`cardsNow`), never the
		// ⏳ copy; the queries select ids.
		const { cardsNow: cardsNowOf } = await import(
			"$lib/server/cast/seatedCast"
		)
		const named = async (
			rows: { id: number }[]
		): Promise<{ id: number; name: string }[]> => {
			const now = await cardsNowOf(
				db as unknown as Db,
				rows.map((r) => r.id)
			)
			return rows.flatMap((r) => {
				const card = now.get(r.id)
				return card ? [{ id: r.id, name: card.name }] : []
			})
		}
		const characterHeld = await db
			.select({
				id: schema.characters.id
			})
			.from(schema.sessionCharacters)
			.innerJoin(
				schema.characters,
				eq(schema.sessionCharacters.characterId, schema.characters.id)
			)
			.where(
				and(
					eq(schema.sessionCharacters.sessionId, params.sessionId),
					eq(schema.characters.userId, userId)
				)
			)
		const characterLinked = await db
			.select({
				id: schema.characters.id
			})
			.from(schema.sessionCharacters)
			.innerJoin(
				schema.lorebookBindings,
				eq(
					schema.lorebookBindings.id,
					schema.sessionCharacters.castMemberId
				)
			)
			.innerJoin(
				schema.characters,
				eq(schema.lorebookBindings.characterId, schema.characters.id)
			)
			.where(
				and(
					eq(schema.sessionCharacters.sessionId, params.sessionId),
					eq(schema.characters.userId, userId)
				)
			)
			.orderBy(schema.characters.id)
		res.exposed.characters = await named(characterHeld)
		for (const card of await named(characterLinked))
			if (!res.exposed.characters.some((c) => c.id === card.id))
				res.exposed.characters.push(card)

		// Aliased: `session_characters` above already joined `characters` in
		// this handler, and both member tables point at it.
		const personaHeld = await db
			.select({ id: voicedCharacter.id })
			.from(schema.sessionPersonas)
			.innerJoin(
				voicedCharacter,
				eq(schema.sessionPersonas.personaId, voicedCharacter.id)
			)
			.where(
				and(
					eq(schema.sessionPersonas.sessionId, params.sessionId),
					eq(voicedCharacter.userId, userId)
				)
			)
		const personaLinked = await db
			.select({ id: voicedCharacter.id })
			.from(schema.sessionPersonas)
			.innerJoin(
				schema.lorebookBindings,
				eq(
					schema.lorebookBindings.id,
					schema.sessionPersonas.castMemberId
				)
			)
			.innerJoin(
				voicedCharacter,
				eq(schema.lorebookBindings.characterId, voicedCharacter.id)
			)
			.where(
				and(
					eq(schema.sessionPersonas.sessionId, params.sessionId),
					eq(voicedCharacter.userId, userId)
				)
			)
			.orderBy(voicedCharacter.id)
		res.exposed.personas = await named(personaHeld)
		for (const card of await named(personaLinked))
			if (!res.exposed.personas.some((c) => c.id === card.id))
				res.exposed.personas.push(card)

		// A seat also exposes its member's ACTIVE card on the session's
		// reading (the dated card; owner ruling 2026-11-05: "Everything in
		// session is cast -> active card"), once each, when it is the caller's.
		const { seatedCastOf } = await import("$lib/server/cast/seatedCast")
		const seatsNow = await seatedCastOf(db as unknown as Db, params.sessionId)
		const activeIds = new Set<number>()
		for (const seat of seatsNow) {
			const active = seat.asRead?.activeCardId
			if (active != null) activeIds.add(active)
		}
		if (activeIds.size) {
			const ownedActiveIds = await db
				.select({ id: schema.characters.id })
				.from(schema.characters)
				.where(
					and(
						inArray(schema.characters.id, [...activeIds]),
						eq(schema.characters.userId, userId)
					)
				)
			const ownedActiveById = new Map(
				(await named(ownedActiveIds)).map((c) => [c.id, c])
			)
			for (const seat of seatsNow) {
				const active = seat.asRead?.activeCardId
				if (active == null || active === seat.cardId) continue
				if (active === seat.asRead?.linkedCardId) continue
				const card = ownedActiveById.get(active)
				if (!card) continue
				const list =
					seat.kind === "character"
						? res.exposed.characters
						: res.exposed.personas
				if (!list.some((c) => c.id === card.id)) list.push(card)
			}
		}

		// The session's lorebook is a single binding on the session row.
		// Exposed only when the caller owns it.
		const session = await db.query.sessions.findFirst({
			where: eq(schema.sessions.id, params.sessionId),
			columns: { userId: true, lorebookId: true }
		})
		if (session?.lorebookId) {
			res.exposed.lorebooks = await db
				.select({
					id: schema.lorebooks.id,
					name: schema.lorebooks.name
				})
				.from(schema.lorebooks)
				.where(
					and(
						eq(schema.lorebooks.id, session.lorebookId),
						eq(schema.lorebooks.userId, userId)
					)
				)
		}

		// Who else can see the above: the session owner plus every guest, minus
		// the caller themselves.
		const guests = await db
			.select({ userId: schema.sessionGuests.userId })
			.from(schema.sessionGuests)
			.where(eq(schema.sessionGuests.sessionId, params.sessionId))
		const ownerId = session?.userId ?? null
		const otherIds = new Set<number>()
		if (ownerId != null && ownerId !== userId) otherIds.add(ownerId)
		for (const g of guests)
			if (g.userId != null && g.userId !== userId) otherIds.add(g.userId)

		if (otherIds.size) {
			const rows = await db
				.select({
					id: schema.users.id,
					username: schema.users.username,
					displayName: schema.users.displayName
				})
				.from(schema.users)
				.where(inArray(schema.users.id, [...otherIds]))
			res.viewers = rows.map((u) => ({
				userId: u.id,
				username: u.displayName || u.username,
				role: u.id === ownerId ? ("owner" as const) : ("guest" as const)
			}))
		}

		emitToUser("sessions:accountVisibility", res)
		return res
	}
}
