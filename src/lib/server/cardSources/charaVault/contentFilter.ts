// Tags confirmed to exist on charavault.net (via GET /api/tags) that
// signal sexual/kink content independent of the nsfw boolean. Excludes
// CharaVault's own search results for these via its documented "-tag"
// query syntax — this is CharaVault's own tagging + search mechanism,
// not app-side content classification. Deliberately excludes broader
// genre/relationship tags (Romance, Love, Harem, Yandere) that are
// common in legitimate non-sexual content — only relationship-dynamic
// and explicit-adjacent tags are included. Hardcoded stopgap; revisit
// if this needs to become tunable.
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
	// Not currently a tag with any usage on charavault.net (checked live
	// against GET /api/tags) — included pre-emptively anyway since it's a
	// harmless no-op if unused (an exclusion term with zero matches just
	// filters nothing) and starts working immediately if the tag ever
	// gains adoption.
	"Exploitation"
]

export function applyDefaultContentFilter(searchTerm: string | undefined): string {
	const exclusions = CHARAVAULT_DEFAULT_EXCLUDED_TAGS.map((t) => `-${t}`).join(" ")
	return searchTerm ? `${searchTerm} ${exclusions}` : exclusions
}
