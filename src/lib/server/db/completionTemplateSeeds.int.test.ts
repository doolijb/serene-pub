/**
 * The built-in completion templates are seeded from one constant.
 *
 * `seedCompletionTemplates` (called by `db/defaults.ts` on every boot, and by
 * `createTestDb`) writes the rows from `BUILTIN_COMPLETION_TEMPLATES`. Nothing
 * at runtime compares the rows with the constant, and the symptom of
 * disagreement is a prompt wrapped in delimiters whose stop strings belong to
 * a different format: the model never stops, and it reads as a bad model
 * rather than a bad row.
 *
 * ## Its own file, with its own database, deliberately
 *
 * These started inside `defaults.seedKey.int.test.ts`, which shares one database
 * across every test in it. They were **vacuous there** and it took a mutation to
 * show it: that file's accumulated state can make `sync()` throw partway through
 * the sampling seeds, and everything after — context configs, prompts, these
 * templates — is skipped by the surrounding `catch`. The assertions still passed,
 * because the rows `createTestDb` wrote already match the constant, so a `sync()`
 * that never ran the block it was testing looked exactly like one that did.
 *
 * So `syncReachedTheTemplates` below runs FIRST and proves the block executes,
 * by deleting a row and requiring `sync()` to put it back. Every assertion after
 * it is describing work that actually happened.
 */
import { beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { BUILTIN_COMPLETION_TEMPLATES } from "$lib/shared/constants/completionTemplates"

let testDb: TestDb

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	const dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-template-seed-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

const sync = async () => (await import("./defaults")).sync()

const templates = () =>
	testDb
		.select()
		.from(schema.completionTemplates)
		.orderBy(schema.completionTemplates.key)

describe("completion templates seed identically from both sources", () => {
	test("syncReachedTheTemplates — the guard the rest of this file rests on", async () => {
		// ⚠ Without this, every assertion below could be describing the rows the
		// MIGRATION wrote while `sync()` silently never got to them.
		await testDb
			.delete(schema.completionTemplates)
			.where(eq(schema.completionTemplates.key, "chatml"))
		expect((await templates()).length).toBe(
			BUILTIN_COMPLETION_TEMPLATES.length - 1
		)

		await sync()

		expect((await templates()).map((r) => r.key)).toContain("chatml")
	}, 60_000)

	test("sync() writes exactly the framing the renderer uses", async () => {
		// Pinned to `BUILTIN_COMPLETION_TEMPLATES`, the constant the renderer
		// reads too.
		await sync()

		const rows = await templates()
		expect(rows.length).toBe(BUILTIN_COMPLETION_TEMPLATES.length)

		const byKey = new Map(rows.map((r) => [r.key, r]))
		for (const t of BUILTIN_COMPLETION_TEMPLATES) {
			const row = byKey.get(t.key)
			expect(row, `${t.key} was not seeded`).toBeTruthy()
			expect(row!.seedKey).toBe(`completion-template-${t.key}`)
			expect(row!.name).toBe(t.name)
			expect(row!.renderMode).toBe(t.renderMode)
			expect(row!.isSelectable).toBe(t.isSelectable)
			expect(row!.roles).toEqual(t.roles)
			expect(row!.fallbackRole).toEqual(t.fallbackRole)
			expect(row!.stopStrings).toEqual(t.stopStrings)
		}
	}, 60_000)

	test("running sync() twice does not duplicate the built-ins", async () => {
		await sync()
		await sync()

		const rows = await templates()
		expect(rows.length).toBe(BUILTIN_COMPLETION_TEMPLATES.length)
		for (const t of BUILTIN_COMPLETION_TEMPLATES)
			expect(
				rows.filter((r) => r.key === t.key),
				`${t.key} appears more than once`
			).toHaveLength(1)
	}, 60_000)

	test("a seeded template edited in place is restored by the next sync", async () => {
		/**
		 * ⚠ This is why every seeded row MUST be immutable, and it is a fact
		 * about the data rather than a preference.
		 *
		 * The update branch is `set({ ...data, id: undefined })` — a seed's full
		 * contents, re-applied on every boot. The only thing standing between
		 * that and a user losing their edits on every restart is that the server
		 * refuses an edit to an immutable row in the first place. This test is
		 * the demonstration; the assertion after it is the guarantee.
		 */
		await sync()
		const [before] = await testDb
			.select()
			.from(schema.completionTemplates)
			.where(eq(schema.completionTemplates.key, "chatml"))

		await testDb
			.update(schema.completionTemplates)
			.set({
				name: "tampered",
				roles: { user: { prefix: "X", suffix: "Y" } },
				stopStrings: ["nope"]
			})
			.where(eq(schema.completionTemplates.id, before.id))

		await sync()

		const [after] = await testDb
			.select()
			.from(schema.completionTemplates)
			.where(eq(schema.completionTemplates.id, before.id))
		expect(after.name).toBe("ChatML")
		expect(after.roles).toEqual(before.roles)
		expect(after.stopStrings).toEqual(before.stopStrings)
		expect(after.id).toBe(before.id) // the same row, not a new one
	}, 60_000)

	test("every seeded template is immutable, which is what makes that safe", async () => {
		await sync()

		for (const r of await templates()) {
			expect(r.isImmutable, `${r.key} is not immutable`).toBe(true)
			// The pairing the sampling seeds hold to: seedKey iff built-in. The
			// incident that produced `seedKey` made a row that was flagged
			// immutable while belonging to a user, which is what made it
			// unrepairable through the UI.
			expect(!!r.seedKey).toBe(r.isImmutable)
		}
	}, 60_000)

	test("a user's own template survives sync() byte-for-byte", async () => {
		// `seedKey: null` is what keeps a user's row out of the sync entirely.
		const [mine] = await testDb
			.insert(schema.completionTemplates)
			.values({
				seedKey: null,
				key: "my-metharme",
				name: "My Metharme",
				isImmutable: false,
				renderMode: "flat",
				roles: { user: { prefix: "<|user|>", suffix: "\n" } },
				fallbackRole: { prefix: "<|system|>", suffix: "\n" },
				stopStrings: ["<|user|>"],
				isSelectable: true
			})
			.returning()

		await sync()

		const [after] = await testDb
			.select()
			.from(schema.completionTemplates)
			.where(eq(schema.completionTemplates.id, mine.id))
		expect(after).toEqual(mine)
		expect(after.seedKey).toBeNull()
	}, 60_000)
})
