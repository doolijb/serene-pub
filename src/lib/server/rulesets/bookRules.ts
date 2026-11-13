/**
 * 🚧 A genre that plays only certain **Rules** (`rulesets.only`, PLAN-rulesets
 * §4) and a lorebook told by other rules: what the session says instead of
 * reading the book. `sessions:create` refuses with this sentence when the book
 * is chosen at the start; a book attached to a session later
 * (`sessions:setLorebook`) is refused the same way, so a session that plays
 * only Vis Itineris never reads a Freeform book by the side door.
 *
 * The same helper also refuses **Incompatible** rules (owner 2026-11-05: "Always
 * lock out Incompatible, no setting"): a genre that declares what it `uses`
 * and a ruleset `rulesetFit` rates Incompatible for it (`rulesetIncompatibleRefusal`).
 * Every rating above that stays a sentence, never a refusal. A next chapter is
 * exempt (`opts.nextChapter`): no running story is re-judged for its rules.
 *
 * Null when the genre plays any rules, or the book's are among them — or the
 * book brings no rules of its own (Freeform, every book's default:
 * `adoptedBookRules`), when the session plays its own (fix7, 2026-10-23).
 */
import { getGenre, getRuleset, rulesetFit } from "@serene-pub/sdk"
import { adoptedBookRules } from "$lib/shared/rulesets/rulesOffer"

function rulesName(id: string): string {
	const n = getRuleset(id)?.name as unknown
	return typeof n === "string"
		? n
		: ((n as Record<string, string> | undefined)?.en ?? id)
}

function listed(ids: readonly string[]): string {
	const names = ids.map(rulesName)
	return names.length > 1
		? `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`
		: (names[0] ?? "")
}

function genreNameOf(genre: ReturnType<typeof getGenre>): string | null {
	return genre?.name
		? typeof genre.name === "string"
			? genre.name
			: ((genre.name as Record<string, string>).en ?? null)
		: null
}

/**
 * The sentence for rules the genre can't play: it declares what it `uses`, the
 * ruleset is registered, and `rulesetFit` rates it Incompatible. Null otherwise.
 */
export function rulesetIncompatibleRefusal(
	genreId: string | null | undefined,
	rulesetId: string
): string | null {
	const genre = genreId ? getGenre(genreId) : undefined
	if (!genre?.uses) return null
	const ruleset = getRuleset(rulesetId)
	if (!ruleset) return null
	const fit = rulesetFit(genre as any, ruleset as any)
	if (fit.rating !== "incompatible") return null
	return `${genreNameOf(genre) ?? "This genre"} can't play ${rulesName(rulesetId)}: ${fit.reason}.`
}

export function strictRulesRefusal(
	genreId: string | null | undefined,
	book: { name: string; primaryRuleset: string },
	opts?: { starter?: boolean; nextChapter?: boolean }
): string | null {
	if (!adoptedBookRules(book.primaryRuleset)) return null
	const genre = genreId ? getGenre(genreId) : undefined
	const declared = genre?.rulesets
	const only = declared && "only" in declared ? declared.only : null
	if (only && !only.includes(book.primaryRuleset)) {
		const genreName = genreNameOf(genre)
		return opts?.starter
			? `${genreName ?? "This genre"} plays only by ${listed(only)} rules, and ` +
					`the starter lorebook '${book.name}' uses ${rulesName(book.primaryRuleset)} rules. ` +
					`Choose a starter lorebook that uses ${listed(only)}, or another genre.`
			: `${genreName ?? "This genre"} plays only by ${listed(only)} rules, and ` +
					`the lorebook '${book.name}' uses ${rulesName(book.primaryRuleset)} rules. ` +
					`Choose a lorebook that uses ${listed(only)}, or another genre.`
	}
	return opts?.nextChapter ? null : rulesetIncompatibleRefusal(genreId, book.primaryRuleset)
}
