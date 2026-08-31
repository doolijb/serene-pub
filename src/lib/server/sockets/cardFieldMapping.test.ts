import { describe, expect, test } from "vitest"
import { characterFieldsFromParsedData } from "./characters"
import { personaFieldsFromParsedData } from "./personas"

/**
 * Field-level import mapping for V2/V3 character cards.
 *
 * The regression these cover: several fields are defined by the V3 spec on
 * `data` itself, but Serene Pub's own exporter writes them under
 * `extensions`. The mapper only ever read the `extensions` location, so
 * SP-exported cards round-tripped fine while every spec-compliant card from
 * another tool imported with those fields silently emptied.
 */
describe("characterFieldsFromParsedData", () => {
	test("reads source/group_only_greetings from the V3 spec location", () => {
		const row = characterFieldsFromParsedData({
			name: "Vex",
			source: ["https://example.com/x"],
			group_only_greetings: ["gg1"]
		})

		expect(row.source).toEqual(["https://example.com/x"])
		expect(row.groupOnlyGreetings).toEqual(["gg1"])
	})

	test("still reads them from extensions, where Serene Pub's exporter writes them", () => {
		const row = characterFieldsFromParsedData({
			name: "Vex",
			extensions: {
				source: ["https://example.com/x"],
				group_only_greetings: ["gg1"]
			}
		})

		expect(row.source).toEqual(["https://example.com/x"])
		expect(row.groupOnlyGreetings).toEqual(["gg1"])
	})

	test("prefers the spec location when a card somehow carries both", () => {
		const row = characterFieldsFromParsedData({
			name: "Vex",
			source: ["spec"],
			extensions: { source: ["ext"] }
		})

		expect(row.source).toEqual(["spec"])
	})

	test("falls back to empty/null when absent or the wrong type", () => {
		const row = characterFieldsFromParsedData({
			name: "Vex",
			source: "not-an-array",
			group_only_greetings: 42
		})

		expect(row.source).toEqual([])
		expect(row.groupOnlyGreetings).toBeNull()
	})

	test("carries V3 creator_notes_multilingual and assets into their columns", () => {
		const assets = [
			{ type: "icon", uri: "ccdefault:", name: "main", ext: "png" }
		]
		const row = characterFieldsFromParsedData({
			name: "Vex",
			creator_notes_multilingual: { en: "hi", ja: "やあ" },
			assets
		})

		expect(row.creatorNotesMultilingual).toEqual({ en: "hi", ja: "やあ" })
		expect(row.assets).toEqual(assets)
	})

	test("leaves creator_notes_multilingual null and assets empty when absent", () => {
		const row = characterFieldsFromParsedData({ name: "Vex" })

		expect(row.creatorNotesMultilingual).toBeNull()
		expect(row.assets).toEqual([])
	})
})

describe("personaFieldsFromParsedData", () => {
	test("round-trips the aliases/summary buildPersonaExportCard writes", () => {
		const row = personaFieldsFromParsedData({
			name: "Ryvn",
			description: "d",
			extensions: {
				serenepub: {
					aliases: ["Ry"],
					summary: "a summary",
					category: "cat"
				}
			}
		})

		expect(row.aliases).toEqual(["Ry"])
		expect(row.summary).toBe("a summary")
		expect(row.category).toBe("cat")
	})

	test("tolerates the un-namespaced extensions.aliases other tools write", () => {
		const row = personaFieldsFromParsedData({
			name: "Ryvn",
			description: "d",
			extensions: { aliases: ["Ry"] }
		})

		expect(row.aliases).toEqual(["Ry"])
	})

	test("defaults aliases/summary when the card carries neither", () => {
		const row = personaFieldsFromParsedData({
			name: "Ryvn",
			description: "d"
		})

		expect(row.aliases).toEqual([])
		expect(row.summary).toBeNull()
	})
})
