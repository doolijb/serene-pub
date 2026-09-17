/**
 * Two values at the `session` scope, and which one the run uses.
 *
 * `sessions.sampling_config_id` and a session-scope `pipeline_node_overrides`
 * row are both projected into the world at `scopeKind: "session"`, and
 * `resolveConfigSources` takes the FIRST candidate it finds at each scope. So
 * the answer is decided by nothing but the order the two are pushed in
 * `world.ts` — there is no comparison, no tie-break, and no warning. Swapping
 * those two blocks is a **silent flip**: nothing throws either way, the panel
 * goes on showing the pick, and the run samples with something else.
 *
 * ## It was the CONNECTION slot until 0130
 *
 * The session's `connection_id` was the other half of that block and the reason
 * this file was written: it sat above `applyPipelineLayer` and silently
 * outranked the connection chosen in the pipeline panel. The column is gone —
 * overrides are by model now, never by connection — and the one connection
 * override left is the pipeline configuration's provider slot, which IS a
 * `pipeline_node_overrides` row and so has nothing at its own scope to race.
 *
 * The hazard did not go with it. `sampling_config_id` stays on `sessions`, it is
 * projected in the very block that used to carry both, and unlike the connection
 * it is a control a person can still reach: there is a session sampling picker.
 * So the ordering is pinned here for the half that survived, which is now the
 * half with the exposure.
 *
 * ## The trap
 *
 * A test that sets only ONE of the two proves nothing at all: whichever is
 * present is the only candidate, and it wins under either ordering. Both are set
 * here, to different configs, and the assertion names which comes back.
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
/** What `sessions.sampling_config_id` points at — the session's own column. */
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
	await bootstrapPipelines(db)

	const make = async (name: string) =>
		(
			await db
				.insert(schema.samplingConfigs)
				.values({ name, values: {} })
				.returning()
		)[0].id

	// Three DIFFERENT sampling configs, one per tier, so every assertion below
	// can only be satisfied by the tier it names. Pointing two of them at one
	// row would make this file green under any ordering — the same trap
	// `slotAddress.int.test.ts` documents about the instance default.
	instanceDefaultId = await make("The instance default")
	sessionColumnId = await make("sessions.sampling_config_id")
	panelPickId = await make("The panel's pick")

	// A connection beside it, because the provider slot's capability is what
	// decides whether the session block projects at all (`providerIsText`), and
	// that is read from the registered default for the slot's transform.
	const [connection] = await db
		.insert(schema.connections)
		.values({ name: "The instance's endpoint", type: "ollama" })
		.returning()

	const { setCapabilityDefault } = await import(
		"$lib/server/connections/capabilityDefaults"
	)
	await setCapabilityDefault(db, "text->text", {
		connectionId: connection.id,
		samplingConfigId: instanceDefaultId
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
			samplingConfigId: sessionColumnId
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
const resolvedSampling = async () => {
	const { buildWorld } = await import("$lib/server/pipelines/config/world")
	const world = await buildWorld(db, {
		sessionId,
		specId: RESPOND_SPEC_ID
	})
	const sourced: any = resolveConfigSources(world as any, ["generate"])
	return sourced?.generate?.sampling?.[SLOT_VALUE]
}

describe("two session-scope candidates for one sampling slot", () => {
	it("with only the session's column set, that is what resolves", async () => {
		// The control. Without it a failure below could equally mean the column
		// is not projected at all, which is a different bug with the same shape.
		const at = await resolvedSampling()
		expect(at?.value).toBe(String(sessionColumnId))
		expect(at?.scopeKind).toBe("session")
	})

	it("the panel's session-scope override outranks sessions.sampling_config_id", async () => {
		// THE assertion. Both are at `session`; the winner is whichever
		// `world.ts` pushed first, and it must be this one.
		await db.insert(schema.pipelineNodeOverrides).values({
			specId,
			scopeKind: "session",
			scopeId: sessionId,
			nodeKey: "generate",
			slot: "sampling",
			path: SLOT_VALUE,
			value: panelPickId
		})

		const at = await resolvedSampling()
		// `Number(...)` on purpose, and the reason is the second defect on this
		// path: the panel commits an id as a JSON **number** while the legacy
		// projection stringifies it, so the two candidates for this one slot do
		// not even carry the same type. Comparing the id here rather than the
		// representation keeps this file about the ORDER; the type mismatch and
		// what it costs the executor is `slotAddress.int.test.ts`'s subject.
		expect(
			Number(at?.value),
			"the pipeline panel's pick must win over sessions.sampling_config_id — " +
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
			.set({ samplingConfigId: null })
			.where(eq(schema.sessions.id, sessionId))

		const at = await resolvedSampling()
		expect(at?.value).toBe(String(instanceDefaultId))
		expect(at?.scopeKind).toBe("defaults")
	})
})
