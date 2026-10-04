import { describe, expect, it } from "vitest"
import { ADMIN_NAV } from "$lib/client/shell/adminNav"
import {
	adminCrumbs,
	changelistReturnHref,
	rememberChangelistQuery
} from "./breadcrumbs"

describe("adminCrumbs", () => {
	it("is empty on the Overview (the root)", () => {
		expect(adminCrumbs("/admin", ADMIN_NAV)).toEqual([])
	})
	it("ends on the section, unlinked, on a changelist", () => {
		expect(adminCrumbs("/admin/prompts", ADMIN_NAV, { current: "Prompts" })).toEqual([
			{ label: "Admin", href: "/admin" },
			{ label: "Writing" },
			{ label: "Prompts" }
		])
	})
	it("links the section and ends on the object on a change form", () => {
		const c = adminCrumbs("/admin/sampling/4", ADMIN_NAV, { current: "Creative" })
		expect(c.map((x) => x.label)).toEqual(["Admin", "Models", "Sampling", "Creative"])
		expect(c[2].href).toBe("/admin/sampling")
		expect(c[3].href).toBeUndefined()
	})
	it("picks the longest section (Events is not Pipelines)", () => {
		const c = adminCrumbs("/admin/pipelines/events", ADMIN_NAV, { current: "Events" })
		expect(c.map((x) => x.label)).toEqual(["Admin", "Pipelines", "Events"])
	})
	it("ends on the event on an event's change view (its id encoded)", () => {
		const c = adminCrumbs("/admin/pipelines/events/core%3Aevent%2Fsession-created%401", ADMIN_NAV, {
			current: "Session created"
		})
		expect(c.map((x) => x.label)).toEqual(["Admin", "Pipelines", "Events", "Session created"])
		expect(c[2].href).toBe("/admin/pipelines/events")
	})
	it("puts a trail between the section and the page", () => {
		const c = adminCrumbs("/admin/connections/3", ADMIN_NAV, {
			current: "Delete",
			trail: [{ label: "Ollama", href: "/admin/connections/3" }]
		})
		expect(c.map((x) => x.label)).toEqual(["Admin", "Models", "Connections", "Ollama", "Delete"])
	})
	it("brings the section crumb back to the list as it was left", () => {
		rememberChangelistQuery("/admin/prompts", "?genre=chat&p=2")
		expect(changelistReturnHref("/admin/prompts")).toBe("/admin/prompts?genre=chat&p=2")
		const c = adminCrumbs("/admin/prompts/9", ADMIN_NAV, { current: "Reply" })
		expect(c[2].href).toBe("/admin/prompts?genre=chat&p=2")
		rememberChangelistQuery("/admin/prompts", "")
		expect(changelistReturnHref("/admin/prompts")).toBe("/admin/prompts")
	})
})

describe("a step that is not an address", () => {
	it("ends on the leaf even on the section's own address, the section crumb going back", () => {
		const back = () => {}
		const c = adminCrumbs("/admin/prompts", ADMIN_NAV, { current: "Delete 2 prompts?", leaf: "Delete", sectionOnclick: back })
		expect(c.map((x) => x.label)).toEqual(["Admin", "Writing", "Prompts", "Delete"])
		expect(c[2].onclick).toBe(back)
		expect(c[2].href).toBeUndefined()
	})
	it("on an object's page: section › object › Delete", () => {
		const c = adminCrumbs("/admin/prompts/9", ADMIN_NAV, {
			current: "Delete Reply?",
			leaf: "Delete",
			trail: [{ label: "Reply" }]
		})
		expect(c.map((x) => x.label)).toEqual(["Admin", "Writing", "Prompts", "Reply", "Delete"])
		expect(c[2].href).toBe("/admin/prompts")
	})
})
