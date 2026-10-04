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
 * The constant below is the sha256 of `drizzle/0093_green_bushwacker.sql`, the
 * last migration 0.5.3 shipped, as every 0.5.3 install's ledger recorded it.
 * That file can never change again: an upgrading install is matched to it by
 * this hash. If this test fails, exactly one of two things happened:
 *
 *   - that migration file was edited, in which case it can no longer be matched
 *     to any row already written from it, and every 0.5.3 install is cut off
 *     from the upgrade; or
 *   - the hashing changed, in which case the repair is inert and every install
 *     on a poisoned ledger stays there.
 */

import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { readJournalMigrations } from "./migrationLedgerRepair"

const FOLDER = resolve(process.cwd(), "drizzle")
const TAG = "0093_green_bushwacker"

/** The hash drizzle wrote for this file on every 0.5.3 install. */
const KNOWN_HASH =
	"492c53227102374f0158a8c57144e7ebdc7ec89c8a4895a3f51689df76d63c41"
const KNOWN_WHEN = 1786511598724

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
		// splits the file into, rather than the file. Only a file that holds
		// markers can tell the two apart.
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
