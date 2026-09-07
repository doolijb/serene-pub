/**
 * The language table — plan `PLAN-retrieval-and-knowledge.md` §7 **R5**.
 *
 * ## Why this is a retrieval file that happens to render a dropdown
 *
 * R5 makes language a first-class setting for two reasons, and the second is
 * the load-bearing one: **the language flag gates language-specific retrieval
 * features**. Stemming exists only for the languages somebody wrote a stemmer
 * for; trigram folding works for every language there is. Without this table,
 * "we trigram-fold by default" reads as a limitation. With it, it is a
 * decision — the universal path is the default and stemming is an enhancement
 * that switches on where it is available.
 *
 * So `features` is not decoration. It is the contract the lexical mechanism reads
 * before it picks a normalisation strategy, and the reason the answer is a
 * property of the *language* rather than a global toggle somebody forgot to
 * flip.
 *
 * ## The rules this table follows
 *
 * - **ISO 639-1 two-letter codes only, no regional subtags.** Not an oversight:
 *   the auto-translation library validates its `from`/`to` against ISO 639-1
 *   and throws on anything else, and `pt` vs `pt-BR` is a distinction neither
 *   stemming nor trigram folding makes. Regional variants are a later change to
 *   this file plus a mapping down to the primary subtag at the translate call;
 *   nothing else has to move.
 * - **`stemming` means a Snowball stemmer exists for the language**, which is
 *   the family every server-side stemmer in this ecosystem is a port of. It is
 *   deliberately *not* "we have wired one" — that is the lexical mechanism's
 *   business, and a flag that meant "wired" would have to be edited by whoever
 *   wires it, at which point it stops describing the language.
 * - **A language absent from this list is not selectable**, and a stored code
 *   that is no longer here resolves to the fallback rather than throwing. An
 *   install downgraded across a release that dropped a language keeps working
 *   in English instead of failing to load settings.
 */

/** The one language every install can always fall back to. */
export const DEFAULT_LANGUAGE = "en"

export interface LanguageFeatures {
	/**
	 * A Snowball stemmer exists for this language.
	 *
	 * **This is R5's gate.** False does not mean retrieval is worse — it means
	 * the lexical mechanism takes the trigram path, which is the path it takes for
	 * everyone by default anyway.
	 */
	stemming: boolean
	/**
	 * Words are separated by whitespace in ordinary prose.
	 *
	 * False for Japanese, Chinese and Thai, where a whitespace tokenizer
	 * returns one token per sentence. This is the flag that says trigram
	 * folding is not a fallback for those languages but the only thing that
	 * works at all, and it is why a future word-boundary requirement has
	 * somewhere to be asked about rather than being assumed.
	 */
	whitespaceDelimited: boolean
}

export interface LanguageDefinition {
	/** ISO 639-1. Also what goes in `<html lang>`. */
	code: string
	/** English name, for an English-speaking admin reading the list. */
	name: string
	/** The name in the language itself, for everyone else reading the list. */
	endonym: string
	/**
	 * Writing direction.
	 *
	 * **Declared, deliberately not wired.** Nothing sets `dir` on the document
	 * from this, and that is a decision rather than an omission: `dir="rtl"`
	 * mirrors the entire layout, and this app's styling is written in physical
	 * properties (`ml-`, `pr-`, `left-`) rather than logical ones. Switching it
	 * on would produce a half-mirrored interface — text one way, chrome the
	 * other — which is worse than the honest LTR fallback Arabic and Hebrew get
	 * today.
	 *
	 * Real RTL support is an audit of every physical-property class plus a
	 * visual pass, and it is its own piece of work. This field is here so that
	 * work has the fact it needs already recorded, and so the language table
	 * does not become the thing blocking it.
	 */
	direction: "ltr" | "rtl"
	features: LanguageFeatures
}

const ltr = (
	code: string,
	name: string,
	endonym: string,
	stemming: boolean,
	whitespaceDelimited = true
): LanguageDefinition => ({
	code,
	name,
	endonym,
	direction: "ltr",
	features: { stemming, whitespaceDelimited }
})

const rtl = (
	code: string,
	name: string,
	endonym: string,
	stemming: boolean
): LanguageDefinition => ({
	code,
	name,
	endonym,
	direction: "rtl",
	features: { stemming, whitespaceDelimited: true }
})

/**
 * Ordered by English name, with English first because it is the source
 * language every other entry is translated *from*.
 */
export const LANGUAGES: readonly LanguageDefinition[] = [
	ltr("en", "English", "English", true),
	rtl("ar", "Arabic", "العربية", true),
	// No Snowball Czech, Polish or Ukrainian stemmer exists. Listed as false
	// rather than omitted from the language list: a Polish user should get a
	// Polish UI, and trigram folding serves their retrieval perfectly well.
	ltr("cs", "Czech", "Čeština", false),
	ltr("zh", "Chinese", "中文", false, false),
	ltr("da", "Danish", "Dansk", true),
	ltr("nl", "Dutch", "Nederlands", true),
	ltr("fi", "Finnish", "Suomi", true),
	ltr("fr", "French", "Français", true),
	ltr("de", "German", "Deutsch", true),
	ltr("el", "Greek", "Ελληνικά", true),
	rtl("he", "Hebrew", "עברית", false),
	ltr("hi", "Hindi", "हिन्दी", true),
	ltr("hu", "Hungarian", "Magyar", true),
	ltr("id", "Indonesian", "Bahasa Indonesia", true),
	ltr("it", "Italian", "Italiano", true),
	ltr("ja", "Japanese", "日本語", false, false),
	// Korean does use spaces between eojeol, so the whitespace tokenizer
	// produces real tokens — it is only the stemmer that is missing.
	ltr("ko", "Korean", "한국어", false),
	ltr("no", "Norwegian", "Norsk", true),
	ltr("pl", "Polish", "Polski", false),
	ltr("pt", "Portuguese", "Português", true),
	ltr("ro", "Romanian", "Română", true),
	ltr("ru", "Russian", "Русский", true),
	ltr("es", "Spanish", "Español", true),
	ltr("sv", "Swedish", "Svenska", true),
	ltr("th", "Thai", "ไทย", false, false),
	ltr("tr", "Turkish", "Türkçe", true),
	ltr("uk", "Ukrainian", "Українська", false),
	ltr("vi", "Vietnamese", "Tiếng Việt", false)
]

const BY_CODE = new Map(LANGUAGES.map((l) => [l.code, l]))

/** The English fallback, guaranteed present — asserted by the unit test. */
export const DEFAULT_LANGUAGE_DEFINITION = BY_CODE.get(
	DEFAULT_LANGUAGE
) as LanguageDefinition

/** Whether `code` names a language this build offers. */
export function isSupportedLanguage(code: string | null | undefined): boolean {
	return !!code && BY_CODE.has(code)
}

/**
 * The definition for `code`, or English.
 *
 * Never throws and never returns undefined, deliberately: every caller is
 * either rendering a label or answering a feature question, and neither has a
 * sensible thing to do with "no such language" that is better than English.
 */
export function languageDefinition(
	code: string | null | undefined
): LanguageDefinition {
	return (code && BY_CODE.get(code)) || DEFAULT_LANGUAGE_DEFINITION
}

/**
 * **The R5 gate.** Does this language support the named retrieval feature?
 *
 * Pure and synchronous — it asks about a language, not about an install — so
 * the lexical mechanism can call it per query without a round trip. Ask
 * `resolveUserLanguage()` (server) for *which* language first.
 */
export function languageSupports(
	code: string | null | undefined,
	feature: keyof LanguageFeatures
): boolean {
	return languageDefinition(code).features[feature]
}
