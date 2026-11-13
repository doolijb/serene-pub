/** The Sessions filter box matches the shown name (s27 S2c, ★client-2). */
import { describe, expect, test } from "vitest"
import { sessionMatchesSearch, type SessionSearchable } from "./sessionSearch"

const session = (over: Partial<SessionSearchable> = {}): SessionSearchable => ({
	name: "The Long Road",
	sessionCharacters: [{ character: { id: 3, name: "Adeline" } }],
	sessionPersonas: [{ persona: { id: 8, name: "Kit" } }],
	sessionTags: [{ tag: { name: "Fantasy" } }],
	...over
})
const found = (s: SessionSearchable, text: string) =>
	sessionMatchesSearch(s, text.toLowerCase())

describe("sessionMatchesSearch", () => {
	test("still found by session name, card names and tag, in any case", () => {
		const s = session()
		expect(found(s, "long road")).toBe(true)
		expect(found(s, "ADELINE")).toBe(true)
		expect(found(s, "kit")).toBe(true)
		expect(found(s, "fantasy")).toBe(true)
		expect(found(s, "nobody")).toBe(false)
	})

	test("found by a character seat member's own name", () => {
		const s = session({
			castNames: { 3: { ownName: "Delia", ownNickname: null } }
		})
		expect(found(s, "delia")).toBe(true)
		// The card's name stands too.
		expect(found(s, "adeline")).toBe(true)
	})

	test("found by a persona seat member's own nickname", () => {
		const s = session({
			castNames: { 8: { ownName: null, ownNickname: "Kitty" } }
		})
		expect(found(s, "kitty")).toBe(true)
		expect(found(s, "kit")).toBe(true)
	})

	test("an own nickname of none matches nothing extra", () => {
		const s = session({
			castNames: { 3: { ownName: null, ownNickname: "" } }
		})
		expect(found(s, "e")).toBe(true)
		expect(found(s, "zzz")).toBe(false)
		// Nothing is matched by the empty string's presence in a field.
		const bare = session({
			name: "A",
			sessionCharacters: [],
			sessionPersonas: [],
			sessionTags: []
		})
		expect(
			sessionMatchesSearch(
				{
					...bare,
					castNames: { 3: { ownName: null, ownNickname: "" } }
				},
				"x"
			)
		).toBe(false)
	})

	test("a member of a seat not in the session is not searched", () => {
		const s = session({
			castNames: { 99: { ownName: "Ghost", ownNickname: null } }
		})
		expect(found(s, "ghost")).toBe(false)
	})

	test("no castNames reads as before", () => {
		for (const castNames of [undefined, null, {}])
			expect(found(session({ castNames }), "kitty")).toBe(false)
		expect(found({ name: "Only a name" }, "only")).toBe(true)
	})
})
