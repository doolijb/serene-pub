/**
 * lay-R (owner 2026-11-06): the Runs tab in the session detail, an
 * administrator's only (R55).
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

vi.mock("$app/environment", () => ({ dev: true, building: false }))

const { listeners, emits, socket, inspectorOpen } = vi.hoisted(() => {
	const listeners = new Map<string, (msg: any) => void>()
	const emits: { event: string; params: any }[] = []
	return {
		listeners,
		emits,
		socket: { emit: () => {}, on: () => {}, off: () => {} },
		inspectorOpen: vi.fn()
	}
})

vi.mock("$lib/client/sockets/typedSocket", () => ({
	useTypedSocket: () => socket
}))
vi.mock("$lib/client/sockets/interest.svelte", () => ({
	declareInterest: (key: string, handler: (msg: any) => void) => {
		listeners.set(key, handler)
		return () => listeners.delete(key)
	},
	requestWithInterest: (event: string, params: any, handler: (msg: any) => void) => {
		emits.push({ event, params })
		listeners.set(event, handler)
		return () => listeners.delete(event)
	}
}))
vi.mock("$lib/client/stores/runInspector.svelte", () => ({
	runInspector: { open: inspectorOpen }
}))

import SessionViewPanel from "./SessionViewPanel.svelte"

const SESSION = {
	id: 12,
	name: "The lighthouse",
	sessionCharacters: [{ character: { id: 1, name: "Wren" } }],
	sessionPersonas: [],
	tags: []
}

const run = (runId: string, outcome: string) => ({
	runId,
	specSlug: `slug-${runId}`,
	outcome,
	triggerSource: "ui",
	userId: 1,
	username: "me",
	startedAt: new Date(Date.now() - 5000).toISOString(),
	endedAt: new Date().toISOString(),
	elapsedMs: 820,
	tokensSpent: 0,
	isPreview: false,
	depth: 0
})

let app: ReturnType<typeof mount> | null = null
afterEach(() => {
	if (app) unmount(app)
	app = null
	listeners.clear()
	emits.length = 0
	inspectorOpen.mockClear()
	document.body.innerHTML = ""
})

async function mountPanel(isAdmin: boolean) {
	app = mount(SessionViewPanel, {
		target: document.body,
		props: { sessionId: SESSION.id, onOpen: () => {}, onEdit: () => {} },
		context: new Map([["userCtx", { user: { id: 1, isAdmin } }]])
	})
	flushSync()
	await tick()
	listeners.get("sessions:get#12")?.({ session: SESSION })
	for (const [key, handler] of listeners) {
		if (key.startsWith("sessions:get") || key.startsWith("sessions:refresh"))
			handler({ session: SESSION })
	}
	flushSync()
	await tick()
}

const tabs = () =>
	[...document.querySelectorAll('[role="tab"]')].map((t) => t.textContent?.trim())
const text = () => document.body.textContent ?? ""
const button = (label: string) =>
	[...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === label)

describe("Session detail, Runs tab", () => {
	test("a non-admin sees no tab strip and nothing asks for runs", async () => {
		await mountPanel(false)
		expect(document.querySelector('[role="tablist"]') === null).toBe(true)
		expect(text().includes("The lighthouse")).toBe(true)
		expect(emits.some((e) => e.event === "pipelines:runs")).toBe(false)
	})

	test("an admin sees Details and Runs", async () => {
		await mountPanel(true)
		expect(tabs()).toEqual(["Details", "Runs"])
		expect(emits.some((e) => e.event === "pipelines:runs")).toBe(false)
	})

	test("opening Runs asks, draws replies for this session, steps and inspect", async () => {
		await mountPanel(true)
		;(button("Runs") ?? ([...document.querySelectorAll('[role="tab"]')].find(
			(t) => t.textContent?.trim() === "Runs"
		) as HTMLElement)).click()
		flushSync()
		await tick()
		const asked = emits.find((e) => e.event === "pipelines:runs")
		expect(asked?.params).toEqual({ sessionId: 12, limit: 25 })

		const reply = listeners.get("pipelines:runs")!
		reply({ sessionId: 99, runs: [run("zzz", "ok")] })
		flushSync()
		await tick()
		expect(text().includes("slug-zzz")).toBe(false)

		reply({ sessionId: 12, runs: [run("r1", "ok"), run("r2", "err")] })
		flushSync()
		await tick()
		const outcomes = [...document.querySelectorAll('[data-run-outcome]')].map(
			(o) => o.textContent?.trim()
		)
		expect(outcomes).toEqual(["Finished", "Failed"])

		button("Steps")!.click()
		flushSync()
		await tick()
		expect(emits.find((e) => e.event === "pipelines:run")?.params).toEqual({ runId: "r1" })
		listeners.get("pipelines:run")!({
			run: {
				runId: "r1",
				receipt: {
					nodes: [{ seq: 1, nodeKey: "input", kind: "input", result: "ok", elapsedMs: 3 }]
				}
			}
		})
		flushSync()
		await tick()
		const keys = [...document.querySelectorAll('[data-step-key]')].map(
			(k) => k.textContent?.trim()
		)
		expect(keys.length > 0).toBe(true)

		button("Inspect")!.click()
		expect(inspectorOpen).toHaveBeenCalledWith("r1")
	})
})
