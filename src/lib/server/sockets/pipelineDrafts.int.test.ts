/**
 * The pipeline editor's server half (PLAN-pipeline-canvas-and-genre-authoring
 * §4.1–§4.2): drafts, preview, publish, catalogue and fork.
 *
 * Driven straight through the handlers against a bootstrapped PGlite, the way
 * `pipelines.document.int.test.ts` is.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { STORY_RESPOND_SPEC_ID } from "@serene-pub/core-catalog"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "socket-drafts-test-secret" }
})

let stranger: { id: number }
let admin: { id: number }

const FORK = "acme.lab:spec/reply-copy"

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-pipeline-drafts-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(testDb as any)
	const { createTestUser } = await import("$lib/server/utils/testDb")
	stranger = await createTestUser(testDb, "drafts-stranger")
	admin = await createTestUser(testDb, "drafts-admin")
	await testDb
		.update(schema.users)
		.set({ isAdmin: true })
		.where(eq(schema.users.id, admin.id))
}, 120_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const socketFor = (userId: number, isAdmin = false) =>
	({
		user: { id: userId, isAdmin },
		io: { to: () => ({ emit: () => {} }) }
	}) as any

function recordingEmit() {
	const seen: Array<[string, any]> = []
	const emit = (event: string, data: any) => seen.push([event, data])
	return {
		emit,
		seen,
		last: (e: string) => seen.filter(([k]) => k === e).at(-1)?.[1]
	}
}

const asAdmin = () => socketFor(admin.id, true)

async function specRow(slug: string) {
	const [spec] = await testDb
		.select()
		.from(schema.pipelineSpecs)
		.where(eq(schema.pipelineSpecs.slug, slug))
		.limit(1)
	return spec
}

describe("admin gate", () => {
	test("every event refuses a non-admin on its :error twin", async () => {
		const m = await import("./pipelineDrafts")
		const cases: Array<[any, any]> = [
			[m.pipelinesDraftGet, { slug: STORY_RESPOND_SPEC_ID }],
			[m.pipelinesDraftPut, { slug: STORY_RESPOND_SPEC_ID, document: {} }],
			[m.pipelinesDraftDiscard, { slug: STORY_RESPOND_SPEC_ID }],
			[m.pipelinesDraftPreview, { slug: STORY_RESPOND_SPEC_ID, semver: "1.0.0" }],
			[m.pipelinesDraftPublish, { slug: STORY_RESPOND_SPEC_ID, semver: "1.0.0" }],
			[m.pipelinesCatalogue, {}],
			[
				m.pipelinesFork,
				{ slug: STORY_RESPOND_SPEC_ID, ownerSlug: "x", name: "y", label: "Y" }
			]
		]
		for (const [h, params] of cases) {
			const rec = recordingEmit()
			const res: any = await h.handler(socketFor(stranger.id), params, rec.emit)
			expect(res.error, h.event).toMatch(/admin/i)
			expect(rec.last(`${h.event}:error`)?.error, h.event).toMatch(/admin/i)
			expect(rec.last(h.event), h.event).toBeUndefined()
		}
	}, 60_000)
})

describe("catalogue", () => {
	test("lists core definitions with their kinds and labels", async () => {
		const { pipelinesCatalogue } = await import("./pipelineDrafts")
		const res: any = await pipelinesCatalogue.handler(asAdmin(), {}, () => {})
		expect(res.error).toBeUndefined()
		expect(res.definitions.length).toBeGreaterThan(10)
		const kinds = new Set(res.definitions.map((d: any) => d.kind))
		expect(kinds.has("oracle")).toBe(true)
		expect(res.definitions.every((d: any) => d.id && d.kind && d.ports)).toBe(true)
		expect(res.definitions.some((d: any) => d.i18n)).toBe(true)
	}, 60_000)
})

describe("shipped specs", () => {
	test("get on a core spec says shipped, with no draft", async () => {
		const { pipelinesDraftGet } = await import("./pipelineDrafts")
		const res: any = await pipelinesDraftGet.handler(
			asAdmin(),
			{ slug: STORY_RESPOND_SPEC_ID },
			() => {}
		)
		expect(res).toMatchObject({ slug: STORY_RESPOND_SPEC_ID, draft: null, shipped: true })
	}, 60_000)

	test("put on a core spec is refused: fork first", async () => {
		const { pipelinesDraftPut } = await import("./pipelineDrafts")
		const { pipelinesDocument } = await import("./pipelines")
		const doc: any = await pipelinesDocument.handler(
			asAdmin(),
			{ slug: STORY_RESPOND_SPEC_ID },
			() => {}
		)
		const rec = recordingEmit()
		const res: any = await pipelinesDraftPut.handler(
			asAdmin(),
			{ slug: STORY_RESPOND_SPEC_ID, document: doc.document },
			rec.emit
		)
		expect(res.error).toMatch(/fork/i)
		expect(rec.last("pipelines:draft:put:error")?.error).toMatch(/fork/i)
	}, 60_000)
})

describe("fork → draft → preview → publish", () => {
	test("fork refuses a bad or reserved owner name", async () => {
		const { pipelinesFork } = await import("./pipelineDrafts")
		for (const ownerSlug of ["core", "Acme", "a..b", ""]) {
			const res: any = await pipelinesFork.handler(
				asAdmin(),
				{ slug: STORY_RESPOND_SPEC_ID, ownerSlug, name: "x", label: "X" },
				() => {}
			)
			expect(res.error, ownerSlug).toBeTruthy()
		}
		const bad: any = await pipelinesFork.handler(
			asAdmin(),
			{ slug: STORY_RESPOND_SPEC_ID, ownerSlug: "acme", name: "Bad_Name", label: "X" },
			() => {}
		)
		expect(bad.error).toBeTruthy()
	}, 60_000)

	test("fork copies the active version, derived_from set, actions dropped", async () => {
		const { pipelinesFork } = await import("./pipelineDrafts")
		const rec = recordingEmit()
		const res: any = await pipelinesFork.handler(
			asAdmin(),
			{
				slug: STORY_RESPOND_SPEC_ID,
				ownerSlug: "acme.lab",
				name: "reply-copy",
				label: "Reply copy"
			},
			rec.emit
		)
		expect(res.error).toBeUndefined()
		expect(res.slug).toBe(FORK)
		expect(rec.last("pipelines:fork")?.slug).toBe(FORK)

		const source = await specRow(STORY_RESPOND_SPEC_ID)
		const fork = await specRow(FORK)
		expect(fork?.name).toBe("Reply copy")
		expect(fork?.sourcePluginId).toBeNull()
		const [version] = await testDb
			.select()
			.from(schema.pipelineSpecVersions)
			.where(eq(schema.pipelineSpecVersions.id, fork!.activeVersionId!))
		expect(version!.status).toBe("published")
		expect(version!.derivedFromSpecVersionId).toBe(source!.activeVersionId)
		expect((version!.contributes as any)?.actions).toBeUndefined()

		// Not shipped: the copy is editable.
		const { pipelinesDraftGet } = await import("./pipelineDrafts")
		const got: any = await pipelinesDraftGet.handler(asAdmin(), { slug: FORK }, () => {})
		expect(got).toMatchObject({ slug: FORK, draft: null, shipped: false })

		// A second fork to the same name is refused.
		const again: any = await pipelinesFork.handler(
			asAdmin(),
			{ slug: STORY_RESPOND_SPEC_ID, ownerSlug: "acme.lab", name: "reply-copy", label: "X" },
			() => {}
		)
		expect(again.error).toMatch(/already/i)
	}, 60_000)

	test("put refuses a document whose id is not the slug", async () => {
		const { pipelinesDraftPut } = await import("./pipelineDrafts")
		const { pipelinesDocument } = await import("./pipelines")
		const doc: any = await pipelinesDocument.handler(asAdmin(), { slug: FORK }, () => {})
		const res: any = await pipelinesDraftPut.handler(
			asAdmin(),
			{ slug: FORK, document: { ...doc.document, id: "acme.lab:spec/other" } },
			() => {}
		)
		expect(res.error).toMatch(/cannot rename/i)
		const v2: any = await pipelinesDraftPut.handler(
			asAdmin(),
			{ slug: FORK, document: { ...doc.document, schemaVersion: 2 } },
			() => {}
		)
		expect(v2.error).toMatch(/schema 1/i)
	}, 60_000)

	test("put → get round trip stores the recompiled document and its findings", async () => {
		const { pipelinesDraftPut, pipelinesDraftGet } = await import("./pipelineDrafts")
		const { pipelinesDocument } = await import("./pipelines")
		const doc: any = await pipelinesDocument.handler(asAdmin(), { slug: FORK }, () => {})
		const fork = await specRow(FORK)
		// The client's edges are not trusted: they are rebuilt.
		const sent = { ...doc.document, edges: [] }
		const rec = recordingEmit()
		const put: any = await pipelinesDraftPut.handler(
			asAdmin(),
			{ slug: FORK, document: sent },
			rec.emit
		)
		expect(put.error).toBeUndefined()
		expect(Array.isArray(put.draft.findings)).toBe(true)
		expect(put.draft.document.edges.length).toBe(doc.document.edges.length)
		expect(put.draft.basedOnVersionId).toBe(fork!.activeVersionId)
		expect(put.draft.basedOnSemver).toBe(doc.version.semver)
		expect(rec.last("pipelines:draft:put")?.slug).toBe(FORK)

		const got: any = await pipelinesDraftGet.handler(asAdmin(), { slug: FORK }, () => {})
		expect(got.draft.document.nodes.length).toBe(doc.document.nodes.length)
		expect(got.draft.findings).toEqual(put.draft.findings)
		// Per admin: a second admin sees no draft.
		const other = await (await import("$lib/server/utils/testDb")).createTestUser(
			testDb,
			"drafts-admin-2"
		)
		const theirs: any = await pipelinesDraftGet.handler(
			socketFor(other.id, true),
			{ slug: FORK },
			() => {}
		)
		expect(theirs.draft).toBeNull()
	}, 60_000)

	test("a put with an invalid document is stored with error findings, not refused", async () => {
		const { pipelinesDraftPut, pipelinesDraftDiscard } = await import("./pipelineDrafts")
		const { pipelinesDocument } = await import("./pipelines")
		const doc: any = await pipelinesDocument.handler(asAdmin(), { slug: FORK }, () => {})
		// Two nodes under one key — law 01 §2.
		const broken = {
			...doc.document,
			nodes: [...doc.document.nodes, doc.document.nodes[0]]
		}
		const put: any = await pipelinesDraftPut.handler(
			asAdmin(),
			{ slug: FORK, document: broken },
			() => {}
		)
		expect(put.error).toBeUndefined()
		expect(put.draft.findings.some((f: any) => f.severity === "error")).toBe(true)
		const gone: any = await pipelinesDraftDiscard.handler(asAdmin(), { slug: FORK }, () => {})
		expect(gone).toEqual({ slug: FORK, discarded: true })
	}, 60_000)

	test("preview lists no configuration (retired, R50); nothing written", async () => {
		const { pipelinesDraftPut, pipelinesDraftPreview } = await import("./pipelineDrafts")
		const { pipelinesDocument } = await import("./pipelines")
		const { getDefinition } = await import("@serene-pub/sdk")
		const doc: any = await pipelinesDocument.handler(asAdmin(), { slug: FORK }, () => {})
		const fork = await specRow(FORK)

		// The sprite pair is the reply's tail: the show reads the pick and
		// nothing reads the show, so removing every pair still compiles —
		// Story's reply carries one in each branch of its `reply` junction
		// (D7). The probe sits on the reply's own picker, by its address.
		const { replyStepKeys } = await import("$lib/server/utils/testDb")
		const picker = (await replyStepKeys(testDb, FORK)).spritePick
		const victim = doc.document.nodes.find((n: any) => n.key === picker)
		expect(victim).toBeTruthy()
		const slot = Object.keys(
			getDefinition(`${victim.definitionId}@${victim.definitionVersion}`)!.slots!
		)[0]!

		const [config] = await testDb
			.select()
			.from(schema.pipelineConfigs)
			.where(eq(schema.pipelineConfigs.specId, fork!.id))
			.limit(1)
		expect(config).toBeTruthy()
		await testDb
			.insert(schema.pipelineConfigValues)
			.values({
				configId: config!.id,
				nodeKey: victim.key,
				slot,
				path: "previewProbe",
				value: 7
			})
			.onConflictDoNothing()

		const without = {
			...doc.document,
			nodes: doc.document.nodes.filter(
				(n: any) => n.definitionId !== victim.definitionId && n.definitionId !== "core:outlet/show-sprite"
			)
		}
		const put: any = await pipelinesDraftPut.handler(
			asAdmin(),
			{ slug: FORK, document: without },
			() => {}
		)
		expect(put.error).toBeUndefined()

		const rec = recordingEmit()
		const res: any = await pipelinesDraftPreview.handler(
			asAdmin(),
			{ slug: FORK, semver: doc.version.semver },
			rec.emit
		)
		expect(res.error).toBeUndefined()
		expect(Array.isArray(res.findings)).toBe(true)
		// Same semver, different content: information, not a refusal.
		expect(res.semverTaken).toBe(true)
		// 🚧 R50 (lane F1, 0110): configurations are retired — nothing reads
		// one, so a publish culls or back-fills none and the preview lists none.
		expect(res.affected).toEqual([])
		expect(rec.last("pipelines:draft:preview")?.slug).toBe(FORK)

		// Nothing written.
		const still = await testDb
			.select()
			.from(schema.pipelineConfigValues)
			.where(
				and(
					eq(schema.pipelineConfigValues.configId, config!.id),
					eq(schema.pipelineConfigValues.nodeKey, victim.key)
				)
			)
		expect(still.length).toBeGreaterThan(0)
	}, 60_000)

	test("publish with a bumped semver makes a new active version and removes the draft", async () => {
		const { pipelinesDraftPublish, pipelinesDraftGet } = await import("./pipelineDrafts")
		const before = await specRow(FORK)
		const rec = recordingEmit()
		const res: any = await pipelinesDraftPublish.handler(
			asAdmin(),
			{ slug: FORK, semver: "9.9.1" },
			rec.emit
		)
		expect(res.error).toBeUndefined()
		expect(res.version.semver).toBe("9.9.1")
		expect(res.version.id).not.toBe(before!.activeVersionId)
		expect(res.reconcile.culled).toBeGreaterThanOrEqual(1)
		expect(typeof res.reconcile.backfilled).toBe("number")

		const after = await specRow(FORK)
		expect(after!.activeVersionId).toBe(res.version.id)
		const [old] = await testDb
			.select()
			.from(schema.pipelineSpecVersions)
			.where(eq(schema.pipelineSpecVersions.id, before!.activeVersionId!))
		expect(old!.status).toBe("retired")

		// The workspace's detail is re-emitted.
		expect(rec.last("pipelines:detail")).toBeTruthy()
		const got: any = await pipelinesDraftGet.handler(asAdmin(), { slug: FORK }, () => {})
		expect(got.draft).toBeNull()
	}, 60_000)

	test("publish with no draft is a sentence on :error", async () => {
		const { pipelinesDraftPublish } = await import("./pipelineDrafts")
		const rec = recordingEmit()
		const res: any = await pipelinesDraftPublish.handler(
			asAdmin(),
			{ slug: FORK, semver: "9.9.2" },
			rec.emit
		)
		expect(res.error).toMatch(/no draft/i)
		expect(rec.last("pipelines:draft:publish:error")?.error).toMatch(/no draft/i)
	}, 60_000)

	test("publish refuses an invalid draft with saveDocument's sentence", async () => {
		const { pipelinesDraftPut, pipelinesDraftPublish } = await import("./pipelineDrafts")
		const { pipelinesDocument } = await import("./pipelines")
		const doc: any = await pipelinesDocument.handler(asAdmin(), { slug: FORK }, () => {})
		// Two nodes under one key — law 01 §2.
		const broken = {
			...doc.document,
			nodes: [...doc.document.nodes, doc.document.nodes[0]]
		}
		await pipelinesDraftPut.handler(asAdmin(), { slug: FORK, document: broken }, () => {})
		const rec = recordingEmit()
		const res: any = await pipelinesDraftPublish.handler(
			asAdmin(),
			{ slug: FORK, semver: "9.9.3" },
			rec.emit
		)
		expect(res.error).toMatch(/does not validate/i)
		expect(rec.last("pipelines:draft:publish:error")).toBeTruthy()
		const [row] = await testDb
			.select()
			.from(schema.pipelineDrafts)
			.where(eq(schema.pipelineDrafts.userId, admin.id))
		expect(row).toBeTruthy()
	}, 60_000)
})
