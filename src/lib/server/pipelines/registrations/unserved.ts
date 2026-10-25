/**
 * 🚧 **Unserved registrations and recommendations** (R56, 2026-10-21; lane
 * F1) — a registration whose pipeline needs a model nothing on this pub can
 * serve.
 *
 * A pipeline's **required transforms** are those of its model calls: every
 * oracle step whose definition declares a `connection` slot, by that slot's
 * `requires` (`text->text`, `text->image`, …) — except a step that only
 * prepares the prompt and that the run goes on without (`previewRunsThrough`:
 * the reply's *Transcribe audio* step hears what the reply cannot, and a reply
 * with no hearing model still answers). A transform is **served** when a model
 * is set for it — its default loadout names a connection — which is what a
 * run falls back to: nothing is ever picked automatically, so without one the
 * run could only fail.
 *
 * An unserved registration is:
 *  · **disabled** for a routine and an action — the routine is not evaluated
 *    (as if Off) and the action is not offered — never a run that fails on
 *    first use (*Picture each new scene* without an image model). ⚠ Except
 *    for the pub's **baseline**, a text model (`text->text`): a pub with none
 *    can run nothing, and every run already says so in words (the reply
 *    does); disabling is for the models a pub may well do without — one that
 *    draws, speaks, hears or sees (`BASELINE_TRANSFORMS`; owner to confirm);
 *  · shown **"Unavailable: needs a model that can draw pictures."** on the
 *    session's routine row and in the routines list;
 *  · flagged to administrators — in the preset editor, on the presets list
 *    (`recommendations`) and in the boot / change log.
 * An event registration (the reply) still runs and says in its receipt what is
 * missing, as before: answering a person's line with silence is worse than
 * answering it with the sentence that says which model to set.
 *
 * **Recommendations** (per preset): what its registrations in force need
 * (`needs` — the events and routines it runs) and what would make it better
 * (`betterWith` — its actions and its Off routines), in the words a start card
 * prints: *Needs: a text model · Better with: an image model*.
 *
 * Verdicts are recomputed on demand and held a few seconds (`TTL_MS`);
 * `invalidateUnserved` drops them on a model or loadout change, and the
 * registrations' own change hook does too.
 */
import {
	getDefinition,
	isTransformId,
	parseTransform,
	type EffectiveRegistration,
	type SpecDocument
} from "@serene-pub/sdk"

/** How long a pub's served transforms are trusted before they are read again. */
const TTL_MS = 5_000

let served: { at: number; db: object; set: Set<string> } | null = null
const required = new Map<string, readonly string[]>()

/** Forget what was read — a model, a connection or a loadout changed. */
export function invalidateUnserved(): void {
	served = null
}

/** Tests: forget everything. */
export function _resetUnserved(): void {
	served = null
	required.clear()
}

type DocNode = { key: string; kind: string; definitionId: string; definitionVersion: number }

/** The transforms a pipeline's model calls need (see the module note). Pure over the document and the registry. */
export function requiredTransformsOf(doc: Pick<SpecDocument, "id" | "nodes"> & { hash?: string }): readonly string[] {
	const cacheKey = `${doc.id}\u0000${doc.hash ?? ""}`
	if (doc.hash && required.has(cacheKey)) return required.get(cacheKey)!
	const out = new Set<string>()
	for (const n of doc.nodes as unknown as DocNode[]) {
		if (n.kind !== "oracle") continue
		const def = getDefinition(`${n.definitionId}@${n.definitionVersion}`) as
			| { previewRunsThrough?: boolean; slots?: Record<string, { kind?: string; requires?: readonly string[] }> }
			| undefined
		if (!def || def.previewRunsThrough === true) continue
		for (const slot of Object.values(def.slots ?? {}))
			if (slot?.kind === "connection")
				for (const t of slot.requires ?? []) if (isTransformId(t)) out.add(t)
	}
	const list = Object.freeze([...out].sort())
	if (doc.hash) required.set(cacheKey, list)
	return list
}

/** The transforms a model is set for on this pub (its default loadout names a connection). */
export async function servedTransforms(db: Db): Promise<Set<string>> {
	const now = Date.now()
	// Off under Vitest, as the resolver's cache is: a fixture written straight
	// to the tables is what counts.
	const cacheOn = !(typeof process !== "undefined" && process.env?.VITEST)
	if (cacheOn && served && served.db === (db as object) && now - served.at < TTL_MS) return served.set
	const { capabilityDefaults } = await import("$lib/server/connections/capabilityDefaults")
	const set = new Set<string>()
	try {
		for (const [t, d] of Object.entries(await capabilityDefaults(db))) if (d?.connectionId != null) set.add(t)
	} catch (err) {
		console.warn("[registrations] the pub's served transforms could not be read:", err)
	}
	served = { at: now, db: db as object, set }
	return set
}

/** What a model must do for a transform, as a person says it: "draw pictures", "write replies", "hear". */
export function transformVerb(transform: string): string {
	if (!isTransformId(transform)) return transform
	const { in: input, out: output } = parseTransform(transform)
	const writes: Record<string, string> = { text: "write replies", image: "draw pictures", audio: "speak" }
	const reads: Record<string, string> = { audio: "hear", image: "see pictures" }
	const words = [
		...output.map((k) => writes[k] ?? `make ${k}`),
		...input.filter((k) => k !== "text").map((k) => reads[k] ?? `read ${k}`)
	]
	const uniq = [...new Set(words)]
	return uniq.length <= 1 ? (uniq[0] ?? transform) : `${uniq.slice(0, -1).join(", ")} and ${uniq[uniq.length - 1]}`
}

/** The model a transform needs, as a start card names it: "a text model", "an image model". */
export function transformNoun(transform: string): string {
	if (!isTransformId(transform)) return transform
	const { in: input, out: output } = parseTransform(transform)
	if (input.includes("audio") && output.includes("text")) return "a hearing model"
	if (input.includes("image") && output.includes("text")) return "a vision model"
	if (output.includes("image")) return "an image model"
	if (output.includes("audio")) return "a speech model"
	return "a text model"
}

/** "Unavailable: needs a model that can draw pictures." */
export function unservedSentence(missing: readonly string[]): string {
	const verbs = [...new Set(missing.map(transformVerb))]
	const what = verbs.length <= 1 ? verbs[0] : `${verbs.slice(0, -1).join(", ")} and ${verbs[verbs.length - 1]}`
	return `Unavailable: needs a model that can ${what}.`
}

/**
 * 🚧 The pub's baseline (see the module note): a transform whose absence
 * alone never disables a registration — the run says what is missing instead.
 */
export const BASELINE_TRANSFORMS: ReadonlySet<string> = new Set(["text->text"])

export interface UnservedVerdict {
	pipeline: string
	/** The required transforms no model is set for. */
	missing: string[]
	sentence: string
}

/**
 * The verdict for each pipeline named that needs a model nothing serves —
 * absent for one that is served (or whose document is not published: the
 * resolver's stale path says that already).
 */
export async function unservedPipelines(db: Db, pipelines: readonly string[]): Promise<Map<string, UnservedVerdict>> {
	const out = new Map<string, UnservedVerdict>()
	const names = [...new Set(pipelines)]
	if (!names.length) return out
	const { publishedDocuments } = await import("$lib/server/pipelines/registrations/door")
	let docs: Map<string, SpecDocument | null>
	try {
		docs = await publishedDocuments(db, names)
	} catch (err) {
		// Never the reason a routine or an action is judged unavailable.
		console.warn("[registrations] could not read the documents to judge what they need:", err)
		return out
	}
	const have = await servedTransforms(db)
	for (const name of names) {
		const doc = docs.get(name)
		if (!doc) continue
		const missing = requiredTransformsOf(doc as never).filter((t) => !have.has(t))
		// The baseline alone disables nothing (see the module note).
		if (missing.some((t) => !BASELINE_TRANSFORMS.has(t)))
			out.set(name, { pipeline: name, missing, sentence: unservedSentence(missing) })
	}
	return out
}

/** Is this registration one an unserved verdict disables (a routine or an action, R56)? */
export const disabledWhenUnserved = (r: Pick<EffectiveRegistration, "trigger">): boolean =>
	r.trigger.family === "routine" || r.trigger.family === "action"

export interface PresetRecommendations {
	/** What its registrations in force need — the events and routines it runs (R56 "must"). */
	needs: string[]
	/** What would make it better — its actions and its Off routines ("would improve"). */
	betterWith: string[]
	/** The ones of either list no model is set for on this pub. */
	unserved: string[]
	/** "Needs: a text model · Better with: an image model" — the start card's line. */
	words: string
}

/** A preset's recommendations from its registrations in force (pure apart from the served set and the documents). */
export function recommendationsOf(
	regs: readonly EffectiveRegistration[],
	docs: ReadonlyMap<string, SpecDocument | null>,
	have: ReadonlySet<string>
): PresetRecommendations {
	const needs = new Set<string>()
	const better = new Set<string>()
	for (const r of regs) {
		const doc = docs.get(r.pipeline)
		if (!doc) continue
		const ts = requiredTransformsOf(doc as never)
		const must = r.trigger.family === "event" || (r.trigger.family === "routine" && (r.mode ?? "full") !== "off")
		for (const t of ts) (must ? needs : better).add(t)
	}
	for (const t of needs) better.delete(t)
	const sortT = (s: Set<string>) => [...s].sort()
	const nouns = (list: string[]) => [...new Set(list.map(transformNoun))].join(", ")
	const n = sortT(needs)
	const b = sortT(better)
	const words = [n.length ? `Needs: ${nouns(n)}` : "", b.length ? `Better with: ${nouns(b)}` : ""].filter(Boolean).join(" · ")
	return { needs: n, betterWith: b, unserved: [...n, ...b].filter((t) => !have.has(t)), words }
}

/** Each preset's recommendations (R56), for the presets list and the preset editor. */
export async function presetRecommendations(db: Db, presetIds: readonly number[]): Promise<Map<number, PresetRecommendations>> {
	const out = new Map<number, PresetRecommendations>()
	if (!presetIds.length) return out
	const { presetRegistrations } = await import("$lib/server/pipelines/registrations/resolve")
	const { publishedDocuments } = await import("$lib/server/pipelines/registrations/door")
	const have = await servedTransforms(db)
	const docs = new Map<string, SpecDocument | null>()
	for (const id of presetIds) {
		try {
			const resolved = await presetRegistrations(db, id)
			if (!resolved) continue
			await publishedDocuments(db, resolved.offered.map((r) => r.pipeline), docs)
			out.set(id, recommendationsOf(resolved.offered, docs, have))
		} catch (err) {
			console.warn(`[registrations] could not recommend for preset #${id}:`, err)
		}
	}
	return out
}

let reconcileTimer: ReturnType<typeof setTimeout> | null = null

/**
 * 🚧 A model, a connection or a loadout changed (R56): forget the served
 * transforms now, and — a second later, once, however many writes landed —
 * re-run the preset reconcile so the administrators' notices follow. Off
 * under Vitest (no timers behind a test's back).
 */
export function modelsChanged(): void {
	invalidateUnserved()
	if (typeof process !== "undefined" && process.env?.VITEST) return
	if (reconcileTimer) clearTimeout(reconcileTimer)
	reconcileTimer = setTimeout(() => {
		reconcileTimer = null
		void (async () => {
			try {
				const { db } = await import("$lib/server/db")
				const { reconcilePresetBindings } = await import("$lib/server/pipelines/boot/presetReconcile")
				await reconcilePresetBindings(db as never)
			} catch (err) {
				console.warn("[registrations] the notices after a model change were not refreshed:", err)
			}
		})()
	}, 1_000)
	;(reconcileTimer as { unref?: () => void }).unref?.()
}

/** A socket handler that, once it has run, says the pub's models changed (`modelsChanged`). */
export function afterModelChange<H extends { handler: (...args: any[]) => Promise<any> }>(h: H): H {
	return {
		...h,
		handler: async (...args: any[]) => {
			try {
				return await h.handler(...args)
			} finally {
				modelsChanged()
			}
		}
	}
}
