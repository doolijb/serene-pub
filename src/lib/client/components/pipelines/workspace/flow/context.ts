/**
 * The map's reactive seam: node components read selection, draft, and step
 * declarations through this context instead of carrying them in node data —
 * so a click or an edit re-renders the cards without rebuilding the laid-out
 * graph.
 */
import type { BuilderStep } from "$lib/client/components/pipelines/settingsGroups"

export const MAP_CONTEXT_KEY = "serene-pub:pipeline-map"

export interface PipelineMapContext {
	readonly activeKey: string | null
	stepFor(stepKey: string | null): BuilderStep | undefined
	pendingFor(stepKey: string): number
	onSelect(stepKey: string): void
}

/** Kind → the card's leading-edge stripe. An edge reads as a key. */
export const KIND_STRIPE: Record<string, string> = {
	inlet: "bg-surface-400-600",
	query: "bg-success-500",
	task: "bg-primary-500",
	oracle: "bg-warning-500",
	outlet: "bg-error-500"
}

export const KIND_MEANING: Record<string, string> = {
	inlet: "where the run enters",
	query: "reads data",
	task: "transforms",
	oracle: "calls out — a model, a tool, a person",
	outlet: "writes, attaches or emits"
}

/** The four clause rules (NOMENCLATURE §4), labelled. */
export const CLAUSE_LABEL: Record<string, string> = {
	gather: "Gather",
	each: "For each",
	loop: "Loop",
	junction: "Junction"
}

export const CLAUSE_MEANING: Record<string, string> = {
	gather: "chains run side by side, results gathered",
	each: "runs its body once per item in a list",
	loop: "runs its body again until done (bounded)",
	junction: "branches on a value — any subset may fire"
}

/** The frame's accent, one per clause rule. */
export const CLAUSE_ACCENT: Record<string, string> = {
	gather: "border-success-500/60",
	each: "border-tertiary-500/60",
	loop: "border-warning-500/60",
	junction: "border-secondary-500/60"
}

export const countsFor = (step: BuilderStep | undefined) => {
	if (!step) return null
	const all = step.options
	return {
		total: all.length,
		overridden: all.filter((o) => o.overriddenHere).length
	}
}
