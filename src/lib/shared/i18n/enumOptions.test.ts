import { describe, expect, test } from "vitest"
import { enumOptions, humanizeValue } from "./enumOptions"

describe("enum options read as words, never raw values", () => {
	test("a declared member label shows, its description rides as the hint", () => {
		const options = enumOptions({
			of: ["classic", "minimal"],
			members: [
				{
					key: "classic",
					label: { en: "Card" },
					description: "The full editor."
				}
			]
		})
		expect(options[0]).toEqual({
			value: "classic",
			label: "Card",
			hint: "The full editor."
		})
	})

	test("an undeclared option shows its humanised value", () => {
		expect(enumOptions({ of: ["oldest-first", "lastRead"] })).toEqual([
			{ value: "oldest-first", label: "Oldest first" },
			{ value: "lastRead", label: "Last read" }
		])
	})

	test("the stored value is unchanged, and members alone supply the keys", () => {
		const options = enumOptions({
			members: [{ key: "speaker-only" }, { key: "full", label: "Everything" }]
		})
		expect(options.map((o) => o.value)).toEqual(["speaker-only", "full"])
		expect(options.map((o) => o.label)).toEqual([
			"Speaker only",
			"Everything"
		])
	})

	test("a blank label falls back rather than showing nothing", () => {
		expect(
			enumOptions({ of: ["close-third"], members: [{ key: "close-third", label: " " }] })[0]
				.label
		).toBe("Close third")
	})

	test("humanising is sentence case", () => {
		expect(humanizeValue("newest-first")).toBe("Newest first")
		expect(humanizeValue("timesRead")).toBe("Times read")
		expect(humanizeValue("speaker_only")).toBe("Speaker only")
		expect(humanizeValue("")).toBe("")
	})
})
