/**
 * Which settings belong together — derived from the graph, never declared
 * (owner rulings 2026-09-30, Q5).
 *
 * A **settings group** is one model call and everything that exists only to
 * serve it: the prompt wired into it, its connection and sampling, and the
 * steps that feed nothing else. Nothing on the spec declares a group; the
 * config references a spec already writes are the whole of the evidence:
 *
 *  · an `assemble` pairing — a step that reads one node's prompts
 *    (`slot.prompts({ node })`) and a model call's connection or sampling
 *    (`slot.connectionOf(…)`) — puts both it and the prompt's owner in that
 *    call's group, and so does an envoy's prompt such a step reads
 *    (`slot.prompts({ envoy })`);
 *  · a step whose every consumer already sits in one group joins it (the
 *    narrator's message processing, a voice's own lore read and ranking);
 *  · a model call that runs on another call's model — its connection a
 *    reference to that call (`slot.connection(node)`) — is part of that
 *    call: a Lair character turn's own books, kept on the State-keeper's
 *    model, sampling and prompt.
 *
 * A step that reads a model call's settings without a prompt (the context
 * budget) is not part of that call — it serves the whole turn. Whatever no
 * group claims is the **whole pipeline**. A spec with one model call (or
 * none) is one group, unheaded.
 *
 * Pure over the stored document so the rule is testable without a database;
 * `read.ts` shapes the payload from it.
 */

import { type I18n } from "@serene-pub/sdk"
import { i18nTextIn } from "$lib/shared/i18n/i18nText"
import type {
	ConfigOption,
	Decl,
	SettingsGroup,
	SettingsGroupStep
} from "$lib/server/pipelines/config/panel/types"

/** The slice of a stored document node the grouping reads. */
export interface GroupingNode {
	key: string
	position: number
	config?: Record<string, unknown> | null
	resolvedRefs?: Record<string, string> | null
	clauseId?: string | null
	/** The node kind — an `oracle` that borrows a call's model joins that call. */
	kind?: string
	expose?: { status?: I18n; label?: I18n; purpose?: I18n } | null
}

export interface GroupingInput {
	nodes: readonly GroupingNode[]
	edges: readonly { from: string; to: string }[]
	/** The model calls, as the panel found them — oracles owning a person-facing connection or sampling slot. */
	modelCalls: readonly string[]
}

export interface GroupPlan {
	/** One per model call, in spine order. Empty when the spec has at most one. */
	calls: { modelCall: string; members: Set<string> }[]
	/**
	 * Where an address belongs: a node key, a clause id or an envoy config key
	 * (`envoy:<key>`) → the index into `calls`, or `-1` for the whole pipeline.
	 * With one call or none, everything answers `-1` — there is one group.
	 */
	ownerOf: (address: string) => number
	/** The members of a clause, for placing its own settings. */
	clauseMembers: Map<string, string[]>
}

interface SlotRefLike {
	__ref: "slot"
	slot: string
	ofNode?: string
	ofEnvoy?: string
}

const isSlotRef = (v: unknown): v is SlotRefLike =>
	!!v && typeof v === "object" && (v as { __ref?: unknown }).__ref === "slot"

/**
 * The config references a node makes to OTHER addresses: which slot kind, and
 * whose. `resolvedRefs` (what publish stored) wins over the raw ref, so a
 * downstream-oracle marker resolves to what the run reads.
 */
function referencesOf(
	n: GroupingNode
): { kind: string; target: string }[] {
	const out: { kind: string; target: string }[] = []
	for (const [k, v] of Object.entries(n.config ?? {})) {
		if (!isSlotRef(v)) continue
		const target =
			n.resolvedRefs?.[k] ??
			v.ofNode ??
			(v.ofEnvoy ? `envoy:${v.ofEnvoy}` : undefined)
		if (!target || target === n.key) continue
		out.push({ kind: v.slot, target })
	}
	return out
}

export function planGroups(input: GroupingInput): GroupPlan {
	const byKey = new Map(input.nodes.map((n) => [n.key, n]))
	const calls = [...input.modelCalls]
		.filter((k) => byKey.has(k))
		.sort((a, b) => byKey.get(a)!.position - byKey.get(b)!.position)

	const clauseMembers = new Map<string, string[]>()
	for (const n of input.nodes)
		if (n.clauseId) {
			const list = clauseMembers.get(n.clauseId) ?? []
			list.push(n.key)
			clauseMembers.set(n.clauseId, list)
		}

	if (calls.length <= 1)
		return { calls: [], ownerOf: () => -1, clauseMembers }

	const owner = new Map<string, number>()
	calls.forEach((k, i) => owner.set(k, i))
	const isCall = new Set(calls)
	const claim = (address: string, g: number) => {
		if (!owner.has(address)) owner.set(address, g)
	}

	// The prompt wiring. A step pairing a prompt with ONE model call joins
	// that call, with the prompt's owner; a claimed step's own prompt
	// reference (an envoy's, or another node's) comes along too.
	for (const n of [...input.nodes].sort((a, b) => a.position - b.position)) {
		const refs = referencesOf(n)
		const models = new Set(
			refs
				.filter((r) => (r.kind === "connection" || r.kind === "sampling") && isCall.has(r.target))
				.map((r) => r.target)
		)
		const prompts = refs.filter((r) => r.kind === "prompts").map((r) => r.target)
		if (isCall.has(n.key)) {
			for (const p of prompts) claim(p, owner.get(n.key)!)
			continue
		}
		const borrowed = refs.find((r) => r.kind === "connection" && isCall.has(r.target))
		if (n.kind === "oracle" && borrowed) {
			claim(n.key, owner.get(borrowed.target)!)
			continue
		}
		if (models.size !== 1 || !prompts.length) continue
		const g = owner.get([...models][0]!)!
		claim(n.key, g)
		for (const p of prompts) claim(p, g)
	}
	// A prompt owner that itself reads another address's prompts (a context
	// builder over an envoy's instructions).
	for (let changed = true; changed; ) {
		changed = false
		for (const n of input.nodes) {
			const g = owner.get(n.key)
			if (g === undefined) continue
			for (const r of referencesOf(n))
				if (r.kind === "prompts" && !owner.has(r.target)) {
					owner.set(r.target, g)
					changed = true
				}
		}
	}

	// A step that exists only to feed one group belongs to it: every
	// consumer is in that group, and nothing it reads comes from another
	// model call (the reply's join reads the narrator, so it serves the turn,
	// not the state keeper who reads it next).
	const consumers = new Map<string, Set<string>>()
	const producers = new Map<string, Set<string>>()
	for (const e of input.edges) {
		consumers.set(e.from, (consumers.get(e.from) ?? new Set<string>()).add(e.to))
		producers.set(e.to, (producers.get(e.to) ?? new Set<string>()).add(e.from))
	}
	/** Whether `key` reads — through steps no group holds — another group's work. */
	const readsAnotherGroup = (key: string, g: number): boolean => {
		const seen = new Set<string>()
		const walk = (k: string): boolean => {
			if (seen.has(k)) return false
			seen.add(k)
			const at = owner.get(k)
			if (at === g) return false
			if (at !== undefined) return true
			// A clause publishes what its members produce.
			const from = [...(producers.get(k) ?? []), ...(clauseMembers.get(k) ?? [])]
			return from.some(walk)
		}
		return [...(producers.get(key) ?? [])].some(walk)
	}
	for (let changed = true; changed; ) {
		changed = false
		for (const n of input.nodes) {
			if (owner.has(n.key)) continue
			const to = consumers.get(n.key)
			if (!to?.size) continue
			const groups = new Set([...to].map((k) => owner.get(k)))
			if (groups.size !== 1) continue
			const g = [...groups][0]
			if (g === undefined || readsAnotherGroup(n.key, g)) continue
			owner.set(n.key, g)
			changed = true
		}
	}

	const ownerOf = (address: string): number => {
		const direct = owner.get(address)
		if (direct !== undefined) return direct
		// A clause's own settings go where all of its members went.
		const members = clauseMembers.get(address)
		if (members?.length) {
			const groups = new Set(members.map((m) => owner.get(m) ?? -1))
			if (groups.size === 1) return [...groups][0]!
		}
		return -1
	}

	return {
		calls: calls.map((modelCall, i) => ({
			modelCall,
			members: new Set(
				[...owner.entries()].filter(([, g]) => g === i).map(([k]) => k)
			)
		})),
		ownerOf,
		clauseMembers
	}
}

/**
 * The heading of a model call's group: its step label, else its step status
 * (unless the status is a template the host fills, `{speaker} is typing`),
 * else the definition's name. Never a counter.
 */
export function groupHeadingOf(
	node: Pick<GroupingNode, "expose"> | undefined,
	definitionName: string,
	language?: string
): string {
	const label = i18nTextIn(node?.expose?.label, language)
	if (label) return label
	const status = i18nTextIn(node?.expose?.status, language)
	if (status && !/[{}]/.test(status)) return status
	return definitionName
}

/** One option the view drew, beside the declaration it came from. */
export interface PlacedOption {
	d: Pick<Decl, "nodeKey" | "nodeKind" | "control" | "slot" | "path" | "typeLabel" | "stepHeading">
	option: ConfigOption
}

const MODEL_CONTROLS = new Set(["connection-ref", "sampling-ref"])

/** The model calls among a spec's declarations: oracles owning a person-facing connection or sampling slot. */
export function modelCallsOf(decls: readonly Pick<Decl, "nodeKey" | "nodeKind" | "control">[]): string[] {
	const out: string[] = []
	for (const d of decls)
		if (d.nodeKind === "oracle" && MODEL_CONTROLS.has(d.control) && !out.includes(d.nodeKey))
			out.push(d.nodeKey)
	return out
}

/**
 * The view's settings groups (see the file comment), from the options this
 * viewer was shown, in spine order. Each Advanced step is keyed and headed by
 * what its options carry in `step`.
 */
export function settingsGroupsOf(args: {
	placed: readonly PlacedOption[]
	decls: readonly Pick<Decl, "nodeKey" | "nodeKind" | "control" | "typeLabel">[]
	nodes: readonly GroupingNode[]
	edges: readonly { from: string; to: string }[]
	language?: string
}): SettingsGroup[] {
	const { placed, decls, nodes, edges, language } = args
	const modelCalls = modelCallsOf(decls)
	const plan = planGroups({ nodes, edges, modelCalls })
	const byKey = new Map(nodes.map((n) => [n.key, n]))
	const definitionName = (nodeKey: string) =>
		decls.find((d) => d.nodeKey === nodeKey)?.typeLabel ?? ""

	type Draft = Omit<SettingsGroup, "changedInAdvanced"> & { modelCall?: string }
	const drafts: Draft[] = plan.calls.map((c, i) => {
		const node = byKey.get(c.modelCall)
		const purpose = i18nTextIn(node?.expose?.purpose, language)
		return {
			key: `g${i}`,
			kind: "model-call",
			modelCall: c.modelCall,
			heading: groupHeadingOf(node, definitionName(c.modelCall), language),
			...(purpose ? { purpose } : {}),
			front: [],
			advanced: []
		}
	})
	// The whole pipeline — or, for a spec with one model call or none, the
	// one unheaded group that holds everything.
	const only = modelCalls.length === 1 ? modelCalls[0] : undefined
	const onlyPurpose = only ? i18nTextIn(byKey.get(only)?.expose?.purpose, language) : undefined
	const pipeline: Draft = plan.calls.length
		? { key: `g${drafts.length}`, kind: "pipeline", heading: "Whole pipeline", front: [], advanced: [] }
		: {
				key: "g0",
				kind: only ? "model-call" : "pipeline",
				...(only ? { modelCall: only } : {}),
				...(onlyPurpose ? { purpose: onlyPurpose } : {}),
				front: [],
				advanced: []
			}

	const prompts = new Map<Draft, ConfigOption[]>()
	const models = new Map<Draft, ConfigOption[]>()
	const sources = new Map<Draft, ConfigOption[]>()
	const push = (m: Map<Draft, ConfigOption[]>, g: Draft, o: ConfigOption) =>
		m.set(g, [...(m.get(g) ?? []), o])
	const steps = new Map<Draft, Map<string, SettingsGroupStep>>()

	for (const { d, option } of placed) {
		const at = plan.ownerOf(d.nodeKey)
		const g = at >= 0 ? drafts[at]! : pipeline
		const isSwitch = d.slot === "settings" && d.path === "enabled"
		if (isSwitch && d.nodeKey === g.modelCall) g.enabled = option
		else if (d.control === "prompts-ref" || d.nodeKind === "envoy") push(prompts, g, option)
		else if (MODEL_CONTROLS.has(d.control)) push(models, g, option)
		else if (isSwitch && d.nodeKind === "query")
			// A source's switch reads by the step it turns off (*World lore*),
			// not as one of several identical "Use this source" rows.
			push(sources, g, { ...option, label: d.stepHeading ?? d.typeLabel })
		else {
			const bySteps = steps.get(g) ?? new Map<string, SettingsGroupStep>()
			steps.set(g, bySteps)
			const key = option.step.key
			const step = bySteps.get(key) ?? {
				key,
				heading: option.step.heading,
				options: []
			}
			step.options.push(option)
			bySteps.set(key, step)
		}
	}

	const out: SettingsGroup[] = []
	for (const g of [...drafts, pipeline]) {
		const front = [...(prompts.get(g) ?? []), ...(models.get(g) ?? []), ...(sources.get(g) ?? [])]
		const advanced = [...(steps.get(g)?.values() ?? [])]
		if (!front.length && !advanced.length && !g.enabled) continue
		const { modelCall: _modelCall, ...rest } = g
		out.push({
			...rest,
			front,
			advanced,
			changedInAdvanced: advanced.reduce(
				(n, s) => n + s.options.filter((o) => o.changed).length,
				0
			)
		})
	}
	// One group left for this viewer is the whole card: no heading.
	if (out.length === 1) delete out[0]!.heading
	return out
}

/** Every option in a view's groups, once: each group's switch, its front, then its Advanced. */
export function groupOptions(groups: readonly SettingsGroup[]): ConfigOption[] {
	return groups.flatMap((g) => [
		...(g.enabled ? [g.enabled] : []),
		...g.front,
		...g.advanced.flatMap((s) => s.options)
	])
}

/**
 * The view's steps, each with every option it owns — front and Advanced
 * alike — in group order; what the builder lists (its client twin is
 * `builderStepsOf`).
 */
export function groupSteps(
	groups: readonly SettingsGroup[]
): { key: string; heading: string; options: ConfigOption[] }[] {
	const out = new Map<string, { key: string; heading: string; options: ConfigOption[] }>()
	for (const o of groupOptions(groups)) {
		const step = out.get(o.step.key) ?? { key: o.step.key, heading: o.step.heading, options: [] }
		step.options.push(o)
		out.set(o.step.key, step)
	}
	return [...out.values()]
}
