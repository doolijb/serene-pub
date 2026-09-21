/**
 * A stored spec pinning a definition this build does not run reaches its
 * configurations as a NOTICE, never as a refused boot (plans/29 R-2).
 *
 * The sequence a cull produces, replayed against real rows: a definition is
 * declared and published, a spec placing it is published, then a build that
 * no longer declares it boots — the registry's reverse-diff marks the slug
 * `removed`, and the placed-node reconcile turns the pin into an `unbound`
 * notice on each of the spec's configurations (NOMENCLATURE §6 *cull →
 * notice*). A provisional definition — declared, not bound — takes the same
 * path with its own wording.
 *
 * The definition is declared here under the culled id `core:task/chunk-text@1`
 * so the spec can be compiled and published the way a stored one was; vitest
 * isolates test files, so the registration reaches no other suite.
 */

import { describe, it, expect, beforeAll } from "vitest"
import { and, eq } from "drizzle-orm"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import {
	S,
	allDefinitions,
	compile,
	describeTaskDefinition,
	pin,
	spec
} from "@serene-pub/sdk"
import * as C from "@serene-pub/contracts"
import { saveDocument } from "$lib/server/pipelines/boot/store"
import { syncDefinitionRegistry } from "$lib/server/pipelines/boot/registrySync"
import { ensureDefaultConfig, pendingNotices } from "$lib/server/pipelines/config/named"
import {
	reconcilePlacedNodes,
	UNBOUND_NOTICE_KIND
} from "$lib/server/pipelines/boot/placedNodeReconcile"

let db: TestDb

/** The culled definition, as the build that published the stored spec had it. */
const chunkText = pin(
	describeTaskDefinition({
		id: "core:task/chunk-text@1",
		timeoutMs: 1000,
		ports: { in: { text: S.text }, out: { main: S.json, items: S.json } }
	})
)

const CULLED_SLUG = "test.u6:spec/chunks"
const PROVISIONAL_SLUG = "test.u6:spec/spoken"

beforeAll(async () => {
	db = await createTestDb()
	// The build that published the stored specs: everything, the culled one included.
	await syncDefinitionRegistry(db, allDefinitions(), { release: "before", complete: true })

	const chunks = compile(
		spec(CULLED_SLUG, { version: "1.0.0" })
			.inlet("input", C.userMessage.v1())
			.task("chunks", ($) => chunkText.v1({ text: $.input.text }))
			.build()
	)
	const saved = await saveDocument(db, chunks, { publish: true })
	const [row] = await db
		.select({ id: schema.pipelineSpecs.id })
		.from(schema.pipelineSpecs)
		.where(eq(schema.pipelineSpecs.slug, CULLED_SLUG))
	await ensureDefaultConfig(db, row!.id, saved.specVersionId, CULLED_SLUG)

	// A document placing a provisional definition cannot validate (R-2), so
	// it is stored the way an older version would be: compiled, then the
	// rows written past the publish-time check.
	const spoken = compile(
		spec(PROVISIONAL_SLUG, { version: "1.0.0" })
			.inlet("input", C.userMessage.v1())
			.oracle("audio", ($) => C.speak.v1({ text: $.input.text }))
			.build()
	)
	await expect(saveDocument(db, spoken, { publish: true })).rejects.toThrow(/R-2/)
	const [s2] = await db
		.insert(schema.pipelineSpecs)
		.values({ slug: PROVISIONAL_SLUG, name: "Spoken" })
		.returning({ id: schema.pipelineSpecs.id })
	const [v2] = await db
		.insert(schema.pipelineSpecVersions)
		.values({
			specId: s2!.id,
			semver: "1.0.0",
			status: "published",
			canonicalHash: "u6-spoken"
		})
		.returning({ id: schema.pipelineSpecVersions.id })
	await db
		.update(schema.pipelineSpecs)
		.set({ activeVersionId: v2!.id })
		.where(eq(schema.pipelineSpecs.id, s2!.id))
	for (const n of spoken.nodes)
		await db.insert(schema.pipelineNodes).values({
			specVersionId: v2!.id,
			nodeKey: n.key,
			kind: n.kind,
			definitionId: n.definitionId,
			definitionVersion: n.definitionVersion,
			position: n.position,
			config: n.config
		})
	await ensureDefaultConfig(db, s2!.id, v2!.id, PROVISIONAL_SLUG)
}, 60_000)

const configOf = async (slug: string) => {
	const [spec] = await db
		.select({ id: schema.pipelineSpecs.id })
		.from(schema.pipelineSpecs)
		.where(eq(schema.pipelineSpecs.slug, slug))
	const [config] = await db
		.select({ id: schema.pipelineConfigs.id })
		.from(schema.pipelineConfigs)
		.where(eq(schema.pipelineConfigs.specId, spec!.id))
	return config!.id
}

describe("a placed node this build does not run", () => {
	it("is a notice on the configuration after the cull, and the boot goes on", async () => {
		// Nothing to say while the definition is published and bound-or-not:
		// `chunk-text` is live in the registry, so the reconcile is silent
		// about it — only the provisional placement is reported.
		const before = await reconcilePlacedNodes(db)
		expect(before.unbound).toEqual([`audio@${PROVISIONAL_SLUG}`])

		// The next build no longer publishes it.
		const culled = await syncDefinitionRegistry(
			db,
			allDefinitions().filter((d) => d.id !== "core:task/chunk-text@1"),
			{ release: "after", complete: true }
		)
		expect(culled.removed).toEqual(["core:task/chunk-text@1"])

		const report = await reconcilePlacedNodes(db)
		expect(report.errors).toEqual([])
		expect(report.unbound.sort()).toEqual(
			[`chunks@${CULLED_SLUG}`, `audio@${PROVISIONAL_SLUG}`].sort()
		)

		const notices = await pendingNotices(db, await configOf(CULLED_SLUG))
		const unbound = notices.filter((n) => n.kind === UNBOUND_NOTICE_KIND)
		expect(unbound).toHaveLength(1)
		expect(unbound[0]!.nodeKey).toBe("chunks")
		expect(unbound[0]!.label).toMatch(/'chunks' places core:task\/chunk-text@1/)
		expect(unbound[0]!.label).toMatch(/not published by this build/)
		expect(unbound[0]!.previousValue).toEqual({
			definitionId: "core:task/chunk-text",
			version: 1,
			status: "removed"
		})
	})

	it("a provisional placement is noticed with its own words", async () => {
		const notices = await pendingNotices(db, await configOf(PROVISIONAL_SLUG))
		const unbound = notices.filter((n) => n.kind === UNBOUND_NOTICE_KIND)
		expect(unbound).toHaveLength(1)
		expect(unbound[0]!.nodeKey).toBe("audio")
		expect(unbound[0]!.label).toMatch(/core:oracle\/speak@1/)
		expect(unbound[0]!.label).toMatch(/declared, not bound/)
	})

	it("is idempotent — the next boot writes nothing new", async () => {
		const again = await reconcilePlacedNodes(db)
		expect(again.noticed).toBe(0)
		expect(again.cleared).toBe(0)
		expect(again.unbound.length).toBe(2)
		const rows = await db
			.select({ id: schema.pipelineConfigNotices.id })
			.from(schema.pipelineConfigNotices)
			.where(
				and(
					eq(schema.pipelineConfigNotices.configId, await configOf(CULLED_SLUG)),
					eq(schema.pipelineConfigNotices.kind, UNBOUND_NOTICE_KIND)
				)
			)
		expect(rows).toHaveLength(1)
	})
})

describe("a placed node that runs again", () => {
	it("loses its notice — a condition, not news", async () => {
		// The build publishes `chunk-text` again: the registry's reverse-diff
		// brings the row back live, and the next reconcile deletes the
		// notice rather than leaving a person to dismiss a warning about a
		// pipeline that runs. The provisional placement keeps its notice.
		const restored = await syncDefinitionRegistry(db, allDefinitions(), {
			release: "after-restore",
			complete: true
		})
		expect(restored.removed).toEqual([])
		const report = await reconcilePlacedNodes(db)
		expect(report.errors).toEqual([])
		expect(report.cleared).toBe(1)
		expect(report.unbound).toEqual([`audio@${PROVISIONAL_SLUG}`])

		const gone = await pendingNotices(db, await configOf(CULLED_SLUG))
		expect(gone.filter((n) => n.kind === UNBOUND_NOTICE_KIND)).toEqual([])
		const kept = await pendingNotices(db, await configOf(PROVISIONAL_SLUG))
		expect(kept.filter((n) => n.kind === UNBOUND_NOTICE_KIND)).toHaveLength(1)

		// Culled once more: the notice returns, once.
		await syncDefinitionRegistry(
			db,
			allDefinitions().filter((d) => d.id !== "core:task/chunk-text@1"),
			{ release: "after-again", complete: true }
		)
		const back = await reconcilePlacedNodes(db)
		expect(back.noticed).toBe(1)
		expect(back.cleared).toBe(0)
	})
})
