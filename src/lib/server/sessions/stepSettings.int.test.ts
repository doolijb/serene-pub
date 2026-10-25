/**
 * 🚧 A session's step settings (PROPOSAL-live-scenes §15 G11) against the
 * published catalogue: Chat's reply tick and sprite picker are offered to the
 * session's owner — member or admin — and nothing of a model's plumbing is;
 * a write lands at session scope where the run reads it, a value equal to
 * what it inherits stores nothing, and a bad value or address is refused in
 * a sentence.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import { resolveConfigSources } from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 })

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, dbReady: Promise.resolve() }
})

let testDb: TestDb
let dataDir: string

const CHAT_GENRE = "core:genre/story"
const CHAT_RESPOND = "core:spec/story-respond"
/** The reply's own steps, by the addresses its document gives them (Story's sit in its `reply` junction). */
let reply: { generate: string; save: string; spritePick?: string; spriteShow?: string }

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-step-settings-int-test-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(testDb as any)
	reply = await (await import("$lib/server/utils/testDb")).replyStepKeys(testDb, CHAT_RESPOND)
})

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

let seq = 0
async function makeSession() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `step-settings-${++seq}`)
	const [lorebook] = await testDb
		.insert(schema.lorebooks)
		.values({ name: `Step Book ${seq}`, userId: user.id })
		.returning()
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId: user.id, isGroup: false, lorebookId: lorebook.id, genreId: CHAT_GENRE } as any)
		.returning()
	return { user, session }
}

function recorder() {
	const emits: Array<{ event: string; data: any }> = []
	return { emits, emit: (event: string, data: any) => void emits.push({ event, data }) }
}

describe("what a session's step settings are", () => {
	test("Chat's reply tick and sprite picker; never a step that runs on a model, never plumbing", async () => {
		const { readStepSettings } = await import("./stepSettings")
		const w = await makeSession()
		const steps = await readStepSettings(testDb as any, w.session.id, w.user.id)
		const replySteps = steps.filter((s) => s.spec === CHAT_RESPOND)

		const tick = replySteps.find((s) => s.nodeKey === "tick")!
		expect(tick).toMatchObject({
			definitionId: "core:task/clock-step@1",
			heading: "Each reply advances the clock by"
		})
		expect(tick.fields.map((f) => [f.path, f.control, f.value, f.source])).toEqual([
			["by", "integer", 0, "author"],
			["unit", "enum", "minutes", "author"]
		])
		expect(tick.fields[1]!.members!.map((m) => m.key)).toEqual([
			"minutes",
			"hours",
			"days",
			"months",
			"years"
		])

		const sprites = replySteps.find((s) => s.nodeKey === reply.spritePick)!
		expect(sprites.fields.map((f) => f.control)).toContain("boolean")
		// 🚧 RF fix 3 (2026-10-23): ONE sprite picker, whichever branch writes the
		// reply — never a copy per branch, each its own setting for one thing.
		expect(replySteps.filter((s) => s.definitionId === sprites.definitionId).map((s) => s.nodeKey)).toEqual([reply.spritePick])
		expect(new Set(replySteps.map((s) => s.heading)).size).toBe(replySteps.length)

		// Nothing of a model's: the reply's own model call (`generate`) is not
		// exposed, and no exposed step offers a connection, sampling or a
		// prompt — every field is a plain value.
		for (const s of steps) {
			expect(s.nodeKey).not.toBe(reply.generate)
			for (const f of s.fields)
				expect(["integer", "number", "boolean", "enum", "string"]).toContain(f.control)
		}
	})

	test("a step that runs on a model is never one, even exposed: its parameters tune the call", async () => {
		const { readStepSettings } = await import("./stepSettings")
		const { published } = await import("$lib/server/pipelines/config/panel/declarations")
		const w = await makeSession()
		const at = (await published(testDb as any, CHAT_RESPOND))!
		const where = and(
			eq(schema.pipelineNodes.specVersionId, at.specVersionId),
			eq(schema.pipelineNodes.nodeKey, reply.generate)
		)
		const [before] = await testDb.select({ expose: schema.pipelineNodes.expose }).from(schema.pipelineNodes).where(where)
		// As the turn order's `advise` oracle is: a model call in session settings.
		await testDb.update(schema.pipelineNodes).set({ expose: { session: true } } as any).where(where)
		try {
			const steps = await readStepSettings(testDb as any, w.session.id, w.user.id)
			expect(steps.some((s) => s.spec === CHAT_RESPOND && s.nodeKey === reply.generate)).toBe(false)
			// The story settings beside it are still offered.
			expect(steps.some((s) => s.spec === CHAT_RESPOND && s.nodeKey === "tick")).toBe(true)
		} finally {
			await testDb.update(schema.pipelineNodes).set({ expose: before!.expose } as any).where(where)
		}
	})
})

describe("🚧 the specs bound to the session's events (§15 G19)", () => {
	const TURN_ORDER = "core:spec/story-turn-order"

	test("the turn order's own story settings are offered — who may be seated, the mention rule — never its advise oracle", async () => {
		const { readStepSettings } = await import("./stepSettings")
		const w = await makeSession()
		const steps = await readStepSettings(testDb as any, w.session.id, w.user.id)
		const turn = steps.filter((s) => s.spec === TURN_ORDER)
		expect(turn.map((s) => s.nodeKey)).toEqual(["pool", "mentioned"])
		// The model path is exposed to the session (its strategy can be
		// contributed to) but runs on a model: nothing of it is a step setting.
		expect(steps.some((s) => s.nodeKey.includes("advise"))).toBe(false)
		const pool = turn.find((s) => s.nodeKey === "pool")!
		expect(pool.definitionId).toBe("core:task/turn-pool@1")
		expect(pool.fields.map((f) => [f.path, f.control])).toEqual([
			["characters", "enum"],
			["personas", "enum"],
			["envoys", "enum"]
		])
		// The envoy list is a list — never a step setting's control.
		expect(pool.fields.some((f) => f.path === "envoySlugs")).toBe(false)
		const mentioned = turn.find((s) => s.nodeKey === "mentioned")!
		expect(mentioned.fields.map((f) => [f.path, f.control, f.value])).toEqual([["lookback", "integer", 1]])
		// The reply's own come first, as the session lists its pipelines.
		expect(steps.findIndex((s) => s.spec === CHAT_RESPOND)).toBeLessThan(
			steps.findIndex((s) => s.spec === TURN_ORDER)
		)
	})

	test("set at session scope where the turn order's run reads it", async () => {
		const { readStepSettings, writeStepSetting } = await import("./stepSettings")
		const w = await makeSession()
		await writeStepSetting(testDb as any, {
			sessionId: w.session.id,
			userId: w.user.id,
			spec: TURN_ORDER,
			nodeKey: "mentioned",
			path: "lookback",
			value: 4
		})
		const mentioned = (await readStepSettings(testDb as any, w.session.id, w.user.id)).find(
			(s) => s.spec === TURN_ORDER && s.nodeKey === "mentioned"
		)!
		expect(mentioned.fields[0]).toMatchObject({ path: "lookback", value: 4, source: "session", inherited: 1 })
		const { buildWorld } = await import("$lib/server/pipelines/config/world")
		const world = await buildWorld(testDb as any, { sessionId: w.session.id, specId: TURN_ORDER })
		const sourced: any = resolveConfigSources(world as any, ["mentioned"])
		expect(sourced?.mentioned?.params?.lookback?.value).toBe(4)
		// Its model call is no step setting, however it is asked.
		const { StepSettingRefusal } = await import("./stepSettings")
		await expect(
			writeStepSetting(testDb as any, {
				sessionId: w.session.id,
				userId: w.user.id,
				spec: TURN_ORDER,
				nodeKey: "decide.model.advise",
				path: "temperature",
				value: 1
			})
		).rejects.toBeInstanceOf(StepSettingRefusal)
	})
})

describe("setting one", () => {
	test("lands at session scope, where the run reads it; the inherited value clears it", async () => {
		const { readStepSettings, writeStepSetting } = await import("./stepSettings")
		const w = await makeSession()
		const at = { sessionId: w.session.id, userId: w.user.id, spec: CHAT_RESPOND, nodeKey: "tick" }
		await writeStepSetting(testDb as any, { ...at, path: "by", value: 5 })
		await writeStepSetting(testDb as any, { ...at, path: "unit", value: "hours" })

		const tick = (await readStepSettings(testDb as any, w.session.id, w.user.id)).find(
			(s) => s.spec === CHAT_RESPOND && s.nodeKey === "tick"
		)!
		expect(tick.fields.map((f) => [f.path, f.value, f.source, f.inherited])).toEqual([
			["by", 5, "session", 0],
			["unit", "hours", "session", "minutes"]
		])

		// The session's settings document — what every run of it is handed.
		const { resolveSessionSettings } = await import("./settings")
		const doc: any = await resolveSessionSettings(testDb as any, w.session.id)
		expect(doc.pipelines[CHAT_RESPOND].params.tick).toEqual({ by: 5, unit: "hours" })
		// And the run's own resolution: the session's row wins at the step.
		const { buildWorld } = await import("$lib/server/pipelines/config/world")
		const world = await buildWorld(testDb as any, { sessionId: w.session.id, specId: CHAT_RESPOND })
		const sourced: any = resolveConfigSources(world as any, ["tick"])
		expect(sourced?.tick?.params?.by?.value).toBe(5)
		expect(sourced?.tick?.params?.by?.scopeKind).toBe("session")

		// Back to what it inherits: no row; null clears too.
		await writeStepSetting(testDb as any, { ...at, path: "by", value: 0 })
		await writeStepSetting(testDb as any, { ...at, path: "unit", value: null })
		const rows = await testDb
			.select()
			.from(schema.pipelineNodeOverrides)
			.where(
				and(
					eq(schema.pipelineNodeOverrides.scopeKind, "session"),
					eq(schema.pipelineNodeOverrides.scopeId, w.session.id)
				)
			)
		expect(rows).toEqual([])
	})

	test("a value its control does not take, and an address no step offers, are refused in a sentence", async () => {
		const { writeStepSetting, StepSettingRefusal } = await import("./stepSettings")
		const w = await makeSession()
		const at = { sessionId: w.session.id, userId: w.user.id, spec: CHAT_RESPOND }
		await expect(
			writeStepSetting(testDb as any, { ...at, nodeKey: "tick", path: "by", value: 1.5 })
		).rejects.toThrow(/By is a whole number/)
		await expect(
			writeStepSetting(testDb as any, { ...at, nodeKey: "tick", path: "unit", value: "weeks" })
		).rejects.toThrow(/Unit is one of Minutes, Hours/)
		// The reply's model call is no step setting, however it is asked.
		await expect(
			writeStepSetting(testDb as any, { ...at, nodeKey: reply.generate, path: "maxTokens", value: 5 })
		).rejects.toBeInstanceOf(StepSettingRefusal)
	})
})

describe("the sockets: the owner's alone", () => {
	test("anyone else reads none and is refused a write", async () => {
		const { sessionsStepSettingsHandler, sessionsSetStepSettingHandler } = await import(
			"$lib/server/sockets/stepSettings"
		)
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const w = await makeSession()
		const stranger = await createTestUser(testDb, `step-settings-stranger-${++seq}`)

		const own = recorder()
		const read: any = await sessionsStepSettingsHandler.handler(
			{ user: { id: w.user.id } } as any,
			{ sessionId: w.session.id },
			own.emit
		)
		expect(read.steps.length).toBeGreaterThan(0)

		const other = recorder()
		const none: any = await sessionsStepSettingsHandler.handler(
			{ user: { id: stranger.id } } as any,
			{ sessionId: w.session.id },
			other.emit
		)
		expect(none.steps).toEqual([])
		const refused: any = await sessionsSetStepSettingHandler.handler(
			{ user: { id: stranger.id } } as any,
			{ sessionId: w.session.id, spec: CHAT_RESPOND, nodeKey: "tick", path: "by", value: 3, requestId: "r1" },
			other.emit
		)
		expect(refused).toMatchObject({ requestId: "r1", error: expect.stringMatching(/owner/) })

		const set: any = await sessionsSetStepSettingHandler.handler(
			{ user: { id: w.user.id } } as any,
			{ sessionId: w.session.id, spec: CHAT_RESPOND, nodeKey: "tick", path: "by", value: 3, requestId: "r2" },
			own.emit
		)
		expect(set.error).toBeUndefined()
		expect(set.requestId).toBe("r2")
		const tick = set.steps.find((s: any) => s.nodeKey === "tick")
		expect(tick.fields[0]).toMatchObject({ path: "by", value: 3, source: "session" })
		// Every tab of the owner's hears the fresh list.
		expect(own.emits.map((e) => e.event)).toContain("sessions:stepSettings")
	})
})
