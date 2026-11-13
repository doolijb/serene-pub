/**
 * 🚧 The round worth, through the REAL chain — no mock (owner, 2026-11-11;
 * lane sense-clk2): `core:query/round-worth@1` read with the host's own
 * `read("session_settings")`, over sessions of the shipped genres:
 *
 *  · a fresh Story session and a fresh Lair session are worth 5 minutes;
 *  · a session that stores `roundWorth: 0` is worth 0;
 *  · a Guide session is worth 0 (the genre has not opted in).
 *
 * ⚠ This file goes green only once the lead places `ROUND_WORTH_FIELD`
 * (`core-catalog/src/shared/roundTick.ts`) in Story's and the Lair's `fields`
 * (`core-catalog/src/registry/genres.ts`, queued Q-1). Until then every
 * session's round worth reads 0 and the two "5 minutes" cases fail — that is
 * the missing field, not a fault here.
 *
 * It calls the binding with a context whose `read` is the host's.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 })

let db: TestDb
let dataDir: string
let ownerId: number
let n = 0

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, dbReady: Promise.resolve() }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-round-worth-genres-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(db)
	const { createTestUser } = await import("$lib/server/utils/testDb")
	ownerId = (await createTestUser(db, "round-worth-owner")).id
}, 180_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {})
})

/** A session of `genreId` with its own book; `genreFields` as a person stored them. */
async function session(genreId: string, genreFields?: Record<string, unknown>) {
	const [book] = await db
		.insert(schema.lorebooks)
		.values({ userId: ownerId, name: `Worth book ${++n}` })
		.returning()
	const [s] = await db
		.insert(schema.sessions)
		.values({
			userId: ownerId,
			isGroup: false,
			lorebookId: book!.id,
			genreId,
			...(genreFields ? { genreFields } : {})
		} as any)
		.returning()
	return s!.id
}

/** The round worth the query publishes, run with the host's own `read`. */
async function worthOf(sessionId: number) {
	const { createHost } = await import("$lib/server/pipelines/runtime/host")
	const { roundWorthBindings } = await import(
		"$lib/server/pipelines/runtime/roundWorth"
	)
	const host = await createHost(
		db as never,
		{
			sessionId,
			userId: ownerId,
			specId: "core:spec/round-tick",
			runId: `run-round-worth-${sessionId}`
		} as any
	)
	const node = { key: "worth", definitionId: "core:query/round-worth@1" }
	const hook = roundWorthBindings()["core:query/round-worth@1"] as any
	const res = await hook(
		{ scope: { sessionId } },
		{
			read: (table: string, query?: unknown) =>
				host.read!(table as any, query, node as any)
		}
	)
	expect(res.kind, JSON.stringify(res)).toBe("ok")
	return res.value as { minutes: number; step: { by: number; unit: string } }
}

describe("the round worth, from the shipped genres", () => {
	it("a fresh Story session is worth 5 minutes", async () => {
		expect(await worthOf(await session("core:genre/story"))).toEqual({
			main: { minutes: 5, step: { by: 5, unit: "minutes" } },
			minutes: 5,
			step: { by: 5, unit: "minutes" }
		})
	})

	it("a fresh Lair session is worth 5 minutes", async () => {
		expect((await worthOf(await session("core:genre/lair"))).minutes).toBe(
			5
		)
	})

	it("a session that stores roundWorth 0 is worth 0", async () => {
		for (const genre of ["core:genre/story", "core:genre/lair"]) {
			const w = await worthOf(await session(genre, { roundWorth: 0 }))
			expect(w.minutes, genre).toBe(0)
			expect(w.step, genre).toEqual({ by: 0, unit: "minutes" })
		}
	})

	it("a Guide session is worth 0: the genre has not opted in", async () => {
		expect((await worthOf(await session("core:genre/guide"))).minutes).toBe(
			0
		)
	})
})
