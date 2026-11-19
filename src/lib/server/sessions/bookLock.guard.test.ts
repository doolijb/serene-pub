/**
 * A session keeps the lorebook it started with (owner ruling ★B-5, 2026-11-08:
 * "The book is chosen when the session is made and never moved after — not
 * before play, not after."). The rule lives in `sessions/bookLock.ts`
 * (`bookChangeRefusal`, the sentence `BOOK_LOCK_REFUSAL`) and is enforced in
 * `sockets/sessions.update.ts`. This scan fails on any other write to the
 * `sessions.lorebook_id` column in server code (`src/lib/server`, `src/routes`;
 * tests, specs and `.d.ts` excluded).
 *
 * `lorebookId` is a key on many tables, so the table is resolved. Two forms,
 * each reported as `<repo-relative file>:<line> <form>`:
 *
 *   - `update`  `X.update(T).set(arg)` with one argument, or
 *               `X.insert(T)…onConflictDoUpdate({ set })`, where `T` is the
 *               sessions table (`schema.sessions`, `sessions`, or an identifier
 *               the same file binds with `const <id> = schema.sessions`) and
 *               `arg` holds an object literal with a property named `lorebookId`
 *               (searched through spreads, conditionals and nested literals,
 *               not into function bodies).
 *   - `sql`     a string or template literal reading `update sessions set …
 *               lorebook_id` (whole word: `lorebook_branch_id`, the session's
 *               line, is not the lorebook).
 *
 * Inserts are not flagged: making a session is choosing its book, never a move.
 *
 * The scan shows no hit in `sockets/sessions.update.ts`. Every other hit is on
 * `ALLOWED`, by file, with an exact count per form and a reason; the list is
 * checked in both directions, so an entry whose sites have gone or whose count
 * has changed fails and names itself.
 *
 * Limits: a `.set(row)` whose object is built in a variable, or a column name
 * assembled at run time, is not seen. The foreign key's `on delete set null`
 * when a lorebook is deleted is not code and is not scanned.
 */

import { readFileSync, readdirSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import { describe, expect, test } from "vitest"
import ts from "typescript"

type Form = "update" | "sql"
interface Hit {
	line: number
	form: Form
}

const KEY = "lorebookId"

const propName = (n: ts.PropertyName): string | undefined =>
	ts.isIdentifier(n) || ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)
		? n.text
		: undefined

/** Does this expression hold an object literal naming the guarded column? */
function holdsKey(e: ts.Expression): boolean {
	if (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression(e))
		return holdsKey(e.expression)
	if (ts.isConditionalExpression(e)) return holdsKey(e.whenTrue) || holdsKey(e.whenFalse)
	if (ts.isBinaryExpression(e)) return holdsKey(e.left) || holdsKey(e.right)
	if (ts.isArrayLiteralExpression(e)) return e.elements.some(holdsKey)
	if (ts.isObjectLiteralExpression(e)) {
		return e.properties.some((p) => {
			if (ts.isSpreadAssignment(p)) return holdsKey(p.expression)
			if (ts.isShorthandPropertyAssignment(p)) return p.name.text === KEY
			if (ts.isPropertyAssignment(p)) {
				const name = propName(p.name)
				return name === KEY || holdsKey(p.initializer)
			}
			return false
		})
	}
	return false
}

const SQL_UPDATE = /update\s+"?sessions"?\s+set\b[^;]*?\blorebook_id\b/i

/** Strip parentheses, `as` casts and `satisfies`. */
const bare = (e: ts.Expression): ts.Expression =>
	ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression(e)
		? bare(e.expression)
		: e

const isSessionsExpr = (e: ts.Expression): boolean => {
	const b = bare(e)
	return (
		(ts.isIdentifier(b) && b.text === "sessions") ||
		(ts.isPropertyAccessExpression(b) &&
			ts.isIdentifier(b.expression) &&
			b.expression.text === "schema" &&
			b.name.text === "sessions")
	)
}

/** Is there a call `.method(T)` with `T` the sessions table, down this call chain? */
function chainHas(e: ts.Expression, method: string, aliases: ReadonlySet<string>): boolean {
	let cur: ts.Expression = bare(e)
	for (;;) {
		if (ts.isCallExpression(cur)) {
			const callee = cur.expression
			if (ts.isPropertyAccessExpression(callee) && callee.name.text === method) {
				const [t] = cur.arguments
				if (t) {
					const b = bare(t)
					if (isSessionsExpr(b) || (ts.isIdentifier(b) && aliases.has(b.text))) return true
				}
			}
			cur = bare(callee)
		} else if (ts.isPropertyAccessExpression(cur)) cur = bare(cur.expression)
		else return false
	}
}

/** Every write to the guarded column that `text` spells, as `{ line, form }`. */
export function scanSource(fileName: string, text: string): Hit[] {
	const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true)
	const hits: Hit[] = []
	const add = (n: ts.Node, form: Form) =>
		hits.push({ line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, form })

	// `const S = schema.sessions` aliases bound anywhere in the file.
	const aliases = new Set<string>()
	const collect = (n: ts.Node) => {
		if (
			ts.isVariableDeclaration(n) &&
			ts.isIdentifier(n.name) &&
			n.initializer &&
			isSessionsExpr(n.initializer)
		)
			aliases.add(n.name.text)
		ts.forEachChild(n, collect)
	}
	collect(sf)

	const visit = (n: ts.Node) => {
		if (ts.isCallExpression(n)) {
			const callee = n.expression
			const method = ts.isPropertyAccessExpression(callee) ? callee.name.text : undefined
			const [first] = n.arguments
			if (
				method === "set" &&
				n.arguments.length === 1 &&
				holdsKey(first!) &&
				chainHas((callee as ts.PropertyAccessExpression).expression, "update", aliases)
			)
				add(n, "update")
			if (
				method === "onConflictDoUpdate" &&
				first &&
				ts.isObjectLiteralExpression(first) &&
				chainHas((callee as ts.PropertyAccessExpression).expression, "insert", aliases)
			) {
				for (const p of first.properties) {
					if (ts.isPropertyAssignment(p) && propName(p.name) === "set" && holdsKey(p.initializer))
						add(n, "update")
				}
			}
		}
		let literal: string | undefined
		if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) literal = n.text
		else if (ts.isTemplateExpression(n))
			literal = n.head.text + n.templateSpans.map((s) => "?" + s.literal.text).join("")
		if (literal !== undefined && SQL_UPDATE.test(literal)) add(n, "sql")
		ts.forEachChild(n, visit)
	}
	visit(sf)
	return hits
}

// ── Self-tests of the scanner ───────────────────────────────────────────────

const forms = (src: string) => scanSource("x.ts", src).map((h) => h.form)

describe("scanner", () => {
	test("finds each form", () => {
		expect(forms(`await tx.update(schema.sessions).set({ lorebookId: x }).where(w)`)).toEqual(["update"])
		expect(forms(`await db.update(sessions).set({ lorebookId }).where(w)`)).toEqual(["update"])
		expect(
			forms(`const S = schema.sessions; await db.update(S).set({ ...(a ? { lorebookId } : {}) }).where(w)`)
		).toEqual(["update"])
		expect(
			forms(
				`db.insert(schema.sessions).values({ a: 1 }).onConflictDoUpdate({ target: schema.sessions.id, set: { lorebookId: 1 } })`
			)
		).toEqual(["update"])
		expect(forms(`await db.execute(sql\`UPDATE sessions SET lorebook_id = 1\`)`)).toEqual(["sql"])
		expect(forms("await db.execute(sql`UPDATE \"sessions\"\n  SET name = 'a',\n lorebook_id = ${x}\n WHERE id = 1`)")).toEqual(
			["sql"]
		)
	})

	test("ignores look-alikes", () => {
		expect(forms(`await tx.update(schema.scenes).set({ lorebookId: 1 })`)).toEqual([])
		expect(forms(`await tx.update(schema.sessions).set({ lorebookBranchId: 1 })`)).toEqual([])
		expect(forms(`await db.execute(sql\`UPDATE sessions SET lorebook_branch_id = 1\`)`)).toEqual([])
		expect(forms(`await db.insert(schema.sessions).values({ lorebookId: 1 })`)).toEqual([])
		expect(forms(`db.select({ lorebookId: schema.sessions.lorebookId }).from(schema.sessions)`)).toEqual([])
		expect(forms(`map.set(key, { lorebookId: 1 })`)).toEqual([])
		expect(forms(`const S = schema.scenes; db.update(S).set({ lorebookId: 1 })`)).toEqual([])
		expect(forms(`tx.update(schema.sessions).set(() => ({ lorebookId }))`)).toEqual([])
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

interface Allowed {
	file: string
	form: Form
	count: number
	reason: string
}

const ALLOWED: readonly Allowed[] = [
	{
		file: `${S}lorebooks/ownBook.ts`,
		form: "update",
		count: 1,
		reason:
			"`shareAsLorebook`: a session with no lorebook surfaces its own notes as one and reads them as its lorebook (★27-10, 2026-11-05: \"[own books] can be surfaced\")"
	},
	{
		file: `${S}lorebooks/foldInParent.ts`,
		form: "update",
		count: 1,
		reason:
			"`foldInParent` step 12: after copying the attached lorebook into the notes, the session reads only its notes (★27-10: \"overlays can have their parent merged in place\"; the fold's guard compares reads before and after)"
	}
]

const count = (file: string, form: Form) => (found.get(file) ?? []).filter((h) => h.form === form).length
const sites = (file: string, form: Form) =>
	(found.get(file) ?? []).filter((h) => h.form === form).map((h) => `${file}:${h.line} ${form}`)

describe("a session keeps the lorebook it started with", () => {
	test("the session update socket never writes the column; it refuses through bookChangeRefusal", () => {
		expect(found.get(`${S}sockets/sessions.update.ts`) ?? []).toEqual([])
	})

	test("every other write is allow-listed", () => {
		const lines: string[] = []
		for (const [file, hits] of found) {
			for (const form of new Set(hits.map((h) => h.form))) {
				if (!ALLOWED.some((a) => a.file === file && a.form === form)) lines.push(...sites(file, form))
			}
		}
		expect(
			lines,
			"a session keeps the lorebook it started with (sessions/bookLock.ts); refuse through bookChangeRefusal, never allow-list a caller"
		).toEqual([])
	})

	test("every allow-list entry still matches its count", () => {
		const stale = ALLOWED.filter((a) => count(a.file, a.form) !== a.count).map(
			(a) => `${a.file} ${a.form}: expected ${a.count}, found ${count(a.file, a.form)} (${a.reason})`
		)
		expect(stale, "delete or correct the entry").toEqual([])
	})
})
