/**
 * 🚧 What the session forms offer under **Rules** and **How strict**
 * (PLAN-rulesets §4, §13, §21; NOMENCLATURE §28 — the SDK nouns never show).
 *
 * The server builds one per genre (`genreRulesOffer`, `sessions:genres`);
 * the forms read it through the pure helpers here, so the rules the server
 * applies on create (W4-A) and what the form pre-selects are one rule.
 */
import { rigourLabel } from "./rigourLabels"

/**
 * Every book's rules until it is told others (`lorebooks.primary_ruleset`'s
 * default, New lorebook's pick): Freeform. 🚧 A book on them brings no rules
 * of its own (PLAN-rulesets §4: "no ruleset" and the default are one state).
 */
export const BOOK_DEFAULT_RULES = "core:ruleset/freeform@1"

/**
 * 🚧 The rules a session **adopts** from a lorebook (or a starter lorebook)
 * read in before play: the book's own — or null for a book on
 * {@link BOOK_DEFAULT_RULES}, which brings none, so the session's own Rules
 * stand (the person's pick, a preset's need, the genre's default): a book on
 * Freeform never fixes a Lair (or any genre) to Words only. One rule for the
 * start form, `sessions:create`,
 * `sessions:setLorebook` / `sessions:update` (`rulesFromBook`) and the
 * strict-rules refusal.
 */
export function adoptedBookRules(primaryRuleset: string | null | undefined): string | null {
	return primaryRuleset && primaryRuleset !== BOOK_DEFAULT_RULES ? primaryRuleset : null
}

/** One rules choice: its id (never shown), its name and its line under the name. */
export interface RulesChoice {
	id: string
	name: string
	subtitle: string
	/** The genre recommends it (or plays only it): listed first, starred. */
	recommended: boolean
	/**
	 * 🚧 The How strict options this ruleset plays, among the genre's
	 * (2026-10-18, the 100-turn walk #26: the form allowed Story with stricter
	 * rules). A ruleset that decides nothing by its rules (no check method but
	 * `none` — Story; 2026-10-22, never "no dice") plays **Words only** alone.
	 * Absent: every option the genre offers.
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
		rows: { kind: string; key: string; required: boolean; met: "native" | "words" | "missing"; label?: string; why?: string }[]
		unused: string[]
		/** 🚧 What the genre plays best with that these rules lack — each played in words, with why (RF fix 8). */
		inWords?: { label: string; why: string }[]
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
	/** 🚧 What the genre plays best with, as one line (RF fix 8: "Plays best with a health-like number and …"); absent when it names none. */
	playsBestWith?: string
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
 * one that decides nothing by its rules (Story — `rulesetDecides`, 🚧
 * 2026-10-22: a check method other than `none`, dice or not) plays Words
 * only; every other, all of them. Undefined when it plays every option.
 */
export function rigoursPlayed(decides: boolean, options: readonly string[]): string[] | undefined {
	if (decides || !options.includes("prose")) return undefined
	return options.length > 1 ? ["prose"] : undefined
}

/** 🚧 The offer with each choice's `rigours` said, given which rulesets decide anything by their rules. */
export function withRigoursPlayed(offer: GenreRulesOffer, decides: (rulesetId: string) => boolean): GenreRulesOffer {
	return {
		...offer,
		choices: offer.choices.map((c) => {
			const rigours = rigoursPlayed(decides(c.id), offer.rigour.options)
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
 * (disabled, _From the lorebook: ‹name›_) when the book brings rules of its
 * own (`adoptedBookRules`) — a session attached at creation takes them — else
 * the person's pick, else the genre's default. A book on Freeform brings
 * none, so the picker stays (fix7, 2026-10-23).
 */
export function rulesField(
	offer: GenreRulesOffer,
	picked: string | null,
	lorebook: { primaryRuleset?: string | null } | null
): { value: string; fromLorebook: string | null } {
	const adopted = adoptedBookRules(lorebook?.primaryRuleset)
	if (adopted) {
		const name = offer.choices.find((c) => c.id === adopted)?.name ?? "its own rules"
		return { value: adopted, fromLorebook: `From the lorebook: ${name}` }
	}
	const value = picked && offer.choices.some((c) => c.id === picked) ? picked : offer.defaultId
	return { value, fromLorebook: null }
}
