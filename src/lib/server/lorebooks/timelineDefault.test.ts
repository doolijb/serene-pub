/** 🚧 `timelineDefaultFor`: the Timeline default of a new session's own notes. */
import { describe, expect, test } from "vitest"
import { timelineDefaultFor } from "./timeline"

const story = { keepsTime: "story" }
const real = { keepsTime: "real" }
const required = { timeline: "required", keepsTime: "story" }
const preset = (timeline: unknown) => ({ defaults: { timeline } })

describe("timelineDefaultFor", () => {
	test.each([
		["an unresolved genre, preset false", null, preset(false), true],
		["an undefined genre, no preset", undefined, null, true],
		["a required genre, preset false", required, preset(false), true],
		["a required genre, preset true", required, preset(true), true],
		["a required genre that keeps real time, preset false", { timeline: "required", keepsTime: "real" }, preset(false), true],
		["a story genre, preset false", story, preset(false), false],
		["a story genre, preset true", story, preset(true), true],
		["a story genre, nothing", story, null, true],
		["a story genre, a preset with no defaults", story, {}, true],
		["a real genre, nothing", real, null, false],
		["a real genre, preset true", real, preset(true), true],
		["a real genre, preset false", real, preset(false), false],
		["no keepsTime, nothing", {}, null, false],
		["a story genre, a non-boolean preset value", story, preset("no"), true],
		["a real genre, a non-boolean preset value", real, preset(1), false],
		["a story genre, null defaults", story, { defaults: null }, true]
	])("%s", (_name, genre, p, want) => {
		expect(timelineDefaultFor(genre as any, p as any)).toBe(want)
	})
})
