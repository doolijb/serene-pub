/**
 * The two rules the shared desk/compact switch is worth pinning.
 *
 * Both fail silently rather than loudly. A floor that drifts gives two views
 * different ideas of "wide enough" and nobody sees an error — only a sidebar
 * where one panel went two-pane and its neighbour did not. And the hidden-tab
 * rule has no symptom at all until a tab switch: every open view in this shell
 * stays mounted behind `hidden`, so a tracker that believed a hidden view's
 * 0px would silently collapse a dozen backgrounded views to compact and
 * re-expand them a frame after each one is shown again.
 */
import { beforeEach, describe, expect, test } from "vitest"
import { DESK_MIN_PX, modeForWidth, ViewModeTracker } from "./viewMode.svelte"

/**
 * The project's unit project runs in `environment: "node"`, which has no
 * ResizeObserver and no DOM. Both are stubbed rather than pulling in jsdom:
 * the tracker only ever calls `new ResizeObserver(cb)`, `.observe(node)` and
 * `.disconnect()`, and a fake that hands the callback back is what lets a test
 * deliver a 0px observation on purpose — the one thing a real observer in a
 * real browser will not do to order.
 */
class FakeResizeObserver {
	static last: FakeResizeObserver | undefined
	readonly callback: ResizeObserverCallback
	observed: unknown[] = []
	disconnected = false

	constructor(callback: ResizeObserverCallback) {
		this.callback = callback
		FakeResizeObserver.last = this
	}

	observe(target: unknown) {
		this.observed.push(target)
	}

	unobserve() {}

	disconnect() {
		this.disconnected = true
	}

	/** Deliver one width the way the browser would, content box first. */
	emit(width: number) {
		this.callback(
			[{ contentRect: { width } } as ResizeObserverEntry],
			this as unknown as ResizeObserver
		)
	}
}

beforeEach(() => {
	FakeResizeObserver.last = undefined
	globalThis.ResizeObserver =
		FakeResizeObserver as unknown as typeof ResizeObserver
})

/** `use:` an element the tracker never actually touches. */
function attach(tracker: ViewModeTracker) {
	const node = {} as HTMLElement
	const handle = tracker.observe(node)
	const observer = FakeResizeObserver.last!
	return { observer, handle }
}

describe("modeForWidth", () => {
	test("the floor is inclusive", () => {
		expect(modeForWidth(DESK_MIN_PX)).toBe("desk")
		expect(modeForWidth(DESK_MIN_PX - 1)).toBe("compact")
	})

	test("an unmeasured container is compact, never desk", () => {
		expect(modeForWidth(0)).toBe("compact")
	})

	test("the sidebar is compact and the full page is desk", () => {
		// The two widths the shell actually hands a view: the 400px dock and
		// everything right of the rail on a 1440px screen.
		expect(modeForWidth(400)).toBe("compact")
		expect(modeForWidth(1376)).toBe("desk")
	})
})

describe("ViewModeTracker", () => {
	test("starts compact and unmeasured", () => {
		const tracker = new ViewModeTracker()
		expect(tracker.mode).toBe("compact")
		expect(tracker.width).toBe(0)
	})

	test("takes its mode from the observed width", () => {
		const tracker = new ViewModeTracker()
		const { observer } = attach(tracker)

		observer.emit(400)
		expect(tracker.mode).toBe("compact")
		expect(tracker.width).toBe(400)

		observer.emit(1376)
		expect(tracker.mode).toBe("desk")
		expect(tracker.width).toBe(1376)
	})

	test("a hidden view keeps the last measured mode", () => {
		const tracker = new ViewModeTracker()
		const { observer } = attach(tracker)

		observer.emit(1376)
		expect(tracker.mode).toBe("desk")

		// The tab is switched away: `hidden` → `display: none` → a 0x0 box.
		observer.emit(0)
		expect(tracker.mode).toBe("desk")
		expect(tracker.width).toBe(1376)

		// Shown again at the same width: nothing moved in between.
		observer.emit(1376)
		expect(tracker.mode).toBe("desk")
	})

	test("a hidden COMPACT view does not spuriously become desk either", () => {
		const tracker = new ViewModeTracker()
		const { observer } = attach(tracker)

		observer.emit(400)
		observer.emit(0)
		expect(tracker.mode).toBe("compact")
		expect(tracker.width).toBe(400)
	})

	test("a real width after hiding still wins", () => {
		const tracker = new ViewModeTracker()
		const { observer } = attach(tracker)

		observer.emit(1376)
		observer.emit(0)
		// Came back in the sidebar rather than full page.
		observer.emit(400)
		expect(tracker.mode).toBe("compact")
		expect(tracker.width).toBe(400)
	})

	test("destroy disconnects the observer", () => {
		const tracker = new ViewModeTracker()
		const { observer, handle } = attach(tracker)

		expect(observer.observed).toHaveLength(1)
		handle?.destroy?.()
		expect(observer.disconnected).toBe(true)
	})
})
