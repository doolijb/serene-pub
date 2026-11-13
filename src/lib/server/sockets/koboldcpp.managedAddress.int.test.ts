/**
 * In Managed mode the address is made from the port: the column that every
 * adapter reads is written by every writer from `managedBaseUrl`, and a typed
 * address is refused. External mode keeps its own free-text address.
 */
import {
	afterAll,
	beforeAll,
	beforeEach,
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
		path.join(os.tmpdir(), "serene-pub-koboldcpp-managed-address-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
	await testDb.insert(schema.systemSettings).values({ id: 1 })
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const admin = () => ({ user: { id: 1, isAdmin: true } }) as any
const noopEmit = () => {}

async function reset(
	values: Partial<typeof schema.koboldCppSettings.$inferInsert>
) {
	await testDb.delete(schema.koboldCppSettings)
	await testDb.insert(schema.koboldCppSettings).values({ id: 1, ...values })
}
const read = async () =>
	(await testDb.query.koboldCppSettings.findFirst({
		where: eq(schema.koboldCppSettings.id, 1)
	}))!

describe("the Managed address follows the port (PGlite integration)", () => {
	beforeEach(async () => {
		await reset({
			koboldCppManagedMode: "managed",
			koboldCppManagedPort: 5001,
			koboldCppManagerBaseUrl: "http://localhost:5001"
		})
	}, 60_000)

	test("setManagedPort writes the address made from the port", async () => {
		const { koboldCppSetManagedPort } = await import("./koboldcpp")
		await koboldCppSetManagedPort.handler(admin(), { port: 5002 }, noopEmit)
		expect((await read()).koboldCppManagerBaseUrl).toBe(
			"http://localhost:5002"
		)
	}, 60_000)

	test("setBaseUrl is refused in Managed mode and changes nothing", async () => {
		const { koboldCppSetBaseUrl } = await import("./koboldcpp")
		const emit = vi.fn()
		await expect(
			koboldCppSetBaseUrl.handler(
				admin(),
				{ baseUrl: "http://elsewhere:9" },
				emit
			)
		).rejects.toThrow("In Managed mode the address follows the port")
		expect(emit).toHaveBeenCalledWith(
			"koboldcpp:setBaseUrl:error",
			expect.objectContaining({
				error: expect.stringContaining("follows the port")
			})
		)
		expect((await read()).koboldCppManagerBaseUrl).toBe(
			"http://localhost:5001"
		)
	}, 60_000)

	test("setBaseUrl still writes in External mode", async () => {
		await reset({ koboldCppManagedMode: "external" })
		const { koboldCppSetBaseUrl } = await import("./koboldcpp")
		await koboldCppSetBaseUrl.handler(
			admin(),
			{ baseUrl: "http://elsewhere:9" },
			noopEmit
		)
		expect((await read()).koboldCppManagerBaseUrl).toBe(
			"http://elsewhere:9"
		)
	}, 60_000)

	test("setManagedMode('managed') writes the address from the port", async () => {
		await reset({
			koboldCppManagedMode: "external",
			koboldCppManagedPort: 5003,
			koboldCppManagerBaseUrl: "http://elsewhere:9"
		})
		const { koboldCppSetManagedMode } = await import("./koboldcpp")
		await koboldCppSetManagedMode.handler(
			admin(),
			{ mode: "managed" },
			noopEmit
		)
		expect((await read()).koboldCppManagerBaseUrl).toBe(
			"http://localhost:5003"
		)
	}, 60_000)

	test("setManagedMode('external') leaves the address alone", async () => {
		await reset({
			koboldCppManagedMode: "managed",
			koboldCppManagedPort: 5003,
			koboldCppManagerBaseUrl: "http://localhost:5003"
		})
		const { koboldCppSetManagedMode } = await import("./koboldcpp")
		await koboldCppSetManagedMode.handler(
			admin(),
			{ mode: "external" },
			noopEmit
		)
		expect((await read()).koboldCppManagerBaseUrl).toBe(
			"http://localhost:5003"
		)
	}, 60_000)
})
