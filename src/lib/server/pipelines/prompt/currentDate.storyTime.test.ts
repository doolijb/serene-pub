/**
 * The prompt's `currentDate` through the lorebook's story time
 * (DESIGN-story-time P5 + the lorebook clock).
 *
 * `session_cast` carries `storyTime: { now, calendar }` and the template
 * context hands it to `assemble`:
 *
 *  - a stored clock wins over the newest allocated history entry;
 *  - a declared calendar spells the date (`label`);
 *  - with neither — a free-form book with no clock, or no book at all — the
 *    output is byte-identical to what it always was.
 */
import { describe, expect, it } from "vitest"
import { allocate, render } from "$lib/server/pipelines/prompt/assemble"
import { CORE_TEMPLATE_ENGINE } from "$lib/server/pipelines/prompt/renderers"
import type { Decision } from "$lib/server/pipelines/ranking/select"

const history = (year: number, month?: number, day?: number): Decision => ({
	candidate: {
		id: `h${year}`,
		source: "history",
		tokens: 5,
		signals: {},
		payload: { id: year, content: "Things happened.", year, month, day }
	},
	score: 0.5,
	reason: "filled_scored",
	included: true,
	why: "scored"
})

const THAW = {
	months: [
		{ name: "Thaw", days: 30 },
		{ name: "Bloom", days: 31 }
	],
	yearLabel: "Year"
}

const base = {
	allocation: allocate([history(3, 2, 7)], { budgetTotal: 100 }),
	engine: CORE_TEMPLATE_ENGINE,
	messages: [{ id: 1, role: "user", content: "hello" }],
	template: "[{{{currentDate}}}]"
}

describe("currentDate — the story's present", () => {
	it("with no story time, is the newest allocated history entry as always", async () => {
		const r = await render(base)
		expect(r.rendered).toBe("[The current date in the story is 3-02-07.]")
	})

	it("a free-form book whose present is only its newest entry changes nothing", async () => {
		const r = await render({
			...base,
			templateContext: {
				storyTime: { now: { year: 9, from: "history" }, calendar: null }
			}
		})
		expect(r.rendered).toBe("[The current date in the story is 3-02-07.]")
	})

	it("a stored clock wins, with its time of day", async () => {
		const r = await render({
			...base,
			templateContext: {
				storyTime: {
					now: { year: 4, month: 1, day: 9, hour: 22, minute: 5, from: "clock" },
					calendar: null
				}
			}
		})
		expect(r.rendered).toBe(
			"[The current date in the story is 4-01-09 22:05.]"
		)
	})

	it("a session's own clock wins over the newest entry (story-time P3)", async () => {
		const r = await render({
			...base,
			templateContext: {
				storyTime: {
					now: { year: -300, month: 2, day: 1, hour: 6, minute: 0, from: "session" },
					calendar: null
				}
			}
		})
		expect(r.rendered).toBe(
			"[The current date in the story is -300-02-01 06:00.]"
		)
	})

	it("a declared calendar spells the date", async () => {
		const r = await render({
			...base,
			templateContext: { storyTime: { now: null, calendar: THAW } }
		})
		expect(r.rendered).toBe(
			"[The current date in the story is 7 Bloom, Year 3.]"
		)
		const clock = await render({
			...base,
			templateContext: {
				storyTime: { now: { year: 5, month: 1, from: "clock" }, calendar: THAW }
			}
		})
		expect(clock.rendered).toBe(
			"[The current date in the story is Thaw, Year 5.]"
		)
	})
})
