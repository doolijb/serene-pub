/**
 * Rendering a workflow's holes, and what the holes say about the workflow
 * (DESIGN-image-generation §4.5 "derived", §4.10).
 *
 * The engine is core's Handlebars — the same `renderTemplate` call the prompt
 * rows use — filling the holes internally. Two things differ from a prompt:
 *
 *  - the output must stay JSON, so every string value is escaped for a JSON
 *    string (`"` → `\"`) and handed to Handlebars as an already-safe value,
 *    which keeps its HTML escaping off it;
 *  - the scope is fixed (§4.5): `prompt`, `negative`, `seed`, `steps`, `cfg`,
 *    `width`, `height`, `sampler`, `scheduler`, `clipSkip`, `denoise`,
 *    `model`, `references[].filename`, `init.filename`, `mask.filename`,
 *    `transparent`, `count`, `clientId`, `runId`, `key` — plus the workflow's
 *    own declared variables, at their defaults, and a series item's `vars`.
 */
import {
	CORE_TEMPLATE_ENGINE,
	renderTemplate
} from "$lib/server/pipelines/prompt/renderers"
import type {
	DrawingSheet,
	ImageWorkflowDocument,
	WorkflowVariable
} from "$lib/shared/imageGen/types"
import { asComfyGraph, isLink, type ComfyGraph } from "./graph"

/** The roots a document reads, from its mustaches. `references` is a root. */
export function readsOf(document: string): Set<string> {
	const out = new Set<string>()
	for (const m of document.matchAll(/\{\{\{?~?\s*([^}]*?)\s*~?\}?\}\}/g)) {
		let body = m[1]!.trim()
		if (!body || body.startsWith("!") || body.startsWith("/") || body === "else")
			continue
		body = body.replace(/^[#^]\s*(if|unless|each|with)?\s*/, "")
		body = body.replace(/^else\s+if\s+/, "")
		const token = body.split(/\s+/)[0] ?? ""
		const root = token.split(/[.[]/)[0]
		if (root && /^[A-Za-z_]\w*$/.test(root)) out.add(root)
	}
	return out
}

/** The highest reference index the document reads, plus one; 8 under `{{#each references}}`. */
export function referencesRead(document: string): number {
	if (/\{\{#each\s+references\b/.test(document)) return 8
	let max = -1
	for (const m of document.matchAll(/references\.\[(\d+)\]/g))
		max = Math.max(max, Number(m[1]))
	return max + 1
}

/** A value Handlebars prints as-is: already escaped for a JSON string. */
class JsonSafe {
	constructor(private readonly text: string) {}
	toHTML(): string {
		return JSON.stringify(this.text).slice(1, -1)
	}
	toString(): string {
		return this.text
	}
}

/** Wrap every non-empty string so it renders JSON-escaped and HTML-unescaped. */
function safe(value: unknown): unknown {
	if (typeof value === "string") return value ? new JsonSafe(value) : value
	if (Array.isArray(value)) return value.map(safe)
	if (value && typeof value === "object" && !(value instanceof JsonSafe)) {
		const out: Record<string, unknown> = {}
		for (const [k, v] of Object.entries(value)) out[k] = safe(v)
		return out
	}
	return value
}

/** Set a hole path (`references.[0].filename`) in a scope object. */
export function setPath(scope: Record<string, unknown>, path: string, value: unknown) {
	const parts = path
		.split(".")
		.map((p) => p.replace(/^\[(\d+)\]$/, "$1"))
		.filter(Boolean)
	let cur: any = scope
	for (let i = 0; i < parts.length - 1; i++) {
		const p = parts[i]!
		const nextIsIndex = /^\d+$/.test(parts[i + 1]!)
		if (cur[p] === undefined || cur[p] === null || typeof cur[p] !== "object")
			cur[p] = nextIsIndex ? [] : {}
		cur = cur[p]
	}
	cur[parts[parts.length - 1]!] = value
}

/** A scope holding every declared variable at its default. */
export function defaultScope(variables: readonly WorkflowVariable[]): Record<string, unknown> {
	const scope: Record<string, unknown> = {}
	for (const v of variables)
		if (v.default !== undefined) setPath(scope, v.name, v.default)
	return scope
}

/** Merge `over` onto `base` deeply for plain objects/arrays, leaving `base` intact. */
export function mergeScope(
	base: Record<string, unknown>,
	over: Record<string, unknown>
): Record<string, unknown> {
	const out: Record<string, unknown> = { ...base }
	for (const [k, v] of Object.entries(over)) {
		if (v === undefined) continue
		const b = out[k]
		if (
			v &&
			typeof v === "object" &&
			b &&
			typeof b === "object" &&
			Array.isArray(v) === Array.isArray(b)
		) {
			if (Array.isArray(v)) {
				const arr = [...(b as unknown[])]
				v.forEach((item, i) => {
					arr[i] =
						item && typeof item === "object" && arr[i] && typeof arr[i] === "object"
							? mergeScope(arr[i] as Record<string, unknown>, item as Record<string, unknown>)
							: item
				})
				out[k] = arr
			} else out[k] = mergeScope(b as Record<string, unknown>, v as Record<string, unknown>)
		} else out[k] = v
	}
	return out
}

export class WorkflowRenderError extends Error {}

/** Render the document with `scope` and parse it as an API graph. */
export async function renderWorkflow(
	document: string,
	scope: Record<string, unknown>
): Promise<ComfyGraph> {
	let text: string
	try {
		text = await renderTemplate(CORE_TEMPLATE_ENGINE, {
			template: document,
			variables: safe(scope) as Record<string, unknown>
		})
	} catch (e) {
		throw new WorkflowRenderError(
			`The workflow's holes could not be filled: ${e instanceof Error ? e.message : String(e)}`
		)
	}
	let parsed: unknown
	try {
		parsed = JSON.parse(text)
	} catch (e) {
		throw new WorkflowRenderError(
			`The filled-in workflow is not valid JSON (${e instanceof Error ? e.message : String(e)}). A number hole needs a value: give every variable a default.`
		)
	}
	const graph = asComfyGraph(parsed)
	if (!graph.ok) throw new WorkflowRenderError(graph.error)
	return graph.graph
}

/** A marker no real value contains, for telling holes from literals. */
export const HOLE_SENTINEL = "\u0001serene-hole\u0001"

/**
 * Render with the defaults, and find which inputs are holes: a second render
 * puts a sentinel in every string variable, and an input carrying it was
 * filled by the host rather than written by the author.
 */
export async function sampleRender(
	workflow: Pick<ImageWorkflowDocument, "document" | "variables">
): Promise<{ graph: ComfyGraph; holes: Set<string> }> {
	const base = mergeScope(sampleStandardScope(), defaultScope(workflow.variables))
	const graph = await renderWorkflow(workflow.document, base)
	const marked = sentinelScope(base)
	const holes = new Set<string>()
	try {
		const probe = await renderWorkflow(workflow.document, marked)
		for (const [id, node] of Object.entries(probe))
			for (const [key, v] of Object.entries(node.inputs ?? {}))
				if (typeof v === "string" && v.includes(HOLE_SENTINEL))
					holes.add(`${id}.${key}`)
	} catch {
		// A document whose structure depends on a string's value; the
		// literal check then just checks more.
	}
	return { graph, holes }
}

/** Values for the standard names, so a sample render never leaves a number hole empty. */
function sampleStandardScope(): Record<string, unknown> {
	return {
		prompt: "a test picture",
		negative: "",
		seed: 1,
		steps: 20,
		cfg: 7,
		width: 1024,
		height: 1024,
		sampler: "euler",
		scheduler: "normal",
		clipSkip: 1,
		denoise: 1,
		model: "model.safetensors",
		transparent: false,
		count: 1,
		clientId: "sample",
		runId: "sample",
		key: "1",
		init: { filename: "init.png" },
		mask: { filename: "mask.png" },
		references: Array.from({ length: 8 }, (_, i) => ({ filename: `reference-${i}.png` }))
	}
}

function sentinelScope(scope: Record<string, unknown>): Record<string, unknown> {
	const walk = (v: unknown): unknown =>
		typeof v === "string"
			? HOLE_SENTINEL
			: Array.isArray(v)
				? v.map(walk)
				: v && typeof v === "object"
					? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]))
					: v
	return walk(scope) as Record<string, unknown>
}

/** Find the empty latent feeding the output's chain, for the baked size and batch. */
function bakedLatent(graph: ComfyGraph, outputNode: string | null) {
	const latents = Object.values(graph).filter(
		(n) => /^Empty.*Latent/.test(n.class_type) && "width" in n.inputs
	)
	if (outputNode && graph[outputNode]) {
		// Walk back from the output to the first empty latent upstream.
		const seen = new Set<string>()
		const stack = [outputNode]
		while (stack.length) {
			const id = stack.pop()!
			if (seen.has(id)) continue
			seen.add(id)
			const node = graph[id]
			if (!node) continue
			if (/^Empty.*Latent/.test(node.class_type) && "width" in node.inputs) return node
			for (const v of Object.values(node.inputs ?? {})) if (isLink(v)) stack.push(v[0])
		}
	}
	return latents[0]
}

export const SERIES_MAX_DEFAULT = 8

/**
 * The drawing sheet a workflow implies (§4.5): a knob is honoured iff the
 * document reads it. Size is free when it reads `width`/`height`, else the one
 * size baked into the graph; references from the highest index read; alpha
 * native iff it reads `transparent`. `perRun` is the marked output's latent
 * batch — 1 when it reads `count`, since the host asks one per item.
 */
export async function deriveComfySheet(
	workflow: Pick<ImageWorkflowDocument, "document" | "variables" | "outputNode">,
	seriesMax = SERIES_MAX_DEFAULT
): Promise<DrawingSheet> {
	const reads = readsOf(workflow.document)
	const refs = referencesRead(workflow.document)
	let baked: { width?: number; height?: number; batch?: number } = {}
	try {
		const { graph } = await sampleRender(workflow)
		const latent = bakedLatent(graph, workflow.outputNode)
		if (latent)
			baked = {
				width: num(latent.inputs.width),
				height: num(latent.inputs.height),
				batch: num(latent.inputs.batch_size)
			}
	} catch {
		// An unrenderable document still has a sheet; its size is unknown.
	}
	const free = reads.has("width") && reads.has("height")
	return {
		negative: reads.has("negative"),
		seed: reads.has("seed"),
		steps: reads.has("steps"),
		cfg: reads.has("cfg"),
		sampler: reads.has("sampler") || reads.has("scheduler"),
		clipSkip: reads.has("clipSkip"),
		size: free
			? { kind: "free", step: 8, min: 64, max: 4096 }
			: {
					kind: "enum",
					sizes:
						baked.width && baked.height ? [`${baked.width}x${baked.height}`] : []
				},
		references: refs > 0 ? { max: refs } : null,
		init: reads.has("init"),
		mask: reads.has("mask"),
		transparent: reads.has("transparent") ? "native" : "none",
		perCall: Math.max(1, Math.floor(seriesMax)),
		outputs: {
			perRun: reads.has("count") ? 1 : Math.max(1, baked.batch ?? 1),
			keyed: true
		},
		progress: true,
		preview: true,
		cancel: true,
		video: false,
		payload: "template"
	}
}

const num = (v: unknown): number | undefined =>
	typeof v === "number" && Number.isFinite(v) ? v : undefined

