/**
 * The keyword arm, as a Query.
 *
 * This is what `core:query/lorebook-triggers@1` binds to. It does the part of
 * `KeywordInfillEngine` that decides **which entries are candidates** — and
 * stops there. Scoring weights, budgets and what actually fits are the ranker's
 * and Assemble's business, downstream, where a user can swap them.
 *
 * Splitting at this line is the whole reason the decomposition is worth doing.
 * Today "the lore that got in" is the output of one 900-line pass, so the only
 * available answer to "why did this entry not appear" is "read the code". Here
 * the Query says *what matched*, the ranker says *what won*, and Assemble says
 * *what fit* — three answers, each attributable.
 *
 * The Query does not reach the network (16 §1). Vector similarity is the other
 * arm's job; this one reads rows and matches strings.
 */

import {
	buildScanWindow,
	buildIdf,
	buildLastRefMap,
	keywordSignal,
	nameMatchSignal,
	entityCooccurrenceSignal,
	tfidfSignal,
	buildTermFreq,
	lastRefRecencySignal,
	type ScanWindow
} from "$lib/server/pipelines/ranking/signals"
import {
	eligibleFor,
	armNote,
	type ArmAvailability
} from "$lib/server/pipelines/ranking/strategy"
import type { Candidate } from "$lib/server/pipelines/ranking/select"
import type {
	RetrievalParams,
	SourceKind
} from "$lib/server/pipelines/ranking/weights"

export interface LoreRow {
	id: number
	source: SourceKind
	name: string | null
	content: string
	keys: string
	caseSensitive?: boolean | null
	useRegex?: boolean | null
	matchMode?: string | null
	retrievalStrategy?: string | null
	/**
	 * The deepest recursion level at which this entry may still be reached.
	 *
	 * `0` means the conversation only — never dragged in by another entry.
	 * NULL means "no opinion", which the node's ceiling then decides. Note it
	 * is about being *found*, not about finding: an entry's content always
	 * feeds the next pass if there is one, because content that may be in the
	 * prompt but may not be read is a distinction nobody asked for.
	 */
	recursionDepth?: number | null
	priority?: number | null
	constant?: boolean | null
	enabled?: boolean | null
	position?: number | null
	hasEmbedding?: boolean
}

export interface MessageRow {
	id: number
	content: string
}

export interface KeywordQueryInput {
	entries: readonly LoreRow[]
	messages: readonly MessageRow[]
	/** Character and persona names in the session, for the co-occurrence signal. */
	entityNames: readonly string[]
	retrieval: RetrievalParams
	availability: ArmAvailability
	/**
	 * The query node's retrieval mode: what an entry that has not declared one
	 * is treated as. Undefined keeps the shipped default (`rag`).
	 */
	defaultStrategy?: string | null
	/** Counts a candidate once, up front — see select.ts note 1. */
	countTokens: (text: string) => number
}

export interface KeywordQueryResult {
	candidates: Candidate[]
	/** Entries this arm did not consider, and why. Never silently absent. */
	skipped: Array<{ id: number; source: SourceKind; reason: string }>
	diagnostics: {
		scanDepth: number
		windowChars: number
		considered: number
		matched: number
		/** Levels actually walked, not the ceiling that was allowed. */
		recursionDepth: number
	}
}

/**
 * Find candidates by keyword.
 *
 * Every entry the arm declines is reported rather than dropped. A retrieval
 * stage that returns only its hits cannot distinguish "nothing matched" from
 * "your entry is disabled" from "this entry is set to rag" — three different
 * user problems with three different fixes, which is exactly the confusion
 * `skipped` exists to prevent.
 */
export function keywordQuery(input: KeywordQueryInput): KeywordQueryResult {
	const {
		entries,
		messages,
		entityNames,
		retrieval,
		availability,
		defaultStrategy,
		countTokens
	} = input

	// Clamped at 0: a negative ceiling is not "unlimited", and reading it as
	// one would make a typo in a config the most expensive setting in the app.
	const maxDepth = Math.max(0, retrieval.maxRecursionDepth ?? 0)

	const sessionWindow = buildScanWindow(messages, retrieval.scanDepth)
	// tf-idf scores against the **guaranteed** window, not the scan window.
	// They are two different depths and legacy uses the narrower one for this
	// signal (`:157`): the scan window decides what *can* match a key at all,
	// while tf-idf asks how close the entry's subject is to what is being said
	// right now.
	const guaranteed = buildScanWindow(messages, retrieval.guaranteedMessages)
	const guaranteedFreq = buildTermFreq(guaranteed.lower)
	const guaranteedCount = Math.min(
		messages.length,
		retrieval.guaranteedMessages
	)
	const idf = buildIdf(messages)
	const lastRef = buildLastRefMap(messages, entries)

	const candidates: Candidate[] = []
	const skipped: KeywordQueryResult["skipped"] = []
	let matched = 0

	/**
	 * Entries this arm has finished with — matched, disabled or ineligible.
	 *
	 * One set rather than three, because what every case has in common is the
	 * only thing the loop needs to know: do not look at this again. Without it
	 * a recursion pass re-reports the same disabled entry once per level.
	 *
	 * ⚠ Keyed by `source:id`, not `id`. The three lore tables have independent
	 * identity sequences, so a world-lore entry and a history entry both being
	 * row 1 is the *normal* case on a young lorebook — and keying on the number
	 * alone made the first one settle the second, which then vanished without
	 * appearing in `skipped` either. The vector arm already keys hits this way;
	 * this did not, for one commit.
	 */
	const settled = new Set<string>()
	const keyOf = (e: LoreRow) => `${e.source}:${e.id}`

	for (const entry of entries) {
		if (entry.enabled === false) {
			settled.add(keyOf(entry))
			skipped.push({
				id: entry.id,
				source: entry.source,
				reason: "entry is disabled"
			})
			continue
		}

		if (!eligibleFor(entry, "keyword", availability, defaultStrategy)) {
			settled.add(keyOf(entry))
			skipped.push({
				id: entry.id,
				source: entry.source,
				reason: armNote(
					entry,
					"keyword",
					availability,
					defaultStrategy
				).replace("matched by keyword", "handled by vector search")
			})
		}
	}

	/**
	 * One pass over everything still unsettled.
	 *
	 * `level` is 0 for the conversation and counts up through recursion. It is
	 * passed rather than closed over so the eligibility rule reads as the
	 * sentence it is: an entry may be reached at this level if it did not ask
	 * for shallower.
	 */
	const scan = (window: ScanWindow, level: number): LoreRow[] => {
		const hits: LoreRow[] = []
		for (const entry of entries) {
			if (settled.has(keyOf(entry))) continue
			// An entry's own limit, under the node's. NULL is no opinion, so
			// the ceiling decides — which is what makes turning recursion on
			// for a whole lorebook one setting rather than several hundred.
			if (level > (entry.recursionDepth ?? maxDepth)) continue

			// A constant entry is a candidate regardless of whether anything
			// matched — that is what constant means. It still goes through this
			// arm so the receipt shows it was considered here, rather than
			// appearing downstream from nowhere. Only at level 0: a constant
			// entry is unconditional, so there is nothing for a later pass to
			// discover about it.
			const pinned = level === 0 && !!entry.constant
			const signals = scoreSignals(
				entry,
				window,
				idf,
				lastRef,
				messages.length,
				entityNames,
				guaranteedFreq,
				guaranteedCount
			)
			if (!(pinned || signals.keyword > 0 || signals.nameMatch > 0))
				continue

			settled.add(keyOf(entry))
			matched++
			hits.push(entry)
			candidates.push({
				id: entry.id,
				source: entry.source,
				tokens: countTokens(entry.content),
				signals,
				priority: entry.priority ?? 1,
				position: entry.position ?? 0,
				pinned,
				payload: entry
			})
		}
		return hits
	}

	let found = scan(sessionWindow, 0)
	let level = 0
	/**
	 * The deepest level that actually produced something.
	 *
	 * Not the same as `level`, which is always one further along — the pass
	 * that stops the loop is the pass that found nothing. Reporting that one
	 * would say "recursion reached level 2" about a run where level 2 was
	 * empty, and the number exists precisely so somebody can tell how far the
	 * lore actually chained.
	 */
	let depth = 0
	while (level < maxDepth && found.length > 0) {
		level++
		// The previous level's content *is* the next window. Joined the same
		// way `buildScanWindow` joins messages — a single space — so a key
		// spanning two entries behaves exactly as one spanning two messages,
		// rather than being a second rule nobody wrote down.
		const raw = found.map((e) => e.content ?? "").join(" ")
		found = scan({ raw, lower: raw.toLowerCase() }, level)
		if (found.length > 0) depth = level
	}

	// Reported last, and only for what nothing reached. Saying "no key matched"
	// after the first pass would name entries that the second pass then pulled
	// in, so the receipt would contradict the prompt.
	for (const entry of entries) {
		if (settled.has(keyOf(entry))) continue
		skipped.push({
			id: entry.id,
			source: entry.source,
			reason:
				maxDepth > 0
					? `no key matched in the last ${retrieval.scanDepth} messages, or in ${depth} level(s) of triggered entries`
					: `no key matched in the last ${retrieval.scanDepth} messages`
		})
	}

	return {
		candidates,
		skipped,
		diagnostics: {
			scanDepth: retrieval.scanDepth,
			windowChars: sessionWindow.raw.length,
			considered: entries.length,
			matched,
			// How deep it actually went, not how deep it was allowed to — a
			// ceiling of 3 that stopped at 1 because nothing else triggered is
			// the normal case, and the difference is the only way to tell
			// "recursion found nothing" from "recursion never ran".
			recursionDepth: depth
		}
	}
}

function scoreSignals(
	entry: LoreRow,
	window: ScanWindow,
	idf: Map<string, number>,
	lastRef: Map<number, number>,
	totalMessages: number,
	entityNames: readonly string[],
	/** The guaranteed window's term frequencies, and how many messages it spans. */
	guaranteedFreq: Map<string, number>,
	guaranteedCount: number
) {
	return {
		keyword: keywordSignal(entry, window),
		nameMatch: nameMatchSignal(entry.name, window),
		entityCooccurrence: entityCooccurrenceSignal(
			entry.name,
			entry.keys,
			entityNames
		),
		// Raw, not normalised: normalisation needs the maximum across the whole
		// pool, which only the ranker sees. Doing it here would normalise against
		// this arm alone and make the two arms incomparable.
		tfidf: tfidfSignal(
			`${entry.keys} ${entry.name ?? ""}`,
			idf,
			guaranteedFreq,
			guaranteedCount
		),
		lastRefRecency: lastRefRecencySignal(
			lastRef.get(entry.id),
			totalMessages
		)
	}
}

/**
 * Normalise tf-idf across a candidate pool.
 *
 * The engine scores everything twice for this reason (`:529-552`): tf-idf is
 * unbounded, so it is divided by the pool maximum to bring it into [0, 1] with
 * the other signals. Kept as a separate step rather than folded into scoring,
 * because with two retrieval arms the pool is not known until they have both
 * reported.
 */
export function normaliseTfidf(candidates: Candidate[]): Candidate[] {
	const max = Math.max(1, ...candidates.map((c) => c.signals.tfidf ?? 0))
	return candidates.map((c) => ({
		...c,
		signals: { ...c.signals, tfidf: (c.signals.tfidf ?? 0) / max }
	}))
}
