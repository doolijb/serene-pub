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
import { eq } from "drizzle-orm"
import type { TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import * as attic from "$lib/server/attic/tables"
import { buildTestAttic, WIRING_TABLES } from "$lib/server/attic/testAttic"

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
	// The legacy rows are 0.5.3's, and the migration reads them from the
	// attic the upgrade stashed them in.
	await buildTestAttic(db, WIRING_TABLES)
	await db.insert(attic.systemSettings).values({})

	const [user] = await db
		.insert(schema.users)
		.values({ username: "migrating-user", isAdmin: false })
		.returning()
	userId = user.id

	// The situation this exists for: a person with their own prompt config,
	// their own numeric tuning, and it selected on a session.
	const [mine] = await db
		.insert(attic.promptConfigs)
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
		.insert(attic.narratorPromptConfigs)
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
		.insert(attic.sceneSummarizeConfigs)
		.values({
			name: "My Scene Summarizer",
			batchSystemPrompt: "Draft it my way.",
			synthSystemPrompt: "Weave it my way.",
			nameSystemPrompt: "Title it my way.",
			characterExtractionSystemPrompt: "List the cast my way."
		})
		.returning()
	sceneMineId = sceneMine.id

	sessionId = await chatWithPrompt(mine.id)

	await db
		.insert(attic.userSettings)
		.values({ userId, activePromptConfigId: mine.id })

	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(db)
}, 180_000)

/** A session, and the 0.5.3 chat it was — same id — selecting a prompt config. */
async function chatWithPrompt(promptConfigId: number): Promise<number> {
	const [session] = await db
		.insert(schema.sessions)
		.values({ userId, isGroup: false })
		.returning()
	await db
		.insert(attic.chats)
		.values({ id: session.id, userId, isGroup: false, promptConfigId })
	return session.id
}

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
					`migrated:core:spec/chat-respond:${mineId}`
				)
			)
		expect(config).toBeTruthy()
		expect(config.name).toBe("My Questions-Only Config")
		// Theirs, so editable — unlike the prompts core ships.
		expect(config.isImmutable).toBe(false)
		expect(config.specId).toBe(await specIdOf("core:spec/chat-respond"))
	})

	it("keeps their wording exactly", async () => {
		// Found by `created_for_spec_id` rather than by ownership: a migrated
		// prompt lands in the POOL its step reads from, and that pool is shared
		// with every other pipeline reusing the step. Which pipeline it was
		// written in is now a grouping fact, which is exactly what this asserts.
		const specId = await specIdOf("core:spec/chat-respond")
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
			await declarations(db, spec.activeVersionId!)
		).filter((d: any) => d.control === "prompts-ref")
		const pools = new Set(
			decls.map((d: any) => `${d.nodeDefinitionId}#${d.slot}`)
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
			expect(`${row.nodeDefinitionId}#${row.slot}`).toBe(
				`${(d as any).nodeDefinitionId}#${d.slot}`
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
		const narrateId = await specIdOf("core:spec/chat-narrate")
		const [config] = await db
			.select()
			.from(schema.pipelineConfigs)
			.where(
				eq(
					schema.pipelineConfigs.seedKey,
					`migrated:core:spec/chat-narrate:${narratorMineId}`
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

	it("sends a narration's direction with a narrator prompt somebody wrote, as 0.5.3 did", async () => {
		// 0.5.3 appended what a person typed in the Narrator modal to the
		// prompt in code (`promptBuilder.compilePrompt`), whatever the config
		// said. In 0.6 the prompt row says it, so a carried row has to.
		const narrateId = await specIdOf("core:spec/chat-narrate")
		const prompts = await db
			.select()
			.from(schema.pipelinePrompts)
			.where(eq(schema.pipelinePrompts.createdForSpecId, narrateId))
		const mine: any = prompts.find((p: any) => p.name === "My Narrator")
		const { default: Handlebars } = await import("handlebars")
		const render = (text: string, turnDirection: string) =>
			Handlebars.compile(text, { noEscape: true })({ turnDirection })

		expect(render(mine.fields.systemPrompt, "The storm breaks.")).toBe(
			"Describe the room, never the people.\n\nAdditional focus for this response: The storm breaks."
		)
		expect(render(mine.fields.postHistoryInstructions, "The storm breaks.")).toBe(
			"Additional focus for this response: The storm breaks."
		)
		// Undirected, the text is exactly what the person wrote.
		expect(render(mine.fields.systemPrompt, "")).toBe("Describe the room, never the people.")
		expect(render(mine.fields.postHistoryInstructions, "")).toBe("")
	})
})

describe("selections follow", () => {
	it("selects it at the scopes that had it selected", async () => {
		// Without this the migration copies everything across and then shows the
		// user a default they did not choose, which is worse than not migrating.
		const specId = await specIdOf("core:spec/chat-respond")
		const [config] = await db
			.select()
			.from(schema.pipelineConfigs)
			.where(
				eq(
					schema.pipelineConfigs.seedKey,
					`migrated:core:spec/chat-respond:${mineId}`
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
		// There is no user layer (ruled 2026-08-24): a person's legacy pick
		// lands on every session they own (owner ruling B1, 2026-10-01) —
		// here because it is the user's ACTIVE pick, not because the chat
		// named it: 0.5.3 never read a chat's own prompt config (M5).
		expect(at("user", userId)).toBeUndefined()
		expect(at("session", sessionId)?.configId).toBe(config.id)
	})
})

describe("prompt text only (owner ruling, 2026-10-01)", () => {
	it("carries no post-history numbers — not on the config, not as an override", async () => {
		// `post_history_depth` was a column on `prompt_configs`; the upgrade
		// carries a config's prompt text and nothing else, so the pipeline's
		// own numbers stand and the restore notes the loss.
		const [config] = await db
			.select()
			.from(schema.pipelineConfigs)
			.where(eq(schema.pipelineConfigs.seedKey, `migrated:core:spec/chat-respond:${mineId}`))
		const postHistory = async (configId: number) =>
			(
				await db
					.select()
					.from(schema.pipelineConfigValues)
					.where(eq(schema.pipelineConfigValues.configId, configId))
			)
				.filter((v: any) => v.slot === "params" && v.path.startsWith("postHistory"))
				.map((v: any) => [v.nodeKey, v.path, v.value])
				.sort()
		const [shipped] = await db
			.select()
			.from(schema.pipelineConfigs)
			.where(eq(schema.pipelineConfigs.seedKey, "pipeline-default:core:spec/chat-respond"))
		// The shipped default's numbers, whatever they are — never the 3 and
		// 500 this person's 0.5.3 config held.
		expect(await postHistory(config.id)).toEqual(await postHistory(shipped.id))
		expect((await postHistory(config.id)).map((r) => r[2])).not.toContain(500)
		const overrides = (
			await db
				.select()
				.from(schema.pipelineNodeOverrides)
				.where(eq(schema.pipelineNodeOverrides.slot, "params"))
		).filter((r: any) => r.path.startsWith("postHistory"))
		expect(overrides).toEqual([])
	})
})

describe("running it again", () => {
	it("copies nothing a second time", async () => {
		const { migrateLegacyConfigs } = await import(
			"$lib/server/pipelines/migrate/migrateLegacy"
		)
		const before = await db.select().from(schema.pipelineConfigs)

		const report = await migrateLegacyConfigs(db)

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

	it("leaves the attic's legacy rows alone", async () => {
		// A migration that consumed its source could not be re-run by a boot
		// that resumes an interrupted upgrade.
		const [row] = await db
			.select()
			.from(attic.promptConfigs)
			.where(eq(attic.promptConfigs.id, mineId))
		expect(row.systemPrompt).toBe(MY_SYSTEM)
		expect(row.postHistoryDepth).toBe(3)
	})
})
