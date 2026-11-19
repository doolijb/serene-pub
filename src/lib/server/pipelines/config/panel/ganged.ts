/**
 * 🚧 A **ganged control** — one switch the panel shows where a pipeline has
 * several reads that each declare the same parameter.
 *
 * The params core gangs are a fixed table (`GANGED_PARAMS`): `knownToSpeaker`
 * (*Only what the speaker knows*) and `speakerInCast` (*Only scenes the speaker
 * was in*). A pipeline whose `declarations()` hold two or more `params`
 * declarations at one of those paths shows ONE derived option per path, in the
 * Advanced step of the read that owns the lore lanes, in place of one per read
 * (owner ruling D36, 2026-11-16). Nothing here is declared by a spec or a definition (P5): it is
 * derived from the declarations the way every other option is.
 *
 * What it is **not**:
 * - **Not a `shared` field** (`FieldDecl.shared`, the scan settings' owner-lane
 *   mechanism). A shared field resolves at the owner's address for every lane, and
 *   the RUN reads it there — a modder's per-query value would be silently
 *   overridden. A ganged control changes nothing at run time: every read keeps its
 *   own stored address and its own value, and the control only reads and writes
 *   all of them together.
 * - Not a way to drop the per-read declarations: `reconcileConfigs` back-fills
 *   and culls stored rows from `declarations()`, so they stay.
 * - Not a general registry. A fixed table of the params core gangs; no option
 *   for others.
 *
 * Pure helpers only; the wiring is in `read.ts` (the option), `write.ts` (the
 * fan-out write) and `sessions/settingsForm.ts` (the field).
 */

/**
 * 🚧 The params that are ganged, keyed by param path.
 * ★ Every label and description is one sentence, awaiting the owner's word.
 */
export const GANGED_PARAMS: Record<
	string,
	{ label: string; description: string; home?: "first" }
> = {
	knownToSpeaker: {
		label: "Only what the speaker knows",
		description: "Leaves out what the speaking character does not know, on every lore read of this pipeline."
	},
	speakerInCast: {
		label: "Only scenes the speaker was in",
		description:
			"Leaves out the earlier scenes the speaking character was not in, and those scenes' part of each history day, on every read of this pipeline.",
		// Sits where the first read of the pipeline that declares it is (the earlier-scenes
		// read, ahead of the lore lanes), not on the lore owner (wt-1b-fix2, 2026-11-17).
		home: "first"
	}
}

/** ★ The words under the control when its reads hold different values. */
export const gangedDifferenceWords = (n: number) =>
	`Set differently on ${n} of this pipeline's reads`

/** An address's id seed no real node key can spell (`ids.ts`: the payload names no node). */
export const GANGED_PSEUDO_NODE = "\u0001ganged"

/** The shape of a declaration this file reads. */
interface GangedDecl {
	nodeKey: string
	slot: string
	matrixSlot: string
	path: string
}

/** The shape of a stored node this file reads (a `GroupingNode`, or the columns the settings form selects). */
interface GangedNode {
	key?: string
	nodeKey?: string
	position?: number
	config?: Record<string, unknown> | null
	resolvedRefs?: Record<string, string> | null
}

/**
 * The reads whose value the control gangs, and the one it sits on (its *home*).
 * Null with fewer than two members: that read's own option stays.
 *
 * The home is the member the other members' `params` references point at (the
 * node that owns the lore lanes: `{ __ref: "slot", ofNode }` in the stored
 * config), the first such in spine order; with no such reference, the first
 * member in spine order. A param marked `home: "first"` always takes the
 * first member in spine order.
 */
export function gangedMembersOf<D extends GangedDecl>(
	decls: readonly D[],
	nodes: readonly GangedNode[],
	path: string
): { members: D[]; home: D } | null {
	const members = decls.filter((d) => d.matrixSlot === "params" && d.path === path)
	if (members.length < 2) return null
	const keyOf = (n: GangedNode) => n.key ?? n.nodeKey ?? ""
	const order = new Map(nodes.map((n) => [keyOf(n), n.position ?? Number.MAX_SAFE_INTEGER]))
	const spine = (d: D) => order.get(d.nodeKey) ?? Number.MAX_SAFE_INTEGER
	const bySpine = [...members].sort((a, b) => spine(a) - spine(b))
	const memberKeys = new Set(members.map((d) => d.nodeKey))
	const owners = new Set<string>()
	for (const n of nodes) {
		if (!memberKeys.has(keyOf(n))) continue
		for (const [k, v] of Object.entries(n.config ?? {})) {
			if (!v || typeof v !== "object" || (v as { __ref?: unknown }).__ref !== "slot") continue
			const target = n.resolvedRefs?.[k] ?? (v as { ofNode?: unknown }).ofNode
			if (typeof target === "string" && target !== keyOf(n) && memberKeys.has(target)) owners.add(target)
		}
	}
	const home =
		(GANGED_PARAMS[path]?.home === "first" ? undefined : bySpine.find((d) => owners.has(d.nodeKey))) ?? bySpine[0]!
	return { members, home }
}

/** One member's reading, as the panel resolved it. */
export interface GangedMemberReading {
	value: unknown
	source: string
	changed: boolean
	overriddenHere: boolean
	writable: boolean
}

// Least to most specific; the settings form's layers sit between author and session.
const SPECIFICITY = ["author", "config", "instance", "genre", "preset", "session"]

/**
 * The one control's reading: the value every member holds, or when they differ
 * the value most hold (a tie: `fallback`, the declared default) with `differing`
 * the number holding the other; the common source, else the most specific of
 * theirs; changed / overridden when any is; writable only when every one is.
 */
export function gangedReading(
	readings: readonly GangedMemberReading[],
	fallback: unknown
): GangedMemberReading & { differing: number } {
	const counts = new Map<string, { value: unknown; n: number }>()
	for (const r of readings) {
		const k = JSON.stringify(r.value) ?? "undefined"
		counts.set(k, { value: r.value, n: (counts.get(k)?.n ?? 0) + 1 })
	}
	const ranked = [...counts.values()].sort((a, b) => b.n - a.n)
	const tie = ranked.length > 1 && ranked[0]!.n === ranked[1]!.n
	const value = tie ? fallback : ranked[0]!.value
	const differing = readings.filter((r) => JSON.stringify(r.value) !== JSON.stringify(value)).length
	const sources = [...new Set(readings.map((r) => r.source))]
	const source =
		sources.length === 1
			? sources[0]!
			: sources.sort((a, b) => SPECIFICITY.indexOf(b) - SPECIFICITY.indexOf(a))[0]!
	return {
		value,
		differing,
		source,
		changed: readings.some((r) => r.changed),
		overriddenHere: readings.some((r) => r.overriddenHere),
		writable: readings.every((r) => r.writable)
	}
}
