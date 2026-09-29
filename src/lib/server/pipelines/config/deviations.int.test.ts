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
	RESPOND_SPEC_ID
} from "$lib/server/pipelines/boot/bootstrap"
import { reconcileConfigs } from "$lib/server/pipelines/config/named"
import { buildWorld } from "$lib/server/pipelines/config/world"
import { resolveConfigSources } from "@serene-pub/sdk"
import {
	namespaceView,
	optionId,
	writeOption
} from "$lib/server/pipelines/config/panel"

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
		.where(eq(schema.pipelineSpecs.slug, RESPOND_SPEC_ID))
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
				`pipeline-default:${RESPOND_SPEC_ID}`
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
 * What a run would resolve, through the path a run takes.
 *
 * `buildWorld` then `resolveConfigSources` — the executor's own two calls, not
 * a re-derivation of them. A panel-only assertion could not tell an inherited
 * default from a control the executor never reads.
 */
const resolvedLimit = async (sessionId?: number) => {
	const world = await buildWorld(db, { specId: RESPOND_SPEC_ID, sessionId })
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
		await reconcileConfigs(db, specId, specVersionId, RESPOND_SPEC_ID)
		expect(
			await resolvedLimit(),
			"an untouched config did not follow a corrected default — which is " +
				"the whole reason a row is a deviation rather than a copy"
		).toEqual({ value: MOVED_TO, scopeKind: "author" })
	})

	it("does not move a config that departed from it", async () => {
		const [mine] = await db
			.insert(schema.pipelineConfigs)
			.values({ specId, name: "Deviating", isImmutable: false })
			.returning()
		await db.insert(schema.pipelineConfigValues).values({
			configId: mine.id,
			nodeKey: NODE,
			slot: SLOT,
			path: PATH,
			value: 42
		})
		const { selectConfig } = await import(
			"$lib/server/pipelines/config/named"
		)
		await selectConfig(db, specId, "instance", 0, mine.id, adminId)

		await redeclareDefault(DECLARED)
		await reconcileConfigs(db, specId, specVersionId, RESPOND_SPEC_ID)

		expect(await rowAt(mine.id), "a deviation was swept").toBeTruthy()
		expect(await resolvedLimit()).toEqual({
			value: 42,
			scopeKind: "config"
		})

		// Put the instance back on the shipped config for the writes below.
		await selectConfig(
			db,
			specId,
			"instance",
			0,
			(await shippedConfig()).id,
			adminId
		)
	})
})

describe("writeOption stores a deviation or nothing", () => {
	let mine: number
	let handle: string

	beforeAll(async () => {
		const [config] = await db
			.insert(schema.pipelineConfigs)
			.values({ specId, name: "Write target", isImmutable: false })
			.returning()
		mine = config.id
		handle = optionId(SECRET, NODE, SLOT, PATH)
	})

	const viewer = () => ({ userId: adminId, isAdmin: true })

	it("writes a row for a value that differs", async () => {
		await writeOption(
			db,
			SECRET,
			RESPOND_SPEC_ID,
			viewer(),
			handle,
			30,
			mine
		)
		expect((await rowAt(mine))?.value).toBe(30)
	})

	it("deletes the row when the value returns to the default", async () => {
		await writeOption(
			db,
			SECRET,
			RESPOND_SPEC_ID,
			viewer(),
			handle,
			DECLARED,
			mine
		)
		expect(
			await rowAt(mine),
			`writing the declared default stored a row. It resolves to the same ` +
				`number today and pins the config to it forever after.`
		).toBeUndefined()
	})
})

describe("the panel says which options were changed", () => {
	it("marks a deviated option and leaves an inherited one unmarked", async () => {
		const [mine] = await db
			.insert(schema.pipelineConfigs)
			.values({ specId, name: "Marked", isImmutable: false })
			.returning()
		await db.insert(schema.pipelineConfigValues).values({
			configId: mine.id,
			nodeKey: NODE,
			slot: SLOT,
			path: PATH,
			value: 7
		})
		const { selectConfig } = await import(
			"$lib/server/pipelines/config/named"
		)
		await selectConfig(db, specId, "instance", 0, mine.id, adminId)

		const view = await namespaceView(db, SECRET, RESPOND_SPEC_ID, {
			userId: adminId,
			isAdmin: true
		})
		const all = (view?.steps ?? []).flatMap((s) => [
			...s.options,
			...s.advanced
		])
		const changed = all.find(
			(o) => o.id === optionId(SECRET, NODE, SLOT, PATH)
		)
		expect(changed?.changed, "a deviated option is not marked").toBe(true)
		// Its neighbour on the same slot, which nobody touched.
		const untouched = all.find(
			(o) => o.id === optionId(SECRET, NODE, SLOT, "channel")
		)
		expect(
			untouched?.changed,
			"an inherited option is marked as changed"
		).toBe(false)

		await selectConfig(
			db,
			specId,
			"instance",
			0,
			(await shippedConfig()).id,
			adminId
		)
	})
})
