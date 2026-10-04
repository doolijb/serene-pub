/**
 * A card import tells the person what happened in their words, never the
 * database's (A24's import leftover): a refusal the server raises for itself
 * — the driver's own error, which PGlite throws outside any query — is one
 * plain sentence, and a card that landed without its tags or one of its
 * sprites says so plainly, with the whole error in the server log
 * (`importFailureSentence`).
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { DrizzleQueryError } from "drizzle-orm"
import { PNG } from "pngjs"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-card-import-words-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const socketOf = (userId: number) => ({ user: { id: userId } }) as any
const SECRET = "SECRET-TAG-c3"

function recorder() {
	const sent: Array<{ event: string; data: any }> = []
	const emit = (event: string, data: any) => {
		if (typeof data !== "function") sent.push({ event, data })
	}
	return { sent, emit }
}

const cardFile = (name: string, tags: string[] = []) =>
	Buffer.from(
		JSON.stringify({
			spec: "chara_card_v2",
			spec_version: "2.0",
			data: {
				name,
				description: "A card built in a test",
				personality: "",
				scenario: "",
				first_mes: "Hello.",
				mes_example: "",
				creator_notes: "",
				system_prompt: "",
				post_history_instructions: "",
				alternate_greetings: [],
				tags,
				creator: "",
				character_version: "",
				extensions: {}
			}
		})
	).toString("base64")

let n = 0
async function user() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, `card-words-${++n}`)
}

describe("a card import in the person's words", () => {
	test("a driver error raised outside a query is a plain sentence", async () => {
		const u = await user()
		const { charactersImportCard } = await import("./characters")
		const driverError = Object.assign(
			new Error('duplicate key value violates unique constraint "characters_uuid_idx"'),
			{ code: "23505", severity: "ERROR" }
		)
		const insert = testDb.insert.bind(testDb)
		const spy = vi.spyOn(testDb, "insert").mockImplementation(((table: any) => {
			if (table === schema.characters) throw driverError
			return insert(table)
		}) as any)
		const { sent, emit } = recorder()
		try {
			await expect(
				charactersImportCard.handler(socketOf(u.id), { file: cardFile("Aria") }, emit)
			).rejects.toBe(driverError)
		} finally {
			spy.mockRestore()
		}
		expect(sent.find((s) => s.event === "characters:importCard:error")?.data.error).toBe(
			"The card could not be imported. The server log has the details."
		)
	})

	test("a card that landed without its tags says so, without the database's text", async () => {
		const u = await user()
		const { charactersImportCard } = await import("./characters")
		const insert = testDb.insert.bind(testDb)
		const spy = vi.spyOn(testDb, "insert").mockImplementation(((table: any) => {
			if (table === schema.tags)
				throw new DrizzleQueryError('insert into "tags" ("name") values ($1)', [SECRET], new Error("boom"))
			return insert(table)
		}) as any)
		const logged = vi.spyOn(console, "error").mockImplementation(() => {})
		vi.spyOn(console, "warn").mockImplementation(() => {})
		try {
			const res = await charactersImportCard.handler(
				socketOf(u.id),
				{ file: cardFile("Bram", [SECRET]) },
				() => {}
			)
			expect(res.character?.name).toBe("Bram")
			expect(res.warnings).toEqual([
				"The card's tags could not be saved: Something went wrong on the server. The server log has the details."
			])
			expect(logged).toHaveBeenCalled()
		} finally {
			spy.mockRestore()
			vi.restoreAllMocks()
		}
	})

	test("a sprite the database refuses is named without the database's text", async () => {
		const u = await user()
		const { charactersImportCard } = await import("./characters")
		const png = new PNG({ width: 1, height: 1 })
		png.data.fill(200)
		const image = `data:image/png;base64,${PNG.sync.write(png).toString("base64")}`
		// Postgres keeps no NUL in text, so this label fails the sprite's query.
		const file = Buffer.from(
			JSON.stringify({
				spec: "chara_card_v2",
				spec_version: "2.0",
				data: {
					...JSON.parse(Buffer.from(cardFile("Joy"), "base64").toString()).data,
					extensions: { risuai: { emotions: [["joy\u0000x", image]] } }
				}
			})
		).toString("base64")
		const logged = vi.spyOn(console, "error").mockImplementation(() => {})
		vi.spyOn(console, "warn").mockImplementation(() => {})
		try {
			const res = await charactersImportCard.handler(socketOf(u.id), { file }, () => {})
			expect(res.character?.name).toBe("Joy")
			expect(res.warnings).toEqual([
				"1 of the card's sprites was not imported (joy\u0000x: the server could not save it; the server log has the details)."
			])
			expect(logged).toHaveBeenCalled()
		} finally {
			vi.restoreAllMocks()
		}
	})
})
