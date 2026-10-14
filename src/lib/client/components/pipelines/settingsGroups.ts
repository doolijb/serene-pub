/**
 * The pure half of the settings panel: what a surface draws from the server's
 * settings groups (`NamespaceDetail.groups`, derived from the graph on the
 * server — owner rulings 2026-09-30, Q5), and the one scope rule the sidebar
 * applies inside a session (Q7). Kept out of the component so each rule is
 * testable without mounting it.
 */

type Option = Sockets.Pipelines.Option
type Group = Sockets.Pipelines.SettingsGroup

/**
 * Where a panel mounted from inside a session writes (owner Q7): at the
 * session's own scope only for a pipeline that session runs. Any other
 * pipeline is shown at configuration scope — an administrator's to change,
 * read-only for everyone else.
 */
export function sessionScopeFor(
	slug: string,
	sessionId: number | undefined,
	runs: ReadonlySet<string>
): number | undefined {
	return sessionId != null && runs.has(slug) ? sessionId : undefined
}

/**
 * Which surface a panel is on:
 *  · `config` — the Pipelines view and the lorebook graph panel: every group
 *    with its front rows and its own Advanced, the configuration picker and
 *    the scope note;
 *  · `session` — a session's settings: a card per pipeline, each group's
 *    switch, Prompt, Model and Sampling only, no inline editors;
 *  · `builder` — the admin builder: one step at a time, every row open.
 */
export type PanelMode = "config" | "session" | "builder"

/**
 * A front row's label (owner rulings 2026-09-30): the three model-call
 * choices read the same in every group, whatever their slot is called.
 */
const FRONT_LABELS: Record<string, string> = {
	"loadout-ref": "Loadout",
	"prompts-ref": "Prompt",
	"connection-ref": "Model",
	"sampling-ref": "Sampling"
}

export const rowLabelOf = (o: Pick<Option, "control" | "label">): string =>
	FRONT_LABELS[o.control] ?? o.label

/**
 * A front row a session draws: the prompt, the model, the sampling — never a
 * source's switch, and never a Loadout (a session never picks one, I12; the
 * server sends none — this is the second lock).
 */
const sessionDraws = (o: Option) => o.control !== "boolean" && o.control !== "loadout-ref"

/**
 * The groups a surface draws, shaped for it. A session keeps each group's
 * switch and its Prompt, Model and Sampling (an envoy's texts are its
 * prompt), and no Advanced. A group with nothing left is dropped, and when
 * one group is all that remains its heading goes (the card is the heading).
 */
export function drawnGroups(groups: readonly Group[], mode: PanelMode): Group[] {
	const shaped =
		mode === "session"
			? groups.map((g) => ({
					...g,
					front: g.front.filter(sessionDraws),
					advanced: [],
					changedInAdvanced: 0
				}))
			: groups.map((g) => ({ ...g }))
	const kept = shaped.filter((g) => g.enabled || g.front.length || g.advanced.length)
	if (kept.length === 1 && kept[0]!.heading) {
		const { heading: _heading, ...rest } = kept[0]!
		return [rest]
	}
	return kept
}

/** How many settings a group's Advanced holds. */
export const advancedCount = (g: Pick<Group, "advanced">): number =>
	g.advanced.reduce((n, s) => n + s.options.length, 0)

/** The fold's summary: "Advanced · 19 settings · 2 changed". */
export function advancedSummary(g: Pick<Group, "advanced" | "changedInAdvanced">): string {
	const n = advancedCount(g)
	const parts = ["Advanced", `${n} ${n === 1 ? "setting" : "settings"}`]
	if (g.changedInAdvanced) parts.push(`${g.changedInAdvanced} changed`)
	return parts.join(" · ")
}

/**
 * One line of what a step or an agent receives or carries out (the server's
 * `panel/` lane, 2026-10-12): the port's name, its shape (drawn as a
 * tooltip), the words to show, and for a received line the step key it
 * comes from.
 *
 * Declared here structurally until `Sockets.Pipelines` carries the fields;
 * every read goes through `PortsOf` / `StepPortsOf`, so an older server that
 * sends none simply draws no cards.
 */
export interface PortLine {
	port: string
	shape: string
	label: string
	from?: string
}

/** What a step does beyond handing its result on. */
export type StepEffect = "none" | "external" | "write" | "emit"

interface PortsOf {
	receives?: PortLine[]
	carriesOut?: PortLine[]
}
interface StepPortsOf extends PortsOf {
	effect?: StepEffect
}

const portsOf = (x: object): PortsOf => {
	const { receives, carriesOut } = x as PortsOf
	return {
		...(Array.isArray(receives) ? { receives } : {}),
		...(Array.isArray(carriesOut) ? { carriesOut } : {})
	}
}

/**
 * One step as the builder lists it: every row the step owns, front and
 * Advanced alike, filed under the group (agent) it belongs to.
 */
export interface BuilderStep extends StepPortsOf {
	key: string
	heading: string
	/** The group's key — the agent it is filed under. */
	group: string
	/** The group's heading — absent for the one unheaded group. */
	agent?: string
	/** `Agent · Step`, or the step alone. */
	label: string
	options: Option[]
}

/** One agent (settings group) as the builder selects it. */
export interface BuilderGroup extends PortsOf {
	key: string
	/** Absent for the one unheaded group. */
	heading?: string
	purpose?: string
	/** Its steps' keys, in builder order. */
	steps: string[]
}

/** The builder's step list, in group order, each step once. */
export function builderStepsOf(groups: readonly Group[]): BuilderStep[] {
	// A step's ports and effect, from the first group row that has them.
	const portsByStep = new Map<string, StepPortsOf>()
	for (const g of groups)
		for (const s of g.advanced) {
			const have = portsByStep.get(s.key) ?? {}
			const { effect } = s as StepPortsOf
			portsByStep.set(s.key, {
				...portsOf(s),
				...(effect ? { effect } : {}),
				...have
			})
		}
	const out: BuilderStep[] = []
	const byKey = new Map<string, BuilderStep>()
	for (const g of groups) {
		const rows = [
			...(g.enabled ? [g.enabled] : []),
			...g.front,
			...g.advanced.flatMap((s) => s.options)
		]
		for (const o of rows) {
			let step = byKey.get(o.step.key)
			if (!step) {
				step = {
					key: o.step.key,
					heading: o.step.heading,
					group: g.key,
					...(g.heading ? { agent: g.heading } : {}),
					label: g.heading ? `${g.heading} · ${o.step.heading}` : o.step.heading,
					...portsByStep.get(o.step.key),
					options: []
				}
				byKey.set(o.step.key, step)
				out.push(step)
			}
			step.options.push(o)
		}
	}
	return out
}

/** The builder's agents, in group order, each with the steps filed under it. */
export function builderGroupsOf(groups: readonly Group[]): BuilderGroup[] {
	const steps = builderStepsOf(groups)
	return groups.map((g) => ({
		key: g.key,
		...(g.heading ? { heading: g.heading } : {}),
		...(g.purpose ? { purpose: g.purpose } : {}),
		...portsOf(g),
		steps: steps.filter((s) => s.group === g.key).map((s) => s.key)
	}))
}

/** One drawn line of a Receives or Carries out card. */
export interface PortCardLine {
	key: string
	label: string
	/** The step it comes from, by heading — received lines only. */
	from?: string
	/** The port's shape, for the tooltip. */
	shape: string
}

/** The two inspector cards, or `null` when the server sent neither list. */
export interface PortCards {
	receives: PortCardLine[]
	carriesOut: PortCardLine[]
	/** The effect chip's words — absent for `none` or no effect. */
	effect?: string
}

const EFFECT_WORDS: Partial<Record<StepEffect, string>> = {
	write: "Writes the session",
	emit: "Raises an event",
	external: "Reaches outside"
}

/**
 * What the inspector's Receives and Carries out cards draw for a step or an
 * agent. A `from` names its step by heading where the builder knows it, else
 * as sent. Nothing at all (an older server) is `null`: no cards.
 */
export function portCardsOf(
	subject: StepPortsOf,
	headingOf: (stepKey: string) => string | undefined
): PortCards | null {
	if (!subject.receives && !subject.carriesOut) return null
	const line = (p: PortLine, i: number, withFrom: boolean): PortCardLine => ({
		key: `${p.port}:${p.from ?? ""}:${i}`,
		label: p.label,
		shape: p.shape,
		...(withFrom && p.from ? { from: headingOf(p.from) ?? p.from } : {})
	})
	const effect = subject.effect ? EFFECT_WORDS[subject.effect] : undefined
	return {
		receives: (subject.receives ?? []).map((p, i) => line(p, i, true)),
		carriesOut: (subject.carriesOut ?? []).map((p, i) => line(p, i, false)),
		...(effect ? { effect } : {})
	}
}

/** Every option in a view, once — for search and the Changes list. */
export const optionsOf = (groups: readonly Group[]): Option[] =>
	builderStepsOf(groups).flatMap((s) => s.options)
