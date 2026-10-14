/**
 * Core's remote Chronicle widget (PLAN-core-widgets W3) — the built module
 * (`@serene-pub/core-catalog/components/chronicle.js`) mounted through the
 * SDK's component harness in core's box, posted the sections its
 * declaration reads, and answered as the session page answers it: one
 * `history-entries` for the clock, Now, the scenes and Earlier; its presses
 * as `set-story-clock`, `start-history-entry` (then `open-lore` on the new
 * entry), `summarize` with no lines, `extend-graph` and `open-lore`.
 */
import { afterAll, describe, expect, test } from "vitest"
import { createRequire } from "node:module"
import { mountComponent, type MountedComponent } from "@serene-pub/cli/testing"
import type { HistoryEntriesV1, ViewerV1 } from "@serene-pub/sdk"
import { CORE_WIDGETS } from "$lib/shared/widgets/types"
import { coreDefaultWidgets } from "./coreWidgets"

const require = createRequire(import.meta.url)
const BUILT = require.resolve(
	"@serene-pub/core-catalog/components/chronicle.js"
)
const CORE_CATALOG = BUILT.replace(/\/dist\/components\/chronicle\.js$/, "")
const DECL = CORE_WIDGETS.find((w) => w.id === "chronicle")!

const OWNER: ViewerV1 = { userId: 10, isAdmin: false, isGuest: false }
const GUEST: ViewerV1 = { userId: 11, isAdmin: false, isGuest: true }

const ANSWER: HistoryEntriesV1 = {
	lorebookId: 4,
	ownerOnly: false,
	clock: {
		present: { year: 412, month: 3, day: 5 },
		label: "5 March, Year 412",
		own: false,
		linePresent: { year: 412, month: 3, day: 5 },
		linePresentLabel: "5 March, Year 412",
		behind: false
	},
	current: {
		id: 9,
		date: { year: 412, month: 3, day: 5 },
		label: "5 March, Year 412",
		firstLine: "The duel at dawn",
		sceneCount: 2
	},
	scenes: [
		{
			id: 1,
			name: "The challenge",
			lineCount: 6,
			order: 0,
			summarized: true,
			graphed: false
		},
		{
			id: 2,
			name: null,
			lineCount: 1,
			order: 1,
			summarized: false,
			graphed: false
		}
	],
	earlier: [
		{
			id: 8,
			date: { year: 411 },
			label: "Year 411",
			firstLine: "The treaty",
			sceneCount: 1
		},
		{
			id: 7,
			date: { year: 410 },
			label: "Year 410",
			firstLine: "",
			sceneCount: 0
		}
	],
	earlierTotal: 2,
	ungraphedScenes: 2,
	opensScenes: true
}

const BEHIND: HistoryEntriesV1 = {
	...ANSWER,
	clock: {
		present: { year: 411 },
		label: "Year 411",
		own: true,
		linePresent: { year: 412, month: 3, day: 5 },
		linePresentLabel: "5 March, Year 412",
		behind: true
	}
}

/* ── the remote, as the page mounts it ─────────────────────────────────── */

type Asked = { kind: string; params: unknown }
const views: MountedComponent[] = []

async function mountChronicle(
	o: {
		answer?: HistoryEntriesV1 | (() => HistoryEntriesV1)
		viewer?: ViewerV1
		settings?: Record<string, unknown>
		refuse?: Record<string, string>
	} = {}
) {
	const asked: Asked[] = []
	const answer = o.answer ?? ANSWER
	/** The clock as the page last moved it: what the next read answers. */
	let moved: HistoryEntriesV1["clock"] | null = null
	const view = await mountComponent({
		entry: BUILT,
		root: CORE_CATALOG,
		owner: "core",
		timeoutMs: 60_000,
		reads: DECL.reads,
		context: {
			session: { id: 1, name: "The Duel" },
			settings: o.settings ?? {},
			viewer: o.viewer ?? OWNER
		},
		requests: (kind, params) => {
			asked.push({ kind, params })
			if (o.refuse?.[kind]) throw new Error(o.refuse[kind])
			if (kind === "history-entries") {
				const now = typeof answer === "function" ? answer() : answer
				return moved ? { ...now, clock: moved } : now
			}
			if (kind === "set-story-clock") return (moved = BEHIND.clock)
			if (kind === "start-history-entry") return { entryId: 99 }
			if (["open-lore", "summarize", "extend-graph"].includes(kind))
				return undefined
			throw new Error(`not asked: ${kind}`)
		}
	})
	views.push(view)
	await view.settle()
	return { view, asked }
}

afterAll(async () => {
	for (const v of views) await v.unmount()
})

const part = (name: string) => `[data-widget-part~="chronicle.${name}"]`
const text = (el: Element | null | undefined) =>
	el?.textContent?.replace(/\s+/g, " ").trim() ?? null
const kinds = (asked: Asked[]) => asked.map((a) => a.kind)
/** A field of Move the clock…, by its name — which the host prefixes per box. */
const field = (name: string) => `${part("field-input")}[name$="-${name}"]`

describe("core's remote Chronicle", () => {
	test(
		"draws the clock, Now, its scenes and Earlier from one history-entries, asking with the instance's Earlier count",
		{ timeout: 120_000 },
		async () => {
			const { view, asked } = await mountChronicle({
				settings: { earlierCount: 7 }
			})
			expect(view.refused).toEqual([])
			expect(asked).toEqual([
				{ kind: "history-entries", params: { earlierLimit: 7 } }
			])
			expect(text(view.query(part("clock-date")))).toBe(
				"5 March, Year 412"
			)
			expect(text(view.query(part("clock-note")))).toBe(
				"Following the line's present"
			)
			expect(view.query(part("behind"))).toBeNull()

			const now = view.query(part("now"))!
			expect(text(now.querySelector(part("entry-date")))).toBe(
				"5 March, Year 412"
			)
			expect(text(now.querySelector(part("entry-line")))).toBe(
				"The duel at dawn"
			)
			expect(text(now.querySelector(part("entry-scenes")))).toBe(
				"2 scenes"
			)

			expect(
				view
					.queryAll(part("scene"))
					.map((s) => [
						text(s.querySelector(part("scene-name"))),
						text(s.querySelector(part("scene-span"))),
						s
							.querySelector(part("scene-swatch"))
							?.getAttribute("data-swatch")
					])
			).toEqual([
				["The challenge", "6 lines", "0"],
				["Untitled scene", "1 line", "1"]
			])

			expect(
				view
					.query(`${part("earlier")} sp-accordion-item`)
					?.getAttribute("heading")
			).toBe("Earlier (2)")
			const earlier = view.queryAll(part("earlier-entry"))
			expect(
				earlier.map((e) => text(e.querySelector(part("entry-date"))))
			).toEqual(["Year 411", "Year 410"])
			expect(
				earlier[1]!
					.querySelector(part("entry-line"))
					?.hasAttribute("data-blank")
			).toBe(true)
			expect(view.errors).toEqual([])
		}
	)

	test(
		"the owner's clock: Next steps as precisely as the date; Move sets a date; an own clock behind its line shows the chip and Follow",
		{ timeout: 120_000 },
		async () => {
			const { view, asked } = await mountChronicle()
			expect(text(view.query(part("step")))).toBe("Next day")
			expect(view.query(part("follow"))).toBeNull()
			await view.click(part("step"))
			await view.settle()
			expect(asked.filter((a) => a.kind === "set-story-clock")).toEqual([
				{ kind: "set-story-clock", params: { by: 1, unit: "days" } }
			])
			// The clock that came back is drawn at once, and the rest asked again.
			expect(text(view.query(part("clock-date")))).toBe("Year 411")
			expect(
				kinds(asked).filter((k) => k === "history-entries")
			).toHaveLength(2)

			// Move starts from where the clock now stands (Year 411, a year alone).
			await view.click(part("move"))
			await view.settle()
			expect(
				view
					.query<HTMLInputElement>(field("year"))
					?.getAttribute("value")
			).toBe("411")
			await view.input(field("year"), "413")
			await view.input(field("month"), "2")
			await view.click(part("save"))
			await view.settle()
			expect(
				asked.filter((a) => a.kind === "set-story-clock").at(-1)
			).toEqual({
				kind: "set-story-clock",
				params: { to: { year: 413, month: 2 } }
			})
			expect(view.query(part("move-form"))).toBeNull()

			const behind = await mountChronicle({ answer: BEHIND })
			expect(text(behind.view.query(part("behind")))).toBe(
				"The line is at 5 March, Year 412"
			)
			expect(text(behind.view.query(part("clock-note")))).toBe(
				"This session's own clock"
			)
			expect(text(behind.view.query(part("step")))).toBe("Next year")
			await behind.view.click(part("follow"))
			await behind.view.settle()
			expect(
				behind.asked.filter((a) => a.kind === "set-story-clock")
			).toEqual([{ kind: "set-story-clock", params: { follow: true } }])
		}
	)

	test(
		"Move the clock… refuses a malformed date in the widget, asking nothing",
		{ timeout: 120_000 },
		async () => {
			const { view, asked } = await mountChronicle()
			await view.click(part("move"))
			await view.input(field("year"), "")
			await view.click(part("save"))
			await view.settle()
			expect(
				text(view.query(`${part("move-form")} ${part("alert")}`))
			).toBe("Give the clock a year.")
			expect(kinds(asked)).not.toContain("set-story-clock")
		}
	)

	test(
		"a guest seat reads: the clock and the history, no control that writes",
		{ timeout: 120_000 },
		async () => {
			const { view } = await mountChronicle({ viewer: GUEST })
			expect(text(view.query(part("clock-date")))).toBe(
				"5 March, Year 412"
			)
			for (const name of [
				"step",
				"move",
				"follow",
				"start",
				"summarize",
				"extend"
			])
				expect(view.query(part(name)), name).toBeNull()
			// Opening the lorebook is reading, and stays.
			expect(view.query(part("open"))).not.toBeNull()

			const notOwner = await mountChronicle({
				answer: {
					...ANSWER,
					ownerOnly: true,
					current: null,
					scenes: [],
					earlier: [],
					earlierTotal: 0,
					ungraphedScenes: 0
				}
			})
			expect(text(notOwner.view.query(part("note")))).toBe(
				"This session's history entries and scenes are its lorebook owner's to read."
			)
			expect(notOwner.view.query(part("now"))).toBeNull()
			expect(notOwner.view.query(part("move"))).toBeNull()
		}
	)

	test(
		"Start new history entry asks for it, then opens the new entry in the lorebook",
		{ timeout: 120_000 },
		async () => {
			const { view, asked } = await mountChronicle()
			await view.click(part("start"))
			await view.settle()
			const after = asked.slice(
				asked.findIndex((a) => a.kind === "start-history-entry")
			)
			expect(after.map((a) => a.kind)).toContain("history-entries")
			expect(after[0]).toEqual({
				kind: "start-history-entry",
				params: {}
			})
			expect(after.find((a) => a.kind === "open-lore")).toEqual({
				kind: "open-lore",
				params: { lorebookId: 4, scope: "history", entryId: 99 }
			})
		}
	)

	test(
		"Summarize scene starts the conversation's selection; Extend graph opens the review; a scene and an earlier entry open in the lorebook",
		{ timeout: 120_000 },
		async () => {
			const { view, asked } = await mountChronicle()
			await view.click(part("summarize"))
			await view.click(part("extend"))
			expect(text(view.query(part("extend")))).toBe("Extend graph (2)")
			await view.click(view.queryAll(part("scene-open"))[1]!)
			await view.click(view.queryAll(part("earlier-entry"))[0]!)
			await view.click(part("open"))
			await view.settle()
			expect(asked.filter((a) => a.kind !== "history-entries")).toEqual([
				{ kind: "summarize", params: { kind: "scene" } },
				{ kind: "extend-graph", params: {} },
				{
					kind: "open-lore",
					params: { lorebookId: 4, scope: "scenes", sceneId: 2 }
				},
				{
					kind: "open-lore",
					params: { lorebookId: 4, scope: "history", entryId: 8 }
				},
				{
					kind: "open-lore",
					params: { lorebookId: 4, scope: "history", entryId: 9 }
				}
			])

			const quiet = await mountChronicle({
				answer: { ...ANSWER, ungraphedScenes: 0, opensScenes: false }
			})
			expect(quiet.view.query(part("extend"))).toBeNull()
			expect(quiet.view.query(part("summarize"))).toBeNull()
		}
	)

	test(
		"what the page declines is said in the widget (R77)",
		{ timeout: 120_000 },
		async () => {
			const { view } = await mountChronicle({
				refuse: {
					"set-story-clock":
						"That clock does not fit this lorebook. There is no month 13: this calendar has 12."
				}
			})
			await view.click(part("step"))
			await view.settle()
			expect(text(view.query(`${part("root")} > ${part("alert")}`))).toBe(
				"Not done: That clock does not fit this lorebook. There is no month 13: this calendar has 12."
			)
		}
	)

	test(
		"story:moved asks again; with no lorebook it says so in one line",
		{ timeout: 120_000 },
		async () => {
			let year = 412
			const { view, asked } = await mountChronicle({
				answer: () => ({
					...ANSWER,
					clock: { ...ANSWER.clock, label: `Year ${year}` }
				})
			})
			year = 413
			await view.event({ kind: "story:moved" })
			await new Promise((r) => setTimeout(r, 300))
			await view.settle()
			expect(
				kinds(asked).filter((k) => k === "history-entries")
			).toHaveLength(2)
			expect(text(view.query(part("clock-date")))).toBe("Year 413")

			const none = await mountChronicle({
				answer: { ...ANSWER, lorebookId: null }
			})
			expect(
				none.view.query(part("root"))?.getAttribute("data-state")
			).toBe("no-book")
			expect(text(none.view.query(part("empty")))).toBe(
				"This session reads no lorebook."
			)
			expect(none.view.query(part("clock"))).toBeNull()
		}
	)
})

describe("the page mounts Chronicle remote", () => {
	test("core's own module, served at /core-ui/chronicle, granted 'lore' for its requests", () => {
		const widget = coreDefaultWidgets().find((p) => p.id === "chronicle")!
		expect(widget.surface).toEqual({
			kind: "remote",
			owner: "core",
			component: "chronicle"
		})
		expect(widget.src).toBe("/core-ui/chronicle")
		expect(widget.grants).toEqual(["lore"])
	})
})
