/**
 * The resolver's whole job is a mapping, and a mapping is exactly what rots
 * silently: a reader that renames its digest key, or a panel that renames its
 * nav key, leaves a jump that opens an empty panel with no error anywhere. So
 * every branch is pinned to the literal key it writes and the literal panel it
 * opens — change one on purpose and this says so.
 */
import { describe, expect, test, vi } from "vitest"
import { openJumpHit } from "./openJumpHit"
import type { JumpHit } from "$lib/shared/sockets/jump"

const goto = vi.fn(async () => {})
vi.mock("$app/navigation", () => ({
	goto: (...args: any[]) => goto(...(args as []))
}))

function fakeCtx() {
	const openPanel = vi.fn()
	return {
		panelsCtx: { digest: {} as any, openPanel } as unknown as PanelsCtx,
		openPanel
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

describe("openJumpHit — the page kinds", () => {
	test("a session and a user navigate, and open no panel", async () => {
		goto.mockClear()
		const { panelsCtx, openPanel } = fakeCtx()
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
		expect(goto.mock.calls).toEqual([["/sessions/11"], ["/admin/users/12"]])
		expect(openPanel).not.toHaveBeenCalled()
		// NOT `digest.sessionId`, which opens the sidebar's edit form instead.
		expect(panelsCtx.digest).toEqual({})
	})
})

/**
 * The docs are the one kind whose destination depends on where the jump was
 * made FROM, and the one kind whose id is not a number — so both halves of the
 * branch are pinned, and so is the guard it has to run in front of.
 */
describe("openJumpHit — the documentation", () => {
	const hit: JumpHit = {
		kind: "doc",
		id: "getting-around",
		anchor: "the-rail",
		title: "The rail",
		subtitle: "Getting around"
	}

	test("from anywhere else it addresses the Help view, then opens it", async () => {
		const { panelsCtx, openPanel } = fakeCtx()
		goto.mockClear()
		await openJumpHit(panelsCtx, hit, { pathname: "/sessions/3" })
		expect(panelsCtx.digest).toEqual({
			help: { slug: "getting-around", anchor: "the-rail" }
		})
		expect(openPanel).toHaveBeenCalledWith({ key: "help", toggle: false })
		expect(goto).not.toHaveBeenCalled()
	})

	// Already reading the documentation as a full page: stay on it rather than
	// opening a 400px column over the page in front of you.
	test("from /docs it navigates, and opens no panel", async () => {
		const { panelsCtx, openPanel } = fakeCtx()
		goto.mockClear()
		await openJumpHit(panelsCtx, hit, { pathname: "/docs/sessions" })
		expect(goto).toHaveBeenCalledWith("/docs/getting-around#the-rail")
		expect(openPanel).not.toHaveBeenCalled()
		expect(panelsCtx.digest).toEqual({})
	})

	test("a page's own H1 carries no anchor into either destination", async () => {
		const top: JumpHit = { kind: "doc", id: "sessions", title: "Sessions" }
		const { panelsCtx } = fakeCtx()
		goto.mockClear()
		await openJumpHit(panelsCtx, top, { pathname: "/docs" })
		expect(goto).toHaveBeenCalledWith("/docs/sessions")

		const second = fakeCtx()
		await openJumpHit(second.panelsCtx, top, { pathname: "/" })
		expect(second.panelsCtx.digest).toEqual({
			help: { slug: "sessions", anchor: undefined }
		})
	})
})

describe("openJumpHit — a hit it cannot address", () => {
	test("an entry with no parent opens nothing rather than the wrong book", async () => {
		const { panelsCtx, openPanel } = fakeCtx()
		await openJumpHit(panelsCtx, {
			kind: "entry",
			id: 3,
			title: "An entry"
		})
		expect(openPanel).not.toHaveBeenCalled()
		expect(panelsCtx.digest).toEqual({})
	})

	test("a non-numeric id opens nothing — every kind but the docs", async () => {
		// `JumpHit.id` is `number | string`; every digest key and route below
		// the guard is numeric, so an id that is neither is not an address.
		const { panelsCtx, openPanel } = fakeCtx()
		await openJumpHit(panelsCtx, {
			kind: "character",
			id: "abc",
			title: "Nobody"
		})
		expect(openPanel).not.toHaveBeenCalled()
		expect(panelsCtx.digest).toEqual({})

		// The carve-out: a doc hit is addressed BY a slug, so it has to be
		// taken before the guard rather than dropped by it.
		const docs = fakeCtx()
		await openJumpHit(
			docs.panelsCtx,
			{ kind: "doc", id: "tags", title: "Tags" },
			{ pathname: "/" }
		)
		expect(docs.openPanel).toHaveBeenCalledWith({
			key: "help",
			toggle: false
		})
	})
})
