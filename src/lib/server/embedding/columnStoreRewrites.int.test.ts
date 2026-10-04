/**
 * Writes that copy, restore or re-save text a vector was already computed
 * over — and so must not pay for it again (lorebooks plan A9 follow-up, the
 * W1-embed review). Counted, not inferred: every case drains the queue's own
 * picker and counts the `embed()` calls.
 *
 *  · a session branch copies each message with its vector: the copy's text is
 *    the original's, so is its `embed_text_hash`;
 *  · an edit whose text differs only by edge whitespace stores the same text
 *    (the store trims a committed body), so the vector stays;
 *  · a reply still streaming is not embedded until it settles — every chunk
 *    would otherwise buy an embed the freshness guard then throws away;
 *  · a cast merge changes neither the survivor's name nor its summary (the
 *    absorbed names go to `absorbed_aliases`, which are not embedded);
 *  · an undo of that merge puts the absorbed member and its deleted edges back
 *    with the vectors their snapshot carried, which the text hash vouches for.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq, sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { releaseDataDir, type TestDb } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async (orig) => {
	const actual = (await orig()) as any
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { ...actual, db }
})

/** Every text handed to the embedding model, in order. */
const embedded: string[] = []
/** Runs inside each `embed()`, while it is in flight. */
const inFlight: { run: null | (() => Promise<void>) } = { run: null }
vi.mock("$lib/server/embedding/index", async (orig) => {
	const actual = (await orig()) as any
	return {
		...actual,
		embed: async (text: string) => {
			embedded.push(text)
			if (inFlight.run) await inFlight.run()
			return [1, 0, 0]
		},
		getLoadedModelId: () => "test-model",
		isModelReady: () => true
	}
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-column-store-rewrites-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(testDb as any)
}, 180_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

/**
 * Run the queue's picker to exhaustion and return the texts it paid for.
 * Bounded, so a row the guard keeps refusing fails the test instead of
 * hanging it.
 */
async function paidFor(): Promise<string[]> {
	const { pickNextItem } = await import("./vectorizationQueue")
	embedded.length = 0
	for (let i = 0; i < 50; i++) {
		const item = await pickNextItem("test-model")
		if (!item) return [...embedded]
		await item.process()
	}
	throw new Error(`the queue never ran dry: ${embedded.join(" | ")}`)
}

const fakeSocket = (userId: number) =>
	({
		user: { id: userId, isAdmin: true },
		server: { to: () => ({ emit: () => {} }) }
	}) as any

let userId: number
let sessionId: number
let greeting: number
let reply: number

beforeAll(async () => {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	userId = (await createTestUser(testDb, "column-store-rewrites")).id
	;[{ id: sessionId }] = await testDb
		.insert(schema.sessions)
		.values({ userId, isGroup: false } as any)
		.returning()
	;[{ id: greeting }, { id: reply }] = await testDb
		.insert(schema.sessionMessages)
		.values([
			{
				sessionId,
				role: "user",
				content: "We walk to the ford.",
				userId
			},
			{ sessionId, role: "assistant", content: "Hello, traveller." }
		] as any)
		.returning()
	expect(await paidFor()).toHaveLength(2)
}, 120_000)

describe("session messages", () => {
	it("branching a session copies each message's vector with its text: no embed", async () => {
		const { branchSession } = await import("$lib/server/sessions/branch")
		const branch = await branchSession(testDb as any, {
			sessionId,
			fromMessageId: reply
		})
		const copies = await testDb
			.select({ embedding: schema.sessionMessages.embedding })
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.sessionId, branch.id))
		expect(copies).toHaveLength(2)
		expect(copies.every((c) => c.embedding != null)).toBe(true)
		expect(await paidFor()).toEqual([])
	}, 60_000)

	it("an edit that adds only edge whitespace stores the same text and keeps the vector", async () => {
		const { runBuiltIn } = await import(
			"$lib/server/pipelines/runtime/builtins"
		)
		await runBuiltIn(
			testDb as any,
			{
				kind: "edit",
				sessionId,
				actor: userId,
				payload: { target: reply, text: "Hello, traveller.\n" }
			} as any
		)
		const [row] = await testDb
			.select({
				content: schema.sessionMessages.content,
				embedding: schema.sessionMessages.embedding
			})
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.id, reply))
		expect(row!.content).toBe("Hello, traveller.")
		expect(row!.embedding).not.toBeNull()
		expect(await paidFor()).toEqual([])
	}, 60_000)

	it("an edit of the words drops the vector and costs one embed, of the new text", async () => {
		const { runBuiltIn } = await import(
			"$lib/server/pipelines/runtime/builtins"
		)
		await runBuiltIn(
			testDb as any,
			{
				kind: "edit",
				sessionId,
				actor: userId,
				payload: { target: reply, text: "  Well met, traveller. " }
			} as any
		)
		const [row] = await testDb
			.select({ embedding: schema.sessionMessages.embedding })
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.id, reply))
		expect(row!.embedding).toBeNull()
		expect(await paidFor()).toEqual(["Well met, traveller."])
	}, 60_000)

	it("a reply still streaming is not embedded; it costs one embed once it settles", async () => {
		const [{ id: live }] = await testDb
			.insert(schema.sessionMessages)
			.values({
				sessionId,
				role: "assistant",
				content: "The",
				isGenerating: true
			} as any)
			.returning()
		// The stream persists a chunk while any embed is in flight.
		inFlight.run = () =>
			testDb
				.update(schema.sessionMessages)
				.set({
					content: sql`${schema.sessionMessages.content} || ' word'`
				} as any)
				.where(
					and(
						eq(schema.sessionMessages.id, live),
						eq(schema.sessionMessages.isGenerating, true)
					)
				)
				.then(() => {})
		try {
			expect(await paidFor()).toEqual([])
			const { ensureSessionMessageEmbedded } = await import(
				"./vectorizationQueue"
			)
			embedded.length = 0
			await ensureSessionMessageEmbedded(live)
			expect(embedded).toEqual([])
		} finally {
			inFlight.run = null
		}
		await testDb
			.update(schema.sessionMessages)
			.set({ content: "The ferry is late.", isGenerating: false })
			.where(eq(schema.sessionMessages.id, live))
		expect(await paidFor()).toEqual(["The ferry is late."])
	}, 60_000)
})

describe("a cast merge and its undo", () => {
	let bookId: number
	let alder: number
	let woodcutter: number

	beforeAll(async () => {
		// Settle whatever the cases above left, so the count below is this
		// book's alone.
		await paidFor()
		;[{ id: bookId }] = await testDb
			.insert(schema.lorebooks)
			.values({ name: "Merge Book", userId })
			.returning()
		;[{ id: alder }, { id: woodcutter }] = await testDb
			.insert(schema.lorebookBindings)
			.values([
				{
					lorebookId: bookId,
					binding: "{{char:1}}",
					name: "Alder",
					summary: "A tree spirit."
				},
				{
					lorebookId: bookId,
					binding: "{{char:2}}",
					name: "The woodcutter",
					summary: "Fells the old oaks."
				}
			] as any)
			.returning()
		// An edge between the two: the merge would make it a loop, so it is
		// deleted — and the undo puts it back.
		await testDb.insert(schema.narrativeRelationships).values({
			lorebookId: bookId,
			fromNodeId: woodcutter,
			toNodeId: alder,
			relationshipType: "fears",
			description: "Keeps clear of the grove."
		} as any)
		expect((await paidFor()).sort()).toEqual(
			[
				"Alder\nA tree spirit.",
				"The woodcutter\nFells the old oaks.",
				"The woodcutter fears Alder: Keeps clear of the grove."
			].sort()
		)
	}, 60_000)

	const vectorOf = async (id: number) =>
		(
			await testDb
				.select({
					embedding: schema.lorebookBindings.embedding,
					embeddingModel: schema.lorebookBindings.embeddingModel
				})
				.from(schema.lorebookBindings)
				.where(eq(schema.lorebookBindings.id, id))
		)[0]

	it("a merge keeps the survivor's vector: its name and summary do not change", async () => {
		const { narrativeGraphMergeNodeHandler } = await import(
			"$lib/server/sockets/narrativeGraph"
		)
		await narrativeGraphMergeNodeHandler.handler(
			fakeSocket(userId),
			{ nodeId: woodcutter, parentNodeId: alder },
			() => {}
		)
		expect((await vectorOf(alder))?.embedding).not.toBeNull()
		expect(await paidFor()).toEqual([])
	}, 60_000)

	it("its undo restores the member and the edge with their vectors: no embed, and nothing a re-star would clear", async () => {
		const [log] = await testDb
			.select({ id: schema.bindingMergeLogs.id })
			.from(schema.bindingMergeLogs)
			.where(eq(schema.bindingMergeLogs.survivorId, alder))
		const { narrativeGraphUndoMergeHandler } = await import(
			"$lib/server/sockets/narrativeGraph"
		)
		await narrativeGraphUndoMergeHandler.handler(
			fakeSocket(userId),
			{ mergeLogId: log!.id },
			() => {}
		)
		const [restored] = await testDb
			.select({ id: schema.lorebookBindings.id })
			.from(schema.lorebookBindings)
			.where(
				and(
					eq(schema.lorebookBindings.lorebookId, bookId),
					eq(schema.lorebookBindings.name, "The woodcutter")
				)
			)
		expect(await vectorOf(restored!.id)).toMatchObject({
			embeddingModel: "test-model"
		})
		expect((await vectorOf(restored!.id))?.embedding).not.toBeNull()
		const edges = await testDb
			.select({ embedding: schema.narrativeRelationships.embedding })
			.from(schema.narrativeRelationships)
			.where(eq(schema.narrativeRelationships.lorebookId, bookId))
		expect(edges).toHaveLength(1)
		expect(edges[0]!.embedding).not.toBeNull()
		// Every vector carries its model, so a re-star of this one clears none.
		const { countEmbeddedRows } = await import("./vectors")
		expect(
			await countEmbeddedRows(testDb as any, {
				keepModels: ["test-model"]
			})
		).toBe(0)
		expect(await paidFor()).toEqual([])
	}, 60_000)
})
