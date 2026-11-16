import { describe, expect, test } from "vitest"
import { mount, unmount } from "svelte"
import { bookDataContext, bookTimeline, staticBookData } from "./bookData.svelte"
import Probe from "./bookTimelineProbe.svelte"

function read(context?: Map<symbol, unknown>) {
	const out = { value: null as boolean | null }
	const app = mount(Probe, {
		target: document.body,
		context: context as Map<any, any>,
		props: { out }
	})
	unmount(app)
	return out.value
}

describe("BookData.timelineEnabled / bookTimeline()", () => {
	test("true outside the workspace and by default", () => {
		expect(read()).toBe(true)
		expect(
			staticBookData(() => ({})).timelineEnabled
		).toBe(true)
		expect(read(bookDataContext(staticBookData(() => ({}))))).toBe(true)
	})
	test("false when the row says false", () => {
		const data = staticBookData(() => ({ timelineEnabled: false }))
		expect(data.timelineEnabled).toBe(false)
		expect(read(bookDataContext(data))).toBe(false)
	})
})
