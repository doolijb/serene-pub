/**
 * Building the graph from a book's scenes: `narrativeGraph:build` and the
 * build itself (`buildGraph`), with the resume checkpoints and the scopes
 * they were read under (`buildResumeStates`, `buildResumeScopes`).
 */

import { db } from "$lib/server/db"
import { primerRowEditProblem } from "$lib/server/plugins/providedMarks"
import * as schema from "$lib/server/db/schema"
import {
	eq,
	asc,
	and,
	or,
	isNotNull,
	isNull,
	ne,
	sql,
	inArray
} from "drizzle-orm"
import type { Handler } from "$lib/shared/events"
import { memberShownName } from "$lib/shared/lorebooks/memberIdentity"
import { cardsAsSeatsRead } from "$lib/server/pipelines/prompt/seatCards"
import { historyDateOf } from "$lib/server/utils/lorebookEntries"
import { castEdgeOnly, isCastEdge } from "$lib/server/utils/narrativeEdges"
import {
	buildGraphFromScenes,
	GraphParseError,
	type GraphBuilderScene,
	type GraphBuilderSeedNode,
	type GraphBuilderSeedRelationship,
	type GraphBuilderResumeState
} from "$lib/server/utils/graphBuilder"
import {
	resolveCapabilityTarget,
	TEXT_CAPABILITY
} from "$lib/server/connections/capabilityTarget"
import { activityError, activityStore } from "$lib/server/utils/activityStore"
import { collectAliases } from "$lib/server/utils/summarizer/availableSceneCast"
import { castFor, readSceneCasts } from "$lib/server/utils/sceneCast"
import {
	deriveSceneMentions,
	mentionedSoFar,
	type SceneMentions
} from "$lib/server/utils/sceneMentions"
import { refusable } from "$lib/server/sockets/refusable"
import { MAIN_LINE, type Line } from "$lib/shared/lorebooks/lineReading"
import { nearestTieVersions } from "$lib/shared/lorebooks/tieVersions"
import {
	buildReadsScene,
	type GraphBuildScope
} from "$lib/shared/lorebooks/graphBuildScope"
import {
	BranchRefusal,
	lineOfBook,
	rowsOnReading
} from "$lib/server/state/reading"
import { memberColumnsOfVersion } from "$lib/server/lorebooks/retold"
import { ensureCardVersion } from "$lib/server/characters/versions"
import { onLineSql } from "$lib/server/state/lineSql"
import { bookLoreWriteMode } from "$lib/server/state/loreWriteMode"
import { LORE_WRITES_OFF } from "$lib/shared/lorebooks/loreWriteMode"
import { assertOwnedBook } from "$lib/server/utils/ownedBook"
import {
	directEntryOf,
	storyStatesOf,
	worldLoreOf,
	shownNameOfBook
} from "./narrativeGraph.shared"

// Resume states saved before each scene — keyed by "userId:lorebookId"
const buildResumeStates = new Map<string, GraphBuilderResumeState>()

/**
 * What a build read — its line, and the session an Extend from a session was
 * scoped to — by the same key as its checkpoint. A resume's scene index counts
 * into the list the build FIRST read, so a resume must re-read that same list:
 * a scoped build resumed unscoped would skip into another session's scenes,
 * and one resumed on another line into that line's.
 */
const buildResumeScopes = new Map<string, GraphBuildScope>()

// ─── Build (LLM extraction) ───────────────────────────────────────────────────

/**
 * Build a lorebook's graph from its scenes and history, as a proposal for
 * review.
 *
 * Refused before the build begins, in the handler's own sentence and to the
 * tab that asked, echoing the book (`buildGraph`'s first lines). Once the
 * build's activity exists, every failure is that activity's
 * `status: "error"` — what GraphBuildModal and the Activity panel read — and
 * never a refusal as well: nothing is left building, and nothing is said
 * twice.
 */
export const narrativeGraphBuildHandler: Handler<
	Sockets.NarrativeGraph.Build.Params,
	Sockets.NarrativeGraph.Build.Response
> = refusable(
	"narrativeGraph:build",
	async (socket, params: Sockets.NarrativeGraph.Build.Params, emitToUser) => {
		const started: { activityId?: string } = {}
		try {
			return await buildGraph(socket, params, emitToUser, started)
		} catch (err) {
			if (started.activityId === undefined) throw err
			console.error("narrativeGraph:build failed after it began:", err)
			// `activityError` rather than `err.message`: the record is served
			// back to a non-admin, and a service's words can name its address.
			activityStore.update(started.activityId, {
				status: "error",
				...activityError(err)
			})
			return {
				proposal: { nodes: [], relationships: [] },
				sceneLabels: [],
				seedTempIdMap: {}
			}
		}
	},
	"The graph could not be built.",
	undefined,
	(params) => ({
		lorebookId: (params as { lorebookId?: unknown } | null)?.lorebookId
	})
)

/**
 * The build itself. `started.activityId` is set the moment the build's
 * activity exists, which is where a throw stops being a refusal.
 */
async function buildGraph(
	socket: any,
	params: Sockets.NarrativeGraph.Build.Params,
	emitToUser: (event: string, data: any) => void,
	started: { activityId?: string }
): Promise<Sockets.NarrativeGraph.Build.Response> {
	const userId = socket.user!.id

	// Refused before the build begins — a book that is not the caller's, a
	// step with nothing set to run it: the refusal is `refusable`'s, in
	// the handler's own sentence, echoing the book. GraphBuildModal flips
	// to "building" before the server has accepted anything and un-sticks
	// on it; Layout toasts the sentence. No activity exists yet, so none
	// is left building. After `activityStore.start`, a failure is the
	// activity's `status: "error"` instead (`narrativeGraphBuildHandler`).
	const lorebook = await assertOwnedBook(db, userId, params.lorebookId)
	const primerProblem = await primerRowEditProblem(db, params.lorebookId)
	if (primerProblem) throw new Error(primerProblem)

	// A graph build turns what sessions played into the book: the owner's
	// lore write mode Off refuses it before any work (plan A22).
	if ((await bookLoreWriteMode(db, params.lorebookId)) === "off")
		throw new Error(LORE_WRITES_OFF)

	const mode = params.mode ?? "replace"
	// A Rebuild wipes the cast ties of every line and re-creates them from
	// main (owner question: a branch Rebuild is not ruled), so it is never
	// run on a branch in the person's name.
	if (mode !== "extend" && params.branchId != null)
		throw new Error(
			"Rebuild reads and writes main only. Open main to rebuild the graph."
		)
	const resumeKey = `${userId}:${params.lorebookId}`
	const resumeState: GraphBuilderResumeState | undefined = params.resume
		? buildResumeStates.get(resumeKey)
		: undefined
	const resumedScope: GraphBuildScope | undefined =
		params.resume && mode === "extend"
			? buildResumeScopes.get(resumeKey)
			: undefined
	// Extend from one session reads that session alone. Replace
	// re-reads main by definition, so it takes no scope.
	const scopeSessionId: number | null =
		mode !== "extend"
			? null
			: resumedScope
				? resumedScope.sessionId
				: (params.sessionId ?? null)

	/*
	 * Graph extraction is a structured-output task and should not inherit
	 * session's decoding parameters — at session temperature a roleplay-finetuned
	 * model answered 45% of perspective calls with narrative prose rather
	 * than JSON, and re-prompting recovered 1 of 13. Each step therefore
	 * carries its own connection, sampling and prompt.
	 */
	// Every step resolves through the **pipeline config layer** — the same
	// world, the same five-layer chain, the same rows the pipeline panel
	// edits — so a connection, sampling profile or prompt chosen for a graph
	// step in the panel is what the next build runs on. 0.5's
	// `graph_build_configs` prose seeded the pipeline's shipped prompts.
	const { resolveGraphStepConfigs } = await import(
		"$lib/server/pipelines/config/graphSteps"
	)
	const pipelineSteps = await resolveGraphStepConfigs(db)

	// A step whose connection or sampling was never chosen runs on the
	// instance default — dispatchStep's rule, and what a person expects the
	// first time they press Build.
	//
	// This IS a real tier here, not a fourth one: graph node keys are
	// `building.item.*`, which `buildWorld`'s defaults layer (keyed to the
	// spec's single provider node) does not reach, so an unconfigured graph
	// step genuinely arrives with nothing set. What changed is only where
	// the value comes from — `connection_defaults` keyed by capability,
	// rather than the two `system_settings` columns this read before (0181).
	//
	// Resolved once for the whole build rather than per step: five steps
	// asking the same question five times is five chances for them to
	// disagree, and the answer cannot change mid-build.
	const pubDefault = await resolveCapabilityTarget(db, {
		capability: TEXT_CAPABILITY
	})
	const defaultConnection = pubDefault.ok
		? pubDefault.connection
		: undefined
	const defaultSampling = pubDefault.ok
		? (pubDefault.sampling ?? undefined)
		: undefined

	const graphSteps = Object.fromEntries(
		Object.entries(pipelineSteps).map(([step, cfg]) => [
			step,
			{
				systemPrompt: cfg.systemPrompt,
				connection: cfg.connection ?? defaultConnection,
				sampling: cfg.sampling ?? defaultSampling
			}
		])
	) as Record<
		string,
		{
			systemPrompt?: string
			connection?: any
			// The sampling ROW, not a resolved parameter set (0171):
			// buildGraphFromScenes labels each queued call with the config's
			// name and resolves the values itself where it builds an
			// adapter. Typed rather than `any` so handing it the wrong one
			// of the two is a compile error here.
			sampling?: SelectSamplingConfig
		}
	>

	// The perspective step still supplies the build-wide fallback, since it
	// is the pass that dominates a build and the one whose failure modes the
	// extraction profile was measured against.
	//
	// The `?? connection` / `?? sampling` that used to close these two came
	// from `getUserConfigurations`, which was a second reading of the same
	// instance default the step already fell back to two dozen lines up — a
	// fourth tier that could only ever agree with the third, until the day
	// one of them was repointed.
	const graphConnection = graphSteps.perspective.connection
	const graphSampling = graphSteps.perspective.sampling

	if (!graphConnection) {
		// The resolver's sentence names which way it failed and which screen
		// fixes it. Reachable only when the perspective step chose nothing
		// AND no `text->text` default is registered, which under the
		// no-implicit-pickup ruling is a real state a fresh install is in.
		throw new Error(
			(!pubDefault.ok && pubDefault.problem.message) ||
				"No AI connection configured. Please set up a connection first."
		)
	}
	// ⚠ Same asymmetry as `scenes.ts`: a missing sampling config is not fatal
	// to the chain (`resolveSampling(null)` is "use the backend's own
	// defaults") but IS fatal to `buildGraphFromScenes`, which takes a row
	// and reads `sampling.name` off it to label each queued call. Refused
	// here, where the sentence can name a screen, rather than reaching the
	// builder as a null.
	if (!graphSampling) {
		throw new Error(
			"The Reply loadout has no sampling config, and building the graph needs one. " +
				"Choose one in Admin › Models › Loadouts."
		)
	}

	/**
	 * The line this build reads and its apply writes (plan A3 and its
	 * review): Extend from a session, the session's line; Extend graph, the
	 * line the Graph lens is reading; Rebuild, main. The build reads that
	 * line's OWN scenes and direct history entries (`graphBuildScope.ts`) —
	 * an ancestor's are the ancestor's build's, and reach the line as ties —
	 * and seeds from every tie the line reads, its ancestors' up to each fork.
	 */
	let buildBranchId: number | null = null
	if (resumedScope) buildBranchId = resumedScope.branchId
	else if (scopeSessionId !== null) {
		const session = await db.query.sessions.findFirst({
			where: eq(schema.sessions.id, scopeSessionId),
			columns: { lorebookId: true, lorebookBranchId: true }
		})
		// A session on its own notes (no attached book) may extend its own
		// book's graph; its line is a line of that book (★bk-fold-1).
		let readsIt = !!session && session.lorebookId === params.lorebookId
		if (session && session.lorebookId == null) {
			const { ownBookOf } = await import("$lib/server/lorebooks/ownBook")
			readsIt = (await ownBookOf(db, scopeSessionId))?.id === params.lorebookId
		}
		if (!session || !readsIt)
			throw new Error(
				"That session does not read this lorebook, so the graph cannot be extended from it."
			)
		buildBranchId = session.lorebookBranchId ?? null
	} else if (mode === "extend") buildBranchId = params.branchId ?? null
	let line: Line
	try {
		line = await lineOfBook(db, params.lorebookId, buildBranchId)
	} catch (e) {
		if (!(e instanceof BranchRefusal)) throw e
		// A session whose branch is no longer the book's reads main, as its
		// own turns do (`sessionReadingOf`). A line the person named, or the
		// one a resumed build read, has nothing left to read.
		if (scopeSessionId === null || resumedScope)
			throw new Error(
				"That is not a line of this lorebook, so the graph cannot be extended on it."
			)
		buildBranchId = null
		line = MAIN_LINE
	}
	const scope: GraphBuildScope = {
		branchId: buildBranchId,
		sessionId: scopeSessionId
	}

	buildResumeScopes.set(resumeKey, scope)
	const activityId = activityStore.start({
		userId,
		lorebookId: params.lorebookId,
		lorebookLabel: await shownNameOfBook(lorebook),
		mode,
		branchId: buildBranchId
	})
	started.activityId = activityId
	const abortController = new AbortController()
	activityStore.setAbortController(activityId, abortController)

	// The line's own scenes and direct history entries (plan A3 review).
	// Neither is cut by a date: a line is never cut off from its own rows.
	const [rawScenes, rawDirectEntries] = await Promise.all([
		db.query.scenes.findMany({
			where: and(
				eq(schema.scenes.lorebookId, params.lorebookId),
				buildBranchId === null
					? isNull(schema.scenes.branchId)
					: eq(schema.scenes.branchId, buildBranchId)
			),
			orderBy: asc(schema.scenes.id),
			with: {
				// The date is a declared field now, so the row carries
				// `fields` and `historyDateOf` reads it out.
				historyEntry: {
					columns: { id: true, fields: true }
				}
			}
		}),
		// History entries with content and no scene of the line's own
		db
			.select({
				id: schema.lorebookEntries.id,
				fields: schema.lorebookEntries.fields,
				content: schema.lorebookEntries.content
			})
			.from(schema.lorebookEntries)
			.where(directEntryOf(params.lorebookId, buildBranchId))
	])

	// Fetch bindings with left joins (explicit joins have reliable TS inference).
	// A deleted card is nobody in a lorebook (plan A25): its member is named by
	// their own name, as a member without a card is.
	const bindingRows = await db
		.select({
			id: schema.lorebookBindings.id,
			binding: schema.lorebookBindings.binding,
			memberName: schema.lorebookBindings.name,
			characterName: schema.characters.name,
			characterNickname: schema.characters.nickname
		})
		.from(schema.lorebookBindings)
		.leftJoin(
			schema.characters,
			and(
				eq(schema.lorebookBindings.characterId, schema.characters.id),
				eq(schema.characters.isDeleted, false)
			)
		)
		.where(eq(schema.lorebookBindings.lorebookId, params.lorebookId))

	// A member's own names are its cast version's in force at the build's line
	// head; a member with no version (an error) has none.
	const bindingVersions = await storyStatesOf(db, bindingRows, {
		branchId: buildBranchId,
		moment: null,
		forkedAt: null,
		line
	})
	const bindings = bindingRows.map((b) => {
		const version = bindingVersions.get(b.id)?.version
		if (!version) return { ...b, ownName: null, ownNickname: null }
		const { ownName, ownNickname } = memberColumnsOfVersion(version, {
			carded: version.parentVersionId != null
		})
		return { ...b, ownName, ownNickname }
	})

	// Build substitution map: binding token → display name
	const bindingMap: Record<string, string> = {}
	for (const b of bindings) {
		if (!b.binding) continue
		const label = b.characterName
			? memberShownName(
					{ ownName: b.ownName, ownNickname: b.ownNickname },
					{ name: b.characterName, nickname: b.characterNickname }
				)
			: b.memberName?.trim() || b.binding
		bindingMap[b.binding] = label
	}

	function resolveBindings(text: string): string {
		let out = text
		for (const [token, name] of Object.entries(bindingMap)) {
			out = out.replaceAll(token, name)
		}
		return out
	}

	// In extend mode, only process scenes not yet graphed — and, when the
	// extend was started from a session, only that session's.
	const filteredRawScenes =
		mode === "extend"
			? rawScenes.filter((s) => !s.graphed && buildReadsScene(s, scope))
			: rawScenes

	// In extend mode, only process direct entries not yet graphed. A
	// direct entry has no scene and so no session: a session-scoped
	// extend reads none of them.
	const filteredDirectEntries =
		mode === "extend"
			? scopeSessionId !== null
				? []
				: rawDirectEntries.filter((e) => !e.fields?.graphed)
			: rawDirectEntries

	if (
		mode === "extend" &&
		filteredRawScenes.length === 0 &&
		filteredDirectEntries.length === 0
	) {
		// A session's scenes played on another line are that line's build's
		// to read (`graphBuildScope.ts`): said, rather than "all graphed".
		const elsewhere =
			scopeSessionId === null
				? 0
				: (
						await db
							.select({ n: sql<number>`count(*)`.mapWith(Number) })
							.from(schema.scenes)
							.where(
								and(
									eq(schema.scenes.lorebookId, params.lorebookId),
									eq(schema.scenes.sessionId, scopeSessionId),
									eq(schema.scenes.graphed, false),
									isNotNull(schema.scenes.summary),
									buildBranchId === null
										? isNotNull(schema.scenes.branchId)
										: or(
												isNull(schema.scenes.branchId),
												ne(schema.scenes.branchId, buildBranchId)
											)
								)
							)
					)[0].n
		activityStore.update(activityId, {
			status: "error",
			errorMessage:
				elsewhere > 0
					? `No new content to process on this session's line. ${elsewhere} of this session's scenes ${elsewhere === 1 ? "was" : "were"} played on another line: read that line in the lorebook's Graph lens and use Extend graph there.`
					: scopeSessionId !== null
						? "No new content to process. Every summarized scene in this session has already been graphed."
						: "No new content to process. All scenes and history entries have already been graphed."
		})
		return {
			proposal: { nodes: [], relationships: [] },
			sceneLabels: [],
			seedTempIdMap: {}
		}
	}

	// Direct history entries used to get their own extraction+resolution
	// pass right here, because graphBuilder's Phase 1 was a plain id lookup
	// that would otherwise extract nobody from a scene-less lorebook. That
	// block is gone: Phase 1 now applies one uniform rule (ids → lookup,
	// names → resolve, nothing → extract) to scenes and entries alike, so
	// entries just flow through the mapping below with no cast of their own
	// and get extracted from their content like any other castless item.
	//
	// Deleting it also removes the last DB write in the build path. It
	// called a name resolver (since deleted) that *created* a binding
	// row per unmatched name, mid-build, in its own committed transaction —
	// so cancelling or discarding a build still left new characters behind.
	// Its own doc (availableSceneCast.ts) scoped it to "callers
	// with no review step downstream"; a graph build has one, so this was
	// misuse by its own contract. The build now proposes; apply commits.

	// Cast has to be read explicitly: migration 0091 moved it off the scenes
	// row into the `scene_characters` join table, so a scene row carries no
	// cast fields at all. Reading it as `s.participantCharacters` — which is
	// what this did, behind an `(s: any)` that hid it from the compiler —
	// silently yielded undefined for every scene, so the build ignored every
	// saved cast, re-derived it by LLM, and overwrote the user's on apply.
	// The annotation is gone so the next column change is a type error.
	const sceneCasts = await readSceneCasts(
		filteredRawScenes.map((s) => s.id)
	)

	/**
	 * The other half of the cast, DERIVED rather than read (plan §1).
	 *
	 * `mentioned` is exactly *(scene text × vocabulary)*, and
	 * `message_annotations` already holds that more precisely than a scene
	 * row ever did. Deriving it here is what makes a widened vocabulary
	 * reach every historical scene at once, and what lets an absorb stop
	 * remapping mentioned ids by hand — the annotations resolve through a
	 * gazetteer that already reflects the merge.
	 *
	 * ⚠ Annotation is a background lane, so a scene can legitimately answer
	 * "not yet" instead of "nobody". That is reported rather than flattened:
	 * an incomplete list silently presented as complete is the one outcome
	 * worse than a stale one. The build still runs on what is known — the
	 * proposal is reviewed by a person before anything is written — but the
	 * log names how many scenes were answered short.
	 */
	const sceneMentions = await deriveSceneMentions(
		db,
		params.lorebookId,
		filteredRawScenes.map((s) => ({
			id: s.id,
			selectedMessageIds: s.selectedMessageIds ?? null
		}))
	)
	const pendingMentionScenes = [...sceneMentions.values()].filter(
		(m) => m.status === "pending"
	).length
	if (pendingMentionScenes > 0) {
		console.warn(
			`[narrativeGraph] ${pendingMentionScenes} of ${filteredRawScenes.length} scene(s) in lorebook ${params.lorebookId} ` +
				`are not fully annotated yet; their mentioned cast is a floor, not an answer. ` +
				`Re-run the build once the annotation lane has caught up to widen it.`
		)
	}

	// Map scenes to GraphBuilderScene format with binding substitution applied
	const { sceneDisplayNames } = await import("$lib/server/scenes/liveScenes")
	const shownSceneNames = await sceneDisplayNames(db, filteredRawScenes)
	// A history entry with no year (a legacy row) is read as no date at all —
	// the builder orders a scene with none last and labels it by its id.
	const datedHistoryEntry = (e: {
		id: number
		fields?: Record<string, any> | null
	}): GraphBuilderScene["historyEntry"] => {
		const { year, month, day } = historyDateOf(e)
		return year === null ? null : { id: e.id, year, month, day }
	}
	const scenes: GraphBuilderScene[] = [
		...filteredRawScenes.map((s) => {
			const cast = castFor(sceneCasts, s.id)
			const mentions: SceneMentions | undefined = sceneMentions.get(
				s.id
			)
			return {
				id: s.id,
				name: shownSceneNames.get(s.id) ?? s.name,
				summary: s.summary ? resolveBindings(s.summary) : s.summary,
				historyEntryId: s.historyEntryId ?? null,
				historyEntry: s.historyEntry
					? datedHistoryEntry(s.historyEntry)
					: null,
				participantCharacters: cast.participantCharacters,
				// Derived, never `cast.mentionedCharacters` — see above.
				// Any `mentioned` rows still in `scene_characters` are
				// pre-icing leftovers and are deliberately not read.
				mentionedCharacters: mentions
					? mentionedSoFar(mentions)
					: [],
				sessionId: s.sessionId ?? null,
				selectedMessageIds: s.selectedMessageIds?.length
					? s.selectedMessageIds
					: null
			}
		}),
		// Map direct history entries to GraphBuilderScene format
		...filteredDirectEntries.map((he) => ({
			id: he.id,
			name: null,
			summary: resolveBindings(he.content),
			historyEntryId: he.id,
			historyEntry: datedHistoryEntry(he),
			sourceHistoryEntryId: he.id,
			// No stored cast — Phase 1's extract branch derives it.
			participantCharacters: null,
			mentionedCharacters: null
		}))
	]

	// Load seed nodes and relationships for LLM context. Both modes share
	// the same seeding query now — every lorebookBindings row already is
	// the graph row, bound or not, so there's no more separate
	// "narrativeNodes for extend, bindings-joined-to-characters for
	// replace" split (see the lorebookBindings/narrativeNodes merge
	// plan). Replace mode's own redefinition — resetting rather than
	// deleting bound/referenced rows — is what makes this safe: a
	// binding's stored name/aliases/summary are always meaningful
	// current state to seed from, not stale leftovers about to be wiped.
	let seedNodes: GraphBuilderSeedNode[] | undefined
	let seedRelationships: GraphBuilderSeedRelationship[] | undefined
	{
		const allBindings = await db.query.lorebookBindings.findMany({
			where: eq(
				schema.lorebookBindings.lorebookId,
				params.lorebookId
			),
			orderBy: asc(schema.lorebookBindings.id)
		})

		// Resolve character/persona sheet data as a fallback summary
		// source for rows that have never been graphed yet (empty
		// `summary` column) — matches the original replace-mode
		// bootstrap behavior for a lorebook with no graph history.
		const characterIds = allBindings
			.map((b) => b.characterId)
			.filter((id): id is number => id != null)
		// The summary a member is seeded with is its card's: the card's
		// current version, the one source (a deleted card seeds nothing,
		// plan A25).
		const liveCardIds =
			characterIds.length > 0
				? (
						await db
							.select({ id: schema.characters.id })
							.from(schema.characters)
							.where(
								and(
									inArray(schema.characters.id, characterIds),
									eq(schema.characters.isDeleted, false)
								)
							)
					).map((c) => c.id)
				: []
		const charMap = new Map<
			number,
			{ summary: string | null; description: string | null }
		>()
		for (const id of liveCardIds) {
			const current = await ensureCardVersion(db, id)
			if (current)
				charMap.set(id, {
					summary: current.summary,
					description: current.description
				})
		}

		function fallbackSummary(b: (typeof allBindings)[number]): string {
			if (b.characterId) {
				const char = charMap.get(b.characterId)
				return (
					char?.summary?.trim() || char?.description?.trim() || ""
				)
			}
			return ""
		}

		// extend mode only processes ungraphed scenes (filtered above);
		// replace mode reprocesses everything — but the seed *set* is the
		// same either way, so the mode branch that used to live here is
		// gone.
		// Cast edges only: the builder seeds the model with characters and
		// the ties between them, and an edge with an entry end has no
		// second character to name.
		// The line's ties (plan A3): a sibling's tie is a story this line
		// never had, an ancestor's dated past the fork's cut is not in it
		// yet, and where the line tells an inherited tie its own way at the
		// same date, its own telling is the one it reads.
		const existingRelationships =
			mode === "extend"
				? nearestTieVersions(
						await rowsOnReading(
							db,
							await db.query.narrativeRelationships.findMany({
								where: and(
									eq(
										schema.narrativeRelationships.lorebookId,
										params.lorebookId
									),
									castEdgeOnly,
									onLineSql(
										schema.narrativeRelationships.branchId,
										line
									)
								),
								orderBy: asc(schema.narrativeRelationships.id)
							}),
							{
								lorebookId: params.lorebookId,
								branchId: buildBranchId,
								moment: null,
								forkedAt: null,
								line
							}
						),
						line
					)
				: []

		// Their state and visibility are the cast versions' in force at the
		// build's line head (the columns are frozen).
		const storyStates = await storyStatesOf(db, allBindings, {
			branchId: buildBranchId,
			moment: null,
			forkedAt: null,
			line
		})

		// Build alias name map: non-hidden alias-child names per parent
		const childrenByParent = new Map<number, string[]>()
		for (const b of allBindings) {
			if (
				b.parentNodeId !== null &&
				storyStates.get(b.id)!.nodeVisibility !== "hidden"
			) {
				const list = childrenByParent.get(b.parentNodeId) ?? []
				list.push(b.name)
				childrenByParent.set(b.parentNodeId, list)
			}
		}

		// Only parent (non-alias) bindings as seeds; the schema-mandated
		// alias union plus this caller's own extra, child names.
		//
		// `absorbedAliases` used to be missing here — the one violator of
		// the invariant lorebookBindings.absorbedAliases documents. That is
		// precisely the wrong place to omit it: an identity absorbed by a
		// merge was invisible to the build, so the build re-proposed the
		// duplicate the merge had just resolved, after every merge, forever.
		const seeds: GraphBuilderSeedNode[] = []
		for (const b of allBindings) {
			if (b.parentNodeId !== null) continue
			const name = b.name.trim()
			if (!name) continue
			seeds.push({
				id: b.id,
				name,
				nodeState: storyStates.get(b.id)!.nodeState,
				summary: b.summary?.trim() || fallbackSummary(b) || null,
				aliases: [
					...new Set([
						...collectAliases(b),
						...(childrenByParent.get(b.id) ?? [])
					])
				]
			})
		}
		if (seeds.length > 0) seedNodes = seeds

		seedRelationships = existingRelationships
			.filter(isCastEdge)
			.map((r) => ({
				fromNodeId: r.fromNodeId,
				toNodeId: r.toNodeId,
				relationshipType: r.relationshipType,
				visibility: r.visibility,
				status: r.status,
				description: r.description,
				reason: r.reason
			}))
	}

	// Screens newly-proposed character nodes: a station or an artefact with
	// its own World Lore page is a subject of the setting, not a member of
	// the cast, and the extraction prompt's one line saying so is routinely
	// ignored. Names that already match a bound character never reach the
	// filter — see resolveNameRefs.
	//
	// Places and items are screened with world lore: each was world lore
	// before it had its own entry type, and a place minted as a character
	// is the one way a Rebuild could put a place on the graph (places plan
	// L1 — a rebuild touches character ties only).
	const worldLore = await worldLoreOf(params.lorebookId, db)

	let latestSceneSnapshot: GraphBuilderResumeState | undefined
	// For the run receipt: which calls ran, so the pipeline page's run list
	// can say what a build cost without storing every payload twice (the
	// build log already streams them).
	let llmCallCount = 0
	const startedAt = Date.now()

	try {
		const result = await buildGraphFromScenes({
			scenes,
			connection: graphConnection,
			sampling: graphSampling,
			steps: graphSteps,
			seedNodes,
			seedRelationships,
			worldLore,
			signal: abortController.signal,
			resumeState,
			onSceneStart: (state) => {
				latestSceneSnapshot = state
			},
			onProgress: (data) => {
				activityStore.update(activityId, {
					phase: data.phase,
					sceneIndex: data.sceneIndex,
					totalScenes: data.totalScenes,
					nodesFound: data.nodesFound,
					relsFound: data.relationshipsFound,
					currentPair: data.currentPair,
					currentSceneLabel: data.currentSceneLabel
				})
			},
			onLlmCall: (entry) => {
				llmCallCount++
				emitToUser("narrativeGraph:buildLog", {
					...entry,
					// Present so the shell files the call under ITS book's
					// build (`graphBuilds.appendTrace` — one build per book),
					// never under whichever build is newest. The builder's
					// entry names only the call it made — it has no idea
					// which book started it — so the book is added here.
					// Not a scope: the event is deliberately absent from
					// `SCOPED_EVENTS`, because the shell's one listener wants
					// every book's log (plan B5).
					lorebookId: params.lorebookId
				} satisfies Sockets.NarrativeGraph.BuildLogEntry)
			},
			fetchSceneMessages: async (sessionId, messageIds) => {
				if (messageIds.length === 0) return []
				const msgs = await db.query.sessionMessages.findMany({
					where: and(
						eq(schema.sessionMessages.sessionId, sessionId),
						inArray(schema.sessionMessages.id, messageIds),
						eq(schema.sessionMessages.isHidden, false)
					),
					orderBy: asc(schema.sessionMessages.id),
					columns: {
						id: true,
						content: true,
						characterId: true,
						personaId: true,
						role: true
					}
				})
				const charIds = [
					...new Set(
						msgs
							.filter((m) => m.characterId)
							.map((m) => m.characterId!)
					)
				]
				const personaIds = [
					...new Set(
						msgs
							.filter((m) => m.personaId)
							.map((m) => m.personaId!)
					)
				]
				const [characters, personas] = await Promise.all([
					charIds.length > 0
						? db
								.select({
									id: schema.characters.id,
									name: schema.characters.name,
									nickname: schema.characters.nickname
								})
								.from(schema.characters)
								.where(
									inArray(schema.characters.id, charIds)
								)
						: Promise.resolve([]),
					personaIds.length > 0
						? db
								.select({
									id: schema.characters.id,
									name: schema.characters.name
								})
								.from(schema.characters)
								.where(
									inArray(
										schema.characters.id,
										personaIds
									)
								)
						: Promise.resolve([])
				])
				// A character is named as its seat reads it (the seated member's own name, else the card's).
				const seated = await cardsAsSeatsRead(db, sessionId, characters)
				const characterMap = new Map(
					seated.map((c) => [
						c.id,
						memberShownName(undefined, c, "assistant")
					])
				)
				const personaMap = new Map(
					personas.map((p) => [p.id, p.name])
				)
				return msgs.map((m) => ({
					senderName: m.characterId
						? (characterMap.get(m.characterId) ??
							m.role ??
							"Character")
						: m.personaId
							? (personaMap.get(m.personaId) ??
								m.role ??
								"User")
							: (m.role ?? "System"),
					content: m.content
				}))
			}
		})

		// Build completed — clear any saved checkpoint for this lorebook
		buildResumeStates.delete(resumeKey)
		buildResumeScopes.delete(resumeKey)

		// Guard: if the user cancelled while the last LLM call was still completing,
		// the abort signal may have fired after buildGraphFromScenes returned normally.
		if (abortController.signal.aborted) {
			return {
				proposal: { nodes: [], relationships: [] },
				sceneLabels: [],
				seedTempIdMap: {}
			}
		}

		// resolvedSceneCast rides inside the proposal so it survives the
		// review round-trip and is committed by the same apply the user
		// approves — a discarded proposal writes nothing, which is the
		// whole persistence contract.
		const proposal: Sockets.NarrativeGraph.GraphProposal = {
			...result.proposal,
			resolvedSceneCast: result.resolvedSceneCast
		}

		// The build is a pipeline run and gets a run row — halted at the
		// proposal, which is the truthful outcome: nothing was applied, a
		// person decides on the Review screen. Never allowed to fail the
		// build (saveReceipt swallows its own errors).
		{
			const { saveReceipt } = await import(
				"$lib/server/pipelines/runtime/receipts"
			)
			const { GRAPH_BUILD_SPEC_ID, GRAPH_BUILD_VERSION } =
				await import("$lib/server/pipelines/specs/graphBuild")
			const { v4: uuidv4 } = await import("uuid")
			const endedAt = Date.now()
			await saveReceipt(
				db,
				{
					runId: uuidv4(),
					specId: GRAPH_BUILD_SPEC_ID,
					specVersion: GRAPH_BUILD_VERSION,
					outcome: "halt",
					haltNodeKey: "propose",
					haltReason: `proposal held for review — ${result.proposal.nodes.length} nodes, ${result.proposal.relationships.length} relationships from ${result.sceneLabels.length} scenes (${llmCallCount} model calls)`,
					triggerSource: "ui",
					seed: `build:${params.lorebookId}`,
					startedAt,
					endedAt,
					nodes: []
				} as any,
				{ userId }
			)
		}
		activityStore.update(activityId, {
			status: "review",
			proposal,
			sceneLabels: result.sceneLabels,
			seedTempIdMap: result.seedTempIdMap,
			seedNodeNames: result.seedNodeNames,
			relationshipDiagnostics: result.relationshipDiagnostics,
			filteredWorldLoreNames: result.filteredWorldLoreNames,
			processedSceneIds: filteredRawScenes
				.filter((s) => s.summary != null)
				.map((s) => s.id),
			processedHistoryEntryIds: filteredDirectEntries.map((e) => e.id)
		})
		return {
			proposal,
			sceneLabels: result.sceneLabels,
			seedTempIdMap: result.seedTempIdMap
		}
	} catch (err) {
		// If the build was aborted (cancel/stop), return silently regardless of error type.
		// An LLM network failure can race with the abort signal — treat both as a clean stop.
		if (
			abortController.signal.aborted ||
			(err instanceof Error && err.name === "AbortError")
		) {
			return {
				proposal: { nodes: [], relationships: [] },
				sceneLabels: [],
				seedTempIdMap: {}
			}
		}
		if (err instanceof GraphParseError) {
			// Save the pre-scene snapshot so the user can retry from this exact scene
			if (latestSceneSnapshot)
				buildResumeStates.set(resumeKey, latestSceneSnapshot)
			// Through `activityError` like every other terminalising write
			// here, even though `GraphParseError` is a `ComposedError`
			// whose own message survives it unchanged — so that no write
			// on this path is the one that reads `err.message` directly.
			// The truncation sentence is composed here and overrides it.
			activityStore.update(activityId, {
				status: "error",
				...activityError(err),
				...(err.truncated
					? {
							errorMessage:
								"The model ran out of response tokens before finishing the graph. Increase Max Response Tokens in your sampling config and try again."
						}
					: {}),
				errorRaw: err.raw
			})
			return {
				proposal: { nodes: [], relationships: [] },
				sceneLabels: [],
				seedTempIdMap: {}
			}
		}
		// Unexpected error (network failure, DB error, etc.) — show in modal rather than a generic toast
		// `activityError` rather than `err.message`: this record is served
		// back to a non-admin by `activityStore.getFor`, and an adapter
		// failure's words are the base URL and the model file.
		activityStore.update(activityId, {
			status: "error",
			...activityError(err)
		})
		return {
			proposal: { nodes: [], relationships: [] },
			sceneLabels: [],
			seedTempIdMap: {}
		}
	}
}
