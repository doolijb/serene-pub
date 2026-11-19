/**
 * Owner, 2026-11-16: "There shouldn't be a scenario where it defaults to 1-1-1."
 * A story's history, scenes and imports use the story's now, or refuse in words;
 * none falls back to Year 1. This scan fails on a literal year-1 fallback
 * (`year: 1`, `year ?? 1`, `year || 1`) in the story-time, entries, scenes and
 * import modules, after comments are stripped.
 *
 * Each failure names `<file>:<line>` and the rule. The sites that remain are on
 * `ALLOWED`, with a reason; the list is checked both ways, so an entry whose
 * site has gone fails and names itself (the list shrinks as the sites go).
 *
 * Limits: a year built from a variable or a number written another way is not
 * seen; a `year: 1` that is not a fallback (a fixture) would be, and would be
 * allowed by name.
 */
import { readFileSync, readdirSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import { describe, expect, test } from "vitest"

const SERVER = resolve(__dirname, "..")
const ROOT = resolve(SERVER, "../../..")

const FILES = [
	"state/storyTime.ts",
	"state/reading.ts",
	"sockets/entries.ts",
	"messages/writes.ts",
	"utils/lorebookEntries.ts",
	"utils/lorebookImportMapper.ts"
]

const RULE =
	"no history entry falls back to Year 1 (owner, 2026-11-16): use the story's now, or refuse in words"

const PATTERN = /\byear\s*(?::|\?\?|\|\|)\s*1(?![\d.])/

/** Every non-test `.ts` under `dir`, as paths relative to the server root. */
function tsUnder(dir: string): string[] {
	const out: string[] = []
	for (const e of readdirSync(join(SERVER, dir), { withFileTypes: true })) {
		const rel = `${dir}/${e.name}`
		if (e.isDirectory()) out.push(...tsUnder(rel))
		else if (/\.ts$/.test(e.name) && !/\.(test|spec)\.ts$|\.d\.ts$/.test(e.name))
			out.push(rel)
	}
	return out
}

/** Source with line and block comments blanked, line breaks kept (so lines still count). Strings are walked so `//` inside one stays. */
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

/** `<server-relative file>:<line>` of each hit. */
function hitsOf(file: string): string[] {
	const lines = stripComments(readFileSync(join(SERVER, file), "utf8")).split("\n")
	const hits: string[] = []
	lines.forEach((l, i) => {
		if (PATTERN.test(l)) hits.push(`${file}:${i + 1}`)
	})
	return hits
}

/** file -> the reason it may keep a year-1 literal. */
const ALLOWED: Record<string, string> = {}

describe("no history entry falls back to Year 1", () => {
	const files = [...FILES, ...tsUnder("scenes")]
	const hits = new Map(files.map((f) => [f, hitsOf(f)]))

	test("every guarded file is found", () => {
		for (const f of files)
			expect(() => readFileSync(join(SERVER, f)), f).not.toThrow()
	})

	test("no site outside the allow-list has a literal year-1 fallback", () => {
		const bad = files
			.filter((f) => !(f in ALLOWED))
			.flatMap((f) => hits.get(f)!)
			.map(
				(h) =>
					`${relative(ROOT, join(SERVER, h.split(":")[0]))}:${h.split(":")[1]} — ${RULE}`
			)
		expect(bad, bad.join("\n")).toEqual([])
	})

	test("each allow-list entry still matches exactly once", () => {
		const stale = Object.entries(ALLOWED)
			.filter(([f]) => hits.get(f)?.length !== 1)
			.map(
				([f, why]) =>
					`allow-list entry ${f} (${why}) matches ${hits.get(f)?.length ?? "no scanned file"} time(s), expected 1 — remove or fix the entry`
			)
		expect(stale, stale.join("\n")).toEqual([])
	})
})
