import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { and, desc, eq, inArray } from "drizzle-orm"
import type {
	NodeVisibility,
	RelationshipVisibility
} from "$lib/server/db/schema"

interface RelRow {
	fromNodeId: number
	toNodeId: number
	relationshipType: string
	description: string
	visibility: string
}

interface NodeInfo {
	name: string
	nodeState: string
	nodeVisibility: string
	parentNodeId: number | null
	aliases: string[]
}

async function fetchNodeMap(nodeIds: number[]) {
	if (nodeIds.length === 0) return new Map<number, NodeInfo>()
	const nodes = await db.query.narrativeNodes.findMany({
		where: inArray(schema.narrativeNodes.id, nodeIds),
		columns: {
			id: true,
			name: true,
			nodeState: true,
			nodeVisibility: true,
			parentNodeId: true,
			aliases: true
		}
	})
	return new Map(
		nodes.map((n) => [
			n.id,
			{
				name: n.name,
				nodeState: n.nodeState,
				nodeVisibility: n.nodeVisibility,
				parentNodeId: n.parentNodeId,
				aliases: n.aliases ?? []
			}
		])
	)
}

function nodeName(info: NodeInfo | undefined, fallback: string): string {
	if (!info) return fallback
	if (info.aliases.length > 0)
		return `${info.name} (a.k.a. ${info.aliases.join(", ")})`
	return info.name
}

function formatRel(r: RelRow, nodeMap: Map<number, NodeInfo>): string {
	const from = nodeMap.get(r.fromNodeId)?.name ?? `node#${r.fromNodeId}`
	const to = nodeMap.get(r.toNodeId)?.name ?? `node#${r.toNodeId}`
	return `${from} → ${to} [${r.relationshipType}${r.visibility !== "public" ? `, ${r.visibility}` : ""}]: ${r.description}`
}

/**
 * Build the three-layer graph context string for a speaker, or return null if
 * there is no lorebook or the speaker has no bound narrative node.
 */
export async function buildGraphContext(params: {
	chatId: number
	lorebookId: number
	speakerCharacterId: number | null
	speakerPersonaId?: number | null
}): Promise<string | null> {
	const { chatId, lorebookId, speakerCharacterId, speakerPersonaId } = params

	// Find the speaker's binding and node
	const speakerBindingWhere = speakerCharacterId
		? and(
				eq(schema.lorebookBindings.lorebookId, lorebookId),
				eq(schema.lorebookBindings.characterId, speakerCharacterId)
			)
		: speakerPersonaId
			? and(
					eq(schema.lorebookBindings.lorebookId, lorebookId),
					eq(schema.lorebookBindings.personaId, speakerPersonaId)
				)
			: null

	if (!speakerBindingWhere) return null

	const speakerBinding = await db.query.lorebookBindings.findFirst({
		where: speakerBindingWhere,
		columns: { id: true }
	})
	if (!speakerBinding) return null
	const speakerNode = await db.query.narrativeNodes.findFirst({
		where: and(
			eq(schema.narrativeNodes.lorebookId, lorebookId),
			eq(schema.narrativeNodes.lorebookBindingId, speakerBinding.id)
		),
		columns: { id: true }
	})
	if (!speakerNode) return null
	const speakerNodeId = speakerNode.id

	// ── Layer 1: speaker outbound relationships (all visibilities, non-hidden targets) ──
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

	// For alias-aware filtering: collect parentNodeIds of alias targets
	const aliasTargetParentIds = new Set<number>()
	for (const r of speakerRels) {
		const toNode = l1NodeMap.get(r.toNodeId)
		if (toNode?.parentNodeId != null)
			aliasTargetParentIds.add(toNode.parentNodeId)
	}
	// Check which of those parents already have a direct rel from speaker
	const speakerToParentRels =
		aliasTargetParentIds.size > 0
			? await db.query.narrativeRelationships.findMany({
					where: and(
						eq(
							schema.narrativeRelationships.lorebookId,
							lorebookId
						),
						eq(
							schema.narrativeRelationships.fromNodeId,
							speakerNodeId
						),
						inArray(schema.narrativeRelationships.toNodeId, [
							...aliasTargetParentIds
						])
					),
					columns: { toNodeId: true }
				})
			: []
	const parentWithDirectRel = new Set(
		speakerToParentRels.map((r) => r.toNodeId)
	)

	const l1Rels = speakerRels.filter((r) => {
		const toNode = l1NodeMap.get(r.toNodeId)
		if (toNode?.nodeVisibility === "hidden") return false
		// Suppress alias rel if speaker already has a direct rel to the real (parent) node
		if (
			toNode?.parentNodeId != null &&
			parentWithDirectRel.has(toNode.parentNodeId)
		)
			return false
		return true
	})

	// ── Layer 2: inverse rels from chat participants → speaker (acknowledged/public) ──
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
		.filter((id): id is number => id !== null && id !== speakerCharacterId)
	const chatPersonaIds = chatPersonas
		.map((p) => p.personaId)
		.filter(
			(id): id is number => id !== null && id !== (speakerPersonaId ?? -1)
		)

	let l2Rels: RelRow[] = []
	if (chatCharIds.length > 0 || chatPersonaIds.length > 0) {
		const charConditions = [
			eq(schema.lorebookBindings.lorebookId, lorebookId)
		]
		if (chatCharIds.length > 0)
			charConditions.push(
				inArray(schema.lorebookBindings.characterId, chatCharIds)
			)
		const charBindings = await db.query.lorebookBindings.findMany({
			where: and(...charConditions),
			columns: { id: true }
		})
		const personaBindings =
			chatPersonaIds.length > 0
				? await db.query.lorebookBindings.findMany({
						where: and(
							eq(schema.lorebookBindings.lorebookId, lorebookId),
							inArray(
								schema.lorebookBindings.personaId,
								chatPersonaIds
							)
						),
						columns: { id: true }
					})
				: []
		const participantBindingIds = [...charBindings, ...personaBindings].map(
			(b) => b.id
		)
		const participantParentNodes =
			participantBindingIds.length > 0
				? await db.query.narrativeNodes.findMany({
						where: and(
							eq(schema.narrativeNodes.lorebookId, lorebookId),
							inArray(
								schema.narrativeNodes.lorebookBindingId,
								participantBindingIds
							)
						),
						columns: { id: true }
					})
				: []
		const participantParentIds = participantParentNodes
			.map((n) => n.id)
			.filter((id) => id !== speakerNodeId)

		if (participantParentIds.length > 0) {
			// Fetch direct rels from participant parent nodes → speaker
			const directRels = await db.query.narrativeRelationships.findMany({
				where: and(
					eq(schema.narrativeRelationships.lorebookId, lorebookId),
					eq(schema.narrativeRelationships.toNodeId, speakerNodeId),
					inArray(
						schema.narrativeRelationships.fromNodeId,
						participantParentIds
					),
					inArray(schema.narrativeRelationships.visibility, [
						"acknowledged",
						"public"
					] as RelationshipVisibility[])
				)
			})
			const coveredByDirect = new Set(directRels.map((r) => r.fromNodeId))
			l2Rels = [...directRels]

			// For participants with no direct rel, check their alias children
			const needsFallback = participantParentIds.filter(
				(id) => !coveredByDirect.has(id)
			)
			if (needsFallback.length > 0) {
				const aliasChildren = await db.query.narrativeNodes.findMany({
					where: and(
						eq(schema.narrativeNodes.lorebookId, lorebookId),
						inArray(
							schema.narrativeNodes.parentNodeId,
							needsFallback
						)
					),
					columns: { id: true }
				})
				const aliasChildIds = aliasChildren.map((n) => n.id)
				if (aliasChildIds.length > 0) {
					const aliasRels =
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
									aliasChildIds
								),
								inArray(
									schema.narrativeRelationships.visibility,
									[
										"acknowledged",
										"public"
									] as RelationshipVisibility[]
								)
							)
						})
					l2Rels.push(...aliasRels)
				}
			}
		}
	}

	const l2NodeIds = [
		...new Set([
			...l2Rels.map((r) => r.fromNodeId),
			...l2Rels.map((r) => r.toNodeId)
		])
	]
	const l2NodeMap = await fetchNodeMap(l2NodeIds)

	// ── Layer 3: legendary nodes (nodeVisibility = "legendary") + public relationships ──
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

	const legendaryEntries: string[] = []
	for (const node of legendaryNodes) {
		const pubRels = await db.query.narrativeRelationships.findMany({
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
			...new Set([node.id, ...pubRels.map((r) => r.toNodeId)])
		]
		const l3NodeMap = await fetchNodeMap(l3NodeIds)
		l3NodeMap.set(node.id, {
			name: node.name,
			nodeState: node.nodeState,
			nodeVisibility: "legendary",
			parentNodeId: null,
			aliases: node.aliases ?? []
		})
		const relLines = pubRels
			.map((r) => `  - ${formatRel(r, l3NodeMap)}`)
			.join("\n")
		const header = nodeName(l3NodeMap.get(node.id), node.name)
		const entry = node.summary
			? `[${header}] ${node.summary}${relLines ? "\n" + relLines : ""}`
			: `[${header}]${relLines ? "\n" + relLines : ""}`
		legendaryEntries.push(entry)
	}

	// ── Format output ──
	const sections: string[] = []

	if (l1Rels.length > 0) {
		const speaker = l1NodeMap.get(speakerNodeId)
		const speakerHeader = nodeName(speaker, "Speaker")
		sections.push(
			`[${speakerHeader}'s relationships]\n` +
				l1Rels.map((r) => `- ${formatRel(r, l1NodeMap)}`).join("\n")
		)
	}

	if (l2Rels.length > 0) {
		const speaker = l1NodeMap.get(speakerNodeId)
		const speakerLabel = speaker?.name ?? "the speaker"
		sections.push(
			`[How others in this scene see ${speakerLabel}]\n` +
				l2Rels.map((r) => `- ${formatRel(r, l2NodeMap)}`).join("\n")
		)
	}

	if (legendaryEntries.length > 0) {
		sections.push(
			`[Legendary / historical figures]\n` + legendaryEntries.join("\n")
		)
	}

	if (sections.length === 0) return null

	return `\n\n--- Narrative Graph Context ---\n${sections.join("\n\n")}\n--- End Narrative Graph Context ---`
}
