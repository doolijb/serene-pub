import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { eq, inArray, asc, and } from "drizzle-orm"
import type { Handler } from "$lib/shared/events"
import { resolvePersonaName } from "$lib/shared/utils/resolveCharacterName"
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
import { getUserConfigurations } from "$lib/server/utils/getUserConfigurations"
import { activityStore } from "$lib/server/utils/activityStore"
import { withSessionTriggerLock } from "$lib/server/utils/sessionTriggerLock"
import { checkSessionAccess } from "$lib/server/utils/sessionAccess"
import { resolveOrCreateBinding } from "$lib/server/utils/characterBindingSync"

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

export const sceneListHandler: Handler<
	Sockets.Scenes.List.Params,
	Sockets.Scenes.List.Response
> = {
	event: "scenes:list",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id

		// Read access: any session participant (owner or guest) can view scenes —
		// this fires on every session page load, so an owner-only check here
		// locks guests out of the session entirely, not just scene management.
		const sessionAccess = await checkSessionAccess(params.sessionId, userId)
		if (!sessionAccess.hasAccess) {
			throw new Error("Session not found or access denied.")
		}

		const scenes = await db.query.scenes.findMany({
			where: eq(schema.scenes.sessionId, params.sessionId),
			orderBy: (s, { asc }) => asc(s.id),
			with: {
				historyEntry: {
					columns: {
						id: true,
						year: true,
						month: true,
						day: true,
						isCompleted: true
					}
				}
			}
		})

		// Build nextEntry for each history entry (ordered by year, month, day, then id)
		const lorebookId = scenes[0]?.lorebookId
		let nextEntryMap = new Map<
			number,
			{
				id: number
				year: number
				month: number | null
				day: number | null
			} | null
		>()
		if (lorebookId) {
			const allEntries = await db.query.historyEntries.findMany({
				where: eq(schema.historyEntries.lorebookId, lorebookId),
				columns: { id: true, year: true, month: true, day: true },
				orderBy: [
					asc(schema.historyEntries.year),
					asc(schema.historyEntries.month),
					asc(schema.historyEntries.day),
					asc(schema.historyEntries.id)
				]
			})
			for (let i = 0; i < allEntries.length; i++) {
				nextEntryMap.set(allEntries[i].id, allEntries[i + 1] ?? null)
			}
		}

		const sceneList = (scenes as any[]).map((s) => ({
			...s,
			historyEntry: s.historyEntry
				? {
						...s.historyEntry,
						nextEntry: nextEntryMap.get(s.historyEntry.id) ?? null
					}
				: null
		}))

		const res = {
			sceneList:
				sceneList as unknown as Sockets.Scenes.List.SceneWithEntry[]
		}
		emitToUser("scenes:list", res)
		return res
	}
}

export const sceneCreateHandler: Handler<
	Sockets.Scenes.Create.Params,
	Sockets.Scenes.Create.Response
> = {
	event: "scenes:create",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		// Cast rides alongside the row fields on the wire but is stored in
		// scene_characters, so the type is the row type plus that pair.
		const data: InsertScene & Partial<Sockets.Scenes.SceneCast> = {
			...params.scene
		}

		// Verify lorebook ownership
		const lorebook = await db.query.lorebooks.findFirst({
			where: (l, { and, eq }) =>
				and(eq(l.id, data.lorebookId), eq(l.userId, userId))
		})

		if (!lorebook) {
			throw new Error("Lorebook not found or access denied.")
		}

		// If sessionId provided, verify session ownership
		if (data.sessionId) {
			const session = await db.query.sessions.findFirst({
				where: (c, { and, eq }) =>
					and(eq(c.id, data.sessionId!), eq(c.userId, userId))
			})
			if (!session) {
				throw new Error("Session not found or access denied.")
			}
		}

		// Without this, a scene could be created with an attacker's own
		// lorebookId/sessionId but a guessed historyEntryId from a victim's
		// private lorebook — sceneCompileHandler queries scenes by
		// historyEntryId alone, so the injected scene's content would feed
		// directly into the victim's own LLM-driven compile call the next
		// time they compile that history entry.
		const historyEntry = await db.query.historyEntries.findFirst({
			where: (h, { eq }) => eq(h.id, data.historyEntryId)
		})
		if (!historyEntry || historyEntry.lorebookId !== data.lorebookId) {
			throw new Error(
				"History entry not found or does not belong to this lorebook."
			)
		}

		// Cast lives in scene_characters now, so split it off the row payload.
		const {
			participantCharacters: rawParticipants,
			mentionedCharacters: rawMentioned,
			...sceneRow
		} = data
		const carriesCast =
			rawParticipants !== undefined || rawMentioned !== undefined
		const participantCharacters = await filterCharacterIdsToLorebook(
			sceneRow.lorebookId,
			rawParticipants ?? []
		)
		const mentionedCharacters = await filterCharacterIdsToLorebook(
			sceneRow.lorebookId,
			rawMentioned ?? []
		)

		// Mark the cast resolved ONLY when this insert actually carries cast —
		// deliberately not unconditional. scenes:create can carry a summary
		// without cast (SummarizeLoreModal emits both together, but nothing
		// requires it), and marking such a row resolved would let a
		// summarized-but-never-resolved scene claim it needs no extraction —
		// silently re-enacting the bug that column exists to end.
		if (sceneRow.castResolvedAt == null && carriesCast) {
			sceneRow.castResolvedAt = new Date()
		}

		const [newScene] = await db
			.insert(schema.scenes)
			.values(sceneRow)
			.returning()

		if (carriesCast) {
			await writeSceneCast(newScene.id, {
				participantCharacters,
				mentionedCharacters
			})
		}

		// Refresh scene list for the session
		if (emitToUser && newScene.sessionId) {
			await sceneListHandler.handler(
				socket,
				{ sessionId: newScene.sessionId },
				emitToUser
			)

			// Also refresh scened message IDs
			const scenedRes = await scenedMessageIdsHandler.handler(
				socket,
				{ sessionId: newScene.sessionId },
				emitToUser
			)
			emitToUser("scenes:scenedMessageIds", scenedRes)
		}

		const res = {
			scene: {
				...newScene,
				participantCharacters,
				mentionedCharacters
			}
		}
		emitToUser("scenes:create", res)
		return res
	}
}

export const sceneUpdateHandler: Handler<
	Sockets.Scenes.Update.Params,
	Sockets.Scenes.Update.Response
> = {
	event: "scenes:update",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id

		const existing = await db.query.scenes.findFirst({
			where: eq(schema.scenes.id, params.scene.id)
		})

		if (!existing) throw new Error("Scene not found.")

		const lorebook = await db.query.lorebooks.findFirst({
			where: (l, { and, eq }) =>
				and(eq(l.id, existing.lorebookId), eq(l.userId, userId))
		})

		if (!lorebook) {
			throw new Error("Scene not found or access denied.")
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

		await db
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
			await writeSceneCast(params.scene.id, {
				participantCharacters,
				mentionedCharacters
			})
		}

		const [updated] = await db
			.select()
			.from(schema.scenes)
			.where(eq(schema.scenes.id, params.scene.id))

		// Refresh scene list
		if (emitToUser && updated.sessionId) {
			await sceneListHandler.handler(
				socket,
				{ sessionId: updated.sessionId },
				emitToUser
			)
		}

		const res = {
			scene: { ...updated, ...(await readSceneCast(params.scene.id)) }
		}
		emitToUser("scenes:update", res)
		return res
	}
}

export const sceneDeleteHandler: Handler<
	Sockets.Scenes.Delete.Params,
	Sockets.Scenes.Delete.Response
> = {
	event: "scenes:delete",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id

		const existing = await db.query.scenes.findFirst({
			where: eq(schema.scenes.id, params.id)
		})

		if (!existing) throw new Error("Scene not found.")

		const lorebook = await db.query.lorebooks.findFirst({
			where: (l, { and, eq }) =>
				and(eq(l.id, existing.lorebookId), eq(l.userId, userId))
		})

		if (!lorebook) {
			throw new Error("Scene not found or access denied.")
		}

		const sessionId = existing.sessionId

		await db.delete(schema.scenes).where(eq(schema.scenes.id, params.id))

		// Refresh scene list and scened message IDs
		if (emitToUser && sessionId) {
			await sceneListHandler.handler(socket, { sessionId }, emitToUser)

			const scenedRes = await scenedMessageIdsHandler.handler(
				socket,
				{ sessionId },
				emitToUser
			)
			emitToUser("scenes:scenedMessageIds", scenedRes)
		}

		return { success: "Scene deleted." }
	}
}

export const scenedMessageIdsHandler: Handler<
	Sockets.Scenes.SenedMessageIds.Params,
	Sockets.Scenes.SenedMessageIds.Response
> = {
	event: "scenes:scenedMessageIds",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id

		// Read access: any session participant (owner or guest) — see sceneListHandler.
		const sessionAccess = await checkSessionAccess(params.sessionId, userId)
		if (!sessionAccess.hasAccess) {
			throw new Error("Session not found or access denied.")
		}

		const scenes = await db.query.scenes.findMany({
			where: eq(schema.scenes.sessionId, params.sessionId),
			columns: { selectedMessageIds: true }
		})

		const scenedMessageIds = scenes.flatMap(
			(s) => s.selectedMessageIds ?? []
		)

		const res = { scenedMessageIds }
		emitToUser("scenes:scenedMessageIds", res)
		return res
	}
}

export const sceneListByLorebookHandler: Handler<
	Sockets.Scenes.ListByLorebook.Params,
	Sockets.Scenes.ListByLorebook.Response
> = {
	event: "scenes:listByLorebook",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id

		// Verify lorebook ownership
		const lorebook = await db.query.lorebooks.findFirst({
			where: (l, { and, eq }) =>
				and(eq(l.id, params.lorebookId), eq(l.userId, userId))
		})
		if (!lorebook) throw new Error("Lorebook not found or access denied.")

		const scenes = await db.query.scenes.findMany({
			where: eq(schema.scenes.lorebookId, params.lorebookId),
			orderBy: [asc(schema.scenes.historyEntryId), asc(schema.scenes.id)]
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

		const res = { sceneList }
		emitToUser("scenes:listByLorebook", res)
		return res
	}
}

export const sceneCompileHandler: Handler<
	Sockets.Scenes.Compile.Params,
	Sockets.Scenes.Compile.Response
> = {
	event: "scenes:compile",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id

		// Verify history entry ownership via lorebook
		const historyEntry = await db.query.historyEntries.findFirst({
			where: eq(schema.historyEntries.id, params.historyEntryId),
			with: { lorebook: true }
		})
		if (
			!historyEntry ||
			(historyEntry as any).lorebook?.userId !== userId
		) {
			throw new Error("History entry not found or access denied.")
		}

		// Fetch scenes for this history entry — defense-in-depth: also scope
		// to this lorebook (already known-owned, checked above), not just
		// historyEntryId, in case any other scene-creation path ever again
		// allows historyEntryId/lorebookId to drift apart the way
		// scenes:create used to.
		const scenes = await db.query.scenes.findMany({
			where: and(
				eq(schema.scenes.historyEntryId, params.historyEntryId),
				eq(schema.scenes.lorebookId, (historyEntry as any).lorebookId)
			),
			orderBy: asc(schema.scenes.id)
		})

		if (scenes.length === 0) {
			throw new Error("No scenes found for this history entry.")
		}

		const { connection, sampling, contextConfig, promptConfig } =
			await getUserConfigurations(userId)

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

		const compileConnection = synthCfg?.connection ?? connection
		const compileSampling = synthCfg?.sampling ?? sampling

		if (!compileConnection) {
			throw new Error(
				"No AI connection configured. Please set up a connection first."
			)
		}

		const lorebook = (historyEntry as any).lorebook
		const historyEntryDate = `Year ${historyEntry.year}${historyEntry.month ? `, Mo. ${historyEntry.month}` : ""}${historyEntry.day ? `, Day ${historyEntry.day}` : ""}`

		const abortController = new AbortController()
		const activityId = activityStore.startCompile(
			{
				userId,
				historyEntryId: params.historyEntryId,
				historyEntryDate,
				lorebookId: (historyEntry as any).lorebookId,
				lorebookLabel: lorebook.name
			},
			abortController
		)

		let result
		try {
			result = await compileScenesForEntry({
				scenes,
				connection: compileConnection,
				sampling: compileSampling,
				contextConfig,
				promptConfig,
				synthSystemPrompt: synthCfg?.prompts?.synth ?? null,
				signal: abortController.signal,
				onProgress: (data) => {
					activityStore.updateCompile(activityId, {
						phase: data.phase,
						batch: data.batch,
						totalBatches: data.totalBatches
					})
					emitToUser(
						"scenes:compile:progress",
						data satisfies Sockets.Scenes.Compile.Progress
					)
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
			activityStore.updateCompile(activityId, {
				status: "error",
				errorMessage:
					err instanceof Error ? err.message : "Unknown error"
			})
			throw err
		}

		// Cooperating abort can make the call above resolve normally (with
		// a truncated/partial result) rather than throw — see
		// runQueuedLLMCall/runGeneration. Guard here too, not just in catch.
		if (abortController.signal.aborted) {
			return null as any
		}

		// A run row for the compile — halted at the write, truthfully: the
		// result is held for review and the save is the person's act.
		{
			const { saveReceipt } = await import(
				"$lib/server/pipelines/runtime/receipts"
			)
			const { v4: uuidv4 } = await import("uuid")
			const now = Date.now()
			await saveReceipt(
				db as any,
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
		}

		activityStore.updateCompile(activityId, {
			status: "review",
			pendingResult: { content: result.content ?? result.raw }
		})

		const response: Sockets.Scenes.Compile.Response = {
			content: result.content ?? result.raw,
			historyEntryId: params.historyEntryId,
			activityId
		}
		emitToUser("scenes:compile:complete", response)
		return response
	}
}

export const sceneProcessHandler: Handler<
	Sockets.Scenes.Process.Params,
	Sockets.Scenes.Process.Response
> = {
	event: "scenes:process",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id

		const scene = await db.query.scenes.findFirst({
			where: eq(schema.scenes.id, params.sceneId)
		})
		if (!scene) throw new Error("Scene not found.")

		const lorebook = await db.query.lorebooks.findFirst({
			where: (l, { and, eq }) =>
				and(eq(l.id, scene.lorebookId), eq(l.userId, userId))
		})
		if (!lorebook) throw new Error("Scene not found or access denied.")

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

		/** Terminalise the activity alongside the error event. */
		const failRun = (error: string) => {
			activityStore.updateScene(activityId, {
				status: "error",
				errorMessage: error
			})
			emitToUser("scenes:process:error", {
				sceneId: params.sceneId,
				error
			} satisfies Sockets.Scenes.Process.ErrorResponse)
			return null as any
		}

		if (!scene.sessionId || !scene.selectedMessageIds?.length) {
			return failRun("Scene has no linked messages to process.")
		}

		// Snapshot inside the lock, LLM outside it.
		//
		// This is the only sessionMessages read in the whole path and it is pinned
		// to selectedMessageIds — no surrounding window, no "all" fallback — and
		// generateSummary touches no DB at all. So the lock only has to cover
		// the read, closing the TOCTOU against a concurrent delete or
		// generation. Holding it across the run would instead queue the user's
		// next message behind minutes of LLM calls, which is precisely the trap
		// a minimize-first flow must not set.
		const rawMessages = await withSessionTriggerLock(
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
		try {
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
					if (e.typeId.startsWith("core:provider/summarize-batch"))
						progress({
							phase: "drafting",
							batch: ++batchesSeen,
							totalBatches: batchesSeen
						})
					else if (
						e.typeId.startsWith("core:provider/summarize-synth")
					)
						progress({
							phase: "synthesizing",
							batch: 1,
							totalBatches: 1
						})
					else if (e.typeId.startsWith("core:provider/name-entry"))
						progress({ phase: "naming", batch: 1, totalBatches: 1 })
					else if (e.typeId.startsWith("core:provider/extract-cast"))
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
						"core:provider/summarize-batch"
					)
				).length,
				participantCharacters: castOut?.participants,
				mentionedCharacters: castOut?.mentioned
			}
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
			activityStore.updateScene(activityId, {
				status: "error",
				errorMessage:
					err instanceof Error ? err.message : "Unknown error"
			})
			throw err
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
			const mentioned = resolveCharacterRefs(
				result.mentionedCharacters ?? [],
				knownCast
			)
			const suggested = reconcileSuggestedNames(
				participants.suggestedNames,
				mentioned.suggestedNames
			)
			return {
				participantIds: participants.ids,
				mentionedIds: mentioned.ids,
				suggestedParticipants: suggested.participants,
				suggestedMentioned: suggested.mentioned
			}
		})()

		// Guarantee: whoever actually sent a message in this scene is a
		// participant, regardless of what the extraction LLM decided —
		// charIds/personaIds (every distinct sender) were already computed
		// above for building sender names.
		const senderBindingIds = new Set<number>()
		for (const characterId of charIds) {
			senderBindingIds.add(
				await resolveOrCreateBinding({
					lorebookId: scene.lorebookId,
					characterId
				})
			)
		}
		for (const personaId of personaIds) {
			senderBindingIds.add(
				await resolveOrCreateBinding({
					lorebookId: scene.lorebookId,
					personaId
				})
			)
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
	}
}

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
 * It also protects the save path for free: once a result is applied, `summary`
 * is set, so a later dismiss of the same activity cannot delete the scene.
 */
activityStore.setEphemeralSceneCleanup(async (sceneId, userId) => {
	const scene = await db.query.scenes.findFirst({
		where: eq(schema.scenes.id, sceneId)
	})
	if (!scene) return

	// Ownership, via the owning lorebook — same check the delete handler makes.
	const lorebook = await db.query.lorebooks.findFirst({
		where: (l, { and, eq }) =>
			and(eq(l.id, scene.lorebookId), eq(l.userId, userId))
	})
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
