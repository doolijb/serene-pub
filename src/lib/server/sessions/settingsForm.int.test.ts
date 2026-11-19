/**
 * 🚧 The session's derived settings form (PLAN-layering A9, A10, R1, R32,
 * R36, R37; lane 5b) against the published catalogue: what an owner, an
 * administrator and a guest are shown and may change; locks, reach, fixed at
 * start; routine modes for everyone with the settings, cadence options for
 * administrators; model plumbing refused; values of a pipeline the preset no
 * longer runs left dormant and restored; the start form's asks and the
 * derived numbers carried with the preset list.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 })

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, dbReady: Promise.resolve() }
})

let testDb: TestDb
let dataDir: string

const STORY = "core:genre/story"
const REPLY = "core:spec/story-respond"
const SWEEP = "every-n-turns→story-sweep"
const RECKONING = "after-each-round→story-reckoning"

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-settings-form-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(testDb as any)
})

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

async function presetId(seedKey: string): Promise<number> {
	const [p] = await testDb
		.select({ id: schema.sessionPresets.id })
		.from(schema.sessionPresets)
		.where(eq(schema.sessionPresets.seedKey, seedKey))
	return p!.id
}

let seq = 0
async function makeSession(
	seedKey = "core-story-living",
	over: Record<string, unknown> = {}
) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `settings-form-${++seq}`)
	const [lorebook] = await testDb
		.insert(schema.lorebooks)
		.values({ name: `Form Book ${seq}`, userId: user.id })
		.returning()
	const [session] = await testDb
		.insert(schema.sessions)
		.values({
			userId: user.id,
			isGroup: false,
			lorebookId: lorebook!.id,
			genreId: STORY,
			presetId: await presetId(seedKey),
			primaryRuleset: "core:ruleset/freeform@1",
			rigour: "prose",
			...over
		} as any)
		.returning()
	return { user, session: session! }
}

const owner = (w: { user: { id: number } }) => ({
	userId: w.user.id,
	isAdmin: false
})
const admin = (w: { user: { id: number } }) => ({
	userId: w.user.id,
	isAdmin: true
})

async function form(
	w: { session: { id: number } },
	viewer: { userId: number; isAdmin: boolean }
) {
	const { settingsForm } = await import("./settingsForm")
	return settingsForm(testDb as any, w.session.id, viewer)
}

const fieldsOf = async (f: Awaited<ReturnType<typeof form>>) =>
	(await import("./settingsForm")).formFields(f)

describe("who sees what (R1)", () => {
	test("the owner: the genre's owner-reach fields, the ruleset fixed and read-only, How strict theirs to change, the reply's own switches, each routine's mode — never plumbing", async () => {
		const w = await makeSession()
		const f = await form(w, owner(w))
		expect(f.viewer).toBe("owner")
		const genre = f.groups.find((g) => g.kind === "genre")!
		const keys = genre.fields.map((x) => (x.address as { key: string }).key)
		expect(keys).toEqual(
			expect.arrayContaining(["sideCast", "narratorInterjections"])
		)
		// R55: Rest follows the reckoning's mode — no field of its own.
		expect(keys).not.toContain("applyActionChanges")
		// The ruleset is fixed at start (R32); How strict may change mid-session
		// unless a layer locks it (PLAN-rulesets §21, main-session ruling 2026-10-20).
		const ruleset = genre.fields.find(
			(x) => (x.address as { key: string }).key === "ruleset"
		)!
		expect(ruleset).toMatchObject({ fixed: true, editable: false })
		const rigour = genre.fields.find(
			(x) => (x.address as { key: string }).key === "rigour"
		)!
		expect(rigour).toMatchObject({ editable: true, value: "prose" })
		expect(rigour.fixed).toBeUndefined()

		const reply = f.groups.find(
			(g) => g.kind === "registration" && g.pipeline === REPLY
		)!
		expect(reply.registrationKeys).toEqual([
			"message-respond→story-respond"
		])
		const scene = reply.fields.find(
			(x) =>
				x.address.kind === "pipeline" &&
				x.address.nodeKey === "reading" &&
				x.address.path === "scene"
		)
		expect(scene).toMatchObject({
			reach: "owner",
			editable: true,
			value: true,
			control: "boolean"
		})
		// Never a model's plumbing or a model call's parameters — the reply's
		// prompt choice (R54) is the one reference an owner picks.
		for (const x of await fieldsOf(f)) {
			if (x.address.kind !== "pipeline") continue
			expect(["params", "settings", "prompts"]).toContain(x.address.slot)
			expect(x.address.nodeKey).not.toBe("generate")
		}

		const routines = f.groups.find((g) => g.kind === "routines")!.routines!
		expect(routines.map((r) => [r.registrationKey, r.mode])).toEqual(
			expect.arrayContaining([
				[RECKONING, "full"],
				[SWEEP, "full"]
			])
		)
		// Off routines are listed (R8); an owner changes the mode alone (R36, R37).
		// 🚧 R52: the reckoning (after each round) also offers When it runs.
		for (const r of routines)
			expect(
				r.fields.map((x) => (x.address as { field: string }).field)
			).toEqual(
				r.registrationKey === RECKONING ? ["cadence", "mode"] : ["mode"]
			)
	})

	test("🚧 one sprite picker, whichever branch writes the reply — never a copy per branch (RF fix 3)", async () => {
		const w = await makeSession()
		const { replyStepKeys } = await import("$lib/server/utils/testDb")
		const steps = await replyStepKeys(testDb as any, REPLY)
		const pickerKey = steps.spritePick!
		for (const viewer of [owner(w), admin(w)]) {
			const reply = (await form(w, viewer)).groups.find(
				(g) => g.kind === "registration" && g.pipeline === REPLY
			)!
			const pickers = new Set(
				reply.fields
					.filter(
						(x) =>
							x.address.kind === "pipeline" &&
							x.address.nodeKey.endsWith(pickerKey)
					)
					.map((x) => (x.address as { nodeKey: string }).nodeKey)
			)
			expect([...pickers], viewer.isAdmin ? "admin" : "owner").toEqual([
				pickerKey
			])
		}
	})

	test("an administrator in their own session: every setting, cadence options, Allow stacking", async () => {
		const w = await makeSession()
		const asOwner = await fieldsOf(await form(w, owner(w)))
		const f = await form(w, admin(w))
		expect(f.viewer).toBe("admin")
		const all = await fieldsOf(f)
		expect(all.length).toBeGreaterThan(asOwner.length)
		const sweep = f.groups
			.find((g) => g.kind === "routines")!
			.routines!.find((r) => r.registrationKey === SWEEP)!
		expect(
			sweep.fields.map((x) => (x.address as { field: string }).field)
		).toEqual(["mode", "cadence.n", "allowStacking"])
		expect(sweep.fields[1]).toMatchObject({
			value: 5,
			control: "integer",
			min: 1,
			reach: "admin"
		})
		expect(sweep.cadence).toMatchObject({
			id: "core:cadence/every-n-turns@1",
			options: { n: 5 }
		})
		// Fixed at start is read-only for an administrator too (R32): the ruleset.
		const genre = f.groups.find((g) => g.kind === "genre")!
		expect(
			genre.fields.find(
				(x) => (x.address as { key?: string }).key === "ruleset"
			)!.editable
		).toBe(false)
		expect(
			genre.fields.find(
				(x) => (x.address as { key?: string }).key === "rigour"
			)!.editable
		).toBe(true)
	})

	test("How strict through the form: the column is written; one the genre does not offer is refused", async () => {
		const w = await makeSession("core-story-living", { primaryRuleset: "core:ruleset/vis-itineris@1" })
		const { updateSetting, SettingRefusal } = await import("./settingsForm")
		const address = { kind: "genre" as const, key: "rigour" }
		const done = await updateSetting(
			testDb as any,
			w.session.id,
			owner(w),
			address,
			"mechanics"
		)
		expect(done.changes).toBe("rigour")
		const schema = await import("$lib/server/db/schema")
		const { eq } = await import("drizzle-orm")
		const [row] = await testDb
			.select({
				rigour: schema.sessions.rigour,
				genreFields: schema.sessions.genreFields
			})
			.from(schema.sessions)
			.where(eq(schema.sessions.id, w.session.id))
		expect(row!.rigour).toBe("mechanics")
		expect(
			(row!.genreFields as Record<string, unknown>).rigour
		).toBeUndefined()
		await expect(
			updateSetting(
				testDb as any,
				w.session.id,
				owner(w),
				address,
				"nonsense"
			)
		).rejects.toBeInstanceOf(SettingRefusal)
	})

	test("How strict through the form: Freeform plays Words only, so Rules is refused and nothing is written", async () => {
		const w = await makeSession()
		const { updateSetting, SettingRefusal } = await import("./settingsForm")
		await expect(
			updateSetting(testDb as any, w.session.id, owner(w), { kind: "genre", key: "rigour" }, "mechanics")
		).rejects.toBeInstanceOf(SettingRefusal)
		const [row] = await testDb.select({ rigour: schema.sessions.rigour }).from(schema.sessions).where(eq(schema.sessions.id, w.session.id))
		expect(row!.rigour).toBe("prose")
	})

	test("How strict through the form: a layer that locks it still refuses as a lock", async () => {
		const w = await makeSession("core-story-rule-based", { primaryRuleset: "core:ruleset/vis-itineris@1", rigour: "scripts" })
		const { updateSetting, SettingRefusal } = await import("./settingsForm")
		await expect(
			updateSetting(testDb as any, w.session.id, owner(w), { kind: "genre", key: "rigour" }, "prose")
		).rejects.toBeInstanceOf(SettingRefusal)
		const [row] = await testDb.select({ rigour: schema.sessions.rigour }).from(schema.sessions).where(eq(schema.sessions.id, w.session.id))
		expect(row!.rigour).toBe("scripts")
	})

	test("a guest reaches nothing here, and every write is refused", async () => {
		const w = await makeSession()
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const guest = await createTestUser(
			testDb,
			`settings-form-guest-${++seq}`
		)
		await testDb
			.insert(schema.sessionGuests)
			.values({ sessionId: w.session.id, userId: guest.id } as any)
		const f = await form(w, { userId: guest.id, isAdmin: false })
		expect(f.groups).toEqual([])
		expect(f.error).toMatch(/owner/)
		const { updateSetting, SettingRefusal } = await import("./settingsForm")
		await expect(
			updateSetting(
				testDb as any,
				w.session.id,
				{ userId: guest.id, isAdmin: true },
				{ kind: "genre", key: "sideCast" },
				true
			)
		).rejects.toBeInstanceOf(SettingRefusal)
	})
})

describe("writing through the cascade", () => {
	test("a genre field: stored at the session layer; the inherited value (or null) clears it", async () => {
		const w = await makeSession()
		const { updateSetting } = await import("./settingsForm")
		await updateSetting(
			testDb as any,
			w.session.id,
			owner(w),
			{ kind: "genre", key: "sideCast" },
			true
		)
		let [row] = await testDb
			.select()
			.from(schema.sessions)
			.where(eq(schema.sessions.id, w.session.id))
		expect((row!.genreFields as Record<string, unknown>).sideCast).toBe(
			true
		)
		const { genreFieldsFor } = await import(
			"$lib/server/pipelines/entities/sessionGenres"
		)
		expect(
			(await genreFieldsFor(testDb as any, w.session.id)).sideCast
		).toBe(true)
		await updateSetting(
			testDb as any,
			w.session.id,
			owner(w),
			{ kind: "genre", key: "sideCast" },
			null
		)
		;[row] = await testDb
			.select()
			.from(schema.sessions)
			.where(eq(schema.sessions.id, w.session.id))
		expect("sideCast" in ((row!.genreFields ?? {}) as object)).toBe(false)
	})

	test("a pipeline setting lands on the session's registration row, where the run reads it (A9)", async () => {
		const w = await makeSession()
		const { updateSetting } = await import("./settingsForm")
		const address = {
			kind: "pipeline" as const,
			registrationKey: "message-respond→story-respond",
			nodeKey: "reading",
			slot: "params",
			path: "scene"
		}
		await updateSetting(
			testDb as any,
			w.session.id,
			owner(w),
			address,
			false
		)
		const { registrationValueLayers } = await import(
			"$lib/server/pipelines/registrations/values"
		)
		const layers = await registrationValueLayers(testDb as any, {
			specSlug: REPLY,
			sessionId: w.session.id
		})
		expect(layers.session).toEqual({
			reading: { params: { scene: false } }
		})
		const f = await form(w, owner(w))
		const scene = (await fieldsOf(f)).find(
			(x) =>
				x.id ===
				JSON.stringify([
					"pipeline",
					address.registrationKey,
					"reading",
					"params",
					"scene"
				])
		)!
		expect(scene).toMatchObject({
			value: false,
			source: "session",
			inherited: true
		})
		// Back to what it inherits: no row left with nothing to say.
		await updateSetting(
			testDb as any,
			w.session.id,
			owner(w),
			address,
			true
		)
		const rows = await testDb
			.select()
			.from(schema.registrations)
			.where(
				and(
					eq(schema.registrations.scopeKind, "session"),
					eq(schema.registrations.scopeRef, String(w.session.id))
				)
			)
		expect(rows).toEqual([])
	})

	test("model plumbing is refused at the write, for an owner and an administrator alike", async () => {
		const w = await makeSession()
		const { updateSetting, SettingRefusal } = await import("./settingsForm")
		for (const viewer of [owner(w), admin(w)])
			await expect(
				updateSetting(
					testDb as any,
					w.session.id,
					viewer,
					{
						kind: "pipeline",
						registrationKey: "message-respond→story-respond",
						nodeKey: "generate",
						slot: "connection",
						path: ""
					},
					1
				)
			).rejects.toThrow(/administrator's, in the pipeline's own settings/)
		// A prompt slot the form does not show is not plumbing: the other sentence.
		for (const viewer of [owner(w), admin(w)])
			await expect(
				updateSetting(
					testDb as any,
					w.session.id,
					viewer,
					{
						kind: "pipeline",
						registrationKey: "message-respond→story-respond",
						nodeKey: "generate",
						slot: "prompts",
						path: ""
					},
					1
				)
			).rejects.toThrow(/not a setting this session offers you here/)
		// The ruleset is fixed at start (R32): read-only through the form.
		await expect(
			updateSetting(
				testDb as any,
				w.session.id,
				owner(w),
				{ kind: "genre", key: "ruleset" },
				"core:ruleset/vis-itineris@1"
			)
		).rejects.toBeInstanceOf(SettingRefusal)
	})

	test("routines: anyone with the settings picks the mode (R37); only an administrator changes the cadence (R36), through the door", async () => {
		const w = await makeSession()
		const { updateSetting, SettingRefusal } = await import("./settingsForm")
		const { effectiveRegistrations } = await import(
			"$lib/server/pipelines/registrations/resolve"
		)
		await updateSetting(
			testDb as any,
			w.session.id,
			owner(w),
			{ kind: "routine", registrationKey: SWEEP, field: "mode" },
			"review"
		)
		let sweep = (await effectiveRegistrations(
			testDb as any,
			w.session.id
		))!.effective.find((r) => r.key === SWEEP)!
		expect(sweep.mode).toBe("review")

		await expect(
			updateSetting(
				testDb as any,
				w.session.id,
				owner(w),
				{ kind: "routine", registrationKey: SWEEP, field: "cadence.n" },
				3
			)
		).rejects.toBeInstanceOf(SettingRefusal)
		await updateSetting(
			testDb as any,
			w.session.id,
			admin(w),
			{ kind: "routine", registrationKey: SWEEP, field: "cadence.n" },
			3
		)
		sweep = (await effectiveRegistrations(
			testDb as any,
			w.session.id
		))!.effective.find((r) => r.key === SWEEP)!
		// The options changed; the identity did not (A8).
		expect(sweep.trigger).toMatchObject({
			family: "routine",
			cadence: { options: { n: 3 } }
		})
		expect(sweep.mode).toBe("review")
		await expect(
			updateSetting(
				testDb as any,
				w.session.id,
				admin(w),
				{ kind: "routine", registrationKey: SWEEP, field: "cadence.n" },
				0
			)
		).rejects.toThrow(/at least 1/)
	})
})

describe("locks (A10) and dormant values (A9)", () => {
	test("a value a preset locks: the owner sees it read-only with its cause, an administrator too, every run reads it, a write is refused", async () => {
		const [p] = await testDb
			.insert(schema.sessionPresets)
			.values({
				name: `Locked asides ${++seq}`,
				genreId: STORY,
				bindings: {},
				enabled: true,
				isDefault: false,
				isImmutable: false,
				settings: { narratorInterjections: { value: true, lock: true } }
			} as any)
			.returning()
		const w = await makeSession("core-story-living", {
			presetId: p!.id,
			genreFields: { narratorInterjections: false }
		})
		const asides = async (viewer: ReturnType<typeof owner>) =>
			(await fieldsOf(await form(w, viewer))).find(
				(x) =>
					(x.address as { key?: string }).key === "narratorInterjections"
			)!
		const ownerField = await asides(owner(w))
		expect(ownerField).toMatchObject({
			value: "every-round",
			lockedAt: "preset",
			editable: false,
			readOnlyReason: "Set by the session's preset."
		})
		expect(await asides(admin(w))).toMatchObject({
			value: "every-round",
			lockedAt: "preset",
			editable: false
		})
		const { genreFieldsFor } = await import(
			"$lib/server/pipelines/entities/sessionGenres"
		)
		expect(
			(await genreFieldsFor(testDb as any, w.session.id))
				.narratorInterjections
		).toBe(true)
		const { updateSetting, SettingRefusal } = await import("./settingsForm")
		const err = await updateSetting(
			testDb as any,
			w.session.id,
			owner(w),
			ownerField.address,
			"never"
		).catch((e) => e)
		expect(err).toBeInstanceOf(SettingRefusal)
		expect(err.message).toBe(
			`${ownerField.label}: Set by the session's preset. Nothing was saved.`
		)
		const [row] = await testDb
			.select({ genreFields: schema.sessions.genreFields })
			.from(schema.sessions)
			.where(eq(schema.sessions.id, w.session.id))
		expect(
			(row!.genreFields as Record<string, unknown>).narratorInterjections
		).toBe(false)
	})

	test("a value the genre's pins lock: the owner sees it read-only, set by the genre", async () => {
		// The spec version the genre list reads its pins from: the active one of
		// the create pipeline the Story genre's defaults register on session-created.
		const { sessionEvents } = await import("@serene-pub/sdk")
		const created = await testDb
			.select({ slug: schema.registrations.specSlug })
			.from(schema.registrations)
			.where(
				and(
					eq(schema.registrations.scopeKind, "genre"),
					eq(schema.registrations.scopeRef, STORY),
					eq(schema.registrations.triggerRef, sessionEvents.sessionCreated),
					eq(schema.registrations.dropped, false)
				)
			)
		const rows = (
			await testDb
				.select({
					id: schema.pipelineSpecVersions.id,
					genre: schema.pipelineSpecVersions.genre,
					slug: schema.pipelineSpecs.slug
				})
				.from(schema.pipelineSpecVersions)
				.innerJoin(
					schema.pipelineSpecs,
					eq(schema.pipelineSpecs.activeVersionId, schema.pipelineSpecVersions.id)
				)
		).filter((r) => created.some((c) => c.slug === r.slug) && (r.genre as any)?.shape)
		expect(rows.length, "the Story genre's active spec version").toBeGreaterThan(0)
		const w = await makeSession("core-story-living", {
			genreFields: { sideCast: false }
		})
		const pinned = async (settings: unknown) => {
			for (const r of rows)
				await testDb
					.update(schema.pipelineSpecVersions)
					.set({ genre: { ...(r.genre as object), settings } as never })
					.where(eq(schema.pipelineSpecVersions.id, r.id))
		}
		try {
			await pinned({ sideCast: { value: true, lock: true } })
			const field = (await fieldsOf(await form(w, owner(w)))).find(
				(x) => (x.address as { key?: string }).key === "sideCast"
			)!
			expect(field).toMatchObject({
				value: true,
				lockedAt: "genre",
				editable: false,
				readOnlyReason: "Set by the session's genre."
			})
		} finally {
			for (const r of rows)
				await testDb
					.update(schema.pipelineSpecVersions)
					.set({ genre: r.genre as never })
					.where(eq(schema.pipelineSpecVersions.id, r.id))
		}
	})

	test("How strict under the shipped Rule Based preset: the owner sees it read-only, set by the preset", async () => {
		const w = await makeSession("core-story-rule-based")
		const field = (await fieldsOf(await form(w, owner(w)))).find(
			(x) => (x.address as { key?: string }).key === "rigour"
		)!
		expect(field).toMatchObject({
			value: "scripts",
			lockedAt: "preset",
			editable: false,
			readOnlyReason: "Set by the session's preset."
		})
	})

	describe("a pipeline setting a layer above locks (genre-scope change row)", () => {
		async function lockedAt<T>(
			sessionId: number,
			address: { nodeKey: string; slot: string; path: string },
			decision: unknown,
			body: (set: (d: unknown) => Promise<void>) => Promise<T>
		): Promise<T> {
			const { registrationValueLayers } = await import(
				"$lib/server/pipelines/registrations/values"
			)
			const { genreChangeKey } = await import(
				"$lib/server/pipelines/registrations/rows"
			)
			const { invalidateRegistrations } = await import(
				"$lib/server/pipelines/registrations/resolve"
			)
			const { key } = await registrationValueLayers(testDb as any, {
				specSlug: REPLY,
				sessionId
			})
			expect(key, "the session's reply registration").toBeTruthy()
			const stated = (d: unknown) => ({
				[address.nodeKey]: { [address.slot]: { [address.path]: d } }
			})
			const [row] = await testDb
				.insert(schema.registrations)
				.values({
					scopeKind: "genre",
					scopeRef: STORY,
					key: genreChangeKey(key!),
					dropped: false,
					origin: "test:lock",
					values: stated(decision) as never
				} as any)
				.returning()
			invalidateRegistrations()
			try {
				return await body(async (d) => {
					await testDb
						.update(schema.registrations)
						.set({ values: stated(d) as never })
						.where(eq(schema.registrations.id, row!.id))
					invalidateRegistrations()
				})
			} finally {
				await testDb
					.delete(schema.registrations)
					.where(eq(schema.registrations.id, row!.id))
				invalidateRegistrations()
			}
		}
		const replyFields = async (
			w: Parameters<typeof form>[0],
			viewer: ReturnType<typeof owner>
		) =>
			(await form(w, viewer)).groups
				.find((g) => g.kind === "registration" && g.pipeline === REPLY)!
				.fields
		const sameAddress = (a: any, b: any) =>
			addressIdOf(a) === addressIdOf(b)
		const addressIdOf = (a: any) =>
			JSON.stringify([a.nodeKey, a.slot, a.path])

		test("a plain owner-reach row: read-only with its cause for the owner and the administrator; the stale own value is kept", async () => {
			const w = await makeSession()
			const { updateSetting, SettingRefusal } = await import("./settingsForm")
			const find = async (viewer: ReturnType<typeof owner>) =>
				(await replyFields(w, viewer)).find(
					(x) =>
						x.address.kind === "pipeline" &&
						x.address.nodeKey === "reading" &&
						x.address.path === "scene"
				)!
			const open = await find(owner(w))
			expect(open).toMatchObject({ editable: true, value: true })
			const address = open.address as any
			await updateSetting(testDb as any, w.session.id, owner(w), address, false)
			expect((await find(owner(w))).value).toBe(false)
			await lockedAt(w.session.id, address, { value: true, lock: true }, async () => {
				for (const viewer of [owner(w), admin(w)]) {
					expect(await find(viewer)).toMatchObject({
						editable: false,
						lockedAt: "genre",
						value: true,
						readOnlyReason: "Set by the session's genre."
					})
				}
				const err = await updateSetting(
					testDb as any,
					w.session.id,
					owner(w),
					address,
					false
				).catch((e) => e)
				expect(err).toBeInstanceOf(SettingRefusal)
				expect(err.message).toBe(
					`${open.label}: Set by the session's genre. Nothing was saved.`
				)
			})
			// the stale own value was kept under the lock
			expect(await find(owner(w))).toMatchObject({
				editable: true,
				value: false
			})
		})

		test("a plumbing or model-step setting locked the same way stays absent from the owner's form, read-only for the administrator", async () => {
			const w = await makeSession()
			const ownerAddrs = (await replyFields(w, owner(w))).map((x) =>
				addressIdOf(x.address)
			)
			const hidden = (await replyFields(w, admin(w))).find(
				(x) =>
					x.address.kind === "pipeline" &&
					x.address.slot !== "prompts" &&
					!ownerAddrs.includes(addressIdOf(x.address))
			)
			expect(hidden, "an admin-only setting in the reply").toBeTruthy()
			const address = hidden!.address as any
			await lockedAt(
				w.session.id,
				address,
				{ value: hidden!.value ?? hidden!.inherited, lock: true },
				async () => {
					expect(
						(await replyFields(w, owner(w))).some((x) =>
							sameAddress(x.address, address)
						)
					).toBe(false)
					expect(
						(await replyFields(w, admin(w))).find((x) =>
							sameAddress(x.address, address)
						)
					).toMatchObject({ editable: false, lockedAt: "genre" })
				}
			)
		})

		test("a prompt row under a null lock shows the prompt below it, read-only, the own choice kept", async () => {
			const w = await makeSession()
			const { updateSetting } = await import("./settingsForm")
			const promptOf = async (viewer: ReturnType<typeof owner>) =>
				(await replyFields(w, viewer)).find(
					(x) =>
						(x.address as { slot?: string }).slot === "prompts" &&
						(x.address as { nodeKey?: string }).nodeKey === "context"
				)!
			const open = await promptOf(owner(w))
			const choice = (open.members ?? []).map((m) => m.key).find((k) => k !== open.value)
			expect(choice, "a second prompt to choose").toBeTruthy()
			const address = open.address as any
			await updateSetting(testDb as any, w.session.id, owner(w), address, choice!)
			await lockedAt(w.session.id, address, { value: null, lock: true }, async () => {
				for (const viewer of [owner(w), admin(w)]) {
					const row = await promptOf(viewer)
					expect(row).toMatchObject({ editable: false, lockedAt: "genre" })
					expect(row.value).not.toBeNull()
					expect(row.value).toBe(open.value)
					expect(row.value).not.toBe(choice)
				}
			})
			expect((await promptOf(owner(w))).value).toBe(choice)
		}, 60_000)

		test("a prompt row: read-only at the lock's prompt, the own choice kept and back when the lock lifts", async () => {
			const w = await makeSession()
			const { updateSetting, SettingRefusal } = await import("./settingsForm")
			const promptOf = async (viewer: ReturnType<typeof owner>) =>
				(await replyFields(w, viewer)).find(
					(x) =>
						(x.address as { slot?: string }).slot === "prompts" &&
						(x.address as { nodeKey?: string }).nodeKey === "context"
				)!
			const open = await promptOf(owner(w))
			const keys = (open.members ?? []).map((m) => m.key)
			const choice = keys.find((k) => k !== open.value)
			expect(choice, "a second prompt to choose").toBeTruthy()
			const address = open.address as any
			await updateSetting(testDb as any, w.session.id, owner(w), address, choice!)
			expect((await promptOf(owner(w))).value).toBe(choice)
			const { registrationValueLayers } = await import(
				"$lib/server/pipelines/registrations/values"
			)
			const storedOwn = async () =>
				JSON.stringify(
					(
						await registrationValueLayers(testDb as any, {
							specSlug: REPLY,
							sessionId: w.session.id
						})
					).session
				)
			await lockedAt(
				w.session.id,
				address,
				{ value: Number(open.value), lock: true },
				async () => {
					for (const viewer of [owner(w), admin(w)]) {
						expect(await promptOf(viewer)).toMatchObject({
							editable: false,
							lockedAt: "genre",
							value: open.value,
							readOnlyReason: "Set by the session's genre."
						})
					}
					const err = await updateSetting(
						testDb as any,
						w.session.id,
						owner(w),
						address,
						choice!
					).catch((e) => e)
					expect(err).toBeInstanceOf(SettingRefusal)
					expect(err.message).toBe(
						`Reply · prose prompt: Set by the session's genre. Nothing was saved.`
					)
					expect(await storedOwn()).toContain(`:${choice}`)
				}
			)
			expect(await promptOf(owner(w))).toMatchObject({
				editable: true,
				value: choice
			})
		})
	})

	test("a guest still reaches nothing, a lock or none", async () => {
		const [p] = await testDb
			.insert(schema.sessionPresets)
			.values({
				name: `Locked asides ${++seq}`,
				genreId: STORY,
				bindings: {},
				enabled: true,
				isDefault: false,
				isImmutable: false,
				settings: { narratorInterjections: { value: true, lock: true } }
			} as any)
			.returning()
		const w = await makeSession("core-story-living", { presetId: p!.id })
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const guest = await createTestUser(testDb, `settings-form-guest-${++seq}`)
		await testDb
			.insert(schema.sessionGuests)
			.values({ sessionId: w.session.id, userId: guest.id } as any)
		const f = await form(w, { userId: guest.id, isAdmin: false })
		expect(f.groups).toEqual([])
	})

	test("a preset that drops a routine leaves the session's values for it dormant; switching back restores them", async () => {
		const w = await makeSession("core-story-living")
		const { updateSetting } = await import("./settingsForm")
		const { effectiveRegistrations } = await import(
			"$lib/server/pipelines/registrations/resolve"
		)
		await updateSetting(
			testDb as any,
			w.session.id,
			owner(w),
			{ kind: "routine", registrationKey: SWEEP, field: "mode" },
			"review"
		)
		await testDb
			.update(schema.sessions)
			.set({ presetId: await presetId("core-story-minimal") })
			.where(eq(schema.sessions.id, w.session.id))
		expect(
			(await effectiveRegistrations(
				testDb as any,
				w.session.id
			))!.effective.some((r) => r.key === SWEEP)
		).toBe(false)
		const kept = await testDb
			.select()
			.from(schema.registrations)
			.where(
				and(
					eq(schema.registrations.scopeKind, "session"),
					eq(schema.registrations.key, SWEEP),
					eq(schema.registrations.scopeRef, String(w.session.id))
				)
			)
		expect(kept).toHaveLength(1)
		await testDb
			.update(schema.sessions)
			.set({ presetId: await presetId("core-story-living") })
			.where(eq(schema.sessions.id, w.session.id))
		expect(
			(await effectiveRegistrations(
				testDb as any,
				w.session.id
			))!.effective.find((r) => r.key === SWEEP)?.mode
		).toBe("review")
	})
})

describe("the sockets", () => {
	function recorder() {
		const emits: Array<{ event: string; data: any }> = []
		return {
			emits,
			emit: (event: string, data: any) => void emits.push({ event, data })
		}
	}

	test("sessions:settingsForm answers the owner; sessions:updateSetting refuses in a sentence and answers with the form", async () => {
		const w = await makeSession()
		const { sessionsSettingsFormHandler, sessionsUpdateSettingHandler } =
			await import("$lib/server/sockets/sessionSettings")
		const r = recorder()
		const read: any = await sessionsSettingsFormHandler.handler(
			{ user: { id: w.user.id } } as any,
			{ sessionId: w.session.id },
			r.emit
		)
		expect(read.groups.length).toBeGreaterThan(0)
		const refused: any = await sessionsUpdateSettingHandler.handler(
			{ user: { id: w.user.id } } as any,
			{
				sessionId: w.session.id,
				address: {
					kind: "routine",
					registrationKey: SWEEP,
					field: "allowStacking"
				},
				value: true,
				requestId: "a"
			},
			r.emit
		)
		expect(refused).toMatchObject({
			requestId: "a",
			error: expect.stringMatching(/Nothing was saved/)
		})
		const set: any = await sessionsUpdateSettingHandler.handler(
			{ user: { id: w.user.id } } as any,
			{
				sessionId: w.session.id,
				address: {
					kind: "routine",
					registrationKey: SWEEP,
					field: "mode"
				},
				value: "off",
				requestId: "b"
			},
			r.emit
		)
		expect(set.error).toBeUndefined()
		const sweep = set.form.groups
			.find((g: any) => g.kind === "routines")
			.routines.find((x: any) => x.registrationKey === SWEEP)
		expect(sweep.mode).toBe("off")
		expect(r.emits.map((e) => e.event)).toContain("sessions:settingsForm")
		await (
			await import("$lib/server/pipelines/runtime/sessionEvents")
		).settleSessionEvents()
	})
})

describe("When it runs — after each turn or after each round (R52)", () => {
	test("the owner picks it for the reckoning; the registration keeps its key, and a reset gives the preset's back", async () => {
		const { updateSetting } = await import("./settingsForm")
		const { effectiveRegistrations } = await import(
			"$lib/server/pipelines/registrations/resolve"
		)
		const { coreCadences } = await import("@serene-pub/sdk")
		const w = await makeSession()
		const f = await form(w, owner(w))
		const reckoning = f.groups
			.find((g) => g.kind === "routines")!
			.routines!.find((r) => r.registrationKey === RECKONING)!
		const when = reckoning.fields.find(
			(x) => (x.address as { field: string }).field === "cadence"
		)!
		expect(when.label).toBe("When it runs")
		expect(when.editable).toBe(true)
		expect(when.value).toBe(coreCadences.afterEachRound.id)
		expect((when.members ?? []).map((m) => m.key)).toEqual([
			coreCadences.afterEachTurn.id,
			coreCadences.afterEachRound.id
		])
		// The sweep (every n turns) is not one of the two: no choice.
		const sweep = f.groups
			.find((g) => g.kind === "routines")!
			.routines!.find((r) => r.registrationKey === SWEEP)!
		expect(
			sweep.fields.some(
				(x) => (x.address as { field: string }).field === "cadence"
			)
		).toBe(false)

		await updateSetting(
			testDb as any,
			w.session.id,
			owner(w),
			when.address,
			coreCadences.afterEachTurn.id
		)
		const after = await effectiveRegistrations(testDb as any, w.session.id)
		const reg = after!.effective.find((r) => r.key === RECKONING)!
		expect(reg.trigger).toMatchObject({
			family: "routine",
			cadence: { id: coreCadences.afterEachTurn.id }
		})
		const again = await form(w, owner(w))
		const routine = again.groups
			.find((g) => g.kind === "routines")!
			.routines!.find((r) => r.registrationKey === RECKONING)!
		expect(routine.cadence.id).toBe(coreCadences.afterEachTurn.id)
		expect(
			routine.fields.find(
				(x) => (x.address as { field: string }).field === "cadence"
			)!.source
		).toBe("session")

		await updateSetting(
			testDb as any,
			w.session.id,
			owner(w),
			when.address,
			null
		)
		const reset = await effectiveRegistrations(testDb as any, w.session.id)
		expect(
			reset!.effective.find((r) => r.key === RECKONING)!.trigger
		).toMatchObject({
			cadence: { id: coreCadences.afterEachRound.id }
		})
	})
})

describe("each routine's mode on the settings document (R55); Rest at its own mode (G1 ★3)", () => {
	test("the settings document carries each routine's mode by pipeline; Minimal, which drops the reckoning, carries none", async () => {
		const { resolveSessionSettings } = await import("./settings")
		const { updateSetting } = await import("./settingsForm")
		const living = await makeSession()
		const doc = await resolveSessionSettings(
			testDb as any,
			living.session.id
		)
		expect(doc!.routineModes).toMatchObject({
			"core:spec/story-reckoning": "full",
			"core:spec/story-sweep": "full"
		})
		await updateSetting(
			testDb as any,
			living.session.id,
			owner(living),
			{ kind: "routine", registrationKey: RECKONING, field: "mode" },
			"review"
		)
		expect(
			(await resolveSessionSettings(testDb as any, living.session.id))!
				.routineModes!["core:spec/story-reckoning"]
		).toBe("review")
		const minimal = await makeSession("core-story-minimal")
		expect(
			(await resolveSessionSettings(testDb as any, minimal.session.id))!
				.routineModes!["core:spec/story-reckoning"]
		).toBeUndefined()
		await (
			await import("$lib/server/pipelines/runtime/sessionEvents")
		).settleSessionEvents()
	})

	test("Rest applies at its own action's mode — never the reckoning's, read by spec id (GM 2026-10-23, G1 ★3)", async () => {
		const { storyRestSpec } = await import("@serene-pub/core-catalog")
		const doc = storyRestSpec() as unknown as {
			nodes: Array<{ key: string; definitionId: string }>
			clauses?: Array<{ id: string }>
		}
		const text = JSON.stringify(doc)
		// An action registration carries no mode (R37): the press applies, as a rules action's does.
		expect(text).not.toContain("routineModes")
		expect(text).not.toContain("applyActionChanges")
		expect((doc.clauses ?? []).some((c) => c.id === "commit")).toBe(false)
		expect(doc.nodes.find((n) => n.key === "apply")!.definitionId).toBe(
			"core:task/set-state"
		)
	})
})

describe("a template is an administrator's (owner ruling G7, 2026-11-16)", () => {
	test("a spec that marks every step open to the owner still never shows a template or variables slot, nor a model step's setting", async () => {
		const w = await makeSession()
		const was = await testDb
			.select({ id: schema.pipelineNodes.id, expose: schema.pipelineNodes.expose })
			.from(schema.pipelineNodes)
		await testDb
			.update(schema.pipelineNodes)
			.set({ expose: { session: true } as never })
		try {
			const f = await form(w, owner(w))
			const slots = f.groups
				.filter((g) => g.kind === "registration")
				.flatMap((g) => g.fields)
				.filter((x) => x.address.kind === "pipeline")
				.map((x) => (x.address as { slot: string }).slot)
			expect(slots.length).toBeGreaterThan(0)
			for (const slot of slots)
				expect(["params", "settings", "prompts"]).toContain(slot)
		} finally {
			for (const r of was)
				await testDb
					.update(schema.pipelineNodes)
					.set({ expose: r.expose as never })
					.where(eq(schema.pipelineNodes.id, r.id))
		}
	})
})

describe("the reply's prompt is the owner's to choose (R54)", () => {
	test("offered among the pool's prompts an administrator has not hidden; stored on the session's registration; never the text", async () => {
		const { updateSetting, SettingRefusal } = await import("./settingsForm")
		const { setPromptHidden } = await import(
			"$lib/server/pipelines/entities/prompts"
		)
		const { registrationValueLayers } = await import(
			"$lib/server/pipelines/registrations/values"
		)
		const w = await makeSession()
		const promptOf = (f: Awaited<ReturnType<typeof form>>) =>
			f.groups
				.find((g) => g.kind === "registration" && g.pipeline === REPLY)
				?.fields.find(
					(x) =>
						(x.address as { slot?: string }).slot === "prompts" &&
						(x.address as { nodeKey?: string }).nodeKey === "context"
				)
		const field = promptOf(await form(w, owner(w)))!
		expect(
			field,
			"the reply offers its owner no prompt choice"
		).toBeTruthy()
		expect(field.reach).toBe("owner")
		expect(field.editable).toBe(true)
		expect(field.control).toBe("enum")
		const keys = (field.members ?? []).map((m) => m.key)
		expect(keys.length).toBeGreaterThan(0)

		// Hide one the field does not hold: the owner no longer sees it; an administrator does.
		const other = keys.find((k) => k !== field.value) ?? keys[0]!
		await setPromptHidden(testDb as any, Number(other), true)
		try {
			const again = promptOf(await form(w, owner(w)))!
			if (other !== field.value)
				expect((again.members ?? []).map((m) => m.key)).not.toContain(
					other
				)
			const asAdmin = promptOf(await form(w, admin(w)))!
			expect((asAdmin.members ?? []).map((m) => m.key)).toContain(other)
			// A hidden prompt the owner names anyway is refused.
			if (other !== field.value)
				await expect(
					updateSetting(
						testDb as any,
						w.session.id,
						owner(w),
						field.address,
						other
					)
				).rejects.toBeInstanceOf(SettingRefusal)
		} finally {
			await setPromptHidden(testDb as any, Number(other), false)
		}

		// A choice lands on the session's registration of the reply, by id.
		const choice = keys.find((k) => k !== field.value)
		if (choice) {
			await updateSetting(
				testDb as any,
				w.session.id,
				owner(w),
				field.address,
				choice
			)
			const layers = await registrationValueLayers(testDb as any, {
				specSlug: REPLY,
				sessionId: w.session.id
			})
			const nodeKey = (field.address as { nodeKey: string }).nodeKey
			expect(layers.session?.[nodeKey]?.prompts).toBe(Number(choice))
			expect(promptOf(await form(w, owner(w)))!.value).toBe(choice)
			await updateSetting(
				testDb as any,
				w.session.id,
				owner(w),
				field.address,
				null
			)
			expect(
				(
					await registrationValueLayers(testDb as any, {
						specSlug: REPLY,
						sessionId: w.session.id
					})
				).session?.[nodeKey]?.prompts
			).toBeUndefined()
		}
		await (
			await import("$lib/server/pipelines/runtime/sessionEvents")
		).settleSessionEvents()
	})

	test("the reply's prompt row's members are the panel's choices, for an owner and an administrator; another pipeline's prompt is in neither, this pipeline's is in both", async () => {
		const { updateSetting, SettingRefusal } = await import("./settingsForm")
		const { createPrompt, deletePrompt } = await import(
			"$lib/server/pipelines/entities/prompts"
		)
		const { namespaceView } = await import(
			"$lib/server/pipelines/config/panel"
		)
		const { groupOptions } = await import(
			"$lib/server/pipelines/config/panel/groups"
		)
		const { optionId } = await import(
			"$lib/server/pipelines/config/panel/ids"
		)
		const { published, declarations } = await import(
			"$lib/server/pipelines/config/panel/declarations"
		)
		const SECRET = "form-panel-agree-secret"
		const w = await makeSession()
		const promptOf = (f: Awaited<ReturnType<typeof form>>) =>
			f.groups
				.find((g) => g.kind === "registration" && g.pipeline === REPLY)
				?.fields.find(
					(x) =>
						(x.address as { slot?: string }).slot === "prompts" &&
						(x.address as { nodeKey?: string }).nodeKey === "context"
				)
		const panelChoices = async (viewer: {
			userId: number
			isAdmin: boolean
		}) => {
			const field = promptOf(await form(w, viewer))!
			const a = field.address as {
				nodeKey: string
				slot: string
				path?: string
			}
			const view = await namespaceView(testDb as any, SECRET, REPLY, {
				...viewer,
				sessionId: w.session.id
			})
			const id = optionId(SECRET, a.nodeKey, a.slot, a.path ?? "")
			const option = groupOptions(view!.groups).find((o) => o.id === id)
			expect(option, "the panel has no option for the form's row").toBeTruthy()
			return {
				field,
				a,
				members: new Set((field.members ?? []).map((m) => m.key)),
				choices: new Set((option!.choices ?? []).map((c) => String(c.id)))
			}
		}

		for (const viewer of [owner(w), admin(w)]) {
			const { members, choices } = await panelChoices(viewer)
			expect(members.size).toBeGreaterThan(0)
			expect([...members].sort()).toEqual([...choices].sort())
		}

		const at = (await published(testDb as any, REPLY))!
		const base = await panelChoices(owner(w))
		const row = (await declarations(testDb as any, at.specVersionId)).find(
			(d) =>
				d.control === "prompts-ref" &&
				d.nodeKey === base.a.nodeKey &&
				d.slot === base.a.slot
		)!
		const { listPrompts } = await import(
			"$lib/server/pipelines/entities/prompts"
		)
		const pool = await listPrompts(
			testDb as any,
			row.nodeDefinitionId!,
			row.slot
		)
		const source = pool.find((p) => base.members.has(String(p.id)))!
		const [otherSpec] = (
			await testDb.select().from(schema.pipelineSpecs)
		).filter((s: any) => s.id !== at.specId)
		const mk = (name: string, createdForSpecId: number) =>
			createPrompt(testDb as any, {
				nodeDefinitionId: row.nodeDefinitionId!,
				slot: row.slot,
				name,
				fields: { ...source.fields },
				createdForSpecId
			})
		const foreign = await mk(`Agree foreign ${seq}`, otherSpec!.id)
		const own = await mk(`Agree own ${seq}`, at.specId)
		try {
			for (const viewer of [owner(w), admin(w)]) {
				const { members, choices } = await panelChoices(viewer)
				expect([...members].sort()).toEqual([...choices].sort())
				expect(members.has(String(foreign.id))).toBe(false)
				expect(choices.has(String(foreign.id))).toBe(false)
				expect(members.has(String(own.id))).toBe(true)
				expect(choices.has(String(own.id))).toBe(true)
			}
			await expect(
				updateSetting(
					testDb as any,
					w.session.id,
					owner(w),
					base.field.address,
					String(foreign.id)
				)
			).rejects.toBeInstanceOf(SettingRefusal)
		} finally {
			await deletePrompt(testDb as any, foreign.id)
			await deletePrompt(testDb as any, own.id)
		}
		await (
			await import("$lib/server/pipelines/runtime/sessionEvents")
		).settleSessionEvents()
	})
})

describe("the start form and the card (R32, §7)", () => {
	test("the preset list carries what the start form asks and the derived numbers", async () => {
		const { sessionPresetsList } = await import(
			"$lib/server/sockets/sessionAdmin"
		)
		const res: any = await sessionPresetsList.handler(
			{ user: { id: 1, isAdmin: false } } as any,
			{} as any,
			() => {}
		)
		const bySeed = async (k: string) => {
			const id = await presetId(k)
			return res.presets.find((p: any) => p.id === id)
		}
		const living = await bySeed("core-story-living")
		expect(living.derived).toMatchObject({
			callsPerTurn: 2,
			replyCalls: 1,
			routineCalls: 1
		})
		expect((await bySeed("core-story-minimal")).derived.callsPerTurn).toBe(
			1
		)
		// The rules a Story session plays are fixed at start: asked under Living…
		expect(living.asks.map((a: any) => a.key)).toEqual(
			expect.arrayContaining(["ruleset", "rigour"])
		)
		// …and under Rule Based its locked rigour is taken, never asked.
		const ruleBased = await bySeed("core-story-rule-based")
		expect((ruleBased.asks ?? []).map((a: any) => a.key)).not.toContain(
			"rigour"
		)
	})
})

describe("a genre's json field (the json field type)", () => {
	const JSON_GENRE = "acme.jsonfield:inlet/jsonfield"
	const cfgAddress = { kind: "genre" as const, key: "cfg" }

	beforeAll(async () => {
		await testDb.insert(schema.pipelineDefinitionRegistry).values({
			definitionId: JSON_GENRE,
			version: 1,
			kind: "inlet",
			status: "live",
			i18n: { name: { en: "Json Field Test" } },
			ports: {},
			sessionShape: {
				composer: "text",
				characters: { min: 0 },
				fields: {
					cfg: {
						type: "json",
						label: "Config",
						maxBytes: 64,
						jsonSchema: {
							type: "object",
							properties: { n: { type: "integer" } },
							required: ["n"]
						},
						default: { n: 1 }
					},
					// A hostile declaration: held to the ceiling, never the raw number.
					big: {
						type: "json",
						label: "Big",
						maxBytes: 10_000_000_000
					}
				}
			}
		} as any)
	})

	const jsonSession = () =>
		makeSession("core-story-living", {
			genreId: `${JSON_GENRE}@1`,
			presetId: null
		})

	test("an object is stored parsed and resolves as that object; the default resolves parsed too", async () => {
		const w = await jsonSession()
		const { updateSetting } = await import("./settingsForm")
		const { resolveSessionSettings } = await import("./settings")
		expect(
			(await resolveSessionSettings(testDb as any, w.session.id))!.fields
				.cfg
		).toEqual({ n: 1 })
		await updateSetting(testDb as any, w.session.id, admin(w), cfgAddress, {
			n: 7
		})
		const [row] = await testDb
			.select()
			.from(schema.sessions)
			.where(eq(schema.sessions.id, w.session.id))
		expect((row!.genreFields as Record<string, unknown>).cfg).toEqual({
			n: 7
		})
		expect(
			(await resolveSessionSettings(testDb as any, w.session.id))!.fields
				.cfg
		).toEqual({ n: 7 })
		const cfg = (await fieldsOf(await form(w, admin(w)))).find(
			(x) => x.id === JSON.stringify(["genre", "cfg"])
		)!
		expect(cfg).toMatchObject({
			control: "json",
			maxBytes: 64,
			value: { n: 7 }
		})
	})

	test("over the cap and a schema misfit are refused with sentences; nothing is saved", async () => {
		const w = await jsonSession()
		const { updateSetting, SettingRefusal } = await import("./settingsForm")
		await expect(
			updateSetting(testDb as any, w.session.id, admin(w), cfgAddress, {
				n: 1,
				pad: "x".repeat(100)
			})
		).rejects.toThrow(
			/Config: the value is \d+ bytes of JSON, over its 64-byte cap\. Nothing was saved\./
		)
		await expect(
			updateSetting(testDb as any, w.session.id, admin(w), cfgAddress, {
				n: "seven"
			})
		).rejects.toBeInstanceOf(SettingRefusal)
		await expect(
			updateSetting(testDb as any, w.session.id, admin(w), cfgAddress, {
				n: "seven"
			})
		).rejects.toThrow(/Config: .*Nothing was saved\./)
		const [row] = await testDb
			.select()
			.from(schema.sessions)
			.where(eq(schema.sessions.id, w.session.id))
		expect("cfg" in ((row!.genreFields ?? {}) as object)).toBe(false)
	})

	test("a hostile maxBytes declaration is held to the ceiling", async () => {
		const w = await jsonSession()
		const big = (await fieldsOf(await form(w, admin(w)))).find(
			(x) => x.id === JSON.stringify(["genre", "big"])
		)!
		expect(big.maxBytes).toBe(262144)
	})
})

describe("★E-2 — a user-facing field without purpose, group or reach folds under Advanced", () => {
	const FOLD_GENRE = "acme.fold:inlet/fold"
	const keyOf = (x: { address: unknown }) =>
		(x.address as { key: string }).key

	beforeAll(async () => {
		await testDb.insert(schema.pipelineDefinitionRegistry).values({
			definitionId: FOLD_GENRE,
			version: 1,
			kind: "inlet",
			status: "live",
			i18n: { name: { en: "Fold Test" } },
			ports: {},
			sessionShape: {
				composer: "text",
				characters: { min: 0 },
				fields: {
					described: {
						type: "boolean",
						label: "Described",
						description: "Does a thing you can see.",
						group: "Play",
						reach: "owner",
						default: false
					},
					noGroup: {
						type: "boolean",
						label: "No group",
						description: "Does a thing.",
						reach: "owner",
						default: false
					},
					noReach: {
						type: "boolean",
						label: "No reach",
						description: "Does a thing.",
						group: "Play",
						default: false
					},
					noSentence: {
						type: "boolean",
						label: "No sentence",
						group: "Play",
						reach: "owner",
						default: false
					},
					declared: {
						type: "boolean",
						label: "Declared",
						description: "Does a thing.",
						group: "Play",
						reach: "owner",
						advanced: true,
						default: false
					}
				}
			}
		} as any)
	})

	test("undescribed → advanced; described → not; a declared fold stays", async () => {
		const w = await makeSession("core-story-living", {
			genreId: `${FOLD_GENRE}@1`,
			presetId: null
		})
		const f = await form(w, owner(w))
		const genre = f.groups.find((g) => g.kind === "genre")!
		const advanced = (k: string) =>
			genre.fields.find((x) => keyOf(x) === k)!.advanced
		expect(advanced("described")).toBeUndefined()
		expect(advanced("noGroup")).toBe(true)
		expect(advanced("noReach")).toBe(true)
		expect(advanced("noSentence")).toBe(true)
		expect(advanced("declared")).toBe(true)
	})

	test("core's story genre: everyday fields stay out of Advanced; only tone and difficulty fold (pinned)", async () => {
		const w = await makeSession()
		const f = await form(w, owner(w))
		const genre = f.groups.find((g) => g.kind === "genre")!
		const folds = genre.fields
			.filter((x) => x.advanced)
			.map(keyOf)
			.sort()
		expect(folds).toEqual(["difficulty", "tone"])
		expect(genre.fields.map(keyOf)).toEqual(
			expect.arrayContaining([
				"autoAdvance",
				"turnMode",
				"characterDetail",
				"sideCast"
			])
		)
	})

	test("core's story: no pipeline field an owner sees is folded — the fold is an administrator's tuning knobs", async () => {
		const w = await makeSession()
		const f = await form(w, owner(w))
		const folded = (await fieldsOf(f)).filter(
			(x) => x.advanced && x.address.kind === "pipeline"
		)
		expect(folded.map((x) => x.id)).toEqual([])
	})

	test("a disabled plugin's prompt is offered to nobody on either surface unless it is in force; the two lists stay equal", async () => {
		const { deletePrompt } = await import(
			"$lib/server/pipelines/entities/prompts"
		)
		const { namespaceView } = await import("$lib/server/pipelines/config/panel")
		const { groupOptions } = await import("$lib/server/pipelines/config/panel/groups")
		const { optionId } = await import("$lib/server/pipelines/config/panel/ids")
		const { published, declarations } = await import(
			"$lib/server/pipelines/config/panel/declarations"
		)
		const { updateSetting } = await import("./settingsForm")
		const SECRET = "form-panel-plugin-secret"
		const w = await makeSession()
		const promptOf = (f: Awaited<ReturnType<typeof form>>) =>
			f.groups
				.find((g) => g.kind === "registration" && g.pipeline === REPLY)
				?.fields.find(
					(x) =>
						(x.address as { slot?: string }).slot === "prompts" &&
						(x.address as { nodeKey?: string }).nodeKey === "context"
				)!
		const lists = async (viewer: { userId: number; isAdmin: boolean }) => {
			const field = promptOf(await form(w, viewer))
			const a = field.address as { nodeKey: string; slot: string; path?: string }
			const view = await namespaceView(testDb as any, SECRET, REPLY, {
				...viewer,
				sessionId: w.session.id
			})
			const option = groupOptions(view!.groups).find(
				(o) => o.id === optionId(SECRET, a.nodeKey, a.slot, a.path ?? "")
			)!
			const members = (field.members ?? []).map((m) => m.key).sort()
			const choices = (option.choices ?? []).map((c) => String(c.id)).sort()
			return { field, members, choices }
		}
		const at = (await published(testDb as any, REPLY))!
		const base = await lists(owner(w))
		const row = (await declarations(testDb as any, at.specVersionId)).find(
			(d) =>
				d.control === "prompts-ref" &&
				d.nodeKey === (base.field.address as { nodeKey: string }).nodeKey &&
				d.slot === (base.field.address as { slot: string }).slot
		)!
		const [plugin] = await testDb
			.insert(schema.plugins)
			.values({
				pluginId: `acme.prompts-${seq}`,
				name: "Prompts",
				bundleSource: "// x",
				bundleHash: `prompts-${seq}`,
				enabled: false,
				manifest: {}
			})
			.returning()
		const [source] = await testDb
			.select()
			.from(schema.pipelinePrompts)
			.where(eq(schema.pipelinePrompts.id, Number(base.members[0])))
		const [mine] = await testDb
			.insert(schema.pipelinePrompts)
			.values({
				nodeDefinitionId: row.nodeDefinitionId!,
				slot: row.slot,
				name: `Plugin prompt ${seq}`,
				fields: { ...(source!.fields as Record<string, string>) },
				createdForSpecId: at.specId,
				ownerPluginId: plugin!.id
			})
			.returning()
		try {
			// Switched off: nobody's to pick, administrators included.
			{
				const asOwner = await lists(owner(w))
				expect(asOwner.members).toEqual(asOwner.choices)
				expect(asOwner.members).not.toContain(String(mine!.id))
				const asAdmin = await lists(admin(w))
				expect(asAdmin.members).toEqual(asAdmin.choices)
				expect(asAdmin.members).not.toContain(String(mine!.id))
			}
			await expect(
				updateSetting(testDb as any, w.session.id, owner(w), base.field.address, String(mine!.id))
			).rejects.toThrow()
			await expect(
				updateSetting(testDb as any, w.session.id, admin(w), base.field.address, String(mine!.id))
			).rejects.toThrow()
			// In force: the same row is listed by both surfaces.
			await testDb
				.update(schema.plugins)
				.set({ enabled: true })
				.where(eq(schema.plugins.id, plugin!.id))
			await updateSetting(testDb as any, w.session.id, owner(w), base.field.address, String(mine!.id))
			await testDb
				.update(schema.plugins)
				.set({ enabled: false })
				.where(eq(schema.plugins.id, plugin!.id))
			for (const viewer of [owner(w), admin(w)]) {
				const { members, choices } = await lists(viewer)
				expect(members).toEqual(choices)
				expect(members).toContain(String(mine!.id))
			}
		} finally {
			await testDb
				.update(schema.plugins)
				.set({ enabled: true })
				.where(eq(schema.plugins.id, plugin!.id))
			await updateSetting(testDb as any, w.session.id, owner(w), base.field.address, null).catch(() => {})
			await deletePrompt(testDb as any, mine!.id).catch(() => {})
		}
		await (
			await import("$lib/server/pipelines/runtime/sessionEvents")
		).settleSessionEvents()
	})
})

describe("a prompt row on every model call that has a choice", () => {
	const SECRET = "form-prompt-rows-secret"
	const CALLS = [
		{ pipeline: "core:spec/story-respond", nodeKey: "context" },
		{ pipeline: "core:spec/story-generate-image", nodeKey: "render" },
		{ pipeline: "core:spec/story-illustrate-scene", nodeKey: "context" }
	]
	const PRESETS = ["core-story-living", "core-story-minimal", "core-story-rule-based"]
	const promptRows = (f: Awaited<ReturnType<typeof form>>) =>
		f.groups
			.filter((g) => g.kind === "registration")
			.flatMap((g) =>
				g.fields
					.filter((x) => x.address.kind === "pipeline" && x.address.slot === "prompts")
					.map((x) => ({ pipeline: g.pipeline!, field: x }))
			)
	const rowAt = (f: Awaited<ReturnType<typeof form>>, pipeline: string, nodeKey: string) =>
		promptRows(f).find(
			(r) => r.pipeline === pipeline && (r.field.address as { nodeKey: string }).nodeKey === nodeKey
		)?.field
	const panelOption = async (
		w: { session: { id: number } },
		viewer: { userId: number; isAdmin: boolean },
		pipeline: string,
		nodeKey: string
	) => {
		const { namespaceView } = await import("$lib/server/pipelines/config/panel")
		const { groupOptions } = await import("$lib/server/pipelines/config/panel/groups")
		const { optionId } = await import("$lib/server/pipelines/config/panel/ids")
		const view = await namespaceView(testDb as any, SECRET, pipeline, { ...viewer, sessionId: w.session.id })
		return groupOptions(view!.groups).find((o) => o.id === optionId(SECRET, nodeKey, "prompts", ""))
	}
	/** A genre-scope lock on one prompt address of a pipeline, for the session. */
	async function lockPrompt<T>(
		sessionId: number,
		pipeline: string,
		address: { nodeKey: string; slot: string; path: string },
		promptId: number,
		body: () => Promise<T>
	): Promise<T> {
		const { registrationValueLayers } = await import("$lib/server/pipelines/registrations/values")
		const { genreChangeKey } = await import("$lib/server/pipelines/registrations/rows")
		const { invalidateRegistrations } = await import("$lib/server/pipelines/registrations/resolve")
		const { key } = await registrationValueLayers(testDb as any, { specSlug: pipeline, sessionId })
		expect(key, "the session's registration").toBeTruthy()
		const [row] = await testDb
			.insert(schema.registrations)
			.values({
				scopeKind: "genre",
				scopeRef: STORY,
				key: genreChangeKey(key!),
				dropped: false,
				origin: "test:lock",
				values: {
					[address.nodeKey]: { [address.slot]: { [address.path]: { value: promptId, lock: true } } }
				} as never
			} as any)
			.returning()
		invalidateRegistrations()
		try {
			return await body()
		} finally {
			await testDb.delete(schema.registrations).where(eq(schema.registrations.id, row!.id))
			invalidateRegistrations()
		}
	}

	test("per Story preset: a row exactly on the calls the panel offers a choice, named after the call (agent heading, else step label), members equal to the panel's choices, named after the call; none on a call offering one; no advanced gate", async () => {
		const { published, declarations } = await import("$lib/server/pipelines/config/panel/declarations")
		for (const seedKey of PRESETS) {
			const w = await makeSession(seedKey)
			const f = await form(w, owner(w))
			const labels: string[] = []
			for (const g of f.groups.filter((x) => x.kind === "registration")) {
				const at = (await published(testDb as any, g.pipeline!))!
				const decls = (await declarations(testDb as any, at.specVersionId)).filter(
					(d) => d.control === "prompts-ref" && !!d.nodeDefinitionId
				)
				for (const d of decls) {
					const option = await panelOption(w, owner(w), g.pipeline!, d.nodeKey)
					const row = rowAt(f, g.pipeline!, d.nodeKey)
					if ((option?.choices?.length ?? 0) >= 2) {
						expect(row, `${seedKey} ${g.pipeline} ${d.nodeKey}`).toBeTruthy()
						expect((row!.members ?? []).map((m) => Number(m.key))).toEqual(option!.choices!.map((c) => c.id))
						expect(row!.advanced).toBeFalsy()
						labels.push(`${g.pipeline} ${d.nodeKey}: ${row!.label}`)
					} else expect(row, `${seedKey} ${g.pipeline} ${d.nodeKey} offers no choice`).toBeUndefined()
				}
			}
			for (const r of promptRows(f))
				expect(CALLS).toContainEqual({
					pipeline: r.pipeline,
					nodeKey: (r.field.address as { nodeKey: string }).nodeKey
				})
			expect(rowAt(f, CALLS[0]!.pipeline, "context")).toBeTruthy()
			expect(labels).toEqual([
				"core:spec/story-respond context: Reply · prose prompt",
				"core:spec/story-generate-image render: Generate image prompt",
				"core:spec/story-illustrate-scene context: Scene prompt"
			])
		}
	})

	test("a pick through the form is read back by the panel and the run's stored layer; a pick through the panel is the form's value", async () => {
		const { updateSetting } = await import("./settingsForm")
		const { writeOption } = await import("$lib/server/pipelines/config/panel")
		const { optionId } = await import("$lib/server/pipelines/config/panel/ids")
		const { registrationValueLayers } = await import("$lib/server/pipelines/registrations/values")
		const { pipeline, nodeKey } = CALLS[2]!
		const w = await makeSession()
		const row = rowAt(await form(w, owner(w)), pipeline, nodeKey)
		expect(row, "illustrate-scene offers its owner a prompt choice").toBeTruthy()
		const pick = (row!.members ?? []).map((m) => m.key).find((k) => k !== row!.value)!
		await updateSetting(testDb as any, w.session.id, owner(w), row!.address, pick)
		expect((await panelOption(w, owner(w), pipeline, nodeKey))!.value).toBe(Number(pick))
		const layers = await registrationValueLayers(testDb as any, { specSlug: pipeline, sessionId: w.session.id })
		expect(layers.session?.[nodeKey]?.prompts).toBe(Number(pick))
		// Back through the panel, to the other member.
		const other = (row!.members ?? []).map((m) => m.key).find((k) => k !== pick)!
		await writeOption(
			testDb as any,
			SECRET,
			pipeline,
			{ userId: w.user.id, isAdmin: false, sessionId: w.session.id },
			optionId(SECRET, nodeKey, "prompts", ""),
			Number(other)
		)
		expect(rowAt(await form(w, owner(w)), pipeline, nodeKey)!.value).toBe(other)
		await (await import("$lib/server/pipelines/runtime/sessionEvents")).settleSessionEvents()
	})

	test("a lock shows the row read-only in words", async () => {
		const { pipeline, nodeKey } = CALLS[2]!
		const w = await makeSession()
		const open = rowAt(await form(w, owner(w)), pipeline, nodeKey)!
		const locked = Number((open.members ?? []).map((m) => m.key).find((k) => k !== open.value))
		await lockPrompt(w.session.id, pipeline, open.address as any, locked, async () => {
			for (const viewer of [owner(w), admin(w)]) {
				const row = rowAt(await form(w, viewer), pipeline, nodeKey)!
				expect(row).toMatchObject({ editable: false, lockedAt: "genre", value: String(locked) })
				expect(row.readOnlyReason).toBe("Set by the session's genre.")
			}
		})
	})

	test("a guest's form has no prompt row", async () => {
		const w = await makeSession()
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const guest = await createTestUser(testDb, `settings-form-guest-${++seq}`)
		const f = await form(w, { userId: guest.id, isAdmin: false })
		expect(promptRows(f)).toEqual([])
	})

	test("a hidden prompt is an administrator's, with its mark, and a switched-off plugin's is nobody's, unless in force", async () => {
		const { setPromptHidden, deletePrompt } = await import("$lib/server/pipelines/entities/prompts")
		const { published, declarations } = await import("$lib/server/pipelines/config/panel/declarations")
		const { updateSetting } = await import("./settingsForm")
		const { pipeline, nodeKey } = CALLS[0]!
		const w = await makeSession()
		const base = rowAt(await form(w, owner(w)), pipeline, nodeKey)!
		const keys = (base.members ?? []).map((m) => m.key)
		const at = (await published(testDb as any, pipeline))!
		const decl = (await declarations(testDb as any, at.specVersionId)).find(
			(d) => d.control === "prompts-ref" && d.nodeKey === nodeKey
		)!
		const hide = keys.find((k) => k !== base.value)!
		const [source] = await testDb
			.select()
			.from(schema.pipelinePrompts)
			.where(eq(schema.pipelinePrompts.id, Number(hide)))
		const [plugin] = await testDb
			.insert(schema.plugins)
			.values({
				pluginId: `acme.prompt-rows-${seq}`,
				name: "Prompt rows",
				bundleSource: "// x",
				bundleHash: `prompt-rows-${seq}`,
				enabled: false,
				manifest: {}
			})
			.returning()
		const [off] = await testDb
			.insert(schema.pipelinePrompts)
			.values({
				nodeDefinitionId: decl.nodeDefinitionId!,
				slot: decl.slot,
				name: `Off plugin prompt ${seq}`,
				fields: { ...(source!.fields as Record<string, string>) },
				createdForSpecId: at.specId,
				ownerPluginId: plugin!.id
			})
			.returning()
		await setPromptHidden(testDb as any, Number(hide), true)
		try {
			const asOwner = rowAt(await form(w, owner(w)), pipeline, nodeKey)!
			expect((asOwner.members ?? []).map((m) => m.key)).not.toContain(hide)
			expect((asOwner.members ?? []).map((m) => m.key)).not.toContain(String(off!.id))
			const asAdmin = rowAt(await form(w, admin(w)), pipeline, nodeKey)!
			const named = (id: string) => asAdmin.members!.find((m) => m.key === id)?.label ?? ""
			expect(named(hide)).toMatch(/ \(hidden from owners\)$/)
			expect(asAdmin.members!.map((m) => m.key)).not.toContain(String(off!.id))
			// In force, the owner has it listed, without a mark.
			await testDb.update(schema.plugins).set({ enabled: true }).where(eq(schema.plugins.id, plugin!.id))
			await updateSetting(testDb as any, w.session.id, owner(w), base.address, String(off!.id))
			await testDb.update(schema.plugins).set({ enabled: false }).where(eq(schema.plugins.id, plugin!.id))
			const inForce = rowAt(await form(w, owner(w)), pipeline, nodeKey)!
			const label = inForce.members!.find((m) => m.key === String(off!.id))?.label ?? ""
			expect(label).toBe(off!.name)
		} finally {
			await testDb.update(schema.plugins).set({ enabled: true }).where(eq(schema.plugins.id, plugin!.id))
			await updateSetting(testDb as any, w.session.id, owner(w), base.address, null).catch(() => {})
			await setPromptHidden(testDb as any, Number(hide), false)
			await deletePrompt(testDb as any, off!.id).catch(() => {})
		}
		await (await import("$lib/server/pipelines/runtime/sessionEvents")).settleSessionEvents()
	})
})
