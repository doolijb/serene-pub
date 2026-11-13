/**
 * 🚧 ⏳ S4 wave 3 (plan §34.1): `writeOutcome`'s `ctxFor`. Switch on, a carded
 * player seat's values live under `player_seat` where they were
 * `session_cast`, so its changes file with the session context (no turn
 * anchor), as `session_cast` did; a card-less player seat keeps the anchor.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import "@serene-pub/core-catalog"
import type { TestDb } from "$lib/server/utils/testDb"
import { declareTrial, HP, TRIAL } from "./trialRuleset.testkit"
import { genreKeeping } from "$lib/server/utils/testGenre"
import { memberFormSwitch } from "$lib/server/state/memberForm"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let db: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
})

const GENRE = "test:genre/rulesets-ctx"

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-rulesCtx-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	const { slots } = declareTrial()
	genreKeeping(GENRE, { name: { en: "Rulesets ctx" }, family: "test", slots: [...slots], events: {} })
}, 60_000)

afterAll(async () => {
	memberFormSwitch.on = false
	await fs.rm(dataDir, { recursive: true, force: true })
})

afterEach(() => {
	memberFormSwitch.on = false
})

let n = 0
async function world() {
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(db, `rulesets-ctx-${suffix}`)
	const [persona] = await db
		.insert(schema.characters)
		.values({ userId: user.id, name: `Wren ${suffix}`, description: "A scout." })
		.returning()
	const [session] = await db
		.insert(schema.sessions)
		.values({ userId: user.id, isGroup: true, name: `Run ${suffix}`, genreId: GENRE, primaryRuleset: TRIAL, rigour: "mechanics" })
		.returning()
	const [message] = await db.insert(schema.messages).values({ sessionId: session!.id, role: "character" }).returning()
	const [carded] = await db
		.insert(schema.sessionPersonas)
		.values({ sessionId: session!.id, userId: user.id, personaId: persona!.id, position: 0 })
		.returning()
	const [cardless] = await db
		.insert(schema.sessionPersonas)
		.values({ sessionId: session!.id, userId: user.id, personaId: null, seatName: "Drifter", position: 1 } as any)
		.returning()
	return { session: session!, message: message!, carded: carded!, cardless: cardless! }
}

/** The review a refused `set` of the seat's hp files, and where it is anchored. */
async function reviewOf(w: Awaited<ReturnType<typeof world>>, seatId: number) {
	const { resolveRulesetTurn } = await import("./resolve")
	const { seededRandom } = await import("$lib/server/state/expressions")
	const res = await resolveRulesetTurn(
		db as any,
		{
			owners: [`session:${w.session.id}`, `player-seat:${seatId}`],
			mode: "apply",
			deltas: [{ owner: `player-seat:${seatId}`, slot: "hp", op: "set", value: 14, reason: "healed" }]
		},
		{ random: seededRandom("ctx"), runId: "ctx", turnMessageId: w.message.id }
	)
	if ("halt" in res) throw new Error(res.halt)
	const filed = res.ok.rejected.find((r) => r.proposalId != null)
	expect(filed, "the refused set is filed for review").toBeTruthy()
	const [proposal] = await db.select().from(schema.stateProposals).where(eq(schema.stateProposals.id, filed!.proposalId!))
	expect(proposal!.payload).toMatchObject({ slotId: HP })
	return proposal!
}

describe("ctxFor, switch on", () => {
	test("a carded player seat files with the session context (no turn anchor)", async () => {
		const w = await world()
		memberFormSwitch.on = true
		const proposal = await reviewOf(w, w.carded.id)
		expect(proposal.messageId).toBeNull()
	})

	test("a card-less player seat still files anchored to the turn", async () => {
		const w = await world()
		memberFormSwitch.on = true
		const proposal = await reviewOf(w, w.cardless.id)
		expect(proposal.messageId).toBe(w.message.id)
	})
})
