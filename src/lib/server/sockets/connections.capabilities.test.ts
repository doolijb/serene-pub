/**
 * `connections:capabilities` and `connections:setCapability` — the toggle
 * handlers `connectionsUpdate`'s server-ownership comment has been waiting for.
 *
 * PGlite-backed (the `.int.test.ts` sweep's shape; named for the pair it covers
 * rather than for the harness). Everything asserted here fails SILENTLY if it
 * regresses: an override written as `false` where it should have been deleted
 * looks identical on screen and quietly blinds the row to its own backend
 * forever; a probe eaten by a toggle looks like a connection that was never
 * tested; a `resolved` cache left stale reads correctly on the panel and wrongly
 * everywhere the pipeline binds.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
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
		path.join(os.tmpdir(), "serene-pub-connections-capabilities-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
	await testDb.insert(schema.systemSettings).values({ id: 1 })
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

function socketFor(isAdmin: boolean) {
	return {
		user: { id: 1, isAdmin },
		server: { to: () => ({ emit: () => {} }) }
	} as any
}

/** Records what the handler broadcast, so a stray emit is visible. */
function recorder() {
	const events: { event: string; data: any }[] = []
	return {
		events,
		emit: (event: string, data: any) => events.push({ event, data })
	}
}

async function makeConnection(values: {
	name: string
	type: string
	preset?: string | null
	capabilities?: Record<string, unknown>
}) {
	const [row] = await testDb
		.insert(schema.connections)
		.values({
			name: values.name,
			type: values.type,
			preset: values.preset ?? null,
			capabilities: values.capabilities ?? {}
		})
		.returning()
	return row
}

const columnOf = async (id: number) => {
	const row = await testDb.query.connections.findFirst({
		where: (c: any, { eq }: any) => eq(c.id, id)
	})
	return (row?.capabilities ?? {}) as {
		resolved?: Record<string, string>
		overrides?: Record<string, unknown>
		probe?: { found?: Record<string, string>; at?: string }
	}
}

describe("connections:setCapability — the three states", () => {
	test("Auto DELETES the key rather than writing `false`", async () => {
		const { connectionsSetCapability } = await import("./connections")
		const conn = await makeConnection({
			name: "auto-clears",
			type: CONNECTION_TYPE.KOBOLDCPP,
			capabilities: { overrides: { "text->image": false } }
		})

		const res = await connectionsSetCapability.handler(
			socketFor(true),
			{ id: conn.id, capability: "text->image", value: null },
			() => {}
		)

		// The whole point: `false` and an absent key look identical on screen and
		// mean opposite things. Writing `false` here would outrank every probe
		// that ever runs against this connection again.
		const stored = await columnOf(conn.id)
		expect(stored.overrides).toEqual({})
		expect("text->image" in (stored.overrides ?? {})).toBe(false)
		expect(res.capabilities?.overrides).toEqual({})
	})

	test("clearing the LAST override sticks, rather than springing back on reload", async () => {
		// persistCapabilities reads `next.overrides ?? current.overrides`, so a
		// handler that passed `undefined` for "no overrides left" would keep the
		// stored ones and the toggle would silently undo itself.
		const { connectionsSetCapability, connectionsCapabilities } =
			await import("./connections")
		const conn = await makeConnection({
			name: "last-override",
			type: CONNECTION_TYPE.KOBOLDCPP,
			capabilities: { overrides: { tools: false } }
		})

		await connectionsSetCapability.handler(
			socketFor(true),
			{ id: conn.id, capability: "tools", value: null },
			() => {}
		)
		const reread = await connectionsCapabilities.handler(
			socketFor(true),
			{ id: conn.id },
			() => {}
		)

		expect(reread.capabilities?.overrides).toEqual({})
	})

	test("`false` is stored as an explicit off and drops the capability from the cache", async () => {
		const { connectionsSetCapability } = await import("./connections")
		const conn = await makeConnection({
			name: "explicit-off",
			type: CONNECTION_TYPE.KOBOLDCPP,
			capabilities: {
				resolved: { "text->text": "native", "text->image": "native" },
				probe: {
					found: { "text->image": "native" },
					at: "2026-08-30T00:00:00.000Z"
				}
			}
		})

		const res = await connectionsSetCapability.handler(
			socketFor(true),
			{ id: conn.id, capability: "text->image", value: false },
			() => {}
		)

		expect(res.capabilities?.overrides).toEqual({ "text->image": false })
		// The cache is REBUILT, not patched — a stale `resolved` reads fine on
		// the panel and wrongly everywhere a pipeline binds against it.
		expect(res.capabilities?.resolved?.["text->image"]).toBeUndefined()
		expect(res.capabilities?.resolved?.["text->text"]).toBe("native")
	})

	test("a tier switches it on over a probe that said otherwise", async () => {
		const { connectionsSetCapability } = await import("./connections")
		const conn = await makeConnection({
			name: "override-beats-probe",
			type: CONNECTION_TYPE.KOBOLDCPP,
			capabilities: {
				resolved: { "text->text": "native" },
				probe: {
					found: { "text->image": "none" },
					at: "2026-08-30T00:00:00.000Z"
				}
			}
		})

		const res = await connectionsSetCapability.handler(
			socketFor(true),
			{ id: conn.id, capability: "text->image", value: "native" },
			() => {}
		)

		expect(res.capabilities?.overrides).toEqual({ "text->image": "native" })
		expect(res.capabilities?.resolved?.["text->image"]).toBe("native")
	})
})

describe("connections:setCapability — what it must not touch", () => {
	test("the stored probe survives a toggle, timestamp and all", async () => {
		// A person's toggle knows nothing about what the backend answered, so it
		// passes no probe. If it wrote one, the panel would report "never tested"
		// on a connection that was tested a minute ago.
		const { connectionsSetCapability } = await import("./connections")
		const probe = {
			found: { "text->image": "native", "text->text": "native" },
			at: "2026-08-28T09:00:00.000Z"
		}
		const conn = await makeConnection({
			name: "probe-survives",
			type: CONNECTION_TYPE.KOBOLDCPP,
			capabilities: { resolved: { "text->text": "native" }, probe }
		})

		await connectionsSetCapability.handler(
			socketFor(true),
			{ id: conn.id, capability: "tools", value: false },
			() => {}
		)

		expect((await columnOf(conn.id)).probe).toEqual(probe)
	})

	test("it broadcasts its own event only — never connections:get", async () => {
		// connectionsGet's broadcast carries a whole connection, and
		// ConnectionsSidebar's handler replaces `connection` AND
		// `originalConnection` from it — silently discarding the in-progress
		// name/URL/model edits of the very form this panel sits inside.
		const { connectionsSetCapability } = await import("./connections")
		const conn = await makeConnection({
			name: "no-get-broadcast",
			type: CONNECTION_TYPE.KOBOLDCPP
		})
		const rec = recorder()

		await connectionsSetCapability.handler(
			socketFor(true),
			{ id: conn.id, capability: "text->image", value: "native" },
			rec.emit
		)

		expect(rec.events.map((e) => e.event)).toEqual([
			"connections:setCapability"
		])
	})
})

describe("connections:setCapability — the gate", () => {
	test("a capability the adapter never declared is refused and nothing is written", async () => {
		// Resolution already ignores an undeclared key, so this changes nothing
		// today — but an override is DURABLE, and the key space moves when the
		// type does. Junk stored here would resurrect as a setting nobody made.
		const { connectionsSetCapability } = await import("./connections")
		const conn = await makeConnection({
			name: "managed-text",
			type: CONNECTION_TYPE.KOBOLDCPP_MANAGED
		})
		const rec = recorder()

		const res = await connectionsSetCapability.handler(
			socketFor(true),
			{ id: conn.id, capability: "text->image", value: "native" },
			rec.emit
		)

		expect(res.error).toBeTruthy()
		// Named, not addressed — `text->image` is not a sentence.
		expect(res.error).toContain("Image generation")
		expect(rec.events.map((e) => e.event)).toEqual([
			"connections:setCapability:error"
		])
		expect((await columnOf(conn.id)).overrides).toBeUndefined()
	})

	test("a value outside the three states is refused rather than stored", async () => {
		const { connectionsSetCapability } = await import("./connections")
		const conn = await makeConnection({
			name: "junk-value",
			type: CONNECTION_TYPE.KOBOLDCPP
		})

		const res = await connectionsSetCapability.handler(
			socketFor(true),
			{
				id: conn.id,
				capability: "text->image",
				value: "probed" as any
			},
			() => {}
		)

		expect(res.error).toBeTruthy()
		expect((await columnOf(conn.id)).overrides).toBeUndefined()
	})

	test("a non-admin is refused", async () => {
		const { connectionsSetCapability } = await import("./connections")
		const conn = await makeConnection({
			name: "non-admin",
			type: CONNECTION_TYPE.KOBOLDCPP
		})

		const res = await connectionsSetCapability.handler(
			socketFor(false),
			{ id: conn.id, capability: "text->image", value: "native" },
			() => {}
		)

		expect(res.error).toMatch(/Access denied/)
		expect((await columnOf(conn.id)).overrides).toBeUndefined()
	})

	test("a missing connection answers with an error naming the id it failed for", async () => {
		const { connectionsSetCapability } = await import("./connections")
		const res = await connectionsSetCapability.handler(
			socketFor(true),
			{ id: 987_654, capability: "text->text", value: false },
			() => {}
		)
		expect(res.connectionId).toBe(987_654)
		expect(res.error).toBeTruthy()
	})
})

describe("connections:capabilities — the read", () => {
	test("it answers with the saved type, preset and column", async () => {
		const { connectionsCapabilities } = await import("./connections")
		const conn = await makeConnection({
			name: "read-me",
			type: CONNECTION_TYPE.OPENAI_CHAT,
			preset: "openai-official",
			capabilities: {
				resolved: { "text->text": "native" },
				overrides: { "text->image": false }
			}
		})
		const rec = recorder()

		const res = await connectionsCapabilities.handler(
			socketFor(true),
			{ id: conn.id },
			rec.emit
		)

		expect(res).toMatchObject({
			connectionId: conn.id,
			type: CONNECTION_TYPE.OPENAI_CHAT,
			preset: "openai-official"
		})
		expect(res.capabilities?.overrides).toEqual({ "text->image": false })
		expect(rec.events.map((e) => e.event)).toEqual([
			"connections:capabilities"
		])
	})

	test("the write's response equals what a subsequent read returns", async () => {
		// persistCapabilities returns what it WROTE for exactly this reason: its
		// `determined` fallback can keep a cache the caller did not hand it, and
		// a response built from the caller's own input would put the panel one
		// toggle behind the row.
		const { connectionsSetCapability, connectionsCapabilities } =
			await import("./connections")
		const conn = await makeConnection({
			name: "write-read-parity",
			type: CONNECTION_TYPE.KOBOLDCPP,
			capabilities: {
				probe: {
					found: { "text->image": "native" },
					at: "2026-08-29T00:00:00.000Z"
				}
			}
		})

		const written = await connectionsSetCapability.handler(
			socketFor(true),
			{ id: conn.id, capability: "text->image", value: false },
			() => {}
		)
		const read = await connectionsCapabilities.handler(
			socketFor(true),
			{ id: conn.id },
			() => {}
		)

		expect(written.capabilities).toEqual(read.capabilities)
	})

	test("a non-admin is refused the read", async () => {
		const { connectionsCapabilities } = await import("./connections")
		const conn = await makeConnection({
			name: "read-denied",
			type: CONNECTION_TYPE.KOBOLDCPP
		})
		const rec = recorder()

		const res = await connectionsCapabilities.handler(
			socketFor(false),
			{ id: conn.id },
			rec.emit
		)

		expect(res.error).toMatch(/Access denied/)
		expect(res.capabilities).toBeUndefined()
		expect(rec.events.map((e) => e.event)).toEqual([
			"connections:capabilities:error"
		])
	})
})

/**
 * The switch working on a connection whose adapter declares ONE capability.
 *
 * Every test above uses KOBOLDCPP, which declares nine — so its resolved set is
 * never empty and it can never reach `persistCapabilities`'s empty-rebuild
 * guard. An image connection can and does: KOBOLDCPP_MANAGED_IMAGE declares
 * exactly `text->image`, and A1111 has only `text->image` among its defaults, so
 * switching Image generation off resolves to `{}`.
 *
 * That guard exists for a different case — a type NO manifest entry declares
 * (`openai-embeddings`, `local-onnx`), whose stored cache must survive an
 * unrelated edit. Keyed on emptiness alone it also swallowed this, writing the
 * pre-toggle cache back: the override stored correctly, the cache everything
 * reads disagreed, and the connection kept being offered in every image picker
 * while the panel claimed something else supplied it.
 */
describe("connections:setCapability — a type that declares only one thing", () => {
	for (const type of [
		CONNECTION_TYPE.KOBOLDCPP_MANAGED_IMAGE,
		CONNECTION_TYPE.A1111
	])
		test(`Off empties the resolved cache on ${type}, it does not spring back`, async () => {
			const { connectionsSetCapability } = await import("./connections")
			const conn = await makeConnection({
				name: `single-cap-${type}`,
				type,
				capabilities: { resolved: { "text->image": "native" } }
			})

			await connectionsSetCapability.handler(
				socketFor(true),
				{ id: conn.id, capability: "text->image", value: false },
				() => {}
			)

			const stored = await columnOf(conn.id)
			// The durable half was never the problem.
			expect(stored.overrides).toEqual({ "text->image": false })
			// The cache is what `satisfies()` reads, and it has to agree.
			expect(stored.resolved ?? {}).toEqual({})
		})

	test("a type the manifest does not declare still keeps its cache", async () => {
		// The case the guard was written for, which must not regress: 0175
		// determined this from the old modality column and nothing can rebuild it.
		const { connectionsCapabilities } = await import("./connections")
		const conn = await makeConnection({
			name: "undeclared-type",
			type: "openai-embeddings",
			capabilities: { resolved: { "text->embedding": "native" } }
		})

		await connectionsCapabilities.handler(
			socketFor(true),
			{ id: conn.id },
			() => {}
		)

		const stored = await columnOf(conn.id)
		expect(stored.resolved).toEqual({ "text->embedding": "native" })
	})
})
