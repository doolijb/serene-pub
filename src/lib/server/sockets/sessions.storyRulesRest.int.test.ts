/**
 * 🚧 **Story's Rest beside the rules' own** (PLAN-genres-seams S3, 2026-10-23),
 * on a real Story session: when the session's rules use an invokable
 * `core:function/rest@1`, the host publishes it (`rules.invokable`), Story's
 * own Rest — registered `when` the rules offer none — leaves the composer,
 * and the rules action *Rest* is offered instead; a press of it through
 * `fireAction` runs Full (★ M1: an action registration carries no mode) and
 * brings back what the rules tag `resource`. Under rules with no Rest of
 * their own, Story's Rest is offered as it always was.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

let db: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "story-rules-rest-test-secret" }
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
	emitToUserRedacted: async () => {},
	broadcastToSessionUsers: async () => {}
}))

/** A ruleset with a pool it tags `resource` and core's Rest — the rules offer their own. */
const RESTFUL = "test:ruleset/story-rest-int@1"

let ownerId: number
const fakeSocket = (uid: number) => ({ user: { id: uid, isAdmin: false }, io: quietIo() }) as any
const emit = () => {}
function quietIo() {
	return {
		sockets: { adapter: { rooms: { get: () => undefined } }, sockets: { get: () => undefined, values: () => [].values() } },
		to: () => ({ emit: () => {} })
	}
}
async function settle() {
	await (await import("$lib/server/pipelines/runtime/sessionEvents")).settleSessionEvents()
}

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-story-rules-rest-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(db)
	const { createTestUser } = await import("$lib/server/utils/testDb")
	ownerId = (await createTestUser(db, "story-rules-rest-owner")).id
	const { defineRuleset } = await import("@serene-pub/sdk")
	const { restFunction } = await import("@serene-pub/core-catalog")
	defineRuleset(RESTFUL, {
		name: { en: "Restful" },
		attributes: [
			{
				id: "energy",
				name: { en: "Energy" },
				kind: "pool",
				bounds: { max: 10 },
				start: 4,
				carriedBy: ["cast"],
				tags: ["resource"],
				prose: "Energy: what someone has left, 0 to 10."
			}
		],
		functions: [{ ref: restFunction.id, key: "rest", options: { rest: "night" } }],
		// 🚧 GM 2026-10-23 (G1 ★5): a night's rest takes eight hours — what Story's After a rest moves the clock by.
		time: { unit: "minute", rests: [{ id: "night", label: { en: "A night's rest" }, minutes: 480 }] }
	} as any)
}, 180_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {})
})

async function presetId(seedKey: string) {
	const [p] = await db.select({ id: schema.sessionPresets.id }).from(schema.sessionPresets).where(eq(schema.sessionPresets.seedKey, seedKey))
	return p!.id
}

/** A Living Story session with one character and the owner's persona, on `ruleset`. */
async function storySession(name: string, ruleset: string) {
	const [ch] = await db.insert(schema.characters).values({ userId: ownerId, name: `${name} Ash`, description: "A traveller.", isPersona: false }).returning()
	const [me] = await db.insert(schema.characters).values({ userId: ownerId, name: `${name} Wren`, description: "Me.", isPersona: true }).returning()
	const { sessionsCreateHandler } = await import("$lib/server/sockets/sessions")
	const res: any = await sessionsCreateHandler.handler(
		fakeSocket(ownerId),
		{ session: { name, presetId: await presetId("core-story-living") }, characterIds: [ch!.id], personaIds: [me!.id], characterPositions: {}, tags: [] } as any,
		emit
	)
	expect(res?.error, res?.error).toBeUndefined()
	await settle()
	const sessionId = res.session.id as number
	await db.update(schema.sessions).set({ primaryRuleset: ruleset }).where(eq(schema.sessions.id, sessionId))
	return { sessionId, persona: me!.id }
}

/** The composer's actions, by identity. */
async function composer(sessionId: number): Promise<string[]> {
	const { listSessionActions } = await import("$lib/server/pipelines/entities/sessionActions")
	const venues = await listSessionActions(db as any, sessionId, { userId: ownerId })
	const c = (venues as any).composer
	return [...c.primary, ...c.overflow].map((a: any) => `${a.specSlug}#${a.key}`)
}

describe("Story's Rest and the rules' own (S3)", () => {
	it("rules with no Rest of their own: Story's Rest is offered, and nothing is published", async () => {
		const { sessionId } = await storySession("plain", "core:ruleset/freeform@1")
		const { publishedValues } = await import("$lib/server/pipelines/entities/publishedValues")
		expect((await publishedValues(db as any, sessionId)).rules).toEqual({ invokable: {} })
		const ids = await composer(sessionId)
		expect(ids).toContain("core:spec/story-rest#rest")
		expect(ids.filter((i) => i.startsWith("core:spec/rules-action#"))).toEqual([])
	}, 60_000)

	it("rules that offer Rest: the rules action is offered instead, never two; a press runs Full and brings back what they tag resource", async () => {
		const { sessionId, persona } = await storySession("restful", RESTFUL)
		const { rulesInvokableSegment } = await import("@serene-pub/sdk")
		const { restFunction } = await import("@serene-pub/core-catalog")
		const { publishedValues } = await import("$lib/server/pipelines/entities/publishedValues")
		expect((await publishedValues(db as any, sessionId)).rules.invokable).toEqual({ [rulesInvokableSegment(restFunction.id)]: true })
		const ids = await composer(sessionId)
		expect(ids).toContain("core:spec/rules-action#rest")
		expect(ids, "Story's Rest steps aside").not.toContain("core:spec/story-rest#rest")
		// The door says the same: Story's Rest is refused, not run.
		const { fireAction } = await import("$lib/server/pipelines/runtime/fireAction")
		const refused: any = await fireAction(db as any, { sessionId, action: "core:spec/story-rest#rest", actor: { userId: ownerId }, io: quietIo() as any })
		expect(refused).toEqual({ kind: "refused", error: "This session's rules offer their own." })

		// The persona's energy, spent down, then the rules' Rest pressed from the composer.
		const { stateFor } = await import("$lib/server/state/resolve")
		const energyOf = async () => (((await stateFor(db as any, sessionId)).cast.byId as Record<string, Record<string, unknown>>)[String(persona)] ?? {})["energy"]
		const { resolveRulesetTurn } = await import("$lib/server/rulesets/resolve")
		const spent: any = await resolveRulesetTurn(db as any, {
			scope: { sessionId },
			owners: [`character:${persona}`],
			deltas: [{ owner: `character:${persona}`, attribute: "energy", op: "spend", value: 6, reason: "a long day" }],
			mode: "apply"
		})
		expect(spent.halt, spent.halt).toBeUndefined()
		const tired = await energyOf()
		expect(typeof tired === "number" && tired < 10, `energy spent down (${String(tired)})`).toBe(true)
		// 🚧 Routines run here only when a test turns them on: Story's After a rest answers the rules' `rest-taken`.
		const { setRoutinesEnabled } = await import("$lib/server/pipelines/routines/runs")
		setRoutinesEnabled(true)
		const out: any = await fireAction(db as any, {
			sessionId,
			action: "core:spec/rules-action#rest",
			payload: { rest: "night" },
			actor: { userId: ownerId },
			io: quietIo() as any
		})
			// A settle waits on the routines' drains too (the routine runtime's).
			.then(async (o) => {
				await settle()
				return o
			})
			.finally(() => setRoutinesEnabled(false))
		expect(out.kind, JSON.stringify(out)).not.toBe("refused")
		await settle()
		const [run] = await db
			.select({ specSlug: schema.pipelineRuns.specSlug, outcome: schema.pipelineRuns.outcome, receipt: schema.pipelineRuns.receipt })
			.from(schema.pipelineRuns)
			.where(eq(schema.pipelineRuns.sessionId, sessionId))
			.orderBy(schema.pipelineRuns.id)
			.then((rows) => rows.filter((r) => r.specSlug === "core:spec/rules-action"))
		expect(run, "the rules action ran").toBeTruthy()
		expect(run!.outcome).toBe("ok")
		// Full (★ M1): applied, never held — the commit's apply arm, no proposal.
		const nodes = ((run!.receipt as any)?.nodes ?? []) as any[]
		expect(nodes.map((n) => n.key ?? n.nodeKey)).toContain("commit.applied.apply")
		expect(await energyOf()).toBe(10)
		// 🚧 GM 2026-10-23 (G1 ★5, S3): Story's After a rest ran on the rules' `rest-taken` and asked the
		// story clock to move by the rest they raised — eight hours, in minutes, as a keeper's move. (No
		// lorebook here, so the clock itself skips with its sentence rather than halting.)
		const after = await db
			.select({ specSlug: schema.pipelineRuns.specSlug, outcome: schema.pipelineRuns.outcome, receipt: schema.pipelineRuns.receipt })
			.from(schema.pipelineRuns)
			.where(eq(schema.pipelineRuns.sessionId, sessionId))
			.then((rows) => rows.filter((r) => r.specSlug === "core:spec/story-after-rest"))
		expect(after.length, "Story's After a rest ran once").toBe(1)
		expect(after[0]!.outcome).toBe("ok")
		const afterNodes = ((after[0]!.receipt as any)?.nodes ?? []) as any[]
		const step = afterNodes.find((n) => (n.key ?? n.nodeKey) === "step")
		expect(step?.output).toMatchObject({ moves: true, by: 480, unit: "minutes" })
		const advance = afterNodes.find((n) => (n.key ?? n.nodeKey) === "clock.moves.advance")
		expect(advance?.input).toMatchObject({ by: 480, unit: "minutes", cause: "keeper", onRefusal: "skip" })
	}, 120_000)
})
