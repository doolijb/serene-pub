/**
 * Saving a connection does not make it the default. Nothing does, except saying so.
 *
 * > "pipelines will not automatically choose a saved connection just because it
 * > exists. it needs to be set somewhere in the app for use."
 *
 * `connections:create` used to auto-star the first connection ever saved —
 * "only when no default exists yet", which reads harmless and was not. It wrote
 * `text->text` regardless of what the row could DO, so an instance whose first
 * connection was an image endpoint got that endpoint as its chat default and
 * found out at the next Send, from a sentence about adapters.
 *
 * ## Why this needs a test at all
 *
 * Every failure in this file is silent in the direction that passes. An auto-star
 * that came back would make chat WORK on a fresh install — the connection you
 * just saved is nearly always the one you meant — so nothing would look wrong
 * until the day somebody saved an image endpoint first, or a second connection
 * quietly kept losing to the first. There is no error to assert on; the only
 * observable is that a row in `connection_defaults` does not exist.
 *
 * It runs against real PGlite rather than a fake db because two of the three
 * properties here ARE database behaviour: the ON DELETE SET NULL cascade, and
 * the fact that a capability's registration is a row rather than a column.
 */

import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import { byCapability } from "$lib/server/connections/capabilityDefaults"
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
		path.join(os.tmpdir(), "serene-pub-connections-nodefault-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
	// `systemSettingsGet` reads id=1 specifically, and several handlers here push
	// it so clients learn the star moved. A fresh test DB has no such row.
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

const defaultFor = (capability: string) =>
	testDb.query.connectionDefaults.findFirst({
		where: byCapability(capability)
	})

describe("connections:create registers nothing", () => {
	test("the FIRST connection ever saved does not become the chat default", async () => {
		const { connectionsCreate } = await import("./connections")
		const admin = await makeAdmin("nodefault-first")

		const created = await connectionsCreate.handler(
			fakeSocket(admin.id),
			{
				connection: {
					name: "First ever",
					type: "ollama",
					baseUrl: "http://localhost:11434"
				} as any
			},
			noopEmit as any
		)

		expect(created.connection.id).toBeGreaterThan(0)
		// The whole ruling, in one absence. `?.connectionId ?? null` rather than
		// `toBeUndefined()`, because a row can legitimately exist here carrying
		// only the seeded sampling half — what must not exist is a CONNECTION
		// nobody chose.
		expect(
			(await defaultFor("text->text"))?.connectionId ?? null
		).toBeNull()
	})

	test("nor does it when it is still the only connection on the instance", async () => {
		// The single-connection shortcut is the most tempting of the pickups
		// this change deleted: with one row saved, "the default" and "the only
		// one" are the same connection every time anybody tests it.
		const rows = await testDb.select().from(schema.connections)
		expect(rows.length).toBe(1)
		expect(
			(await defaultFor("text->text"))?.connectionId ?? null
		).toBeNull()
	})
})

describe("connections:setDefault is the only way in", () => {
	test("it registers the capability it was told, and only that one", async () => {
		const { connectionsSetDefault } = await import("./connections")
		const admin = await makeAdmin("nodefault-set")
		const [conn] = await testDb.select().from(schema.connections)

		await connectionsSetDefault.handler(
			fakeSocket(admin.id),
			{ capability: "text->text", id: conn.id },
			noopEmit as any
		)

		expect((await defaultFor("text->text"))?.connectionId).toBe(conn.id)
		// An Ollama row can serve more than chat, and nothing here guessed which
		// capabilities to claim on its behalf. `capability` is a required
		// parameter for exactly this reason: the derivation most likely to be
		// written is "the first one it can do", which is how an image-capable
		// connection becomes the chat default.
		expect(
			(await defaultFor("text->image"))?.connectionId ?? null
		).toBeNull()
	})

	test("it refuses a connection that cannot do the capability", async () => {
		// The other half of the deleted auto-star: it wrote `text->text` for a
		// row regardless of what the row could do. Registering an incapable
		// connection is a write that succeeds, shows a star on screen, and then
		// fails every Send with a sentence about adapters — so it is refused at
		// the door, by the same reader the picker and the bind guard use.
		const { connectionsSetDefault } = await import("./connections")
		const admin = await makeAdmin("nodefault-refuse")
		const [drawOnly] = await testDb
			.insert(schema.connections)
			.values({
				name: "Draws Only",
				type: "ollama",
				// An explicit override is an ANSWER and outranks every probe, so
				// this is a row that definitively cannot chat — rather than one
				// that merely has not been tested, which the guard treats as
				// undetermined and lets through.
				capabilities: { overrides: { "text->text": false } }
			})
			.returning()

		await expect(
			connectionsSetDefault.handler(
				fakeSocket(admin.id),
				{ capability: "text->text", id: drawOnly.id },
				noopEmit as any
			)
		).rejects.toThrow(/cannot do/i)

		// And the registration is untouched — a refused write must not clear the
		// working default on its way out.
		const [first] = await testDb
			.select()
			.from(schema.connections)
			.where(eq(schema.connections.name, "First ever"))
		expect((await defaultFor("text->text"))?.connectionId).toBe(first.id)
	})

	test("a null id clears that capability and leaves the others alone", async () => {
		const { connectionsSetDefault } = await import("./connections")
		const admin = await makeAdmin("nodefault-clear")
		const [conn] = await testDb.select().from(schema.connections)
		// A separate row for the image half, because the guard is real: an
		// `ollama` row cannot be registered for `text->image`, which is the
		// previous test's point. An explicit `native` override is an ANSWER and
		// outranks both the probe and the manifest intersection.
		const [drawer] = await testDb
			.insert(schema.connections)
			.values({
				name: "Draws",
				type: "ollama",
				capabilities: { overrides: { "text->image": 1 } }
			})
			.returning()
		await connectionsSetDefault.handler(
			fakeSocket(admin.id),
			{ capability: "text->image", id: drawer.id },
			noopEmit as any
		)

		await connectionsSetDefault.handler(
			fakeSocket(admin.id),
			{ capability: "text->text", id: null },
			noopEmit as any
		)

		expect(
			(await defaultFor("text->text"))?.connectionId ?? null
		).toBeNull()
		expect((await defaultFor("text->image"))?.connectionId).toBe(drawer.id)
	})
})

describe("deleting a connection releases what it held", () => {
	test("the FK cascade clears every capability, not just the one this handler knows", async () => {
		// `connections:delete` used to read `system_settings.default_connection_id`
		// and un-star it by hand, which only ever knew about `text->text`: an
		// image connection holding `text->image` was deleted with its
		// registration left pointing at a row that no longer existed, and the
		// failure surfaced at render time as a dangling id.
		//
		// `connection_defaults.connection_id` is ON DELETE SET NULL, so the
		// database does it — for capabilities this handler has never heard of.
		const { connectionsDelete, connectionsSetDefault } = await import(
			"./connections"
		)
		const admin = await makeAdmin("nodefault-delete")
		// One row that genuinely serves both, which is the case the whole
		// capability model exists for: a KoboldCPP writes replies and draws
		// pictures from one process. Overrides rather than a probe, so the row
		// is definitively capable of both without a backend to ask.
		const [victim] = await testDb
			.insert(schema.connections)
			.values({
				name: "Holds two",
				type: "ollama",
				capabilities: {
					overrides: {
						"text->text": 1,
						"text->image": 1
					}
				}
			})
			.returning()

		for (const capability of ["text->text", "text->image"])
			await connectionsSetDefault.handler(
				fakeSocket(admin.id),
				{ capability, id: victim.id },
				noopEmit as any
			)
		expect((await defaultFor("text->text"))?.connectionId).toBe(victim.id)
		expect((await defaultFor("text->image"))?.connectionId).toBe(victim.id)

		await connectionsDelete.handler(
			fakeSocket(admin.id),
			{ id: victim.id },
			noopEmit as any
		)

		// Cleared, not stranded, and not silently repointed at some other row
		// that happens to exist — which is what an auto-fallback on delete would
		// have done, and is the same mistake in a different costume.
		expect(
			(await defaultFor("text->text"))?.connectionId ?? null
		).toBeNull()
		expect(
			(await defaultFor("text->image"))?.connectionId ?? null
		).toBeNull()
	})
})
