/**
 * Core's bindings — one per node type (U5).
 *
 * Each is a **wrapper around code that already exists**, not a rewrite. That is
 * the whole shape of step 3 in docs-dev/INTEGRATING.md: the pipeline path runs
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
import {
	keywordQuery,
	normaliseTfidf
} from "$lib/server/pipelines/ranking/keywordQuery"
import {
	eligibleFor,
	armNote,
	fuseRanks
} from "$lib/server/pipelines/ranking/strategy"
import { select } from "$lib/server/pipelines/ranking/select"
import {
	rankSemantic,
	mergeWindows
} from "$lib/server/pipelines/ranking/semantic"
import { queryWindows } from "$lib/server/pipelines/ranking/ragQuery"
import {
	DEFAULT_SIGNAL_WEIGHTS,
	PRIORITY_SCORE_BONUS,
	withDefaults,
	type SignalWeights,
	type SourceKind
} from "$lib/server/pipelines/ranking/weights"
import { allocate, render } from "$lib/server/pipelines/prompt/assemble"
import { resolveContextInput } from "$lib/server/pipelines/prompt/promptFields"
import { processMessages } from "$lib/server/pipelines/prompt/messages"
import { resolvePostHistoryContext } from "$lib/server/pipelines/prompt/postHistory"
import { buildTemplateContext } from "$lib/server/pipelines/prompt/templateContext"
import {
	buildBatchPrompt,
	buildCharacterExtractionPrompt,
	buildNamePrompt,
	buildSynthesisPrompt,
	formatMessagesAsJson,
	type JsonDraft
} from "$lib/server/utils/summarizer/templates"
import { parseSummaryOutput } from "$lib/server/utils/summarizer/parser"

/** Not built yet, and saying so plainly beats failing like a bug. */
const notYet = (what: string, where: string) => async () =>
	halt(`${what} is not bound yet — ${where}`)

/**
 * The ranker's flat slot parameters, as the shape `weights.ts` expects.
 *
 * The declaration is flat because a `parameters` schema is one level deep — a
 * form renders fields, not a tree. `RankingParams` is grouped, because the
 * three kinds of number in it are mechanically different and keeping them apart
 * is what makes tuning predictable. This is the seam between those two facts,
 * and it is a mapping rather than a cast so a partial config still lands in the
 * right section for `withDefaults` to fill around.
 */
/**
 * The same seam for a retrieval node's flat params.
 *
 * ⚠ Without this, `withDefaults(input.params)` was handed `{scanDepth: 5}` and
 * looked for `partial.retrieval.scanDepth`, found nothing, and returned the
 * default — so **`Scan Depth` on the two lore nodes did nothing at all**. The
 * control rendered, accepted a value, stored it and was read by a function
 * that could not see it. Found while wiring `maxRecursionDepth`, which would
 * have landed dead in exactly the same way.
 */
function retrievalParamsFrom(params: any) {
	if (!params || typeof params !== "object") return {}
	const retrieval: Record<string, unknown> = {}
	if (typeof params.scanDepth === "number")
		retrieval.scanDepth = params.scanDepth
	if (typeof params.maxRecursionDepth === "number")
		retrieval.maxRecursionDepth = params.maxRecursionDepth
	if (typeof params.matchMode === "string")
		retrieval.matchMode = params.matchMode
	return Object.keys(retrieval).length ? { retrieval } : {}
}

/**
 * The declared signal fields, `signalKeyword` → `signals[source].keyword`.
 *
 * The descriptor declares the matrix transposed — nine `perMember` fields,
 * because a `parameters` schema's unit is the field and its control is a
 * per-source row — while `withDefaults` demands the untransposed shape with
 * one law attached: **naming a source means giving it a complete set** (no
 * deep merge, so a partial set cannot silently inherit weights the user
 * thought they had replaced). This transposes back and *constructs* that
 * completeness: any field the config did not carry falls back per-field to
 * the default, so the set handed over is total whichever fields arrived.
 */
const SIGNAL_FIELDS: Array<[param: string, signal: keyof SignalWeights]> = [
	["signalKeyword", "keyword"],
	["signalNameMatch", "nameMatch"],
	["signalEntityCooccurrence", "entityCooccurrence"],
	["signalTfidf", "tfidf"],
	["signalLastRefRecency", "lastRefRecency"],
	["signalRecency", "recency"],
	["signalSceneAffinity", "sceneAffinity"],
	["signalDensity", "density"],
	["signalPriorityBonus", "priorityBonus"]
]

function signalsFrom(
	params: any
): Partial<Record<SourceKind, SignalWeights>> | null {
	const carried = SIGNAL_FIELDS.filter(
		([param]) => params[param] && typeof params[param] === "object"
	)
	if (!carried.length) return null
	const signals: Partial<Record<SourceKind, SignalWeights>> = {}
	for (const source of Object.keys(
		DEFAULT_SIGNAL_WEIGHTS
	) as SourceKind[]) {
		const set = { ...DEFAULT_SIGNAL_WEIGHTS[source] }
		for (const [param, signal] of carried) {
			const v = params[param][source]
			if (typeof v === "number" && Number.isFinite(v)) set[signal] = v
		}
		signals[source] = set
	}
	return signals
}

function rankingParamsFrom(params: any) {
	if (!params || typeof params !== "object") return {}
	const out: Record<string, unknown> = {}
	const groups: Record<string, unknown> = {}
	if (params.share) groups.share = params.share
	if (params.maxEntries) groups.maxEntries = params.maxEntries
	if (params.minEntries) groups.minEntries = params.minEntries
	if (Object.keys(groups).length) out.groups = groups
	const signals = signalsFrom(params)
	if (signals) out.signals = signals
	return out
}

/**
 * Tokens the context may occupy, from the window the reply will be sent
 * against.
 *
 * Derived, never typed. The window is a column on `sampling_configs` and the
 * reply's allowance is the column beside it, so the whole calculation is
 * `context - response - drift`. The node used to declare its own
 * `reserveForReply` defaulting to 512 next to a `response_tokens` defaulting to
 * 512 — one number with two homes, free to disagree with the model actually
 * being called, warning nobody when it did.
 */
function contextBudgetFrom(input: any) {
	const sampling = input?.sampling ?? {}
	// The same fallbacks `dispatchStep` uses when it actually sends, and that
	// is the point of repeating them rather than picking a number here: the
	// budget is only correct if it describes the window the prompt is sent
	// against. A node that fell back differently would compute a budget for a
	// window nothing was going to use, which is the failure this whole change
	// exists to end — just relocated.
	const window = Number(sampling.contextTokens) || 4096
	const reply = Number(sampling.responseTokens) || 512
	const margin = Number(input?.params?.safetyMargin ?? 0.05)
	const total = Math.max(0, Math.floor((window - reply) * (1 - margin)))
	return { total, remaining: total, available: total }
}

/**
 * One lorebook scan, filtered to a single source.
 *
 * Shared by the world-lore and character-lore queries. Both read the same rows
 * and run the same matcher — the split is about giving each its own weight,
 * floor and share, not about retrieving differently — so the scan lives here
 * once instead of being copied and drifting.
 *
 * `skipped` is filtered too. An entry declined on the *other* source is not a
 * fact about this query, and reporting it here would tell someone their world
 * lore was skipped when it was a character entry all along.
 */
async function loreFor(source: string, input: any, ctx: any) {
	const params = withDefaults(retrievalParamsFrom(input?.params))
	const [entries, messages, embedding] = await Promise.all([
		ctx.read("lorebook_entries", {
			sessionId: input?.scope?.sessionId,
			currentCharacterId: input?.scope?.currentCharacterId ?? null
		}),
		ctx.read("session_messages", {
			sessionId: input?.scope?.sessionId,
			limit: input?.limit ?? 100
		}),
		ctx.read("embedding_status", {})
	])

	const result = keywordQuery({
		entries: entries ?? [],
		messages: messages ?? [],
		entityNames: input?.entityNames ?? [],
		retrieval: params.retrieval,
		// The node's mode is a default for entries that did not choose, read
		// off the raw params rather than `withDefaults` — that function fills
		// the ranking shape, and this is not part of it.
		defaultStrategy: input?.params?.retrievalMode,
		availability: {
			vectorSearchAvailable: embedding?.available ?? false
		},
		countTokens: (text: string) => roughTokens(text)
	})

	const mine = normaliseTfidf(result.candidates).filter(
		(c: any) => c.source === source
	)
	const mineSkipped = (result.skipped ?? []).filter(
		(s: any) => s.source === source
	)
	return ok({
		main: mine,
		hits: mine,
		skipped: mineSkipped,
		/**
		 * ⚠ These were dropped when the one lore query became two, and the loss
		 * is the same one `skipped` exists to prevent: `lorebook-triggers`
		 * reported how far it looked and whether vector search was available,
		 * and the two nodes that actually run in a reply reported neither. "Why
		 * did my lore not come in" had no answer on the path everyone is on.
		 *
		 * Counted for *this* source, not the shared scan, so `considered` is
		 * the number of entries this node was responsible for.
		 */
		diagnostics: {
			scanDepth: result.diagnostics.scanDepth,
			recursionDepth: result.diagnostics.recursionDepth,
			windowChars: result.diagnostics.windowChars,
			considered: mine.length + mineSkipped.length,
			matched: mine.length,
			// Named in the result so "why did RAG not run" is answerable from
			// the receipt rather than from the embedding settings screen.
			vectorSearch: embedding?.available
				? `available (${embedding.model})`
				: (embedding?.reason ?? "unavailable")
		}
	})
}

/**
 * One traversal, read by both relationship nodes.
 *
 * Each calls it separately, so the graph is walked twice per turn. That is the
 * same bargain the two lore queries make — they each run the whole keyword scan
 * — and it buys the thing the split is for: two nodes that can be switched off,
 * weighted and laid out independently. They sit in the same `async` block, so
 * the cost is concurrency rather than wall-clock.
 */
async function readGraph(input: any, ctx: any) {
	const summary = await ctx.read("graph_context", {
		sessionId: input?.scope?.sessionId,
		currentCharacterId:
			input?.scope?.currentCharacterId ??
			input?.currentCharacterId ??
			null
	})
	// Passed through as the structure it is. It used to be coerced to a string
	// here, which was harmless only because the host had already stringified it
	// — and which would now discard the shape the layout renders.
	return (summary ?? null) as {
		yourRelationships?: Record<string, unknown[]>
		howOthersRegardYou?: Record<string, unknown[]>
		legendaryFigures?: Record<string, unknown>
	} | null
}

/**
 * The node's ceiling, applied to a section keyed by the other character's name.
 *
 * Counted in *relationships*, not in names — one character the speaker has
 * three separate ties to is three, because three is what reaches the prompt.
 * Insertion order is the graph's own ordering, which `buildGraphContext`
 * already sorts by how recently the binding changed.
 */
function capRelationships(
	section: Record<string, unknown[]> | undefined,
	maxEntries: unknown
): Record<string, unknown[]> | null {
	if (!section || Object.keys(section).length === 0) return null
	const cap = typeof maxEntries === "number" ? maxEntries : undefined
	if (cap === undefined || cap < 0) return section
	if (cap === 0) return null

	const out: Record<string, unknown[]> = {}
	let left = cap
	for (const [name, rels] of Object.entries(section)) {
		if (left <= 0) break
		const take = rels.slice(0, left)
		if (take.length === 0) continue
		out[name] = take
		left -= take.length
	}
	return Object.keys(out).length ? out : null
}

/**
 * One next-speaker implementation behind four type ids (19 §5, U-C4).
 *
 * The rules, in order:
 *
 * 1. **An explicit pick always wins.** `characterId` on the in-port means the
 *    trigger already decided — the "Trigger Character" picker, a regen — and
 *    every strategy's only job then is to record it (`via: 'pick'`).
 * 2. Otherwise the strategy decides. `round-robin` is the 0.5 rotation
 *    verbatim — the same `getNextCharacterTurn` the socket ran, now inside
 *    the run where the receipt can see it (the flat "Ordered" rule; the
 *    user-split variant is its own future strategy, not a parameter here).
 *    `random` is a seeded pick among active characters, so a replayed run
 *    seats the same speaker. `manual` and `none` never decide — they differ
 *    in what the UI offers (a picker vs no speaker system at all), not in
 *    what the node computes.
 * 3. **No speaker is an outcome, not a failure.** A null id is exactly what
 *    the legacy path handed on, so nothing here halts.
 */
function pickSpeaker(strategy: string) {
	return async (input: any, ctx: any) => {
		const done = (characterId: number | null, via: string) =>
			ok({
				main: { characterId, strategy, via },
				characterId,
				strategy
			})

		const explicit = input?.characterId
		const explicitId =
			typeof explicit === "number"
				? explicit
				: typeof explicit?.id === "number"
					? explicit.id
					: null
		if (explicitId != null) return done(explicitId, "pick")

		const cast = input?.cast ?? {}
		if (strategy === "round-robin") {
			const { getNextCharacterTurn } = await import(
				"$lib/server/utils/getNextCharacterTurn"
			)
			return done(
				getNextCharacterTurn({
					sessionMessages: input?.messages ?? [],
					sessionCharacters: cast.sessionCharacters ?? [],
					sessionPersonas: cast.sessionPersonas ?? []
				} as any),
				"strategy"
			)
		}
		if (strategy === "random") {
			const eligible = (cast.sessionCharacters ?? []).filter(
				(cc: any) => cc?.character && cc.isActive && !cc.removedAt
			)
			if (!eligible.length) return done(null, "strategy")
			const random: () => number = ctx?.random ?? (() => 0)
			const pick = eligible[Math.floor(random() * eligible.length)]
			return done(pick.character.id, "strategy")
		}
		// manual / none: explicit picks or nobody.
		return done(null, "strategy")
	}
}

export function coreBindings(): Bindings {
	const bindings: Bindings = {
		// ── Inputs ──────────────────────────────────────────────────────────
		// An Input node does not fetch; it names what the trigger already
		// carried. Core hands the trigger payload in as the run's input, so the
		// binding is the identity — and that is not a placeholder, it is what an
		// Input *is* (01 §2).
		"core:input/user-message@1": async (input: any) => ok(input),
		"core:input/message-created@1": async (input: any) => ok(input),

		// ── Queries ─────────────────────────────────────────────────────────
		"core:query/session-history@1": async (input: any, ctx: any) => {
			const messages = await ctx.read("session_messages", {
				sessionId: input?.scope?.sessionId,
				limit: input?.limit ?? 100,
				// Which lane builds this context (20 §7). 'main' is the chat
				// log and today's exact behaviour; another value is a mode's
				// declared channel, read on purpose by the pipeline that wants
				// it.
				channel:
					input?.params?.channel ?? input?.channel ?? "main"
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
		// Two nodes, one scan. Each filters the shared result to its own
		// source rather than running a second retrieval — the candidates
		// already carry which they are, so a separate implementation would be
		// two things to keep in step for no gain.
		"core:query/world-lore@1": async (input: any, ctx: any) =>
			await loreFor("worldLore", input, ctx),
		"core:query/character-lore@1": async (input: any, ctx: any) =>
			await loreFor("characterLore", input, ctx),
		// ⚠ The third lane, absent between spec 1.8.0 and 1.10.0. The two lore
		// queries each filter the shared scan to their own source, and nothing
		// filtered for `history` — so those candidates were built, scored and
		// dropped, with the ranker still holding a `history` band and
		// `assemble` still asking for history blocks.
		"core:query/history-entries@1": async (input: any, ctx: any) =>
			await loreFor("history", input, ctx),

		"core:query/lorebook-triggers@1": async (input: any, ctx: any) => {
			const params = withDefaults(retrievalParamsFrom(input?.params))
			const [entries, messages, embedding] = await Promise.all([
				ctx.read("lorebook_entries", {
					sessionId: input?.scope?.sessionId,
					currentCharacterId: input?.scope?.currentCharacterId ?? null
				}),
				ctx.read("session_messages", {
					sessionId: input?.scope?.sessionId,
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
				ctx.read("lorebook_entries", {
					sessionId: input?.scope?.sessionId,
					currentCharacterId: input?.scope?.currentCharacterId ?? null
				}),
				ctx.read("vector_search", {
					sessionId: input?.scope?.sessionId,
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
					!eligibleFor(
						entry,
						"vector",
						{ vectorSearchAvailable: true },
						// The vector arm answers to the same node default the
						// keyword arm does; leaving it out here would make the
						// two arms disagree about what an undecided entry is.
						input?.params?.retrievalMode
					)
				) {
					excluded.add(key)
					skipped.push({
						id: hit.id,
						source: hit.source,
						reason: armNote(
							entry,
							"vector",
							{ vectorSearchAvailable: true },
							input?.params?.retrievalMode
						).replace(
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
		 * Who is in the session, and the config they speak under.
		 *
		 * A Query because it reads rows, and one Query rather than three because
		 * the cast is only useful assembled: a character row without its
		 * `sessionCharacters` join carries no visibility, and visibility is what
		 * decides whether that character appears in the prompt at all.
		 *
		 * It decides nothing. Which of these rows are shown, named or minimal is
		 * the context Task's business.
		 */
		/**
		 * The speaker's relationships, from the narrative graph.
		 *
		 * Empty is normal, not a halt: an install that never opened the graph
		 * has no relationships, and the shipped template's `{{#if}}` skips the
		 * block. Halting here would stop every session on every install without
		 * one — which is what makes "produces nothing" the right shape for a
		 * Query that is genuinely optional.
		 */
		"core:query/relationships-perspectives@1": async (
			input: any,
			ctx: any
		) => {
			const graph = await readGraph(input, ctx)
			// Each node takes its own section of one traversal's result, the
			// same way the two lore queries each filter one scan. Returning
			// `null` rather than `{}` for an absent section keeps the
			// template's `{{#if}}` falsy without the layout having to know.
			const mine = capRelationships(
				graph?.yourRelationships,
				input?.params?.maxEntries
			)
			return ok({ main: mine, relationshipsPerspectives: mine })
		},

		"core:query/relationships-known@1": async (input: any, ctx: any) => {
			const graph = await readGraph(input, ctx)
			const known = capRelationships(
				graph?.howOthersRegardYou,
				input?.params?.maxEntries
			)
			// Two conditional sections, and absent means absent: an install
			// with no legendary figures has no key at all rather than an empty
			// object, which is what the shipped layout's guards are written
			// against.
			const out: Record<string, unknown> = {}
			if (known) out.howOthersRegardYou = known
			if (graph?.legendaryFigures)
				out.legendaryFigures = graph.legendaryFigures
			const value = Object.keys(out).length ? out : null
			return ok({ main: value, relationshipsKnown: value })
		},

		"core:query/session-cast@1": async (input: any, ctx: any) => {
			const cast = await ctx.read("session_cast", {
				sessionId: input?.scope?.sessionId
			})
			if (!cast)
				return halt(
					"there is no session to build a prompt for — the run is scoped to a " +
						"session that no longer exists"
				)
			// Whose turn it is travels *with* the cast rather than separately.
			// It is one fact about the session — who is in it and who is speaking —
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
		// The four next-speaker strategies (19 §5, U-C4). One implementation,
		// four ids — see `pickSpeaker` below for the rules.
		"core:task/turn-round-robin@1": pickSpeaker("round-robin"),
		"core:task/turn-random@1": pickSpeaker("random"),
		"core:task/turn-manual@1": pickSpeaker("manual"),
		"core:task/turn-none@1": pickSpeaker("none"),
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
		 * participants who have left the session.
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
		/**
		 * The context budget, from the window the reply is sent against.
		 *
		 * A Task rather than a Query even though it reads configuration: the
		 * executor resolves a `sampling` slot to the config's *values*, so this
		 * is handed what it needs rather than looking anything up (F11).
		 */
		"core:task/context-budget@1": async (input: any) => {
			const budget = contextBudgetFrom(input)
			return ok({ main: budget, available: budget })
		},

		"core:task/rank-hybrid@1": async (input: any) => {
			const params = withDefaults(rankingParamsFrom(input?.params))
			const candidates = normaliseTfidf(input?.candidates ?? [])
			const selection = select(candidates, {
				// From the `budget` in-port, which `core:task/context-budget@1`
				// derives from the sampling config's window. There is no longer
				// a typed fallback: an absolute count on the node could not know
				// which model it was about to be sent to.
				availableTokens:
					input?.budget?.remaining ?? input?.availableTokens ?? 0,
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
		 * the read is a read and belongs in `core:query/session-cast@1`, and what is
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
					"there is no cast to build a prompt context from — the session query " +
						"returned nothing, which usually means the session was deleted mid-run"
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
				relationshipsPerspectives: input?.relationshipsPerspectives,
				relationshipsKnown: input?.relationshipsKnown,
				characterLore: input?.characterLore,
				session: cast,
				pickExample: (n: number) => Math.floor(random() * n)
			})

			// The `variables` slot, resolved through the scope chain and already
			// dereferenced from row ids into template sources by `world.ts` —
			// the same treatment `prompts` gets, and for the same reason: this
			// node needs the template, not the number.
			const templateContext = await buildTemplateContext({
				...resolved,
				variables: input?.variables
			})
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
		 * Pure, and it reuses `SessionMessageProcessor` rather than reimplementing it
		 * — the name-resolution chain reaches through removed participants to a
		 * name snapshotted at removal time, and a second version of that agrees on
		 * every session until someone leaves one.
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

			const rendered = await render({
				allocation,
				postHistory,
				template,
				// Resolved from the template slot, so a config written in a
				// plugin's engine renders with the plugin's assembler rather
				// than being run through core's (12 §2a).
				engine: input?.template?.engine ?? null,
				prompts: input?.prompts,
				templateContext: input?.templateContext,
				// This node's own `variables` slot: how the lore and history
				// *it* produced are laid out. Separate from the context
				// builder's slot, because these are post-budget — what fits is
				// only known here.
				variables: input?.variables,
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

		// ── Summarization ───────────────────────────────────────────────────
		//
		// The two-phase shape of `utils/summarizer`, as nodes. Every prompt below
		// comes from the node's `prompts` slot, resolved through the scope chain
		// — so a user who retuned "Default World Summarization" gets their
		// wording here without this file knowing anything about it.

		"core:input/summarize-request@1": async (input: any) => ok(input),

		"core:query/summarize-source@1": async (input: any, ctx: any) => {
			// `summarize_source`, not `session_messages`: a summary wants a chosen
			// range with sender names resolved, and the host owns both rules so
			// no binding can get the hidden-message convention wrong.
			const messages = await ctx.read("summarize_source", {
				sessionId: input?.scope?.sessionId,
				messageIds: input?.request?.messageIds,
				limit: input?.request?.limit ?? 5000
			})
			return ok({ main: messages, messages })
		},

		/**
		 * The cut into batches.
		 *
		 * A Task, so it is inspectable and its parameters are a user's to tune.
		 * The 1500-token headroom is the legacy reserve for the prompt template
		 * and the draft the model writes back — without it a batch sized exactly
		 * to the window leaves no room for the answer.
		 */
		/**
		 * Tool calling's pure halves (20 §9). A tool is any same-shaped
		 * provider — canonically a sandboxed plugin hook on the spine — and
		 * these two only decide how the model learns about it and how its
		 * answer is read back. Which door (`style`) is a bind-time match
		 * against the connection's capability report, never a runtime guess.
		 */
		"core:task/advertise-tools@1": async (input: any) => {
			const tools: any[] = Array.isArray(input?.tools)
				? input.tools.filter(
						(t: any) => t && typeof t.name === "string"
					)
				: []
			// Normalized for a native tool API: name/description/parameters,
			// nothing else — an adapter maps this onto its provider's shape.
			const native = tools.map((t) => ({
				name: t.name,
				description: String(t.description ?? ""),
				parameters:
					t.parameters && typeof t.parameters === "object"
						? t.parameters
						: { type: "object", properties: {} }
			}))
			// The emulated door: the advertisement as prompt text, with one
			// unambiguous call convention the parse task's grammar mirrors.
			const prompt = tools.length
				? [
						"# Tools",
						"To use a tool, reply with ONLY a fenced block:",
						"```tool_call",
						'{"tool": "<name>", "args": { ... }}',
						"```",
						"Reply normally when no tool is needed.",
						"",
						...tools.map(
							(t) =>
								`- ${t.name}: ${String(t.description ?? "")}` +
								(t.parameters
									? `\n  args schema: ${JSON.stringify(t.parameters)}`
									: "")
						)
					].join("\n")
				: ""
			const style = input?.params?.style === "native" ? "native" : "prompt"
			return ok({
				main: style === "native" ? native : prompt,
				native,
				prompt
			})
		},

		"core:task/parse-tool-call@1": async (input: any) => {
			const text = String(input?.text ?? "")
			const known = new Set(
				(Array.isArray(input?.tools) ? input.tools : [])
					.map((t: any) => t?.name)
					.filter((n: any) => typeof n === "string")
			)
			/** First match wins: the fenced convention, then a bare object. */
			const fenced = /```tool_call\s*\n([\s\S]*?)```/.exec(text)
			// The bare form needs *balanced* extraction — a lazy regex stops
			// at the first `}` and beheads any call with nested args.
			let bare: string | null = null
			if (!fenced) {
				const at = text.search(/\{\s*"(tool|name)"\s*:/)
				if (at >= 0) {
					let depth = 0
					for (let i = at; i < text.length; i++) {
						const c = text[i]
						if (c === "{") depth++
						else if (c === "}" && --depth === 0) {
							bare = text.slice(at, i + 1)
							break
						}
					}
				}
			}
			const raw = fenced?.[1] ?? bare ?? null

			let call: { tool: string; args: Record<string, unknown> } | null =
				null
			if (raw) {
				try {
					const parsed = JSON.parse(raw)
					const tool =
						typeof parsed?.tool === "string"
							? parsed.tool
							: typeof parsed?.name === "string"
								? parsed.name
								: null
					if (tool && (!known.size || known.has(tool)))
						call = {
							tool,
							args:
								parsed.args && typeof parsed.args === "object"
									? parsed.args
									: (parsed.arguments ?? {})
						}
				} catch {
					// An unparseable block is prose, not a crash: the loop's
					// predicate sees no call and the turn settles as text.
				}
			}
			// What renders is prose; what dispatches is data. Stripping only
			// the matched block keeps a reply that mixed narration and a call
			// readable.
			const matched = fenced?.[0] ?? bare ?? undefined
			const stripped =
				call && matched ? text.replace(matched, "").trim() : text
			return ok({ main: call, call, text: stripped })
		},

		"core:task/batch-messages@1": async (input: any) => {
			const messages: any[] = Array.isArray(input?.messages)
				? input.messages
				: []
			const limit = Number(input?.params?.batchTokens ?? 2048)
			const budget = Math.max(limit - 1500, 500)

			const batches: any[][] = []
			let current: any[] = []
			let tokens = 0

			for (const msg of messages) {
				const cost =
					roughTokens(
						JSON.stringify({
							speaker: msg?.senderName ?? msg?.role,
							text: msg?.content ?? ""
						})
					) + 5
				if (current.length > 0 && tokens + cost > budget) {
					batches.push(current)
					current = [msg]
					tokens = cost
				} else {
					current.push(msg)
					tokens += cost
				}
			}
			if (current.length > 0) batches.push(current)

			// One empty batch rather than none: a map over nothing produces
			// nothing to synthesize, and "there is no summary" reads as a failure
			// when the honest answer is "there was nothing to summarize".
			const out = batches.length > 0 ? batches : [[]]
			return ok({ main: out, batches: out })
		},

		/**
		 * Phase 1, one batch.
		 *
		 * The user prompt comes from `summarizer/templates.ts` — the same
		 * builder the legacy path uses, called with the same arguments. That is
		 * the whole parity claim for this step: the rules, the `<content>`
		 * contract and the per-lore-type wording are not restated here, so they
		 * cannot drift from the path they are being migrated off.
		 *
		 * `loreType` is authored on the node rather than configured, because
		 * *which kind of entry this pipeline writes* is what distinguishes the
		 * four summarize namespaces from each other. It is not a user's to tune.
		 */
		"core:provider/summarize-batch@1": async (input: any, ctx: any) => {
			const { systemPrompt, userPrompt } = buildBatchPrompt({
				jsonMessages: formatMessagesAsJson(
					Array.isArray(input?.batch) ? input.batch : []
				),
				loreType: input?.loreType ?? "world",
				// From the wired `request` port when the spec passes one (1.1.0),
				// or flat on the input for callers that construct it directly.
				topic: input?.request?.topic ?? input?.topic,
				// The prompts slot, resolved through the scope chain. Blank falls
				// back to the template's own default, which is what the legacy
				// columns do — they default to "" and an unconfigured step must
				// fall back rather than send an empty system prompt.
				systemPromptOverride: input?.prompts?.batch?.trim()
					? input.prompts.batch
					: null
			})

			const result: any = await ctx.call({
				systemPrompt,
				userPrompt,
				label: "summarize:batch"
			})
			if (!result?.text)
				return halt("the model returned nothing for this batch")

			// `<content>` unwrapped here rather than at synthesis: a draft is
			// what phase 2 merges, and handing it the tags as well would put the
			// contract's own scaffolding into the finished entry.
			const raw = parseSummaryOutput(result.text).content ?? result.text
			// The interior point (18 §4e): the user's `each-draft` chain runs
			// over every intermediate draft before synthesis reads it — slop
			// killed in the material summaries are built *from*. `ctx.scripts`
			// exists only because the descriptor declares the point; absent an
			// engine, the draft passes through untouched.
			const draft = ctx.scripts
				? await ctx.scripts.applyText("each-draft", raw)
				: raw
			return ok({ main: draft, draft })
		},

		/** Phase 2 — the ordered drafts, merged. */
		"core:provider/summarize-synth@1": async (input: any, ctx: any) => {
			const raw: any[] = Array.isArray(input?.drafts) ? input.drafts : []
			// Order is load-bearing: the drafts are chronological slices and the
			// synthesis prompt asks the model to preserve that order. `part` is
			// the field the template names.
			//
			// A map block aggregates as `branch-results@1` — one entry per
			// iteration carrying `{branchKey, index, result}` in declaration
			// order (13 §1) — so each draft is unwrapped from its result
			// envelope. The bare forms stay accepted for callers that hand the
			// drafts over directly. A halted iteration contributes nothing
			// rather than an empty part the model would dutifully summarize.
			const drafts: JsonDraft[] = raw
				.map((d) => {
					if (typeof d === "string") return d
					const v = d?.result?.value ?? d
					return v?.draft ?? v?.main ?? ""
				})
				.filter((text: string) => text.length > 0)
				.map((draft, i) => ({ part: i + 1, draft }))

			const { systemPrompt, userPrompt } = buildSynthesisPrompt({
				jsonDrafts: JSON.stringify(drafts, null, 2),
				loreType: input?.loreType ?? "world",
				topic: input?.request?.topic ?? input?.topic,
				systemPromptOverride: input?.prompts?.synth?.trim()
					? input.prompts.synth
					: null
			})

			const result: any = await ctx.call({
				systemPrompt,
				userPrompt,
				label: "summarize:synth"
			})
			if (!result?.text)
				return halt("the model returned nothing to synthesize into")

			const content =
				parseSummaryOutput(result.text).content ?? result.text
			return ok({ main: content, content })
		},

		"core:provider/name-entry@1": async (input: any, ctx: any) => {
			const { systemPrompt, userPrompt } = buildNamePrompt({
				content: String(input?.content ?? ""),
				loreType: input?.loreType ?? "world",
				systemPromptOverride: input?.prompts?.name?.trim()
					? input.prompts.name
					: null
			})

			const result: any = await ctx.call({
				systemPrompt,
				userPrompt,
				label: "summarize:name"
			})

			// A nameless entry is still an entry. The content is the valuable
			// part, and halting here would throw away a finished summary over
			// its title.
			const name = (result?.text ?? "").trim()
			return ok({ main: name, name })
		},

		"core:provider/extract-cast@1": async (input: any, ctx: any) => {
			const knownCast = Array.isArray(input?.request?.knownCast)
				? input.request.knownCast
				: Array.isArray(input?.knownCast)
					? input.knownCast
					: undefined
			const { systemPrompt, userPrompt } = buildCharacterExtractionPrompt(
				String(input?.content ?? ""),
				input?.prompts?.characterExtraction?.trim()
					? input.prompts.characterExtraction
					: null,
				knownCast
			)

			const result: any = await ctx.call({
				systemPrompt,
				userPrompt,
				label: "summarize:cast"
			})

			// The extraction contract is a raw JSON object, so a model that
			// wrapped it in prose is salvaged rather than lost — the host does
			// the salvaging, and an unparseable answer yields no cast rather
			// than a crash. An empty cast is a legitimate answer here.
			const parsed: any = result?.json ?? {}
			return ok({
				main: parsed,
				cast: {
					participants: parsed?.participants ?? [],
					mentioned: parsed?.mentioned ?? []
				}
			})
		},

		// ── Graph build ─────────────────────────────────────────────────────

		"core:query/graph-scenes@1": async (input: any, ctx: any) => {
			const scenes = await ctx.read("graph_scenes", {
				sessionId: input?.scope?.sessionId
			})
			return ok({ main: scenes, scenes })
		},

		...graphSteps(),

		// ── Consumers ───────────────────────────────────────────────────────
		// The binding describes the write; the host performs it. Returning the
		// payload unchanged is the correct implementation, not a stub.
		"core:consumer/create-message@1": async (input: any, ctx: any) =>
			ok(await ctx.commit(input)),
		"core:consumer/update-message@1": async (input: any, ctx: any) =>
			ok(await ctx.commit(input)),
		"core:consumer/create-lore-entry@1": async (input: any, ctx: any) =>
			ok(await ctx.commit(input)),
		// Gate-eligible, and that is the mechanism behind "a graph build stops at
		// the review screen": what comes back is a proposal, not rows.
		"core:consumer/graph-proposal@1": async (input: any, ctx: any) =>
			ok(await ctx.commit(input))
	}

	/**
	 * Both context builders, one implementation.
	 *
	 * They are separate *types* because they declare different configurable
	 * surfaces — see `buildNarratorContext` in contracts — not because they
	 * behave differently. Narrator mode is still chosen the way it always was,
	 * by there being no speaking character, and this function already handles
	 * both branches. Aliasing rather than copying is what keeps "two surfaces"
	 * from quietly becoming "two implementations to keep in step".
	 */
	bindings["core:task/build-narrator-context@1"] =
		bindings["core:task/build-template-context@1"]!

	return bindings
}

/**
 * The five graph steps, which differ only in which prompt field they read.
 *
 * Written as a loop because the difference between them genuinely is one
 * string: five near-identical bindings would be five places to fix the next
 * time the call shape changes, and the fifth is the one that gets missed.
 */
function graphSteps(): Bindings {
	const steps: Array<[string, string, string]> = [
		["core:provider/graph-pre-filter@1", "preFilter", "graph:pre-filter"],
		[
			"core:provider/graph-node-resolution@1",
			"nodeResolution",
			"graph:node-resolution"
		],
		[
			"core:provider/graph-perspective@1",
			"perspective",
			"graph:perspective"
		],
		[
			"core:provider/graph-node-description@1",
			"nodeDescription",
			"graph:node-description"
		],
		[
			"core:provider/graph-state-detection@1",
			"stateDetection",
			"graph:state-detection"
		]
	]

	return Object.fromEntries(
		steps.map(([typeId, field, label]) => [
			typeId,
			async (input: any, ctx: any) => {
				const result: any = await ctx.call({
					systemPrompt: input?.prompts?.[field] ?? "",
					scenes: input?.scenes ?? [],
					label
				})
				if (!result?.text)
					return halt(`the model returned nothing for ${label}`)
				return ok({
					main: result.json ?? result.text,
					result: result.json ?? result.text
				})
			}
		])
	) as Bindings
}

/** Which type ids core can actually run today, for the diagnostics screen. */
export const boundTypeIds = () => Object.keys(coreBindings())
