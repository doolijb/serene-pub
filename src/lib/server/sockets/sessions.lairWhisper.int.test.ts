/**
 * Whisper recipients (lair re-plan R10, owner ruling 5, 2026-09-28): the
 * master picks who hears a whisper, and only those delvers' own voices ever
 * read it.
 *
 *  - **Storage:** one `core:slot/whisper@1` value per recipient, the same
 *    text in each. A new whisper REPLACES a recipient's old one (a slot holds
 *    one value); a delver it does not name keeps theirs.
 *  - **No model call:** the whisper is a pure write — the collected
 *    recipients (`input.recipients`) and text straight onto the slot, through
 *    `resolve-state-changes@1`'s `owners` port. The old "who is it for"
 *    model call and its "Lair whisper" prompt row are retired.
 *  - **Reach:** earshot (R1) — each recipient's voice prompt carries it; a
 *    non-recipient's voice, the Castellan's planner, keeper, narration and
 *    Sanctum talk never do.
 *  - **Refusals** at the door: no recipient, one not seated and enabled, a
 *    guest's press.
 *
 * Over the REAL press and reply roads, with a faked model that counts every
 * call.
 */

import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import type { TestDb } from "$lib/server/utils/testDb"
import type { FakeTextAdapter } from "$lib/server/connectionAdapters/fakeTextAdapter"
import { JSON_INSTRUCTION } from "$lib/server/connections/structuredOutput"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "lair-whisper-recipients-test-secret" }
})

const WHISPER = "core:spec/lair-whisper#whisper"
const HUSH = "the east door is a lie"

const PLAN = {
	beats: ["The torch gutters."],
	speakers: [
		{ name: "Brannoc", intent: "check the door" },
		{ name: "Vell", intent: "hold the light" },
		{ name: "Isolde", intent: "watch the rear" }
	],
	unknownExit: "",
	knockQuestion: "",
	worldHints: { location: "The Old Well" },
	values: [],
	inventory: []
}

/** Every call the model was asked for — the whisper must add none. */
let modelCalls = 0
/** Every prompt a JSON step (the planner, the keeper) was sent. */
const jsonPrompts: string[] = []
/** Every prose prompt, by whose voice it was written in ("other" for none: the Castellan). */
const prosePrompts: Array<{ who: string; prompt: string }> = []

const voiceOf = (prompt: string) => /You are (Brannoc|Vell|Isolde),/.exec(prompt)?.[1] ?? null

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
		modelCalls++
		const prompt = JSON.stringify(this.injected ?? "")
		const json =
			this.responseFormat === "json" ||
			prompt.includes(JSON.stringify(JSON_INSTRUCTION).slice(1, 40))
		return {
			compiledPrompt: this.injected,
			isAborted: false,
			completionResult: async (onContent: (c: string) => void) => {
				if (json) {
					jsonPrompts.push(prompt)
					onContent(JSON.stringify(PLAN))
					return
				}
				const who = voiceOf(prompt)
				prosePrompts.push({ who: who ?? "other", prompt })
				onContent(who ? `${who} speaks.` : "The torch gutters.")
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
		await importOriginal<typeof import("$lib/server/connections/capabilityTarget")>()
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
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-lair-whisper-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(testDb as any)
})

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

let n = 0

/** A Lair session: Brannoc, Vell and Isolde seated and enabled, Rook seated and disabled, a guest, the master's line waiting. */
async function session() {
	const schema = await import("$lib/server/db/schema")
	const { insertLegacy } = await import("$lib/server/messages/store")
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const tag = `whisper-${++n}`
	const owner = await createTestUser(testDb, `${tag}-owner`)
	const guest = await createTestUser(testDb, `${tag}-guest`)
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
			genreId: "core:genre/lair",
			lorebookId: lorebook!.id,
			genreFields: {}
		})
		.returning()
	await testDb.insert(schema.sessionGuests).values({ sessionId: row!.id, userId: guest.id })
	const ids: Record<string, number> = {}
	for (const [position, name] of ["Brannoc", "Vell", "Isolde", "Rook"].entries()) {
		const [c] = await testDb
			.insert(schema.characters)
			.values({ userId: owner.id, name, description: "A delver." })
			.returning()
		ids[name] = c!.id
		await testDb.insert(schema.sessionCharacters).values({
			sessionId: row!.id,
			characterId: c!.id,
			isActive: name !== "Rook",
			position
		})
	}
	await insertLegacy(testDb as unknown as Db, {
		sessionId: row!.id,
		role: "user",
		content: "I open the door.",
		userId: owner.id
	})
	return { owner, guest, session: row!, ids }
}

type World = Awaited<ReturnType<typeof session>>
const ref = (w: World, name: string) => `character:${w.ids[name]}`

const fakeIo = { to: () => ({ emit: () => {} }) } as any

async function whisper(
	w: World,
	recipients: unknown[] | undefined,
	text = HUSH,
	userId = w.owner.id
) {
	const { fireAction } = await import("$lib/server/pipelines/runtime/fireAction")
	const out = await within(
		"the whisper",
		fireAction(testDb as any, {
			sessionId: w.session.id,
			action: WHISPER,
			text,
			...(recipients !== undefined ? { recipients } : {}),
			actor: { userId },
			io: fakeIo
		})
	)
	await (await import("$lib/server/pipelines/runtime/sessionEvents")).settleSessionEvents()
	return out
}

/** Each delver's whisper, by name, as the state holds it now. */
async function whispers(w: World): Promise<Record<string, unknown>> {
	const { stateFor } = await import("$lib/server/state/resolve")
	const state: any = await stateFor(testDb as any, w.session.id)
	return Object.fromEntries(
		Object.entries(w.ids).map(([name, id]) => [name, state.cast?.byId?.[String(id)]?.whisper])
	)
}

function recordingIo(userId: number, sessionId: number) {
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
	return {
		sockets: {
			adapter: {
				rooms: {
					get: (room: string) => (room === `user_${userId}` ? new Set([socketId]) : undefined)
				}
			},
			sockets: { get: (id: string) => sockets.get(id), values: () => sockets.values() }
		},
		to: () => ({ emit: () => {} })
	} as any
}

/** Continue (no entry), Narrate (`{ ref: null }`), on a composer's channel. */
async function fire(w: World, label: string, extra: Record<string, unknown> = {}) {
	const { sessionsFireTurnHandler } = await import("$lib/server/sockets/sessions")
	const io = recordingIo(w.owner.id, w.session.id)
	const res = await within(
		label,
		sessionsFireTurnHandler.handler(
			{ user: { id: w.owner.id, isAdmin: false }, io } as any,
			{ sessionId: w.session.id, ...extra } as any,
			() => {}
		)
	)
	await (await import("$lib/server/pipelines/runtime/sessionEvents")).settleSessionEvents()
	expect((res as any)?.error).toBeUndefined()
	return res
}

const reset = () => {
	modelCalls = 0
	jsonPrompts.length = 0
	prosePrompts.length = 0
}
const voicePrompts = (who: string) => prosePrompts.filter((p) => p.who === who).map((p) => p.prompt)

describe("R10 · a whisper is stored on each recipient, with no model call", () => {
	test("two recipients get the same whisper; the third delver gets nothing; the model is never asked", async () => {
		const w = await session()
		reset()
		const out = await whisper(w, [ref(w, "Brannoc"), ref(w, "Vell")])
		expect(out.kind, JSON.stringify(out)).toBe("ran")
		if (out.kind !== "ran") return
		expect(out.receipt.outcome).toBe("ok")
		expect(modelCalls).toBe(0)
		// No step of the run is a model call.
		expect(out.receipt.nodes.some((node: any) => node.kind === "oracle")).toBe(false)
		expect(await whispers(w)).toMatchObject({
			Brannoc: HUSH,
			Vell: HUSH,
			Isolde: undefined,
			Rook: undefined
		})
	})

	test("a new whisper replaces a recipient's old one, and a delver it does not name keeps theirs", async () => {
		const w = await session()
		await whisper(w, [ref(w, "Brannoc"), ref(w, "Vell")])
		const out = await whisper(w, [ref(w, "Brannoc")], "go left at the fork")
		expect(out.kind, JSON.stringify(out)).toBe("ran")
		expect(await whispers(w)).toMatchObject({
			Brannoc: "go left at the fork",
			Vell: HUSH,
			Isolde: undefined
		})
	})
})

describe("R10 · refused at the door", () => {
	test("no recipient", async () => {
		const w = await session()
		expect(await whisper(w, [])).toEqual({
			kind: "refused",
			error: "'Whisper' needs at least 1 recipient."
		})
		expect(await whisper(w, undefined)).toEqual({
			kind: "refused",
			error: "'Whisper' needs at least 1 recipient."
		})
	})

	test("a delver who is not seated and enabled", async () => {
		const w = await session()
		for (const who of [ref(w, "Rook"), "character:999999"]) {
			const out = await whisper(w, [ref(w, "Brannoc"), who])
			expect(out.kind).toBe("refused")
			expect(JSON.stringify(out)).toMatch(/enabled member of this session's cast/)
		}
		expect(await whispers(w)).toMatchObject({ Brannoc: undefined, Rook: undefined })
	})

	test("a guest's press", async () => {
		const w = await session()
		const out = await whisper(w, [ref(w, "Brannoc")], HUSH, w.guest.id)
		expect(out.kind, JSON.stringify(out)).toBe("refused")
		expect(await whispers(w)).toMatchObject({ Brannoc: undefined })
	})
})

describe("R10 · only the recipients' own voices ever read it", () => {
	test("a turn: Brannoc's and Vell's voices hear it; Isolde's, the planner's and the keeper's never do", async () => {
		const w = await session()
		await whisper(w, [ref(w, "Brannoc"), ref(w, "Vell")])
		reset()
		await fire(w, "the turn")

		const planner = jsonPrompts.filter((p) => p.includes("You plan the PARTY only"))
		const keeper = jsonPrompts.filter((p) => p.includes("You keep the record of a delve"))
		expect(planner).toHaveLength(1)
		// The Castellan's keeper, then each of the three character turns' own.
		expect(keeper).toHaveLength(4)
		for (const name of ["Brannoc", "Vell", "Isolde"]) expect(voicePrompts(name)).toHaveLength(1)

		expect(voicePrompts("Brannoc")[0]).toContain(HUSH)
		expect(voicePrompts("Vell")[0]).toContain(HUSH)
		expect(voicePrompts("Isolde")[0]).not.toContain(HUSH)
		for (const p of [...jsonPrompts, ...voicePrompts("other")]) expect(p).not.toContain(HUSH)
		// Not vacuous: the planner was shown the party's state.
		expect(planner[0]).toContain("Brannoc")
	})

	test("the Castellan's narration and its Sanctum talk never hear it", async () => {
		const w = await session()
		await whisper(w, [ref(w, "Brannoc"), ref(w, "Vell"), ref(w, "Isolde")])
		reset()
		await fire(w, "the narration", { entry: { ref: null, via: "pick" } })
		// The Castellan seated, as the create road seats it: it answers in the Sanctum.
		const schema = await import("$lib/server/db/schema")
		await testDb
			.insert(schema.sessionCharacters)
			.values({ sessionId: w.session.id, envoySlug: "castellan", isActive: true, position: 9 } as any)
		const { insertLegacy } = await import("$lib/server/messages/store")
		await insertLegacy(testDb as unknown as Db, {
			sessionId: w.session.id,
			channel: "sanctum",
			role: "user",
			content: "What would the party do next?",
			userId: w.owner.id
		})
		// The turn order recomputed (an edit cause: no auto-advance), so the
		// Castellan's Sanctum entry is prepared for the press.
		const { emitSessionEvent } = await import("$lib/server/pipelines/runtime/sessionEvents")
		const { sessionEvents } = await import("@serene-pub/sdk")
		await emitSessionEvent(testDb as any, {
			sessionId: w.session.id,
			userId: w.owner.id,
			event: sessionEvents.messageDeleted,
			payload: { sessionId: w.session.id, cause: { kind: "edit", userId: w.owner.id } },
			wait: true
		})
		await fire(w, "the Sanctum talk", { channel: "sanctum" })
		const castellan = voicePrompts("other")
		expect(castellan.some((p) => p.includes("You are the Castellan, steward"))).toBe(true)
		expect(castellan.length).toBeGreaterThanOrEqual(2)
		for (const p of [...castellan, ...jsonPrompts]) expect(p).not.toContain(HUSH)
	})
})
