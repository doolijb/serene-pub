/**
 * The map's reactive seam: node components read selection, draft, and step
 * declarations through this context instead of carrying them in node data —
 * so a click or an edit re-renders the cards without rebuilding the laid-out
 * graph.
 */
export const MAP_CONTEXT_KEY = "serene-pub:pipeline-map"

export interface PipelineMapContext {
	readonly activeKey: string | null
	stepFor(stepKey: string | null): Sockets.Pipelines.Step | undefined
	pendingFor(stepKey: string): number
	onSelect(stepKey: string): void
}

/** Kind → the card's leading-edge stripe. An edge reads as a key. */
export const KIND_STRIPE: Record<string, string> = {
	input: "bg-surface-400-600",
	query: "bg-success-500",
	task: "bg-primary-500",
	provider: "bg-warning-500",
	consumer: "bg-error-500"
}

export const KIND_MEANING: Record<string, string> = {
	input: "the trigger",
	query: "reads data",
	task: "transforms",
	provider: "calls a model",
	consumer: "writes data"
}

export const BLOCK_LABEL: Record<string, string> = {
	async: "Fan-out",
	map: "For each",
	loop: "Loop",
	route: "Route"
}

export const BLOCK_MEANING: Record<string, string> = {
	async: "chains run side by side, results gathered",
	map: "runs its body once per item in a list",
	loop: "runs its body again until done (bounded)",
	route: "branches on a value — any subset may fire"
}

/** The frame's accent, one per construct. */
export const BLOCK_ACCENT: Record<string, string> = {
	async: "border-success-500/60",
	map: "border-tertiary-500/60",
	loop: "border-warning-500/60",
	route: "border-secondary-500/60"
}

export const countsFor = (step: Sockets.Pipelines.Step | undefined) => {
	if (!step) return null
	const all = [...step.options, ...step.advanced]
	return {
		total: all.length,
		overridden: all.filter((o) => o.overriddenHere).length
	}
}
