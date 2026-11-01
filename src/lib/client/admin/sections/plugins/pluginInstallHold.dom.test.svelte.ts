/**
 * (Hold step) Choosing a package file only holds it: name and size with
 * Install and Cancel, and nothing sent. The browser sets no size cap; the
 * pub's `SP_PLUGIN_PACKAGE_MAX_MB` decides, on upload.
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
	vi.unstubAllGlobals()
})

const settle = async () => {
	await new Promise((r) => setTimeout(r, 0))
	flushSync()
	await new Promise((r) => setTimeout(r, 0))
	flushSync()
}

describe("Install a package: the hold step", () => {
	const mountPage = () => {
		app = mount(Page, { target: document.body, context: new Map([["userCtx", { user: { id: 1, isAdmin: true } }]]) })
		flushSync()
		listeners.get("plugins:list")!({ plugins: [], sandboxEnabled: true, sandboxFromEnv: false })
		flushSync()
		return document.querySelector('input[aria-label="Choose a package file"]') as HTMLInputElement
	}
	const choose = async (input: HTMLInputElement, file: File) => {
		Object.defineProperty(input, "files", { value: [file], configurable: true })
		input.dispatchEvent(new Event("change", { bubbles: true }))
		for (let i = 0; i < 4; i++) await settle()
	}
	const label = (t: string) => Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === t)

	test("choosing a file shows its name and size with Install and Cancel, and sends nothing", async () => {
		const fetchMock = vi.fn()
		vi.stubGlobal("fetch", fetchMock)
		const input = mountPage()
		await choose(input, new File([new Uint8Array(3)], "acme.lab-1.0.0.zip"))
		expect(document.body.textContent).toMatch(/acme\.lab-1\.0\.0\.zip · 1 MB/)
		expect(label("Install")).toBeTruthy()
		expect(label("Cancel")).toBeTruthy()
		expect(fetchMock).not.toHaveBeenCalled()
		expect(emitted.some(([e]) => e === "plugins:installPackage")).toBe(false)
	})

	test("Cancel clears the hold and the review", async () => {
		const fetchMock = vi.fn()
		vi.stubGlobal("fetch", fetchMock)
		const input = mountPage()
		await choose(input, new File([new Uint8Array(3)], "x.zip"))
		expect(document.querySelector('[data-field="plugin-package-review"]')).not.toBeNull()
		label("Cancel")!.click()
		await settle()
		expect(label("Install")).toBeUndefined()
		expect(document.querySelector('[data-field="plugin-package-hold"]')).toBeNull()
		expect(document.querySelector('[data-field="plugin-package-review"]')).toBeNull()
		expect(fetchMock).not.toHaveBeenCalled()
	})

	test("there is no browser size cap: an 80 MB package still offers Install", async () => {
		const input = mountPage()
		const big = new File([new Uint8Array(1)], "big.zip")
		Object.defineProperty(big, "size", { value: 80 * 1024 * 1024 })
		await choose(input, big)
		expect(document.body.textContent).toMatch(/big\.zip · 80 MB/)
		expect(document.body.textContent).not.toMatch(/at most/)
		expect(label("Install")).toBeTruthy()
	})
})
