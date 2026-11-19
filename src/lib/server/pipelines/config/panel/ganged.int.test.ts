/**
 * 🚧 The ganged control (`ganged.ts`, owner ruling D36): one switch per ganged
 * param per pipeline in the panel (*Only what the speaker knows*, *Only scenes
 * the speaker was in*), in place of one per read. Shown on its home read's
 * Advanced step, written to every member's own stored address in one
 * transaction, and followed by the session settings form. Every case runs for
 * each param in `GANGED_PARAMS`.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import type { TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { STORY_RESPOND_SPEC_ID } from "$lib/server/pipelines/specs"
import { STORY_GENRE_ID } from "@serene-pub/core-catalog"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 })

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, dbReady: Promise.resolve(), getCryptoSecretKey: () => "ganged-secret" }
})

const SECRET = "ganged-secret"
const PARAMS = [
	{
		path: "knownToSpeaker",
		label: "Only what the speaker knows",
		description: "Leaves out what the speaking character does not know, on every lore read of this pipeline.",
		home: "gather.worldLore.read",
		nodes: ["gather.worldLore.read", "gather.characterLore.read", "gather.historyEntries.read"]
	},
	{
		path: "speakerInCast",
		label: "Only scenes the speaker was in",
		description:
			"Leaves out the earlier scenes the speaking character was not in, and those scenes' part of each history day, on every read of this pipeline.",
		home: "gather.earlierScenes.read",
		nodes: ["gather.earlierScenes.read", "gather.worldLore.read", "gather.characterLore.read", "gather.historyEntries.read"]
	}
]

/** The param under test, set by the `describe.each` below (its tests run in order). */
let PATH = ""
let LABEL = ""
let HOME = ""

let db: TestDb
let dataDir: string
let adminId: number
let seq = 0
/** Story's reply: the reads declaring the param under test. */
let members: { nodeKey: string; slot: string; path: string }[]

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-ganged-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(db)
	const [admin] = await db
		.insert(schema.users)
		.values({ username: "ganged-admin", isAdmin: true })
		.returning()
	adminId = admin.id
})

async function membersOf(param: string) {
	const { declarations } = await import("$lib/server/pipelines/config/panel/declarations")
	const [spec] = await db
		.select()
		.from(schema.pipelineSpecs)
		.where(eq(schema.pipelineSpecs.slug, STORY_RESPOND_SPEC_ID))
	return (await declarations(db, spec!.activeVersionId!))
		.filter((d) => d.matrixSlot === "params" && d.path === param)
		.map((d) => ({ nodeKey: d.nodeKey, slot: d.slot, path: d.path }))
}

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const idOf = async (at: { nodeKey: string; slot: string; path: string }) =>
	(await import("$lib/server/pipelines/config/panel")).optionId(SECRET, at.nodeKey, at.slot, at.path)

const viewerOf = (sessionId?: number) => ({ userId: adminId, isAdmin: true, ...(sessionId ? { sessionId } : {}) })

async function view(slug: string, sessionId?: number) {
	const { namespaceView } = await import("$lib/server/pipelines/config/panel")
	return (await namespaceView(db, SECRET, slug, viewerOf(sessionId))) as any
}

const allOptions = async (slug: string, sessionId?: number) =>
	(await import("$lib/server/pipelines/config/panel/groups")).groupOptions((await view(slug, sessionId)).groups) as any[]

/** The one ganged option of Story's reply. */
async function gangedOption(sessionId?: number) {
	const opts = (await allOptions(STORY_RESPOND_SPEC_ID, sessionId)).filter((o) => o.label === LABEL)
	expect(opts).toHaveLength(1)
	return opts[0]
}

async function makeSession(): Promise<number> {
	const [user] = await db
		.insert(schema.users)
		.values({ username: `ganged-${++seq}`, isAdmin: false })
		.returning()
	const [session] = await db
		.insert(schema.sessions)
		.values({ userId: user!.id, isGroup: false, genreId: STORY_GENRE_ID } as any)
		.returning()
	return session!.id
}

/** What the run resolves at an address, in the run's order (session, preset, genre, author). */
async function runValue(sessionId: number, at: { nodeKey: string; slot: string; path: string }) {
	const { buildWorld } = await import("$lib/server/pipelines/config/world")
	const world: any = await buildWorld(db, { sessionId, specId: STORY_RESPOND_SPEC_ID })
	const here = (world.overrides as any[]).filter(
		(o) => o.nodeKey === at.nodeKey && o.slot === at.slot && (o.path ?? "") === at.path
	)
	for (const scope of ["session", "preset", "genre", "author"]) {
		const hit = here.find((o) => o.scopeKind === scope)
		if (hit) return hit.value
	}
	return undefined
}

describe.each(PARAMS)("$path", (P) => {
	const P_NODES = P.nodes
	const P_DESCRIPTION = P.description
	beforeAll(async () => {
		PATH = P.path
		LABEL = P.label
		HOME = P.home
		members = await membersOf(P.path)
	})

	describe("one switch per pipeline", () => {
		it("every shipped pipeline with two or more such reads shows exactly one, in the home step's Advanced", async () => {
			const { listNamespaces, declarations } = await import("$lib/server/pipelines/config/panel")
			const { gangedMembersOf } = await import("$lib/server/pipelines/config/panel/ganged")
			const { stepKeyFor } = await import("$lib/server/pipelines/config/panel/ids")
			const { loadDocument } = await import("$lib/server/pipelines/boot/store")
			const { published } = await import("$lib/server/pipelines/config/panel/declarations")
			let gangedSeen = 0
			let singleSeen = 0
			for (const ns of await listNamespaces(db)) {
				const at = (await published(db, ns.slug))!
				const decls = await declarations(db, at.specVersionId)
				const own = decls.filter((d) => d.matrixSlot === "params" && d.path === PATH)
				if (!own.length) continue
				const v = await view(ns.slug)
				const { groupOptions } = await import("$lib/server/pipelines/config/panel/groups")
				const options = groupOptions(v.groups) as any[]
				const speakers = options.filter((o) => o.label === LABEL)
				if (own.length === 1) {
					singleSeen++
					expect(options.some((o) => o.id === optionIdOf(own[0]!)), `${ns.slug}: its own option stays`).toBe(true)
					continue
				}
				gangedSeen++
				const gang = gangedMembersOf(decls, (await loadDocument(db, at.specVersionId)).nodes, PATH)!
				expect(speakers, `${ns.slug}: one ganged option`).toHaveLength(1)
				for (const m of own)
					expect(options.some((o) => o.id === optionIdOf(m)), `${ns.slug}: no per-read option`).toBe(false)
				const step = v.groups
					.flatMap((g: any) => g.advanced)
					.find((s: any) => s.options.some((o: any) => o.id === speakers[0].id))
				expect(step, `${ns.slug}: in an Advanced step`).toBeTruthy()
				expect(step.key).toBe(stepKeyFor(SECRET, gang.home.nodeKey))
				// the payload names no node
				expect(JSON.stringify(speakers[0])).not.toContain(`"${gang.home.nodeKey}"`)
			}
			expect(gangedSeen).toBeGreaterThan(0)
			expect(singleSeen).toBeGreaterThan(0)
		})

		async function storyGang() {
			const { declarations, published } = await import("$lib/server/pipelines/config/panel/declarations")
			const { loadDocument } = await import("$lib/server/pipelines/boot/store")
			const at = (await published(db, STORY_RESPOND_SPEC_ID))!
			return {
				decls: await declarations(db, at.specVersionId),
				nodes: (await loadDocument(db, at.specVersionId)).nodes
			}
		}

		function optionIdOf(d: { nodeKey: string; slot: string; path: string }) {
			return createHmacId(d)
		}
		function createHmacId(d: { nodeKey: string; slot: string; path: string }) {
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			const { createHmac } = require("node:crypto")
			return createHmac("sha256", SECRET)
				.update(`${d.nodeKey}\u0000${d.slot}\u0000${d.path}`)
				.digest("hex")
				.slice(0, 32)
		}

		it("Story's reply sits it on its home read's step", async () => {
			const v = await view(STORY_RESPOND_SPEC_ID)
			const o = await gangedOption()
			const step = v.groups.flatMap((g: any) => g.advanced).find((s: any) => s.options.some((x: any) => x.id === o.id))
			const { decls, nodes } = await storyGang()
			const { gangedMembersOf } = await import("$lib/server/pipelines/config/panel/ganged")
			const gang = gangedMembersOf(decls, nodes, PATH)!
			expect(step.key).toBe((await import("$lib/server/pipelines/config/panel/ids")).stepKeyFor(SECRET, gang.home.nodeKey))
			expect(gang.home.nodeKey).toBe(HOME)
			expect(members.map((m) => m.nodeKey)).toEqual(expect.arrayContaining(P_NODES))
			expect(o.description).toBe(P_DESCRIPTION)
			expect(o.provenance).toBeUndefined()
		})
	})

	describe("a write reaches every read", () => {
		it("false lands on each member's own address; reset returns all to the default", async () => {
			const { writeOption, clearOption } = await import("$lib/server/pipelines/config/panel")
			const { genreStoredValues } = await import("$lib/server/pipelines/registrations/genreValues")
			const { instanceStoredValues } = await import("$lib/server/pipelines/registrations/instanceValues")
			const stored = async () =>
				[...(await genreStoredValues(db, STORY_RESPOND_SPEC_ID)), ...(await instanceStoredValues(db, STORY_RESPOND_SPEC_ID))]
					.filter((r) => r.path === PATH)
					.sort((a, b) => a.nodeKey.localeCompare(b.nodeKey))
			const id = (await gangedOption()).id
			await writeOption(db, SECRET, STORY_RESPOND_SPEC_ID, viewerOf(), id, false)
			expect((await stored()).map((r) => [r.nodeKey, r.value])).toEqual(
				members.map((m) => [m.nodeKey, false]).sort((a: any, b: any) => a[0].localeCompare(b[0]))
			)
			const sessionId = await makeSession()
			for (const m of members) expect(await runValue(sessionId, m), m.nodeKey).toBe(false)
			const o = await gangedOption()
			expect(o.value).toBe(false)
			expect(o.changed).toBe(true)
			expect(o.provenance).toBeUndefined()

			// writing the default back is a reset, per address
			await writeOption(db, SECRET, STORY_RESPOND_SPEC_ID, viewerOf(), id, true)
			expect(await stored()).toEqual([])

			await writeOption(db, SECRET, STORY_RESPOND_SPEC_ID, viewerOf(), id, false)
			await clearOption(db, SECRET, STORY_RESPOND_SPEC_ID, viewerOf(), id)
			expect(await stored()).toEqual([])
			for (const m of members) expect(await runValue(sessionId, m), m.nodeKey).not.toBe(false)
			expect((await gangedOption()).value).toBe(true)
		})

		it("inside a session it reaches every member in the session's registration values", async () => {
			const { writeOption, clearOption } = await import("$lib/server/pipelines/config/panel")
			const sessionId = await makeSession()
			const id = (await gangedOption(sessionId)).id
			await writeOption(db, SECRET, STORY_RESPOND_SPEC_ID, viewerOf(sessionId), id, false)
			const rows = await db
				.select()
				.from(schema.registrations)
				.where(eq(schema.registrations.scopeRef, String(sessionId)))
			const held = rows.flatMap((r) => {
				const values = (r.values ?? {}) as Record<string, Record<string, any>>
				return members.filter((m) => values[m.nodeKey]?.[m.slot]?.[m.path] === false).map((m) => m.nodeKey)
			})
			for (const m of members) expect(held, m.nodeKey).toContain(m.nodeKey)
			for (const m of members) expect(await runValue(sessionId, m), m.nodeKey).toBe(false)
			const o = await gangedOption(sessionId)
			expect(o.value).toBe(false)
			expect(o.source).toBe("session")

			await clearOption(db, SECRET, STORY_RESPOND_SPEC_ID, viewerOf(sessionId), id)
			for (const m of members) expect(await runValue(sessionId, m), m.nodeKey).not.toBe(false)
			expect((await gangedOption(sessionId)).value).toBe(true)
		})

		it("a mixed state shows the majority value and how many differ", async () => {
			const { writeOption, clearOption } = await import("$lib/server/pipelines/config/panel")
			const gangId = (await gangedOption()).id
			await writeOption(db, SECRET, STORY_RESPOND_SPEC_ID, viewerOf(), await idOf(members[0]!), false)
			let o = await gangedOption()
			expect(o.value).toBe(true)
			expect(o.provenance.label).toBe("Set differently on 1 of this pipeline's reads")
			expect(o.changed).toBe(true)
			for (const m of members.slice(1))
				await writeOption(db, SECRET, STORY_RESPOND_SPEC_ID, viewerOf(), await idOf(m), false)
			o = await gangedOption()
			expect(o.value).toBe(false)
			expect(o.provenance).toBeUndefined()
			await writeOption(db, SECRET, STORY_RESPOND_SPEC_ID, viewerOf(), await idOf(members[0]!), true)
			o = await gangedOption()
			// A tie between two reads shows the declared default.
			expect(o.value).toBe(members.length === 2)
			expect(o.provenance.label).toBe("Set differently on 1 of this pipeline's reads")
			await clearOption(db, SECRET, STORY_RESPOND_SPEC_ID, viewerOf(), gangId)
			expect((await gangedOption()).provenance).toBeUndefined()
		})
	})

	describe("the session settings form follows the same one control", () => {
		it("shows one field for Story's reply and its write reaches every member", async () => {
			const { settingsForm, formFields, stepOfField } = await import("$lib/server/sessions/settingsForm")
			const [user] = await db.insert(schema.users).values({ username: `ganged-form-${++seq}`, isAdmin: true }).returning()
			const [session] = await db
				.insert(schema.sessions)
				.values({ userId: user!.id, isGroup: false, genreId: STORY_GENRE_ID } as any)
				.returning()
			const viewer = { userId: user!.id, isAdmin: true }
			const fieldsNow = async () =>
				formFields(await settingsForm(db as any, session!.id, viewer)).filter(
					(f: any) => f.label === LABEL && stepOfField(f)?.spec === STORY_RESPOND_SPEC_ID
				)
			const before = await fieldsNow()
			expect(before).toHaveLength(1)
			expect((before[0] as any).address).toMatchObject({ kind: "pipeline", nodeKey: HOME })
			expect((before[0] as any).value).toBe(true)

			const { updateSetting } = await import("$lib/server/sessions/settingsForm")
			await updateSetting(db as any, session!.id, viewer, (before[0] as any).address, false)
			expect((await fieldsNow())[0]).toMatchObject({ value: false })
			for (const m of members) expect(await runValue(session!.id, m), m.nodeKey).toBe(false)
		})
	})

	describe("reads that inherit different values", () => {
		it("a written value resolves on every read, through the panel and through the form alike", async () => {
			const { writeOption, clearOption } = await import("$lib/server/pipelines/config/panel")
			const { settingsForm, formFields, stepOfField, updateSetting } = await import("$lib/server/sessions/settingsForm")
			// One read inherits `false` (an instance value); the others inherit the default `true`.
			const oddId = await idOf(members[0]!)
			await writeOption(db, SECRET, STORY_RESPOND_SPEC_ID, viewerOf(), oddId, false)
			try {
				const panelSession = await makeSession()
				const gangId = (await gangedOption(panelSession)).id
				const [user] = await db.insert(schema.users).values({ username: `ganged-mixed-${++seq}`, isAdmin: true }).returning()
				const [formSession] = await db
					.insert(schema.sessions)
					.values({ userId: user!.id, isGroup: false, genreId: STORY_GENRE_ID } as any)
					.returning()
				const viewer = { userId: user!.id, isAdmin: true }
				const formAddress = async () =>
					(
						formFields(await settingsForm(db as any, formSession!.id, viewer)).find(
							(f: any) => f.label === LABEL && stepOfField(f)?.spec === STORY_RESPOND_SPEC_ID
						) as any
					).address
				for (const written of [true, false, true]) {
					await writeOption(db, SECRET, STORY_RESPOND_SPEC_ID, viewerOf(panelSession), gangId, written)
					await updateSetting(db as any, formSession!.id, viewer, await formAddress(), written)
					for (const m of members) {
						expect(await runValue(panelSession, m), `panel ${m.nodeKey} ${written}`).toBe(written)
						expect(await runValue(formSession!.id, m), `form ${m.nodeKey} ${written}`).toBe(written)
					}
				}
			} finally {
				await clearOption(db, SECRET, STORY_RESPOND_SPEC_ID, viewerOf(), oddId)
			}
		})
	})
})
