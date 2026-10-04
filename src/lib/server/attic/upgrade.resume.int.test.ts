/**
 * The 0.5.3 upgrade fails safe and resumes (plan §4.3 E4.6, §6.2), over the
 * tiny fixture:
 *
 *   · a failure inside the restore rolls every row back and leaves the attic
 *     exactly as it was, and the next attempt restores cleanly;
 *   · a failure in the wiring, after the restore committed, leaves the attic
 *     for the next start, which skips the restore, finishes the wiring and
 *     drops it — with nothing written twice.
 */
import { beforeAll, describe, expect, test } from "vitest"
import { sql } from "drizzle-orm"
import { bootFixture, placeFixture, runUpgradeTasks } from "./testFixture"
import { ATTIC_SCHEMA, atticExists, atticRestoredAt } from "./index"

// Imported after the fixture is placed: the restore's modules open the app's
// database when they load.
let restoreFromAttic: typeof import("./restore").restoreFromAttic

let db: Db
const one = async (text: string) => ((await (db as any).$client.query(text)).rows[0] ?? {}) as Record<string, any>
const count = async (from: string) => Number((await one(`SELECT count(*)::int AS n FROM ${from}`)).n)

beforeAll(async () => {
	placeFixture("tiny")
	db = await bootFixture()
	;({ restoreFromAttic } = await import("./restore"))
	expect(await atticExists(db)).toBe(true)
}, 300_000)

describe("a failure inside the restore", () => {
	test("rolls everything back and keeps the attic", async () => {
		// A message whose chat does not exist: its session row cannot exist
		// either, so the insert fails partway through the restore.
		await db.execute(
			sql.raw(`INSERT INTO "${ATTIC_SCHEMA}".chat_messages (id, chat_id, role, content) VALUES (99999, 424242, 'user', 'orphan')`)
		)
		const usersBefore = await count("users")
		await expect(restoreFromAttic(db)).rejects.toThrow()

		expect(await atticExists(db)).toBe(true)
		expect(await atticRestoredAt(db)).toBeNull()
		expect(await count("sessions")).toBe(0)
		expect(await count("session_messages")).toBe(0)
		expect(await count("lorebook_entries")).toBe(0)
		expect(await count("users")).toBe(usersBefore)
		expect(await count(`"${ATTIC_SCHEMA}".chats`)).toBe(1)
	}, 120_000)

	test("the next attempt restores cleanly", async () => {
		await db.execute(sql.raw(`DELETE FROM "${ATTIC_SCHEMA}".chat_messages WHERE id = 99999`))
		const report = await restoreFromAttic(db)
		expect(report?.alreadyRestored).toBe(false)
		expect(report!.reconciliation.filter((l) => l.expected !== l.actual)).toEqual([])
		expect(await atticRestoredAt(db)).not.toBeNull()
		expect(await count("sessions")).toBe(1)
	}, 120_000)
})

describe("a failure in the wiring, after the restore committed", () => {
	test("leaves the attic, and the next start finishes without writing anything twice", async () => {
		// A prompt config somebody wrote, whose migrated configuration then
		// goes missing before the wiring checks for it.
		await db.execute(
			sql.raw(`INSERT INTO "${ATTIC_SCHEMA}".prompt_configs (id, name, system_prompt) VALUES (900, 'Mine', 'Speak plainly.')`)
		)
		const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
		await bootstrapPipelines(db)
		const marker = "migrated:core:spec/respond:900"
		expect(await count(`pipeline_configs WHERE seed_key = '${marker}'`)).toBe(1)
		await db.execute(sql.raw(`DELETE FROM pipeline_configs WHERE seed_key = '${marker}'`))

		const { finishAtticUpgrade } = await import("./finish")
		await expect(finishAtticUpgrade(db)).rejects.toThrow(/prompt_configs 900/)
		expect(await atticExists(db)).toBe(true)

		const sessions = await count("sessions")
		const characters = await count("characters")
		const again = await runUpgradeTasks(db)
		expect(again.restore?.alreadyRestored).toBe(true)
		expect(again.wiring).not.toBeNull()
		expect(await atticExists(db)).toBe(false)
		expect(await count(`pipeline_configs WHERE seed_key = '${marker}'`)).toBe(1)
		expect(await count("sessions")).toBe(sessions)
		expect(await count("characters")).toBe(characters)
	}, 300_000)
})
