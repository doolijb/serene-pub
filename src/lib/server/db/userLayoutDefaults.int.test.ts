/**
 * A person's **new-session layout** per genre — `user_layout_defaults`, kept
 * by brief 2 of `PLAN-layout-one-format-2026-09-28` (owner L4) and ported here
 * from the retired `layoutPresetsV2.int.test.ts`.
 *
 * What matters: a person can only choose a row they may see, one row per
 * (person, genre), and deleting the chosen row nulls the choice (`SET NULL`)
 * rather than leaving a dangling id.
 */
import { beforeAll, describe, expect, test, vi } from "vitest"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

let testDb: TestDb

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

let n = 0
/** A genre id nothing else in this file touches. */
const freshGenre = () => `test:genre/new-session-${n++}`

const user = async (label: string) => {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, `uld-${label}-${n++}`)
}

const layoutNaming = (widget: string) => ({
	zoneLayout: { version: 1, zones: { right: { widgets: [widget] } } }
})

describe("a person's new-session layout", () => {
	test(
		"refuses a preset the caller cannot see, and is nulled when its preset is deleted",
		async () => {
			const genreId = freshGenre()
			const owner = await user("owner")
			const stranger = await user("stranger")
			const { saveUserLayoutPreset, deleteUserLayoutPreset } = await import(
				"./layoutPresets"
			)
			const { setUserLayoutDefault, getUserLayoutDefault } = await import(
				"./userLayoutDefaults"
			)

			const secret = await saveUserLayoutPreset({
				genreId,
				userId: stranger.id,
				name: "Secret",
				layout: layoutNaming("secret")
			})
			const refused = await setUserLayoutDefault({
				userId: owner.id,
				genreId,
				presetId: secret.id
			})
			expect(refused.ok).toBe(false)
			expect(await getUserLayoutDefault(owner.id, genreId)).toBeNull()

			const own = await saveUserLayoutPreset({
				genreId,
				userId: owner.id,
				name: "Preferred",
				layout: layoutNaming("preferred")
			})
			const set = await setUserLayoutDefault({
				userId: owner.id,
				genreId,
				presetId: own.id
			})
			expect(set.ok).toBe(true)
			expect(await getUserLayoutDefault(owner.id, genreId)).toBe(own.id)

			// Deleting the preset it names nulls the FK: new sessions start
			// from the genre default layout again, not from nothing.
			await deleteUserLayoutPreset({ presetId: own.id, userId: owner.id })
			expect(await getUserLayoutDefault(owner.id, genreId)).toBeNull()
		},
		60_000
	)

	test(
		"refuses a preset from another genre",
		async () => {
			const genreId = freshGenre()
			const elsewhere = freshGenre()
			const owner = await user("genre")
			const { saveUserLayoutPreset } = await import("./layoutPresets")
			const { setUserLayoutDefault } = await import("./userLayoutDefaults")
			const other = await saveUserLayoutPreset({
				genreId: elsewhere,
				userId: owner.id,
				name: "Elsewhere",
				layout: {}
			})
			const refused = await setUserLayoutDefault({
				userId: owner.id,
				genreId,
				presetId: other.id
			})
			expect(refused.ok).toBe(false)
		},
		60_000
	)

	test(
		"setting it twice keeps one row, and null clears it",
		async () => {
			const genreId = freshGenre()
			const owner = await user("twice")
			const { saveUserLayoutPreset } = await import("./layoutPresets")
			const { setUserLayoutDefault, getUserLayoutDefault } = await import(
				"./userLayoutDefaults"
			)
			const a = await saveUserLayoutPreset({
				genreId,
				userId: owner.id,
				name: "A",
				layout: layoutNaming("a")
			})
			const b = await saveUserLayoutPreset({
				genreId,
				userId: owner.id,
				name: "B",
				layout: layoutNaming("b")
			})
			await setUserLayoutDefault({ userId: owner.id, genreId, presetId: a.id })
			await setUserLayoutDefault({ userId: owner.id, genreId, presetId: b.id })
			const rows = await testDb
				.select()
				.from(schema.userLayoutDefaults)
				.where(
					and(
						eq(schema.userLayoutDefaults.userId, owner.id),
						eq(schema.userLayoutDefaults.genreId, genreId)
					)
				)
			expect(rows.length).toBe(1)
			expect(rows[0].layoutPresetId).toBe(b.id)

			const cleared = await setUserLayoutDefault({
				userId: owner.id,
				genreId,
				presetId: null
			})
			expect(cleared.ok).toBe(true)
			expect(await getUserLayoutDefault(owner.id, genreId)).toBeNull()
		},
		60_000
	)
})
