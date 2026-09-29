/**
 * `sessionPresets:list` carries each preset's **effective included actions**
 * — its included set with the companion rule applied where the set states
 * nothing (`includedActions: null`, which is every shipped preset).
 *
 * The Pipelines view's Edit level lists a preset's actions from this field,
 * so it must answer exactly as a session on the preset does
 * (`listSessionFunctions`, through the shared `includedByPreset`): the
 * companion rule for a null set, the stated identities alone otherwise.
 *
 * Seeded by the real boot (`bootstrapPipelines`) so the shipped Chat and Lair
 * presets and their actions are the ones an install has.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

let db: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "preset-actions-test-secret" }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-preset-actions-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	db = dbModule.db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(db)
}, 180_000)

afterAll(async () => {
	if (dataDir) await fs.rm(dataDir, { recursive: true, force: true })
})

const socket = (isAdmin: boolean) =>
	({ user: { id: 1, isAdmin }, io: { to: () => ({ emit: () => {} }) } }) as any
const noopEmit = () => {}

async function listPresets(isAdmin = true) {
	const { sessionPresetsList } = await import("./sessionAdmin")
	return (await sessionPresetsList.handler(socket(isAdmin), {}, noopEmit)).presets
}

const keysOf = (p: Sockets.SessionAdmin.PresetRow) =>
	(p.effectiveIncludedActions ?? []).map((a) => a.key).sort()

describe("sessionPresets:list — effective included actions", () => {
	test("the shipped Chat preset (included set null) carries narrate by the companion rule", async () => {
		const chat = (await listPresets()).find(
			(p) => p.genreId === "core:genre/chat" && p.isImmutable && p.isDefault
		)!
		expect(chat).toBeDefined()
		expect(chat.includedActions).toBeNull()
		expect(keysOf(chat)).toContain("narrate")
		const narrate = chat.effectiveIncludedActions!.find((a) => a.key === "narrate")!
		expect(narrate.identity).toBe(`${narrate.specSlug}#narrate`)
		expect(narrate.name).toBeTruthy()
	}, 60_000)

	test("the shipped Lair preset (included set null) carries its companion actions", async () => {
		const lair = (await listPresets()).find(
			(p) => p.genreId === "core:genre/lair" && p.isImmutable
		)!
		expect(lair).toBeDefined()
		expect(lair.includedActions).toBeNull()
		expect(keysOf(lair)).toEqual(
			expect.arrayContaining(["build-room", "whisper", "nudge", "trap", "reveal"])
		)
	}, 60_000)

	test("the picker's cut carries it too", async () => {
		const chat = (await listPresets(false)).find(
			(p) => p.genreId === "core:genre/chat" && p.isDefault
		)!
		expect(keysOf(chat)).toContain("narrate")
	}, 60_000)

	test("an explicit included set carries exactly those actions, and [] none", async () => {
		const shipped = (await listPresets()).find(
			(p) => p.genreId === "core:genre/lair" && p.isImmutable
		)!
		const nudge = shipped.effectiveIncludedActions!.find((a) => a.key === "nudge")!

		const [only] = await db
			.insert(schema.sessionPresets)
			.values({
				name: "Nudge only",
				genreId: "core:genre/lair",
				includedActions: [nudge.identity]
			})
			.returning()
		const [none] = await db
			.insert(schema.sessionPresets)
			.values({ name: "No actions", genreId: "core:genre/lair", includedActions: [] })
			.returning()

		const presets = await listPresets()
		expect(
			presets.find((p) => p.id === only.id)!.effectiveIncludedActions!.map(
				(a) => a.identity
			)
		).toEqual([nudge.identity])
		expect(presets.find((p) => p.id === none.id)!.effectiveIncludedActions).toEqual([])

		await db.delete(schema.sessionPresets).where(eq(schema.sessionPresets.id, only.id))
		await db.delete(schema.sessionPresets).where(eq(schema.sessionPresets.id, none.id))
	}, 60_000)
})
