/**
 * The actions push reads the session's functions once per build, not once
 * per list: `buildSessionActions` computes them and hands them to both
 * `listSessionActions` and `formCollectsOf`. The payload is the old road's.
 *
 * No shipped genre declares a form-venue action that `collects`, so the real
 * `formCollects` is empty here; a synthetic offered function stands in for
 * the non-empty half.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "actions-once-test-secret" }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-actions-once-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(testDb as any)
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

/** Statements the test database ran while `fn` ran. */
async function counting<T>(fn: () => Promise<T>) {
	const client = (testDb as any).$client
	const orig = client.query
	let n = 0
	client.query = function (...a: any[]) {
		n++
		return orig.apply(this, a)
	}
	try {
		return { value: await fn(), statements: n }
	} finally {
		client.query = orig
	}
}

let n = 0

async function lairSession() {
	const tag = ++n
	const schema = await import("$lib/server/db/schema")
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const owner = await createTestUser(testDb, `actions-once-owner-${tag}`)
	const guest = await createTestUser(testDb, `actions-once-guest-${tag}`)
	const [lorebook] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: owner.id, name: "The lair" })
		.returning()
	const [session] = await testDb
		.insert(schema.sessions)
		.values({
			userId: owner.id,
			isGroup: true,
			name: "Session",
			genreId: "core:genre/lair",
			lorebookId: lorebook!.id,
			genreFields: {}
		})
		.returning()
	await testDb
		.insert(schema.sessionGuests)
		.values({ sessionId: session!.id, userId: guest.id })
	return { owner, guest, sessionId: session!.id }
}

describe("buildSessionActions reads the functions once", () => {
	test("the payload equals the old road's, for the owner and a guest", async () => {
		const { buildSessionActions } = await import("./sessions.pipelines")
		const { listSessionActions, formCollectsOf } = await import(
			"$lib/server/pipelines/entities/sessionActions"
		)
		const { listSessionFunctions } = await import(
			"$lib/server/pipelines/entities/sessionGenres"
		)
		const w = await lairSession()
		for (const userId of [w.owner.id, w.guest.id]) {
			const built = JSON.parse(
				JSON.stringify(
					await buildSessionActions(w.sessionId, userId, "main", {
						member: true,
						withRewind: true
					})
				)
			)
			const venues = await listSessionActions(
				testDb as any,
				w.sessionId,
				{ userId },
				{ channel: "main" }
			)
			const forms = await formCollectsOf(testDb as any, w.sessionId, {
				userId
			})
			expect(built.venues).toEqual(JSON.parse(JSON.stringify(venues)))
			expect(built.formCollects ?? {}).toEqual(forms)

			const offered = await listSessionFunctions(
				testDb as any,
				w.sessionId,
				"core:genre/lair",
				userId
			)
			expect(
				await formCollectsOf(testDb as any, w.sessionId, { userId }, { offered })
			).toEqual(forms)
		}
	})

	test("a handed-in function list stands in for the read and is filtered to enabled", async () => {
		const { formCollectsOf } = await import(
			"$lib/server/pipelines/entities/sessionActions"
		)
		const { listSessionFunctions } = await import(
			"$lib/server/pipelines/entities/sessionGenres"
		)
		const w = await lairSession()
		const real = await listSessionFunctions(
			testDb as any,
			w.sessionId,
			"core:genre/lair",
			w.owner.id
		)
		const base = real.find((f) => f.enabled)!
		const formAction = {
			...base,
			venues: [{ kind: "form" }],
			collects: { text: { need: "optional", label: { en: "Say" } } }
		} as any
		const offered = [
			formAction,
			{ ...formAction, specSlug: "off", key: "off", enabled: false }
		]
		const out = await formCollectsOf(
			testDb as any,
			w.sessionId,
			{ userId: w.owner.id },
			{ offered }
		)
		expect(Object.values(out).map((f) => f.name)).toEqual([base.name])
	})

	test("one build reads the functions once: the saving is one function read", async () => {
		const { buildSessionActions } = await import("./sessions.pipelines")
		const { listSessionActions, formCollectsOf } = await import(
			"$lib/server/pipelines/entities/sessionActions"
		)
		const { listSessionFunctions } = await import(
			"$lib/server/pipelines/entities/sessionGenres"
		)
		const w = await lairSession()
		const userId = w.owner.id
		// Warm any module-level caches so the counts compare like with like.
		await buildSessionActions(w.sessionId, userId, "main", { member: true })
		const oneRead = (
			await counting(() =>
				listSessionFunctions(testDb as any, w.sessionId, "core:genre/lair", userId)
			)
		).statements
		expect(oneRead).toBeGreaterThan(20)
		// The old road: both lists read the functions themselves.
		const old = await counting(async () => {
			await listSessionActions(testDb as any, w.sessionId, { userId }, { channel: "main" })
			await formCollectsOf(testDb as any, w.sessionId, { userId })
		})
		const built = await counting(() =>
			buildSessionActions(w.sessionId, userId, "main", { member: true })
		)
		// What a build reads besides the two lists: the turn-delete state.
		const { turnDeleteRefusedThrough } = await import(
			"$lib/server/messages/verbs"
		)
		const extras = (
			await counting(() =>
				turnDeleteRefusedThrough(testDb as any, w.sessionId, userId)
			)
		).statements
		// Both lists read the functions on the old road; the build reads them
		// once (plus its one genre-row read), so it runs one function read under.
		expect(
			Math.abs(built.statements - (old.statements - oneRead + extras))
		).toBeLessThanOrEqual(3)
	})
})
