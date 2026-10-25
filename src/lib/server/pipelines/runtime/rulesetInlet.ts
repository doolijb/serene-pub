/**
 * 🚧 **The session's rules, as an inlet carries them** — the sections half
 * of every inlet's `ruleset` port (PLAN-genres-seams S1/S3, 2026-10-23),
 * beside `sessionRulesetInput`'s id, rigour, settings and what it rolls:
 *
 *  · `attributes` — each attribute the ruleset keeps (borrowed ones too):
 *    its id, name, kind, tags, the slot its value is filed under, its bounds;
 *    what Story's Rest reads for what a rest brings back (the ones tagged
 *    `resource`), and what the reckoning's scripts count as the rules' own;
 *  · `entryTypes` — each entry type: its id, name and tags (`condition` —
 *    what *Track conditions* keeps), and `entryable: false` where nothing is
 *    gained or lost of it.
 *
 * Read from the declaration through the SDK (`rulesetSections`), at run time —
 * never `CORE_RULESETS` at build (S4). Names are the ruleset's own words: the
 * sections' (R5).
 */
import type { RulesetDecl } from "@serene-pub/sdk"

/** One attribute, as an inlet's `ruleset.attributes` lists it. */
export interface InletAttribute {
	id: string
	name?: string
	kind: string
	tags: string[]
	/** The attribute slot its value is filed under (`state.slots[].id`). */
	slot?: string
	borrowed?: true
	bounds?: { min?: number; max?: number }
}

/** One entry type, as an inlet's `ruleset.entryTypes` lists it. */
export interface InletEntryType {
	id: string
	name?: string
	tags: string[]
	entryable?: false
}

/** 🚧 The sections half of an inlet's `ruleset` (S1/S3). */
export interface RulesetInletSections {
	attributes: InletAttribute[]
	entryTypes: InletEntryType[]
}

/** 🚧 What an inlet carries of a ruleset's sections — empty for one nothing can read. */
export async function rulesetInletSections(decl: RulesetDecl): Promise<RulesetInletSections> {
	const { i18nText, rulesetAttributeSlots, rulesetSections } = await import("@serene-pub/sdk")
	let s: ReturnType<typeof rulesetSections>
	try {
		s = rulesetSections(decl)
	} catch {
		return { attributes: [], entryTypes: [] }
	}
	let slots = new Map<string, string>()
	try {
		slots = new Map(rulesetAttributeSlots({ id: decl.id, attributes: s.attributes ?? [] }))
	} catch {
		/* a ruleset id that is no ruleset id files nothing */
	}
	const name = (n: unknown): string | undefined => (n === undefined ? undefined : (i18nText(n as never) ?? undefined))
	return {
		attributes: (s.attributes ?? []).map((a) => {
			const label = name(a.name)
			const slot = slots.get(a.id)
			return {
				id: a.id,
				...(label ? { name: label } : {}),
				kind: a.kind ?? "number",
				tags: [...((a as { tags?: readonly string[] }).tags ?? [])],
				...(slot ? { slot } : {}),
				...(a.borrowed === true ? { borrowed: true as const } : {}),
				...(a.bounds ? { bounds: { ...(a.bounds.min !== undefined ? { min: a.bounds.min } : {}), ...(a.bounds.max !== undefined ? { max: a.bounds.max } : {}) } } : {})
			}
		}),
		entryTypes: (s.entryTypes ?? []).map((e) => {
			const label = name(e.name)
			return {
				id: e.id,
				...(label ? { name: label } : {}),
				tags: [...(e.tags ?? [])],
				...(e.entryable === false ? { entryable: false as const } : {})
			}
		})
	}
}
