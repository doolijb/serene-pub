import { describe, expect, it } from "vitest"
import { matchAdminRoute, resolveAdminAlias, sectionHrefFor } from "./adminRoutes"

describe("admin routes", () => {
	it("matches literals before params", () => {
		expect(matchAdminRoute("/admin/pipelines/events").pattern).toBe("/admin/pipelines/events")
		expect(matchAdminRoute("/admin/pipelines/core:spec").params).toEqual({ slug: "core:spec" })
		expect(matchAdminRoute("/admin/users/new").pattern).toBe("/admin/users/new")
		expect(matchAdminRoute("/admin/users/5").params).toEqual({ id: "5" })
		// The event and history change views (Django's change view per row).
		expect(matchAdminRoute("/admin/pipelines/events/core%3Asession%2Fcreated").params).toEqual({
			id: "core:session/created"
		})
		expect(matchAdminRoute("/admin/history/42").pattern).toBe("/admin/history/:id")
	})

	it("falls back to the overview for unknown addresses", () => {
		const m = matchAdminRoute("/admin/nope/at/all")
		expect(m.route).toBeNull()
		expect(m.pattern).toBe("/admin")
	})

	it("redirects the moved Settings and Servers addresses, query intact", () => {
		expect(resolveAdminAlias("/admin/settings")).toBe("/admin/general")
		expect(resolveAdminAlias("/admin/servers?x=1")).toBe("/admin/network?x=1")
		expect(resolveAdminAlias("/admin/prompts")).toBe("/admin/prompts")
	})

	it("finds the nav row by longest prefix, /admin only exactly", () => {
		const hrefs = ["/admin", "/admin/pipelines", "/admin/pipelines/events"]
		expect(sectionHrefFor("/admin", hrefs)).toBe("/admin")
		expect(sectionHrefFor("/admin/pipelines/x", hrefs)).toBe("/admin/pipelines")
		expect(sectionHrefFor("/admin/pipelines/events", hrefs)).toBe("/admin/pipelines/events")
		expect(sectionHrefFor("/admin/defaults", hrefs)).toBeNull()
	})
})
