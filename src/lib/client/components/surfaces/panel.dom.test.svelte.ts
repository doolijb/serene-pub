/**
 * The panel hands each widget what it was granted and what it reads (R21
 * lane 0): a granted scope's section off the page context that supplies it,
 * posted to the remote by the table's name — and a widget that does not read
 * the log (R75) is handed none of it: nothing snapshotted, nothing posted on
 * a token (F4). The page's UI workers are stood
 * in for; the host, the wire and the panel are real.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, unmount } from "svelte"
import { normalizeLayout, type PanelInstance } from "$lib/client/surfaces/types"
import Fixture from "./PanelFixture.svelte"

const posted = vi.hoisted(() => [] as Array<Record<string, unknown>>)
vi.mock("$lib/client/components/host/uiWorkers", () => ({
	acquireWorker: () => ({}),
	releaseWorker: () => {},
	listenForRemoteEvents: () => {},
	currentEvent: () => undefined,
	routeMount: () => () => {},
	postToWorker: (_worker: unknown, m: Record<string, unknown>) => posted.push(m)
}))

const settle = () => new Promise((r) => setTimeout(r, 20))

const sessionStateV1 = {
	sessionId: 7,
	loaded: true,
	error: null,
	resolved: { world: { "core.weather": "rain" }, cast: {} },
	slots: [],
	owners: []
}

const instance = (over: Partial<PanelInstance>): PanelInstance => ({
	id: "probe",
	title: "Probe",
	role: "secondary",
	surface: { kind: "remote", owner: "acme", component: "w" },
	src: "/plugin-ui/acme/w.js",
	channels: [],
	layout: normalizeLayout(undefined, "secondary"),
	active: true,
	collapsed: false,
	drawered: false,
	order: 0,
	...over
})

function open(inst: PanelInstance, requests?: unknown) {
	const session = $state({ id: 7, name: "S", sessionMessages: [{ id: 1, content: "Hel" }] })
	const target = document.createElement("div")
	document.body.appendChild(target)
	const app = mount(Fixture, {
		target,
		props: { instance: inst, session, supplies: { state: sessionStateV1, dossier: { dossier: 1 } }, requests }
	})
	flushSync()
	return {
		session,
		target,
		close: () => {
			unmount(app)
			target.remove()
		}
	}
}

afterEach(() => {
	posted.length = 0
})

describe("a remote widget", () => {
	async function remote(over: Partial<PanelInstance>) {
		const p = open(
			instance({
				surface: { kind: "remote", owner: "acme", component: "w" },
				src: "/plugin-ui/acme/w.js",
				...over
			})
		)
		const mounted = posted.find((m) => m.k === "mount") as { port: MessagePort }
		const got: Array<Record<string, unknown>> = []
		mounted.port.onmessage = (e) => got.push(e.data)
		mounted.port.postMessage({ t: "ready" })
		await settle()
		return { ...p, got, port: mounted.port }
	}

	test("is posted its granted section by the table's name", async () => {
		const r = await remote({ grants: ["session:state"], reads: ["settings"] })
		expect(r.got.find((m) => m.t === "scoped")).toEqual({
			t: "scoped",
			section: "session_state",
			value: sessionStateV1
		})
		r.port.close()
		r.close()
	})

	test("that does not read messages is posted no log, and nothing on a token", async () => {
		const r = await remote({ reads: ["settings"] })
		expect(r.got.some((m) => m.t === "messages" || m.t === "channel")).toBe(false)
		const before = r.got.length
		r.session.sessionMessages[0].content = "Hello"
		flushSync()
		await settle()
		expect(r.got.slice(before)).toEqual([])
		r.port.close()
		r.close()
	})

	test("that does not read messages never has the log read at all — no per-token snapshot", async () => {
		let reads = 0
		const session = {
			id: 7,
			name: "S",
			get sessionMessages() {
				reads++
				return [{ id: 1, content: "Hel" }]
			}
		}
		const target = document.createElement("div")
		document.body.appendChild(target)
		const app = mount(Fixture, {
			target,
			props: {
				instance: instance({
					surface: { kind: "remote", owner: "acme", component: "w" },
					src: "/plugin-ui/acme/w.js",
					reads: ["settings"]
				}),
				session,
				supplies: {}
			}
		})
		flushSync()
		const mounted = posted.find((m) => m.k === "mount") as { port: MessagePort }
		mounted.port.postMessage({ t: "ready" })
		await settle()
		expect(reads).toBe(0)
		mounted.port.close()
		unmount(app)
		target.remove()
	})

	test("that reads messages still streams: the token arrives", async () => {
		const r = await remote({})
		const before = r.got.length
		r.session.sessionMessages[0].content = "Hello"
		flushSync()
		await settle()
		const after = r.got.slice(before)
		expect(after.map((m) => m.t)).toEqual(["messages"])
		r.port.close()
		r.close()
	})
})

describe("a remote widget with no module", () => {
	// An authored component switched off, deleted or saved broken is announced
	// with `src: null` (C6 P5): the session draws the remote host's own missing
	// floor — never the unknown-surface floor, which blames a plugin.
	test("draws the remote's missing floor, not the unknown surface's", () => {
		const p = open(instance({ surface: { kind: "remote", owner: "authored.abcde12345", component: "stats" }, src: undefined }))
		expect(p.target.querySelector("[data-sp-missing]")).not.toBeNull()
		expect(p.target.textContent).toContain("it may be switched off")
		expect(p.target.textContent).not.toContain("its plugin may be disabled")
		expect(posted.some((m) => m.k === "mount")).toBe(false)
		p.close()
	})
})
