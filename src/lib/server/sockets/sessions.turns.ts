/**
 * Pressing a turn: `sessions:fireTurn`, retake, Back and Forward, and the
 * narrator's response.
 */

import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import {
	pressedTurnControl,
	turnControlRefusal,
	unpreparedEntryRefusal
} from "$lib/server/messages/verbs"
import { DEFAULT_CHANNEL, channelWhere } from "$lib/server/messages/channels"
import { and, eq } from "drizzle-orm"
import { memberFormOn } from "$lib/server/state/memberForm"
import { broadcastSessionRow } from "$lib/server/sessions/rowPush"
import { sessionGenreOf } from "$lib/server/sessions/annexFields"
import { runReply } from "../utils/runReply"
import type { Handler } from "$lib/shared/events"
import { checkSessionAccess } from "$lib/server/utils/sessionAccess"
import { withSessionGenerationLock } from "$lib/server/utils/sessionGenerationLock"
import type { SideCharacterFact } from "$lib/server/pipelines/entities/sideCharacter"
import {
	MAX_NARRATOR_INSTRUCTIONS_LENGTH
} from "$lib/shared/constants/MessageLimits"
import {
	relistWithRow,
	noteSocketInteraction,
	broadcastSessionToParticipants
} from "./sessions.shared"
import { heldRerunRefusal } from "./sessions.messages"

/**
 * Whether an explicit fire is the `core#narrate` press (lair pass R8): the
 * turn control `pressedTurnControl` names for the entry, read off the
 * session's genre. An unreadable genre presses nothing.
 */
async function narratePressed(
	db: Db,
	sessionId: number,
	entry: { ref: string | null; channel?: string }
): Promise<boolean> {
	try {
		const { getSessionGenre } = await import(
			"$lib/server/pipelines/entities/sessionGenres"
		)
		const mode = await getSessionGenre(db, await sessionGenreOf(db, sessionId))
		return !!mode && pressedTurnControl(mode.shape, entry) === "narrate"
	} catch {
		return false
	}
}

/**
 * Type-safe handler for triggering message generation
 */
/**
 * Fire a prepared turn (PLAN-turn-order §4.7, §4.6) — **the** way a reply
 * starts, and the only one.
 *
 * `entry` absent means the stored head: that is Continue. An entry given is
 * a pick — the "Someone else" picker hands one back with `via: 'pick'`.
 * Either way this handler decides nothing about whose turn it is; it reads
 * the order, checks the person may fire that entry, and dispatches.
 *
 * ## Who may fire what
 *
 * - The **owner** may fire any entry in the order.
 * - A **guest** may fire the head, or an entry naming a character they own
 *   — the existing out-of-turn rule, unchanged in substance and now stated
 *   in one place instead of being spread through the trigger's checks.
 *
 * An entry that is not in the stored order is refused outright: firing is
 * over prepared turns, and a client that invents one is asking core to
 * seat somebody no strategy pooled.
 */
export const sessionsFireTurnHandler: Handler<
	Sockets.Sessions.FireTurn.Params,
	Sockets.Sessions.FireTurn.Response
> = {
	event: "sessions:fireTurn",
	handler: async (socket, params, emitToUser) =>
		withSessionGenerationLock(params.sessionId, async () => {
			const userId = socket.user!.id
			const reply = (
				res: Sockets.Sessions.FireTurn.Response
			): Sockets.Sessions.FireTurn.Response => {
				if (res.error)
					emitToUser("sessions:fireTurn:error", res)
				else emitToUser("sessions:fireTurn", res)
				return res
			}
			try {
				const access = await checkSessionAccess(params.sessionId, userId)
				if (!access.hasAccess)
					return reply({
						sessionId: params.sessionId,
						ok: false,
						error: "Session not found."
					})
				// 🚧 A person pressed something: an interaction (R11, R21; lane 6).
				await noteSocketInteraction(access, params.sessionId, "action")

				const [row] = await db
					.select({ turnOrder: schema.sessions.turnOrder })
					.from(schema.sessions)
					.where(eq(schema.sessions.id, params.sessionId))
					.limit(1)
				if (!row)
					return reply({
						sessionId: params.sessionId,
						ok: false,
						error: "Session not found."
					})
				// 🚧 seat-cast S3: an entry's ref is read as the form the session
				// stores (`storedSeatRef`: the member form once the flip is on —
				// ⏳ a card form from an old tab is translated — else the card
				// form) before it is compared (`sameEntry`) with the stored order,
				// judged or fired.
				// A member nobody is seated as stays as sent, which no order entry
				// equals; it is refused below and by `fireTurnEntry`, never stored.
				if (params.entry && typeof params.entry.ref === "string") {
					const { storedSeatRef } = await import("$lib/server/state/seatRefs")
					const stored = await storedSeatRef(
						db,
						params.sessionId,
						params.entry.ref
					)
					if (stored !== null && stored !== params.entry.ref)
						params.entry = { ...params.entry, ref: stored }
				}
				// 🚧 A channel for the owner alone (Lair rewrite D6): no
				// guest presses anything there.
				if (!access.isOwner && params.channel) {
					const { laneViewFor, laneViewAllows } = await import("$lib/server/channels/lanes")
					const view = await laneViewFor(db, params.sessionId, userId)
					if (view && !laneViewAllows(view, params.channel)) {
						const { sessionLaneFacts, hiddenChannelRefusal } = await import("$lib/server/channels/lanes")
						const facts = await sessionLaneFacts(db, params.sessionId)
						return reply({
							sessionId: params.sessionId,
							ok: false,
							error: hiddenChannelRefusal(facts?.shape, params.channel)
						})
					}
				}
				// No entry is Continue — the `advance` turn control (B7),
				// which the genre may switch off; a pick is not this.
				if (!params.entry) {
					const refusal = await turnControlRefusal(
						db,
						params.sessionId,
						"advance",
						{ userId },
						// The pressing composer's channel (R6).
						params.channel
					)
					if (refusal)
						return reply({
							sessionId: params.sessionId,
							ok: false,
							error: refusal
						})
				}
				const { readTurnOrder, isSameChannel } = await import(
					"@serene-pub/sdk"
				)
				let order = readTurnOrder(row).order
				let head = order[0]
				/**
				 * An entry is its reference AND its channel (lair re-plan
				 * R5): the own voice (`ref: null`) may be prepared on more
				 * than one channel at once, and a Narrate press — the null
				 * reference, no channel — is `main`'s, never a prepared
				 * Sanctum entry that happens to share the reference. An
				 * absent channel is `main`.
				 */
				const sameEntry = (
					a: { ref: unknown; channel?: string },
					b: { ref: unknown; channel?: string }
				) => String(a.ref) === String(b.ref) && isSameChannel(a.channel, b.channel)
				/**
				 * Where Continue was pressed: the pressing composer's channel
				 * (R5), `main` when the client names none. The first entry
				 * prepared there is what Continue fires, and it is that
				 * channel's head — for a guest's rule below as much as for
				 * the press.
				 */
				const pressedOn = params.channel ?? "main"
				const firstOn = (channel: string | undefined) =>
					order.find((e) => isSameChannel(e.channel, channel))
				// An entry the order does not hold may be a person naming who
				// speaks (B8): a character is **Pick who speaks**, a narrator
				// genre's null ref the **narrator's turn** — turn controls the
				// genre declares, present only where it says they apply. An
				// entry the order holds is a prepared turn, and fires as one.
				if (
					params.entry &&
					!order.some((e) => sameEntry(e, params.entry!))
				) {
					const refusal = await unpreparedEntryRefusal(
						db,
						params.sessionId,
						params.entry,
						{ userId },
						// Judged where it was pressed (R6): Pick who speaks
						// is the story's, not the Sanctum's.
						params.channel
					)
					if (refusal)
						return reply({
							sessionId: params.sessionId,
							ok: false,
							error: refusal
						})
				}

				/**
				 * Continue (no entry named) fires the first entry on the
				 * channel it was pressed on (R5) — so with the Sanctum's
				 * entry at the head, Continue on `main` still moves the
				 * story. On `main` with nothing prepared there, the OWNER of
				 * a narrator genre carries on (lair pass B9, owner ruling
				 * D3; `carryOnEntry` is `main`'s alone). On any other
				 * channel with nothing of its own, the head fires, as it
				 * always did. Only a press reaches here — auto-advance never
				 * does — so an always-empty order cannot loop.
				 */
				const { carryOnEntry, sentSinceReply } = await import(
					"$lib/server/sessions/fireTurn"
				)
				const pressedOnMain = isSameChannel(pressedOn, "main")
				let prepared =
					params.entry ??
					firstOn(pressedOn) ??
					(pressedOnMain ? undefined : head)
				/**
				 * 🚧 **The GM's Continue moves past a waiting player** (Lair
				 * rewrite D5, 2026-10-21): the owner's Continue, with a
				 * planned turn a person plays at the head of this channel,
				 * skips that seat (`skipWaitingTurn` — recorded on the plan,
				 * so no recompute prepares it again) and fires what is
				 * prepared after it. A guest's Continue skips nobody.
				 */
				if (!params.entry && access.isOwner && prepared && prepared.via === "plan") {
					const { entryIsPersons } = await import("$lib/server/sessions/fireTurn")
					if (
						typeof prepared.ref === "string" &&
						(await entryIsPersons(db, params.sessionId, prepared as import("@serene-pub/sdk").TurnEntryV1))
					) {
						const { skipWaitingTurn } = await import("$lib/server/sessions/turnPlan")
						const after = await skipWaitingTurn(db, params.sessionId, prepared.ref, socket.io)
						if (after) {
							order = after.order
							head = order[0]
							prepared = firstOn(pressedOn)
							if (!prepared)
								return reply({
									sessionId: params.sessionId,
									ok: true,
									reason: "skipped"
								})
						}
					}
				}
				/**
				 * 🚧 A guest who has moved since the story last did may carry
				 * it on too (feature 17, D4, 2026-10-15): Dungeon Crawler's
				 * round waits for everyone, and Continue from a player who
				 * has declared resolves it early. One who has not is refused
				 * below, as any guest with nothing prepared always was.
				 */
				const carriedOn =
					!prepared &&
					(access.isOwner ||
						(pressedOnMain &&
							(await sentSinceReply(db, params.sessionId, userId))))
				const wanted =
					prepared ??
					(carriedOn ? await carryOnEntry(db, params.sessionId) : null)
				if (!wanted)
					return reply({
						sessionId: params.sessionId,
						ok: false,
						error: "Nothing is prepared to take a turn."
					})

				/**
				 * The prepared entry this names, when the order holds one:
				 * its `channel` and `subject` are the strategy's and must
				 * not be re-typed by a client. An entry the order does not
				 * hold is the caller's own — which §4.7 allows the OWNER,
				 * and which is how a session with no order yet (one that has
				 * had no event: §4.1 backfills nothing) is still playable.
				 */
				const seated = order.find((e) => sameEntry(e, wanted)) ?? wanted

				if (!access.isOwner && !carriedOn) {
					// The head of its own channel (R5): the order's head, or
					// the first entry on another channel — the one a guest's
					// Continue on that channel's composer fires.
					const channelHead = firstOn(seated.channel)
					const isHead = !!channelHead && sameEntry(channelHead, seated)
					let ownsIt = false
					const seatRefForm =
						typeof seated.ref === "string"
							? (await import("$lib/server/sessions/seats")).parseSeatRef(
									seated.ref
								)?.form
							: undefined
					if (
						typeof seated.ref === "string" &&
						(seatRefForm === "character" ||
							seatRefForm === "seated-member" ||
							// ⏳ A player seat is named `player-seat:<id>` once
							// the flip is on, carded or not.
							(seatRefForm === "player-seat" && memberFormOn()))
					) {
						// 🚧 Judged through the seat (owner ruling 2026-11-05: "The
						// person who seated it"): `seatActorOf` — the seater of a
						// character seat, the player of a player seat; unset, the
						// owner of the member's active card. A `character:` ref no
						// seat of this session holds keeps its card's owner (the
						// card form; ⏳ a member-less character seat's ref).
						const { seatOf, seatActorOf } = await import(
							"$lib/server/sessions/seats"
						)
						const seat = await seatOf(db, params.sessionId, seated.ref)
						// ⏳ A card-less player seat's entry stays nobody's here, as
						// before the flip (`player-seat:` named only those then).
						if (seat && !(seatRefForm === "player-seat" && seat.cardId == null)) {
							ownsIt =
								(await seatActorOf(db, params.sessionId, seat)) === userId
						} else if (seatRefForm === "character") {
							const cardId = Number(seated.ref.slice("character:".length))
							const [character] = await db
								.select({ userId: schema.characters.userId })
								.from(schema.characters)
								.where(eq(schema.characters.id, cardId))
								.limit(1)
							ownsIt = character?.userId === userId
						}
					}
					if (!isHead && !ownsIt)
						return reply({
							sessionId: params.sessionId,
							ok: false,
							error: "Only the session owner can take somebody else's turn out of order."
						})
					// And a guest may only fire what is prepared: the head, or
					// their own character's entry. The owner's latitude above
					// does not extend to them.
					if (!order.some((e) => sameEntry(e, wanted)))
						return reply({
							sessionId: params.sessionId,
							ok: false,
							error: "That turn is not in this session's order."
						})
				}

				// A picked ref is the client's words: it must be a participant
				// reference (or null, the pipeline's own voice) before it is
				// fired as one.
				const { isParticipantRef } = await import("@serene-pub/sdk")
				if (seated.ref !== null && !isParticipantRef(seated.ref))
					return reply({
						sessionId: params.sessionId,
						ok: false,
						error: `'${String(seated.ref)}' is not a participant.`
					})
				const { fireTurnEntry } = await import(
					"$lib/server/sessions/fireTurn"
				)
				/**
				 * **Narrate** (lair pass R8): an explicit entry naming the
				 * pipeline's own voice in a narrator genre IS the `core#narrate`
				 * press (`pressedTurnControl`) — the Narrate chip, `/narrator`,
				 * the pickers' own-voice row. It is stamped `via: 'narrate'`
				 * whether or not the order held that entry, so the genre can
				 * route it (the Lair's Castellan narrates on `main`), and it
				 * keeps the channel it was pressed on — which the run reads
				 * (R13), while the narration still lands on `main`. Continue's
				 * carry-on names no entry, so it stays a full turn.
				 */
				const narrated =
					!!params.entry &&
					(await narratePressed(db, params.sessionId, params.entry))
				const result = await fireTurnEntry(db, {
					sessionId: params.sessionId,
					userId,
					// The pick the person made, recorded as one (§4.6).
					// A prepared head keeps the strategy's own `via`.
					entry: {
						...seated,
						ref: seated.ref as import("@serene-pub/sdk").ParticipantRef | null,
						via: narrated
							? "narrate"
							: params.entry || !order.some((e) => sameEntry(e, seated))
								? "pick"
								: (seated.via ?? "strategy"),
						...(narrated && !isSameChannel(pressedOn, "main")
							? { channel: pressedOn }
							: {})
					},
					// A press is always a person's cause, which is the one
					// cause that may fire whatever the auto-advance setting.
					cause: { kind: "user", userId },
					io: socket.io,
					socket,
					emitToUser
				})
				if (!result.fired)
					return reply({
						sessionId: params.sessionId,
						ok: false,
						// A person's entry is not an error: it is their turn. Nor
						// is a reply somebody stopped: the message says *Stopped*
						// and the run's card says so, and a refusal's toast on
						// top of them read "stopped" twice.
						...(result.reason === "person" || result.reason === "stopped"
							? {}
							: { error: result.reason ?? "The turn produced no reply." }),
						...(result.reason ? { reason: result.reason } : {})
					})
				return reply({
					sessionId: params.sessionId,
					ok: true,
					...(result.runId ? { runId: result.runId } : {})
				})
			} catch (error) {
				console.error("Error in sessionsFireTurnHandler:", error)
				return reply({
					sessionId: params.sessionId,
					ok: false,
					error: "Failed to take the turn."
				})
			}
		})
}

/**
 * **Regenerate the last turn**, as a whole — the `retake` turn control
 * (lair pass R2, owner 2026-09-28; `sessions/retakeTurn.ts`).
 *
 * The door, in the order a person needs its answers:
 *
 * 1. the session, and that this person is in it;
 * 2. the turn control — offered by the genre, present, and enabled now
 *    (`turnControlRefusal`: not while a reply is being written);
 * 3. the **owner**: a retake deletes rows everybody at the table saw.
 *
 * `preview` answers with the rows the confirm dialog names and writes
 * nothing. Otherwise the yield is deleted, the session re-sent to everyone
 * in it, and the same turn fired again — under the generation lock, like
 * every fire.
 */
export const sessionsRetakeTurnHandler: Handler<
	Sockets.Sessions.RetakeTurn.Params,
	Sockets.Sessions.RetakeTurn.Response
> = {
	event: "sessions:retakeTurn",
	handler: async (socket, params, emitToUser) => {
		// Before the lock: a press queued behind a run would go through once it ended.
		// A press a beat after a turn waits for the turn's children to settle first
		// (PLAN-dc-after-walk2 Q1-4).
		const wait = await heldRerunRefusal(params.sessionId, socket.user!.id, true)
		if (wait) {
			const res: Sockets.Sessions.RetakeTurn.Response = {
				sessionId: params.sessionId,
				ok: false,
				error: wait
			}
			emitToUser("sessions:retakeTurn:error", res)
			return res
		}
		return withSessionGenerationLock(params.sessionId, async () => {
			const userId = socket.user!.id
			const reply = (
				res: Sockets.Sessions.RetakeTurn.Response
			): Sockets.Sessions.RetakeTurn.Response => {
				if (res.error) emitToUser("sessions:retakeTurn:error", res)
				else emitToUser("sessions:retakeTurn", res)
				return res
			}
			const refuse = (error: string) =>
				reply({ sessionId: params.sessionId, ok: false, error })
			try {
				const access = await checkSessionAccess(params.sessionId, userId)
				if (!access.hasAccess) return refuse("Session not found.")
				// 🚧 A person pressed something: an interaction (R11, R21; lane 6).
				await noteSocketInteraction(access, params.sessionId, "action")
				// 🚧 Busy only with what nobody watches stream — a background
				// step after the turn, its children settling: the press waits a
				// beat for it, never "wait for the reply to finish" with nothing
				// running (PLAN-dc-after-walk2 Q1-4, the walk's N9).
				const { settleBackgroundRuns } = await import("$lib/server/pipelines/entities/publishedValues")
				await settleBackgroundRuns(db, params.sessionId)
				const refusal = await turnControlRefusal(
					db,
					params.sessionId,
					"retake",
					{ userId },
					// Per channel (R6): the Lair's Sanctum offers no retake.
					params.channel
				)
				if (refusal) return refuse(refusal)
				if (!access.isOwner)
					return refuse("Only the session owner can regenerate a turn.")

				const { retakeTurn } = await import(
					"$lib/server/sessions/retakeTurn"
				)
				const out = await retakeTurn(db, {
					sessionId: params.sessionId,
					userId,
					...(params.channel ? { channel: params.channel } : {}),
					...(params.preview ? { preview: true } : {}),
					io: socket.io,
					socket,
					emitToUser,
					// The rows are gone before the new turn starts: every view
					// of the session drops them now, not when the reply lands.
					onDeleted: async () => {
						await broadcastSessionToParticipants(
							socket,
							params.sessionId,
							userId
						)
						broadcastSessionRow(socket.io, params.sessionId)
					}
				})
				const rows = out.rows?.map((r) => ({
					messageId: r.messageId,
					channel: r.channel,
					characterId: r.characterId,
					name: r.name
				}))
				// 🚧 On revision `branch` (PLAN-rulesets §28): the turn was
				// taken again in a new session — the list gains it.
				if (out.branchedTo != null) {
					await relistWithRow(socket, emitToUser, out.branchedTo)
				}
				return reply({
					sessionId: params.sessionId,
					ok: out.ok,
					...(out.preview ? { preview: true } : {}),
					...(rows ? { rows } : {}),
					...(out.runId ? { runId: out.runId } : {}),
					...(out.revision ? { revision: out.revision } : {}),
					...(out.branchedTo != null ? { branchedTo: out.branchedTo } : {}),
					...(out.error ? { error: out.error } : {})
				})
			} catch (error) {
				console.error("Error in sessionsRetakeTurnHandler:", error)
				return refuse("Failed to regenerate the last turn.")
			}
		})
	}
}

/**
 * 🚧 **Back · Forward** (RF fix 5, owner ruling 2026-10-23): the session's
 * forward stack — `rewindTurn` / `forwardTurn` (`sessions/rewind.ts`) under
 * the session's generation lock, so a press never lands mid-turn. The
 * answer goes to the asker (`:error` for a refusal, the toast's); on a
 * press that moved, the whole session goes to everyone in it and the row
 * push says its new last line.
 */
function rewindPressHandler(
	event: "sessions:rewindTurn" | "sessions:forwardTurn",
	press: "rewindTurn" | "forwardTurn"
): Handler<Sockets.Sessions.RewindTurn.Params, Sockets.Sessions.RewindTurn.Response> {
	return {
		event,
		handler: async (socket, params, emitToUser) => {
			// Back only (never Forward), before the lock — see `heldRerunRefusal`.
			if (press === "rewindTurn") {
				const wait = await heldRerunRefusal(params.sessionId, socket.user!.id, true)
				if (wait) {
					const res: Sockets.Sessions.RewindTurn.Response = {
						sessionId: params.sessionId,
						ok: false,
						error: wait
					}
					emitToUser(`${event}:error`, res)
					return res
				}
			}
			return withSessionGenerationLock(params.sessionId, async () => {
				const userId = socket.user!.id
				const reply = (res: Sockets.Sessions.RewindTurn.Response) => {
					emitToUser(res.ok ? event : `${event}:error`, res)
					return res
				}
				try {
					const access = await checkSessionAccess(params.sessionId, userId)
					if (!access.hasAccess)
						return reply({ sessionId: params.sessionId, ok: false, error: "Session not found." })
					await noteSocketInteraction(access, params.sessionId, "action")
					const rewind = await import("$lib/server/sessions/rewind")
					const out = await rewind[press](db, {
						sessionId: params.sessionId,
						userId,
						io: socket.io
					})
					if (!out.ok) return reply({ sessionId: params.sessionId, ok: false, error: out.error })
					await broadcastSessionToParticipants(socket, params.sessionId, userId)
					broadcastSessionRow(socket.io, params.sessionId)
					return reply({
						sessionId: params.sessionId,
						ok: true,
						messageIds: out.messageIds,
						ahead: out.ahead,
						...("stayed" in out && out.stayed ? { stayed: out.stayed } : {})
					})
				} catch (error) {
					console.error(`Error in ${event}:`, error)
					return reply({
						sessionId: params.sessionId,
						ok: false,
						error: press === "rewindTurn" ? "Could not go back a turn." : "Could not go forward a turn."
					})
				}
			})
		}
	}
}

export const sessionsRewindTurnHandler = rewindPressHandler("sessions:rewindTurn", "rewindTurn")

export const sessionsForwardTurnHandler = rewindPressHandler("sessions:forwardTurn", "forwardTurn")

// "Narrator" — a manually-triggered, non-character narration/environment
// response. Deliberately outside the turn rotation: a narrator message is
// never a sessionCharacters row, and the rotation reads narration rows out
// (`rotationTurns`), so nothing here needs excluding.
export const fireNarratorResponseHandler: Handler<
	Sockets.Sessions.FireNarratorResponse.Params,
	Sockets.Sessions.FireNarratorResponse.Response
> = {
	event: "sessions:fireNarratorResponse",
	handler: async (socket, params, emitToUser) =>
		withSessionGenerationLock(params.sessionId, async () => {
			/**
			 * A press refused before its run (C2 follow-up, 2026-09-29): the
			 * page is told, because `register` discards what a handler
			 * returns. The outcome settles the press (a `/narrate <text>`
			 * draft is kept, the modal's text is kept for its next opening)
			 * and the sentence goes on the ungated `:error` for the toast —
			 * a gate never turns a refusal into silence (plan ruling 2).
			 */
			const refuse = (error: string) => {
				emitToUser("sessions:fireNarratorResponse", {
					sessionId: params.sessionId,
					success: false
				})
				emitToUser("sessions:fireNarratorResponse:error", {
					sessionId: params.sessionId,
					error
				})
				return { error }
			}
			/** Whether the outcome went out — so the catch answers once. */
			let answered = false
			try {
				const userId = socket.user!.id

				if (
					params.instructions &&
					params.instructions.length >
						MAX_NARRATOR_INSTRUCTIONS_LENGTH
				) {
					return refuse(
						`Narrator instructions too long (max ${MAX_NARRATOR_INSTRUCTIONS_LENGTH} characters).`
					)
				}

				// Owner-only, same reasoning as the character trigger above:
				// the session snapshot admits guests, and this handler is only
				// ever reached from a client pressing the Narrator button (no
				// internal callers), so requiring ownership breaks no
				// auto-trigger path. The length cap above deliberately stays
				// first — it's a pure payload check that shouldn't cost a
				// query. A session that doesn't exist keeps reporting "not found"
				// rather than "access denied".
				const access = await checkSessionAccess(
					params.sessionId,
					userId
				)
				if (!access.hasAccess) {
					return refuse(
						"Could not fire the Narrator response: session not found."
					)
				}
				// 🚧 A person pressed something: an interaction (R11, R21; lane 6).
				await noteSocketInteraction(access, params.sessionId, "action")
				if (!access.isOwner) {
					return refuse(
						"Access denied. Only the session owner can fire a Narrator response."
					)
				}

				// The access check above already proves the session exists, so
				// there is no separate "session not found" branch here. The read
				// is the rows `getPromptSessionFromDb` snapshots (visible rows of
				// the main channel), narrowed to one that is generating.
				const [generating] = await db
					.select({ id: schema.sessionMessages.id })
					.from(schema.sessionMessages)
					.where(
						and(
							eq(schema.sessionMessages.sessionId, params.sessionId),
							eq(schema.sessionMessages.isHidden, false),
							channelWhere(
								schema.sessionMessages.channel,
								DEFAULT_CHANNEL
							),
							eq(schema.sessionMessages.isGenerating, true)
						)
					)
					.limit(1)
				if (generating) {
					return refuse(
						"A response is already generating in this session."
					)
				}

				/**
				 * The trigger's first step (ruling 2026-09-07): who speaks.
				 *
				 * Absent, this is world narration and everything below is what
				 * it always was. Present, it is a **side character** — a
				 * participant for this turn with no cast row, no position and
				 * no place in the rotation. Resolved here rather than inside
				 * the run because the answer is also the message's display
				 * name, and the row is written before the pipeline starts.
				 */
				let sideCharacter: SideCharacterFact | null = null
				if (params.speaker) {
					const { resolveSideCharacter } = await import(
						"$lib/server/pipelines/entities/sideCharacter"
					)
					const resolution = await resolveSideCharacter(
						db,
						params.sessionId,
						userId,
						params.speaker
					)
					if (!resolution.ok) return refuse(resolution.error)
					sideCharacter = resolution.speaker
				}

				/**
				 * No insert here (R-17). The narrate specs create their own row
				 * at their placeholder outlet — narration, with the narrator's
				 * name snapshotted at the write and the speaker fact beside it
				 * where the run and the receipt read it — and announce it from
				 * the commit. The instructions travel as the turn's triggering
				 * text and are stored beside the row by the same outlet.
				 */
				const outcome = await runReply({
					socket,
					emitToUser,
					sessionId: params.sessionId,
					userId,
					turn: sideCharacter
						? {
								kind: "narrate-character",
								speaker: sideCharacter,
								instructions: params.instructions
							}
						: { kind: "narrate", instructions: params.instructions }
				})
				// How the run went, to the page that fired it (genre uplift
				// C2, 2026-09-29): what spends a `/narrate <text>` draft, which
				// stays until the narration has run (S2) — kept on a stop or
				// an error, as `sessions:fireAction`'s answer keeps one.
				answered = true
				emitToUser("sessions:fireNarratorResponse", {
					sessionId: params.sessionId,
					success: outcome.ok
				})
				if (outcome.error && !outcome.stopped) {
					if (!outcome.shown)
						emitToUser("sessions:fireNarratorResponse:error", {
							sessionId: params.sessionId,
							error: outcome.error
						})
					return { error: outcome.error }
				}

				return { success: outcome.ok }
			} catch (error) {
				console.error("Error in fireNarratorResponseHandler:", error)
				const failed = "Failed to fire the Narrator response."
				if (answered) return { error: failed }
				return refuse(failed)
			}
		})
}
