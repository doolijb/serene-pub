/**
 * A graph step's own connection has to arrive with its template too.
 *
 * ## Why this needs its own file
 *
 * There are exactly TWO places in the app that load a connection bound for a
 * text adapter: `resolveCapabilityTarget`, which every reply, summary and
 * out-of-executor step goes through, and this one — a node's own pick, which
 * outranks it. The graph builder reads both (`cfg.connection ?? defaultConnection`
 * in `narrativeGraph.ts`), so a row that arrived by one path carrying a resolved
 * template and by the other carrying only a key would make the build's stop
 * strings depend on whether a step had been configured. That is not a difference
 * anybody would think to look for, and it does not error: the model just does
 * not stop.
 *
 * The connection is written directly at `(configId, nodeKey, "connection",
 * SLOT_VALUE)` rather than through the panel, because what is under test is the
 * READ — `slotAddress.int.test.ts` is the file that pins the address itself.
 */
import { beforeAll, describe, expect, it } from "vitest"
import { and, eq } from "drizzle-orm"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { SLOT_VALUE } from "@serene-pub/sdk"
import { GRAPH_BUILD_SPEC_ID } from "$lib/server/pipelines/specs"
import { resolveGraphStepConfigs } from "$lib/server/pipelines/config/graphSteps"

const CUSTOM_KEY = "graph-step-house-style"

let db: TestDb

beforeAll(async () => {
	db = await createTestDb()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(db)

	const [admin] = await db
		.insert(schema.users)
		.values({ username: "graph-step-admin", isAdmin: true })
		.returning()

	await db.insert(schema.completionTemplates).values({
		key: CUSTOM_KEY,
		name: "Graph Step House Style",
		renderMode: "flat",
		roles: { system: { prefix: "@@sys@@", suffix: "@@/sys@@" } },
		fallbackRole: { prefix: "@@u@@", suffix: "@@/u@@" },
		stopStrings: ["@@stop@@"],
		isSelectable: true
	})

	const [conn] = await db
		.insert(schema.connections)
		.values({
			name: "The perspective step's own model",
			type: "ollama",
			baseUrl: "http://localhost:11434",
			promptFormat: CUSTOM_KEY
		})
		.returning()

	// The shipped config is immutable, so a pick has to land in a copy that is
	// then selected — same dance as `slotAddress.int.test.ts`, for the same
	// reason: without it every write refuses and this file tests nothing.
	const { duplicateConfig, selectConfig } = await import(
		"$lib/server/pipelines/config/named"
	)
	const [spec] = await db
		.select()
		.from(schema.pipelineSpecs)
		.where(eq(schema.pipelineSpecs.slug, GRAPH_BUILD_SPEC_ID))
	const [shipped] = await db
		.select()
		.from(schema.pipelineConfigs)
		.where(
			and(
				eq(schema.pipelineConfigs.specId, spec.id),
				eq(schema.pipelineConfigs.isImmutable, true)
			)
		)
	const copy = await duplicateConfig(
		db,
		shipped.id,
		"Graph step template copy"
	)
	await selectConfig(db, spec.id, "pub", 0, copy.id, admin.id)

	await db.insert(schema.pipelineConfigValues).values({
		configId: copy.id,
		nodeKey: "building.item.perspective",
		slot: "connection",
		path: SLOT_VALUE,
		value: conn.id
	})
}, 60_000)

describe("resolveStepConfigs", () => {
	it("hands the graph builder a connection with its template on it", async () => {
		const steps = await resolveGraphStepConfigs(db)
		const picked = steps.perspective.connection
		expect(
			picked,
			"the perspective step's connection was not read"
		).toBeTruthy()
		expect(picked!.promptFormat).toBe(CUSTOM_KEY)
		// The ROW, not the key. A bare key resolves against the built-ins, and
		// this one names none of them.
		expect(picked!.completionTemplate?.key).toBe(CUSTOM_KEY)
		expect(picked!.completionTemplate?.stopStrings).toEqual(["@@stop@@"])
	}, 60_000)
})
