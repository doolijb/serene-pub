/**
 * The cast list's rows end with the member's macro (what an author pastes
 * into content) in a book the reader can edit; a read-only book's rows do not
 * show it.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

vi.mock("$app/environment", () => ({
	dev: true,
	building: false,
	browser: true
}))
vi.mock("$lib/client/utils/toaster", () => ({
	toaster: {
		success: vi.fn(),
		error: vi.fn(),
		info: vi.fn(),
		warning: vi.fn()
	}
}))

import { setSocket } from "$lib/client/sockets/socketInstance"
import {
	_resetInterestForTests,
	setInterestUser
} from "$lib/client/sockets/interest.svelte"
import { lineOf } from "$lib/shared/lorebooks/lineReading"
import { emptyRoute } from "$lib/shared/lorebooks/loreRoute"
import { loreRoute } from "../loreRoute.svelte"
import { openBookTime } from "../time/bookTime.svelte"
import { BookRelationships } from "../relationships.svelte"
import CastWorkspaceFixture from "../CastWorkspaceFixture.svelte"
import { staticBookData } from "../bookData.svelte"

const BOOK = 5

const client = {
	connected: true,
	id: "tab-a",
	on() {},
	off() {},
	emit() {}
}

let store: BookRelationships
let close: () => void
let app: ReturnType<typeof mount> | null = null

beforeEach(() => {
	setSocket(client as never)
	setInterestUser({ id: 1, isAdmin: false })
	openBookTime.open(BOOK)
	store = new BookRelationships(client as any)
	close = store.open(BOOK)
	store.load()
})
afterEach(() => {
	if (app) unmount(app)
	app = null
	close()
	loreRoute.set(emptyRoute())
	openBookTime.open(null)
	_resetInterestForTests()
	setSocket(null)
	document.body.innerHTML = ""
})

async function mountList(bookAccess: "owner" | "shared") {
	loreRoute.set({ lorebookId: BOOK, scope: "cast", castId: null } as any)
	const target = document.createElement("div")
	document.body.append(target)
	app = mount(CastWorkspaceFixture, {
		target,
		context: new Map<string, unknown>([
			["userSettingsCtx", { settings: { showAdvancedControls: false } }]
		]),
		props: {
			store,
			data: staticBookData(() => ({
				lorebookId: BOOK,
				bookAccess,
				cast: [
					{
						id: 10,
						name: "Verity",
						binding: "{{char:1}}",
						characterId: null,
						character: null
					}
				] as any
			})),
			lorebookId: BOOK,
			mode: "desk",
			hasUnsavedChanges: false,
			presences: [],
			line: lineOf(null, [])
		}
	})
	flushSync()
	await tick()
	await new Promise((r) => setTimeout(r, 0))
	flushSync()
}

describe("the cast list's macro", () => {
	test("an editable book's row ends with the member's macro", async () => {
		await mountList("owner")
		expect(document.querySelectorAll("[data-cast-row]")).toHaveLength(1)
		expect(document.querySelector("[data-cast-tag]")?.textContent?.trim()).toBe("{{char:1}}")
	})

	test("a read-only book's row names the member and shows no macro", async () => {
		await mountList("shared")
		const row = document.querySelector("[data-cast-row]")!
		expect(row.textContent).toContain("Verity")
		expect(document.querySelector("[data-cast-tag]")).toBeNull()
		expect(row.textContent).not.toContain("{{char:")
	})
})
