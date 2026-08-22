/**
 * Core's narrative-graph build pipeline.
 *
 * Five LLM steps over the scenes of a chat, each with its own prompt, connection
 * and sampling config. That structure is not new — `graph_build_configs` already
 * carries it as fifteen columns, three per step. Five Providers is the same
 * statement with the enumeration removed, which is what makes a sixth step a
 * spec change rather than a migration.
 *
 * ## The order is real, so the steps are sequential
 *
 * Pre-filter drops what is not worth graphing *before* the expensive steps run;
 * node resolution decides whether a mentioned name is someone already in the
 * graph; description only runs for the nodes resolution found to be new. Each
 * genuinely depends on the last, so this is a chain rather than an `async`
 * block — declaring it parallel would be faster and wrong.
 *
 * ## It stops at a proposal
 *
 * The final Consumer publishes `write-result@1`, which is deliberately **not**
 * assignable to row ids: under review a proposal is something a person may still
 * reject, and a downstream node that treated it as rows would wire a foreign key
 * to something that may never exist. This is the mechanism behind the rule that
 * a graph build always stops at the Review Proposal screen and never applies
 * itself — enforced by a port shape rather than by a check somebody remembers.
 *
 * ## One configuration hazard worth naming
 *
 * Each step may point at its own sampling config, and a sampling config carries
 * the **context window**. Pointing two steps at configs with different Context
 * Tokens makes a local backend reload the model between every step, which the
 * health probe then reads as a dead server. The steps therefore default to the
 * same config, and diverging is a deliberate act rather than the starting state.
 */

import { compile, spec, slot } from "@serene-pub/sdk"
import * as C from "@serene-pub/contracts"

export const GRAPH_BUILD_SPEC_ID = "core:spec/graph-build"
// 1.0.1: `$.building.item` compiles to a real per-iteration edge now (the SDK
// scope fix) — 1.0.0's published rows carried a dud reference, so each step ran
// against no scene. Same authored source; corrected document; new version,
// because a published version is immutable.
export const GRAPH_BUILD_VERSION = "1.0.1"

/** Every step takes the scene it is working on and its own three slots. */
const step = ($: any) => ({
	scenes: $.building.item,
	connection: slot.connection(),
	sampling: slot.sampling(),
	prompts: slot.prompts()
})

/**
 * The ceiling on scenes in one build.
 *
 * Mandatory (F9), and enforced by the database as well. High enough not to be
 * reached by a real chat: the cost that matters is per scene, and a user who
 * genuinely has 400 scenes should get all of them rather than a silent
 * truncation they have no way to notice.
 */
const MAX_SCENES = 500

export const graphBuildSpec = () =>
	compile(
		spec(GRAPH_BUILD_SPEC_ID, { version: GRAPH_BUILD_VERSION })
			.on("core:event/ui-action@1")
			.input("input", C.userMessage.v1())
			.query("scenes", ($) =>
				C.graphScenes.v1({ scope: $.input.chatScope })
			)
			// Scene by scene, and **sequential**.
			//
			// The map is not an optimization here — it is the shape of the work.
			// The builder walks the scenes in order, and each scene's resolution
			// step decides whether a name refers to someone an earlier scene
			// already introduced. Running them in parallel would make that
			// question unanswerable and duplicate every character discovered
			// twice.
			.map(
				"building",
				{
					over: ($: any) => $.scenes.scenes,
					max: MAX_SCENES,
					mode: "sequential"
				},
				(m) =>
					m
						.provider("prefilter", ($: any) =>
							C.graphPreFilter.v1(step($))
						)
						.provider("resolution", ($: any) =>
							C.graphNodeResolution.v1(step($))
						)
						.provider("perspective", ($: any) =>
							C.graphPerspective.v1(step($))
						)
						.provider("describe", ($: any) =>
							C.graphNodeDescription.v1(step($))
						)
						.provider("state", ($: any) =>
							C.graphStateDetection.v1(step($))
						)
			)
			.consume("propose", ($: any) =>
				C.graphProposal.v1({ proposal: $.building.main })
			)
			.build()
	)
