/**
 * 🚧 What a session's ruleset decides, as every inlet's `ruleset` port
 * carries it beside its id, rigour and settings (`sessionRulesetInput`): the
 * checks a **roll form** may put, the difficulty bands, the usual one, the
 * ways it decides by and its outcome words (lane M2, 2026-10-22: method
 * bands, any method that holds them; S4, 2026-10-23: read off the sections).
 */
import type { RulesetDecl } from "@serene-pub/sdk"

/**
 * 🚧 What the session's ruleset decides, read off its sections at run time
 * (Lair rewrite L4, 2026-10-21; method-aware since 2026-10-22; S4,
 * 2026-10-23: `lairRulesRow` — `rulesetSections(r).functions` and its
 * outcomes, never a table baked from core's rulesets) — so a script that
 * asks a check (the Lair's roll forms and *Decide checks at once*) plays a
 * pub's or a plugin's ruleset as it plays core's: the checks a **roll form**
 * may offer (decided by the way whose difficulties it offers), the bands and
 * the usual one, the kinds of its ways, its outcome words — every label the
 * ruleset's — and whether chance decides any. Derived, never retyped (A18).
 */
export async function rulesetRolls(decl: RulesetDecl): Promise<RulesetRolls> {
	const { checkMethodKind, getFunction, rulesetSections } = await import("@serene-pub/sdk")
	const { lairRulesRow } = await import("@serene-pub/core-catalog")
	const row = lairRulesRow(decl)
	// A package way's kind is its function id: chance is its module's to say.
	const ways = new Set(row.methods)
	const chance =
		row.methods.some((k) => !!checkMethodKind(k)?.chance) ||
		(rulesetSections(decl).functions ?? []).some(
			(f) => ways.has(String(f.ref)) && (f.module ?? getFunction(f.ref as never))?.chance === true
		)
	return { ...row, chance }
}

/** 🚧 What a ruleset decides, as the inlet's `ruleset` carries it beside its id and rigour. */
export interface RulesetRolls {
	/**
	 * ⏳ Whether a check may be put to a **roll form**: a way the ruleset
	 * decides by holds difficulty bands, and a check is decided by it. Named
	 * for dice; since 2026-10-22 any way with bands (a comparison against a
	 * target asks how hard as a die does) — the Lair's scripts read it.
	 * Retires at RC1 (`LairRulesRow.dice`).
	 */
	dice: boolean
	/** The checks a roll form may offer, in the ruleset's order and words. */
	checks: Array<{ key: string; label: string }>
	bands: Array<{ id: string; label: string; target?: number }>
	band: string | null
	/** 🚧 Its ways' kinds, distinct (`die-target`, `bid`, a package way's function id, …) — empty when it decides nothing by its rules. */
	methods: string[]
	/** 🚧 Its outcome words (S4), each with its step on the five when it says one. */
	outcomes: Array<{ id: string; label: string; five?: string }>
	/** 🚧 Whether chance decides any of its checks (dice or cards, or a package way that says so). */
	chance: boolean
}
