/**
 * One hop from a place the turn is actually about.
 *
 * ⚠ **The claim is a distance, and only a real turn can make it.** The room is
 * named in the message, so the lore mechanisms choose it; the tunnel is one
 * edge away and comes in behind it; the hall on the tunnel's far side is two
 * edges away and does not. No unit test can assert that: "which entries did the
 * lore mechanisms choose" is the output of the same scan the prompt is built
 * from, and the whole risk of this hop is that it answers that question
 * differently from the lanes that ask it for real.
 *
 * So this starts at rows in a database and ends at the mechanism's own
 * candidates, with the shipped reply spec, the real executor and the real host
 * in between — the same shape as `relationshipSearch.int.test.ts` next door.
 *
 * The fixture has no cast at all, deliberately. A book of places has no speaker
 * node for the graph traversal to walk from, so the cast read answers `null` —
 * and a hop that could not survive that answer would be unreachable in exactly
 * the book it exists for.
 *
 * The hop runs only when the band has a share (plan A2): the session that
 * hops gives `gather.relationships.read` a share of its own, and a second
 * session on the same book runs the shipped share of 0 and must not hop.
 */

import { describe, it, expect, beforeAll, vi } from "vitest"
import { eq } from "drizzle-orm"
import fs from "fs/promises"
import os from "os"
import path from "path"
import type { TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { WORLD_LORE_TYPE_ID } from "$lib/shared/entries/types"
import { run } from "@serene-pub/sdk"
import { coreBindings } from "$lib/server/pipelines/runtime/bindings"
import { createHost } from "$lib/server/pipelines/runtime/host"
import { buildWorld } from "$lib/server/pipelines/config/world"
import { bootstrapPipelines } from "$lib/server/pipelines/boot/bootstrap"
import { respondSpec, CHAT_RESPOND_SPEC_ID } from "$lib/server/pipelines/specs"

// No embedding model: the lore mechanisms stay on the keyword path, which needs
// no network. Nothing here asserts on the semantic one.
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null
}))

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "link-hop-secret" }
})

let db: TestDb
let sessionId: number
/** A session on the same book with the shipped share of 0. */
let shippedSessionId: number
let userId: number

const NEAR = "The Umber Room"
const ONE_HOP = "The Salt Tunnel"
const TWO_HOPS = "The Glass Hall"

/** The mechanism's node in the shipped reply document. */
const GRAPH = "gather.relationships.read"

const MESSAGE = "we push open the door of the umber room"

beforeAll(async () => {
	process.env.SERENE_PUB_DATA_DIR = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-link-hop-")
	)
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	await bootstrapPipelines(db)

	const [user] = await db
		.insert(schema.users)
		.values({ username: "wanderer", isAdmin: false })
		.returning()
	userId = user.id

	const [lorebook] = await db
		.insert(schema.lorebooks)
		.values({ userId, name: "Roads" })
		.returning()

	const [session] = await db
		.insert(schema.sessions)
		.values({ userId, isGroup: true, lorebookId: lorebook.id })
		.returning()
	sessionId = session.id
	const [shipped] = await db
		.insert(schema.sessions)
		.values({ userId, isGroup: true, lorebookId: lorebook.id })
		.returning()
	shippedSessionId = shipped.id

	// The band's share, as this session's own override of the ranked step —
	// the control a person raises (docs: embeddings-and-rag.md).
	const [spec] = await db
		.select({ id: schema.pipelineSpecs.id })
		.from(schema.pipelineSpecs)
		.where(eq(schema.pipelineSpecs.slug, CHAT_RESPOND_SPEC_ID))
	await db.insert(schema.pipelineNodeOverrides).values({
		specId: spec!.id,
		scopeKind: "session",
		scopeId: sessionId,
		nodeKey: GRAPH,
		slot: "params",
		path: "share",
		value: 0.1
	} as any)

	let position = 0
	const place = async (name: string, keys: string[]) =>
		(
			await db
				.insert(schema.lorebookEntries)
				.values({
					lorebookId: lorebook.id,
					typeId: WORLD_LORE_TYPE_ID,
					typeVersion: 1,
					position: ++position,
					title: name,
					keys,
					content: `${name}. Stone, damp, and very quiet.`,
					enabled: true
				})
				.returning()
		)[0]

	// ⚠ Only the room has a key the message can fire. The other two are
	// unreachable by the scan and can be reached by an edge or not at all,
	// which is what makes the distance claim below legible.
	const room = await place(NEAR, ["umber room"])
	const tunnel = await place(ONE_HOP, ["salt tunnel"])
	const hall = await place(TWO_HOPS, ["glass hall"])

	const link = async (fromEntryId: number, toEntryId: number, type: string) =>
		await db.insert(schema.narrativeRelationships).values({
			lorebookId: lorebook.id,
			fromEntryId,
			toEntryId,
			relationshipType: type,
			visibility: "acknowledged" as any,
			status: "active",
			description: ""
		} as any)

	await link(room.id, tunnel.id, "connects to")
	await link(tunnel.id, hall.id, "leads to")

	for (const id of [sessionId, shippedSessionId])
		await db.insert(schema.sessionMessages).values({
			sessionId: id,
			role: "user",
			content: MESSAGE
		} as any)
}, 120_000)

const turn = async (id: number) =>
	await run(respondSpec(), {
		input: {
			text: MESSAGE,
			sessionId: id,
			sessionScope: { sessionId: id, currentCharacterId: null }
		},
		seed: "seed:link-hop",
		bindings: coreBindings(),
		world: await buildWorld(db, { sessionId: id, specId: CHAT_RESPOND_SPEC_ID }),
		host: createHost(db, { sessionId: id, userId }),
		preview: true
	} as any)

let receipt: any
let shippedReceipt: any
beforeAll(async () => {
	receipt = await turn(sessionId)
	shippedReceipt = await turn(shippedSessionId)
}, 120_000)

const nodeOut = (key: string, of: any = receipt) => {
	const node = (of.nodes as any[]).find((n) => n.nodeKey === key)
	expect(node, `${key} is not in the receipt`).toBeTruthy()
	return node.output
}

const hops = (of: any = receipt): any[] =>
	(nodeOut(GRAPH, of)?.main ?? []).filter(
		(c: any) => c?.payload?.via === "link"
	)

describe("the link hop", () => {
	it("brings in the place one edge from the one the turn named", () => {
		expect(hops().map((c) => c.payload.name)).toEqual([ONE_HOP])
	}, 60_000)

	it("says which entry it came from", () => {
		expect(hops()[0]?.payload.linkedFrom).toBe(NEAR)
		expect(hops()[0]?.payload.entry?.type).toBe("connects to")
		expect(hops()[0]?.source).toBe("relationships")
	}, 60_000)

	it("does not take the second hop", () => {
		expect(hops().map((c) => c.payload.name)).not.toContain(TWO_HOPS)
	}, 60_000)

	it("names the hop in its diagnostics", () => {
		const diagnostics = nodeOut(GRAPH)?.diagnostics
		expect(diagnostics?.linked).toBe(1)
		expect(diagnostics?.linkedEntries).toEqual([ONE_HOP])
	}, 60_000)

	it("is not walked at the shipped share of 0: every relationship would be left out", () => {
		expect(hops(shippedReceipt)).toEqual([])
		expect(nodeOut(GRAPH, shippedReceipt)?.diagnostics?.linked).toBe(0)
	}, 60_000)
})
