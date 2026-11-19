/**
 * 🚧 `entryKnowledge:*` driven through its handlers: every reply carries the
 * scope its extractor reads, a non-owner gets the sentence and no reply, a
 * bulk mark answers once, and the `requestId` comes back on reply and refusal.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { insertCastMember } from "$lib/server/characters/versions"
import { scopeOfPayload } from "$lib/shared/sockets/interest"
import {
	entryKnowledgeList,
	entryKnowledgeSetCommonKnowledge,
	entryKnowledgeSetTie
} from "./entryKnowledge"

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
		path.join(os.tmpdir(), "serene-pub-vitest-kn4a-door-socket-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
	await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {})
})

type Emitted = { event: string; data: any }

function caller(userId: number) {
	const out: Emitted[] = []
	const socket = { user: { id: userId } } as any
	const emit = (event: string, data: any) => {
		out.push({ event, data })
	}
	return { socket, emit, out }
}

async function world() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `kn-sock-${Math.random()}`)
	const other = await createTestUser(testDb, `kn-sock-other-${Math.random()}`)
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: user.id, name: "Keep" } as never)
		.returning()
	const entries: number[] = []
	for (let i = 0; i < 3; i++)
		entries.push(
			(
				await testDb
					.insert(schema.lorebookEntries)
					.values({
						lorebookId: book!.id,
						typeId: "core:entry/world-lore",
						typeVersion: 1,
						position: i,
						fields: {}
					} as never)
					.returning()
			)[0]!.id
		)
	const member = (
		await insertCastMember(testDb, {
			lorebookId: book!.id,
			binding: `{{char:Ana${book!.id}}}`,
			name: "Ana"
		})
	).member!.id
	return { user, other, book: book!, entries, member }
}

const reading = { branchId: null, moment: null }

describe("entryKnowledge door", () => {
	test("every reply carries the scope key and the requestId", async () => {
		const w = await world()
		const me = caller(w.user.id)
		const bulk = await entryKnowledgeSetCommonKnowledge.handler(
			me.socket,
			{
				lorebookId: w.book.id,
				entryIds: w.entries,
				notCommonKnowledge: true,
				requestId: "r1"
			},
			me.emit
		)
		expect(bulk.markedEntryIds).toEqual(w.entries)
		// One reply for the whole request.
		expect(me.out).toHaveLength(1)
		expect(me.out[0]!.event).toBe("entryKnowledge:setCommonKnowledge")
		expect(bulk.requestId).toBe("r1")

		await entryKnowledgeList.handler(
			me.socket,
			{ lorebookId: w.book.id, castMemberId: w.member, ...reading, requestId: "r2" },
			me.emit
		)
		const tie = await entryKnowledgeSetTie.handler(
			me.socket,
			{
				lorebookId: w.book.id,
				castMemberId: w.member,
				entryId: w.entries[0]!,
				hand: "knows",
				...reading,
				requestId: "r3"
			},
			me.emit
		)
		expect(tie.row).toMatchObject({ known: true, hand: "knows" })
		expect(me.out.map((o) => o.event)).toEqual([
			"entryKnowledge:setCommonKnowledge",
			"entryKnowledge:list",
			"entryKnowledge:setTie"
		])
		for (const [i, id] of ["r1", "r2", "r3"].entries()) {
			const { event, data } = me.out[i]!
			expect(scopeOfPayload(event, data)).toBe(String(w.book.id))
			expect(data.requestId).toBe(id)
		}
		expect(me.out[1]!.data.rows).toHaveLength(3)
	})

	test("a non-owner gets the error with the sentence, the ids, and no reply", async () => {
		const w = await world()
		const them = caller(w.other.id)
		const cases: [any, any, string][] = [
			[entryKnowledgeList, { entryId: w.entries[0], ...reading }, "entryKnowledge:list"],
			[
				entryKnowledgeSetCommonKnowledge,
				{ entryIds: [w.entries[0]], notCommonKnowledge: true },
				"entryKnowledge:setCommonKnowledge"
			],
			[
				entryKnowledgeSetTie,
				{ castMemberId: w.member, entryId: w.entries[0], hand: "knows", ...reading },
				"entryKnowledge:setTie"
			]
		]
		for (const [handler, extra, event] of cases) {
			await expect(
				handler.handler(
					them.socket,
					{ lorebookId: w.book.id, requestId: "q", ...extra },
					them.emit
				)
			).rejects.toThrow("Lorebook not found.")
			const last = them.out.at(-1)!
			expect(last.event).toBe(`${event}:error`)
			expect(last.data).toEqual({
				error: "Lorebook not found.",
				lorebookId: w.book.id,
				requestId: "q"
			})
		}
		expect(them.out.every((o) => o.event.endsWith(":error"))).toBe(true)
	})

	test("refuses a bad lorebook id and a bad line", async () => {
		const w = await world()
		const me = caller(w.user.id)
		await expect(
			entryKnowledgeList.handler(me.socket, { lorebookId: "x" as never, ...reading }, me.emit)
		).rejects.toThrow("Lorebook not found.")
		await expect(
			entryKnowledgeList.handler(
				me.socket,
				{ lorebookId: w.book.id, branchId: "x" as never, moment: null },
				me.emit
			)
		).rejects.toThrow("That is not a line of this lorebook.")
	})
})
