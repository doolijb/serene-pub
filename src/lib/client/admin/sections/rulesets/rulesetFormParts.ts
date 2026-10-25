/**
 * 🚧 The small pure helpers every Admin › Rulesets form module shares
 * (`rulesetForm.ts` and the content forms beside it): reading display text,
 * writing it back in the shape it was read, numbers typed into text boxes,
 * comma lists, and the one test a row's writer asks first — **did this row
 * change at all?** A row that did not writes the object it was read from,
 * byte for byte, so opening a form and saving never rewrites what nobody
 * touched.
 */
import { i18nText } from "@serene-pub/sdk"
import { sameFormValue } from "$lib/client/forms/sameFormValue"

export type Json = Record<string, unknown>

export const isObject = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v)

/** Display text (a string or a locale map) as the form shows it. */
export const textOf = (v: unknown): string => (typeof v === "string" ? v : (i18nText(v as never) ?? ""))

let uidSeq = 0
/** A key for a row the form adds; read rows get positional keys instead. */
export const newRowUid = (): string => `row-${++uidSeq}`

/**
 * Display text written back in the shape it was read: a locale map keeps
 * its other languages with `en` replaced, a plain string stays a string, and
 * a new one is `{ en }`. Empty → undefined (the key is left out).
 */
export function withEnglish(prev: unknown, value: string): unknown {
	const t = value.trim()
	if (isObject(prev)) {
		const m: Json = { ...prev }
		if (t) m.en = t
		else delete m.en
		return Object.keys(m).length ? m : undefined
	}
	if (!t) return undefined
	return typeof prev === "string" ? t : { en: t }
}

/** Write `v` at `key`, or remove the key when `v` is undefined. */
export function setOrDrop(o: Json, key: string, v: unknown) {
	if (v === undefined) delete o[key]
	else o[key] = v
}

const NUMERIC = /^\s*-?(\d+\.?\d*|\.\d+)\s*$/

/** A stored number (or anything) as its box shows it. */
export const numberText = (v: unknown): string => (v === undefined || v === null ? "" : String(v))

/**
 * A number box's text as the document stores it: blank → undefined (left
 * out), a number → that number, anything else → the text as typed, so the
 * server's check names it rather than the form dropping it.
 */
export function numberOrText(t: string): number | string | undefined {
	if (!t.trim()) return undefined
	return NUMERIC.test(t) ? Number(t) : t.trim()
}

/** A list of words as one line: "gear, status". */
export const listText = (v: unknown): string =>
	Array.isArray(v) ? v.filter((x) => typeof x === "string").join(", ") : ""

/** One line of words back to a list; empty → []. */
export const splitList = (t: string): string[] =>
	t
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean)

/**
 * The row reads exactly as one read from `original` would — nothing in it
 * was edited. `ignore` names the row's own bookkeeping (`uid`, nested ones).
 */
export function unchanged(row: unknown, fresh: unknown, ignore: readonly string[] = ["uid"]): boolean {
	return sameFormValue(row, fresh, { ignore })
}

/** "Things, Conditions and Exits". */
export function listed(names: readonly string[]): string {
	if (names.length <= 1) return names.join("")
	return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
}

/** Deep plain copy (the form's rows are reactive proxies). */
export const plain = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T))

/** `list` with item `i` moved one place up (-1) or down (1); unchanged at an end. */
export function moved<T>(list: readonly T[], i: number, by: -1 | 1): T[] {
	const j = i + by
	const next = [...list]
	if (j < 0 || j >= list.length) return next
	;[next[i], next[j]] = [next[j]!, next[i]!]
	return next
}
