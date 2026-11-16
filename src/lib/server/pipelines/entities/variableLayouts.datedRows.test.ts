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

describe("the History layout", () => {
	const rows = [
		{
			date: date(412, 3, 3),
			dateDelta: { sign: -1, year: 0, month: 0, day: 2, time: null },
			content: "Two days back."
		},
		{ date: date(412, 1), dateDelta: null, content: "Earlier." }
	]

	it("keys a row by its date and its delta, and the bare date without one", async () => {
		const out = await through(HISTORY, "history", row("history").source, rows)
		expect(out).toBe(
			'{"412-03-03 (-0y 0m 2d)":"Two days back.","412-01":"Earlier."}'
		)
		expect(row("history").codeDefault(rows)).toBe(out)
	})

	it("keeps two rows on one date as two keys", async () => {
		const twice = [rows[1]!, { ...rows[1]!, content: "Again." }]
		expect(
			await through(HISTORY, "history", row("history").source, twice)
		).toBe('{"412-01":"Earlier.","412-01":"Again."}')
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
	it("writes a flat string out as written and reports it, never through the layout", async () => {
		const lines: string[] = []
		const out = await through(
			HISTORY,
			"history",
			row("history").source,
			"a flat string",
			CORE_TEMPLATE_ENGINE,
			(l) => lines.push(l)
		)
		expect(out).toBe("a flat string")
		expect(lines).toHaveLength(1)
		expect(lines[0]).toContain("layout: 'history' (core:var/history@1)")
		expect(lines[0]).toContain("a string where its variable declares a list")
	})

	it("writes an object handed where a list is declared as minified JSON", async () => {
		const lines: string[] = []
		const out = await through(
			HISTORY,
			"history",
			row("history").source,
			{ "412-03": "keyed" },
			CORE_TEMPLATE_ENGINE,
			(l) => lines.push(l)
		)
		expect(out).toBe('{"412-03":"keyed"}')
		expect(lines[0]).toContain("an object where its variable declares a list")
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
