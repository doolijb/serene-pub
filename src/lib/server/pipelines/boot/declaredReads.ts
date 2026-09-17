/**
 * Handlers declare what they read — and the declaration is held to the
 * definition in BOTH directions (R-12, ruled 2026-09-15, built 2026-09-16).
 *
 * ## The two directions, and why the second needed a mechanism
 *
 * `InputOf<C>` makes a read of an **undeclared** name a compile error, and
 * `structuralCompat` (`bindingCompat.ts` point 3) makes the same check at boot
 * from a handler's `requires`. That is the *supplies* direction: everything a
 * handler reads, the definition declares.
 *
 * The reverse — a **declared** in-port, slot or parameter that **no** handler
 * reads — had no mechanism at all. It was found by grep, after shipping, every
 * time: `topK`, `minScore`, `session-history.limit`, `stopSequences`,
 * `embed-text.enabled`, `guaranteedMessages`… each a control the panel rendered
 * and the scope chain stored and no run consulted. plans/29 §5f lists the nine
 * that were still open when this was written.
 *
 * This file closes it. Every core handler now carries a `reads<C>()`
 * declaration (SDK `nodeInput.ts`) whose arrays are typed against the
 * definition — so the declaration cannot name what the definition lacks — and
 * this walk asks the other question of it: **does the definition declare
 * anything the handler did not say it reads?**
 *
 * ## What is checked
 *
 *  · every **in-port** the definition declares is in the handler's `ports`;
 *  · every **slot** the definition declares — except the two kinds the HOST
 *    supplies (`scripts`, `wire`, which never reach `input`) and `params`,
 *    which is checked field by field — is in the handler's `ports`;
 *  · every **field** of the `params` slot's schema is in the handler's
 *    `params`;
 *  · and, the other way, everything the handler declares is supplied
 *    (`structuralCompat`), so the report is one report.
 *
 * ## The allow-list
 *
 * A finding may stand only with a **reason** — a sentence naming what closes
 * it. The list is asserted in both directions by `declaredReads.test.ts` (an
 * entry that stops applying fails as loudly as a new finding does), capped, and
 * printed on every run so it stays visible. It is also the ONE ledger
 * `paramsSlotWiring.test.ts` derives its own from: a slot allowed to go unread
 * here is, on every shipped node of that definition, a slot the spec is
 * correctly not naming there.
 *
 * ## What it cannot see
 *
 * A definition with no handler (the 13 unbound ones, plans/29 R-2 → U6) has no
 * declaration to read and is not walked. And an outlet's reads are the host's
 * commit case's, written at the binding — the walk trusts the binding's word
 * for what `host.ts` takes off the payload, exactly as `bindingCompat.ts`
 * does.
 */

import { getDefinition, readsOf, type SlotDecl } from "@serene-pub/sdk"
import type { Bindings } from "@serene-pub/sdk"
import { coreBindings } from "$lib/server/pipelines/runtime/bindings"
import { structuralCompat } from "$lib/server/pipelines/runtime/structuralCompat"

/**
 * Slot kinds the host supplies out of the scope chain rather than through
 * `resolveInput`, so a handler never sees them on `input` and cannot "read"
 * them. The same pair `paramsSlotWiring.test.ts` exempts, for the same reason
 * — see `HOST_SUPPLIED` there.
 */
export const HOST_SUPPLIED_SLOT_KINDS: ReadonlySet<string> = new Set([
	"scripts",
	"wire"
])

// The allow-list itself lives in a leaf module so `paramsSlotWiring.test.ts`
// can read it without importing the bindings; re-exported here so every
// existing importer keeps its path.
export {
	UNREAD_ALLOW_LIST,
	allowKey,
	type AllowedUnread,
	type UnreadKind
} from "$lib/server/pipelines/boot/unreadAllowList"
import {
	UNREAD_ALLOW_LIST,
	allowKey,
	type AllowedUnread,
	type UnreadKind
} from "$lib/server/pipelines/boot/unreadAllowList"

export interface UnreadFinding {
	/** `allowKey(definition, name)`. */
	key: string
	definition: string
	name: string
	kind: UnreadKind
	/** The whole finding as one sentence. */
	sentence: string
}

export interface DeclaredReadsReport {
	/** Declared and read by no handler — BEFORE the allow-list is applied. */
	unread: UnreadFinding[]
	/** Read and supplied by no definition — `structuralCompat`'s sentences. */
	undeclared: string[]
	/** Bound handlers carrying no `reads` declaration at all. */
	undeclaredHandlers: string[]
	/** What was walked, so a test can prove the walk asked something. */
	walked: Array<{
		id: string
		ports: string[]
		slots: string[]
		params: string[]
	}>
	/** Bound ids the registry could not resolve — `bindingCompat.ts` point 1. */
	unknownPins: string[]
}

/**
 * Walk every bound handler against the definition it is bound to.
 *
 * Returns the whole report rather than throwing, so a test can assert each
 * list and print the allow-list beside it; the allow-list is NOT applied here
 * — `unread` is the raw measurement, and `openFindings` below is the view with
 * the list subtracted. Keeping the two apart is what lets the stale-entry
 * check see an entry that matches nothing.
 *
 * @param bindings The table to walk. Defaults to core's; a test hands in a
 *   deliberately broken copy to prove the walk fails when it should.
 */
export function checkDeclaredReads(
	bindings: Bindings = coreBindings()
): DeclaredReadsReport {
	const report: DeclaredReadsReport = {
		unread: [],
		undeclared: [],
		undeclaredHandlers: [],
		walked: [],
		unknownPins: []
	}

	for (const [id, hook] of Object.entries(bindings)) {
		const definition = getDefinition(id)
		if (!definition) {
			report.unknownPins.push(id)
			continue
		}
		const requires = readsOf(hook)
		if (!requires) {
			report.undeclaredHandlers.push(
				`the handler bound to ${id} declares nothing about what it reads. ` +
					`Wrap the registration in reads<typeof C.…>(handler, { ports, ` +
					`params }) — the arrays are typed against the definition, so a ` +
					`misspelt name fails to compile.`
			)
			continue
		}

		const inPorts = Object.keys(definition.ports?.in ?? {})
		const slots = Object.entries(
			(definition.slots ?? {}) as Record<string, SlotDecl>
		)
		const paramSlots = slots.filter(([, d]) => d.kind === "parameters")
		const plainSlots = slots
			.filter(
				([, d]) =>
					d.kind !== "parameters" &&
					!HOST_SUPPLIED_SLOT_KINDS.has(d.kind)
			)
			.map(([name]) => name)
		const params = paramSlots.flatMap(([, d]) =>
			Object.keys((d.schema ?? {}) as Record<string, unknown>)
		)
		report.walked.push({ id, ports: inPorts, slots: plainSlots, params })

		const readPorts = new Set(requires.ports)
		const readParams = new Set(requires.params)

		for (const port of inPorts)
			if (!readPorts.has(port))
				report.unread.push(
					finding(
						id,
						port,
						"port",
						`${id} declares an in-port '${port}' that its handler does not ` +
							`read. A spec can wire an edge into it and the value goes ` +
							`nowhere; a plugin reading the declaration believes the node ` +
							`consumes it. Read it, cull it, or allow-list it with a reason.`
					)
				)
		for (const slot of plainSlots)
			if (!readPorts.has(slot))
				report.unread.push(
					finding(
						id,
						slot,
						"slot",
						`${id} declares a '${slot}' slot that its handler does not ` +
							`read. The panel renders a control for every declared slot ` +
							`and the scope chain stores what a person sets — so this is ` +
							`a control that does nothing. Read it, cull it, or allow-list ` +
							`it with a reason.`
					)
				)
		for (const param of params)
			if (!readParams.has(param))
				report.unread.push(
					finding(
						id,
						`params.${param}`,
						"param",
						`${id} declares a parameter '${param}' that its handler does ` +
							`not read off input.params. The control renders, validates, ` +
							`stores and reaches nothing — the exact shape of topK, ` +
							`minScore and session-history.limit. Read it, cull it, or ` +
							`allow-list it with a reason.`
					)
				)

		// The other direction, so the two arrive as one report.
		const verdict = structuralCompat(requires, definition, id)
		if (!verdict.ok) report.undeclared.push(verdict.message)
	}

	return report
}

const finding = (
	definition: string,
	name: string,
	kind: UnreadKind,
	sentence: string
): UnreadFinding => ({
	key: allowKey(definition, name),
	definition,
	name,
	kind,
	sentence
})

/** The unread findings the allow-list does not absorb. */
export function openFindings(
	report: DeclaredReadsReport,
	allow: readonly AllowedUnread[] = UNREAD_ALLOW_LIST
): UnreadFinding[] {
	const allowed = new Set(allow.map((a) => allowKey(a.definition, a.name)))
	return report.unread.filter((f) => !allowed.has(f.key))
}

/** Allow-list entries that match no finding — debt that has been paid. */
export function staleAllowances(
	report: DeclaredReadsReport,
	allow: readonly AllowedUnread[] = UNREAD_ALLOW_LIST
): AllowedUnread[] {
	const found = new Set(report.unread.map((f) => f.key))
	return allow.filter((a) => !found.has(allowKey(a.definition, a.name)))
}

/** The allow-list as the lines the test prints. */
export function renderAllowList(
	allow: readonly AllowedUnread[] = UNREAD_ALLOW_LIST
): string {
	return allow
		.map((a) => ` · ${a.definition} ${a.name}\n     ${a.reason}`)
		.join("\n")
}
