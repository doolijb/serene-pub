/**
 * 🚧 `copyLorebookTables` into a book that already holds rows (the fold of a
 * parent book into a session's own book): fresh member tags and the tags in
 * the copied text, renamed lines, the target's own suggestion and sheet kept,
 * the turn tie only when asked, the source untouched — and into an empty book
 * the copy is the duplicate it always was.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq, inArray } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { historyValues } from "$lib/server/pipelines/testing/fixtures"
import {
	insertCastMember,
	insertCharacterVersions
} from "$lib/server/characters/versions"
import {
	LOREBOOK_TABLES,
	copyLorebookTables,
	type CopyOptions
} from "./tableRegistry"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-registry-copyinto-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const db = () => testDb as unknown as Db
let n = 0

/** Every row a book holds in every registered table, by the table's own scope. */
async function dump(bookId: number): Promise<Record<string, unknown[]>> {
	const members = (
		await testDb
			.select({ id: schema.lorebookBindings.id })
			.from(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.lorebookId, bookId))
	).map((r) => r.id)
	const entries = (
		await testDb
			.select({ id: schema.lorebookEntries.id })
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.lorebookId, bookId))
	).map((r) => r.id)
	const scenes = (
		await testDb
			.select({ id: schema.scenes.id })
			.from(schema.scenes)
			.where(eq(schema.scenes.lorebookId, bookId))
	).map((r) => r.id)
	const sets = members.length
		? (
				await testDb
					.select({ id: schema.spriteSets.id })
					.from(schema.spriteSets)
					.where(inArray(schema.spriteSets.castMemberId, members))
			).map((r) => r.id)
		: []
	const out: Record<string, unknown[]> = {}
	for (const spec of LOREBOOK_TABLES) {
		const t = spec.table as any
		const name = (spec.table as any)[Symbol.for("drizzle:Name")] as string
		const some = (col: any, ids: number[]) =>
			ids.length
				? testDb.select().from(t).where(inArray(col, ids))
				: Promise.resolve([])
		let rows: unknown[]
		if (spec.scope === "book")
			rows = await testDb.select().from(t).where(eq(t.lorebookId, bookId))
		else if (spec.scope === "entry") rows = await some(t.entryId, entries)
		else if (spec.scope === "scene") rows = await some(t.sceneId, scenes)
		else if (spec.scope === "binding")
			rows = t.castMemberId
				? await some(t.castMemberId, members)
				: await some(t.spriteSetId, sets)
		else {
			rows = []
			const owners: Array<[string, number[]]> = [
				["lorebook", [bookId]],
				["cast_member", members],
				["location", entries]
			]
			for (const [kind, ids] of owners)
				if (ids.length)
					rows.push(
						...(await testDb
							.select()
							.from(t)
							.where(
								and(
									eq(t.ownerKind, kind),
									inArray(t.ownerId, ids)
								)
							))
					)
		}
		out[name] = rows.map((r) => JSON.stringify(r)).sort()
	}
	return out
}

async function world() {
	const suffix = `${++n}`
	const [user] = await testDb
		.insert(schema.users)
		.values({ username: `ci-${suffix}` })
		.returning()
	const mk = async (name: string) =>
		(
			await testDb
				.insert(schema.lorebooks)
				.values({ userId: user!.id, name: `${name} ${suffix}` })
				.returning()
		)[0]!
	const source = await mk("Parent")
	const target = await mk("Own")
	const [session] = await testDb
		.insert(schema.sessions)
		.values({
			userId: user!.id,
			isGroup: false,
			name: `Run ${suffix}`
		} as any)
		.returning()
	const [turn] = await testDb
		.insert(schema.messages)
		.values({
			sessionId: session!.id,
			role: "assistant",
			content: "…"
		} as any)
		.returning()
	await testDb
		.insert(schema.attributeSheets)
		.values({ id: `sheet-${suffix}`, name: "Wounds" } as any)
		.onConflictDoNothing()
	const sheetId = `sheet-${suffix}`

	// The source: three members (tags 1-3), the second with versions naming {{char:2}}.
	const m: Awaited<ReturnType<typeof insertCastMember>>[] = []
	for (const k of [1, 2, 3])
		m.push(
			await insertCastMember(db(), {
				lorebookId: source.id,
				binding: `{{char:${k}}}`,
				name: `Src ${k}`,
				summary: k === 1 ? "Knows {{char:3}} and {{char:99}}." : null,
				description:
					k === 2 ? "Friend of {{char:2}} and {{char:1}}." : null
			})
		)
	await testDb
		.update(schema.lorebooks)
		.set({ nextBindingNumber: 4 })
		.where(eq(schema.lorebooks.id, source.id))
	const [version] = await insertCharacterVersions(db(), [
		{
			castMemberId: m[1]!.member.id,
			lorebookId: source.id,
			name: "Src 2 later",
			description:
				"Betrayed by {{char:3}}; ask {{char:2}} (not {{char:99}}).",
			nodeState: "active",
			nodeVisibility: "normal",
			sourceSessionId: session!.id,
			sourceMessageId: turn!.id,
			validFromMessageId: turn!.id,
			writtenBy: `run:${session!.id}`
		}
	])
	const [night] = await testDb
		.insert(schema.lorebookBranches)
		.values({ lorebookId: source.id, name: "Night", forkYear: 2 })
		.returning()
	const [seeded] = await testDb
		.insert(schema.lorebookEntries)
		.values(
			historyValues([{ lorebookId: source.id, content: "x", year: 4 }])
		)
		.returning()
	const [entry] = await testDb
		.update(schema.lorebookEntries)
		.set({
			title: "The feast of {{char:1}}",
			content: "{{char:1}} met {{char:3}}; {{char:99}} stayed.",
			keys: ["{{char:3}}"],
			secondaryKeys: ["{{char:2}}"]
		})
		.where(eq(schema.lorebookEntries.id, seeded!.id))
		.returning()
	await testDb.insert(schema.entryAmendments).values({
		lorebookId: source.id,
		entryId: entry!.id,
		year: 6,
		fields: { note: "{{char:1}} dies; {{char:3}} weeps" }
	} as any)
	await testDb.insert(schema.narrativeRelationships).values({
		lorebookId: source.id,
		fromNodeId: m[0]!.member.id,
		toNodeId: m[2]!.member.id,
		relationshipType: "owes",
		title: "{{char:1}} owes {{char:3}}",
		description: "A debt to {{char:3}}.",
		reason: "{{char:99}} said so"
	} as any)
	await testDb.insert(schema.scenes).values({
		lorebookId: source.id,
		name: "{{char:2}} arrives",
		summary: "{{char:2}} meets {{char:1}}."
	} as any)
	await testDb.insert(schema.castPresences).values({
		lorebookId: source.id,
		lorebookBindingId: m[0]!.member.id,
		personalPosition: 1,
		fromYear: 1,
		note: "with {{char:3}}"
	} as any)
	await testDb.insert(schema.bindingSuggestions).values([
		{ lorebookId: source.id, entityKey: "open:Zed", surface: "Source Zed" },
		{
			lorebookId: source.id,
			entityKey: "open:Only",
			surface: "Source only"
		}
	] as any)
	await testDb.insert(schema.ownerSheets).values({
		ownerKind: "lorebook",
		ownerId: source.id,
		sheetId,
		position: 0
	} as any)
	await testDb.insert(schema.attributeValues).values({
		ownerKind: "lorebook",
		ownerId: source.id,
		slotId: "weather",
		value: { v: "rain" },
		validFromMessageId: turn!.id
	} as any)

	// The target: one member (tag 1), a line "Night", the same suggestion key and sheet.
	const own = await insertCastMember(db(), {
		lorebookId: target.id,
		binding: "{{char:1}}",
		name: "Own 1",
		summary: "Mine, names {{char:1}}."
	})
	await testDb
		.update(schema.lorebooks)
		.set({ nextBindingNumber: 2 })
		.where(eq(schema.lorebooks.id, target.id))
	await testDb
		.insert(schema.lorebookBranches)
		.values({ lorebookId: target.id, name: "Night", forkYear: 9 })
	await testDb.insert(schema.bindingSuggestions).values({
		lorebookId: target.id,
		entityKey: "open:Zed",
		surface: "Target Zed"
	} as any)
	await testDb.insert(schema.ownerSheets).values({
		ownerKind: "lorebook",
		ownerId: target.id,
		sheetId,
		position: 0
	} as any)

	return {
		user: user!,
		source,
		target,
		session: session!,
		turn: turn!,
		m,
		version: version!,
		entry: entry!,
		own,
		night: night!
	}
}

const copyInto = (from: number, to: number, opts?: CopyOptions) =>
	testDb.transaction((tx) =>
		copyLorebookTables(tx as unknown as Db, from, to, opts)
	)

const membersOf = (bookId: number) =>
	testDb
		.select()
		.from(schema.lorebookBindings)
		.where(eq(schema.lorebookBindings.lorebookId, bookId))
		.orderBy(schema.lorebookBindings.id)

describe("copyLorebookTables into a book that already holds rows", () => {
	test("fresh tags, rewritten text, renamed line, the target's rows win, the source untouched", async () => {
		const w = await world()
		const sourceBefore = await dump(w.source.id)
		const ownBefore = await membersOf(w.target.id)
		const maps = await copyInto(w.source.id, w.target.id)

		// Members: fresh, distinct from the target's tag 1, mapped 1→n1, 2→n2, 3→n3.
		const copied = (await membersOf(w.target.id)).filter(
			(r) => r.id !== w.own.member.id
		)
		expect(copied).toHaveLength(3)
		const tags = copied.map((r) => r.binding)
		expect(new Set([...tags, "{{char:1}}"]).size).toBe(4)
		expect([...maps.tags.keys()]).toEqual([1, 2, 3])
		const [n1, n2, n3] = [1, 2, 3].map((k) => maps.tags.get(k)!)
		expect(new Set([n1, n2, n3, 1]).size).toBe(4)
		expect(copied.map((r) => r.binding)).toEqual(
			[n1, n2, n3].map((k) => `{{char:${k}}}`)
		)
		const [book] = await testDb
			.select()
			.from(schema.lorebooks)
			.where(eq(schema.lorebooks.id, w.target.id))
		expect(book!.nextBindingNumber).toBeGreaterThan(Math.max(n1, n2, n3))

		// Every copied text names the new tags; {{char:99}} stays as written.
		expect(copied[0]!.summary).toBe(`Knows {{char:${n3}}} and {{char:99}}.`)
		const [entry] = await testDb
			.select()
			.from(schema.lorebookEntries)
			.where(
				and(
					eq(schema.lorebookEntries.lorebookId, w.target.id),
					eq(schema.lorebookEntries.id, maps.entries.get(w.entry.id)!)
				)
			)
		expect(entry!.title).toBe(`The feast of {{char:${n1}}}`)
		expect(entry!.content).toBe(
			`{{char:${n1}}} met {{char:${n3}}}; {{char:99}} stayed.`
		)
		expect(entry!.keys).toEqual([`{{char:${n3}}}`])
		expect(entry!.secondaryKeys).toEqual([`{{char:${n2}}}`])
		const [amend] = await testDb
			.select()
			.from(schema.entryAmendments)
			.where(eq(schema.entryAmendments.lorebookId, w.target.id))
		expect(amend!.fields).toEqual({
			note: `{{char:${n1}}} dies; {{char:${n3}}} weeps`
		})
		const [link] = await testDb
			.select()
			.from(schema.narrativeRelationships)
			.where(eq(schema.narrativeRelationships.lorebookId, w.target.id))
		expect(link!.title).toBe(`{{char:${n1}}} owes {{char:${n3}}}`)
		expect(link!.description).toBe(`A debt to {{char:${n3}}}.`)
		expect(link!.reason).toBe("{{char:99}} said so")
		const [scene] = await testDb
			.select()
			.from(schema.scenes)
			.where(eq(schema.scenes.lorebookId, w.target.id))
		expect(scene!.name).toBe(`{{char:${n2}}} arrives`)
		expect(scene!.summary).toBe(`{{char:${n2}}} meets {{char:${n1}}}.`)
		const [presence] = await testDb
			.select()
			.from(schema.castPresences)
			.where(eq(schema.castPresences.lorebookId, w.target.id))
		expect(presence!.note).toBe(`with {{char:${n3}}}`)
		const versions = await testDb
			.select()
			.from(schema.characterVersions)
			.where(eq(schema.characterVersions.lorebookId, w.target.id))
			.orderBy(schema.characterVersions.id)
		const later = versions.find((v) => v.name === "Src 2 later")!
		expect(later.description).toBe(
			`Betrayed by {{char:${n3}}}; ask {{char:${n2}}} (not {{char:99}}).`
		)
		const base2 = versions.find(
			(v) =>
				v.castMemberId === maps.bindings.get(w.m[1]!.member.id) &&
				v.name === "Src 2"
		)!
		expect(base2.description).toBe(
			`Friend of {{char:${n2}}} and {{char:${n1}}}.`
		)

		// The target's own rows are unchanged.
		const ownAfter = (await membersOf(w.target.id)).filter(
			(r) => r.id === w.own.member.id
		)
		expect(ownAfter).toEqual(ownBefore)

		// The line is renamed; the target's own stays.
		const lines = await testDb
			.select()
			.from(schema.lorebookBranches)
			.where(eq(schema.lorebookBranches.lorebookId, w.target.id))
		expect(lines.map((l) => l.name).sort()).toEqual(["Night", "Night (2)"])
		expect(lines.find((l) => l.name === "Night")!.forkYear).toBe(9)

		// Suggestion and sheet: the target's kept.
		const sugg = await testDb
			.select()
			.from(schema.bindingSuggestions)
			.where(eq(schema.bindingSuggestions.lorebookId, w.target.id))
		expect(sugg.map((s) => `${s.entityKey}:${s.surface}`).sort()).toEqual([
			"open:Only:Source only",
			"open:Zed:Target Zed"
		])
		const sheets = await testDb
			.select()
			.from(schema.ownerSheets)
			.where(
				and(
					eq(schema.ownerSheets.ownerKind, "lorebook"),
					eq(schema.ownerSheets.ownerId, w.target.id)
				)
			)
		expect(sheets).toHaveLength(1)

		// The source is byte-identical.
		expect(await dump(w.source.id)).toEqual(sourceBefore)
	})

	test("the turn tie is kept only with keepTurnTies", async () => {
		const plain = await world()
		await copyInto(plain.source.id, plain.target.id)
		const kept = await world()
		await copyInto(kept.source.id, kept.target.id, { keepTurnTies: true })

		const tie = async (w: Awaited<ReturnType<typeof world>>) => {
			const v = await testDb
				.select({ at: schema.characterVersions.validFromMessageId })
				.from(schema.characterVersions)
				.where(
					and(
						eq(schema.characterVersions.lorebookId, w.target.id),
						eq(schema.characterVersions.name, "Src 2 later")
					)
				)
			const a = await testDb
				.select({ at: schema.attributeValues.validFromMessageId })
				.from(schema.attributeValues)
				.where(
					and(
						eq(schema.attributeValues.ownerKind, "lorebook"),
						eq(schema.attributeValues.ownerId, w.target.id)
					)
				)
			return { version: v.map((r) => r.at), value: a.map((r) => r.at) }
		}
		expect(await tie(plain)).toEqual({ version: [null], value: [null] })
		expect(await tie(kept)).toEqual({
			version: [kept.turn.id],
			value: [kept.turn.id]
		})
	})

	test("a member with more versions than one insert takes are all copied (batched)", async () => {
		const w = await world()
		await insertCharacterVersions(
			db(),
			Array.from({ length: 150 }, (_, i) => ({
				castMemberId: w.m[0]!.member.id,
				lorebookId: w.source.id,
				name: `Src 1 v${i}`,
				nodeState: "active",
				nodeVisibility: "normal",
				sourceSessionId: w.session.id,
				sourceMessageId: w.turn.id,
				writtenBy: `run:${w.session.id}`
			}))
		)
		const versionsIn = async (bookId: number) =>
			(
				await testDb
					.select({ id: schema.characterVersions.id })
					.from(schema.characterVersions)
					.where(eq(schema.characterVersions.lorebookId, bookId))
			).length
		const [empty] = await testDb
			.insert(schema.lorebooks)
			.values({ userId: w.user.id, name: "Many" })
			.returning()
		await copyInto(w.source.id, empty!.id)
		expect(await versionsIn(empty!.id)).toBe(await versionsIn(w.source.id))
		expect(await versionsIn(empty!.id)).toBeGreaterThan(150)
	})

	test("into an empty book every member keeps its tag and no text is rewritten", async () => {
		const w = await world()
		const [empty] = await testDb
			.insert(schema.lorebooks)
			.values({ userId: w.user.id, name: "Empty" })
			.returning()
		const maps = await copyInto(w.source.id, empty!.id)
		expect(maps.tags.size).toBe(0)
		const copied = await membersOf(empty!.id)
		expect(copied.map((r) => r.binding)).toEqual([
			"{{char:1}}",
			"{{char:2}}",
			"{{char:3}}"
		])
		expect(copied[0]!.summary).toBe("Knows {{char:3}} and {{char:99}}.")
		const [entry] = await testDb
			.select()
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.lorebookId, empty!.id))
		expect(entry!.content).toBe(
			"{{char:1}} met {{char:3}}; {{char:99}} stayed."
		)
		const lines = await testDb
			.select()
			.from(schema.lorebookBranches)
			.where(eq(schema.lorebookBranches.lorebookId, empty!.id))
		expect(lines.map((l) => l.name)).toEqual(["Night"])
	})
})
