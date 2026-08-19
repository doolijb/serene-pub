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
} from "./signals"
import { eligibleFor, armNote, type ArmAvailability } from "./strategy"
import type { Candidate } from "./select"
import type { RetrievalParams, SourceKind } from "./weights"

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
	/** Character and persona names in the chat, for the co-occurrence signal. */
	entityNames: readonly string[]
	retrieval: RetrievalParams
	availability: ArmAvailability
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
		countTokens
	} = input

	const window = buildScanWindow(messages, retrieval.scanDepth)
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

	for (const entry of entries) {
		if (entry.enabled === false) {
			skipped.push({
				id: entry.id,
				source: entry.source,
				reason: "entry is disabled"
			})
			continue
		}

		if (!eligibleFor(entry, "keyword", availability)) {
			skipped.push({
				id: entry.id,
				source: entry.source,
				reason: armNote(entry, "keyword", availability).replace(
					"matched by keyword",
					"handled by vector search"
				)
			})
			continue
		}

		// A constant entry is a candidate regardless of whether anything matched
		// — that is what constant means. It still goes through this arm so the
		// receipt shows it was considered here, rather than appearing downstream
		// from nowhere.
		const pinned = !!entry.constant
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
		const hit = pinned || signals.keyword > 0 || signals.nameMatch > 0

		if (!hit) {
			skipped.push({
				id: entry.id,
				source: entry.source,
				reason: `no key matched in the last ${retrieval.scanDepth} messages`
			})
			continue
		}

		matched++
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

	return {
		candidates,
		skipped,
		diagnostics: {
			scanDepth: retrieval.scanDepth,
			windowChars: window.raw.length,
			considered: entries.length,
			matched
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
