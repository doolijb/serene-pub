/**
 * The syntactic scanner behind the two character-version guards
 * (`versionsWriter.guard.test.ts`, `frozenColumns.guard.test.ts`).
 *
 * Parses with the TypeScript compiler API, no program and no type checker: a
 * table reference is resolved from what the file WROTE, per file, never from
 * types. A table is a reference when it is
 *
 *   - `ns.<table>` where `ns` is a namespace import (or `await import(...)`
 *     result) of a module whose specifier ends in `db/schema`;
 *   - a named import / destructured dynamic import of it (`{ characters as c }`);
 *   - a local `const X = <table ref>` or `const X = alias(<table ref>, "...")`.
 *
 * Imports nothing from `$lib/server/db` (it must be loadable without a database).
 */

import ts from "typescript"
import { readdirSync, readFileSync } from "node:fs"
import { join, relative, sep } from "node:path"

export type GuardTable =
	| "lorebookBindings"
	| "characters"
	| "characterVersions"
	| "castAmendments"

const TABLES: ReadonlySet<string> = new Set<GuardTable>([
	"lorebookBindings",
	"characters",
	"characterVersions",
	"castAmendments"
])

export interface ScanHit {
	table: GuardTable
	/** 1-based. */
	line: number
}

export interface ColumnHit extends ScanHit {
	/** drizzle property name, or `(insert)` / `(update)` for a whole-table write. */
	column: string
	kind: "read" | "write"
}

export interface ScanResult {
	/** `<x>.insert(<table ref>)` calls. */
	inserts: ScanHit[]
	/** `<x>.update(<table ref>)` calls. */
	updates: ScanHit[]
	/** String or template literals containing `INSERT INTO <guarded table>`. */
	sqlInserts: ScanHit[]
	/** Property reads / writes on a table's columns (all columns; callers filter). */
	columns: ColumnHit[]
	/** Whole-row reads of `characters` (see the census in the frozen-columns guard). */
	wholeRowReads: (ScanHit & { how: string })[]
}

const SCHEMA_SPEC = /(?:^|\/)db\/schema$/

const snake = (camel: string): string =>
	camel.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase())

const SQL_TABLE_NAMES: Record<string, GuardTable> = {
	lorebook_bindings: "lorebookBindings",
	characters: "characters",
	character_versions: "characterVersions",
	cast_amendments: "castAmendments"
}

function unwrap(node: ts.Node): ts.Node {
	let n = node
	while (
		ts.isParenthesizedExpression(n) ||
		ts.isAwaitExpression(n) ||
		ts.isAsExpression(n) ||
		ts.isNonNullExpression(n) ||
		ts.isSatisfiesExpression(n)
	) {
		n = n.expression
	}
	return n
}

/** Is this expression `import("...db/schema")` (possibly awaited)? */
function isSchemaDynamicImport(node: ts.Node): boolean {
	const n = unwrap(node)
	return (
		ts.isCallExpression(n) &&
		n.expression.kind === ts.SyntaxKind.ImportKeyword &&
		n.arguments.length === 1 &&
		ts.isStringLiteralLike(n.arguments[0]) &&
		SCHEMA_SPEC.test(n.arguments[0].text)
	)
}

/**
 * Scan one file's text. `rel` picks the script kind and
 * nothing else; callers do their own path-based allowlisting.
 */
export function scanSource(rel: string, text: string): ScanResult {
	const sf = ts.createSourceFile(
		rel,
		text,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS
	)
	const lineOf = (n: ts.Node) =>
		sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1

	const namespaces = new Set<string>()
	const refs = new Map<string, GuardTable>()

	// Pass 1: imports.
	for (const st of sf.statements) {
		if (
			ts.isImportDeclaration(st) &&
			ts.isStringLiteral(st.moduleSpecifier) &&
			SCHEMA_SPEC.test(st.moduleSpecifier.text)
		) {
			const nb = st.importClause?.namedBindings
			if (nb && ts.isNamespaceImport(nb)) namespaces.add(nb.name.text)
			if (nb && ts.isNamedImports(nb)) {
				for (const el of nb.elements) {
					const orig = (el.propertyName ?? el.name).text
					if (TABLES.has(orig))
						refs.set(el.name.text, orig as GuardTable)
				}
			}
		}
	}

	// Pass 2: local consts, to a fixpoint (any scope; a name is one meaning per file).
	const decls: ts.VariableDeclaration[] = []
	const collect = (n: ts.Node) => {
		if (ts.isVariableDeclaration(n) && n.initializer) decls.push(n)
		ts.forEachChild(n, collect)
	}
	collect(sf)

	const resolveRef = (expr: ts.Node | undefined): GuardTable | undefined => {
		if (!expr) return undefined
		const n = unwrap(expr)
		if (ts.isIdentifier(n)) return refs.get(n.text)
		if (
			ts.isPropertyAccessExpression(n) &&
			ts.isIdentifier(n.expression) &&
			namespaces.has(n.expression.text) &&
			TABLES.has(n.name.text)
		) {
			return n.name.text as GuardTable
		}
		if (
			ts.isCallExpression(n) &&
			ts.isIdentifier(n.expression) &&
			n.expression.text === "alias" &&
			n.arguments.length >= 1
		) {
			return resolveRef(n.arguments[0])
		}
		return undefined
	}

	for (let changed = true; changed; ) {
		changed = false
		for (const d of decls) {
			const init = d.initializer!
			if (ts.isIdentifier(d.name)) {
				if (isSchemaDynamicImport(init)) {
					if (!namespaces.has(d.name.text)) {
						namespaces.add(d.name.text)
						changed = true
					}
					continue
				}
				const t = resolveRef(init)
				if (t && refs.get(d.name.text) !== t) {
					refs.set(d.name.text, t)
					changed = true
				}
			} else if (ts.isObjectBindingPattern(d.name)) {
				const fromImport = isSchemaDynamicImport(init)
				const fromNs =
					ts.isIdentifier(unwrap(init)) &&
					namespaces.has((unwrap(init) as ts.Identifier).text)
				if (!fromImport && !fromNs) continue
				for (const el of d.name.elements) {
					if (!ts.isIdentifier(el.name)) continue
					const orig = (el.propertyName ?? el.name) as ts.Node
					const origName = ts.isIdentifier(orig) ? orig.text : ""
					if (
						TABLES.has(origName) &&
						refs.get(el.name.text) !== origName
					) {
						refs.set(el.name.text, origName as GuardTable)
						changed = true
					}
				}
			}
		}
	}

	const out: ScanResult = {
		inserts: [],
		updates: [],
		sqlInserts: [],
		columns: [],
		wholeRowReads: []
	}

	const callName = (c: ts.CallExpression): string | undefined => {
		const e = c.expression
		if (ts.isIdentifier(e)) return e.text
		if (ts.isPropertyAccessExpression(e)) return e.name.text
		return undefined
	}

	/** Walk the receiver chain below a call for `.<name>(<table ref>)`. */
	const chainTable = (
		start: ts.Node,
		name: "insert" | "update"
	): GuardTable | undefined => {
		let n: ts.Node | undefined = unwrap(start)
		while (n) {
			if (ts.isCallExpression(n)) {
				if (callName(n) === name && n.arguments.length >= 1) {
					const t = resolveRef(n.arguments[0])
					if (t) return t
				}
				n = ts.isPropertyAccessExpression(n.expression)
					? unwrap(n.expression.expression)
					: undefined
			} else if (ts.isPropertyAccessExpression(n)) {
				n = unwrap(n.expression)
			} else break
		}
		return undefined
	}

	/** Does the receiver chain below contain `.select()` with no arguments? */
	const chainHasBareSelect = (start: ts.Node): boolean => {
		let n: ts.Node | undefined = unwrap(start)
		while (n) {
			if (ts.isCallExpression(n)) {
				if (callName(n) === "select" && n.arguments.length === 0)
					return true
				n = ts.isPropertyAccessExpression(n.expression)
					? unwrap(n.expression.expression)
					: undefined
			} else if (ts.isPropertyAccessExpression(n)) {
				n = unwrap(n.expression)
			} else break
		}
		return false
	}

	const keysOf = (obj: ts.Node | undefined): ts.Node[] => {
		if (!obj) return []
		const o = unwrap(obj)
		if (ts.isArrayLiteralExpression(o)) return o.elements.flatMap(keysOf)
		if (!ts.isObjectLiteralExpression(o)) return []
		const keys: ts.Node[] = []
		for (const p of o.properties) {
			if (
				(ts.isPropertyAssignment(p) ||
					ts.isShorthandPropertyAssignment(p)) &&
				(ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))
			) {
				keys.push(p.name)
			}
		}
		return keys
	}

	const pushWrites = (table: GuardTable, obj: ts.Node | undefined) => {
		for (const k of keysOf(obj)) {
			out.columns.push({
				table,
				column: (k as ts.Identifier | ts.StringLiteral).text,
				kind: "write",
				line: lineOf(k)
			})
		}
	}

	const objProp = (
		obj: ts.Node | undefined,
		name: string
	): ts.Expression | undefined => {
		if (!obj) return undefined
		const o = unwrap(obj)
		if (!ts.isObjectLiteralExpression(o)) return undefined
		for (const p of o.properties) {
			if (
				ts.isPropertyAssignment(p) &&
				(ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) &&
				p.name.text === name
			) {
				return p.initializer
			}
		}
		return undefined
	}

	const visit = (n: ts.Node) => {
		if (ts.isCallExpression(n)) {
			const name = callName(n)
			const first = n.arguments[0]

			if (name === "insert" || name === "update") {
				const t = resolveRef(first)
				if (t) {
					;(name === "insert" ? out.inserts : out.updates).push({
						table: t,
						line: lineOf(n)
					})
					if (t === "castAmendments") {
						out.columns.push({
							table: t,
							column: `(${name})`,
							kind: "write",
							line: lineOf(n)
						})
					}
				}
			}

			if (
				ts.isPropertyAccessExpression(n.expression) &&
				(name === "set" || name === "values")
			) {
				const t = chainTable(
					n.expression.expression,
					name === "set" ? "update" : "insert"
				)
				if (t) pushWrites(t, first)
			}
			if (
				ts.isPropertyAccessExpression(n.expression) &&
				name === "onConflictDoUpdate"
			) {
				const t = chainTable(n.expression.expression, "insert")
				if (t) pushWrites(t, objProp(first, "set"))
			}

			// relational query: <x>.query.<table>.findFirst / findMany
			if (
				ts.isPropertyAccessExpression(n.expression) &&
				(name === "findFirst" || name === "findMany")
			) {
				const target = unwrap(n.expression.expression)
				if (
					ts.isPropertyAccessExpression(target) &&
					ts.isPropertyAccessExpression(target.expression) &&
					target.expression.name.text === "query" &&
					TABLES.has(target.name.text)
				) {
					const t = target.name.text as GuardTable
					const cols = objProp(first, "columns")
					if (cols) {
						for (const k of keysOf(cols)) {
							out.columns.push({
								table: t,
								column: (k as ts.Identifier | ts.StringLiteral)
									.text,
								kind: "read",
								line: lineOf(k)
							})
						}
					} else if (t === "characters") {
						out.wholeRowReads.push({
							table: t,
							line: lineOf(n),
							how: `query.characters.${name}() without columns`
						})
					}
					const w = objProp(first, "with")
					const wc = w && unwrap(w)
					if (wc && ts.isObjectLiteralExpression(wc)) {
						const ch = objProp(wc, "character")
						if (ch) {
							const c = unwrap(ch)
							if (
								c.kind === ts.SyntaxKind.TrueKeyword ||
								(ts.isObjectLiteralExpression(c) &&
									!objProp(c, "columns"))
							) {
								out.wholeRowReads.push({
									table: "characters",
									line: lineOf(ch),
									how: `with: { character } on query.${t}`
								})
							}
						}
					}
				}
			}

			// whole-row select: select().from(characters) / .innerJoin(characters, …)
			if (
				ts.isPropertyAccessExpression(n.expression) &&
				[
					"from",
					"innerJoin",
					"leftJoin",
					"rightJoin",
					"fullJoin"
				].includes(name ?? "") &&
				resolveRef(first) === "characters" &&
				chainHasBareSelect(n.expression.expression)
			) {
				out.wholeRowReads.push({
					table: "characters",
					line: lineOf(n),
					how: `select().${name}(characters)`
				})
			}
			// whole-table projection: select({ c: characters })
			if (name === "select" && first) {
				const o = unwrap(first)
				if (ts.isObjectLiteralExpression(o)) {
					for (const p of o.properties) {
						const v = ts.isPropertyAssignment(p)
							? p.initializer
							: ts.isShorthandPropertyAssignment(p)
								? p.name
								: undefined
						if (v && resolveRef(v) === "characters") {
							out.wholeRowReads.push({
								table: "characters",
								line: lineOf(p),
								how: "select({ … characters … }) projects the whole table"
							})
						}
					}
				}
			}
		}

		// Column reads: <table ref>.<col>
		if (ts.isPropertyAccessExpression(n)) {
			const t = resolveRef(n.expression)
			if (t) {
				out.columns.push({
					table: t,
					column: n.name.text,
					kind: "read",
					line: lineOf(n.name)
				})
			}
		}

		// Raw SQL text.
		const literalText =
			ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)
				? n.text
				: ts.isTemplateHead(n) ||
					  ts.isTemplateMiddle(n) ||
					  ts.isTemplateTail(n)
					? n.text
					: undefined
		if (literalText !== undefined) {
			const re =
				/insert\s+into\s+(?:"?public"?\.)?"?(lorebook_bindings|characters|character_versions)"?(?![\w])/gi
			for (let m = re.exec(literalText); m; m = re.exec(literalText)) {
				out.sqlInserts.push({
					table: SQL_TABLE_NAMES[m[1].toLowerCase()],
					line: lineOf(n)
				})
			}
			const col =
				/(?<![\w])"?(lorebook_bindings|characters)"?\."?([a-z_]+)"?/g
			for (let m = col.exec(literalText); m; m = col.exec(literalText)) {
				out.columns.push({
					table: SQL_TABLE_NAMES[m[1]],
					// stored as the snake name prefixed so callers can map it back
					column: `sql:${m[2]}`,
					kind: "read",
					line: lineOf(n)
				})
			}
		}

		ts.forEachChild(n, visit)
	}
	visit(sf)

	return out
}

/** Map a raw-SQL `sql:<snake>` column back to the camel property name, if it is in `names`. */
export function sqlColumnToProp(
	column: string,
	names: readonly string[]
): string | undefined {
	if (!column.startsWith("sql:")) return undefined
	const s = column.slice(4)
	return names.find((n) => snake(n) === s)
}

export { snake }

/**
 * Every product `.ts` file under `src/`, repo-relative POSIX paths: no tests, no
 * attic, no schema definitions.
 */
export function listScanFiles(repoRoot: string): string[] {
	const files: string[] = []
	const walk = (dir: string) => {
		for (const e of readdirSync(dir, { withFileTypes: true })) {
			const full = join(dir, e.name)
			if (e.isDirectory()) {
				if (e.name === "node_modules") continue
				walk(full)
			} else if (
				e.name.endsWith(".ts") &&
				!e.name.endsWith(".d.ts") &&
				!/\.(test|spec)\.ts$/.test(e.name)
			) {
				files.push(relative(repoRoot, full).split(sep).join("/"))
			}
		}
	}
	walk(join(repoRoot, "src"))
	return files
		.filter(
			(f) =>
				!f.startsWith("src/lib/server/attic/") &&
				f !== "src/lib/server/db/schema.ts"
		)
		.sort()
}

export function scanAll(repoRoot: string): Map<string, ScanResult> {
	const m = new Map<string, ScanResult>()
	for (const f of listScanFiles(repoRoot)) {
		m.set(f, scanSource(f, readFileSync(join(repoRoot, f), "utf8")))
	}
	return m
}
