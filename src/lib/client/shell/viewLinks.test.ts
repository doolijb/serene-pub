import { describe, expect, test } from "vitest"
import { viewLinkFor } from "./viewLinks"

describe("viewLinkFor", () => {
	test.each([
		["/admin", { view: "admin", href: "/admin" }],
		["/admin/general#accounts", { view: "admin", href: "/admin/general#accounts" }],
		["/admin/pipelines?runs=failed", { view: "admin", href: "/admin/pipelines?runs=failed" }],
		["/docs", { view: "help", slug: null, anchor: "" }],
		["/docs/hosting#database-wont-open", { view: "help", slug: "hosting", anchor: "database-wont-open" }],
		["/docs/sdk/laws/", { view: "help", slug: "sdk/laws", anchor: "" }]
	])("%s", (href, expected) => {
		expect(viewLinkFor(href)).toEqual(expected)
	})

	test.each([
		["/administrator"],
		["/docsomething"],
		["/document-view/docs/hosting"],
		["/docs/hosting?x=1"],
		["https://serenepub.com/docs/hosting"],
		["//evil.example/admin"],
		["#top"],
		["/sessions/4"]
	])("%s is left to the browser", (href) => {
		expect(viewLinkFor(href)).toBeNull()
	})
})
