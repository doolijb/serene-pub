/**
 * A refusal is said once, where the person acted (plan A24 leftover).
 *
 * `entries:create:error` and `narrativeGraph:mergeNode:error` are left alone
 * by Layout's catch-all (`layoutHandledErrors.test.ts`), so every surface that
 * sends one of these requests says its refusal itself: the day-one composer
 * and the duplicates list as their own toast, the absorb window in place —
 * and each only about a request it sent.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

vi.mock("$app/environment", () => ({
	dev: true,
	building: false,
	browser: true
}))
const toaster = vi.hoisted(() => ({
	success: vi.fn(),
	error: vi.fn(),
	info: vi.fn(),
	warning: vi.fn()
}))
vi.mock("$lib/client/utils/toaster", () => ({ toaster }))
vi.mock("$lib/client/components/lorebookForms/LoreContentField.svelte", () => ({
	default: () => {}
}))

import { setSocket } from "$lib/client/sockets/socketInstance"
import {
	_resetInterestForTests,
	setInterestUser
} from "$lib/client/sockets/interest.svelte"
import DayOne from "./DayOne.svelte"
import CastDuplicatesPanel from "./cast/CastDuplicatesPanel.svelte"
import AbsorbBindingModal from "$lib/client/components/modals/AbsorbBindingModal.svelte"

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

const BOOK = 7

let client: ReturnType<typeof makeClientSocket>
let app: ReturnType<typeof mount> | null = null

beforeEach(() => {
	client = makeClientSocket()
	setSocket(client as never)
	setInterestUser({ id: 1, isAdmin: false })
	toaster.error.mockClear()
	toaster.success.mockClear()
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

function render(component: any, props: Record<string, unknown>) {
	const target = document.createElement("div")
	document.body.append(target)
	app = mount(component, { target, props })
	flushSync()
}

const button = (label: RegExp) => {
	const found = [...document.querySelectorAll("button")].find((b) =>
		label.test(b.textContent ?? "")
	)
	if (!found) throw new Error(`no button ${label}`)
	return found as HTMLButtonElement
}

const sent = (event: string) => client.emits.filter((e) => e.event === event)

describe("the day-one composer", () => {
	test("says a refused create as its own toast, with the server's sentence, and keeps the text", async () => {
		render(DayOne, { lorebookId: BOOK, onImport: () => {} })
		const name = document.querySelector<HTMLInputElement>(
			'input[aria-label="Name it"]'
		)!
		name.value = "Harbor"
		name.dispatchEvent(new Event("input"))
		flushSync()
		button(/Add entry/).click()
		await settle()
		expect(sent("entries:create")).toHaveLength(1)

		client.dispatch("entries:create:error", {
			error: "Lorebook not found."
		})
		await settle()

		expect(toaster.error).toHaveBeenCalledTimes(1)
		expect(toaster.error.mock.calls[0]![0]).toMatchObject({
			description: "Lorebook not found."
		})
		expect(name.value).toBe("Harbor")
	})
})

describe("the duplicates list", () => {
	const candidate = {
		bindingIdA: 11,
		bindingIdB: 12,
		nameA: "Maren",
		nameB: "Marren"
	}

	test("says a refused absorb as its own toast and asks for the list again", async () => {
		render(CastDuplicatesPanel, { lorebookId: BOOK })
		await settle()
		client.dispatch("narrativeGraph:duplicateCandidates", {
			lorebookId: BOOK,
			candidates: [candidate]
		})
		await settle()

		// Another surface's refusal is not this list's to say.
		client.dispatch("narrativeGraph:mergeNode:error", {
			error: "Not ours."
		})
		await settle()
		expect(toaster.error).not.toHaveBeenCalled()

		const asked = sent("narrativeGraph:duplicateCandidates").length
		button(/absorb/i).click()
		await settle()
		expect(sent("narrativeGraph:mergeNode")).toHaveLength(1)

		client.dispatch("narrativeGraph:mergeNode:error", {
			error: "Two members who are both played by a character cannot be merged."
		})
		await settle()

		expect(toaster.error).toHaveBeenCalledTimes(1)
		expect(toaster.error.mock.calls[0]![0]).toMatchObject({
			description:
				"Two members who are both played by a character cannot be merged."
		})
		// The pair was taken off the list when absorb was pressed; the list
		// is read again so it comes back.
		expect(sent("narrativeGraph:duplicateCandidates").length).toBe(
			asked + 1
		)
	})

	test("another merge landing first does not make it drop its own refusal", async () => {
		render(CastDuplicatesPanel, { lorebookId: BOOK })
		await settle()
		client.dispatch("narrativeGraph:duplicateCandidates", {
			lorebookId: BOOK,
			candidates: [candidate]
		})
		await settle()
		button(/absorb/i).click()
		await settle()
		const ask = sent("narrativeGraph:mergeNode")[0]!.payload

		// The absorb window's merge, into someone else, lands first.
		client.dispatch("narrativeGraph:mergeNode", {
			survivorNode: { id: 30, name: "Tobin" }
		})
		await settle()
		// The absorb window's refusal names its own pair: not this list's.
		client.dispatch("narrativeGraph:mergeNode:error", {
			nodeId: 40,
			parentNodeId: 30,
			error: "Not ours."
		})
		await settle()
		expect(toaster.error).not.toHaveBeenCalled()

		client.dispatch("narrativeGraph:mergeNode:error", {
			...ask,
			error: "That cast member has since been merged elsewhere."
		})
		await settle()
		expect(toaster.error).toHaveBeenCalledTimes(1)
		expect(toaster.error.mock.calls[0]![0]).toMatchObject({
			title: '"Maren" was not absorbed',
			description: "That cast member has since been merged elsewhere."
		})
	})
})

describe("the absorb window", () => {
	const node = (id: number, name: string) =>
		({
			id,
			lorebookId: BOOK,
			name,
			nodeState: "active",
			characterId: null,
			summary: ""
		}) as any

	test("says its own refused merge in place, and nobody else's", async () => {
		const maren = node(11, "Maren")
		const marren = node(12, "Marren")
		render(AbsorbBindingModal, {
			open: true,
			onOpenChange: () => {},
			node: maren,
			nodes: [maren, marren],
			lorebookId: BOOK
		})
		await settle()
		button(/Marren/).click()
		await settle()

		// The duplicates list's refusal, heard while this window is open.
		client.dispatch("narrativeGraph:mergeNode:error", {
			error: "Not ours."
		})
		await settle()
		expect(document.querySelector('[role="alert"]')).toBeNull()

		button(/^\s*Absorb\s*$/).click()
		await settle()
		expect(sent("narrativeGraph:mergeNode")).toHaveLength(1)
		client.dispatch("narrativeGraph:mergeNode:error", {
			error: "That cast member has since been merged elsewhere."
		})
		await settle()
		expect(
			document.querySelector('[role="alert"]')?.textContent?.trim()
		).toBe("That cast member has since been merged elsewhere.")
		expect(toaster.error).not.toHaveBeenCalled()
	})

	test("closed while its merge is out, still says the refusal once, as a toast", async () => {
		const maren = node(11, "Maren")
		const marren = node(12, "Marren")
		render(AbsorbBindingModal, {
			open: true,
			onOpenChange: () => {},
			node: maren,
			nodes: [maren, marren],
			lorebookId: BOOK
		})
		await settle()
		button(/Marren/).click()
		await settle()
		button(/^\s*Absorb\s*$/).click()
		await settle()
		const ask = sent("narrativeGraph:mergeNode")[0]!.payload

		// Closed: its host takes it off the page.
		unmount(app!)
		app = null
		await settle()

		client.dispatch("narrativeGraph:mergeNode:error", {
			...ask,
			error: "That cast member has since been merged elsewhere."
		})
		await settle()
		expect(toaster.error).toHaveBeenCalledTimes(1)
		expect(toaster.error.mock.calls[0]![0]).toMatchObject({
			title: '"Maren" was not absorbed',
			description: "That cast member has since been merged elsewhere."
		})
	})
})
