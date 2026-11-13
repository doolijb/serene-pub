/**
 * 🚧 Stops follow the names the prompt shows (plan §27 S2): rows layered with
 * `seatCardsAsRead` carry the seated member's own name, so the speaker stops
 * and the speaking turn's own labels are the member's, not the card's.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { seatCardsAsRead } from "$lib/server/pipelines/prompt/seatCards"
import { composeStopsFor, ownLabelsFor } from "./stops"
import { insertCastMember } from "$lib/server/characters/versions"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async (importOriginal) => {
	const actual = await importOriginal<typeof import("$lib/server/db")>()
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { ...actual, db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-stopseat-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const db = () => testDb as unknown as Db

const CONNECTION = {
	type: "koboldcpp",
	promptFormat: "chatml",
	wireMode: "completion"
}

describe("stops on the seated member's names", () => {
	test("speaker stops and own labels use the member's name, not the card's", async () => {
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const u = await createTestUser(testDb, "stopseat-1")
		const mk = async (name: string) =>
			(
				await testDb
					.insert(schema.characters)
					.values({ userId: u.id, name, description: "The card." })
					.returning()
			)[0]!
		const speaker = await mk("Cardspeaker")
		const other = await mk("Cardother")
		const [book] = await testDb
			.insert(schema.lorebooks)
			.values({ userId: u.id, name: "Stop book" } as any)
			.returning()
		const bind = async (cardId: number, ownName: string) =>
			(
				await insertCastMember(testDb, {
					lorebookId: book!.id,
					characterId: cardId,
					binding: `{{char:${ownName}}}`,
					name: ownName,
					ownName
				} as any)
			).member
		const mSpeaker = await bind(speaker.id, "Memberspeaker")
		const mOther = await bind(other.id, "Memberother")
		const [s] = await testDb
			.insert(schema.sessions)
			.values({
				userId: u.id,
				isGroup: true,
				name: "Stops",
				lorebookId: book!.id
			} as any)
			.returning()
		await testDb.insert(schema.sessionCharacters).values([
			{
				sessionId: s.id,
				characterId: speaker.id,
				castMemberId: mSpeaker.id,
				position: 0
			},
			{
				sessionId: s.id,
				characterId: other.id,
				castMemberId: mOther.id,
				position: 1
			}
		] as any)
		const raw = (await testDb.query.sessionCharacters.findMany({
			where: (cc, { eq }) => eq(cc.sessionId, s.id),
			with: { character: true },
			orderBy: (cc, { asc }) => asc(cc.position)
		})) as any[]
		const layered = await seatCardsAsRead(db(), s.id, raw)

		const { sent } = composeStopsFor(
			CONNECTION,
			{ sessionCharacters: layered },
			{ currentCharacterId: speaker.id }
		)
		const values = sent.map((x) => x.value)
		expect(values).toContain("Memberother:")
		expect(values).not.toContain("Cardother:")
		// The speaker's own label is never a stop.
		expect(values).not.toContain("Memberspeaker:")

		expect(
			ownLabelsFor({ sessionCharacters: layered }, speaker.id, null)
		).toEqual(["Memberspeaker"])
		// Unlayered, the same rows name the cards (what the layering changes).
		expect(
			ownLabelsFor({ sessionCharacters: raw }, speaker.id, null)
		).toEqual(["Cardspeaker"])
	})
})
