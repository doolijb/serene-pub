/**
 * Two values at the `session` scope, and which one the run uses.
 *
 * `sessions.connection_id` and a session-scope `pipeline_node_overrides` row are
 * both projected into the world at `scopeKind: "session"`, and
 * `resolveConfigSources` takes the FIRST candidate it finds at each scope. So the
 * answer is decided by nothing but the order the two are pushed in `world.ts` —
 * there is no comparison, no tie-break, and no warning.
 *
 * It was the wrong way round. The legacy column was pushed before
 * `applyPipelineLayer` ran, so it silently outranked the pick a person made in
 * the pipeline panel: the panel showed one connection and the run used another,
 * on any session where both were set. Moving the column's block below the
 * pipeline layer is the fix, and it is a **silent flip** — nothing throws either
 * way — which is why it does not ship without this file.
 *
 * ## The trap
 *
 * A test that sets only ONE of the two proves nothing at all: whichever is
 * present is the only candidate, and it wins under either ordering. Both are set
 * here, to different connections, and the assertion names which comes back.
 *
 * Exposure in the product is near zero — there is no session connection picker
 * left in the sessions UI, so `sessions.connection_id` is only populated on
 * upgraded installs. That is an argument for the change being safe, not for
 * leaving it unpinned: the next person to reorder those two blocks will be
 * moving code that looks purely cosmetic.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import { resolveConfigSources, SLOT_VALUE } from "@serene-pub/sdk"
import type { TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { RESPOND_SPEC_ID } from "$lib/server/pipelines/specs"

let db: TestDb
let dataDir: string
let sessionId: number
let specId: number
/** What `sessions.connection_id` points at — the legacy column. */
let sessionColumnId: number
/** What the pipeline panel's session-scope override points at. */
let panelPickId: number
/** The instance's registered `text->text` default, under both of them. */
let instanceDefaultId: number

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "session-scope-order-secret" }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-session-scope-order-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir

	const dbModule = await import("$lib/server/db")
	db = dbModule.db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()

	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(db as any)

	const make = async (name: string) =>
		(
			await db
				.insert(schema.connections)
				.values({ name, type: "ollama" })
				.returning()
		)[0].id

	// Three DIFFERENT connections, one per tier, so every assertion below can
	// only be satisfied by the tier it names. Pointing two of them at one row
	// would make this file green under any ordering — the same trap
	// `slotAddress.int.test.ts` documents about the instance default.
	instanceDefaultId = await make("The instance default")
	sessionColumnId = await make("sessions.connection_id")
	panelPickId = await make("The panel's pick")

	const { setCapabilityDefault } = await import(
		"$lib/server/connections/capabilityDefaults"
	)
	await setCapabilityDefault(db as any, "text->text", {
		connectionId: instanceDefaultId
	})

	const [user] = await db
		.insert(schema.users)
		.values({ username: "session-scope-order-user", isAdmin: false })
		.returning()
	const [session] = await db
		.insert(schema.sessions)
		.values({
			userId: user.id,
			isGroup: false,
			connectionId: sessionColumnId
		})
		.returning()
	sessionId = session.id

	const [spec] = await db
		.select()
		.from(schema.pipelineSpecs)
		.where(eq(schema.pipelineSpecs.slug, RESPOND_SPEC_ID))
	specId = spec.id
}, 180_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

/** What the panel shows and the executor resolves — one read, so they cannot differ. */
const resolvedConnection = async () => {
	const { buildWorld } = await import("$lib/server/pipelines/config/world")
	const world = await buildWorld(db as any, {
		sessionId,
		specId: RESPOND_SPEC_ID
	})
	const sourced: any = resolveConfigSources(world as any, ["generate"])
	return sourced?.generate?.connection?.[SLOT_VALUE]
}

describe("two session-scope candidates for one connection slot", () => {
	it("with only the legacy column set, that is what resolves", async () => {
		// The control. Without it a failure below could equally mean the column
		// is not projected at all, which is a different bug with the same shape.
		const at = await resolvedConnection()
		expect(at?.value).toBe(String(sessionColumnId))
		expect(at?.scopeKind).toBe("session")
	})

	it("the panel's session-scope override outranks sessions.connection_id", async () => {
		// THE assertion. Both are at `session`; the winner is whichever
		// `world.ts` pushed first, and it must be this one.
		await db.insert(schema.pipelineNodeOverrides).values({
			specId,
			scopeKind: "session",
			scopeId: sessionId,
			nodeKey: "generate",
			slot: "connection",
			path: SLOT_VALUE,
			value: panelPickId
		})

		const at = await resolvedConnection()
		// `Number(...)` on purpose, and the reason is the second defect on this
		// path: the panel commits an id as a JSON **number** while the legacy
		// projection stringifies it, so the two candidates for this one slot do
		// not even carry the same type. Comparing the id here rather than the
		// representation keeps this file about the ORDER; the type mismatch and
		// what it costs the executor is `slotAddress.int.test.ts`'s subject.
		expect(
			Number(at?.value),
			"the pipeline panel's pick must win over sessions.connection_id — " +
				"both sit at the `session` scope and resolution takes the first pushed, " +
				"so this fails the moment the two blocks in world.ts swap back."
		).toBe(panelPickId)
		expect(at?.scopeKind).toBe("session")
	})

	it("and the instance default still sits under both of them", async () => {
		// The floor is unchanged by the move: `defaults` is below `session` in
		// SCOPE_ORDER either way, so a reordering that broke the tier chain
		// rather than the tie-break would show up here.
		await db
			.delete(schema.pipelineNodeOverrides)
			.where(eq(schema.pipelineNodeOverrides.specId, specId))
		await db
			.update(schema.sessions)
			.set({ connectionId: null })
			.where(eq(schema.sessions.id, sessionId))

		const at = await resolvedConnection()
		expect(at?.value).toBe(String(instanceDefaultId))
		expect(at?.scopeKind).toBe("defaults")
	})
})
