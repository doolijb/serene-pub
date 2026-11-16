/**
 * 🚧 The member Timeline tab with the book's Timeline switch off: it keeps
 * its scenes and drops dates and "later". On, it is as it was.
 */
import { afterEach, describe, expect, test } from "vitest"
import { flushSync, mount, unmount } from "svelte"
import { bookDataContext, staticBookData } from "../bookData.svelte"
import MemberTimeline from "./MemberTimeline.svelte"
import type { MemberScene } from "./memberScenes"

let app: ReturnType<typeof mount> | null = null
afterEach(() => {
	if (app) unmount(app)
	app = null
	document.body.innerHTML = ""
})

const rows: MemberScene[] = [
	{
		id: 1,
		historyEntryId: 8,
		label: "The gate",
		date: { year: 3, month: null, day: null },
		note: "12 messages",
		later: false
	},
	{
		id: 2,
		historyEntryId: 9,
		label: "The vault",
		date: { year: 9, month: null, day: null },
		note: "not yet compiled",
		later: true
	}
]

function show(timelineEnabled: boolean) {
	const host = document.createElement("div")
	document.body.append(host)
	app = mount(MemberTimeline, {
		target: host,
		props: { rows, memberName: "Verity", onOpenScene: () => {} },
		context: bookDataContext(
			staticBookData(() => ({ timelineEnabled }))
		)
	})
	flushSync()
	return (host.textContent ?? "").replace(/\s+/g, " ")
}

describe("the member Timeline tab", () => {
	test("on: dates, notes and later", () => {
		const text = show(true)
		expect(text).toContain("The gate")
		expect(text).toContain("Year 3")
		expect(text).toContain("later")
		expect(text).toContain("not yet compiled")
	})
	test("off: the scenes stay, with no date and nothing later", () => {
		const text = show(false)
		expect(text).toContain("The gate")
		expect(text).toContain("The vault")
		expect(text).toContain("12 messages")
		expect(text).not.toContain("Year 3")
		expect(text).not.toContain("Undated")
		expect(text).not.toContain("later")
		expect(text).not.toContain("not yet compiled")
		expect(
			!!document.querySelector('[data-cast-scene="2"].opacity-50')
		).toBe(false)
	})
})
