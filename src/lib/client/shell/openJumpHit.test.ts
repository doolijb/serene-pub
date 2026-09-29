/**
 * The resolver's whole job is a mapping, and a mapping is exactly what rots
 * silently: a reader that renames its digest key, or a panel that renames its
 * nav key, leaves a jump that opens an empty panel with no error anywhere. So
 * every branch is pinned to the literal key it writes and the literal panel it
 * opens — change one on purpose and this says so.
 */
import { describe, expect, test, vi } from "vitest"
import { adminRouter } from "$lib/client/admin/adminRouter.svelte"
import { helpRouter } from "./helpRouter.svelte"
import { openJumpHit } from "./openJumpHit"
import type { JumpHit } from "$lib/shared/sockets/jump"

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

describe("openJumpHit — the panel kinds", () => {
	test.each([
		[
			{ kind: "character", id: 7, title: "c" },
			"characters",
			{ viewCharacterId: 7 }
		],
		// A persona is a character with a hint, never a kind of its own — it
		// takes the character branch and the same digest key.
		[
			{ kind: "character", id: 8, title: "p", hint: "persona" },
			"characters",
			{ viewCharacterId: 8 }
		],
		[
			{ kind: "lorebook", id: 9, title: "b" },
			"lorebooks",
			{ lore: { lorebookId: 9, scope: "all" } }
		],
		[
			{ kind: "entry", id: 3, parentId: 9, title: "e" },
			"lorebooks",
			{ lore: { lorebookId: 9, scope: "all", entryId: 3 } }
		],
		// No digest key exists for a tag — see the branch's own note.
		[{ kind: "tag", id: 4, title: "t" }, "tags", {}],
		[
			{ kind: "connection", id: 5, title: "x" },
			"connections",
			{ connectionId: 5 }
		]
	] as [JumpHit, string, Record<string, unknown>][])(
		"a $kind hit addresses then opens its panel",
		async (hit, key, digest) => {
			const { panelsCtx, openPanel } = fakeCtx()
			await openJumpHit(panelsCtx, hit)
			// `toggle: false` — a jump always opens, it never closes the panel
			// the person was already looking at.
			expect(openPanel).toHaveBeenCalledWith({ key, toggle: false })
			expect(panelsCtx.digest).toEqual(digest)
		}
	)
})

/**
 * Shift Enter / Shift click: the same address, the view opened full page
 * (`fullPage` is today's name for Focus). Never the sidebar call as well —
 * one open, not two.
 */
describe("openJumpHit — focused", () => {
	test.each([
		[{ kind: "character", id: 7, title: "c" }, "characters"],
		[{ kind: "lorebook", id: 9, title: "b" }, "lorebooks"],
		[{ kind: "entry", id: 3, parentId: 9, title: "e" }, "lorebooks"],
		[{ kind: "tag", id: 4, title: "t" }, "tags"],
		[{ kind: "connection", id: 5, title: "x" }, "connections"],
		[{ kind: "doc", id: "tags", title: "Tags" }, "help"]
	] as [JumpHit, string][])(
		"a $kind hit opens its view focused",
		async (hit, key) => {
			const { panelsCtx, openPanel, openView } = fakeCtx()
			await openJumpHit(panelsCtx, hit, { focus: true })
			expect(openView).toHaveBeenCalledWith(key, {
				toggle: false,
				fullPage: true
			})
			expect(openPanel).not.toHaveBeenCalled()
		}
	)

	test("the address is the same as the sidebar's", async () => {
		const { panelsCtx } = fakeCtx()
		await openJumpHit(
			panelsCtx,
			{ kind: "entry", id: 3, parentId: 9, title: "e" },
			{ focus: true }
		)
		expect(panelsCtx.digest).toEqual({
			lore: { lorebookId: 9, scope: "all", entryId: 3 }
		})
	})

	test("a page stays a page: a session navigates; a user opens Admin focused", async () => {
		goto.mockClear()
		const { panelsCtx, openPanel, openView } = fakeCtx()
		await openJumpHit(
			panelsCtx,
			{ kind: "session", id: 11, title: "A session" },
			{ focus: true }
		)
		await openJumpHit(
			panelsCtx,
			{ kind: "user", id: 12, title: "Someone" },
			{ focus: true }
		)
		await openJumpHit(
			panelsCtx,
			{ kind: "doc", id: "tags", title: "Tags" },
			{ focus: true }
		)
		expect(goto.mock.calls).toEqual([["/sessions/11"]])
		// Admin and Help are views, not pages: each opens focused.
		expect(openView.mock.calls).toEqual([
			["admin", { toggle: false, fullPage: true }],
			["help", { toggle: false, fullPage: true }]
		])
		expect(helpRouter.slug).toBe("tags")
		expect(adminRouter.path).toBe("/admin/users/12")
		expect(openPanel).not.toHaveBeenCalled()
	})
})

describe("openJumpHit — the page kinds", () => {
	test("a session navigates; a user opens the Admin view at its page", async () => {
		goto.mockClear()
		const { panelsCtx, openPanel, openView } = fakeCtx()
		await openJumpHit(panelsCtx, {
			kind: "session",
			id: 11,
			title: "A session"
		})
		await openJumpHit(panelsCtx, {
			kind: "user",
			id: 12,
			title: "Someone"
		})
		expect(goto.mock.calls).toEqual([["/sessions/11"]])
		expect(openView.mock.calls).toEqual([
			["admin", { toggle: false, fullPage: undefined }]
		])
		expect(openPanel).not.toHaveBeenCalled()
		// NOT `digest.sessionId`, which opens the sidebar's edit form instead.
		expect(panelsCtx.digest).toEqual({})
	})
})

/**
 * The docs are the one kind whose id is not a number, so the branch is pinned,
 * and so is the guard it has to run in front of.
 */
describe("openJumpHit — the documentation", () => {
	const hit: JumpHit = {
		kind: "doc",
		id: "getting-around",
		anchor: "the-rail",
		title: "The rail",
		subtitle: "Getting around"
	}

	test("it moves the Help view to the section, then opens it", async () => {
		const { panelsCtx, openPanel } = fakeCtx()
		goto.mockClear()
		await openJumpHit(panelsCtx, hit)
		expect(helpRouter.slug).toBe("getting-around")
		expect(helpRouter.anchor.anchor).toBe("the-rail")
		expect(openPanel).toHaveBeenCalledWith({ key: "help", toggle: false })
		expect(goto).not.toHaveBeenCalled()
		expect(panelsCtx.digest).toEqual({})
	})

	test("a page's own H1 carries no anchor", async () => {
		const top: JumpHit = { kind: "doc", id: "sessions", title: "Sessions" }
		const { panelsCtx } = fakeCtx()
		await openJumpHit(panelsCtx, top)
		expect(helpRouter.slug).toBe("sessions")
		expect(helpRouter.anchor.anchor).toBe("")
	})
})
