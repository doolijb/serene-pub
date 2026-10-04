/**
 * Continue moves a narrator genre forward (lair pass F6 / B9, owner ruling
 * D3 2026-09-27), over the REAL reply road with a faked model.
 *
 * What is pinned:
 *
 *  1. **Delete recalculates.** Deleting the narrator's newest reply is a
 *     `message-deleted` the narrator turn order now answers, so the order
 *     holds the narrator again — and Continue fires it.
 *  2. **Hide recalculates**, both ways.
 *  3. **The carry-on.** The OWNER's Continue on an empty order, in a
 *     `voice: 'narrator'` genre, fires a narrator turn with no new
 *     direction. A guest is refused with the same sentence as before.
 *  4. **Auto-advance never carries on by itself.** An empty order after a
 *     reply fires nothing on any cause, and a delete's recompute (an `edit`
 *     cause) does not fire the narrator it prepares.
 *  5. **The next-speaker state after a send.** The `sessions:turnOrder`
 *     push that answers a send says whether auto-advance is about to fire
 *     (`autoAdvancing`), so a client can stop waiting for a reply that is
 *     not coming instead of hiding its next-speaker block until a backstop.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { asc, eq } from "drizzle-orm"
import type { TestDb } from "$lib/server/utils/testDb"
import type { FakeTextAdapter } from "$lib/server/connectionAdapters/fakeTextAdapter"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "carry-on-test-secret" }
})

/**
 * One answer for every step. `generate-json` reads the lists its `path`
 * selects out of it; `generate-text` takes it as the prose. `value` is text,
 * as the shipped keeper schema declares it.
 */
const ANSWER = JSON.stringify({
	beats: ["The lantern gutters.", "Thunder, far off."],
	speakers: [{ name: "Elara", intent: "warn the party" }],
	worldHints: { location: "the fog road", timeOfDay: "dusk", weather: "storm" },
	needsLookup: false,
	values: [
		{ owner: "world", slot: "weather", value: "storm" },
		{ owner: "Elara", slot: "mood", value: "wary" }
	],
	inventory: []
})

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
		return this
	}
	abort() {}
	async generateText() {
		return {
			compiledPrompt: this.injected,
			isAborted: false,
			completionResult: async (onContent: (c: string) => void) => {
				onContent(ANSWER)
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
				connection: {
					id: 1,
					type: "koboldcpp",
					promptFormat: "vicuna"
				},
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

const ADVENTURE = "core:genre/adventure"

/** The hard ceiling a road gets before the suite calls it hung. */
const HANG_MS = 20_000

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
		path.join(os.tmpdir(), "serene-pub-carry-on-int-test-")
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

async function makeUser(username: string) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, username)
}

async function character(userId: number, name: string, isPersona = false) {
	const schema = await import("$lib/server/db/schema")
	const [row] = await testDb
		.insert(schema.characters)
		.values({ userId, name, description: name, isPersona })
		.returning()
	return row!.id
}

/** An Adventure session with the owner's line waiting, and a guest. */
async function adventureSession(tag: string) {
	const schema = await import("$lib/server/db/schema")
	const { insertLegacy } = await import("$lib/server/messages/store")
	const owner = await makeUser(`${tag}-owner`)
	const guest = await makeUser(`${tag}-guest`)
	const [lorebook] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: owner.id, name: `The fog roads ${tag}` })
		.returning()
	const [session] = await testDb
		.insert(schema.sessions)
		.values({
			userId: owner.id,
			isGroup: true,
			name: `Road ${tag}`,
			genreId: ADVENTURE,
			lorebookId: lorebook!.id,
			genreFields: { tone: "grounded", difficulty: "normal" }
		})
		.returning()
	await testDb
		.insert(schema.sessionGuests)
		.values({ sessionId: session!.id, userId: guest.id })
	const elara = await character(owner.id, "Elara")
	await testDb.insert(schema.sessionCharacters).values({
		sessionId: session!.id,
		characterId: elara,
		isActive: true,
		position: 0
	})
	const rook = await character(owner.id, "Rook", true)
	await testDb
		.insert(schema.sessionPersonas)
		.values({ sessionId: session!.id, personaId: rook })
	await insertLegacy(testDb as unknown as Db, {
		sessionId: session!.id,
		role: "user",
		content: "I hold up the lantern.",
		personaId: rook,
		userId: owner.id
	})
	return { owner, guest, session: session!, elara, rook }
}

type World = Awaited<ReturnType<typeof adventureSession>>

/** A socket server that records every emit, for the given users. */
function recordingIo(userIds: number[]) {
	const emitted: Array<{ room: string; event: string; payload: any }> = []
	const sockets = new Map(
		userIds.map((id) => [
			`socket-${id}`,
			{ id: `socket-${id}`, user: { id, isAdmin: false }, interest: new Set<string>() }
		])
	)
	const io = {
		sockets: {
			adapter: {
				rooms: {
					get: (room: string) => {
						const id = Number(room.replace(/^user_/, ""))
						return sockets.has(`socket-${id}`)
							? new Set([`socket-${id}`])
							: undefined
					}
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

function fakeSocket(userId: number, io: any) {
	return { user: { id: userId, isAdmin: false }, io } as any
}

async function settle() {
	await (
		await import("$lib/server/pipelines/runtime/sessionEvents")
	).settleSessionEvents()
}

async function orderOf(sessionId: number) {
	await settle()
	const schema = await import("$lib/server/db/schema")
	const { readTurnOrder } = await import("@serene-pub/sdk")
	const [row] = await testDb
		.select({ metadata: schema.sessions.metadata })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
	return readTurnOrder(row!.metadata).order
}

async function repliesOf(sessionId: number) {
	await settle()
	const schema = await import("$lib/server/db/schema")
	return testDb
		.select()
		.from(schema.sessionMessages)
		.where(eq(schema.sessionMessages.sessionId, sessionId))
		.orderBy(asc(schema.sessionMessages.id))
}

async function respondRuns(sessionId: number) {
	await settle()
	const schema = await import("$lib/server/db/schema")
	const runs = await testDb
		.select({ specSlug: schema.pipelineRuns.specSlug })
		.from(schema.pipelineRuns)
		.where(eq(schema.pipelineRuns.sessionId, sessionId))
	return runs.filter((r) => r.specSlug === "core:spec/adventure-respond").length
}

/** A press of Continue (no entry), or of a pick, by `userId`. */
async function press(
	w: World,
	userId: number,
	label: string,
	entry?: { ref: string | null; via: string }
) {
	const { sessionsFireTurnHandler } = await import("./sessions")
	const { io } = recordingIo([w.owner.id, w.guest.id])
	const res = await within(
		label,
		sessionsFireTurnHandler.handler(
			fakeSocket(userId, io),
			{ sessionId: w.session.id, ...(entry ? { entry } : {}) } as any,
			() => {}
		)
	)
	await settle()
	return res as { ok: boolean; error?: string; runId?: string }
}

/** The narrator's first reply, fired by the owner's pick. */
async function firstReply(w: World) {
	const res = await press(w, w.owner.id, "the first reply", {
		ref: null,
		via: "pick"
	})
	expect(res.error).toBeUndefined()
	const rows = await repliesOf(w.session.id)
	const reply = rows.at(-1)!
	expect(reply.role).toBe("assistant")
	// The narrator answered, so nothing is prepared.
	expect(await orderOf(w.session.id)).toEqual([])
	return reply
}

describe("B9 — Continue moves a narrator genre forward", () => {
	test("deleting the last reply recalculates the order, and Continue then fires a narrator turn", async () => {
		const w = await adventureSession("delete")
		const reply = await firstReply(w)

		const { sessionMessagesDeleteHandler } = await import("./sessions")
		const { io } = recordingIo([w.owner.id])
		const del = await within(
			"the delete",
			sessionMessagesDeleteHandler.handler(
				fakeSocket(w.owner.id, io),
				{ id: reply.id } as any,
				() => {}
			)
		)
		expect((del as any).error).toBeUndefined()

		// The user's line is newest again: the narrator is ready.
		const order = await orderOf(w.session.id)
		expect(order).toHaveLength(1)
		expect(order[0]!.ref).toBeNull()

		const before = await respondRuns(w.session.id)
		const res = await press(w, w.owner.id, "Continue after the delete")
		expect(res.error).toBeUndefined()
		expect(res.ok).toBe(true)
		expect(await respondRuns(w.session.id)).toBe(before + 1)
		expect((await repliesOf(w.session.id)).at(-1)!.role).toBe("assistant")
	})

	test("hiding the last reply recalculates the order, and unhiding it empties it again", async () => {
		const w = await adventureSession("hide")
		const reply = await firstReply(w)
		const { runBuiltIn } = await import("$lib/server/pipelines/runtime/builtins")

		const hidden = await runBuiltIn(testDb as unknown as Db, {
			kind: "hide",
			sessionId: w.session.id,
			actor: w.owner.id,
			payload: { target: reply.id, hidden: true }
		} as any)
		expect((hidden as any).ok).toBe(true)
		const order = await orderOf(w.session.id)
		expect(order).toHaveLength(1)
		expect(order[0]!.ref).toBeNull()

		const shown = await runBuiltIn(testDb as unknown as Db, {
			kind: "hide",
			sessionId: w.session.id,
			actor: w.owner.id,
			payload: { target: reply.id, hidden: false }
		} as any)
		expect((shown as any).ok).toBe(true)
		expect(await orderOf(w.session.id)).toEqual([])
	})

	test("the owner's Continue on an empty order fires a narrator carry-on turn", async () => {
		const w = await adventureSession("carry")
		await firstReply(w)
		const before = await respondRuns(w.session.id)
		const rowsBefore = (await repliesOf(w.session.id)).length

		const res = await press(w, w.owner.id, "the carry-on")
		expect(res.error).toBeUndefined()
		expect(res.ok).toBe(true)
		expect(await respondRuns(w.session.id)).toBe(before + 1)
		const rows = await repliesOf(w.session.id)
		expect(rows.length).toBe(rowsBefore + 1)
		expect(rows.at(-1)!.role).toBe("assistant")
		// And the carry-on prepares nothing after itself.
		expect(await orderOf(w.session.id)).toEqual([])
	})

	test("a guest's Continue on an empty order is refused with the sentence", async () => {
		const w = await adventureSession("guest")
		await firstReply(w)
		const before = await respondRuns(w.session.id)
		const res = await press(w, w.guest.id, "the guest's Continue")
		expect(res.ok).toBe(false)
		expect(res.error).toBe("Nothing is prepared to take a turn.")
		expect(await respondRuns(w.session.id)).toBe(before)
	})

	test("auto-advance never fires a carry-on by itself", async () => {
		const w = await adventureSession("auto")
		const reply = await firstReply(w)
		const before = await respondRuns(w.session.id)

		const { onTurnOrderChanged } = await import(
			"$lib/server/sessions/autoAdvance"
		)
		// Nothing prepared: no cause fires anything, a person's included.
		for (const cause of [
			{ kind: "user" as const, userId: w.owner.id },
			{ kind: "run" as const, auto: true, userId: w.owner.id }
		]) {
			const out = await onTurnOrderChanged(testDb as unknown as Db, {
				sessionId: w.session.id,
				userId: w.owner.id,
				cause
			})
			expect(out.fired).toBe(false)
		}

		// A delete prepares the narrator, under an edit's cause — which
		// never fires.
		const { runBuiltIn } = await import("$lib/server/pipelines/runtime/builtins")
		await runBuiltIn(testDb as unknown as Db, {
			kind: "delete",
			sessionId: w.session.id,
			actor: w.owner.id,
			payload: { target: reply.id }
		} as any)
		expect(await orderOf(w.session.id)).toHaveLength(1)
		expect(await respondRuns(w.session.id)).toBe(before)
	})
})

describe("B9 — the next-speaker state after a send", () => {
	async function chatSession(tag: string, autoAdvance: "off" | "round") {
		const schema = await import("$lib/server/db/schema")
		const owner = await makeUser(`${tag}-owner`)
		const [session] = await testDb
			.insert(schema.sessions)
			.values({
				userId: owner.id,
				isGroup: false,
				name: `Chat ${tag}`,
				genreFields: { autoAdvance }
			})
			.returning()
		const bram = await character(owner.id, "Bram")
		await testDb.insert(schema.sessionCharacters).values({
			sessionId: session!.id,
			characterId: bram,
			isActive: true,
			position: 0
		})
		const me = await character(owner.id, "Me", true)
		await testDb
			.insert(schema.sessionPersonas)
			.values({ sessionId: session!.id, personaId: me })
		return { owner, session: session!, me }
	}

	async function send(w: Awaited<ReturnType<typeof chatSession>>) {
		const { sessionMessagesSendPersonaMessageHandler } = await import(
			"./sessions"
		)
		const { io, emitted } = recordingIo([w.owner.id])
		await within(
			"the send",
			sessionMessagesSendPersonaMessageHandler.handler(
				fakeSocket(w.owner.id, io),
				{ sessionId: w.session.id, personaId: w.me, content: "Hello." },
				() => {}
			)
		)
		await settle()
		return emitted.filter((e) => e.event === "sessions:turnOrder")
	}

	test("auto-advance off: the push answering the send says nothing is about to fire", async () => {
		const w = await chatSession("send-off", "off")
		const pushes = await send(w)
		expect(pushes.length).toBeGreaterThan(0)
		const last = pushes.at(-1)!.payload
		expect(last.sessionId).toBe(w.session.id)
		expect(last.turnOrder.order.length).toBeGreaterThan(0)
		expect(last.autoAdvancing).toBe(false)
	})

	test("auto-advance on: the push answering the send says the head is about to fire", async () => {
		const w = await chatSession("send-round", "round")
		const pushes = await send(w)
		expect(pushes.length).toBeGreaterThan(0)
		expect(pushes[0]!.payload.autoAdvancing).toBe(true)
	})
})
