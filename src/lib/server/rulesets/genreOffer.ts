/**
 * 🚧 A genre's **Rules** and **How strict** offer for the session forms
 * (`sessions:genres`; shape in `$lib/shared/rulesets/rulesOffer`). The same
 * rule `sessions:create` applies (W4-A): `only`'s first, else recommended's
 * `default`, else Story; How strict defaults to the genre's, else `prose`.
 *
 * Null for a genre that offers no choice — no rulesets named and one way to
 * be strict (Chat) — so the forms show neither field.
 */
import { i18nText, rulesetFit, type RulesetDecl } from "@serene-pub/sdk"
import type { GenreRulesOffer, RulesChoice } from "$lib/shared/rulesets/rulesOffer"

const STORY = "core:ruleset/freeform@1"

/** §28: Story's subtitle carries its difference from the other uses of the word. */
const SUBTITLES: Readonly<Record<string, string>> = { [STORY]: "Words decide; no numbers." }

interface GenreRulesDecl {
	rulesets?: { only: readonly string[] } | { recommended: readonly string[]; default: string }
	rigour?: { options: readonly string[]; default: string }
	/** 🚧 What the genre uses of a ruleset — `rulesetFit` rates every choice against it. */
	uses?: unknown
}

export function genreRulesOffer(
	genre: GenreRulesDecl | null | undefined,
	registered: readonly Pick<RulesetDecl, "id" | "name" | "description">[]
): GenreRulesOffer | null {
	const declared = genre?.rulesets
	const rigourOptions = [...(genre?.rigour?.options ?? ["prose"])]
	if (!declared && rigourOptions.length < 2) return null
	const only = declared && "only" in declared ? [...declared.only] : null
	const recommended = new Set(
		declared ? ("only" in declared ? declared.only : declared.recommended) : []
	)
	const choice = (r: Pick<RulesetDecl, "id" | "name" | "description">): RulesChoice => {
		const out: RulesChoice = {
			id: r.id,
			name: i18nText(r.name) ?? r.id,
			subtitle: SUBTITLES[r.id] ?? i18nText(r.description) ?? "",
			recommended: recommended.has(r.id)
		}
		// The rating (§11): only a genre that says what it uses gets one.
		if (genre?.uses) {
			const f = rulesetFit(genre as any, r as RulesetDecl)
			out.fit = { rating: f.rating, group: f.group, reason: f.reason, rows: f.rows.map((x) => ({ ...x })), unused: [...f.unused] }
		}
		return out
	}
	const offered = registered.filter((r) => !only || only.includes(r.id)).map(choice)
	offered.sort((a, b) =>
		a.recommended !== b.recommended
			? a.recommended
				? -1
				: 1
			: (b.fit?.group ?? 3) !== (a.fit?.group ?? 3)
				? (b.fit?.group ?? 3) - (a.fit?.group ?? 3)
				: a.name.localeCompare(b.name)
	)
	const defaultId = declared
		? "only" in declared
			? (declared.only[0] ?? STORY)
			: declared.default
		: STORY
	return {
		choices: offered,
		only: !!only,
		defaultId,
		rigour: { options: rigourOptions, default: genre?.rigour?.default ?? "prose" }
	}
}
