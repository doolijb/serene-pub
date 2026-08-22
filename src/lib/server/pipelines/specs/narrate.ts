/**
 * Core's narrator pipeline — a narration or environment turn.
 *
 * ## Why this is its own namespace rather than a flag on the reply pipeline
 *
 * Structurally it is the reply pipeline: same queries, same assembly, same
 * provider. Every difference is *configuration* — a different system prompt, a
 * different post-history reminder, a name on the line the model continues from,
 * and its own connection and sampling choices. That is precisely the set of
 * things a namespace holds, and `narrator_prompt_configs` is already that table
 * wearing a different name.
 *
 * A flag on the reply spec would have made the two share one config surface,
 * which is the thing a user configuring a narrator most needs them not to do:
 * the narrator's whole job is to *not* sound like the character reply that
 * shares its chat.
 *
 * ## What it deliberately keeps
 *
 * Lorebook triggers, because a narrator describing a place needs the lore about
 * that place as much as a character does. Reading `generateResponse.ts` closely,
 * the thing narrator mode actually skips is **graph context** — which needs a
 * speaking character's perspective and a narrator has none — not retrieval. The
 * two are easy to conflate, and conflating them would quietly strip a narrator
 * of its world.
 */

import { compile, spec, slot } from "@serene-pub/sdk"
import * as C from "@serene-pub/contracts"

export const NARRATE_SPEC_ID = "core:spec/narrate"
// 1.1.0: shared prompts slot, exactly as the respond spec (13 §12 finding i).
// 1.2.0: the `variables` slot, also exactly as the respond spec — and the
// layouts it selects are the *same rows*, since a layout is keyed by the
// variable it renders rather than by the pipeline that asked for it.
// 1.3.0: assembly's own `variables` slot, for its post-budget lore and history.
export const NARRATE_VERSION = "1.3.0"

export const narrateSpec = () =>
	compile(
		spec(NARRATE_SPEC_ID, { version: NARRATE_VERSION })
			// Manually triggered — a person asks the narrator to speak. Unlike the
			// reply pipeline, nothing about a new message should start one.
			.on("core:event/ui-action@1")
			.input("input", C.userMessage.v1())
			.query("history", ($) =>
				C.chatHistory.v1({ scope: $.input.chatScope })
			)
			.query("lore", ($) =>
				C.lorebookTriggers.v1({ scope: $.input.chatScope })
			)
			.query("cast", ($) => C.chatCast.v1({ scope: $.input.chatScope }))
			.task("context", ($) =>
				C.buildTemplateContext.v1({
					cast: $.cast.cast,
					prompts: slot.prompts(),
					variables: slot.variables()
				})
			)
			.task("rank", ($) =>
				C.rankHybrid.v1({
					candidates: $.lore.main,
					params: slot.params()
				})
			)
			.task("lines", ($) =>
				C.processMessages.v1({
					messages: $.history.messages,
					cast: $.cast.cast,
					templateContext: $.context.templateContext,
					seedName: $.context.seedName
				})
			)
			.task("prompt", ($) =>
				C.assemble.v2({
					candidates: $.rank.candidates,
					decisions: $.rank.decisions,
					messages: $.lines.messages,
					templateContext: $.context.templateContext,
					template: slot.template(),
					// The context builder's authored text, by reference — one
					// prompt, written once, read where the template asks for
					// `{{systemPrompt}}` (13 §12 finding i).
					prompts: slot.prompts({ node: "context" }),
					// Assemble's own layouts — the lore and history *it*
					// produced, laid out after the budget decided what fit.
					// Its own slot, not the context builder's: no earlier node
					// knows the answer.
					variables: slot.variables(),
					params: slot.params()
				})
			)
			.provider("generate", ($) =>
				C.generateText.v1({
					context: $.prompt.context,
					// Shared too, so the panel does not offer a third copy of
					// the same authored text on the sending node.
					prompts: slot.prompts({ node: "context" })
				})
			)
			.consume("save", ($) =>
				C.createMessage.v1({ text: $.generate.text })
			)
			.build()
	)
