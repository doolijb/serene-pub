/**
 * `lorebooks:lines` — the book's lines alone (plan B6, contract E-6).
 *
 * Main first (`id` null, named "main"), then every branch with the line it
 * forked from and its fork date; scoped on `lorebookId`; refused for another
 * user's book; and re-sent by the branch writes, so a session tab reading
 * the lines follows a fork, a rename and a delete without the amendments.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import { scopeOfPayload, SCOPED_EVENTS } from "$lib/shared/sockets/interest"
import type { TestDb } from "$lib/server/utils/testDb"

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

let testDb: TestDb
let dataDir: string

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-lines-int-test-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const asUser = (userId: number) => ({ user: { id: userId }, io: {} }) as any

/** Every emit a handler made, thunks evaluated (the server's lazy cascades). */
function recorder() {
	const emitted: Array<[string, any]> = []
	return {
		emitted,
		emit: (event: string, data: any) => {
			if (typeof data === "function")
				return Promise.resolve(data()).then((value: unknown) => {
					emitted.push([event, value])
				})
			emitted.push([event, data])
		}
	}
}

async function seed(tag: string) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `lines-${tag}`)
	const [lorebook] = await testDb
		.insert(schema.lorebooks)
		.values({ name: "Ashfall", userId: user.id })
		.returning()
	return { user, lorebook }
}

describe("lorebooks:lines", () => {
	test("main first, then each branch with where it forked from", async () => {
		const { user, lorebook } = await seed("read")
		const amendments = await import("./amendments")
		const { lorebookLinesHandler } = await import("./lorebookStoryTime")
		const fork = (name: string, from: number | null, forkYear: number | null) =>
			amendments.amendmentsForkHandler.handler(
				asUser(user.id),
				{ lorebookId: lorebook.id, name, forkedFromBranchId: from, forkYear },
				() => {}
			)
		const first = await fork("Ember", null, 3)
		const ember = first.branches.find((b) => b.name === "Ember")!.id
		await fork("Cinder", ember, 5)

		const rec = recorder()
		const res = await lorebookLinesHandler.handler(
			asUser(user.id),
			{ lorebookId: lorebook.id },
			rec.emit
		)
		expect(res.lorebookId).toBe(lorebook.id)
		expect(res.lines.map((l) => l.name)).toEqual(["main", "Ember", "Cinder"])
		expect(res.lines[0]).toEqual({
			id: null,
			name: "main",
			forkedFromBranchId: null,
			forkYear: null,
			forkMonth: null,
			forkDay: null
		})
		expect(res.lines[1]).toMatchObject({
			id: ember,
			forkedFromBranchId: null,
			forkYear: 3
		})
		expect(res.lines[2]).toMatchObject({ forkedFromBranchId: ember, forkYear: 5 })
		// The reply is scoped on its book, so a tab holding the key hears it.
		expect(SCOPED_EVENTS.has("lorebooks:lines")).toBe(true)
		expect(scopeOfPayload("lorebooks:lines", res)).toBe(String(lorebook.id))
		expect(rec.emitted.map(([e]) => e)).toEqual(["lorebooks:lines"])
	}, 60_000)

	test("another user's book is refused, and nothing is read", async () => {
		const { lorebook } = await seed("owner")
		const { user: other } = await seed("stranger")
		const { lorebookLinesHandler } = await import("./lorebookStoryTime")
		const rec = recorder()
		await expect(
			lorebookLinesHandler.handler(
				asUser(other.id),
				{ lorebookId: lorebook.id },
				rec.emit
			)
		).rejects.toThrow()
		expect(rec.emitted.map(([e]) => e)).toEqual(["lorebooks:lines:error"])
	}, 60_000)

	test("a fork, a rename and a delete each re-send the lines", async () => {
		const { user, lorebook } = await seed("cascade")
		const amendments = await import("./amendments")

		const forked = recorder()
		const res = await amendments.amendmentsForkHandler.handler(
			asUser(user.id),
			{ lorebookId: lorebook.id, name: "Ember", forkedFromBranchId: null },
			forked.emit
		)
		const id = res.branches.find((b) => b.name === "Ember")!.id
		const linesOf = (rec: ReturnType<typeof recorder>) =>
			rec.emitted.find(([e]) => e === "lorebooks:lines")?.[1]
		expect(linesOf(forked)?.lines.map((l: any) => l.name)).toEqual([
			"main",
			"Ember"
		])

		const renamed = recorder()
		await amendments.amendmentsRenameBranchHandler.handler(
			asUser(user.id),
			{ lorebookId: lorebook.id, id, name: "Embers" },
			renamed.emit
		)
		expect(linesOf(renamed)?.lines.map((l: any) => l.name)).toEqual([
			"main",
			"Embers"
		])

		const deleted = recorder()
		await amendments.amendmentsDeleteBranchHandler.handler(
			asUser(user.id),
			{ lorebookId: lorebook.id, id },
			deleted.emit
		)
		expect(linesOf(deleted)?.lines.map((l: any) => l.name)).toEqual(["main"])
	}, 60_000)
})
