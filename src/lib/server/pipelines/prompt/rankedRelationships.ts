/**
 * The relationship sections, rebuilt from what ranking actually selected.
 *
 * ## What was wrong
 *
 * `core:query/relationship-search@1` reads the narrative graph as candidates in
 * the `relationships` band, `select` budgets them and the receipt reports every
 * one with a reason — and the prompt rendered none of it. The two template
 * variables were fed by the graph **dump**: every tie the traversal reached, in
 * whatever order the database returned the rows, outside the budget entirely.
 * So the band reached allocation and stopped there.
 *
 * ## What this is
 *
 * `core:task/build-template-context@1`'s two relationship in-ports carry both
 * halves now — the allocated band, and the dump behind it — and this projects
 * whichever applies back into the section shape the variable layouts already
 * render. The shape is `buildGraphContextData`'s, key for key, because the
 * layouts are written against it and a second shape would change the prompt for
 * a reason nobody asked for. What changes is *which ties are in it* and *in what
 * order*.
 *
 * ## The fallback is per run, not per install
 *
 * A port with no relationship candidates on it renders the dump, unchanged.
 * That covers three cases with one rule: a spec that never wired the mechanism
 * (the two narrate documents, and any plugin's), a session with no graph, and —
 * the shipped one — `share.relationships` at 0, where `select` excludes the
 * whole band with `excluded_group_disabled` and nothing is allocated. So the
 * default install renders exactly the prompt it rendered before, and raising the
 * share is what moves the graph from *dumped whole* to *retrieved*.
 */

import type { GraphRelationshipEntry } from "$lib/server/utils/graphContextFormatter"

/** Which half of the graph a port carries. See the two `renders` it feeds. */
export type RelationshipHalf = "perspectives" | "known"

/**
 * One allocated tie, as much of a candidate as this reads.
 *
 * `position` is the ranker's own index, published by the query as the order it
 * decided — see below for why it is read rather than the arrival order.
 */
interface TieCandidate {
	source?: unknown
	position?: unknown
	payload?: {
		name?: unknown
		lane?: unknown
		counterpart?: unknown
		entry?: unknown
		figure?: { summary?: string; state?: string }
	}
}

/**
 * What a wired port carries: the allocated band, and the traversal's own
 * section behind it.
 *
 * Two keys rather than two ports because the ports are declared and the version
 * is frozen — and because they are one question, not two. The spec wires it as
 * a nested literal, which is the same construction `concat-candidates`'
 * `sources` array already uses.
 */
interface RelationshipPort {
	band: readonly TieCandidate[]
	graph?: unknown
}

/**
 * Is this a wired port, or the dump on its own?
 *
 * ⚠ The membership test is deliberately strict, because the dump's own
 * perspectives section is **keyed by character name** — a character called
 * "band" is a legal lorebook row. So an envelope must carry a `band` array
 * whose every member is a candidate (a `source` string), which no array of
 * `GraphRelationshipEntry` can be, and no key outside the two.
 */
const isPort = (v: unknown): v is RelationshipPort => {
	if (!v || typeof v !== "object" || Array.isArray(v)) return false
	const o = v as Record<string, unknown>
	if (!Object.keys(o).every((k) => k === "band" || k === "graph"))
		return false
	return (
		Array.isArray(o.band) &&
		o.band.every(
			(c) =>
				!!c &&
				typeof c === "object" &&
				typeof (c as TieCandidate).source === "string"
		)
	)
}

/**
 * The band, in the order the ranker put it in.
 *
 * ⚠ **Sorted by `position`, not taken as it arrives.** `select` returns its
 * inclusions in passes — pinned, then floors, then score order, then whatever
 * the spillover sweep could fit — so a tie admitted by the sweep arrives after
 * one that scored below it. `position` is the query's own rank index and is the
 * only thing here that means "first" the way the ruling does.
 */
const orderedTies = (band: readonly TieCandidate[]): TieCandidate[] =>
	band
		.filter((c) => c.source === "relationships")
		.map((c, i) => ({
			c,
			at: typeof c.position === "number" ? c.position : i
		}))
		.sort((a, b) => a.at - b.at)
		.map(({ c }) => c)

const nameOf = (c: TieCandidate): string =>
	typeof c.payload?.name === "string" ? c.payload.name : ""

const entryOf = (c: TieCandidate): GraphRelationshipEntry | undefined => {
	const e = c.payload?.entry
	return e && typeof e === "object"
		? (e as GraphRelationshipEntry)
		: undefined
}

/** Group ties under a heading, keeping the rank order they arrived in. */
function group(
	ties: readonly TieCandidate[],
	headingOf: (c: TieCandidate) => string
): Record<string, GraphRelationshipEntry[]> {
	const out: Record<string, GraphRelationshipEntry[]> = {}
	for (const c of ties) {
		const heading = headingOf(c)
		const entry = entryOf(c)
		if (!heading || !entry) continue
		;(out[heading] ??= []).push(entry)
	}
	return out
}

/** The legendary lane, back in the nested shape the dump publishes. */
function figures(
	ties: readonly TieCandidate[]
): Record<string, Record<string, unknown>> {
	const out: Record<string, Record<string, unknown>> = {}
	for (const c of ties) {
		const heading = nameOf(c)
		const entry = entryOf(c)
		if (!heading) continue
		const figure = (out[heading] ??= {})
		// The figure's own two facts, once, from the first tie that carries
		// them — they describe the figure and not the tie.
		if (c.payload?.figure?.summary !== undefined && !("summary" in figure))
			figure.summary = c.payload.figure.summary
		if (c.payload?.figure?.state !== undefined && !("state" in figure))
			figure.state = c.payload.figure.state
		if (!entry) continue
		const counterpart =
			typeof c.payload?.counterpart === "string"
				? c.payload.counterpart
				: heading
		const rels = (figure.relationships ??= {}) as Record<
			string,
			GraphRelationshipEntry[]
		>
		;(rels[counterpart] ??= []).push(entry)
	}
	return out
}

/**
 * What the template variable should be handed.
 *
 * Returns the value unchanged when the port is not wired — which is what makes
 * a spec that never wired the mechanism byte-identical — and `null` for a half
 * the band selected nothing for, matching `capRelationships`' own absent value
 * so the shipped `{{#if}}` guards stay falsy.
 */
export function relationshipSections(
	value: unknown,
	half: RelationshipHalf
): unknown {
	if (!isPort(value)) return value

	const ties = orderedTies(value.band)
	// Nothing allocated: the band is off, empty, or this spec never wired it.
	// The dump is what every run has always rendered, so it is what renders.
	if (ties.length === 0) return value.graph ?? null

	if (half === "perspectives") {
		const mine = group(
			ties.filter((c) => c.payload?.lane === "yourRelationships"),
			nameOf
		)
		return Object.keys(mine).length ? mine : null
	}

	// Two conditional sections, and absent means absent — an install with no
	// legendary figures has no key at all rather than an empty object, which is
	// what the shipped layout's guards are written against.
	const known = group(
		ties.filter((c) => c.payload?.lane === "howOthersRegardYou"),
		nameOf
	)
	const legendary = figures(
		ties.filter((c) => c.payload?.lane === "legendaryFigures")
	)
	const out: Record<string, unknown> = {}
	if (Object.keys(known).length) out.howOthersRegardYou = known
	if (Object.keys(legendary).length) out.legendaryFigures = legendary
	return Object.keys(out).length ? out : null
}
