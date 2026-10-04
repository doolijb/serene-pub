/**
 * Two shipped defaults that moved on 2026-10-03, re-projected by one
 * migration (`living_scene_look_reprojection`, squashed away; see `migrationSql`).
 *
 * - **Chat's reply prompt** (owner note 44): "Roleplay - Living Scene" claims
 *   `core:spec/respond` in place of "Roleplay - Simple". The seed pass moves
 *   the claim by itself, but the shipped respond config stores the row id
 *   `ensureDefaultConfig` resolved once, so an older install kept Simple.
 * - **Adventure's Look** moved onto the scene builder, with the places
 *   listing and the room rule as preset values on new nodes. Its prompt row
 *   moved pools, and the seed key spells the pool, so the migration re-keys
 *   the row in place (same id) before the seed pass looks for it.
 *
 * Replays the real migration file against a database whose shipped configs
 * and Look row look like an older install's, then boots again. A person's own
 * configuration keeps the prompt it names.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq, sql } from "drizzle-orm"
import type { TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { PRESQUASH_CHAIN } from "$lib/server/db/ledgerSpliceChain"

let db: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return {
		db,
		getCryptoSecretKey: () => "living-scene-look-reprojection-test-secret"
	}
})

const RESPOND = "core:spec/respond"
const LOOK = "core:spec/adventure-look"
const SHIPPED = (slug: string) => `pipeline-default:${slug}`
/** Not named by the migration: its shipped row must outlive the replay. */
const UNLISTED = SHIPPED("core:spec/adventure-respond")

const SIMPLE_KEY =
	"pipeline-prompt:core:task/build-template-context:prompts:prompt-roleplay-simple"
const LIVING_SCENE_KEY =
	"pipeline-prompt:core:task/build-template-context:prompts:prompt-roleplay-living-scene"
const LOOK_OLD_KEY =
	"pipeline-prompt:core:task/build-template-context:prompts:adventure-look"
const LOOK_KEY =
	"pipeline-prompt:core:task/build-scene-context:prompts:adventure-look"

const PLACE = { nodeKey: "place", slot: "params", path: "path" }
const ROOM_TYPES = {
	nodeKey: "gather.rooms.read",
	slot: "params",
	path: "entryTypes"
}
type Address = { nodeKey: string; slot: string; path: string }

const ADMIN_COPY_NAME = "Chat (living scene test copy)"

const boot = async () => {
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(db)
}

const specBySlug = async (slug: string) => {
	const [spec] = await db
		.select()
		.from(schema.pipelineSpecs)
		.where(eq(schema.pipelineSpecs.slug, slug))
	return spec
}

const configBySeed = async (seedKey: string) => {
	const [config] = await db
		.select()
		.from(schema.pipelineConfigs)
		.where(eq(schema.pipelineConfigs.seedKey, seedKey))
	return config
}

const promptBySeed = async (seedKey: string) => {
	const [row] = await db
		.select()
		.from(schema.pipelinePrompts)
		.where(eq(schema.pipelinePrompts.seedKey, seedKey))
	return row
}

/** The address a spec's prompts reference is stored at, for one node type. */
const promptAddress = async (
	slug: string,
	nodeDefinitionId: string
): Promise<Address> => {
	const spec = await specBySlug(slug)
	const { declarations } = await import(
		"$lib/server/pipelines/config/panel/declarations"
	)
	const decl = (await declarations(db, spec.activeVersionId!)).find(
		(d: any) =>
			d.control === "prompts-ref" &&
			String(d.nodeDefinitionId ?? "").startsWith(nodeDefinitionId)
	)
	expect(decl, `${slug} declares no ${nodeDefinitionId} prompts`).toBeTruthy()
	return { nodeKey: decl!.nodeKey, slot: decl!.slot, path: decl!.path ?? "" }
}

const rowAt = async (configId: number, a: Address) => {
	const [row] = await db
		.select()
		.from(schema.pipelineConfigValues)
		.where(
			and(
				eq(schema.pipelineConfigValues.configId, configId),
				eq(schema.pipelineConfigValues.nodeKey, a.nodeKey),
				eq(schema.pipelineConfigValues.slot, a.slot),
				eq(schema.pipelineConfigValues.path, a.path)
			)
		)
	return row
}

const valueAt = async (seedKey: string, a: Address) => {
	const config = await configBySeed(seedKey)
	expect(config, `${seedKey} has no shipped config`).toBeTruthy()
	return (await rowAt(config.id, a))?.value
}

/**
 * ⏳ The migration was squashed away before 0.6.0-pr-1 (archived in
 * `~/.claude/plans/ARCHIVE-drizzle-migrations-0094-0111-pr1.tar.gz`), and a
 * fresh or 0.5.3-upgraded pub never needs it. The ledger splice still replays
 * it on a pre-squash development database, from this byte-exact copy — so
 * this replay is that one, and goes when the splice goes.
 */
const migrationSql = async () => {
	const file = PRESQUASH_CHAIN.find((m) => m.tag.endsWith("_living_scene_look_reprojection"))
	expect(file?.sql, "no living_scene_look_reprojection migration").toBeTruthy()
	return file!.sql!
}

/** The shipped-config seed keys the migration deletes, read from the file. */
const listedSeedKeys = async () =>
	[...(await migrationSql()).matchAll(/'(pipeline-default:[^']+)'/g)].map(
		(m) => m[1]
	)

const replayMigration = async () => {
	for (const statement of (await migrationSql())
		.split("--> statement-breakpoint")
		.map((s) => s.trim())
		.filter(Boolean))
		await db.execute(sql.raw(statement))
}

const shippedIds = async () =>
	new Map(
		(
			await db
				.select({
					id: schema.pipelineConfigs.id,
					seedKey: schema.pipelineConfigs.seedKey
				})
				.from(schema.pipelineConfigs)
				.where(eq(schema.pipelineConfigs.isImmutable, true))
		).map((r) => [r.seedKey!, r.id])
	)

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-living-scene-look-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir

	const dbModule = await import("$lib/server/db")
	db = dbModule.db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	await boot()
}, 180_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

describe("the Living Scene and Look re-projection", () => {
	it(
		"names exactly the two shipped configs whose default moved",
		async () => {
			const listed = await listedSeedKeys()
			expect(listed.sort()).toEqual([SHIPPED(LOOK), SHIPPED(RESPOND)].sort())
			const ids = await shippedIds()
			for (const seedKey of listed)
				expect(ids.has(seedKey), `${seedKey} was never written`).toBe(true)
		},
		60_000
	)

	it(
		"ships Chat on Living Scene and Look on the scene pool's row, with the places, on a fresh install",
		async () => {
			const living = await promptBySeed(LIVING_SCENE_KEY)
			const reply = await promptAddress(RESPOND, "core:task/build-template-context")
			expect(await valueAt(SHIPPED(RESPOND), reply)).toBe(living.id)

			const look = await promptBySeed(LOOK_KEY)
			expect(look?.nodeDefinitionId).toBe("core:task/build-scene-context")
			expect(await promptBySeed(LOOK_OLD_KEY)).toBeUndefined()
			const lookAt = await promptAddress(LOOK, "core:task/build-scene-context")
			expect(lookAt.nodeKey).toBe("context")
			expect(await valueAt(SHIPPED(LOOK), lookAt)).toBe(look.id)
			expect(await valueAt(SHIPPED(LOOK), PLACE)).toBe("world.location")
			expect(await valueAt(SHIPPED(LOOK), ROOM_TYPES)).toEqual([
				"core:entry/location"
			])
		},
		60_000
	)

	it(
		"re-projects an older install's two defaults and re-keys Look's row in place, leaving a person's copy and unlisted specs alone",
		async () => {
			const simple = await promptBySeed(SIMPLE_KEY)
			const living = await promptBySeed(LIVING_SCENE_KEY)
			const reply = await promptAddress(RESPOND, "core:task/build-template-context")
			const shippedRespond = await configBySeed(SHIPPED(RESPOND))

			// An install written before note 44: the shipped respond config
			// names Simple.
			await db
				.update(schema.pipelineConfigValues)
				.set({ value: simple.id })
				.where(eq(schema.pipelineConfigValues.id, (await rowAt(shippedRespond.id, reply))!.id))

			// A person's own copy, which picked Simple.
			const [copy] = await db
				.insert(schema.pipelineConfigs)
				.values({
					specId: shippedRespond.specId,
					name: ADMIN_COPY_NAME,
					isImmutable: false,
					isDefault: false
				})
				.returning()
			const [copyRow] = await db
				.insert(schema.pipelineConfigValues)
				.values({ configId: copy.id, ...reply, value: simple.id })
				.returning()

			// A boot alone leaves the shipped respond config on Simple: the gap.
			await boot()
			expect(await valueAt(SHIPPED(RESPOND), reply)).toBe(simple.id)

			// Look as an older install holds it: the row in the template pool
			// under its old key, and a shipped config with no places.
			const look = await promptBySeed(LOOK_KEY)
			await db
				.update(schema.pipelinePrompts)
				.set({
					nodeDefinitionId: "core:task/build-template-context",
					seedKey: LOOK_OLD_KEY,
					fields: {
						systemPrompt: "You narrate an adventure for {{personaNames}}.",
						postHistoryInstructions: "Remember: describe the scene."
					}
				})
				.where(eq(schema.pipelinePrompts.id, look.id))
			const shippedLook = await configBySeed(SHIPPED(LOOK))
			for (const a of [PLACE, ROOM_TYPES]) {
				const row = await rowAt(shippedLook.id, a)
				if (row)
					await db
						.delete(schema.pipelineConfigValues)
						.where(eq(schema.pipelineConfigValues.id, row.id))
			}

			const before = await shippedIds()
			const listed = new Set(await listedSeedKeys())

			await replayMigration()
			await boot()

			// Chat's shipped default is a new row, on Living Scene.
			const respondAfter = await configBySeed(SHIPPED(RESPOND))
			expect(respondAfter.id).not.toBe(shippedRespond.id)
			expect(respondAfter.isImmutable).toBe(true)
			expect(await valueAt(SHIPPED(RESPOND), reply)).toBe(living.id)

			// The person's copy keeps Simple, in the same row.
			const copyRowAfter = await rowAt(copy.id, reply)
			expect(copyRowAfter?.id).toBe(copyRow.id)
			expect(copyRowAfter?.value).toBe(simple.id)

			// Look's prompt row: the same id, re-keyed into the scene pool and
			// refreshed from the catalog — no duplicate, no orphan.
			const lookAfter = await promptBySeed(LOOK_KEY)
			expect(lookAfter.id).toBe(look.id)
			expect(lookAfter.nodeDefinitionId).toBe("core:task/build-scene-context")
			expect((lookAfter.fields as any).systemPrompt).toContain("{{locationEntry}}")
			expect((lookAfter.fields as any).narratorName).toBe("Narrator")
			expect(await promptBySeed(LOOK_OLD_KEY)).toBeUndefined()
			const named = await db
				.select({ id: schema.pipelinePrompts.id })
				.from(schema.pipelinePrompts)
				.where(eq(schema.pipelinePrompts.name, "Adventure look"))
			expect(named).toHaveLength(1)

			// Look's shipped default is a new row, with the places.
			const lookConfigAfter = await configBySeed(SHIPPED(LOOK))
			expect(lookConfigAfter.id).not.toBe(shippedLook.id)
			const lookAt = await promptAddress(LOOK, "core:task/build-scene-context")
			expect(await valueAt(SHIPPED(LOOK), lookAt)).toBe(look.id)
			expect(await valueAt(SHIPPED(LOOK), PLACE)).toBe("world.location")
			expect(await valueAt(SHIPPED(LOOK), ROOM_TYPES)).toEqual([
				"core:entry/location"
			])

			// Every listed spec got a new shipped row; every other kept its own.
			const afterIds = await shippedIds()
			expect(afterIds.get(UNLISTED)).toBe(before.get(UNLISTED))
			for (const [seedKey, id] of before) {
				expect(afterIds.has(seedKey), `${seedKey} was not rewritten`).toBe(true)
				if (listed.has(seedKey))
					expect(afterIds.get(seedKey), `${seedKey} kept its row`).not.toBe(id)
				else expect(afterIds.get(seedKey), `${seedKey} was rewritten`).toBe(id)
			}
		},
		120_000
	)
})
