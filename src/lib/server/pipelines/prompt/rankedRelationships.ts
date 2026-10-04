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
 * A port whose band admitted nothing the relationship step read renders the
 * dump, unchanged. That covers four cases with one rule: a spec that never
 * wired the mechanism (the two narrate documents, and any plugin's), a session
 * with no graph, a band that admitted only lane-less hits another mechanism
 * found (no section renders those), and — the shipped one —
 * `share.relationships` at 0, where `select` excludes the whole band with
 * `excluded_group_disabled` and nothing is allocated. So the default install
 * renders exactly the prompt it rendered before, and raising the share is what
 * moves the graph from *dumped whole* to *retrieved*.
 *
 * ⚠ A band that admitted a lore-link hop and none of the ties is NOT a fallback
 * (plan A2 review). The relationship step reads the same ties the dump holds
 * and ranks its hops below every one of them, so such a band had the ties in
 * front of it and left them out — the budget's answer. The dump would put back
 * exactly what the budget excluded, outside it.
 */

import type {
	GraphRelationshipEntry,
	GraphRelationshipRow
} from "$lib/server/utils/graphContextFormatter"

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
		/** `"link"` on a lore-link hop. */
		via?: unknown
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

/**
 * The lanes a tie can be filed under — the claims the relationship sections
 * are built from (`GraphRelationshipRow["lane"]`).
 */
const TIE_LANES: ReadonlySet<string> = new Set<GraphRelationshipRow["lane"]>([
	"yourRelationships",
	"howOthersRegardYou",
	"legendaryFigures",
	"castRelationships"
])

/**
 * A tie filed under a lane: something the sections can render. A lore-link hop
 * reaches the `relationships` band with no lane (see the hop's own note in
 * `bindings.relationships.ts`), and so does anything another source publishes
 * on the band, so no section renders them.
 */
const hasLane = (c: TieCandidate): boolean =>
	typeof c.payload?.lane === "string" && TIE_LANES.has(c.payload.lane)

/**
 * Something the relationship step read: a tie under a lane, or a lore-link hop
 * (`via: "link"`). Either one in the band means the step's ties were ranked
 * there, so what the band admitted is the answer — even when that is none of
 * the ties. A lane-less hit another source published on the band (a
 * plugin's, say — Search by meaning asks for lorebook entries only) is not:
 * it says nothing about whether the ties were ever candidates.
 */
const readByTheStep = (c: TieCandidate): boolean =>
	hasLane(c) || c.payload?.via === "link"

const nameOf = (c: TieCandidate): string =>
	typeof c.payload?.name === "string" ? c.payload.name : ""

const entryOf = (c: TieCandidate): GraphRelationshipEntry | undefined => {
	const e = c.payload?.entry
	return e && typeof e === "object"
		? (e as GraphRelationshipEntry)
		: undefined
}

/**
 * A list per key, keyed by a NAME — built in a `Map` and only then made an
 * object.
 *
 * ⚠ **Never `out[name] ??= …` on a plain `{}`.** Every key here is a character
 * or entry name, which is untrusted — a guest can bind an attacker-named
 * character into a shared lorebook (`graphContextFormatter.ts`'s header). A
 * member named `__proto__` made `(out[holder] ??= {})[other] ??= []` write
 * `Object.prototype[other]` for the whole server process, and `constructor`
 * wrote onto `Object` itself; in the one-level shape it threw instead (review
 * 2026-09-29, F6(a)). A `Map` has no inherited keys, and `Object.fromEntries`
 * defines each as an own property — `__proto__` included — so a name is only
 * ever a name.
 */
const pushTo = <V>(m: Map<string, V[]>, key: string, value: V) => {
	const list = m.get(key)
	if (list) list.push(value)
	else m.set(key, [value])
}

/** Group ties under a heading, keeping the rank order they arrived in. */
function group(
	ties: readonly TieCandidate[],
	headingOf: (c: TieCandidate) => string
): Record<string, GraphRelationshipEntry[]> {
	const out = new Map<string, GraphRelationshipEntry[]>()
	for (const c of ties) {
		const heading = headingOf(c)
		const entry = entryOf(c)
		if (!heading || !entry) continue
		pushTo(out, heading, entry)
	}
	return Object.fromEntries(out)
}

/** The legendary lane, back in the nested shape the dump publishes. */
function figures(
	ties: readonly TieCandidate[]
): Record<string, Record<string, unknown>> {
	const out = new Map<
		string,
		{
			summary?: string
			state?: string
			relationships: Map<string, GraphRelationshipEntry[]>
		}
	>()
	for (const c of ties) {
		const heading = nameOf(c)
		const entry = entryOf(c)
		if (!heading) continue
		let figure = out.get(heading)
		if (!figure) out.set(heading, (figure = { relationships: new Map() }))
		// The figure's own two facts, once, from the first tie that carries
		// them — they describe the figure and not the tie.
		if (c.payload?.figure?.summary !== undefined && figure.summary === undefined)
			figure.summary = c.payload.figure.summary
		if (c.payload?.figure?.state !== undefined && figure.state === undefined)
			figure.state = c.payload.figure.state
		if (!entry) continue
		const counterpart =
			typeof c.payload?.counterpart === "string"
				? c.payload.counterpart
				: heading
		pushTo(figure.relationships, counterpart, entry)
	}
	return Object.fromEntries(
		[...out].map(([heading, f]) => [
			heading,
			{
				...(f.summary !== undefined ? { summary: f.summary } : {}),
				...(f.state !== undefined ? { state: f.state } : {}),
				...(f.relationships.size
					? { relationships: Object.fromEntries(f.relationships) }
					: {})
			}
		])
	)
}

/**
 * The **cast-wide read** as the planner and the narrator are handed it (genre plan F6(a),
 * 2026-09-29): the admitted `castRelationships` ties, keyed by who holds each
 * view and then by whom it is of, in the order the ranker put them.
 *
 * Handed the ranker's whole allocation — the same list every lore band rides —
 * and reads only this lane, so a speaker's ties or a lore-link hop on the same
 * port can never render here. `null` for nothing admitted: a band at share 0, a
 * cast with no ties, or a port nobody wired.
 *
 * The shape is the speaker's `relationshipsPerspectives` one level up — `{other:
 * [entry]}` under each holder — because it is the same claim made for every
 * member at once, and the JSON the graph has always been shown as.
 */
export function castRelationshipsSection(
	band: unknown
): Record<string, Record<string, GraphRelationshipEntry[]>> | null {
	if (!Array.isArray(band)) return null
	const ties = orderedTies(
		band.filter(
			(c): c is TieCandidate =>
				!!c && typeof c === "object" && typeof c.source === "string"
		)
	).filter((c) => c.payload?.lane === "castRelationships")
	// Maps, not `{}` — see `pushTo`: both levels are keyed by names.
	const out = new Map<string, Map<string, GraphRelationshipEntry[]>>()
	for (const c of ties) {
		const holder = nameOf(c)
		const other =
			typeof c.payload?.counterpart === "string" ? c.payload.counterpart : ""
		const entry = entryOf(c)
		if (!holder || !other || !entry) continue
		let views = out.get(holder)
		if (!views) out.set(holder, (views = new Map()))
		pushTo(views, other, entry)
	}
	return out.size
		? Object.fromEntries(
				[...out].map(([holder, views]) => [
					holder,
					Object.fromEntries(views)
				])
			)
		: null
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

	const admitted = orderedTies(value.band)
	// Nothing the relationship step read was allocated: the band is off,
	// empty, holds only another mechanism's lane-less hits, or this spec never
	// wired the step. The dump is what every run has always rendered, so it
	// is what renders.
	if (!admitted.some(readByTheStep)) return value.graph ?? null
	const ties = admitted.filter(hasLane)

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
