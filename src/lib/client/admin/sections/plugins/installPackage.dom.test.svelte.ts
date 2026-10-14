/**
 * Admin › Plugins can install a package from a file: the zip is read as
 * base64, sent as `plugins:installPackage`, and the reply becomes one status
 * line (PLAN-pipeline-canvas-and-genre-authoring P5).
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
const socket = { emit: (e: string, p: any) => { emitted.push([e, p]) }, on: () => {}, off: () => {} }
vi.mock("$lib/client/sockets/loadSockets.client", () => ({ useTypedSocket: () => socket }))
vi.mock("$lib/client/sockets/interest.svelte", () => ({
	declareInterest: listen,
	useInterest: listen,
	getInterestContext: () => ({ useInterest: listen, declareInterest: listen, requestWithInterest: (k: string, _p: unknown, h: any) => listen(k, h) }),
	getAdminInterestContext: () => ({ useInterest: listen, declareInterest: listen, requestWithInterest: (k: string, _p: unknown, h: any) => listen(k, h) })
}))
vi.mock("$lib/client/utils/toaster", () => ({ toaster: { error() {}, info() {}, success() {}, warning() {} } }))
vi.mock("$lib/client/admin/adminRouter.svelte", () => ({
	adminGoto: () => {},
	adminPage: { url: new URL("http://localhost/admin/plugins") },
	adminRouter: { setQuery: () => {}, path: "/admin/plugins", confirmDiscard: async () => true },
	interceptAdminLink: () => {},
	adminUnsavedEdits: () => {},
	adminReplaceState: () => {}
}))

import Page from "./Page.svelte"

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

describe("Install a package", () => {
	test("a chosen zip is sent as base64 and the reply becomes a status line", async () => {
		app = mount(Page, { target: document.body, context: new Map([["userCtx", { user: { id: 1, isAdmin: true } }]]) })
		flushSync()
		listeners.get("plugins:list")!({ plugins: [], sandboxEnabled: true })
		flushSync()
		const button = Array.from(document.querySelectorAll("button")).find((b) => /Install a package/.test(b.textContent ?? ""))
		expect(button).toBeTruthy()
		const input = document.querySelector('input[aria-label="Choose a package file"]') as HTMLInputElement
		expect(input).toBeTruthy()
		const file = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3])], "acme.lab-1.0.0.zip", { type: "application/zip" })
		Object.defineProperty(input, "files", { value: [file], configurable: true })
		input.dispatchEvent(new Event("change", { bubbles: true }))
		// FileReader finishes on its own tick.
		for (let i = 0; i < 10 && !emitted.some(([e]) => e === "plugins:installPackage"); i++) await settle()
		const sent = emitted.find(([e]) => e === "plugins:installPackage")?.[1]
		expect(sent?.filename).toBe("acme.lab-1.0.0.zip")
		expect(sent?.bytes).toBe(Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]).toString("base64"))
		listeners.get("plugins:installPackage")!({ pluginId: "acme.lab", specs: ["acme.lab:spec/quest-create", "acme.lab:spec/quest-respond"], configs: ["a"], genres: ["acme.lab:genre/quest"], files: 2, warnings: [], plugins: [] })
		await settle()
		expect(document.body.textContent).toMatch(/acme\.lab installed: 2 pipelines, 1 genre, 1 configuration, 2 files/)
		expect(emitted.some(([e]) => e === "plugins:list")).toBe(true)
	})

	test("a refusal is shown in place, in the server's words", async () => {
		app = mount(Page, { target: document.body, context: new Map([["userCtx", { user: { id: 1, isAdmin: true } }]]) })
		flushSync()
		listeners.get("plugins:list")!({ plugins: [], sandboxEnabled: true })
		flushSync()
		const input = document.querySelector('input[aria-label="Choose a package file"]') as HTMLInputElement
		Object.defineProperty(input, "files", { value: [new File([new Uint8Array([1])], "x.zip")], configurable: true })
		input.dispatchEvent(new Event("change", { bubbles: true }))
		for (let i = 0; i < 10 && !listeners.has("plugins:installPackage:error"); i++) await settle()
		listeners.get("plugins:installPackage:error")!({ error: "Plugins are switched off on this pub." })
		await settle()
		expect(document.body.textContent).toMatch(/Plugins are switched off on this pub\./)
	})
})
