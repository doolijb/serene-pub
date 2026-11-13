/**
 * Guard 2 of 2 — the frozen columns stay frozen.
 *
 * Character versions (S4 stage 1) hold every card and cast-member version in
 * `character_versions`. The columns that held the same data before are FROZEN (⏳,
 * dropped in S5): nothing may read or write them except the versions module
 * (`characters/versions.ts`), the lift (`characters/versionsLift.ts`) and the
 * attic (`src/lib/server/attic/`, out of the scan). Two writers of one thing is a
 * bug (P2), and a session-path module that reads a card copy reads a stale one.
 *
 * ## The sets
 *
 *   - `lorebookBindings` frozen: any read or write of description, personality,
 *     scenario, firstMessage, alternateGreetings, exampleDialogues, faceMediaId,
 *     retold, ownName, ownNickname, timbre, spriteSet, nodeState, nodeVisibility.
 *   - `castAmendments`: any WRITE (`.insert(ref)` / `.update(ref)`). Reads and
 *     deletes are fine.
 *   - `characters` frozen content: any read or write of aliases, summary,
 *     personality, scenario, firstMessage, alternateGreetings, exampleDialogues,
 *     groupOnlyGreetings, postHistoryInstructions, creatorNotes,
 *     creatorNotesMultilingual, strokes, extensions, characterVersion.
 *   - `characters` ⏳ copies (name, nickname, avatarMediaId, description): a WRITE
 *     anywhere; a READ only in a session-path file — `src/lib/server/{pipelines,
 *     sessions,state,speech,sprites,messages,rulesets}/**` and the sockets
 *     `sessions`, `state`, `pipelines`, `jump`.
 *
 * Everything else (ids, owner, is_deleted, folder, embeddings, timestamps, …) is
 * never flagged.
 *
 * ## What counts
 *
 *   - **read**: a property access `<table ref>.<col>` anywhere (select, where,
 *     orderBy, sql interpolation); a `col: true` key in the top-level `columns`
 *     of `<x>.query.<table>.findFirst/findMany`; a raw SQL literal naming
 *     `characters.<snake col>` / `"lorebook_bindings"."<snake col>"`.
 *   - **write**: a key of `.set({…})` on a chain that began `.update(<ref>)`; a
 *     key of `.values({…})` after `.insert(<ref>)`; a key of
 *     `onConflictDoUpdate({ set })` on such an insert.
 *
 * ## Blind spots — stated, not hidden
 *
 *   - **Spreads** (`...row`), **whole-row selects** (`select().from(characters)`)
 *     and **relational `with:`** read columns without naming them. They cannot be
 *     detected as columns. The CENSUS test lists the whole-row reads of
 *     `characters` in the session-path set instead, so they are at least seen.
 *   - Bare snake names in raw SQL are not matched (`character_versions` has the
 *     same column names); only `<table>.<col>` is.
 *   - Table references are resolved syntactically per file (see `guardScan.ts`).
 *
 * ## Scope
 *
 * Every `src/**\/*.ts` except `*.test.ts` / `*.spec.ts`, the attic and
 * `db/schema.ts`. Test files are out of scope (they build fixtures; product code
 * is what the rule is about); test helpers that are not `.test.ts` ARE scanned.
 *
 * ## Adding an exception
 *
 * Add `{ file, table, column, kind, reason }` to `ALLOWED` — no line number, so
 * edits don't break it. Checked in BOTH directions: an entry no finding matches
 * fails and names itself for deletion.
 */

import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"
import {
	scanAll,
	scanSource,
	snake,
	type GuardTable,
	type ScanResult
} from "./guardScan"

const ROOT = resolve(fileURLToPath(import.meta.url), "../../../../..")

const ALLOWED_MODULES = new Set([
	"src/lib/server/characters/versions.ts",
	"src/lib/server/characters/versionsLift.ts"
])

const BINDING_FROZEN = [
	"description",
	"personality",
	"scenario",
	"firstMessage",
	"alternateGreetings",
	"exampleDialogues",
	"faceMediaId",
	"retold",
	"ownName",
	"ownNickname",
	"timbre",
	"spriteSet",
	"nodeState",
	"nodeVisibility"
] as const
const CHARACTERS_FROZEN = [
	"aliases",
	"summary",
	"personality",
	"scenario",
	"firstMessage",
	"alternateGreetings",
	"exampleDialogues",
	"groupOnlyGreetings",
	"postHistoryInstructions",
	"creatorNotes",
	"creatorNotesMultilingual",
	"strokes",
	"extensions",
	"characterVersion"
] as const
const CHARACTERS_COPIES = [
	"name",
	"nickname",
	"avatarMediaId",
	"description"
] as const

const SESSION_DIRS = [
	"pipelines",
	"sessions",
	"state",
	"speech",
	"sprites",
	"messages",
	"rulesets"
].map((d) => `src/lib/server/${d}/`)
const SESSION_FILES = ["sessions", "state", "pipelines", "jump"].map(
	(s) => `src/lib/server/sockets/${s}.ts`
)
const isSessionPath = (file: string) =>
	SESSION_DIRS.some((d) => file.startsWith(d)) || SESSION_FILES.includes(file)

interface Finding {
	file: string
	line: number
	table: GuardTable
	column: string
	kind: "read" | "write"
}

interface Allowed {
	file: string
	table: GuardTable
	column: string
	kind: "read" | "write"
	reason: string
}

/*
 * The session path reads no card copy (cv-readers, 2026-11-06; owner ruling
 * 2026-11-05 "Everything in session is cast -> active card"): a seat or
 * speaker reads its cast member as read (`membersAsRead`, `seatCardsAsRead`),
 * a card no member answers for reads its current card version (`cardsNow`,
 * `cardsNowAsSeatsRead`). There is no allowlist for these reads — never add one.
 */

/** Pre-ruled entries; every other site is a finding. */
const PROVIDED_MARK =
	"the provided mark is ownership metadata on `characters.extensions` (lead disposition 2026-11-05, cv-writers); reads only the `extensions.serenepub.provided` mark"
const ALLOWED: Allowed[] = [
	{
		file: "src/lib/server/plugins/providedMarks.ts",
		table: "characters",
		column: "extensions",
		kind: "read",
		reason: `${PROVIDED_MARK} (\`genuineProvidedMarkSql\`: the one hide predicate for hidden carrier cards, ★S4-1)`
	},
	{
		file: "src/lib/server/plugins/providedBooks.ts",
		table: "characters",
		column: "extensions",
		kind: "read",
		reason: PROVIDED_MARK
	},
	{
		file: "src/lib/server/sockets/appletLibrary.ts",
		table: "characters",
		column: "extensions",
		kind: "read",
		reason: PROVIDED_MARK
	},
	{
		file: "src/lib/server/plugins/providedBooks.ts",
		table: "characters",
		column: "characterVersion",
		kind: "read",
		reason: "`castHashNow` reads `characters.characterVersion` so installed books' stored hashes stay stable; switching to the version label would flag every installed book as kept edited (a test pins it)"
	},
	{
		file: "src/lib/server/sockets/characters.ts",
		table: "characters",
		column: "extensions",
		kind: "read",
		reason: `${PROVIDED_MARK} (\`keepStoredProvidedMark\` on a save)`
	},
	{
		file: "src/lib/server/plugins/providedBooks.ts",
		table: "characters",
		column: "extensions",
		kind: "write",
		reason: 'stamps the provided mark (`stampProvidedCharacter`): "The provided mark is still read from and written to `characters.extensions`, as ownership metadata" (cv-writers, lead disposition 2026-11-05)'
	}
]

/** Findings for one file's scan result. */
function findingsOf(file: string, r: ScanResult): Finding[] {
	if (ALLOWED_MODULES.has(file)) return []
	const session = isSessionPath(file)
	const out: Finding[] = []
	for (const c of r.columns) {
		let column = c.column
		let kind = c.kind
		if (column.startsWith("sql:")) {
			const names: readonly string[] =
				c.table === "lorebookBindings"
					? BINDING_FROZEN
					: c.table === "characters"
						? [...CHARACTERS_FROZEN, ...CHARACTERS_COPIES]
						: []
			const prop = names.find((n) => snake(n) === column.slice(4))
			if (!prop) continue
			column = prop
		}
		const push = () =>
			out.push({ file, line: c.line, table: c.table, column, kind })
		if (c.table === "lorebookBindings") {
			if ((BINDING_FROZEN as readonly string[]).includes(column)) push()
		} else if (c.table === "castAmendments") {
			if (kind === "write") push()
		} else if (c.table === "characters") {
			if ((CHARACTERS_FROZEN as readonly string[]).includes(column))
				push()
			else if (
				(CHARACTERS_COPIES as readonly string[]).includes(column)
			) {
				if (kind === "write" || session) push()
			}
		}
	}
	return out
}

describe("frozen character-version columns", () => {
	test("scanner positive controls", () => {
		const src = `
import * as schema from "$lib/server/db/schema"
async function f(db: any, tx: any) {
	await db.select({ r: schema.lorebookBindings.retold }).from(schema.lorebookBindings)
	await db.update(schema.characters).set({ personality: "x" })
	await db.insert(schema.castAmendments).values({})
	await db.select({ n: schema.characters.name }).from(schema.characters)
	await db.select({ n: schema.lorebookBindings.name }).from(schema.lorebookBindings)
}`
		const sess = findingsOf(
			"src/lib/server/sessions/x.ts",
			scanSource("x.ts", src)
		)
			.map((f) => `${f.table}.${f.column} ${f.kind}`)
			.sort()
		expect(sess).toEqual(
			[
				"lorebookBindings.retold read",
				"characters.personality write",
				"castAmendments.(insert) write",
				"characters.name read"
			].sort()
		)
		const other = findingsOf(
			"src/lib/server/lorebooks/x.ts",
			scanSource("x.ts", src)
		)
			.map((f) => `${f.table}.${f.column} ${f.kind}`)
			.sort()
		expect(other).not.toContain("characters.name read")
		expect(other).not.toContain("lorebookBindings.name read")
		expect(other).toHaveLength(3)
	})

	test("raw SQL and query.columns controls", () => {
		const src = `
import * as schema from "$lib/server/db/schema"
const q = sql\`select "lorebook_bindings"."retold", characters.first_message, lorebook_bindings.summary from x\`
const r = await db.query.characters.findFirst({ columns: { id: true, strokes: true } })
const w = await db.query.characters.findMany({ with: { character: true } })
`
		const f = findingsOf(
			"src/lib/server/lorebooks/x.ts",
			scanSource("x.ts", src)
		)
			.map((x) => `${x.table}.${x.column} ${x.kind}`)
			.sort()
		expect(f).toEqual([
			"characters.firstMessage read",
			"characters.strokes read",
			"lorebookBindings.retold read"
		])
	})

	const all = scanAll(ROOT)
	const found: Finding[] = []
	for (const [file, r] of all) found.push(...findingsOf(file, r))
	const matches = (a: Allowed, f: Finding) =>
		a.file === f.file &&
		a.table === f.table &&
		a.column === f.column &&
		a.kind === f.kind

	test("no frozen column is touched outside the versions module and the lift", () => {
		const bad = found
			.filter((f) => !ALLOWED.some((a) => matches(a, f)))
			.map((f) => `${f.file}:${f.line} ${f.table}.${f.column} ${f.kind}`)
		expect(bad, "frozen column access").toEqual([])
	})

	test("every allowlist entry still has its site", () => {
		const stale = ALLOWED.filter(
			(a) => !found.some((f) => matches(a, f))
		).map((a) => `${a.file} ${a.table}.${a.column} ${a.kind}: ${a.reason}`)
		expect(stale, "stale allowlist entries — delete them").toEqual([])
	})

	test("census: whole-row reads of characters in the session-path set (report only)", () => {
		const lines: string[] = []
		for (const [file, r] of all) {
			if (!isSessionPath(file)) continue
			for (const w of r.wholeRowReads)
				lines.push(`${file}:${w.line} ${w.how}`)
		}
		console.info(
			`whole-row reads of characters in session-path files (${lines.length}):\n` +
				lines.join("\n")
		)
		expect(true).toBe(true)
	})
})
