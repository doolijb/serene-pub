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
	"{{#each chatMessages}}{{this.message}}{{/each}}"

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

	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(db as any)

	return { db, userId: user.id, coreId: core.id, mineId: mine.id }
}

/** Every override the migration could have written, as `scope → what it points at`. */
async function overrides(db: TestDb) {
	const rows = await db.select().from(schema.pipelineNodeOverrides)
	const layouts = await db.select().from(schema.pipelineVariableTemplates)
	const templates = await db.select().from(schema.pipelineContextTemplates)
	const layoutById = new Map(layouts.map((t) => [t.id, t]))
	const templateById = new Map(templates.map((t) => [t.id, t]))

	return rows
		.filter((r) => r.slot === "variables" || r.slot === "template")
		.map((r) => ({
			scope: `${r.scopeKind}:${r.scopeId}`,
			slot: r.slot,
			path: r.path,
			name:
				(r.slot === "template"
					? templateById.get(r.value as number)?.name
					: layoutById.get(r.value as number)?.name) ?? "(missing)"
		}))
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
			userId,
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

describe("scopes are decided one at a time", () => {
	it("writes only the user when theirs is the custom one", async () => {
		const { db, userId } = await install({
			instance: "core",
			user: "mine"
		})
		const o = await overrides(db)

		expect(scopesIn(o)).toEqual([`user:${userId}`])
		for (const pin of o.filter((x) => x.slot === "variables"))
			expect(["JSON", "As written", "Numeric"]).toContain(pin.name)
	})

	it("writes a user back to core's when the instance is the custom one", async () => {
		// The case a single instance-wide answer gets wrong. This user renders
		// through core's template, which has no headings of its own —
		// inheriting the instance's bare pin would strip every heading from
		// their prompts, silently, on upgrade.
		const { db, userId } = await install({
			instance: "mine",
			user: "core"
		})
		const o = await overrides(db)

		expect(scopesIn(o)).toEqual(["instance:0", `user:${userId}`])
		expect(
			o.find(
				(x) => x.scope === `user:${userId}` && x.path === "characters"
			)?.name
		).toBe("Titled JSON block")
		expect(
			o.find((x) => x.scope === `user:${userId}` && x.slot === "template")
				?.name
		).toBe("Default")
	})

	it("leaves a user who chose nothing to inherit", async () => {
		const { db, userId } = await install({ instance: "mine" })
		// Their `activeContextConfigId` is null, so they render through the
		// instance's template and the instance's answer is already theirs.
		// Writing them one anyway would pin them forever to a choice they
		// never made.
		expect(
			(await overrides(db)).some((x) => x.scope === `user:${userId}`)
		).toBe(false)
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

		// Somebody deliberately on the titled row, at instance scope.
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

		await db.insert(schema.pipelineNodeOverrides).values({
			specId: spec.id,
			scopeKind: "instance",
			scopeId: 0,
			nodeKey: "context",
			slot: "variables",
			path: "characters",
			value: row.id
		})
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
			.from(schema.pipelineNodeOverrides)
			.where(
				and(
					eq(schema.pipelineNodeOverrides.specId, spec.id),
					eq(schema.pipelineNodeOverrides.scopeKind, "instance"),
					eq(schema.pipelineNodeOverrides.nodeKey, "context"),
					eq(schema.pipelineNodeOverrides.path, "characters")
				)
			)
			.limit(1)
		expect(kept.value).toBe(row.id)
	})
})
