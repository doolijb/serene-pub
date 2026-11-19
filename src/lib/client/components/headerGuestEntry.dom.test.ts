/**
 * The session header's entry into Edit session (owner ruling G1,
 * 2026-11-16): the owner's reads Session settings and opens the Settings
 * tab; anyone else's reads Participants and opens the participants view.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

let svelte: typeof import("svelte")
let app: ReturnType<typeof import("svelte").mount> | null = null

beforeEach(async () => {
	vi.stubGlobal("localStorage", {
		getItem: () => null,
		setItem: () => {},
		removeItem: () => {},
		clear: () => {}
	})
	vi.resetModules()
	svelte = await import("svelte")
})

afterEach(() => {
	if (app) svelte.unmount(app)
	app = null
	vi.unstubAllGlobals()
	document.body.innerHTML = ""
})

async function mountHeader(isOwner: boolean) {
	const { default: Header } = await import("./Header.svelte")
	const digest: { sessionId?: number; sessionTab?: string } = {}
	const openPanel = vi.fn()
	app = svelte.mount(Header, {
		target: document.body,
		props: {},
		context: new Map<string, unknown>([
			[
				"openSessionCtx",
				{
					sessionId: 1,
					sessionName: "The Lantern Inn",
					genreName: "Chat",
					cast: [],
					isOwner
				}
			],
			["panelsCtx", { digest, openPanel }],
			["userSettingsCtx", { settings: { showAdvancedControls: true } }]
		])
	})
	svelte.flushSync()
	return { digest, openPanel }
}

const byLabel = (label: string) =>
	document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)

describe("the header's entry into Edit session", () => {
	test("a non-owner sees Participants and it opens the participants view", async () => {
		const { digest, openPanel } = await mountHeader(false)
		expect(byLabel("Session settings")).toBeNull()
		const button = byLabel("Participants")!
		expect(button).not.toBeNull()
		expect(button.textContent).toContain("Participants")
		button.click()
		svelte.flushSync()
		expect(digest.sessionTab).toBe("participants")
		expect(digest.sessionId).toBe(1)
		expect(openPanel).toHaveBeenCalled()
	}, 30000)

	test("the owner sees Session settings and it opens Settings", async () => {
		const { digest } = await mountHeader(true)
		expect(byLabel("Participants")).toBeNull()
		byLabel("Session settings")!.click()
		svelte.flushSync()
		expect(digest.sessionTab).toBe("settings")
	})
})
