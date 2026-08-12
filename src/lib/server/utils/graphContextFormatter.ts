import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { and, desc, eq, inArray, isNull } from "drizzle-orm"
import type {
	NodeVisibility,
	RelationshipVisibility
} from "$lib/server/db/schema"

// Round-12 audit fix (MEDIUM): these are the only structural markers
// separating one section/entry from another in the context string below,
// which is spliced directly into the generation prompt. An untrusted
// name/alias/description/summary containing a literal "]", a fake
// "[Header]", or the literal header/footer text could inject fake
// structure into another participant's prompt — a guest can bind their
// own (attacker-named) character into a shared lorebook (see round 13's
// binding-ownership work), so this is a genuine cross-user vector, not
// just self-inflicted. Declared once here and consumed by both the
// section-building code below and neutralizeGraphMarkers() so a future
// change to the wrapper text can't silently desync from what's being
// guarded against — same reason PromptBlockFormatter.ts's
// ROLE_MARKER_PATTERN is a single shared constant, not two independently-
// maintained copies.
const SECTION_OPEN = "["
const SECTION_CLOSE = "]"
const GRAPH_CONTEXT_HEADER = "--- Narrative Graph Context ---"
const GRAPH_CONTEXT_FOOTER = "--- End Narrative Graph Context ---"

// Written as the explicit \u200B escape, never a pasted literal invisible
// character — an actually-invisible source character is un-greppable and
// one "strip weird whitespace" cleanup away from silently reopening this
// (same reasoning as PromptBlockFormatter.ts's identical technique).
const ZERO_WIDTH_SPACE = "\u200B"

/** Breaks any exact-match occurrence of the structural markers above inside
 * untrusted content, while staying visually identical to a human reader. */
function neutralizeGraphMarkers(s: string): string {
	return s
		.split(SECTION_OPEN)
		.join(SECTION_OPEN + ZERO_WIDTH_SPACE)
		.split(SECTION_CLOSE)
		.join(ZERO_WIDTH_SPACE + SECTION_CLOSE)
		.split(GRAPH_CONTEXT_HEADER)
		.join(
			GRAPH_CONTEXT_HEADER.slice(0, 1) +
				ZERO_WIDTH_SPACE +
				GRAPH_CONTEXT_HEADER.slice(1)
		)
		.split(GRAPH_CONTEXT_FOOTER)
		.join(
			GRAPH_CONTEXT_FOOTER.slice(0, 1) +
				ZERO_WIDTH_SPACE +
				GRAPH_CONTEXT_FOOTER.slice(1)
		)
}

interface RelRow {
	fromNodeId: number
	toNodeId: number
	relationshipType: string
	description: string
	visibility: string
	status: string
}

/**
 * Secrecy, phrased from the reading character's own vantage.
 *
 * The stored vocabulary (secret/acknowledged/public) is schema jargon, and
 * "acknowledged" in particular tells a model nothing about who may act on the
 * information. These say it outright, so the fact needs no legend and no
 * inference — the model is generating AS this character, so first person is
 * the frame it is already in.
 *
 * A single field rather than the "does B know? / is it public?" pair: three
 * states in two booleans admits one impossible combination (not known, yet
 * public) and costs roughly three times the tokens on every entry.
 */
function secrecyLabel(visibility: string): string {
	switch (visibility) {
		case "secret":
			return "Only I know"
		case "public":
			return "Everyone knows"
		case "acknowledged":
			return "We both know"
		default:
			// An unrecognised visibility must not silently read as a secret —
			// over-sharing a dynamic is a lesser failure than a character
			// acting on something they were never told.
			return "We both know"
	}
}

/**
 * One relationship as the model sees it.
 *
 * `status` and `state` are omitted when they are the unremarkable default.
 * Emitting `"status":"active"` on all thirty entries is the same repetition
 * this rewrite exists to remove, and a field that is always present carries no
 * information — their presence is what makes them worth reading.
 */
function relEntry(
	r: RelRow,
	other: NodeInfo | undefined
): Record<string, string> {
	const entry: Record<string, string> = {
		type: neutralizeGraphMarkers(r.relationshipType),
		secrecy: secrecyLabel(r.visibility)
	}
	if (r.status && r.status !== "active") entry.status = r.status
	if (other?.nodeState && other.nodeState !== "active") {
		entry.theirState = other.nodeState
	}
	if (r.description) entry.note = neutralizeGraphMarkers(r.description)
	return entry
}

/** Group relationships under the OTHER character's name. */
function groupByOther(
	rels: RelRow[],
	nodeMap: Map<number, NodeInfo>,
	otherSide: "to" | "from"
): Record<string, Record<string, string>[]> {
	const grouped: Record<string, Record<string, string>[]> = {}
	for (const r of rels) {
		const otherId = otherSide === "to" ? r.toNodeId : r.fromNodeId
		const other = nodeMap.get(otherId)
		const name = nodeName(other, `node#${otherId}`)
		;(grouped[name] ??= []).push(relEntry(r, other))
	}
	return grouped
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
	const nodes = await db.query.lorebookBindings.findMany({
		where: inArray(schema.lorebookBindings.id, nodeIds),
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
		return `${neutralizeGraphMarkers(info.name)} (a.k.a. ${info.aliases.map(neutralizeGraphMarkers).join(", ")})`
	return neutralizeGraphMarkers(info.name)
}

function formatRel(r: RelRow, nodeMap: Map<number, NodeInfo>): string {
	const from = nodeMap.get(r.fromNodeId)?.name ?? `node#${r.fromNodeId}`
	const to = nodeMap.get(r.toNodeId)?.name ?? `node#${r.toNodeId}`
	return (
		`${neutralizeGraphMarkers(from)} → ${neutralizeGraphMarkers(to)} ` +
		`${SECTION_OPEN}${neutralizeGraphMarkers(r.relationshipType)}${r.visibility !== "public" ? `, ${r.visibility}` : ""}${SECTION_CLOSE}: ` +
		neutralizeGraphMarkers(r.description)
	)
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
	// The binding IS the node now (see the lorebookBindings/narrativeNodes
	// merge plan) — no separate lookup needed.
	const speakerNodeId = speakerBinding.id

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
		// A participant's binding IS their node — no separate lookup needed
		// (post-merge simplification, see the merge plan).
		const participantBindingIds = [...charBindings, ...personaBindings].map(
			(b) => b.id
		)
		const participantParentIds = participantBindingIds.filter(
			(id) => id !== speakerNodeId
		)

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
				const aliasChildren = await db.query.lorebookBindings.findMany({
					where: and(
						eq(schema.lorebookBindings.lorebookId, lorebookId),
						inArray(
							schema.lorebookBindings.parentNodeId,
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

	// Keyed by name, same rule as the other two sections.
	const legendaryFigures: Record<string, Record<string, unknown>> = {}
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
		const header = nodeName(l3NodeMap.get(node.id), node.name)
		const figure: Record<string, unknown> = {}
		if (node.summary) figure.summary = neutralizeGraphMarkers(node.summary)
		if (node.nodeState && node.nodeState !== "active") {
			figure.state = node.nodeState
		}
		if (pubRels.length > 0) {
			figure.relationships = groupByOther(pubRels, l3NodeMap, "to")
		}
		legendaryFigures[header] = figure
	}

	// ── Format output ──
	//
	// Emitted as JSON, keyed by the OTHER character's name.
	//
	// Three things drove the shape. The context template already wraps this
	// block in a ```json fence, so prose here was a format lie the model had to
	// see past. In `yourRelationships` the source is ALWAYS the speaker, so the
	// old "Speaker → Other [type]: text" line repeated the speaker's own name
	// on every entry; keying by the other party removes it entirely, and
	// collapses a pair holding several dynamics to one key. And a heading of
	// "How others in this scene see X" asserted co-presence: layer 2 is scoped
	// to chat participants, not to whoever is in the room this moment, and a
	// relationship is accumulated history rather than a present-tense fact.
	const graph: Record<string, unknown> = {}

	if (l1Rels.length > 0) {
		graph.yourRelationships = groupByOther(l1Rels, l1NodeMap, "to")
	}

	if (l2Rels.length > 0) {
		graph.howOthersRegardYou = groupByOther(l2Rels, l2NodeMap, "from")
	}

	if (Object.keys(legendaryFigures).length > 0) {
		graph.legendaryFigures = legendaryFigures
	}

	if (Object.keys(graph).length === 0) return null

	return JSON.stringify(graph, null, 1)
}
