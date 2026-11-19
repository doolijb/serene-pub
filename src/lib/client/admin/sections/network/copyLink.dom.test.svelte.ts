/**
 * Admin → Network → Copy link: the clipboard is not there on a plain-http LAN
 * address (no secure context), so the press must say so instead of throwing.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

vi.mock("$app/environment", () => ({ dev: true, building: false }))

const { socket, handlers, notices } = vi.hoisted(() => ({
	socket: { emit: () => {}, on: () => {}, off: () => {} },
	handlers: new Map<string, (msg: any) => void>(),
	notices: [] as Array<{ kind: string; title: string }>
}))
vi.mock("$lib/client/sockets/loadSockets.client", () => ({
	useTypedSocket: () => socket
}))
vi.mock("$lib/client/sockets/interest.svelte", () => ({
	getAdminInterestContext: () => ({
		useInterest: () => () => {},
		requestWithInterest: (
			event: string,
			_params: unknown,
			handler: (msg: any) => void
		) => {
			handlers.set(event, handler)
			return () => {}
		}
	})
}))
vi.mock("$lib/client/utils/notify", () => ({
	notify: {
		success: (t: any) => notices.push({ kind: "success", ...t }),
		error: (t: any) => notices.push({ kind: "error", ...t }),
		warning: (t: any) => notices.push({ kind: "warning", ...t }),
		info: (t: any) => notices.push({ kind: "info", ...t })
	}
}))
vi.mock("$lib/client/admin/adminRouter.svelte", () => ({
	adminUnsavedEdits: () => {}
}))
vi.mock("$lib/client/components/admin/AdminPageHeader.svelte", () => ({
	default: () => {}
}))

import Page from "./Page.svelte"

const tunnel = {
	id: 1,
	serverId: 1,
	provider: "cloudflare-quick",
	mode: "quick",
	hostname: "abc.example.com",
	enabled: true,
	autoStart: false,
	status: "running",
	lastError: null,
	ttlSeconds: null,
	expiresAt: null,
	startedAt: null,
	stoppedAt: null,
	createdAt: new Date(),
	updatedAt: new Date(),
	credentialSet: false
}

let target: HTMLElement
let app: ReturnType<typeof mount>

async function open() {
	app = mount(Page, { target })
	flushSync()
	handlers.get("tunnels:get")!({
		serverId: 1,
		tunnel,
		available: true,
		accountsEnabled: false
	})
	flushSync()
	await tick()
	return [...target.querySelectorAll("button")].find((b) =>
		b.textContent?.includes("Copy link")
	) as HTMLButtonElement
}

async function press(button: HTMLButtonElement) {
	button.click()
	await tick()
	await new Promise((r) => setTimeout(r, 0))
}

beforeEach(() => {
	notices.length = 0
	handlers.clear()
	target = document.createElement("div")
	document.body.appendChild(target)
})
afterEach(() => {
	unmount(app)
	target.remove()
	vi.unstubAllGlobals()
	delete (document as any).execCommand
})

describe("Copy link", () => {
	test("without a clipboard it says so and does not throw", async () => {
		vi.stubGlobal("navigator", { clipboard: undefined })
		;(document as any).execCommand = () => false
		const button = await open()
		await press(button)
		expect(notices).toEqual([
			{
				kind: "error",
				title: "Could not reach the clipboard. Select the text and copy it."
			}
		])
	})

	test("outside a secure context the selection copy is used", async () => {
		const writeText = vi.fn()
		vi.stubGlobal("navigator", { clipboard: { writeText } })
		vi.stubGlobal("isSecureContext", false)
		;(document as any).execCommand = () => true
		const button = await open()
		await press(button)
		expect(writeText).not.toHaveBeenCalled()
		expect(notices.map((n) => n.title)).toEqual(["Link copied"])
	})

	test("with a secure clipboard it writes the address", async () => {
		const writeText = vi.fn().mockResolvedValue(undefined)
		vi.stubGlobal("navigator", { clipboard: { writeText } })
		vi.stubGlobal("isSecureContext", true)
		const button = await open()
		await press(button)
		expect(writeText).toHaveBeenCalledWith("https://abc.example.com")
		expect(notices).toEqual([{ kind: "success", title: "Link copied" }])
	})
})
