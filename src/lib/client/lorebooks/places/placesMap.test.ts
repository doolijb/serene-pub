/**
 * The map, as arithmetic: what nests inside what, what a road joins, and who
 * is standing in the room.
 */
import { describe, expect, it } from "vitest"
import {
	buildPlacesMap,
	PLACES_EMPTY_LINE,
	placesHeaderLine
} from "./placesMap"

const entry = (id: number, name: string, parentId: number | null = null) => ({
	id,
	name,
	parentId
})

const link = (
	id: number,
	from: number,
	to: number,
	relationshipType: string
) => ({
	id,
	from: { kind: "entry" as const, entryId: from },
	to: { kind: "entry" as const, entryId: to },
	relationshipType,
	status: "active"
})

const pin = (
	id: number,
	bindingId: number,
	entryId: number,
	relationshipType: string
) => ({
	id,
	from: { kind: "cast" as const, bindingId },
	to: { kind: "entry" as const, entryId },
	relationshipType,
	status: "active"
})

const castNames = new Map([
	[1, "Verity"],
	[2, "Marrow"]
])

describe("buildPlacesMap — regions come from what is filed under what", () => {
	it("nests a child inside the parent it is filed under", () => {
		const map = buildPlacesMap({
			entries: [entry(1, "The Reach"), entry(2, "The Archive", 1)],
			relationships: [],
			castNames
		})
		expect(map.regions.map((r) => r.name)).toEqual(["The Reach"])
		expect(map.regions[0].children.map((r) => r.name)).toEqual([
			"The Archive"
		])
		expect(map.mapped).toBe(2)
	})

	it("leaves an entry nothing joins or holds off the map", () => {
		const map = buildPlacesMap({
			entries: [entry(1, "The Reach"), entry(9, "A loose note")],
			relationships: [],
			castNames
		})
		expect(map.mapped).toBe(0)
		expect(map.regions).toEqual([])
	})

	it("draws a declared place even when nothing joins it yet (#117)", () => {
		const map = buildPlacesMap({
			entries: [{ id: 1, name: "The Archive", parentId: null, place: true }],
			relationships: [],
			castNames: new Map()
		})
		expect(map.regions.map((r) => r.id)).toEqual([1])
		expect(map.mapped).toBe(1)
	})

	it("draws a parent whose own parent is off the map as a root", () => {
		const map = buildPlacesMap({
			entries: [entry(2, "The Archive", 99)],
			relationships: [link(10, 2, 3, "leads to")],
			castNames
		})
		expect(map.regions.map((r) => r.id)).toEqual([2])
	})
})

describe("buildPlacesMap — travel links are roads between boxes", () => {
	it("keeps an entry-to-entry edge whose type is a way of getting there", () => {
		const map = buildPlacesMap({
			entries: [entry(1, "The Reach"), entry(2, "The Archive")],
			relationships: [link(10, 1, 2, "Leads To")],
			castNames
		})
		expect(map.links).toEqual([
			{ id: 10, fromId: 1, toId: 2, label: "Leads To" }
		])
		expect(map.mapped).toBe(2)
	})

	it("leaves an entry-to-entry edge that is not travel off the map", () => {
		const map = buildPlacesMap({
			entries: [entry(1, "The Reach"), entry(2, "The Archive")],
			relationships: [link(10, 1, 2, "same author")],
			castNames
		})
		expect(map.links).toEqual([])
		expect(map.mapped).toBe(0)
	})
})

describe("buildPlacesMap — pins are who is standing in the room", () => {
	it("pins a member who lives in or keeps a place", () => {
		const map = buildPlacesMap({
			entries: [entry(1, "The Reach"), entry(2, "The Archive", 1)],
			relationships: [
				pin(10, 1, 2, "keeper of"),
				pin(11, 2, 1, "lives in")
			],
			castNames
		})
		expect(map.pins).toEqual([
			{
				key: "1@2",
				castId: 1,
				name: "Verity",
				entryId: 2,
				relationshipType: "keeper of"
			},
			{
				key: "2@1",
				castId: 2,
				name: "Marrow",
				entryId: 1,
				relationshipType: "lives in"
			}
		])
	})

	it("folds two pin edges from one member to one place into one pin", () => {
		const map = buildPlacesMap({
			entries: [entry(1, "The Reach")],
			relationships: [
				pin(10, 1, 1, "lives in"),
				pin(11, 1, 1, "keeper of"),
				// The same link recorded twice folds too.
				pin(12, 1, 1, "Lives in")
			],
			castNames
		})
		expect(map.pins).toEqual([
			{
				key: "1@1",
				castId: 1,
				name: "Verity",
				entryId: 1,
				relationshipType: "lives in, keeper of"
			}
		])
		expect(map.regions[0].pins).toHaveLength(1)
	})

	it("gives every pin in a region a distinct key", () => {
		const map = buildPlacesMap({
			entries: [entry(1, "The Reach")],
			relationships: [
				pin(10, 1, 1, "lives in"),
				pin(11, 2, 1, "keeper of"),
				pin(12, 1, 1, "keeper of")
			],
			castNames
		})
		const keys = map.regions[0].pins.map((p) => p.key)
		expect(new Set(keys).size).toBe(keys.length)
		expect(keys).toHaveLength(2)
	})

	it("hangs each pin off the region it is in", () => {
		const map = buildPlacesMap({
			entries: [entry(1, "The Reach"), entry(2, "The Archive", 1)],
			relationships: [pin(10, 1, 2, "keeper of")],
			castNames
		})
		expect(map.regions[0].children[0].pins.map((p) => p.name)).toEqual([
			"Verity"
		])
	})

	it("leaves a cast edge that is not a standing-in-a-place edge unpinned", () => {
		const map = buildPlacesMap({
			entries: [entry(1, "The Reach"), entry(2, "The Archive", 1)],
			relationships: [pin(10, 1, 2, "owes a debt")],
			castNames
		})
		expect(map.pins).toEqual([])
	})
})

describe("placesHeaderLine — the map, said out loud", () => {
	it("counts what is mapped and what joins it", () => {
		expect(placesHeaderLine(6, 9)).toBe("Places · 6 mapped · 9 links")
	})

	it("counts one of each in the singular", () => {
		expect(placesHeaderLine(1, 1)).toBe("Places · 1 mapped · 1 link")
	})

	it("says what to do on a map with nothing on it", () => {
		expect(placesHeaderLine(0, 0)).toBe(`Places · 0 · ${PLACES_EMPTY_LINE}`)
	})
})
