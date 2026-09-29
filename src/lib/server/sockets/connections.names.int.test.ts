/**
 * Connection names are unique instance-wide, case-insensitively.
 *
 * Every picker shows a connection by name alone, so two rows reading the
 * same are unorderable by the person choosing. The sidebar pre-checks, but
 * the wizard and the document-view page create too — so the refusal lives in
 * the handlers, and the client prefill (service label) is a suggestion, not
 * a guarantee.
 */

import { beforeAll, describe, expect, test, vi } from "vitest"
import * as schema from "$lib/server/db/schema"

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "test-crypto-secret-key" }
})

beforeAll(async () => {
	const dbModule = await import("$lib/server/db")
	const db: any = dbModule.db
	await db
		.insert(schema.systemSettings)
		.values({ id: 1 })
		.onConflictDoNothing()
}, 120_000)

const admin = () =>
	({
		user: { id: 1, isAdmin: true },
		io: { to: () => ({ emit: () => {} }) },
		server: { to: () => ({ emit: () => {} }) }
	}) as any
const noop = () => {}
const emitted: [string, any][] = []
const collectingEmit = (event: string, data: any) => {
	emitted.push([event, data])
}

/**
 * A distinct host per fixture. One Ollama connection per host (owner ruling
 * 2026-09-25) means a second create at `localhost:11434` is refused for its
 * HOST — which would mask the name refusal these tests exist to check. The
 * name check runs first in `connections:create`, so a deliberate duplicate
 * name is still refused by name.
 */
let fixtureHost = 0

async function createConnection(name: string) {
	const { connectionsCreate } = await import("./connections")
	emitted.length = 0
	try {
		const res = await connectionsCreate.handler(
			admin(),
			{
				connection: {
					name,
					type: "ollama",
					baseUrl: `http://ollama-fixture-${++fixtureHost}.test:11434`
				} as any
			},
			collectingEmit as any
		)
		return { res }
	} catch (e: any) {
		return { error: e?.message ?? String(e) }
	}
}

describe("connections:create enforces unique names", () => {
	test("a second connection with the same name is refused", async () => {
		const first = await createConnection(`Unique ${Math.random()}`)
		expect((first as any).res?.connection?.id).toBeGreaterThan(0)

		const name = (first as any).res.connection.name as string
		const second = await createConnection(name.toUpperCase())
		expect((second as any).res).toBeUndefined()
		expect((second as any).error).toMatch(/already exists/)
		expect(
			emitted.some(
				([event]) => event === "connections:create:error"
			)
		).toBe(true)
	}, 60_000)

	test("a blank name is refused", async () => {
		const result = await createConnection("   ")
		expect((result as any).res).toBeUndefined()
		expect((result as any).error).toMatch(/required/)
	}, 60_000)
})

describe("connections:update enforces unique names on rename", () => {
	test("renaming onto a taken name is refused; keeping your own is fine", async () => {
		const { connectionsUpdate } = await import("./connections")
		const tag = Math.random()
		const a = await createConnection(`Alpha ${tag}`)
		const b = await createConnection(`Beta ${tag}`)
		const aId = (a as any).res.connection.id as number
		const bId = (b as any).res.connection.id as number

		emitted.length = 0
		let renameError: string | undefined
		try {
			await connectionsUpdate.handler(
				admin(),
				{ connection: { id: bId, name: `alpha ${tag}` } as any },
				collectingEmit as any
			)
		} catch (e: any) {
			renameError = e?.message ?? String(e)
		}
		expect(renameError).toMatch(/already exists/)
		expect(
			emitted.some(([event]) => event === "connections:update:error")
		).toBe(true)

		// Keeping your own name (even re-cased) is not a collision.
		const kept = await connectionsUpdate.handler(
			admin(),
			{ connection: { id: aId, name: `ALPHA ${tag} ` } as any },
			noop as any
		)
		expect(kept.connection.name).toBe(`ALPHA ${tag}`)
	}, 60_000)
})
