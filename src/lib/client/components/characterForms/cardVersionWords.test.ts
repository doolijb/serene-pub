import { describe, expect, test } from "vitest"
import {
	highestVersion,
	inPlaceNote,
	stayingGroups,
	versionLabelText,
	versionOptionText,
	type StayingCastMember
} from "./cardVersionWords"

const versions = [
	{ id: 10, number: 1, label: "1.0" },
	{ id: 11, number: 2, label: "1.1" },
	{ id: 12, number: 3, label: "Director's cut" },
	{ id: 13, number: 4, label: null }
]
const member = (
	id: number,
	name: string,
	cardVersionId: number,
	label: string | null
): StayingCastMember => ({
	castMemberId: id,
	lorebookId: 1,
	name,
	cardVersionId,
	label
})

describe("versionLabelText", () => {
	test("a numeric label reads v<label>", () =>
		expect(versionLabelText("1.0", 1)).toBe("v1.0"))
	test("a word label is as is", () =>
		expect(versionLabelText("Director's cut", 3)).toBe("Director's cut"))
	test("no label reads Version <number>", () => {
		expect(versionLabelText(null, 4)).toBe("Version 4")
		expect(versionLabelText("  ", 4)).toBe("Version 4")
	})
})

describe("versionOptionText", () => {
	test("the current one says so", () => {
		expect(versionOptionText(versions[1], 11)).toBe("v1.1 · current")
		expect(versionOptionText(versions[0], 11)).toBe("v1.0")
	})
})

describe("highestVersion and inPlaceNote", () => {
	test("the highest number is the current one", () =>
		expect(highestVersion(versions)?.id).toBe(13))
	test("the note names both", () =>
		expect(inPlaceNote(versions[0], versions[1])).toBe(
			"Saving changes v1.0 in place; v1.1 is the current version."
		))
})

describe("stayingGroups", () => {
	test("one version, several members", () => {
		const groups = stayingGroups(
			[
				member(1, "Bianca", 10, "1.0"),
				member(2, "Theo", 10, "1.0"),
				member(3, "Ada", 10, "1.0")
			],
			versions
		)
		expect(groups).toHaveLength(1)
		expect(groups[0].lead).toBe("3 cast members stay on v1.0:")
		expect(groups[0].members.map((m) => m.name)).toEqual([
			"Bianca",
			"Theo",
			"Ada"
		])
	})
	test("one member is singular", () =>
		expect(
			stayingGroups([member(1, "Bianca", 10, "1.0")], versions)[0].lead
		).toBe("1 cast member stays on v1.0:"))
	test("grouped by version when they differ", () => {
		const groups = stayingGroups(
			[
				member(1, "A", 10, "1.0"),
				member(2, "B", 11, "1.1"),
				member(3, "C", 10, "1.0")
			],
			versions
		)
		expect(groups.map((g) => g.lead)).toEqual([
			"2 cast members stay on v1.0:",
			"1 stays on v1.1:"
		])
	})
	test("a version without a label reads Version <number>", () =>
		expect(
			stayingGroups([member(1, "A", 13, null)], versions)[0].lead
		).toBe("1 cast member stays on Version 4:"))
})
