import { describe, expect, test } from "vitest"
import {
	hasOwnNames,
	memberFaceMediaId,
	memberNames,
	memberShownName,
	ownNameValue,
	withMemberNames
} from "./memberIdentity"
import { resolveCharacterName } from "$lib/shared/utils/resolveCharacterName"

const card = { name: "Verity Hale", nickname: "Vee", avatarMediaId: 7 }
const bare = [
	undefined,
	null,
	{},
	{ ownName: null, ownNickname: null },
	{ ownName: "" }
]

describe("ownNameValue", () => {
	test("trims text; blank text is kept as an own empty value; non-text is null", () => {
		expect(ownNameValue("  Maren ")).toBe("Maren")
		expect(ownNameValue("")).toBe("")
		expect(ownNameValue("   ")).toBe("")
		expect(ownNameValue(null)).toBeNull()
		expect(ownNameValue(undefined)).toBeNull()
		expect(ownNameValue(5)).toBeNull()
	})
})

describe("hasOwnNames", () => {
	test("false for rows with no own fields", () => {
		for (const m of bare) expect(hasOwnNames(m as any)).toBe(false)
	})
	test("true for either field", () => {
		expect(hasOwnNames({ ownName: "A" })).toBe(true)
		expect(hasOwnNames({ ownNickname: "A" })).toBe(true)
	})
	test("an own empty nickname counts; an own empty name does not", () => {
		expect(hasOwnNames({ ownName: "" })).toBe(false)
		expect(hasOwnNames({ ownNickname: "" })).toBe(true)
		expect(hasOwnNames({ ownNickname: "  " })).toBe(true)
	})
})

describe("memberNames / memberShownName", () => {
	test("no own fields reads exactly as the card does", () => {
		for (const m of bare) {
			for (const c of [
				card,
				{ name: "Solo", nickname: "" },
				{ name: "Solo", nickname: null },
				{ name: " Pad ", nickname: "  " },
				{},
				null,
				undefined
			]) {
				expect(memberShownName(m as any, c as any, "x")).toBe(
					resolveCharacterName(c as any, "x")
				)
			}
		}
		expect(memberNames(undefined, card)).toEqual({
			name: "Verity Hale",
			nickname: "Vee"
		})
		expect(memberNames(null, null)).toEqual({ name: "", nickname: null })
	})
	test("an own name alone keeps the card's nickname (owner ★L-3, 2026-11-04)", () => {
		expect(memberNames({ ownName: "Maren" }, card)).toEqual({
			name: "Maren",
			nickname: "Vee"
		})
		// Shown by the nickname, as the card's rule prefers.
		expect(memberShownName({ ownName: "Maren" }, card)).toBe("Vee")
		// An own empty nickname means none in this book: the member shows by name.
		expect(
			memberShownName({ ownName: "Maren", ownNickname: "" }, card)
		).toBe("Maren")
	})
	test("an own empty nickname alone: no nickname, shown by the card's name", () => {
		const m = { ownName: "", ownNickname: "  " }
		expect(hasOwnNames(m)).toBe(true)
		expect(memberNames(m, card)).toEqual({
			name: "Verity Hale",
			nickname: null
		})
		expect(memberShownName(m, card)).toBe("Verity Hale")
	})
	test("own nickname alone wins over the card's nickname, keeps the card's name", () => {
		expect(memberNames({ ownNickname: "Rae" }, card)).toEqual({
			name: "Verity Hale",
			nickname: "Rae"
		})
		expect(memberShownName({ ownNickname: "Rae" }, card)).toBe("Rae")
	})
	test("both own fields: nickname shows", () => {
		expect(
			memberNames({ ownName: "Maren", ownNickname: "Mae" }, card)
		).toEqual({ name: "Maren", nickname: "Mae" })
		expect(
			memberShownName({ ownName: "Maren", ownNickname: "Mae" }, card)
		).toBe("Mae")
	})
	test("fallback applies when nothing names the member", () => {
		expect(memberShownName(null, {}, "fb")).toBe("fb")
		expect(memberShownName(null, null)).toBe("")
	})
})

describe("withMemberNames", () => {
	test("the same object when the member has no own names", () => {
		for (const m of bare) expect(withMemberNames(card, m as any)).toBe(card)
	})
	test("replaces name and nickname, keeps the rest", () => {
		const out = withMemberNames(card, { ownName: "Maren" })
		expect(out).not.toBe(card)
		expect(out).toEqual({ ...card, name: "Maren", nickname: "Vee" })
		expect(card.name).toBe("Verity Hale")
		expect(
			withMemberNames(card, { ownName: "Maren", ownNickname: "" })
		).toEqual({
			...card,
			name: "Maren",
			nickname: null
		})
	})
})

describe("memberFaceMediaId", () => {
	test("their face while retold.face and a faceMediaId", () => {
		expect(
			memberFaceMediaId({ faceMediaId: 9, retold: { face: true } }, card)
		).toBe(9)
	})
	test("else the card's avatar, else null", () => {
		expect(
			memberFaceMediaId({ faceMediaId: 9, retold: { face: false } }, card)
		).toBe(7)
		expect(memberFaceMediaId({ faceMediaId: 9, retold: {} }, card)).toBe(7)
		expect(
			memberFaceMediaId(
				{ faceMediaId: null, retold: { face: true } },
				card
			)
		).toBe(7)
		expect(memberFaceMediaId(null, card)).toBe(7)
		expect(
			memberFaceMediaId({ retold: { face: true }, faceMediaId: 9 }, {})
		).toBe(9)
		expect(memberFaceMediaId(undefined, null)).toBeNull()
		expect(
			memberFaceMediaId({ faceMediaId: 9, retold: null }, {})
		).toBeNull()
	})
})
