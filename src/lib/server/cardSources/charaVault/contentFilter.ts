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
	"Exploitation",
	// Sexual-orientation / attraction tags — on this site these correlate
	// strongly with romance/erotica-genre content even when not flagged
	// nsfw, same rationale as the relationship-dynamic tags above. Applied
	// symmetrically (straight/heterosexual excluded right alongside the
	// others) rather than singling out non-hetero orientations, since the
	// goal is trimming sexual-content prevalence, not filtering by
	// identity. Deliberately excludes gender-identity tags (eg.
	// "Transgender", "Non-Binary") — a different axis from orientation.
	// All confirmed live via GET /api/tags.
	"Gay",
	"Lesbian",
	"Bisexual",
	"Straight",
	"Heterosexual",
	"Homosexual",
	"Pansexual",
	"Asexual",
	"Queer",
	"Sapphic",
	"Bicurious",
	"Omnisexual",
	"Demisexual",
	"mlm",
	"wlw",
	"Yaoi",
	"Yuri",
	// Confirmed live via GET /api/tags — Milf 12,667 uses, Milfy 1 use.
	"Milf",
	"Milfy",
	// Confirmed live via GET /api/tags — 653 uses.
	"Abusive"
]

const EXCLUDED_TAGS_LOWER = new Set(
	CHARAVAULT_DEFAULT_EXCLUDED_TAGS.map((t) => t.toLowerCase())
)

// Unlike the tag list above, this is deliberately narrow — most of the tag
// list would false-positive constantly if matched as a name *substring*
// (eg. "Love" or "Constant" are common in innocuous names). "milf"/"milfy"
// are specific enough that a name match is a reliable signal on its own,
// which matters because plenty of cards carry this in the name without the
// corresponding tag. "milf" alone would already catch "milfy" as a
// substring, but both are listed explicitly for clarity.
export const CHARAVAULT_EXCLUDED_NAME_SUBSTRINGS = ["milf", "milfy"]

const EXCLUDED_NAME_SUBSTRINGS_LOWER = CHARAVAULT_EXCLUDED_NAME_SUBSTRINGS.map(
	(s) => s.toLowerCase()
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
export function applyDefaultContentFilter(
	searchTerm: string | undefined
): string {
	const exclusions = CHARAVAULT_DEFAULT_EXCLUDED_TAGS.map(
		(t) => `-${t}`
	).join(" ")
	return searchTerm ? `${searchTerm} ${exclusions}` : exclusions
}

/** True if any of a card's own CharaVault-assigned tags are on the exclusion list (case-insensitive). */
export function hasExcludedTag(tags: string[]): boolean {
	return tags.some((tag) => EXCLUDED_TAGS_LOWER.has(tag.toLowerCase()))
}

/** True if the card's name contains an excluded substring (case-insensitive) — catches cards that signal this in the name without the matching tag. */
export function hasExcludedNameMatch(name: string): boolean {
	const lower = name.toLowerCase()
	return EXCLUDED_NAME_SUBSTRINGS_LOWER.some((s) => lower.includes(s))
}
