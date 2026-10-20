/**
 * 🚧 What the session forms offer under **Rules** and **How strict**
 * (PLAN-rulesets §4, §13, §21; NOMENCLATURE §28 — the SDK nouns never show).
 *
 * The server builds one per genre (`genreRulesOffer`, `sessions:genres`);
 * the forms read it through the pure helpers here, so the rules the server
 * applies on create (W4-A) and what the form pre-selects are one rule.
 */
import { rigourLabel } from "./rigourLabels"

/** One rules choice: its id (never shown), its name and its line under the name. */
export interface RulesChoice {
	id: string
	name: string
	subtitle: string
	/** The genre recommends it (or plays only it): listed first, starred. */
	recommended: boolean
	/**
	 * 🚧 The How strict options this ruleset plays, among the genre's
	 * (2026-10-18, the 100-turn walk #26: the form allowed Story with Rules and
	 * dice). A ruleset that rolls no dice (no `conventions.dice` — Story)
	 * plays **Words only** alone. Absent: every option the genre offers.
	 */
	rigours?: string[]
	/**
	 * 🚧 How well this ruleset fits the genre (PLAN-genre-restructure §11,
	 * ruled 2026-10-19): a verbal rating from the cross-examination of the
	 * genre's `uses` against what the ruleset provides. `group` is the picker's
	 * band (0 Incompatible · 1 Poor · 2 Ok/Good · 3 Great/Perfect); `rows` and
	 * `unused` are the admin's audit. Absent when the genre declares no `uses`.
	 */
	fit?: {
		rating: "incompatible" | "poor" | "ok" | "good" | "great" | "perfect"
		group: number
		reason: string
		rows: { kind: string; key: string; required: boolean; met: "native" | "words" | "missing" }[]
		unused: string[]
	}
}

export interface GenreRulesOffer {
	/** Recommended first, then the rest by name; an `only` genre's alone. */
	choices: RulesChoice[]
	/** The genre plays only these (`rulesets.only`). */
	only: boolean
	/** What the server picks when the form sends none. */
	defaultId: string
	/** How strict: the genre's options (ids) and its default. */
	rigour: { options: string[]; default: string }
}

/** Whether the form asks How strict at all — a genre with one option (Chat) is not asked. */
export const asksHowStrict = (offer: GenreRulesOffer | null | undefined): boolean =>
	!!offer && offer.rigour.options.length > 1

/**
 * The How strict choices in the interface's words, in the genre's order —
 * 🚧 with a rules choice named, only the options that ruleset plays
 * (`RulesChoice.rigours`: Story plays Words only).
 */
export const howStrictChoices = (
	offer: GenreRulesOffer | null | undefined,
	rulesId?: string | null
): { id: string; label: string }[] => {
	const plays = rulesId ? offer?.choices.find((c) => c.id === rulesId)?.rigours : undefined
	return (offer?.rigour.options ?? [])
		.filter((id) => !plays || plays.includes(id))
		.map((id) => ({ id, label: rigourLabel(id) }))
}

/**
 * 🚧 The How strict options a ruleset plays among the genre's (2026-10-18):
 * one that rolls no dice (no `conventions.dice` — Story) plays Words only;
 * every other, all of them. Undefined when it plays every option.
 */
export function rigoursPlayed(rollsDice: boolean, options: readonly string[]): string[] | undefined {
	if (rollsDice || !options.includes("prose")) return undefined
	return options.length > 1 ? ["prose"] : undefined
}

/** 🚧 The offer with each choice's `rigours` said, given which rulesets roll dice. */
export function withRigoursPlayed(offer: GenreRulesOffer, rollsDice: (rulesetId: string) => boolean): GenreRulesOffer {
	return {
		...offer,
		choices: offer.choices.map((c) => {
			const rigours = rigoursPlayed(rollsDice(c.id), offer.rigour.options)
			return rigours ? { ...c, rigours } : c
		})
	}
}

/**
 * 🚧 How strict as it stands for a rules choice: the person's pick when the
 * ruleset plays it, else the genre's default when it does, else the
 * ruleset's first (Story: Words only).
 */
export function rigourFor(offer: GenreRulesOffer, rulesId: string | null | undefined, picked: string | null): string {
	const options = howStrictChoices(offer, rulesId).map((o) => o.id)
	if (picked && options.includes(picked)) return picked
	if (options.includes(offer.rigour.default)) return offer.rigour.default
	return options[0] ?? offer.rigour.default
}

/**
 * The Rules field as the form shows it: adopted from the chosen lorebook
 * (disabled, _From the lorebook: ‹name›_) — every lorebook has rules, and a
 * session attached at creation takes them — else the person's pick, else the
 * genre's default.
 */
export function rulesField(
	offer: GenreRulesOffer,
	picked: string | null,
	lorebook: { primaryRuleset?: string | null } | null
): { value: string; fromLorebook: string | null } {
	const adopted = lorebook?.primaryRuleset ?? null
	if (adopted) {
		const name = offer.choices.find((c) => c.id === adopted)?.name ?? "its own rules"
		return { value: adopted, fromLorebook: `From the lorebook: ${name}` }
	}
	const value = picked && offer.choices.some((c) => c.id === picked) ? picked : offer.defaultId
	return { value, fromLorebook: null }
}
