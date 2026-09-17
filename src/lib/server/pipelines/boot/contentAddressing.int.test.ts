/**
 * A slug is an indirection to a content hash (ruling 2026-09-10).
 *
 * Before this, publishing was identity-keyed and both halves failed on the
 * upgrade path — the one no test database can reach, because a fresh database
 * has nothing to conflict with:
 *
 *  · a **type** whose declaration moved under an unchanged `id@version` threw
 *    `TypeRegistryConflictError`; `bootstrapPipelines` caught it and returned
 *    early, so every pipeline on the install stopped;
 *  · a **spec** whose document moved under an unchanged semver was *skipped* by
 *    seeding, so the install kept running the old document while the code said
 *    otherwise, and nothing anywhere reported it.
 *
 * The escape from both was a re-projection migration deleting rows so the next
 * boot could rewrite them — eight of them by 0115, one per edit.
 *
 * What replaces it: the rows are keyed by content hash, the slug points at the
 * current one, and publishing a changed declaration inserts a row and moves the
 * pointer. This file is the check that the pointer moves and that the row it
 * moved off is still there — the second half being what keeps an old receipt
 * meaningful.
 */

import { describe, it, expect, beforeAll } from "vitest"
import { and, asc, desc, eq } from "drizzle-orm"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import {
	syncDefinitionRegistry,
	definitionContentHash
} from "$lib/server/pipelines/boot/registrySync"
import { saveDocument } from "$lib/server/pipelines/boot/store"
import {
	S,
	spec,
	slot,
	compile,
	canonicalHash,
	snapshotRegistry,
	allDefinitions,
	allScriptKinds,
	type Descriptor
} from "@serene-pub/sdk"
import * as C from "@serene-pub/contracts"
import * as schema from "$lib/server/db/schema"

let db: TestDb

beforeAll(async () => {
	db = await createTestDb({ skipEntryTypes: true })
}, 60_000)

/**
 * A plain object rather than `describeTaskDefinition`, for the reason
 * `registrySync.int.test.ts` gives: a type id may only be registered once per
 * process (F5), and what these tests simulate is core's *next build*, not a
 * second declaration in this one.
 */
const chunkText = (outPorts: Record<string, unknown>): Descriptor =>
	({
		kind: "task",
		id: "chariot.demo:chunk-text@1",
		timeoutMs: 1000,
		ports: { in: { text: S.text }, out: outPorts }
	}) as unknown as Descriptor

const registryRows = async (definitionId: string) =>
	await db
		.select()
		.from(schema.pipelineDefinitionRegistry)
		.where(eq(schema.pipelineDefinitionRegistry.definitionId, definitionId))

const declarationRows = async (definitionId: string) =>
	await db
		.select()
		.from(schema.pipelineDefinitionDeclarations)
		.where(eq(schema.pipelineDefinitionDeclarations.definitionId, definitionId))
		.orderBy(asc(schema.pipelineDefinitionDeclarations.id))

describe("types: the slug points, the archive keeps", () => {
	it("publishes a changed declaration instead of refusing it", async () => {
		await syncDefinitionRegistry(db, [chunkText({ main: S.json })], {
			release: "test"
		})
		const [before] = await registryRows("chariot.demo:chunk-text")
		expect(before.contentHash).toBeTruthy()

		// The edit that used to stop the boot: a new out-port under the same pin.
		const result = await syncDefinitionRegistry(
			db,
			[chunkText({ main: S.json, chunks: S.json })],
			{ release: "test" }
		)

		expect(result.republished).toEqual(["chariot.demo:chunk-text@1"])

		const [after] = await registryRows("chariot.demo:chunk-text")
		expect(
			after.contentHash,
			"the slug still resolves to the declaration it did before the edit"
		).not.toBe(before.contentHash)
		expect(
			(after.ports as any).out.chunks,
			"the row readers query must carry the current declaration"
		).toBeTruthy()
	})

	it("keeps the declaration a superseded hash names", async () => {
		// The half that makes an old receipt worth keeping: the hash it pinned
		// still resolves to what was declared at the time.
		const [before] = await registryRows("chariot.demo:chunk-text")
		const archive = await declarationRows("chariot.demo:chunk-text")

		expect(
			archive.length,
			"one row per declaration this slug has resolved to"
		).toBe(2)
		expect(archive.map((r: any) => r.contentHash)).toContain(
			before.contentHash
		)

		const superseded = archive.find(
			(r: any) => r.contentHash !== before.contentHash
		)! as any
		expect(
			(superseded.entry as any).ports.out.chunks,
			"the superseded declaration is the one without the new port"
		).toBeUndefined()
	})

	it("re-declaring the same content writes nothing", async () => {
		const before = await declarationRows("chariot.demo:chunk-text")
		const again = await syncDefinitionRegistry(
			db,
			[chunkText({ main: S.json, chunks: S.json })],
			{ release: "test" }
		)
		expect(again.republished).toEqual([])
		expect(again.inserted).toEqual([])
		expect(await declarationRows("chariot.demo:chunk-text")).toHaveLength(
			before.length
		)
	})

	it("adopts a registry row written before the archive existed", async () => {
		// The migration path. There is no SQL that can compute this hash, so the
		// first boot after 0119 adopts each existing row from the row itself —
		// which is possible because the registry round trip is lossless.
		await db
			.delete(schema.pipelineDefinitionDeclarations)
			.where(
				eq(
					schema.pipelineDefinitionDeclarations.definitionId,
					"chariot.demo:chunk-text"
				)
			)
		const [row] = await registryRows("chariot.demo:chunk-text")

		await syncDefinitionRegistry(
			db,
			[chunkText({ main: S.json, chunks: S.json })],
			{ release: "test" }
		)

		const archive = await declarationRows("chariot.demo:chunk-text")
		const adopted = archive.find(
			(r: any) => r.contentHash === row.contentHash
		)! as any
		expect(
			adopted,
			"the row's own hash is adopted, never recomputed"
		).toBeTruthy()
		expect(adopted.source).toBe("adopted")
	})
})

const demoSpec = (nodes: "one" | "two") =>
	compile(
		(nodes === "one"
			? spec("chariot.demo:reply", { version: "1.0.0" }).inlet(
					"input",
					C.userMessage.v1()
				)
			: spec("chariot.demo:reply", { version: "1.0.0" })
					.inlet("input", C.userMessage.v1())
					.query("history", ($) =>
						C.sessionHistory.v1({ scope: $.input.sessionScope })
					)
		).build()
	)

const versionsOf = async (slug: string) =>
	await db
		.select({
			id: schema.pipelineSpecVersions.id,
			semver: schema.pipelineSpecVersions.semver,
			status: schema.pipelineSpecVersions.status,
			canonicalHash: schema.pipelineSpecVersions.canonicalHash
		})
		.from(schema.pipelineSpecVersions)
		.innerJoin(
			schema.pipelineSpecs,
			eq(schema.pipelineSpecVersions.specId, schema.pipelineSpecs.id)
		)
		.where(eq(schema.pipelineSpecs.slug, slug))
		.orderBy(asc(schema.pipelineSpecVersions.id))

const specRow = async (slug: string) =>
	(
		await db
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, slug))
			.limit(1)
	)[0]

describe("specs: an edit under an unchanged semver publishes", () => {
	it("lands as a new version row and moves the active pointer", async () => {
		const first = await saveDocument(db, demoSpec("one"), {
			publish: true,
			name: "Demo"
		})
		expect((await specRow("chariot.demo:reply")).activeVersionId).toBe(
			first.specVersionId
		)

		const second = await saveDocument(db, demoSpec("two"), {
			publish: true,
			name: "Demo"
		})
		expect(
			second.specVersionId,
			"an edited document must not overwrite the row a receipt named"
		).not.toBe(first.specVersionId)
		expect(second.canonicalHash).not.toBe(first.canonicalHash)
		expect((await specRow("chariot.demo:reply")).activeVersionId).toBe(
			second.specVersionId
		)
	})

	it("retires the version it moved off, so one row per slug is published", async () => {
		const rows = await versionsOf("chariot.demo:reply")
		expect(rows).toHaveLength(2)
		expect(rows.map((r) => r.status)).toEqual(["retired", "published"])
		// Every reader asking for `status = 'published'` still gets one row.
		expect(rows.filter((r) => r.status === "published")).toHaveLength(1)
	})

	it("re-saving the same document is idempotent", async () => {
		const before = await versionsOf("chariot.demo:reply")
		const again = await saveDocument(db, demoSpec("two"), {
			publish: true,
			name: "Demo"
		})
		expect(again.canonicalHash).toBe(canonicalHash(demoSpec("two")))
		expect(await versionsOf("chariot.demo:reply")).toHaveLength(
			before.length
		)
	})
})

/**
 * The database half of `registryHashes.test.ts` and `specHashes.test.ts`.
 *
 * Those two record what this build's slugs hash to; this asserts that after a
 * boot the ROWS say the same thing — **on an install whose rows were seeded by a
 * different build**, which is the only arrangement where the two can disagree
 * and the one no fresh test database reproduces on its own. Tampering with every
 * stored hash is what stands in for that install.
 */
describe("a boot brings every shipped slug onto this build's declaration", () => {
	it("republishes tampered rows and archives what they held", async () => {
		const fresh = await createTestDb()
		const { bootstrapPipelines } = await import(
			"$lib/server/pipelines/boot/bootstrap"
		)
		await bootstrapPipelines(fresh)

		// Every row, as an install seeded by the previous build would look
		// after any declaration in it moved.
		await fresh
			.update(schema.pipelineDefinitionRegistry)
			.set({ contentHash: "from-the-previous-build" })

		const report = await bootstrapPipelines(fresh)
		expect(report.types.republished.length).toBeGreaterThan(20)

		const declared = new Map(
			snapshotRegistry([...allDefinitions(), ...allScriptKinds()], {
				release: "test"
			}).map((e) => [`${e.id}@${e.version}`, definitionContentHash(e)])
		)
		const rows = await fresh.select().from(schema.pipelineDefinitionRegistry)
		const wrong = (rows as any[])
			.filter((r) => declared.has(`${r.definitionId}@${r.version}`))
			.filter(
				(r) =>
					r.contentHash !== declared.get(`${r.definitionId}@${r.version}`)
			)
			.map((r) => `${r.definitionId}@${r.version}`)
		expect(
			wrong,
			"a slug this build declares must resolve to this build's declaration"
		).toEqual([])

		// And what they held is kept, which is what makes the move safe to do
		// unattended.
		const archived = await fresh
			.select()
			.from(schema.pipelineDefinitionDeclarations)
			.where(
				eq(
					schema.pipelineDefinitionDeclarations.contentHash,
					"from-the-previous-build"
				)
			)
		expect(archived.length).toBe(rows.length)
	}, 60_000)
})

describe("receipts pin the document they ran", () => {
	it("records the hash, resolved from the slug when the caller names none", async () => {
		const { saveReceipt } = await import(
			"$lib/server/pipelines/runtime/receipts"
		)
		const active = (await versionsOf("chariot.demo:reply")).find(
			(r) => r.status === "published"
		)!

		await saveReceipt(
			db,
			{
				runId: "content-addressing:1",
				specId: "chariot.demo:reply",
				specVersion: "1.0.0",
				outcome: "ok",
				triggerSource: "event",
				seed: "s",
				startedAt: 0,
				endedAt: 1,
				nodes: []
			} as any,
			{}
		)

		const [run] = await db
			.select()
			.from(schema.pipelineRuns)
			.where(eq(schema.pipelineRuns.runId, "content-addressing:1"))
		expect(run.specHash).toBe(active.canonicalHash)
		expect(
			run.specVersionId,
			"the version row too — nothing had ever populated it"
		).toBe(active.id)
	})
})
