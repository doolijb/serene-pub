/**
 * Admin › Pipelines' Recent runs names each run's pipeline with its genre
 * beside it.
 *
 * The changelist above has a Genre column; the runs list under it has only
 * the name, and names carry no genre (NOMENCLATURE §2, ruled 2026-10-05) —
 * so a Chat reply and a Lair reply would both read "Reply".
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, unmount } from "svelte"

vi.mock("$app/environment", () => ({ dev: true, building: false }))

const { listeners, listen } = vi.hoisted(() => {
	const listeners = new Map<string, (msg: any) => void>()
	return {
		listeners,
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
	getInterestContext: () => ({
		useInterest: listen,
		requestWithInterest: (key: string, _params: unknown, handler: any) =>
			listen(key, handler)
	})
}))
vi.mock("$lib/client/utils/toaster", () => ({
	toaster: { error: () => {}, info: () => {}, success: () => {} }
}))
vi.mock("$lib/client/admin/adminRouter.svelte", () => ({
	adminGoto: () => {},
	adminPage: { url: new URL("http://localhost/admin/pipelines") },
	adminRouter: { setQuery: () => {}, path: "/admin/pipelines" },
	interceptAdminLink: () => {}
}))

import Page from "./Page.svelte"

const ns = (slug: string, name: string, genre?: string) => ({
	slug,
	name,
	version: "1.0.0",
	event: null,
	enabled: true,
	taxonomy: genre ? { role: "primary", genre } : { role: "maintenance" }
})
const run = (runId: string, specSlug: string) => ({
	runId,
	specSlug,
	outcome: "ok",
	startedAt: "2026-10-05T12:00:00.000Z"
})

let app: Record<string, any> | null = null
afterEach(() => {
	if (app) unmount(app)
	app = null
	document.body.innerHTML = ""
	listeners.clear()
})

const runRows = () =>
	[...document.querySelectorAll("#recent-runs li")].map(
		(li) => li.querySelector("span.truncate")?.textContent?.trim() ?? ""
	)

describe("Admin › Pipelines — Recent runs", () => {
	test("each run's pipeline reads with its genre; a shared one stays bare", () => {
		app = mount(Page, {
			target: document.body,
			context: new Map<string, unknown>([
				["userCtx", { user: { id: 1, isAdmin: true } }]
			])
		})
		flushSync()
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
		listeners.get("pipelines:runs")!({
			runs: [
				run("r1", "core:spec/chat-respond"),
				run("r2", "core:spec/lair-respond"),
				run("r3", "core:spec/summarize-scene")
			]
		})
		flushSync()

		expect(runRows()).toEqual([
			"Reply · Chat",
			"Reply · Lair",
			"Summarize scene"
		])
	})
})
