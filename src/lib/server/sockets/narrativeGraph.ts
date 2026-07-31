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
	buildGraphFromScenes,
	GraphParseError,
	type GraphBuilderScene,
	type GraphBuilderSeedNode,
	type GraphBuilderSeedRelationship,
	type GraphBuilderResumeState
} from "$lib/server/utils/graphBuilder"
import { getUserConfigurations } from "$lib/server/utils/getUserConfigurations"
import { activityStore } from "$lib/server/utils/activityStore"
import { deriveNextBindingToken } from "$lib/server/utils/lorebookBindingToken"
import {
	syncLorebookBindingsForCharacter,
	syncLorebookBindingsForPersona
} from "$lib/server/utils/characterBindingSync"
import { extractCharactersFromContent } from "$lib/server/utils/summarizer"
import {
	buildSceneCastList,
	resolveCharacterNamesToBindingIds
} from "$lib/server/utils/summarizer/availableSceneCast"
import { findDuplicateCandidates } from "$lib/server/utils/duplicateBindingDetection"
import { verifyBindingTargetAccess } from "./lorebooks"

// Resume states saved before each scene — keyed by "userId:lorebookId"
const buildResumeStates = new Map<string, GraphBuilderResumeState>()

// ─── List ─────────────────────────────────────────────────────────────────────

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

		const [
			nodes,
			relationships,
			ungraphedScenes,
			ungraphedUnsummarizedScenes,
			allSummarizedScenes,
			ungraphedDirectEntries,
			allDirectEntries
		] = await Promise.all([
			db.query.lorebookBindings.findMany({
				where: eq(schema.lorebookBindings.lorebookId, params.lorebookId),
				orderBy: asc(schema.lorebookBindings.id)
			}),
			db.query.narrativeRelationships.findMany({
				where: eq(
					schema.narrativeRelationships.lorebookId,
					params.lorebookId
				),
				orderBy: asc(schema.narrativeRelationships.id)
			}),
			// Ungraphed with summary — ready to extend
			db.query.scenes.findMany({
				where: and(
					eq(schema.scenes.lorebookId, params.lorebookId),
					eq(schema.scenes.graphed, false),
					isNotNull(schema.scenes.summary)
				),
				columns: { id: true }
			}),
			// Ungraphed without summary — need summarising first
			db.query.scenes.findMany({
				where: and(
					eq(schema.scenes.lorebookId, params.lorebookId),
					eq(schema.scenes.graphed, false),
					isNull(schema.scenes.summary)
				),
				columns: { id: true }
			}),
			// All scenes with summary — for replace-mode preflight
			db.query.scenes.findMany({
				where: and(
					eq(schema.scenes.lorebookId, params.lorebookId),
					isNotNull(schema.scenes.summary)
				),
				columns: { id: true }
			}),
			// History entries with content, no scenes, not yet graphed
			db
				.select({ id: schema.historyEntries.id })
				.from(schema.historyEntries)
				.where(
					and(
						eq(schema.historyEntries.lorebookId, params.lorebookId),
						eq(schema.historyEntries.graphed, false),
						gt(
							sql`length(trim(${schema.historyEntries.content}))`,
							0
						),
						notExists(
							db
								.select({ _: sql`1` })
								.from(schema.scenes)
								.where(
									eq(
										schema.scenes.historyEntryId,
										schema.historyEntries.id
									)
								)
						)
					)
				),
			// All history entries with content and no scenes — for replace-mode preflight
			db
				.select({ id: schema.historyEntries.id })
				.from(schema.historyEntries)
				.where(
					and(
						eq(schema.historyEntries.lorebookId, params.lorebookId),
						gt(
							sql`length(trim(${schema.historyEntries.content}))`,
							0
						),
						notExists(
							db
								.select({ _: sql`1` })
								.from(schema.scenes)
								.where(
									eq(
										schema.scenes.historyEntryId,
										schema.historyEntries.id
									)
								)
						)
					)
				)
		])

		// Bootstrap: if a graph exists but no scenes are marked as graphed yet
		// (built before tracking was introduced), silently mark all summarized
		// scenes as graphed so extend only picks up genuinely new future scenes.
		let ungraphedSceneCount = ungraphedScenes.length
		if (nodes.length > 0 && ungraphedScenes.length > 0) {
			const anyGraphed = await db.query.scenes.findFirst({
				where: and(
					eq(schema.scenes.lorebookId, params.lorebookId),
					eq(schema.scenes.graphed, true)
				),
				columns: { id: true }
			})
			if (!anyGraphed) {
				await db
					.update(schema.scenes)
					.set({ graphed: true })
					.where(
						and(
							eq(schema.scenes.lorebookId, params.lorebookId),
							isNotNull(schema.scenes.summary)
						)
					)
				ungraphedSceneCount = 0
			}
		}

		const res: Sockets.NarrativeGraph.List.Response = {
			nodes,
			relationships,
			ungraphedSceneCount,
			ungraphedUnsummarizedCount: ungraphedUnsummarizedScenes.length,
			totalSummarizedCount: allSummarizedScenes.length,
			ungraphedHistoryEntryCount: ungraphedDirectEntries.length,
			totalDirectHistoryEntryCount: allDirectEntries.length
		}
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

		const lorebook = await db.query.lorebooks.findFirst({
			where: (l, { and, eq }) =>
				and(eq(l.id, params.lorebookId), eq(l.userId, userId))
		})
		if (!lorebook) throw new Error("Lorebook not found or access denied.")

		const mode = params.mode ?? "replace"
		const resumeKey = `${userId}:${params.lorebookId}`
		const resumeState = params.resume
			? buildResumeStates.get(resumeKey)
			: undefined

		const activityId = activityStore.start({
			userId,
			lorebookId: params.lorebookId,
			lorebookLabel: lorebook.name,
			mode
		})
		const abortController = new AbortController()
		activityStore.setAbortController(activityId, abortController)

		// Fetch scenes, direct history entries, and bindings
		const [rawScenes, rawDirectEntries] = await Promise.all([
			// All scenes for this lorebook with their history entries
			db.query.scenes.findMany({
				where: eq(schema.scenes.lorebookId, params.lorebookId),
				orderBy: asc(schema.scenes.id),
				with: {
					historyEntry: {
						columns: {
							id: true,
							year: true,
							month: true,
							day: true
						}
					}
				}
			}),
			// History entries with content but no scenes (direct entries)
			db
				.select({
					id: schema.historyEntries.id,
					year: schema.historyEntries.year,
					month: schema.historyEntries.month,
					day: schema.historyEntries.day,
					content: schema.historyEntries.content,
					graphed: schema.historyEntries.graphed
				})
				.from(schema.historyEntries)
				.where(
					and(
						eq(schema.historyEntries.lorebookId, params.lorebookId),
						gt(
							sql`length(trim(${schema.historyEntries.content}))`,
							0
						),
						notExists(
							db
								.select({ _: sql`1` })
								.from(schema.scenes)
								.where(
									eq(
										schema.scenes.historyEntryId,
										schema.historyEntries.id
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
				characterNickname: schema.characters.nickname,
				personaName: schema.personas.name
			})
			.from(schema.lorebookBindings)
			.leftJoin(
				schema.characters,
				eq(schema.lorebookBindings.characterId, schema.characters.id)
			)
			.leftJoin(
				schema.personas,
				eq(schema.lorebookBindings.personaId, schema.personas.id)
			)
			.where(eq(schema.lorebookBindings.lorebookId, params.lorebookId))

		// Build substitution map: binding token → display name
		const bindingMap: Record<string, string> = {}
		for (const b of bindings) {
			if (!b.binding) continue
			const label = b.characterName
				? b.characterNickname || b.characterName
				: (b.personaName ?? b.binding)
			bindingMap[b.binding] = label
		}

		function resolveBindings(text: string): string {
			let out = text
			for (const [token, name] of Object.entries(bindingMap)) {
				out = out.replaceAll(token, name)
			}
			return out
		}

		// In extend mode, only process scenes not yet graphed
		const filteredRawScenes =
			mode === "extend"
				? (rawScenes as any[]).filter((s) => !s.graphed)
				: rawScenes

		// In extend mode, only process direct entries not yet graphed
		const filteredDirectEntries =
			mode === "extend"
				? rawDirectEntries.filter((e) => !e.graphed)
				: rawDirectEntries

		if (
			mode === "extend" &&
			filteredRawScenes.length === 0 &&
			filteredDirectEntries.length === 0
		) {
			activityStore.update(activityId, {
				status: "error",
				errorMessage:
					"No new content to process. All scenes and history entries have already been graphed."
			})
			return {
				proposal: { nodes: [], relationships: [] },
				sceneLabels: [],
				seedTempIdMap: {}
			}
		}

		const { connection, sampling, contextConfig, promptConfig } =
			await getUserConfigurations(userId)

		if (!connection) {
			throw new Error(
				"No AI connection configured. Please set up a connection first."
			)
		}

		// Direct history entries (no scene) skip scenes.ts's own
		// resolveCharacterNamesToBindingIds pre-resolution entirely — there's
		// no scenes row for them to have gone through — so graphBuilder.ts's
		// Phase 1 (a plain id lookup against already-resolved ids, per the
		// merge plan's scene character presence redesign) would otherwise
		// silently extract nobody from a scene-less lorebook. Run the same
		// extraction + resolution pass here instead, one entry at a time (in
		// chronological order, sharing one knownCast so a name introduced in
		// an earlier entry resolves consistently in a later one — matching
		// how a chat's scenes accumulate cast knowledge).
		const directEntryCharacterIds = new Map<
			number,
			{ participantCharacters: number[]; mentionedCharacters: number[] }
		>()
		if (filteredDirectEntries.length > 0) {
			const knownCast = await buildSceneCastList(
				null,
				params.lorebookId,
				null
			)
			const sortedDirectEntries = [...filteredDirectEntries].sort(
				(a, b) => {
					if (a.year !== b.year) return a.year - b.year
					if ((a.month ?? 0) !== (b.month ?? 0))
						return (a.month ?? 0) - (b.month ?? 0)
					return (a.day ?? 0) - (b.day ?? 0)
				}
			)
			for (const entry of sortedDirectEntries) {
				const extracted = await extractCharactersFromContent({
					content: resolveBindings(entry.content),
					connection,
					sampling,
					contextConfig,
					promptConfig,
					knownCast
				})
				const participantCharacters =
					await resolveCharacterNamesToBindingIds(
						extracted.participantCharacters,
						params.lorebookId,
						knownCast
					)
				const mentionedCharacters =
					await resolveCharacterNamesToBindingIds(
						extracted.mentionedCharacters,
						params.lorebookId,
						knownCast
					)
				directEntryCharacterIds.set(entry.id, {
					participantCharacters,
					mentionedCharacters
				})
			}
		}

		// Map scenes to GraphBuilderScene format with binding substitution applied
		const scenes: GraphBuilderScene[] = [
			...filteredRawScenes.map((s: any) => ({
				id: s.id,
				name: s.name,
				summary: s.summary ? resolveBindings(s.summary) : s.summary,
				historyEntryId: s.historyEntryId ?? null,
				historyEntry: s.historyEntry ?? null,
				participantCharacters: s.participantCharacters ?? null,
				mentionedCharacters: s.mentionedCharacters ?? null,
				chatId: s.chatId ?? null,
				selectedMessageIds: s.selectedMessageIds?.length
					? s.selectedMessageIds
					: null
			})),
			// Map direct history entries to GraphBuilderScene format
			...filteredDirectEntries.map((he) => ({
				id: he.id,
				name: null,
				summary: resolveBindings(he.content),
				historyEntryId: he.id,
				historyEntry: {
					id: he.id,
					year: he.year,
					month: he.month,
					day: he.day
				},
				sourceHistoryEntryId: he.id,
				participantCharacters:
					directEntryCharacterIds.get(he.id)?.participantCharacters ??
					null,
				mentionedCharacters:
					directEntryCharacterIds.get(he.id)?.mentionedCharacters ??
					null
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
				where: eq(schema.lorebookBindings.lorebookId, params.lorebookId),
				orderBy: asc(schema.lorebookBindings.id)
			})

			// Resolve character/persona sheet data as a fallback summary
			// source for rows that have never been graphed yet (empty
			// `summary` column) — matches the original replace-mode
			// bootstrap behavior for a lorebook with no graph history.
			const characterIds = allBindings
				.map((b) => b.characterId)
				.filter((id): id is number => id != null)
			const personaIds = allBindings
				.map((b) => b.personaId)
				.filter((id): id is number => id != null)
			const [characters, personas] = await Promise.all([
				characterIds.length > 0
					? db
							.select({
								id: schema.characters.id,
								name: schema.characters.name,
								nickname: schema.characters.nickname,
								description: schema.characters.description,
								summary: schema.characters.summary
							})
							.from(schema.characters)
							.where(inArray(schema.characters.id, characterIds))
					: Promise.resolve([]),
				personaIds.length > 0
					? db
							.select({
								id: schema.personas.id,
								description: schema.personas.description,
								summary: schema.personas.summary
							})
							.from(schema.personas)
							.where(inArray(schema.personas.id, personaIds))
					: Promise.resolve([])
			])
			const charMap = new Map(characters.map((c) => [c.id, c]))
			const personaMap = new Map(personas.map((p) => [p.id, p]))

			function fallbackSummary(b: (typeof allBindings)[number]): string {
				if (b.characterId) {
					const char = charMap.get(b.characterId)
					return char?.summary?.trim() || char?.description.trim() || ""
				}
				if (b.personaId) {
					const persona = personaMap.get(b.personaId)
					return (
						persona?.summary?.trim() ||
						persona?.description.trim() ||
						""
					)
				}
				return ""
			}

			// extend mode only processes ungraphed scenes (filtered above);
			// replace mode reprocesses everything — but the seed *set* is the
			// same either way, so the mode branch that used to live here is
			// gone.
			const existingRelationships =
				mode === "extend"
					? await db.query.narrativeRelationships.findMany({
							where: eq(
								schema.narrativeRelationships.lorebookId,
								params.lorebookId
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

			// Only parent (non-alias) bindings as seeds; combine binding's
			// own aliases + child names.
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
							...(b.aliases ?? []),
							...(childrenByParent.get(b.id) ?? [])
						])
					]
				})
			}
			if (seeds.length > 0) seedNodes = seeds

			seedRelationships = existingRelationships.map((r) => ({
				fromNodeId: r.fromNodeId,
				toNodeId: r.toNodeId,
				relationshipType: r.relationshipType,
				visibility: r.visibility,
				status: r.status,
				description: r.description,
				reason: r.reason
			}))
		}

		let latestSceneSnapshot: GraphBuilderResumeState | undefined

		try {
			const result = await buildGraphFromScenes({
				scenes,
				connection,
				sampling,
				contextConfig,
				promptConfig,
				seedNodes,
				seedRelationships,
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
					emitToUser("narrativeGraph:buildLog", entry)
				},
				fetchSceneMessages: async (chatId, messageIds) => {
					if (messageIds.length === 0) return []
					const msgs = await db.query.chatMessages.findMany({
						where: and(
							eq(schema.chatMessages.chatId, chatId),
							inArray(schema.chatMessages.id, messageIds),
							eq(schema.chatMessages.isHidden, false)
						),
						orderBy: asc(schema.chatMessages.id),
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
										id: schema.personas.id,
										name: schema.personas.name
									})
									.from(schema.personas)
									.where(
										inArray(schema.personas.id, personaIds)
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

			// Guard: if the user cancelled while the last LLM call was still completing,
			// the abort signal may have fired after buildGraphFromScenes returned normally.
			if (abortController.signal.aborted) {
				return {
					proposal: { nodes: [], relationships: [] },
					sceneLabels: [],
					seedTempIdMap: {}
				}
			}

			activityStore.update(activityId, {
				status: "review",
				proposal: result.proposal,
				sceneLabels: result.sceneLabels,
				seedTempIdMap: result.seedTempIdMap,
				seedNodeNames: result.seedNodeNames
			})
			return {
				proposal: result.proposal,
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
				activityStore.update(activityId, {
					status: "error",
					errorMessage: err.truncated
						? "The model ran out of response tokens before finishing the graph. Increase Max Response Tokens in your sampling config and try again."
						: err.message,
					errorRaw: err.raw
				})
				return {
					proposal: { nodes: [], relationships: [] },
					sceneLabels: [],
					seedTempIdMap: {}
				}
			}
			// Unexpected error (network failure, DB error, etc.) — show in modal rather than a generic toast
			activityStore.update(activityId, {
				status: "error",
				errorMessage:
					err instanceof Error
						? err.message
						: "An unexpected error occurred."
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
const VALID_RELATIONSHIP_VISIBILITIES = new Set<RelationshipVisibility>([
	"secret",
	"acknowledged",
	"public"
])

function capText(value: string, maxLength: number): string {
	return value.slice(0, maxLength)
}

function sanitizeNodeState(value: string | undefined | null): NodeState {
	return VALID_NODE_STATES.has(value as NodeState)
		? (value as NodeState)
		: "active"
}

function sanitizeRelationshipVisibility(
	value: string | undefined | null
): RelationshipVisibility {
	return VALID_RELATIONSHIP_VISIBILITIES.has(value as RelationshipVisibility)
		? (value as RelationshipVisibility)
		: "acknowledged"
}

export const narrativeGraphApplyProposalHandler: Handler<
	Sockets.NarrativeGraph.ApplyProposal.Params,
	Sockets.NarrativeGraph.ApplyProposal.Response
> = {
	event: "narrativeGraph:applyProposal",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const { lorebookId, proposal, mode, seedTempIdMap } = params

		const lorebook = await db.query.lorebooks.findFirst({
			where: (l, { and, eq }) =>
				and(eq(l.id, lorebookId), eq(l.userId, userId))
		})
		if (!lorebook) throw new Error("Lorebook not found or access denied.")

		// Replace mode redefinition (post-merge — see the lorebookBindings/
		// narrativeNodes merge plan): a binding IS the character's identity
		// and lore-privacy anchor now, so wholesale delete-and-rebuild would
		// destroy real character relationships, not just graph-derived
		// state. A rebuild NEVER deletes a lorebookBindings row, full stop —
		// every row (bound or ghost) gets its graph-enrichment fields RESET
		// to defaults instead. This isn't just conservative: bindingMergeLogs
		// references node ids as plain JSON integers with no real FK
		// protection (aside from survivorId's onDelete: "set null"), so a
		// prior "delete true ghosts" behavior could silently break
		// narrativeGraphUndoMergeHandler two ways — a deleted relationship
		// endpoint left relationshipRewrites/deletedRelationships dangling
		// (no-op or FK-violation on undo), and a deleted past merge
		// *survivor* silently nulled survivorId, permanently disabling that
		// merge's undo with no visible error until someone tried it. Manual
		// per-node deletion is still available via
		// narrativeGraphDeleteNodeHandler for a user who actually wants a
		// ghost row gone. Relationships are always safe to wipe wholesale
		// (no external referents once Change 2 below clears the merge logs
		// that used to reference them).
		if (mode === "replace") {
			await db
				.delete(schema.narrativeRelationships)
				.where(eq(schema.narrativeRelationships.lorebookId, lorebookId))

			// The relationship layer above is being fully replaced with
			// whatever this rebuild derives — so any prior merge log's
			// relationship-scoped fields (which reference narrativeRelationships
			// rows that no longer exist) are now obsolete by construction, not
			// just stale. Clearing them to [] makes undo a well-defined
			// identity-only restore afterward (no relationship edges) instead
			// of best-effort/crash-prone — both restore loops in
			// narrativeGraphUndoMergeHandler are plain array iterations with
			// no SQL involved, so an empty array is a clean no-op there.
			await db
				.update(schema.bindingMergeLogs)
				.set({ relationshipRewrites: [], deletedRelationships: [] })
				.where(eq(schema.bindingMergeLogs.lorebookId, lorebookId))

			await db
				.update(schema.lorebookBindings)
				.set({
					nodeState: "active",
					nodeVisibility: "normal",
					summary: null,
					parentNodeId: null,
					sceneId: null,
					historyEntryId: null,
					embedding: null,
					embeddingModel: null,
					vectorizedAt: null
				})
				.where(eq(schema.lorebookBindings.lorebookId, lorebookId))
		}

		// Insert nodes and build tempId → real id map
		// Seed with existing node mappings so relationships can reference them
		const tempIdMap = new Map<string, number>(
			seedTempIdMap
				? Object.entries(seedTempIdMap).map(([k, v]) => [k, v])
				: []
		)

		// seedTempIdMap is client-supplied — without this check, a relationship
		// below could be pointed at a real node id belonging to a DIFFERENT
		// user's lorebook just by supplying that id here, since fromId/toId
		// come straight out of this map with no further verification at
		// insert time.
		if (tempIdMap.size > 0) {
			const seededIds = [...new Set(tempIdMap.values())]
			const seededNodes = await db.query.lorebookBindings.findMany({
				where: (n, { inArray }) => inArray(n.id, seededIds),
				columns: { id: true, lorebookId: true }
			})
			if (
				seededNodes.length !== seededIds.length ||
				seededNodes.some((n) => n.lorebookId !== lorebookId)
			) {
				throw new Error(
					"Access denied: seed node ids must belong to this lorebook."
				)
			}
		}

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
			const historyEntriesFound = await db.query.historyEntries.findMany({
				where: (h, { inArray }) => inArray(h.id, historyEntryIds),
				columns: { id: true, lorebookId: true }
			})
			if (
				historyEntriesFound.length !== historyEntryIds.length ||
				historyEntriesFound.some((h) => h.lorebookId !== lorebookId)
			) {
				throw new Error(
					"Access denied: referenced history entry ids must belong to this lorebook."
				)
			}
		}

		// Everything below builds/updates the graph for this lorebook in one
		// pass — wrapped in a transaction so a crash or thrown error partway
		// through (e.g. after some nodes are inserted but before their
		// relationships are) can't leave a half-applied graph.
		await db.transaction(async (tx) => {
			// proposal.nodes only ever contains genuinely new discoveries —
			// buildGraphFromScenes filters to newNodeTempIds, which no seed
			// (bound or background) is ever added to post-merge. So every
			// entry here is a brand-new unbound/NPC lorebookBindings row —
			// there's no more "was this a binding-derived seed?" branch to
			// re-link afterward.
			for (const nodeProposal of proposal.nodes) {
				const token = await deriveNextBindingToken(lorebookId, tx)
				const [inserted] = await tx
					.insert(schema.lorebookBindings)
					.values({
						lorebookId,
						characterId: null,
						personaId: null,
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

			// Insert (or update) relationships
			for (const rel of proposal.relationships) {
				const fromId = tempIdMap.get(rel.fromTempId)
				const toId = tempIdMap.get(rel.toTempId)
				if (!fromId || !toId) continue

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
					const existing =
						await tx.query.narrativeRelationships.findFirst({
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
								)
							)
						})

					if (existing) {
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
								visibility: sanitizeRelationshipVisibility(
									rel.visibility ?? existing.visibility
								),
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
					visibility: sanitizeRelationshipVisibility(rel.visibility),
					status: rel.status ?? "active",
					reason: rel.reason
						? capText(rel.reason, MAX_NODE_TEXT_LENGTH)
						: null,
					sceneId: rel.sceneId ?? null,
					historyEntryId: rel.historyEntryId ?? null
				})
			}

			// Mark scenes as graphed — entirely server-side, no client round-trip needed.
			// Replace: reset all scenes for this lorebook, then mark all summarized scenes as graphed.
			// Extend: mark all currently-ungraphed summarized scenes as graphed (those were the ones processed).
			if (mode === "replace") {
				await tx
					.update(schema.scenes)
					.set({ graphed: false })
					.where(eq(schema.scenes.lorebookId, lorebookId))
				// Reset history entries graphed status too
				await tx
					.update(schema.historyEntries)
					.set({ graphed: false })
					.where(eq(schema.historyEntries.lorebookId, lorebookId))
			}
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
			// Mark direct history entries (with content, no scenes) as graphed
			await tx
				.update(schema.historyEntries)
				.set({ graphed: true })
				.where(
					and(
						eq(schema.historyEntries.lorebookId, lorebookId),
						gt(
							sql`length(trim(${schema.historyEntries.content}))`,
							0
						),
						notExists(
							tx
								.select({ _: sql`1` })
								.from(schema.scenes)
								.where(
									eq(
										schema.scenes.historyEntryId,
										schema.historyEntries.id
									)
								)
						)
					)
				)
		})

		// Return updated list with fresh ungraphed count
		const [
			nodes,
			relationships,
			ungraphedScenes,
			ungraphedUnsummarized,
			allSummarized,
			ungraphedDirectEntries,
			allDirectEntries
		] = await Promise.all([
			db.query.lorebookBindings.findMany({
				where: eq(schema.lorebookBindings.lorebookId, lorebookId),
				orderBy: asc(schema.lorebookBindings.id)
			}),
			db.query.narrativeRelationships.findMany({
				where: eq(schema.narrativeRelationships.lorebookId, lorebookId),
				orderBy: asc(schema.narrativeRelationships.id)
			}),
			db.query.scenes.findMany({
				where: and(
					eq(schema.scenes.lorebookId, lorebookId),
					eq(schema.scenes.graphed, false),
					isNotNull(schema.scenes.summary)
				),
				columns: { id: true }
			}),
			db.query.scenes.findMany({
				where: and(
					eq(schema.scenes.lorebookId, lorebookId),
					eq(schema.scenes.graphed, false),
					isNull(schema.scenes.summary)
				),
				columns: { id: true }
			}),
			db.query.scenes.findMany({
				where: and(
					eq(schema.scenes.lorebookId, lorebookId),
					isNotNull(schema.scenes.summary)
				),
				columns: { id: true }
			}),
			db
				.select({ id: schema.historyEntries.id })
				.from(schema.historyEntries)
				.where(
					and(
						eq(schema.historyEntries.lorebookId, lorebookId),
						eq(schema.historyEntries.graphed, false),
						gt(
							sql`length(trim(${schema.historyEntries.content}))`,
							0
						),
						notExists(
							db
								.select({ _: sql`1` })
								.from(schema.scenes)
								.where(
									eq(
										schema.scenes.historyEntryId,
										schema.historyEntries.id
									)
								)
						)
					)
				),
			db
				.select({ id: schema.historyEntries.id })
				.from(schema.historyEntries)
				.where(
					and(
						eq(schema.historyEntries.lorebookId, lorebookId),
						gt(
							sql`length(trim(${schema.historyEntries.content}))`,
							0
						),
						notExists(
							db
								.select({ _: sql`1` })
								.from(schema.scenes)
								.where(
									eq(
										schema.scenes.historyEntryId,
										schema.historyEntries.id
									)
								)
						)
					)
				)
		])

		const listPayload: Sockets.NarrativeGraph.List.Response = {
			nodes,
			relationships,
			ungraphedSceneCount: ungraphedScenes.length,
			ungraphedUnsummarizedCount: ungraphedUnsummarized.length,
			totalSummarizedCount: allSummarized.length,
			ungraphedHistoryEntryCount: ungraphedDirectEntries.length,
			totalDirectHistoryEntryCount: allDirectEntries.length
		}
		const res: Sockets.NarrativeGraph.ApplyProposal.Response = {
			nodes,
			relationships
		}
		emitToUser("narrativeGraph:list", listPayload)
		emitToUser("narrativeGraph:applyProposal", res)

		// Proactive duplicate review — surface likely-duplicate pairs right
		// after a build/extend completes, not just on the next time someone
		// happens to open the Bindings tab.
		const candidates = await findDuplicateCandidates(lorebookId)
		emitToUser("narrativeGraph:duplicateCandidates", {
			lorebookId,
			candidates
		} satisfies Sockets.NarrativeGraph.DuplicateCandidates.Response)

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
				const parent = await db.query.lorebookBindings.findFirst({
					where: eq(schema.lorebookBindings.id, n.parentNodeId)
				})
				if (!parent || parent.lorebookId !== existing.lorebookId) {
					throw new Error("Parent node not found.")
				}
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
				const historyEntry = await db.query.historyEntries.findFirst({
					where: eq(schema.historyEntries.id, n.historyEntryId)
				})
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
		// lorebook and nulls any characterLoreEntries that referenced it
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

		await db.transaction(async (tx) => {
			// scenes.participantCharacters/mentionedCharacters are plain JSON
			// int arrays, not a real FK — without this, deleting a node
			// referenced there leaves a permanent dangling id (unlike the
			// merge/absorb handler, which already does this rewrite before its
			// own delete). No survivor to remap to here, unlike merge — just
			// remove the id.
			const referencingScenes = await tx.query.scenes.findMany({
				where: eq(schema.scenes.lorebookId, existing.lorebookId)
			})
			for (const scene of referencingScenes) {
				const participants = scene.participantCharacters ?? []
				const mentioned = scene.mentionedCharacters ?? []
				if (
					!participants.includes(params.id) &&
					!mentioned.includes(params.id)
				) {
					continue
				}
				await tx
					.update(schema.scenes)
					.set({
						participantCharacters: participants.filter(
							(id) => id !== params.id
						),
						mentionedCharacters: mentioned.filter(
							(id) => id !== params.id
						)
					})
					.where(eq(schema.scenes.id, scene.id))
			}

			await tx
				.delete(schema.lorebookBindings)
				.where(eq(schema.lorebookBindings.id, params.id))
		})

		const res = { success: "Node deleted." }
		emitToUser("narrativeGraph:deleteNode", res)
		return res
	}
}

/**
 * Read-only pre-check for narrativeGraph:deleteNode's confirmation UI.
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

		const res: Sockets.NarrativeGraph.CheckNodeMergeReferences.Response = {
			referencedByMergeLog: referenced
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
		// client rewrite fromNodeId/toNodeId/lorebookId to point anywhere,
		// unlike createRelationship, which validates new endpoints. Never
		// writable here: fromNodeId, toNodeId, lorebookId, embedding,
		// embeddingModel.
		const fields: Partial<
			typeof schema.narrativeRelationships.$inferInsert
		> = {}
		const r = params.relationship

		if (r.relationshipType !== undefined)
			fields.relationshipType = r.relationshipType
		if (r.description !== undefined) fields.description = r.description
		if (r.reason !== undefined) fields.reason = r.reason
		if (r.status !== undefined) fields.status = r.status
		if (r.visibility !== undefined)
			fields.visibility = r.visibility as RelationshipVisibility

		// historyEntryId/sceneId are FKs — must stay scoped to this
		// relationship's own lorebook, same reasoning as updateNode.
		if (r.historyEntryId !== undefined) {
			if (r.historyEntryId === null) {
				fields.historyEntryId = null
			} else {
				const historyEntry = await db.query.historyEntries.findFirst({
					where: eq(schema.historyEntries.id, r.historyEntryId)
				})
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
			relationship: updated
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

		const res = { success: "Relationship deleted." }
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
			fromNodeId,
			toNodeId,
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

		const [fromNode, toNode] = await Promise.all([
			db.query.lorebookBindings.findFirst({
				where: eq(schema.lorebookBindings.id, fromNodeId)
			}),
			db.query.lorebookBindings.findFirst({
				where: eq(schema.lorebookBindings.id, toNodeId)
			})
		])
		if (!fromNode || fromNode.lorebookId !== lorebookId)
			throw new Error("From-node not found.")
		if (!toNode || toNode.lorebookId !== lorebookId)
			throw new Error("To-node not found.")

		if (historyEntryId != null) {
			const historyEntry = await db.query.historyEntries.findFirst({
				where: eq(schema.historyEntries.id, historyEntryId)
			})
			if (!historyEntry || historyEntry.lorebookId !== lorebookId) {
				throw new Error("History entry not found.")
			}
		}

		const [inserted] = await db
			.insert(schema.narrativeRelationships)
			.values({
				lorebookId,
				fromNodeId,
				toNodeId,
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
			relationship: inserted
		}
		emitToUser("narrativeGraph:createRelationship", res)
		return res
	}
}

// ─── Create node (manual) ─────────────────────────────────────────────────────

export const narrativeGraphCreateNodeHandler: Handler<
	Sockets.NarrativeGraph.CreateNode.Params,
	Sockets.NarrativeGraph.CreateNode.Response
> = {
	event: "narrativeGraph:createNode",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const {
			lorebookId,
			name,
			nodeState,
			nodeVisibility,
			summary,
			historyEntryId
		} = params

		const lorebook = await db.query.lorebooks.findFirst({
			where: (l, { and, eq }) =>
				and(eq(l.id, lorebookId), eq(l.userId, userId))
		})
		if (!lorebook) throw new Error("Lorebook not found or access denied.")

		// Without this, a client-supplied historyEntryId could belong to a
		// different user's lorebook — same check updateNode already requires
		// for this exact field.
		if (historyEntryId != null) {
			const historyEntry = await db.query.historyEntries.findFirst({
				where: eq(schema.historyEntries.id, historyEntryId)
			})
			if (!historyEntry || historyEntry.lorebookId !== lorebookId) {
				throw new Error("History entry not found.")
			}
		}

		// Creates an unbound lorebookBindings row (characterId/personaId
		// null) — this handler's ongoing necessity is superseded by the UI
		// consolidation (LorebookBindingsManager gains this "background
		// character" flow directly), but is kept working here in the
		// meantime. Token derived from the lorebook's own per-lorebook
		// counter (decision 1).
		const [node] = await db.transaction(async (tx) => {
			const token = await deriveNextBindingToken(lorebookId, tx)
			return tx
				.insert(schema.lorebookBindings)
				.values({
					lorebookId,
					characterId: null,
					personaId: null,
					binding: token,
					name,
					nodeState: (nodeState ?? "active") as NodeState,
					nodeVisibility: (nodeVisibility ?? "normal") as NodeVisibility,
					summary: summary ?? null,
					historyEntryId: historyEntryId ?? null
				})
				.returning()
		})

		const res: Sockets.NarrativeGraph.CreateNode.Response = { node }
		emitToUser("narrativeGraph:createNode", res)
		return res
	}
}

// ─── Query context (three-layer injection) ────────────────────────────────────

export const narrativeGraphQueryContextHandler: Handler<
	Sockets.NarrativeGraph.QueryContext.Params,
	Sockets.NarrativeGraph.QueryContext.Response
> = {
	event: "narrativeGraph:queryContext",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const { lorebookId, chatId, speakerCharacterId, speakerPersonaId } =
			params

		const lorebook = await db.query.lorebooks.findFirst({
			where: (l, { and, eq }) =>
				and(eq(l.id, lorebookId), eq(l.userId, userId))
		})
		if (!lorebook) throw new Error("Lorebook not found or access denied.")

		// Resolve speaker's root node — the binding IS the node now, so this
		// is a single lookup, not binding-then-separately-find-its-node.
		let speakerNodeId: number | null = null
		if (speakerCharacterId || speakerPersonaId) {
			const binding = await db.query.lorebookBindings.findFirst({
				where: and(
					eq(schema.lorebookBindings.lorebookId, lorebookId),
					speakerCharacterId
						? eq(
								schema.lorebookBindings.characterId,
								speakerCharacterId
							)
						: eq(
								schema.lorebookBindings.personaId,
								speakerPersonaId!
							)
				),
				columns: { id: true }
			})
			speakerNodeId = binding?.id ?? null
		}

		const res: Sockets.NarrativeGraph.QueryContext.Response = {
			speakerRelationships: [],
			inverseRelationships: [],
			legendaryNodes: []
		}

		if (!speakerNodeId) {
			emitToUser("narrativeGraph:queryContext", res)
			return res
		}

		// Helper: resolve node name+state by id from a pre-fetched map
		async function fetchNodeMap(nodeIds: number[]) {
			if (nodeIds.length === 0)
				return new Map<
					number,
					{ name: string; nodeState: string; nodeVisibility: string }
				>()
			const nodes = await db.query.lorebookBindings.findMany({
				where: inArray(schema.lorebookBindings.id, nodeIds),
				columns: {
					id: true,
					name: true,
					nodeState: true,
					nodeVisibility: true
				}
			})
			return new Map(
				nodes.map((n) => [
					n.id,
					{
						name: n.name,
						nodeState: n.nodeState,
						nodeVisibility: n.nodeVisibility
					}
				])
			)
		}

		function relEntry(
			r: {
				fromNodeId: number
				toNodeId: number
				relationshipType: string
				description: string
				visibility: string
			},
			nodeMap: Map<
				number,
				{ name: string; nodeState: string; nodeVisibility: string }
			>
		): Sockets.NarrativeGraph.QueryContext.RelationshipEntry {
			const from = nodeMap.get(r.fromNodeId)
			const to = nodeMap.get(r.toNodeId)
			return {
				fromNodeId: r.fromNodeId,
				fromNodeName: from?.name ?? "",
				fromNodeState: from?.nodeState ?? "active",
				toNodeId: r.toNodeId,
				toNodeName: to?.name ?? "",
				toNodeState: to?.nodeState ?? "active",
				relationshipType: r.relationshipType,
				description: r.description,
				visibility: r.visibility
			}
		}

		// ── Layer 1: speaker's outbound relationships ─────────────────────────────
		const speakerRels = await db.query.narrativeRelationships.findMany({
			where: and(
				eq(schema.narrativeRelationships.lorebookId, lorebookId),
				eq(schema.narrativeRelationships.fromNodeId, speakerNodeId)
			)
		})

		const l1NodeIds = [
			...new Set([
				...speakerRels.map((r) => r.fromNodeId),
				...speakerRels.map((r) => r.toNodeId)
			])
		]
		const l1NodeMap = await fetchNodeMap(l1NodeIds)

		res.speakerRelationships = speakerRels
			.filter(
				(r) => l1NodeMap.get(r.toNodeId)?.nodeVisibility !== "hidden"
			)
			.map((r) => relEntry(r, l1NodeMap))

		// ── Layer 2: inverse rels from chat participants → speaker (acknowledged/public only) ──
		const [chatChars, chatPersonas] = await Promise.all([
			db.query.chatCharacters.findMany({
				where: and(
					eq(schema.chatCharacters.chatId, chatId),
					isNull(schema.chatCharacters.removedAt)
				),
				columns: { characterId: true }
			}),
			db.query.chatPersonas.findMany({
				where: and(
					eq(schema.chatPersonas.chatId, chatId),
					isNull(schema.chatPersonas.removedAt)
				),
				columns: { personaId: true }
			})
		])

		const chatCharIds = chatChars
			.map((c) => c.characterId)
			.filter(
				(id): id is number => id !== null && id !== speakerCharacterId
			)
		const chatPersonaIds = chatPersonas
			.map((p) => p.personaId)
			.filter(
				(id): id is number =>
					id !== null && id !== (speakerPersonaId ?? -1)
			)

		if (chatCharIds.length > 0 || chatPersonaIds.length > 0) {
			const participantBindings =
				await db.query.lorebookBindings.findMany({
					where: and(
						eq(schema.lorebookBindings.lorebookId, lorebookId),
						sql`(
						${
							chatCharIds.length > 0
								? sql`${schema.lorebookBindings.characterId} IN (${sql.join(
										chatCharIds.map((id) => sql`${id}`),
										sql`, `
									)})`
								: sql`false`
						}
						OR
						${
							chatPersonaIds.length > 0
								? sql`${schema.lorebookBindings.personaId} IN (${sql.join(
										chatPersonaIds.map((id) => sql`${id}`),
										sql`, `
									)})`
								: sql`false`
						}
					)`
					),
					columns: { id: true }
				})

			// A participant's binding IS their node — no separate lookup
			// needed (post-merge simplification, see the merge plan).
			const participantNodeIds = participantBindings
				.map((b) => b.id)
				.filter((id) => id !== speakerNodeId)

			if (participantNodeIds.length > 0) {
				const inverseRels =
					await db.query.narrativeRelationships.findMany({
						where: and(
							eq(
								schema.narrativeRelationships.lorebookId,
								lorebookId
							),
							eq(
								schema.narrativeRelationships.toNodeId,
								speakerNodeId
							),
							inArray(
								schema.narrativeRelationships.fromNodeId,
								participantNodeIds
							),
							inArray(schema.narrativeRelationships.visibility, [
								"acknowledged",
								"public"
							] as RelationshipVisibility[])
						)
					})

				const l2NodeIds = [
					...new Set([
						...inverseRels.map((r) => r.fromNodeId),
						...inverseRels.map((r) => r.toNodeId)
					])
				]
				const l2NodeMap = await fetchNodeMap(l2NodeIds)
				res.inverseRelationships = inverseRels.map((r) =>
					relEntry(r, l2NodeMap)
				)
			}
		}

		// ── Layer 3: legendary nodes (nodeVisibility="legendary") + public rels ──
		const legendaryNodes = await db.query.lorebookBindings.findMany({
			where: and(
				eq(schema.lorebookBindings.lorebookId, lorebookId),
				eq(
					schema.lorebookBindings.nodeVisibility,
					"legendary" as NodeVisibility
				)
			),
			orderBy: desc(schema.lorebookBindings.updatedAt),
			limit: 5
		})

		for (const node of legendaryNodes) {
			const publicRels = await db.query.narrativeRelationships.findMany({
				where: and(
					eq(schema.narrativeRelationships.lorebookId, lorebookId),
					eq(schema.narrativeRelationships.fromNodeId, node.id),
					eq(
						schema.narrativeRelationships.visibility,
						"public" as RelationshipVisibility
					)
				)
			})

			const l3NodeIds = [
				...new Set([
					...publicRels.map((r) => r.fromNodeId),
					...publicRels.map((r) => r.toNodeId)
				])
			]
			const l3NodeMap = await fetchNodeMap(l3NodeIds)
			l3NodeMap.set(node.id, {
				name: node.name,
				nodeState: node.nodeState,
				nodeVisibility: "legendary"
			})

			res.legendaryNodes.push({
				nodeId: node.id,
				nodeName: node.name,
				summary: node.summary,
				publicRelationships: publicRels.map((r) =>
					relEntry(r, l3NodeMap)
				)
			})
		}

		emitToUser("narrativeGraph:queryContext", res)
		return res
	}
}

// narrativeGraphLinkBindingNodeHandler is gone — its entire purpose was
// reconciling two independently-created rows (a binding and a node) that
// might not know about each other. That state can't exist once binding IS
// the row (see the lorebookBindings/narrativeNodes merge plan).
// NodeLinkerModal.svelte (its UI) is deleted alongside it.

// ─── Link orphaned binding to character/persona ───────────────────────────────

export const narrativeGraphLinkOrphanBindingHandler: Handler<
	Sockets.NarrativeGraph.LinkOrphanBinding.Params,
	Sockets.NarrativeGraph.LinkOrphanBinding.Response
> = {
	event: "narrativeGraph:linkOrphanBinding",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const { bindingId, characterId, personaId, skip } = params

		const binding = await db.query.lorebookBindings.findFirst({
			where: eq(schema.lorebookBindings.id, bindingId)
		})
		if (!binding) throw new Error("Binding not found.")
		const lorebookForOrphan = await db.query.lorebooks.findFirst({
			where: and(
				eq(schema.lorebooks.id, binding.lorebookId),
				eq(schema.lorebooks.userId, userId)
			)
		})
		if (!lorebookForOrphan) throw new Error("Access denied.")

		if (!skip && (characterId || personaId)) {
			// Without this, an attacker could link an orphaned/self-created
			// binding to a guessed characterId/personaId belonging to a user
			// who never shared it with them at all — syncLorebookBindingsFor*
			// below would then immediately copy that victim's private
			// name/nickname/aliases onto the attacker's own binding. Mirrors
			// the exact check lorebooks.ts's createLorebookBindingHandler/
			// updateLorebookBindingHandler already require before accepting
			// either field.
			if (
				!(await verifyBindingTargetAccess(
					{ characterId, personaId },
					userId
				))
			) {
				throw new Error("Access denied.")
			}

			await db
				.update(schema.lorebookBindings)
				.set({
					characterId: characterId ?? null,
					personaId: personaId ?? null
				})
				.where(eq(schema.lorebookBindings.id, bindingId))

			// Attach-time sync (decision 2) — pull in the newly-attached
			// entity's name/aliases immediately rather than waiting for an
			// unrelated future edit to it.
			if (characterId) {
				await syncLorebookBindingsForCharacter(characterId)
			} else if (personaId) {
				await syncLorebookBindingsForPersona(personaId)
			}
		}

		const res: Sockets.NarrativeGraph.LinkOrphanBinding.Response = {
			success: true
		}
		emitToUser("narrativeGraph:linkOrphanBinding", res)
		return res
	}
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
		const childIsBound = child.characterId != null || child.personaId != null
		const parentIsBound =
			parent.characterId != null || parent.personaId != null
		if (childIsBound && parentIsBound) {
			throw new Error(
				"Cannot absorb two nodes that are both linked to character bindings — they represent distinct individuals."
			)
		}

		// Auto-swap: the bound row always survives, so characterId/personaId
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
				oldFromNodeId: number
				oldToNodeId: number
			}[] = []
			const deletedRelationships: Record<string, unknown>[] = []

			for (const rel of affectedRels) {
				const newFromNodeId =
					rel.fromNodeId === absorbedId ? survivorId : rel.fromNodeId
				const newToNodeId =
					rel.toNodeId === absorbedId ? survivorId : rel.toNodeId

				// Self-loop: the single most common case this feature exists
				// for (two rows turning out to be the same person) very
				// plausibly already has a relationship *between them* —
				// rewriting both endpoints to the survivor's id would leave
				// a relationship from someone to themselves.
				if (newFromNodeId === newToNodeId) {
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

				const duplicate = survivorRels.find(
					(r) =>
						r.id !== rel.id &&
						r.fromNodeId === newFromNodeId &&
						r.toNodeId === newToNodeId &&
						r.relationshipType === rel.relationshipType
				)
				if (duplicate) {
					// Keep whichever is more complete/recent; delete the other.
					const relIsBetter =
						rel.description.length > duplicate.description.length ||
						(rel.description.length === duplicate.description.length &&
							(rel.historyEntryId ?? 0) >
								(duplicate.historyEntryId ?? 0))
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
							.where(
								eq(schema.narrativeRelationships.id, rel.id)
							)
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

			// 3. Rewrite scenes.participantCharacters/mentionedCharacters —
			// not a real FK (json columns storing bare ids), so these would
			// otherwise dangle once the absorbed row is deleted.
			const lorebookScenes = await tx.query.scenes.findMany({
				where: eq(schema.scenes.lorebookId, lorebook.id)
			})
			const sceneSnapshots: {
				sceneId: number
				participantCharacters: number[]
				mentionedCharacters: number[]
			}[] = []
			for (const scene of lorebookScenes) {
				const participants = scene.participantCharacters ?? []
				const mentioned = scene.mentionedCharacters ?? []
				if (
					!participants.includes(absorbedId) &&
					!mentioned.includes(absorbedId)
				)
					continue

				sceneSnapshots.push({
					sceneId: scene.id,
					participantCharacters: participants,
					mentionedCharacters: mentioned
				})

				await tx
					.update(schema.scenes)
					.set({
						participantCharacters: [
							...new Set(
								participants.map((id) =>
									id === absorbedId ? survivorId : id
								)
							)
						],
						mentionedCharacters: [
							...new Set(
								mentioned.map((id) =>
									id === absorbedId ? survivorId : id
								)
							)
						]
					})
					.where(eq(schema.scenes.id, scene.id))
			}

			// 4. Reassign character-lore entries (onDelete: "set null" —
			// without this, private lore attached to the absorbed row goes
			// permanently unbound/invisible the moment it's deleted).
			const reassignedLoreEntries =
				await tx.query.characterLoreEntries.findMany({
					where: eq(
						schema.characterLoreEntries.lorebookBindingId,
						absorbedId
					),
					columns: { id: true }
				})
			const reassignedCharacterLoreEntryIds = reassignedLoreEntries.map(
				(e) => e.id
			)
			if (reassignedCharacterLoreEntryIds.length > 0) {
				await tx
					.update(schema.characterLoreEntries)
					.set({ lorebookBindingId: survivorId })
					.where(
						inArray(
							schema.characterLoreEntries.id,
							reassignedCharacterLoreEntryIds
						)
					)
			}

			// 4.5. Reassign child nodes (onDelete: "set null" on parentNodeId —
			// without this, any alias-children of the absorbed row would be
			// silently orphaned the moment it's deleted, and undo would have
			// no record to restore the link from).
			const reassignedChildNodes = await tx.query.lorebookBindings.findMany(
				{
					where: eq(schema.lorebookBindings.parentNodeId, absorbedId),
					columns: { id: true }
				}
			)
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
						survivor.historyEntryId ?? absorbed.historyEntryId ?? null
				})
				.where(eq(schema.lorebookBindings.id, survivorId))

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
		// the now-deleted absorbed id would otherwise dangle in the UI.
		const candidates = await findDuplicateCandidates(lorebook.id)
		emitToUser("narrativeGraph:duplicateCandidates", {
			lorebookId: lorebook.id,
			candidates
		} satisfies Sockets.NarrativeGraph.DuplicateCandidates.Response)

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

		const restoredNode = await db.transaction(async (tx) => {
			const snapshot = log.absorbedSnapshot as Record<string, unknown>
			const oldAbsorbedId = snapshot.id as number
			const {
				id: _oldId,
				createdAt: snapshotCreatedAt,
				updatedAt: _oldUpdatedAt,
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

			const remapId = (id: number) =>
				id === oldAbsorbedId ? inserted.id : id

			// Restore relationships still standing (rewritten, not deleted)
			// back to their original endpoints.
			const deletedIds = new Set(
				(
					log.deletedRelationships as Record<string, unknown>[]
				).map((r) => r.id as number)
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
			for (const deletedRel of log.deletedRelationships as Record<
				string,
				unknown
			>[]) {
				const {
					id: _oldRelId,
					createdAt: relCreatedAt,
					updatedAt: _relUpdatedAt,
					...relRest
				} = deletedRel
				await tx.insert(schema.narrativeRelationships).values({
					...(relRest as typeof schema.narrativeRelationships.$inferInsert),
					fromNodeId: remapId(
						relRest.fromNodeId as number
					),
					toNodeId: remapId(relRest.toNodeId as number),
					createdAt: relCreatedAt
						? new Date(relCreatedAt as string)
						: new Date()
				})
			}

			// Restore scene participant/mentioned arrays to their recorded
			// pre-merge values (remapped onto the recreated row's new id).
			for (const sceneSnap of log.sceneSnapshots) {
				await tx
					.update(schema.scenes)
					.set({
						participantCharacters:
							sceneSnap.participantCharacters.map(remapId),
						mentionedCharacters:
							sceneSnap.mentionedCharacters.map(remapId)
					})
					.where(eq(schema.scenes.id, sceneSnap.sceneId))
			}

			// Move reassigned character-lore entries back to the recreated row.
			if (log.reassignedCharacterLoreEntryIds.length > 0) {
				await tx
					.update(schema.characterLoreEntries)
					.set({ lorebookBindingId: inserted.id })
					.where(
						inArray(
							schema.characterLoreEntries.id,
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

			return inserted
		})

		const res: Sockets.NarrativeGraph.UndoMerge.Response = {
			restoredNode
		}
		emitToUser("narrativeGraph:undoMerge", res)

		const candidates = await findDuplicateCandidates(log.lorebookId)
		emitToUser("narrativeGraph:duplicateCandidates", {
			lorebookId: log.lorebookId,
			candidates
		} satisfies Sockets.NarrativeGraph.DuplicateCandidates.Response)

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
				absorbedName:
					(log.absorbedSnapshot as Record<string, unknown>)
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

		const candidates = await findDuplicateCandidates(lorebookId)
		const res: Sockets.NarrativeGraph.DuplicateCandidates.Response = {
			lorebookId,
			candidates
		}
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

		const candidates = await findDuplicateCandidates(lorebookId)
		const res: Sockets.NarrativeGraph.DismissDuplicate.Response = {
			lorebookId,
			candidates
		}
		emitToUser("narrativeGraph:duplicateCandidates", res)
		return res
	}
}

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
	register(
		socket,
		narrativeGraphCheckNodeMergeReferencesHandler,
		emitToUser
	)
	register(socket, narrativeGraphUpdateRelationshipHandler, emitToUser)
	register(socket, narrativeGraphDeleteRelationshipHandler, emitToUser)
	register(socket, narrativeGraphCreateRelationshipHandler, emitToUser)
	register(socket, narrativeGraphCreateNodeHandler, emitToUser)
	register(socket, narrativeGraphQueryContextHandler, emitToUser)
	register(socket, narrativeGraphLinkOrphanBindingHandler, emitToUser)
	register(socket, narrativeGraphMergeNodeHandler, emitToUser)
	register(socket, narrativeGraphUndoMergeHandler, emitToUser)
	register(socket, narrativeGraphListMergeLogsHandler, emitToUser)
	register(socket, narrativeGraphDuplicateCandidatesHandler, emitToUser)
	register(socket, narrativeGraphDismissDuplicateHandler, emitToUser)
}
