/**
 * One Ollama connection per host (owner ruling 2026-09-25).
 *
 * A single Ollama connection now serves every modality its host has, so a second
 * one to the same host is a duplicate. `connections:create` refuses it, and
 * `connections:update` refuses moving a row INTO a taken host.
 *
 * ⚠ The case this file exists to pin is the one that is easy to break by
 * "tightening" the guard: installs that had both an Ollama and an
 * Ollama-embeddings connection to one host were left with two Ollama rows to it
 * by the rename that merged the types. An edit that leaves the host alone — a
 * rename — must still go through, or the guard locks somebody out of the very
 * duplicates they need to tidy up.
 */
import { beforeAll, describe, expect, test, vi } from "vitest"
import * as schema from "$lib/server/db/schema"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "test-crypto-secret-key" }
})

let db: any

beforeAll(async () => {
	db = (await import("$lib/server/db")).db
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

async function create(connection: Record<string, unknown>) {
	const { connectionsCreate } = await import("./connections")
	try {
		const res = await connectionsCreate.handler(
			admin(),
			{ connection: { name: `c ${Math.random()}`, ...connection } as any },
			() => {}
		)
		return { row: res.connection, error: null as string | null }
	} catch (e: any) {
		return { row: null, error: String(e?.message ?? e) }
	}
}

async function update(connection: Record<string, unknown>) {
	const { connectionsUpdate } = await import("./connections")
	try {
		await connectionsUpdate.handler(
			admin(),
			{ connection: connection as any },
			() => {}
		)
		return null
	} catch (e: any) {
		return String(e?.message ?? e)
	}
}

describe("one Ollama connection per host", () => {
	test("a second Ollama to the same host is refused, naming the one that has it", async () => {
		const host = "http://host-a.test:11434"
		const first = await create({ name: "Home Ollama", type: CONNECTION_TYPE.OLLAMA, baseUrl: host })
		expect(first.error).toBeNull()

		// A trailing slash is the same host — the rule forgives it.
		const second = await create({ type: CONNECTION_TYPE.OLLAMA, baseUrl: `${host}/` })
		expect(second.row).toBeNull()
		expect(second.error).toMatch(/"Home Ollama" already connects to the Ollama/)
	})

	test("a different host is fine", async () => {
		await create({ type: CONNECTION_TYPE.OLLAMA, baseUrl: "http://host-b.test:11434" })
		const other = await create({ type: CONNECTION_TYPE.OLLAMA, baseUrl: "http://host-c.test:11434" })
		expect(other.error).toBeNull()
	})

	test("another type at Ollama's address is a different service, and allowed", async () => {
		const host = "http://host-d.test:11434"
		await create({ type: CONNECTION_TYPE.OLLAMA, baseUrl: host })
		const compat = await create({ type: CONNECTION_TYPE.OPENAI, baseUrl: host })
		expect(compat.error).toBeNull()
	})

	test("moving an existing row INTO a taken host is refused", async () => {
		await create({ type: CONNECTION_TYPE.OLLAMA, baseUrl: "http://host-e.test:11434" })
		const mover = await create({ type: CONNECTION_TYPE.OLLAMA, baseUrl: "http://host-f.test:11434" })
		const error = await update({ id: mover.row!.id, baseUrl: "http://host-e.test:11434" })
		expect(error).toMatch(/already connects to the Ollama/)
	})

	test("an EXISTING duplicate can still be renamed — the guard never locks you out of it", async () => {
		// Two rows to one host, exactly as the 2026-09-25 rename leaves them —
		// written straight to the table, because the handler would (rightly)
		// refuse to create the second.
		const host = "http://host-g.test:11434"
		const [a] = await db
			.insert(schema.connections)
			.values({ name: "Ollama", type: CONNECTION_TYPE.OLLAMA, baseUrl: host, extraJson: {}, capabilities: {} })
			.returning()
		await db
			.insert(schema.connections)
			.values({ name: "Ollama embeddings (old)", type: CONNECTION_TYPE.OLLAMA, baseUrl: host, extraJson: {}, capabilities: {} })
			.returning()

		// A rename sends the host back unchanged (forms send the whole row).
		expect(await update({ id: a.id, name: "Ollama at home", baseUrl: host })).toBeNull()
		// And a rename that says nothing about the host at all.
		expect(await update({ id: a.id, name: "Ollama at home, again" })).toBeNull()
	})
})
