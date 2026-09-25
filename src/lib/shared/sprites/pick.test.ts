import { describe, expect, test } from "vitest"
import { cosine, pickSpriteBySimilarity } from "./pick"
import {
	nextSpriteMetadata,
	normalizeSpriteName,
	resolveSpriteFallback,
	spriteLabelFromFilename
} from "./index"

/** Unit vectors along axes: label i ↔ axis i; the line mixes them. */
const axis = (i: number, n = 4) => Array.from({ length: n }, (_, k) => (k === i ? 1 : 0))
const mix = (weights: number[]) => weights

const labels = ["anger", "joy", "neutral", "sadness"]
const labelVectors = labels.map((_, i) => axis(i))

describe("pickSpriteBySimilarity", () => {
	test("picks the closest label", () => {
		const pick = pickSpriteBySimilarity(
			{ set: "default", labels, last: null },
			mix([0.1, 0.9, 0.1, 0]),
			labelVectors
		)
		expect(pick).toMatchObject({ set: "default", label: "joy" })
		expect(pick?.runnerUp?.label).toBeDefined()
	})

	test("stickiness keeps the last face unless the best beats it by the margin", () => {
		const held = pickSpriteBySimilarity(
			{ set: "default", labels, last: { set: "default", label: "sadness" } },
			mix([0, 0.52, 0, 0.5]),
			labelVectors,
			{ margin: 0.05 }
		)
		expect(held).toMatchObject({ label: "sadness", held: true })
		const moved = pickSpriteBySimilarity(
			{ set: "default", labels, last: { set: "default", label: "sadness" } },
			mix([0, 0.8, 0, 0.3]),
			labelVectors,
			{ margin: 0.05 }
		)
		expect(moved).toMatchObject({ label: "joy" })
		expect(moved?.held).toBeUndefined()
	})

	test("a last sprite from another set does not stick", () => {
		const pick = pickSpriteBySimilarity(
			{ set: "armour", labels, last: { set: "default", label: "sadness" } },
			mix([0, 0.52, 0, 0.5]),
			labelVectors
		)
		expect(pick?.label).toBe("joy")
	})

	test("below the floor: the last face, else neutral", () => {
		const weak = mix([0.01, 0.02, 0.01, 0.01, 1])
		const vectors5 = labels.map((_, i) => axis(i, 5))
		expect(
			pickSpriteBySimilarity(
				{ set: "d", labels, last: { set: "d", label: "anger" } },
				weak,
				vectors5
			)
		).toMatchObject({ label: "anger", held: true })
		expect(
			pickSpriteBySimilarity({ set: "d", labels, last: null }, weak, vectors5)
		).toMatchObject({ label: "neutral", held: true })
		expect(
			pickSpriteBySimilarity(
				{ set: "d", labels: ["anger", "joy"], last: null },
				weak,
				[axis(0, 5), axis(1, 5)]
			)
		).toBeNull()
	})

	test("recency penalises repeats, but never the last label", () => {
		const line = mix([0.5, 0.5, 0, 0])
		const pick = pickSpriteBySimilarity(
			{ set: "d", labels, last: null, recent: ["anger"] },
			line,
			labelVectors,
			{ recency: 0.1 }
		)
		expect(pick?.label).toBe("joy")
	})

	test("no vectors, a length mismatch or no labels: no pick", () => {
		const c = { set: "d", labels, last: null }
		expect(pickSpriteBySimilarity(c, null, labelVectors)).toBeNull()
		expect(pickSpriteBySimilarity(c, axis(1), [])).toBeNull()
		expect(pickSpriteBySimilarity({ ...c, labels: [] }, axis(1), [])).toBeNull()
		expect(pickSpriteBySimilarity({ ...c, set: null }, axis(1), labelVectors)).toBeNull()
	})

	test("cosine of orthogonal and parallel vectors", () => {
		expect(cosine([1, 0], [0, 1])).toBe(0)
		expect(cosine([2, 0], [5, 0])).toBeCloseTo(1)
		expect(cosine([0, 0], [1, 1])).toBe(0)
	})
})

describe("sprite names", () => {
	test("normalise: trim, collapse, fold case, cap", () => {
		expect(normalizeSpriteName("  Swimsuit   (Wet) ")).toBe("swimsuit (wet)")
		expect(normalizeSpriteName(42)).toBe("")
		expect(normalizeSpriteName("x".repeat(100))).toHaveLength(64)
	})
	test("SillyTavern filenames: label up to the first - or .", () => {
		expect(spriteLabelFromFilename("joy.png")).toBe("joy")
		expect(spriteLabelFromFilename("Joy-2.webp")).toBe("joy")
		expect(spriteLabelFromFilename("sprites/armour/anger.1.png")).toBe("anger")
	})
	test("fallback order: the set wins over the label", () => {
		const has = new Set(["armour/stern", "armour/neutral", "default/joy", "default/neutral"])
		const h = (s: string, l: string) => has.has(`${s}/${l}`)
		// In the set: itself.
		expect(resolveSpriteFallback({ set: "armour", label: "stern" }, "default", h)).toEqual({ set: "armour", label: "stern" })
		// Not in the set: the SET's neutral, not the default set's joy.
		expect(resolveSpriteFallback({ set: "armour", label: "joy" }, "default", h)).toEqual({ set: "armour", label: "neutral" })
		// A set with neither: the label in the default set, then its neutral.
		expect(resolveSpriteFallback({ set: "night", label: "joy" }, "default", h)).toEqual({ set: "default", label: "joy" })
		expect(resolveSpriteFallback({ set: "night", label: "anger" }, "default", h)).toEqual({ set: "default", label: "neutral" })
		expect(resolveSpriteFallback({ set: "x", label: "y" }, "z", () => false)).toBeNull()
	})
})


describe("nextSpriteMetadata (show-sprite's one rule)", () => {
	const pick = { set: "Default", label: "Joy" }

	test("writes the active swipe and mirrors metadata.sprite", () => {
		const r = nextSpriteMetadata(
			{ swipes: { currentIdx: 1, history: ["a", "b", "c"] } },
			pick,
			false
		)
		expect(r.kept).toBe(false)
		if (r.kept) return
		expect(r.metadata.sprite).toEqual({ set: "default", label: "joy", source: "picker" })
		expect(r.metadata.swipes.spriteHistory).toEqual([
			null,
			{ set: "default", label: "joy", source: "picker" },
			null
		])
	})

	test("a picker never overwrites a person's pick; a person may", () => {
		const meta = { sprite: { set: "default", label: "anger", source: "person" } }
		expect(nextSpriteMetadata(meta, pick, false)).toEqual({
			kept: true,
			sprite: meta.sprite
		})
		const byPerson = nextSpriteMetadata(meta, pick, true)
		expect(byPerson.kept).toBe(false)
		expect(byPerson.sprite).toMatchObject({ label: "joy", source: "person" })
	})

	test("no pick on a faceless line is no write; no pick on a picked line clears it", () => {
		expect(nextSpriteMetadata({}, null, false)).toEqual({ kept: true, sprite: null })
		const cleared = nextSpriteMetadata(
			{ sprite: { set: "d", label: "joy", source: "picker" } },
			null,
			false
		)
		expect(cleared.kept).toBe(false)
		expect(cleared.sprite).toBeNull()
	})

	test("the same sprite again is no write; junk picks clear", () => {
		const meta = { sprite: { set: "default", label: "joy", source: "picker" } }
		expect(nextSpriteMetadata(meta, pick, false).kept).toBe(true)
		const junk = nextSpriteMetadata(meta, { set: 3, label: "" }, false)
		expect(junk.sprite).toBeNull()
	})
})
