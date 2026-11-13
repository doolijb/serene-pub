/**
 * 🚧 `lorebookLinks` and the side-character picker's `lorebookNames` read a
 * cast member's dated rename **written as a version** (cv-readers): the name on
 * the reading, never a folded amendment (`cast_amendments` is frozen).
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import {
	insertCastMember,
	writeCastVersion
} from "$lib/server/characters/versions"
import { readingOf } from "$lib/server/state/reading"
import { lorebookLinks } from "./lorebookState"
import { resolveSideCharacter } from "$lib/server/pipelines/entities/sideCharacter"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async (importOriginal) => {
	const actual = await importOriginal<typeof import("$lib/server/db")>()
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { ...actual, db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-lorebookLinksVersions-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const db = () => testDb as unknown as Db
let n = 0

async function world() {
	const [user] = await testDb
		.insert(schema.users)
		.values({ username: `links-versions-user-${++n}` })
		.returning()
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: user!.id, name: "Links versions" })
		.returning()
	const { member } = await insertCastMember(db(), {
		lorebookId: book!.id,
		binding: "{{char:1}}",
		name: "The Ashguard"
	})
	await writeCastVersion(db(), {
		member: member.id,
		changes: { name: "Warden Ashe" },
		writtenBy: `user:${user!.id}`,
		at: { branchId: null, date: { year: 10 }, personalPosition: null }
	})
	return { user: user!, book: book!, member }
}

describe("a dated rename written as a version", () => {
	test("lorebookLinks names the member as the reading has them", async () => {
		const w = await world()
		const before = await lorebookLinks(
			db(),
			w.book.id,
			await readingOf(db(), w.book.id, { moment: { year: 5 } })
		)
		expect(before.cast.map((c) => c.name)).toEqual(["The Ashguard"])
		const after = await lorebookLinks(
			db(),
			w.book.id,
			await readingOf(db(), w.book.id, { moment: { year: 12 } })
		)
		expect(after.cast.map((c) => c.name)).toEqual(["Warden Ashe"])
	})

	test("the picker's lorebook knows the name the session's clock gives them", async () => {
		const w = await world()
		const [session] = await testDb
			.insert(schema.sessions)
			.values({
				userId: w.user.id,
				isGroup: false,
				lorebookId: w.book.id,
				storyClockYear: 12
			} as any)
			.returning()
		const known = async (name: string) => {
			const r = await resolveSideCharacter(db(), session!.id, w.user.id, {
				name
			})
			if (!r.ok) throw new Error(r.error)
			return r.speaker.known
		}
		expect(await known("Warden Ashe")).toBe(true)
		expect(await known("The Ashguard")).toBe(false)
	})
})
