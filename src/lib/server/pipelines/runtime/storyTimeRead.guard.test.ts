/**
 * Owner D56, 2026-11-16: "We need the same behavior to match across querying
 * anything that could carry timelines/time." On a lorebook that keeps no
 * timeline every story-time value a run can read is `null`, whatever is
 * stored. This scan fails on a read that hands on a stored story-time value
 * without asking `timelessNull(timelineOff, value)` (`state/storyTime.ts`).
 *
 * Purpose: a new read of a story clock cannot slip past the rule unseen.
 * Rule, per field and not per function: a hit passes when it sits inside a
 * `timelessNull(` call (or is the key of a property whose value starts with
 * one); otherwise it must be in the allow-list with its count and reason. One
 * `timelessNull(` in a function clears only the fields it wraps, never the
 * function's other time fields. The list is checked both ways: a hit outside it
 * fails and names itself; an entry whose count has changed (or whose site has
 * gone) fails and names itself.
 *
 * Files: every `pipelines/runtime/host.read.*.ts`, `bindings.*.ts` and
 * `tools/*.ts` (globbed, so a new file is scanned), plus those named below
 * (`host.ts`, `transcript.ts`, `host.helpers.ts`, `earlierScenes.ts`,
 * `statTrail.ts`, `presencesOnReading.ts`).
 *
 * Patterns (after comments are stripped): the story-clock column and field
 * names a read hands on (`storyClock` / `StoryClock`, `story_clock_`,
 * `sessionStart`, `sceneClockOf(`), `forkedAt` (the fork cut), and `year:`
 * wherever a row is shaped (`year: <row>.year`: a lore row, a clock, a day);
 * two files get a pattern of their own: `state/statTrail.ts` (a point's
 * `anchor` with a `date`) and `state/presencesOnReading.ts` (`fromYear`).
 * `StoryClockRefusal` and `advanceSessionStoryClock(To)` are the clock
 * outlet's write path, never a read, and are not hits.
 *
 * Limits: only top-level `function` / `const` declarations name a hit; a
 * value read through a variable or another helper is not seen.
 */
import { readdirSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { describe, expect, test } from "vitest"

const SERVER = resolve(__dirname, "../..")

const globbed = [
	...readdirSync(__dirname)
		.filter((f) => /^(host\.read|bindings)\..+\.ts$/.test(f) && !/\.test\.|\.d\.ts$/.test(f))
		.map((f) => `pipelines/runtime/${f}`),
	...readdirSync(join(__dirname, "tools"))
		.filter((f) => /\.ts$/.test(f) && !/\.test\.|\.d\.ts$/.test(f))
		.map((f) => `pipelines/runtime/tools/${f}`)
].sort()

const FILES = [
	...globbed,
	"pipelines/runtime/host.ts",
	"pipelines/runtime/transcript.ts",
	"pipelines/runtime/host.helpers.ts",
	"scenes/earlierScenes.ts",
	"state/statTrail.ts",
	"state/presencesOnReading.ts"
]

const PATTERN = /[sS]toryClock|story_clock_|\bsessionStart\b|\bsceneClockOf\(|\bforkedAt\b/
const YEAR = /\byear:\s*[A-Za-z_$][\w$]*\??\.year\b/
const OWN_PATTERN: Record<string, RegExp> = {
	"state/statTrail.ts": /anchor:\s*\{[^}]*\bdate\b/,
	"state/presencesOnReading.ts": /\bfromYear\b/
}
/** The clock outlet's write path: names that carry `StoryClock` but read nothing. */
const WRITE_NAMES = /\b(?:StoryClockRefusal|advanceSessionStoryClock(?:To)?)\b/g
const patternsOf = (file: string): RegExp[] => [PATTERN, YEAR, ...(OWN_PATTERN[file] ? [OWN_PATTERN[file]] : [])]

/** `<file>#<function>` -> expected uncovered hits and the reason each need not sit in `timelessNull(`. */
const ALLOWED: Record<string, { count: number; why: string }> = {
	"pipelines/runtime/host.helpers.ts#toLoreEntry": {
		count: 1,
		why: "mapped at its one caller, `readLorebookEntries` (host.read.lorebookEntries.ts)"
	},
	"pipelines/runtime/bindings.outlets.ts#outletBindings": {
		count: 2,
		why: "`advance-story-clock@1` is an outlet's input, refused with the timeline off; it reads no stored clock"
	},
	"pipelines/runtime/bindings.prompt.ts#promptBindings": {
		count: 7,
		why: "hands on `earlierScenesOf`'s already-mapped `openedStoryClock` (null with the timeline off), and normalizes its shape"
	},
	"pipelines/runtime/bindings.state.ts#stateBindings": {
		count: 1,
		why: "`sinceDate` is a node's input, a filter the read applies; it hands on no stored date"
	},
	"pipelines/runtime/host.read.sessionCast.ts#readSessionCast": {
		count: 2,
		why: "the raw first-stamp scalar, delivered as `sessionStart` through `timelessNull(` a few lines below"
	},
	"pipelines/runtime/host.read.summarize.ts#readSummarizeSpan": {
		count: 5,
		why: "message stamps are not read at all when the timeline is off (`sessionTimelineOf` gate)"
	},
	"pipelines/runtime/host.ts#createHost": {
		count: 3,
		why: "writes, not reads: the entry amendment's date (a write's own day, ~309), the clock outlet's `changed: ['storyClock']` event, and a notes reading's `forkedAt: null` (the fork cut, by design)"
	},
	"pipelines/runtime/transcript.ts#TranscriptRow": {
		count: 1,
		why: "the row type's `clock` field: filled by `host.read.summarize.ts`, which reads no stamp with the timeline off"
	},
	"pipelines/runtime/transcript.ts#dayOf": {
		count: 2,
		why: "formats a clock the caller handed in (a row's `clock`, null with the timeline off)"
	},
	"pipelines/runtime/transcript.ts#renderTranscript": {
		count: 1,
		why: "reads a row's `clock` the caller handed in (null with the timeline off)"
	},
	"scenes/earlierScenes.ts#EarlierScene": {
		count: 1,
		why: "the type's field (the read that fills it, `earlierScenesOf`, calls `timelessNull(`)"
	},
	"scenes/earlierScenes.ts#earlierScenesOf": {
		count: 5,
		why: "the raw `opened_story_clock_*` columns selected; delivered as `openedStoryClock` through `timelessNull(` below"
	},
	"state/statTrail.ts#StatTrail": {
		count: 1,
		why: "`forkedAt` on the trail's type: the fork cut, by design"
	},
	"state/statTrail.ts#statTrailFor": {
		count: 2,
		why: "`forkedAt` is the fork cut, by design; and a point's `anchor.date` is mapped through `timelessNull(` after the order and the filter (`timelineOff`, below)"
	},
	"state/presencesOnReading.ts#presencesOnReading": {
		count: 1,
		why: "the stored rows' `fromYear` copied into the line filter's shape; the rows delivered go through `timelessNull(` below"
	},
	"state/presencesOnReading.ts#placementsAt": {
		count: 1,
		why: "computes the weekday for a schedule's `where` text; hands on no date; with the timeline off `sessionStoryNowOf` is null, so it places nobody (`presencesAtHour.int.test.ts`)"
	}
}

/** Source with line and block comments blanked, line breaks kept. Strings are walked so `//` inside one stays. */
function stripComments(src: string): string {
	let out = ""
	let i = 0
	while (i < src.length) {
		const c = src[i]
		const n = src[i + 1]
		if (c === "/" && n === "/") {
			while (i < src.length && src[i] !== "\n") i++
		} else if (c === "/" && n === "*") {
			i += 2
			while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) {
				if (src[i] === "\n") out += "\n"
				i++
			}
			i += 2
		} else if (c === '"' || c === "'" || c === "`") {
			out += c
			i++
			while (i < src.length && src[i] !== c) {
				if (src[i] === "\\") {
					out += src[i++]
				}
				out += src[i++] ?? ""
			}
			out += src[i++] ?? ""
		} else {
			out += c
			i++
		}
	}
	return out
}

/** For each character, whether it sits inside an open `timelessNull(` call. Strings are skipped whole. */
function insideTimelessNull(code: string): boolean[] {
	const inside: boolean[] = new Array(code.length).fill(false)
	const stack: boolean[] = []
	let open = 0
	for (let i = 0; i < code.length; i++) {
		const c = code[i]!
		if (c === '"' || c === "'" || c === "`") {
			const q = c
			inside[i] = open > 0
			i++
			while (i < code.length && code[i] !== q) {
				if (code[i] === "\\") inside[i++] = open > 0
				inside[i++] = open > 0
			}
			inside[i] = open > 0
			continue
		}
		if (c === "(" || c === "[" || c === "{") {
			const mine = c === "(" && /\btimelessNull\s*$/.test(code.slice(Math.max(0, i - 24), i))
			stack.push(mine)
			if (mine) open++
		}
		inside[i] = open > 0
		if (c === ")" || c === "]" || c === "}") if (stack.pop()) open--
	}
	return inside
}

const DECLARATION = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\s*\*?\s*|const\s+|let\s+|interface\s+|type\s+)([A-Za-z_$][\w$]*)/

/**
 * Each hit of a source, per field: `<file>#<enclosing top-level name>` and whether
 * the field is mapped (inside a `timelessNull(` call, or the key of a property
 * whose value starts with one).
 */
function scanSource(file: string, source: string): { site: string; mapped: boolean; line: number }[] {
	const code = stripComments(source).replace(WRITE_NAMES, (m) => " ".repeat(m.length))
	const inside = insideTimelessNull(code)
	const out: { site: string; mapped: boolean; line: number }[] = []
	let enclosing = "(module)"
	let offset = 0
	let lineNo = 0
	for (const l of code.split("\n")) {
		lineNo++
		const d = DECLARATION.exec(l)
		if (d) enclosing = d[1]!
		if (!/^\s*import\b/.test(l))
			for (const re of patternsOf(file)) {
				// One hit per pattern per line; it is mapped only when every match on the line is.
				const g = new RegExp(re.source, "g")
				let any = false
				let all = true
				for (let m = g.exec(l); m; m = g.exec(l)) {
					any = true
					const rest = l.slice(m.index + m[0].length)
					if (!(inside[offset + m.index]! || m[0].includes("timelessNull(") || /^[\w$]*\s*:\s*timelessNull\(/.test(rest)))
						all = false
				}
				if (any) out.push({ line: lineNo, site: `${file}#${enclosing}`, mapped: all })
			}
		offset += l.length + 1
	}
	return out
}

/** `<file>#<enclosing>` of each top-level function that calls `timelessNull(` at all. */
function callersOf(file: string): string[] {
	const out = new Set<string>()
	let enclosing = "(module)"
	for (const l of stripComments(readFileSync(join(SERVER, file), "utf8")).split("\n")) {
		const d = DECLARATION.exec(l)
		if (d) enclosing = d[1]!
		if (/\btimelessNull\(/.test(l)) out.add(`${file}#${enclosing}`)
	}
	return [...out]
}

const scan = (file: string) => scanSource(file, readFileSync(join(SERVER, file), "utf8"))

describe("a story-time value a run reads is mapped through timelessNull", () => {
	const counts = new Map<string, number>()
	const lines = new Map<string, number[]>()
	const mapped = new Set<string>()
	for (const f of FILES) {
		for (const k of callersOf(f)) mapped.add(k)
		for (const h of scan(f)) {
			if (!h.mapped) {
				counts.set(h.site, (counts.get(h.site) ?? 0) + 1)
				lines.set(h.site, [...(lines.get(h.site) ?? []), h.line])
			}
		}
	}

	test("every guarded file is found", () => {
		for (const f of FILES) expect(() => readFileSync(join(SERVER, f)), f).not.toThrow()
		expect(globbed.length).toBeGreaterThan(5)
		expect(globbed.some((f) => f.startsWith("pipelines/runtime/tools/"))).toBe(true)
	})

	test("no read of a story-time value sits outside timelessNull or the allow-list", () => {
		const bad = [...counts]
			.filter(([k]) => !(k in ALLOWED))
			.map(
				([k, n]) =>
					`${k} reads a story-time value ${n} time(s) outside timelessNull( (line ${lines.get(k)!.join(", ")}) — map it with the reading's timelineOff, or allow-list it with a reason`
			)
		expect(bad, bad.join("\n")).toEqual([])
	})

	test("each allow-list entry still matches its count", () => {
		const stale = Object.entries(ALLOWED)
			.filter(([k, v]) => (counts.get(k) ?? 0) !== v.count)
			.map(
				([k, v]) =>
					`allow-list entry ${k} (${v.why}) matches ${counts.get(k) ?? 0} time(s), expected ${v.count} — remove or fix the entry`
			)
		expect(stale, stale.join("\n")).toEqual([])
	})

	test("the mapped sites the rule relies on are still mapped", () => {
		for (const k of [
			"scenes/earlierScenes.ts#earlierScenesOf",
			"state/statTrail.ts#statTrailFor",
			"pipelines/runtime/host.read.sessionCast.ts#readSessionCast",
			"pipelines/runtime/host.read.lorebookEntries.ts#readLorebookEntries"
		])
			expect(mapped.has(k), k).toBe(true)
	})

	test("the scan sees what it should", () => {
		expect(PATTERN.test("openedStoryClock: x")).toBe(true)
		expect(PATTERN.test("m.story_clock_year")).toBe(true)
		expect(PATTERN.test("sceneClockOf(s)")).toBe(true)
		expect(PATTERN.test("forkedAt: cut")).toBe(true)
		expect(YEAR.test("year: row.year ?? null")).toBe(true)
		expect(YEAR.test("year: number | null")).toBe(false)
		expect(OWN_PATTERN["state/statTrail.ts"]!.test("anchor: { historyEntryId: 1, date }")).toBe(true)
		expect(stripComments("x // storyClock\ny")).not.toMatch(PATTERN)
	})

	test("it judges each field: one timelessNull( in a function does not clear its other time fields", () => {
		const source = [
			"function read(row, off) {",
			"\treturn {",
			"\t\tstoryClockYear: timelessNull(off, row.storyClockYear),",
			"\t\topenedStoryClock: timelessNull(",
			"\t\t\toff,",
			"\t\t\tsceneClockOf(row, 'opened')",
			"\t\t),",
			"\t\tforkedAt: row.forkedAt,",
			"\t\tyear: row.year",
			"\t}",
			"}"
		].join("\n")
		const hits = scanSource("x.ts", source)
		expect(hits.filter((h) => !h.mapped).map((h) => h.line)).toEqual([8, 9])
		expect(hits.filter((h) => h.mapped)).toHaveLength(3)
		expect(scanSource("x.ts", "const f = () => 1 // storyClock")).toEqual([])
	})
})
