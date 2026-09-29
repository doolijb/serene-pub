/**
 * 0137's data step: a preset's included set is rewritten from bare function
 * keys to action identities (U5c review W-A, ruled 2026-09-16; promotion
 * rule re-ruled on the third pass, W4+W2).
 *
 * `included_actions` was writable before identities existed — through
 * `sessionPresets:update` on `session_presets` and `pipelines:setPresetActions`
 * on the legacy squat `pipeline_configs` — so a user install may hold
 * `["narrate"]`. The reader used to match that against the bare function; it
 * now matches identities (`core:spec/narrate#narrate`), with a ⏳ bare-key
 * fallback. The step makes the stored shape the current one where it can:
 * each bare key becomes the identity of the ONE action — published, active,
 * of ANY origin — declaring that function for that genre, and is left alone
 * when none or several do. Four things that rule pins, each a row below:
 *
 *  · a single **attachment** declarer is promoted too — an admin included it
 *    when it was valid, and silent loss is worse (W2);
 *  · a key **two** actions declare stays bare — never a first-by-id pick;
 *  · a plugin genre's own declarer is promoted by its own namespace, and a
 *    `core:` declarer for that genre is not preferred over it (S3) — with
 *    both present the key stays bare;
 *  · a curated **empty** set survives as `[]`, not NULL (C1): `json_agg`
 *    over no rows is NULL, and the reader takes NULL for "no opinion".
 *
 * ⚠ It runs the REAL migration file, statement for statement, like the other
 * migration suites: a test that hand-wrote the UPDATE would prove a query
 * this file invented is right and nothing about what ships.
 *
 * `createTestDb` applies every migration, so 0137's `CREATE TABLE` has run
 * by the time a row can be seeded; the table is dropped first and the whole
 * file replayed against the same shapes an upgrade meets — and the data step
 * is idempotent, so replaying it over identities is a no-op, which one
 * assertion pins.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import { sql } from "drizzle-orm"
import type { TestDb } from "$lib/server/utils/testDb"
import type { SpecDocument } from "@serene-pub/sdk"

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

const MIGRATION = "drizzle/0137_seen_actions.sql"
const CHAT = "core:genre/chat"
const PLUGIN_GENRE = "acme:genre/x"

let db: TestDb
let dataDir: string
let presetId: number
let emptyPresetId: number
let pluginPresetId: number
let configId: number
let emptyConfigId: number

/** One published one-node spec contributing `actions` for `genreId`. */
async function publishActionSpec(
	id: string,
	genreId: string,
	actions: Array<{ key: string; function: string }>
) {
	const { spec, compile, use } = await import("@serene-pub/sdk")
	const C = await import("@serene-pub/contracts")
	const doc: SpecDocument = compile(
		spec(id, {
			version: "1.0.0",
			taxonomy: { role: "action"},
			contributes: {
				actions: actions.map((a) => ({
					...a,
					venue: { kind: "composer" },
					label: { en: a.key },
					description: { en: `Fires ${a.key}.` }
				}))
			}
		})
			.inlet("input", C.userMessage.v1(), {
				genre: use(genreId),
				event: "core:event/session-action@1"
			})
			.outlet("save", ($) => C.createMessage.v1({ text: $.input.text }))
			.build()
	)
	const { saveDocument } = await import("$lib/server/pipelines/boot/store")
	const saved = await saveDocument(db as any, doc, { publish: true })
	// 0137 was written against the documents of its day, which carried
	// `function` on every action; the SDK stopped writing it with plans/31 V2
	// (the key is the identity). The stored version is put back into that
	// shape here, so the migration is exercised against what it was made for.
	const schema = await import("$lib/server/db/schema")
	await db
		.update(schema.pipelineSpecVersions)
		.set({
			contributes: {
				actions: actions.map((a) => ({
					key: a.key,
					function: a.function,
					genre: genreId,
					venue: [{ kind: "composer" }],
					label: { en: a.key }
				}))
			}
		} as any)
		.where(eq(schema.pipelineSpecVersions.id, saved.specVersionId))
}

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-preset-identity-migration-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	const schema = await import("$lib/server/db/schema")
	// The shipped specs — `core:spec/narrate` is the one declarer of
	// `narrate` for chat.
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(db as any)
	// …in the shape of their day: every stored action carried `function`
	// until plans/31 V2, and 0137 reads that field. The seeded narrate spec
	// is put back into it, as `publishActionSpec` does for the fixtures.
	{
		const [narrateSpec] = await db
			.select({ activeVersionId: schema.pipelineSpecs.activeVersionId })
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, "core:spec/narrate"))
		const [version] = await db
			.select({ contributes: schema.pipelineSpecVersions.contributes })
			.from(schema.pipelineSpecVersions)
			.where(eq(schema.pipelineSpecVersions.id, narrateSpec!.activeVersionId!))
		const contributes = version!.contributes as { actions: Array<Record<string, unknown>> }
		await db
			.update(schema.pipelineSpecVersions)
			.set({
				contributes: {
					...contributes,
					actions: contributes.actions.map((a) => ({ ...a, function: a.key }))
				}
			} as any)
			.where(eq(schema.pipelineSpecVersions.id, narrateSpec!.activeVersionId!))
	}

	// `sum`: one declarer, an attachment — promoted (W2).
	await publishActionSpec("acme:spec/sum", CHAT, [{ key: "sum", function: "sum" }])
	// `roll`: two declarers, one of each origin — stays bare (W4).
	await publishActionSpec("acme:spec/roll", CHAT, [{ key: "roll", function: "roll" }])
	await publishActionSpec("core:spec/test-roll", CHAT, [
		{ key: "roll", function: "roll" }
	])
	// A plugin genre (S3): `dance` by its own spec alone — promoted by its
	// own namespace; `sing` by its own spec AND a `core:` spec for that genre
	// — the core one is not preferred, so the key stays bare.
	await publishActionSpec("acme:spec/dance", PLUGIN_GENRE, [
		{ key: "dance", function: "dance" }
	])
	await publishActionSpec("acme:spec/sing", PLUGIN_GENRE, [
		{ key: "sing", function: "sing" }
	])
	await publishActionSpec("core:spec/sing-for-x", PLUGIN_GENRE, [
		{ key: "sing", function: "sing" }
	])

	// The pre-upgrade rows: bare keys beside an identity and a stranger.
	const [preset] = await db
		.insert(schema.sessionPresets)
		.values({
			name: "Pre-identity",
			genreId: CHAT,
			bindings: {},
			includedActions: [
				"narrate",
				"core:spec/narrate#narrate",
				"sum",
				"roll",
				"teleport"
			]
		})
		.returning({ id: schema.sessionPresets.id })
	presetId = preset!.id
	const [empty] = await db
		.insert(schema.sessionPresets)
		.values({
			name: "Curated empty",
			genreId: CHAT,
			bindings: {},
			includedActions: []
		})
		.returning({ id: schema.sessionPresets.id })
	emptyPresetId = empty!.id
	const [plugin] = await db
		.insert(schema.sessionPresets)
		.values({
			name: "Plugin genre, pre-identity",
			genreId: PLUGIN_GENRE,
			bindings: {},
			includedActions: ["dance", "sing"]
		})
		.returning({ id: schema.sessionPresets.id })
	pluginPresetId = plugin!.id

	const [respond] = await db
		.select({ id: schema.pipelineSpecs.id })
		.from(schema.pipelineSpecs)
		.where(eq(schema.pipelineSpecs.slug, "core:spec/respond"))
		.limit(1)
	const [config] = await db
		.insert(schema.pipelineConfigs)
		.values({
			specId: respond!.id,
			name: "Pre-identity squat",
			includedActions: ["narrate", "sum", "roll"]
		})
		.returning({ id: schema.pipelineConfigs.id })
	configId = config!.id
	const [emptyConfig] = await db
		.insert(schema.pipelineConfigs)
		.values({
			specId: respond!.id,
			name: "Curated empty squat",
			includedActions: []
		})
		.returning({ id: schema.pipelineConfigs.id })
	emptyConfigId = emptyConfig!.id

	// ── Back to the shape 0136 left, then the shipped file ─────────────────
	await db.execute(sql`DROP TABLE "seen_actions"`)
	await replay()
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

/** Split the way drizzle's migrator splits it. */
async function replay() {
	const { readFileSync } = await import("node:fs")
	const { resolve } = await import("node:path")
	const text = readFileSync(resolve(process.cwd(), MIGRATION), "utf8")
	for (const statement of text.split("--> statement-breakpoint")) {
		if (!statement.trim()) continue
		await db.execute(sql.raw(statement))
	}
}

const presetIncluded = async (id: number = presetId) => {
	const schema = await import("$lib/server/db/schema")
	const [row] = await db
		.select({ includedActions: schema.sessionPresets.includedActions })
		.from(schema.sessionPresets)
		.where(eq(schema.sessionPresets.id, id))
	return row!.includedActions
}

const configIncluded = async (id: number) => {
	const schema = await import("$lib/server/db/schema")
	const [row] = await db
		.select({ includedActions: schema.pipelineConfigs.includedActions })
		.from(schema.pipelineConfigs)
		.where(eq(schema.pipelineConfigs.id, id))
	return row!.includedActions
}

const EXPECTED = [
	"core:spec/narrate#narrate",
	"core:spec/narrate#narrate",
	"acme:spec/sum#sum",
	"roll",
	"teleport"
]

describe("0137 — a preset's included set is rewritten to identities", () => {
	it("a single declarer of any origin is promoted (companion narrate, attachment sum); a two-declarer key, an identity and a stranger are left as they were, in order", async () => {
		expect(await presetIncluded()).toEqual(EXPECTED)
	}, 60_000)

	it("a curated empty set survives as [] on both tables — never NULL (C1)", async () => {
		expect(await presetIncluded(emptyPresetId)).toEqual([])
		expect(await configIncluded(emptyConfigId)).toEqual([])
	}, 60_000)

	it("a plugin genre's row is promoted by its own namespace, and a core: declarer for that genre is not preferred over it (S3)", async () => {
		expect(await presetIncluded(pluginPresetId)).toEqual([
			"acme:spec/dance#dance",
			"sing"
		])
	}, 60_000)

	it("the legacy squat on pipeline_configs is rewritten through its pipeline's genre by the same rule", async () => {
		expect(await configIncluded(configId)).toEqual([
			"core:spec/narrate#narrate",
			"acme:spec/sum#sum",
			"roll"
		])
	}, 60_000)

	it("replaying the step is a no-op, and NULL stays NULL", async () => {
		const schema = await import("$lib/server/db/schema")
		const [bare] = await db
			.insert(schema.sessionPresets)
			.values({ name: "No opinion", genreId: CHAT, bindings: {} })
			.returning({ id: schema.sessionPresets.id })
		await db.execute(sql`DROP TABLE "seen_actions"`)
		await replay()
		expect(await presetIncluded()).toEqual(EXPECTED)
		expect(await presetIncluded(emptyPresetId)).toEqual([])
		expect(await presetIncluded(bare!.id)).toBeNull()
	}, 60_000)

	it("the reader agrees: the promoted keys include their actions, and a bare two-declarer key includes neither", async () => {
		const { presetIncludes, listGenreActions } = await import(
			"$lib/server/pipelines/entities/sessionGenres"
		)
		const offered = await listGenreActions(db as any, CHAT)
		const narrate = offered.find((t) => t.specSlug === "core:spec/narrate")!
		const sum = offered.find((t) => t.specSlug === "acme:spec/sum")!
		const rolls = offered.filter((t) => t.key === "roll")
		expect(rolls).toHaveLength(2)
		const included = (await presetIncluded()) as string[]
		expect(presetIncludes(included, narrate, offered)).toBe(true)
		expect(presetIncludes(included, sum, offered)).toBe(true)
		for (const roll of rolls)
			expect(presetIncludes(included, roll, offered)).toBe(false)
		// Named by identity, either declarer is included on its own.
		expect(
			presetIncludes(["acme:spec/roll#roll"], rolls.find((r) => r.specSlug === "acme:spec/roll")!, offered)
		).toBe(true)
		// A stale bare key the reader's fallback would still promote, had the
		// migration missed it: the same sole-declarer rule.
		expect(presetIncludes(["sum"], sum, offered)).toBe(true)
	}, 60_000)

	it("the boot notice names each preset still carrying bare keys, once, with the keys", async () => {
		const { seedSessionPresets } = await import(
			"$lib/server/pipelines/boot/seed"
		)
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
		try {
			const { bareIncluded } = await seedSessionPresets(db as any)
			const byId = new Map(bareIncluded.map((n) => [n.presetId, n.keys]))
			expect(byId.get(presetId)).toEqual(["roll", "teleport"])
			expect(byId.get(pluginPresetId)).toEqual(["sing"])
			expect(byId.has(emptyPresetId)).toBe(false)
			expect(
				warn.mock.calls.filter(([m]) =>
					String(m).includes("includes bare function keys")
				)
			).toHaveLength(bareIncluded.length)
		} finally {
			warn.mockRestore()
		}
	}, 60_000)
})
