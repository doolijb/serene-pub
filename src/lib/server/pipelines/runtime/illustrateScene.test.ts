/**
 * 🚧 The Scene action's two pure steps (I9): the clean step that turns a
 * text model's reply into one prompt line, and the placement decision.
 */
import { describe, expect, it } from "vitest"
import { cleanImagePrompt, picturePlacement } from "./illustrateScene"

describe("cleanImagePrompt", () => {
	it("leaves a clean tag line alone", () => {
		expect(cleanImagePrompt("harbor, dawn, fog")).toBe("harbor, dawn, fog")
	})

	it("drops a fence, a label, wrapping quotes and a trailing full stop", () => {
		expect(cleanImagePrompt('```text\nPrompt: "harbor, dawn, fog."\n```')).toBe(
			"harbor, dawn, fog"
		)
		expect(cleanImagePrompt("Image prompt - “harbor, dawn”")).toBe("harbor, dawn")
		expect(cleanImagePrompt(`"'harbor'"`)).toBe("harbor")
	})

	it("turns lines and bullets into commas, and collapses empty tags", () => {
		expect(cleanImagePrompt("- harbor\n* dawn\n\n1. fog,, ,\n2) gulls")).toBe(
			"harbor, dawn, fog, gulls"
		)
	})

	it("keeps prose as prose: a line ending a sentence runs on with a space", () => {
		expect(cleanImagePrompt("A harbor at dawn.\nFog lies on the water.")).toBe(
			"A harbor at dawn. Fog lies on the water"
		)
	})

	it("is empty for nothing", () => {
		expect(cleanImagePrompt("")).toBe("")
		expect(cleanImagePrompt('  ""  ')).toBe("")
		expect(cleanImagePrompt(undefined)).toBe("")
	})
})

describe("picturePlacement", () => {
	it("defaults to both", () => {
		expect(picturePlacement(undefined, undefined)).toEqual({
			placement: "both",
			message: true,
			backdrop: true
		})
	})

	it("follows the parameter", () => {
		expect(picturePlacement(null, "message")).toEqual({
			placement: "message",
			message: true,
			backdrop: false
		})
	})

	it("lets the press's payload win, and ignores a value that is not one of the three", () => {
		expect(picturePlacement({ placement: "backdrop" }, "message").placement).toBe(
			"backdrop"
		)
		expect(picturePlacement({ placement: "wall" }, "message").placement).toBe("message")
		expect(picturePlacement({ placement: "both" }, "nonsense").placement).toBe("both")
	})
})

describe("the Backdrop widget's Illustrate", () => {
	it("names the Scene action the spec declares", async () => {
		const { STORY_ILLUSTRATE_SCENE_SPEC_ID, ILLUSTRATE_SCENE_ACTION_KEY } = await import(
			"@serene-pub/core-catalog"
		)
		const { BACKDROP_ILLUSTRATE_ACTION, illustrateActionOf } = await import(
			"@serene-pub/core-catalog/backdrop"
		)
		expect(BACKDROP_ILLUSTRATE_ACTION).toBe(
			`${STORY_ILLUSTRATE_SCENE_SPEC_ID}#${ILLUSTRATE_SCENE_ACTION_KEY}`
		)
		const listed = (canAct: boolean, specSlug = STORY_ILLUSTRATE_SCENE_SPEC_ID) =>
			({
				composer: {
					primary: [{ specSlug, key: ILLUSTRATE_SCENE_ACTION_KEY, canAct }],
					overflow: []
				}
			}) as any
		expect(illustrateActionOf(listed(true))).toEqual({
			identity: BACKDROP_ILLUSTRATE_ACTION,
			disabled: false
		})
		expect(illustrateActionOf(listed(false))?.disabled).toBe(true)
		expect(illustrateActionOf(listed(true, "core:spec/other"))).toBeNull()
		// Story's Scene (was Adventure's, §16 follow-up D3): the same spec, the same key.
		expect(illustrateActionOf(listed(true, STORY_ILLUSTRATE_SCENE_SPEC_ID))).toEqual({
			identity: `${STORY_ILLUSTRATE_SCENE_SPEC_ID}#${ILLUSTRATE_SCENE_ACTION_KEY}`,
			disabled: false
		})
		expect(illustrateActionOf(undefined)).toBeNull()
	})
})
