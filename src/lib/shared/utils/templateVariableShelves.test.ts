import { describe, expect, test } from "vitest"
import {
	filterShelvedTree,
	insertionFor,
	shelveScopeTree,
	usedScopeRoots,
	variableExampleOf,
	variableShelfOf
} from "./templateVariableShelves"

const LIQUID = "core:template/liquid@1"

describe("variable shelves", () => {
	test("a root's shelf comes from its name", () => {
		expect(variableShelfOf("characterLore")).toBe("lore")
		expect(variableShelfOf("characters")).toBe("characters")
		expect(variableShelfOf("char")).toBe("characters")
		expect(variableShelfOf("postHistoryInstructions")).toBe("instructions")
		expect(variableShelfOf("sessionMessages")).toBe("history")
		expect(variableShelfOf("currentDate")).toBe("session")
		expect(variableShelfOf("secretEntry")).toBe("lore")
		expect(
			variableShelfOf("riddle", { label: "Annex", group: "annex" })
		).toBe("session")
		expect(variableShelfOf("riddle")).toBe("other")
	})

	test("an example is the registered variable's sample", () => {
		expect(variableExampleOf("scenario")).toBe(
			"The caravan has stopped at the edge of the wastes."
		)
		expect(variableExampleOf("characterLore")).toContain(
			'"castMember":"Ash"'
		)
		expect(variableExampleOf("sessionMessages")).toBeUndefined()
	})

	test("insertion follows the engine's brace rule", () => {
		expect(
			insertionFor({ path: "characterLore", type: "string" }).text
		).toBe("{{{characterLore}}}")
		expect(
			insertionFor({ path: "characterLore", type: "string" }, LIQUID).text
		).toBe("{{ characterLore }}")
		const loop = insertionFor({ path: "sessionMessages", type: "list" })
		expect(loop.text).toBe("{{#each sessionMessages}}\n\n{{/each}}")
		expect(loop.caret).toBe("{{#each sessionMessages}}\n".length)
	})

	test("used roots are found in either language, never through a field or a string", () => {
		const roots = [
			"characters",
			"name",
			"scenario",
			"postHistory",
			"worldLore"
		]
		expect(
			usedScopeRoots(
				'{{{characters}}}{{#each x}}{{this.name}}{{lookup y "scenario"}}{{#with ../postHistory}}{{/with}}{{/each}}{{!-- {{worldLore}} --}}',
				roots
			)
		).toEqual(new Set(["characters", "postHistory"]))
		expect(
			usedScopeRoots(
				"{% for item in worldLore %}{{ item.name }}{% endfor %}",
				roots
			)
		).toEqual(new Set(["worldLore"]))
	})

	test("the filter keeps a match's shelf, open", () => {
		const tree = shelveScopeTree(
			[
				{
					id: "characterLore",
					label: "characterLore",
					path: "characterLore",
					type: "string"
				},
				{
					id: "scenario",
					label: "scenario",
					path: "scenario",
					type: "string"
				}
			],
			{ example: () => undefined }
		)
		const { nodes, reveal, matched } = filterShelvedTree(tree, "lore")
		expect(nodes.map((n) => n.id)).toEqual(["shelf:lore"])
		expect(reveal.has("shelf:lore")).toBe(true)
		expect(matched).toBe(1)
	})
})
