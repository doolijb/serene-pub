/** The frame `init` says what the frame is mounted as (🚧 m3-core). */
import { describe, expect, test } from "vitest"
import { initMessage } from "./framePort"

describe("initMessage mount", () => {
	test("carries the mount when given", () => {
		expect(
			initMessage("session-view", undefined, undefined, "applet").mount
		).toBe("applet")
		expect(initMessage("page", undefined, false, "page").mount).toBe("page")
	})
	test("omits the key when not given", () => {
		expect("mount" in initMessage("page")).toBe(false)
		expect("mount" in initMessage("page", undefined, true)).toBe(false)
	})
})

describe("initMessage inSession (🚧 m3)", () => {
	test("says whether a session is mounted, and only when told", () => {
		expect(initMessage("session-view", undefined, undefined, "applet", true).inSession).toBe(true)
		expect(initMessage("session-view", undefined, undefined, "applet", false).inSession).toBe(false)
		expect("inSession" in initMessage("session-view", undefined, undefined, "applet")).toBe(false)
	})
})
