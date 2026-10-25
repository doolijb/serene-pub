/**
 * Wave 8's shipped configurations, re-projected for the room rule.
 *
 * Wave 8 (lorebooks, 2026-10-02) gave Adventure and the Lair a `place` step
 * whose `path` (`world.location`) is a preset value on a new node, and
 * flipped `entity-search` (`maxMessages` 20) and `mention-spans`
 * (`maxMentions` 8) on by default. `ensureDefaultConfig` writes the shipped
 * config once, and `reconcileConfigs` back-fills a missing address from the
 * declaration rather than the preset, so a shipped config written before the
 * wave never learns the `place` path (the flipped defaults it inherits by
 * itself). `wave8_retrieval_reprojection` (squashed away; see `migrationSql`) deletes the five
 * immutable rows so the next boot writes them again from what the code ships;
 * the damage below also plants the zeros an install could only hold by hand,
 * to show the rewrite takes the code's values whole.
 *
 * Replays the real migration file against a database whose shipped
 * lair-room-answer config looks like an older install's, then boots again.
 * (The subject was lair-respond until the Lair rewrite retired it,
 * 2026-10-21: the frozen migration still names it, and no build since
 * writes it — as Adventure's reply before it.)
 *
 * A value that equals its declaration is never stored (the 2026-09-10 rule,
 * swept on every boot), so on a fresh install `maxMessages` and `maxMentions`
 * hold no row and are inherited. The assertions read the effective value: the
 * row where there is one, the declared default where there is not.
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
		getCryptoSecretKey: () => "wave8-retrieval-reprojection-test-secret"
	}
})

const SEED_PREFIX = "pipeline-default:"
/**
 * The Lair's *Answer the door*: one of the migration's `place` steps.
 * Adventure's reply was the subject here until it retired with Adventure
 * (2026-10-19), then the Lair's reply until the Lair rewrite retired it
 * (2026-10-21); the migration still names both, and a fresh install writes
 * neither.
 */
const LAIR = `${SEED_PREFIX}core:spec/lair-room-answer`
const RETIRED_ADVENTURE = `${SEED_PREFIX}core:spec/adventure-respond`
const RETIRED_LAIR_REPLY = `${SEED_PREFIX}core:spec/lair-respond`
const RETIRED = [RETIRED_ADVENTURE, RETIRED_LAIR_REPLY]
/** Not named by the migration: its shipped row must outlive the replay. */
const UNLISTED = `${SEED_PREFIX}core:spec/guide-create`

const PLACE = { nodeKey: "place", slot: "params", path: "path" }
type Address = typeof PLACE

const ADMIN_COPY_NAME = "Lair (wave 8 test copy)"
/** An administrator's own place path, on the copy (never the shipped one). */
const ADMIN_COPY_VALUE = "world.party.room"

const boot = async () => {
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(db)
}

const configBySeed = async (seedKey: string) => {
	const [config] = await db
		.select()
		.from(schema.pipelineConfigs)
		.where(eq(schema.pipelineConfigs.seedKey, seedKey))
	return config
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

/**
 * What a config resolves at an address: its row where it holds one, the
 * active version's declared default where it does not.
 */
const effective = async (seedKey: string, a: Address) => {
	const config = await configBySeed(seedKey)
	expect(config, `${seedKey} has no shipped config`).toBeTruthy()
	const row = await rowAt(config.id, a)
	if (row) return row.value
	const [spec] = await db
		.select()
		.from(schema.pipelineSpecs)
		.where(eq(schema.pipelineSpecs.slug, seedKey.slice(SEED_PREFIX.length)))
	const { declarations } = await import("$lib/server/pipelines/config/panel")
	const decl = (await declarations(db, spec.activeVersionId!)).find(
		(d) => d.nodeKey === a.nodeKey && d.slot === a.slot && d.path === a.path
	)
	expect(
		decl,
		`${a.nodeKey}|${a.slot}|${a.path} is not declared on ${seedKey}`
	).toBeTruthy()
	return decl!.authorDefault
}

/**
 * ⏳ The migration was squashed away before 0.6.0-pr-1 (archived in
 * `~/.claude/plans/ARCHIVE-drizzle-migrations-0094-0111-pr1.tar.gz`), and a
 * fresh or 0.5.3-upgraded pub never needs it. The ledger splice still replays
 * it on a pre-squash development database, from this byte-exact copy — so
 * this replay is that one, and goes when the splice goes.
 */
const migrationSql = async () => {
	const file = PRESQUASH_CHAIN.find((m) => m.tag.endsWith("_wave8_retrieval_reprojection"))
	expect(file?.sql, "no wave8_retrieval_reprojection migration").toBeTruthy()
	return file!.sql!
}

/** The seed keys the migration names, read from the file itself. */
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
		path.join(os.tmpdir(), "serene-pub-wave8-retrieval-test-")
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

describe("wave 8 retrieval re-projection", () => {
	it(
		"names the five shipped configs with a place step, each of which a fresh install writes",
		async () => {
			const listed = await listedSeedKeys()
			expect(listed).toHaveLength(5)
			expect(listed).toContain(LAIR)
			expect(listed).not.toContain(UNLISTED)
			const ids = await shippedIds()
			// Retired with Adventure (2026-10-19) and the Lair rewrite
			// (2026-10-21): named by the frozen migration, written by no build since.
			for (const gone of RETIRED) {
				expect(listed).toContain(gone)
				expect(ids.has(gone)).toBe(false)
			}
			for (const seedKey of listed.filter((k) => !RETIRED.includes(k)))
				expect(ids.has(seedKey), `${seedKey} was never written`).toBe(true)
		},
		60_000
	)

	it(
		"ships lair-room-answer with the place path, on a fresh install",
		async () => {
			expect(await effective(LAIR, PLACE)).toBe("world.location")
		},
		60_000
	)

	it(
		"rewrites an older install's lair-room-answer default from the code, leaving an admin copy and unlisted specs alone",
		async () => {
			const shipped = await configBySeed(LAIR)
			expect(shipped, "lair-room-answer has no shipped config").toBeTruthy()

			// An install written before the wave: no `place` path (the preset
			// value on a new node), and retrieval stored at the old zero.
			await db
				.delete(schema.pipelineConfigValues)
				.where(
					and(
						eq(schema.pipelineConfigValues.configId, shipped.id),
						eq(schema.pipelineConfigValues.nodeKey, PLACE.nodeKey),
						eq(schema.pipelineConfigValues.slot, PLACE.slot),
						eq(schema.pipelineConfigValues.path, PLACE.path)
					)
				)

			// An administrator's tuned copy: its own row, not immutable.
			const [copy] = await db
				.insert(schema.pipelineConfigs)
				.values({
					specId: shipped.specId,
					name: ADMIN_COPY_NAME,
					isImmutable: false,
					isDefault: false
				})
				.returning()
			const [copyRow] = await db
				.insert(schema.pipelineConfigValues)
				.values({
					configId: copy.id,
					...PLACE,
					value: ADMIN_COPY_VALUE
				})
				.returning()

			// A boot alone leaves the old rows as they are: this is the gap.
			await boot()
			expect(await rowAt(shipped.id, PLACE)).toBeUndefined()

			const before = await shippedIds()
			const listed = new Set(await listedSeedKeys())

			await replayMigration()
			await boot()

			// The shipped default is a new row, written from the code.
			const after = await configBySeed(LAIR)
			expect(after.id).not.toBe(shipped.id)
			expect(after.isImmutable).toBe(true)
			expect(await effective(LAIR, PLACE)).toBe("world.location")

			// The administrator's copy keeps the value it chose, in the same row.
			const [copyAfter] = await db
				.select()
				.from(schema.pipelineConfigs)
				.where(eq(schema.pipelineConfigs.id, copy.id))
			expect(copyAfter, "the admin copy was deleted").toBeTruthy()
			expect(copyAfter.isImmutable).toBe(false)
			expect(copyAfter.name).toBe(ADMIN_COPY_NAME)
			const copyRowAfter = await rowAt(copy.id, PLACE)
			expect(copyRowAfter?.id).toBe(copyRow.id)
			expect(copyRowAfter?.value).toBe(ADMIN_COPY_VALUE)

			// Every listed spec got a new shipped row; every other kept its own.
			const afterIds = await shippedIds()
			expect(afterIds.get(UNLISTED)).toBeDefined()
			expect(afterIds.get(UNLISTED)).toBe(before.get(UNLISTED))
			for (const [seedKey, id] of before) {
				expect(afterIds.has(seedKey), `${seedKey} was not rewritten`).toBe(
					true
				)
				if (listed.has(seedKey))
					expect(afterIds.get(seedKey), `${seedKey} kept its row`).not.toBe(id)
				else
					expect(afterIds.get(seedKey), `${seedKey} was rewritten`).toBe(id)
			}
		},
		120_000
	)
})
