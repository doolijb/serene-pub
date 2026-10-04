/**
 * A fresh install never touches the attic (owner ruling 2026-10-01, plan §4.1
 * gate 3): with no `attic_0_5_3` schema the restore and the wiring are one
 * catalog query each and write nothing. And 0.5's tables are gone from it —
 * `0095_schema_0_6_0` drops them (before the pr-1 squash a separate
 * `0097_retire_0_5_tables` did, archived in `ARCHIVE-drizzle-migrations-0094-0111-pr1`) — with the boot
 * seeding running clean against what is left.
 */
import { describe, expect, test, vi } from "vitest"
import { createTestDb } from "$lib/server/utils/testDb"

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb(), getCryptoSecretKey: () => "fresh-attic-test" }
})

describe("a fresh install", () => {
	test("has no attic, and the restore and the wiring do nothing", async () => {
		const db = await createTestDb()
		const { atticExists } = await import("./index")
		const { restoreFromAttic } = await import("./restore")
		const { finishAtticUpgrade } = await import("./finish")
		expect(await atticExists(db)).toBe(false)
		const users = await db.execute("SELECT count(*)::int AS n FROM users")
		expect(await restoreFromAttic(db)).toBeNull()
		expect(await finishAtticUpgrade(db)).toBeNull()
		expect(await atticExists(db)).toBe(false)
		expect(await db.execute("SELECT count(*)::int AS n FROM users")).toEqual(users)
		const notes = await db.execute(
			"SELECT count(*)::int AS n FROM admin_logbook WHERE object_type = 'data-upgrade'"
		)
		expect((notes.rows[0] as { n: number }).n).toBe(0)
	}, 120_000)

	test("has none of 0.5's tables or pointer columns, and seeds without them", async () => {
		const { db } = (await import("$lib/server/db")) as any
		const tables = await db.execute(`
			SELECT table_name FROM information_schema.tables
			WHERE table_schema = 'public' AND table_name = ANY(ARRAY[
				'context_configs', 'prompt_configs', 'narrator_prompt_configs',
				'world_summarize_configs', 'character_summarize_configs',
				'scene_summarize_configs', 'graph_build_configs',
				'world_lore_entries', 'character_lore_entries', 'history_entries',
				'session_lorebooks'
			])`)
		expect(tables.rows).toEqual([])
		const columns = await db.execute(`
			SELECT table_name, column_name FROM information_schema.columns
			WHERE table_schema = 'public'
				AND table_name IN ('sessions', 'user_settings', 'system_settings')
				AND (column_name LIKE 'active\\_%config\\_id'
					OR column_name LIKE 'default\\_%config\\_id'
					OR column_name IN ('prompt_config_id', 'narrator_prompt_config_id'))`)
		expect(columns.rows).toEqual([])

		// `sync()` reports a failure by logging it, not by throwing, so a
		// reference to a dropped table would pass silently without this.
		const errors = vi.spyOn(console, "error").mockImplementation(() => {})
		try {
			await (await import("$lib/server/db/defaults")).sync()
			expect(errors).not.toHaveBeenCalled()
		} finally {
			errors.mockRestore()
		}
		const [settings] = (
			await db.execute("SELECT count(*)::int AS n FROM system_settings")
		).rows as { n: number }[]
		expect(settings!.n).toBe(1)
	}, 120_000)
})
