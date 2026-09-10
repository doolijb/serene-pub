/**
 * What `connections.preset` is allowed to hold, and how a payload's claim about
 * it is made safe to store.
 *
 * ## Strict on write, tolerant on read
 *
 * The two halves are deliberately not symmetrical, and the asymmetry is the
 * whole design:
 *
 *   - **Read** never hard-fails on a slug it does not recognise. `presetLabel`
 *     falls back to rendering the slug itself, and `resolveConnectionCapabilities`
 *     simply finds no preset layer for it. A row written before this file
 *     existed, or by a hand-crafted socket payload, stays readable and stays
 *     editable.
 *   - **Write** refuses to persist anything that is not a slug, because the
 *     value does not just sit there: `connections:update` caches a `resolved`
 *     capability set computed from whatever preset was stored, and that cache is
 *     read on the hot path by the config picker and the bind guard. A numeric
 *     `value` landing in the column keys nothing in `PRESET_CAPABILITIES` while
 *     reading like a real slug forever after — and bakes that nothing into the
 *     cache.
 *
 * So a bad claim is NORMALIZED to NULL rather than rejected: NULL is the
 * column's documented "custom" state, it is what every row predating the column
 * holds, and it is the honest answer for a bare OpenAI-compatible URL. Refusing
 * the whole update instead would make a legacy row carrying an unrecognised slug
 * permanently un-saveable — the read-tolerance above, undone from the other side.
 *
 * Discarding is never silent: every rejection carries a `notice` sentence naming
 * what was dropped, which `connections:update` returns on its ack.
 */

import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import {
	OPENAI_COMPATIBLE_PRESETS,
	presetLabel
} from "$lib/shared/utils/connectionDefaults"
import { PRESET_CAPABILITIES } from "./manifest"

/**
 * Every slug a stored `connections.preset` may legitimately hold — the UNION of
 * the two lists that give a slug meaning, and it has to be the union rather than
 * either half.
 *
 * `OPENAI_COMPATIBLE_PRESETS` is where a slug comes FROM; `PRESET_CAPABILITIES` is
 * where one is READ. The preset list's own docblock says the two may
 * legitimately disagree in both directions — "adding a slug here without a
 * matching key in `PRESET_CAPABILITIES` is harmless" — and today they disagree
 * in exactly one place: `anthropic` is keyed in the capability map and offered
 * by no preset, so nothing can currently set it.
 *
 * ⚠ That entry is dead data ON PURPOSE, kept for the planned normalization in
 * which every connection, first parties included, is a preset for a specific
 * API. A validator built from the preset list alone would reject the one slug
 * being held for that, so it is built from both — and it keeps working
 * unchanged the day a preset starts offering it.
 */
const KNOWN_PRESET_SLUGS: ReadonlySet<string> = new Set<string>([
	...OPENAI_COMPATIBLE_PRESETS.flatMap((p) => {
		const slug = (p as { slug?: string }).slug
		return slug ? [slug] : []
	}),
	...Object.keys(PRESET_CAPABILITIES)
])

/** Whether a slug is one this build has any meaning for. */
export function isKnownPresetSlug(slug: string): boolean {
	return KNOWN_PRESET_SLUGS.has(slug)
}

/**
 * The connection TYPE a preset slug belongs to, or `null` when nothing declares
 * one.
 *
 * Derived from membership rather than stored per preset, because membership IS
 * the association: `OPENAI_COMPATIBLE_PRESETS` is the OpenAI-compatible zoo and
 * nothing else, its entries carry no `type` field of their own, and
 * `buildConnectionServiceItems` hardcodes `CONNECTION_TYPE.OPENAI` for
 * every one of them it flattens into the picker. Adding a preset therefore needs
 * no second edit here.
 *
 * ⚠ `null` means "no declared home", which is NOT "invalid" — the caller checks
 * knownness separately. A slug keyed only in `PRESET_CAPABILITIES` (`anthropic`,
 * today) has no preset to say which API it names, and picking one would be
 * inventing the very fact this returns null for. Such a slug is therefore never
 * judged against a row's type; the day a preset offers it, that judgement starts
 * happening on its own.
 */
export function presetHomeType(slug: string): string | null {
	return OPENAI_COMPATIBLE_PRESETS.some(
		(p) => (p as { slug?: string }).slug === slug
	)
		? CONNECTION_TYPE.OPENAI
		: null
}

const typeLabel = (type: string): string =>
	CONNECTION_TYPE.options.find((o) => o.value === type)?.label ?? type

/** Enough of a rejected slug to recognise it, without pasting a payload into a toast. */
const quoteSlug = (slug: string): string =>
	slug.length > 40 ? `${slug.slice(0, 40)}…` : slug

export interface PresetNormalization {
	/**
	 * What to store. `undefined` means WRITE NOTHING — the payload said nothing
	 * about the preset, and a partial update must not null a column it was never
	 * asked about.
	 */
	preset?: string | null
	/**
	 * What was discarded and why. Present only when a non-empty claim was
	 * refused, so a caller can treat its presence as "tell somebody".
	 */
	notice?: string
}

/**
 * A `preset` claim off a create/update payload, made safe to store.
 *
 * `type` is the type the row will have AFTER the write, not the one it has now:
 * an edit that changes the API is exactly the case where a slug goes stale, and
 * judging against the old type would let the stale pair through.
 *
 * The type/preset mismatch CLEARS rather than refusing the update, because a
 * person switching a connection from OpenAI-compatible to Anthropic is not
 * asserting the old service — they are changing what this row is, and the slug
 * describing what it used to be cannot follow. The `notice` is what keeps that
 * from being a silent discard.
 */
export function normalizeConnectionPreset(
	value: unknown,
	type: string | null | undefined
): PresetNormalization {
	// Not mentioned at all. Distinct from `null`, which is somebody SAYING
	// custom, and the distinction is what makes a partial update safe.
	if (value === undefined) return {}
	// NULL is the column's documented "custom", and an empty string is the same
	// statement in the spelling a form control produces.
	if (value === null || value === "") return { preset: null }
	if (typeof value !== "string")
		return {
			preset: null,
			notice: `The preset arrived as a ${typeof value} rather than a slug — the column stores a preset's slug, never its numeric value — so it was dropped and this connection is now marked custom.`
		}
	if (!KNOWN_PRESET_SLUGS.has(value))
		return {
			preset: null,
			notice: `“${quoteSlug(value)}” is not a preset this build knows, so it was dropped and this connection is now marked custom.`
		}
	const home = presetHomeType(value)
	if (home && type && home !== type)
		return {
			preset: null,
			notice: `The ${presetLabel(value)} preset belongs to ${typeLabel(home)} connections, not ${typeLabel(type)} ones, so it was dropped and this connection is now marked custom.`
		}
	return { preset: value }
}
