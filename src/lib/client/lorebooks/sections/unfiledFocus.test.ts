import { beforeEach, describe, expect, test, vi } from "vitest"

const { nav, route } = vi.hoisted(() => ({
	nav: [] as any[],
	route: { lens: undefined as string | undefined }
}))
vi.mock("../loreRoute.svelte", () => ({
	loreRoute: {
		get route() {
			return route
		},
		navigate: async (a: any) => void nav.push(a)
	}
}))

import { openUnfiledScene, takeUnfiledFocus } from "./unfiledFocus.svelte"

beforeEach(() => {
	nav.length = 0
	route.lens = undefined
	takeUnfiledFocus(1)
	takeUnfiledFocus(2)
})

describe("unfiled scene focus", () => {
	test("opens History and leaves the handoff; the list lens stays", async () => {
		route.lens = "list"
		await openUnfiledScene({ id: 8, lorebookId: 1 })
		expect(nav).toEqual([{ type: "openScope", scope: "history" }])
		expect(takeUnfiledFocus(1)).toBe(8)
	})
	test("from a lens that does not list the pool, switches to the list", async () => {
		route.lens = "time"
		await openUnfiledScene({ id: 8, lorebookId: 1 })
		expect(nav).toEqual([
			{ type: "openScope", scope: "history" },
			{ type: "setLens", lens: "list" }
		])
	})
	test("taken once, and for its own book only", async () => {
		await openUnfiledScene({ id: 8, lorebookId: 1 })
		expect(takeUnfiledFocus(2)).toBe(null)
		expect(takeUnfiledFocus(1)).toBe(8)
		expect(takeUnfiledFocus(1)).toBe(null)
	})
})
