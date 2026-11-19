/**
 * `rowNaming` builds the narrator name only where the own voice needs it
 * (`ownVoiceName`): a Lair (fallback envoy: the Castellan) never builds it, a
 * Story (no fallback envoy) does. Real shipped genres, real DB.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { ownVoiceName } from "$lib/shared/sessions/ownVoiceName"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "row-naming-test-secret" }
})

// Lets one test hand `rowNaming` a declared fallback envoy with an empty name.
let declaredOverride: unknown[] | null = null
vi.mock("$lib/server/pipelines/entities/envoys", async (importOriginal) => {
	const real =
		await importOriginal<
			typeof import("$lib/server/pipelines/entities/envoys")
		>()
	return {
		...real,
		sessionDeclaredEnvoys: async (
			...a: Parameters<typeof real.sessionDeclaredEnvoys>
		) => declaredOverride ?? real.sessionDeclaredEnvoys(...a)
	}
})

let testDb: TestDb
let dataDir: string
let n = 0

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-row-naming-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(testDb as any)
})

afterAll(async () => {
	await releaseDataDir(dataDir)
})

async function session(genreId: string): Promise<number> {
	const schema = await import("$lib/server/db/schema")
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const owner = await createTestUser(testDb, `row-naming-${++n}`)
	const [lorebook] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: owner.id, name: "Book" })
		.returning()
	const [row] = await testDb
		.insert(schema.sessions)
		.values({
			userId: owner.id,
			isGroup: true,
			name: "Session",
			genreId,
			lorebookId: lorebook!.id,
			genreFields: {}
		})
		.returning()
	return row!.id
}

/** Statements issued while `fn` runs. */
async function counting<T>(fn: () => Promise<T>) {
	const c = (
		testDb as unknown as {
			$client: { query: (...a: unknown[]) => unknown }
		}
	).$client
	const original = c.query
	let statements = 0
	c.query = (...args: unknown[]) => {
		statements++
		return original.apply(c, args)
	}
	try {
		return { value: await fn(), statements }
	} finally {
		c.query = original
	}
}

/** The old rule, computed directly. */
async function oldOwnVoice(sid: number) {
	const { sessionDeclaredEnvoys } = await import(
		"$lib/server/pipelines/entities/envoys"
	)
	const { narratorNameFor } = await import(
		"$lib/server/pipelines/runtime/host"
	)
	return ownVoiceName({
		envoys: await sessionDeclaredEnvoys(testDb as any, sid),
		narratorName: await narratorNameFor(testDb as any, sid, undefined)
	})
}

describe("rowNaming own voice", () => {
	test("Lair: the fallback envoy names it, and no narrator world is built", async () => {
		const { rowNaming } = await import("./turnYield")
		const sid = await session("core:genre/lair")
		const expected = await oldOwnVoice(sid)
		const { value, statements } = await counting(() =>
			rowNaming(testDb as any, sid)
		)
		expect(value.ownVoice).toBe(expected)
		expect(statements).toBeLessThan(20)
	})

	test("Story: no fallback envoy, so the narrator name is consulted", async () => {
		const { rowNaming } = await import("./turnYield")
		const { narratorNameFor } = await import(
			"$lib/server/pipelines/runtime/host"
		)
		const sid = await session("core:genre/story")
		const expected = await oldOwnVoice(sid)
		const { value, statements } = await counting(() =>
			rowNaming(testDb as any, sid)
		)
		expect(value.ownVoice).toBe(expected)
		const narrator = await narratorNameFor(testDb as any, sid, undefined)
		expect(narrator).toBeTruthy()
		expect(value.ownVoice).toBe(narrator!.trim())
		// The shipped narrator name is the unclaimed line's own word, so the value
		// cannot tell; the world build (many statements) can.
		expect(statements).toBeGreaterThanOrEqual(20)
	})

	test("an empty-named fallback envoy falls through to the narrator name", async () => {
		const { rowNaming } = await import("./turnYield")
		const sid = await session("core:genre/story")
		const expected = await oldOwnVoice(sid)
		declaredOverride = [{ slug: "x", name: { en: "  " }, fallback: true }]
		try {
			expect((await rowNaming(testDb as any, sid)).ownVoice).toBe(
				expected
			)
		} finally {
			declaredOverride = null
		}
	})
})
