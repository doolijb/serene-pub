/**
 * Running both prompt paths on the same rows and comparing what they'd send.
 *
 * This is the gate on deleting anything (08 §5). Until a corpus of fixtures
 * renders byte-identical on both paths, the pipeline is a second implementation
 * rather than a replacement — and the difference between those two is invisible
 * from inside either one.
 *
 * ## Why the comparison is the *rendered prompt*
 *
 * Not the diagnostics, which are allowed to improve. Not the token counts,
 * which come from a counter the pipeline is free to change. The rendered string
 * is what reaches a model, so it is the only surface where a difference is
 * necessarily a difference the user would experience.
 *
 * ## Why the pipeline side is a **preview**
 *
 * `run(..., { preview: true })` halts at the pre-call substrate with the real
 * payload in the receipt. Comparing against anything else — a re-render, a
 * reconstruction, a "what it would have been" — compares a reimplementation, and
 * a harness that passes on a reimplementation is worse than no harness, because
 * it is evidence pointing the wrong way.
 *
 * ## What a failure here means
 *
 * A divergence is a **finding, not a bug to be fixtured away**. The temptation
 * with a harness like this is to adjust the fixture until it agrees; every time
 * that happens the corpus loses the case it was built to hold. If the two paths
 * differ, either the pipeline is wrong or the legacy behaviour was worth
 * changing on purpose — and the second one needs its own ruling, in writing,
 * before the fixture moves.
 */

import { PromptBuilder } from "$lib/server/utils/promptBuilder"
import { run, compile, spec, slot, checkParity } from "@serene-pub/sdk"
import type { ParityResult } from "@serene-pub/sdk"
import * as C from "@serene-pub/contracts"
import { createHost } from "./host"
import { buildWorld } from "./world"
import { coreBindings } from "./bindings"

export interface FixtureScope {
	chatId: number
	userId: number
	/** Null in narrator mode. */
	currentCharacterId: number | null
	/** The last user message, which is what a turn is triggered by. */
	text: string
	/**
	 * A prompt config this fixture seeded for itself.
	 *
	 * Both sides must read the *same row*, so the harness points the instance
	 * default at it before running rather than handing the legacy builder one
	 * object and letting the pipeline resolve another. Two configs that happen
	 * to agree is not the same test.
	 */
	promptConfigId?: number
	/** A context config this fixture seeded for itself. Same rule as above. */
	contextConfigId?: number
}

/**
 * One case worth holding: rows to write, and the scope to render them at.
 *
 * A fixture seeds a database rather than building an object graph, because both
 * paths have to read the *same* rows — the legacy builder from a hydrated chat,
 * the pipeline through the host. A fixture made of literals would let the two
 * sides disagree about what was in the database and still both be right.
 */
export interface ParityFixture {
	name: string
	seed(db: any): Promise<FixtureScope>
}

/** The hydration the legacy path expects, built from the same rows. */
async function hydrateChat(db: any, chatId: number) {
	const chat = await db.query.chats.findFirst({
		where: (c: any, { eq }: any) => eq(c.id, chatId),
		with: {
			chatCharacters: { with: { character: true } },
			chatPersonas: { with: { persona: true } },
			chatMessages: true,
			lorebook: {
				with: {
					lorebookBindings: true,
					worldLoreEntries: true,
					characterLoreEntries: true,
					historyEntries: true
				}
			}
		}
	})
	if (!chat) throw new Error(`fixture chat ${chatId} was not seeded`)
	return {
		...chat,
		chatCharacters: (chat.chatCharacters ?? []).filter(
			(cc: any) => cc.character !== null
		),
		chatPersonas: (chat.chatPersonas ?? []).filter(
			(cp: any) => cp.persona !== null
		)
	}
}

export interface RenderConfigs {
	connection: any
	sampling: any
	contextConfig: any
	promptConfig: any
}

/**
 * What the legacy path would send.
 *
 * `PromptBuilder` directly rather than through an adapter: the adapter adds
 * mode dispatch and graph context on top, and those are separate behaviours with
 * their own fixtures. This is the prompt construction itself.
 */
export async function legacyRender(
	db: any,
	scope: FixtureScope,
	configs: RenderConfigs
): Promise<string> {
	const builder = new PromptBuilder({
		connection: configs.connection,
		sampling: configs.sampling,
		contextConfig: configs.contextConfig,
		promptConfig: configs.promptConfig,
		chat: (await hydrateChat(db, scope.chatId)) as any,
		currentCharacterId: scope.currentCharacterId,
		tokenCounter: { countTokens: async (t: string) => t.length / 4 } as any,
		tokenLimit: 4096,
		contextThresholdPercent: 0.8
	})
	const compiled = await builder.compilePrompt({})
	return compiled.prompt ?? ""
}

/** The pipeline document the parity corpus renders through. */
export const parityPipeline = () =>
	compile(
		spec("core:spec/parity-respond", { version: "1.0.0" })
			.on("core:event/message-created@1")
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
					// The authored text reaches the *context* node as well as the
					// assembly one. Both need it and neither derives it from the
					// other; the first parity run rendered a blank system prompt
					// because only Assemble had it.
					prompts: slot.prompts()
				})
			)
			// The ranker is not optional decoration between retrieval and
			// assembly: it is what decides which candidates fit the budget.
			// Without it Assemble has candidates and no decisions, and used to
			// render them all away in silence.
			.task("rank", ($) =>
				C.rankHybrid.v1({
					candidates: $.lore.main,
					params: slot.params()
				})
			)
			// Between the rows and the render: who said each line, and the seed
			// the model continues from.
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
					prompts: slot.prompts(),
					// Without this the budget resolves to zero and every block is
					// excluded — the prompt renders with its lore silently gone.
					params: slot.params()
				})
			)
			.provider("generate", ($) =>
				C.generateText.v1({ context: $.prompt.context })
			)
			.build()
	)

/**
 * What the pipeline would send, stopped before it sends it.
 *
 * `preview: true` halts at the Provider with the payload built — so this is the
 * real thing, not a reconstruction of it.
 */
export async function pipelinePreview(db: any, scope: FixtureScope) {
	return await run(parityPipeline(), {
		world: await buildWorld(db, {
			chatId: scope.chatId,
			userId: scope.userId
		}),
		input: {
			text: scope.text,
			// The turn's speaker rides on the chat scope: a scope for a turn is
			// this chat *and* whose turn it is, and the cast query is what turns
			// that into a resolved character.
			chatScope: {
				chatId: scope.chatId,
				currentCharacterId: scope.currentCharacterId
			}
		},
		seed: `parity:${scope.chatId}`,
		triggerSource: "ui",
		preview: true,
		bindings: coreBindings(),
		host: createHost(db, {
			chatId: scope.chatId,
			userId: scope.userId
		})
	})
}

/** Seed a fixture, render it both ways, and compare. */
export async function runFixture(
	db: any,
	fixture: ParityFixture,
	configs: RenderConfigs
): Promise<ParityResult> {
	const scope = await fixture.seed(db)

	// One row, both paths. The instance default is what `buildWorld` resolves,
	// and the same row is handed to the legacy builder.
	// **Every instance default is set on every fixture**, including back to the
	// corpus default when the fixture did not ask for one.
	//
	// Setting them only when a fixture asks leaves the *previous* fixture's
	// choice in place for every fixture after it. That has now caused two
	// separate false divergences — a system prompt nobody chose, then a context
	// template nobody chose — each of which reads exactly like a pipeline bug
	// and is a harness bug. Shared mutable state across fixtures is the failure
	// mode a corpus is most likely to produce; resetting unconditionally is
	// cheap and removes the whole class.
	const { eq } = await import("drizzle-orm")
	const schema = await import("$lib/server/db/schema")

	const promptId = scope.promptConfigId ?? configs.promptConfig.id
	const contextId = scope.contextConfigId ?? configs.contextConfig.id
	await db
		.update(schema.systemSettings)
		.set({
			defaultPromptConfigId: promptId,
			defaultContextConfigId: contextId
		})
		.where(eq(schema.systemSettings.id, 1))

	const [promptRow] = await db
		.select()
		.from(schema.promptConfigs)
		.where(eq(schema.promptConfigs.id, promptId))
		.limit(1)
	const [contextRow] = await db
		.select()
		.from(schema.contextConfigs)
		.where(eq(schema.contextConfigs.id, contextId))
		.limit(1)
	const effective = {
		...configs,
		promptConfig: promptRow,
		contextConfig: contextRow
	}

	const [legacy, preview] = await Promise.all([
		legacyRender(db, scope, effective),
		pipelinePreview(db, scope)
	])
	// A run that stopped early has no preview, and `checkParity`'s message for
	// that case blames the caller for forgetting `preview: true` — which is the
	// wrong place to look when the truth is that a node upstream halted. Say
	// which node, and why, before handing it on.
	if (!(preview as any).preview) {
		const r = preview as any
		throw new Error(
			`fixture '${fixture.name}' never reached the provider: ${r.outcome}` +
				(r.haltNodeKey ? ` at '${r.haltNodeKey}'` : "") +
				(r.haltReason ? ` — ${r.haltReason}` : "")
		)
	}

	return checkParity(fixture.name, legacy, preview, (v) =>
		typeof v === "string" ? Math.ceil(v.length / 4) : 0
	)
}

/**
 * The semantic path: the same prompt, retrieved by embedding rather than by key.
 *
 * Structurally different from `parityPipeline` in one way that matters — the two
 * query windows each run the whole ranking stack and their results are
 * concatenated, because "what is being said now" outranks "what was being said a
 * moment ago" by construction. The arm is one node here (`rank`) that takes both
 * windows; splitting it into two nodes would have made that ordering a property
 * of the spec, where a user could get it backwards.
 */
export const ragParityPipeline = () =>
	compile(
		spec("core:spec/parity-rag", { version: "1.0.0" })
			.on("core:event/message-created@1")
			.input("input", C.userMessage.v1())
			.query("history", ($) =>
				C.chatHistory.v1({ scope: $.input.chatScope })
			)
			.query("cast", ($) => C.chatCast.v1({ scope: $.input.chatScope }))
			.task("context", ($) =>
				C.buildTemplateContext.v1({
					cast: $.cast.cast,
					prompts: slot.prompts()
				})
			)
			.task("queries", ($) =>
				C.queryWindows.v1({
					messages: $.history.messages,
					cast: $.cast.cast,
					params: slot.params()
				})
			)
			// Retrieval lives in a block, and that is not decoration: the debug
			// preview stops at the first Provider **on the spine**, and the
			// embed calls are Providers. With them on the spine the preview
			// halts at `embedCurrent` and shows a payload that is a list of
			// query strings — which is a correct application of the rule and a
			// useless preview. Inside a block they are exactly where the rule
			// expects retrieval to be.
			.async("gather", { mode: "parallel" }, (b) =>
				b
					.chain("current", (c) =>
						c
							.provider("embed", ($) =>
								C.embedText.v1({ texts: $.queries.current })
							)
							.query("search", ($) =>
								C.vectorSearch.v1({
									scope: $.input.chatScope,
									vectors: $.gather.current.embed.vectors
								})
							)
					)
					.chain("recent", (c) =>
						c
							.provider("embed", ($) =>
								C.embedText.v1({ texts: $.queries.recent })
							)
							.query("search", ($) =>
								C.vectorSearch.v1({
									scope: $.input.chatScope,
									vectors: $.gather.recent.embed.vectors
								})
							)
					)
			)
			.task("rank", ($) =>
				C.rankSemantic.v1({
					windows: [
						{
							lists: $.gather.current.search.lists,
							similarity: $.gather.current.search.similarity
						},
						{
							lists: $.gather.recent.search.lists,
							similarity: $.gather.recent.search.similarity
						}
					],
					messages: $.history.messages,
					params: slot.params()
				})
			)
			// Ordering within the arm is `rank`'s job; fitting the result to a
			// budget is `select`'s, and it is the same node the keyword path
			// uses. Two stages rather than one because they answer different
			// questions — "which of these is most relevant" and "which of them
			// fit" — and a plugin replacing one should not have to reimplement
			// the other.
			.task("select", ($) =>
				C.rankHybrid.v1({
					candidates: $.rank.candidates,
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
					candidates: $.select.candidates,
					decisions: $.select.decisions,
					messages: $.lines.messages,
					templateContext: $.context.templateContext,
					template: slot.template(),
					prompts: slot.prompts(),
					params: slot.params()
				})
			)
			.provider("generate", ($) =>
				C.generateText.v1({ context: $.prompt.context })
			)
			.build()
	)
