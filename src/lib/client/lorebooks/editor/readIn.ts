/**
 * "Read in · rank 2 of 12 · matched umber · 218 of 900 tokens" — what the
 * attached session's newest run did with this entry, in one line.
 *
 * Two halves, both pure. `readInFacts` reads one entry's place out of the
 * run's own explanation; `readInLine` says it. Every clause after the verdict
 * is optional, because a run records what it records: a figure nobody measured
 * is left out rather than written as a zero, and "nobody is reading this book"
 * is a third answer rather than a weaker no.
 */

import { matchedKeyword } from "./criteria"
import type { RetrievalMarker } from "../markers"

/** The bands whose rows are not entries, so the ranking leaves them out. */
const NON_ENTRY_BANDS = new Set(["messages", "relationships"])

type Explanation = NonNullable<
	Sockets.Pipelines.RunExplain.Response["explanation"]
>

export interface ReadInFacts {
	/** What the session reading this book is called, or null for none. */
	sessionName: string | null
	/** What the newest run did, or null when it reported nothing. */
	decision: RetrievalMarker | null
	/** Its place among the entries the run judged. */
	rank?: number
	of?: number
	/** The keyword the run says matched. */
	matched?: string
	/** Which message it matched in, counted from the start of the window. */
	inMessage?: number
	tokens?: number
	/** The ceiling the retrieved context was given. */
	budget?: number
	/** The run's own sentence about the decision. */
	reason?: string
}

/** The half of the facts that comes out of the run. */
export type RunFacts = Omit<ReadInFacts, "sessionName" | "decision">

/** The explanation both boards read, as the wire declares it. */
export type RunExplanation = Explanation

const isEntryRow = (row: Sockets.Pipelines.RetrievalRow) =>
	typeof row.id === "number" && !NON_ENTRY_BANDS.has(row.source)

/**
 * The entries the ranker judged, best first.
 *
 * `skipped` rows are left out: no mechanism offered them, so they never
 * competed and counting them would inflate every rank in the list. One entry
 * decided by two gather branches occupies the prompt once, so the best of its
 * rows stands for it.
 */
export function judgedEntryRows(
	explanation: Explanation
): Sockets.Pipelines.RetrievalRow[] {
	const best = new Map<number, Sockets.Pipelines.RetrievalRow>()
	for (const row of explanation.rows ?? []) {
		if (!isEntryRow(row) || row.outcome === "skipped") continue
		const id = row.id as number
		const held = best.get(id)
		if (!held) {
			best.set(id, row)
			continue
		}
		const better =
			held.outcome !== "included" && row.outcome === "included"
				? row
				: (row.score ?? -Infinity) > (held.score ?? -Infinity) &&
					  held.outcome === row.outcome
					? row
					: held
		best.set(id, better)
	}
	return [...best.values()].sort(
		(a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity)
	)
}

/** One entry's place in one run, as far as the run recorded it. */
export function readInFacts(
	entryId: number,
	explanation: Explanation
): RunFacts {
	const facts: RunFacts = {}
	const total = explanation.budget?.total
	if (typeof total === "number") facts.budget = total

	const judged = judgedEntryRows(explanation)
	const row = judged.find((r) => r.id === entryId)
	if (!row) return facts

	// Rank and "of" mean what the ranking store means by them (L1): a place
	// among the lore entries the turn READ IN, never among everything judged.
	const read = judged.filter((r) => r.outcome === "included")
	const at = read.findIndex((r) => r.id === entryId)
	if (at !== -1) {
		facts.rank = at + 1
		facts.of = read.length
	}
	if (typeof row.tokens === "number") facts.tokens = row.tokens
	const matched = matchedKeyword(row)
	if (matched) facts.matched = matched
	if (row.verdict) facts.reason = row.verdict
	return facts
}

/** "Read in · rank 2 of 12 · matched umber in message 3 · 218 of 900 tokens". */
export function readInLine(
	facts: ReadInFacts,
	opts: { short?: boolean } = {}
): string {
	if (!facts.sessionName && facts.decision === null)
		return "No session is reading this book"

	if (facts.decision !== "fired") {
		const reason =
			facts.reason ??
			(facts.decision === "considered"
				? "weighed and left out"
				: "nothing reported on it")
		return `Not read in last turn · ${reason}`
	}

	const parts = ["Read in"]
	if (facts.rank !== undefined && facts.of !== undefined)
		parts.push(`rank ${facts.rank} of ${facts.of}`)
	if (facts.matched)
		parts.push(
			facts.inMessage !== undefined
				? `matched ${facts.matched} in message ${facts.inMessage}`
				: `matched ${facts.matched}`
		)
	if (opts.short) return parts.join(" · ")
	if (facts.tokens !== undefined)
		parts.push(
			facts.budget !== undefined
				? `${facts.tokens} of ${facts.budget} tokens`
				: `${facts.tokens} tokens`
		)
	return parts.join(" · ")
}
