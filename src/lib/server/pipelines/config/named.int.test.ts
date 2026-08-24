/**
 * The shipped default, and what a version change does to a config somebody tuned.
 *
 * Four claims, each of which is a decision that would be easy to reverse by
 * accident and hard to notice afterwards:
 *
 *  1. **Every pipeline has a default config, and it is immutable.** The thing a
 *     user's config is derived from cannot also be a thing they edit.
 *  2. **A removed option is culled, and the cull leaves a notice.** Silently
 *     dropping it makes the pipeline change behaviour for no stated reason.
 *  3. **A new option is back-filled from the default.** Not from the bare
 *     declaration — from what the author actually shipped.
 *  4. **A value that still has an address is never touched**, even when the
 *     author default moved under it. That asymmetry is the layer chain (12 §2);
 *     "reconcile" quietly meaning "reset" would undo every user's tuning on
 *     every release.
 */

import { describe, it, expect, beforeAll } from "vitest"
import { and, eq } from "drizzle-orm"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import {
	bootstrapPipelines,
	RESPOND_SPEC_ID
} from "$lib/server/pipelines/boot/bootstrap"
import {
	ensureDefaultConfig,
	reconcileConfigs,
	pendingNotices,
	resolveSelectedConfig,
	selectConfig
} from "$lib/server/pipelines/config/named"

let db: TestDb
let specId: number
let specVersionId: number

beforeAll(async () => {
	db = await createTestDb()
	await bootstrapPipelines(db as any)

	const [spec] = await db
		.select()
		.from(schema.pipelineSpecs)
		.where(eq(schema.pipelineSpecs.slug, RESPOND_SPEC_ID))
	specId = spec.id
	specVersionId = spec.activeVersionId!
}, 60_000)

const valuesOf = async (configId: number) =>
	await db
		.select()
		.from(schema.pipelineConfigValues)
		.where(eq(schema.pipelineConfigValues.configId, configId))

describe("the shipped default", () => {
	it("exists for the pipeline, immutable and marked default", async () => {
		const res = await ensureDefaultConfig(
			db as any,
			specId,
			specVersionId,
			RESPOND_SPEC_ID
		)
		const [config] = await db
			.select()
			.from(schema.pipelineConfigs)
			.where(eq(schema.pipelineConfigs.id, res.configId))

		expect(config.isImmutable).toBe(true)
		expect(config.isDefault).toBe(true)
		expect(config.specId).toBe(specId)
		expect(await valuesOf(config.id)).not.toHaveLength(0)
	})

	it("is created once, not once per boot", async () => {
		const again = await ensureDefaultConfig(
			db as any,
			specId,
			specVersionId,
			RESPOND_SPEC_ID
		)
		expect(again.action).toBe("present")

		const all = await db
			.select()
			.from(schema.pipelineConfigs)
			.where(eq(schema.pipelineConfigs.specId, specId))
		expect(all.filter((c: any) => c.isImmutable)).toHaveLength(1)
	})

	it("carries the engine on a template value and nowhere else", async () => {
		// 12 §2a puts the language on the value. A template row that lost its
		// engine would render with whatever core defaults to — which is the
		// failure mode that reads as a template bug rather than a lost field.
		const [config] = await db
			.select()
			.from(schema.pipelineConfigs)
			.where(
				eq(
					schema.pipelineConfigs.seedKey,
					`pipeline-default:${RESPOND_SPEC_ID}`
				)
			)
		for (const v of await valuesOf(config.id))
			if (v.slot !== "template") expect(v.engine).toBeNull()
	})
})

describe("what a new version does to a tuned config", () => {
	let mine: number

	beforeAll(async () => {
		// A user's own copy, with one value they set and one address that will
		// stop existing.
		const [config] = await db
			.insert(schema.pipelineConfigs)
			.values({ specId, name: "My tuning", isImmutable: false })
			.returning()
		mine = config.id

		// A param, because params are what a config holds inline. Prompts,
		// connections and sampling are references to swappable entities, and a
		// reference is not the interesting case for cull-and-back-fill.
		await db.insert(schema.pipelineConfigValues).values([
			{
				configId: mine,
				nodeKey: "rank",
				slot: "params",
				// Any surviving address on the ranker. This was `budget`, then
				// `minMessageTokens`; both were retired as the ranker's knobs
				// became per-source stacks, and there is no plain scalar left
				// on it at all. What the test needs is a value that survives
				// the version, not that particular setting.
				path: "maxEntries",
				value: {
					messages: 9999,
					worldLore: 20,
					characterLore: 15,
					history: 10,
					relationships: 0
				}
			},
			{
				configId: mine,
				nodeKey: "rank",
				slot: "params",
				path: "aParamThisVersionDoesNotDeclare",
				value: "set against a field that is going away"
			}
		])
	})

	it("culls a value the new version no longer declares", async () => {
		await reconcileConfigs(
			db as any,
			specId,
			specVersionId,
			RESPOND_SPEC_ID
		)

		const rows = await valuesOf(mine)
		expect(
			rows.find((r: any) => r.path === "aParamThisVersionDoesNotDeclare")
		).toBeUndefined()
	})

	it("leaves a notice saying what was removed, and what it held", async () => {
		// A notice that says "your value was removed" without saying what it was
		// asks the user to remember something they configured months ago.
		const notices = await pendingNotices(db as any, mine)
		const culled = notices.filter((n: any) => n.kind === "culled")
		expect(culled).toHaveLength(1)
		expect(culled[0].path).toBe("aParamThisVersionDoesNotDeclare")
		expect(culled[0].previousValue).toBe(
			"set against a field that is going away"
		)
		expect(culled[0].specVersionId).toBe(specVersionId)
	})

	it("never touches a value that still has an address", async () => {
		// The claim the whole layer chain rests on. If reconciliation reset
		// values it recognised, every release would wipe everyone's tuning.
		const rows = await valuesOf(mine)
		const kept = rows.find(
			(r: any) => r.nodeKey === "rank" && r.path === "maxEntries"
		)
		expect(kept).toBeTruthy()
		expect((kept!.value as any).messages).toBe(9999)
	})

	it("back-fills every option the config had never held, from the default", async () => {
		const [shipped] = await db
			.select()
			.from(schema.pipelineConfigs)
			.where(
				and(
					eq(schema.pipelineConfigs.specId, specId),
					eq(schema.pipelineConfigs.isImmutable, true)
				)
			)

		const shippedByAddr = new Map(
			(await valuesOf(shipped.id)).map((v: any) => [
				`${v.nodeKey} ${v.slot} ${v.path}`,
				v.value
			])
		)
		const mineByAddr = new Map(
			(await valuesOf(mine)).map((v: any) => [
				`${v.nodeKey} ${v.slot} ${v.path}`,
				v.value
			])
		)

		// Every address the shipped default holds is now present in the copy…
		for (const key of shippedByAddr.keys())
			expect(mineByAddr.has(key), `missing ${key}`).toBe(true)

		// …at the shipped value, except the one the user had actually set.
		for (const [key, value] of shippedByAddr)
			if (key !== "rank params maxEntries")
				expect(mineByAddr.get(key), key).toEqual(value)
	})

	it("is a no-op the second time", async () => {
		// Reconciliation runs on every publish. One that kept writing would grow
		// a notice list nobody could read.
		const before = (await pendingNotices(db as any, mine)).length
		const report = await reconcileConfigs(
			db as any,
			specId,
			specVersionId,
			RESPOND_SPEC_ID
		)
		expect(report).toEqual([])
		expect((await pendingNotices(db as any, mine)).length).toBe(before)
	})
})

describe("which config a scope has selected", () => {
	/**
	 * The seven `system_settings.default_*_config_id` columns this replaces could
	 * express one layer for the namespaces core shipped a column for. These tests
	 * are about the two things that shape buys: every namespace, and a fallback
	 * that is a foreign key rather than a check every read has to remember.
	 */
	let userId: number
	let sessionId: number
	let mine: number

	beforeAll(async () => {
		const [user] = await db
			.insert(schema.users)
			.values({ username: "selection-test", isAdmin: false })
			.returning()
		userId = user.id
		const [session] = await db
			.insert(schema.sessions)
			.values({ userId, isGroup: false })
			.returning()
		sessionId = session.id

		const [config] = await db
			.insert(schema.pipelineConfigs)
			.values({ specId, name: "Selection target", isImmutable: false })
			.returning()
		mine = config.id
	})

	it("falls back to what core shipped when nothing has chosen", async () => {
		const res = await resolveSelectedConfig(
			db as any,
			specId,
			RESPOND_SPEC_ID,
			{}
		)
		expect(res!.source).toBe("shipped")

		const [shipped] = await db
			.select()
			.from(schema.pipelineConfigs)
			.where(
				eq(
					schema.pipelineConfigs.seedKey,
					`pipeline-default:${RESPOND_SPEC_ID}`
				)
			)
		expect(res!.configId).toBe(shipped.id)
	})

	it("prefers the nearer scope, session over instance — the whole chain now", async () => {
		// The user step is gone (ruled 2026-08-24): a person's choice of
		// config is made per session, or it is the instance's.
		await selectConfig(db as any, specId, "instance", 0, mine, userId)
		expect(
			(await resolveSelectedConfig(
				db as any,
				specId,
				RESPOND_SPEC_ID,
				{}
			))!.source
		).toBe("instance")

		await selectConfig(
			db as any,
			specId,
			"session",
			sessionId,
			mine,
			userId
		)
		expect(
			(await resolveSelectedConfig(db as any, specId, RESPOND_SPEC_ID, {
				sessionId
			}))!.source
		).toBe("session")
	})

	it("returns a scope to the shipped default when its config is deleted", async () => {
		// The point of ON DELETE SET NULL. A code path that checked whether the
		// referenced row still existed would be a check every read has to
		// remember, and the first read that forgets resolves against nothing.
		await db
			.delete(schema.pipelineConfigs)
			.where(eq(schema.pipelineConfigs.id, mine))

		const rows = await db
			.select()
			.from(schema.pipelineConfigSelections)
			.where(eq(schema.pipelineConfigSelections.specId, specId))
		expect(rows.length).toBeGreaterThan(0)
		for (const r of rows) expect(r.configId).toBeNull()

		const res = await resolveSelectedConfig(
			db as any,
			specId,
			RESPOND_SPEC_ID,
			{ sessionId }
		)
		expect(res!.source).toBe("shipped")
	})

	it("refuses a config belonging to a different pipeline", async () => {
		// A selection that silently does nothing is the hardest configuration bug
		// to see: every screen shows what the user picked and the run uses
		// something else.
		const [otherSpec] = await db
			.insert(schema.pipelineSpecs)
			.values({ slug: "core:spec/elsewhere", name: "Elsewhere" })
			.returning()
		const [foreign] = await db
			.insert(schema.pipelineConfigs)
			.values({ specId: otherSpec.id, name: "Not for respond" })
			.returning()

		await expect(
			selectConfig(
				db as any,
				specId,
				"session",
				sessionId,
				foreign.id,
				userId
			)
		).rejects.toThrow(/different pipeline/i)
	})
})

/**
 * Upgrading past the narrator split does not silently drop somebody's tuning.
 *
 * `core:spec/narrate` moved to its own context-builder type, which stopped
 * declaring two layouts it could never fill — `exampleDialogue`, read off a
 * speaking character a narrator does not have, and `speakerRelationships`,
 * which that spec never supplies. Any configuration written before the split
 * carries values at those addresses, and the new version does not declare them.
 *
 * The rule for that is already here — cull, but record a notice with the
 * previous value first — and this is the case that will actually exercise it on
 * an upgrade rather than in the abstract. A cull that lost the value, or a
 * reconcile that threw on an address it did not recognise, would both show up
 * as "my narrator settings are gone" on first boot after updating.
 */
describe("the narrator split, from an older configuration", () => {
	let narrateSpecId: number
	let narrateVersionId: number
	let configId: number

	beforeAll(async () => {
		const [narrate] = await db
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, "core:spec/narrate"))
		narrateSpecId = narrate.id
		narrateVersionId = narrate.activeVersionId!

		const [cfg] = await db
			.insert(schema.pipelineConfigs)
			.values({ specId: narrateSpecId, name: "Pre-split narrator" })
			.returning()
		configId = cfg.id

		// What the older type declared, written the way a config carries it.
		await db.insert(schema.pipelineConfigValues).values([
			{
				configId,
				nodeKey: "context",
				slot: "variables",
				path: "exampleDialogue",
				value: 42 as any
			},
			{
				configId,
				nodeKey: "context",
				slot: "variables",
				path: "speakerRelationships",
				value: 43 as any
			},
			// One the new type still declares, as the control.
			{
				configId,
				nodeKey: "context",
				slot: "variables",
				path: "characters",
				value: 44 as any
			}
		])
	})

	it("culls what the narrator cannot render, and keeps what it can", async () => {
		await reconcileConfigs(
			db as any,
			narrateSpecId,
			narrateVersionId,
			"core:spec/narrate"
		)
		const paths = (await valuesOf(configId))
			.filter((v: any) => v.slot === "variables")
			.map((v: any) => v.path)
		expect(paths).not.toContain("exampleDialogue")
		expect(paths).not.toContain("speakerRelationships")
		expect(
			paths,
			"a layout the narrator does render was culled too"
		).toContain("characters")
	})

	it("keeps the dropped values on the record rather than discarding them", async () => {
		// The difference between "we removed a setting" and "your setting
		// vanished" is entirely whether the old value can still be read back.
		const notices = await db
			.select()
			.from(schema.pipelineConfigNotices)
			.where(eq(schema.pipelineConfigNotices.configId, configId))
		const culled = (notices as any[]).filter((n) => n.kind === "culled")
		const byPath = new Map(culled.map((n) => [n.path, n.previousValue]))
		expect(byPath.get("exampleDialogue")).toBe(42)
		expect(byPath.get("speakerRelationships")).toBe(43)
	})
})
