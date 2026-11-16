/**
 * What one streamed frame costs the database, and that frames never overlap.
 *
 * Statements per persisted frame (5 chunks, each a frame, no `io`):
 *   before: 5 (update session_messages; select messages; upsert messages;
 *   select message_parts; insert message_parts)   after: 3 (update session_messages; delete stale message_parts; insert message_parts)
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
import { insertLegacy, updateLegacyWhere } from "$lib/server/messages/store"
import { createLiveRow } from "./liveRow"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let db: TestDb
let sessionId: number
let queries: string[] = []
let counting: TestDb

beforeAll(async () => {
	db = await createTestDb()
	counting = drizzle((db as any).$client, {
		schema,
		logger: { logQuery: (q: string) => void queries.push(q) }
	}) as unknown as TestDb
	const user = await createTestUser(db, "live-row-perframe")
	const [session] = await db
		.insert(schema.sessions)
		.values({ userId: user.id, isGroup: false })
		.returning()
	sessionId = session!.id
})

const placeholder = () =>
	insertLegacy(db, {
		sessionId,
		role: "assistant",
		content: "",
		isGenerating: true,
		metadata: {}
	})

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** The full mirror's first statement: a select from "messages" by id. */
const fullMirrorSignature = (q: string) =>
	/^select .* from "messages" where/i.test(q)

async function run(n: number) {
	const row = await placeholder()
	const live = createLiveRow({
		db: counting as any,
		sessionId,
		streamingNodes: new Set(["generate"])
	})
	live.opened(row)
	const stream = live.attach(row.id, "generate", {})!
	const perFrame: number[] = []
	let text = ""
	for (let i = 0; i < n; i++) {
		await wait(140)
		queries.length = 0
		text += `w${i} `
		stream.onChunk(`w${i} `)
		// the frame runs off the chunk; let it land (well inside the throttle)
		await wait(100)
		perFrame.push(queries.length)
	}
	return { row, live, perFrame, text }
}

const partsText = async (id: number) =>
	(
		await db
			.select()
			.from(schema.messageParts)
			.where(
				and(
					eq(schema.messageParts.messageId, id),
					eq(schema.messageParts.type, "core:markdown")
				)
			)
	)
		.map((p) => p.content)
		.join("")

describe("a streamed frame", () => {
	it("costs three statements: the update, the stale-slot delete and the content upsert", async () => {
		const { perFrame } = await run(5)
		expect(perFrame).toEqual([3, 3, 3, 3, 3])
	})

	it("mirrors fully once — at the release — and a second caller still does", async () => {
		const { row, live, text } = await run(4)
		queries.length = 0
		await live.flush()
		expect(await partsText(row.id)).toBe(text.trim() || text)
		expect(queries.filter(fullMirrorSignature)).toHaveLength(0)
		await live.finish({ kind: "cancelled" } as any)
		expect(queries.filter(fullMirrorSignature)).toHaveLength(1)
		const settled = (
			await db
				.select()
				.from(schema.messages)
				.where(eq(schema.messages.id, row.id))
		)[0]!
		expect(settled.status).toBe("settled")

		queries.length = 0
		await updateLegacyWhere(
			counting,
			eq(schema.sessionMessages.id, row.id),
			{ content: "edited" }
		)
		expect(queries.filter(fullMirrorSignature)).toHaveLength(1)
	})

	it("never runs two persists at once, and the final text lands after flush", async () => {
		const row = await placeholder()
		let inFlight = 0
		let max = 0
		let total = 0
		const client = (db as any).$client
		const realQuery = client.query.bind(client)
		const slow = drizzle(
			new Proxy(client, {
				get(target, key) {
					if (key !== "query") return target[key]
					return async (sql: string, ...rest: unknown[]) => {
						const isFrame = /^update "session_messages"/i.test(sql)
						if (isFrame) {
							inFlight++
							total++
							max = Math.max(max, inFlight)
							await wait(60)
						}
						try {
							return await realQuery(sql, ...rest)
						} finally {
							if (isFrame) inFlight--
						}
					}
				}
			}) as any,
			{ schema }
		) as unknown as TestDb
		const live = createLiveRow({
			db: slow as any,
			sessionId,
			streamingNodes: new Set(["generate"])
		})
		live.opened(row)
		const stream = live.attach(row.id, "generate", {})!
		await wait(140)
		let text = ""
		for (let i = 0; i < 30; i++) {
			stream.onChunk(`c${i} `)
			text += `c${i} `
			await wait(15)
		}
		await live.flush()
		expect(total).toBeGreaterThan(1)
		expect(max).toBe(1)
		const now = (
			await db
				.select()
				.from(schema.sessionMessages)
				.where(eq(schema.sessionMessages.id, row.id))
		)[0]!
		expect(now.content).toBe(text.trim())
	})
})
