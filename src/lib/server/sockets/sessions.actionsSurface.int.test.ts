/**
 * The action surface (19 §4, U-C5), over the sockets.
 *
 * What is pinned: the contributed action set reaches the client from rows
 * (the narrate button is the narrate spec's declaration, listed only for
 * participants); and the generic function fire routes contributed functions
 * only — the two bespoke lifecycles keep their dedicated events, and a
 * function nothing serves refuses with the reason rather than running
 * nothing quietly.
 */
import { NARRATE_ACTION, NARRATE_CHARACTER_ACTION } from "$lib/shared/actions/identity"
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

/** The contributed actions at the composer and message venues, primary and overflow. */
function contributed(res: {
	venues: Record<string, { primary: any[]; overflow: any[] }>
}) {
	return (["composer", "message"] as const).flatMap((kind) =>
		[
			...(res.venues[kind]?.primary ?? []),
			...(res.venues[kind]?.overflow ?? [])
		].filter((a) => a.origin !== "core")
	)
}

describe("sessions:actions — the contributed set", () => {
	test("a participant gets the mode's contributed set — the narrate button, from rows", async () => {
		const { sessionsActionsHandler } = await import("./sessions")
		const schema = await import("$lib/server/db/schema")

		const user = await makeUser("triggers-owner")
		const [session] = await testDb
			.insert(schema.sessions)
			.values({ userId: user.id, isGroup: false })
			.returning()

		const res = await sessionsActionsHandler.handler(
			fakeSocket(user.id),
			{ sessionId: session.id },
			noopEmit
		)
		// Narrate's row specifically — every core spec contributing a button
		// shows up here, and this test is about the mode's set REACHING a
		// participant, not about which specs happen to be published.
		expect(contributed(res)).toContainEqual(
			expect.objectContaining({
				key: "narrate",
				venue: "composer",
				name: "Narrate",
				specSlug: "core:spec/narrate"
			})
		)

		/**
		 * The narrator split's other half (ruling 2026-09-07). Its own
		 * identity, because `resolveSubjectSpec` keys on exactly that and
		 * two specs answering one subject would be a coin toss.
		 */
		expect(contributed(res)).toContainEqual(
			expect.objectContaining({
				key: "narrate-character",
				venue: "composer",
				specSlug: "core:spec/narrate-character"
			})
		)

		// A non-participant gets nothing — the list describes what a person
		// in the session can press.
		const stranger = await makeUser("triggers-stranger")
		const denied = await sessionsActionsHandler.handler(
			fakeSocket(stranger.id),
			{ sessionId: session.id },
			noopEmit
		)
		expect(contributed(denied)).toEqual([])
	})
})

describe("sessions:fireAction", () => {
	test("the bespoke lifecycles keep their dedicated events", async () => {
		const { sessionsFireActionHandler } = await import("./sessions")
		const schema = await import("$lib/server/db/schema")

		const user = await makeUser("fire-owner")
		const [session] = await testDb
			.insert(schema.sessions)
			.values({ userId: user.id, isGroup: false })
			.returning()

		// The two narrator actions, by identity (plans/31 V2). Both need the
		// same bespoke lifecycle — a modal whose first step is *who speaks*,
		// and the streaming message row that answer creates — so this route
		// running either would produce a turn spoken by nobody in particular,
		// silently. It refuses by name instead.
		for (const action of [NARRATE_ACTION, NARRATE_CHARACTER_ACTION]) {
			const res = await sessionsFireActionHandler.handler(
				fakeSocket(user.id),
				{ sessionId: session.id, action },
				noopEmit
			)
			expect(res.error).toContain("has its own event")
		}
		// A core verb is a message verb with its own handler — `extend`
		// (ruling 2026-09-08, D-2) is the text already on one row, and this
		// route can neither flip that row to generating nor supply the
		// prefill. `sessionMessages:extend` is its lifecycle. The primary
		// turn is an event, not an action, and no identity names it.
		const verb = await sessionsFireActionHandler.handler(
			fakeSocket(user.id),
			{ sessionId: session.id, action: "core#extend" },
			noopEmit
		)
		expect(verb.error).toContain("its own handler")
	})

	test("narrate-character routes to its own spec", async () => {
		/**
		 * The refusal above proves this route declines it; this proves the
		 * function is nevertheless *served* — the two together are what make
		 * "it has its own event" a redirection rather than a dead button.
		 * `runReply` resolves the same way for a turn that carries a
		 * speaker.
		 */
		const { resolveSubjectSpec, STANDARD_GENRE_ID } = await import(
			"$lib/server/pipelines/entities/sessionGenres"
		)
		expect(
			await resolveSubjectSpec(
				testDb as any,
				STANDARD_GENRE_ID,
				NARRATE_CHARACTER_ACTION
			)
		).toBe("core:spec/narrate-character")
		// And the world narrator still answers its own, unmoved by the split.
		expect(
			await resolveSubjectSpec(
				testDb as any,
				STANDARD_GENRE_ID,
				NARRATE_ACTION
			)
		).toBe("core:spec/narrate")
	})

	test("a function nothing serves refuses with the reason", async () => {
		const { sessionsFireActionHandler } = await import("./sessions")
		const schema = await import("$lib/server/db/schema")

		const user = await makeUser("fire-nothing")
		const [session] = await testDb
			.insert(schema.sessions)
			.values({ userId: user.id, isGroup: false })
			.returning()

		const res = await sessionsFireActionHandler.handler(
			fakeSocket(user.id),
			{ sessionId: session.id, key: "summon-dragon" },
			noopEmit
		)
		expect(res.error).toBe("No action 'summon-dragon' is offered to this session.")
	})

	test("owner-only, like the narrator action", async () => {
		const { sessionsFireActionHandler } = await import("./sessions")
		const schema = await import("$lib/server/db/schema")

		const owner = await makeUser("fire-owner-2")
		const stranger = await makeUser("fire-stranger")
		const [session] = await testDb
			.insert(schema.sessions)
			.values({ userId: owner.id, isGroup: false })
			.returning()

		const res = await sessionsFireActionHandler.handler(
			fakeSocket(stranger.id),
			{ sessionId: session.id, key: "summon-dragon" },
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
		const { sessionsActionsHandler, sessionsSetFunctionHandler } =
			await import("./sessions")
		const { sessionsFireActionHandler } = await import("./sessions")
		const schema = await import("$lib/server/db/schema")

		const user = await makeUser("fn-gate")
		const [session] = await testDb
			.insert(schema.sessions)
			.values({ userId: user.id, isGroup: false })
			.returning()

		// Present to begin with: narrate is a companion on the standard mode.
		const before = await sessionsActionsHandler.handler(
			fakeSocket(user.id),
			{ sessionId: session.id },
			noopEmit
		)
		expect(contributed(before).map((t) => t.key)).toContain("narrate")

		const set = await sessionsSetFunctionHandler.handler(
			fakeSocket(user.id),
			{ sessionId: session.id, action: NARRATE_ACTION, enabled: false },
			noopEmit
		)
		expect(set.error).toBeUndefined()

		const after = await sessionsActionsHandler.handler(
			fakeSocket(user.id),
			{ sessionId: session.id },
			noopEmit
		)
		expect(contributed(after).map((t) => t.key)).not.toContain("narrate")

		// `narrate` has its own lifecycle event, so the generic route refuses
		// it for that reason first — the gate is asserted on the surface here,
		// and on a generic action in the entity suite.
		const fired = await sessionsFireActionHandler.handler(
			fakeSocket(user.id),
			{ sessionId: session.id, action: NARRATE_ACTION },
			noopEmit
		)
		expect(fired.error).toBeTruthy()
	})

	test("an action nobody contributes still says so, not 'turned off'", async () => {
		const { sessionsFireActionHandler } = await import("./sessions")
		const schema = await import("$lib/server/db/schema")

		const user = await makeUser("fn-unknown")
		const [session] = await testDb
			.insert(schema.sessions)
			.values({ userId: user.id, isGroup: false })
			.returning()

		const res = await sessionsFireActionHandler.handler(
			fakeSocket(user.id),
			{ sessionId: session.id, key: "summon-dragon" },
			noopEmit
		)
		expect(res.error).toContain("No action 'summon-dragon' is offered")
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
			{ sessionId: session.id, action: NARRATE_ACTION, enabled: true },
			noopEmit
		)
		expect(denied.error).toMatch(/administrator/i)

		const allowed = await sessionsSetFunctionHandler.handler(
			fakeSocket(user.id, true),
			{ sessionId: session.id, action: NARRATE_ACTION, enabled: true },
			noopEmit
		)
		expect(allowed.error).toBeUndefined()
		expect(allowed.enabled).toBe(true)
	})
})
