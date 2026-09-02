/**
 * The trigger surface (19 §4, U-C5), over the sockets.
 *
 * What is pinned: the contributed trigger set reaches the client from rows
 * (the narrate button is the narrate spec's declaration, listed only for
 * participants); and the generic function fire routes contributed functions
 * only — the two bespoke lifecycles keep their dedicated events, and a
 * function nothing serves refuses with the reason rather than running
 * nothing quietly.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import type { TestDb } from "$lib/server/utils/testDb"
import { eq } from "drizzle-orm"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-triggers-surface-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir

	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb

	// The narrate contribution is a row; the rows come from bootstrap.
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(testDb as any)
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

async function makeUser(username: string) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, username)
}

function fakeSocket(userId: number, isAdmin = false) {
	return {
		user: { id: userId, isAdmin },
		io: { to: () => ({ emit: () => {} }) }
	} as any
}

const noopEmit = () => {}

describe("sessions:triggers", () => {
	test("a participant gets the mode's contributed set — the narrate button, from rows", async () => {
		const { sessionsTriggersHandler } = await import("./sessions")
		const schema = await import("$lib/server/db/schema")

		const user = await makeUser("triggers-owner")
		const [session] = await testDb
			.insert(schema.sessions)
			.values({ userId: user.id, isGroup: false })
			.returning()

		const res = await sessionsTriggersHandler.handler(
			fakeSocket(user.id),
			{ sessionId: session.id },
			noopEmit
		)
		// Narrate's row specifically — every core spec contributing a button
		// shows up here, and this test is about the mode's set REACHING a
		// participant, not about which specs happen to be published.
		expect(res.triggers).toContainEqual(
			expect.objectContaining({
				function: "narrate",
				kind: "button",
				name: "Narrate",
				specSlug: "core:spec/narrate"
			})
		)

		// A non-participant gets nothing — the list describes what a person
		// in the session can press.
		const stranger = await makeUser("triggers-stranger")
		const denied = await sessionsTriggersHandler.handler(
			fakeSocket(stranger.id),
			{ sessionId: session.id },
			noopEmit
		)
		expect(denied.triggers).toEqual([])
	})
})

describe("sessions:triggerFunction", () => {
	test("the bespoke lifecycles keep their dedicated events", async () => {
		const { sessionsTriggerFunctionHandler } = await import("./sessions")
		const schema = await import("$lib/server/db/schema")

		const user = await makeUser("fire-owner")
		const [session] = await testDb
			.insert(schema.sessions)
			.values({ userId: user.id, isGroup: false })
			.returning()

		for (const fn of ["respond", "narrate"]) {
			const res = await sessionsTriggerFunctionHandler.handler(
				fakeSocket(user.id),
				{ sessionId: session.id, function: fn },
				noopEmit
			)
			expect(res.error).toContain("its own trigger event")
		}
	})

	test("a function nothing serves refuses with the reason", async () => {
		const { sessionsTriggerFunctionHandler } = await import("./sessions")
		const schema = await import("$lib/server/db/schema")

		const user = await makeUser("fire-nothing")
		const [session] = await testDb
			.insert(schema.sessions)
			.values({ userId: user.id, isGroup: false })
			.returning()

		const res = await sessionsTriggerFunctionHandler.handler(
			fakeSocket(user.id),
			{ sessionId: session.id, function: "summon-dragon" },
			noopEmit
		)
		expect(res.error).toBe(
			"Nothing serves 'summon-dragon' for this session's mode."
		)
	})

	test("owner-only, like the narrator trigger", async () => {
		const { sessionsTriggerFunctionHandler } = await import("./sessions")
		const schema = await import("$lib/server/db/schema")

		const owner = await makeUser("fire-owner-2")
		const stranger = await makeUser("fire-stranger")
		const [session] = await testDb
			.insert(schema.sessions)
			.values({ userId: owner.id, isGroup: false })
			.returning()

		const res = await sessionsTriggerFunctionHandler.handler(
			fakeSocket(stranger.id),
			{ sessionId: session.id, function: "summon-dragon" },
			noopEmit
		)
		expect(res.error).toBe("Session not found.")
	})
})

/**
 * Turning an action off has to reach the fire, not only the button (19 §3).
 *
 * Hiding a button is presentation; anything that can emit a socket event still
 * has the function unless the handler refuses it. These two assertions are the
 * difference between a control surface and a decoration — and the second one
 * exists because ordering the checks wrongly made a function *nobody
 * contributes* report as "turned off", a refusal that points at a checkbox
 * which does not exist.
 */
describe("a session's action set gates both the surface and the fire", () => {
	test("switching narrate off removes its button and refuses its fire", async () => {
		const { sessionsTriggersHandler, sessionsSetFunctionHandler } =
			await import("./sessions")
		const { sessionsTriggerFunctionHandler } = await import("./sessions")
		const schema = await import("$lib/server/db/schema")

		const user = await makeUser("fn-gate")
		const [session] = await testDb
			.insert(schema.sessions)
			.values({ userId: user.id, isGroup: false })
			.returning()

		// Present to begin with: narrate is a companion on the standard mode.
		const before = await sessionsTriggersHandler.handler(
			fakeSocket(user.id),
			{ sessionId: session.id },
			noopEmit
		)
		expect(before.triggers.map((t) => t.function)).toContain("narrate")

		const set = await sessionsSetFunctionHandler.handler(
			fakeSocket(user.id),
			{ sessionId: session.id, function: "narrate", enabled: false },
			noopEmit
		)
		expect(set.error).toBeUndefined()

		const after = await sessionsTriggersHandler.handler(
			fakeSocket(user.id),
			{ sessionId: session.id },
			noopEmit
		)
		expect(after.triggers.map((t) => t.function)).not.toContain("narrate")

		// `narrate` has its own lifecycle event, so the generic route refuses
		// it for that reason first — the gate is asserted on the surface here,
		// and on a generic function in the entity suite.
		const fired = await sessionsTriggerFunctionHandler.handler(
			fakeSocket(user.id),
			{ sessionId: session.id, function: "narrate" },
			noopEmit
		)
		expect(fired.error).toBeTruthy()
	})

	test("a function nobody contributes still says so, not 'turned off'", async () => {
		const { sessionsTriggerFunctionHandler } = await import("./sessions")
		const schema = await import("$lib/server/db/schema")

		const user = await makeUser("fn-unknown")
		const [session] = await testDb
			.insert(schema.sessions)
			.values({ userId: user.id, isGroup: false })
			.returning()

		const res = await sessionsTriggerFunctionHandler.handler(
			fakeSocket(user.id),
			{ sessionId: session.id, function: "summon-dragon" },
			noopEmit
		)
		expect(res.error).toContain("Nothing serves")
	})

	test("a non-admin is told an administrator can add what the preset left out", async () => {
		const { sessionsSetFunctionHandler } = await import("./sessions")
		const schema = await import("$lib/server/db/schema")

		const user = await makeUser("fn-nonadmin")
		const [session] = await testDb
			.insert(schema.sessions)
			.values({ userId: user.id, isGroup: false })
			.returning()

		// Exclude everything on a preset this session selects, then try to add it
		// back as a non-admin.
		const [spec] = await testDb
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, "core:spec/respond"))
			.limit(1)
		const [cfg] = await testDb
			.insert(schema.pipelineConfigs)
			.values({
				specId: spec.id,
				name: `bare-${session.id}`,
				includedActions: []
			})
			.returning()
		await testDb.insert(schema.pipelineConfigSelections).values({
			specId: spec.id,
			scopeKind: "session",
			scopeId: session.id,
			configId: cfg.id
		})

		const denied = await sessionsSetFunctionHandler.handler(
			fakeSocket(user.id, false),
			{ sessionId: session.id, function: "narrate", enabled: true },
			noopEmit
		)
		expect(denied.error).toMatch(/administrator/i)

		const allowed = await sessionsSetFunctionHandler.handler(
			fakeSocket(user.id, true),
			{ sessionId: session.id, function: "narrate", enabled: true },
			noopEmit
		)
		expect(allowed.error).toBeUndefined()
		expect(allowed.enabled).toBe(true)
	})
})
