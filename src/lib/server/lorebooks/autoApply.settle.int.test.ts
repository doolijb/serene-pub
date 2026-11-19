/**
 * 🚧 The story settles when a scene closes (owner 2026-11-13, "Settle when a
 * scene closes"): on the book route under Full, `applyHeldAutomatically`
 * moves the settle line through the scene's end whether or not anything was
 * applied; never past a waiting summary's start nor the oldest item still
 * waiting; nothing on any other route, while a turn is taken back, or while
 * the scene's summary waits.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { LOCATION_TYPE_ID, WORLD_LORE_TYPE_ID } from "$lib/shared/entries/types"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
})

let db: TestDb
let dataDir: string
let n = 0
const asDb = () => db as unknown as Db
const lore = () => import("$lib/server/lorebooks/ownBook")

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-auto-apply-settle-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

async function world(mode: "full" | "review" | "off" = "full") {
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const { insertOwnBook } = await lore()
	const user = await createTestUser(db, `autoapply-settle-${suffix}`)
	await db
		.insert(schema.userSettings)
		.values({ userId: user.id, loreWriteMode: mode })
	const [book] = await db
		.insert(schema.lorebooks)
		.values({ userId: user.id, name: `World ${suffix}` })
		.returning()
	await db.insert(schema.lorebookEntries).values({
		lorebookId: book!.id,
		typeId: LOCATION_TYPE_ID,
		typeVersion: 1,
		position: ++n,
		title: "The Vault",
		content: "Locked."
	})
	const [session] = await db
		.insert(schema.sessions)
		.values({
			userId: user.id,
			isGroup: false,
			name: `Run ${suffix}`,
			lorebookId: book!.id
		})
		.returning()
	const own = await insertOwnBook(asDb(), {
		sessionId: session!.id,
		userId: user.id,
		name: null,
		overlayOf: book!.id,
		primaryRuleset: "core:ruleset/freeform@1",
		rulesetVersion: null
	})
	return { user, book: book!, session: session!, own }
}
type World = Awaited<ReturnType<typeof world>>

const messageIn = async (sessionId: number) => {
	const [legacy] = await db
		.insert(schema.sessionMessages)
		.values({ sessionId, role: "assistant", content: "…" })
		.returning()
	await db
		.insert(schema.messages)
		.values({ id: legacy!.id, sessionId, role: "assistant" })
	return legacy!
}

const messages = async (w: World, count: number) => {
	const out = []
	for (let i = 0; i < count; i++) out.push(await messageIn(w.session.id))
	return out
}

const scene = async (
	w: World,
	over: Partial<typeof schema.scenes.$inferInsert> = {}
) =>
	(
		await db
			.insert(schema.scenes)
			.values({
				sessionId: w.session.id,
				lorebookId: w.book.id,
				channel: "main",
				...over
			})
			.returning()
	)[0]!

const note = async (w: World, title: string, sourceMessageId: number | null) =>
	(
		await db
			.insert(schema.lorebookEntries)
			.values({
				lorebookId: w.own.id,
				typeId: WORLD_LORE_TYPE_ID,
				typeVersion: 1,
				position: ++n,
				title,
				content: `About ${title}.`,
				sourceMessageId
			})
			.returning()
	)[0]!

const settledOf = async (sessionId: number) =>
	(
		await db
			.select()
			.from(schema.sessions)
			.where(eq(schema.sessions.id, sessionId))
	)[0]!.settledMessageId

const auto = async (
	sessionId: number,
	automatic: "scene-close" | "scene-summary" | "close-out",
	sceneId?: number,
	before?: number
) =>
	(await lore()).applyHeldAutomatically(asDb(), {
		sessionId,
		automatic,
		sceneId,
		before
	})

const refused = async (messageId: number) => {
	const { assertRetractable } = await import("$lib/server/sessions/settle")
	return assertRetractable(asDb(), messageId).then(
		() => false,
		() => true
	)
}

describe("the story settles one scene behind when a scene closes", () => {
	it("with nothing to apply, a closed scene settles the story through the scene before it: Back into the scene that just closed is not refused", async () => {
		const w = await world()
		const m = await messages(w, 5)
		await scene(w, {
			openedAtMessageId: m[0]!.id,
			closedAtMessageId: m[1]!.id
		})
		const s1 = await scene(w, {
			openedAtMessageId: m[2]!.id,
			closedAtMessageId: m[3]!.id
		})
		const done = await auto(w.session.id, "scene-close", s1.id)
		expect(done).toMatchObject({
			applied: [],
			appliedChanges: [],
			stillHeld: [],
			dropped: [],
			appliedLinks: [],
			appliedTies: [],
			droppedTies: [],
			supersededTies: [],
			mergedDays: [],
			droppedLinks: [],
			heldDays: [],
			batch: null,
			userId: w.user.id,
			settled: {
				moved: true,
				settledMessageId: m[1]!.id,
				previousSettledMessageId: null
			}
		})
		expect(await settledOf(w.session.id)).toBe(m[1]!.id)
		expect(await refused(m[0]!.id)).toBe(true)
		expect(await refused(m[1]!.id)).toBe(true)
		expect(await refused(m[2]!.id)).toBe(false)
		expect(await refused(m[3]!.id)).toBe(false)
		// Asked again, the line has not moved: null.
		expect(await auto(w.session.id, "scene-close", s1.id)).toBeNull()
	})

	it("nothing settles while the scene's summary runs or is in review; it settles when the summary is saved", async () => {
		const w = await world()
		const m = await messages(w, 4)
		const s1 = await scene(w, {
			openedAtMessageId: m[1]!.id,
			closedAtMessageId: m[2]!.id,
			summaryStatus: "running"
		})
		expect(await auto(w.session.id, "scene-close", s1.id)).toBeNull()
		await db
			.update(schema.scenes)
			.set({ summaryStatus: "review" })
			.where(eq(schema.scenes.id, s1.id))
		expect(await auto(w.session.id, "scene-close", s1.id)).toBeNull()
		expect(await settledOf(w.session.id)).toBeNull()
		await db
			.update(schema.scenes)
			.set({ summaryStatus: "done" })
			.where(eq(schema.scenes.id, s1.id))
		const done = await auto(w.session.id, "scene-summary", s1.id)
		expect(done!.settled).toMatchObject({
			moved: true,
			settledMessageId: m[0]!.id
		})
		// The saved summary here is a person's, and a person's saved summary settles its own scene.
		expect(await refused(m[2]!.id)).toBe(true)
		expect(await refused(m[3]!.id)).toBe(false)
	})

	it("nothing settles while a turn is taken back", async () => {
		const w = await world()
		const m = await messages(w, 3)
		const s1 = await scene(w, {
			openedAtMessageId: m[0]!.id,
			closedAtMessageId: m[1]!.id
		})
		await db.insert(schema.sessionMessages).values({
			sessionId: w.session.id,
			role: "assistant",
			content: "…",
			rewindOrdinal: 1,
			isHidden: true
		} as never)
		expect(await auto(w.session.id, "scene-close", s1.id)).toBeNull()
		expect(await settledOf(w.session.id)).toBeNull()
	})

	it("under Review changes (the route is the session's notes) nothing settles", async () => {
		const w = await world("review")
		const m = await messages(w, 3)
		const s1 = await scene(w, {
			openedAtMessageId: m[0]!.id,
			closedAtMessageId: m[1]!.id
		})
		expect(await auto(w.session.id, "scene-close", s1.id)).toBeNull()
		await db
			.update(schema.lorebooks)
			.set({ loreWriteMode: "review" })
			.where(eq(schema.lorebooks.id, w.book.id))
		expect(await auto(w.session.id, "scene-close", s1.id)).toBeNull()
		expect(await settledOf(w.session.id)).toBeNull()
	})

	it("a person on Full whose book says Review: nothing settles", async () => {
		const w = await world("full")
		await db
			.update(schema.lorebooks)
			.set({ loreWriteMode: "review" })
			.where(eq(schema.lorebooks.id, w.book.id))
		const m = await messages(w, 3)
		const s1 = await scene(w, {
			openedAtMessageId: m[0]!.id,
			closedAtMessageId: m[1]!.id
		})
		expect(await auto(w.session.id, "scene-close", s1.id)).toBeNull()
		expect(await settledOf(w.session.id)).toBeNull()
	})

	it("a session whose notes are its whole lorebook: nothing settles", async () => {
		const w = await world()
		const { insertOwnBook } = await lore()
		const [alone] = await db
			.insert(schema.sessions)
			.values({ userId: w.user.id, isGroup: false, name: `Alone ${++n}` })
			.returning()
		const notes = await insertOwnBook(asDb(), {
			sessionId: alone!.id,
			userId: w.user.id,
			name: null,
			overlayOf: null,
			primaryRuleset: "core:ruleset/freeform@1",
			rulesetVersion: null
		})
		await db
			.update(schema.sessions)
			.set({ lorebookId: notes.id })
			.where(eq(schema.sessions.id, alone!.id))
		const a = await messageIn(alone!.id)
		const b = await messageIn(alone!.id)
		const [s1] = await db
			.insert(schema.scenes)
			.values({
				sessionId: alone!.id,
				lorebookId: notes.id,
				channel: "main",
				openedAtMessageId: a.id,
				closedAtMessageId: b.id
			})
			.returning()
		expect(await auto(alone!.id, "scene-close", s1!.id)).toBeNull()
		expect(await settledOf(alone!.id)).toBeNull()
	})

	it("a waiting summary's start caps the settle at the message before it", async () => {
		const w = await world()
		const m = await messages(w, 5)
		const s1 = await scene(w, {
			openedAtMessageId: m[3]!.id,
			closedAtMessageId: m[4]!.id
		})
		await scene(w, {
			channel: "side",
			openedAtMessageId: m[1]!.id,
			closedAtMessageId: m[2]!.id,
			summaryStatus: "running"
		})
		const done = await auto(w.session.id, "scene-close", s1.id)
		expect(done!.applied).toEqual([])
		expect(done!.settled).toMatchObject({
			moved: true,
			settledMessageId: m[1]!.id - 1
		})
		expect(await refused(m[2]!.id)).toBe(false)
	})

	it("an item still waiting before the scene's end keeps the settle below it", async () => {
		const w = await world()
		const m = await messages(w, 5)
		const [vault] = await db
			.select()
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.lorebookId, w.book.id))
		// A held change whose base is not what the lorebook holds: it stays held.
		await db.insert(schema.entryAmendments).values({
			lorebookId: w.own.id,
			entryId: vault!.id,
			year: null,
			fields: { content: "Sealed." },
			base: { content: { v: "Something else." } },
			sourceMessageId: m[2]!.id
		})
		const s1 = await scene(w, {
			openedAtMessageId: m[4]!.id,
			closedAtMessageId: m[4]!.id
		})
		const done = await auto(w.session.id, "scene-close", s1.id)
		expect(done!.appliedChanges).toEqual([])
		expect(done!.settled).toMatchObject({
			moved: true,
			settledMessageId: m[2]!.id - 1
		})
		expect(await refused(m[2]!.id)).toBe(false)
		expect(await refused(m[1]!.id)).toBe(true)
	})

	it("close-out settles through `before - 1`, else the newest message", async () => {
		const w = await world()
		const m = await messages(w, 4)
		const first = await auto(w.session.id, "close-out", undefined, m[2]!.id)
		expect(first!.settled).toMatchObject({
			moved: true,
			settledMessageId: m[2]!.id - 1
		})
		const second = await auto(w.session.id, "close-out")
		expect(second!.settled).toMatchObject({
			moved: true,
			settledMessageId: m[3]!.id,
			previousSettledMessageId: m[2]!.id - 1
		})
	})

	it("what is applied and what is settled come back together: the furthest settle, the Apply's previous", async () => {
		const w = await world()
		const m = await messages(w, 4)
		const keep = await note(w, "Ashfall Keep", m[0]!.id)
		const s1 = await scene(w, {
			openedAtMessageId: m[2]!.id,
			closedAtMessageId: m[3]!.id
		})
		const done = await auto(w.session.id, "scene-close", s1.id)
		expect(done).toMatchObject({
			applied: [keep.id],
			settled: {
				moved: true,
				settledMessageId: m[1]!.id,
				previousSettledMessageId: null
			}
		})
		expect(await settledOf(w.session.id)).toBe(m[1]!.id)
	})
})
