/**
 * The options an `enum` field offers, as a person reads them.
 *
 * An enum's `of` holds **stored values** — `oldest-first`, `speaker-only`,
 * `lastRead` — which are what a prompt interpolates and a validator checks, and
 * are not words anybody chose to read. The field language already has the one
 * way to say what each reads as: `members: [{ key, label, description }]`
 * (the SDK's `MemberDecl`), which an enum may carry beside its `of` or instead
 * of it. This reads both, and never hands a renderer the raw value: a member
 * with no label, or an option with no member at all, reads as its value
 * humanised (`humanizeValue`).
 *
 * Display only. `value` is always the stored value, unchanged.
 */
import { i18nTextIn } from "./i18nText"

/** One option of an enum field, ready for a choice list. */
export interface EnumOption {
	/** The stored value, exactly as declared. */
	value: string
	/** What the person reads: the member's label, else the humanised value. */
	label: string
	/** The member's description, when it declares one. */
	hint?: string
}

/** The slice of a `FieldDecl` this reads — structural, so every form's local copy fits. */
interface EnumLike {
	of?: readonly unknown[]
	members?: readonly {
		key: string
		label?: unknown
		description?: unknown
	}[]
}

/**
 * A stored value as a person reads it, in sentence case: `oldest-first` →
 * "Oldest first", `lastRead` → "Last read", `speaker_only` → "Speaker only".
 * The fallback for an option nobody labelled — plainer than a declared label,
 * never the raw value.
 */
export function humanizeValue(value: string): string {
	const words = value
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.replace(/[-_]+/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.toLowerCase()
	return words.replace(/^./, (c) => c.toUpperCase())
}

/**
 * Every option of an enum, in declaration order: `of` when it is declared
 * (the stored values, and their order), else the members' keys. A member's
 * `label` and `description` are read in `language` through the one i18n
 * resolver.
 */
export function enumOptions(decl: EnumLike, language?: string): EnumOption[] {
	const members = decl.members ?? []
	const values = decl.of?.length
		? decl.of.map((v) => String(v))
		: members.map((m) => m.key)
	return values.map((value) => {
		const member = members.find((m) => m.key === value)
		const label = i18nTextIn(member?.label, language)?.trim()
		const hint = i18nTextIn(member?.description, language)?.trim()
		return {
			value,
			label: label || humanizeValue(value),
			...(hint ? { hint } : {})
		}
	})
}
