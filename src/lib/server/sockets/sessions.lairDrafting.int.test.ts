/**
 * **The Lair's room drafts and its delvers' view of the dungeon** (plan A28,
 * 2026-09-30) — over the real presses, the real reply road and the real
 * review gate, with a faked model.
 *
 *  - **Drafts see the rooms.** *Build room* and *Answer the door* (nothing
 *    typed) ask the Castellan to "name only rooms this dungeon already has",
 *    and neither was shown the rooms: *File as a room* was the one draft that
 *    listed them. Every draft now reads the rooms listing, as
 *    `{{knownLocations}}`.
 *  - **Drafts never read private lore.** A room entry is public lore, and
 *    *Answer the door* and *File as a room* read the book through
 *    `lorebook-triggers@1` with no speaker — the omniscient narrator's view,
 *    which reads a background member's private entries and every unbound
 *    one — so a secret keyed on the conversation could be written into a
 *    room every delver reads. They read the book's public half: the
 *    world-lore and history lanes, and no character lore at all — not even
 *    a persona's, which every voice of the session may read. *Build room*
 *    reads world lore alone; it is pinned here too.
 *  - **Build room names the room.** The collected name never reached the
 *    draft ("They have given you its name", and they had not); it now rides
 *    `{{turnDirection}}`, as *File as a room*'s does.
 *  - **A delver's voice sees the stats of the room it stands in** — never
 *    what lies in a room the party have not reached. The planner, who is
 *    nobody's voice, still reads every place the session sees.
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
	return { db, getCryptoSecretKey: () => "lair-drafting-test-secret" }
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
const KNOCK = {
	...PLAN,
	speakers: [],
	unknownExit: "The Drowned Hall",
	knockQuestion: "The stair goes down to the Drowned Hall. Is there one?"
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
				onReasoning?: (c: string) => void
			) => {
				if (json) {
					jsonPrompts.push(JSON.stringify(this.injected ?? ""))
					// The planner reasons too — and that must NOT reach the row.
					onReasoning?.("The planner weighs the beats.")
					onContent(JSON.stringify(document))
					return
				}
				prosePrompts.push(JSON.stringify(this.injected ?? ""))
				onReasoning?.(`Reasoning of prose call ${call}.`)
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
		path.join(os.tmpdir(), "serene-pub-vitest-lair-drafting-")
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

/** Brannoc's secret, keyed on the owner's line ("I open the door."). */
const SECRET = "Brannoc stole the warden's key and hides it in his boot."
/**
 * The Warden's orders — lore bound to a member with no card (a background
 * member), which only the omniscient narrator reads: the view a read with no
 * speaker takes.
 */
const WARDEN_SECRET = "The Warden has orders to flood the lower halls at the first alarm."
/** Public lore keyed on the same word. */
const PUBLIC = "Every door in this dungeon was hung by the dwarves of the deep halls."
/** What lies in the room the party stand in, and in one they have not reached. */
const HERE_ITEM = "a guttering torch"
const AHEAD_ITEM = "a chest of the old king's gold"

/**
 * A Lair session: two rooms, the party in the first; one delver, Brannoc,
 * bound in the book with a private entry; a public entry on the same key;
 * something lying in each room; the owner's line waiting.
 */
async function lair() {
	const schema = await import("$lib/server/db/schema")
	const { insertLegacy } = await import("$lib/server/messages/store")
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const { characterLoreValues, worldLoreValues } = await import(
		"$lib/server/pipelines/testing/fixtures"
	)
	const tag = `drafting-${++n}`
	const owner = await createTestUser(testDb, `${tag}-owner`)
	const [lorebook] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: owner.id, name: `The lair ${tag}` })
		.returning()
	const [well, stair] = await testDb
		.insert(schema.lorebookEntries)
		.values([
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
		.returning()
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
	const [binding, warden] = await testDb
		.insert(schema.lorebookBindings)
		.values([
			{ lorebookId: lorebook!.id, binding: "{{char:1}}", name: "Brannoc", characterId: brannoc!.id },
			{ lorebookId: lorebook!.id, binding: "{{char:2}}", name: "The Warden" }
		])
		.returning()
	await testDb.insert(schema.lorebookEntries).values([
		...worldLoreValues([
			{ lorebookId: lorebook!.id, name: "The doors", keys: "door", content: PUBLIC }
		]),
		...characterLoreValues([
			{
				lorebookId: lorebook!.id,
				name: "Brannoc's secret",
				keys: "door",
				content: SECRET,
				lorebookBindingId: binding!.id
			},
			{
				lorebookId: lorebook!.id,
				name: "The Warden's orders",
				keys: "door",
				content: WARDEN_SECRET,
				lorebookBindingId: warden!.id
			}
		])
	])
	await insertLegacy(testDb as unknown as Db, {
		sessionId: row!.id,
		role: "user",
		content: "I open the door.",
		userId: owner.id
	})
	const { applyChange } = await import("$lib/server/state/write")
	await applyChange(
		testDb as unknown as Db,
		{ sessionId: row!.id, updatedBy: "user" } as never,
		{
			owner: { kind: "session", id: row!.id },
			slotId: "core:slot/location@1",
			value: "The Old Well"
		} as never
	)
	await testDb.insert(schema.attributeValues).values([
		{
			ownerKind: "session_location",
			ownerId: well!.id,
			sessionId: row!.id,
			slotId: "core:slot/inventory@1",
			value: { v: [HERE_ITEM] }
		},
		{
			ownerKind: "session_location",
			ownerId: stair!.id,
			sessionId: row!.id,
			slotId: "core:slot/inventory@1",
			value: { v: [AHEAD_ITEM] }
		}
	] as any)
	return { owner, session: row!, lorebookId: lorebook!.id }
}
type Lair = Awaited<ReturnType<typeof lair>>

const fakeSocket = (userId: number) =>
	({ user: { id: userId, isAdmin: false }, io: { to: () => ({ emit: () => {} }) } }) as any

async function reply(w: Lair, label: string) {
	const { sessionsFireTurnHandler } = await import("./sessions")
	const res = await within(
		label,
		sessionsFireTurnHandler.handler(fakeSocket(w.owner.id), { sessionId: w.session.id } as any, () => {})
	)
	expect((res as any)?.error).toBeUndefined()
	await (await import("$lib/server/pipelines/runtime/sessionEvents")).settleSessionEvents()
}

async function rowsOf(sessionId: number) {
	const schema = await import("$lib/server/db/schema")
	return testDb
		.select()
		.from(schema.sessionMessages)
		.where(eq(schema.sessionMessages.sessionId, sessionId))
		.orderBy(asc(schema.sessionMessages.id))
}

async function lastBlockTree(sessionId: number) {
	const { blockTreesOf } = await import("$lib/server/messages/blocks")
	for (const row of [...(await rowsOf(sessionId))].reverse()) {
		const trees = await blockTreesOf(testDb as any, row.id)
		if (trees.length) return { messageId: row.id, blocks: trees[0]! }
	}
	return null
}

const reset = (doc: Record<string, unknown>) => {
	document = doc
	proseCalls = 0
	jsonPrompts.length = 0
	prosePrompts.length = 0
}

/** A press of an action with its collected text, as the composer or a row's ⋮ sends it. */
async function press(w: Lair, action: string, extra: Record<string, unknown>) {
	const { sessionsFireActionHandler } = await import("./sessions")
	return (await within(
		action,
		sessionsFireActionHandler.handler(
			fakeSocket(w.owner.id),
			{ sessionId: w.session.id, action, ...extra } as any,
			() => {}
		)
	)) as any
}

/** Drop whatever review a press parked, so the next test starts clean. */
async function rejectParked(ownerId: number) {
	const { pendingReviewsFor, resolveReview } = await import(
		"$lib/server/pipelines/runtime/reviewGate"
	)
	for (const review of pendingReviewsFor(ownerId)) resolveReview(review.id, ownerId, "reject")
	await (await import("$lib/server/pipelines/runtime/sessionEvents")).settleSessionEvents()
}

/** The one line of a draft prompt that lists the dungeon's rooms. */
const ROOMS_LISTED = "The rooms this dungeon already has: The Old Well, The Stair."

describe("a room draft is shown every room the dungeon holds", () => {
	test("Build room: the draft lists the rooms, and names the room being built", async () => {
		const w = await lair()
		reset(PLAN)
		const ack = await press(w, "core:spec/lair-build-room#build-room", { text: "The Drowned Hall" })
		expect(ack?.error, JSON.stringify(ack)).toBeUndefined()
		expect(proseCalls).toBe(1)
		const draft = prosePrompts[0]!
		expect(draft).toContain("You draft a room for a dungeon")
		expect(draft).toContain(ROOMS_LISTED)
		expect(draft).toContain("The Drowned Hall")
		expect(draft).not.toContain("{{")
		await rejectParked(w.owner.id)
	})

	test("Answer the door, nothing typed: the Castellan's draft lists the rooms", async () => {
		const w = await lair()
		reset(KNOCK)
		await reply(w, "the knock")
		reset(PLAN)
		const knock = (await lastBlockTree(w.session.id))!
		const block = knock.blocks[0] as any
		const ack = await press(w, block.actions[0].action, {
			messageId: knock.messageId,
			blockId: block.id,
			payload: { choice: block.actions[0].choice }
		})
		expect(ack?.error, JSON.stringify(ack)).toBeUndefined()
		expect(proseCalls).toBe(1)
		const draft = prosePrompts[0]!
		expect(draft).toContain("has left the description to you")
		expect(draft).toContain(ROOMS_LISTED)
		expect(draft).not.toContain("{{")
		await rejectParked(w.owner.id)
	})
})

describe("a room draft never reads anybody's private lore", () => {
	test("Answer the door, nothing typed: the public entry comes in, no member's private lore does", async () => {
		const w = await lair()
		reset(KNOCK)
		await reply(w, "the knock")
		reset(PLAN)
		const knock = (await lastBlockTree(w.session.id))!
		const block = knock.blocks[0] as any
		await press(w, block.actions[0].action, {
			messageId: knock.messageId,
			blockId: block.id,
			payload: { choice: block.actions[0].choice }
		})
		const draft = prosePrompts[0]!
		expect(draft).toContain(PUBLIC)
		expect(draft).not.toContain(SECRET)
		expect(draft).not.toContain(WARDEN_SECRET)
		// Nor admitted unrendered: the prompt's own record of what it took in
		// (a cardless member's lore spent the window with no card to sit on).
		expect(draft).not.toContain("The Warden's orders")
		expect(draft).not.toContain("Brannoc's secret")
		await rejectParked(w.owner.id)
	})

	test("File as a room: the public entry comes in, no member's private lore does", async () => {
		const w = await lair()
		const { insertLegacy } = await import("$lib/server/messages/store")
		const described = await insertLegacy(testDb as unknown as Db, {
			sessionId: w.session.id,
			role: "user",
			userId: w.owner.id,
			content:
				"Past the door the stair ends in the Drowned Hall, a vaulted room knee-deep in black water."
		} as any)
		reset(PLAN)
		const ack = await press(w, "core:spec/lair-file-room#file", {
			messageId: described.id,
			text: "The Drowned Hall"
		})
		expect(ack?.error, JSON.stringify(ack)).toBeUndefined()
		expect(proseCalls).toBe(1)
		const draft = prosePrompts[0]!
		expect(draft).toContain(PUBLIC)
		expect(draft).not.toContain(SECRET)
		expect(draft).not.toContain(WARDEN_SECRET)
		// Nor admitted unrendered: the prompt's own record of what it took in
		// (a cardless member's lore spent the window with no card to sit on).
		expect(draft).not.toContain("The Warden's orders")
		expect(draft).not.toContain("Brannoc's secret")
		await rejectParked(w.owner.id)
	})

	test("Build room: the same — the public entry comes in, no member's private lore does", async () => {
		const w = await lair()
		reset(PLAN)
		await press(w, "core:spec/lair-build-room#build-room", { text: "The Drowned Hall" })
		const draft = prosePrompts[0]!
		expect(draft).toContain(PUBLIC)
		expect(draft).not.toContain(SECRET)
		expect(draft).not.toContain(WARDEN_SECRET)
		// Nor admitted unrendered: the prompt's own record of what it took in
		// (a cardless member's lore spent the window with no card to sit on).
		expect(draft).not.toContain("The Warden's orders")
		expect(draft).not.toContain("Brannoc's secret")
		await rejectParked(w.owner.id)
	})
})

/** A persona's secret — the private lore of a character somebody plays in this session. */
const PERSONA_SECRET = "Ysolde owes the Warden a life and means to pay it in this dungeon."

/**
 * Seats a persona someone plays in the session, bound in the book with a
 * private entry keyed on the same word as the rest. Its lore is visible to
 * every voice of the session (a persona's own knowledge travels with the
 * person playing them), which is exactly why a room draft — public lore —
 * must not read character lore at all.
 */
async function withPersona(w: Lair) {
	const schema = await import("$lib/server/db/schema")
	const { characterLoreValues } = await import("$lib/server/pipelines/testing/fixtures")
	const [ysolde] = await testDb
		.insert(schema.characters)
		.values({ userId: w.owner.id, name: "Ysolde", description: "A delver.", isPersona: true })
		.returning()
	await testDb.insert(schema.sessionPersonas).values({ sessionId: w.session.id, personaId: ysolde!.id })
	const [binding] = await testDb
		.insert(schema.lorebookBindings)
		.values({ lorebookId: w.lorebookId, binding: "{{char:3}}", name: "Ysolde", characterId: ysolde!.id })
		.returning()
	await testDb.insert(schema.lorebookEntries).values(
		characterLoreValues([
			{
				lorebookId: w.lorebookId,
				name: "Ysolde's debt",
				keys: "door",
				content: PERSONA_SECRET,
				lorebookBindingId: binding!.id
			}
		])
	)
}

describe("a room draft never reads the private lore of a persona someone plays", () => {
	test("Answer the door, nothing typed: the persona's secret stays out of the draft", async () => {
		const w = await lair()
		await withPersona(w)
		reset(KNOCK)
		await reply(w, "the knock")
		reset(PLAN)
		const knock = (await lastBlockTree(w.session.id))!
		const block = knock.blocks[0] as any
		await press(w, block.actions[0].action, {
			messageId: knock.messageId,
			blockId: block.id,
			payload: { choice: block.actions[0].choice }
		})
		expect(proseCalls).toBe(1)
		const draft = prosePrompts[0]!
		expect(draft).toContain(PUBLIC)
		expect(draft).not.toContain(PERSONA_SECRET)
		expect(draft).not.toContain("Ysolde's debt")
		await rejectParked(w.owner.id)
	})

	test("File as a room: the persona's secret stays out of the draft", async () => {
		const w = await lair()
		await withPersona(w)
		const { insertLegacy } = await import("$lib/server/messages/store")
		const described = await insertLegacy(testDb as unknown as Db, {
			sessionId: w.session.id,
			role: "user",
			userId: w.owner.id,
			content:
				"Past the door the stair ends in the Drowned Hall, a vaulted room knee-deep in black water."
		} as any)
		reset(PLAN)
		const ack = await press(w, "core:spec/lair-file-room#file", {
			messageId: described.id,
			text: "The Drowned Hall"
		})
		expect(ack?.error, JSON.stringify(ack)).toBeUndefined()
		expect(proseCalls).toBe(1)
		const draft = prosePrompts[0]!
		expect(draft).toContain(PUBLIC)
		expect(draft).not.toContain(PERSONA_SECRET)
		expect(draft).not.toContain("Ysolde's debt")
		await rejectParked(w.owner.id)
	})
})

describe("a delver's voice sees the stats of the room it stands in", () => {
	test("a delver's character turn is told what lies in the Old Well, and not what lies on the Stair; the planner is told both", async () => {
		const w = await lair()
		reset(PLAN)
		await reply(w, "the Castellan's turn")
		const planner = jsonPrompts[0]!
		expect(planner).toContain(HERE_ITEM)
		expect(planner).toContain(AHEAD_ITEM)
		const turn = prosePrompts[0]!
		expect(turn).toContain("nobody narrates it for you")
		expect(turn).toContain(HERE_ITEM)
		expect(turn).not.toContain(AHEAD_ITEM)
		// The room names stay: a delver still knows which rooms exist.
		expect(turn).toContain("The rooms this dungeon holds: The Old Well, The Stair.")
	})
})
