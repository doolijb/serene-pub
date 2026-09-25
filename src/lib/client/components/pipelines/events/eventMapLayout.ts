/**
 * The event map's geometry (PLAN-turn-order §B2): B1's `eventMap` — events,
 * specs and listeners joined by binds / causes / listens — laid out by ELK's
 * layered algorithm into Svelte Flow nodes and edges.
 *
 * Only the connected part is drawn: an event nothing binds, causes or hears
 * is a row in the registry above the map, and a hundred loose boxes would
 * bury the cycles the map is for. `connectedOnly` says which ids survive, so
 * the page can say how many it left out.
 *
 * Cycles are the point (respond → message-completed → turn order → auto-
 * advance → respond); ELK's layered algorithm breaks them for layering and
 * draws the back edge, which is exactly the reading wanted. elkjs is
 * dynamic-imported, as the pipeline map does, so its bundle loads with the map.
 */
import type { Node, Edge } from "@xyflow/svelte"
import { MarkerType, Position } from "@xyflow/svelte"

type EventMapNode = Sockets.Pipelines.EventMap.MapNode
type EventMapEdge = Sockets.Pipelines.EventMap.MapEdge

export const EVENT_NODE_W = 230
export const EVENT_NODE_H = 52

/** The ids with at least one edge — the drawn part of the map. */
export function connectedOnly(map: {
	nodes: EventMapNode[]
	edges: EventMapEdge[]
}): Set<string> {
	const ids = new Set<string>()
	for (const e of map.edges) {
		ids.add(e.from)
		ids.add(e.to)
	}
	return ids
}

/** What each edge kind means, for the legend and the edge's tooltip. */
export const EDGE_MEANING: Record<EventMapEdge["kind"], string> = {
	binds: "the pipeline's inlet answers this event",
	causes: "running it records this event",
	listens: "this listener hears the event"
}

/**
 * Edge colour by kind — roles with stops, never hex (STYLE-GUIDE §2). Not
 * primary: that is for what the reader can act on, and an edge is not a
 * control. Each kind also has its own dash, so colour is never the only cue.
 */
export const EDGE_COLOUR: Record<EventMapEdge["kind"], string> = {
	binds: "var(--color-secondary-500)",
	causes: "var(--color-tertiary-500)",
	listens: "var(--color-surface-500)"
}

export const EDGE_DASH: Record<EventMapEdge["kind"], string> = {
	binds: "",
	causes: "6 3",
	listens: "2 3"
}

export async function layoutEventMap(map: {
	nodes: EventMapNode[]
	edges: EventMapEdge[]
}): Promise<{ nodes: Node[]; edges: Edge[] }> {
	const keep = connectedOnly(map)
	const drawn = map.nodes.filter((n) => keep.has(n.id))
	const known = new Set(drawn.map((n) => n.id))
	// An edge to an id the map has no node for (a lock on an event no package
	// declares any more) is dropped rather than drawn to nowhere.
	const edges = map.edges.filter((e) => known.has(e.from) && known.has(e.to))

	const { default: ELK } = await import("elkjs/lib/elk.bundled.js")
	const elk = new ELK()
	const laidOut = await elk.layout({
		id: "__root__",
		layoutOptions: {
			"elk.algorithm": "layered",
			"elk.direction": "RIGHT",
			"elk.spacing.nodeNode": "22",
			"elk.layered.spacing.nodeNodeBetweenLayers": "56",
			"elk.spacing.edgeNode": "18",
			"elk.layered.cycleBreaking.strategy": "DEPTH_FIRST",
			"elk.padding": "[top=8,left=8,bottom=8,right=8]"
		},
		children: drawn.map((n) => ({
			id: n.id,
			width: EVENT_NODE_W,
			height: EVENT_NODE_H
		})),
		edges: edges.map((e, i) => ({
			id: `e${i}`,
			sources: [e.from],
			targets: [e.to]
		}))
	})

	const byId = new Map(drawn.map((n) => [n.id, n]))
	const flowNodes: Node[] = (laidOut.children ?? []).map((c: any) => ({
		id: c.id,
		type: "eventMapNode",
		position: { x: c.x ?? 0, y: c.y ?? 0 },
		width: c.width,
		height: c.height,
		data: { node: byId.get(c.id)! },
		sourcePosition: Position.Right,
		targetPosition: Position.Left,
		draggable: false,
		connectable: false,
		deletable: false
	}))
	const flowEdges: Edge[] = edges.map((e, i) => ({
		id: `e${i}:${e.kind}`,
		source: e.from,
		target: e.to,
		type: "smoothstep",
		markerEnd: { type: MarkerType.ArrowClosed, color: EDGE_COLOUR[e.kind] },
		style: `stroke:${EDGE_COLOUR[e.kind]};stroke-width:1.5;${
			EDGE_DASH[e.kind] ? `stroke-dasharray:${EDGE_DASH[e.kind]};` : ""
		}`,
		selectable: false,
		focusable: false
	}))
	return { nodes: flowNodes, edges: flowEdges }
}
