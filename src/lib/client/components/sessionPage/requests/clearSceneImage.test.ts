/**
 * `clear-scene-image` clears the PAGE's own pin (R77, F10) — the one the page
 * persists, mirrors and projects — and refuses a side that does not exist.
 */
import { describe, expect, test } from "vitest"
import { answerClearSceneImage } from "./clearSceneImage"
import { projectCharacters } from "../projections/characters"

describe("answerClearSceneImage", () => {
	test("clears the page's pin on that side, and the projection the widget reads follows", () => {
		const pins = { left: "/media/1" as string | null, right: "/media/2" as string | null }
		const page = {
			clear: (side: "left" | "right") => {
				pins[side] = null
			}
		}
		answerClearSceneImage({ side: "left" }, page)
		expect(pins).toEqual({ left: null, right: "/media/2" })
		// The widget reads the page's pins, so it can never show one the page dropped.
		expect(projectCharacters({ session: null, viewerUserId: null, sceneImages: pins }).sceneImages).toEqual({
			left: null,
			right: { src: "/media/2", ref: null }
		})
		// An empty side is cleared already, not an error.
		answerClearSceneImage({ side: "left" }, page)
		expect(pins.left).toBeNull()
	})

	test.each([{ side: "top" }, {}, null])("refuses %j in words, clearing nothing", (params) => {
		const cleared: string[] = []
		expect(() => answerClearSceneImage(params, { clear: (s) => cleared.push(s) })).toThrow(
			"clear-scene-image clears the 'left' or the 'right' portrait"
		)
		expect(cleared).toEqual([])
	})
})
