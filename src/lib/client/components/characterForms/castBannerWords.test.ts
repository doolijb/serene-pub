import { describe, expect, test } from "vitest"
import {
	castBannerWords,
	castEditParts,
	castEditWords,
	retoldFieldList,
	type CastBannerMember
} from "./castBannerWords"

function member(
	lorebookId: number,
	castId: number,
	retold: CastBannerMember["retold"] = []
): CastBannerMember {
	return {
		lorebookId,
		lorebookName: `Book ${lorebookId}`,
		castId,
		retold,
		followsCard: [],
		memberName: "Bianca"
	}
}

const ALL_FIELDS: CastBannerMember["followsCard"] = [
	"description",
	"personality",
	"scenario",
	"firstMessage",
	"alternateGreetings",
	"exampleDialogues",
	"postHistoryInstructions",
	"creatorNotes",
	"likeness",
	"face"
]

function follower(
	lorebookId: number,
	lorebookName: string,
	memberName: string,
	followsCard: CastBannerMember["followsCard"]
): CastBannerMember {
	return {
		lorebookId,
		lorebookName,
		castId: lorebookId * 10,
		retold: ALL_FIELDS.filter((f) => !followsCard.includes(f)),
		followsCard,
		memberName
	}
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
		expect(
			castBannerWords([member(1, 10, ["face", "description"])])
		).toEqual({
			lead: "In 1 lorebook:",
			represents: "Represents 1 cast member in 1 lorebook.",
			retells: "It retells parts of this card: description, face."
		})
	})

	test("plural members and books, one retelling", () => {
		expect(
			castBannerWords([
				member(1, 10, ["description", "face"]),
				member(2, 20)
			])
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

describe("castEditWords", () => {
	const allButPersonality = ALL_FIELDS.filter((f) => f !== "personality")

	test("two members of one name, alike, share one clause", () => {
		expect(
			castEditWords([
				follower(1, "Porto Alto", "Bianca", allButPersonality),
				follower(2, "The Shared House", "Bianca", allButPersonality)
			])
		).toBe(
			"Editing this changes Bianca in Porto Alto and The Shared House (their description, scenario, greetings, example dialogues, post-history instructions, creator notes, likeness and face; their personality is their own there)."
		)
	})

	test("a member following everything has no parenthetical", () => {
		expect(
			castEditWords([follower(1, "Porto Alto", "Bianca", ALL_FIELDS)])
		).toBe("Editing this changes Bianca in Porto Alto.")
	})

	test("different members make different groups, in payload order", () => {
		expect(
			castEditWords([
				follower(1, "Porto Alto", "Bianca", ALL_FIELDS),
				follower(2, "Lisbon", "Bee", ["description"])
			])
		).toBe(
			"Editing this changes Bianca in Porto Alto and Bee in Lisbon (their description; their personality, scenario, greetings, example dialogues, post-history instructions, creator notes, likeness and face are their own there)."
		)
	})

	test("three books are joined without an Oxford comma", () => {
		expect(
			castEditWords([
				follower(1, "A", "Bianca", ALL_FIELDS),
				follower(2, "B", "Bianca", ALL_FIELDS),
				follower(3, "C", "Bianca", ALL_FIELDS)
			])
		).toBe("Editing this changes Bianca in A, B and C.")
	})

	test("only one of the two greeting fields is not said as greetings", () => {
		expect(
			castEditWords([
				follower(1, "A", "Bianca", [
					"description",
					"alternateGreetings"
				])
			])
		).toBe(
			"Editing this changes Bianca in A (their description and alternate greetings; their personality, scenario, first message, example dialogues, post-history instructions, creator notes, likeness and face are their own there)."
		)
	})

	test("a member that retells every field is not counted", () => {
		expect(
			castEditWords([
				follower(1, "A", "Bianca", []),
				follower(2, "B", "Bee", ["face"])
			])
		).toBe(
			"Editing this changes Bee in B (their face; their description, personality, scenario, greetings, example dialogues, post-history instructions, creator notes and likeness are their own there)."
		)
		expect(castEditWords([follower(1, "A", "Bianca", [])])).toBeNull()
	})

	describe("is for one singular own word, are for the rest", () => {
		const ownOf = (own: CastBannerMember["followsCard"]) =>
			castEditWords([
				follower(
					1,
					"A",
					"Bianca",
					ALL_FIELDS.filter((f) => !own.includes(f))
				)
			])

		test("greetings alone are their own", () => {
			expect(ownOf(["firstMessage", "alternateGreetings"])).toContain(
				"their greetings are their own there)"
			)
		})

		test("example dialogues alone are their own", () => {
			expect(ownOf(["exampleDialogues"])).toContain(
				"their example dialogues are their own there)"
			)
		})

		test("one singular word is their own", () => {
			expect(ownOf(["personality"])).toContain(
				"their personality is their own there)"
			)
		})

		test("two singular words are their own", () => {
			expect(ownOf(["personality", "scenario"])).toContain(
				"their personality and scenario are their own there)"
			)
		})
	})

	test("no members, no sentence", () => {
		expect(castEditWords([])).toBeNull()
		expect(castEditWords(null)).toBeNull()
		expect(castEditWords(undefined)).toBeNull()
	})
})

describe("castEditWords for one edited card version", () => {
	const v1 = { id: 1, number: 1, label: null }
	const v2 = { id: 2, number: 2, label: "1.1" }
	const on = (
		m: CastBannerMember,
		cardVersion: CastBannerMember["cardVersion"]
	): CastBannerMember => ({ ...m, cardVersion })

	test("names only the members reading the edited version", () => {
		expect(
			castEditWords(
				[
					on(follower(1, "Porto Alto", "Ines", ALL_FIELDS), v1),
					on(follower(2, "Lisbon", "Bianca", ALL_FIELDS), v2)
				],
				2
			)
		).toBe("Editing this changes Bianca in Lisbon.")
	})

	test("only members on another version: null", () => {
		expect(
			castEditWords(
				[on(follower(1, "Porto Alto", "Ines", ALL_FIELDS), v1)],
				2
			)
		).toBeNull()
	})

	test("a member reading no card version is not named", () => {
		expect(
			castEditWords(
				[on(follower(1, "Porto Alto", "Ines", ALL_FIELDS), null)],
				2
			)
		).toBeNull()
	})

	test("a member without the cardVersion field is still named", () => {
		expect(
			castEditWords([follower(1, "Porto Alto", "Ines", ALL_FIELDS)], 2)
		).toBe("Editing this changes Ines in Porto Alto.")
	})

	test("no edited version: nobody is filtered out", () => {
		expect(
			castEditWords([
				on(follower(1, "Porto Alto", "Ines", ALL_FIELDS), v1),
				on(follower(2, "Lisbon", "Bianca", ALL_FIELDS), v2)
			])
		).toBe("Editing this changes Ines in Porto Alto and Bianca in Lisbon.")
	})
})

describe("castEditParts", () => {
	const allButPersonality = ALL_FIELDS.filter((f) => f !== "personality")

	test("each book is a part carrying its lorebook and member, between plain words", () => {
		expect(
			castEditParts([
				follower(1, "Porto Alto", "Bianca", ALL_FIELDS),
				follower(2, "Lisbon", "Bianca", ALL_FIELDS)
			])
		).toEqual([
			"Editing this changes Bianca in ",
			{ lorebookId: 1, castId: 10, lorebookName: "Porto Alto" },
			" and ",
			{ lorebookId: 2, castId: 20, lorebookName: "Lisbon" },
			"."
		])
	})

	test("a clause with a parenthetical ends in words after the last book", () => {
		const parts = castEditParts([
			follower(1, "A", "Bianca", allButPersonality)
		])!
		expect(parts[1]).toEqual({
			lorebookId: 1,
			castId: 10,
			lorebookName: "A"
		})
		expect(parts[2]).toBe(
			" (their description, scenario, greetings, example dialogues, post-history instructions, creator notes, likeness and face; their personality is their own there)."
		)
	})

	test("joined, the parts are the words", () => {
		const members = [
			follower(1, "Porto Alto", "Bianca", allButPersonality),
			follower(2, "The Shared House", "Bianca", allButPersonality),
			follower(3, "Lisbon", "Bee", ["description"]),
			follower(4, "A", "Bee", ["description"]),
			follower(5, "B", "Cy", ALL_FIELDS)
		]
		const joined = castEditParts(members)!
			.map((p) => (typeof p === "string" ? p : p.lorebookName))
			.join("")
		expect(joined).toBe(castEditWords(members))
	})

	test("null when nothing follows the card, or there are no members", () => {
		expect(castEditParts([follower(1, "A", "Bianca", [])])).toBeNull()
		expect(castEditParts(null)).toBeNull()
		expect(castEditParts(undefined)).toBeNull()
	})
})
