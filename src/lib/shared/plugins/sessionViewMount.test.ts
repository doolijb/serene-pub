import { describe, expect, test } from "vitest"
import { sessionViewMount } from "./sessionViewMount"

describe("sessionViewMount (m3-core)", () => {
	test("an applet genre's frame holds ui, session and applet, with the grants joined", () => {
		const m = sessionViewMount({
			applet: true,
			sessionGrants: ["send"],
			appletGrants: ["applet:sessions", "storage"]
		})
		expect(m.apis).toEqual(["ui", "session", "applet"])
		expect(m.grants).toEqual(["send", "applet:sessions", "storage"])
	})
	test("an ordinary frame has no apis and its grants unchanged", () => {
		const m = sessionViewMount({
			applet: false,
			sessionGrants: ["send"],
			appletGrants: ["storage"]
		})
		expect("apis" in m).toBe(false)
		expect(m.grants).toEqual(["send"])
	})
})
