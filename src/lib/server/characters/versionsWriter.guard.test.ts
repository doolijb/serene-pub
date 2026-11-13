/**
 * Guard 1 of 2 — `characters/versions.ts` is the one writer of three tables.
 *
 * > "A module owns its data and every write to it; peers use its contract
 * > (events, sockets, SDK ports), never its tables or internals. Two writers of
 * > one thing is a bug."  (P2)
 *
 * `lorebook_bindings`, `characters` and `character_versions` hold one thing — a
 * card or cast member and every version of it — and since S4 stage 1 only
 * `src/lib/server/characters/versions.ts` may INSERT into them. A second insert
 * site is how a card ends up with a current-version row that the version table
 * never heard of. The attic (`src/lib/server/attic/`) is exempt: it replays
 * 0.5.3 data and predates the module.
 *
 * ## What this asserts
 *
 *   - no call `<anything>.insert(<ref>)` where `<ref>` resolves to
 *     `lorebookBindings`, `characters` or `characterVersions`;
 *   - no string or template literal containing `INSERT INTO` + one of
 *     `lorebook_bindings`, `characters`, `character_versions` (quoted or not,
 *     any case).
 *
 * Both outside `versions.ts`. A table reference is resolved SYNTACTICALLY, per
 * file (see `guardScan.ts`): a namespace import of `db/schema`, a named import,
 * a local `const X = <ref>`, or `alias(<ref>, "…")`.
 *
 * ## Scope
 *
 * Every `src/**\/*.ts` except `*.test.ts` / `*.spec.ts`, `src/lib/server/attic/**`
 * and `db/schema.ts` (the definitions). Test FILES are out of scope — they build
 * fixtures, and product code is what the rule is about. Test HELPERS that are not
 * `.test.ts` (`pipelines/testing/fixtures.ts`, `utils/testDb.ts`) ARE scanned.
 *
 * ## Adding an exception
 *
 * Add `{ file, table, reason }` to `ALLOWED` — repo-relative POSIX path, no line
 * number, so edits don't break it. The list is checked in BOTH directions: an
 * entry whose site no longer exists fails and names itself for deletion. It is
 * empty on purpose; the answer to a finding is to move the insert into the
 * versions module, not to list it.
 *
 * ## Blind spots
 *
 * Raw SQL assembled from pieces (`"INSERT " + "INTO …"`), an insert through a
 * table handle passed as a parameter, and `db.execute(sql…)` built at runtime are
 * invisible to a syntactic scan.
 */

import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"
import { scanAll, scanSource, type GuardTable } from "./guardScan"

const ROOT = resolve(fileURLToPath(import.meta.url), "../../../../..")
const WRITER = "src/lib/server/characters/versions.ts"
const GUARDED: ReadonlySet<GuardTable> = new Set([
	"lorebookBindings",
	"characters",
	"characterVersions"
])

interface Allowed {
	file: string
	table: GuardTable
	reason: string
}

/** Empty on purpose — see the header. */
const ALLOWED: Allowed[] = []

interface Finding {
	file: string
	line: number
	table: GuardTable
	via: "insert()" | "INSERT INTO"
}

const findingsOf = (file: string, text: string): Finding[] => {
	const r = scanSource(file, text)
	return [
		...r.inserts
			.filter((h) => GUARDED.has(h.table))
			.map((h) => ({ file, ...h, via: "insert()" as const })),
		...r.sqlInserts
			.filter((h) => GUARDED.has(h.table))
			.map((h) => ({ file, ...h, via: "INSERT INTO" as const }))
	]
}

describe("versions.ts is the one writer of lorebook_bindings / characters / character_versions", () => {
	test("scanner positive controls", () => {
		const src = `
import * as schema from "$lib/server/db/schema"
import { characterVersions } from "$lib/server/db/schema"
const lb = schema.lorebookBindings
async function f(tx: any, db: any) {
	await tx.insert(schema.characters).values({})
	await db.insert(lb).values({})
	await tx.insert(characterVersions).values({})
	await tx.insert(schema.lorebookEntries).values({})
	await tx.execute("INSERT INTO character_versions (id) VALUES (1)")
}`
		const f = findingsOf("src/x.ts", src)
		expect(f.map((x) => `${x.table}:${x.via}`).sort()).toEqual([
			"characterVersions:INSERT INTO",
			"characterVersions:insert()",
			"characters:insert()",
			"lorebookBindings:insert()"
		])
		expect(
			findingsOf(
				"src/x.ts",
				`import * as schema from "$lib/server/db/schema"
tx.insert(schema.lorebookEntries)`
			)
		).toEqual([])
	})

	const all = scanAll(ROOT)
	const found: Finding[] = []
	for (const [file, r] of all) {
		if (file === WRITER) continue
		found.push(
			...r.inserts
				.filter((h) => GUARDED.has(h.table))
				.map((h) => ({ file, ...h, via: "insert()" as const })),
			...r.sqlInserts
				.filter((h) => GUARDED.has(h.table))
				.map((h) => ({ file, ...h, via: "INSERT INTO" as const }))
		)
	}
	const listed = (f: Finding) =>
		ALLOWED.some((a) => a.file === f.file && a.table === f.table)

	test("no insert outside versions.ts", () => {
		const bad = found
			.filter((f) => !listed(f))
			.map((f) => `${f.file}:${f.line} ${f.table} (${f.via})`)
		expect(bad, `insert outside ${WRITER}`).toEqual([])
	})

	test("every allowlist entry still has its site", () => {
		const stale = ALLOWED.filter(
			(a) => !found.some((f) => f.file === a.file && f.table === a.table)
		).map((a) => `${a.file} ${a.table}: ${a.reason}`)
		expect(stale, "stale allowlist entries — delete them").toEqual([])
	})
})
