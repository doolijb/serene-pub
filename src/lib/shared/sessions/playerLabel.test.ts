/**
 * `playerLabel` precedence (lair re-plan R4): the session's own value, else
 * the genre's, else absent — and absent whenever the genre declares none,
 * whatever the session row holds.
 */
import { describe, expect, it } from "vitest"
import {
	PLAYER_LABEL_METADATA_KEY,
	resolvePlayerLabel,
	storedPlayerLabel
} from "./playerLabel"

describe("resolvePlayerLabel", () => {
	it("is the genre's when the session says nothing", () => {
		expect(resolvePlayerLabel({ declared: "Dungeon Master" })).toBe(
			"Dungeon Master"
		)
	})

	it("is the session's override when it has one", () => {
		expect(
			resolvePlayerLabel({ declared: "Dungeon Master", stored: "Game Master" })
		).toBe("Game Master")
	})

	it("falls back to the genre's for a blank override", () => {
		expect(
			resolvePlayerLabel({ declared: "Dungeon Master", stored: "   " })
		).toBe("Dungeon Master")
	})

	it("is absent for a genre that declares none, even with a stored value", () => {
		expect(resolvePlayerLabel({ stored: "Game Master" })).toBeUndefined()
		expect(resolvePlayerLabel({ declared: " " })).toBeUndefined()
	})
})

describe("storedPlayerLabel", () => {
	it("reads the override off the session's metadata, trimmed", () => {
		expect(
			storedPlayerLabel({ [PLAYER_LABEL_METADATA_KEY]: "  Game Master " })
		).toBe("Game Master")
	})

	it("is null for no metadata, no key, a blank or a non-string", () => {
		expect(storedPlayerLabel(null)).toBeNull()
		expect(storedPlayerLabel({})).toBeNull()
		expect(storedPlayerLabel({ [PLAYER_LABEL_METADATA_KEY]: "" })).toBeNull()
		expect(storedPlayerLabel({ [PLAYER_LABEL_METADATA_KEY]: 3 })).toBeNull()
	})
})
