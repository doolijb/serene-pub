import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { eq, inArray, asc, and, sql } from "drizzle-orm"
import type { Handler } from "$lib/shared/events"
import { askerOf, refusable } from "./refusable"
import { resolvePersonaName } from "$lib/shared/utils/resolveCharacterName"
import {
	HISTORY_TYPE_ID,
	historyDateOf,
	toEntryRow,
	type LorebookEntry
} from "$lib/server/utils/lorebookEntries"
import { compileScenesForEntry } from "$lib/server/utils/summarizer"
import {
	readSceneCast,
	readSceneCasts,
	castFor,
	writeSceneCast
} from "$lib/server/utils/sceneCast"
import {
	buildSceneCastList,
	reconcileParticipantsAndMentioned,
	reconcileSuggestedNames,
	resolveCharacterRefs
} from "$lib/server/utils/summarizer/availableSceneCast"
import {
	resolveCapabilityTarget,
	TEXT_CAPABILITY
} from "$lib/server/connections/capabilityTarget"
import { activityError, activityStore } from "$lib/server/utils/activityStore"
import { loreWritesOffRefusal, sceneWriteRefusal } from "$lib/server/messages/writes"
import { bookLoreWriteMode } from "$lib/server/state/loreWriteMode"
import { LORE_WRITES_OFF } from "$lib/shared/lorebooks/loreWriteMode"
import { withSessionGenerationLock } from "$lib/server/utils/sessionGenerationLock"
import { checkSessionAccess } from "$lib/server/utils/sessionAccess"
import { resolveOrCreateBinding } from "$lib/server/utils/characterBindingSync"
import {
	compareDates,
	formatDate,
	readStoryCalendar
} from "$lib/shared/lorebooks/storyDate"
import {
	rowReadsOnLine,
	rowsReadingOnLine,
	type Line
} from "$lib/shared/lorebooks/lineReading"
import { inPlayOrder } from "$lib/shared/lorebooks/sceneOrder"
import {
	BranchRefusal,
	historyEntryDate,
	lineOfBook,
	storyDateFrom
} from "$lib/server/state/reading"
import { onLineSql } from "$lib/server/state/lineSql"
import { lockBookCalendar } from "$lib/server/state/storyTime"
import { assertOwnedBook, findOwnedBook } from "$lib/server/utils/ownedBook"

/**
 * Every downstream consumer (graphBuilder.ts, lorebookExportMapper.ts,
 * narrativeGraph.ts) already re-scopes participantCharacters/
 * mentionedCharacters to the scene's own lorebook and silently drops
 * anything foreign — this validates at write time too, matching that same
 * "drop, don't error" tolerance, so a future consumer that trusts these
 * arrays directly without re-scoping doesn't reopen a cross-lorebook leak.
 *
 * These arrays hold **lorebookBindings ids**, not character ids. This scoped
 * by `b.characterId` until now, which is pre-merge semantics the column
 * outgrew — every producer feeding it emits binding ids
 * (scenes:process/sessions:summarize via resolveCharacterRefs' castEntries[].id
 * and resolveOrCreateBinding; the graph build via its seed map). Filtering
 * binding ids through a characterId lookup silently dropped any id that
 * didn't coincidentally equal some bound character's id — and an unbound
 * background/NPC binding, whose characterId is NULL, could never match at
 * all, so every discovered character was erased on save. That is a live cast
 * data-loss path, not a hypothetical: it re-emptied scenes on every
 * re-process, including ones a graph build had just filled in.
 */
async function filterCharacterIdsToLorebook(
	lorebookId: number,
	bindingIds: number[]
): Promise<number[]> {
	if (bindingIds.length === 0) return []
	const bindings = await db.query.lorebookBindings.findMany({
		where: (b, { and, eq, inArray }) =>
			and(eq(b.lorebookId, lorebookId), inArray(b.id, bindingIds)),
		columns: { id: true }
	})
	const validIds = new Set(bindings.map((b) => b.id))
	return bindingIds.filter((id) => validIds.has(id))
}

/**
 * The messages a scene may capture, or a refusal saying why not.
 *
 * Two rules the Summarize dialog already keeps by what it offers, held here so
 * a raw emit cannot break them:
 *
 * - **Every id is one of this session's messages.** A scene's messages are
 *   read back by `scenes:process` pinned to the scene's own session, so an id
 *   from anywhere else is not a message the scene can ever show.
 * - **No message is captured twice.** A message already in one of the
 *   session's scenes is locked out of selection (docs/summarization.md); the
 *   same message in two scenes would be summarised, graphed and counted twice.
 *
 * Refused rather than trimmed: quietly dropping half a selection would save a
 * scene that is not the one the person chose. `null` in is `null` out — the
 * payload did not speak about messages. `exceptSceneId` is the scene being
 * edited, whose own capture is not an overlap with itself.
 */
async function capturableMessageIds(
	tx: Db,
	sessionId: number | null,
	requested: number[] | null,
	exceptSceneId?: number
): Promise<number[] | null> {
	if (requested == null) return null
	const ids = [...new Set(requested)]
	if (ids.length === 0) return []
	if (sessionId == null)
		throw new Error("A scene can only capture messages from a session.")

	// ⚠ Called on the write's transaction, and the overlap check holds the
	// session's capture lock until that write commits: read apart from the
	// write, two saves of one selection each find the other's scene not yet
	// there and both land — the same message captured twice. Keyed on the
	// SESSION, not the book: the rule is "no message in two of this
	// session's scenes", whatever book each scene files under.
	await tx.execute(
		sql`select pg_advisory_xact_lock(hashtext('sceneCapture'), ${sessionId})`
	)

	const found = await tx
		.select({ id: schema.sessionMessages.id })
		.from(schema.sessionMessages)
		.where(
			and(
				eq(schema.sessionMessages.sessionId, sessionId),
				inArray(schema.sessionMessages.id, ids)
			)
		)
	if (found.length !== ids.length)
		throw new Error(
			"Some of the selected messages are not in this session. Nothing was saved."
		)

	const captured = new Set(
		(
			await tx.query.scenes.findMany({
				where: eq(schema.scenes.sessionId, sessionId),
				columns: { id: true, selectedMessageIds: true }
			})
		)
			.filter((s) => s.id !== exceptSceneId)
			.flatMap((s) => s.selectedMessageIds ?? [])
	)
	const overlap = ids.filter((id) => captured.has(id)).length
	if (overlap > 0)
		throw new Error(
			`${overlap} of the selected messages ${
				overlap === 1 ? "is" : "are"
			} already in another scene. Nothing was saved.`
		)
	return ids
}

/**
 * What a scene list reply carries of a scene row: everything but the latent
 * vector columns. A list is projected, never a spread of the stored row — the
 * session's list reaches every guest, and a vector is the server's index, not
 * something any view reads.
 */
const SCENE_REPLY_COLUMNS = { embedding: false, embeddingModel: false } as const

/**
 * The scene list for one session.
 *
 * Split out of the handler below so the two write cascades that re-send it
 * (`scenes:create`, `scenes:delete`) can hand it to `emitToUser` as a thunk
 * (socket-interest plan, ruling 4): ONE source of truth for the payload, and
 * the scene read behind it is paid only when some socket declared the key. A
 * scene written from a surface that shows no scene list — the summarize modal,
 * the lorebook side — pays for none of it. Skipping the emit alone would save
 * nothing; the read is the cost.
 *
 * ⚠ No "next history entry" is computed here any more. It was a branch-blind
 * ordering scan over every history entry in the book that no client read; a
 * view that ever needs it orders the rows on its own line with `compareDates`.
 *
 * The access check stays inside, so the cascade asks exactly what the handler
 * asks. It refuses the same way too — a thunk that throws is caught and logged
 * by `emitToUser`, where the handler's own reply would surface it as an error
 * event.
 */
async function buildSceneList(
	sessionId: number,
	userId: number
): Promise<Sockets.Scenes.List.Response> {
	// Read access: any session participant (owner or guest) can view scenes —
	// this fires on every session page load, so an owner-only check here
	// locks guests out of the session entirely, not just scene management.
	const sessionAccess = await checkSessionAccess(sessionId, userId)
	if (!sessionAccess.hasAccess) {
		throw new Error("Session not found or access denied.")
	}

	const scenes = await db.query.scenes.findMany({
		where: eq(schema.scenes.sessionId, sessionId),
		orderBy: (s, { asc }) => asc(s.id),
		// Projected (`SCENE_REPLY_COLUMNS`): this list reaches every guest.
		columns: SCENE_REPLY_COLUMNS,
		with: {
			// The date and the completion flag are declared fields now,
			// so the row carries `fields` and the projection below reads
			// them out — see `toEntryRow`.
			historyEntry: {
				columns: { id: true, fields: true }
			}
		}
	})

	const sceneList = (scenes as any[]).map((s) => ({
		...s,
		historyEntry: s.historyEntry
			? {
					id: s.historyEntry.id,
					...historyDateOf(s.historyEntry),
					isCompleted: s.historyEntry.fields?.isCompleted ?? false
				}
			: null
	}))

	return {
		// Present so the interest scope can be derived — one builder, so every
		// emit of this event carries it: the handler's own reply and the three
		// write cascades alike.
		sessionId,
		sceneList: sceneList as unknown as Sockets.Scenes.List.SceneWithEntry[]
	}
}

export const sceneListHandler: Handler<
	Sockets.Scenes.List.Params,
	Sockets.Scenes.List.Response
> = refusable(
	"scenes:list",
	async (socket, params: Sockets.Scenes.List.Params, emitToUser) => {
		const res = await buildSceneList(params.sessionId, socket.user!.id)
		emitToUser("scenes:list", res)
		return res
	},
	"The session's scenes could not be listed."
)

export const sceneCreateHandler: Handler<
	Sockets.Scenes.Create.Params,
	Sockets.Scenes.Create.Response
> = refusable(
	"scenes:create",
	async (socket, params: Sockets.Scenes.Create.Params, emitToUser) => {
		const userId = socket.user!.id
		/**
		 * An ALLOWLIST of what the client may say, never a spread of it.
		 *
		 * Never `{ ...params.scene }`: that lets a client write any column —
		 * `branchId` included, unvalidated, and `graphed` or `castResolvedAt`
		 * besides. The line a scene is on is the server's to
		 * decide (from the session, below), and the two markers are written by
		 * the paths that earn them. Cast rides alongside on the wire but is
		 * stored in `scene_characters`, so it is taken off here too.
		 */
		const {
			lorebookId,
			sessionId,
			historyEntryId,
			name,
			summary,
			selectedMessageIds: requestedMessageIds,
			participantCharacters: rawParticipants,
			mentionedCharacters: rawMentioned
		} = params.scene as InsertScene & Partial<Sockets.Scenes.SceneCast>

		// Verify lorebook ownership
		const lorebook = await assertOwnedBook(db, userId, lorebookId)

		// A scene written from a session is on the session's line — the branch
		// it reads this book on — and a scene written anywhere else is on main.
		// Only when the session reads THIS book: a session reading another
		// book (or none) has no line in this one.
		let branchId: number | null = null
		let onSessionLine = false

		// If sessionId provided, verify session ownership
		if (sessionId) {
			const session = await db.query.sessions.findFirst({
				where: (c, { and, eq }) =>
					and(eq(c.id, sessionId), eq(c.userId, userId))
			})
			if (!session) {
				throw new Error("Session not found or access denied.")
			}
			/**
			 * Declared writes (R-B): a scene opened *from a session* is a
			 * session write, and a genre that opens none refuses it here.
			 * Gated on `sessionId` and nothing else — a scene created from the
			 * lorebook screens carries no session and is a person at a book,
			 * which this lever deliberately says nothing about.
			 */
			const noScenes = await sceneWriteRefusal(db, sessionId)
			if (noScenes) throw new Error(noScenes)
			// A scene saved from a session is a session writing the book: the
			// book owner's lore write mode Off refuses it (plan A22).
			const off = await loreWritesOffRefusal(db, sessionId)
			if (off) throw new Error(off)
			if (session.lorebookId === lorebookId) {
				branchId = session.lorebookBranchId ?? null
				onSessionLine = true
			}
		}

		const carriesCast =
			rawParticipants !== undefined || rawMentioned !== undefined
		const participantCharacters = await filterCharacterIdsToLorebook(
			lorebookId,
			rawParticipants ?? []
		)
		const mentionedCharacters = await filterCharacterIdsToLorebook(
			lorebookId,
			rawMentioned ?? []
		)

		// The line check and the insert in one transaction under the book's
		// lock (`lockBookCalendar`), the lock a re-date takes: checked apart,
		// an entry re-dated past the line's fork between the two would have
		// this scene filed under a moment its line never had, and the re-date
		// would not have seen the scene to refuse (`assertRedateKeepsLines`).
		//
		// The capture rules are checked on the same transaction, under the
		// session's capture lock (`capturableMessageIds`), so two saves of one
		// selection cannot both pass the overlap check before either lands.
		const newScene = await db.transaction(async (tx) => {
			await lockBookCalendar(tx, lorebookId)
			const selectedMessageIds = await capturableMessageIds(
				tx,
				sessionId ?? null,
				requestedMessageIds ?? null
			)
			// Without this, a scene could be created with an attacker's own
			// lorebookId/sessionId but a guessed historyEntryId from a victim's
			// private lorebook — sceneCompileHandler queries scenes by
			// historyEntryId alone, so the injected scene's content would feed
			// directly into the victim's own LLM-driven compile call the next
			// time they compile that history entry.
			const [historyEntry] = await tx
				.select({
					lorebookId: schema.lorebookEntries.lorebookId,
					branchId: schema.lorebookEntries.branchId,
					fields: schema.lorebookEntries.fields
				})
				.from(schema.lorebookEntries)
				.where(
					and(
						eq(schema.lorebookEntries.id, historyEntryId),
						eq(schema.lorebookEntries.typeId, HISTORY_TYPE_ID)
					)
				)
			if (!historyEntry || historyEntry.lorebookId !== lorebookId) {
				throw new Error(
					"History entry not found or does not belong to this lorebook."
				)
			}
			// Filed only under a history entry the scene's line reads (plan A8),
			// by the rule `scenes:compile` reads it by: never a sibling line's
			// entry, nor an ancestor's dated after the line forked. A scene under
			// an entry its line never read goes with a line it is not on: a main
			// scene with a deleted branch's entry, a fork's with the line it left
			// (`keepHistoryForForks` keeps for a fork only the entries it reads).
			let line: Line
			try {
				line = await lineOfBook(tx, lorebookId, branchId)
			} catch (e) {
				if (e instanceof BranchRefusal)
					throw new Error("This session's line is not one of this lorebook's.", {
						cause: e
					})
				throw e
			}
			if (
				!rowReadsOnLine(historyEntry, line, historyEntryDate(historyEntry.fields))
			)
				throw new Error(
					onSessionLine
						? "That history entry is not on this session's line of the lorebook, so the scene cannot be filed under it."
						: "That history entry is not on main, where this scene is saved, so the scene cannot be filed under it."
				)

			const sceneRow: InsertScene = {
				lorebookId,
				sessionId: sessionId ?? null,
				historyEntryId,
				branchId,
				...(name !== undefined ? { name } : {}),
				...(summary !== undefined ? { summary } : {}),
				...(selectedMessageIds !== null ? { selectedMessageIds } : {}),
				// Mark the cast resolved ONLY when this insert actually carries
				// cast — never unconditionally. scenes:create can carry a
				// summary without cast (SummarizeLoreModal emits both together, but
				// nothing requires it), and marking such a row resolved would let a
				// summarized-but-never-resolved scene claim it needs no extraction —
				// silently re-enacting the bug that column exists to end.
				...(carriesCast ? { castResolvedAt: new Date() } : {})
			}

			const [inserted] = await tx
				.insert(schema.scenes)
				.values(sceneRow)
				.returning()

			if (carriesCast) {
				await writeSceneCast(
					inserted.id,
					{ participantCharacters, mentionedCharacters },
					tx
				)
			}
			return inserted
		})

		// A capture is one of the three moments a session's numbers are written
		// onto the world's timeline (R8): the scene names the history entry, so
		// this is the moment the state has a place on the story clock to be
		// filed at. Best-effort — a capture that succeeded must not be reported
		// as failed because the timeline write did — and silent for a session
		// with no world, which has no timeline by design.
		let notRecorded: string[] = []
		if (newScene.sessionId) {
			try {
				const { recordToTimeline } = await import(
					"$lib/server/state/durable"
				)
				// What the book would not take is said to whoever saved the
				// scene (A18); the scene stands either way.
				const report = await recordToTimeline(db, newScene.sessionId, {
					reason: "scene",
					sceneId: newScene.id,
					historyEntryId: newScene.historyEntryId
				})
				notRecorded = report.refused
			} catch (e) {
				console.warn(
					"[scenes:create] state was not recorded to the timeline:",
					e
				)
			}
		}

		// Refresh scene list and scened message IDs for the session.
		//
		// LAZY (socket-interest plan, ruling 4): both are pushes nobody asked
		// for, and a scene can be created from surfaces that show neither —
		// the summarize modal, the lorebook side — so the reads behind them
		// are paid only where a view declared the key. One builder, one emit
		// per event: a cascade that calls the list HANDLER instead sends the
		// payload twice, since the handler emits it and the caller then emits
		// what it returned.
		if (emitToUser && newScene.sessionId) {
			const sessionId = newScene.sessionId
			await emitToUser("scenes:list", () =>
				buildSceneList(sessionId, userId)
			)
			await emitToUser("scenes:scenedMessageIds", () =>
				buildScenedMessageIds(sessionId, userId)
			)
		}

		const res: Sockets.Scenes.Create.Response = {
			scene: {
				...newScene,
				participantCharacters,
				mentionedCharacters
			},
			...(notRecorded.length ? { notRecorded } : {}),
			...askerOf(params)
		}
		emitToUser("scenes:create", res)
		return res
	},
	"The scene could not be saved.",
	undefined,
	askerOf
)

export const sceneUpdateHandler: Handler<
	Sockets.Scenes.Update.Params,
	Sockets.Scenes.Update.Response
> = refusable(
	"scenes:update",
	async (socket, params: Sockets.Scenes.Update.Params, emitToUser) => {
		const userId = socket.user!.id

		const existing = await db.query.scenes.findFirst({
			where: eq(schema.scenes.id, params.scene.id)
		})

		if (!existing) throw new Error("Scene not found.")

		const lorebook = await findOwnedBook(db, userId, existing.lorebookId)

		if (!lorebook) {
			throw new Error("Scene not found or access denied.")
		}
		// A session's scene saved is a session writing the book: lore writes
		// Off refuses it, as it refuses the scene's creation (plan A22). A
		// scene with no session is a person at a book, which it does not touch.
		if (existing.sessionId != null) {
			const off = await loreWritesOffRefusal(db, existing.sessionId)
			if (off) throw new Error(off)
		}

		// Explicit allowlist, not a spread — ownership above is only checked
		// against the scene's *current* lorebookId; without this, a client
		// could redirect their own scene into another user's lorebook/session/
		// history entry by including a foreign id in the payload, with no
		// re-validation (sceneCreateHandler validates its target ids on
		// insert — this was the one outlier that didn't).
		let {
			name,
			summary,
			selectedMessageIds,
			participantCharacters,
			mentionedCharacters,
			graphed
		} = params.scene

		// Cast is only rewritten when the payload actually carries it; a rename
		// or summary edit leaves the existing scene_characters rows alone.
		const carriesCast =
			participantCharacters !== undefined ||
			mentionedCharacters !== undefined
		if (carriesCast) {
			participantCharacters = await filterCharacterIdsToLorebook(
				existing.lorebookId,
				participantCharacters ?? []
			)
			mentionedCharacters = await filterCharacterIdsToLorebook(
				existing.lorebookId,
				mentionedCharacters ?? []
			)
		}

		await db.transaction(async (tx) => {
			// The same two capture rules `scenes:create` holds — this session's
			// messages only, none already in another scene — minus this scene's
			// own capture, which is not an overlap with itself. Checked on the
			// write's transaction under the session's capture lock, as there.
			if (selectedMessageIds !== undefined)
				selectedMessageIds =
					(await capturableMessageIds(
						tx,
						existing.sessionId ?? null,
						selectedMessageIds ?? null,
						existing.id
					)) ?? undefined

			await tx
				.update(schema.scenes)
				.set({
					...(name !== undefined ? { name } : {}),
					...(summary !== undefined ? { summary } : {}),
					...(selectedMessageIds !== undefined
						? { selectedMessageIds }
						: {}),
					// Only an update that actually carries cast marks it resolved.
					// A rename or a summary edit must not — otherwise every scene
					// touched for any reason would claim it needs no extraction.
					...(carriesCast ? { castResolvedAt: new Date() } : {}),
					...(graphed !== undefined ? { graphed } : {})
				})
				.where(eq(schema.scenes.id, params.scene.id))

			if (carriesCast) {
				await writeSceneCast(
					params.scene.id,
					{ participantCharacters, mentionedCharacters },
					tx
				)
			}
		})

		const [updated] = await db
			.select()
			.from(schema.scenes)
			.where(eq(schema.scenes.id, params.scene.id))

		// Refresh scene list — lazy, for the reasons `scenes:create` gives.
		if (emitToUser && updated.sessionId) {
			const sessionId = updated.sessionId
			await emitToUser("scenes:list", () =>
				buildSceneList(sessionId, userId)
			)
		}

		const res = {
			scene: { ...updated, ...(await readSceneCast(params.scene.id)) }
		}

		/**
		 * The review a save finishes, dismissed only now the save has landed.
		 *
		 * ⚠ Never dismiss beside this update (a separate `activity:dismiss`):
		 * the two race. The dismiss runs the ephemeral-scene cleanup, which
		 * deletes a scene with no summary and no resolved cast — exactly what a
		 * session-side scene still is until THIS write commits — so whichever
		 * arrives first decides whether the person's save survives. Dismissing
		 * here, after the write, means the cleanup can only ever see a scene
		 * that has its summary.
		 *
		 * Only a review of this very scene, owned by this person, is dismissed;
		 * anything else named here is ignored rather than refused, because the
		 * save itself has already succeeded.
		 */
		if (params.activityId) {
			const activity = activityStore.getById(params.activityId)
			if (
				activity?.kind === "scene_summarize" &&
				activity.userId === userId &&
				activity.sceneId === params.scene.id
			)
				// `acted`: the result was used, which is what clears its
				// notification as done rather than as dismissed.
				activityStore.remove(params.activityId, "acted")
		}

		emitToUser("scenes:update", res)
		return res
	},
	"The scene could not be saved."
)

export const sceneDeleteHandler: Handler<
	Sockets.Scenes.Delete.Params,
	Sockets.Scenes.Delete.Response
> = refusable(
	"scenes:delete",
	async (socket, params: Sockets.Scenes.Delete.Params, emitToUser) => {
		const userId = socket.user!.id

		const existing = await db.query.scenes.findFirst({
			where: eq(schema.scenes.id, params.id)
		})

		if (!existing) throw new Error("Scene not found.")

		const lorebook = await findOwnedBook(db, userId, existing.lorebookId)

		if (!lorebook) {
			throw new Error("Scene not found or access denied.")
		}

		const sessionId = existing.sessionId

		await db.delete(schema.scenes).where(eq(schema.scenes.id, params.id))

		// Refresh scene list and scened message IDs — lazy, and once each,
		// for the reasons `scenes:create` gives above.
		if (emitToUser && sessionId) {
			await emitToUser("scenes:list", () =>
				buildSceneList(sessionId, userId)
			)
			await emitToUser("scenes:scenedMessageIds", () =>
				buildScenedMessageIds(sessionId, userId)
			)
		}

		/**
		 * The delete itself, told to every view of this person's.
		 *
		 * Every view hears it: without this emit a scene deleted from the
		 * lorebook side stays on screen until something else refetches, because
		 * the lorebook views only hear the session cascades above when a SESSION
		 * view is open. Bare (not in `SCOPED_EVENTS`), so it names the book and
		 * the session it was in and each listener filters on the one it shows.
		 */
		const res: Sockets.Scenes.Delete.Response = {
			success: "Scene deleted.",
			id: params.id,
			lorebookId: existing.lorebookId,
			sessionId: sessionId ?? null
		}
		emitToUser("scenes:delete", res)
		return res
	},
	"The scene could not be deleted."
)

/**
 * Which messages of a session are already captured in a scene.
 *
 * Split out for the same reason as `buildSceneList` — the create and delete
 * cascades hand it to `emitToUser` as a thunk, so the read is paid only where
 * a session view is open to grey the captured messages out.
 */
async function buildScenedMessageIds(
	sessionId: number,
	userId: number
): Promise<Sockets.Scenes.SenedMessageIds.Response> {
	// Read access: any session participant (owner or guest) — see buildSceneList.
	const sessionAccess = await checkSessionAccess(sessionId, userId)
	if (!sessionAccess.hasAccess) {
		throw new Error("Session not found or access denied.")
	}

	const scenes = await db.query.scenes.findMany({
		where: eq(schema.scenes.sessionId, sessionId),
		columns: { selectedMessageIds: true }
	})

	return {
		// Present so the interest scope can be derived — see `buildSceneList`.
		sessionId,
		scenedMessageIds: scenes.flatMap((s) => s.selectedMessageIds ?? [])
	}
}

export const scenedMessageIdsHandler: Handler<
	Sockets.Scenes.SenedMessageIds.Params,
	Sockets.Scenes.SenedMessageIds.Response
> = refusable(
	"scenes:scenedMessageIds",
	async (socket, params: Sockets.Scenes.SenedMessageIds.Params, emitToUser) => {
		const res = await buildScenedMessageIds(
			params.sessionId,
			socket.user!.id
		)
		emitToUser("scenes:scenedMessageIds", res)
		return res
	},
	"Which messages are in a scene could not be read."
)

export const sceneListByLorebookHandler: Handler<
	Sockets.Scenes.ListByLorebook.Params,
	Sockets.Scenes.ListByLorebook.Response
> = refusable(
	"scenes:listByLorebook",
	async (socket, params: Sockets.Scenes.ListByLorebook.Params, emitToUser) => {
		const userId = socket.user!.id

		// Verify lorebook ownership
		const lorebook = await assertOwnedBook(db, userId, params.lorebookId)

		const scenes = await db.query.scenes.findMany({
			where: eq(schema.scenes.lorebookId, params.lorebookId),
			orderBy: [asc(schema.scenes.historyEntryId), asc(schema.scenes.id)],
			columns: SCENE_REPLY_COLUMNS
		})

		// Resolve session names in a single query
		const sessionIds = [
			...new Set(
				scenes.filter((s) => s.sessionId).map((s) => s.sessionId!)
			)
		]
		const sessions =
			sessionIds.length > 0
				? await db.query.sessions.findMany({
						where: inArray(schema.sessions.id, sessionIds),
						columns: { id: true, name: true }
					})
				: []
		const sessionMap = new Map(sessions.map((c) => [c.id, c.name]))

		// One indexed query for the whole page's cast, not one per scene.
		const casts = await readSceneCasts(scenes.map((s) => s.id))

		const sceneList: Sockets.Scenes.SceneWithMeta[] = scenes.map((s) => ({
			...s,
			...castFor(casts, s.id),
			sessionName: s.sessionId
				? (sessionMap.get(s.sessionId) ?? null)
				: null
		}))

		// ⚠ `lorebookId` is LOAD-BEARING, not informational: `SCOPED_EVENTS`
		// scopes this event on it, every subscriber holds a scoped key, and
		// without it the gate resolved the scope to null and dropped every
		// reply in silence — the lorebook side never heard its scene list.
		//
		// Every line's scenes, each carrying its own `branchId`, exactly as
		// `entries:list` answers: the reply is broadcast to every view of the
		// book, and those views read different lines, so a reply filtered for
		// one would be wrong for the next. A view keeps the rows on its line
		// with `rowsReadingOnLine`, the rule `entries:counts` counts by.
		const res: Sockets.Scenes.ListByLorebook.Response = {
			lorebookId: params.lorebookId,
			sceneList
		}
		emitToUser("scenes:listByLorebook", res)
		return res
	},
	"The book's scenes could not be listed."
)

/**
 * Each message's place in play (`inPlayOrder`): its id, or for a branched
 * session's copy the id of the message it copies (`metadata.copyOf`). A
 * message that no longer exists keeps its id as its place.
 */
async function placesInPlay(
	messageIds: readonly number[]
): Promise<(messageId: number) => number> {
	const ids = [...new Set(messageIds)]
	if (!ids.length) return (id) => id
	const rows = await db
		.select({
			id: schema.sessionMessages.id,
			metadata: schema.sessionMessages.metadata
		})
		.from(schema.sessionMessages)
		.where(inArray(schema.sessionMessages.id, ids))
	const copyOf = new Map<number, number>()
	for (const row of rows) {
		const original = row.metadata?.copyOf
		if (typeof original === "number") copyOf.set(row.id, original)
	}
	return (id) => copyOf.get(id) ?? id
}

export const sceneCompileHandler: Handler<
	Sockets.Scenes.Compile.Params,
	Sockets.Scenes.Compile.Response
> = {
	event: "scenes:compile",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id

		/**
		 * A refusal the compile modal hears as the sentence it is. The throw
		 * still follows, for the log, and `register()` sees the specific error
		 * went out and adds no second one.
		 *
		 * ⚠ This handler answers every refusal itself — the run's failure with
		 * the card's own sentence, never the adapter's words — so it is not
		 * wrapped in `refusable()`, which would answer each one twice.
		 */
		/**
		 * The entry the compile was asked about, when the request named one —
		 * every refusal carries it, so a second Compile window in the tab
		 * (a lorebook docked beside a session page) is not flipped to the
		 * error step by this one's failure (plan B8).
		 */
		const about =
			typeof params?.historyEntryId === "number" &&
			Number.isInteger(params.historyEntryId)
				? { historyEntryId: params.historyEntryId }
				: {}
		const refuse = (error: string, cause?: unknown): never => {
			emitToUser("scenes:compile:error", {
				...about,
				error
			} satisfies Sockets.Scenes.Compile.ErrorResponse)
			throw new Error(error, cause === undefined ? undefined : { cause })
		}

		// Verify history entry ownership via lorebook
		const [row] = await db
			.select({
				entry: schema.lorebookEntries,
				lorebook: schema.lorebooks
			})
			.from(schema.lorebookEntries)
			.innerJoin(
				schema.lorebooks,
				eq(schema.lorebooks.id, schema.lorebookEntries.lorebookId)
			)
			.where(
				and(
					eq(schema.lorebookEntries.id, params.historyEntryId),
					eq(schema.lorebookEntries.typeId, HISTORY_TYPE_ID)
				)
			)
		if (!row || row.lorebook.userId !== userId)
			return refuse("History entry not found or access denied.")
		// A compile folds what sessions played into the book: the owner's
		// lore write mode Off refuses it before any work (plan A22). Its save
		// is an ordinary entry edit, so the refusal sits here.
		if ((await bookLoreWriteMode(db, row.lorebook.id)) === "off")
			return refuse(LORE_WRITES_OFF)
		// Narrowed to the dated type, which the `type_id` predicate above
		// already guaranteed: `toEntryRow` returns the union of every declared
		// shape, and reading a date off that union is exactly the mistake the
		// branded type exists to refuse.
		const historyEntry = {
			...(toEntryRow(row.entry) as LorebookEntry<typeof HISTORY_TYPE_ID>),
			lorebook: row.lorebook
		}

		/**
		 * The reading the compile is asked from: the line its reader stands on
		 * (null is main) and the moment (null is now). The line decides which
		 * scenes are compiled; the moment is where the review saves. Both ride
		 * the activity, so a review reopened later saves where it was asked.
		 */
		const branchId = params.branchId ?? null
		const moment = params.moment == null ? null : storyDateFrom(params.moment)
		if (params.moment != null && !moment)
			return refuse("That moment is not a story date.")
		let line: Line
		try {
			line = await lineOfBook(db, historyEntry.lorebookId, branchId)
		} catch (e) {
			if (e instanceof BranchRefusal)
				return refuse("That line is not one of this lorebook's.", e)
			throw e
		}
		const entryDate =
			typeof historyEntry.year === "number"
				? {
						year: historyEntry.year,
						month: historyEntry.month ?? null,
						day: historyEntry.day ?? null
					}
				: null
		// The entry must read on this line: a sibling line's entry is not on
		// it at all, and an ancestor's entry dated past the line's fork cut
		// is a story this line never had.
		if (!rowReadsOnLine(row.entry, line, entryDate))
			return refuse("That history entry is not on the line you are reading.")
		// At a moment before the entry's own date the event has not happened,
		// and an amendment dated then would be a change to nothing.
		if (moment && entryDate && compareDates(moment, entryDate) < 0)
			return refuse(
				"That moment is before this history entry's date, so there is nothing to compile into yet."
			)

		// The scenes this line reads under this entry: main's shared ones and
		// the chain's own, each ancestor's only up to its fork cut — never a
		// sibling line's. Scoped to this lorebook too (already known-owned),
		// not just historyEntryId, so a scene whose entry and book drifted
		// apart is never read. A scene is dated by its entry, so every one of
		// them shares that date.
		const lineScenes = rowsReadingOnLine(
			await db.query.scenes.findMany({
				where: and(
					eq(schema.scenes.historyEntryId, params.historyEntryId),
					eq(schema.scenes.lorebookId, historyEntry.lorebookId),
					onLineSql(schema.scenes.branchId, line)
				)
			}),
			line,
			() => entryDate
		)
		const scenes = inPlayOrder(
			lineScenes,
			await placesInPlay(lineScenes.flatMap((s) => s.selectedMessageIds ?? []))
		)

		if (scenes.length === 0)
			return refuse("No scenes found for this history entry.")

		/**
		 * The synthesis step's config comes from the **history summarize
		 * pipeline** — its `synth` node's connection, sampling and prompt,
		 * resolved through the same chain the pipeline panel edits. The
		 * compile itself stays outside the executor for now (it *updates* an
		 * existing entry from pre-drafted scene summaries — a shape the
		 * messages-to-batches spec does not carry), but what it runs on is the
		 * pipeline's to decide.
		 */
		const { resolveStepConfigs } = await import(
			"$lib/server/pipelines/config/stepConfig"
		)
		const { SUMMARIZE_HISTORY_SPEC_ID, SUMMARIZE_VERSION } = await import(
			"$lib/server/pipelines/specs/summarize"
		)
		const synthCfg = (
			await resolveStepConfigs(db, SUMMARIZE_HISTORY_SPEC_ID, ["synth"])
		)["synth"]

		// The synth node's own pick, over the instance's `text->text` default.
		//
		// It used to be `synthCfg?.connection ?? connection`, where `connection`
		// came from `getUserConfigurations` — a fourth tier, and one that read
		// the instance default from a different column than every other
		// consumer. `resolveCapabilityTarget` is the whole chain: the capability
		// default underneath, the synth node's selection over it, and the
		// refusal sentence when neither spoke. `resolveStepConfigs` hands back
		// rows, so their ids go in as the pipelineConfig tier.
		const target = await resolveCapabilityTarget(db, {
			capability: TEXT_CAPABILITY,
			pipelineConfig: {
				connectionId: synthCfg?.connection?.id ?? null,
				samplingConfigId: synthCfg?.sampling?.id ?? null
			}
		})
		if (!target.ok) return refuse(target.problem.message)
		const compileConnection = target.connection
		// ⚠ A missing sampling config is NOT fatal to the chain — `resolveSampling
		// (null)` means "let the backend use its own defaults" — but it is fatal
		// to THIS caller: `compileScenesForEntry` takes a row and reads
		// `sampling.name` off it to label the queue entry. So it is refused here,
		// where the sentence can name a screen, rather than reaching the
		// summarizer as a null and surfacing as a property access on undefined.
		// It is only reachable if somebody clears the sampling half explicitly —
		// `db/defaults.ts` re-seeds `text->text` on every boot while it is unset.
		if (!target.sampling)
			return refuse(
				"No sampling config is set for chat, and summarizing needs one. " +
					"Choose one in Admin → Defaults."
			)
		const compileSampling = target.sampling

		const lorebook = historyEntry.lorebook
		// In the book's own calendar — the free-form "Year X, Mo. Y, Day Z"
		// when it has none. `formatDate` decides that; never spell it by hand.
		const historyEntryDate = formatDate(
			historyEntry,
			readStoryCalendar(lorebook.storyCalendar)
		)

		const abortController = new AbortController()
		let activityId: string
		try {
			activityId = activityStore.startCompile(
				{
					userId,
					historyEntryId: params.historyEntryId,
					historyEntryDate,
					lorebookId: historyEntry.lorebookId,
					lorebookLabel: lorebook.name,
					branchId,
					moment
				},
				abortController
			)
		} catch (e: any) {
			// "A compile of this entry is already in progress for this line and moment." — ours.
			return refuse(e?.message || "That history entry could not be compiled.", e)
		}

		let result
		try {
			result = await compileScenesForEntry({
				scenes,
				connection: compileConnection,
				sampling: compileSampling,
				synthSystemPrompt: synthCfg?.prompts?.synth ?? null,
				signal: abortController.signal,
				onProgress: (data) => {
					activityStore.updateCompile(activityId, {
						phase: data.phase,
						batch: data.batch,
						totalBatches: data.totalBatches
					})
					emitToUser("scenes:compile:progress", {
						...data,
						// Present so the interest scope can be derived: the
						// compile is asked for one history entry, and only
						// the view watching that entry should be told how
						// far it has got. `:complete` already carried it.
						historyEntryId: params.historyEntryId,
						// The reading too: two lines' compiles of one entry
						// are two runs, and a modal hears only its own.
						branchId,
						moment
					} satisfies Sockets.Scenes.Compile.Progress)
				}
			})
		} catch (err) {
			// Deliberately narrower than narrativeGraph.ts's equivalent guard
			// — do NOT add `|| isQueueCancellation(err) || err.name ===
			// "AbortError"`. activityStore.cancel() aborts our controller
			// synchronously, so signal.aborted is already true for every
			// exception that's actually our own cancel; the extra disjuncts
			// only add a way to misfire on a cancellation from somewhere else
			// and strand this activity at "running" forever (permanently,
			// here — startCompile refuses to supersede a "running" entry).
			if (abortController.signal.aborted) {
				return null as any // already removed by activityStore.cancel() — nothing to update
			}
			// `activityError` rather than `err.message`: this record is served
			// back to a non-admin by `activityStore.getFor`, and an adapter
			// failure's words are the base URL and the model file. The modal
			// is told the card's own sentence, never the adapter's; the log
			// keeps the whole error.
			const failure = activityError(err)
			activityStore.updateCompile(activityId, {
				status: "error",
				...failure
			})
			emitToUser("scenes:compile:error", {
				...about,
				error: failure.errorMessage
			} satisfies Sockets.Scenes.Compile.ErrorResponse)
			throw err
		}

		// Cooperating abort can make the call above resolve normally (with
		// a truncated/partial result) rather than throw — see
		// runQueuedLLMCall/runGeneration. Guard here too, not just in catch.
		if (abortController.signal.aborted) {
			return null as any
		}

		// A run row for the compile — halted at the write, truthfully: the
		// result is held for review and the save is the person's act. A row
		// that cannot be written is the run's record lost, not the text: the
		// compiled text still goes to review (a second compile would pay for
		// the same text again), and the log keeps the failure.
		try {
			const { saveReceipt } = await import(
				"$lib/server/pipelines/runtime/receipts"
			)
			const { v4: uuidv4 } = await import("uuid")
			const now = Date.now()
			await saveReceipt(
				db,
				{
					runId: uuidv4(),
					specId: SUMMARIZE_HISTORY_SPEC_ID,
					specVersion: SUMMARIZE_VERSION,
					outcome: "halt",
					haltNodeKey: "save",
					haltReason: `compiled ${scenes.length} scene summaries into a history entry draft, held for review`,
					triggerSource: "ui",
					seed: `compile:${params.historyEntryId}`,
					startedAt: now,
					endedAt: now,
					nodes: []
				} as any,
				{ userId }
			)
		} catch (err) {
			console.warn(
				`[scenes:compile] the run row for history entry ${params.historyEntryId} could not be written; the compiled text goes to review without it.`,
				err
			)
		}

		activityStore.updateCompile(activityId, {
			status: "review",
			pendingResult: { content: result.content ?? result.raw }
		})

		const response: Sockets.Scenes.Compile.Response = {
			content: result.content ?? result.raw,
			historyEntryId: params.historyEntryId,
			branchId,
			moment,
			activityId
		}
		emitToUser("scenes:compile:complete", response)
		return response
	}
}

/**
 * A refusal the review modal can hear: `refusable()` answers every failure —
 * a sentence this handler words, a query that failed, a bug — on
 * `scenes:process:error` with the request's `sceneId`, because the modal
 * listens on `scenes:process:error#<sceneId>`: a refusal naming no scene never
 * reaches it, and the modal would spin at "running".
 */
export const sceneProcessHandler: Handler<
	Sockets.Scenes.Process.Params,
	Sockets.Scenes.Process.Response
> = refusable(
	"scenes:process",
	async (socket, params: Sockets.Scenes.Process.Params, emitToUser) => {
		const userId = socket.user!.id

		const scene = await db.query.scenes.findFirst({
			where: eq(schema.scenes.id, params.sceneId)
		})
		if (!scene) throw new Error("Scene not found.")

		const lorebook = await findOwnedBook(db, userId, scene.lorebookId)
		if (!lorebook) throw new Error("Scene not found or access denied.")
		// Nothing drafted here could be saved with lore writes Off, so none is
		// drafted — refused before a card starts, as a summarize is (plan A22).
		if (scene.sessionId != null) {
			const off = await loreWritesOffRefusal(db, scene.sessionId)
			if (off) throw new Error(off)
		}

		// Register the activity BEFORE any queued work.
		//
		// The message read below takes the session trigger lock, which is a FIFO
		// queue — so a summarize started while a generation is in flight waits
		// that generation out. Registering first means the card appears
		// immediately as "running" instead of the user staring at nothing, makes
		// cancel-during-the-wait reachable through the abort check further down,
		// and gives the early-return failures below something to terminalize
		// rather than failing card-less.
		// Re-runs come from the review modal, which only knows the sceneId — so
		// inherit the flag from the activity being superseded. Without this a
		// regenerate would quietly downgrade a session-created scene to permanent,
		// and cancelling afterwards would leave an empty scene behind.
		const inheritedEphemeral = activityStore
			.getFor(userId, false)
			.some(
				(a) =>
					a.kind === "scene_summarize" &&
					a.sceneId === params.sceneId &&
					a.ephemeralOnCancel === true
			)

		const abortController = new AbortController()
		const activityId = activityStore.startScene(
			{
				userId,
				sceneId: params.sceneId,
				sceneName: scene.name ?? undefined,
				lorebookId: scene.lorebookId,
				lorebookLabel: lorebook.name,
				historyEntryId: scene.historyEntryId ?? undefined,
				ephemeralOnCancel:
					params.ephemeralOnCancel === true || inheritedEphemeral
			},
			abortController
		)

		/**
		 * The card ends in `error` whatever stopped the run — a sentence of its
		 * own (`failRun`) or a failure it did not word (a query, the model's
		 * service) — and the throw is the refusal `refusable()` names by
		 * scene. A card left "running" refuses every retry.
		 */
		let ended = false
		const failRun = (error: string): never => {
			ended = true
			activityStore.updateScene(activityId, {
				status: "error",
				errorMessage: error
			})
			throw new Error(error)
		}

		try {
			if (!scene.sessionId || !scene.selectedMessageIds?.length) {
				return failRun("Scene has no linked messages to process.")
			}

			// Snapshot inside the lock, LLM outside it.
			//
			// This is the only sessionMessages read in the whole path and it is pinned
			// to selectedMessageIds — no surrounding window, no "all" fallback — and
			// the summarize-scene run reads no messages itself. So the lock only has to cover
			// the read, closing the TOCTOU against a concurrent delete or
			// generation. Holding it across the run would instead queue the user's
			// next message behind minutes of LLM calls, which is precisely the trap
			// a minimize-first flow must not set.
			const rawMessages = await withSessionGenerationLock(
				scene.sessionId,
				async () =>
					db.query.sessionMessages.findMany({
						where: (cm, { and, eq, inArray }) =>
							and(
								eq(cm.sessionId, scene.sessionId!),
								inArray(cm.id, scene.selectedMessageIds!)
							),
						orderBy: (cm, { asc }) => asc(cm.id)
					})
			)

			if (abortController.signal.aborted) return null as any

			if (rawMessages.length === 0) {
				return failRun("No messages found for this scene.")
			}

			const charIds = [
				...new Set(
					rawMessages
						.filter((m) => m.characterId)
						.map((m) => m.characterId!)
				)
			]
			const personaIds = [
				...new Set(
					rawMessages.filter((m) => m.personaId).map((m) => m.personaId!)
				)
			]

			const knownCast = await buildSceneCastList(
				params.sceneId,
				scene.lorebookId,
				scene.sessionId ?? null
			)

			/**
			 * The scene summarize pipeline — its own namespace, with the cast
			 * extraction step the other three lore types do not carry. Stopped
			 * before its `save` consumer: this handler's result goes to the
			 * Review & Save screen, and the save there is the person's act.
			 */
			let result: {
				content: string
				name?: string
				raw: string
				batchCount: number
				participantCharacters?: any[]
				mentionedCharacters?: any[]
			}
			// A failure here — the model's service, a query — reaches the catch
			// that ends this run's card, in the card's own sentence.
			const { runSpec } = await import(
				"$lib/server/pipelines/runtime/runTurn"
			)
			const { SUMMARIZE_SCENE_SPEC_ID } = await import(
				"$lib/server/pipelines/specs/summarize"
			)

			let batchesSeen = 0
			const progress = (data: {
				phase: "drafting" | "synthesizing" | "naming" | "extracting"
				batch: number
				totalBatches: number
			}) => {
				activityStore.updateScene(activityId, {
					phase: data.phase,
					batch: data.batch,
					totalBatches: data.totalBatches
				})
				emitToUser("scenes:process:progress", {
					sceneId: params.sceneId,
					partial: {},
					...data
				} satisfies Sockets.Scenes.Process.Progress)
			}

			const receipt = await runSpec({
				db,
				sessionId: scene.sessionId,
				userId,
				specId: SUMMARIZE_SCENE_SPEC_ID,
				input: {
					scope: { sessionId: scene.sessionId },
					request: {
						messageIds: scene.selectedMessageIds,
						knownCast
					}
				},
				signal: abortController.signal,
				preview: { atNode: "save" },
				// The executor's inherent node events (F34) — see the same
				// mapping in sessions:summarize.
				onNode: (e) => {
					if (e.phase !== "start") return
					if (e.definitionId.startsWith("core:oracle/summarize-batch"))
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
					else if (e.definitionId.startsWith("core:oracle/name-entry"))
						progress({ phase: "naming", batch: 1, totalBatches: 1 })
					else if (e.definitionId.startsWith("core:oracle/extract-cast"))
						progress({
							phase: "extracting",
							batch: 1,
							totalBatches: 1
						})
				}
			})

			const nodeOut = (key: string) =>
				(receipt.nodes.find((n: any) => n.nodeKey === key) as any)
					?.output
			const content: string | undefined = nodeOut("synth")?.content
			const castOut = nodeOut("cast")?.cast

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

			result = {
				content,
				name: nodeOut("naming")?.name,
				raw: content,
				batchCount: receipt.nodes.filter((n: any) =>
					String(n.typeId ?? "").startsWith(
						"core:oracle/summarize-batch"
					)
				).length,
				participantCharacters: castOut?.participants,
				mentionedCharacters: castOut?.mentioned
			}

			// Cooperating abort can make the call above resolve normally (with a
			// truncated/partial result) rather than throw — see
			// runQueuedLLMCall/runGeneration. Bail out here, before any of the
			// binding-creation/DB-write work below runs against a cancelled
			// generation's partial result.
			if (abortController.signal.aborted) {
				return null as any
			}

			// Resolve the LLM's raw name output against the same knownCast built
			// above — a name that matches nothing becomes a suggested name
			// instead of an immediate new binding, so the user gets to accept or
			// reject it on the Review & Save screen before anything is created
			// (see resolveOrCreateBindingByName, called at Save time).
			const {
				participantIds,
				mentionedIds,
				suggestedParticipants,
				suggestedMentioned
			} = (() => {
				const participants = resolveCharacterRefs(
					result.participantCharacters ?? [],
					knownCast
				)
				// ⚠ ICED (plan §1/§6). `result.mentionedCharacters` is deliberately
				// not resolved: `mentioned` is derived from `message_annotations`
				// now (utils/sceneMentions.ts) and is internal — §6 ruled it is not
				// surfaced — so the Review & Save screen has nothing to write back.
				// The field is left on `result` so reviving the extraction is a
				// one-line change rather than a re-derivation.
				const suggested = reconcileSuggestedNames(
					participants.suggestedNames,
					[]
				)
				return {
					participantIds: participants.ids,
					mentionedIds: [] as number[],
					suggestedParticipants: suggested.participants,
					suggestedMentioned: suggested.mentioned
				}
			})()

			// Guarantee: whoever actually sent a message in this scene is a
			// participant, regardless of what the extraction LLM decided —
			// charIds/personaIds (every distinct sender) were already computed
			// above for building sender names.
			//
			// A sender whose card was deleted, and no member has, is left out
			// rather than given a member (null).
			const senderBindingIds = new Set<number>()
			for (const characterId of [...charIds, ...personaIds]) {
				const memberId = await resolveOrCreateBinding({
					lorebookId: scene.lorebookId,
					characterId
				})
				if (memberId != null) senderBindingIds.add(memberId)
			}

			const {
				participants: resolvedParticipants,
				mentioned: resolvedMentioned
			} = reconcileParticipantsAndMentioned(
				participantIds,
				mentionedIds,
				senderBindingIds
			)

			const pendingResult = {
				content: result.content ?? result.raw ?? "",
				name: result.name ?? scene.name ?? undefined,
				participantCharacters: resolvedParticipants,
				mentionedCharacters: resolvedMentioned,
				suggestedParticipantCharacters: suggestedParticipants,
				suggestedMentionedCharacters: suggestedMentioned,
				raw: result.raw
			}

			activityStore.updateScene(activityId, {
				status: "review",
				sceneName: pendingResult.name,
				pendingResult
			})

			const response: Sockets.Scenes.Process.Response = {
				sceneId: params.sceneId,
				activityId,
				...pendingResult
			}
			emitToUser("scenes:process:complete", response)
			return response
		} catch (err) {
			// Deliberately narrower than narrativeGraph.ts's equivalent guard
			// — do NOT add `|| isQueueCancellation(err) || err.name ===
			// "AbortError"`. activityStore.cancel() aborts our controller
			// synchronously, so signal.aborted is already true for every
			// exception that's actually our own cancel; the extra disjuncts
			// only add a way to misfire on a cancellation from somewhere else
			// and strand this activity at "running" forever.
			if (abortController.signal.aborted) {
				return null as any // already removed by activityStore.cancel() — nothing to update
			}
			if (ended) throw err
			// The card's sentence, never `err.message`: this record is served
			// back to a non-admin by `activityStore.getFor`, and an adapter
			// failure's words are the base URL and the model file; a failed
			// query's are its SQL. The modal is told the card's own sentence;
			// the log keeps the whole error, as the cause.
			const failure = activityError(err)
			activityStore.updateScene(activityId, {
				status: "error",
				...failure
			})
			throw new Error(failure.errorMessage, { cause: err })
		}
	},
	"The scene could not be summarized.",
	undefined,
	(params) => ({ sceneId: (params as { sceneId?: unknown } | undefined)?.sceneId })
)

/**
 * Delete a scene that existed only to carry a summarize run, when that run is
 * abandoned.
 *
 * Both conditions are load-bearing, and the second is the one that makes this
 * safe. `scene_summarize` activities come from two origins — a session-side
 * summarize that created its scene up front, and a lorebook-side re-process of a
 * scene the user already owns — so acting on the flag alone would delete real
 * work if the flag were ever wrong. A re-processed scene always has a summary,
 * so the emptiness predicate can never match one.
 *
 * The save path does not race it: Review & Save hands its activity id to
 * `scenes:update`, which dismisses the activity only AFTER the scene's summary
 * is written. (An `activity:dismiss` sent alongside the update would race it,
 * and a dismiss that arrived first would delete the very scene being saved.)
 */
activityStore.setEphemeralSceneCleanup(async (sceneId, userId) => {
	const scene = await db.query.scenes.findFirst({
		where: eq(schema.scenes.id, sceneId)
	})
	if (!scene) return

	// Ownership, via the owning lorebook — same check the delete handler makes.
	const lorebook = await findOwnedBook(db, userId, scene.lorebookId)
	if (!lorebook) return

	// Provably untouched: never summarised, never had its cast resolved.
	if (scene.summary !== null || scene.castResolvedAt !== null) return

	await db.delete(schema.scenes).where(eq(schema.scenes.id, sceneId))
})

export function registerSceneHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (
		socket: any,
		handler: Handler<any, any>,
		emitToUser: (event: string, data: any) => void
	) => void
) {
	register(socket, sceneListHandler, emitToUser)
	register(socket, sceneCreateHandler, emitToUser)
	register(socket, sceneUpdateHandler, emitToUser)
	register(socket, sceneDeleteHandler, emitToUser)
	register(socket, scenedMessageIdsHandler, emitToUser)
	register(socket, sceneListByLorebookHandler, emitToUser)
	register(socket, sceneCompileHandler, emitToUser)
	register(socket, sceneProcessHandler, emitToUser)
}
