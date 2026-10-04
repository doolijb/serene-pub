/**
 * Everyone has a name (ruled 2026-09-26: "everyone should have names, even
 * just placeholders (genre should be able to define, like we do for
 * envoys)"). No message is ever attributed to "Unknown".
 *
 * What is pinned, at the one write every pipeline's message goes through
 * (`core:outlet/create-message`'s commit):
 *
 *  1. A line nobody claims — no character, persona, speaker or narration — in
 *     a genre that marks an envoy `fallback: true` posts as that envoy: the
 *     Guide's Serene, the Lair's Castellan.
 *  2. In a genre that declares no fallback (the standard chat) the row stays
 *     speakerless and the host's summary read names it with the
 *     generic `UNCLAIMED_LINE_NAME` — never "Unknown" (the summary
 *     source is the read that names senders).
 *  3. A line that names an envoy this session does not declare is refused
 *     by name; one it declares is written as named.
 *  4. A line that does name somebody keeps its identity: no fallback is
 *     stamped over a character, a narration or a user's own line.
 */

import { describe, it, expect, beforeAll } from "vitest"
import { eq } from "drizzle-orm"
import { createTestDb, createTestUser, type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { bootstrapPipelines } from "$lib/server/pipelines/boot/bootstrap"
import { createHost } from "$lib/server/pipelines/runtime/host"
import { UNCLAIMED_LINE_NAME } from "@serene-pub/sdk"

let db: TestDb
let userId: number
let guideSession: number
let lairSession: number
let chatSession: number

const writeNode = { key: "save", definitionId: "core:outlet/create-message" } as any

const write = async (sessionId: number, payload: Record<string, unknown>) =>
	(await createHost(db, { sessionId, userId }).commit!(
		{ sessionId, ...payload },
		writeNode
	)) as { id: number }

const rowOf = async (id: number) =>
	(
		await db
			.select()
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.id, id))
	)[0]!

const speakerOf = async (id: number) =>
	((await rowOf(id)).metadata as { speaker?: string } | null)?.speaker

beforeAll(async () => {
	db = await createTestDb()
	await bootstrapPipelines(db)
	userId = (await createTestUser(db, "unclaimed-speaker")).id
	const session = async (genreId: string) =>
		(
			await db
				.insert(schema.sessions)
				.values({ userId, isGroup: false, genreId })
				.returning()
		)[0]!.id
	guideSession = await session("core:genre/guide")
	lairSession = await session("core:genre/lair")
	chatSession = await session("core:genre/chat")
}, 60_000)

describe("a line nobody claims still has a name", () => {
	it("in a genre with a fallback envoy, it posts as that envoy — the Guide, the Castellan", async () => {
		const guide = await write(guideSession, { text: "Opened Settings." })
		expect(await speakerOf(guide.id)).toBe("envoy:mascot")
		expect((await rowOf(guide.id)).characterId).toBeNull()

		const lair = await write(lairSession, { text: "The torches gutter." })
		expect(await speakerOf(lair.id)).toBe("envoy:castellan")
	}, 60_000)

	it("in a genre with none, the row stays speakerless and the summary read names it generically — never Unknown", async () => {
		const res = await write(chatSession, { text: "The verdict is in." })
		expect(await speakerOf(res.id)).toBeUndefined()
		const lines = (await createHost(db, { sessionId: chatSession }).read!(
			"summarize_source",
			{ sessionId: chatSession, messageIds: [res.id] },
			{ key: "source", definitionId: "core:query/summarize-source@1" } as any
		)) as Array<{ id: number; senderName: string }>
		const line = lines.find((l) => l.id === res.id)!
		expect(line.senderName).toBe(UNCLAIMED_LINE_NAME.en)
		expect(line.senderName).not.toBe("Unknown")
	}, 60_000)

	it("an envoy's line is named by the envoy in the summary read", async () => {
		const res = await write(guideSession, { text: "Here is how." })
		const lines = (await createHost(db, { sessionId: guideSession }).read!(
			"summarize_source",
			{ sessionId: guideSession, messageIds: [res.id] },
			{ key: "source", definitionId: "core:query/summarize-source@1" } as any
		)) as Array<{ id: number; senderName: string }>
		expect(lines.find((l) => l.id === res.id)!.senderName).toBe("Serene")
	}, 60_000)
})

describe("naming an envoy", () => {
	it("an envoy this session does not declare is refused by name; a declared one is written as named", async () => {
		await expect(
			write(guideSession, { text: "Correct!", speaker: "envoy:umpire" })
		).rejects.toThrow(/save speaks as envoy 'umpire'.*declared: 'mascot'/)
		const ok = await write(guideSession, { text: "Hello.", speaker: "envoy:mascot" })
		expect(await speakerOf(ok.id)).toBe("envoy:mascot")
	}, 60_000)

	it("a line that names somebody keeps its identity — narration and a user's own line get no fallback", async () => {
		const narration = await write(guideSession, { text: "Night falls.", narration: true })
		expect(await speakerOf(narration.id)).toBeUndefined()
		expect((await rowOf(narration.id)).isNarratorResponse).toBe(true)

		const own = await write(guideSession, { text: "Mine.", role: "user" })
		expect(await speakerOf(own.id)).toBeUndefined()
	}, 60_000)
})
