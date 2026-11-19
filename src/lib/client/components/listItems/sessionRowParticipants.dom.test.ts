/**
 * A session row's second menu action opens the participants view for a
 * non-owner (owner ruling G1, 2026-11-16): it reads Participants, not Edit.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

vi.mock("$app/environment", () => ({ dev: true, building: false, browser: true }))
vi.mock("$app/navigation", () => ({
	replaceState: vi.fn(),
	goto: vi.fn(),
	pushState: vi.fn(),
	afterNavigate: vi.fn(),
	beforeNavigate: vi.fn(),
	onNavigate: vi.fn()
}))
vi.mock("$app/state", () => ({
	page: { url: new URL("http://localhost/"), state: {}, params: {} }
}))

import SessionListItem from "./SessionListItem.svelte"
import SessionCardItem from "./SessionCardItem.svelte"

let app: ReturnType<typeof mount> | null = null
afterEach(() => {
	if (app) unmount(app)
	app = null
	document.body.innerHTML = ""
})

const session = (isOwner: boolean) =>
	({
		id: 3,
		name: "The crawl",
		canEdit: true,
		isOwner,
		sessionCharacters: [],
		sessionPersonas: [],
		sessionGuests: [],
		updatedAt: new Date().toISOString()
	}) as any

async function labels(Item: any, isOwner: boolean) {
	app = mount(Item, {
		target: document.body,
		props: {
			session: session(isOwner),
			onclick: () => {},
			onEdit: () => {},
			onDelete: () => {},
			onToggleFavorite: () => {}
		}
	})
	flushSync()
	const trigger = document.querySelector(
		'button[aria-haspopup="menu"]'
	) as HTMLButtonElement
	trigger.click()
	await tick()
	flushSync()
	await new Promise((r) => setTimeout(r, 50))
	return [...document.querySelectorAll('[role="menuitem"]')].map((e) =>
		(e.textContent ?? "").trim()
	)
}

describe.each([
	["list row", SessionListItem],
	["card", SessionCardItem]
])("the %s menu", (_name, Item) => {
	test("reads Edit for the owner", async () => {
		const items = await labels(Item, true)
		expect(items).toContain("Edit")
		expect(items).not.toContain("Participants")
	})
	test("reads Participants for a guest", async () => {
		const items = await labels(Item, false)
		expect(items).toContain("Participants")
		expect(items).not.toContain("Edit")
	})
})
