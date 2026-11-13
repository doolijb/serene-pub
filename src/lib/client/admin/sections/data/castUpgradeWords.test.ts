import { describe, expect, test } from "vitest"
import {
	castLiftOverviewLine,
	castUpgradeDifferenceLine,
	castUpgradeMemberTitle,
	fieldsInWords,
	joinWords
} from "./castUpgradeWords"

const date = { year: 412, month: 3, day: 5 }

describe("castUpgradeWords", () => {
	test("joins with commas and and", () => {
		expect(joinWords(["a"])).toBe("a")
		expect(joinWords(["a", "b"])).toBe("a and b")
		expect(joinWords(["a", "b", "c"])).toBe("a, b and c")
	})

	test("fields in words: names, voice for timbre, face, once each", () => {
		expect(
			fieldsInWords([
				"exampleDialogues",
				"postHistoryInstructions",
				"creatorNotes",
				"faceMediaId",
				"timbre",
				"spriteSet",
				"greetings",
				"greetings"
			])
		).toBe(
			"example dialogues, post-history instructions, creator notes, face, voice, sprite set and greetings"
		)
	})

	test("the count line, singular and plural", () => {
		expect(castLiftOverviewLine(1)).toBe(
			"1 cast member reads differently since the upgrade"
		)
		expect(castLiftOverviewLine(3)).toBe(
			"3 cast members read differently since the upgrade"
		)
	})

	test("a member's title", () => {
		expect(castUpgradeMemberTitle("Bianca", "Porto Alto")).toBe(
			"Bianca in Porto Alto"
		)
	})

	test("a difference on main, from a date", () => {
		const line = castUpgradeDifferenceLine({
			branchId: null,
			line: "main",
			at: { kind: "date", date },
			appearance: null,
			fields: ["description", "greetings"]
		})
		expect(line).toMatch(
			/^On main, from .+, reads the description and greetings differently than before the upgrade\.$/
		)
		expect(line).not.toContain("life point")
	})

	test("a difference on another line, at a life point", () => {
		const line = castUpgradeDifferenceLine({
			branchId: 4,
			line: "The long road",
			at: { kind: "date", date },
			appearance: 34,
			fields: ["name"]
		})
		expect(line).toMatch(
			/^On The long road, from .+, at life point 34, reads the name /
		)
	})

	test("before the first change", () => {
		expect(
			castUpgradeDifferenceLine({
				branchId: null,
				line: "main",
				at: { kind: "before-first-change" },
				appearance: null,
				fields: ["summary"]
			})
		).toBe(
			"On main, before their first change, reads the summary differently than before the upgrade."
		)
	})
})
