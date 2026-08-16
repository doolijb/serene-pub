/**
 * Round-10 audit fix (LOW): userSettingsUpdateBackground stored
 * params.path verbatim, later interpolated unescaped into a CSS url(...)
 * on the user's own page (Layout.svelte) — self-targeting CSS injection.
 * Fixed by validating the path is a member of getDefaultBackgrounds() or
 * this user's own listUserBackgrounds() before writing it.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import type { TestDb } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-usersettings-bg-int-test-")
	)
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

async function makeUser(username: string) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, username)
}

function fakeSocket(userId: number) {
	return { user: { id: userId } } as any
}

const noopEmit = () => {}

describe("userSettings:updateBackground — path validation", () => {
	test("rejects a path that isn't a real default or one of this user's own uploads", async () => {
		const { userSettingsUpdateBackground, userSettingsGet } = await import(
			"./userSettings"
		)
		const user = await makeUser("usersettings-bg-forged-user")
		await userSettingsGet.handler(fakeSocket(user.id), {}, noopEmit)

		await expect(
			userSettingsUpdateBackground.handler(
				fakeSocket(user.id),
				{
					path: "');background-image:url('https://evil.example.com/x.png",
					opacity: 1
				} as any,
				noopEmit
			)
		).rejects.toThrow(/invalid background image/i)
	})

	test("accepts a real default background path", async () => {
		const { userSettingsUpdateBackground, userSettingsGet, getDefaultBackgrounds } =
			await import("./userSettings")
		const user = await makeUser("usersettings-bg-default-user")
		await userSettingsGet.handler(fakeSocket(user.id), {}, noopEmit)

		const defaults = getDefaultBackgrounds()
		expect(defaults.length).toBeGreaterThan(0)

		const res = await userSettingsUpdateBackground.handler(
			fakeSocket(user.id),
			{ path: defaults[0], opacity: 50 } as any,
			noopEmit
		)
		expect(res.path).toBe(defaults[0])
	})

	test("accepts null (clearing the background)", async () => {
		const { userSettingsUpdateBackground, userSettingsGet } = await import(
			"./userSettings"
		)
		const user = await makeUser("usersettings-bg-null-user")
		await userSettingsGet.handler(fakeSocket(user.id), {}, noopEmit)

		const res = await userSettingsUpdateBackground.handler(
			fakeSocket(user.id),
			{ path: null, opacity: 1 } as any,
			noopEmit
		)
		expect(res.path).toBeNull()
	})
})
