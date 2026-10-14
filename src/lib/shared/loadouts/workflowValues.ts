/**
 * A loadout's **workflow values** (lane E2): the dials of its ComfyUI
 * workflow as the loadout sets them — variable name → value. The workflow's
 * own defaults sit under them; a step's override sits over them
 * (`mergeWorkflowValues`).
 */

/**
 * A stored or sent dials map, cleaned: a plain object of scalar values only
 * (a dial is a number, a string or a switch), `{}` collapsing to null.
 */
export function workflowValuesOf(raw: unknown): Record<string, unknown> | null {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
	const out: Record<string, unknown> = {}
	for (const [key, value] of Object.entries(raw as Record<string, unknown>))
		if (
			(typeof value === "number" && Number.isFinite(value)) ||
			typeof value === "string" ||
			typeof value === "boolean"
		)
			out[key] = value
	return Object.keys(out).length ? out : null
}

/**
 * The run's dials, lowest first: the workflow's defaults, then the
 * loadout's values, then the step's own. Undefined layers are skipped, and
 * an undefined value never unsets a lower one.
 */
export function mergeWorkflowValues(
	...layers: (Record<string, unknown> | null | undefined)[]
): Record<string, unknown> {
	const out: Record<string, unknown> = {}
	for (const layer of layers)
		for (const [key, value] of Object.entries(layer ?? {}))
			if (value !== undefined) out[key] = value
	return out
}
