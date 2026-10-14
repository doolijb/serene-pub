/** 🚧 A session's scene settings (live scenes §4–§5): the override on `metadata.scenes`, and the chip's words. */
import { describe, expect, test } from "vitest"
import { DEFAULT_SCENE_SETTINGS } from "@serene-pub/sdk"
import {
	sameSceneSettings,
	sceneCueReason,
	sessionSceneSettings,
	storedSceneSettings
} from "./sceneSettings"

describe("storedSceneSettings", () => {
	test("reads the override that reads, and nothing else", () => {
		expect(storedSceneSettings({ scenes: { mode: "manual" } })).toEqual({ mode: "manual" })
		expect(storedSceneSettings({ scenes: { mode: "often" } })).toBeNull()
		expect(storedSceneSettings({ playerLabel: "DM" })).toBeNull()
		expect(storedSceneSettings(null)).toBeNull()
		expect(storedSceneSettings([])).toBeNull()
	})
})

describe("sessionSceneSettings", () => {
	test("the session's override over the genre's over the defaults", () => {
		expect(sessionSceneSettings(undefined, {})).toEqual(DEFAULT_SCENE_SETTINGS)
		const genre = { scenes: { mode: "automatic", summary: "onClose" } }
		expect(sessionSceneSettings(genre, {})).toMatchObject({ mode: "automatic", summary: "onClose" })
		expect(sessionSceneSettings(genre, { scenes: { summary: "never" } })).toMatchObject({
			mode: "automatic",
			summary: "never"
		})
		expect(sameSceneSettings(sessionSceneSettings(genre, {}), sessionSceneSettings(genre, { scenes: {} }))).toBe(true)
	})
})

describe("sceneCueReason", () => {
	test("each trigger's words, joined, in the order they fired", () => {
		expect(sceneCueReason(["dayCrossed"])).toBe("the day changed")
		expect(sceneCueReason(["dayCrossed", "timeAction"])).toBe("the day changed · time passed")
		expect(sceneCueReason(["acme.sanctum"])).toBe("acme.sanctum")
	})
})
