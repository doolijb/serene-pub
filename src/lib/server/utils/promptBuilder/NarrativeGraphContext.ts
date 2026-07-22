/**
 * Shared narrative-graph pair shaping/serialization for the {{narrativeGraph}}
 * template variable, used by both RagInfillEngine (semantic seeding) and
 * KeywordInfillEngine (co-occurrence seeding) so their output stays
 * structurally identical regardless of which engine found the pairs.
 *
 * This is distinct from graphContextFormatter.ts's buildGraphContext(), which
 * injects a separate, always-on, speaker-centric relationship summary directly
 * into system instructions for every generation regardless of RAG/keyword mode.
 * What lives here covers the broader sweep each infill engine adds on top of
 * that baseline — RAG via semantic relevance to the conversation, keyword via
 * chat-participant co-occurrence.
 */

import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { and, asc, eq, inArray } from "drizzle-orm"

/** Maximum narrative graph relationship pairs included in context. */
export const MAX_GRAPH_PAIRS = 10

export type InternalRelEntry = {
	type: string
	status: string
	description?: string
	reason?: string
	historyEntryId: number | null
}

export type GraphPairOutput = {
	from: string
	fromBound: boolean
	fromDescription?: string
	to: string
	toBound: boolean
	toDescription?: string
	fromNodeId: number
	toNodeId: number
	lorebookId: number
	rels: InternalRelEntry[]
}

/**
 * Serializes finished graph pairs into the JSON string consumed by the
 * {{narrativeGraph}} template variable. Descriptions are hoisted to a
 * top-level "side_characters" map (unbound nodes only — bound nodes already
 * have descriptions in the character/persona context sections).
 * Relationships are grouped by "from" node perspective to avoid repetition.
 */
export function serializeGraphPairs(
	graphPairs: GraphPairOutput[]
): string | undefined {
	if (graphPairs.length === 0) return undefined

	const nodeDescriptions = new Map<string, string>()
	for (const p of graphPairs) {
		if (
			!p.fromBound &&
			p.fromDescription &&
			!nodeDescriptions.has(p.from)
		) {
			nodeDescriptions.set(p.from, p.fromDescription)
		}
		if (!p.toBound && p.toDescription && !nodeDescriptions.has(p.to)) {
			nodeDescriptions.set(p.to, p.toDescription)
		}
	}

	const perspectiveMap = new Map<
		string,
		Array<{ with: string; relationships: any[] }>
	>()
	for (const p of graphPairs) {
		if (!perspectiveMap.has(p.from)) perspectiveMap.set(p.from, [])
		perspectiveMap.get(p.from)!.push({
			with: p.to,
			relationships: p.rels.map(
				({ historyEntryId: _he, ...rest }) => rest
			)
		})
	}

	const output: Record<string, any> = {}
	if (nodeDescriptions.size > 0) {
		output.side_characters = Object.fromEntries(nodeDescriptions)
	}
	for (const [name, rels] of perspectiveMap) {
		output[`${name}_perspective`] = rels
	}

	return JSON.stringify(output, null, 2)
}

/**
 * Finds active relationships where both endpoints are within `nodeIds`, up to
 * `maxPairs` distinct pairs (grouping multiple relationship types between the
 * same pair together), and shapes them into GraphPairOutput.
 *
 * Used by KeywordInfillEngine's co-occurrence-based graph fill — nodeIds there
 * are narrative nodes bound to characters/personas already present in the
 * chat. RagInfillEngine does its own semantic-seed variant of this inline,
 * since it also needs full (non-active-only) relationship history for its
 * directly-retrieved seed pairs, not just cross-pair completion.
 */
export async function fetchActiveRelationshipsAmongNodes(
	nodeIds: number[],
	lorebookId: number,
	maxPairs: number,
	includedHistoryIds: Set<number>
): Promise<GraphPairOutput[]> {
	if (nodeIds.length < 2) return []

	const nodeRows = await db
		.select({
			id: schema.narrativeNodes.id,
			name: schema.narrativeNodes.name,
			summary: schema.narrativeNodes.summary,
			lorebookBindingId: schema.narrativeNodes.lorebookBindingId
		})
		.from(schema.narrativeNodes)
		.where(inArray(schema.narrativeNodes.id, nodeIds))
	const nodeInfoMap = new Map(
		nodeRows.map((n) => [
			n.id,
			{
				name: n.name,
				summary: n.summary,
				bound: n.lorebookBindingId != null
			}
		])
	)

	const rels = await db
		.select({
			fromNodeId: schema.narrativeRelationships.fromNodeId,
			toNodeId: schema.narrativeRelationships.toNodeId,
			relationshipType: schema.narrativeRelationships.relationshipType,
			description: schema.narrativeRelationships.description,
			status: schema.narrativeRelationships.status,
			reason: schema.narrativeRelationships.reason,
			historyEntryId: schema.narrativeRelationships.historyEntryId
		})
		.from(schema.narrativeRelationships)
		.where(
			and(
				eq(schema.narrativeRelationships.lorebookId, lorebookId),
				eq(schema.narrativeRelationships.status, "active"),
				inArray(schema.narrativeRelationships.fromNodeId, nodeIds),
				inArray(schema.narrativeRelationships.toNodeId, nodeIds)
			)
		)
		.orderBy(asc(schema.narrativeRelationships.id))

	const pairMap = new Map<string, GraphPairOutput>()
	for (const r of rels) {
		const pairKey = `${r.fromNodeId}:${r.toNodeId}`
		let pair = pairMap.get(pairKey)
		if (!pair) {
			if (pairMap.size >= maxPairs) continue
			const fromInfo = nodeInfoMap.get(r.fromNodeId)
			const toInfo = nodeInfoMap.get(r.toNodeId)
			const fromBound = fromInfo?.bound ?? false
			const toBound = toInfo?.bound ?? false
			pair = {
				from: fromInfo?.name ?? String(r.fromNodeId),
				fromBound,
				fromDescription: fromBound
					? undefined
					: (fromInfo?.summary ?? undefined),
				to: toInfo?.name ?? String(r.toNodeId),
				toBound,
				toDescription: toBound
					? undefined
					: (toInfo?.summary ?? undefined),
				fromNodeId: r.fromNodeId,
				toNodeId: r.toNodeId,
				lorebookId,
				rels: []
			}
			pairMap.set(pairKey, pair)
		}
		const rel: InternalRelEntry = {
			type: r.relationshipType,
			status: r.status,
			historyEntryId: r.historyEntryId
		}
		if (r.description) rel.description = r.description
		if (
			r.reason &&
			!(
				r.historyEntryId != null &&
				includedHistoryIds.has(r.historyEntryId)
			)
		) {
			rel.reason = r.reason
		}
		pair.rels.push(rel)
	}
	return Array.from(pairMap.values())
}
