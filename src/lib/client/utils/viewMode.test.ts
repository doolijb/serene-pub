/**
 * `createViewMode` — the remembered list/card pair (Characters, Sessions,
 * Home). Pins the 2026-10-24 rule (PLAN-0-5-polish-parity L6): the default
 * may follow the width until the person picks, and a pick wins everywhere.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { createViewMode } from "./viewMode.svelte"

function fakeStorage(initial: Record<string, string> = {}) {
	const map = new Map(Object.entries(initial))
	return {
		map,
		getItem: (key: string) => map.get(key) ?? null,
		setItem: (key: string, value: string) => void map.set(key, value)
	}
}

afterEach(() => {
	vi.unstubAllGlobals()
})

describe("createViewMode", () => {
	test("a fixed default until a pick, and the pick is stored", () => {
		const storage = fakeStorage()
		vi.stubGlobal("localStorage", storage)
		const mode = createViewMode("k", "cards")
		expect(mode.value).toBe("cards")
		mode.value = "list"
		expect(mode.value).toBe("list")
		expect(storage.map.get("k")).toBe("list")
	})

	test("a function default is read each time, until the person picks", () => {
		vi.stubGlobal("localStorage", fakeStorage())
		let width = "dock"
		const mode = createViewMode("k", () =>
			width === "dock" ? "list" : "cards"
		)
		expect(mode.value).toBe("list")
		width = "half"
		expect(mode.value).toBe("cards")
		mode.value = "list"
		width = "focus"
		expect(mode.value).toBe("list")
	})

	test("a stored pick wins over the default at every width", () => {
		vi.stubGlobal("localStorage", fakeStorage({ k: "cards" }))
		const mode = createViewMode("k", () => "list")
		expect(mode.value).toBe("cards")
	})

	test("storage that throws is no information: the default", () => {
		vi.stubGlobal("localStorage", {
			getItem: () => {
				throw new Error("blocked")
			},
			setItem: () => {
				throw new Error("blocked")
			}
		})
		const mode = createViewMode("k", "list")
		expect(mode.value).toBe("list")
		mode.value = "cards"
		expect(mode.value).toBe("cards")
	})
})
