/**
 * 🚧 `sessions:fireTurn` takes an entry named `seated-member:<memberId>` (plan
 * §27 S3, lane s27-S3C, worker w1): the handler reads it as the seat's card
 * form at the door, before it compares it with the stored turn order or fires
 * it, so what is fired — and what the order holds — stays card-form
 * (`character:<cardId>`, `player-seat:<seatId>`). A member nobody is seated as
 * stays as sent: no order entry equals it, and `fireTurnEntry` refuses it
 * (`fireTurn.seatedMember.int.test.ts`); it is never translated into a card.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { memberFormOn } from "$lib/server/state/memberForm"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "fire-turn-seated-member-secret" }
})
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))
/** The dispatch itself is not under test: record what the door let through. */
const fired: Array<{ ref: unknown; via?: string }> = []
vi.mock("$lib/server/sessions/fireTurn", async (importOriginal) => {
	const orig = (await importOriginal()) as Record<string, unknown>
	return {
		...orig,
		fireTurnEntry: async (
			_db: unknown,
			opts: { entry: { ref: unknown; via?: string } }
		) => {
			fired.push(opts.entry)
			return { fired: true, runId: "run-under-test" }
		}
	}
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-fireturn-seatedmember-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(testDb as any)
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
let n = 0

async function world() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const owner = await createTestUser(testDb, `fireturn-sm-${++n}`)
	const [card] = await testDb
		.insert(schema.characters)
		.values({
			userId: owner.id,
			name: "Verity",
			description: "A card."
		} as any)
		.returning()
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: owner.id, name: `Book ${++n}` } as any)
		.returning()
	const bind = async (characterId: number | null) =>
		(
			await testDb
				.insert(schema.lorebookBindings)
				.values({
					lorebookId: book!.id,
					characterId,
					binding: `{{char:${++n}}}`,
					name: "member"
				} as any)
				.returning()
		)[0]!
	const m = await bind(card!.id)
	const pm = await bind(null)
	const [session] = await testDb
		.insert(schema.sessions)
		.values({
			userId: owner.id,
			isGroup: false,
			genreId: "core:genre/story",
			lorebookId: book!.id
		} as any)
		.returning()
	await testDb.insert(schema.sessionCharacters).values({
		sessionId: session!.id,
		characterId: card!.id,
		castMemberId: m.id,
		position: 0
	} as any)
	const [seat] = await testDb
		.insert(schema.sessionPersonas)
		.values({
			sessionId: session!.id,
			personaId: null,
			userId: owner.id,
			seatName: "Wren",
			castMemberId: pm.id
		} as any)
		.returning()
	await testDb.insert(schema.sessionMessages).values({
		sessionId: session!.id,
		role: "user",
		content: "The party enter the hall.",
		userId: owner.id
	})
	return { owner, card: card!, m, pm, session: session!, seat: seat! }
}

async function fire(userId: number, sessionId: number, ref: string) {
	const { sessionsFireTurnHandler } = await import("./sessions")
	return sessionsFireTurnHandler.handler(
		fakeSocket(userId),
		{ sessionId, entry: { ref, via: "pick" } } as any,
		() => {}
	)
}

describe("sessions:fireTurn reads a seated-member entry as the seat's card form", () => {
	test("a carded seat's member fires as character:<cardId>, a card-less player seat's as player-seat:<seatId>, a card form as before", async () => {
		const w = await world()
		fired.length = 0
		for (const ref of [
			`seated-member:${w.m.id}`,
			`seated-member:${w.pm.id}`,
			`character:${w.card.id}`
		]) {
			const res: any = await fire(w.owner.id, w.session.id, ref)
			expect(res.error, ref).toBeUndefined()
		}
		// ⏳ Card form until the flip; once on, a character seat fires as its member's form.
		const character = memberFormOn()
			? `seated-member:${w.m.id}`
			: `character:${w.card.id}`
		expect(fired.map((e) => e.ref)).toEqual([
			character,
			`player-seat:${w.seat.id}`,
			character
		])
		expect(fired.every((e) => e.via === "pick")).toBe(true)
	})

	test("a member nobody is seated as is never translated: it reaches the dispatch as sent, to be refused there", async () => {
		const w = await world()
		fired.length = 0
		const unseated = `seated-member:${w.pm.id + 9999}`
		await fire(w.owner.id, w.session.id, unseated)
		expect(fired.map((e) => e.ref)).toEqual([unseated])
	})
})
