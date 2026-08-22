/**
 * Core's answer-a-message pipeline.
 *
 * One file per spec, because a pipeline is content and content grows: the
 * summarize and graph-build specs are several nodes each with their own step
 * prompts, and a single module holding all of them would be a merge conflict
 * waiting for the first person to add a sixth.
 */

import { compile, spec, slot } from "@serene-pub/sdk"
import * as C from "@serene-pub/contracts"

/** The spec a chat turn runs. */
export const RESPOND_SPEC_ID = "core:spec/respond"
// 1.1.0: one authored prompt, not three. The context builder owns the
// `prompts` slot; assemble and generate read it by reference (13 §12 finding
// i, closed) — so the panel renders one prompts group and `world.ts` no
// longer writes the same text to two nodes. A published version is
// immutable, so the rewiring is a new version.
//
// 1.2.0: the context builder takes a `variables` slot, so how each part of the
// prompt is laid out is a selection rather than a `JSON.stringify` in
// TypeScript. The shipped layouts reproduce the old output byte for byte —
// this version changes what is *configurable*, not what is produced.
//
// 1.3.0: the same for assembly, whose lore and history are laid out *after* the
// budget decided what fit. A separate bump rather than folding it into 1.2.0:
// an install that already published 1.2.0 would keep its stored document,
// since seeding matches on (slug, semver) — so rewriting a version in place is
// how a pipeline silently ends up without the wiring the code assumes.
//
// 1.4.0: the narrative graph's relationship summary reaches the prompt. It
// always did on the legacy path (`generateResponse.ts` set it on the adapter)
// and never did here, so a user with the graph on lost the block by switching —
// a missing feature rather than a changed one, which is why it lands as a new
// version and not a fix.
export const RESPOND_VERSION = "1.4.0"

/**
 * Core's answer-a-message pipeline.
 *
 * The keyword arm only, deliberately: it is the configuration every install has,
 * and the semantic arm needs a loaded embedding model that most do not have on
 * first boot. A spec that halts on a missing model would be the first thing a
 * new user saw.
 */
export const respondSpec = () =>
	compile(
		spec(RESPOND_SPEC_ID, { version: RESPOND_VERSION })
			.on("core:event/message-created@1")
			.input("input", C.userMessage.v1())
			.query("history", ($) =>
				C.chatHistory.v1({ scope: $.input.chatScope })
			)
			.query("lore", ($) =>
				C.lorebookTriggers.v1({ scope: $.input.chatScope })
			)
			.query("cast", ($) => C.chatCast.v1({ scope: $.input.chatScope }))
			// Optional by construction: an install that never opened the
			// narrative graph gets an empty string here and the template's
			// `{{#if}}` skips the block. Its own node rather than a read inside
			// the context Task, because a Task is handed no services (F11) —
			// and because a node is something a user can see on the receipt and
			// remove without editing the context builder.
			.query("relationships", ($) =>
				C.graphContext.v1({ scope: $.input.chatScope })
			)
			.task("context", ($) =>
				C.buildTemplateContext.v1({
					cast: $.cast.cast,
					speakerRelationships: $.relationships.speakerRelationships,
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
