/**
 * The allocation precedence, from a stored row to what the ranker selected —
 * and migration 0196 on an install that has booted before.
 *
 * Three things this file exists to prevent, and none of them is visible from
 * `select.test.ts` or on a fresh database.
 *
 * **An option nothing can reach.** `SelectOptions.scoreLedAllocation` was
 * built, tested and had **no runtime caller at all**: `core:task/rank-hybrid@1`
 * is the only runtime `select()` there is and it passed `availableTokens` and
 * `params` alone. Fifteen unit cases exercised an inversion no run could take,
 * which is the same distance every dead control in this subsystem has lived in
 * — `nodeParams.test.ts` hands a binding its parameters by hand and therefore
 * cannot see the seam that actually breaks, because the executor resolves only
 * the slots a node's config already names. This starts at a row and ends at
 * what the ranker kept.
 *
 * **A default that is not inert.** It ships false. An upgraded install has to
 * select exactly what it selected before, which is the property that leaves the
 * parity corpus measuring the shipped path and makes the change reviewable.
 *
 * **The registry refusal.** `rank-hybrid`'s content hash moved.
 * `syncDefinitionRegistry` refuses to republish a changed version,
 * `bootstrapPipelines` catches that refusal, records it in `report.conflict`
 * and **returns early** — no specs seeded, no configs reconciled, pipelines
 * dead on every upgraded install. 0196's re-projection is what stops that, and
 * the failure is asserted first so this cannot pass vacuously against a
 * migration that matches nothing.
 */

import { describe, it, expect, beforeAll, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import {
	setConfigValue,
	type TestDb
} from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { worldLoreValues, historyValues } from "$lib/server/pipelines/testing/fixtures"
import { run } from "@serene-pub/sdk"
import { coreBindings } from "$lib/server/pipelines/runtime/bindings"
import { createHost } from "$lib/server/pipelines/runtime/host"
import { buildWorld } from "$lib/server/pipelines/config/world"
import { bootstrapPipelines } from "$lib/server/pipelines/boot/bootstrap"
import {
	respondSpec,
	RESPOND_SPEC_ID,
	NARRATE_SPEC_ID
} from "$lib/server/pipelines/specs"

// No embedding model: the keyword mechanism is what every install has on first boot,
// and the selection under test is downstream of which mechanism retrieved anything.
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null
}))

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "score-led-allocation-secret" }
})

const RANK_HYBRID = "core:task/rank-hybrid"

/**
 * The window this fixture is sized against — asserted, not assumed.
 *
 * `contextBudget` derives it from the sampling config the reply is sent under,
 * so a change to the shipped sampling defaults would resize the bands and quietly
 * make the two entries below stop discriminating. §10.1's lesson in one
 * assertion: a green suite is evidence only if the thing under test can still
 * move it.
 */
const BUDGET = 7296
/** worldLore's share of it — 0.1667 — which the big entry has to exceed. */
const WORLD_LORE_BAND = 1216

/**
 * Two entries, sized so the two precedences disagree about which to keep.
 *
 * The world-lore entry scores higher (its author set priority 3, and history
 * declares no `priority` role so it takes no bonus) and is far too large for
 * worldLore's sixth of the window. The history entry scores lower and fits its
 * own band exactly. Together they are larger than the whole window, which is
 * what stops the spillover sweep quietly rescuing both and erasing the
 * difference.
 *
 * Share-first therefore keeps the *lower*-scoring entry and spends 1000 of 7296
 * tokens; score-led keeps the higher-scoring one and spends 6500. That is
 * design §7's argument, on the shipped document rather than in a unit fixture.
 */
const BIG_WORLD_LORE_TOKENS = 6500
const SMALL_HISTORY_TOKENS = 1000

let db: TestDb
let sessionId: number
let userId: number
let respondSpecRow: { id: number }
let narrateSpecRow: { id: number }

beforeAll(async () => {
	process.env.SERENE_PUB_DATA_DIR = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-score-led-")
	)
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	await bootstrapPipelines(db)

	const [user] = await db
		.insert(schema.users)
		.values({ username: "score-led", isAdmin: false })
		.returning()
	userId = user.id

	const [lorebook] = await db
		.insert(schema.lorebooks)
		.values({ name: "Allocation", userId })
		.returning()

	const [session] = await db
		.insert(schema.sessions)
		.values({ userId, isGroup: false, lorebookId: lorebook.id })
		.returning()
	sessionId = session.id

	// `roughTokens` is `ceil(length / 4)` over the content, and the run counts
	// with the tokenizer the host supplies — so the sizes are stated in tokens
	// here and written in characters, rather than approximated.
	await db.insert(schema.lorebookEntries).values(
		worldLoreValues([
			{
				lorebookId: lorebook.id,
				name: "The Ashguard",
				keys: "ashguard",
				content:
					"ashguard " + "x".repeat(BIG_WORLD_LORE_TOKENS * 4 - 10),
				priority: 3
			}
		])
	)
	await db.insert(schema.lorebookEntries).values(
		historyValues([
			{
				lorebookId: lorebook.id,
				name: "The muster at Emberfall",
				keys: "ashguard",
				content:
					"ashguard " + "y".repeat(SMALL_HISTORY_TOKENS * 4 - 10)
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

/** Run the shipped reply spec the way a turn does, and report the ranker. */
const rankNode = async () => {
	const receipt = await run(respondSpec(), {
		input: {
			text: "tell me about the ashguard",
			sessionId,
			characterId: null,
			sessionScope: { sessionId, currentCharacterId: null }
		},
		seed: "seed:score-led",
		bindings: coreBindings(),
		world: await buildWorld(db, {
			sessionId,
			specId: RESPOND_SPEC_ID
		}),
		host: createHost(db, { sessionId, userId }),
		// Stops before the provider, which needs a connection this test has no
		// business supplying. Every node under test runs upstream of it.
		preview: true
	} as any)
	const budget = (receipt.nodes as any[]).find(
		(n) => n.nodeKey === "contextBudget"
	)
	const rank = (receipt.nodes as any[]).find((n) => n.nodeKey === "rank")
	const decisions = ((rank?.output as any)?.decisions ?? []) as any[]
	return {
		budget: (budget?.output as any)?.available?.remaining as number,
		kept: decisions
			.filter((d) => d.included)
			.map((d) => d.candidate.source as string),
		tokens: decisions
			.filter((d) => d.included)
			.reduce((n, d) => n + d.candidate.tokens, 0),
		reasons: Object.fromEntries(
			decisions.map((d) => [d.candidate.source, d.reason])
		) as Record<string, string>,
		why: Object.fromEntries(
			decisions.map((d) => [d.candidate.source, d.why])
		) as Record<string, string>
	}
}

/**
 * The config a run on this session actually resolves to.
 *
 * ⚠ Not the `pipeline-default:` row. `migrateContextTemplates` duplicates the
 * shipped config into a mutable "Default (customized)" and selects that at
 * instance scope, so a fixture writing to the immutable original would change
 * nothing and prove nothing.
 */
/** The one address this file tunes: the ranker's allocation switch. */
const SWITCH_AT = {
	nodeKey: "rank",
	slot: "params",
	path: "scoreLedAllocation"
}

const selectedConfigId = async () => {
	const { resolveSelectedConfig } = await import(
		"$lib/server/pipelines/config/named"
	)
	const selected = await resolveSelectedConfig(
		db,
		respondSpecRow.id,
		RESPOND_SPEC_ID,
		{ sessionId }
	)
	expect(selected, "the reply spec resolves to no configuration").toBeTruthy()
	return selected!.configId
}

const setScoreLed = async (value: boolean) =>
	// ⚠ An upsert, not the `UPDATE` this was. A config stores **deviations**
	// (ruled 2026-09-10), so at an address nobody has tuned there is no row to
	// update — the old form matched nothing and the run resolved the declared
	// default while the failure pointed at the ranker.
	await setConfigValue(db, await selectedConfigId(), SWITCH_AT, value)

describe("the declared switch and the shipped behaviour are one answer", () => {
	it("declares false, so an upgrade selects what it selected yesterday", async () => {
		// Read from the *projected registry row* rather than from a literal,
		// because that row is what the panel renders and what a config
		// back-fills from: a declaration corrected in the contracts package but
		// never re-projected would still ship the old surface.
		const [row] = await db
			.select()
			.from(schema.pipelineDefinitionRegistry)
			.where(
				and(
					eq(schema.pipelineDefinitionRegistry.definitionId, RANK_HYBRID),
					eq(schema.pipelineDefinitionRegistry.version, 1)
				)
			)
			.limit(1)
		expect(
			(row?.slots as any)?.params?.schema?.scoreLedAllocation?.default,
			"the inversion would arrive switched on, on every install that " +
				"upgrades without asking for it"
		).toBe(false)
	})

	it("is not declared on the sibling ranker", async () => {
		// Spread onto `rank-hybrid` alone, like the signal matrix and for the
		// same reason (S3): `rank-by-recency` does not run this selection, and
		// widening a sibling's declared surface is a hash change on a type
		// nobody meant to touch — which would want a re-projection 0196 does
		// not write.
		const [row] = await db
			.select()
			.from(schema.pipelineDefinitionRegistry)
			.where(
				and(
					eq(
						schema.pipelineDefinitionRegistry.definitionId,
						"core:task/rank-by-recency"
					),
					eq(schema.pipelineDefinitionRegistry.version, 1)
				)
			)
			.limit(1)
		expect(
			(row?.slots as any)?.params?.schema?.scoreLedAllocation
		).toBeUndefined()
	})

	it("reaches every config of both ranking pipelines, copies included, without pinning one", async () => {
		// ⚠ **Rewritten for the deviation ruling (2026-09-10), and it now
		// asserts MORE than it did.** The claim was "`reconcileConfigs`
		// back-fills it into every config", checked by finding a row — which
		// was only ever a proxy for what matters: the shipped `false` reaches
		// the config a turn actually reads, not just the immutable row nobody
		// runs (0192's Part 2, in prose).
		//
		// A config stores only what DEPARTS from the declaration now, so the
		// back-fill correctly writes nothing here — `false` IS the declared
		// value — and a row would be a pin that outlives the next correction of
		// it. Both halves are therefore named: no config holds a copy, and
		// every config resolves it anyway.
		const { selectConfig, resolveSelectedConfig } = await import(
			"$lib/server/pipelines/config/named"
		)
		const { resolveConfigSources } = await import("@serene-pub/sdk")

		for (const [spec, slug] of [
			[respondSpecRow, RESPOND_SPEC_ID],
			[narrateSpecRow, NARRATE_SPEC_ID]
		] as const) {
			const configs = await db
				.select()
				.from(schema.pipelineConfigs)
				.where(eq(schema.pipelineConfigs.specId, spec.id))
			expect(configs.length).toBeGreaterThan(0)

			const before = await resolveSelectedConfig(db, spec.id, slug, {})
			try {
				for (const config of configs as any[]) {
					const [row] = await db
						.select()
						.from(schema.pipelineConfigValues)
						.where(
							and(
								eq(
									schema.pipelineConfigValues.configId,
									config.id
								),
								eq(
									schema.pipelineConfigValues.nodeKey,
									SWITCH_AT.nodeKey
								),
								eq(
									schema.pipelineConfigValues.path,
									SWITCH_AT.path
								)
							)
						)
						.limit(1)
					expect(
						row,
						`${config.name} holds a stored copy of the declared ` +
							`allocation switch — it resolves the same today ` +
							`and pins the config to it forever after`
					).toBeUndefined()

					// And it resolves anyway, through the run's own resolver,
					// for THIS config rather than for whichever one happened to
					// be selected — the half a row count never checked.
					await selectConfig(db, spec.id, "instance", 0, config.id)
					const world = await buildWorld(db, { specId: slug })
					const sources: any = resolveConfigSources(world as any, [
						SWITCH_AT.nodeKey
					])
					expect(
						sources?.[SWITCH_AT.nodeKey]?.[SWITCH_AT.slot]?.[
							SWITCH_AT.path
						],
						`${config.name} does not resolve the allocation ` +
							`switch, so the control reaches nothing on a turn`
					).toEqual({ value: false, scopeKind: "author" })
				}
			} finally {
				await selectConfig(
					db,
					spec.id,
					"instance",
					0,
					before?.configId ?? null
				)
			}
		}

		// And nothing was culled on the way: this change only adds an address.
		const culled = await db
			.select()
			.from(schema.pipelineConfigNotices)
			.where(eq(schema.pipelineConfigNotices.kind, "culled"))
		expect(
			(culled as any[]).filter((n) => n.nodeKey === "rank"),
			"the ranker lost an address, which this change does not do"
		).toEqual([])
	}, 60_000)
})

describe("a stored switch reaches the selection", () => {
	it("keeps the lower-scoring entry off, and the higher-scoring one on", async () => {
		const off = await rankNode()

		// The fixture's own premise, asserted so it cannot rot silently: the
		// window is what the entries were sized against.
		expect(
			off.budget,
			"the shipped sampling window moved, so the two entries below are " +
				"no longer sized to disagree — resize them rather than " +
				"relaxing the assertion"
		).toBe(BUDGET)

		// Share-first: worldLore's band is a sixth of the window, the big
		// entry does not fit it, and the two together are larger than the
		// window so the sweep cannot rescue it either. What survives is the
		// entry that scored *less*.
		expect(off.kept).toEqual(["history"])
		expect(off.tokens).toBe(SMALL_HISTORY_TOKENS)
		expect(off.reasons.worldLore).toBe("excluded_token_limit")
		expect(off.why.worldLore).toContain(
			`${WORLD_LORE_BAND} left of ${WORLD_LORE_BAND} for worldLore`
		)
		// The reason that only the inverted branch can produce. Its absence is
		// what says the shipped default really is the shipped code path.
		expect(Object.values(off.reasons)).not.toContain("excluded_share_cap")

		await setScoreLed(true)
		try {
			const on = await rankNode()
			expect(on.budget).toBe(BUDGET)
			// Score-led: the band is a ceiling rather than a pot, the best
			// candidate holds the tokens it needs while it waits, and the
			// sweep hands them over. 6500 of 7296 tokens carry what scored
			// instead of 1000 carrying what did not.
			expect(on.kept).toEqual(["worldLore"])
			expect(on.tokens).toBe(BIG_WORLD_LORE_TOKENS)
			expect(on.reasons.history).toBe("excluded_token_limit")
			// The window ran out, and it says so about the window rather than
			// about the band — the two are different questions with different
			// fixes, which is why score-led splits the reason in two.
			expect(on.why.history).toContain(
				`left of ${BUDGET} across every source`
			)
			expect(on.why.worldLore).toContain(
				`${WORLD_LORE_BAND}-token share`
			)
		} finally {
			await setScoreLed(false)
		}
	}, 60_000)

	it("reads only a real true, not a truthy row", async () => {
		// A config value is JSON off a row. Every reading of `"false"` other
		// than `=== true` turns the inversion **on**, which is the one
		// direction a misread must not go: a default-off control that switches
		// itself on during an upgrade changes what reaches the model on an
		// install that never asked.
		await setConfigValue(
			db,
			await selectedConfigId(),
			SWITCH_AT,
			"false" as any
		)
		try {
			const truthy = await rankNode()
			expect(truthy.kept).toEqual(["history"])
		} finally {
			await setScoreLed(false)
		}
	}, 60_000)
})
