/**
 * The map's geometry: the wire graph (`pipelines:detail`) laid out by ELK's
 * layered algorithm into Svelte Flow nodes and edges.
 *
 * The wire carries three facts — nodes in position order, blocks (with
 * `parentBlockId`, so nesting is representable), and data edges. The drawing
 * wants *flow*, so the edges built here are structural: the spine connects
 * consecutive top-level elements, and inside a block each chain runs its
 * members in sequence behind a small chain-label node (which is where a
 * route's predicate reads as a sentence, 20 §10). Chains have no edges
 * between them, which is exactly what makes ELK lay them out side by side.
 *
 * ELK compounds map one-to-one onto blocks: each block is a container laid
 * out with its own padded scope (`SEPARATE_CHILDREN` semantics — every edge
 * lives in the scope of its endpoints' shared parent), and nested blocks
 * recurse. elkjs is dynamic-imported so its ~700KB only loads with the map.
 */
import type { Node, Edge } from "@xyflow/svelte"
import { MarkerType, Position } from "@xyflow/svelte"

type WireGraph = NonNullable<
	NonNullable<Sockets.Pipelines.Detail.Response["spec"]>["graph"]
>
type WireNode = WireGraph["nodes"][number]
type WireBlock = WireGraph["blocks"][number]

export type FlowDirection = "DOWN" | "RIGHT"

export const STEP_W = 220
export const STEP_H = 58
const CHAIN_W = 180
const CHAIN_H = 24
/** Room for the block header bar inside the frame. */
const BLOCK_PAD_TOP = 46
const BLOCK_PAD = 14

/**
 * A route branch's predicate, as the sentence its declaration is:
 * "when call = search" / "when hasText" / "otherwise".
 */
const routeWhen = (
	block: WireBlock | undefined,
	chain: string
): string | null => {
	const r = block?.routes?.[chain]
	if (!r) return null
	if (r.default) return "otherwise"
	const subject = r.path ? r.path : "value"
	if (r.equals !== undefined)
		return `when ${subject} = ${JSON.stringify(r.equals)}`
	if (r.truthy) return `when ${subject}`
	return null
}

const humanizeChain = (v: string) =>
	v
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.replace(/^./, (c) => c.toUpperCase())

/** Walks a node's block ancestry up to the child of `scope` (null = root). */
function containerWithin(
	blockId: string | null,
	scope: string | null,
	byId: Map<string, WireBlock>
): string | null {
	let current = blockId
	while (current) {
		const block = byId.get(current)
		const parent = block?.parentBlockId ?? null
		if (parent === scope) return current
		current = parent
	}
	return null
}

interface Scope {
	/** null = the root spine. */
	blockId: string | null
	/** Ordered element ids: node keys and (for blocks in this scope) block ids. */
	sequence: string[]
	elkChildren: any[]
	elkEdges: any[]
}

export async function layoutPipeline(
	graph: WireGraph,
	direction: FlowDirection
): Promise<{ nodes: Node[]; edges: Edge[] }> {
	const blocks = graph.blocks ?? []
	const blockById = new Map(blocks.map((b) => [b.id, b]))
	const vertical = direction === "DOWN"
	const sourcePosition = vertical ? Position.Bottom : Position.Right
	const targetPosition = vertical ? Position.Top : Position.Left

	const edgeDefaults = {
		type: "smoothstep" as const,
		markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 }
	}

	const flowEdges: Edge[] = []
	const nodeData = new Map<string, Record<string, unknown>>()

	const stepElk = (id: string) => ({ id, width: STEP_W, height: STEP_H })

	const scopeOptions = {
		"elk.algorithm": "layered",
		"elk.direction": direction,
		"elk.spacing.nodeNode": "26",
		"elk.layered.spacing.nodeNodeBetweenLayers": "36",
		"elk.spacing.edgeNode": "16"
	}

	/** Builds one scope (root or a block) into ELK children + edges. */
	function buildScope(scopeId: string | null): Scope {
		const scope: Scope = {
			blockId: scopeId,
			sequence: [],
			elkChildren: [],
			elkEdges: []
		}
		const seen = new Set<string>()
		const chains = new Map<string, WireNode[]>()

		for (const n of graph.nodes) {
			const container = containerWithin(n.blockId, scopeId, blockById)
			if (n.blockId === scopeId || (scopeId === null && !n.blockId)) {
				// A direct member of this scope.
				if (scopeId === null) {
					scope.sequence.push(n.key)
					scope.elkChildren.push(stepElk(n.key))
					nodeData.set(n.key, { wire: n })
				} else {
					const chainKey = n.blockChain ?? ""
					if (!chains.has(chainKey)) chains.set(chainKey, [])
					chains.get(chainKey)!.push(n)
				}
			} else if (container && !seen.has(container)) {
				// A descendant of a block that sits in this scope: the block
				// itself is the element here, built recursively once.
				seen.add(container)
				scope.sequence.push(container)
				const inner = buildScope(container)
				const block = blockById.get(container)!
				scope.elkChildren.push({
					id: container,
					layoutOptions: {
						...scopeOptions,
						"elk.padding": `[top=${BLOCK_PAD_TOP},left=${BLOCK_PAD},bottom=${BLOCK_PAD},right=${BLOCK_PAD}]`
					},
					children: inner.elkChildren,
					edges: inner.elkEdges
				})
				nodeData.set(container, { block })
			}
		}

		if (scopeId !== null) {
			// Chains: members run in sequence behind a caption node — but only
			// when the caption says something the cards don't. A single-node
			// chain is usually named after its node, so a label there reads
			// as a duplicated title; it earns its place only for a route's
			// predicate or to name a multi-node lane.
			const block = blockById.get(scopeId)
			for (const [chainKey, members] of chains) {
				const labelId = `${scopeId}::chain::${chainKey}`
				const predicate = routeWhen(block, chainKey)
				const withLabel = predicate !== null || members.length > 1
				if (withLabel) {
					scope.elkChildren.push({
						id: labelId,
						width: CHAIN_W,
						height: CHAIN_H
					})
					nodeData.set(labelId, {
						chain: humanizeChain(chainKey || "main"),
						predicate,
						index:
							chains.size > 1
								? [...chains.keys()].indexOf(chainKey)
								: null
					})
				}
				let prev = withLabel ? labelId : null
				for (const m of members) {
					scope.elkChildren.push(stepElk(m.key))
					nodeData.set(m.key, { wire: m })
					if (prev !== null) {
						scope.elkEdges.push({
							id: `e:${prev}->${m.key}`,
							sources: [prev],
							targets: [m.key]
						})
						flowEdges.push({
							id: `e:${prev}->${m.key}`,
							source: prev,
							target: m.key,
							...edgeDefaults,
							...(prev === labelId
								? { markerEnd: undefined, style: "opacity:.55" }
								: {})
						})
					}
					prev = m.key
				}
			}
		}

		// The spine: consecutive elements of this scope, in position order.
		for (let i = 1; i < scope.sequence.length; i++) {
			const a = scope.sequence[i - 1]
			const b = scope.sequence[i]
			scope.elkEdges.push({
				id: `e:${a}->${b}`,
				sources: [a],
				targets: [b]
			})
			flowEdges.push({
				id: `e:${a}->${b}`,
				source: a,
				target: b,
				...edgeDefaults
			})
		}
		return scope
	}

	const root = buildScope(null)

	const { default: ELK } = await import("elkjs/lib/elk.bundled.js")
	const elk = new ELK()
	const laidOut = await elk.layout({
		id: "__root__",
		layoutOptions: {
			...scopeOptions,
			"elk.padding": "[top=8,left=8,bottom=8,right=8]"
		},
		children: root.elkChildren,
		edges: root.elkEdges
	})

	// ELK positions are relative to the parent — exactly Svelte Flow's model
	// for child nodes. Parents must precede children in the array.
	const flowNodes: Node[] = []
	const walk = (elkNode: any, parentId?: string) => {
		for (const child of elkNode.children ?? []) {
			const data = nodeData.get(child.id) ?? {}
			const isBlock = "block" in data
			const isChain = "chain" in data
			flowNodes.push({
				id: child.id,
				type: isBlock ? "block" : isChain ? "chain" : "step",
				position: { x: child.x ?? 0, y: child.y ?? 0 },
				width: child.width,
				height: child.height,
				data,
				sourcePosition,
				targetPosition,
				draggable: false,
				connectable: false,
				deletable: false,
				...(parentId ? { parentId, extent: "parent" as const } : {}),
				...(isBlock ? { zIndex: -1 } : {})
			})
			if (isBlock) walk(child, child.id)
		}
	}
	walk(laidOut)

	return { nodes: flowNodes, edges: flowEdges }
}
