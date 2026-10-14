/**
 * What picks a sampling config, and naming it the default for chosen jobs
 * (design D.3, 2026-10-09).
 *
 * The ★ in the Sampling view reads EVERY job's `connection_defaults` row, so
 * `samplingConfigs:usedBy` lists every job a config can hold: the transforms
 * the registry demands, plus any row naming a config. Its pipeline half is the
 * library's own walk, mapped from labels to the slugs a link opens.
 * `samplingConfigs:setDefaultFor` writes only the jobs it is given, and only
 * jobs that speak the config's shape.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { S } from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"
import {
	capabilityDefault,
	setCapabilityDefault
} from "$lib/server/connections/capabilityDefaults"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { isDefaultLoadout } from "$lib/server/loadouts/testing"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "test-crypto-secret-key" }
})

// The pipeline half is the library's walk; what is under test here is how
// its labels become links, so the library answers with a fixture.
vi.mock("$lib/server/pipelines/config/library", () => ({
	libraryView: async () => ({
		pipelines: [
			{ slug: "core:spec/chat-respond", label: "Reply · Chat" },
			{ slug: "core:spec/summarize-scene", label: "Summarize scene" }
		],
		samplingUsedBy: { 41: ["Reply · Chat", "From a plugin that is off"] }
	})
}))

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-sampling-usedby-int-test-")
	)
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
	// setDefaultFor finishes by pushing systemSettings:get, which throws on an
	// instance with no settings row. A test DB is migrated, not seeded.
	await testDb
		.insert(schema.systemSettings)
		.values({ id: 1 })
		.onConflictDoNothing()
	// Demand two text jobs and two image jobs, so each shape has a list.
	await testDb.insert(schema.pipelineDefinitionRegistry).values({
		definitionId: "test:oracle/look-and-draw",
		version: 1,
		kind: "node",
		slots: {
			reader: {
				kind: "connection",
				requires: ["text->text", "text+image->text"]
			},
			painter: {
				kind: "connection",
				requires: ["text+image->image", "image->image"]
			}
		}
	})
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const socketFor = (isAdmin = true) =>
	({
		user: { id: 1, isAdmin },
		server: { to: () => ({ emit: () => {} }) }
	}) as any

function recorder() {
	const events: Array<{ event: string; data: any }> = []
	const emit = (event: string, data: any) => {
		events.push({ event, data })
	}
	return { events, emit }
}

async function config(name: string, shape: string) {
	const [row] = await testDb
		.insert(schema.samplingConfigs)
		.values({ name, shape })
		.returning()
	return row
}

describe("samplingConfigs:usedBy", () => {
	test("lists every job of every shape, with the config each one names", async () => {
		const { samplingConfigsUsedBy } = await import("./samplingConfigs")
		const text = await config("UsedBy text", S.textGen)
		await setCapabilityDefault(testDb as any, "text+image->text", {
			samplingConfigId: text.id
		})

		const res = await samplingConfigsUsedBy.handler(
			socketFor(false),
			{},
			() => {}
		)

		const byCap = new Map(res.jobs.map((j) => [j.capability, j]))
		expect(byCap.get("text+image->text")).toEqual({
			capability: "text+image->text",
			shape: S.textGen,
			samplingConfigId: text.id
		})
		expect(byCap.get("text->text")?.shape).toBe(S.textGen)
		expect(byCap.get("image->image")?.shape).toBe(S.imageGen)
		expect(byCap.get("text+image->image")?.samplingConfigId).toBeNull()
	})

	test("a row naming a config shows even for a transform nothing demands", async () => {
		const { samplingConfigsUsedBy } = await import("./samplingConfigs")
		const text = await config("UsedBy undemanded", S.textGen)
		await setCapabilityDefault(testDb as any, "text+document->text", {
			samplingConfigId: text.id
		})

		const res = await samplingConfigsUsedBy.handler(
			socketFor(),
			{},
			() => {}
		)

		expect(
			res.jobs.find((j) => j.capability === "text+document->text")
				?.samplingConfigId
		).toBe(text.id)
	})

	test("names each pipeline by label with the slug a link opens", async () => {
		const { samplingConfigsUsedBy } = await import("./samplingConfigs")
		const { events, emit } = recorder()

		const res = await samplingConfigsUsedBy.handler(socketFor(), {}, emit)

		expect(res.pipelines[41]).toEqual([
			{ label: "Reply · Chat", slug: "core:spec/chat-respond" },
			{ label: "From a plugin that is off", slug: null }
		])
		expect(events.map((e) => e.event)).toEqual(["samplingConfigs:usedBy"])
	})
})

describe("samplingConfigs:setDefaultFor", () => {
	test("writes the ticked jobs and leaves the rest alone", async () => {
		const { samplingConfigsSetDefaultFor } = await import(
			"./samplingConfigs"
		)
		const before = await config("Before", S.textGen)
		const text = await config("Ticked", S.textGen)
		await setCapabilityDefault(testDb as any, "text->text", {
			samplingConfigId: before.id
		})

		const res = await samplingConfigsSetDefaultFor.handler(
			socketFor(),
			{ id: text.id, transforms: ["text+image->text"] },
			() => {}
		)

		expect(res).toEqual({ id: text.id, transforms: ["text+image->text"] })
		expect(
			(await capabilityDefault(testDb as any, "text+image->text"))
				?.samplingConfigId
		).toBe(text.id)
		expect(
			(await capabilityDefault(testDb as any, "text->text"))
				?.samplingConfigId
		).toBe(before.id)
	})

	test("refuses a job of another shape and writes nothing", async () => {
		const { samplingConfigsSetDefaultFor } = await import(
			"./samplingConfigs"
		)
		const image = await config("Wrong shape", S.imageGen)
		const { events, emit } = recorder()
		const rowsBefore = await testDb.select().from(schema.loadouts).where(isDefaultLoadout)

		await expect(
			samplingConfigsSetDefaultFor.handler(
				socketFor(),
				{ id: image.id, transforms: ["image->image", "text->text"] },
				emit
			)
		).rejects.toThrow(/text->text/)

		expect(events.map((e) => e.event)).toEqual([
			"samplingConfigs:setDefaultFor:error"
		])
		expect(await testDb.select().from(schema.loadouts).where(isDefaultLoadout)).toEqual(
			rowsBefore
		)
	})

	test("omitted transforms name every job of the shape", async () => {
		const { samplingConfigsSetDefaultFor } = await import(
			"./samplingConfigs"
		)
		const image = await config("Every image job", S.imageGen)

		const res = await samplingConfigsSetDefaultFor.handler(
			socketFor(),
			{ id: image.id },
			() => {}
		)

		expect(res.transforms).toEqual(
			expect.arrayContaining(["text+image->image", "image->image"])
		)
		expect(res.transforms).not.toContain("text->text")
	})

	test("a member is refused", async () => {
		const { samplingConfigsSetDefaultFor } = await import(
			"./samplingConfigs"
		)
		const text = await config("Members cannot", S.textGen)
		await expect(
			samplingConfigsSetDefaultFor.handler(
				socketFor(false),
				{ id: text.id, transforms: ["text->text"] },
				() => {}
			)
		).rejects.toThrow(/Only admin/)
	})
})
