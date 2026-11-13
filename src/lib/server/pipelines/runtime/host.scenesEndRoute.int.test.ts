/**
 * 🚧 (sense-b4) The rule, end to end, with the real predicate. A session that
 * reads an attached lorebook and whose scenes end by themselves
 * (`scenesEndByThemselves`: the scenes routine is registered and not Off, the
 * scene mode is Automatic, scenes may be placed) writes a pipeline's new
 * place, link or history day to its own book whatever the lorebook's write
 * setting (Full here), and the lorebook takes them only by Apply, which runs by
 * itself as a scene closes when the session's owner owns the lorebook. Every
 * other session writes straight to the lorebook, as before.
 *
 * Bootstrapped world, no mock of the predicate: sessions are made through the
 * create handler from real presets; the writes go through `createHost(…).commit`.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { HISTORY_TYPE_ID, LOCATION_TYPE_ID } from "$lib/shared/entries/types"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 })

let db: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "scenes-end-route-int-test-secret" }
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

class FakeAdapter {
	abort() {}
	async preflight() {}
	withStops() {
		return this
	}
	withStreaming() {
		return this
	}
	withCompiledPrompt() {
		return this
	}
	async generateText() {
		return {
			compiledPrompt: { prompt: "p", messages: undefined, meta: {} },
			isAborted: false,
			completionResult: async (onContent: (c: string) => void) =>
				onContent("They walk on.")
		}
	}
}
vi.mock("$lib/server/utils/getConnectionAdapter", () => ({
	getConnectionAdapter: async () => ({ Adapter: FakeAdapter })
}))

const SCENES = "core:spec/scene-boundaries"
const CREATE = {
	key: "file",
	definitionId: "core:outlet/create-lore-entry"
} as any
const LINK = {
	key: "tie",
	definitionId: "core:outlet/link-lore-entries"
} as any

const asDb = () => db as unknown as Db
let ownerId: number
let n = 0
const emit = () => {}
const quietIo = () => ({
	sockets: {
		adapter: { rooms: { get: () => undefined } },
		sockets: { get: () => undefined, values: () => [].values() }
	},
	to: () => ({ emit: () => {} })
})
const fakeSocket = (uid: number) =>
	({ user: { id: uid, isAdmin: false }, io: quietIo() }) as any
async function settle() {
	await (
		await import("$lib/server/pipelines/runtime/sessionEvents")
	).settleSessionEvents()
}

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-scenes-end-route-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(db)
	const { createTestUser } = await import("$lib/server/utils/testDb")
	ownerId = (await createTestUser(db, "scenes-end-owner")).id
	await db
		.insert(schema.userSettings)
		.values({ userId: ownerId, loreWriteMode: "full" })
}, 180_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {})
})

type Mode = "suggested" | "automatic" | "manual"

/**
 * A session of `who` (the owner unless named) made from a preset, attached to
 * `bookId` (a fresh lorebook of the owner unless named), its scene mode set.
 */
async function make(
	opts: {
		seedKey?: string
		mode?: Mode
		who?: number
		bookId?: number
		characters?: number
	} = {}
) {
	const name = `end-${++n}`
	const who = opts.who ?? ownerId
	const bookId =
		opts.bookId ??
		(
			await db
				.insert(schema.lorebooks)
				.values({ userId: ownerId, name: `The Mill ${name}` })
				.returning()
		)[0]!.id
	const seedKey = opts.seedKey ?? "core-story-living"
	const [p] = await db
		.select({ id: schema.sessionPresets.id })
		.from(schema.sessionPresets)
		.where(eq(schema.sessionPresets.seedKey, seedKey))
	expect(p, seedKey).toBeTruthy()
	const characterIds: number[] = []
	for (let i = 0; i < (opts.characters ?? 1); i++) {
		const [c] = await db
			.insert(schema.characters)
			.values({
				userId: who,
				name: `Maren ${name} ${i}`,
				description: "A miller.",
				isPersona: false
			})
			.returning()
		characterIds.push(c!.id)
	}
	const { sessionsCreateHandler } = await import(
		"$lib/server/sockets/sessions"
	)
	const res: any = await sessionsCreateHandler.handler(
		fakeSocket(who),
		{
			session: { name, presetId: p!.id },
			characterIds,
			personaIds: [],
			characterPositions: {},
			tags: []
		} as any,
		emit
	)
	expect(res?.error, res?.error).toBeUndefined()
	await settle()
	const sessionId = res.session.id as number
	const [row] = await db
		.select({ metadata: schema.sessions.metadata })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
	await db
		.update(schema.sessions)
		.set({
			lorebookId: bookId,
			metadata: {
				...((row?.metadata as object) ?? {}),
				scenes: {
					...((row?.metadata as any)?.scenes ?? {}),
					mode: opts.mode ?? "automatic"
				}
			}
		})
		.where(eq(schema.sessions.id, sessionId))
	const { ownBookFor } = await import("$lib/server/lorebooks/ownBook")
	const own = await ownBookFor(asDb(), sessionId)
	const { insertLegacy } = await import("$lib/server/messages/store")
	const line = async (content = "We walk on.") =>
		(await insertLegacy(asDb(), {
			sessionId,
			role: "user",
			content
		} as any)) as { id: number }
	const host = async (
		runId = `run-${name}`,
		scope: Record<string, unknown> = {}
	) => {
		const { createHost } = await import(
			"$lib/server/pipelines/runtime/host"
		)
		return createHost(asDb(), {
			sessionId,
			userId: who,
			runId,
			...scope
		} as any)
	}
	const room = async (
		title: string,
		extra: Record<string, unknown> = {},
		runId?: string
	) =>
		(await (
			await host(runId)
		).commit!(
			{
				name: title,
				content: "A room.",
				params: { entryType: LOCATION_TYPE_ID },
				...extra
			},
			CREATE
		)) as any
	const day = async (content: string, date: number, runId?: string) =>
		(await (
			await host(runId)
		).commit!(
			{
				name: "Day",
				content,
				params: { entryType: HISTORY_TYPE_ID },
				fields: { year: 3, month: 2, day: date }
			},
			CREATE
		)) as any
	const tie = async (
		from: number | string,
		to: number | string,
		runId?: string
	) => (await (await host(runId)).commit!({ from, to }, LINK)) as any
	return { name, who, sessionId, bookId, own, line, host, room, day, tie }
}
type World = Awaited<ReturnType<typeof make>>

const hall = async (bookId: number, title = "The Hall") =>
	(
		await db
			.insert(schema.lorebookEntries)
			.values({
				lorebookId: bookId,
				typeId: LOCATION_TYPE_ID,
				typeVersion: 1,
				position: ++n,
				title,
				content: `${title}, as written.`,
				fields: { category: "Rooms" }
			})
			.returning()
	)[0]!

const entriesIn = (lorebookId: number, typeId?: string) =>
	db
		.select()
		.from(schema.lorebookEntries)
		.where(
			and(
				eq(schema.lorebookEntries.lorebookId, lorebookId),
				...(typeId ? [eq(schema.lorebookEntries.typeId, typeId)] : [])
			)
		)
		.orderBy(schema.lorebookEntries.id)
const linksIn = (lorebookId: number) =>
	db
		.select()
		.from(schema.narrativeRelationships)
		.where(eq(schema.narrativeRelationships.lorebookId, lorebookId))
const settledOf = async (sessionId: number) =>
	(
		await db
			.select()
			.from(schema.sessions)
			.where(eq(schema.sessions.id, sessionId))
	)[0]!.settledMessageId
const readNames = async (sessionId: number) =>
	(
		await (
			await import("$lib/server/lorebooks/ownBook")
		).sessionEntriesAsRead(asDb(), sessionId, "session", null)
	).map((e) => e.name)
const predicate = async (sessionId: number) =>
	(await import("$lib/server/lorebooks/ownBook")).scenesEndByThemselves(
		asDb(),
		sessionId
	)

/** Switch the scenes routine Off at session scope (the keeper's registration). */
async function routineOff(sessionId: number) {
	const { effectiveRegistrations } = await import(
		"$lib/server/pipelines/registrations/resolve"
	)
	const { rowOfChange } = await import(
		"$lib/server/pipelines/registrations/rows"
	)
	const { upsertRow } = await import(
		"$lib/server/pipelines/registrations/write"
	)
	const reg = (await effectiveRegistrations(
		db as never,
		sessionId
	))!.effective.find((r) => r.pipeline === SCENES)!
	expect(reg).toBeTruthy()
	await upsertRow(
		db as never,
		rowOfChange(
			{ key: reg.key, mode: "off" },
			{ kind: "session", sessionId },
			"owner"
		)
	)
}

describe("the real predicate and the route it picks", () => {
	it("Story · Living, Automatic: true, and a place goes to the own book", async () => {
		const w = await make()
		expect(await predicate(w.sessionId)).toBe(true)
		await w.line()
		const out = await w.room("The Cellar")
		expect(out).toMatchObject({ route: "own-book", lorebookId: w.own.id })
		expect(await entriesIn(w.bookId, LOCATION_TYPE_ID)).toHaveLength(0)
	})

	const straight: [string, () => Promise<World>][] = [
		[
			"a Chat session",
			() => make({ seedKey: "core-chat-basic", characters: 0 })
		],
		[
			"Story · Living with the scenes routine Off at session scope",
			async () => {
				const w = await make()
				await routineOff(w.sessionId)
				return w
			}
		],
		[
			"Story · Living with scene mode Suggested",
			() => make({ mode: "suggested" })
		],
		[
			"Story · Living with scene mode Manual",
			() => make({ mode: "manual" })
		],
		["Story · Minimal", () => make({ seedKey: "core-story-minimal" })]
	]
	it.each(straight)(
		"%s: false, and a place, a link and a history day go straight to the lorebook, as before",
		async (_label, build) => {
			const w = await build()
			expect(await predicate(w.sessionId)).toBe(false)
			const m = await w.line()
			// the settle line moves with sources only on the lorebook route
			const h = await w.host(`run-${w.name}-sources`, {
				readMessageIds: new Set([m.id])
			})
			const place: any = await h.commit!(
				{
					name: "The Cellar",
					content: "A room.",
					params: { entryType: LOCATION_TYPE_ID },
					sources: [{ id: m.id }]
				},
				CREATE
			)
			expect(place).toMatchObject({ route: "book", lorebookId: w.bookId })
			expect(await settledOf(w.sessionId)).toBe(m.id)
			const other = await hall(w.bookId, "The Hall")
			const link = await w.tie(place.id, other.id)
			expect(link.lorebookId).toBe(w.bookId)
			const dayOut = await w.day("A.", 9)
			expect(
				(await entriesIn(w.bookId, HISTORY_TYPE_ID)).map((r) => r.id)
			).toContain(dayOut.id)
			expect((await linksIn(w.bookId)).length).toBeGreaterThanOrEqual(1)
			expect(await entriesIn(w.own.id)).toHaveLength(0)
			expect(await linksIn(w.own.id)).toHaveLength(0)
		}
	)
})

/** A world meeting the rule with turn 2's writes on it: a room, a link to a lorebook room, a history day. */
async function wrote(opts: Parameters<typeof make>[0] = {}) {
	const w = await make(opts)
	const lore = await hall(w.bookId)
	const first = await w.line("We arrive.")
	const turn = await w.line("We go down.")
	const room = await w.room("The Cellar")
	const link = await w.tie(room.id, lore.id)
	const day = await w.day("Down we went.", 9)
	const last = await w.line("Later.")
	return {
		...w,
		lore,
		first,
		turn,
		last,
		roomId: room.id as number,
		linkId: link.id as number,
		dayId: day.id as number
	}
}

describe("under Full on your own lorebook, a session meeting the rule", () => {
	it("holds the room, the link and the day in its own book; only it reads them", async () => {
		const w = await wrote()
		expect(await predicate(w.sessionId)).toBe(true)
		const { lorebooksReadBy } = await import(
			"$lib/server/lorebooks/ownBook"
		)
		expect(await lorebooksReadBy(asDb(), w.sessionId)).toMatchObject({
			attachedId: w.bookId,
			ownBookId: w.own.id
		})
		const mine = await entriesIn(w.own.id)
		expect(mine.map((r) => r.id).sort()).toEqual([w.roomId, w.dayId].sort())
		const links = await linksIn(w.own.id)
		expect(links).toHaveLength(1)
		expect(links[0]).toMatchObject({
			id: w.linkId,
			fromEntryId: w.roomId,
			toEntryId: w.lore.id,
			branchId: null
		})
		// the room and the day (a nameless entry) are read: three entries in all
		expect(await readNames(w.sessionId)).toHaveLength(3)
		expect(await readNames(w.sessionId)).toEqual(
			expect.arrayContaining(["The Hall", "The Cellar"])
		)

		// The lorebook's own entries and links do not include them.
		expect((await entriesIn(w.bookId)).map((r) => r.id)).toEqual([
			w.lore.id
		])
		expect(await linksIn(w.bookId)).toHaveLength(0)

		// A second session of the same owner on the same lorebook does not see them.
		const other = await make({ bookId: w.bookId })
		expect(await readNames(other.sessionId)).not.toContain("The Cellar")
		expect(await readNames(other.sessionId)).toEqual(["The Hall"])
		expect(await readNames(other.sessionId)).toContain("The Hall")
		expect(await entriesIn(other.own.id)).toHaveLength(0)
	})

	it("loses them to a swipe and to Back, and Forward brings them back", async () => {
		const w = await wrote()
		const ids = async () =>
			(await entriesIn(w.own.id)).map((r) => r.id).sort()
		const wrote3 = [w.roomId, w.dayId].sort()
		expect(await ids()).toEqual(wrote3)
		const {
			retractStateAnchoredTo,
			restoreRetractedState,
			reviveRetractedState
		} = await import("$lib/server/state/write")

		// A swipe (the turn replaced) takes them; a failed re-tell puts them back.
		const swiped = await retractStateAnchoredTo(
			asDb(),
			w.turn.id,
			"replaced"
		)
		expect(swiped.changed).toBe(true)
		expect(await ids()).toEqual([])
		expect(await linksIn(w.own.id)).toHaveLength(0)
		expect(await restoreRetractedState(asDb(), swiped.taken)).toBe(true)
		expect(await ids()).toEqual(wrote3)
		expect(await linksIn(w.own.id)).toHaveLength(1)

		// Back takes them with the turn; Forward (the record read back from JSON) returns them.
		const undone = await db.transaction(async (tx) =>
			retractStateAnchoredTo(tx as unknown as Db, w.turn.id, "leaves", {
				leavingWith: [w.turn.id]
			})
		)
		expect(undone.changed).toBe(true)
		expect(await ids()).toEqual([])
		expect(await linksIn(w.own.id)).toHaveLength(0)
		expect(await entriesIn(w.bookId)).toHaveLength(1)
		const record = reviveRetractedState(
			JSON.parse(JSON.stringify(undone.taken)),
			w.sessionId
		)!
		expect(await restoreRetractedState(asDb(), record)).toBe(true)
		expect(await ids()).toEqual(wrote3)
		const links = await linksIn(w.own.id)
		expect(links).toHaveLength(1)
		expect(links[0]).toMatchObject({
			id: w.linkId,
			fromEntryId: w.roomId,
			toEntryId: w.lore.id
		})
	})

	it("reaches the lorebook when a scene covering the turn ends: room and link in it, the day the lorebook's, an apply record", async () => {
		const w = await wrote()
		const { openScene, closeScene } = await import(
			"$lib/server/scenes/liveScenes"
		)
		const opened = await openScene(asDb(), {
			sessionId: w.sessionId,
			userId: w.who,
			channel: "main",
			atMessageId: w.first.id
		})
		expect(
			await entriesIn(w.bookId, LOCATION_TYPE_ID).then((r) =>
				r.map((x) => x.title)
			)
		).toEqual(["The Hall"])
		await closeScene(asDb(), {
			sceneId: opened.scene.id,
			userId: w.who,
			atMessageId: w.last.id
		})
		await settle()

		const places = await entriesIn(w.bookId, LOCATION_TYPE_ID)
		expect(places.map((r) => r.title).sort()).toEqual([
			"The Cellar",
			"The Hall"
		])
		const cellar = places.find((r) => r.title === "The Cellar")!
		const links = await linksIn(w.bookId)
		expect(links).toHaveLength(1)
		expect(links[0]).toMatchObject({ toEntryId: w.lore.id })
		expect(links[0]!.fromEntryId).toBe(cellar.id)
		const days = await entriesIn(w.bookId, HISTORY_TYPE_ID)
		expect(days).toHaveLength(1)
		expect(await entriesIn(w.own.id, HISTORY_TYPE_ID)).toHaveLength(0)
		expect(await entriesIn(w.own.id, LOCATION_TYPE_ID)).toHaveLength(0)
		const records = await db
			.select()
			.from(schema.loreImprints)
			.where(
				and(
					eq(schema.loreImprints.sessionId, w.sessionId),
					eq(schema.loreImprints.origin, "apply")
				)
			)
		expect(records.length).toBeGreaterThan(0)
		expect(records[0]!.cause).toMatchObject({
			automatic: "scene-close",
			sceneId: opened.scene.id
		})
	})
})

describe("a member's session on the owner's lorebook, meeting the rule", () => {
	it("holds its room in its own book, and never applies by itself", async () => {
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const member = (await createTestUser(db, `scenes-end-member-${++n}`)).id
		await db
			.insert(schema.userSettings)
			.values({ userId: member, loreWriteMode: "full" })
		const w = await make({ who: member })
		expect(await predicate(w.sessionId)).toBe(true)
		await w.line("We arrive.")
		const room = await w.room("The Cellar")
		expect(room).toMatchObject({ route: "own-book", lorebookId: w.own.id })
		const closing = await w.line("Later.")
		const first = (
			await db
				.select({ id: schema.sessionMessages.id })
				.from(schema.sessionMessages)
				.where(eq(schema.sessionMessages.sessionId, w.sessionId))
				.orderBy(schema.sessionMessages.id)
		)[0]!
		const { openScene, closeScene } = await import(
			"$lib/server/scenes/liveScenes"
		)
		const opened = await openScene(asDb(), {
			sessionId: w.sessionId,
			userId: member,
			channel: "main",
			atMessageId: first.id
		})
		await closeScene(asDb(), {
			sceneId: opened.scene.id,
			userId: member,
			atMessageId: closing.id
		})
		await settle()
		const { applyHeldAutomatically } = await import(
			"$lib/server/lorebooks/ownBook"
		)
		expect(
			await applyHeldAutomatically(asDb(), {
				sessionId: w.sessionId,
				automatic: "scene-close",
				sceneId: opened.scene.id
			})
		).toBeNull()
		expect(
			(await entriesIn(w.own.id, LOCATION_TYPE_ID)).map((r) => r.title)
		).toEqual(["The Cellar"])
		expect(await entriesIn(w.bookId, LOCATION_TYPE_ID)).toHaveLength(0)
	})
})
