/**
 * The editor's half of the schema.
 *
 * Slice 1 declared the shapes, slice 2 checked paths against them. This is what
 * an author actually feels: the list that appears after `{{`, the answer to
 * "what *is* `nickname`", and the one-letter-off suggestion.
 */
import { describe, expect, test } from "vitest"
import { completionsAt, contextAt, describeAt, suggest } from "./templateAssist"
import type { TemplateScope } from "@serene-pub/sdk"

const SCOPE: TemplateScope = {
	characters: {
		type: "list",
		of: {
			type: "object",
			fields: {
				name: {
					type: "string",
					description: { en: "What they're called." }
				},
				nickname: { type: "string", optional: true },
				"extra lore": { type: "record", of: { type: "string" } }
			}
		}
	},
	scenario: { type: "string" },
	worldLore: { type: "record", of: { type: "string" } }
}

/** `…{{ch‸` — the caret marks the cursor and is removed before use.
 *  Not a bar: Handlebars block params are `as |c|`, and a bar collides. */
const CURSOR = "‸"
function at(marked: string) {
	const offset = marked.indexOf(CURSOR)
	if (offset === -1) throw new Error("no cursor marker")
	return {
		source: marked.slice(0, offset) + marked.slice(offset + 1),
		offset
	}
}
const labels = (marked: string, scope: TemplateScope = SCOPE) => {
	const { source, offset } = at(marked)
	return completionsAt(source, offset, scope).map((c) => c.label)
}

describe("completions", () => {
	test("nothing is offered outside a mustache", () => {
		expect(labels("Some prose about Ash‸")).toEqual([])
		expect(labels("{{characters}} and then‸")).toEqual([])
	})

	test("the root offers the declared variables", () => {
		expect(labels("{{‸")).toEqual(["characters", "scenario", "worldLore"])
	})

	test("typing filters by prefix", () => {
		expect(labels("{{sc‸")).toEqual(["scenario"])
	})

	test("`{{#` offers the block helpers", () => {
		expect(labels("{{#‸")).toContain("each")
		expect(labels("{{#ea‸")).toEqual(["each"])
	})

	test("a helper's argument completes as a path", () => {
		expect(labels("{{#each ‸")).toEqual([
			"characters",
			"scenario",
			"worldLore"
		])
	})

	test("an inline helper's argument completes as a path", () => {
		expect(labels("{{{json ‸")).toEqual([
			"characters",
			"scenario",
			"worldLore"
		])
	})

	// The whole point: inside a loop the names are the *element's*, which is
	// what nothing could say before the schema.
	test("inside an each, the element's fields are offered", () => {
		expect(labels("{{#each characters}}{{‸")).toEqual([
			"name",
			"nickname",
			"extra lore"
		])
		expect(labels("{{#each characters}}{{this.‸")).toEqual([
			"name",
			"nickname",
			"extra lore"
		])
	})

	test("a block param is offered, and completes to the element's fields", () => {
		expect(labels("{{#each characters as |c|}}{{‸")).toContain("c")
		expect(labels("{{#each characters as |c|}}{{c.‸")).toEqual([
			"name",
			"nickname",
			"extra lore"
		])
	})

	test("`../` steps back out to the enclosing context", () => {
		expect(labels("{{#each characters}}{{../‸")).toEqual([
			"characters",
			"scenario",
			"worldLore"
		])
	})

	test("a nested each narrows again", () => {
		expect(
			labels("{{#each characters}}{{#each this.[extra lore]}}{{‸")
		).toEqual([])
	})

	test("a closed block pops back to the outer context", () => {
		expect(labels("{{#each characters}}{{name}}{{/each}}{{‸")).toEqual([
			"characters",
			"scenario",
			"worldLore"
		])
	})

	test("an each's else branch is back outside", () => {
		expect(labels("{{#each characters}}{{name}}{{else}}{{‸")).toEqual([
			"characters",
			"scenario",
			"worldLore"
		])
	})

	test("if/unless keep the context they were opened in", () => {
		expect(labels("{{#each characters}}{{#if name}}{{‸")).toEqual([
			"name",
			"nickname",
			"extra lore"
		])
	})

	test("a list offers length, and nothing it does not have", () => {
		expect(labels("{{characters.‸")).toEqual(["length"])
	})

	test("a scalar offers nothing", () => {
		expect(labels("{{scenario.‸")).toEqual([])
	})

	// A record's keys are whoever wrote the data's business. An empty list here
	// would read as "this has no fields", which is the opposite of the truth.
	test("a record offers nothing rather than an empty field set", () => {
		expect(labels("{{worldLore.‸")).toEqual([])
	})

	test("a name needing brackets is inserted with them", () => {
		const { source, offset } = at("{{#each characters}}{{ex‸")
		const [c] = completionsAt(source, offset, SCOPE)
		expect(c!.label).toBe("extra lore")
		expect(c!.insert).toBe("[extra lore]")
	})

	test("the completion replaces only the partial name", () => {
		const { source, offset } = at("{{sc‸")
		const [c] = completionsAt(source, offset, SCOPE)
		expect(source.slice(c!.start, c!.end)).toBe("sc")
	})

	test("an unchecked declaration offers nothing past its root", () => {
		expect(labels("{{anything.‸", { anything: "any" })).toEqual([])
	})

	test("optionality rides along with the completion", () => {
		const { source, offset } = at("{{#each characters}}{{nick‸")
		const [c] = completionsAt(source, offset, SCOPE)
		expect(c!.optional).toBe(true)
		expect(c!.type).toBe("string")
	})

	test("a field's description is carried through for the list and the hover", () => {
		const { source, offset } = at("{{#each characters}}{{na‸")
		const [c] = completionsAt(source, offset, SCOPE)
		expect(c!.description).toBe("What they're called.")
	})
})

describe("hover", () => {
	test("a declared variable reports its type", () => {
		const { source, offset } = at("{{chara‸cters}}")
		expect(describeAt(source, offset, SCOPE)).toMatchObject({
			path: "characters",
			type: "list"
		})
	})

	test("a field inside a loop reports its type and optionality", () => {
		const { source, offset } = at(
			"{{#each characters}}{{this.nick‸name}}{{/each}}"
		)
		expect(describeAt(source, offset, SCOPE)).toMatchObject({
			type: "string",
			optional: true
		})
	})

	test("a bad path reports the problem and the nearest name", () => {
		const { source, offset } = at(
			"{{#each characters}}{{this.nickan‸me}}{{/each}}"
		)
		const h = describeAt(source, offset, SCOPE)!
		expect(h.problem).toMatch(/does not exist/)
		expect(h.suggestion).toBe("nickname")
	})

	test("an unknown root reports the problem and the nearest variable", () => {
		const { source, offset } = at("{{scenari‸}}")
		const h = describeAt(source, offset, SCOPE)!
		expect(h.problem).toMatch(/isn't a recognized field/)
		expect(h.suggestion).toBe("scenario")
	})

	test("there is nothing to say about prose", () => {
		const { source, offset } = at("just som‸e words")
		expect(describeAt(source, offset, SCOPE)).toBeNull()
	})
})

describe("did you mean", () => {
	test("a one-letter transposition is caught", () => {
		expect(suggest("nickanme", ["name", "nickname"])).toBe("nickname")
	})

	test("a short name gets a tighter budget than a long one", () => {
		expect(suggest("nam", ["name"])).toBe("name")
		// Two edits on a four-letter word is a different word, not a typo.
		expect(suggest("abcd", ["name"])).toBeUndefined()
	})

	// A wrong guess sends someone to change a line that was correct.
	test("nothing near enough means nothing said", () => {
		expect(
			suggest("completelyDifferent", ["name", "nickname"])
		).toBeUndefined()
		expect(suggest("name", [])).toBeUndefined()
	})

	test("ties resolve alphabetically, so the answer is stable", () => {
		expect(suggest("ab", ["ax", "bb"])).toBe("ax")
	})
})

describe("context tracking is tolerant of half-typed source", () => {
	// The reason this does not reuse the card parser: a template being edited
	// does not parse, and a completion that switches off while you type is
	// worse than none at all.
	test("an unclosed block still establishes its context", () => {
		const { source, offset } = at("{{#each characters}}{{‸")
		expect(contextAt(source, offset, SCOPE).context?.type).toBe("object")
	})

	test("a stray close tag does not throw", () => {
		expect(labels("{{/each}}{{‸")).toEqual([
			"characters",
			"scenario",
			"worldLore"
		])
	})

	// The cursor is inside the tag being typed, so this completes that tag's
	// own argument. What it must *not* do is treat the half-written block as
	// already open and offer the element's fields.
	test("an unterminated block completes its own argument", () => {
		expect(labels("{{#each characters‸")).toEqual(["characters"])
		expect(labels("{{#each ‸")).toEqual([
			"characters",
			"scenario",
			"worldLore"
		])
	})
})

/**
 * Segment literals — `{{ this.[extra lore] }}`.
 *
 * The naive reading splits an expression on whitespace, which turns
 * `jsonValue this.[extra lore] 4` into `this.[extra` and `lore]` and lints both
 * as missing fields. That is not a corner case: `extra lore` is a real key, it
 * is what the completion list inserts, and the shipped characters layout is
 * written with it — so the naive split flagged the layout Serene Pub ships.
 */
describe("bracketed segments", () => {
	test("a helper's bracketed argument stays one token", () => {
		// The shipped characters layout, near enough: a bracketed path and a
		// numeric indent argument in the same expression.
		const { source, offset } = at(
			"{{#each characters}}{{{jsonValue this.[extra ‸lore] 4}}}{{/each}}"
		)
		expect(describeAt(source, offset, SCOPE)).toMatchObject({
			path: "this.[extra lore]",
			type: "record"
		})
	})

	test("completing inside an unclosed bracket still filters", () => {
		expect(labels("{{#each characters}}{{this.[extra lo‸")).toEqual([
			"extra lore"
		])
	})

	test("a path through a bracketed segment resolves", () => {
		const { source, offset } = at(
			"{{#each characters}}{{this.[extra lore].[The Ashguard br‸and]}}"
		)
		expect(describeAt(source, offset, SCOPE)).toMatchObject({
			type: "string"
		})
	})
})
