/**
 * **Copy to my characters** on the member page: shown to an editor and to a
 * reader of a shared book (outside the read-only fieldset), it emits
 * `characters:duplicate { castMemberId }`, and only the copy this page asked
 * for opens in Characters. A refusal only re-arms the button.
 *
 * ⚠ The chosen tab is module state of `CastWorkspace`: pick Member first.
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
const BIANCA = 10
const ME = 1

type Listener = (payload: any) => void
function makeClientSocket() {
	const listeners = new Map<string, Listener[]>()
	return {
		connected: true,
		id: "tab-a",
		emits: [] as Array<{ event: string; payload: any }>,
		on(event: string, fn: Listener) {
			listeners.set(event, [...(listeners.get(event) ?? []), fn])
		},
		off(event: string, fn: Listener) {
			const arr = listeners.get(event) ?? []
			const at = arr.indexOf(fn)
			if (at !== -1) arr.splice(at, 1)
		},
		emit(event: string, payload: any) {
			this.emits.push({ event, payload })
		},
		dispatch(event: string, payload: any) {
			for (const fn of [...(listeners.get(event) ?? [])]) fn(payload)
		}
	}
}

const MEMBERS = [
	{
		id: BIANCA,
		name: "Bianca",
		binding: "{{char:1}}",
		characterId: 70,
		character: { id: 70, userId: 2, name: "Bianca", isPersona: false }
	}
]

let client: ReturnType<typeof makeClientSocket>
let store: BookRelationships
let close: () => void
let app: ReturnType<typeof mount> | null = null

beforeEach(() => {
	client = makeClientSocket()
	setSocket(client as never)
	setInterestUser({ id: ME, isAdmin: false })
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

async function settle() {
	flushSync()
	await tick()
	await new Promise((r) => setTimeout(r, 0))
	flushSync()
}

async function mountMember(
	book: { bookAccess?: "owner" | "shared" | "admin" } = {}
) {
	const panelsCtx = {
		digest: {} as Record<string, unknown>,
		openPanel: vi.fn()
	}
	loreRoute.set({ lorebookId: BOOK, scope: "cast", castId: BIANCA })
	const target = document.createElement("div")
	document.body.append(target)
	app = mount(CastWorkspaceFixture, {
		target,
		context: new Map<string, unknown>([
			["userCtx", { user: { id: ME, isAdmin: false } }],
			["panelsCtx", panelsCtx]
		]),
		props: {
			store,
			data: staticBookData(() => ({
				lorebookId: BOOK,
				cast: MEMBERS as any,
				rawRows: {},
				scenes: [],
				...book
			})),
			lorebookId: BOOK,
			mode: "desk",
			hasUnsavedChanges: false,
			presences: [],
			line: lineOf(null, [])
		}
	})
	await settle()
	;[
		...document.querySelectorAll<HTMLButtonElement>(
			'[data-cast-member-page] [role="tab"]'
		)
	]
		.find((t) => /^Member/.test((t.textContent ?? "").trim()))
		?.click()
	await settle()
	return panelsCtx
}

const copyBtn = () =>
	document.querySelector<HTMLButtonElement>(
		"[data-cast-copy-to-my-characters]"
	)
const text = (el: Element | null | undefined) =>
	(el?.textContent ?? "").replace(/\s+/g, " ").trim()
const duplicates = () =>
	client.emits.filter((e) => e.event === "characters:duplicate")

describe("Copy to my characters on the member page", () => {
	test("an editor sees it, enabled, outside the fieldset", async () => {
		await mountMember()
		expect(text(copyBtn())).toBe("Copy to my characters")
		expect(copyBtn()!.disabled).toBe(false)
		expect(copyBtn()!.closest("fieldset")).toBeNull()
	})

	test("a reader of a shared book sees it enabled while the form reads", async () => {
		await mountMember({ bookAccess: "shared" })
		expect(
			document
				.querySelector("fieldset[data-lore-read-only]")
				?.hasAttribute("disabled")
		).toBe(true)
		expect(copyBtn()).not.toBeNull()
		expect(copyBtn()!.disabled).toBe(false)
		expect(copyBtn()!.closest("fieldset")).toBeNull()
	})

	test("a click asks for the copy, disabled while pending; the reply opens it in Characters", async () => {
		const panels = await mountMember()
		copyBtn()!.click()
		await settle()
		expect(duplicates()).toEqual([
			{
				event: "characters:duplicate",
				payload: { castMemberId: BIANCA }
			}
		])
		expect(copyBtn()!.disabled).toBe(true)
		client.dispatch("characters:duplicate", { character: { id: 99 } })
		await settle()
		expect(panels.digest.characterId).toBe(99)
		expect(panels.openPanel).toHaveBeenCalledWith({
			key: "characters",
			toggle: false
		})
		expect(copyBtn()!.disabled).toBe(false)
	})

	test("a refusal re-enables the button and opens nothing", async () => {
		const panels = await mountMember()
		copyBtn()!.click()
		await settle()
		client.dispatch("characters:duplicate:error", {
			error: "Cast member not found.",
			castMemberId: BIANCA
		})
		await settle()
		expect(copyBtn()!.disabled).toBe(false)
		expect(panels.openPanel).not.toHaveBeenCalled()
	})

	test("a copy this page did not ask for opens nothing", async () => {
		const panels = await mountMember()
		client.dispatch("characters:duplicate", { character: { id: 99 } })
		await settle()
		expect(panels.openPanel).not.toHaveBeenCalled()
		expect(panels.digest.characterId).toBeUndefined()
	})
})
