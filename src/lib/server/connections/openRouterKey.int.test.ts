/**
 * `recordOpenRouterKey` against a real row: the bag lands under
 * `extra_json.openrouter` beside every other key, a failed look keeps the
 * old fact, and a row with no key loses it. `fetch` is injected: no network.
 */
import { beforeAll, describe, expect, test, vi } from "vitest"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"

let db: TestDb

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "test-crypto-secret-key" }
})

beforeAll(async () => {
	db = (await import("$lib/server/db")).db as unknown as TestDb
}, 120_000)

async function row(
	extraJson: Record<string, unknown>,
	over: Record<string, unknown> = {}
) {
	const [c] = await db
		.insert(schema.connections)
		.values({
			name: `or ${Math.random()}`,
			type: CONNECTION_TYPE.OPENAI,
			preset: "openrouter",
			baseUrl: "https://openrouter.ai/api/v1",
			modality: "text-gen",
			extraJson,
			...over
		} as any)
		.returning()
	return c
}
const extraOf = async (id: number) =>
	(
		await db
			.select()
			.from(schema.connections)
			.where(eq(schema.connections.id, id))
	)[0].extraJson as Record<string, any>
const ok = (free: boolean) =>
	vi.fn(
		async () =>
			new Response(JSON.stringify({ data: { is_free_tier: free } }), {
				status: 200
			})
	)

describe("recordOpenRouterKey", () => {
	test(
		"writes the bag and keeps the other keys",
		{ timeout: 60000 },
		async () => {
			const { recordOpenRouterKey } = await import("./openRouterKey")
			const { encryptApiKeyField } = await import(
				"$lib/server/utils/tokenCrypto"
			)
			const c = await row({
				apiKey: encryptApiKeyField("sk-or-1"),
				keep: 1
			})
			const facts = await recordOpenRouterKey(db as any, c, {
				fetch: ok(true) as any
			})
			expect(facts?.freeTier).toBe(true)
			const extra = await extraOf(c.id)
			expect(extra.openrouter.freeTier).toBe(true)
			expect(extra.keep).toBe(1)
			expect(extra.apiKey.__enc).toBe(true)
		}
	)
	test("a non-OpenRouter row is untouched", { timeout: 60000 }, async () => {
		const { recordOpenRouterKey } = await import("./openRouterKey")
		const f = ok(true)
		const c = await row(
			{ apiKey: "k" },
			{ preset: "openai", baseUrl: "https://api.openai.com/v1" }
		)
		expect(
			await recordOpenRouterKey(db as any, c, { fetch: f as any })
		).toBeNull()
		expect(f).not.toHaveBeenCalled()
		expect((await extraOf(c.id)).openrouter).toBeUndefined()
	})
	test("a failed read keeps the old bag", { timeout: 60000 }, async () => {
		const { recordOpenRouterKey } = await import("./openRouterKey")
		const old = { freeTier: true, checkedAt: "2026-01-01T00:00:00.000Z" }
		const c = await row({ apiKey: "k", openrouter: old })
		const f = vi.fn(async () => new Response("", { status: 500 }))
		expect(
			await recordOpenRouterKey(db as any, c, { fetch: f as any })
		).toBeNull()
		expect((await extraOf(c.id)).openrouter).toEqual(old)
	})
	test("no key removes the bag", { timeout: 60000 }, async () => {
		const { recordOpenRouterKey } = await import("./openRouterKey")
		const c = await row({
			openrouter: { freeTier: true, checkedAt: "x" },
			keep: 2
		})
		const f = ok(true)
		expect(
			await recordOpenRouterKey(db as any, c, { fetch: f as any })
		).toBeNull()
		expect(f).not.toHaveBeenCalled()
		const extra = await extraOf(c.id)
		expect(extra.openrouter).toBeUndefined()
		expect(extra.keep).toBe(2)
	})
})
