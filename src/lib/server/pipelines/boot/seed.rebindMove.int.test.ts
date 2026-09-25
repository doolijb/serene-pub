/**
 * The rebind move (PLAN-turn-order §5 A5, R20; retargeted by M2, R27): the
 * Turn order control's row follows the node it names. Until 0152 a
 * session's choice was a `pipeline_node_rebinds` row on `core:spec/respond`
 * node `speaker`; at A6 it moved to the shared `core:spec/turn-order` node
 * `strategy`; since the modder pass every genre has its own turn-order spec
 * (`core:spec/<genre>-turn-order`), so a row lands on the spec of **the
 * session's genre**, and a row an earlier boot already moved onto a
 * retired shared slug moves again. `core:task/turn-none@1` is renamed
 * `core:task/turn-manual@1` on the way.
 *
 * It runs as a **boot-seed post-step**, not a migration (R20): a target
 * spec has to exist before a row can point at it, and its spec row is
 * inserted by the catalog seed on the same boot. So it is idempotent and
 * re-runnable: a second boot moves nothing, and a choice the person has
 * already made on the new node is never overwritten by the old one.
 */

import { beforeAll, describe, expect, it } from "vitest"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { createTestDb, createTestUser, type TestDb } from "$lib/server/utils/testDb"
import { moveSpeakerRebinds } from "./seed"

let db: TestDb
let userId: number
/** Spec row ids by slug, as the catalog seed would have left them. */
const specs: Record<string, number> = {}

const SPECS = [
	"core:spec/respond",
	"core:spec/guide-respond",
	"core:spec/writing-room-respond",
	// Retired by the modder pass; an A5/A6 boot may have left rows on them.
	"core:spec/turn-order",
	"core:spec/turn-order-narrator",
	// Every genre's own (R27).
	"core:spec/chat-turn-order",
	"core:spec/guide-turn-order",
	"core:spec/writing-room-turn-order",
	"core:spec/adventure-turn-order"
]

beforeAll(async () => {
	db = await createTestDb()
	userId = (await createTestUser(db, "rebind-move")).id
	// The turn-order specs are published for real, so each target's
	// `strategy` node carries its true `expose` — chat's offers swaps, the
	// rest offer none (R42). The respond specs and the retired shared slugs
	// only need to exist as rows a rebind can point at.
	const { TURN_ORDER_BY_GENRE } = await import("@serene-pub/core-catalog")
	const { saveDocument } = await import("$lib/server/pipelines/boot/store")
	for (const slug of SPECS) {
		const published = TURN_ORDER_BY_GENRE.find((t) => t.spec === slug)
		if (published) {
			await saveDocument(db, published.build(), { publish: true })
			const [row] = await db
				.select({ id: schema.pipelineSpecs.id })
				.from(schema.pipelineSpecs)
				.where(eq(schema.pipelineSpecs.slug, slug))
			specs[slug] = row!.id
			continue
		}
		const [row] = await db
			.insert(schema.pipelineSpecs)
			.values({ slug, name: slug })
			.returning()
		specs[slug] = row.id
	}
}, 60_000)

let nextSession = 1
async function makeSession(genreId = "core:genre/chat") {
	const [session] = await db
		.insert(schema.sessions)
		.values({ userId, isGroup: false, name: `rebind ${nextSession++}`, genreId })
		.returning()
	return session.id
}

const rebind = async (opts: {
	spec: string
	sessionId: number
	nodeKey: string
	definitionId: string
}) => {
	await db.insert(schema.pipelineNodeRebinds).values({
		specId: specs[opts.spec]!,
		scopeKind: "session",
		scopeId: opts.sessionId,
		nodeKey: opts.nodeKey,
		definitionId: opts.definitionId,
		updatedBy: userId
	})
}

const rebindsOf = async (sessionId: number) => {
	const rows = await db
		.select({
			specId: schema.pipelineNodeRebinds.specId,
			nodeKey: schema.pipelineNodeRebinds.nodeKey,
			definitionId: schema.pipelineNodeRebinds.definitionId,
			updatedBy: schema.pipelineNodeRebinds.updatedBy
		})
		.from(schema.pipelineNodeRebinds)
		.where(
			and(
				eq(schema.pipelineNodeRebinds.scopeKind, "session"),
				eq(schema.pipelineNodeRebinds.scopeId, sessionId)
			)
		)
		.orderBy(schema.pipelineNodeRebinds.id)
	const bySpecId = Object.fromEntries(
		Object.entries(specs).map(([slug, id]) => [id, slug])
	)
	return rows.map((r) => ({
		spec: bySpecId[r.specId] ?? String(r.specId),
		nodeKey: r.nodeKey,
		definitionId: r.definitionId,
		updatedBy: r.updatedBy
	}))
}

// Chat's strategy sits behind its model path (M4) — the move reads the key
// from core-catalog's table; this is what the table says for chat.
const strategyKeyOf = (spec: string) =>
	spec === "core:spec/chat-turn-order" ? "decide.rules.strategy" : "strategy"

const strategyOn = (spec: string, definitionId: string) => ({
	spec,
	nodeKey: strategyKeyOf(spec),
	definitionId,
	// The person who made the choice keeps it.
	updatedBy: userId
})

describe("moveSpeakerRebinds", () => {
	it("moves a 0152-shaped row to the session genre's turn-order spec, once", async () => {
		const sessionId = await makeSession()
		await rebind({
			spec: "core:spec/respond",
			sessionId,
			nodeKey: "speaker",
			definitionId: "core:task/turn-user-split@1"
		})

		expect(await moveSpeakerRebinds(db)).toMatchObject({ moved: 1, kept: 0, dropped: 0 })
		expect(await rebindsOf(sessionId)).toEqual([
			strategyOn("core:spec/chat-turn-order", "core:task/turn-user-split@1")
		])

		// A second boot moves nothing: the source row is gone and the
		// destination is already there.
		expect(await moveSpeakerRebinds(db)).toMatchObject({ moved: 0, kept: 0, dropped: 0 })
		expect((await rebindsOf(sessionId)).length).toBe(1)
	})

	it("a guide or writing-room row is dropped — their turn order offers no control (R42)", async () => {
		const guide = await makeSession("core:genre/guide")
		const writingRoom = await makeSession("core:genre/writing-room")
		await rebind({
			spec: "core:spec/guide-respond",
			sessionId: guide,
			nodeKey: "speaker",
			definitionId: "core:task/turn-random@1"
		})
		await rebind({
			spec: "core:spec/writing-room-respond",
			sessionId: writingRoom,
			nodeKey: "speaker",
			definitionId: "core:task/turn-scripted@1"
		})

		// Moved, it would run with no control to see or clear it.
		expect(await moveSpeakerRebinds(db)).toMatchObject({ moved: 0, dropped: 2 })
		expect(await rebindsOf(guide)).toEqual([])
		expect(await rebindsOf(writingRoom)).toEqual([])
	})

	it("a row an earlier boot moved onto a retired shared slug moves again, where it can", async () => {
		const chat = await makeSession()
		const adventure = await makeSession("core:genre/adventure")
		await rebind({
			spec: "core:spec/turn-order",
			sessionId: chat,
			nodeKey: "strategy",
			definitionId: "core:task/turn-manual@1"
		})
		await rebind({
			spec: "core:spec/turn-order-narrator",
			sessionId: adventure,
			nodeKey: "strategy",
			definitionId: "core:task/turn-narrator@1"
		})
		// Chat's moves; adventure's has nowhere visible to go (no swaps).
		expect(await moveSpeakerRebinds(db)).toMatchObject({ moved: 1, dropped: 1 })
		expect(await rebindsOf(chat)).toEqual([
			strategyOn("core:spec/chat-turn-order", "core:task/turn-manual@1")
		])
		expect(await rebindsOf(adventure)).toEqual([])
	})

	it("a row at chat's old `strategy` key follows the node behind the model path (M4)", async () => {
		const sessionId = await makeSession()
		await rebind({
			spec: "core:spec/chat-turn-order",
			sessionId,
			nodeKey: "strategy",
			definitionId: "core:task/turn-random@1"
		})
		expect(await moveSpeakerRebinds(db)).toMatchObject({ moved: 1 })
		expect(await rebindsOf(sessionId)).toEqual([
			strategyOn("core:spec/chat-turn-order", "core:task/turn-random@1")
		])
	})

	it("renames turn-none to turn-manual as it moves", async () => {
		const sessionId = await makeSession()
		await rebind({
			spec: "core:spec/respond",
			sessionId,
			nodeKey: "speaker",
			definitionId: "core:task/turn-none@1"
		})
		expect(await moveSpeakerRebinds(db)).toMatchObject({ moved: 1 })
		expect((await rebindsOf(sessionId))[0]!.definitionId).toBe(
			"core:task/turn-manual@1"
		)
	})

	it("never overwrites a strategy row the person already has", async () => {
		const sessionId = await makeSession()
		await rebind({
			spec: "core:spec/respond",
			sessionId,
			nodeKey: "speaker",
			definitionId: "core:task/turn-user-split@1"
		})
		await rebind({
			spec: "core:spec/chat-turn-order",
			sessionId,
			nodeKey: "decide.rules.strategy",
			definitionId: "core:task/turn-random@1"
		})

		expect(await moveSpeakerRebinds(db)).toMatchObject({ moved: 0, kept: 1 })
		// The later choice stands; the old row is gone either way — the node
		// it named does not exist any more.
		expect(await rebindsOf(sessionId)).toEqual([
			strategyOn("core:spec/chat-turn-order", "core:task/turn-random@1")
		])
	})

	it("drops a row whose session's genre has no core turn-order spec, and says so", async () => {
		const sessionId = await makeSession("acme.rp:genre/tavern")
		await rebind({
			spec: "core:spec/respond",
			sessionId,
			nodeKey: "speaker",
			definitionId: "core:task/turn-random@1"
		})
		expect(await moveSpeakerRebinds(db)).toMatchObject({ moved: 0, dropped: 1 })
		expect(await rebindsOf(sessionId)).toEqual([])
	})

	it("leaves rebinds on other nodes and other scopes alone", async () => {
		const sessionId = await makeSession()
		await rebind({
			spec: "core:spec/respond",
			sessionId,
			nodeKey: "gather",
			definitionId: "core:task/rank-hybrid@1"
		})
		await db.insert(schema.pipelineNodeRebinds).values({
			specId: specs["core:spec/respond"]!,
			scopeKind: "instance",
			scopeId: 0,
			nodeKey: "speaker",
			definitionId: "core:task/turn-random@1",
			updatedBy: userId
		})

		expect(await moveSpeakerRebinds(db)).toMatchObject({ moved: 0, kept: 0, dropped: 0 })
		expect(await rebindsOf(sessionId)).toEqual([
			{
				spec: "core:spec/respond",
				nodeKey: "gather",
				definitionId: "core:task/rank-hybrid@1",
				updatedBy: userId
			}
		])
		const [instanceRow] = await db
			.select({ nodeKey: schema.pipelineNodeRebinds.nodeKey })
			.from(schema.pipelineNodeRebinds)
			.where(eq(schema.pipelineNodeRebinds.scopeKind, "instance"))
		expect(instanceRow!.nodeKey).toBe("speaker")
	})

	it("leaves a row in place until its genre's spec exists, then moves it", async () => {
		const sessionId = await makeSession()
		await rebind({
			spec: "core:spec/respond",
			sessionId,
			nodeKey: "speaker",
			definitionId: "core:task/turn-user-split@1"
		})
		// The spec row the catalog seed inserts — taken away, as it is on any
		// boot of a build that has not published it yet.
		const chatId = specs["core:spec/chat-turn-order"]!
		await db
			.update(schema.pipelineSpecs)
			.set({ slug: "core:spec/chat-turn-order--absent" })
			.where(eq(schema.pipelineSpecs.id, chatId))
		try {
			expect(await moveSpeakerRebinds(db)).toEqual({ moved: 0, kept: 0, dropped: 0 })
			expect(await rebindsOf(sessionId)).toEqual([
				{
					spec: "core:spec/respond",
					nodeKey: "speaker",
					definitionId: "core:task/turn-user-split@1",
					updatedBy: userId
				}
			])
		} finally {
			await db
				.update(schema.pipelineSpecs)
				.set({ slug: "core:spec/chat-turn-order" })
				.where(eq(schema.pipelineSpecs.id, chatId))
		}
		// And it moves on the boot that publishes the spec.
		expect(await moveSpeakerRebinds(db)).toMatchObject({ moved: 1 })
	})
})

describe("sessions.annex (migration 0153)", () => {
	it("every session has an annex, defaulting to an empty object", async () => {
		const sessionId = await makeSession()
		const [row] = await db
			.select({ annex: schema.sessions.annex })
			.from(schema.sessions)
			.where(eq(schema.sessions.id, sessionId))
		expect(row!.annex).toEqual({})
	})

	it("holds a namespaced document per owner", async () => {
		const sessionId = await makeSession()
		await db
			.update(schema.sessions)
			.set({ annex: { "acme.rp": { clock: 3 }, core: { seen: true } } })
			.where(eq(schema.sessions.id, sessionId))
		const [row] = await db
			.select({ annex: schema.sessions.annex })
			.from(schema.sessions)
			.where(eq(schema.sessions.id, sessionId))
		expect(row!.annex).toEqual({ "acme.rp": { clock: 3 }, core: { seen: true } })
	})
})
