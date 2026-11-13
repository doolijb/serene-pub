import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, unmount } from "svelte"

vi.mock("$app/environment", () => ({ dev: true, building: false }))

const { listeners, listen, emitted, asked } = vi.hoisted(() => {
	const listeners = new Map<string, (msg: any) => void>()
	const emitted: Array<[string, any]> = []
	const asked: string[] = []
	return {
		listeners,
		emitted,
		asked,
		listen: (key: string, handler: (msg: any) => void) => {
			listeners.set(key, handler)
			return () => {
				if (listeners.get(key) === handler) listeners.delete(key)
			}
		}
	}
})
const socket = {
	emit: (e: string, p: any) => {
		emitted.push([e, p])
	},
	on: () => {},
	off: () => {}
}
vi.mock("$lib/client/sockets/loadSockets.client", () => ({
	useTypedSocket: () => socket
}))
vi.mock("$lib/client/sockets/typedSocket", async (importOriginal) => ({
	...(await importOriginal<object>()),
	useTypedSocket: () => socket
}))
vi.mock("$lib/client/sockets/interest.svelte", () => ({
	declareInterest: listen,
	useInterest: listen,
	requestWithInterest: (k: string, _p: unknown, h: any) => {
		asked.push(k)
		return listen(k, h)
	}
}))
vi.mock("$lib/client/utils/toaster", () => ({
	toaster: { error() {}, info() {}, success() {}, warning() {} }
}))

import CharacterForm from "./CharacterForm.svelte"

let app: ReturnType<typeof mount> | null = null
afterEach(() => {
	if (app) unmount(app)
	app = null
	document.body.innerHTML = ""
	listeners.clear()
	emitted.length = 0
	asked.length = 0
})
const settle = async () => {
	await new Promise((r) => setTimeout(r, 0))
	flushSync()
	await new Promise((r) => setTimeout(r, 0))
	flushSync()
}

const row = {
	id: 7,
	name: "Bianca",
	nickname: null,
	description: "A harbour pilot.",
	personality: "",
	scenario: "A quay.",
	firstMessage: "Ahoy.",
	alternateGreetings: ["Hello there."],
	groupOnlyGreetings: [],
	exampleDialogues: [],
	creatorNotes: "Hello",
	creatorNotesMultilingual: { en: "Hello", fr: "Bonjour" },
	characterVersion: "1.1",
	tags: [],
	extensions: {}
}

async function render(settings: object) {
	app = mount(CharacterForm, {
		target: document.body,
		props: { characterId: 7, isSafeToClose: false, closeForm: () => {} },
		context: new Map<string, unknown>([
			["userSettingsCtx", { settings }],
			["systemSettingsCtx", { settings: {} }],
			["userCtx", { user: { id: 1, isAdmin: false } }]
		])
	})
	flushSync()
	listeners.get("characters:get#7")!({
		character: row,
		cardVersionId: 11,
		currentCardVersionId: 11,
		cardVersions: [{ id: 11, number: 1, label: "1.0" }]
	})
	await settle()
}
const panel = (name: string) =>
	document.getElementById(`character-panel-${name}`)!
const text = (name: string) => panel(name).textContent ?? ""
const hiddenLine = () =>
	[...document.querySelectorAll("button")].find(
		(b) => b.textContent?.trim() === "Show advanced controls"
	)
const goTab = async (name: string) => {
	document.getElementById(`character-panel-${name}-tab`)!.click()
	await settle()
}
const lineShown = () => {
	const b = hiddenLine()
	return !!b && !b.closest("[hidden]")
}

describe("CharacterForm advanced controls", () => {
	test("off: simple fields only, with the hidden line", async () => {
		await render({ showAdvancedControls: false })
		expect(text("profile")).not.toContain("Card metadata")
		expect(document.body.textContent).toContain("Some controls are hidden.")
		expect(lineShown()).toBe(true)
		await goTab("voice")
		const voice = text("voice")
		expect(voice).not.toContain("Scenario")
		expect(voice).not.toContain("Examples")
		expect(voice).not.toContain("Instructions")
		expect(voice).toContain("First greeting")
		expect(panel("voice").querySelector("#charFirstMessage")).not.toBeNull()
		expect(
			document.querySelector('[name="show-all-character-fields"]')
		).toBeNull()
		for (const tab of ["stats", "likeness", "speech"]) {
			await goTab(tab)
			expect(lineShown()).toBe(false)
		}
	})

	test("on: every field, no hidden line", async () => {
		await render({ showAdvancedControls: true })
		expect(text("profile")).toContain("Card metadata")
		await goTab("voice")
		const voice = text("voice")
		expect(voice).toContain("Scenario")
		expect(voice).toContain("Examples")
		expect(voice).toContain("Instructions")
		expect(panel("voice").querySelector("#charFirstMessage")).toBeNull()
		expect(document.body.textContent).not.toContain(
			"Some controls are hidden."
		)
		expect(hiddenLine()).toBeUndefined()
	})

	test("flipping the switch redraws without a remount", async () => {
		const ctx = $state({ settings: { showAdvancedControls: false } })
		app = mount(CharacterForm, {
			target: document.body,
			props: {
				characterId: 7,
				isSafeToClose: false,
				closeForm: () => {}
			},
			context: new Map<string, unknown>([
				["userSettingsCtx", ctx],
				["systemSettingsCtx", { settings: {} }],
				["userCtx", { user: { id: 1, isAdmin: false } }]
			])
		})
		flushSync()
		listeners.get("characters:get#7")!({
			character: row,
			cardVersionId: 11,
			currentCardVersionId: 11,
			cardVersions: [{ id: 11, number: 1, label: "1.0" }]
		})
		await settle()
		expect(text("profile")).not.toContain("Card metadata")
		expect(hiddenLine()).toBeDefined()
		ctx.settings.showAdvancedControls = true
		await settle()
		expect(text("profile")).toContain("Card metadata")
		expect(text("voice")).toContain("Scenario")
		expect(hiddenLine()).toBeUndefined()
	})

	test("the line's link asks to turn the switch on", async () => {
		await render({ showAdvancedControls: false })
		hiddenLine()!.click()
		flushSync()
		expect(emitted).toContainEqual([
			"userSettings:updateShowAdvancedControls",
			{ enabled: true }
		])
	})
})
