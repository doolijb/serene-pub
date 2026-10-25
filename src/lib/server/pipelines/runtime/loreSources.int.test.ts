/**
 * 🚧 `sources`, `match` and `bind` on the lore outlets (pr-6 lane C1): the host
 * half. `settleThrough` is lane A's — these tests assert only that the write
 * lands, never what the settle line does.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { WORLD_LORE_TYPE_ID, entryInsert } from "$lib/server/utils/lorebookEntries"
import { CHARACTER_LORE_TYPE_ID } from "$lib/shared/entries/types"

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

let db: TestDb
let dataDir: string
let userId: number
let bookId: number
let sessionId: number
let otherSessionId: number
let whisperSessionId: number
/** Live messages of `sessionId`, oldest first, all on `main`. */
let mainIds: number[] = []
let otherMessageId: number
let whisperMainId: number
let whisperAsideId: number
let characterId: number
let castMemberId: number
let gateId: number

const WHISPER_GENRE = "chariot.desk:inlet/whisper@1"
const SAVE = { key: "save", definitionId: "core:outlet/create-lore-entry" }

const host = async (scope: Record<string, unknown> = {}) => {
	const { createHost } = await import("$lib/server/pipelines/runtime/host")
	return createHost(db as any, { sessionId, runId: "run-c1", ...scope } as any)
}
const sourcesOf = async (subjectId: number, subjectKind = "entry") =>
	(await db.select().from(schema.loreSources)).filter(
		(r) => r.subjectId === subjectId && r.subjectKind === subjectKind
	)
const msgs = (ids: number[]) => ids.map((id) => ({ id }))

const addMessage = async (sid: number, channel: string, content: string) => {
	const [row] = await db
		.insert(schema.sessionMessages)
		.values({ sessionId: sid, role: "assistant", content, channel } as any)
		.returning({ id: schema.sessionMessages.id })
	return row!.id
}
const addEntry = async (name: string, position: number, content = "old") => {
	const [row] = await db
		.insert(schema.lorebookEntries)
		.values(
			entryInsert({
				typeId: WORLD_LORE_TYPE_ID,
				lorebookId: bookId,
				name,
				content,
				position
			})
		)
		.returning({ id: schema.lorebookEntries.id })
	return row!.id
}

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-lore-sources-int-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	const { createTestUser } = await import("$lib/server/utils/testDb")
	userId = (await createTestUser(db, "lore-sources-user")).id

	await db.insert(schema.pipelineDefinitionRegistry).values({
		definitionId: "chariot.desk:inlet/whisper",
		version: 1,
		kind: "inlet",
		status: "live",
		i18n: { name: { en: "Whisper Desk" } },
		ports: {},
		sessionShape: {
			composer: "text",
			lorebook: "optional",
			channels: ["whispers"],
			writes: { lore: true, scenes: false }
		}
	} as any)

	const [book] = await db.insert(schema.lorebooks).values({ name: "Sources", userId }).returning()
	bookId = book!.id
	const mk = async (genreId?: string) =>
		(
			await db
				.insert(schema.sessions)
				.values({ userId, isGroup: false, lorebookId: bookId, ...(genreId ? { genreId } : {}) } as any)
				.returning()
		)[0]!.id
	sessionId = await mk()
	otherSessionId = await mk()
	whisperSessionId = await mk(WHISPER_GENRE)

	for (let i = 0; i < 6; i++) mainIds.push(await addMessage(sessionId, "main", `line ${i}`))
	otherMessageId = await addMessage(otherSessionId, "main", "elsewhere")
	whisperMainId = await addMessage(whisperSessionId, "main", "said aloud")
	whisperAsideId = await addMessage(whisperSessionId, "whispers", "said low")

	const [character] = await db
		.insert(schema.characters)
		.values({ userId, name: "Mira", description: "" } as any)
		.returning({ id: schema.characters.id })
	characterId = character!.id
	const [member] = await db
		.insert(schema.lorebookBindings)
		.values({ lorebookId: bookId, characterId, binding: "{{char:1}}", name: "Mira" } as any)
		.returning({ id: schema.lorebookBindings.id })
	castMemberId = member!.id

	gateId = await addEntry("Old Gate", 1)
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

describe("lore outlets — sources", () => {
	it(
		"(a) create with sources writes one lore_sources row: min, max and the run id",
		async () => {
			const h = await host({ readMessageIds: new Set(mainIds) })
			const res = (await h.commit!(
				{ name: "Summary A", content: "what happened", sources: msgs([mainIds[3]!, mainIds[1]!, mainIds[2]!]) },
				SAVE as any
			)) as { id: number }
			const rows = await sourcesOf(res.id)
			expect(rows).toHaveLength(1)
			expect(rows[0]!.fromMessageId).toBe(mainIds[1])
			expect(rows[0]!.throughMessageId).toBe(mainIds[3])
			expect(rows[0]!.runId).toBe("run-c1")
			expect(rows[0]!.sessionId).toBe(sessionId)
			expect(rows[0]!.lorebookId).toBe(bookId)
		},
		60_000
	)

	it(
		"(b) create without sources writes none",
		async () => {
			const h = await host()
			const res = (await h.commit!({ name: "Plain B", content: "a change" }, SAVE as any)) as {
				id: number
				notes?: string[]
			}
			expect(await sourcesOf(res.id)).toHaveLength(0)
			expect(res.notes).toBeUndefined()
		},
		60_000
	)

	it(
		"(c) a message of another session is refused with sentence 2",
		async () => {
			const h = await host()
			await expect(
				h.commit!({ name: "No C", content: "x", sources: msgs([otherMessageId]) }, SAVE as any)
			).rejects.toThrow(
				`message ${otherMessageId} is not in this session's live story, so this cannot be written from it.`
			)
			await expect(
				h.commit!({ name: "No C", content: "x", sources: [] }, SAVE as any)
			).rejects.toThrow("sources names no messages")
		},
		60_000
	)

	it(
		"(d) a message on a never channel is refused with sentence 3",
		async () => {
			const h = await host({ sessionId: whisperSessionId })
			await expect(
				h.commit!({ name: "No D", content: "x", sources: msgs([whisperAsideId]) }, SAVE as any)
			).rejects.toThrow(
				`message ${whisperAsideId} is on 'whispers', which this genre never makes lore of.`
			)
			// The story channel of the same session is fine.
			const ok = (await h.commit!(
				{ name: "Yes D", content: "x", sources: msgs([whisperMainId]) },
				SAVE as any
			)) as { id: number }
			expect(await sourcesOf(ok.id)).toHaveLength(1)
		},
		60_000
	)

	it(
		"(e) minAge 3 refuses a source among the 3 newest of its lane; at depth 3 it is accepted",
		async () => {
			const h = await host({ minAge: 3 })
			await expect(
				h.commit!({ name: "No E", content: "x", sources: msgs([mainIds[3]!]) }, SAVE as any)
			).rejects.toThrow(
				`message ${mainIds[3]} is one of the newest 3 lines of 'main', which a routine leaves alone until play has moved past them.`
			)
			const ok = (await h.commit!(
				{ name: "Yes E", content: "x", sources: msgs([mainIds[2]!]) },
				SAVE as any
			)) as { id: number }
			expect(await sourcesOf(ok.id)).toHaveLength(1)
		},
		60_000
	)

	it(
		"(f) an id the run never read lands, and the result notes it",
		async () => {
			const h = await host({ readMessageIds: new Set([mainIds[0]!]) })
			const res = (await h.commit!(
				{ name: "Frontier F", content: "x", sources: msgs([mainIds[0]!, mainIds[1]!]) },
				SAVE as any
			)) as { id: number; notes?: string[] }
			expect(await sourcesOf(res.id)).toHaveLength(1)
			expect(res.notes).toEqual([`sources names message ${mainIds[1]} this run never read`])
		},
		60_000
	)
})

describe("create-lore-entry — match", () => {
	it(
		"(g) match { name }: one candidate updates it, none creates, two refuse naming both",
		async () => {
			const h = await host()
			const hit = (await h.commit!(
				{ name: "Old Gate", content: "rebuilt", match: { name: "  old gate " } },
				SAVE as any
			)) as { id: number; matched?: boolean; written?: boolean }
			expect(hit.id).toBe(gateId)
			expect(hit.matched).toBe(true)
			expect(hit.written).toBe(false)
			const [row] = await db
				.select()
				.from(schema.lorebookEntries)
				.where(eq(schema.lorebookEntries.id, gateId))
			expect(row!.content).toBe("rebuilt")

			const made = (await h.commit!(
				{ name: "Brand New", content: "fresh", match: { name: "Brand New" } },
				SAVE as any
			)) as { id: number; matched?: boolean }
			expect(made.matched).toBeUndefined()
			expect(made.id).not.toBe(gateId)

			const a = await addEntry("Twin", 20)
			const b = await addEntry("Twin", 21)
			await expect(
				h.commit!({ name: "Twin", content: "x", match: { name: "twin" } }, SAVE as any)
			).rejects.toThrow(
				new RegExp(
					`2 entries answer to 'twin' — 'Twin' \\(entry ${a}\\), 'Twin' \\(entry ${b}\\)\\. Name one: match \\{ entryId \\}\\.`
				)
			)
			await expect(
				h.commit!({ name: "Twin", content: "x", match: { entryId: b } }, SAVE as any)
			).resolves.toMatchObject({ id: b, matched: true })
			await expect(
				h.commit!({ name: "x", content: "x", match: "Twin" }, SAVE as any)
			).rejects.toThrow("match is { entryId }, { name } or { key }.")
		},
		60_000
	)
})

describe("create-lore-entry — bind", () => {
	it(
		"(h) bind files a character-lore entry under the cast member; world lore refuses",
		async () => {
			const h = await host()
			const res = (await h.commit!(
				{
					name: "Mira's secret",
					content: "x",
					bind: `character:${characterId}`,
					params: { entryType: CHARACTER_LORE_TYPE_ID }
				},
				SAVE as any
			)) as { id: number }
			const [row] = await db
				.select()
				.from(schema.lorebookEntries)
				.where(eq(schema.lorebookEntries.id, res.id))
			expect(row!.anchorBindingId).toBe(castMemberId)

			await expect(
				h.commit!({ name: "World bit", content: "x", bind: `character:${characterId}` }, SAVE as any)
			).rejects.toThrow(`'${WORLD_LORE_TYPE_ID}' entries are not filed under a cast member — leave bind off.`)
			await expect(
				h.commit!(
					{ name: "Bad", content: "x", bind: "Mira", params: { entryType: CHARACTER_LORE_TYPE_ID } },
					SAVE as any
				)
			).rejects.toThrow("bind names a character, as character:<id>.")
		},
		60_000
	)
})
