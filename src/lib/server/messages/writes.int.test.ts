/**
 * Declared writes (R-B, ruled 2026-09-17), enforced where the write happens.
 *
 * The companion to `verbs.int.test.ts`, and the same doctrine: the genre
 * declares availability, core refuses at the write, and an affordance hidden
 * client-side is presentation rather than the law. What is asked here is
 * whether the three session-scoped write paths — the lore-entry outlet, the
 * summarize handler and `scenes:create` — each refuse on their own, so a raw
 * socket emit or a user-attached pipeline gets the same answer the button
 * would have.
 *
 * The two lorebook-scoped paths (`narrativeGraph:applyProposal`,
 * `entries:create`) are deliberately NOT here: they carry no session, and this
 * lever is about what a session does.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { resolveWrites, loreWriteRefusal, sceneWriteRefusal } from "./writes"

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

let db: TestDb
let dataDir: string
let userId: number
/** A genre that keeps its lorebook as reference and opens no scenes. */
let referenceSessionId: number
/** A genre that declares nothing — the standard chat's posture. */
let plainSessionId: number
let lorebookId: number

const REFERENCE_GENRE = "chariot.desk:inlet/reference@1"

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-writes-int-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb

	const { createTestUser } = await import("$lib/server/utils/testDb")
	userId = (await createTestUser(db, "writes-user")).id

	await db.insert(schema.pipelineDefinitionRegistry).values({
		definitionId: "chariot.desk:inlet/reference",
		version: 1,
		kind: "inlet",
		status: "live",
		i18n: { name: { en: "Reference Desk" } },
		ports: {},
		sessionShape: {
			composer: "text",
			lorebook: "optional",
			writes: { lore: false, scenes: false }
		}
	} as any)

	const [book] = await db
		.insert(schema.lorebooks)
		.values({ name: "The Manual", userId })
		.returning()
	lorebookId = book.id

	const [reference] = await db
		.insert(schema.sessions)
		.values({
			userId,
			isGroup: false,
			genreId: REFERENCE_GENRE,
			lorebookId
		})
		.returning()
	referenceSessionId = reference.id

	const [plain] = await db
		.insert(schema.sessions)
		.values({ userId, isGroup: false, lorebookId })
		.returning()
	plainSessionId = plain.id
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const fakeSocket = () => ({ user: { id: userId } }) as any
const noopEmit = () => {}

describe("resolveWrites", () => {
	it("absent means both on; an explicit false forbids; unknown keys ignored", () => {
		expect(resolveWrites(undefined)).toEqual({ lore: true, scenes: true })
		expect(resolveWrites({ lorebook: "optional" })).toEqual({
			lore: true,
			scenes: true
		})
		expect(resolveWrites({ writes: { lore: false } })).toEqual({
			lore: false,
			scenes: true
		})
		expect(resolveWrites({ writes: { lore: true, graphs: false } })).toEqual({
			lore: true,
			scenes: true
		})
	})

	it("an unreadable shape restricts nothing (F29) and never throws", () => {
		for (const junk of [null, "chat", 42, [], { writes: "no" }])
			expect(resolveWrites(junk)).toEqual({ lore: true, scenes: true })
	})
})

describe("the refusal sentences", () => {
	it("name the genre, and say what the lorebook is for", async () => {
		const lore = await loreWriteRefusal(db, referenceSessionId)
		expect(lore).toBe(
			"This session's genre ('Reference Desk') keeps its lorebook as " +
				"reference — nothing a session does writes to it."
		)
		expect(await sceneWriteRefusal(db, referenceSessionId)).toBe(
			"This session's genre ('Reference Desk') does not open scenes."
		)
	})

	it("a genre that declares nothing, and an unknown session, refuse nothing", async () => {
		expect(await loreWriteRefusal(db, plainSessionId)).toBeNull()
		expect(await sceneWriteRefusal(db, plainSessionId)).toBeNull()
		expect(await loreWriteRefusal(db, 999999)).toBeNull()
		expect(await sceneWriteRefusal(db, 999999)).toBeNull()
	})
})

describe("core:outlet/create-lore-entry — the only pipeline outlet that writes lore", () => {
	const node = { key: "save", definitionId: "core:outlet/create-lore-entry" }

	const entryCount = async () =>
		(
			await db
				.select()
				.from(schema.lorebookEntries)
				.where(eq(schema.lorebookEntries.lorebookId, lorebookId))
		).length

	it("throws the sentence and writes nothing when the genre keeps its book as reference", async () => {
		const { createHost } = await import(
			"$lib/server/pipelines/runtime/host"
		)
		const before = await entryCount()
		const host = createHost(db as any, { sessionId: referenceSessionId })
		await expect(
			host.commit!(
				{ name: "Smuggled", content: "…" },
				node as any
			) as Promise<unknown>
		).rejects.toThrow(/keeps its lorebook as reference/)
		expect(await entryCount()).toBe(before)
	})

	it("writes as it always did when the genre declares nothing", async () => {
		const { createHost } = await import(
			"$lib/server/pipelines/runtime/host"
		)
		const before = await entryCount()
		const host = createHost(db as any, { sessionId: plainSessionId })
		const res = (await host.commit!(
			{ name: "Allowed", content: "The summary." },
			node as any
		)) as { id: number; lorebookId: number }
		expect(res.lorebookId).toBe(lorebookId)
		expect(await entryCount()).toBe(before + 1)
		const [row] = await db
			.select()
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.id, res.id))
		// The title lives in the unified table's fields, not a column — what
		// this asserts is that the write landed, not how an entry is shaped.
		expect(row).toBeTruthy()
		expect(JSON.stringify(row)).toContain("Allowed")
	})
})

describe("sessions:summarize — a summary IS a lore entry", () => {
	it("is refused before anything runs, with the genre named", async () => {
		const { sessionsSummarizeHandler } = await import("../sockets/summarize")
		await expect(
			sessionsSummarizeHandler.handler(
				fakeSocket(),
				{ sessionId: referenceSessionId, messageIds: "all", loreType: "world" } as any,
				noopEmit as any
			)
		).rejects.toThrow(/keeps its lorebook as reference/)
	})

	it("is not refused by this lever when the genre declares nothing", async () => {
		// It may still fail for its own reasons (no connection, no model) —
		// what is asserted is that the writes lever is not what stopped it.
		const { sessionsSummarizeHandler } = await import("../sockets/summarize")
		await sessionsSummarizeHandler
			.handler(
				fakeSocket(),
				{ sessionId: plainSessionId, messageIds: "all", loreType: "world" } as any,
				noopEmit as any
			)
			.catch((e: unknown) => {
				expect(String(e)).not.toMatch(/keeps its lorebook as reference/)
			})
	})
})

describe("scenes:create — a scene opened from a session", () => {
	it("is refused when the session's genre opens no scenes", async () => {
		const { sceneCreateHandler } = await import("../sockets/scenes")
		await expect(
			sceneCreateHandler.handler(
				fakeSocket(),
				{
					scene: {
						lorebookId,
						sessionId: referenceSessionId,
						// Never reached: the refusal lands before the history
						// entry is resolved, which is the point — the genre's
						// answer does not depend on the payload being good.
						historyEntryId: 999999,
						name: "Refused"
					}
				} as any,
				noopEmit as any
			)
		).rejects.toThrow(/does not open scenes/)
	})

	it("a scene with no session is untouched by the lever — a person at a book", async () => {
		const { sceneCreateHandler } = await import("../sockets/scenes")
		await expect(
			sceneCreateHandler.handler(
				fakeSocket(),
				{ scene: { lorebookId, historyEntryId: 999999, name: "Loose" } } as any,
				noopEmit as any
			)
		).rejects.toThrow(/History entry not found/)
	})

	it("is not refused when the session's genre declares nothing", async () => {
		const { sceneCreateHandler } = await import("../sockets/scenes")
		await expect(
			sceneCreateHandler.handler(
				fakeSocket(),
				{
					scene: {
						lorebookId,
						sessionId: plainSessionId,
						historyEntryId: 999999,
						name: "Allowed"
					}
				} as any,
				noopEmit as any
			)
		).rejects.toThrow(/History entry not found/)
	})
})

