/**
 * Which laid-out keys a context template's scope holds, and what each is
 * written out by (variable layouts, W5) — one answer per target, shared by
 * every editor that asks.
 *
 * The server echoes the target it answers (`nodeType`, or `specSlug` +
 * `stepKey`, the step's opaque handle) on the answer and on the `:error`, so each request listens for
 * both and takes only the one whose echo maps to its own key, then releases
 * both. Requests for different targets run at once; a target already in
 * flight is not asked twice. An answer that echoes no target is nobody's.
 */
import { SvelteMap } from "svelte/reactivity"
import {
	declareInterest,
	requestWithInterest
} from "$lib/client/sockets/interest.svelte"

export type TemplateLayoutsTarget =
	Sockets.Pipelines.VariableLayouts.ForTemplate.Params

type Entry = {
	keys?: Sockets.Pipelines.VariableLayouts.TemplateKey[]
	error?: string
	/** A step target's heading as the panel shows it. */
	stepHeading?: string
}

type Echo = Sockets.Pipelines.VariableLayouts.ForTemplate.Echo

const typeKey = (nodeType: string) => `type\u0000${nodeType}`
const stepTargetKey = (specSlug: string, stepKey: string) =>
	`step\u0000${specSlug}\u0000${stepKey}`

const keyOf = (t: TemplateLayoutsTarget) =>
	"nodeType" in t ? typeKey(t.nodeType) : stepTargetKey(t.specSlug, t.stepKey)

/** The key an answer's (or refusal's) echoed target maps to; null when it echoes none. */
const echoKeyOf = (e: Echo | undefined): string | null =>
	e?.nodeType
		? typeKey(e.nodeType)
		: e?.specSlug && e.stepKey
			? stepTargetKey(e.specSlug, e.stepKey)
			: null

const answers = new SvelteMap<string, Entry>()
/** key → release of that request's two listeners. */
const inFlight = new Map<string, () => void>()

/** Ask for a target's laid-out keys; a target already in flight is not asked twice. */
export function requestTemplateVariableLayouts(
	target: TemplateLayoutsTarget
): void {
	const key = keyOf(target)
	if (inFlight.has(key)) return
	let releaseError = () => {}
	let releaseAnswer = () => {}
	const settle = (entry: Entry) => {
		releaseAnswer()
		releaseError()
		inFlight.delete(key)
		answers.set(key, entry)
	}
	inFlight.set(key, () => {
		releaseAnswer()
		releaseError()
	})
	releaseError = declareInterest<"pipelines:templateVariableLayouts:error">(
		"pipelines:templateVariableLayouts:error",
		(res) => {
			if (echoKeyOf(res) !== key) return
			settle({ error: res?.error ?? "That could not be read." })
		}
	)
	releaseAnswer = requestWithInterest(
		"pipelines:templateVariableLayouts",
		target,
		(res) => {
			if (echoKeyOf(res) !== key) return
			settle(
				res.error
					? { error: res.error }
					: { keys: res.keys ?? [], stepHeading: res.stepHeading }
			)
		}
	)
}

/** The last answer for a target, or undefined before one has arrived. */
export function templateVariableLayoutsOf(
	target: TemplateLayoutsTarget
): Entry | undefined {
	return answers.get(keyOf(target))
}

export function _resetTemplateVariableLayoutsForTests() {
	for (const release of inFlight.values()) release()
	inFlight.clear()
	answers.clear()
}
