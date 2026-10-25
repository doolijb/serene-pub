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
import { STORY_RESPOND_SPEC_ID } from "$lib/server/pipelines/boot/bootstrap"
import {
	createScript,
	deleteScript,
	scriptsView,
	ScriptNotUsableError
} from "$lib/server/pipelines/entities/scripts"
import * as schema from "$lib/server/db/schema"
import { groupOptions } from "$lib/server/pipelines/config/panel/groups"
import { seamDecls } from "$lib/server/pipelines/config/panel/declarations"

const SECRET = "test-instance-secret"

let db: TestDb
let adminId: number

const admin = () => ({ userId: adminId, isAdmin: true })

/** The chain option on the write consumer — the step whose hook accepts text. */
async function writeHookOption(): Promise<ConfigOption> {
	const view = await namespaceView(
		db,
		SECRET,
		STORY_RESPOND_SPEC_ID,
		admin()
	)
	const all = groupOptions(view!.groups)
	const chains = all.filter((o) => o.control === "scripts-chain")
	expect(chains.length).toBeGreaterThan(0)
	// The respond spec declares hooks on several steps; the write consumer's is
	// the first before a text port — the step that saves the reply. (Story's
	// reply runs more calls after it, 2026-10-19, each with chains of its own,
	// so it is no longer the last.)
	const write = chains.find((o) => o.at === "in:text")
	expect(write, "no chain before the reply's text").toBeTruthy()
	return write!
}

beforeAll(async () => {
	db = await createTestDb()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(db)
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
		.where(eq(schema.pipelineSpecs.slug, STORY_RESPOND_SPEC_ID))
	const shipped = await resolveSelectedConfig(
		db,
		spec.id,
		STORY_RESPOND_SPEC_ID,
		{}
	)
	const copy = await duplicateConfig(
		db,
		shipped!.configId,
		"Chain host"
	)
	await selectConfig(db, spec.id, "pub", 0, copy.id, adminId)
}, 60_000)

describe("the hook in the panel", () => {
	it("renders as one whole-chain option, admin-side, empty until configured", async () => {
		const option = await writeHookOption()
		expect(option.writable).toBe(true)
		expect(option.scripts ?? []).toEqual([])
		// A non-admin sees prompts and nothing else (§26a) — no chain options.
		const view = await namespaceView(db, SECRET, STORY_RESPOND_SPEC_ID, {
			userId: adminId + 1,
			isAdmin: false
		})
		const userControls = groupOptions(view!.groups)
			.filter((o) => o.control === "scripts-chain")
		expect(userControls).toEqual([])
	})

	it("offers only scripts of the accepted types", async () => {
		const fits = await createScript(db, {
			typeId: "core:script:text/transform@1",
			name: "Slop killer"
		})
		const doesNot = await createScript(db, {
			typeId: "core:script:candidates/filter@1",
			name: "Meta excluder"
		})

		const option = await writeHookOption()
		const offered = (option.choices ?? []).map((c) => c.id)
		expect(offered).toContain(fits.id)
		expect(offered).not.toContain(doesNot.id)
	})

	it("stores the ordered list, hydrates it back, and lights up usedBy", async () => {
		const view = await scriptsView(db)
		const slop = view.scripts.find((s) => s.name === "Slop killer")!
		const guard = await createScript(db, {
			typeId: "core:script:text/stop@1",
			name: "ChatML guard"
		})

		const option = await writeHookOption()
		await writeOption(
			db,
			SECRET,
			STORY_RESPOND_SPEC_ID,
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
		const held = await scriptsView(db)
		expect(
			held.scripts.find((s) => s.id === slop.id)!.usedBy.length
		).toBeGreaterThan(0)
		await expect(deleteScript(db, slop.id)).rejects.toThrow(
			ScriptNotUsableError
		)
	})

	it("refuses an ill-typed link at attach, not at run time", async () => {
		const view = await scriptsView(db)
		const wrongKind = view.scripts.find((s) => s.name === "Meta excluder")!
		const option = await writeHookOption()
		await expect(
			writeOption(
				db,
				SECRET,
				STORY_RESPOND_SPEC_ID,
				admin(),
				option.id,
				[wrongKind.id]
			)
		).rejects.toThrow(OptionNotWritableError)
	})

	it("shows the connection's stop guards beside the chain — the effective view (18 §4c)", async () => {
		const [conn] = await (db)
			.insert(schema.connections)
			.values({ name: "Panel Kobold", type: "koboldcpp" })
			.returning()
		// The instance's chat default, which since 0181 is a
		// `connection_defaults` row keyed by capability rather than
		// `system_settings.default_connection_id`. `connectionStopsFor` reads it
		// through the same resolver dispatch uses, so the guards shown here are
		// the guards the run will apply.
		//
		// ⚠ This block was `(db).insert(systemSettings).values({
		// defaultConnectionId })` and the cast is why svelte-check did not
		// enumerate it with the other 69 sites — it would have compiled cleanly
		// and failed at runtime on a column that no longer exists.
		const { ensureConnectionModel } = await import(
			"$lib/server/connections/models"
		)
		// The MODEL half: a registration names a pair, and an endpoint on its
		// own resolves as unconfigured — so the panel would show no guards at
		// all rather than the connection's.
		const model = await ensureConnectionModel(db, conn.id, "panel-7b")
		const { setCapabilityDefault } = await import(
			"$lib/server/connections/capabilityDefaults"
		)
		await setCapabilityDefault(db, "text->text", {
			connectionId: conn.id,
			connectionModelId: model!.id
		})
		const guard = await createScript(db, {
			typeId: "core:script:text/stop@1",
			name: "Panel guard"
		})
		const { attachConnectionScript } = await import(
			"$lib/server/pipelines/entities/scripts"
		)
		await attachConnectionScript(db, conn.id, guard.id)

		const option = await writeHookOption()
		expect(option.connectionScripts).toMatchObject({
			connectionName: "Panel Kobold",
			entries: [{ id: guard.id, name: "Panel guard", enabled: true }]
		})

		// The rank hook accepts no stop scripts, so it shows no connection
		// guards — the effective view only merges where the union is real.
		const view = await namespaceView(
			db,
			SECRET,
			STORY_RESPOND_SPEC_ID,
			admin()
		)
		const rankChain = groupOptions(view!.groups)
			.filter((o) => o.control === "scripts-chain")[0]!
		expect(rankChain.connectionScripts).toBeUndefined()
	})

	it("refuses a chain that is not an ordered id list, and a dangling id", async () => {
		const option = await writeHookOption()
		await expect(
			writeOption(
				db,
				SECRET,
				STORY_RESPOND_SPEC_ID,
				admin(),
				option.id,
				["not-an-id"]
			)
		).rejects.toThrow(OptionNotWritableError)
		await expect(
			writeOption(
				db,
				SECRET,
				STORY_RESPOND_SPEC_ID,
				admin(),
				option.id,
				[999_999]
			)
		).rejects.toThrow(OptionNotWritableError)
	})
})

describe("where a chain runs (PLAN-script-placement D3)", () => {
	it("labels each chain by its seam, carries the address, and names what can go there", async () => {
		const view = await namespaceView(db, SECRET, STORY_RESPOND_SPEC_ID, admin())
		const chains = groupOptions(view!.groups).filter(
			(o) => o.control === "scripts-chain"
		)
		expect(chains.length).toBeGreaterThan(0)
		for (const o of chains) {
			expect(o.label).toMatch(/^Scripts · (before|after|at) \S/)
			expect(typeof o.at).toBe("string")
			expect(o.seamKind).toMatch(/^(in|out|point)$/)
			// Names, never kind ids: the ids stay server-side.
			expect(o.acceptsLabels?.length).toBeGreaterThan(0)
			for (const k of o.acceptsLabels!) expect(k).not.toMatch(/^core:script:/)
			// A port seam says what flows there; a point has no port.
			if (o.seamKind === "point") expect(o.flows).toBeUndefined()
		}
		// The write consumer's hook: before its text port.
		const write = await writeHookOption()
		expect(write.label).toBe("Scripts · before text")
		expect(write.at).toBe("in:text")
		expect(write.flows).toBe("What flows here: text")
		expect(write.acceptsLabels!.length).toBe(2)
	}, 60_000)

	it("emits a definition's seams in run order: in, then points, then out", () => {
		const decls = seamDecls(
			"step",
			{
				kind: "task",
				// Declared out-first on purpose: the order is run order, not
				// declaration order across phases.
				slots: {
					afterScripts: {
						kind: "scripts",
						accepts: ["core:script:cast/transform@1"],
						port: "cast",
						phase: "after",
						description: "Over the extracted cast."
					},
					scripts: {
						kind: "scripts",
						accepts: ["core:script:text/transform@1"],
						port: "content",
						phase: "before"
					}
				},
				scriptPoints: [
					{
						key: "each-draft",
						accepts: ["core:script:text/transform@1"],
						description: "Each draft."
					}
				] as any,
				ports: {
					in: { content: "core:shape/text@1" },
					out: { cast: "core:shape/cast-list@1" }
				}
			},
			"Step",
			"core:task/fixture@1"
		)
		expect(decls.map((d) => [d.at, d.slot, d.path, d.label])).toEqual([
			["in:content", "scripts", "", "Scripts · before content"],
			["each-draft", "scripts", "each-draft", "Scripts · at each draft"],
			["out:cast", "afterScripts", "", "Scripts · after cast"]
		])
		expect(decls.map((d) => d.flows)).toEqual([
			"What flows here: text",
			undefined,
			"What flows here: cast list"
		])
		expect(decls[2]!.description).toBe("Over the extracted cast.")
		expect(decls[1]!.description).toBe("Each draft.")
	})

	it("keeps that order in the step's Advanced list", async () => {
		const view = await namespaceView(db, SECRET, STORY_RESPOND_SPEC_ID, admin())
		const rank = { in: 0, point: 1, out: 2 } as const
		for (const g of view!.groups)
			for (const step of g.advanced) {
				const kinds = step.options
					.filter((o) => o.control === "scripts-chain" && o.seamKind)
					.map((o) => rank[o.seamKind!])
				expect(kinds).toEqual([...kinds].sort((a, b) => a - b))
			}
	}, 60_000)
})

describe("an unplaced chain in the panel (PLAN-script-placement D4)", () => {
	let nodeKey: string
	let a: { id: number }
	let b: { id: number }

	const unplacedOption = async () => {
		const view = await namespaceView(db, SECRET, STORY_RESPOND_SPEC_ID, admin())
		return groupOptions(view!.groups).find(
			(o) => o.control === "scripts-chain" && o.unplaced
		)
	}

	beforeAll(async () => {
		const [spec] = await db
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, STORY_RESPOND_SPEC_ID))
		const nodes = await db
			.select()
			.from(schema.pipelineNodes)
			.where(eq(schema.pipelineNodes.specVersionId, spec.activeVersionId!))
		nodeKey = (nodes as any[]).find(
			(n) => n.definitionId === "core:outlet/update-message"
		)!.nodeKey
		a = await createScript(db, {
			typeId: "core:script:text/stop@1",
			name: "Stranded A"
		})
		b = await createScript(db, {
			typeId: "core:script:text/transform@1",
			name: "Stranded B"
		})
		// The reply is a registered pipeline (PLAN-layering D5): an instance-wide
		// value lives on the genre's defaults, not in a configuration.
		const { genreValueTargets, setGenreValue } = await import(
			"$lib/server/pipelines/registrations/genreValues"
		)
		await setGenreValue(
			db,
			await genreValueTargets(db, STORY_RESPOND_SPEC_ID),
			{ nodeKey, slot: "scripts", path: "a-point-that-is-gone" },
			[a.id, b.id]
		)
	}, 60_000)

	it("still shows, marked, with its entries and nothing to add", async () => {
		const o = (await unplacedOption())!
		expect(o).toBeTruthy()
		expect(o.label).toBe("Scripts · no longer here (a point that is gone)")
		expect(o.acceptsLabels).toEqual([])
		expect((o.scripts ?? []).map((s) => s.id)).toEqual([a.id, b.id])
		expect(o.choices ?? []).toEqual([])
	}, 60_000)

	it("refuses adding to it", async () => {
		const o = (await unplacedOption())!
		const c = await createScript(db, {
			typeId: "core:script:text/transform@1",
			name: "Never placed"
		})
		await expect(
			writeOption(db, SECRET, STORY_RESPOND_SPEC_ID, admin(), o.id, [
				a.id,
				b.id,
				c.id
			])
		).rejects.toThrow(OptionNotWritableError)
	}, 60_000)

	it("allows removing entries, and clearing it removes the row", async () => {
		const o = (await unplacedOption())!
		await writeOption(db, SECRET, STORY_RESPOND_SPEC_ID, admin(), o.id, [b.id])
		expect(((await unplacedOption())!.scripts ?? []).map((s) => s.id)).toEqual([
			b.id
		])
		await writeOption(db, SECRET, STORY_RESPOND_SPEC_ID, admin(), o.id, [])
		expect(await unplacedOption()).toBeUndefined()
		const { genreStoredValues } = await import(
			"$lib/server/pipelines/registrations/genreValues"
		)
		const left = (await genreStoredValues(db, STORY_RESPOND_SPEC_ID)).filter(
			(r) => r.path === "a-point-that-is-gone"
		)
		expect(left).toEqual([])
	}, 60_000)
})
