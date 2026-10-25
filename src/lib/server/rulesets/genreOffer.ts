/**
 * 🚧 A genre's **Rules** and **How strict** offer for the session forms
 * (`sessions:genres`; shape in `$lib/shared/rulesets/rulesOffer`). The same
 * rule `sessions:create` applies (W4-A): `only`'s first, else recommended's
 * `default`, else Story; How strict defaults to the genre's, else `prose`.
 *
 * Null for a genre that offers no choice — no rulesets named and one way to
 * be strict (Chat) — so the forms show neither field.
 */
import { i18nText, playsBestWithLine, rulesetFit, type RulesetDecl } from "@serene-pub/sdk"
import { BOOK_DEFAULT_RULES } from "$lib/shared/rulesets/rulesOffer"
import type { GenreRulesOffer, RulesChoice } from "$lib/shared/rulesets/rulesOffer"

/** Freeform: the genre's fallback and every book's default (one spelling, in the shared module). */
const STORY = BOOK_DEFAULT_RULES

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
			out.fit = {
				rating: f.rating,
				group: f.group,
				reason: f.reason,
				rows: f.rows.map((x) => ({ ...x })),
				unused: [...f.unused],
				// 🚧 RF fix 8: what these rules lack of what the genre plays best with, and why — never a lock.
				...(f.inWords.length ? { inWords: f.inWords.map((r) => ({ label: r.label ?? r.key, why: r.why ?? "" })) } : {})
			}
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
	const best = genre?.uses ? playsBestWithLine(genre as never) : ""
	return {
		choices: offered,
		only: !!only,
		defaultId,
		rigour: { options: rigourOptions, default: genre?.rigour?.default ?? "prose" },
		...(best ? { playsBestWith: best } : {})
	}
}

/**
 * 🚧 The **Rules** a lorebook may be told by (New lorebook, Book settings):
 * every registered ruleset, no genre to recommend or rate one, Freeform
 * first — every book's default — then the rest by name.
 */
export function bookRulesChoices(
	registered: readonly Pick<RulesetDecl, "id" | "name" | "description">[]
): RulesChoice[] {
	const choices = registered.map(
		(r): RulesChoice => ({
			id: r.id,
			name: i18nText(r.name) ?? r.id,
			subtitle: SUBTITLES[r.id] ?? i18nText(r.description) ?? "",
			recommended: false
		})
	)
	return choices.sort((a, b) =>
		a.id === STORY ? -1 : b.id === STORY ? 1 : a.name.localeCompare(b.name)
	)
}

/** Every book's rules when none were chosen (`lorebooks.primary_ruleset`'s default). */
export { BOOK_DEFAULT_RULES }
