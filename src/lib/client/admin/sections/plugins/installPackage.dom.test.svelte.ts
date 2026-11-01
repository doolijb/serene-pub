/**
 * Admin › Plugins installs a package from a file: the chosen zip is held and
 * reviewed (name, what it asks for, what it can't do), then uploaded in pieces
 * over HTTP; the reply becomes one status line. The sandbox line says whether
 * plugins run, and Admin › Plugins › one extension draws the same palisade from
 * its live ticks.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, unmount } from "svelte"
import { strToU8, zipSync } from "fflate"

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
	adminPage: { url: new URL("http://localhost/admin/plugins"), params: { id: "acme.lab" } },
	adminRouter: { setQuery: () => {}, path: "/admin/plugins", confirmDiscard: async () => true },
	interceptAdminLink: () => {},
	adminUnsavedEdits: () => {},
	adminReplaceState: () => {}
}))

import Page from "./Page.svelte"
import IdPage from "./IdPage.svelte"

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

const userCtx = () => new Map([["userCtx", { user: { id: 1, isAdmin: true } }]])
const mountPage = (list: Record<string, unknown> = { sandboxEnabled: true, sandboxFromEnv: false }) => {
	app = mount(Page, { target: document.body, context: userCtx() })
	flushSync()
	listeners.get("plugins:list")!({ plugins: [], ...list })
	flushSync()
	return document.querySelector('input[aria-label="Choose a package file"]') as HTMLInputElement
}
const choose = async (input: HTMLInputElement, file: File) => {
	Object.defineProperty(input, "files", { value: [file], configurable: true })
	input.dispatchEvent(new Event("change", { bubbles: true }))
	for (let i = 0; i < 5; i++) await settle()
}
const button = (t: string) => Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === t)

const manifest = { slug: "acme.lab", version: "1.0.0", name: "Acme Lab", permissions: ["network:api.example.com", "storage"] }
const packageFile = () => {
	const bytes = zipSync({ "dist/plugin/manifest.json": strToU8(JSON.stringify(manifest)) })
	return new File([bytes], "acme.lab-1.0.0.zip", { type: "application/zip" })
}
const reply = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body })

describe("Install a package", () => {
	test("choosing a package shows its review and sends nothing", async () => {
		const fetchMock = vi.fn()
		vi.stubGlobal("fetch", fetchMock)
		await choose(mountPage(), packageFile())
		const text = document.querySelector('[data-field="plugin-package-review"]')?.textContent ?? ""
		expect(text).toContain("Acme Lab")
		expect(text).toContain("acme.lab · v1.0.0")
		expect(text).toContain("Network access to api.example.com")
		expect(text).toContain("Can't read your connections or API keys, or call a model itself")
		expect(text).toContain("Can't reach any site it doesn't list")
		expect(text).not.toContain("Can't reach the internet or your local network")
		expect(text).not.toContain("Can't keep files of its own")
		expect(text).toContain("A permission you haven't approved before stays refused")
		expect(fetchMock).not.toHaveBeenCalled()
	})

	test("Install uploads in pieces and the reply becomes a status line", async () => {
		const calls: Array<[string, string, any]> = []
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: string, init: any) => {
				calls.push([init.method, url, init.headers])
				if (init.method === "POST" && !url.includes("?")) return reply(200, { upload: "u1", pieceBytes: 64 })
				if (init.method === "PUT") return reply(200, { received: 0 })
				return reply(200, { pluginId: "acme.lab", specs: ["a", "b"], configs: ["c"], genres: ["g"], files: 2, warnings: [], plugins: [] })
			})
		)
		const file = packageFile()
		await choose(mountPage(), file)
		button("Install")!.click()
		for (let i = 0; i < 10; i++) await settle()
		const pieces = Math.ceil(file.size / 64)
		expect(calls.length).toBe(pieces + 2)
		expect(calls[0][0]).toBe("POST")
		expect(calls[0][1]).toBe("/api/admin/plugins/package")
		expect(calls[0][2]["x-package-filename"]).toBe("acme.lab-1.0.0.zip")
		expect(calls[0][2]["x-package-size"]).toBe(String(file.size))
		expect(calls.slice(1, -1).map((c) => c[1])).toEqual(
			Array.from({ length: pieces }, (_, i) => `/api/admin/plugins/package?upload=u1&offset=${i * 64}`)
		)
		expect(calls.slice(1, -1).every((c) => c[0] === "PUT")).toBe(true)
		expect(calls.at(-1)).toEqual(["POST", "/api/admin/plugins/package?upload=u1", undefined])
		expect(document.body.textContent).toMatch(/acme\.lab installed: 2 pipelines, 1 genre, 1 configuration, 2 files/)
		expect(emitted.some(([e]) => e === "plugins:list")).toBe(true)
		expect(document.querySelector('[data-field="plugin-package-review"]')).toBeNull()
	})

	test("a refusal from the start is shown in place, in the server's words", async () => {
		const sentence = "Plugins are turned off on this server (SP_PLUGINS_ENABLED), so a package can't be installed."
		vi.stubGlobal("fetch", vi.fn(async () => reply(403, { error: sentence })))
		await choose(mountPage(), packageFile())
		button("Install")!.click()
		for (let i = 0; i < 5; i++) await settle()
		expect(document.body.textContent).toContain(sentence)
	})
})

describe("The sandbox line", () => {
	const line = () => document.querySelector("#plugin-sandbox")?.textContent?.replace(/\s+/g, " ").trim()
	test("on", () => {
		mountPage({ sandboxEnabled: true, sandboxFromEnv: false })
		expect(line()).toBe("Plugins run on this pub.")
	})
	test("on, set by the environment", () => {
		mountPage({ sandboxEnabled: true, sandboxFromEnv: true })
		expect(line()).toBe("Plugins run on this pub. Set by SP_PLUGINS_ENABLED on this server.")
	})
	test("off, with the docs link, and Install a package is disabled", () => {
		mountPage({ sandboxEnabled: false, sandboxFromEnv: true })
		expect(line()).toBe("Plugins are off on this server (SP_PLUGINS_ENABLED), so they don't run and packages can't be installed. How to turn them on")
		expect(button("Install a package…")?.disabled).toBe(true)
	})
})

describe("One extension's palisade", () => {
	test("follows the permission ticks", async () => {
		app = mount(IdPage, { target: document.body, context: userCtx() })
		flushSync()
		const row = { pluginId: "acme.lab", name: "Acme Lab", version: "1.0.0", bundleHash: "h", backends: ["quickjs"], backend: "quickjs", sequential: false, enabled: false, hasSettings: false }
		listeners.get("plugins:list")!({ plugins: [row], sandboxEnabled: true, sandboxFromEnv: false })
		listeners.get("plugins:permissions#acme.lab")!({
			permissions: [{ key: "network:api.example.com", kind: "system", label: "Network access to api.example.com", accountAffecting: false, granted: true, pending: false }]
		})
		await settle()
		const palisade = () => document.querySelector('[data-field="plugin-palisade"]')?.textContent ?? ""
		expect(palisade()).toContain("What it can't do")
		expect(palisade()).toContain("Can't reach any site it doesn't list")
		expect(palisade()).not.toContain("Permissions it asks for")
		const box = document.querySelector('#plugin-permissions input[type="checkbox"]') as HTMLInputElement
		box.click()
		await settle()
		expect(palisade()).toContain("Can't reach the internet or your local network")
	})
})
