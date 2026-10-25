/**
 * `pipelines:document` — the canvas tab's read (PLAN-pipeline-canvas-and-genre-authoring P1).
 *
 * Admin-only like `pipelines:detail`, and scoped to the slug it was asked for:
 * a version id that belongs to another spec is "no such version", never
 * served, so a slug cannot be used as a key to read across specs.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { LAIR_REPLY_SPEC_ID, STORY_RESPOND_SPEC_ID } from "@serene-pub/core-catalog"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "socket-document-test-secret" }
})

let stranger: { id: number }
let admin: { id: number }

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-pipelines-document-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(testDb as any)
	const { createTestUser } = await import("$lib/server/utils/testDb")
	stranger = await createTestUser(testDb, "doc-stranger")
	admin = await createTestUser(testDb, "doc-admin")
	await testDb
		.update(schema.users)
		.set({ isAdmin: true })
		.where(eq(schema.users.id, admin.id))
}, 120_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const socketFor = (userId: number, isAdmin = false) =>
	({
		user: { id: userId, isAdmin },
		io: { to: () => ({ emit: () => {} }) }
	}) as any

function recordingEmit() {
	const seen: Array<[string, any]> = []
	const emit = (event: string, data: any) => seen.push([event, data])
	return {
		emit,
		seen,
		last: (e: string) => seen.filter(([k]) => k === e).at(-1)?.[1]
	}
}

describe("pipelines:document", () => {
	test("a non-admin is refused before any row is read", async () => {
		const { pipelinesDocument } = await import("./pipelines")
		const rec = recordingEmit()
		const res: any = await pipelinesDocument.handler(
			socketFor(stranger.id),
			{ slug: STORY_RESPOND_SPEC_ID },
			rec.emit
		)
		expect(res.error).toMatch(/admin/i)
		expect(res.document).toBeUndefined()
		expect(rec.last("pipelines:document:error")?.error).toMatch(/admin/i)
	}, 60_000)

	test("an admin gets the active version as a document, with clauses and edges", async () => {
		const { pipelinesDocument } = await import("./pipelines")
		const rec = recordingEmit()
		const res: any = await pipelinesDocument.handler(
			socketFor(admin.id, true),
			{ slug: STORY_RESPOND_SPEC_ID },
			rec.emit
		)
		expect(res.error).toBeUndefined()
		expect(res.version.isActive).toBe(true)
		expect(res.version.canonicalHash).toBeTruthy()
		expect(res.document.id).toBe(STORY_RESPOND_SPEC_ID)
		expect(res.document.nodes.length).toBeGreaterThan(20)
		// Story's reply gathers and forks (plan §1); its iterating tail (the
		// reckoning and the sweep) left it for routines (PLAN-layering lane 3).
		const kinds = new Set(res.document.clauses.map((c: any) => c.kind))
		expect(kinds.has("gather")).toBe(true)
		expect(kinds.has("junction")).toBe(true)
		// Edges carry their ports — the half `pipelines:detail`'s graph drops.
		expect(res.document.edges.every((e: any) => e.toPort)).toBe(true)
		// A clause member names its clause and chain.
		const member = res.document.nodes.find(
			(n: any) => n.key === "gather.history.read"
		)
		expect(member?.clauseId).toBe("gather")
		expect(member?.clauseChain).toBe("history")
		// It also reaches the socket's listeners.
		expect(rec.last("pipelines:document")?.document?.id).toBe(
			STORY_RESPOND_SPEC_ID
		)
	}, 60_000)

	test("a version of another spec is 'no such version', not served", async () => {
		const { pipelinesDocument } = await import("./pipelines")
		const [story] = await testDb
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, STORY_RESPOND_SPEC_ID))
			.limit(1)
		const res: any = await pipelinesDocument.handler(
			socketFor(admin.id, true),
			{
				slug: LAIR_REPLY_SPEC_ID,
				versionId: story!.activeVersionId!
			},
			() => {}
		)
		expect(res.error).toMatch(/no version/i)
		expect(res.document).toBeUndefined()
	}, 60_000)

	test("an unknown slug is a sentence, not a throw", async () => {
		const { pipelinesDocument } = await import("./pipelines")
		const res: any = await pipelinesDocument.handler(
			socketFor(admin.id, true),
			{ slug: "core:spec/does-not-exist" },
			() => {}
		)
		expect(res.error).toMatch(/no pipeline called/i)
	}, 60_000)
})
