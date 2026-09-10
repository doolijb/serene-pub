/**
 * The hashing scheme the repair matches ledger rows by.
 *
 * A ledger row records only a hash and a `created_at` — no tag, no index — so
 * the *only* way to say which migration file a row belongs to is to reproduce
 * the hash drizzle wrote. Get that even slightly wrong (hash the statements
 * rather than the file, normalise a line ending, strip the trailing newline)
 * and nothing matches, the repair reports zero rows and returns cheerfully, and
 * the database stays stuck. A silent no-op is the failure mode this file
 * exists to make impossible.
 *
 * The constant below is the sha256 of `drizzle/0100_narration_split_reprojection.sql`
 * as it ships, and it is the hash of the row sitting in the reported install's
 * ledger. If this test fails, exactly one of two things happened:
 *
 *   - that migration file was edited, in which case it can no longer be matched
 *     to any row already written from it, and the constant needs updating
 *     alongside a hard look at why an applied migration was rewritten; or
 *   - the hashing changed, in which case the repair is inert and every install
 *     still on a poisoned ledger stays there.
 */

import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { readJournalMigrations } from "./migrationLedgerRepair"

const FOLDER = resolve(process.cwd(), "drizzle")
const TAG = "0100_narration_split_reprojection"

/** The hash drizzle wrote for this file on the install that got stuck. */
const KNOWN_HASH =
	"b4a4af2847c057dfd2e62007c12951e71e76ae8b6dd2d7e38098aa032c0bcb99"
const KNOWN_WHEN = 1788827887780

describe("readJournalMigrations", () => {
	it("reproduces the hash a real ledger row was written with", () => {
		const entry = readJournalMigrations(FOLDER).find((m) => m.tag === TAG)
		expect(entry).toBeDefined()
		expect(entry!.hash).toBe(KNOWN_HASH)
		expect(entry!.when).toBe(KNOWN_WHEN)
	})

	it("hashes the raw file, byte for byte", () => {
		// Stated independently of drizzle so a change in *its* scheme shows up
		// here as a disagreement rather than as two matching wrong answers.
		const raw = readFileSync(resolve(FOLDER, `${TAG}.sql`)).toString()
		expect(createHash("sha256").update(raw).digest("hex")).toBe(KNOWN_HASH)
	})

	it("keeps the breakpoint markers inside the hashed text", () => {
		// The near-miss worth ruling out: hashing the *statements* drizzle
		// splits the file into, rather than the file. 0100 happens to contain
		// no markers, so it cannot tell the two apart — a file that does is
		// what makes the distinction visible.
		const withBreakpoints = readJournalMigrations(FOLDER).find((m) =>
			readFileSync(resolve(FOLDER, `${m.tag}.sql`))
				.toString()
				.includes("--> statement-breakpoint")
		)
		expect(withBreakpoints).toBeDefined()

		const raw = readFileSync(
			resolve(FOLDER, `${withBreakpoints!.tag}.sql`)
		).toString()
		const stripped = raw.split("--> statement-breakpoint").join("")
		expect(createHash("sha256").update(raw).digest("hex")).toBe(
			withBreakpoints!.hash
		)
		expect(createHash("sha256").update(stripped).digest("hex")).not.toBe(
			withBreakpoints!.hash
		)
	})

	it("covers every journal entry, in journal order", () => {
		const journal = JSON.parse(
			readFileSync(resolve(FOLDER, "meta/_journal.json"), "utf8")
		) as { entries: { tag: string; when: number }[] }
		const read = readJournalMigrations(FOLDER)

		// Tags come from the journal and hashes from `readMigrationFiles`,
		// which are two separate reads of the same file zipped by index. If
		// they ever drift apart, every tag in a log line is a lie.
		expect(read.map((m) => m.tag)).toEqual(
			journal.entries.map((e) => e.tag)
		)
		expect(read.map((m) => m.when)).toEqual(
			journal.entries.map((e) => e.when)
		)
		expect(new Set(read.map((m) => m.hash)).size).toBe(read.length)
	})
})
