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
let chatId: number
let mineId: number
let narratorMineId: number

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
	// their own numeric tuning, and it selected on a chat.
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

	const [chat] = await db
		.insert(schema.chats)
		.values({ userId, isGroup: false, promptConfigId: mine.id })
		.returning()
	chatId = chat.id

	await db
		.insert(schema.userSettings)
		.values({ userId, activePromptConfigId: mine.id })
		.onConflictDoUpdate({
			target: schema.userSettings.userId,
			set: { activePromptConfigId: mine.id }
		})

	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
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
		const specId = await specIdOf("core:spec/respond")
		const prompts = await db
			.select()
			.from(schema.pipelinePrompts)
			.where(eq(schema.pipelinePrompts.specId, specId))
		const mine: any = prompts.find(
			(p: any) => p.name === "My Questions-Only Config"
		)
		expect(mine).toBeTruthy()
		expect(mine.isImmutable).toBe(false)
		expect(mine.fields.systemPrompt).toBe(MY_SYSTEM)
		expect(mine.fields.postHistoryInstructions).toBe(MY_POST)
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
			.where(eq(schema.pipelinePrompts.specId, narrateId))
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
		expect(at("user", userId)?.configId).toBe(config.id)
		expect(at("chat", chatId)?.configId).toBe(config.id)
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

		const [chat] = await db
			.insert(schema.chats)
			.values({ userId, isGroup: false, promptConfigId: untouched.id })
			.returning()

		const { migrateLegacyParams } = await import("$lib/server/pipelines/migrate/migrateLegacy")
		await migrateLegacyParams(db as any)

		const rows = await db
			.select()
			.from(schema.pipelineNodeOverrides)
			.where(
				and(
					eq(schema.pipelineNodeOverrides.specId, specId),
					eq(schema.pipelineNodeOverrides.scopeKind, "chat"),
					eq(schema.pipelineNodeOverrides.scopeId, chat.id)
				)
			)
		expect(rows).toHaveLength(0)
	})
})

describe("running it again", () => {
	it("copies nothing a second time", async () => {
		const { migrateLegacyConfigs } = await import("$lib/server/pipelines/migrate/migrateLegacy")
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
