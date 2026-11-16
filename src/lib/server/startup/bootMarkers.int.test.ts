/**
 * Boot markers (★P9): a one-off startup task runs once, a clean run writes its
 * key, the next boot skips it with one log line and changes nothing, a cleared
 * key re-runs it, and a throw writes no key.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { sql } from "drizzle-orm"
import { rawRows } from "$lib/server/db/rawRows"
import * as schema from "$lib/server/db/schema"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import {
	readBootMarkers,
	runWithBootMarker,
	writeBootMarker
} from "$lib/server/startup/bootMarkers"
import { seatMembers } from "$lib/server/sessions/seatMembers"
import { liftCharacterVersions } from "$lib/server/characters/versionsLift"
import { deletedCardMembers } from "$lib/server/cast/deletedCardMembers"
import { dcCairns } from "$lib/server/sessions/dcCairns"

let db: TestDb

beforeAll(async () => {
	db = await createTestDb()
	// As `db/defaults.ts` seeds the single row.
	const row = await db.query.systemSettings.findFirst({
		where: (s, { eq }) => eq(s.id, 1)
	})
	if (!row) await db.insert(schema.systemSettings).values({ id: 1 })
}, 60_000)

afterAll(async () => {
	await (db as any).$client?.close?.()
})

const TABLES = [
	"session_seats",
	"cast_members",
	"cast_member_versions",
	"cards",
	"card_versions",
	"lorebook_entries",
	"session_messages"
]

/** Row counts of what the tasks write; tables a build lacks count as -1. */
async function snapshot(): Promise<Record<string, number>> {
	const out: Record<string, number> = {}
	for (const t of TABLES) {
		const exists = rawRows<any>(
			await db.execute(
				sql.raw(`SELECT to_regclass('public.${t}') IS NOT NULL AS ok`)
			)
		)[0].ok
		out[t] = exists
			? rawRows<any>(
					await db.execute(
						sql.raw(`SELECT count(*)::int AS n FROM ${t}`)
					)
				)[0].n
			: -1
	}
	return out
}

const clear = (key: string) =>
	db.execute(
		sql`UPDATE system_settings SET boot_markers = boot_markers - ${key}::text WHERE id = 1`
	)

const TASKS: Array<[string, () => Promise<unknown>]> = [
	["seat-members", () => seatMembers(db)],
	["character-versions", () => liftCharacterVersions(db)],
	["deleted-card-members", () => deletedCardMembers(db)],
	["dc-cairns", () => dcCairns(db)]
]

describe.each(TASKS)("boot marker %s", (key, real) => {
	const make = () =>
		vi.fn(async () => {
			await real()
		})
	const task = (run: () => Promise<void>) => ({
		name: key,
		doneMarker: key,
		run
	})

	it("runs on the first boot and writes an ISO key", async () => {
		await clear(key)
		const run = make()
		await runWithBootMarker(db, task(run))
		expect(run).toHaveBeenCalledTimes(1)
		const at = (await readBootMarkers(db))[key]
		expect(new Date(at).toISOString()).toBe(at)
	}, 60_000)

	it("skips on the second boot with one line and changes nothing", async () => {
		const before = await readBootMarkers(db)
		const snap = await snapshot()
		const run = make()
		const log = vi.spyOn(console, "log").mockImplementation(() => {})
		try {
			await runWithBootMarker(db, task(run))
			expect(run).not.toHaveBeenCalled()
			const lines = log.mock.calls
				.map((c) => String(c[0]))
				.filter((l) => l.startsWith(`[${key}] skipped`))
			expect(lines).toEqual([
				`[${key}] skipped: done ${before[key]} (boot marker ${key})`
			])
		} finally {
			log.mockRestore()
		}
		expect(await readBootMarkers(db)).toEqual(before)
		expect(await snapshot()).toEqual(snap)
	}, 60_000)

	it("re-runs once the key is cleared and writes it again", async () => {
		await clear(key)
		expect((await readBootMarkers(db))[key]).toBeUndefined()
		const run = make()
		await runWithBootMarker(db, task(run))
		expect(run).toHaveBeenCalledTimes(1)
		expect((await readBootMarkers(db))[key]).toBeTypeOf("string")
	}, 60_000)

	it("writes no key when run throws, and the error reaches the caller", async () => {
		await clear(key)
		const run = vi.fn(async () => {
			throw new Error("1 unit failed")
		})
		await expect(runWithBootMarker(db, task(run))).rejects.toThrow(
			"1 unit failed"
		)
		expect((await readBootMarkers(db))[key]).toBeUndefined()
	}, 60_000)
})

describe("writeBootMarker", () => {
	it("merges: two keys both stay", async () => {
		await writeBootMarker(db, "a-test", new Date("2026-01-01T00:00:00Z"))
		await writeBootMarker(db, "b-test", new Date("2026-01-02T00:00:00Z"))
		const m = await readBootMarkers(db)
		expect(m["a-test"]).toBe("2026-01-01T00:00:00.000Z")
		expect(m["b-test"]).toBe("2026-01-02T00:00:00.000Z")
		await clear("a-test")
		await clear("b-test")
	}, 60_000)
})
