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
	"prompts-ref": "Prompt",
	"connection-ref": "Model",
	"sampling-ref": "Sampling"
}

export const rowLabelOf = (o: Pick<Option, "control" | "label">): string =>
	FRONT_LABELS[o.control] ?? o.label

/** A front row a session draws: the prompt, the model, the sampling — never a source's switch. */
const sessionDraws = (o: Option) => o.control !== "boolean"

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
 * One step as the builder lists it: every row the step owns, front and
 * Advanced alike, filed under the group (agent) it belongs to.
 */
export interface BuilderStep {
	key: string
	heading: string
	/** The group's heading — absent for the one unheaded group. */
	agent?: string
	/** `Agent · Step`, or the step alone. */
	label: string
	options: Option[]
}

/** The builder's step list, in group order, each step once. */
export function builderStepsOf(groups: readonly Group[]): BuilderStep[] {
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
					...(g.heading ? { agent: g.heading } : {}),
					label: g.heading ? `${g.heading} · ${o.step.heading}` : o.step.heading,
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

/** Every option in a view, once — for search and the Changes list. */
export const optionsOf = (groups: readonly Group[]): Option[] =>
	builderStepsOf(groups).flatMap((s) => s.options)
