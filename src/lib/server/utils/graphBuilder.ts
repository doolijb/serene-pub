/**
 * Casual Graph Builder
 *
 * Processes scenes one at a time in chronological order. Each scene call receives
 * the current graph state so the LLM can add new nodes and update relationships
 * incrementally without re-processing prior scenes.
 *
 * Output is a GraphProposal that the user reviews and approves before committing to DB.
 */

import { getConnectionAdapter } from "./getConnectionAdapter"
import { TokenCounters } from "./TokenCounterManager"
import { ChatTypes } from "$lib/shared/constants/ChatTypes"

// ─── Types ───────────────────────────────────────────────────────────────────

export interface GraphBuilderScene {
	id: number
	name: string | null
	summary: string | null
	historyEntryId: number | null
	historyEntry: {
		id: number
		year: number
		month: number | null
		day: number | null
	} | null
	/** Present when this item is a direct history entry (no associated scene) */
	sourceHistoryEntryId?: number
}

export interface GraphBuilderSeedNode {
	id: number
	nodeType: string
	name: string
	nodeState: string
	summary: string | null
}

export interface GraphBuilderSeedRelationship {
	fromNodeId: number
	toNodeId: number
	relationshipType: string
	status: string
	description: string | null
	reason: string | null
}

export interface GraphBuilderInput {
	scenes: GraphBuilderScene[]
	connection: SelectConnection
	sampling: SelectSamplingConfig
	contextConfig: SelectContextConfig
	promptConfig: SelectPromptConfig
	/** Existing graph nodes to seed the LLM context with (extend mode only) */
	seedNodes?: GraphBuilderSeedNode[]
	/** Existing relationships to seed the LLM context with (extend mode only) */
	seedRelationships?: GraphBuilderSeedRelationship[]
	onProgress?: (data: Sockets.NarrativeGraph.Build.Progress) => void
}

export interface GraphBuilderResult {
	proposal: Sockets.NarrativeGraph.GraphProposal
	sceneLabels: string[]
	/** Maps seed tempIds (e.g. "existing_5") → real DB node id. Empty in replace mode. */
	seedTempIdMap: Record<string, number>
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildMinimalChat(userPrompt: string): any {
	return {
		id: 0,
		userId: 0,
		name: null,
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		scenario: null,
		metadata: null,
		lorebookId: null,
		isGroup: false,
		chatType: ChatTypes.SUMMARIZE,
		groupReplyStrategy: null,
		chatMessages: [
			{
				id: 1,
				chatId: 0,
				role: "user",
				content: userPrompt,
				createdAt: new Date().toISOString(),
				isHidden: false,
				isGenerating: false,
				metadata: null
			}
		],
		lorebook: {
			id: 0,
			userId: 0,
			name: "",
			description: null,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			lorebookBindings: []
		}
	}
}

async function runLLM(
	systemPrompt: string,
	userPrompt: string,
	opts: {
		connection: SelectConnection
		sampling: SelectSamplingConfig
		contextConfig: SelectContextConfig
		promptConfig: SelectPromptConfig
	}
): Promise<string> {
	const AdapterClass = getConnectionAdapter(opts.connection.type)
	const tokenCounter = new TokenCounters("estimate")
	const tokenLimit: number =
		(opts.connection as any).tokenLimit ?? (opts.connection as any).contextSize ?? 4096

	const fakeChat = buildMinimalChat(userPrompt)

	const adapter = new AdapterClass.Adapter({
		connection: opts.connection,
		sampling: opts.sampling,
		contextConfig: opts.contextConfig,
		promptConfig: { ...opts.promptConfig, systemPrompt },
		chat: fakeChat,
		currentCharacterId: null,
		tokenCounter,
		tokenLimit,
		contextThresholdPercent: 0.9,
		isAssistantMode: false
	})

	let raw = ""
	const { completionResult } = await adapter.generate()

	if (typeof completionResult === "string") {
		raw = completionResult
	} else {
		await completionResult((chunk: string) => {
			raw += chunk
		})
	}

	return raw.trim()
}

function formatEntryDate(entry: { year: number; month: number | null; day: number | null }): string {
	let label = `Year ${entry.year}`
	if (entry.month != null) label += `, Month ${entry.month}`
	if (entry.day != null) label += `, Day ${entry.day}`
	return label
}

function buildSystemPrompt(): string {
	return `You are building a narrative graph incrementally, one scene at a time.
Each call gives you the current graph state and one new scene summary.
Your job: extract NEW nodes and NEW or CHANGED relationships introduced by this scene.

RULES:
1. Do NOT recreate nodes that already exist — reference them by their existing tempId.
2. Only add new nodes for entities not yet in the graph. New node tempIds will be specified.
3. Relationships can connect existing nodes, new nodes, or both.
4. If a relationship status changes from a prior scene, output it again with the new status and a "reason".
5. Node "summary" describes current narrative role and state — what happened or what they are doing. One sentence. No physical descriptions or backstory.
6. Output ONLY valid JSON. No prose, no markdown fences.
7. Keep all text fields to one sentence maximum.
8. If this scene introduces nothing new, output: {"nodes":[],"relationships":[]}

NODE TYPES: character | location | faction | item | concept | event
RELATIONSHIP TYPES: ally | enemy | rival | mentor | student | family | romantic | neutral | complicated | life_debt | betrayal | contract | unknown
STATUS VALUES: active | resolved | broken | evolved`
}

function buildScenePrompt(
	scene: GraphBuilderScene,
	sceneLabel: string,
	existingNodes: Sockets.NarrativeGraph.NodeProposal[],
	existingRelationships: Sockets.NarrativeGraph.RelationshipProposal[],
	nextNodeIndex: number
): string {
	const sceneName = scene.name ? ` — "${scene.name}"` : ""
	const sceneSummary = scene.summary?.trim() ?? ""

	const nodeList =
		existingNodes.length > 0
			? existingNodes
					.map((n) => `  ${n.tempId}: [${n.nodeType}] ${n.name} — ${n.summary}`)
					.join("\n")
			: "  (none yet)"

	const relList =
		existingRelationships.length > 0
			? existingRelationships
					.map((r) => `  ${r.fromTempId} → ${r.relationshipType} → ${r.toTempId} (${r.status})`)
					.join("\n")
			: "  (none yet)"

	return `CURRENT GRAPH:
Nodes:
${nodeList}

Relationships:
${relList}

NEW SCENE [${sceneLabel}${sceneName}]:
${sceneSummary}

Extract what is new or changed. New nodes must use tempIds starting from "node_${nextNodeIndex}".
Output JSON: {"nodes":[...new only...],"relationships":[...new or changed...]}`
}

// ─── Parser ───────────────────────────────────────────────────────────────────

export class GraphParseError extends Error {
	public raw: string
	public truncated: boolean
	constructor(message: string, raw: string, truncated = false) {
		super(message)
		this.name = "GraphParseError"
		this.raw = raw
		this.truncated = truncated
	}
}

function extractJsonFromRaw(raw: string): string {
	// Strip markdown code fences if present
	const stripped = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim()
	const jsonMatch = stripped.match(/\{[\s\S]*\}/)
	if (jsonMatch) return jsonMatch[0]
	throw new GraphParseError("No JSON object found in LLM response", raw)
}

export function parseSceneProposal(
	raw: string,
	existingTempIds: Set<string>
): Sockets.NarrativeGraph.GraphProposal {
	const jsonStr = extractJsonFromRaw(raw)

	let parsed: any
	try {
		parsed = JSON.parse(jsonStr)
	} catch (e) {
		const truncated = !raw.trimEnd().endsWith("}")
		throw new GraphParseError(`JSON parse failed: ${(e as Error).message}`, raw, truncated)
	}

	if (!parsed || typeof parsed !== "object") {
		throw new GraphParseError("Parsed result is not an object", raw)
	}

	const nodes: Sockets.NarrativeGraph.NodeProposal[] = []
	const relationships: Sockets.NarrativeGraph.RelationshipProposal[] = []

	if (Array.isArray(parsed.nodes)) {
		for (const n of parsed.nodes) {
			const tempId = n.tempId ?? n.id
			const nodeType = n.nodeType ?? n.type
			if (!tempId || typeof tempId !== "string") continue
			if (!nodeType || !n.name) continue
			nodes.push({
				tempId: String(tempId),
				nodeType: String(nodeType),
				name: String(n.name),
				nodeState: String(n.nodeState ?? n.state ?? "active"),
				summary: String(n.summary ?? ""),
				characterIds: Array.isArray(n.characterIds) ? n.characterIds : []
			})
		}
	}

	// All valid tempIds for relationship validation: existing + new from this scene
	const allKnownIds = new Set([...existingTempIds, ...nodes.map((n) => n.tempId)])

	if (Array.isArray(parsed.relationships)) {
		for (const r of parsed.relationships) {
			const fromId = r.fromTempId ?? r.from ?? r.source
			const toId = r.toTempId ?? r.to ?? r.target
			const relType = r.relationshipType ?? r.type ?? r.relation ?? r.relationship
			if (!fromId || !toId) continue
			if (!allKnownIds.has(String(fromId)) || !allKnownIds.has(String(toId))) continue
			relationships.push({
				fromTempId: String(fromId),
				toTempId: String(toId),
				relationshipType: String(relType ?? "neutral"),
				description: String(r.description ?? r.direction ?? ""),
				status: String(r.status ?? "active"),
				reason: r.reason ? String(r.reason) : undefined
			})
		}
	}

	return { nodes, relationships }
}

// ─── Main builder ─────────────────────────────────────────────────────────────

/**
 * Sort scenes chronologically: by history entry (year → month → day → id),
 * then by scene id within each entry.
 */
export function sortScenesChronologically(scenes: GraphBuilderScene[]): GraphBuilderScene[] {
	return [...scenes].sort((a, b) => {
		const aHe = a.historyEntry
		const bHe = b.historyEntry
		if (!aHe && !bHe) return a.id - b.id
		if (!aHe) return 1
		if (!bHe) return -1
		if (aHe.year !== bHe.year) return aHe.year - bHe.year
		const aMonth = aHe.month ?? 0
		const bMonth = bHe.month ?? 0
		if (aMonth !== bMonth) return aMonth - bMonth
		const aDay = aHe.day ?? 0
		const bDay = bHe.day ?? 0
		if (aDay !== bDay) return aDay - bDay
		return a.id - b.id
	})
}

export async function buildGraphFromScenes(
	input: GraphBuilderInput
): Promise<GraphBuilderResult> {
	const {
		scenes,
		connection,
		sampling,
		contextConfig,
		promptConfig,
		seedNodes,
		seedRelationships,
		onProgress
	} = input

	if (scenes.length === 0) throw new Error("No scenes to build graph from.")

	const orderedScenes = sortScenesChronologically(scenes)
	const scenesWithSummaries = orderedScenes.filter((s) => s.summary?.trim())

	if (scenesWithSummaries.length === 0) {
		throw new Error("No scenes have summaries. Generate scene summaries first.")
	}

	const sceneLabels = scenesWithSummaries.map((s) =>
		s.historyEntry ? formatEntryDate(s.historyEntry) : `Scene ${s.id}`
	)

	const systemPrompt = buildSystemPrompt()

	// Running state — built up incrementally across scene calls
	const allNodes: Sockets.NarrativeGraph.NodeProposal[] = []
	const allRelationships: Sockets.NarrativeGraph.RelationshipProposal[] = []
	// Maps "fromTempId|toTempId" → index in allRelationships for O(1) dedup/update
	const allRelKeyIndex = new Map<string, number>()
	let nextNodeIndex = 1
	const seedTempIdMap: Record<string, number> = {}

	// Seed the context with existing nodes (extend mode)
	if (seedNodes && seedNodes.length > 0) {
		for (const seed of seedNodes) {
			const tempId = `existing_${seed.id}`
			seedTempIdMap[tempId] = seed.id
			allNodes.push({
				tempId,
				nodeType: seed.nodeType,
				name: seed.name,
				nodeState: seed.nodeState,
				summary: seed.summary ?? "",
				characterIds: []
			})
		}
	}

	// Seed context with existing relationships (extend mode).
	// Track which keys came from the DB so unchanged ones can be excluded from the proposal.
	const seedRelKeys = new Set<string>()
	const updatedSeedRelKeys = new Set<string>()

	if (seedRelationships && seedRelationships.length > 0) {
		for (const rel of seedRelationships) {
			const fromTempId = `existing_${rel.fromNodeId}`
			const toTempId = `existing_${rel.toNodeId}`
			// Only include if both nodes are known seeds
			if (!seedTempIdMap[fromTempId] || !seedTempIdMap[toTempId]) continue
			const key = `${fromTempId}|${toTempId}`
			seedRelKeys.add(key)
			allRelKeyIndex.set(key, allRelationships.length)
			allRelationships.push({
				fromTempId,
				toTempId,
				relationshipType: rel.relationshipType,
				description: rel.description ?? "",
				status: rel.status,
				reason: rel.reason ?? undefined
			})
		}
	}

	for (let i = 0; i < scenesWithSummaries.length; i++) {
		onProgress?.({
			phase: "extracting",
			sceneIndex: i,
			totalScenes: scenesWithSummaries.length,
			nodesFound: allNodes.length,
			relationshipsFound: allRelationships.length
		})

		const userPrompt = buildScenePrompt(
			scenesWithSummaries[i],
			sceneLabels[i],
			allNodes,
			allRelationships,
			nextNodeIndex
		)

		const raw = await runLLM(systemPrompt, userPrompt, {
			connection,
			sampling,
			contextConfig,
			promptConfig
		})

		const existingTempIds = new Set(allNodes.map((n) => n.tempId))
		const sceneResult = parseSceneProposal(raw, existingTempIds)

		const currentScene = scenesWithSummaries[i]

		// Remap new node tempIds to globally unique ones
		const tempIdRemap = new Map<string, string>()
		for (const node of sceneResult.nodes) {
			const globalId = `node_${nextNodeIndex++}`
			tempIdRemap.set(node.tempId, globalId)
			// Direct history entries get historyEntryId set, not sceneId
			const isDirectEntry = currentScene.sourceHistoryEntryId != null
			allNodes.push({
				...node,
				tempId: globalId,
				sceneIndex: i,
				sceneId: isDirectEntry ? undefined : currentScene.id,
				historyEntryId: isDirectEntry ? currentScene.sourceHistoryEntryId : undefined
			})
		}

		for (const rel of sceneResult.relationships) {
			const fromTempId = tempIdRemap.get(rel.fromTempId) ?? rel.fromTempId
			const toTempId = tempIdRemap.get(rel.toTempId) ?? rel.toTempId
			const key = `${fromTempId}|${toTempId}`
			const isDirectEntry = currentScene.sourceHistoryEntryId != null

			if (allRelKeyIndex.has(key)) {
				// Relationship already seen this session (or is a seed) — update in place.
				// Preserve the original sceneId (where it was first established).
				const idx = allRelKeyIndex.get(key)!
				allRelationships[idx] = { ...allRelationships[idx], ...rel, fromTempId, toTempId }
				if (seedRelKeys.has(key)) updatedSeedRelKeys.add(key)
			} else {
				// First time seeing this relationship — tag with current scene or history entry
				allRelKeyIndex.set(key, allRelationships.length)
				allRelationships.push({
					...rel,
					fromTempId,
					toTempId,
					sceneIndex: i,
					sceneId: isDirectEntry ? undefined : currentScene.id,
					historyEntryId: isDirectEntry ? currentScene.sourceHistoryEntryId : undefined
				})
			}
		}
	}

	// Strip seed nodes from the proposal — only newly extracted nodes go back to the user
	const newNodes = allNodes.filter((n) => !n.tempId.startsWith("existing_"))

	// Strip unchanged seed relationships — only include ones the LLM explicitly changed.
	// Within-session relationships (replace mode or new extend rels) are always included.
	const proposalRelationships = allRelationships.filter((r) => {
		const key = `${r.fromTempId}|${r.toTempId}`
		if (seedRelKeys.has(key)) return updatedSeedRelKeys.has(key)
		return true
	})

	onProgress?.({
		phase: "parsing",
		sceneIndex: scenesWithSummaries.length,
		totalScenes: scenesWithSummaries.length,
		nodesFound: newNodes.length,
		relationshipsFound: proposalRelationships.length
	})

	return {
		proposal: { nodes: newNodes, relationships: proposalRelationships },
		sceneLabels,
		seedTempIdMap
	}
}
