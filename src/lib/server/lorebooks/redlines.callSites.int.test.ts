/**
 * 🚧 **The Edit history's call sites** (owner, 2026-11-13/14): a routine's
 * write through the host leaves one row; a turn taken back takes its row with
 * it and Forward puts it back; Revert is a person's row; the limit; the
 * registry's entry-scoped spec (a copy carries none, a purge removes them);
 * Share as a lorebook clears them.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { LOCATION_TYPE_ID } from "$lib/shared/entries/types"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
})

let testDb: TestDb
let dataDir: string
let n = 0

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-redlines-sites-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const db = () => testDb as unknown as Db
const UPDATE = {
	key: "change",
	definitionId: "core:outlet/update-lore-entry"
} as any
const CREATE = {
	key: "file",
	definitionId: "core:outlet/create-lore-entry"
} as any
const R = schema.loreRedlines

async function world(mode: "full" | "review" = "review") {
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `redlines-sites-${suffix}`)
	await testDb
		.insert(schema.userSettings)
		.values({ userId: user.id, loreWriteMode: mode })
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: user.id, name: `World ${suffix}` })
		.returning()
	const [session] = await testDb
		.insert(schema.sessions)
		.values({
			userId: user.id,
			isGroup: false,
			name: `Run ${suffix}`,
			lorebookId: book!.id
		})
		.returning()
	const message = async () => {
		const [legacy] = await testDb
			.insert(schema.sessionMessages)
			.values({ sessionId: session!.id, role: "assistant", content: "…" })
			.returning()
		await testDb
			.insert(schema.messages)
			.values({
				id: legacy!.id,
				sessionId: session!.id,
				role: "assistant"
			})
		return legacy!
	}
	const host = async (runId: string) => {
		const { createHost } = await import(
			"$lib/server/pipelines/runtime/host"
		)
		return createHost(db(), {
			sessionId: session!.id,
			userId: user.id,
			runId
		})
	}
	return { user, book: book!, session: session!, message, host }
}
type World = Awaited<ReturnType<typeof world>>

const entry = async (id: number) =>
	(
		await testDb
			.select()
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.id, id))
	)[0]!
const rowsOf = (entryId: number) =>
	testDb.select().from(R).where(eq(R.entryId, entryId)).orderBy(R.id)

/** A notes entry the session's run filed (Review writes into the session's own book). */
async function noteEntry(w: World) {
	await w.message()
	const filed: any = await (
		await w.host("run-file")
	).commit!(
		{
			name: "A gull",
			content: "It watches.",
			params: { entryType: LOCATION_TYPE_ID }
		},
		CREATE
	)
	return filed.id as number
}

/** A person's save of the content, recorded as the socket does. */
async function personSaved(entryId: number, userId: number, content: string) {
	const { recordEntryRedline } = await import("./redlines")
	const before = await entry(entryId)
	const [after] = await testDb
		.update(schema.lorebookEntries)
		.set({ content })
		.where(eq(schema.lorebookEntries.id, entryId))
		.returning()
	await recordEntryRedline(db(), {
		before,
		after: after!,
		named: ["content"],
		cause: "save",
		by: { userId }
	})
}

const swipe = async (messageId: number) => {
	const { retractStateAnchoredTo } = await import("$lib/server/state/write")
	return retractStateAnchoredTo(db(), messageId, "replaced")
}

describe("a routine's write through the host", () => {
	test("leaves one row — before, after, cause routine, its session, run and shown name; a write that changes nothing leaves none", async () => {
		const w = await world()
		const id = await noteEntry(w)
		const { noteRoutineRun, forgetRoutineRun } = await import(
			"$lib/server/pipelines/routines/runs"
		)
		noteRoutineRun("run-w1", {
			sessionId: w.session.id,
			registrationKey: "k",
			depth: 0,
			shownAs: { name: "Keeper" }
		})
		try {
			const m = await w.message()
			await (
				await w.host("run-w1")
			).commit!({ entry: id, content: "It steals a fish." }, UPDATE)
			const rows = await rowsOf(id)
			expect(rows).toHaveLength(1)
			expect(rows[0]).toMatchObject({
				cause: "routine",
				userId: null,
				sessionId: w.session.id,
				messageId: m.id,
				runId: "run-w1",
				shownAs: "Keeper",
				changes: {
					content: {
						before: { v: "It watches." },
						after: { v: "It steals a fish." }
					}
				}
			})
			await (
				await w.host("run-w1")
			).commit!({ entry: id, content: "It steals a fish." }, UPDATE)
			expect(await rowsOf(id)).toHaveLength(1)
		} finally {
			forgetRoutineRun("run-w1")
		}
	})

	test("a pipeline that is no routine is named by its spec; a person's press is the person's save", async () => {
		const w = await world()
		const id = await noteEntry(w)
		const slug = `tidy-${++n}`
		await testDb
			.insert(schema.pipelineSpecs)
			.values({ slug, name: "Tidy the notes" })
		const { createHost } = await import(
			"$lib/server/pipelines/runtime/host"
		)
		await w.message()
		await createHost(db(), {
			sessionId: w.session.id,
			userId: w.user.id,
			runId: "run-pipe",
			specId: slug
		}).commit!({ entry: id, content: "It sleeps." }, UPDATE)
		expect((await rowsOf(id)).at(-1)).toMatchObject({
			cause: "routine",
			userId: null,
			shownAs: "Tidy the notes"
		})
		const { withRunFamily } = await import("$lib/server/utils/llmQueue")
		await withRunFamily("action", () =>
			createHost(db(), {
				sessionId: w.session.id,
				userId: w.user.id,
				runId: "run-press"
			}).commit!({ entry: id, content: "It wakes." }, UPDATE)
		)
		expect((await rowsOf(id)).at(-1)).toMatchObject({
			cause: "save",
			userId: w.user.id,
			sessionId: w.session.id,
			runId: null,
			changes: {
				content: {
					before: { v: "It sleeps." },
					after: { v: "It wakes." }
				}
			}
		})
	})

	test("a change held in the session's notes leaves none", async () => {
		const w = await world()
		const [vault] = await testDb
			.insert(schema.lorebookEntries)
			.values({
				lorebookId: w.book.id,
				typeId: LOCATION_TYPE_ID,
				typeVersion: 1,
				position: ++n,
				title: "The Vault",
				content: "Locked.",
				fields: { category: "Rooms" }
			})
			.returning()
		const { insertOwnBook } = await import("./ownBook")
		await insertOwnBook(db(), {
			sessionId: w.session.id,
			userId: w.user.id,
			name: null,
			overlayOf: w.book.id,
			primaryRuleset: "core:ruleset/freeform@1",
			rulesetVersion: null
		})
		await w.message()
		await (
			await w.host("run-held")
		).commit!({ entry: vault!.id, content: "Sealed." }, UPDATE)
		expect((await entry(vault!.id)).content).toBe("Locked.")
		expect(await rowsOf(vault!.id)).toHaveLength(0)
	})
})

describe("a turn taken back takes its row with it", () => {
	test("30 swipes of a turn that rewrites an entry leave the person's edit and one row; Forward puts it back", async () => {
		const w = await world()
		const id = await noteEntry(w)
		await personSaved(id, w.user.id, "It watches the tide.")
		let last: Awaited<ReturnType<typeof swipe>> | null = null
		for (let i = 0; i < 30; i++) {
			const m = await w.message()
			await (
				await w.host(`run-swipe-${i}`)
			).commit!({ entry: id, content: `Reply ${i}.` }, UPDATE)
			expect(await rowsOf(id)).toHaveLength(2)
			if (i < 29) await swipe(m.id)
			else last = await swipe(m.id)
		}
		// The 30th reply was taken back too: only the person's row stands.
		let rows = await rowsOf(id)
		expect(rows.map((r) => r.cause)).toEqual(["save"])
		expect(rows[0]!.userId).toBe(w.user.id)
		expect((await entry(id)).content).toBe("It watches the tide.")

		const { restoreRetractedState } = await import(
			"$lib/server/state/write"
		)
		expect(await restoreRetractedState(db(), last!.taken)).toBe(true)
		rows = await rowsOf(id)
		expect(rows.map((r) => r.cause)).toEqual(["save", "routine"])
		expect(rows[1]).toMatchObject({
			runId: "run-swipe-29",
			changes: { content: { after: { v: "Reply 29." } } }
		})
		expect((await entry(id)).content).toBe("Reply 29.")
	})

	test("a write the field has changed since is kept, and its row stays; Revert is one row as the person who pressed", async () => {
		const w = await world()
		const [vault] = await testDb
			.insert(schema.lorebookEntries)
			.values({
				lorebookId: w.book.id,
				typeId: LOCATION_TYPE_ID,
				typeVersion: 1,
				position: ++n,
				title: "The Vault",
				content: "Locked.",
				fields: { category: "Rooms" }
			})
			.returning()
		const m = await w.message()
		// What the host's write makes on a real book: the update, its imprints, its row.
		const { imprintChanges } = await import("./imprints")
		const { recordEntryRedline } = await import("./redlines")
		const was = await entry(vault!.id)
		const [wrote] = await testDb
			.update(schema.lorebookEntries)
			.set({ content: "Sealed." })
			.where(eq(schema.lorebookEntries.id, vault!.id))
			.returning()
		const anchor = {
			sessionId: w.session.id,
			messageId: m.id,
			runId: "run-kept"
		}
		await imprintChanges(
			db(),
			anchor,
			{ lorebookId: w.book.id, subject: "entry", subjectId: vault!.id },
			was as Record<string, unknown>,
			wrote as Record<string, unknown>,
			["content"]
		)
		await recordEntryRedline(db(), {
			before: was,
			after: wrote!,
			named: ["content"],
			cause: "routine",
			by: {
				run: {
					sessionId: w.session.id,
					messageId: m.id,
					runId: "run-kept",
					shownAs: null
				}
			}
		})
		await personSaved(vault!.id, w.user.id, "Open.")

		await swipe(m.id)
		expect((await entry(vault!.id)).content).toBe("Open.")
		expect((await rowsOf(vault!.id)).map((r) => r.cause)).toEqual([
			"routine",
			"save"
		])

		const { imprintsOf, settleKeptImprint } = await import("./imprints")
		const [kept] = (await imprintsOf(db(), w.session.id)).filter(
			(i) => i.status === "kept"
		)
		expect(kept).toBeTruthy()
		await settleKeptImprint(db(), kept!.id, "revert", { userId: w.user.id })
		const rows = await rowsOf(vault!.id)
		expect(rows.map((r) => r.cause)).toEqual(["routine", "save", "revert"])
		expect(rows[2]).toMatchObject({
			userId: w.user.id,
			changes: {
				content: { before: { v: "Open." }, after: { v: "Locked." } }
			}
		})
	})
})

describe("the limit", () => {
	test("60 routine rows after one person's row: the 50 newest and the person's", async () => {
		const w = await world()
		const id = await noteEntry(w)
		await personSaved(id, w.user.id, "Mine.")
		const { recordRedline, countRedlines } = await import("./redlines")
		for (let i = 0; i < 60; i++)
			await recordRedline(db(), {
				entryId: id,
				before: { content: `v${i}` },
				after: { content: `v${i + 1}` },
				keys: ["content"],
				cause: "routine",
				by: {
					run: {
						sessionId: w.session.id,
						messageId: null,
						runId: `r${i}`,
						shownAs: null
					}
				}
			})
		expect(await countRedlines(db(), { entryId: id })).toBe(51)
		const rows = await rowsOf(id)
		expect(rows.filter((r) => r.userId != null)).toHaveLength(1)
		expect(rows.at(-1)!.runId).toBe("r59")
	})
})

describe("it never travels", () => {
	test("a copy carries none; deleting the entry and a purge remove them; Share as a lorebook clears them", async () => {
		const w = await world()
		const id = await noteEntry(w)
		await personSaved(id, w.user.id, "Mine.")
		const { ownBookFor, shareAsLorebook } = await import("./ownBook")
		const notes = await ownBookFor(db(), w.session.id)
		expect(await rowsOf(id)).toHaveLength(1)

		const { copyLorebookTables, purgeLorebook } = await import(
			"./tableRegistry"
		)
		const [target] = await testDb
			.insert(schema.lorebooks)
			.values({ userId: w.user.id, name: "Copy" })
			.returning()
		const maps = await testDb.transaction((tx) =>
			copyLorebookTables(tx as unknown as Db, notes.id, target!.id)
		)
		const copied = [...maps.entries.values()]
		expect(copied.length).toBeGreaterThan(0)
		for (const copyId of copied)
			expect(await rowsOf(copyId)).toHaveLength(0)
		expect(await rowsOf(id)).toHaveLength(1)

		await testDb.transaction((tx) =>
			purgeLorebook(tx as unknown as Db, target!.id)
		)
		expect(await rowsOf(id)).toHaveLength(1)

		await testDb
			.update(schema.sessions)
			.set({ lorebookId: null })
			.where(eq(schema.sessions.id, w.session.id))
		await shareAsLorebook(db(), {
			sessionId: w.session.id,
			userId: w.user.id
		})
		expect(await rowsOf(id)).toHaveLength(0)

		await personSaved(id, w.user.id, "Mine again.")
		await testDb
			.delete(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.id, id))
		expect(
			await testDb
				.select()
				.from(R)
				.where(and(eq(R.entryId, id)))
		).toHaveLength(0)
	})

	test("an overwrite import's purge of the book removes its rows", async () => {
		const w = await world()
		const id = await noteEntry(w)
		await personSaved(id, w.user.id, "Mine.")
		const { ownBookFor } = await import("./ownBook")
		const notes = await ownBookFor(db(), w.session.id)
		const { purgeLorebook } = await import("./tableRegistry")
		await testDb.transaction((tx) =>
			purgeLorebook(tx as unknown as Db, notes.id)
		)
		expect(await rowsOf(id)).toHaveLength(0)
	})
})
