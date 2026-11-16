/**
 * 🚧 The loader of what a character was there for, on a real session: two closed
 * scenes, one closed scene of hidden/rewound/generating lines only from the
 * member, an open scene, a line on another lane, a benched seat, a place slot.
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
import { HISTORY_TYPE_ID } from "$lib/shared/entries/types"
import { genreKeeping } from "$lib/server/utils/testGenre"
import { insertCastMember } from "$lib/server/characters/versions"
import { insertLegacy } from "$lib/server/messages/store"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
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

const PLACE = "test:slot/firsthand-place@1"

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-firsthandFilter-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	defineAttributeSlot(PLACE, {
		type: "text",
		label: { en: "Place" },
		descriptor: "Where they are.",
		appliesTo: ["cast"]
	})
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
	await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {})
})

const db = () => testDb as unknown as Db
let n = 0

async function world() {
	const suffix = ++n
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `firsthand-${suffix}`)
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
	const genreId = `test:genre/firsthand-${suffix}`
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
			// Verity is benched: bench plays no part.
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
					closedAtMessageId: closed
				} as never)
				.returning()
		)[0]!.id

	const m0 = await say("Cole") // in no scene
	const a1 = await say("Bram")
	const a2 = await say("Verity")
	const b1 = await say("Cole")
	const x = await say("Cole", { channel: "whisper:1" } as never) // inside B's id range, other lane
	const b2 = await say("Cole")
	const d1 = await say("Bram")
	const d2 = await say("Verity", { isHidden: true } as never)
	const d3 = await say("Verity")
	const d4 = await say("Verity", { isGenerating: true } as never)
	const e1 = await say("Bram")
	const e2 = await say("Cole")
	// The rewound line: marked after all inserts (a later insert would discard it).
	await testDb
		.update(schema.sessionMessages)
		.set({ rewindOrdinal: 1 })
		.where(eq(schema.sessionMessages.id, d3))
	const A = await scene(a1, a2)
	const B = await scene(b1, b2)
	const D = await scene(d1, d4)
	const E = await scene(e1, null)
	const lines = (
		await testDb
			.select({ id: schema.sessionMessages.id, castMemberId: schema.sessionMessages.castMemberId })
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.sessionId, sessionId))
	)
		.filter((r) => ![d2, d3, d4].includes(r.id))
		.sort((p, q) => p.id - q.id)
	return {
		user,
		book: book!,
		cards,
		sessionId,
		ids: { m0, a1, a2, b1, x, b2, d1, d2, d3, d4, e1, e2 },
		scenes: { A, B, D, E },
		lines
	}
}

/** One value of the place slot for a member, from a message (null: from the start). */
async function place(w: Awaited<ReturnType<typeof world>>, who: string, value: string, from: number | null) {
	await testDb.insert(schema.attributeValues).values({
		ownerKind: "seated_member",
		ownerId: w.cards[who]!.member,
		slotId: PLACE,
		value: { v: value },
		sessionId: w.sessionId,
		validFromMessageId: from
	} as never)
}

/** Count the statements the PGlite client sees while `fn` runs. */
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

type World = Awaited<ReturnType<typeof world>>

async function viewOf(w: World, extra: Record<string, unknown> = {}, who = "Verity") {
	const { loadFirsthandView } = await import("./firsthandFilter")
	const read = await loadFirsthandView(db(), {
		sessionId: w.sessionId,
		characterId: w.cards[who]!.id,
		...extra
	})
	if (read.kind !== "viewpoint") throw new Error("expected a viewpoint")
	return read.view
}

describe("loadFirsthandView", () => {
	test("by scene: a benched member who spoke was there; hidden, rewound and generating lines do not count; another lane is in no scene", async () => {
		const w = await world()
		const { keptLineIds, keptSceneIds } = await import("./firsthandFilter")
		const view = await viewOf(w)
		expect(view.name).toBe("Verity")
		const i = w.ids
		// A: she spoke (benched). B: never. D: only hidden, rewound and generating lines. E: open.
		// x sits inside B's id range on another lane: in no main scene, kept.
		expect(keptLineIds(view, w.lines)).toEqual({
			keptIds: [i.m0, i.a1, i.a2, i.x, i.e1, i.e2],
			leftOut: 3
		})
		const { A, B, D } = w.scenes
		expect(keptSceneIds(view, [A, B, D])).toEqual({ keptIds: [A], leftOut: 2 })
		expect(view.sceneOfLine.get(i.x)).toBeUndefined()
		expect(view.openSceneIds.has(w.scenes.E)).toBe(true)
	})

	test("a member who spoke only before the judged lines was still there", async () => {
		const w = await world()
		const { keptLineIds } = await import("./firsthandFilter")
		const view = await viewOf(w)
		// Only A's first line is judged; her own line a2 is outside it.
		expect(keptLineIds(view, w.lines.filter((l) => l.id === w.ids.a1)).leftOut).toBe(0)
	})

	test("a character with no seat, and no character, read everything", async () => {
		const w = await world()
		const { loadFirsthandView } = await import("./firsthandFilter")
		const [stranger] = await testDb
			.insert(schema.characters)
			.values({ userId: w.user.id, name: "Stranger", description: "…" } as never)
			.returning()
		expect(await loadFirsthandView(db(), { sessionId: w.sessionId, characterId: stranger!.id })).toEqual({
			kind: "reads-all"
		})
		for (const characterId of [null, undefined, 0, -3, 1.5, "7"])
			expect(await loadFirsthandView(db(), { sessionId: w.sessionId, characterId })).toEqual({
				kind: "reads-all"
			})
	})

	test("with a place slot: after it left and before it arrived are left out; missing values fall back to the scene", async () => {
		const w = await world()
		const { keptLineIds } = await import("./firsthandFilter")
		const i = w.ids
		await place(w, "Verity", "Hall", null)
		await place(w, "Cole", "  hall ", null)
		await place(w, "Cole", "Yard", i.b2)
		// Bram has no value: his lines fall back to the scene rule.
		const view = await viewOf(w, {
			slotId: PLACE,
			lineIds: w.lines.map((l) => l.id)
		})
		expect(view.slotTracked).toBe(true)
		// Cole's m0 and b1 (hall = hall): kept, b1 although she never spoke in B; b2 (yard): out.
		// Bram: a1, e1 by scene (kept); d1 by scene (out).
		const kept = keptLineIds(view, w.lines)
		expect(kept.keptIds).toEqual([i.m0, i.a1, i.a2, i.b1, i.x, i.e1])
		expect(kept.leftOut).toBe(3) // b2, d1, e2 (Cole in the yard by then)
	})

	test("a card-less seat's turn is one member's turn: a scene it never spoke in is left out", async () => {
		const w = await world()
		const { loadFirsthandView, keptLineIds, keptSceneIds } = await import("./firsthandFilter")
		const wren = (
			await insertCastMember(testDb, {
				lorebookId: w.book.id,
				binding: `{{char:Wren${w.sessionId}}}`,
				characterId: null,
				name: "Wren"
			})
		).member!
		await testDb.insert(schema.sessionCharacters).values({
			sessionId: w.sessionId,
			characterId: null,
			castMemberId: wren.id,
			position: 3,
			seatedByUserId: w.user.id,
			isActive: true
		} as never)
		const read = await loadFirsthandView(db(), {
			sessionId: w.sessionId,
			characterId: null,
			castMemberId: wren.id
		})
		if (read.kind !== "viewpoint") throw new Error("expected a viewpoint")
		expect(read.view.memberId).toBe(wren.id)
		expect(read.view.name).toBe("Wren")
		const i = w.ids
		// She spoke nowhere: A, B and D are out; the line in no scene, the other lane and the open scene stay.
		expect(keptLineIds(read.view, w.lines)).toEqual({
			keptIds: [i.m0, i.x, i.e1, i.e2],
			leftOut: 5
		})
		const { A, B, D } = w.scenes
		expect(keptSceneIds(read.view, [A, B, D])).toEqual({ keptIds: [], leftOut: 3 })
		// A card id still wins; a bad member id reads everything.
		expect(
			await loadFirsthandView(db(), { sessionId: w.sessionId, characterId: null, castMemberId: 0 })
		).toEqual({ kind: "reads-all" })
	})

	test("the place rule reads the messages clock only: a later timeline value does not drop lines", async () => {
		const w = await world()
		const { keptLineIds } = await import("./firsthandFilter")
		const i = w.ids
		await place(w, "Verity", "Hall", null)
		// Cole's only value is a timeline one, set later and different from hers.
		await testDb.insert(schema.attributeValues).values({
			ownerKind: "cast_member",
			ownerId: w.cards.Cole!.member,
			slotId: PLACE,
			value: { v: "Yard" },
			sessionId: null,
			updatedBy: "user"
		} as never)
		const view = await viewOf(w, { slotId: PLACE, lineIds: w.lines.map((l) => l.id) })
		expect(view.slotTracked).toBe(true)
		expect(view.placeAt(w.cards.Cole!.member, i.m0)).toBeNull()
		// Cole has no session value, so his lines fall back to the scene rule: m0 (in no scene) is kept.
		expect(keptLineIds(view, w.lines)).toEqual({
			keptIds: [i.m0, i.a1, i.a2, i.x, i.e1, i.e2],
			leftOut: 3
		})
	})

	test("an untracked slot reads by scene alone and says so", async () => {
		const w = await world()
		const { keptLineIds, linesReceipt } = await import("./firsthandFilter")
		const view = await viewOf(w, { slotId: "test:slot/never-declared@1", lineIds: [w.ids.b1] })
		expect(view.slotTracked).toBe(false)
		expect(keptLineIds(view, w.lines).leftOut).toBe(3)
		expect(linesReceipt(view, 3)).toBe(
			"3 messages left out: Verity was not there (test:slot/never-declared@1 is not tracked here, so by scene only)"
		)
	})

	test("history entries: left out when a scene of this session compiled into it was missed; other sessions' and deleted sessions' scenes are not judged", async () => {
		const w = await world()
		const { leftOutEntryIds } = await import("./firsthandFilter")
		const entry = async (title: string) =>
			(
				await testDb
					.insert(schema.lorebookEntries)
					.values({
						lorebookId: w.book.id,
						typeId: HISTORY_TYPE_ID,
						typeVersion: 1,
						title,
						content: `${title}, as written.`,
						keys: [],
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
		const [otherSession] = await testDb
			.insert(schema.sessions)
			.values({ userId: w.user.id, isGroup: true, name: "Other run", lorebookId: w.book.id } as never)
			.returning()
		const strayScene = async (sessionId: number | null, entryId: number) =>
			(
				await testDb
					.insert(schema.scenes)
					.values({ sessionId, lorebookId: w.book.id, channel: "main", historyEntryId: entryId } as never)
					.returning()
			)[0]!.id
		const full = await entry("Attended")
		const missed = await entry("Missed")
		const mixed = await entry("Mixed")
		const onlyOther = await entry("Only another session")
		const onlyDeleted = await entry("Only a deleted session")
		const written = await entry("Written by a person")
		await compile(w.scenes.A, full) // she spoke in A
		await compile(w.scenes.B, missed) // she never spoke in B
		await compile(w.scenes.D, mixed) // only hidden, rewound and generating lines of hers
		await strayScene(otherSession!.id, mixed)
		await strayScene(otherSession!.id, onlyOther)
		await strayScene(null, onlyDeleted)
		const view = await viewOf(w, { judgeHistoryEntries: true })
		expect([...view.scenesOfEntry.keys()].sort((a, b) => a - b)).toEqual([full, missed, mixed])
		expect(view.scenesOfEntry.get(mixed)).toEqual([w.scenes.D])
		expect(leftOutEntryIds(view)).toEqual([missed, mixed])
		expect(leftOutEntryIds(view)).not.toContain(onlyOther)
		expect(leftOutEntryIds(view)).not.toContain(onlyDeleted)
		expect(leftOutEntryIds(view)).not.toContain(written)
		// Another cast member reads the same entries by its own attendance: Bram was in A, D and E.
		const bram = await viewOf(w, { judgeHistoryEntries: true }, "Bram")
		expect(leftOutEntryIds(bram)).toEqual([missed])
	})

	test("a closed scene with no live line is judged by its stored cast; the extra read happens only when such a scene exists", async () => {
		const w = await world()
		const { keptSceneIds, leftOutEntryIds } = await import("./firsthandFilter")
		// A closed range scene whose lines are all hidden, compiled into a History entry.
		const h1 = await insertLegacy(db(), {
			sessionId: w.sessionId,
			role: "assistant",
			content: "…",
			castMemberId: w.cards.Bram!.member,
			isHidden: true
		} as never)
		const h2 = await insertLegacy(db(), {
			sessionId: w.sessionId,
			role: "assistant",
			content: "…",
			castMemberId: w.cards.Cole!.member,
			isHidden: true
		} as never)
		const [entry] = await testDb
			.insert(schema.lorebookEntries)
			.values({
				lorebookId: w.book.id,
				typeId: HISTORY_TYPE_ID,
				typeVersion: 1,
				title: "Gone lines",
				content: "Gone lines, as written.",
				keys: [],
				position: ++n,
				fields: { year: 1300, month: null, day: null }
			} as never)
			.returning()
		const [gone] = await testDb
			.insert(schema.scenes)
			.values({
				sessionId: w.sessionId,
				lorebookId: w.book.id,
				channel: "main",
				openedAtMessageId: h1.id,
				closedAtMessageId: h2.id,
				historyEntryId: entry!.id
			} as never)
			.returning()
		const goneId = gone!.id
		// Verity (A) is a participant; Bram (B) is only mentioned; Cole (C) is not listed.
		await testDb.insert(schema.sceneCharacters).values([
			{ sceneId: goneId, bindingId: w.cards.Verity!.member, role: "participant", ordinal: 0 },
			{ sceneId: goneId, bindingId: w.cards.Bram!.member, role: "mentioned", ordinal: 1 }
		] as never)
		const verity = await viewOf(w, { judgeHistoryEntries: true })
		expect(verity.storedCastSceneIds.has(goneId)).toBe(true)
		expect(keptSceneIds(verity, [goneId])).toEqual({ keptIds: [goneId], leftOut: 0 })
		expect(leftOutEntryIds(verity)).not.toContain(entry!.id)
		for (const who of ["Bram", "Cole"]) {
			const view = await viewOf(w, { judgeHistoryEntries: true }, who)
			expect(view.storedCastSceneIds.has(goneId)).toBe(false)
			expect(keptSceneIds(view, [goneId])).toEqual({ keptIds: [], leftOut: 1 })
			expect(leftOutEntryIds(view)).toEqual([entry!.id])
		}

		// The grouped read: one extra statement with such a scene, none without.
		const without = await world()
		const base = await countStatements(() => viewOf(without))
		const withBare = await countStatements(() => viewOf(w))
		console.info(`firsthand stored-cast read: without a bare scene ${base.statements}, with one ${withBare.statements}`)
		expect(withBare.statements).toBe(base.statements + 1)
	})

	test("statements: no slot; a slot with three members", async () => {
		const w = await world()
		await place(w, "Verity", "Hall", null)
		await place(w, "Cole", "Hall", null)
		await place(w, "Bram", "Hall", null)
		const none = await countStatements(() => viewOf(w))
	const noneJudging = await countStatements(() => viewOf(w, { judgeHistoryEntries: true }))
		const three = await countStatements(() =>
			viewOf(w, { slotId: PLACE, lineIds: w.lines.map((l) => l.id), sceneIds: Object.values(w.scenes) })
		)
		const threeJudging = await countStatements(() =>
		viewOf(w, {
			slotId: PLACE,
			lineIds: w.lines.map((l) => l.id),
			sceneIds: Object.values(w.scenes),
			judgeHistoryEntries: true
		})
	)
	console.info(
		`firsthand statements: no slot ${none.statements}, no slot judging history entries ${noneJudging.statements}, slot with 3 members ${three.statements}, slot with 3 members judging history entries ${threeJudging.statements}`
	)
	// Judging history entries with no slot adds nothing; with a slot it adds no query per entry or scene.
	expect(noneJudging.statements).toBe(none.statements)
	expect(threeJudging.statements).toBeLessThanOrEqual(three.statements)
		// Measured 13 and 70 (see the logged line for the history-entry reads): one trail (about 19 statements) per member, never per message or scene.
		expect(none.statements).toBeLessThanOrEqual(13)
		expect(three.statements).toBeLessThanOrEqual(70)
		expect(none.statements).toBeGreaterThan(0)
		expect(three.statements).toBeGreaterThan(none.statements)
	})
})
