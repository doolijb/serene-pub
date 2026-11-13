/**
 * Indexing progress lives in Activity (playtest 2, §0-C): a book whose entries
 * are being indexed for Search by meaning draws one card in *In progress* with
 * its label, "Indexing for Search by meaning · N of M entries" and a bar. No
 * Dismiss, no Stop: it ends by itself. Fed straight through the store.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, unmount } from "svelte"

vi.mock("$app/environment", () => ({
	dev: true,
	building: false,
	browser: true
}))
vi.mock("$app/navigation", () => ({ goto: () => {} }))

const socket = vi.hoisted(() => ({
	emit: () => {},
	on: () => {},
	off: () => {}
}))
vi.mock("$lib/client/sockets/typedSocket", () => ({
	useTypedSocket: () => socket,
	typedSocketOrNull: () => socket
}))
vi.mock("$lib/client/sockets/socketInstance", () => ({
	getSocket: () => socket
}))

import ActivitySidebar from "./ActivitySidebar.svelte"
import { lorebookIndexing } from "$lib/client/stores/lorebookIndexing.svelte"

let view: ReturnType<typeof mount> | null = null

function open(user: { id: number; isAdmin: boolean }) {
	view = mount(ActivitySidebar, {
		target: document.body,
		context: new Map<string, unknown>([
			["userCtx", { user }],
			[
				"panelsCtx",
				{ activeView: "activity", digest: {}, openPanel() {} }
			]
		])
	})
	flushSync()
}

afterEach(() => {
	if (view) unmount(view)
	view = null
	lorebookIndexing.receive([])
	document.body.innerHTML = ""
})

const record = {
	kind: "lorebook_indexing",
	id: "a1",
	userId: 7,
	lorebookId: 3,
	lorebookLabel: "Harbor",
	status: "running",
	indexedCount: 26,
	total: 27,
	startedAt: "2026-11-04T00:00:00.000Z"
}

describe("Activity: lorebook indexing", () => {
	test("draws the book, the count line and a progress bar", () => {
		lorebookIndexing.receive([record, { kind: "graph_build", id: "x" }])
		open({ id: 7, isAdmin: false })
		const text = document.body.textContent!.replace(/\s+/g, " ")
		expect(text).toContain("Harbor")
		expect(text).toContain(
			"Indexing for Search by meaning · 26 of 27 entries"
		)
		const bar = document.querySelector('[role="progressbar"]')!
		expect(bar.getAttribute("aria-label")).toBe("Indexing progress")
		expect(bar.getAttribute("aria-valuenow")).toBe("96")
		expect(document.body.textContent).not.toContain("Stop")
		expect(document.querySelector('[aria-label="Dismiss"]')).toBeNull()
	})

	test("the owner gets a button for the title, an administrator viewing another's does not", () => {
		lorebookIndexing.receive([record])
		open({ id: 7, isAdmin: false })
		expect(
			[...document.querySelectorAll("button")].some(
				(b) => b.textContent?.trim() === "Harbor"
			)
		).toBe(true)
		unmount(view!)
		view = null
		document.body.innerHTML = ""
		open({ id: 1, isAdmin: true })
		expect(
			[...document.querySelectorAll("button")].some(
				(b) => b.textContent?.trim() === "Harbor"
			)
		).toBe(false)
		expect(document.body.textContent).toContain("Harbor")
	})
})
