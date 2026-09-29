/**
 * **File as a room** (lair re-plan R11, 2026-09-28) — over the real press,
 * the real listing and the real review gate, with a faked model.
 *
 * A room the master narrated on `main`, planned in the Sanctum, or the
 * Castellan narrated reaches the lorebook from that message's ⋮: the press
 * collects the room's name (R3), the Castellan drafts a location entry from
 * the row, and it lands only through `create-lore-entry`'s review, where the
 * name stays editable. Offered on the person's rows and the Castellan's
 * (`item.characterLine equals false`), refused on a delver's with the
 * reason, and never files a room the book already has (R7's name rule).
 */

import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, asc, eq } from "drizzle-orm"
import type { TestDb } from "$lib/server/utils/testDb"
import type { FakeTextAdapter } from "$lib/server/connectionAdapters/fakeTextAdapter"
import { JSON_INSTRUCTION } from "$lib/server/connections/structuredOutput"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "lair-file-room-test-secret" }
})

const PLAN = {
	beats: ["The torch gutters.", "Something scrapes behind the door."],
	speakers: [{ name: "Brannoc", intent: "check the door" }],
	unknownExit: "",
	knockQuestion: "",
	worldHints: { location: "The Old Well" },
	values: [],
	inventory: []
}
/** What the planner answers this test with. */
let document: Record<string, unknown> = PLAN
/** Every prose call, in order — the narrator's is the first of a turn. */
let proseCalls = 0
/** Every prompt a JSON step (the planner, the keeper) was sent. */
const jsonPrompts: string[] = []
/** Every prompt a prose step (the narrator, a voice, a draft) was sent. */
const prosePrompts: string[] = []
const PROSE = ["The torch gutters. ", "Something scrapes behind the door."]
/** What every prose call streams — `PROSE` unless a test says otherwise. */
let prose: string[] = PROSE

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
		const json =
			this.responseFormat === "json" ||
			JSON.stringify(this.injected ?? "").includes(
				JSON.stringify(JSON_INSTRUCTION).slice(1, 40)
			)
		const call = json ? 0 : ++proseCalls
		return {
			compiledPrompt: this.injected,
			isAborted: false,
			completionResult: async (
				onContent: (c: string) => void,
				onThinking?: (c: string) => void
			) => {
				if (json) {
					jsonPrompts.push(JSON.stringify(this.injected ?? ""))
					// The planner reasons too — and that must NOT reach the row.
					onThinking?.("The planner weighs the beats.")
					onContent(JSON.stringify(document))
					return
				}
				prosePrompts.push(JSON.stringify(this.injected ?? ""))
				onThinking?.(`Reasoning of prose call ${call}.`)
				for (const chunk of prose) onContent(chunk)
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
		path.join(os.tmpdir(), "serene-pub-vitest-lair-file-room-")
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

/** Every room the dungeon holds before a test: two, the party in the first. */
async function lair() {
	const schema = await import("$lib/server/db/schema")
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const tag = `file-${++n}`
	const owner = await createTestUser(testDb, `${tag}-owner`)
	const guest = await createTestUser(testDb, `${tag}-guest`)
	const [lorebook] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: owner.id, name: `The lair ${tag}` })
		.returning()
	await testDb.insert(schema.lorebookEntries).values([
		{
			lorebookId: lorebook!.id,
			typeId: "core:entry/location",
			typeVersion: 1,
			position: 1,
			title: "The Old Well",
			content: "A dry well shaft.\n\nExits: down → The Stair"
		},
		{
			lorebookId: lorebook!.id,
			typeId: "core:entry/location",
			typeVersion: 1,
			position: 2,
			title: "The Stair",
			content: "Steps cut into rock.\n\nExits: up → The Old Well"
		}
	])
	const [row] = await testDb
		.insert(schema.sessions)
		.values({
			userId: owner.id,
			isGroup: true,
			name: `Session ${tag}`,
			genreId: "core:genre/lair",
			lorebookId: lorebook!.id
		})
		.returning()
	await testDb.insert(schema.sessionGuests).values({ sessionId: row!.id, userId: guest.id })
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
	return { owner, guest, brannoc: brannoc!, session: row!, lorebookId: lorebook!.id }
}
type Lair = Awaited<ReturnType<typeof lair>>

/** A row on the session, as the roads that write one store it. */
async function line(
	w: Lair,
	row: { content: string; channel?: string; by: "person" | "castellan" | "delver"; hidden?: boolean }
) {
	const { insertLegacy } = await import("$lib/server/messages/store")
	const written = await insertLegacy(testDb as unknown as Db, {
		sessionId: w.session.id,
		content: row.content,
		channel: row.channel ?? "main",
		isHidden: row.hidden === true,
		...(row.by === "person"
			? { role: "user", userId: w.owner.id }
			: row.by === "castellan"
				? { role: "assistant", metadata: { speaker: "envoy:castellan" } }
				: { role: "assistant", characterId: w.brannoc.id, metadata: { speaker: `character:${w.brannoc.id}` } })
	} as any)
	return written.id
}

const fakeSocket = (userId: number) =>
	({ user: { id: userId, isAdmin: false }, io: { to: () => ({ emit: () => {} }) } }) as any

const FILE = "core:spec/lair-file-room#file"

/** A press of ⋮ File as a room on one row, with the name the collect modal took. */
async function file(w: Lair, messageId: number, text?: string, userId = w.owner.id) {
	const { sessionsFireActionHandler } = await import("./sessions")
	const ack = await within(
		"File as a room",
		sessionsFireActionHandler.handler(
			fakeSocket(userId),
			{
				sessionId: w.session.id,
				action: FILE,
				messageId,
				...(text !== undefined ? { text } : {})
			} as any,
			() => {}
		)
	)
	return ack as any
}

async function rooms(lorebookId: number) {
	const schema = await import("$lib/server/db/schema")
	return testDb
		.select()
		.from(schema.lorebookEntries)
		.where(eq(schema.lorebookEntries.lorebookId, lorebookId))
		.orderBy(asc(schema.lorebookEntries.id))
}

async function rowsOf(sessionId: number) {
	const schema = await import("$lib/server/db/schema")
	return testDb
		.select()
		.from(schema.sessionMessages)
		.where(eq(schema.sessionMessages.sessionId, sessionId))
		.orderBy(asc(schema.sessionMessages.id))
}

async function runsOf(sessionId: number) {
	await (
		await import("$lib/server/pipelines/runtime/sessionEvents")
	).settleSessionEvents()
	const schema = await import("$lib/server/db/schema")
	return testDb
		.select({ specSlug: schema.pipelineRuns.specSlug, outcome: schema.pipelineRuns.outcome })
		.from(schema.pipelineRuns)
		.where(eq(schema.pipelineRuns.sessionId, sessionId))
}

const reset = () => {
	proseCalls = 0
	jsonPrompts.length = 0
	prosePrompts.length = 0
	prose = DRAFT
}

/** What the Castellan drafts, in the room's layout. */
const DRAFT = [
	"A vaulted hall, knee-deep in black water.\n\n",
	"Exits: north → The Stair, east → The Sluice\nContents: a drowned lantern\nHazards: the floor drops away\nOccupants: nobody"
]
/** A room described with two ways out, the way the master or the Castellan writes one. */
const DESCRIBED =
	"The stair ends in the Drowned Hall, a vaulted room knee-deep in black water. A doorway north climbs back to the Stair; a grate in the east wall drains into the Sluice."

/** Parked at the gate: the one review this press is waiting on. */
async function parkedReview(ownerId: number) {
	const { pendingReviewsFor } = await import("$lib/server/pipelines/runtime/reviewGate")
	const reviews = pendingReviewsFor(ownerId).filter((r) => r.specId === "core:spec/lair-file-room")
	expect(reviews).toHaveLength(1)
	return reviews[0]!
}

/** Approve (or, with values, edit and approve) the parked draft, and wait for the entry it lands. */
async function approve(w: Lair, id: string, values?: Record<string, unknown>) {
	const { resolveReview } = await import("$lib/server/pipelines/runtime/reviewGate")
	const before = (await rooms(w.lorebookId)).length
	resolveReview(id, w.owner.id, values ? "edit" : "approve", values)
	await vi.waitFor(
		async () => expect((await rooms(w.lorebookId)).length).toBe(before + 1),
		{ timeout: 30_000, interval: 100 }
	)
}

describe("R11 · File as a room is offered on the person's rows and the Castellan's", () => {
	test("listed on a message's ⋮ for the owner, collecting the room's name, with the row half left to judge per row", async () => {
		const w = await lair()
		const { listSessionActions } = await import("$lib/server/pipelines/entities/sessionActions")
		const venues = await listSessionActions(testDb as any, w.session.id, { userId: w.owner.id })
		const listed = [...venues.message.primary, ...venues.message.overflow].find(
			(a) => `${a.specSlug}#${a.key}` === FILE
		)
		expect(listed).toBeDefined()
		expect(listed!.canAct).toBe(true)
		expect(listed!.collects).toEqual({
			text: { need: "required", label: "Room name", placeholder: "The Sunken Vault" }
		})
		expect((listed!.itemPredicates ?? []).map((p: any) => p.on)).toEqual([
			"item.characterLine",
			"item.hidden",
			"item.generating"
		])
		// Never in the composer: it acts on a row.
		expect(
			[...venues.composer.primary, ...venues.composer.overflow].some((a) => `${a.specSlug}#${a.key}` === FILE)
		).toBe(false)
	})

	test("the door reads who spoke the row: the person's and the Castellan's are open, a delver's is not", async () => {
		const w = await lair()
		const { itemValuesFor } = await import("$lib/server/pipelines/entities/publishedValues")
		const actor = { userId: w.owner.id }
		const person = await line(w, { content: "I open the door.", by: "person" })
		const castellan = await line(w, { content: "The Castellan speaks.", by: "castellan", channel: "sanctum" })
		const delver = await line(w, { content: "Brannoc speaks.", by: "delver" })
		expect(await itemValuesFor(testDb as any, w.session.id, person, actor)).toMatchObject({
			speaker: null,
			characterLine: false
		})
		expect(await itemValuesFor(testDb as any, w.session.id, castellan, actor)).toMatchObject({
			speaker: "envoy:castellan",
			characterLine: false,
			channel: "sanctum"
		})
		expect(await itemValuesFor(testDb as any, w.session.id, delver, actor)).toMatchObject({
			speaker: `character:${w.brannoc.id}`,
			characterLine: true
		})
	})

	test("a Castellan narration describing two exits → a review holding the name and the draft → approve → a location entry", async () => {
		const w = await lair()
		reset()
		const row = await line(w, { content: DESCRIBED, by: "castellan" })
		const ack = await file(w, row, "The Drowned Hall")
		expect(ack?.error).toBeUndefined()
		expect(ack?.parked).toBe(true)
		// One model call: the Castellan's draft, from that row and under that name.
		expect(proseCalls).toBe(1)
		expect(prosePrompts[0]).toContain("you file a room into the dungeon's lorebook")
		expect(prosePrompts[0]).toContain("The room is The Drowned Hall.")
		expect(prosePrompts[0]).toContain("a grate in the east wall drains into the Sluice")
		// The rooms the dungeon has are named to it, for its exits.
		expect(prosePrompts[0]).toContain("The Old Well")
		expect(prosePrompts[0]).not.toContain("{{")
		const review = await parkedReview(w.owner.id)
		expect(review.nodeKey).toBe("room.new.save")
		expect(review.values.name).toBe("The Drowned Hall")
		expect(review.values.content).toBe(DRAFT.join(""))
		// Nothing lands before the gate.
		expect((await rooms(w.lorebookId)).map((r) => r.title)).toEqual(["The Old Well", "The Stair"])
		await approve(w, review.id)
		const filed = (await rooms(w.lorebookId)).find((r) => r.title === "The Drowned Hall")!
		expect(filed.typeId).toBe("core:entry/location")
		expect(filed.content).toBe(DRAFT.join(""))
		expect(filed.content).toContain("Exits: north → The Stair, east → The Sluice")
		// No message was written: the entry is the whole result.
		expect((await rowsOf(w.session.id)).map((r) => r.id)).toEqual([row])
	})

	test("the same from the person's own narration on main — still reviewed: the row may say more than the room", async () => {
		const w = await lair()
		reset()
		const row = await line(w, { content: DESCRIBED, by: "person" })
		const ack = await file(w, row, "The Drowned Hall")
		expect(ack?.error).toBeUndefined()
		expect(ack?.parked).toBe(true)
		const review = await parkedReview(w.owner.id)
		expect(review.values.name).toBe("The Drowned Hall")
		await approve(w, review.id)
		expect((await rooms(w.lorebookId)).some((r) => r.title === "The Drowned Hall")).toBe(true)
	})

	test("from the Sanctum: a room the person planned there, and one the Castellan planned", async () => {
		const w = await lair()
		for (const by of ["person", "castellan"] as const) {
			reset()
			const name = by === "person" ? "The Sluice" : "The Cistern"
			const row = await line(w, {
				content: `Next, ${name}: a narrow brick channel where the water runs fast and cold, and a ledge runs along one side.`,
				by,
				channel: "sanctum"
			})
			const ack = await file(w, row, name)
			expect(ack?.error, by).toBeUndefined()
			expect(ack?.parked, by).toBe(true)
			expect(prosePrompts[0]).toContain("a narrow brick channel")
			const review = await parkedReview(w.owner.id)
			expect(review.values.name).toBe(name)
			await approve(w, review.id)
		}
		expect((await rooms(w.lorebookId)).map((r) => r.title)).toEqual([
			"The Old Well",
			"The Stair",
			"The Sluice",
			"The Cistern"
		])
	})
})

describe("R11 · refused where it is not the dungeon's plan", () => {
	test("a delver's row: refused with the reason, and nothing runs", async () => {
		const w = await lair()
		reset()
		const row = await line(w, { content: DESCRIBED, by: "delver" })
		const ack = await file(w, row, "The Drowned Hall")
		expect(ack?.error).toMatch(/a delver's line is theirs, not the dungeon's plan/)
		expect(proseCalls).toBe(0)
		expect((await runsOf(w.session.id)).filter((r) => r.specSlug === "core:spec/lair-file-room")).toEqual([])
		expect((await rooms(w.lorebookId)).map((r) => r.title)).toEqual(["The Old Well", "The Stair"])
	})

	test("a guest's press, a hidden row, and no name are refused too", async () => {
		const w = await lair()
		reset()
		const row = await line(w, { content: DESCRIBED, by: "person" })
		expect((await file(w, row, "The Drowned Hall", w.guest.id))?.error).toBeTruthy()
		const hidden = await line(w, { content: DESCRIBED, by: "castellan", hidden: true })
		expect((await file(w, hidden, "The Drowned Hall"))?.error).toMatch(/unhide it first/)
		expect((await file(w, row, "   "))?.error).toMatch(/needs text/)
		expect(proseCalls).toBe(0)
		expect((await rooms(w.lorebookId)).map((r) => r.title)).toEqual(["The Old Well", "The Stair"])
	})
})

describe("R11 · the name", () => {
	test("named as typed (trimmed), and the name is editable at the gate", async () => {
		const w = await lair()
		reset()
		const row = await line(w, { content: DESCRIBED, by: "person" })
		await file(w, row, "  The Drowned Hall  ")
		const review = await parkedReview(w.owner.id)
		expect(review.values.name).toBe("The Drowned Hall")
		await approve(w, review.id, { name: "The Flooded Hall", content: review.values.content })
		const titles = (await rooms(w.lorebookId)).map((r) => r.title)
		expect(titles).toContain("The Flooded Hall")
		expect(titles).not.toContain("The Drowned Hall")
	})

	test("a rejected draft files nothing", async () => {
		const w = await lair()
		reset()
		const row = await line(w, { content: DESCRIBED, by: "castellan" })
		await file(w, row, "The Drowned Hall")
		const review = await parkedReview(w.owner.id)
		const { resolveReview } = await import("$lib/server/pipelines/runtime/reviewGate")
		resolveReview(review.id, w.owner.id, "reject")
		await vi.waitFor(
			async () => {
				const runs = await runsOf(w.session.id)
				expect(runs.find((r) => r.specSlug === "core:spec/lair-file-room")?.outcome).toBe("halt")
			},
			{ timeout: 30_000, interval: 100 }
		)
		expect((await rooms(w.lorebookId)).map((r) => r.title)).toEqual(["The Old Well", "The Stair"])
	})

	test("a room the book already has — by R7's name rule — is not filed twice, and the Castellan says so on the Sanctum", async () => {
		const w = await lair()
		reset()
		const row = await line(w, {
			content: "The old well is dry, and its rope has rotted through; a cold draught climbs from below.",
			by: "person"
		})
		// Case and a leading article are the same name (`sameName`).
		const ack = await file(w, row, "the old well")
		expect(ack?.error).toBeUndefined()
		expect(ack?.parked).toBeUndefined()
		expect(proseCalls).toBe(0)
		const { pendingReviewsFor } = await import("$lib/server/pipelines/runtime/reviewGate")
		expect(pendingReviewsFor(w.owner.id).filter((r) => r.specId === "core:spec/lair-file-room")).toEqual([])
		expect((await rooms(w.lorebookId)).map((r) => r.title)).toEqual(["The Old Well", "The Stair"])
		const note = (await rowsOf(w.session.id)).find((r) => r.id !== row)!
		expect(note.channel).toBe("sanctum")
		expect((note.metadata as any)?.speaker).toBe("envoy:castellan")
		expect(note.content).toBe(
			"the old well is already in the lorebook, so nothing new was filed. Edit that entry to change it."
		)
	})
})
