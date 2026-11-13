/**
 * `speakerRefOf` in both modes of the flip (`state/memberForm.ts`): off, the
 * card form; on, the seat's own ref from the stamp (`metadata.speaker`),
 * ⏳ the card form where the row carries none.
 */
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { memberFormSwitch } from "$lib/server/state/memberForm"
import { speakerRefOf } from "./sessionChanges"

let was = false
beforeEach(() => {
	was = memberFormSwitch.on
})
afterEach(() => {
	memberFormSwitch.on = was
})

describe("speakerRefOf", () => {
	test("off: the card form, metadata ignored", () => {
		memberFormSwitch.on = false
		const metadata = { speaker: "seated-member:9" }
		expect(speakerRefOf({ personaId: 4, characterId: 5, metadata })).toBe(
			"character:4"
		)
		expect(speakerRefOf({ characterId: 5, metadata })).toBe("character:5")
		expect(
			speakerRefOf({ metadata: { speaker: "player-seat:2" } })
		).toBeNull()
		expect(speakerRefOf({})).toBeNull()
	})

	test("on: a persona line is its player seat, else the card", () => {
		memberFormSwitch.on = true
		expect(
			speakerRefOf({
				personaId: 4,
				metadata: { speaker: "player-seat:7" }
			})
		).toBe("player-seat:7")
		expect(speakerRefOf({ personaId: 4 })).toBe("character:4")
		expect(
			speakerRefOf({
				personaId: 4,
				metadata: { speaker: "seated-member:9" }
			})
		).toBe("character:4")
	})

	test("on: a card-less player seat's line is that seat", () => {
		memberFormSwitch.on = true
		expect(speakerRefOf({ metadata: { speaker: "player-seat:3" } })).toBe(
			"player-seat:3"
		)
	})

	test("on: a character line is its seated member, else the card; narration is nobody", () => {
		memberFormSwitch.on = true
		expect(
			speakerRefOf({
				characterId: 5,
				metadata: { speaker: "seated-member:9" }
			})
		).toBe("seated-member:9")
		expect(speakerRefOf({ characterId: 5 })).toBe("character:5")
		expect(
			speakerRefOf({
				isNarratorResponse: true,
				metadata: { speaker: "envoy:guide" }
			})
		).toBeNull()
		expect(speakerRefOf({})).toBeNull()
	})
})
