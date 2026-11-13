/**
 * 🚧 The Apply and Take back lists and what moves them: who reads them (every
 * member), who may press (the lorebook's owner only), the room push after a
 * press, a take-back and an automatic Apply, and the settle line a press
 * announces.
 */
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi
} from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { WORLD_LORE_TYPE_ID } from "$lib/shared/entries/types"
import { interestKey } from "$lib/shared/sockets/interest"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
})

const sessionEventSpy = vi.fn()
vi.mock(
	"$lib/server/pipelines/runtime/sessionEvents",
	async (importOriginal) => ({
		...(await importOriginal<
			typeof import("$lib/server/pipelines/runtime/sessionEvents")
		>()),
		emitSessionEvent: (...args: any[]) => sessionEventSpy(...args)
	})
)

let db: TestDb
let dataDir: string
let n = 0
const asDb = () => db as unknown as Db
const lore = () => import("$lib/server/lorebooks/ownBook")

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-apply-lists-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

beforeEach(() => sessionEventSpy.mockReset())

/** An io whose sockets are named by user and whose deliveries are recorded. */
function fakeIo() {
	const rooms = new Map<string, Set<string>>()
	const sockets = new Map<string, any>()
	const emitted: { to: string; event: string; data: any }[] = []
	const io = {
		sockets: { adapter: { rooms }, sockets },
		to: (to: string) => ({
			emit: (event: string, data: any) =>
				emitted.push({ to, event, data })
		}),
		in: () => ({ fetchSockets: async () => [] })
	}
	return {
		io,
		emitted,
		/** The user has a tab open on this session's two lists. */
		watch(userId: number, sessionId: number) {
			const id = `socket-${userId}`
			sockets.set(id, {
				id,
				interest: new Set([
					interestKey("sessions:overlayItems", sessionId),
					interestKey("sessions:appliedBatches", sessionId)
				])
			})
			rooms.set(`user_${userId}`, new Set([id]))
		},
		to: (userId: number, event: string) =>
			emitted.filter(
				(e) => e.to === `socket-${userId}` && e.event === event
			)
	}
}

const socketOf = (userId: number, io: unknown) =>
	({ user: { id: userId }, io }) as any

async function world() {
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const owner = await createTestUser(db, `lists-owner-${suffix}`)
	const member = await createTestUser(db, `lists-member-${suffix}`)
	const stranger = await createTestUser(db, `lists-stranger-${suffix}`)
	await db
		.insert(schema.userSettings)
		.values({ userId: owner.id, loreWriteMode: "full" })
	const [book] = await db
		.insert(schema.lorebooks)
		.values({ userId: owner.id, name: `World ${suffix}` })
		.returning()
	const [session] = await db
		.insert(schema.sessions)
		.values({
			userId: owner.id,
			isGroup: true,
			name: `Run ${suffix}`,
			lorebookId: book!.id
		})
		.returning()
	await db
		.insert(schema.sessionGuests)
		.values({ sessionId: session!.id, userId: member.id, isPlayer: true })
	const { insertOwnBook, ownBookFor } = await lore()
	await insertOwnBook(asDb(), {
		sessionId: session!.id,
		userId: owner.id,
		name: null,
		overlayOf: book!.id,
		primaryRuleset: "core:ruleset/freeform@1",
		rulesetVersion: null
	})
	const notes = (await ownBookFor(asDb(), session!.id)).id
	const turns: number[] = []
	const entries: number[] = []
	for (let i = 0; i < 3; i++) {
		const [m] = await db
			.insert(schema.sessionMessages)
			.values({ sessionId: session!.id, role: "assistant", content: "…" })
			.returning()
		await db
			.insert(schema.messages)
			.values({ id: m!.id, sessionId: session!.id, role: "assistant" })
		turns.push(m!.id)
		const [entry] = await db
			.insert(schema.lorebookEntries)
			.values({
				lorebookId: notes,
				typeId: WORLD_LORE_TYPE_ID,
				typeVersion: 1,
				position: ++n,
				title: `Note ${suffix}-${i}`,
				content: "Something.",
				sourceMessageId: m!.id
			})
			.returning()
		entries.push(entry!.id)
	}
	return {
		owner,
		member,
		stranger,
		book: book!,
		session: session!,
		turns,
		entries
	}
}

const noEmit = () => {}

describe("the two lists: who reads, who presses", () => {
	it("a member reads both with mayApply false, the owner with true, a stranger is refused", async () => {
		const {
			sessionsOverlayItemsHandler: items,
			sessionsAppliedBatchesHandler: batches
		} = await import("./sessions")
		const w = await world()
		const asMember = await items.handler(
			socketOf(w.member.id, {}),
			{ sessionId: w.session.id },
			noEmit
		)
		expect(asMember).toMatchObject({
			sessionId: w.session.id,
			mayApply: false,
			appliesItself: true
		})
		expect(asMember.items).toHaveLength(3)
		const asOwner = await items.handler(
			socketOf(w.owner.id, {}),
			{ sessionId: w.session.id },
			noEmit
		)
		expect(asOwner).toMatchObject({ mayApply: true, appliesItself: true })
		expect(
			await batches.handler(
				socketOf(w.member.id, {}),
				{ sessionId: w.session.id },
				noEmit
			)
		).toEqual({
			sessionId: w.session.id,
			batches: [],
			mayApply: false
		})
		expect(
			await batches.handler(
				socketOf(w.owner.id, {}),
				{ sessionId: w.session.id },
				noEmit
			)
		).toMatchObject({
			mayApply: true
		})
		for (const h of [items, batches]) {
			const emit = vi.fn()
			await expect(
				h.handler(
					socketOf(w.stranger.id, {}),
					{ sessionId: w.session.id },
					emit
				)
			).rejects.toThrow("This session is not one you are in.")
			expect(
				emit.mock.calls.find((c) => c[0] === `${h.event}:error`)?.[1]
			).toMatchObject({
				error: "This session is not one you are in."
			})
		}
	})

	it("appliesItself is true only under Full for the owner's own session (a property of the session, the same for every member)", async () => {
		const { sessionsOverlayItemsHandler: items } = await import(
			"./sessions"
		)
		const w = await world()
		await db
			.update(schema.userSettings)
			.set({ loreWriteMode: "review" })
			.where(eq(schema.userSettings.userId, w.owner.id))
		expect(
			await items.handler(
				socketOf(w.owner.id, {}),
				{ sessionId: w.session.id },
				noEmit
			)
		).toMatchObject({
			mayApply: true,
			appliesItself: false
		})
		await db
			.update(schema.userSettings)
			.set({ loreWriteMode: "full" })
			.where(eq(schema.userSettings.userId, w.owner.id))
		// A session that is someone else's (the owner of the book is only a guest in it) does not apply itself.
		await db
			.update(schema.sessions)
			.set({ userId: w.member.id })
			.where(eq(schema.sessions.id, w.session.id))
		await db
			.insert(schema.sessionGuests)
			.values({
				sessionId: w.session.id,
				userId: w.owner.id,
				isPlayer: true
			})
		expect(
			await items.handler(
				socketOf(w.owner.id, {}),
				{ sessionId: w.session.id },
				noEmit
			)
		).toMatchObject({
			mayApply: true,
			appliesItself: false
		})
	})
})

describe("Apply, Take back and the room", () => {
	it("a pressed Apply announces the settle line and both lists reach the second member", async () => {
		const { sessionsApplyOverlayHandler: apply } = await import(
			"./sessions"
		)
		const { sessionEvents } = await import("@serene-pub/sdk")
		const w = await world()
		const room = fakeIo()
		room.watch(w.owner.id, w.session.id)
		room.watch(w.member.id, w.session.id)
		const res = await apply.handler(
			socketOf(w.owner.id, room.io),
			{ sessionId: w.session.id },
			noEmit
		)
		expect(res.applied).toHaveLength(3)
		const [row] = await db
			.select()
			.from(schema.sessions)
			.where(eq(schema.sessions.id, w.session.id))
		expect(row!.settledMessageId).toBe(w.turns[2])
		expect(sessionEventSpy).toHaveBeenCalledTimes(1)
		expect(sessionEventSpy.mock.calls[0]![1]).toMatchObject({
			sessionId: w.session.id,
			event: sessionEvents.historySettled
		})
		const seen = room.to(w.member.id, "sessions:overlayItems")
		expect(seen).toHaveLength(1)
		expect(seen[0]!.data).toMatchObject({
			sessionId: w.session.id,
			items: [],
			mayApply: false
		})
		const lists = room.to(w.member.id, "sessions:appliedBatches")
		expect(lists[0]!.data).toMatchObject({
			sessionId: w.session.id,
			mayApply: false
		})
		expect(lists[0]!.data.batches).toHaveLength(1)
		expect(lists[0]!.data.batches[0]).toMatchObject({
			batch: res.batch,
			count: 3
		})
		expect(
			room.to(w.owner.id, "sessions:appliedBatches")[0]!.data.mayApply
		).toBe(true)
	})

	it("a member's take-back answers the owner-only sentence and changes nothing; the owner's answers null and both lists reach the second member", async () => {
		const {
			sessionsApplyOverlayHandler: apply,
			sessionsTakeBackApplyHandler: takeBack
		} = await import("./sessions")
		const { APPLY_OVERLAY_REFUSALS, ownBookFor } = await lore()
		const w = await world()
		const applied = await apply.handler(
			socketOf(w.owner.id, fakeIo().io),
			{ sessionId: w.session.id },
			noEmit
		)
		const batch = applied.batch!
		const inBook = async () =>
			(
				await db
					.select({ id: schema.lorebookEntries.id })
					.from(schema.lorebookEntries)
					.where(eq(schema.lorebookEntries.lorebookId, w.book.id))
			).length

		const emit = vi.fn()
		const refused = await takeBack.handler(
			socketOf(w.member.id, fakeIo().io),
			{ sessionId: w.session.id, batch },
			emit
		)
		expect(refused).toEqual({
			sessionId: w.session.id,
			batch,
			refused: APPLY_OVERLAY_REFUSALS.notOwner
		})
		expect(
			emit.mock.calls.some((c) => String(c[0]).endsWith(":error"))
		).toBe(false)
		expect(await inBook()).toBeGreaterThanOrEqual(3)
		const heldBefore = await inBook()

		const room = fakeIo()
		room.watch(w.owner.id, w.session.id)
		room.watch(w.member.id, w.session.id)
		const done = await takeBack.handler(
			socketOf(w.owner.id, room.io),
			{ sessionId: w.session.id, batch },
			noEmit
		)
		expect(done).toEqual({ sessionId: w.session.id, batch, refused: null })
		expect(await inBook()).toBe(heldBefore - 3)
		const items = room.to(w.member.id, "sessions:overlayItems")
		expect(items[0]!.data.items).toHaveLength(3)
		expect(
			room.to(w.member.id, "sessions:appliedBatches")[0]!.data.batches
		).toEqual([])
		expect((await ownBookFor(asDb(), w.session.id)).id).toBeGreaterThan(0)
	})

	it("a take-back with a bad batch or session is an error, not a refusal", async () => {
		const { sessionsTakeBackApplyHandler: takeBack } = await import(
			"./sessions"
		)
		const w = await world()
		const emit = vi.fn()
		await expect(
			takeBack.handler(
				socketOf(w.owner.id, {}),
				{ sessionId: w.session.id, batch: "" },
				emit
			)
		).rejects.toThrow()
		await expect(
			takeBack.handler(
				socketOf(w.owner.id, {}),
				{ sessionId: 1.5, batch: "x" } as any,
				emit
			)
		).rejects.toThrow()
		expect(
			emit.mock.calls.filter(
				(c) => c[0] === "sessions:takeBackApply:error"
			)
		).toHaveLength(2)
	})

	it("a second member's lists refresh after an automatic Apply", async () => {
		const { applyHeldAutomaticallyAndTell } = await import("./sessions")
		const w = await world()
		const room = fakeIo()
		room.watch(w.owner.id, w.session.id)
		room.watch(w.member.id, w.session.id)
		const [scene] = await db
			.insert(schema.scenes)
			.values({
				sessionId: w.session.id,
				lorebookId: w.book.id,
				channel: "main",
				openedAtMessageId: w.turns[0]!,
				closedAtMessageId: w.turns[1]!
			})
			.returning()
		await applyHeldAutomaticallyAndTell(asDb(), {
			sessionId: w.session.id,
			automatic: "scene-close",
			sceneId: scene!.id,
			io: room.io
		})
		const items = room.to(w.member.id, "sessions:overlayItems")
		expect(items).toHaveLength(1)
		expect(items[0]!.data.items).toHaveLength(1)
		const batches = room.to(w.member.id, "sessions:appliedBatches")[0]!.data
		expect(batches.batches).toHaveLength(1)
		expect(batches.batches[0]).toMatchObject({
			automatic: "scene-close",
			sceneId: scene!.id,
			by: null
		})
		expect(sessionEventSpy).toHaveBeenCalledTimes(1)
		expect(sessionEventSpy.mock.calls[0]![1].payload.cause).toEqual({
			kind: "system"
		})
		// Nothing left to apply: no second push.
		await applyHeldAutomaticallyAndTell(asDb(), {
			sessionId: w.session.id,
			automatic: "scene-close",
			sceneId: scene!.id,
			io: room.io
		})
		expect(room.to(w.member.id, "sessions:overlayItems")).toHaveLength(1)
	})
})
