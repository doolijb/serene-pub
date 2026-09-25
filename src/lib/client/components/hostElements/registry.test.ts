/**
 * The boot gate for the host-element vocabulary (C1b): every sp element the SDK
 * names has an implementation here, and nothing here is an sp element the SDK
 * does not name. A gap either way is an element the page drops silently.
 */
import { describe, expect, test } from "vitest"
import { SP_ELEMENTS, spElementGaps, spElementTags } from "./registry"

describe("sp elements", () => {
	test("every sp element in SP_HOST_ELEMENTS is implemented, and nothing else is", () => {
		expect(spElementGaps()).toEqual({ missing: [], unknown: [] })
		expect(Object.keys(SP_ELEMENTS).sort()).toEqual(spElementTags().sort())
	})

	test("an sp element that reads children as data reads only sp elements", () => {
		for (const [tag, def] of Object.entries(SP_ELEMENTS))
			for (const child of def.dataChildren ?? [])
				expect(SP_ELEMENTS[child], `${tag} reads ${child}`).toBeDefined()
	})
})
