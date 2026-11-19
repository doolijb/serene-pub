/**
 * Retrieval bindings: the lorebook listing, the three lore lanes and the
 * `loreFor` scan they share, lorebook triggers, vector search,
 * entity search, mention spans, entity links and docs search, with the
 * constants and read declarations they use. `coreBindings()` spreads this map.
 *
 * Imports helpers from `bindings.shared.ts`, never from `bindings.ts`.
 */

import type { Bindings, TypedReads } from "@serene-pub/sdk"
import {
	ok,
	reads,
	bandIntent,
	isBandPriority,
	splitCandidates,
	withBandIntents
} from "@serene-pub/sdk"
/**
 * The node declarations themselves, as types.
 *
 * `import type`, so `verbatimModuleSyntax` erases it outright: importing
 * contracts for real would run `describeQueryDefinition`'s `register()` for every core
 * type as a side effect of loading the runtime, which is the boot sequence's job
 * and not this file's.
 */
import type * as C from "@serene-pub/contracts"
import { entitySearch as entitySearchContract } from "@serene-pub/contracts"
import type { CoreQueryCtx, NodeInput, SharedInput } from "./bindingTypes"
import {
	keywordQuery,
	normaliseTfidf,
	SHELVED_SKIP_REASONS
} from "$lib/server/pipelines/ranking/keywordQuery"
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
	DEFAULT_SIGNAL_WEIGHTS,
	isLexicalScoring,
	withDefaults,
	type RetrievalBand
} from "$lib/server/pipelines/ranking/weights"
import { processMessages } from "$lib/server/pipelines/prompt/messages"
import {
	docsExcerptContent,
	docsQueryTerms,
	searchDocs,
	type DocsQueryMessage
} from "$lib/server/pipelines/runtime/docsRetrieval"
import {
	knowledgeDropOf,
	knowledgeDropReceipt
} from "$lib/server/lorebooks/entryKnowledge"
import {
	STATUS,
	bandIntentFrom,
	castEntityRefs,
	speakerInCastQuery
} from "./bindings.shared"
import { historyLeftOutReceipt } from "./host.read.lorebookEntries"
import {
	inCastHistoryOf,
	inCastHistoryReceipt
} from "$lib/server/sessions/speakerInCast"

/**
 * How many recent rows the lore scans read before `scanDepth` narrows them.
 *
 * A read window, not a control: `scanDepth` and `guaranteedMessages` (declared
 * params) decide what the scan looks at; this bounds the fetch that feeds
 * them. A literal rather than a read of `input.limit`, because no lane declares
 * that name and nothing supplies it — 100 is what every run takes.
 */
const LORE_MESSAGE_WINDOW = 100

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
/**
 * The entries a keyword scan found and then ruled out on their own selective
 * logic, as eligibility verdicts (`exclusions`, plan C2). A copy of one that a
 * later mechanism brings in is the entry the author said *not here*, and
 * `core:task/eligibility@1` marks it with this sentence. Disabled and shelved
 * rows are not verdicts: they never reach any mechanism's pool.
 */
export function exclusionsFrom(
	skipped: readonly any[] | null | undefined
): Array<{ source: string; id: number | string; reason: string }> {
	return (skipped ?? [])
		.filter(
			(s) =>
				s?.kind === "excluded" &&
				s.id !== undefined &&
				s.source &&
				// A shelved row (disabled, archived) is not a verdict.
				!SHELVED_SKIP_REASONS.has(s.reason)
		)
		.map((s) => ({
			source: String(s.source),
			id: s.id,
			reason:
				typeof s.reason === "string" && s.reason
					? `Ruled out by its own condition: ${s.reason}.`
					: "Ruled out by its own condition."
		}))
}

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
 * `core:query/lorebook-entries@1`'s `limit`, made safe to hand to SQL.
 *
 * ⚠ The three numbers are the declaration's — `default: 500`, `min: 1`,
 * `max: 2000` — written out a second time here, which is the shape
 * `session-history@1`'s `?? 100` above already has and for its reason: a
 * declared bound is what the panel offers and what a spec author is told, and
 * neither is what a stored config or a hand-written document is obliged to
 * contain. The read is the one place the bound is load-bearing, so it is
 * enforced at the read. **Move one and move the other**, in the same change.
 *
 * Anything that is not a finite **number** — absent, null, a string somebody
 * typed into a JSON document — is the default, so nothing can turn into a
 * `LIMIT NaN`. A number outside the range is pulled into it: this node has no
 * "0 is off" convention, so 0 asks for one row rather than silently for an
 * empty book.
 *
 * ⚠ `typeof`, deliberately, and **not** `Number.isFinite(Number(asked))`: that
 * spelling is finite for `null`, `""`, `[]` and `false` — every one of them 0 —
 * so a stored null would have asked for the single row 0 clamps to instead of
 * the 500 the declaration promises. The field declares `type: 'integer'`; a
 * value that is not one is not a number this node was given.
 */
const clampListingLimit = (asked: unknown): number =>
	typeof asked === "number" && Number.isFinite(asked)
		? Math.min(Math.max(Math.trunc(asked), 1), 2000)
		: 500

/**
 * One lorebook scan, filtered to a single source.
 *
 * Shared by the world-lore and character-lore queries. Both read the same rows
 * and run the same matcher — the split is about giving each its own weight,
 * minimum and share, not about retrieving differently — so the scan lives here
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

/**
 * What the keyword scan reads, declared once for the four definitions that
 * run it — the three lanes and `lorebook-triggers`, which declare identically
 * from one `loreSlots()` helper. Typed against the intersection, so a param one
 * lane adds is not declared read on the others until they declare it too.
 */
const LORE_READS = {
	ports: ["scope"],
	params: [
		"scanDepth",
		"guaranteedMessages",
		"maxRecursionDepth",
		"admitThreshold",
		"lexicalScoring",
		"trigramFolding",
		"titleWeight"
	]
} as const satisfies TypedReads<
	[
		typeof C.worldLore,
		typeof C.characterLore,
		typeof C.historyEntries,
		typeof C.lorebookTriggers
	]
>

/**
 * The three lanes read their own band intent on top of the shared scan
 * (R-7 P5): `share`, `maxEntries`, `priority` — each lane's own through the
 * `slot.params({ node })` reference, unmarked `shared` on the declaration.
 * `lorebook-triggers` declares the same three PER BAND under namespaced
 * names (`TRIGGER_READS`), which is why neither set is in `LORE_READS`.
 */
const LANE_READS = {
	ports: LORE_READS.ports,
	params: [
		...LORE_READS.params,
		"share",
		"maxEntries",
		"priority",
		"knownToSpeaker",
		"speakerInCast"
	]
} as const satisfies TypedReads<
	[typeof C.worldLore, typeof C.characterLore, typeof C.historyEntries]
>

/**
 * The character-lore lane's own declaration — `LANE_READS` plus the one port
 * its two siblings do not have: `speaker` (W1, 2026-09-17).
 *
 * Its own rather than a fourth name in `LANE_READS`, because that constant is
 * typed against the intersection of the three lanes and a port only one of
 * them declares is not in it. Which is the check working: world lore and
 * history are not gated by a binding, so a speaker port on them would be a
 * control that reads nothing.
 */
const CHARACTER_LANE_READS = {
	ports: [...LANE_READS.ports, "speaker"],
	params: LANE_READS.params
} as const satisfies TypedReads<typeof C.characterLore>

/**
 * The history-entries lane's own declaration: `LANE_READS` plus the two
 * opt-in ports its siblings do not have, `firsthandFor` and `firsthandBy`.
 * Its own because `LANE_READS` is typed against the three lanes' intersection.
 */
const HISTORY_LANE_READS = {
	ports: [...LANE_READS.ports, "firsthandFor", "firsthandBy"],
	params: LANE_READS.params
} as const satisfies TypedReads<typeof C.historyEntries>

/**
 * `core:query/history-entries@1`: the lane, then firsthand (when its port is
 * wired). 🚧 `speakerInCast` is judged in the host's lore read, which `loreFor`
 * asks (off when this lane's param says `false`).
 */
async function historyEntriesRead(
	input: NodeInput<typeof C.historyEntries>,
	ctx: CoreQueryCtx
) {
	return await historyFirsthand(input, ctx)
}

async function historyFirsthand(
	input: NodeInput<typeof C.historyEntries>,
	ctx: CoreQueryCtx
) {
	const lane = (await loreFor("history", input, ctx)) as any
	// 🚧 What the speaking character was there for: invoked only when the
	// `firsthandFor` port is wired (key present, even when null: a
	// narrator turn reads everything). The left-out entries are published
	// on `exclusions` so eligibility blocks every copy (keyword, entity
	// search, vector); `main`, `hits` and `skipped` are untouched. The
	// decision is `sessions/firsthandFilter.ts`.
	if (
		lane?.kind !== "ok" ||
		input === undefined ||
		input === null ||
		typeof input !== "object" ||
		!("firsthandFor" in input)
	)
		return lane
	const sessionId = (input as any)?.scope?.sessionId
	const by =
		typeof (input as any).firsthandBy === "string" &&
		(input as any).firsthandBy.trim()
			? (input as any).firsthandBy.trim()
			: null
	const {
		loadFirsthandView,
		leftOutEntryIds,
		historyReceipt,
		historyExclusionReason,
		readsAllReceipt
	} = await import("$lib/server/sessions/firsthandFilter")
	const db = (await import("$lib/server/db")).db as never
	const read =
		typeof sessionId === "number"
			? await loadFirsthandView(db, {
					sessionId,
					characterId: (input as any).firsthandFor,
					castMemberId: (input as any)?.scope?.currentCastMemberId,
					slotId: by,
					judgeHistoryEntries: true
				})
			: ({ kind: "reads-all" } as const)
	if (read.kind === "reads-all") {
		ctx.log("info", readsAllReceipt())
		return lane
	}
	const ids = leftOutEntryIds(read.view)
	ctx.log("info", historyReceipt(read.view, ids.length))
	const reason = historyExclusionReason(read.view)
	return ok({
		...lane.value,
		exclusions: [
			...(lane.value?.exclusions ?? []),
			...ids.map((id) => ({ source: "history", id, reason }))
		]
	})
}

/**
 * The three lore bands `lorebook-triggers` produces through one port, and
 * the namespaced intent each declares (`worldLoreShare` … — see
 * `bandIntentFieldsOf` in the contracts; U3b review W1). One table, read by
 * `TRIGGER_READS` for the declaration and by the handler for the three
 * intents it publishes, so a band cannot be declared and not published or
 * the reverse.
 */
const TRIGGER_BANDS = {
	worldLore: {
		share: "worldLoreShare",
		maxEntries: "worldLoreMaxEntries",
		priority: "worldLorePriority"
	},
	characterLore: {
		share: "characterLoreShare",
		maxEntries: "characterLoreMaxEntries",
		priority: "characterLorePriority"
	},
	history: {
		share: "historyShare",
		maxEntries: "historyMaxEntries",
		priority: "historyPriority"
	}
} as const

const TRIGGER_READS = {
	// `speaker` (W1) for the reason `CHARACTER_LANE_READS` gives: this node
	// produces the character-lore band too, through the same gated read.
	ports: [...LORE_READS.ports, "speaker"],
	params: [
		...LORE_READS.params,
		...Object.values(TRIGGER_BANDS).flatMap(
			(f) => [f.share, f.maxEntries, f.priority] as const
		),
		"knownToSpeaker",
		"speakerInCast"
	]
} as const satisfies TypedReads<typeof C.lorebookTriggers>

/** 🚧 The timeline-off receipt, said once for a read whose answer would have held history. */
function logHistoryLeftOut(ctx: CoreQueryCtx, entries: unknown): void {
	const line = historyLeftOutReceipt(entries)
	if (line) ctx.log("info", line)
}

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
		[typeof C.worldLore, typeof C.characterLore, typeof C.historyEntries]
	>,
	ctx: CoreQueryCtx,
	/**
	 * Whose private lore this read is for, as a participant reference (W1,
	 * 2026-09-17) — `core:query/character-lore@1`'s `speaker` in-port, passed
	 * only by that lane's arrow because it is the only one of the three whose
	 * band is gated by a binding. `undefined` is the port unwired, and the host
	 * then keys the gate on the run's scope exactly as it always did; the host
	 * owns what any other value means (`loreVisibilitySubject`), because
	 * resolving a reference to a row is a question only it can answer.
	 */
	speaker?: unknown
) {
	ctx.status?.(STATUS.thinking)
	const params = withDefaults(retrievalParamsFrom(input?.params))
	// On unless a pipeline says `false` (the param's default is `true`).
	const knownToSpeaker = input?.params?.knownToSpeaker !== false
	const [entries, messages, embedding, cast] = await Promise.all([
		ctx.read("lorebook_entries", {
			knownToSpeaker,
			...speakerInCastQuery(input?.params),
			sessionId: input?.scope?.sessionId,
			currentCharacterId: input?.scope?.currentCharacterId ?? null,
			...(input?.scope?.currentCastMemberId != null
				? { currentCastMemberId: input.scope.currentCastMemberId }
				: {}),
			// Omitted rather than passed as `undefined`, so a lane that wires no
			// speaker hands the host the same query object it always did.
			...(speaker === undefined ? {} : { speaker })
		}),
		ctx.read("session_messages", {
			sessionId: input?.scope?.sessionId,
			limit: LORE_MESSAGE_WINDOW
		}),
		ctx.read("embedding_status", {}),
		// The cast is read for its names alone — see `castEntityRefs`. A
		// session that no longer exists reads as `null` here and scores the
		// signal 0 for every entry, which is what an empty cast means anyway.
		ctx.read("session_cast", { sessionId: input?.scope?.sessionId })
	])

	if (knownToSpeaker) {
		const drop = knowledgeDropOf(entries)
		if (drop) ctx.log("info", knowledgeDropReceipt(drop))
	}
	// Never from the world or character lane alone: they would not have held it.
	if (source === "history") {
		logHistoryLeftOut(ctx, entries)
		const judged = inCastHistoryOf(entries)
		if (judged)
			ctx.log(
				"info",
				judged.kind === "reads-all"
					? (
							await import("$lib/server/sessions/firsthandFilter")
						).readsAllReceipt()
					: inCastHistoryReceipt(
							judged.name,
							judged.shown,
							judged.leftOut,
							judged.cut
						)
			)
	}

	const result = keywordQuery({
		entries: entries ?? [],
		messages: messages ?? [],
		entityRefs: castEntityRefs(cast),
		retrieval: params.retrieval,
		// ⚠ Nothing about retrieval *routing* is handed to the scan: there is
		// no node `retrievalMode`, no per-entry retrieval strategy, and so no
		// `availability` to consult. Every mechanism runs; one this install cannot run subtracts its signal and
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
	/**
	 * The lane's own intent at the head of its candidates (R-7 P5): the
	 * ranker resolves this band's share, ceiling and priority from here,
	 * whether or not the scan found anything — an empty band still has a
	 * share, and that share still reserves-then-sweeps its slice.
	 */
	const published = withBandIntents(
		[bandIntentFrom(source, input?.params, { minimum: false })],
		mine
	)
	return ok({
		main: published,
		hits: published,
		exclusions: exclusionsFrom(mineSkipped),
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
			// This source's share, like `considered`: the regex keys of its
			// entries that were not run (plan S3), for the receipt's warning.
			patternsNotRun: result.diagnostics.patternsNotRun.filter(
				(p) => p.source === source
			),
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
 * ⚠ That is now the *only* thing this mapping decides, and it decides it:
 * `lorebook_entries` withholds every history row while the session's lorebook
 * keeps no timeline (D55), and an entry the speaker does not know. Its second
 * reader, `entityVectorArm`'s pool, keys off the same two vocabularies.
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
 * (graph nodes, cast rows) has no lore row to find and no strategy to honour.
 */
const LORE_SOURCES = new Set(["worldLore", "characterLore", "history"])

/**
 * What Search by meaning asks the index for: the lorebook's entries, in the
 * index's vocabulary (`RAG_INDEX_SOURCES`, which the host checks this against
 * on every read) — `LORE_SOURCES` below, with history spelled `historyEntry`.
 *
 * ⚠ **Only sources the prompt can place a ranked hit from** (plan A1). The
 * index holds four more, and each one cost lore without reaching the prompt:
 *
 * - `message` lands in the `messages` band, where the conversation's band
 *   intent keeps a minimum of six, so the ranker reserves its tokens before
 *   the lore shares divide the rest — and `assemble` builds the transcript
 *   from the history read's lines, never from ranked candidates.
 * - `narrativeNode`, `character` and `persona` have no band; the ranker drops
 *   them as `excluded_unknown_source`.
 * - `narrativeRelationship` reaches the `relationships` band with no lane, and
 *   the relationship sections render only laned ties (`rankedRelationships`).
 *
 * All four still took a `maxEntries` place here, ahead of any entry they
 * outscored, so the turn brought in fewer entries than the control says. The
 * eager index pass reads the same list, so a turn embeds nothing it will not
 * search.
 *
 * Retrieval over past lines is the entity mechanism's `messages` port, which
 * is its own band (`recalledLines`) and placed by a template, not by the
 * ranker's lore pool.
 */
/**
 * The retrieval-on-by-default numbers (R5, ruled 2026-09-30), as the SDK
 * declares them — read when a node's `params` slot is absent, so an unwired
 * slot behaves as the declaration says rather than as off.
 */
const DEFAULT_ENTITY_MAX_ENTRIES = 5

const DEFAULT_ENTITY_MAX_MESSAGES = 20

const DEFAULT_MAX_MENTIONS = 8

export const SEMANTIC_SEARCH_SOURCES = [
	"worldLore",
	"characterLore",
	"historyEntry"
] as const

/**
 * The band `core:query/docs-search@1` declares (`bands: { docsExcerpts }` on
 * its contract) — the intent's `band` and every candidate's `source`, which
 * must be the declared key for Assemble to render it as `{{{docsExcerpts}}}`.
 */
const DOCS_BAND = "docsExcerpts"

/**
 * The band `core:query/entity-search@1` declares for its recalled lines
 * (`bands: { recalledLines }`, carried on `messages` — `bandPorts`), and the
 * share its `recalledLinesShare` ships at, read from the declaration rather
 * than restated.
 */
const RECALLED_LINES_BAND = "recalledLines"

const RECALLED_LINES_SHARE = Number(
	(
		entitySearchContract.descriptor.slots?.params?.schema as
			| Record<string, { default?: unknown }>
			| undefined
	)?.recalledLinesShare?.default ?? 0
)

export function retrievalBindings(): Bindings {
	return {
		/**
		 * The **listing** door — the whole book, or the one entry named.
		 *
		 * Beside `session-history` rather than among the four lore definitions
		 * below, because it is the same kind of node as this one and not the
		 * same kind as those: it fetches rows a spec asked for, where they run
		 * a mechanism and publish candidates. Nothing here scores, ranks, or
		 * produces a band intent, and `main` carries a bare list rather than
		 * `core:shape/context-candidates@1` — see the definition.
		 *
		 * It exists because a create run has no conversation to scan, so the
		 * scan window is empty and only `constant` entries are admitted: a
		 * genre picking a secret, checking whether a room exists, or listing
		 * its suspects had no door (plans/genres §10 G13/G14, §11 L4).
		 *
		 * The two postures the read is asked for, and why they are not the
		 * scan's:
		 *
		 * · `enabled: true` / `archived: false` — a listing answers *does this
		 *   exist* and *pick one of these*, so a row the author switched off or
		 *   shelved must not be offered. The scan asks for neither and still
		 *   sees disabled rows, on purpose, so it can report them on `skipped`
		 *   with a reason. For a place this posture IS a session's place sight
		 *   (plan A27, `seesPlace(…, "session")`), so the rooms listed are the
		 *   places `state.locations` holds and every write door takes.
		 * · `currentCharacterId` passed through, exactly as the lore lanes pass
		 *   it. This is not a way around the binding-visibility policy: while a
		 *   character is speaking, another character's private lore stays out
		 *   of the list. In the case this node exists for it is null, the
		 *   policy is omniscient, and the whole book comes back.
		 */
		"core:query/lorebook-entries@1": reads<typeof C.lorebookEntries>(
			async (
				input: NodeInput<typeof C.lorebookEntries>,
				ctx: CoreQueryCtx
			) => {
				// On unless a pipeline says `false` (the param's default is `true`).
				const knownToSpeaker = input?.params?.knownToSpeaker !== false
				const entries = await ctx.read("lorebook_entries", {
					knownToSpeaker,
					...speakerInCastQuery(input?.params),
					sessionId: input?.scope?.sessionId,
					currentCharacterId:
						input?.scope?.currentCharacterId ?? null,
					...(input?.scope?.currentCastMemberId != null
						? { currentCastMemberId: input.scope.currentCastMemberId }
						: {}),
					entryTypes: input?.params?.entryTypes ?? [],
					name: input?.params?.name ?? "",
					/**
					 * The declared default and the declared ceiling, applied
					 * here as well as declared there.
					 *
					 * A parameter is a control, not a promise: `max: 2000`
					 * tells the panel what to offer and tells a spec author
					 * what is sensible, and neither of them is what a stored
					 * config or a hand-written document has to contain. The
					 * one place a bound on rows read is load-bearing is the
					 * read, so the clamp is at the read.
					 *
					 * A value that is not a number at all — absent, null, a
					 * string somebody typed into a JSON document — is the
					 * declared default, never `NaN` turned into a `LIMIT`. A
					 * number outside the declared range is pulled into it:
					 * this node has no "0 is off" convention, so 0 is 1 row
					 * rather than a silently empty book.
					 */
					limit: clampListingLimit(input?.params?.limit),
					enabled: true,
					archived: false,
					/**
					 * Each row's lore links, said from the row (places plan
					 * B2). Only a literal `true` asks: an unset control, a
					 * stored `null` or a string in a hand-written document
					 * reads the rows exactly as they always were.
					 */
					withLinks: input?.params?.withLinks === true
				})
				if (knownToSpeaker) {
					const drop = knowledgeDropOf(entries)
					if (drop) ctx.log("info", knowledgeDropReceipt(drop))
				}
				// Nothing is counted when `entryTypes` leaves history out of the read.
				logHistoryLeftOut(ctx, entries)
				// `main` and `entries` carry the same value, on
				// `session-history`'s terms: `main` is what an unrefined
				// `$.entries` resolves to, and having it be the list rather
				// than a wrapper is what makes the scope sugar read well.
				return ok({ main: entries, entries })
			},
			{
				ports: ["scope"],
				params: [
						"entryTypes",
						"name",
						"limit",
						"withLinks",
						"knownToSpeaker",
						"speakerInCast"
					]
			}
		),

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
		"core:query/world-lore@1": reads<typeof C.worldLore>(
			async (input: NodeInput<typeof C.worldLore>, ctx: CoreQueryCtx) =>
				await loreFor("worldLore", input, ctx),
			LANE_READS
		),
		/**
		 * The one gated lane, and the one that takes a `speaker` (W1): wired
		 * inside a repeating clause it names the voice THIS iteration writes as,
		 * so two voices in one turn read two pools from one gather.
		 */
		"core:query/character-lore@1": reads<typeof C.characterLore>(
			async (
				input: NodeInput<typeof C.characterLore>,
				ctx: CoreQueryCtx
			) => await loreFor("characterLore", input, ctx, input?.speaker),
			CHARACTER_LANE_READS
		),
		// ⚠ The third lane, absent between spec 1.8.0 and 1.10.0. The two lore
		// queries each filter the shared scan to their own source, and nothing
		// filtered for `history` — so those candidates were built, scored and
		// dropped, with the ranker still holding a `history` band and
		// `assemble` still asking for history blocks.
		"core:query/history-entries@1": reads<typeof C.historyEntries>(
			async (
				input: NodeInput<typeof C.historyEntries>,
				ctx: CoreQueryCtx
			) => {
				return await historyEntriesRead(input, ctx)
			},
			HISTORY_LANE_READS
		),
		"core:query/lorebook-triggers@1": reads<typeof C.lorebookTriggers>(
			async (
				input: NodeInput<typeof C.lorebookTriggers>,
				ctx: CoreQueryCtx
			) => {
				const params = withDefaults(retrievalParamsFrom(input?.params))
				// On unless a pipeline says `false` (the param's default is `true`).
				const knownToSpeaker = input?.params?.knownToSpeaker !== false
				const [entries, messages, embedding, cast] = await Promise.all([
					ctx.read("lorebook_entries", {
						knownToSpeaker,
						...speakerInCastQuery(input?.params),
						sessionId: input?.scope?.sessionId,
						currentCharacterId:
							input?.scope?.currentCharacterId ?? null,
						...(input?.scope?.currentCastMemberId != null
							? { currentCastMemberId: input.scope.currentCastMemberId }
							: {}),
						// The per-speaker subject (W1), on `loreFor`'s terms: this
						// node produces the character-lore band through the same
						// gated read, so it takes the same port.
						...(input?.speaker === undefined
							? {}
							: { speaker: input.speaker })
					}),
					ctx.read("session_messages", {
						sessionId: input?.scope?.sessionId,
						limit: LORE_MESSAGE_WINDOW
					}),
					ctx.read("embedding_status", {}),
					// See the other keyword mechanism: read for its names alone.
					ctx.read("session_cast", {
						sessionId: input?.scope?.sessionId
					})
				])

				if (knownToSpeaker) {
					const drop = knowledgeDropOf(entries)
					if (drop) ctx.log("info", knowledgeDropReceipt(drop))
				}
				logHistoryLeftOut(ctx, entries)

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
				/**
				 * Three band intents at the head of the list, one per band
				 * this node produces (R-7 P5; U3b review W1). Read off the
				 * node's own namespaced fields through the same
				 * `bandIntentFrom` the lanes use, so a share tuned here
				 * reaches the ranker DECLARED — before this the node published
				 * none and every lore band of the narrator's turn ran on the
				 * ranker's fallback, which nothing on this node could move.
				 */
				const p =
					input?.params && typeof input.params === "object"
						? (input.params as Record<string, unknown>)
						: {}
				const intents = (
					Object.keys(TRIGGER_BANDS) as Array<keyof typeof TRIGGER_BANDS>
				).map((band) =>
					bandIntentFrom(
						band,
						{
							share: p[TRIGGER_BANDS[band].share],
							maxEntries: p[TRIGGER_BANDS[band].maxEntries],
							priority: p[TRIGGER_BANDS[band].priority]
						},
						{ minimum: false }
					)
				)
				const published = withBandIntents(intents, candidates)
				return ok({
					main: published,
					hits: published,
					exclusions: exclusionsFrom(result.skipped),
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
			TRIGGER_READS
		),

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
		"core:query/vector-search@1": reads<typeof C.vectorSearch>(
			async (
				input: NodeInput<typeof C.vectorSearch>,
				ctx: CoreQueryCtx
			) => {
				ctx.status?.(STATUS.thinking)
				/**
				 * A **ceiling, not the switch** (2026-09-29, genre uplift C3).
				 *
				 * ⚠ It *was* the switch — 0, the shipped default, was off — and
				 * that was the defect: this is the chain's last node, so by the
				 * time 0 said nothing was wanted `embed-text` had already embedded
				 * the probes, on every turn with an embedding model ready. The
				 * switch is `query-windows.searchByMeaning` now, on the chain's
				 * first node, and this ships at 5 — the entity-vector mechanism's
				 * one-switch-plus-ceiling pair (`mention-spans.maxMentions` +
				 * `entity-link.maxLinks`).
				 *
				 * 0 contributes nothing and returns before the reads — but
				 * **after the embed**: a 0 here does not spare the probe embed,
				 * so with a model set up it is an embed thrown away each turn —
				 * a billed request, on a service. Search by meaning **Off** is
				 * the switch, and a 0 stored to switch the search off before C3
				 * is not read as one (no back-compat before distribution, owner
				 * 2026-09-27).
				 * Absent (a `params` slot nothing wired) reads as the declared 5,
				 * the way `topK` below reads as its declared 40: the switch
				 * upstream already decided whether to search.
				 */
				const rawMax = input?.params?.maxEntries
				const maxEntries = Math.max(
					0,
					rawMax === undefined || rawMax === null
						? 5
						: Number(rawMax) || 0
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
				 * The switch is `query-windows.searchByMeaning`, on the chain's
				 * first node.
				 */
				const topK = Math.max(
					1,
					Math.floor(Number(input?.params?.topK) || 40)
				)
				/**
				 * How sharply a weak resemblance is discounted, as an exponent.
				 *
				 * ⚠ **This is what replaced `minScore`, and it is deliberately not a
				 * minimum.** A minimum similarity takes a row out of the pool, and a
				 * row that is out of the pool cannot be found by keyword, by name or
				 * by proximity either — one mechanism's opinion disabling four
				 * others, which is the governing rule's one prohibition. (`minScore`
				 * was never read by anything either, so no install has ever had a
				 * minimum to lose.)
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

				/**
				 * Nothing to search with — returned before the candidate reads.
				 *
				 * With a model ready, no vectors means one of four things, and
				 * this node cannot tell which: the retrieval queries asked
				 * nothing (`searchByMeaning` decided not to search — `off`, or
				 * `auto` with no embedding model set up), the session has
				 * no messages yet, the embed step's own `enabled` is Off, or the
				 * embed failed under `auto` (an API error or a timeout, recovered
				 * as no vectors). So the sentence names all four rather than
				 * blaming the switch for a failure. Either way a lorebook fetch
				 * here would be thrown away, which is the cost the switch exists
				 * to spare (2026-09-29).
				 *
				 * ⚠ With no model loaded the read above answers first, so a
				 * switched-off turn says "no embedding model" here: this node
				 * cannot tell "no texts" from "no model" by its vectors. The
				 * retrieval explanation (`explainRetrieval`) reads
				 * `query-windows`' own `searchByMeaning: false` and lets that
				 * reason win.
				 */
				const vectors: unknown[] = Array.isArray(input?.vectors)
					? input.vectors.filter(Array.isArray)
					: []
				if (vectors.length === 0)
					return off(
						"off — nothing was embedded to search with (Search by meaning did not search, there are no messages yet, or the embed step is off or failed)"
					)

				// On unless a pipeline says `false` (the param's default is `true`).
				const knownToSpeaker = input?.params?.knownToSpeaker !== false
				const [entries, result] = await Promise.all([
					ctx.read("lorebook_entries", {
						knownToSpeaker,
						...speakerInCastQuery(input?.params),
						sessionId: input?.scope?.sessionId,
						currentCharacterId:
							input?.scope?.currentCharacterId ?? null,
						...(input?.scope?.currentCastMemberId != null
							? { currentCastMemberId: input.scope.currentCastMemberId }
							: {}),
						// The per-speaker subject (C3), on `character-lore`'s
						// terms: the lore read is this mechanism's visibility
						// gate, so naming the voice here is what keeps a search
						// inside a repeating clause to that voice's own lore.
						...(input?.speaker === undefined
							? {}
							: { speaker: input.speaker })
					}),
					ctx.read("vector_search", {
						sessionId: input?.scope?.sessionId,
						// Several query vectors: the current window and the recent
						// one are different questions, and one blended embedding
						// answers neither. No singular `input.vector` alias: the
						// definition declares no such name (R-12).
						vectors: input?.vectors ?? [],
						// Chosen here, not declared: the definition has no
						// `sources` param, so no spec can widen the search past
						// the lorebook's entries.
						sources: [...SEMANTIC_SEARCH_SOURCES],
						topK
					})
				])

				if (knownToSpeaker) {
					const drop = knowledgeDropOf(entries)
					if (drop) ctx.log("info", knowledgeDropReceipt(drop))
				}

				// The lore read is the *visible* set, so intersecting against it is
				// what keeps the two mechanisms answering to one visibility rule. It is
				// applied to what came back rather than pushed into the query,
				// because the host does retrieval and not policy.
				//
				// A set rather than a map since pre-squash 0204: the entry rows were
				// looked up to read `retrieval_strategy` off them, and membership is
				// the only question left.
				const visible = new Set(
					(entries ?? []).map((e: any) => `${e.source}:${e.id}`)
				)
				/**
				 * Each entry's text as the lore read readied it (plan A19):
				 * decorator lines stripped, `{{char:N}}` named at the session's
				 * reading. The index keeps the stored text, and a hit only this
				 * mechanism found reached the prompt with it.
				 */
				const readied = new Map<string, string>(
					(entries ?? [])
						.filter((e: any) => typeof e.content === "string")
						.map((e: any) => [`${e.source}:${e.id}`, e.content])
				)
				const readiedOf = (hit: any): string =>
					readied.get(
						`${VECTOR_SOURCE_ALIASES[hit.source] ?? hit.source}:${hit.id}`
					) ??
					hit.content ??
					""
				/**
				 * The cast member the lore read named for an anchored entry
				 * (`castMember`), so a character-lore hit only this mechanism
				 * found still says whose it is in the prompt.
				 */
				const castMembers = new Map<string, string>(
					(entries ?? [])
						.filter((e: any) => typeof e.castMember === "string")
						.map((e: any) => [`${e.source}:${e.id}`, e.castMember])
				)
				/**
				 * The cast member an anchored entry is about (`lorebookBindingId`),
				 * off the same read: what `core:task/eligibility@1`'s presence
				 * rule reads, so a hit only this mechanism found is gated like a
				 * keyword hit is.
				 */
				const memberOfEntry = new Map<string, number>(
					(entries ?? [])
						.filter((e: any) => typeof e.lorebookBindingId === "number")
						.map((e: any) => [`${e.source}:${e.id}`, e.lorebookBindingId])
				)
				const castMemberOf = (hit: any): { castMember?: string } => {
					const name = castMembers.get(
						`${VECTOR_SOURCE_ALIASES[hit.source] ?? hit.source}:${hit.id}`
					)
					return name ? { castMember: name } : {}
				}
				const skipped: any[] = []
				const excluded = new Set<string>()
				const isEligible = (hit: any) => {
					const source =
						VECTOR_SOURCE_ALIASES[hit.source] ?? hit.source
					const key = `${source}:${hit.id}`
					if (excluded.has(key)) return false
					if (!visible.has(key)) {
						// Every source searched is a lore source
						// (`SEMANTIC_SEARCH_SOURCES`), so a hit with no row in
						// the lore read is one the read declined to return.
						//
						// ⚠ That absence is a decision — `lorebook_entries` withholds
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
					// this mechanism with a model loaded and a cosine of 1. Pre-squash
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
					tokens: ctx.countTokens(readiedOf(hit)),
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
					payload: {
						...hit,
						content: readiedOf(hit),
						...castMemberOf(hit),
						...(memberOfEntry.has(
							`${VECTOR_SOURCE_ALIASES[hit.source] ?? hit.source}:${hit.id}`
						)
							? {
									lorebookBindingId: memberOfEntry.get(
										`${VECTOR_SOURCE_ALIASES[hit.source] ?? hit.source}:${hit.id}`
									)
								}
							: {}),
						foundBy: "vector-search"
					}
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
				// A history hit the lore read left out (the timeline is off) is
				// withheld above like any hit with no row; it says why, once.
				if ([...excluded].some((k) => k.startsWith("history:")))
					logHistoryLeftOut(ctx, entries)
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
			{
				ports: ["scope", "vectors", "speaker"],
				params: ["maxEntries", "topK", "similarityFalloff", "knownToSpeaker", "speakerInCast"]
			}
		),

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
		"core:query/entity-search@1": reads<typeof C.entitySearch>(
			async (
				input: NodeInput<typeof C.entitySearch>,
				ctx: CoreQueryCtx
			) => {
				const params = input?.params ?? {}
				// Absent reads as the declared default (R5: on by default — 5
				// entries, 20 messages); an explicit 0 is still off.
				const declared = (v: unknown, fallback: number) =>
					Math.max(
						0,
						v === undefined || v === null ? fallback : Number(v) || 0
					)
				const maxEntries = declared(
					params.maxEntries,
					DEFAULT_ENTITY_MAX_ENTRIES
				)
				const maxMessages = declared(
					params.maxMessages,
					DEFAULT_ENTITY_MAX_MESSAGES
				)

				/**
				 * ⚠ **0 is off, in both halves** — the `maxRecursionDepth` /
				 * `admitThreshold` convention. Returning early rather than
				 * returning everything and letting the cap bite: this mechanism annotates
				 * as a side effect of running, and an install that has not asked
				 * for it should pay nothing at all, not even the write.
				 */
				const recalledLinesShare =
					typeof params.recalledLinesShare === "number"
						? params.recalledLinesShare
						: RECALLED_LINES_SHARE
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
					Number(params.scanDepth) ||
						withDefaults({}).retrieval.scanDepth
				)
				const entityWeight =
					params.entityWeight === undefined ||
					params.entityWeight === null
						? DEFAULT_ENTITY_WEIGHT
						: Math.max(0, Number(params.entityWeight) || 0)

				// On unless a pipeline says `false` (the param's default is `true`).
				const knownToSpeaker = params.knownToSpeaker !== false
				const [entries, messages] = await Promise.all([
					ctx.read("lorebook_entries", {
						knownToSpeaker,
						...speakerInCastQuery(input?.params),
						sessionId: input?.scope?.sessionId,
						currentCharacterId:
							input?.scope?.currentCharacterId ?? null,
						...(input?.scope?.currentCastMemberId != null
							? { currentCastMemberId: input.scope.currentCastMemberId }
							: {}),
						// The per-speaker subject (C3), as `vector-search`'s.
						...(input?.speaker === undefined
							? {}
							: { speaker: input.speaker })
					}),
					ctx.read("session_messages", {
						sessionId: input?.scope?.sessionId,
						limit: LORE_MESSAGE_WINDOW
					})
				])

				if (knownToSpeaker) {
					const drop = knowledgeDropOf(entries)
					if (drop) ctx.log("info", knowledgeDropReceipt(drop))
				}

				/**
				 * ⚠ Only entries retrieval may use (finding #148). The host's
				 * read returns switched-off and shelved rows on purpose — the
				 * keyword scan reports them on `skipped` — but this mechanism
				 * reports nothing about them, so one that reached the pool
				 * reached the prompt. Filtered here, before the ids, the
				 * rarity pool and the annotation promotion are built from it.
				 * The rows are already resolved at the session's reading, so
				 * an Off set by a dated amendment counts too.
				 */
				const rows: any[] = (entries ?? []).filter(
					(e: any) => e?.enabled !== false && e?.archived !== true
				)
				// The pool would have held history entries: said once, as the lanes do.
				logHistoryLeftOut(ctx, entries)
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
				const beforeId = inPrompt.length
					? Math.min(...inPrompt)
					: undefined

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

				const byId = new Map<number, any>(
					rows.map((e: any) => [e.id, e])
				)
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

				/**
				 * **Recalled lines** — the declared `recalledLines` band
				 * (2026-09-27, owner ruling option b). They sat in the
				 * transcript's `messages` band before, where the ranker spent
				 * budget on them and no variable rendered them; as their own
				 * band a template places them with `{{{recalledLines}}}`.
				 *
				 * Scored above as transcript (the `messages` weight row), named
				 * here by the transcript's own chain — `processMessages` over
				 * the rows as the history read carries them, with the session's
				 * cast — so a line from a participant who has since left is
				 * named as the transcript names it, and `{{char}}` in a line is
				 * that line's speaker. `turn` is the line's position in its
				 * channel (`recalled_lines`).
				 */
				const lineRows: any[] = messageHits.length
					? ((await ctx.read("recalled_lines", {
							sessionId: input?.scope?.sessionId,
							ids: messageHits.map((h) => h.id)
						})) ?? [])
					: []
				const cast: any = lineRows.length
					? await ctx.read("session_cast", {
							sessionId: input?.scope?.sessionId
						})
					: undefined
				const named = new Map<number, { name: string; message?: string }>(
					lineRows.length
						? processMessages({
								messages: lineRows,
								cast: cast ?? {},
								charName: "",
								personaName: "",
								narratorName: cast?.sessionNarratorName,
								seed: false
							}).messages.map((m) => [m.id, m])
						: []
				)
				const rowById = new Map<number, any>(
					lineRows.map((r: any) => [Number(r.id), r])
				)
				const messageCandidates = messageHits.flatMap((hit) => {
					const row = rowById.get(hit.id)
					// Hidden, generating or gone since it was annotated.
					if (!row) return []
					const line = named.get(hit.id)
					const text =
						typeof line?.message === "string"
							? line.message
							: String(row.content ?? "").trim()
					return [
						{
							id: hit.id,
							source: RECALLED_LINES_BAND,
							tokens: ctx.countTokens(text),
							signals: { entityCooccurrence: hit.evidence },
							presetScore: hit.score,
							payload: {
								id: hit.id,
								name: line?.name ?? "",
								content: text,
								turn: row.turn,
								foundBy: "entity-search",
								sharedEntities: hit.shared
							}
						}
					]
				})

				return ok({
					main: candidates,
					hits: candidates,
					// The band's intent first, whenever the half is on — a
					// source that found nothing this turn still has a share.
					messages:
						maxMessages > 0
							? [
									bandIntent(RECALLED_LINES_BAND, {
										share: recalledLinesShare,
										maxEntries: maxMessages
									}),
									...messageCandidates
								]
							: [],
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
						entities: (index?.entities ?? []).map(
							(e: any) => e.text
						),
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
			{
				ports: ["scope", "speaker"],
				params: [
					"maxEntries",
					"maxMessages",
					"recalledLinesShare",
					"scanDepth",
					"entityWeight",
					"knownToSpeaker",
					"speakerInCast"
				]
			}
		),

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
		 * `maxMentions` is **8 by default** (R5, ruled 2026-09-30: all supported
		 * retrieval is on by default; it was 0) and **0 is off**. It is on the
		 * *first* node of the chain deliberately: switched off, this returns
		 * before it reads anything, `embed-text` is handed no texts and makes
		 * no model call, and `entity-link` returns before its own read. A mechanism
		 * nobody asked for costs nothing at all — not a message read and not an
		 * embedding. (The semantic mechanism's switch sat on its chain's *last*
		 * node and could not say the same, so every turn with a model ready
		 * embedded its probes for nothing; since 2026-09-29 it has this shape
		 * too — `query-windows.searchByMeaning`, below.)
		 *
		 * Its sibling `entity-link.maxLinks` is therefore a **ceiling and not a
		 * second switch**, and ships non-zero: a feature where two controls both
		 * default to off is one where turning the first one on appears to do
		 * nothing.
		 */
		"core:query/mention-spans@1": reads<typeof C.mentionSpans>(
			async (
				input: NodeInput<typeof C.mentionSpans>,
				ctx: CoreQueryCtx
			) => {
				const params = input?.params ?? {}
				// Absent (a `params` slot nothing wired) reads as the declared
				// default, as `vector-search`'s `maxEntries` does (R5).
				const maxMentions = Math.max(
					0,
					params.maxMentions === undefined || params.maxMentions === null
						? DEFAULT_MAX_MENTIONS
						: Number(params.maxMentions) || 0
				)
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
					Number(params.scanDepth) ||
						withDefaults({}).retrieval.scanDepth
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
			{ ports: ["scope"], params: ["maxMentions", "scanDepth"] }
		),

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
		"core:query/entity-link@1": reads<typeof C.entityLink>(
			async (
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
				// Band intents (R-7 P5) travel ahead of the candidates in the
				// same list; split them off so "no candidates to rank" answers
				// about the items alone — a pool of nothing but intents has no
				// candidate to link against, however many bands declared a
				// share, and the two must not be confused for one another.
				const { intents, items: pool } = splitCandidates<any>(
					input?.candidates ?? []
				)

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
				// mechanism's switch is `mention-spans`' `maxMentions` (on by default
				// since R5, but a preset may set 0), so an empty mention list may be
				// "the mechanism is off" as well as "the scene described nothing" —
				// and this node cannot tell them apart from an empty array, so the
				// note names both.
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
				/**
				 * ⚠ **With a `speaker`, only what that voice may see is linked**
				 * (C3). A pool shared across a repeating clause can carry another
				 * voice's private lore; enriching it would rank a secret higher
				 * for somebody who must not read it. The same gated read every
				 * other mechanism uses decides — never a second rule. A null or
				 * empty speaker is unwired, as on `vector-search` and
				 * `entity-search` (`character-lore`'s semantics): no gate.
				 */
				const speakerWired =
					typeof input?.speaker === "string" && input.speaker.trim() !== ""
				// On unless a pipeline says `false` (the param's default is `true`).
				// With it on the read is made even with no speaker wired (the
				// scope's speaker then), so an entry that speaker does not know is
				// not linked; with it off an unwired node reads nothing, as before.
				const knownToSpeaker = params.knownToSpeaker !== false
				// A run that speaks as nobody reads everything: no read to make.
				const scopeSpeaks =
					input?.scope?.currentCharacterId != null ||
					input?.scope?.currentCastMemberId != null
				if (knownToSpeaker && !speakerWired && !scopeSpeaks)
					ctx.log("info", knowledgeDropReceipt({ kind: "reads-all" }))
				let visibleToSpeaker: Set<number> | null = null
				if (speakerWired || (knownToSpeaker && scopeSpeaks)) {
					const read = (await ctx.read("lorebook_entries", {
						...(knownToSpeaker ? { knownToSpeaker } : {}),
						...speakerInCastQuery(params),
						sessionId: input?.scope?.sessionId,
						currentCharacterId:
							input?.scope?.currentCharacterId ?? null,
						...(input?.scope?.currentCastMemberId != null
							? { currentCastMemberId: input.scope.currentCastMemberId }
							: {}),
						...(speakerWired ? { speaker: input.speaker } : {})
					})) as any[] | undefined
					if (knownToSpeaker) {
						const drop = knowledgeDropOf(read)
						if (drop) ctx.log("info", knowledgeDropReceipt(drop))
					}
					visibleToSpeaker = new Set((read ?? []).map((e) => Number(e?.id)))
				}
				const byId = new Map<number, any>()
				for (const candidate of pool) {
					const id = Number(candidate?.id)
					if (!Number.isFinite(id)) continue
					if (!LORE_SOURCES.has(String(candidate?.source))) continue
					if (visibleToSpeaker && !visibleToSpeaker.has(id)) continue
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
					const link = Number.isFinite(id)
						? linkOf.get(id)
						: undefined
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

				// The intents split off above travel back out ahead of the
				// enriched items, the way every core candidate source
				// publishes them (`withBandIntents`) — this node reorders and
				// enriches; it does not own the bands, so it hands them back
				// exactly as they arrived.
				const published = withBandIntents(intents, candidates)

				return ok({
					main: published,
					candidates: published,
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
			{
				ports: ["scope", "candidates", "mentions", "vectors", "speaker"],
				params: ["maxLinks", "knownToSpeaker", "speakerInCast"]
			}
		),

		/**
		 * Documentation search — the guide genre's one retrieval mechanism
		 * (plans/29 R-18; U5g). The compiled docs' section index — the app's
		 * guides and the SDK's, one body of text per heading
		 * (`$lib/shared/utils/docsIndex`) — is ranked against the person's
		 * newest messages (`docsRetrieval.ts`: stemmed BM25 with a relevance
		 * floor, their own rows only), and the relevant sections go out in
		 * the node's declared **`docsExcerpts`** band (2026-09-27; it borrowed
		 * `worldLore` before), each excerpt headed by its page's real path —
		 * so `rank-hybrid` budgets them and the guide's template places them.
		 *
		 * Publishes the intent alone when nothing matched — the empty band is
		 * how the template knows to say so. Degrades the same way when the
		 * docs-dist was never compiled (a fresh checkout, `npm test`).
		 */
		"core:query/docs-search@1": reads<typeof C.docsSearch>(
			async (
				input: NodeInput<typeof C.docsSearch>,
				ctx: CoreQueryCtx
			) => {
				const maxEntries =
					typeof input?.params?.maxEntries === "number"
						? input.params.maxEntries
						: 6
				const intent = bandIntent(DOCS_BAND, {
					share:
						typeof input?.params?.share === "number"
							? input.params.share
							: 0.25,
					maxEntries,
					priority: isBandPriority(input?.params?.priority)
						? input.params.priority
						: "normal"
				})
				const scanDepth = Math.max(
					1,
					typeof input?.params?.scanDepth === "number"
						? input.params.scanDepth
						: 4
				)
				if (maxEntries <= 0)
					return ok({ main: [intent], candidates: [intent] })

				const { loadSearchIndex, docsManifest } = await import(
					"$lib/shared/utils/docsIndex"
				)
				const sections = await loadSearchIndex()
				if (!sections.length)
					return ok({ main: [intent], candidates: [intent] })

				const messages: DocsQueryMessage[] =
					(await ctx.read("session_messages", {
						sessionId: input?.scope?.sessionId,
						limit: scanDepth
					})) ?? []
				const hits = searchDocs(
					sections,
					docsManifest,
					docsQueryTerms(messages.slice(-scanDepth)),
					maxEntries
				)
				const top = hits[0]?.score || 1
				const candidates = hits.map((hit, position) => {
					const content = docsExcerptContent(hit)
					return {
						id: hit.id,
						source: DOCS_BAND,
						tokens: ctx.countTokens(content),
						signals: {},
						presetScore: hit.score / top,
						position,
						payload: {
							id: hit.id,
							name: hit.name,
							content,
							link: hit.link,
							foundBy: "docs"
						}
					}
				})
				return ok({
					main: [intent, ...candidates],
					candidates: [intent, ...candidates]
				})
			},
			{
				ports: ["scope"],
				params: ["share", "maxEntries", "priority", "scanDepth"]
			}
		),
	}
}

export { LORE_LANES }
