/**
 * A connection picked in the config panel must reach the executor.
 *
 * It never did. One logical value had three storage addresses and no two agreed:
 * the panel wrote `path: ""`, the legacy projection in `world.ts` wrote `"ref"`,
 * and the SDK executor read `"$ref"`. Resolution is exact-match on
 * `(nodeKey, slot, path)`, evaluated per path independently, so the three were
 * unrelated addresses that could never collide and never warn. The pick was
 * saved, echoed back on screen, and read by nobody.
 *
 * ## Why no existing test caught it
 *
 * Every test lived on one side of the seam. The panel suite wrote and read
 * through the panel — self-consistent at `""`. The SDK's use-case suite wrote and
 * read through `resolveConfig` — self-consistent at `"$ref"`, and green for as
 * long as the bug existed, because a symmetric write/read passes at *any* agreed
 * address. Nothing spanned writer → world → resolver → executor.
 *
 * ## The trap this file exists to avoid
 *
 * There is a second, independent break on the same path: the panel commits an id
 * as a JSON **number**, while `buildWorld` projects connection ids as **strings**,
 * and the executor compared with `===`. When that comparison fails, `resolveSlot`
 * falls through to `world.activeConnection[kind]` — the instance default — which
 * on a normal install is *the very connection the user picked*.
 *
 * So a test that seeds one connection, or points the instance default at the same
 * connection it picks, passes whether or not any of this works. **The default is
 * deliberately set to a different connection than the one chosen**, and the
 * assertion is that the CHOSEN one comes back. Without that, this file would be
 * one more green, meaningless test about an address nobody writes to.
 */

import { describe, it, expect, beforeAll } from "vitest"
import { and, eq } from "drizzle-orm"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { resolveConfig, SLOT_VALUE } from "@serene-pub/sdk"
import {
	namespaceView,
	writeOption,
	type ConfigOption,
	type NamespaceView
} from "$lib/server/pipelines/config/panel"
import { buildWorld } from "$lib/server/pipelines/config/world"
import { RESPOND_SPEC_ID } from "$lib/server/pipelines/boot/bootstrap"

const SECRET = "slot-address-secret"

let db: TestDb
let adminId: number
/** The one the user picks. */
let chosenId: number
/** The instance default — deliberately NOT the chosen one. */
let defaultId: number

beforeAll(async () => {
	db = await createTestDb()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(db as any)

	const [admin] = await db
		.insert(schema.users)
		.values({ username: "slot-address-admin", isAdmin: true })
		.returning()
	adminId = admin.id

	const [fallback] = await db
		.insert(schema.connections)
		.values({
			name: "The instance default",
			type: "ollama",
			baseUrl: "http://localhost:11434"
		})
		.returning()
	defaultId = fallback.id

	const [picked] = await db
		.insert(schema.connections)
		.values({
			name: "The one that was picked",
			type: "ollama",
			baseUrl: "http://localhost:9999"
		})
		.returning()
	chosenId = picked.id

	// The fallback the broken path lands on. If this pointed at `chosenId` the
	// whole file would prove nothing.
	const [settings] = await db.select().from(schema.systemSettings).limit(1)
	if (settings)
		await db
			.update(schema.systemSettings)
			.set({ defaultConnectionId: defaultId })
			.where(eq(schema.systemSettings.id, settings.id))
	else
		await db
			.insert(schema.systemSettings)
			.values({ id: 1, defaultConnectionId: defaultId })

	// A global edit lands in the instance's SELECTED config, and the shipped one
	// is immutable by design ("duplicate it and edit the copy"). So do that —
	// otherwise every write here refuses and the file tests nothing.
	const { duplicateConfig, selectConfig } = await import(
		"$lib/server/pipelines/config/named"
	)
	const [spec] = await db
		.select()
		.from(schema.pipelineSpecs)
		.where(eq(schema.pipelineSpecs.slug, RESPOND_SPEC_ID))
	const [shipped] = await db
		.select()
		.from(schema.pipelineConfigs)
		.where(
			and(
				eq(schema.pipelineConfigs.specId, spec.id),
				eq(schema.pipelineConfigs.isImmutable, true)
			)
		)
	const copy = await duplicateConfig(db as any, shipped.id, "Slot address copy")
	await selectConfig(db as any, spec.id, "instance", 0, copy.id, adminId)
}, 60_000)

const viewer = () => ({ userId: adminId, isAdmin: true })

const allOptions = (v: NamespaceView): ConfigOption[] =>
	v.steps.flatMap((s) => [...s.options, ...s.advanced])

const connectionOption = async (): Promise<ConfigOption> => {
	const v = (await namespaceView(
		db as any,
		SECRET,
		RESPOND_SPEC_ID,
		viewer()
	)) as NamespaceView
	const found = allOptions(v).find((o) => o.control === "connection-ref")
	expect(found, "the respond spec should expose a connection slot").toBeTruthy()
	return found!
}

/** The node a connection option belongs to, so the assertion can name it. */
const nodeKeyOf = async (option: ConfigOption): Promise<string> => {
	const [row] = await db
		.select()
		.from(schema.pipelineConfigValues)
		.where(eq(schema.pipelineConfigValues.slot, "connection"))
		.limit(1)
	return row?.nodeKey ?? "generate"
}

describe("a connection pick reaches the executor", () => {
	it("is stored at the one address everything agrees on", async () => {
		const option = await connectionOption()
		await writeOption(
			db as any,
			SECRET,
			RESPOND_SPEC_ID,
			viewer(),
			option.id,
			chosenId
		)

		const rows = await db
			.select()
			.from(schema.pipelineConfigValues)
			.where(eq(schema.pipelineConfigValues.slot, "connection"))

		expect(rows.length).toBeGreaterThan(0)
		// Not `"ref"`, not `"$ref"`. One address, and it is the empty one.
		for (const r of rows) expect(r.path).toBe(SLOT_VALUE)
	})

	it("survives buildWorld → resolveConfig at that same address", async () => {
		const option = await connectionOption()
		await writeOption(
			db as any,
			SECRET,
			RESPOND_SPEC_ID,
			viewer(),
			option.id,
			chosenId
		)

		const nodeKey = await nodeKeyOf(option)
		const world = await buildWorld(db as any, { specId: RESPOND_SPEC_ID })
		const resolved = resolveConfig(world, [nodeKey])

		expect(resolved[nodeKey]?.connection?.[SLOT_VALUE]).toBeDefined()
		expect(String(resolved[nodeKey]!.connection![SLOT_VALUE])).toBe(
			String(chosenId)
		)
	})

	it("resolves to the CHOSEN connection, not the instance default", async () => {
		// The assertion the whole file is for. `resolveSlot` falls back to
		// `activeConnection` when the pick does not resolve, so this only means
		// anything because the default is a different row.
		const option = await connectionOption()
		await writeOption(
			db as any,
			SECRET,
			RESPOND_SPEC_ID,
			viewer(),
			option.id,
			chosenId
		)

		const nodeKey = await nodeKeyOf(option)
		const world = await buildWorld(db as any, { specId: RESPOND_SPEC_ID })
		const resolved = resolveConfig(world, [nodeKey])
		const picked = String(resolved[nodeKey]!.connection![SLOT_VALUE])

		expect(picked).toBe(String(chosenId))
		expect(picked).not.toBe(String(defaultId))

		// And the id the world offers is findable by it — the string/number
		// mismatch that used to make `===` silently false.
		const record = world.connections.find(
			(c) => String(c.id) === String(picked)
		)
		expect(record, "the picked id must match a projected connection").toBeTruthy()
		expect(record!.name).toBe("The one that was picked")
	})

	it("still falls back to the instance default when nothing is picked", async () => {
		// The fallback is correct behaviour, not the bug — the bug was that it was
		// the ONLY behaviour. A node with no pick must still resolve.
		const world = await buildWorld(db as any, { specId: RESPOND_SPEC_ID })
		expect(Object.values(world.activeConnection)).toContain(String(defaultId))
	})
})
