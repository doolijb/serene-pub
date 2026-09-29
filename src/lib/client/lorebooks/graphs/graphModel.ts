/**
 * The graph, as arithmetic.
 *
 * An edge joins a cast member **or** an entry to a cast member **or** an
 * entry, so a node is one of two kinds and the two id spaces are told apart by
 * a key rather than a number: `cast#3` and `entry#3` are different things at
 * the same figure. Everything the canvas and the side panel draw is derived
 * here, so "who is on the graph" and "which way does this edge point" are
 * answerable without a browser.
 */

import {
	linkPairingOf,
	type LinkPairing
} from "$lib/shared/lorebooks/linkVocabulary"

/** Which of the two things a node is. */
export type GraphNodeKind = "cast" | "entry"

export interface GraphNode {
	/** `cast#3` or `entry#3`. Identity across both id spaces. */
	key: string
	kind: GraphNodeKind
	id: number
	name: string
	/**
	 * A cast member's standing in the world. An entry declares none and reads
	 * `active`, so the canvas has one colour rule rather than two.
	 */
	state: string
	visibility: string
}

/** Where an edge came from, which is a different fact from when. */
export type EdgeProvenance = "lore" | "history" | "scene" | "new"

export const PROVENANCE_WORDS: Record<EdgeProvenance, string> = {
	lore: "from lore",
	history: "from history",
	scene: "from scene",
	new: "this session · new"
}

export interface GraphEdge {
	id: number
	fromKey: string
	toKey: string
	/** The relationship type, as the line is labelled. */
	label: string
	status: string
	description: string
	provenance: EdgeProvenance
	historyEntryId: number | null
	sceneId: number | null
}

/**
 * One end of an edge, as little of it as a drawing needs.
 *
 * Structural rather than the wire type itself so a test can state a pair of
 * endpoints in one line; `Sockets.NarrativeGraph.NarrativeRelationship`
 * satisfies it as it stands.
 */
export type EndpointLike =
	| { kind: "cast"; bindingId: number }
	| { kind: "entry"; entryId: number; name?: string | null; typeId?: string }

export interface RelationshipLike {
	id: number
	from: EndpointLike
	to: EndpointLike
	relationshipType: string
	status: string
	description?: string | null
	historyEntryId: number | null
	sceneId: number | null
}

/** A cast row, as little of it as the graph needs. */
export interface CastNodeLike {
	id: number
	name?: string | null
	binding?: string | null
	nodeState?: string | null
	nodeVisibility?: string | null
}

/** An entry in the scope being drawn. */
export interface ScopeEntryLike {
	id: number
	name: string
}

export const castKey = (id: number): string => `cast#${id}`
export const entryKey = (id: number): string => `entry#${id}`

export function endpointKey(endpoint: EndpointLike): string {
	return endpoint.kind === "cast"
		? castKey(endpoint.bindingId)
		: entryKey(endpoint.entryId)
}

const KEY = /^(cast|entry)#(\d+)$/

/** The thing a key names, or nothing when it names none. */
export function parseGraphKey(
	key: string | null | undefined
): { kind: GraphNodeKind; id: number } | null {
	const match = key ? KEY.exec(key) : null
	if (!match) return null
	return { kind: match[1] as GraphNodeKind, id: Number(match[2]) }
}

/**
 * A cast row's heading.
 *
 * The tag rather than an empty string: `name` is NOT NULL DEFAULT '' on the
 * table, and a node nobody can read is a node nobody can click.
 */
function castName(row: CastNodeLike): string {
	return (row.name ?? "").trim() || (row.binding ?? "").trim() || `#${row.id}`
}

/** The type, drawn the way a reader says it rather than the way it is stored. */
export const edgeLabel = (relationshipType: string): string =>
	relationshipType.replace(/_/g, " ")

export function provenanceOf(
	rel: Pick<RelationshipLike, "id" | "historyEntryId" | "sceneId">,
	newIds?: ReadonlySet<number>
): EdgeProvenance {
	if (newIds?.has(rel.id)) return "new"
	if (rel.sceneId != null) return "scene"
	if (rel.historyEntryId != null) return "history"
	return "lore"
}

export function toGraphEdge(
	rel: RelationshipLike,
	newIds?: ReadonlySet<number>
): GraphEdge {
	return {
		id: rel.id,
		fromKey: endpointKey(rel.from),
		toKey: endpointKey(rel.to),
		label: edgeLabel(rel.relationshipType),
		status: rel.status,
		description: rel.description ?? "",
		provenance: provenanceOf(rel, newIds),
		historyEntryId: rel.historyEntryId,
		sceneId: rel.sceneId
	}
}

export interface GraphNodesInput {
	/** Every member the book holds — a member is on the graph, edges or not. */
	cast: readonly CastNodeLike[]
	relationships: readonly RelationshipLike[]
	/** The entries the scope holds, which is what a selection may reach. */
	scopeEntries: readonly ScopeEntryLike[]
	selectedKey?: string | null
}

/**
 * Who is on the graph.
 *
 * Every cast member, because a member with no relationship is the thing the
 * drawing is asking about. An entry only once something joins it, plus the one
 * the reader has open: an entry nothing reaches is a row, not a node, and
 * drawing every entry in the book would bury the shape the graph is for.
 *
 * ⚠ An entry endpoint carries its own name over the wire, so an edge can put
 * an entry on the canvas without that entry being in the scope on screen.
 */
export function graphNodes(input: GraphNodesInput): GraphNode[] {
	const nodes: GraphNode[] = []
	const seen = new Set<string>()
	const push = (node: GraphNode) => {
		if (seen.has(node.key)) return
		seen.add(node.key)
		nodes.push(node)
	}

	for (const row of input.cast)
		push({
			key: castKey(row.id),
			kind: "cast",
			id: row.id,
			name: castName(row),
			state: row.nodeState || "active",
			visibility: row.nodeVisibility || "normal"
		})

	for (const rel of input.relationships)
		for (const endpoint of [rel.from, rel.to]) {
			if (endpoint.kind !== "entry") continue
			push({
				key: entryKey(endpoint.entryId),
				kind: "entry",
				id: endpoint.entryId,
				name: (endpoint.name ?? "").trim() || `#${endpoint.entryId}`,
				state: "active",
				visibility: "normal"
			})
		}

	const selected = parseGraphKey(input.selectedKey)
	if (selected?.kind === "entry" && !seen.has(input.selectedKey!)) {
		const row = input.scopeEntries.find((e) => e.id === selected.id)
		if (row)
			push({
				key: entryKey(row.id),
				kind: "entry",
				id: row.id,
				name: row.name.trim() || `#${row.id}`,
				state: "active",
				visibility: "normal"
			})
	}

	return nodes
}

/** The edges worth drawing: the ones whose two ends are both on the canvas. */
export function graphEdges(
	relationships: readonly RelationshipLike[],
	nodeKeys: ReadonlySet<string>,
	newIds?: ReadonlySet<number>
): GraphEdge[] {
	return relationships
		.map((rel) => toGraphEdge(rel, newIds))
		.filter((e) => nodeKeys.has(e.fromKey) && nodeKeys.has(e.toKey))
}

export function nodeNames(nodes: readonly GraphNode[]): Map<string, string> {
	return new Map(nodes.map((n) => [n.key, n.name]))
}

/** One edge of the open node, said from that node's side. */
export interface PanelEdge {
	edge: GraphEdge
	direction: "out" | "in"
	arrow: "→" | "←"
	otherKey: string
	otherName: string
	provenanceWord: string
	/**
	 * A broken edge — the one status that means the tie was cut. A resolved
	 * or evolved edge is not cut; it says its own word (`statusWord`).
	 */
	cut: boolean
	/** The status, said beside the edge when it is not `active`; else null. */
	statusWord: string | null
}

export function panelEdges(
	selectedKey: string | null | undefined,
	edges: readonly GraphEdge[],
	names: ReadonlyMap<string, string>
): PanelEdge[] {
	if (!selectedKey) return []
	const rows: PanelEdge[] = []
	for (const edge of edges) {
		const out = edge.fromKey === selectedKey
		const into = edge.toKey === selectedKey
		if (!out && !into) continue
		const otherKey = out ? edge.toKey : edge.fromKey
		rows.push({
			edge,
			direction: out ? "out" : "in",
			arrow: out ? "→" : "←",
			otherKey,
			otherName: names.get(otherKey) ?? otherKey,
			provenanceWord: PROVENANCE_WORDS[edge.provenance],
			cut: edge.status === "broken",
			statusWord:
				edge.status && edge.status !== "active" ? edge.status : null
		})
	}
	return rows
}

/** Which pairing two nodes make, so the picker knows what to offer. */
export const pairingOf = (a: GraphNode, b: GraphNode): LinkPairing =>
	linkPairingOf(a.kind, b.kind)

/** How many of the scope's entries are an end of at least one edge. */
export function entriesWithLinks(
	scopeEntries: readonly ScopeEntryLike[],
	relationships: readonly RelationshipLike[]
): number {
	const linked = new Set<number>()
	for (const rel of relationships)
		for (const endpoint of [rel.from, rel.to])
			if (endpoint.kind === "entry") linked.add(endpoint.entryId)
	return scopeEntries.filter((e) => linked.has(e.id)).length
}

const plural = (n: number, one: string, many: string) =>
	`${n} ${n === 1 ? one : many}`

export interface GraphHeaderInput {
	scopeLabel: string
	entriesWithLinks: number
	entriesTotal: number
	linkCount: number
	/** Scenes whose cast the graph names nothing about. */
	scenesNamingNone: number
}

/** The drawing, said out loud above it. */
export function graphHeaderLine(input: GraphHeaderInput): string {
	const parts = [
		`${input.scopeLabel}, as a graph`,
		`${input.entriesWithLinks} of ${input.entriesTotal} entries have relationships`,
		plural(input.linkCount, "link", "links")
	]
	if (input.scenesNamingNone > 0)
		parts.push(
			input.scenesNamingNone === 1
				? "1 scene names none"
				: `${input.scenesNamingNone} scenes name none`
		)
	return parts.join(" · ")
}

export interface CeilingFacts {
	/** Relationships the newest run sent to the model. */
	sent?: number
	/** Relationships it walked to choose them. */
	held?: number
	/** The type whose edges were cut off, where one was. */
	cappedType?: string
	ceiling?: number
}

/**
 * The run's relationship figures, as the line's facts.
 *
 * ⚠ **`held` is what the run WALKED, not what a member holds.** The mechanism
 * walks the speaker's whole graph under one ceiling, so "4 of 5 sent" is a fact
 * about the turn; a member's own count is a different number and saying it here
 * would put a denominator under a numerator it does not belong to.
 */
export function ceilingFactsFrom(
	block:
		| Sockets.Entries.RecentDecisions.Response["relationships"]
		| null
		| undefined
): CeilingFacts {
	if (!block) return {}
	return {
		sent: block.sent,
		held: block.considered,
		...(block.cap !== undefined ? { ceiling: block.cap } : {}),
		...(block.cappedType ? { cappedType: block.cappedType } : {})
	}
}

/**
 * What the last turn did with the relationships it walked.
 *
 * ⚠ Built from what a run recorded rather than padded with blanks: a figure
 * nobody measured must not appear as a zero, so a run that reported nothing
 * gets no line at all.
 */
export function ceilingLine(facts: CeilingFacts): string | null {
	if (facts.sent == null || facts.held == null) return null
	const parts = [`${facts.sent} of ${facts.held} sent to the model last turn`]
	if (facts.cappedType && facts.ceiling != null)
		parts.push(`${facts.cappedType} hit the ceiling of ${facts.ceiling}`)
	return parts.join(" · ")
}

/** What a Rebuild would delete, counted by the kinds of ends a link joins. */
export interface LinkCounts {
	total: number
	entryToEntry: number
	castToEntry: number
}

/**
 * The counts after one link came (`+1`) or went (`-1`), so the Rebuild
 * warning stays true without re-reading the whole graph.
 */
export function bumpLinkCounts(
	counts: LinkCounts,
	rel: Pick<RelationshipLike, "from" | "to">,
	by: 1 | -1
): LinkCounts {
	const entries =
		(rel.from.kind === "entry" ? 1 : 0) + (rel.to.kind === "entry" ? 1 : 0)
	const clamp = (n: number) => Math.max(0, n)
	return {
		total: clamp(counts.total + by),
		entryToEntry: clamp(counts.entryToEntry + (entries === 2 ? by : 0)),
		castToEntry: clamp(counts.castToEntry + (entries === 1 ? by : 0))
	}
}
