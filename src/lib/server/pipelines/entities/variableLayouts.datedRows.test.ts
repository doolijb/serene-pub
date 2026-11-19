/**
 * The shipped layouts for dated rows: History, Earlier scenes, Current date and
 * Story calendar print through the two date helpers, and `renderVariable`
 * refuses to hand a layout a value of the wrong kind.
 */
import { describe, expect, it } from "vitest"
import { defineVariable, formatStoryTime } from "@serene-pub/sdk"
import type { StoryCalendar } from "@serene-pub/sdk"
import {
	CORE_LIQUID_ENGINE,
	CORE_TEMPLATE_ENGINE
} from "$lib/server/pipelines/prompt/renderers"
import {
	renderVariable,
	shippedRowsByKey
} from "./variableLayouts"
import { LIQUID_LAYOUTS } from "$lib/server/pipelines/prompt/liquidParity.fixtures"
import { storyDateValueOf } from "$lib/shared/lorebooks/storyDate"
import { storyDateDeltaOf } from "$lib/shared/lorebooks/storySpan"

const HISTORY = "core:var/history@1"
const CURRENT_DATE = "core:var/current-date@1"

const row = (key: string, variant: "content" | "wrapped" = "content") =>
	shippedRowsByKey.get(key)!.find((r) => r.variant === variant)!

const through = (
	variableId: string,
	key: string,
	source: string,
	value: unknown,
	engine = CORE_TEMPLATE_ENGINE,
	report?: (line: string) => void
) =>
	renderVariable(
		{ [key]: { variableId, engine, source } },
		key,
		value,
		undefined,
		report
	)

const date = (year: number, month?: number, day?: number, time?: [number, number]) => ({
	year: { number: year },
	month: month == null ? null : { number: month },
	day: day == null ? null : { number: day },
	time: time ? { hour: time[0], minute: time[1] } : null
})

describe("the Current date layout", () => {
	/** The numeric rule the layout replaced, from the parts. */
	const oldRule = (d: any): string => {
		let out = String(d.year.number)
		if (d.month) out += `-${String(d.month.number).padStart(2, "0")}`
		if (d.day) out += `-${String(d.day.number).padStart(2, "0")}`
		if (d.time)
			out += ` ${String(d.time.hour).padStart(2, "0")}:${String(d.time.minute).padStart(2, "0")}`
		return out
	}
	const cases: Array<[string, any]> = [
		["year only", date(412)],
		["year and month", date(412, 3)],
		["a full date", date(412, 3, 5)],
		["a month zero", date(412, 0)],
		["with a time", date(412, 3, 5, [9, 5])]
	]
	for (const [label, d] of cases)
		it(`prints ${label} as it always did, in both engines`, async () => {
			const source = row("currentDate").source
			expect(await through(CURRENT_DATE, "currentDate", source, d)).toBe(oldRule(d))
			expect(row("currentDate").codeDefault(d)).toBe(oldRule(d))
			expect(
				await through(
					CURRENT_DATE,
					"currentDate",
					LIQUID_LAYOUTS["currentDate/content"]!,
					d,
					CORE_LIQUID_ENGINE
				)
			).toBe(oldRule(d))
		})

	it("prints a named date as the calendar spells it", async () => {
		const calendar: StoryCalendar = {
			months: [
				{ name: "Thaw", days: 30 },
				{ name: "Bloom", days: 31 }
			],
			yearLabel: "Year"
		}
		const time = { year: 412, month: 2, day: 5, hour: 22, minute: 30 }
		const value = storyDateValueOf(time, calendar)
		const expected = formatStoryTime(time, calendar)
		expect(value.year.name).toBeTruthy()
		expect(
			await through(CURRENT_DATE, "currentDate", row("currentDate").source, value)
		).toBe(expected)
		expect(row("currentDate").codeDefault(value)).toBe(expected)
	})
})

describe("the Current date layout for a date the calendar cannot place", () => {
	const calendar: StoryCalendar = {
		months: [
			{ name: "Thaw", days: 30 },
			{ name: "Bloom", days: 31 }
		],
		yearLabel: "Year"
	}
	const cases: Array<[string, any, string]> = [
		["without a clock", { year: 412, month: 13, day: 5 }, "Year 412, Mo. 13, Day 5"],
		[
			"with a clock",
			{ year: 412, month: 13, day: 5, hour: 22, minute: 30 },
			"Year 412, Mo. 13, Day 5, 22:30"
		]
	]
	for (const [label, time, expected] of cases)
		it(`prints formatStoryTime's fallback ${label}, in both engines and the floor`, async () => {
			expect(formatStoryTime(time, calendar)).toBe(expected)
			const value = storyDateValueOf(time, calendar)
			expect(
				await through(CURRENT_DATE, "currentDate", row("currentDate").source, value)
			).toBe(expected)
			expect(row("currentDate").codeDefault(value)).toBe(expected)
			expect(
				await through(
					CURRENT_DATE,
					"currentDate",
					LIQUID_LAYOUTS["currentDate/content"]!,
					value,
					CORE_LIQUID_ENGINE
				)
			).toBe(expected)
		})

	it("a free-form date and a landing date print as they did", async () => {
		const free = storyDateValueOf({ year: 412, month: 3, day: 5 }, null)
		expect(
			await through(CURRENT_DATE, "currentDate", row("currentDate").source, free)
		).toBe("412-03-05")
		const landing = { year: 412, month: 2, day: 5 }
		expect(
			row("currentDate").codeDefault(storyDateValueOf(landing, calendar))
		).toBe(formatStoryTime(landing, calendar))
	})
})

describe("the History layout", () => {
	const rows = [
		{
			date: date(412, 3, 3),
			dateDelta: { sign: -1, year: 0, month: 0, day: 2, time: null },
			content: "Two days back."
		},
		{ date: date(412, 1), dateDelta: null, content: "Earlier." }
	]

	it("prints a list of row objects, the delta only on a row that has one", async () => {
		const out = await through(HISTORY, "history", row("history").source, rows)
		expect(out).toBe(
			'[{"date":"412-03-03","dateDelta":"-0y 0m 2d","content":"Two days back."},{"date":"412-01","content":"Earlier."}]'
		)
		expect(row("history").codeDefault(rows)).toBe(out)
		expect(
			await through(
				HISTORY,
				"history",
				LIQUID_LAYOUTS["history/content"]!,
				rows,
				CORE_LIQUID_ENGINE
			)
		).toBe(out)
	})

	it("keeps two rows on one date as two objects, in the value's order", async () => {
		const twice = [
			{ ...rows[1]!, content: "Again." },
			rows[1]!
		]
		const out = await through(HISTORY, "history", row("history").source, twice)
		expect(JSON.parse(out)).toEqual([
			{ date: "412-01", content: "Again." },
			{ date: "412-01", content: "Earlier." }
		])
		expect(row("history").codeDefault(twice)).toBe(out)
	})

	it("a row with no date prints an empty date, in every engine and the floor", async () => {
		const undated = [{ date: null, dateDelta: null, content: "Whenever." }]
		const out = await through(HISTORY, "history", row("history").source, undated)
		expect(out).toBe('[{"date":"","content":"Whenever."}]')
		expect(row("history").codeDefault(undated)).toBe(out)
		expect(
			await through(
				HISTORY,
				"history",
				LIQUID_LAYOUTS["history/content"]!,
				undated,
				CORE_LIQUID_ENGINE
			)
		).toBe(out)
	})

	it("a calendar name holding a quote and a backslash prints valid JSON, in both engines and the floor", async () => {
		const calendar: StoryCalendar = {
			months: [
				{ name: 'Th"aw\\', days: 30 },
				{ name: "Bloom", days: 31 }
			],
			yearLabel: 'Yr"\\'
		}
		const now = { year: 412, month: 2, day: 5 }
		const at = { year: 412, month: 1, day: 3 }
		const value = [
			{
				date: storyDateValueOf(at, calendar),
				dateDelta: storyDateDeltaOf(at, now, calendar),
				content: 'He said "no".'
			}
		]
		const hbs = await through(HISTORY, "history", row("history").source, value)
		const liquid = await through(
			HISTORY,
			"history",
			LIQUID_LAYOUTS["history/content"]!,
			value,
			CORE_LIQUID_ENGINE
		)
		const floor = row("history").codeDefault(value)
		expect(liquid).toBe(hbs)
		expect(floor).toBe(hbs)
		const parsed = JSON.parse(hbs)
		expect(parsed).toHaveLength(1)
		expect(parsed[0].date).toBe(formatStoryTime(at, calendar))
		expect(parsed[0].date).toContain('Th"aw\\')
		expect(parsed[0].content).toBe('He said "no".')
	})

	it("prints the same date text through the helper and the filter", async () => {
		const hbs = await through(
			"core:var/current-date@1",
			"currentDate",
			"{{{formatDate currentDate}}}|{{{formatDateDelta delta}}}",
			{ ...date(412, 3, 3), delta: undefined }
		)
		expect(hbs).toBe("412-03-03|")
		const delta = { sign: -1, year: 0, month: 0, day: 2, time: null }
		const a = await renderVariableWith(
			CORE_TEMPLATE_ENGINE,
			"{{{formatDate d}}} ({{{formatDateDelta e}}})",
			date(412, 3, 3),
			delta
		)
		const b = await renderVariableWith(
			CORE_LIQUID_ENGINE,
			"{{ d | formatDate }} ({{ e | formatDateDelta }})",
			date(412, 3, 3),
			delta
		)
		expect(a).toBe("412-03-03 (-0y 0m 2d)")
		expect(b).toBe(a)
	})

	it("an old-shape layout renders without throwing (it prints wrong, by design)", async () => {
		const old =
			"{{#each history}}{{{jsonValue @key indent=0}}}:{{{jsonValue this indent=0}}}{{/each}}"
		const out = await through(HISTORY, "history", old, rows)
		expect(typeof out).toBe("string")
		expect(out).not.toBe("")
	})
})

async function renderVariableWith(
	engine: string,
	source: string,
	d: unknown,
	e: unknown
): Promise<string> {
	const { renderTemplate } = await import(
		"$lib/server/pipelines/prompt/renderers"
	)
	const { builtinCompletionTemplate } = await import(
		"$lib/shared/constants/completionTemplates"
	)
	return renderTemplate(engine, {
		template: source,
		variables: { d, e },
		promptFormat: "vicuna",
		completionTemplate: builtinCompletionTemplate("vicuna")
	})
}

describe("the Earlier scenes layout", () => {
	it("prints a scene's delta between its name and summary, when it has one", async () => {
		const scenes = [
			{
				name: "The ferry",
				summary: "They crossed.",
				date: date(412, 3, 3),
				dateDelta: { sign: -1, year: 0, month: 0, day: 2, time: null }
			},
			{ name: "The oath", summary: "Sworn.", date: date(412, 1), dateDelta: null }
		]
		const out = await through(
			"core:var/earlier-scenes@1",
			"earlierScenes",
			row("earlierScenes").source,
			scenes
		)
		expect(JSON.parse(out)).toEqual([
			{ name: "The ferry", dateDelta: "-0y 0m 2d", summary: "They crossed." },
			{ name: "The oath", summary: "Sworn." }
		])
		expect(row("earlierScenes").codeDefault(scenes)).toBe(out)
	})
})

describe("the Story calendar layout", () => {
	const full = {
		months: [
			{ name: "Thaw", days: 30 },
			{ name: "Bloom", days: 31 }
		],
		weekdays: ["Moonday", "Tirsday"],
		leap: { every: 4, month: 2 },
		eras: [{ name: "BR", backwards: true }, { name: "AR", start: 1 }]
	}
	it("prints one line per part present", async () => {
		const source = row("storyCalendar").source
		const out = await through("core:var/story-calendar@1", "storyCalendar", source, full)
		expect(out).toBe(
			"Months: Thaw (30 days), Bloom (31 days)\n" +
				"Weekdays: Moonday, Tirsday\n" +
				"Leap day: every 4 years, in month 2\n" +
				"Eras: BR, counting down; AR from year 1"
		)
		expect(row("storyCalendar").codeDefault(full)).toBe(out)
	})
	it("prints months alone for a calendar with only months", async () => {
		const only = { months: [{ name: "Thaw", days: 30 }] }
		const out = await through(
			"core:var/story-calendar@1",
			"storyCalendar",
			row("storyCalendar").source,
			only
		)
		expect(out).toBe("Months: Thaw (30 days)")
		expect(row("storyCalendar").codeDefault(only)).toBe(out)
	})
})

describe("the render-time scope guard", () => {
	it("prints nothing for a flat string handed to History, and the receipt says so", async () => {
		const lines: string[] = []
		const out = await through(
			HISTORY,
			"history",
			row("history").source,
			"a flat string",
			CORE_TEMPLATE_ENGINE,
			(l) => lines.push(l)
		)
		expect(out).toBe("")
		expect(lines).toHaveLength(1)
		expect(lines[0]).toContain("layout: 'history' (core:var/history@1)")
		expect(lines[0]).toContain("a string where its variable declares a list")
		expect(lines[0]).toContain(
			"nothing was printed, because its plain default could not render it either"
		)
		expect(lines[0]).toContain("should hand down the declared shape")
	})

	it("prints the variable's floor, heading included, for a value the floor can render, and says so", async () => {
		const lines: string[] = []
		const out = await renderVariable(
			{
				scenario: {
					variableId: "core:var/scenario@1",
					engine: CORE_TEMPLATE_ENGINE,
					source: "never used"
				}
			},
			"scenario",
			42,
			undefined,
			(l) => lines.push(l)
		)
		expect(out).toBe('Scenario:\n"""\n42\n"""')
		expect(lines).toHaveLength(1)
		expect(lines[0]).toContain("a number where its variable declares a string")
		expect(lines[0]).toContain(
			"it was rendered with its plain default instead of its layout"
		)
	})

	it("an object handed where a list is declared prints nothing from History's floor", async () => {
		const lines: string[] = []
		const out = await through(
			HISTORY,
			"history",
			row("history").source,
			{ "412-03": "keyed" },
			CORE_TEMPLATE_ENGINE,
			(l) => lines.push(l)
		)
		expect(out).toBe("")
		expect(lines[0]).toContain("an object where its variable declares a list")
		expect(lines[0]).toContain("nothing was printed")
	})

	it("a plugin variable's floor is minified JSON, and the receipt says so", async () => {
		defineVariable({
			id: "acme:var/stringy@1",
			scope: { stringy: { type: "string" } },
			sample: "x"
		} as never)
		const lines: string[] = []
		const out = await through(
			"acme:var/stringy@1",
			"stringy",
			"<{{{stringy}}}>",
			{ a: 1 },
			CORE_TEMPLATE_ENGINE,
			(l) => lines.push(l)
		)
		expect(out).toBe('{"a":1}')
		expect(lines[0]).toContain("an object where its variable declares a string")
		expect(lines[0]).toContain("rendered with its plain default")
	})

	it("reports nothing for a correctly shaped value", async () => {
		const lines: string[] = []
		await through(
			HISTORY,
			"history",
			row("history").source,
			[{ date: date(1), content: "x" }],
			CORE_TEMPLATE_ENGINE,
			(l) => lines.push(l)
		)
		expect(lines).toEqual([])
	})

	it("never guards an 'any'-scoped variable", async () => {
		defineVariable({
			id: "acme:var/anything@1",
			scope: { anything: "any" },
			sample: "x"
		} as never)
		const lines: string[] = []
		const out = await through(
			"acme:var/anything@1",
			"anything",
			"<{{{anything}}}>",
			"a string",
			CORE_TEMPLATE_ENGINE,
			(l) => lines.push(l)
		)
		expect(out).toBe("<a string>")
		expect(lines).toEqual([])
	})
})

describe("the layout check against a variable's typed scope", () => {
	it("every shipped row checks with no error and no warning, in both engines", async () => {
		const { getVariable } = await import("@serene-pub/sdk")
		const { validateTemplateContext } = await import(
			"$lib/shared/utils/templateValidation"
		)
		const { SHIPPED_VARIABLE_TEMPLATES } = await import("./variableLayouts")
		for (const t of SHIPPED_VARIABLE_TEMPLATES) {
			const decl = getVariable(t.variableId)
			if (!decl) continue
			const hbs = validateTemplateContext(CORE_TEMPLATE_ENGINE, t.source, decl.scope)
			expect(hbs.error, `${t.key}/${t.variant}`).toBeFalsy()
			expect(hbs.warnings, `${t.key}/${t.variant}`).toEqual([])
			const liquid = LIQUID_LAYOUTS[`${t.key}/${t.variant}`]
			if (liquid) {
				const r = validateTemplateContext(CORE_LIQUID_ENGINE, liquid, decl.scope)
				expect(r.error, `${t.key}/${t.variant} (liquid)`).toBeFalsy()
				expect(r.warnings, `${t.key}/${t.variant} (liquid)`).toEqual([])
			}
		}
	})

	it("a layout written for the old keyed History still saves", async () => {
		const { getVariable } = await import("@serene-pub/sdk")
		const { validateTemplateContext } = await import(
			"$lib/shared/utils/templateValidation"
		)
		const r = validateTemplateContext(
			CORE_TEMPLATE_ENGINE,
			"{{#each history}}{{{jsonValue @key indent=0}}}:{{{jsonValue this indent=0}}}{{/each}}",
			getVariable(HISTORY)!.scope
		)
		expect(r.error).toBeFalsy()
	})
})
