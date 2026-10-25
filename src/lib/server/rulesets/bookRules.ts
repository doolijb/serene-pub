/**
 * 🚧 A genre that plays only certain **Rules** (`rulesets.only`, PLAN-rulesets
 * §4) and a lorebook told by other rules: what the session says instead of
 * reading the book. `sessions:create` refuses with this sentence when the book
 * is chosen at the start; a book attached to a session later
 * (`sessions:setLorebook`) is refused the same way, so a session that plays
 * only Vis Itineris never reads a Freeform book by the side door.
 *
 * Null when the genre plays any rules, or the book's are among them — or the
 * book brings no rules of its own (Freeform, every book's default:
 * `adoptedBookRules`), when the session plays its own (fix7, 2026-10-23).
 */
import { getGenre, getRuleset } from "@serene-pub/sdk"
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

export function strictRulesRefusal(
	genreId: string | null | undefined,
	book: { name: string; primaryRuleset: string }
): string | null {
	const genre = genreId ? getGenre(genreId) : undefined
	const declared = genre?.rulesets
	const only = declared && "only" in declared ? declared.only : null
	if (!only || !adoptedBookRules(book.primaryRuleset) || only.includes(book.primaryRuleset)) return null
	const genreName = genre?.name
		? typeof genre.name === "string"
			? genre.name
			: ((genre.name as Record<string, string>).en ?? null)
		: null
	return (
		`${genreName ?? "This genre"} plays only by ${listed(only)} rules, and ` +
		`the lorebook '${book.name}' uses ${rulesName(book.primaryRuleset)} rules. ` +
		`Choose a lorebook that uses ${listed(only)}, or another genre.`
	)
}
