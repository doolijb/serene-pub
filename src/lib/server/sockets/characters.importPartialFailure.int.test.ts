/**
 * Reproduction for the reported bug: importing a SillyTavern character card
 * shows an import *failure*, but the character turns out to have been imported
 * anyway (visible after a refresh), and the sidebar list never updates.
 *
 * The cause is ordering, not parsing. charactersImportCard does:
 *
 *   1. parse the card                     <- succeeds
 *   2. INSERT the character row           <- committed, no transaction
 *   3. write the avatar + tags            <- can throw here
 *   4. refresh the character list
 *   5. emit success
 *
 * Step 3 rejects any avatar over 10MB, which real SillyTavern cards routinely
 * exceed since the card IS a full-resolution PNG portrait. The row from step 2
 * is already committed, so the user gets an error toast for a character that
 * exists — and because step 4 never runs, the list doesn't show it until
 * something else refreshes.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import { randomBytes } from "node:crypto"
import { PNG } from "pngjs"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-import-partial-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

async function makeUser(username: string) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, username)
}

const fakeSocket = (userId: number) => ({ user: { id: userId } }) as any

/**
 * A PNG whose raw bytes exceed the 10MB avatar cap, with a character card
 * embedded in a tEXt chunk — i.e. the shape of a real high-resolution
 * SillyTavern card. Random pixel data so it doesn't compress away.
 */
function buildOversizedCharacterPng(name: string): Buffer {
	const png = new PNG({ width: 2048, height: 2048 })
	// Cryptographic randomness, not an arithmetic pattern — PNG is deflate
	// compressed, and any periodic fill collapses to a few tens of KB, well
	// under the cap this test is about.
	randomBytes(png.data.length).copy(png.data)
	const base = PNG.sync.write(png)
	const card = {
		spec: "chara_card_v2",
		spec_version: "2.0",
		data: {
			name,
			description: "Imported from SillyTavern",
			personality: "",
			scenario: "",
			first_mes: "Hi",
			mes_example: "",
			alternate_greetings: [],
			tags: [],
			extensions: {}
		}
	}
	const payload = Buffer.from(JSON.stringify(card), "utf-8").toString(
		"base64"
	)
	const keyword = Buffer.from("chara", "latin1")
	const chunkData = Buffer.concat([
		keyword,
		Buffer.from([0]),
		Buffer.from(payload, "latin1")
	])
	const length = Buffer.alloc(4)
	length.writeUInt32BE(chunkData.length, 0)
	const type = Buffer.from("tEXt", "latin1")
	const crcTable: number[] = []
	for (let n = 0; n < 256; n++) {
		let c = n
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
		crcTable[n] = c >>> 0
	}
	let crc = 0xffffffff
	for (const byte of Buffer.concat([type, chunkData])) {
		crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
	}
	const crcBuf = Buffer.alloc(4)
	crcBuf.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 0)
	const chunk = Buffer.concat([length, type, chunkData, crcBuf])

	// Insert immediately after the 8-byte signature + IHDR chunk.
	const ihdrLength = base.readUInt32BE(8)
	const insertAt = 8 + 4 + 4 + ihdrLength + 4
	return Buffer.concat([
		base.subarray(0, insertAt),
		chunk,
		base.subarray(insertAt)
	])
}

describe("character import partial failure", () => {
	test("an oversized avatar imports the character with a warning, not an error", async () => {
		const { charactersImportCard } = await import("./characters")
		const user = await makeUser("oversized-avatar-user")

		const png = buildOversizedCharacterPng("Oversized Hero")
		expect(png.length).toBeGreaterThan(10 * 1024 * 1024)

		const emitted: { event: string; payload: any }[] = []
		const emit = (event: string, payload: any) =>
			emitted.push({ event, payload })

		const res = await charactersImportCard.handler(
			fakeSocket(user.id),
			{ file: png.toString("base64") },
			emit as any
		)

		// The import genuinely succeeded, so it is reported as a success.
		expect(res.status).toBe("created")
		expect(res.character?.name).toBe("Oversized Hero")
		expect(
			emitted.some((e) => e.event === "characters:importCard:error"),
			"an import that actually succeeded must not emit an error"
		).toBe(false)

		// The user is still told what was skipped.
		expect(res.warnings?.join(" ")).toMatch(/image could not be saved/i)

		// The row is present, with no avatar rather than a broken one.
		const rows = await testDb.query.characters.findMany({
			where: eq(schema.characters.userId, user.id)
		})
		expect(rows.map((r) => r.name)).toContain("Oversized Hero")
		expect(rows.find((r) => r.name === "Oversized Hero")?.avatar).toBeFalsy()

		// And the sidebar is told to update, which is what previously left the
		// character invisible until an unrelated refresh.
		expect(
			emitted.some((e) => e.event === "characters:list"),
			"the character list must be refreshed after an import"
		).toBe(true)
	}, 60_000)

	test("a genuinely broken card still fails, with nothing committed", async () => {
		// The other half of the contract: making avatar failures non-fatal must
		// not make real failures silent. An error must still mean "nothing was
		// imported", or the fix would just move the confusion.
		const { charactersImportCard } = await import("./characters")
		const user = await makeUser("broken-card-user")

		const emitted: { event: string; payload: any }[] = []
		const emit = (event: string, payload: any) =>
			emitted.push({ event, payload })

		await expect(
			charactersImportCard.handler(
				fakeSocket(user.id),
				{ file: Buffer.from("not a character card").toString("base64") },
				emit as any
			)
		).rejects.toThrow()

		expect(
			emitted.some((e) => e.event === "characters:importCard:error")
		).toBe(true)
		const rows = await testDb.query.characters.findMany({
			where: eq(schema.characters.userId, user.id)
		})
		expect(rows).toHaveLength(0)
	}, 60_000)

	test("a normal card still imports cleanly with no warnings", async () => {
		const { charactersImportCard } = await import("./characters")
		const user = await makeUser("clean-import-user")

		const card = {
			spec: "chara_card_v2",
			spec_version: "2.0",
			data: {
				name: "Clean Hero",
				description: "d",
				personality: "",
				scenario: "",
				first_mes: "hi",
				mes_example: "",
				alternate_greetings: [],
				tags: ["adventure"],
				extensions: {}
			}
		}

		const emitted: { event: string; payload: any }[] = []
		const emit = (event: string, payload: any) =>
			emitted.push({ event, payload })

		const res = await charactersImportCard.handler(
			fakeSocket(user.id),
			{
				file: Buffer.from(JSON.stringify(card), "utf-8").toString(
					"base64"
				)
			},
			emit as any
		)

		expect(res.status).toBe("created")
		expect(res.warnings).toBeUndefined()
		expect(emitted.some((e) => e.event === "characters:list")).toBe(true)
	}, 60_000)
})

describe("persona import partial failure", () => {
	test("an oversized avatar imports the persona with a warning, not an error", async () => {
		const { personasImportCard } = await import("./personas")
		const user = await makeUser("oversized-persona-user")

		const png = buildOversizedCharacterPng("Oversized Persona")
		const emitted: { event: string; payload: any }[] = []
		const emit = (event: string, payload: any) =>
			emitted.push({ event, payload })

		const res = await personasImportCard.handler(
			fakeSocket(user.id),
			{ file: png.toString("base64") },
			emit as any
		)

		expect(res.status).toBe("created")
		expect(res.persona?.name).toBe("Oversized Persona")
		expect(
			emitted.some((e) => e.event === "personas:importCard:error"),
			"an import that actually succeeded must not emit an error"
		).toBe(false)
		expect(res.warnings?.join(" ")).toMatch(/image could not be saved/i)
		expect(
			emitted.some((e) => e.event === "personas:list"),
			"the persona list must be refreshed after an import"
		).toBe(true)
	}, 60_000)

	test("a genuinely broken persona card still fails, with nothing committed", async () => {
		const { personasImportCard } = await import("./personas")
		const user = await makeUser("broken-persona-user")

		const emitted: { event: string; payload: any }[] = []
		const emit = (event: string, payload: any) =>
			emitted.push({ event, payload })

		await expect(
			personasImportCard.handler(
				fakeSocket(user.id),
				{ file: Buffer.from("not a card").toString("base64") },
				emit as any
			)
		).rejects.toThrow()

		const rows = await testDb.query.personas.findMany({
			where: eq(schema.personas.userId, user.id)
		})
		expect(rows).toHaveLength(0)
	}, 60_000)
})
