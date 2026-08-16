/**
 * Round-10 audit fix (LOW): samplingConfigsDelete/samplingConfigsUpdate
 * used currentSamplingConfig!.isImmutable (non-null assertion) instead of
 * the ?. every sibling *Configs handler uses — a nonexistent id threw a
 * raw TypeError instead of a clean not-found response. Fixed by switching
 * both to ?.isImmutable. Also: samplingConfigsGet gained the same
 * not-found handling promptConfigsGet already had, and the duplicate
 * legacy "sampling" handler/samplingHandler export was deleted (confirmed
 * nothing client-side still emits the legacy event before removing).
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "test-crypto-secret-key" }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-sampling-notfound-int-test-")
	)
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

async function makeAdmin(username: string) {
	const [admin] = await testDb
		.insert(schema.users)
		.values({ username, isAdmin: true })
		.returning()
	return admin
}

function fakeSocket(userId: number) {
	return {
		user: { id: userId, isAdmin: true },
		server: { to: () => ({ emit: () => {} }) }
	} as any
}

const noopEmit = () => {}

describe("samplingConfigsDelete — nonexistent id", () => {
	test("resolves as a clean no-op instead of throwing a raw TypeError on undefined.isImmutable", async () => {
		const { samplingConfigsDelete } = await import("./samplingConfigs")
		const admin = await makeAdmin("sampling-notfound-delete-user")

		// Pre-fix (currentSamplingConfig!.isImmutable), this threw "Cannot
		// read properties of undefined" for a nonexistent id. Deleting a
		// nonexistent row is otherwise a legitimate no-op (nothing to
		// delete), so the fixed behavior is a clean success response, not a
		// rejection.
		const res = await samplingConfigsDelete.handler(
			fakeSocket(admin.id),
			{ id: 999999 },
			noopEmit
		)
		expect(res.success).toBeTruthy()
	})
})

describe("samplingConfigsUpdate — nonexistent id", () => {
	test("doesn't throw a raw TypeError on undefined.isImmutable", async () => {
		const { samplingConfigsUpdate } = await import("./samplingConfigs")
		const admin = await makeAdmin("sampling-notfound-update-user")

		// currentSamplingConfig is undefined for this id — ?.isImmutable is
		// undefined (falsy), so this falls through past the immutable-guard
		// property access without throwing there. It still ends up
		// rejecting overall (the update affects 0 rows, then the handler's
		// own samplingConfigsGet re-fetch throws its own clean not-found
		// error) — the regression this guards against is specifically the
		// TypeError on the property access, not the overall outcome.
		await expect(
			samplingConfigsUpdate.handler(
				fakeSocket(admin.id),
				{ sampling: { id: 999999, name: "Ghost" } as any },
				noopEmit
			)
		).rejects.toThrow(/not found/i)
	})
})

describe("samplingConfigsGet — nonexistent id", () => {
	test("throws a clean not-found error", async () => {
		const { samplingConfigsGet } = await import("./samplingConfigs")
		const admin = await makeAdmin("sampling-notfound-get-user")

		await expect(
			samplingConfigsGet.handler(
				fakeSocket(admin.id),
				{ id: 999999 },
				noopEmit
			)
		).rejects.toThrow(/not found/i)
	})
})

describe("legacy sampling handler removal", () => {
	test("samplingHandler is no longer exported", async () => {
		const samplingConfigsModule: any = await import("./samplingConfigs")
		expect(samplingConfigsModule.samplingHandler).toBeUndefined()
	})
})
