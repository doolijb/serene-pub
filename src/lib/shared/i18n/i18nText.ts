/**
 * Reading display text out of the SDK's `I18n` values, in a chosen language.
 *
 * ## What was already here
 *
 * The SDK has carried locale-capable display text since before this lane:
 * `I18n = string | ({ en: string } & Record<string, string>)`, on `Descriptor`,
 * `EntryTypeDecl`, `ScriptKindDecl`, `VariableDecl` and a dozen flat fields
 * besides. A plugin author can ship `{ en: "…", fr: "…" }` today; the boot
 * registry hashes it with `stripI18n` (so copyediting a label never bumps a
 * type version) and persists the whole map verbatim into
 * `pipeline_definition_registry.i18n`.
 *
 * **The whole map survives to the database and is then thrown away at read
 * time**, because every reader was hardcoded to `.en`. That is the seam this
 * function opens, and it is why R5 says to build on the SDK scaffolding rather
 * than add something parallel: the storage, the wire and the type were already
 * right. Only the reader was monolingual.
 *
 * ## The fallback chain, and why `en` is last rather than first
 *
 * `requested → en → the bare string`. English is the structurally mandatory key
 * on the object half of `I18n`, so it is the one entry a well-formed map is
 * guaranteed to have — which makes it the right *fallback* and the wrong
 * *answer*. A caller passing no language gets English, which is exactly what
 * every existing call site already got.
 */
import { DEFAULT_LANGUAGE } from "./languages"

/**
 * The display text of an `I18n` in `language`, or undefined.
 *
 * `unknown` rather than the SDK's `I18n` on purpose: half the call sites read
 * it back off a `json` column typed `Record<string, any> | null`, and a
 * signature that forced them to cast would just move the unsoundness one line
 * up.
 */
export function i18nTextIn(
	value: unknown,
	language: string = DEFAULT_LANGUAGE
): string | undefined {
	if (typeof value === "string") return value
	if (value && typeof value === "object") {
		const map = value as Record<string, unknown>
		const wanted = map[language]
		if (typeof wanted === "string" && wanted.length > 0) return wanted
		const en = map[DEFAULT_LANGUAGE]
		if (typeof en === "string") return en
	}
	return undefined
}
