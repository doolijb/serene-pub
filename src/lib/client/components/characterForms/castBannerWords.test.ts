import { describe, expect, test } from "vitest"
import {
	castBannerWords,
	retoldFieldList,
	type CastBannerMember
} from "./castBannerWords"

function member(
	lorebookId: number,
	castId: number,
	retold: CastBannerMember["retold"] = []
): CastBannerMember {
	return { lorebookId, lorebookName: `Book ${lorebookId}`, castId, retold }
}

describe("castBannerWords", () => {
	test("no members, no banner", () => {
		expect(castBannerWords([])).toBeNull()
		expect(castBannerWords(undefined)).toBeNull()
		expect(castBannerWords(null)).toBeNull()
	})

	test("one member, nothing retold", () => {
		expect(castBannerWords([member(1, 10)])).toEqual({
			lead: "In 1 lorebook:",
			represents: "Represents 1 cast member in 1 lorebook.",
			retells: null
		})
	})

	test("one member retelling", () => {
		expect(castBannerWords([member(1, 10, ["face", "description"])])).toEqual({
			lead: "In 1 lorebook:",
			represents: "Represents 1 cast member in 1 lorebook.",
			retells: "It retells parts of this card: description, face."
		})
	})

	test("plural members and books, one retelling", () => {
		expect(
			castBannerWords([member(1, 10, ["description", "face"]), member(2, 20)])
		).toEqual({
			lead: "In 2 lorebooks:",
			represents: "Represents 2 cast members in 2 lorebooks.",
			retells: "1 of them retells parts of this card: description, face."
		})
	})

	test("two members in one book, both retelling, fields merged", () => {
		expect(
			castBannerWords([
				member(1, 10, ["firstMessage"]),
				member(1, 11, ["description", "firstMessage"])
			])
		).toEqual({
			lead: "In 1 lorebook:",
			represents: "Represents 2 cast members in 1 lorebook.",
			retells:
				"2 of them retell parts of this card: description, first message."
		})
	})
})

describe("retoldFieldList", () => {
	test("form order, unknown keys dropped", () => {
		expect(
			retoldFieldList(["face", "nope", "alternateGreetings", "scenario"])
		).toBe("scenario, alternate greetings, face")
	})
})
