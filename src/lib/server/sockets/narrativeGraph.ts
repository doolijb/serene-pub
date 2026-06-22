import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { eq, asc, and, isNotNull, isNull, or } from "drizzle-orm"
import type { Handler } from "$lib/shared/events"
import {
	buildGraphFromScenes,
	GraphParseError,
	type GraphBuilderScene,
	type GraphBuilderSeedNode,
	type GraphBuilderSeedRelationship
} from "$lib/server/utils/graphBuilder"
import { getUserConfigurations } from "$lib/server/utils/getUserConfigurations"

// ─── List ─────────────────────────────────────────────────────────────────────

export const narrativeGraphListHandler: Handler<
	Sockets.NarrativeGraph.List.Params,
	Sockets.NarrativeGraph.List.Response
> = {
	event: "narrativeGraph:list",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id

		const lorebook = await db.query.lorebooks.findFirst({
			where: (l, { and, eq }) => and(eq(l.id, params.lorebookId), eq(l.userId, userId))
		})
		if (!lorebook) throw new Error("Lorebook not found or access denied.")

		const [nodes, relationships, ungraphedScenes, ungraphedUnsummarizedScenes, allSummarizedScenes] = await Promise.all([
			db.query.narrativeNodes.findMany({
				where: eq(schema.narrativeNodes.lorebookId, params.lorebookId),
				orderBy: asc(schema.narrativeNodes.id)
			}),
			db.query.narrativeRelationships.findMany({
				where: eq(schema.narrativeRelationships.lorebookId, params.lorebookId),
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
			})
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
			totalSummarizedCount: allSummarizedScenes.length
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
			where: (l, { and, eq }) => and(eq(l.id, params.lorebookId), eq(l.userId, userId))
		})
		if (!lorebook) throw new Error("Lorebook not found or access denied.")

		// Fetch all scenes for this lorebook with their history entries
		const rawScenes = await db.query.scenes.findMany({
			where: eq(schema.scenes.lorebookId, params.lorebookId),
			orderBy: asc(schema.scenes.id),
			with: {
				historyEntry: {
					columns: { id: true, year: true, month: true, day: true }
				}
			}
		})

		// In extend mode, only process scenes not yet graphed
		const filteredRawScenes =
			params.mode === "extend" ? (rawScenes as any[]).filter((s) => !s.graphed) : rawScenes

		if (params.mode === "extend" && filteredRawScenes.length === 0) {
			const errRes: Sockets.NarrativeGraph.Build.ErrorResponse = {
				error: "No new scenes to process. All scenes with summaries have already been graphed."
			}
			emitToUser("narrativeGraph:build:error", errRes)
			return { proposal: { nodes: [], relationships: [] }, sceneLabels: [], seedTempIdMap: {} }
		}

		const scenes: GraphBuilderScene[] = filteredRawScenes.map((s: any) => ({
			id: s.id,
			name: s.name,
			summary: s.summary,
			historyEntryId: s.historyEntryId ?? null,
			historyEntry: s.historyEntry ?? null
		}))

		const { connection, sampling, contextConfig, promptConfig } =
			await getUserConfigurations(userId)

		// In extend mode, load existing nodes and relationships as LLM seed context
		let seedNodes: GraphBuilderSeedNode[] | undefined
		let seedRelationships: GraphBuilderSeedRelationship[] | undefined
		if (params.mode === "extend") {
			const [existingNodes, existingRelationships] = await Promise.all([
				db.query.narrativeNodes.findMany({
					where: eq(schema.narrativeNodes.lorebookId, params.lorebookId),
					orderBy: asc(schema.narrativeNodes.id)
				}),
				db.query.narrativeRelationships.findMany({
					where: eq(schema.narrativeRelationships.lorebookId, params.lorebookId),
					orderBy: asc(schema.narrativeRelationships.id)
				})
			])
			seedNodes = existingNodes.map((n) => ({
				id: n.id,
				nodeType: n.nodeType,
				name: n.name,
				nodeState: n.nodeState,
				summary: n.summary
			}))
			seedRelationships = existingRelationships.map((r) => ({
				fromNodeId: r.fromNodeId,
				toNodeId: r.toNodeId,
				relationshipType: r.relationshipType,
				status: r.status,
				description: r.description,
				reason: r.reason
			}))
		}

		try {
			const result = await buildGraphFromScenes({
				scenes,
				connection,
				sampling,
				contextConfig,
				promptConfig,
				seedNodes,
				seedRelationships,
				onProgress: (data) => {
					emitToUser("narrativeGraph:build:progress", data)
				}
			})

			const res: Sockets.NarrativeGraph.Build.Response = {
				proposal: result.proposal,
				sceneLabels: result.sceneLabels,
				seedTempIdMap: result.seedTempIdMap
			}
			emitToUser("narrativeGraph:build:complete", res)
			return res
		} catch (err) {
			if (err instanceof GraphParseError) {
				const errRes: Sockets.NarrativeGraph.Build.ErrorResponse = {
					error: err.truncated
						? "The model ran out of response tokens before finishing the graph. Increase Max Response Tokens in your sampling config and try again."
						: err.message,
					raw: err.raw
				}
				emitToUser("narrativeGraph:build:error", errRes)
				// Return gracefully so the register wrapper doesn't also emit an error
				return { proposal: { nodes: [], relationships: [] }, sceneLabels: [], seedTempIdMap: {} }
			}
			throw err
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
			where: (l, { and, eq }) => and(eq(l.id, lorebookId), eq(l.userId, userId))
		})
		if (!lorebook) throw new Error("Lorebook not found or access denied.")

		// In replace mode, delete everything first
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
			seedTempIdMap ? Object.entries(seedTempIdMap).map(([k, v]) => [k, v]) : []
		)

		for (const nodeProposal of proposal.nodes) {
			const [inserted] = await db
				.insert(schema.narrativeNodes)
				.values({
					lorebookId,
					nodeType: nodeProposal.nodeType,
					name: nodeProposal.name,
					nodeState: nodeProposal.nodeState ?? "active",
					summary: nodeProposal.summary ?? "",
					characterIds: nodeProposal.characterIds ?? [],
					sceneId: nodeProposal.sceneId ?? null
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
				// Try exact direction first; only fall back to reverse if not found.
				// This preserves intentionally directed relationships (A→B ≠ B→A).
				let existing = await db.query.narrativeRelationships.findFirst({
					where: and(
						eq(schema.narrativeRelationships.lorebookId, lorebookId),
						eq(schema.narrativeRelationships.fromNodeId, fromId),
						eq(schema.narrativeRelationships.toNodeId, toId)
					)
				})
				if (!existing) {
					existing = await db.query.narrativeRelationships.findFirst({
						where: and(
							eq(schema.narrativeRelationships.lorebookId, lorebookId),
							eq(schema.narrativeRelationships.fromNodeId, toId),
							eq(schema.narrativeRelationships.toNodeId, fromId)
						)
					})
				}

				if (existing) {
					await db
						.update(schema.narrativeRelationships)
						.set({
							relationshipType: rel.relationshipType ?? existing.relationshipType,
							description: rel.description ?? existing.description,
							status: rel.status ?? existing.status,
							reason: rel.reason ?? existing.reason
						})
						.where(eq(schema.narrativeRelationships.id, existing.id))
					continue
				}
			}

			await db.insert(schema.narrativeRelationships).values({
				lorebookId,
				fromNodeId: fromId,
				toNodeId: toId,
				relationshipType: rel.relationshipType ?? "neutral",
				description: rel.description ?? "",
				status: rel.status ?? "active",
				reason: rel.reason ?? null,
				sceneId: rel.sceneId ?? null
			})
		}

		// Mark scenes as graphed — entirely server-side, no client round-trip needed.
		// Replace: reset all scenes for this lorebook, then mark all summarized scenes as graphed.
		// Extend: mark all currently-ungraphed summarized scenes as graphed (those were the ones processed).
		if (mode === "replace") {
			await db
				.update(schema.scenes)
				.set({ graphed: false })
				.where(eq(schema.scenes.lorebookId, lorebookId))
		}
		await db
			.update(schema.scenes)
			.set({ graphed: true })
			.where(
				and(
					eq(schema.scenes.lorebookId, lorebookId),
					eq(schema.scenes.graphed, false),
					isNotNull(schema.scenes.summary)
				)
			)

		// Return updated list with fresh ungraphed count
		const [nodes, relationships, ungraphedScenes, ungraphedUnsummarized, allSummarized] = await Promise.all([
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
			})
		])

		const listPayload: Sockets.NarrativeGraph.List.Response = {
			nodes,
			relationships,
			ungraphedSceneCount: ungraphedScenes.length,
			ungraphedUnsummarizedCount: ungraphedUnsummarized.length,
			totalSummarizedCount: allSummarized.length
		}
		const res: Sockets.NarrativeGraph.ApplyProposal.Response = { nodes, relationships }
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

		const { id, createdAt, updatedAt, embedding, embeddingModel, ...fields } = {
			...params.node
		}
		await db
			.update(schema.narrativeNodes)
			.set(fields)
			.where(eq(schema.narrativeNodes.id, params.node.id))

		const [updated] = await db
			.select()
			.from(schema.narrativeNodes)
			.where(eq(schema.narrativeNodes.id, params.node.id))

		const res: Sockets.NarrativeGraph.UpdateNode.Response = { node: updated }
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

		await db.delete(schema.narrativeNodes).where(eq(schema.narrativeNodes.id, params.id))

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

		const { id, createdAt, updatedAt, ...fields } = { ...params.relationship }
		await db
			.update(schema.narrativeRelationships)
			.set(fields)
			.where(eq(schema.narrativeRelationships.id, params.relationship.id))

		const [updated] = await db
			.select()
			.from(schema.narrativeRelationships)
			.where(eq(schema.narrativeRelationships.id, params.relationship.id))

		const res: Sockets.NarrativeGraph.UpdateRelationship.Response = { relationship: updated }
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
		const { lorebookId, fromNodeId, toNodeId, relationshipType, status, description, historyEntryId } = params

		const lorebook = await db.query.lorebooks.findFirst({
			where: (l, { and, eq }) => and(eq(l.id, lorebookId), eq(l.userId, userId))
		})
		if (!lorebook) throw new Error("Lorebook not found or access denied.")

		const [fromNode, toNode] = await Promise.all([
			db.query.narrativeNodes.findFirst({ where: eq(schema.narrativeNodes.id, fromNodeId) }),
			db.query.narrativeNodes.findFirst({ where: eq(schema.narrativeNodes.id, toNodeId) })
		])
		if (!fromNode || fromNode.lorebookId !== lorebookId) throw new Error("From-node not found.")
		if (!toNode || toNode.lorebookId !== lorebookId) throw new Error("To-node not found.")

		const [inserted] = await db
			.insert(schema.narrativeRelationships)
			.values({
				lorebookId,
				fromNodeId,
				toNodeId,
				relationshipType,
				status,
				description: description ?? "",
				reason: null,
				historyEntryId: historyEntryId ?? null
			})
			.returning()

		const res: Sockets.NarrativeGraph.CreateRelationship.Response = { relationship: inserted }
		emitToUser("narrativeGraph:createRelationship", res)
		return res
	}
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
}
