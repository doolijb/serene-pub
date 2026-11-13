/**
 * 🚧 (s22-V) The fit line: a ruleset's genres on one line with each why on
 * hover, a Freeform book's sentence, a rated book's unfolded whys.
 *
 * ⚠ No DOM node is ever handed to `expect` (a failing assertion on one
 * serialises the whole happy-dom window): every check compares a boolean,
 * a string or plain data.
 */
import { afterEach, describe, expect, test } from "vitest"
import { flushSync, mount, unmount } from "svelte"
import RulesFitLine from "./RulesFitLine.svelte"
import type { RulesetGenreFit } from "./rulesFitWords"

let app: ReturnType<typeof mount> | null = null
afterEach(() => {
	if (app) unmount(app)
	app = null
	document.body.innerHTML = ""
})

const FITS: RulesetGenreFit[] = [
	{
		genreId: "story",
		genreName: "Story",
		rating: "great",
		reason: "everything it plays best with is here"
	},
	{
		genreId: "lair",
		genreName: "Lair",
		rating: "good",
		reason: "a health-like number — told in words",
		inWords: [{ label: "health", why: "a number the story tells in words" }]
	},
	{
		genreId: "crawler",
		genreName: "Dungeon Crawler",
		rating: "poor",
		reason: "most of what it plays best with is missing"
	}
]

const render = (props: Record<string, unknown>) => {
	const host = document.createElement("div")
	document.body.append(host)
	app = mount(RulesFitLine, { target: host, props })
	flushSync()
	return host
}
const said = (el: Element | null | undefined) =>
	el?.textContent?.replace(/\s+/g, " ").trim() ?? ""

describe("RulesFitLine", () => {
	test("a ruleset's fits read on one line, each why in the title", () => {
		const host = render({ fits: FITS })
		const line = host.querySelector("[data-rules-fit]")
		expect(said(line)).toBe(
			"Story: Great · Lair: Good · Dungeon Crawler: Poor"
		)
		const title = line?.getAttribute("title") ?? ""
		expect(title.split("\n")).toEqual([
			"Story: Great (everything it plays best with is here)",
			"Lair: Good (a health-like number — told in words)",
			"Dungeon Crawler: Poor (most of what it plays best with is missing)"
		])
		expect(line?.tagName).toBe("SPAN")
	})

	test("a book on Freeform says the session chooses, with no line", () => {
		const host = render({ fits: FITS, freeform: true })
		expect(said(host)).toBe("Freeform — the session chooses the rules")
		expect(host.querySelector('[data-rules-fit="freeform"]') !== null).toBe(
			true
		)
		expect(host.querySelectorAll("[data-rules-fit]").length).toBe(1)
		expect(host.querySelector("[title]") === null).toBe(true)
	})

	test("details unfold one item per genre with its reason and what is told in words", () => {
		const host = render({ fits: FITS, mode: "details" })
		expect(host.querySelector("details[data-rules-fit]") !== null).toBe(
			true
		)
		expect(said(host.querySelector("summary"))).toBe(
			"Story: Great · Lair: Good · Dungeon Crawler: Poor"
		)
		const items = [
			...host.querySelectorAll(
				"[data-rules-fit-why] > [data-rules-fit-genre]"
			)
		]
		expect(
			items.map((i) => i.getAttribute("data-rules-fit-genre"))
		).toEqual(["story", "lair", "crawler"])
		expect(said(items[0])).toBe(
			"Story: Great (everything it plays best with is here)"
		)
		expect(said(items[1])).toContain(
			"Lair: Good (a health-like number — told in words)"
		)
		expect(said(items[1])).toContain(
			"Health: a number the story tells in words"
		)
		expect(items[2]?.querySelector("ul") === null).toBe(true)
	})

	test("no fits and not Freeform draws nothing", () => {
		for (const props of [
			{},
			{ fits: null },
			{ fits: [] },
			{ fits: [], mode: "details" }
		]) {
			const host = render(props)
			expect(host.querySelector("[data-rules-fit]") === null).toBe(true)
			expect(said(host)).toBe("")
			unmount(app!)
			app = null
			host.remove()
		}
	})
})
