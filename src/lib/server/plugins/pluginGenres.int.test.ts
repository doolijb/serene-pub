/**
 * A plugin genre's stats exist while the plugin is INSTALLED (owner ruling
 * 2026-09-26, resolving R67): disabling only hides the genre from listings —
 * a session already on it keeps resolving and writing its stats — and only
 * uninstalling withdraws the declarations.
 *
 * The live walk this pins: the Twenty Questions plugin's `count` and `record`
 * steps (`core:task/set-state@1`) were refused — "'showcase.twenty-questions:
 * slot/questions-asked@1' is not a slot this pub declares" — because the
 * app never registered a manifest's `genres[].slots`; and `getGenre()` knowing
 * nothing of the genre made `vocabularyFor` fall back to EVERY core slot, so
 * the session showed case, gold, floor and hp.
 *
 * The manifest below is the plugin's own built `genres` entry
 * (`serene-pub-plugin-twenty-questions/dist/plugin/manifest.json`), trimmed to
 * what these assertions read.
 */

import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { getAttributeSlot, getGenre, attributeSlots } from "@serene-pub/sdk"
import "@serene-pub/core-catalog"
import type { TestDb } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-plugin-genres-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	// Listings treat every plugin as off while the subsystem is off.
	process.env.SP_PLUGINS_ENABLED = "1"
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	delete process.env.SP_PLUGINS_ENABLED
	await fs.rm(dataDir, { recursive: true, force: true })
})

const PLUGIN = "showcase.twenty-questions"
const GENRE = `${PLUGIN}:genre/twenty-questions`
const ASKED = `${PLUGIN}:slot/questions-asked@1`
const RESULT = `${PLUGIN}:slot/game-result@1`

const manifest = {
	slug: PLUGIN,
	name: "Twenty Questions",
	genres: [
		{
			id: GENRE,
			name: { en: "Twenty Questions" },
			family: "game",
			shape: {
				characters: { min: 1, max: 1 },
				personas: { min: 0, max: 1 },
				lorebook: "required",
				writes: { lore: false, scenes: false }
			},
			events: {
				"core:event/message-respond@1": { required: true },
				"core:event/session-created@1": { required: true }
			},
			slots: [
				{
					type: "integer",
					label: { en: "Questions asked" },
					descriptor: "How many of the player's 20 questions have been used.",
					appliesTo: ["world"],
					config: { min: 0, max: 20 },
					default: 0,
					id: ASKED,
					origin: "code"
				},
				{
					type: "enum",
					label: { en: "Result" },
					descriptor:
						"Whether this game is still being played, was guessed, or ran out of questions.",
					appliesTo: ["world"],
					config: { of: ["playing", "guessed", "out-of-questions"] },
					default: "playing",
					id: RESULT,
					origin: "code"
				}
			]
		}
	]
}

let n = 0

async function install(enabled: boolean) {
	await testDb
		.insert(schema.plugins)
		.values({
			pluginId: PLUGIN,
			name: "Twenty Questions",
			version: "0.1.0",
			bundleSource: "",
			bundleHash: "x",
			backends: ["quickjs"],
			backend: "quickjs",
			enabled,
			manifest
		})
		.onConflictDoUpdate({
			target: schema.plugins.pluginId,
			set: { enabled, manifest }
		})
}

async function setEnabled(enabled: boolean) {
	await testDb
		.update(schema.plugins)
		.set({ enabled })
		.where(eq(schema.plugins.pluginId, PLUGIN))
	const { syncPluginGenres } = await import("./pluginGenres")
	return syncPluginGenres(testDb as unknown as Db)
}

async function uninstall() {
	await testDb.delete(schema.plugins).where(eq(schema.plugins.pluginId, PLUGIN))
	const { syncPluginGenres } = await import("./pluginGenres")
	return syncPluginGenres(testDb as unknown as Db)
}

/** The plugin's create spec, so the genre is a row the Start listing reads. */
async function publishCreateSpec() {
	const [plugin] = await testDb
		.select({ id: schema.plugins.id })
		.from(schema.plugins)
		.where(eq(schema.plugins.pluginId, PLUGIN))
	const slug = `${PLUGIN}:spec/create`
	await testDb.delete(schema.pipelineSpecs).where(eq(schema.pipelineSpecs.slug, slug))
	const [spec] = await testDb
		.insert(schema.pipelineSpecs)
		.values({ slug, name: "Create", sourcePluginId: plugin.id })
		.returning()
	const [version] = await testDb
		.insert(schema.pipelineSpecVersions)
		.values({
			specId: spec.id,
			semver: "0.1.0",
			status: "published",
			canonicalHash: `tq-${spec.id}`,
			genre: manifest.genres[0],
			inputGenre: GENRE,
			inputEvent: "core:event/session-created@1"
		} as any)
		.returning()
	await testDb
		.update(schema.pipelineSpecs)
		.set({ activeVersionId: version.id })
		.where(eq(schema.pipelineSpecs.id, spec.id))
}

/** What the session's attribute picker offers to add (`state:attributes`). */
async function addable(sessionId: number, userId: number): Promise<string[]> {
	const { stateAttributes } = await import("$lib/server/sockets/state")
	const res: any = await stateAttributes.handler(
		{ user: { id: userId } } as any,
		{ sessionId } as any,
		() => {}
	)
	return res.addable.map((r: { slotId: string }) => r.slotId)
}

async function session(genreId: string) {
	const suffix = `${++n}`
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `plugin-genres-${suffix}`)
	const [row] = await testDb
		.insert(schema.sessions)
		.values({ userId: user.id, isGroup: false, name: `Game ${suffix}`, genreId })
		.returning()
	// The world's changes anchor to the newest message (R9).
	const [legacy] = await testDb
		.insert(schema.sessionMessages)
		.values({ sessionId: row.id, role: "assistant", content: "…" })
		.returning()
	await testDb
		.insert(schema.messages)
		.values({ id: legacy.id, sessionId: row.id, role: "assistant" })
	return row
}

const setState = async () => {
	const { stateBindings } = await import(
		"$lib/server/pipelines/runtime/bindings.state"
	)
	return stateBindings({ runId: "tq" })["core:task/set-state@1"]!
}

/** What the plugin's `tally` step hands `count`, and `check` hands `record`. */
const worldChange = (sessionId: number, slotId: string, value: unknown) => ({
	owner: { kind: "session", id: sessionId },
	slotId,
	value
})

describe("plugin genres (stored manifest → registries)", () => {
	test("an installed plugin's genre and slots are registered, enabled or not", async () => {
		await install(false)
		expect(await setEnabled(false)).toEqual([])
		expect(getGenre(GENRE)?.family).toBe("game")
		expect(getAttributeSlot(ASKED)?.type).toBe("integer")
		expect(getAttributeSlot(RESULT)?.type).toBe("enum")
		// Core's own are untouched by a plugin's sync.
		expect(getAttributeSlot("core:slot/hp@1")).toBeDefined()
	}, 60_000)

	test("re-enabling is a no-op for the registry", async () => {
		await install(false)
		await setEnabled(false)
		const genre = getGenre(GENRE)
		const slot = getAttributeSlot(ASKED)
		expect(await setEnabled(true)).toEqual([])
		// The very same declarations: nothing was withdrawn and re-declared.
		expect(getGenre(GENRE)).toBe(genre)
		expect(getAttributeSlot(ASKED)).toBe(slot)
		expect(await setEnabled(false)).toEqual([])
		expect(getGenre(GENRE)).toBe(genre)
		expect(getAttributeSlot(ASKED)).toBe(slot)
	}, 60_000)

	test("uninstalling withdraws the genre and its slots", async () => {
		await install(true)
		await setEnabled(true)
		expect(getGenre(GENRE)).toBeDefined()
		await uninstall()
		expect(getGenre(GENRE)).toBeUndefined()
		expect(getAttributeSlot(ASKED)).toBeUndefined()
		expect(getAttributeSlot(RESULT)).toBeUndefined()
		expect(getAttributeSlot("core:slot/hp@1")).toBeDefined()
	}, 60_000)

	test("disabling hides the genre from the Start listing and the attribute picker", async () => {
		await install(true)
		await setEnabled(true)
		await publishCreateSpec()
		const { listOfferedGenres, listSessionGenres } = await import(
			"$lib/server/pipelines/entities/sessionGenres"
		)
		expect((await listOfferedGenres(testDb as unknown as Db)).some((g) => g.genreId === GENRE)).toBe(true)
		// Adventure lets a session add attributes beyond its own.
		const s = await session("core:genre/adventure")
		expect((await addable(s.id, s.userId)).includes(ASKED)).toBe(true)

		await setEnabled(false)
		expect((await listOfferedGenres(testDb as unknown as Db)).some((g) => g.genreId === GENRE)).toBe(false)
		// Resolution still knows it — sessions already on it keep running.
		expect((await listSessionGenres(testDb as unknown as Db)).some((g) => g.genreId === GENRE)).toBe(true)
		expect((await addable(s.id, s.userId)).includes(ASKED)).toBe(false)
		expect((await addable(s.id, s.userId)).includes(RESULT)).toBe(false)
	}, 60_000)

	test("a re-sync is idempotent (an identical redeclare is not a refusal)", async () => {
		await install(true)
		expect(await setEnabled(true)).toEqual([])
		expect(await setEnabled(true)).toEqual([])
		expect(getAttributeSlot(ASKED)).toBeDefined()
	}, 60_000)

	test("the session's vocabulary is the genre's two slots — not every core slot", async () => {
		await install(true)
		await setEnabled(true)
		const s = await session(GENRE)
		const { vocabularyFor } = await import("$lib/server/state/resolve")
		const v = await vocabularyFor(testDb as unknown as Db, s.id)
		expect(v.entries.map((e) => e.decl.id).sort()).toEqual([RESULT, ASKED].sort())
	}, 60_000)

	test("the count/record path writes its slots, still writes after disable, and is refused after uninstall", async () => {
		await install(true)
		await setEnabled(true)
		const s = await session(GENRE)
		const node = await setState()

		// `count` (respond): questions-asked, applied.
		const counted: any = await node(
			{
				scope: { sessionId: s.id },
				changes: [worldChange(s.id, ASKED, 1)],
				params: { mode: "apply" }
			},
			{} as any
		)
		expect(counted.value.refused ?? []).toEqual([])
		expect(counted.value.applied).toHaveLength(1)

		// `record` (judge guess): game-result, applied.
		const recorded: any = await node(
			{
				scope: { sessionId: s.id },
				changes: [worldChange(s.id, RESULT, "guessed")],
				params: { mode: "apply" }
			},
			{} as any
		)
		expect(recorded.value.refused ?? []).toEqual([])
		expect(recorded.value.applied).toHaveLength(1)

		const { valueOf } = await import("$lib/server/state/resolve")
		expect(
			await valueOf(testDb as unknown as Db, {
				sessionId: s.id,
				owner: { kind: "session", id: s.id },
				slotId: ASKED
			})
		).toBe(1)

		// Disabled: the running session keeps resolving and writing its stats.
		await setEnabled(false)
		const v = await (await import("$lib/server/state/resolve")).vocabularyFor(testDb as unknown as Db, s.id)
		expect(v.entries.map((e) => e.decl.id).sort()).toEqual([RESULT, ASKED].sort())
		const still: any = await node(
			{
				scope: { sessionId: s.id },
				changes: [worldChange(s.id, ASKED, 2)],
				params: { mode: "apply" }
			},
			{} as any
		)
		expect(still.value.refused ?? []).toEqual([])
		expect(still.value.applied).toHaveLength(1)

		// Uninstalled: the declarations are gone and a write is refused.
		await uninstall()
		const refused: any = await node(
			{
				scope: { sessionId: s.id },
				changes: [worldChange(s.id, ASKED, 3)],
				params: { mode: "apply" }
			},
			{} as any
		)
		expect(refused.value.applied).toHaveLength(0)
		expect(refused.value.refused?.[0]).toMatch(/not a slot this pub declares/)
	}, 60_000)

	test("a genre this process does not hold has an empty vocabulary (fail closed)", async () => {
		// Core's slots ARE declared in this process — the old fallback put
		// every one of them on the session.
		expect(attributeSlots().some((d) => d.id.startsWith("core:"))).toBe(true)
		const s = await session("nobody.here:genre/missing")
		const { vocabularyFor } = await import("$lib/server/state/resolve")
		const v = await vocabularyFor(testDb as unknown as Db, s.id)
		expect(v.entries).toEqual([])
		expect(v.slots).toEqual([])
	}, 60_000)
})
