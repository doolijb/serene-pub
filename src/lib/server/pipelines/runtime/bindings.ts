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
import { ok, halt, err, roughTokens } from "@serene-pub/sdk"
/**
 * The node declarations themselves, as types.
 *
 * `import type`, so `verbatimModuleSyntax` erases it outright: importing
 * contracts for real would run `describeQueryType`'s `register()` for every core
 * type as a side effect of loading the runtime, which is the boot sequence's job
 * and not this file's.
 */
import type * as C from "@serene-pub/contracts"
import type {
	ConsumerCtx,
	CoreQueryCtx,
	NodeInput,
	ProviderCtx,
	SharedInput,
	Supplied,
	TaskCtx,
	Unsupplied,
	UnsuppliedParam
} from "./bindingTypes"
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
// The relationship mechanism (ruling 2026-09-10, Q1), in its own module — see
// the header there for why it is not written inline.
import { relationshipSearchBindings } from "./bindings.relationships"
// Stats and states, in their own module for the same reason — see its header
// for why the write does not go through a host seam.
import { stateBindings } from "./bindings.state"
import { buildScanWindow } from "$lib/server/pipelines/ranking/signals"
import { bindingNames } from "$lib/server/pipelines/ranking/entities"
import {
	proposeKeys,
	MAX_KEYS,
	MAX_TERM_KEYS
} from "$lib/server/pipelines/ranking/keyProposal"
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
import type { PostHistoryDiag } from "$lib/server/pipelines/prompt/promptTypes"
import { buildTemplateContext } from "$lib/server/pipelines/prompt/templateContext"
import {
	sceneAnchor,
	slotGuide,
	stateSummary
} from "$lib/server/pipelines/prompt/adventureContext"
import {
	buildBatchPrompt,
	buildCharacterExtractionPrompt,
	buildNamePrompt,
	buildSynthesisPrompt,
	formatMessagesAsJson,
	type JsonDraft
} from "$lib/server/utils/summarizer/templates"
import { parseSummaryOutput } from "$lib/server/utils/summarizer/parser"
import { resolveBatchBudget } from "$lib/server/utils/summarizer/batchBudget"
import { promptFormatOf } from "$lib/shared/constants/PromptFormats"
import { explicitStopsFrom } from "$lib/server/connections/stops"
import { streamingModeFrom } from "$lib/server/connections/streaming"

/**
 * The three exemption reasons more than one site shares.
 *
 * An exemption requires a sentence, and a sentence copied five times is
 * five places for the fifth copy to go stale. These are the recurring ones —
 * everything else is written at its own site, because it happens once.
 *
 * ⚠ Each is a **finding waiting to be closed**, not an exemption granted. The
 * sentence is what a later reader needs in order to decide the key can finally
 * go; that decision needs the config archaeology, which is why it is not made
 * here.
 */
type WhyTopLevelLimit =
	"a top-level message-window spelling no lore lane declares; kept so a config carried forward from an older document still resolves"
type WhyFlatSpeakerId =
	"the speaker travels inside the `scope` port; this flat spelling has no supplier and is the stored-config fallback behind it"
type WhyFlatTopic =
	"a flat spelling of `request.topic`, which is the declared port's payload"

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
	/**
	 * ⚠ The other half of the `scanDepth` split, and the one that was engine-read
	 * and declared nowhere.
	 *
	 * `keywordQuery` has always taken this off `RetrievalParams` — it is the
	 * window `speakerCooccurrenceSignal` asks "did this character speak" over,
	 * and the term-frequency window tf-idf scores against — while the only
	 * value it could ever hold was `DEFAULT_RETRIEVAL`'s hardcoded 10. Two live
	 * signals tuned by a constant nobody could reach: the same defect as a
	 * control nothing reads, pointed the other way.
	 *
	 * Clamped at 1 rather than 0. A window of zero messages makes both signals
	 * identically 0 for every entry, which is not "off" — it is the pool tied,
	 * silently, with the receipt still reporting two signals it computed.
	 */
	if (
		typeof params.guaranteedMessages === "number" &&
		Number.isFinite(params.guaranteedMessages)
	)
		retrieval.guaranteedMessages = Math.max(
			1,
			Math.floor(params.guaranteedMessages)
		)
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
	// ⚠ `signalRecency` and `signalSceneAffinity` were the two rows between
	// these — declared, transposed, scored, and weighing a signal no mechanism
	// has ever produced. Removed with their declarations; see `SignalWeights`.
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
	for (const source of Object.keys(
		DEFAULT_SIGNAL_WEIGHTS
	) as RetrievalBand[]) {
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
		if (typeof v === "number" && Number.isFinite(v))
			out[key] = Math.max(0, v)
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
function contextBudgetFrom(input: NodeInput<typeof C.contextBudget>) {
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
 * What `ctx.read("session_cast")` returns, as much of it as this file names.
 *
 * ⚠ **It was `any`, and that is what let a phantom read survive.** A property
 * misspelt on an `any` is `undefined` at runtime and silent at build, so the
 * only thing standing between this seam and a vocabulary that quietly contains
 * nothing is that somebody types the shape out. Optional and nullable
 * throughout, because the host really can return `null` here — a session that no
 * longer exists — and every field below is one a caller may not have selected.
 */
interface SessionCastRead {
	sessionCharacters?: Array<{
		character?: {
			id?: number | null
			name?: string | null
			nickname?: string | null
			aliases?: unknown
		} | null
		/** Attached by the host from `lorebook_bindings`, not a cast column. */
		absorbedAliases?: unknown
	} | null> | null
	sessionPersonas?: Array<{
		persona?: {
			id?: number | null
			name?: string | null
			aliases?: unknown
		} | null
		absorbedAliases?: unknown
	} | null> | null
	/** The book's whole roster — see `castEntityRefs`. */
	lorebookBindings?: Array<{
		characterId?: number | null
		personaId?: number | null
		name?: string | null
		aliases?: unknown
		absorbedAliases?: unknown
	} | null> | null
}

/**
 * The names this session's world answers to, with the row each belongs to —
 * the gazetteer's first tier.
 *
 * **The only cast input the keyword mechanism has**, since plan phase 3 retired the
 * bare-string list beside it. It feeds the admission gate *and* the entity
 * scoring signal, which is the point: one vocabulary, matched one way, so the
 * two cannot disagree about whether the scene named somebody. It matches on a
 * word boundary and carries the row id, so a character's name and her nickname
 * are one entity instead of two and the count of distinct shared entities means
 * what it says.
 *
 * ## It reaches past the session's cast now, and why it must
 *
 * The old exclusion — *"no reaching past the session's cast"* — was the last
 * thing keeping this seam and `annotations/loadVocabulary` reading two different
 * vocabularies for one lorebook. Annotations resolve every binding in the book;
 * retrieval resolved only the seated ones, so a character the book binds but
 * this scene never seated was a name one subsystem knew and the other did not.
 * The `gazetteer_hash` those annotations are stored under is computed from the
 * annotation vocabulary, so the disagreement was not even observable from a
 * receipt. Both sides read bindings now, through the one `bindingNames` helper.
 *
 * ⚠ **Order is load-bearing, and it is: seated cast, then the rest of the
 * roster, then entry titles** (`keywordQuery` appends the third). `buildGazetteer`
 * lets the first claimant of a name keep it, so a character called "Vell" resolves
 * to the character rather than to an entry titled after her — and, between two
 * bindings claiming one name, to the one actually in the room. Widening the
 * source must not disturb that, which is why the roster is appended *after* the
 * cast rather than replacing it: every name the cast used to claim, it still
 * claims first.
 *
 * A binding bound to neither a character nor a persona — a background NPC the
 * graph minted — contributes nothing, exactly as it contributes nothing to
 * `loadVocabulary`: `EntityRef` names a character, a persona or an entry, and
 * there is no row for a fourth kind to resolve *to*. Its name still reaches the
 * open tier as a string.
 *
 * ⚠ **What this does not do is read the clause a name sits in.** Tier one
 * resolves *"the warden was already there"* and *"the warden was four days up
 * the road"* identically — measured, in `measure/vocabularyWidening.test.ts`,
 * along with what that costs. An unseated binding is likelier than a seated one
 * to be named in the abstract, so the widening loads that failure mode as well
 * as the recall it buys. The measurement is why it shipped anyway: on the
 * shipped `admitThreshold` of 0 the gazetteer cannot admit anything the keyword
 * scan did not, so the change is inert at defaults and priced only where an
 * install has turned the gate on.
 *
 * Exported for `castEntityRefs.test.ts` alone. The order it returns names in is
 * the whole of the precedence guarantee above and is invisible from the
 * pipeline's output — the gazetteer reports an entity's *text*, never which row
 * claimed it — so the only place that property can be asserted is here.
 */
export function castEntityRefs(
	cast: SessionCastRead | null | undefined
): Array<{
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
	// The rest of the book, after the room. `bindingNames` is the shared
	// spelling of the `name` ∪ `aliases` ∪ `absorbedAliases` union the schema
	// note makes mandatory — the same one `loadVocabulary` calls.
	for (const b of cast?.lorebookBindings ?? []) {
		const ref =
			b?.characterId != null
				? { kind: "character" as const, id: b.characterId }
				: b?.personaId != null
					? { kind: "persona" as const, id: b.personaId }
					: null
		if (!ref) continue
		for (const name of bindingNames(b)) add(name, ref)
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
/**
 * The three lanes `loreFor` serves — the **runtime** twin of the
 * `SharedInput<[…]>` on its `input`, and the same three ids in the same order.
 *
 * ⚠ Two lists, one fact, and the duplication is forced rather than chosen: a
 * type annotation cannot be read at run time and a runtime array cannot be read
 * by `tsc`, so the compile-time rule and the boot-time rule have to name their
 * contracts separately. They are kept adjacent so a divergence is a three-line
 * diff, and `bindingCompat.ts` asserts every id here is actually bound — which
 * is the half that catches a group whose member was renamed or dropped.
 */
const LORE_LANES = [
	"core:query/world-lore@1",
	"core:query/character-lore@1",
	"core:query/history-entries@1"
] as const

async function loreFor(
	source: string,
	/**
	 * Typed as the **intersection** of the three lanes it serves, not as one of
	 * them with the other two assumed to match. They declare identically today
	 * — the same two in-ports and one `params` slot, from one `loreSlots()`
	 * helper — and `SharedInput` is what makes that a checked fact rather than
	 * a coincidence: the day one lane declares a port the others do not, this
	 * handler stops compiling instead of reading `undefined` on two lanes out
	 * of three with nothing failing anywhere.
	 */
	input: SharedInput<
		[typeof C.worldLore, typeof C.characterLore, typeof C.historyEntries],
		Unsupplied<"limit", WhyTopLevelLimit>
	>,
	ctx: CoreQueryCtx
) {
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
			// The other window. Two numbers on one line is the only way a
			// reader can tell a deep scan with a short guarantee from the
			// shared constant these were before they were split.
			guaranteedMessages: result.diagnostics.guaranteedMessages,
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
/** The two relationship nodes `readGraph` serves. See `LORE_LANES`. */
const RELATIONSHIP_NODES = [
	"core:query/relationships-perspectives@1",
	"core:query/relationships-known@1"
] as const

async function readGraph(
	// Both relationship nodes call it, so both are named — see `loreFor` for
	// why the intersection rather than one of them.
	input: SharedInput<
		[typeof C.relationshipsPerspectives, typeof C.relationshipsKnown],
		Unsupplied<"currentCharacterId", WhyFlatSpeakerId>
	>,
	ctx: CoreQueryCtx
) {
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
/** The four turn strategies `pickSpeaker` serves. See `LORE_LANES`. */
const TURN_STRATEGIES = [
	"core:task/turn-round-robin@1",
	"core:task/turn-random@1",
	"core:task/turn-manual@1",
	"core:task/turn-none@1"
] as const

function pickSpeaker(strategy: string) {
	// All four turn strategies below are this one function. They come from one
	// `turnStrategy()` helper in the contracts and so declare identically —
	// which is exactly the fact a single-contract annotation would have been
	// silently relying on.
	return async (
		input: SharedInput<
			[
				typeof C.turnRoundRobin,
				typeof C.turnRandom,
				typeof C.turnManual,
				typeof C.turnNone
			]
		>,
		ctx: TaskCtx
	) => {
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
 * A step's own Connection and Sampling, on the way to `ctx.call`.
 *
 * ⚠ Neither was forwarded at all, and `dispatchStep` reads them off exactly
 * this payload — so every summarize and graph step ran on the capability
 * default no matter what its pickers said, while `core:task/batch-messages@1`
 * cut the transcript against the window of the config that WAS picked (it takes
 * the drafting step's slot by reference for that very purpose). The prompt was
 * sized for one model and sent to another.
 *
 * The two travel together on purpose: sending a config's temperature and
 * context window to a connection it was never chosen for is the same
 * divergence, one field along.
 *
 * Values, not ids — the host reduces them (`refId`), and for sampling that
 * reduction reads the row reference the executor carries beside the values.
 */
const stepSlots = (input: { connection?: unknown; sampling?: unknown }) => ({
	connection: input?.connection ?? null,
	sampling: input?.sampling ?? null
})

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
/**
 * A tool's answer, written the way the model was taught to write its question.
 *
 * The mirror of `advertise-tools`' prompt door: it teaches one fenced block
 * called `tool_call`, so a result comes back in a `tool_result` block. One
 * convention, both directions — a model that learned the first reads the
 * second without being told, and a person reading the transcript can see
 * exactly what the model was given.
 *
 * JSON rather than prose because the payload is data with a shape (see
 * `project_json_prompt_rationale`), and truncated because a tool that returns
 * a hundred entries would otherwise spend the next prompt's whole budget on
 * one answer — the model is told it was truncated rather than left to conclude
 * the world is small.
 */
const TOOL_RESULT_LIMIT = 6000

export function renderToolResult(result: unknown): string {
	let body: string
	try {
		body = JSON.stringify(result ?? null, null, 0) ?? "null"
	} catch {
		body = JSON.stringify({
			error: "the tool returned something unreadable"
		})
	}
	const truncated =
		body.length > TOOL_RESULT_LIMIT
			? body.slice(0, TOOL_RESULT_LIMIT) +
				` … (truncated at ${TOOL_RESULT_LIMIT} characters)`
			: body
	return "```tool_result\n" + truncated + "\n```"
}

/**
 * Generate, for both pins (20 §9).
 *
 * `core:provider/generate-text@1` and `core:provider/generate-with-tools@1`
 * differ by two ports and nothing else, and the second exists only because the
 * first is published and frozen. One function so the two cannot come to
 * disagree about a stop sequence or an attachment — the failure two copies of
 * a fifty-line forward always eventually produce.
 *
 * The input is the INTERSECTION of the two contracts, which is what makes
 * binding one function to two ids sound: every name read here is declared by
 * whichever one the run resolved. The two ports outside that intersection —
 * `tools` in and `toolCall` out — are named as `Supplied`, because they are
 * genuinely wired on one of the two.
 */
const generateBinding = async (
	input: SharedInput<
		[typeof C.generateText, typeof C.generateWithTools],
		| Unsupplied<
				"compiledPrompt" | "main" | "generatingMessageMetadata",
				"two earlier spellings of the declared `context` port — an unrefined `$.assemble` lands on `main` — plus host state that never became a port"
		  >
		| Supplied<
				"tools",
				"the `tools` in-port of core:provider/generate-with-tools@1, which the other pin does not declare"
		  >
	>,
	ctx: ProviderCtx
) => {
	const result: any = await ctx.call({
		// The rendered prompt, whatever produced it. Accepting the assemble
		// node's whole output as well as a bare payload means a spec can wire
		// `$.assembled` straight in without a shim node in between.
		compiledPrompt: input?.compiledPrompt ?? input?.context ?? input?.main,
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
		attachments: input?.attachments,
		/**
		 * The author's own stop sequences (ruling 2026-09-10).
		 *
		 * ⚠ **Declared since this node type was written and read by
		 * nothing** — the third member of the dead-control family bugs
		 * 12 and 15 kept finding, and the one `paramsSlotWiring.test.ts`
		 * carries three ledger lines for. The panel rendered the
		 * textarea, the scope chain stored the lines, and no request
		 * ever carried them.
		 *
		 * Forwarded rather than composed: this is the EXPLICIT kind, and
		 * the other two — the completion template's own list and the
		 * scene's speaker labels — are derived from facts the dispatch
		 * already holds. `connections/stops.ts` puts all three together
		 * once and applies the wire rule; an author's sequence is their
		 * choice rather than the template's, so it is the one kind that
		 * rides either wire.
		 *
		 * ⚠ A spec must NAME the slot (`params: slot.params()`) for this
		 * to be anything but `undefined` — `resolveInput` resolves only
		 * the config keys a node's config mentions. The three shipped
		 * reply specs do not name it yet; that half is core-catalog work.
		 */
		stopSequences: explicitStopsFrom(input?.params?.stopSequences),
		/**
		 * How this step is sent — `auto` defers to the connection, `off` forces
		 * one request and waits.
		 *
		 * The same slot as the stop sequences and the same rule: forwarded
		 * rather than resolved, because what `auto` means is the CONNECTION's
		 * answer and a binding never sees one.
		 */
		streaming: streamingModeFrom(input?.params?.streaming),
		/**
		 * The advertisement's native door, forwarded verbatim.
		 *
		 * Undefined on `generate-text`, which declares no such port, so that
		 * node's request is byte-identical to what it always was. The dispatch
		 * REFUSES a request carrying tools that its connection or adapter
		 * cannot send rather than sending it stripped — see there.
		 */
		tools: Array.isArray(input?.tools) ? input.tools : undefined
	})

	/**
	 * What the provider said about the prompt it just read (ruled "later,
	 * non-disruptive").
	 *
	 * ⚠ **Before the halts below, deliberately.** A run that was cancelled
	 * mid-generation, or that came back with nothing, still paid for the prompt
	 * — and those are exactly the turns somebody asks about. Reported to the
	 * RECEIPT rather than put on a port: it is accounting about the call, not a
	 * value the next node consumes.
	 *
	 * Only the numbers the service actually gave. Several report none, and
	 * absent must not become zero — see `ProviderCtx.reportCacheUsage`.
	 */
	if (
		typeof result?.tokensPrompt === "number" ||
		typeof result?.tokensCached === "number" ||
		typeof result?.tokensCacheWrite === "number"
	)
		ctx.reportCacheUsage?.({
			...(typeof result.tokensPrompt === "number"
				? { prompt: result.tokensPrompt }
				: {}),
			...(typeof result.tokensCached === "number"
				? { cached: result.tokensCached }
				: {}),
			...(typeof result.tokensCacheWrite === "number"
				? { cacheWrite: result.tokensCacheWrite }
				: {})
		})

	/**
	 * What the request could not carry of the sampling config.
	 *
	 * ⚠ **Before the halts below, for the same reason the counts above
	 * are.** A run that came back with nothing still sent a request, and a
	 * request that dropped a sampler is exactly the one somebody asks
	 * about. Reported only when the adapter left something out, so a node
	 * that carried everything writes nothing to the receipt.
	 *
	 * The same channel `generate-image` reports on further down, for the
	 * same reason it does: "why did changing this do nothing" has no
	 * answer anywhere else on the screen.
	 */
	if (Array.isArray(result?.samplingIgnored) && result.samplingIgnored.length)
		ctx.reportSampling?.(
			result.samplingApplied ?? {},
			result.samplingIgnored
		)

	if (result?.isAborted)
		return halt("generation was aborted before the model finished")
	if (!result?.text)
		// The provider type used to be named here. `haltReason` is a
		// plain string on the SDK receipt, so nothing downstream can
		// take it back out again — and a non-admin reads their own
		// receipt through `pipelines:run`. The fact moves to the field
		// below, which the projection can remove.
		return halt("the model returned nothing — there is no message to write")

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
		connection: { type: result.via },
		/**
		 * What this request stopped on, and what it was not allowed to.
		 *
		 * On the node's OUTPUT because that is where a receipt reader
		 * looks, and because the failure it reports has no error
		 * attached to it: a stop sequence the model never saw means a
		 * reply that runs on past its turn, and one held back by the
		 * wire rule is a control that looks configured and is not.
		 * `dropped` is the half that answers "why is my stop sequence
		 * not working"; `wire` names the rule that decided.
		 *
		 * Carries no connection identity — three kinds, some strings the
		 * user themselves wrote, and the wire mode — so the projection
		 * has nothing to remove here.
		 */
		stops: result.stops,
		/**
		 * What the adapter put on the wire, and what came back.
		 *
		 * On the output beside `stops` for the same reason `stops` is there, and
		 * under the same rule `connection` above follows: this one names the
		 * base URL, the model and the body, so the projection removes the whole
		 * key for everyone who is not an administrator. Absent on an adapter
		 * that recorded nothing.
		 */
		...(result.wire ? { wire: result.wire } : {}),
		/**
		 * `{ tool, args }` or null — the same shape `parse-tool-call`
		 * publishes, so `run-tool` and a loop's predicate take either door
		 * without knowing which was used.
		 *
		 * Published from both pins, and always null on `generate-text`: an
		 * out-port the contract does not declare is unreachable from any spec,
		 * so it costs that node one key in its receipt output — and the
		 * alternative is a branch on the type id inside a function whose whole
		 * point is not having one.
		 */
		toolCall: result.toolCall ?? null
	})
}

/**
 * Select what a downstream port can take, from a document it cannot reach into.
 *
 * A data reference is `{node, port}` with no sub-path, so `path` is how one node
 * serves both the step that reads the whole answer and the block that iterates
 * one list inside it — the same parameter and the same spelling `parse-json@1`
 * carries.
 *
 * Several comma-separated paths join in order. That is what makes an answer
 * split into ARMS wireable: a schema can only be strict about a list whose items
 * are all one shape, so a keeper that reports values and possessions reports two
 * lists, and the node that resolves them takes one.
 */
export function selectJsonPaths(
	json: unknown,
	path: unknown
): { value: unknown; items: unknown[] } {
	const spec = typeof path === "string" ? path.trim() : ""
	const at = (dotted: string): unknown => {
		let value: unknown = json
		for (const segment of dotted ? dotted.split(".") : []) {
			if (value == null || typeof value !== "object") return undefined
			value = (value as Record<string, unknown>)[segment]
		}
		return value
	}
	// A single value becomes a one-element list and an absent one an empty
	// list, so a `map` wired to `items` is always wired to a list.
	const listed = (value: unknown): unknown[] =>
		Array.isArray(value) ? value : value == null ? [] : [value]

	const paths = spec
		.split(",")
		.map((p) => p.trim())
		.filter(Boolean)
	if (paths.length <= 1) {
		const value = at(paths[0] ?? "")
		return { value, items: listed(value) }
	}
	const items = paths.flatMap((p) => listed(at(p)))
	// `value` IS the joined list when several paths were named: there is no
	// single value to publish, and a reader of `value` on a multi-path node is
	// asking the same question `items` answers.
	return { value: items, items }
}

/**
 * Generate a DOCUMENT.
 *
 * Its own function rather than a third id on `generateBinding`, and the reason
 * is the shape of the request rather than the shape of the code: that one
 * forwards a turn — a speaker, the files travelling with it, the assistant line
 * the model continues — and this one forwards a question. The two share a
 * dispatcher, which is where the parts that genuinely are the same live.
 *
 * ⚠ **The absence of a trailing assistant line is the TRANSCRIPT's guarantee,
 * not this function's.** By the time a prompt reaches here it has been rendered,
 * and on a completion wire the seed is an open block inside one string that
 * nothing can take back out. `core:task/prose-transcript@1` is where the line is
 * never written, and the shipped spec wires it for exactly that reason.
 */
const generateJsonBinding = async (
	input: NodeInput<typeof C.generateJson>,
	ctx: ProviderCtx
) => {
	const result: any = await ctx.call({
		compiledPrompt: input?.context,
		// Names no speaker: the stop composer's speaker labels and the
		// continuation machinery both key on this, and neither belongs on a
		// request that is not somebody's turn.
		currentCharacterId: null,
		connection: input?.connection ?? null,
		sampling: input?.sampling ?? null,
		stopSequences: explicitStopsFrom(input?.params?.stopSequences),
		// Same slot, same rule as on the turn-taking sibling above: `auto` is
		// the connection's answer and only the dispatch has the connection.
		streaming: streamingModeFrom(input?.params?.streaming),
		// The ask. Which door it goes out through is the dispatch's answer,
		// because only the dispatch has the connection.
		schema: input?.schema ?? undefined
	})

	if (
		typeof result?.tokensPrompt === "number" ||
		typeof result?.tokensCached === "number" ||
		typeof result?.tokensCacheWrite === "number"
	)
		ctx.reportCacheUsage?.({
			...(typeof result.tokensPrompt === "number"
				? { prompt: result.tokensPrompt }
				: {}),
			...(typeof result.tokensCached === "number"
				? { cached: result.tokensCached }
				: {}),
			...(typeof result.tokensCacheWrite === "number"
				? { cacheWrite: result.tokensCacheWrite }
				: {})
		})

	/**
	 * What the request could not carry of the sampling config.
	 *
	 * ⚠ **Before the halts below, for the same reason the counts above
	 * are.** A run that came back with nothing still sent a request, and a
	 * request that dropped a sampler is exactly the one somebody asks
	 * about. Reported only when the adapter left something out, so a node
	 * that carried everything writes nothing to the receipt.
	 *
	 * The same channel `generate-image` reports on further down, for the
	 * same reason it does: "why did changing this do nothing" has no
	 * answer anywhere else on the screen.
	 */
	if (Array.isArray(result?.samplingIgnored) && result.samplingIgnored.length)
		ctx.reportSampling?.(
			result.samplingApplied ?? {},
			result.samplingIgnored
		)

	if (result?.isAborted)
		return halt("generation was aborted before the model finished")
	if (!result?.text)
		return halt("the model returned nothing — there is no answer to read")

	/**
	 * An answer that cannot be read is reported, not thrown away.
	 *
	 * `json` is null and `parseError` says which way it failed, so a reader can
	 * tell a model that ignored its schema from one whose reply hit the token
	 * limit mid-document. The node is `optional`, so downstream this is the same
	 * absence a halt would have produced — with the sentence kept.
	 */
	const { extractJson, JsonExtractionError } = await import(
		"$lib/server/utils/extractJson"
	)
	let json: unknown = null
	let parseError: string | undefined
	try {
		json = JSON.parse(extractJson(result.text))
	} catch (e) {
		parseError =
			e instanceof JsonExtractionError && e.truncated
				? "the answer stopped in the middle of its JSON, which usually means the reply hit its token limit"
				: "the answer was not readable as JSON"
	}

	const { value, items } = selectJsonPaths(json, input?.params?.path)

	return ok({
		main: json,
		json,
		value,
		items,
		text: result.text,
		// The connection TYPE, not the connection — the same key the projection
		// removes for everyone who is not an administrator.
		connection: { type: result.via },
		stops: result.stops,
		// The exchange, under the key the projection removes — see the
		// `generate-text` sibling above.
		...(result.wire ? { wire: result.wire } : {}),
		// Which door the request went out through. Without it, "the model
		// ignored the schema" and "no schema was ever sent" read identically.
		structured: result.structured ?? null,
		...(parseError ? { parseError } : {})
	})
}

export function coreBindings(run: RenderRun = {}): Bindings {
	const bindings: Bindings = {
		// ── Inputs ──────────────────────────────────────────────────────────
		// An Input node does not fetch; it names what the trigger already
		// carried. Core hands the trigger payload in as the run's input, so the
		// binding is the identity — and that is not a placeholder, it is what an
		// Input *is* (01 §2).
		"core:input/user-message@1": async (
			input: NodeInput<typeof C.userMessage>
		) => ok(input),
		"core:input/message-created@1": async (
			input: NodeInput<typeof C.messageCreated>
		) => ok(input),
		"core:input/session-created@1": async (
			input: NodeInput<typeof C.sessionCreated>
		) => ok(input),
		// The side-character turn (ruling 2026-09-07). Identity like its
		// siblings: the trigger already decided who speaks and whether the
		// lorebook knows them — `sideCharacterFact` in `sessions.ts` is what
		// resolved it, once, before the run started.
		"core:input/side-character-turn@1": async (
			input: NodeInput<typeof C.sideCharacterTurn>
		) => ok(input),

		// ── Queries ─────────────────────────────────────────────────────────
		/**
		 * The create pipeline's read (24 §12, T8): what the cast wants to say
		 * first. The host owns the implementation (interpolation, group
		 * greetings, the fallback line) — see sessions/greetings.ts.
		 */
		"core:query/session-greetings@1": async (
			input: NodeInput<typeof C.sessionGreetings>,
			ctx: CoreQueryCtx
		) => {
			const greetings = await ctx.read("session_greetings", {
				sessionId: input?.scope?.sessionId
			})
			return ok({ main: greetings, greetings })
		},

		"core:query/session-history@1": async (
			// Both names stay in the `Unsupplied` set, and now for the same
			// reason: each is a dead top-level spelling kept only so a stored
			// config carried forward from an older document still resolves.
			// `limit` was a *finding* here until this ruling — the live read
			// with no supplier — and is now what `channel` already was.
			input: NodeInput<
				typeof C.sessionHistory,
				Unsupplied<
					"limit" | "channel",
					"dead top-level spellings of two declared parameters (ruling 2026-09-09) — `params` is the live read and this is the fallback behind it"
				>
			>,
			ctx: CoreQueryCtx
		) => {
			const messages = await ctx.read("session_messages", {
				sessionId: input?.scope?.sessionId,
				/**
				 * `topK`'s twin, closed on the same terms (ruling 2026-09-09).
				 *
				 * `limit` is a declared *parameter* of this node — "How many
				 * recent messages are considered for the context" — and it
				 * arrives at `input.params.limit`. This read the top level,
				 * which nothing sets, so every run took the literal 100 and the
				 * control did nothing.
				 *
				 * The declared default is **100** now, not 40: the number the
				 * declaration carried had never been the number a run used, and
				 * wiring the control while leaving it at 40 would have shrunk
				 * the transcript window on every install at defaults — a
				 * retrieval change wearing a typing fix. Today's effective value
				 * is declared first; moving it is a separate decision against
				 * the measure corpus.
				 *
				 * `input.limit` stays behind it as a tolerant read. Nothing in
				 * this repo writes it, but a stored config carried forward from
				 * a document that named the key would still resolve here, and a
				 * fallback that costs a `??` is cheaper than the one turn it
				 * would otherwise silently re-window.
				 */
				limit: input?.params?.limit ?? input?.limit ?? 100,
				// Which lane builds this context (20 §7). 'main' is the chat
				// log and today's exact behaviour; another value is a mode's
				// declared channel, read on purpose by the pipeline that wants
				// it.
				//
				// `input.channel` beside it is a second spelling nothing
				// supplies, and the fallback is the parameter's own declared
				// default anyway.
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
		"core:query/world-lore@1": async (
			input: NodeInput<
				typeof C.worldLore,
				Unsupplied<"limit", WhyTopLevelLimit>
			>,
			ctx: CoreQueryCtx
		) => await loreFor("worldLore", input, ctx),
		"core:query/character-lore@1": async (
			input: NodeInput<
				typeof C.characterLore,
				Unsupplied<"limit", WhyTopLevelLimit>
			>,
			ctx: CoreQueryCtx
		) => await loreFor("characterLore", input, ctx),
		// ⚠ The third lane, absent between spec 1.8.0 and 1.10.0. The two lore
		// queries each filter the shared scan to their own source, and nothing
		// filtered for `history` — so those candidates were built, scored and
		// dropped, with the ranker still holding a `history` band and
		// `assemble` still asking for history blocks.
		"core:query/history-entries@1": async (
			input: NodeInput<
				typeof C.historyEntries,
				Unsupplied<"limit", WhyTopLevelLimit>
			>,
			ctx: CoreQueryCtx
		) => await loreFor("history", input, ctx),

		"core:query/lorebook-triggers@1": async (
			input: NodeInput<
				typeof C.lorebookTriggers,
				Unsupplied<"limit", WhyTopLevelLimit>
			>,
			ctx: CoreQueryCtx
		) => {
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
		"core:query/vector-search@1": async (
			input: NodeInput<
				typeof C.vectorSearch,
				Unsupplied<
					"vector" | "sources",
					"a singular alias for the declared `vectors` port, and a source filter no shipped spec wires"
				>
			>,
			ctx: CoreQueryCtx
		) => {
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
			/**
			 * ⚠ **Off `params`, and it was read off `input?.topK`.**
			 *
			 * `topK` is a declared *parameter* of this node and not an in-port,
			 * so `input.topK` was a name nothing ever set: the number a reader
			 * typed resolved through every scope layer, survived a config cull
			 * with a test watching, and was handed to nothing, while the host
			 * ran on the literal fallback below. The declared default is 40 for
			 * that reason — it is what has actually been running — so wiring the
			 * control re-tunes no install.
			 *
			 * Clamped at 1: `topK: 0` asks the host for the top nothing, which
			 * is the mechanism switched off under a name that does not say so.
			 * `maxEntries` is the switch, one field up.
			 */
			const topK = Math.max(
				1,
				Math.floor(Number(input?.params?.topK) || 40)
			)
			/**
			 * How sharply a weak resemblance is discounted, as an exponent.
			 *
			 * ⚠ **This is what replaced `minScore`, and it is deliberately not a
			 * floor.** A minimum similarity takes a row out of the pool, and a
			 * row that is out of the pool cannot be found by keyword, by name or
			 * by proximity either — one mechanism's opinion disabling four
			 * others, which is the governing rule's one prohibition. (`minScore`
			 * was never read by anything either, so no install has ever had a
			 * floor to lose.)
			 *
			 * `cos ** falloff` is fixed at both ends and strictly monotonic, so
			 * the mechanism can never reorder or drop its own hits — it only
			 * decides how much a loose match is allowed to weigh against a
			 * keyword that actually fired. 1 is the raw cosine.
			 *
			 * Clamped below at 1: an exponent under 1 is concave, which
			 * *amplifies* the noise floor every embedder has, and there is no
			 * install for which that is the intent.
			 */
			const falloff = Math.max(
				1,
				Number(input?.params?.similarityFalloff) || 1
			)
			/**
			 * The curve, applied where the cosine becomes a signal.
			 *
			 * ⚠ **At the shipped `falloff` of 1 this is the identity for every
			 * value the mechanism can produce except one**, and the exception is
			 * a fix rather than a side effect. A *negative* cosine — two
			 * opposed directions — used to pass straight through onto
			 * `signals.semantic`, where the weighted sum turned it into a
			 * penalty: an entry scoring *lower* for having been looked at by a
			 * mechanism, which is the one thing the governing rule forbids a
			 * mechanism to do. It reads as 0 now, which is what "this mechanism
			 * has nothing to say about this entry" has always meant everywhere
			 * else. Raising it to an odd power would have kept the sign and made
			 * the penalty configurable, which is worse.
			 *
			 * Every non-negative cosine is returned bit-for-bit at 1, so an
			 * install that never moves this control scores exactly what it
			 * scored before.
			 */
			const attenuate = (raw: number): number =>
				!Number.isFinite(raw) || raw <= 0
					? 0
					: falloff === 1
						? raw
						: Math.min(1, raw) ** falloff
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
					topK
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
					semantic: attenuate(
						bestScore.get(`${hit.source}:${hit.id}`) ??
							Number(hit.score)
					)
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
					/**
					 * Both reported, because both were unreadable from the
					 * outside for as long as one of them was a literal in this
					 * file and the other was a control nothing consumed. A
					 * receipt that names the pool width and the curve is what
					 * lets somebody tell "the model is weak here" from "the
					 * search only looked at forty rows".
					 */
					topK,
					similarityFalloff: falloff,
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
		"core:query/entity-search@1": async (
			input: NodeInput<
				typeof C.entitySearch,
				Unsupplied<"limit", WhyTopLevelLimit>
			>,
			ctx: CoreQueryCtx
		) => {
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
		"core:query/mention-spans@1": async (
			input: NodeInput<typeof C.mentionSpans>,
			ctx: CoreQueryCtx
		) => {
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
		"core:query/entity-link@1": async (
			input: NodeInput<typeof C.entityLink>,
			ctx: CoreQueryCtx
		) => {
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
			if (maxLinks === 0)
				return off("off — no links requested (maxLinks is 0)")
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
			if (!embedding?.available)
				return off(embedding?.reason ?? "unavailable")

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
			input: NodeInput<
				typeof C.relationshipsPerspectives,
				Unsupplied<"currentCharacterId", WhyFlatSpeakerId>
			>,
			ctx: CoreQueryCtx
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

		"core:query/relationships-known@1": async (
			input: NodeInput<
				typeof C.relationshipsKnown,
				Unsupplied<"currentCharacterId", WhyFlatSpeakerId>
			>,
			ctx: CoreQueryCtx
		) => {
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

		// The same graph, ranked and budgeted rather than dumped.
		...relationshipSearchBindings(),

		// The session's stats, states and possessions: one node reads them,
		// one changes them.
		...stateBindings(run),

		"core:query/session-cast@1": async (
			input: NodeInput<
				typeof C.sessionCast,
				Unsupplied<"currentCharacterId", WhyFlatSpeakerId>
			>,
			ctx: CoreQueryCtx
		) => {
			const cast = await ctx.read("session_cast", {
				sessionId: input?.scope?.sessionId
			})
			if (!cast)
				return halt(
					"there is no session to build a prompt for — the run is scoped to a " +
						"session that no longer exists"
				)
			// ⚠ The roster the host attaches for retrieval's gazetteer is
			// dropped here, and deliberately. `lorebookBindings` is every
			// character the *book* binds, most of whom are not in this scene;
			// this node's output is the prompt's cast, and a layout that
			// rendered a field it did not recognise would be putting the whole
			// book's dramatis personae into the context window. Retrieval reads
			// the same host row directly (`castEntityRefs`) and needs no help
			// from the prompt path.
			const { lorebookBindings: _roster, ...castForPrompt } = cast as {
				lorebookBindings?: unknown
			} & Record<string, unknown>
			// Whose turn it is travels *with* the cast rather than separately.
			// It is one fact about the session — who is in it and who is speaking —
			// and splitting it left the context Task unable to resolve the
			// speaker at all, which the first parity run showed as a missing
			// scenario and no post-history text.
			const withSpeaker = {
				...castForPrompt,
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
		"core:task/merge-candidates@1": async (
			input: NodeInput<typeof C.mergeCandidates>
		) => {
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
		"core:task/concat-candidates@1": async (
			input: NodeInput<typeof C.concatCandidates>
		) => {
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
					const own = {
						...candidate,
						signals: { ...candidate?.signals }
					}
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
		"core:task/query-windows@1": async (
			input: NodeInput<typeof C.queryWindows>
		) => {
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
		"core:task/rank-semantic@1": async (
			input: NodeInput<
				typeof C.rankSemantic,
				Unsupplied<
					"lists" | "similarity",
					"the two ranked-list ports `core:query/vector-search@1` publishes and this node never declared, so no spec can wire them"
				>
			>
		) => {
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
		"core:task/context-budget@1": async (
			input: NodeInput<typeof C.contextBudget>
		) => {
			const budget = contextBudgetFrom(input)
			return ok({ main: budget, available: budget })
		},

		"core:task/rank-hybrid@1": async (
			input: NodeInput<
				typeof C.rankHybrid,
				Unsupplied<
					"availableTokens",
					"a flat spelling of `budget.remaining` from before the budget port carried a payload"
				>
			>
		) => {
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
		"core:task/build-template-context@1": async (
			input: NodeInput<
				typeof C.buildTemplateContext,
				Unsupplied<
					| "main"
					| "promptConfig"
					| "narratorName"
					| "characterLore"
					| "fields",
					"four pre-contract spellings — an unrefined `$.node` landing on `main`, `promptConfig` before the prompts slot, `narratorName` before it moved inside it, and a `characterLore` port that was never declared — plus `fields`, which a SIBLING BINDING supplies: the four adventure wrappers at the bottom of this file call this handler with the variables their prompt rows interpolate. Undeclared here on purpose, because this node is frozen for 0.6 and the supplier is code rather than a spec"
				>
			>,
			ctx: TaskCtx
		) => {
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
				// The side-character turn's speaker (ruling 2026-09-07).
				// Absent on every other pipeline, where both are undefined and
				// the resolver takes exactly the branches it always did.
				//
				// ⚠ Declared in-ports on `build-template-context@1` now (D-I),
				// which is what makes these four reads typed rather than
				// exempted. The supplier is still a sibling binding rather than
				// a spec: the side-character wrapper at the bottom of this file
				// unwraps its own `speaker` port and calls this handler with the
				// name and the card spread on. Declaring them is the only place
				// that fact is written down — an undeclared key arriving at a
				// handler reads exactly like a typo until someone opens both
				// files at once.
				speakerName: input?.speakerName,
				speakerCharacter: input?.speakerCharacter,
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
				// The variables an authored prompt row interpolates beside
				// `{{char}}`: a genre's own fields, and whatever the surface
				// that called this computed for them. They have to arrive here
				// rather than be merged onto the answer, because `instructions`
				// is interpolated inside the builder — see `fields` there.
				fields: input?.fields as Record<string, unknown> | undefined,
				// Unwired on every shipped spec, which is why it is read
				// defensively rather than required: a chat has no state block
				// and must not grow one by declaring a port.
				state: input?.state,
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
		"core:task/process-messages@1": async (
			input: NodeInput<typeof C.processMessages>
		) => {
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
		 * The same conversation, as prose, with no turn to continue.
		 *
		 * One implementation with the two differences on it as flags, rather
		 * than a second copy of the naming chain: `SessionMessageProcessor`
		 * reaches through participants who have since left to a name
		 * snapshotted at removal, and a second version of that agrees on every
		 * session until somebody leaves one.
		 */
		"core:task/prose-transcript@1": async (
			input: NodeInput<typeof C.proseTranscript>
		) => {
			const ctxValue = input?.templateContext ?? {}
			const result = processMessages({
				messages: input?.messages ?? [],
				cast: input?.cast ?? {},
				charName: ctxValue.char ?? "",
				personaName: ctxValue.user ?? "",
				// The two that make this node what it is. No name is needed for
				// a line that is not written.
				seed: false,
				plainProse: true
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
		"core:task/assemble@2": async (
			input: NodeInput<
				typeof C.assemble,
				never,
				UnsuppliedParam<
					"budget",
					"the live read is the declared `budget` in-port; `params.budget` is a spelling the schema never carried, kept as the fallback behind it"
				>
			>,
			ctx: TaskCtx
		) => {
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
			 * It is reachable on a real install: a pipeline config that never
			 * had a template selected stores no value for this slot, and it
			 * resolves to `{}` on that config's every run. (`bootstrapPipelines`
			 * does not return early on a changed declaration — it archives the
			 * old one and republishes the changed one, ruling 2026-09-10 — so a
			 * missing value here is a config nobody set, not a skipped boot
			 * pass.) The halt is the correct outcome, and it names the missing
			 * thing.
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
				// The per-band groups the ranker computed, on a declared
				// in-port fed by a declared out-port (D-H). It was published by
				// `core:task/rank-hybrid@1` and wired by nobody, so this read
				// took `allocate`'s own `{}` on every run — two adjacent nodes,
				// one computing exactly what the other needed, with no edge
				// between them and nothing to say so, because neither port was
				// declared.
				//
				// ⚠ It moves no prompt. `allocate` copies this onto
				// `AllocatedContext.groups` and reads it nowhere else, so
				// `blocks`, `totalTokens` and `budget` are the same bytes either
				// way. What it fills in is `dispatch.ts`'s `sources` — the
				// budget panel's whole data set, empty until now.
				groups: input?.groups
			})
			// The reminder's position, resolved against the messages that are
			// actually going out. The context builder ships a placeholder index
			// because the final message array does not exist when it runs.
			const messages = input?.messages ?? []
			const ctxPostHistory = (input?.templateContext as any)?.postHistory
			let postHistory = ctxPostHistory
			/**
			 * The decision, for the receipt.
			 *
			 * The trigger is a suppression, and a suppressed reminder leaves no
			 * trace in the prompt: the only difference between "the trigger held
			 * it back" and "nobody configured one" is a block that is not there.
			 * This node is where the difference is known, so it is where it is
			 * written down.
			 */
			let postHistoryDiag: PostHistoryDiag | undefined
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
				postHistoryDiag = resolved.diagnostics
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

			/**
			 * The template ROW, dereferenced by `world.ts` from the key above.
			 *
			 * ⚠ The key alone is not enough, and that was the second half of
			 * the same defect. `completionTemplateOf` resolves a bare key
			 * against the BUILT-INS, so a template an admin authored named no
			 * built-in and rendered as Vicuna: the format wire reached the
			 * render, and then the render could only find eight of the
			 * templates it might have been pointed at.
			 *
			 * Absent for a connection with no format at all, and for a world
			 * built before this field existed. Both fall through to the key
			 * below, which is what this path has always done.
			 */
			const completionTemplate =
				input?.connection?.metadata?.completionTemplate

			/**
			 * Which METHOD the sending connection wants to be called by.
			 *
			 * From the SAME slot as the two fields above — `slot.connectionOf(
			 * "generate")` — so the shape this render produces and the shape the
			 * Provider sends are one value rather than two that have to agree.
			 * That they did NOT agree is the defect: the render always produced
			 * one flat string, while a chat adapter branched on a local
			 * `extraJson` flag and looked for `messages` that were never built.
			 * Anthropic's empty-messages floor then filled in the word "Hello"
			 * and sent that in place of the assembled prompt.
			 *
			 * Absent for a caller with no connection in scope (the debug preview,
			 * the parity harness, a spec that did not wire the slot); `render`
			 * treats that as "the connection did not say", which leaves the
			 * template's own `renderMode` deciding exactly as before.
			 */
			const wireMode = input?.connection?.metadata?.wireMode

			const rendered = await render({
				allocation,
				postHistory,
				template,
				blocks: input?.params?.blocks,
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
				completionTemplate,
				wireMode,
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
				 *
				 * ⚠ It rides on `rendered`, and the trailing `promptFormat` that
				 * used to be spread after it is GONE rather than tidied away. The
				 * render is what picks the template — in chat wire mode it renders
				 * `split_session` and ignores the connection's delimiters entirely
				 * — so re-appending the value computed up here would have put the
				 * connection's format on a receipt for a prompt rendered in
				 * something else. The same lie, one layer along.
				 */
				main: { ...allocation, ...rendered },
				context: { ...allocation, ...rendered },
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
				budget: allocation.budget,
				/**
				 * Whether the post-history reminder went in, and on what
				 * numbers. Undeclared, like the two fields above it: nothing
				 * core wires this, and the receipt is the reader.
				 *
				 * Absent when this node made no decision — a context carrying
				 * no reminder at all, or a render with no messages to place one
				 * among. Absence is drawn as absence, so the inspector never
				 * reports a verdict that was never reached.
				 */
				...(postHistoryDiag ? { postHistory: postHistoryDiag } : {})
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
		"core:provider/embed-text@1": async (
			input: NodeInput<typeof C.embedText>,
			ctx: ProviderCtx
		) => {
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
		"core:provider/generate-text@1": generateBinding,
		/**
		 * The structured door (A). A separate function above rather than a
		 * third id on the shared one: it forwards a question, not a turn.
		 */
		"core:provider/generate-json@1": generateJsonBinding,
		/**
		 * The native tool door (20 §9) — the same node with the declarations on
		 * the wire.
		 *
		 * One handler, two pins, so the two cannot drift about a stop sequence
		 * or an attachment. Its input is the INTERSECTION of the two contracts,
		 * which is what makes that sound: every name read below is declared by
		 * whichever one the run resolved. `tools` and `toolCall` are the two
		 * that are not in the intersection, and they are named at the site.
		 */
		"core:provider/generate-with-tools@1": generateBinding,

		/**
		 * The image render — the structural twin of generate-text above.
		 *
		 * Thin on purpose: it forwards the slots' resolved values and hands back
		 * the references the substrate stored. Everything that varies between
		 * backends lives in the adapter, and everything that varies between
		 * installs lives in the connection and sampling rows; there is nothing
		 * left here for a binding to decide.
		 */
		"core:provider/generate-image@1": async (
			input: NodeInput<
				typeof C.generateImage,
				Unsupplied<
					"main",
					"an unrefined `$.node` wiring lands on `main`; the declared port is `prompt`"
				>
			>,
			ctx: ProviderCtx
		) => {
			const result: any = await ctx.call({
				prompt: input?.prompt ?? input?.main ?? "",
				negative: input?.negative,
				prompts: input?.prompts,
				connection: input?.connection,
				sampling: input?.sampling,
				init: input?.init,
				// `off` here means a render with no progress poll and no
				// previews — the image node's whole use for the parameter.
				streaming: streamingModeFrom(input?.params?.streaming)
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

		"core:input/summarize-request@1": async (
			input: NodeInput<typeof C.summarizeRequest>
		) => ok(input),

		"core:query/summarize-source@1": async (
			input: NodeInput<typeof C.summarizeSource>,
			ctx: CoreQueryCtx
		) => {
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
		"core:task/advertise-tools@1": async (
			input: NodeInput<typeof C.advertiseTools>
		) => {
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

		"core:task/parse-tool-call@1": async (
			input: NodeInput<typeof C.parseToolCall>
		) => {
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

		/**
		 * What tools this session has, as declarations a model can read.
		 *
		 * A Query so that the answer is the install's, not the spec's: which
		 * extensions are enabled is a fact about this moment, and a spec
		 * listing its tools by hand would advertise one that was uninstalled
		 * and refuse one that was added. The host resolves the list; this is
		 * the shape.
		 */
		"core:query/available-tools@1": async (
			input: NodeInput<typeof C.availableTools>,
			ctx: CoreQueryCtx
		) => {
			const tools = await ctx.read("available_tools", {
				sessionId: input?.scope?.sessionId,
				include: input?.params?.include ?? [],
				plugins: input?.params?.plugins !== false
			})
			const list = Array.isArray(tools) ? tools : []
			return ok({ main: list, tools: list })
		},

		/**
		 * The call itself — the one impure step of a tool loop (20 §9).
		 *
		 * Three rules, and each closes a way an agentic turn ends badly:
		 *
		 *  - **A null call is not an error.** It is the ordinary last
		 *    iteration, where the model answered in prose and the loop is
		 *    about to stop on its predicate. Nothing runs.
		 *  - **A tool that was not advertised is refused by name.** `tools` is
		 *    the list the model was actually given, so a name it invented
		 *    cannot reach a tool that exists but was withheld from this step —
		 *    and the refusal says the name, because a model that reads "unknown
		 *    tool" with no name asks for the same one again.
		 *  - **An error is a result.** `main` carries `{ tool, error }` and
		 *    `text` renders it, so the model reads what went wrong and tries
		 *    something else. A throw here would end the run at the one moment
		 *    the agent could have recovered.
		 *
		 * The time-box is the node type's own `timeoutMs`: one invocation is
		 * one tool, so the executor's timeout already is the tool's, and a
		 * second deadline here could only disagree with it.
		 */
		"core:provider/run-tool@1": async (
			input: NodeInput<typeof C.runTool>,
			ctx: ProviderCtx
		) => {
			const call = input?.call as
				| { tool?: unknown; args?: unknown }
				| null
				| undefined
			const tool = typeof call?.tool === "string" ? call.tool : ""
			// The ordinary last iteration: the model answered instead of
			// asking, so nothing runs and the prose is what this iteration
			// contributed to the conversation.
			if (!tool)
				return ok({
					main: null,
					text: "",
					answer: String(input?.text ?? "")
				})

			const advertised = (Array.isArray(input?.tools) ? input.tools : [])
				.map((t: any) => t?.name)
				.filter((n: unknown): n is string => typeof n === "string")
			if (advertised.length && !advertised.includes(tool)) {
				const refusal = {
					tool,
					error:
						`'${tool}' is not one of the tools offered here. ` +
						(advertised.length
							? `Available: ${advertised.join(", ")}.`
							: "No tools are offered on this step.")
				}
				return ok({
					main: refusal,
					text: renderToolResult(refusal),
					answer: ""
				})
			}

			const args =
				call?.args && typeof call.args === "object"
					? (call.args as Record<string, unknown>)
					: {}
			const result = (await ctx.call({ tool, args })) as Record<
				string,
				unknown
			>
			return ok({
				main: result,
				text: renderToolResult(result),
				// Empty because this iteration worked rather than answered:
				// the prose beside a tool call is the model narrating its own
				// reasoning, and the turn's reply is the iteration that made
				// no call. It is on the receipt either way.
				answer: ""
			})
		},

		/**
		 * A repeated block's outputs, joined.
		 *
		 * `path` reads one key off each entry because an iteration's value is
		 * its chain's last node's ports object, and empty entries are skipped
		 * — which is what makes "every iteration's `answer`" resolve to the one
		 * iteration that had an answer without a filter node in between.
		 */
		"core:task/join-text@1": async (
			input: NodeInput<typeof C.joinText>
		) => {
			const items = Array.isArray(input?.items) ? input.items : []
			const path = input?.params?.path ?? "text"
			const separator = input?.params?.separator ?? "\n\n"
			const parts = items
				.map((entry: any) => {
					const value =
						path && entry && typeof entry === "object"
							? entry[path]
							: entry
					return typeof value === "string"
						? value
						: value == null
							? ""
							: String(value)
				})
				.map((t: string) => t.trim())
				.filter((t: string) => t.length > 0)
			const text = parts.join(separator)
			return ok({ main: text, text })
		},

		/**
		 * A model's JSON answer, read back as data.
		 *
		 * ## Three failures, one answer
		 *
		 * A fenced block, a preamble the model could not resist, and a reply cut
		 * off by the token limit are all "there is no readable answer here", and
		 * `extractJson` separates the third from the other two by walking brace
		 * depth rather than slicing to the last `}`. Every reader of a model's
		 * JSON goes through that one walker, so a trailing "hope that helps!"
		 * costs the same nothing everywhere.
		 *
		 * ## `err`, never `halt`
		 *
		 * The type declares `optional`, so an `err` is absorbed as
		 * `recoveredAsEmpty` with the reason on the receipt and every downstream
		 * port reads absent — a `map` over the missing list runs zero times, a
		 * template renders no block. A halt would stop the turn instead, which
		 * is the wrong cost: a planner that ignored its schema should lose the
		 * turn its plan, not its reply.
		 *
		 * ## `path` is what makes the answer wireable
		 *
		 * A data reference is `{node, port}` with no sub-path, so a `map` cannot
		 * iterate `plan.speakers` off a port carrying the whole document. `json`
		 * is always the document; `value` and `items` are whatever `path`
		 * selects, and `items` is that as a list so a map wired to it never has
		 * to defend itself.
		 */
		"core:task/parse-json@1": async (
			input: NodeInput<typeof C.parseJson>
		) => {
			const raw = typeof input?.text === "string" ? input.text : ""
			if (!raw.trim())
				return err(
					"there was nothing to read — the step above produced no text"
				)
			const { extractJson, JsonExtractionError } = await import(
				"$lib/server/utils/extractJson"
			)
			let json: unknown
			try {
				json = JSON.parse(extractJson(raw))
			} catch (e) {
				const truncated =
					e instanceof JsonExtractionError && e.truncated
				return err(
					truncated
						? "the answer stopped in the middle of its JSON, which usually means the reply hit its token limit"
						: "the answer was not readable as JSON"
				)
			}
			const path =
				typeof input?.params?.path === "string"
					? input.params.path.trim()
					: ""
			let value: unknown = json
			for (const segment of path ? path.split(".") : []) {
				if (value == null || typeof value !== "object") {
					value = undefined
					break
				}
				value = (value as Record<string, unknown>)[segment]
			}
			// A single value becomes a one-element list and an absent one an
			// empty list, so a `map` wired to `items` is always wired to a list.
			const items = Array.isArray(value)
				? value
				: value == null
					? []
					: [value]
			return ok({ main: json, json, value, items })
		},

		/**
		 * The cut, and the one decision it is allowed to make.
		 *
		 * `batchTokens` is the admin's knob — *how many tokens of chat one draft
		 * is written against* — and it arrives through the node's `params` slot
		 * with the declared default already applied by the executor. The
		 * `sampling` slot is the drafting step's own, shared by reference so the
		 * window clamped against here is by construction the window the batch is
		 * sent against; `resolveBatchBudget` holds the arithmetic, shared with
		 * `summarizer/index.ts` so the two cannot drift again.
		 *
		 * ⚠ The reserve is no longer subtracted from the declared size. It was —
		 * `Math.max(batchTokens - 1500, 500)` — which made an admin asking for
		 * 2048 tokens of chat receive 548, contradicting the declaration's own
		 * words. The reserve is what the CLAMP accounts for now, so the number
		 * an admin types is the number of chat tokens they get.
		 */
		"core:task/batch-messages@1": async (
			input: NodeInput<typeof C.batchMessages>
		) => {
			const messages: any[] = Array.isArray(input?.messages)
				? input.messages
				: []
			const resolved = resolveBatchBudget({
				batchTokens: input?.params?.batchTokens,
				sampling: input?.sampling
			})
			// A window too small to hold the reserve plus a batch worth drafting
			// cannot be summarized against at all. Said out loud, once, rather
			// than sent as a prompt the model has no room for — which is what
			// this path did, with no truncation anywhere to catch it.
			if (!resolved.fits) return halt(resolved.reason)
			const budget = resolved.tokens

			const batches: any[][] = []
			let current: any[] = []
			let tokens = 0

			for (const msg of messages) {
				// Deliberately the flat estimate rather than the run's
				// tokenizer. This is not context fitting: it decides how many
				// messages go into one summarization batch, and the reserve that
				// keeps room for the prompt and the draft is accounted for in the
				// budget above. Making it exact would change nothing a person can
				// observe, and it would make `ctx` a parameter of a binding that
				// otherwise needs none.
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
		 * A declared in-port carrying an authored literal, not a parameter —
		 * see the contract, which rules on why the call site settles it.
		 */
		"core:provider/summarize-batch@1": async (
			input: NodeInput<
				typeof C.summarizeBatch,
				Unsupplied<"topic", WhyFlatTopic>
			>,
			ctx: ProviderCtx
		) => {
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
				...stepSlots(input),
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
		"core:provider/summarize-synth@1": async (
			input: NodeInput<
				typeof C.summarizeSynth,
				Unsupplied<"topic", WhyFlatTopic>
			>,
			ctx: ProviderCtx
		) => {
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
				...stepSlots(input),
				label: "summarize:synth"
			})
			if (!result?.text)
				return halt("the model returned nothing to synthesize into")

			const content =
				parseSummaryOutput(result.text).content ?? result.text
			return ok({ main: content, content })
		},

		"core:provider/name-entry@1": async (
			input: NodeInput<typeof C.nameEntry>,
			ctx: ProviderCtx
		) => {
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
				...stepSlots(input),
				label: "summarize:name"
			})

			// A nameless entry is still an entry. The content is the valuable
			// part, and halting here would throw away a finished summary over
			// its title.
			const name = (result?.text ?? "").trim()
			return ok({ main: name, name })
		},

		"core:provider/extract-cast@1": async (
			input: NodeInput<
				typeof C.extractCast,
				Unsupplied<
					"knownCast",
					"a flat spelling of `request.knownCast`, which is the declared port's payload"
				>
			>,
			ctx: ProviderCtx
		) => {
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
				...stepSlots(input),
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

		/**
		 * The keywords an entry is proposed to be found by — no model, no
		 * network, nothing it can invent.
		 *
		 * A wrapper around `proposeKeys`, like every other binding here: the
		 * rules, the gates and the measurements live in
		 * `ranking/keyProposal.ts`, and this only decides what the lorebook and
		 * the cast are.
		 *
		 * ⚠ **The reads are the ones `loreFor` makes, with the same arguments.**
		 * `currentCharacterId` is passed through rather than nulled, so the host
		 * withholds character lore that is not the speaker's own exactly as it
		 * does for retrieval. A key proposer that read *more* of the book than
		 * the ranker can would be a second visibility rule, free to disagree
		 * with the first — which is the shape of bug 2, arriving from the
		 * authoring side.
		 */
		"core:query/entry-keys@1": async (
			input: NodeInput<typeof C.entryKeys>,
			ctx: CoreQueryCtx
		) => {
			const content =
				typeof input?.content === "string" ? input.content : ""
			const empty = { main: [], keys: [], rejected: [] }
			if (!content.trim()) return ok(empty)

			const [entries, cast] = await Promise.all([
				ctx.read("lorebook_entries", {
					sessionId: input?.scope?.sessionId,
					currentCharacterId: input?.scope?.currentCharacterId ?? null
				}),
				// Read for its names alone — see `castEntityRefs`. A session
				// that no longer exists reads as `null`, which is an empty cast,
				// which is a proposer with one of its two guards missing rather
				// than one that fails.
				ctx.read("session_cast", { sessionId: input?.scope?.sessionId })
			])
			const rows: any[] = entries ?? []

			/**
			 * ⚠ **The entry being keyed must not be in its own corpus.**
			 *
			 * On the summarize path it cannot be — the row does not exist yet.
			 * On a re-key of a saved entry it would be, and its own text would
			 * put a guaranteed hit into every key's footprint, which is the one
			 * count the ceiling is measured against. Dropping the document that
			 * *contains* the passage is exact for that case and a no-op for the
			 * one where the row is absent.
			 */
			const documents = rows
				.map((e) => `${e?.name ?? ""} ${e?.content ?? ""}`.trim())
				.filter((d) => !d.includes(content))

			const proposal = proposeKeys({
				text: content,
				corpus: documents,
				cast: castEntityRefs(cast),
				// Entry titles are eligible keys and cast names are not: a thing
				// the book has a row for is a subject, a person in it is a
				// participant. Appended after the cast because `buildGazetteer`
				// lets the first claimant keep a name.
				entryNames: rows.flatMap((e) =>
					typeof e?.name === "string" && e.name.trim()
						? [
								{
									name: e.name.trim(),
									ref: { kind: "entry" as const, id: e.id }
								}
							]
						: []
				),
				options: {
					maxKeys: Math.max(0, input?.params?.maxKeys ?? MAX_KEYS),
					maxTermKeys: Math.max(
						0,
						input?.params?.maxOrdinaryWords ?? MAX_TERM_KEYS
					)
				}
			})

			// `main` carries the proposals themselves rather than the bare
			// strings, for `session-history`'s reason: an unrefined `$.keys`
			// should resolve to the useful thing, and what a review gate needs
			// is the evidence beside each key, not a list of words.
			return ok({
				main: proposal.keys,
				keys: proposal.keys,
				rejected: proposal.rejected
			})
		},

		// ── Graph build ─────────────────────────────────────────────────────

		"core:query/graph-scenes@1": async (
			input: NodeInput<typeof C.graphScenes>,
			ctx: CoreQueryCtx
		) => {
			const scenes = await ctx.read("graph_scenes", {
				sessionId: input?.scope?.sessionId
			})
			return ok({ main: scenes, scenes })
		},

		...graphSteps(),

		// ── Consumers ───────────────────────────────────────────────────────
		// The binding describes the write; the host performs it. Returning the
		// payload unchanged is the correct implementation, not a stub.
		"core:consumer/create-message@1": async (
			input: NodeInput<typeof C.createMessage>,
			ctx: ConsumerCtx
		) => ok(await ctx.commit(input)),
		"core:consumer/seed-greetings@1": async (
			input: NodeInput<typeof C.seedGreetings>,
			ctx: ConsumerCtx
		) => ok(await ctx.commit(input)),
		"core:consumer/update-message@1": async (
			input: NodeInput<typeof C.updateMessage>,
			ctx: ConsumerCtx
		) => ok(await ctx.commit(input)),
		"core:consumer/create-lore-entry@1": async (
			input: NodeInput<typeof C.createLoreEntry>,
			ctx: ConsumerCtx
		) => ok(await ctx.commit(input)),
		// Gate-eligible, and that is the mechanism behind "a graph build stops at
		// the review screen": what comes back is a proposal, not rows.
		"core:consumer/graph-proposal@1": async (
			input: NodeInput<typeof C.graphProposal>,
			ctx: ConsumerCtx
		) => ok(await ctx.commit(input))
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

	/**
	 * The Adventure genre's four agent surfaces, on the same one implementation.
	 *
	 * They are separate *types* for a mechanical reason rather than a stylistic
	 * one: a shipped prompt is resolved per (node type, slot) per spec, so four
	 * agents sharing a context type would ship four agents one set of
	 * instructions. What they add on top of the shared builder is one merge each
	 * — the facts the shared builder has no port for — and `mergeContext` is the
	 * one place that happens, so the four cannot come to disagree about how a
	 * key reaches a template.
	 *
	 * ⚠ Every extra key is a VARIABLE — something an authored prompt row and an
	 * authored template render (`{{tone}}`, `{{location}}`) and nothing else
	 * reads. None of them reaches the resolution input: `resolveContextInput`
	 * owns the card rules and nothing here may reach into them.
	 */
	const mergeContext =
		(
			extras: (input: any) => Record<string, unknown> = () => ({}),
			/**
			 * What the shared builder is asked, where this surface asks it
			 * something different.
			 *
			 * The narrator is the one that needs it: every other agent here
			 * builds its context as the session's current speaker, and the
			 * narrator must not be anybody. Kept as a parameter rather than a
			 * fourth wrapper, so "what this surface adds" and "what it asks"
			 * sit in one place per agent.
			 */
			prepare: (input: any) => any = (input) => input
		) =>
		async (input: any, ctx: TaskCtx) => {
			/**
			 * ⚠ **Handed to the builder, not merged onto its answer.**
			 *
			 * `instructions` is interpolated INSIDE the builder, so a shipped
			 * prompt saying "Difficulty is {{difficulty}}" rendered
			 * "Difficulty is " for as long as these were merged afterwards.
			 * The merge below stays, because the same keys are read by the
			 * assembly template; what changed is that the builder sees them
			 * first.
			 */
			const variables = {
				...genreFields(input),
				...adventureVariables(input),
				...extras(input)
			}
			const base = await bindings["core:task/build-template-context@1"]!(
				{ ...prepare(input), fields: variables },
				ctx
			)
			if (base.kind !== "ok") return base
			const value = base.value as {
				main: unknown
				templateContext: Record<string, unknown>
			}
			const merged = { ...value.templateContext, ...variables }
			return ok({ ...value, main: merged, templateContext: merged })
		}

	/**
	 * The genre's declared fields, by their own names.
	 *
	 * `{{tone}}` and `{{difficulty}}` are what a shipped Adventure prompt
	 * writes, and this is the step that makes them render: declared on the
	 * genre, edited in session settings, stored on the row, published by the
	 * input node, and read here. Filtered to a plain object because it is a
	 * `json` port and a list or a string arriving there must not spread.
	 */
	const genreFields = (input: any): Record<string, unknown> =>
		input?.fields &&
		typeof input.fields === "object" &&
		!Array.isArray(input.fields)
			? (input.fields as Record<string, unknown>)
			: {}

	/**
	 * The facts every agent in a planned turn is given before it writes:
	 * `{{location}}`, `{{timeOfDay}}`, `{{weather}}`, `{{beats}}`,
	 * `{{stateSummary}}` and `{{slots}}`.
	 *
	 * Computed here rather than left to the template, because `state` and
	 * `plan` are STRUCTURE: a template writing `{{{state}}}` over an object
	 * renders `[object Object]`, which is exactly what the shipped narrator
	 * template did on every live turn. See `prompt/adventureContext.ts`.
	 *
	 * Gated on there being a state or a plan at all, so the one non-adventure
	 * pipeline that shares a surface here — `core:spec/narrate-character`,
	 * which wires neither — gets the context it always got, key for key.
	 */
	const adventureVariables = (input: any): Record<string, unknown> => {
		if (!input?.state && !input?.plan) return {}
		const cast = input?.cast ?? input?.main
		const names = (
			Array.isArray(cast?.sessionCharacters) ? cast.sessionCharacters : []
		)
			.map((cc: any) => cc?.character?.name)
			.filter((n: unknown): n is string => typeof n === "string")
		return {
			...sceneAnchor(input.state, input.plan),
			stateSummary: stateSummary(input.state, names),
			slots: slotGuide(input.state)
		}
	}

	bindings["core:task/build-planner-context@1"] = mergeContext() as any

	/**
	 * Nobody is speaking, and that is the whole of the narrator stage.
	 *
	 * `resolveContextInput` keys everything off `currentCharacterId`: the card
	 * shown at full visibility, what `{{char}}` renders, and — the one that
	 * decides how the reply reads — the NAME on the line the model continues
	 * from. With the session's speaker still set, the narrator's prompt ended
	 * `Verity:` and the scene came back as Verity in the first person, however
	 * plainly the instructions said to narrate.
	 *
	 * Cleared on the cast bundle as well as on the input, because the speaker
	 * travels WITH the cast (`session-cast@1`) and the builder falls through to
	 * it. Clearing one of the two is clearing neither.
	 *
	 * The seed name then falls to the prompts slot's `narratorName`, which is
	 * the same rung `build-narrator-context@1` lands on and the reason that
	 * field is declared on this node's prompts slot.
	 */
	const asNarrator = (input: any) => {
		const cast = input?.cast ?? input?.main
		return {
			...input,
			currentCharacterId: null,
			...(cast && typeof cast === "object"
				? { cast: { ...cast, currentCharacterId: null } }
				: {})
		}
	}

	bindings["core:task/build-scene-context@1"] = mergeContext(
		(input) => ({
			// What the planning step decided this turn is about, as structure,
			// for a template that wants to walk it. The narrator reads its
			// beats through `{{beats}}` instead, which is text.
			plan: input?.plan
		}),
		asNarrator
	) as any

	bindings["core:task/build-keeper-context@1"] = mergeContext((input) => ({
		// The reply this keeper is reporting on. The transcript does not carry
		// it yet: it was written by the node immediately above.
		reply: typeof input?.reply === "string" ? input.reply : undefined
		// ⚠ `afterWrite` stays off the template context. It is an ordering
		// edge — the reply's write result, taken on a port so this node runs
		// after the write rather than beside it — and a write result in a
		// prompt is a row id the model reads as prose.
	})) as any

	/**
	 * The third surface, and the one place the implementation genuinely differs.
	 *
	 * Not an alias, because this node takes a `speaker` in-port the other two do
	 * not have and the name on it has to reach `{{char}}` and the seed line.
	 * Everything after that is the shared builder called with two more fields —
	 * `resolveContextInput` owns both rules, so a side character's card and a
	 * cast member's are compiled by one function rather than two.
	 *
	 * ⚠ The speaker is read from the port and never invented here. A missing or
	 * malformed `speaker` degrades to the no-perspective branch — the narrator's
	 * — rather than halting: a turn with no name is a turn the trigger failed to
	 * shape, and the receipt shows an empty speaker on the input node, which
	 * says so far more precisely than a halt in the context builder would.
	 *
	 * ⚠ **The port decides who is speaking — the name, the card AND the id.**
	 *
	 * `resolveContextInput` keys everything off `currentCharacterId`: the card
	 * at full visibility, what `{{char}}` renders, the example dialogue, and the
	 * name on the line the model continues from. A spec that names a speaker on
	 * the port and leaves the session's own speaker in place is therefore asking
	 * for one person's turn and building another's prompt — which is what two
	 * voices in a multi-agent turn both seeded with the same name is.
	 *
	 * So the id is DERIVED from the port rather than taken beside it, which
	 * keeps one source for one fact: a name the cast holds resolves to that
	 * member, a name it does not resolves to nobody, and that second branch is
	 * the one a genuine side character takes so `speakerName` reaches the seed.
	 * A spec that wires no speaker at all keeps the session's, untouched.
	 */
	const asSideCharacter = (
		input: NodeInput<typeof C.buildSideCharacterContext>
	) => {
		const speaker = (input?.speaker ?? {}) as {
			name?: unknown
			character?: unknown
		}
		const name = typeof speaker.name === "string" ? speaker.name.trim() : ""
		const cast = (input?.cast ?? (input as any)?.main) as any
		// Matched on name and nickname alike: either can open a line in a
		// transcript, and a planner names whichever the conversation uses.
		const seated = Array.isArray(cast?.sessionCharacters)
			? cast.sessionCharacters
			: []
		const matches = (character: any) => {
			const known = [character?.name, character?.nickname]
				.filter((n: unknown): n is string => typeof n === "string")
				.map((n) => n.trim().toLowerCase())
			return known.includes(name.toLowerCase())
		}
		const speaking = name
			? (seated.find((cc: any) => matches(cc?.character))?.character
					?.id ?? null)
			: null
		return {
			...input,
			speakerName: name || undefined,
			speakerCharacter:
				speaker.character && typeof speaker.character === "object"
					? speaker.character
					: null,
			// Only when the port named somebody: a spec that wires no
			// speaker at all keeps the session's, which is every pipeline
			// this node served before the adventure genre existed.
			...(name
				? {
						currentCharacterId: speaking,
						...(cast && typeof cast === "object"
							? {
									cast: {
										...cast,
										currentCharacterId: speaking
									}
								}
							: {})
					}
				: {})
		}
	}

	/**
	 * ⚠ **Through `mergeContext` like its three siblings**, so a voice is told
	 * where it is standing and who else is there. Without it a voice answered
	 * from whatever the transcript suggested and walked the scene to a harbour
	 * the plan had never mentioned. `core:spec/narrate-character` wires neither
	 * `state` nor `plan`, so its context is unchanged key for key.
	 */
	bindings["core:task/build-side-character-context@1"] = mergeContext(
		() => ({}),
		asSideCharacter
	) as any

	return bindings
}

/**
 * The five graph steps, which differ only in which prompt field they read.
 *
 * Written as a loop because the difference between them genuinely is one
 * string: five near-identical bindings would be five places to fix the next
 * time the call shape changes, and the fifth is the one that gets missed.
 */
/**
 * The five graph steps one loop binds. Unlike the three groups above this one
 * is **derived** rather than restated — `GRAPH_STEPS` below is the same array
 * the loop iterates, so there is nothing here to drift.
 */
/**
 * The five graph steps, as `[typeId, promptField, label]`.
 *
 * Hoisted out of `graphSteps()` so the group is readable as data. Unlike
 * `LORE_LANES` and its two siblings this one is **derived rather than
 * restated** — the loop below binds exactly these ids and `bindingCompat.ts`
 * reads exactly this array, so there is no second list to drift.
 */
const GRAPH_STEPS: Array<[string, string, string]> = [
	["core:provider/graph-pre-filter@1", "preFilter", "graph:pre-filter"],
	[
		"core:provider/graph-node-resolution@1",
		"nodeResolution",
		"graph:node-resolution"
	],
	["core:provider/graph-perspective@1", "perspective", "graph:perspective"],
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

function graphSteps(): Bindings {
	const steps = GRAPH_STEPS

	return Object.fromEntries(
		steps.map(([typeId, field, label]) => [
			typeId,
			// The five differ in one string, so one input type covers them —
			// and `SharedInput` is what says so in the type rather than in
			// this comment. Each declares `scenes` in and the
			// connection/sampling/prompts slots; the intersection is exactly
			// what the loop below reads.
			async (
				input: SharedInput<
					[
						typeof C.graphPreFilter,
						typeof C.graphNodeResolution,
						typeof C.graphPerspective,
						typeof C.graphNodeDescription,
						typeof C.graphStateDetection
					]
				>,
				ctx: ProviderCtx
			) => {
				const result: any = await ctx.call({
					systemPrompt: input?.prompts?.[field] ?? "",
					scenes: input?.scenes ?? [],
					...stepSlots(input),
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

/**
 * Every core handler that serves more than one node type, and which types.
 *
 * The runtime shadow of the `SharedInput<[…]>` annotations — see `LORE_LANES`
 * for why the two lists are separate and how they are kept honest.
 *
 * ⚠ **A handler missing from this list is not caught by anything**, and the
 * limit is worth stating rather than discovering. `bindingCompat.ts` checks
 * that every group named here is whole and that its members still have
 * something in common; it cannot see a handler that serves two ids and says
 * so nowhere. That was the state of this file four times over — `loreFor`,
 * `readGraph`, `pickSpeaker` and `graphSteps`, the last of which even said
 * "one input type covers them" in a comment — each typed against one of its
 * types with the others assumed to match. Assumed correctly, as it happens;
 * assumed nonetheless. Adding a multi-type handler means adding it here, and
 * the `SharedInput<[…]>` on its `input` is the reminder.
 */
export const SHARED_CORE_HANDLERS: ReadonlyArray<{
	handler: string
	typeIds: readonly string[]
}> = [
	{ handler: "loreFor", typeIds: LORE_LANES },
	{ handler: "readGraph", typeIds: RELATIONSHIP_NODES },
	{ handler: "pickSpeaker", typeIds: TURN_STRATEGIES },
	{ handler: "graphSteps", typeIds: GRAPH_STEPS.map(([id]) => id) }
]
