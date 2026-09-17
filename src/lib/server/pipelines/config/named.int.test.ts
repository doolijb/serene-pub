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
	acknowledgeNotices,
	ensureDefaultConfig,
	reconcileConfigs,
	pendingNotices,
	resolveSelectedConfig,
	selectConfig
} from "$lib/server/pipelines/config/named"
import { declarations } from "$lib/server/pipelines/config/panel"

let db: TestDb
let specId: number
let specVersionId: number

beforeAll(async () => {
	db = await createTestDb()
	await bootstrapPipelines(db)

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
			db,
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

	/**
	 * An author preset's `path` selections have to reach the config, because
	 * `params.path` has no declared default for the back-fill to fall back on:
	 * a preset value missing from the shipped config is a parameter that
	 * resolves EMPTY on every run, with nothing to say so.
	 *
	 * A live Adventure turn is what this is written from. Both selections were
	 * absent, so the voices map iterated the whole plan document as one speaker
	 * and the keeper's whole document reached `resolve-state-changes` as one
	 * change with no slot on it.
	 *
	 * ⚠ A PIN rather than a reproduction, and the distinction is the same one
	 * migration ordering has: a fresh database projects whatever the preset
	 * currently says, so this passes either way. What it cannot see is a config
	 * row written BEFORE the preset said anything, which `ensureDefaultConfig`
	 * never revisits — that is what `0122_adventure_config_reprojection` is for.
	 */
	it("carries the author preset's path selections, which have no declared default", async () => {
		const [adventure] = await db
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, "core:spec/adventure-respond"))
		const res = await ensureDefaultConfig(
			db,
			adventure.id,
			adventure.activeVersionId!,
			adventure.slug
		)
		const at = (nodeKey: string, path: string) =>
			valuesOf(res.configId).then(
				(rows) =>
					rows.find(
						(r: any) =>
							r.nodeKey === nodeKey &&
							r.slot === "params" &&
							r.path === path
					)?.value
			)
		expect(await at("planWrite", "path")).toBe("speakers")
		expect(await at("keeperWrite", "path")).toBe("values,possessions")
	})

	it("is created once, not once per boot", async () => {
		const again = await ensureDefaultConfig(
			db,
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

	/**
	 * The engine is NOT on a value row, and there is nowhere here it could be.
	 *
	 * This test used to assert that `pipeline_config_values.engine` was null on
	 * everything but a template value — which passed for the wrong reason: the
	 * column was null on EVERY row ever written, because the branch that filled
	 * it tested a control string the declarations never emit. The column is gone
	 * now and the language lives on the template row, NOT NULL, delivered to the
	 * renderer from there.
	 *
	 * What is worth asserting instead is the consequence: a template reference
	 * resolves to a row that states its own engine, so nothing downstream has to
	 * guess.
	 */
	it("points a template slot at a row that knows its own language", async () => {
		const [config] = await db
			.select()
			.from(schema.pipelineConfigs)
			.where(
				eq(
					schema.pipelineConfigs.seedKey,
					`pipeline-default:${RESPOND_SPEC_ID}`
				)
			)
		let checked = 0
		for (const v of await valuesOf(config.id)) {
			if (v.slot !== "template") continue
			const [row] = await db
				.select()
				.from(schema.pipelineContextTemplates)
				.where(
					eq(schema.pipelineContextTemplates.id, v.value as number)
				)
			expect(row, "a template slot points at nothing").toBeTruthy()
			expect(row.engine, "a template row has no engine").toBeTruthy()
			checked++
		}
		expect(checked).toBeGreaterThan(0)
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
				// Any surviving address. This was `budget` on the ranker, then
				// `minMessageTokens`, then the ranker's `maxEntries` map; that
				// map moved onto the sources (R-7 P5, 2026-09-16), and the
				// conversation's ceiling now lives on the node that produces
				// the conversation. What the test needs is a value that
				// survives the version, not that particular setting.
				nodeKey: "gather.history.read",
				slot: "params",
				path: "maxEntries",
				value: 9999
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
		await reconcileConfigs(db, specId, specVersionId, RESPOND_SPEC_ID)

		const rows = await valuesOf(mine)
		expect(
			rows.find((r: any) => r.path === "aParamThisVersionDoesNotDeclare")
		).toBeUndefined()
	})

	it("leaves a notice saying what was removed, and what it held", async () => {
		// A notice that says "your value was removed" without saying what it was
		// asks the user to remember something they configured months ago.
		const notices = await pendingNotices(db, mine)
		const culled = notices.filter((n: any) => n.kind === "culled")
		expect(culled).toHaveLength(1)
		expect(culled[0].path).toBe("aParamThisVersionDoesNotDeclare")
		expect(culled[0].previousValue).toBe(
			"set against a field that is going away"
		)
		expect(culled[0].specVersionId).toBe(specVersionId)
		// And it says WHICH control. This one was never declared by any
		// version here, so the label is the address humanized the way the
		// panel humanizes every other key — which is still a name a person
		// recognises, and is the fallback, not the happy path (see the
		// "naming what was culled" block below for the declared label).
		expect(culled[0].label).toBe("A Param This Version Does Not Declare")
	})

	it("never touches a value that still has an address", async () => {
		// The claim the whole layer chain rests on. If reconciliation reset
		// values it recognised, every release would wipe everyone's tuning.
		const rows = await valuesOf(mine)
		const kept = rows.find(
			(r: any) =>
				r.nodeKey === "gather.history.read" && r.path === "maxEntries"
		)
		expect(kept).toBeTruthy()
		expect(kept!.value).toBe(9999)
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
		const before = (await pendingNotices(db, mine)).length
		const report = await reconcileConfigs(
			db,
			specId,
			specVersionId,
			RESPOND_SPEC_ID
		)
		expect(report).toEqual([])
		expect((await pendingNotices(db, mine)).length).toBe(before)
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
		const res = await resolveSelectedConfig(db, specId, RESPOND_SPEC_ID, {})
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
		await selectConfig(db, specId, "instance", 0, mine, userId)
		expect(
			(await resolveSelectedConfig(db, specId, RESPOND_SPEC_ID, {}))!
				.source
		).toBe("instance")

		await selectConfig(db, specId, "session", sessionId, mine, userId)
		expect(
			(await resolveSelectedConfig(db, specId, RESPOND_SPEC_ID, {
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

		const res = await resolveSelectedConfig(db, specId, RESPOND_SPEC_ID, {
			sessionId
		})
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
			selectConfig(db, specId, "session", sessionId, foreign.id, userId)
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
			db,
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

	it("names the layouts it dropped, not just their addresses", async () => {
		// "A setting was removed" is barely better than silence. The type that
		// declared these is gone from this install, so the name comes from the
		// address — and `exampleDialogue` reads as "Example Dialogue", which is
		// what the control was called on the screen the user set it from.
		const notices = await db
			.select()
			.from(schema.pipelineConfigNotices)
			.where(eq(schema.pipelineConfigNotices.configId, configId))
		const byPath = new Map(
			(notices as any[])
				.filter((n) => n.kind === "culled")
				.map((n) => [n.path, n.label])
		)
		expect(byPath.get("exampleDialogue")).toBe("Example Dialogue")
		expect(byPath.get("speakerRelationships")).toBe("Speaker Relationships")
	})
})

/**
 * An author preset that sets a whole SLOT has to be readable per FIELD.
 *
 * `p.settings('render', { review: 'on' })` stores one row —
 * `render|settings|<whole slot> = {"review":"on"}` — while declarations for a
 * settings slot are per-field. The seeder looks values up by exact address, so
 * for as long as it only matched the exact spelling, every author preset that
 * set `settings` was dropped in silence and the config took the author default.
 *
 * The visible cost of that: `core:spec/generate-image` ships `review-on` as its
 * DEFAULT preset, labelled "Ask for the prompt". The shipped config was named
 * after it — so the panel said "Ask for the prompt" — and pressing Image
 * rendered immediately with whatever the prompts slot happened to hold, because
 * the one value the preset existed to set never arrived.
 */
describe("an author preset that sets a whole settings slot", () => {
	const configFor = async (slug: string) => {
		const [spec] = await db
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, slug))
		const res = await ensureDefaultConfig(
			db,
			spec.id,
			spec.activeVersionId!,
			slug
		)
		const rows = await valuesOf(res.configId)
		return new Map(
			(rows as any[]).map((r) => [
				`${r.nodeKey}|${r.slot}|${r.path}`,
				r.value
			])
		)
	}

	it("reaches the field the declaration names", async () => {
		const values = await configFor("core:spec/generate-image")
		expect(values.get("render|settings|review")).toBe("on")
	})

	it("leaves a node the preset never mentioned on its own default", async () => {
		// `post` (create-message) is not in the preset. Exploding a whole-slot
		// value must not spray it across sibling nodes.
		//
		// ⚠ Asserted as an ABSENCE since the deviation ruling (2026-09-10): a
		// config stores only what departs from the declaration, and `post`'s
		// review declaration already says `off`, so the correct state is no row
		// rather than a row holding `off`. Both halves are named — not `on`,
		// and not there at all — because "no row" alone would also be satisfied
		// by a seeder that had stopped writing this slot entirely, and `not on`
		// alone would be satisfied by the materialized copy this ruling removes.
		const values = await configFor("core:spec/generate-image")
		expect(
			values.get("post|settings|review"),
			"the sibling node caught the preset's whole-slot value"
		).not.toBe("on")
		expect(
			values.has("post|settings|review"),
			"a row was written holding exactly the declared default — it " +
				"resolves the same today and pins the node to `off` forever after"
		).toBe(false)
		// And the one that IS a deviation is still there, so this is not a
		// config that simply lost its settings slot.
		expect(values.get("render|settings|review")).toBe("on")
	})

	it("names the config after the preset it actually applied", async () => {
		// The two travelled separately before: the NAME came from the preset and
		// the VALUES did not, which is what made the failure so hard to see.
		const [spec] = await db
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, "core:spec/generate-image"))
		const res = await ensureDefaultConfig(
			db,
			spec.id,
			spec.activeVersionId!,
			"core:spec/generate-image"
		)
		const [config] = await db
			.select()
			.from(schema.pipelineConfigs)
			.where(eq(schema.pipelineConfigs.id, res.configId))
		expect(config.name).toBe("Ask for the prompt")
	})
})

/**
 * A notice that cannot name what was lost is barely better than silence.
 *
 * The cull wrote `label: null` for as long as it existed, which left the one
 * surface that could explain a missing setting able to say only "something at
 * an address you cannot read is gone". The label is not reachable from the
 * declarations the reconciler is holding — a cull is *defined* as an address
 * the new version does not declare — so it comes from the version that did
 * declare it, and from the address when that version's declarations are gone.
 *
 * Both halves are asserted, because the fallback is the one that runs during
 * pre-release re-projection (0186, 0191) and the declared label is the one that
 * runs on every version bump after 0.6.0 ships.
 */
describe("naming what was culled", () => {
	let mine: number
	/** The address only the older version declares, and what it called it. */
	let retired: { nodeKey: string; slot: string; path: string; label: string }

	beforeAll(async () => {
		// An earlier published version of this same pipeline, carrying a step
		// the active version does not have. Built from a type the registry
		// already holds — one that actually declares a labelled field — so its
		// declarations, and their labels, are the real ones rather than a
		// fixture's idea of them.
		const live = await declarations(db, specVersionId)
		const source = live.find((d) => !!d.path && !!d.label)!
		const [node] = await db
			.select()
			.from(schema.pipelineNodes)
			.where(
				and(
					eq(schema.pipelineNodes.specVersionId, specVersionId),
					eq(schema.pipelineNodes.nodeKey, source.nodeKey)
				)
			)

		const [prior] = await db
			.insert(schema.pipelineSpecVersions)
			.values({
				specId,
				semver: "0.0.1-before-the-cull",
				status: "published",
				canonicalHash: "test-prior-version"
			})
			.returning()

		await db.insert(schema.pipelineNodes).values({
			specVersionId: prior.id,
			nodeKey: "retiredStep",
			kind: node.kind,
			definitionId: node.definitionId,
			definitionVersion: node.definitionVersion,
			position: 0
		})

		const decls = await declarations(db, prior.id)
		const d = decls.find(
			(x) =>
				x.nodeKey === "retiredStep" &&
				x.path === source.path &&
				!!x.label
		)!
		expect(d, "the older version declared nothing to cull").toBeTruthy()
		retired = {
			nodeKey: d.nodeKey,
			slot: d.slot,
			path: d.path,
			label: d.label
		}

		const [config] = await db
			.insert(schema.pipelineConfigs)
			.values({ specId, name: "Tuned before the step retired" })
			.returning()
		mine = config.id

		await db.insert(schema.pipelineConfigValues).values({
			configId: mine,
			nodeKey: retired.nodeKey,
			slot: retired.slot,
			path: retired.path,
			value: "set while the step still existed"
		})
	}, 60_000)

	it("labels the cull with what the version that declared it called it", async () => {
		await reconcileConfigs(db, specId, specVersionId, RESPOND_SPEC_ID)
		const culled = (await pendingNotices(db, mine)).filter(
			(n: any) => n.kind === "culled" && n.path === retired.path
		)
		expect(culled).toHaveLength(1)
		expect(culled[0].label).toBe(retired.label)
		expect(culled[0].previousValue).toBe("set while the step still existed")
	})

	it("labels a back-fill too, so one list reads as one list", async () => {
		// Back-fills answer the same question a cull does — "why is this
		// different today" — and an unlabelled row beside a labelled one reads
		// as a bug in the screen rather than as a quieter kind of notice.
		const backfilled = (await pendingNotices(db, mine)).filter(
			(n: any) => n.kind === "backfilled"
		)
		expect(backfilled.length).toBeGreaterThan(0)
		for (const n of backfilled as any[])
			expect(n.label, `${n.slot}/${n.path} arrived nameless`).toBeTruthy()
	})
})

/**
 * A dismissed notice stays dismissed.
 *
 * Acknowledgement is a column on the row rather than anything a client
 * remembers, because the alternative — a banner that comes back on the next
 * reload, in the next tab, on the next machine — teaches people to ignore the
 * one surface that explains a missing setting.
 */
describe("dismissing a notice", () => {
	let configId: number
	let first: number

	beforeAll(async () => {
		const [config] = await db
			.insert(schema.pipelineConfigs)
			.values({ specId, name: "Notices to dismiss" })
			.returning()
		configId = config.id
		const rows = await db
			.insert(schema.pipelineConfigNotices)
			.values([
				{
					configId,
					kind: "culled",
					nodeKey: "rank",
					slot: "params",
					path: "goneOne",
					label: "Gone One",
					previousValue: 1 as any,
					specVersionId
				},
				{
					configId,
					kind: "culled",
					nodeKey: "rank",
					slot: "params",
					path: "goneTwo",
					label: "Gone Two",
					previousValue: 2 as any,
					specVersionId
				}
			])
			.returning()
		first = (rows as any[])[0].id
	})

	it("acknowledges one without touching the other", async () => {
		expect(await acknowledgeNotices(db, configId, first)).toBe(1)
		const left = await pendingNotices(db, configId)
		expect(left.map((n: any) => n.path)).toEqual(["goneTwo"])
	})

	it("keeps the row, stamped — the value is still recoverable", async () => {
		// Dismissing says "I have seen this", not "delete what I had set".
		const [row] = await db
			.select()
			.from(schema.pipelineConfigNotices)
			.where(eq(schema.pipelineConfigNotices.id, first))
		expect(row.acknowledgedAt).toBeTruthy()
		expect(row.previousValue).toBe(1)
	})

	it("is idempotent, and re-reading does not resurrect it", async () => {
		expect(await acknowledgeNotices(db, configId, first)).toBe(0)
		const left = await pendingNotices(db, configId)
		expect(left.map((n: any) => n.path)).toEqual(["goneTwo"])
	})

	it("refuses to reach another configuration's notices", async () => {
		// The id arrives from a client and a notice id is a small integer
		// somebody can guess, so the pairing with the config is the guard.
		const [other] = await db
			.insert(schema.pipelineConfigs)
			.values({ specId, name: "Somebody else's tuning" })
			.returning()
		expect(await acknowledgeNotices(db, other.id, first)).toBe(0)
		const [row] = await db
			.select()
			.from(schema.pipelineConfigNotices)
			.where(eq(schema.pipelineConfigNotices.id, first))
		expect(row.configId).toBe(configId)
	})

	it("clears everything pending when no notice is named", async () => {
		expect(await acknowledgeNotices(db, configId)).toBe(1)
		expect(await pendingNotices(db, configId)).toEqual([])
	})
})
