import { describe, expect, it } from "vitest"
import { resolveInViewLink } from "./helpLinks"

/**
 * The Help view's link rule.
 *
 * Every case here is a link the compiled documentation actually emits or a
 * shape that must NOT be swallowed — a link the view keeps by mistake is a
 * dead click, and one it lets through by mistake throws the reader out of the
 * app they were reading about.
 */
describe("resolveInViewLink", () => {
	it("keeps a link to another page", () => {
		expect(resolveInViewLink("/docs/characters")).toEqual({
			slug: "characters",
			anchor: ""
		})
	})

	it("keeps the anchor a page link carries", () => {
		expect(resolveInViewLink("/docs/characters#creator-wizard")).toEqual({
			slug: "characters",
			anchor: "creator-wizard"
		})
	})

	it("keeps a reference page, whose slug has slashes in it", () => {
		expect(
			resolveInViewLink("/docs/sdk/pipelines/core_spec_respond#slots")
		).toEqual({ slug: "sdk/pipelines/core_spec_respond", anchor: "slots" })
	})

	it.each(["/docs", "/docs/", "/docs#top"])(
		"reads %s as the index",
		(href) => {
			expect(resolveInViewLink(href, "characters")?.slug).toBeNull()
		}
	)

	// The outline's rows, and a page's references to its own headings.
	it("resolves an anchor-only link against the page being read", () => {
		expect(resolveInViewLink("#the-rail", "getting-around")).toEqual({
			slug: "getting-around",
			anchor: "the-rail"
		})
	})

	it("resolves an anchor-only link on the index to the index", () => {
		expect(resolveInViewLink("#anything", null)).toEqual({
			slug: null,
			anchor: "anything"
		})
	})

	it.each([
		["https://serenepub.com/docs/hosting", "an external site"],
		["http://localhost:5173/docs/hosting", "an absolute URL"],
		["//example.com/docs/hosting", "a protocol-relative host"],
		["mailto:someone@example.com", "a mailto"],
		["./characters.md", "an unrewritten relative markdown link"],
		["/sessions/3", "another app route"],
		["/docsomething", "a route that merely starts with the same letters"],
		["/docs/hosting?print=1", "a link carrying a query"],
		["", "an empty href"]
	])("leaves %s to the browser (%s)", (href) => {
		expect(resolveInViewLink(href, "characters")).toBeNull()
	})
})
