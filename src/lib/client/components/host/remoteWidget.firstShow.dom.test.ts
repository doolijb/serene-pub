/**
 * Mount on first show (unit M): a remote widget hidden where it sits — a
 * collapsed rail, a closed flyout, an inactive tab, an unseen mobile side,
 * all of them `display: none` around the mount — takes no worker and loads no
 * module until it is first drawn, and once drawn stays mounted however often
 * it is hidden again. The conversation (`eager`) mounts at once, shown or not.
 * The page's UI workers are stood in for; the page's size watching is too
 * (happy-dom draws nothing, so a resize is delivered by hand).
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, unmount } from "svelte"
import RemoteWidget from "./RemoteWidget.svelte"
import { isDrawn, whenFirstShown } from "./firstShow"

const worker = vi.hoisted(() => ({
	posted: [] as Array<Record<string, unknown>>,
	acquired: [] as string[],
	released: [] as string[]
}))
vi.mock("$lib/client/components/host/uiWorkers", () => ({
	acquireWorker: (owner: string) => (worker.acquired.push(owner), {}),
	releaseWorker: (owner: string) => worker.released.push(owner),
	listenForRemoteEvents: () => {},
	currentEvent: () => undefined,
	routeMount: () => () => {},
	postToWorker: (_w: unknown, m: Record<string, unknown>) => worker.posted.push(m)
}))

/** A stand-in `ResizeObserver`: every live one, so a test can say "this was drawn". */
const observers = new Set<{ cb: () => void; els: Set<Element> }>()
class FakeResizeObserver {
	#o: { cb: () => void; els: Set<Element> }
	constructor(cb: () => void) {
		this.#o = { cb, els: new Set() }
		observers.add(this.#o)
	}
	observe(el: Element) {
		this.#o.els.add(el)
	}
	unobserve(el: Element) {
		this.#o.els.delete(el)
	}
	disconnect() {
		observers.delete(this.#o)
	}
}
/** What the browser does when a hidden box is drawn: its observers hear a resize. */
const resized = () => {
	for (const o of [...observers]) o.cb()
	flushSync()
}
const mounts = () => worker.posted.filter((m) => m.k === "mount").length
const unmounts = () => worker.posted.filter((m) => m.k === "unmount").length

beforeEach(() => vi.stubGlobal("ResizeObserver", FakeResizeObserver))
afterEach(() => {
	worker.posted.length = 0
	worker.acquired.length = 0
	worker.released.length = 0
	observers.clear()
	vi.unstubAllGlobals()
	document.body.replaceChildren()
})

/** A widget in a box the layout hides with `display: none` (or not). */
function place(opts: { hidden: boolean; eager?: boolean }) {
	const around = document.createElement("div")
	around.style.display = opts.hidden ? "none" : "block"
	document.body.appendChild(around)
	const app = mount(RemoteWidget, {
		target: around,
		props: {
			widget: { id: "stats", title: "Stats" },
			owner: "core",
			src: "/core-ui/stats",
			session: { id: 7, name: "S", sessionMessages: [] },
			reads: [],
			...(opts.eager ? { eager: true } : {})
		}
	})
	flushSync()
	return {
		show: () => {
			around.style.display = "block"
			resized()
		},
		hide: () => {
			around.style.display = "none"
			resized()
		},
		close: () => {
			unmount(app)
			flushSync()
		}
	}
}

describe("a remote widget mounts on first show", () => {
	test("hidden, it takes no worker and loads no module", () => {
		const w = place({ hidden: true })
		expect(worker.acquired).toEqual([])
		expect(mounts()).toBe(0)
		expect(document.querySelector("[data-sp-unshown]") !== null).toBe(true)
		expect(document.querySelector(".sp-remote-box") === null).toBe(true)
		w.close()
	})

	test("a resize while still hidden mounts nothing", () => {
		const w = place({ hidden: true })
		resized()
		expect(mounts()).toBe(0)
		w.close()
	})

	test("drawn, it mounts — once — and hiding it again never unmounts it", () => {
		const w = place({ hidden: true })
		w.show()
		expect(worker.acquired).toEqual(["core"])
		expect(mounts()).toBe(1)
		expect(document.querySelector("[data-sp-unshown]") === null).toBe(true)
		w.hide()
		w.show()
		w.hide()
		expect(mounts()).toBe(1)
		expect(unmounts()).toBe(0)
		expect(worker.released).toEqual([])
		w.close()
		expect(unmounts()).toBe(1)
		expect(worker.released).toEqual(["core"])
	})

	test("already drawn, it mounts at once", () => {
		const w = place({ hidden: false })
		expect(mounts()).toBe(1)
		w.close()
	})

	test("the conversation (eager) mounts at once, drawn or not", () => {
		const w = place({ hidden: true, eager: true })
		expect(mounts()).toBe(1)
		w.close()
	})

	test("never drawn, leaving releases nothing it never took", () => {
		const w = place({ hidden: true })
		w.close()
		expect(worker.acquired).toEqual([])
		expect(worker.released).toEqual([])
		expect(observers.size).toBe(0)
	})
})

describe("whenFirstShown", () => {
	test("is told once, however many resizes follow; stopped, never", () => {
		const el = document.createElement("div")
		el.style.display = "none"
		document.body.appendChild(el)
		expect(isDrawn(el)).toBe(false)
		const seen = vi.fn()
		whenFirstShown(el, seen)
		expect(seen).not.toHaveBeenCalled()
		el.style.display = "block"
		resized()
		resized()
		expect(seen).toHaveBeenCalledTimes(1)

		const other = document.createElement("div")
		other.style.display = "none"
		document.body.appendChild(other)
		const never = vi.fn()
		whenFirstShown(other, never)()
		other.style.display = "block"
		resized()
		expect(never).not.toHaveBeenCalled()
	})

	test("a detached element is not drawn", () => {
		expect(isDrawn(document.createElement("div"))).toBe(false)
	})
})
