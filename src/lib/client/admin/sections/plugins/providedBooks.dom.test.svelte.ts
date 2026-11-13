/**
 * 🚧 (M2e) A plugin's provided book is disabled, never deleted. On the plugin
 * page (a change form) its switch is an unsaved edit that waits for Save,
 * and Save sends it as `plugins:disableProvidedBook` / `…enableProvidedBook`.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, unmount } from "svelte"

vi.mock("$app/environment", () => ({ dev: true, building: false }))

const { listeners, listen, emitted } = vi.hoisted(() => {
	const listeners = new Map<string, (msg: any) => void>()
	const emitted: Array<[string, any]> = []
	return {
		listeners,
		emitted,
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
vi.mock("$lib/client/sockets/interest.svelte", () => ({
	declareInterest: listen,
	useInterest: listen,
	getInterestContext: () => ({
		useInterest: listen,
		declareInterest: listen,
		requestWithInterest: (k: string, _p: unknown, h: any) => listen(k, h)
	}),
	getAdminInterestContext: () => ({
		useInterest: listen,
		declareInterest: listen,
		requestWithInterest: (k: string, _p: unknown, h: any) => listen(k, h)
	})
}))
vi.mock("$lib/client/utils/toaster", () => ({
	toaster: { error() {}, info() {}, success() {}, warning() {} }
}))
vi.mock("$lib/client/admin/adminRouter.svelte", () => ({
	adminGoto: () => {},
	adminPage: {
		url: new URL("http://localhost/admin/plugins"),
		params: { id: "acme.lab" }
	},
	adminRouter: {
		setQuery: () => {},
		path: "/admin/plugins",
		confirmDiscard: async () => true
	},
	interceptAdminLink: () => {},
	adminUnsavedEdits: () => {},
	adminReplaceState: () => {}
}))

import IdPage from "./IdPage.svelte"

let app: ReturnType<typeof mount> | null = null
afterEach(() => {
	if (app) unmount(app)
	app = null
	document.body.innerHTML = ""
	listeners.clear()
	emitted.length = 0
})
const settle = async () => {
	await new Promise((r) => setTimeout(r, 0))
	flushSync()
	await new Promise((r) => setTimeout(r, 0))
	flushSync()
}

const row = {
	pluginId: "acme.lab",
	name: "Acme Lab",
	version: "1.0.0",
	bundleHash: "h",
	backends: ["quickjs"],
	backend: "quickjs",
	sequential: false,
	enabled: true,
	hasSettings: false,
	providedBooks: [
		{
			slug: "harbour",
			name: "Harbour",
			version: "1.0.0",
			lorebookId: 5,
			disabled: false,
			state: "imported"
		},
		{
			slug: "keep",
			name: "The Keep",
			version: "1.0.0",
			lorebookId: 6,
			disabled: true,
			state: "imported"
		}
	]
}

async function render() {
	app = mount(IdPage, {
		target: document.body,
		context: new Map([["userCtx", { user: { id: 1, isAdmin: true } }]])
	})
	flushSync()
	listeners.get("plugins:list")!({
		plugins: [row],
		sandboxEnabled: true,
		sandboxFromEnv: false
	})
	await settle()
}
const sw = (name: string) =>
	document.querySelector<HTMLInputElement>(
		`input[role="switch"][aria-label="Enabled: ${name}"]`
	)!
const saveBtn = () =>
	Array.from(document.querySelectorAll("button")).find(
		(b) => b.textContent?.trim() === "Save"
	)!

describe("provided books on the plugin page", () => {
	test("each book has a named switch with Enabled / Disabled beside it", async () => {
		await render()
		expect(sw("Harbour").checked).toBe(true)
		expect(sw("The Keep").checked).toBe(false)
		expect(sw("Harbour").closest("label")?.textContent?.trim()).toBe(
			"Enabled"
		)
		expect(sw("The Keep").closest("label")?.textContent?.trim()).toBe(
			"Disabled"
		)
		expect(sw("Harbour").closest("label")?.getAttribute("title")).toBe(
			"Hide this book everywhere without deleting it"
		)
		expect(sw("The Keep").closest("label")?.getAttribute("title")).toBe(
			"Show this book again"
		)
	})

	test("pressing a switch sends nothing; Save sends the event", async () => {
		await render()
		sw("Harbour").click()
		await settle()
		expect(emitted.some(([e]) => e.endsWith("ProvidedBook"))).toBe(false)
		expect(sw("Harbour").closest("label")?.textContent?.trim()).toBe(
			"Disabled"
		)
		saveBtn().click()
		await settle()
		expect(emitted).toContainEqual([
			"plugins:disableProvidedBook",
			{ pluginId: "acme.lab", slug: "harbour" }
		])
		expect(emitted.some(([e]) => e === "plugins:enableProvidedBook")).toBe(
			false
		)
	})

	test("turning a disabled book on sends enable on Save", async () => {
		await render()
		sw("The Keep").click()
		await settle()
		saveBtn().click()
		await settle()
		expect(emitted).toContainEqual([
			"plugins:enableProvidedBook",
			{ pluginId: "acme.lab", slug: "keep" }
		])
	})
})
