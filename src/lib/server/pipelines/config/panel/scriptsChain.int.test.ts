/**
 * Script chains in the configuration panel (18 §4a) — attachment, as the
 * pipeline view sees it.
 *
 * What is pinned: the hook renders as one whole-chain option on the step that
 * declares it; the picker offers only rows of the accepted types; a write is
 * validated against the declaration (homogeneity refuses at attach, never at
 * run time); the stored value is the ordered id list at slot `scripts` — the
 * exact shape the scripts page's `usedBy` scan and delete refusal read, so
 * writing a chain here is what lights those up there.
 */

import { describe, it, expect, beforeAll } from "vitest"
import { eq } from "drizzle-orm"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import {
	namespaceView,
	writeOption,
	OptionNotWritableError,
	type ConfigOption
} from "$lib/server/pipelines/config/panel"
import { RESPOND_SPEC_ID } from "$lib/server/pipelines/boot/bootstrap"
import {
	createScript,
	deleteScript,
	scriptsView,
	ScriptNotUsableError
} from "$lib/server/pipelines/entities/scripts"
import * as schema from "$lib/server/db/schema"

const SECRET = "test-instance-secret"

let db: TestDb
let adminId: number

const admin = () => ({ userId: adminId, isAdmin: true })

/** The chain option on the write consumer — the step whose hook accepts text. */
async function writeHookOption(): Promise<ConfigOption> {
	const view = await namespaceView(
		db as any,
		SECRET,
		RESPOND_SPEC_ID,
		admin()
	)
	const all = view!.steps.flatMap((s) => [...s.options, ...s.advanced])
	const chains = all.filter((o) => o.control === "scripts-chain")
	expect(chains.length).toBeGreaterThan(0)
	// The respond spec declares hooks on several steps; the write consumer's is
	// the one whose choices can include a text transform.
	return chains[chains.length - 1]!
}

beforeAll(async () => {
	db = await createTestDb()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(db as any)
	const [adminRow] = await db
		.insert(schema.users)
		.values({ username: "scripts-chain-admin", isAdmin: true })
		.returning()
	adminId = adminRow.id

	// A global write lands in the selected configuration (the layers as
	// simplified 2026-08-24), and the shipped default is immutable — so the
	// chain writes below need a mutable one selected, exactly as an admin
	// attaching a chain on a real install would duplicate first.
	const { resolveSelectedConfig, duplicateConfig, selectConfig } =
		await import("$lib/server/pipelines/config/named")
	const [spec] = await db
		.select()
		.from(schema.pipelineSpecs)
		.where(eq(schema.pipelineSpecs.slug, RESPOND_SPEC_ID))
	const shipped = await resolveSelectedConfig(
		db as any,
		spec.id,
		RESPOND_SPEC_ID,
		{}
	)
	const copy = await duplicateConfig(
		db as any,
		shipped!.configId,
		"Chain host"
	)
	await selectConfig(db as any, spec.id, "instance", 0, copy.id, adminId)
}, 60_000)

describe("the hook in the panel", () => {
	it("renders as one whole-chain option, admin-side, empty until configured", async () => {
		const option = await writeHookOption()
		expect(option.writable).toBe(true)
		expect(option.scripts ?? []).toEqual([])
		// A non-admin sees prompts and nothing else (§26a) — no chain options.
		const view = await namespaceView(db as any, SECRET, RESPOND_SPEC_ID, {
			userId: adminId + 1,
			isAdmin: false
		})
		const userControls = view!.steps
			.flatMap((s) => [...s.options, ...s.advanced])
			.filter((o) => o.control === "scripts-chain")
		expect(userControls).toEqual([])
	})

	it("offers only scripts of the accepted types", async () => {
		const fits = await createScript(db as any, {
			typeId: "core:script:text/transform@1",
			name: "Slop killer"
		})
		const doesNot = await createScript(db as any, {
			typeId: "core:script:candidates/filter@1",
			name: "Meta excluder"
		})

		const option = await writeHookOption()
		const offered = (option.choices ?? []).map((c) => c.id)
		expect(offered).toContain(fits.id)
		expect(offered).not.toContain(doesNot.id)
	})

	it("stores the ordered list, hydrates it back, and lights up usedBy", async () => {
		const view = await scriptsView(db as any)
		const slop = view.scripts.find((s) => s.name === "Slop killer")!
		const guard = await createScript(db as any, {
			typeId: "core:script:text/stop@1",
			name: "ChatML guard"
		})

		const option = await writeHookOption()
		await writeOption(
			db as any,
			SECRET,
			RESPOND_SPEC_ID,
			admin(),
			option.id,
			[guard.id, slop.id]
		)

		const after = await writeHookOption()
		expect((after.scripts ?? []).map((s) => s.id)).toEqual([
			guard.id,
			slop.id
		])
		expect(after.scripts![0]!.blastRadius.length).toBeGreaterThan(0)

		// The scripts page now knows: the chain is the reference (18 §2), so
		// the row refuses deletion and names the pipeline holding it.
		const held = await scriptsView(db as any)
		expect(
			held.scripts.find((s) => s.id === slop.id)!.usedBy.length
		).toBeGreaterThan(0)
		await expect(deleteScript(db as any, slop.id)).rejects.toThrow(
			ScriptNotUsableError
		)
	})

	it("refuses an ill-typed link at attach, not at run time", async () => {
		const view = await scriptsView(db as any)
		const wrongKind = view.scripts.find((s) => s.name === "Meta excluder")!
		const option = await writeHookOption()
		await expect(
			writeOption(
				db as any,
				SECRET,
				RESPOND_SPEC_ID,
				admin(),
				option.id,
				[wrongKind.id]
			)
		).rejects.toThrow(OptionNotWritableError)
	})

	it("shows the connection's stop guards beside the chain — the effective view (18 §4c)", async () => {
		const [conn] = await (db as any)
			.insert(schema.connections)
			.values({ name: "Panel Kobold", type: "koboldcpp" })
			.returning()
		// The instance's chat default, which since 0181 is a
		// `connection_defaults` row keyed by capability rather than
		// `system_settings.default_connection_id`. `connectionStopsFor` reads it
		// through the same resolver dispatch uses, so the guards shown here are
		// the guards the run will apply.
		//
		// ⚠ This block was `(db as any).insert(systemSettings).values({
		// defaultConnectionId })` and the cast is why svelte-check did not
		// enumerate it with the other 69 sites — it would have compiled cleanly
		// and failed at runtime on a column that no longer exists.
		const { setCapabilityDefault } = await import(
			"$lib/server/connections/capabilityDefaults"
		)
		await setCapabilityDefault(db as any, "text->text", {
			connectionId: conn.id
		})
		const guard = await createScript(db as any, {
			typeId: "core:script:text/stop@1",
			name: "Panel guard"
		})
		const { attachConnectionScript } = await import(
			"$lib/server/pipelines/entities/scripts"
		)
		await attachConnectionScript(db as any, conn.id, guard.id)

		const option = await writeHookOption()
		expect(option.connectionScripts).toMatchObject({
			connectionName: "Panel Kobold",
			entries: [{ id: guard.id, name: "Panel guard", enabled: true }]
		})

		// The rank hook accepts no stop scripts, so it shows no connection
		// guards — the effective view only merges where the union is real.
		const view = await namespaceView(
			db as any,
			SECRET,
			RESPOND_SPEC_ID,
			admin()
		)
		const rankChain = view!.steps
			.flatMap((s) => [...s.options, ...s.advanced])
			.filter((o) => o.control === "scripts-chain")[0]!
		expect(rankChain.connectionScripts).toBeUndefined()
	})

	it("refuses a chain that is not an ordered id list, and a dangling id", async () => {
		const option = await writeHookOption()
		await expect(
			writeOption(
				db as any,
				SECRET,
				RESPOND_SPEC_ID,
				admin(),
				option.id,
				["not-an-id"]
			)
		).rejects.toThrow(OptionNotWritableError)
		await expect(
			writeOption(
				db as any,
				SECRET,
				RESPOND_SPEC_ID,
				admin(),
				option.id,
				[999_999]
			)
		).rejects.toThrow(OptionNotWritableError)
	})
})
