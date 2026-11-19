/**
 * 🚧 The Edit history fold for a scene: the same fold as an entry's, asked and
 * answered on `scenes:*`, with no clear of its own.
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
import EditHistory from "./EditHistory.svelte"

const SCENE = 7
const BOOK = 2

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

let client: ReturnType<typeof makeClientSocket>
let app: ReturnType<typeof mount> | null = null
let props: { lorebookId: number; sceneId: number; restoreBlocked?: string }

beforeEach(() => {
	client = makeClientSocket()
	setSocket(client as never)
	setInterestUser({ id: 1, isAdmin: false })
})

afterEach(() => {
	if (app) unmount(app)
	app = null
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

const sent = (event: string) => client.emits.filter((e) => e.event === event)

async function mountFold(over: Partial<typeof props> = {}) {
	const live = $state({ lorebookId: BOOK, sceneId: SCENE, ...over })
	props = live
	const target = document.createElement("div")
	document.body.append(target)
	app = mount(EditHistory, { target, props })
	await settle()
}

const person = (id: number, names: string[]) => ({
	id,
	amendmentId: null,
	version: null,
	cause: "scene-compiler",
	who: "Scene compiler",
	mine: false,
	at: new Date(Date.now() - id * 60_000).toISOString(),
	changes: [
		{
			key: "participantCharacters",
			label: "Present",
			before: [],
			after: names,
			wasAbsent: false,
			nowAbsent: false
		}
	]
})
const redlines = (over: Record<string, unknown> = {}) => ({
	sceneId: SCENE,
	lorebookId: BOOK,
	canRestore: true,
	redlines: [31, 30].map((id) => person(id, ["Bram", "Mira"])),
	...over
})
const send = (res: unknown) => client.dispatch("scenes:redlines", res)
const fold = () =>
	document.querySelector<HTMLButtonElement>(
		'[data-testid="edit-history"] > button'
	)
const text = (sel = '[data-testid="edit-history"]') =>
	document.querySelector(sel)?.textContent?.replace(/\s+/g, " ").trim() ?? ""
const byText = (re: RegExp) =>
	[...document.querySelectorAll<HTMLButtonElement>("button")].find((b) =>
		re.test(b.textContent?.trim() ?? "")
	)

describe("a scene's Edit history", () => {
	test("asks for the scene's list and draws the fold with its count", async () => {
		await mountFold()
		expect(sent("scenes:redlines")[0]!.payload).toEqual({ sceneId: SCENE })
		send(redlines())
		await settle()
		expect(fold()!.textContent!.trim()).toBe("Edit history · 2 edits")
	})

	test("an opened row shows who, the cause and the names", async () => {
		await mountFold()
		send(redlines())
		await settle()
		fold()!.click()
		await settle()
		const row = text("[data-redline-id='31']")
		expect(row).toContain("Scene compiler")
		expect(row).toContain("Listed who spoke")
		expect(row).toContain("Present: (empty) → Bram, Mira")
	})

	test("Restore sends the row's id; a refusal reads inline", async () => {
		await mountFold()
		send(redlines())
		await settle()
		fold()!.click()
		await settle()
		document
			.querySelector<HTMLButtonElement>("[data-redline-id='30'] button[title]")!
			.click()
		await settle()
		expect(sent("scenes:restoreRedline")[0]!.payload).toEqual({ redlineId: 30 })
		client.dispatch("scenes:restoreRedline:error", {
			redlineId: 30,
			error: "Not yours."
		})
		await settle()
		expect(
			document
				.querySelector("[data-redline-id='30'] [role='alert']")
				?.textContent?.trim()
		).toBe("Not yours.")
	})

	test("restoreBlocked disables Restore with its words as the title", async () => {
		await mountFold({ restoreBlocked: "Save or discard your changes first." })
		send(redlines())
		await settle()
		fold()!.click()
		await settle()
		const buttons = [
			...document.querySelectorAll<HTMLButtonElement>(
				"[data-redline-id] button[title]"
			)
		]
		expect(buttons.length).toBe(2)
		for (const b of buttons) {
			expect(b.disabled).toBe(true)
			expect(b.title).toBe("Save or discard your changes first.")
		}
	})

	test("no clear button and no dialog", async () => {
		await mountFold()
		send(redlines())
		await settle()
		fold()!.click()
		await settle()
		expect(byText(/^Clear edit history…?$/)).toBeUndefined()
		expect(
			document.querySelector('[data-testid="clear-edit-history-dialog"]')
		).toBeNull()
	})

	test("another scene's reply is ignored", async () => {
		await mountFold()
		send(redlines({ sceneId: 99 }))
		await settle()
		expect(fold()).toBeNull()
	})
})
