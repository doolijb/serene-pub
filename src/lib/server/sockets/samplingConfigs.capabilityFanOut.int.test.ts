/**
 * Starring a sampling config registers it against EVERY capability that speaks
 * its vocabulary — not against one canonical representative.
 *
 * The failure is silent and it is a lie on screen. `TRANSFORMS` names
 * `text->image`, `text+image->image` and `image->image`, and all three take the
 * same steps/CFG/sampler values. A star that wrote only `text->image` leaves the
 * sidebar's one control saying "the image default" while an img2img node goes on
 * reading whatever is registered against `text+image->image` — usually nothing.
 * Nothing throws; the button just looks like it worked.
 *
 * The registry row here is a FIXTURE rather than core's own, deliberately: no
 * core node type demands the two img2img transforms today, so with an empty
 * registry the fan-out is correct and invisible. Declaring one is how the test
 * asserts the mechanism rather than the current data.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import { byCapability } from "$lib/server/connections/capabilityDefaults"
import { transformIdOf } from "$lib/shared/capabilities/sides"
import { S } from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "test-crypto-secret-key" }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-sampling-fanout-int-test-")
	)
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
	// The star path finishes by pushing systemSettings:get, which throws on an
	// instance with no settings row. A test DB is migrated, not seeded.
	await testDb
		.insert(schema.systemSettings)
		.values({ id: 1 })
		.onConflictDoNothing()
	// A node type that demands both img2img transforms, so the aggregation has
	// all three image capabilities to fan out over.
	await testDb.insert(schema.pipelineTypeRegistry).values({
		typeId: "test:provider/edit-image",
		version: 1,
		kind: "node",
		slots: {
			connection: {
				kind: "connection",
				requires: ["text+image->image", "image->image"]
			}
		}
	})
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

async function makeAdmin(username: string) {
	const [admin] = await testDb
		.insert(schema.users)
		.values({ username, isAdmin: true })
		.returning()
	return admin
}

const socketFor = (userId: number) =>
	({
		user: { id: userId, isAdmin: true },
		server: { to: () => ({ emit: () => {} }) }
	}) as any

const noopEmit = () => {}

describe("samplingConfigs:setUserActive — the fan-out", () => {
	test("an image config lands on every image capability, not just text->image", async () => {
		const { samplingConfigsSetUserActive } = await import(
			"./samplingConfigs"
		)
		const admin = await makeAdmin("sampling-fanout-image-user")
		const [config] = await testDb
			.insert(schema.samplingConfigs)
			.values({ name: "Fan-out image", shape: S.imageGen })
			.returning()

		await samplingConfigsSetUserActive.handler(
			socketFor(admin.id),
			{ id: config.id },
			noopEmit
		)

		// Asked by OUTPUT KIND rather than by a list of three ids, which is the
		// query 0183 split the key to make possible — and it is a stronger
		// question than the `inArray` over three names it replaces: this now
		// reads every default that produces an image, so a FOURTH image
		// transform quietly picking the config up would fail here instead of
		// going unlooked-at.
		const rows = await testDb
			.select()
			.from(schema.connectionDefaults)
			.where(eq(schema.connectionDefaults.output, "image"))
		expect(
			rows
				.filter((r) => r.samplingConfigId === config.id)
				.map((r) => transformIdOf(r))
				.sort()
		).toEqual(["image->image", "text+image->image", "text->image"])
	})

	test("it does not spill into another modality", async () => {
		// The shape is what decides, never a parameter the caller passes: a
		// client that could name the capability could make an image config the
		// chat default, and the shape exists precisely so that it cannot.
		const { samplingConfigsSetUserActive } = await import(
			"./samplingConfigs"
		)
		const admin = await makeAdmin("sampling-fanout-text-user")
		const [config] = await testDb
			.insert(schema.samplingConfigs)
			.values({ name: "Fan-out text", shape: S.textGen })
			.returning()

		await samplingConfigsSetUserActive.handler(
			socketFor(admin.id),
			{ id: config.id },
			noopEmit
		)

		const [chat] = await testDb
			.select()
			.from(schema.connectionDefaults)
			.where(byCapability("text->text"))
		expect(chat.samplingConfigId).toBe(config.id)

		const image = await testDb
			.select()
			.from(schema.connectionDefaults)
			.where(byCapability("text->image"))
		expect(image[0]?.samplingConfigId).not.toBe(config.id)
	})

	test("a config of an unrecognised shape registers nothing at all", async () => {
		// NOT a fall back to text. Starring a config of some future shape must
		// not quietly become "this is now the default for chat" — and there is
		// deliberately no text->image consolation prize when the aggregation
		// names nothing, because that fallback is the silent gap this replaces.
		const { samplingConfigsSetUserActive } = await import(
			"./samplingConfigs"
		)
		const admin = await makeAdmin("sampling-fanout-unknown-user")
		const [config] = await testDb
			.insert(schema.samplingConfigs)
			.values({ name: "Fan-out unknown", shape: "core:shape/future@1" })
			.returning()

		const before = await testDb.select().from(schema.connectionDefaults)
		await samplingConfigsSetUserActive.handler(
			socketFor(admin.id),
			{ id: config.id },
			noopEmit
		)
		const after = await testDb.select().from(schema.connectionDefaults)

		expect(after).toEqual(before)
		expect(after.some((r) => r.samplingConfigId === config.id)).toBe(false)
	})

	test("deleting a starred config clears the registrations and leaves the rows", async () => {
		// `ON DELETE SET NULL`, not `ON DELETE CASCADE`, and the difference is
		// the sentence a person reads: a row with a null sampling id says "the
		// default was cleared", an absent row says "no default was ever set".
		// Nothing picks a replacement — the old code searched for the first
		// immutable config and then fell back to `id: 1`.
		const { samplingConfigsSetUserActive, samplingConfigsDelete } =
			await import("./samplingConfigs")
		const admin = await makeAdmin("sampling-fanout-delete-user")
		const [config] = await testDb
			.insert(schema.samplingConfigs)
			.values({ name: "Fan-out doomed", shape: S.imageGen })
			.returning()

		await samplingConfigsSetUserActive.handler(
			socketFor(admin.id),
			{ id: config.id },
			noopEmit
		)
		await samplingConfigsDelete.handler(
			socketFor(admin.id),
			{ id: config.id },
			noopEmit
		)

		const rows = await testDb
			.select()
			.from(schema.connectionDefaults)
			.where(byCapability("text->image"))
		expect(rows.length).toBe(1)
		expect(rows[0].samplingConfigId).toBeNull()
	})
})
