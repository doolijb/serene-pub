/**
 * The master's direction reaches the run as direction (lair pass F8, B11).
 *
 * A Lair reply fired after the master types a line used to run with
 * `input.text: ''` — the typed line reached the planner only as a transcript
 * row, and that row was labelled with an empty speaker (`": The torches
 * gutter…"`), because the Lair has no persona system and `{{user}}` is empty.
 *
 * Pinned through `runReply` against the SHIPPED Lair respond document the
 * bootstrap publishes — the road the socket handlers take — with a fake
 * adapter standing in for the model:
 *
 *  1. the reply run's inlet carries the line just sent as `text`;
 *  2. no transcript line the planner is handed has an empty name.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let db: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))
vi.mock("$lib/server/embedding/vectorizationQueue", () => ({
	ensureSessionMessageEmbedded: async () => {},
	autoEnqueueSession: async () => {}
}))
vi.mock("$lib/server/sockets/utils/broadcastHelpers", () => ({
	broadcastToSessionUsers: async () => {}
}))
vi.mock("$lib/server/utils/getUserConfigurations", () => ({
	getUserConfigurations: async () => ({
		contextConfig: { id: 1, template: "{{instructions}}" },
		promptConfig: { id: 1, systemPrompt: "Be brief." },
		narratorPromptConfig: null
	})
}))

/** One document for every step, as `lair.int.test.ts` answers. */
const ANSWER = JSON.stringify({
	beats: ["The torch gutters."],
	speakers: [],
	worldHints: {}
})

class FakeAdapter {
	aborted = false
	abort() {
		this.aborted = true
	}
	async preflight() {}
	withStops() {
		return this
	}
	withCompiledPrompt() {
		return this
	}
	withStreaming() {
		return this
	}
	async generateText() {
		return {
			compiledPrompt: { prompt: "p", messages: undefined, meta: {} as any },
			isAborted: false,
			completionResult: async (onContent: (c: string) => void) => {
				onContent(ANSWER)
			}
		}
	}
}
vi.mock("$lib/server/utils/getConnectionAdapter", () => ({
	getConnectionAdapter: async () => ({ Adapter: FakeAdapter })
}))

let userId: number
let characterId: number
const fakeSocket = (uid: number) => ({ user: { id: uid }, io: {} }) as any
const emit = () => {}

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-lair-direction-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb

	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(db)

	const { createTestUser } = await import("$lib/server/utils/testDb")
	userId = (await createTestUser(db, "lair-direction")).id
	await db
		.update(schema.users)
		.set({ displayName: "Morgan" })
		.where(eq(schema.users.id, userId))

	const [delver] = await db
		.insert(schema.characters)
		.values({ userId, name: "Brannoc", description: "A delver." } as any)
		.returning()
	characterId = delver!.id

	const [textConn] = await db
		.insert(schema.connections)
		.values({ name: "Text", type: "koboldcpp", baseUrl: "http://text" })
		.returning()
	const { ensureConnectionModel } = await import(
		"$lib/server/connections/models"
	)
	const modelId = (await ensureConnectionModel(db, textConn!.id, "lair-7b"))!
		.id
	const [sampling] = await db
		.insert(schema.samplingConfigs)
		.values({
			name: "Default",
			isImmutable: false,
			values: { contextTokens: 8192, responseTokens: 200, temperature: 0.2 },
			enabled: ["contextTokens", "responseTokens", "temperature"]
		} as any)
		.returning()
	const { setCapabilityDefault } = await import(
		"$lib/server/connections/capabilityDefaults"
	)
	await setCapabilityDefault(db, "text->text", {
		connectionId: textConn!.id,
		connectionModelId: modelId,
		samplingConfigId: sampling!.id
	})
})

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

async function createLairSession(name: string) {
	const { LAIR_GENRE_ID } = await import("@serene-pub/core-catalog")
	const { sessionsCreateHandler } = await import(
		"$lib/server/sockets/sessions"
	)
	const [lorebook] = await db
		.insert(schema.lorebooks)
		.values({ userId, name: `${name} dungeon` } as any)
		.returning()
	const res: any = await sessionsCreateHandler.handler(
		fakeSocket(userId),
		{
			session: { name, genreId: LAIR_GENRE_ID, lorebookId: lorebook!.id },
			characterIds: [characterId],
			personaIds: [],
			characterPositions: {},
			tags: []
		} as any,
		emit
	)
	expect(res?.error, res?.error).toBeUndefined()
	return res.session.id as number
}

describe("a Lair reply after the master types", () => {
	it("carries the sent line as the run's input text, and names the master's line", async () => {
		const sessionId = await createLairSession("direction")
		const LINE = "The torches gutter, and something wakes below."
		await db.insert(schema.sessionMessages).values({
			sessionId,
			userId,
			role: "user",
			content: LINE
		} as any)

		const { runReply } = await import("$lib/server/utils/runReply")
		const outcome = await runReply({
			socket: fakeSocket(userId),
			emitToUser: () => {},
			sessionId,
			userId,
			turn: { kind: "respond", characterId: null }
		} as any)
		const receipt: any = outcome.receipt
		expect(receipt, (outcome as any).error).toBeDefined()

		const inlet = receipt.nodes.find((n: any) => n.nodeKey === "input")
		expect((inlet.output as any).text).toBe(LINE)

		// The transcript the planner is handed: every line has a name, and
		// the master's is the genre's `playerLabel` (R4) — "Dungeon Master",
		// not the member's display name.
		// The planner's transcript sits in the respond spec's `planned` branch
		// (lair pass B15: the whole turn is under the `pick` junction).
		const lines = receipt.nodes.find(
			(n: any) => n.nodeKey === "via.turn.channel.story.pick.planned.lines"
		)
		const messages = (lines?.output as any)?.messages as Array<{
			role: string
			name: string
			message: string
		}>
		expect(messages?.length).toBeGreaterThan(0)
		for (const m of messages) expect(m.name.trim()).not.toBe("")
		const mine = messages.find((m) => m.message === LINE)
		expect(mine?.name).toBe("Dungeon Master")
		// And the planner's own instructions name the person by it.
		expect(JSON.stringify(receipt.nodes)).toContain(
			"The person writing to you is the Dungeon Master**"
		)
	})
})

/**
 * A session's rename (lair re-plan R4): the override on the row's metadata
 * wins over the genre's label in the transcript and in `{{playerLabel}}`, and
 * the settings document reports it — read at run time, never stamped.
 */
describe("a Lair session that renamed its playerLabel", () => {
	it("labels the master's lines and the planner prompt with the override", async () => {
		const sessionId = await createLairSession("renamed")
		const { sessionsUpdateHandler } = await import(
			"$lib/server/sockets/sessions"
		)
		const [row] = await db
			.select()
			.from(schema.sessions)
			.where(eq(schema.sessions.id, sessionId))
		await sessionsUpdateHandler.handler(
			fakeSocket(userId),
			{
				session: { id: sessionId, name: row!.name },
				playerLabel: "  Game Master "
			} as any,
			emit
		)
		const { resolveSessionSettings } = await import(
			"$lib/server/sessions/settings"
		)
		expect((await resolveSessionSettings(db as any, sessionId))?.playerLabel).toBe(
			"Game Master"
		)

		const LINE = "A draught stirs the dust."
		await db.insert(schema.sessionMessages).values({
			sessionId,
			userId,
			role: "user",
			content: LINE
		} as any)
		const { runReply } = await import("$lib/server/utils/runReply")
		const outcome = await runReply({
			socket: fakeSocket(userId),
			emitToUser: () => {},
			sessionId,
			userId,
			turn: { kind: "respond", characterId: null }
		} as any)
		const receipt: any = outcome.receipt
		expect(receipt, (outcome as any).error).toBeDefined()
		const lines = receipt.nodes.find(
			(n: any) => n.nodeKey === "via.turn.channel.story.pick.planned.lines"
		)
		const mine = ((lines?.output as any)?.messages as any[]).find(
			(m) => m.message === LINE
		)
		expect(mine?.name).toBe("Game Master")
		const all = JSON.stringify(receipt.nodes)
		expect(all).toContain("The person writing to you is the Game Master**")
		expect(all).not.toContain("Dungeon Master")

		// Clearing it restores the genre's, with no migration of any row.
		await sessionsUpdateHandler.handler(
			fakeSocket(userId),
			{ session: { id: sessionId, name: row!.name }, playerLabel: "" } as any,
			emit
		)
		expect((await resolveSessionSettings(db as any, sessionId))?.playerLabel).toBe(
			"Dungeon Master"
		)
	})
})
