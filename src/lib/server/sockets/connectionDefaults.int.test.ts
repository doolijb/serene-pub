/**
 * Admin → Defaults, over a real database.
 *
 * Everything asserted here fails SILENTLY if it regresses. A picker that
 * FILTERS instead of disabling looks correct — it just leaves "why isn't mine
 * in the list" unanswerable. A `set` that accepts a mis-ordered capability id
 * writes a `connection_defaults` row that is a valid primary key and matches
 * nothing, forever. Neither throws, and neither shows up on a screen.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { byCapability } from "$lib/server/connections/capabilityDefaults"
import * as schema from "$lib/server/db/schema"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string

// Same stub as the sibling socket int tests: these modules transitively import
// $lib/server/auth, which needs getCryptoSecretKey() at import time.
vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "test-crypto-secret-key" }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-connection-defaults-int-test-")
	)
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
	// `connectionDefaults:set` pushes systemSettings:get, which throws on an
	// instance with no settings row. A test DB is migrated, not seeded.
	await testDb
		.insert(schema.systemSettings)
		.values({ id: 1 })
		.onConflictDoNothing()
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

const socketFor = (userId: number, isAdmin = true) =>
	({
		user: { id: userId, isAdmin },
		server: { to: () => ({ emit: () => {} }) }
	}) as any

const noopEmit = () => {}

/** A connection whose capabilities are already resolved, as create leaves them. */
async function makeConnection(
	name: string,
	type: string,
	resolved: Record<string, unknown>
) {
	const [conn] = await testDb
		.insert(schema.connections)
		.values({ name, type, capabilities: { resolved } })
		.returning()
	return conn
}

describe("connectionDefaults:list", () => {
	test("the combo list is aggregated, not a hardcoded array", async () => {
		const { connectionDefaultsList } = await import("./connectionDefaults")
		const admin = await makeAdmin("conn-defaults-list-user")

		const res = await connectionDefaultsList.handler(
			socketFor(admin.id),
			{},
			noopEmit
		)

		const ids = res.combos.map((c) => c.id)
		// Servable and demanded by nothing — only the manifest half puts these
		// on the list.
		expect(ids).toContain("text->text")
		expect(ids).toContain("text+image->text")
		// Every id is a transform. A slot may require `json_schema`; nobody
		// points a connection at it.
		expect(ids.every((id) => id.includes("->"))).toBe(true)
	})

	test("an incapable connection is DISABLED with a reason, never filtered out", async () => {
		// The whole rule of the picker. A connection merely absent from the
		// list makes "why isn't mine there" a question with no answer on the
		// screen that raised it.
		const { connectionDefaultsList } = await import("./connectionDefaults")
		const admin = await makeAdmin("conn-defaults-disabled-user")
		const image = await makeConnection(
			"Draws only",
			CONNECTION_TYPE.A1111,
			{ "text->image": 1 }
		)

		const res = await connectionDefaultsList.handler(
			socketFor(admin.id),
			{},
			noopEmit
		)

		const row = res.connectionOptions["text->text"].find(
			(o) => o.id === image.id
		)
		expect(
			row,
			"the row was filtered out instead of disabled"
		).toBeDefined()
		expect(row!.eligible).toBe(false)
		// A person's words, never a raw capability id.
		expect(row!.reason).toContain("Chat")
		expect(row!.reason).not.toContain("text->text")

		// ...and it IS offered for what it can do.
		expect(
			res.connectionOptions["text->image"].find((o) => o.id === image.id)
				?.eligible
		).toBe(true)
	})

	test("an untested connection is eligible AND says so", async () => {
		// Undetermined, not incapable. Marking it unusable would empty the
		// picker on every install that upgraded into the capability model —
		// and the reason is what stops `eligible` reading as a promise.
		const { connectionDefaultsList } = await import("./connectionDefaults")
		const admin = await makeAdmin("conn-defaults-untested-user")
		const untested = await makeConnection(
			"Nobody has pressed Test",
			CONNECTION_TYPE.OPENAI_CHAT,
			{}
		)

		const res = await connectionDefaultsList.handler(
			socketFor(admin.id),
			{},
			noopEmit
		)
		const row = res.connectionOptions["text->text"].find(
			(o) => o.id === untested.id
		)!
		expect(row.eligible).toBe(true)
		expect(row.reason).toContain("Not tested yet")
	})

	test("a capability with no sampling vocabulary offers no sampling options", async () => {
		// `text->embedding` takes no parameters. An EMPTY list is the signal to
		// render no picker; an empty picker reads as "we lost your configs".
		const { connectionDefaultsList } = await import("./connectionDefaults")
		const admin = await makeAdmin("conn-defaults-sampling-user")
		await testDb
			.insert(schema.samplingConfigs)
			.values({ name: "Defaults int text config" })
			.onConflictDoNothing()

		const res = await connectionDefaultsList.handler(
			socketFor(admin.id),
			{},
			noopEmit
		)
		expect(res.samplingOptions["text->text"].length).toBeGreaterThan(0)
		if (res.combos.some((c) => c.id === "text->embedding"))
			expect(res.samplingOptions["text->embedding"]).toEqual([])
	})

	test("a non-admin is refused", async () => {
		const { connectionDefaultsList } = await import("./connectionDefaults")
		const [user] = await testDb
			.insert(schema.users)
			.values({ username: "conn-defaults-nonadmin", isAdmin: false })
			.returning()
		await expect(
			connectionDefaultsList.handler(
				socketFor(user.id, false),
				{},
				noopEmit
			)
		).rejects.toThrow(/admin/i)
	})
})

describe("connectionDefaults:set", () => {
	test("it writes one half and leaves the other alone", async () => {
		const { connectionDefaultsSet } = await import("./connectionDefaults")
		const admin = await makeAdmin("conn-defaults-set-user")
		const conn = await makeConnection(
			"Set-half chat",
			CONNECTION_TYPE.OPENAI_CHAT,
			{ "text->text": 1 }
		)
		const [sampling] = await testDb
			.insert(schema.samplingConfigs)
			.values({ name: "Set-half sampling" })
			.returning()

		await connectionDefaultsSet.handler(
			socketFor(admin.id),
			{ capability: "text->text", half: "connection", id: conn.id },
			noopEmit
		)
		await connectionDefaultsSet.handler(
			socketFor(admin.id),
			{
				capability: "text->text",
				half: "sampling",
				id: sampling.id
			},
			noopEmit
		)

		const [row] = await testDb
			.select()
			.from(schema.connectionDefaults)
			.where(byCapability("text->text"))
		expect(row.connectionId).toBe(conn.id)
		expect(row.samplingConfigId).toBe(sampling.id)

		// Clearing the sampling half means "let the backend use its own
		// defaults" — a real answer, and it must not disturb the connection.
		const res = await connectionDefaultsSet.handler(
			socketFor(admin.id),
			{ capability: "text->text", half: "sampling", id: null },
			noopEmit
		)
		expect(res.defaults["text->text"]).toEqual({
			connectionId: conn.id,
			samplingConfigId: null
		})
	})

	test("a connection that cannot do it is refused, not registered", async () => {
		// The picker greys the row; `disabled` is markup. This is the same
		// judgement on the WRITE side, by the same reader — otherwise a stale
		// tab (or anything that isn't the screen) registers an image-only
		// endpoint for chat, gets a check mark, and fails every Send with a
		// sentence about adapters.
		const { connectionDefaultsSet } = await import("./connectionDefaults")
		const admin = await makeAdmin("conn-defaults-refusal-user")
		const image = await makeConnection(
			"Refusal draws only",
			CONNECTION_TYPE.A1111,
			{ "text->image": 1 }
		)

		await expect(
			connectionDefaultsSet.handler(
				socketFor(admin.id),
				{
					capability: "text->text",
					half: "connection",
					id: image.id
				},
				noopEmit
			)
		).rejects.toThrow(/Chat/)

		const [row] = await testDb
			.select()
			.from(schema.connectionDefaults)
			.where(byCapability("text->text"))
		expect(row?.connectionId).not.toBe(image.id)
	})

	test("a mis-ordered capability id is refused rather than stored", async () => {
		// `IO_KINDS` orders image before audio and text before image, so
		// `image+text->text` is the same words in the wrong order, and no build
		// names that combination.
		//
		// ⚠ REPOINTED for 0183, and the reason it was worth keeping changed with
		// it. Against the old single `capability` key a mis-ordered id was a
		// valid PRIMARY KEY that matched nothing `transformId()` ever emits, and
		// it would sit in the table unreachable forever. `sidesOf` now
		// canonicalises before storing, so accepting one would produce a
		// perfectly reachable VISION default instead — the wrong capability
		// registered rather than an orphan. That is a different failure and a
		// worse one on screen, so the refusal is asserted against the canonical
		// pair the write would have landed on.
		const { connectionDefaultsSet } = await import("./connectionDefaults")
		const admin = await makeAdmin("conn-defaults-misordered-user")

		await expect(
			connectionDefaultsSet.handler(
				socketFor(admin.id),
				{
					capability: "image+text->text",
					half: "connection",
					id: null
				},
				noopEmit
			)
		).rejects.toThrow(/not a capability/i)

		const rows = await testDb
			.select()
			.from(schema.connectionDefaults)
			.where(byCapability("image+text->text"))
		expect(rows).toEqual([])
	})

	test("a non-admin is refused", async () => {
		const { connectionDefaultsSet } = await import("./connectionDefaults")
		const [user] = await testDb
			.insert(schema.users)
			.values({
				username: "conn-defaults-set-nonadmin",
				isAdmin: false
			})
			.returning()
		await expect(
			connectionDefaultsSet.handler(
				socketFor(user.id, false),
				{ capability: "text->text", half: "connection", id: null },
				noopEmit
			)
		).rejects.toThrow(/admin/i)
	})
})
