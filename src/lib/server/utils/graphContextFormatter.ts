import { db as defaultDb } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { castEdgeOnly, isCastEdge } from "$lib/server/utils/narrativeEdges"
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
	/**
	 * The row's own id, and `updatedAt` below it.
	 *
	 * ⚠ Both were always on the rows and neither was declared. Every query in
	 * this file is a `findMany` with no `columns`, so the whole row has always
	 * arrived; what the interface named was the subset the *formatter* used.
	 * `core:query/relationship-search@1` ranks on when a tie last changed and
	 * addresses a candidate by its row id, so the two facts are named here rather than read
	 * off an `any` — see `collectGraphLayers`.
	 */
	id: number
	fromNodeId: number
	toNodeId: number
	relationshipType: string
	description: string
	visibility: string
	status: string
	updatedAt: Date
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
): GraphRelationshipEntry {
	const entry: GraphRelationshipEntry = {
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
): Record<string, GraphRelationshipEntry[]> {
	const grouped: Record<string, GraphRelationshipEntry[]> = {}
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

async function fetchNodeMap(db: Db, nodeIds: number[]) {
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
 * One relationship, as the prompt sees it.
 *
 * Every field is a string, and every one but the first two is conditional —
 * `relEntry` omits a status of "active" and a note that is empty rather than
 * writing them out, because these objects are stringified straight into a
 * prompt and a `"status": "active"` on every entry is tokens spent saying
 * nothing.
 */
export interface GraphRelationshipEntry {
	type: string
	secrecy: string
	status?: string
	theirState?: string
	note?: string
}

/**
 * The speaker's relationship summary, before it becomes text.
 *
 * All three sections are conditional — an install with no legendary figures has
 * no `legendaryFigures` key at all, rather than an empty object — which is what
 * the shipped layout's section guards are written against.
 */
export interface GraphContextData {
	yourRelationships?: Record<string, GraphRelationshipEntry[]>
	howOthersRegardYou?: Record<string, GraphRelationshipEntry[]>
	legendaryFigures?: Record<
		string,
		{
			summary?: string
			state?: string
			relationships?: Record<string, GraphRelationshipEntry[]>
		}
	>
}

/** One legendary figure with the public ties behind it, unprojected. */
interface LegendaryLayer {
	nodeId: number
	/** The name as a section heading — aliases folded in by `nodeName`. */
	header: string
	summary: string | null
	nodeState: string
	rels: RelRow[]
	nodeMap: Map<number, NodeInfo>
}

/** One traversal's result: the three layers, and who was in the room. */
interface GraphLayers {
	speakerNodeId: number
	/** Layer 1 — the speaker's outbound ties, alias-suppressed. */
	l1Rels: RelRow[]
	l1NodeMap: Map<number, NodeInfo>
	/** Layer 2 — participants' ties back to the speaker, non-secret. */
	l2Rels: RelRow[]
	l2NodeMap: Map<number, NodeInfo>
	/** Layer 3 — figures everyone knows of. */
	legendary: LegendaryLayer[]
	/** The session's cast, as node ids. See the note where it is filled. */
	participantNodeIds: Set<number>
}

/**
 * The three layers, walked once, before anything decides what to do with them.
 *
 * ⚠ **Extracted so there is exactly one reading of this graph.** Two callers
 * want different things out of the same traversal now — the prompt wants the
 * three keyed sections it has always had, and
 * `core:query/relationship-search@1` wants one row per tie with the facts it
 * ranks on — and a second walk written beside this one is two readings that
 * agree until somebody edits one, which is the failure `host.ts` refuses a
 * second derivation for in as many words.
 *
 * The body below is the body `buildGraphContextData` had, moved. Both
 * projections are underneath it.
 */
async function collectGraphLayers(params: {
	sessionId: number
	lorebookId: number
	speakerCharacterId: number | null
	speakerPersonaId?: number | null
	/**
	 * The database to read through.
	 *
	 * Optional so the legacy caller keeps working unchanged, but the pipeline
	 * host **must** pass its own: a Query's effects belong to the substrate it
	 * was handed (F19), and reaching for the module-scope connection instead
	 * bypasses the host entirely. That is not theoretical — wiring this into
	 * `core:query/graph-context@1` without it made the node reach the real
	 * database from inside a test suite that had never opened one, and the
	 * node timed out at 2s on every run.
	 */
	db?: Db
}): Promise<GraphLayers | null> {
	const { sessionId, lorebookId, speakerCharacterId, speakerPersonaId } =
		params
	const db = params.db ?? defaultDb

	// Find the speaker's binding and node. One column: the speaker is a
	// character whether the model or a user is voicing them, and the character
	// id is preferred only because a turn carrying both is a character's turn.
	const speakerId = speakerCharacterId ?? speakerPersonaId
	const speakerBindingWhere = speakerId
		? and(
				eq(schema.lorebookBindings.lorebookId, lorebookId),
				eq(schema.lorebookBindings.characterId, speakerId)
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
	// ⚠ `castEdgeOnly` on every layer below. These three layers ARE the cast
	// graph — the prompt's relationship sections and the ranked band are two
	// projections of them — and an endpoint that is an entry has no node to
	// name, no visibility to filter on and no alias to suppress.
	const speakerRels = (
		await db.query.narrativeRelationships.findMany({
			where: and(
				eq(schema.narrativeRelationships.lorebookId, lorebookId),
				castEdgeOnly,
				eq(schema.narrativeRelationships.fromNodeId, speakerNodeId)
			)
		})
	).filter(isCastEdge)

	const l1NodeIds = [
		...new Set([
			...speakerRels.map((r) => r.fromNodeId),
			...speakerRels.map((r) => r.toNodeId)
		])
	]
	const l1NodeMap = await fetchNodeMap(db, l1NodeIds)

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
						castEdgeOnly,
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

	// ── Layer 2: inverse rels from session participants → speaker (acknowledged/public) ──
	const [sessionChars, sessionPersonas] = await Promise.all([
		db.query.sessionCharacters.findMany({
			where: and(
				eq(schema.sessionCharacters.sessionId, sessionId),
				isNull(schema.sessionCharacters.removedAt)
			),
			columns: { characterId: true }
		}),
		db.query.sessionPersonas.findMany({
			where: and(
				eq(schema.sessionPersonas.sessionId, sessionId),
				isNull(schema.sessionPersonas.removedAt)
			),
			columns: { personaId: true }
		})
	])

	const sessionCharIds = sessionChars
		.map((c) => c.characterId)
		.filter((id): id is number => id !== null && id !== speakerCharacterId)
	const sessionPersonaIds = sessionPersonas
		.map((p) => p.personaId)
		.filter(
			(id): id is number => id !== null && id !== (speakerPersonaId ?? -1)
		)

	let l2Rels: RelRow[] = []
	/**
	 * The session's own participants, as node ids — layer 2's scope, hoisted so
	 * it outlives the branch that computes it.
	 *
	 * It is what "in the scene" means to the ranked read, and reusing layer
	 * 2's set rather than reading the cast a second time is what keeps the two
	 * answers one answer. ⚠ It follows `removedAt` and **not** `isActive`,
	 * because that is what this traversal has always scoped layer 2 by; a
	 * deactivated cast member therefore still counts as present. Stated rather
	 * than changed — narrowing it here would quietly move which inverse
	 * relationships reach the prompt.
	 */
	const participantNodeIds = new Set<number>()
	if (sessionCharIds.length > 0 || sessionPersonaIds.length > 0) {
		// ONE query over ONE column — cast and voiced characters share an id
		// space, so two reads would return overlapping rows.
		const participantIds = [
			...new Set([...sessionCharIds, ...sessionPersonaIds])
		]
		const charConditions = [
			eq(schema.lorebookBindings.lorebookId, lorebookId)
		]
		if (participantIds.length > 0)
			charConditions.push(
				inArray(schema.lorebookBindings.characterId, participantIds)
			)
		const charBindings = await db.query.lorebookBindings.findMany({
			where: and(...charConditions),
			columns: { id: true }
		})
		// A participant's binding IS their node — no separate lookup needed
		// (post-merge simplification, see the merge plan).
		const participantBindingIds = charBindings.map((b) => b.id)
		for (const id of participantBindingIds) participantNodeIds.add(id)
		const participantParentIds = participantBindingIds.filter(
			(id) => id !== speakerNodeId
		)

		if (participantParentIds.length > 0) {
			// Fetch direct rels from participant parent nodes → speaker
			const directRels = (
				await db.query.narrativeRelationships.findMany({
					where: and(
						eq(
							schema.narrativeRelationships.lorebookId,
							lorebookId
						),
						castEdgeOnly,
						eq(
							schema.narrativeRelationships.toNodeId,
							speakerNodeId
						),
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
			).filter(isCastEdge)
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
								castEdgeOnly,
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
					l2Rels.push(...aliasRels.filter(isCastEdge))
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
	const l2NodeMap = await fetchNodeMap(db, l2NodeIds)

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

	// Each figure with the rows behind it, in the order the query returned
	// them. Projected — into sections or into candidates — by the callers below.
	const legendary: LegendaryLayer[] = []
	for (const node of legendaryNodes) {
		const pubRels = (
			await db.query.narrativeRelationships.findMany({
				where: and(
					eq(schema.narrativeRelationships.lorebookId, lorebookId),
					castEdgeOnly,
					eq(schema.narrativeRelationships.fromNodeId, node.id),
					eq(
						schema.narrativeRelationships.visibility,
						"public" as RelationshipVisibility
					)
				)
			})
		).filter(isCastEdge)
		const l3NodeIds = [
			...new Set([node.id, ...pubRels.map((r) => r.toNodeId)])
		]
		const l3NodeMap = await fetchNodeMap(db, l3NodeIds)
		l3NodeMap.set(node.id, {
			name: node.name,
			nodeState: node.nodeState,
			nodeVisibility: "legendary",
			parentNodeId: null,
			aliases: node.aliases ?? []
		})
		legendary.push({
			nodeId: node.id,
			header: nodeName(l3NodeMap.get(node.id), node.name),
			summary: node.summary,
			nodeState: node.nodeState,
			rels: pubRels,
			nodeMap: l3NodeMap
		})
	}

	return {
		speakerNodeId,
		l1Rels,
		l1NodeMap,
		l2Rels,
		l2NodeMap,
		legendary,
		participantNodeIds
	}
}

/**
 * Build the three-layer graph context for a speaker, or return null if there is
 * no lorebook or the speaker has no bound narrative node.
 *
 * Returns the **structure**. `buildGraphContext` below is the same thing as
 * text, for the caller that wants a finished string.
 */
export async function buildGraphContextData(
	params: Parameters<typeof collectGraphLayers>[0]
): Promise<GraphContextData | null> {
	const layers = await collectGraphLayers(params)
	if (!layers) return null

	// Keyed by name, same rule as the other two sections.
	const legendaryFigures: Record<string, Record<string, unknown>> = {}
	for (const figureLayer of layers.legendary) {
		const figure: Record<string, unknown> = {}
		if (figureLayer.summary)
			figure.summary = neutralizeGraphMarkers(figureLayer.summary)
		if (figureLayer.nodeState && figureLayer.nodeState !== "active") {
			figure.state = figureLayer.nodeState
		}
		if (figureLayer.rels.length > 0) {
			figure.relationships = groupByOther(
				figureLayer.rels,
				figureLayer.nodeMap,
				"to"
			)
		}
		legendaryFigures[figureLayer.header] = figure
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
	// to session participants, not to whoever is in the room this moment, and a
	// relationship is accumulated history rather than a present-tense fact.
	const graph: GraphContextData = {}

	if (layers.l1Rels.length > 0) {
		graph.yourRelationships = groupByOther(
			layers.l1Rels,
			layers.l1NodeMap,
			"to"
		)
	}

	if (layers.l2Rels.length > 0) {
		graph.howOthersRegardYou = groupByOther(
			layers.l2Rels,
			layers.l2NodeMap,
			"from"
		)
	}

	if (Object.keys(legendaryFigures).length > 0) {
		graph.legendaryFigures = legendaryFigures
	}

	if (Object.keys(graph).length === 0) return null

	return graph
}

/** Which of the three claims a tie is. Named, because the ranking reads it. */
export type GraphRelationshipLane =
	| "yourRelationships"
	| "howOthersRegardYou"
	| "legendaryFigures"

/**
 * One relationship, flat, with the three facts the ranked read orders by.
 *
 * The **same rows** the three sections are built from — same traversal, same
 * visibility rules, same alias suppression — projected without the grouping.
 * Grouping is a rendering decision: a pair holding three dynamics is one key in
 * the prompt and three candidates in a budget, because three is what competes
 * for the window and three is what a receipt has to account for.
 */
export interface GraphRelationshipRow {
	/** `narrative_relationships.id` — what a candidate is addressed by. */
	id: number
	lane: GraphRelationshipLane
	/** The heading this tie carries in the prompt. */
	name: string
	/**
	 * The other end, when the heading is not it — a legendary figure's section
	 * is headed by the figure, and the tie points at somebody else.
	 */
	counterpart?: string
	entry: GraphRelationshipEntry
	/**
	 * The figure's own summary and state, on a `legendaryFigures` tie only.
	 *
	 * A legendary section is headed by the figure and carries two facts about
	 * the figure rather than about the tie, so a ranked read that dropped them
	 * would render a heading somebody wrote a summary for with the summary
	 * gone. Both are already neutralised and already omitted when they are the
	 * unremarkable default, exactly as `buildGraphContextData` writes them.
	 *
	 * ⚠ A figure with **no** public ties produces no row here and therefore no
	 * candidate: nothing ranked it, so nothing renders it. The dump still shows
	 * it, which is the difference between a section and a budget band.
	 */
	figure?: { summary?: string; state?: string }
	/**
	 * Somebody other than the speaker on this tie is in the session's cast.
	 *
	 * ⚠ "In the scene" means *in the cast*, which is layer 2's own scope and
	 * not co-presence in the current moment — the same qualification this file
	 * already makes about the `howOthersRegardYou` heading. Nothing in the data
	 * says who is in the room right now.
	 */
	present: boolean
	/** The speaking character is party to this tie. */
	touchesSpeaker: boolean
	/** When the row last changed, as epoch milliseconds. */
	updatedAt: number
}

/**
 * The same graph, as rows for `core:query/relationship-search@1`.
 *
 * `null` for the cases `buildGraphContextData` returns `null` for — no
 * lorebook, no bound speaker node — and an empty array when the traversal found
 * nothing, which is a normal install rather than a failure.
 */
export async function buildGraphRelationshipRows(
	params: Parameters<typeof collectGraphLayers>[0]
): Promise<GraphRelationshipRow[] | null> {
	const layers = await collectGraphLayers(params)
	if (!layers) return null

	const rows: GraphRelationshipRow[] = []
	/**
	 * ⚠ **One row per relationship, even when two layers reach it.**
	 *
	 * A speaker whose own node is marked *legendary* has their public ties
	 * walked twice — once as layer 1 and again as that figure's public
	 * relationships — and the sections the prompt renders show both, which is
	 * right there: "what I think of them" and "what the world knows of me" are
	 * two claims under two headings. As **candidates** it is one tie, and
	 * emitting it twice would spend its tokens twice out of one band while the
	 * budget panel accounted for one. First layer wins, which is layer 1's
	 * own view and the same first-occurrence rule `concat-candidates` applies
	 * one node downstream.
	 */
	const seen = new Set<number>()
	const push = (
		r: RelRow,
		lane: GraphRelationshipLane,
		nodeMap: Map<number, NodeInfo>,
		otherSide: "to" | "from",
		over: Partial<GraphRelationshipRow> = {}
	) => {
		if (seen.has(r.id)) return
		seen.add(r.id)
		const otherId = otherSide === "to" ? r.toNodeId : r.fromNodeId
		const other = nodeMap.get(otherId)
		rows.push({
			id: r.id,
			lane,
			name: nodeName(other, `node#${otherId}`),
			entry: relEntry(r, other),
			present: layers.participantNodeIds.has(otherId),
			touchesSpeaker:
				r.fromNodeId === layers.speakerNodeId ||
				r.toNodeId === layers.speakerNodeId,
			updatedAt: r.updatedAt.getTime(),
			...over
		})
	}

	for (const r of layers.l1Rels)
		push(r, "yourRelationships", layers.l1NodeMap, "to")
	for (const r of layers.l2Rels)
		push(r, "howOthersRegardYou", layers.l2NodeMap, "from")
	for (const figure of layers.legendary) {
		// The same two conditionals `buildGraphContextData` applies, so the two
		// projections cannot disagree about when a figure has a summary.
		const about: { summary?: string; state?: string } = {}
		if (figure.summary)
			about.summary = neutralizeGraphMarkers(figure.summary)
		if (figure.nodeState && figure.nodeState !== "active")
			about.state = figure.nodeState
		for (const r of figure.rels)
			push(r, "legendaryFigures", figure.nodeMap, "to", {
				name: figure.header,
				counterpart: nodeName(
					figure.nodeMap.get(r.toNodeId),
					`node#${r.toNodeId}`
				),
				...(Object.keys(about).length ? { figure: about } : {}),
				// A figure everybody has heard of counts as present when the
				// figure OR the other end is in the cast — either is somebody
				// the scene can actually be about.
				present:
					layers.participantNodeIds.has(figure.nodeId) ||
					layers.participantNodeIds.has(r.toNodeId)
			})
	}

	return rows
}

/**
 * The same summary as text, at the indent every prompt has carried.
 *
 * The split exists because two callers want different things and only one of
 * them can be the source. The legacy path pushes a finished string onto the
 * adapter, so it gets this. The pipeline hands the *structure* to a variable
 * layout, because a pre-stringified blob is the one value a layout can do
 * nothing with — you cannot render relationships as prose, or drop a section,
 * or even change the indentation, if the shape was flattened upstream.
 *
 * `null` stays `null` rather than becoming `"null"`: an install that never
 * opened the graph has no relationships, and that is the common case.
 */
export async function buildGraphContext(
	args: Parameters<typeof buildGraphContextData>[0]
): Promise<string | null> {
	const graph = await buildGraphContextData(args)
	return graph === null ? null : JSON.stringify(graph, null, 1)
}
