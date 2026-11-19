/**
 * 🚧 A saved scene's page mounts its Edit history; a new scene's does not;
 * Restore waits while the draft differs from the saved scene.
 *
 * ⚠ No DOM node is ever handed to `expect`.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

vi.mock("$app/environment", () => ({
	dev: true,
	building: false,
	browser: true
}))
vi.mock("./poolContext", () => ({
	getLorePoolCtx: () => ({
		openProcess: () => {},
		onNavigateToGraph: undefined
	})
}))
vi.mock("./SceneForm.svelte", () => ({ default: () => {} }))

import { setSocket } from "$lib/client/sockets/socketInstance"
import {
	_resetInterestForTests,
	setInterestUser
} from "$lib/client/sockets/interest.svelte"
import SceneEditor from "./SceneEditor.svelte"

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
let draft: Record<string, any>

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

const SAVED = {
	id: 5,
	name: "Dock",
	summary: "They met.",
	participantCharacters: [1, 2],
	mentionedCharacters: [3],
	updatedAt: "2026-11-17T00:00:00.000Z"
}
const savedDraft = () => ({
	id: 5,
	name: "Dock",
	summary: "They met.",
	participantCharacters: [2, 1],
	mentionedCharacters: [3]
})

async function show(isNew: boolean, source: Record<string, unknown> | null) {
	const host = document.createElement("div")
	document.body.append(host)
	const live = $state(savedDraft())
	draft = live
	app = mount(SceneEditor, {
		target: host,
		props: {
			lorebookId: 2,
			draft,
			source,
			isNew,
			bindings: []
		} as any
	})
	await settle()
}
const asks = () => client.emits.filter((e) => e.event === "scenes:redlines")
const reply = () =>
	client.dispatch("scenes:redlines", {
		sceneId: 5,
		lorebookId: 2,
		canRestore: true,
		redlines: [
			{
				id: 40,
				amendmentId: null,
				version: null,
				cause: "save",
				who: "You",
				mine: true,
				at: new Date().toISOString(),
				changes: [
					{
						key: "participantCharacters",
						label: "Present",
						before: [],
						after: ["Bram"],
						wasAbsent: false,
						nowAbsent: false
					}
				]
			}
		]
	})
async function restoreTitle() {
	reply()
	await settle()
	document
		.querySelector<HTMLButtonElement>('[data-testid="edit-history"] > button')!
		.click()
	await settle()
	return document.querySelector<HTMLButtonElement>(
		"[data-redline-id='40'] button[title]"
	)!
}

describe("a scene page's Edit history", () => {
	test("a saved scene asks for its own list", async () => {
		await show(false, SAVED)
		expect(asks().map((e) => e.payload)).toEqual([{ sceneId: 5 }])
	})

	test("a new scene mounts none", async () => {
		await show(true, null)
		expect(asks().length).toBe(0)
	})

	test("a clean draft leaves Restore enabled, lists compared as sorted ids", async () => {
		await show(false, SAVED)
		const b = await restoreTitle()
		expect(b.disabled).toBe(false)
	})

	test("a draft that differs blocks Restore with the unsaved words", async () => {
		await show(false, SAVED)
		draft.participantCharacters = [1]
		await settle()
		const b = await restoreTitle()
		expect(b.disabled).toBe(true)
		expect(b.title).toBe("Save or discard your changes first.")
	})
})
