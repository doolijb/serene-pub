/**
 * Owner, 2026-11-16: a lorebook that keeps a timeline gets its writes dated by
 * the story's date, and every outlet asks one function for it
 * (`loreWriteDateOf`, `state/storyTime.ts`). This scan fails on a second way
 * of reading "the story's day" in the three files that write lore for a
 * session: a `.moment` read, `sessionStoryNowOf(`, `storyNowOf(`, `momentOf(`
 * or `writeDatingAt(`, after comments are stripped.
 *
 * Each hit is keyed by file + the enclosing top-level function or const (not a
 * line number) with its expected count and a reason. The list is checked both
 * ways: a hit outside it fails and names itself; an entry whose count has
 * changed (or whose site has gone) fails and names itself.
 *
 * Limits: only top-level `function` / `const` declarations name a hit (an
 * inner closure is reported under its outer function); a date read through a
 * variable or another helper is not seen.
 */
import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { describe, expect, test } from "vitest"

const SERVER = resolve(__dirname, "../..")

const FILES = [
	"pipelines/runtime/host.ts",
	"pipelines/runtime/host.loreWrites.ts",
	"characters/versions.ts"
]

const PATTERN =
	/\.moment\b|\bsessionStoryNowOf\(|\bstoryNowOf\(|\bmomentOf\(|\bwriteDatingAt\(/

/** `<file>#<function>` -> expected hit lines and the reason each is not a lore write's date. */
const ALLOWED: Record<string, { count: number; why: string }> = {
	"pipelines/runtime/host.loreWrites.ts#loreWriteLineOf": {
		count: 1,
		why: "hangs a link on a history entry, not a date"
	},
	"pipelines/runtime/host.loreWrites.ts#ownBookDaysCounted": {
		count: 4,
		why: "the notes route's history day and hang-on, counting the notes' own days; deliberately not through `loreWriteDateOf`"
	},
	"pipelines/runtime/host.loreWrites.ts#historyDateOf": {
		count: 1,
		why: "the `countNotes` branch only (the default history day counts the notes' days too, via `ownBookDaysCounted`); the non-`countNotes` branch asks `loreWriteDateOf`"
	},
	"pipelines/runtime/host.loreWrites.ts#historyDayInNotes": {
		count: 1,
		why: "a fork date, not a write's date: the line's fork moment decides whether the day is taken in the notes"
	},
	"characters/versions.ts#bookPresentOf": {
		count: 3,
		why: "the book's present for reading which cast version is in force and for a card reparent (no session, an author's write); a session's story write asks `loreWriteDateOf` in `storyWrite`"
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

const DECLARATION = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\s*\*?\s*|const\s+|let\s+)([A-Za-z_$][\w$]*)/

/** `<file>#<enclosing top-level name>` of each hit line, in order. */
function hitsOf(file: string): string[] {
	const lines = stripComments(readFileSync(join(SERVER, file), "utf8")).split("\n")
	const hits: string[] = []
	let enclosing = "(module)"
	for (const l of lines) {
		const d = DECLARATION.exec(l)
		if (d) enclosing = d[1]!
		if (PATTERN.test(l)) hits.push(`${file}#${enclosing}`)
	}
	return hits
}

describe("a lore write's date is read by loreWriteDateOf alone", () => {
	const counts = new Map<string, number>()
	for (const f of FILES) for (const h of hitsOf(f)) counts.set(h, (counts.get(h) ?? 0) + 1)

	test("every guarded file is found", () => {
		for (const f of FILES) expect(() => readFileSync(join(SERVER, f)), f).not.toThrow()
	})

	test("no read of the story's day sits outside the allow-list", () => {
		const bad = [...counts]
			.filter(([k]) => !(k in ALLOWED))
			.map(
				([k, n]) =>
					`${k} reads the story's day ${n} time(s) outside loreWriteDateOf — ask loreWriteDateOf, or allow-list it with a reason`
			)
		expect(bad, bad.join("\n")).toEqual([])
	})

	test("each allow-list entry still matches its count", () => {
		const stale = Object.entries(ALLOWED)
			.filter(([k, v]) => counts.get(k) !== v.count)
			.map(
				([k, v]) =>
					`allow-list entry ${k} (${v.why}) matches ${counts.get(k) ?? 0} time(s), expected ${v.count} — remove or fix the entry`
			)
		expect(stale, stale.join("\n")).toEqual([])
	})

	test("the scan sees what it should", () => {
		expect(PATTERN.test("a.moment")).toBe(true)
		expect(PATTERN.test("await sessionStoryNowOf(db, 1)")).toBe(true)
		expect(PATTERN.test("nothing here")).toBe(false)
		expect(stripComments("x // momentOf(\ny")).not.toMatch(PATTERN)
	})
})
