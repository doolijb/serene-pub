/**
 * Reading a manifest's `layouts` (R71): a genre's layout is display text like
 * any other name — a string or a locale map — and a locale map is read in
 * English for the row, never dropped as malformed.
 */
import { describe, expect, test, vi } from "vitest"

vi.mock("$lib/server/db", () => ({ db: {} }))

const { declaredLayoutsOf } = await import("./pluginLayouts")

const preset = { layout: { version: 2, zones: { middle: { rows: ["grow"], cols: ["grow"], units: [] } } } }

describe("declaredLayoutsOf", () => {
	test("reads a locale-map name and description in English", () => {
		const out = declaredLayoutsOf({
			layouts: [
				{ genreId: "acme.game:genre/g", slug: "default", name: { en: "Board", fr: "Plateau" }, description: { en: "The board" }, preset }
			]
		})
		expect(out.map((l) => [l.slug, l.name, l.description])).toEqual([["default", "Board", "The board"]])
	})

	test("still reads a plain string, and skips a layout with no name", () => {
		const out = declaredLayoutsOf({
			layouts: [
				{ genreId: "acme.game:genre/g", slug: "a", name: "A", preset },
				{ genreId: "acme.game:genre/g", slug: "b", name: { fr: "B" }, preset }
			]
		})
		expect(out.map((l) => l.slug)).toEqual(["a"])
	})
})
