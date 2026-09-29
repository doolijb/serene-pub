import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import type {
	NodeState,
	NodeVisibility,
	RelationshipVisibility
} from "$lib/server/db/schema"
import {
	eq,
	asc,
	desc,
	and,
	or,
	isNotNull,
	isNull,
	gt,
	notExists,
	sql,
	inArray
} from "drizzle-orm"
import type { Handler } from "$lib/shared/events"
import { resolveCharacterName } from "$lib/shared/utils/resolveCharacterName"
import {
	CHARACTER_LORE_TYPE_ID,
	HISTORY_TYPE_ID,
	WORLD_LORE_TYPE_ID,
	fieldIsTrue,
	historyDateOf,
	inBookOfType,
	mergeFields
} from "$lib/server/utils/lorebookEntries"
import type { EntryTypeId } from "$lib/shared/entries/types"
import { castEdgeOnly, isCastEdge } from "$lib/server/utils/narrativeEdges"
import {
	buildGraphFromScenes,
	GraphParseError,
	type GraphBuilderScene,
	type GraphBuilderSeedNode,
	type GraphBuilderSeedRelationship,
	type GraphBuilderResumeState
} from "$lib/server/utils/graphBuilder"
import { getUserConfigurations } from "$lib/server/utils/getUserConfigurations"
import {
	resolveCapabilityTarget,
	TEXT_CAPABILITY
} from "$lib/server/connections/capabilityTarget"
import { activityError, activityStore } from "$lib/server/utils/activityStore"
import { deriveNextBindingToken } from "$lib/server/utils/lorebookBindingToken"
import { assertValidParentNode } from "$lib/server/utils/bindingParent"
import { collectAliases } from "$lib/server/utils/summarizer/availableSceneCast"
import { findDuplicateCandidates } from "$lib/server/utils/duplicateBindingDetection"
import {
	castFor,
	readSceneCasts,
	repointSceneCast,
	writeSceneCast
} from "$lib/server/utils/sceneCast"
import {
	deriveSceneMentions,
	mentionedSoFar,
	type SceneMentions
} from "$lib/server/utils/sceneMentions"
import {
	inferredRelationshipVisibility,
	sanitizeRelationshipVisibility,
	type ObjectPresence
} from "$lib/server/utils/relationshipVisibility"

// Resume states saved before each scene — keyed by "userId:lorebookId"
const buildResumeStates = new Map<string, GraphBuilderResumeState>()
/**
 * The session a build was scoped to, by the same key as its checkpoint. A
 * resume's scene index counts into the list the build FIRST read, so a resume
 * must re-read that same list — a scoped build resumed unscoped would skip
 * into another session's scenes.
 */
const buildResumeSessions = new Map<string, number | null>()

// ─── Endpoints ────────────────────────────────────────────────────────────────

/**
 * An edge's two ends, as stored: one column of each pair set, the other null.
 *
 * The database holds the rule as two CHECK constraints; this is the one place
 * the application states it, so no handler builds half a pair by hand.
 */
type EndpointColumns =
	| { nodeId: number; entryId: null }
	| { nodeId: null; entryId: number }

/** The stored pair a wire endpoint names. */
const endpointColumns = (
	endpoint: Sockets.NarrativeGraph.RelationshipEndpoint
): EndpointColumns =>
	endpoint.kind === "cast"
		? { nodeId: endpoint.bindingId, entryId: null }
		: { nodeId: null, entryId: endpoint.entryId }

/**
 * The likely-duplicate pairs in one book.
 *
 * Split out so the three write cascades that re-send them — after an applied
 * proposal, after a merge, after an undo — can hand this to `emitToUser` as a
 * thunk (socket-interest plan, ruling 4): ONE source of truth for the payload,
 * and the pairwise scan behind it is paid only when some socket declared the
 * key. A merge made from a surface that shows no duplicate review pays for no
 * re-scan. Skipping the emit alone would save nothing; the scan is the cost.
 */
async function buildDuplicateCandidates(
	lorebookId: number
): Promise<Sockets.NarrativeGraph.DuplicateCandidates.Response> {
	return {
		lorebookId,
		candidates: await findDuplicateCandidates(lorebookId)
	}
}

/**
 * An endpoint a client named, checked against the book it claims to be in.
 *
 * Cross-lorebook edges are refused rather than repaired: an edge whose ends
 * live in two books belongs to neither, and the row carries one `lorebookId`.
 */
async function resolveEndpoint(
	endpoint: Sockets.NarrativeGraph.RelationshipEndpoint,
	lorebookId: number,
	side: "From" | "To"
): Promise<EndpointColumns> {
	if (endpoint.kind === "cast") {
		const node = await db.query.lorebookBindings.findFirst({
			where: eq(schema.lorebookBindings.id, endpoint.bindingId),
			columns: { lorebookId: true }
		})
		if (!node || node.lorebookId !== lorebookId)
			throw new Error(`${side}-node not found.`)
		return { nodeId: endpoint.bindingId, entryId: null }
	}
	const entry = await db.query.lorebookEntries.findFirst({
		where: eq(schema.lorebookEntries.id, endpoint.entryId),
		columns: { lorebookId: true }
	})
	if (!entry || entry.lorebookId !== lorebookId)
		throw new Error(`${side}-entry not found.`)
	return { nodeId: null, entryId: endpoint.entryId }
}

/**
 * What an entry endpoint needs to be drawn as a node.
 *
 * One query for every entry both ends of every row name, rather than one per
 * endpoint: a graph of a hundred roads would otherwise be two hundred reads.
 */
async function entryEndpointIndex(
	rows: readonly {
		fromEntryId: number | null
		toEntryId: number | null
	}[]
): Promise<Map<number, { name: string; typeId: EntryTypeId }>> {
	const ids = [
		...new Set(
			rows.flatMap((r) =>
				[r.fromEntryId, r.toEntryId].filter(
					(id): id is number => id != null
				)
			)
		)
	]
	const index = new Map<number, { name: string; typeId: EntryTypeId }>()
	if (ids.length === 0) return index
	const entries = await db
		.select({
			id: schema.lorebookEntries.id,
			title: schema.lorebookEntries.title,
			typeId: schema.lorebookEntries.typeId
		})
		.from(schema.lorebookEntries)
		.where(inArray(schema.lorebookEntries.id, ids))
	for (const entry of entries)
		index.set(entry.id, {
			name: entry.title ?? "",
			typeId: entry.typeId as EntryTypeId
		})
	return index
}

/**
 * A stored row as the wire carries it.
 *
 * `from`/`to` are the endpoints of record; `fromNodeId`/`toNodeId` ride along
 * unchanged for the readers written before an endpoint could be an entry — see
 * the note on the wire type. An entry endpoint whose row has since been deleted
 * cannot occur (the FK cascades), so an id missing from the index would be a
 * read racing a delete: it is drawn nameless rather than dropped, because an
 * edge that vanishes from a graph without a reason is the worse failure.
 */
function wireRelationship(
	row: SelectNarrativeRelationship,
	entries: Map<number, { name: string; typeId: EntryTypeId }>
): Sockets.NarrativeGraph.NarrativeRelationship {
	const endpoint = (
		nodeId: number | null,
		entryId: number | null
	): Sockets.NarrativeGraph.WireRelationshipEndpoint => {
		if (entryId != null) {
			const entry = entries.get(entryId)
			return {
				kind: "entry",
				entryId,
				name: entry?.name ?? "",
				typeId: entry?.typeId ?? WORLD_LORE_TYPE_ID
			}
		}
		return { kind: "cast", bindingId: nodeId! }
	}
	return {
		...row,
		from: endpoint(row.fromNodeId, row.fromEntryId),
		to: endpoint(row.toNodeId, row.toEntryId)
	}
}

/**
 * The endpoint a payload states, in one shape.
 *
 * `from`/`to` win; `fromNodeId`/`toNodeId` are the pre-0124 spelling of a cast
 * endpoint and are accepted for one release. Naming neither is refused rather
 * than defaulted: an edge has to start somewhere, and a default would be a
 * guess at which row.
 */
function statedEndpoint(
	endpoint: Sockets.NarrativeGraph.RelationshipEndpoint | undefined,
	legacyNodeId: number | undefined,
	side: "From" | "To"
): Sockets.NarrativeGraph.RelationshipEndpoint {
	if (endpoint) return endpoint
	if (legacyNodeId != null) return { kind: "cast", bindingId: legacyNodeId }
	throw new Error(`${side} endpoint is required.`)
}

/** Every row of a list, with its endpoints resolved in one query. */
async function wireRelationships(
	rows: readonly SelectNarrativeRelationship[]
): Promise<Sockets.NarrativeGraph.NarrativeRelationship[]> {
	const entries = await entryEndpointIndex(rows)
	return rows.map((row) => wireRelationship(row, entries))
}

// ─── List ─────────────────────────────────────────────────────────────────────

/**
 * What a Rebuild (replace) would delete, counted.
 *
 * A rebuild wipes EVERY link in the book and puts back only what the builder
 * derives — cast-to-cast links read out of scenes. Anything with an entry at
 * either end (a road between two places, the keeper of a shrine) is never
 * re-derived, so the confirmation has to say how many there are before it runs
 * (owner ruling 6). Counted off the rows the list already carries, so it costs
 * no query.
 *
 * ⚠ There is no count of links "drawn by hand": nothing records where a link
 * came from. A hand-drawn link and a built one look the same, `historyEntryId`
 * included, and guessing would make a warning that is sometimes wrong.
 */
function relationshipCountsOf(
	rows: readonly {
		fromEntryId: number | null
		toEntryId: number | null
	}[]
): Sockets.NarrativeGraph.RelationshipCounts {
	let entryToEntry = 0
	let castToEntry = 0
	for (const row of rows) {
		const ends = (row.fromEntryId != null ? 1 : 0) + (row.toEntryId != null ? 1 : 0)
		if (ends === 2) entryToEntry++
		else if (ends === 1) castToEntry++
	}
	return { total: rows.length, entryToEntry, castToEntry }
}

/**
 * The graph list for one book — the handler's reply and the apply cascade's.
 *
 * ONE builder, so the two cannot drift: the cascade never spells the six
 * counting scans out a second time. `known` is the nodes and wired links a
 * caller has already read, so the cascade does not read them twice.
 *
 * ⚠ Read-only: never write inside this read. In particular it must not stamp
 * scenes as `graphed` — on a book with a cast and no graph that marks EVERY
 * summarized scene graphed, and Extend then has nothing to read.
 */
async function buildGraphList(
	lorebookId: number,
	known?: {
		nodes: SelectLorebookBinding[]
		relationships: Sockets.NarrativeGraph.NarrativeRelationship[]
	}
): Promise<Sockets.NarrativeGraph.List.Response> {
	const hasContent = and(
		inBookOfType(lorebookId, HISTORY_TYPE_ID),
		gt(sql`length(trim(${schema.lorebookEntries.content}))`, 0),
		notExists(
			db
				.select({ _: sql`1` })
				.from(schema.scenes)
				.where(eq(schema.scenes.historyEntryId, schema.lorebookEntries.id))
		)
	)
	const [
		nodes,
		relationships,
		ungraphedScenes,
		unresolvedCastScenes,
		ungraphedUnsummarizedScenes,
		allSummarizedScenes,
		ungraphedDirectEntries,
		allDirectEntries
	] = await Promise.all([
		known
			? known.nodes
			: db.query.lorebookBindings.findMany({
					where: eq(schema.lorebookBindings.lorebookId, lorebookId),
					orderBy: asc(schema.lorebookBindings.id)
				}),
		known
			? known.relationships
			: db.query.narrativeRelationships
					.findMany({
						where: eq(
							schema.narrativeRelationships.lorebookId,
							lorebookId
						),
						orderBy: asc(schema.narrativeRelationships.id)
					})
					.then(wireRelationships),
		// Ungraphed with summary — ready to extend
		db.query.scenes.findMany({
			where: and(
				eq(schema.scenes.lorebookId, lorebookId),
				eq(schema.scenes.graphed, false),
				isNotNull(schema.scenes.summary)
			),
			columns: { id: true }
		}),
		// Summarized scenes whose cast has never been resolved — each costs
		// one extraction call on the next build. A plain marker check, not a
		// scan of the cast columns' shapes.
		db.query.scenes.findMany({
			where: and(
				eq(schema.scenes.lorebookId, lorebookId),
				isNotNull(schema.scenes.summary),
				isNull(schema.scenes.castResolvedAt)
			),
			columns: { id: true }
		}),
		// Ungraphed without summary — need summarising first
		db.query.scenes.findMany({
			where: and(
				eq(schema.scenes.lorebookId, lorebookId),
				eq(schema.scenes.graphed, false),
				isNull(schema.scenes.summary)
			),
			columns: { id: true }
		}),
		// All scenes with summary — for replace-mode preflight
		db.query.scenes.findMany({
			where: and(
				eq(schema.scenes.lorebookId, lorebookId),
				isNotNull(schema.scenes.summary)
			),
			columns: { id: true }
		}),
		// History entries with content, no scenes, not yet graphed
		db
			.select({ id: schema.lorebookEntries.id })
			.from(schema.lorebookEntries)
			.where(and(hasContent, eq(fieldIsTrue("graphed"), false))),
		// All history entries with content and no scenes — for replace-mode preflight
		db
			.select({ id: schema.lorebookEntries.id })
			.from(schema.lorebookEntries)
			.where(hasContent)
	])

	return {
		// The scope the gate reads. See the Response type.
		lorebookId,
		nodes,
		// Entries are on the graph too: an entry with an edge is a node, and
		// the endpoint carries what it takes to draw one.
		relationships,
		relationshipCounts: relationshipCountsOf(relationships),
		ungraphedSceneCount: ungraphedScenes.length,
		unresolvedCastSceneCount: unresolvedCastScenes.length,
		namelessBindingCount: nodes.filter(
			(n) => !n.name.trim() && n.parentNodeId === null
		).length,
		ungraphedUnsummarizedCount: ungraphedUnsummarizedScenes.length,
		totalSummarizedCount: allSummarizedScenes.length,
		ungraphedHistoryEntryCount: ungraphedDirectEntries.length,
		totalDirectHistoryEntryCount: allDirectEntries.length
	}
}

export const narrativeGraphListHandler: Handler<
	Sockets.NarrativeGraph.List.Params,
	Sockets.NarrativeGraph.List.Response
> = {
	event: "narrativeGraph:list",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id

		const lorebook = await db.query.lorebooks.findFirst({
			where: (l, { and, eq }) =>
				and(eq(l.id, params.lorebookId), eq(l.userId, userId))
		})
		if (!lorebook) throw new Error("Lorebook not found or access denied.")

		const res = await buildGraphList(params.lorebookId)
		emitToUser("narrativeGraph:list", res)
		return res
	}
}

// ─── Build (LLM extraction) ───────────────────────────────────────────────────

export const narrativeGraphBuildHandler: Handler<
	Sockets.NarrativeGraph.Build.Params,
	Sockets.NarrativeGraph.Build.Response
> = {
	event: "narrativeGraph:build",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id

		// Pre-activity window: handler entry → activityStore.start(). Nothing
		// in here has an activity to report through yet, so a throw would
		// otherwise fall to register()'s generic catch and reach the user as
		// "An error occurred while processing your request." — while
		// GraphBuildModal has *already* flipped itself to "building"
		// optimistically and fabricated a client-side activeBuild. With no
		// server activity ever created, no activity:update arrives and the
		// modal spins forever behind a placeholder toast.
		//
		// Emitting the specific event here (same shape as
		// the former backfill handler's startBackfill catch
		// below) gives the client the real message AND gives the modal an
		// event to un-stick on. Failures *after* this window already reach the
		// modal via the activity's status: "error" update.
		let lorebook: Awaited<ReturnType<typeof db.query.lorebooks.findFirst>>
		let mode: "replace" | "extend"
		let resumeKey: string
		let resumeState: GraphBuilderResumeState | undefined
		let scopeSessionId: number | null
		let activityId: string
		try {
			lorebook = await db.query.lorebooks.findFirst({
				where: (l, { and, eq }) =>
					and(eq(l.id, params.lorebookId), eq(l.userId, userId))
			})
			if (!lorebook)
				throw new Error("Lorebook not found or access denied.")

			mode = params.mode ?? "replace"
			resumeKey = `${userId}:${params.lorebookId}`
			resumeState = params.resume
				? buildResumeStates.get(resumeKey)
				: undefined
			// Extend from one session reads that session alone. Replace
			// re-reads the whole book by definition, so it takes no scope.
			scopeSessionId =
				mode !== "extend"
					? null
					: params.resume && buildResumeSessions.has(resumeKey)
						? buildResumeSessions.get(resumeKey)!
						: (params.sessionId ?? null)
			buildResumeSessions.set(resumeKey, scopeSessionId)

			activityId = activityStore.start({
				userId,
				lorebookId: params.lorebookId,
				lorebookLabel: lorebook.name,
				mode
			})
		} catch (err) {
			emitToUser("narrativeGraph:build:error", {
				error:
					err instanceof Error
						? err.message
						: "An unexpected error occurred.",
				lorebookId: params.lorebookId
			})
			throw err
		}
		const abortController = new AbortController()
		activityStore.setAbortController(activityId, abortController)

		// Fetch scenes, direct history entries, and bindings
		const [rawScenes, rawDirectEntries] = await Promise.all([
			// All scenes for this lorebook with their history entries
			db.query.scenes.findMany({
				where: eq(schema.scenes.lorebookId, params.lorebookId),
				orderBy: asc(schema.scenes.id),
				with: {
					// The date is a declared field now, so the row carries
					// `fields` and `historyDateOf` reads it out.
					historyEntry: {
						columns: { id: true, fields: true }
					}
				}
			}),
			// History entries with content but no scenes (direct entries)
			db
				.select({
					id: schema.lorebookEntries.id,
					fields: schema.lorebookEntries.fields,
					content: schema.lorebookEntries.content
				})
				.from(schema.lorebookEntries)
				.where(
					and(
						inBookOfType(params.lorebookId, HISTORY_TYPE_ID),
						gt(
							sql`length(trim(${schema.lorebookEntries.content}))`,
							0
						),
						notExists(
							db
								.select({ _: sql`1` })
								.from(schema.scenes)
								.where(
									eq(
										schema.scenes.historyEntryId,
										schema.lorebookEntries.id
									)
								)
						)
					)
				)
		])

		// Fetch bindings with left joins (explicit joins have reliable TS inference)
		const bindings = await db
			.select({
				binding: schema.lorebookBindings.binding,
				characterName: schema.characters.name,
				characterNickname: schema.characters.nickname
			})
			.from(schema.lorebookBindings)
			.leftJoin(
				schema.characters,
				eq(schema.lorebookBindings.characterId, schema.characters.id)
			)
			.where(eq(schema.lorebookBindings.lorebookId, params.lorebookId))

		// Build substitution map: binding token → display name
		const bindingMap: Record<string, string> = {}
		for (const b of bindings) {
			if (!b.binding) continue
			const label = b.characterName
				? b.characterNickname || b.characterName
				: b.binding
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
				? rawScenes.filter(
						(s) =>
							!s.graphed &&
							(scopeSessionId === null ||
								s.sessionId === scopeSessionId)
					)
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
			activityStore.update(activityId, {
				status: "error",
				errorMessage:
					scopeSessionId !== null
						? "No new content to process. Every summarized scene in this session has already been graphed."
						: "No new content to process. All scenes and history entries have already been graphed."
			})
			return {
				proposal: { nodes: [], relationships: [] },
				sceneLabels: [],
				seedTempIdMap: {}
			}
		}

		const { contextConfig, promptConfig } =
			await getUserConfigurations(userId)

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
		// step in the panel is what the next build runs on. The legacy
		// `graph_build_configs` path is retired from this handler; those rows
		// stay readable (legacy sidebar) until 0.8.0, and their prose seeded the
		// pipeline's shipped prompts.
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
		const instanceDefault = await resolveCapabilityTarget(db, {
			capability: TEXT_CAPABILITY
		})
		const defaultConnection = instanceDefault.ok
			? instanceDefault.connection
			: undefined
		const defaultSampling = instanceDefault.ok
			? (instanceDefault.sampling ?? undefined)
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
				(!instanceDefault.ok && instanceDefault.problem.message) ||
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
				"No sampling config is set for chat, and building the graph needs one. " +
					"Choose one in Admin → Defaults."
			)
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
		// called resolveCharacterNamesToBindingIds, which *creates* a binding
		// row per unmatched name, mid-build, in its own committed transaction —
		// so cancelling or discarding a build still left new characters behind.
		// That function's own doc (availableSceneCast.ts) scopes it to "callers
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
		const scenes: GraphBuilderScene[] = [
			...filteredRawScenes.map((s) => {
				const cast = castFor(sceneCasts, s.id)
				const mentions: SceneMentions | undefined = sceneMentions.get(
					s.id
				)
				return {
					id: s.id,
					name: s.name,
					summary: s.summary ? resolveBindings(s.summary) : s.summary,
					historyEntryId: s.historyEntryId ?? null,
					historyEntry: s.historyEntry
						? {
								id: s.historyEntry.id,
								...historyDateOf(s.historyEntry)
							}
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
				historyEntry: { id: he.id, ...historyDateOf(he) },
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
			const characters =
				characterIds.length > 0
					? await db
							.select({
								id: schema.characters.id,
								name: schema.characters.name,
								nickname: schema.characters.nickname,
								description: schema.characters.description,
								summary: schema.characters.summary
							})
							.from(schema.characters)
							.where(inArray(schema.characters.id, characterIds))
					: []
			const charMap = new Map(characters.map((c) => [c.id, c]))

			function fallbackSummary(b: (typeof allBindings)[number]): string {
				if (b.characterId) {
					const char = charMap.get(b.characterId)
					return (
						char?.summary?.trim() || char?.description.trim() || ""
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
			const existingRelationships =
				mode === "extend"
					? await db.query.narrativeRelationships.findMany({
							where: and(
								eq(
									schema.narrativeRelationships.lorebookId,
									params.lorebookId
								),
								castEdgeOnly
							),
							orderBy: asc(schema.narrativeRelationships.id)
						})
					: []

			// Build alias name map: non-hidden alias-child names per parent
			const childrenByParent = new Map<number, string[]>()
			for (const b of allBindings) {
				if (b.parentNodeId !== null && b.nodeVisibility !== "hidden") {
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
					nodeState: b.nodeState,
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
		const worldLore = (
			await db
				.select({
					name: schema.lorebookEntries.title,
					fields: schema.lorebookEntries.fields
				})
				.from(schema.lorebookEntries)
				.where(inBookOfType(params.lorebookId, WORLD_LORE_TYPE_ID))
		).map((e) => ({
			// `title` is nullable on the one table and `name` was NOT NULL on
			// the three; a world lore row cannot reach here without one, since
			// the socket namespace trims and requires it.
			name: e.name ?? "",
			category: (e.fields?.category as string | null) ?? null
		}))

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
				contextConfig,
				promptConfig,
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
						// Present so the interest scope can be derived. The
						// builder's entry names only the call it made — it
						// has no idea which book started it — so the book is
						// added here, where the build was asked for.
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
					const characterMap = new Map(
						characters.map((c) => [c.id, resolveCharacterName(c)])
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
			buildResumeSessions.delete(resumeKey)

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
}

// ─── Apply Proposal ───────────────────────────────────────────────────────────

// Round-12 audit fix (MEDIUM): graphBuilder.ts's LLM-output parsers do pure
// String(...) coercion with no length cap and no validation against the
// real NodeState/RelationshipVisibility unions — the proposal is reviewed/
// edited by the user client-side before submission, but applyProposal
// (below) is the actual DB commit point, and already has this exact
// defensive pattern for other client-supplied proposal fields
// (seedTempIdMap/sceneId/historyEntryId ownership checks above). Cap/
// validate here rather than in every parser.
const MAX_NODE_NAME_LENGTH = 200
const MAX_NODE_TEXT_LENGTH = 2000
const VALID_NODE_STATES = new Set<NodeState>([
	"active",
	"deceased",
	"missing",
	"departed"
])
// `VALID_RELATIONSHIP_VISIBILITIES` / `sanitizeRelationshipVisibility` moved to
// `utils/relationshipVisibility.ts`, beside the bound that now caps what an
// inference may claim — the two answer one question and had to stop being
// reachable separately.

function capText(value: string, maxLength: number): string {
	return value.slice(0, maxLength)
}

function sanitizeNodeState(value: string | undefined | null): NodeState {
	return VALID_NODE_STATES.has(value as NodeState)
		? (value as NodeState)
		: "active"
}

const EXISTING_TEMP_ID_PREFIX = "existing_"

/**
 * `existing_<lorebookBindings.id>` → the id, or null if it isn't that shape.
 * Strict on purpose: this is the sole path from a client-supplied tempId to a
 * real row id, so anything ambiguous (leading zeros, negatives, overflow) is
 * rejected rather than coerced.
 */
function parseExistingTempId(tempId: string): number | null {
	if (!tempId.startsWith(EXISTING_TEMP_ID_PREFIX)) return null
	const raw = tempId.slice(EXISTING_TEMP_ID_PREFIX.length)
	if (!/^[1-9]\d*$/.test(raw)) return null
	const id = Number(raw)
	return Number.isSafeInteger(id) ? id : null
}

export const narrativeGraphApplyProposalHandler: Handler<
	Sockets.NarrativeGraph.ApplyProposal.Params,
	Sockets.NarrativeGraph.ApplyProposal.Response
> = {
	event: "narrativeGraph:applyProposal",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const { lorebookId, proposal, mode } = params

		const lorebook = await db.query.lorebooks.findFirst({
			where: (l, { and, eq }) =>
				and(eq(l.id, lorebookId), eq(l.userId, userId))
		})
		if (!lorebook) throw new Error("Lorebook not found or access denied.")

		/**
		 * Surfaces the real reason before throwing. register()'s generic catch
		 * replaces any uncaught message with a placeholder, and the modal needs
		 * a specific event to un-stick its Apply button.
		 */
		const fail = (message: string): never => {
			emitToUser("narrativeGraph:applyProposal:error", {
				error: message,
				lorebookId
			})
			throw new Error(message)
		}

		// Replace mode redefinition (post-merge — see the lorebookBindings/
		// narrativeNodes merge plan): a binding IS the character's identity
		// and lore-privacy anchor now, so wholesale delete-and-rebuild would
		// destroy real character relationships, not just graph-derived
		// state. A rebuild NEVER deletes a lorebookBindings row, full stop,
		// and never touches its existing fields either — nothing downstream
		// of a fresh build ever writes fresh values back onto an existing
		// binding (summary/state included; see graphBuilder.ts's header and
		// the deferred update-tracking note below), so there is no refill
		// for any field a reset would clear. A previous version of this
		// branch reset nodeState/nodeVisibility/summary/parentNodeId/
		// sceneId/historyEntryId/embedding/embeddingModel/vectorizedAt to
		// defaults and cleared bindingMergeLogs.relationshipRewrites/
		// deletedRelationships to `[]` on every row/log in the lorebook —
		// silent, unrecoverable data loss (a real merge hierarchy in
		// parentNodeId, a past merge's restorable relationship content) with
		// no compensating benefit: the "crash-prone otherwise" justification
		// for clearing the merge-log fields didn't hold up either: undo's
		// rewrite-restore loop is a no-op against a relationship id that no
		// longer exists, and its re-insert loop skips (and counts) any
		// snapshotted link whose endpoints are gone, so leaving them
		// populated is strictly safe, not just less destructive.
		// bindingMergeLogs also has no real FK protection on the node ids it
		// stores (aside from survivorId's onDelete: "set null"), which is
		// why a rebuild never deletes a lorebookBindings row at all — a
		// deleted relationship endpoint would leave relationshipRewrites/
		// deletedRelationships dangling, and a deleted past merge *survivor*
		// would silently null survivorId, permanently disabling that merge's
		// undo with no visible error until someone tried it. Manual
		// per-node deletion is still available via
		// narrativeGraphDeleteNodeHandler for a user who actually wants a
		// ghost row gone. Relationships are wiped wholesale and rebuilt from
		// the fresh proposal — bindingMergeLogs keeps referencing them by id
		// from the log's own JSON snapshot/rewrite records, not a live FK, so
		// the wipe below doesn't orphan anything a future undo depends on.
		//
		// ⚠ "Wholesale" means EVERY link in the book, and that is the ruled
		// behaviour (owner ruling 6, 2026-09-28), not an oversight: links with
		// an entry at either end, and links drawn by hand, go too, and the
		// builder never puts them back (it derives cast-to-cast links only).
		// What makes that acceptable is the confirmation: it warns with
		// `narrativeGraph:list`'s `relationshipCounts` — total links, entry-to-entry,
		// cast-to-entry — before the person runs it.
		// NOTE: the replace-mode wipe used to run right here, OUTSIDE the
		// transaction below. Any failure between it and the re-insert left the
		// graph deleted with nothing put back — which is exactly how the
		// "rebuild destroys my graph" bug did its damage instead of merely
		// failing. It now runs inside the transaction (see below) so a throw
		// rolls it back.

		/**
		 * Build tempId → real binding id WITHOUT trusting the client.
		 *
		 * Every tempId graphBuilder emits for an existing row is literally
		 * `existing_<lorebookBindings.id>`, so the id IS the payload — the
		 * `seedTempIdMap` the client used to send was a pure identity map
		 * carrying zero information. Worse, the old ownership check validated
		 * only the map's *values* (the id set), never the *pairing*: a client
		 * sending `{"existing_5": 7}` with both ids in its own lorebook passed
		 * and silently attached every relationship to the wrong character.
		 * Deriving the mapping here makes it unforgeable.
		 *
		 * Discovered nodes use `new_N` tempIds and are resolved by the INSERT
		 * loop instead — they have no id yet, by design.
		 */
		const newTempIds = new Set(proposal.nodes.map((n) => n.tempId))
		const referencedTempIds = new Set<string>()
		for (const r of proposal.relationships) {
			referencedTempIds.add(r.fromTempId)
			referencedTempIds.add(r.toTempId)
		}
		for (const u of proposal.updatedNodes ?? [])
			referencedTempIds.add(u.tempId)

		const malformed: string[] = []
		const idByTempId = new Map<string, number>()
		for (const tempId of referencedTempIds) {
			if (newTempIds.has(tempId)) continue // resolved at INSERT below
			const id = parseExistingTempId(tempId)
			if (id == null) malformed.push(tempId)
			else idByTempId.set(tempId, id)
		}

		if (malformed.length > 0) {
			fail(
				`Cannot apply: ${malformed.length} proposal ${
					malformed.length === 1
						? "entry references"
						: "entries reference"
				} an unknown node (${malformed.slice(0, 3).join(", ")}). Nothing was changed.`
			)
		}

		const seededIds = [...new Set(idByTempId.values())]
		if (seededIds.length > 0) {
			const rows = await db.query.lorebookBindings.findMany({
				where: (n, { inArray }) => inArray(n.id, seededIds),
				columns: { id: true, lorebookId: true }
			})
			// Message preserved verbatim — existing tests assert on it.
			if (rows.some((r) => r.lorebookId !== lorebookId)) {
				fail(
					"Access denied: seed node ids must belong to this lorebook."
				)
			}
			const found = new Set(rows.map((r) => r.id))
			const missing = seededIds.filter((id) => !found.has(id))
			if (missing.length > 0) {
				fail(
					`Cannot apply: ${missing.length} referenced character${
						missing.length === 1
							? " no longer exists — it was"
							: "s no longer exist — they were"
					} deleted while the build was running. Nothing was changed; rebuild the graph to continue.`
				)
			}
		}
		const tempIdMap = new Map<string, number>(idByTempId)

		// proposal.nodes[].sceneId/historyEntryId and
		// proposal.relationships[].sceneId/historyEntryId are client-supplied
		// too — same class of gap as seedTempIdMap above, just on two more
		// fields. Without this, either could reference a scene/history entry
		// belonging to a different user's lorebook.
		const referencedSceneIds = new Set<number>()
		const referencedHistoryEntryIds = new Set<number>()
		for (const n of proposal.nodes) {
			if (n.sceneId != null) referencedSceneIds.add(n.sceneId)
			if (n.historyEntryId != null)
				referencedHistoryEntryIds.add(n.historyEntryId)
		}
		for (const r of proposal.relationships) {
			if (r.sceneId != null) referencedSceneIds.add(r.sceneId)
			if (r.historyEntryId != null)
				referencedHistoryEntryIds.add(r.historyEntryId)
		}
		// Same treatment for the cast write-back's targets — it names scene
		// rows it intends to UPDATE, so it is exactly the field that must not
		// be trusted to stay inside this lorebook.
		for (const s of proposal.resolvedSceneCast ?? []) {
			if (s.sceneId != null) referencedSceneIds.add(s.sceneId)
			if (s.historyEntryId != null)
				referencedHistoryEntryIds.add(s.historyEntryId)
		}
		if (referencedSceneIds.size > 0) {
			const sceneIds = [...referencedSceneIds]
			const scenes = await db.query.scenes.findMany({
				where: (s, { inArray }) => inArray(s.id, sceneIds),
				columns: { id: true, lorebookId: true }
			})
			if (
				scenes.length !== sceneIds.length ||
				scenes.some((s) => s.lorebookId !== lorebookId)
			) {
				throw new Error(
					"Access denied: referenced scene ids must belong to this lorebook."
				)
			}
		}
		if (referencedHistoryEntryIds.size > 0) {
			const historyEntryIds = [...referencedHistoryEntryIds]
			const historyEntriesFound = await db
				.select({
					id: schema.lorebookEntries.id,
					lorebookId: schema.lorebookEntries.lorebookId
				})
				.from(schema.lorebookEntries)
				.where(
					and(
						inArray(schema.lorebookEntries.id, historyEntryIds),
						eq(schema.lorebookEntries.typeId, HISTORY_TYPE_ID)
					)
				)
			if (
				historyEntriesFound.length !== historyEntryIds.length ||
				historyEntriesFound.some((h) => h.lorebookId !== lorebookId)
			) {
				throw new Error(
					"Access denied: referenced history entry ids must belong to this lorebook."
				)
			}
		}

		/**
		 * What the build being applied actually read, from its own activity —
		 * the server's record, never the client's say-so. `null` when there is
		 * no such build to ask (see the fallback at the graphed stamp).
		 */
		const readByBuild = (() => {
			if (!params.activityId) return null
			const build = activityStore.getById(params.activityId)
			if (
				build?.kind !== "graph_build" ||
				build.userId !== userId ||
				build.lorebookId !== lorebookId ||
				!build.processedSceneIds ||
				!build.processedHistoryEntryIds
			)
				return null
			return {
				sceneIds: build.processedSceneIds,
				historyEntryIds: build.processedHistoryEntryIds
			}
		})()

		// Everything below builds/updates the graph for this lorebook in one
		// pass — wrapped in a transaction so a crash or thrown error partway
		// through (e.g. after some nodes are inserted but before their
		// relationships are) can't leave a half-applied graph.
		await db.transaction(async (tx) => {
			// Replace mode wipes EVERY relationship in the book — entry
			// endpoints and hand-drawn links included, as ruled (see the note
			// above) — and rebuilds from the proposal. Inside the transaction
			// so any failure below (an
			// unresolved endpoint, an FK violation from a concurrently deleted
			// binding) rolls the delete back instead of leaving the graph
			// emptied with nothing put back.
			if (mode === "replace") {
				await tx
					.delete(schema.narrativeRelationships)
					.where(
						eq(schema.narrativeRelationships.lorebookId, lorebookId)
					)
			}

			// INSERT discovered characters. This branch was unreachable while
			// the builder could not discover anyone — Phase 1 was a plain id
			// lookup, so proposal.nodes was always `[]`. Phase 1 now proposes a
			// `new_N` node for every extracted name that matches nothing, and
			// this is where those become real rows: at apply, once, after the
			// user kept them through review.
			//
			// INVARIANT: only non-`existing_` tempIds ever reach here. An
			// `existing_` seed entering proposal.nodes would INSERT a duplicate
			// binding for a character that already has one, on every apply.
			// graphBuilder never puts seeds in newNodeTempIds; the test suite
			// pins it.
			for (const nodeProposal of proposal.nodes) {
				if (parseExistingTempId(nodeProposal.tempId) != null) {
					fail(
						`Internal error: "${nodeProposal.tempId}" is an existing node and must not be inserted. No changes were applied.`
					)
				}
				const token = await deriveNextBindingToken(lorebookId, tx)
				const [inserted] = await tx
					.insert(schema.lorebookBindings)
					.values({
						lorebookId,
						characterId: null,
						binding: token,
						name: capText(nodeProposal.name, MAX_NODE_NAME_LENGTH),
						nodeState: sanitizeNodeState(nodeProposal.nodeState),
						summary: capText(
							nodeProposal.summary ?? "",
							MAX_NODE_TEXT_LENGTH
						),
						sceneId: nodeProposal.sceneId ?? null,
						historyEntryId: nodeProposal.historyEntryId ?? null
					})
					.returning()
				tempIdMap.set(nodeProposal.tempId, inserted.id)
			}

			// UPDATE existing bindings with description/state derived during
			// the build. Separate from the INSERT loop above ON PURPOSE — an
			// existing binding is updated in place and never re-inserted.
			// Identity fields (name, aliases, binding token, characterId,
			// personaId, parentNodeId, nodeVisibility) are never written here:
			// they belong to entity sync and to the merge hierarchy, and the
			// never-reset invariant above depends on this loop not touching
			// them. updatedAt's $onUpdate re-queues the row for embedding for
			// free, so nothing nulls the vector by hand.
			for (const update of proposal.updatedNodes ?? []) {
				const id = tempIdMap.get(update.tempId)
				if (id == null) {
					throw new Error(
						`Internal error: node update ${update.tempId} was not resolved. No changes were applied.`
					)
				}
				if (update.nodeState !== undefined) {
					await tx
						.update(schema.lorebookBindings)
						.set({ nodeState: sanitizeNodeState(update.nodeState) })
						.where(
							and(
								eq(schema.lorebookBindings.id, id),
								eq(
									schema.lorebookBindings.lorebookId,
									lorebookId
								)
							)
						)
				}
				if (update.summary !== undefined) {
					// Fill-blanks-only, enforced in the WHERE rather than by
					// reading first: a non-empty summary is either a prior
					// build's output or a hand edit made through
					// lorebooks:updateBinding (which does not strip `summary`),
					// and the column cannot tell them apart. Encoding it here
					// also means a concurrent edit can't slip through, and the
					// client-supplied previousSummary is never trusted.
					await tx
						.update(schema.lorebookBindings)
						.set({
							summary: capText(
								update.summary,
								MAX_NODE_TEXT_LENGTH
							)
						})
						.where(
							and(
								eq(schema.lorebookBindings.id, id),
								eq(
									schema.lorebookBindings.lorebookId,
									lorebookId
								),
								or(
									isNull(schema.lorebookBindings.summary),
									eq(schema.lorebookBindings.summary, "")
								)
							)
						)
				}
			}

			/**
			 * Who was actually THERE, per scene — what bounds an inferred
			 * relationship's publicity (plan §6).
			 *
			 * Built before the relationship loop because that loop needs it, and
			 * from `participantTempIds` rather than from the derived mentions:
			 * presence is the stored decision, so the bound is unaffected by how
			 * far the annotation lane has got. A scene whose mentions are still
			 * `pending` still bounds its edges correctly.
			 *
			 * `resolvedSceneCast` covers the scenes this build re-derived; every
			 * other scene keeps whatever cast it already had, so its stored
			 * participants are read. Both are needed — a build in extend mode
			 * legitimately updates an edge belonging to a scene it did not touch.
			 */
			const presentBySceneId = new Map<number, Set<number>>()
			for (const resolved of proposal.resolvedSceneCast ?? []) {
				if (resolved.sceneId == null) continue
				presentBySceneId.set(
					resolved.sceneId,
					new Set(
						resolved.participantTempIds
							.map((t) => tempIdMap.get(t))
							.filter((id): id is number => id != null)
					)
				)
			}
			{
				const unresolved = [...referencedSceneIds].filter(
					(id) => !presentBySceneId.has(id)
				)
				if (unresolved.length > 0) {
					const stored = await readSceneCasts(unresolved, tx)
					for (const id of unresolved)
						presentBySceneId.set(
							id,
							new Set(castFor(stored, id).participantCharacters)
						)
				}
			}
			/**
			 * Where the OBJECT of an edge stood in the scene it came from.
			 *
			 * `unknown` for an edge with no scene — a direct history entry has
			 * no cast row to read, and inventing privacy from an absence of
			 * evidence would hide edges nobody claimed were private. `public` is
			 * refused in every case; that rule does not depend on provenance.
			 *
			 * ⚠ Also `unknown` for a scene the map does not hold, which is a
			 * scene the proposal never referenced — reachable only through an
			 * update falling back to the stored `sceneId`. Deliberately not
			 * "absent": failing to *resolve* a cast is not evidence the object
			 * was missing from it, and this bound must only ever err wide, never
			 * tighten an existing row on a fact it could not establish.
			 */
			const presenceOf = (
				sceneId: number | null | undefined,
				objectId: number
			): ObjectPresence => {
				if (sceneId == null) return "unknown"
				const present = presentBySceneId.get(sceneId)
				if (!present) return "unknown"
				return present.has(objectId) ? "present" : "absent"
			}

			/**
			 * The date a link version is filed at, as the history entry that
			 * carries it — a scene's date is its history entry's. `null` for a
			 * version with neither: an undated link.
			 *
			 * The history entry stands in for the date on purpose: two versions
			 * under one entry are one dated state, and comparing ids needs no
			 * calendar. Cached, since every candidate version asks.
			 */
			const historyOfScene = new Map<number, number | null>()
			const dateKeyOf = async (
				historyEntryId: number | null,
				sceneId: number | null
			): Promise<number | null> => {
				if (historyEntryId != null) return historyEntryId
				if (sceneId == null) return null
				if (!historyOfScene.has(sceneId)) {
					const scene = await tx.query.scenes.findFirst({
						where: eq(schema.scenes.id, sceneId),
						columns: { historyEntryId: true }
					})
					historyOfScene.set(sceneId, scene?.historyEntryId ?? null)
				}
				return historyOfScene.get(sceneId) ?? null
			}

			// Insert (or update) relationships
			for (const rel of proposal.relationships) {
				const fromId = tempIdMap.get(rel.fromTempId)
				const toId = tempIdMap.get(rel.toTempId)
				// Unreachable: every tempId was either validated above or
				// inserted by the loop just now. This used to be `continue`,
				// which is what made the rebuild bug invisible — replace mode
				// deleted every relationship, then silently dropped every
				// replacement because the client hadn't sent the map needed to
				// resolve them. A reviewed, approved row must never be skipped
				// in silence; inside the transaction this rolls the delete back.
				if (!fromId || !toId) {
					throw new Error(
						`Internal error: relationship endpoint ${
							!fromId ? rel.fromTempId : rel.toTempId
						} was not resolved. No changes were applied.`
					)
				}

				// In extend mode, when both nodes are existing seeds the LLM may have
				// updated a relationship that already exists — find it and UPDATE rather
				// than INSERT a duplicate.
				const bothSeeds =
					mode === "extend" &&
					rel.fromTempId.startsWith("existing_") &&
					rel.toTempId.startsWith("existing_")

				if (bothSeeds) {
					// Exact direction only — A→B and B→A are distinct perspective entries and
					// must never be collapsed into one row. A new type between existing nodes
					// that has no exact-match row falls through to INSERT below.
					//
					// Main's rows only: an apply is a person at the book, which writes
					// main, and a fork's own version of a link is the fork's.
					const versions =
						await tx.query.narrativeRelationships.findMany({
							where: and(
								eq(
									schema.narrativeRelationships.lorebookId,
									lorebookId
								),
								eq(
									schema.narrativeRelationships.fromNodeId,
									fromId
								),
								eq(
									schema.narrativeRelationships.toNodeId,
									toId
								),
								eq(
									schema.narrativeRelationships
										.relationshipType,
									rel.relationshipType ?? "neutral"
								),
								isNull(schema.narrativeRelationships.branchId)
							),
							orderBy: desc(schema.narrativeRelationships.id)
						})

					/**
					 * WHICH version the proposal speaks about.
					 *
					 * A link can hold several dated versions. Never take
					 * whichever `findFirst` happens to return and rewrite it in
					 * place — that keeps its old date, so "Y5: they fell out"
					 * silently becomes the text of the Y2 version. Instead:
					 *
					 * - a proposal with a date updates only the version filed
					 *   at that same date, and otherwise INSERTS a new dated row
					 *   (falls through below) — an old version is never
					 *   rewritten;
					 * - a proposal with no date updates the newest version,
					 *   preferring one still active — deterministically.
					 */
					const proposedAt = await dateKeyOf(
						rel.historyEntryId ?? null,
						rel.sceneId ?? null
					)
					let existing: (typeof versions)[number] | undefined
					if (proposedAt === null) {
						existing =
							versions.find((v) => v.status === "active") ??
							versions[0]
					} else {
						for (const version of versions) {
							if (
								(await dateKeyOf(
									version.historyEntryId,
									version.sceneId
								)) === proposedAt
							) {
								existing = version
								break
							}
						}
					}

					if (existing) {
						/**
						 * ⚠ A CEILING on the proposal, never an assignment onto
						 * the row (plan §6).
						 *
						 * `undefined` means *leave the column alone*, which is
						 * what an author's `public` gets: `public` is never
						 * inferred, so a row holding it was widened by a person,
						 * and a re-scan must not quietly pull it back down.
						 * Writing `sanitize(...)` unconditionally — what this
						 * did — demoted exactly that edge on every build.
						 */
						const boundedVisibility =
							inferredRelationshipVisibility({
								claim: rel.visibility ?? existing.visibility,
								objectPresence: presenceOf(
									rel.sceneId ?? existing.sceneId,
									toId
								),
								stored: existing.visibility
							})
						await tx
							.update(schema.narrativeRelationships)
							.set({
								relationshipType:
									rel.relationshipType ??
									existing.relationshipType,
								description: capText(
									rel.description ?? existing.description,
									MAX_NODE_TEXT_LENGTH
								),
								...(boundedVisibility === undefined
									? {}
									: { visibility: boundedVisibility }),
								status: rel.status ?? existing.status,
								reason: rel.reason
									? capText(rel.reason, MAX_NODE_TEXT_LENGTH)
									: existing.reason
							})
							.where(
								eq(
									schema.narrativeRelationships.id,
									existing.id
								)
							)
						continue
					}
				}

				await tx.insert(schema.narrativeRelationships).values({
					lorebookId,
					fromNodeId: fromId,
					toNodeId: toId,
					relationshipType: rel.relationshipType ?? "neutral",
					description: capText(
						rel.description ?? "",
						MAX_NODE_TEXT_LENGTH
					),
					// Born bounded. The column's `"acknowledged"` default is
					// precisely the over-scoping plan §6 names: an edge formed
					// in a scene its object was not in must not assert that
					// they know about it.
					visibility: inferredRelationshipVisibility({
						claim: rel.visibility,
						objectPresence: presenceOf(rel.sceneId, toId)
					}),
					status: rel.status ?? "active",
					reason: rel.reason
						? capText(rel.reason, MAX_NODE_TEXT_LENGTH)
						: null,
					sceneId: rel.sceneId ?? null,
					historyEntryId: rel.historyEntryId ?? null
				})
			}

			// Write derived cast back onto the scene rows. This is the ONLY
			// place a build's character resolution reaches the database, and it
			// happens after the user approved the proposal — cancel or discard
			// and nothing here runs, so the next build simply re-derives.
			//
			// tempIds resolve through the same map the relationships used, so
			// a character discovered during this build lands as the real id the
			// INSERT loop above just created.
			//
			// No extra lorebook filter here, deliberately. Every id in
			// tempIdMap is already proven in-lorebook: `existing_` ids were
			// validated against this lorebook before the transaction opened,
			// and `new_` ids were just INSERTed into it. Note also that
			// scenes.ts's filterCharacterIdsToLorebook is NOT the right tool —
			// it scopes by `characterId`, i.e. it treats these arrays as
			// character ids, while everything post-merge (graphBuilder,
			// resolveCharacterNamesToBindingIds) stores lorebookBindings ids.
			// Running binding ids through it would silently drop the ones that
			// don't coincide with a bound characterId.
			for (const resolved of proposal.resolvedSceneCast ?? []) {
				const toIds = (tempIds: string[]) => [
					...new Set(
						tempIds
							.map((t) => tempIdMap.get(t))
							.filter((id): id is number => id != null)
					)
				]
				const participantCharacters = toIds(resolved.participantTempIds)
				// ⚠ `resolved.mentionedTempIds` is deliberately NOT resolved or
				// written. `mentioned` is derived from annotations now (plan
				// §1) and storing a second, weaker copy is what this lane
				// removed; the proposal still carries the field so reviving the
				// stored form is a one-line change rather than a re-derivation.
				// castResolvedAt is set even when the list is empty — that
				// is the marker's entire purpose. A scene that genuinely
				// features nobody must be distinguishable from one never
				// processed, or it re-extracts on every build forever.
				if (resolved.sceneId != null) {
					// Scope-check before writing cast rows: resolved.sceneId is
					// client-supplied, and writeSceneCast targets a scene id
					// directly rather than going through a lorebook-scoped
					// WHERE the way the row update below does.
					const owned = await tx.query.scenes.findFirst({
						where: and(
							eq(schema.scenes.id, resolved.sceneId),
							eq(schema.scenes.lorebookId, lorebookId)
						),
						columns: { id: true }
					})
					if (!owned) continue
					// Participants only — `writeSceneCast` rewrites exactly the
					// roles it is handed, so any pre-icing `mentioned` rows are
					// left where they are rather than being clobbered by a
					// build that no longer has an opinion about them.
					await writeSceneCast(
						resolved.sceneId,
						{ participantCharacters },
						tx
					)
					await tx
						.update(schema.scenes)
						.set({ castResolvedAt: new Date() })
						.where(
							and(
								eq(schema.scenes.id, resolved.sceneId),
								eq(schema.scenes.lorebookId, lorebookId)
							)
						)
				}
				// Direct history entries have no scene row to write to; their
				// cast is re-derived each build. Filed with the entry
				// resolved-marker follow-up.
			}

			// Mark what the build READ as graphed — entirely server-side.
			// Replace resets the whole book first, since a rebuild re-reads it
			// all; either mode then stamps exactly the scenes and direct history
			// entries the build fed the builder (`readByBuild`), so a scene
			// summarized while the build was running stays ungraphed and the
			// next Extend reads it.
			if (mode === "replace") {
				await tx
					.update(schema.scenes)
					.set({ graphed: false })
					.where(eq(schema.scenes.lorebookId, lorebookId))
				// Reset history entries graphed status too.
				// ⚠ Merged into `fields`, never written over it — the
				// summarizer's `isCompleted` lives in the same object and a
				// whole-object write from here would erase it.
				await tx
					.update(schema.lorebookEntries)
					.set({ fields: mergeFields({ graphed: false }) })
					.where(inBookOfType(lorebookId, HISTORY_TYPE_ID))
			}
			const directEntryOnly = and(
				inBookOfType(lorebookId, HISTORY_TYPE_ID),
				gt(sql`length(trim(${schema.lorebookEntries.content}))`, 0),
				notExists(
					tx
						.select({ _: sql`1` })
						.from(schema.scenes)
						.where(
							eq(
								schema.scenes.historyEntryId,
								schema.lorebookEntries.id
							)
						)
				)
			)
			if (readByBuild) {
				if (readByBuild.sceneIds.length > 0)
					await tx
						.update(schema.scenes)
						.set({ graphed: true })
						.where(
							and(
								eq(schema.scenes.lorebookId, lorebookId),
								inArray(schema.scenes.id, readByBuild.sceneIds),
								isNotNull(schema.scenes.summary)
							)
						)
				// ⚠ Merged, for the same reason as the reset above.
				if (readByBuild.historyEntryIds.length > 0)
					await tx
						.update(schema.lorebookEntries)
						.set({ fields: mergeFields({ graphed: true }) })
						.where(
							and(
								directEntryOnly,
								inArray(
									schema.lorebookEntries.id,
									readByBuild.historyEntryIds
								)
							)
						)
			} else {
				// No build on record to ask — an apply with no `activityId`, or
				// one whose review has already gone. The old rule, which
				// over-stamps anything summarized during the build: every
				// summarized scene and direct entry not yet graphed.
				await tx
					.update(schema.scenes)
					.set({ graphed: true })
					.where(
						and(
							eq(schema.scenes.lorebookId, lorebookId),
							eq(schema.scenes.graphed, false),
							isNotNull(schema.scenes.summary)
						)
					)
				await tx
					.update(schema.lorebookEntries)
					.set({ fields: mergeFields({ graphed: true }) })
					.where(directEntryOnly)
			}
		})

		// The two reads this handler's OWN reply is made of. They stay eager:
		// the caller asked for the applied graph and is waiting on it.
		const [nodes, relationships] = await Promise.all([
			db.query.lorebookBindings.findMany({
				where: eq(schema.lorebookBindings.lorebookId, lorebookId),
				orderBy: asc(schema.lorebookBindings.id)
			}),
			db.query.narrativeRelationships.findMany({
				where: eq(schema.narrativeRelationships.lorebookId, lorebookId),
				orderBy: asc(schema.narrativeRelationships.id)
			})
		])
		const wiredRelationships = await wireRelationships(relationships)
		const res: Sockets.NarrativeGraph.ApplyProposal.Response = {
			nodes,
			relationships: wiredRelationships
		}

		// The COUNT reads the refreshed graph list is made of, and nothing
		// else — LAZY (socket-interest plan, ruling 4). A proposal applied from
		// a surface with no graph list open pays for none of them; the reply
		// above is unaffected either way. Skipping the emit alone would save
		// nothing; these scans are the cost. The cast count is re-derived
		// rather than carried over: the apply just wrote castResolvedAt onto
		// every scene it resolved, so it should normally have dropped to 0.
		await emitToUser("narrativeGraph:list", () =>
			buildGraphList(lorebookId, {
				nodes,
				relationships: wiredRelationships
			})
		)
		emitToUser("narrativeGraph:applyProposal", res)

		// Proactive duplicate review — surface likely-duplicate pairs right
		// after a build/extend completes, not just on the next time someone
		// happens to open the Bindings tab. LAZY: see
		// `buildDuplicateCandidates`.
		await emitToUser("narrativeGraph:duplicateCandidates", () =>
			buildDuplicateCandidates(lorebookId)
		)

		return res
	}
}

// ─── Node CRUD ────────────────────────────────────────────────────────────────

export const narrativeGraphUpdateNodeHandler: Handler<
	Sockets.NarrativeGraph.UpdateNode.Params,
	Sockets.NarrativeGraph.UpdateNode.Response
> = {
	event: "narrativeGraph:updateNode",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id

		const existing = await db.query.lorebookBindings.findFirst({
			where: eq(schema.lorebookBindings.id, params.node.id)
		})
		if (!existing) throw new Error("Node not found.")

		const lorebook = await db.query.lorebooks.findFirst({
			where: (l, { and, eq }) =>
				and(eq(l.id, existing.lorebookId), eq(l.userId, userId))
		})
		if (!lorebook) throw new Error("Access denied.")

		// Identity fields — name/aliases (bound rows: entity sync only, see
		// decision 2; unbound rows: set via lorebooks:updateBinding) and
		// summary (edited through the binding, not the graph, per the UI
		// consolidation) — are never writable from this handler. Only
		// genuinely graph-shaped fields (nodeState, nodeVisibility,
		// parentNodeId, scene/history anchoring) are updatable here.
		// Explicit allowlist, not a denylist: a denylist silently lets any
		// new/renamed field on the row (eg. lorebookId) through untouched,
		// which previously let a client move a node into a lorebook it
		// doesn't own by including a foreign lorebookId in the payload.
		const fields: Partial<typeof schema.lorebookBindings.$inferInsert> = {}
		const n = params.node

		if (n.nodeState !== undefined)
			fields.nodeState = n.nodeState as NodeState
		if (n.nodeVisibility !== undefined)
			fields.nodeVisibility = n.nodeVisibility as NodeVisibility

		// The remaining allowed fields are all foreign keys into rows that
		// must belong to this node's own lorebook — allowlisting the field
		// isn't enough on its own, since the *value* could still point at
		// another tenant's row (eg. another user's lorebookBindings id as
		// parentNodeId), creating a cross-tenant reference the graph-context
		// builder could later join through into prompt content.
		if (n.parentNodeId !== undefined) {
			if (n.parentNodeId === null) {
				fields.parentNodeId = null
			} else {
				// Same book, not itself, two levels at most — the one rule
				// lorebooks:updateBinding applies too (finding #22).
				await assertValidParentNode(
					db,
					existing.id,
					n.parentNodeId,
					existing.lorebookId
				)
				fields.parentNodeId = n.parentNodeId
			}
		}
		if (n.sceneId !== undefined) {
			if (n.sceneId === null) {
				fields.sceneId = null
			} else {
				const scene = await db.query.scenes.findFirst({
					where: eq(schema.scenes.id, n.sceneId)
				})
				if (!scene || scene.lorebookId !== existing.lorebookId) {
					throw new Error("Scene not found.")
				}
				fields.sceneId = n.sceneId
			}
		}
		if (n.historyEntryId !== undefined) {
			if (n.historyEntryId === null) {
				fields.historyEntryId = null
			} else {
				const [historyEntry] = await db
					.select({
						lorebookId: schema.lorebookEntries.lorebookId
					})
					.from(schema.lorebookEntries)
					.where(
						and(
							eq(schema.lorebookEntries.id, n.historyEntryId),
							eq(schema.lorebookEntries.typeId, HISTORY_TYPE_ID)
						)
					)
				if (
					!historyEntry ||
					historyEntry.lorebookId !== existing.lorebookId
				) {
					throw new Error("History entry not found.")
				}
				fields.historyEntryId = n.historyEntryId
			}
		}

		await db
			.update(schema.lorebookBindings)
			.set(fields)
			.where(eq(schema.lorebookBindings.id, params.node.id))

		const [updated] = await db
			.select()
			.from(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.id, params.node.id))

		const res: Sockets.NarrativeGraph.UpdateNode.Response = {
			node: updated
		}
		emitToUser("narrativeGraph:updateNode", res)
		return res
	}
}

export const narrativeGraphDeleteNodeHandler: Handler<
	Sockets.NarrativeGraph.DeleteNode.Params,
	Sockets.NarrativeGraph.DeleteNode.Response
> = {
	event: "narrativeGraph:deleteNode",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id

		// Behavior change from pre-merge (flag prominently in delete-
		// confirmation UI copy — see the merge plan): deleting a node used
		// to be graph-only and non-destructive, since the binding survived
		// with lorebookBindingId just set null. Post-merge, deleting the
		// row necessarily detaches any bound character/persona from the
		// lorebook and nulls any character-lore entries that referenced it
		// (via that FK's onDelete: set null).
		const existing = await db.query.lorebookBindings.findFirst({
			where: eq(schema.lorebookBindings.id, params.id)
		})
		if (!existing) throw new Error("Node not found.")

		const lorebook = await db.query.lorebooks.findFirst({
			where: (l, { and, eq }) =>
				and(eq(l.id, existing.lorebookId), eq(l.userId, userId))
		})
		if (!lorebook) throw new Error("Access denied.")

		/**
		 * Their private lore: the character-lore entries anchored to them.
		 *
		 * The anchor is `ON DELETE SET NULL`, so lore left behind becomes
		 * UNASSIGNED — and unassigned lore is narrator-visible. That is a
		 * disclosure, not a tidy-up, so the person decides (owner ruling 4):
		 * `"keep"` (the default, and what every caller got before this
		 * choice existed) leaves the lore in the book unassigned; `"delete"`
		 * removes every entry anchored to them, archived ones included — an
		 * archived private entry left unassigned would go narrator-visible
		 * the day it is restored. `checkNodeMergeReferences` counts them for
		 * the dialog before it asks.
		 */
		const privateLore = params.privateLore ?? "keep"
		if (privateLore !== "keep" && privateLore !== "delete")
			throw new Error('privateLore must be "keep" or "delete".')

		// Scene cast cleanup used to live here: cast was a plain JSON int array
		// with no FK, so deleting a binding would leave a permanent dangling id
		// unless every scene in the lorebook was loaded and both arrays
		// rewritten by hand. scene_characters.binding_id is a real FK with
		// ON DELETE cascade, so the database does it — correctly, and without
		// a full-table scan. Their amendments and presences cascade the same
		// way; their attribute rows have no key to cascade on, so they are
		// removed by hand in the same transaction.
		const deletedLoreCount = await db.transaction(async (tx) => {
			let deleted = 0
			if (privateLore === "delete") {
				const gone = await tx
					.delete(schema.lorebookEntries)
					.where(
						and(
							eq(schema.lorebookEntries.anchorBindingId, params.id),
							eq(
								schema.lorebookEntries.typeId,
								CHARACTER_LORE_TYPE_ID
							)
						)
					)
					.returning({ id: schema.lorebookEntries.id })
				deleted = gone.length
			}
			await deleteMemberAttributes(tx, params.id)
			await tx
				.delete(schema.lorebookBindings)
				.where(eq(schema.lorebookBindings.id, params.id))
			return deleted
		})

		const res: Sockets.NarrativeGraph.DeleteNode.Response = {
			success: "Node deleted.",
			id: params.id,
			lorebookId: existing.lorebookId,
			deletedLoreCount
		}
		emitToUser("narrativeGraph:deleteNode", res)
		return res
	}
}

/**
 * Read-only pre-check for narrativeGraph:deleteNode's confirmation UI: whether
 * a merge log still names the member, and how much private lore they anchor.
 * bindingMergeLogs references node ids as plain JSON, not real FKs — a
 * node that's a past merge's survivorId or a relationship endpoint in some
 * log's relationshipRewrites/deletedRelationships gets silently orphaned
 * or has that merge's undo permanently disabled if deleted with no
 * warning. Queries every log for the lorebook (not the capped/summarized
 * narrativeGraph:listMergeLogs, which doesn't return the fields needed
 * here).
 */
export const narrativeGraphCheckNodeMergeReferencesHandler: Handler<
	Sockets.NarrativeGraph.CheckNodeMergeReferences.Params,
	Sockets.NarrativeGraph.CheckNodeMergeReferences.Response
> = {
	event: "narrativeGraph:checkNodeMergeReferences",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const { nodeId } = params

		const node = await db.query.lorebookBindings.findFirst({
			where: eq(schema.lorebookBindings.id, nodeId)
		})
		if (!node) throw new Error("Node not found.")

		const lorebook = await db.query.lorebooks.findFirst({
			where: (l, { and, eq }) =>
				and(eq(l.id, node.lorebookId), eq(l.userId, userId))
		})
		if (!lorebook) throw new Error("Access denied.")

		const logs = await db.query.bindingMergeLogs.findMany({
			where: eq(schema.bindingMergeLogs.lorebookId, node.lorebookId)
		})

		const referenced = logs.some(
			(log) =>
				log.survivorId === nodeId ||
				log.relationshipRewrites.some(
					(rw) =>
						rw.oldFromNodeId === nodeId || rw.oldToNodeId === nodeId
				) ||
				(log.deletedRelationships as Record<string, unknown>[]).some(
					(rel) =>
						rel.fromNodeId === nodeId || rel.toNodeId === nodeId
				)
		)

		// The member's private lore, for the delete dialog's keep-or-delete
		// question (see `narrativeGraph:deleteNode`'s `privateLore`). Archived
		// rows are counted apart, matching the default entry list, so the
		// headline figure is what the person can see in the book.
		const anchored = await db
			.select({ archived: schema.lorebookEntries.archived })
			.from(schema.lorebookEntries)
			.where(
				and(
					eq(schema.lorebookEntries.anchorBindingId, nodeId),
					eq(schema.lorebookEntries.typeId, CHARACTER_LORE_TYPE_ID)
				)
			)

		const res: Sockets.NarrativeGraph.CheckNodeMergeReferences.Response = {
			nodeId: params.nodeId,
			referencedByMergeLog: referenced,
			privateLoreCount: anchored.filter((e) => !e.archived).length,
			archivedPrivateLoreCount: anchored.filter((e) => e.archived).length
		}
		emitToUser("narrativeGraph:checkNodeMergeReferences", res)
		return res
	}
}

// ─── Relationship CRUD ────────────────────────────────────────────────────────

export const narrativeGraphUpdateRelationshipHandler: Handler<
	Sockets.NarrativeGraph.UpdateRelationship.Params,
	Sockets.NarrativeGraph.UpdateRelationship.Response
> = {
	event: "narrativeGraph:updateRelationship",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id

		const existing = await db.query.narrativeRelationships.findFirst({
			where: eq(schema.narrativeRelationships.id, params.relationship.id)
		})
		if (!existing) throw new Error("Relationship not found.")

		const lorebook = await db.query.lorebooks.findFirst({
			where: (l, { and, eq }) =>
				and(eq(l.id, existing.lorebookId), eq(l.userId, userId))
		})
		if (!lorebook) throw new Error("Access denied.")

		// Explicit allowlist, not a denylist — a denylist previously let a
		// client rewrite fromNodeId/toNodeId/lorebookId to point anywhere.
		// Never writable here: lorebookId, embedding, embeddingModel. An
		// endpoint IS writable, and only through `from`/`to`, which go through
		// the same validation `createRelationship` puts a new endpoint through:
		// the row keeps its own lorebook and both ends must be in it.
		const fields: Partial<
			typeof schema.narrativeRelationships.$inferInsert
		> = {}
		const r = params.relationship

		if (r.from !== undefined) {
			const from = await resolveEndpoint(
				r.from,
				existing.lorebookId,
				"From"
			)
			fields.fromNodeId = from.nodeId
			fields.fromEntryId = from.entryId
		}
		if (r.to !== undefined) {
			const to = await resolveEndpoint(r.to, existing.lorebookId, "To")
			fields.toNodeId = to.nodeId
			fields.toEntryId = to.entryId
		}

		if (r.relationshipType !== undefined)
			fields.relationshipType = r.relationshipType
		if (r.description !== undefined) fields.description = r.description
		if (r.reason !== undefined) fields.reason = r.reason
		if (r.status !== undefined) fields.status = r.status
		// Sanitised, never *bounded*. This is the authoring path: a person may
		// still set `public`, which `inferredRelationshipVisibility`'s ceiling
		// makes unreachable by inference precisely because only an author can
		// claim it. All this does is refuse a value the enum does not have —
		// see `relationshipVisibility.ts` on why conflating the two is the bug.
		if (r.visibility !== undefined)
			fields.visibility = sanitizeRelationshipVisibility(r.visibility)

		// historyEntryId/sceneId are FKs — must stay scoped to this
		// relationship's own lorebook, same reasoning as updateNode.
		if (r.historyEntryId !== undefined) {
			if (r.historyEntryId === null) {
				fields.historyEntryId = null
			} else {
				const [historyEntry] = await db
					.select({
						lorebookId: schema.lorebookEntries.lorebookId
					})
					.from(schema.lorebookEntries)
					.where(
						and(
							eq(schema.lorebookEntries.id, r.historyEntryId),
							eq(schema.lorebookEntries.typeId, HISTORY_TYPE_ID)
						)
					)
				if (
					!historyEntry ||
					historyEntry.lorebookId !== existing.lorebookId
				) {
					throw new Error("History entry not found.")
				}
				fields.historyEntryId = r.historyEntryId
			}
		}
		if (r.sceneId !== undefined) {
			if (r.sceneId === null) {
				fields.sceneId = null
			} else {
				const scene = await db.query.scenes.findFirst({
					where: eq(schema.scenes.id, r.sceneId)
				})
				if (!scene || scene.lorebookId !== existing.lorebookId) {
					throw new Error("Scene not found.")
				}
				fields.sceneId = r.sceneId
			}
		}

		await db
			.update(schema.narrativeRelationships)
			.set(fields)
			.where(eq(schema.narrativeRelationships.id, params.relationship.id))

		const [updated] = await db
			.select()
			.from(schema.narrativeRelationships)
			.where(eq(schema.narrativeRelationships.id, params.relationship.id))

		const res: Sockets.NarrativeGraph.UpdateRelationship.Response = {
			relationship: wireRelationship(
				updated,
				await entryEndpointIndex([updated])
			)
		}
		emitToUser("narrativeGraph:updateRelationship", res)
		return res
	}
}

export const narrativeGraphDeleteRelationshipHandler: Handler<
	Sockets.NarrativeGraph.DeleteRelationship.Params,
	Sockets.NarrativeGraph.DeleteRelationship.Response
> = {
	event: "narrativeGraph:deleteRelationship",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id

		const existing = await db.query.narrativeRelationships.findFirst({
			where: eq(schema.narrativeRelationships.id, params.id)
		})
		if (!existing) throw new Error("Relationship not found.")

		const lorebook = await db.query.lorebooks.findFirst({
			where: (l, { and, eq }) =>
				and(eq(l.id, existing.lorebookId), eq(l.userId, userId))
		})
		if (!lorebook) throw new Error("Access denied.")

		await db
			.delete(schema.narrativeRelationships)
			.where(eq(schema.narrativeRelationships.id, params.id))

		// The id and book ride the reply so an open canvas drops the one edge
		// in place (no reload, the layout stays) and a canvas on another book
		// ignores it — the write is bare, so the listener filters.
		const res: Sockets.NarrativeGraph.DeleteRelationship.Response = {
			success: "Relationship deleted.",
			id: existing.id,
			lorebookId: existing.lorebookId
		}
		emitToUser("narrativeGraph:deleteRelationship", res)
		return res
	}
}

// ─── Create Relationship ──────────────────────────────────────────────────────

export const narrativeGraphCreateRelationshipHandler: Handler<
	Sockets.NarrativeGraph.CreateRelationship.Params,
	Sockets.NarrativeGraph.CreateRelationship.Response
> = {
	event: "narrativeGraph:createRelationship",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const {
			lorebookId,
			relationshipType,
			status,
			description,
			visibility,
			historyEntryId
		} = params

		const lorebook = await db.query.lorebooks.findFirst({
			where: (l, { and, eq }) =>
				and(eq(l.id, lorebookId), eq(l.userId, userId))
		})
		if (!lorebook) throw new Error("Lorebook not found or access denied.")

		const [from, to] = await Promise.all([
			resolveEndpoint(
				statedEndpoint(params.from, params.fromNodeId, "From"),
				lorebookId,
				"From"
			),
			resolveEndpoint(
				statedEndpoint(params.to, params.toNodeId, "To"),
				lorebookId,
				"To"
			)
		])

		if (historyEntryId != null) {
			const [historyEntry] = await db
				.select({ lorebookId: schema.lorebookEntries.lorebookId })
				.from(schema.lorebookEntries)
				.where(
					and(
						eq(schema.lorebookEntries.id, historyEntryId),
						eq(schema.lorebookEntries.typeId, HISTORY_TYPE_ID)
					)
				)
			if (!historyEntry || historyEntry.lorebookId !== lorebookId) {
				throw new Error("History entry not found.")
			}
		}

		/**
		 * The line the link is drawn on. A link drawn while reading a fork is
		 * that fork's, exactly as an entry written there is — so the branch
		 * must be one of THIS book's (a foreign id is refused, never clamped to
		 * main). Absent or null is main.
		 */
		const branchId = params.branchId ?? null
		if (branchId != null) {
			const branch = await db.query.lorebookBranches.findFirst({
				where: eq(schema.lorebookBranches.id, branchId),
				columns: { lorebookId: true }
			})
			if (!branch || branch.lorebookId !== lorebookId)
				throw new Error("Branch not found in this lorebook.")
		}

		const [inserted] = await db
			.insert(schema.narrativeRelationships)
			.values({
				lorebookId,
				branchId,
				fromNodeId: from.nodeId,
				fromEntryId: from.entryId,
				toNodeId: to.nodeId,
				toEntryId: to.entryId,
				relationshipType,
				visibility: (visibility ??
					"acknowledged") as RelationshipVisibility,
				status,
				description: description ?? "",
				reason: null,
				historyEntryId: historyEntryId ?? null
			})
			.returning()

		const res: Sockets.NarrativeGraph.CreateRelationship.Response = {
			relationship: wireRelationship(
				inserted,
				await entryEndpointIndex([inserted])
			)
		}
		emitToUser("narrativeGraph:createRelationship", res)
		return res
	}
}

// ─── A cast member's own story (absorb / undo) ────────────────────────────────

/**
 * Where an absorb files the absorbed member's dated story inside the log's
 * `absorbedSnapshot`.
 *
 * A key no binding column can ever be spelled as, so the snapshot stays "the
 * row, verbatim" for everything else and undo can take this off before it
 * re-inserts the row. Kept in the snapshot rather than a column of its own
 * because it IS the absorbed member's — their amendments, their presences,
 * their attribute rows — and a new column is a migration for no gain.
 */
const MEMBER_STORY_KEY = "$memberStory"

/** The rows that belong to one cast member and go when the member does. */
type MemberStory = {
	castAmendments: Record<string, unknown>[]
	castPresences: Record<string, unknown>[]
	attributeValues: Record<string, unknown>[]
	attributeConfigs: Record<string, unknown>[]
}

/**
 * Read a cast member's dated story, before an absorb takes it away.
 *
 * Amendments and presences hang off the binding with `ON DELETE CASCADE`, so
 * deleting the absorbed row deletes them; attribute rows name the member by a
 * plain `(owner_kind, owner_id)` pair with no key, so they would be left
 * pointing at nothing. All four are snapshotted here so an undo can put the
 * member back as they were, not as a bare row.
 */
async function snapshotMemberStory(
	tx: Db,
	bindingId: number
): Promise<MemberStory> {
	const castAmendments = await tx
		.select()
		.from(schema.castAmendments)
		.where(eq(schema.castAmendments.lorebookBindingId, bindingId))
	const castPresences = await tx
		.select()
		.from(schema.castPresences)
		.where(eq(schema.castPresences.lorebookBindingId, bindingId))
	const ownedBy = <T extends { ownerKind: any; ownerId: any }>(t: T) =>
		and(eq(t.ownerKind, "cast_member"), eq(t.ownerId, bindingId))
	const attributeValues = await tx
		.select()
		.from(schema.attributeValues)
		.where(ownedBy(schema.attributeValues))
	const attributeConfigs = await tx
		.select()
		.from(schema.attributeConfigs)
		.where(ownedBy(schema.attributeConfigs))
	return {
		castAmendments,
		castPresences,
		attributeValues,
		attributeConfigs
	}
}

/**
 * Delete the attribute rows a cast member owns.
 *
 * The other half of their story cascades with the binding; these have no key
 * to cascade on, so every path that removes a member (absorb, delete) removes
 * them by hand in the same transaction.
 */
async function deleteMemberAttributes(tx: Db, bindingId: number) {
	await tx
		.delete(schema.attributeValues)
		.where(
			and(
				eq(schema.attributeValues.ownerKind, "cast_member"),
				eq(schema.attributeValues.ownerId, bindingId)
			)
		)
	await tx
		.delete(schema.attributeConfigs)
		.where(
			and(
				eq(schema.attributeConfigs.ownerKind, "cast_member"),
				eq(schema.attributeConfigs.ownerId, bindingId)
			)
		)
}

/** Which of `ids` still exist in `table` — one query per table. */
async function stillThere(
	tx: Db,
	table: any,
	ids: readonly (number | null | undefined)[]
): Promise<Set<number>> {
	const wanted = [
		...new Set(ids.filter((id): id is number => typeof id === "number"))
	]
	if (wanted.length === 0) return new Set()
	const rows: { id: number }[] = await tx
		.select({ id: table.id })
		.from(table)
		.where(inArray(table.id, wanted))
	return new Set(rows.map((r) => r.id))
}

/**
 * A snapshotted row made insertable again: no id (it returns under a new one),
 * and every timestamp revived — a JSON snapshot hands them back as ISO strings,
 * which a `timestamp` column refuses.
 */
function reviveRow(row: Record<string, unknown>): Record<string, any> {
	const { id: _id, ...rest } = row
	for (const key of ["createdAt", "updatedAt"])
		if (typeof rest[key] === "string")
			rest[key] = new Date(rest[key] as string)
	return rest
}

/**
 * Put a cast member's dated story back onto their recreated row.
 *
 * What the snapshot names may have gone since the absorb, and the undo must not
 * fail on it. A row whose LINE is gone (its branch, or its session for a
 * session-layer attribute) went with that line and is skipped; a row whose
 * MOMENT is gone (a history entry, a scene) keeps its value and loses the
 * pointer, exactly as the foreign key's own `SET NULL` would have done.
 *
 * Returns how many rows could not be put back.
 */
async function restoreMemberStory(
	tx: Db,
	story: MemberStory,
	newBindingId: number
): Promise<number> {
	const all = [
		...story.castAmendments,
		...story.castPresences,
		...story.attributeValues,
		...story.attributeConfigs
	]
	if (all.length === 0) return 0
	const col = (key: string) => all.map((r) => r[key] as number | null)
	// One after another, not `Promise.all`: these run on the transaction's
	// one connection either way, and sequential is what keeps it that way.
	const branches = await stillThere(tx, schema.lorebookBranches, col("branchId"))
	const historyEntries = await stillThere(
		tx,
		schema.lorebookEntries,
		col("historyEntryId")
	)
	const scenes = await stillThere(tx, schema.scenes, col("sceneId"))
	const sessions = await stillThere(tx, schema.sessions, col("sessionId"))
	const messages = await stillThere(
		tx,
		schema.messages,
		col("validFromMessageId")
	)
	const gone = (set: Set<number>, id: unknown) =>
		typeof id === "number" && !set.has(id)
	let skipped = 0

	/**
	 * `branchIsKeyed`: amendments and presences key `branch_id` to
	 * `lorebook_branches`; attribute rows hold it as a plain int with no key
	 * (the column predates the table), so a missing branch cannot fail their
	 * insert and is not a reason to drop them.
	 */
	const revive = (row: Record<string, unknown>, branchIsKeyed: boolean) => {
		if (branchIsKeyed && gone(branches, row.branchId)) return null
		if (gone(sessions, row.sessionId)) return null
		if (gone(messages, row.validFromMessageId)) return null
		const out = reviveRow(row)
		if (gone(historyEntries, row.historyEntryId)) out.historyEntryId = null
		if ("sceneId" in out && gone(scenes, row.sceneId)) out.sceneId = null
		return out
	}

	for (const row of story.castAmendments) {
		const values = revive(row, true)
		if (!values) {
			skipped++
			continue
		}
		await tx
			.insert(schema.castAmendments)
			.values({ ...values, lorebookBindingId: newBindingId } as any)
	}
	for (const row of story.castPresences) {
		const values = revive(row, true)
		if (!values) {
			skipped++
			continue
		}
		await tx
			.insert(schema.castPresences)
			.values({ ...values, lorebookBindingId: newBindingId } as any)
	}
	for (const row of story.attributeValues) {
		const values = revive(row, false)
		if (!values) {
			skipped++
			continue
		}
		await tx
			.insert(schema.attributeValues)
			.values({ ...values, ownerId: newBindingId } as any)
	}
	for (const row of story.attributeConfigs) {
		const values = revive(row, false)
		if (!values) {
			skipped++
			continue
		}
		await tx
			.insert(schema.attributeConfigs)
			.values({ ...values, ownerId: newBindingId } as any)
	}
	return skipped
}

// ─── Merge Node ───────────────────────────────────────────────────────────────

/**
 * Consolidating "absorb" — replaces the old parentNodeId-tagging merge.
 * Deletes the absorbed row and rewrites every reference to it onto the
 * survivor (relationships, scene participant/mentioned arrays, character
 * lore), instead of just tagging one row as a cosmetic alias of another
 * (which never actually fixed anything beyond display — see the plan
 * this implements). Destructive, but reversible: everything needed to
 * undo is written to `bindingMergeLogs` in the same transaction.
 */
export const narrativeGraphMergeNodeHandler: Handler<
	Sockets.NarrativeGraph.MergeNode.Params,
	Sockets.NarrativeGraph.MergeNode.Response
> = {
	event: "narrativeGraph:mergeNode",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const { nodeId, parentNodeId } = params

		if (nodeId === parentNodeId) {
			throw new Error("Cannot merge a node with itself.")
		}

		const [child, parent] = await Promise.all([
			db.query.lorebookBindings.findFirst({
				where: eq(schema.lorebookBindings.id, nodeId)
			}),
			db.query.lorebookBindings.findFirst({
				where: eq(schema.lorebookBindings.id, parentNodeId)
			})
		])
		if (!child) throw new Error("Node not found.")
		if (!parent) throw new Error("Parent node not found.")
		if (child.lorebookId !== parent.lorebookId)
			throw new Error("Nodes must belong to the same lorebook.")

		const lorebook = await db.query.lorebooks.findFirst({
			where: and(
				eq(schema.lorebooks.id, child.lorebookId),
				eq(schema.lorebooks.userId, userId)
			)
		})
		if (!lorebook) throw new Error("Access denied.")

		// Binding IS the row, so absorbing two bound rows into each other
		// would mean reassigning one character's identity onto a different
		// row — that's data corruption, not a merge. Unconditional,
		// non-negotiable guard, no exception.
		const childIsBound = child.characterId != null
		const parentIsBound = parent.characterId != null
		if (childIsBound && parentIsBound) {
			throw new Error(
				"Cannot absorb two nodes that are both linked to character bindings — they represent distinct individuals."
			)
		}

		// Auto-swap: the bound row always survives, so characterId
		// is never copied between rows (no risk of losing sync) and the
		// bound row's identity/id stays stable.
		const survivorId = childIsBound ? nodeId : parentNodeId
		const absorbedId = childIsBound ? parentNodeId : nodeId
		const absorbed = absorbedId === nodeId ? child : parent
		const survivor = survivorId === nodeId ? child : parent

		const survivorNode = await db.transaction(async (tx) => {
			// 1. Snapshot the absorbed row before anything changes.
			const absorbedSnapshot: Record<string, unknown> = { ...absorbed }

			// 2. Rewrite relationships from the absorbed id to the survivor's.
			const affectedRels = await tx.query.narrativeRelationships.findMany(
				{
					where: and(
						eq(
							schema.narrativeRelationships.lorebookId,
							lorebook.id
						),
						or(
							eq(
								schema.narrativeRelationships.fromNodeId,
								absorbedId
							),
							eq(
								schema.narrativeRelationships.toNodeId,
								absorbedId
							)
						)
					)
				}
			)
			// Pre-existing survivor relationships, to dedup rewritten ones
			// against. Deliberately a single up-front snapshot — this dedups
			// each rewritten relationship against the survivor's own
			// pre-existing set, not against each other (two duplicate
			// relationships already on the absorbed row would both survive
			// the rewrite as duplicates of each other; a rare enough
			// pre-existing data-quality issue that it's out of scope here).
			const survivorRels = await tx.query.narrativeRelationships.findMany(
				{
					where: and(
						eq(
							schema.narrativeRelationships.lorebookId,
							lorebook.id
						),
						or(
							eq(
								schema.narrativeRelationships.fromNodeId,
								survivorId
							),
							eq(
								schema.narrativeRelationships.toNodeId,
								survivorId
							)
						)
					)
				}
			)

			const relationshipRewrites: {
				id: number
				oldFromNodeId: number | null
				oldToNodeId: number | null
			}[] = []
			const deletedRelationships: Record<string, unknown>[] = []

			// ⚠ **Only the cast endpoints move.** `affectedRels` is selected on
			// the two node columns, so an entry endpoint is never `absorbedId`
			// and never rewritten: absorbing a character rewrites their end of
			// "keeper of the shrine" and leaves the shrine where it is.
			for (const rel of affectedRels) {
				const newFromNodeId =
					rel.fromNodeId === absorbedId ? survivorId : rel.fromNodeId
				const newToNodeId =
					rel.toNodeId === absorbedId ? survivorId : rel.toNodeId

				// Self-loop: the single most common case this feature exists
				// for (two rows turning out to be the same person) very
				// plausibly already has a relationship *between them* —
				// rewriting both endpoints to the survivor's id would leave
				// a relationship from someone to themselves. Two entry
				// endpoints are both null and are not a self-loop, which is
				// why this asks for a real id rather than for equality alone.
				if (newFromNodeId !== null && newFromNodeId === newToNodeId) {
					deletedRelationships.push({ ...rel })
					relationshipRewrites.push({
						id: rel.id,
						oldFromNodeId: rel.fromNodeId,
						oldToNodeId: rel.toNodeId
					})
					await tx
						.delete(schema.narrativeRelationships)
						.where(eq(schema.narrativeRelationships.id, rel.id))
					continue
				}

				// A duplicate is the SAME dated state on the SAME line: same
				// ends, same type, same branch, same history entry. Two versions
				// filed at different dates, or on different lines, are two
				// records, not one said twice — collapsing them loses a dated
				// version of the link (and the tie-break below goes by row id,
				// the later-written, never a history entry's id read as a date).
				const duplicate = survivorRels.find(
					(r) =>
						r.id !== rel.id &&
						r.fromNodeId === newFromNodeId &&
						r.toNodeId === newToNodeId &&
						r.fromEntryId === rel.fromEntryId &&
						r.toEntryId === rel.toEntryId &&
						r.relationshipType === rel.relationshipType &&
						(r.branchId ?? null) === (rel.branchId ?? null) &&
						(r.historyEntryId ?? null) === (rel.historyEntryId ?? null)
				)
				if (duplicate) {
					// Keep the more complete one; on a tie, the later-written.
					const relIsBetter =
						rel.description.length > duplicate.description.length ||
						(rel.description.length ===
							duplicate.description.length &&
							rel.id > duplicate.id)
					const toDelete = relIsBetter ? duplicate : rel
					const toKeep = relIsBetter ? rel : duplicate
					deletedRelationships.push({ ...toDelete })
					relationshipRewrites.push({
						id: rel.id,
						oldFromNodeId: rel.fromNodeId,
						oldToNodeId: rel.toNodeId
					})
					await tx
						.delete(schema.narrativeRelationships)
						.where(
							eq(schema.narrativeRelationships.id, toDelete.id)
						)
					if (toKeep.id === rel.id) {
						await tx
							.update(schema.narrativeRelationships)
							.set({
								fromNodeId: newFromNodeId,
								toNodeId: newToNodeId
							})
							.where(eq(schema.narrativeRelationships.id, rel.id))
					}
					continue
				}

				relationshipRewrites.push({
					id: rel.id,
					oldFromNodeId: rel.fromNodeId,
					oldToNodeId: rel.toNodeId
				})
				await tx
					.update(schema.narrativeRelationships)
					.set({ fromNodeId: newFromNodeId, toNodeId: newToNodeId })
					.where(eq(schema.narrativeRelationships.id, rel.id))
			}

			// 3. Repoint the absorbed binding's scene appearances onto the
			// survivor. Cascade alone would be wrong here — an absorbed
			// character's appearances must MOVE to the survivor, not vanish
			// with the row.
			//
			// Snapshots are still captured first, and still in the array shape
			// bindingMergeLogs.sceneSnapshots has always stored, so undoMerge
			// can restore pre-existing logs written before the join table
			// existed as well as new ones.
			const lorebookScenes = await tx.query.scenes.findMany({
				where: eq(schema.scenes.lorebookId, lorebook.id),
				columns: { id: true, selectedMessageIds: true }
			})
			const castsBefore = await readSceneCasts(
				lorebookScenes.map((s) => s.id),
				tx
			)
			const affectedScenes = lorebookScenes.filter((scene) => {
				const cast = castFor(castsBefore, scene.id)
				return (
					cast.participantCharacters.includes(absorbedId) ||
					cast.mentionedCharacters.includes(absorbedId)
				)
			})
			/**
			 * ⚠ The mentioned half is SNAPSHOTTED, not read back later.
			 *
			 * A merge log is a point-in-time record by definition, and
			 * `mentioned` is derived now — re-deriving it at undo time would
			 * answer about the vocabulary as it stands *then*, which is not the
			 * cast this merge saw. Freezing it here is what keeps the record
			 * true; it is not a reason to make the stored row primary again.
			 */
			const mentionsBefore = await deriveSceneMentions(
				tx,
				lorebook.id,
				affectedScenes.map((s) => ({
					id: s.id,
					selectedMessageIds: s.selectedMessageIds ?? null
				}))
			)
			const sceneSnapshots: {
				sceneId: number
				participantCharacters: number[]
				mentionedCharacters: number[]
			}[] = []
			for (const scene of affectedScenes) {
				const cast = castFor(castsBefore, scene.id)
				const mentions = mentionsBefore.get(scene.id)
				sceneSnapshots.push({
					sceneId: scene.id,
					participantCharacters: cast.participantCharacters,
					mentionedCharacters: mentions
						? mentionedSoFar(mentions)
						: cast.mentionedCharacters
				})
			}
			await repointSceneCast(lorebook.id, absorbedId, survivorId, tx)

			// 4. Reassign character-lore entries (onDelete: "set null" —
			// without this, private lore attached to the absorbed row goes
			// permanently unbound/invisible the moment it's deleted).
			const reassignedLoreEntries = await tx
				.select({ id: schema.lorebookEntries.id })
				.from(schema.lorebookEntries)
				.where(
					and(
						eq(schema.lorebookEntries.anchorBindingId, absorbedId),
						eq(
							schema.lorebookEntries.typeId,
							CHARACTER_LORE_TYPE_ID
						)
					)
				)
			const reassignedCharacterLoreEntryIds = reassignedLoreEntries.map(
				(e) => e.id
			)
			if (reassignedCharacterLoreEntryIds.length > 0) {
				await tx
					.update(schema.lorebookEntries)
					.set({ anchorBindingId: survivorId })
					.where(
						inArray(
							schema.lorebookEntries.id,
							reassignedCharacterLoreEntryIds
						)
					)
			}

			// 4.5. Reassign child nodes (onDelete: "set null" on parentNodeId —
			// without this, any alias-children of the absorbed row would be
			// silently orphaned the moment it's deleted, and undo would have
			// no record to restore the link from).
			const reassignedChildNodes =
				await tx.query.lorebookBindings.findMany({
					where: eq(schema.lorebookBindings.parentNodeId, absorbedId),
					columns: { id: true }
				})
			const reassignedChildNodeIds = reassignedChildNodes.map((n) => n.id)
			if (reassignedChildNodeIds.length > 0) {
				await tx
					.update(schema.lorebookBindings)
					.set({ parentNodeId: survivorId })
					.where(
						inArray(
							schema.lorebookBindings.id,
							reassignedChildNodeIds
						)
					)
			}

			// 5. Append the absorbed identity to the survivor's
			// absorbedAliases — never `aliases` directly (see schema.ts:
			// `aliases` is a one-directional sync target from the bound
			// entity, a full replace on every entity edit; an alias written
			// there would vanish the next time the survivor's character/
			// persona is edited at all).
			const candidateNames = [
				absorbed.name,
				...(absorbed.aliases ?? []),
				...(absorbed.absorbedAliases ?? [])
			]
				.map((n) => n?.trim())
				.filter((n): n is string => !!n && n !== survivor.name)
			const existingAbsorbed = new Set(survivor.absorbedAliases ?? [])
			const absorbedAliasesAdded = [
				...new Set(
					candidateNames.filter((n) => !existingAbsorbed.has(n))
				)
			]
			const newAbsorbedAliases = [
				...(survivor.absorbedAliases ?? []),
				...absorbedAliasesAdded
			]

			// 6/7. Null the stale vector (identity just changed) and carry
			// over first-appearance tracking if the survivor doesn't have it.
			await tx
				.update(schema.lorebookBindings)
				.set({
					absorbedAliases: newAbsorbedAliases,
					embedding: null,
					embeddingModel: null,
					vectorizedAt: null,
					sceneId: survivor.sceneId ?? absorbed.sceneId ?? null,
					historyEntryId:
						survivor.historyEntryId ??
						absorbed.historyEntryId ??
						null
				})
				.where(eq(schema.lorebookBindings.id, survivorId))

			// 7.5. The absorbed member's own dated story — their amendments,
			// presences and attribute rows. The first two cascade with the row
			// below and the attribute rows have no key to cascade on, so all of
			// it is snapshotted into the log first; undo puts it back onto the
			// recreated row. Left on the absorbed member, not moved onto the
			// survivor: two members' dated overlays can collide on one date,
			// and which one wins is not a merge's call to make.
			absorbedSnapshot[MEMBER_STORY_KEY] = await snapshotMemberStory(
				tx,
				absorbedId
			)
			await deleteMemberAttributes(tx, absorbedId)

			// 8. Delete the absorbed row.
			await tx
				.delete(schema.lorebookBindings)
				.where(eq(schema.lorebookBindings.id, absorbedId))

			// Audit log — what makes this safe to be destructive.
			await tx.insert(schema.bindingMergeLogs).values({
				lorebookId: lorebook.id,
				userId,
				survivorId,
				absorbedSnapshot,
				relationshipRewrites,
				deletedRelationships,
				sceneSnapshots,
				absorbedAliasesAdded,
				reassignedCharacterLoreEntryIds,
				reassignedChildNodeIds
			})

			const updated = await tx.query.lorebookBindings.findFirst({
				where: eq(schema.lorebookBindings.id, survivorId)
			})
			return updated!
		})

		const res: Sockets.NarrativeGraph.MergeNode.Response = {
			survivorNode
		}
		emitToUser("narrativeGraph:mergeNode", res)

		// Refresh duplicate candidates — any other candidate pair involving
		// the now-deleted absorbed id would otherwise dangle in the UI. LAZY:
		// see `buildDuplicateCandidates`.
		await emitToUser("narrativeGraph:duplicateCandidates", () =>
			buildDuplicateCandidates(lorebook.id)
		)

		return res
	}
}

/**
 * Reverses a previous absorb via its bindingMergeLogs entry — re-inserts
 * the absorbed row from its recorded snapshot (new primary key; identity
 * sequences never reuse a number once issued, so the row's exact original
 * `{{char:N}}` binding token is restored verbatim, not best-effort — any
 * stored lore/history content still containing that literal text resolves
 * correctly again the instant this completes), then restores every
 * rewrite/deletion the absorb performed.
 */
export const narrativeGraphUndoMergeHandler: Handler<
	Sockets.NarrativeGraph.UndoMerge.Params,
	Sockets.NarrativeGraph.UndoMerge.Response
> = {
	event: "narrativeGraph:undoMerge",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const { mergeLogId } = params

		const log = await db.query.bindingMergeLogs.findFirst({
			where: eq(schema.bindingMergeLogs.id, mergeLogId)
		})
		if (!log) throw new Error("Merge record not found.")

		const lorebook = await db.query.lorebooks.findFirst({
			where: and(
				eq(schema.lorebooks.id, log.lorebookId),
				eq(schema.lorebooks.userId, userId)
			)
		})
		if (!lorebook) throw new Error("Access denied.")

		if (log.survivorId === null) {
			throw new Error(
				"This merge can no longer be undone — the surviving character has since been absorbed elsewhere or deleted."
			)
		}
		const survivorId = log.survivorId

		const restored = await db.transaction(async (tx) => {
			const snapshot = log.absorbedSnapshot as Record<string, unknown>
			const oldAbsorbedId = snapshot.id as number
			const {
				id: _oldId,
				createdAt: snapshotCreatedAt,
				updatedAt: _oldUpdatedAt,
				// Dropped, not restored, for two separate reasons.
				//
				// Crash: snapshots live in a JSONB column, so every Date came
				// back out as an ISO *string*. Spreading one into a `timestamp`
				// column makes drizzle call `.toISOString()` on a string —
				// `TypeError: value.toISOString is not a function`, which is
				// what undoMerge died with. createdAt/updatedAt were already
				// pulled out for that reason; vectorizedAt was missed.
				//
				// Correctness: the row returns under a NEW primary key, and
				// embeddings are keyed by row id, so the old vector does not
				// apply to it. Carrying vectorizedAt over would mark the
				// restored row as already-embedded so it would never be
				// re-queued — silently absent from RAG. Clearing both re-queues
				// it.
				vectorizedAt: _oldVectorizedAt,
				embeddingModel: _oldEmbeddingModel,
				// Not a column: the member's dated story, restored below once
				// the row has its new id. Absent from logs written before it
				// was recorded, which restore nothing for it.
				[MEMBER_STORY_KEY]: memberStory,
				...rest
			} = snapshot

			// Re-insert the absorbed row verbatim under a new primary key.
			const [inserted] = await tx
				.insert(schema.lorebookBindings)
				.values({
					...(rest as typeof schema.lorebookBindings.$inferInsert),
					createdAt: snapshotCreatedAt
						? new Date(snapshotCreatedAt as string)
						: new Date()
				})
				.returning()

			// Null passes straight through: that end of the edge is an entry,
			// which a merge never touched and an undo must not invent one for.
			const remapId = <T extends number | null>(id: T) =>
				(id === oldAbsorbedId ? inserted.id : id) as T

			// Restore relationships still standing (rewritten, not deleted)
			// back to their original endpoints.
			const deletedIds = new Set(
				(log.deletedRelationships as Record<string, unknown>[]).map(
					(r) => r.id as number
				)
			)
			for (const rw of log.relationshipRewrites) {
				if (deletedIds.has(rw.id)) continue // handled via re-insert below
				await tx
					.update(schema.narrativeRelationships)
					.set({
						fromNodeId: remapId(rw.oldFromNodeId),
						toNodeId: remapId(rw.oldToNodeId)
					})
					.where(eq(schema.narrativeRelationships.id, rw.id))
			}

			// Re-insert relationships deleted outright (self-loops, or the
			// losing side of a third-party dedup).
			//
			// ⚠ Not a no-op against a world that moved on. Anything a
			// snapshotted link names may have been deleted since the merge — an
			// entry at one end, the other cast member, its branch — and one
			// such row must not fail the insert and with it the WHOLE undo. So
			// the ends are checked first: a link whose end or line is gone is
			// skipped and counted (it went with that end), and a link whose
			// history entry or scene is gone keeps itself and loses the pointer,
			// as the foreign key's own `SET NULL` would have done.
			const deletedRels = log.deletedRelationships as Record<
				string,
				unknown
			>[]
			const remapped = deletedRels.map((r) => ({
				row: r,
				fromNodeId: remapId((r.fromNodeId ?? null) as number | null),
				toNodeId: remapId((r.toNodeId ?? null) as number | null)
			}))
			const nodesLeft = await stillThere(
				tx,
				schema.lorebookBindings,
				remapped.flatMap((r) => [r.fromNodeId, r.toNodeId])
			)
			const entriesLeft = await stillThere(
				tx,
				schema.lorebookEntries,
				deletedRels.flatMap((r) => [
					r.fromEntryId as number | null,
					r.toEntryId as number | null,
					r.historyEntryId as number | null
				])
			)
			const scenesLeft = await stillThere(
				tx,
				schema.scenes,
				deletedRels.map((r) => r.sceneId as number | null)
			)
			const branchesLeft = await stillThere(
				tx,
				schema.lorebookBranches,
				deletedRels.map((r) => r.branchId as number | null)
			)
			const missing = (set: Set<number>, id: unknown) =>
				typeof id === "number" && !set.has(id)
			let unrestoredLinkCount = 0
			for (const { row, fromNodeId, toNodeId } of remapped) {
				if (
					missing(nodesLeft, fromNodeId) ||
					missing(nodesLeft, toNodeId) ||
					missing(entriesLeft, row.fromEntryId) ||
					missing(entriesLeft, row.toEntryId) ||
					missing(branchesLeft, row.branchId)
				) {
					unrestoredLinkCount++
					continue
				}
				const {
					id: _oldRelId,
					createdAt: relCreatedAt,
					updatedAt: _relUpdatedAt,
					// Same two reasons as the binding snapshot above: an ISO
					// string in a timestamp column crashes the insert, and a
					// stale vectorizedAt on a new primary key hides the row
					// from re-embedding.
					vectorizedAt: _relVectorizedAt,
					embeddingModel: _relEmbeddingModel,
					...relRest
				} = row
				await tx.insert(schema.narrativeRelationships).values({
					...(relRest as typeof schema.narrativeRelationships.$inferInsert),
					fromNodeId,
					toNodeId,
					historyEntryId: missing(entriesLeft, row.historyEntryId)
						? null
						: ((row.historyEntryId ?? null) as number | null),
					sceneId: missing(scenesLeft, row.sceneId)
						? null
						: ((row.sceneId ?? null) as number | null),
					createdAt: relCreatedAt
						? new Date(relCreatedAt as string)
						: new Date()
				})
			}

			// The member's own dated story, back onto the recreated row.
			const unrestoredStoryCount = memberStory
				? await restoreMemberStory(
						tx,
						memberStory as MemberStory,
						inserted.id
					)
				: 0

			// Restore scene cast to its recorded pre-merge value (remapped onto
			// the recreated row's new id). The snapshot format is unchanged —
			// still the two id arrays — so logs written before scene_characters
			// existed replay identically; only the write target moved.
			//
			// ⚠ **Participants only, and the mentioned remap is deleted.**
			// `mentioned` is derived from annotations now, and the derivation
			// reverts by itself: this same transaction recreates the absorbed
			// binding and strips the names it lent the survivor's
			// `absorbedAliases`, so the gazetteer the next read resolves through
			// is the pre-merge one again. Remapping ids into a row nothing reads
			// would be work whose only effect is to look like an answer.
			// `sceneSnapshots.mentionedCharacters` stays in the log as the
			// frozen record of what the merge saw.
			//
			// A scene deleted since is skipped, and a cast member deleted since
			// is left out of the list — either would fail the insert and take
			// the whole undo with it.
			const snapScenesLeft = await stillThere(
				tx,
				schema.scenes,
				log.sceneSnapshots.map((s) => s.sceneId)
			)
			const castLeft = await stillThere(
				tx,
				schema.lorebookBindings,
				log.sceneSnapshots.flatMap((s) =>
					s.participantCharacters.map(remapId)
				)
			)
			for (const sceneSnap of log.sceneSnapshots) {
				if (!snapScenesLeft.has(sceneSnap.sceneId)) continue
				await writeSceneCast(
					sceneSnap.sceneId,
					{
						participantCharacters: sceneSnap.participantCharacters
							.map(remapId)
							.filter((id) => castLeft.has(id))
					},
					tx
				)
			}

			// Move reassigned character-lore entries back to the recreated row.
			if (log.reassignedCharacterLoreEntryIds.length > 0) {
				await tx
					.update(schema.lorebookEntries)
					.set({ anchorBindingId: inserted.id })
					.where(
						inArray(
							schema.lorebookEntries.id,
							log.reassignedCharacterLoreEntryIds
						)
					)
			}

			// Move reassigned child nodes (alias-children of the absorbed row)
			// back to point at the recreated row.
			if (log.reassignedChildNodeIds.length > 0) {
				await tx
					.update(schema.lorebookBindings)
					.set({ parentNodeId: inserted.id })
					.where(
						inArray(
							schema.lorebookBindings.id,
							log.reassignedChildNodeIds
						)
					)
			}

			// Remove exactly the strings this merge added to the survivor's
			// absorbedAliases — tolerate them already being gone (e.g. a
			// further edit happened in between).
			if (log.absorbedAliasesAdded.length > 0) {
				const survivor = await tx.query.lorebookBindings.findFirst({
					where: eq(schema.lorebookBindings.id, survivorId)
				})
				if (survivor) {
					const toRemove = new Set(log.absorbedAliasesAdded)
					await tx
						.update(schema.lorebookBindings)
						.set({
							absorbedAliases: (
								survivor.absorbedAliases ?? []
							).filter((a) => !toRemove.has(a))
						})
						.where(eq(schema.lorebookBindings.id, survivorId))
				}
			}

			await tx
				.delete(schema.bindingMergeLogs)
				.where(eq(schema.bindingMergeLogs.id, mergeLogId))

			return {
				inserted,
				unrestoredLinkCount,
				unrestoredStoryCount
			}
		})

		const res: Sockets.NarrativeGraph.UndoMerge.Response = {
			restoredNode: restored.inserted,
			unrestoredLinkCount: restored.unrestoredLinkCount,
			unrestoredStoryCount: restored.unrestoredStoryCount
		}
		emitToUser("narrativeGraph:undoMerge", res)

		// LAZY: see `buildDuplicateCandidates`.
		await emitToUser("narrativeGraph:duplicateCandidates", () =>
			buildDuplicateCandidates(log.lorebookId)
		)

		return res
	}
}

export const narrativeGraphListMergeLogsHandler: Handler<
	Sockets.NarrativeGraph.ListMergeLogs.Params,
	Sockets.NarrativeGraph.ListMergeLogs.Response
> = {
	event: "narrativeGraph:listMergeLogs",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const { lorebookId } = params

		const lorebook = await db.query.lorebooks.findFirst({
			where: and(
				eq(schema.lorebooks.id, lorebookId),
				eq(schema.lorebooks.userId, userId)
			)
		})
		if (!lorebook) throw new Error("Lorebook not found or access denied.")

		const logs = await db.query.bindingMergeLogs.findMany({
			where: eq(schema.bindingMergeLogs.lorebookId, lorebookId),
			orderBy: desc(schema.bindingMergeLogs.createdAt),
			limit: 20,
			with: {
				survivor: { columns: { name: true } }
			}
		})

		const res: Sockets.NarrativeGraph.ListMergeLogs.Response = {
			lorebookId,
			mergeLogs: logs.map((log) => ({
				id: log.id,
				survivorId: log.survivorId,
				survivorName: log.survivor?.name ?? null,
				absorbedName: (log.absorbedSnapshot as Record<string, unknown>)
					.name as string,
				createdAt: log.createdAt
			}))
		}
		emitToUser("narrativeGraph:listMergeLogs", res)
		return res
	}
}

export const narrativeGraphDuplicateCandidatesHandler: Handler<
	Sockets.NarrativeGraph.DuplicateCandidates.Params,
	Sockets.NarrativeGraph.DuplicateCandidates.Response
> = {
	event: "narrativeGraph:duplicateCandidates",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const { lorebookId } = params

		const lorebook = await db.query.lorebooks.findFirst({
			where: and(
				eq(schema.lorebooks.id, lorebookId),
				eq(schema.lorebooks.userId, userId)
			)
		})
		if (!lorebook) throw new Error("Lorebook not found or access denied.")

		const res = await buildDuplicateCandidates(lorebookId)
		emitToUser("narrativeGraph:duplicateCandidates", res)
		return res
	}
}

export const narrativeGraphDismissDuplicateHandler: Handler<
	Sockets.NarrativeGraph.DismissDuplicate.Params,
	Sockets.NarrativeGraph.DismissDuplicate.Response
> = {
	event: "narrativeGraph:dismissDuplicate",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const { lorebookId, bindingIdA, bindingIdB } = params

		const lorebook = await db.query.lorebooks.findFirst({
			where: and(
				eq(schema.lorebooks.id, lorebookId),
				eq(schema.lorebooks.userId, userId)
			)
		})
		if (!lorebook) throw new Error("Lorebook not found or access denied.")

		const [a, b] =
			bindingIdA < bindingIdB
				? [bindingIdA, bindingIdB]
				: [bindingIdB, bindingIdA]

		await db
			.insert(schema.dismissedDuplicatePairs)
			.values({ lorebookId, bindingIdA: a, bindingIdB: b })
			.onConflictDoNothing()

		// EAGER, deliberately, unlike the three cascades that go through
		// `buildDuplicateCandidates` lazily: the refreshed list IS this
		// handler's own declared reply — it just travels under the
		// `duplicateCandidates` name — so a thunk here could only skip an
		// emit, never the scan, and skipping an emit alone saves nothing.
		// Built once and used twice, which is what keeps the two answers
		// from disagreeing.
		const res: Sockets.NarrativeGraph.DismissDuplicate.Response =
			await buildDuplicateCandidates(lorebookId)
		emitToUser("narrativeGraph:duplicateCandidates", res)
		return res
	}
}

// The pre-merge scene backfill (findPreMergeSceneIds plus the detect/preview/
// backfill handlers) lived here. It existed to find scenes whose cast columns
// still held pre-merge NAME STRINGS instead of binding ids, and to resolve
// them one scene at a time. scene_characters.binding_id is an integer FK — a
// name string cannot be stored — so the condition it detected is now
// unrepresentable. The one-time conversion of existing name strings happens in
// the join-table migration itself, which is where a data fix belongs.

// resolveBindingName is gone — now that a bound row's `name` is always kept
// in sync with its character/persona (decision 2, see the merge plan), the
// row's own `.name` already IS the resolved display name; no separate
// resolution helper is needed.

// ─── Registration ─────────────────────────────────────────────────────────────

export function registerNarrativeGraphHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (
		socket: any,
		handler: Handler<any, any>,
		emitToUser: (event: string, data: any) => void
	) => void
) {
	register(socket, narrativeGraphListHandler, emitToUser)
	register(socket, narrativeGraphBuildHandler, emitToUser)
	register(socket, narrativeGraphApplyProposalHandler, emitToUser)
	register(socket, narrativeGraphUpdateNodeHandler, emitToUser)
	register(socket, narrativeGraphDeleteNodeHandler, emitToUser)
	register(socket, narrativeGraphCheckNodeMergeReferencesHandler, emitToUser)
	register(socket, narrativeGraphUpdateRelationshipHandler, emitToUser)
	register(socket, narrativeGraphDeleteRelationshipHandler, emitToUser)
	register(socket, narrativeGraphCreateRelationshipHandler, emitToUser)
	register(socket, narrativeGraphMergeNodeHandler, emitToUser)
	register(socket, narrativeGraphUndoMergeHandler, emitToUser)
	register(socket, narrativeGraphListMergeLogsHandler, emitToUser)
	register(socket, narrativeGraphDuplicateCandidatesHandler, emitToUser)
	register(socket, narrativeGraphDismissDuplicateHandler, emitToUser)
}
