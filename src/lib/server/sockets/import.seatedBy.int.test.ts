/**
 * 🚧 A SillyTavern import seats the imported cards by the importing user
 * (owner 2026-11-05: "The person who seated it"), on both paths that seat:
 * a solo chat and a group chat.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { asc, eq } from "drizzle-orm"
import encode from "png-chunks-encode"
import extract from "png-chunks-extract"
import text from "png-chunk-text"
import { PNG } from "pngjs"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async (importOriginal) => {
	const actual = await importOriginal<typeof import("$lib/server/db")>()
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { ...actual, db }
})
vi.mock("$lib/server/embedding/vectorizationQueue", async (importOriginal) => ({
	...(await importOriginal<object>()),
	autoEnqueueLorebook: vi.fn(async () => {})
}))
vi.mock("$lib/server/annotations/queue", async (importOriginal) => ({
	...(await importOriginal<object>()),
	enqueueLorebookAnnotation: vi.fn(() => {})
}))

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-import-seated-by-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(testDb)
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

let n = 0
const uniq = (label: string) => `${label}-${++n}`

async function user() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, uniq("import-seated-by"))
}

const charSeats = (sessionId: number) =>
	testDb
		.select()
		.from(schema.sessionCharacters)
		.where(eq(schema.sessionCharacters.sessionId, sessionId))
		.orderBy(asc(schema.sessionCharacters.position))

const linesOf = (sessionId: number) =>
	testDb
		.select()
		.from(schema.sessionMessages)
		.where(eq(schema.sessionMessages.sessionId, sessionId))
		.orderBy(asc(schema.sessionMessages.id))

function pngBytes(): Buffer {
	const png = new PNG({ width: 1, height: 1 })
	png.data.fill(255)
	return PNG.sync.write(png)
}

function cardPng(name: string, data: Record<string, unknown> = {}): Buffer {
	const chunks = extract(pngBytes())
	const body = {
		spec: "chara_card_v2",
		spec_version: "2.0",
		data: {
			name,
			description: `${name}.`,
			personality: "",
			scenario: "",
			first_mes: "Hello.",
			mes_example: "",
			creator_notes: "",
			system_prompt: "",
			post_history_instructions: "",
			alternate_greetings: [],
			tags: [],
			creator: "",
			character_version: "",
			extensions: {},
			...data
		}
	}
	chunks.splice(
		chunks.findIndex((c) => c.name === "IEND"),
		0,
		text.encode(
			"chara",
			Buffer.from(JSON.stringify(body)).toString("base64")
		)
	)
	return Buffer.from(encode(chunks))
}

const jsonl = (lines: unknown[]) =>
	lines.map((l) => JSON.stringify(l)).join("\n") + "\n"
const ROOT = "data/default-user"
const noopEmit = () => {}

async function importTree(
	userId: number,
	files: Record<string, string | Buffer>
) {
	const {
		importStartSillyTavernSession,
		importStageSillyTavernFiles,
		importScanSillyTavern,
		importExecuteSillyTavern
	} = await import("$lib/server/sockets/import")
	const socket = { user: { id: userId, isAdmin: true } } as any
	const { importSessionId } = await importStartSillyTavernSession.handler(
		socket,
		{},
		noopEmit
	)
	const manifest: Array<{ relativePath: string; length: number }> = []
	const chunks: Buffer[] = []
	for (const [rel, contents] of Object.entries(files)) {
		const buf = Buffer.from(contents)
		manifest.push({ relativePath: `${ROOT}/${rel}`, length: buf.length })
		chunks.push(buf)
	}
	const staged = await importStageSillyTavernFiles.handler(
		socket,
		{
			importSessionId: importSessionId!,
			manifest,
			blob: Buffer.concat(chunks)
		},
		noopEmit
	)
	expect(staged.success).toBe(true)
	const scan = await importScanSillyTavern.handler(
		socket,
		{
			importSessionId: importSessionId!,
			deferredSessionPaths: Object.keys(files).filter((f) =>
				f.startsWith("chats/")
			)
		},
		noopEmit
	)
	expect(scan.success).toBe(true)
	return importExecuteSillyTavern.handler(
		socket,
		{ importSessionId: importSessionId!, selectedData: scan.data! },
		noopEmit
	)
}

const SETTINGS = JSON.stringify({
	power_user: {
		personas: { "user-default.png": "Jody" },
		persona_descriptions: {
			"user-default.png": { description: "The one asking.", position: 0 }
		}
	}
})

const sessionNamed = (userId: number, name: string) =>
	testDb.query.sessions.findFirst({
		where: (s, { and, eq }) => and(eq(s.userId, userId), eq(s.name, name))
	})

describe("an imported session's seats are seated by the importer", () => {
	it("a solo chat", async () => {
		const u = await user()
		const result = await importTree(u.id, {
			"settings.json": SETTINGS,
			"User Avatars/user-default.png": pngBytes(),
			"characters/Aria.png": cardPng("Aria"),
			"chats/Aria/Aria - seated.jsonl": jsonl([
				{
					user_name: "Jody",
					character_name: "Aria",
					chat_metadata: {}
				},
				{
					name: "Aria",
					is_user: false,
					send_date: 1704304800000,
					mes: "Hello."
				}
			])
		})
		expect(result.errors ?? []).toEqual([])
		const s = await sessionNamed(u.id, "Aria - seated")
		const seats = await charSeats(s!.id)
		expect(seats).toHaveLength(1)
		expect(seats[0]!.seatedByUserId).toBe(u.id)
	})

	it("a group chat", async () => {
		const u = await user()
		const result = await importTree(u.id, {
			"settings.json": SETTINGS,
			"characters/Aria.png": cardPng("Aria"),
			"characters/Bram.png": cardPng("Bram"),
			"groups/1700000000003.json": JSON.stringify({
				id: "1700000000003",
				name: "Seated Night",
				members: ["Aria.png", "Bram.png"],
				chat_metadata: {},
				chat_id: "seated-night"
			}),
			"group chats/seated-night.jsonl": jsonl([
				{ user_name: "Jody", chat_metadata: {} },
				{
					name: "Bram",
					is_user: false,
					send_date: 1704304860000,
					mes: "Evening."
				}
			])
		})
		expect(result.errors ?? []).toEqual([])
		const s = await sessionNamed(u.id, "Seated Night")
		const seats = await charSeats(s!.id)
		expect(seats).toHaveLength(2)
		expect(seats.every((r) => r.seatedByUserId === u.id)).toBe(true)
	})
})
