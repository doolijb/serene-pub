import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { desc, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 })

let db: TestDb
let dataDir: string
let ownerId: number
let guestId: number

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "shared-reads-secret" }
})
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))
vi.mock("$lib/server/embedding/vectorizationQueue", () => ({
	ensureSessionMessageEmbedded: async () => {},
	autoEnqueueSession: async () => {},
	autoEnqueueLorebook: async () => {}
}))
vi.mock("$lib/server/sockets/utils/broadcastHelpers", () => ({
	emitToUserRedacted: async () => {},
	broadcastToSessionUsers: async () => {}
}))

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-shared-reads-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(db)
	const { createTestUser } = await import("$lib/server/utils/testDb")
	ownerId = (await createTestUser(db, "sr-owner")).id
	guestId = (await createTestUser(db, "sr-guest")).id
}, 240_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

let seq = 0

async function session(genreId: string | undefined, isGroup: boolean) {
	const [lorebook] = await db
		.insert(schema.lorebooks)
		.values({ name: `Cap Book ${++seq}`, userId: ownerId })
		.returning()
	const [s] = await db
		.insert(schema.sessions)
		.values({
			userId: ownerId,
			isGroup,
			name: `cap${seq}`,
			lorebookId: lorebook!.id,
			metadata: {},
			...(genreId ? { genreId } : {})
		} as any)
		.returning()
	await db
		.insert(schema.sessionGuests)
		.values({ sessionId: s!.id, userId: guestId })
	return s!
}

async function row(sessionId: number, values: Record<string, unknown>) {
	const { insertLegacy } = await import("$lib/server/messages/store")
	return insertLegacy(
		db as any,
		{ sessionId, userId: ownerId, ...values } as any
	)
}

async function runOf(
	sessionId: number,
	label: string,
	slug: string,
	ids: number[]
) {
	const [r] = await db
		.insert(schema.pipelineRuns)
		.values({
			runId: `r-cap-${sessionId}-${label}`,
			specSlug: slug,
			specVersion: "1",
			sessionId,
			userId: ownerId,
			outcome: "ok",
			triggerSource: "test",
			seed: "s",
			startedAt: new Date(),
			endedAt: new Date(),
			receipt: { nodes: [{ kind: "inlet", output: { via: "pick" } }] }
		} as any)
		.returning()
	let n = 0
	for (const id of ids)
		await db.insert(schema.pipelineRunArtifacts).values({
			runId: r!.id,
			seq: n++,
			kind: "message",
			entityId: id,
			action: "created"
		})
	return r!
}

async function plannedTurn(sessionId: number, tag: string) {
	const [a, b] = await db
		.insert(schema.characters)
		.values(
			["Brannoc", "Verity"].map((n) => ({
				userId: ownerId,
				name: `${n} ${tag}`,
				description: n,
				isPersona: false
			}))
		)
		.returning()
	const gm = await row(sessionId, {
		role: "user",
		content: `We go in ${tag}.`
	})
	const plan = await row(sessionId, {
		role: "assistant",
		channel: "sanctum",
		content: "The plan."
	})
	const roll = await row(sessionId, {
		role: "assistant",
		content: "Roll for it."
	})
	await runOf(sessionId, `${tag}-plan`, "core:spec/lair-reply", [
		plan.id,
		roll.id
	])
	const dice = await row(sessionId, {
		role: "assistant",
		content: "A 14.",
		metadata: { answersForm: { messageId: roll.id } }
	})
	await runOf(sessionId, `${tag}-dice`, "core:spec/lair-reply", [dice.id])
	const brannoc = await row(sessionId, {
		role: "assistant",
		characterId: a!.id,
		content: "Brannoc.",
		metadata: { planRowId: plan.id }
	})
	await runOf(sessionId, `${tag}-b`, "core:spec/lair-reply", [brannoc.id])
	await row(sessionId, {
		role: "user",
		content: "I hold the lamp.",
		metadata: { speaker: "player-seat:2" }
	})
	const verity = await row(sessionId, {
		role: "assistant",
		characterId: b!.id,
		content: "Verity.",
		metadata: { planRowId: plan.id }
	})
	await runOf(sessionId, `${tag}-v`, "core:spec/lair-reply", [verity.id])
}

async function storyTurn(sessionId: number, tag: string) {
	await row(sessionId, { role: "user", content: `Hello ${tag}.` })
	await row(sessionId, { role: "assistant", content: `Ash nods ${tag}.` })
	await row(sessionId, {
		role: "user",
		userId: guestId,
		content: `Me too ${tag}.`
	})
	await row(sessionId, { role: "assistant", content: `Birch waves ${tag}.` })
}

/** Statements the test database ran while `fn` ran. */
async function counting<T>(fn: () => Promise<T>) {
	const client = (db as any).$client
	const orig = client.query
	let n = 0
	client.query = function (...a: any[]) {
		n++
		return orig.apply(this, a)
	}
	try {
		return { value: await fn(), statements: n }
	} finally {
		client.query = orig
	}
}

async function worlds() {
	const lair = await session("core:genre/lair", true)
	await plannedTurn(lair.id, "one")
	const story = await session(undefined, false)
	await row(story.id, {
		role: "assistant",
		content: "Welcome.",
		metadata: { isGreeting: true }
	})
	await row(story.id, {
		role: "system",
		channel: "main",
		content: "Time passes: 1 hour."
	})
	await storyTurn(story.id, "one")
	return { lair: lair.id, story: story.id }
}

/** The rewind state of each world as the two verdicts gave it when each read its own set, frozen; `throughId` is the newest inserted row. */
const FROZEN = {
	lair: {
		ahead: 0,
		back: null,
		forward: "There is nothing ahead to bring back.",
		regenerate: null,
		step: "turn",
		backTakes: {
			count: 4,
			names: ["Castellan", "Brannoc one", "Verity one"],
			personLines: 2
		}
	},
	story: {
		ahead: 0,
		back: null,
		forward: "There is nothing ahead to bring back.",
		regenerate:
			"The newest message did not come from a turn, so there is no turn to regenerate.",
		step: "message",
		backTakes: {
			count: 1,
			names: ["Narrator"],
			newestMessage: { author: "Narrator", yours: false, filed: 0 }
		}
	}
}

async function newestRowId(sid: number) {
	const [r] = await db
		.select({ id: schema.sessionMessages.id })
		.from(schema.sessionMessages)
		.where(eq(schema.sessionMessages.sessionId, sid))
		.orderBy(desc(schema.sessionMessages.id))
		.limit(1)
	return r!.id
}

async function expected(world: "lair" | "story", sid: number) {
	return {
		...FROZEN[world],
		backTakes: {
			...FROZEN[world].backTakes,
			throughId: await newestRowId(sid)
		}
	}
}

describe("rewindStateOf reads what both verdicts share once", () => {
	it("equals the state the two verdicts gave when each read its own set", async () => {
		const { rewindStateOf } = await import("$lib/server/sessions/rewind")
		const w = await worlds()
		for (const world of ["lair", "story"] as const) {
			const state = JSON.parse(
				JSON.stringify(await rewindStateOf(db as any, w[world]))
			)
			expect(state).toStrictEqual(await expected(world, w[world]))
		}
	})

	it("a guest's pushed rewind equals the owner's and the frozen state", async () => {
		const { buildSessionActions } = await import(
			"$lib/server/sockets/sessions.pipelines"
		)
		const w = await worlds()
		for (const world of ["lair", "story"] as const) {
			const push = async (uid: number) =>
				JSON.parse(
					JSON.stringify(
						(
							await buildSessionActions(w[world], uid, "main", {
								withRewind: true
							})
						).rewind
					)
				)
			const owner = await push(ownerId)
			const guest = await push(guestId)
			expect(guest).toStrictEqual(owner)
			expect(guest).toStrictEqual(await expected(world, w[world]))
		}
	})

	it("issues fewer statements than the two verdicts together", async () => {
		const { rewindStateOf, turnUnitOf } = await import(
			"$lib/server/sessions/rewind"
		)
		const w = await worlds()
		for (const sid of [w.lair, w.story]) {
			await rewindStateOf(db as any, sid) // warm module-level caches
			const two = await counting(async () => {
				await turnUnitOf(db as any, sid, { includePersonLines: true })
				await turnUnitOf(db as any, sid, { includePersonLines: false })
			})
			const state = await counting(() => rewindStateOf(db as any, sid))
			expect(state.statements).toBeLessThan(two.statements)
		}
	})

	it("a write between two checks is seen", async () => {
		const { rewindStateOf, rewindTurn } = await import(
			"$lib/server/sessions/rewind"
		)
		const w = await worlds()
		const before = await rewindStateOf(db as any, w.story)
		expect(before.back).toBeNull()
		expect(before.ahead).toBe(0)
		const reply = await row(w.story, {
			role: "assistant",
			content: "A new reply."
		})
		const after = await rewindStateOf(db as any, w.story)
		expect(after.backTakes?.throughId).toBe(reply.id)
		expect(after.backTakes?.throughId).not.toBe(before.backTakes?.throughId)
		await rewindTurn(db as any, { sessionId: w.story, userId: ownerId })
		const backed = await rewindStateOf(db as any, w.story)
		expect(backed.ahead).toBe(1)
		expect(backed.forward).toBeNull()
		const lair = await rewindStateOf(db as any, w.lair)
		await rewindTurn(db as any, { sessionId: w.lair, userId: ownerId })
		const lairBacked = await rewindStateOf(db as any, w.lair)
		expect(lair.ahead).toBe(0)
		expect(lairBacked.ahead).toBe(1)
		expect(lairBacked.back).not.toBeNull()
	})
})
