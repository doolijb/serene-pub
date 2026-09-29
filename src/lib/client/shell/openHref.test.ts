/**
 * An href is a string a notification carries for months; the reader it lands
 * on is decided here. Pin each shape to its reader so a rename says so.
 */
import { describe, expect, test, vi } from "vitest"
import { adminRouter } from "$lib/client/admin/adminRouter.svelte"
import { helpRouter } from "./helpRouter.svelte"
import { classifyHref, openHref } from "./openHref"

const goto = vi.fn(async () => {})
vi.mock("$app/navigation", () => ({
	goto: (...args: any[]) => goto(...(args as []))
}))

function fakeCtx() {
	const openPanel = vi.fn()
	const openView = vi.fn()
	return {
		panelsCtx: {
			digest: {} as any,
			openPanel,
			openView
		} as unknown as PanelsCtx,
		openPanel,
		openView
	}
}

describe("classifyHref", () => {
	test("a session page, with or without a landing, is a page", () => {
		expect(classifyHref("/sessions/42")).toEqual({
			kind: "page",
			href: "/sessions/42"
		})
		expect(classifyHref("/sessions/42?message=9&block=b1")).toEqual({
			kind: "page",
			href: "/sessions/42?message=9&block=b1"
		})
	})

	test("an admin address is the Admin view, landing kept", () => {
		expect(classifyHref("/admin/system#backups")).toEqual({
			kind: "admin",
			href: "/admin/system#backups"
		})
	})

	test("a docs address is the Help view", () => {
		expect(classifyHref("/docs/lorebooks#amendments")).toEqual({
			kind: "help",
			slug: "lorebooks",
			anchor: "amendments"
		})
	})

	test("a lore fragment wins on any path", () => {
		for (const href of ["#lore=12/all/3", "/sessions/4#lore=12/all/3"]) {
			const t = classifyHref(href)
			expect(t.kind).toBe("lore")
			if (t.kind === "lore")
				expect(t.route).toMatchObject({
					lorebookId: 12,
					scope: "all",
					entryId: 3
				})
		}
	})

	test("a fragment that is not a lore address is left to the page", () => {
		expect(classifyHref("/sessions/4#top")).toEqual({
			kind: "page",
			href: "/sessions/4#top"
		})
	})
})

describe("openHref", () => {
	test("lore: digest first, then the Lorebooks view", async () => {
		const { panelsCtx, openPanel } = fakeCtx()
		await openHref(panelsCtx, "#lore=12/all/3")
		expect(panelsCtx.digest.lore).toMatchObject({
			lorebookId: 12,
			entryId: 3
		})
		expect(openPanel).toHaveBeenCalledWith({ key: "lorebooks", toggle: false })
	})

	test("admin and help open their views in place", async () => {
		const { panelsCtx, openView, openPanel } = fakeCtx()
		await openHref(panelsCtx, "/admin/users/12")
		await openHref(panelsCtx, "/docs/tags#top")
		expect(openView).toHaveBeenCalledWith("admin", {
			toggle: false,
			fullPage: undefined
		})
		expect(openPanel).toHaveBeenCalledWith({ key: "help", toggle: false })
		expect(adminRouter.path).toBe("/admin/users/12")
		expect(helpRouter.slug).toBe("tags")
	})

	test("a page navigates", async () => {
		goto.mockClear()
		const { panelsCtx } = fakeCtx()
		await openHref(panelsCtx, "/sessions/42?message=9")
		expect(goto.mock.calls).toEqual([["/sessions/42?message=9"]])
	})
})
