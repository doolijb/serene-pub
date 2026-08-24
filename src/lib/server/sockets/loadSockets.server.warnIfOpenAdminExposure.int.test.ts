/**
 * Round-12 audit fix (MEDIUM): the compose files already document the
 * SOCKETS_ALLOWED_ORIGINS=* + disabled-accounts-mode exposure tradeoff in a
 * comment, but there was no runtime signal of it. warnIfOpenAdminExposure()
 * (called once at server startup) logs a loud warning when both conditions
 * are true — every connection reaching this port auto-attaches as an
 * unauthenticated admin.
 */
import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	test,
	vi
} from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"

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
		path.join(os.tmpdir(), "serene-pub-openexposure-warn-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir

	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const ORIGINAL_ALLOWED_ORIGINS = process.env.SOCKETS_ALLOWED_ORIGINS

afterEach(() => {
	if (ORIGINAL_ALLOWED_ORIGINS === undefined) {
		delete process.env.SOCKETS_ALLOWED_ORIGINS
	} else {
		process.env.SOCKETS_ALLOWED_ORIGINS = ORIGINAL_ALLOWED_ORIGINS
	}
})

describe("warnIfOpenAdminExposure (Round-12 audit fix, PGlite integration)", () => {
	test("warns when accounts are disabled and SOCKETS_ALLOWED_ORIGINS=*", async () => {
		process.env.SOCKETS_ALLOWED_ORIGINS = "*"
		await testDb
			.insert(schema.systemSettings)
			.values({ id: 1, isAccountsEnabled: false })
			.onConflictDoNothing()

		const { warnIfOpenAdminExposure } = await import("./loadSockets.server")
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
		await warnIfOpenAdminExposure()

		expect(warnSpy).toHaveBeenCalledWith(
			expect.stringContaining("accounts are disabled")
		)
		warnSpy.mockRestore()
	}, 30_000)

	test("does not warn when accounts are enabled, even with SOCKETS_ALLOWED_ORIGINS=*", async () => {
		process.env.SOCKETS_ALLOWED_ORIGINS = "*"
		await testDb
			.update(schema.systemSettings)
			.set({ isAccountsEnabled: true })
			.where(eq(schema.systemSettings.id, 1))

		const { warnIfOpenAdminExposure } = await import("./loadSockets.server")
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
		await warnIfOpenAdminExposure()

		expect(warnSpy).not.toHaveBeenCalled()
		warnSpy.mockRestore()

		// Reset for subsequent tests.
		await testDb
			.update(schema.systemSettings)
			.set({ isAccountsEnabled: false })
			.where(eq(schema.systemSettings.id, 1))
	})

	test("does not warn when SOCKETS_ALLOWED_ORIGINS is not the wildcard, even with accounts disabled", async () => {
		delete process.env.SOCKETS_ALLOWED_ORIGINS

		const { warnIfOpenAdminExposure } = await import("./loadSockets.server")
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
		await warnIfOpenAdminExposure()

		expect(warnSpy).not.toHaveBeenCalled()
		warnSpy.mockRestore()
	})
})
