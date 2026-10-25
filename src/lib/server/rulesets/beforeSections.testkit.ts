/**
 * 🚧 Test kit (2026-10-23): Vis Itineris **in the shape before the sections**,
 * built from the parts core-catalog declares it from — what a pub copy made
 * before the sections stored, and what the data upgrades that move such copies
 * are tested on. The registry declares it in the sections since 2026-10-23
 * (`VIS_ITINERIS_RULESET`); `catalogueParity` proves the two read equal.
 */
import { _rulesetDeclOf, rulesetDocumentOf, type RulesetDocument, type RulesetProps } from "@serene-pub/sdk"
import * as cat from "@serene-pub/core-catalog"

/** Vis Itineris's props as `registry/rulesets.ts` declared them before the sections. */
export function visItinerisBeforeSections(): RulesetProps {
	return {
		name: { en: "Vis Itineris" },
		description: cat.visItinerisRuleset.description,
		voice: cat.VIS_ITINERIS_VOICE,
		conventions: cat.VIS_ITINERIS_CONVENTIONS,
		settings: cat.VIS_ITINERIS_SETTINGS,
		presets: cat.VIS_ITINERIS_PRESETS,
		stats: [
			{ id: cat.levelSlot.id, config: { min: 1, max: 20 }, borrowed: true },
			{ id: cat.characterClassSlot.id, borrowed: true },
			{ id: cat.hpSlot.id, config: { min: 0, max: 999 }, default: 10, borrowed: true },
			...cat.VIS_ITINERIS_OWN_SLOTS.map((s) => ({ id: s.id }))
		],
		selectors: cat.VIS_ITINERIS_SELECTORS,
		repertoires: cat.VIS_ITINERIS_REPERTOIRES,
		compendium: cat.VIS_ITINERIS_COMPENDIUM,
		scripts: [
			{ phase: "derived", priority: 10, seedKey: "core:script/vis-itineris-derive" },
			{ phase: "derived", priority: 20, seedKey: "core:script/vis-itineris-bulk" },
			{ phase: "pre-roll", priority: 10, seedKey: "core:script/vis-itineris-heighten-spell" },
			{ phase: "effects", priority: 90, seedKey: "core:script/vis-itineris-level-up" }
		],
		conversions: [cat.VIS_ITINERIS_FROM_FREEFORM],
		plays: [cat.commonVocabulary]
	} as RulesetProps
}

/** Its document, as a copy made before the sections stored it. */
export const visItinerisDocumentBeforeSections = (): RulesetDocument =>
	rulesetDocumentOf(_rulesetDeclOf(cat.VIS_ITINERIS_RULESET_ID, visItinerisBeforeSections()))
