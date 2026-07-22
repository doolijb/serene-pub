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
			db.query.narrativeNodes.findMany({
				where: eq(schema.narrativeNodes.lorebookId, params.lorebookId),
				orderBy: asc(schema.narrativeNodes.id)
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
				sourceHistoryEntryId: he.id
			}))
		]

		const { connection, sampling, contextConfig, promptConfig } =
			await getUserConfigurations(userId)

		if (!connection) {
			throw new Error(
				"No AI connection configured. Please set up a connection first."
			)
		}

		// Load seed nodes and relationships for LLM context
		let seedNodes: GraphBuilderSeedNode[] | undefined
		let seedRelationships: GraphBuilderSeedRelationship[] | undefined
		if (mode === "extend") {
			const [allNodes, existingRelationships] = await Promise.all([
				db.query.narrativeNodes.findMany({
					where: eq(
						schema.narrativeNodes.lorebookId,
						params.lorebookId
					),
					orderBy: asc(schema.narrativeNodes.id)
				}),
				db.query.narrativeRelationships.findMany({
					where: eq(
						schema.narrativeRelationships.lorebookId,
						params.lorebookId
					),
					orderBy: asc(schema.narrativeRelationships.id)
				})
			])
			// Build alias name map: non-hidden alias-child names per parent
			const childrenByParent = new Map<number, string[]>()
			for (const n of allNodes) {
				if (n.parentNodeId !== null && n.nodeVisibility !== "hidden") {
					const list = childrenByParent.get(n.parentNodeId) ?? []
					list.push(n.name)
					childrenByParent.set(n.parentNodeId, list)
				}
			}
			// Only parent (non-alias) nodes as seeds; combine node's own aliases + child names
			seedNodes = allNodes
				.filter((n) => n.parentNodeId === null)
				.map((n) => ({
					id: n.id,
					name: n.name,
					nodeState: n.nodeState,
					summary: n.summary,
					aliases: [
						...new Set([
							...(n.aliases ?? []),
							...(childrenByParent.get(n.id) ?? [])
						])
					]
				}))
			seedRelationships = existingRelationships.map((r) => ({
				fromNodeId: r.fromNodeId,
				toNodeId: r.toNodeId,
				relationshipType: r.relationshipType,
				visibility: r.visibility,
				status: r.status,
				description: r.description,
				reason: r.reason
			}))
		} else {
			// Replace mode: seed LLM with names from all lorebook bindings (characters + personas).
			// All existing nodes are deleted and rebuilt fresh — bindings are re-linked after insertion.
			const bindings = await db.query.lorebookBindings.findMany({
				where: eq(
					schema.lorebookBindings.lorebookId,
					params.lorebookId
				),
				orderBy: asc(schema.lorebookBindings.id)
			})
			if (bindings.length > 0) {
				const characterIds = bindings
					.map((b) => b.characterId)
					.filter((id): id is number => id != null)
				const personaIds = bindings
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
									summary: schema.characters.summary,
									aliases: schema.characters.aliases
								})
								.from(schema.characters)
								.where(
									inArray(schema.characters.id, characterIds)
								)
						: Promise.resolve([]),
					personaIds.length > 0
						? db
								.select({
									id: schema.personas.id,
									name: schema.personas.name,
									description: schema.personas.description,
									summary: schema.personas.summary,
									aliases: schema.personas.aliases
								})
								.from(schema.personas)
								.where(inArray(schema.personas.id, personaIds))
						: Promise.resolve([])
				])

				const charMap = new Map(characters.map((c) => [c.id, c]))
				const personaMap = new Map(personas.map((p) => [p.id, p]))

				const seeds: GraphBuilderSeedNode[] = []
				for (const b of bindings) {
					if (b.characterId && charMap.has(b.characterId)) {
						const char = charMap.get(b.characterId)!
						const name = resolveCharacterName(char, "")
						if (!name.trim()) continue
						seeds.push({
							bindingId: b.id,
							name: name.trim(),
							summary:
								char.summary?.trim() || char.description.trim(),
							nodeState: "active",
							aliases: char.aliases?.length
								? char.aliases
								: undefined
						})
					} else if (b.personaId && personaMap.has(b.personaId)) {
						const persona = personaMap.get(b.personaId)!
						const name = persona.name
						if (!name.trim()) continue
						seeds.push({
							bindingId: b.id,
							name: name.trim(),
							summary:
								persona.summary?.trim() ||
								persona.description.trim(),
							nodeState: "active",
							aliases: persona.aliases?.length
								? persona.aliases
								: undefined
						})
					}
				}
				if (seeds.length > 0) seedNodes = seeds
			}
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

		// In replace mode, delete everything — nodes are rebuilt fresh from binding seeds.
		if (mode === "replace") {
			await db
				.delete(schema.narrativeRelationships)
				.where(eq(schema.narrativeRelationships.lorebookId, lorebookId))
			await db
				.delete(schema.narrativeNodes)
				.where(eq(schema.narrativeNodes.lorebookId, lorebookId))
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
			const seededNodes = await db.query.narrativeNodes.findMany({
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

		// Everything below builds/updates the graph for this lorebook in one
		// pass — wrapped in a transaction so a crash or thrown error partway
		// through (e.g. after some nodes are inserted but before their
		// relationships are) can't leave a half-applied graph.
		await db.transaction(async (tx) => {
			for (const nodeProposal of proposal.nodes) {
				const [inserted] = await tx
					.insert(schema.narrativeNodes)
					.values({
						lorebookId,
						name: nodeProposal.name,
						nodeState: (nodeProposal.nodeState ??
							"active") as NodeState,
						summary: nodeProposal.summary ?? "",
						sceneId: nodeProposal.sceneId ?? null,
						historyEntryId: nodeProposal.historyEntryId ?? null
					})
					.returning()
				tempIdMap.set(nodeProposal.tempId, inserted.id)

				// Re-link lorebook binding for nodes seeded from bindings; populate aliases
				if (nodeProposal.tempId.startsWith("binding_")) {
					const bindingId = parseInt(
						nodeProposal.tempId.slice("binding_".length)
					)
					if (!isNaN(bindingId)) {
						const binding =
							await tx.query.lorebookBindings.findFirst({
								where: eq(
									schema.lorebookBindings.id,
									bindingId
								),
								with: {
									character: { columns: { aliases: true } },
									persona: { columns: { aliases: true } }
								}
							})
						const aliases =
							binding?.character?.aliases ??
							binding?.persona?.aliases ??
							[]
						await tx
							.update(schema.narrativeNodes)
							.set({ lorebookBindingId: bindingId, aliases })
							.where(eq(schema.narrativeNodes.id, inserted.id))
					}
				}
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
								description:
									rel.description ?? existing.description,
								visibility: (rel.visibility ??
									existing.visibility) as RelationshipVisibility,
								status: rel.status ?? existing.status,
								reason: rel.reason ?? existing.reason
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
					description: rel.description ?? "",
					visibility: (rel.visibility ??
						"acknowledged") as RelationshipVisibility,
					status: rel.status ?? "active",
					reason: rel.reason ?? null,
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
			db.query.narrativeNodes.findMany({
				where: eq(schema.narrativeNodes.lorebookId, lorebookId),
				orderBy: asc(schema.narrativeNodes.id)
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

		const existing = await db.query.narrativeNodes.findFirst({
			where: eq(schema.narrativeNodes.id, params.node.id)
		})
		if (!existing) throw new Error("Node not found.")

		const lorebook = await db.query.lorebooks.findFirst({
			where: (l, { and, eq }) =>
				and(eq(l.id, existing.lorebookId), eq(l.userId, userId))
		})
		if (!lorebook) throw new Error("Access denied.")

		const {
			id,
			createdAt,
			updatedAt,
			embedding,
			embeddingModel,
			...fields
		} = {
			...params.node
		}
		await db
			.update(schema.narrativeNodes)
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			.set(fields as any)
			.where(eq(schema.narrativeNodes.id, params.node.id))

		const [updated] = await db
			.select()
			.from(schema.narrativeNodes)
			.where(eq(schema.narrativeNodes.id, params.node.id))

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

		const existing = await db.query.narrativeNodes.findFirst({
			where: eq(schema.narrativeNodes.id, params.id)
		})
		if (!existing) throw new Error("Node not found.")

		const lorebook = await db.query.lorebooks.findFirst({
			where: (l, { and, eq }) =>
				and(eq(l.id, existing.lorebookId), eq(l.userId, userId))
		})
		if (!lorebook) throw new Error("Access denied.")

		await db
			.delete(schema.narrativeNodes)
			.where(eq(schema.narrativeNodes.id, params.id))

		const res = { success: "Node deleted." }
		emitToUser("narrativeGraph:deleteNode", res)
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

		const { id, createdAt, updatedAt, ...fields } = {
			...params.relationship
		}
		await db
			.update(schema.narrativeRelationships)
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			.set(fields as any)
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
			db.query.narrativeNodes.findFirst({
				where: eq(schema.narrativeNodes.id, fromNodeId)
			}),
			db.query.narrativeNodes.findFirst({
				where: eq(schema.narrativeNodes.id, toNodeId)
			})
		])
		if (!fromNode || fromNode.lorebookId !== lorebookId)
			throw new Error("From-node not found.")
		if (!toNode || toNode.lorebookId !== lorebookId)
			throw new Error("To-node not found.")

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

		const [node] = await db
			.insert(schema.narrativeNodes)
			.values({
				lorebookId,
				name,
				nodeState: (nodeState ?? "active") as NodeState,
				nodeVisibility: (nodeVisibility ?? "normal") as NodeVisibility,
				summary: summary ?? null,
				historyEntryId: historyEntryId ?? null,
				characterIds: []
			})
			.returning()

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

		// Resolve speaker's root node via binding
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
			if (binding) {
				const speakerNode = await db.query.narrativeNodes.findFirst({
					where: and(
						eq(schema.narrativeNodes.lorebookId, lorebookId),
						eq(schema.narrativeNodes.lorebookBindingId, binding.id)
					),
					columns: { id: true }
				})
				speakerNodeId = speakerNode?.id ?? null
			}
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
			const nodes = await db.query.narrativeNodes.findMany({
				where: inArray(schema.narrativeNodes.id, nodeIds),
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
				where: eq(schema.chatCharacters.chatId, chatId),
				columns: { characterId: true }
			}),
			db.query.chatPersonas.findMany({
				where: eq(schema.chatPersonas.chatId, chatId),
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

			const participantBindingIds = participantBindings.map((b) => b.id)
			const participantNodeIds =
				participantBindingIds.length > 0
					? (
							await db.query.narrativeNodes.findMany({
								where: and(
									eq(
										schema.narrativeNodes.lorebookId,
										lorebookId
									),
									inArray(
										schema.narrativeNodes.lorebookBindingId,
										participantBindingIds
									)
								),
								columns: { id: true }
							})
						)
							.map((n) => n.id)
							.filter((id) => id !== speakerNodeId)
					: []

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
		const legendaryNodes = await db.query.narrativeNodes.findMany({
			where: and(
				eq(schema.narrativeNodes.lorebookId, lorebookId),
				eq(
					schema.narrativeNodes.nodeVisibility,
					"legendary" as NodeVisibility
				)
			),
			orderBy: desc(schema.narrativeNodes.updatedAt),
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

// ─── Link binding to node ─────────────────────────────────────────────────────

export const narrativeGraphLinkBindingNodeHandler: Handler<
	Sockets.NarrativeGraph.LinkBindingNode.Params,
	Sockets.NarrativeGraph.LinkBindingNode.Response
> = {
	event: "narrativeGraph:linkBindingNode",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const { bindingId, nodeId } = params

		const binding = await db.query.lorebookBindings.findFirst({
			where: eq(schema.lorebookBindings.id, bindingId),
			with: {
				character: {
					columns: { aliases: true, summary: true, description: true }
				},
				persona: {
					columns: { aliases: true, summary: true, description: true }
				}
			}
		})
		if (!binding) throw new Error("Binding not found.")
		const lorebookForBinding = await db.query.lorebooks.findFirst({
			where: and(
				eq(schema.lorebooks.id, binding.lorebookId),
				eq(schema.lorebooks.userId, userId)
			)
		})
		if (!lorebookForBinding) throw new Error("Access denied.")

		const bindingAliases =
			binding.character?.aliases ?? binding.persona?.aliases ?? []
		const bindingEntity = binding.character ?? binding.persona
		const bindingSummary = bindingEntity
			? bindingEntity.summary?.trim() ||
				bindingEntity.description.trim() ||
				null
			: null

		let resolvedNodeId: number

		if (nodeId !== null) {
			// Link to existing node — clear any previous binding on it first
			const node = await db.query.narrativeNodes.findFirst({
				where: and(
					eq(schema.narrativeNodes.id, nodeId),
					eq(schema.narrativeNodes.lorebookId, binding.lorebookId)
				)
			})
			if (!node) throw new Error("Node not found.")
			resolvedNodeId = node.id
		} else {
			// Auto-create a new node for this binding
			const entityName = await resolveBindingName(binding)
			const [created] = await db
				.insert(schema.narrativeNodes)
				.values({
					lorebookId: binding.lorebookId,
					name: entityName,
					nodeState: "active" as NodeState,
					aliases: bindingAliases,
					summary: bindingSummary,
					lorebookBindingId: bindingId
				})
				.returning()
			resolvedNodeId = created.id
		}

		if (nodeId !== null) {
			// Clear old owner (unique constraint) then set new; populate aliases from binding
			await db
				.update(schema.narrativeNodes)
				.set({ lorebookBindingId: null })
				.where(eq(schema.narrativeNodes.lorebookBindingId, bindingId))
			await db
				.update(schema.narrativeNodes)
				.set({ lorebookBindingId: bindingId, aliases: bindingAliases })
				.where(eq(schema.narrativeNodes.id, resolvedNodeId))
		}

		const res: Sockets.NarrativeGraph.LinkBindingNode.Response = {
			bindingId,
			nodeId: resolvedNodeId
		}
		emitToUser("narrativeGraph:linkBindingNode", res)
		return res
	}
}

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
			await db
				.update(schema.lorebookBindings)
				.set({
					characterId: characterId ?? null,
					personaId: personaId ?? null
				})
				.where(eq(schema.lorebookBindings.id, bindingId))
		}

		const res: Sockets.NarrativeGraph.LinkOrphanBinding.Response = {
			success: true
		}
		emitToUser("narrativeGraph:linkOrphanBinding", res)
		return res
	}
}

// ─── Merge Node ───────────────────────────────────────────────────────────────

export const narrativeGraphMergeNodeHandler: Handler<
	Sockets.NarrativeGraph.MergeNode.Params,
	Sockets.NarrativeGraph.MergeNode.Response
> = {
	event: "narrativeGraph:mergeNode",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const { nodeId, parentNodeId } = params

		const [child, parent] = await Promise.all([
			db.query.narrativeNodes.findFirst({
				where: eq(schema.narrativeNodes.id, nodeId)
			}),
			db.query.narrativeNodes.findFirst({
				where: eq(schema.narrativeNodes.id, parentNodeId)
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

		// Guard: cannot merge two bound nodes (distinct individuals)
		if (child.lorebookBindingId && parent.lorebookBindingId) {
			throw new Error(
				"Cannot merge two nodes that are both linked to character bindings — they represent distinct individuals."
			)
		}

		// Guard: parent must not already be a child (2-level max)
		if (parent.parentNodeId !== null) {
			throw new Error(
				"Cannot merge into a node that is already an alias. Merge into its parent instead."
			)
		}

		// Flatten grandchildren: reparent existing children of the merging node to the new parent
		await db
			.update(schema.narrativeNodes)
			.set({ parentNodeId })
			.where(eq(schema.narrativeNodes.parentNodeId, nodeId))

		// Transfer binding from child to parent if applicable
		if (child.lorebookBindingId && !parent.lorebookBindingId) {
			await db
				.update(schema.narrativeNodes)
				.set({ lorebookBindingId: child.lorebookBindingId })
				.where(eq(schema.narrativeNodes.id, parentNodeId))
			await db
				.update(schema.narrativeNodes)
				.set({ lorebookBindingId: null })
				.where(eq(schema.narrativeNodes.id, nodeId))
		}

		// Set the parent link
		await db
			.update(schema.narrativeNodes)
			.set({ parentNodeId })
			.where(eq(schema.narrativeNodes.id, nodeId))

		const [updatedChild, updatedParent] = await Promise.all([
			db.query.narrativeNodes.findFirst({
				where: eq(schema.narrativeNodes.id, nodeId)
			}),
			db.query.narrativeNodes.findFirst({
				where: eq(schema.narrativeNodes.id, parentNodeId)
			})
		])

		const res: Sockets.NarrativeGraph.MergeNode.Response = {
			parentNode: updatedParent!,
			childNode: updatedChild!
		}
		emitToUser("narrativeGraph:mergeNode", res)
		return res
	}
}

export const narrativeGraphDemergeNodeHandler: Handler<
	Sockets.NarrativeGraph.DemergeNode.Params,
	Sockets.NarrativeGraph.DemergeNode.Response
> = {
	event: "narrativeGraph:demergeNode",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const { nodeId } = params

		const node = await db.query.narrativeNodes.findFirst({
			where: eq(schema.narrativeNodes.id, nodeId)
		})
		if (!node) throw new Error("Node not found.")
		if (node.parentNodeId === null)
			throw new Error("Node is not an alias child — nothing to de-merge.")

		const lorebook = await db.query.lorebooks.findFirst({
			where: and(
				eq(schema.lorebooks.id, node.lorebookId),
				eq(schema.lorebooks.userId, userId)
			)
		})
		if (!lorebook) throw new Error("Access denied.")

		await db
			.update(schema.narrativeNodes)
			.set({ parentNodeId: null })
			.where(eq(schema.narrativeNodes.id, nodeId))

		const updated = await db.query.narrativeNodes.findFirst({
			where: eq(schema.narrativeNodes.id, nodeId)
		})

		const res: Sockets.NarrativeGraph.DemergeNode.Response = {
			node: updated!
		}
		emitToUser("narrativeGraph:demergeNode", res)
		return res
	}
}

// ─── Shared helper ────────────────────────────────────────────────────────────

async function resolveBindingName(binding: any): Promise<string> {
	if (binding.characterId) {
		const char = await db.query.characters.findFirst({
			where: eq(schema.characters.id, binding.characterId)
		})
		return char?.nickname || char?.name || binding.binding
	}
	if (binding.personaId) {
		const persona = await db.query.personas.findFirst({
			where: eq(schema.personas.id, binding.personaId)
		})
		return persona?.name || binding.binding
	}
	return binding.binding
}

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
	register(socket, narrativeGraphUpdateRelationshipHandler, emitToUser)
	register(socket, narrativeGraphDeleteRelationshipHandler, emitToUser)
	register(socket, narrativeGraphCreateRelationshipHandler, emitToUser)
	register(socket, narrativeGraphCreateNodeHandler, emitToUser)
	register(socket, narrativeGraphQueryContextHandler, emitToUser)
	register(socket, narrativeGraphLinkBindingNodeHandler, emitToUser)
	register(socket, narrativeGraphLinkOrphanBindingHandler, emitToUser)
	register(socket, narrativeGraphMergeNodeHandler, emitToUser)
	register(socket, narrativeGraphDemergeNodeHandler, emitToUser)
}
