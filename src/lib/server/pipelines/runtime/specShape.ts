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
 * ⚠ **An oracle inside a clause is not on the spine** (`spineProviders`, what
 * the preview halt and the step count read), and that is deliberate:
 * `core:spec/respond` puts its two `embed` oracles inside gather clauses
 * precisely so the preview does not halt on them (see the note on its
 * `names` block). It says nothing about streaming, which is declared.
 */

import { localeMapOf, type SpecDocument, type StatusText } from "@serene-pub/sdk"

type Node = SpecDocument["nodes"][number]

/** The generating steps the executor's preview halt can see, in document order. */
export function spineProviders(doc: SpecDocument): Node[] {
	return doc.nodes
		.filter((n) => !n.clauseId && n.kind === "oracle")
		.sort((a, b) => a.position - b.position)
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
 * mutually exclusive branches of one junction may each be declared — the
 * Writing Room's manuscript and talk — and whichever branch runs streams;
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
