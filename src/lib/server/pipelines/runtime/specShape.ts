/**
 * What a spec's shape says about how it has to be run.
 *
 * The reply path has two roads. One compiles the prompt and hands it to a
 * connection adapter, which sends it and streams the answer into the message row
 * (`generateResponse`); the other runs the whole document through the executor
 * and lets the spec's own Consumer write the reply. Which road a session takes
 * is a property of the SPEC, never of the genre — a genre id is a label, and a
 * routing rule keyed on one would have to be extended for every genre anybody
 * ever writes, including the ones in extensions.
 *
 * The property is the count of Provider nodes on the spine, because that is the
 * same fact the executor's preview halt reads (`previewTarget`: the first
 * `!blockId && kind === 'provider'` by position). One such node means the halt
 * stops exactly where the adapter takes over and nothing downstream is lost.
 * Several means the halt would stop at the FIRST stage and discard every one
 * after it — which is the defect this module exists to route around.
 *
 * ⚠ **A Provider inside a block does not count**, and that is deliberate rather
 * than incidental: `core:spec/respond` puts its two `embed` Providers inside
 * `async` blocks precisely so the preview does not halt on them (see the note on
 * its `names` block). Counting them would move chat onto the other road.
 */

import type { SpecDocument } from "@serene-pub/sdk"

type Node = SpecDocument["nodes"][number]

/** Where the message a reply writes ends up. */
const MESSAGE_CONSUMER = "core:consumer/create-message"

/** The generating stages the executor's preview halt can see, in document order. */
export function spineProviders(doc: SpecDocument): Node[] {
	return doc.nodes
		.filter((n) => !n.blockId && n.kind === "provider")
		.sort((a, b) => a.position - b.position)
}

/**
 * Whether this spec must be run to completion rather than previewed.
 *
 * More than one stage, and only that. A spec with exactly one keeps the adapter
 * path it has always had, byte for byte; a spec with none keeps today's
 * behaviour too — it has no payload to preview, so the reply path refuses it
 * with the sentence it already composes, which is a separate defect and not
 * this one's to change.
 */
export function runsToCompletion(doc: SpecDocument): boolean {
	return spineProviders(doc).length > 1
}

/**
 * The stage whose tokens are the reply's prose, when the document names one.
 *
 * A run has ONE sink — a callback on the host scope, not a per-node port — so
 * every Provider in a multi-stage spec would stream into the same place. Most of
 * them must not: a planner emits JSON, a state-keeper emits JSON, and several
 * voices generating in parallel would interleave into nonsense. So exactly one
 * node is allowed to stream, chosen here.
 *
 * It is the spine Provider NEAREST the message Consumer along the data edges —
 * nearest, not earliest. Every stage is an ancestor of the reply in a pipeline
 * that plans before it narrates (the planner's JSON feeds the narrator's
 * context), so "the earliest ancestor" is the planner, which is the one answer
 * that is always wrong. Distance is what separates "produced the prose" from
 * "informed whoever did".
 *
 * Explicit edges only — the implicit chain edge is execution order, not a data
 * path, and following it would make every node an ancestor of every later one.
 *
 * Undefined when nothing qualifies, and that is a legitimate answer: the run
 * then reports its stages and the reply lands when it is assembled.
 */
export function narratingProvider(doc: SpecDocument): string | undefined {
	const consumer = doc.nodes
		.filter((n) => n.typeId.startsWith(MESSAGE_CONSUMER))
		.sort((a, b) => a.position - b.position)[0]
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
				(n): n is Node => !!n && !n.blockId && n.kind === "provider"
			)
			.sort((a, b) => a.position - b.position)[0]
		if (found) return found.key
		frontier = next
	}
	return undefined
}
