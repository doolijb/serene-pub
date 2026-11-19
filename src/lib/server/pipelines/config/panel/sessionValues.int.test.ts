/**
 * A session's step values have one store: `registrations.values`.
 *
 * The Pipelines card writes it through the settings form's own writer, and the
 * panel and the other readers resolve in the run's order — the session's
 * registration value first, a ⏳ leftover override row (one the boot fold could
 * not move) only where that states nothing.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import type { TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { STORY_RESPOND_SPEC_ID } from "$lib/server/pipelines/specs"
import { STORY_GENRE_ID } from "@serene-pub/core-catalog"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 })

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "session-values-secret" }
})

const SECRET = "session-values-secret"

let db: TestDb
let dataDir: string
let specId: number
let adminId: number
let reply: { generate: string; spritePick?: string }
let knob: { nodeKey: string; slot: string; path: string }
let seq = 0

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-session-values-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(db)

	const [spec] = await db
		.select()
		.from(schema.pipelineSpecs)
		.where(eq(schema.pipelineSpecs.slug, STORY_RESPOND_SPEC_ID))
	specId = spec.id
	const { replyStepKeys } = await import("$lib/server/utils/testDb")
	reply = await replyStepKeys(db, STORY_RESPOND_SPEC_ID)
	const { declarations } = await import("$lib/server/pipelines/config/panel/declarations")
	const decl = (await declarations(db, spec.activeVersionId!)).find(
		(d) => d.nodeKey === reply.spritePick && d.path === "margin"
	)
	expect(decl, "the sprite picker's margin").toBeTruthy()
	knob = { nodeKey: decl!.nodeKey, slot: decl!.slot, path: decl!.path }

	const [admin] = await db
		.insert(schema.users)
		.values({ username: "session-values-admin", isAdmin: true })
		.returning()
	adminId = admin.id
	const [conn] = await db
		.insert(schema.connections)
		.values({
			name: "Pub endpoint",
			type: "ollama",
			baseUrl: "http://localhost:11434",
			promptFormat: "vicuna",
			tokenCounter: "estimate"
		})
		.returning()
	const [model] = await db
		.insert(schema.connectionModels)
		.values({ connectionId: conn.id, model: "m", name: "m" })
		.returning()
	const { setCapabilityDefault } = await import("$lib/server/connections/capabilityDefaults")
	await setCapabilityDefault(db, "text->text", { connectionId: conn.id, connectionModelId: model.id })
})

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

async function makeSession(ownerId?: number): Promise<number> {
	const userId =
		ownerId ??
		(
			await db
				.insert(schema.users)
				.values({ username: `session-values-${++seq}`, isAdmin: false })
				.returning()
		)[0]!.id
	const [session] = await db
		.insert(schema.sessions)
		.values({ userId, isGroup: false, genreId: STORY_GENRE_ID } as any)
		.returning()
	return session.id
}

/** The session's registration value at an address, through the form's own writer. */
async function setRegistration(
	sessionId: number,
	at: { nodeKey: string; slot: string; path: string },
	value: unknown
) {
	const { sessionRegistrationKeys } = await import("$lib/server/pipelines/registrations/values")
	const { patchSessionRow, valuesWith } = await import("$lib/server/sessions/settingsForm")
	const keys = await sessionRegistrationKeys(db, sessionId, STORY_RESPOND_SPEC_ID)
	expect(keys.length).toBeGreaterThan(0)
	for (const key of keys)
		await patchSessionRow(db, sessionId, key, (row) => ({ values: valuesWith(row.values, at, value) as never }), "owner")
}

const leftover = (sessionId: number, at: { nodeKey: string; slot: string; path: string }, value: unknown) =>
	db.insert(schema.pipelineNodeOverrides).values({
		specId,
		scopeKind: "session",
		scopeId: sessionId,
		nodeKey: at.nodeKey,
		slot: at.slot,
		path: at.path,
		value
	})

const overrideRows = (sessionId: number, at: { nodeKey: string; slot: string; path: string }) =>
	db
		.select()
		.from(schema.pipelineNodeOverrides)
		.where(
			and(
				eq(schema.pipelineNodeOverrides.specId, specId),
				eq(schema.pipelineNodeOverrides.scopeKind, "session"),
				eq(schema.pipelineNodeOverrides.scopeId, sessionId),
				eq(schema.pipelineNodeOverrides.nodeKey, at.nodeKey),
				eq(schema.pipelineNodeOverrides.slot, at.slot),
				eq(schema.pipelineNodeOverrides.path, at.path)
			)
		)

const registrationValues = async (sessionId: number) =>
	(
		await db
			.select()
			.from(schema.registrations)
			.where(and(eq(schema.registrations.scopeKind, "session"), eq(schema.registrations.scopeRef, String(sessionId))))
	).map((r) => r.values as Record<string, Record<string, unknown>> | null)

/** What the panel shows at the knob. */
async function panelValue(sessionId: number) {
	const { namespaceView, optionId } = await import("$lib/server/pipelines/config/panel")
	const { groupOptions } = await import("$lib/server/pipelines/config/panel/groups")
	const view: any = await namespaceView(db, SECRET, STORY_RESPOND_SPEC_ID, { userId: adminId, isAdmin: true, sessionId })
	const id = optionId(SECRET, knob.nodeKey, knob.slot, knob.path)
	const option = groupOptions(view.groups).find((o: any) => o.id === id)
	expect(option, "the knob is in the panel").toBeTruthy()
	return option!.value
}

/** What the run resolves at the knob: the first session-scope entry. */
async function runValue(sessionId: number) {
	const { buildWorld } = await import("$lib/server/pipelines/config/world")
	const world: any = await buildWorld(db, { sessionId, specId: STORY_RESPOND_SPEC_ID })
	return (world.overrides as any[]).find(
		(o) =>
			o.scopeKind === "session" && o.nodeKey === knob.nodeKey && o.slot === knob.slot && (o.path ?? "") === knob.path
	)?.value
}

describe("the panel and the run resolve the same value", () => {
	it("a session registration value only", async () => {
		const sessionId = await makeSession()
		await setRegistration(sessionId, knob, 0.07)
		expect(await panelValue(sessionId)).toBe(0.07)
		expect(await runValue(sessionId)).toBe(0.07)
	})

	it("a leftover override row only", async () => {
		const sessionId = await makeSession()
		await leftover(sessionId, knob, 0.09)
		expect(await panelValue(sessionId)).toBe(0.09)
		expect(await runValue(sessionId)).toBe(0.09)
	})

	it("both: the registration value wins in both readers", async () => {
		const sessionId = await makeSession()
		await setRegistration(sessionId, knob, 0.07)
		await leftover(sessionId, knob, 0.09)
		expect(await panelValue(sessionId)).toBe(0.07)
		expect(await runValue(sessionId)).toBe(0.07)
	})

	it("a session prompt value naming no prompt: neither reader uses it", async () => {
		const { declarations } = await import("$lib/server/pipelines/config/panel/declarations")
		const { namespaceView, optionId } = await import("$lib/server/pipelines/config/panel")
		const { groupOptions } = await import("$lib/server/pipelines/config/panel/groups")
		const { buildWorld } = await import("$lib/server/pipelines/config/world")
		const [spec] = await db.select().from(schema.pipelineSpecs).where(eq(schema.pipelineSpecs.id, specId))
		const decl = (await declarations(db, spec.activeVersionId!)).find((d) => d.control === "prompts-ref")
		expect(decl, "a prompt declaration").toBeTruthy()
		const at = { nodeKey: decl!.nodeKey, slot: decl!.slot, path: decl!.path }
		const sessionId = await makeSession()
		await setRegistration(sessionId, at, 999999)
		const view: any = await namespaceView(db, SECRET, STORY_RESPOND_SPEC_ID, { userId: adminId, isAdmin: true, sessionId })
		const id = optionId(SECRET, at.nodeKey, at.slot, at.path)
		const option = groupOptions(view.groups).find((o: any) => o.id === id)
		expect(option, "the prompt is in the panel").toBeTruthy()
		expect(option!.source).not.toBe("session")
		const world: any = await buildWorld(db, { sessionId, specId: STORY_RESPOND_SPEC_ID })
		expect(
			(world.overrides as any[]).filter(
				(o) => o.scopeKind === "session" && o.nodeKey === at.nodeKey && o.slot === at.slot
			)
		).toEqual([])
	})
})

/** What the run resolves at the knob across scopes, in the run's order (session, preset, genre, author). */
async function runWinner(sessionId: number) {
	const { buildWorld } = await import("$lib/server/pipelines/config/world")
	const world: any = await buildWorld(db, { sessionId, specId: STORY_RESPOND_SPEC_ID })
	const here = (world.overrides as any[]).filter(
		(o) => o.nodeKey === knob.nodeKey && o.slot === knob.slot && (o.path ?? "") === knob.path
	)
	for (const scope of ["session", "preset", "genre", "author"]) {
		const hit = here.find((o) => o.scopeKind === scope)
		if (hit) return hit.value
	}
	return undefined
}

describe("a setting lock holds", () => {
	/**
	 * The lock sits in a genre-scope change row on the genre's reply
	 * registration (key `admin:<key>`), which the session's registration reads as
	 * its genre layer; the row is removed after each test.
	 */
	async function withGenreValues(sessionId: number, values: unknown, body: (set: (v: unknown) => Promise<void>) => Promise<void>) {
		const { registrationValueLayers } = await import("$lib/server/pipelines/registrations/values")
		const { genreChangeKey } = await import("$lib/server/pipelines/registrations/rows")
		const { invalidateRegistrations } = await import("$lib/server/pipelines/registrations/resolve")
		const { key } = await registrationValueLayers(db, { specSlug: STORY_RESPOND_SPEC_ID, specId, sessionId })
		expect(key, "the session's reply registration").toBeTruthy()
		const [row] = await db
			.insert(schema.registrations)
			.values({
				scopeKind: "genre",
				scopeRef: STORY_GENRE_ID,
				key: genreChangeKey(key!),
				dropped: false,
				origin: "test:lock",
				values: values as never
			} as any)
			.returning()
		invalidateRegistrations()
		try {
			await body(async (v) => {
				await db.update(schema.registrations).set({ values: v as never }).where(eq(schema.registrations.id, row.id))
				invalidateRegistrations()
			})
		} finally {
			await db.delete(schema.registrations).where(eq(schema.registrations.id, row.id))
			invalidateRegistrations()
		}
	}
	const stated = (decision: unknown) => ({ [knob.nodeKey]: { [knob.slot]: { [knob.path]: decision } } })

	it("a registration value under the lock loses in the panel and the run; lifting the lock brings it back", async () => {
		const sessionId = await makeSession()
		await setRegistration(sessionId, knob, 0.07)
		await withGenreValues(sessionId, stated({ value: 0.11, lock: true }), async (set) => {
			expect(await panelValue(sessionId)).toBe(0.11)
			expect(await runWinner(sessionId)).toBe(0.11)
			expect(await runValue(sessionId)).toBeUndefined()
			// the session's value is kept, never deleted
			expect((await registrationValues(sessionId)).some((v) => v?.[knob.nodeKey]?.[knob.slot] != null)).toBe(true)
			await set(stated(0.11))
			expect(await panelValue(sessionId)).toBe(0.07)
			expect(await runWinner(sessionId)).toBe(0.07)
		})
	})

	it("a null lock shows what lies below it, in the panel and the run", async () => {
		const fresh = await makeSession()
		const below = await panelValue(fresh)
		const sessionId = await makeSession()
		await setRegistration(sessionId, knob, 0.07)
		await withGenreValues(sessionId, stated({ value: null, lock: true }), async () => {
			const shown = await panelValue(sessionId)
			expect(shown).toBe(await runWinner(sessionId))
			expect(shown).toEqual(below)
			expect(shown).not.toBe(0.07)
		})
	})

	it("a leftover override row under the lock loses; lifting the lock brings it back", async () => {
		const sessionId = await makeSession()
		await leftover(sessionId, knob, 0.09)
		await withGenreValues(sessionId, stated({ value: 0.11, lock: true }), async (set) => {
			expect(await panelValue(sessionId)).toBe(0.11)
			expect(await runWinner(sessionId)).toBe(0.11)
			expect(await overrideRows(sessionId, knob)).toHaveLength(1)
			await set(stated(0.11))
			expect(await panelValue(sessionId)).toBe(0.09)
			expect(await runWinner(sessionId)).toBe(0.09)
		})
	})
})

describe("a setting lock holds for task sampling", () => {
	it("the lock's pick beats the session's value and a leftover row, from the genre or the preset; lifting it brings the pick back", async () => {
		const { oracleNodeKeyOf } = await import("$lib/server/pipelines/config/world")
		const { resolveTaskConfig } = await import("$lib/server/utils/resolveTaskConfig")
		const { registrationValueLayers } = await import("$lib/server/pipelines/registrations/values")
		const { genreChangeKey, rowOfChange } = await import("$lib/server/pipelines/registrations/rows")
		const { upsertRow, deleteRow } = await import("$lib/server/pipelines/registrations/write")
		const { invalidateRegistrations } = await import("$lib/server/pipelines/registrations/resolve")
		const oracle = (await oracleNodeKeyOf(db as any, { slug: STORY_RESPOND_SPEC_ID }))!
		const at = { nodeKey: oracle, slot: "sampling", path: "" }
		const make = async (name: string) =>
			(await db.insert(schema.samplingConfigs).values({ name, values: {} }).returning())[0]!.id
		const [A, B, C] = [await make("Lock test session pick"), await make("Lock test locked pick"), await make("Lock test leftover pick")]
		const pickOf = async (sessionId: number) =>
			(await resolveTaskConfig({ taskType: "session", sessionId })).sampling?.id
		const lock = { [oracle]: { sampling: { value: B, lock: true } } }
		const keyOf = async (sessionId: number) =>
			(await registrationValueLayers(db, { specSlug: STORY_RESPOND_SPEC_ID, specId, sessionId })).key!

		// the genre's lock
		const viaGenre = await makeSession()
		await setRegistration(viaGenre, at, A)
		await leftover(viaGenre, at, C)
		const [genreRow] = await db
			.insert(schema.registrations)
			.values({
				scopeKind: "genre",
				scopeRef: STORY_GENRE_ID,
				key: genreChangeKey(await keyOf(viaGenre)),
				dropped: false,
				origin: "test:lock",
				values: lock as never
			} as any)
			.returning()
		invalidateRegistrations()
		try {
			expect(await pickOf(viaGenre), "the session's value and a leftover row under the lock").toBe(B)
			const onlyLeftover = await makeSession()
			await leftover(onlyLeftover, at, C)
			expect(await pickOf(onlyLeftover), "a leftover row alone under the lock").toBe(B)
		} finally {
			await db.delete(schema.registrations).where(eq(schema.registrations.id, genreRow!.id))
			invalidateRegistrations()
		}
		expect(await pickOf(viaGenre), "lock lifted: the session's value").toBe(A)

		// the preset's lock
		const viaPreset = await makeSession()
		const [preset] = await db
			.insert(schema.sessionPresets)
			.values({ name: `lock-${viaPreset}`, genreId: STORY_GENRE_ID })
			.returning()
		await db.update(schema.sessions).set({ presetId: preset!.id }).where(eq(schema.sessions.id, viaPreset))
		await setRegistration(viaPreset, at, A)
		await leftover(viaPreset, at, C)
		const scope = { kind: "preset" as const, presetId: preset!.id }
		const presetKey = await keyOf(viaPreset)
		await upsertRow(db as any, rowOfChange({ key: presetKey, values: lock as never }, scope, "test"))
		invalidateRegistrations()
		expect(await pickOf(viaPreset), "a preset lock over the session's value").toBe(B)
		await deleteRow(db as any, scope, presetKey)
		invalidateRegistrations()
		expect(await pickOf(viaPreset), "preset lock lifted").toBe(A)
	})
})

describe("the Pipelines card's session write lands in the registrations", () => {
	const viewerOf = (sessionId: number) => ({ userId: adminId, isAdmin: true, sessionId })
	const handle = async () => {
		const { optionId } = await import("$lib/server/pipelines/config/panel")
		return optionId(SECRET, knob.nodeKey, knob.slot, knob.path)
	}

	it("writes every registration of the pipeline, no override row, and the run uses it", async () => {
		const { writeOption } = await import("$lib/server/pipelines/config/panel")
		const { sessionRegistrationKeys } = await import("$lib/server/pipelines/registrations/values")
		const sessionId = await makeSession()
		await writeOption(db, SECRET, STORY_RESPOND_SPEC_ID, viewerOf(sessionId), await handle(), 0.07)
		expect(await overrideRows(sessionId, knob)).toEqual([])
		const keys = await sessionRegistrationKeys(db, sessionId, STORY_RESPOND_SPEC_ID)
		const held = (await registrationValues(sessionId)).filter((v) => v?.[knob.nodeKey]?.[knob.slot] != null)
		expect(held.length).toBe(keys.length)
		expect(await runValue(sessionId)).toBe(0.07)
	})

	it("a clear removes it", async () => {
		const { writeOption, clearOption } = await import("$lib/server/pipelines/config/panel")
		const sessionId = await makeSession()
		await writeOption(db, SECRET, STORY_RESPOND_SPEC_ID, viewerOf(sessionId), await handle(), 0.07)
		await clearOption(db, SECRET, STORY_RESPOND_SPEC_ID, viewerOf(sessionId), await handle())
		expect((await registrationValues(sessionId)).filter((v) => v?.[knob.nodeKey]?.[knob.slot] != null)).toEqual([])
		expect(await runValue(sessionId)).not.toBe(0.07)
	})

	it("a write over a leftover row deletes that row; a clear does too", async () => {
		const { writeOption, clearOption } = await import("$lib/server/pipelines/config/panel")
		const sessionId = await makeSession()
		await leftover(sessionId, knob, 0.09)
		await writeOption(db, SECRET, STORY_RESPOND_SPEC_ID, viewerOf(sessionId), await handle(), 0.07)
		expect(await overrideRows(sessionId, knob)).toEqual([])
		expect(await runValue(sessionId)).toBe(0.07)

		const other = await makeSession()
		await leftover(other, knob, 0.09)
		await clearOption(db, SECRET, STORY_RESPOND_SPEC_ID, viewerOf(other), await handle())
		expect(await overrideRows(other, knob)).toEqual([])
	})

	it("a session that runs no registration of the pipeline is refused in a sentence", async () => {
		const { writeOption, OptionNotWritableError } = await import("$lib/server/pipelines/config/panel")
		const [user] = await db
			.insert(schema.users)
			.values({ username: `session-values-none-${++seq}`, isAdmin: false })
			.returning()
		const [session] = await db.insert(schema.sessions).values({ userId: user.id, isGroup: false } as any).returning()
		// Dropping every registration of the pipeline from the session leaves none.
		const { sessionRegistrationKeys } = await import("$lib/server/pipelines/registrations/values")
		const { patchSessionRow } = await import("$lib/server/sessions/settingsForm")
		for (const key of await sessionRegistrationKeys(db, session.id, STORY_RESPOND_SPEC_ID))
			await patchSessionRow(db, session.id, key, () => ({ dropped: true }) as never, "owner")
		const write = writeOption(db, SECRET, STORY_RESPOND_SPEC_ID, viewerOf(session.id), await handle(), 0.07)
		await expect(write).rejects.toBeInstanceOf(OptionNotWritableError)
		await expect(write).rejects.toThrow(/Nothing was saved/)
		expect(await overrideRows(session.id, knob)).toEqual([])
	})
})

describe("task sampling keeps the session's pick", () => {
	it("a registration sampling value is the pick, and wins over a leftover row", async () => {
		const { oracleNodeKeyOf } = await import("$lib/server/pipelines/config/world")
		const { resolveTaskConfig } = await import("$lib/server/utils/resolveTaskConfig")
		const oracle = (await oracleNodeKeyOf(db as any, { slug: STORY_RESPOND_SPEC_ID }))!
		const at = { nodeKey: oracle, slot: "sampling", path: "" }
		const make = async (name: string) =>
			(await db.insert(schema.samplingConfigs).values({ name, values: {} }).returning())[0]!.id
		const registered = await make("Registered pick")
		const left = await make("Leftover pick")

		const only = await makeSession()
		await setRegistration(only, at, registered)
		expect((await resolveTaskConfig({ taskType: "session", sessionId: only })).sampling?.id).toBe(registered)

		const both = await makeSession()
		await setRegistration(both, at, registered)
		await leftover(both, at, left)
		expect((await resolveTaskConfig({ taskType: "session", sessionId: both })).sampling?.id).toBe(registered)

		const row = await makeSession()
		await leftover(row, at, left)
		expect((await resolveTaskConfig({ taskType: "session", sessionId: row })).sampling?.id).toBe(left)
	})
})

describe("deleting a prompt the session's owner selected", () => {
	const socketFor = (userId: number, isAdmin: boolean) =>
		({ user: { id: userId, isAdmin }, io: { to: () => ({ emit: () => {} }) } }) as any
	const noopEmit = () => {}

	it("clears the selection; one held in another session still refuses", async () => {
		const { declarations, optionId, writeOption } = await import("$lib/server/pipelines/config/panel")
		const { pipelinesDeletePrompt } = await import("$lib/server/sockets/pipelines")
		const [spec] = await db.select().from(schema.pipelineSpecs).where(eq(schema.pipelineSpecs.id, specId))
		const decl: any = (await declarations(db, spec.activeVersionId!)).find((d: any) => d.control === "prompts-ref")
		const handle = optionId(SECRET, decl.nodeKey, decl.slot, decl.path)
		const [prompt] = await db
			.insert(schema.pipelinePrompts)
			.values({
				nodeDefinitionId: decl.nodeDefinitionId!,
				slot: decl.slot,
				name: "Selected in a session",
				fields: Object.fromEntries((decl.promptFields ?? []).map((f: string) => [f, "words"]))
			})
			.returning()

		const mine = await makeSession(adminId)
		const theirs = await makeSession()
		for (const sessionId of [mine, theirs])
			await writeOption(db, SECRET, STORY_RESPOND_SPEC_ID, { userId: adminId, isAdmin: true, sessionId }, handle, prompt.id)
		const holds = async (sessionId: number) =>
			(await registrationValues(sessionId)).some((v) => v?.[decl.nodeKey]?.[decl.slot] === prompt.id)
		expect(await holds(mine)).toBe(true)

		const params = (sessionId: number) => ({ slug: STORY_RESPOND_SPEC_ID, optionId: handle, sessionId, promptId: prompt.id })
		const refused: any = await pipelinesDeletePrompt.handler(socketFor(adminId, true), params(mine) as any, noopEmit)
		expect(refused.error).toMatch(/still selected/)
		expect(await holds(mine)).toBe(true)

		await db
			.delete(schema.registrations)
			.where(and(eq(schema.registrations.scopeKind, "session"), eq(schema.registrations.scopeRef, String(theirs))))
		const done: any = await pipelinesDeletePrompt.handler(socketFor(adminId, true), params(mine) as any, noopEmit)
		expect(done.error).toBeUndefined()
		expect(await holds(mine)).toBe(false)
		expect(await db.select().from(schema.pipelinePrompts).where(eq(schema.pipelinePrompts.id, prompt.id))).toEqual([])
	})
})
