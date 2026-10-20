/**
 * Composite steps — the server half (PLAN-pipeline-canvas-and-genre-authoring
 * §5): save, re-save, refusals, the catalogue listing, delete.
 *
 * Driven straight through the handlers against a bootstrapped PGlite, the way
 * `pipelineDrafts.int.test.ts` is.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { STORY_RESPOND_SPEC_ID, CORE_SPECS } from "@serene-pub/core-catalog"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "socket-composites-test-secret" }
})

let stranger: { id: number }
let admin: { id: number }

const SLUG = "acme.lab:composite/lore-pair"

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-pipeline-composites-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(testDb as any)
	const { createTestUser } = await import("$lib/server/utils/testDb")
	stranger = await createTestUser(testDb, "composites-stranger")
	admin = await createTestUser(testDb, "composites-admin")
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

/** Two real spine steps of the adventure reply, with their configs, keys as-is. */
async function fixture(): Promise<Sockets.Pipelines.Composite.Document> {
	const { compile } = await import("@serene-pub/sdk")
	const entry = CORE_SPECS.find((s) => s.slug === STORY_RESPOND_SPEC_ID)
	if (!entry) throw new Error("no adventure reply spec")
	const doc = JSON.parse(JSON.stringify(compile(entry.build())))
	const nodes = doc.nodes.filter((n: any) =>
		["lore", "loreLinked"].includes(n.key)
	)
	expect(nodes.map((n: any) => n.key).sort()).toEqual(["lore", "loreLinked"])
	return {
		nodes: nodes.map(({ resolvedRefs: _r, ...n }: any) => n),
		clauses: [],
		reads: [{ key: "lore", path: "input.text", node: "input" }]
	}
}

async function catalogueComposites() {
	const { pipelinesCatalogue } = await import("./pipelineDrafts")
	const res: any = await pipelinesCatalogue.handler(asAdmin(), {}, () => {})
	expect(res.error).toBeUndefined()
	return res.composites as Sockets.Pipelines.Composite.Listed[]
}

describe("admin only", () => {
	test("a non-admin is refused on every event, on its :error twin", async () => {
		const m = await import("./pipelineComposites")
		const document = await fixture()
		const cases: Array<[any, any]> = [
			[m.pipelinesCompositeSave, { slug: SLUG, label: "Lore pair", document }],
			[m.pipelinesCompositeDelete, { slug: SLUG }]
		]
		for (const [h, params] of cases) {
			const rec = recordingEmit()
			const res: any = await h.handler(socketFor(stranger.id), params, rec.emit)
			expect(res.error).toMatch(/admin/i)
			expect(rec.last(`${h.event}:error`)?.error).toMatch(/admin/i)
			expect(rec.last(h.event)).toBeUndefined()
		}
		expect(await catalogueComposites()).toEqual([])
	}, 60_000)
})

describe("save, list, re-save, delete", () => {
	test("save → the catalogue lists it with its node count and document", async () => {
		const { pipelinesCompositeSave } = await import("./pipelineComposites")
		const document = await fixture()
		const rec = recordingEmit()
		const res: any = await pipelinesCompositeSave.handler(
			asAdmin(),
			{ slug: SLUG, label: "Lore pair", document },
			rec.emit
		)
		expect(res.error).toBeUndefined()
		expect(res.slug).toBe(SLUG)
		expect(res.composite).toMatchObject({
			slug: SLUG,
			label: "Lore pair",
			nodeCount: 2,
			reads: document.reads
		})
		expect(rec.last("pipelines:composite:save")).toEqual(res)

		const listed = await catalogueComposites()
		expect(listed).toHaveLength(1)
		expect(listed[0]).toMatchObject({ slug: SLUG, label: "Lore pair", nodeCount: 2 })
		expect(listed[0].document.nodes.map((n) => n.key)).toEqual(
			document.nodes.map((n) => n.key)
		)
		expect(listed[0].document.nodes[0].config).toEqual(document.nodes[0].config)
	}, 60_000)

	test("a re-save replaces label, document and node count; catalogue orders by label", async () => {
		const { pipelinesCompositeSave } = await import("./pipelineComposites")
		const document = await fixture()
		const one = { ...document, nodes: document.nodes.slice(0, 1) }
		const res: any = await pipelinesCompositeSave.handler(
			asAdmin(),
			{ slug: SLUG, label: "Zz lore", document: one },
			() => {}
		)
		expect(res.error).toBeUndefined()
		expect(res.composite.nodeCount).toBe(1)
		const other: any = await pipelinesCompositeSave.handler(
			asAdmin(),
			{ slug: "acme.lab:composite/another", label: "Aa first", document },
			() => {}
		)
		expect(other.error).toBeUndefined()

		const rows = await testDb
			.select()
			.from(schema.pipelineComposites)
			.where(eq(schema.pipelineComposites.slug, SLUG))
		expect(rows).toHaveLength(1)
		expect(rows[0].label).toBe("Zz lore")
		expect(rows[0].nodeCount).toBe(1)

		const listed = await catalogueComposites()
		expect(listed.map((c) => c.label)).toEqual(["Aa first", "Zz lore"])
	}, 60_000)

	test("delete removes it; an unknown slug is refused", async () => {
		const { pipelinesCompositeDelete } = await import("./pipelineComposites")
		const rec = recordingEmit()
		const res: any = await pipelinesCompositeDelete.handler(
			asAdmin(),
			{ slug: "acme.lab:composite/another" },
			rec.emit
		)
		expect(res).toEqual({ slug: "acme.lab:composite/another", deleted: true })
		expect((await catalogueComposites()).map((c) => c.slug)).toEqual([SLUG])

		const again: any = await pipelinesCompositeDelete.handler(
			asAdmin(),
			{ slug: "acme.lab:composite/another" },
			rec.emit
		)
		expect(again.error).toMatch(/no composite step/)
		expect(rec.last("pipelines:composite:delete:error")?.error).toBe(again.error)
	}, 60_000)
})

describe("refusals", () => {
	async function refused(params: any) {
		const { pipelinesCompositeSave } = await import("./pipelineComposites")
		const rec = recordingEmit()
		const res: any = await pipelinesCompositeSave.handler(asAdmin(), params, rec.emit)
		expect(typeof res.error).toBe("string")
		expect(res.error).toMatch(/[.!]$/)
		expect(rec.last("pipelines:composite:save:error")?.error).toBe(res.error)
		expect(rec.last("pipelines:composite:save")).toBeUndefined()
		return res.error as string
	}

	test("a bad slug, the core owner, an empty label, and an empty document", async () => {
		const document = await fixture()
		expect(await refused({ slug: "Acme:composite/x", label: "X", document })).toMatch(
			/not a composite step id/
		)
		expect(await refused({ slug: "acme:spec/x", label: "X", document })).toMatch(
			/not a composite step id/
		)
		expect(await refused({ slug: "core:composite/x", label: "X", document })).toMatch(
			/core/
		)
		expect(await refused({ slug: "acme:composite/x", label: "  ", document })).toMatch(
			/label/
		)
		expect(
			await refused({
				slug: "acme:composite/x",
				label: "X",
				document: { nodes: [], clauses: [], reads: [] }
			})
		).toMatch(/at least one step/)
	}, 60_000)

	test("an unknown definition, a node missing its kind, and a duplicate key", async () => {
		const document = await fixture()
		const [a, b] = document.nodes
		expect(
			await refused({
				slug: "acme:composite/x",
				label: "X",
				document: {
					...document,
					nodes: [{ ...a, definitionId: "acme:task/nothing" }, b]
				}
			})
		).toMatch(/acme:task\/nothing@.* which this pub does not have/)
		const { kind: _k, ...noKind } = a as any
		expect(
			await refused({
				slug: "acme:composite/x",
				label: "X",
				document: { ...document, nodes: [noKind, b] }
			})
		).toMatch(/kind/)
		expect(
			await refused({
				slug: "acme:composite/x",
				label: "X",
				document: { ...document, nodes: [a, { ...b, key: a.key }] }
			})
		).toMatch(/used twice/)
		const rows = await testDb
			.select()
			.from(schema.pipelineComposites)
			.where(eq(schema.pipelineComposites.slug, "acme:composite/x"))
		expect(rows).toHaveLength(0)
	}, 60_000)
})
