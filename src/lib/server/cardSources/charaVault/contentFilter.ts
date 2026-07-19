// Tags confirmed to exist on charavault.net (via GET /api/tags) that
// signal sexual/kink content independent of the nsfw boolean. Deliberately
// excludes broader genre/relationship tags (Romance, Love, Harem, Yandere)
// that are common in legitimate non-sexual content — only relationship-
// dynamic and explicit-adjacent tags are included. Hardcoded stopgap;
// revisit if this needs to become tunable.
export const CHARAVAULT_DEFAULT_EXCLUDED_TAGS = [
	"Dominant",
	"Submissive",
	"Femdom",
	"Maledom",
	"Switch",
	"Breeding",
	"Smut",
	"smut",
	"Lewd",
	"Ecchi",
	// Confirmed live via GET /api/tags — 31,417 uses.
	"easygirl",
	// Not currently a tag with any usage on charavault.net (checked live
	// against GET /api/tags) — included pre-emptively anyway since it's a
	// harmless no-op if unused (an exclusion term with zero matches just
	// filters nothing) and starts working immediately if the tag ever
	// gains adoption.
	"Exploitation"
]

const EXCLUDED_TAGS_LOWER = new Set(
	CHARAVAULT_DEFAULT_EXCLUDED_TAGS.map((t) => t.toLowerCase())
)

/**
 * Appended to the outbound `q=` search query as a courtesy — CharaVault's
 * own docs don't specify whether its "-word" operator matches against tags
 * or just the name/description text, so this alone isn't reliable (verified
 * live: a card tagged "Dominant" with no literal "dominant" in its name or
 * description was NOT excluded by this). Still worth sending: it reduces
 * how much gets sent back at all when it does match text. hasExcludedTag()
 * below is the actual, reliable enforcement — it checks the real tags array
 * CharaVault returns per card, not a guess at their query grammar.
 */
export function applyDefaultContentFilter(searchTerm: string | undefined): string {
	const exclusions = CHARAVAULT_DEFAULT_EXCLUDED_TAGS.map((t) => `-${t}`).join(" ")
	return searchTerm ? `${searchTerm} ${exclusions}` : exclusions
}

/** True if any of a card's own CharaVault-assigned tags are on the exclusion list (case-insensitive). */
export function hasExcludedTag(tags: string[]): boolean {
	return tags.some((tag) => EXCLUDED_TAGS_LOWER.has(tag.toLowerCase()))
}
