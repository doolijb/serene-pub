/**
 * Bugfix: `connections:update` had NO payload sanitation for `preset`, while
 * `connections:create` had coerced it since the column landed — so an update
 * persisted values a create would have thrown away.
 *
 * It does not merely sit there. The handler caches a `resolved` capability set
 * computed FROM the stored preset (`resolveConnectionCapabilities`), and that
 * cache is the hot-path read: the config picker checks every connection against
 * every slot, and the bind guard gates a run on it. So a numeric or invented
 * preset was not input untidiness — it was a wrong capability set, baked in.
 *
 * The second half is the one nothing checked at all: a stored slug was never
 * validated against the row's TYPE. `/document-view/connections/[id]/edit` has
 * the only Type picker for an existing connection and carries `preset`
 * unedited, so changing the API left the old service's slug behind — an
 * `openrouter` preset asserting `json_schema` on an `anthropic` row.
 *
 * The chosen answer is CLEAR-AND-SAY-SO rather than refuse: a person changing
 * the API is not asserting the old service, and refusing would make a legacy row
 * carrying an unrecognised slug permanently un-saveable. `Update.Response.notice`
 * is what stops the discard from being silent.
 *
 * Real PGlite, because every property here is about what the ROW ends up holding.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import { presetLabel } from "$lib/shared/utils/connectionDefaults"
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
		path.join(os.tmpdir(), "serene-pub-connections-preset-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
	// `systemSettingsGet` reads id=1 specifically and several handlers here push
	// it. A fresh test DB has no such row.
	await testDb.insert(schema.systemSettings).values({ id: 1 })
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

const fakeSocket = (userId: number) =>
	({
		user: { id: userId, isAdmin: true },
		server: { to: () => ({ emit: () => {} }) }
	}) as any

const noopEmit = () => {}

const rowOf = async (id: number) =>
	testDb.query.connections.findFirst({
		where: eq(schema.connections.id, id)
	})

/** A saved OpenAI-compatible connection on a real preset. */
async function seedOpenRouter(name: string) {
	const [row] = await testDb
		.insert(schema.connections)
		.values({
			name,
			type: CONNECTION_TYPE.OPENAI,
			preset: "openrouter"
		})
		.returning()
	return row
}

describe("connections:update refuses to store a preset that is not a slug", () => {
	test("a NUMERIC preset is not persisted, and does not reach the resolved cache", async () => {
		const { connectionsUpdate } = await import("./connections")
		const admin = await makeAdmin("preset-numeric")
		const row = await seedOpenRouter("Numeric preset")

		const res = await connectionsUpdate.handler(
			fakeSocket(admin.id),
			{
				connection: {
					id: row.id,
					// OpenRouter's display-order `value`, which is what a picker
					// sending the wrong field would produce. It keys nothing in
					// PRESET_CAPABILITIES while reading like a real slug.
					preset: 3
				} as any
			},
			noopEmit
		)

		const after = await rowOf(row.id)
		expect(after!.preset).toBeNull()
		// Not "3", and not the string "3" either.
		expect(after!.preset).not.toBe(3)
		expect(res.notice).toBeTruthy()
		// The save itself succeeded — this is a notice, not an error.
		expect(res.connection.id).toBe(row.id)
	})

	test("an invented slug is dropped rather than stored", async () => {
		const { connectionsUpdate } = await import("./connections")
		const admin = await makeAdmin("preset-invented")
		const row = await seedOpenRouter("Invented preset")

		const res = await connectionsUpdate.handler(
			fakeSocket(admin.id),
			{
				connection: { id: row.id, preset: "openrouterr" } as any
			},
			noopEmit
		)

		expect((await rowOf(row.id))!.preset).toBeNull()
		expect(res.notice).toContain("openrouterr")
	})

	test("an explicit null is a legal value and stays legal", async () => {
		const { connectionsUpdate } = await import("./connections")
		const admin = await makeAdmin("preset-null")
		const [row] = await testDb
			.insert(schema.connections)
			.values({
				name: "Custom endpoint",
				type: CONNECTION_TYPE.OPENAI,
				preset: null
			})
			.returning()

		const res = await connectionsUpdate.handler(
			fakeSocket(admin.id),
			{
				connection: {
					id: row.id,
					name: "Custom endpoint renamed",
					preset: null
				} as any
			},
			noopEmit
		)

		expect((await rowOf(row.id))!.preset).toBeNull()
		expect(res.connection.name).toBe("Custom endpoint renamed")
		// NULL means "custom". Saying so out loud discards nothing, so there is
		// nothing to warn about.
		expect(res.notice).toBeUndefined()
	})

	test("a partial update that never mentions the preset leaves it alone", async () => {
		// The regression this whole guard could easily have introduced: coercing
		// `undefined` the way create does would null a good preset on every
		// rename.
		const { connectionsUpdate } = await import("./connections")
		const admin = await makeAdmin("preset-partial")
		const row = await seedOpenRouter("Partial update")

		await connectionsUpdate.handler(
			fakeSocket(admin.id),
			{ connection: { id: row.id, name: "Renamed" } as any },
			noopEmit
		)

		const after = await rowOf(row.id)
		expect(after!.preset).toBe("openrouter")
		expect(after!.name).toBe("Renamed")
	})
})

describe("a preset must belong to the type the row ends up with", () => {
	test("changing the API clears the old service's slug and says so", async () => {
		const { connectionsUpdate } = await import("./connections")
		const admin = await makeAdmin("preset-typechange")
		const row = await seedOpenRouter("Was OpenRouter")

		const res = await connectionsUpdate.handler(
			fakeSocket(admin.id),
			{
				connection: {
					id: row.id,
					// What the Document View edit page sends: the new type, and
					// the preset it was carrying unedited.
					type: CONNECTION_TYPE.ANTHROPIC,
					preset: "openrouter"
				} as any
			},
			noopEmit
		)

		const after = await rowOf(row.id)
		expect(after!.type).toBe(CONNECTION_TYPE.ANTHROPIC)
		expect(after!.preset).toBeNull()
		// Not silent, and readable — the preset's own name, not its slug.
		expect(res.notice).toContain(presetLabel("openrouter"))
	})

	test("a bare type change strands the stored preset, and that is caught too", async () => {
		// The payload never mentions `preset` at all, so only the STORED value
		// can reveal the mismatch. Judging the payload alone would miss it.
		const { connectionsUpdate } = await import("./connections")
		const admin = await makeAdmin("preset-typechange-bare")
		const row = await seedOpenRouter("Bare type change")

		const res = await connectionsUpdate.handler(
			fakeSocket(admin.id),
			{
				connection: {
					id: row.id,
					type: CONNECTION_TYPE.ANTHROPIC
				} as any
			},
			noopEmit
		)

		expect((await rowOf(row.id))!.preset).toBeNull()
		expect(res.notice).toBeTruthy()
	})

	test("the resolved cache is rebuilt from the CLEARED preset, not the stale one", async () => {
		// The reason this is worth more than input hygiene. `openrouter` asserts
		// `json_schema`, which the native Anthropic adapter does not declare at
		// all — so a surviving slug would cache a capability the connection
		// cannot deliver, and the bind guard reads that cache.
		const { connectionsUpdate } = await import("./connections")
		const admin = await makeAdmin("preset-typechange-cache")
		const row = await seedOpenRouter("Cache check")

		await connectionsUpdate.handler(
			fakeSocket(admin.id),
			{
				connection: {
					id: row.id,
					type: CONNECTION_TYPE.ANTHROPIC,
					preset: "openrouter"
				} as any
			},
			noopEmit
		)

		const after = await rowOf(row.id)
		const resolved = (after!.capabilities as any).resolved ?? {}
		expect(resolved.json_schema ?? 0).toBe(0)
		// And the type's own declaration did survive — this is a rebuild, not a
		// wipe.
		expect(resolved["text->text"]).toBeGreaterThan(0)
	})

	test("a matching preset survives a save on its own type", async () => {
		const { connectionsUpdate } = await import("./connections")
		const admin = await makeAdmin("preset-typematch")
		const row = await seedOpenRouter("Still OpenRouter")

		const res = await connectionsUpdate.handler(
			fakeSocket(admin.id),
			{
				connection: {
					id: row.id,
					type: CONNECTION_TYPE.OPENAI,
					preset: "openrouter"
				} as any
			},
			noopEmit
		)

		expect((await rowOf(row.id))!.preset).toBe("openrouter")
		expect(res.notice).toBeUndefined()
	})
})

describe("an existing row with an unrecognised slug stays readable", () => {
	test("connections:get returns it untouched, and the label falls back to the slug", async () => {
		// Tolerant on READ. A row written before this validation existed — or by
		// a hand-crafted payload — must not become unreadable because of it.
		const { connectionsGet, connectionsCapabilities } = await import(
			"./connections"
		)
		const admin = await makeAdmin("preset-legacy-read")
		const [legacy] = await testDb
			.insert(schema.connections)
			.values({
				name: "Legacy slug",
				type: CONNECTION_TYPE.OPENAI,
				preset: "some-retired-service"
			})
			.returning()

		const got = await connectionsGet.handler(
			fakeSocket(admin.id),
			{ id: legacy.id },
			noopEmit
		)
		expect((got.connection as any).preset).toBe("some-retired-service")

		// The capability panel reads it too, and answers rather than throwing.
		const view = await connectionsCapabilities.handler(
			fakeSocket(admin.id),
			{ id: legacy.id },
			noopEmit
		)
		expect(view.error).toBeUndefined()
		expect(view.preset).toBe("some-retired-service")
		expect(presetLabel("some-retired-service")).toBe("some-retired-service")
	})

	test("and saving it heals the row instead of refusing the save", async () => {
		// Strict on WRITE. Refusing would leave the row permanently
		// un-editable, which is the read-tolerance above undone from the other
		// side.
		const { connectionsUpdate } = await import("./connections")
		const admin = await makeAdmin("preset-legacy-write")
		const [legacy] = await testDb
			.insert(schema.connections)
			.values({
				name: "Legacy slug 2",
				type: CONNECTION_TYPE.OPENAI,
				preset: "some-retired-service"
			})
			.returning()

		const res = await connectionsUpdate.handler(
			fakeSocket(admin.id),
			{
				connection: {
					id: legacy.id,
					name: "Legacy slug 2 renamed",
					preset: "some-retired-service"
				} as any
			},
			noopEmit
		)

		const after = await rowOf(legacy.id)
		expect(after!.name).toBe("Legacy slug 2 renamed")
		expect(after!.preset).toBeNull()
		expect(res.notice).toBeTruthy()

		// Healed, so the next save is quiet.
		const again = await connectionsUpdate.handler(
			fakeSocket(admin.id),
			{
				connection: {
					id: legacy.id,
					name: "Legacy slug 2 renamed again"
				} as any
			},
			noopEmit
		)
		expect(again.notice).toBeUndefined()
	})
})

describe("create and update now agree", () => {
	test("create still nulls a numeric preset", async () => {
		// Unchanged behaviour, routed through the shared normalizer — the point
		// of the fix is that update no longer disagrees with it.
		const { connectionsCreate } = await import("./connections")
		const admin = await makeAdmin("preset-create-numeric")

		const created = await connectionsCreate.handler(
			fakeSocket(admin.id),
			{
				connection: {
					name: "Created with a number",
					type: CONNECTION_TYPE.OPENAI,
					preset: 3
				} as any
			},
			noopEmit
		)

		expect((await rowOf(created.connection.id))!.preset).toBeNull()
	})

	test("create keeps a real slug, and an update of the same row keeps it too", async () => {
		const { connectionsCreate, connectionsUpdate } = await import(
			"./connections"
		)
		const admin = await makeAdmin("preset-create-slug")

		const created = await connectionsCreate.handler(
			fakeSocket(admin.id),
			{
				connection: {
					name: "Created with a slug",
					type: CONNECTION_TYPE.OPENAI,
					preset: "groq"
				} as any
			},
			noopEmit
		)
		expect((await rowOf(created.connection.id))!.preset).toBe("groq")

		await connectionsUpdate.handler(
			fakeSocket(admin.id),
			{
				connection: {
					id: created.connection.id,
					name: "Created with a slug, renamed"
				} as any
			},
			noopEmit
		)
		expect((await rowOf(created.connection.id))!.preset).toBe("groq")
	})
})
