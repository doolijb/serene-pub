/**
 * Two things that used to be enforced by a table and now have to be enforced on
 * purpose.
 *
 * Under three tables, "history has no priority" was a missing column and
 * "character lore is private" was a filter the pipeline path applied to one of
 * the three reads. Under one table every type has column-shaped access to
 * everything and every row comes back from one query, so both are now decisions
 * the read makes rather than facts the schema hands it.
 *
 * ⚠ **`priority` absent means no bonus, not "defaults to 1 and gets the
 * bonus".** `toLoreEntry` coalesces a missing priority to 1 — it always did,
 * for every source — and what stops that from becoming a bonus is that the
 * ranker's `history` band carries `priorityBonus: 0` and `priorityBoost` skips
 * `historyEntry`. Ungated, every prompt containing history changes, which is
 * exactly the kind of change a green parity suite would not notice.
 */

import { describe, it, expect, beforeAll } from "vitest"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import { createHost } from "$lib/server/pipelines/runtime/host"
import * as schema from "$lib/server/db/schema"
import {
	characterLoreValues,
	historyValues,
	worldLoreValues
} from "$lib/server/pipelines/testing/fixtures"
import { mergeFields } from "$lib/server/utils/lorebookEntries"
import { eq } from "drizzle-orm"

let db: TestDb
let sessionId: number
let userId: number
let lorebookId: number
let ash: number
let bran: number
let historyId: number

const node = {
	key: "lore",
	typeId: "core:query/lorebook-triggers",
	typeVersion: 1,
	kind: "query" as const
}

const readAs = async (currentCharacterId: number | null) => {
	const host = createHost(db as any, { sessionId, userId })
	return (await host.read!(
		"lorebook_entries",
		{ sessionId, currentCharacterId },
		node
	)) as any[]
}

beforeAll(async () => {
	db = await createTestDb()

	const [user] = await db
		.insert(schema.users)
		.values({ username: "entry-semantics-test", isAdmin: false })
		.returning()
	userId = user.id

	const [lorebook] = await db
		.insert(schema.lorebooks)
		.values({ name: "Entry Semantics Lore", userId })
		.returning()
	lorebookId = lorebook.id

	const [session] = await db
		.insert(schema.sessions)
		.values({ userId, isGroup: false, lorebookId })
		.returning()
	sessionId = session.id

	const cast = await db
		.insert(schema.characters)
		.values([
			{ userId, name: "Ash", description: "a rider" },
			{ userId, name: "Bran", description: "a smith" }
		])
		.returning()
	ash = cast[0]!.id
	bran = cast[1]!.id

	const [ashBinding] = await db
		.insert(schema.lorebookBindings)
		.values({ lorebookId, characterId: ash, binding: "{{char:1}}" })
		.returning()
	// Bound to nobody: a background row, which the rule reserves for the
	// omniscient narrator.
	const [npcBinding] = await db
		.insert(schema.lorebookBindings)
		.values({ lorebookId, binding: "{{char:2}}" })
		.returning()

	await db.insert(schema.lorebookEntries).values(
		worldLoreValues([
			{
				lorebookId,
				name: "The Ashguard",
				keys: "ashguard",
				content: "An order of oathbound riders.",
				priority: 3
			}
		])
	)
	await db.insert(schema.lorebookEntries).values(
		characterLoreValues([
			{
				lorebookId,
				lorebookBindingId: ashBinding.id,
				name: "Ash's secret",
				keys: "secret",
				content: "Ash opened the lower gate."
			},
			{
				lorebookId,
				lorebookBindingId: npcBinding.id,
				name: "The gatekeeper",
				keys: "gate",
				content: "Nobody remembers who hired them."
			},
			// Anchored to nothing at all: invisible in every mode, narrator
			// included, because there is no legitimate consumer for it.
			{
				lorebookId,
				name: "Orphaned lore",
				keys: "orphan",
				content: "Bound to no one."
			}
		])
	)
	const [history] = await db
		.insert(schema.lorebookEntries)
		.values(
			historyValues([
				{
					lorebookId,
					keys: "siege",
					content: "The siege broke in the spring.",
					year: 412
				}
			])
		)
		.returning()
	historyId = history.id
}, 60_000)

describe("character lore is private self-knowledge, and the one read enforces it", () => {
	const names = (rows: any[]) =>
		rows.filter((r) => r.source === "characterLore").map((r) => r.name)

	it("shows a character their own lore and nobody else theirs", async () => {
		expect(names(await readAs(ash))).toContain("Ash's secret")
		expect(names(await readAs(bran))).not.toContain("Ash's secret")
		// Narrator mode is omniscient about background rows, not about a
		// specific character's private knowledge.
		expect(names(await readAs(null))).not.toContain("Ash's secret")
	})

	it("reserves an unbound binding's lore for the narrator", async () => {
		expect(names(await readAs(null))).toContain("The gatekeeper")
		expect(names(await readAs(ash))).not.toContain("The gatekeeper")
	})

	it("never surfaces an entry anchored to nothing, in any mode", async () => {
		for (const speaker of [null, ash, bran])
			expect(names(await readAs(speaker))).not.toContain("Orphaned lore")
	})

	it("does not gate world lore, which has no anchor to gate on", async () => {
		const rows = await readAs(bran)
		expect(rows.filter((r) => r.source === "worldLore")).toHaveLength(1)
	})
})

describe("history has column-shaped access to priority and still gets no bonus", () => {
	it("reads as priority 1 when the field is absent", async () => {
		const rows = await readAs(null)
		const history = rows.find((r) => r.source === "history")
		expect(history).toBeDefined()
		// The coalesce is the shape every source has always been read with —
		// the guard against it becoming a bonus is the ranker's, below.
		expect(history.priority).toBe(1)
	})

	it("the keyword band and the semantic boost both refuse it a bonus", async () => {
		const { DEFAULT_SIGNAL_WEIGHTS } = await import(
			"$lib/server/pipelines/ranking/weights"
		)
		const { priorityBoost } = await import(
			"$lib/server/pipelines/ranking/semantic"
		)

		// ⚠ Two vocabularies on purpose: `history` is the budget/weight key and
		// `historyEntry` is the vector index's source. `bindings.ts:264-274`
		// documents why, and the ranker matches `sourceBudget` keys literally —
		// collapsing them silently drops every history candidate.
		expect(DEFAULT_SIGNAL_WEIGHTS.history.priorityBonus).toBe(0)
		expect(DEFAULT_SIGNAL_WEIGHTS.worldLore.priorityBonus).toBeGreaterThan(
			0
		)

		const boosted = priorityBoost(
			[
				{
					id: 1,
					source: "historyEntry",
					score: 1,
					name: "",
					priority: 3
				},
				{ id: 2, source: "worldLore", score: 1, name: "", priority: 3 }
			],
			0.3
		)
		expect(boosted[0]!.score).toBe(1)
		expect(boosted[1]!.score).toBeGreaterThan(1)
	})

	it("stays at 1 even when a priority is written into a history entry's fields", async () => {
		// Nothing in the product offers this — history declares no `priority`
		// field — but one table means the column-shaped access exists, so the
		// question "what happens if somebody writes one" has an answer now
		// where it used to have a missing column.
		await db
			.update(schema.lorebookEntries)
			.set({ fields: mergeFields({ priority: 3 }) })
			.where(eq(schema.lorebookEntries.id, historyId))

		// The answer is *nothing*: history's wire shape has no `priority` at
		// all, so the read never sees the number and `toLoreEntry` coalesces to
		// 1 exactly as it did when the column did not exist. **Absent means no
		// bonus**, structurally, and not only by the ranker's good behaviour.
		const history = (await readAs(null)).find((r) => r.source === "history")
		expect(history.priority).toBe(1)

		// Put it back, so this test cannot colour any other — and check the
		// merge removed the key rather than storing a JSON null.
		await db
			.update(schema.lorebookEntries)
			.set({ fields: mergeFields({ priority: null }) })
			.where(eq(schema.lorebookEntries.id, historyId))
		const [row] = await db
			.select({ fields: schema.lorebookEntries.fields })
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.id, historyId))
		expect(row.fields.priority).toBeUndefined()
		expect(row.fields.year).toBe(412)
	})
})
