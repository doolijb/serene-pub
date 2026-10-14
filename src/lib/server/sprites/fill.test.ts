/**
 * 🚧 The Sprite set fill's pure half (I5): the series a fill asks for, the
 * *Sprite label phrases* row as read, and the labels a fill draws by default.
 */
import { describe, expect, test } from "vitest"
import { CORE_PROMPTS } from "@serene-pub/core-catalog"
import { STANDARD_SPRITE_LABELS } from "$lib/shared/sprites"
import {
	allSpriteLabels,
	buildSpriteSeries,
	emptySpriteLabels,
	parseLabelPhrases
} from "./fill"

const sprite = (label: string, withPicture: boolean, id = Math.random()) => ({
	id,
	label,
	position: 0,
	source: "upload" as const,
	media: withPicture ? { id: 1, uuid: "u", rev: 0, frame: null } : null
})

describe("build-sprite-series", () => {
	test("keys are filename-safe and unique; the card's spelling rides in vars", () => {
		const { series, labels } = buildSpriteSeries({
			labels: ["Joy", "swimsuit (wet)", "joy ", "", "Big  Smile", "big smile!"],
			likeness: "red hair",
			likenessNegative: "hat"
		})
		expect(labels).toEqual(["joy", "swimsuit (wet)", "big smile", "big smile!"])
		expect(series.map((i) => i.key)).toEqual([
			"joy",
			"swimsuit-wet",
			"big-smile",
			"big-smile-2"
		])
		expect(series[1].vars).toMatchObject({
			label: "swimsuit (wet)",
			likeness: "red hair",
			likenessNegative: "hat"
		})
	})

	test("a label's phrase comes from the row; an unknown label falls back to its word", () => {
		const { series } = buildSpriteSeries({
			labels: ["joy", "smug"],
			phrases: "joy: smiling warmly\nnot a line\n: empty\nJOY: grinning"
		})
		expect(series[0]?.vars?.labelPhrase).toBe("grinning")
		expect(series[1]?.vars?.labelPhrase).toBe("smug")
	})

	test("the shipped Sprite label phrases cover every standard label", () => {
		const row = CORE_PROMPTS.find((p) =>
			p.seedKey.endsWith(":sprite-label-phrases")
		)!
		const phrases = parseLabelPhrases(row.fields.phrases)
		for (const label of STANDARD_SPRITE_LABELS) expect(phrases.get(label)).toBeTruthy()
	})
})

describe("which labels a fill draws", () => {
	test("by default every label with no picture — a filled label is not empty", () => {
		const set = {
			sprites: [
				sprite("joy", true),
				sprite("joy", false),
				sprite("anger", false),
				sprite("fear", false)
			]
		}
		expect(emptySpriteLabels(set)).toEqual(["anger", "fear"])
		expect(allSpriteLabels(set)).toEqual(["anger", "fear", "joy"])
		expect(emptySpriteLabels(null)).toEqual([])
	})
})
