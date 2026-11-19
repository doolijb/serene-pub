/**
 * An entry a live pipeline run was shown cannot have its name, content or typed
 * fields replaced by a person's save until the run has finished: the save is
 * refused with one sentence, and `entries:earmark` says the same sentence on open.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { LOCATION_TYPE_ID, WORLD_LORE_TYPE_ID } from "$lib/shared/entries/types"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string
let n = 0

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-entries-earmark-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

beforeEach(async () => {
	;(await import("$lib/server/pipelines/runtime/runRegistry"))._reset()
})

const fakeSocket = (userId: number) => ({ user: { id: userId } }) as any

function recorder() {
	const sent: Array<{ event: string; data: any }> = []
	const emit = (event: string, data: any) => {
		sent.push({ event, data })
	}
	return { sent, emit: emit as any }
}

async function world() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const tag = `${++n}`
	const user = await createTestUser(testDb, `earmark-${tag}`)
	const [book] = await testDb.insert(schema.lorebooks).values({ name: `Book ${tag}`, userId: user.id }).returning()
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId: user.id, isGroup: false, name: `Session ${tag}`, lorebookId: book!.id })
		.returning()
	const entry = await add(book!.id, "Mira", "A baker.")
	const other = await add(book!.id, "Odo", "A miller.")
	return { user, book: book!, session: session!, entry, other, tag }
}

async function add(
	lorebookId: number,
	title: string,
	content: string,
	over: Partial<typeof schema.lorebookEntries.$inferInsert> = {}
) {
	const [row] = await testDb
		.insert(schema.lorebookEntries)
		.values({ lorebookId, typeId: WORLD_LORE_TYPE_ID, typeVersion: 1, position: ++n, title, content, keys: ["mira"], ...over })
		.returning()
	return row!
}

const rowOf = async (id: number) =>
	(await testDb.select().from(schema.lorebookEntries).where(eq(schema.lorebookEntries.id, id)))[0]

/** A registered routine run in a session that earmarks the entries. */
async function earmarking(
	w: { user: { id: number }; session: { id: number } },
	ids: number[],
	opts: { shownAs?: string; runId?: string; specId?: string } = {}
) {
	const reg = await import("$lib/server/pipelines/runtime/runRegistry")
	const runs = await import("$lib/server/pipelines/routines/runs")
	const runId = opts.runId ?? `run-${++n}`
	reg.start({ runId, userId: w.user.id, sessionId: w.session.id, specId: opts.specId ?? "core:spec/test", kind: "routine" })
	if (opts.shownAs)
		runs.noteRoutineRun(runId, {
			sessionId: w.session.id,
			registrationKey: "k",
			depth: 0,
			shownAs: { name: opts.shownAs }
		})
	reg.earmark(runId, "entry", ids)
	return {
		runId,
		finish: () => {
			reg.finish(runId)
			runs.forgetRoutineRun(runId)
		}
	}
}

const update = async (userId: number, entry: Record<string, unknown>) => {
	const { updateEntryHandler } = await import("./entries")
	const r = recorder()
	const result = updateEntryHandler.handler(fakeSocket(userId), { entry: { typeId: WORLD_LORE_TYPE_ID, ...entry } as any }, r.emit)
	return { r, result }
}

const RUNNING = (who: string) => `${who} may update this entry when it finishes. Your changes are kept here: save again then.`

describe("entries:update on an earmarked entry", () => {
	test("a changed name, content or typed field is refused with the sentence, and the row is untouched", async () => {
		const w = await world()
		const run = await earmarking(w, [w.entry.id], { shownAs: "Remember things" })
		const before = await rowOf(w.entry.id)
		const sentence = RUNNING(`Remember things in Session ${w.tag}`)
		for (const change of [{ name: "Mira the Elder" }, { content: "A widow." }]) {
			const { r, result } = await update(w.user.id, { id: w.entry.id, ...change })
			await expect(result).rejects.toThrow(sentence)
			expect(r.sent).toContainEqual({ event: "entries:update:error", data: { error: sentence } })
			expect(await rowOf(w.entry.id)).toEqual(before)
		}
		run.finish()
	})

	test("a typed field that differs is refused; the same value resent is not", async () => {
		const w = await world()
		const place = await add(w.book.id, "Vault", "A place.", {
			typeId: LOCATION_TYPE_ID,
			fields: { category: "Rooms" }
		})
		const run = await earmarking(w, [place.id])
		const before = await rowOf(place.id)
		const call = (fields: Record<string, unknown>) => {
			const r = recorder()
			return import("./entries").then((m) =>
				m.updateEntryHandler.handler(
					fakeSocket(w.user.id),
					{ entry: { typeId: LOCATION_TYPE_ID, id: place.id, ...fields } as any },
					r.emit
				)
			)
		}
		await expect(call({ category: "Streets" })).rejects.toThrow(RUNNING(`A routine in Session ${w.tag}`))
		expect(await rowOf(place.id)).toEqual(before)
		await expect(call({ category: "Rooms", name: "Vault", content: "A place." })).resolves.toBeTruthy()
		run.finish()
	})

	test("the same save succeeds once the run has finished", async () => {
		const w = await world()
		const run = await earmarking(w, [w.entry.id])
		await expect((await update(w.user.id, { id: w.entry.id, content: "A widow." })).result).rejects.toThrow()
		run.finish()
		await expect((await update(w.user.id, { id: w.entry.id, content: "A widow." })).result).resolves.toBeTruthy()
		expect((await rowOf(w.entry.id))!.content).toBe("A widow.")
	})

	test("another entry, and a switch, a mark or a key change, are not refused", async () => {
		const w = await world()
		const run = await earmarking(w, [w.entry.id])
		await expect((await update(w.user.id, { id: w.other.id, content: "A smith." })).result).resolves.toBeTruthy()
		await expect(
			(await update(w.user.id, { id: w.entry.id, enabled: false, constant: true, keys: ["mira", "baker"], archived: true })).result
		).resolves.toBeTruthy()
		// A name and content equal to the stored ones changes nothing.
		await expect(
			(await update(w.user.id, { id: w.entry.id, name: "Mira", content: "A baker.", keys: ["mira"] })).result
		).resolves.toBeTruthy()
		run.finish()
	})

	test("a run waiting for the asker's review says so, and still clears on finish", async () => {
		const w = await world()
		const { createReviewer, pendingReviewsFor } = await import("$lib/server/pipelines/runtime/reviewGate")
		const run = await earmarking(w, [w.entry.id], { shownAs: "Remember things", specId: "core:spec/parked" })
		const abort = new AbortController()
		const reviewer = createReviewer({
			userId: w.user.id,
			sessionId: w.session.id,
			specId: "core:spec/parked",
			signal: abort.signal
		})
		const parked = reviewer({
			nodeKey: "write",
			definitionId: "core:outlet/update-lore-entry",
			payload: { content: "x" },
			position: "on"
		} as any)
		await new Promise((r) => setTimeout(r, 20))
		expect(pendingReviewsFor(w.user.id)).toHaveLength(1)
		const sentence = `Remember things in Session ${w.tag} is waiting for your review and may update this entry. Your changes are kept here: decide there, then save.`
		await expect((await update(w.user.id, { id: w.entry.id, name: "Mira II" })).result).rejects.toThrow(sentence)
		abort.abort()
		await parked
		expect(pendingReviewsFor(w.user.id)).toHaveLength(0)
		// Still earmarked after the park ended: only finish clears it.
		await expect((await update(w.user.id, { id: w.entry.id, name: "Mira II" })).result).rejects.toThrow(RUNNING(`Remember things in Session ${w.tag}`))
		run.finish()
		await expect((await update(w.user.id, { id: w.entry.id, name: "Mira II" })).result).resolves.toBeTruthy()
	})

	test("a stopped run still refuses until it finishes", async () => {
		const w = await world()
		const reg = await import("$lib/server/pipelines/runtime/runRegistry")
		const run = await earmarking(w, [w.entry.id])
		reg.cancel(run.runId, w.user.id)
		await expect((await update(w.user.id, { id: w.entry.id, name: "Mira II" })).result).rejects.toThrow(/may update this entry/)
		run.finish()
		await expect((await update(w.user.id, { id: w.entry.id, name: "Mira II" })).result).resolves.toBeTruthy()
	})
})

describe("a typed field the row never stored", () => {
	test("its declared default resent is no change, so the save is not refused", async () => {
		const w = await world()
		const { fieldDefault } = await import("$lib/server/entries/declarations")
		const place = await add(w.book.id, "Cellar", "A place.", { typeId: LOCATION_TYPE_ID })
		const run = await earmarking(w, [place.id])
		const r = recorder()
		const { updateEntryHandler } = await import("./entries")
		await expect(
			updateEntryHandler.handler(
				fakeSocket(w.user.id),
				{
					entry: {
						typeId: LOCATION_TYPE_ID,
						id: place.id,
						category: fieldDefault(LOCATION_TYPE_ID, "category")
					} as any
				},
				r.emit
			)
		).resolves.toBeTruthy()
		run.finish()
	})
})

describe("dated changes from the same form", () => {
	test("a content amendment is refused on create and on update; a switch and a delete are not", async () => {
		const m = await import("./amendments")
		const w = await world()
		const emit = () => {}
		const made = await m.amendmentsCreateHandler.handler(
			fakeSocket(w.user.id),
			{ lorebookId: w.book.id, entryId: w.entry.id, year: 2, fields: { enabled: false } } as any,
			emit
		)
		const id = made.entries[0].id
		const run = await earmarking(w, [w.entry.id])
		await expect(
			m.amendmentsCreateHandler.handler(
				fakeSocket(w.user.id),
				{ lorebookId: w.book.id, entryId: w.entry.id, year: 3, fields: { content: "A widow." } } as any,
				emit
			)
		).rejects.toThrow(/may update this entry/)
		await expect(
			m.amendmentsUpdateHandler.handler(
				fakeSocket(w.user.id),
				{ lorebookId: w.book.id, id, subject: "entry", fields: { content: "A widow." } } as any,
				emit
			)
		).rejects.toThrow(/may update this entry/)
		await expect(
			m.amendmentsCreateHandler.handler(
				fakeSocket(w.user.id),
				{ lorebookId: w.book.id, entryId: w.entry.id, year: 4, fields: { enabled: true } } as any,
				emit
			)
		).resolves.toBeTruthy()
		await expect(
			m.amendmentsUpdateHandler.handler(
				fakeSocket(w.user.id),
				{ lorebookId: w.book.id, id, subject: "entry", year: 9 } as any,
				emit
			)
		).resolves.toBeTruthy()
		await expect(
			m.amendmentsDeleteHandler.handler(fakeSocket(w.user.id), { lorebookId: w.book.id, id, subject: "entry" } as any, emit)
		).resolves.toBeTruthy()
		run.finish()
	})
})

describe("lorebooks:settleImprint", () => {
	test("revert of a text field is refused while earmarked; keep is not", async () => {
		const { settleImprintHandler } = await import("./entries")
		const w = await world()
		const kept = async () =>
			(
				await testDb
					.insert(schema.loreImprints)
					.values({
						sessionId: w.session.id,
						lorebookId: w.book.id,
						subjectKind: "entry",
						subjectId: w.entry.id,
						field: "content",
						before: { v: "A baker." },
						after: { v: "A widow." },
						status: "kept"
					})
					.returning()
			)[0]!
		const first = await kept()
		const second = await kept()
		const run = await earmarking(w, [w.entry.id])
		const call = (imprintId: number, choice: string) =>
			settleImprintHandler.handler(fakeSocket(w.user.id), { imprintId, choice } as any, (() => {}) as any)
		await expect(call(first.id, "revert")).rejects.toThrow(/may update this entry/)
		expect((await testDb.select().from(schema.loreImprints).where(eq(schema.loreImprints.id, first.id))).length).toBe(1)
		await expect(call(second.id, "keep")).resolves.toMatchObject({ choice: "keep" })
		run.finish()
		await expect(call(first.id, "revert")).resolves.toMatchObject({ choice: "revert" })
		expect((await rowOf(w.entry.id))!.content).toBe("A baker.")
	})
})

describe("entries:earmark", () => {
	const ask = async (userId: number, entryId: number) => {
		const { entryEarmarkHandler } = await import("./entries")
		const r = recorder()
		const result = entryEarmarkHandler.handler(fakeSocket(userId), { entryId }, r.emit)
		return { r, result }
	}

	test("answers null for an unearmarked entry and the sentence for an earmarked one, lorebookId on top", async () => {
		const w = await world()
		const none = await ask(w.user.id, w.entry.id)
		await expect(none.result).resolves.toEqual({ entryId: w.entry.id, lorebookId: w.book.id, notice: null })
		expect(none.r.sent).toEqual([
			{ event: "entries:earmark", data: { entryId: w.entry.id, lorebookId: w.book.id, notice: null } }
		])
		const run = await earmarking(w, [w.entry.id], { shownAs: "Remember things" })
		const some = await ask(w.user.id, w.entry.id)
		const notice = RUNNING(`Remember things in Session ${w.tag}`)
		await expect(some.result).resolves.toEqual({ entryId: w.entry.id, lorebookId: w.book.id, notice })
		expect(some.r.sent[0]!.data.lorebookId).toBe(w.book.id)
		run.finish()
		await expect((await ask(w.user.id, w.entry.id)).result).resolves.toMatchObject({ notice: null })
	})

	test("refuses an entry of another person's book, echoing the entry id", async () => {
		const w = await world()
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const stranger = await createTestUser(testDb, `earmark-stranger-${++n}`)
		const { r, result } = await ask(stranger.id, w.entry.id)
		await expect(result).rejects.toThrow("Entry not found or access denied.")
		expect(r.sent).toEqual([
			{ event: "entries:earmark:error", data: { entryId: w.entry.id, error: "Entry not found or access denied." } }
		])
	})

	test("a guest of the session is refused an entry of the session's own book (G2), the owner answers", async () => {
		const w = await world()
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const { ownBookFor } = await import("$lib/server/lorebooks/ownBook")
		const own = await ownBookFor(testDb as any, w.session.id)
		const note = await add(own.id, "The Old Mill", "A ruin.")
		const guest = await createTestUser(testDb, `earmark-guest-${++n}`)
		await testDb.insert(schema.sessionGuests).values({ sessionId: w.session.id, userId: guest.id })
		const { r, result } = await ask(guest.id, note.id)
		await expect(result).rejects.toThrow("Entry not found or access denied.")
		expect(JSON.stringify(r.sent)).not.toContain("The Old Mill")
		expect(r.sent.map((s) => s.event)).not.toContain("entries:earmark")
		const mine = await ask(w.user.id, note.id)
		await expect(mine.result).resolves.toEqual({ entryId: note.id, lorebookId: own.id, notice: null })
		expect(mine.r.sent.map((s) => s.event)).toEqual(["entries:earmark"])
	})

	test("leaves out the session's name for an asker who cannot open the session", async () => {
		const w = await world()
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const runner = await createTestUser(testDb, `earmark-runner-${++n}`)
		const [theirs] = await testDb
			.insert(schema.sessions)
			.values({ userId: runner.id, isGroup: false, name: "Private table", lorebookId: w.book.id })
			.returning()
		const run = await earmarking({ user: runner, session: theirs! }, [w.entry.id], { shownAs: "Remember things" })
		const { result } = await ask(w.user.id, w.entry.id)
		const { notice } = await result
		expect(notice).toBe(RUNNING("Remember things"))
		expect(notice).not.toContain("Private table")
		run.finish()
	})

	test("waiting for review, an asker who is not the run's person reads the other wording", async () => {
		const w = await world()
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const runner = await createTestUser(testDb, `earmark-runner-${++n}`)
		const { createReviewer } = await import("$lib/server/pipelines/runtime/reviewGate")
		const run = await earmarking({ user: runner, session: w.session }, [w.entry.id], {
			shownAs: "Remember things",
			specId: "core:spec/parked-other"
		})
		const abort = new AbortController()
		const parked = createReviewer({
			userId: runner.id,
			sessionId: w.session.id,
			specId: "core:spec/parked-other",
			signal: abort.signal
		})({ nodeKey: "write", definitionId: "core:outlet/update-lore-entry", payload: { content: "x" }, position: "on" } as any)
		await new Promise((r) => setTimeout(r, 20))
		const { result } = await ask(w.user.id, w.entry.id)
		expect((await result).notice).toBe(
			`Remember things in Session ${w.tag} is waiting for review and may update this entry. Your changes are kept here: save again once it is decided.`
		)
		abort.abort()
		await parked
		run.finish()
	})
})
