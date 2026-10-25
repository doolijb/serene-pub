/**
 * **A config row exists only where somebody departed from the shipped default**
 * (ruled 2026-09-10).
 *
 * The model this replaces materialized every declared value into every config
 * at seed time, which made three things true at once and all three wrong:
 *
 *  1. **Provenance was unknowable.** A row said nothing about whether a person
 *     had chosen the number in it or whether `ensureDefaultConfig` had written
 *     it on the install's first boot. There is no provenance column and adding
 *     one would only record what the row's *existence* can say for itself.
 *  2. **Moving a declared default reached nobody.** Every config already held a
 *     copy of the old one, so a corrected default was a value in the code that
 *     no install resolved — which is why `0102`, `0110` and `0111` each end
 *     with a hand-written sweep of `pipeline_config_values`.
 *  3. **"Back to defaults" had to be a write.** `clearOption` has deleted since
 *     F20; seeding was the half that kept re-materializing what it deleted.
 *
 * So: the declaration is the value, a row is a deviation from it, and the four
 * claims below are what that has to mean end to end.
 *
 * ## What is deliberately NOT swept
 *
 * A reference slot — `prompts`, `template`, `variables`, `connection`,
 * `sampling` — declares no author default at all (`declsForSlot` emits none for
 * any `*-ref` control), so there is nothing for its row to be equal to and
 * nothing to inherit if it went. Those rows stay, and the last claim pins it:
 * a sweep that keyed on "is this value interesting" rather than on "is there a
 * declared default to fall back to" would empty every prompt and template pick
 * on the install and the panel would open with nothing selected.
 */

import { describe, it, expect, beforeAll } from "vitest"
import { and, eq } from "drizzle-orm"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import {
	bootstrapPipelines,
	STORY_RESPOND_SPEC_ID
} from "$lib/server/pipelines/boot/bootstrap"
import { reconcileConfigs } from "$lib/server/pipelines/config/named"
import { buildWorld } from "$lib/server/pipelines/config/world"
import { resolveConfigSources } from "@serene-pub/sdk"
import {
	namespaceView,
	optionId,
	writeOption
} from "$lib/server/pipelines/config/panel"
import { groupOptions } from "$lib/server/pipelines/config/panel/groups"

const SECRET = "deviation-test-secret"

/**
 * The address the whole file works against.
 *
 * `respond`'s history node wires `params: slot.params()` (migration 0110), so
 * `limit` is a declared integer with a default that a run actually reads — the
 * one shape where "the row is gone and the value still arrives" is checkable
 * rather than asserted about an inert control.
 */
const NODE = "gather.history.read"
const SLOT = "params"
const PATH = "limit"
/** What `core:query/session-history@1` declares today. */
const DECLARED = 100
/** What the test moves it to, standing in for a re-projected declaration. */
const MOVED_TO = 55

let db: TestDb
let specId: number
let specVersionId: number
let adminId: number

beforeAll(async () => {
	db = await createTestDb()
	await bootstrapPipelines(db)

	const [spec] = await db
		.select()
		.from(schema.pipelineSpecs)
		.where(eq(schema.pipelineSpecs.slug, STORY_RESPOND_SPEC_ID))
	specId = spec.id
	specVersionId = spec.activeVersionId!

	const [admin] = await db
		.insert(schema.users)
		.values({ username: "deviation-admin", isAdmin: true })
		.returning()
	adminId = admin.id
}, 60_000)

const shippedConfig = async () => {
	const [row] = await db
		.select()
		.from(schema.pipelineConfigs)
		.where(
			eq(
				schema.pipelineConfigs.seedKey,
				`pipeline-default:${STORY_RESPOND_SPEC_ID}`
			)
		)
	return row
}

const rowAt = async (configId: number, path = PATH) => {
	const [row] = await db
		.select()
		.from(schema.pipelineConfigValues)
		.where(
			and(
				eq(schema.pipelineConfigValues.configId, configId),
				eq(schema.pipelineConfigValues.nodeKey, NODE),
				eq(schema.pipelineConfigValues.slot, SLOT),
				eq(schema.pipelineConfigValues.path, path)
			)
		)
	return row
}

/**
 * 🚧 An administrator's change to the genre's defaults for the reply (R38,
 * A15) — what an instance-wide edit is since configurations retired — and
 * the value it holds at the file's address.
 */
const genreTargets = async () => {
	const { genreValueTargets } = await import("$lib/server/pipelines/registrations/genreValues")
	return genreValueTargets(db as any, STORY_RESPOND_SPEC_ID)
}
const genreValueAt = async (path = PATH) => {
	const { genreChangeKey } = await import("$lib/server/pipelines/registrations/rows")
	const [t] = await genreTargets()
	const [row] = await db
		.select()
		.from(schema.registrations)
		.where(
			and(
				eq(schema.registrations.scopeKind, "genre"),
				eq(schema.registrations.scopeRef, t!.genreId),
				eq(schema.registrations.key, genreChangeKey(t!.key))
			)
		)
	const slot = (row?.values as any)?.[NODE]?.[SLOT]
	return slot && typeof slot === "object" ? slot[path] : undefined
}

/**
 * What a run would resolve, through the path a run takes.
 *
 * `buildWorld` then `resolveConfigSources` — the executor's own two calls, not
 * a re-derivation of them. A panel-only assertion could not tell an inherited
 * default from a control the executor never reads.
 */
const resolvedLimit = async (sessionId?: number) => {
	const world = await buildWorld(db, { specId: STORY_RESPOND_SPEC_ID, sessionId })
	const sources: any = resolveConfigSources(world as any, [NODE])
	return sources?.[NODE]?.[SLOT]?.[PATH]
}

/**
 * Re-declare `limit`'s default, the way a re-projection would.
 *
 * `declarations()` reads `pipeline_definition_registry.slots` and nothing else, so
 * rewriting the projected row IS what a migration that deletes the row and lets
 * boot re-project it produces — without needing a second build of the app in
 * the middle of a test.
 */
const redeclareDefault = async (value: number) => {
	const [row] = await db
		.select()
		.from(schema.pipelineDefinitionRegistry)
		.where(
			and(
				eq(
					schema.pipelineDefinitionRegistry.definitionId,
					"core:query/session-history"
				),
				eq(schema.pipelineDefinitionRegistry.version, 1)
			)
		)
	expect(row, "the history node's type is not projected").toBeTruthy()
	const slots = JSON.parse(JSON.stringify(row.slots)) as any
	expect(
		slots?.params?.schema?.limit?.default,
		"the declaration this file rewrites has moved"
	).toBeDefined()
	slots.params.schema.limit.default = value
	await db
		.update(schema.pipelineDefinitionRegistry)
		.set({ slots })
		.where(eq(schema.pipelineDefinitionRegistry.id, row.id))
}

describe("seeding writes deviations, not values", () => {
	it("leaves no row where the shipped value IS the declared default", async () => {
		expect(
			await rowAt((await shippedConfig()).id),
			`the shipped config materialized ${NODE}/${SLOT}/${PATH} at its own ` +
				`declared default. A row there is indistinguishable from one a ` +
				`person set, and it shadows every future correction of the number.`
		).toBeUndefined()
	})

	it("still points every reference slot at a row", async () => {
		// The other half, and the one a careless sweep breaks: a `*-ref`
		// declares no author default, so its row is the only record of what is
		// selected. Emptied, the panel opens with nothing chosen above output
		// that plainly has a prompt.
		const refs = (
			await db
				.select()
				.from(schema.pipelineConfigValues)
				.where(
					eq(
						schema.pipelineConfigValues.configId,
						(await shippedConfig()).id
					)
				)
		).filter((v: any) => v.slot === "prompts" || v.slot === "template")
		expect(refs.length).toBeGreaterThan(0)
	})
})

describe("a config with no row resolves the CURRENT declaration", () => {
	it("resolves the declared default through the run's own resolver", async () => {
		expect(await resolvedLimit()).toEqual({
			value: DECLARED,
			scopeKind: "author"
		})
	})

	it("follows the declaration when it moves", async () => {
		await redeclareDefault(MOVED_TO)
		await reconcileConfigs(db, specId, specVersionId, STORY_RESPOND_SPEC_ID)
		expect(
			await resolvedLimit(),
			"an untouched config did not follow a corrected default — which is " +
				"the whole reason a row is a deviation rather than a copy"
		).toEqual({ value: MOVED_TO, scopeKind: "author" })
	})

	it("does not move a change that departed from it", async () => {
		// 🚧 The instance's own value: a change to the genre's defaults (A15).
		const { setGenreValue, resetGenreValues } = await import(
			"$lib/server/pipelines/registrations/genreValues"
		)
		await setGenreValue(db as any, await genreTargets(), { nodeKey: NODE, slot: SLOT, path: PATH }, 42)

		await redeclareDefault(DECLARED)
		await reconcileConfigs(db, specId, specVersionId, STORY_RESPOND_SPEC_ID)

		expect(await genreValueAt(), "a deviation was swept").toBe(42)
		expect(await resolvedLimit()).toEqual({
			value: 42,
			scopeKind: "genre"
		})

		// Back on the declared defaults for the writes below.
		await resetGenreValues(db as any, await genreTargets())
	})
})

describe("writeOption stores a deviation or nothing", () => {
	let handle: string

	beforeAll(async () => {
		handle = optionId(SECRET, NODE, SLOT, PATH)
	})

	const viewer = () => ({ userId: adminId, isAdmin: true })

	it("writes a row for a value that differs", async () => {
		// An administrator's instance-wide edit: the genre's defaults (R38).
		await writeOption(db, SECRET, STORY_RESPOND_SPEC_ID, viewer(), handle, 30)
		expect(await genreValueAt()).toBe(30)
	})

	it("deletes the row when the value returns to the default", async () => {
		await writeOption(db, SECRET, STORY_RESPOND_SPEC_ID, viewer(), handle, DECLARED)
		expect(
			await genreValueAt(),
			`writing the declared default stored a value. It resolves to the same ` +
				`number today and pins the genre's defaults to it forever after.`
		).toBeUndefined()
	})

	it("refuses to edit a named configuration of a pipeline registrations run (R38)", async () => {
		const [config] = await db
			.insert(schema.pipelineConfigs)
			.values({ specId, name: "Write target", isImmutable: false })
			.returning()
		await expect(
			writeOption(db, SECRET, STORY_RESPOND_SPEC_ID, viewer(), handle, 30, config!.id)
		).rejects.toThrow(/configurations are retired/)
		expect(await rowAt(config!.id)).toBeUndefined()
	})
})

describe("the panel says which options were changed", () => {
	it("marks a deviated option and leaves an inherited one unmarked", async () => {
		const { setGenreValue, resetGenreValues } = await import(
			"$lib/server/pipelines/registrations/genreValues"
		)
		await setGenreValue(db as any, await genreTargets(), { nodeKey: NODE, slot: SLOT, path: PATH }, 7)
		try {
			const view = await namespaceView(db, SECRET, STORY_RESPOND_SPEC_ID, {
				userId: adminId,
				isAdmin: true
			})
			const all = groupOptions(view?.groups ?? [])
			const changed = all.find((o) => o.id === optionId(SECRET, NODE, SLOT, PATH))
			expect(changed?.changed, "a deviated option is not marked").toBe(true)
			// Its neighbour on the same slot, which nobody touched.
			const untouched = all.find((o) => o.id === optionId(SECRET, NODE, SLOT, "channel"))
			expect(untouched?.changed, "an inherited option is marked as changed").toBe(false)
		} finally {
			await resetGenreValues(db as any, await genreTargets())
		}
	})

	it("🚧 marks nothing on the shipped Default: its reference rows are the pipeline's own (Q3-6, #50)", async () => {
		const { selectConfig } = await import("$lib/server/pipelines/config/named")
		await selectConfig(db, specId, "pub", 0, (await shippedConfig()).id, adminId)
		const view = await namespaceView(db, SECRET, STORY_RESPOND_SPEC_ID, {
			userId: adminId,
			isAdmin: true
		})
		const all = groupOptions(view?.groups ?? [])
		const refs = all.filter((o) => o.control === "prompts-ref" || o.control === "sampling-ref")
		expect(refs.length, "the respond spec shows no reference options").toBeGreaterThan(0)
		expect(
			all.filter((o) => o.changed).map((o) => o.id),
			"an untouched shipped config marks options Changed"
		).toEqual([])
	})
})

/**
 * "Never set" and "set back to the declared value" are different states
 * wherever the shipped config says something else.
 *
 * The respond preset ships `postHistoryTokenTrigger` at 3000 where the
 * declaration says 0. A copy of the shipped config that has never touched it
 * inherits 3000 through the back-fill; a copy where somebody chose 0 has to
 * keep 0 — through the write, through every boot's reconcile, and through a
 * duplicate. Deviation is measured against what the config would otherwise
 * inherit, not against the bare declaration.
 */
describe("a value equal to the declaration is kept where the shipped config differs", () => {
	const TRIGGER = "postHistoryTokenTrigger"
	const DECLARED_TRIGGER = 0
	const SHIPPED_TRIGGER = 3000
	let node: string

	const triggerAt = async (configId: number) => {
		const [row] = await db
			.select()
			.from(schema.pipelineConfigValues)
			.where(
				and(
					eq(schema.pipelineConfigValues.configId, configId),
					eq(schema.pipelineConfigValues.nodeKey, node),
					eq(schema.pipelineConfigValues.slot, SLOT),
					eq(schema.pipelineConfigValues.path, TRIGGER)
				)
			)
		return row?.value
	}

	beforeAll(async () => {
		const { declarations } = await import(
			"$lib/server/pipelines/config/panel"
		)
		const decl = (await declarations(db, specVersionId)).find(
			(d) => d.slot === SLOT && d.path === TRIGGER
		)
		expect(decl, "respond declares no post-history trigger").toBeTruthy()
		expect(decl!.authorDefault).toBe(DECLARED_TRIGGER)
		node = decl!.nodeKey
		expect(
			await triggerAt((await shippedConfig()).id),
			"the shipped config no longer carries the preset's trigger"
		).toBe(SHIPPED_TRIGGER)
	})

	it("keeps an explicit declared value through the write and a reconcile", async () => {
		// 🚧 An instance-wide edit is a change to the genre's defaults (R38):
		// 0 is a choice there, because the declared defaults ship 3000.
		await writeOption(
			db,
			SECRET,
			STORY_RESPOND_SPEC_ID,
			{ userId: adminId, isAdmin: true },
			optionId(SECRET, node, SLOT, TRIGGER),
			DECLARED_TRIGGER
		)
		const at = async () => {
			const { genreChangeKey } = await import("$lib/server/pipelines/registrations/rows")
			const [t] = await genreTargets()
			const [row] = await db
				.select()
				.from(schema.registrations)
				.where(
					and(
						eq(schema.registrations.scopeKind, "genre"),
						eq(schema.registrations.scopeRef, t!.genreId),
						eq(schema.registrations.key, genreChangeKey(t!.key))
					)
				)
			return (row?.values as any)?.[node]?.[SLOT]?.[TRIGGER]
		}
		expect(
			await at(),
			"writing the declared value dropped it, so the shipped 3000 runs over the person's 0"
		).toBe(DECLARED_TRIGGER)
		await reconcileConfigs(db, specId, specVersionId, STORY_RESPOND_SPEC_ID)
		expect(await at(), "a reconcile replaced an explicit 0").toBe(DECLARED_TRIGGER)
		const { resetGenreValues } = await import("$lib/server/pipelines/registrations/genreValues")
		await resetGenreValues(db as any, await genreTargets())
	})

	it("keeps a stored declared value the reconcile finds already there", async () => {
		const [mine] = await db
			.insert(schema.pipelineConfigs)
			.values({ specId, name: "Stored zero", isImmutable: false })
			.returning()
		await db.insert(schema.pipelineConfigValues).values({
			configId: mine.id,
			nodeKey: node,
			slot: SLOT,
			path: TRIGGER,
			value: DECLARED_TRIGGER
		})
		await reconcileConfigs(db, specId, specVersionId, STORY_RESPOND_SPEC_ID)
		expect(await triggerAt(mine.id)).toBe(DECLARED_TRIGGER)
	})

	it("still back-fills the shipped value into a config that never set it", async () => {
		const [mine] = await db
			.insert(schema.pipelineConfigs)
			.values({ specId, name: "Never set", isImmutable: false })
			.returning()
		await reconcileConfigs(db, specId, specVersionId, STORY_RESPOND_SPEC_ID)
		expect(await triggerAt(mine.id)).toBe(SHIPPED_TRIGGER)
	})
})
