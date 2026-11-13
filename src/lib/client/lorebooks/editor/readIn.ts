/**
 * "Read in · rank 2 of 12 · matched umber · 218 of 900 tokens" — what the
 * attached session's newest run did with this entry, in one line.
 *
 * Two halves, both pure. `readInFacts` reads one entry's place out of the
 * run's own explanation; `readInLine` says it. Every clause after the decision line
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
	/** The run's own sentence about the decision: the first gate that stopped it. */
	decisionLine?: string
	/** Select's code for the decision (`excluded_budget`…), where the store kept one. */
	reason?: string
	/** The decision's own sentence, as the ranking store keeps it. */
	why?: string
}

/** The half of the facts that comes out of the run. */
export type RunFacts = Omit<ReadInFacts, "sessionName" | "decision">

/** The explanation both boards read, as the wire declares it. */
export type RunExplanation = Explanation

const isEntryRow = (row: Sockets.Pipelines.RetrievalRow) =>
	typeof row.id === "number" && !NON_ENTRY_BANDS.has(row.source)

/** The skip reasons the server words; kept equal by a test. */
export const ARCHIVED_REASON = "entry is archived"
export const DISABLED_REASON = "entry is disabled"
const HIDDEN_REASON = "not visible to the current speaker"

/** The first-gate sentences (provisional copy). */
export const GATE = {
	off: "it is switched off",
	archived: "it is archived",
	offForAWhile: "it is off for a while at this point in the story",
	notReadHere:
		"it is archived in this session, not on its line, or dated after its clock",
	otherSpeaker: "it is another speaker's character lore",
	budget: "it was left out for budget",
	pinnedDidNotFit: "it is pinned, but it did not fit"
} as const

const BUDGET_CODES = new Set([
	"excluded_budget",
	"excluded_token_limit",
	"excluded_share_cap",
	"excluded_group_disabled",
	"excluded_unknown_source"
])
const PINNED_CODES = new Set([
	"excluded_pinned_token_limit",
	"excluded_pinned_group_disabled"
])

/** A rule's own sentence, minus one trailing full stop. */
const ruleSentence = (why: string) => why.replace(/\.$/, "")

/** The entry's skipped row, when a mechanism declined it before the ranker. */
export function skippedEntryRow(
	explanation: Explanation,
	entryId: number
): Sockets.Pipelines.RetrievalRow | undefined {
	return (explanation.rows ?? []).find(
		(r) => isEntryRow(r) && r.id === entryId && r.outcome === "skipped"
	)
}

/**
 * The off gate's sentence. Off in the base row → switched off; on in the base row but off as the
 * session reads it (an amendment) → off for a while. Unknown base row → switched off: the plain claim
 * that holds whichever way it is off, where "for a while" would assert an amendment nobody saw.
 */
export function offDecisionLine(baseEnabled: boolean | undefined): string {
	return baseEnabled === true ? GATE.offForAWhile : GATE.off
}

/** A skipped row's sentence: a named gate, or the reason verbatim. */
export function skipDecisionLine(
	reason: string | undefined,
	baseEnabled?: boolean
): string | undefined {
	if (!reason) return undefined
	if (reason === ARCHIVED_REASON) return GATE.archived
	if (reason === DISABLED_REASON) return offDecisionLine(baseEnabled)
	if (reason === HIDDEN_REASON) return GATE.otherSpeaker
	return reason
}

/** What the ranking store's code and sentence say, where they name a gate. */
export function storeDecisionLine(
	reason: string | undefined,
	why: string | undefined
): string | undefined {
	if (reason === "excluded_ineligible" && why) return ruleSentence(why)
	if (reason && BUDGET_CODES.has(reason)) return GATE.budget
	if (reason && PINNED_CODES.has(reason)) return GATE.pinnedDidNotFit
	return undefined
}

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
	if (!row) {
		const skipped = skippedEntryRow(explanation, entryId)
		const line =
			skipped &&
			skipDecisionLine(
				skipped.skipReason || undefined,
				skipped.entry?.enabled
			)
		if (line) facts.decisionLine = line
		return facts
	}

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
	if (row.reason) facts.reason = row.reason
	const rule =
		row.reason === "excluded_ineligible" && row.why?.[0]
			? ruleSentence(row.why[0])
			: undefined
	if (rule) facts.decisionLine = rule
	else if (row.verdict) facts.decisionLine = row.verdict
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
		const line =
			facts.decisionLine ??
			storeDecisionLine(facts.reason, facts.why) ??
			(facts.decision === "considered"
				? "weighed and left out"
				: "nothing reported on it")
		return `Not read in last turn · ${line}`
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
