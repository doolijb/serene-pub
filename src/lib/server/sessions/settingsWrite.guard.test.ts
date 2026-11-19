/**
 * `sessions/settingsWrite.ts` holds the only writers of a session's
 * `genre_fields` and `rigour` columns (P2: a module owns its data and every
 * write to it; two writers of one thing is a bug). This scan fails on any other
 * write to either column in server code (`src/lib/server`, `src/routes`;
 * tests, specs and `.d.ts` excluded).
 *
 * Four forms, each reported as `<repo-relative file>:<line> <form>`:
 *
 *   - `update`       `X.set(arg)` with one argument, or `onConflictDoUpdate({ set })`,
 *                    where `arg` holds an object literal with a property named
 *                    `genreFields` or `rigour` (searched through spreads,
 *                    conditionals and nested literals, not into function bodies).
 *                    No other table has those keys, so the table is not resolved.
 *   - `insert`       `X.values(arg)` with one argument, same property rule
 *                    (array elements too).
 *   - `sql`          a string or template literal reading `update sessions set …
 *                    genre_fields|rigour` or `insert into sessions ( … genre_fields|rigour …`.
 *   - `json-helper`  a call with the string arguments `"sessions"` and
 *                    `"genre_fields"` or `"rigour"` (the `putJson` form).
 *
 * The owner module shows exactly two `update` sites (its own two writes). Every
 * other hit is on `ALLOWED`, by file, with an exact count per form and a
 * reason; the list is checked in both directions, so an entry whose sites have
 * gone or whose count has changed fails and names itself.
 *
 * Limits: a write through an object built in a variable (`.values(row)`), or a
 * column name assembled at run time, is not seen. The inserts known to be of
 * that shape are named in `UNSEEN_INSERTS`, which only asserts the file exists.
 */

import { readFileSync, readdirSync, existsSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import { describe, expect, test } from "vitest"
import ts from "typescript"

type Form = "update" | "insert" | "sql" | "json-helper"
interface Hit {
	line: number
	form: Form
}

const KEYS = new Set(["genreFields", "rigour"])

const propName = (n: ts.PropertyName): string | undefined =>
	ts.isIdentifier(n) || ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)
		? n.text
		: undefined

/** Does this expression hold an object literal naming a guarded column? */
function holdsKey(e: ts.Expression): boolean {
	if (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression(e))
		return holdsKey(e.expression)
	if (ts.isConditionalExpression(e)) return holdsKey(e.whenTrue) || holdsKey(e.whenFalse)
	if (ts.isBinaryExpression(e)) return holdsKey(e.left) || holdsKey(e.right)
	if (ts.isArrayLiteralExpression(e)) return e.elements.some(holdsKey)
	if (ts.isObjectLiteralExpression(e)) {
		return e.properties.some((p) => {
			if (ts.isSpreadAssignment(p)) return holdsKey(p.expression)
			if (ts.isShorthandPropertyAssignment(p)) return KEYS.has(p.name.text)
			if (ts.isPropertyAssignment(p)) {
				const name = propName(p.name)
				return (name !== undefined && KEYS.has(name)) || holdsKey(p.initializer)
			}
			return false
		})
	}
	return false
}

const SQL_UPDATE = /update\s+"?sessions"?\s+set\b[^;]*?\b(?:genre_fields|rigour)\b/i
const SQL_INSERT = /insert\s+into\s+"?sessions"?\s*\([^)]*?\b(?:genre_fields|rigour)\b/i

const isStr = (a: ts.Node | undefined, v: string | string[]) =>
	!!a &&
	(ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a)) &&
	(Array.isArray(v) ? v.includes(a.text) : a.text === v)

/** Every write to a guarded column that `text` spells, as `{ line, form }`. */
export function scanSource(fileName: string, text: string): Hit[] {
	const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true)
	const hits: Hit[] = []
	const add = (n: ts.Node, form: Form) =>
		hits.push({ line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, form })

	const visit = (n: ts.Node) => {
		if (ts.isCallExpression(n)) {
			const callee = n.expression
			const method = ts.isPropertyAccessExpression(callee) ? callee.name.text : undefined
			const [first] = n.arguments
			if (method === "set" && n.arguments.length === 1 && holdsKey(first!)) add(n, "update")
			if (method === "values" && n.arguments.length === 1 && holdsKey(first!)) add(n, "insert")
			if (method === "onConflictDoUpdate" && first && ts.isObjectLiteralExpression(first)) {
				for (const p of first.properties) {
					if (ts.isPropertyAssignment(p) && propName(p.name) === "set" && holdsKey(p.initializer))
						add(n, "update")
				}
			}
			if (
				n.arguments.some((a) => isStr(a, "sessions")) &&
				n.arguments.some((a) => isStr(a, ["genre_fields", "rigour"]))
			)
				add(n, "json-helper")
		}
		let literal: string | undefined
		if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) literal = n.text
		else if (ts.isTemplateExpression(n))
			literal = n.head.text + n.templateSpans.map((s) => "?" + s.literal.text).join("")
		if (literal !== undefined && (SQL_UPDATE.test(literal) || SQL_INSERT.test(literal))) add(n, "sql")
		ts.forEachChild(n, visit)
	}
	visit(sf)
	return hits
}

// ── Self-tests of the scanner ───────────────────────────────────────────────

const forms = (src: string) => scanSource("x.ts", src).map((h) => h.form)

describe("scanner", () => {
	test("finds each form", () => {
		expect(forms(`await tx.update(t).set({ genreFields: next }).where(w)`)).toEqual(["update"])
		expect(forms(`await tx.update(t).set({ ...(x ? { rigour } : {}) }).where(w)`)).toEqual(["update"])
		expect(forms(`db.insert(t).values({ a: 1 }).onConflictDoUpdate({ target: t.id, set: { rigour: 1 } })`)).toEqual([
			"update"
		])
		expect(forms(`await db.insert(t).values({ userId, genreFields: {} })`)).toEqual(["insert"])
		expect(forms(`await db.insert(t).values([{ a: 1 }, { rigour: "prose" }])`)).toEqual(["insert"])
		expect(forms("await db.execute(sql`UPDATE sessions\n  SET presetId = 1,\n genre_fields = ${x}\n WHERE id = 1`)")).toEqual(
			["sql"]
		)
		expect(forms(`q("insert into \\"sessions\\" (user_id, rigour) values (1, 'a')")`)).toEqual(["sql"])
		expect(forms(`await putJson(tx, "sessions", "genre_fields", id, doc, "json")`)).toEqual(["json-helper"])
	})

	test("ignores look-alikes", () => {
		expect(forms(`db.select({ genreFields: schema.sessions.genreFields }).from(schema.sessions)`)).toEqual([])
		expect(forms(`map.set(key, { rigour: 1 })`)).toEqual([])
		expect(forms(`Object.values(x)`)).toEqual([])
		expect(forms(`tx.update(t).set({ presetId })`)).toEqual([])
		expect(forms(`tx.update(t).set(() => ({ rigour }))`)).toEqual([])
		expect(forms(`await putJson(tx, "sessions", "preset", id, doc)`)).toEqual([])
	})
})

// ── The corpus ──────────────────────────────────────────────────────────────

const ROOT = resolve(__dirname, "../../../..")
const rel = (p: string) => relative(ROOT, p).split("\\").join("/")
const isExcluded = (p: string) => /\.(?:test|spec)\.ts$/.test(p) || p.endsWith(".d.ts")

function walk(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const p = join(dir, entry.name)
		if (entry.isDirectory()) {
			if (entry.name !== "node_modules") walk(p, out)
		} else if (entry.name.endsWith(".ts") && !isExcluded(p)) out.push(p)
	}
	return out
}

const SOURCES = [...walk(join(ROOT, "src/lib/server")), ...walk(join(ROOT, "src/routes"))].sort()

const found = new Map<string, Hit[]>()
for (const f of SOURCES) {
	const hits = scanSource(f, readFileSync(f, "utf8"))
	if (hits.length) found.set(rel(f), hits)
}

const S = "src/lib/server/"
const OWNER = `${S}sessions/settingsWrite.ts`

interface Allowed {
	file: string
	form: Form
	count: number
	reason: string
}

const ALLOWED: readonly Allowed[] = [
	{ file: `${S}sessions/branch.ts`, form: "insert", count: 1, reason: "a branch is a new row that copies its parent session" },
	{ file: `${S}sockets/import.ts`, form: "insert", count: 2, reason: "an imported session is a new row carrying its author's note" },
	{ file: `${S}sessions/honorModeRetired.ts`, form: "update", count: 1, reason: "boot pass: maps a retired `honorMode` key in place, once" },
	{ file: `${S}sessions/seatKeys.ts`, form: "json-helper", count: 1, reason: "the seat-keys boot pass: a key migration, written raw so `updated_at` does not move" },
	{ file: `${S}utils/testDb.ts`, form: "update", count: 1, reason: "test fixture helper (`applyLegacyTasks`), never run by the app" },
	{ file: `${S}db/dataUpgrades/0108_layering_registrations.ts`, form: "sql", count: 1, reason: "frozen data upgrade, run once by the migration ledger" },
	{ file: `${S}db/dataUpgrades/0110_layering_follow_ups.ts`, form: "sql", count: 1, reason: "frozen data upgrade, run once by the migration ledger" },
	{ file: `${S}db/dataUpgrades/0112_lair_rewrite.ts`, form: "sql", count: 1, reason: "frozen data upgrade, run once by the migration ledger" }
]

/** Inserts the scan cannot see: the row object is built elsewhere. */
const UNSEEN_INSERTS: readonly { file: string; reason: string }[] = [
	{ file: `${S}sockets/sessions.create.ts`, reason: "`.values(sessionData)`: a new session" },
	{ file: `${S}attic/etl/sessions.ts`, reason: "a 0.5.3 session arriving through the attic" },
	{ file: `${S}pipelines/testing/fixtures.ts`, reason: "test fixtures" }
]

const count = (file: string, form: Form) => (found.get(file) ?? []).filter((h) => h.form === form).length
const sites = (file: string, form: Form) =>
	(found.get(file) ?? []).filter((h) => h.form === form).map((h) => `${file}:${h.line} ${form}`)

describe("one writer of a session's genre fields and rigour", () => {
	test("the owner module writes in exactly its two updates", () => {
		expect(found.get(OWNER)?.map((h) => h.form)).toEqual(["update", "update"])
	})

	test("every other write is allow-listed", () => {
		const lines: string[] = []
		for (const [file, hits] of found) {
			if (file === OWNER) continue
			for (const form of new Set(hits.map((h) => h.form))) {
				if (!ALLOWED.some((a) => a.file === file && a.form === form)) lines.push(...sites(file, form))
			}
		}
		expect(
			lines,
			"write through `sessions/settingsWrite.ts` (`writeGenreFields`, `writeRigour`); never allow-list a caller"
		).toEqual([])
	})

	test("every allow-list entry still matches its count", () => {
		const stale = ALLOWED.filter((a) => count(a.file, a.form) !== a.count).map(
			(a) => `${a.file} ${a.form}: expected ${a.count}, found ${count(a.file, a.form)} (${a.reason})`
		)
		expect(stale, "delete or correct the entry").toEqual([])
	})

	test("the inserts the scan cannot see are in files that still exist", () => {
		const missing = UNSEEN_INSERTS.filter((u) => !existsSync(join(ROOT, u.file))).map((u) => u.file)
		expect(missing).toEqual([])
	})
})
