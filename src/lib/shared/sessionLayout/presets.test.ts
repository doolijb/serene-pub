/**
 * The two rules both halves of the preset system agree on: the seed key a
 * shipped default is matched by, and how a preset composes into the read-only
 * base the surface manager reads through.
 *
 * The `undefined`-for-empty property is the compatibility guarantee in
 * miniature — the shipped default carries `layout: {}`, so a user who has
 * never picked a preset gets no base at all and the manager's slots stay
 * exactly as they were before presets existed.
 */
import { describe, expect, it } from "vitest"
import {
	DEFAULT_PRESET_NAME,
	layoutPresetSeedKey,
	presetBase,
	presetWidgetSettings
} from "./presets"

describe("layoutPresetSeedKey", () => {
	it("is derived from the genre id, not a numeric id", () => {
		expect(layoutPresetSeedKey("core:genre/chat")).toBe(
			"layout:core:genre/chat:default"
		)
	})

	it("is stable across calls and distinct per genre", () => {
		expect(layoutPresetSeedKey("core:genre/chat")).toBe(
			layoutPresetSeedKey("core:genre/chat")
		)
		expect(layoutPresetSeedKey("plugin:genre/vn")).not.toBe(
			layoutPresetSeedKey("core:genre/chat")
		)
	})

	it("names the shipped default", () => {
		expect(DEFAULT_PRESET_NAME).toBe("Default")
	})
})

describe("presetBase", () => {
	it("returns undefined for the shipped default's empty layout", () => {
		expect(presetBase({})).toBeUndefined()
		expect(presetBase({}, {})).toBeUndefined()
	})

	it("returns undefined when nothing is supplied at all", () => {
		expect(presetBase(undefined)).toBeUndefined()
		expect(presetBase(null, null)).toBeUndefined()
	})

	it("treats a non-object blob as absent rather than throwing", () => {
		expect(presetBase("nope" as unknown)).toBeUndefined()
		expect(presetBase([1, 2, 3] as unknown)).toBeUndefined()
		expect(presetBase(7 as unknown, "x" as unknown)).toBeUndefined()
	})

	it("passes a real preset layout through", () => {
		const layout = { zoneLayout: { version: 1 }, widgetGrid: { version: 1 } }
		expect(presetBase(layout)).toEqual(layout)
	})

	it("merges layoutSettings OVER the preset (the user's own wins)", () => {
		expect(
			presetBase({ zoneLayout: "preset", a: 1 }, { zoneLayout: "mine" })
		).toEqual({ zoneLayout: "mine", a: 1 })
	})

	it("keeps a settings-only base when the preset is empty", () => {
		expect(presetBase({}, { "scene-portraits": { bg: "x" } })).toEqual({
			"scene-portraits": { bg: "x" }
		})
	})

	it("does not mutate either input", () => {
		const preset = { a: 1 }
		const settings = { b: 2 }
		presetBase(preset, settings)
		expect(preset).toEqual({ a: 1 })
		expect(settings).toEqual({ b: 2 })
	})
})

describe("presetWidgetSettings", () => {
	it("reads the settings the preset pins", () => {
		expect(
			presetWidgetSettings(
				{ widgetSettings: { "scene-portraits": { source: "scene" } } },
				{}
			)
		).toEqual({ "scene-portraits": { source: "scene" } })
	})

	it("puts the user's own value over the preset's, field by field", () => {
		expect(
			presetWidgetSettings(
				{
					widgetSettings: {
						"scene-portraits": { source: "scene", bars: true }
					}
				},
				{ "scene-portraits": { bars: false } }
			)
		).toEqual({ "scene-portraits": { source: "scene", bars: false } })
	})

	it("keeps a widget only the user has settings for", () => {
		expect(
			presetWidgetSettings(
				{ widgetSettings: { stats: { density: "compact" } } },
				{ inventory: { groupBy: "item" } }
			)
		).toEqual({
			stats: { density: "compact" },
			inventory: { groupBy: "item" }
		})
	})

	it("treats a non-object blob on either side as absent", () => {
		expect(presetWidgetSettings(undefined, undefined)).toEqual({})
		expect(presetWidgetSettings({ widgetSettings: 7 }, "no")).toEqual({})
		expect(
			presetWidgetSettings({ widgetSettings: { stats: 3 } }, null)
		).toEqual({})
	})

	it("does not mutate either input", () => {
		const preset = { widgetSettings: { stats: { density: "full" } } }
		const user = { stats: { density: "compact" } }
		presetWidgetSettings(preset, user)
		expect(preset.widgetSettings.stats).toEqual({ density: "full" })
		expect(user.stats).toEqual({ density: "compact" })
	})
})
