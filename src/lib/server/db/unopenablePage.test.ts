/**
 * The page served while the database will not open.
 *
 * There is no hooks test to hang this off (`src/hooks.server.ts` has none), so
 * the renderer is asserted directly. What matters is that it needs *nothing* —
 * no database, no sockets, no Svelte, no network — because every one of those
 * is either unavailable or about to fail in the state it exists for, and that
 * it says the same three facts the boot log does: where the data is, where the
 * backups are, and that nothing was touched.
 *
 * This is the placeholder named in PLAN-pglite-recovery P0. The recovery page
 * that can actually restore a backup is P1, behind rulings not yet made.
 */
import { describe, expect, test } from "vitest"
import { DatabaseUnopenableError } from "./errors"
import { renderDatabaseUnopenablePage } from "./unopenablePage"

function error(overrides: Partial<DatabaseUnopenableError> = {}) {
	return new DatabaseUnopenableError({
		dataDir: "/home/ada/.local/share/SerenePub/data",
		dbPath: "/home/ada/.local/share/SerenePub/data/serene-pub.db",
		backupsDir: "/home/ada/.local/share/SerenePub/data/backups",
		backupCount: 2,
		newestBackup: "serene-pub-0.5.9-2026-02-02T00-00-00.tgz",
		lastShutdown: "unclean",
		cause: new Error("Aborted()"),
		...overrides
	})
}

async function body(err: DatabaseUnopenableError): Promise<string> {
	return await renderDatabaseUnopenablePage(err).text()
}

describe("the placeholder page", () => {
	test("answers 503, as HTML, uncached", () => {
		const response = renderDatabaseUnopenablePage(error())

		expect(response.status).toBe(503)
		expect(response.headers.get("content-type")).toContain("text/html")
		// A cached copy would outlive the fix and keep telling the owner their
		// database is broken after they had already restored it.
		expect(response.headers.get("cache-control")).toContain("no-store")
	})

	test("names the data directory, the backups and the documentation", async () => {
		const html = await body(error())

		expect(html).toContain("/home/ada/.local/share/SerenePub/data")
		expect(html).toContain("/home/ada/.local/share/SerenePub/data/backups")
		expect(html).toContain("serene-pub-0.5.9-2026-02-02T00-00-00.tgz")
		expect(html).toContain("docs/troubleshooting.md#database-wont-open")
		expect(html.toLowerCase()).toContain("nothing has been changed")
	})

	test("says so plainly when there is no backup to point at", async () => {
		const html = await body(error({ backupCount: 0, newestBackup: null }))

		expect(html).toContain("No backups")
		expect(html).not.toContain("serene-pub-0.5.9")
	})

	test("needs nothing but itself — no scripts, no external requests", async () => {
		const html = await body(error())

		expect(html).not.toContain("<script")
		expect(html).not.toContain("src=")
		expect(html).not.toContain("stylesheet")
	})

	test("escapes the paths it prints", async () => {
		const html = await body(
			error({ dataDir: `/tmp/<img src=x onerror="alert(1)">` })
		)

		expect(html).not.toContain("<img src=x")
		expect(html).toContain("&lt;img src=x")
	})
})
