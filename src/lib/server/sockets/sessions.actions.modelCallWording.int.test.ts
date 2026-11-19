/**
 * A press whose run ended at a model call: a non-administrator reads the plain
 * sentence and the suggestion, never the adapter's message, and no step name;
 * every other halt keeps its text for everyone.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

const REASON =
	"KoboldCPP API error at http://10.0.0.5:5001/api/v1/generate: model 'mistral-7b.Q4_K_M.gguf' not loaded (respond.generate)"
const NODE_KEY = "respond.generate"
const PLAIN = "The action could not finish. An administrator can see the details."

const next = vi.hoisted(() => ({ receipt: null as any }))
vi.mock("$lib/server/pipelines/runtime/fireAction", async (importOriginal) => {
	const actual = await importOriginal<any>()
	return {
		...actual,
		fireAction: vi.fn(async () => ({
			kind: "ran",
			runId: "run-1",
			specId: "core:spec/x",
			receipt: next.receipt
		}))
	}
})

const progress: any[] = []

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-model-call-wording-int-test-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

async function sessionFor(tag: string) {
	const schema = await import("$lib/server/db/schema")
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const owner = await createTestUser(testDb, `${tag}-owner`)
	const guest = await createTestUser(testDb, `${tag}-guest`)
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId: owner.id, isGroup: false, genreId: "core:genre/story" })
		.returning()
	await testDb.insert(schema.sessionGuests).values({ sessionId: session.id, userId: guest.id })
	return { owner, guest, session }
}

const receipt = (
	outcome: "err" | "halt",
	nodes: unknown[],
	haltReason: string,
	extra: Record<string, unknown> = {}
) => ({
	runId: "run-1",
	specId: "core:spec/x",
	outcome,
	haltReason,
	haltNodeKey: (nodes[0] as any).nodeKey,
	nodes,
	...extra
})

async function press(userId: number, isAdmin: boolean, sessionId: number) {
	const { sessionsFireActionHandler } = await import("./sessions")
	progress.length = 0
	const res = await sessionsFireActionHandler.handler(
		{ user: { id: userId, isAdmin }, io: { to: () => ({ emit: () => {} }) } } as any,
		{ sessionId, action: "core:spec/x#go" },
		(event: string, data: any) => {
			if (event === "pipelines:progress") progress.push(data)
		}
	)
	return { res, terminal: progress.find((p) => p.done) }
}

describe("fireAction: a model call's failure", () => {
	test("owner and guest read the plain sentence, no reason, no step name; an administrator reads the reason", async () => {
		const { owner, guest, session } = await sessionFor("model-call")
		next.receipt = receipt(
			"err",
			[{ nodeKey: NODE_KEY, kind: "oracle", result: "err", definitionId: "d", seq: 1 }],
			REASON
		)
		for (const who of [owner, guest]) {
			const { res, terminal } = await press(who.id, false, session.id)
			expect(res.error).toBe(PLAIN)
			expect(terminal.error).toBe(PLAIN)
			expect(terminal.haltNodeKey).toBeUndefined()
			expect(terminal.haltStep).toBeUndefined()
			expect(JSON.stringify([res, terminal])).not.toMatch(/10\.0\.0\.5|gguf|respond\.generate/)
		}
		const admin = await press(owner.id, true, session.id)
		expect(admin.res.error).toBe(REASON)
		expect(admin.terminal.error).toBe(REASON)
	}, 60_000)

	test("a halt marked for people reads the same for everyone: review rejection, seat name, owner-only rules", async () => {
		const { owner, guest, session } = await sessionFor("member-fixable")
		const cases: Array<[string, any, Record<string, unknown>]> = [
			[
				"rejected at review",
				{ nodeKey: NODE_KEY, kind: "oracle", result: "halt" },
				{ reviews: [{ action: "reject", nodeKey: NODE_KEY }] }
			],
			[
				"That name is taken by another seat.",
				{ nodeKey: "save", kind: "effect", result: "err" },
				{ meta: { peopleSentence: "That name is taken by another seat." } }
			],
			[
				"Only the session's owner can change its rules.",
				{ nodeKey: "rules", kind: "effect", result: "err" },
				{ meta: { peopleSentence: "Only the session's owner can change its rules." } }
			]
		]
		for (const [reason, node, extra] of cases) {
			next.receipt = receipt(
				node.result === "halt" ? "halt" : "err",
				[{ definitionId: "d", seq: 1, ...node }],
				reason,
				extra
			)
			for (const [who, isAdmin] of [[owner, false], [guest, false], [owner, true]] as const) {
				const { res, terminal } = await press(who.id, isAdmin, session.id)
				expect(res.error).toBe(reason)
				expect(terminal.error).toBe(reason)
				expect(terminal.haltNodeKey).toBeUndefined()
				expect(terminal.haltStep).toBeUndefined()
			}
		}
	}, 60_000)

	test("a wiring halt naming a step and a spec: owner and guest read the plain sentence, no step; an administrator reads the reason", async () => {
		const { owner, guest, session } = await sessionFor("wiring")
		const wiring = "assemble: no published version of 'core:spec/x'"
		next.receipt = receipt(
			"halt",
			[{ nodeKey: "assemble", kind: "effect", result: "halt", definitionId: "d", seq: 1 }],
			wiring
		)
		for (const who of [owner, guest]) {
			const { res, terminal } = await press(who.id, false, session.id)
			expect(res.error).toBe("The action could not finish. An administrator can see the details.")
			expect(terminal.error).toBe(res.error)
			expect(terminal.haltNodeKey).toBeUndefined()
			expect(terminal.haltStep).toBeUndefined()
		}
		const admin = await press(owner.id, true, session.id)
		expect(admin.res.error).toBe(wiring)
		expect(admin.terminal.error).toBe(wiring)
		expect(admin.terminal.haltNodeKey).toBe("assemble")
	}, 60_000)

	test("an embedding that failed and recovered, then a refusal: the refusal reaches the sender unchanged", async () => {
		const { owner, session } = await sessionFor("recovered")
		const reason = "You can only send messages with personas you own."
		next.receipt = receipt(
			"err",
			[
				{ nodeKey: "embed", kind: "oracle", result: "err", recoveredAsEmpty: true, definitionId: "d", seq: 1 },
				{ nodeKey: "save", kind: "effect", result: "err", definitionId: "d", seq: 2 }
			],
			"embedding service at http://10.0.0.5:5001 is down"
		)
		next.receipt.haltReason = reason
		next.receipt.meta = { peopleSentence: reason }
		const { res } = await press(owner.id, false, session.id)
		expect(res.error).toBe(reason)
	}, 60_000)
})
