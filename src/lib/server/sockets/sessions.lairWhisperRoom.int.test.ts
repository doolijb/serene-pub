/**
 * Lair pass W-GATE D2 and D3 (2026-09-27).
 *
 * D2 — (superseded by R10, 2026-09-28: the whisper has no prompt; it
 * collects its recipients and writes each one's slot — see
 * `sessions.lairWhisper.int.test.ts`.)
 *
 * D3 — *Answer the door* (`/room`) was listed with no knock pending and,
 * pressed, halted "nothing to answer". Now it is present only while a knock
 * (an open form naming it) is on the conversation: hidden, not grey, and
 * refused at the door when pressed without one.
 *
 * Walks the real press road — `fireAction` → `runSpec` → the real host —
 * with a faked model.
 */

import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import type { TestDb } from "$lib/server/utils/testDb"
import type { FakeTextAdapter } from "$lib/server/connectionAdapters/fakeTextAdapter"
import { JSON_INSTRUCTION } from "$lib/server/connections/structuredOutput"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "lair-whisper-room-test-secret" }
})

const DOCUMENT = JSON.stringify({ to: "Brannoc", instruction: "Hold the line." })
/** Every prompt the model was sent, in order, serialised. */
const prompts: string[] = []
const PROSE = ["The torch gutters. ", "Something scrapes behind the door."]

class FakeAdapter implements FakeTextAdapter {
	injected: any
	promptBuilder: any = {}
	responseFormat: any
	responseSchema: any
	constructor(_p: any) {}
	stops: any
	withStops(s: any) {
		this.stops = s
		return this
	}
	withStreaming() {
		return this
	}
	withCompiledPrompt(p: any) {
		this.injected = p
		prompts.push(JSON.stringify(p ?? ""))
		return this
	}
	abort() {}
	async generateText() {
		// Structured output on the wire, or — a stub connection declares no
		// capabilities — the instruction door's sentence in the prompt.
		const json =
			this.responseFormat === "json" ||
			JSON.stringify(this.injected ?? "").includes(
				JSON.stringify(JSON_INSTRUCTION).slice(1, 40)
			)
		return {
			compiledPrompt: this.injected,
			isAborted: false,
			completionResult: async (onContent: (c: string) => void) => {
				if (json) {
					// Two chunks, so a JSON step that streamed shows a frame.
					onContent(DOCUMENT.slice(0, 20))
					onContent(DOCUMENT.slice(20))
					return
				}
				for (const chunk of PROSE) {
					onContent(chunk)
					// Past the persist throttle, so each chunk is a frame.
					await new Promise((r) => setTimeout(r, 120))
				}
			}
		}
	}
}
vi.mock("$lib/server/utils/getConnectionAdapter", () => ({
	getConnectionAdapter: async () => ({ Adapter: FakeAdapter })
}))
vi.mock("$lib/server/utils/resolveTaskConfig", () => ({
	resolveTaskConfig: async () => ({
		connection: { id: 1, type: "koboldcpp", promptFormat: "vicuna" },
		sampling: { id: 1 }
	})
}))
vi.mock("$lib/server/connections/capabilityTarget", async (importOriginal) => {
	const real =
		await importOriginal<
			typeof import("$lib/server/connections/capabilityTarget")
		>()
	return {
		...real,
		resolveCapabilityTarget: async (
			db: Db,
			req: Parameters<typeof real.resolveCapabilityTarget>[1]
		) => {
			const target = await real.resolveCapabilityTarget(db, req)
			if (target.ok) return target
			return {
				ok: true,
				capability: req.capability,
				connection: { id: 1, type: "koboldcpp", promptFormat: "vicuna" },
				sampling: { id: 1 },
				connectionVia: "pipelineConfig",
				samplingVia: "pipelineConfig"
			}
		}
	}
})
vi.mock("$lib/server/utils/getUserConfigurations", () => ({
	getUserConfigurations: async () => ({
		sampling: { id: 1 },
		contextConfig: { id: 1 },
		promptConfig: { id: 1, systemPrompt: "Stay in character." }
	})
}))
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))

const HANG_MS = 30_000
async function within<T>(label: string, road: Promise<T>): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined
	const hung = new Promise<never>((_, reject) => {
		timer = setTimeout(
			() => reject(new Error(`${label} did not finish within ${HANG_MS} ms`)),
			HANG_MS
		)
	})
	try {
		return await Promise.race([road, hung])
	} finally {
		clearTimeout(timer)
	}
}

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-lair-whisper-room-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(testDb as any)
})

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

let n = 0

/** A narrator-genre session with one cast member and the owner's line waiting. */
async function session(genreId: string, genreFields: Record<string, unknown>) {
	const schema = await import("$lib/server/db/schema")
	const { insertLegacy } = await import("$lib/server/messages/store")
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const tag = `whisper-${++n}`
	const owner = await createTestUser(testDb, `${tag}-owner`)
	const [lorebook] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: owner.id, name: `The lair ${tag}` })
		.returning()
	const [row] = await testDb
		.insert(schema.sessions)
		.values({
			userId: owner.id,
			isGroup: true,
			name: `Session ${tag}`,
			genreId,
			lorebookId: lorebook!.id,
			genreFields
		})
		.returning()
	const [brannoc] = await testDb
		.insert(schema.characters)
		.values({ userId: owner.id, name: "Brannoc", description: "A delver." })
		.returning()
	await testDb.insert(schema.sessionCharacters).values({
		sessionId: row!.id,
		characterId: brannoc!.id,
		isActive: true,
		position: 0
	})
	const [rook] = await testDb
		.insert(schema.characters)
		.values({ userId: owner.id, name: "Rook", description: "Rook", isPersona: true })
		.returning()
	await testDb
		.insert(schema.sessionPersonas)
		.values({ sessionId: row!.id, personaId: rook!.id })
	await insertLegacy(testDb as unknown as Db, {
		sessionId: row!.id,
		role: "user",
		content: "I open the door.",
		personaId: rook!.id,
		userId: owner.id
	})
	return { owner, session: row!, brannoc: brannoc!.id }
}

/** One socket for the owner, every emit recorded. */
function recordingIo(userId: number, sessionId: number) {
	const emitted: Array<{ room: string; event: string; payload: any }> = []
	const socketId = `socket-${userId}`
	const sockets = new Map([
		[
			socketId,
			{
				id: socketId,
				user: { id: userId, isAdmin: false },
				interest: new Set([
					`sessionMessage#${sessionId}`,
					`sessions:runStatus#${sessionId}`,
					`sessions:actions#${sessionId}`,
					`state:changed#${sessionId}`
				])
			}
		]
	])
	const io = {
		sockets: {
			adapter: {
				rooms: {
					get: (room: string) =>
						room === `user_${userId}` ? new Set([socketId]) : undefined
				}
			},
			sockets: {
				get: (id: string) => sockets.get(id),
				values: () => sockets.values()
			}
		},
		to: (room: string) => ({
			emit: (event: string, payload: any) =>
				emitted.push({ room, event, payload })
		})
	}
	return { io: io as any, emitted }
}


async function press(
	w: Awaited<ReturnType<typeof session>>,
	action: string,
	text?: string
) {
	const { fireAction } = await import("$lib/server/pipelines/runtime/fireAction")
	const { io } = recordingIo(w.owner.id, w.session.id)
	prompts.length = 0
	const out = await within(
		action,
		fireAction(testDb as any, {
			sessionId: w.session.id,
			action,
			...(text !== undefined ? { text } : {}),
			actor: { userId: w.owner.id },
			io
		})
	)
	return { out, sent: [...prompts] }
}

const ROOM = "core:spec/lair-room-answer#room"

/** A knock row: the narrator's question, a `choices` block addressed to the owner naming *Answer the door*. */
async function knock(sessionId: number) {
	const { insertLegacy, appendParts } = await import("$lib/server/messages/store")
	const row = await insertLegacy(testDb as unknown as Db, {
		sessionId,
		role: "assistant",
		content: "The way east leads somewhere nobody has built. Is there a room here?"
	})
	await appendParts(testDb as unknown as Db, row.id, [
		{
			type: "core:blocks",
			data: {
				blocks: [
					{
						kind: "choices",
						id: "knock-1",
						head: row.id,
						addressee: "owner",
						question: "Is there a room here?",
						referent: "The Sunken Vault",
						// The knock's one option (R9): describe the room.
						actions: [
							{
								fn: "room",
								action: ROOM,
								label: "Describe The Sunken Vault…",
								choice: "describe"
							}
						]
					}
				]
			}
		}
	] as any)
	return row
}

async function composerKeys(w: Awaited<ReturnType<typeof session>>) {
	const { listSessionActions } = await import(
		"$lib/server/pipelines/entities/sessionActions"
	)
	const venues = await listSessionActions(testDb as any, w.session.id, {
		userId: w.owner.id
	})
	const c = venues.composer
	return [...c.primary, ...c.overflow].map((a) => `${a.specSlug}#${a.key}`)
}

// W-GATE D2 (the typed line in the whisper's prompt) is superseded by R10
// (2026-09-28): the whisper collects its recipients and calls no model —
// see `sessions.lairWhisper.int.test.ts`.

describe("W-GATE D3 — Answer the door is present only while a knock is open", () => {
	test("not listed without a knock, and refused when pressed anyway", async () => {
		const w = await session("core:genre/lair", {})
		const keys = await composerKeys(w)
		// The Lair's other composer actions are there — the list is real.
		expect(keys).toContain("core:spec/lair-whisper#whisper")
		expect(keys).not.toContain(ROOM)
		const { out } = await press(w, ROOM)
		expect(out.kind).toBe("refused")
		expect(JSON.stringify(out)).toMatch(/no door to answer/)
	})

	test("listed while a knock is open", async () => {
		const w = await session("core:genre/lair", {})
		await knock(w.session.id)
		expect(await composerKeys(w)).toContain(ROOM)
	})

	test("gone again once the conversation moves past the knock", async () => {
		const w = await session("core:genre/lair", {})
		await knock(w.session.id)
		const { insertLegacy } = await import("$lib/server/messages/store")
		await insertLegacy(testDb as unknown as Db, {
			sessionId: w.session.id,
			role: "user",
			content: "We turn back.",
			userId: w.owner.id
		})
		expect(await composerKeys(w)).not.toContain(ROOM)
	})

	test("gone once the knock is answered", async () => {
		const w = await session("core:genre/lair", {})
		const row = await knock(w.session.id)
		const schema = await import("$lib/server/db/schema")
		const part = (
			await testDb
				.select()
				.from(schema.messageParts)
				.where(eq(schema.messageParts.messageId, row.id))
		).find((p: any) => p.type === "core:blocks")
		const data = part!.data as any
		data.blocks[0].answered = { by: "owner", at: new Date().toISOString(), choice: "describe" }
		await testDb
			.update(schema.messageParts)
			.set({ data })
			.where(eq(schema.messageParts.id, part!.id))
		expect(await composerKeys(w)).not.toContain(ROOM)
	})
})

/**
 * W-GATE D3 follow-up (ruled 2026-09-27): a composer or command-list press of
 * the action the session's open form is answered by ANSWERS that form — the
 * press is addressed to the knock and walks the knock's own button road.
 */
describe("W-GATE D3 — a composer press answers the open knock", () => {
	async function pressWith(
		w: Awaited<ReturnType<typeof session>>,
		req: { action: string; messageId?: number; blockId?: string; payload?: Record<string, unknown> }
	) {
		const { fireAction } = await import("$lib/server/pipelines/runtime/fireAction")
		const { io } = recordingIo(w.owner.id, w.session.id)
		const out = await within(
			req.action,
			fireAction(testDb as any, {
				sessionId: w.session.id,
				...req,
				actor: { userId: w.owner.id },
				io
			})
		)
		return { out }
	}

	test("with a knock open, /room from the composer is the button's press", async () => {
		const button = await session("core:genre/lair", {})
		const knocked = await knock(button.session.id)
		const viaButton = await pressWith(button, {
			action: ROOM,
			messageId: knocked.id,
			blockId: "knock-1",
			payload: { choice: "describe" }
		})
		const composer = await session("core:genre/lair", {})
		await knock(composer.session.id)
		const viaComposer = await pressWith(composer, { action: ROOM, payload: { choice: "describe" } })
		// Nothing typed: the Castellan drafts the room, and the button's road
		// reaches the review gate and parks there (R9).
		expect(viaButton.out.kind, JSON.stringify(viaButton.out)).toBe("parked")
		expect(viaComposer.out.kind, JSON.stringify(viaComposer.out)).toBe(viaButton.out.kind)
		expect(JSON.stringify(viaComposer.out)).not.toMatch(/nothing to answer/)
	})

	test("pressed with no option named, it still answers the knock", async () => {
		const w = await session("core:genre/lair", {})
		await knock(w.session.id)
		const { out } = await pressWith(w, { action: ROOM })
		expect(out.kind, JSON.stringify(out)).toBe("parked")
		expect(JSON.stringify(out)).not.toMatch(/nothing to answer/)
	})

	test("an open form for a different action is not hijacked", async () => {
		const w = await session("core:genre/lair", {})
		const row = await knock(w.session.id)
		// The open form now names another action.
		const schema = await import("$lib/server/db/schema")
		const part = (
			await testDb
				.select()
				.from(schema.messageParts)
				.where(eq(schema.messageParts.messageId, row.id))
		).find((p: any) => p.type === "core:blocks")
		const data = part!.data as any
		for (const o of data.blocks[0].actions) {
			o.fn = "other"
			o.action = "core:spec/lair-other#other"
		}
		await testDb
			.update(schema.messageParts)
			.set({ data })
			.where(eq(schema.messageParts.id, part!.id))
		const { out } = await pressWith(w, { action: ROOM, payload: { choice: "describe" } })
		expect(out.kind).toBe("refused")
		expect(JSON.stringify(out)).toMatch(/no door to answer/)
		const [after] = await testDb
			.select()
			.from(schema.messageParts)
			.where(eq(schema.messageParts.id, part!.id))
		expect((after!.data as any).blocks[0].answered).toBeUndefined()
	})
})
