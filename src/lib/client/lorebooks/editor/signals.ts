/**
 * The Read in? test, as facts and as a sentence.
 *
 * ⚠ **"No" always arrives with a reason.** The test compiles a real turn, so
 * every no it reports has the run's own sentence behind it and this never
 * writes a bare refusal. The figures are the run's too: a clause with nothing
 * behind it is left out rather than rendered as a zero.
 *
 * ⚠ **Read out of the whole explanation, not out of one row.** A rank is a
 * place among the entries the turn judged and a budget clause is a share of
 * what the turn was given, so neither exists in a payload carrying this entry's
 * row alone — which is why the board asks for the turn's own account
 * (`pipelines:previewRetrieval`) and takes its own line out of it.
 */

import { lexicalScore, semanticScore } from "./criteria"
import { judgedEntryRows, readInFacts, type RunExplanation } from "./readIn"

export interface SignalFacts {
	/** Whether the compiled turn would read this entry in. */
	read: boolean
	/** Its place among the entries the turn judged, where the run says. */
	rank?: number
	of?: number
	matched?: string
	inMessage?: number
	/** The keyword scan's measurement. */
	lexical?: number
	/** The vector mechanism's. */
	semantic?: number
	tokens?: number
	/** The ceiling the retrieved context was given. */
	budget?: number
	/** How many more entries the band had room for. */
	headroom?: number
	/** Why not, in the run's own words. Never absent on a no. */
	reason?: string
}

/**
 * How much room this row's band had left, where the run recorded a ceiling.
 *
 * ⚠ A cap of 0 is "no ceiling recorded" rather than "no room": the projection
 * writes 0 for a band whose usage carried none, and reporting that as a full
 * band would put "0 entries ahead of the ceiling" under every run that never
 * declared one.
 */
function headroomOf(
	explanation: RunExplanation,
	source: string
): number | undefined {
	const band = explanation.bands?.find((b) => b.source === source)
	if (!band || !band.cap) return undefined
	return Math.max(0, band.cap - band.entries)
}

/**
 * The row the turn recorded about this entry, when it recorded one.
 *
 * Absent is a real answer rather than a failure: no mechanism offered the entry
 * to the ranker and none declined it by name.
 */
export function signalRow(
	explanation: RunExplanation,
	entryId: number
): Sockets.Pipelines.RetrievalRow | undefined {
	return judgedEntryRows(explanation).find((row) => row.id === entryId)
}

/**
 * One entry's place in a compiled turn, as facts.
 *
 * ⚠ **The same reading `readInFacts` does**, because the Signals board and the
 * Read in line are two sentences about one arithmetic: rank among the entries
 * the ranker judged, the keyword the run says matched, what it cost and what
 * the room was. A second derivation here is how the two surfaces would come to
 * disagree about a decision neither of them makes.
 */
export function signalFactsFrom(
	explanation: RunExplanation,
	opts: { entryId: number; enabled: boolean }
): SignalFacts {
	const row = signalRow(explanation, opts.entryId)
	const facts: SignalFacts = {
		read: row?.outcome === "included",
		...readInFacts(opts.entryId, explanation)
	}

	if (row) {
		const lexical = lexicalScore(row)
		if (lexical !== undefined) facts.lexical = lexical
		const semantic = semanticScore(row)
		if (semantic !== undefined) facts.semantic = semantic
		const headroom = headroomOf(explanation, row.source)
		if (headroom !== undefined) facts.headroom = headroom
		return facts
	}

	// No row is a real answer rather than a failure: no mechanism offered the
	// entry to the ranker and none declined it by name. Which of the three
	// silences it was is the whole of what this says.
	facts.reason = !opts.enabled
		? "it is switched off"
		: explanation.ranked
			? "nothing reported on it"
			: "this turn ranked nothing at all"
	return facts
}

/** The budget clause, which says the ceiling only where one was recorded. */
function budgetClause(facts: SignalFacts): string | null {
	if (facts.tokens === undefined) return null
	const room =
		facts.budget !== undefined
			? `${facts.tokens} of ${facts.budget} tokens`
			: `${facts.tokens} tokens`
	const headroom =
		facts.headroom !== undefined
			? `, ${facts.headroom} ${
					facts.headroom === 1 ? "entry" : "entries"
				} ahead of the ceiling`
			: ""
	return `Within budget, ${room}${headroom}`
}

/**
 * "Would be read in, rank 2 of 12 · Matched umber in message 3 · lexical 0.81
 * · semantic 0.64 · Within budget, 218 of 900 tokens, 4 entries ahead of the
 * ceiling".
 */
export function signalsResult(facts: SignalFacts): string {
	const parts: string[] = []
	if (facts.read)
		parts.push(
			facts.rank !== undefined && facts.of !== undefined
				? `Would be read in, rank ${facts.rank} of ${facts.of}`
				: "Would be read in"
		)
	else
		parts.push(
			`Would not be read in · ${facts.reason ?? "nothing reported on it"}`
		)

	if (facts.matched)
		parts.push(
			facts.inMessage !== undefined
				? `Matched ${facts.matched} in message ${facts.inMessage}`
				: `Matched ${facts.matched}`
		)
	if (facts.lexical !== undefined)
		parts.push(`lexical ${facts.lexical.toFixed(2)}`)
	if (facts.semantic !== undefined)
		parts.push(`semantic ${facts.semantic.toFixed(2)}`)
	const budget = budgetClause(facts)
	if (budget) parts.push(budget)
	return parts.join(" · ")
}
