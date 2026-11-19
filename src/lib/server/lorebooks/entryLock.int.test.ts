/**
 * 🚧 The entry lock beyond the host's writers: a person's hand edit still
 * works; `forget`, a ruleset tie's field write, Back (`retractImprints`,
 * a notes entry anchored to the taken turn) and the automatic Apply leave a
 * locked entry as it is; a held change on it stays held, is listed with
 * `entryLocked`, does not hold the settle line back, and a person's Apply of
 * it lands.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq, isNotNull } from "drizzle-orm"
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

const UPDATE = { key: "change", definitionId: "core:outlet/update-lore-entry" } as any
const DAY = { year: 4, month: 2, day: 9 }
const asDb = () => db as unknown as Db
const lore = () => import("$lib/server/lorebooks/ownBook")

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-entry-lock-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

async function world() {
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(db, `entry-lock-b-${suffix}`)
	await db.insert(schema.userSettings).values({ userId: user.id, loreWriteMode: "full" })
	const [book] = await db.insert(schema.lorebooks).values({ userId: user.id, name: `World ${suffix}` }).returning()
	const [vault] = await db
		.insert(schema.lorebookEntries)
		.values({
			lorebookId: book!.id,
			typeId: LOCATION_TYPE_ID,
			typeVersion: 1,
			position: ++n,
			title: "The Vault",
			content: "Locked.",
			fields: { category: "Rooms" }
		})
		.returning()
	const [session] = await db
		.insert(schema.sessions)
		.values({ userId: user.id, isGroup: false, name: `Run ${suffix}`, lorebookId: book!.id })
		.returning()
	const { insertOwnBook } = await lore()
	await insertOwnBook(asDb(), {
		sessionId: session!.id,
		userId: user.id,
		name: null,
		overlayOf: book!.id,
		primaryRuleset: "core:ruleset/freeform@1",
		rulesetVersion: null
	})
	return { user, book: book!, vault: vault!, session: session! }
}
type World = Awaited<ReturnType<typeof world>>

const lock = (id: number, entryLock = true) =>
	db.update(schema.lorebookEntries).set({ entryLock }).where(eq(schema.lorebookEntries.id, id))
const entry = async (id: number) =>
	(await db.select().from(schema.lorebookEntries).where(eq(schema.lorebookEntries.id, id)))[0]
const messageIn = async (sessionId: number) => {
	const [legacy] = await db.insert(schema.sessionMessages).values({ sessionId, role: "assistant", content: "…" }).returning()
	await db.insert(schema.messages).values({ id: legacy!.id, sessionId, role: "assistant" })
	return legacy!
}
const notesOf = async (sessionId: number) => (await (await lore()).ownBookFor(asDb(), sessionId)).id
async function note(sessionId: number, title: string, sourceMessageId: number | null, extra: object = {}) {
	const [row] = await db
		.insert(schema.lorebookEntries)
		.values({
			lorebookId: await notesOf(sessionId),
			typeId: WORLD_LORE_TYPE_ID,
			typeVersion: 1,
			position: ++n,
			title,
			content: `About ${title}.`,
			sourceMessageId,
			...extra
		})
		.returning()
	return row!
}

describe("what is not stopped: a person's hand edit", () => {
	it("entries:update of a locked entry works", async () => {
		const w = await world()
		await lock(w.vault.id)
		const { updateEntryHandler } = await import("$lib/server/sockets/entries")
		await updateEntryHandler.handler(
			{ user: { id: w.user.id } } as any,
			{ entry: { typeId: LOCATION_TYPE_ID, id: w.vault.id, content: "By hand." } as any },
			(async () => undefined) as any
		)
		const row = (await entry(w.vault.id))!
		expect(row.content).toBe("By hand.")
		expect(row.entryLock).toBe(true)
	})
})

describe("forget", () => {
	it("leaves a locked note unarchived and archives the unlocked one", async () => {
		const w = await world()
		const locked = await note(w.session.id, "Alpha", null, { provenance: "pipeline", entryLock: true })
		const free = await note(w.session.id, "Beta", null, { provenance: "pipeline" })
		const { forgetNote } = await import("$lib/server/sessions/forgetNote")
		expect(await forgetNote(asDb(), w.session.id, "Alpha")).toEqual([])
		expect((await entry(locked.id))!.archived).toBe(false)
		expect(await forgetNote(asDb(), w.session.id, "Beta")).toEqual([free.id])
	})
})

describe("a ruleset tie's field write", () => {
	it("writes nothing to a locked entry and names why; the same write unlocked lands", async () => {
		const w = await world()
		const own = await notesOf(w.session.id)
		const held = await note(w.session.id, "A ribbon", null, { typeId: WORLD_LORE_TYPE_ID, fields: { worn: "new" }, entryLock: true })
		const [message] = [await messageIn(w.session.id)]
		const { writeLandings } = await import("$lib/server/rulesets/ties")
		const ctx = { sessionId: w.session.id, ruleset: { entryTypes: [] } as any, runId: "run-tie", messageId: message.id }
		const landing = {
			kind: "held" as const,
			ownerKey: `session:${w.session.id}`,
			zoneType: "pocket",
			index: 0,
			entry: { entryId: held.id, entryType: "keepsake", name: "A ribbon", fields: { worn: "worn" } },
			entryType: "keepsake",
			columns: [{ target: "entry-field" as const, field: "worn", value: "worn", was: "new" }],
			moved: {},
			made: false
		}
		const [fact] = await writeLandings(asDb(), ctx, [landing as any], [])
		expect(fact!.skipped).toBe("its entry 'A ribbon' is locked")
		expect(fact!.columns).toEqual([])
		expect(((await entry(held.id))!.fields as any).worn).toBe("new")
		await lock(held.id, false)
		const [again] = await writeLandings(asDb(), ctx, [landing as any], [])
		expect(again!.skipped).toBeUndefined()
		expect(((await entry(held.id))!.fields as any).worn).toBe("worn")
		void own
	})
})

describe("Back leaves a locked entry as it is", () => {
	const swipe = async (messageId: number) => {
		const { retractStateAnchoredTo } = await import("$lib/server/state/write")
		return retractStateAnchoredTo(asDb(), messageId, "replaced")
	}
	const imprints = async (sessionId: number) => (await import("$lib/server/lorebooks/imprints")).imprintsOf(asDb(), sessionId)

	it("an entry the run changed and one it made: kept, nothing reverted or removed; unlocked they go back", async () => {
		const w = await world()
		const m = await messageIn(w.session.id)
		const { imprintChanges, imprintMade, entryFieldAddress } = await import("$lib/server/lorebooks/imprints")
		const was = (await entry(w.vault.id))!
		const [wrote] = await db
			.update(schema.lorebookEntries)
			.set({ content: "Sealed.", updatedAt: new Date() })
			.where(eq(schema.lorebookEntries.id, w.vault.id))
			.returning()
		const anchor = { sessionId: w.session.id, messageId: m.id, runId: "run-back" }
		await imprintChanges(
			asDb(),
			anchor,
			{ lorebookId: w.book.id, subject: "entry", subjectId: w.vault.id },
			was as Record<string, unknown>,
			wrote as Record<string, unknown>,
			["content"]
		)
		const [made] = await db
			.insert(schema.lorebookEntries)
			.values({ lorebookId: w.book.id, typeId: LOCATION_TYPE_ID, typeVersion: 1, position: ++n, title: "The Annex", content: "New.", fields: { category: "Rooms" } })
			.returning()
		await imprintMade(asDb(), anchor, { lorebookId: w.book.id, subject: "entry", subjectId: made!.id })
		void entryFieldAddress
		await lock(w.vault.id)
		await lock(made!.id)

		await swipe(m.id)
		expect((await entry(w.vault.id))!.content).toBe("Sealed.")
		expect(await entry(made!.id)).toBeDefined()
		expect((await imprints(w.session.id)).map((i) => i.status)).toEqual(["kept", "kept"])

		// Unlocked and still standing, the same walk takes them back.
		const m2 = await messageIn(w.session.id)
		const free = (await entry(w.vault.id))!
		await lock(w.vault.id, false)
		const [again] = await db
			.update(schema.lorebookEntries)
			.set({ content: "Again.", updatedAt: new Date() })
			.where(eq(schema.lorebookEntries.id, w.vault.id))
			.returning()
		await imprintChanges(
			asDb(),
			{ sessionId: w.session.id, messageId: m2.id, runId: "run-back-2" },
			{ lorebookId: w.book.id, subject: "entry", subjectId: w.vault.id },
			free as Record<string, unknown>,
			again as Record<string, unknown>,
			["content"]
		)
		await swipe(m2.id)
		expect((await entry(w.vault.id))!.content).toBe("Sealed.")
	})

	it("a locked notes entry anchored to the taken turn stays; an unlocked one goes", async () => {
		const w = await world()
		const m = await messageIn(w.session.id)
		const locked = await note(w.session.id, "Kept", m.id, { entryLock: true })
		const free = await note(w.session.id, "Gone", m.id)
		const { takeOwnBookEntriesAnchoredTo } = await lore()
		const taken = await takeOwnBookEntriesAnchoredTo(asDb(), w.session.id, [m.id])
		expect(taken.map((r) => r.id)).toEqual([free.id])
		expect(await entry(locked.id)).toBeDefined()
	})
})

describe("the automatic Apply and the settle line", () => {
	const DAYCLOCK = (day: number | null) =>
		({
			storyClockYear: day == null ? null : DAY.year,
			storyClockMonth: day == null ? null : DAY.month,
			storyClockDay: day
		}) as const
	/** A held change on the vault, made under Review changes. */
	async function heldChange(w: World, data: Record<string, unknown>) {
		const m = await messageIn(w.session.id)
		const mode = (loreWriteMode: "full" | "review") =>
			db.update(schema.userSettings).set({ loreWriteMode }).where(eq(schema.userSettings.userId, w.user.id))
		await db.update(schema.sessions).set(DAYCLOCK(DAY.day)).where(eq(schema.sessions.id, w.session.id))
		await mode("review")
		try {
			const { createHost } = await import("$lib/server/pipelines/runtime/host")
			await createHost(asDb(), { sessionId: w.session.id, userId: w.user.id, runId: `run-${++n}` }).commit!(
				{ entry: w.vault.id, ...data },
				UPDATE
			)
		} finally {
			await db.update(schema.sessions).set(DAYCLOCK(null)).where(eq(schema.sessions.id, w.session.id))
			await mode("full")
		}
		return m
	}
	const heldRows = async (sessionId: number) =>
		db
			.select()
			.from(schema.entryAmendments)
			.where(and(eq(schema.entryAmendments.lorebookId, await notesOf(sessionId)), isNotNull(schema.entryAmendments.base)))

	it("close-out skips a locked entry's held change and a locked note, lists them entryLocked, and settles past them; a person's Apply then lands", async () => {
		const w = await world()
		const first = await heldChange(w, { content: "Sealed." })
		const mid = await messageIn(w.session.id)
		const lockedNote = await note(w.session.id, "Locked note", mid.id, { entryLock: true })
		const last = await messageIn(w.session.id)
		const freeNote = await note(w.session.id, "Free note", last.id)
		await lock(w.vault.id)

		const { applyHeldAutomatically, overlayItemsOf, applyOverlayItems } = await lore()
		const done = await applyHeldAutomatically(asDb(), { sessionId: w.session.id, automatic: "close-out" })
		expect(done!.applied).toEqual([freeNote.id])
		expect(done!.appliedChanges).toEqual([])
		const [held] = await heldRows(w.session.id)
		expect(held).toBeDefined()
		expect(await entry(lockedNote.id)).toBeDefined()
		expect((await entry(w.vault.id))!.content).toBe("Locked.")
		const items = await overlayItemsOf(asDb(), w.session.id)
		expect(items.filter((i) => (i as any).entryLocked === true).map((i) => i.kind).sort()).toEqual(["entry", "entry-change"])
		// The settle line moved past what waits for a person.
		const [session] = await db.select().from(schema.sessions).where(eq(schema.sessions.id, w.session.id))
		expect((session as any).settledMessageId ?? done!.settled?.settledMessageId).toBeGreaterThanOrEqual(last.id)
		void first

		const person = await applyOverlayItems(asDb(), {
			sessionId: w.session.id,
			userId: w.user.id,
			entryIds: [],
			amendmentIds: [held!.id]
		})
		expect(person.appliedChanges).toEqual([held!.id])
		// Dated: it lands as a version of the lorebook's entry, no longer held.
		expect(await heldRows(w.session.id)).toEqual([])
	})
})
