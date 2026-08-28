/**
 * Core's hook *implementations* (24 §11) — the privileged half.
 *
 * The catalog (@serene-pub/core-catalog) declares core's hooks: identity,
 * event, contract, ordering — the referenceable, documentable half. The
 * function bodies live here, because they touch what only core may touch:
 * drizzle, transactions, privileged services. Boot joins the two by id and
 * `assertHookCompleteness` refuses a mismatch in either direction — a
 * declared hook with no implementation is a contract that lies, and an
 * implementation with no declaration is power nothing can reference.
 *
 * Empty today: core has no in-process hook implementations yet (core's
 * script *sites* are declared on node types in @serene-pub/contracts and
 * filled by user/plugin scripts through the unified dispatch). The first
 * core hook lands in both maps in the same commit, or boot refuses.
 */
import { CORE_HOOK_DECLARATIONS } from "@serene-pub/core-catalog"

export type CoreHookImplementation = (
	surface: unknown
) => unknown | Promise<unknown>

/** Fully-qualified hook id → the privileged implementation. */
export const CORE_HOOK_IMPLEMENTATIONS: Record<string, CoreHookImplementation> =
	{}

/**
 * The completeness check (24 §11), called at boot. Throws with both lists —
 * a boot refusal here is a packaging error, and the fix is always "land the
 * two halves in the same commit."
 */
export function assertHookCompleteness(): void {
	const declared = Object.keys(CORE_HOOK_DECLARATIONS)
	const implemented = Object.keys(CORE_HOOK_IMPLEMENTATIONS)
	const unimplemented = declared.filter((id) => !implemented.includes(id))
	const undeclared = implemented.filter((id) => !declared.includes(id))
	if (unimplemented.length || undeclared.length)
		throw new Error(
			`core hook declarations and implementations disagree (24 §11).` +
				(unimplemented.length
					? ` Declared with no implementation: ${unimplemented.join(", ")}.`
					: "") +
				(undeclared.length
					? ` Implemented with no declaration: ${undeclared.join(", ")}.`
					: "") +
				` The two halves land in the same commit — the catalog declares, core implements.`
		)
}
