/**
 * Trigger trap and Reveal write the Narrator's row, streamed (lair pass B17,
 * owner D7a, 2026-09-27).
 *
 * Before: each committed a finished `narration` row at the end — centred, no
 * avatar, a different look from the Narrator row a Lair turn writes, and
 * nothing streamed (F14). And what the master typed with the press was
 * stored beside the row but never reached the prompt. Now the row is opened
 * as a placeholder, streams while the narrator writes and is finished by an
 * update, and the typed text is the prompt's `{{turnDirection}}`.
 *
 * Walks the real press road — `fireAction` → `runSpec` → the real host —
 * with a faked model that answers prose in two chunks.
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
	return { db, getCryptoSecretKey: () => "lair-trap-reveal-test-secret" }
})

const DOCUMENT = JSON.stringify({
	beats: ["The torch gutters.", "Something scrapes behind the door."],
	speakers: [{ name: "Brannoc", intent: "check the door" }],
	worldHints: {},
	needsLookup: false,
	values: [],
	inventory: []
})
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
		path.join(os.tmpdir(), "serene-pub-vitest-lair-trap-reveal-")
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
	const tag = `trap-${++n}`
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
	const { io, emitted } = recordingIo(w.owner.id, w.session.id)
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
	return { out, emitted, sent: [...prompts] }
}

/** Every text the new row showed while it was still generating. */
const streamedFrames = (emitted: Array<{ event: string; payload: any }>) =>
	emitted
		.filter(
			(e) =>
				e.event === "sessionMessage" &&
				e.payload?.sessionMessage?.isGenerating === true &&
				e.payload?.sessionMessage?.role !== "user"
		)
		.map((e) => String(e.payload.sessionMessage.content ?? ""))
		.filter((c) => c.length > 0)

/** The rows the press wrote — everything but the seeded user line. */
async function written(sessionId: number) {
	const schema = await import("$lib/server/db/schema")
	const rows = await testDb
		.select()
		.from(schema.sessionMessages)
		.where(eq(schema.sessionMessages.sessionId, sessionId))
	return rows.filter((r: any) => r.role !== "user")
}

/** A Lair turn's own Narrator row, for the shape the actions must match. */
const TURN_ROW_SHAPE = {
	role: "assistant",
	characterId: null,
	personaId: null,
	isNarratorResponse: false,
	isGenerating: false
}

const ACTIONS = [
	{ name: "Trigger trap", action: "core:spec/lair-trap#trap", typed: "The floor tilts into a pit of spikes." },
	{ name: "Reveal", action: "core:spec/lair-reveal#reveal", typed: "A name cut into the doorframe: VESS." }
] as const

describe("Trigger trap and Reveal write a streamed Narrator row", () => {
	for (const a of ACTIONS) {
		test(`${a.name} with text: one Narrator row, prose streamed, the typed text in its prompt`, async () => {
			const w = await session("core:genre/lair", {})
			const { out, emitted, sent } = await press(w, a.action, a.typed)
			expect(out.kind, JSON.stringify(out)).toBe("ran")
			if (out.kind !== "ran") return
			expect(out.receipt.outcome).toBe("ok")

			const rows = await written(w.session.id)
			expect(rows).toHaveLength(1)
			const row = rows[0] as any
			expect(row.content).toBe(PROSE.join(""))
			expect(row.content).not.toContain("{")
			// The same row a Lair turn writes, unstyled — and, since R6
			// (2026-09-28), the Castellan's: the Lair's fallback envoy is the
			// speaker of every row nobody claims (owner F2: Trap and Reveal
			// are the Castellan's).
			expect(row).toMatchObject(TURN_ROW_SHAPE)
			expect(row.metadata?.speaker).toBe("envoy:castellan")
			expect(row.metadata?.narratorName).toBeUndefined()

			// It streamed: the row showed the first chunk while still open.
			const frames = streamedFrames(emitted)
			expect(frames.some((t) => t.startsWith(PROSE[0]!.trim()))).toBe(true)
			for (const t of frames) expect(t).not.toContain("{")

			// What the master typed reached the model.
			expect(sent.some((p) => p.includes(a.typed))).toBe(true)
		})

		test(`${a.name} with nothing typed still writes the row, and the room decides`, async () => {
			const w = await session("core:genre/lair", {})
			const { out, sent } = await press(w, a.action)
			expect(out.kind, JSON.stringify(out)).toBe("ran")
			if (out.kind !== "ran") return
			expect(out.receipt.outcome).toBe("ok")
			const rows = await written(w.session.id)
			expect(rows).toHaveLength(1)
			expect(rows[0]).toMatchObject({ ...TURN_ROW_SHAPE, content: PROSE.join("") })
			expect(sent.some((p) => p.includes("left it to the room"))).toBe(true)
			expect(sent.some((p) => p.includes("{{"))).toBe(false)
		})
	}
})
