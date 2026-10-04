import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { and, eq, inArray } from "drizzle-orm"
import type { Handler } from "$lib/shared/events"
import { refusable } from "./refusable"
import { withSessionGenerationLock } from "$lib/server/utils/sessionGenerationLock"
import { checkSessionAccess } from "$lib/server/utils/sessionAccess"
import { DEFAULT_CHANNEL, channelWhere } from "$lib/server/messages/channels"
import { activityError, activityStore } from "$lib/server/utils/activityStore"
import {
	loreWriteRefusal,
	loreWritesOffRefusal
} from "$lib/server/messages/writes"
import { sessionEvents } from "@serene-pub/sdk"
import { broadcastToSessionUsers } from "./utils/broadcastHelpers"
import { broadcastSessionRow } from "$lib/server/sessions/rowPush"
import { assertOwnedBook } from "$lib/server/utils/ownedBook"

/** The columns that say where a session reads its book, as one row has them. */
type SessionLine = {
	lorebookId: number | null
	lorebookBranchId: number | null
	storyClockYear: number | null
	storyClockMonth: number | null
	storyClockDay: number | null
	storyClockHour: number | null
	storyClockMinute: number | null
}

/**
 * Which of a session's line columns moved, named the way `sessions:update`'s
 * `session-updated` names them — `lorebookId`, `lorebookBranchId` and the five
 * clock columns as one `storyClock`, in that order.
 */
export function sessionLineChanges(
	before: SessionLine,
	after: SessionLine
): string[] {
	const changed: string[] = []
	if ((before.lorebookId ?? null) !== (after.lorebookId ?? null))
		changed.push("lorebookId")
	if ((before.lorebookBranchId ?? null) !== (after.lorebookBranchId ?? null))
		changed.push("lorebookBranchId")
	const clock = (r: SessionLine) =>
		JSON.stringify([
			r.storyClockYear ?? null,
			r.storyClockMonth ?? null,
			r.storyClockDay ?? null,
			r.storyClockHour ?? null,
			r.storyClockMinute ?? null
		])
	if (clock(before) !== clock(after)) changed.push("storyClock")
	return changed
}

/**
 * Tell every tab that the session now reads its book somewhere else.
 *
 * `sessions:setLorebook` moves the book, the line and the clock — the same
 * three things `sessions:update` announces with `state:changed` (so every tab
 * reads its state afresh) and a `session-updated` under the person's
 * `settings` cause (which never fires a turn). It announced neither, so other
 * tabs and the session lists kept the old book until a reload. Best-effort, as
 * there: an emitter failing must not fail the write that already landed.
 */
async function announceSessionLineMoved(
	io: any,
	sessionId: number,
	userId: number,
	before: SessionLine,
	after: SessionLine
): Promise<void> {
	const changed = sessionLineChanges(before, after)
	if (changed.length === 0) return
	try {
		await broadcastToSessionUsers(io, sessionId, "state:changed", {
			sessionId
		} satisfies Sockets.State.Changed.Response)
		const { emitSessionEvent } = await import(
			"$lib/server/pipelines/runtime/sessionEvents"
		)
		await emitSessionEvent(db, {
			sessionId,
			userId,
			event: sessionEvents.sessionUpdated,
			payload: {
				sessionId,
				changed,
				cause: { kind: "settings", userId }
			},
			io
		})
	} catch (err) {
		console.warn("[sessions:setLorebook] session-updated emit failed:", err)
	}
	// The session lists show which book a session reads.
	broadcastSessionRow(io, sessionId)
}

export const sessionsSummarizeHandler: Handler<
	Sockets.Sessions.Summarize.Params,
	Sockets.Sessions.Summarize.Response
> = {
	event: "sessions:summarize",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const {
			sessionId,
			messageIds,
			loreType,
			topic,
			lorebookBindingCharacterId
		} = params

		// topic is re-interpolated into every batch prompt plus the synthesis
		// prompt, so an oversized value multiplies LLM cost by batch count
		// with no cap otherwise — this is the one check that actually
		// matters, since it's reachable by a raw socket emit regardless of
		// the client's own maxlength.
		if (topic && topic.length > 300) {
			throw new Error("Topic must be 300 characters or fewer.")
		}
		// World or character lore only. A scene summary goes through
		// `scenes:create` + `scenes:process` (the modal routes it there), and
		// the scene/history branches this handler once had were unreachable
		// (Phase D) — so a raw emit asking for one is refused, not half-run.
		if (loreType !== "world" && loreType !== "character") {
			throw new Error("Only world or character lore can be summarized here.")
		}

		// Verify the user owns the session — shared helper, not an ad-hoc
		// reimplementation (see sessionAccess.ts's own comment: a local
		// eq(sessions.userId, userId)-only check is exactly how a guest-lockout
		// bug happened here before).
		const sessionAccess = await checkSessionAccess(sessionId, userId)
		if (!sessionAccess.isOwner) {
			throw new Error("Session not found or access denied.")
		}
		const session = await db.query.sessions.findFirst({
			where: eq(schema.sessions.id, sessionId)
		})

		if (!session) {
			throw new Error("Session not found or access denied.")
		}

		/**
		 * Declared writes (R-B): a summary IS a lore entry, so a genre whose
		 * lorebook is a reference does not produce one.
		 *
		 * Before the activity is registered, so a refused request leaves no
		 * card behind, and thrown rather than emitted as a
		 * `sessions:summarize:error`: like the topic-length guard above this
		 * is a refusal of the *request*, not the failure of a run that
		 * started. The modal's affordance is gated on the same policy
		 * (`sessions:view.writes`); this is the law behind it.
		 */
		const noLore = await loreWriteRefusal(db, sessionId)
		if (noLore) throw new Error(noLore)
		// The book owner's lore write mode Off: nothing a summary makes could
		// be saved, so none is made (plan A22). The modal says so on open.
		const off = await loreWritesOffRefusal(db, sessionId)
		if (off) throw new Error(off)

		// Guard: session must have a lorebook attached
		if (!session.lorebookId) {
			emitToUser("sessions:summarize:error", {
				reason: "no_lorebook",
				error: "This session reads no lorebook. Read one into this session, or create one, first."
			})
			return null as any
		}

		// Register the activity BEFORE the lock. The lock is FIFO, so a
		// summarize started during an in-flight generation waits that
		// generation out — without a card first, the user sees nothing at all,
		// and cancelling during the wait is unreachable. Same reasoning as
		// scenes:process. The per-session-per-type supersede/reject rule lives in
		// startSessionSummarize; it replaces the old inFlightSummarizeSessionIds set,
		// which was per-session and so made a world-lore run block a character one.
		const abortController = new AbortController()
		const activityId = activityStore.startSessionSummarize(
			{
				userId,
				sessionId,
				sessionLabel: session.name ?? undefined,
				loreType,
				lorebookId: session.lorebookId!,
				topic: topic || undefined
			},
			abortController
		)

		/** Terminalise the activity alongside the error event. */
		const failRun = (
			error: string,
			reason: Sockets.Sessions.Summarize.ErrorResponse["reason"] = "generation_failed"
		) => {
			activityStore.updateSessionSummarize(activityId, {
				status: "error",
				errorMessage: error
			})
			emitToUser("sessions:summarize:error", {
				reason,
				error
			} satisfies Sockets.Sessions.Summarize.ErrorResponse)
			return null as any
		}

		return await (async () => {
			try {
				// Snapshot inside the lock, LLM outside it.
				//
				// This read is the only session-state-dependent step — the
				// pipeline run below reads its own source — so holding the
				// lock across the whole pipeline (as this handler used to)
				// would queue the user's next message behind minutes of LLM
				// calls. That is exactly the trap a minimize-first flow must
				// not set. Same scoping as scenes:process.
				// "All" means all of one channel (20 §7): a summary that folded
				// a side conversation into the account of the main one would be
				// wrong in a way nothing downstream could detect. A picked
				// list is taken as given — the person picked those rows, lane
				// and all.
				//
				// `channelWhere`, not an equality: a bare slug is the whole
				// channel (ruling 2026-09-09), so "all of main" is every lane
				// of main — which is what the word "all" says, and what the
				// host's own `summarize_source` read resolves it to.
				const whereClause =
					messageIds === "all"
						? and(
								eq(schema.sessionMessages.sessionId, sessionId),
								eq(schema.sessionMessages.isHidden, false),
								channelWhere(
									schema.sessionMessages.channel,
									DEFAULT_CHANNEL
								)
							)
						: and(
								eq(schema.sessionMessages.sessionId, sessionId),
								inArray(schema.sessionMessages.id, messageIds)
							)

				const rawMessages = await withSessionGenerationLock(
					sessionId,
					async () =>
						db.query.sessionMessages.findMany({
							where: whereClause,
							orderBy: (cm, { asc }) => asc(cm.id)
						})
				)

				if (abortController.signal.aborted) return null as any

				if (rawMessages.length === 0) {
					return failRun("No messages found to summarize.")
				}

				/**
				 * The summarize pipeline for this lore type — its own namespace,
				 * with its own prompts, connections and sampling per step, all
				 * resolved through the pipeline config layer.
				 *
				 * The run stops **before** its `save` consumer, deliberately:
				 * this handler has never written the entry. What it produces is
				 * a pending result a person reviews in the modal and saves — the
				 * same stop-at-review rule the graph build's proposal encodes
				 * structurally.
				 */
				const { runSpec } = await import(
					"$lib/server/pipelines/runtime/runTurn"
				)
				const specsModule = await import(
					"$lib/server/pipelines/specs/summarize"
				)
				const specId =
					loreType === "world"
						? specsModule.SUMMARIZE_WORLD_SPEC_ID
						: specsModule.SUMMARIZE_CHARACTER_SPEC_ID

				// Coarse progress from step labels. The pipeline owns batching,
				// so the total is not known up front; the count ticking upward
				// is still an honest "it is working, this far along".
				let batchesSeen = 0
				/** The last frame sent, so a status change re-sends its phase. */
				let lastFrame: Sockets.Sessions.Summarize.Progress | undefined
				const progress = (
					frame: Omit<Sockets.Sessions.Summarize.Progress, "sessionId">
				) => {
					// The scope key (`SCOPED_EVENTS`): a tab on another
					// session neither hears nor is sent this run's frames.
					const data = { sessionId, ...frame }
					lastFrame = data
					activityStore.updateSessionSummarize(activityId, {
						phase: data.phase,
						batch: data.batch,
						totalBatches: data.totalBatches
					})
					emitToUser("sessions:summarize:progress", data)
				}

				const receipt = await runSpec({
					db,
					sessionId,
					userId,
					specId,
					// So the status relay pushes `sessions:runStatus` beside
					// the modal's own progress frame (R-19) — a summarize run
					// announces like every other run does. No live row here
					// (`preview: { atNode: "save" }` below), so this only
					// ever reaches the session list, never a message.
					io: socket.io,
					input: {
						scope: { sessionId },
						request: {
							topic: topic || undefined,
							messageIds:
								messageIds === "all" ? undefined : messageIds
						}
					},
					signal: abortController.signal,
					preview: { atNode: "save" },
					// The executor's inherent node events (F34): identity in,
					// progress card out — no per-trigger wiring, no dispatch
					// labels, and a plugin's summarize pipeline gets the same
					// card for free.
					onNode: (e) => {
						if (e.phase !== "start") return
						if (
							e.definitionId.startsWith("core:oracle/summarize-batch")
						)
							progress({
								phase: "drafting",
								batch: ++batchesSeen,
								totalBatches: batchesSeen
							})
						else if (
							e.definitionId.startsWith("core:oracle/summarize-synth")
						)
							progress({
								phase: "synthesizing",
								batch: 1,
								totalBatches: 1
							})
						else if (
							e.definitionId.startsWith("core:oracle/name-entry")
						)
							progress({
								phase: "naming",
								batch: 1,
								totalBatches: 1
							})
						else if (
							e.definitionId.startsWith("core:oracle/extract-cast")
						)
							progress({
								phase: "extracting",
								batch: 1,
								totalBatches: 1
							})
					},
					// The run's status (R-19) — *summarising part 2 of 5*,
					// *merging the drafts* — onto the modal's own progress frame,
					// beside the phase the node events derived. The drafting
					// count comes off the status's variables where it has them:
					// the each clause knows its total, and `batchesSeen` never
					// could.
					onStatus: (_nodeKey, status) => {
						const vars = status.vars ?? {}
						const n = Number(vars.n)
						const total = Number(vars.total)
						const counted =
							Number.isFinite(n) && Number.isFinite(total) && total > 0
						progress({
							phase: lastFrame?.phase ?? "drafting",
							batch: counted ? n : (lastFrame?.batch ?? 0),
							totalBatches: counted
								? total
								: (lastFrame?.totalBatches ?? 1),
							status
						})
					}
				})

				const nodeOut = (key: string) =>
					(receipt.nodes.find((n: any) => n.nodeKey === key) as any)
						?.output
				const content: string | undefined = nodeOut("synth")?.content
				const entryName: string | undefined = nodeOut("naming")?.name

				if (!content) {
					const why =
						receipt.haltReason ??
						"the pipeline stopped without producing a summary"
					return failRun(
						receipt.haltNodeKey
							? `${why} (at '${receipt.haltNodeKey}')`
							: why
					)
				}

				// Character lore names the character it is about; the book's
				// cast member for them is found or added by the SAVE, in the
				// entry's own write (`entries:create` with
				// `lorebookBindingCharacterId`), never here — a review
				// discarded or a save refused leaves the book as it was.
				const bindCharacterId =
					loreType === "character" && lorebookBindingCharacterId
						? lorebookBindingCharacterId
						: null

				const response: Sockets.Sessions.Summarize.Response = {
					sessionId,
					content,
					name: entryName,
					raw: content,
					lorebookId: session.lorebookId!,
					batchCount: receipt.nodes.filter((n: any) =>
						String(n.typeId ?? "").startsWith(
							"core:oracle/summarize-batch"
						)
					).length,
					lorebookBindingCharacterId: bindCharacterId
				}

				// A cooperating abort can let the call above resolve normally with
				// a truncated result rather than throw — bail before parking a
				// partial summary in the activity as if it were finished.
				if (abortController.signal.aborted) return null as any

				// Park the result on the activity, not just the socket event.
				// This is the only copy until the user saves, so it has to
				// survive the modal closing.
				activityStore.updateSessionSummarize(activityId, {
					status: "review",
					pendingResult: {
						content: response.content,
						name: response.name,
						raw: response.raw,
						lorebookBindingCharacterId: bindCharacterId
					}
				})

				emitToUser("sessions:summarize:complete", {
					...response,
					activityId
				})
				return response
			} catch (err) {
				// Narrower than it looks, matching scenes.ts: activityStore
				// .cancel() aborts our controller synchronously, so
				// signal.aborted is already true for any exception that is
				// genuinely our own cancellation — and that path has already
				// removed the activity.
				if (abortController.signal.aborted) return null as any
				// `activityError` rather than `err.message`: this record is
				// served back to a non-admin by `activityStore.getFor`, and an
				// adapter failure's words are the base URL and the model file.
				activityStore.updateSessionSummarize(activityId, {
					status: "error",
					...activityError(err)
				})
				throw err
			}
		})()
	}
}

export const sessionsSetLorebookHandler: Handler<
	Sockets.Sessions.SetLorebook.Params,
	Sockets.Sessions.SetLorebook.Response
> = refusable(
	"sessions:setLorebook",
	async (socket, params: Sockets.Sessions.SetLorebook.Params, emitToUser) => {
		const userId = socket.user!.id
		const { sessionId, lorebookId } = params

		// Verify ownership — shared helper, see sessionsSummarizeHandler above.
		const sessionAccess = await checkSessionAccess(sessionId, userId)
		if (!sessionAccess.isOwner) {
			throw new Error("Session not found or access denied.")
		}
		const session = await db.query.sessions.findFirst({
			where: eq(schema.sessions.id, sessionId)
		})

		if (!session) {
			throw new Error("Session not found or access denied.")
		}

		// If attaching a lorebook, verify the user owns it
		if (lorebookId !== null) {
			await assertOwnedBook(db, userId, lorebookId)
		}

		// A new book starts at its most recently used line, the session's
		// clock at that line's present (ruling 15, story-time P3) — the one
		// rule `sessionLinePatch` keeps for every path. The session's
		// story-time stats come with it, checked against the new book's
		// calendar and written in one transaction under its lock.
		const { sessionLinePatch } = await import("./sessions")
		const updated = await db.transaction(async (tx) => {
			const linePatch = await sessionLinePatch(tx, {
				before: {
					lorebookId: session.lorebookId ?? null,
					lorebookBranchId: session.lorebookBranchId ?? null
				},
				session: { id: session.id, name: session.name },
				lorebookId
			})
			const [row] = await tx
				.update(schema.sessions)
				.set({ lorebookId, ...linePatch })
				.where(eq(schema.sessions.id, sessionId))
				.returning()
			return row
		})

		// Attaching a book to a session is one of the two ways the two meet,
		// and the cast arrives on its own from either (ruling 2026-09-12).
		// Imported lazily: this is the only reference summarize.ts has to the
		// sessions module, and a static one would tie the two files' load
		// order together for a single call.
		if (lorebookId !== null) {
			const { runLorebookBindingCheck } = await import("./sessions")
			await runLorebookBindingCheck(
				socket,
				sessionId,
				lorebookId,
				emitToUser
			).catch(console.error)
		}

		await announceSessionLineMoved(
			socket.io,
			sessionId,
			userId,
			session,
			updated
		)

		const response: Sockets.Sessions.SetLorebook.Response = {
			session: updated
		}
		emitToUser("sessions:setLorebook", response)
		return response
	},
	"The session's lorebook could not be changed."
)

export function registerSummarizeHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (
		socket: any,
		handler: Handler<any, any>,
		emitToUser: (event: string, data: any) => void
	) => void
) {
	register(socket, sessionsSummarizeHandler, emitToUser)
	register(socket, sessionsSetLorebookHandler, emitToUser)
}
