/**
 * Structural compatibility, asserted at boot (ruling 2026-09-10).
 *
 * The same shape of check `assertHookCompleteness` makes one file over, and for
 * the same reason: core declares its node definitions in `@serene-pub/contracts` and
 * implements them in `bindings.ts`, and a mismatch between the two halves is a
 * **packaging error** — something that should stop the build, not surface as a
 * run that quietly retrieves nothing.
 *
 * ## What it can and cannot catch, stated plainly
 *
 * `InputOf` already refuses, at compile time, a core handler reading a name its
 * contract does not declare. So the interesting failures here are the ones a
 * compiler cannot see:
 *
 *  1. **A binding for a type the build does not declare.** `bindings.ts`
 *     imports the contracts with `import type`, so a binding key is a *string
 *     literal* that no compiler checks against anything. Rename a type in the
 *     contracts and the binding silently stops matching: the executor reports
 *     "no binding registered", the node halts, and nothing points at the pair
 *     of files that disagree.
 *  2. **A shared handler whose group lost a member.** `SHARED_CORE_HANDLERS`
 *     names the type ids each multi-type handler serves, in the runtime half of
 *     what its `SharedInput<[…]>` says. A member that is no longer bound, or no
 *     longer declared, means one of those node definitions is now being served by a
 *     handler nobody re-read.
 *  3. **A handler that declares its reads** — `reads<C>()` / `declaresReads`
 *     in the SDK — bound to a type that does not supply them. Since R-12
 *     (2026-09-16) EVERY core handler carries one, typed against its own
 *     contract, so this point now holds core to its word at boot exactly as it
 *     holds a plugin; `requiresOf(...contracts)` stays for point 2, the
 *     *supplies* direction. The reverse question — a declared name NO handler
 *     reads — is `boot/declaredReads.ts`'s, in the suite rather than at boot.
 *
 * Point 3 is the one the plugin host and the coming orchestrator use, through
 * `structuralCompat` directly; this file is the core-side application of it.
 */

import { getDefinition, readsOf } from "@serene-pub/sdk"
import {
	requiresOf,
	structuralCompat
} from "$lib/server/pipelines/runtime/structuralCompat"
import {
	coreBindings,
	SHARED_CORE_HANDLERS
} from "$lib/server/pipelines/runtime/bindings"

/**
 * Check every core binding against the type it is bound to.
 *
 * Returns the findings rather than throwing, so a caller can decide — the boot
 * path refuses, and a test can assert the list is empty and print it when it is
 * not. `assertHookCompleteness` throws directly because it has two lists and
 * one sentence; this one has three distinct findings and a reader deserves all
 * of them at once rather than the first.
 */
export function checkCoreBindings(): string[] {
	const findings: string[] = []
	const bindings = coreBindings()
	const boundIds = Object.keys(bindings)

	// 1 — every binding key names a type this build declares.
	for (const id of boundIds)
		if (!getDefinition(id))
			findings.push(
				`core binds a handler to ${id}, which no type in this build ` +
					`declares. A binding key is a string literal the compiler ` +
					`never checks against the contracts — so a renamed or ` +
					`deleted type leaves the binding behind, and the node ` +
					`halts with "no binding registered" pointing at the wrong ` +
					`file.`
			)

	// 2 — every shared handler's group is whole.
	for (const { handler, typeIds } of SHARED_CORE_HANDLERS) {
		const unbound = typeIds.filter((id) => !boundIds.includes(id))
		if (unbound.length)
			findings.push(
				`${handler} is declared to serve ${typeIds.join(", ")}, but ` +
					`${unbound.join(", ")} ${unbound.length === 1 ? "is" : "are"} ` +
					`not bound. The list is the runtime half of the handler's ` +
					`SharedInput<[…]>; the two are kept adjacent so this cannot ` +
					`drift silently.`
			)
		const contracts = typeIds.map((id) => getDefinition(id)).filter(Boolean)
		if (contracts.length !== typeIds.length) continue
		// The intersection of what the group supplies — exactly what the
		// handler's type says it may read. Then each member is asked whether it
		// supplies it, which is a tautology when the group is whole and is not
		// one the moment a member is missing or has been re-declared narrower.
		const requires = requiresOf(...contracts)
		if (!requires.ports.length && !requires.params.length)
			findings.push(
				`${handler} serves ${typeIds.join(", ")}, and those types have ` +
					`nothing in common: the intersection of what they supply is ` +
					`empty, so a handler written against all of them may read ` +
					`nothing at all. They have diverged, or one of them is not ` +
					`the type this handler was written for.`
			)
		for (const c of contracts) {
			const verdict = structuralCompat(requires, c, handler)
			if (!verdict.ok) findings.push(verdict.message)
		}
	}

	// 3 — any handler that declares its reads is held to them.
	for (const [id, hook] of Object.entries(bindings)) {
		const requires = readsOf(hook)
		if (!requires) continue
		const contract = getDefinition(id)
		if (!contract) continue
		const verdict = structuralCompat(requires, contract, id)
		if (!verdict.ok) findings.push(verdict.message)
	}

	return findings
}

/**
 * The boot gate. Refuses with every finding, each naming the handler and the
 * missing name — because "bindings do not fit this build" is the kind of
 * refusal people restart through.
 */
export function assertCoreBindingsCompatible(): void {
	const findings = checkCoreBindings()
	if (!findings.length) return
	throw new Error(
		`core's node bindings do not fit the types this build declares:\n · ` +
			findings.join("\n · ")
	)
}
