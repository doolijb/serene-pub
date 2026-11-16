/** 🚧 The held timeline switch: true until read and for any other session. */
import { describe, expect, test, vi } from "vitest"

vi.mock("$app/environment", () => ({
	dev: true,
	building: false,
	browser: true
}))
vi.mock("$lib/client/utils/toaster", () => ({
	toaster: {
		error: () => {},
		success: () => {},
		info: () => {},
		warning: () => {}
	}
}))

import { mount, unmount } from "svelte"
import { createSessionPageData } from "./sessionPageData.svelte"
import Harness from "./sessionStoryTimelineHarness.test.svelte"

function make(sessionId: { v: number }) {
	const out: { api?: ReturnType<typeof createSessionPageData> } = {}
	const deps = {
		socket: { emit() {}, on() {}, off() {}, connected: true } as never,
		inbox: { on: () => () => {} } as never,
		sessionId: () => sessionId.v,
		loadedSessionId: () => sessionId.v,
		userCtx: {} as never,
		widgets: {} as never,
		draft: () => "",
		writeDraft: () => {}
	}
	const app = mount(Harness, { target: document.body, props: { deps, out } })
	return { data: out.api!, cleanup: () => unmount(app) }
}

describe("sessionPageData storyTimeline", () => {
	test("true before read, false after a false reply, true for another session", () => {
		const id = $state({ v: 7 })
		const { data, cleanup } = make(id)
		expect(data.storyTimeline).toBe(true)
		data.setStoryTimeline(7, false)
		expect(data.storyTimeline).toBe(false)
		data.setStoryTimeline(7, undefined)
		expect(data.storyTimeline).toBe(true)
		data.setStoryTimeline(7, false)
		id.v = 8
		expect(data.storyTimeline).toBe(true)
		cleanup()
	})
})
