import { describe, expect, it } from "vitest"
import { loadLucideIcon } from "./lucideIconModules"

describe("loadLucideIcon", () => {
	it("resolves a canonical name that is not curated", async () => {
		expect(typeof (await loadLucideIcon("Anchor"))).toBe("function")
	})

	it("resolves an alias", async () => {
		expect(typeof (await loadLucideIcon("AlarmCheck"))).toBe("function")
	})

	it("resolves the barrel's LucideX and XIcon spellings", async () => {
		const house = await loadLucideIcon("House")
		expect(house).not.toBeNull()
		expect(await loadLucideIcon("HouseIcon")).toBe(house)
		expect(await loadLucideIcon("LucideHouse")).toBe(house)
	})

	it("resolves an unknown or empty name to null", async () => {
		expect(await loadLucideIcon("NoSuchIcon")).toBeNull()
		expect(await loadLucideIcon("")).toBeNull()
	})
})
