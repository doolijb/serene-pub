import { describe, expect, test } from "vitest"
import {
	greetingColumnsOf,
	greetingsOfColumns,
	noteLanguageProblem,
	notesColumnsOf,
	notesDraftOf,
	withOpenerText
} from "./cardDraft"

describe("greetings", () => {
	test("the three columns merge, and split back", () => {
		const list = greetingsOfColumns({
			firstMessage: "Hi",
			alternateGreetings: ["Hello", ""],
			groupOnlyGreetings: ["Hey all"]
		})
		expect(list).toEqual([
			{ text: "Hi" },
			{ text: "Hello" },
			{ text: "" },
			{ text: "Hey all", groupOnly: true }
		])
		expect(greetingColumnsOf(list)).toEqual({
			firstMessage: "Hi",
			alternateGreetings: ["Hello", ""],
			groupOnlyGreetings: ["Hey all"]
		})
	})
	test("no greetings send an empty opener, as the form did", () =>
		expect(greetingColumnsOf([])).toEqual({
			firstMessage: "",
			alternateGreetings: [],
			groupOnlyGreetings: []
		}))
	test("marked greetings come back after the unmarked ones", () => {
		const out = greetingColumnsOf([
			{ text: "G", groupOnly: true },
			{ text: "Opener" }
		])
		expect(out.firstMessage).toBe("Opener")
		expect(greetingsOfColumns(out).map((g) => g.text)).toEqual([
			"Opener",
			"G"
		])
	})
})

describe("withOpenerText", () => {
	test("edits the first unmarked greeting", () =>
		expect(
			withOpenerText(
				[{ text: "g", groupOnly: true }, { text: "a" }, { text: "b" }],
				"x"
			)
		).toEqual([
			{ text: "g", groupOnly: true },
			{ text: "x" },
			{ text: "b" }
		]))
	test("adds a first greeting when there is no opener", () => {
		expect(withOpenerText([{ text: "g", groupOnly: true }], "x")).toEqual([
			{ text: "x" },
			{ text: "g", groupOnly: true }
		])
		expect(withOpenerText([], "")).toEqual([])
	})
	test("a lone opener emptied is removed", () =>
		expect(withOpenerText([{ text: "a" }], "")).toEqual([]))
})

describe("creator notes", () => {
	test("load: main text, its language, other languages", () => {
		expect(
			notesDraftOf({
				creatorNotes: "Hello",
				creatorNotesMultilingual: { en: "Hello", fr: "Bonjour" }
			})
		).toEqual({
			creatorNotes: "Hello",
			creatorNotesLang: "en",
			creatorNotesVariants: [{ lang: "fr", text: "Bonjour" }]
		})
	})
	test("load: nothing is empty", () =>
		expect(notesDraftOf({})).toEqual({
			creatorNotes: "",
			creatorNotesLang: "",
			creatorNotesVariants: []
		}))
	test("save: the main one under its language, codes trimmed and lower-cased, empty codes dropped", () =>
		expect(
			notesColumnsOf({
				creatorNotes: "Hello",
				creatorNotesLang: " EN ",
				creatorNotesVariants: [
					{ lang: " FR", text: "Bonjour" },
					{ lang: "  ", text: "dropped" }
				]
			})
		).toEqual({
			creatorNotes: "Hello",
			creatorNotesMultilingual: { en: "Hello", fr: "Bonjour" }
		}))
	test("save: no language, no map entry for the main text; load then save round-trips", () => {
		const columns = {
			creatorNotes: "Hi",
			creatorNotesMultilingual: { en: "Hi", de: "Hallo" }
		}
		expect(notesColumnsOf(notesDraftOf(columns))).toEqual(columns)
		expect(
			notesColumnsOf({
				creatorNotes: "Hi",
				creatorNotesLang: "",
				creatorNotesVariants: []
			})
		).toEqual({ creatorNotes: "Hi", creatorNotesMultilingual: {} })
	})
	test("a duplicate code is a problem, the main one counted", () => {
		expect(
			noteLanguageProblem({
				creatorNotes: "",
				creatorNotesLang: "en",
				creatorNotesVariants: [{ lang: "EN", text: "" }]
			})
		).toMatch(/"en"/)
		expect(
			noteLanguageProblem({
				creatorNotes: "",
				creatorNotesLang: "",
				creatorNotesVariants: [
					{ lang: "fr", text: "" },
					{ lang: "de", text: "" },
					{ lang: "", text: "" },
					{ lang: "", text: "" }
				]
			})
		).toBeNull()
	})
})
