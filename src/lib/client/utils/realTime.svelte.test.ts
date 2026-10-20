/**
 * Real-world time shows in the profile time zone, and a server instant reads
 * as the instant it is — the 2026-10-15 "a new session is 10 h ago, an
 * account made today says yesterday" report, pinned on the client side.
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import {
	adoptAccountTimeZone,
	displayTimeZone,
	realDate,
	realDateTime,
	setProfileTimeZone
} from "./realTime.svelte"
import { shortDate, timeAgo } from "./timeAgo"

const DAY = { year: "numeric", month: "2-digit", day: "2-digit" } as const

afterEach(() => setProfileTimeZone(null))

describe("realDate / realDateTime", () => {
	it("formats in the profile zone, not the machine's", () => {
		// 23:30 UTC on the 15th is still the 15th in Los Angeles, already the
		// 16th in Tokyo.
		const at = "2026-10-15T23:30:00.000Z"
		setProfileTimeZone("America/Los_Angeles")
		expect(realDate(at, DAY)).toBe(new Date(at).toLocaleDateString(undefined, { ...DAY, timeZone: "America/Los_Angeles" }))
		setProfileTimeZone("Asia/Tokyo")
		expect(realDate(at, { day: "numeric" })).toBe("16")
		expect(displayTimeZone()).toBe("Asia/Tokyo")
	})

	it("an account created at 17:00 Pacific shows that day, not the day before", () => {
		// What a `date` column used to send: "2026-10-15" — parsed as UTC
		// midnight, it is 17:00 on the 14th in Los Angeles. A timestamptz
		// sends the real instant instead.
		setProfileTimeZone("America/Los_Angeles")
		expect(realDate("2026-10-15", { day: "numeric" })).toBe("14")
		expect(realDate("2026-10-16T00:00:00.000Z", { day: "numeric" })).toBe("15")
	})

	it("an unknown zone falls back to the browser's; bad stamps are blank", () => {
		setProfileTimeZone("Nope/Nowhere")
		expect(displayTimeZone()).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone)
		expect(realDate(null)).toBe("")
		expect(realDateTime("not a date")).toBe("")
	})

	it("shortDate and timeAgo's dated tail go through the profile zone", () => {
		setProfileTimeZone("Asia/Tokyo")
		expect(shortDate("2026-10-15T23:30:00.000Z")).toBe(
			new Date("2026-10-15T23:30:00.000Z").toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "Asia/Tokyo" })
		)
		const now = Date.parse("2026-10-30T00:00:00.000Z")
		expect(timeAgo("2026-10-15T23:30:00.000Z", now)).toBe(
			shortDate("2026-10-15T23:30:00.000Z")
		)
	})

	it("a stamp written just now reads 'just now'", () => {
		expect(timeAgo(new Date().toISOString())).toBe("just now")
	})
})

describe("adoptAccountTimeZone", () => {
	it("adopts a set zone and reports nothing", () => {
		const report = vi.fn()
		adoptAccountTimeZone({ id: 901, timeZone: "Europe/Paris" }, report)
		expect(displayTimeZone()).toBe("Europe/Paris")
		expect(report).not.toHaveBeenCalled()
	})

	it("reports the browser's zone once per account when none is set", () => {
		const report = vi.fn()
		adoptAccountTimeZone({ id: 902, timeZone: null }, report)
		adoptAccountTimeZone({ id: 902, timeZone: null }, report)
		expect(report).toHaveBeenCalledTimes(1)
		expect(report).toHaveBeenCalledWith(
			Intl.DateTimeFormat().resolvedOptions().timeZone
		)
	})
})
