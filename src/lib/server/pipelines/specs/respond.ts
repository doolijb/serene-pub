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
// 1.5.0: `narratorName` leaves this pipeline's prompts slot. It was declared on
// the shared context-builder type and read only when there is no speaking
// character — which never happens here — so all twelve shipped reply prompts
// carried an empty box. `0114` strips the key from rows already written.
// 1.6.0 — the ranker stopped carrying an absolute token budget.
//
// `rank` used to be handed `budget: 4096` as a parameter, because nothing
// supplied its `budget` in-port; an absolute count on a node cannot know which
// model it is about to be sent to, so it was free to disagree with the window
// and warn nobody. A `contextBudget` step now derives the number from the
// sampling config the reply is generated against, and `rank` divides *that* by
// the configurable share. A new version because the wiring changed.
// 1.7.0: the four reads move into an `async` block and run together. They were
// sequential only because unblocked nodes are, never because the data required
// it — all four take `input.chatScope` and none reads another's output, and
// `graphContext` alone makes three round trips.
//
// They stay four distinct nodes. Concurrency is how they run, not a reason to
// collapse them into one box fetching four unrelated things.
//
// The keys inside a block are qualified, so `history` becomes
// `gather.history.read`. `reconcileConfigs` culls values at the old addresses
// and records a notice carrying what each one was.
// 1.8.0: world lore and character lore are separate queries, merged before
// ranking. One query returning both meant one weight, one floor and one share
// for two things that are not alike — character lore is bound to whoever is
// speaking and world lore is not, so "more world, less character" could not be
// said. Retrieval is unchanged: candidates already carried which source they
// came from, so each node is the same scan with one filter.
// 1.9.0: the narrative graph splits into two nodes and two variables —
// `relationshipsPerspectives` (how the speaker regards everyone) and
// `relationshipsKnown` (how everyone regards them, plus the figures the world
// knows of). One node emitted all three sections through one port under one
// "Your relationships:" heading, so opposite claims arrived as one list and
// they shared a layout, a priority and an on/off switch.
//
// ⚠ This is the first deliberate departure from 0.5's prompt bytes. Everything
// before it moved wrappers around without changing them;
// `contextTemplateWrappers.test.ts` records the exception and why.
// 1.10.0: history entries get a lane. ⚠ A **regression fix**: 1.8.0 replaced
// the one lore query with two that each filter the shared scan to their own
// source, and nothing filtered for `history` — so from 1.8.0 until now, dated
// history summaries were retrieved, scored and then dropped, while the ranker
// kept a `history` band and `assemble` kept asking for history blocks. No test
// caught it, because the parity corpus renders through `lorebook-triggers@1`
// rather than through this document. The corpus mirrors the three lanes now.
export const RESPOND_VERSION = "1.10.0"

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
			/**
			 * The four reads, run together.
			 *
			 * Every one of them takes `input.chatScope` and none consumes
			 * another's output, so nothing about the data required them to
			 * happen in turn — but unblocked nodes execute sequentially, so a
			 * turn waited for all four in series. `graphContext` alone makes
			 * three round trips.
			 *
			 * They stay four distinct nodes. Concurrency is a property of how
			 * they run, not a reason to collapse them into one box that fetches
			 * four unrelated things — the editor should be able to draw the
			 * pipeline's real shape.
			 *
			 * `mode` is the author's default here and the administrator's
			 * decision at runtime: four overlapping reads suit a local database
			 * and may not suit a rate-limited remote one, and the person who
			 * knows which is not the person who wrote this.
			 */
			.async("gather", { mode: "parallel" }, (b) =>
				b
					.chain("history", (c) =>
						c.query("read", ($) =>
							C.chatHistory.v1({ scope: $.input.chatScope })
						)
					)
					// Two lore lanes, not one. World lore and character lore
					// were a single query sharing a weight, a floor and a
					// share of the window, which left "more world, less
					// character" unsayable.
					.chain("worldLore", (c) =>
						c.query("read", ($) =>
							C.worldLore.v1({ scope: $.input.chatScope })
						)
					)
					.chain("characterLore", (c) =>
						c.query("read", ($) =>
							C.characterLore.v1({
								scope: $.input.chatScope
							})
						)
					)
					// The third lane. It was missing from 1.8.0 to 1.10.0 and
					// history was absent from every prompt in that window —
					// see `core:query/history-entries@1` for how a split into
					// two lanes dropped a third source without failing.
					.chain("historyEntries", (c) =>
						c.query("read", ($) =>
							C.historyEntries.v1({
								scope: $.input.chatScope
							})
						)
					)
					.chain("cast", (c) =>
						c.query("read", ($) =>
							C.chatCast.v1({ scope: $.input.chatScope })
						)
					)
					// Optional by construction: an install that never opened
					// the narrative graph gets an empty string here and the
					// template's `{{#if}}` skips the block. Its own node rather
					// than a read inside the context Task, because a Task is
					// handed no services (F11) — and because a node is
					// something a user can see on the receipt and remove
					// without editing the context builder.
					// Two lanes, as with lore, and for the same reason. One
					// node emitted both directions of the graph under a single
					// heading — what the speaker thinks of everyone, and what
					// everyone thinks of the speaker — which a model reads as
					// one list and a user cannot separate.
					.chain("relationshipsPerspectives", (c) =>
						c.query("read", ($) =>
							C.relationshipsPerspectives.v1({
								scope: $.input.chatScope
							})
						)
					)
					.chain("relationshipsKnown", (c) =>
						c.query("read", ($) =>
							C.relationshipsKnown.v1({
								scope: $.input.chatScope
							})
						)
					)
			)
			.task("context", ($) =>
				C.buildTemplateContext.v1({
					cast: $.gather.cast.read.cast,
					relationshipsPerspectives:
						$.gather.relationshipsPerspectives.read
							.relationshipsPerspectives,
					relationshipsKnown:
						$.gather.relationshipsKnown.read.relationshipsKnown,
					prompts: slot.prompts(),
					variables: slot.variables()
				})
			)
			/**
			 * How much room the context has, from the window itself.
			 *
			 * `samplingOf("generate")` rather than its own slot, and that is
			 * the whole safety of this step: a budget computed against one
			 * window and a prompt sent against another is wrong in the
			 * direction that truncates, silently. Sharing the reference makes
			 * the two impossible to point apart, rather than documenting that
			 * they must agree and hoping.
			 */
			.task("contextBudget", ($) =>
				C.contextBudget.v1({
					sampling: slot.samplingOf("generate"),
					params: slot.params()
				})
			)
			// All three lanes reach the ranker, and the count is the point.
			// Wiring `rank` to a subset drops the rest silently — the prompt
			// simply has no character lore, or no history, in it, and nothing
			// anywhere says so. That is not hypothetical: history was left out
			// of this list from 1.8.0 to 1.10.0 and every prompt lost it.
			.task("lore", ($) =>
				C.mergeCandidates.v1({
					sources: [
						$.gather.worldLore.read.main,
						$.gather.characterLore.read.main,
						$.gather.historyEntries.read.main
					] as any
				})
			)
			.task("rank", ($) =>
				C.rankHybrid.v1({
					candidates: $.lore.candidates,
					budget: $.contextBudget.available,
					params: slot.params()
				})
			)
			.task("lines", ($) =>
				C.processMessages.v1({
					messages: $.gather.history.read.messages,
					cast: $.gather.cast.read.cast,
					templateContext: $.context.templateContext,
					seedName: $.context.seedName
				})
			)
			.task("prompt", ($) =>
				C.assemble.v2({
					candidates: $.rank.candidates,
					decisions: $.rank.decisions,
					budget: $.contextBudget.available,
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
