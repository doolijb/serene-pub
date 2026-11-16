/**
 * 🚧 **The Edit history at Apply and Take back** (owner, 2026-11-13/14): an
 * Apply of an undated held change is one `apply` row, its take-back one
 * `take-back` row; a dated change applied is a new version, not an edit; an
 * entry moved into the lorebook keeps its rows; a merged history day's text
 * arrives on the lorebook's day as one `apply` row.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { HISTORY_TYPE_ID, LOCATION_TYPE_ID } from "$lib/shared/entries/types"
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
const UPDATE = {
	key: "change",
	definitionId: "core:outlet/update-lore-entry"
} as any
const R = schema.loreRedlines

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-redlines-apply-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

async function world(clock?: { year: number; month: number; day: number }) {
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(db, `redlines-apply-${suffix}`)
	await db
		.insert(schema.userSettings)
		.values({ userId: user.id, loreWriteMode: "review" })
	const [book] = await db
		.insert(schema.lorebooks)
		.values({ userId: user.id, name: `World ${suffix}` })
		.returning()
	const place = async (title: string) =>
		(
			await db
				.insert(schema.lorebookEntries)
				.values({
					lorebookId: book!.id,
					typeId: LOCATION_TYPE_ID,
					typeVersion: 1,
					position: ++n,
					title,
					content: "Locked.",
					fields: { category: "Rooms" }
				})
				.returning()
		)[0]!
	const vault = await place("The Vault")
	const [session] = await db
		.insert(schema.sessions)
		.values({
			userId: user.id,
			isGroup: false,
			name: `Run ${++n}`,
			lorebookId: book!.id,
			...(clock
				? {
						storyClockYear: clock.year,
						storyClockMonth: clock.month,
						storyClockDay: clock.day
					}
				: {})
		})
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
	return { user, book: book!, vault, session: session! }
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

/** A session's turn changes the entry through the real outlet: held, so no row. */
async function change(
	w: World,
	entryId: number,
	data: Record<string, unknown>
) {
	const m = await messageIn(w.session.id)
	const { createHost } = await import("$lib/server/pipelines/runtime/host")
	const host = createHost(asDb(), {
		sessionId: w.session.id,
		userId: w.user.id,
		runId: `run-${++n}`
	})
	await host.commit!({ entry: entryId, ...data }, UPDATE)
	return m
}

const rowsOf = (entryId: number) =>
	db.select().from(R).where(eq(R.entryId, entryId)).orderBy(R.id)
const apply = async (w: World, more: Record<string, unknown> = {}) =>
	(await lore()).applyOverlayItems(asDb(), {
		sessionId: w.session.id,
		userId: w.user.id,
		...more
	})

describe("Apply and Take back", () => {
	it("a held change waits without a row; Apply is one apply row by the person; Take back is one take-back row", async () => {
		const w = await world()
		await change(w, w.vault.id, { content: "Sealed." })
		expect(await rowsOf(w.vault.id)).toHaveLength(0)

		const done = await apply(w)
		expect(done.appliedChanges).toHaveLength(1)
		let rows = await rowsOf(w.vault.id)
		expect(rows).toHaveLength(1)
		expect(rows[0]).toMatchObject({
			cause: "apply",
			userId: w.user.id,
			sessionId: w.session.id,
			changes: {
				content: { before: { v: "Locked." }, after: { v: "Sealed." } }
			}
		})

		const { takeBackApply } = await lore()
		await takeBackApply(asDb(), { batch: done.batch!, userId: w.user.id })
		rows = await rowsOf(w.vault.id)
		expect(rows.map((r) => r.cause)).toEqual(["apply", "take-back"])
		expect(rows[1]).toMatchObject({
			userId: w.user.id,
			sessionId: w.session.id,
			changes: {
				content: { before: { v: "Sealed." }, after: { v: "Locked." } }
			}
		})
	})

	it("an Apply made by itself names the session alone", async () => {
		const w = await world()
		await change(w, w.vault.id, { content: "Sealed." })
		await apply(w, { automatic: { automatic: "scene-close" } })
		const [row] = await rowsOf(w.vault.id)
		expect(row).toMatchObject({
			cause: "apply",
			userId: null,
			sessionId: w.session.id
		})
	})

	it("a dated held change applied leaves no row: it is a new version, not an edit", async () => {
		const w = await world({ year: 3, month: 2, day: 5 })
		await change(w, w.vault.id, { content: "Sealed." })
		const done = await apply(w)
		expect(done.appliedChanges).toHaveLength(1)
		expect(await rowsOf(w.vault.id)).toHaveLength(0)
	})

	it("an entry moved into the lorebook keeps its rows", async () => {
		const w = await world()
		const own = await (await lore()).ownBookFor(asDb(), w.session.id)
		const m = await messageIn(w.session.id)
		const [moved] = await db
			.insert(schema.lorebookEntries)
			.values({
				lorebookId: own.id,
				typeId: LOCATION_TYPE_ID,
				typeVersion: 1,
				position: ++n,
				title: "The Cellar",
				content: "Cold.",
				fields: {},
				sourceMessageId: m.id
			})
			.returning()
		const { recordRedline } = await import("./redlines")
		await recordRedline(asDb(), {
			entryId: moved!.id,
			before: { content: "Chilly." },
			after: { content: "Cold." },
			keys: ["content"],
			cause: "save",
			by: { userId: w.user.id }
		})
		const done = await apply(w)
		expect(done.applied).toContain(moved!.id)
		const [now] = await db
			.select()
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.id, moved!.id))
		expect(now!.lorebookId).toBe(w.book.id)
		expect((await rowsOf(moved!.id)).map((r) => r.cause)).toEqual(["save"])
	})

	it("a merged history day arrives on the lorebook's day as one apply row", async () => {
		const w = await world()
		const DAY = { year: 5, month: 2, day: 3 }
		const [loreDay] = await db
			.insert(schema.lorebookEntries)
			.values({
				lorebookId: w.book.id,
				typeId: HISTORY_TYPE_ID,
				typeVersion: 1,
				position: ++n,
				title: "The third of Frost",
				content: "Lore day.",
				fields: DAY
			})
			.returning()
		const own = await (await lore()).ownBookFor(asDb(), w.session.id)
		const m = await messageIn(w.session.id)
		const [day] = await db
			.insert(schema.lorebookEntries)
			.values({
				lorebookId: own.id,
				typeId: HISTORY_TYPE_ID,
				typeVersion: 1,
				position: ++n,
				title: `Own day ${n}`,
				content: "The bell rang.",
				fields: DAY,
				sourceMessageId: m.id
			})
			.returning()
		const { recordRedline } = await import("./redlines")
		await recordRedline(asDb(), {
			entryId: day!.id,
			before: { content: "" },
			after: { content: "The bell rang." },
			keys: ["content"],
			cause: "routine",
			by: {
				run: {
					sessionId: w.session.id,
					messageId: m.id,
					runId: "r",
					shownAs: null
				}
			}
		})
		const done = await apply(w)
		expect(done.mergedDays).toEqual([day!.id])
		// The notes day's history went with it; its text is one Apply row on the lorebook's day.
		expect(await rowsOf(day!.id)).toHaveLength(0)
		const rows = await rowsOf(loreDay!.id)
		expect(rows).toHaveLength(1)
		expect(rows[0]).toMatchObject({
			cause: "apply",
			userId: w.user.id,
			changes: {
				content: {
					before: { v: "Lore day." },
					after: { v: "Lore day.\n\nThe bell rang." }
				}
			}
		})
	})
})
