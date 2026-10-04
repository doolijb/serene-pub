/**
 * The relationship sections are keyed by NAMES, and names are untrusted.
 *
 * A guest can bind an attacker-named character into a shared lorebook
 * (`graphContextFormatter.ts`'s header), so a cast member called `__proto__`
 * or `constructor` is a value this code receives. Grouped with
 * `(out[holder] ??= {})[other] ??= []` on a plain `{}`, a holder named
 * `__proto__` wrote `Object.prototype[other]` for the whole server process
 * (review 2026-09-29, F6(a)). These pin that a name is only ever a name: no
 * write escapes the section, and the tie is kept under the name it carried.
 */
import { afterEach, describe, expect, it } from "vitest"
import {
	castRelationshipsSection,
	relationshipSections
} from "./rankedRelationships"
import { select } from "$lib/server/pipelines/ranking/select"
import {
	DEFAULT_GROUPS,
	withDefaults
} from "$lib/server/pipelines/ranking/weights"

const entry = (type: string) => ({ type, secrecy: "Both know" })

const tie = (
	lane: string,
	name: string,
	counterpart: string | undefined,
	position: number,
	extra: Record<string, unknown> = {}
) => ({
	source: "relationships",
	position,
	payload: { lane, name, counterpart, entry: entry(`t${position}`), ...extra }
})

/** Every name a plain object answers without being told. */
const HOSTILE = ["__proto__", "constructor", "toString", "hasOwnProperty"]

afterEach(() => {
	// Belt and braces: if a case ever regresses, do not let the pollution leak
	// into the next case's assertions.
	for (const k of ["isAdmin", "Wren", "t0"])
		delete (Object.prototype as any)[k]
})

describe("castRelationshipsSection — hostile names", () => {
	for (const holder of HOSTILE)
		it(`a holder named ${holder} pollutes nothing and keeps its tie`, () => {
			const out = castRelationshipsSection([
				tie("castRelationships", holder, "isAdmin", 0)
			])
			expect(({} as any).isAdmin).toBeUndefined()
			expect(Object.prototype.hasOwnProperty.call(Object, "isAdmin")).toBe(
				false
			)
			expect(out).not.toBeNull()
			expect(Object.keys(out!)).toEqual([holder])
			const views = Object.getOwnPropertyDescriptor(out, holder)!.value
			expect(views.isAdmin).toEqual([entry("t0")])
			// And JSON — what the prompt actually carries — says it plainly.
			expect(JSON.stringify(out)).toBe(
				`{${JSON.stringify(holder)}:{"isAdmin":[{"type":"t0","secrecy":"Both know"}]}}`
			)
		})

	for (const other of HOSTILE)
		it(`a counterpart named ${other} is kept as a key`, () => {
			const out = castRelationshipsSection([
				tie("castRelationships", "Marrow", other, 0)
			])
			const views = out!.Marrow!
			expect(Object.keys(views)).toEqual([other])
			expect(Object.getOwnPropertyDescriptor(views, other)!.value).toEqual([
				entry("t0")
			])
		})

	it("keeps rank order and groups by holder, then by the other end", () => {
		const out = castRelationshipsSection([
			tie("castRelationships", "Marrow", "Wren", 1),
			tie("castRelationships", "Marrow", "Wren", 0),
			tie("castRelationships", "Wren", "Marrow", 2),
			// Another lane on the same allocation never renders here.
			tie("yourRelationships", "Marrow", "Wren", 3)
		])
		expect(out).toEqual({
			Marrow: { Wren: [entry("t0"), entry("t1")] },
			Wren: { Marrow: [entry("t2")] }
		})
	})
})

/**
 * Plan A2 and its review: the band takes over from the graph dump once it
 * admitted anything the relationship step read — a tie filed under a lane, or
 * a lore-link hop. That step reads the same ties the dump holds, so a band that
 * admitted its hops and none of its ties had those ties in front of it and left
 * them out; rendering the dump would put back what the budget excluded. A
 * vector relationship hit is another mechanism's, with no lane, so a band
 * holding only those still leaves the dump in place.
 */
describe("relationshipSections — what turns the dump off", () => {
	const DUMP = { Marrow: [entry("dumped")] }
	const hop = (position: number) => ({
		source: "relationships",
		position,
		payload: {
			name: "The Salt Tunnel",
			entry: { type: "connects to", secrecy: "We both know" },
			linkedFrom: "The Umber Room",
			via: "link"
		}
	})
	const vectorHit = (position: number) => ({
		source: "relationships",
		position,
		payload: { name: "Marrow", content: "Marrow owes Wren a debt." }
	})

	it("a band that admitted lore-link hops and none of the ties renders no tie: the step read them and the budget left them out", () => {
		const band = [hop(0), hop(1)]
		expect(
			relationshipSections({ band, graph: DUMP }, "perspectives")
		).toBeNull()
		expect(relationshipSections({ band, graph: DUMP }, "known")).toBeNull()
	})

	it("a slice with room for a hop and not for the tie beside it keeps the tie out of the prompt", () => {
		const bigEntry = { type: "ally", secrecy: "We both know", note: "x".repeat(4000) }
		const direct = {
			id: 1,
			source: "relationships",
			tokens: 1200,
			signals: {},
			presetScore: 1,
			position: 0,
			payload: { id: 1, name: "Bram", content: "…", lane: "yourRelationships", entry: bigEntry }
		}
		const linkHop = {
			id: 2,
			source: "relationships",
			tokens: 20,
			signals: {},
			presetScore: 0.5,
			position: 1,
			payload: { ...hop(1).payload, id: 2, content: "…" }
		}
		const params = withDefaults({
			groups: {
				...DEFAULT_GROUPS,
				share: { ...DEFAULT_GROUPS.share, relationships: 0.1 }
			} as any
		})
		// Every other band over-full, so no slice spills over to relationships.
		const fillers: any[] = []
		let id = 100
		for (const source of ["messages", "worldLore", "characterLore", "history"])
			for (let i = 0; i < 40; i++)
				fillers.push({ id: id++, source, tokens: 100, signals: {}, presetScore: 0.9, position: i, payload: { content: "f" } })
		const selection = select([direct, linkHop, ...fillers] as any, {
			availableTokens: 4000,
			params
		})
		const band = selection.included
			.map((d) => d.candidate)
			.filter((c: any) => c.source === "relationships")
		expect(band.map((c: any) => c.id)).toEqual([2])
		expect(
			relationshipSections(
				{ band: band as any, graph: { Bram: [bigEntry] } },
				"perspectives"
			)
		).toBeNull()
	})

	it("a band of lane-less relationship hits only renders the dump", () => {
		expect(
			relationshipSections(
				{ band: [vectorHit(0)], graph: DUMP },
				"perspectives"
			)
		).toBe(DUMP)
	})

	it("one tie under a lane turns the dump off, and the hop beside it renders nowhere", () => {
		const out = relationshipSections(
			{
				band: [hop(0), tie("yourRelationships", "Wren", undefined, 1)],
				graph: DUMP
			},
			"perspectives"
		)
		expect(out).toEqual({ Wren: [entry("t1")] })
	})
})

describe("relationshipSections — hostile names", () => {
	it("a speaker's tie to someone named __proto__ is kept, not lost or thrown", () => {
		const out = relationshipSections(
			{ band: [tie("yourRelationships", "__proto__", undefined, 0)] },
			"perspectives"
		) as Record<string, unknown>
		expect(Object.keys(out)).toEqual(["__proto__"])
		expect(Object.getPrototypeOf(out)).toBe(Object.prototype)
	})

	it("a legendary figure named constructor keeps its facts and ties", () => {
		const out = relationshipSections(
			{
				band: [
					tie("legendaryFigures", "constructor", "__proto__", 0, {
						figure: { summary: "An old king.", state: "dead" }
					})
				]
			},
			"known"
		) as any
		expect(({} as any).t0).toBeUndefined()
		const figure = Object.getOwnPropertyDescriptor(
			out.legendaryFigures,
			"constructor"
		)!.value
		expect(figure.summary).toBe("An old king.")
		expect(figure.state).toBe("dead")
		expect(
			Object.getOwnPropertyDescriptor(figure.relationships, "__proto__")!
				.value
		).toEqual([entry("t0")])
	})
})
