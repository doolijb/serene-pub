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

import { run, compile, spec, slot, checkParity } from "@serene-pub/sdk"
import type { ParityResult } from "@serene-pub/sdk"
import * as C from "@serene-pub/contracts"
import { createHost } from "$lib/server/pipelines/runtime/host"
import { buildWorld } from "$lib/server/pipelines/config/world"
import { coreBindings } from "$lib/server/pipelines/runtime/bindings"
import { CORE_TEMPLATE_ENGINE } from "$lib/server/pipelines/prompt/renderers"

export interface FixtureScope {
	sessionId: number
	userId: number
	/** Null in narrator mode. */
	currentCharacterId: number | null
	/** The last user message, which is what a turn is triggered by. */
	text: string
	/**
	 * The prompt this fixture renders with, in place of the corpus default —
	 * the words 0.5 read from its prompt config when the golden was captured.
	 */
	prompts?: ParityPrompts
	/**
	 * The story string the *pipeline* renders, when it differs from the legacy
	 * one.
	 *
	 * The one place the two sides are deliberately not handed the same string,
	 * and the exception proves the rule rather than breaking it. What this
	 * corpus asserts is that 0.6's pipeline emits the bytes 0.5 emitted, and the
	 * two releases' templates differ on purpose: 0.5's carried headings and
	 * fences, and 0.6's (`pipeline_context_templates`) has neither because they
	 * moved into the variable layouts. The goldens were rendered through 0.5's.
	 *
	 * Supplied as a literal rather than as a seeded row because
	 * `parityPipeline()` is compiled here and published nowhere — it has no spec
	 * row, so no config layer, so nothing to resolve a reference against. What
	 * the corpus is for is the bytes of the finished prompt; that the reference
	 * resolves is `worldPipelineLayer`'s subject.
	 *
	 * Left unset by a fixture whose two templates are the same string.
	 */
	pipelineTemplate?: string
}

/**
 * One case worth holding: rows to write, and the scope to render them at.
 *
 * A fixture seeds a database rather than building an object graph, because both
 * paths have to read the *same* rows — the legacy builder from a hydrated session,
 * the pipeline through the host. A fixture made of literals would let the two
 * sides disagree about what was in the database and still both be right.
 */
export interface ParityFixture {
	name: string
	seed(db: Db): Promise<FixtureScope>
}

/**
 * A 0.5 prompt config's fields, as the parity pipeline's slots take them: the
 * text on the `context` node's `prompts` slot, the two post-history numbers on
 * the `prompt` (assemble) node's `params`.
 */
export interface ParityPrompts {
	systemPrompt?: string
	postHistoryInstructions?: string
	postHistoryDepth?: number
	postHistoryTokenTrigger?: number
}

export interface RenderConfigs {
	connection: any
	sampling: any
	/** The corpus default prompt, for every fixture that names none. */
	prompts: ParityPrompts
}

/**
 * Layer a fixture's prompt into a parity world at `defaults`.
 *
 * The parity specs are compiled here and published nowhere, so they have no
 * config layer to select a prompt row through; the words go in as values, the
 * same way `pipelinePreview` layers the story string. The post-history numbers
 * are written even when unset, as 0 — what 0.5's columns held by default.
 */
export function layerParityPrompts(
	world: { overrides: unknown[] },
	prompts: ParityPrompts
): void {
	for (const path of ["systemPrompt", "postHistoryInstructions"] as const)
		if (prompts[path] != null)
			world.overrides.push({
				nodeKey: "context",
				slot: "prompts",
				path,
				value: prompts[path],
				scopeKind: "defaults"
			})
	for (const path of ["postHistoryDepth", "postHistoryTokenTrigger"] as const)
		world.overrides.push({
			nodeKey: "prompt",
			slot: "params",
			path,
			value: prompts[path] ?? 0,
			scopeKind: "defaults"
		})
}

/** The pipeline document the parity corpus renders through. */
export const parityPipeline = () =>
	compile(
		spec("core:spec/parity-respond", { version: "1.0.0" })
			.inlet("input", C.userMessage.v1())
			.query("history", ($) =>
				C.sessionHistory.v1({
					scope: $.input.sessionScope,
					params: slot.params()
				})
			)
			/**
			 * The three retrieval gather branches, mirroring the shipped document.
			 *
			 * ⚠ This was one `lorebookTriggers` query long after the shipped
			 * spec had split it, and the divergence hid a real defect for two
			 * versions: the split left `history` with no gather branch, so dated
			 * summaries were dropped from every prompt while this corpus
			 * stayed green — because `lorebook-triggers@1` returns all three
			 * sources through one port and this harness was still using it.
			 *
			 * The comment further down already said a harness that diverges
			 * from the document it is meant to prove stops proving it. It was
			 * right, and it was about the wrong line.
			 *
			 * `params` on all four, as the shipped document wires them (R-7 P2
			 * / P5; U3b review S3): the world-lore lane owns the seven scan
			 * knobs and the other two read that slot through `slot.params({
			 * node })`, while each lane's OWN band intent — `share`,
			 * `maxEntries`, `priority` — resolves at its own address through
			 * the same reference. This harness builds no config world for the
			 * spec, so every field resolves to its declared default — which is
			 * exactly the number the ranker's fallback table holds, and the
			 * corpus stays byte-identical; what changes is that the shipped
			 * wiring is now the wiring the corpus exercises rather than a
			 * shape the ranker happens to default into.
			 */
			.query("worldLore", ($) =>
				C.worldLore.v1({
					scope: $.input.sessionScope,
					params: slot.params()
				})
			)
			.query("characterLore", ($) =>
				C.characterLore.v1({
					scope: $.input.sessionScope,
					params: slot.params({ node: "worldLore" })
				})
			)
			.query("historyEntries", ($) =>
				C.historyEntries.v1({
					scope: $.input.sessionScope,
					params: slot.params({ node: "worldLore" })
				})
			)
			/**
			 * Concatenation, mirroring the shipped document's 1.17.0.
			 *
			 * ⚠ This was `mergeCandidates`, as the shipped spec was, and the
			 * two were wrong together — which is the one way a mirror can fail
			 * to prove anything and still look right. Rank fusion over three
			 * *disjoint* lore gather branches stamps a `presetScore` that is nothing but
			 * each entry's position in its own list, and `select` prefers that
			 * to the weighted signal sum: every signal weight was inert on both
			 * sides of this comparison. `session/entity-cooccurrence` is the
			 * fixture that could see it, and it sat in `OPEN` until this line
			 * changed.
			 *
			 * The conversation's `band` port leads, as in the shipped document
			 * (R-7 P5): `session-history` ranks nothing, but its intent is what
			 * reserves the transcript's half of the window before the lore
			 * divides the rest. The ranker's fallback table holds that same
			 * 0.5, so the corpus is byte-identical with the port wired or
			 * not; wiring it is what makes the corpus exercise the shipped
			 * wiring rather than a shape the fallback happens to match.
			 */
			.task("lore", ($) =>
				C.concatCandidates.v1({
					sources: [
						$.history.band,
						$.worldLore.main,
						$.characterLore.main,
						$.historyEntries.main
					] as any
				})
			)
			.query("cast", ($) =>
				C.sessionCast.v1({ scope: $.input.sessionScope })
			)
			.task("context", ($) =>
				C.buildTemplateContext.v1({
					cast: $.cast.cast,
					// The authored text reaches the *context* node as well as the
					// assembly one. Both need it and neither derives it from the
					// other; the first parity run rendered a blank system prompt
					// because only Assemble had it.
					prompts: slot.prompts(),
					// Mirrors the shipped spec, and is currently **inert**: this
					// harness calls `buildWorld` without a `specId`, so
					// `applyPipelineLayer` never runs and the slot resolves to
					// `{}`. Which means the corpus proves something narrower
					// than it looks — that the *floor* is byte-identical to the
					// legacy path, not that a selected layout renders
					// identically. Measured, not assumed: changing a shipped
					// layout's indent leaves every fixture green.
					//
					// The selected-layout half is gated by
					// `variableTemplates.parity.test.ts` instead. This line stays
					// so the document matches the real one, and so the day this
					// harness starts resolving a spec, the corpus covers layouts
					// without anyone having to remember to add it.
					variables: slot.variables()
				})
			)
			// How much room there is, derived from the window the reply is
			// sent against rather than typed on a node. Mirrored from the
			// shipped spec for the reason stated below about `prompts`: a
			// harness that diverges from the document it is meant to prove
			// stops proving it. When `budget: 4096` was retired from the two
			// nodes that carried it, this step is what replaced it — and
			// without it here the corpus went red with the lore silently gone,
			// which is exactly the failure the comment below predicted.
			.task("contextBudget", ($) =>
				C.contextBudget.v1({
					sampling: slot.samplingOf("generate"),
					params: slot.params()
				})
			)
			// The ranker is not optional decoration between retrieval and
			// assembly: it is what decides which candidates fit the budget.
			// Without it Assemble has candidates and no decisions, and used to
			// render them all away in silence.
			.task("rank", ($) =>
				C.rankHybrid.v1({
					candidates: $.lore.candidates,
					budget: $.contextBudget.available,
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
					budget: $.contextBudget.available,
					messages: $.lines.messages,
					templateContext: $.context.templateContext,
					template: slot.template(),
					// **By reference**, exactly as the shipped specs do since
					// 1.1.0 — one authored prompt, owned by the context node,
					// read here rather than declared again (13 §12 finding i).
					// The bare `slot.prompts()` this replaced addressed *this*
					// node's own slot, which `world.ts` has not written since
					// the double-write was retired: it resolved to `{}` and the
					// corpus stayed green because the shipped template takes
					// its text from the template context. A harness that
					// diverges from the document it is meant to mirror is a
					// harness that stops proving what it claims.
					prompts: slot.prompts({ node: "context" }),
					// Assemble's own layouts — the lore and history it
					// produced, laid out post-budget. Its own slot, not the
					// context builder's: what fits is only known here.
					variables: slot.variables(),
					// Without this the budget resolves to zero and every block is
					// excluded — the prompt renders with its lore silently gone.
					params: slot.params(),
					// The wire format, shared with the node that sends — the
					// shipped specs' construction, mirrored here for the reason
					// stated above `prompts`: a harness that diverges from the
					// document it is meant to prove stops proving it.
					//
					// ⚠ The corpus registers **no connection at all**, so this
					// resolves to `null` and the render falls to Vicuna — which
					// is exactly what it did when the slot did not exist. The
					// goldens therefore do not move, and this line does not by
					// itself prove the wiring works: `promptFormat.int.test.ts`
					// is where a real non-Vicuna connection is bound and the
					// rendered bytes are checked. This is here so the document
					// the corpus renders through keeps matching the one it is
					// meant to prove.
					connection: slot.connectionOf("generate")
				})
			)
			.oracle("generate", ($) =>
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
export async function pipelinePreview(
	db: Db,
	scope: FixtureScope,
	prompts: ParityPrompts
) {
	const world = await buildWorld(db, {
		sessionId: scope.sessionId
	})
	layerParityPrompts(world, scope.prompts ?? prompts)

	// Layered here rather than projected by `buildWorld`: the story string is a
	// `pipeline_context_templates` reference resolved through the config layer,
	// and this ad-hoc spec has no config layer to resolve it through. At
	// `defaults`, so a fixture that writes its own override still wins.
	//
	// **`source` and `engine` together, never one alone** — the same rule
	// `world.ts`'s `pushTemplate` enforces on the real path. A source with no
	// engine used to be renderable because `renderTemplate` filled the gap with
	// core's engine; it refuses now, because that fallback is what let every
	// template on every install render as Handlebars whatever it declared. The
	// corpus is Handlebars, and here it says so.
	if (scope.pipelineTemplate !== undefined) {
		world.overrides.push({
			nodeKey: "prompt",
			slot: "template",
			path: "source",
			value: scope.pipelineTemplate,
			scopeKind: "defaults"
		} as any)
		world.overrides.push({
			nodeKey: "prompt",
			slot: "template",
			path: "engine",
			value: CORE_TEMPLATE_ENGINE,
			scopeKind: "defaults"
		} as any)
	}

	return await run(parityPipeline(), {
		world,
		input: {
			text: scope.text,
			// The turn's speaker rides on the session scope: a scope for a turn is
			// this session *and* whose turn it is, and the cast query is what turns
			// that into a resolved character.
			sessionScope: {
				sessionId: scope.sessionId,
				currentCharacterId: scope.currentCharacterId
			}
		},
		seed: `parity:${scope.sessionId}`,
		triggerSource: "ui",
		preview: true,
		bindings: coreBindings(),
		host: createHost(db, {
			sessionId: scope.sessionId,
			userId: scope.userId
		})
	})
}

/** Seed a fixture, render it both ways, and compare. */

/** One file per fixture; `session/one-on-one` becomes `session__one-on-one.txt`. */
export const goldenPathFor = (name: string): string =>
	`src/lib/server/pipelines/parity/goldens/${name.replace(/\//g, "__")}.txt`

/**
 * The frozen 0.5 render for a fixture.
 *
 * Read-only now: the builder that produced these is deleted, which is precisely
 * why they were frozen first. A missing golden is an error rather than a silent
 * fallback — a fixture without one would otherwise pass by comparing the
 * pipeline against itself.
 */
async function resolveGolden(fixture: ParityFixture): Promise<string> {
	const { readFileSync, existsSync } = await import("node:fs")
	const path = goldenPathFor(fixture.name)

	if (!existsSync(path))
		throw new Error(
			`fixture '${fixture.name}' has no frozen 0.5 golden at ${path}. ` +
				`The legacy builder that produced these is deleted, so a new one ` +
				`has to be captured from a v0.5.1-beta checkout — a golden is a ` +
				`record of what 0.5 did, not a snapshot to regenerate.`
		)
	return readFileSync(path, "utf8")
}

export async function runFixture(
	db: Db,
	fixture: ParityFixture,
	configs: RenderConfigs
): Promise<ParityResult> {
	const scope = await fixture.seed(db)

	// The legacy side is a **frozen golden**, not a live render.
	//
	// The corpus compares the pipeline against 0.5. Until now it produced the
	// 0.5 side by running `PromptBuilder` — which meant the gate on deleting
	// the legacy path depended on the legacy path still existing, and would
	// have been deleted along with the thing it was guarding.
	//
	// Freezing it inverts that: the goldens *are* 0.5's output, captured while
	// the builder was still here, and they keep gating every future change to
	// the pipeline long after it is gone. It also removes the last way for the
	// two sides to move together and agree for the wrong reason, which this
	// harness has done twice (a template both sides read, a hydration both
	// sides lacked).
	//
	// ⚠ **There is no re-capture path, and there must not be one.** This said
	// "re-capture with PARITY_CAPTURE=1" long after the switch was removed:
	// `resolveGolden` only ever reads or throws, and the 0.5 builder that
	// produced these was deleted at 7320c4a. A golden is a record of what 0.5
	// emitted, so the only way to make a new one is a v0.5.1-beta checkout —
	// which is the point, since anything regenerated from this tree would be
	// the pipeline grading its own homework.
	const [legacy, preview] = await Promise.all([
		resolveGolden(fixture),
		pipelinePreview(db, scope, configs.prompts)
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
 * moment ago" by construction. The mechanism is one node here (`rank`) that takes both
 * windows; splitting it into two nodes would have made that ordering a property
 * of the spec, where a user could get it backwards.
 */
export const ragParityPipeline = () =>
	compile(
		spec("core:spec/parity-rag", { version: "1.0.0" })
			.inlet("input", C.userMessage.v1())
			.query("history", ($) =>
				C.sessionHistory.v1({
					scope: $.input.sessionScope,
					params: slot.params()
				})
			)
			.query("cast", ($) =>
				C.sessionCast.v1({ scope: $.input.sessionScope })
			)
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
			.gather("gather", { mode: "parallel" }, (b) =>
				b
					.chain("current", (c) =>
						c
							.oracle("embed", ($) =>
								C.embedText.v1({ texts: $.queries.current })
							)
							.query("search", ($) =>
								C.vectorSearch.v1({
									scope: $.input.sessionScope,
									vectors: $.gather.current.embed
										.vectors,
									// ⚠ Wired, and it was not. The mechanism's cap
									// (`maxEntries`) ships at 5, so a node whose
									// params slot never resolves would run this
									// corpus truncated to five. The 1.16.0
									// lesson, on the one spec where it would
									// have shown as short prompts rather than an
									// error. The fixture pushes a cap high
									// enough not to truncate, and turns the
									// mechanism on at its switch,
									// `queries.searchByMeaning` (Automatic by
									// default, which searches nothing here: this
									// spec wires no connection to `queries`);
									// see `harness.rag.int.test`.
									params: slot.params()
								})
							)
					)
					.chain("recent", (c) =>
						c
							.oracle("embed", ($) =>
								C.embedText.v1({ texts: $.queries.recent })
							)
							.query("search", ($) =>
								C.vectorSearch.v1({
									scope: $.input.sessionScope,
									vectors: $.gather.recent.embed.vectors,
									params: slot.params()
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
			// Ordering within the mechanism is `rank`'s job; fitting the result to a
			// budget is `select`'s, and it is the same node the keyword path
			// uses. Two steps rather than one because they answer different
			// questions — "which of these is most relevant" and "which of them
			// fit" — and a plugin replacing one should not have to reimplement
			// the other.
			// Same derivation as the keyword harness and the shipped spec: the
			// room available comes from the window the reply is sent against.
			.task("contextBudget", ($) =>
				C.contextBudget.v1({
					sampling: slot.samplingOf("generate"),
					params: slot.params()
				})
			)
			// The conversation's band intent, ahead of the semantic
			// mechanism's candidates, mirroring the keyword harness's
			// `lore` task: `session-history` ranks nothing here either,
			// but its intent is what reserves the transcript's slice of
			// the window before `select` divides the rest. `DEFAULT_GROUPS`
			// holds the same 0.5 share the intent declares, so the corpus
			// stays byte-identical with the port wired or not; wiring it
			// is what makes the corpus exercise the shipped wiring rather
			// than a shape the fallback happens to match.
			.task("pool", ($) =>
				C.concatCandidates.v1({
					sources: [$.history.band, $.rank.candidates] as any
				})
			)
			.task("select", ($) =>
				C.rankHybrid.v1({
					candidates: $.pool.candidates,
					budget: $.contextBudget.available,
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
					budget: $.contextBudget.available,
					messages: $.lines.messages,
					templateContext: $.context.templateContext,
					template: slot.template(),
					// **By reference**, exactly as the shipped specs do since
					// 1.1.0 — one authored prompt, owned by the context node,
					// read here rather than declared again (13 §12 finding i).
					// The bare `slot.prompts()` this replaced addressed *this*
					// node's own slot, which `world.ts` has not written since
					// the double-write was retired: it resolved to `{}` and the
					// corpus stayed green because the shipped template takes
					// its text from the template context. A harness that
					// diverges from the document it is meant to mirror is a
					// harness that stops proving what it claims.
					prompts: slot.prompts({ node: "context" }),
					// Assemble's own layouts — the lore and history it
					// produced, laid out post-budget. Its own slot, not the
					// context builder's: what fits is only known here.
					variables: slot.variables(),
					params: slot.params()
				})
			)
			.oracle("generate", ($) =>
				C.generateText.v1({ context: $.prompt.context })
			)
			.build()
	)
