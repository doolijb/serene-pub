import { describe, expect, it } from "vitest"
import { ADMIN_NAV } from "./adminNav"
import { ADMIN_NAV_ICONS } from "./adminNavIcons"

describe("ADMIN_NAV_ICONS", () => {
	it("holds a component for every admin nav item", () => {
		const missing = ADMIN_NAV.flatMap((g) => g.items)
			.filter((i) => !ADMIN_NAV_ICONS[i.icon])
			.map((i) => `${i.href}: ${i.icon}`)
		expect(missing).toEqual([])
	})

	it("holds no icon the nav does not use", () => {
		const used = new Set(
			ADMIN_NAV.flatMap((g) => g.items.map((i) => i.icon))
		)
		expect(
			Object.keys(ADMIN_NAV_ICONS).filter((k) => !used.has(k as any))
		).toEqual([])
	})
})
