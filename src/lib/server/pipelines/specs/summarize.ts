/**
 * The four summarize pipelines: world lore, character lore, scene, history entry.
 *
 * ## Why four specs and not one with a `loreType` parameter
 *
 * They are four *namespaces*. Each has its own prompts, its own connection and
 * sampling choices per step, and its own configs a user swaps between — which is
 * exactly what `world_summarize_configs`, `character_summarize_configs` and
 * `scene_summarize_configs` already are. One spec with a discriminator would put
 * that difference in a condition somebody has to find, and would give all four a
 * single shared prompt set, which is the thing the three tables exist to avoid.
 *
 * History entry summarization gets the fourth. Today it is a `loreType` the
 * summarizer already supports (`"world" | "history" | "character" | "scene"`)
 * that falls through to the **scene** config in `sockets/summarize.ts` — so a
 * user tuning scene summaries silently retunes history entries. That is a defect
 * this split fixes rather than a feature it adds.
 *
 * ## The two phases, and why the first is a `map`
 *
 * Messages are cut into token-sized batches and each is drafted *without sight
 * of any other*; the ordered drafts are then merged into one narrative. Drafting
 * in isolation is what makes a long session summarizable at all — the model never
 * holds more than one batch — and the batches genuinely do not depend on each
 * other, so `map` states that and lets the connection's own queue decide the
 * ordering. A loop would impose a sequence the work does not have.
 */

import { compile, spec, slot } from "@serene-pub/sdk"
import * as C from "@serene-pub/contracts"

export const SUMMARIZE_WORLD_SPEC_ID = "core:spec/summarize-world"
export const SUMMARIZE_CHARACTER_SPEC_ID = "core:spec/summarize-character"
export const SUMMARIZE_SCENE_SPEC_ID = "core:spec/summarize-scene"
export const SUMMARIZE_HISTORY_SPEC_ID = "core:spec/summarize-history"
// 1.1.0: the request travels to the drafting, synthesis and cast steps, so a
// topic focuses every prompt and the known-cast list reaches extraction. A
// published version is immutable, so the wiring change is a new version and
// 1.0.0 stays for anything that resolved against it.
export const SUMMARIZE_VERSION = "1.2.0"

/**
 * The ceiling on batches for one run.
 *
 * Mandatory — F9 makes repetition without a bound inexpressible, and the
 * database enforces it too (`pipeline_blocks_bounded_check`). 512 is chosen to
 * be far above any real session rather than tuned: the batch *size* is the knob a
 * user turns, and this is the guard that stops a runaway from becoming a bill.
 */
const MAX_BATCHES = 512

interface SummarizeShape {
	id: string
	/**
	 * Which kind of entry this namespace writes.
	 *
	 * Authored on the nodes, not configured. It is the thing that distinguishes
	 * the four namespaces from one another — the prompt templates branch on it
	 * for every phase — so it belongs to the pipeline's identity rather than to
	 * a user's tuning. A user changing it would turn their scene summarizer into
	 * a world summarizer without renaming anything.
	 */
	loreType: "world" | "character" | "scene" | "history"
	/** Scene summaries also work out who was present. */
	extractsCast?: boolean
}

/**
 * One summarize pipeline.
 *
 * The `extractsCast` arm is the only structural difference between the four, and
 * it is a whole extra Provider with its own prompt, connection and sampling —
 * which is why it is a branch here rather than a slot on a shared node.
 */
const summarizeSpec = ({ id, loreType, extractsCast }: SummarizeShape) =>
	compile(
		(() => {
			const base = spec(id, { version: SUMMARIZE_VERSION })
				// Manually triggered: a person asks for a summary. ACTION events
				// carry no write targets, so this drops out of the cycle check by
				// construction rather than by exception (13 §7g).
				.on("core:event/ui-action@1")
				.input("input", C.summarizeRequest.v1())
				.query("transcript", ($) =>
					C.summarizeSource.v1({
						scope: $.input.scope,
						request: $.input.request
					})
				)
				.task("batches", ($) =>
					C.batchMessages.v1({
						messages: $.transcript.messages,
						params: slot.params()
					})
				)
				.map(
					"drafting",
					{ over: ($: any) => $.batches.batches, max: MAX_BATCHES },
					(m) =>
						m.provider("draft", ($: any) =>
							C.summarizeBatch.v1({
								// The one batch this iteration drafts. Without it
								// the node has no input and every draft is written
								// against nothing — which produces plausible
								// summaries of a conversation that did not happen.
								batch: $.drafting.item,
								// The person's ask — the topic line, most
								// visibly. Wired to every drafting iteration
								// because the focus has to hold *per batch*,
								// not arrive at synthesis after the drafts
								// already wandered.
								request: $.input.request,
								loreType,
								connection: slot.connection(),
								sampling: slot.sampling(),
								prompts: slot.prompts()
							})
						)
				)
				.provider("synth", ($: any) =>
					C.summarizeSynth.v1({
						drafts: $.drafting.main,
						request: $.input.request,
						loreType,
						connection: slot.connection(),
						sampling: slot.sampling(),
						prompts: slot.prompts()
					})
				)
				.provider("naming", ($: any) =>
					C.nameEntry.v1({
						content: $.synth.content,
						loreType,
						connection: slot.connection(),
						sampling: slot.sampling(),
						prompts: slot.prompts()
					})
				)

			const withCast = extractsCast
				? base.provider("cast", ($: any) =>
						C.extractCast.v1({
							content: $.synth.content,
							messages: $.transcript.messages,
							// The known-cast list ([id: N] entries), so the
							// extraction prompt references real ids instead of
							// inventing castIds the resolve step must drop.
							request: $.input.request,
							connection: slot.connection(),
							sampling: slot.sampling(),
							prompts: slot.prompts()
						})
					)
				: base

			return withCast
				.consume("save", ($: any) =>
					C.createLoreEntry.v1({
						name: $.naming.name,
						content: $.synth.content
					})
				)
				.build()
		})()
	)

export const summarizeWorldSpec = () =>
	summarizeSpec({ id: SUMMARIZE_WORLD_SPEC_ID, loreType: "world" })

export const summarizeCharacterSpec = () =>
	summarizeSpec({ id: SUMMARIZE_CHARACTER_SPEC_ID, loreType: "character" })

export const summarizeSceneSpec = () =>
	summarizeSpec({
		id: SUMMARIZE_SCENE_SPEC_ID,
		loreType: "scene",
		extractsCast: true
	})

export const summarizeHistorySpec = () =>
	summarizeSpec({ id: SUMMARIZE_HISTORY_SPEC_ID, loreType: "history" })
