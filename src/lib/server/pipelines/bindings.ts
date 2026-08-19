/**
 * Core's bindings — one per node type (U5).
 *
 * Each is a **wrapper around code that already exists**, not a rewrite. That is
 * the whole shape of step 3 in packages/INTEGRATING.md: the pipeline path runs
 * the same retrieval, the same prompt builder and the same adapters that the
 * current path does, so a difference in output is a bug in the wiring rather
 * than a difference in behaviour nobody can locate.
 *
 * A binding does no I/O of its own. It reads through `ctx.read` and describes
 * writes through `ctx.commit`, both of which land in `host.ts` — see the note
 * there for why the effect belongs to the substrate rather than to the handler.
 *
 * Types with no binding yet **halt with a reason** rather than being absent.
 * A missing binding is an `err` that reads like a crash; a halt says "this part
 * is not built yet" in the run inspector, which is the truth during a migration
 * that will run for two releases.
 */

import type { Bindings } from "@serene-pub/sdk"
import { ok, halt, roughTokens } from "@serene-pub/sdk"
import { keywordQuery, normaliseTfidf } from "./ranking/keywordQuery"
import { eligibleFor, armNote, fuseRanks } from "./ranking/strategy"
import { select } from "./ranking/select"
import { rankSemantic, mergeWindows } from "./ranking/semantic"
import { queryWindows } from "$lib/server/utils/promptBuilder/ragQuery"
import { PRIORITY_SCORE_BONUS } from "$lib/server/utils/promptBuilder/KeywordInfillEngine"
import { withDefaults } from "./ranking/weights"
import { allocate, render } from "./assemble"
import { resolveContextInput } from "./promptFields"
import { processMessages } from "./messages"
import { buildTemplateContext } from "./templateContext"

/** Not built yet, and saying so plainly beats failing like a bug. */
const notYet = (what: string, where: string) => async () =>
	halt(`${what} is not bound yet — ${where}`)

export function coreBindings(): Bindings {
	return {
		// ── Inputs ──────────────────────────────────────────────────────────
		// An Input node does not fetch; it names what the trigger already
		// carried. Core hands the trigger payload in as the run's input, so the
		// binding is the identity — and that is not a placeholder, it is what an
		// Input *is* (01 §2).
		"core:input/user-message@1": async (input: any) => ok(input),
		"core:input/message-created@1": async (input: any) => ok(input),

		// ── Queries ─────────────────────────────────────────────────────────
		"core:query/chat-history@1": async (input: any, ctx: any) => {
			const messages = await ctx.read("chat_messages", {
				chatId: input?.scope?.chatId,
				limit: input?.limit ?? 100
			})
			// `main` and `messages` carry the same value on purpose: `main` is what
			// an unrefined `$.history` resolves to, and having it be the useful
			// thing rather than a wrapper is what makes the scope sugar read well.
			return ok({ main: messages, messages })
		},

		/**
		 * The keyword arm. Reads rows, matches strings, reaches no network
		 * (16 §1) — vector similarity is the other arm's job.
		 *
		 * `hits` carries the candidates and `skipped` carries what this arm
		 * declined *and why*. The second is not diagnostics decoration: today a
		 * disabled entry, an entry set to `rag`, and an entry whose keys simply
		 * did not match all present identically as absent lore, which is three
		 * user problems wearing one symptom.
		 */
		"core:query/lorebook-triggers@1": async (input: any, ctx: any) => {
			const params = withDefaults(input?.params ?? {})
			const [entries, messages, embedding] = await Promise.all([
				ctx.read("lorebook_entries", { chatId: input?.scope?.chatId }),
				ctx.read("chat_messages", {
					chatId: input?.scope?.chatId,
					limit: input?.limit ?? 100
				}),
				ctx.read("embedding_status", {})
			])

			const result = keywordQuery({
				entries: entries ?? [],
				messages: messages ?? [],
				entityNames: input?.entityNames ?? [],
				retrieval: params.retrieval,
				availability: {
					// Read from the instance rather than assumed, because it
					// decides whether a `rag` entry falls back to keyword — and
					// getting that silently wrong presents as a lorebook problem
					// and sends the user to the wrong screen.
					vectorSearchAvailable: embedding?.available ?? false
				},
				countTokens: (text: string) => roughTokens(text)
			})

			const candidates = normaliseTfidf(result.candidates)
			return ok({
				main: candidates,
				hits: candidates,
				skipped: result.skipped,
				diagnostics: {
					...result.diagnostics,
					// Named in the result so "why did RAG not run" is answerable
					// from the receipt rather than from the embedding settings
					// screen.
					vectorSearch: embedding?.available
						? `available (${embedding.model})`
						: (embedding?.reason ?? "unavailable")
				}
			})
		},

		/**
		 * The vector arm.
		 *
		 * Takes a query vector — produced by the embed Provider, because a Query
		 * may not reach a model (16 §1) — and asks the host for semantically
		 * near candidates. Cosine ranking happens host-side so candidate vectors
		 * never travel along a data edge; what arrives here is an id, a score and
		 * the text.
		 */
		"core:query/vector-search@1": async (input: any, ctx: any) => {
			const embedding = await ctx.read("embedding_status", {})
			if (!embedding?.available)
				return ok({
					main: [],
					lists: [],
					hits: [],
					similarity: [],
					skipped: [],
					diagnostics: {
						vectorSearch: embedding?.reason ?? "unavailable"
					}
				})

			const [entries, result] = await Promise.all([
				ctx.read("lorebook_entries", { chatId: input?.scope?.chatId }),
				ctx.read("vector_search", {
					chatId: input?.scope?.chatId,
					// Several query vectors: the current window and the recent
					// one are different questions, and one blended embedding
					// answers neither.
					vectors:
						input?.vectors ?? (input?.vector ? [input.vector] : []),
					sources: input?.sources,
					topK: input?.topK ?? 40
				})
			])

			// Strategy is a property of the entry, so eligibility is applied to
			// what came back rather than pushed into the query — the host does
			// retrieval, not policy.
			const bySource = new Map(
				(entries ?? []).map((e: any) => [`${e.source}:${e.id}`, e])
			)
			const skipped: any[] = []
			const excluded = new Set<string>()
			const isEligible = (hit: any) => {
				const key = `${hit.source}:${hit.id}`
				if (excluded.has(key)) return false
				const entry: any = bySource.get(key)
				// A hit with no matching lore row is a message or a graph node,
				// which has no strategy to honour and is always eligible.
				if (
					entry &&
					!eligibleFor(entry, "vector", {
						vectorSearchAvailable: true
					})
				) {
					excluded.add(key)
					skipped.push({
						id: hit.id,
						source: hit.source,
						reason: armNote(entry, "vector", {
							vectorSearchAvailable: true
						}).replace(
							"matched by vector",
							"handled by the keyword scan"
						)
					})
					return false
				}
				return true
			}

			const toCandidate = (hit: any) => ({
				id: hit.id,
				source: hit.source,
				tokens: roughTokens(hit.content ?? ""),
				signals: {},
				// Kept for the merge's ordering, not for the weighted sum: a
				// cosine score and a keyword score are not on one scale.
				presetScore: hit.score,
				priority: hit.priority ?? 1,
				payload: hit
			})

			// One ranked list per query vector, each filtered independently so a
			// per-list rank means what the fusion thinks it means.
			const lists = (result?.lists ?? []).map((list: any[]) =>
				list.filter(isEligible).map(toCandidate)
			)
			// The matrix arrives indexed against the *unfiltered* fused set, and
			// eligibility has just removed rows from under it. Project it onto
			// the survivors here rather than passing both on and hoping the
			// consumer lines them up — an off-by-one in a similarity matrix
			// diversifies against the wrong candidates, silently, and only when
			// something was filtered.
			const fusedAll = result?.candidates ?? []
			const keptIndices: number[] = []
			const fusedOrder = fusedAll.filter((hit: any, index: number) => {
				if (!isEligible(hit)) return false
				keptIndices.push(index)
				return true
			})
			const flat = fusedOrder.map(toCandidate)
			const matrix: number[][] = keptIndices.map((r) =>
				keptIndices.map((c) => result?.similarity?.[r]?.[c] ?? 0)
			)

			return ok({
				main: flat,
				hits: flat,
				lists,
				// Indexed against `hits`, by construction rather than by
				// convention: the projection above is what makes that true.
				similarity: matrix,
				skipped,
				diagnostics: {
					vectorSearch: `available (${embedding.model})`,
					queries: lists.length,
					considered: (result?.candidates ?? []).length,
					matched: flat.length
				}
			})
		},

		/**
		 * Who is in the chat, and the config they speak under.
		 *
		 * A Query because it reads rows, and one Query rather than three because
		 * the cast is only useful assembled: a character row without its
		 * `chatCharacters` join carries no visibility, and visibility is what
		 * decides whether that character appears in the prompt at all.
		 *
		 * It decides nothing. Which of these rows are shown, named or minimal is
		 * the context Task's business.
		 */
		"core:query/chat-cast@1": async (input: any, ctx: any) => {
			const cast = await ctx.read("chat_cast", {
				chatId: input?.scope?.chatId
			})
			if (!cast)
				return halt(
					"there is no chat to build a prompt for — the run is scoped to a " +
						"chat that no longer exists"
				)
			// Whose turn it is travels *with* the cast rather than separately.
			// It is one fact about the chat — who is in it and who is speaking —
			// and splitting it left the context Task unable to resolve the
			// speaker at all, which the first parity run showed as a missing
			// scenario and no post-history text.
			const withSpeaker = {
				...cast,
				currentCharacterId:
					input?.scope?.currentCharacterId ??
					input?.currentCharacterId ??
					null
			}
			return ok({ main: withSpeaker, cast: withSpeaker })
		},

		// ── Tasks ───────────────────────────────────────────────────────────
		/**
		 * Fuse the two arms into one ordering.
		 *
		 * Reciprocal-rank fusion, **not an average**: keyword scores are a
		 * weighted sum in roughly [0, 1.5] and vector scores are cosine in
		 * [-1, 1], so averaging would hand every turn to whichever arm happened
		 * to be more generous — and nobody could tell which (DECOMPOSITION §4).
		 *
		 * An entry both arms found outranks one either found alone, which is what
		 * `both` is asking for: agreement between independent signals is evidence.
		 */
		"core:task/merge-candidates@1": async (input: any) => {
			const orderings: any[][] = (input?.sources ?? []).filter(
				Array.isArray
			)
			const fused = fuseRanks(
				orderings.map((list) =>
					list.map((c: any) => ({ ...c, id: c.id, source: c.source }))
				)
			)

			const candidates = fused.map((f) => ({
				...(f.item as any),
				presetScore: f.score,
				payload: {
					...((f.item as any).payload ?? {}),
					foundBy: f.ranks
						.map((rank, arm) =>
							rank === undefined ? null : `arm${arm}#${rank + 1}`
						)
						.filter(Boolean)
				}
			}))

			return ok({ main: candidates, candidates })
		},

		/**
		 * The strings the retrieval queries are embedded from.
		 *
		 * Pure. Reuses `formatMessageForQuery` rather than reimplementing it —
		 * two formattings of a query are two different sets of results with no
		 * way to tell which is which, and the speaker fallback reaches through
		 * participants who have left the chat.
		 */
		"core:task/query-windows@1": async (input: any) => {
			const params = withDefaults({ semantic: input?.params ?? {} })
			const windows = queryWindows(
				input?.messages ?? [],
				input?.cast ?? {},
				params.semantic
			)
			return ok({ main: windows, ...windows })
		},

		/**
		 * The semantic arm's nine stages.
		 *
		 * Pure, and separate from `rank-hybrid` on purpose: this ranks *within* the
		 * vector arm — fusing its per-query lists, diversifying, capping each
		 * source — and hands one ordered list on. Combining the arms is the
		 * merge's job, and selecting against a budget is the hybrid ranker's.
		 * Doing all three in one node would make each of them unswappable.
		 */
		"core:task/rank-semantic@1": async (input: any) => {
			const params = withDefaults({ semantic: input?.params ?? {} })
			const messageOrder = (input?.messages ?? []).map((m: any) => m.id)

			// One run of the whole stack **per window**, then concatenated —
			// not one fusion across both. The windows are ranked against each
			// other by construction (now beats a moment ago) and each has
			// already been thresholded against its own top result, so their
			// scores are not on a shared scale. See `mergeWindows`.
			const windows: Array<{ lists: any[]; similarity?: any }> =
				input?.windows ?? [
					{ lists: input?.lists ?? [], similarity: input?.similarity }
				]

			const ranked = windows.map((w) =>
				rankSemantic({
					lists: w.lists ?? [],
					similarity: w.similarity,
					messageOrder,
					params: params.semantic,
					// The same per-tier bonus the keyword arm applies, so an
					// author's High tier means one thing across both modes.
					priorityBonus: PRIORITY_SCORE_BONUS
				})
			)

			const candidates = mergeWindows(ranked.map((r) => r.candidates))
			return ok({
				main: candidates,
				candidates,
				diagnostics: {
					windows: ranked.map((r) => r.diagnostics),
					kept: candidates.length
				}
			})
		},

		/**
		 * Rank and select, with the weights as config.
		 *
		 * Pure: everything it needs arrived on its input ports, which is what
		 * lets a user swap the ranker for a plugin's without the retrieval
		 * changing underneath them (16 §5c).
		 */
		"core:task/rank-hybrid@1": async (input: any) => {
			const params = withDefaults(input?.params ?? {})
			const candidates = normaliseTfidf(input?.candidates ?? [])
			const selection = select(candidates, {
				availableTokens:
					input?.budget?.remaining ??
					input?.availableTokens ??
					input?.params?.budget ??
					0,
				params
			})

			return ok({
				main: selection.included.map((d) => d.candidate),
				candidates: selection.included.map((d) => d.candidate),
				// The `why` trail travels with the result rather than being
				// recomputed for the panel — the numbers that produced each
				// decision exist here and nowhere else once the loop has moved on
				// (16 §7c).
				//
				// Published whole, candidate included, rather than flattened to
				// id/score/reason. The flattened version read better in a receipt
				// and was unusable: Assemble allocates *from* these, and a
				// decision without its candidate has no content to put in a
				// block. The parity run found it as a crash, which was lucky —
				// one field further and it would have rendered empty instead.
				decisions: [...selection.included, ...selection.excluded],
				groups: selection.groups
			})
		},

		/**
		 * Build the object a context template renders against.
		 *
		 * Pure — and it took a failing end-to-end run to make it so. The first
		 * version read the cast itself and died on `ctx.read is not a function`,
		 * because a Task is handed no services (F11) and the executor enforces it.
		 * That was the ledger catching a decomposition mistake, not an obstacle:
		 * the read is a read and belongs in `core:query/chat-cast@1`, and what is
		 * left here is the part anyone should be able to replace — which characters
		 * appear, which get named, which scenario wins.
		 *
		 * The example-dialogue pick comes from `ctx.random`, the run-seeded RNG the
		 * SDK supplies to a type that declares randomness. The legacy builder calls
		 * `Math.random()` mid-compile, so the same turn compiled twice produces two
		 * different prompts and the receipt cannot say which examples went in. Same
		 * variety across turns, same answer twice within one.
		 */
		"core:task/build-template-context@1": async (input: any, ctx: any) => {
			const cast = input?.cast ?? input?.main
			if (!cast)
				return halt(
					"there is no cast to build a prompt context from — the chat query " +
						"returned nothing, which usually means the chat was deleted mid-run"
				)

			const random: () => number = ctx?.random ?? (() => 0)
			const resolved = resolveContextInput({
				...cast,
				// The `prompts` slot, resolved through the scope chain by
				// `buildWorld`. Called `promptConfig` downstream because that is what
				// the field-selection rules take — the slot is where it came from,
				// not what it is.
				promptConfig: input?.prompts ?? input?.promptConfig ?? {},
				currentCharacterId:
					input?.currentCharacterId ??
					cast.currentCharacterId ??
					null,
				narratorName:
					input?.narratorName ?? input?.prompts?.narratorName,
				speakerRelationships: input?.speakerRelationships,
				characterLore: input?.characterLore,
				chat: cast,
				pickExample: (n: number) => Math.floor(random() * n)
			})

			const templateContext = buildTemplateContext(resolved)
			return ok({
				main: templateContext,
				templateContext,
				// Travels alongside the context rather than inside it: it is not
				// a template variable, it is the name on the line the model
				// continues from.
				seedName: resolved.seedName,
				// Reported so the receipt can answer "why did this prompt differ
				// from that one" without re-running anything.
				exampleDialogueIndex: resolved.exampleDialogueIndex
			})
		},

		/**
		 * Name and interpolate the conversation, and add the seed.
		 *
		 * Pure, and it reuses `ChatMessageProcessor` rather than reimplementing it
		 * — the name-resolution chain reaches through removed participants to a
		 * name snapshotted at removal time, and a second version of that agrees on
		 * every chat until someone leaves one.
		 */
		"core:task/process-messages@1": async (input: any) => {
			const ctxValue = input?.templateContext ?? {}
			const result = processMessages({
				messages: input?.messages ?? [],
				cast: input?.cast ?? {},
				charName: ctxValue.char ?? "",
				personaName: ctxValue.user ?? "",
				seedName: input?.seedName ?? ctxValue.seedName,
				continuationPrefill: input?.continuationPrefill
			})
			return ok({
				main: result.messages,
				messages: result.messages,
				includedIds: result.includedIds
			})
		},

		/**
		 * Allocate and render.
		 *
		 * Pure, and rendering happens through core's own Handlebars — the same
		 * construction the legacy path uses — so a template behaves identically
		 * on both paths by construction rather than by review (assemble.ts).
		 *
		 * The context it renders against now arrives on a port, from
		 * `core:task/build-template-context@1` — so nothing on this path needs a
		 * `PromptBuilder`. What is still missing before it can replace the legacy
		 * path is the generation Provider and a corpus proving the two paths
		 * render the same bytes; rendering itself is no longer the gap.
		 */
		"core:task/assemble@2": async (input: any) => {
			const template = String(
				input?.template?.source ?? input?.template ?? ""
			)
			if (!template)
				return halt(
					"assemble has no template — the context config did not resolve, " +
						"so there is nothing to render into"
				)

			const decisions = input?.decisions ?? []
			// Candidates without decisions means the ranker was skipped. Rendering
			// anyway produces a prompt with every block missing and no error —
			// which is what the first parity run looked like, and it took a byte
			// comparison to notice. A halt names the missing node instead.
			if (!decisions.length && (input?.candidates ?? []).length)
				return halt(
					`assemble was given ${input.candidates.length} candidates but no ranking ` +
						`decisions. Wire a ranker (core:task/rank-hybrid@1) between retrieval and ` +
						`assembly — without one there is nothing that says which candidates fit ` +
						`the budget, and rendering would drop all of them silently.`
				)
			const allocation = allocate(decisions, {
				budgetTotal: input?.budget?.total ?? input?.params?.budget ?? 0,
				groups: input?.groups
			})
			// The reminder's position, resolved against the messages that are
			// actually going out. The context builder ships a placeholder index
			// because the final message array does not exist when it runs.
			const messages = input?.messages ?? []
			const ctxPostHistory = (input?.templateContext as any)?.postHistory
			let postHistory = ctxPostHistory
			if (ctxPostHistory?.hasContent && messages.length) {
				const { resolvePostHistoryContext } = await import(
					"$lib/server/utils/promptBuilder/PostHistoryContext"
				)
				const resolved = await resolvePostHistoryContext({
					renderMessages: messages,
					instructions: ctxPostHistory.instructions,
					charInstructions: ctxPostHistory.charInstructions,
					exampleDialogue: ctxPostHistory.exampleDialogue,
					postHistoryDepth: input?.params?.postHistoryDepth ?? 0,
					postHistoryTokenTrigger:
						input?.params?.postHistoryTokenTrigger ?? 0,
					tokenCounter: { countTokens: (t: string) => roughTokens(t) }
				})
				postHistory = resolved.postHistory
			}

			const rendered = render({
				allocation,
				postHistory,
				template,
				// Resolved from the template slot, so a config written in a
				// plugin's engine renders with the plugin's assembler rather
				// than being run through core's (12 §2a).
				engine: input?.template?.engine ?? null,
				prompts: input?.prompts,
				templateContext: input?.templateContext,
				messages: input?.messages ?? [],
				promptFormat: input?.promptFormat
			})

			return ok({
				main: { ...allocation, ...rendered },
				context: { ...allocation, ...rendered },
				blocks: allocation.blocks,
				budget: allocation.budget
			})
		},

		// ── Providers ───────────────────────────────────────────────────────
		/**
		 * Embed text for semantic retrieval.
		 *
		 * A Provider rather than part of the vector Query, because a Query may
		 * not reach a model (16 §1) — and because putting the call on the spine
		 * is what makes it visible to the budget and the receipt. Retrieval that
		 * quietly embedded would be a model call nobody was billed for and
		 * nobody could see.
		 */
		"core:provider/embed-text@1": async (input: any, ctx: any) => {
			const result: any = await ctx.call({
				text: input?.text,
				texts: input?.texts
			})
			return ok({
				main: result?.vector ?? null,
				vector: result?.vector ?? null,
				vectors: result?.vectors ?? []
			})
		},

		/**
		 * Generate.
		 *
		 * The binding is short because it is supposed to be: it names the effect
		 * and the host performs it (F19). Everything that could tempt a Provider
		 * into doing its own I/O — picking the connection, building the request,
		 * handling the stream — is on the other side of `ctx.call`, which is the
		 * side the budget, the receipt and the review gate can all see.
		 *
		 * It halts rather than errs when the model produced nothing. An empty
		 * completion is a thing that happens — a stop sequence at position zero, a
		 * context overflow, an aborted stream — and it is not a fault in the
		 * pipeline. Halting says "this run has no answer" where an `err` would send
		 * whoever is reading the receipt looking for a bug.
		 */
		"core:provider/generate-text@1": async (input: any, ctx: any) => {
			const result: any = await ctx.call({
				// The rendered prompt, whatever produced it. Accepting the assemble
				// node's whole output as well as a bare payload means a spec can wire
				// `$.assembled` straight in without a shim node in between.
				compiledPrompt:
					input?.compiledPrompt ?? input?.context ?? input?.main,
				currentCharacterId: input?.currentCharacterId ?? null,
				generatingMessageMetadata: input?.generatingMessageMetadata
			})

			if (result?.isAborted)
				return halt("generation was aborted before the model finished")
			if (!result?.text)
				return halt(
					`the model returned nothing (via ${result?.via ?? "unknown"}) — there is no ` +
						`message to write`
				)

			return ok({
				main: result.text,
				text: result.text,
				thinking: result.thinking,
				// The connection *type*, not the connection: enough to answer "which
				// provider answered this turn" from the receipt, and nothing that
				// could be replayed by whoever reads it.
				via: result.via
			})
		},

		// ── Consumers ───────────────────────────────────────────────────────
		// The binding describes the write; the host performs it. Returning the
		// payload unchanged is the correct implementation, not a stub.
		"core:consumer/create-message@1": async (input: any, ctx: any) =>
			ok(await ctx.commit(input)),
		"core:consumer/update-message@1": async (input: any, ctx: any) =>
			ok(await ctx.commit(input))
	}
}

/** Which type ids core can actually run today, for the diagnostics screen. */
export const boundTypeIds = () => Object.keys(coreBindings())
