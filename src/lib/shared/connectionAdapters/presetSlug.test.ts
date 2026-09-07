/**
 * `connections.preset` is strict on write and tolerant on read, and these pin
 * both halves plus the one entry that looks like dead data and is being kept.
 *
 * The bug behind this file: `connections:create` coerced the payload's `preset`
 * and `connections:update` did not, so an update stored what a create would have
 * thrown away — and the stored value was then baked into the cached `resolved`
 * capability set that the config picker and the bind guard read. The handler's
 * own integration coverage is in
 * `src/lib/server/sockets/connections.presetValidation.int.test.ts`; this file
 * pins the rule itself.
 */

import { describe, expect, test } from "vitest"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import { OPENAI_CHAT_PRESETS } from "$lib/shared/utils/connectionDefaults"
import { PRESET_CAPABILITIES } from "./manifest"
import {
	isKnownPresetSlug,
	normalizeConnectionPreset,
	presetHomeType
} from "./presetSlug"

const OPENAI = CONNECTION_TYPE.OPENAI_CHAT

describe("the known-slug vocabulary is the UNION of both lists", () => {
	test("every slug a preset offers is known", () => {
		const offered = OPENAI_CHAT_PRESETS.map(
			(p) => (p as { slug?: string }).slug
		).filter((s): s is string => !!s)
		// Not a snapshot of the count: presets get added, and a test that
		// asserted "12" would fail for the wrong reason the day one does.
		expect(offered.length).toBeGreaterThan(0)
		for (const slug of offered) expect(isKnownPresetSlug(slug)).toBe(true)
	})

	test("every slug PRESET_CAPABILITIES keys is known, including one no preset offers", () => {
		for (const slug of Object.keys(PRESET_CAPABILITIES))
			expect(isKnownPresetSlug(slug)).toBe(true)
	})

	/**
	 * ⚠ The load-bearing one. `PRESET_CAPABILITIES` keys `anthropic` and no
	 * preset offers it, so nothing can currently set it — dead data, kept
	 * deliberately for the planned normalization in which every connection,
	 * first parties included, is a preset for a specific API. A validator built
	 * from the preset list alone would reject exactly the slug being held for
	 * that, which is why the vocabulary is a union rather than either half.
	 */
	test("`anthropic` is accepted even though no preset offers it", () => {
		expect(
			OPENAI_CHAT_PRESETS.some(
				(p) => (p as { slug?: string }).slug === "anthropic"
			)
		).toBe(false)
		expect(PRESET_CAPABILITIES.anthropic).toBeDefined()
		expect(isKnownPresetSlug("anthropic")).toBe(true)
	})

	test("a slug nothing declares is not known", () => {
		expect(isKnownPresetSlug("totally-made-up")).toBe(false)
		expect(isKnownPresetSlug("")).toBe(false)
	})
})

describe("a slug's home type is derived from membership", () => {
	test("every preset-offered slug is an openai-chat preset", () => {
		for (const p of OPENAI_CHAT_PRESETS) {
			const slug = (p as { slug?: string }).slug
			if (slug) expect(presetHomeType(slug)).toBe(OPENAI)
		}
	})

	test("a slug no preset offers has NO declared home — not a guessed one", () => {
		// null is "nothing says", which is what keeps `anthropic` from being
		// judged against a type nobody has assigned it to yet.
		expect(presetHomeType("anthropic")).toBeNull()
	})
})

describe("normalizeConnectionPreset", () => {
	test("says nothing about a payload that said nothing", () => {
		// The distinction a partial update depends on: `undefined` must not
		// become `null`, or `{id, name}` would clear a good preset.
		expect(normalizeConnectionPreset(undefined, OPENAI)).toEqual({})
	})

	test("null and empty string are both an explicit `custom`", () => {
		expect(normalizeConnectionPreset(null, OPENAI)).toEqual({
			preset: null
		})
		expect(normalizeConnectionPreset("", OPENAI)).toEqual({ preset: null })
		// Saying "custom" discards nothing, so it earns no notice.
		expect(normalizeConnectionPreset(null, OPENAI).notice).toBeUndefined()
	})

	test("keeps a real slug on the type it belongs to", () => {
		expect(normalizeConnectionPreset("openrouter", OPENAI)).toEqual({
			preset: "openrouter"
		})
	})

	test("drops a NUMERIC preset — the picker's display-order `value`", () => {
		// The exact confusion the column's docblock warns about: `3` is
		// OpenRouter's ordering integer, keys nothing in PRESET_CAPABILITIES,
		// and would read like a real slug forever after.
		const res = normalizeConnectionPreset(3, OPENAI)
		expect(res.preset).toBeNull()
		expect(res.notice).toMatch(/number/i)
	})

	test("drops other non-string garbage the same way", () => {
		for (const junk of [true, {}, [], 0]) {
			const res = normalizeConnectionPreset(junk, OPENAI)
			expect(res.preset).toBeNull()
			expect(res.notice).toBeTruthy()
		}
	})

	test("drops a string that is not a slug this build knows", () => {
		const res = normalizeConnectionPreset("not-a-real-service", OPENAI)
		expect(res.preset).toBeNull()
		expect(res.notice).toContain("not-a-real-service")
	})

	test("a very long junk slug is truncated rather than echoed whole", () => {
		const res = normalizeConnectionPreset("x".repeat(500), OPENAI)
		expect(res.preset).toBeNull()
		expect(res.notice!.length).toBeLessThan(300)
	})

	test("drops a slug whose home type is not the type the row will have", () => {
		// The edit form can change `type` while carrying the old `preset`, which
		// is how an `openrouter` slug ends up on an `anthropic` row.
		const res = normalizeConnectionPreset(
			"openrouter",
			CONNECTION_TYPE.ANTHROPIC
		)
		expect(res.preset).toBeNull()
		// Names the preset by its human label, not its slug — the sentence has
		// to be readable by whoever picked it.
		expect(res.notice).toContain("OpenRouter")
	})

	test("does NOT judge a slug with no declared home against any type", () => {
		// `anthropic` is kept for a plan that has not landed; nothing declares
		// which API it names, so nothing here invents one.
		expect(
			normalizeConnectionPreset("anthropic", CONNECTION_TYPE.ANTHROPIC)
		).toEqual({ preset: "anthropic" })
		expect(normalizeConnectionPreset("anthropic", OPENAI)).toEqual({
			preset: "anthropic"
		})
	})

	test("keeps a real slug when the type is unknown to the caller", () => {
		// A row that could not be read has no type to judge against; refusing
		// on that basis would discard a good slug over a missing fact.
		expect(normalizeConnectionPreset("groq", undefined)).toEqual({
			preset: "groq"
		})
	})
})
