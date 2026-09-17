/**
 * The R-12 culls reach a stored configuration as NOTICES, not orphan rows.
 *
 * U2 (plans/30) culled addresses a person could have set through the panel
 * and that no run ever read: `assemble@2`'s `params.truncation` and the
 * `prompts` slot on the three generating oracles (plus `rank-semantic@1`'s two
 * window params, on a node no shipped spec places). A declaration change needs
 * no migration (ruling 2026-09-10) — the registry republishes under a new hash
 * and the slug's pointer moves — but a `pipeline_config_values` row addressing
 * a control the version does not declare is not nothing: kept, it resolves to nothing
 * and looks like corruption; dropped silently, the pipeline changed for no
 * reason anyone was told.
 *
 * `reconcileConfigs` (config/named.ts) is the existing seam: a value whose
 * address the active version does not declare is culled **with a notice**
 * carrying the label the older declaration gave it and the value it held
 * (NOMENCLATURE §6 *cull → notice*). This file proves the culled addresses take
 * that path — planted on a config, reconciled, found as notices — rather than
 * assuming a cull anywhere is a cull here.
 */

import { describe, it, expect, beforeAll, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import type { TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { bootstrapPipelines } from "$lib/server/pipelines/boot/bootstrap"
import { declarations } from "$lib/server/pipelines/config/panel/declarations"
import {
	pendingNotices,
	reconcileConfigs
} from "$lib/server/pipelines/config/named"
import { RESPOND_SPEC_ID } from "$lib/server/pipelines/specs"

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "declared-reads-cull-secret" }
})

let db: TestDb
let spec: { id: number; activeVersionId: number }
/** `definitionId → nodeKey`, read off the published document rather than written here. */
let nodeOf: Map<string, string>
let configId: number

/**
 * The culled addresses, planted as if a person had set each control.
 *
 * `rank-semantic@1`'s two culled params are not here: no shipped spec places
 * that node, so no panel ever rendered them and no config can hold them.
 */
const PLANTED = [
	{
		definitionId: "core:task/assemble",
		slot: "params",
		path: "truncation",
		value: "lowest-weight"
	},
	{
		definitionId: "core:oracle/generate-text",
		slot: "prompts",
		path: "system",
		value: "Be terse."
	}
] as const

beforeAll(async () => {
	process.env.SERENE_PUB_DATA_DIR = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-declared-reads-cull-")
	)
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	await bootstrapPipelines(db)

	spec = (
		await db
			.select({
				id: schema.pipelineSpecs.id,
				activeVersionId: schema.pipelineSpecs.activeVersionId
			})
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, RESPOND_SPEC_ID))
			.limit(1)
	)[0] as any

	const nodes = (await db
		.select({
			nodeKey: schema.pipelineNodes.nodeKey,
			definitionId: schema.pipelineNodes.definitionId
		})
		.from(schema.pipelineNodes)
		.where(
			eq(schema.pipelineNodes.specVersionId, spec.activeVersionId)
		)) as Array<{
		nodeKey: string
		definitionId: string
	}>
	nodeOf = new Map()
	for (const n of nodes)
		if (!nodeOf.has(n.definitionId)) nodeOf.set(n.definitionId, n.nodeKey)
	for (const p of PLANTED)
		expect(
			nodeOf.get(p.definitionId),
			`the reply pipeline has no \`${p.definitionId}\` node, so this file plants nothing`
		).toBeTruthy()

	const [config] = await db
		.insert(schema.pipelineConfigs)
		.values({ specId: spec.id, name: "Tuned before the culls" })
		.returning()
	configId = config.id
	await db.insert(schema.pipelineConfigValues).values(
		PLANTED.map((p) => ({
			configId,
			nodeKey: nodeOf.get(p.definitionId)!,
			slot: p.slot,
			path: p.path,
			value: p.value as any
		}))
	)
}, 120_000)

describe("the culled addresses are not declared", () => {
	it("none of the planted addresses is a control the active version declares", async () => {
		const decls = await declarations(db, spec.activeVersionId)
		for (const p of PLANTED) {
			const nodeKey = nodeOf.get(p.definitionId)!
			expect(
				decls.some(
					(d) =>
						d.nodeKey === nodeKey &&
						d.slot === p.slot &&
						d.path === p.path
				),
				`${p.definitionId} ${p.slot}.${p.path} is still declared — the panel still renders it`
			).toBe(false)
		}
	})
})

describe("reconciling a configuration that held them", () => {
	it("culls every planted value with a notice that names it and keeps what it held", async () => {
		await reconcileConfigs(
			db,
			spec.id,
			spec.activeVersionId,
			RESPOND_SPEC_ID
		)
		const notices = (await pendingNotices(db, configId)) as Array<{
			kind: string
			nodeKey: string
			slot: string
			path: string
			label: string | null
			previousValue: unknown
		}>
		const culled = notices.filter((n) => n.kind === "culled")
		for (const p of PLANTED) {
			const nodeKey = nodeOf.get(p.definitionId)!
			const notice = culled.find(
				(n) =>
					n.nodeKey === nodeKey &&
					n.slot === p.slot &&
					n.path === p.path
			)
			expect(
				notice,
				`no cull notice for ${p.definitionId} ${p.slot}.${p.path}`
			).toBeTruthy()
			expect(notice!.previousValue).toEqual(p.value)
			// A notice that cannot say what was lost is barely better than
			// silence: the label is the older declaration's, or the address
			// humanised, never empty.
			expect(
				notice!.label,
				`${p.slot}.${p.path} arrived nameless`
			).toBeTruthy()
		}
	}, 60_000)

	it("leaves no orphan row behind", async () => {
		const rows = (await db
			.select()
			.from(schema.pipelineConfigValues)
			.where(
				eq(schema.pipelineConfigValues.configId, configId)
			)) as Array<{
			nodeKey: string
			slot: string
			path: string | null
		}>
		for (const p of PLANTED)
			expect(
				rows.some(
					(r) =>
						r.nodeKey === nodeOf.get(p.definitionId) &&
						r.slot === p.slot &&
						r.path === p.path
				),
				`${p.definitionId} ${p.slot}.${p.path} is still stored after the cull`
			).toBe(false)
	})
})
