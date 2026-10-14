/**
 * The **series merge** — many pictures from one ComfyUI queue call
 * (DESIGN-image-generation §4.7 rule 1, §4.11).
 *
 * The host renders the one-branch workflow once per series item, prefixes
 * every node id in that render with the item's key (`joy:3`, `joy:9`; links
 * rewritten alike — `POST /prompt` accepts string ids, verified §1.11), merges
 * the renders into one prompt, and DEDUPES nodes whose content is identical
 * across items: the checkpoint loader and a shared reference `LoadImage`
 * appear once, and everything downstream of them points at the survivor.
 *
 * Identity is structural, computed bottom-up: a node's signature is its class
 * and inputs with every link replaced by its SOURCE's signature. Two loaders
 * with the same file share a signature; two samplers fed different prompts do
 * not. Output nodes (`SaveImage`, `PreviewImage`) never merge, so every item
 * keeps its own keyed output.
 *
 * Pure.
 */
import { isLink, PREVIEW_CLASSES, SAVE_CLASSES, type ComfyGraph, type ComfyNode } from "./graph"

export interface KeyedRender {
	/** Sanitised (§4.11): never contains `:`. */
	key: string
	graph: ComfyGraph
}

export interface MergedPrompt {
	prompt: ComfyGraph
	/** The merged id of each item's marked output node. */
	outputs: Record<string, string>
}

/** `joy:9` → `joy`. An id with no prefix has no key. */
export function keyOfNodeId(id: string): string | null {
	const at = id.indexOf(":")
	return at > 0 ? id.slice(0, at) : null
}

/** `joy:9` → `9`. */
export function localIdOf(id: string): string {
	const at = id.indexOf(":")
	return at > 0 ? id.slice(at + 1) : id
}

/** Prefix every node id and every link in one render. */
export function prefixGraph(graph: ComfyGraph, key: string): ComfyGraph {
	const out: ComfyGraph = {}
	const p = (id: string) => `${key}:${id}`
	for (const [id, node] of Object.entries(graph)) {
		const inputs: Record<string, unknown> = {}
		for (const [k, v] of Object.entries(node.inputs ?? {}))
			inputs[k] = isLink(v) && v[0] in graph ? [p(v[0]), v[1]] : v
		out[p(id)] = { ...node, inputs }
	}
	return out
}

const isOutput = (n: ComfyNode) =>
	SAVE_CLASSES.has(n.class_type) || PREVIEW_CLASSES.has(n.class_type)

/**
 * Merge per-item renders into one prompt. `outputNode` is the workflow's
 * marked output id (unprefixed); each item's survivor is reported under its
 * key.
 */
export function mergeKeyedRenders(
	renders: readonly KeyedRender[],
	outputNode: string | null
): MergedPrompt {
	const prefixed = renders.map((r) => ({ key: r.key, graph: prefixGraph(r.graph, r.key) }))
	const all: ComfyGraph = Object.assign({}, ...prefixed.map((r) => r.graph))

	// Signatures, bottom-up with memo; a cycle (never valid in Comfy) falls
	// back to the node's own id, which simply prevents a merge.
	const sig = new Map<string, string>()
	const visiting = new Set<string>()
	const signature = (id: string): string => {
		const known = sig.get(id)
		if (known) return known
		const node = all[id]
		if (!node || visiting.has(id)) return `@${id}`
		visiting.add(id)
		const inputs: Record<string, unknown> = {}
		for (const k of Object.keys(node.inputs ?? {}).sort()) {
			const v = node.inputs[k]
			inputs[k] = isLink(v) ? { link: signature(v[0]), out: v[1] } : v
		}
		visiting.delete(id)
		const s = isOutput(node)
			? `@${id}`
			: JSON.stringify({ c: node.class_type, i: inputs })
		sig.set(id, s)
		return s
	}

	const survivor = new Map<string, string>() // signature → merged id
	const rename = new Map<string, string>() // original prefixed id → merged id
	for (const r of prefixed)
		for (const id of Object.keys(r.graph)) {
			const s = signature(id)
			const kept = survivor.get(s)
			if (kept) rename.set(id, kept)
			else {
				survivor.set(s, id)
				rename.set(id, id)
			}
		}

	const prompt: ComfyGraph = {}
	for (const [id, node] of Object.entries(all)) {
		if (rename.get(id) !== id) continue
		const inputs: Record<string, unknown> = {}
		for (const [k, v] of Object.entries(node.inputs ?? {}))
			inputs[k] = isLink(v) ? [rename.get(v[0]) ?? v[0], v[1]] : v
		prompt[id] = { ...node, inputs }
	}

	const outputs: Record<string, string> = {}
	if (outputNode)
		for (const r of renders) {
			const id = `${r.key}:${outputNode}`
			if (prompt[id]) outputs[r.key] = id
		}
	return { prompt, outputs }
}

/** Split a series into chunks of at most `max` items. */
export function chunkSeries<T>(items: readonly T[], max: number): T[][] {
	const size = Math.max(1, Math.floor(max || 1))
	const out: T[][] = []
	for (let at = 0; at < items.length; at += size) out.push(items.slice(at, at + size))
	return out
}
