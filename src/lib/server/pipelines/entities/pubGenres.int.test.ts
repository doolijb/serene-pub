/**
 * In-app genres (PLAN-pipeline-canvas-and-genre-authoring §6.1):
 * `sessionGenres:create`, the extended `sessionGenres:update` and detail, the
 * registry, and the `pub` layout origin — driven through the handlers against
 * a bootstrapped PGlite, the way `sockets/pipelineDrafts.int.test.ts` is.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { STORY_GENRE_ID } from "@serene-pub/core-catalog"
import { getGenre, sessionEvents } from "@serene-pub/sdk"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "pub-genres-test-secret" }
})

let stranger: { id: number }
let admin: { id: number }

const QUEST = "acme.lab:genre/quest"

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-pub-genres-int-test-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(testDb as any)
	const { syncLayoutPresets } = await import("$lib/server/db/layoutPresets")
	await syncLayoutPresets([STORY_GENRE_ID])
	const { createTestUser } = await import("$lib/server/utils/testDb")
	stranger = await createTestUser(testDb, "pub-genres-stranger")
	admin = await createTestUser(testDb, "pub-genres-admin")
	await testDb.update(schema.users).set({ isAdmin: true }).where(eq(schema.users.id, admin.id))
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
	const emit = (event: string, data: any) => {
		seen.push([event, data])
	}
	return {
		emit,
		seen,
		last: (e: string) => seen.filter(([k]) => k === e).at(-1)?.[1]
	}
}

const asAdmin = () => socketFor(admin.id, true)

/** Every active version locked to a genre, with its spec row. */
async function activeLockedTo(genreId: string) {
	const rows = await testDb
		.select({
			specId: schema.pipelineSpecs.id,
			slug: schema.pipelineSpecs.slug,
			activeVersionId: schema.pipelineSpecs.activeVersionId,
			versionId: schema.pipelineSpecVersions.id,
			status: schema.pipelineSpecVersions.status,
			inputGenre: schema.pipelineSpecVersions.inputGenre,
			inputEvent: schema.pipelineSpecVersions.inputEvent,
			taxonomy: schema.pipelineSpecVersions.taxonomy,
			genre: schema.pipelineSpecVersions.genre,
			derivedFrom: schema.pipelineSpecVersions.derivedFromSpecVersionId
		})
		.from(schema.pipelineSpecs)
		.innerJoin(
			schema.pipelineSpecVersions,
			eq(schema.pipelineSpecVersions.specId, schema.pipelineSpecs.id)
		)
	// 🚧 Locked to it (⏳), or mounted by its defaults' registrations (D7).
	const registered = new Set(
		(
			await testDb
				.select({ specSlug: schema.registrations.specSlug })
				.from(schema.registrations)
				.where(and(eq(schema.registrations.scopeKind, "genre"), eq(schema.registrations.scopeRef, genreId)))
		).map((r) => r.specSlug)
	)
	const createSlugs = new Set(
		(
			await testDb
				.select({ specSlug: schema.registrations.specSlug })
				.from(schema.registrations)
				.where(
					and(
						eq(schema.registrations.scopeKind, "genre"),
						eq(schema.registrations.scopeRef, genreId),
						eq(schema.registrations.triggerRef, sessionEvents.sessionCreated)
					)
				)
		).map((r) => r.specSlug)
	)
	return (rows as any[])
		.filter(
			(r) =>
				r.activeVersionId === r.versionId &&
				(r.inputGenre === genreId || (!r.inputGenre && registered.has(r.slug))) &&
				// Core's save serves every genre; it is not the genre's own.
				r.slug !== "core:spec/save-message"
		)
		.map((r) => (createSlugs.has(r.slug) ? { ...r, inputEvent: sessionEvents.sessionCreated } : r))
}

const create = (params: Record<string, unknown>, socket = asAdmin()) =>
	import("$lib/server/sockets/sessionAdmin").then(async (m) => {
		const rec = recordingEmit()
		const res: any = await m.sessionGenresCreate.handler(socket, params as any, rec.emit)
		return { res, rec }
	})

describe("sessionGenres:create refusals", () => {
	test("non-admin, bad owner, core, plugin owner, bad name, unknown source", async () => {
		const base = {
			ownerSlug: "acme.lab",
			name: "quest",
			label: "Quest",
			from: STORY_GENRE_ID,
			scope: "all"
		}
		const denied = await create(base, socketFor(stranger.id))
		expect(denied.res.error).toMatch(/administrator/i)
		expect(denied.rec.last("sessionGenres:create:error")?.error).toMatch(/administrator/i)

		const cases: Array<[Record<string, unknown>, RegExp]> = [
			[{ ownerSlug: "Acme Lab" }, /owner name takes/],
			[{ ownerSlug: "core" }, /'core' is Serene Pub's own name/],
			[{ name: "Quest!" }, /genre name takes/],
			[{ label: "  " }, /label/],
			[{ from: "nobody:genre/none" }, /no genre called/]
		]
		await testDb
			.insert(schema.plugins)
			.values({
				pluginId: "taken.owner",
				name: "Taken",
				bundleSource: "",
				bundleHash: "x"
			} as any)
		cases.push([{ ownerSlug: "taken.owner" }, /installed plugin's name/])
		for (const [patch, re] of cases) {
			const { res, rec } = await create({ ...base, ...patch })
			expect(res.error, JSON.stringify(patch)).toMatch(re)
			expect(rec.last("sessionGenres:create:error")?.error).toMatch(re)
			expect(rec.last("sessionGenres:create")).toBeUndefined()
		}
		expect(await activeLockedTo(QUEST)).toHaveLength(0)
	}, 60_000)
})

describe("create from Adventure, everything", () => {
	let sourceSlugs: string[] = []

	test("copies every pipeline under the new genre with rewritten locks", async () => {
		sourceSlugs = (await activeLockedTo(STORY_GENRE_ID))
			.filter((r) => r.status === "published")
			.map((r) => r.slug)
		expect(sourceSlugs.length).toBeGreaterThan(2)

		const { res, rec } = await create({
			ownerSlug: "acme.lab",
			name: "quest",
			label: "Quest",
			description: "A quest of one's own.",
			family: "story",
			from: STORY_GENRE_ID,
			scope: "all"
		})
		expect(res.error).toBeUndefined()
		expect(res.genreId).toBe(QUEST)
		expect(rec.last("sessionGenres:create")?.genreId).toBe(QUEST)

		const copies = await activeLockedTo(QUEST)
		expect(copies).toHaveLength(sourceSlugs.length)
		for (const c of copies) {
			expect(c.slug.startsWith("acme.lab:spec/quest-")).toBe(true)
			expect(c.status).toBe("published")
			expect(c.derivedFrom).not.toBeNull()
			if (c.taxonomy && typeof c.taxonomy === "object" && "genre" in c.taxonomy)
				expect(c.taxonomy.genre).toBe(QUEST)
		}
		expect(copies.some((c) => c.slug === "acme.lab:spec/quest-respond")).toBe(true)

		const createRow = copies.find((c) => c.inputEvent === sessionEvents.sessionCreated)
		expect(createRow).toBeTruthy()
		expect(createRow.genre?.name).toBe("Quest")
		expect(createRow.genre?.description).toBe("A quest of one's own.")
		expect(createRow.genre?.family).toBe("story")
		expect(createRow.genre?.shape).toBeTruthy()

		// No copied document keeps the source genre: a lock-era one names the
		// new genre, one mounted by registrations names none (D3).
		for (const c of copies) {
			const { loadDocument } = await import("$lib/server/pipelines/boot/store")
			const doc: any = await loadDocument(testDb as any, c.versionId)
			for (const a of doc.contributes?.actions ?? []) expect([undefined, QUEST]).toContain(a.genre)
			expect([undefined, QUEST]).toContain(doc.input?.genre)
		}
	}, 120_000)

	test("each copy has its shipped default configuration", async () => {
		for (const c of await activeLockedTo(QUEST)) {
			const configs = await testDb
				.select()
				.from(schema.pipelineConfigs)
				.where(eq(schema.pipelineConfigs.specId, c.specId))
			expect(configs.length, c.slug).toBeGreaterThan(0)
		}
	}, 60_000)

	test("the default preset binds the copied reply", async () => {
		const presets = await testDb
			.select()
			.from(schema.sessionPresets)
			.where(eq(schema.sessionPresets.genreId, QUEST))
		expect(presets).toHaveLength(1)
		const p: any = presets[0]
		expect(p.name).toBe("Quest")
		expect(p.isDefault).toBe(true)
		expect(p.enabled).toBe(true)
		expect(p.isImmutable).toBe(false)
		expect(p.bindings[sessionEvents.messageRespond]?.spec).toBe("acme.lab:spec/quest-respond")
		// Every copied binding is a copy — but the save, core's default, serves
		// every genre and is kept as is (owner ruling 2026-10-15).
		for (const [event, b] of Object.entries(p.bindings) as any[])
			expect(
				event === sessionEvents.messageOffered
					? b.spec === "core:spec/save-message"
					: b.spec.startsWith("acme.lab:spec/quest-")
			).toBe(true)
		expect(p.bindings[sessionEvents.messageOffered]?.spec).toBe("core:spec/save-message")
	}, 60_000)

	test("the registry holds the genre with the source's declaration", async () => {
		const g = getGenre(QUEST)
		expect(g).toBeTruthy()
		expect(g?.name).toBe("Quest")
		expect(g?.family).toBe("story")
		// 🚧 RF fix 8: a genre brings no slots — the copy carries none, as its source carries none.
		expect("slots" in (g ?? {})).toBe(false)
		expect(g?.uses).toEqual(getGenre(STORY_GENRE_ID)?.uses)
	})

	test("the default layout is copied with origin pub", async () => {
		const rows = await testDb
			.select()
			.from(schema.sessionLayoutPresets)
			.where(eq(schema.sessionLayoutPresets.genreId, QUEST))
		expect(rows).toHaveLength(1)
		expect(rows[0].origin).toBe("pub")
		expect(rows[0].slug).toBe("default")
		const { genreDefaultLayoutRow, syncLayoutPresets } = await import(
			"$lib/server/db/layoutPresets"
		)
		expect((await genreDefaultLayoutRow(QUEST))?.id).toBe(rows[0].id)
		// Neither reconciler takes it away.
		await syncLayoutPresets([STORY_GENRE_ID, QUEST])
		const { syncPluginLayouts } = await import("$lib/server/db/pluginLayouts")
		await syncPluginLayouts(testDb as any)
		const [still] = await testDb
			.select()
			.from(schema.sessionLayoutPresets)
			.where(
				and(
					eq(schema.sessionLayoutPresets.id, rows[0].id),
					eq(schema.sessionLayoutPresets.origin, "pub")
				)
			)
		expect(still?.withdrawnAt ?? null).toBeNull()
	}, 60_000)

	test("listSessionGenres lists the genre once", async () => {
		const { listSessionGenres } = await import("./sessionGenres")
		const listed = (await listSessionGenres(testDb as any)).filter((g) => g.genreId === QUEST)
		expect(listed).toHaveLength(1)
		expect(listed[0].name).toBe("Quest")
	}, 60_000)

	test("a second create under the same id is refused", async () => {
		const { res } = await create({
			ownerSlug: "acme.lab",
			name: "quest",
			label: "Quest again",
			from: STORY_GENRE_ID,
			scope: "all"
		})
		expect(res.error).toMatch(/already a genre called/)
	}, 60_000)

	test("the detail states origin, editable, fields, state, layout", async () => {
		const { sessionGenresDetail } = await import("$lib/server/sockets/sessionAdmin")
		const rec = recordingEmit()
		const res: any = await sessionGenresDetail.handler(asAdmin(), { genreId: QUEST }, rec.emit)
		expect(res.genre.origin).toBe("pub")
		expect(res.genre.editable).toBe(true)
		expect(typeof res.genre.fields).toBe("object")
		expect(typeof res.genre.hasState).toBe("boolean")
		expect(res.genre.layout?.slug).toBe("default")
		expect(typeof res.genre.pluginsEnabled).toBe("boolean")
		expect(res.genre.defaultPresetId).not.toBeNull()
		const respond = res.slots.find((s: any) => s.event === sessionEvents.messageRespond)
		expect(respond.candidates.map((c: any) => c.slug)).toContain("acme.lab:spec/quest-respond")

		const core: any = await sessionGenresDetail.handler(
			asAdmin(),
			{ genreId: STORY_GENRE_ID },
			() => {}
		)
		expect(core.genre.origin).toBe("core")
		expect(core.genre.editable).toBe(false)
	}, 60_000)

	test("update fields → a new active create version, and the detail returns them", async () => {
		const before = (await activeLockedTo(QUEST)).find(
			(r) => r.inputEvent === sessionEvents.sessionCreated
		)
		const { sessionGenresUpdate, sessionGenresDetail } = await import(
			"$lib/server/sockets/sessionAdmin"
		)
		const fields = {
			goal: { type: "string", label: "Goal", default: "" }
		}
		const rec = recordingEmit()
		const res: any = await sessionGenresUpdate.handler(
			asAdmin(),
			{ slug: QUEST, name: "Grand Quest", fields } as any,
			rec.emit
		)
		expect(res.error).toBeUndefined()
		expect(res.ok).toBe(true)
		const after = (await activeLockedTo(QUEST)).find(
			(r) => r.inputEvent === sessionEvents.sessionCreated
		)
		expect(after.versionId).not.toBe(before.versionId)
		expect(after.derivedFrom).toBe(before.derivedFrom)
		expect(after.genre?.name).toBe("Grand Quest")
		const detail: any = await sessionGenresDetail.handler(asAdmin(), { genreId: QUEST }, () => {})
		expect(detail.genre.fields).toEqual(fields)
		expect(detail.genre.name).toBe("Grand Quest")
		expect(getGenre(QUEST)?.name).toBe("Grand Quest")
	}, 120_000)

	test("update refuses a shipped genre and a bad schema", async () => {
		const { sessionGenresUpdate } = await import("$lib/server/sockets/sessionAdmin")
		const rec = recordingEmit()
		const res: any = await sessionGenresUpdate.handler(
			asAdmin(),
			{ slug: STORY_GENRE_ID, name: "Mine now" } as any,
			rec.emit
		)
		expect(res.error).toMatch(/ships with Serene Pub/)
		expect(rec.last("sessionGenres:update:error")?.error).toMatch(/ships with Serene Pub/)

		const bad: any = await sessionGenresUpdate.handler(
			asAdmin(),
			{ slug: QUEST, fields: { goal: { type: "nonsense" } } } as any,
			() => {}
		)
		expect(bad.error).toMatch(/nonsense/)

		// A choice declared core's way — `members[{key, label}]` — has options;
		// one with neither `members` nor `of` does not.
		const members: any = await sessionGenresUpdate.handler(
			asAdmin(),
			{
				slug: QUEST,
				fields: {
					goal: { type: "string", label: "Goal", default: "" },
					pace: {
						type: "enum",
						label: "Pace",
						members: [{ key: "slow", label: "Slow" }, { key: "fast", label: "Fast" }]
					}
				}
			} as any,
			() => {}
		)
		expect(members.error).toBeUndefined()
		expect(members.ok).toBe(true)
		const bare: any = await sessionGenresUpdate.handler(
			asAdmin(),
			{ slug: QUEST, fields: { pace: { type: "enum", label: "Pace" } } } as any,
			() => {}
		)
		expect(bare.error).toMatch(/choice with no options/)
	}, 60_000)

	test("the boot hook re-registers it from derived_from", async () => {
		const { withdrawPubGenre, registerPubGenres } = await import("./pubGenres")
		withdrawPubGenre(QUEST)
		expect(getGenre(QUEST)).toBeUndefined()
		expect(await registerPubGenres(testDb as any)).toEqual([])
		expect(getGenre(QUEST)?.name).toBe("Grand Quest")
	}, 60_000)
})

describe("create the create pipeline only", () => {
	test("copies one document, binds only session-created", async () => {
		const { res } = await create({
			ownerSlug: "acme.lab",
			name: "solo",
			label: "Solo",
			from: STORY_GENRE_ID,
			scope: "create"
		})
		expect(res.error).toBeUndefined()
		const copies = await activeLockedTo("acme.lab:genre/solo")
		expect(copies).toHaveLength(1)
		expect(copies[0].inputEvent).toBe(sessionEvents.sessionCreated)
		const [preset]: any[] = await testDb
			.select()
			.from(schema.sessionPresets)
			.where(eq(schema.sessionPresets.genreId, "acme.lab:genre/solo"))
		// The create binding, and the save every preset shows (2026-10-15).
		expect(Object.keys(preset.bindings).sort()).toEqual(
			[sessionEvents.sessionCreated, sessionEvents.messageOffered].sort()
		)
	}, 120_000)
})
