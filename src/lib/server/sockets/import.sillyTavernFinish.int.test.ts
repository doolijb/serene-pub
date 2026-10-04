/**
 * The SillyTavern folder import finishes the job (plan A13), and says what
 * happened in plain words (A24's import leftovers):
 *
 * - a chat that reads a lorebook seats its characters and persona in that
 *   book's cast, as reading a book into a session does (`runLorebookBindingCheck`);
 * - a book it makes is queued for its vectors and annotations, as an entry
 *   save queues them;
 * - a card's book keeps its scan depth, budget and recursion (`extraJson`);
 * - a book and a session land whole or not at all — one transaction each, the
 *   rows written in batches — so a failure never leaves half of one behind;
 * - a failure the person reads is a sentence, never the database's text, and
 *   the whole error goes to the server log; a character that landed without
 *   its book is reported as landed.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { DrizzleQueryError, eq } from "drizzle-orm"
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

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

const enqueued = vi.hoisted(() => ({
	vectors: [] as number[],
	annotations: [] as number[]
}))
vi.mock("$lib/server/embedding/vectorizationQueue", async (importOriginal) => ({
	...(await importOriginal<object>()),
	autoEnqueueLorebook: vi.fn(async (id: number) => {
		enqueued.vectors.push(id)
	})
}))
vi.mock("$lib/server/annotations/queue", async (importOriginal) => ({
	...(await importOriginal<object>()),
	enqueueLorebookAnnotation: vi.fn((id: number) => {
		enqueued.annotations.push(id)
	})
}))

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-import-st-finish-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const noopEmit = () => {}
const adminSocket = (userId: number) =>
	({ user: { id: userId, isAdmin: true } }) as any

function pngBytes(): Buffer {
	const png = new PNG({ width: 1, height: 1 })
	png.data.fill(255)
	return PNG.sync.write(png)
}

function cardPng(name: string, data: Record<string, unknown> = {}): Buffer {
	const chunks = extract(pngBytes())
	const card = {
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
			Buffer.from(JSON.stringify(card)).toString("base64")
		)
	)
	return Buffer.from(encode(chunks))
}

const jsonl = (lines: unknown[]) =>
	lines.map((l) => JSON.stringify(l)).join("\n") + "\n"

const ROOT = "data/default-user"

/** Stage `files` (relative to the data root), scan, and import everything. */
async function importTree(
	userId: number,
	files: Record<string, string | Buffer>,
	emit: (event: string, data: any) => void = noopEmit
) {
	const {
		importStartSillyTavernSession,
		importStageSillyTavernFiles,
		importScanSillyTavern,
		importExecuteSillyTavern
	} = await import("./import")
	const socket = adminSocket(userId)
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
		{ importSessionId: importSessionId!, manifest, blob: Buffer.concat(chunks) },
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
		emit
	)
}

/** Every event the import sent, lazy payloads built as `emitToUser` builds them. */
function recorder() {
	const sent: Array<{ event: string; data: any }> = []
	const emit = (event: string, data: any): any => {
		if (typeof data !== "function") {
			sent.push({ event, data })
			return
		}
		return (async () => {
			try {
				sent.push({ event, data: await data() })
			} catch (e) {
				console.error(`Error building the payload for ${event}:`, e)
			}
		})()
	}
	return { sent, emit }
}

/** A book the person already has, with one cast member no card stands behind. */
async function existingBook(userId: number, name: string) {
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ userId, name, description: "" })
		.returning()
	await testDb
		.insert(schema.lorebookBindings)
		.values({ lorebookId: book!.id, binding: "{{char:1}}", name: "Stranger" })
	await testDb
		.update(schema.lorebooks)
		.set({ nextBindingNumber: 2 })
		.where(eq(schema.lorebooks.id, book!.id))
	return book!
}

const SETTINGS = JSON.stringify({
	power_user: {
		personas: { "user-default.png": "Jody" },
		persona_descriptions: {
			"user-default.png": { description: "The one asking.", position: 0 }
		}
	}
})

const ARIA_BOOK = {
	name: "Aria's Lore",
	scan_depth: 4,
	token_budget: 512,
	recursive_scanning: true,
	entries: [
		{ keys: ["tavern"], content: "The tavern is warm.", comment: "Tavern" },
		{ keys: ["cellar"], content: "The cellar floods.", comment: "Cellar" }
	]
}

const bookNamed = (userId: number, name: string) =>
	testDb.query.lorebooks.findFirst({
		where: (l, { and, eq }) => and(eq(l.userId, userId), eq(l.name, name))
	})

const sessionNamed = (userId: number, name: string) =>
	testDb.query.sessions.findFirst({
		where: (s, { and, eq }) => and(eq(s.userId, userId), eq(s.name, name))
	})

const characterNamed = (userId: number, name: string) =>
	testDb.query.characters.findFirst({
		where: (c, { and, eq }) => and(eq(c.userId, userId), eq(c.name, name))
	})

/** The characters the book's cast is bound to, by name. */
async function castOf(lorebookId: number): Promise<string[]> {
	const rows = await testDb
		.select({ name: schema.characters.name })
		.from(schema.lorebookBindings)
		.innerJoin(
			schema.characters,
			eq(schema.characters.id, schema.lorebookBindings.characterId)
		)
		.where(eq(schema.lorebookBindings.lorebookId, lorebookId))
	return rows.map((r) => r.name).sort()
}

let n = 0
async function user() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, `st-finish-${++n}`)
}

describe("a chat that reads a book seats its cast in it", () => {
	test("a solo chat reading its character's book: the character and the persona are cast members", async () => {
		const u = await user()
		const result = await importTree(u.id, {
			"settings.json": SETTINGS,
			"User Avatars/user-default.png": pngBytes(),
			"characters/Aria.png": cardPng("Aria", { character_book: ARIA_BOOK }),
			"chats/Aria/Aria - one.jsonl": jsonl([
				{ user_name: "Jody", character_name: "Aria", chat_metadata: {} },
				{ name: "Aria", is_user: false, send_date: 1704304800000, mes: "Hello." },
				{ name: "Jody", is_user: true, send_date: 1704304860000, mes: "Hi." }
			])
		})
		expect(result.errors ?? []).toEqual([])
		const book = await bookNamed(u.id, "Aria's Lore")
		const session = await sessionNamed(u.id, "Aria - one")
		expect(session?.lorebookId).toBe(book!.id)
		expect(await castOf(book!.id)).toEqual(["Aria", "Jody"])
	})

	test("a group chat reading a World Info book: every member and the persona", async () => {
		const u = await user()
		const result = await importTree(u.id, {
			"settings.json": SETTINGS,
			"characters/Aria.png": cardPng("Aria"),
			"characters/Bram.png": cardPng("Bram"),
			"worlds/Eldoria.json": JSON.stringify({
				entries: { "0": { uid: 0, key: ["castle"], content: "A castle." } }
			}),
			"groups/1700000000000.json": JSON.stringify({
				id: "1700000000000",
				name: "Tavern Night",
				members: ["Aria.png", "Bram.png"],
				chat_metadata: { world_info: "Eldoria" },
				chat_id: "night"
			}),
			"group chats/night.jsonl": jsonl([
				{ user_name: "Jody", chat_metadata: {} },
				{ name: "Bram", is_user: false, send_date: 1704304860000, mes: "Evening." }
			])
		})
		expect(result.errors ?? []).toEqual([])
		const book = await bookNamed(u.id, "Eldoria")
		const session = await sessionNamed(u.id, "Tavern Night")
		expect(session?.lorebookId).toBe(book!.id)
		expect(await castOf(book!.id)).toEqual(["Aria", "Bram", "Jody"])
	})
})

describe("a book the import makes", () => {
	test("keeps its scan depth, budget and recursion, and is queued for vectors and annotations", async () => {
		const u = await user()
		const result = await importTree(u.id, {
			"characters/Aria.png": cardPng("Aria", { character_book: ARIA_BOOK }),
			"worlds/Eldoria.json": JSON.stringify({
				entries: { "0": { uid: 0, key: ["castle"], content: "A castle." } }
			})
		})
		expect(result.errors ?? []).toEqual([])
		const aria = await bookNamed(u.id, "Aria's Lore")
		const eldoria = await bookNamed(u.id, "Eldoria")
		expect(aria?.extraJson).toEqual({
			scanDepth: 4,
			tokenBudget: 512,
			recursiveScanning: true
		})
		expect(enqueued.vectors).toEqual(expect.arrayContaining([aria!.id, eldoria!.id]))
		expect(enqueued.annotations).toEqual(
			expect.arrayContaining([aria!.id, eldoria!.id])
		)
		const entries = await testDb
			.select({ title: schema.lorebookEntries.title, position: schema.lorebookEntries.position })
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.lorebookId, aria!.id))
		expect(entries.sort((a, b) => a.position - b.position).map((e) => e.title)).toEqual([
			"Tavern",
			"Cellar"
		])
	})

	test("a book whose entry the database refuses is not made at all, and the report is a sentence", async () => {
		const u = await user()
		const logged = vi.spyOn(console, "error").mockImplementation(() => {})
		try {
			const result = await importTree(u.id, {
				"characters/Aria.png": cardPng("Aria"),
				"worlds/Broken.json": JSON.stringify({
					entries: {
						"0": { uid: 0, key: ["fine"], content: "A fine entry." },
						// Postgres keeps no NUL in text: this row fails its insert.
						"1": { uid: 1, key: ["bad"], content: "A \u0000 byte." }
					}
				})
			})
			const line = (result.errors ?? []).find((e) => e.includes("Broken"))
			expect(line).toBe(
				'Lorebook "Broken": Something went wrong on the server. The server log has the details.'
			)
			expect(await bookNamed(u.id, "Broken")).toBeUndefined()
			expect(logged).toHaveBeenCalled()
		} finally {
			logged.mockRestore()
		}
	})
})

describe("a character that lands without its book says so", () => {
	test("the character is imported, the book is not, and the line says which", async () => {
		const u = await user()
		const logged = vi.spyOn(console, "error").mockImplementation(() => {})
		try {
			const result = await importTree(u.id, {
				"characters/Aria.png": cardPng("Aria", {
					character_book: {
						name: "Aria's Broken Lore",
						entries: [
							{ keys: ["a"], content: "Fine." },
							{ keys: ["b"], content: "A \u0000 byte." }
						]
					}
				})
			})
			expect(await characterNamed(u.id, "Aria")).toBeDefined()
			expect(await bookNamed(u.id, "Aria's Broken Lore")).toBeUndefined()
			expect(result.errors).toEqual([
				'Character "Aria" was imported without its lorebook "Aria\'s Broken Lore": Something went wrong on the server. The server log has the details.'
			])
			expect(result.message).toContain("1 character")
		} finally {
			logged.mockRestore()
		}
	})
})

describe("a session lands whole or not at all", () => {
	test("a chat whose message the database refuses leaves no session behind", async () => {
		const u = await user()
		const logged = vi.spyOn(console, "error").mockImplementation(() => {})
		try {
			const result = await importTree(u.id, {
				"characters/Aria.png": cardPng("Aria"),
				"chats/Aria/Aria - broken.jsonl": jsonl([
					{ user_name: "Jody", character_name: "Aria", chat_metadata: {} },
					{ name: "Aria", is_user: false, send_date: 1704304800000, mes: "Hello." },
					{ name: "Jody", is_user: true, send_date: 1704304860000, mes: "A \u0000 byte." }
				])
			})
			expect(result.errors).toEqual([
				'Session "Aria - broken": Something went wrong on the server. The server log has the details.'
			])
			expect(await sessionNamed(u.id, "Aria - broken")).toBeUndefined()
		} finally {
			logged.mockRestore()
		}
	})
})

describe("a chat file it cannot read is reported, never dropped", () => {
	test("a solo chat with one damaged line: a line that names it, and no session", async () => {
		const u = await user()
		const result = await importTree(u.id, {
			"characters/Aria.png": cardPng("Aria"),
			"chats/Aria/Aria - damaged.jsonl":
				jsonl([
					{ user_name: "Jody", character_name: "Aria", chat_metadata: {} },
					{ name: "Aria", is_user: false, send_date: 1704304800000, mes: "Hello." }
				]) + "{not json\n"
		})
		expect(result.errors).toEqual([
			'Session "Aria - damaged": Line 3 of the chat file is not valid JSON, so the chat was not imported.'
		])
		expect(result.message).toBe("Imported 1 character. 1 item(s) had errors.")
		expect(await sessionNamed(u.id, "Aria - damaged")).toBeUndefined()
	})

	test("an empty solo chat file: a line that says so", async () => {
		const u = await user()
		const result = await importTree(u.id, {
			"characters/Aria.png": cardPng("Aria"),
			"chats/Aria/Aria - empty.jsonl": "\n"
		})
		expect(result.errors).toEqual([
			'Session "Aria - empty": The chat file is missing or empty, so there is nothing to import.'
		])
	})

	test("a group chat whose history file is damaged: a line that names it, and no empty group", async () => {
		const u = await user()
		const result = await importTree(u.id, {
			"characters/Aria.png": cardPng("Aria"),
			"characters/Bram.png": cardPng("Bram"),
			"groups/1700000000001.json": JSON.stringify({
				id: "1700000000001",
				name: "Broken Night",
				members: ["Aria.png", "Bram.png"],
				chat_id: "broken-night"
			}),
			"group chats/broken-night.jsonl": '{"user_name":"Jody"}\n{"name":"Bram",'
		})
		expect(result.errors).toEqual([
			'Group session "Broken Night": Line 2 of the chat file is not valid JSON, so the chat was not imported.'
		])
		expect(await sessionNamed(u.id, "Broken Night")).toBeUndefined()
	})
})

describe("a book the import makes meets the lorebook import's limits", () => {
	test("its settings are kept only as the numbers and switch they are", async () => {
		const u = await user()
		const result = await importTree(u.id, {
			"characters/Aria.png": cardPng("Aria", {
				character_book: {
					name: "Odd Settings",
					scan_depth: "x".repeat(10_000),
					token_budget: { any: ["thing"] },
					recursive_scanning: "yes",
					entries: [{ keys: ["a"], content: "A." }]
				}
			})
		})
		expect(result.errors ?? []).toEqual([])
		expect((await bookNamed(u.id, "Odd Settings"))?.extraJson).toEqual({})
	})

	test("a description past the lorebook import's ceiling is refused in its sentence", async () => {
		const u = await user()
		const result = await importTree(u.id, {
			"worlds/Huge.json": JSON.stringify({
				description: "x".repeat(200_001),
				entries: { "0": { uid: 0, key: ["a"], content: "A." } }
			})
		})
		expect(result.errors).toEqual([
			"Lorebook \"Huge\": This lorebook's description is 200,001 characters; Serene Pub reads up to 200,000."
		])
		expect(await bookNamed(u.id, "Huge")).toBeUndefined()
	})
})

describe("an import that stops or lands nothing says so", () => {
	test("a stop after a book landed: the reason apart from the item errors, and the book finished", async () => {
		const u = await user()
		const logged = vi.spyOn(console, "error").mockImplementation(() => {})
		// The first character lookup is the fallback persona's, after the
		// books and before the sessions.
		const spy = vi
			.spyOn(testDb.query.characters, "findFirst")
			.mockRejectedValue(
				new DrizzleQueryError('select from "characters"', [], new Error("boom"))
			)
		enqueued.vectors.length = 0
		try {
			const result = await importTree(u.id, {
				"worlds/Eldoria.json": JSON.stringify({
					entries: { "0": { uid: 0, key: ["castle"], content: "A castle." } }
				})
			})
			const book = await bookNamed(u.id, "Eldoria")
			expect(book).toBeDefined()
			expect(result).toMatchObject({
				success: true,
				conclusion: "stopped",
				message: "Imported 1 lorebook.",
				stoppedBecause:
					"Something went wrong on the server. The server log has the details."
			})
			expect(result.errors).toBeUndefined()
			expect(enqueued.vectors).toContain(book!.id)
		} finally {
			spy.mockRestore()
			logged.mockRestore()
		}
	})

	test("an import whose every item failed lands nothing", async () => {
		const u = await user()
		const result = await importTree(u.id, {
			"worlds/Huge.json": JSON.stringify({
				description: "x".repeat(200_001),
				entries: { "0": { uid: 0, key: ["a"], content: "A." } }
			})
		})
		expect(result).toMatchObject({ success: true, conclusion: "nothing" })
	})

	test("a clean import is complete, and one with a failed item is partial", async () => {
		const u = await user()
		const clean = await importTree(u.id, { "characters/Aria.png": cardPng("Aria") })
		expect(clean.conclusion).toBe("complete")
		const v = await user()
		const partial = await importTree(v.id, {
			"characters/Aria.png": cardPng("Aria"),
			"worlds/Huge.json": JSON.stringify({
				description: "x".repeat(200_001),
				entries: { "0": { uid: 0, key: ["a"], content: "A." } }
			})
		})
		expect(partial.conclusion).toBe("partial")
	})
})

describe("a book of a name the person already has", () => {
	test("a card's book: the character reads the existing one, and the reply says the card's was not imported", async () => {
		const u = await user()
		await testDb
			.insert(schema.lorebooks)
			.values({ userId: u.id, name: "Aria's Lore", description: "" })
		const result = await importTree(u.id, {
			"characters/Aria.png": cardPng("Aria", { character_book: ARIA_BOOK })
		})
		expect(result.warnings).toEqual([
			'Character "Aria" reads the lorebook "Aria\'s Lore" that already existed; the card\'s own lorebook of that name was not imported.'
		])
	})

	test("a World Info file: one the person had is an item not imported; one a card just brought is said once", async () => {
		const u = await user()
		await testDb
			.insert(schema.lorebooks)
			.values({ userId: u.id, name: "Eldoria", description: "" })
		const result = await importTree(u.id, {
			"characters/Aria.png": cardPng("Aria", { character_book: ARIA_BOOK }),
			"worlds/Eldoria.json": JSON.stringify({
				entries: { "0": { uid: 0, key: ["castle"], content: "A castle." } }
			}),
			"worlds/Aria's Lore.json": JSON.stringify({
				entries: { "0": { uid: 0, key: ["tavern"], content: "The tavern is warm." } }
			})
		})
		expect(result.errors).toEqual([
			'Lorebook "Eldoria" was not imported: you already have a lorebook with that name.'
		])
		expect(result.warnings).toEqual([
			'Lorebook "Aria\'s Lore" was not imported again: a character\'s lorebook of that name came in with this import.'
		])
	})
})

describe("a chat reading a book the person already has", () => {
	test("asks the person nothing about the book's cast members", async () => {
		const u = await user()
		await existingBook(u.id, "Eldoria")
		const { sent, emit } = recorder()
		const result = await importTree(
			u.id,
			{
				"characters/Aria.png": cardPng("Aria"),
				"chats/Aria/Aria - eldoria.jsonl": jsonl([
					{ user_name: "Jody", character_name: "Aria", chat_metadata: { world_info: "Eldoria" } },
					{ name: "Aria", is_user: false, send_date: 1704304800000, mes: "Hello." }
				])
			},
			emit
		)
		expect(result.errors ?? []).toEqual([])
		expect(sent.map((s) => s.event)).not.toContain("bindingCheck:result")
	})

	test("reads the line that book was last played on, as a session made here does", async () => {
		const u = await user()
		const book = await existingBook(u.id, "Eldoria")
		const [storm] = await testDb
			.insert(schema.lorebookBranches)
			.values({ lorebookId: book.id, name: "Storm" })
			.returning()
		await testDb.insert(schema.sessions).values({
			userId: u.id,
			isGroup: false,
			name: "Played on the storm line",
			lorebookId: book.id,
			lorebookBranchId: storm!.id
		})
		await importTree(u.id, {
			"characters/Aria.png": cardPng("Aria"),
			"chats/Aria/Aria - storm.jsonl": jsonl([
				{ user_name: "Jody", character_name: "Aria", chat_metadata: { world_info: "Eldoria" } },
				{ name: "Aria", is_user: false, send_date: 1704304800000, mes: "Hello." }
			])
		})
		expect((await sessionNamed(u.id, "Aria - storm"))?.lorebookBranchId).toBe(storm!.id)
	})
})
