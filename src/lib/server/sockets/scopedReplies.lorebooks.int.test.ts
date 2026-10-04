/**
 * The lorebook families' REAL replies carry the scope their extractor reads.
 *
 * `shared/sockets/scopedReplies.test.ts` proves the declared Response types
 * require the scope field. This drives the handlers themselves and checks
 * every emit they make — the reply AND every cascade (`entries:counts`,
 * `scenes:list`, `amendments:list` …) — through `scopeOfPayload`, the same
 * function the interest gate calls. A SCOPED event whose payload yields null,
 * or the wrong id, is a reply the gate drops without a word (finding #159).
 *
 * Lazy emits (a thunk the gate calls only when someone listens) are resolved
 * here, so the payload checked is the one a listener would receive.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import {
	historyValues,
	insertSessionMessageRow
} from "$lib/server/pipelines/testing/fixtures"
import type { TestDb } from "$lib/server/utils/testDb"
import { WORLD_LORE_TYPE_ID } from "$lib/shared/entries/types"
import { isScopedEvent, scopeOfPayload } from "$lib/shared/sockets/interest"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-scoped-replies-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const fakeSocket = (userId: number) => ({ user: { id: userId } }) as any

/** Every emit a handler made, thunks resolved to what a listener receives. */
function recorder() {
	const pending: Array<Promise<{ event: string; data: any }>> = []
	const emit = (event: string, data: any) => {
		pending.push(
			Promise.resolve(typeof data === "function" ? data() : data).then(
				(resolved) => ({ event, data: resolved })
			)
		)
	}
	return { emit, emits: () => Promise.all(pending) }
}

let seq = 0
async function makeWorld() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `scoped-replies-${++seq}`)
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ name: `Scoped Book ${seq}`, userId: user.id })
		.returning()
	const [history] = await testDb
		.insert(schema.lorebookEntries)
		.values(historyValues([{ lorebookId: book.id, year: 1 }]))
		.returning()
	const [character] = await testDb
		.insert(schema.characters)
		.values({ userId: user.id, name: `Verity ${seq}`, description: "A novice." } as any)
		.returning()
	const [member] = await testDb
		.insert(schema.lorebookBindings)
		.values({
			lorebookId: book.id,
			name: "Verity",
			binding: `{{char:${character.id}}}`,
			characterId: character.id
		} as any)
		.returning()
	// A member with no card — what `bindingCheck:result` reports.
	await testDb.insert(schema.lorebookBindings).values({
		lorebookId: book.id,
		name: "Nobody",
		binding: "{{char:0}}",
		characterId: null
	} as any)
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId: user.id, isGroup: false, lorebookId: book.id })
		.returning()
	const message = await insertSessionMessageRow(testDb, session.id)
	return { user, book, history, character, member, session, message }
}

/**
 * Run one handler, then check every SCOPED emit it made: each must resolve
 * to a scope, the reply (`event` — the name the handler answers on, which is
 * not always its own) to `expected`, and every cascade to one of the world's
 * ids (a cascade may be scoped on the session instead).
 */
async function expectScoped(
	event: string,
	run: (emit: (event: string, data: any) => void) => Promise<unknown>,
	expected: number,
	allowed: number[]
) {
	const rec = recorder()
	await run(rec.emit)
	const emits = await rec.emits()
	const own = emits.filter((e) => e.event === event)
	expect(own.length, `${event} emitted no reply`).toBeGreaterThan(0)
	for (const { event: name, data } of emits) {
		if (!isScopedEvent(name)) continue
		const scope = scopeOfPayload(name, data)
		expect(scope, `${name} (from ${event}) carries no scope key`).not.toBeNull()
		if (name === event) expect(scope, name).toBe(String(expected))
		else expect(allowed.map(String), name).toContain(scope)
	}
}

describe("lorebook-family replies carry their scope key", () => {
	test("lorebooks:, scenes:listByLorebook, narrativeGraph:, bindingSuggestions:", async () => {
		const w = await makeWorld()
		const socket = fakeSocket(w.user.id)
		const ids = [w.book.id, w.session.id]
		const lorebooks = await import("./lorebooks")
		const scenes = await import("./scenes")
		const graph = await import("./narrativeGraph")
		const suggestions = await import("./bindingSuggestions")

		await expectScoped(
			"lorebooks:get",
			(emit) =>
				lorebooks.lorebooksGetHandler.handler(socket, { id: w.book.id }, emit),
			w.book.id,
			ids
		)
		// The not-found reply is scoped on the id asked for.
		await expectScoped(
			"lorebooks:get",
			(emit) =>
				lorebooks.lorebooksGetHandler.handler(
					fakeSocket(w.user.id + 100_000),
					{ id: w.book.id },
					emit
				),
			w.book.id,
			ids
		)
		await expectScoped(
			"lorebooks:bindingList",
			(emit) =>
				lorebooks.lorebookBindingListHandler.handler(
					socket,
					{ lorebookId: w.book.id },
					emit
				),
			w.book.id,
			ids
		)
		await expectScoped(
			"scenes:listByLorebook",
			(emit) =>
				scenes.sceneListByLorebookHandler.handler(
					socket,
					{ lorebookId: w.book.id },
					emit
				),
			w.book.id,
			ids
		)
		for (const [event, handler] of [
			["narrativeGraph:list", graph.narrativeGraphListHandler],
			["narrativeGraph:listMergeLogs", graph.narrativeGraphListMergeLogsHandler],
			[
				"narrativeGraph:duplicateCandidates",
				graph.narrativeGraphDuplicateCandidatesHandler
			],
			["bindingSuggestions:list", suggestions.bindingSuggestionsListHandler]
		] as const) {
			await expectScoped(
				event,
				(emit) =>
					(handler as any).handler(socket, { lorebookId: w.book.id }, emit),
				w.book.id,
				ids
			)
		}
	}, 60_000)

	test("lorebooks: story time — read, check, set calendar, set clock", async () => {
		const w = await makeWorld()
		const socket = fakeSocket(w.user.id)
		const st = await import("./lorebookStoryTime")
		const lorebookId = w.book.id
		for (const [event, handler, params] of [
			["lorebooks:storyTime", st.lorebookStoryTimeHandler, { lorebookId }],
			[
				"lorebooks:checkCalendar",
				st.lorebookCheckCalendarHandler,
				{ lorebookId, calendar: null }
			],
			[
				"lorebooks:setCalendar",
				st.lorebookSetCalendarHandler,
				{ lorebookId, calendar: null }
			],
			[
				"lorebooks:setClock",
				st.lorebookSetClockHandler,
				{ lorebookId, branchId: null, clock: { year: 1 } }
			],
			// The book's lines alone (plan B6).
			["lorebooks:lines", st.lorebookLinesHandler, { lorebookId }]
		] as const) {
			await expectScoped(
				event,
				(emit) => (handler as any).handler(socket, params, emit),
				lorebookId,
				[lorebookId, w.session.id]
			)
		}
	}, 60_000)

	test("entries: create, update, iterateNext, list, counts, delete", async () => {
		const w = await makeWorld()
		const socket = fakeSocket(w.user.id)
		const ids = [w.book.id, w.session.id]
		const entries = await import("./entries")

		let created: any
		await expectScoped(
			"entries:create",
			async (emit) => {
				created = await entries.createEntryHandler.handler(
					socket,
					{
						entry: {
							typeId: WORLD_LORE_TYPE_ID,
							lorebookId: w.book.id,
							name: "The chapter house",
							content: "Cold."
						}
					} as any,
					emit
				)
			},
			w.book.id,
			ids
		)
		const entryId = created.entry.id as number

		await expectScoped(
			"entries:update",
			(emit) =>
				entries.updateEntryHandler.handler(
					socket,
					{
						entry: {
							id: entryId,
							typeId: WORLD_LORE_TYPE_ID,
							content: "Colder."
						}
					} as any,
					emit
				),
			w.book.id,
			ids
		)
		await expectScoped(
			"entries:iterateNext",
			(emit) =>
				entries.iterateNextEntryHandler.handler(
					socket,
					{ id: w.history.id, typeId: w.history.typeId } as any,
					emit
				),
			w.book.id,
			ids
		)
		await expectScoped(
			"entries:list",
			(emit) =>
				entries.entryListHandler.handler(
					socket,
					{ lorebookId: w.book.id, typeId: WORLD_LORE_TYPE_ID },
					emit
				),
			w.book.id,
			ids
		)
		await expectScoped(
			"entries:counts",
			(emit) =>
				entries.entryCountsHandler.handler(
					socket,
					{ lorebookId: w.book.id } as any,
					emit
				),
			w.book.id,
			ids
		)
		await expectScoped(
			"entries:recentDecisions",
			(emit) =>
				entries.entryRecentDecisionsHandler.handler(
					socket,
					{ lorebookId: w.book.id, sessionId: w.session.id } as any,
					emit
				),
			w.book.id,
			ids
		)
		await expectScoped(
			"entries:delete",
			(emit) =>
				entries.deleteEntryHandler.handler(
					socket,
					{ id: entryId, typeId: WORLD_LORE_TYPE_ID } as any,
					emit
				),
			w.book.id,
			ids
		)
	}, 60_000)

	test("amendments: every verb answers on the scoped list", async () => {
		const w = await makeWorld()
		const socket = fakeSocket(w.user.id)
		const ids = [w.book.id, w.session.id]
		const a = await import("./amendments")
		const [entry] = await testDb
			.insert(schema.lorebookEntries)
			.values({
				lorebookId: w.book.id,
				typeId: WORLD_LORE_TYPE_ID,
				typeVersion: 1,
				title: "Verity",
				content: "A novice.",
				keys: ["verity"],
				position: 1
			} as any)
			.returning()
		const lorebookId = w.book.id

		await expectScoped(
			"amendments:list",
			(emit) => a.amendmentsListHandler.handler(socket, { lorebookId }, emit),
			lorebookId,
			ids
		)
		let amended: any
		await expectScoped(
			// Answered on the whole-book list, never under its own name.
			"amendments:list",
			async (emit) => {
				amended = await a.amendmentsCreateHandler.handler(
					socket,
					{ lorebookId, entryId: entry.id, year: 2, fields: { content: "Keeper." } },
					emit
				)
			},
			lorebookId,
			ids
		)
		const amendmentId = (amended.entries as any[]).find(
			(row) => row.entryId === entry.id
		).id as number
		await expectScoped(
			// Answered on the whole-book list, never under its own name.
			"amendments:list",
			(emit) =>
				a.amendmentsUpdateHandler.handler(
					socket,
					{ lorebookId, id: amendmentId, subject: "entry", year: 3 },
					emit
				),
			lorebookId,
			ids
		)
		await expectScoped(
			// Answered on the whole-book list, never under its own name.
			"amendments:list",
			(emit) =>
				a.amendmentsDeleteHandler.handler(
					socket,
					{ lorebookId, id: amendmentId, subject: "entry" },
					emit
				),
			lorebookId,
			ids
		)

		let forked: any
		await expectScoped(
			// Answered on the whole-book list, never under its own name.
			"amendments:list",
			async (emit) => {
				forked = await a.amendmentsForkHandler.handler(
					socket,
					{ lorebookId, name: "What if" },
					emit
				)
			},
			lorebookId,
			ids
		)
		const branchId = (forked.branches as any[]).find(
			(b) => b.name === "What if"
		).id as number
		await expectScoped(
			// Answered on the whole-book list, never under its own name.
			"amendments:list",
			(emit) =>
				a.amendmentsRenameBranchHandler.handler(
					socket,
					{ lorebookId, id: branchId, name: "What else" },
					emit
				),
			lorebookId,
			ids
		)
		await expectScoped(
			// Answered on the whole-book list, never under its own name.
			"amendments:list",
			(emit) =>
				a.amendmentsDeleteBranchHandler.handler(
					socket,
					{ lorebookId, id: branchId },
					emit
				),
			lorebookId,
			ids
		)

		let placed: any
		await expectScoped(
			// Answered on the whole-book list, never under its own name.
			"amendments:list",
			async (emit) => {
				placed = await a.amendmentsPlaceHandler.handler(
					socket,
					{ lorebookId, castId: w.member.id, personalPosition: 1, fromYear: 1 },
					emit
				)
			},
			lorebookId,
			ids
		)
		const presenceId = (placed.presences as any[]).find(
			(p) => p.castId === w.member.id
		).id as number
		await expectScoped(
			// Answered on the whole-book list, never under its own name.
			"amendments:list",
			(emit) =>
				a.amendmentsUnplaceHandler.handler(
					socket,
					{ lorebookId, id: presenceId },
					emit
				),
			lorebookId,
			ids
		)
	}, 60_000)

	test("scenes: list and scenedMessageIds are scoped on the session", async () => {
		const w = await makeWorld()
		const socket = fakeSocket(w.user.id)
		const ids = [w.book.id, w.session.id]
		const scenes = await import("./scenes")

		await expectScoped(
			"scenes:create",
			(emit) =>
				scenes.sceneCreateHandler.handler(
					socket,
					{
						scene: {
							lorebookId: w.book.id,
							sessionId: w.session.id,
							historyEntryId: w.history.id,
							selectedMessageIds: [w.message.id]
						}
					} as any,
					emit
				),
			// scenes:create is not SCOPED; its cascades are what is checked.
			0,
			ids
		)
		for (const [event, handler] of [
			["scenes:list", scenes.sceneListHandler],
			["scenes:scenedMessageIds", scenes.scenedMessageIdsHandler]
		] as const) {
			await expectScoped(
				event,
				(emit) =>
					(handler as any).handler(socket, { sessionId: w.session.id }, emit),
				w.session.id,
				ids
			)
		}
	}, 60_000)

	test("bindingCheck:result is scoped on the session, and lists only the card-less member", async () => {
		const w = await makeWorld()
		const { runLorebookBindingCheck } = await import("./sessions")
		const rec = recorder()
		await runLorebookBindingCheck(
			fakeSocket(w.user.id),
			w.session.id,
			w.book.id,
			rec.emit
		)
		const result = (await rec.emits()).find(
			(e) => e.event === "bindingCheck:result"
		)
		expect(result).toBeDefined()
		expect(scopeOfPayload("bindingCheck:result", result!.data)).toBe(
			String(w.session.id)
		)
		expect(result!.data).toEqual({
			lorebookId: w.book.id,
			sessionId: w.session.id,
			orphanedBindings: [
				{ id: expect.any(Number), binding: "{{char:0}}" }
			]
		})
	}, 60_000)
})

describe("Phase D wire hygiene", () => {
	test("lorebooks:get answers the book and its tags — no entries, no cast", async () => {
		const w = await makeWorld()
		const { lorebooksGetHandler } = await import("./lorebooks")
		const rec = recorder()
		const res: any = await lorebooksGetHandler.handler(
			fakeSocket(w.user.id),
			{ id: w.book.id },
			rec.emit
		)
		expect(res.lorebookId).toBe(w.book.id)
		expect(res.lorebook).toMatchObject({ id: w.book.id, name: w.book.name, tags: [] })
		// Book settings reads one row; entries and members have their own reads.
		expect(res).not.toHaveProperty("entries")
		expect(res.lorebook).not.toHaveProperty("lorebookBindings")
	}, 60_000)

	test("entries:updatePositions answers at its book's scope", async () => {
		const w = await makeWorld()
		const { updateEntryPositionsHandler } = await import("./entries")
		await expectScoped(
			"entries:updatePositions",
			(emit) =>
				updateEntryPositionsHandler.handler(
					fakeSocket(w.user.id),
					{
						lorebookId: w.book.id,
						typeId: w.history.typeId as any,
						positions: [{ id: w.history.id, position: 1 }]
					},
					emit
				),
			w.book.id,
			[w.book.id, w.session.id]
		)
	}, 60_000)
})
