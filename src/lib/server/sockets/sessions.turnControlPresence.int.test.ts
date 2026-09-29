/**
 * Lair pass B8 (F10, owner rulings D2/D3): the turn controls — Continue
 * (`advance`), Pick who speaks (`pick`) and the narrator's turn (`narrate`)
 * — are declared per genre, each with a presence condition.
 *
 *  - **Hidden** when the condition says the control does not apply in this
 *    mode: a present-when that fails is not listed at all. No shipped genre
 *    declares one since the Lair went cast only (R12, 2026-09-28), so a
 *    synthetic genre of the test's own carries the case, published the way
 *    a plugin genre is.
 *  - The Lair offers Continue, Pick and Narrate, whatever a session stored
 *    under its retired `turnStyle` key.
 *  - **Disabled with a reason** when it applies but not now: busy, or
 *    nobody seated to pick.
 *  - The fire's door refuses on the same verdicts, by sentence.
 *  - Chat and Adventure keep what they had.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "turn-control-presence-secret" }
})
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))
/** The dispatch itself is not under test: record what the door let through. */
const fired: unknown[] = []
vi.mock("$lib/server/sessions/fireTurn", async (importOriginal) => {
	const orig = (await importOriginal()) as Record<string, unknown>
	return {
		...orig,
		fireTurnEntry: async (_db: unknown, opts: { entry: unknown }) => {
			fired.push(opts.entry)
			return { fired: true, runId: "run-under-test" }
		}
	}
})

const LAIR = "core:genre/lair"
const CHAT = "core:genre/chat"
const ADVENTURE = "core:genre/adventure"
/** The synthetic genre: Pick is present only while `mode` is `x`. */
const MODES = "test:genre/modes"

/** Publish {@link MODES} as a create spec, the way a plugin genre arrives. */
async function publishModesGenre() {
	const { genre, spec, compile, sessionEvents } = await import("@serene-pub/sdk")
	const C = await import("@serene-pub/contracts")
	const decl = genre(MODES, {
		name: { en: "Modes" },
		family: "fixture",
		shape: {
			characters: { min: 0 },
			personas: { min: 0 },
			lorebook: "optional",
			composer: "text",
			voice: "narrator",
			greeting: { enabled: false },
			turnControls: {
				advance: true,
				pick: {
					presentWhen: {
						on: "session.fields.mode",
						equals: "x",
						reason: { en: "Pick who speaks is for mode x." }
					}
				},
				narrate: true
			},
			fields: {
				mode: {
					type: "enum",
					label: { en: "Mode" },
					of: ["x", "y"],
					default: "x"
				}
			}
		} as any,
		events: {
			[sessionEvents.messageRespond]: { required: true }
		}
	})
	const doc = compile(
		spec("test:spec/modes-create", {
			version: "1.0.0",
			taxonomy: { role: "create" },
			genre: {
				name: decl.name,
				family: decl.family,
				shape: decl.shape,
				events: decl.events as Record<string, { required?: boolean; open?: boolean }>
			}
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
		path.join(os.tmpdir(), "serene-pub-turn-control-presence-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(testDb as any)
	await publishModesGenre()
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

/** A session of `genreId`, one delver seated unless `seat: false`, a person's line newest. */
async function session(
	tag: string,
	genreId: string,
	opts: {
		fields?: Record<string, unknown>
		seat?: boolean
		generating?: boolean
	} = {}
) {
	const schema = await import("$lib/server/db/schema")
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const owner = await createTestUser(testDb, `${tag}-owner`)
	const [row] = await testDb
		.insert(schema.sessions)
		.values({
			userId: owner.id,
			isGroup: false,
			genreId,
			...(opts.fields ? { genreFields: opts.fields } : {})
		} as any)
		.returning()
	let characterId: number | null = null
	if (opts.seat !== false) {
		const [character] = await testDb
			.insert(schema.characters)
			.values({ userId: owner.id, name: `Brannoc ${tag}`, description: "a delver" })
			.returning()
		characterId = character!.id
		await testDb
			.insert(schema.sessionCharacters)
			.values({ sessionId: row!.id, characterId, position: 0 })
	}
	await testDb.insert(schema.sessionMessages).values({
		sessionId: row!.id,
		role: "user",
		content: "The party enter the hall.",
		userId: owner.id
	})
	if (opts.generating)
		await testDb.insert(schema.sessionMessages).values({
			sessionId: row!.id,
			role: "assistant",
			isNarratorResponse: true,
			isGenerating: true,
			content: "",
			userId: owner.id
		})
	return { owner, session: row!, characterId }
}

type Listed = {
	key: string
	specSlug: string
	enabled: boolean
	reason?: { i18n: Record<string, string> }
}
async function extraAt(sessionId: number, userId: number) {
	const { sessionsActionsHandler } = await import("./sessions")
	const res = await sessionsActionsHandler.handler(
		fakeSocket(userId),
		{ sessionId },
		noopEmit
	)
	const v = res.venues.extra as { primary: Listed[]; overflow: Listed[] }
	return [...v.primary, ...v.overflow].filter((a) => a.specSlug === "core")
}
const keys = (listed: Listed[]) => listed.map((a) => a.key)

async function fire(
	userId: number,
	sessionId: number,
	entry?: { ref: string | null; via: string }
) {
	const { sessionsFireTurnHandler } = await import("./sessions")
	return sessionsFireTurnHandler.handler(
		fakeSocket(userId),
		{ sessionId, ...(entry ? { entry } : {}) },
		noopEmit
	)
}

describe("B8 · a present-when hides a control (synthetic genre)", () => {
	test("mode y: Continue and the narrator's turn, and no Pick", async () => {
		const { owner, session: s } = await session("y-list", MODES, {
			fields: { mode: "y" }
		})
		const extra = keys(await extraAt(s.id, owner.id))
		expect(extra).toContain("advance")
		expect(extra).toContain("narrate")
		expect(extra).not.toContain("pick")
	})

	test("mode x: Pick who speaks is listed, and pressable", async () => {
		const { owner, session: s } = await session("x-list", MODES, {
			fields: { mode: "x" }
		})
		const pick = (await extraAt(s.id, owner.id)).find((a) => a.key === "pick")
		expect(pick).toBeDefined()
		expect(pick!.enabled).toBe(true)
	})

	test("the declared default (x) lists Pick with no field stored", async () => {
		const { owner, session: s } = await session("default-list", MODES)
		expect(keys(await extraAt(s.id, owner.id))).toContain("pick")
	})

	test("the server refuses Pick in mode y, by sentence", async () => {
		const { owner, session: s, characterId } = await session("y-refuse", MODES, {
			fields: { mode: "y" }
		})
		fired.length = 0
		const res = await fire(owner.id, s.id, {
			ref: `character:${characterId}`,
			via: "pick"
		})
		expect(res.ok).toBe(false)
		expect(res.error).toMatch(/mode x/)
		expect(fired).toEqual([])
	})

	test("which unprepared entries press a turn control", async () => {
		const { pressedTurnControl } = await import("$lib/server/messages/verbs")
		expect(pressedTurnControl({ voice: "narrator" }, { ref: null })).toBe("narrate")
		expect(pressedTurnControl({ voice: "character" }, { ref: null })).toBeNull()
		expect(pressedTurnControl({}, { ref: "character:3" })).toBe("pick")
		expect(pressedTurnControl({}, { ref: "envoy:guide" })).toBeNull()
	})

	test("the narrate control fires a narrator turn", async () => {
		const { owner, session: s } = await session("y-fire", MODES, {
			fields: { mode: "y" }
		})
		fired.length = 0
		const res = await fire(owner.id, s.id, { ref: null, via: "pick" })
		expect(res.error).toBeUndefined()
		expect(res.ok).toBe(true)
		expect(fired).toHaveLength(1)
		// R8: the press is stamped `narrate`, so a genre can route it.
		expect(fired[0]).toMatchObject({ ref: null, via: "narrate" })
	})
})

describe("R12 · the Lair is cast only", () => {
	test("Continue, Pick and Narrate are all listed", async () => {
		const { owner, session: s } = await session("lair-list", LAIR)
		const extra = keys(await extraAt(s.id, owner.id))
		for (const key of ["advance", "pick", "narrate"]) expect(extra).toContain(key)
	})

	test("a stored turnStyle 'narrator' is inert: Pick is listed and fires", async () => {
		const { owner, session: s, characterId } = await session("lair-stale", LAIR, {
			fields: { turnStyle: "narrator" }
		})
		expect(keys(await extraAt(s.id, owner.id))).toContain("pick")
		fired.length = 0
		const res = await fire(owner.id, s.id, {
			ref: `character:${characterId}`,
			via: "pick"
		})
		expect(res.error).toBeUndefined()
		expect(fired).toHaveLength(1)
	})
})

describe("B8 · a control that applies but not now is grey, with its reason", () => {
	test("nobody seated: Pick is listed disabled with its reason", async () => {
		const { owner, session: s } = await session("nobody", LAIR, {
			seat: false
		})
		const pick = (await extraAt(s.id, owner.id)).find((a) => a.key === "pick")
		expect(pick).toBeDefined()
		expect(pick!.enabled).toBe(false)
		expect(pick!.reason?.i18n.en).toBe("nobody is seated to pick")
	})

	test("while a reply generates, every turn control is grey with the busy reason, and the door refuses", async () => {
		const { owner, session: s, characterId } = await session("busy", LAIR, {
			generating: true
		})
		const listed = await extraAt(s.id, owner.id)
		for (const key of ["advance", "pick", "narrate"]) {
			const a = listed.find((x) => x.key === key)
			expect(a, key).toBeDefined()
			expect(a!.enabled, key).toBe(false)
			expect(a!.reason?.i18n.en, key).toBe("wait for the reply to finish")
		}
		fired.length = 0
		const res = await fire(owner.id, s.id, {
			ref: `character:${characterId}`,
			via: "pick"
		})
		expect(res.ok).toBe(false)
		expect(res.error).toBe("wait for the reply to finish")
		expect(fired).toEqual([])
	})
})

describe("B8 · Chat and Adventure are unchanged", () => {
	test("Chat: Continue and Pick; its narrator is the narrate function, not a turn control", async () => {
		const { owner, session: s, characterId } = await session("chat", CHAT)
		const extra = keys(await extraAt(s.id, owner.id))
		expect(extra).toContain("advance")
		expect(extra).toContain("pick")
		expect(extra).toContain("retry")
		expect(extra).not.toContain("narrate")
		fired.length = 0
		const picked = await fire(owner.id, s.id, {
			ref: `character:${characterId}`,
			via: "pick"
		})
		expect(picked.error).toBeUndefined()
		expect(fired).toHaveLength(1)
		// Chat has no narrator voice: a null ref is the pipeline's own
		// voice, the owner's latitude as before — no turn control judged.
		const unprepared = await fire(owner.id, s.id, { ref: null, via: "pick" })
		expect(unprepared.error).toBeUndefined()
		expect(fired).toHaveLength(2)
	})

	test("Adventure: Continue and Pick, and its narrator can be handed the turn", async () => {
		const { owner, session: s, characterId } = await session("adv", ADVENTURE)
		const extra = keys(await extraAt(s.id, owner.id))
		expect(extra).toContain("advance")
		expect(extra).toContain("pick")
		expect(extra).toContain("narrate")
		fired.length = 0
		expect(
			(await fire(owner.id, s.id, { ref: `character:${characterId}`, via: "pick" }))
				.error
		).toBeUndefined()
		expect(
			(await fire(owner.id, s.id, { ref: null, via: "pick" })).error
		).toBeUndefined()
		expect(fired).toHaveLength(2)
	})
})
