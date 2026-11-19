/**
 * A guest's turn still writes lore to the session's notes (G2: "play still
 * writes lore through pipelines whoever speaks"): a session with no attached
 * lorebook, a host made with the GUEST's user id, one entry committed through
 * the real create outlet; the same turn through the knowledge-tie outlet
 * (`note-entry-knowledge`) and through the update outlet. Each lands in the
 * session's own book; the owner's run is the twin.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { WORLD_LORE_TYPE_ID } from "$lib/shared/entries/types"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
})

let db: TestDb
let dataDir: string
let n = 0

const NOTE = { key: "note", definitionId: "core:outlet/note-entry-knowledge" } as any
const UPDATE = { key: "change", definitionId: "core:outlet/update-lore-entry" } as any
const CREATE = {
	key: "file",
	definitionId: "core:outlet/create-lore-entry"
} as any

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-guest-turn-notes-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

/** A session on its own notes alone, owned by one user, with a second as its guest. */
async function world() {
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const owner = await createTestUser(db, `guest-turn-owner-${suffix}`)
	const guest = await createTestUser(db, `guest-turn-guest-${suffix}`)
	for (const u of [owner, guest])
		await db
			.insert(schema.userSettings)
			.values({ userId: u.id, loreWriteMode: "full" })
	const [session] = await db
		.insert(schema.sessions)
		.values({
			userId: owner.id,
			isGroup: true,
			name: `Run ${suffix}`,
			lorebookId: null
		})
		.returning()
	await db
		.insert(schema.sessionGuests)
		.values({ sessionId: session!.id, userId: guest.id })
	const { ownBookFor } = await import("$lib/server/lorebooks/ownBook")
	const own = await ownBookFor(db as any, session!.id)
	return { owner, guest, session: session!, own }
}
type World = Awaited<ReturnType<typeof world>>

/** Commit one world-lore entry as a turn run by `userId`. */
async function commitAs(w: World, userId: number) {
	const [legacy] = await db
		.insert(schema.sessionMessages)
		.values({ sessionId: w.session.id, role: "assistant", content: "…" })
		.returning()
	await db
		.insert(schema.messages)
		.values({ id: legacy!.id, sessionId: w.session.id, role: "assistant" })
	const { createHost } = await import("$lib/server/pipelines/runtime/host")
	const host = createHost(
		db as unknown as Db,
		{ sessionId: w.session.id, userId, runId: `run-${++n}` } as any
	)
	return (await host.commit!(
		{
			name: `Thing ${++n}`,
			content: "A thing.",
			params: { entryType: WORLD_LORE_TYPE_ID }
		},
		CREATE
	)) as any
}

/** A fresh assistant line of the session, as the turn the commit belongs to. */
async function newTurnMessage(w: World) {
	const [legacy] = await db
		.insert(schema.sessionMessages)
		.values({ sessionId: w.session.id, role: "assistant", content: "…" })
		.returning()
	return { id: legacy!.id, sessionId: w.session.id, role: "assistant" as const }
}

const stored = async (id: number) =>
	(
		await db
			.select()
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.id, id))
	)[0]!

describe("a turn writes lore to the session's notes whoever speaks", () => {
	it("a guest's turn: the entry lands in the session's own book", async () => {
		const w = await world()
		const made = await commitAs(w, w.guest.id)
		expect(made.id).toBeTypeOf("number")
		expect((await stored(made.id)).lorebookId).toBe(w.own.id)
	})

	it("the owner's turn does the same", async () => {
		const w = await world()
		const made = await commitAs(w, w.owner.id)
		expect((await stored(made.id)).lorebookId).toBe(w.own.id)
	})

	for (const who of ["guest", "owner"] as const) {
		it(`a ${who}'s turn through the knowledge-tie outlet: the tie lands in the session's notes`, async () => {
			const w = await world()
			const speaker = who === "guest" ? w.guest : w.owner
			const { insertCastMember } = await import("$lib/server/characters/versions")
			const member = (
				await insertCastMember(db as unknown as Db, {
					lorebookId: w.own.id,
					binding: `{{char:Tie${++n}}}`,
					name: "Mira"
				})
			).member!
			const made = await commitAs(w, w.owner.id)
			await db.insert(schema.messages).values(await newTurnMessage(w))
			const { createHost } = await import("$lib/server/pipelines/runtime/host")
			const host = createHost(
				db as unknown as Db,
				{ sessionId: w.session.id, userId: speaker.id, runId: `run-${++n}` } as any
			)
			const out = (await host.commit!({ member: member.id, entry: made.id }, NOTE)) as any
			expect(out).toMatchObject({ written: true })
			const ties = await db
				.select()
				.from(schema.narrativeRelationships)
				.where(eq(schema.narrativeRelationships.fromNodeId, member.id))
			expect(ties).toHaveLength(1)
			expect(ties[0]).toMatchObject({ lorebookId: w.own.id, toEntryId: made.id })
		})

		it(`a ${who}'s turn through the update outlet: the notes' entry changes`, async () => {
			const w = await world()
			const speaker = who === "guest" ? w.guest : w.owner
			const made = await commitAs(w, w.owner.id)
			const { createHost } = await import("$lib/server/pipelines/runtime/host")
			await db.insert(schema.messages).values(await newTurnMessage(w))
			const host = createHost(
				db as unknown as Db,
				{ sessionId: w.session.id, userId: speaker.id, runId: `run-${++n}` } as any
			)
			await host.commit!({ entry: made.id, content: `Changed by the ${who}.` }, UPDATE)
			const row = await stored(made.id)
			expect(row.lorebookId).toBe(w.own.id)
			expect(row.content).toBe(`Changed by the ${who}.`)
		})
	}
})
