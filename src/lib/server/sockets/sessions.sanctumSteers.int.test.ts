/**
 * **Sanctum talk steers the story** and **the Castellan's scratchpad** (lair
 * re-plan R13, owner F3 and QB 2026-09-28) — over the REAL create and reply
 * roads, against the SHIPPED Lair documents the bootstrap publishes, with a
 * fake adapter standing in for the model.
 *
 * What is pinned:
 *
 *  1. **On (the default).** The planner reads the Sanctum talk since the
 *     story's last line — a person's line and the Castellan's reply — and
 *     the scratchpad, each in its own block. Never older talk, the greeting
 *     or a beats row.
 *  2. **Off.** The planner reads neither; Narrate pressed on `main` reads no
 *     talk; Narrate pressed in the Sanctum reads it (the press is the
 *     person saying "play this").
 *  3. **Either way, the party never hear it.** No delver's voice and no
 *     keeper prompt holds Sanctum talk or the scratchpad.
 *  4. **The cap.** Only the newest twelve rows of talk are read.
 *  5. **The scratchpad.** Each Sanctum reply rewrites it (a Background JSON
 *     call); the next planner and the next Sanctum reply read it; the owner
 *     edits it through its ready-made action; no person's annex view shows
 *     it.
 *  6. **The bound, alone** (`unplayedTalkRows`): the greeting (a create
 *     run's row) and a beats row (a story turn's) are never talk, and
 *     `unplayedOnly` is refused on `main`.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { asc, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { JSON_INSTRUCTION } from "$lib/server/connections/structuredOutput"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 })

let db: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "lair-sanctum-steers-test-secret" }
})
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))
vi.mock("$lib/server/embedding/vectorizationQueue", () => ({
	ensureSessionMessageEmbedded: async () => {},
	autoEnqueueSession: async () => {}
}))
vi.mock("$lib/server/sockets/utils/broadcastHelpers", () => ({
	broadcastToSessionUsers: async () => {},
	emitToUserRedacted: async () => {}
}))
vi.mock("$lib/server/utils/getUserConfigurations", () => ({
	getUserConfigurations: async () => ({
		contextConfig: { id: 1, template: "{{instructions}}" },
		promptConfig: { id: 1, systemPrompt: "Be brief." },
		narratorPromptConfig: null
	})
}))

const BEAT = "BEAT-MARK Brannoc eyes the door."
/** What the planner answers: one delver speaks. The keeper reads the same document. */
const PLAN = {
	beats: [BEAT],
	speakers: [{ name: "Brannoc", intent: "check the door" }],
	unknownExit: "",
	knockQuestion: "",
	worldHints: { location: "The Old Well" },
	values: [],
	inventory: []
}
/** A plan that names nobody: a beats row, and no delver's line after it. */
const QUIET_PLAN = { ...PLAN, speakers: [] }
let plan: Record<string, unknown> = PLAN

const CASTELLAN_SAYS = "CASTELLAN-SAYS A flooded stair would suit them."
const PAD = "PAD-MARK The Sunken Vault waits two rooms north."
const EDITED = "EDITED-MARK The vault is dry after all."
const NARRATION = "NARRATION-MARK The water rises."
const VOICE = "Brannoc checks the door."

type Kind = "planner" | "keeper" | "scratchpad" | "sanctum" | "narration" | "voice"
/** Every call the fake model took, by whose step it was. */
const calls: Array<{ kind: Kind; prompt: string }> = []
const promptsOf = (kind: Kind) => calls.filter((c) => c.kind === kind).map((c) => c.prompt)

class FakeAdapter {
	injected: any
	responseFormat: any
	abort() {}
	async preflight() {}
	withStops() {
		return this
	}
	withStreaming() {
		return this
	}
	withCompiledPrompt(p: any) {
		this.injected = p
		return this
	}
	async generateText() {
		const prompt = JSON.stringify(this.injected ?? "")
		const json =
			this.responseFormat === "json" ||
			prompt.includes(JSON.stringify(JSON_INSTRUCTION).slice(1, 40))
		const kind: Kind = json
			? prompt.includes("you keep a scratchpad")
				? "scratchpad"
				: prompt.includes("You plan the PARTY only")
					? "planner"
					: "keeper"
			: prompt.includes("This conversation is the Sanctum")
				? "sanctum"
				: prompt.includes("asked you to narrate what happens next")
					? "narration"
					: "voice"
		calls.push({ kind, prompt })
		return {
			compiledPrompt: this.injected ?? { prompt: "p", messages: undefined, meta: {} },
			isAborted: false,
			completionResult: async (onContent: (c: string) => void) => {
				if (kind === "scratchpad") return onContent(JSON.stringify({ scratchpad: PAD }))
				if (json) return onContent(JSON.stringify(plan))
				if (kind === "sanctum") return onContent(CASTELLAN_SAYS)
				if (kind === "narration") return onContent(NARRATION)
				onContent(VOICE)
			}
		}
	}
}
vi.mock("$lib/server/utils/getConnectionAdapter", () => ({
	getConnectionAdapter: async () => ({ Adapter: FakeAdapter })
}))

let userId: number
const party: Record<string, number> = {}
const fakeSocket = (uid: number) => ({ user: { id: uid, isAdmin: false }, io: quietIo() }) as any
const emit = () => {}

function quietIo() {
	return {
		sockets: {
			adapter: { rooms: { get: () => undefined } },
			sockets: { get: () => undefined, values: () => [].values() }
		},
		to: () => ({ emit: () => {} })
	}
}

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-lair-steers-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(db)

	const { createTestUser } = await import("$lib/server/utils/testDb")
	userId = (await createTestUser(db, "lair-steers")).id
	for (const name of ["Brannoc", "Vell"]) {
		const [c] = await db
			.insert(schema.characters)
			.values({ userId, name, description: "A delver." } as any)
			.returning()
		party[name] = c!.id
	}

	const [textConn] = await db
		.insert(schema.connections)
		.values({ name: "Text", type: "koboldcpp", baseUrl: "http://text" })
		.returning()
	const { ensureConnectionModel } = await import("$lib/server/connections/models")
	const modelId = (await ensureConnectionModel(db, textConn!.id, "lair-7b"))!.id
	const [sampling] = await db
		.insert(schema.samplingConfigs)
		.values({
			name: "Steers test sampling",
			isImmutable: false,
			values: { contextTokens: 8192, responseTokens: 200, temperature: 0.2 },
			enabled: ["contextTokens", "responseTokens", "temperature"]
		} as any)
		.returning()
	const { setCapabilityDefault } = await import("$lib/server/connections/capabilityDefaults")
	await setCapabilityDefault(db, "text->text", {
		connectionId: textConn!.id,
		connectionModelId: modelId,
		samplingConfigId: sampling!.id
	})
}, 180_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

async function settle() {
	await (await import("$lib/server/pipelines/runtime/sessionEvents")).settleSessionEvents()
}

/** A Lair session made by the real create road: the greeting on the Sanctum, the Castellan seated. */
async function createLairSession(name: string, steers?: boolean) {
	const { LAIR_GENRE_ID } = await import("@serene-pub/core-catalog")
	const { sessionsCreateHandler } = await import("$lib/server/sockets/sessions")
	const [lorebook] = await db
		.insert(schema.lorebooks)
		.values({ userId, name: `${name} dungeon` } as any)
		.returning()
	const res: any = await sessionsCreateHandler.handler(
		fakeSocket(userId),
		{
			session: { name, genreId: LAIR_GENRE_ID, lorebookId: lorebook!.id },
			characterIds: [party.Brannoc, party.Vell],
			personaIds: [],
			characterPositions: { [party.Brannoc!]: 0, [party.Vell!]: 1 },
			tags: []
		} as any,
		emit
	)
	expect(res?.error, res?.error).toBeUndefined()
	await settle()
	const id = res.session.id as number
	if (steers !== undefined) {
		const [row] = await db
			.select({ genreFields: schema.sessions.genreFields })
			.from(schema.sessions)
			.where(eq(schema.sessions.id, id))
		await db
			.update(schema.sessions)
			.set({ genreFields: { ...((row?.genreFields as object) ?? {}), sanctumSteers: steers } })
			.where(eq(schema.sessions.id, id))
	}
	return id
}

/** A person's line, then the turn order recomputed (an edit cause: no auto-advance). */
async function personSays(sessionId: number, content: string, channel = "main") {
	const [row] = await db
		.insert(schema.sessionMessages)
		.values({ sessionId, userId, role: "user", content, channel } as any)
		.returning()
	const { emitSessionEvent } = await import("$lib/server/pipelines/runtime/sessionEvents")
	const { sessionEvents } = await import("@serene-pub/sdk")
	await emitSessionEvent(db as any, {
		sessionId,
		userId,
		event: sessionEvents.messageDeleted,
		payload: { sessionId, cause: { kind: "edit", userId } },
		wait: true
	})
	return row!
}

/** Continue (no entry), or Narrate (`{ ref: null }`), pressed on a composer's channel. */
async function press(sessionId: number, channel: string, entry?: Record<string, unknown>) {
	const { sessionsFireTurnHandler } = await import("./sessions")
	const res: any = await sessionsFireTurnHandler.handler(
		fakeSocket(userId),
		{ sessionId, channel, ...(entry ? { entry } : {}) } as any,
		emit
	)
	await settle()
	expect(res?.error, res?.error).toBeUndefined()
	return res
}
const NARRATE = { ref: null, via: "pick" }

const rowsOf = (sessionId: number) =>
	db
		.select()
		.from(schema.sessionMessages)
		.where(eq(schema.sessionMessages.sessionId, sessionId))
		.orderBy(asc(schema.sessionMessages.id))

async function annexOf(sessionId: number) {
	const [row] = await db
		.select({ annex: schema.sessions.annex })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
	return ((row?.annex ?? {}) as Record<string, Record<string, unknown>>).core ?? {}
}

/** The owner's own press of the scratchpad's ready-made action — what the Session data panel sends. */
async function editScratchpad(sessionId: number, value: string) {
	const { sessionsFireActionHandler } = await import("./sessions")
	const res: any = await sessionsFireActionHandler.handler(
		fakeSocket(userId),
		{
			sessionId,
			action: "core:annex#castellan-scratchpad",
			payload: { value },
			runId: crypto.randomUUID()
		} as any,
		emit
	)
	await settle()
	return res
}

/** Nothing of the Sanctum's reached this prompt. */
function holdsNoTableTalk(prompt: string, ...marks: string[]) {
	for (const m of [CASTELLAN_SAYS, PAD, EDITED, "This conversation is the Sanctum", ...marks])
		expect(prompt).not.toContain(m)
}

describe("Sanctum talk steers the story — on, the default (R13)", () => {
	it("the planner reads the talk since the story's last line and the scratchpad; never older talk, the greeting or a beats row; the party hear none of it", async () => {
		plan = PLAN
		const sessionId = await createLairSession("steers-on")
		const OLD = "OLD-TALK Let's flood the stair."
		const NEW = "NEW-TALK Actually, make the vault dry."

		// Turn 1 plays the old talk.
		await personSays(sessionId, OLD, "sanctum")
		await personSays(sessionId, "The torches gutter.")
		calls.length = 0
		await press(sessionId, "main")
		expect(promptsOf("planner")[0]).toContain(OLD)

		// Talk after it, answered in the Sanctum: the Castellan's reply, then
		// its scratchpad rewritten (one Background JSON call).
		await personSays(sessionId, NEW, "sanctum")
		calls.length = 0
		await press(sessionId, "sanctum")
		expect(calls.map((c) => c.kind)).toEqual(["sanctum", "scratchpad"])
		expect(promptsOf("scratchpad")[0]).toContain(NEW)
		expect(promptsOf("scratchpad")[0]).toContain(CASTELLAN_SAYS)
		expect((await annexOf(sessionId))["castellan-scratchpad"]).toBe(PAD)

		// Turn 2.
		await personSays(sessionId, "Something wakes below.")
		calls.length = 0
		await press(sessionId, "main")
		const [planner] = promptsOf("planner")
		expect(planner).toBeDefined()
		expect(planner).toContain("since the last turn — plans, not facts")
		expect(planner).toContain(NEW)
		expect(planner).toContain(CASTELLAN_SAYS)
		expect(planner).toContain(PAD)
		expect(planner).not.toContain(OLD)
		expect(planner).not.toContain("Welcome, Dungeon Master")
		expect(planner).not.toContain(BEAT)

		// The party and the books never hear the table.
		expect(promptsOf("voice").length).toBeGreaterThan(0)
		for (const p of [...promptsOf("voice"), ...promptsOf("keeper")])
			holdsNoTableTalk(p, NEW, OLD)
	})

	it("Narrate pressed on main reads the talk while the switch is on", async () => {
		plan = PLAN
		const sessionId = await createLairSession("steers-narrate")
		await personSays(sessionId, "The torches gutter.")
		const TALK = "TALK-NARRATE The ceiling should give way."
		await personSays(sessionId, TALK, "sanctum")
		calls.length = 0
		await press(sessionId, "main", NARRATE)
		const [narration] = promptsOf("narration")
		expect(narration).toContain(TALK)
		for (const p of promptsOf("keeper")) holdsNoTableTalk(p, TALK)
	})

	it("reads only the newest twelve rows of talk", async () => {
		plan = PLAN
		const sessionId = await createLairSession("steers-cap")
		await personSays(sessionId, "The torches gutter.")
		const lines = Array.from({ length: 14 }, (_, i) => `CAP-${String(i + 1).padStart(2, "0")}`)
		for (const l of lines) await personSays(sessionId, l, "sanctum")
		calls.length = 0
		await press(sessionId, "main")
		const [planner] = promptsOf("planner")
		for (const l of lines.slice(2)) expect(planner).toContain(l)
		for (const l of lines.slice(0, 2)) expect(planner).not.toContain(l)
	})
})

describe("Sanctum talk steers the story — off (R13)", () => {
	it("the planner reads neither talk nor scratchpad; Narrate on main reads no talk; Narrate in the Sanctum does", async () => {
		plan = PLAN
		const sessionId = await createLairSession("steers-off", false)
		const TALK = "TALK-OFF Let's put a mimic in the vault."
		await personSays(sessionId, TALK, "sanctum")
		expect((await editScratchpad(sessionId, PAD))?.error).toBeUndefined()
		await personSays(sessionId, "The torches gutter.")

		calls.length = 0
		await press(sessionId, "main")
		const [planner] = promptsOf("planner")
		expect(planner).toBeDefined()
		holdsNoTableTalk(planner!, TALK)

		// Narrate from the story's composer: no talk.
		const TALK2 = "TALK-OFF-2 Now spring the mimic."
		await personSays(sessionId, TALK2, "sanctum")
		calls.length = 0
		await press(sessionId, "main", NARRATE)
		holdsNoTableTalk(promptsOf("narration")[0]!, TALK, TALK2)

		// Narrate pressed in the Sanctum: the talk since the story's last
		// line (the narration just written) is played.
		const TALK3 = "TALK-OFF-3 The mimic lunges."
		await personSays(sessionId, TALK3, "sanctum")
		calls.length = 0
		await press(sessionId, "sanctum", NARRATE)
		const [narration] = promptsOf("narration")
		expect(narration).toContain(TALK3)
		expect(narration).not.toContain(TALK2)
		// The narration still lands on main.
		const last = (await rowsOf(sessionId)).at(-1)!
		expect([last.channel, last.content]).toEqual(["main", NARRATION])
	})
})

describe("the Castellan's scratchpad (R13)", () => {
	it("is hidden from every person's view, edited by the owner through its action, and read by the planner and the Sanctum talk — never the party", async () => {
		plan = PLAN
		const sessionId = await createLairSession("scratchpad")
		expect((await editScratchpad(sessionId, EDITED))?.error).toBeUndefined()
		expect((await annexOf(sessionId))["castellan-scratchpad"]).toBe(EDITED)

		// Hidden: the owner's own annex view does not carry it.
		const { annexViewFor } = await import("$lib/server/sessions/annexViews")
		const view = await annexViewFor(db as any, sessionId, userId)
		expect(view?.core?.["castellan-scratchpad"]).toBeUndefined()
		// … but the Session data panel lists it, settable by the owner.
		const { inspectAnnex } = await import("$lib/server/sessions/annexInspect")
		const inspected = await inspectAnnex(db as any, sessionId, { id: userId })
		const field = inspected.ok
			? inspected.result.groups
					.find((g) => g.owner === "core")
					?.fields.find((f) => f.key === "castellan-scratchpad")
			: undefined
		expect(field).toMatchObject({
			value: EDITED,
			see: ["envoy:castellan"],
			act: ["owner"],
			genre: "core:genre/lair"
		})

		// The Castellan reads its notes when it talks …
		await personSays(sessionId, "What have we planned?", "sanctum")
		calls.length = 0
		await press(sessionId, "sanctum")
		expect(promptsOf("sanctum")[0]).toContain(EDITED)
		// … and its rewrite replaced them.
		expect((await annexOf(sessionId))["castellan-scratchpad"]).toBe(PAD)

		// The planner reads the notes; the party never do.
		await personSays(sessionId, "The torches gutter.")
		calls.length = 0
		await press(sessionId, "main")
		expect(promptsOf("planner")[0]).toContain(PAD)
		for (const p of [...promptsOf("voice"), ...promptsOf("keeper")]) holdsNoTableTalk(p)
	})
})

describe("the unplayed talk, alone (R13 bound)", () => {
	it("a person's Sanctum line and the reply fired there are talk; the greeting and a beats row are not", async () => {
		const { unplayedTalkRows, storyBoundOf } = await import("$lib/server/sessions/unplayedTalk")
		const sessionId = await createLairSession("bound")
		const greeting = (await rowsOf(sessionId))[0]!
		expect(greeting.channel).toBe("sanctum")

		// No story yet: nothing bounds, and the greeting (a create run's row) is not talk.
		expect(await storyBoundOf(db as any, sessionId)).toBeNull()
		const LINE = "BOUND-LINE Where does the stair lead?"
		const line = await personSays(sessionId, LINE, "sanctum")
		expect((await unplayedTalkRows(db as any, sessionId, "sanctum", 12)).map((r) => r.id)).toEqual([
			line.id
		])

		// The Castellan's reply fired on the Sanctum is talk.
		plan = PLAN
		await press(sessionId, "sanctum")
		const reply = (await rowsOf(sessionId)).at(-1)!
		expect(reply.content).toBe(CASTELLAN_SAYS)
		expect((await unplayedTalkRows(db as any, sessionId, "sanctum", 12)).map((r) => r.id)).toEqual([
			line.id,
			reply.id
		])

		// A turn whose plan names nobody writes a beats row and no line after
		// it: the bound does not move, yet the beats row is still not talk.
		plan = QUIET_PLAN
		await personSays(sessionId, "The torches gutter.")
		await press(sessionId, "main")
		const beats = (await rowsOf(sessionId)).filter((r) => r.channel === "sanctum").at(-1)!
		expect(beats.content).toContain(BEAT)
		expect(await storyBoundOf(db as any, sessionId)).toBeNull()
		expect((await unplayedTalkRows(db as any, sessionId, "sanctum", 12)).map((r) => r.id)).toEqual([
			line.id,
			reply.id
		])
		// The cap keeps the newest.
		expect((await unplayedTalkRows(db as any, sessionId, "sanctum", 1)).map((r) => r.id)).toEqual([
			reply.id
		])
		plan = PLAN
	})

	it("unplayedOnly is refused on main", async () => {
		const { coreBindings, UNPLAYED_ON_MAIN_REFUSAL } = await import(
			"$lib/server/pipelines/runtime/bindings"
		)
		const history = coreBindings()["core:query/session-history@1"] as any
		for (const channel of ["main", "*"]) {
			const out = await history(
				{ scope: { sessionId: 1 }, params: { channel, unplayedOnly: true } },
				{
					read: async () => {
						throw new Error("never read")
					}
				}
			)
			expect(out.kind).toBe("halt")
			expect(out.reason ?? out.message ?? JSON.stringify(out)).toContain(
				UNPLAYED_ON_MAIN_REFUSAL
			)
		}
	})
})
