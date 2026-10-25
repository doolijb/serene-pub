/**
 * 🚧 On revision (PLAN-rulesets §28): `branch` forks before the revised turn
 * and keeps the old tail on the old session; `overwrite` retracts what the
 * turn wrote into the session's own notes.
 */

import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { asc, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { LOCATION_TYPE_ID } from "$lib/shared/entries/types"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-revision-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(testDb as any)
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

let n = 0

async function played(onRevision: "overwrite" | "branch") {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `revision-${++n}`)
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId: user.id, isGroup: false, name: `Run ${n}`, onRevision })
		.returning()
	const ids: number[] = []
	for (const content of ["one", "two", "three"]) {
		const [legacy] = await testDb
			.insert(schema.sessionMessages)
			.values({ sessionId: session!.id, role: "assistant", content, userId: user.id })
			.returning()
		await testDb
			.insert(schema.messages)
			.values({ id: legacy!.id, sessionId: session!.id, role: "assistant" })
		ids.push(legacy!.id)
	}
	return { user, session: session!, ids }
}

const contentsOf = async (sessionId: number) =>
	(
		await testDb
			.select({ content: schema.sessionMessages.content })
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.sessionId, sessionId))
			.orderBy(asc(schema.sessionMessages.id))
	).map((r) => r.content)

describe("On revision", () => {
	test("the confirmation's sentence names the mode", async () => {
		const { revisionNotice } = await import("./revision")
		expect(revisionNotice("overwrite", 1).sentence).toBe("This will overwrite the last turn. There is no undo.")
		expect(revisionNotice("overwrite", 3).sentence).toBe("This will overwrite the last 3 turns. There is no undo.")
		expect(revisionNotice("branch", 1).sentence).toBe("This will branch here; the old turns stay on the old branch.")
	})

	test("branch: a new session up to the turn before; the old tail stays", async () => {
		const p = await played("branch")
		const { sessionOnRevision, branchForRevision } = await import("./revision")
		expect(await sessionOnRevision(testDb as any, p.session.id)).toBe("branch")
		const out = await branchForRevision(testDb as any, {
			sessionId: p.session.id,
			userId: p.user.id,
			firstRevisedId: p.ids[2]!
		})
		expect(out.ok).toBe(true)
		if (!out.ok) return
		expect(out.sessionId).not.toBe(p.session.id)
		expect(await contentsOf(out.sessionId)).toEqual(["one", "two"])
		expect(await contentsOf(p.session.id)).toEqual(["one", "two", "three"])
		const [branch] = await testDb
			.select({ onRevision: schema.sessions.onRevision, name: schema.sessions.name })
			.from(schema.sessions)
			.where(eq(schema.sessions.id, out.sessionId))
		expect(branch!.onRevision).toBe("branch")
		// A derived name, never the same name with no mark.
		expect(branch!.name).toBe(`${p.session.name} · branch 2`)
		// Its last line is marked: the turn after it was revised away, so the
		// session list does not say "Waiting on the model".
		const { lastVisibleMessages } = await import("./rowProjection")
		const last = (await lastVisibleMessages(testDb as any, [out.sessionId])).get(out.sessionId)
		expect(last).toMatchObject({ excerpt: "two", revisedTurn: true })
		// A second branch of the same session counts on.
		const again = await branchForRevision(testDb as any, {
			sessionId: p.session.id,
			userId: p.user.id,
			firstRevisedId: p.ids[2]!
		})
		if (!again.ok) throw new Error(again.error)
		const [second] = await testDb
			.select({ name: schema.sessions.name })
			.from(schema.sessions)
			.where(eq(schema.sessions.id, again.sessionId))
		expect(second!.name).toBe(`${p.session.name} · branch 3`)
	})

	test("a branch's name: the base without its suffix, the next number", async () => {
		const { revisionBranchName } = await import("./revision")
		expect(revisionBranchName("Drowned King", [])).toBe("Drowned King · branch 2")
		expect(revisionBranchName("Drowned King · branch 2", ["Drowned King · branch 2"])).toBe("Drowned King · branch 3")
		expect(revisionBranchName("Drowned King", ["Other · branch 7", "Drowned King · branch 4"])).toBe("Drowned King · branch 5")
	})

	test("branch: nothing before the first turn to branch from", async () => {
		const p = await played("branch")
		const { branchForRevision, NOTHING_TO_BRANCH_FROM } = await import("./revision")
		const out = await branchForRevision(testDb as any, {
			sessionId: p.session.id,
			userId: p.user.id,
			firstRevisedId: p.ids[0]!
		})
		expect(out).toEqual({ ok: false, error: NOTHING_TO_BRANCH_FROM })
	})

	test("overwrite: the notes' entries the deleted turn wrote go with it", async () => {
		const p = await played("overwrite")
		const { ownBookFor, retractOwnBookEntriesAnchoredTo } = await import(
			"$lib/server/lorebooks/ownBook"
		)
		const notes = await ownBookFor(testDb as any, p.session.id)
		const entry = (title: string, at: number) =>
			testDb
				.insert(schema.lorebookEntries)
				.values({
					lorebookId: notes.id,
					typeId: LOCATION_TYPE_ID,
					typeVersion: 1,
					position: at,
					title,
					sourceMessageId: at
				})
				.returning()
		await entry("Kept", p.ids[1]!)
		await entry("Gone", p.ids[2]!)
		const gone = await retractOwnBookEntriesAnchoredTo(testDb as any, p.session.id, [p.ids[2]!])
		expect(gone).toHaveLength(1)
		const left = await testDb
			.select({ title: schema.lorebookEntries.title })
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.lorebookId, notes.id))
		expect(left.map((r) => r.title)).toEqual(["Kept"])
	})

	test("sessions:update takes onRevision and refuses anything else", async () => {
		const p = await played("overwrite")
		const { sessionsUpdateHandler } = await import("$lib/server/sockets/sessions")
		const socket = { user: { id: p.user.id, isAdmin: false }, io: { to: () => ({ emit: () => {} }) } } as any
		await sessionsUpdateHandler.handler(socket, { session: { id: p.session.id, onRevision: "branch" } } as any, () => {})
		const [row] = await testDb
			.select({ onRevision: schema.sessions.onRevision })
			.from(schema.sessions)
			.where(eq(schema.sessions.id, p.session.id))
		expect(row!.onRevision).toBe("branch")
		const errors: unknown[] = []
		await sessionsUpdateHandler
			.handler(socket, { session: { id: p.session.id, onRevision: "sideways" } } as any, (e: string, d: unknown) => {
				if (e.endsWith(":error")) errors.push(d)
			})
			.catch(() => {})
		expect(JSON.stringify(errors)).toContain("On revision must be Overwrite or Branch.")
	})
})
