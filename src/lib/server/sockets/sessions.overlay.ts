/**
 * The session's overlay on a lorebook it cannot write: its items, applying
 * them, the applied batches, taking an apply back, and telling the session
 * an apply moved.
 */

import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { eq } from "drizzle-orm"
import type { Handler } from "$lib/shared/events"
import { refusable } from "./refusable"
import type { AutomaticApplyCause } from "$lib/server/lorebooks/ownBook"
import { emitToUserRedacted, getSessionUserIds } from "./utils/broadcastHelpers"
import { checkSessionAccess } from "$lib/server/utils/sessionAccess"

/**
 * 🚧 The overlay's items (PLAN-rulesets §15, §26): what the session wrote to
 * its own notes while it read a lorebook it could not write — the review
 * queue lists them beside the value proposals. Only the session's owner reads
 * them (a guest neither opens nor edits the notes, G2: the empty shape);
 * only the session's owner, when they may write the lorebook
 * (`canWriteLorebook`), may apply them; the check lives in `applyOverlayItems`.
 */
export const sessionsOverlayItemsHandler: Handler<
	Sockets.Sessions.OverlayItems.Params,
	Sockets.Sessions.OverlayItems.Response
> = refusable(
	"sessions:overlayItems",
	async (socket, params: Sockets.Sessions.OverlayItems.Params, emitToUser) => {
		const access = await checkSessionAccess(params.sessionId, socket.user!.id)
		if (!access.hasAccess) throw new Error("This session is not one you are in.")
		const { overlayItemsOf, overlayAccessOf } = await import("$lib/server/lorebooks/ownBook")
		// The notes are the session owner's alone: anyone else is answered the empty shape (G2).
		const mine = access.isOwner
			? await overlayAccessOf(db, params.sessionId, socket.user!.id)
			: { mayApply: false, appliesItself: false }
		const res: Sockets.Sessions.OverlayItems.Response = {
			sessionId: params.sessionId,
			items: access.isOwner ? await overlayItemsOf(db, params.sessionId) : [],
			...mine
		}
		emitToUser("sessions:overlayItems", res)
		return res
	},
	"The session's changes could not be read."
)

/**
 * 🚧 **Apply to the lorebook** (PLAN-rulesets §26): overlay items move into
 * the attached lorebook with their provenance and leave the notes; 🚧 a held
 * change to a lorebook entry is folded in (`amendmentIds`). One item
 * (`entryIds: [id]`) or all (both absent). The session's owner, when they may write the lorebook
 * (`canWriteLorebook`); the check lives in `applyOverlayItems`.
 */
export const sessionsApplyOverlayHandler: Handler<
	Sockets.Sessions.ApplyOverlay.Params,
	Sockets.Sessions.ApplyOverlay.Response
> = refusable(
	"sessions:applyOverlay",
	async (socket, params: Sockets.Sessions.ApplyOverlay.Params, emitToUser) => {
		const { applyOverlayItems } = await import("$lib/server/lorebooks/ownBook")
		const entryIds = Array.isArray(params.entryIds)
			? params.entryIds.filter((id): id is number => Number.isSafeInteger(id))
			: null
		const amendmentIds = Array.isArray(params.amendmentIds)
			? params.amendmentIds.filter((id): id is number => Number.isSafeInteger(id))
			: null
		const linkIds = Array.isArray(params.linkIds)
			? params.linkIds.filter((id): id is number => Number.isSafeInteger(id))
			: null
		const tieIds = Array.isArray(params.tieIds)
			? params.tieIds.filter((id): id is number => Number.isSafeInteger(id))
			: null
		const done = await applyOverlayItems(db, {
			sessionId: params.sessionId,
			userId: socket.user!.id,
			entryIds,
			amendmentIds,
			linkIds,
			tieIds
		})
		const res: Sockets.Sessions.ApplyOverlay.Response = {
			sessionId: params.sessionId,
			lorebookId: done.lorebookId,
			applied: done.applied,
			appliedChanges: done.appliedChanges,
			stillHeld: done.stillHeld,
			appliedLinks: done.appliedLinks,
			appliedTies: done.appliedTies,
			droppedTies: done.droppedTies,
			supersededTies: done.supersededTies,
			mergedDays: done.mergedDays,
			droppedLinks: done.droppedLinks,
			heldDays: done.heldDays,
			batch: done.batch
		}
		emitToUser("sessions:applyOverlay", res)
		// The transaction has committed: say where the settle line went, then move every member's card.
		if (done.settled) {
			const { announceHistorySettled } = await import("$lib/server/sessions/settle")
			await announceHistorySettled(db, {
				sessionId: params.sessionId,
				userId: socket.user!.id,
				...done.settled,
				io: socket.io
			})
		}
		await tellApplyMoved(socket.io, params.sessionId)
		return res
	},
	"The changes could not be applied to the lorebook."
)

/**
 * 🚧 What was applied from this session, one batch per Apply, newest first.
 * Read by the session's owner only (a guest gets the empty shape, G2); only
 * the session's owner, when they may write the lorebook (`canWriteLorebook`),
 * takes one back; the check lives in `takeBackApply`.
 */
export const sessionsAppliedBatchesHandler: Handler<
	Sockets.Sessions.AppliedBatches.Params,
	Sockets.Sessions.AppliedBatches.Response
> = refusable(
	"sessions:appliedBatches",
	async (socket, params: Sockets.Sessions.AppliedBatches.Params, emitToUser) => {
		const userId = socket.user!.id
		const access = await checkSessionAccess(params.sessionId, userId)
		if (!access.hasAccess) throw new Error("This session is not one you are in.")
		const { appliedBatchesOf, overlayAccessOf } = await import("$lib/server/lorebooks/ownBook")
		// The notes are the session owner's alone: anyone else is answered the empty shape (G2).
		const mayApply = access.isOwner
			? (await overlayAccessOf(db, params.sessionId, userId)).mayApply
			: false
		const res: Sockets.Sessions.AppliedBatches.Response = {
			sessionId: params.sessionId,
			batches: access.isOwner ? await appliedBatchesOf(db, params.sessionId) : [],
			mayApply
		}
		emitToUser("sessions:appliedBatches", res)
		return res
	},
	"The session's applied changes could not be read."
)

/**
 * 🚧 **Take back** one Apply, all or nothing. The session's owner, when they
 * may write the lorebook (`canWriteLorebook`); the check lives in
 * `takeBackApply`. A refusal is said in place (`refused`), never as an error
 * toast.
 */
export const sessionsTakeBackApplyHandler: Handler<
	Sockets.Sessions.TakeBackApply.Params,
	Sockets.Sessions.TakeBackApply.Response
> = refusable(
	"sessions:takeBackApply",
	async (socket, params: Sockets.Sessions.TakeBackApply.Params, emitToUser) => {
		if (!Number.isSafeInteger(params?.sessionId) || typeof params?.batch !== "string" || !params.batch)
			throw new Error("Take back needs a session and an apply.")
		const { takeBackApply, OwnBookRefusal } = await import("$lib/server/lorebooks/ownBook")
		let res: Sockets.Sessions.TakeBackApply.Response
		try {
			await takeBackApply(db, {
				batch: params.batch,
				userId: socket.user!.id,
				sessionId: params.sessionId
			})
			res = {
				sessionId: params.sessionId,
				batch: params.batch,
				refused: null
			}
		} catch (e) {
			if (!(e instanceof OwnBookRefusal)) throw e
			res = {
				sessionId: params.sessionId,
				batch: params.batch,
				refused: e.message
			}
		}
		emitToUser("sessions:takeBackApply", res)
		if (res.refused == null) await tellApplyMoved(socket.io, params.sessionId)
		return res
	},
	"The apply could not be taken back.",
	undefined,
	(p) => ({ sessionId: (p as any)?.sessionId })
)

/**
 * 🚧 Every member of the session is sent their own two lists again — after an
 * Apply, a take-back, or a change that applied by itself — so the card shows
 * it (P1). The server is the `io` given, else the one the socket layer keeps
 * on `globalThis` (a caller with no socket: a scene closing, the boundary
 * watcher). Never throws.
 */
export async function tellApplyMoved(io: unknown, sessionId: number): Promise<void> {
	try {
		const server = (io ??
			(globalThis as { __SERENE_PUB_SOCKET_STATE__?: { io?: unknown } }).__SERENE_PUB_SOCKET_STATE__?.io) as any
		if (!server) return
		const { overlayItemsOf, overlayAccessOf, appliedBatchesOf } = await import("$lib/server/lorebooks/ownBook")
		const items = await overlayItemsOf(db, sessionId)
		const batches = await appliedBatchesOf(db, sessionId)
		const [session] = await db
			.select({ userId: schema.sessions.userId })
			.from(schema.sessions)
			.where(eq(schema.sessions.id, sessionId))
			.limit(1)
		for (const uid of await getSessionUserIds(sessionId)) {
			// Only the session's owner is sent the notes' review (G2); everyone else the empty shape.
			const owner = session?.userId === uid
			const { mayApply, appliesItself } = owner
				? await overlayAccessOf(db, sessionId, uid)
				: { mayApply: false, appliesItself: false }
			await emitToUserRedacted(server, uid, "sessions:overlayItems", {
				sessionId,
				items: owner ? items : [],
				mayApply,
				appliesItself
			} satisfies Sockets.Sessions.OverlayItems.Response)
			await emitToUserRedacted(server, uid, "sessions:appliedBatches", {
				sessionId,
				batches: owner ? batches : [],
				mayApply
			} satisfies Sockets.Sessions.AppliedBatches.Response)
		}
	} catch (e) {
		console.warn(`[apply] the lists could not be re-sent for session ${sessionId}:`, e)
	}
}

/**
 * 🚧 The moments held changes apply by themselves (scene close, summary saved,
 * Close out): run `applyHeldAutomatically`, then — after its transaction —
 * announce the settle line and move every member's card. Never throws, so it
 * never fails what triggered it. Never call it with a transaction handle.
 */
export async function applyHeldAutomaticallyAndTell(
	handle: Db,
	input: {
		sessionId: number
		automatic: AutomaticApplyCause
		sceneId?: number
		before?: number
		io?: unknown
	}
): Promise<void> {
	try {
		const { applyHeldAutomatically } = await import("$lib/server/lorebooks/ownBook")
		const result = await applyHeldAutomatically(handle, {
			sessionId: input.sessionId,
			automatic: input.automatic,
			...(input.sceneId != null ? { sceneId: input.sceneId } : {}),
			...(input.before != null ? { before: input.before } : {})
		})
		if (!result) return
		// A scene close can settle the story with nothing applied: the line is still announced.
		const applied = result.applied.length + result.appliedChanges.length + result.dropped.length > 0
		if (!applied && !result.settled?.moved) return
		const server = (input.io ??
			(globalThis as { __SERENE_PUB_SOCKET_STATE__?: { io?: unknown } }).__SERENE_PUB_SOCKET_STATE__?.io) as any
		if (result.settled) {
			const { announceHistorySettled } = await import("$lib/server/sessions/settle")
			await announceHistorySettled(handle, {
				sessionId: input.sessionId,
				userId: result.userId,
				...result.settled,
				io: server ?? undefined,
				cause: { kind: "system" }
			})
		}
		if (applied) await tellApplyMoved(server, input.sessionId)
	} catch (e) {
		console.warn(`[apply] the automatic apply for session ${input.sessionId} could not be announced:`, e)
	}
}
