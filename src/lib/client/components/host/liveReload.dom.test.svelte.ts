/**
 * Live reload of a remote widget (C6, P5): an authored component saved is a
 * new artifact URL, and a new `src` unmounts the component and mounts the new
 * module in the SAME worker — its saved view state kept, being filed under
 * the widget's id. No `src` draws the widget as missing. A worker that has
 * imported twenty modules is recycled on the next. A failure the worker
 * reports reaches `onRuntimeError`. And an authored owner is never core's:
 * its presses are gated and its ids are its box's.
 *
 * The page's UI workers are the real ones (`uiWorkers.ts`); only `Worker` is
 * stood in for, recording what each is posted.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, unmount } from "svelte"
import { MUTATION_TYPE_INSERT_CHILD, ROOT_ID } from "@remote-dom/core"
import { savedFrameState } from "$lib/client/components/frames/framePort"
import RemoteWidget from "./RemoteWidget.svelte"
import ComponentMount from "./ComponentMount.svelte"
import { RECYCLE_AFTER, terminateAllWorkers } from "./uiWorkers"

type Posted = { k: string; mountId: string; entry?: string; port?: MessagePort }
const started: FakeWorker[] = []
class FakeWorker {
	name: string
	terminated = 0
	posted: Posted[] = []
	onmessage: ((e: { data: unknown }) => void) | null = null
	onerror: unknown = null
	constructor(_url: string | URL, opts?: { name?: string }) {
		this.name = opts?.name ?? ""
		started.push(this)
	}
	postMessage(m: Posted) {
		this.posted.push(m)
	}
	terminate() {
		this.terminated++
	}
	/** The worker speaking to the page. */
	say(m: Record<string, unknown>) {
		this.onmessage?.({ data: m })
	}
}

const OWNER = "authored.k3x9q2m7p1"
const art = (n: number) => `/authored-ui/${OWNER}/${n.toString(16).padStart(16, "0")}.js`
const settle = () => new Promise((r) => setTimeout(r, 20))
const mountsOf = (w: FakeWorker) => w.posted.filter((m) => m.k === "mount")

beforeEach(() => {
	vi.stubGlobal("Worker", FakeWorker)
	vi.spyOn(console, "warn").mockImplementation(() => {})
})
afterEach(() => {
	terminateAllWorkers()
	started.length = 0
	savedFrameState.clear()
	vi.restoreAllMocks()
	vi.unstubAllGlobals()
})

function widget(src: string | null, extra: Record<string, unknown> = {}) {
	const props = $state({
		widget: { id: `${OWNER}:stats`, title: "Stats" },
		owner: OWNER,
		src: src as string | null,
		session: { id: 42, name: "Real", sessionMessages: [] },
		eager: true,
		...extra
	})
	const target = document.createElement("div")
	document.body.appendChild(target)
	const app = mount(RemoteWidget, { target, props })
	flushSync()
	return {
		props,
		target,
		close: async () => {
			await unmount(app)
			target.remove()
		}
	}
}

describe("a remote widget, live-reloaded", () => {
	test("a new src remounts it in the same worker, its saved state kept", async () => {
		const w = widget(art(1))
		expect(started).toHaveLength(1)
		const first = mountsOf(started[0]!)[0]!
		expect(first.entry).toBe(art(1))
		first.port!.postMessage({ t: "ready" })
		await settle()
		first.port!.postMessage({ t: "save-state", state: { page: 3 } })
		await settle()

		w.props.src = art(2)
		flushSync()
		await settle()
		// One worker, never a second: the old mount is unmounted in it and the
		// new module mounted in it.
		expect(started).toHaveLength(1)
		expect(started[0]!.terminated).toBe(0)
		const kinds = started[0]!.posted.map((m) => `${m.k}${m.entry ? ` ${m.entry}` : ""}`)
		expect(kinds).toEqual([`mount ${art(1)}`, "unmount", `mount ${art(2)}`])
		expect(started[0]!.posted[1]!.mountId).toBe(first.mountId)

		const second = mountsOf(started[0]!)[1]!
		expect(second.mountId).not.toBe(first.mountId)
		const got: Array<Record<string, unknown>> = []
		second.port!.onmessage = (e) => got.push(e.data)
		second.port!.postMessage({ t: "ready" })
		await settle()
		expect(got.find((m) => m.t === "state")?.state).toEqual({ page: 3 })
		await w.close()
	})

	test(`after ${RECYCLE_AFTER} modules the next reload gets a fresh worker, and the old one goes`, async () => {
		const w = widget(art(1))
		for (let n = 2; n <= RECYCLE_AFTER; n++) {
			w.props.src = art(n)
			flushSync()
		}
		expect(started).toHaveLength(1)
		expect(mountsOf(started[0]!)).toHaveLength(RECYCLE_AFTER)

		w.props.src = art(RECYCLE_AFTER + 1)
		flushSync()
		await settle()
		expect(started).toHaveLength(2)
		expect(started[0]!.terminated).toBe(1)
		expect(started[1]!.terminated).toBe(0)
		expect(mountsOf(started[1]!).map((m) => m.entry)).toEqual([art(RECYCLE_AFTER + 1)])
		// And the fresh one takes the next reloads.
		w.props.src = art(RECYCLE_AFTER + 2)
		flushSync()
		expect(started).toHaveLength(2)
		await w.close()
	})

	test("no src draws the widget as missing — unmounted, nothing new mounted, no crash", async () => {
		const w = widget(art(1))
		w.props.src = null
		flushSync()
		await settle()
		expect(w.target.querySelector("[data-sp-missing]")).not.toBeNull()
		expect(w.target.querySelector(".sp-remote-box")).toBeNull()
		expect(started[0]!.posted.map((m) => m.k)).toEqual(["mount", "unmount"])
		// Switched back on: mounted again.
		w.props.src = art(2)
		flushSync()
		await settle()
		expect(w.target.querySelector("[data-sp-missing]")).toBeNull()
		expect(mountsOf(started.at(-1)!).at(-1)?.entry).toBe(art(2))
		await w.close()
	})
})

describe("onRuntimeError", () => {
	function box(owner: string, src: string, onRuntimeError: (e: { message: string; stack?: string }) => void) {
		const target = document.createElement("div")
		document.body.appendChild(target)
		const app = mount(ComponentMount, { target, props: { owner, src, title: "Box", onRuntimeError } })
		flushSync()
		const worker = started.at(-1)!
		const mountId = mountsOf(worker).at(-1)!.mountId
		return {
			target,
			worker,
			mountId,
			close: async () => {
				await unmount(app)
				target.remove()
			}
		}
	}

	test("fires on the worker's `failed`, message and stack apart; the box stops and the worker is released", async () => {
		const seen: Array<{ message: string; stack?: string }> = []
		const b = box(OWNER, art(1), (e) => seen.push(e))
		b.worker.say({
			k: "failed",
			mountId: b.mountId,
			message: "x is not defined\n    at mount (http://h/authored-ui/a.js:3:9)\n    at run (http://h/w.js:1:1)"
		})
		flushSync()
		expect(seen).toEqual([
			{
				message: "x is not defined",
				stack: "    at mount (http://h/authored-ui/a.js:3:9)\n    at run (http://h/w.js:1:1)"
			}
		])
		expect(b.target.querySelector('[role="alert"]')).not.toBeNull()
		expect(b.worker.posted.map((m) => m.k)).toEqual(["mount", "unmount"])
		await b.close()
		// Torn down once: closing the page adds nothing.
		expect(b.worker.posted.map((m) => m.k)).toEqual(["mount", "unmount"])
	})

	test("fires on the worker's `error` (a handler threw) — still mounted", async () => {
		const seen: Array<{ message: string; stack?: string }> = []
		const b = box(OWNER, art(1), (e) => seen.push(e))
		b.worker.say({ k: "error", mountId: b.mountId, message: "handler blew up" })
		expect(seen).toEqual([{ message: "handler blew up" }])
		expect(b.target.querySelector('[role="alert"]')).toBeNull()
		expect(b.worker.posted.map((m) => m.k)).toEqual(["mount"])
		await b.close()
	})

	test("a listener that throws does not take the box down", async () => {
		const b = box(OWNER, art(1), () => {
			throw new Error("listener bug")
		})
		expect(() => b.worker.say({ k: "error", mountId: b.mountId, message: "boom" })).not.toThrow()
		await b.close()
	})
})

describe("an authored owner is never core's", () => {
	const edit = { key: "edit", specSlug: "core", name: "Edit", venue: "message", origin: "core", canAct: true, enabled: true }

	test("its presses are gated, its ids are its box's, its paint is contained", async () => {
		const edited: unknown[] = []
		const target = document.createElement("div")
		document.body.appendChild(target)
		const app = mount(ComponentMount, {
			target,
			props: {
				owner: OWNER,
				src: art(1),
				title: "Box",
				actions: { message: { primary: [edit], overflow: [] } } as never,
				actionDispatch: { core: { edit: (args: unknown) => edited.push(args) }, fire: () => {} } as never
			}
		})
		flushSync()
		const worker = started.at(-1)!
		expect(worker.name).toBe(`sp-ui:${OWNER}`)
		const mountId = mountsOf(worker)[0]!.mountId
		worker.say({ k: "wire", mountId, msg: { t: "ready" } })
		worker.say({ k: "wire", mountId, msg: { t: "invoke", key: "edit", messageId: 2, payload: { content: "x" } } })
		await settle()
		expect(edited).toEqual([])
		worker.say({
			k: "mutate",
			mountId,
			records: [[MUTATION_TYPE_INSERT_CHILD, ROOT_ID, { id: "n1", type: 1, element: "div", attributes: { id: "message-5" }, children: [] }, 0]]
		})
		expect(target.querySelector("#message-5")).toBeNull()
		expect(target.querySelector('[id$="-message-5"]')).not.toBeNull()
		const remoteBox = target.querySelector(".sp-remote-box") as HTMLElement
		expect(remoteBox.dataset.spOwner).toBe(OWNER)
		expect(remoteBox.style.contain).toBe("paint")
		await unmount(app)
		target.remove()
	})

	test("claiming `core` with an authored module is refused, never mounted", () => {
		const target = document.createElement("div")
		document.body.appendChild(target)
		const app = mount(ComponentMount, { target, props: { owner: "core", src: art(1), title: "Box" } })
		flushSync()
		expect(started).toHaveLength(0)
		expect(target.querySelector('[role="alert"]')).not.toBeNull()
		void unmount(app)
		target.remove()
	})
})
