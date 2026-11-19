/**
 * The session's line handlers: send, edit, delete, regenerate, extend, the
 * swipes, cancel, the token count, and the widget reads of the log (one page,
 * the channel lanes, a lane read). The held door (`heldRerunRefusal`) lives
 * here beside the presses it refuses; `sessions.turns.ts` reads it from here.
 */

import { inPlay } from "$lib/shared/sessions/inPlay"
import { sessionEvents } from "@serene-pub/sdk"
import { sessionArchivedRefusal } from "$lib/server/sessions/archive"
import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { haltExplanationFor } from "$lib/server/pipelines/runtime/haltExplanation"
import {
	updateLegacyWhere,
	hasNativeSteps,
	attachParts,
	liveMessageWhere
} from "$lib/server/messages/store"
import {
	extendVerbRefusal,
	turnDeleteVerdict,
	verbEnablementRefusal,
	verbRefusal
} from "$lib/server/messages/verbs"
import { canActOnMessage } from "$lib/server/messages/permissions"
import {
	canonicalChannel,
	channelRefusal,
	channelWhere
} from "$lib/server/messages/channels"
import {
	formatChannel,
	parseChannel,
	type ChannelLaneV1
} from "@serene-pub/sdk"
import { and, count, desc, eq, inArray, lt, max } from "drizzle-orm"
import { memberFormOn } from "$lib/server/state/memberForm"
import {
	announceSeatChanges,
	maySpeakAsCard,
	seatOf,
	type SeatChange
} from "$lib/server/sessions/seats"
import { broadcastSessionRow } from "$lib/server/sessions/rowPush"
// Replacing a message is not deleting one, so the anchor cascade cannot fire —
// see the call sites in the regenerate and swipe-right handlers.
import { retractStateAnchoredTo } from "$lib/server/state/write"
import { SettledRefusal } from "$lib/server/sessions/settle"
import { runReply } from "../utils/runReply"
import { clearReplyFailed } from "../utils/generationStatus"
import type { Handler } from "$lib/shared/events"
import { resolveTaskConfig } from "../utils/resolveTaskConfig"
import { llmQueue } from "../utils/llmQueue"
import { broadcastToSessionUsers } from "./utils/broadcastHelpers"
import { checkSessionAccess } from "$lib/server/utils/sessionAccess"
import { readsPrompt, rowShownTo, withEmbeddingStateFor, withoutDebugMeta } from "$lib/server/messages/debugMeta"
import { withSessionGenerationLock } from "$lib/server/utils/sessionGenerationLock"
import { MAX_CHAT_MESSAGE_LENGTH } from "$lib/shared/constants/MessageLimits"
import {
	relistWithRow,
	noteSocketInteraction,
	getPromptSessionFromDb,
	resendSession
} from "./sessions.shared"

/** The page size a widget's `messages` ask is clamped into. */
const MESSAGES_PAGE_LIMIT = { min: 1, max: 100, default: 25 } as const

/**
 * 🚧 One page of the session's lines for ONE widget (the `messages` widget
 * request; D7 ruling A, 2026-10-11). Newest-first before `beforeId`, in one
 * channel when asked (a bare slug is the whole channel, every lane; `slug:n`
 * one lane), clamped to {@link MESSAGES_PAGE_LIMIT}. Each widget pages its
 * own window; the conversation's window is never touched. One more row than
 * asked is read to know whether an older page exists. Access as `sessions:get`.
 */
export const sessionsMessagesPageHandler: Handler<
	Sockets.Sessions.MessagesPage.Params,
	Sockets.Sessions.MessagesPage.Response
> = {
	event: "sessions:messagesPage",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const sessionId = Number(params?.sessionId)
		const requestId = typeof params?.requestId === "string" ? params.requestId : undefined
		const refuse = (error: string): Sockets.Sessions.MessagesPage.Response => {
			const res = { sessionId, requestId, rows: [], error }
			emitToUser("sessions:messagesPage", res)
			return res
		}
		if (!Number.isInteger(sessionId)) return refuse("sessionId must be a session's id.")
		const access = await checkSessionAccess(sessionId, userId)
		if (!access.hasAccess) return refuse("This session is not yours to read.")
		const beforeId = params.beforeId == null ? undefined : Number(params.beforeId)
		if (beforeId !== undefined && !Number.isInteger(beforeId))
			return refuse("beforeId must be a message id (the last page's nextCursor).")
		const asked = params.limit == null ? MESSAGES_PAGE_LIMIT.default : Number(params.limit)
		const limit = Number.isFinite(asked)
			? Math.min(MESSAGES_PAGE_LIMIT.max, Math.max(MESSAGES_PAGE_LIMIT.min, Math.trunc(asked)))
			: MESSAGES_PAGE_LIMIT.default
		let laneFilter
		if (typeof params.channel === "string" && params.channel.trim()) {
			laneFilter = channelWhere(schema.sessionMessages.channel, params.channel)
		}
		// 🚧 A personal lane that is not the asker's is not theirs to page
		// through (2026-10-17) — filtered in the query, before the limit.
		const { laneViewFor, laneViewWhere } = await import("$lib/server/channels/lanes")
		const laneView = await laneViewFor(db, sessionId, userId)
		const page = await db
			.select()
			.from(schema.sessionMessages)
			.where(
				and(
					eq(schema.sessionMessages.sessionId, sessionId),
					beforeId !== undefined ? lt(schema.sessionMessages.id, beforeId) : undefined,
					laneFilter,
					laneViewWhere(schema.sessionMessages.channel, laneView),
					// 🚧 The live history (RF fix 5).
					liveMessageWhere()
				)
			)
			.orderBy(desc(schema.sessionMessages.id))
			.limit(limit + 1)
		const more = page.length > limit
		const pageRows = page.slice(0, limit).reverse()
		// G5/G6/D64: the compiled prompt goes to `readsPrompt` viewers only.
		const rows = await withEmbeddingStateFor(
			(await readsPrompt(sessionId, userId))
				? pageRows
				: withoutDebugMeta(pageRows),
			socket.user
		)
		const res: Sockets.Sessions.MessagesPage.Response = {
			sessionId,
			requestId,
			rows,
			...(more && rows.length ? { nextCursor: String(rows[0]!.id) } : {})
		}
		emitToUser("sessions:messagesPage", res)
		return res
	}
}

/**
 * 🚧 The **channel lanes** under one channel (`channel-lanes` widget request;
 * ruled 2026-10-12): one entry per lane that holds a line — the canonical
 * channel string, its slug and number, its line count and its newest line.
 * A bare slug lists every lane of the channel; a lane string (`phone:2`)
 * answers that lane alone. Read from the log, never declared: a lane exists
 * because a pipeline wrote to it. Who is in a lane is the genre's to keep.
 * Access as `sessions:get`.
 */
export const sessionsChannelLanesHandler: Handler<
	Sockets.Sessions.ChannelLanes.Params,
	Sockets.Sessions.ChannelLanes.Response
> = {
	event: "sessions:channelLanes",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const sessionId = Number(params?.sessionId)
		const requestId = typeof params?.requestId === "string" ? params.requestId : undefined
		const refuse = (error: string): Sockets.Sessions.ChannelLanes.Response => {
			const res = { sessionId, requestId, lanes: [], error }
			emitToUser("sessions:channelLanes", res)
			return res
		}
		if (!Number.isInteger(sessionId)) return refuse("sessionId must be a session's id.")
		if (typeof params?.channel !== "string" || !params.channel.trim()) return refuse("channel must be a channel slug.")
		const access = await checkSessionAccess(sessionId, userId)
		if (!access.hasAccess) return refuse("This session is not yours to read.")
		const m = schema.sessionMessages
		// 🚧 Only the lanes the asker may read (personal lanes, 2026-10-17).
		const { laneViewFor, laneViewWhere } = await import("$lib/server/channels/lanes")
		const laneView = await laneViewFor(db, sessionId, userId)
		const where = and(
			eq(m.sessionId, sessionId),
			channelWhere(m.channel, params.channel),
			laneViewWhere(m.channel, laneView),
			// 🚧 The live history (RF fix 5).
			liveMessageWhere(m.rewindOrdinal)
		)
		const grouped = await db
			.select({ channel: m.channel, count: count(m.id), latestId: max(m.id) })
			.from(m)
			.where(where)
			.groupBy(m.channel)
		const latestIds = grouped.map((g) => Number(g.latestId)).filter((n) => Number.isInteger(n))
		const latestRows = latestIds.length
			? await db
					.select({ id: m.id, createdAt: m.createdAt, role: m.role, characterId: m.characterId, personaId: m.personaId, castMemberId: m.castMemberId })
					.from(m)
					.where(inArray(m.id, latestIds))
			: []
		const latestById = new Map(latestRows.map((r) => [r.id, r]))
		const lanes: ChannelLaneV1[] = []
		for (const g of grouped) {
			const latest = latestById.get(Number(g.latestId))
			if (!latest) continue
			const laneRef = parseChannel(g.channel)
			// A row written as `slug:1` and one written bare are one lane: fold them.
			const canonical = formatChannel(laneRef)
			const seen = lanes.find((l) => l.channel === canonical)
			const entry: ChannelLaneV1 = {
				channel: canonical,
				slug: laneRef.slug,
				lane: laneRef.lane,
				count: Number(g.count),
				latest: {
					messageId: latest.id,
					at: new Date(latest.createdAt as unknown as string | number | Date).toISOString(),
					role: latest.role,
					characterId: latest.characterId,
					personaId: latest.personaId,
					// 🚧 Host-filled (seat-cast S3): the message's own `cast_member_id`.
					castMemberId: latest.castMemberId ?? null
				}
			}
			if (!seen) lanes.push(entry)
			else {
				seen.count += entry.count
				if (entry.latest.messageId > seen.latest.messageId) seen.latest = entry.latest
			}
		}
		lanes.sort((a, b) => a.lane - b.lane)
		const res: Sockets.Sessions.ChannelLanes.Response = { sessionId, requestId, lanes }
		emitToUser("sessions:channelLanes", res)
		return res
	}
}

/**
 * 🚧 **Read to here** on one channel lane (2026-10-17, PLAN-sheet-widget
 * §11): moves the asker's last-read mark (annex owner `core`'s `laneReads`)
 * forward to `messageId`, or to the lane's newest line, and answers their
 * fresh channels view (`SessionV1.channels`). A lane the asker may not read
 * is refused; access as `sessions:get`.
 */
export const sessionsLaneReadHandler: Handler<
	Sockets.Sessions.LaneRead.Params,
	Sockets.Sessions.LaneRead.Response
> = {
	event: "sessions:laneRead",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const sessionId = Number(params?.sessionId)
		const refuse = (error: string): Sockets.Sessions.LaneRead.Response => {
			const res = { sessionId, error }
			emitToUser("sessions:laneRead", res)
			return res
		}
		if (!Number.isInteger(sessionId)) return refuse("sessionId must be a session's id.")
		if (typeof params?.channel !== "string" || !params.channel.trim()) return refuse("channel must be a channel lane.")
		const access = await checkSessionAccess(sessionId, userId)
		if (!access.hasAccess) return refuse("This session is not yours to read.")
		const { laneViewFor, laneViewAllows } = await import("$lib/server/channels/lanes")
		const { markLaneRead, newestOnLane, sessionChannelsFor } = await import("$lib/server/channels/attention")
		const view = await laneViewFor(db, sessionId, userId)
		if (!view) return refuse("This session is not yours to read.")
		if (!laneViewAllows(view, params.channel)) return refuse("That lane is another person's.")
		const asked = params.messageId == null ? await newestOnLane(db, sessionId, params.channel) : Number(params.messageId)
		if (asked !== null && Number.isInteger(asked) && asked > 0)
			await markLaneRead(db, sessionId, userId, params.channel, asked)
		const res: Sockets.Sessions.LaneRead.Response = { sessionId, channels: await sessionChannelsFor(db, view) }
		emitToUser("sessions:laneRead", res)
		return res
	}
}

export const sessionMessagesSendPersonaMessageHandler: Handler<
	Sockets.SessionMessages.SendPersonaMessage.Params,
	Sockets.SessionMessages.SendPersonaMessage.Response
> = {
	event: "sessionMessages:sendPersonaMessage",
	handler: async (socket, params, emitToUser) => {
		try {
			const { sessionId, personaId, content } = params
			const userId = socket.user!.id
			/**
			 * Which channel the author is writing on (R-C, 2026-09-17) — the
			 * composer's pick, canonicalised at the write like every other
			 * channel value. Absent is `main`, which is every session whose
			 * genre declares no channel of its own.
			 *
			 * ⚠ It travels TWICE from here, and both legs matter. The row is
			 * stored on it, so the message is where the person put it; and the
			 * reply it triggers is asked for on it, so a genre that answers the
			 * manuscript differently from the conversation can branch. The
			 * second leg is the one that was missing: `ReplyRequest.channel`
			 * has existed since R-C and no socket handler had ever passed one.
			 */
			let channel = canonicalChannel(params.channel)
			/**
			 * 🚧 Every answer but a saved message is a **refusal**: a sentence
			 * the person reads, nothing saved, and their text given back by
			 * the composer (owner ruling 2026-10-15 — never lose text).
			 */
			const refuse = (sentence: string, runId?: string) => {
				const res: Sockets.SessionMessages.SendPersonaMessage.Response = {
					sessionId,
					refused: sentence,
					...(runId ? { runId } : {})
				}
				emitToUser("sessionMessages:sendPersonaMessage", res)
				return res
			}

			// Check if user has access to this session (both owners and guests can send messages)
			const sessionAccess = await checkSessionAccess(sessionId, userId)
			if (!sessionAccess.hasAccess) {
				return refuse("Access denied. Session not found or no permission to access.")
			}

			// A session whose mode disappeared is read-only (19 §6): the history
			// stays, no new turn starts. The standard mode is the F29 floor,
			// so this can never block ordinary sessionting.
			{
				const { sessionGenreAvailable } = await import(
					"$lib/server/pipelines/entities/sessionGenres"
				)
				const modeCheck = await sessionGenreAvailable(db, sessionId)
				if (!modeCheck.available) {
					return refuse(modeCheck.reason ?? "This session is read-only.")
				}
			}

			// Check if user owns the persona they're trying to use
			if (personaId) {
				const canUsePersona = await maySpeakAsCard(db as unknown as Db, {
					sessionId,
					cardId: personaId,
					userId
				})
				if (!canUsePersona) {
					return refuse("Access denied. You can only send messages with personas you own.")
				}
			}

			// Check if session exists. Access was checked above; nothing below reads
			// the transcript or the cast, so only the row's existence is read.
			const sessionRow = await db.query.sessions.findFirst({
				where: eq(schema.sessions.id, sessionId),
				columns: { id: true }
			})
			if (!sessionRow) {
				return refuse("Session not found")
			}

			if (content && content.length > MAX_CHAT_MESSAGE_LENGTH) {
				return refuse(`Message too long (max ${MAX_CHAT_MESSAGE_LENGTH.toLocaleString()} characters).`)
			}

			/**
			 * A channel this session does not have is REFUSED, never coerced
			 * to `main`: a message written to a lane nothing will ever render
			 * is the shape of data loss even though the row is still there.
			 * The sentence is the store's own (`channelRefusal`).
			 */
			{
				const refusal = await channelRefusal(db, sessionId, channel)
				if (refusal) {
					return refuse(`Cannot send here: ${refusal}`)
				}
			}

			/**
			 * 🚧 A **personal** channel (owner ruling 2026-10-17): the send
			 * lands on the sender's own lane — a bare slug resolves to it,
			 * opening it on first use — and a lane that is not theirs is
			 * refused, the session's owner included: reading every lane is
			 * not writing in somebody else's.
			 */
			{
				const { isPersonalChannel, laneFor, sessionLaneFacts, LaneRefusal } = await import(
					"$lib/server/channels/lanes"
				)
				const facts = await sessionLaneFacts(db, sessionId)
				const asked = parseChannel(typeof params.channel === "string" ? params.channel : channel)
				if (facts && isPersonalChannel(facts.shape, asked.slug)) {
					try {
						const own = await laneFor(db, sessionId, asked.slug, userId)
						if (asked.explicit && formatChannel(asked) !== own.channel)
							return refuse("Cannot send here: that lane is another person's.")
						channel = own.channel
					} catch (error) {
						if (error instanceof LaneRefusal) return refuse(`Cannot send here: ${error.message}`)
						throw error
					}
				}
			}

			// 🚧 A line with no persona from a card-less player seat speaks from
			// that seat (`player-seat:<id>`), as an envoy's line names its envoy —
			// the fact the turn order reads to call it that seat's turn.
			const { cardlessPlayerSeatOf, playerSeatSpeaker } = await import(
				"$lib/server/sessions/seatName"
			)
			/**
			 * 🚧 A card whose seats here are all out of play, benched or removed
			 * (a new character after a death, PLAN-dc-after-walk2 Q0-2, owner
			 * ruling ★2; the bench, 2026-11-10): the card stays with the fallen
			 * seat, and a line sent with it while the person has an in-play
			 * card-less seat speaks from that seat — the new character,
			 * under its own name, whose line the round counts. A composer from
			 * before the seat moved still sends the card.
			 */
			let speakingCard = personaId ?? null
			if (speakingCard) {
				const held = await db
					.select({
						removedAt: schema.sessionPersonas.removedAt,
						isActive: schema.sessionPersonas.isActive
					})
					.from(schema.sessionPersonas)
					.where(
						and(
							eq(schema.sessionPersonas.sessionId, sessionId),
							eq(schema.sessionPersonas.personaId, speakingCard)
						)
					)
				if (held.length && held.every((h) => !inPlay(h))) {
					if ((await cardlessPlayerSeatOf(db, sessionId, userId)) !== null) speakingCard = null
				}
			}
			const seatId = speakingCard ? null : await cardlessPlayerSeatOf(db, sessionId, userId)

			/**
			 * Attachments (PLAN-composer-attachments §3.1): the sender's ready
			 * tray items become `core:image` / `core:file` parts of the saved
			 * row, in one transaction with it — or the save is refused whole
			 * and the tray stays. The ids are checked for shape here, at the
			 * door; the rest (theirs, ready, a kind the reply reads) at the
			 * write. Guests send the same way (D8).
			 */
			const { normaliseTrayItemIds } = await import("$lib/server/attachments/send")
			const { TrayRefusal } = await import("$lib/server/attachments/tray")
			let trayItemIds: string[]
			try {
				trayItemIds = normaliseTrayItemIds(params.trayItemIds)
			} catch (error) {
				if (!(error instanceof TrayRefusal)) throw error
				return refuse(error.message)
			}

			/**
			 * 🚧 **Saved through the pipeline** (owner ruling 2026-10-15): the
			 * door is checked — a composer the genre closed on this lane is
			 * refused inside the offer (`composerRefusal`), with its reason —
			 * so the message is offered to the session's save
			 * pipeline (`message-offered`) — core's `core:spec/save-message`
			 * unless the genre binds its own — which writes the row, announces
			 * it and fires its `message-completed` under the person's cause.
			 * The host writes no person's row. A refusal comes back as a
			 * sentence, and the composer restores the text.
			 */
			const { offerMessage } = await import("$lib/server/sessions/offerMessage")
			const outcome = await offerMessage(db, {
				sessionId,
				userId,
				speaker: speakingCard
					? await playerSeatRefOfPersona(db, sessionId, speakingCard)
					: seatId !== null
						? playerSeatSpeaker(seatId)
						: null,
				channel,
				text: content ?? "",
				trayItemIds,
				replyTo: params.replyTo ?? null,
				io: socket.io,
				reader: socket.user
			})
			if ("refused" in outcome)
				return refuse(outcome.refused, outcome.runId)

			// The saved row, with parts on it when it carries any — the same
			// enrichment a load gets — so the sender's composer clears on the
			// answer itself rather than racing the push.
			const saved =
				outcome.messageId !== null
					? await db.query.sessionMessages.findFirst({
							where: (m, { eq }) => eq(m.id, outcome.messageId!)
						})
					: undefined
			const outbound = saved
				? ((await attachParts(db, [saved as any]))[0] as typeof saved)
				: undefined
			const res: Sockets.SessionMessages.SendPersonaMessage.Response = {
				sessionId,
				accepted: true,
				runId: outcome.runId,
				...(outbound ? { sessionMessage: outbound as any } : {})
			}
			emitToUser("sessionMessages:sendPersonaMessage", res)

			// The sent tray items are gone: every tab of the sender's drops
			// their tiles from the same list reply a reload reads.
			if (trayItemIds.length) {
				const { listTray } = await import("$lib/server/attachments/tray")
				emitToUser("attachments:list", {
					sessionId,
					tray: await listTray(db, userId, sessionId)
				})
			}

			// The line this session's cards quote has just changed.
			broadcastSessionRow(socket.io, sessionId)

			/**
			 * **The send starts nothing** (PLAN-turn-order §3, §4.6; A7).
			 *
			 * A reply follows one road, and none of it is
			 * here: the saved row's `message-completed` recomputes the
			 * session's turn order, the write emits `turn-order-changed`,
			 * and the auto-advance listener fires the head turn if — and
			 * only if — the session says to. With `off` the send produces no
			 * reply until Continue, which is the feature.
			 */

			return res
		} catch (error: any) {
			console.error("Error sending persona message:", error)
			const res: Sockets.SessionMessages.SendPersonaMessage.Response = {
				sessionId: params?.sessionId,
				error: "Failed to send message",
				refused: "Your message could not be sent. Your text was kept."
			}
			// The composer restores the text on the answer (silently — `error`
			// says the catch-all below toasts the `:error`).
			emitToUser("sessionMessages:sendPersonaMessage", res)
			emitToUser("sessionMessages:sendPersonaMessage:error", res)
			throw error
		}
	}
}

export const sessionMessagesUpdateHandler: Handler<
	Sockets.SessionMessages.Update.Params,
	Sockets.SessionMessages.Update.Response
> = {
	event: "sessionMessages:update",
	handler: async (socket, params, emitToUser) => {
		try {
			const { id, content, isHidden } = params
			const userId = socket.user!.id

			// Persona messages: only that persona's owner. Character messages:
			// the session owner or that character's owner. See
			// messages/permissions.ts for the full rationale.
			const canEdit = await canActOnMessage(db, id, userId)
			if (!canEdit) {
				const res: Sockets.SessionMessages.Update.Response = {
					sessionMessage: undefined,
					error: "You don't have permission to edit this message"
				}
				emitToUser("sessionMessages:update:error", res)
				return res
			}

			// Get the existing message to check metadata
			const [existingMessage] = await db
				.select()
				.from(schema.sessionMessages)
				.where(eq(schema.sessionMessages.id, id))

			if (!existingMessage) {
				const res: Sockets.SessionMessages.Update.Response = {
					sessionMessage: undefined,
					error: "Message not found"
				}
				emitToUser("sessionMessages:update", res)
				return res
			}

			// 🚧 pr-6 R-k: an archived session is read-only — no edit, no hide.
			{
				const archived = await sessionArchivedRefusal(db, existingMessage.sessionId)
				if (archived) {
					const res: Sockets.SessionMessages.Update.Response = {
						sessionMessage: undefined,
						error: archived
					}
					emitToUser("sessionMessages:update:error", res)
					return res
				}
			}

			// The genre's declared availability (20 §4, R-15). Edit is a
			// floor — no declaration can forbid it, and `verbRefusal` has no
			// key for it — so only the hide half is asked about availability:
			// a ghost is an opt-in built-in a genre may switch off. Both halves
			// ask their enabled-when (U5e, review W2): edit not on a hidden
			// row and not while generating, hide not while generating.
			if (isHidden !== undefined) {
				const hideRefusal = await verbRefusal(
					db,
					existingMessage.sessionId,
					"hide",
					{ messageId: existingMessage.id, userId }
				)
				if (hideRefusal) {
					const res: Sockets.SessionMessages.Update.Response = {
						sessionMessage: undefined,
						error: hideRefusal
					}
					emitToUser("sessionMessages:update:error", res)
					return res
				}
			}
			if (content !== undefined) {
				const editRefusal = await verbEnablementRefusal(
					db,
					existingMessage.sessionId,
					"edit",
					{ messageId: existingMessage.id, userId }
				)
				if (editRefusal) {
					const res: Sockets.SessionMessages.Update.Response = {
						sessionMessage: undefined,
						error: editRefusal
					}
					emitToUser("sessionMessages:update:error", res)
					return res
				}
			}

			if (
				content !== undefined &&
				content.length > MAX_CHAT_MESSAGE_LENGTH
			) {
				const res: Sockets.SessionMessages.Update.Response = {
					sessionMessage: undefined,
					error: `Message too long (max ${MAX_CHAT_MESSAGE_LENGTH.toLocaleString()} characters).`
				}
				emitToUser("sessionMessages:update:error", res)
				return res
			}

			/**
			 * The writes are built-ins (R-15): each runs as its own
			 * receipted, gate-eligible one-node spec, emits what changed —
			 * the previous text on an edit, the direction on a hide — and
			 * the host announces the row from the commit, so nothing is
			 * broadcast from here. The permission checks above are the
			 * venue's; the write is core's.
			 */
			const { runBuiltIn } = await import(
				"$lib/server/pipelines/runtime/builtins"
			)
			if (content !== undefined) {
				const edited = await runBuiltIn(db, {
					kind: "edit",
					sessionId: existingMessage.sessionId,
					actor: userId,
					payload: { target: id, text: content },
					io: socket.io
				})
				if (!edited.ok) {
					const res: Sockets.SessionMessages.Update.Response = {
						sessionMessage: undefined,
						error: edited.error ?? "Failed to update message"
					}
					emitToUser("sessionMessages:update:error", res)
					return res
				}
			}
			if (isHidden !== undefined) {
				const hidden = await runBuiltIn(db, {
					kind: "hide",
					sessionId: existingMessage.sessionId,
					actor: userId,
					payload: { target: id, hidden: isHidden },
					io: socket.io
				})
				if (!hidden.ok) {
					const res: Sockets.SessionMessages.Update.Response = {
						sessionMessage: undefined,
						error: hidden.error ?? "Failed to update message"
					}
					emitToUser("sessionMessages:update:error", res)
					return res
				}
			}

			const updated = await db.query.sessionMessages.findFirst({
				where: (cm, { eq }) => eq(cm.id, id)
			})
			if (!updated) {
				const res: Sockets.SessionMessages.Update.Response = {
					sessionMessage: undefined,
					error: "Message not found"
				}
				emitToUser("sessionMessages:update", res)
				return res
			}

			// G5/G6 (D64): a guest may edit a line of a character they own.
			const res: Sockets.SessionMessages.Update.Response = {
				sessionMessage: (await rowShownTo(updated, userId, socket.user)) as any
			}
			emitToUser("sessionMessages:update", res)
			return res
		} catch (error: any) {
			console.error("Error updating session message:", error)
			const res: Sockets.SessionMessages.Update.Response = {
				sessionMessage: undefined,
				error: "Failed to update message"
			}
			emitToUser("sessionMessages:update:error", res)
			throw error
		}
	}
}

/**
 * 🚧 **The held door** (programme 0.9, owner 2026-11-16: "have the user
 * manually stop what ever is running first"): swipe, regenerate, retake, Back
 * and delete are refused with one sentence while an action, a routine or a
 * reply is running in the session — asked BEFORE the press waits on the
 * generation lock, or a press queued behind a run would simply go through
 * once it ended. A run parked at review or bound to one line holds nothing;
 * Edit, Forward, sending and Continue are never asked. `null` when the press
 * may go on, and for someone with no access (their own refusal comes first).
 * `settle`: every held press lets the turn's own background runs settle first
 * (a press a beat after a turn); pass `true`.
 */
async function heldRerunRefusal(
	sessionId: number,
	userId: number,
	settle = false
): Promise<string | null> {
	const access = await checkSessionAccess(sessionId, userId)
	if (!access.hasAccess) return null
	if (settle) {
		const { settleBackgroundRuns } = await import("$lib/server/pipelines/entities/publishedValues")
		await settleBackgroundRuns(db, sessionId)
	}
	const { quietRefusal } = await import("$lib/server/pipelines/runtime/runsInProgress")
	return quietRefusal(db, sessionId)
}

export const sessionMessagesDeleteHandler: Handler<
	Sockets.SessionMessages.Delete.Params,
	Sockets.SessionMessages.Delete.Response
> = {
	event: "sessionMessages:delete",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = socket.user!.id

			// First get the message to check permissions
			const message = await db.query.sessionMessages.findFirst({
				where: (cm, { eq }) => eq(cm.id, params.id)
			})

			if (!message || message.rewindOrdinal != null) {
				// 🚧 A row Back took out is in no history to delete from (RF fix 5).
				const res: Sockets.SessionMessages.Delete.Response = {
					id: params.id,
					error: "Message not found"
				}
				emitToUser("sessionMessages:delete", res)
				return res
			}

			// Check if user can edit this message (based on message edit permissions)
			const canEdit = await canActOnMessage(db, params.id, userId)
			if (!canEdit) {
				const res: Sockets.SessionMessages.Delete.Response = {
					id: params.id,
					error: "Access denied. You can only delete messages from your own characters/personas or if you own the session."
				}
				emitToUser("sessionMessages:delete", res)
				return res
			}

			/**
			 * 🚧 **Deletion needs a pipeline** (RF fix 5, owner ruling
			 * 2026-10-23): offered, and performed, only where the session's
			 * registrations hold one on `message-deletion-asked` — core
			 * registers none, so deleting is off by default. The press
			 * raises the event; the registered pipeline does the work
			 * (`messages/deletion.ts`).
			 */
			const { askDeletion, deletionOffered, DELETION_OFF } = await import(
				"$lib/server/messages/deletion"
			)
			if (!(await deletionOffered(db, message.sessionId))) {
				const res: Sockets.SessionMessages.Delete.Response = {
					id: params.id,
					error: DELETION_OFF
				}
				emitToUser("sessionMessages:delete", res)
				return res
			}
			const deleteWait = await heldRerunRefusal(message.sessionId, userId, true)
			if (deleteWait) {
				const res: Sockets.SessionMessages.Delete.Response = {
					id: params.id,
					error: deleteWait
				}
				emitToUser("sessionMessages:delete", res)
				return res
			}
			// ⏳ A genre's `messageVerbs.delete: false` still takes Delete away
			// where a pipeline would offer it (R-15): presence is presentation,
			// the refusal is the law.
			const deleteRefusal = await verbRefusal(
				db,
				message.sessionId,
				"delete",
				{ messageId: message.id, userId }
			)
			if (deleteRefusal) {
				const res: Sockets.SessionMessages.Delete.Response = {
					id: params.id,
					error: deleteRefusal
				}
				emitToUser("sessionMessages:delete", res)
				return res
			}

			// 🚧 A genre that keeps its turns (Honour mode, owner rulings
			// 2026-10-15): an older turn is never deleted, the latest only by
			// the owner with Honour mode on — and a row its run wrote takes
			// the whole turn with it, as a retake would, firing nothing. ⚠
			// Reached only behind the door above (RF fix 5): a genre that
			// keeps its turns and registers a deletion pipeline; the turn is
			// deleted whole by the host's turn rule, never one row of it.
			const turnVerdict = await turnDeleteVerdict(
				db,
				message.sessionId,
				message.id,
				userId
			)
			if (turnVerdict && "refusal" in turnVerdict) {
				const res: Sockets.SessionMessages.Delete.Response = {
					id: params.id,
					error: turnVerdict.refusal
				}
				emitToUser("sessionMessages:delete", res)
				return res
			}
			if (turnVerdict && "turn" in turnVerdict) {
				// 🚧 On revision `branch` (PLAN-rulesets §28): the turn is not
				// deleted — the session forks before it and play goes on in
				// the branch; the old tail stays here.
				if (turnVerdict.revision.mode === "branch") {
					const { branchForRevision } = await import(
						"$lib/server/sessions/revision"
					)
					const first = Math.min(
						...turnVerdict.turn.rows.map((r) => r.messageId)
					)
					const branched = await branchForRevision(db, {
						sessionId: message.sessionId,
						userId,
						firstRevisedId: first,
						// 🚧 The deleted turn's writes stay out of the branch (B8).
						runs: turnVerdict.turn.runs,
						io: socket.io
					})
					const res: Sockets.SessionMessages.Delete.Response = branched.ok
						? {
								id: params.id,
								success: "Branched here",
								branchedTo: branched.sessionId,
								revision: turnVerdict.revision
							}
						: { id: params.id, error: branched.error }
					emitToUser("sessionMessages:delete", res)
					if (branched.ok) {
						await relistWithRow(socket, emitToUser, branched.sessionId)
					}
					return res
				}
				const { deleteTurnYield } = await import(
					"$lib/server/sessions/retakeTurn"
				)
				const gone = await deleteTurnYield(db, {
					sessionId: message.sessionId,
					userId,
					turn: turnVerdict.turn,
					io: socket.io
				})
				const res: Sockets.SessionMessages.Delete.Response = gone.ok
					? { id: params.id, success: "Turn deleted" }
					: { id: params.id, error: gone.error }
				emitToUser("sessionMessages:delete", res)
				if (gone.ok) {
					await resendSession(socket, message.sessionId, emitToUser)
					broadcastSessionRow(socket.io, message.sessionId)
				}
				return res
			}

			const deleted = await askDeletion(db, {
				sessionId: message.sessionId,
				messageId: params.id,
				userId,
				io: socket.io,
				reader: socket.user
			})
			if (!deleted.deleted) {
				const res: Sockets.SessionMessages.Delete.Response = {
					id: params.id,
					error: deleted.refused
				}
				emitToUser("sessionMessages:delete", res)
				return res
			}

			// A reply that failed on this row has nothing left to open.
			await clearReplyFailed(message.sessionId, message.id)

			const res: Sockets.SessionMessages.Delete.Response = {
				id: params.id,
				success: "Message deleted successfully"
			}
			emitToUser("sessionMessages:delete", res)

			// 🚧 What was anchored to the row went with it (Q1-3): every sheet
			// re-reads now, never on its next reload.
			await broadcastToSessionUsers(socket.io, message.sessionId, "state:changed", {
				sessionId: message.sessionId
			} satisfies Sockets.State.Changed.Response).catch((e: unknown) =>
				console.warn("[sessionMessages:delete] state:changed failed:", e)
			)

			// Emit sessions:get to refresh the entire session after deletion
			await resendSession(socket, message.sessionId, emitToUser)

			// A delete can take the quoted line away entirely — the push says
			// so with a null `lastMessage`.
			broadcastSessionRow(socket.io, message.sessionId)

			return res
		} catch (error: any) {
			console.error("Error deleting session message:", error)
			const res: Sockets.SessionMessages.Delete.Response = {
				id: params.id,
				error: "Failed to delete message"
			}
			emitToUser("sessionMessages:delete:error", res)
			throw error
		}
	}
}

export const sessionMessagesRegenerateHandler: Handler<
	Sockets.SessionMessages.Regenerate.Params,
	Sockets.SessionMessages.Regenerate.Response
> = {
	event: "sessionMessages:regenerate",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = socket.user!.id

			// Get the message to regenerate first — needed to learn sessionId,
			// which is the lock key, before we can acquire it.
			const messageToRegenerate =
				await db.query.sessionMessages.findFirst({
					where: (cm, { eq }) => eq(cm.id, params.id)
				})

			if (!messageToRegenerate) {
				const res: Sockets.SessionMessages.Regenerate.Response = {
					sessionMessage: undefined,
					error: "Message not found"
				}
				emitToUser("sessionMessages:regenerate", res)
				return res
			}

			const regenerateWait = await heldRerunRefusal(messageToRegenerate.sessionId, userId, true)
			if (regenerateWait) {
				const res: Sockets.SessionMessages.Regenerate.Response = {
					sessionMessage: undefined,
					error: regenerateWait
				}
				emitToUser("sessionMessages:regenerate", res)
				return res
			}

			return await withSessionGenerationLock(
				messageToRegenerate.sessionId,
				async () => {
					// 🚧 A person pressed something: an interaction (R11, R21; lane 6).
					const access = await checkSessionAccess(messageToRegenerate.sessionId, socket.user!.id)
					await noteSocketInteraction(access, messageToRegenerate.sessionId, "action")
					// see canActOnMessage — four branches.
					const canEdit = await canActOnMessage(
						db,
						params.id,
						userId,
						"rerun"
					)
					if (!canEdit) {
						const res: Sockets.SessionMessages.Regenerate.Response =
							{
								sessionMessage: undefined,
								error: "Access denied. You don't have permission to regenerate this message."
							}
						emitToUser("sessionMessages:regenerate", res)
						return res
					}

					// The mode's declared verb policy (20 §4): presence is
					// presentation, refusal is the law.
					const retryRefusal = await verbRefusal(
						db,
						messageToRegenerate.sessionId,
						"retry",
						{ messageId: messageToRegenerate.id, userId }
					)
					if (retryRefusal) {
						const res: Sockets.SessionMessages.Regenerate.Response =
							{
								sessionMessage: undefined,
								error: retryRefusal
							}
						emitToUser("sessionMessages:regenerate", res)
						return res
					}

					// Freshness guard, re-checked now that the lock is held — a
					// queued call must see whatever the call ahead of it in line
					// already committed, not a stale pre-lock snapshot. Mirrors
					// sessionsFireTurnHandler's own in-lock check.
					const alreadyGenerating =
						await db.query.sessionMessages.findFirst({
							where: (cm, { and, eq }) =>
								and(
									eq(
										cm.sessionId,
										messageToRegenerate.sessionId
									),
									eq(cm.isGenerating, true)
								)
						})
					if (alreadyGenerating) {
						const res: Sockets.SessionMessages.Regenerate.Response =
							{
								sessionMessage: undefined,
								error: "A response is already generating in this session."
							}
						emitToUser("sessionMessages:regenerate:error", res)
						return res
					}

					const currentMetadata =
						(messageToRegenerate.metadata as any) || {}

					// Take back what this reply changed about the world.
					//
					// ⚠ A regenerate REPLACES the text and keeps the row, so
					// nothing is deleted and the `messages.id` cascade that
					// retracts anchored state on a real delete never fires. The
					// values this message wrote would otherwise
					// outlive the sentence that justified them; the new reply
					// proposes its own.
					//
					// 🚧 The clock moves this reply carried go back with it
					// (live scenes §15 G5) — refused in words, before anything
					// is written, when the calendar cannot take one back.
					// "replaced": the message stays and is told again — it keeps
					// the round's tick (★ST2-1) and any `keepOnRetell` fields.
					let retracted: Awaited<ReturnType<typeof retractStateAnchoredTo>>
					try {
						retracted = await retractStateAnchoredTo(db, params.id, "replaced")
					} catch (e) {
						const { StoryClockRefusal } = await import("$lib/server/state/storyTime")
						if (!(e instanceof StoryClockRefusal || e instanceof SettledRefusal)) throw e
						const res: Sockets.SessionMessages.Regenerate.Response = {
							sessionMessage: undefined,
							error: e.message
						}
						emitToUser("sessionMessages:regenerate", res)
						return res
					}
					if (retracted.clockMoved)
						broadcastSessionRow(socket.io, messageToRegenerate.sessionId)
					// The seats the old reply benched or brought back, told to open pages.
					await announceSeatChanges(
						db,
						socket.io,
						{ sessionId: messageToRegenerate.sessionId, userId: socket.user!.id },
						retracted.seatChanges
					)
					// 🚧 Announced once the retraction has committed (live
					// scenes §15 G14), as an outlet's write announces: every
					// tab re-reads its state and the ledger loses the old
					// reply's lines now, not on the new reply's turn.
					if (retracted.changed)
						await broadcastToSessionUsers(
							socket.io,
							messageToRegenerate.sessionId,
							"state:changed",
							{
								sessionId: messageToRegenerate.sessionId
							} satisfies Sockets.State.Changed.Response
						)

					// Clear the content and set as generating. A stop's
					// outcome from an earlier run does not survive the reopen.
					const [updated] = await updateLegacyWhere(
						db,
						eq(schema.sessionMessages.id, params.id),
						{
							content: "",
							isGenerating: true,
							// No status yet: the run this row waits on says
							// what it is doing once it starts (R-19).
							generationStatus: null,
							generationOutcome: null,
							error: null,
							metadata: currentMetadata
						}
					)

					// The earlier failure on this row is superseded — cleared
					// BEFORE the run, so a failure of this one raises afresh.
					await clearReplyFailed(
						messageToRegenerate.sessionId,
						params.id
					)

					const res: Sockets.SessionMessages.Regenerate.Response = {
						sessionMessage: (await rowShownTo(updated, socket.user!.id, socket.user)) as any
					}
					emitToUser("sessionMessages:regenerate", res)

					// Broadcast sessionMessage to all session participants
					await broadcastToSessionUsers(
						socket.io,
						updated.sessionId,
						"sessionMessage",
						{ sessionMessage: updated }
					)

					// Start generating the response — the run's placeholder
					// outlet claims this row instead of inserting (R-17). The
					// text this handler just cleared rides along as `previous`,
					// so the finishing write can say what the regenerate
					// replaced (U5b review W3).
					await runReply({
						socket,
						emitToUser,
						sessionId: messageToRegenerate.sessionId,
						userId,
						turn: {
							kind: "regenerate",
							messageId: params.id,
							previous: { content: messageToRegenerate.content }
						}
					})

					// The row the cards quote is whatever the run left
					// behind. The chunks along the way pushed their own
					// (`runtime/liveRow.ts`); this is the settled line.
					broadcastSessionRow(
						socket.io,
						messageToRegenerate.sessionId
					)

					return res
				}
			)
		} catch (error: any) {
			console.error("Error regenerating session message:", error)
			const res: Sockets.SessionMessages.Regenerate.Response = {
				sessionMessage: undefined,
				error:
					error instanceof Error
						? error.message
						: "Failed to regenerate message"
			}
			emitToUser("sessionMessages:regenerate:error", res)
			throw error
		}
	}
}

export const sessionMessagesExtendHandler: Handler<
	Sockets.SessionMessages.Extend.Params,
	Sockets.SessionMessages.Extend.Response
> = {
	event: "sessionMessages:extend",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = socket.user!.id

			// Get the message to extend first — needed to learn sessionId,
			// which is the lock key, before we can acquire it.
			const messageToExtend = await db.query.sessionMessages.findFirst({
				where: (cm, { eq }) => eq(cm.id, params.id)
			})

			if (!messageToExtend) {
				const res: Sockets.SessionMessages.Extend.Response = {
					sessionMessage: undefined,
					error: "Message not found"
				}
				emitToUser("sessionMessages:extend", res)
				return res
			}

			return await withSessionGenerationLock(
				messageToExtend.sessionId,
				async () => {
					// 🚧 A person pressed something: an interaction (R11, R21; lane 6).
					const access = await checkSessionAccess(messageToExtend.sessionId, socket.user!.id)
					await noteSocketInteraction(access, messageToExtend.sessionId, "action")
					// see canActOnMessage — four branches.
					const canEdit = await canActOnMessage(
						db,
						params.id,
						userId,
						"rerun"
					)
					if (!canEdit) {
						const res: Sockets.SessionMessages.Extend.Response = {
							sessionMessage: undefined,
							error: "Access denied. You don't have permission to extend this message."
						}
						emitToUser("sessionMessages:extend", res)
						return res
					}

					// The mode's declared verb policy (20 §4), AND whether the
					// connection this session's replies run on can actually
					// resume a partial one.
					//
					// The second half is not a nicety. A continuation is only a
					// continuation when the model is handed the text so far
					// inside an open assistant turn; every other shape produces
					// a fresh reply that `joinContinuation` glues onto the
					// partial, and the seam reads as the model repeating itself
					// rather than as a fault. `extendVerbRefusal` composes the
					// two and hands back one sentence — the same one the button
					// wears as its title, from the same resolution.
					const extendRefusal = await extendVerbRefusal(
						db,
						messageToExtend.sessionId,
						userId,
						messageToExtend.id
					)
					if (extendRefusal) {
						const res: Sockets.SessionMessages.Extend.Response = {
							sessionMessage: undefined,
							error: extendRefusal
						}
						emitToUser("sessionMessages:extend", res)
						return res
					}

					// Freshness guard, re-checked now that the lock is held — see
					// the identical comment in sessionMessagesRegenerateHandler.
					const alreadyGenerating =
						await db.query.sessionMessages.findFirst({
							where: (cm, { and, eq }) =>
								and(
									eq(
										cm.sessionId,
										messageToExtend.sessionId
									),
									eq(cm.isGenerating, true)
								)
						})
					if (alreadyGenerating) {
						const res: Sockets.SessionMessages.Extend.Response = {
							sessionMessage: undefined,
							error: "A response is already generating in this session."
						}
						emitToUser("sessionMessages:extend:error", res)
						return res
					}

					// Get current metadata and preserve it
					const currentMetadata =
						(messageToExtend.metadata as any) || {}

					// Set as generating but KEEP existing content
					// The content is the prefill the continuation starts from
					const [updated] = await updateLegacyWhere(
						db,
						eq(schema.sessionMessages.id, params.id),
						{
							isGenerating: true,
							// No status yet: the run this row waits on says
							// what it is doing once it starts (R-19).
							generationStatus: null,
							generationOutcome: null,
							error: null,
							metadata: currentMetadata
						}
					)

					const res: Sockets.SessionMessages.Extend.Response = {
						sessionMessage: (await rowShownTo(updated, socket.user!.id, socket.user)) as any
					}
					emitToUser("sessionMessages:extend", res)

					// Broadcast sessionMessage to all session participants
					await broadcastToSessionUsers(
						socket.io,
						updated.sessionId,
						"sessionMessage",
						{ sessionMessage: updated }
					)

					// Start generating the continuation — the run's placeholder
					// outlet claims this row, text and all, and the partial
					// rides to the seed line on `continuationPrefill`.
					await runReply({
						socket,
						emitToUser,
						sessionId: messageToExtend.sessionId,
						userId,
						turn: { kind: "extend", messageId: params.id }
					})

					// The continuation is part of the same line, and the
					// cards quote it as it now reads.
					broadcastSessionRow(socket.io, messageToExtend.sessionId)

					return res
				}
			)
		} catch (error: any) {
			console.error("Error continuing session message:", error)
			const res: Sockets.SessionMessages.Extend.Response = {
				sessionMessage: undefined,
				error:
					error instanceof Error
						? error.message
						: "Failed to extend message"
			}
			emitToUser("sessionMessages:extend:error", res)
			throw error
		}
	}
}

export const sessionMessagesSwipeLeftHandler: Handler<
	Sockets.SessionMessages.SwipeLeft.Params,
	Sockets.SessionMessages.SwipeLeft.Response
> = {
	event: "sessionMessages:swipeLeft",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = socket.user!.id

			// Get the message first to check session access
			const message = await db.query.sessionMessages.findFirst({
				where: (cm, { eq }) => eq(cm.id, params.id)
			})

			if (!message) {
				const res: Sockets.SessionMessages.SwipeLeft.Response = {
					sessionMessage: undefined,
					error: "Message not found"
				}
				emitToUser("sessionMessages:swipeLeft", res)
				return res
			}

			if (message.isGenerating) {
				const res: Sockets.SessionMessages.SwipeLeft.Response = {
					sessionMessage: undefined,
					error: "Message is still generating, please wait."
				}
				emitToUser("sessionMessages:swipeLeft", res)
				return res
			}

			if (message.isHidden) {
				const res: Sockets.SessionMessages.SwipeLeft.Response = {
					sessionMessage: undefined,
					error: "Message is hidden, cannot swipe left."
				}
				emitToUser("sessionMessages:swipeLeft", res)
				return res
			}

			if (message.role !== "assistant") {
				const res: Sockets.SessionMessages.SwipeLeft.Response = {
					sessionMessage: undefined,
					error: "Only assistant messages can be swiped."
				}
				emitToUser("sessionMessages:swipeLeft", res)
				return res
			}

			// The freeze rule (20 §1): once a stepped activity has advanced,
			// step 0's selection is frozen at what produced the later steps —
			// legacy swiping only ever addresses step 0, so it refuses here.
			if (await hasNativeSteps(db, message.id)) {
				const res: Sockets.SessionMessages.SwipeLeft.Response = {
					sessionMessage: undefined,
					error: "This activity has moved past its first step — earlier steps are frozen. Step back first."
				}
				emitToUser("sessionMessages:swipeLeft", res)
				return res
			}

			const swipeLeftWait = await heldRerunRefusal(message.sessionId, userId, true)
			if (swipeLeftWait) {
				const res: Sockets.SessionMessages.SwipeLeft.Response = {
					sessionMessage: undefined,
					error: swipeLeftWait
				}
				emitToUser("sessionMessages:swipeLeft", res)
				return res
			}

			// Regenerate/Extend/SwipeRight all wrap their mutation in the
			// per-session generation lock; without it here, a SwipeRight/
			// Regenerate/Extend racing against a concurrent SwipeLeft on
			// the same message could have its isGenerating/queueItemId
			// state clobbered back to the stale pre-read values below.
			return await withSessionGenerationLock(message.sessionId, async () => {
				// 🚧 A person pressed something: an interaction (R11, R21; lane 6).
				const access = await checkSessionAccess(message.sessionId, socket.user!.id)
				await noteSocketInteraction(access, message.sessionId, "action")
				// see canActOnMessage — four branches.
				const canEdit = await canActOnMessage(
					db,
					params.id,
					userId,
					"rerun"
				)
				if (!canEdit) {
					const res: Sockets.SessionMessages.SwipeLeft.Response = {
						sessionMessage: undefined,
						error: "Access denied. You don't have permission to swipe this message."
					}
					emitToUser("sessionMessages:swipeLeft", res)
					return res
				}

				// An opt-in built-in (R-15): a genre may switch swipe off.
				const swipeRefusal = await verbRefusal(
					db,
					message.sessionId,
					"swipe"
				)
				if (swipeRefusal) {
					const res: Sockets.SessionMessages.SwipeLeft.Response = {
						sessionMessage: undefined,
						error: swipeRefusal
					}
					emitToUser("sessionMessages:swipeLeft", res)
					return res
				}

				const swipes = message.metadata?.swipes
				const currentIdx = swipes?.currentIdx ?? null
				// On the first alternative (idx 0 or null), or no alternatives
				// at all: nothing to the left.
				if (
					!swipes?.history?.length ||
					currentIdx === null ||
					currentIdx === 0
				) {
					const res: Sockets.SessionMessages.SwipeLeft.Response = {
						sessionMessage: undefined,
						error: "Already on the first swipe, cannot swipe left."
					}
					emitToUser("sessionMessages:swipeLeft", res)
					return res
				}

				// The write is core's built-in (R-15): `swipe-message` selects
				// the alternative to the left, emits `message-swiped` with the
				// one that was showing, and announces the row from the commit.
				const { runBuiltIn } = await import(
					"$lib/server/pipelines/runtime/builtins"
				)
				const swiped = await runBuiltIn(db, {
					kind: "swipe",
					sessionId: message.sessionId,
					actor: userId,
					payload: { target: message.id, index: currentIdx - 1 },
					io: socket.io
				})
				if (!swiped.ok) {
					const res: Sockets.SessionMessages.SwipeLeft.Response = {
						sessionMessage: undefined,
						error: swiped.error ?? "Failed to update session message."
					}
					emitToUser("sessionMessages:swipeLeft", res)
					return res
				}
				const updated = await db.query.sessionMessages.findFirst({
					where: (cm, { eq }) => eq(cm.id, message.id)
				})
				if (!updated) {
					const res: Sockets.SessionMessages.SwipeLeft.Response = {
						sessionMessage: undefined,
						error: "Failed to update session message."
					}
					emitToUser("sessionMessages:swipeLeft", res)
					return res
				}

				await clearReplyFailed(message.sessionId, message.id)

				const res: Sockets.SessionMessages.SwipeLeft.Response = {
					sessionMessage: (await rowShownTo(updated, socket.user!.id, socket.user)) as any
				}
				emitToUser("sessionMessages:swipeLeft", res)

				// A swipe rewrites the row in place, so the quoted line moves
				// without any row being added or removed.
				broadcastSessionRow(socket.io, message.sessionId)
				return res
			})
		} catch (error: any) {
			console.error("Error swiping left session message:", error)
			const res: Sockets.SessionMessages.SwipeLeft.Response = {
				sessionMessage: undefined,
				error: "Failed to swipe left"
			}
			emitToUser("sessionMessages:swipeLeft:error", res)
			throw error
		}
	}
}

export const sessionMessagesSwipeRightHandler: Handler<
	Sockets.SessionMessages.SwipeRight.Params,
	Sockets.SessionMessages.SwipeRight.Response
> = {
	event: "sessionMessages:swipeRight",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = socket.user!.id

			// Get the message first — needed to learn sessionId, which is the
			// lock key, before we can acquire it.
			const message = await db.query.sessionMessages.findFirst({
				where: (cm, { eq }) => eq(cm.id, params.id)
			})

			if (!message) {
				const res: Sockets.SessionMessages.SwipeRight.Response = {
					sessionMessage: undefined,
					error: "Message not found"
				}
				emitToUser("sessionMessages:swipeRight", res)
				return res
			}

			// The freeze rule (20 §1) — see swipeLeft.
			if (await hasNativeSteps(db, message.id)) {
				const res: Sockets.SessionMessages.SwipeRight.Response = {
					sessionMessage: undefined,
					error: "This activity has moved past its first step — earlier steps are frozen. Step back first."
				}
				emitToUser("sessionMessages:swipeRight", res)
				return res
			}

			const swipeRightWait = await heldRerunRefusal(message.sessionId, userId, true)
			if (swipeRightWait) {
				const res: Sockets.SessionMessages.SwipeRight.Response = {
					sessionMessage: undefined,
					error: swipeRightWait
				}
				emitToUser("sessionMessages:swipeRight", res)
				return res
			}

			return await withSessionGenerationLock(message.sessionId, async () => {
				// 🚧 A person pressed something: an interaction (R11, R21; lane 6).
				const access = await checkSessionAccess(message.sessionId, socket.user!.id)
				await noteSocketInteraction(access, message.sessionId, "action")
				// see canActOnMessage — four branches.
				const canEdit = await canActOnMessage(
					db,
					params.id,
					userId,
					"rerun"
				)
				if (!canEdit) {
					const res: Sockets.SessionMessages.SwipeRight.Response = {
						sessionMessage: undefined,
						error: "Access denied. You don't have permission to swipe this message."
					}
					emitToUser("sessionMessages:swipeRight", res)
					return res
				}

				// An opt-in built-in (R-15): a genre may switch swipe off.
				// …and its enabled-when (U5e): the newest row, a swipe to take,
				// nothing generating — the ⋮ menu's own greying, refused here.
				// swipeLeft above asks availability alone: stepping back through
				// alternatives already taken is not taking one.
				const swipeRefusal = await verbRefusal(
					db,
					message.sessionId,
					"swipe",
					{ messageId: message.id, userId }
				)
				if (swipeRefusal) {
					const res: Sockets.SessionMessages.SwipeRight.Response = {
						sessionMessage: undefined,
						error: swipeRefusal
					}
					emitToUser("sessionMessages:swipeRight", res)
					return res
				}

				const swipes = message.metadata?.swipes
				const currentIdx = swipes?.currentIdx ?? null
				const isOnLastSwipe =
					!swipes?.history?.length ||
					currentIdx === null ||
					currentIdx === swipes.history.length - 1

				const { runBuiltIn } = await import(
					"$lib/server/pipelines/runtime/builtins"
				)
				const respond = (
					updated: SelectSessionMessage | undefined,
					error?: string
				) => {
					const res: Sockets.SessionMessages.SwipeRight.Response =
						updated
							? { sessionMessage: updated as any }
							: {
									sessionMessage: undefined,
									error:
										error ??
										"Failed to update session message."
								}
					emitToUser("sessionMessages:swipeRight", res)
					return res
				}

				if (!isOnLastSwipe) {
					// Navigation: the built-in selects the alternative to the
					// right, emits `message-swiped` and announces the row.
					const swiped = await runBuiltIn(db, {
						kind: "swipe",
						sessionId: message.sessionId,
						actor: userId,
						payload: { target: message.id, index: currentIdx! + 1 },
						io: socket.io
					})
					if (!swiped.ok) return respond(undefined, swiped.error)
					await clearReplyFailed(message.sessionId, message.id)
					const swipedRow = await db.query.sessionMessages.findFirst({
						where: (cm, { eq }) => eq(cm.id, message.id)
					})
					return respond(
						swipedRow && (await rowShownTo(swipedRow, userId, socket.user))
					)
				}

				// About to start a brand-new generation — freshness guard,
				// re-checked now that the lock is held, matching
				// regenerate/extend. Pure swipe navigation (the branch
				// above) never reaches here, so it's never blocked by an
				// unrelated in-flight generation elsewhere in the session.
				const alreadyGenerating =
					await db.query.sessionMessages.findFirst({
						where: (cm, { and, eq }) =>
							and(
								eq(cm.sessionId, message.sessionId),
								eq(cm.isGenerating, true)
							)
					})
				if (alreadyGenerating) {
					const res: Sockets.SessionMessages.SwipeRight.Response = {
						sessionMessage: undefined,
						error: "A response is already generating in this session."
					}
					emitToUser("sessionMessages:swipeRight:error", res)
					return res
				}

				/**
				 * A fresh alternative: built-in write + declared content
				 * (R-15). The built-in records an empty alternative and
				 * selects it — `message-swiped` carries the one that was
				 * showing — then this handler opens the row for the reply
				 * road exactly as regenerate does (generating, queued), and
				 * the genre's pipeline claims it and fills it, its finishing
				 * write recording `message-updated` with `verb: swipe`.
				 *
				 * 🚧 Asked first: whether the clock moves the reply being
				 * left behind carried can be taken back (live scenes §15
				 * G5). The alternative is recorded before the retraction, so
				 * a refusal there would leave an empty swipe showing.
				 */
				{
					const { clockRetractProblem } = await import("$lib/server/state/clockMoves")
					const problem = await clockRetractProblem(db, [message.id], { keepTicks: true })
					if (problem) return respond(undefined, problem)
					// 🚧 pr-6 B4: and whether the reply is below the settle line —
					// asked here for the same reason.
					const { assertRetractable } = await import("$lib/server/sessions/settle")
					try {
						await assertRetractable(db, message.id)
					} catch (e) {
						if (e instanceof SettledRefusal) return respond(undefined, e.message)
						throw e
					}
				}
				const recorded = await runBuiltIn(db, {
					kind: "swipe",
					sessionId: message.sessionId,
					actor: userId,
					payload: { target: message.id, text: "" },
					io: socket.io
				})
				if (!recorded.ok) return respond(undefined, recorded.error)

				// Take back what the swipe being left behind changed about
				// the world — this replaces the reply without deleting the
				// row, so the anchor cascade cannot see it. Its clock moves
				// too (asked above), all but the round's tick (★ST2-1).
				// "replaced": the line is told again, `keepOnRetell` fields stay.
				let retracted: Awaited<ReturnType<typeof retractStateAnchoredTo>>
				try {
					retracted = await retractStateAnchoredTo(db, message.id, "replaced")
				} catch (e) {
					if (e instanceof SettledRefusal) return respond(undefined, e.message)
					throw e
				}
				if (retracted.clockMoved) broadcastSessionRow(socket.io, message.sessionId)
				// The seats the left-behind swipe benched or brought back, told to open pages.
				await announceSeatChanges(
					db,
					socket.io,
					{ sessionId: message.sessionId, userId: socket.user!.id },
					retracted.seatChanges
				)
				// 🚧 Committed: announced as the regenerate's is (§15 G14).
				if (retracted.changed)
					await broadcastToSessionUsers(socket.io, message.sessionId, "state:changed", {
						sessionId: message.sessionId
					} satisfies Sockets.State.Changed.Response)

				const [updated] = await updateLegacyWhere(
					db,
					eq(schema.sessionMessages.id, message.id),
					{
						isGenerating: true,
						// No status yet — see the regenerate handler.
						generationStatus: null,
						generationOutcome: null,
						error: null,
						queueItemId: null
					}
				)
				if (!updated) return respond(undefined)
				// Superseded before the run, so this swipe's own failure
				// raises afresh.
				await clearReplyFailed(message.sessionId, message.id)
				const res = respond(await rowShownTo(updated, userId, socket.user))

				// Announced as generating: the row the person watches fill.
				await broadcastToSessionUsers(
					socket.io,
					updated.sessionId,
					"sessionMessage",
					{ sessionMessage: updated }
				)

				const outcome = await runReply({
					socket,
					emitToUser,
					sessionId: message.sessionId,
					userId,
					turn: { kind: "swipe", messageId: message.id }
				})
				/**
				 * 🚧 A swipe whose run failed (halted empty, errored) replaced
				 * nothing (2026-10-16 walk): the world it took back goes back
				 * as it was — the row stays failed, with its Retry. A stop is
				 * the person's: what arrived stands, and so does the retraction.
				 */
				if (!outcome.ok && !outcome.stopped) {
					try {
						const { restoreRetractedState } = await import("$lib/server/state/write")
						const seatChanges: SeatChange[] = []
						const restored = await restoreRetractedState(db, retracted.taken, { seatChanges })
						await announceSeatChanges(
							db,
							socket.io,
							{ sessionId: message.sessionId, userId: socket.user!.id },
							seatChanges
						)
						if (restored) {
							if (retracted.clockMoved) broadcastSessionRow(socket.io, message.sessionId)
							await broadcastToSessionUsers(socket.io, message.sessionId, "state:changed", {
								sessionId: message.sessionId
							} satisfies Sockets.State.Changed.Response)
						}
					} catch (e) {
						console.warn("[swipeRight] the world could not be put back:", e)
					}
				}

				// The new swipe is the line the cards now quote.
				broadcastSessionRow(socket.io, message.sessionId)

				return res
			})
		} catch (error: any) {
			console.error("Error swiping right session message:", error)
			const res: Sockets.SessionMessages.SwipeRight.Response = {
				sessionMessage: undefined,
				error:
					error instanceof Error
						? error.message
						: "Failed to swipe right"
			}
			emitToUser("sessionMessages:swipeRight:error", res)
			throw error
		}
	}
}

export const sessionMessagesCancelHandler: Handler<
	Sockets.SessionMessages.Cancel.Params,
	Sockets.SessionMessages.Cancel.Response
> = {
	event: "sessionMessages:cancel",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = socket.user!.id

			const sessionAccess = await checkSessionAccess(
				params.sessionId,
				userId
			)
			if (!sessionAccess.hasAccess) {
				throw new Error("Session not found")
			}

			// The client's guarantee: flip the clicked message off "generating"
			// and broadcast it — scoped by message id + sessionId + the row
			// still generating, never by userId matching. This must never be
			// contingent on the upstream LLM actually stopping, on queue
			// state, or on a row's stamped userId matching whoever clicked Stop
			// (a userId gate would no-op the handler on a mismatch and leave the
			// message stuck "generating" forever — e.g. while still in the
			// "loading model" preflight stage). A row not generating has
			// nothing to flip (2026-09-16: the fence is what lets the stop be
			// recorded exactly once, see below). The one thing that happens
			// before the releases is the synchronous, in-memory stop of the
			// runs filling these rows — see below for why it has to come first;
			// it awaits nothing and can fail nothing. Everything after the
			// releases is best-effort cleanup of the actual upstream generation.
			const targetIds = new Set<number>()
			if (params.id) targetIds.add(params.id)

			// Also sweep every other message this session currently has marked as
			// generating, so a group session with multiple in-flight generations
			// (or a client that didn't pass an id) is fully covered too.
			const generatingMessages = await db.query.sessionMessages.findMany({
				where: (cm, { and, eq }) =>
					and(
						eq(cm.sessionId, params.sessionId),
						eq(cm.isGenerating, true)
					)
			})
			for (const message of generatingMessages) targetIds.add(message.id)

			// The RUN first, and synchronously (09-B B4). The pipeline owns its
			// row and the run is what fills it: the queue item below only
			// exists once the oracle is called, so a Stop during retrieval or
			// between nodes has to reach the executor, which polls the
			// registry between nodes and ends as `cancelled` — otherwise it
			// would walk on to the write. Before the releases below rather
			// than after them, because the releases await broadcasts, and a
			// run still unstopped through those awaits could reach its save
			// node after its row had been released — landing the full reply
			// over the partial a person had just stopped. Scoped to the rows
			// being released: an image render or a summary somebody else
			// started in this session is not what this Stop was about.
			let stoppedRuns = 0
			{
				const runRegistry = await import(
					"$lib/server/pipelines/runtime/runRegistry"
				)
				stoppedRuns = runRegistry.cancelSession(
					params.sessionId,
					`user:${userId}`,
					targetIds
				)
			}

			/**
			 * Released with the explicit outcome (R-15, 2026-09-16): the row
			 * says it was `stopped`, and the stop is recorded as a session
			 * change for the next reply's inlet. Fenced on the row still
			 * generating — a row already released has nothing to stop, and
			 * when the run's own finalisation (`liveRow.finish`) won the
			 * race it wrote the outcome and the change itself; this write is
			 * then the no-op the fence makes it, so a stop is recorded once.
			 * The fence is on the STATE, not on who clicked: the userId match
			 * this handler once required is what left rows stuck.
			 */
			const { emitSessionEvent } = await import(
				"$lib/server/pipelines/runtime/sessionEvents"
			)
			let released = 0
			for (const id of targetIds) {
				const [updated] = await updateLegacyWhere(
					db,
					and(
						eq(schema.sessionMessages.id, id),
						eq(schema.sessionMessages.sessionId, params.sessionId),
						eq(schema.sessionMessages.isGenerating, true)
					),
					{
						isGenerating: false,
						generationStatus: null,
						generationOutcome: "stopped",
						queueItemId: null,
						error: null
					}
				)
				if (updated) {
					released++
					await broadcastToSessionUsers(
						socket.io,
						params.sessionId,
						"sessionMessage",
						{
							sessionMessage: updated
						}
					)
					// Two events (PLAN-turn-order §4.1, A2): the stop, and
					// the row LANDING — a stopped reply is not generating, so
					// the turn-order spec answers it like a finished one.
					// Under the person's `edit` cause: they pressed Stop on
					// this row, and an edit never fires a turn (§4.6).
					// An edit cause, never `auto` (R34): a Stop ends the round whichever
					// release wins the fence.
					const cause = { kind: "edit" as const, userId }
					await emitSessionEvent(db, {
						sessionId: params.sessionId,
						userId,
						event: "core:event/message-stopped@1",
						payload: {
							sessionId: params.sessionId,
							messageId: updated.id,
							textLength: updated.content.length,
							cause
						},
						io: socket.io
					})
					await emitSessionEvent(db, {
						sessionId: params.sessionId,
						userId,
						event: sessionEvents.messageCompleted,
						payload: {
							sessionId: params.sessionId,
							messageId: updated.id,
							cause
						},
						io: socket.io
					})
				}
			}

			// Whatever the stop left on the rows is what the cards quote.
			broadcastSessionRow(socket.io, params.sessionId)

			// Best-effort: ask the queue to cancel the actual upstream runs we
			// knew about. Fires the adapter's abort() internally and, if the run
			// doesn't respond in time, force-detaches it so the queue can proceed
			// regardless. Never throws. Purely cleanup — the UI is already fixed.
			for (const message of generatingMessages) {
				if (message.queueItemId) {
					llmQueue.cancel(message.queueItemId)
				}
			}

			// A Stop that arrived late stopped and released nothing: not an
			// error, and nothing to claim either.
			const res: Sockets.SessionMessages.Cancel.Response =
				released + stoppedRuns > 0
					? {
							success: `Cancelled ${released > 0 ? released : stoppedRuns} generating message(s)`
						}
					: {}
			emitToUser("sessionMessages:cancel", res)

			return res
		} catch (error: any) {
			console.error("Error cancelling session messages:", error)
			const res: Sockets.SessionMessages.Cancel.Response = {
				error: "Failed to cancel messages"
			}
			emitToUser("sessionMessages:cancel:error", res)
			throw error
		}
	}
}

export const sessionMessageHandler: Handler<
	Sockets.SessionMessage.Call,
	Sockets.SessionMessage.Response
> = {
	event: "sessionMessage",
	handler: async (socket, params, emitToUser) => {
		try {
			if (params.sessionMessage) {
				// If sessionMessage object is provided, emit it directly
				const res: Sockets.SessionMessage.Response = {
					sessionMessage: params.sessionMessage
				}
				emitToUser("sessionMessage", res)
				return res
			} else if (params.id) {
				// If id is provided, fetch from database
				const sessionMessage = await db.query.sessionMessages.findFirst(
					{
						where: (m, { eq }) => eq(m.id, params.id!)
					}
				)
				if (!sessionMessage) {
					const res: Sockets.SessionMessage.Response = {
						error: "Session message not found."
					}
					emitToUser("sessionMessage:error", res)
					throw new Error("Session message not found")
				}
				// Fetched by message id alone — without this check, any
				// authenticated user could read any message on the instance
				// (including debugMeta's full compiled prompt) just by
				// guessing/incrementing ids.
				const sessionAccess = await checkSessionAccess(
					sessionMessage.sessionId,
					socket.user!.id
				)
				if (!sessionAccess.hasAccess) {
					const res: Sockets.SessionMessage.Response = {
						error: "Access denied. Session not found or no permission to access."
					}
					emitToUser("sessionMessage:error", res)
					throw new Error("Access denied.")
				}
				// 🚧 A row on another person's personal lane is not theirs to
				// read (2026-10-17) — refused like a session they are not in.
				{
					const { laneViewFor, laneViewAllows } = await import("$lib/server/channels/lanes")
					const view = await laneViewFor(db, sessionMessage.sessionId, socket.user!.id)
					if (!laneViewAllows(view, sessionMessage.channel)) {
						const res: Sockets.SessionMessage.Response = {
							error: "Access denied. Session not found or no permission to access."
						}
						emitToUser("sessionMessage:error", res)
						throw new Error("Access denied.")
					}
				}
				// G5/G6/D64: the compiled prompt goes to `readsPrompt` viewers only.
				const res: Sockets.SessionMessage.Response = await withEmbeddingStateFor(
					(await readsPrompt(sessionMessage.sessionId, socket.user!.id))
						? { sessionMessage }
						: withoutDebugMeta({ sessionMessage }),
					socket.user
				)
				emitToUser("sessionMessage", res)
				return res
			} else {
				const res: Sockets.SessionMessage.Response = {
					error: "Must provide either id or sessionMessage."
				}
				emitToUser("sessionMessage:error", res)
				throw new Error("Must provide either id or sessionMessage")
			}
		} catch (error: any) {
			console.error("Error in sessionMessage handler:", error)
			const res: Sockets.SessionMessage.Response = {
				error: "Failed to get session message"
			}
			emitToUser("sessionMessage:error", res)
			throw error
		}
	}
}

// Greeting construction moved to $lib/server/sessions/greetings (24 T8) —
// one implementation behind the create pipeline's nodes and the floor alike.

// =============================================
// TYPE-SAFE CHAT HANDLERS
// =============================================

/**
 * Type-safe handler for calculating prompt token count
 */
export const promptTokenCountHandler: Handler<
	Sockets.Sessions.PromptTokenCount.Params,
	Sockets.Sessions.PromptTokenCount.Response
> = {
	event: "sessions:promptTokenCount",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = socket.user!.id

			// // Only admin users can get prompt token count
			// if (!socket.user!.isAdmin) {
			// 	return {
			// 		error: "Access denied. Only admin users can get prompt token count."
			// 	}
			// }

			// This is the live "draft preview" handler (fired while typing) —
			// fail fast on oversized content before any DB work, same as the
			// persisted send/update paths.
			if (
				params.content &&
				params.content.length > MAX_CHAT_MESSAGE_LENGTH
			) {
				const res: Sockets.Sessions.PromptTokenCount.Response = {
					error: `Message too long (max ${MAX_CHAT_MESSAGE_LENGTH.toLocaleString()} characters).`
				}
				emitToUser("sessions:promptTokenCount", res)
				return res
			}

			// Check if user has access to this session
			const sessionAccess = await checkSessionAccess(
				params.sessionId,
				userId
			)
			if (!sessionAccess.hasAccess) {
				const res: Sockets.Sessions.PromptTokenCount.Response = {
					error: "Access denied. Session not found or no permission to access."
				}
				emitToUser("sessions:promptTokenCount", res)
				return res
			}

			// DG2 (2026-11-17): the count is the prompt's own report, read by
			// `readsPrompt` viewers alone. Anyone else gets an answer with
			// no count, and nothing is compiled for them.
			if (!(await readsPrompt(params.sessionId, userId))) {
				const none: Sockets.Sessions.PromptTokenCount.Response = {}
				emitToUser("sessions:promptTokenCount", none)
				return none
			}

			const session = await getPromptSessionFromDb(
				params.sessionId,
				userId
			)
			if (!session) {
				const res: Sockets.Sessions.PromptTokenCount.Response = {
					error: "Error Generating Prompt Token Count: Session not found."
				}
				emitToUser("sessions:promptTokenCount", res)
				return res
			}

			const user = await db.query.users.findFirst({
				where: (u, { eq }) => eq(u.id, userId)
			})

			// Connection and sampling via resolveTaskConfig — the connection is
			// the instance's text->text default, the sampling the session's own
			// choice above it.
			const { connection, sampling, problem } = await resolveTaskConfig({
				taskType: "session",
				sessionId: session.id
			})

			if (!connection) {
				const res: Sockets.Sessions.PromptTokenCount.Response = {
					// The resolver's sentence names which tier failed and where
					// to fix it; the literal below is only for a caller that
					// somehow returned no connection and no reason.
					error:
						problem?.message ??
						"No AI connection configured. Please set up a connection first."
				}
				emitToUser("sessions:promptTokenCount", res)
				return res
			}
			if (!sampling) {
				const res: Sockets.Sessions.PromptTokenCount.Response = {
					error: "No sampling config configured. Please set up a sampling config first."
				}
				emitToUser("sessions:promptTokenCount", res)
				return res
			}

			if (!session || !user) {
				const res: Sockets.Sessions.PromptTokenCount.Response = {
					error: "Incomplete configuration, failed to calculate token count."
				}
				emitToUser("sessions:promptTokenCount", res)
				return res
			}

			// sessionCharacters/sessionPersonas rows can have a null character/persona
			// when the linked row was deleted (the FK is nullable, onDelete:
			// "set null") — filter those out, matching the same fix in
			// dispatch.ts/sessionsListHandler.
			const sessionCharactersWithCharacter =
				session.sessionCharacters.filter(
					(
						cc
					): cc is typeof cc & {
						character: NonNullable<typeof cc.character>
					} => cc.character !== null
				)
			const sessionPersonasWithPersona = session.sessionPersonas.filter(
				(
					cp
				): cp is typeof cp & {
					persona: NonNullable<typeof cp.persona>
				} => cp.persona !== null
			)

			// The caller (the session page's live "draft compiled prompt" preview)
			// sends the not-yet-sent draft text via params.content/personaId/role
			// specifically so this preview can reflect what would actually be
			// sent if the user hit Send right now — including whose turn becomes
			// due as a result. Without splicing it in here, this preview only
			// ever sees already-persisted history, so as soon as the last real
			// message is a character reply (i.e. it's the user's turn to type)
			// it permanently reports "No character available" regardless of what
			// the user drafts, since nothing is actually due until their draft
			// is accounted for.
			const messagesWithDraft = params.content?.trim()
				? [
						...session.sessionMessages,
						{
							id: -1,
							sessionId: params.sessionId,
							userId,
							characterId: null,
							personaId: params.personaId ?? null,
							role: params.role || "user",
							isNarratorResponse: false,
							content: params.content,
							createdAt: new Date(),
							updatedAt: new Date(),
							isEdited: false,
							metadata: {},
							isGenerating: false,
							generationStage: null,
							generationStatus: null,
							error: null,
							queueItemId: null,
							isHidden: false,
							debugMeta: null,
							embedding: null,
							embeddingModel: null,
							vectorizedAt: null
						} as SelectSessionMessage
					]
				: session.sessionMessages

			/**
			 * Whose turn the estimate compiles for: the **stored** order's
			 * head (PLAN-turn-order §4.7, A7). An estimate needs *somebody*
			 * to compile for, so where nothing is prepared — a fresh
			 * session, a manual strategy, a round everybody has taken — the
			 * first active character stands in, else a seated in-turn envoy.
			 *
			 * Read rather than previewed: the order is written down, so this
			 * is right for a random or scripted strategy too, where the
			 * preview it replaced could only answer "unknown".
			 */
			const { headTurnEntry } = await import(
				"$lib/server/sessions/fireTurn"
			)
			const head = await headTurnEntry(db, params.sessionId)
			const headRef = typeof head?.ref === "string" ? head.ref : null
			// 🚧 (seat-cast S2) A head named by its seated member reads as
			// its seat's card; nobody seated as that member → no head.
			const { storedSeatRef } = await import(
				"$lib/server/state/seatRefs"
			)
			const headCardRef = headRef
				? await storedSeatRef(db, params.sessionId, headRef)
				: null
			// ⏳ With the flip on (`state/memberForm.ts`) the stored head is a
			// member form (`seated-member:` / `player-seat:`): its card is the
			// seat's `cardId`; off, the card form's own number.
			let currentCharacterId: number | null = memberFormOn()
				? headCardRef
					? ((await seatOf(db, params.sessionId, headCardRef))?.cardId ?? null)
					: null
				: headCardRef && headCardRef.startsWith("character:")
					? Number(headCardRef.slice("character:".length))
					: null
			if (currentCharacterId !== null && !Number.isInteger(currentCharacterId))
				currentCharacterId = null
			let envoySpeaker: `envoy:${string}` | null =
				headRef?.startsWith("envoy:")
					? (headRef as `envoy:${string}`)
					: null
			// 🚧 A head that is a card-less seat's member (`seated-member:<id>`,
			// the seat holds no card): compiled for by that ref as `speaker`,
			// as the envoy head is. A member id, never a card id.
			let cardlessSpeaker: string | null = null
			const { hostSeatRefOf } = await import(
				"$lib/server/pipelines/prompt/seatCards"
			)
			if (!currentCharacterId && !envoySpeaker && memberFormOn() && headCardRef) {
				const headSeat = await seatOf(db, params.sessionId, headCardRef)
				if (
					headSeat &&
					headSeat.kind === "character" &&
					!headSeat.departed &&
					headSeat.cardId == null &&
					headSeat.castMemberId != null
				)
					cardlessSpeaker = hostSeatRefOf({
						kind: "character",
						seatId: headSeat.seatId,
						castMemberId: headSeat.castMemberId,
						cardId: null
					})
			}
			if (!currentCharacterId && !envoySpeaker && !cardlessSpeaker) {
				// The first active seat by position: a card, else (a live
				// card-less seat — no envoy, a member, `removedAt` null) its
				// member's ref.
				const firstSeat = session.sessionCharacters
					.filter(
						(cc) =>
							cc.isActive &&
							cc.removedAt == null &&
							cc.envoySlug == null &&
							(cc.characterId != null || cc.castMemberId != null)
					)
					.sort((a, b) => (a.position ?? 0) - (b.position ?? 0))[0]
				// By the row's own `characterId`: a card-less seat's `character`
				// is its member read as a card-shaped row with NO `id`.
				if (firstSeat?.characterId != null)
					currentCharacterId = firstSeat.characterId
				else if (firstSeat)
					cardlessSpeaker = hostSeatRefOf({
						kind: "character",
						seatId: firstSeat.id,
						castMemberId: firstSeat.castMemberId,
						cardId: null
					})
			}
			if (!currentCharacterId && !envoySpeaker && !cardlessSpeaker) {
				const { seatedEnvoys } = await import(
					"$lib/server/pipelines/entities/envoys"
				)
				const seat = (await seatedEnvoys(db, params.sessionId)).find(
					(e) => !e.removedAt && e.speaks === "in-turn"
				)
				if (seat) envoySpeaker = `envoy:${seat.slug}`
			}

			if (!currentCharacterId && !envoySpeaker && !cardlessSpeaker) {
				const res: Sockets.Sessions.PromptTokenCount.Response = {
					error: "No character available for prompt."
				}
				emitToUser("sessions:promptTokenCount", res)
				return res
			}

			/**
			 * Compiled by the **pipeline**, stopped before it sends.
			 *
			 * It never constructs an adapter or calls `compilePrompt`: the
			 * number on screen must come from the path that generates replies.
			 *
			 * `preview: true` halts at the pre-call substrate with the real
			 * payload, so this is the same compilation the next turn will
			 * actually use rather than an approximation of it. `skipReceipt`
			 * because this fires on a debounce while somebody types; recording
			 * a run per keystroke would bury the run history.
			 */
			const { runTurn } = await import(
				"$lib/server/pipelines/runtime/runTurn"
			)
			const { toCompiledPrompt } = await import(
				"$lib/server/pipelines/runtime/dispatch"
			)

			const receipt: any = await runTurn({
				db,
				sessionId: params.sessionId,
				userId,
				currentCharacterId,
				...(envoySpeaker
					? { speaker: envoySpeaker }
					: cardlessSpeaker
						? { speaker: cardlessSpeaker as `seated-member:${string}` }
						: {}),
				text: params.content ?? "",
				// The point of the preview: the text being typed is not a row
				// yet, so the run has to be told about it or the count reflects
				// the conversation *without* the message it is counting.
				...(params.content?.trim()
					? {
							draftMessage: {
								content: params.content,
								personaId: params.personaId ?? null
							}
						}
					: {}),
				preview: true,
				skipReceipt: true
			})

			const rendered = receipt.preview?.context?.rendered as
				| { rendered?: unknown }
				| undefined
			if (!(rendered?.rendered ?? rendered)) {
				// A preview halts by design, so a non-ok outcome only means
				// failure when it arrived with no payload. Say which node gave
				// up rather than reporting a bare token-count failure.
				const res: Sockets.Sessions.PromptTokenCount.Response = {
					error: haltExplanationFor(
						socket.user,
						"prompt",
						`The prompt could not be compiled: ${receipt.outcome}` +
							(receipt.haltNodeKey
								? ` at '${receipt.haltNodeKey}'`
								: "") +
							(receipt.haltReason ? ` — ${receipt.haltReason}` : "")
					)
				}
				emitToUser("sessions:promptTokenCount", res)
				return res
			}

			const promptResult = toCompiledPrompt(rendered, connection, {
				currentCharacterId,
				messageCount: messagesWithDraft.length
			})

			emitToUser("sessions:promptTokenCount", promptResult)
			return promptResult
		} catch (error) {
			console.error("Error in promptTokenCountHandler:", error)
			const res: Sockets.Sessions.PromptTokenCount.Response = {
				error: "Failed to calculate prompt token count."
			}
			emitToUser("sessions:promptTokenCount", res)
			return res
		}
	}
}

/**
 * ⏳ The ref a person's persona line is offered under: with the flip on
 * (`state/memberForm.ts`) the player seat holding the persona — live before
 * departed, then position, then seat id (never a character seat that holds
 * the same card, ★K-2) — as `hostSeatRefOf` names it; else, or when no seat
 * holds it, the card form `character:<personaId>`.
 */
async function playerSeatRefOfPersona(
	dbh: Db,
	sessionId: number,
	personaId: number
): Promise<string> {
	if (memberFormOn()) {
		const seats = await dbh
			.select({
				id: schema.sessionPersonas.id,
				castMemberId: schema.sessionPersonas.castMemberId,
				removedAt: schema.sessionPersonas.removedAt,
				position: schema.sessionPersonas.position
			})
			.from(schema.sessionPersonas)
			.where(
				and(
					eq(schema.sessionPersonas.sessionId, sessionId),
					eq(schema.sessionPersonas.personaId, personaId)
				)
			)
		seats.sort(
			(a, b) =>
				Number(a.removedAt != null) - Number(b.removedAt != null) ||
				(a.position ?? 0) - (b.position ?? 0) ||
				a.id - b.id
		)
		if (seats[0]) return `player-seat:${seats[0].id}`
	}
	return `character:${personaId}`
}

export { heldRerunRefusal }
