/**
 * The entry's Beginning and Decay row: its words collapsed, its two editors
 * open, what a choice writes, and that drawing or opening writes nothing.
 *
 * ⚠ No DOM node is ever handed to `expect`: booleans, strings and plain data.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { createRawSnippet, flushSync, mount, tick, unmount } from "svelte"

vi.mock("$app/environment", () => ({ dev: true, building: false }))

import BeginningDecayRow from "./BeginningDecayRow.svelte"
import { bookDataContext, staticBookData } from "../bookData.svelte"
import { openBookTime } from "./bookTime.svelte"

let app: Record<string, any> | null = null
afterEach(() => {
	if (app) unmount(app)
	app = null
	document.body.innerHTML = ""
})

function draw(
	draft: Record<string, any>,
	over: {
		timeline?: boolean
		readOnly?: boolean
		lineWords?: string
		kids?: boolean
		action?: boolean
		props?: Record<string, any>
	} = {}
) {
	const data = staticBookData(
		() => ({ timelineEnabled: over.timeline ?? true }) as any
	)
	const target = document.createElement("div")
	document.body.append(target)
	const inner = document.createElement(over.readOnly ? "fieldset" : "div")
	if (over.readOnly) (inner as HTMLFieldSetElement).disabled = true
	target.append(inner)
	const props: { draft: Record<string, any>; idPrefix: string } & Record<
		string,
		any
	> = {
		draft,
		idPrefix: "t",
		lineWords: over.lineWords,
		lineAction: over.action
			? createRawSnippet(() => ({
					render: () =>
						`<button type="button" data-action>Act</button>`
				}))
			: undefined,
		children: over.kids
			? createRawSnippet(() => ({
					render: () => `<p data-kids>Entry area</p>`
				}))
			: undefined
	}
	// Descriptors, so a getter/setter pair stays a live `bind:open`.
	Object.defineProperties(
		props,
		Object.getOwnPropertyDescriptors(over.props ?? {})
	)
	app = mount(BeginningDecayRow, {
		target: inner,
		props,
		context: bookDataContext(data)
	})
	flushSync()
}

const q = (sel: string) => document.body.querySelector<HTMLInputElement>(sel)
const words = () =>
	q("[data-lore-beginning-decay-words]")?.textContent?.trim() ?? ""
const toggle = () => q("button[aria-expanded]")!
async function openRow() {
	toggle().click()
	await tick()
	flushSync()
}
async function pick(label: string) {
	const input = [
		...document.body.querySelectorAll<HTMLInputElement>(
			'input[type="radio"]'
		)
	].find((i) => i.closest("label")?.textContent?.trim() === label)!
	input.click()
	await tick()
	flushSync()
}
async function type(sel: string, value: string) {
	const el = q(sel)!
	el.value = value
	el.dispatchEvent(new Event("input", { bubbles: true }))
	await tick()
	flushSync()
}

describe("collapsed words", () => {
	test("Timeline on", () => {
		draw({})
		expect(words()).toBe("Perpetual · Fact")
		app && unmount(app)
		document.body.innerHTML = ""
		draw({ decayRate: 0.25 })
		expect(words()).toBe("Perpetual · Living · 0.25")
		app && unmount(app)
		document.body.innerHTML = ""
		draw({ year: 12, month: 3, day: 4, decayRate: 0 })
		expect(words()).toBe("Began at Year 12, Mo. 3, Day 4 · Fact")
		app && unmount(app)
		document.body.innerHTML = ""
		draw({ year: 12, month: 3, day: 4, decayRate: 0.5 })
		expect(words()).toBe("Began at Year 12, Mo. 3, Day 4 · Living · 0.5")
	})

	test("Timeline off hides the Beginning words", () => {
		draw({ year: 12, decayRate: 0 }, { timeline: false })
		expect(words()).toBe("Decay: Fact")
		app && unmount(app)
		document.body.innerHTML = ""
		draw({ decayRate: 1 }, { timeline: false })
		expect(words()).toBe("Decay: Living · 1")
	})

	test("the toggle names the entry and states its expansion", () => {
		draw({})
		expect(toggle().getAttribute("aria-label")).toBe(
			"The entry: Perpetual · Fact"
		)
		expect(toggle().getAttribute("aria-expanded")).toBe("false")
	})
})

describe("line action", () => {
	test("is drawn with the line inside the open region, not beside the toggle", async () => {
		draw({}, { action: true, lineWords: "On main" })
		expect(q("[data-action]") == null).toBe(true)
		await openRow()
		const action = q("[data-action]")
		expect(action != null).toBe(true)
		expect(action!.closest("[data-lore-entry-line]") != null).toBe(true)
		expect(action!.parentElement === toggle().parentElement).toBe(false)
		expect(
			q("[data-lore-entry-line]")?.textContent?.includes("On main")
		).toBe(true)
	})
})

describe("opened", () => {
	test("Timeline on: both editors", async () => {
		draw({})
		await openRow()
		expect(q("[data-lore-beginning]") != null).toBe(true)
		expect(q("[data-lore-decay]") != null).toBe(true)
	})

	test("Timeline off: Decay only", async () => {
		draw({}, { timeline: false })
		await openRow()
		expect(q("[data-lore-beginning]") == null).toBe(true)
		expect(q("[data-lore-decay]") != null).toBe(true)
	})

	test("nothing is written on mount or on open", async () => {
		const draft = $state<Record<string, any>>({})
		draw(draft)
		await openRow()
		expect(Object.keys(draft)).toEqual([])
		const dated = $state<Record<string, any>>({ year: 3, decayRate: 0.37 })
		app && unmount(app)
		document.body.innerHTML = ""
		draw(dated)
		await openRow()
		expect(dated).toEqual({ year: 3, decayRate: 0.37 })
	})
})

describe("choices", () => {
	test("Perpetual sets all three date parts to null", async () => {
		const draft = $state<Record<string, any>>({ year: 3, month: 2, day: 1 })
		draw(draft)
		await openRow()
		await pick("Perpetual")
		expect([draft.year, draft.month, draft.day]).toEqual([null, null, null])
		expect(q("#tBeginYear") == null).toBe(true)
	})

	test("Began at invents no date; typed numbers are numbers", async () => {
		const draft = $state<Record<string, any>>({})
		draw(draft)
		await openRow()
		await pick("Began at")
		expect(draft.year).toBeUndefined()
		expect(q("#tBeginYear")?.value).toBe("")
		await type("#tBeginYear", "12")
		await type("#tBeginMonth", "3")
		expect([draft.year, draft.month, draft.day]).toEqual([12, 3, undefined])
		await type("#tBeginMonth", "")
		expect(draft.month).toBeNull()
	})

	test("Fact sets 0; Living from 0 sets 0.25", async () => {
		const draft = $state<Record<string, any>>({ decayRate: 0.5 })
		draw(draft)
		await openRow()
		await pick("Fact")
		expect(draft.decayRate).toBe(0)
		await pick("Living")
		expect(draft.decayRate).toBe(0.25)
	})

	test("the slider shows the stored number and writes numbers", async () => {
		const draft = $state<Record<string, any>>({ decayRate: 0.37 })
		draw(draft)
		await openRow()
		expect(q("[data-lore-decay-rate]")?.textContent?.trim()).toBe("0.37")
		await type('input[aria-label="Decay rate"]', "0.6")
		expect(draft.decayRate).toBe(0.6)
		expect(q("[data-lore-decay-rate]")?.textContent?.trim()).toBe("0.6")
	})
})

describe("read-only", () => {
	// Without the `disabled` prop every input inherits the editor's disabled
	// fieldset, which happy-dom does not apply to `:disabled`.
	test("every input sits inside the editor's disabled fieldset", async () => {
		draw({ year: 3, decayRate: 0.5 }, { readOnly: true })
		await openRow()
		const inputs = [...document.body.querySelectorAll("input")]
		expect(inputs.length).toBeGreaterThan(5)
		expect(
			inputs.every((i) => i.closest("fieldset[disabled]") != null)
		).toBe(true)
	})
})

describe("BeginningDecayRow line words and children", () => {
	test("lineWords lead the words with the Timeline on", () => {
		draw({ year: null, decayRate: 0 }, { lineWords: "On main" })
		expect(words()).toBe("On main · Perpetual · Fact")
		expect(toggle().getAttribute("aria-label")).toBe(
			"The entry: On main · Perpetual · Fact"
		)
	})
	test("lineWords are not shown with the Timeline off", () => {
		draw({ decayRate: 0 }, { timeline: false, lineWords: "On main" })
		expect(words()).toBe("Decay: Fact")
	})
	test("children draw inside the fold, after Decay", async () => {
		draw({ decayRate: 0 }, { kids: true })
		expect(q("[data-kids]") == null).toBe(true)
		await openRow()
		const kid = q("[data-kids]")!
		const decay = q("[data-lore-decay]")!
		expect(kid.closest("#tBeginningDecay") != null).toBe(true)
		expect(
			(decay.compareDocumentPosition(kid) &
				Node.DOCUMENT_POSITION_FOLLOWING) !==
				0
		).toBe(true)
	})
})

describe("the entry's own fields in the words", () => {
	test("both owner examples", () => {
		draw(
			{ keys: [], decayRate: 0 },
			{
				lineWords: "On main",
				props: {
					held: ["keys", "constant", "enabled", "anchorEntryId"],
					parentName: null
				}
			}
		)
		expect(words()).toBe(
			"On main · Perpetual · Fact · no keywords · top level"
		)
		app && unmount(app)
		document.body.innerHTML = ""
		draw(
			{
				year: 5,
				decayRate: 0.25,
				keys: ["a", "b", "c"],
				constant: true
			},
			{
				lineWords: "On Duel lost",
				props: {
					held: ["keys", "constant", "enabled", "anchorEntryId"],
					parentName: "The Hill"
				}
			}
		)
		expect(words()).toBe(
			"On Duel lost · Began at Year 5 · Living · 0.25 · 3 keywords · part of The Hill · pinned"
		)
	})
})

describe("open prop", () => {
	test("drawn open when given, and toggling updates it", async () => {
		let open = $state(true)
		draw(
			{},
			{
				props: {
					get open() {
						return open
					},
					set open(v: boolean) {
						open = v
					}
				}
			}
		)
		expect(toggle().getAttribute("aria-expanded")).toBe("true")
		expect(q("[data-lore-decay]") != null).toBe(true)
		toggle().click()
		await tick()
		flushSync()
		expect(open).toBe(false)
		expect(toggle().getAttribute("aria-expanded")).toBe("false")
	})
})

describe("disabled", () => {
	test("disables the region's controls; the toggle stays enabled", async () => {
		draw(
			{ year: 3, decayRate: 0.5 },
			{
				kids: true,
				props: {
					disabled: true,
					open: true,
					promotable: [{ field: "keys", name: "Keywords" }]
				}
			}
		)
		const region = q("#tBeginningDecay")!
		const fs = region.querySelector("fieldset")!
		expect(fs.disabled).toBe(true)
		const inputs = [...region.querySelectorAll("input")]
		expect(inputs.length).toBeGreaterThan(5)
		expect(
			inputs.every((i) => i.closest("fieldset[disabled]") != null)
		).toBe(true)
		expect(toggle().disabled).toBe(false)
		expect(toggle().closest("fieldset[disabled]") == null).toBe(true)
	})
})

describe("Change from this version", () => {
	const promotable = [
		{ field: "keys", name: "Keywords" },
		{ field: "constant", name: "Pinned" }
	]
	const changeButton = () =>
		[...document.body.querySelectorAll("button")].find(
			(b) => b.textContent?.trim() === "Change from this version…"
		)

	test("absent with nothing promotable", async () => {
		draw({}, { props: { open: true } })
		expect(changeButton() == null).toBe(true)
	})

	test("lists exactly the given fields; pressing one calls onPromote and closes", async () => {
		const onPromote = vi.fn()
		draw({}, { props: { open: true, promotable, onPromote } })
		expect(q('[role="group"]') == null).toBe(true)
		changeButton()!.click()
		await tick()
		flushSync()
		expect(changeButton()!.getAttribute("aria-expanded")).toBe("true")
		const fields = [
			...document.body.querySelectorAll("[data-lore-change-from-version]")
		].map((e) => e.getAttribute("data-lore-change-from-version"))
		expect(fields).toEqual(["keys", "constant"])
		expect(
			q('[data-lore-change-from-version="keys"]')?.getAttribute(
				"aria-label"
			)
		).toBe("Change Keywords from this version")
		q('[data-lore-change-from-version="constant"]')!.click()
		await tick()
		flushSync()
		expect(onPromote).toHaveBeenCalledWith("constant")
		expect(q('[role="group"]') == null).toBe(true)
	})
})

describe("a Beginning the calendar refuses", () => {
	test("opens the row by itself", async () => {
		openBookTime.calendar = {
			months: [
				{ name: "Thaw", days: 30 },
				{ name: "Bloom", days: 31 }
			],
			weekdays: ["Moonday"],
			firstWeekday: 0,
			yearLabel: "Year"
		} as any
		try {
			draw({ year: 5, month: 9, day: 1, decayRate: 0 })
			await tick()
			flushSync()
			expect(toggle().getAttribute("aria-expanded")).toBe("true")
			expect(q("[data-lore-date-reads]") != null).toBe(true)
		} finally {
			openBookTime.calendar = null
		}
	})
})
