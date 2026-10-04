/**
 * What the server and the client agree on about session layout presets
 * without a database: the seed keys core's shipped rows are matched by, and
 * which genres core seeds. There is no composition rule to test any more —
 * under the copy model nothing is layered over a session's layout (brief 3 of
 * `PLAN-layout-one-format-2026-09-28`).
 */
import { describe, expect, it } from "vitest"
import * as presets from "./presets"
import {
	DEFAULT_PRESET_NAME,
	coreLayoutSeedKey,
	isCoreGenre,
	layoutPresetSeedKey
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

describe("coreLayoutSeedKey", () => {
	it("keeps the genre default layout's key for `default`", () => {
		expect(coreLayoutSeedKey("core:genre/adventure", "default")).toBe(
			layoutPresetSeedKey("core:genre/adventure")
		)
	})

	it("namespaces every other slug under core", () => {
		expect(coreLayoutSeedKey("core:genre/adventure", "cinematic")).toBe(
			"layout:core:genre/adventure:core/cinematic"
		)
	})
})

describe("isCoreGenre", () => {
	it("is core's own namespace only", () => {
		expect(isCoreGenre("core:genre/chat")).toBe(true)
		expect(isCoreGenre("showcase.battleship:genre/battleship")).toBe(false)
	})
})

describe("the copy model", () => {
	it("leaves no layering helper behind", () => {
		expect("presetBase" in presets).toBe(false)
		expect("presetWidgetSettings" in presets).toBe(false)
	})
})
