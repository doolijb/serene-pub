/**
 * Which rows of the shipped Default stop holding when its default preset
 * changes across a version (owner ruling 2026-10-11). The pure half of
 * `followDefaultPreset`; the database half is in `named.int.test.ts`.
 */

import { describe, expect, it } from "vitest"
import { rowsToDropOnPresetChange } from "./deviations"

const at = (nodeKey: string, slot: string, path: string, value: unknown) => ({
	nodeKey,
	slot,
	path,
	value
})

describe("rowsToDropOnPresetChange", () => {
	it("drops a row still holding the old preset's value when the new preset sets nothing there", () => {
		// The image action, 1.0.0 to 1.1.0: review was the default preset's
		// one value, and 1.1.0 ships no default preset.
		const row = { id: 1, ...at("render", "settings", "review", "on") }
		expect(
			rowsToDropOnPresetChange(
				[at("render", "settings", "review", "on")],
				[],
				[row]
			)
		).toEqual([row])
	})

	it("drops a row still holding the old preset's value when the new preset sets another", () => {
		const row = { id: 1, ...at("history", "params", "limit", 50) }
		expect(
			rowsToDropOnPresetChange(
				[at("history", "params", "limit", 50)],
				[at("history", "params", "limit", 75)],
				[row]
			)
		).toEqual([row])
	})

	it("keeps a row somebody changed away from the old preset's value", () => {
		expect(
			rowsToDropOnPresetChange(
				[at("render", "settings", "review", "on")],
				[],
				[{ id: 1, ...at("render", "settings", "review", "always") }]
			)
		).toEqual([])
	})

	it("keeps a row the new preset still sets to the same value", () => {
		expect(
			rowsToDropOnPresetChange(
				[at("prompt", "params", "postHistoryTokenTrigger", 3000)],
				[at("prompt", "params", "postHistoryTokenTrigger", 3000)],
				[
					{
						id: 1,
						...at(
							"prompt",
							"params",
							"postHistoryTokenTrigger",
							3000
						)
					}
				]
			)
		).toEqual([])
	})

	it("keeps a row at an address the old preset never set", () => {
		expect(
			rowsToDropOnPresetChange(
				[at("render", "settings", "review", "on")],
				[],
				[{ id: 1, ...at("history", "params", "limit", 50) }]
			)
		).toEqual([])
	})

	it("matches the whole address: the same value on a sibling node is kept", () => {
		expect(
			rowsToDropOnPresetChange(
				[at("render", "settings", "review", "on")],
				[],
				[{ id: 1, ...at("post", "settings", "review", "on") }]
			)
		).toEqual([])
	})

	it("compares objects structurally, so key order is not a change", () => {
		const row = {
			id: 1,
			...at("render", "template", "", { source: "x", engine: "y" })
		}
		expect(
			rowsToDropOnPresetChange(
				[at("render", "template", "", { engine: "y", source: "x" })],
				[],
				[row]
			)
		).toEqual([row])
	})

	it("reads an absent path as the whole slot", () => {
		const row = {
			id: 1,
			nodeKey: "render",
			slot: "template",
			path: null,
			value: 1
		}
		expect(
			rowsToDropOnPresetChange(
				[at("render", "template", "", 1)],
				[],
				[row]
			)
		).toEqual([row])
	})

	it("drops nothing when the old version shipped no preset", () => {
		expect(
			rowsToDropOnPresetChange(
				[],
				[at("render", "settings", "review", "on")],
				[{ id: 1, ...at("render", "settings", "review", "on") }]
			)
		).toEqual([])
	})
})
