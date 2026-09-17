/**
 * What a spec's shape says about how it has to be run.
 *
 * Every reply runs end to end now — one road (09-B B4, R-17): the spec creates
 * its own row at a placeholder outlet, its oracles run, and its last outlet
 * fills the row. What this module still decides is which oracle's stream is
 * the reply's prose, because a run has ONE live row and several oracles may
 * run before the write.
 *
 * ⚠ **An oracle inside a clause does not count** as a stage, and that is
 * deliberate rather than incidental: `core:spec/respond` puts its two `embed`
 * oracles inside gather clauses precisely so the preview does not halt on
 * them (see the note on its `names` block).
 */

import type { SpecDocument } from "@serene-pub/sdk"

type Node = SpecDocument["nodes"][number]

/**
 * The outlets that write a message's text — the one that FILLS the row first,
 * then the one that creates it complete. A spec with both (the reply's
 * placeholder → update pair) streams to the update's oracle; a spec with only
 * a create (an image post, the echo) streams to the create's.
 */
const MESSAGE_CONSUMERS = [
	"core:outlet/update-message",
	"core:outlet/create-message"
]

/** The generating stages the executor's preview halt can see, in document order. */
export function spineProviders(doc: SpecDocument): Node[] {
	return doc.nodes
		.filter((n) => !n.clauseId && n.kind === "oracle")
		.sort((a, b) => a.position - b.position)
}

/**
 * The stage whose tokens are the reply's prose, when the document names one.
 *
 * A run has ONE live row, so every Provider in a multi-stage spec would stream
 * into the same place. Most of them must not: a planner emits JSON, a
 * state-keeper emits JSON, and several voices generating in parallel would
 * interleave into nonsense. So exactly one node is allowed to stream, chosen
 * here — and core routes the stream (R-21 (2)), never the oracle, which stays
 * blind to messages.
 *
 * It is the spine Provider NEAREST the message-writing outlet along the data
 * edges — nearest, not earliest. Every stage is an ancestor of the reply in a
 * pipeline that plans before it narrates (the planner's JSON feeds the
 * narrator's context), so "the earliest ancestor" is the planner, which is the
 * one answer that is always wrong. Distance is what separates "produced the
 * prose" from "informed whoever did".
 *
 * Explicit edges only — the implicit chain edge is execution order, not a data
 * path, and following it would make every node an ancestor of every later one.
 *
 * Undefined when nothing qualifies, and that is a legitimate answer: the run
 * then reports its stages and the reply lands when it is assembled.
 */
export function narratingProvider(doc: SpecDocument): string | undefined {
	const consumer = MESSAGE_CONSUMERS.map(
		(definitionId) =>
			doc.nodes
				.filter((n) => n.definitionId.startsWith(definitionId))
				.sort((a, b) => a.position - b.position)[0]
	).find((n) => n !== undefined)
	if (!consumer) return undefined

	const byKey = new Map(doc.nodes.map((n) => [n.key, n]))
	const seen = new Set<string>([consumer.key])
	let frontier = [consumer.key]
	while (frontier.length) {
		const next: string[] = []
		for (const to of frontier)
			for (const edge of doc.edges) {
				if (edge.implicit || edge.to !== to || seen.has(edge.from))
					continue
				seen.add(edge.from)
				next.push(edge.from)
			}
		// The whole level at once, so "nearest" is decided before "earliest":
		// a tie inside one level falls back to document order, which is the
		// only ordering a document gives two independent stages.
		const found = next
			.map((key) => byKey.get(key))
			.filter(
				(n): n is Node => !!n && !n.clauseId && n.kind === "oracle"
			)
			.sort((a, b) => a.position - b.position)[0]
		if (found) return found.key
		frontier = next
	}
	return undefined
}
