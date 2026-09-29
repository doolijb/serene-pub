/**
 * Lair pass B7 (F10, owner ruling D4): the per-message prefill Extend and
 * the composer's Continue are two declarations.
 *
 *  - `core#extend` is the message verb — extend one reply by prefill —
 *    and answers to the genre's `messageVerbs.extend` (`continue` until
 *    2026-09-28).
 *  - `core#advance` is the turn control — fire the turn order's head — and
 *    answers to the genre's `turnControls.advance`.
 *
 * The Lair switches the first off and keeps the second; Chat and Adventure
 * keep both. Each is refused at its own door by sentence.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "turn-control-split-secret" }
})
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))

const LAIR = "core:genre/lair"
const CHAT = "core:genre/chat"
const ADVENTURE = "core:genre/adventure"
/** A genre that offers no composer Continue — declared as an inlet's shape. */
const NO_ADVANCE = "acme.still:inlet/still@1"

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-turn-control-split-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(testDb as any)
	const schema = await import("$lib/server/db/schema")
	await testDb.insert(schema.pipelineDefinitionRegistry).values({
		definitionId: "acme.still:inlet/still",
		version: 1,
		kind: "inlet",
		status: "live",
		i18n: { name: { en: "Still Life" } },
		ports: {},
		sessionShape: {
			composer: "text",
			characters: { min: 0 },
			turnControls: { advance: false }
		}
	} as any)
}, 180_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

function fakeSocket(userId: number) {
	return {
		user: { id: userId, isAdmin: false },
		io: { to: () => ({ emit: () => {} }) }
	} as any
}
const noopEmit = () => {}

/** A session of `genreId` whose newest row is a reply with text. */
async function sessionWithReply(tag: string, genreId: string) {
	const schema = await import("$lib/server/db/schema")
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const owner = await createTestUser(testDb, `${tag}-owner`)
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId: owner.id, isGroup: false, genreId })
		.returning()
	const [reply] = await testDb
		.insert(schema.sessionMessages)
		.values({
			sessionId: session!.id,
			role: "assistant",
			isNarratorResponse: true,
			content: "The door creaks open.",
			userId: owner.id
		})
		.returning()
	return { owner, session: session!, reply: reply! }
}

async function keysAt(sessionId: number, userId: number) {
	const { sessionsActionsHandler } = await import("./sessions")
	const res = await sessionsActionsHandler.handler(
		fakeSocket(userId),
		{ sessionId },
		noopEmit
	)
	const at = (v: { primary: { key: string; specSlug: string }[]; overflow: { key: string; specSlug: string }[] }) =>
		[...v.primary, ...v.overflow]
			.filter((a) => a.specSlug === "core")
			.map((a) => a.key)
	return { message: at(res.venues.message), extra: at(res.venues.extra) }
}

describe("B7 · prefill extend and the turn control are two declarations", () => {
	test("the Lair offers no prefill Extend on a message, and still offers the turn control", async () => {
		const { owner, session } = await sessionWithReply("lair-list", LAIR)
		const { message, extra } = await keysAt(session.id, owner.id)
		expect(message).not.toContain("extend")
		expect(message).toContain("retry")
		expect(extra).toContain("advance")
		expect(extra).not.toContain("extend")
	})

	test("the Lair's server refuses the prefill extend by sentence", async () => {
		const { sessionMessagesExtendHandler } = await import("./sessions")
		const { owner, reply } = await sessionWithReply("lair-refuse", LAIR)
		const res = await sessionMessagesExtendHandler.handler(
			fakeSocket(owner.id),
			{ id: reply.id },
			noopEmit
		)
		expect(res.error).toMatch(/does not offer extend/)
		expect(res.error).toMatch(/Lair/)
	})

	test("the Lair's turn control is not refused at the fire", async () => {
		const { turnControlRefusal } = await import("$lib/server/messages/verbs")
		const { owner, session } = await sessionWithReply("lair-fire", LAIR)
		expect(
			await turnControlRefusal(testDb as any, session.id, "advance", {
				userId: owner.id
			})
		).toBeNull()
	})

	test.each([
		["Chat", CHAT],
		["Adventure", ADVENTURE]
	])("%s still offers both", async (_name, genreId) => {
		const { verbRefusal } = await import("$lib/server/messages/verbs")
		const { owner, session } = await sessionWithReply(`both-${_name}`, genreId)
		const { message, extra } = await keysAt(session.id, owner.id)
		expect(message).toContain("extend")
		expect(extra).toContain("advance")
		expect(await verbRefusal(testDb as any, session.id, "extend")).toBeNull()
	})

	test("a genre that switches the turn control off lists no advance, and the fire refuses Continue by sentence", async () => {
		const { sessionsFireTurnHandler } = await import("./sessions")
		const { owner, session } = await sessionWithReply("no-advance", NO_ADVANCE)
		const { message, extra } = await keysAt(session.id, owner.id)
		expect(extra).not.toContain("advance")
		// The prefill verb is its own declaration, untouched.
		expect(message).toContain("extend")
		const res = await sessionsFireTurnHandler.handler(
			fakeSocket(owner.id),
			{ sessionId: session.id },
			noopEmit
		)
		expect(res.ok).toBe(false)
		expect(res.error).toMatch(/does not offer Continue/)
		expect(res.error).toMatch(/Still Life/)
	})
})
