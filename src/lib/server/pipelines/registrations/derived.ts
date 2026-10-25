/**
 * 🚧 **Derived numbers** (PROPOSAL-layering §7, §12 A17; lane 5b,
 * 2026-10-20) — what a preset's card says, read from what it registers rather
 * than typed by its author (`PresetDecl.callsPerTurn` ⏳ is only checked
 * against this now):
 *
 *  · **calls per turn** — the model calls one turn costs: those of the
 *    pipelines registered on `message-respond` (the reply), plus those of
 *    every routine due after each turn or each round at its default mode
 *    (not Off). A routine every N turns, on an event, or on a clock is not a
 *    per-turn cost.
 *  · **write targets** — what the registered pipelines write: each write
 *    step (`outlet`) of every registered pipeline, once, by name.
 *
 * A pipeline's model calls are its text-model steps along the longest path
 * through its branches: a junction's branches are alternatives (the largest
 * counts), everything else on a path runs (a loop's body counts once — one
 * call per pass is the floor). An embedding, a sprite pick and an image are
 * not model calls in this sense: the card counts what a text model is asked.
 */
import {
	sessionEvents,
	type EffectiveRegistration,
	type RegistrationDecl,
	type SpecDocument
} from "@serene-pub/sdk"

/** Steps that ask a text model for words — what the card counts. */
export const MODEL_CALL_DEFINITIONS: ReadonlySet<string> = new Set([
	"core:oracle/generate-text",
	"core:oracle/generate-json",
	"core:oracle/generate-with-tools",
	"core:oracle/summarize-batch",
	"core:oracle/summarize-synth",
	"core:oracle/extract-cast",
	"core:oracle/name-entry",
	"core:oracle/describe-image",
	"core:oracle/turn-advise"
])

/** The cadences due once a turn or once a round (lane 1's ready-made `afterEachTurn`, `afterEachRound`). */
export const PER_TURN_CADENCES: ReadonlySet<string> = new Set([
	"core:cadence/after-each-turn@1",
	"core:cadence/after-each-round@1"
])

type Clause = { id: string; kind: string; parent?: string }
type Node = SpecDocument["nodes"][number] & { clauseId?: string; clauseChain?: string }

/**
 * The model calls of one pipeline along its longest path (see the module
 * note). Pure over the document.
 */
export function modelCallsOf(doc: SpecDocument): number {
	const nodes = doc.nodes as Node[]
	const raw = ((doc as { clauses?: Clause[] }).clauses ?? []) as Clause[]
	// A clause's parent is stated, or read off its id: the longest other
	// clause id it extends (`mode.agentic.tools` sits in `mode`'s `agentic`).
	const clauses: Clause[] = raw.map((c) => {
		if (c.parent) return c
		const parent = raw
			.filter((o) => o.id !== c.id && c.id.startsWith(`${o.id}.`))
			.sort((a, b) => b.id.length - a.id.length)[0]
		return parent ? { ...c, parent: parent.id } : c
	})
	const calls = (n: Node) => (n.kind === "oracle" && MODEL_CALL_DEFINITIONS.has(n.definitionId) ? 1 : 0)
	/** The branch of `parent` a clause sits in: the id segment after the parent's. */
	const branchIn = (c: Clause): string | undefined => {
		if (!c.parent || !c.id.startsWith(`${c.parent}.`)) return undefined
		return c.id.slice(c.parent.length + 1).split(".")[0]
	}
	const count = (clause: string | undefined, chain: string | undefined): number => {
		let total = nodes
			.filter((n) => (n.clauseId ?? undefined) === clause && (clause === undefined || n.clauseChain === chain))
			.reduce((a, n) => a + calls(n), 0)
		const children = clauses.filter((c) =>
			clause === undefined ? !c.parent : c.parent === clause && branchIn(c) === chain
		)
		for (const c of children) total += clauseCalls(c)
		return total
	}
	const clauseCalls = (c: Clause): number => {
		const chains = new Set<string | undefined>(
			nodes.filter((n) => n.clauseId === c.id).map((n) => n.clauseChain ?? undefined)
		)
		for (const k of clauses) if (k.parent === c.id) chains.add(branchIn(k))
		const per = [...chains].map((ch) => count(c.id, ch))
		if (!per.length) return 0
		// A junction's branches are alternatives; any other clause's chains all run.
		return c.kind === "junction" ? Math.max(...per) : per.reduce((a, b) => a + b, 0)
	}
	return count(undefined, undefined)
}

/** The write steps of a pipeline, by definition id (unversioned), once each. */
export function writeTargetsOf(doc: SpecDocument): string[] {
	return [...new Set((doc.nodes as Node[]).filter((n) => n.kind === "outlet").map((n) => n.definitionId))]
}

export interface DerivedNumbers {
	/** The model calls one turn costs (the reply's plus the per-turn routines'). */
	callsPerTurn: number
	/** The reply's share — what a turn costs before any routine runs. */
	replyCalls: number
	/** The per-turn routines' share. */
	routineCalls: number
	/** The per-turn routines counted, by registration key. */
	perTurnRoutines: string[]
	/** What the registered pipelines write, each once, with its name. */
	writeTargets: Array<{ id: string; name: string }>
}

const isOn = (r: RegistrationDecl) => (r.mode ?? "full") !== "off"

/**
 * The numbers of a list of effective registrations, given their pipelines'
 * documents (`docs` by spec slug; one missing counts nothing). `name` turns a
 * write step's definition id into its display name.
 */
export function derivedNumbersOf(
	regs: readonly (EffectiveRegistration | RegistrationDecl)[],
	docs: ReadonlyMap<string, SpecDocument | null>,
	name: (definitionId: string) => string = (id) => id
): DerivedNumbers {
	let replyCalls = 0
	let routineCalls = 0
	const perTurnRoutines: string[] = []
	const targets = new Map<string, string>()
	for (const r of regs) {
		const doc = docs.get(r.pipeline)
		if (!doc) continue
		const routine = r.trigger.family === "routine"
		if (!routine || isOn(r)) for (const t of writeTargetsOf(doc)) if (!targets.has(t)) targets.set(t, name(t))
		if (r.trigger.family === "event" && r.trigger.event === sessionEvents.messageRespond)
			replyCalls += modelCallsOf(doc)
		else if (r.trigger.family === "routine" && PER_TURN_CADENCES.has(r.trigger.cadence.id) && isOn(r)) {
			routineCalls += modelCallsOf(doc)
			perTurnRoutines.push(r.key)
		}
	}
	return {
		callsPerTurn: replyCalls + routineCalls,
		replyCalls,
		routineCalls,
		perTurnRoutines,
		writeTargets: [...targets].map(([id, n]) => ({ id, name: n }))
	}
}

/** A write step's display name: its definition's, else its id's tail humanised. */
export async function writeTargetNamer(): Promise<(definitionId: string) => string> {
	const { getDefinition, i18nText } = await import("@serene-pub/sdk")
	return (id: string) => {
		const def = getDefinition(`${id}@1`) as { i18n?: { name?: unknown } } | undefined
		const named = i18nText(def?.i18n?.name as never)
		if (named) return named
		const tail = id.slice(id.lastIndexOf("/") + 1)
		return tail.charAt(0).toUpperCase() + tail.slice(1).replace(/-/g, " ")
	}
}

/**
 * The numbers per preset, until anything a resolution reads changes (a
 * registration, a preset, a publish — `invalidateRegistrations`). The list
 * that carries them is re-sent on every preset write; reading every
 * registered pipeline's document for it each time is what this saves.
 */
const cache = new WeakMap<object, Map<number, DerivedNumbers>>()
const handles = new Set<object>()
let listening = false

/** Each preset's derived numbers (its genre's defaults with its changes), by preset id. */
export async function presetDerivedNumbers(db: Db, presetIds: readonly number[]): Promise<Map<number, DerivedNumbers>> {
	const out = new Map<number, DerivedNumbers>()
	if (!presetIds.length) return out
	const { presetRegistrations, onRegistrationsChanged } = await import("$lib/server/pipelines/registrations/resolve")
	if (!listening) {
		listening = true
		onRegistrationsChanged(() => {
			for (const k of handles) cache.delete(k)
			handles.clear()
		})
	}
	// Off under Vitest, as the resolver's cache is: a fixture written straight
	// to the tables is what derives.
	const cacheOn = !(typeof process !== "undefined" && process.env?.VITEST)
	const perDb = (cacheOn ? cache.get(db as object) : undefined) ?? new Map<number, DerivedNumbers>()
	if (cacheOn && !cache.has(db as object)) {
		cache.set(db as object, perDb)
		handles.add(db as object)
	}
	const missing = presetIds.filter((id) => !perDb.has(id))
	for (const id of presetIds) if (perDb.has(id)) out.set(id, perDb.get(id)!)
	if (!missing.length) return out
	const { publishedDocuments } = await import("$lib/server/pipelines/registrations/door")
	const namer = await writeTargetNamer()
	const docs = new Map<string, SpecDocument | null>()
	for (const id of missing) {
		try {
			const resolved = await presetRegistrations(db, id)
			if (!resolved) continue
			await publishedDocuments(
				db,
				resolved.offered.map((r) => r.pipeline),
				docs
			)
			const numbers = derivedNumbersOf(resolved.offered, docs, namer)
			out.set(id, numbers)
			perDb.set(id, numbers)
		} catch (err) {
			console.warn(`[registrations] could not derive preset #${id}'s numbers:`, err)
		}
	}
	return out
}
