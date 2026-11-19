/**
 * The boot fold of session-scope overrides into registration values: for each
 * session and each registration key, the session-scope values the run's world
 * resolves are the same before and after the fold, and a second run changes
 * nothing.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import { registrationKeyOf } from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"
import { createTestDb, createTestUser, type TestDb } from "$lib/server/utils/testDb"
import { buildWorld } from "$lib/server/pipelines/config/world"
import { sessionRegistrationKeys } from "$lib/server/pipelines/registrations/values"
import { invalidateRegistrations } from "$lib/server/pipelines/registrations/resolve"
import { foldSessionOverrides } from "./sessionOverrideFold"
import "@serene-pub/contracts"
import "@serene-pub/core-catalog"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

const STORY_RESPOND = "core:spec/story-respond"
const OTHER_TRIGGER = {
	family: "event" as const,
	event: "core:event/round-ended@1"
}
const ZERO = {
	moved: 0,
	shadowed: 0,
	connections: 0,
	leftNoSession: 0,
	leftNoRegistration: 0,
	leftUnmappable: 0
}

let db: TestDb
let dataDir: string
let userId: number
let specId: number
let paramsAt: { nodeKey: string; slot: string; path: string }
let promptAt: { nodeKey: string; slot: string }
let connectionAt: { nodeKey: string; slot: string }
let promptA: number
let promptB: number

const overrideRows = async (sessionId: number) =>
	(
		await db
			.select()
			.from(schema.pipelineNodeOverrides)
			.where(eq(schema.pipelineNodeOverrides.scopeId, sessionId))
	).sort((a, b) => a.id - b.id)

const sessionRows = async (sessionId: number) =>
	(
		await db
			.select({
				key: schema.registrations.key,
				values: schema.registrations.values
			})
			.from(schema.registrations)
			.where(
				and(
					eq(schema.registrations.scopeKind, "session"),
					eq(schema.registrations.sessionId, sessionId)
				)
			)
	).sort((a, b) => a.key.localeCompare(b.key))

const newSession = async () => {
	const [s] = await db
		.insert(schema.sessions)
		.values({ userId, isGroup: false, name: "fold" })
		.returning()
	return s!.id
}

const keysOf = async (sessionId: number) => {
	invalidateRegistrations()
	return sessionRegistrationKeys(db as never, sessionId, STORY_RESPOND)
}

/** The first session-scope value per address the run's world resolves, for each key. */
const worlds = async (sessionId: number) => {
	invalidateRegistrations()
	const out: Record<string, Record<string, unknown>> = {}
	for (const key of await keysOf(sessionId)) {
		const world = await buildWorld(db as never, {
			sessionId,
			specId: STORY_RESPOND,
			registrationKey: key
		})
		const seen: Record<string, unknown> = {}
		for (const o of world.overrides)
			if (o.scopeKind === "session") {
				const k = `${o.nodeKey}·${o.slot}·${o.path}`
				if (!(k in seen)) seen[k] = o.value
			}
		out[key] = seen
	}
	return out
}

const putOverride = (
	sessionId: number,
	at: { nodeKey: string; slot: string; path?: string },
	value: unknown,
	forSpec = specId
) =>
	db.insert(schema.pipelineNodeOverrides).values({
		specId: forSpec,
		scopeKind: "session",
		scopeId: sessionId,
		nodeKey: at.nodeKey,
		slot: at.slot,
		path: at.path ?? "",
		value: value as never
	})

const run = async () => {
	invalidateRegistrations()
	return foldSessionOverrides(db as never)
}

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-session-override-fold-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = await createTestDb()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(db as never)
	userId = (await createTestUser(db, "session-override-fold")).id
	const [spec] = await db
		.select()
		.from(schema.pipelineSpecs)
		.where(eq(schema.pipelineSpecs.slug, STORY_RESPOND))
	specId = spec!.id
	const { declarations } = await import(
		"$lib/server/pipelines/config/panel"
	)
	const decls = await declarations(db as never, spec!.activeVersionId!)
	const params = decls.find(
		(d) =>
			d.slot === "params" &&
			d.path &&
			!/-ref$/.test(d.control ?? "") &&
			d.matrixSlot !== "connection"
	)!
	paramsAt = { nodeKey: params.nodeKey, slot: params.slot, path: params.path }
	const prompt = decls.find((d) => d.control === "prompts-ref")!
	promptAt = { nodeKey: prompt.nodeKey, slot: prompt.slot }
	const connection = decls.find((d) => d.matrixSlot === "connection")!
	connectionAt = { nodeKey: connection.nodeKey, slot: connection.slot }
	const prompts = (await db.select().from(schema.pipelinePrompts)).filter(
		(p) => Object.keys((p.fields ?? {}) as object).length > 0
	)
	promptA = prompts[0]!.id
	promptB = prompts[1]!.id
})

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {})
})

describe("foldSessionOverrides", () => {
	it("moves an override onto every key's session row, and the run reads the same", async () => {
		const sessionId = await newSession()
		const extra = registrationKeyOf(OTHER_TRIGGER, STORY_RESPOND)
		await db.insert(schema.registrations).values({
			scopeKind: "session",
			scopeRef: String(sessionId),
			sessionId,
			key: extra,
			triggerFamily: "event",
			triggerRef: OTHER_TRIGGER.event,
			specSlug: STORY_RESPOND,
			origin: "fold-test"
		})
		const keys = await keysOf(sessionId)
		expect(keys.length).toBeGreaterThanOrEqual(2)
		await putOverride(sessionId, paramsAt, 7)
		await putOverride(sessionId, promptAt, promptA)
		const before = await worlds(sessionId)
		const addr = `${paramsAt.nodeKey}·${paramsAt.slot}·${paramsAt.path}`
		for (const k of keys) expect(before[k]![addr]).toBe(7)

		expect(await run()).toEqual({ ...ZERO, moved: 2 })
		expect(await overrideRows(sessionId)).toEqual([])
		expect(await worlds(sessionId)).toEqual(before)
		const rows = await sessionRows(sessionId)
		for (const k of keys) {
			const row = rows.find((r) => r.key === k)!
			expect(
				(row.values as never as Record<string, Record<string, Record<string, unknown>>>)[
					paramsAt.nodeKey
				]![paramsAt.slot]
			).toEqual({ [paramsAt.path]: 7 })
			expect(
				(row.values as never as Record<string, Record<string, unknown>>)[
					promptAt.nodeKey
				]![promptAt.slot]
			).toBe(promptA)
		}
	})

	it("a session value alone is not touched", async () => {
		const sessionId = await newSession()
		const [key] = await keysOf(sessionId)
		const { patchSessionRow, valuesWith } = await import(
			"$lib/server/sessions/settingsForm"
		)
		await patchSessionRow(
			db as never,
			sessionId,
			key!,
			(r) => ({ values: valuesWith(r.values, paramsAt, 4) as never }),
			"fold-test"
		)
		const before = await worlds(sessionId)
		const rows = await sessionRows(sessionId)
		expect(await run()).toEqual(ZERO)
		expect(await worlds(sessionId)).toEqual(before)
		expect(await sessionRows(sessionId)).toEqual(rows)
	})

	it("both, the registration value usable: the row goes, the value stays", async () => {
		const sessionId = await newSession()
		const keys = await keysOf(sessionId)
		const { patchSessionRow, valuesWith } = await import(
			"$lib/server/sessions/settingsForm"
		)
		for (const k of keys)
			await patchSessionRow(
				db as never,
				sessionId,
				k,
				(r) => ({ values: valuesWith(r.values, paramsAt, 3) as never }),
				"fold-test"
			)
		await putOverride(sessionId, paramsAt, 9)
		const before = await worlds(sessionId)
		const rows = await sessionRows(sessionId)
		expect(await run()).toEqual({ ...ZERO, shadowed: 1 })
		expect(await overrideRows(sessionId)).toEqual([])
		expect(await worlds(sessionId)).toEqual(before)
		expect(await sessionRows(sessionId)).toEqual(rows)
		for (const k of keys)
			expect(
				before[k]![`${paramsAt.nodeKey}·${paramsAt.slot}·${paramsAt.path}`]
			).toBe(3)
	})

	it("both, the registration value unusable: the override's value moves over it", async () => {
		const sessionId = await newSession()
		const keys = await keysOf(sessionId)
		const { patchSessionRow } = await import(
			"$lib/server/sessions/settingsForm"
		)
		// Written as stored data, past the writer's checks: not a prompt id.
		for (const k of keys)
			await patchSessionRow(
				db as never,
				sessionId,
				k,
				() => ({
					values: { [promptAt.nodeKey]: { [promptAt.slot]: "oops" } } as never
				}),
				"fold-test"
			)
		await putOverride(sessionId, promptAt, promptB)
		const before = await worlds(sessionId)
		expect(await run()).toEqual({ ...ZERO, moved: 1 })
		expect(await overrideRows(sessionId)).toEqual([])
		expect(await worlds(sessionId)).toEqual(before)
		for (const r of await sessionRows(sessionId))
			expect(
				(r.values as never as Record<string, Record<string, unknown>>)[
					promptAt.nodeKey
				]![promptAt.slot]
			).toBe(promptB)
	})

	it("a spec registered twice: only the key without its own value takes it", async () => {
		const sessionId = await newSession()
		const extra = registrationKeyOf(OTHER_TRIGGER, STORY_RESPOND)
		await db.insert(schema.registrations).values({
			scopeKind: "session",
			scopeRef: String(sessionId),
			sessionId,
			key: extra,
			triggerFamily: "event",
			triggerRef: OTHER_TRIGGER.event,
			specSlug: STORY_RESPOND,
			values: { [paramsAt.nodeKey]: { [paramsAt.slot]: { [paramsAt.path]: 3 } } },
			origin: "fold-test"
		})
		const keys = await keysOf(sessionId)
		expect(keys).toContain(extra)
		const others = keys.filter((k) => k !== extra)
		expect(others.length).toBeGreaterThanOrEqual(1)
		await putOverride(sessionId, paramsAt, 9)
		const before = await worlds(sessionId)
		expect(await run()).toEqual({ ...ZERO, moved: 1 })
		expect(await worlds(sessionId)).toEqual(before)
		const rows = await sessionRows(sessionId)
		const at = (key: string) =>
			(
				rows.find((r) => r.key === key)!.values as never as Record<
					string,
					Record<string, Record<string, unknown>>
				>
			)[paramsAt.nodeKey]![paramsAt.slot]![paramsAt.path]
		expect(at(extra)).toBe(3)
		for (const k of others) expect(at(k)).toBe(9)
	})

	it("a connection-slot row is deleted, never moved", async () => {
		const sessionId = await newSession()
		await putOverride(sessionId, connectionAt, 1)
		const rowsBefore = await sessionRows(sessionId)
		expect(await run()).toEqual({ ...ZERO, connections: 1 })
		expect(await overrideRows(sessionId)).toEqual([])
		expect(await sessionRows(sessionId)).toEqual(rowsBefore)
	})

	it("a pipeline the session does not register, and a session that is gone, stay", async () => {
		const sessionId = await newSession()
		const [other] = await db
			.insert(schema.pipelineSpecs)
			.values({ slug: "acme:spec/fold-other", name: "Other" })
			.returning()
		await putOverride(sessionId, paramsAt, 5, other!.id)
		const gone = await newSession()
		await putOverride(gone, paramsAt, 5)
		await db.delete(schema.sessions).where(eq(schema.sessions.id, gone))
		const report = await run()
		expect(report.leftNoRegistration).toBe(1)
		expect(report.leftNoSession).toBe(1)
		expect(report.moved + report.shadowed + report.connections).toBe(0)
		expect((await overrideRows(sessionId)).length).toBe(1)
		expect((await overrideRows(gone)).length).toBe(1)
		await db
			.delete(schema.pipelineNodeOverrides)
			.where(eq(schema.pipelineNodeOverrides.scopeId, gone))
		await db
			.delete(schema.pipelineNodeOverrides)
			.where(eq(schema.pipelineNodeOverrides.scopeId, sessionId))
	})

	it("a null value is unmappable and stays", async () => {
		const sessionId = await newSession()
		await putOverride(sessionId, paramsAt, null)
		const before = await worlds(sessionId)
		expect(await run()).toEqual({ ...ZERO, leftUnmappable: 1 })
		expect((await overrideRows(sessionId)).length).toBe(1)
		expect(await worlds(sessionId)).toEqual(before)
		await db
			.delete(schema.pipelineNodeOverrides)
			.where(eq(schema.pipelineNodeOverrides.scopeId, sessionId))
	})

	it("a prompt whose fields the key's own prompt lacks stays, and the run reads the same", async () => {
		const sessionId = await newSession()
		const keys = await keysOf(sessionId)
		const { createPrompt } = await import("$lib/server/pipelines/entities/prompts")
		const own = await createPrompt(db as never, {
			nodeDefinitionId: "fold-test:node@1",
			slot: promptAt.slot,
			name: "fold own",
			fields: { system: "own system" }
		})
		const old = await createPrompt(db as never, {
			nodeDefinitionId: "fold-test:node@1",
			slot: promptAt.slot,
			name: "fold old",
			fields: { system: "old system", extra: "old extra" }
		})
		const { patchSessionRow, valuesWith } = await import(
			"$lib/server/sessions/settingsForm"
		)
		for (const k of keys)
			await patchSessionRow(
				db as never,
				sessionId,
				k,
				(r) => ({ values: valuesWith(r.values, { ...promptAt, path: "" }, own.id) as never }),
				"fold-test"
			)
		await putOverride(sessionId, promptAt, old.id)
		const before = await worlds(sessionId)
		// The run reads `system` from the session's prompt and `extra` from the old row.
		for (const k of keys) {
			expect(before[k]![`${promptAt.nodeKey}·${promptAt.slot}·system`]).toBe("own system")
			expect(before[k]![`${promptAt.nodeKey}·${promptAt.slot}·extra`]).toBe("old extra")
		}
		const rows = await sessionRows(sessionId)
		expect(await run()).toEqual({ ...ZERO, leftUnmappable: 1 })
		expect((await overrideRows(sessionId)).length).toBe(1)
		expect(await sessionRows(sessionId)).toEqual(rows)
		expect(await worlds(sessionId)).toEqual(before)
		await db
			.delete(schema.pipelineNodeOverrides)
			.where(eq(schema.pipelineNodeOverrides.scopeId, sessionId))
	})

	it("a path-less row over values held by path is left, and a second boot changes nothing", async () => {
		const sessionId = await newSession()
		const keys = await keysOf(sessionId)
		const { declarations } = await import("$lib/server/pipelines/config/panel")
		const [spec] = await db
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.id, specId))
		const decls = await declarations(db as never, spec!.activeVersionId!)
		const whole = decls.find(
			(d) =>
				d.path === "" &&
				d.matrixSlot !== "connection" &&
				!/-ref$/.test(d.control ?? "")
		)
		// A declared path-less address; the slot also holds an undeclared path
		// (`addressedValues` reads it too), so the merged check leaves the row.
		expect(whole).toBeDefined()
		const sibling = { nodeKey: whole!.nodeKey, slot: whole!.slot, path: "ghost" }
		const { patchSessionRow, valuesWith } = await import(
			"$lib/server/sessions/settingsForm"
		)
		for (const k of keys)
			await patchSessionRow(
				db as never,
				sessionId,
				k,
				(r) => ({
					values: valuesWith(
						r.values,
						sibling,
						7
					) as never
				}),
				"fold-test"
			)
		await putOverride(
			sessionId,
			{ nodeKey: whole!.nodeKey, slot: whole!.slot, path: "" },
			{ other: 1 }
		)
		const before = await worlds(sessionId)
		const rows = await sessionRows(sessionId)
		const overrides = await overrideRows(sessionId)
		const regs = await db.select().from(schema.registrations)
		const first = await run()
		expect(first).toEqual({ ...ZERO, leftUnmappable: 1 })
		expect(await sessionRows(sessionId)).toEqual(rows)
		expect(await overrideRows(sessionId)).toEqual(overrides)
		expect(await worlds(sessionId)).toEqual(before)
		const second = await run()
		expect(second).toEqual(first)
		expect(await sessionRows(sessionId)).toEqual(rows)
		expect(await overrideRows(sessionId)).toEqual(overrides)
		expect(await db.select().from(schema.registrations)).toEqual(regs)
		await db
			.delete(schema.pipelineNodeOverrides)
			.where(eq(schema.pipelineNodeOverrides.scopeId, sessionId))
	})

	it("both, the registration value naming no prompt: the override's prompt moves over it", async () => {
		const sessionId = await newSession()
		const keys = await keysOf(sessionId)
		const { patchSessionRow } = await import(
			"$lib/server/sessions/settingsForm"
		)
		// Stored data past the writer's checks: an id that names no prompt row.
		for (const k of keys)
			await patchSessionRow(
				db as never,
				sessionId,
				k,
				() => ({
					values: { [promptAt.nodeKey]: { [promptAt.slot]: 987654321 } } as never
				}),
				"fold-test"
			)
		await putOverride(sessionId, promptAt, promptB)
		const before = await worlds(sessionId)
		expect(await run()).toEqual({ ...ZERO, moved: 1 })
		expect(await overrideRows(sessionId)).toEqual([])
		expect(await worlds(sessionId)).toEqual(before)
		for (const r of await sessionRows(sessionId))
			expect(
				(r.values as never as Record<string, Record<string, unknown>>)[
					promptAt.nodeKey
				]![promptAt.slot]
			).toBe(promptB)
	})

	it("a second run changes nothing", async () => {
		const sessionId = await newSession()
		await putOverride(sessionId, paramsAt, 11)
		await putOverride(sessionId, connectionAt, 1)
		await putOverride(sessionId, { ...paramsAt, path: "ghost" }, null)
		expect(await run()).toEqual({
			...ZERO,
			moved: 1,
			connections: 1,
			leftUnmappable: 1
		})
		const rows = await sessionRows(sessionId)
		const all = await db.select().from(schema.pipelineNodeOverrides)
		const regs = await db.select().from(schema.registrations)
		const second = await run()
		expect(second).toEqual({ ...ZERO, leftUnmappable: 1 })
		expect(await sessionRows(sessionId)).toEqual(rows)
		expect(await db.select().from(schema.pipelineNodeOverrides)).toEqual(all)
		expect(await db.select().from(schema.registrations)).toEqual(regs)
	})
})
