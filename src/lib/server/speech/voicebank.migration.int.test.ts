/**
 * Migration 0129 (speech voicebank) applied on top of a database that sits at 0128
 * with rows in it: the table, its foreign key, its 3 indexes and
 * `system_settings.keep_spoken_audio` appear; the earlier rows survive.
 * Later migrations (0130 and on; 0135/0136 swap the model column for a loadout) are applied in the same second pass and must not undo it.
 */
import { afterAll, describe, expect, test, vi } from "vitest"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { migrate } from "drizzle-orm/pglite/migrator"
import path from "path"
import { sql } from "drizzle-orm"
import { migrationsFolderThrough } from "$lib/server/utils/testDb"
import { rawRows } from "$lib/server/db/rawRows"

// DB setup under load.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

const disposers: Array<() => Promise<void>> = []
afterAll(async () => {
	for (const d of disposers) await d()
})

describe("migration 0129_speech_voicebank", () => {
	test("adds voicebank_voices (FK, 3 indexes) and system_settings.keep_spoken_audio; earlier rows survive", async () => {
		const client = new PGlite()
		const db = drizzle(client)
		const upTo = await migrationsFolderThrough("0128_pr6s2_core_annex")
		disposers.push(upTo.dispose)
		await migrate(db, { migrationsFolder: upTo.folder })

		const before = async (q: string) => rawRows<any>(await db.execute(sql.raw(q)))
		expect((await before(`select 1 from information_schema.tables where table_name='voicebank_voices'`)).length).toBe(0)
		expect((await before(`select 1 from information_schema.columns where table_name='system_settings' and column_name='keep_spoken_audio'`)).length).toBe(0)

		await db.execute(sql`insert into users (id, username) values (9001, 'mig-survivor')`)
		const ss = await before(`select count(*)::int as n from system_settings`)
		if (ss[0].n === 0) await db.execute(sql`insert into system_settings default values`)
		const settingsBefore = (await before(`select count(*)::int as n from system_settings`))[0].n

		await migrate(db, { migrationsFolder: path.resolve(process.cwd(), "drizzle") })

		const q = async (s: string) => rawRows<any>(await db.execute(sql.raw(s)))
		const cols = await q(
			`select column_name, data_type, is_nullable, column_default from information_schema.columns where table_name='voicebank_voices' order by ordinal_position`
		)
		expect(cols.map((c) => c.column_name)).toEqual([
			"id", "slug", "name", "description", "owner", "seed_key",
			"voice_id", "language", "settings", "labels", "enabled", "created_at", "updated_at", "loadout_id"
		])
		expect(cols.find((c) => c.column_name === "owner").column_default).toContain("pub")
		expect(cols.find((c) => c.column_name === "enabled").column_default).toBe("true")
		// 0138: both stars are gone (the loadout voice replaced them).
		expect(cols.map((c) => c.column_name)).not.toContain("is_default")
		expect(cols.map((c) => c.column_name)).not.toContain("is_narration_default")

		const fk = await q(
			`select ccu.table_name as ref_table, rc.delete_rule from information_schema.referential_constraints rc
			 join information_schema.table_constraints tc on tc.constraint_name = rc.constraint_name
			 join information_schema.constraint_column_usage ccu on ccu.constraint_name = rc.unique_constraint_name
			 where tc.table_name='voicebank_voices'`
		)
		// 0135/0136: the entry speaks through a loadout; the model column is gone.
		expect(fk).toEqual([{ ref_table: "loadouts", delete_rule: "SET NULL" }])

		const idx = (await q(`select indexname from pg_indexes where tablename='voicebank_voices'`)).map((r) => r.indexname)
		expect(idx).toEqual(expect.arrayContaining([
			"voicebank_voices_owner_slug_unique",
			"voicebank_voices_loadout_idx"
		]))
		expect(idx).not.toContain("voicebank_voices_connection_model_idx")
		expect(idx).not.toContain("voicebank_voices_one_default")

		const keep = await q(
			`select column_default, is_nullable from information_schema.columns where table_name='system_settings' and column_name='keep_spoken_audio'`
		)
		expect(keep[0].column_default).toContain("forever")
		expect(keep[0].is_nullable).toBe("NO")
		// Rows that predate the column took the default.
		const kept = await q(`select keep_spoken_audio from system_settings`)
		expect(kept.length).toBe(settingsBefore)
		expect(kept.every((r) => r.keep_spoken_audio === "forever")).toBe(true)
		expect((await q(`select 1 from users where username='mig-survivor'`)).length).toBe(1)

		// 0137: a loadout's voice points at an entry and falls to NULL when it goes.
		const lcols = (await q(`select column_name from information_schema.columns where table_name='loadouts'`)).map((c) => c.column_name)
		expect(lcols).toEqual(expect.arrayContaining(["default_voice_id", "other_speakers_voice_id"]))

		// Journal order: report the highest applied tag.
		const journal = (await import("fs")).readFileSync(path.resolve(process.cwd(), "drizzle/meta/_journal.json"), "utf8")
		const tags = (JSON.parse(journal).entries as Array<{ tag: string }>).map((e) => e.tag)
		expect(tags).toContain("0129_speech_voicebank")
		await client.close()
	})
})
