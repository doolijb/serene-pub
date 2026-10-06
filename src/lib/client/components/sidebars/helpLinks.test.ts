import { describe, expect, it } from "vitest"
import { helpAnchorId, isExternalDocLink, resolveInViewLink } from "./helpLinks"

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
			resolveInViewLink("/docs/sdk/pipelines/core_spec_chat-respond#slots")
		).toEqual({ slug: "sdk/pipelines/core_spec_chat-respond", anchor: "slots" })
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

/**
 * The Help view's anchor rule.
 *
 * The view renames every id inside its article so the same page open on
 * `/docs` behind it keeps the ids it owns. This helper is the only thing that
 * knows the new name, and it is handed anchors from four places — a Jump hit,
 * the outline, a cross-page link's fragment, and a link inside the article
 * whose href the same rewrite has already rebased — so it has to answer the
 * same way for a name it has seen and one it has not.
 */
describe("helpAnchorId", () => {
	it("scopes a bare doc anchor to this view", () => {
		expect(helpAnchorId("the-rail")).toBe("help:the-rail")
	})

	it("leaves an anchor it has already scoped alone", () => {
		expect(helpAnchorId("help:the-rail")).toBe("help:the-rail")
	})

	// The regression this prefix exists for: `help-and-about` is a real
	// heading in the getting-started guide, and a `help-` prefix could not
	// tell it from an id this view had already scoped.
	it("scopes a doc anchor that itself begins with the word help", () => {
		expect(helpAnchorId("help")).toBe("help:help")
		expect(helpAnchorId("help-and-about")).toBe("help:help-and-about")
	})

	// The top of the page, which is not an element and must not become one.
	it("leaves an empty anchor empty", () => {
		expect(helpAnchorId("")).toBe("")
	})
})

describe("isExternalDocLink", () => {
	const origin = "http://localhost:5173"
	it("is true only for http(s) URLs on another origin", () => {
		expect(isExternalDocLink("https://github.com/x", origin)).toBe(true)
		expect(isExternalDocLink("HTTP://example.com", origin)).toBe(true)
		expect(isExternalDocLink("http://localhost:5173/docs/sessions", origin)).toBe(false)
		expect(isExternalDocLink("/docs/sessions#a", origin)).toBe(false)
		expect(isExternalDocLink("#top", origin)).toBe(false)
		expect(isExternalDocLink("./install.md", origin)).toBe(false)
		expect(isExternalDocLink("mailto:a@b.c", origin)).toBe(false)
	})
})
