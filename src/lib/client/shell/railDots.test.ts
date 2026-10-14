/**
 * less-confusing B1 and B2 (2026-10-11): the grey "open but not showing" dot
 * is the wide rail's alone, and every dot the rail draws has words, which
 * are both the item's accessible name and its tooltip.
 */
import { describe, expect, test } from "vitest"
import {
	railDotWords,
	railLabel,
	railShowsMessagesDot,
	unreadMessagesWords,
	railShowsOpenDot,
	railTitle,
	type RailDotFacts
} from "./railDots"

const facts = (over: Partial<RailDotFacts> = {}): RailDotFacts => ({
	key: "characters",
	wide: false,
	openNotShowing: false,
	writing: false,
	waiting: 0,
	adminWorst: null,
	unreadMessages: 0,
	...over
})

describe("B1 · the open-view dot", () => {
	test("the narrow rail draws none, even for a view still open", () => {
		const f = facts({ openNotShowing: true })
		expect(railShowsOpenDot(f)).toBe(false)
		expect(railDotWords(f)).toEqual([])
		expect(railLabel("Characters", f)).toBe("Characters")
	})

	test("the wide rail draws it and says so", () => {
		const f = facts({ wide: true, openNotShowing: true })
		expect(railShowsOpenDot(f)).toBe(true)
		expect(railLabel("Characters", f)).toBe("Characters, still open")
	})
})

describe("B2 · every dot has words, and the tooltip says them", () => {
	test("Admin says what its dot says, as name and as tooltip", () => {
		const f = facts({ key: "admin", adminWorst: "attention" })
		expect(railLabel("Admin", f)).toBe("Admin, something needs you")
		expect(railTitle("Admin", f)).toBe("Admin, something needs you")
		const broken = facts({ key: "admin", wide: true, adminWorst: "error" })
		expect(railTitle("Admin", broken)).toBe("Admin, something is broken")
	})

	test("Activity counts what is waiting", () => {
		const f = facts({ key: "activity", wide: true, waiting: 3 })
		expect(railTitle("Activity", f)).toBe("Activity, 3 waiting on you")
	})

	test("Sessions says a reply is being written while its ember dot shows", () => {
		const f = facts({ key: "sessions", wide: true, writing: true })
		expect(railTitle("Sessions", f)).toBe(
			"Sessions, a reply is being written"
		)
		// Only Sessions carries the ember dot.
		expect(railDotWords(facts({ key: "characters", writing: true }))).toEqual(
			[]
		)
	})

	test("two dots, both said, in the order they sit", () => {
		const f = facts({
			key: "sessions",
			wide: true,
			openNotShowing: true,
			writing: true
		})
		expect(railLabel("Sessions", f)).toBe(
			"Sessions, still open, a reply is being written"
		)
	})

	test("the narrow rail titles every item; the wide rail only a row with a dot", () => {
		expect(railTitle("Characters", facts())).toBe("Characters")
		expect(railTitle("Characters", facts({ wide: true }))).toBeUndefined()
	})

	test("a dot's words never belong to another item", () => {
		const f = facts({ key: "characters", waiting: 2, adminWorst: "error" })
		expect(railDotWords(f)).toEqual([])
	})
})

describe("Messages · the unread dot (PLAN-private-messages §6.2)", () => {
	test("draws and says its count only on the Messages item", () => {
		const f = facts({ key: "conversations", unreadMessages: 3 })
		expect(railShowsMessagesDot(f)).toBe(true)
		expect(railLabel("Messages", f)).toBe("Messages, 3 unread")
		expect(railTitle("Messages", { ...f, wide: true })).toBe(
			"Messages, 3 unread"
		)
		const other = facts({ key: "characters", unreadMessages: 3 })
		expect(railShowsMessagesDot(other)).toBe(false)
		expect(railDotWords(other)).toEqual([])
	})

	test("nothing unread draws nothing and says nothing", () => {
		const f = facts({ key: "conversations", wide: true })
		expect(railShowsMessagesDot(f)).toBe(false)
		expect(railTitle("Messages", f)).toBeUndefined()
	})

	test("the phone Views button names what is unread", () => {
		expect(unreadMessagesWords(0)).toBeNull()
		expect(unreadMessagesWords(1)).toBe("1 unread message")
		expect(unreadMessagesWords(4)).toBe("4 unread messages")
	})
})
