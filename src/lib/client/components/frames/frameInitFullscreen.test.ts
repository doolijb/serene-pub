/** The frame `init` carries the viewer's current full screen state (🚧 M0, L1). */
import { describe, expect, test } from "vitest"
import { initMessage } from "./framePort"

describe("initMessage fullscreen", () => {
	test("carries the flag when given", () => {
		expect((initMessage("page", undefined, true) as any).fullscreen).toBe(true)
		expect((initMessage("page", undefined, false) as any).fullscreen).toBe(false)
	})
	test("absent when not given", () => {
		expect("fullscreen" in initMessage("page")).toBe(false)
	})
})
