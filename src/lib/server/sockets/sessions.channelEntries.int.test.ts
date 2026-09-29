/**
 * The own voice's entry (lair re-plan R5, 2026-09-28): the turn order names
 * it, it spans channels, and Continue is channel-scoped.
 *
 * What is pinned:
 *
 *  1. **Continue fires its composer's channel.** With no entry named, a
 *     press fires the first entry on the channel it was pressed on
 *     (`channel`, absent = `main`): with a `main` entry and a Sanctum entry
 *     prepared, `main` fires main's and `sanctum` fires the Sanctum's —
 *     whichever heads the order. On `main` with nothing prepared there, the
 *     owner's Continue carries on (the own voice's turn, `via: 'pick'`, on
 *     `main`) and a guest is refused, as before; on another channel with
 *     nothing prepared, the head fires as it always did.
 *  2. **An entry is its reference AND its channel.** The Narrate press
 *     (`{ ref: null }`, no channel) is a narrator's turn on `main`, never a
 *     prepared Sanctum entry that happens to share the null reference.
 *  3. **Guests keep their rule**: the first entry on a channel is that
 *     channel's head, which a guest may fire.
 *  4. **The name.** A genre that declares a fallback envoy names the null
 *     entry by it — the seed line and the progress card's `{speaker}` —
 *     and one that does not (Adventure) keeps the narrator's name.
 *
 * The genre under test is the test's own (`test:genre/steward`): narrator
 * voice, a `sanctum` channel, and a fallback envoy — the shape the Lair
 * takes in R6, published the way a plugin genre arrives. The dispatch is not
 * under test: `fireTurnEntry` records what the door let through.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "channel-entries-secret" }
})
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))
const fired: Array<Record<string, unknown>> = []
vi.mock("$lib/server/sessions/fireTurn", async (importOriginal) => {
	const orig = (await importOriginal()) as Record<string, unknown>
	return {
		...orig,
		fireTurnEntry: async (_db: unknown, opts: { entry: Record<string, unknown> }) => {
			fired.push(opts.entry)
			return { fired: true, runId: "run-under-test" }
		}
	}
})

const STEWARD = "test:genre/steward"
const ADVENTURE = "core:genre/adventure"

/** Publish {@link STEWARD} as a create spec, the way a plugin genre arrives. */
async function publishStewardGenre() {
	const { genre, spec, compile, sessionEvents } = await import("@serene-pub/sdk")
	const C = await import("@serene-pub/contracts")
	const decl = genre(STEWARD, {
		name: { en: "Steward" },
		family: "fixture",
		shape: {
			characters: { min: 0 },
			personas: { min: 0 },
			lorebook: "optional",
			composer: "text",
			voice: "narrator",
			greeting: { enabled: false },
			channels: [
				"main",
				{ slug: "sanctum", role: "conversation", voice: "character" }
			],
			turnControls: { advance: true, pick: true, narrate: true }
		} as any,
		envoys: [
			{
				key: "steward",
				name: { en: "Steward", fr: "Intendant" },
				fallback: true,
				speaks: "in-turn"
			}
		],
		events: {
			[sessionEvents.messageRespond]: { required: true }
		}
	} as any)
	const doc = compile(
		spec("test:spec/steward-create", {
			version: "1.0.0",
			taxonomy: { role: "create" },
			genre: {
				name: decl.name,
				family: decl.family,
				shape: decl.shape,
				envoys: (decl as any).envoys,
				events: decl.events as Record<string, { required?: boolean; open?: boolean }>
			} as any
		})
			.inlet("input", C.sessionCreated.v1(), {
				genre: decl,
				event: sessionEvents.sessionCreated
			})
			.query("collect", ($) => C.sessionGreetings.v1({ scope: $.input.sessionScope }))
			.outlet("seed", ($) =>
				C.seedGreetings.v1({ greetings: $.collect.greetings, channel: "main" })
			)
			.build()
	)
	const { saveDocument } = await import("$lib/server/pipelines/boot/store")
	await saveDocument(testDb as any, doc, { publish: true })
}

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-channel-entries-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(testDb as any)
	await publishStewardGenre()
}, 180_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

function fakeSocket(userId: number) {
	return {
		user: { id: userId, isAdmin: false },
		io: { to: () => ({ emit: () => {} }) }
	} as any
}
const noopEmit = () => {}

/** A session of `genreId` with a guest, a delver seated, and `order` stored. */
async function session(
	tag: string,
	genreId: string,
	order: Array<Record<string, unknown>>
) {
	const schema = await import("$lib/server/db/schema")
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const owner = await createTestUser(testDb, `${tag}-owner`)
	const guest = await createTestUser(testDb, `${tag}-guest`)
	const [row] = await testDb
		.insert(schema.sessions)
		.values({
			userId: owner.id,
			isGroup: false,
			genreId,
			metadata: {
				turnOrder: {
					v: 1,
					order,
					candidates: [],
					basedOnAt: Date.now(),
					computedAt: Date.now(),
					runId: null,
					event: null,
					strategy: "core:task/turn-narrator@1"
				}
			}
		} as any)
		.returning()
	await testDb
		.insert(schema.sessionGuests)
		.values({ sessionId: row!.id, userId: guest.id })
	const [character] = await testDb
		.insert(schema.characters)
		.values({ userId: owner.id, name: `Brannoc ${tag}`, description: "a delver" })
		.returning()
	await testDb
		.insert(schema.sessionCharacters)
		.values({ sessionId: row!.id, characterId: character!.id, position: 0 })
	await testDb.insert(schema.sessionMessages).values({
		sessionId: row!.id,
		role: "user",
		content: "The party enter the hall.",
		userId: owner.id
	})
	return { owner, guest, session: row! }
}

async function press(
	userId: number,
	sessionId: number,
	opts: { channel?: string; entry?: { ref: string | null; via: string } } = {}
) {
	const { sessionsFireTurnHandler } = await import("./sessions")
	fired.length = 0
	const res = await sessionsFireTurnHandler.handler(
		fakeSocket(userId),
		{ sessionId, ...opts } as any,
		noopEmit
	)
	return { res, fired: [...fired] }
}

const MAIN = { ref: null, via: "voice" }
const SANCTUM = { ref: null, via: "voice", channel: "sanctum" }

describe("R5 · Continue fires the entry of the channel it was pressed on", () => {
	test("from main, main's entry — even when the Sanctum's heads the order", async () => {
		const { owner, session: s } = await session("main-press", STEWARD, [SANCTUM, MAIN])
		const { res, fired } = await press(owner.id, s.id)
		expect(res.error).toBeUndefined()
		expect(fired).toHaveLength(1)
		expect(fired[0]).not.toHaveProperty("channel")
		expect(fired[0]).toMatchObject({ ref: null, via: "voice" })
		// `channel: 'main'` said aloud is the same press.
		expect((await press(owner.id, s.id, { channel: "main" })).fired[0]).not.toHaveProperty(
			"channel"
		)
	})

	test("from the Sanctum, the Sanctum's — even when main's heads the order", async () => {
		const { owner, session: s } = await session("sanctum-press", STEWARD, [MAIN, SANCTUM])
		const { res, fired } = await press(owner.id, s.id, { channel: "sanctum" })
		expect(res.error).toBeUndefined()
		expect(fired).toEqual([{ ref: null, via: "voice", channel: "sanctum" }])
	})

	test("main with only a Sanctum entry: the owner's Continue carries the story on, on main", async () => {
		const { owner, guest, session: s } = await session("carry", STEWARD, [SANCTUM])
		const { res, fired } = await press(owner.id, s.id)
		expect(res.error).toBeUndefined()
		expect(fired).toEqual([{ ref: null, via: "pick" }])
		// A guest has no carry-on, as before.
		const refused = await press(guest.id, s.id)
		expect(refused.res.ok).toBe(false)
		expect(refused.res.error).toBe("Nothing is prepared to take a turn.")
		expect(refused.fired).toEqual([])
	})

	test("another channel with nothing of its own prepared fires the head, as it always did", async () => {
		const { owner, session: s } = await session("elsewhere", STEWARD, [MAIN])
		const { fired } = await press(owner.id, s.id, { channel: "sanctum" })
		expect(fired).toEqual([MAIN])
	})

	test("a guest may fire the first entry on the channel they pressed on", async () => {
		const { guest, session: s } = await session("guest", STEWARD, [MAIN, SANCTUM])
		const fromSanctum = await press(guest.id, s.id, { channel: "sanctum" })
		expect(fromSanctum.res.error).toBeUndefined()
		expect(fromSanctum.fired).toEqual([SANCTUM])
		const fromMain = await press(guest.id, s.id)
		expect(fromMain.fired).toEqual([MAIN])
	})

	test("Narrate (a null pick, no channel) is main's own-voice turn, never the prepared Sanctum entry", async () => {
		const { owner, session: s } = await session("narrate", STEWARD, [SANCTUM])
		const { res, fired } = await press(owner.id, s.id, {
			channel: "sanctum",
			entry: { ref: null, via: "pick" }
		})
		expect(res.error).toBeUndefined()
		// R8: stamped `narrate`, carrying where it was pressed — the run
		// routes it ahead of the channel, so the narration lands on main.
		expect(fired).toEqual([{ ref: null, via: "narrate", channel: "sanctum" }])
	})

	test("Adventure is unchanged: one main entry, fired by Continue", async () => {
		const { owner, session: s } = await session("adventure", ADVENTURE, [MAIN])
		const { fired } = await press(owner.id, s.id)
		expect(fired).toEqual([MAIN])
	})
})

describe("R5 · the entry's name", () => {
	test("the seed line of a fallback-envoy narrator genre carries the envoy's name; Adventure's the narrator's", async () => {
		const { coreBindings } = await import("$lib/server/pipelines/runtime/bindings")
		const { createHost } = await import("$lib/server/pipelines/runtime/host")
		const bindings = coreBindings() as Record<string, (i: any, c: any) => Promise<any>>
		const seedOf = async (genreId: string, tag: string) => {
			const { owner, session: s } = await session(tag, genreId, [MAIN])
			const taskCtx = {
				signal: new AbortController().signal,
				progress: () => {},
				log: () => {}
			}
			const read = await bindings["core:query/session-cast@1"]!(
				{ scope: { sessionId: s.id } },
				{
					...taskCtx,
					read: (table: string, q: unknown) =>
						createHost(testDb as any, { sessionId: s.id, userId: owner.id }).read!(
							table,
							q,
							{
								key: "cast",
								definitionId: "core:query/session-cast",
								definitionVersion: 1,
								kind: "query"
							}
						)
				}
			)
			// A narrator turn: nobody in the cast speaks.
			const built = await bindings["core:task/build-template-context@1"]!(
				{
					cast: { ...read.value.cast, currentCharacterId: null },
					currentCharacterId: null,
					prompts: { systemPrompt: "x", narratorName: "Narrator" }
				},
				taskCtx
			)
			expect(built.kind).toBe("ok")
			return built.value.seedName
		}
		expect(await seedOf(STEWARD, "seed-steward")).toBe("Steward")
		expect(await seedOf(ADVENTURE, "seed-adventure")).toBe("Narrator")
	})

	test("the progress card's {speaker}: a null-speaker turn is named by the own voice", async () => {
		const { speakerDisplayName, createStatusRelay } = await import(
			"$lib/server/pipelines/runtime/runStatus"
		)
		const steward = await session("status-steward", STEWARD, [MAIN])
		const adventure = await session("status-adventure", ADVENTURE, [MAIN])
		expect(
			await speakerDisplayName(testDb as any, {
				sessionId: steward.session.id,
				speaker: null
			})
		).toBe("Steward")
		expect(
			await speakerDisplayName(testDb as any, {
				sessionId: adventure.session.id,
				speaker: null
			})
		).toBe("Narrator")

		// The relay fills it for a null speaker (the own voice's turn), and
		// still withholds it for a run with no speaker at all (a summary).
		const said: string[] = []
		const relay = (speaker: null | undefined) =>
			createStatusRelay({
				db: testDb as any,
				sessionId: steward.session.id,
				runId: `status-${String(speaker)}`,
				live: { status: async () => {} } as any,
				speaker,
				onStatus: (_k, text) => said.push((text as any).vars?.speaker ?? "?")
			})
		const own = relay(null)
		own.set("say", { i18n: { en: "{speaker} is typing" } } as any)
		await own.end()
		const nobody = relay(undefined)
		nobody.set("say", { i18n: { en: "{speaker} is typing" } } as any)
		await nobody.end()
		expect(said).toEqual(["Steward"])
	})
})

describe("R5 · the order, recomputed", () => {
	test("Adventure's narrator entry carries no channel", async () => {
		const schema = await import("$lib/server/db/schema")
		const { owner, session: s } = await session("recompute", ADVENTURE, [])
		const { runBuiltIn } = await import("$lib/server/pipelines/runtime/builtins")
		const [reply] = await testDb
			.insert(schema.sessionMessages)
			.values({
				sessionId: s.id,
				role: "assistant",
				isNarratorResponse: true,
				content: "The lantern gutters.",
				userId: owner.id
			})
			.returning()
		// Hiding the reply is an event the turn order answers.
		const hidden = await runBuiltIn(testDb as unknown as Db, {
			kind: "hide",
			sessionId: s.id,
			actor: owner.id,
			payload: { target: reply!.id, hidden: true }
		} as any)
		expect((hidden as any).ok).toBe(true)
		await (await import("$lib/server/pipelines/runtime/sessionEvents")).settleSessionEvents()
		const { readTurnOrder } = await import("@serene-pub/sdk")
		const [row] = await testDb
			.select({ metadata: schema.sessions.metadata })
			.from(schema.sessions)
			.where(eq(schema.sessions.id, s.id))
		expect(readTurnOrder(row!.metadata).order).toEqual([MAIN])
	})
})
