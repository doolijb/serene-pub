/**
 * 🚧 The firsthand filter on the two history bindings
 * (`core:query/session-history@1`, `core:query/earlier-scenes@1`), through the
 * bindings map: unwired it is today's node exactly, with no receipt line;
 * wired (the `firsthandFor` key present, even when null) it applies
 * `sessions/firsthandFilter.ts` and says so in the node's receipt note.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { defineAttributeSlot, getAttributeSlot } from "@serene-pub/sdk"
import "@serene-pub/core-catalog"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { genreKeeping } from "$lib/server/utils/testGenre"
import { insertCastMember } from "$lib/server/characters/versions"
import { insertLegacy } from "$lib/server/messages/store"
import { HISTORY_TYPE_ID } from "$lib/shared/entries/types"
import { applyEligibility } from "$lib/server/pipelines/ranking/eligibility"
import { createHost } from "$lib/server/pipelines/runtime/host"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "bindings-firsthand-secret" }
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

const PLACE = "test:slot/bindings-firsthand-place@1"

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-bindings-firsthand-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	defineAttributeSlot(PLACE, {
		type: "text",
		label: { en: "Place" },
		descriptor: "Where they are.",
		appliesTo: ["cast"]
	})
}, 120_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
	await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {})
})

const db = () => testDb as unknown as Db
let n = 0

/** The w2 world: scenes A (Bram, Verity), B (Cole), D (Bram + non-live Verity), open E; Verity benched. */
async function world() {
	const suffix = ++n
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `bfh-${suffix}`)
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: user.id, name: `Book ${suffix}` } as never)
		.returning()
	const cards: Record<string, { id: number; member: number }> = {}
	for (const name of ["Verity", "Bram", "Cole"]) {
		const [card] = await testDb
			.insert(schema.characters)
			.values({ userId: user.id, name, description: "…" } as never)
			.returning()
		const member = (
			await insertCastMember(testDb, {
				lorebookId: book!.id,
				binding: `{{char:${name}${suffix}}}`,
				characterId: card!.id,
				name
			})
		).member!
		cards[name] = { id: card!.id, member: member.id }
	}
	const genreId = `test:genre/bfh-${suffix}`
	genreKeeping(genreId, {
		name: { en: "Firsthand" },
		family: "test",
		slots: [getAttributeSlot(PLACE)!],
		events: {}
	})
	const [session] = await testDb
		.insert(schema.sessions)
		.values({
			userId: user.id,
			isGroup: true,
			name: `Run ${suffix}`,
			genreId,
			lorebookId: book!.id
		} as never)
		.returning()
	const sessionId = session!.id
	await testDb.insert(schema.sessionCharacters).values(
		["Verity", "Bram", "Cole"].map((name, position) => ({
			sessionId,
			characterId: cards[name]!.id,
			castMemberId: cards[name]!.member,
			position,
			seatedByUserId: user.id,
			isActive: name !== "Verity"
		})) as never
	)
	const say = async (
		who: string | null,
		over: Partial<typeof schema.sessionMessages.$inferInsert> = {}
	) =>
		(
			await insertLegacy(db(), {
				sessionId,
				role: "assistant",
				content: "…",
				castMemberId: who ? cards[who]!.member : null,
				...over
			} as never)
		).id
	const scene = async (opened: number, closed: number | null) =>
		(
			await testDb
				.insert(schema.scenes)
				.values({
					sessionId,
					lorebookId: book!.id,
					channel: "main",
					openedAtMessageId: opened,
					closedAtMessageId: closed,
					summary: `Summary ${opened}.`,
					summaryStatus: "done"
				} as never)
				.returning()
		)[0]!.id
	const m0 = await say("Cole")
	const a1 = await say("Bram")
	const a2 = await say("Verity")
	const b1 = await say("Cole")
	const x = await say("Cole", { channel: "whisper" } as never)
	const b2 = await say("Cole")
	const d1 = await say("Bram")
	const d2 = await say("Verity", { isHidden: true } as never)
	const d3 = await say("Verity")
	const d4 = await say("Verity", { isGenerating: true } as never)
	const e1 = await say("Bram")
	const e2 = await say("Cole")
	await testDb
		.update(schema.sessionMessages)
		.set({ rewindOrdinal: 1 })
		.where(eq(schema.sessionMessages.id, d3))
	const A = await scene(a1, a2)
	const B = await scene(b1, b2)
	const D = await scene(d1, d4)
	await scene(e1, null)
	return {
		user,
		cards,
		sessionId,
		ids: { m0, a1, a2, b1, x, b2, d1, d2, d3, d4, e1, e2 },
		scenes: { A, B, D }
	}
}
type World = Awaited<ReturnType<typeof world>>

async function place(w: World, who: string, value: string, from: number | null) {
	await testDb.insert(schema.attributeValues).values({
		ownerKind: "seated_member",
		ownerId: w.cards[who]!.member,
		slotId: PLACE,
		value: { v: value },
		sessionId: w.sessionId,
		validFromMessageId: from
	} as never)
}

async function countStatements<T>(fn: () => Promise<T>): Promise<{ result: T; statements: number }> {
	const client = (testDb as unknown as { $client: { query: (...a: unknown[]) => unknown } }).$client
	const original = client.query.bind(client)
	let statements = 0
	client.query = (...args: unknown[]) => {
		statements++
		return original(...args)
	}
	try {
		return { result: await fn(), statements }
	} finally {
		client.query = original
	}
}

function ctxFor(w: World) {
	const host = createHost(db(), { sessionId: w.sessionId, userId: w.user.id })
	const log = vi.fn()
	return { log, ctx: { read: (t: string, q?: unknown) => (host as any).read(t, q), log } as never }
}

/** These two reads also take `speakerInCast` (on by default; `bindings.speakerInCast.int.test.ts`): off here, so this file tests firsthand alone. */
const NOT_BY_CAST = { speakerInCast: false }

const bindings = async () => (await import("$lib/server/pipelines/runtime/bindings")).coreBindings()

async function history(w: World, extra: Record<string, unknown> = {}, params: Record<string, unknown> = {}) {
	const { ctx, log } = ctxFor(w)
	const r = (await (await bindings())["core:query/session-history@1"]!(
		{ scope: { sessionId: w.sessionId }, params, ...extra } as never,
		ctx
	)) as any
	expect(r.kind).toBe("ok")
	return { rows: r.value.messages as { id: number }[], value: r.value, log }
}

async function earlier(w: World, extra: Record<string, unknown> = {}) {
	const { ctx, log } = ctxFor(w)
	const r = (await (await bindings())["core:query/earlier-scenes@1"]!(
		{ scope: { sessionId: w.sessionId }, budget: { total: 1000 }, params: NOT_BY_CAST, ...extra } as never,
		ctx
	)) as any
	expect(r.kind).toBe("ok")
	return { scenes: r.value.main.scenes as { sceneId: number }[], value: r.value, log }
}

describe("core:query/session-history@1 with firsthandFor", () => {
	test("not invoked: today's output exactly, and no receipt line", async () => {
		const w = await world()
		const { ctx } = ctxFor(w)
		const direct = await (ctx as any).read("session_messages", { sessionId: w.sessionId, limit: 100, channel: "main" })
		const r = await history(w)
		expect(r.value.main).toEqual(direct)
		expect(r.value.messages).toEqual(direct)
		expect(r.rows.length).toBe(9) // the host's read also holds the rewound row
		expect(r.log).not.toHaveBeenCalled()
	})

	test("a narrator turn (firsthandFor wired, undefined or null) reads everything and says so", async () => {
		const w = await world()
		const plain = await history(w)
		for (const firsthandFor of [undefined, null]) {
			const r = await history(w, { firsthandFor })
			expect(r.value.messages).toEqual(plain.value.messages)
			expect(r.log.mock.calls).toEqual([["info", "Reads everything: not one cast member's turn"]])
		}
	})

	test("a member that never spoke in a closed scene: its lines are left out, with the note", async () => {
		const w = await world()
		const i = w.ids
		const r = await history(w, { firsthandFor: w.cards.Verity!.id })
		expect(r.rows.map((m) => m.id)).toEqual([i.m0, i.a1, i.a2, i.d3, i.e1, i.e2]) // d3: her own (rewound rows still read; the host's call)
		expect(r.value.main).toBe(r.value.messages)
		expect(r.log.mock.calls).toEqual([["info", "3 messages left out: Verity was not there"]])
		expect(r.value.band).toBeDefined()
	})

	test("a card-less seat's turn (firsthandFor null, member in the scope) is filtered, not read whole", async () => {
		const w = await world()
		const i = w.ids
		const wren = (
			await insertCastMember(testDb, {
				lorebookId: (await testDb.select().from(schema.sessions).where(eq(schema.sessions.id, w.sessionId)))[0]!
					.lorebookId!,
				binding: `{{char:Wren${w.sessionId}}}`,
				characterId: null,
				name: "Wren"
			})
		).member!
		const { membersAsRead } = await import("$lib/server/cast/memberAsRead")
		const shown = (await membersAsRead(db(), [wren.id], { sessionId: w.sessionId })).get(wren.id)!.shownName
		const r = await history(
			w,
			{ firsthandFor: null, scope: { sessionId: w.sessionId, currentCastMemberId: wren.id } }
		)
		// She spoke nowhere: A, B and D are out; the rest stays (d3: the host's rewound row, in no live scene).
		expect(r.rows.map((m) => m.id)).toEqual([i.m0, i.d3, i.e1, i.e2])
		expect(r.log.mock.calls).toEqual([["info", `5 messages left out: ${shown} was not there`]])
		const e = await earlier(w, {
			firsthandFor: null,
			scope: { sessionId: w.sessionId, currentCastMemberId: wren.id }
		})
		expect(e.scenes).toEqual([])
		expect(e.log.mock.calls).toEqual([["info", `3 scene summaries left out: ${shown} was not there`]])
	})

	test("one that spoke in the scene, even only before the history window, keeps its lines", async () => {
		const w = await world()
		const i = w.ids
		// limit 7 → a2..e2. Bram spoke a1 (outside the window), so a2 stays; he never spoke in B.
		const r = await history(w, { firsthandFor: w.cards.Bram!.id }, { limit: 7 })
		expect(r.rows.map((m) => m.id)).toEqual([i.a2, i.d1, i.d3, i.e1, i.e2])
		expect(r.log.mock.calls).toEqual([["info", "2 messages left out: Bram was not there"]])
	})

	test("composes with a channel read: a subset of the unfiltered read, never more", async () => {
		const w = await world()
		for (const params of [{ channel: "whisper:1" }, { channel: "main" }]) {
			const all = await history(w, {}, params)
			const some = await history(w, { firsthandFor: w.cards.Verity!.id }, params)
			const ids = new Set(all.rows.map((m) => m.id))
			expect(some.rows.every((m) => ids.has(m.id))).toBe(true)
			expect(some.rows.length).toBeLessThanOrEqual(all.rows.length)
		}
		const unfilteredLane = await history(w, { channelLane: "whisper:1" })
		expect(unfilteredLane.rows.map((m) => m.id)).toEqual([w.ids.x])
		const lane = await history(w, { firsthandFor: w.cards.Verity!.id, channelLane: "whisper:1" })
		expect(lane.rows.map((m) => m.id)).toEqual([w.ids.x]) // in no main scene: kept
	})

	test("a one-row read (messageId) is never filtered", async () => {
		const w = await world()
		const r = await history(w, { messageId: w.ids.b1, firsthandFor: w.cards.Verity!.id })
		expect(r.rows.map((m) => m.id)).toEqual([w.ids.b1])
		expect(r.log).not.toHaveBeenCalled()
	})

	test("with firsthandBy naming a tracked slot: a line after the member's value moved away is left out", async () => {
		const w = await world()
		const i = w.ids
		await place(w, "Verity", "Hall", null)
		await place(w, "Cole", "  hall ", null)
		await place(w, "Cole", "Yard", i.b2)
		const r = await history(w, { firsthandFor: w.cards.Verity!.id, firsthandBy: ` ${PLACE} ` })
		// b1 kept (same hall) though she never spoke in B; b2, d1, e2 out.
		expect(r.rows.map((m) => m.id)).toEqual([i.m0, i.a1, i.a2, i.b1, i.d3, i.e1])
		expect(r.log.mock.calls).toEqual([["info", "3 messages left out: Verity was not there"]])
	})
})

describe("core:query/earlier-scenes@1 with firsthandFor", () => {
	test("not invoked: every scene, and no receipt line", async () => {
		const w = await world()
		const r = await earlier(w)
		expect(r.scenes.map((s) => s.sceneId)).toEqual([w.scenes.A, w.scenes.B, w.scenes.D])
		expect(r.value.main.maxTokens).toBe(150)
		expect(r.log).not.toHaveBeenCalled()
	})

	test("a narrator turn reads everything and says so", async () => {
		const w = await world()
		for (const firsthandFor of [undefined, null]) {
			const r = await earlier(w, { firsthandFor })
			expect(r.scenes.length).toBe(3)
			expect(r.log.mock.calls).toEqual([["info", "Reads everything: not one cast member's turn"]])
		}
	})

	test("a summary is left out for a member that never spoke, kept for one that spoke; the note", async () => {
		const w = await world()
		const v = await earlier(w, { firsthandFor: w.cards.Verity!.id })
		expect(v.scenes.map((s) => s.sceneId)).toEqual([w.scenes.A])
		expect(v.value.main.maxTokens).toBe(150)
		expect(v.log.mock.calls).toEqual([["info", "2 scene summaries left out: Verity was not there"]])
		const c = await earlier(w, { firsthandFor: w.cards.Cole!.id })
		expect(c.scenes.map((s) => s.sceneId)).toEqual([w.scenes.B])
	})

	test("firsthandBy: a scene whose last line the member's place excludes is left out", async () => {
		const w = await world()
		await place(w, "Verity", "Hall", null)
		await place(w, "Bram", "Hall", null)
		await place(w, "Cole", "Hall", null)
		await place(w, "Cole", "Yard", w.ids.b1)
		// Verity, all in the hall until Cole leaves at b1: B (Cole's lines, in the yard) is out;
		// D is Bram's own scene seen from the hall: kept by place, though she never spoke in it.
		const r = await earlier(w, { firsthandFor: w.cards.Verity!.id, firsthandBy: PLACE })
		expect(r.scenes.map((s) => s.sceneId)).toEqual([w.scenes.A, w.scenes.D])
	})
})

async function historyEntries(w: World, extra: Record<string, unknown> = {}) {
	const { ctx, log } = ctxFor(w)
	const r = (await (await bindings())["core:query/history-entries@1"]!(
		{ scope: { sessionId: w.sessionId }, params: NOT_BY_CAST, ...extra } as never,
		ctx
	)) as any
	expect(r.kind).toBe("ok")
	return { r, value: r.value, exclusions: r.value.exclusions as any[], log }
}

/** Entries of the w2 world, compiled from its scenes: A attended, B missed, D mixed, plus one of no scene here. */
async function entriesOf(w: World) {
	const [session] = await testDb.select().from(schema.sessions).where(eq(schema.sessions.id, w.sessionId))
	const bookId = session!.lorebookId!
	const entry = async (title: string) =>
		(
			await testDb
				.insert(schema.lorebookEntries)
				.values({
					lorebookId: bookId,
					typeId: HISTORY_TYPE_ID,
					typeVersion: 1,
					title,
					content: `${title}, as written.`,
					keys: [title.toLowerCase()],
					position: ++n,
					fields: { year: 1200 + n, month: null, day: null }
				} as never)
				.returning()
		)[0]!.id
	const compile = (sceneId: number, entryId: number) =>
		testDb
			.update(schema.scenes)
			.set({ historyEntryId: entryId } as never)
			.where(eq(schema.scenes.id, sceneId))
	const [other] = await testDb
		.insert(schema.sessions)
		.values({ userId: w.user.id, isGroup: true, name: "Other run", lorebookId: bookId } as never)
		.returning()
	const stray = (entryId: number) =>
		testDb
			.insert(schema.scenes)
			.values({ sessionId: other!.id, lorebookId: bookId, channel: "main", historyEntryId: entryId } as never)
	const attended = await entry("Attended")
	const missed = await entry("Missed")
	const mixed = await entry("Mixed")
	const elsewhere = await entry("Elsewhere")
	await compile(w.scenes.A, attended)
	await compile(w.scenes.B, missed)
	await compile(w.scenes.D, mixed)
	await stray(mixed)
	await stray(elsewhere)
	return { attended, missed, mixed, elsewhere }
}

describe("core:query/history-entries@1 with firsthandFor", () => {
	test("not invoked: byte-identical output, and no firsthand receipt line", async () => {
		const w = await world()
		await entriesOf(w)
		const a = await historyEntries(w)
		const b = await historyEntries(w)
		expect(JSON.stringify(a.r)).toBe(JSON.stringify(b.r))
		// No firsthand receipt; only the lore read's own knowledge note (this
		// run speaks as nobody, so it reads everything).
		expect(a.log.mock.calls).toEqual([["info", "Reads everything: not one cast member's turn"]])
	})

	test("left out: a missed scene, and a mixed entry; kept: attended, and none of this session's", async () => {
		const w = await world()
		const e = await entriesOf(w)
		const plain = await historyEntries(w)
		const r = await historyEntries(w, { firsthandFor: w.cards.Verity!.id })
		const reason = "Verity was not there for all of this history entry's scenes."
		expect(r.exclusions.slice(plain.exclusions.length)).toEqual(
			[e.missed, e.mixed].sort((x, y) => x - y).map((id) => ({ source: "history", id, reason }))
		)
		expect(r.exclusions.slice(0, plain.exclusions.length)).toEqual(plain.exclusions)
		const named = r.exclusions.map((x) => x.id)
		expect(named).not.toContain(e.attended)
		expect(named).not.toContain(e.elsewhere)
		expect(r.value.main).toEqual(plain.value.main)
		expect(r.value.hits).toEqual(plain.value.hits)
		expect(r.value.skipped).toEqual(plain.value.skipped)
		// The lore read's knowledge note first, then the firsthand receipt.
		expect(r.log.mock.calls).toEqual([
			["info", "Reads everything: not one cast member's turn"],
			["info", "2 history entries left out: Verity was not there for all of their scenes"]
		])
	})

	test("one entry left out: the singular receipt", async () => {
		const w = await world()
		await entriesOf(w)
		const r = await historyEntries(w, { firsthandFor: w.cards.Bram!.id })
		expect(r.log.mock.calls).toEqual([
			["info", "Reads everything: not one cast member's turn"],
			["info", "1 history entry left out: Bram was not there for all of its scenes"]
		])
	})

	test("a narrator turn reads everything: exclusions unchanged, and says so", async () => {
		const w = await world()
		await entriesOf(w)
		const plain = await historyEntries(w)
		const r = await historyEntries(w, { firsthandFor: null })
		expect(r.exclusions).toEqual(plain.exclusions)
		expect(JSON.stringify(r.r)).toBe(JSON.stringify(plain.r))
		// The lore read's knowledge note, then the firsthand receipt: the
		// same sentence from two readers.
		expect(r.log.mock.calls).toEqual([
			["info", "Reads everything: not one cast member's turn"],
			["info", "Reads everything: not one cast member's turn"]
		])
	})

	test("eligibility blocks a vector-search copy of a left-out entry", async () => {
		const w = await world()
		const e = await entriesOf(w)
		const r = await historyEntries(w, { firsthandFor: w.cards.Verity!.id })
		const out = applyEligibility({
			candidates: [
				{ source: "historyEntry", id: e.missed, text: "x" },
				{ source: "historyEntry", id: e.attended, text: "y" }
			],
			exclusions: r.exclusions
		})
		const [blocked, free] = out.candidates as any[]
		expect(blocked.ineligible).toEqual({
			reason: "Verity was not there for all of this history entry's scenes."
		})
		expect(free.ineligible).toBeUndefined()
	})
})

describe("statements the two bindings add per reply", () => {
	test("none when not invoked; a few when invoked", async () => {
		const w = await world()
		await place(w, "Verity", "Hall", null)
		await place(w, "Cole", "Hall", null)
		await place(w, "Bram", "Hall", null)
		const verity = w.cards.Verity!.id
		const h0 = await countStatements(() => history(w))
		const h1 = await countStatements(() => history(w, { firsthandFor: verity }))
		const h2 = await countStatements(() => history(w, { firsthandFor: verity, firsthandBy: PLACE }))
		const e0 = await countStatements(() => earlier(w))
		const e1 = await countStatements(() => earlier(w, { firsthandFor: verity }))
		const e2 = await countStatements(() => earlier(w, { firsthandFor: verity, firsthandBy: PLACE }))
		console.info(
			`firsthand binding statements added: history +${h1.statements - h0.statements} (no stat), +${h2.statements - h0.statements} (stat, 3 members); earlier-scenes +${e1.statements - e0.statements} (no stat), +${e2.statements - e0.statements} (stat, 3 members)`
		)
		const l0 = await countStatements(() => historyEntries(w))
		const l1 = await countStatements(() => historyEntries(w, { firsthandFor: verity }))
		console.info(`history-entries statements added: not invoked total ${l0.statements}; invoked, no slot: +${l1.statements - l0.statements}`)
		expect(l1.statements).toBeGreaterThan(l0.statements)
		expect(h1.statements).toBeGreaterThan(h0.statements)
		expect(e1.statements).toBeGreaterThan(e0.statements)
	})
})
