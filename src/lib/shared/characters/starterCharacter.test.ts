import { describe, expect, test } from "vitest"
import {
	STARTER_CHARACTER,
	isStarterCharacterRow,
	starterCharacterCreate
} from "./starterCharacter"

describe("starterCharacterCreate", () => {
	test("carries the starter's text and is never a persona", () => {
		const create = starterCharacterCreate()
		expect(create.name).toBe(STARTER_CHARACTER.name)
		expect(create.summary).toBe(STARTER_CHARACTER.summary)
		expect(create.description).toBe(STARTER_CHARACTER.description)
		expect(create.personality).toBe(STARTER_CHARACTER.personality)
		expect(create.firstMessage).toBe(STARTER_CHARACTER.firstMessage)
		expect(create.isPersona).toBe(false)
	})

	test("carries no avatar", () => {
		const create = starterCharacterCreate() as Record<string, unknown>
		for (const key of ["avatar", "avatarMediaId", "avatarFile"]) {
			expect(key in create).toBe(false)
		}
	})

	test("is a fresh object each call", () => {
		expect(starterCharacterCreate()).not.toBe(starterCharacterCreate())
	})
})

describe("the starter's text", () => {
	const text = Object.values(STARTER_CHARACTER).join("\n")

	test("is plain prose: no macros, action markers or links", () => {
		expect(text).not.toContain("{{")
		expect(text).not.toContain("*")
		expect(text).not.toContain("http")
	})

	test("opens with exactly two paragraphs", () => {
		expect(STARTER_CHARACTER.firstMessage.split("\n\n")).toHaveLength(2)
	})
})

describe("isStarterCharacterRow", () => {
	const own = {
		name: STARTER_CHARACTER.name,
		description: STARTER_CHARACTER.description,
		isPersona: false,
		isSharedWithMe: false
	}

	test("accepts an own, unchanged copy", () => {
		expect(isStarterCharacterRow(own)).toBe(true)
	})

	test("rejects an edited description or a different name", () => {
		expect(isStarterCharacterRow({ ...own, description: "Edited." })).toBe(
			false
		)
		expect(isStarterCharacterRow({ ...own, name: "Nell" })).toBe(false)
	})

	test("rejects a persona and a shared row", () => {
		expect(isStarterCharacterRow({ ...own, isPersona: true })).toBe(false)
		expect(isStarterCharacterRow({ ...own, isSharedWithMe: true })).toBe(
			false
		)
	})

	test("rejects null and undefined", () => {
		expect(isStarterCharacterRow(null)).toBe(false)
		expect(isStarterCharacterRow(undefined)).toBe(false)
	})
})
