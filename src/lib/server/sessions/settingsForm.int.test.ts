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
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-settings-form-int-test-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
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
async function makeSession(seedKey = "core-story-living", over: Record<string, unknown> = {}) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `settings-form-${++seq}`)
	const [lorebook] = await testDb.insert(schema.lorebooks).values({ name: `Form Book ${seq}`, userId: user.id }).returning()
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

const owner = (w: { user: { id: number } }) => ({ userId: w.user.id, isAdmin: false })
const admin = (w: { user: { id: number } }) => ({ userId: w.user.id, isAdmin: true })

async function form(w: { session: { id: number } }, viewer: { userId: number; isAdmin: boolean }) {
	const { settingsForm } = await import("./settingsForm")
	return settingsForm(testDb as any, w.session.id, viewer)
}

const fieldsOf = async (f: Awaited<ReturnType<typeof form>>) => (await import("./settingsForm")).formFields(f)

describe("who sees what (R1)", () => {
	test("the owner: the genre's owner-reach fields, the ruleset fixed and read-only, How strict theirs to change, the reply's own switches, each routine's mode — never plumbing", async () => {
		const w = await makeSession()
		const f = await form(w, owner(w))
		expect(f.viewer).toBe("owner")
		const genre = f.groups.find((g) => g.kind === "genre")!
		const keys = genre.fields.map((x) => (x.address as { key: string }).key)
		expect(keys).toEqual(expect.arrayContaining(["sideCast", "narratorInterjections"]))
		// R55: Rest follows the reckoning's mode — no field of its own.
		expect(keys).not.toContain("applyActionChanges")
		// The ruleset is fixed at start (R32); How strict may change mid-session
		// unless a layer locks it (PLAN-rulesets §21, main-session ruling 2026-10-20).
		const ruleset = genre.fields.find((x) => (x.address as { key: string }).key === "ruleset")!
		expect(ruleset).toMatchObject({ fixed: true, editable: false })
		const rigour = genre.fields.find((x) => (x.address as { key: string }).key === "rigour")!
		expect(rigour).toMatchObject({ editable: true, value: "prose" })
		expect(rigour.fixed).toBeUndefined()

		const reply = f.groups.find((g) => g.kind === "registration" && g.pipeline === REPLY)!
		expect(reply.registrationKeys).toEqual(["message-respond→story-respond"])
		const scene = reply.fields.find((x) => x.address.kind === "pipeline" && x.address.nodeKey === "reading" && x.address.path === "scene")
		expect(scene).toMatchObject({ reach: "owner", editable: true, value: true, control: "boolean" })
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
			expect(r.fields.map((x) => (x.address as { field: string }).field)).toEqual(
				r.registrationKey === RECKONING ? ["cadence", "mode"] : ["mode"]
			)
	})

	test("🚧 one sprite picker, whichever branch writes the reply — never a copy per branch (RF fix 3)", async () => {
		const w = await makeSession()
		const { replyStepKeys } = await import("$lib/server/utils/testDb")
		const steps = await replyStepKeys(testDb as any, REPLY)
		const pickerKey = steps.spritePick!
		for (const viewer of [owner(w), admin(w)]) {
			const reply = (await form(w, viewer)).groups.find((g) => g.kind === "registration" && g.pipeline === REPLY)!
			const pickers = new Set(
				reply.fields
					.filter((x) => x.address.kind === "pipeline" && x.address.nodeKey.endsWith(pickerKey))
					.map((x) => (x.address as { nodeKey: string }).nodeKey)
			)
			expect([...pickers], viewer.isAdmin ? "admin" : "owner").toEqual([pickerKey])
		}
	})

	test("an administrator in their own session: every setting, cadence options, Allow stacking", async () => {
		const w = await makeSession()
		const asOwner = await fieldsOf(await form(w, owner(w)))
		const f = await form(w, admin(w))
		expect(f.viewer).toBe("admin")
		const all = await fieldsOf(f)
		expect(all.length).toBeGreaterThan(asOwner.length)
		const sweep = f.groups.find((g) => g.kind === "routines")!.routines!.find((r) => r.registrationKey === SWEEP)!
		expect(sweep.fields.map((x) => (x.address as { field: string }).field)).toEqual(["mode", "cadence.n", "allowStacking"])
		expect(sweep.fields[1]).toMatchObject({ value: 5, control: "integer", min: 1, reach: "admin" })
		expect(sweep.cadence).toMatchObject({ id: "core:cadence/every-n-turns@1", options: { n: 5 } })
		// Fixed at start is read-only for an administrator too (R32): the ruleset.
		const genre = f.groups.find((g) => g.kind === "genre")!
		expect(genre.fields.find((x) => (x.address as { key?: string }).key === "ruleset")!.editable).toBe(false)
		expect(genre.fields.find((x) => (x.address as { key?: string }).key === "rigour")!.editable).toBe(true)
	})

	test("How strict through the form: the column is written; one the genre does not offer is refused", async () => {
		const w = await makeSession()
		const { updateSetting, SettingRefusal } = await import("./settingsForm")
		const address = { kind: "genre" as const, key: "rigour" }
		const done = await updateSetting(testDb as any, w.session.id, owner(w), address, "mechanics")
		expect(done.changes).toBe("rigour")
		const schema = await import("$lib/server/db/schema")
		const { eq } = await import("drizzle-orm")
		const [row] = await testDb.select({ rigour: schema.sessions.rigour, genreFields: schema.sessions.genreFields }).from(schema.sessions).where(eq(schema.sessions.id, w.session.id))
		expect(row!.rigour).toBe("mechanics")
		expect((row!.genreFields as Record<string, unknown>).rigour).toBeUndefined()
		await expect(updateSetting(testDb as any, w.session.id, owner(w), address, "nonsense")).rejects.toBeInstanceOf(SettingRefusal)
	})

	test("a guest reaches nothing here, and every write is refused", async () => {
		const w = await makeSession()
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const guest = await createTestUser(testDb, `settings-form-guest-${++seq}`)
		await testDb.insert(schema.sessionGuests).values({ sessionId: w.session.id, userId: guest.id } as any)
		const f = await form(w, { userId: guest.id, isAdmin: false })
		expect(f.groups).toEqual([])
		expect(f.error).toMatch(/owner/)
		const { updateSetting, SettingRefusal } = await import("./settingsForm")
		await expect(
			updateSetting(testDb as any, w.session.id, { userId: guest.id, isAdmin: true }, { kind: "genre", key: "sideCast" }, true)
		).rejects.toBeInstanceOf(SettingRefusal)
	})
})

describe("writing through the cascade", () => {
	test("a genre field: stored at the session layer; the inherited value (or null) clears it", async () => {
		const w = await makeSession()
		const { updateSetting } = await import("./settingsForm")
		await updateSetting(testDb as any, w.session.id, owner(w), { kind: "genre", key: "sideCast" }, true)
		let [row] = await testDb.select().from(schema.sessions).where(eq(schema.sessions.id, w.session.id))
		expect((row!.genreFields as Record<string, unknown>).sideCast).toBe(true)
		const { genreFieldsFor } = await import("$lib/server/pipelines/entities/sessionGenres")
		expect((await genreFieldsFor(testDb as any, w.session.id)).sideCast).toBe(true)
		await updateSetting(testDb as any, w.session.id, owner(w), { kind: "genre", key: "sideCast" }, null)
		;[row] = await testDb.select().from(schema.sessions).where(eq(schema.sessions.id, w.session.id))
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
		await updateSetting(testDb as any, w.session.id, owner(w), address, false)
		const { registrationValueLayers } = await import("$lib/server/pipelines/registrations/values")
		const layers = await registrationValueLayers(testDb as any, { specSlug: REPLY, sessionId: w.session.id })
		expect(layers.session).toEqual({ reading: { params: { scene: false } } })
		const f = await form(w, owner(w))
		const scene = (await fieldsOf(f)).find((x) => x.id === JSON.stringify(["pipeline", address.registrationKey, "reading", "params", "scene"]))!
		expect(scene).toMatchObject({ value: false, source: "session", inherited: true })
		// Back to what it inherits: no row left with nothing to say.
		await updateSetting(testDb as any, w.session.id, owner(w), address, true)
		const rows = await testDb
			.select()
			.from(schema.registrations)
			.where(and(eq(schema.registrations.scopeKind, "session"), eq(schema.registrations.scopeRef, String(w.session.id))))
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
					{ kind: "pipeline", registrationKey: "message-respond→story-respond", nodeKey: "generate", slot: "prompts", path: "" },
					1
				)
			).rejects.toThrow(/administrator's, in the pipeline's own settings/)
		// The ruleset is fixed at start (R32): read-only through the form.
		await expect(
			updateSetting(testDb as any, w.session.id, owner(w), { kind: "genre", key: "ruleset" }, "core:ruleset/vis-itineris@1")
		).rejects.toBeInstanceOf(SettingRefusal)
	})

	test("routines: anyone with the settings picks the mode (R37); only an administrator changes the cadence (R36), through the door", async () => {
		const w = await makeSession()
		const { updateSetting, SettingRefusal } = await import("./settingsForm")
		const { effectiveRegistrations } = await import("$lib/server/pipelines/registrations/resolve")
		await updateSetting(testDb as any, w.session.id, owner(w), { kind: "routine", registrationKey: SWEEP, field: "mode" }, "review")
		let sweep = (await effectiveRegistrations(testDb as any, w.session.id))!.effective.find((r) => r.key === SWEEP)!
		expect(sweep.mode).toBe("review")

		await expect(
			updateSetting(testDb as any, w.session.id, owner(w), { kind: "routine", registrationKey: SWEEP, field: "cadence.n" }, 3)
		).rejects.toBeInstanceOf(SettingRefusal)
		await updateSetting(testDb as any, w.session.id, admin(w), { kind: "routine", registrationKey: SWEEP, field: "cadence.n" }, 3)
		sweep = (await effectiveRegistrations(testDb as any, w.session.id))!.effective.find((r) => r.key === SWEEP)!
		// The options changed; the identity did not (A8).
		expect(sweep.trigger).toMatchObject({ family: "routine", cadence: { options: { n: 3 } } })
		expect(sweep.mode).toBe("review")
		await expect(
			updateSetting(testDb as any, w.session.id, admin(w), { kind: "routine", registrationKey: SWEEP, field: "cadence.n" }, 0)
		).rejects.toThrow(/at least 1/)
	})
})

describe("locks (A10) and dormant values (A9)", () => {
	test("a value a preset locks: the owner does not see it, an administrator sees it read-only, every run reads it", async () => {
		const living = await presetId("core-story-living")
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
		void living
		const w = await makeSession("core-story-living", { presetId: p!.id, genreFields: { narratorInterjections: false } })
		const ownerFields = await fieldsOf(await form(w, owner(w)))
		expect(ownerFields.some((x) => (x.address as { key?: string }).key === "narratorInterjections")).toBe(false)
		const adminField = (await fieldsOf(await form(w, admin(w)))).find(
			(x) => (x.address as { key?: string }).key === "narratorInterjections"
		)!
		expect(adminField).toMatchObject({ value: true, lockedAt: "preset", editable: false })
		const { genreFieldsFor } = await import("$lib/server/pipelines/entities/sessionGenres")
		expect((await genreFieldsFor(testDb as any, w.session.id)).narratorInterjections).toBe(true)
	})

	test("a preset that drops a routine leaves the session's values for it dormant; switching back restores them", async () => {
		const w = await makeSession("core-story-living")
		const { updateSetting } = await import("./settingsForm")
		const { effectiveRegistrations } = await import("$lib/server/pipelines/registrations/resolve")
		await updateSetting(testDb as any, w.session.id, owner(w), { kind: "routine", registrationKey: SWEEP, field: "mode" }, "review")
		await testDb.update(schema.sessions).set({ presetId: await presetId("core-story-minimal") }).where(eq(schema.sessions.id, w.session.id))
		expect((await effectiveRegistrations(testDb as any, w.session.id))!.effective.some((r) => r.key === SWEEP)).toBe(false)
		const kept = await testDb
			.select()
			.from(schema.registrations)
			.where(and(eq(schema.registrations.scopeKind, "session"), eq(schema.registrations.key, SWEEP), eq(schema.registrations.scopeRef, String(w.session.id))))
		expect(kept).toHaveLength(1)
		await testDb.update(schema.sessions).set({ presetId: await presetId("core-story-living") }).where(eq(schema.sessions.id, w.session.id))
		expect((await effectiveRegistrations(testDb as any, w.session.id))!.effective.find((r) => r.key === SWEEP)?.mode).toBe("review")
	})
})

describe("the sockets", () => {
	function recorder() {
		const emits: Array<{ event: string; data: any }> = []
		return { emits, emit: (event: string, data: any) => void emits.push({ event, data }) }
	}

	test("sessions:settingsForm answers the owner; sessions:updateSetting refuses in a sentence and answers with the form", async () => {
		const w = await makeSession()
		const { sessionsSettingsFormHandler, sessionsUpdateSettingHandler } = await import("$lib/server/sockets/sessionSettings")
		const r = recorder()
		const read: any = await sessionsSettingsFormHandler.handler({ user: { id: w.user.id } } as any, { sessionId: w.session.id }, r.emit)
		expect(read.groups.length).toBeGreaterThan(0)
		const refused: any = await sessionsUpdateSettingHandler.handler(
			{ user: { id: w.user.id } } as any,
			{ sessionId: w.session.id, address: { kind: "routine", registrationKey: SWEEP, field: "allowStacking" }, value: true, requestId: "a" },
			r.emit
		)
		expect(refused).toMatchObject({ requestId: "a", error: expect.stringMatching(/Nothing was saved/) })
		const set: any = await sessionsUpdateSettingHandler.handler(
			{ user: { id: w.user.id } } as any,
			{ sessionId: w.session.id, address: { kind: "routine", registrationKey: SWEEP, field: "mode" }, value: "off", requestId: "b" },
			r.emit
		)
		expect(set.error).toBeUndefined()
		const sweep = set.form.groups.find((g: any) => g.kind === "routines").routines.find((x: any) => x.registrationKey === SWEEP)
		expect(sweep.mode).toBe("off")
		expect(r.emits.map((e) => e.event)).toContain("sessions:settingsForm")
		await (await import("$lib/server/pipelines/runtime/sessionEvents")).settleSessionEvents()
	})
})

describe("When it runs — after each turn or after each round (R52)", () => {
	test("the owner picks it for the reckoning; the registration keeps its key, and a reset gives the preset's back", async () => {
		const { updateSetting } = await import("./settingsForm")
		const { effectiveRegistrations } = await import("$lib/server/pipelines/registrations/resolve")
		const { coreCadences } = await import("@serene-pub/sdk")
		const w = await makeSession()
		const f = await form(w, owner(w))
		const reckoning = f.groups.find((g) => g.kind === "routines")!.routines!.find((r) => r.registrationKey === RECKONING)!
		const when = reckoning.fields.find((x) => (x.address as { field: string }).field === "cadence")!
		expect(when.label).toBe("When it runs")
		expect(when.editable).toBe(true)
		expect(when.value).toBe(coreCadences.afterEachRound.id)
		expect((when.members ?? []).map((m) => m.key)).toEqual([coreCadences.afterEachTurn.id, coreCadences.afterEachRound.id])
		// The sweep (every n turns) is not one of the two: no choice.
		const sweep = f.groups.find((g) => g.kind === "routines")!.routines!.find((r) => r.registrationKey === SWEEP)!
		expect(sweep.fields.some((x) => (x.address as { field: string }).field === "cadence")).toBe(false)

		await updateSetting(testDb as any, w.session.id, owner(w), when.address, coreCadences.afterEachTurn.id)
		const after = await effectiveRegistrations(testDb as any, w.session.id)
		const reg = after!.effective.find((r) => r.key === RECKONING)!
		expect(reg.trigger).toMatchObject({ family: "routine", cadence: { id: coreCadences.afterEachTurn.id } })
		const again = await form(w, owner(w))
		const routine = again.groups.find((g) => g.kind === "routines")!.routines!.find((r) => r.registrationKey === RECKONING)!
		expect(routine.cadence.id).toBe(coreCadences.afterEachTurn.id)
		expect(routine.fields.find((x) => (x.address as { field: string }).field === "cadence")!.source).toBe("session")

		await updateSetting(testDb as any, w.session.id, owner(w), when.address, null)
		const reset = await effectiveRegistrations(testDb as any, w.session.id)
		expect(reset!.effective.find((r) => r.key === RECKONING)!.trigger).toMatchObject({
			cadence: { id: coreCadences.afterEachRound.id }
		})
	})
})

describe("each routine's mode on the settings document (R55); Rest at its own mode (G1 ★3)", () => {
	test("the settings document carries each routine's mode by pipeline; Minimal, which drops the reckoning, carries none", async () => {
		const { resolveSessionSettings } = await import("./settings")
		const { updateSetting } = await import("./settingsForm")
		const living = await makeSession()
		const doc = await resolveSessionSettings(testDb as any, living.session.id)
		expect(doc!.routineModes).toMatchObject({ "core:spec/story-reckoning": "full", "core:spec/story-sweep": "full" })
		await updateSetting(testDb as any, living.session.id, owner(living), { kind: "routine", registrationKey: RECKONING, field: "mode" }, "review")
		expect((await resolveSessionSettings(testDb as any, living.session.id))!.routineModes!["core:spec/story-reckoning"]).toBe("review")
		const minimal = await makeSession("core-story-minimal")
		expect((await resolveSessionSettings(testDb as any, minimal.session.id))!.routineModes!["core:spec/story-reckoning"]).toBeUndefined()
		await (await import("$lib/server/pipelines/runtime/sessionEvents")).settleSessionEvents()
	})

	test("Rest applies at its own action's mode — never the reckoning's, read by spec id (GM 2026-10-23, G1 ★3)", async () => {
		const { storyRestSpec } = await import("@serene-pub/core-catalog")
		const doc = storyRestSpec() as unknown as { nodes: Array<{ key: string; definitionId: string }>; clauses?: Array<{ id: string }> }
		const text = JSON.stringify(doc)
		// An action registration carries no mode (R37): the press applies, as a rules action's does.
		expect(text).not.toContain("routineModes")
		expect(text).not.toContain("applyActionChanges")
		expect((doc.clauses ?? []).some((c) => c.id === "commit")).toBe(false)
		expect(doc.nodes.find((n) => n.key === "apply")!.definitionId).toBe("core:task/set-state")
	})
})

describe("the reply's prompt is the owner's to choose (R54)", () => {
	test("offered among the pool's prompts an administrator has not hidden; stored on the session's registration; never the text", async () => {
		const { updateSetting, SettingRefusal } = await import("./settingsForm")
		const { setPromptHidden } = await import("$lib/server/pipelines/entities/prompts")
		const { registrationValueLayers } = await import("$lib/server/pipelines/registrations/values")
		const w = await makeSession()
		const promptOf = (f: Awaited<ReturnType<typeof form>>) =>
			f.groups
				.find((g) => g.kind === "registration" && g.pipeline === REPLY)
				?.fields.find((x) => x.label === "Prompt" && (x.address as { slot?: string }).slot === "prompts")
		const field = promptOf(await form(w, owner(w)))!
		expect(field, "the reply offers its owner no prompt choice").toBeTruthy()
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
			if (other !== field.value) expect((again.members ?? []).map((m) => m.key)).not.toContain(other)
			const asAdmin = promptOf(await form(w, admin(w)))!
			expect((asAdmin.members ?? []).map((m) => m.key)).toContain(other)
			// A hidden prompt the owner names anyway is refused.
			if (other !== field.value)
				await expect(updateSetting(testDb as any, w.session.id, owner(w), field.address, other)).rejects.toBeInstanceOf(SettingRefusal)
		} finally {
			await setPromptHidden(testDb as any, Number(other), false)
		}

		// A choice lands on the session's registration of the reply, by id.
		const choice = keys.find((k) => k !== field.value)
		if (choice) {
			await updateSetting(testDb as any, w.session.id, owner(w), field.address, choice)
			const layers = await registrationValueLayers(testDb as any, { specSlug: REPLY, sessionId: w.session.id })
			const nodeKey = (field.address as { nodeKey: string }).nodeKey
			expect(layers.session?.[nodeKey]?.prompts).toBe(Number(choice))
			expect(promptOf(await form(w, owner(w)))!.value).toBe(choice)
			await updateSetting(testDb as any, w.session.id, owner(w), field.address, null)
			expect((await registrationValueLayers(testDb as any, { specSlug: REPLY, sessionId: w.session.id })).session?.[nodeKey]?.prompts).toBeUndefined()
		}
		await (await import("$lib/server/pipelines/runtime/sessionEvents")).settleSessionEvents()
	})
})

describe("the start form and the card (R32, §7)", () => {
	test("the preset list carries what the start form asks and the derived numbers", async () => {
		const { sessionPresetsList } = await import("$lib/server/sockets/sessionAdmin")
		const res: any = await sessionPresetsList.handler({ user: { id: 1, isAdmin: false } } as any, {} as any, () => {})
		const bySeed = async (k: string) => {
			const id = await presetId(k)
			return res.presets.find((p: any) => p.id === id)
		}
		const living = await bySeed("core-story-living")
		expect(living.derived).toMatchObject({ callsPerTurn: 2, replyCalls: 1, routineCalls: 1 })
		expect((await bySeed("core-story-minimal")).derived.callsPerTurn).toBe(1)
		// The rules a Story session plays are fixed at start: asked under Living…
		expect(living.asks.map((a: any) => a.key)).toEqual(expect.arrayContaining(["ruleset", "rigour"]))
		// …and under Rule Based its locked rigour is taken, never asked.
		const ruleBased = await bySeed("core-story-rule-based")
		expect((ruleBased.asks ?? []).map((a: any) => a.key)).not.toContain("rigour")
	})
})
