/**
 * ⏳ Ten core pipelines take their new ids at boot (PLAN-catalogue-and-pipeline-names
 * C4), and the shipped default configs are named "Default" (C5).
 *
 * An install that ran an earlier build holds the old ids on its spec rows and
 * in every string that names one. This boots a fresh database, puts it back
 * the way an earlier build left it — old ids, old seed keys, old default
 * names, a person's settings on the old rows, tool-loop's rows — boots again,
 * and checks that everything sits under the new ids on the SAME rows, that
 * nothing was seeded twice, and that a third boot changes nothing. Then a
 * development database that booted this build before the pass existed: both
 * ids have rows, and the old one is merged into the new.
 */

import { beforeAll, describe, expect, it } from "vitest"
import { and, asc, eq, inArray, like } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	createTestDb,
	createTestUser,
	type TestDb
} from "$lib/server/utils/testDb"
import "@serene-pub/contracts"
import "@serene-pub/core-catalog"
import { renameSpecSlugs, renamedIn, SPEC_SLUG_RENAMES } from "./specSlugRename"

const CHAT = "core:genre/chat"
const OLD = Object.fromEntries(SPEC_SLUG_RENAMES.map(([o, n]) => [n, o]))
const TOOL_LOOP = "core:spec/tool-loop"
const TOOL_LOOP_PROMPT_KEY =
	"pipeline-prompt:core:task/assemble:prompts:tool-loop-default"

const bootstrap = async (db: TestDb) => {
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	return await bootstrapPipelines(db)
}

const specRow = async (db: TestDb, slug: string) =>
	(
		await db
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, slug))
	)[0]

/** A declared numeric setting on the spec's active version — one a reconcile keeps. */
async function numericParam(db: TestDb, slug: string) {
	const { declarations } = await import(
		"$lib/server/pipelines/config/panel/declarations"
	)
	const spec = await specRow(db, slug)
	const decl = (await declarations(db, spec!.activeVersionId!)).find(
		(d) => d.slot === "params" && typeof d.authorDefault === "number"
	)
	expect(decl, `${slug} declares a numeric param`).toBeTruthy()
	return {
		nodeKey: decl!.nodeKey,
		slot: decl!.slot,
		path: decl!.path,
		value: (decl!.authorDefault as number) + 7
	}
}

/** Everything the pass and the seed touch, for "a second boot changes nothing". */
async function snapshot(db: TestDb) {
	const all = async (table: any, order: any) =>
		await db.select().from(table).orderBy(asc(order))
	const strip = (rows: any[], ...keys: string[]) =>
		rows.map((r) => {
			const out = { ...r }
			for (const k of keys) delete out[k]
			return out
		})
	return {
		specs: await all(schema.pipelineSpecs, schema.pipelineSpecs.id),
		versions: strip(
			await all(
				schema.pipelineSpecVersions,
				schema.pipelineSpecVersions.id
			),
			"publishedAt"
		),
		configs: strip(
			await all(schema.pipelineConfigs, schema.pipelineConfigs.id),
			"updatedAt"
		),
		values: await all(
			schema.pipelineConfigValues,
			schema.pipelineConfigValues.id
		),
		overrides: await all(
			schema.pipelineNodeOverrides,
			schema.pipelineNodeOverrides.id
		),
		selections: await all(
			schema.pipelineConfigSelections,
			schema.pipelineConfigSelections.id
		),
		rebinds: await all(
			schema.pipelineNodeRebinds,
			schema.pipelineNodeRebinds.id
		),
		bindings: await all(
			schema.pipelineBindings,
			schema.pipelineBindings.id
		),
		functions: await all(
			schema.sessionFunctions,
			schema.sessionFunctions.id
		),
		seen: await all(schema.seenActions, schema.seenActions.id),
		presets: strip(
			await all(schema.sessionPresets, schema.sessionPresets.id),
			"updatedAt"
		),
		prompts: strip(
			await all(schema.pipelinePrompts, schema.pipelinePrompts.id),
			"updatedAt"
		),
		plugins: (await all(schema.plugins, schema.plugins.id)).map(
			(p: any) => p.disabledSwaps
		)
	}
}

describe("the slug pattern", () => {
	it("renames an old id at a slug's boundaries and nowhere else", () => {
		expect(renamedIn("core:spec/respond")).toBe("core:spec/chat-respond")
		expect(renamedIn("pipeline-default:core:spec/narrate-character")).toBe(
			"pipeline-default:core:spec/chat-side-character"
		)
		expect(renamedIn("migrated:core:spec/respond:12")).toBe(
			"migrated:core:spec/chat-respond:12"
		)
		expect(renamedIn("plugin:acme.x:core:spec/generate-image#hq")).toBe(
			"plugin:acme.x:core:spec/chat-generate-image#hq"
		)
		expect(renamedIn("core:spec/narrate#narrate")).toBe(
			"core:spec/chat-narrate#narrate"
		)
		expect(
			renamedIn("core:spec/answer-form-lair#speaker#core:task/x@1")
		).toBe("core:spec/lair-answer-form#speaker#core:task/x@1")
		for (const kept of [
			"core:spec/respond-extra",
			"acme.core:spec/respond",
			"core:spec/chat-respond",
			"core:spec/guide-respond",
			"core:spec/narrated",
			"core:event/message-respond@1"
		])
			expect(renamedIn(kept)).toBe(kept)
	})

	it("maps old ids the catalogue no longer ships onto ids it does", async () => {
		const { CORE_SPECS } = await import("@serene-pub/core-catalog")
		const shipped = new Set(CORE_SPECS.map((e) => e.build().id))
		for (const [old, renamed] of SPEC_SLUG_RENAMES) {
			expect(shipped.has(renamed), renamed).toBe(true)
			expect(shipped.has(old), old).toBe(false)
		}
		expect(shipped.has(TOOL_LOOP)).toBe(false)
	})
})

describe("an install an earlier build left", () => {
	let db: TestDb
	let userId: number
	let sessionId: number
	/** Row ids by NEW slug, as the fresh boot left them. */
	const ids: Record<string, number> = {}
	let specCount = 0
	let param: Awaited<ReturnType<typeof numericParam>>
	const staged: Record<string, number> = {}

	beforeAll(async () => {
		db = await createTestDb()
		await bootstrap(db)
		for (const [, renamed] of SPEC_SLUG_RENAMES)
			ids[renamed] = (await specRow(db, renamed))!.id
		specCount = (await db.select().from(schema.pipelineSpecs)).length
		param = await numericParam(db, "core:spec/chat-respond")
		userId = (await createTestUser(db, "spec-slug-rename")).id
		const [session] = await db
			.insert(schema.sessions)
			.values({ userId, isGroup: false, name: "rename" })
			.returning()
		sessionId = session!.id

		// The rows, as an earlier build published them: old ids, and documents
		// this build does not hash the same, so the seed republishes them.
		for (const [old, renamed] of SPEC_SLUG_RENAMES) {
			await db
				.update(schema.pipelineSpecs)
				.set({ slug: old })
				.where(eq(schema.pipelineSpecs.id, ids[renamed]!))
			for (const v of await db
				.select()
				.from(schema.pipelineSpecVersions)
				.where(eq(schema.pipelineSpecVersions.specId, ids[renamed]!)))
				await db
					.update(schema.pipelineSpecVersions)
					.set({ canonicalHash: `pre-rename-${v.canonicalHash}` })
					.where(eq(schema.pipelineSpecVersions.id, v.id))
		}
		// The shipped defaults: old seed keys, named after their presets.
		for (const c of await db
			.select()
			.from(schema.pipelineConfigs)
			.where(like(schema.pipelineConfigs.seedKey, "pipeline-default:%")))
			await db
				.update(schema.pipelineConfigs)
				.set({
					seedKey: renamedBack(c.seedKey!),
					name: `Shipped ${c.id}`
				})
				.where(eq(schema.pipelineConfigs.id, c.id))

		const respond = ids["core:spec/chat-respond"]!
		const narrate = ids["core:spec/chat-narrate"]!
		// A person's configs on the reply: one tuned and selected, one that
		// took the name "Default", one the 0.5.3 upgrade wrote.
		const [tuned] = await db
			.insert(schema.pipelineConfigs)
			.values({
				specId: respond,
				name: "My tuning",
				includedActions: [
					"core:spec/narrate#narrate",
					"core:spec/chat-narrate#narrate"
				]
			})
			.returning()
		staged.tuned = tuned!.id
		await db.insert(schema.pipelineConfigValues).values({
			configId: tuned!.id,
			nodeKey: param.nodeKey,
			slot: param.slot,
			path: param.path,
			value: param.value
		})
		staged.mine = (
			await db
				.insert(schema.pipelineConfigs)
				.values({ specId: respond, name: "Default" })
				.returning()
		)[0]!.id
		staged.migrated = (
			await db
				.insert(schema.pipelineConfigs)
				.values({
					specId: respond,
					name: "Terse prompt",
					seedKey: "migrated:core:spec/respond:7"
				})
				.returning()
		)[0]!.id
		await db.insert(schema.pipelineConfigSelections).values({
			specId: respond,
			scopeKind: "session",
			scopeId: sessionId,
			configId: tuned!.id
		})
		await db.insert(schema.pipelineNodeOverrides).values({
			specId: respond,
			scopeKind: "session",
			scopeId: sessionId,
			nodeKey: param.nodeKey,
			slot: param.slot,
			path: param.path,
			value: param.value + 1,
			updatedBy: userId
		})
		await db.insert(schema.pipelineNodeRebinds).values({
			specId: respond,
			scopeKind: "session",
			scopeId: sessionId,
			nodeKey: "generate",
			definitionId: "core:oracle/generate-text@1"
		})

		// The action identities.
		await db.insert(schema.pipelineBindings).values({
			scopeKind: "session",
			scopeId: sessionId,
			genreId: CHAT,
			subject: "core:spec/narrate#narrate",
			specId: narrate,
			enabledWhen: [
				{
					on: "turn.subject",
					equals: "core:spec/narrate#narrate",
					reason: "Not now"
				}
			] as any
		})
		await db.insert(schema.sessionFunctions).values({
			sessionId,
			genreId: CHAT,
			functionKey: "core:spec/narrate#narrate",
			enabled: false
		})
		await db.insert(schema.seenActions).values([
			{ userId, actionKey: "core:spec/generate-image#generate-image" },
			// Seen under both spellings: one row is left.
			{
				userId,
				actionKey: "core:spec/narrate-character#narrate-character"
			},
			{
				userId,
				actionKey: "core:spec/chat-side-character#narrate-character"
			}
		])

		// The core Chat preset, bound by the old ids, and a person's disabled
		// preset with every column that names a spec, and a notice on it.
		const [core] = await db
			.select()
			.from(schema.sessionPresets)
			.where(
				and(
					eq(schema.sessionPresets.genreId, CHAT),
					eq(schema.sessionPresets.isImmutable, true)
				)
			)
			.limit(1)
		staged.corePreset = core!.id
		await db
			.update(schema.sessionPresets)
			.set({
				bindings: Object.fromEntries(
					Object.entries(core!.bindings ?? {}).map(([event, b]) => [
						event,
						{ ...b, spec: renamedBack(b.spec) }
					])
				)
			})
			.where(eq(schema.sessionPresets.id, core!.id))
		const [mine] = await db
			.insert(schema.sessionPresets)
			.values({
				name: "My chat",
				genreId: CHAT,
				enabled: false,
				primarySlug: "core:spec/respond",
				bindings: {
					"core:event/message-respond@1": {
						spec: "core:spec/respond",
						config: tuned!.id
					}
				},
				configSelections: {
					"core:spec/respond": tuned!.id,
					"core:spec/narrate": 1,
					"core:spec/chat-narrate": 2
				},
				includedActions: ["core:spec/narrate#narrate", "narrate"],
				defaults: {
					envoys: ["core.mascot"],
					swaps: [
						{
							spec: "core:spec/respond",
							node: "speaker",
							definition: "core:task/turn-round-robin@1"
						}
					]
				}
			})
			.returning()
		staged.myPreset = mine!.id
		await db.insert(schema.sessionPresetNotices).values({
			presetId: mine!.id,
			event: "core:event/message-respond@1",
			boundSpec: "core:spec/respond",
			reason: "stale",
			fallbackSpec: "core:spec/respond"
		})

		// Prompts: a shipped one claiming the reply, and a person's.
		const shipped = (await db.select().from(schema.pipelinePrompts)).find(
			(p) =>
				(p.defaultForSpecs as string[]).includes(
					"core:spec/chat-respond"
				)
		)!
		staged.shippedPrompt = shipped.id
		await db
			.update(schema.pipelinePrompts)
			.set({
				defaultForSpecs: (shipped.defaultForSpecs as string[]).map(
					renamedBack
				)
			})
			.where(eq(schema.pipelinePrompts.id, shipped.id))
		staged.myPrompt = (
			await db
				.insert(schema.pipelinePrompts)
				.values({
					nodeDefinitionId: "core:task/assemble",
					slot: "prompts",
					name: "My loop",
					defaultForSpecs: ["core:spec/narrate"],
					fields: { system: "mine" }
				})
				.returning()
		)[0]!.id

		// An admin's switched-off swap.
		await db.insert(schema.plugins).values({
			pluginId: "acme.swaps",
			name: "Swaps",
			bundleSource: "",
			bundleHash: "x",
			disabledSwaps: [
				"core:spec/respond#speaker#core:task/turn-round-robin@1",
				"acme:spec/respond#speaker#core:task/turn-round-robin@1"
			]
		})

		// tool-loop, which this build no longer seeds.
		const [loop] = await db
			.insert(schema.pipelineSpecs)
			.values({ slug: TOOL_LOOP, name: "Tool loop" })
			.returning()
		await db.insert(schema.pipelineConfigs).values({
			specId: loop!.id,
			seedKey: `pipeline-default:${TOOL_LOOP}`,
			name: "Tool loop",
			isImmutable: true,
			isDefault: true
		})
		await db.insert(schema.pipelinePrompts).values({
			nodeDefinitionId: "core:task/assemble",
			slot: "prompts",
			seedKey: TOOL_LOOP_PROMPT_KEY,
			name: "Tool loop",
			isImmutable: true,
			createdForSpecId: loop!.id,
			defaultForSpecs: [TOOL_LOOP],
			fields: { system: "loop" }
		})
	}, 240_000)

	it("boots onto the new ids, on the same rows, with nothing seeded twice", async () => {
		const report = await bootstrap(db)
		expect(report.specSlugRename?.renamed).toHaveLength(10)
		expect(report.specSlugRename?.merged).toEqual([])

		// The rows: same ids, new slugs, no old slug left, none added.
		for (const [old, renamed] of SPEC_SLUG_RENAMES) {
			expect((await specRow(db, renamed))?.id, renamed).toBe(ids[renamed])
			expect(await specRow(db, old), old).toBeUndefined()
		}
		const specs = await db.select().from(schema.pipelineSpecs)
		expect(specs).toHaveLength(specCount)

		// One shipped default per spec, under the new key.
		const shipped = await db
			.select()
			.from(schema.pipelineConfigs)
			.where(like(schema.pipelineConfigs.seedKey, "pipeline-default:%"))
		const perSpec = new Map<number, number>()
		for (const c of shipped)
			perSpec.set(c.specId, (perSpec.get(c.specId) ?? 0) + 1)
		expect([...perSpec.values()].every((n) => n === 1)).toBe(true)
		for (const [old, renamed] of SPEC_SLUG_RENAMES) {
			expect(
				shipped.some((c) => c.seedKey === `pipeline-default:${old}`)
			).toBe(false)
			expect(
				shipped.find((c) => c.seedKey === `pipeline-default:${renamed}`)
					?.specId,
				renamed
			).toBe(ids[renamed])
		}

		// C5: "Default", except beside a person's own "Default".
		const respond = ids["core:spec/chat-respond"]!
		for (const c of shipped)
			expect(c.name, c.seedKey!).toBe(
				c.specId === respond ? "Default 2" : "Default"
			)
		const [mine] = await db
			.select()
			.from(schema.pipelineConfigs)
			.where(eq(schema.pipelineConfigs.id, staged.mine!))
		expect(mine).toMatchObject({
			name: "Default",
			seedKey: null,
			specId: respond
		})

		// The person's settings, where they were, with their values.
		const [tuned] = await db
			.select()
			.from(schema.pipelineConfigs)
			.where(eq(schema.pipelineConfigs.id, staged.tuned!))
		expect(tuned).toMatchObject({
			specId: respond,
			name: "My tuning",
			includedActions: ["core:spec/chat-narrate#narrate"]
		})
		const values = await db
			.select()
			.from(schema.pipelineConfigValues)
			.where(eq(schema.pipelineConfigValues.configId, staged.tuned!))
		// (Beside the values the reconcile back-fills from the shipped default.)
		expect(values).toContainEqual(
			expect.objectContaining({
				nodeKey: param.nodeKey,
				slot: param.slot,
				path: param.path,
				value: param.value
			})
		)
		const [migrated] = await db
			.select()
			.from(schema.pipelineConfigs)
			.where(eq(schema.pipelineConfigs.id, staged.migrated!))
		expect(migrated!.seedKey).toBe("migrated:core:spec/chat-respond:7")
		expect(
			await db
				.select({ configId: schema.pipelineConfigSelections.configId })
				.from(schema.pipelineConfigSelections)
				.where(
					and(
						eq(schema.pipelineConfigSelections.specId, respond),
						eq(schema.pipelineConfigSelections.scopeId, sessionId)
					)
				)
		).toEqual([{ configId: staged.tuned }])
		expect(
			(
				await db
					.select()
					.from(schema.pipelineNodeOverrides)
					.where(eq(schema.pipelineNodeOverrides.scopeId, sessionId))
			).map((o) => [o.specId, o.nodeKey, o.value])
		).toEqual([[respond, param.nodeKey, param.value + 1]])
		expect(
			(
				await db
					.select()
					.from(schema.pipelineNodeRebinds)
					.where(eq(schema.pipelineNodeRebinds.scopeId, sessionId))
			).map((r) => [r.specId, r.nodeKey])
		).toEqual([[respond, "generate"]])

		// The identities.
		const [binding] = await db
			.select()
			.from(schema.pipelineBindings)
			.where(eq(schema.pipelineBindings.scopeId, sessionId))
		expect(binding).toMatchObject({
			subject: "core:spec/chat-narrate#narrate",
			specId: ids["core:spec/chat-narrate"],
			enabledWhen: [
				{
					on: "turn.subject",
					equals: "core:spec/chat-narrate#narrate",
					reason: "Not now"
				}
			]
		})
		expect(
			(
				await db
					.select()
					.from(schema.sessionFunctions)
					.where(eq(schema.sessionFunctions.sessionId, sessionId))
			).map((f) => f.functionKey)
		).toEqual(["core:spec/chat-narrate#narrate"])
		expect(
			(
				await db
					.select()
					.from(schema.seenActions)
					.where(eq(schema.seenActions.userId, userId))
			)
				.map((s) => s.actionKey)
				.sort()
		).toEqual([
			"core:spec/chat-generate-image#generate-image",
			"core:spec/chat-side-character#narrate-character"
		])

		// The presets.
		const presets = await db
			.select()
			.from(schema.sessionPresets)
			.where(
				inArray(schema.sessionPresets.id, [
					staged.corePreset!,
					staged.myPreset!
				])
			)
		const core = presets.find((p) => p.id === staged.corePreset)!
		const specsBound = Object.values(core.bindings).map((b) => b.spec)
		expect(specsBound).toContain("core:spec/chat-create")
		expect(specsBound).toContain("core:spec/chat-respond")
		const minePreset = presets.find((p) => p.id === staged.myPreset)!
		expect(minePreset).toMatchObject({
			primarySlug: "core:spec/chat-respond",
			bindings: {
				"core:event/message-respond@1": {
					spec: "core:spec/chat-respond",
					config: staged.tuned
				}
			},
			// A key under both ids keeps the new one's choice.
			configSelections: {
				"core:spec/chat-respond": staged.tuned,
				"core:spec/chat-narrate": 2
			},
			includedActions: ["core:spec/chat-narrate#narrate", "narrate"],
			defaults: {
				envoys: ["core.mascot"],
				swaps: [
					{
						spec: "core:spec/chat-respond",
						node: "speaker",
						definition: "core:task/turn-round-robin@1"
					}
				]
			}
		})
		const notices = await db
			.select()
			.from(schema.sessionPresetNotices)
			.where(eq(schema.sessionPresetNotices.presetId, staged.myPreset!))
		expect(notices.map((n) => [n.boundSpec, n.fallbackSpec])).toEqual([
			["core:spec/chat-respond", "core:spec/chat-respond"]
		])
		// The core preset's bindings resolve again, so it carries no notice.
		expect(
			await db
				.select()
				.from(schema.sessionPresetNotices)
				.where(
					eq(schema.sessionPresetNotices.presetId, staged.corePreset!)
				)
		).toEqual([])

		// Prompts and the plugin's swaps.
		const prompts = await db
			.select()
			.from(schema.pipelinePrompts)
			.where(
				inArray(schema.pipelinePrompts.id, [
					staged.shippedPrompt!,
					staged.myPrompt!
				])
			)
		expect(
			prompts.find((p) => p.id === staged.shippedPrompt)!.defaultForSpecs
		).toContain("core:spec/chat-respond")
		expect(
			prompts.find((p) => p.id === staged.myPrompt)!.defaultForSpecs
		).toEqual(["core:spec/chat-narrate"])
		const [plugin] = await db
			.select()
			.from(schema.plugins)
			.where(eq(schema.plugins.pluginId, "acme.swaps"))
		expect(plugin!.disabledSwaps).toEqual([
			"core:spec/chat-respond#speaker#core:task/turn-round-robin@1",
			"acme:spec/respond#speaker#core:task/turn-round-robin@1"
		])

		// tool-loop is gone: spec, shipped config, shipped prompt. A
		// person's prompt in the same pool stays.
		expect(await specRow(db, TOOL_LOOP)).toBeUndefined()
		expect(
			await db
				.select()
				.from(schema.pipelineConfigs)
				.where(
					eq(
						schema.pipelineConfigs.seedKey,
						`pipeline-default:${TOOL_LOOP}`
					)
				)
		).toEqual([])
		expect(
			await db
				.select()
				.from(schema.pipelinePrompts)
				.where(eq(schema.pipelinePrompts.seedKey, TOOL_LOOP_PROMPT_KEY))
		).toEqual([])
		expect(prompts.some((p) => p.id === staged.myPrompt)).toBe(true)
	}, 240_000)

	it("a second boot changes nothing", async () => {
		const before = await snapshot(db)
		const report = await bootstrap(db)
		expect(report.specSlugRename).toEqual({
			renamed: [],
			merged: [],
			rewritten: 0,
			defaultsRenamed: 0
		})
		expect(await snapshot(db)).toEqual(before)
	}, 240_000)

	it("names a newly seeded default 'Default' without clashing with a person's", async () => {
		const slug = "core:spec/chat-generate-image"
		const specId = ids[slug]!
		await db
			.delete(schema.pipelineConfigs)
			.where(
				eq(schema.pipelineConfigs.seedKey, `pipeline-default:${slug}`)
			)
		const [person] = await db
			.insert(schema.pipelineConfigs)
			.values({ specId, name: "Default" })
			.returning()
		const { reconcilePublishedConfigs } = await import("./seed")
		await reconcilePublishedConfigs(db)
		const rows = await db
			.select()
			.from(schema.pipelineConfigs)
			.where(eq(schema.pipelineConfigs.specId, specId))
		expect(rows.find((r) => r.id === person!.id)!.name).toBe("Default")
		expect(
			rows.find((r) => r.seedKey === `pipeline-default:${slug}`)
		).toMatchObject({
			name: "Default 2",
			isImmutable: true,
			isDefault: true
		})
	}, 120_000)

	describe("a database that booted this build before the pass existed", () => {
		const OLD_NARRATE = "core:spec/narrate"
		const NEW_NARRATE = "core:spec/chat-narrate"
		const m: Record<string, number> = {}

		it("merges the old row into the new one, the new one winning a shared address", async () => {
			const into = (await specRow(db, NEW_NARRATE))!
			const intoActive = into.activeVersionId
			const narrateParam = await numericParam(db, NEW_NARRATE)
			const [s1] = await db
				.insert(schema.sessions)
				.values({ userId, isGroup: false, name: "merge one" })
				.returning()
			const [s2] = await db
				.insert(schema.sessions)
				.values({ userId, isGroup: false, name: "merge two" })
				.returning()

			// The old row, with a version, its shipped default and a person's
			// settings, beside the new row this build already published.
			const [from] = await db
				.insert(schema.pipelineSpecs)
				.values({ slug: OLD_NARRATE, name: "World narration" })
				.returning()
			const [version] = await db
				.insert(schema.pipelineSpecVersions)
				.values({
					specId: from!.id,
					semver: "1.10.0",
					status: "published",
					canonicalHash: "pre-rename-narrate"
				})
				.returning()
			await db
				.update(schema.pipelineSpecs)
				.set({ activeVersionId: version!.id })
				.where(eq(schema.pipelineSpecs.id, from!.id))
			m.version = version!.id
			await db.insert(schema.pipelineConfigs).values({
				specId: from!.id,
				seedKey: `pipeline-default:${OLD_NARRATE}`,
				name: "World narration",
				isImmutable: true,
				isDefault: true
			})
			const [mineDefault] = await db
				.insert(schema.pipelineConfigs)
				.values({ specId: from!.id, name: "Default" })
				.returning()
			m.mineDefault = mineDefault!.id
			await db.insert(schema.pipelineConfigValues).values({
				configId: mineDefault!.id,
				nodeKey: narrateParam.nodeKey,
				slot: narrateParam.slot,
				path: narrateParam.path,
				value: narrateParam.value
			})
			const [oldNight] = await db
				.insert(schema.pipelineConfigs)
				.values({ specId: from!.id, name: "Night" })
				.returning()
			m.oldNight = oldNight!.id
			const [newNight] = await db
				.insert(schema.pipelineConfigs)
				.values({ specId: into.id, name: "Night" })
				.returning()
			m.newNight = newNight!.id
			// Selections: s1 only on the old row; s2 on both.
			await db.insert(schema.pipelineConfigSelections).values([
				{
					specId: from!.id,
					scopeKind: "session",
					scopeId: s1!.id,
					configId: mineDefault!.id
				},
				{
					specId: from!.id,
					scopeKind: "session",
					scopeId: s2!.id,
					configId: oldNight!.id
				},
				{
					specId: into.id,
					scopeKind: "session",
					scopeId: s2!.id,
					configId: newNight!.id
				}
			])
			// Overrides: one address on both rows, one only on the old.
			const at = (specId: number, path: string, value: unknown) => ({
				specId,
				scopeKind: "session",
				scopeId: s1!.id,
				nodeKey: narrateParam.nodeKey,
				slot: narrateParam.slot,
				path,
				value: value as any
			})
			await db
				.insert(schema.pipelineNodeOverrides)
				.values([
					at(from!.id, narrateParam.path, 1),
					at(into.id, narrateParam.path, 2),
					at(from!.id, `${narrateParam.path}.other`, 3)
				])
			await db.insert(schema.pipelineNodeRebinds).values({
				specId: from!.id,
				scopeKind: "session",
				scopeId: s1!.id,
				nodeKey: "k1",
				definitionId: "core:task/x@1"
			})
			// The same action bound under both ids for one session.
			await db.insert(schema.pipelineBindings).values([
				{
					scopeKind: "session",
					scopeId: s2!.id,
					genreId: CHAT,
					subject: `${OLD_NARRATE}#narrate`,
					specId: from!.id
				},
				{
					scopeKind: "session",
					scopeId: s2!.id,
					genreId: CHAT,
					subject: `${NEW_NARRATE}#narrate`,
					specId: into.id
				}
			])
			const [prompt] = await db
				.insert(schema.pipelinePrompts)
				.values({
					nodeDefinitionId: "core:task/build-template-context",
					slot: "prompts",
					name: "Merged narrator",
					createdForSpecId: from!.id,
					fields: {}
				})
				.returning()
			m.prompt = prompt!.id

			const report = await renameSpecSlugs(db)
			expect(report.merged).toEqual([`${OLD_NARRATE} → ${NEW_NARRATE}`])
			expect(report.renamed).toEqual([])

			expect(await specRow(db, OLD_NARRATE)).toBeUndefined()
			const after = (await specRow(db, NEW_NARRATE))!
			expect(after.id).toBe(into.id)
			expect(after.activeVersionId).toBe(intoActive)
			const [moved] = await db
				.select()
				.from(schema.pipelineSpecVersions)
				.where(eq(schema.pipelineSpecVersions.id, m.version!))
			expect(moved).toMatchObject({ specId: into.id, status: "retired" })

			const configs = await db
				.select()
				.from(schema.pipelineConfigs)
				.where(eq(schema.pipelineConfigs.specId, into.id))
			const byId = new Map(configs.map((c) => [c.id, c]))
			expect(byId.get(m.mineDefault!)?.name).toBe("Default")
			expect(byId.get(m.newNight!)?.name).toBe("Night")
			expect(byId.get(m.oldNight!)?.name).toBe("Night 2")
			const shipped = configs.filter((c) =>
				c.seedKey?.startsWith("pipeline-default:")
			)
			expect(shipped.map((c) => [c.seedKey, c.name])).toEqual([
				[`pipeline-default:${NEW_NARRATE}`, "Default 2"]
			])
			expect(
				await db
					.select()
					.from(schema.pipelineConfigValues)
					.where(
						eq(schema.pipelineConfigValues.configId, m.mineDefault!)
					)
			).toEqual([
				expect.objectContaining({
					nodeKey: narrateParam.nodeKey,
					value: narrateParam.value
				})
			])

			const selections = await db
				.select()
				.from(schema.pipelineConfigSelections)
				.where(
					inArray(schema.pipelineConfigSelections.scopeId, [
						s1!.id,
						s2!.id
					])
				)
			expect(
				selections.map((s) => [s.specId, s.scopeId, s.configId]).sort()
			).toEqual(
				[
					[into.id, s1!.id, m.mineDefault],
					[into.id, s2!.id, m.newNight]
				].sort()
			)
			const overrides = await db
				.select()
				.from(schema.pipelineNodeOverrides)
				.where(eq(schema.pipelineNodeOverrides.scopeId, s1!.id))
			expect(
				overrides.map((o) => [o.specId, o.path, o.value]).sort()
			).toEqual(
				[
					[into.id, narrateParam.path, 2],
					[into.id, `${narrateParam.path}.other`, 3]
				].sort()
			)
			expect(
				(
					await db
						.select()
						.from(schema.pipelineNodeRebinds)
						.where(eq(schema.pipelineNodeRebinds.scopeId, s1!.id))
				).map((r) => r.specId)
			).toEqual([into.id])
			expect(
				(
					await db
						.select()
						.from(schema.pipelineBindings)
						.where(eq(schema.pipelineBindings.scopeId, s2!.id))
				).map((b) => [b.subject, b.specId])
			).toEqual([[`${NEW_NARRATE}#narrate`, into.id]])
			const [p] = await db
				.select()
				.from(schema.pipelinePrompts)
				.where(eq(schema.pipelinePrompts.id, m.prompt!))
			expect(p!.createdForSpecId).toBe(into.id)
		}, 120_000)

		it("and the boot after it seeds nothing beside the merged row", async () => {
			const before = (await db.select().from(schema.pipelineSpecs)).length
			const report = await bootstrap(db)
			expect(report.specSlugRename).toMatchObject({
				renamed: [],
				merged: [],
				rewritten: 0
			})
			expect((await db.select().from(schema.pipelineSpecs)).length).toBe(
				before
			)
			expect(await specRow(db, OLD_NARRATE)).toBeUndefined()
		}, 240_000)
	})
})

/** The old spelling of every new id in a string — the inverse, for staging. */
function renamedBack(value: string): string {
	for (const [renamed, old] of Object.entries(OLD))
		if (value === renamed || value.endsWith(`:${renamed}`))
			return value.slice(0, value.length - renamed.length) + old
	return value
}
