/**
 * 🚧 ⏳ S4 wave 3: a book's stored audiences stay in card form (★K-3, "read by
 * card id until S5"); with the member-form switch on they are read as the
 * session's seats when unioned (`unionAudiences`), so the member who holds the
 * card's seat sees the key. A ref already in member form works as it is.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { insertCastMember } from "$lib/server/characters/versions"
import { memberFormSwitch } from "$lib/server/state/memberForm"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 })

let testDb: TestDb
let dataDir: string

const asked = vi.hoisted(() => ({ refs: [] as string[] }))

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
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
vi.mock("$lib/server/sockets/utils/broadcastHelpers", async (importOriginal) => ({
	...(await importOriginal<object>()),
	broadcastToSessionUsers: async () => {},
	emitToUserRedacted: async () => {}
}))
// Records which refs the union asks to resolve, and answers as the real resolver does.
vi.mock("$lib/server/pipelines/runtime/portrayals", async (importOriginal) => {
	const actual = await importOriginal<typeof import("$lib/server/pipelines/runtime/portrayals")>()
	return {
		...actual,
		resolvePortrayals: (db: unknown, p: { refs: string[] }) => {
			asked.refs = [...p.refs]
			return (actual.resolvePortrayals as (d: unknown, q: unknown) => unknown)(db, p)
		}
	}
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-loreAnnexMF-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(testDb as any)
}, 180_000)

afterAll(async () => {
	memberFormSwitch.on = false
	await releaseDataDir(dataDir)
})

afterEach(() => {
	memberFormSwitch.on = false
})

const OWNER = "acme.world"
let n = 0

/** A session reading a book whose `mood` key is audienced to `audience(card)`, with the owner in a carded player seat. */
async function world(audience: (w: { card: number; member: number; seat: number }) => string[]) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const owner = (await createTestUser(testDb, `lore-annex-mf-owner-${++n}`))!
	const guest = (await createTestUser(testDb, `lore-annex-mf-guest-${n}`))!
	const [card] = await testDb
		.insert(schema.characters)
		.values({ userId: owner.id, name: `Wren ${n}`, description: "…" } as any)
		.returning()
	const [book] = await testDb.insert(schema.lorebooks).values({ userId: owner.id, name: `Book ${n}` }).returning()
	const member = (await insertCastMember(testDb, { lorebookId: book!.id, binding: `{{char:${n}}}`, characterId: card!.id, name: "Wren" })).member!
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId: owner.id, isGroup: true, name: `Run ${n}`, lorebookId: book!.id })
		.returning()
	await testDb.insert(schema.sessionGuests).values({ sessionId: session!.id, userId: guest.id, isPlayer: true } as any)
	const [seat] = await testDb
		.insert(schema.sessionPersonas)
		.values({ sessionId: session!.id, userId: owner.id, personaId: card!.id, castMemberId: member.id, position: 0 })
		.returning()
	await testDb
		.update(schema.lorebooks)
		.set({
			annex: { [OWNER]: { mood: "wary" } },
			annexAudiences: { [OWNER]: { mood: audience({ card: card!.id, member: member.id, seat: seat!.id }) } }
		} as any)
		.where(eq(schema.lorebooks.id, book!.id))
	return { owner, guest, session: session!, card: card!, member, seat: seat! }
}

const view = async (w: Awaited<ReturnType<typeof world>>, userId: number) => {
	const { lorebookAnnexViewFor } = await import("./annex")
	return lorebookAnnexViewFor(testDb as any, w.session.id, userId)
}

describe("a book's stored audience, read by session (switch on)", () => {
	test("a card-form audience is read as the seat that holds the card", async () => {
		const w = await world((x) => [`character:${x.card}`])
		memberFormSwitch.on = true
		const seen = await view(w, w.owner.id)
		expect(asked.refs).toEqual([`player-seat:${w.seat.id}`])
		expect(seen).toEqual({ [OWNER]: { mood: "wary" } })
		expect(await view(w, w.guest.id)).toEqual({})
	})

	test("an audience already in member form works as it is", async () => {
		const w = await world((x) => [`player-seat:${x.seat}`])
		memberFormSwitch.on = true
		expect(await view(w, w.owner.id)).toEqual({ [OWNER]: { mood: "wary" } })
		expect(asked.refs).toEqual([`player-seat:${w.seat.id}`])
		const w2 = await world((x) => [`seated-member:${x.member}`])
		memberFormSwitch.on = true
		await view(w2, w2.owner.id)
		expect(asked.refs).toEqual([`seated-member:${w2.member.id}`])
	})

	test("switch off: the refs are as stored", async () => {
		const w = await world((x) => [`character:${x.card}`])
		memberFormSwitch.on = false
		await view(w, w.owner.id)
		expect(asked.refs).toEqual([`character:${w.card.id}`])
	})
})
