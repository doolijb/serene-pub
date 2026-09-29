import { describe, expect, it } from "vitest"
import {
	AUTO_READ_DWELL_MS,
	covers,
	dwellStep,
	idsToRead,
	type ViewingSnapshot
} from "./covers"

function viewing(over: Partial<ViewingSnapshot> = {}): ViewingSnapshot {
	return {
		pathname: "/",
		search: "",
		pageVisible: true,
		activeView: null,
		adminHref: "/admin",
		helpSlug: null,
		loreHash: "",
		...over
	}
}

describe("covers — sessions", () => {
	it("covers the session page, whatever the landing query", () => {
		const v = viewing({ pathname: "/sessions/42" })
		expect(covers(v, "/sessions/42")).toBe(true)
		expect(covers(v, "/sessions/42?message=910")).toBe(true)
		expect(covers(v, "/sessions/42?message=910&block=knock")).toBe(true)
	})

	it("covers from Document View's session page", () => {
		const v = viewing({ pathname: "/document-view/sessions/42" })
		expect(covers(v, "/sessions/42?message=910")).toBe(true)
	})

	it("ignores a trailing slash on either side", () => {
		expect(covers(viewing({ pathname: "/sessions/42/" }), "/sessions/42")).toBe(true)
		expect(covers(viewing({ pathname: "/sessions/42" }), "/sessions/42/")).toBe(true)
	})

	it("does not cover another session, or a prefix of the id", () => {
		expect(covers(viewing({ pathname: "/sessions/43" }), "/sessions/42")).toBe(false)
		expect(covers(viewing({ pathname: "/sessions/420" }), "/sessions/42")).toBe(false)
		expect(covers(viewing({ pathname: "/sessions/4" }), "/sessions/42")).toBe(false)
		expect(covers(viewing({ pathname: "/sessions" }), "/sessions/42")).toBe(false)
		expect(covers(viewing({ pathname: "/" }), "/sessions/42")).toBe(false)
	})

	it("does not cover while the page is hidden under a Focus view or phone sheet", () => {
		const v = viewing({ pathname: "/sessions/42", pageVisible: false })
		expect(covers(v, "/sessions/42")).toBe(false)
	})

	it("a sidebar view beside the page does not hide it", () => {
		const v = viewing({ pathname: "/sessions/42", activeView: "characters" })
		expect(covers(v, "/sessions/42")).toBe(true)
	})
})

describe("covers — admin", () => {
	const onData = viewing({ activeView: "admin", adminHref: "/admin/data" })

	it("covers the section on screen, ignoring the landing fragment", () => {
		expect(covers(onData, "/admin/data")).toBe(true)
		expect(covers(onData, "/admin/data#backup-now")).toBe(true)
		expect(covers(onData, "/admin/data/")).toBe(true)
	})

	it("needs the Admin view on screen", () => {
		expect(covers({ ...onData, activeView: null }, "/admin/data")).toBe(false)
		expect(covers({ ...onData, activeView: "help" }, "/admin/data")).toBe(false)
		expect(covers({ ...onData, adminHref: null }, "/admin/data")).toBe(false)
	})

	it("another section is not covered", () => {
		expect(covers(onData, "/admin/users")).toBe(false)
		expect(covers(onData, "/admin")).toBe(false)
		expect(covers(onData, "/admin/data/extra")).toBe(false)
	})

	it("compares the query too, in any parameter order", () => {
		const v = viewing({ activeView: "admin", adminHref: "/admin/users?id=3&tab=a" })
		expect(covers(v, "/admin/users?tab=a&id=3")).toBe(true)
		expect(covers(v, "/admin/users?id=3&tab=a#x")).toBe(true)
		expect(covers(v, "/admin/users?id=4&tab=a")).toBe(false)
		expect(covers(v, "/admin/users")).toBe(false)
	})

	it("the admin root is covered by the admin root", () => {
		const v = viewing({ activeView: "admin", adminHref: "/admin" })
		expect(covers(v, "/admin")).toBe(true)
		expect(covers(v, "/admin#anything")).toBe(true)
	})

	it("the page path does not stand in for the Admin view", () => {
		const v = viewing({ pathname: "/admin/data", activeView: null, adminHref: "/admin/data" })
		expect(covers(v, "/admin/data")).toBe(false)
	})
})

describe("covers — docs", () => {
	it("covers the Help page open, ignoring the anchor", () => {
		const v = viewing({ activeView: "help", helpSlug: "sessions" })
		expect(covers(v, "/docs/sessions")).toBe(true)
		expect(covers(v, "/docs/sessions#turn-order")).toBe(true)
		expect(covers(v, "/docs/sessions/")).toBe(true)
	})

	it("needs the Help view on screen, on that page", () => {
		expect(covers(viewing({ activeView: null, helpSlug: "sessions" }), "/docs/sessions")).toBe(false)
		expect(covers(viewing({ activeView: "help", helpSlug: "lorebooks" }), "/docs/sessions")).toBe(false)
		expect(covers(viewing({ activeView: "help", helpSlug: null }), "/docs/sessions")).toBe(false)
	})

	it("the index is covered by the index", () => {
		expect(covers(viewing({ activeView: "help", helpSlug: null }), "/docs")).toBe(true)
		expect(covers(viewing({ activeView: "help", helpSlug: "sessions" }), "/docs")).toBe(false)
	})

	it("decodes the slug", () => {
		const v = viewing({ activeView: "help", helpSlug: "a b" })
		expect(covers(v, "/docs/a%20b")).toBe(true)
	})
})

describe("covers — lore", () => {
	const onEntry = viewing({
		activeView: "lorebooks",
		loreHash: "#lore=12/history/340"
	})

	it("covers the same lore route", () => {
		expect(covers(onEntry, "/lorebooks#lore=12/history/340")).toBe(true)
	})

	it("compares routes, not strings: query order and legacy spellings are one place", () => {
		const v = viewing({
			activeView: "lorebooks",
			loreHash: "#lore=12/all?lens=graph&branch=2"
		})
		expect(covers(v, "/lorebooks#lore=12/all?branch=2&lens=graph")).toBe(true)
		// `graphs` is the legacy scope for the pool drawn as a graph.
		const legacy = viewing({ activeView: "lorebooks", loreHash: "#lore=12/all?lens=graph" })
		expect(covers(legacy, "/lorebooks#lore=12/graphs")).toBe(true)
	})

	it("a lore address on another path still means the Lorebooks view", () => {
		expect(covers(onEntry, "/sessions/4#lore=12/history/340")).toBe(true)
	})

	it("needs the Lorebooks view on screen", () => {
		expect(covers({ ...onEntry, activeView: null }, "/lorebooks#lore=12/history/340")).toBe(false)
		expect(covers({ ...onEntry, activeView: "admin" }, "/lorebooks#lore=12/history/340")).toBe(false)
	})

	it("a different route is not covered", () => {
		expect(covers(onEntry, "/lorebooks#lore=12/history/341")).toBe(false)
		expect(covers(onEntry, "/lorebooks#lore=13/history/340")).toBe(false)
		expect(covers(onEntry, "/lorebooks#lore=12/history")).toBe(false)
		expect(covers(onEntry, "/lorebooks#lore=12/history/340?lens=graph")).toBe(false)
	})

	it("the list of books covers no lore address", () => {
		const v = viewing({ activeView: "lorebooks", loreHash: "" })
		expect(covers(v, "/lorebooks#lore=12/history/340")).toBe(false)
		expect(covers({ ...v, loreHash: null }, "/lorebooks#lore=12/history/340")).toBe(false)
	})

	it("a non-lore fragment falls through to the path rules", () => {
		const v = viewing({ activeView: "admin", adminHref: "/admin/data" })
		expect(covers(v, "/admin/data#lore-ish")).toBe(true)
	})
})

describe("covers — everything else", () => {
	it("an unknown or foreign href is never covered", () => {
		const v = viewing({ pathname: "/characters", activeView: "admin", adminHref: "/admin" })
		expect(covers(v, "/characters")).toBe(false)
		expect(covers(v, "")).toBe(false)
		expect(covers(v, "https://example.com/admin")).toBe(false)
		expect(covers(v, "//example.com/admin")).toBe(false)
		expect(covers(v, "admin")).toBe(false)
	})
})

describe("idsToRead", () => {
	const v = viewing({ pathname: "/sessions/42" })
	const row = (id: number, href: string, readAt: string | null = null, clearedAt: string | null = null) => ({
		id,
		href,
		readAt,
		clearedAt
	})

	it("returns the unread open rows the screen covers", () => {
		const rows = [
			row(1, "/sessions/42"),
			row(2, "/sessions/42?message=9", "2026-09-28T00:00:00Z"),
			row(3, "/sessions/43"),
			row(4, "/sessions/42?message=9&block=knock"),
			row(5, "/sessions/42", null, "2026-09-28T00:00:00Z")
		]
		expect(idsToRead(rows, v)).toEqual([1, 4])
	})

	it("returns nothing when nothing is covered", () => {
		expect(idsToRead([row(1, "/admin/data")], v)).toEqual([])
		expect(idsToRead([], v)).toEqual([])
	})
})

describe("dwellStep", () => {
	const D = AUTO_READ_DWELL_MS

	it("starts the clock, then reads once the dwell holds", () => {
		let s = dwellStep(new Map(), [1], 1000)
		expect(s.due).toEqual([])
		expect(s.nextAt).toBe(1000 + D)
		s = dwellStep(s.state, [1], 1000 + D - 1)
		expect(s.due).toEqual([])
		s = dwellStep(s.state, [1], 1000 + D)
		expect(s.due).toEqual([1])
		expect(s.nextAt).toBeNull()
	})

	it("emits a read once while the row stays covered", () => {
		let s = dwellStep(new Map(), [1], 0)
		s = dwellStep(s.state, [1], D)
		expect(s.due).toEqual([1])
		s = dwellStep(s.state, [1], D * 3)
		expect(s.due).toEqual([])
		expect(s.state.get(1)).toBe("sent")
	})

	it("losing cover (hidden, unfocused, navigated away) restarts the clock", () => {
		let s = dwellStep(new Map(), [1], 0)
		s = dwellStep(s.state, [], 1000)
		expect(s.state.size).toBe(0)
		expect(s.nextAt).toBeNull()
		s = dwellStep(s.state, [1], 1200)
		expect(s.nextAt).toBe(1200 + D)
		s = dwellStep(s.state, [1], D + 1)
		expect(s.due).toEqual([])
	})

	it("a sent read that never landed is sent again after leaving and returning", () => {
		let s = dwellStep(new Map(), [1], 0)
		s = dwellStep(s.state, [1], D)
		expect(s.due).toEqual([1])
		s = dwellStep(s.state, [], D + 10)
		s = dwellStep(s.state, [1], D + 20)
		s = dwellStep(s.state, [1], 2 * D + 20)
		expect(s.due).toEqual([1])
	})

	it("a row that arrives while covered gets its own full dwell; the earlier one keeps its clock", () => {
		let s = dwellStep(new Map(), [1], 0)
		s = dwellStep(s.state, [1, 2], 1000)
		expect(s.nextAt).toBe(D)
		s = dwellStep(s.state, [1, 2], D)
		expect(s.due).toEqual([1])
		expect(s.nextAt).toBe(1000 + D)
		s = dwellStep(s.state, [1, 2], 1000 + D)
		expect(s.due).toEqual([2])
	})

	it("nothing covered reads nothing", () => {
		const s = dwellStep(new Map(), [], 5000)
		expect(s.due).toEqual([])
		expect(s.nextAt).toBeNull()
	})

	it("a duplicate id in the covered list is counted once", () => {
		const s = dwellStep(new Map([[1, 0]]), [1, 1], D)
		expect(s.due).toEqual([1])
	})
})
