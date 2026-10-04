/**
 * Earshot (lair pass R1, 2026-09-28): a slot declared `earshot: 'holder'` —
 * the Lair's whisper — reaches only its holder's own voice prompt.
 *
 * State becomes a prompt at exactly two places, and each is tested here on
 * its own before the whole road is:
 *
 *  1. the shared builder, `build-template-context@1` — the `{{state}}` a
 *     template walks, on every surface (a trap, a reveal, a room build
 *     bind it directly; the adventure surfaces reach it through
 *     `mergeContext`);
 *  2. `mergeContext`, the adventure surfaces' merge — `{{stateSummary}}`,
 *     `{{slots}}` and `{{location}}` for the planner, the scene, the keeper
 *     and each voice (`build-side-character-context@1`).
 *
 * Then the Lair over the REAL reply road: Brannoc holds a whisper, and it is
 * in Brannoc's voice prompt (his character turn, planned or picked) and in no
 * other — not Vell's, not the planner's, the scene's or any keeper's.
 *
 * The faked model answers every JSON request (planner, keeper) with one
 * document naming both delvers as speakers, and every prose request by whose
 * prompt it is: the `lair-voice` prompt opens "You are <name>,".
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
	return { db, getCryptoSecretKey: () => "earshot-test-secret" }
})

const WHISPER = "core:slot/whisper@1"
/** Brannoc's whisper, and Vell's own: distinct enough to find in any prompt. */
const TO_BRANNOC = "the east door is a lie"
const TO_VELL = "keep the lamp for yourself"

const PLAN = {
	beats: ["The torch gutters."],
	speakers: [
		{ name: "Brannoc", intent: "check the door" },
		{ name: "Vell", intent: "hold the light" }
	],
	unknownExit: "",
	knockQuestion: "",
	worldHints: { location: "The Old Well" },
	values: [],
	inventory: []
}
/** Every prompt a JSON step (the planner, the keeper) was sent. */
const jsonPrompts: string[] = []
/** Every prose prompt, by whose voice it was written in ("other" for none). */
const prosePrompts: Array<{ who: string; prompt: string }> = []

const voiceOf = (prompt: string) => /You are (Brannoc|Vell),/.exec(prompt)?.[1] ?? null

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
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-earshot-"))
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

/** A Lair session: Brannoc and Vell seated, each whispered to, and the master's line waiting. */
async function session() {
	const schema = await import("$lib/server/db/schema")
	const { insertLegacy } = await import("$lib/server/messages/store")
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const { setValue } = await import("$lib/server/state/write")
	const tag = `earshot-${++n}`
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
			genreId: "core:genre/lair",
			lorebookId: lorebook!.id,
			genreFields: {}
		})
		.returning()
	const ids: Record<string, number> = {}
	for (const [position, name] of ["Brannoc", "Vell"].entries()) {
		const [c] = await testDb
			.insert(schema.characters)
			.values({ userId: owner.id, name, description: "A delver." })
			.returning()
		ids[name] = c!.id
		await testDb.insert(schema.sessionCharacters).values({
			sessionId: row!.id,
			characterId: c!.id,
			isActive: true,
			position
		})
	}
	for (const [name, value] of [
		["Brannoc", TO_BRANNOC],
		["Vell", TO_VELL]
	] as const)
		await setValue(
			testDb as unknown as Db,
			{ sessionId: row!.id, updatedBy: "user" },
			{ owner: { kind: "session_cast", id: ids[name]! }, slotId: WHISPER, value }
		)
	await insertLegacy(testDb as unknown as Db, {
		sessionId: row!.id,
		role: "user",
		content: "I open the door.",
		userId: owner.id
	})
	return { owner, session: row!, brannoc: ids.Brannoc!, vell: ids.Vell! }
}

type World = Awaited<ReturnType<typeof session>>

/** What one prompt could have shown the model: the whole built value, as text. */
const shown = (result: any): string => {
	expect(result?.kind).toBe("ok")
	return JSON.stringify(result.value)
}

describe("the two seams, each on its own", () => {
	let w: World
	let bindings: Record<string, (input: any, ctx: any) => Promise<any>>
	let cast: unknown
	let state: any
	const taskCtx = {
		signal: new AbortController().signal,
		progress: () => {},
		log: () => {}
	}
	const prompts = { systemPrompt: "{{stateSummary}}" }

	beforeAll(async () => {
		w = await session()
		const { coreBindings } = await import("$lib/server/pipelines/runtime/bindings")
		const { createHost } = await import("$lib/server/pipelines/runtime/host")
		const { stateFor } = await import("$lib/server/state/resolve")
		bindings = coreBindings() as any
		const read = await bindings["core:query/session-cast@1"]!(
			{ scope: { sessionId: w.session.id } },
			{
				...taskCtx,
				read: (table: string, q: unknown) =>
					createHost(testDb as any, {
						sessionId: w.session.id,
						userId: w.owner.id
					}).read!(table, q, {
						key: "cast",
						definitionId: "core:query/session-cast",
						definitionVersion: 1,
						kind: "query"
					})
			}
		)
		cast = read.value.cast
		state = await stateFor(testDb as any, w.session.id)
	})

	test("the state query still carries both whispers, and says whose ears they are for", () => {
		// The read is the run's, shared by every voice: earshot is enforced
		// where a prompt is built, never here. Widgets read this too.
		expect(state.cast.byId[String(w.brannoc)].whisper).toBe(TO_BRANNOC)
		expect(state.cast.byId[String(w.vell)].whisper).toBe(TO_VELL)
		expect(state.slots.find((s: any) => s.id === WHISPER)?.earshot).toBe("holder")
		// An ordinary slot says nothing.
		expect(state.slots.find((s: any) => s.id === "core:slot/hp@1")).not.toHaveProperty("earshot")
	})

	const nobody = [
		["the planner", "core:task/build-planner-context@1", {}],
		["the scene", "core:task/build-scene-context@1", { plan: { beats: ["x"] } }],
		["the keeper", "core:task/build-keeper-context@1", { reply: "Brannoc speaks." }]
	] as const

	for (const [label, pin, extra] of nobody)
		test(`seam 2 (mergeContext) · ${label} hears no whisper`, async () => {
			const text = shown(
				await bindings[pin]!({ cast, state, prompts, ...extra }, taskCtx)
			)
			expect(text).not.toContain(TO_BRANNOC)
			expect(text).not.toContain(TO_VELL)
			// Not vacuous: the state did reach it.
			expect(text).toContain("Brannoc")
		})

	test("seam 2 (mergeContext) · a voice hears its own whisper and nobody else's", async () => {
		for (const [sideCharacter, own, other] of [
			// A planned turn's cast `each`: the planner's name.
			[{ name: "Brannoc" }, TO_BRANNOC, TO_VELL],
			// Pick who speaks: the delver's id.
			[{ characterId: w.brannoc }, TO_BRANNOC, TO_VELL],
			[{ name: "Vell" }, TO_VELL, TO_BRANNOC],
			[{ characterId: w.vell }, TO_VELL, TO_BRANNOC]
		] as const) {
			const text = shown(
				await bindings["core:task/build-side-character-context@1"]!(
					{ cast, state, prompts, sideCharacter },
					taskCtx
				)
			)
			expect(text).toContain(own)
			expect(text).not.toContain(other)
		}
		// A side character the cast does not hold is nobody's voice.
		const stranger = shown(
			await bindings["core:task/build-side-character-context@1"]!(
				{ cast, state, prompts, sideCharacter: { name: "The Stranger" } },
				taskCtx
			)
		)
		expect(stranger).not.toContain(TO_BRANNOC)
		expect(stranger).not.toContain(TO_VELL)
	})

	test("seam 1 (build-template-context) · nobody's voice unless `speaker` names the holder", async () => {
		const build = bindings["core:task/build-template-context@1"]!
		// A trap, a reveal, a room build: the session's speaker is not a voice.
		const trap = shown(
			await build({ cast, state, prompts, currentCharacterId: w.brannoc }, taskCtx)
		)
		expect(trap).not.toContain(TO_BRANNOC)
		expect(trap).not.toContain(TO_VELL)
		expect(trap).toContain('"brannoc"')
		// An envoy is nobody's holder.
		const envoy = shown(
			await build({ cast, state, prompts, speaker: "envoy:castellan" }, taskCtx)
		)
		expect(envoy).not.toContain(TO_BRANNOC)
		expect(envoy).not.toContain(TO_VELL)
		// A cast member's own voice, named on `speaker`.
		const own = shown(
			await build({ cast, state, prompts, speaker: `character:${w.brannoc}` }, taskCtx)
		)
		expect(own).toContain(TO_BRANNOC)
		expect(own).not.toContain(TO_VELL)
	})

	test("the run's state is never mutated by a prompt that could not hear it", () => {
		expect(state.cast.byId[String(w.brannoc)].whisper).toBe(TO_BRANNOC)
		expect(state.cast.brannoc.whisper).toBe(TO_BRANNOC)
		expect(state.cast.byId[String(w.vell)].whisper).toBe(TO_VELL)
	})

	test("withinEarshot keeps one object per member across byId, the slugs and the roles", async () => {
		const { withinEarshot } = await import("$lib/server/pipelines/prompt/adventureContext")
		const heard = withinEarshot(state, `character:${w.vell}`) as any
		expect(heard).not.toBe(state)
		expect(heard.cast.byId[String(w.brannoc)]).toBe(heard.cast.brannoc)
		expect(heard.cast.brannoc).not.toHaveProperty("whisper")
		expect(heard.cast.vell.whisper).toBe(TO_VELL)
		for (const member of heard.who.active ?? [])
			expect(member).toBe(heard.cast.byId[String(member.id)])
		// The hp the planner needs is untouched.
		expect(Object.keys(heard.cast.brannoc).sort()).toEqual(
			Object.keys(state.cast.brannoc)
				.filter((k) => k !== "whisper" && !k.endsWith("whisper"))
				.sort()
		)
	})
})

/* ── The Lair over the real reply road ─────────────────────────────────── */

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
			emit: (event: string, payload: any) => emitted.push({ room, event, payload })
		})
	}
	return { io: io as any, emitted }
}

async function fire(w: World, label: string, entry?: Record<string, unknown>) {
	const { sessionsFireTurnHandler } = await import("$lib/server/sockets/sessions")
	const { io, emitted } = recordingIo(w.owner.id, w.session.id)
	const res = await within(
		label,
		sessionsFireTurnHandler.handler(
			{ user: { id: w.owner.id, isAdmin: false }, io } as any,
			{ sessionId: w.session.id, ...(entry ? { entry } : {}) } as any,
			(event: string, payload: any) => emitted.push({ room: "caller", event, payload })
		)
	)
	await (await import("$lib/server/pipelines/runtime/sessionEvents")).settleSessionEvents()
	return res
}

const reset = () => {
	jsonPrompts.length = 0
	prosePrompts.length = 0
}
const voicePrompts = (who: string) =>
	prosePrompts.filter((p) => p.who === who).map((p) => p.prompt)

describe("the Lair road · a whisper reaches its holder's voice and no other prompt", () => {
	test("a planned turn: in Brannoc's voice, never in Vell's, the planner's or the keeper's", async () => {
		reset()
		const w = await session()
		// Continue — the Castellan's turn (R8: an explicit `{ ref: null }` is
		// the Narrate press).
		const res = await fire(w, "the planned turn")
		expect((res as any)?.error).toBeUndefined()

		const planner = jsonPrompts.filter((p) => p.includes("You plan the PARTY only"))
		const keeper = jsonPrompts.filter((p) => p.includes("You keep the record of a delve"))
		expect(planner).toHaveLength(1)
		// The Castellan's keeper (the world's books), then each planned
		// character turn's own (owner ruling 2026-09-30).
		expect(keeper).toHaveLength(3)
		expect(voicePrompts("Brannoc")).toHaveLength(1)
		expect(voicePrompts("Vell")).toHaveLength(1)

		// Every prompt that is nobody's voice: the planner, the keeper,
		// anything else JSON (R8: a turn writes no scene).
		for (const p of [...jsonPrompts, ...voicePrompts("other")]) {
			expect(p).not.toContain(TO_BRANNOC)
			expect(p).not.toContain(TO_VELL)
		}
		// Not vacuous: the planner was shown the state, hp and all.
		expect(planner[0]).toContain("Brannoc")

		const [brannoc] = voicePrompts("Brannoc")
		const [vell] = voicePrompts("Vell")
		expect(brannoc).toContain(TO_BRANNOC)
		expect(brannoc).not.toContain(TO_VELL)
		expect(vell).toContain(TO_VELL)
		expect(vell).not.toContain(TO_BRANNOC)
	})

	test("R8 · the Castellan's narration hears no whisper", async () => {
		reset()
		const w = await session()
		const res = await fire(w, "the narration", { ref: null, via: "pick" })
		expect((res as any)?.error).toBeUndefined()
		const narration = voicePrompts("other")
		expect(narration.length).toBeGreaterThan(0)
		expect(narration.some((p) => p.includes("You are the Castellan, steward"))).toBe(true)
		for (const p of [...narration, ...jsonPrompts]) {
			expect(p).not.toContain(TO_BRANNOC)
			expect(p).not.toContain(TO_VELL)
		}
	})

	test("Pick who speaks: Brannoc's voice hears his whisper, Vell's does not", async () => {
		reset()
		const w = await session()
		const picked = await fire(w, "pick Brannoc", {
			ref: `character:${w.brannoc}`,
			via: "pick"
		})
		expect((picked as any)?.error).toBeUndefined()
		expect(voicePrompts("Brannoc")).toHaveLength(1)
		expect(voicePrompts("Brannoc")[0]).toContain(TO_BRANNOC)
		expect(voicePrompts("Brannoc")[0]).not.toContain(TO_VELL)

		reset()
		const again = await fire(w, "pick Vell", { ref: `character:${w.vell}`, via: "pick" })
		expect((again as any)?.error).toBeUndefined()
		expect(voicePrompts("Vell")).toHaveLength(1)
		expect(voicePrompts("Vell")[0]).not.toContain(TO_BRANNOC)
		expect(voicePrompts("Vell")[0]).toContain(TO_VELL)
	})
})
