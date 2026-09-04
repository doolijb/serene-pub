/**
 * What happens to a person's existing configuration on the boot after upgrading.
 *
 * The migration's job is that nothing changes. Everything they tuned appears in
 * the new panel, selected where they had it selected, worded exactly as they
 * wrote it — and the things they *never* touched stay untouched, so an admin
 * moving a default later still reaches them.
 *
 * That last one is the property with teeth, and it is invisible on the day the
 * migration runs. Copying every field would look identical in every screenshot
 * and would silently pin every user to the 0.6 defaults for good. It is the same
 * distinction `clearOption` makes by deleting a row rather than writing the
 * inherited value into it.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import type { TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"

let db: TestDb
let dataDir: string
let userId: number
let sessionId: number
let mineId: number
let narratorMineId: number
let sceneMineId: number

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "migrate-legacy-test-secret" }
})

const MY_SYSTEM = "You are MY character, and you speak only in questions."
const MY_POST = "Remember: only questions."

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-migrate-legacy-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir

	const dbModule = await import("$lib/server/db")
	db = dbModule.db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()

	const [user] = await db
		.insert(schema.users)
		.values({ username: "migrating-user", isAdmin: false })
		.returning()
	userId = user.id

	// The situation this exists for: a person with their own prompt config,
	// their own numeric tuning, and it selected on a session.
	const [mine] = await db
		.insert(schema.promptConfigs)
		.values({
			name: "My Questions-Only Config",
			systemPrompt: MY_SYSTEM,
			postHistoryInstructions: MY_POST,
			postHistoryDepth: 3,
			postHistoryTokenTrigger: 500
		})
		.returning()
	mineId = mine.id

	const [narratorMine] = await db
		.insert(schema.narratorPromptConfigs)
		.values({
			name: "My Narrator",
			systemPrompt: "Describe the room, never the people.",
			narratorName: "The Room"
		})
		.returning()
	narratorMineId = narratorMine.id

	// A BUNDLED legacy config, which is what the split exists for: one row
	// carrying four texts that belong to four different node types. Under the
	// old model they migrated as a single prompt every step pointed at; under
	// the pool they must become one row per step, or three of the four steps
	// refuse the configuration the migration just wrote for them.
	const [sceneMine] = await db
		.insert(schema.sceneSummarizeConfigs)
		.values({
			name: "My Scene Summarizer",
			batchSystemPrompt: "Draft it my way.",
			synthSystemPrompt: "Weave it my way.",
			nameSystemPrompt: "Title it my way.",
			characterExtractionSystemPrompt: "List the cast my way."
		})
		.returning()
	sceneMineId = sceneMine.id

	const [session] = await db
		.insert(schema.sessions)
		.values({ userId, isGroup: false, promptConfigId: mine.id })
		.returning()
	sessionId = session.id

	await db
		.insert(schema.userSettings)
		.values({ userId, activePromptConfigId: mine.id })
		.onConflictDoUpdate({
			target: schema.userSettings.userId,
			set: { activePromptConfigId: mine.id }
		})

	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(db as any)
}, 180_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const specIdOf = async (slug: string) => {
	const [row] = await db
		.select()
		.from(schema.pipelineSpecs)
		.where(eq(schema.pipelineSpecs.slug, slug))
	return row.id as number
}

describe("a user's own config comes across", () => {
	it("becomes a config in the right namespace, editable because it is theirs", async () => {
		const [config] = await db
			.select()
			.from(schema.pipelineConfigs)
			.where(
				eq(
					schema.pipelineConfigs.seedKey,
					`migrated:core:spec/respond:${mineId}`
				)
			)
		expect(config).toBeTruthy()
		expect(config.name).toBe("My Questions-Only Config")
		// Theirs, so editable — unlike the prompts core ships.
		expect(config.isImmutable).toBe(false)
		expect(config.specId).toBe(await specIdOf("core:spec/respond"))
	})

	it("keeps their wording exactly", async () => {
		// Found by `created_for_spec_id` rather than by ownership: a migrated
		// prompt lands in the POOL its step reads from, and that pool is shared
		// with every other pipeline reusing the step. Which pipeline it was
		// written in is now a grouping fact, which is exactly what this asserts.
		const specId = await specIdOf("core:spec/respond")
		const prompts = await db
			.select()
			.from(schema.pipelinePrompts)
			.where(eq(schema.pipelinePrompts.createdForSpecId, specId))
		const mine: any = prompts.find(
			(p: any) => p.name === "My Questions-Only Config"
		)
		expect(mine).toBeTruthy()
		expect(mine.isImmutable).toBe(false)
		expect(mine.fields.systemPrompt).toBe(MY_SYSTEM)
		expect(mine.fields.postHistoryInstructions).toBe(MY_POST)
	})

	/**
	 * The split, which is what "no data migration" does **not** exempt.
	 *
	 * A legacy summarize config is a bundle: `batch`, `synth` and `name` belong
	 * to three different node types and only ever travelled together because
	 * the spec was the namespace. Copied whole into one pool, the other two
	 * steps would refuse the row — the panel would show a migrated
	 * configuration and then decline to let its own steps use it.
	 */
	it("splits a bundled legacy config into one prompt per pool", async () => {
		const specId = await specIdOf("core:spec/summarize-scene")
		const [spec] = await db
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.id, specId))
		const { declarations } = await import(
			"$lib/server/pipelines/config/panel"
		)
		const decls = (
			await declarations(db as any, spec.activeVersionId!)
		).filter((d: any) => d.control === "prompts-ref")
		const pools = new Set(
			decls.map((d: any) => `${d.nodeTypeId}#${d.slot}`)
		)
		expect(
			pools.size,
			"the scene summarizer no longer reads from several pools"
		).toBeGreaterThan(1)

		const [config] = await db
			.select()
			.from(schema.pipelineConfigs)
			.where(
				eq(
					schema.pipelineConfigs.seedKey,
					`migrated:core:spec/summarize-scene:${sceneMineId}`
				)
			)
		expect(config, "the scene config was not migrated").toBeTruthy()

		const values = (
			await db
				.select()
				.from(schema.pipelineConfigValues)
				.where(eq(schema.pipelineConfigValues.configId, config.id))
		).filter((v: any) => v.slot === "prompts")

		const seen = new Set<number>()
		for (const d of decls) {
			const v: any = values.find(
				(row: any) => row.nodeKey === d.nodeKey && row.slot === d.slot
			)
			expect(
				v,
				`${d.nodeKey}.${d.slot} got no prompt from the migration`
			).toBeTruthy()
			const [row] = await db
				.select()
				.from(schema.pipelinePrompts)
				.where(eq(schema.pipelinePrompts.id, v.value))
			// In the step's own pool, carrying that step's fields and nothing
			// belonging to another one.
			expect(`${row.nodeTypeId}#${row.slot}`).toBe(
				`${(d as any).nodeTypeId}#${d.slot}`
			)
			expect(Object.keys(row.fields as any).sort()).toEqual(
				[...((d as any).promptFields ?? [])].sort()
			)
			seen.add(row.id)
		}
		// Several rows, not one bundle pointed at from four places.
		expect(seen.size).toBe(pools.size)
	})

	it("re-uses one row where two pipelines migrate the same legacy config", async () => {
		// Scene and history summarization read the same legacy table into pools
		// they share. Two rows would be a duplicate the pool's unique name index
		// refuses — a raw constraint error in the middle of boot — so the second
		// pass must find the first pass's row.
		const sceneId = await specIdOf("core:spec/summarize-scene")
		const historyId = await specIdOf("core:spec/summarize-history")
		const valuesOf = async (specId: number, seedKey: string) => {
			const [config] = await db
				.select()
				.from(schema.pipelineConfigs)
				.where(eq(schema.pipelineConfigs.seedKey, seedKey))
			if (!config) return new Map<string, number>()
			expect(config.specId).toBe(specId)
			const rows = await db
				.select()
				.from(schema.pipelineConfigValues)
				.where(eq(schema.pipelineConfigValues.configId, config.id))
			return new Map<string, number>(
				(rows as any[])
					.filter((r) => r.slot === "prompts")
					.map((r) => [r.nodeKey, r.value])
			)
		}
		const scene = await valuesOf(
			sceneId,
			`migrated:core:spec/summarize-scene:${sceneMineId}`
		)
		const history = await valuesOf(
			historyId,
			`migrated:core:spec/summarize-history:${sceneMineId}`
		)
		let shared = 0
		for (const [nodeKey, id] of history)
			if (scene.has(nodeKey)) {
				expect(scene.get(nodeKey)).toBe(id)
				shared++
			}
		expect(shared, "the two summarizers migrated no shared step").toBeGreaterThan(0)
	})

	it("puts the narrator's own config in the narrator namespace, not the reply one", async () => {
		const narrateId = await specIdOf("core:spec/narrate")
		const [config] = await db
			.select()
			.from(schema.pipelineConfigs)
			.where(
				eq(
					schema.pipelineConfigs.seedKey,
					`migrated:core:spec/narrate:${narratorMineId}`
				)
			)
		expect(config.specId).toBe(narrateId)

		const prompts = await db
			.select()
			.from(schema.pipelinePrompts)
			.where(eq(schema.pipelinePrompts.createdForSpecId, narrateId))
		const mine: any = prompts.find((p: any) => p.name === "My Narrator")
		expect(mine.fields.narratorName).toBe("The Room")
	})
})

describe("selections follow", () => {
	it("selects it at the scopes that had it selected", async () => {
		// Without this the migration copies everything across and then shows the
		// user a default they did not choose, which is worse than not migrating.
		const specId = await specIdOf("core:spec/respond")
		const [config] = await db
			.select()
			.from(schema.pipelineConfigs)
			.where(
				eq(
					schema.pipelineConfigs.seedKey,
					`migrated:core:spec/respond:${mineId}`
				)
			)

		const selections = await db
			.select()
			.from(schema.pipelineConfigSelections)
			.where(eq(schema.pipelineConfigSelections.specId, specId))

		const at = (kind: string, id: number) =>
			selections.find(
				(s: any) => s.scopeKind === kind && s.scopeId === id
			)
		// The user layer no longer migrates (ruled 2026-08-24) — a person's
		// legacy pick has no global home, so only the session's selection lands.
		expect(at("user", userId)).toBeUndefined()
		expect(at("session", sessionId)?.configId).toBe(config.id)
	})
})

describe("the numbers stop travelling with the prompt", () => {
	it("migrates a touched param as an override at the scope that selected it", async () => {
		// `post_history_depth` was a column on `prompt_configs` — six unrelated
		// decisions in one row. It is a param now, so it lands as one.
		const specId = await specIdOf("core:spec/respond")
		const rows = await db
			.select()
			.from(schema.pipelineNodeOverrides)
			.where(
				and(
					eq(schema.pipelineNodeOverrides.specId, specId),
					eq(schema.pipelineNodeOverrides.slot, "params")
				)
			)

		const depth = rows.filter((r: any) => r.path === "postHistoryDepth")
		expect(depth.length).toBeGreaterThan(0)
		expect(depth[0].value).toBe(3)

		const trigger = rows.filter(
			(r: any) => r.path === "postHistoryTokenTrigger"
		)
		expect(trigger[0].value).toBe(500)
	})

	it("writes nothing for a field left at its default", async () => {
		// The property that keeps inheritance alive. A migrated value stops
		// tracking the default; an unwritten one does not, so an admin moving an
		// instance value later still reaches this user.
		const specId = await specIdOf("core:spec/respond")
		const [untouched] = await db
			.insert(schema.promptConfigs)
			.values({
				name: "Defaults Everywhere",
				systemPrompt: "plain",
				postHistoryDepth: 0,
				postHistoryTokenTrigger: 0
			})
			.returning()

		const [session] = await db
			.insert(schema.sessions)
			.values({ userId, isGroup: false, promptConfigId: untouched.id })
			.returning()

		const { migrateLegacyParams } = await import(
			"$lib/server/pipelines/migrate/migrateLegacy"
		)
		await migrateLegacyParams(db as any)

		const rows = await db
			.select()
			.from(schema.pipelineNodeOverrides)
			.where(
				and(
					eq(schema.pipelineNodeOverrides.specId, specId),
					eq(schema.pipelineNodeOverrides.scopeKind, "session"),
					eq(schema.pipelineNodeOverrides.scopeId, session.id)
				)
			)
		expect(rows).toHaveLength(0)
	})
})

describe("running it again", () => {
	it("copies nothing a second time", async () => {
		const { migrateLegacyConfigs } = await import(
			"$lib/server/pipelines/migrate/migrateLegacy"
		)
		const before = await db.select().from(schema.pipelineConfigs)

		const report = await migrateLegacyConfigs(db as any)

		// Idempotent means *already-migrated rows are not copied again* — not
		// that the pass never writes. A legacy row created since the last run is
		// still somebody's config and still has to come across, which is what
		// makes this safe to leave running on every boot.
		expect(report.some((r) => r.skipped > 0)).toBe(true)
		for (const r of report)
			expect(r.configs).not.toContain("My Questions-Only Config")

		const after = await db.select().from(schema.pipelineConfigs)
		const names = (rows: any[]) =>
			rows.filter((c) => c.name === "My Questions-Only Config").length
		expect(names(after)).toBe(1)
		expect(names(after)).toBe(names(before))
	})

	it("leaves the legacy tables completely alone", async () => {
		// They stay readable behind the read-only sidebar until 0.8.0 removes
		// them. A migration that consumed its source could not be re-run, and
		// could not be checked afterwards by the person it happened to.
		const [row] = await db
			.select()
			.from(schema.promptConfigs)
			.where(eq(schema.promptConfigs.id, mineId))
		expect(row.systemPrompt).toBe(MY_SYSTEM)
		expect(row.postHistoryDepth).toBe(3)
	})
})
