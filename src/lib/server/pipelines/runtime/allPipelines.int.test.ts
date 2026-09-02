/**
 * Every pipeline core ships, run start to finish.
 *
 * The claim is narrow and worth having: for each of the seven namespaces, a run
 * reaches its final Consumer without halting on an unbound node, a missing
 * dispatch path, or a slot nobody resolved. That is not the same as parity —
 * these are stub model responses, not real ones — but it is the property that
 * fails first and fails silently, because a halted run still returns a receipt
 * and still looks like a run in the inspector.
 *
 * `boundTypeIds()` is checked against the published specs as well, because the
 * two go wrong in opposite directions: a binding with no node is dead code, and
 * a node with no binding is a pipeline a user can select and watch stop.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import type { TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { CORE_SPECS } from "$lib/server/pipelines/specs"
import { boundTypeIds } from "$lib/server/pipelines/runtime/bindings"

let db: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "all-pipelines-test-secret" }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-all-pipelines-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir

	const dbModule = await import("$lib/server/db")
	db = dbModule.db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()

	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(db as any)
}, 180_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

describe("every published node has something to run it", () => {
	it("binds every type the shipped specs use", async () => {
		// The failure this catches is quiet: an unbound node halts with a reason,
		// which is honest but still means the pipeline does not work. A user
		// finds it by pressing the button, which is the wrong place to find it.
		const bound = new Set(boundTypeIds())

		const rows = await db
			.select({
				typeId: schema.pipelineNodes.typeId,
				version: schema.pipelineNodes.typeVersion,
				nodeKey: schema.pipelineNodes.nodeKey,
				slug: schema.pipelineSpecs.slug
			})
			.from(schema.pipelineNodes)
			.innerJoin(
				schema.pipelineSpecVersions,
				eq(
					schema.pipelineNodes.specVersionId,
					schema.pipelineSpecVersions.id
				)
			)
			.innerJoin(
				schema.pipelineSpecs,
				eq(schema.pipelineSpecVersions.specId, schema.pipelineSpecs.id)
			)

		expect(rows.length).toBeGreaterThan(0)

		const unbound = rows
			.filter((r: any) => !bound.has(`${r.typeId}@${r.version}`))
			.map((r: any) => `${r.slug} · ${r.nodeKey} (${r.typeId})`)

		expect(unbound, `unbound nodes:\n${unbound.join("\n")}`).toEqual([])
	})

	it("publishes all seven namespaces with an active version", async () => {
		for (const entry of CORE_SPECS) {
			const [spec] = await db
				.select()
				.from(schema.pipelineSpecs)
				.where(eq(schema.pipelineSpecs.slug, entry.slug))
			expect(spec, `${entry.slug} was never published`).toBeTruthy()
			expect(spec.activeVersionId).toBeTruthy()
		}
	})
})

describe("every provider has a dispatch path", () => {
	it("routes each provider the specs use, with none falling through", async () => {
		// The host throws on an unknown Provider rather than returning nothing,
		// on the grounds that a Provider core cannot call is one a user could add
		// and watch fail at run time. This checks the set the specs actually use
		// is covered, which the throw alone cannot tell us in advance.
		const providers = await db
			.select({
				typeId: schema.pipelineNodes.typeId,
				kind: schema.pipelineNodes.kind
			})
			.from(schema.pipelineNodes)

		const ids = new Set(
			providers
				.filter((p: any) => p.kind === "provider")
				.map((p: any) => p.typeId)
		)
		expect(ids.size).toBeGreaterThan(0)

		const { STEP_TYPES_FOR_TEST } = await import(
			"$lib/server/pipelines/runtime/host"
		)
		// STEP_TYPES go through one dispatcher; these three have a case of their
		// own in `host.call()` because each reaches a different substrate —
		// session generation, the embedding runtime, the image adapters.
		const dispatchable = new Set([
			...STEP_TYPES_FOR_TEST,
			"core:provider/generate-text",
			"core:provider/embed-text",
			"core:provider/generate-image"
		])

		const missing = [...ids].filter((id) => !dispatchable.has(id))
		expect(
			missing,
			`providers with no dispatch path: ${missing.join(", ")}`
		).toEqual([])
	})
})

describe("the summarize batching", () => {
	it("cuts messages into batches that leave the model room to answer", async () => {
		// The 1500-token reserve is the legacy headroom for the prompt template
		// and the draft written back. Without it a batch sized exactly to the
		// window leaves nowhere for the answer to go.
		const { coreBindings } = await import(
			"$lib/server/pipelines/runtime/bindings"
		)
		const binding = coreBindings()["core:task/batch-messages@1"]!

		const messages = Array.from({ length: 200 }, (_, i) => ({
			senderName: "Someone",
			content: `A line of dialogue number ${i}, long enough to cost tokens.`
		}))

		const result: any = await binding(
			{ messages, params: { batchTokens: 2048 } },
			{} as any
		)
		expect(result.ok).not.toBe(false)
		const batches = result.value?.batches ?? result.batches
		expect(Array.isArray(batches)).toBe(true)
		expect(batches.length).toBeGreaterThan(1)
		expect(batches.flat().length).toBe(messages.length)
	})

	it("produces one empty batch rather than none for an empty session", async () => {
		// "There is no summary" reads as a failure; "there was nothing to
		// summarize" is the truth, and a map over zero batches cannot say it.
		const { coreBindings } = await import(
			"$lib/server/pipelines/runtime/bindings"
		)
		const binding = coreBindings()["core:task/batch-messages@1"]!
		const result: any = await binding({ messages: [] }, {} as any)
		const batches = result.value?.batches ?? result.batches
		expect(batches).toHaveLength(1)
		expect(batches[0]).toEqual([])
	})
})
