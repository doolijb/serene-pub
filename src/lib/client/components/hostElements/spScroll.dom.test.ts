/**
 * `sp-scroll` keeps a stuck log at its end until the person scrolls away
 * from it. happy-dom lays nothing out, so each region is given a box by
 * hand (`layout`) and its scroll events are raised by hand, and the frames
 * it asks for run when a test says a frame comes (`frame`): what is tested
 * is which scrolls count as leaving the end, not the browser's layout.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest"
import { flushSync } from "svelte"
import { makeSpElementClass } from "./spElement.svelte"
import SpScroll from "./SpScroll.svelte"
import { LANDED_EVENT } from "$lib/client/utils/landOn"

const tick = () => new Promise((r) => setTimeout(r, 0))

/**
 * The animation frames asked for and not yet run. A browser runs them
 * after the frame's scroll events; here they run when a test says so.
 */
const frames = new Map<number, FrameRequestCallback>()
let frameIds = 0

/** A frame comes: every callback asked for runs, once. */
function frame() {
	const due = [...frames.values()]
	frames.clear()
	for (const callback of due) callback(performance.now())
}

beforeAll(() => {
	if (!customElements.get("sp-scroll"))
		customElements.define("sp-scroll", makeSpElementClass("sp-scroll", { component: SpScroll }))
	vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
		frames.set(++frameIds, callback)
		return frameIds
	})
	vi.stubGlobal("cancelAnimationFrame", (id: number) => void frames.delete(id))
	vi.stubGlobal("ResizeObserver", StandInResizeObserver)
})

afterAll(() => {
	vi.unstubAllGlobals()
})

afterEach(() => {
	document.body.replaceChildren()
	frames.clear()
	StandInResizeObserver.live.length = 0
	vi.restoreAllMocks()
})

function mount(attrs: Record<string, string>): { el: HTMLElement; region: HTMLElement } {
	const el = document.createElement("sp-scroll")
	for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
	document.body.appendChild(el)
	flushSync()
	return { el, region: el.querySelector<HTMLElement>(".sp-scroll-region")! }
}

/** A box for the region: its height, its content's, and a clamped scroll position. */
function layout(region: HTMLElement, box: { height: number; content: number }) {
	let top = 0
	Object.defineProperty(region, "clientHeight", { configurable: true, get: () => box.height })
	Object.defineProperty(region, "scrollHeight", { configurable: true, get: () => box.content })
	Object.defineProperty(region, "scrollTop", {
		configurable: true,
		get: () => top,
		set: (v: number) => {
			top = Math.max(0, Math.min(v, box.content - box.height))
		}
	})
	return box
}

/** A row lands: the region's mutation observer follows, and a frame comes. */
async function land(el: HTMLElement) {
	el.appendChild(document.createElement("p"))
	await tick()
	frame()
}

/** A scroll nothing of the reader's led to: the layout's, or a jump. */
const scroll = (region: HTMLElement, to: number) => {
	region.scrollTop = to
	region.dispatchEvent(new Event("scroll"))
}

/** The reader scrolls: a wheel on the region, then the scroll it makes. */
const readerScrolls = (region: HTMLElement, to: number) => {
	region.dispatchEvent(new Event("wheel", { bubbles: true }))
	scroll(region, to)
}

/**
 * happy-dom's ResizeObserver never observes anything: this one is told
 * when a box resized (`resized`), and delivers it to every observer
 * watching that box — as the browser does, after the frame's scroll events
 * and animation frames. A box whose size did not change is never reported.
 */
class StandInResizeObserver {
	static live: StandInResizeObserver[] = []
	readonly targets = new Set<Element>()
	constructor(readonly callback: ResizeObserverCallback) {
		StandInResizeObserver.live.push(this)
	}
	observe(target: Element) {
		this.targets.add(target)
	}
	unobserve(target: Element) {
		this.targets.delete(target)
	}
	disconnect() {
		this.targets.clear()
	}
}

/** `target`'s box changed size: its observers hear it. */
function resized(target: Element) {
	for (const ro of StandInResizeObserver.live)
		if (ro.targets.has(target))
			ro.callback([{ target } as unknown as ResizeObserverEntry], ro as unknown as ResizeObserver)
}

describe("sp-scroll", () => {
	test("a stuck region turns the browser's own anchoring off; a plain one leaves it", () => {
		expect(mount({ stick: "bottom" }).region.style.getPropertyValue("overflow-anchor")).toBe("none")
		expect(mount({ stick: "top" }).region.style.getPropertyValue("overflow-anchor")).toBe("none")
		expect(mount({}).region.style.getPropertyValue("overflow-anchor")).toBe("")
	})

	test("pinned, a scroll toward the end while the end moves further is not the reader leaving", async () => {
		const { el, region } = mount({ stick: "bottom" })
		const box = layout(region, { height: 200, content: 1000 })
		await land(el)
		expect(region.scrollTop).toBe(800)
		// Content above the view reflows taller and something other than the
		// reader moves the view toward the end, but short of it (the finding:
		// a resize wrapping rows, native anchoring adding 153 of 309px).
		box.content = 1300
		scroll(region, 950)
		await land(el)
		expect(region.scrollTop).toBe(1100)
	})

	test("scrolling away from the end unpins, and the region then holds its distance from the end", async () => {
		const { el, region } = mount({ stick: "bottom" })
		const box = layout(region, { height: 200, content: 1000 })
		await land(el)
		readerScrolls(region, 500)
		box.content = 1400
		await land(el)
		// 300 from the end, as the reader left it (nothing on screen to hold: no layout).
		expect(region.scrollTop).toBe(900)
		// Back down to the end pins it again.
		readerScrolls(region, 1200)
		box.content = 1500
		await land(el)
		expect(region.scrollTop).toBe(1300)
	})

	test("a newest-first log leaves its end by scrolling down, not up", async () => {
		const { el, region } = mount({ stick: "top" })
		const box = layout(region, { height: 200, content: 1000 })
		await land(el)
		expect(region.scrollTop).toBe(0)
		scroll(region, 0)
		box.content = 1200
		await land(el)
		expect(region.scrollTop).toBe(0)
		readerScrolls(region, 300)
		box.content = 1300
		await land(el)
		expect(region.scrollTop).toBe(300)
	})

	test("pinned, a reader who scrolls up in the frame a row landed still leaves", async () => {
		const { el, region } = mount({ stick: "bottom" })
		const box = layout(region, { height: 200, content: 1000 })
		await land(el)
		// The row lands and the region follows it to 1100 before any scroll
		// event is raised; the reader's wheel then takes it to 1050. Measured
		// from the last scroll event (800) that is toward the end; measured
		// from where the follow put it, it is away.
		box.content = 1300
		await land(el)
		readerScrolls(region, 1050)
		box.content = 1400
		await land(el)
		expect(region.scrollTop).toBe(1150)
	})
})

describe("sp-scroll, when something other than the reader moves it", () => {
	// Find in page, a screen reader bringing a row into view, caret browsing,
	// a `#message-<id>` link: none of them wheel, touch or press the region,
	// and each must stay where it put the log (the widen-and-revert layout
	// clamp is the accepted cost — see the component's header).
	test("a scroll that leaves the end with no reader input stays where it was put, frame after frame", async () => {
		const { el, region } = mount({ stick: "bottom" })
		layout(region, { height: 200, content: 1000 })
		await land(el)
		scroll(region, 300)
		expect(region.scrollTop).toBe(300)
		frame()
		frame()
		expect(region.scrollTop).toBe(300)
	})

	test("left that way, a row landing holds what is on screen rather than snapping to the end", async () => {
		const { el, region } = mount({ stick: "bottom" })
		const box = layout(region, { height: 200, content: 1000 })
		await land(el)
		scroll(region, 300)
		box.content = 1100
		resized(el.querySelector("p")!)
		expect(region.scrollTop).not.toBe(900)
	})

	test("a resize of the region, or of its content, still follows a pinned end", async () => {
		const { el, region } = mount({ stick: "bottom" })
		const box = layout(region, { height: 200, content: 1000 })
		await land(el)
		// An image loading in the newest row: no mutation, the row resizes.
		box.content = 1250
		resized(el.querySelector("p")!)
		expect(region.scrollTop).toBe(1050)
		box.height = 300
		resized(region)
		expect(region.scrollTop).toBe(950)
	})
})

describe("sp-scroll, when a landing puts the log somewhere", () => {
	// `landOn` scrolls instantly and says so (`LANDED_EVENT`) before the
	// scroll event is raised: a row landing in that gap must not pin the log
	// back to its end.
	test("a landing lets go of the end before its scroll event, and a row landing then holds it", async () => {
		const { el, region } = mount({ stick: "bottom" })
		const box = layout(region, { height: 200, content: 1000 })
		await land(el)
		const row = el.querySelector("p")!
		region.scrollTop = 300
		row.dispatchEvent(new CustomEvent(LANDED_EVENT, { bubbles: true }))
		box.content = 1100
		await land(el)
		expect(region.scrollTop).toBe(300)
		// The reader going back to the end pins it again.
		readerScrolls(region, 900)
		box.content = 1200
		await land(el)
		expect(region.scrollTop).toBe(1000)
	})

	test("a landing that leaves the log at its end keeps it pinned", async () => {
		const { el, region } = mount({ stick: "bottom" })
		const box = layout(region, { height: 200, content: 1000 })
		await land(el)
		el.querySelector("p")!.dispatchEvent(new CustomEvent(LANDED_EVENT, { bubbles: true }))
		box.content = 1100
		await land(el)
		expect(region.scrollTop).toBe(900)
	})
})
