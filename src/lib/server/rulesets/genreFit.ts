/**
 * 🚧 (s22-V, ruling ★§22-3, owner 2026-11-05) **Ruleset fit per genre** for
 * the Rulesets and Lorebooks views: how each enabled genre rates one
 * ruleset — "Story: Great · Lair: Good · Dungeon Crawler: Poor" — from
 * today's `rulesetFit` (the start form's Rules card reads the same
 * rating through `genreRulesOffer`). No new calculation, no per-preset fit.
 *
 * Which genres speak: an offered genre (`listOfferedGenres`) that declares
 * `uses` (it is rated), or `rulesets: { only }` (★§22-2: `only` stays a
 * lock — a ruleset outside the list reads _Not offered_). A genre that
 * declares only `keepsTime` (the Guide, Chat) speaks only when the ruleset's
 * functions count a time it does not keep.
 */
import {
	getGenre,
	getRuleset,
	i18nText,
	rulesetFit,
	type RulesetDecl,
	type RulesetRating
} from "@serene-pub/sdk"

/** One genre's word on one ruleset (`rulesetFitByGenre` on a ruleset or lorebook list row). */
export interface RulesetGenreFit {
	genreId: string
	/** The genre's display name. */
	genreName: string
	/**
	 * `rulesetFit`'s rating, or `"not-offered"` where the genre declares
	 * `rulesets: { only }` and this ruleset is not among them.
	 */
	rating: RulesetRating | "not-offered"
	/** The one-line why (`rulesetFit`'s `reason`, or the `only` sentence). */
	reason: string
	/** What the genre plays best with that these rules tell in words, and why (`rulesetFit`'s `inWords`). */
	inWords?: { label: string; why: string }[]
}

/** A genre as `rulesetFitByGenre` reads it: its id and name, and the parts of its declaration that decide whether it speaks. */
export interface FitRatingGenre {
	genreId: string
	genreName: string
	decl: {
		uses?: unknown
		keepsTime?: "story" | "real" | "none"
		rulesets?:
			| { only: readonly string[] }
			| { recommended: readonly string[]; default: string }
	}
}

/** "A" / "A and B" / "A, B and C". */
const joinNames = (names: string[]): string =>
	names.length < 2
		? (names[0] ?? "")
		: `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`

/**
 * How each of `genres` rates `ruleset`, in `genres` order. Pure. A genre that
 * declares `only` without this ruleset reads _not-offered_; else a genre that
 * declares `uses` is rated by `rulesetFit`, mapped as `genreRulesOffer` maps
 * it; a genre with no `uses` but a `keepsTime` speaks only when `rulesetFit`
 * reports a time unmet; any other genre says nothing.
 */
export function rulesetFitByGenre(
	genres: readonly FitRatingGenre[],
	ruleset: RulesetDecl
): RulesetGenreFit[] {
	const out: RulesetGenreFit[] = []
	for (const { genreId, genreName, decl } of genres) {
		const only =
			decl.rulesets && "only" in decl.rulesets ? decl.rulesets.only : null
		if (only && !only.includes(ruleset.id)) {
			const names = only.map((id) => i18nText(getRuleset(id)?.name) ?? id)
			out.push({
				genreId,
				genreName,
				rating: "not-offered",
				reason: `this genre plays only ${joinNames(names)}`
			})
		} else if (decl.uses || decl.keepsTime) {
			const r = rulesetFit(decl as any, ruleset)
			if (!decl.uses && !r.timeUnmet?.length) continue
			out.push({
				genreId,
				genreName,
				rating: r.rating,
				reason: r.reason,
				...(r.inWords.length
					? {
							inWords: r.inWords.map((w) => ({
								label: w.label ?? w.key,
								why: w.why ?? ""
							}))
						}
					: {})
			})
		}
	}
	return out
}

/** The offered genres that speak: those declaring `uses`, `keepsTime`, or `rulesets: { only }`. */
export async function fitRatingGenres(db: Db): Promise<FitRatingGenre[]> {
	const { listOfferedGenres } = await import(
		"$lib/server/pipelines/entities/sessionGenres"
	)
	const out: FitRatingGenre[] = []
	for (const g of await listOfferedGenres(db)) {
		const decl = getGenre(g.genreId) as FitRatingGenre["decl"] | undefined
		if (
			decl &&
			(decl.uses ||
				decl.keepsTime ||
				(decl.rulesets && "only" in decl.rulesets))
		)
			out.push({ genreId: g.genreId, genreName: g.name, decl })
	}
	return out
}

/**
 * One reader per request: loads the genres once, answers per ruleset id from
 * a cache. `undefined` for no id, an unregistered id, or no genre speaking.
 * A failure to load the genres is a warning and an empty answer — a fit
 * never breaks a list.
 */
export async function rulesetFitReader(
	db: Db
): Promise<
	(rulesetId: string | null | undefined) => RulesetGenreFit[] | undefined
> {
	let genres: FitRatingGenre[] = []
	try {
		genres = await fitRatingGenres(db)
	} catch (e) {
		console.warn(
			`[genreFit] could not load genres for ruleset fit: ${e instanceof Error ? e.message : String(e)}`
		)
	}
	const cache = new Map<string, RulesetGenreFit[] | undefined>()
	return (rulesetId) => {
		if (!rulesetId) return undefined
		if (cache.has(rulesetId)) return cache.get(rulesetId)
		const ruleset = getRuleset(rulesetId)
		const fit = ruleset ? rulesetFitByGenre(genres, ruleset) : []
		const result = fit.length ? fit : undefined
		cache.set(rulesetId, result)
		return result
	}
}
