/**
 * The Lair, wave 3 of the lair pass (2026-09-27) — over the REAL reply road,
 * the real press and the real review gate, with a faked model.
 *
 *  - **R9** (2026-09-28) — the knock asks the person to describe the room:
 *    typed text is saved verbatim with no review; nothing typed is the
 *    Castellan's draft behind the review (named after the block's
 *    `referent`); a rejected draft re-opens the knock; a room described in
 *    prose on `main` or in the Sanctum never knocks; the knock row's own
 *    Regenerate is refused for the composer's. Then the story goes on: the
 *    master's own line lands and the Castellan's turn fires.
 *  - **B13 (F12)** — the planner is shown the room the party are in, its
 *    exits, and every room the dungeon holds, whatever retrieval ranked; a
 *    room the lorebook lists never knocks.
 *  - **R8** (2026-09-28) — nothing narrates a turn: the planner plans the
 *    party only, and the first prose call is the lead delver's (B14's scene
 *    prompt retired with the narrator's scene step).
 *  - **R1** — the per-turn direction renders from `{{turnDirection}}`.
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
	return { db, getCryptoSecretKey: () => "lair-knock-test-secret" }
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
		path.join(os.tmpdir(), "serene-pub-vitest-lair-knock-")
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

/** A Lair session: two rooms in its dungeon, the party in the first, the owner's line waiting. */
async function lair() {
	const schema = await import("$lib/server/db/schema")
	const { insertLegacy } = await import("$lib/server/messages/store")
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const tag = `knock-${++n}`
	const owner = await createTestUser(testDb, `${tag}-owner`)
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
	await insertLegacy(testDb as unknown as Db, {
		sessionId: row!.id,
		role: "user",
		content: "I open the door.",
		userId: owner.id
	})
	// Where the party stand: the world's location, as the keeper writes it.
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
	return { owner, session: row!, lorebookId: lorebook!.id }
}

const fakeSocket = (userId: number) =>
	({ user: { id: userId, isAdmin: false }, io: { to: () => ({ emit: () => {} }) } }) as any

async function reply(w: Awaited<ReturnType<typeof lair>>, label: string) {
	const { sessionsFireTurnHandler } = await import("./sessions")
	const res = await within(
		label,
		sessionsFireTurnHandler.handler(
			fakeSocket(w.owner.id),
			// Continue — the Castellan's turn (R8: an explicit `{ ref: null }` is
			// the Narrate press).
			{ sessionId: w.session.id } as any,
			() => {}
		)
	)
	expect((res as any)?.error).toBeUndefined()
	await (await import("$lib/server/pipelines/runtime/sessionEvents")).settleSessionEvents()
}

async function runsOf(sessionId: number) {
	await (
		await import("$lib/server/pipelines/runtime/sessionEvents")
	).settleSessionEvents()
	const schema = await import("$lib/server/db/schema")
	return testDb
		.select({
			specSlug: schema.pipelineRuns.specSlug,
			outcome: schema.pipelineRuns.outcome
		})
		.from(schema.pipelineRuns)
		.where(eq(schema.pipelineRuns.sessionId, sessionId))
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

/** The knock row's block, and a press of its one option — with the text the collect modal took, or none. */
async function pressKnock(
	w: Awaited<ReturnType<typeof lair>>,
	text?: string
): Promise<{ ack: any; messageId: number; block: any }> {
	const knock = (await lastBlockTree(w.session.id))!
	const block = knock.blocks[0] as any
	const { sessionsFireActionHandler } = await import("./sessions")
	const ack = await within(
		"the knock's answer",
		sessionsFireActionHandler.handler(
			fakeSocket(w.owner.id),
			{
				sessionId: w.session.id,
				action: block.actions[0].action,
				messageId: knock.messageId,
				blockId: block.id,
				payload: { choice: block.actions[0].choice },
				...(text !== undefined ? { text } : {})
			} as any,
			() => {}
		)
	)
	return { ack, messageId: knock.messageId, block }
}

async function roomsNamed(lorebookId: number, name: string) {
	const schema = await import("$lib/server/db/schema")
	return testDb
		.select()
		.from(schema.lorebookEntries)
		.where(
			and(
				eq(schema.lorebookEntries.lorebookId, lorebookId),
				eq(schema.lorebookEntries.title, name)
			)
		)
}

/** The story went on by itself: `n` respond runs ended ok, and the newest row is not the person's. */
async function storyWentOn(w: Awaited<ReturnType<typeof lair>>, n: number) {
	await vi.waitFor(
		async () => {
			const runs = await runsOf(w.session.id)
			expect(
				runs.filter((r) => r.specSlug === "core:spec/lair-respond" && r.outcome === "ok")
			).toHaveLength(n)
		},
		{ timeout: 30_000, interval: 200 }
	)
}

const ROOM_ANSWER = "core:spec/lair-room-answer#room"

/** What the person types into the collect modal: formatted, with its own line breaks. */
const TYPED =
	"A vaulted hall, knee-deep in black water.\n\nExits: up → The Stair\nHazards: the floor drops away mid-hall."

describe("R9 · the knock asks the person to describe the room", () => {
	test("an undescribed room knocks: a Castellan row on main, one option — Describe <room>…", async () => {
		const w = await lair()
		reset(KNOCK)
		await reply(w, "the knock")
		expect(proseCalls).toBe(0)
		const knock = (await lastBlockTree(w.session.id))!
		const block = knock.blocks[0] as any
		expect(block).toMatchObject({ kind: "choices", addressee: "owner", referent: "The Drowned Hall" })
		expect(block.actions.map((a: any) => [a.choice, a.label, a.action])).toEqual([
			["describe", "Describe The Drowned Hall…", ROOM_ANSWER]
		])
		const [row] = (await rowsOf(w.session.id)).filter((r) => r.id === knock.messageId)
		expect(row!.channel).toBe("main")
		expect((row!.metadata as any)?.speaker).toBe("envoy:castellan")
	})

	test("Answer the door collects the description: optional, and empty is the Castellan's draft", async () => {
		const w = await lair()
		reset(KNOCK)
		await reply(w, "the knock")
		const { listSessionActions } = await import(
			"$lib/server/pipelines/entities/sessionActions"
		)
		const venues = await listSessionActions(testDb as any, w.session.id, { userId: w.owner.id })
		const room = [...venues.composer.primary, ...venues.composer.overflow].find(
			(a) => `${a.specSlug}#${a.key}` === ROOM_ANSWER
		)
		expect(room?.collects).toEqual({
			text: {
				need: "optional",
				label: "Describe the room",
				ifEmpty: "The Castellan drafts it for you to review."
			}
		})
	})

	test("a typed description is saved verbatim with no review, and the story goes on", async () => {
		const { pendingReviewsFor } = await import("$lib/server/pipelines/runtime/reviewGate")
		const w = await lair()
		reset(KNOCK)
		await reply(w, "the knock")
		reset(PLAN)
		const { ack, block } = await pressKnock(w, TYPED)
		expect(ack?.error).toBeUndefined()
		// Not parked: the master's own words need no approving.
		expect(ack?.parked).toBeUndefined()
		expect(pendingReviewsFor(w.owner.id).filter((r) => r.specId === "core:spec/lair-room-answer")).toEqual([])
		const [entry] = await roomsNamed(w.lorebookId, "The Drowned Hall")
		expect(entry!.content).toBe(TYPED)
		expect(entry!.typeId).toBe("core:entry/location")
		// The answer made no model call of its own: the first prose call is
		// the next turn's lead delver.
		expect(prosePrompts.some((p) => p.includes("has left the description to you"))).toBe(false)
		// Answered, and the master's own line sent the party on …
		const answered = (await lastBlockTree(w.session.id))!
		expect((answered.blocks[0] as any).id).toBe(block.id)
		expect((answered.blocks[0] as any).answered).toMatchObject({ choice: "describe" })
		await vi.waitFor(
			async () => {
				const onward = (await rowsOf(w.session.id)).find(
					(r) => r.content === "The party go on into The Drowned Hall"
				)
				expect(onward?.role).toBe("user")
			},
			{ timeout: 30_000, interval: 100 }
		)
		// … and the story resumed by itself.
		await storyWentOn(w, 2)
	})

	test("/room <text> from the composer is the same answer (S2's slash argument rides this road)", async () => {
		const w = await lair()
		reset(KNOCK)
		await reply(w, "the knock")
		reset(PLAN)
		const { sessionsFireActionHandler } = await import("./sessions")
		// No block named: the host addresses the press to the open knock, and
		// the text rides on `text` exactly as the modal's does.
		const ack = await within(
			"/room with text",
			sessionsFireActionHandler.handler(
				fakeSocket(w.owner.id),
				{ sessionId: w.session.id, action: ROOM_ANSWER, text: TYPED } as any,
				() => {}
			)
		)
		expect((ack as any)?.error).toBeUndefined()
		expect((ack as any)?.parked).toBeUndefined()
		const [entry] = await roomsNamed(w.lorebookId, "The Drowned Hall")
		expect(entry!.content).toBe(TYPED)
		await storyWentOn(w, 2)
	})

	test("an empty answer is the Castellan's draft, parked at the review with the room's name", async () => {
		const { pendingReviewsFor, resolveReview } = await import(
			"$lib/server/pipelines/runtime/reviewGate"
		)
		const w = await lair()
		reset(KNOCK)
		await reply(w, "the knock")
		reset(PLAN)
		const { ack } = await pressKnock(w)
		expect(ack?.error).toBeUndefined()
		expect(ack?.parked).toBe(true)
		// The model drafted the room — the knock-build prompt.
		expect(proseCalls).toBe(1)
		expect(prosePrompts[0]).toContain("has left the description to you")
		const [review] = pendingReviewsFor(w.owner.id)
		expect(review).toMatchObject({
			specId: "core:spec/lair-room-answer",
			nodeKey: "room.drafted.save"
		})
		expect(review!.values.name).toBe("The Drowned Hall")
		expect(review!.values.content).toBe(PROSE.join(""))
		resolveReview(review!.id, w.owner.id, "approve")
		await vi.waitFor(
			async () => {
				const [entry] = await roomsNamed(w.lorebookId, "The Drowned Hall")
				expect(entry?.content).toBe(PROSE.join(""))
			},
			{ timeout: 30_000, interval: 100 }
		)
		await storyWentOn(w, 2)
	})

	test("a rejected draft re-opens the knock: open again, /room listed, and a second answer works", async () => {
		const schema = await import("$lib/server/db/schema")
		const { pendingReviewsFor, resolveReview } = await import(
			"$lib/server/pipelines/runtime/reviewGate"
		)
		const w = await lair()
		reset(KNOCK)
		await reply(w, "the knock")
		// The owner had seen to the knock's notification before answering.
		await testDb
			.update(schema.notifications)
			.set({ clearedAt: new Date() })
			.where(eq(schema.notifications.userId, w.owner.id))
		reset(PLAN)
		const first = await pressKnock(w)
		expect(first.ack?.parked).toBe(true)
		const [review] = pendingReviewsFor(w.owner.id)
		resolveReview(review!.id, w.owner.id, "reject")
		await vi.waitFor(
			async () => {
				const runs = await runsOf(w.session.id)
				expect(
					runs.find((r) => r.specSlug === "core:spec/lair-room-answer")?.outcome
				).toBe("halt")
			},
			{ timeout: 30_000, interval: 100 }
		)
		// Nothing was written, and the knock is open again.
		expect(await roomsNamed(w.lorebookId, "The Drowned Hall")).toEqual([])
		const tree = (await lastBlockTree(w.session.id))!
		expect(tree.messageId).toBe(first.messageId)
		expect((tree.blocks[0] as any).answered).toBeUndefined()
		const { openFormOf } = await import("$lib/server/messages/blocks")
		expect(await openFormOf(testDb as any, w.session.id)).toEqual({
			messageId: first.messageId,
			blockId: first.block.id,
			action: ROOM_ANSWER
		})
		// The question waits on the owner again: its notification is raised anew.
		await vi.waitFor(
			async () => {
				const rows = await testDb
					.select()
					.from(schema.notifications)
					.where(eq(schema.notifications.userId, w.owner.id))
				expect(rows.some((n: any) => n.clearedAt === null)).toBe(true)
			},
			{ timeout: 10_000, interval: 100 }
		)
		const open = await testDb
			.select()
			.from(schema.notifications)
			.where(eq(schema.notifications.userId, w.owner.id))
		expect(
			open.filter(
				(n: any) =>
					n.kind === "core:notification/open-form@1" &&
					n.clearedAt === null &&
					String(n.regarding).includes(`form:${first.messageId}/`)
			)
		).toHaveLength(1)
		// /room is offered again …
		const { listSessionActions } = await import(
			"$lib/server/pipelines/entities/sessionActions"
		)
		const venues = await listSessionActions(testDb as any, w.session.id, { userId: w.owner.id })
		expect(
			[...venues.composer.primary, ...venues.composer.overflow].map(
				(a) => `${a.specSlug}#${a.key}`
			)
		).toContain(ROOM_ANSWER)
		// … the story still waits (no second turn) …
		expect(
			(await runsOf(w.session.id)).filter((r) => r.specSlug === "core:spec/lair-respond")
		).toHaveLength(1)
		// … and a second answer works.
		const second = await pressKnock(w, TYPED)
		expect(second.ack?.error).toBeUndefined()
		const [entry] = await roomsNamed(w.lorebookId, "The Drowned Hall")
		expect(entry!.content).toBe(TYPED)
		await storyWentOn(w, 2)
	})

	test("a knock row's own Regenerate is refused with a pointer to the composer's Regenerate (the retake)", async () => {
		const w = await lair()
		reset(KNOCK)
		await reply(w, "the knock")
		const knock = (await lastBlockTree(w.session.id))!
		const { verbRefusal } = await import("$lib/server/messages/verbs")
		const refusal = await verbRefusal(testDb as any, w.session.id, "retry", {
			messageId: knock.messageId,
			userId: w.owner.id
		})
		expect(refusal).toMatch(/question its turn stopped on/)
		expect(refusal).toMatch(/Use Regenerate in the composer/)
		// The composer's Regenerate takes exactly that turn again: the knock alone.
		const { lastTurnOf } = await import("$lib/server/sessions/turnYield")
		const turn = await lastTurnOf(testDb as any, w.session.id)
		expect(turn.ok && turn.yield.rows.map((r) => [r.messageId, r.name])).toEqual([
			[knock.messageId, "Castellan"]
		])
	})
})

describe("R9 · a room already described never knocks — in the story or in the Sanctum", () => {
	/** A paragraph that names the room and says enough about it to be a description. */
	const DESCRIBED =
		"Below the stair lies The Drowned Hall, a long vault under black water where the pillars are furred with weed and a rusted door stands open at the far end."

	test("described in prose on main: the party walk in, and the passage reaches the voice", async () => {
		const w = await lair()
		const { insertLegacy } = await import("$lib/server/messages/store")
		await insertLegacy(testDb as unknown as Db, {
			sessionId: w.session.id,
			role: "user",
			content: DESCRIBED,
			userId: w.owner.id
		})
		reset({ ...KNOCK, speakers: PLAN.speakers })
		await reply(w, "a room described on main")
		expect(await lastBlockTree(w.session.id)).toBeNull()
		expect(proseCalls).toBeGreaterThan(0)
		const lead = prosePrompts[0]!
		expect(lead).toContain("The room the party are heading into, as it has been described")
		expect(lead).toContain("a long vault under black water")
		expect(lead).not.toContain("{{")
	})

	test("described in the Sanctum: no knock either", async () => {
		const w = await lair()
		const { insertLegacy } = await import("$lib/server/messages/store")
		await insertLegacy(testDb as unknown as Db, {
			sessionId: w.session.id,
			channel: "sanctum",
			role: "user",
			content: DESCRIBED,
			userId: w.owner.id
		})
		reset({ ...KNOCK, speakers: PLAN.speakers })
		await reply(w, "a room described in the Sanctum")
		expect(await lastBlockTree(w.session.id)).toBeNull()
		expect(proseCalls).toBeGreaterThan(0)
		expect(prosePrompts[0]).toContain("a long vault under black water")
	})

	/**
	 * R10's fold-in of the R9 follow-up (2026-09-28): the Sanctum beats row is
	 * an envoy row, so a beats list naming the room in a dozen words read as a
	 * description and suppressed the knock. The room check reads a side
	 * channel's TALK only — keyed on the creating run's inlet channel, never a
	 * row's metadata — so a story turn's beats row is out, while the person's
	 * Sanctum line (above) and the Castellan's Sanctum reply still count.
	 */
	test("R10 · a beats row naming the room does NOT suppress the knock", async () => {
		const w = await lair()
		const BEAT =
			"The party reach the foot of the stair, where The Drowned Hall opens ahead as a long vault under black water with weed-furred pillars."
		reset({ ...PLAN, beats: [BEAT] })
		await reply(w, "a turn whose beats name the room")
		const beats = (await rowsOf(w.session.id)).filter((r) => r.channel === "sanctum")
		// The premise: the Castellan's beats row names the room, at length.
		expect(beats.map((r) => String(r.content)).join("\n")).toContain(BEAT)
		expect(beats.every((r) => (r.metadata as any)?.speaker === "envoy:castellan")).toBe(true)

		reset(KNOCK)
		await reply(w, "the turn that reaches the room")
		expect(((await lastBlockTree(w.session.id))!.blocks[0] as any).referent).toBe(
			"The Drowned Hall"
		)
	})

	test("R10 · the Castellan's Sanctum talk describing it still does", async () => {
		const w = await lair()
		const { insertLegacy } = await import("$lib/server/messages/store")
		await insertLegacy(testDb as unknown as Db, {
			sessionId: w.session.id,
			channel: "sanctum",
			role: "user",
			content: "What lies below the stair?",
			userId: w.owner.id
		})
		// The Castellan seated (as the create road seats it), and the turn
		// order recomputed (an edit cause) so its Sanctum entry is prepared.
		const schema = await import("$lib/server/db/schema")
		await testDb
			.insert(schema.sessionCharacters)
			.values({ sessionId: w.session.id, envoySlug: "castellan", isActive: true, position: 9 } as any)
		const { emitSessionEvent } = await import("$lib/server/pipelines/runtime/sessionEvents")
		const { sessionEvents } = await import("@serene-pub/sdk")
		await emitSessionEvent(testDb as any, {
			sessionId: w.session.id,
			userId: w.owner.id,
			event: sessionEvents.messageDeleted,
			payload: { sessionId: w.session.id, cause: { kind: "edit", userId: w.owner.id } },
			wait: true
		})
		// The Castellan answers in the Sanctum: a reply fired on its channel.
		prose = [DESCRIBED]
		try {
			const { sessionsFireTurnHandler } = await import("./sessions")
			const res = await within(
				"the Castellan's Sanctum reply",
				sessionsFireTurnHandler.handler(
					fakeSocket(w.owner.id),
					{ sessionId: w.session.id, channel: "sanctum" } as any,
					() => {}
				)
			)
			expect((res as any)?.error).toBeUndefined()
			await (await import("$lib/server/pipelines/runtime/sessionEvents")).settleSessionEvents()
		} finally {
			prose = PROSE
		}
		const talk = (await rowsOf(w.session.id)).filter((r) => r.channel === "sanctum").at(-1)!
		expect([talk.role, (talk.metadata as any)?.speaker, talk.content]).toEqual([
			"assistant",
			"envoy:castellan",
			DESCRIBED
		])

		reset({ ...KNOCK, speakers: PLAN.speakers })
		await reply(w, "a room the Castellan described in the Sanctum")
		expect(await lastBlockTree(w.session.id)).toBeNull()
		expect(prosePrompts[0]).toContain("a long vault under black water")
	})

	test("a mention too short to describe it still knocks", async () => {
		const w = await lair()
		const { insertLegacy } = await import("$lib/server/messages/store")
		await insertLegacy(testDb as unknown as Db, {
			sessionId: w.session.id,
			role: "user",
			content: "The Drowned Hall is below.",
			userId: w.owner.id
		})
		reset(KNOCK)
		await reply(w, "only a mention")
		expect(((await lastBlockTree(w.session.id))!.blocks[0] as any).referent).toBe(
			"The Drowned Hall"
		)
	})
})

describe("B13 · the party's room is always in view", () => {
	test("the planner is shown the room it stands in, its exits and every room; a known exit never knocks", async () => {
		const w = await lair()
		// The planner names a room the dungeon already holds.
		reset({
			...KNOCK,
			speakers: PLAN.speakers,
			unknownExit: "the stair",
			knockQuestion: "Is there a stair?"
		})
		await reply(w, "a known exit")
		const planner = jsonPrompts[0]!
		expect(planner).toContain("Every room the dungeon holds: The Old Well, The Stair.")
		expect(planner).toContain("The Old Well\\nA dry well shaft.\\n\\nExits: down → The Stair")
		// No knock: the turn was played and no question was put.
		expect(proseCalls).toBeGreaterThan(0)
		expect(await lastBlockTree(w.session.id)).toBeNull()
		const rows = await rowsOf(w.session.id)
		expect(String(rows[rows.length - 1]!.content).startsWith("The torch gutters.")).toBe(true)
	})

	test("a truly unknown place still knocks", async () => {
		const w = await lair()
		reset(KNOCK)
		await reply(w, "an unknown exit")
		expect(proseCalls).toBe(0)
		expect(((await lastBlockTree(w.session.id))!.blocks[0] as any).referent).toBe(
			"The Drowned Hall"
		)
	})
})

describe("R8 · nothing narrates a turn: the planner plans the party, the lead speaks first", () => {
	test("the planner plans the party only; the first prose call is the lead delver's, in the room", async () => {
		const w = await lair()
		reset(PLAN)
		await reply(w, "the Castellan's turn")
		const planner = jsonPrompts[0]!
		expect(planner).toContain("You plan the PARTY only")
		expect(planner).toContain("Never invent a dungeon event")
		// R1/R4: this turn's direction, and the person named by playerLabel.
		expect(planner).toContain("Direction this turn: I open the door.")
		expect(planner).toContain("Dungeon Master")
		// The first prose call of a turn is a delver's voice, never a narrator's.
		const lead = prosePrompts[0]!
		expect(lead).not.toContain("Write ONE short beat")
		expect(lead).toContain("nobody narrates it for you")
		// The voice is shown the room it stands in (R8: `locationEntries`).
		expect(lead).toContain("The room you are standing in")
		expect(lead).not.toContain("{{")
	})
})
