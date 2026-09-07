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
	fuseRanks,
	disjointOrderings
} from "$lib/server/pipelines/ranking/strategy"
import { select } from "$lib/server/pipelines/ranking/select"
import {
	entityDocFreq,
	entityRarity,
	entitySearch,
	DEFAULT_ENTITY_WEIGHT
} from "$lib/server/pipelines/ranking/entitySearch"
import {
	linkNote,
	rankEntityLinks,
	type EntityLinkHit
} from "$lib/server/pipelines/ranking/entityLink"
import { buildScanWindow } from "$lib/server/pipelines/ranking/signals"
import {
	rankSemantic,
	mergeWindows
} from "$lib/server/pipelines/ranking/semantic"
import { queryWindows } from "$lib/server/pipelines/ranking/ragQuery"
import {
	DEFAULT_SIGNAL_WEIGHTS,
	PRIORITY_SCORE_BONUS,
	isLexicalScoring,
	withDefaults,
	type MechanismWeights,
	type SignalWeights,
	type RetrievalBand
} from "$lib/server/pipelines/ranking/weights"
import { allocate, render } from "$lib/server/pipelines/prompt/assemble"
import {
	CORE_TEMPLATE_ENGINE,
	type RenderRun
} from "$lib/server/pipelines/prompt/renderers"
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
import { promptFormatOf } from "$lib/shared/constants/PromptFormats"

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
	// The admission gate's one control. Read here rather than declared and
	// left — the whole point of this seam is that a number a panel accepted
	// reaches the code that acts on it, and this file is where the last two
	// dead retrieval controls were found not doing that.
	if (
		typeof params.admitThreshold === "number" &&
		Number.isFinite(params.admitThreshold)
	)
		retrieval.admitThreshold = params.admitThreshold
	// The three lexical-quality controls, read here for the reason above it.
	// `isLexicalScoring` and not `typeof === "string"`: this is a stored value
	// off a row, and an unrecognised one has to fall through to the default
	// rather than reach `keywordQuery` as a mode nothing implements — where it
	// would be read as "not balanced" and silently mean the default anyway,
	// with no way to tell that from somebody having chosen it.
	if (isLexicalScoring(params.lexicalScoring))
		retrieval.lexicalScoring = params.lexicalScoring
	if (
		typeof params.trigramFolding === "number" &&
		Number.isFinite(params.trigramFolding)
	)
		retrieval.trigramFolding = params.trigramFolding
	if (
		typeof params.titleWeight === "number" &&
		Number.isFinite(params.titleWeight)
	)
		retrieval.titleWeight = params.titleWeight
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
	["signalProximity", "proximity"],
	["signalSemantic", "semantic"],
	["signalEntityVector", "entityVector"],
	["signalPriorityBonus", "priorityBonus"]
]

function signalsFrom(
	params: any
): Partial<Record<RetrievalBand, SignalWeights>> | null {
	const carried = SIGNAL_FIELDS.filter(
		([param]) => params[param] && typeof params[param] === "object"
	)
	if (!carried.length) return null
	const signals: Partial<Record<RetrievalBand, SignalWeights>> = {}
	for (const source of Object.keys(DEFAULT_SIGNAL_WEIGHTS) as RetrievalBand[]) {
		const set = { ...DEFAULT_SIGNAL_WEIGHTS[source] }
		for (const [param, signal] of carried) {
			const v = params[param][source]
			if (typeof v === "number" && Number.isFinite(v)) set[signal] = v
		}
		signals[source] = set
	}
	return signals
}

/**
 * The three mechanism strengths, `mechanismWeights` → `RankingParams.mechanisms`.
 *
 * Read key by key rather than passed through, because the stored value is JSON
 * off a row and a missing or non-numeric member must fall back to 1 — neutral —
 * rather than to `undefined`, which the score would multiply into `NaN` and
 * silently zero every candidate. `withDefaults` merges what comes back over
 * `DEFAULT_MECHANISMS`, so an absent field is *not* the same as a zero.
 *
 * Negative is clamped for the reason `admitThreshold` and `trigramFolding` are:
 * a mechanism worth less than nothing would let a match *subtract* from a score,
 * and the plan's second governing rule is that adding a mechanism may only add
 * matches.
 */
function mechanismsFrom(params: any): Partial<MechanismWeights> | null {
	const raw = params?.mechanismWeights
	if (!raw || typeof raw !== "object") return null
	const out: Partial<MechanismWeights> = {}
	for (const key of ["keyword", "semantic", "name"] as const) {
		const v = raw[key]
		if (typeof v === "number" && Number.isFinite(v)) out[key] = Math.max(0, v)
	}
	return Object.keys(out).length ? out : null
}

function rankingParamsFrom(params: any) {
	if (!params || typeof params !== "object") return {}
	const out: Record<string, unknown> = {}
	const groups: Record<string, unknown> = {}
	if (params.share) groups.share = params.share
	if (params.maxEntries) groups.maxEntries = params.maxEntries
	/**
	 * ⚠ **`messages` only, whatever the stored object holds** — ruling R6.
	 *
	 * The declaration names one band now, so nothing can *write* a lore floor.
	 * A config seeded before R6 still holds the five-key object it was given,
	 * though, and migration 0201 rewrites those — this reads one key so that the
	 * removal does not depend on a migration having run. A floor is the one
	 * mechanism that can re-admit a candidate the ranker turned down, so "it
	 * probably got cleaned up" is not a good enough answer.
	 */
	if (params.minEntries && typeof params.minEntries === "object") {
		const messages = params.minEntries.messages
		if (typeof messages === "number" && Number.isFinite(messages))
			groups.minEntries = { messages }
	}
	if (Object.keys(groups).length) out.groups = groups
	const signals = signalsFrom(params)
	if (signals) out.signals = signals
	const mechanisms = mechanismsFrom(params)
	if (mechanisms) out.mechanisms = mechanisms
	return out
}

/**
 * The allocation precedence, read separately from everything above.
 *
 * Not part of `rankingParamsFrom` because it is not part of `RankingParams`,
 * deliberately: `select`'s own docblock argues that a switch between two
 * implementations of one function does not belong beside the weights it is
 * choosing between. This seam is where the declaration meets the call, which is
 * exactly what `retrievalParamsFrom` is for the lore lanes.
 *
 * `=== true` rather than truthiness. A config value is JSON that came off a
 * row, and every other reading of `"false"` or `0` in that position turns the
 * inversion **on** — which is the one direction a misread must not go, because
 * a default-off control that switches itself on during an upgrade changes what
 * reaches the model on an install that never asked.
 */
function scoreLedFrom(params: any): boolean {
	return params?.scoreLedAllocation === true
}

/**
 * Tokens the context may occupy, from the window the reply will be sent
 * against.
 *
 * Derived, never typed. The window and the reply's allowance are both
 * parameters of the sampling config the reply will be sent under, so the whole
 * calculation is `context - response - drift`. The node used to declare its own
 * `reserveForReply` defaulting to 512 next to a `responseTokens` defaulting to
 * 512 — one number with two homes, free to disagree with the model actually
 * being called, warning nobody when it did.
 */
function contextBudgetFrom(input: any) {
	// Already the *values*, not a `sampling_configs` row: the executor resolves
	// a `sampling` slot through the world's config values. So a key missing here
	// is a parameter switched off, and the fallbacks below are what applies.
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
 * ⚠ **`castEntityNames` was here and is gone** — plan phase 3.
 *
 * It built the bare-string cast list `entityCooccurrenceSignal` matched by
 * substring, and it carried a careful argument for keeping *aliases out*: the
 * signal returned 1 on the first hit, so a name short enough to fall inside an
 * ordinary word made it fire on nearly everything, and every name added raised
 * the false-positive rate for all of them.
 *
 * That argument was about the matcher, and the matcher changed. `castEntityRefs`
 * below matches on word boundaries and resolves each hit to a row, so `Al` does
 * not fire on `Alchemy` and a character's name, nickname and absorbed aliases
 * are one entity rather than four — which is why it can carry the aliases the
 * old list could not. It is a strict superset of what this returned, so the
 * scoring signal loses no cast member by reading it instead.
 *
 * The `absorbedAliases` caution that shaped the old list still holds and is now
 * satisfied rather than avoided: `session_cast` carries that column, so both
 * halves of the union its schema note makes mandatory reach this seam.
 */

/**
 * The cast, with the row each name belongs to — the gazetteer's first tier.
 *
 * **The only cast input the keyword mechanism has**, since plan phase 3 retired the
 * bare-string list beside it. It feeds the admission gate *and* the entity
 * scoring signal, which is the point: one vocabulary, matched one way, so the
 * two cannot disagree about whether the scene named somebody. It matches on a
 * word boundary and carries the row id, so a character's name and her nickname
 * are one entity instead of two and the count of distinct shared entities means
 * what it says.
 *
 * ⚠ **Aliases are in, and the union is why they could not be before.** Two of
 * the three exclusions still stand — no fuzzy matching, no reaching past the
 * session's cast — but the third was never about aliases being risky. It was
 * that `characters.aliases` / `personas.aliases` ride on the cast rows while the
 * other half, `lorebook_bindings.absorbedAliases`, did not reach this seam, and
 * that column's schema note makes reading **both** mandatory: feeding one side
 * would let an absorbed identity resolve while the name it was merged into did
 * not. `session_cast` carries `absorbedAliases` now, so both halves are here.
 * The word boundary in `compileMatcher` retires the other old argument — "Al"
 * does not fire on "Alchemy" — so nothing is left in the way.
 *
 */
function castEntityRefs(cast: any): Array<{
	name: string
	ref: { kind: "character" | "persona" | "entry"; id: number }
}> {
	const out: Array<{
		name: string
		ref: { kind: "character" | "persona"; id: number }
	}> = []
	const add = (
		name: unknown,
		ref: { kind: "character" | "persona"; id: number }
	) => {
		const trimmed = typeof name === "string" ? name.trim() : ""
		if (trimmed && Number.isFinite(ref.id)) out.push({ name: trimmed, ref })
	}
	const list = (value: unknown): unknown[] =>
		Array.isArray(value) ? value : []
	for (const cc of cast?.sessionCharacters ?? []) {
		const id = cc?.character?.id
		if (id == null) continue
		const ref = { kind: "character" as const, id }
		add(cc?.character?.name, ref)
		add(cc?.character?.nickname, ref)
		for (const alias of list(cc?.character?.aliases)) add(alias, ref)
		for (const alias of list(cc?.absorbedAliases)) add(alias, ref)
	}
	for (const cp of cast?.sessionPersonas ?? []) {
		const id = cp?.persona?.id
		if (id == null) continue
		const ref = { kind: "persona" as const, id }
		add(cp?.persona?.name, ref)
		for (const alias of list(cp?.persona?.aliases)) add(alias, ref)
		for (const alias of list(cp?.absorbedAliases)) add(alias, ref)
	}
	return out
}

/**
 * The declined entries, each carrying what it said when it was declined.
 *
 * A candidate reaches the receipt with its whole row on `payload`, so its
 * fingerprint (`host.ts` `toLoreEntry`) travels for free. A **skip** is three
 * fields — id, source, reason — and travels with none, which would have left
 * exactly the rows a reader most often asks about ("why did this not come in")
 * as the only ones the explanation could not date. So it is copied across here,
 * from the pool the scan was handed, rather than by asking `keywordQuery` to
 * carry a field it has no use for.
 *
 * Absent when the pool has no such row — a skip whose entry the read withheld —
 * and absent reads downstream as *nothing claimed*, never as *unchanged*.
 */
function withFingerprints(skipped: any[], entries: any[] | null | undefined) {
	const fingerprintOf = new Map<string, string>()
	for (const e of entries ?? [])
		if (typeof e?.fingerprint === "string")
			fingerprintOf.set(`${e.source}:${e.id}`, e.fingerprint)
	if (!fingerprintOf.size) return skipped
	return skipped.map((s: any) => {
		const fingerprint = fingerprintOf.get(`${s?.source}:${s?.id}`)
		return fingerprint ? { ...s, fingerprint } : s
	})
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
	const [entries, messages, embedding, cast] = await Promise.all([
		ctx.read("lorebook_entries", {
			sessionId: input?.scope?.sessionId,
			currentCharacterId: input?.scope?.currentCharacterId ?? null
		}),
		ctx.read("session_messages", {
			sessionId: input?.scope?.sessionId,
			limit: input?.limit ?? 100
		}),
		ctx.read("embedding_status", {}),
		// The cast is read for its names alone — see `castEntityRefs`. A
		// session that no longer exists reads as `null` here and scores the
		// signal 0 for every entry, which is what an empty cast means anyway.
		ctx.read("session_cast", { sessionId: input?.scope?.sessionId })
	])

	const result = keywordQuery({
		entries: entries ?? [],
		messages: messages ?? [],
		entityRefs: castEntityRefs(cast),
		retrieval: params.retrieval,
		// ⚠ Nothing about retrieval *routing* is handed to the scan any more.
		// The node's `retrievalMode` went in migration 0203 and the per-entry
		// `retrieval_strategy` column in 0204, and `availability` went with the
		// second because reading it was the gate's only purpose here. Every
		// mechanism runs; one this install cannot run subtracts its signal and
		// says so in `diagnostics` below, which is why `embedding` is still read.
		// The run's tokenizer, not this binding's opinion of one. A candidate
		// counted here is spent against a budget by the ranker and allocated
		// over by Assemble, and all three have to be measuring in the same
		// units — see `TaskCtx.countTokens`.
		countTokens: (text: string) => ctx.countTokens(text)
	})

	const mine = normaliseTfidf(result.candidates).filter(
		(c: any) => c.source === source
	)
	const mineSkipped = withFingerprints(
		(result.skipped ?? []).filter((s: any) => s.source === source),
		entries
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
			// The admission gate's own line. `admittedByEvidence` counts the
			// whole scan rather than this source's share of it — the scan is
			// shared and the filter is this node's, so a per-source count would
			// need the gate to record which source each admission belonged to
			// for a number nothing distinguishes today.
			admitThreshold: result.diagnostics.admitThreshold,
			admittedByEvidence: result.diagnostics.admittedByEvidence,
			entities: result.diagnostics.entities,
			extractorVersion: result.diagnostics.extractorVersion,
			// Named in the result so "why did RAG not run" is answerable from
			// the receipt rather than from the embedding settings screen.
			vectorSearch: embedding?.available
				? `available (${embedding.model})`
				: (embedding?.reason ?? "unavailable")
		}
	})
}

/**
 * The two names a history entry answers to.
 *
 * `lorebook_entries` publishes `history`; the vector index publishes
 * `historyEntry`, and that spelling is load-bearing rather than cosmetic — the
 * semantic ranker matches `sourceBudget` keys literally and the SDK declares
 * them as frozen member keys, so renaming either vocabulary is a registry
 * re-projection. They are reconciled here instead, at the one place the two
 * have to agree: without it a vector hit never finds its lore row, and a
 * history entry withheld by the lore read reads here as "not lore, nothing to
 * honour" and is published anyway.
 *
 * ⚠ That is now the *only* thing this mapping decides, and today nothing
 * withholds a history row — `lorebook_entries` withholds character lore alone —
 * so the `historyEntry` line has no observable effect until something does.
 * It is kept rather than trimmed because the thing that will is named in the
 * plan: phase 7's clairvoyance filter excludes on knowledge, for every source.
 * Its second reader, `entityVectorArm`'s pool, keys off the same two
 * vocabularies.
 */
const VECTOR_SOURCE_ALIASES: Record<string, string> = {
	historyEntry: "history"
}

/**
 * Which sources `lorebook_entries` is authoritative for, in its own spelling.
 *
 * A hit from one of these that has no row in that read was *withheld* by it —
 * character lore belonging to someone other than the speaker, today — and
 * absence is the answer rather than the absence of one. Everything else
 * (messages, graph nodes, cast rows) has no lore row to find and no strategy to
 * honour.
 */
const LORE_SOURCES = new Set(["worldLore", "characterLore", "history"])

/**
 * The index's spelling for a source, as the budget group that pays for it.
 *
 * `select` allocates against the five bands; the vector mechanism's
 * candidates carry the vector index's own vocabulary, and only `worldLore` and
 * `characterLore` happen to be spelled the same in both. Without this, a
 * semantic-mechanism spec — `vector-search → rank-semantic → rank-hybrid`, the shape
 * the RAG parity harness and the SDK use-cases document — reached the ranker
 * with every message, history entry and relationship in a spelling no group
 * owned, and `select` dropped the lot as `excluded_unknown_source`. Assemble
 * keys its `worldLore` / `history` / `characterLore` sections off the same five
 * names, so a survivor would have rendered nowhere either.
 *
 * ⚠ Applied at the entry to `rank-hybrid` and nowhere earlier. `rank-semantic`
 * matches `sourceBudget` keys against the *index* vocabulary literally
 * (`weights.ts DEFAULT_SEMANTIC`), a `S.json` in-port makes it legal to wire
 * after `core:task/merge-candidates@1`, and the documented semantic chain has
 * no merge node at all — so the merge is neither early enough nor reliably
 * present. Ranking is the last node before the budget, and the first that has
 * to know about it.
 *
 * ⚠ Deliberately three entries, not six. `narrativeNode`, `character` and
 * `persona` have no band to map onto — inventing one is a budget-share
 * decision, not a spelling fix — so they keep being excluded, now visibly, with
 * a reason on the receipt. The original spelling survives on the candidate's
 * `payload`, which is the vector hit as it arrived.
 *
 * Separate from `VECTOR_SOURCE_ALIASES` although they agree on `historyEntry`
 * today. That one answers "which lore row is this hit", and is read against a
 * `lorebook_entries` result and `LORE_SOURCES`; this one answers "which budget
 * pays for it". Folding them together would mean the three sources above join
 * the lore-row lookup the moment somebody settles their budget group, which is
 * an unrelated question with a different right answer.
 */
const BUDGET_GROUP_ALIASES: Record<string, string> = {
	message: "messages",
	historyEntry: "history",
	narrativeRelationship: "relationships"
}

/**
 * Nothing to do for the keyword mechanism: its candidates already carry budget
 * vocabulary, and none of the three keys above is a band spelling, so a
 * mixed pool off the merge passes through unchanged.
 */
function toBudgetGroups(candidates: any[]): any[] {
	return candidates.map((c: any) => {
		const group = BUDGET_GROUP_ALIASES[c?.source]
		return group === undefined ? c : { ...c, source: group }
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

/**
 * @param run Which run these bindings are executing for.
 *
 * Only the two rendering nodes read it, and only so a template that names a
 * *plugin's* engine renders as a hook call cancelling the run can find (see
 * `RenderRun`). It is a parameter rather than something read off `ctx` because
 * the SDK's `TaskCtx` carries no run id — a Task is told its inputs and nothing
 * about the machine around it — so `runTurn` supplies it at the one place that
 * has both the run and the binding table. Absent for a caller with no run: the
 * parity harness, `boundTypeIds`, and a test poking one binding directly.
 */
export function coreBindings(run: RenderRun = {}): Bindings {
	const bindings: Bindings = {
		// ── Inputs ──────────────────────────────────────────────────────────
		// An Input node does not fetch; it names what the trigger already
		// carried. Core hands the trigger payload in as the run's input, so the
		// binding is the identity — and that is not a placeholder, it is what an
		// Input *is* (01 §2).
		"core:input/user-message@1": async (input: any) => ok(input),
		"core:input/message-created@1": async (input: any) => ok(input),
		"core:input/session-created@1": async (input: any) => ok(input),

		// ── Queries ─────────────────────────────────────────────────────────
		/**
		 * The create pipeline's read (24 §12, T8): what the cast wants to say
		 * first. The host owns the implementation (interpolation, group
		 * greetings, the fallback line) — see sessions/greetings.ts.
		 */
		"core:query/session-greetings@1": async (input: any, ctx: any) => {
			const greetings = await ctx.read("session_greetings", {
				sessionId: input?.scope?.sessionId
			})
			return ok({ main: greetings, greetings })
		},

		"core:query/session-history@1": async (input: any, ctx: any) => {
			const messages = await ctx.read("session_messages", {
				sessionId: input?.scope?.sessionId,
				limit: input?.limit ?? 100,
				// Which lane builds this context (20 §7). 'main' is the chat
				// log and today's exact behaviour; another value is a mode's
				// declared channel, read on purpose by the pipeline that wants
				// it.
				channel: input?.params?.channel ?? input?.channel ?? "main"
			})
			// `main` and `messages` carry the same value on purpose: `main` is what
			// an unrefined `$.history` resolves to, and having it be the useful
			// thing rather than a wrapper is what makes the scope sugar read well.
			return ok({ main: messages, messages })
		},

		/**
		 * The keyword mechanism. Reads rows, matches strings, reaches no network
		 * (16 §1) — vector similarity is the other mechanism's job.
		 *
		 * `hits` carries the candidates and `skipped` carries what this mechanism
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
			const [entries, messages, embedding, cast] = await Promise.all([
				ctx.read("lorebook_entries", {
					sessionId: input?.scope?.sessionId,
					currentCharacterId: input?.scope?.currentCharacterId ?? null
				}),
				ctx.read("session_messages", {
					sessionId: input?.scope?.sessionId,
					limit: input?.limit ?? 100
				}),
				ctx.read("embedding_status", {}),
				// See the other keyword mechanism: read for its names alone.
				ctx.read("session_cast", {
					sessionId: input?.scope?.sessionId
				})
			])

			const result = keywordQuery({
				entries: entries ?? [],
				messages: messages ?? [],
				entityRefs: castEntityRefs(cast),
				retrieval: params.retrieval,
				// ⚠ No `availability` either — see the other keyword mechanism.
				// `embedding` is still read, and read for the diagnostics line
				// below alone: what this mechanism found must not depend on whether a
				// model is loaded, and the surest way to hold that is to hand it
				// nothing to branch on.
				// See the note on the other keyword mechanism: one instrument.
				countTokens: (text: string) => ctx.countTokens(text)
			})

			const candidates = normaliseTfidf(result.candidates)
			return ok({
				main: candidates,
				hits: candidates,
				skipped: withFingerprints(result.skipped ?? [], entries),
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
		 * The vector mechanism.
		 *
		 * Takes a query vector — produced by the embed Provider, because a Query
		 * may not reach a model (16 §1) — and asks the host for semantically
		 * near candidates. Cosine ranking happens host-side so candidate vectors
		 * never travel along a data edge; what arrives here is an id, a score and
		 * the text.
		 *
		 * ## It contributes a **signal**, not an ordering
		 *
		 * Its candidates carry `signals.semantic` and no `presetScore`, and that
		 * one line is the difference between the mechanism adding to the ranker and
		 * replacing it. `select`'s `scoreOf` prefers `presetScore` over the
		 * weighted sum, so a mechanism that stamped its raw cosine there and was wired
		 * into `rank-hybrid` would order the whole pool by cosine and make all
		 * ten signal weights inert — which is exactly what
		 * `core:task/merge-candidates@1` did to the three lore lanes until spec
		 * 1.17.0, and is why `core:task/concat-candidates@1` exists.
		 *
		 * Nothing that legitimately reads `presetScore` loses anything by its
		 * absence: `merge-candidates` and `rank-semantic` both fuse **ranks**,
		 * not scores, and both stamp their own result on the way out. So the
		 * documented semantic chain — `vector-search → rank-semantic →
		 * rank-hybrid` — is untouched, and the shape that was silently broken
		 * (`vector-search → rank-hybrid`) is the one that now works.
		 */
		"core:query/vector-search@1": async (input: any, ctx: any) => {
			/**
			 * ⚠ **0 is off, and is the shipped default** — the
			 * `maxRecursionDepth` / `admitThreshold` convention, and the same
			 * one the entity mechanism uses. Returned before the reads rather than
			 * after them: a mechanism nobody asked for should cost nothing, not a
			 * candidate fetch it then throws away.
			 */
			const maxEntries = Math.max(
				0,
				Number(input?.params?.maxEntries) || 0
			)
			const off = (reason: string) =>
				ok({
					main: [],
					lists: [],
					hits: [],
					similarity: [],
					skipped: [],
					diagnostics: { vectorSearch: reason, truncated: [] }
				})
			if (maxEntries === 0)
				return off("off — no entries requested (maxEntries is 0)")

			const embedding = await ctx.read("embedding_status", {})
			if (!embedding?.available)
				return off(embedding?.reason ?? "unavailable")

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

			// The lore read is the *visible* set, so intersecting against it is
			// what keeps the two mechanisms answering to one visibility rule. It is
			// applied to what came back rather than pushed into the query,
			// because the host does retrieval and not policy.
			//
			// A set rather than a map since migration 0204: the entry rows were
			// looked up to read `retrieval_strategy` off them, and membership is
			// the only question left.
			const visible = new Set(
				(entries ?? []).map((e: any) => `${e.source}:${e.id}`)
			)
			const skipped: any[] = []
			const excluded = new Set<string>()
			const isEligible = (hit: any) => {
				const source = VECTOR_SOURCE_ALIASES[hit.source] ?? hit.source
				const key = `${source}:${hit.id}`
				if (excluded.has(key)) return false
				if (!visible.has(key)) {
					// A hit with no lore row at all is a message, a graph node
					// or a cast row: nothing to honour, always eligible.
					if (!LORE_SOURCES.has(source)) return true
					// ⚠ A lore row the read declined to return, on the other
					// hand, is a decision — `lorebook_entries` withholds
					// character lore that is not the speaker's own. Reading
					// that absence as "not lore" published every character's
					// private self-knowledge through this mechanism whoever was
					// speaking, because the host filters and the vector index
					// does not.
					excluded.add(key)
					skipped.push({
						id: hit.id,
						source: hit.source,
						reason: "not visible to the current speaker"
					})
					return false
				}
				// ⚠ **Visibility is the only exclusion this mechanism may make.**
				// There was a second one here: the entry's own
				// `retrieval_strategy`, which kept a `keyword` entry out of
				// this mechanism with a model loaded and a cosine of 1. Migration
				// 0204 dropped the column and the check with it — a mechanism
				// switched off for a candidate is the exclusion the plan's
				// second governing rule forbids, whoever set the switch.
				//
				// So an entry the read returned is eligible, full stop. Do not
				// add a third branch: a per-entry mechanism preference belongs
				// on the score as a weight, where it subtracts a contribution
				// and leaves the candidate where every other mechanism and the
				// receipt can still see it. See `ranking/strategy.ts`.
				return true
			}

			/**
			 * The best cosine any of the query vectors gave this row.
			 *
			 * `result.candidates` is the *union* of the per-vector lists with
			 * the first occurrence kept, so a hit's own `score` is its
			 * similarity to whichever vector happened to rank it first — an
			 * arbitrary choice when the mechanism produces an ordering to be fused
			 * downstream, and the wrong number when it produces a *signal*.
			 * "How close is this entry to anything the scene is currently
			 * saying" is a maximum, not a first.
			 *
			 * Built from `lists`, which is what carries the per-vector scores;
			 * a row absent from every list keeps its own score.
			 */
			const bestScore = new Map<string, number>()
			for (const list of result?.lists ?? [])
				for (const hit of list ?? []) {
					const key = `${hit.source}:${hit.id}`
					const score = Number(hit.score)
					if (!Number.isFinite(score)) continue
					const seen = bestScore.get(key)
					if (seen === undefined || score > seen)
						bestScore.set(key, score)
				}

			const toCandidate = (hit: any) => ({
				id: hit.id,
				source: hit.source,
				// The vector mechanism builds candidates itself rather than through
				// keywordQuery, so it is the one place the two mechanisms could have
				// gone on measuring differently.
				tokens: ctx.countTokens(hit.content ?? ""),
				/**
				 * ⚠ **The cosine lands here and no longer on `presetScore`.**
				 *
				 * It used to be both: a `signals: {}` and a `presetScore:
				 * hit.score`, described as "kept for the merge's ordering, not
				 * for the weighted sum". The merge does not read it — both
				 * `merge-candidates` and `rank-semantic` fuse *ranks* and stamp
				 * their own score on the way out — so the only consumer it ever
				 * had was `select`'s `scoreOf`, which prefers `presetScore` over
				 * the weighted sum. A `vector-search → rank-hybrid` chain
				 * therefore ordered the entire pool by raw cosine with all ten
				 * signal weights inert, silently, and that is the shape the
				 * shipped reply pipeline now uses.
				 *
				 * As a signal it *adds* instead: an entry the keyword scan also
				 * found keeps its keyword signals and gains this one, so two
				 * mechanisms agreeing outrank either alone without a fusion step
				 * to reconcile two incomparable scales.
				 */
				signals: {
					semantic:
						bestScore.get(`${hit.source}:${hit.id}`) ??
						(Number.isFinite(Number(hit.score))
							? Number(hit.score)
							: 0)
				},
				priority: hit.priority ?? 1,
				payload: { ...hit, foundBy: "vector-search" }
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
			const eligible = fusedAll.filter((hit: any, index: number) => {
				if (!isEligible(hit)) return false
				keptIndices.push(index)
				return true
			})
			/**
			 * ⚠ **The cap bounds `main`/`hits` and nothing else**, and the two
			 * things it deliberately leaves alone are the reason it can.
			 *
			 * `lists` are the per-query orderings `core:task/rank-semantic@1`
			 * fuses; cutting them would change *which* entries that fusion sees
			 * rather than how many this mechanism hands to a ranker. And `similarity`
			 * stays indexed against the whole eligible fused order — which is
			 * the order `rrfMerge(lists)` produces, by construction — so the
			 * chain that reads both keeps them lined up.
			 *
			 * `hits` is then a **prefix** of that order, so `similarity[i][j]`
			 * still describes `hits[i]` and `hits[j]` for everything the cap
			 * kept. Truncating the matrix as well would have looked tidier and
			 * quietly desynchronised it from `lists`, and an off-by-one in a
			 * similarity matrix diversifies against the wrong candidates
			 * silently and only when something was cut.
			 */
			const flat = eligible.slice(0, maxEntries).map(toCandidate)
			const matrix: number[][] = keptIndices.map((r) =>
				keptIndices.map((c) => result?.similarity?.[r]?.[c] ?? 0)
			)

			return ok({
				main: flat,
				hits: flat,
				lists,
				// Indexed against the eligible fused order — the order
				// `rrfMerge(lists)` reproduces — of which `hits` is a prefix.
				// The projection above is what makes that true rather than
				// conventional.
				similarity: matrix,
				skipped,
				diagnostics: {
					vectorSearch: `available (${embedding.model})`,
					maxEntries,
					queries: lists.length,
					considered: (result?.candidates ?? []).length,
					matched: flat.length,
					/** Eligible hits the cap turned away, so a low cap is visible. */
					overCap: Math.max(0, eligible.length - flat.length),
					/**
					 * Which sources the candidate fetch could not read whole.
					 *
					 * `considered` above counts what this mechanism ranked; it says
					 * nothing about what was never fetched. The candidate query
					 * is capped per source and orders by id rather than by
					 * similarity — no pgvector index — so a listed source
					 * offered its newest `fetched` rows out of `available`, and
					 * the turn's best match may be in the remainder. Empty on
					 * any normal turn, and reported rather than inferred
					 * because a truncated retrieval and a complete one produce
					 * results that look exactly alike.
					 */
					truncated: result?.truncated ?? [],
					/**
					 * What the eager index pass did before this search ran.
					 *
					 * Lifted explicitly, not splatted: this mechanism's `diagnostics`
					 * is assembled here from named host fields, and a slow turn
					 * or a partially-covered scope has to be explicable rather
					 * than merely true.
					 */
					indexing: result?.indexing
				}
			})
		},

		/**
		 * The entity mechanism — design §13.5, and the third peer of keyword and
		 * vector.
		 *
		 * It retrieves on *what the scene is naming*: the entities of the recent
		 * window, intersected with the entities every lorebook entry and every
		 * earlier message was annotated with. No keys, no embedding model, no
		 * network — §11's zero-cost path holds.
		 *
		 * ## Why it is a peer and not a signal
		 *
		 * The improved overlap already feeds *admission* inside the keyword
		 * scan (`admitThreshold`), and it could have stopped there. It does not,
		 * because plan Part 5 rules NER *"a first-class strategy on the same
		 * footing, over messages as well as entries"* and the message half is
		 * unreachable from inside a scan that only reads a window. This is the
		 * first retrieval over conversation history in the product.
		 *
		 * ## Two out-ports, budgeted apart
		 *
		 * `main`/`hits` are lore candidates, in their entries' own bands.
		 * `messages` is the transcript half, in the `messages` band, and the
		 * shipped spec deliberately does **not** wire it into `rank` — nothing
		 * renders a ranked message today (`assemble` builds the transcript from
		 * `lines`), so budget spent there would buy nothing. See the note in
		 * `respond.ts`.
		 *
		 * ## The privacy gate is the lore read's, not a second one
		 *
		 * The visible entry ids come from `ctx.read("lorebook_entries")`, which
		 * has already withheld character lore belonging to someone other than
		 * the speaker. The entity read is handed those ids and annotates exactly
		 * them — so this mechanism answers to the same visibility rule the other two
		 * do, by construction rather than by a rule restated a third time.
		 */
		"core:query/entity-search@1": async (input: any, ctx: any) => {
			const params = input?.params ?? {}
			const maxEntries = Math.max(0, Number(params.maxEntries) || 0)
			const maxMessages = Math.max(0, Number(params.maxMessages) || 0)

			/**
			 * ⚠ **0 is off, in both halves** — the `maxRecursionDepth` /
			 * `admitThreshold` convention. Returning early rather than
			 * returning everything and letting the cap bite: this mechanism annotates
			 * as a side effect of running, and an install that has not asked
			 * for it should pay nothing at all, not even the write.
			 */
			if (maxEntries === 0 && maxMessages === 0)
				return ok({
					main: [],
					hits: [],
					messages: [],
					skipped: [],
					diagnostics: {
						maxEntries,
						maxMessages,
						entities: [],
						reason: "off — no entries or messages requested"
					}
				})

			const scanDepth = Math.max(
				1,
				Number(params.scanDepth) || withDefaults({}).retrieval.scanDepth
			)
			const entityWeight =
				params.entityWeight === undefined ||
				params.entityWeight === null
					? DEFAULT_ENTITY_WEIGHT
					: Math.max(0, Number(params.entityWeight) || 0)

			const [entries, messages] = await Promise.all([
				ctx.read("lorebook_entries", {
					sessionId: input?.scope?.sessionId,
					currentCharacterId: input?.scope?.currentCharacterId ?? null
				}),
				ctx.read("session_messages", {
					sessionId: input?.scope?.sessionId,
					limit: input?.limit ?? 100
				})
			])

			const rows: any[] = entries ?? []
			const history: any[] = messages ?? []
			/**
			 * The oldest message the prompt already carries verbatim.
			 *
			 * Retrieval stops there. Everything from here on is in the window
			 * `process-messages` renders, so returning one would spend the
			 * budget twice on one span — the same exclusion the vector mechanism
			 * makes with `excludeRecentMessages`. Negative ids are the
			 * uncommitted draft, which belongs to no row.
			 */
			const inPrompt = history
				.map((m: any) => Number(m?.id))
				.filter((id: number) => Number.isFinite(id) && id > 0)
			const beforeId = inPrompt.length ? Math.min(...inPrompt) : undefined

			const index = await ctx.read("entity_annotations", {
				sessionId: input?.scope?.sessionId,
				entryIds: rows.map((e: any) => e.id),
				// What the scene is about *now*, which is the guaranteed
				// window's question rather than the whole history's — see
				// `keywordQuery`, which builds its evidence profile the same
				// way and from the same default depth.
				window: buildScanWindow(history, scanDepth).raw,
				maxMessages,
				beforeId
			})

			const keysOf = new Map<number, string[]>(
				(index?.entries ?? []).map((e: any) => [e.id, e.keys ?? []])
			)
			const rarities = entityRarity(
				entityDocFreq(keysOf.values()),
				rows.length
			)

			const byId = new Map<number, any>(rows.map((e: any) => [e.id, e]))
			const loreHits = entitySearch({
				entities: index?.entities ?? [],
				pool: rows.map((e: any) => ({
					id: e.id as number,
					source: e.source as RetrievalBand,
					keys: keysOf.get(e.id) ?? [],
					priority: e.priority ?? 1
				})),
				rarities,
				signalWeights: DEFAULT_SIGNAL_WEIGHTS,
				entityWeight
			}).slice(0, maxEntries)

			const toCandidate = (hit: any, row: any) => ({
				id: hit.id,
				source: hit.source,
				tokens: ctx.countTokens(row?.content ?? ""),
				/**
				 * The measurement, in the vocabulary it belongs to — and read
				 * by the receipt rather than by `select`, which prefers
				 * `presetScore`. Both are here on purpose: the score is sized
				 * by this mechanism's own weight (§13.10 — the graded term's live
				 * range at the lore band's 0.2 would be narrower than the
				 * binary signal it improves on), and the signal is what says
				 * *what was measured* when somebody asks why this entry is in
				 * their prompt.
				 */
				signals: { entityCooccurrence: hit.evidence },
				presetScore: hit.score,
				priority: row?.priority ?? 1,
				position: row?.position ?? 0,
				payload: {
					...(row ?? {}),
					foundBy: "entity-search",
					sharedEntities: hit.shared
				}
			})

			const candidates = loreHits.map((hit) =>
				toCandidate(hit, byId.get(hit.id as number))
			)

			/**
			 * The transcript half.
			 *
			 * Scored with the **entries'** rarities, never the messages' own —
			 * §13.8, measured: rarity over a short conversation makes nearly
			 * every word look rare, and an entry about a pewterers' guild
			 * scored as high as the faction the scene was about on "of",
			 * "with" and "long". Rarity is a property of the collection being
			 * searched, and the entry pool is the one that has one.
			 */
			const messageHits = entitySearch<number>({
				entities: index?.entities ?? [],
				pool: (index?.messages ?? []).map((m: any) => ({
					id: m.id as number,
					source: "messages" as RetrievalBand,
					keys: m.keys ?? []
				})),
				rarities,
				signalWeights: DEFAULT_SIGNAL_WEIGHTS,
				entityWeight
			}).slice(0, maxMessages)

			const messageById = new Map<number, any>(
				(index?.messages ?? []).map((m: any) => [m.id, m])
			)
			const messageCandidates = messageHits.map((hit) => {
				const row = messageById.get(hit.id)
				return {
					id: hit.id,
					source: "messages",
					tokens: ctx.countTokens(row?.content ?? ""),
					signals: { entityCooccurrence: hit.evidence },
					presetScore: hit.score,
					payload: {
						id: hit.id,
						content: row?.content ?? "",
						foundBy: "entity-search",
						sharedEntities: hit.shared
					}
				}
			})

			return ok({
				main: candidates,
				hits: candidates,
				messages: messageCandidates,
				skipped: [],
				diagnostics: {
					maxEntries,
					maxMessages,
					entityWeight,
					scanDepth,
					/**
					 * The surface forms, not the keys: a receipt saying the
					 * scene is about "the Ashguard" is readable and one saying
					 * `entry:41` is an id nobody asked about.
					 */
					entities: (index?.entities ?? []).map((e: any) => e.text),
					extractorVersion: index?.extractorVersion,
					/** Which vocabulary produced them — §13.3's third identity. */
					gazetteerHash: index?.gazetteerHash,
					considered: rows.length,
					matched: candidates.length,
					messagesFound: messageCandidates.length,
					...(index?.diagnostics ?? {})
				}
			})
		},


		/**
		 * The mention detector — the query half of the entity-vector space.
		 *
		 * What the scene refers to **by describing it** rather than by naming
		 * it: *"the captain"*, *"the order"*, *"that bridge"*. A Query rather
		 * than a Task because the answer depends on the world's own vocabulary —
		 * a lower-case authored name like *"the ashguard"* has to be dropped
		 * here, since the exact matcher owns it and offering it to a vector
		 * linker as well is the first half of *"do not let entity vectors
		 * override an exact match"*.
		 *
		 * ## This node carries the mechanism's one switch
		 *
		 * `maxMentions` is **0 by default and that is off** — the
		 * `maxRecursionDepth` / `admitThreshold` convention. It is on the
		 * *first* node of the chain deliberately: switched off, this returns
		 * before it reads anything, `embed-text` is handed no texts and makes
		 * no model call, and `entity-link` returns before its own read. A mechanism
		 * nobody asked for costs nothing at all — not a message read and not an
		 * embedding, which is the cost the semantic mechanism's switch position
		 * cannot avoid and this one can.
		 *
		 * Its sibling `entity-link.maxLinks` is therefore a **ceiling and not a
		 * second switch**, and ships non-zero: a feature where two controls both
		 * default to off is one where turning the first one on appears to do
		 * nothing.
		 */
		"core:query/mention-spans@1": async (input: any, ctx: any) => {
			const params = input?.params ?? {}
			const maxMentions = Math.max(0, Number(params.maxMentions) || 0)
			if (maxMentions === 0)
				return ok({
					main: [],
					mentions: [],
					texts: [],
					diagnostics: {
						maxMentions,
						reason: "off — no mentions requested (maxMentions is 0)"
					}
				})

			const scanDepth = Math.max(
				1,
				Number(params.scanDepth) || withDefaults({}).retrieval.scanDepth
			)
			const found = await ctx.read("mention_spans", {
				sessionId: input?.scope?.sessionId,
				scanDepth,
				limit: maxMentions
			})

			const mentions: any[] = found?.mentions ?? []
			return ok({
				main: mentions,
				mentions,
				/**
				 * The strings, in the same order, for the embed Provider.
				 *
				 * A port of its own rather than letting the Provider reach into
				 * the objects: `embed-text` takes `texts`, and index alignment
				 * between what was embedded and what it described is the whole
				 * contract between these two nodes.
				 */
				texts: mentions.map((m: any) => m.text),
				diagnostics: {
					maxMentions,
					scanDepth,
					extractorVersion: found?.extractorVersion,
					/** Which vocabulary decided what was already a name. */
					gazetteerHash: found?.gazetteerHash,
					found: mentions.length,
					/** Dropped because an authored name already owned the span. */
					claimed: found?.diagnostics?.claimed ?? 0,
					mentionsFound: mentions.map((m: any) => m.text)
				}
			})
		},

		/**
		 * The entity-vector mechanism — mention → name linking (retrieval plan phase 4).
		 *
		 * A second named vector space holding one vector per **name**, queried
		 * with the descriptions the scene used. *"The captain"* finds Captain
		 * Vell; *"the order"* finds The Ashguard Riders. Neither shares a
		 * character with its target, so keys, trigrams and the gazetteer all
		 * miss them — and they are the references people actually write.
		 *
		 * ## It may only reorder. It may never admit.
		 *
		 * ⚠ **The pool is the candidates that arrive on the `candidates`
		 * in-port**, and this returns that same list with a signal attached to
		 * whatever linked. That is the enforcement of *"a link is a score
		 * contribution, never an admission on its own"*, put where a refactor
		 * cannot lose it: there is no id this node can emit that some other
		 * mechanism did not already produce.
		 *
		 * It matters because of what a wrong link is. Invented proper nouns are
		 * where embeddings are least reliable — "Vell" has no learned meaning,
		 * so its vector comes from subword fragments and Vell, Vall and Vela
		 * cluster — and a confident wrong link is worse than a miss, because it
		 * injects wrong lore at high confidence into a fixed budget where it
		 * displaces right lore. Constrained to reordering, the same wrong link
		 * costs a position and a line in the receipt that names it.
		 *
		 * ## Ruling R4: no threshold anywhere
		 *
		 * Links rank; they do not gate. What bounds the mechanism is a **count** —
		 * `maxLinks` over links ranked by match quality — never a similarity
		 * cutoff, because *"is 0.62 a match"* has no answer that survives
		 * changing the encoder.
		 *
		 * ## Wired first into the concat, with the raw list behind it
		 *
		 * `core:task/concat-candidates@1` keeps the **first** occurrence of a
		 * `source:id`, so this node's enriched copies win and the unenriched
		 * `lore.candidates` behind them is a pure fallback. Every way this mechanism
		 * can produce nothing — switched off, no embedding model, an error the
		 * executor recovered as empty — therefore lands on exactly the list the
		 * ranker would have seen without it. The governing rule holds by
		 * construction rather than by a `try`.
		 */
		"core:query/entity-link@1": async (input: any, ctx: any) => {
			const params = input?.params ?? {}
			const maxLinks = Math.max(0, Number(params.maxLinks) || 0)
			const mentions: any[] = Array.isArray(input?.mentions)
				? input.mentions
				: []
			const vectors: any[] = Array.isArray(input?.vectors)
				? input.vectors.filter(Array.isArray)
				: []
			const pool: any[] = Array.isArray(input?.candidates)
				? input.candidates
				: []

			/**
			 * ⚠ **Empty means "the ranker sees `lore.candidates` unchanged"**,
			 * not "the ranker sees nothing" — see the wiring note above. So
			 * every off state returns before any read, and none of them can
			 * cost a candidate.
			 */
			const off = (reason: string) =>
				ok({
					main: [],
					candidates: [],
					links: [],
					diagnostics: {
						maxLinks,
						mentions: mentions.length,
						linked: 0,
						entityLink: reason
					}
				})
			if (maxLinks === 0) return off("off — no links requested (maxLinks is 0)")
			// ⚠ Two states with one symptom, and the note has to admit it. The
			// mechanism's switch is `mention-spans`' `maxMentions`, which ships at 0, so
			// an empty mention list is *usually* "the mechanism is off" and not "the
			// scene described nothing" — and this node cannot tell them apart from
			// an empty array. Naming only the second reads as a false negative on
			// every default install, now that the receipt renders this line.
			if (!mentions.length)
				return off(
					"nothing to link — no descriptions were found in the window, " +
						"or the mention scan is switched off"
				)
			// Index alignment is the contract between this and the embed
			// Provider, and a short list means the model returned fewer vectors
			// than texts — pairing them by position anyway would attach one
			// mention's meaning to another's word.
			if (vectors.length !== mentions.length)
				return off(
					vectors.length === 0
						? // Both reachable, and neither is an error: `auto` reads
							// an unavailable model as an absence, and `off` on
							// the embed node declines to call one at all.
							"nothing was embedded — no embedding model is loaded, or embedding is switched off"
						: `the embedder returned ${vectors.length} vectors for ${mentions.length} mentions`
				)
			if (!pool.length) return off("no candidates to rank")

			const embedding = await ctx.read("embedding_status", {})
			if (!embedding?.available) return off(embedding?.reason ?? "unavailable")

			/**
			 * The searchable ids, taken off the pool rather than read again.
			 *
			 * This is also the privacy gate, and it is the *same* one: the
			 * candidates were produced by mechanisms whose lore read already withheld
			 * character lore belonging to somebody other than the speaker, so
			 * re-deriving visibility here would be a second implementation of
			 * that rule, free to disagree with the first.
			 */
			const byId = new Map<number, any>()
			for (const candidate of pool) {
				const id = Number(candidate?.id)
				if (!Number.isFinite(id)) continue
				if (!LORE_SOURCES.has(String(candidate?.source))) continue
				if (!byId.has(id)) byId.set(id, candidate)
			}
			if (!byId.size) return off("no lore candidates to link against")

			const found = await ctx.read("entity_link", {
				sessionId: input?.scope?.sessionId,
				entryIds: [...byId.keys()],
				mentions: mentions.map((m: any) => ({
					text: String(m?.text ?? ""),
					position: Number(m?.position) || 0
				})),
				vectors
			})

			const links = rankEntityLinks(
				(found?.hits ?? []) as EntityLinkHit[],
				maxLinks
			)
			const linkOf = new Map(links.map((l) => [l.entryId, l]))

			/**
			 * The whole pool, with the linked ones enriched.
			 *
			 * `signals` is copied rather than written into: the mechanisms upstream
			 * still hold these objects — `concat-candidates` says so in its own
			 * note — and mutating one here would change what a previous node's
			 * receipt says it produced.
			 */
			const candidates = pool.map((candidate: any) => {
				const id = Number(candidate?.id)
				const link = Number.isFinite(id) ? linkOf.get(id) : undefined
				if (!link) return candidate
				return {
					...candidate,
					signals: {
						...(candidate?.signals ?? {}),
						entityVector: link.score
					},
					payload: {
						...(candidate?.payload ?? {}),
						/**
						 * The sentence a reader gets. A vector link does not
						 * explain itself the way a keyword hit does — the entry
						 * simply appears higher — so the link travels as text
						 * and a wrong one is visible and correctable rather
						 * than lore arriving for no reason.
						 */
						entityLinks: [linkNote(link)]
					}
				}
			})

			return ok({
				main: candidates,
				candidates,
				links: links.map((l) => ({
					id: l.entryId,
					mention: l.mention,
					name: l.name,
					kind: l.nameKind,
					score: l.score,
					note: linkNote(l)
				})),
				diagnostics: {
					maxLinks,
					entityLink: `available (${embedding.model})`,
					mentions: mentions.length,
					considered: byId.size,
					linked: links.length,
					/** Readable, and the reason this mechanism is auditable at all. */
					matched: links.map((l) => linkNote(l)),
					...(found?.diagnostics ?? {})
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
		 * Fuse the two mechanisms into one ordering.
		 *
		 * Reciprocal-rank fusion, **not an average**: keyword scores are a
		 * weighted sum in roughly [0, 1.5] and vector scores are cosine in
		 * [-1, 1], so averaging would hand every turn to whichever mechanism happened
		 * to be more generous — and nobody could tell which (DECOMPOSITION §4).
		 *
		 * An entry both mechanisms found outranks one either found alone, which is what
		 * `both` is asking for: agreement between independent signals is evidence.
		 *
		 * ⚠ Which is also the precondition. Handed **disjoint** orderings there
		 * is no agreement to measure, the fused score is each entry's position
		 * in its own list, and the `presetScore` stamped below then overrides
		 * every signal weight in `select`. That is a wiring mistake rather than
		 * a data state, so it is named on the receipt — see the note on
		 * `disjoint` below, and `core:task/concat-candidates@1` for what such a
		 * pipeline meant.
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

			/**
			 * ⚠ Two or more mechanisms, and not one entry in common.
			 *
			 * Reported rather than refused, and the line between them is who
			 * would be punished. A halt here would take down a plugin or a
			 * user-authored spec mid-turn over a wiring choice that still
			 * produces candidates; the receipt is where a wiring question
			 * belongs, and this node's whole value is that it says how each
			 * candidate was found.
			 *
			 * It is not a stylistic complaint. Fusion's premise is that two
			 * mechanisms ranked the *same* pool, so agreement is evidence. With
			 * nothing in common every fused score is one list position, the
			 * `presetScore` above overrides the weighted signal sum in
			 * `select`, and the ordering that reaches the prompt is whatever
			 * order the producers happened to emit. That is exactly what the
			 * shipped reply pipeline did to its three lore lanes until spec
			 * 1.17.0, and `core:task/concat-candidates@1` is the node it
			 * wanted.
			 */
			const disjoint = disjointOrderings(orderings)
			const diagnostics = {
				orderings: orderings.length,
				fused: candidates.length,
				/**
				 * Entries more than one ordering produced — the fusion's whole
				 * subject, and the number that is zero when it had none.
				 */
				agreed: fused.filter(
					(f) => f.ranks.filter((r) => r !== undefined).length > 1
				).length,
				disjoint,
				...(disjoint
					? {
							warning:
								`${orderings.filter((o) => o.length > 0).length} orderings ` +
								`reached this merge and none of them share an entry. ` +
								`Rank fusion needs mechanisms that ranked the same pool; on ` +
								`disjoint lists it degrades to concatenation with a ` +
								`fabricated score, and the score it stamps overrides ` +
								`every signal weight downstream. Wire ` +
								`core:task/concat-candidates@1 instead.`
						}
					: {})
			}

			return ok({ main: candidates, candidates, diagnostics })
		},

		/**
		 * Several candidate lists, end to end.
		 *
		 * **Concatenation is not fusion**, and keeping them as two nodes is the
		 * whole point of this one. `core:task/merge-candidates@1` above stamps a
		 * reciprocal-rank `presetScore` on everything it passes through, which
		 * `select` prefers over the weighted signal sum — correct when two mechanisms
		 * ranked one pool and have to be reconciled, and wrong when several
		 * disjoint lanes are simply being handed on, because then the "fused"
		 * score is nothing but each entry's position in its own list.
		 *
		 * So this stamps no score. What arrives at `core:task/rank-hybrid@1`
		 * carries its signals and its source, which is what the ranker needs to
		 * score it and what the share bands need to budget between lanes.
		 *
		 * Repeats drop, first occurrence winning, keyed `source:id` — the three
		 * lore tables have independent identity sequences, so an id alone would
		 * let a world-lore row settle a history row.
		 *
		 * ## Repeats drop, but their **signals** do not
		 *
		 * First-occurrence-wins is right about the candidate and wrong about the
		 * measurements on it, and the difference is what makes several mechanisms into
		 * one score. The keyword scan and the semantic mechanism measure *different
		 * things* about the same entry: one says its keys fired, the other says
		 * it is about what is being discussed. Dropping the second copy whole
		 * would throw the second measurement away, and an entry two independent
		 * mechanisms found would score exactly as if only the first had — which
		 * is the opposite of what the retrieval plan asks for, where *"agreement
		 * across mechanisms compounds by addition and needs no fusion step"*.
		 *
		 * So a duplicate contributes any signal key the kept copy **does not
		 * already carry**, and nothing else. First-wins holds per key as well as
		 * per candidate, which is what keeps this additive rather than
		 * order-dependent:
		 *
		 *   · a keyed entry the semantic mechanism also found keeps every keyword
		 *     signal and gains `semantic`, because no other lane produces it;
		 *   · the entity mechanism's `entityCooccurrence` is **not** merged onto a
		 *     candidate the keyword scan already measured, because that mechanism
		 *     sizes it against its own weight (§13.10) and the keyword scan has
		 *     already answered the same question against the band's. Its lane
		 *     position said the same thing before this existed; now the rule
		 *     says it rather than the ordering implying it.
		 */
		"core:task/concat-candidates@1": async (input: any) => {
			const orderings: any[][] = (input?.sources ?? []).filter(
				Array.isArray
			)
			const at = new Map<string, any>()
			const candidates: any[] = []
			let duplicates = 0
			/** Candidates a later lane added a measurement to. */
			let enriched = 0
			for (const list of orderings)
				for (const candidate of list) {
					const key = `${candidate?.source}:${candidate?.id}`
					const kept = at.get(key)
					if (kept) {
						duplicates++
						let added = false
						for (const [signal, value] of Object.entries(
							candidate?.signals ?? {}
						)) {
							if (signal in kept.signals) continue
							kept.signals[signal] = value
							added = true
						}
						if (added) enriched++
						continue
					}
					// Copied, because the merge above writes into `signals` and
					// the mechanisms hand out objects they may still be holding — the
					// vector mechanism keeps its own `hits` array pointing at these.
					const own = { ...candidate, signals: { ...candidate?.signals } }
					at.set(key, own)
					candidates.push(own)
				}

			return ok({
				main: candidates,
				candidates,
				diagnostics: {
					sources: orderings.map((list) => list.length),
					duplicates,
					/**
					 * How many entries more than one mechanism found *and* measured
					 * differently. Zero with one lane wired, zero when the extra
					 * mechanisms are off, and the number that says the mechanisms are
					 * compounding when they are on.
					 */
					enriched,
					kept: candidates.length
				}
			})
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
		 * The semantic mechanism's nine stages.
		 *
		 * Pure, and separate from `rank-hybrid` on purpose: this ranks *within* the
		 * vector mechanism — fusing its per-query lists, diversifying, capping each
		 * source — and hands one ordered list on. Combining the mechanisms is the
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
					// The same per-tier bonus the keyword mechanism applies, so an
					// author's High tier means one thing across both modes.
					priorityBonus: PRIORITY_SCORE_BONUS
				})
			)

			/**
			 * ⚠ The nine stages' answer is written back onto `presetScore`, and
			 * without this line every one of them was discarded.
			 *
			 * `core:query/vector-search@1` builds its candidates with
			 * `presetScore: hit.score` — the raw cosine — so the merge downstream
			 * has an ordering to fuse. This node then re-scores them: rrf across
			 * the per-message lists, normalise, recency, priority, threshold,
			 * MMR, per-source cap. All of that lands on `score`, and `select`'s
			 * `scoreOf` reads `presetScore` first and never looks at `score`. So
			 * a `vector-search → rank-semantic → rank-hybrid` chain — the shape
			 * the SDK documents as the canonical semantic mechanism — ran the whole
			 * stack and then re-sorted the survivors by raw cosine, silently.
			 *
			 * Written here rather than inside `rankSemantic`: `presetScore` is
			 * `select`'s vocabulary, not the ranking stages', and this binding is
			 * the seam between the two. `score` is left in place beside it so the
			 * receipt still shows what each stage computed.
			 */
			const candidates = mergeWindows(
				ranked.map((r) => r.candidates)
			).map((c) => ({ ...c, presetScore: c.score }))
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
			const candidates = normaliseTfidf(
				toBudgetGroups(input?.candidates ?? [])
			)
			const selection = select(candidates, {
				// From the `budget` in-port, which `core:task/context-budget@1`
				// derives from the sampling config's window. There is no longer
				// a typed fallback: an absolute count on the node could not know
				// which model it was about to be sent to.
				availableTokens:
					input?.budget?.remaining ?? input?.availableTokens ?? 0,
				params,
				// Design §7's inversion, behind its declared switch. Passed
				// from here because this is the only runtime `select()` there
				// is — while nothing passed it, the option existed and no run
				// could reach it.
				scoreLedAllocation: scoreLedFrom(input?.params)
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
				variables: input?.variables,
				// Every layout here may be a plugin's engine, so the run rides
				// along — without it a cancelled run cannot stop them.
				...run
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
		"core:task/assemble@2": async (input: any, ctx: any) => {
			const slot = input?.template
			/**
			 * The story string, and **only** a real string.
			 *
			 * ⚠ This was `String(slot?.source ?? slot ?? "")`, and that
			 * `String(...)` was quietly load-bearing in the worst way. A slot
			 * that resolved to nothing arrives as `{}` — an empty object, not
			 * undefined — so `slot?.source ?? slot` fell through to the object
			 * itself and `String({})` produced the literal text
			 * `"[object Object]"`. Truthy, so the halt below never fired; a
			 * valid Handlebars template, so the renderer accepted it; and the
			 * whole prompt for that run was the seven characters of a
			 * stringified empty object, sent to the model as prose.
			 *
			 * It is reachable on a real install: `bootstrapPipelines` returns
			 * early on a `TypeRegistryConflictError` without writing config
			 * values, and this slot then resolves to `{}` on every run. The
			 * halt is the correct outcome, and it names the missing thing.
			 */
			const template =
				typeof slot === "string"
					? slot
					: typeof slot?.source === "string"
						? slot.source
						: ""
			if (!template)
				return halt(
					"assemble has no template — the template slot did not resolve to a " +
						"story string, so there is nothing to render into. Check that " +
						"this pipeline's configuration selects a context template."
				)

			/**
			 * The language the template is written in.
			 *
			 * A resolved row arrives as an object carrying `source` and
			 * `engine` together — `world.ts`'s `pushTemplate` emits both paths
			 * or neither, so an object with a source and no engine cannot be
			 * produced by the config layer. A bare **string** is the other
			 * case: an in-code author default, which has nowhere to record a
			 * language and is core's by construction.
			 *
			 * Anything else is a delivery fault and halts here rather than
			 * being guessed at. Guessing is what this whole change removes:
			 * `renderTemplate` used to answer "then it must be Handlebars", and
			 * that answer was wrong on every non-core template ever written,
			 * silently, for a whole release.
			 */
			const engine =
				typeof slot === "object" && slot !== null
					? slot.engine
					: CORE_TEMPLATE_ENGINE
			if (!engine)
				return halt(
					"assemble's template resolved to a row but carried no engine, so " +
						"there is no way to know what language it is written in. The " +
						"template slot must deliver `source` and `engine` together — " +
						"rendering it as Handlebars on a guess is how a foreign template " +
						"reaches the model as raw markup."
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
					// Where the reminder lands is a function of how deep the
					// messages above it are, so it is context fitting and
					// measures with the run's tokenizer like everything else
					// that decides what fits.
					tokenCounter: {
						countTokens: (t: string) => ctx.countTokens(t)
					}
				})
				postHistory = resolved.postHistory
			}

			/**
			 * The wire format this prompt is being written FOR.
			 *
			 * From the node's own `connection` slot, which every shipped spec
			 * wires to the SENDING Provider (`slot.connectionOf("generate")`) —
			 * so the format the render uses and the format the request goes out
			 * in are one value by construction, not two that must agree.
			 *
			 * ⚠ This read is the whole of the fix it belongs to. `input.
			 * promptFormat` used to be read here and no spec, no port and no
			 * slot ever supplied it: it was `undefined` on every run, so
			 * `renderers.ts` fell back to Vicuna and every ChatML, Llama-2,
			 * Alpaca and Claude connection was sent Vicuna markers — while
			 * `dispatch.ts` stamped the receipt with the connection's REAL
			 * format, so the receipt asserted a format the render had not used.
			 *
			 * `promptFormatOf` and not `??`: see its own note. A cleared
			 * `prompt_format` column is an empty string, and `"" ?? "vicuna"`
			 * is `""`, which `makeBlock` renders as ChatML.
			 *
			 * A slot that resolves to nothing — no connection registered, or a
			 * spec that did not wire it — arrives as `null`, and Vicuna is what
			 * this path has always produced in that case.
			 */
			const promptFormat = promptFormatOf(
				input?.connection?.metadata?.promptFormat
			)

			const rendered = await render({
				allocation,
				postHistory,
				template,
				// Resolved from the template slot, so a config written in a
				// plugin's engine renders with the plugin's assembler rather
				// than being run through core's (12 §2a).
				engine,
				prompts: input?.prompts,
				templateContext: input?.templateContext,
				// This node's own `variables` slot: how the lore and history
				// *it* produced are laid out. Separate from the context
				// builder's slot, because these are post-budget — what fits is
				// only known here.
				variables: input?.variables,
				messages: input?.messages ?? [],
				promptFormat,
				// The story string and this node's layouts both render here, and
				// both can be somebody's engine. Same reason as the context
				// builder above.
				...run
			})

			return ok({
				/**
				 * `promptFormat` rides the payload, and that is what makes the
				 * receipt honest rather than plausible.
				 *
				 * `toCompiledPrompt` used to derive `meta.promptFormat` from the
				 * connection it had just resolved — a second resolution, on a
				 * second path (`resolveTaskConfig`), of a question this node had
				 * already answered. The two agree on the pipeline path by
				 * construction and are free to disagree on the legacy one, where
				 * the preview renders through the world manifest and the send
				 * resolves its own row. Reporting the value that was USED
				 * removes the disagreement instead of documenting it.
				 */
				main: { ...allocation, ...rendered, promptFormat },
				context: { ...allocation, ...rendered, promptFormat },
				/**
				 * ⚠ **Allocations, not blocks** — one retrieved item each, with
				 * its verdict, where a *block* is one message (NOMENCLATURE
				 * §15). A dozen of these render into the variables inside one
				 * block, so the old name described a container's granularity.
				 *
				 * Undeclared, like `budget` beside it: `ports.out` is `main` and
				 * `context`, so nothing core wires this and no shape check
				 * reaches it. The same array rides `main`/`context` as `.blocks`
				 * — that field is the SDK's word at the seam and is deliberately
				 * left alone (assemble.ts, NOMENCLATURE §24).
				 */
				allocations: allocation.blocks,
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
		/**
		 * Embedding, and the `enabled` setting that was declared and read by
		 * nothing.
		 *
		 * `enabled: 'auto' | 'on' | 'off'` has been on this node's params slot
		 * since it was written and this binding ignored it, which put it in the
		 * dead-control family bugs 12 and 15 kept finding. It is live now because
		 * the reply pipeline needs the middle value to mean something:
		 *
		 *   · **off** — do not call at all. No vectors, no model, no cost.
		 *   · **auto** (the default) — call, and treat a failure as *no vectors*
		 *     rather than as a failed turn. Most installs have no embedding
		 *     model loaded, and the host's answer for that case is a thrown
		 *     "no embedding model is loaded and validated". Under `auto` that is
		 *     not an error, it is an absence.
		 *   · **on** — call, and let a failure be a failure. Somebody who asked
		 *     for this explicitly should hear about it.
		 *
		 * ⚠ **`auto` is the plan's second governing rule in one branch**: *an
		 * unavailable mechanism subtracts a signal; it never reroutes, disables a
		 * path, or excludes a candidate.* The reason is not tidiness — loading an
		 * embedding model once silently removed almost all lore from prompts, and
		 * the inverse (not having one costing a turn) is the same class of
		 * failure pointed the other way.
		 *
		 * The *reason* is not swallowed with the error: `core:query/vector-search@1`
		 * reads `embedding_status` itself and puts "no embedding model is loaded
		 * and validated" on the receipt, which is where a reader looks. This node
		 * has no diagnostics port and inventing one would move its content hash.
		 *
		 * A node whose `params` slot is not wired gets `undefined` here and is
		 * treated as `auto`, which is the behaviour it had before this existed.
		 */
		"core:provider/embed-text@1": async (input: any, ctx: any) => {
			const empty = ok({ main: null, vector: null, vectors: [] })
			const enabled = input?.params?.enabled ?? "auto"
			if (enabled === "off") return empty

			let result: any
			try {
				result = await ctx.call({
					text: input?.text,
					texts: input?.texts
				})
			} catch (e) {
				if (enabled === "on") throw e
				return empty
			}
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
				generatingMessageMetadata: input?.generatingMessageMetadata,
				// The node's own slots — tier 2 of
				// `capability default → pipeline config → session override`.
				//
				// Forwarded here for the same reason the `generate-image` binding
				// below forwards them, and their absence was the reason the
				// panel's Connection and Sampling pickers on the reply step were
				// decoration: the values stored, and no reader ever saw them. The
				// host resolves them; this binding only has to stop dropping them.
				connection: input?.connection ?? null,
				sampling: input?.sampling ?? null,
				// The files this step's `attachments` port carries, as media
				// REFERENCES and in order. Forwarded rather than resolved: the
				// substrate turns a uuid into bytes, having first checked it
				// against the run — a binding never sees the bytes, exactly as it
				// never sees the connection.
				attachments: input?.attachments
			})

			if (result?.isAborted)
				return halt("generation was aborted before the model finished")
			if (!result?.text)
				// The provider type used to be named here. `haltReason` is a
				// plain string on the SDK receipt, so nothing downstream can
				// take it back out again — and a non-admin reads their own
				// receipt through `pipelines:run`. The fact moves to the field
				// below, which the projection can remove.
				return halt(
					"the model returned nothing — there is no message to write"
				)

			return ok({
				main: result.text,
				text: result.text,
				thinking: result.thinking,
				// The connection *type*, not the connection: enough to answer
				// "which provider answered this turn" from the receipt, and
				// nothing that could be replayed by whoever reads it.
				//
				// Under `connection` rather than as a bare `via` string, because
				// this value IS the node's receipt output and a non-admin can
				// fetch their own receipt. Which provider the administrator runs
				// is still the administrator's business; the projection removes
				// this key for everyone else.
				connection: { type: result.via }
			})
		},

		/**
		 * The image render — the structural twin of generate-text above.
		 *
		 * Thin on purpose: it forwards the slots' resolved values and hands back
		 * the references the substrate stored. Everything that varies between
		 * backends lives in the adapter, and everything that varies between
		 * installs lives in the connection and sampling rows; there is nothing
		 * left here for a binding to decide.
		 */
		"core:provider/generate-image@1": async (input: any, ctx: any) => {
			const result: any = await ctx.call({
				prompt: input?.prompt ?? input?.main ?? "",
				negative: input?.negative,
				prompts: input?.prompts,
				connection: input?.connection,
				sampling: input?.sampling,
				init: input?.init
			})

			// Halts rather than errs, for the same reason generate-text does: a
			// cancelled render is a run with no answer, not a fault to debug.
			if (result?.isAborted)
				return halt("the render was cancelled before it finished")
			if (!result?.media?.length)
				return halt("the backend finished without returning an image")

			// What the backend honoured and what it could not, on the receipt —
			// the only way "why did changing steps do nothing" is answerable.
			ctx.reportSampling?.(
				Object.fromEntries(
					(result.applied ?? []).map((k: string) => [k, true])
				),
				result.ignored ?? []
			)

			return ok({
				main: result.media,
				media: result.media,
				image: result.image,
				caption: result.caption
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
			const style =
				input?.params?.style === "native" ? "native" : "prompt"
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
				// Deliberately the flat estimate rather than the run's
				// tokenizer. This is not context fitting: it decides how many
				// messages go into one summarization batch, a chunk size with a
				// 1500-token safety margin already subtracted from it. Making it
				// exact would change nothing a person can observe, and it would
				// make `ctx` a parameter of a binding that otherwise needs none.
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
		"core:consumer/seed-greetings@1": async (input: any, ctx: any) =>
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
