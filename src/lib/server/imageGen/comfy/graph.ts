/**
 * The ComfyUI API-format graph, as plain data (DESIGN-image-generation §4.8).
 *
 * An API export ("Export (API)" in ComfyUI's Dev mode) is an object whose
 * values each carry `class_type` + `inputs`; a link is a two-element array
 * `[sourceNodeId, outputIndex]` with a STRING source id (`graph_utils.is_link`
 * requires one — which is also why prefixed ids like `joy:9` are safe, §1.11).
 *
 * The UI save (`nodes`, `links`, `widgets_values`) is a different format and
 * is refused by name: converting it needs every node's widget order from
 * `/object_info`, which phase 1 does not do.
 */

export interface ComfyNode {
	class_type: string
	inputs: Record<string, unknown>
	_meta?: { title?: string }
	[extra: string]: unknown
}

export type ComfyGraph = Record<string, ComfyNode>

/** A link: `[sourceId, outputIndex]`. */
export type ComfyLink = [string, number]

export const isLink = (v: unknown): v is ComfyLink =>
	Array.isArray(v) &&
	v.length === 2 &&
	typeof v[0] === "string" &&
	typeof v[1] === "number"

/** The exact sentence a UI-format file is refused with (§4.8 step 2). */
export const UI_FORMAT_REFUSAL =
	"This is a ComfyUI UI save (it has nodes and links). Export (API) from ComfyUI's Dev mode and import that file instead."

export const NOT_A_GRAPH_REFUSAL =
	"This is not a ComfyUI API workflow: every entry must have a class_type and inputs."

/**
 * Read a parsed value as an API graph, or say why it is not one. Refuses the
 * UI format by name (`nodes`/`links` keys).
 */
export function asComfyGraph(
	value: unknown
): { ok: true; graph: ComfyGraph } | { ok: false; error: string } {
	if (!value || typeof value !== "object" || Array.isArray(value))
		return { ok: false, error: NOT_A_GRAPH_REFUSAL }
	const obj = value as Record<string, unknown>
	if ("nodes" in obj && "links" in obj)
		return { ok: false, error: UI_FORMAT_REFUSAL }
	const entries = Object.entries(obj)
	if (!entries.length) return { ok: false, error: NOT_A_GRAPH_REFUSAL }
	for (const [, node] of entries) {
		if (
			!node ||
			typeof node !== "object" ||
			typeof (node as ComfyNode).class_type !== "string" ||
			!(node as ComfyNode).inputs ||
			typeof (node as ComfyNode).inputs !== "object"
		)
			return { ok: false, error: NOT_A_GRAPH_REFUSAL }
	}
	return { ok: true, graph: obj as ComfyGraph }
}

/** Every `(consumerId, inputKey)` that links to `sourceId`. */
export function consumersOf(
	graph: ComfyGraph,
	sourceId: string
): Array<{ id: string; key: string }> {
	const out: Array<{ id: string; key: string }> = []
	for (const [id, node] of Object.entries(graph))
		for (const [key, v] of Object.entries(node.inputs ?? {}))
			if (isLink(v) && v[0] === sourceId) out.push({ id, key })
	return out
}

/** The node a link input points at, or undefined. */
export function linked(
	graph: ComfyGraph,
	node: ComfyNode | undefined,
	key: string
): { id: string; node: ComfyNode } | undefined {
	const v = node?.inputs?.[key]
	if (!isLink(v)) return undefined
	const target = graph[v[0]]
	return target ? { id: v[0], node: target } : undefined
}

/** The samplers the fitting walk starts from. */
export const SAMPLER_CLASSES: ReadonlySet<string> = new Set([
	"KSampler",
	"KSamplerAdvanced",
	"SamplerCustom"
])

/** Nodes whose pictures are outputs (never PreviewImage — that is a preview). */
export const SAVE_CLASSES: ReadonlySet<string> = new Set(["SaveImage"])
export const PREVIEW_CLASSES: ReadonlySet<string> = new Set(["PreviewImage"])

/** Node ids in a stable order: numeric ids numerically, then the rest. */
export function sortedIds(graph: ComfyGraph): string[] {
	return Object.keys(graph).sort((a, b) => {
		const na = Number(a)
		const nb = Number(b)
		if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb
		if (Number.isFinite(na)) return -1
		if (Number.isFinite(nb)) return 1
		return a.localeCompare(b)
	})
}
