/**
 * The SillyTavern folder import, over a tree laid out the way SillyTavern
 * itself lays one out — in SillyTavern's own words (NOMENCLATURE R5).
 *
 * SillyTavern calls a conversation a *chat*: solo chats live under
 * `chats/<character file>/<chat>.jsonl`, a group's under
 * `group chats/<chat_id>.jsonl`. Serene Pub imports each one as a session, but
 * the folders are SillyTavern's. A rename sweep (baf439d7) once turned `chats/`
 * into `sessions/` in the importer's code, and every real SillyTavern folder
 * then imported no history at all — the scan listed nothing and the execute
 * read nothing. This file drives the real handlers over a real-shaped tree on
 * disk, through the same client-side partition the import page uses, so a
 * vocabulary sweep that reaches a foreign folder name again fails here.
 *
 * It also pins two readings of SillyTavern's own JSON the same fixture
 * exercises: a persona is keyed by its AVATAR FILE in `settings.json`
 * (`power_user.personas["user-default.png"] = "Jody"`), and a group's history
 * file is named by its `chat_id`, not its `id`.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
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
import {
	isRelevantImportPath,
	isSillyTavernChatHistoryPath,
	relativeToDataRoot,
	resolveSillyTavernDataRoot
} from "$lib/shared/utils/sillyTavernPaths"

let testDb: TestDb
let dataDir: string
let stDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

/** A real, CRC-valid 1x1 PNG. */
function pngBytes(): Buffer {
	const png = new PNG({ width: 1, height: 1 })
	png.data.fill(255)
	return PNG.sync.write(png)
}

/** A character card as SillyTavern stores one: a PNG with a `chara` chunk. */
function cardPng(name: string): Buffer {
	const chunks = extract(pngBytes())
	const card = {
		spec: "chara_card_v2",
		spec_version: "2.0",
		data: {
			name,
			description: `${name}, a regular.`,
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
			extensions: {}
		}
	}
	const chunk = text.encode(
		"chara",
		Buffer.from(JSON.stringify(card), "utf8").toString("base64")
	)
	chunks.splice(
		chunks.findIndex((c) => c.name === "IEND"),
		0,
		chunk
	)
	return Buffer.from(encode(chunks))
}

const jsonl = (lines: unknown[]) =>
	lines.map((l) => JSON.stringify(l)).join("\n") + "\n"

const GROUP_CHAT_ID = "2024-01-03@18h00m00s"

/**
 * `SillyTavern/data/default-user/`, as SillyTavern writes it. Paths are
 * relative to the folder the user picks (the SillyTavern root).
 */
const TREE: Record<string, string | Buffer> = {
	"SillyTavern/data/default-user/settings.json": JSON.stringify({
		power_user: {
			personas: { "user-default.png": "Jody" },
			persona_descriptions: {
				"user-default.png": { description: "The one asking.", position: 0 }
			},
			default_persona: "user-default.png"
		}
	}),
	"SillyTavern/data/default-user/characters/Aria.png": cardPng("Aria"),
	"SillyTavern/data/default-user/characters/Bram.png": cardPng("Bram"),
	"SillyTavern/data/default-user/chats/Aria/Aria - 2024-01-01@12h00m00s.jsonl":
		jsonl([
			{
				user_name: "Jody",
				character_name: "Aria",
				create_date: "2024-01-01@12h00m00s",
				chat_metadata: {}
			},
			{
				name: "Aria",
				is_user: false,
				send_date: "January 1, 2024 12:00pm",
				mes: "Welcome in.",
				swipes: ["Welcome in.", "Oh, hello."],
				swipe_id: 0
			},
			{
				name: "Jody",
				is_user: true,
				send_date: "January 1, 2024 12:01pm",
				mes: "A table for one."
			}
		]),
	"SillyTavern/data/default-user/groups/1700000000000.json": JSON.stringify({
		id: "1700000000000",
		name: "Tavern Night",
		members: ["Aria.png", "Bram.png"],
		disabled_members: [],
		allow_self_responses: false,
		activation_strategy: 0,
		generation_mode: 0,
		chat_metadata: {},
		chat_id: GROUP_CHAT_ID,
		chats: [GROUP_CHAT_ID]
	}),
	// An older SillyTavern's group chat: no header line, messages only.
	[`SillyTavern/data/default-user/group chats/${GROUP_CHAT_ID}.jsonl`]: jsonl([
		{
			name: "Jody",
			is_user: true,
			send_date: 1704304800000,
			mes: "Evening, both."
		},
		{
			name: "Bram",
			is_user: false,
			send_date: 1704304860000,
			mes: "Pull up a chair."
		}
	]),
	"SillyTavern/data/default-user/worlds/Eldoria.json": JSON.stringify({
		entries: {}
	}),
	"SillyTavern/data/default-user/User Avatars/user-default.png": pngBytes(),
	// Not relevant to an import; never uploaded.
	"SillyTavern/data/default-user/backgrounds/forest.jpg": "not really a jpg",
	"SillyTavern/data/default-user/extensions/some-ext/index.js": "// ext"
}

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-import-st-tree-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	stDir = path.join(dataDir, "picked")
	for (const [rel, contents] of Object.entries(TREE)) {
		const abs = path.join(stDir, rel)
		await fs.mkdir(path.dirname(abs), { recursive: true })
		await fs.writeFile(abs, contents)
	}

	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const noopEmit = () => {}
const adminSocket = (userId: number) =>
	({ user: { id: userId, isAdmin: true } }) as any

/**
 * Walk the picked folder the way the browser hands it over, and split it the
 * way the import page does (`resolvePickedFolder`): what the scan reads now,
 * and the chat history uploaded only for what the user selects.
 */
async function pickFolder() {
	const all = (await fs.readdir(stDir, { recursive: true }))
		.map((p) => String(p).split(path.sep).join("/"))
		.filter((p) => !p.endsWith("/"))
	const files: string[] = []
	for (const p of all) {
		if ((await fs.stat(path.join(stDir, p))).isFile()) files.push(p)
	}
	const root = resolveSillyTavernDataRoot(files)
	expect(root).toBe("SillyTavern/data/default-user")
	const relevant = files
		.map((p) => ({ picked: p, relativePath: relativeToDataRoot(p, root!) }))
		.filter((f) => isRelevantImportPath(f.relativePath))
	return {
		scanFiles: relevant.filter(
			(f) => !isSillyTavernChatHistoryPath(f.relativePath)
		),
		deferredFiles: relevant.filter((f) =>
			isSillyTavernChatHistoryPath(f.relativePath)
		)
	}
}

async function stage(
	userId: number,
	importSessionId: string,
	files: Array<{ picked: string; relativePath: string }>
) {
	const { importStageSillyTavernFiles } = await import("./import")
	const manifest: Array<{ relativePath: string; length: number }> = []
	const chunks: Buffer[] = []
	for (const f of files) {
		const buf = await fs.readFile(path.join(stDir, f.picked))
		manifest.push({ relativePath: f.relativePath, length: buf.length })
		chunks.push(buf)
	}
	const staged = await importStageSillyTavernFiles.handler(
		adminSocket(userId),
		{ importSessionId, manifest, blob: Buffer.concat(chunks) },
		noopEmit
	)
	expect(staged.success).toBe(true)
}

describe("SillyTavern import over a real SillyTavern tree", () => {
	test("finds the chats in chats/ and group chats/ and imports them as sessions", async () => {
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const user = await createTestUser(testDb, "st-real-tree")
		const {
			importStartSillyTavernSession,
			importScanSillyTavern,
			importExecuteSillyTavern
		} = await import("./import")
		const socket = adminSocket(user.id)

		const picked = await pickFolder()
		expect(picked.deferredFiles.map((f) => f.relativePath).sort()).toEqual([
			"chats/Aria/Aria - 2024-01-01@12h00m00s.jsonl",
			`group chats/${GROUP_CHAT_ID}.jsonl`
		])

		const started = await importStartSillyTavernSession.handler(
			socket,
			{},
			noopEmit
		)
		expect(started.success).toBe(true)
		const importSessionId = started.importSessionId!

		// ── Scan: what the page lists ────────────────────────────────────
		await stage(user.id, importSessionId, picked.scanFiles)
		const scan = await importScanSillyTavern.handler(
			socket,
			{
				importSessionId,
				deferredSessionPaths: picked.deferredFiles.map(
					(f) => f.relativePath
				)
			},
			noopEmit
		)
		expect(scan.success).toBe(true)
		const data = scan.data!
		expect(data.characters.map((c) => c.name).sort()).toEqual([
			"Aria",
			"Bram"
		])
		// The name SillyTavern shows, not the avatar file it keys by.
		expect(data.personas.map((p) => p.name)).toEqual(["Jody"])
		expect(
			data.sessions.map((s) => ({
				filename: s.filename,
				name: s.name,
				characterNames: s.characterNames
			}))
		).toEqual([
			{
				filename: "Aria/Aria - 2024-01-01@12h00m00s.jsonl",
				name: "Aria - 2024-01-01@12h00m00s",
				characterNames: ["Aria"]
			}
		])
		expect(
			data.groupSessions.map((g) => ({
				name: g.name,
				memberNames: g.memberNames
			}))
		).toEqual([{ name: "Tavern Night", memberNames: ["Aria", "Bram"] }])

		// ── Execute: upload the selected history, then import ───────────
		await stage(user.id, importSessionId, picked.deferredFiles)
		const result = await importExecuteSillyTavern.handler(
			socket,
			{ importSessionId, selectedData: data },
			noopEmit
		)
		expect(result.errors ?? []).toEqual([])
		expect(result.success).toBe(true)

		const persona = await testDb.query.characters.findFirst({
			where: (c, { and, eq }) =>
				and(eq(c.userId, user.id), eq(c.isPersona, true))
		})
		expect(persona?.name).toBe("Jody")
		expect(persona?.description).toBe("The one asking.")
		// `User Avatars/user-default.png` came over as its avatar.
		expect(persona?.avatarMediaId).toBeTruthy()

		const sessions = await testDb
			.select()
			.from(schema.sessions)
			.where(eq(schema.sessions.userId, user.id))
			.orderBy(asc(schema.sessions.id))
		expect(sessions.map((s) => [s.name, s.isGroup])).toEqual([
			["Aria - 2024-01-01@12h00m00s", false],
			["Tavern Night", true]
		])

		const linesOf = async (sessionId: number) =>
			(
				await testDb
					.select()
					.from(schema.sessionMessages)
					.where(eq(schema.sessionMessages.sessionId, sessionId))
					.orderBy(asc(schema.sessionMessages.id))
			).map((m) => [m.role, m.content])

		expect(await linesOf(sessions[0].id)).toEqual([
			["character", "Welcome in."],
			["user", "A table for one."]
		])
		// Headerless group history: its first line is a message, kept.
		expect(await linesOf(sessions[1].id)).toEqual([
			["user", "Evening, both."],
			["character", "Pull up a chair."]
		])

		// The solo chat's `user_name` resolved to the imported persona.
		const seat = await testDb.query.sessionPersonas.findFirst({
			where: (p, { eq }) => eq(p.sessionId, sessions[0].id)
		})
		expect(seat?.personaId).toBe(persona!.id)
	}, 60_000)
})
