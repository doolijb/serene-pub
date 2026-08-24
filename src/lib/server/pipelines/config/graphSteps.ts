/**
 * The graph-build pipeline's configuration, resolved for the builder.
 *
 * The graph build is the one flow whose execution has not moved inside the
 * executor yet: `graphBuilder.ts` carries a cast ledger, pair-wise perspective
 * loops, fuzzy dedup and resume checkpoints that the five step bindings do not
 * — moving those is a redesign, not a call-site change. What moves *now* is
 * the thing a person actually touches: which model, which sampling profile
 * and which prompt each step runs on. See `stepConfig.ts` for the mechanism.
 */

import { resolveStepConfigs } from "$lib/server/pipelines/config/stepConfig"
import { GRAPH_BUILD_SPEC_ID } from "$lib/server/pipelines/specs"

type Db = { select: any }

/** The builder's step names, keyed to the spec's node keys inside the map. */
const STEP_NODES = {
	preFilter: "building.item.prefilter",
	nodeResolution: "building.item.resolution",
	perspective: "building.item.perspective",
	nodeDescription: "building.item.describe",
	stateDetection: "building.item.state"
} as const

export type GraphStepKey = keyof typeof STEP_NODES

export interface ResolvedGraphStep {
	/** The configured system prompt, or undefined to use the builder's fallback. */
	systemPrompt?: string
	/** Whole rows, because `graphBuilder.runLLM` constructs its own adapter. */
	connection?: any
	sampling?: any
}

export async function resolveGraphStepConfigs(
	db: Db
): Promise<Record<GraphStepKey, ResolvedGraphStep>> {
	const resolved = await resolveStepConfigs(
		db,
		GRAPH_BUILD_SPEC_ID,
		Object.values(STEP_NODES)
	)

	const out = {} as Record<GraphStepKey, ResolvedGraphStep>
	for (const [step, nodeKey] of Object.entries(STEP_NODES) as Array<
		[GraphStepKey, string]
	>) {
		const at = resolved[nodeKey]
		// Each graph step declares exactly one prompt field, named after itself.
		out[step] = {
			systemPrompt: at?.prompts?.[step],
			connection: at?.connection,
			sampling: at?.sampling
		}
	}
	return out
}
