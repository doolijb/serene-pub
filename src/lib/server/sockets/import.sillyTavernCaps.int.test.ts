/**
 * The SillyTavern folder import (admin only) under the same ceilings as the
 * one-file doors (S4 review):
 *
 * - a World Info entry, or an entry of a card's embedded book, meets the
 *   per-entry lorebook ceilings, refused in the same sentence and before any
 *   book is made;
 * - a sprite folder is measured on disk before a file in it is read;
 * - staging has a byte quota and refuses a manifest that does not add up;
 * - a staging directory a restart orphaned is swept by the next import.
 *
 * The oversized files are SPARSE and unreadable (mode 000): a refusal by
 * size, rather than EACCES, proves the size was checked before any read.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import encode from "png-chunks-encode"
import extract from "png-chunks-extract"
import text from "png-chunk-text"
import { PNG } from "pngjs"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-import-st-caps-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
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

const ROOT = "data/default-user"

/** Start a session, stage `files` (relative to the data root), scan, execute. */
async function importTree(
	userId: number,
	files: Record<string, string | Buffer>,
	afterStage?: (stagedRoot: string) => Promise<void>
) {
	const {
		importStartSillyTavernSession,
		importStageSillyTavernFiles,
		importScanSillyTavern,
		importExecuteSillyTavern
	} = await import("./import")
	const socket = adminSocket(userId)
	const started = await importStartSillyTavernSession.handler(
		socket,
		{},
		noopEmit
	)
	const importSessionId = started.importSessionId!
	const manifest: Array<{ relativePath: string; length: number }> = []
	const chunks: Buffer[] = []
	for (const [rel, contents] of Object.entries(files)) {
		const buf = Buffer.from(contents)
		manifest.push({ relativePath: `${ROOT}/${rel}`, length: buf.length })
		chunks.push(buf)
	}
	const staged = await importStageSillyTavernFiles.handler(
		socket,
		{ importSessionId, manifest, blob: Buffer.concat(chunks) },
		noopEmit
	)
	expect(staged.success).toBe(true)
	await afterStage?.(
		path.join(os.tmpdir(), `serene-pub-import-${importSessionId}`, ROOT)
	)
	const scan = await importScanSillyTavern.handler(
		socket,
		{ importSessionId, deferredSessionPaths: [] },
		noopEmit
	)
	expect(scan.success).toBe(true)
	return importExecuteSillyTavern.handler(
		socket,
		{ importSessionId, selectedData: scan.data! },
		noopEmit
	)
}

const bookNamed = (userId: number, name: string) =>
	testDb.query.lorebooks.findFirst({
		where: (l, { and, eq }) => and(eq(l.userId, userId), eq(l.name, name))
	})

describe("SillyTavern books meet the per-entry lorebook ceilings", () => {
	test("a World Info entry with a key past the ceiling is refused in the lorebook's sentence, and no book is made", async () => {
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const user = await createTestUser(testDb, "st-world-caps")
		const result = await importTree(user.id, {
			"characters/Aria.png": cardPng("Aria"),
			"worlds/Big Keys.json": JSON.stringify({
				name: "Big Keys",
				entries: {
					"0": {
						key: ["x".repeat(2001)],
						comment: "Dragon",
						content: "Lore."
					}
				}
			})
		})
		expect(result.errors?.join("\n")).toContain(
			'Lorebook "Big Keys": Entry 1 (“Dragon”) has a key 2,001 characters long; Serene Pub reads keys up to 2,000 characters.'
		)
		expect(await bookNamed(user.id, "Big Keys")).toBeUndefined()
	}, 60_000)

	test("a card's embedded book with an entry past the ceiling is refused, and no book is made", async () => {
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const user = await createTestUser(testDb, "st-card-book-caps")
		const result = await importTree(user.id, {
			"characters/Aria.png": cardPng("Aria", {
				character_book: {
					name: "Aria's Book",
					entries: [
						{
							keys: ["a"],
							comment: "Long",
							content: "x".repeat(200_001)
						}
					]
				}
			})
		})
		// The character is in; the line says so, then why its book is not.
		expect(result.errors?.join("\n")).toContain(
			'Character "Aria" was imported without its lorebook "Aria\'s Book": Entry 1 (“Long”)\'s content is 200,001 characters; Serene Pub reads up to 200,000.'
		)
		expect(await bookNamed(user.id, "Aria's Book")).toBeUndefined()
	}, 60_000)
})

describe("a SillyTavern sprite folder is measured before it is read", () => {
	test("a sprite past the per-image ceiling is skipped unread; the rest still land", async () => {
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const { SPRITE_IMPORT_LIMITS } = await import("$lib/server/sprites")
		const user = await createTestUser(testDb, "st-sprite-caps")
		const result = await importTree(
			user.id,
			{
				"characters/Aria.png": cardPng("Aria"),
				"characters/Aria/joy.png": pngBytes()
			},
			async (root) => {
				const huge = path.join(root, "characters/Aria/anger.png")
				await fs.writeFile(huge, "")
				await fs.truncate(huge, SPRITE_IMPORT_LIMITS.bytes + 1)
				await fs.chmod(huge, 0o000)
			}
		)
		expect(result.errors ?? []).toEqual([])
		expect(result.message).toContain("1 sprite")
	}, 60_000)
})

describe("SillyTavern staging", () => {
	test("a manifest whose lengths do not add up to the upload is refused, and nothing is written", async () => {
		const { importStartSillyTavernSession, importStageSillyTavernFiles } =
			await import("./import")
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const user = await createTestUser(testDb, "st-stage-manifest")
		const socket = adminSocket(user.id)
		const { importSessionId } = await importStartSillyTavernSession.handler(
			socket,
			{},
			noopEmit
		)
		const staged = await importStageSillyTavernFiles.handler(
			socket,
			{
				importSessionId: importSessionId!,
				manifest: [
					{ relativePath: "settings.json", length: 1_000_000 }
				],
				blob: Buffer.from("{}")
			},
			noopEmit
		)
		expect(staged).toEqual({
			success: false,
			error: "This upload doesn't match its own list of files, so nothing was saved."
		})
		const dir = path.join(
			os.tmpdir(),
			`serene-pub-import-${importSessionId}`
		)
		expect(await fs.readdir(dir)).toEqual([])
	}, 60_000)

	test("staging past the session's byte quota is refused in a sentence", async () => {
		const {
			importStartSillyTavernSession,
			importStageSillyTavernFiles,
			STAGING_LIMITS
		} = await import("./import")
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const user = await createTestUser(testDb, "st-stage-quota")
		const socket = adminSocket(user.id)
		const { importSessionId } = await importStartSillyTavernSession.handler(
			socket,
			{},
			noopEmit
		)
		const quota = STAGING_LIMITS.sessionBytes
		;(STAGING_LIMITS as any).sessionBytes = 10
		try {
			const stage = (name: string) =>
				importStageSillyTavernFiles.handler(
					socket,
					{
						importSessionId: importSessionId!,
						manifest: [{ relativePath: name, length: 6 }],
						blob: Buffer.from("123456")
					},
					noopEmit
				)
			expect((await stage("a.json")).success).toBe(true)
			expect(await stage("b.json")).toEqual({
				success: false,
				error: "This SillyTavern folder is larger than the 1 MB Serene Pub will stage for one import."
			})
		} finally {
			;(STAGING_LIMITS as any).sessionBytes = quota
		}
	}, 60_000)

	test("a staging directory a restart left behind is swept by the next import", async () => {
		const { importStartSillyTavernSession } = await import("./import")
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const user = await createTestUser(testDb, "st-stage-orphan")
		// What a restart leaves: a staging directory no live import owns,
		// untouched for longer than an import may sit idle.
		const orphan = path.join(
			os.tmpdir(),
			"serene-pub-import-00000000-orphan-test"
		)
		await fs.mkdir(path.join(orphan, "characters"), { recursive: true })
		await fs.writeFile(path.join(orphan, "characters", "left.png"), "x")
		const old = new Date(Date.now() - 2 * 60 * 60 * 1000)
		await fs.utimes(orphan, old, old)
		// A recent one — another process's live import — is left alone.
		const recent = path.join(
			os.tmpdir(),
			"serene-pub-import-00000000-recent-test"
		)
		await fs.mkdir(recent, { recursive: true })
		try {
			await importStartSillyTavernSession.handler(
				adminSocket(user.id),
				{},
				noopEmit
			)
			await expect(fs.stat(orphan)).rejects.toThrow(/ENOENT/)
			expect((await fs.stat(recent)).isDirectory()).toBe(true)
		} finally {
			await fs.rm(orphan, { recursive: true, force: true })
			await fs.rm(recent, { recursive: true, force: true })
		}
	}, 60_000)
})
