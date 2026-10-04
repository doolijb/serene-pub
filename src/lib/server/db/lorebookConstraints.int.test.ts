/**
 * The table-level rules a lorebook's rows are held to, asserted against the
 * schema a fresh install migrates to.
 *
 * Each rule is a CHECK, a unique index or a foreign key the database enforces
 * on its own, whatever code path writes the row — so each is proved by a write
 * that should be refused and, beside it, the nearest write that should not.
 */

import { beforeAll, describe, expect, it, vi } from "vitest"
import { eq, sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { rawRows } from "./rawRows"
import { entryInsert } from "$lib/server/utils/lorebookEntries"
import { LOCATION_TYPE_ID } from "$lib/shared/entries/types"
import {
	asDriverRejection,
	createTestDb,
	createTestUser,
	type TestDb
} from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let db: TestDb
const id = {} as Record<
	| "book"
	| "branch"
	| "session"
	| "liveValue"
	| "guardroom"
	| "hall"
	| "chapel"
	| "aria"
	| "bram",
	number
>

beforeAll(async () => {
	db = await createTestDb()
	const user = await createTestUser(db, "lorebook-constraints")
	const [book] = await db
		.insert(schema.lorebooks)
		.values({ userId: user.id, name: "Held to the rules" })
		.returning()
	id.book = book!.id
	const [branch] = await db
		.insert(schema.lorebookBranches)
		.values({ lorebookId: book!.id, name: "What if" })
		.returning()
	id.branch = branch!.id
	const [session] = await db
		.insert(schema.sessions)
		.values({
			userId: user.id,
			isGroup: false,
			name: "A dated session",
			storyClockYear: 400,
			storyClockMonth: 2,
			storyClockDay: 3
		})
		.returning()
	id.session = session!.id
	const [live] = await db
		.insert(schema.attributeValues)
		.values({
			ownerKind: "lorebook",
			ownerId: book!.id,
			slotId: "core:slot/weather@1",
			branchId: branch!.id,
			value: { v: "clear" }
		})
		.returning()
	id.liveValue = live!.id

	let position = 0
	const place = async (name: string) => {
		const [row] = await db
			.insert(schema.lorebookEntries)
			.values(
				entryInsert({
					typeId: LOCATION_TYPE_ID,
					lorebookId: book!.id,
					name,
					content: `${name}.`,
					position: position++
				} as any)
			)
			.returning({ id: schema.lorebookEntries.id })
		return row!.id
	}
	id.guardroom = await place("The Guardroom")
	id.hall = await place("The Drowned Hall")
	id.chapel = await place("The Chapel")

	const member = async (name: string, token: string) =>
		rawRows<{ id: number }>(
			await db.execute(sql`
				insert into lorebook_bindings (lorebook_id, binding, name)
				values (${book!.id}, ${token}, ${name}) returning id`)
		)[0]!.id
	id.aria = await member("Aria", "{{char:1}}")
	id.bram = await member("Bram", "{{char:2}}")
})

/** A query the database must refuse, for any reason. */
const refuses = async (q: PromiseLike<unknown>) => {
	let failed = false
	try {
		await q
	} catch {
		failed = true
	}
	expect(failed).toBe(true)
}

describe("story clocks and forks", () => {
	it("refuses a clock or fork that narrows out of order", async () => {
		await refuses(
			db
				.update(schema.lorebooks)
				.set({ storyClockYear: 1, storyClockDay: 4 })
				.where(eq(schema.lorebooks.id, id.book))
		)
		await refuses(
			db
				.update(schema.sessions)
				.set({ storyClockYear: 1, storyClockHour: 24 })
				.where(eq(schema.sessions.id, id.session))
		)
		await refuses(
			db
				.update(schema.sessions)
				.set({ storyClockMinute: 5, storyClockHour: null })
				.where(eq(schema.sessions.id, id.session))
		)
		await refuses(
			db
				.update(schema.lorebookBranches)
				.set({ forkYear: null, forkMonth: 1 })
				.where(eq(schema.lorebookBranches.id, id.branch))
		)
		// …and takes a well-formed one.
		await db
			.update(schema.lorebookBranches)
			.set({
				forkYear: 9,
				forkMonth: 1,
				storyClockYear: 400,
				storyClockMonth: 2,
				storyClockDay: 3,
				storyClockHour: 23,
				storyClockMinute: 59
			})
			.where(eq(schema.lorebookBranches.id, id.branch))
	})
})

describe("stat rows and branches", () => {
	it("refuses a stat row naming a branch that does not exist", async () => {
		await refuses(
			db.insert(schema.attributeValues).values({
				ownerKind: "lorebook",
				ownerId: id.book,
				slotId: "core:slot/weather@1",
				value: { v: "fog" },
				branchId: 987_654
			})
		)
	})

	it("cascades a branch's stat rows away with the branch", async () => {
		const [doomed] = await db
			.insert(schema.lorebookBranches)
			.values({ lorebookId: id.book, name: "Doomed" })
			.returning()
		const [value] = await db
			.insert(schema.attributeValues)
			.values({
				ownerKind: "lorebook",
				ownerId: id.book,
				slotId: "core:slot/weather@1",
				branchId: doomed!.id,
				value: { v: "storm" }
			})
			.returning()
		await db
			.delete(schema.lorebookBranches)
			.where(eq(schema.lorebookBranches.id, doomed!.id))
		const left = await db
			.select({ id: schema.attributeValues.id })
			.from(schema.attributeValues)
			.where(eq(schema.attributeValues.id, value!.id))
		expect(left).toEqual([])
		// A row on another branch is not touched.
		const kept = await db
			.select({ id: schema.attributeValues.id })
			.from(schema.attributeValues)
			.where(eq(schema.attributeValues.id, id.liveValue))
		expect(kept).toHaveLength(1)
	})

	it("indexes the nullable FK columns partially", async () => {
		const rows = rawRows<{ indexname: string; indexdef: string }>(
			await db.execute(
				sql`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public'`
			)
		)
		const byName = new Map(rows.map((r) => [r.indexname, r.indexdef]))
		for (const name of [
			"lorebook_entries_branch_id_idx",
			"lorebook_entries_anchor_entry_id_idx",
			"lorebook_entries_anchor_binding_id_idx",
			"entry_amendments_branch_id_idx",
			"entry_amendments_history_entry_id_idx",
			"cast_amendments_branch_id_idx",
			"cast_amendments_history_entry_id_idx",
			"cast_presences_branch_id_idx",
			"scenes_branch_id_idx",
			"narrative_relationships_branch_id_idx",
			"sessions_lorebook_branch_id_idx",
			"attribute_values_branch_id_idx",
			"attribute_configs_branch_id_idx"
		]) {
			expect(byName.get(name), name).toMatch(/WHERE .* IS NOT NULL/)
		}
	})
})

describe("narrative relationships", () => {
	const insert = (v: {
		from?: number
		to?: number
		fromNode?: number
		toNode?: number
		type: string
		title?: string
		reverse?: string
	}) =>
		db.execute(sql`
			insert into narrative_relationships
				(lorebook_id, from_entry_id, to_entry_id, from_node_id, to_node_id,
				 relationship_type, title, reverse_relationship_type)
			values (${id.book}, ${v.from ?? null}, ${v.to ?? null}, ${v.fromNode ?? null},
				${v.toNode ?? null}, ${v.type}, ${v.title ?? ""}, ${v.reverse ?? null})`)

	it("refuses an entry linked to itself, and still takes a cast self-loop", async () => {
		await expect(
			asDriverRejection(
				insert({ from: id.hall, to: id.hall, type: "leads to" })
			)
		).rejects.toThrow(/narrative_relationships_entry_self_check/)
		await insert({ fromNode: id.bram, toNode: id.bram, type: "doubts" })
	})

	it("refuses a reverse relationship type between two cast members", async () => {
		await expect(
			asDriverRejection(
				insert({
					fromNode: id.aria,
					toNode: id.bram,
					type: "ally",
					reverse: "ally"
				})
			)
		).rejects.toThrow(/narrative_relationships_reverse_check/)
		// …and takes one with an entry at either end.
		await insert({
			fromNode: id.aria,
			to: id.chapel,
			type: "keeps",
			reverse: "is kept by"
		})
	})

	it("refuses the same unnamed link twice, whatever its case, and takes two named doors", async () => {
		await insert({ from: id.guardroom, to: id.hall, type: "leads to" })
		await expect(
			asDriverRejection(
				insert({ from: id.guardroom, to: id.hall, type: "LEADS TO" })
			)
		).rejects.toThrow(/narrative_relationships_entry_pair_uq/)
		await insert({
			from: id.guardroom,
			to: id.hall,
			type: "leads to",
			title: "the rusted iron door"
		})
		await insert({
			from: id.guardroom,
			to: id.hall,
			type: "leads to",
			title: "the trapdoor"
		})
		await expect(
			asDriverRejection(
				insert({
					from: id.guardroom,
					to: id.hall,
					type: "leads to",
					title: "The Trapdoor"
				})
			)
		).rejects.toThrow(/narrative_relationships_entry_pair_uq/)
	})
})
