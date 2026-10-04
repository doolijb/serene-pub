/**
 * The card menu's asks and the started-from push, as one tab sees them
 * (brief 6b review of `PLAN-layout-one-format-2026-09-28`).
 *
 * - Every answer reaches every tab of the person; only the tab that asked
 *   says how it went. A handler that throws answers with its `:error` twin,
 *   which names no layout, so the ask it answers is the tab's oldest of that
 *   verb — else a later answer from another tab's click was toasted here.
 * - The started-from push is read, then sent, after some awaits; a copy the
 *   page asked for can land in between. An answer that describes an older
 *   copy than the one the tab holds is old news.
 */
import { describe, expect, test } from "vitest"
import { LayoutAsks, olderThanHeld } from "./layoutAsks"

describe("LayoutAsks", () => {
	test("an answer is this tab's only when this tab asked, once per ask", () => {
		const asks = new LayoutAsks()
		expect(asks.take("share", 4)).toBe(false)
		asks.ask("share", 4)
		asks.ask("share", 4)
		expect(asks.take("clone", 4)).toBe(false)
		expect(asks.take("share", 5)).toBe(false)
		expect(asks.take("share", 4)).toBe(true)
		expect(asks.take("share", 4)).toBe(true)
		expect(asks.take("share", 4)).toBe(false)
		expect(asks.pending).toBe(0)
	})

	test("a handler that threw spends the tab's oldest ask of that verb, and only that one", () => {
		const asks = new LayoutAsks()
		asks.ask("share", 4)
		asks.ask("clone", 9)
		asks.ask("share", 7)
		expect(asks.fail("share")).toBe(true)
		// The share of 4 is settled; its later answer (another tab's click) is
		// not this tab's to toast.
		expect(asks.take("share", 4)).toBe(false)
		expect(asks.take("share", 7)).toBe(true)
		expect(asks.take("clone", 9)).toBe(true)
		// Nothing asked: an error from another tab's click is not ours.
		expect(asks.fail("update")).toBe(false)
		expect(asks.pending).toBe(0)
	})

	test("the new-session layout is asked per genre", () => {
		const asks = new LayoutAsks()
		asks.ask("new-session", "core:genre/adventure")
		expect(asks.take("new-session", "core:genre/chat")).toBe(false)
		expect(asks.take("new-session", "core:genre/adventure")).toBe(true)
	})
})

describe("olderThanHeld: is a started-from answer old news?", () => {
	const T1 = "2026-09-30T08:00:00.000Z"
	const T2 = "2026-09-30T08:00:01.000Z"

	test("an answer about an earlier copy than the tab holds is old", () => {
		expect(olderThanHeld(T2, T1)).toBe(true)
		// …and one about no copy at all, once the tab holds one.
		expect(olderThanHeld(T2, null)).toBe(true)
	})

	test("the same copy, a later one, or a tab that holds none: news", () => {
		expect(olderThanHeld(T1, T1)).toBe(false)
		expect(olderThanHeld(T1, T2)).toBe(false)
		expect(olderThanHeld(null, T1)).toBe(false)
		expect(olderThanHeld(null, null)).toBe(false)
	})

	test("an unreadable instant never hides an answer", () => {
		expect(olderThanHeld("not a time", T1)).toBe(false)
		expect(olderThanHeld(T1, "not a time")).toBe(false)
	})
})
