import { describe, it, expect } from "vitest"
import {
	MAX_NAMES_PER_ENTRY,
	entityNamesFor,
	extractAliases,
	nameSetHash,
	type NamedBindingRow
} from "$lib/server/pipelines/ranking/entityNames"

const digest = (v: string) => `h:${v.length}:${v}`

const bindings = new Map<number, NamedBindingRow>([
	[
		7,
		{
			id: 7,
			name: "Captain Vell",
			aliases: ["Vell"],
			absorbedAliases: ["Kesseth"]
		}
	]
])

describe("aliases a body declares", () => {
	it("reads the appositive forms", () => {
		expect(
			extractAliases(
				"An order of oathbound riders, also called the Ash Riders."
			)
		).toEqual(["Ash Riders"])
		expect(
			extractAliases("Known as the Silent Gate by the locals.")
		).toEqual(["Silent Gate"])
		expect(extractAliases("a.k.a. Redhand")).toEqual(["Redhand"])
		expect(extractAliases("nicknamed “Little Bear” by the guard")).toEqual([
			"Little Bear"
		])
	})

	it("takes a name and not a description", () => {
		// A lower-case tail after "also called" describes the thing rather than
		// naming it, and this space is about names.
		expect(extractAliases("also called an unpleasant business")).toEqual([])
	})

	it("harvests nothing from an ordinary sentence", () => {
		// The pattern is narrow on purpose: a looser one would make an entry
		// answer to the names of everything it talks about.
		expect(
			extractAliases(
				"Vell rode north with Kesseth and the Ashguard Riders."
			)
		).toEqual([])
	})

	it("is bounded", () => {
		const body = Array.from(
			{ length: 20 },
			(_, i) => `also called Name${i}.`
		).join(" ")
		expect(extractAliases(body).length).toBeLessThanOrEqual(
			MAX_NAMES_PER_ENTRY
		)
	})
})

describe("the names an entry answers to", () => {
	it("takes the title, the body's aliases and the bound character's names", () => {
		expect(
			entityNamesFor(
				{
					id: 1,
					title: "The Ashguard Riders",
					content: "An order, also called the Ash Riders.",
					anchorBindingId: 7
				},
				bindings
			)
		).toEqual([
			{ text: "The Ashguard Riders", kind: "title" },
			{ text: "Ash Riders", kind: "alias" },
			{ text: "Captain Vell", kind: "character" },
			{ text: "Vell", kind: "character" },
			// ⚠ `absorbedAliases` as well as `aliases`. Feeding one half is
			// worse than feeding neither: the absorbed identity would resolve
			// and the name it was merged into would not.
			{ text: "Kesseth", kind: "character" }
		])
	})

	it("gives an unanchored entry only what it says about itself", () => {
		expect(
			entityNamesFor(
				{ id: 2, title: "The Ashguard Riders", content: "" },
				bindings
			)
		).toEqual([{ text: "The Ashguard Riders", kind: "title" }])
	})

	it("gives a dated entry nothing, and that is a working state", () => {
		// History is dated rather than titled and anchors to no binding, so it
		// has nothing to be *called*. No sentinel is needed: the reader keys on
		// rows, and an entry with no names correctly produces none.
		expect(
			entityNamesFor(
				{ id: 3, title: null, content: "The siege broke in spring." },
				bindings
			)
		).toEqual([])
	})

	it("deduplicates across sources, case-insensitively", () => {
		const names = entityNamesFor(
			{
				id: 4,
				title: "Captain Vell",
				content: "also called CAPTAIN VELL",
				anchorBindingId: 7
			},
			bindings
		)
		expect(
			names.filter((n) => n.text.toLowerCase() === "captain vell")
		).toHaveLength(1)
		// The title claims it, so the surviving one is the title's.
		expect(names[0]).toEqual({ text: "Captain Vell", kind: "title" })
	})
})

describe("the name-set hash — the property the whole space is built on", () => {
	const entry = {
		id: 1,
		title: "The Ashguard Riders",
		content: "An order of oathbound riders.",
		anchorBindingId: 7
	}
	const hashOf = (e: typeof entry, b = bindings) =>
		nameSetHash(entityNamesFor(e, b), digest)

	it("does not move when the body is rewritten and no name changes", () => {
		// **Rewriting the body must not re-embed the names.** This is the whole
		// reason the space is separate from the content vectors.
		expect(
			hashOf({ ...entry, content: "Riders. They keep the passes." })
		).toBe(hashOf(entry))
	})

	it("moves when the title changes", () => {
		expect(hashOf({ ...entry, title: "The Ashguard" })).not.toBe(
			hashOf(entry)
		)
	})

	it("moves when the body declares a new alias", () => {
		expect(
			hashOf({
				...entry,
				content: "An order, also called the Ash Riders."
			})
		).not.toBe(hashOf(entry))
	})

	it("moves when a bound character is renamed and the entry is untouched", () => {
		// ⚠ The case a source hash over the *row* would call fresh, and the
		// reason `gazetteer_hash` is carried beside it: extraction reads state
		// outside the row.
		const renamed = new Map<number, NamedBindingRow>([
			[
				7,
				{
					id: 7,
					name: "Captain Vela",
					aliases: [],
					absorbedAliases: []
				}
			]
		])
		expect(hashOf(entry, renamed)).not.toBe(hashOf(entry))
	})
})
