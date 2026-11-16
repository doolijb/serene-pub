/**
 * `sp-message-body`'s throttle: while a body streams, the markdown renders at
 * most every 50 ms and the last chunk always lands; not streaming, it renders
 * at once.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, unmount } from "svelte"
import SpMessageBody from "./SpMessageBody.svelte"

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

function setup(initial: Record<string, string | null>) {
	const attrs = $state<Record<string, string | null>>(initial)
	const host = document.createElement("sp-message-body")
	document.body.appendChild(host)
	const app = mount(SpMessageBody, {
		target: host,
		props: { attrs, writes: {}, host, emit: () => {} } as any
	})
	flushSync()
	return {
		attrs,
		shown: () => host.textContent?.trim() ?? "",
		done: () => {
			unmount(app)
			host.remove()
		}
	}
}

describe("sp-message-body streaming throttle", () => {
	test("changes inside 50 ms render once, and the trailing text lands", () => {
		const t = setup({ text: "a", streaming: "" })
		vi.advanceTimersByTime(60)
		t.attrs.text = "ab"
		flushSync()
		const afterFirst = t.shown()
		t.attrs.text = "abc"
		flushSync()
		t.attrs.text = "abcd"
		flushSync()
		expect(t.shown()).toBe(afterFirst)
		vi.advanceTimersByTime(60)
		flushSync()
		expect(t.shown()).toBe("abcd")
		t.done()
	})

	test("when streaming ends the full text renders at once", () => {
		const t = setup({ text: "a", streaming: "" })
		vi.advanceTimersByTime(60)
		t.attrs.text = "ab"
		flushSync()
		t.attrs.text = "abc"
		flushSync()
		t.attrs.streaming = null
		flushSync()
		expect(t.shown()).toBe("abc")
		t.done()
	})

	test("not streaming renders every change at once", () => {
		const t = setup({ text: "a" })
		t.attrs.text = "ab"
		flushSync()
		expect(t.shown()).toBe("ab")
		t.done()
	})
})
