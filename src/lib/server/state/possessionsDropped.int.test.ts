/**
 * `session_possessions` is gone (owner ruling 2026-09-27: "no one has it yet").
 *
 * Phase 3b retired possessions-as-edges onto the `inventory` list stat and kept
 * the table, a boot move and a retraction hook until the move was verified;
 * the owner ruled the wait unnecessary. What is left to prove is that the
 * table, its schema export and every reader are gone, and that the proposal
 * gate's CHECK no longer admits the retired `possession` kind.
 */

import { beforeAll, describe, expect, it } from "vitest"
import fs from "fs/promises"
import path from "path"
import { sql } from "drizzle-orm"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"

let db: TestDb

beforeAll(async () => {
	db = await createTestDb()
}, 60_000)

async function sourceFiles(dir: string): Promise<string[]> {
	const out: string[] = []
	for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name)
		if (entry.isDirectory()) out.push(...(await sourceFiles(full)))
		else if (/\.(ts|js|svelte)$/.test(entry.name) && !/\.test\.ts$/.test(entry.name))
			out.push(full)
	}
	return out
}

describe("session_possessions is dropped", () => {
	it("the table no longer exists after the migrations", async () => {
		const rows = await db.execute(
			sql`SELECT to_regclass('public.session_possessions') AS t`
		)
		const first = ((rows as any).rows ?? rows)[0]
		expect(first.t).toBeNull()
	}, 60_000)

	it("the schema exports no such table", () => {
		expect("sessionPossessions" in schema).toBe(false)
	})

	it("a held proposal can no longer be of the retired `possession` kind", async () => {
		const rows = await db.execute(
			sql`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'state_proposals_kind_check'`
		)
		const first = ((rows as any).rows ?? rows)[0]
		expect(first.def).toContain("'value'")
		expect(first.def).not.toContain("possession")
	}, 60_000)

	it("no source file reads it, moves it, or names the move", async () => {
		const root = path.resolve(__dirname, "../..")
		const offenders: string[] = []
		for (const file of await sourceFiles(root)) {
			const text = await fs.readFile(file, "utf8")
			if (/session_possessions|sessionPossessions|possessionsMove|movePossessionsToInventory|MOVED_NOTE/.test(text))
				offenders.push(path.relative(root, file))
		}
		expect(offenders).toEqual([])
	}, 60_000)
})
