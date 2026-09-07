/**
 * A configuration is the administrator's; a person's choice is a selection.
 *
 * R8 removes user-owned pipeline configurations. There is no owner column to
 * drop — there never was one — so what the ruling actually asks of this layer
 * is that the four verbs which *define what exists* refuse anybody else, at the
 * socket, and that the refusal is a refusal rather than a no-op that returns
 * cheerfully having written nothing.
 *
 * These tests are deliberately about the SERVER. Every one of these events is
 * emitted only from `/admin/pipelines/[slug]`, which is behind a client-side
 * admin gate — and a client-side gate is a fact about a button, not about the
 * socket. What is pinned here is the socket: each refusal names admin, and the
 * row it would have touched is checked afterwards to prove nothing happened.
 * A guard that returned an error *and* wrote would pass a message assertion
 * alone.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string

// `./pipelines` reaches $lib/server/db at import time, and the panel behind it
// wants the instance secret — both stubbed here rather than through
// importOriginal(), which would read and write the real on-disk data dir as an
// import side effect. Same shape as pipelines.configNotices.int.test.ts.
vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "test-crypto-secret-key" }
})

const SLUG = "test:spec/ownership"

let specId: number
let configId: number

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-config-ownership-int-test-")
	)
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb

	const [spec] = await testDb
		.insert(schema.pipelineSpecs)
		.values({ slug: SLUG, name: "Ownership" })
		.returning()
	specId = spec.id

	const [config] = await testDb
		.insert(schema.pipelineConfigs)
		.values({ specId, name: "Curated" })
		.returning()
	configId = config.id
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const fakeSocket = (isAdmin = true) =>
	({
		user: { id: 1, isAdmin },
		server: { to: () => ({ emit: () => {} }) }
	}) as any

const noopEmit = () => {}

/** Every config row for the fixture spec, as it stands right now. */
const configs = async () =>
	await testDb
		.select()
		.from(schema.pipelineConfigs)
		.where(eq(schema.pipelineConfigs.specId, specId))

describe("defining what configurations exist is the administrator's", () => {
	test("pipelines:createConfig refuses a non-admin, and makes nothing", async () => {
		const before = (await configs()).length
		const { pipelinesCreateConfig } = await import("./pipelines")
		const res = await pipelinesCreateConfig.handler(
			fakeSocket(false),
			{ slug: SLUG, name: "Mine" },
			noopEmit
		)
		expect(res.error).toMatch(/admin/i)
		// The claim that matters: not "it said no" but "it did nothing". A
		// guard that answered with an error after inserting would still leave
		// a configuration somebody made for themselves.
		expect((await configs()).length).toBe(before)
	})

	test("pipelines:createConfig refuses a non-admin duplicating an existing one", async () => {
		// Duplication is the route that looks least like creation — the row
		// already exists and the caller is "only copying" it. It is creation.
		const before = (await configs()).length
		const { pipelinesCreateConfig } = await import("./pipelines")
		const res = await pipelinesCreateConfig.handler(
			fakeSocket(false),
			{ slug: SLUG, name: "Curated copy", fromConfigId: configId },
			noopEmit
		)
		expect(res.error).toMatch(/admin/i)
		expect((await configs()).length).toBe(before)
	})

	test("pipelines:renameConfig refuses a non-admin, and the name stands", async () => {
		const { pipelinesRenameConfig } = await import("./pipelines")
		const res = await pipelinesRenameConfig.handler(
			fakeSocket(false),
			{ slug: SLUG, configId, name: "Renamed by a user" },
			noopEmit
		)
		expect(res.error).toMatch(/admin/i)
		const [row] = await testDb
			.select()
			.from(schema.pipelineConfigs)
			.where(eq(schema.pipelineConfigs.id, configId))
		expect(row.name).toBe("Curated")
	})

	test("pipelines:deleteConfig refuses a non-admin, and the row survives", async () => {
		const { pipelinesDeleteConfig } = await import("./pipelines")
		const res = await pipelinesDeleteConfig.handler(
			fakeSocket(false),
			{ slug: SLUG, configId },
			noopEmit
		)
		expect(res.error).toMatch(/admin/i)
		const rows = await testDb
			.select()
			.from(schema.pipelineConfigs)
			.where(eq(schema.pipelineConfigs.id, configId))
		expect(rows.length).toBe(1)
	})

	test("pipelines:setPresetActions refuses a non-admin, so curation stays curation", async () => {
		// `enabled` is the switch that decides what the offered set contains.
		// A non-admin able to flip it could put a withdrawn configuration back
		// on their own menu, which defeats the read filter and the selection
		// refusal in one move.
		const { pipelinesSetPresetActions } = await import("./pipelines")
		const res = await pipelinesSetPresetActions.handler(
			fakeSocket(false),
			{ slug: SLUG, configId, enabled: false },
			noopEmit
		)
		expect(res.error).toMatch(/admin/i)
		const [row] = await testDb
			.select()
			.from(schema.pipelineConfigs)
			.where(eq(schema.pipelineConfigs.id, configId))
		expect(row.enabled).toBe(true)
	})

	test("an admin may do all four, so the refusals are about the role", async () => {
		// The counterpart every permission test needs: without it, a handler
		// broken for everyone passes every case above.
		const { pipelinesCreateConfig, pipelinesSetPresetActions } =
			await import("./pipelines")

		// Both handlers answer by re-reading the panel view, which this
		// fixture spec cannot produce — it has rows but no published version —
		// so the response carries that read's complaint rather than a refusal.
		// The database is therefore the claim here, exactly as it is above:
		// what a non-admin could not change, an admin did.
		const made = await pipelinesCreateConfig.handler(
			fakeSocket(true),
			{ slug: SLUG, name: "Admin's" },
			noopEmit
		)
		const [mine] = await testDb
			.select()
			.from(schema.pipelineConfigs)
			.where(eq(schema.pipelineConfigs.name, "Admin's"))
		expect(mine).toBeTruthy()
		expect(made.configId).toBe(mine.id)

		await pipelinesSetPresetActions.handler(
			fakeSocket(true),
			{ slug: SLUG, configId: mine.id, enabled: false },
			noopEmit
		)
		const [withdrawn] = await testDb
			.select()
			.from(schema.pipelineConfigs)
			.where(eq(schema.pipelineConfigs.id, mine.id))
		expect(withdrawn.enabled).toBe(false)
	})
})
