/**
 * Admin › Configurations names each configuration's pipeline with its genre
 * beside it.
 *
 * Pipeline names carry no genre (NOMENCLATURE §2, ruled 2026-10-05), and
 * every genre's default configuration is named _Default_ (C5), so the index
 * would otherwise list "Default · Reply" once per genre with nothing to tell
 * them apart. The genre is read the way Admin › Pipelines reads it: the
 * spec's declared claim off `pipelines:list`, named by `sessions:genres`.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, unmount } from "svelte"

vi.mock("$app/environment", () => ({ dev: true, building: false }))

const { listeners, requested, listen } = vi.hoisted(() => {
	const listeners = new Map<string, (msg: any) => void>()
	return {
		listeners,
		requested: [] as string[],
		listen: (key: string, handler: (msg: any) => void) => {
			listeners.set(key, handler)
			return () => {
				if (listeners.get(key) === handler) listeners.delete(key)
			}
		}
	}
})
const socket = { emit: () => {}, on: () => {}, off: () => {} }
vi.mock("$lib/client/sockets/typedSocket", () => ({
	useTypedSocket: () => socket
}))
vi.mock("$lib/client/sockets/loadSockets.client", () => ({
	useTypedSocket: () => socket
}))
vi.mock("$lib/client/sockets/interest.svelte", () => ({
	declareInterest: listen,
	useInterest: listen,
	requestWithInterest: (key: string, _params: unknown, handler: any) => {
		requested.push(key)
		return listen(key, handler)
	}
}))
vi.mock("$lib/client/utils/toaster", () => ({
	toaster: { error: () => {}, info: () => {}, success: () => {} }
}))
vi.mock("$lib/client/admin/adminRouter.svelte", () => ({
	adminGoto: () => {},
	adminPage: { url: new URL("http://localhost/admin/configurations") },
	adminRouter: { setQuery: () => {}, path: "/admin/configurations" },
	interceptAdminLink: () => {}
}))

import Page from "./Page.svelte"

const row = (id: number, specSlug: string) => ({
	id,
	name: "Default",
	specSlug,
	specName: specSlug.endsWith("summarize-scene")
		? "Summarize scene"
		: "Reply",
	isDefault: true,
	isImmutable: true,
	usedByPresets: 0,
	usedBySessions: 0,
	updatedAt: null
})

const ns = (slug: string, name: string, genre?: string) => ({
	slug,
	name,
	version: "1.0.0",
	event: null,
	enabled: true,
	taxonomy: genre ? { role: "primary", genre } : { role: "maintenance" }
})

let app: Record<string, any> | null = null
afterEach(() => {
	if (app) unmount(app)
	app = null
	document.body.innerHTML = ""
	listeners.clear()
	requested.length = 0
})

function open() {
	app = mount(Page, {
		target: document.body,
		context: new Map<string, unknown>([
			["userCtx", { user: { id: 1, isAdmin: true } }]
		])
	})
	flushSync()
	listeners.get("pipelines:configsIndex")!({
		configs: [
			row(1, "core:spec/chat-respond"),
			row(2, "core:spec/lair-respond"),
			row(3, "core:spec/summarize-scene")
		]
	})
	flushSync()
}

const text = () => document.body.textContent ?? ""

describe("Admin › Configurations — the genre beside the pipeline", () => {
	test("asks for the published list and the genres' names", () => {
		open()
		expect(requested).toEqual(
			expect.arrayContaining(["pipelines:list", "sessions:genres"])
		)
	})

	test("each genre's Reply reads apart; a shared pipeline stays bare", () => {
		open()
		listeners.get("pipelines:list")!({
			pipelinesList: [
				ns("core:spec/chat-respond", "Reply", "core:genre/chat"),
				ns("core:spec/lair-respond", "Reply", "core:genre/lair"),
				ns("core:spec/summarize-scene", "Summarize scene")
			]
		})
		listeners.get("sessions:genres")!({
			genres: [
				{ genreId: "core:genre/chat", name: "Chat" },
				{ genreId: "core:genre/lair", name: "Lair" }
			]
		})
		flushSync()

		expect(text()).toContain("Reply · Chat")
		expect(text()).toContain("Reply · Lair")
		expect(text()).toContain("Summarize scene")
		expect(text()).not.toContain("Summarize scene ·")
	})

	test("the bare name stands in until both lists arrive", () => {
		open()
		expect(text()).toContain("Reply")
		expect(text()).not.toContain("Reply ·")
	})
})
