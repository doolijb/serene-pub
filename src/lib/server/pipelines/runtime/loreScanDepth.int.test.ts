/**
 * A lore node's parameters, from the stored row to the scan — through the
 * executor.
 *
 * ⚠ This exists because `nodeParams.test.ts` could not catch the thing it was
 * written to catch. That file calls `coreBindings()['core:query/world-lore@1']`
 * and hands it a `params` object directly, so it starts at the *binding's*
 * arguments and proves the binding reads them. The seam that actually broke is
 * one layer above: `resolveInput` only resolves slots the node's config already
 * names, and the three lore lanes never wired `params: slot.params()` — so the
 * binding was handed `undefined` no matter what the panel stored, and every
 * assertion in that file passed while `Scan Depth`, `Max Recursion Depth` and
 * `Retrieval Mode` did nothing on any real run.
 *
 * So these start where a person's edit starts — a row in the database — and end
 * at what the scan reports. The executor is in the middle on purpose: it is the
 * only participant that knows whether a slot was wired, and a test that skips it
 * cannot tell a live control from a dead one.
 */

import { describe, it, expect, beforeAll, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq, inArray } from "drizzle-orm"
import type { TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { worldLoreValues } from "$lib/server/pipelines/testing/fixtures"
import { run } from "@serene-pub/sdk"
import { coreBindings } from "$lib/server/pipelines/runtime/bindings"
import { createHost } from "$lib/server/pipelines/runtime/host"
import { buildWorld } from "$lib/server/pipelines/config/world"
import { bootstrapPipelines } from "$lib/server/pipelines/boot/bootstrap"
import { DEFAULT_RETRIEVAL } from "$lib/server/pipelines/ranking/weights"
import {
	respondSpec,
	RESPOND_SPEC_ID,
	narrateSpec,
	NARRATE_SPEC_ID
} from "$lib/server/pipelines/specs"

// No embedding model, so the keyword mechanism runs — which is the mechanism `scanDepth`
// governs and the one that reports a window in its diagnostics.
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null
}))

// The db module is mocked so `defaults.sync()` and `bootstrapPipelines` run
// against the test database, in the order `db/index.ts` guarantees at boot.
vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "lore-scan-depth-secret" }
})

let db: TestDb
let sessionId: number
let userId: number
let respondSpecRow: { id: number }
let narrateSpecRow: { id: number }

/** The three lanes of the reply pipeline, and the narrator's one. */
const LORE_LANES = [
	"gather.worldLore.read",
	"gather.characterLore.read",
	"gather.historyEntries.read"
] as const

beforeAll(async () => {
	process.env.SERENE_PUB_DATA_DIR = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-lore-scan-")
	)
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	await bootstrapPipelines(db as any)

	const [user] = await db
		.insert(schema.users)
		.values({ username: "scan", isAdmin: false })
		.returning()
	userId = user.id

	const [lorebook] = await db
		.insert(schema.lorebooks)
		.values({ name: "Scan", userId })
		.returning()

	const [session] = await db
		.insert(schema.sessions)
		.values({ userId, isGroup: false, lorebookId: lorebook.id })
		.returning()
	sessionId = session.id

	await db.insert(schema.lorebookEntries).values(
		worldLoreValues([
			{
				lorebookId: lorebook.id,
				name: "The Ashguard",
				keys: "ashguard",
				content: "An order of oathbound riders."
			}
		])
	)
	await db.insert(schema.sessionMessages).values({
		sessionId,
		role: "user",
		content: "tell me about the ashguard"
	} as any)

	respondSpecRow = (
		await db
			.select({ id: schema.pipelineSpecs.id })
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, RESPOND_SPEC_ID))
			.limit(1)
	)[0]
	narrateSpecRow = (
		await db
			.select({ id: schema.pipelineSpecs.id })
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, NARRATE_SPEC_ID))
			.limit(1)
	)[0]
}, 120_000)

/**
 * Run a shipped spec the way a turn does — real config, real world, real
 * executor — and report what each lore node says it scanned.
 *
 * `preview` stops before the provider, which needs a connection this test has
 * no business supplying; every node under test runs upstream of it.
 */
const scanned = async (
	doc: any,
	specId: string
): Promise<Record<string, number | undefined>> => {
	const receipt = await run(doc, {
		input: {
			text: "tell me about the ashguard",
			sessionId,
			characterId: null,
			sessionScope: { sessionId, currentCharacterId: null }
		},
		seed: "seed:scan",
		bindings: coreBindings(),
		world: await buildWorld(db as any, { sessionId, specId }),
		host: createHost(db as any, { sessionId, userId }),
		preview: true
	} as any)

	const out: Record<string, number | undefined> = {}
	for (const node of receipt.nodes as any[])
		if (node.output?.diagnostics?.scanDepth !== undefined)
			out[node.nodeKey] = node.output.diagnostics.scanDepth
	return out
}

/**
 * The config a run on this session actually resolves to.
 *
 * ⚠ Not the `pipeline-default:` row. `migrateContextTemplates` duplicates the
 * shipped config into a mutable "Default (customized)" and selects that at
 * instance scope, so on every install that has context templates the live values
 * are the copy's. A fixture that wrote to the immutable original would change
 * nothing and prove nothing — which is exactly the shape of the bug this file is
 * about, so it is worth stating rather than discovering twice.
 */
const selectedConfigId = async (slug: string, specId: number) => {
	const { resolveSelectedConfig } = await import(
		"$lib/server/pipelines/config/named"
	)
	const selected = await resolveSelectedConfig(db as any, specId, slug, {
		sessionId
	})
	expect(selected, `${slug} resolves to no configuration`).toBeTruthy()
	return selected!.configId
}

/** The effective config's row for one address, as a number. */
const effectiveValue = async (
	slug: string,
	specId: number,
	nodeKey: string
) => {
	const [row] = await db
		.select({ value: schema.pipelineConfigValues.value })
		.from(schema.pipelineConfigValues)
		.where(
			and(
				eq(
					schema.pipelineConfigValues.configId,
					await selectedConfigId(slug, specId)
				),
				eq(schema.pipelineConfigValues.nodeKey, nodeKey),
				eq(schema.pipelineConfigValues.slot, "params"),
				eq(schema.pipelineConfigValues.path, "scanDepth")
			)
		)
		.limit(1)
	return row?.value as number | undefined
}

describe("a lore node's scan depth reaches the scan", () => {
	// A liveness check, not the wiring guard — say so, because a shipped value
	// equal to the engine's fallback is exactly what let the dead control hide.
	// An unwired lane reports 10 here too; the next test is the one that fails.
	it("every lane runs and reports the shipped window", async () => {
		const depths = await scanned(respondSpec(), RESPOND_SPEC_ID)
		for (const lane of LORE_LANES)
			expect(
				depths[lane],
				`${lane} reported no scan window at all — it did not run`
			).toBe(DEFAULT_RETRIEVAL.scanDepth)

		const narrator = await scanned(narrateSpec(), NARRATE_SPEC_ID)
		expect(narrator["lore"]).toBe(DEFAULT_RETRIEVAL.scanDepth)
	}, 60_000)

	it("a configured value reaches the lane that was configured, and only it", async () => {
		// The assertion the unwired slot could not fail: an unwired `params`
		// resolves to nothing regardless of what is stored, so both numbers
		// below came back as the engine default and the two lanes agreed.
		const configId = await selectedConfigId(
			RESPOND_SPEC_ID,
			respondSpecRow.id
		)

		await db
			.update(schema.pipelineConfigValues)
			.set({ value: 4 })
			.where(
				and(
					eq(schema.pipelineConfigValues.configId, configId),
					eq(
						schema.pipelineConfigValues.nodeKey,
						"gather.worldLore.read"
					),
					eq(schema.pipelineConfigValues.slot, "params"),
					eq(schema.pipelineConfigValues.path, "scanDepth")
				)
			)

		try {
			const depths = await scanned(respondSpec(), RESPOND_SPEC_ID)
			expect(depths["gather.worldLore.read"]).toBe(4)
			// Each lane owns its own row (F20). One node's number reaching the
			// others would be the same defect wearing the opposite sign.
			expect(depths["gather.characterLore.read"]).toBe(
				DEFAULT_RETRIEVAL.scanDepth
			)
			expect(depths["gather.historyEntries.read"]).toBe(
				DEFAULT_RETRIEVAL.scanDepth
			)
		} finally {
			await db
				.update(schema.pipelineConfigValues)
				.set({ value: DEFAULT_RETRIEVAL.scanDepth })
				.where(
					and(
						eq(schema.pipelineConfigValues.configId, configId),
						eq(
							schema.pipelineConfigValues.nodeKey,
							"gather.worldLore.read"
						),
						eq(schema.pipelineConfigValues.slot, "params"),
						eq(schema.pipelineConfigValues.path, "scanDepth")
					)
				)
		}
	}, 60_000)
})

/**
 * The declaration and the engine's fallback, held together.
 *
 * They disagreed for as long as nothing read the declaration — 3 on the type,
 * 10 in `DEFAULT_RETRIEVAL` — and wiring the slot is what would have made the
 * smaller number suddenly live on every install. Read from the *projected
 * registry row* rather than from a literal here, because that row is what the
 * panel renders and what a config back-fills from: a declaration corrected in
 * the contracts package but never re-projected would still ship the old number.
 */
describe("the declared scan depth and the engine's fallback are one number", () => {
	const LORE_TYPES = [
		"core:query/world-lore",
		"core:query/character-lore",
		"core:query/history-entries",
		"core:query/lorebook-triggers"
	]

	it("every lore type declares what the scan would have used anyway", async () => {
		for (const typeId of LORE_TYPES) {
			const [row] = await db
				.select()
				.from(schema.pipelineTypeRegistry)
				.where(
					and(
						eq(schema.pipelineTypeRegistry.typeId, typeId),
						eq(schema.pipelineTypeRegistry.version, 1)
					)
				)
				.limit(1)
			const declared = (row?.slots as any)?.params?.schema?.scanDepth
				?.default
			expect(
				declared,
				`${typeId} declares scanDepth ${declared}, but a node handed ` +
					`nothing scans ${DEFAULT_RETRIEVAL.scanDepth} — the two are ` +
					`the same promise and must not drift`
			).toBe(DEFAULT_RETRIEVAL.scanDepth)
		}
	})
})
