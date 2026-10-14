/**
 * What a ComfyUI server says it has (`GET /object_info`), cut down to what the
 * validator and the variables panel need (DESIGN-image-generation §4.9):
 * every node class, and every input whose value must be one of a list (a
 * checkpoint, a LoRA, a sampler name). Cached on the connection.
 *
 * Pure: the fetch and the cache live in `serverCheck.ts`.
 */
import { isLink, type ComfyGraph } from "./graph"

export interface ObjectInfoSummary {
	/** Every node class the server can run. */
	classes: string[]
	/** `"<class>.<input>"` → the accepted values. */
	enums: Record<string, string[]>
}

/**
 * Inputs whose enum is a list of uploaded files, never a fact about the
 * server: the host uploads its own references before every run, so a baked
 * `example.png` here says nothing a person must fix.
 */
const isUploadList = (cls: string, key: string) =>
	/^LoadImage/.test(cls) && (key === "image" || key === "upload")

function enumOf(spec: unknown): string[] | null {
	if (!Array.isArray(spec) || !spec.length) return null
	const head = spec[0]
	// Classic: `[["a.safetensors", "b.safetensors"], {…}]`.
	if (Array.isArray(head)) return head.filter((v) => typeof v === "string")
	// Newer servers: `["COMBO", { options: [...] }]`.
	if (head === "COMBO" && spec[1] && typeof spec[1] === "object") {
		const options = (spec[1] as { options?: unknown }).options
		if (Array.isArray(options))
			return options.filter((v): v is string => typeof v === "string")
	}
	return null
}

/** Summarise a raw `/object_info` answer. Unknown shapes are skipped, never thrown on. */
export function summariseObjectInfo(raw: unknown): ObjectInfoSummary {
	const classes: string[] = []
	const enums: Record<string, string[]> = {}
	if (!raw || typeof raw !== "object") return { classes, enums }
	for (const [cls, def] of Object.entries(raw as Record<string, unknown>)) {
		classes.push(cls)
		const input = (def as { input?: Record<string, unknown> } | null)?.input
		if (!input || typeof input !== "object") continue
		for (const group of ["required", "optional"] as const) {
			const fields = input[group]
			if (!fields || typeof fields !== "object") continue
			for (const [key, spec] of Object.entries(
				fields as Record<string, unknown>
			)) {
				if (isUploadList(cls, key)) continue
				const values = enumOf(spec)
				if (values) enums[`${cls}.${key}`] = values
			}
		}
	}
	return { classes, enums }
}

/** The checkpoint and UNET names a server lists — the Comfy connection's models. */
export const MODEL_LOADER_INPUTS: readonly string[] = [
	"CheckpointLoaderSimple.ckpt_name",
	"UNETLoader.unet_name",
	"UnetLoaderGGUF.unet_name"
]

export function modelNamesOf(info: ObjectInfoSummary): string[] {
	const out = new Set<string>()
	for (const key of MODEL_LOADER_INPUTS)
		for (const name of info.enums[key] ?? []) out.add(name)
	return [...out]
}

export interface WorkflowCheck {
	missingNodes: string[]
	missingNames: Array<{
		nodeId: string
		classType: string
		input: string
		value: string
	}>
}

/**
 * Check a RENDERED graph against a server (§4.9): every `class_type` it has,
 * and every literal landing on an enum input among that input's values.
 *
 * `holes` names the inputs (`"<nodeId>.<input>"`) the host fills at run time
 * — the pair's checkpoint in `{{model}}`, an uploaded reference — which are
 * not the document's to answer for and are skipped.
 */
export function checkGraphAgainst(
	graph: ComfyGraph,
	info: ObjectInfoSummary,
	holes: ReadonlySet<string> = new Set()
): WorkflowCheck {
	const known = new Set(info.classes)
	const missingNodes = new Set<string>()
	const missingNames: WorkflowCheck["missingNames"] = []
	for (const [nodeId, node] of Object.entries(graph)) {
		if (!known.has(node.class_type)) {
			missingNodes.add(node.class_type)
			continue
		}
		for (const [input, value] of Object.entries(node.inputs ?? {})) {
			if (typeof value !== "string" || isLink(value)) continue
			if (holes.has(`${nodeId}.${input}`)) continue
			const allowed = info.enums[`${node.class_type}.${input}`]
			if (allowed && !allowed.includes(value))
				missingNames.push({
					nodeId,
					classType: node.class_type,
					input,
					value
				})
		}
	}
	return { missingNodes: [...missingNodes].sort(), missingNames }
}

/**
 * The connection row's sentence for a failed check, in the exact copy §4.9
 * rules, or null when the workflow fits the server.
 */
export function workflowProblem(check: WorkflowCheck): string | null {
	const parts: string[] = []
	if (check.missingNodes.length)
		parts.push(`Missing nodes: ${check.missingNodes.join(", ")}`)
	const names = [...new Set(check.missingNames.map((m) => m.value))]
	for (const name of names)
		parts.push(`This workflow names ${name}; your ComfyUI doesn't have it.`)
	return parts.length ? parts.join(" · ") : null
}
