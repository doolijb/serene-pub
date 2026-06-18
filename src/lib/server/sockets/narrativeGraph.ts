import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { eq, asc } from "drizzle-orm"
import type { Handler } from "$lib/shared/events"
import {
	buildGraphFromScenes,
	GraphParseError,
	type GraphBuilderScene
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

		const [nodes, relationships] = await Promise.all([
			db.query.narrativeNodes.findMany({
				where: eq(schema.narrativeNodes.lorebookId, params.lorebookId),
				orderBy: asc(schema.narrativeNodes.id)
			}),
			db.query.narrativeRelationships.findMany({
				where: eq(schema.narrativeRelationships.lorebookId, params.lorebookId),
				orderBy: asc(schema.narrativeRelationships.id)
			})
		])

		const res: Sockets.NarrativeGraph.List.Response = { nodes, relationships }
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

		const scenes: GraphBuilderScene[] = (rawScenes as any[]).map((s) => ({
			id: s.id,
			name: s.name,
			summary: s.summary,
			historyEntryId: s.historyEntryId ?? null,
			historyEntry: s.historyEntry ?? null
		}))

		const { connection, sampling, contextConfig, promptConfig } =
			await getUserConfigurations(userId)

		try {
			const result = await buildGraphFromScenes({
				scenes,
				connection,
				sampling,
				contextConfig,
				promptConfig,
				onProgress: (data) => {
					emitToUser("narrativeGraph:build:progress", data)
				}
			})

			const res: Sockets.NarrativeGraph.Build.Response = {
				proposal: result.proposal,
				sceneLabels: result.sceneLabels
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
				return { proposal: { nodes: [], relationships: [] }, sceneLabels: [] }
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
		const { lorebookId, proposal, mode } = params

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
		const tempIdMap = new Map<string, number>()

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
					pendingReview: false
				})
				.returning()
			tempIdMap.set(nodeProposal.tempId, inserted.id)
		}

		// Insert relationships
		for (const rel of proposal.relationships) {
			const fromId = tempIdMap.get(rel.fromTempId)
			const toId = tempIdMap.get(rel.toTempId)
			if (!fromId || !toId) continue

			await db.insert(schema.narrativeRelationships).values({
				lorebookId,
				fromNodeId: fromId,
				toNodeId: toId,
				relationshipType: rel.relationshipType ?? "neutral",
				description: rel.description ?? "",
				status: rel.status ?? "active",
				reason: rel.reason ?? null,
				pendingReview: false
			})
		}

		// Return updated list
		const [nodes, relationships] = await Promise.all([
			db.query.narrativeNodes.findMany({
				where: eq(schema.narrativeNodes.lorebookId, lorebookId),
				orderBy: asc(schema.narrativeNodes.id)
			}),
			db.query.narrativeRelationships.findMany({
				where: eq(schema.narrativeRelationships.lorebookId, lorebookId),
				orderBy: asc(schema.narrativeRelationships.id)
			})
		])

		const res: Sockets.NarrativeGraph.ApplyProposal.Response = { nodes, relationships }
		emitToUser("narrativeGraph:list", { nodes, relationships })
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
}
