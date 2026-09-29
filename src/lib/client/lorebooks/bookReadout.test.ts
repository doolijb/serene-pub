import { describe, expect, it } from "vitest"
import { bookReadout, READOUT_NOTE, type BookReadoutInput } from "./bookReadout"
import { SCENE_KIND } from "./poolFilter"
import { CAST_KIND } from "./scopes"

const WORLD = "core:entry/world-lore"
const CHARACTER = "core:entry/character-lore"
const HISTORY = "core:entry/history"

/** The book on the Settings board of the artifact. */
function input(over: Partial<BookReadoutInput> = {}): BookReadoutInput {
	return {
		counts: {
			[WORLD]: 12,
			[CHARACTER]: 7,
			[HISTORY]: 9,
			[SCENE_KIND]: 2,
			[CAST_KIND]: 7
		},
		castWithLore: 5,
		relationships: 9,
		dated: { earliest: "Y1 Founding", latest: "Y3 Frostfall 12" },
		scenesWaiting: 1,
		capturedFrom: "The Open Door",
		nested: 12,
		depth: 4,
		branches: ["main"],
		...over
	}
}

const lineOf = (id: string, over?: Partial<BookReadoutInput>) =>
	bookReadout(input(over)).find((l) => l.id === id)!

describe("bookReadout — what this book holds", () => {
	it("reads every line the board names, in order", () => {
		expect(bookReadout(input()).map((l) => l.id)).toEqual([
			"world",
			"cast",
			"history",
			"scenes",
			"nested",
			"branches",
			"places"
		])
	})

	it("describes world lore by what it is for", () => {
		expect(lineOf("world")).toEqual({
			id: "world",
			label: "World lore",
			count: 12,
			detail: ["places, things and rules"]
		})
	})

	it("counts the cast, their lore and their relationships", () => {
		expect(lineOf("cast")).toEqual({
			id: "cast",
			label: "Cast",
			count: 7,
			detail: [
				"5 carry lore of their own",
				"9 relationships between them"
			]
		})
	})

	it("names the ends of the story rather than only counting dates", () => {
		expect(lineOf("history").detail).toEqual([
			"dated entries, earliest Y1 Founding, latest Y3 Frostfall 12"
		])
	})

	it("says nothing is dated rather than inventing a range", () => {
		expect(lineOf("history", { counts: null, dated: undefined })).toEqual({
			id: "history",
			label: "History",
			count: 0,
			detail: ["nothing is dated yet"]
		})
	})

	it("says where scenes were captured and how many are waiting", () => {
		expect(lineOf("scenes").detail).toEqual([
			"captured from The Open Door",
			"1 waiting to compile"
		])
	})

	it("counts the nesting and how deep it goes", () => {
		expect(lineOf("nested").detail).toEqual([
			"entries sit inside another, 4 levels deep at most"
		])
	})

	it("reads one nested entry in the singular", () => {
		expect(lineOf("nested", { nested: 1, depth: 1 }).detail).toEqual([
			"entry sits inside another, 1 level deep at most"
		])
	})

	it("says nothing is nested when nothing is", () => {
		expect(lineOf("nested", { nested: 0, depth: 0 }).detail).toEqual([
			"nothing sits inside anything else"
		])
	})

	it("says main only when the book has no branches", () => {
		expect(lineOf("branches")).toEqual({
			id: "branches",
			label: "Lines",
			count: 1,
			detail: ["main only"]
		})
	})

	it("names every line when the book has branches (#90, #133)", () => {
		const line = lineOf("branches", {
			branches: ["main", "marrow-stays", "the long winter"]
		})
		expect(line.count).toBe(3)
		expect(line.detail).toEqual(["main, marrow-stays, the long winter"])
		expect(line.detail.join(" ")).not.toContain("not built")
	})

	it("says there are no places when no Location entry exists", () => {
		expect(lineOf("places")).toEqual({
			id: "places",
			label: "Places",
			count: 0,
			detail: ["no Location entries yet"]
		})
	})

	it("counts places the server has counted", () => {
		expect(
			lineOf("places", {
				counts: { ...input().counts!, places: 3 }
			}).detail
		).toEqual([])
	})

	it("reads a figure that has not arrived as none rather than as unknown", () => {
		expect(
			bookReadout(input({ counts: null })).map((l) => l.count)
		).toEqual([0, 0, 0, 0, 12, 1, 0])
	})
})

describe("the note under the readout", () => {
	it("says the readout is not a set of switches", () => {
		expect(READOUT_NOTE).toContain("not a set of features to switch on")
		expect(READOUT_NOTE).toContain(
			"Every capability is available in every lorebook"
		)
	})

	it("is written without an em-dash, like every other line of copy", () => {
		expect(READOUT_NOTE).not.toContain("—")
		for (const line of bookReadout(input()))
			for (const detail of line.detail) expect(detail).not.toContain("—")
	})
})
