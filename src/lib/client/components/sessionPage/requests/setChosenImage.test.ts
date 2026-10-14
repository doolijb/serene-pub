/**
 * `set-chosen-image` (F2 — W6 ruling 1): core's Scene Portraits chooses a
 * member's face image, written into the ASKING instance's own settings with
 * every other member's choice kept; null takes the choice away. A member not
 * in the cast, a malformed ref, or an instance with no chosen images is
 * refused in words, and nothing is written.
 */
import { describe, expect, it, vi } from "vitest"
import type { SessionCharactersV1 } from "@serene-pub/sdk"
import { answerSetChosenImage, type InstanceSettings } from "./setChosenImage"

const member = (characterId: number, isPersona = false) => ({
	ref: `character:${characterId}` as const,
	characterId,
	isPersona,
	mine: isPersona,
	name: `M${characterId}`,
	face: null,
	sprite: null,
	spriteSets: [],
	spriteSet: null,
	canChangeSpriteSet: false
})

const cast: SessionCharactersV1 = {
	members: [member(3), member(9, true)],
	sceneImages: { left: null, right: null }
}

function store(stored: Record<string, Record<string, unknown>>) {
	const patches: Array<[string, Record<string, unknown>]> = []
	const settings: InstanceSettings = {
		declares: (id, key) =>
			id.startsWith("scene-portraits") && key === "chosenImages",
		values: (id) => stored[id] ?? {},
		patch: (id, patch) => patches.push([id, patch])
	}
	return { settings, patches }
}

const from = (widgetId: string) => ({ widgetId })

describe("answerSetChosenImage", () => {
	it("sets the member's pair on the asking instance, keeping the others' in order", () => {
		const { settings, patches } = store({
			"scene-portraits#2": {
				chosenImages: ["character:3=u-1", "character:9=u-7"]
			}
		})
		answerSetChosenImage(
			{ characterRef: "character:3", mediaRef: "u-2" },
			from("scene-portraits#2"),
			{ characters: () => cast, settings }
		)
		expect(patches).toEqual([
			[
				"scene-portraits#2",
				{ chosenImages: ["character:9=u-7", "character:3=u-2"] }
			]
		])
	})

	it("a first choice on an instance with nothing stored; a persona is a member too", () => {
		const { settings, patches } = store({})
		answerSetChosenImage(
			{ characterRef: "character:9", mediaRef: " u-5 " },
			from("scene-portraits"),
			{ characters: () => cast, settings }
		)
		expect(patches).toEqual([
			["scene-portraits", { chosenImages: ["character:9=u-5"] }]
		])
	})

	it("null takes the member's choice away", () => {
		const { settings, patches } = store({
			"scene-portraits": {
				chosenImages: ["character:3=u-1", "character:9=u-7"]
			}
		})
		answerSetChosenImage(
			{ characterRef: "character:3", mediaRef: null },
			from("scene-portraits"),
			{ characters: () => cast, settings }
		)
		expect(patches).toEqual([
			["scene-portraits", { chosenImages: ["character:9=u-7"] }]
		])
	})

	it("refuses, and writes nothing, for anyone not in the cast, a bad ref, before the cast, or another widget", () => {
		const { settings, patches } = store({})
		const deps = { characters: () => cast, settings }
		const ask = (
			characterRef: unknown,
			mediaRef: unknown,
			widgetId = "scene-portraits"
		) =>
			answerSetChosenImage(
				{ characterRef, mediaRef } as never,
				from(widgetId),
				deps
			)
		expect(() => ask("character:4", "u-1")).toThrow("not in this session")
		expect(() => ask("persona:9", "u-1")).toThrow("character:<id>")
		expect(() => ask(3, "u-1")).toThrow("character:<id>")
		expect(() => ask("character:3", "")).toThrow("an image's ref")
		expect(() => ask("character:3", "a=b")).toThrow("an image's ref")
		expect(() => ask("character:3", 7)).toThrow("an image's ref")
		expect(() => ask("character:3", "u-1", "stats")).toThrow(
			"keeps no chosen images"
		)
		const before = vi.fn(() => undefined)
		expect(() =>
			answerSetChosenImage(
				{ characterRef: "character:3", mediaRef: "u-1" },
				from("scene-portraits"),
				{ characters: before, settings }
			)
		).toThrow("has not arrived")
		expect(patches).toEqual([])
	})
})
