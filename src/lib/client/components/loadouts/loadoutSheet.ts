/**
 * The **loadout editor** (I12; DESIGN-image-generation §11, §13, §14.2; lane
 * E2) — one loadout, as one dialog: a header (title, slug, owner, the
 * default star, the live *what runs* line, the description), then three
 * cards in the order a person thinks them —
 *
 *   - **Model** — one searchable list of every model, across connections,
 *     that can do the loadout's job, the connection as a chip; the chosen
 *     row's facts and capability chips; a consequence line in the receipt's
 *     words when the pair cannot do what the loadout's users wire.
 *   - **Sampling** — the chosen config with its key knobs read inline, a
 *     picker of configs of the job's shape, *Open in Sampling*. A pair change
 *     swaps a config that does not fit and says so (§12 suggestion 4).
 *   - **Workflow** — only when the pair's drawing sheet takes a template
 *     payload (ComfyUI): the workflow picker, the sheet sentence, and the
 *     workflow's **dials** inline, each *default* or *set here* — stored as
 *     the loadout's `workflow_values`.
 *
 * Edits are held in a **draft** until Save (STYLE-GUIDE §6.14); the footer's
 * Merge, Make it and Delete are one-shot verbs with their own buttons.
 *
 * Every word, row and choice the editor shows is decided here, so the
 * components assemble and branch on nothing. Nothing here emits.
 */
import { CORE_LOADOUTS } from "@serene-pub/core-catalog/loadouts"
import { imageSamplingSchema, textSamplingSchema } from "@serene-pub/sdk"
import {
	modelFact,
	type CapabilityConnection,
	type CapabilityModel
} from "$lib/client/components/connections/jobPicker"
import { servesCapability } from "$lib/client/components/connections/connectionIndexFilter"
import { formatContext, formatPrice } from "$lib/shared/connections/modelFacts"
import {
	perImagePriceOf,
	perPictureLine
} from "$lib/shared/connections/imagePrice"
import {
	outputKindOf,
	samplingShapeForCapability
} from "$lib/shared/capabilities/samplingShape"
import {
	consequencesFor,
	impliedNeeds,
	samplingAfterPairChange,
	type GradeSet
} from "$lib/shared/loadouts/consequence"
import {
	dialKeyOf,
	workflowDialsSchema
} from "$lib/shared/imageGen/workflowShape"
import type { WorkflowVariable } from "$lib/shared/imageGen/types"

type Summary = Sockets.Loadouts.Summary
type Transform = Sockets.Loadouts.List.Response["transforms"][number]
type SamplingOption =
	Sockets.Loadouts.List.Response["samplingOptions"][string][number]
type SamplingOptions = Sockets.Loadouts.List.Response["samplingOptions"]

/** The three cards, in the order drawn. Never numbered (STYLE-GUIDE §1.8). */
export const EDITOR_CARDS = [
	{ key: "model", heading: "Model" },
	{ key: "sampling", heading: "Sampling" },
	{ key: "workflow", heading: "Workflow" }
] as const

/** The verbs, in one place so the tests and the components agree. */
export const VERBS = {
	save: "Save",
	create: "Create loadout",
	cancel: "Cancel",
	makeIt: "Make it",
	mergeInto: "Merge into…",
	unmerge: "Unmerge",
	delete: "Delete",
	duplicate: "Duplicate to edit",
	clearPair: "Clear",
	openInSampling: "Open in Sampling",
	resetDial: "Use default"
} as const

/** The transform's own label, or its id for one this build has no word for. */
export function transformLabel(
	transform: string,
	transforms: readonly Transform[]
): string {
	return transforms.find((t) => t.id === transform)?.label ?? transform
}

/** A shipped loadout is core's or a plugin's: its prose is its package's. */
export function isShipped(loadout: Pick<Summary, "owner">): boolean {
	return loadout.owner !== "pub"
}

/** *Used by 3 steps* — one step, none. */
export function usedByLine(steps: number): string {
	return steps === 1 ? "Used by 1 step" : `Used by ${steps} steps`
}

/** A plugin's id as a tile's chip; core and the pub's own wear none. */
export function ownerChip(owner: string): string | null {
	return owner === "core" || owner === "pub" ? null : owner
}

/** The editor header's owner chip: *Core*, the plugin's id, or *Yours*. */
export function ownerLabel(owner: string): string {
	if (owner === "core") return "Core"
	if (owner === "pub") return "Yours"
	return owner
}

// ── The draft ─────────────────────────────────────────────────────────────

/** Everything the editor holds until Save. */
export interface LoadoutDraft {
	name: string
	description: string
	transform: string
	connectionId: number | null
	connectionModelId: number | null
	samplingConfigId: number | null
	workflowId: number | null
	/** The dials set here, by variable name; absent = the workflow's default. */
	workflowValues: Record<string, unknown>
	/** The star: this loadout is (or will be, on Save) its job's default. */
	isDefault: boolean
}

/** The draft a loadout opens with — or, with none, a new one for `transform`. */
export function draftOf(
	loadout: Summary | null,
	transform = "text->text"
): LoadoutDraft {
	return {
		name: loadout?.name ?? "",
		description: loadout?.description ?? "",
		transform: loadout?.transform ?? transform,
		connectionId: loadout?.connectionId ?? null,
		connectionModelId: loadout?.connectionModelId ?? null,
		samplingConfigId: loadout?.samplingConfigId ?? null,
		workflowId: loadout?.workflowId ?? null,
		workflowValues: { ...(loadout?.workflowValues ?? {}) },
		isDefault: !!loadout?.defaultFor
	}
}

/**
 * The `loadouts:update` a Save sends: only what moved, so a shipped loadout
 * never sends the prose the server would refuse. Null when nothing did
 * (the star rides `loadouts:setDefault`, see `needsSetDefault`).
 */
export function updateParams(
	loadout: Summary,
	draft: LoadoutDraft
): Sockets.Loadouts.Update.Params | null {
	const p: Sockets.Loadouts.Update.Params = { id: loadout.id }
	if (!isShipped(loadout)) {
		const name = draft.name.trim()
		if (name && name !== loadout.name) p.name = name
		const description = draft.description.trim() || null
		if (description !== (loadout.description ?? null))
			p.description = description
	}
	if (
		draft.connectionId !== loadout.connectionId ||
		draft.connectionModelId !== loadout.connectionModelId
	) {
		p.connectionId = draft.connectionId
		p.connectionModelId = draft.connectionModelId
	}
	if (draft.samplingConfigId !== loadout.samplingConfigId)
		p.samplingConfigId = draft.samplingConfigId
	if (draft.workflowId !== loadout.workflowId) p.workflowId = draft.workflowId
	const values = Object.keys(draft.workflowValues).length
		? draft.workflowValues
		: null
	if (!sameValues(values, loadout.workflowValues ?? null))
		p.workflowValues = values
	return Object.keys(p).length > 1 ? p : null
}

/** The star was turned on and the loadout is not the default yet. */
export function needsSetDefault(
	loadout: Pick<Summary, "defaultFor"> | null,
	draft: Pick<LoadoutDraft, "isDefault">
): boolean {
	return draft.isDefault && !loadout?.defaultFor
}

function sameValues(
	a: Record<string, unknown> | null,
	b: Record<string, unknown> | null
): boolean {
	const ka = Object.keys(a ?? {})
	const kb = Object.keys(b ?? {})
	if (ka.length !== kb.length) return false
	return ka.every((k) => (a ?? {})[k] === (b ?? {})[k])
}

/** Save is offered once a new loadout has a name; Create needs one too. */
export function canSave(draft: LoadoutDraft): boolean {
	return !!draft.name.trim()
}

// ── The header ────────────────────────────────────────────────────────────

/** What the header says, from the saved row and the live draft. */
export interface EditorHeader {
	title: string
	slug: string | null
	owner: string
	/** Name and description are editable on a pub loadout (and a new one). */
	editable: boolean
	/** *Default for Chat*. */
	defaultLabel: string
	/** The star cannot be turned off: a job always has one default. */
	defaultLocked: boolean
	/** *Merged into Reply*, or null. */
	mergedLine: string | null
	pluginOff: boolean
	usedBy: string
	/** Delete is offered on a pub loadout only (the server refuses the rest). */
	canDelete: boolean
}

export function editorHeader(
	loadout: Summary | null,
	draft: LoadoutDraft,
	transforms: readonly Transform[]
): EditorHeader {
	const label = transformLabel(draft.transform, transforms)
	return {
		title: draft.name.trim() || loadout?.name || "New loadout",
		slug: loadout?.slug ?? null,
		owner: ownerLabel(loadout?.owner ?? "pub"),
		editable: !loadout || !isShipped(loadout),
		defaultLabel: `Default for ${label}`,
		defaultLocked: !!loadout?.defaultFor,
		mergedLine:
			loadout?.mergedInto != null
				? `Merged into ${loadout.mergedIntoName ?? "another loadout"}`
				: null,
		pluginOff: !!loadout?.pluginOff,
		usedBy: usedByLine(loadout?.usedBy.steps ?? 0),
		canDelete: !!loadout && !isShipped(loadout)
	}
}

/** The live **what runs** line and its tone. */
export interface WhatRuns {
	tone: "filled" | "unfilled" | "merged"
	text: string
}

/**
 * *KoboldCPP · Nemo 12B · sampling Chat* — or *Unfilled — falls back to
 * Reply*, or, merged, the parent's name. Read off the draft, so it moves as
 * the cards do.
 */
export function whatRuns(
	loadout: Summary | null,
	draft: LoadoutDraft,
	connections: readonly CapabilityConnection[],
	samplingName: string | null
): WhatRuns {
	if (loadout?.mergedInto != null)
		return {
			tone: "merged",
			text: `Runs as ${loadout.mergedIntoName ?? "its parent loadout"}`
		}
	const conn = connections.find((c) => c.id === draft.connectionId)
	const model = conn?.models.find((m) => m.id === draft.connectionModelId)
	if (draft.connectionId == null || !conn) {
		const fallback = loadout?.fallbackName
		return {
			tone: "unfilled",
			text: fallback
				? `Unfilled — falls back to ${fallback}`
				: "Unfilled — nothing to fall back to yet"
		}
	}
	const parts = [conn.name ?? "Untitled connection"]
	if (model) parts.push(model.name)
	if (samplingName) parts.push(`sampling ${samplingName}`)
	return { tone: "filled", text: parts.join(" · ") }
}

/**
 * The loadouts this one may merge into: same job, not itself, and not one
 * already merged (directly or down a chain) into this one — a merge loop.
 */
export function mergeTargets(
	loadouts: readonly Summary[],
	loadout: Summary
): Summary[] {
	const byId = new Map(loadouts.map((l) => [l.id, l]))
	const reachesSelf = (l: Summary): boolean => {
		const seen = new Set<number>()
		let at: Summary | undefined = l
		while (at && at.mergedInto != null && !seen.has(at.id)) {
			seen.add(at.id)
			if (at.mergedInto === loadout.id) return true
			at = byId.get(at.mergedInto)
		}
		return false
	}
	return loadouts.filter(
		(l) =>
			l.id !== loadout.id &&
			l.transform === loadout.transform &&
			!reachesSelf(l)
	)
}

// ── The Model card ────────────────────────────────────────────────────────

/** One model as a row of the Model card's list. */
export interface ModelOption {
	/** `<connectionId>:<modelId>` — the row's key. */
	key: string
	connectionId: number
	modelId: number
	modelName: string
	connectionTitle: string
	connectionType: string | null
	/** The facts line: context · price · size, or the state word. */
	fact: string
	/** The chosen row's facts, as label/value pairs. */
	facts: { label: string; value: string }[]
	/** What the pair does natively, as chips. */
	chips: string[]
	/** The receipt's words for what it cannot (*references dropped*). */
	consequences: string[]
	/** False for a local file still arriving or failed (the server refuses it). */
	usable: boolean
}

/** Capability ids worth a chip, in the words a person reads. */
const CHIP_WORDS: [string, string][] = [
	["json_schema", "Schema door"],
	["tools", "Native tools"],
	["text+image->text", "Sees pictures"],
	["text+image->image", "Takes references"]
]

type GradedConnection = CapabilityConnection & {
	capabilities?: { resolved?: GradeSet } | null
}
type GradedModel = CapabilityModel & {
	capabilities?: { resolved?: GradeSet } | null
}

/** The pair's grades: the model's layer over its connection's. */
export function gradesOf(
	connection: GradedConnection,
	model: GradedModel
): GradeSet {
	return {
		...(connection.capabilities?.resolved ?? {}),
		...(model.capabilities?.resolved ?? {})
	}
}

function chipsOf(grades: GradeSet): string[] {
	return CHIP_WORDS.filter(([id]) => (grades[id] ?? 0) > 0).map(([, w]) => w)
}

function factsOf(model: CapabilityModel, transform: string) {
	const out: { label: string; value: string }[] = []
	const context = formatContext(
		model.contextWindow ?? model.facts?.contextWindow
	)
	if (context && outputKindOf(transform) === "text")
		out.push({ label: "Context", value: `${context} tokens` })
	const picture = perPictureLine(perImagePriceOf(model.facts))
	if (picture) out.push({ label: "Price", value: picture })
	else {
		const pricing = model.facts?.pricing
		const inPrice = formatPrice(pricing?.inPerMTok, pricing?.currency)
		if (inPrice)
			out.push({
				label: "Price",
				value: inPrice === "Free" ? "Free" : `${inPrice} per million in`
			})
	}
	return out
}

/**
 * Every model across every connection that can do the loadout's job, the
 * chosen pair first (whatever state it is in, so a model the host stopped
 * listing still shows as the one in use); the rest grouped by connection
 * name, the server's order within one.
 */
export function modelOptions(
	connections: readonly CapabilityConnection[],
	transform: string,
	loadoutId: string | null,
	/** The SAVED pair, which leads the list (a pick never reorders it). */
	chosen: { connectionId: number | null; connectionModelId: number | null }
): ModelOption[] {
	const needs = impliedNeeds(loadoutId)
	const option = (
		c: CapabilityConnection,
		m: CapabilityModel,
		usable: boolean
	): ModelOption => {
		const grades = gradesOf(c as GradedConnection, m as GradedModel)
		return {
			key: `${c.id}:${m.id}`,
			connectionId: c.id,
			modelId: m.id,
			modelName: m.name,
			connectionTitle: c.name ?? "Untitled connection",
			connectionType: c.type ?? null,
			fact: modelFact(m),
			// The row's own line already says context and price; the chosen
			// row's facts add only what it leaves out.
			facts: factsOf(m, transform).filter(
				(f) => !modelFact(m).includes(f.value.replace(/ tokens$/, ""))
			),
			chips: chipsOf(grades),
			consequences: consequencesFor(grades, needs),
			usable
		}
	}
	const out: ModelOption[] = []
	const chosenConn = connections.find((c) => c.id === chosen.connectionId)
	const chosenModel = chosenConn?.models.find(
		(m) => m.id === chosen.connectionModelId
	)
	if (chosenConn && chosenModel)
		out.push(option(chosenConn, chosenModel, true))
	const ordered = connections
		.filter((c) => servesCapability(c, transform))
		.sort((a, b) =>
			(a.name ?? "").localeCompare(b.name ?? "", undefined, {
				sensitivity: "base"
			})
		)
	for (const c of ordered)
		for (const m of c.models) {
			if (c.id === chosenConn?.id && m.id === chosenModel?.id) continue
			if (!m.enabled || m.missingSince != null) continue
			if (!(m.satisfiableCapabilities ?? []).includes(transform)) continue
			const local = m.local?.state
			if (local === "not_downloaded") continue
			out.push(option(c, m, local == null || local === "on_disk"))
		}
	return out
}

/** The list past which the Model card shows its filter box. */
export const MODEL_FILTER_FROM = 6

/** Rows matching a typed filter — model name or connection name. */
export function filterModelOptions(
	options: readonly ModelOption[],
	query: string
): ModelOption[] {
	const q = query.trim().toLowerCase()
	if (!q) return [...options]
	return options.filter(
		(o) =>
			o.modelName.toLowerCase().includes(q) ||
			o.connectionTitle.toLowerCase().includes(q)
	)
}

/** The Model card's line when nothing here can do the job. */
export function noModelSentence(label: string): string {
	return `No model here can do ${label} yet. Add a connection in Connections, or get a model in Models.`
}

// ── The Sampling card ─────────────────────────────────────────────────────

/** The configs offered for the loadout's job (the server filtered by shape). */
export function samplingChoices(
	options: SamplingOptions,
	transform: string
): SamplingOption[] {
	return options[transform] ?? []
}

/** The Sampling card when the job has no sampling vocabulary. */
export const NO_SAMPLING_SENTENCE =
	"Nothing to sample for this job: the model answers as it is."

/** The Sampling card when no config is picked. */
export const NO_SAMPLING_PICKED =
	"None picked: the connection's own defaults apply."

/** A stored config, as `samplingConfigs:list` sends it. */
export interface SamplingRow {
	id: number
	name: string
	shape?: string | null
	values?: Record<string, unknown> | null
	enabled?: readonly string[] | null
}

const KNOBS: Record<"text" | "image", [string, (v: unknown) => string][]> = {
	text: [
		["temperature", (v) => `Temperature ${v}`],
		["responseTokens", (v) => `${v} tokens max`]
	],
	image: [
		["steps", (v) => `${v} steps`],
		["cfg", (v) => `CFG ${v}`]
	]
}

/**
 * A config's key knobs, read inline: *Temperature 0.7 · 512 tokens max*, or
 * *30 steps · CFG 7 · 1024×1024*. Only switched-on knobs; empty when none.
 */
export function samplingKnobs(
	row: SamplingRow | null | undefined,
	transform: string
): string[] {
	if (!row) return []
	const kind = outputKindOf(transform) === "image" ? "image" : "text"
	const on = new Set(row.enabled ?? [])
	const v = row.values ?? {}
	const schema = kind === "image" ? imageSamplingSchema : textSamplingSchema
	// A switched-on knob with no stored value runs at its declared default.
	const val = (k: string) => {
		if (!on.has(k)) return undefined
		const x =
			v[k] !== undefined && v[k] !== null && v[k] !== ""
				? v[k]
				: (schema[k] as { default?: unknown } | undefined)?.default
		return x === undefined || x === null || x === "" ? undefined : x
	}
	const out: string[] = []
	for (const [key, say] of KNOBS[kind]) {
		const x = val(key)
		if (x !== undefined) out.push(say(x))
	}
	if (kind === "image") {
		const w = val("width")
		const h = val("height")
		if (w !== undefined && h !== undefined) out.push(`${w}×${h}`)
	}
	return out
}

/** The seeded config core's default loadout for this job names, if seeded here. */
export function seededSamplingFor(
	transform: string,
	options: SamplingOptions
): SamplingOption | null {
	const seedKey = CORE_LOADOUTS.find(
		(d) => d.defaultFor && d.transform === transform
	)?.sampling
	if (!seedKey) return null
	return (options[transform] ?? []).find((o) => o.seedKey === seedKey) ?? null
}

/**
 * The swap rule on a pair change: a config whose shape the job does not
 * speak is swapped for the job's seeded default, with a sentence the
 * Sampling card shows. Applied to the draft at once; Save sends the result.
 */
export function samplingOnPairChange(
	draft: Pick<LoadoutDraft, "transform" | "samplingConfigId">,
	options: SamplingOptions,
	allSampling: readonly {
		id: number
		name: string
		shape?: string | null
	}[] = []
): { samplingConfigId: number | null; notice: string | null } {
	const offered = options[draft.transform] ?? []
	const found =
		draft.samplingConfigId == null
			? null
			: (offered.find((o) => o.id === draft.samplingConfigId) ??
				allSampling.find((o) => o.id === draft.samplingConfigId) ??
				null)
	const seeded = seededSamplingFor(draft.transform, options)
	return samplingAfterPairChange({
		current: found
			? { id: found.id, name: found.name, shape: found.shape ?? "" }
			: null,
		wantedShape: samplingShapeForCapability(draft.transform) ?? null,
		seededDefault: seeded
			? { id: seeded.id, name: seeded.name, shape: seeded.shape }
			: null
	})
}

// ── The Workflow card ─────────────────────────────────────────────────────

/**
 * The Workflow card appears only when the pair's drawing sheet takes a
 * template payload (a ComfyUI graph with holes).
 */
export function showsWorkflowField(
	sheet: { payload?: string } | null | undefined
): boolean {
	return sheet?.payload === "template"
}

/** One dial, as the Workflow card draws it. */
export interface DialRow {
	/** The variable's name — the key in `workflow_values`. */
	name: string
	label: string
	type: "number" | "integer" | "boolean" | "string" | "enum"
	min?: number
	max?: number
	step?: number
	options?: string[]
	defaultValue: unknown
	/** What runs: the value set here, else the default. */
	value: unknown
	/** True when the loadout sets it. */
	setHere: boolean
	/** *Default 20* / *Set here · default 20*. */
	note: string
}

const shown = (v: unknown) =>
	v === undefined || v === null || v === ""
		? "empty"
		: typeof v === "boolean"
			? v
				? "on"
				: "off"
			: String(v)

/**
 * The workflow's dials with the loadout's values over them. Standard dials
 * borrow the image schema's labels and ranges (`workflowDialsSchema`).
 */
export function dialRows(
	variables: readonly WorkflowVariable[],
	values: Record<string, unknown>
): DialRow[] {
	const schema = workflowDialsSchema(variables)
	const out: DialRow[] = []
	const seen = new Set<string>()
	for (const v of variables) {
		const key = dialKeyOf(v)
		if (!key || seen.has(v.name)) continue
		seen.add(v.name)
		const field = schema[key] as
			| {
					label?: string
					type?: string
					min?: number
					max?: number
					step?: number
					of?: readonly string[]
					default?: unknown
			  }
			| undefined
		const type = (
			field?.type === "enum" && field.of?.length
				? "enum"
				: field?.type === "number" ||
					  field?.type === "integer" ||
					  field?.type === "boolean"
					? field.type
					: "string"
		) as DialRow["type"]
		const defaultValue = v.default ?? field?.default
		const setHere = Object.prototype.hasOwnProperty.call(values, v.name)
		out.push({
			name: v.name,
			label: field?.label ?? v.label ?? v.name,
			type,
			...(field?.min !== undefined ? { min: field.min } : {}),
			...(field?.max !== undefined ? { max: field.max } : {}),
			...(field?.step !== undefined ? { step: field.step } : {}),
			...(type === "enum" ? { options: [...(field?.of ?? [])] } : {}),
			defaultValue,
			value: setHere ? values[v.name] : defaultValue,
			setHere,
			note: setHere
				? `Set here · default ${shown(defaultValue)}`
				: `Default ${shown(defaultValue)}`
		})
	}
	return out
}

/**
 * The dials after one is moved: a value equal to the default — or an
 * emptied field — drops back to *default*; anything else is *set here*.
 */
export function setDial(
	values: Record<string, unknown>,
	row: Pick<DialRow, "name" | "defaultValue" | "type">,
	raw: unknown
): Record<string, unknown> {
	const next = { ...values }
	let value = raw
	if (row.type === "number" || row.type === "integer") {
		if (raw === "" || raw === null || raw === undefined) value = undefined
		else {
			const n = typeof raw === "number" ? raw : Number(raw)
			value = Number.isFinite(n) ? n : undefined
		}
	}
	if (value === undefined || value === row.defaultValue) delete next[row.name]
	else next[row.name] = value
	return next
}

/** The dials sentence when the chosen workflow has none. */
export const NO_DIALS_SENTENCE =
	"This workflow has no dials: it runs as written."

/** The Workflow card before a workflow is chosen. */
export const PICK_WORKFLOW_SENTENCE =
	"Choose the workflow this loadout draws with. Its dials show here once chosen."

// ── Doors ─────────────────────────────────────────────────────────────────

/**
 * The loadout a job door (`digest.connectionsJob`) opens: the transform's
 * default; else core's declared default for it (`CORE_LOADOUTS`
 * `defaultFor`); else null — the grid.
 */
export function loadoutForJob(
	job: string,
	list: Pick<Sockets.Loadouts.List.Response, "loadouts" | "transforms">
): number | null {
	const t = list.transforms.find((x) => x.id === job)
	if (t?.defaultLoadoutId != null) return t.defaultLoadoutId
	const flagged = list.loadouts.find((l) => l.defaultFor === job)
	if (flagged) return flagged.id
	const declared = CORE_LOADOUTS.find(
		(d) => d.defaultFor && d.transform === job
	)?.id
	if (!declared) return null
	return list.loadouts.find((l) => l.loadoutId === declared)?.id ?? null
}
