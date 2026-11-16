/**
 * The content-only mirror (`updateLegacyWhere(..., { mirror: "content" })`):
 * a mid-stream frame re-derives just the shown revision's text parts, to the
 * same values the full mirror writes, in fewer statements.
 */
import { beforeAll, describe, expect, it, vi } from "vitest"
import { and, eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import * as schema from "$lib/server/db/schema"
import {
	createTestDb,
	createTestUser,
	type TestDb
} from "$lib/server/utils/testDb"
import { insertLegacy, updateLegacyWhere } from "./store"
import { projectLegacy } from "./projectLegacy"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let db: TestDb
let sessionId: number

beforeAll(async () => {
	db = await createTestDb()
	const user = await createTestUser(db, "content-mirror")
	const [session] = await db
		.insert(schema.sessions)
		.values({ userId: user.id, isGroup: false })
		.returning()
	sessionId = session!.id
})

const placeholder = (metadata: Record<string, unknown> = {}) =>
	insertLegacy(db, {
		sessionId,
		role: "assistant",
		content: "",
		isGenerating: true,
		metadata: metadata as any
	})

const whereId = (id: number) => eq(schema.sessionMessages.id, id)

const partsOf = async (id: number, revision: number) =>
	(
		await db
			.select()
			.from(schema.messageParts)
			.where(
				and(
					eq(schema.messageParts.messageId, id),
					eq(schema.messageParts.step, 0),
					eq(schema.messageParts.revision, revision)
				)
			)
	)
		.sort((a, b) => a.ordinal - b.ordinal)
		.map((p) => ({
			ordinal: p.ordinal,
			type: p.type,
			content: p.content,
			data: p.data
		}))

const expected = (row: any, revision: number) =>
	projectLegacy(row)
		.parts.filter((p) => p.revision === revision)
		.sort((a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0))
		.map((p) => ({
			ordinal: p.ordinal,
			type: p.type,
			content: p.content ?? null,
			data: p.data ?? null
		}))

const readRow = async (id: number) =>
	(await db.select().from(schema.sessionMessages).where(whereId(id)))[0]!

describe("content-only mirror", () => {
	it("writes the shown revision's markdown part, as projectLegacy says", async () => {
		const row = await placeholder()
		await updateLegacyWhere(
			db,
			whereId(row.id),
			{ content: "abc", isGenerating: true },
			{ mirror: "content" }
		)
		const parts = await partsOf(row.id, 0)
		expect(parts.find((p) => p.type === "core:markdown")?.content).toBe(
			"abc"
		)
		expect(parts).toEqual(expected(await readRow(row.id), 0))
	})

	it("on a swiped row leaves revision 0 alone and writes the shown revision", async () => {
		const row = await placeholder({
			swipes: { history: ["one", "two"], currentIdx: 1 }
		})
		const before = await partsOf(row.id, 0)
		await updateLegacyWhere(
			db,
			whereId(row.id),
			{
				content: "two!",
				isGenerating: true,
				metadata: {
					swipes: { history: ["one", "two!"], currentIdx: 1 }
				} as any
			},
			{ mirror: "content" }
		)
		const after = await readRow(row.id)
		expect(await partsOf(row.id, 0)).toEqual(before)
		expect(await partsOf(row.id, 1)).toEqual(expected(after, 1))
		expect(
			(await partsOf(row.id, 1)).find((p) => p.type === "core:markdown")
				?.content
		).toBe("two!")
	})

	it("deletes a reasoning part that went empty", async () => {
		const row = await placeholder()
		await updateLegacyWhere(
			db,
			whereId(row.id),
			{
				content: "x",
				isGenerating: true,
				metadata: { reasoning: "thinking" } as any
			},
			{ mirror: "content" }
		)
		expect(
			(await partsOf(row.id, 0)).some((p) => p.type === "core:reasoning")
		).toBe(true)
		await updateLegacyWhere(
			db,
			whereId(row.id),
			{ content: "xy", isGenerating: true, metadata: {} as any },
			{ mirror: "content" }
		)
		const parts = await partsOf(row.id, 0)
		expect(parts.some((p) => p.type === "core:reasoning")).toBe(false)
		expect(parts).toEqual(expected(await readRow(row.id), 0))
	})

	it("by default still mirrors fully: status moves", async () => {
		const row = await placeholder()
		await updateLegacyWhere(db, whereId(row.id), {
			content: "done",
			isGenerating: false
		})
		const [m] = await db
			.select()
			.from(schema.messages)
			.where(eq(schema.messages.id, row.id))
		expect(m!.status).toBe("settled")
	})

	it("issues fewer statements than the full mirror", async () => {
		const queries: string[] = []
		const logged = drizzle((db as any).$client, {
			schema,
			logger: { logQuery: (q: string) => void queries.push(q) }
		})
		const count = async (opts?: { mirror: "content" | "full" }) => {
			const row = await placeholder()
			queries.length = 0
			await updateLegacyWhere(
				logged as any,
				whereId(row.id),
				{ content: "streaming", isGenerating: true },
				opts
			)
			return queries.length
		}
		const full = await count()
		const content = await count({ mirror: "content" })
		console.log(`statements per frame: full=${full} content=${content}`)
		expect(content).toBeLessThan(full)
	})
})
