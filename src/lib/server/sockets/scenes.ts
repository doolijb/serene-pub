import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { eq, inArray, asc, and, sql } from "drizzle-orm"
import type { Handler } from "$lib/shared/events"
import { resolvePersonaName } from "$lib/shared/utils/resolveCharacterName"
import {
	HISTORY_TYPE_ID,
	historyDateOf,
	inBookOfType,
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
import { getUserConfigurations } from "$lib/server/utils/getUserConfigurations"
import {
	resolveCapabilityTarget,
	TEXT_CAPABILITY
} from "$lib/server/connections/capabilityTarget"
import { activityError, activityStore } from "$lib/server/utils/activityStore"
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

/**
 * The scene list for one session.
 *
 * Split out of the handler below so the two write cascades that re-send it
 * (`scenes:create`, `scenes:delete`) can hand it to `emitToUser` as a thunk
 * (socket-interest plan, ruling 4): ONE source of truth for the payload, and
 * the scene read plus the whole history-entry ordering scan behind it are paid
 * only when some socket declared the key. A scene written from a surface that
 * shows no scene list — the summarize modal, the lorebook side — pays for
 * neither. Skipping the emit alone would save nothing; these reads are the cost.
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
		with: {
			// The date and the completion flag are declared fields now,
			// so the row carries `fields` and the projection below reads
			// them out — see `toEntryRow`.
			historyEntry: {
				columns: { id: true, fields: true }
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
		// ⚠ The date sorts on jsonb members now, so the ordering is
		// spelled in SQL rather than by column: `->>` yields text, and
		// text order is not date order past nine. `NULLS FIRST` keeps the
		// old column ordering, which Postgres gives ascending sorts by
		// default and which this list depends on — an entry with only a
		// year sorts before its own dated months.
		const allEntries = (
			await db
				.select({
					id: schema.lorebookEntries.id,
					fields: schema.lorebookEntries.fields
				})
				.from(schema.lorebookEntries)
				.where(inBookOfType(lorebookId, HISTORY_TYPE_ID))
				.orderBy(
					sql`(${schema.lorebookEntries.fields}->>'year')::int ASC NULLS FIRST`,
					sql`(${schema.lorebookEntries.fields}->>'month')::int ASC NULLS FIRST`,
					sql`(${schema.lorebookEntries.fields}->>'day')::int ASC NULLS FIRST`,
					asc(schema.lorebookEntries.id)
				)
		).map((e) => ({ id: e.id, ...historyDateOf(e) }))
		for (let i = 0; i < allEntries.length; i++) {
			nextEntryMap.set(allEntries[i].id, allEntries[i + 1] ?? null)
		}
	}

	const sceneList = (scenes as any[]).map((s) => ({
		...s,
		historyEntry: s.historyEntry
			? {
					id: s.historyEntry.id,
					...historyDateOf(s.historyEntry),
					isCompleted: s.historyEntry.fields?.isCompleted ?? false,
					nextEntry: nextEntryMap.get(s.historyEntry.id) ?? null
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
> = {
	event: "scenes:list",
	handler: async (socket, params, emitToUser) => {
		const res = await buildSceneList(params.sessionId, socket.user!.id)
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
		const [historyEntry] = await db
			.select({ lorebookId: schema.lorebookEntries.lorebookId })
			.from(schema.lorebookEntries)
			.where(
				and(
					eq(schema.lorebookEntries.id, data.historyEntryId),
					eq(schema.lorebookEntries.typeId, HISTORY_TYPE_ID)
				)
			)
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

		return { success: "Scene deleted." }
	}
}

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
> = {
	event: "scenes:scenedMessageIds",
	handler: async (socket, params, emitToUser) => {
		const res = await buildScenedMessageIds(
			params.sessionId,
			socket.user!.id
		)
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
		if (!row || row.lorebook.userId !== userId) {
			throw new Error("History entry not found or access denied.")
		}
		// Narrowed to the dated type, which the `type_id` predicate above
		// already guaranteed: `toEntryRow` returns the union of every declared
		// shape, and reading a date off that union is exactly the mistake the
		// branded type exists to refuse.
		const historyEntry = {
			...(toEntryRow(row.entry) as LorebookEntry<typeof HISTORY_TYPE_ID>),
			lorebook: row.lorebook
		}

		// Fetch scenes for this history entry — defense-in-depth: also scope
		// to this lorebook (already known-owned, checked above), not just
		// historyEntryId, in case any other scene-creation path ever again
		// allows historyEntryId/lorebookId to drift apart the way
		// scenes:create used to.
		const scenes = await db.query.scenes.findMany({
			where: and(
				eq(schema.scenes.historyEntryId, params.historyEntryId),
				eq(schema.scenes.lorebookId, historyEntry.lorebookId)
			),
			orderBy: asc(schema.scenes.id)
		})

		if (scenes.length === 0) {
			throw new Error("No scenes found for this history entry.")
		}

		const { contextConfig, promptConfig } =
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
		if (!target.ok) throw new Error(target.problem.message)
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
			throw new Error(
				"No sampling config is set for chat, and summarizing needs one. " +
					"Choose one in Admin → Defaults."
			)
		const compileSampling = target.sampling

		const lorebook = historyEntry.lorebook
		const historyEntryDate = `Year ${historyEntry.year}${historyEntry.month ? `, Mo. ${historyEntry.month}` : ""}${historyEntry.day ? `, Day ${historyEntry.day}` : ""}`

		const abortController = new AbortController()
		const activityId = activityStore.startCompile(
			{
				userId,
				historyEntryId: params.historyEntryId,
				historyEntryDate,
				lorebookId: historyEntry.lorebookId,
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
					emitToUser("scenes:compile:progress", {
						...data,
						// Present so the interest scope can be derived: the
						// compile is asked for one history entry, and only
						// the view watching that entry should be told how
						// far it has got. `:complete` already carried it.
						historyEntryId: params.historyEntryId
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
			// failure's words are the base URL and the model file.
			activityStore.updateCompile(activityId, {
				status: "error",
				...activityError(err)
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
			// See the note on the identical write in the compile handler above.
			activityStore.updateScene(activityId, {
				status: "error",
				...activityError(err)
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
					characterId: personaId
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
