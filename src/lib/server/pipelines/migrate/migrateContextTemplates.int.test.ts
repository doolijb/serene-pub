/**
 * The upgrade path off `context_configs`.
 *
 * Two things have to survive it: the template each scope had selected, and the
 * prompt that template produced. The first is a copy and a re-selection; the
 * second is subtler, because 0.6 moved the headings and fences into the
 * variable layouts and a template somebody wrote still contains its own. So a
 * scope carried across onto a hand-written template is also pinned to the bare
 * layouts, or the wrapper is written twice.
 *
 * Most of what is asserted here is about *which scope* gets which answer,
 * because that is the part with a wrong answer that still looks right: an
 * instance-wide pin is correct for an admin on a hand-written template and
 * wrong for the user on core's who would inherit it.
 */

import { describe, it, expect } from "vitest"
import { and, eq } from "drizzle-orm"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { migrateContextTemplates } from "$lib/server/pipelines/migrate/migrateContextTemplates"
import {
	SHIPPED_VARIABLE_TEMPLATES,
	renderVariable,
	seedKeyFor
} from "$lib/server/pipelines/entities/variableLayouts"
import { CONTEXT_TEMPLATE_SEED_KEY } from "$lib/server/pipelines/entities/contextTemplateDefaults"
import { buildWorld } from "$lib/server/pipelines/config/world"
import { resolveConfig } from "@serene-pub/sdk"
import { RESPOND_SPEC_ID } from "$lib/server/pipelines/boot/bootstrap"

/** A template of somebody's own — what matters is that it is not core's. */
const MINE =
	"Assistant Characters (AI-controlled):\n```json\n{{{characters}}}\n```\n" +
	"{{#each sessionMessages}}{{this.message}}{{/each}}"

interface Install {
	db: TestDb
	userId: number
	coreId: number
	mineId: number
}

/**
 * An instance at the moment 0.6 boots against it.
 *
 * `contextConfigs` is seeded here rather than by `sync()` because the seed key
 * is the whole test: `context-default` is how the migration recognises the row
 * core used to keep up to date, and every other row is somebody's.
 */
async function install(opts: {
	instance: "core" | "mine"
	user?: "core" | "mine"
	/** A second row with the same name, to reach the de-duplication. */
	duplicateName?: boolean
}): Promise<Install> {
	const db = await createTestDb()

	const [core] = await db
		.insert(schema.contextConfigs)
		.values({
			seedKey: "context-default",
			name: "Default",
			isImmutable: true,
			template: "{{{characters}}}"
		})
		.returning()
	const [mine] = await db
		.insert(schema.contextConfigs)
		.values({
			name: opts.duplicateName ? "Default" : "Mine",
			template: MINE
		})
		.returning()

	const pick = (which: "core" | "mine") =>
		which === "core" ? core.id : mine.id

	await db.insert(schema.systemSettings).values({
		id: 1,
		defaultContextConfigId: pick(opts.instance)
	})

	const [user] = await db
		.insert(schema.users)
		.values({ username: "reader" })
		.returning()
	await db.insert(schema.userSettings).values({
		userId: user.id,
		// Null when the fixture says nothing — the common case, and the one
		// where inheriting the instance's answer has to be right.
		activeContextConfigId: opts.user ? pick(opts.user) : null
	})

	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(db as any)

	return { db, userId: user.id, coreId: core.id, mineId: mine.id }
}

/**
 * Every pin the migration could have written, as `scope → what it points at`.
 *
 * Since the layer simplification (2026-08-24) the instance's pins live in the
 * instance's selected *config*, not in override rows — so this reads each
 * spec's selected mutable config and reports where its values differ from the
 * shipped default's. The shape stays the old helper's, so the assertions read
 * unchanged; the user layer no longer exists, so only `instance:0` can appear.
 */
async function overrides(db: TestDb) {
	const layouts = await db.select().from(schema.pipelineVariableTemplates)
	const templates = await db.select().from(schema.pipelineContextTemplates)
	const layoutById = new Map(layouts.map((t) => [t.id, t]))
	const templateById = new Map(templates.map((t) => [t.id, t]))

	const { resolveSelectedConfig } = await import(
		"$lib/server/pipelines/config/named"
	)
	const specs = await db.select().from(schema.pipelineSpecs)
	const configs = await db.select().from(schema.pipelineConfigs)
	const out: Array<{
		scope: string
		slot: string
		path: string
		name: string
	}> = []
	for (const spec of specs as any[]) {
		const selected = await resolveSelectedConfig(
			db as any,
			spec.id,
			spec.slug,
			{}
		)
		if (!selected) continue
		const cfg = (configs as any[]).find((c) => c.id === selected.configId)
		// The shipped default is the untouched state; only a mutable
		// selection is something the migration produced or adopted.
		if (!cfg || cfg.isImmutable) continue
		const shipped = (configs as any[]).find(
			(c) => c.specId === spec.id && c.isImmutable
		)
		const values = await db
			.select()
			.from(schema.pipelineConfigValues)
			.where(eq(schema.pipelineConfigValues.configId, selected.configId))
		const shippedVals = new Map(
			shipped
				? (
						(await db
							.select()
							.from(schema.pipelineConfigValues)
							.where(
								eq(
									schema.pipelineConfigValues.configId,
									shipped.id
								)
							)) as any[]
					).map((v) => [
						`${v.nodeKey}\0${v.slot}\0${v.path}`,
						v.value
					])
				: []
		)
		for (const r of values as any[]) {
			if (r.slot !== "variables" && r.slot !== "template") continue
			if (
				shippedVals.get(`${r.nodeKey}\0${r.slot}\0${r.path}`) ===
				r.value
			)
				continue
			out.push({
				scope: "instance:0",
				slot: r.slot,
				path: r.path,
				name:
					(r.slot === "template"
						? templateById.get(r.value as number)?.name
						: layoutById.get(r.value as number)?.name) ??
					"(missing)"
			})
		}
	}
	return out
}

const scopesIn = (p: Awaited<ReturnType<typeof overrides>>) =>
	[...new Set(p.map((x) => x.scope))].sort()

describe("an install already on core's context config", () => {
	it("copies nothing and pins nothing", async () => {
		const { db } = await install({ instance: "core" })
		const [settings] = await db.select().from(schema.systemSettings)
		const copies = await db.select().from(schema.pipelineContextTemplates)

		expect(await overrides(db)).toEqual([])
		// Only the seeded row: core's legacy config maps onto core's *new*
		// template rather than becoming a second copy of it.
		expect(copies.map((c) => c.seedKey)).toEqual([
			CONTEXT_TEMPLATE_SEED_KEY
		])
		expect(settings.contextTemplatesMigrated).toBe(true)
	})
})

describe("an install on a context config of its own", () => {
	it("copies it across and selects the copy at instance scope", async () => {
		const { db, mineId } = await install({ instance: "mine" })

		const [copy] = await db
			.select()
			.from(schema.pipelineContextTemplates)
			.where(
				eq(
					schema.pipelineContextTemplates.migratedFromContextConfigId,
					mineId
				)
			)
		expect(copy).toBeTruthy()
		// Byte for byte. Nothing rewrites a template somebody authored — the
		// layouts move instead, which is what the next test is about.
		expect(copy.source).toBe(MINE)
		expect(copy.isImmutable).toBe(false)
		// Belongs to no pipeline: it predates the idea, so it sorts into the
		// picker's third group rather than claiming a panel it never knew.
		expect(copy.createdForSpecId).toBeNull()

		const o = await overrides(db)
		expect(scopesIn(o)).toEqual(["instance:0"])
		expect(
			o.find((x) => x.slot === "template")?.name,
			"the copy is what the instance now renders"
		).toBe(copy.name)
	})

	it("pins the layouts bare, so its headings are written once", async () => {
		const { db } = await install({ instance: "mine" })
		const o = (await overrides(db)).filter((x) => x.slot === "variables")

		// The *content* variants, whatever each variable calls its own —
		// `currentDate`'s is "Numeric" because it joins three parts rather
		// than writing one. What matters is that none of them is a wrapped
		// variant, since the custom template already carries its headings.
		expect(o.length).toBeGreaterThan(0)
		for (const pin of o)
			expect(
				["JSON", "As written", "Numeric"],
				`${pin.path} was pinned to ${pin.name}`
			).toContain(pin.name)
	})

	it("covers both nodes that declare layouts", async () => {
		const { db } = await install({ instance: "mine" })
		const paths = new Set(
			(await overrides(db))
				.filter((x) => x.slot === "variables")
				.map((x) => x.path)
		)

		// The cast, from the context builder…
		expect(paths.has("characters")).toBe(true)
		// …and the post-budget three, from Assemble. A migration that walked
		// one node would leave world lore double-wrapped and nothing else.
		expect(paths.has("worldLore")).toBe(true)
		expect(paths.has("history")).toBe(true)
	})

	it("renders the value bare, which is the whole point", async () => {
		const { db, userId } = await install({ instance: "mine" })
		const world = await buildWorld(db as any, {
			specId: RESPOND_SPEC_ID
		})
		const layouts = (resolveConfig(world, ["prompt"]).prompt?.variables ??
			{}) as any
		const lore = { "The Ashguard": "Riders who patrol the ash wastes." }

		expect(renderVariable(layouts, "worldLore", lore)).toBe(
			JSON.stringify(lore)
		)
		expect(renderVariable(layouts, "worldLore", lore)).not.toContain(
			"World lore"
		)
	})

	it("gives the copy a free name when the legacy one collides", async () => {
		// Two legacy rows both called "Default" — core's and a clone somebody
		// never renamed. `(node_type_id, name)` is unique, so without a free
		// name the insert throws at boot.
		const { db } = await install({
			instance: "mine",
			duplicateName: true
		})
		const rows = await db.select().from(schema.pipelineContextTemplates)
		const names = rows.map((r) => r.name)

		expect(names).toContain("Default")
		expect(names).toContain("Default (2)")
		expect(new Set(names).size).toBe(names.length)
	})
})

describe("the user layer no longer migrates (ruled 2026-08-24)", () => {
	it("a user's own legacy choice carries nowhere — their levers are the session's", async () => {
		const { db } = await install({
			instance: "core",
			user: "mine"
		})
		// The instance is on core's, so nothing migrates at all: the user's
		// personal pick has no global home any more, and inventing a session
		// decision from a preference is exactly what the ruling forbids.
		expect(await overrides(db)).toEqual([])
	})

	it("the instance's choice migrates alone, whatever users had chosen", async () => {
		const { db } = await install({
			instance: "mine",
			user: "core"
		})
		expect(scopesIn(await overrides(db))).toEqual(["instance:0"])
	})
})

describe("it runs once", () => {
	it("does nothing on a second pass", async () => {
		const { db } = await install({ instance: "mine" })
		const before = await overrides(db)

		const again = await migrateContextTemplates(db as any)

		expect(again.ran).toBe(false)
		expect(again.copied).toBe(0)
		expect(await overrides(db)).toEqual(before)
	})

	it("copies nothing twice even with the ledger rewound", async () => {
		// The copy half is idempotent on its own, through
		// `migrated_from_context_config_id`, so a ledger that was somehow
		// cleared cannot produce a second copy of everyone's template.
		const { db } = await install({ instance: "mine" })
		const before = await db.select().from(schema.pipelineContextTemplates)

		await db
			.update(schema.systemSettings)
			.set({ contextTemplatesMigrated: false })
			.where(eq(schema.systemSettings.id, 1))
		const again = await migrateContextTemplates(db as any)

		expect(again.copied).toBe(0)
		expect(
			(await db.select().from(schema.pipelineContextTemplates)).length
		).toBe(before.length)
	})

	it("does not write over a choice somebody made", async () => {
		const { db } = await install({ instance: "core" })
		const [spec] = await db
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, RESPOND_SPEC_ID))
			.limit(1)

		// Somebody already runs the instance on a config of their own, with
		// the characters layout deliberately on the titled row.
		const titled = SHIPPED_VARIABLE_TEMPLATES.find(
			(t) => t.key === "characters" && t.isDefault
		)!
		const [row] = await db
			.select()
			.from(schema.pipelineVariableTemplates)
			.where(
				eq(schema.pipelineVariableTemplates.seedKey, seedKeyFor(titled))
			)
			.limit(1)
		const { createConfig, selectConfig } = await import(
			"$lib/server/pipelines/config/named"
		)
		const own = await createConfig(db as any, spec.id, "Somebody's own")
		await db.insert(schema.pipelineConfigValues).values({
			configId: own.id,
			nodeKey: "context",
			slot: "variables",
			path: "characters",
			value: row.id
		})
		await selectConfig(db as any, spec.id, "instance", 0, own.id)

		// Rewind the ledger and move the instance onto a custom config, which
		// is the only way to reach the branch that declines.
		await db
			.update(schema.systemSettings)
			.set({
				contextTemplatesMigrated: false,
				defaultContextConfigId: (
					await db
						.select()
						.from(schema.contextConfigs)
						.where(eq(schema.contextConfigs.name, "Mine"))
						.limit(1)
				)[0]!.id
			})
			.where(eq(schema.systemSettings.id, 1))

		await migrateContextTemplates(db as any)

		const [kept] = await db
			.select()
			.from(schema.pipelineConfigValues)
			.where(
				and(
					eq(schema.pipelineConfigValues.configId, own.id),
					eq(schema.pipelineConfigValues.nodeKey, "context"),
					eq(schema.pipelineConfigValues.path, "characters")
				)
			)
			.limit(1)
		expect(kept.value).toBe(row.id)
	})
})
