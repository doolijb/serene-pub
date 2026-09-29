/**
 * Retake — Regenerate the last turn, as a whole (lair pass R2, owner
 * 2026-09-28), over the REAL reply road.
 *
 *  - **The yield goes, the turn comes back.** A Lair cast turn writes the
 *    narrator's row and one row per delver; `sessions:retakeTurn` deletes
 *    every row that turn's run created (its **turn yield**, on every channel),
 *    with the state and proposals anchored to them, emits `message-deleted`
 *    for each, and fires the same entry again. The master's own line stays.
 *  - **`preview` writes nothing.** It names the rows the dialog lists.
 *  - **Each refusal is a sentence**: a genre that does not offer retake, the
 *    person's own line newest, the newest row an action's, a guest.
 *  - **The row regenerate reads the yield.** In a retake genre the narrator's
 *    row of a several-row turn refuses row regenerate and points to
 *    Regenerate; a delver's row keeps it.
 *  - **What somebody else wrote against the turn survives it.** A Nudge, a
 *    whisper and a proposal the person applied after the turn are re-anchored
 *    onto the newest surviving message before the yield (NULL when none) and
 *    outlive the retake; the turn's own run's writes still cascade (owner
 *    ruling 2026-09-28, option b).
 *
 * The faked model answers every JSON request (planner, keeper) with
 * one document and every prose request by whose prompt it is: the
 * `lair-voice` prompt opens "You are <name>,".
 */

import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, asc, eq, inArray, ne } from "drizzle-orm"
import type { TestDb } from "$lib/server/utils/testDb"
import type { FakeTextAdapter } from "$lib/server/connectionAdapters/fakeTextAdapter"
import { JSON_INSTRUCTION } from "$lib/server/connections/structuredOutput"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "retake-test-secret" }
})

const PLAN = {
	beats: ["The torch gutters.", "Something scrapes behind the door."],
	speakers: [
		{ name: "Brannoc", intent: "check the door" },
		{ name: "Vell", intent: "hold the light" }
	],
	unknownExit: "",
	knockQuestion: "",
	worldHints: { location: "The Old Well" },
	// The keeper answers the same document: one change, Brannoc's hp.
	values: [{ owner: "Brannoc", slot: "hp", value: "8" }],
	inventory: [],
	/** What the master whispers to Brannoc (R10: no model reads it). */
	instruction: "The third flagstone is a trap."
}
const NARRATION = "The torch gutters. Something scrapes behind the door."
/** Every prose call, by whose voice it was written in. */
const proseCalls: string[] = []
const voiceOf = (prompt: string) =>
	/You are (Brannoc|Vell),/.exec(prompt)?.[1] ?? null

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
					onContent(JSON.stringify(PLAN))
					return
				}
				const who = voiceOf(prompt)
				proseCalls.push(who ?? "narrator")
				onContent(who ? `${who} speaks.` : NARRATION)
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
			() =>
				reject(
					new Error(`${label} did not finish within ${HANG_MS} ms`)
				),
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
		path.join(os.tmpdir(), "serene-pub-vitest-retake-")
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

/** A session: two delvers seated, a guest, and the master's line waiting. */
async function session(
	genreFields: Record<string, unknown> = {},
	genreId = "core:genre/lair",
	opts: { line?: boolean } = {}
) {
	const schema = await import("$lib/server/db/schema")
	const { insertLegacy } = await import("$lib/server/messages/store")
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const tag = `retake-${++n}`
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
			genreId,
			lorebookId: lorebook!.id,
			genreFields
		})
		.returning()
	await testDb
		.insert(schema.sessionGuests)
		.values({ sessionId: row!.id, userId: guest.id })
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
	const line =
		opts.line === false
			? null
			: await insertLegacy(testDb as unknown as Db, {
					sessionId: row!.id,
					role: "user",
					content: "I open the door.",
					userId: owner.id
				})
	return {
		owner,
		guest,
		session: row!,
		line: line?.id ?? -1,
		brannoc: ids.Brannoc!,
		vell: ids.Vell!
	}
}
type World = Awaited<ReturnType<typeof session>>

/** One socket per user, every emit recorded. */
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
						room === `user_${userId}`
							? new Set([socketId])
							: undefined
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

/** The Castellan's turn, as the owner fires it (Continue). */
async function turn(w: World, label: string) {
	const { sessionsFireTurnHandler } = await import("./sessions")
	const { io } = recordingIo(w.owner.id, w.session.id)
	const res = await within(
		label,
		sessionsFireTurnHandler.handler(
			{ user: { id: w.owner.id, isAdmin: false }, io } as any,
			// Continue — the owner's carry-on, the Castellan's full turn (R8:
			// an explicit `{ ref: null }` is the Narrate press).
			{ sessionId: w.session.id } as any,
			() => {}
		)
	)
	await settle()
	return res
}

/** `sessions:retakeTurn`, as `userId` presses it. */
async function retake(
	w: World,
	label: string,
	opts: { userId?: number; preview?: boolean } = {}
) {
	const { sessionsRetakeTurnHandler } = await import("./sessions")
	const userId = opts.userId ?? w.owner.id
	const { io } = recordingIo(userId, w.session.id)
	const replies: Array<{ event: string; payload: any }> = []
	const res = await within(
		label,
		sessionsRetakeTurnHandler.handler(
			{ user: { id: userId, isAdmin: false }, io } as any,
			{
				sessionId: w.session.id,
				...(opts.preview ? { preview: true } : {})
			} as any,
			(event: string, payload: any) => replies.push({ event, payload })
		)
	)
	await settle()
	return { res: res as any, replies }
}

const settle = async () =>
	(
		await import("$lib/server/pipelines/runtime/sessionEvents")
	).settleSessionEvents()

/** Every row but the master's own lines, oldest first. */
async function turnRows(sessionId: number) {
	const schema = await import("$lib/server/db/schema")
	return testDb
		.select()
		.from(schema.sessionMessages)
		.where(
			and(
				eq(schema.sessionMessages.sessionId, sessionId),
				ne(schema.sessionMessages.role, "user")
			)
		)
		.orderBy(asc(schema.sessionMessages.id))
}

async function allRows(sessionId: number) {
	const schema = await import("$lib/server/db/schema")
	return testDb
		.select()
		.from(schema.sessionMessages)
		.where(eq(schema.sessionMessages.sessionId, sessionId))
		.orderBy(asc(schema.sessionMessages.id))
}

async function respondRuns(sessionId: number) {
	const schema = await import("$lib/server/db/schema")
	const runs = await testDb
		.select({ specSlug: schema.pipelineRuns.specSlug })
		.from(schema.pipelineRuns)
		.where(eq(schema.pipelineRuns.sessionId, sessionId))
	return runs.filter((r) => r.specSlug === "core:spec/lair-respond").length
}

async function press(w: World, action: string, text: string, recipients?: string[]) {
	const { fireAction } = await import(
		"$lib/server/pipelines/runtime/fireAction"
	)
	const { io } = recordingIo(w.owner.id, w.session.id)
	const out = await within(
		action,
		fireAction(testDb as any, {
			sessionId: w.session.id,
			action,
			text,
			...(recipients ? { recipients } : {}),
			actor: { userId: w.owner.id },
			io
		})
	)
	await settle()
	return out
}

describe("R2 · retake deletes the turn's yield and takes the turn again", () => {
	test("a cast turn: the narrator's row and both delvers' go, with their proposals, and a new turn runs", async () => {
		proseCalls.length = 0
		const w = await session({ trustNarrator: false })
		await turn(w, "the first turn")
		const before = await turnRows(w.session.id)
		expect(before.map((r) => r.characterId)).toEqual([
			null,
			w.brannoc,
			w.vell
		])
		const oldIds = before.map((r) => r.id)

		const schema = await import("$lib/server/db/schema")
		const proposalsBefore = await testDb
			.select()
			.from(schema.stateProposals)
			.where(eq(schema.stateProposals.sessionId, w.session.id))
		// The keeper proposed Brannoc's hp, anchored to a row of the turn.
		expect(proposalsBefore.length).toBeGreaterThan(0)

		const { res, replies } = await retake(w, "the retake")
		expect(res.error).toBeUndefined()
		expect(res.ok).toBe(true)
		expect(replies.at(-1)?.event).toBe("sessions:retakeTurn")

		// The old yield is gone; the master's line stays; a new turn wrote three rows.
		const after = await allRows(w.session.id)
		expect(after.filter((r) => oldIds.includes(r.id))).toEqual([])
		expect(after.some((r) => r.id === w.line && r.role === "user")).toBe(
			true
		)
		const fresh = await turnRows(w.session.id)
		expect(fresh.map((r) => r.characterId)).toEqual([
			null,
			w.brannoc,
			w.vell
		])
		for (const r of fresh) expect(r.id).toBeGreaterThan(Math.max(...oldIds))
		expect(await respondRuns(w.session.id)).toBe(2)

		// Every proposal the old turn made cascaded off its rows.
		const oldProposals = await testDb
			.select()
			.from(schema.stateProposals)
			.where(
				inArray(
					schema.stateProposals.id,
					proposalsBefore.map((p) => p.id)
				)
			)
		expect(oldProposals).toEqual([])

		// And each deleted row was announced as a change.
		const changes = await testDb
			.select()
			.from(schema.sessionChanges)
			.where(
				and(
					eq(schema.sessionChanges.sessionId, w.session.id),
					eq(
						schema.sessionChanges.event,
						"core:event/message-deleted@1"
					)
				)
			)
		expect(changes.map((c) => c.messageId).sort()).toEqual(
			[...oldIds].sort()
		)
	})

	test("applied state anchored to the turn goes with it", async () => {
		const w = await session({ trustNarrator: true })
		await turn(w, "the trusted turn")
		const oldIds = (await turnRows(w.session.id)).map((r) => r.id)
		const schema = await import("$lib/server/db/schema")
		const anchored = async () =>
			testDb
				.select()
				.from(schema.attributeValues)
				.where(
					inArray(schema.attributeValues.validFromMessageId, oldIds)
				)
		expect((await anchored()).length).toBeGreaterThan(0)
		await retake(w, "the trusted retake")
		expect(await anchored()).toEqual([])
	})

	test("preview names the rows and writes nothing", async () => {
		const w = await session()
		await turn(w, "the previewed turn")
		const before = await allRows(w.session.id)
		const { res } = await retake(w, "the preview", { preview: true })
		expect(res.ok).toBe(true)
		expect(res.preview).toBe(true)
		expect(res.rows.map((r: any) => r.messageId)).toEqual(
			before.filter((r) => r.role !== "user").map((r) => r.id)
		)
		expect(res.rows.map((r: any) => r.name).slice(1)).toEqual([
			"Brannoc",
			"Vell"
		])
		expect(await allRows(w.session.id)).toEqual(before)
		expect(await respondRuns(w.session.id)).toBe(1)
	})
})

describe("R2 · each refusal is a sentence", () => {
	test("the person's own line is newest", async () => {
		const w = await session()
		const { res, replies } = await retake(w, "own line")
		expect(res.ok).toBe(false)
		expect(res.error).toBe("Your line is the newest. Press Continue.")
		expect(replies.at(-1)?.event).toBe("sessions:retakeTurn:error")
	})

	test("the newest message came from an action", async () => {
		const w = await session()
		await turn(w, "the turn before the trap")
		const out = await press(w, "core:spec/lair-trap#trap", "")
		expect(out.kind, JSON.stringify(out)).toBe("ran")
		const { res } = await retake(w, "after the trap")
		expect(res.ok).toBe(false)
		expect(res.error).toBe(
			"The newest message came from Trigger trap. Regenerate it from its own menu."
		)
	})

	test("a genre that does not offer retake refuses it by name", async () => {
		const w = await session({}, "core:genre/chat")
		const { res } = await retake(w, "chat")
		expect(res.ok).toBe(false)
		expect(res.error).toMatch(/does not offer Regenerate/)
	})

	test("a guest is refused", async () => {
		const w = await session()
		await turn(w, "the turn a guest tries to retake")
		const before = await allRows(w.session.id)
		const { res } = await retake(w, "the guest", { userId: w.guest.id })
		expect(res.ok).toBe(false)
		expect(res.error).toBe("Only the session owner can regenerate a turn.")
		expect(await allRows(w.session.id)).toEqual(before)
	})
})

describe("R2 · the row regenerate reads the run's yield", () => {
	test("the Castellan's beats row of a several-row turn is refused, pointing to Regenerate (R8); a delver's is not", async () => {
		const w = await session()
		await turn(w, "the turn to regenerate a row of")
		const [narrator, brannoc] = await turnRows(w.session.id)
		const { verbRefusal } = await import("$lib/server/messages/verbs")
		const refusal = await verbRefusal(
			testDb as any,
			w.session.id,
			"retry",
			{
				messageId: narrator!.id,
				userId: w.owner.id
			}
		)
		expect(refusal).toMatch(/Regenerate in the story's composer/)
		const delver = await verbRefusal(testDb as any, w.session.id, "retry", {
			messageId: brannoc!.id,
			userId: w.owner.id
		})
		expect(delver ?? "").not.toMatch(/Regenerate in the/)
	})
})

describe("R2 · what somebody else wrote against the turn survives a retake", () => {
	/** Every state row anchored to one of `ids`, by table. */
	async function anchoredTo(ids: number[]) {
		const schema = await import("$lib/server/db/schema")
		const values = await testDb
			.select()
			.from(schema.attributeValues)
			.where(inArray(schema.attributeValues.validFromMessageId, ids))
		const proposals = await testDb
			.select()
			.from(schema.stateProposals)
			.where(inArray(schema.stateProposals.messageId, ids))
		return { values, proposals }
	}
	async function valueRows(rowIds: number[]) {
		const schema = await import("$lib/server/db/schema")
		return testDb
			.select()
			.from(schema.attributeValues)
			.where(inArray(schema.attributeValues.id, rowIds))
	}
	async function stateNow(sessionId: number) {
		const { stateFor } = await import("$lib/server/state/resolve")
		return stateFor(testDb as any, sessionId)
	}
	const brannocOf = (state: any) =>
		Object.values(state.cast).find((c: any) => c?.name === "Brannoc") as any

	test("a Nudge given after the turn survives, re-anchored to the master's line", async () => {
		const w = await session({ trustNarrator: true })
		await turn(w, "the turn before the nudge")
		const turnIds = (await turnRows(w.session.id)).map((r) => r.id)
		expect(
			(await press(w, "core:spec/lair-nudge#nudge", "Go north.")).kind
		).toBe("ran")
		expect(((await stateNow(w.session.id)).world as any).direction).toBe(
			"Go north."
		)
		const nudged = (await anchoredTo(turnIds)).values.filter(
			(v) => (v.value as any)?.v === "Go north."
		)
		expect(nudged).toHaveLength(1)

		await retake(w, "the retake after the nudge")
		expect(((await stateNow(w.session.id)).world as any).direction).toBe(
			"Go north."
		)
		const [kept] = await valueRows([nudged[0]!.id])
		expect(kept?.validFromMessageId).toBe(w.line)
	})

	test("a whisper given after the turn survives, re-anchored to the master's line", async () => {
		const w = await session({ trustNarrator: true })
		await turn(w, "the turn before the whisper")
		const turnIds = (await turnRows(w.session.id)).map((r) => r.id)
		expect(
			(
				await press(
					w,
					"core:spec/lair-whisper#whisper",
					PLAN.instruction,
					// Who hears it (R10): collected, never read off the line.
					[`character:${w.brannoc}`]
				)
			).kind
		).toBe("ran")
		expect(brannocOf(await stateNow(w.session.id))?.whisper).toBe(
			PLAN.instruction
		)
		const whispered = (await anchoredTo(turnIds)).values.filter(
			(v) => (v.value as any)?.v === PLAN.instruction
		)
		expect(whispered).toHaveLength(1)

		await retake(w, "the retake after the whisper")
		expect(brannocOf(await stateNow(w.session.id))?.whisper).toBe(
			PLAN.instruction
		)
		const [kept] = await valueRows([whispered[0]!.id])
		expect(kept?.validFromMessageId).toBe(w.line)
	})

	test("the run's own keeper writes still cascade, beside a Nudge on the same rows that survives", async () => {
		const w = await session({ trustNarrator: true })
		await turn(w, "the trusted turn")
		const turnIds = (await turnRows(w.session.id)).map((r) => r.id)
		const [run] = await (async () => {
			const schema = await import("$lib/server/db/schema")
			return testDb
				.select({ runId: schema.pipelineRuns.runId })
				.from(schema.pipelineRuns)
				.where(
					and(
						eq(schema.pipelineRuns.sessionId, w.session.id),
						eq(
							schema.pipelineRuns.specSlug,
							"core:spec/lair-respond"
						)
					)
				)
		})()
		const keeper = (await anchoredTo(turnIds)).values.filter(
			(v) => v.updatedBy === `run:${run!.runId}`
		)
		expect(keeper.length).toBeGreaterThan(0)
		expect(
			(await press(w, "core:spec/lair-nudge#nudge", "Go north.")).kind
		).toBe("ran")

		await retake(w, "the retake of the trusted turn")
		expect(await valueRows(keeper.map((v) => v.id))).toEqual([])
		expect(((await stateNow(w.session.id)).world as any).direction).toBe(
			"Go north."
		)
	})

	test("a proposal the person applied after the turn: the value survives on a valid anchor, the proposal goes", async () => {
		const w = await session({ trustNarrator: false })
		await turn(w, "the proposing turn")
		const turnIds = (await turnRows(w.session.id)).map((r) => r.id)
		const { proposals } = await anchoredTo(turnIds)
		const hp = proposals.find(
			(p) => (p.payload as any)?.slotId === "core:slot/hp@1"
		)
		expect(hp, JSON.stringify(proposals.map((p) => p.payload))).toBeTruthy()
		const { decideProposal } = await import("$lib/server/state/write")
		const decided = await decideProposal(testDb as any, hp!.id, true)
		expect(decided.status).toBe("accepted")
		const appliedId = (decided as any).appliedId as number
		expect((await valueRows([appliedId]))[0]?.validFromMessageId).toBe(
			hp!.messageId
		)

		await retake(w, "the retake after the accept")
		const [kept] = await valueRows([appliedId])
		expect(kept, "the applied value outlives the retake").toBeTruthy()
		expect(kept!.validFromMessageId).toBe(w.line)
		const messages = await allRows(w.session.id)
		expect(messages.some((m) => m.id === kept!.validFromMessageId)).toBe(
			true
		)
		// The proposal was the run's own row, so it went with the turn.
		expect((await anchoredTo([hp!.messageId!])).proposals).toEqual([])
		expect(brannocOf(await stateNow(w.session.id))?.hp).toBe(8)
	})

	test("a retake of the very first turn: nothing survives before the yield, so the Nudge is unanchored", async () => {
		const w = await session({ trustNarrator: true }, "core:genre/lair", {
			line: false
		})
		await turn(w, "the opening turn")
		const turnIds = (await turnRows(w.session.id)).map((r) => r.id)
		expect(turnIds.length).toBeGreaterThan(0)
		expect(await allRows(w.session.id)).toHaveLength(turnIds.length)
		expect(
			(await press(w, "core:spec/lair-nudge#nudge", "Go north.")).kind
		).toBe("ran")
		const nudged = (await anchoredTo(turnIds)).values.filter(
			(v) => (v.value as any)?.v === "Go north."
		)
		expect(nudged).toHaveLength(1)

		const { res } = await retake(w, "the retake of the opening turn")
		expect(res.error).toBeUndefined()
		const [kept] = await valueRows([nudged[0]!.id])
		expect(kept?.validFromMessageId).toBeNull()
		expect(((await stateNow(w.session.id)).world as any).direction).toBe(
			"Go north."
		)
	})
})
