/**
 * LLM lane widths (perf-I, 2026-11-13): migration 0159 and the module that owns
 * `llm_lane_widths` — set, clear, refusals, the in-use host listing.
 */
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi
} from "vitest"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { migrate } from "drizzle-orm/pglite/migrator"
import { sql } from "drizzle-orm"
import path from "node:path"
import { rawRows } from "$lib/server/db/rawRows"
import { migrationsFolderThrough, type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, dbReady: Promise.resolve() }
})

import { db as mockedDb } from "$lib/server/db"
import { listLlmLaneHosts, setLlmLaneWidth } from "./llmLaneWidths"
import { llmLaneWidthOf, setLlmLaneWidthOverrides } from "./llmLanes"

const db = mockedDb as unknown as TestDb

const disposers: Array<() => Promise<void>> = []
afterAll(async () => {
	for (const d of disposers) await d()
})

describe("0159: llm_lane_widths", () => {
	it("creates the table empty on a 0158 database, and a second migrate changes nothing", async () => {
		const { folder, dispose } = await migrationsFolderThrough(
			"0158_sweet_nightshade"
		)
		disposers.push(dispose)
		const client = new PGlite()
		try {
			const d = drizzle(client)
			const q = async (s: string) =>
				rawRows<any>(await d.execute(sql.raw(s)))
			await migrate(d, { migrationsFolder: folder })
			expect(
				await q(
					`SELECT 1 FROM information_schema.tables WHERE table_name = 'llm_lane_widths'`
				)
			).toEqual([])

			const real = path.resolve(process.cwd(), "drizzle")
			await migrate(d, { migrationsFolder: real })
			expect(await q(`SELECT * FROM llm_lane_widths`)).toEqual([])

			const ledger = await q(
				`SELECT hash FROM drizzle.__drizzle_migrations ORDER BY id`
			)
			await migrate(d, { migrationsFolder: real })
			expect(
				await q(
					`SELECT hash FROM drizzle.__drizzle_migrations ORDER BY id`
				)
			).toEqual(ledger)
			expect(await q(`SELECT * FROM llm_lane_widths`)).toEqual([])
		} finally {
			await client.close()
		}
	}, 60_000)
})

async function connection(values: Record<string, unknown>) {
	const [row] = await db
		.insert(schema.connections)
		.values({
			name: `fixture ${Math.random()}`,
			baseUrl: "http://localhost:5001",
			extraJson: {},
			capabilities: {},
			type: CONNECTION_TYPE.OPENAI,
			...values
		} as any)
		.returning()
	return row
}

beforeEach(async () => {
	await db.delete(schema.llmLaneWidths)
	await db.delete(schema.connections)
	await db.delete(schema.koboldCppSettings)
	setLlmLaneWidthOverrides(new Map())
})

describe("llmLaneWidths", () => {
	it("sets an override, lists it, reads it through llmLaneWidthOf; null clears it", async () => {
		await connection({ name: "A", baseUrl: "http://localhost:8080/v1" })
		expect(await setLlmLaneWidth("http://localhost:8080", 3)).toEqual({})
		let hosts = await listLlmLaneHosts()
		expect(hosts).toHaveLength(1)
		expect(hosts[0]).toMatchObject({
			laneKey: "http://localhost:8080",
			width: 3,
			defaultWidth: 1
		})
		expect(llmLaneWidthOf(undefined, "http://localhost:8080")).toBe(3)

		expect(await setLlmLaneWidth("http://localhost:8080", 5)).toEqual({})
		expect(llmLaneWidthOf(undefined, "http://localhost:8080")).toBe(5)

		expect(await setLlmLaneWidth("http://localhost:8080", null)).toEqual({})
		hosts = await listLlmLaneHosts()
		expect(hosts[0].width).toBeNull()
		expect(llmLaneWidthOf(undefined, "http://localhost:8080")).toBe(1)
	}, 60_000)

	it("a saved width reaches the live queue at once: a waiting call starts", async () => {
		const { llmQueue } = await import("$lib/server/utils/llmQueue")
		const { llmLaneHostOf } = await import("./llmLanes")
		const lane = llmLaneHostOf({ baseUrl: "http://localhost:8099" })
		const gates: Array<() => void> = []
		const started: string[] = []
		const call = (label: string) =>
			llmQueue.enqueue({
				taskType: "session",
				connectionName: "c",
				samplingName: "s",
				lane,
				execute: () =>
					new Promise<string>((resolve) => {
						started.push(label)
						gates.push(() => resolve(label))
					})
			})
		const first = call("first")
		const second = call("second")
		await new Promise((r) => setTimeout(r, 0))
		expect(started).toEqual(["first"])
		expect(await setLlmLaneWidth("http://localhost:8099", 2)).toEqual({})
		await new Promise((r) => setTimeout(r, 0))
		expect(started).toEqual(["first", "second"])
		for (const open of gates) open()
		await Promise.all([first.done, second.done])
		expect(await setLlmLaneWidth("http://localhost:8099", null)).toEqual({})
	}, 60_000)

	it("refuses a non-origin key, 0, 17 and 2.5", async () => {
		for (const [key, w] of [
			["http://x:1/v1", 2],
			["http://x:1", 0],
			["http://x:1", 17],
			["http://x:1", 2.5]
		] as const) {
			const res = await setLlmLaneWidth(key, w)
			expect(res.error, `${key} ${w}`).toBeTruthy()
		}
		expect(await db.select().from(schema.llmLaneWidths)).toEqual([])
	}, 60_000)

	it("lists two connections on one host as one host, and skips non-text connections", async () => {
		await connection({ name: "Zed", baseUrl: "http://localhost:8080/v1" })
		await connection({ name: "Amy", baseUrl: "http://localhost:8080/v1" })
		await connection({
			name: "Embeds",
			type: CONNECTION_TYPE.LOCAL_ONNX_EMBEDDINGS,
			baseUrl: "http://localhost:9999"
		})
		await connection({
			name: "Pics",
			type: CONNECTION_TYPE.KOBOLDCPP_MANAGED_IMAGE,
			baseUrl: "http://localhost:7777"
		})
		const hosts = await listLlmLaneHosts()
		expect(hosts.map((h) => h.laneKey)).toEqual(["http://localhost:8080"])
		expect(hosts[0].connections.map((c) => c.name)).toEqual(["Amy", "Zed"])
	}, 60_000)

	it("lists an override whose host is no longer used with no connections", async () => {
		await connection({ name: "A", baseUrl: "http://localhost:8080/v1" })
		await setLlmLaneWidth("http://gone.example:1234", 2)
		const hosts = await listLlmLaneHosts()
		expect(hosts.map((h) => h.laneKey)).toEqual([
			"http://localhost:8080",
			"http://gone.example:1234"
		])
		expect(hosts[1]).toMatchObject({ width: 2, connections: [] })
	}, 60_000)

	it("lists a managed KoboldCPP at the settings address", async () => {
		await db
			.insert(schema.koboldCppSettings)
			.values({ koboldCppManagerBaseUrl: "http://localhost:5055" })
		await connection({
			name: "Managed",
			type: CONNECTION_TYPE.KOBOLDCPP_MANAGED,
			baseUrl: "http://localhost:5001"
		})
		const hosts = await listLlmLaneHosts()
		expect(hosts).toHaveLength(1)
		expect(hosts[0]).toMatchObject({
			laneKey: "http://localhost:5055",
			managed: true,
			defaultWidth: 1
		})
	}, 60_000)
})
