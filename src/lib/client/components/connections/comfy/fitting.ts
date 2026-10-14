/**
 * 🚧 The **fitting form**'s model (DESIGN-image-generation §4.8 step 3): the
 * fitting walk's proposal as something a person confirms — which input each
 * standard hole lands on, which other literals stay literal and which are
 * promoted to variables (with a name and a default), and which output node
 * carries the mark.
 *
 * Pure, so the form's rules are tested away from the markup
 * (`fitting.test.ts`). The form never rewrites the graph itself: Save sends
 * the edited proposal to `workflows:fit` and saves what `applyFit` returns,
 * so a person's choices and a starter's go through one rewrite.
 */

export type ProposalHole = Sockets.Workflows.Proposal["holes"][number]
export type ProposalOutput = Sockets.Workflows.Proposal["outputs"][number]

export interface DraftHole extends ProposalHole {
	/** `"<nodeId>.<inputKey>"`, the hole's address. */
	address: string
	/** Becomes a hole on Save. */
	chosen: boolean
	/** The walk's own name and standing, so an unassigned hole goes back to it. */
	originalVariable: string
	originalStandard: boolean
	/** The variable's default — the literal, unless the person changed it. */
	defaultValue: unknown
	/** A marker node's declared variable (SwarmUI, Krita, ComfyDeploy). */
	marker: boolean
}

export interface FitDraft {
	holes: DraftHole[]
	outputs: ProposalOutput[]
	/** The node carrying the output mark, or null. */
	outputNode: string | null
	warnings: string[]
}

/** The standard rows the form always shows, in this order (brief §4.8 step 3). */
export const CORE_ROWS: ReadonlyArray<{ variable: string; label: string; help: string }> = [
	{ variable: "prompt", label: "Prompt", help: "The text of what to draw." },
	{ variable: "negative", label: "Negative", help: "What to keep out of the picture." },
	{ variable: "seed", label: "Seed", help: "Picks which variation is drawn." },
	{ variable: "steps", label: "Steps", help: "How many passes the sampler makes." },
	{ variable: "cfg", label: "CFG", help: "How strictly the picture follows the prompt." },
	{ variable: "sampler", label: "Sampler", help: "The sampling method." },
	{ variable: "scheduler", label: "Scheduler", help: "The noise schedule." },
	{ variable: "width", label: "Width", help: "The picture's width." },
	{ variable: "height", label: "Height", help: "The picture's height." },
	{
		variable: "model",
		label: "Model",
		help: "The checkpoint — sent from the connection's chosen model. Leave it unassigned to keep the one the workflow names."
	}
]

/** Standard rows shown only when the walk found them. */
const EXTRA_ROWS: ReadonlyArray<{ match: RegExp; label: (v: string) => string; help: string }> = [
	{
		match: /^references\.\[(\d+)\]\.filename$/,
		label: (v) => `Reference ${Number(/\[(\d+)\]/.exec(v)![1]) + 1}`,
		help: "A picture the result should resemble, uploaded from the step."
	},
	{ match: /^init\.filename$/, label: () => "Starting picture", help: "The picture to draw over." },
	{ match: /^mask\.filename$/, label: () => "Mask", help: "Where to paint." },
	{ match: /^count$/, label: () => "Pictures per run", help: "How many pictures one item draws." },
	{ match: /^denoise$/, label: () => "Denoise", help: "How much of the starting picture is redrawn." },
	{ match: /^clipSkip$/, label: () => "CLIP skip", help: "Final CLIP layers to skip." }
]

export function draftFromProposal(p: Sockets.Workflows.Proposal): FitDraft {
	return {
		holes: p.holes.map((h) => ({
			...h,
			address: `${h.nodeId}.${h.inputKey}`,
			chosen: h.suggested,
			originalVariable: h.variable,
			originalStandard: h.standard,
			defaultValue: h.literal,
			// Only a marker is suggested without being standard: the walk
			// offers every other literal unchosen.
			marker: h.suggested && !h.standard
		})),
		outputs: p.outputs.map((o) => ({ ...o })),
		outputNode: p.outputs.find((o) => o.role === "output")?.nodeId ?? null,
		warnings: [...p.warnings]
	}
}

export interface StandardRow {
	variable: string
	label: string
	help: string
	/** The inputs this variable lands on (a second sampler's seed shares it). */
	landings: DraftHole[]
}

/** The standard rows, the core ten always and the rest when the walk found them. */
export function standardRows(draft: FitDraft): StandardRow[] {
	const landed = (v: string) => draft.holes.filter((h) => h.chosen && h.variable === v)
	const rows: StandardRow[] = CORE_ROWS.map((r) => ({ ...r, landings: landed(r.variable) }))
	const seen = new Set<string>()
	for (const h of draft.holes) {
		const v = h.originalStandard ? h.originalVariable : h.variable
		if (seen.has(v) || CORE_ROWS.some((r) => r.variable === v)) continue
		const extra = EXTRA_ROWS.find((e) => e.match.test(v))
		if (!extra) continue
		seen.add(v)
		rows.push({ variable: v, label: extra.label(v), help: extra.help, landings: landed(v) })
	}
	return rows
}

/** "node 6 · text = "a picture"" — an input as a person picks it. */
export function inputLabel(h: Pick<ProposalHole, "nodeId" | "inputKey" | "literal">): string {
	const lit = typeof h.literal === "string" ? `"${clip(h.literal)}"` : String(h.literal)
	return `Node ${h.nodeId} · ${h.inputKey} = ${lit}`
}

const clip = (s: string) => (s.length > 32 ? `${s.slice(0, 31)}…` : s)

/** The inputs a standard row may land on: any literal not held by another standard row. */
export function candidatesFor(draft: FitDraft, variable: string): DraftHole[] {
	return draft.holes.filter(
		(h) =>
			!h.marker &&
			(!h.chosen || h.variable === variable || !isStandardName(draft, h.variable))
	)
}

const isStandardName = (draft: FitDraft, v: string) =>
	CORE_ROWS.some((r) => r.variable === v) ||
	EXTRA_ROWS.some((e) => e.match.test(v)) ||
	draft.holes.some((h) => h.originalStandard && h.originalVariable === v)

/** Return a hole to what the walk said of it, unchosen. */
function release(h: DraftHole) {
	h.chosen = false
	h.variable = h.originalVariable
	h.standard = h.originalStandard
}

/**
 * Land `variable` on ONE input, or on none (`address` null): every input it
 * held is released, and the chosen input takes the name.
 */
export function assignStandard(draft: FitDraft, variable: string, address: string | null) {
	for (const h of draft.holes) if (h.chosen && h.variable === variable) release(h)
	if (address == null) return
	const target = draft.holes.find((h) => h.address === address)
	if (!target) return
	target.chosen = true
	target.variable = variable
	target.standard = true
	target.defaultValue = target.literal
}

/** The other literals: neither a marker nor landed on by a standard row. */
export function otherLiterals(draft: FitDraft): DraftHole[] {
	return draft.holes.filter(
		(h) => !h.marker && !h.originalStandard && !(h.chosen && h.standard)
	)
}

export const markerHoles = (draft: FitDraft): DraftHole[] => draft.holes.filter((h) => h.marker)

/** Promote a literal to a variable (name and default prefilled), or keep it literal. */
export function setPromoted(draft: FitDraft, address: string, on: boolean) {
	const h = draft.holes.find((x) => x.address === address)
	if (!h) return
	h.chosen = on
	if (on && h.defaultValue === undefined) h.defaultValue = h.literal
}

const NAME_RE = /^[a-z_][a-z0-9_]*$/

/** Why this promoted name cannot be saved, or null. */
export function nameProblem(draft: FitDraft, hole: DraftHole): string | null {
	const name = hole.variable.trim()
	if (!name) return "Give the variable a name."
	if (!NAME_RE.test(name))
		return "Use lowercase letters, digits and underscores, starting with a letter."
	if (isStandardName(draft, name)) return `"${name}" is a standard name; choose another.`
	const clash = draft.holes.some(
		(h) => h.address !== hole.address && h.chosen && h.variable.trim() === name
	)
	return clash ? `Another variable is already called "${name}".` : null
}

/** Every reason the draft cannot be saved yet. */
export function draftProblems(draft: FitDraft): string[] {
	const out: string[] = []
	for (const h of otherLiterals(draft))
		if (h.chosen) {
			const p = nameProblem(draft, h)
			if (p) out.push(`${inputLabel(h)}: ${p}`)
		}
	if (!draft.outputNode) out.push("Mark one output node — the picture the run keeps.")
	return out
}

/** Move the output mark. */
export function markOutput(draft: FitDraft, nodeId: string) {
	draft.outputNode = nodeId
	for (const o of draft.outputs)
		o.role =
			o.nodeId === nodeId
				? "output"
				: o.classType === "PreviewImage"
					? "preview"
					: "extra"
}

/** What `workflows:fit` applies: the edited proposal and the chosen addresses. */
export function editedProposal(draft: FitDraft): {
	proposal: Sockets.Workflows.Proposal
	chosen: string[]
} {
	return {
		proposal: {
			holes: draft.holes.map(
				({ address: _a, chosen: _c, originalVariable: _o, originalStandard: _s, defaultValue: _d, marker: _m, ...h }) => ({
					...h,
					variable: h.variable.trim()
				})
			),
			outputs: draft.outputs.map((o) => ({ ...o })),
			warnings: draft.warnings
		},
		chosen: draft.holes.filter((h) => h.chosen).map((h) => h.address)
	}
}

/**
 * The applied variables with the defaults the person typed: `applyFit`
 * declares each from the graph's literal, and a changed default is the
 * form's to say.
 */
export function withDraftDefaults<V extends { name: string; default?: unknown }>(
	variables: readonly V[],
	draft: FitDraft
): V[] {
	return variables.map((v) => {
		const h = draft.holes.find((x) => x.chosen && x.variable.trim() === v.name)
		return h && h.defaultValue !== undefined && h.defaultValue !== h.literal
			? { ...v, default: h.defaultValue }
			: v
	})
}

/** A typed default from a text input, kept the literal's type. */
export function parseDefault(raw: string, literal: unknown): unknown {
	if (typeof literal === "number") {
		const n = Number(raw)
		return Number.isFinite(n) ? n : literal
	}
	if (typeof literal === "boolean") return raw === "true"
	return raw
}

/** The enum id an `objectInfo:<class>.<input>` source names. */
export const enumIdOf = (source: string | undefined): string | null =>
	source ? source.replace(/^objectInfo:/, "") : null
