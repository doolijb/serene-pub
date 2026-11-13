/**
 * ★bk-fold-1 (owner 2026-11-08), the READ doors: a session on its own notes
 * reads them on its own line and moment — the story clock, the session links'
 * story date, the graph's Extend from the session, and the settings form's
 * line check. A session beside an attached book answers exactly as before.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { historyValues } from "$lib/server/pipelines/testing/fixtures"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { activityStore } from "$lib/server/utils/activityStore"

const T = 60_000
vi.setConfig({ testTimeout: T, hookTimeout: T })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-own-notes-sockets-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	await testDb
		.insert(schema.systemSettings)
		.values({ id: 1 })
		.onConflictDoNothing()
	const [connection] = await testDb
		.insert(schema.connections)
		.values({ name: "Graph default", type: "ollama" })
		.returning()
	const [sampling] = await testDb
		.insert(schema.samplingConfigs)
		.values({ name: "Graph sampling", isImmutable: false })
		.returning()
	const { ensureConnectionModel } = await import(
		"$lib/server/connections/models"
	)
	const model = await ensureConnectionModel(
		testDb as any,
		connection!.id,
		"graph-7b"
	)
	const { setCapabilityDefault } = await import(
		"$lib/server/connections/capabilityDefaults"
	)
	await setCapabilityDefault(testDb as any, "text->text", {
		connectionId: connection!.id,
		connectionModelId: model!.id,
		samplingConfigId: sampling!.id
	})
}, T)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const db = () => testDb as unknown as Db
let n = 0

interface Opts {
	/** Stand on the own book's line (else its main). */
	line?: boolean
	/** The session's own clock, a year. */
	clockYear?: number | null
	/** Beside an attached book (with a line of its own), reading it. */
	attached?: boolean
}

/**
 * A session with its own book. Main holds history at Year 5 and Year 15; the
 * line forks at Year 10 and holds Year 12 and Year 18 (its present: 18).
 */
async function setup(opts: Opts = {}) {
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `own-sockets-${suffix}`)
	let attachedId: number | null = null
	if (opts.attached) {
		const [shared] = await testDb
			.insert(schema.lorebooks)
			.values({ userId: user.id, name: `Shared ${suffix}` })
			.returning()
		attachedId = shared!.id
		await testDb
			.insert(schema.lorebookEntries)
			.values(
				historyValues([
					{ lorebookId: attachedId, year: 40, content: "" }
				])
			)
	}
	const [session] = await testDb
		.insert(schema.sessions)
		.values({
			userId: user.id,
			isGroup: false,
			name: `Run ${suffix}`,
			lorebookId: attachedId,
			lorebookBranchId: null,
			storyClockYear: opts.clockYear ?? null
		})
		.returning()
	const { ownBookFor } = await import("$lib/server/lorebooks/ownBook")
	const own = await ownBookFor(db(), session!.id)
	const [lineRow] = await testDb
		.insert(schema.lorebookBranches)
		.values({ lorebookId: own.id, name: "Own line", forkYear: 10 })
		.returning()
	const line = lineRow!
	const history = async (year: number, branchId: number | null = null) =>
		(
			await testDb
				.insert(schema.lorebookEntries)
				.values(
					historyValues([
						{
							lorebookId: own.id,
							year,
							content: `Year ${year}.`,
							branchId
						}
					])
				)
				.returning()
		)[0]!
	const mainFive = await history(5)
	const mainFifteen = await history(15)
	const lineTwelve = await history(12, line.id)
	const lineEighteen = await history(18, line.id)
	if (opts.line)
		await testDb
			.update(schema.sessions)
			.set({ lorebookBranchId: line.id })
			.where(eq(schema.sessions.id, session!.id))
	return {
		user,
		session: session!,
		own,
		line,
		attachedId,
		mainFive,
		mainFifteen,
		lineTwelve,
		lineEighteen
	}
}

const sessionRow = async (id: number) =>
	(
		await testDb
			.select()
			.from(schema.sessions)
			.where(eq(schema.sessions.id, id))
	)[0]!

describe("the story clock on a session's own notes", () => {
	test("reads the own book, its line, the line's present and the own calendar", async () => {
		const { readSessionStoryClock } = await import("./storyClock")
		const s = await setup({ line: true })
		const r = await readSessionStoryClock(s.session.id, s.user.id)
		expect(r.lorebookId).toBe(s.own.id)
		expect(r.branchId).toBe(s.line.id)
		expect(r.own).toBeNull()
		expect(r.linePresent).toMatchObject({ year: 18 })
		expect(r.present).toMatchObject({ year: 18 })
		expect(r.calendar).not.toBeNull()
		expect(r.isOwner).toBe(true)
	})

	test("a session clock is the own and the present", async () => {
		const { readSessionStoryClock } = await import("./storyClock")
		const s = await setup({ line: true, clockYear: 13 })
		const r = await readSessionStoryClock(s.session.id, s.user.id)
		expect(r.own).toMatchObject({ year: 13 })
		expect(r.present).toMatchObject({ year: 13 })
		expect(r.linePresent).toMatchObject({ year: 18 })
	})

	test("on its notes' main it reads main's present", async () => {
		const { readSessionStoryClock } = await import("./storyClock")
		const s = await setup()
		const r = await readSessionStoryClock(s.session.id, s.user.id)
		expect(r.lorebookId).toBe(s.own.id)
		expect(r.branchId).toBeNull()
		expect(r.linePresent).toMatchObject({ year: 15 })
	})

	test("beside an attached book the reply is the attached book's", async () => {
		const { readSessionStoryClock } = await import("./storyClock")
		const s = await setup({ attached: true })
		const r = await readSessionStoryClock(s.session.id, s.user.id)
		expect(r.lorebookId).toBe(s.attachedId)
		expect(r.lorebookId).not.toBe(s.own.id)
		expect(r.linePresent).toMatchObject({ year: 40 })
	})

	test("set and step on the own line move the session's clock and read back", async () => {
		const { readSessionStoryClock, setSessionStoryClock } = await import(
			"./storyClock"
		)
		const s = await setup({ line: true })
		const set = await setSessionStoryClock(s.session.id, s.user.id, {
			sessionId: s.session.id,
			to: { year: 14 }
		} as any)
		expect(set.moved).toBe(true)
		let row = await sessionRow(s.session.id)
		expect(row.storyClockYear).toBe(14)
		expect(row.lorebookBranchId).toBe(s.line.id)
		let r = await readSessionStoryClock(s.session.id, s.user.id)
		expect(r.own).toMatchObject({ year: 14 })
		expect(r.present).toMatchObject({ year: 14 })

		const step = await setSessionStoryClock(s.session.id, s.user.id, {
			sessionId: s.session.id,
			by: 2,
			unit: "years"
		} as any)
		expect(step.moved).toBe(true)
		row = await sessionRow(s.session.id)
		expect(row.storyClockYear).toBe(16)
		expect(row.lorebookBranchId).toBe(s.line.id)
		r = await readSessionStoryClock(s.session.id, s.user.id)
		expect(r.own).toMatchObject({ year: 16 })
	})
})

describe("the session links' story date on its own notes", () => {
	test("answers from the own line's present, then from the session clock", async () => {
		const { sessionLinks } = await import("$lib/server/state/resolve")
		const s = await setup({ line: true })
		let links = await sessionLinks(db(), s.session.id)
		expect(links.storyDate).toMatchObject({ year: 18 })
		await testDb
			.update(schema.sessions)
			.set({ storyClockYear: 13 })
			.where(eq(schema.sessions.id, s.session.id))
		links = await sessionLinks(db(), s.session.id)
		expect(links.storyDate).toMatchObject({ year: 13 })
	})

	test("beside an attached book it is the attached book's", async () => {
		const { sessionLinks } = await import("$lib/server/state/resolve")
		const s = await setup({ attached: true })
		const links = await sessionLinks(db(), s.session.id)
		expect(links.storyDate).toMatchObject({ year: 40 })
	})
})

async function extend(userId: number, lorebookId: number, sessionId: number) {
	const { narrativeGraphBuildHandler } = await import("./narrativeGraph")
	return narrativeGraphBuildHandler.handler(
		{ user: { id: userId } } as any,
		{ lorebookId, mode: "extend", sessionId } as any,
		(() => {}) as any
	)
}

const REFUSED =
	"That session does not read this lorebook, so the graph cannot be extended from it."

describe("Extend graph from a session on its own notes", () => {
	test("is not refused and builds on the session's line", async () => {
		const s = await setup({ line: true })
		await expect(
			extend(s.user.id, s.own.id, s.session.id)
		).resolves.not.toThrow()
		// The build began (its activity exists) and its scope is the line; with
		// no scene played in the notes it then stops for want of content.
		const act = activityStore
			.getFor(s.user.id, false)
			.find(
				(x: any) =>
					x.kind === "graph_build" && x.lorebookId === s.own.id
			) as any
		expect(act?.branchId).toBe(s.line.id)
	})

	test("a session that reads another book is still refused", async () => {
		const s = await setup({ line: true })
		const attached = await setup({ attached: true })
		await expect(
			extend(attached.user.id, attached.attachedId!, s.session.id)
		).rejects.toThrow(REFUSED)
		await expect(
			extend(attached.user.id, attached.own.id, attached.session.id)
		).rejects.toThrow(REFUSED)
	})

	test("on its notes' main, is not refused and builds on main", async () => {
		const s = await setup()
		await expect(
			extend(s.user.id, s.own.id, s.session.id)
		).resolves.not.toThrow()
		const act = activityStore
			.getFor(s.user.id, false)
			.find(
				(x: any) =>
					x.kind === "graph_build" && x.lorebookId === s.own.id
			) as any
		expect(act).toBeTruthy()
		expect(act.branchId ?? null).toBeNull()
	})
})

describe("sessionLinePatch on a session's own notes", () => {
	const none = { lorebookId: null, lorebookBranchId: null }
	const patchOf = async (args: Record<string, unknown>) => {
		const { sessionLinePatch } = await import("./sessions")
		return testDb.transaction((tx) =>
			sessionLinePatch(tx as unknown as Db, args as any)
		)
	}

	test("a line of the own book is taken; null moves back to main", async () => {
		const s = await setup()
		const session = { id: s.session.id, name: null }
		expect(
			await patchOf({
				before: none,
				session,
				lorebookBranchId: s.line.id
			})
		).toEqual({ lorebookBranchId: s.line.id })
		expect(
			await patchOf({
				before: { lorebookId: null, lorebookBranchId: s.line.id },
				session,
				lorebookBranchId: null
			})
		).toEqual({ lorebookBranchId: null })
	})

	test("a line of another book is refused in the session's words", async () => {
		const s = await setup()
		const other = await setup()
		await expect(
			patchOf({
				before: none,
				session: { id: s.session.id, name: null },
				lorebookBranchId: other.line.id
			})
		).rejects.toThrow(
			"That branch is not a branch of this session's lorebook."
		)
	})

	test("with no session the old refusal stands", async () => {
		const s = await setup()
		await expect(
			patchOf({ before: none, lorebookBranchId: s.line.id })
		).rejects.toThrow("Only a shared lorebook has branches to read.")
	})
})
