import { describe, expect, it } from "vitest"
import { leaveDestination } from "./leaveDestination"

describe("leaveDestination — where Leave goes", () => {
	it.each([
		["apps", true, "apps"],
		["apps", false, "sessions"],
		["home", true, "home"],
		["home", false, "home"],
		[undefined, true, "sessions"],
		[undefined, false, "sessions"],
		["junk", true, "sessions"],
		[42, false, "sessions"]
	] as const)("from %s, apps registered %s → %s", (from, registered, to) => {
		expect(leaveDestination(from, registered)).toBe(to)
	})
})
