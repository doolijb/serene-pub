/**
 * **Fitting** — the walk that turns a person's own ComfyUI export into a
 * workflow with holes (DESIGN-image-generation §4.8 step 3, §1.11).
 *
 * `fitComfyWorkflow` proposes; `applyFit` rewrites. Both are pure, so the
 * Workflows tab can run the walk on a pasted file and show the proposal before
 * anything is saved (`workflows:fit`).
 *
 * The walk, from each sampler (`KSampler`, `KSamplerAdvanced`,
 * `SamplerCustom`):
 *  - `positive` / `negative` → through conditioning modifiers to the
 *    `CLIPTextEncode` whose `text` becomes `{{prompt}}` / `{{negative}}`;
 *  - `latent_image` → the empty latent's `width` / `height` / `batch_size`
 *    (`{{width}}`, `{{height}}`, `{{count}}`);
 *  - `model` → back through LoRA (and any other model-patching) nodes to the
 *    loader, whose `ckpt_name` / `unet_name` is promoted to `{{model}}` BY
 *    DEFAULT — the checkpoint is the pair's model (§4.10);
 *  - `seed` / `steps` / `cfg` / `sampler_name` / `scheduler` on the sampler.
 * `LoadImage` nodes become a reference, the starting canvas or the mask, by
 * what consumes them. `SaveImage` nodes are outputs; the one fed by the final
 * decode of the main chain carries the **output mark**. Marker nodes
 * (`SwarmInput*`, `ETN_Parameter`, `ComfyUIDeployExternal*`) are recognised as
 * declared variables — never required, and we ship no node pack (§4.9).
 *
 * Every other scalar literal is offered as promotable, unchosen.
 */
import type { WorkflowVariable } from "$lib/shared/imageGen/types"
import {
	asComfyGraph,
	consumersOf,
	isLink,
	linked,
	PREVIEW_CLASSES,
	SAMPLER_CLASSES,
	SAVE_CLASSES,
	sortedIds,
	type ComfyGraph,
	type ComfyNode
} from "./graph"
import type { ObjectInfoSummary } from "./objectInfo"

/**
 * The scope names the host fills from the request (§4.5). A hole on one of
 * these is fed by the sampling config and the step; any other name is a
 * promoted variable whose value is its declared default.
 */
export const STANDARD_VARIABLES: readonly string[] = [
	"prompt",
	"negative",
	"seed",
	"steps",
	"cfg",
	"width",
	"height",
	"sampler",
	"scheduler",
	"clipSkip",
	"denoise",
	"model",
	"transparent",
	"count",
	"clientId",
	"runId",
	"key"
]

/**
 * Names a promoted variable must never take: Handlebars' own helpers and the
 * ones core's renderer registers. `{{eq}}` would call the helper, not read the
 * value.
 */
const RESERVED_NAMES: ReadonlySet<string> = new Set([
	"if",
	"unless",
	"each",
	"with",
	"lookup",
	"log",
	"eq",
	"ne",
	"and",
	"or",
	"pad",
	"isSet",
	"json",
	"jsonValue",
	"strokeList",
	"references",
	"init",
	"mask",
	"this"
])

export interface FitHole {
	nodeId: string
	inputKey: string
	/** The scope path the hole reads (`prompt`, `references.[0].filename`, `lora_name`). */
	variable: string
	/** The value the export carried — the variable's default. */
	literal: unknown
	/** Fed by the request (a §4.5 scope name) rather than by a declared default. */
	standard: boolean
	/** Proposed as chosen. Unchosen holes stay literal unless the person picks them. */
	suggested: boolean
	/** Why the walk proposed it, for the confirm form. */
	reason: string
	/** For a string on an enum input: where its options come from. */
	enumSource?: string
	label?: string
	min?: number
	max?: number
	step?: number
	group?: string
	/** A marker node's declared type, when there was one. */
	markerType?: WorkflowVariable["type"]
}

export interface FitOutput {
	nodeId: string
	classType: string
	/** `output` carries the mark; `extra` is kept unkeyed; `preview` is never an output. */
	role: "output" | "extra" | "preview"
}

export interface FitProposal {
	holes: FitHole[]
	outputs: FitOutput[]
	warnings: string[]
}

/** Run the walk. Throws nothing: a non-graph comes back as one warning and no holes. */
export function fitComfyWorkflow(
	input: unknown,
	objectInfo?: ObjectInfoSummary | null
): FitProposal {
	const parsed = asComfyGraph(input)
	if (!parsed.ok) return { holes: [], outputs: [], warnings: [parsed.error] }
	const graph = parsed.graph
	const holes: FitHole[] = []
	const warnings: string[] = []
	const taken = new Set<string>()
	const usedNames = new Set<string>()
	const at = (nodeId: string, inputKey: string) => `${nodeId}.${inputKey}`

	const add = (h: FitHole) => {
		const k = at(h.nodeId, h.inputKey)
		if (taken.has(k)) return
		const node = graph[h.nodeId]
		const v = node?.inputs?.[h.inputKey]
		if (v === undefined || isLink(v)) return
		taken.add(k)
		usedNames.add(h.variable)
		holes.push({
			...h,
			...(h.enumSource
				? {}
				: enumSourceFor(node!, h.inputKey, v, objectInfo)
					? { enumSource: enumSourceFor(node!, h.inputKey, v, objectInfo)! }
					: {})
		})
	}

	// ── Markers first: a declared variable is the author's word ────────────
	for (const id of sortedIds(graph)) {
		const marker = readMarker(id, graph[id]!)
		if (!marker) continue
		const slug = toVariableName(marker.title) || `input_${id}`
		const standard = STANDARD_VARIABLES.includes(slug)
		const name = standard ? slug : uniqueName(slug, usedNames)
		add({
			nodeId: id,
			inputKey: marker.inputKey,
			variable: name,
			literal: graph[id]!.inputs[marker.inputKey],
			standard,
			suggested: true,
			reason: `Declared by the ${graph[id]!.class_type} node "${marker.title}".`,
			...(marker.title ? { label: marker.title } : {}),
			...(marker.type ? { markerType: marker.type } : {}),
			...(marker.min !== undefined ? { min: marker.min } : {}),
			...(marker.max !== undefined ? { max: marker.max } : {}),
			...(marker.step !== undefined ? { step: marker.step } : {}),
			...(marker.group ? { group: marker.group } : {})
		})
	}

	// ── The samplers ─────────────────────────────────────────────────────────
	const samplers = sortedIds(graph).filter((id) =>
		SAMPLER_CLASSES.has(graph[id]!.class_type)
	)
	if (!samplers.length)
		warnings.push(
			"No sampler found (KSampler, KSamplerAdvanced or SamplerCustom), so nothing was proposed from the graph's shape. Promote the inputs you want by hand."
		)
	// The MAIN sampler is the one drawing from an empty latent — the first
	// pass. A second pass (hires fix) keeps its own literals, promotable.
	const emptyLatentOf = (id: string) => {
		const l = linked(graph, graph[id], "latent_image")
		return l && isEmptyLatent(l.node) ? l : undefined
	}
	const main = samplers.find((id) => emptyLatentOf(id)) ?? samplers[0]

	for (const id of samplers) {
		const node = graph[id]!
		const isMain = id === main
		const suffix = isMain ? "" : `_${id}`
		const seedKey = node.class_type === "KSampler" ? "seed" : "noise_seed"
		const scalar = (
			inputKey: string,
			variable: string,
			reason: string,
			owner = id
		) =>
			add({
				nodeId: owner,
				inputKey,
				variable: isMain ? variable : uniqueName(`${variable}${suffix}`, usedNames),
				literal: graph[owner]!.inputs[inputKey],
				standard: isMain,
				suggested: isMain,
				reason
			})
		// Every sampler shares one seed: a second pass on another seed is
		// rarely meant, and a person can still un-choose it.
		add({
			nodeId: id,
			inputKey: seedKey,
			variable: "seed",
			literal: node.inputs[seedKey],
			standard: true,
			suggested: true,
			reason: `The ${node.class_type}'s seed.`
		})
		scalar("steps", "steps", `The ${node.class_type}'s step count.`)
		scalar("cfg", "cfg", `The ${node.class_type}'s CFG.`)
		scalar("sampler_name", "sampler", `The ${node.class_type}'s sampler.`)
		scalar("scheduler", "scheduler", `The ${node.class_type}'s scheduler.`)
		// SamplerCustom keeps its sampler and schedule on linked nodes.
		const pick = linked(graph, node, "sampler")
		if (pick && "sampler_name" in pick.node.inputs)
			scalar("sampler_name", "sampler", "The sampler the SamplerCustom uses.", pick.id)
		const sigmas = linked(graph, node, "sigmas")
		if (sigmas) {
			if ("steps" in sigmas.node.inputs)
				scalar("steps", "steps", "The schedule's step count.", sigmas.id)
			if ("scheduler" in sigmas.node.inputs)
				scalar("scheduler", "scheduler", "The schedule's scheduler.", sigmas.id)
		}

		for (const [port, variable] of [
			["positive", "prompt"],
			["negative", "negative"]
		] as const) {
			const enc = textEncoderUpstream(graph, node, port)
			if (!enc) continue
			for (const key of TEXT_KEYS)
				if (typeof enc.node.inputs[key] === "string")
					add({
						nodeId: enc.id,
						inputKey: key,
						variable,
						literal: enc.node.inputs[key],
						standard: true,
						suggested: true,
						reason: `The text the ${node.class_type} reads as its ${port} prompt.`
					})
		}

		const latent = emptyLatentOf(id)
		if (latent && isMain) {
			for (const [key, variable] of [
				["width", "width"],
				["height", "height"],
				["batch_size", "count"]
			] as const)
				if (typeof latent.node.inputs[key] === "number")
					add({
						nodeId: latent.id,
						inputKey: key,
						variable,
						literal: latent.node.inputs[key],
						standard: true,
						suggested: true,
						reason:
							key === "batch_size"
								? "How many pictures one item draws."
								: `The picture's ${key}.`
					})
		} else if (isMain && typeof node.inputs.denoise === "number") {
			// Drawing over a canvas: the denoise is the edit's strength.
			add({
				nodeId: id,
				inputKey: "denoise",
				variable: "denoise",
				literal: node.inputs.denoise,
				standard: true,
				suggested: true,
				reason: "How much of the starting picture is redrawn."
			})
		}

		const loader = modelLoaderUpstream(graph, node)
		if (loader) {
			const key = MODEL_KEYS.find((k) => typeof loader.node.inputs[k] === "string")
			if (key)
				add({
					nodeId: loader.id,
					inputKey: key,
					variable: "model",
					literal: loader.node.inputs[key],
					standard: true,
					// Promoted by default (§4.10, SwarmUI's way): the checkpoint
					// is the pair's model. Un-choosing keeps it baked, and the
					// receipt then says `ignored: model`.
					suggested: true,
					reason: "The checkpoint — sent from the connection's model.",
					enumSource: `objectInfo:${loader.node.class_type}.${key}`
				})
		}
	}

	// ── Loaded images: reference, canvas or mask, by what reads them ───────
	let refIndex = 0
	for (const id of sortedIds(graph)) {
		const node = graph[id]!
		if (!/^LoadImage/.test(node.class_type)) continue
		if (typeof node.inputs.image !== "string") continue
		const role = node.class_type === "LoadImageMask" ? "mask" : imageRole(graph, id)
		const variable =
			role === "reference"
				? `references.[${refIndex++}].filename`
				: `${role}.filename`
		add({
			nodeId: id,
			inputKey: "image",
			variable,
			literal: node.inputs.image,
			standard: true,
			suggested: true,
			reason:
				role === "reference"
					? "A picture the result should resemble — uploaded from the step's references."
					: role === "init"
						? "The starting picture — uploaded from the step's canvas."
						: "Where to paint — uploaded from the step's mask."
		})
	}

	// ── Outputs and the mark ────────────────────────────────────────────────
	const outputs = markOutputs(graph, warnings)

	// ── Everything else: promotable, unchosen ──────────────────────────────
	for (const id of sortedIds(graph)) {
		const node = graph[id]!
		if (SAVE_CLASSES.has(node.class_type) || PREVIEW_CLASSES.has(node.class_type))
			continue
		for (const [key, value] of Object.entries(node.inputs)) {
			if (taken.has(at(id, key))) continue
			if (isLink(value)) continue
			if (!["string", "number", "boolean"].includes(typeof value)) continue
			add({
				nodeId: id,
				inputKey: key,
				variable: uniqueName(toVariableName(key) || `input_${id}`, usedNames),
				literal: value,
				standard: false,
				suggested: false,
				reason: `${node._meta?.title ?? node.class_type} · ${key}`
			})
		}
	}

	if (objectInfo) {
		const known = new Set(objectInfo.classes)
		const missing = [
			...new Set(
				Object.values(graph)
					.map((n) => n.class_type)
					.filter((c) => !known.has(c))
			)
		].sort()
		if (missing.length) warnings.push(`Missing nodes: ${missing.join(", ")}`)
	}

	const perRun = holes.find((h) => h.variable === "count")
	if (perRun && typeof perRun.literal === "number" && perRun.literal > 1)
		warnings.push(
			`This workflow makes ${perRun.literal} pictures per item; unless count stays chosen, extras become variants.`
		)

	return { holes, outputs, warnings }
}

export interface AppliedFit {
	/** The document with holes, as text. */
	document: string
	variables: WorkflowVariable[]
	outputNode: string | null
}

/**
 * Rewrite the chosen literals as holes. `chosen` holds `"<nodeId>.<inputKey>"`
 * addresses; absent means every suggested hole. Numbers and booleans render
 * unquoted (`"seed": {{seed}}`), strings quoted (`"text": "{{prompt}}"`).
 * The marked output gets `filename_prefix: "serene/{{runId}}/{{key}}"` — for
 * the server's tidiness only; outputs are keyed by node id (§4.11). A marked
 * PreviewImage becomes a SaveImage, since previews are never outputs.
 *
 * Every hole declares a variable with its literal as the default — the
 * standard ones too, so a document always renders even when the request
 * leaves a knob unset.
 */
export function applyFit(
	input: ComfyGraph,
	proposal: FitProposal,
	chosen?: Iterable<string>
): AppliedFit {
	const graph: ComfyGraph = JSON.parse(JSON.stringify(input))
	const pick = new Set(
		chosen
			? [...chosen]
			: proposal.holes.filter((h) => h.suggested).map((h) => `${h.nodeId}.${h.inputKey}`)
	)
	const tokens: Array<{ token: string; replacement: string }> = []
	const variables = new Map<string, WorkflowVariable>()

	for (const h of proposal.holes) {
		const k = `${h.nodeId}.${h.inputKey}`
		if (!pick.has(k)) continue
		const node = graph[h.nodeId]
		if (!node || !(h.inputKey in node.inputs)) continue
		const literal = node.inputs[h.inputKey]
		const token = `@@SERENE_HOLE_${tokens.length}@@`
		node.inputs[h.inputKey] = token
		const quoted = typeof literal === "string"
		tokens.push({
			token: `"${token}"`,
			replacement: quoted ? `"{{${h.variable}}}"` : `{{${h.variable}}}`
		})
		if (!variables.has(h.variable))
			variables.set(h.variable, declare(h, literal))
	}

	const output = proposal.outputs.find((o) => o.role === "output")
	if (output && graph[output.nodeId]) {
		const node = graph[output.nodeId]!
		if (PREVIEW_CLASSES.has(node.class_type)) node.class_type = "SaveImage"
		const token = `@@SERENE_HOLE_${tokens.length}@@`
		node.inputs.filename_prefix = token
		tokens.push({ token: `"${token}"`, replacement: `"serene/{{runId}}/{{key}}"` })
	}

	let document = JSON.stringify(graph, null, 2)
	for (const { token, replacement } of tokens)
		document = document.split(token).join(replacement)

	return {
		document,
		variables: [...variables.values()],
		outputNode: output?.nodeId ?? null
	}
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const TEXT_KEYS = ["text", "text_g", "text_l", "t5xxl", "clip_l"] as const
const MODEL_KEYS = ["ckpt_name", "unet_name"] as const

const isEmptyLatent = (n: ComfyNode) =>
	/^Empty.*Latent/.test(n.class_type) &&
	"width" in n.inputs &&
	"height" in n.inputs

/** Follow a conditioning port back to the text encoder that feeds it. */
function textEncoderUpstream(
	graph: ComfyGraph,
	from: ComfyNode,
	port: string
): { id: string; node: ComfyNode } | undefined {
	let cur = linked(graph, from, port)
	for (let hops = 0; cur && hops < 12; hops++) {
		if (/^CLIPTextEncode/.test(cur.node.class_type)) return cur
		// Modifiers carry the conditioning through under one of these names
		// (FluxGuidance, ConditioningSetArea, ControlNetApply, ReferenceLatent…).
		const next =
			linked(graph, cur.node, "conditioning") ??
			linked(graph, cur.node, "conditioning_to") ??
			linked(graph, cur.node, port)
		cur = next
	}
	return undefined
}

/** Follow `model` back through patchers (LoRA, IP-Adapter…) to the loader. */
function modelLoaderUpstream(
	graph: ComfyGraph,
	from: ComfyNode
): { id: string; node: ComfyNode } | undefined {
	let cur = linked(graph, from, "model")
	for (let hops = 0; cur && hops < 24; hops++) {
		if (MODEL_KEYS.some((k) => typeof cur!.node.inputs[k] === "string"))
			return cur
		cur = linked(graph, cur.node, "model")
	}
	return undefined
}

/** Reference, canvas or mask — decided by where the picture goes (§4.8). */
function imageRole(graph: ComfyGraph, id: string): "reference" | "init" | "mask" {
	const seen = new Set<string>([id])
	let frontier = [id]
	for (let depth = 0; frontier.length && depth < 8; depth++) {
		const next: string[] = []
		for (const src of frontier)
			for (const c of consumersOf(graph, src)) {
				const cls = graph[c.id]!.class_type
				if (/mask/i.test(c.key)) return "mask"
				if (
					/IPAdapter|ReferenceLatent|Reference|CLIPVision|InstantID|PhotoMaker|Redux|StyleModel/i.test(
						cls
					)
				)
					return "reference"
				if (SAMPLER_CLASSES.has(cls) && c.key === "latent_image") return "init"
				if (!seen.has(c.id)) {
					seen.add(c.id)
					next.push(c.id)
				}
			}
		frontier = next
	}
	return "reference"
}

/** How many samplers sit upstream of a node — the main chain's last decode has the most. */
function samplerDepth(graph: ComfyGraph, id: string): number {
	const seen = new Set<string>()
	const stack = [id]
	let n = 0
	while (stack.length) {
		const cur = stack.pop()!
		if (seen.has(cur)) continue
		seen.add(cur)
		const node = graph[cur]
		if (!node) continue
		if (SAMPLER_CLASSES.has(node.class_type)) n++
		for (const v of Object.values(node.inputs ?? {}))
			if (isLink(v)) stack.push(v[0])
	}
	return n
}

function markOutputs(graph: ComfyGraph, warnings: string[]): FitOutput[] {
	const ids = sortedIds(graph)
	const saves = ids.filter((id) => SAVE_CLASSES.has(graph[id]!.class_type))
	const previews = ids.filter((id) => PREVIEW_CLASSES.has(graph[id]!.class_type))
	const deepest = (list: string[]) =>
		list.reduce<string | null>(
			(best, id) =>
				best === null || samplerDepth(graph, id) > samplerDepth(graph, best)
					? id
					: best,
			null
		)
	let mark = deepest(saves)
	if (!mark && previews.length) {
		mark = deepest(previews)
		warnings.push(
			"No SaveImage node: the preview node is marked as the output and will be saved instead."
		)
	}
	if (!mark) warnings.push("No output node: add a SaveImage to the graph.")
	return [
		...saves.map((id) => ({
			nodeId: id,
			classType: graph[id]!.class_type,
			role: (id === mark ? "output" : "extra") as FitOutput["role"]
		})),
		...previews.map((id) => ({
			nodeId: id,
			classType: graph[id]!.class_type,
			role: (id === mark ? "output" : "preview") as FitOutput["role"]
		}))
	]
}

interface Marker {
	inputKey: string
	title: string
	type?: WorkflowVariable["type"]
	min?: number
	max?: number
	step?: number
	group?: string
}

/** A SwarmUI / Krita / ComfyDeploy parameter node, read as a declared variable. */
function readMarker(id: string, node: ComfyNode): Marker | null {
	const i = node.inputs ?? {}
	const num = (v: unknown) => (typeof v === "number" ? v : undefined)
	const str = (v: unknown) => (typeof v === "string" ? v : "")
	if (/^SwarmInput/.test(node.class_type) && "value" in i) {
		const t = node.class_type.replace(/^SwarmInput/, "")
		return {
			inputKey: "value",
			title: str(i.title) || node._meta?.title || `input ${id}`,
			type: /Int|Seed/.test(t)
				? "integer"
				: /Float/.test(t)
					? "number"
					: /Bool/.test(t)
						? "boolean"
						: /Dropdown|Checkpoint|Lora|Model/.test(t)
							? "enum"
							: "string",
			min: num(i.min),
			max: num(i.max),
			step: num(i.step),
			group: str(i.group) || undefined
		}
	}
	if (node.class_type === "ETN_Parameter" && "default" in i) {
		const t = str(i.type)
		return {
			inputKey: "default",
			title: str(i.name) || node._meta?.title || `parameter ${id}`,
			type: /int/.test(t)
				? "integer"
				: /number|float/.test(t)
					? "number"
					: /bool|toggle/.test(t)
						? "boolean"
						: /choice|enum|ckpt|lora/.test(t)
							? "enum"
							: "string",
			min: num(i.min),
			max: num(i.max)
		}
	}
	if (/^ComfyUIDeployExternal/.test(node.class_type) && "default_value" in i) {
		const t = node.class_type.replace(/^ComfyUIDeployExternal/, "")
		return {
			inputKey: "default_value",
			title:
				str(i.display_name) || str(i.input_id) || node._meta?.title || `input ${id}`,
			type: /Number(Int)?$|Int/.test(t)
				? /Int/.test(t)
					? "integer"
					: "number"
				: /Boolean/.test(t)
					? "boolean"
					: "string",
			min: num(i.min_value),
			max: num(i.max_value)
		}
	}
	return null
}

/** `"Lora Strength"` → `lora_strength`; never a reserved helper name. */
export function toVariableName(raw: string): string {
	const s = String(raw ?? "")
		.trim()
		.replace(/([a-z0-9])([A-Z])/g, "$1_$2")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "")
	const named = /^[0-9]/.test(s) ? `v_${s}` : s
	// The standard names keep their own spelling.
	const std = STANDARD_VARIABLES.find((v) => v.toLowerCase() === named.replace(/_/g, ""))
	if (std) return std
	return RESERVED_NAMES.has(named) ? `${named}_value` : named
}

function uniqueName(base: string, used: ReadonlySet<string>): string {
	if (!used.has(base) && !STANDARD_VARIABLES.includes(base)) return base
	for (let n = 2; ; n++) if (!used.has(`${base}_${n}`)) return `${base}_${n}`
}

function enumSourceFor(
	node: ComfyNode,
	key: string,
	value: unknown,
	info?: ObjectInfoSummary | null
): string | undefined {
	if (typeof value !== "string") return undefined
	const id = `${node.class_type}.${key}`
	if (info) return info.enums[id] ? `objectInfo:${id}` : undefined
	return /_name$|^scheduler$|^sampler_name$/.test(key) ? `objectInfo:${id}` : undefined
}

function declare(h: FitHole, literal: unknown): WorkflowVariable {
	const type: WorkflowVariable["type"] =
		h.markerType ??
		(typeof literal === "number"
			? Number.isInteger(literal)
				? "integer"
				: "number"
			: typeof literal === "boolean"
				? "boolean"
				: h.enumSource
					? "enum"
					: "string")
	return {
		name: h.variable,
		type,
		default: literal,
		...(h.enumSource ? { enumSource: h.enumSource } : {}),
		...(h.min !== undefined ? { min: h.min } : {}),
		...(h.max !== undefined ? { max: h.max } : {}),
		...(h.step !== undefined ? { step: h.step } : {}),
		...(h.group ? { group: h.group } : h.standard ? {} : { group: "Workflow" }),
		...(h.label ? { label: h.label } : {})
	}
}
