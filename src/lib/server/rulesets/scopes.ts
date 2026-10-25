/**
 * 🚧 **Scopes and visibility** (PLAN-rulesets-functions D4, 2026-10-23).
 *
 * A **scope function** answers who is in reach of a subject — never changes
 * anything. Core's four the host answers natively (`CORE_SCOPE_IDS`):
 *
 *  · `same-place` — the owners where the subject is (its `location` value);
 *  · `within-tie` — the owners a tie joins the subject to;
 *  · `aimed-at` — whom the moment is aimed at;
 *  · `everyone` — every owner the moment reads.
 *
 * A scope a ruleset carries or a package registers answers through its
 * body's `members` handler (`functionRun.ts`); a header-only one reaches
 * nobody (the model reads its prose instead).
 *
 * **Visibility** — who sees a value or an entry — is where it sits: a word
 * (`holder` · `gm` · `everyone`) or a scope, declared on the attribute,
 * entry type or zone type. Its holder may still **expose** one (the
 * instance's flag), and who may **change** it is a separate declaration
 * (`changedBy`, enforced at the write gate — `changedByAllows`).
 */

import { CORE_SCOPE_IDS, isVisibilityWord, type AttributeChanger, type Visibility } from "@serene-pub/sdk"
import { attributeSlotsOf, ownerPlace as whereIs, runScopeFunction, sectionsOf, type FunctionLedger, type FunctionRunDeps } from "./functionRun"
import type { EngineInput } from "./types"

/**
 * 🚧 Core's scopes, natively: the owner keys in reach of `subject` (an owner
 * key, or null for the whole moment). Undefined for a scope core does not
 * answer.
 */
export function coreScopeMembers(input: Pick<EngineInput, "owners" | "ties">, scope: string, subject: string | null, extra: { aimedAt?: string | null } = {}): string[] | undefined {
	const keys = input.owners.map((o) => o.key)
	switch (scope) {
		case CORE_SCOPE_IDS.everyone:
			return [...keys].sort()
		case CORE_SCOPE_IDS.aimedAt:
			return extra.aimedAt && keys.includes(extra.aimedAt) ? [extra.aimedAt] : []
		case CORE_SCOPE_IDS.withinTie: {
			if (!subject) return []
			const tied = new Set<string>()
			for (const t of input.ties) {
				if (t.from === subject) tied.add(t.to)
				if (t.to === subject) tied.add(t.from)
			}
			return keys.filter((k) => tied.has(k)).sort()
		}
		case CORE_SCOPE_IDS.samePlace: {
			const me = subject ? input.owners.find((o) => o.key === subject) : undefined
			const here = me ? whereIs(me) : null
			if (!here) return subject && keys.includes(subject) ? [subject] : []
			return input.owners.filter((o) => o.key === subject || whereIs(o) === here).map((o) => o.key).sort()
		}
	}
	return undefined
}

/**
 * 🚧 A scope's members — core's natively, a carried or registered scope by
 * its `members` handler, else nobody.
 */
export function scopeMembers(input: EngineInput, deps: Omit<FunctionRunDeps, "members">, ledger: FunctionLedger) {
	return async (scope: string, subject: string | null, extra: { aimedAt?: string | null } = {}): Promise<string[]> => {
		const core = coreScopeMembers(input, scope, subject, extra)
		if (core) return core
		return (await runScopeFunction(input, scope, subject, extra, deps as FunctionRunDeps, ledger)) ?? []
	}
}

/** Who looks: the game master (`gm`), one owner (its key), or nobody in particular — the shared view (null). */
export type Viewer = "gm" | string | null

/**
 * 🚧 Whether a viewer sees a thing of this visibility, held by `holder`:
 * an exposed thing is seen by all; `everyone` (or nothing said) by all;
 * `gm` by the game master; `holder` by its holder and the game master; a
 * scope by its members (of the holder) and the game master. The shared
 * view sees only what everyone sees.
 */
export async function visibleTo(
	visibility: Visibility | undefined,
	viewer: Viewer,
	holder: string | null,
	opts: { exposed?: boolean; members?: (scope: string, subject: string | null) => Promise<string[]> } = {}
): Promise<boolean> {
	if (opts.exposed || visibility === undefined || visibility === "everyone") return true
	if (viewer === "gm") return true
	if (viewer === null) return visibility === CORE_SCOPE_IDS.everyone
	if (visibility === "gm") return false
	if (visibility === "holder") return viewer === holder
	if (isVisibilityWord(visibility)) return false
	if (!opts.members) return false
	return (await opts.members(visibility, holder)).includes(viewer)
}

/**
 * 🚧 Who may change a value (D4): `changedBy` on the attribute its slot
 * files under — `rules` (the ruleset's functions and the pipelines that
 * apply them), `gm`, `holder`, `everyone`. Nothing said: anyone. A slot
 * no attribute of the ruleset files under is not the ruleset's to say.
 */
export function changedByAllows(ruleset: { id: string } & object, slotId: string, writer: AttributeChanger): boolean {
	const { attributeOf } = attributeSlotsOf(ruleset)
	const id = attributeOf.get(slotId)
	if (!id) return true
	const decl = (sectionsOf(ruleset).attributes ?? []).find((a) => a.id === id)
	const who = decl?.changedBy
	if (!who?.length || who.includes("everyone")) return true
	if (who.includes(writer)) return true
	// The game master may change what its holder may.
	return writer === "gm" && who.includes("holder")
}

/** The visibility a ruleset's attribute filed under `slotId` declares — undefined when it says none. */
export function attributeVisibility(ruleset: { id: string } & object, slotId: string): Visibility | undefined {
	const id = attributeSlotsOf(ruleset).attributeOf.get(slotId)
	return id ? (sectionsOf(ruleset).attributes ?? []).find((a) => a.id === id)?.visibility : undefined
}
