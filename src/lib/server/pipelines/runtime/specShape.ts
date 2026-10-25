/**
 * What a spec's shape says about how it has to be run.
 *
 * Every reply runs end to end now — one road (09-B B4, R-17): the spec creates
 * its own row at a placeholder outlet, its oracles run, and its last outlet
 * fills the row. What this module reads off the document is which oracle's
 * stream is the reply's prose — declared by the spec, because a run has ONE
 * live row and several oracles may run before the write — and what each
 * step says while it runs.
 *
 * ⚠ **An oracle inside a gather, an each or a loop is not a preview stop**
 * (`previewProviders`, what the preview halt and the step count read), and
 * that is deliberate: `core:spec/story-respond` puts its two `embed` oracles
 * inside gather clauses precisely so the preview does not halt on them (see
 * the note on its `names` block). An oracle in a junction's branch IS one: a
 * junction runs the branch its route fired, and Story's reply writes inside
 * its `reply` junction (`reply.prose.generate`, PLAN-rulesets-functions D7).
 * It says nothing about streaming, which is declared.
 *
 * ⚠ **Nor is an oracle the preview runs through** (`previewRunsThrough`, O9):
 * the transcribe step (`heard`) prepares the prompt, it does not send it, so
 * the executor's preview halt skips it — and so do the step count, the
 * budget's fallback pair and the seams' text provider, or each would name a
 * step that is not the reply's call.
 */

import { CORE_LOADOUT } from "@serene-pub/core-catalog"
import { getDefinition, localeMapOf, previewStops, type SpecDocument, type StatusText } from "@serene-pub/sdk"

type Node = SpecDocument["nodes"][number]

/** The parts of a document the provider rules read. */
type Shape = Pick<SpecDocument, "nodes"> & { clauses?: SpecDocument["clauses"] }

/**
 * The generating steps the executor's preview halt can stop before, in
 * document order — the SDK's own rule (`previewStops`: the spine and a
 * junction's branches, never a gather, an each or a loop), less the oracles
 * it runs through (`previewRunsThrough`), so the two never disagree about
 * which oracle is the first call.
 */
export function previewProviders(doc: Shape): Node[] {
	return previewStops(doc.nodes, doc.clauses ?? []).filter(
		(n) => !getDefinition(`${n.definitionId}@${n.definitionVersion}`)?.previewRunsThrough
	)
}

/**
 * How many of those steps one run calls at most — the progress card's
 * declared step count. A junction runs one branch, so it adds its busiest
 * branch, never every branch: Story's reply is two steps (the reply and its
 * sprite pick) whichever branch writes it.
 */
export function providerSteps(doc: Shape): number {
	const counted = new Set(previewProviders(doc).map((n) => n.key))
	const clauses = doc.clauses ?? []
	const at = (clauseId?: string, chain?: string): number =>
		doc.nodes.filter((n) => n.clauseId === clauseId && n.clauseChain === chain && counted.has(n.key)).length +
		clauses
			.filter((c) => c.kind === "junction" && c.clauseId === clauseId && c.clauseChain === chain)
			.reduce((sum, j) => sum + Math.max(0, ...j.chains.map((ch) => at(j.id, ch))), 0)
	return at(undefined, undefined)
}

/**
 * The node the context-budget step's `connection` names
 * (`slot.connectionOf(…)`) — the call the budget sizes its window for:
 * `reply.prose.generate` for Story's reply, `generate` for Guide's, `write`
 * for Story's Look. Undefined when the spec budgets nothing or names no node.
 */
export function budgetNodeOf(doc: Pick<SpecDocument, "nodes">): Node | undefined {
	const budget = doc.nodes.find((n) => n.definitionId === "core:task/context-budget")
	const ref = budget?.config?.["connection"] as { __ref?: unknown; ofNode?: unknown } | undefined
	return ref && ref.__ref === "slot" && typeof ref.ofNode === "string"
		? doc.nodes.find((n) => n.key === ref.ofNode)
		: undefined
}

/**
 * The provider the run's budget is sized for — `budgetNodeOf`, else the
 * first preview provider. The run's text provider: the tokenizer and a
 * guarded seam's connection read it.
 */
export function budgetedProviderOf(doc: Shape): Node | undefined {
	return budgetNodeOf(doc) ?? previewProviders(doc)[0]
}

/**
 * The **reply's model call**: the step the budget is sized for, when the
 * spec runs it on the Reply loadout (`replyLoadoutSteps`) — Story's
 * `reply.prose.generate`, the narrators', Guide's and every answer form's
 * `generate`. A session's sampling pick sits on its `sampling` slot, and the
 * instance default is projected onto it (`oracleNodeKeyOf`). Undefined for a
 * pipeline whose budgeted call is not a reply (Look's `write`) or that
 * budgets nothing.
 */
export function replyCallOf(doc: Pick<SpecDocument, "nodes" | "presets">): Node | undefined {
	const call = budgetNodeOf(doc)
	return call && replyLoadoutSteps(doc).includes(call.key) ? call : undefined
}

/**
 * The steps a spec runs on the **Reply** loadout — its default preset's
 * `loadout` values that name it (`CORE_LOADOUT.reply`, I12): the reply's own
 * model calls, every branch of them (Story's `reply.prose.generate` and
 * `reply.changes.generate`).
 */
export function replyLoadoutSteps(doc: Pick<SpecDocument, "presets">): string[] {
	const keys = new Set<string>()
	for (const preset of doc.presets ?? [])
		if (preset.default)
			for (const v of preset.values ?? [])
				if (v.slot === "loadout" && (v.value as { id?: unknown } | null)?.id === CORE_LOADOUT.reply) keys.add(v.nodeKey)
	return [...keys]
}

/**
 * The steps whose tokens are the reply's prose — the ones the spec DECLARES
 * (`expose: { stream: true }`; lair pass B3, owner D6, 2026-09-27).
 *
 * A run has ONE live row, so every oracle in a multi-step spec would stream
 * into the same place, and most must not: a planner and a keeper answer in
 * JSON, and voices generating in parallel would interleave. At most one may
 * stream on any execution path, and core routes it (R-21 (2)) — the oracle
 * stays blind to messages. A set, not one key (W2, 2026-09-27): steps in
 * mutually exclusive branches of one junction may each be declared — a
 * reply that branches on its channel — and whichever branch runs streams;
 * `validate()` proves no two in the set can run in one execution.
 *
 * ⚠ **Declared, never inferred.** The rule this replaced walked back from the
 * write to the nearest SPINE oracle, and skipped anything inside a clause —
 * so the Lair, whose narrator sits in the `turn` junction, streamed its
 * planner's JSON into the reply and never streamed the narrator at all (F3).
 * `validate()` refuses the declarations that can never be right: a JSON
 * step, a second one on the same path, one inside an each or a loop.
 *
 * Empty when nothing is declared, and that is a legitimate answer: the
 * run then shows its step statuses and the reply lands when it is written.
 */
export function streamingSteps(doc: SpecDocument): ReadonlySet<string> {
	return new Set(
		doc.nodes
			.filter((n) => n.kind === "oracle" && n.expose?.stream === true)
			.map((n) => n.key)
	)
}

/**
 * 🚧 The streaming steps whose answer is a JSON reply (PLAN-rulesets-functions
 * D7): a `generate-json` declared to stream, whose words are its answer's
 * `message` — only those reach the row (`MessageStreamer`), never the
 * document. Empty today: `validate()` refuses a streaming JSON step (★ the
 * stream law, owner ruling open); the host is ready for the day it allows one.
 */
export function messageStreamSteps(doc: SpecDocument): ReadonlySet<string> {
	return new Set(
		doc.nodes
			.filter((n) => n.kind === "oracle" && n.expose?.stream === true && /^core:oracle\/generate-json(@|$)/.test(String(n.definitionId)))
			.map((n) => n.key)
	)
}

/**
 * Each node's declared **step status** (`expose.status`; lair pass B18,
 * owner D5) — *Planning the turn* — as the status the relay shows while that
 * node runs. Only declared nodes are here; a node without one keeps saying
 * whatever its own handler says.
 */
export function stepStatuses(doc: SpecDocument): ReadonlyMap<string, StatusText> {
	const out = new Map<string, StatusText>()
	for (const n of doc.nodes)
		// As a locale map — the spelling every handler's status arrives in —
		// so a declaration equal to what the node would have said anyway is
		// the SAME status, and the relay does not show it twice.
		if (n.expose?.status !== undefined)
			out.set(n.key, { i18n: localeMapOf(n.expose.status) })
	return out
}
