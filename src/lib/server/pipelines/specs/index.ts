/**
 * The pipelines core ships.
 *
 * One registry rather than a list of builders beside a map of display names.
 * Those were two collections that had to agree, and adding a pipeline meant
 * editing both — forgetting the second published a spec whose name in the
 * user's sidebar was its slug, which is a failure that shows up in the product
 * rather than in a test.
 *
 * `name` is what a person calls the thing. The pipeline view (05 §0a) lists
 * these — *"a flat list of the things SP does for you"* — and a list showing
 * `core:spec/respond` is a list of identifiers, not of things.
 */

import { RESPOND_SPEC_ID, respondSpec } from "$lib/server/pipelines/specs/respond"
import { NARRATE_SPEC_ID, narrateSpec } from "$lib/server/pipelines/specs/narrate"
import { GRAPH_BUILD_SPEC_ID, graphBuildSpec } from "$lib/server/pipelines/specs/graphBuild"
import {
	SUMMARIZE_CHARACTER_SPEC_ID,
	SUMMARIZE_HISTORY_SPEC_ID,
	SUMMARIZE_SCENE_SPEC_ID,
	SUMMARIZE_WORLD_SPEC_ID,
	summarizeCharacterSpec,
	summarizeHistorySpec,
	summarizeSceneSpec,
	summarizeWorldSpec
} from "$lib/server/pipelines/specs/summarize"

export interface CoreSpec {
	slug: string
	name: string
	/**
	 * Compiled lazily.
	 *
	 * Compiling resolves type pins against the registry, and boot syncs that
	 * registry first. Building at module scope would run the compile at import
	 * time — before the sync, and before the conflict check that decides whether
	 * these types mean what this build thinks they mean.
	 */
	build: () => any
}

/**
 * The seven namespaces core ships.
 *
 * Named for what they do to a person's chat, not for what they are made of.
 * These are the entries the pipeline view lists, and a list reading
 * `core:spec/summarize-history` is a list of identifiers.
 */
export const CORE_SPECS: CoreSpec[] = [
	{ slug: RESPOND_SPEC_ID, name: "Chat reply", build: respondSpec },
	{ slug: NARRATE_SPEC_ID, name: "Narrator reply", build: narrateSpec },
	{
		slug: SUMMARIZE_WORLD_SPEC_ID,
		name: "Summarize: world lore",
		build: summarizeWorldSpec
	},
	{
		slug: SUMMARIZE_CHARACTER_SPEC_ID,
		name: "Summarize: character lore",
		build: summarizeCharacterSpec
	},
	{
		slug: SUMMARIZE_SCENE_SPEC_ID,
		name: "Summarize: scene",
		build: summarizeSceneSpec
	},
	{
		slug: SUMMARIZE_HISTORY_SPEC_ID,
		name: "Summarize: history entry",
		build: summarizeHistorySpec
	},
	{
		slug: GRAPH_BUILD_SPEC_ID,
		name: "Narrative graph build",
		build: graphBuildSpec
	}
]

/** Lookup by slug, for a caller holding an id that wants the display name. */
export const coreSpec = (slug: string): CoreSpec | undefined =>
	CORE_SPECS.find((s) => s.slug === slug)

export { RESPOND_SPEC_ID, RESPOND_VERSION, respondSpec } from "$lib/server/pipelines/specs/respond"
export { NARRATE_SPEC_ID, NARRATE_VERSION, narrateSpec } from "$lib/server/pipelines/specs/narrate"
export {
	GRAPH_BUILD_SPEC_ID,
	GRAPH_BUILD_VERSION,
	graphBuildSpec
} from "$lib/server/pipelines/specs/graphBuild"
export * from "$lib/server/pipelines/specs/summarize"
