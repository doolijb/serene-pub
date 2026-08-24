/**
 * Round-9 audit fix (MEDIUM): the SillyTavern bulk-folder import had no
 * entry-count cap on any of its 4 unbounded loops (embedded character_book
 * entries, world-info entries, individual-session messages, group-session
 * messages) — unlike lorebooks:import, which already enforces
 * LOREBOOK_IMPORT_LIMITS for the exact same reason. A crafted "backup" with
 * an oversized file could drive hundreds of thousands of sequential
 * single-row inserts. assertWithinBulkImportLimit is the shared guard now
 * called right before each of those 4 loops; each call site is wrapped in
 * the same per-item try/catch every other import failure already goes
 * through, so a thrown limit error is absorbed as one item's error rather
 * than aborting the whole batch.
 */
import { describe, expect, test, vi } from "vitest"
import { assertWithinBulkImportLimit, MAX_BULK_IMPORT_ITEMS } from "./import"

// Pure-function test — doesn't touch the DB at all — but import.ts imports
// the real `db` at module scope, which otherwise triggers a real
// connection/lock-check against the on-disk dev database purely as an
// import side effect. A bare stub (not a real createTestDb() PGlite
// instance — nothing here ever calls it, and spinning up a real instance
// per test file risks a WASM-level crash from multiple concurrent PGlite
// instances in the same worker) is enough to short-circuit that import.
vi.mock("$lib/server/db", () => ({ db: {} }))

describe("assertWithinBulkImportLimit", () => {
	test("does not throw at or under the limit", () => {
		expect(() =>
			assertWithinBulkImportLimit(MAX_BULK_IMPORT_ITEMS, "Test item")
		).not.toThrow()
		expect(() => assertWithinBulkImportLimit(0, "Test item")).not.toThrow()
	})

	test("throws a descriptive error one over the limit", () => {
		expect(() =>
			assertWithinBulkImportLimit(
				MAX_BULK_IMPORT_ITEMS + 1,
				'Character "Evil"\'s embedded lorebook'
			)
		).toThrow(/Character "Evil"'s embedded lorebook.*too many items/)
	})
})
