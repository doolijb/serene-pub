/**
 * The script map's pure half (PLAN-script-placement D3, R-Q1 as amended): the
 * Scripts tab in the admin pipeline workspace lists every seam of a pipeline
 * in run order, grouped by step, with what is attached there.
 *
 * Nothing is computed that the panel payload does not already say: the
 * server emits one `scripts-chain` option per seam, in run order, each with
 * its address, words and resolved chain (`config/panel/read.ts`). This only
 * files those options under their steps and sets the unplaced ones (D4)
 * apart, so the rule is testable without mounting the component.
 */

type Option = Sockets.Pipelines.Option

/** One step of the map: its heading and its seams, in run order. */
export interface ScriptMapStep {
	stepKey: string
	heading: string
	rows: Option[]
}

export interface ScriptMap {
	steps: ScriptMapStep[]
	/** Chains at a seam the step does not declare (D4, unplaced), in payload order. */
	unplaced: Option[]
}

/**
 * Group a view's options into the map: `scripts-chain` options only, steps in
 * the order their first seam appears, seams in payload order within a step.
 * An unplaced chain is listed once, under *Unplaced*, never under its step.
 */
export function groupSeams(options: readonly Option[]): ScriptMap {
	const steps: ScriptMapStep[] = []
	const byKey = new Map<string, ScriptMapStep>()
	const unplaced: Option[] = []
	for (const o of options) {
		if (o.control !== "scripts-chain") continue
		if (o.unplaced) {
			unplaced.push(o)
			continue
		}
		let step = byKey.get(o.step.key)
		if (!step) {
			step = { stepKey: o.step.key, heading: o.step.heading, rows: [] }
			byKey.set(o.step.key, step)
			steps.push(step)
		}
		step.rows.push(o)
	}
	return { steps, unplaced }
}

/**
 * Where a map row opens: the Configure tab on that configuration and step,
 * landed on the chain (`?option=` scrolls and flashes it).
 */
export function seamHref(
	slug: string,
	configId: number | null | undefined,
	option: Pick<Option, "id" | "step">
): string {
	const q = new URLSearchParams({ tab: "configure" })
	if (configId != null) q.set("config", String(configId))
	q.set("step", option.step.key)
	q.set("option", option.id)
	return `/admin/pipelines/${encodeURIComponent(slug)}?${q}`
}

/** The connection guards line on a `text/stop` seam, or null when there are none. */
export function connectionGuardsLine(option: Pick<Option, "connectionScripts">): string | null {
	const cs = option.connectionScripts
	if (!cs?.entries.length) return null
	return `Also here: ${cs.connectionName}'s stop guards: ${cs.entries
		.map((e) => e.name)
		.join(", ")}`
}
