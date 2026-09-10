/**
 * The transcript window, from the stored row to the query — through the
 * executor.
 *
 * ⚠ This exists because nothing could see the defect it covers. `limit` is a
 * declared parameter of `core:query/session-history@1`: the panel rendered it,
 * validated it, saved it, and `reconcileConfigs` back-filled the declared
 * default into `pipeline_config_values` on every install. It reached nothing,
 * twice over —
 *
 *   1. the binding read `input.limit`, and a declared parameter arrives at
 *      `input.params.limit`; and
 *   2. no shipped spec named the `params` slot on its `history` node, and
 *      `resolveInput` resolves only the slots a node's config already names, so
 *      `input.params` was `undefined` regardless.
 *
 * Either break alone is enough to make the control dead, which is why a test
 * that starts at the binding's arguments cannot cover this: it would have to
 * fake the very thing that was missing. So this starts where a person's edit
 * starts — a row in the database — and ends at how many messages the query
 * actually returned. The executor is in the middle on purpose.
 *
 * Same lesson, same shape as `loreScanDepth.int.test.ts`, which was written for
 * this defect's older twin on the three lore lanes.
 */

import { describe, it, expect, beforeAll, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import type { TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { run } from "@serene-pub/sdk"
import { coreBindings } from "$lib/server/pipelines/runtime/bindings"
import { createHost } from "$lib/server/pipelines/runtime/host"
import { buildWorld } from "$lib/server/pipelines/config/world"
import { bootstrapPipelines } from "$lib/server/pipelines/boot/bootstrap"
import {
	respondSpec,
	RESPOND_SPEC_ID,
	narrateSpec,
	NARRATE_SPEC_ID
} from "$lib/server/pipelines/specs"

// No embedding model: the retrieval mechanisms downstream of `history` stay on
// the keyword path, which needs no network. Nothing here asserts on them — this
// is only so the run reaches the end of the gather block.
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null
}))

// The db module is mocked so `defaults.sync()` and `bootstrapPipelines` run
// against the test database, in the order `db/index.ts` guarantees at boot.
vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "session-history-limit-secret" }
})

let db: TestDb
let sessionId: number
let userId: number
let respondSpecRow: { id: number }
let narrateSpecRow: { id: number }

/**
 * More messages than the narrowed window and fewer than the declared one, so a
 * single session distinguishes all three answers: 8 back is "the control did
 * nothing", 3 back is "it was read", and anything else is a third bug.
 */
const MESSAGE_COUNT = 8
const NARROWED = 3

/** Where the control lives in each shipped document. */
const HISTORY_NODE = {
	[RESPOND_SPEC_ID]: "gather.history.read",
	[NARRATE_SPEC_ID]: "history"
} as const

beforeAll(async () => {
	process.env.SERENE_PUB_DATA_DIR = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-history-limit-")
	)
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	await bootstrapPipelines(db)

	const [user] = await db
		.insert(schema.users)
		.values({ username: "window", isAdmin: false })
		.returning()
	userId = user.id

	const [session] = await db
		.insert(schema.sessions)
		.values({ userId, isGroup: false })
		.returning()
	sessionId = session.id

	for (let i = 0; i < MESSAGE_COUNT; i++)
		await db.insert(schema.sessionMessages).values({
			sessionId,
			role: i % 2 === 0 ? "user" : "assistant",
			content: `message ${i}`
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
 * executor — and report how many messages the history node returned.
 *
 * `preview` stops before the provider, which needs a connection this test has
 * no business supplying; the node under test runs upstream of it.
 */
const historyLengthOn = async (
	doc: any,
	specId: string
): Promise<number | undefined> => {
	const receipt = await run(doc, {
		input: {
			text: "and then?",
			sessionId,
			characterId: null,
			sessionScope: { sessionId, currentCharacterId: null }
		},
		seed: "seed:window",
		bindings: coreBindings(),
		world: await buildWorld(db, { sessionId, specId }),
		host: createHost(db, { sessionId, userId }),
		preview: true
	} as any)

	const node = (receipt.nodes as any[]).find(
		(n) => n.nodeKey === HISTORY_NODE[specId as keyof typeof HISTORY_NODE]
	)
	expect(node, `${specId} has no history node in its receipt`).toBeTruthy()
	return (node.output?.messages as unknown[] | undefined)?.length
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
	const selected = await resolveSelectedConfig(db, specId, slug, {
		sessionId
	})
	expect(selected, `${slug} resolves to no configuration`).toBeTruthy()
	return selected!.configId
}

const setLimit = async (slug: string, specId: number, value: number) =>
	await db
		.update(schema.pipelineConfigValues)
		.set({ value })
		.where(
			and(
				eq(
					schema.pipelineConfigValues.configId,
					await selectedConfigId(slug, specId)
				),
				eq(
					schema.pipelineConfigValues.nodeKey,
					HISTORY_NODE[slug as keyof typeof HISTORY_NODE]
				),
				eq(schema.pipelineConfigValues.slot, "params"),
				eq(schema.pipelineConfigValues.path, "limit")
			)
		)

describe("the session history window reaches the query", () => {
	// A liveness check, not the wiring guard — say so, because a shipped value
	// well above the corpus is exactly what let the dead control hide. An
	// unwired node returns all 8 here too; the next test is the one that fails.
	it("both pipelines run and return the whole conversation at the shipped window", async () => {
		expect(await historyLengthOn(respondSpec(), RESPOND_SPEC_ID)).toBe(
			MESSAGE_COUNT
		)
		expect(await historyLengthOn(narrateSpec(), NARRATE_SPEC_ID)).toBe(
			MESSAGE_COUNT
		)
	}, 60_000)

	it("a configured window narrows the reply pipeline's read, and only it", async () => {
		// The assertion neither half of the defect could fail: the binding read
		// a key nothing supplies, and the slot carrying the number was never
		// resolved, so this came back as all 8 whatever was stored.
		await setLimit(RESPOND_SPEC_ID, respondSpecRow.id, NARROWED)
		try {
			expect(await historyLengthOn(respondSpec(), RESPOND_SPEC_ID)).toBe(
				NARROWED
			)
			// Each pipeline owns its own row. One spec's number reaching the
			// other would be the same defect wearing the opposite sign.
			expect(await historyLengthOn(narrateSpec(), NARRATE_SPEC_ID)).toBe(
				MESSAGE_COUNT
			)
		} finally {
			await setLimit(RESPOND_SPEC_ID, respondSpecRow.id, 100)
		}
	}, 60_000)

	it("a configured window narrows the narrator's read", async () => {
		// The narrator's history node is keyed `history`, not
		// `gather.history.read`, and it was missing the same wiring — asserted
		// separately because a fix applied to one document and not the other is
		// exactly what this subsystem has shipped twice before.
		await setLimit(NARRATE_SPEC_ID, narrateSpecRow.id, NARROWED)
		try {
			expect(await historyLengthOn(narrateSpec(), NARRATE_SPEC_ID)).toBe(
				NARROWED
			)
		} finally {
			await setLimit(NARRATE_SPEC_ID, narrateSpecRow.id, 100)
		}
	}, 60_000)
})
