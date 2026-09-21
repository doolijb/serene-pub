/**
 * Migration 0135 — weights to the source (plans/30 §U3b; R-7 P5) — against
 * a database built from the shipped seeds.
 *
 * ## The fixture
 *
 * `bootstrapPipelines` on a fresh test database publishes the shipped specs
 * (every migration, 0135 included, has already run on empty tables — a data
 * move over nothing). The pre-migration state is then written by hand at the
 * addresses the ranker used to own: a tuned `respond` configuration carrying
 * the three five-band maps with deviations, a collision at an owner's new
 * path, a session override of the `share` map, an `adventure-respond`
 * configuration raising a band that pipeline has no source for, a `respond`
 * configuration raising the graph's share beside a ceiling of 0 (W2), a
 * `narrate` configuration tuning a lore band that pipeline scans through ONE
 * node (W1), and a spec of this file's own with TWO ranker nodes both holding
 * a map (W3). Then 0135's statements run again, as the migrator would run
 * them, against those rows.
 *
 * ## What is proved
 *
 * Every member of every map lands where the law puts it: a deviation moves to
 * the node that owns the band (config rows and session overrides alike) with a
 * `backfilled` notice on the owner's address — on a one-node scan under the
 * band's namespaced field; a member holding the shipped number is swept
 * without a notice, as `reconcileConfigs` sweeps an inert row, and so is the
 * graph's ceiling of 0 behind a share of 0, the pair every saved map carried;
 * a member with no owner in the spec, a floor on a lore band (R6), and a
 * relationships ceiling of 0 behind a RAISED share are `culled` with a notice
 * carrying the value; an owner that already held a row wins and the loser is
 * noticed; two rankers claiming one address leave one row and one notice
 * naming the winner; the ranker's rows are gone. And the defaults reproduce
 * today's effective numbers: what the definitions declare IS the ranker's
 * fallback table, member for member, so a person who tuned nothing sees the
 * same split — the parity corpus holds the bytes, this holds the numbers.
 */
import { describe, it, expect, beforeAll } from "vitest"
import fs from "fs"
import path from "path"
import { and, eq } from "drizzle-orm"
import { sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import { bootstrapPipelines } from "$lib/server/pipelines/boot/bootstrap"
import { saveDocument } from "$lib/server/pipelines/boot/store"
import { RESPOND_SPEC_ID } from "$lib/server/pipelines/specs/respond"
import {
	DEFAULT_GROUPS,
	bandsFromIntents
} from "$lib/server/pipelines/ranking/weights"
import * as C from "@serene-pub/contracts"
import { compile, spec, slot, resolveConfigSources } from "@serene-pub/sdk"

const MIGRATION = path.resolve(
	process.cwd(),
	"drizzle/0135_weights_to_the_source.sql"
)
const JOURNAL = path.resolve(process.cwd(), "drizzle/meta/_journal.json")

const statementsOf = (file: string): string[] =>
	fs
		.readFileSync(file, "utf8")
		.split("--> statement-breakpoint")
		.map((s) => s.trim())
		.filter((s) => s.length && !/^(--[^\n]*\n?)+$/.test(s))

/** The node keys the shipped `respond` document gives the five sources. */
const OWNER = {
	messages: "gather.history.read",
	worldLore: "gather.worldLore.read",
	characterLore: "gather.characterLore.read",
	history: "gather.historyEntries.read",
	relationships: "gather.relationships.read"
} as const

/**
 * A spec with TWO ranker nodes (W3) — the shape the review found aborted the
 * whole migration: `src` joins every ranker, §3 inserted one row per moved
 * member, and two rankers moving the same member collided on the address
 * index inside the transaction. Published under a slug of this file's own so
 * the shipped specs stay what they are.
 */
const TWO_RANKERS = "test:spec/two-rankers"
const twoRankers = () =>
	compile(
		spec(TWO_RANKERS, { version: "1.0.0" })
			.inlet("input", C.userMessage.v1())
			.query("worldLore", ($) =>
				C.worldLore.v1({
					scope: $.input.sessionScope,
					params: slot.params()
				})
			)
			.task("contextBudget", ($) =>
				C.contextBudget.v1({ params: slot.params() })
			)
			.task("first", ($) =>
				C.rankHybrid.v1({
					candidates: $.worldLore.main,
					budget: $.contextBudget.available,
					params: slot.params()
				})
			)
			.task("second", ($) =>
				C.rankHybrid.v1({
					candidates: $.first.candidates,
					budget: $.contextBudget.available,
					params: slot.params()
				})
			)
			.build()
	)

let db: TestDb
let respondSpecId: number
let adventureSpecId: number
let narrateSpecId: number
let tuned: number
let adventureTuned: number
/** `respond`, the graph's share raised beside a ceiling of 0 (W2). */
let graphTuned: number
/** `narrate`, a lore band tuned on a pipeline that scans through one node (W1). */
let narrateTuned: number
/** The two-ranker spec's configuration (W3). */
let twoRankersTuned: number
const SESSION = 4242
const NARRATE_SESSION = 4343

const valuesAt = (configId: number, nodeKey: string) =>
	db
		.select()
		.from(schema.pipelineConfigValues)
		.where(
			and(
				eq(schema.pipelineConfigValues.configId, configId),
				eq(schema.pipelineConfigValues.nodeKey, nodeKey)
			)
		)

const noticesOf = (configId: number) =>
	db
		.select()
		.from(schema.pipelineConfigNotices)
		.where(eq(schema.pipelineConfigNotices.configId, configId))

beforeAll(async () => {
	db = await createTestDb()
	await bootstrapPipelines(db)

	const specId = async (slug: string) =>
		(
			await db
				.select({ id: schema.pipelineSpecs.id })
				.from(schema.pipelineSpecs)
				.where(eq(schema.pipelineSpecs.slug, slug))
		)[0]!.id
	respondSpecId = await specId(RESPOND_SPEC_ID)
	adventureSpecId = await specId("core:spec/adventure-respond")
	narrateSpecId = await specId("core:spec/narrate")

	// A tuned configuration for `respond`, carrying the three maps as the
	// panel stored them: whole objects, most members at the shipped number.
	;[{ id: tuned }] = await db
		.insert(schema.pipelineConfigs)
		.values({ specId: respondSpecId, name: "Tuned", isImmutable: false })
		.returning({ id: schema.pipelineConfigs.id })
	await db.insert(schema.pipelineConfigValues).values([
		{
			configId: tuned,
			nodeKey: "rank",
			slot: "params",
			path: "share",
			// worldLore raised, history lowered, the rest as shipped.
			value: {
				messages: 0.5,
				worldLore: 0.3,
				characterLore: 0.1667,
				history: 0.0333,
				relationships: 0
			}
		},
		{
			configId: tuned,
			nodeKey: "rank",
			slot: "params",
			path: "maxEntries",
			// Every member at the shipped number — including the
			// relationships 0 that must NOT become the query's own 0, and
			// must not be noticed either (W2): this is the map every saved
			// configuration carries, and its share.relationships is 0.
			value: {
				messages: 50,
				worldLore: 20,
				characterLore: 15,
				history: 10,
				relationships: 0
			}
		},
		{
			configId: tuned,
			nodeKey: "rank",
			slot: "params",
			path: "minEntries",
			// A raised conversation floor, and a lore floor R6 forbids.
			value: { messages: 8, worldLore: 2 }
		},
		// The collision: the owner already holds a `share` (a half-migrated
		// install, or a person who set it on the new build before upgrading
		// the rows). The owner's wins.
		{
			configId: tuned,
			nodeKey: OWNER.worldLore,
			slot: "params",
			path: "share",
			value: 0.25
		}
	])

	// A session's override of the same map, resolving through the tuned
	// configuration.
	await db.insert(schema.pipelineConfigSelections).values({
		specId: respondSpecId,
		scopeKind: "session",
		scopeId: SESSION,
		configId: tuned
	})
	await db.insert(schema.pipelineNodeOverrides).values({
		specId: respondSpecId,
		scopeKind: "session",
		scopeId: SESSION,
		nodeKey: "rank",
		slot: "params",
		path: "share",
		value: {
			messages: 0.5,
			worldLore: 0.4,
			characterLore: 0.1667,
			history: 0.1666,
			relationships: 0
		}
	})

	// `adventure-respond` ranks three lore bands and no relationships: a
	// raised relationships share there has nowhere to go.
	;[{ id: adventureTuned }] = await db
		.insert(schema.pipelineConfigs)
		.values({
			specId: adventureSpecId,
			name: "Adventure tuned",
			isImmutable: false
		})
		.returning({ id: schema.pipelineConfigs.id })
	await db.insert(schema.pipelineConfigValues).values({
		configId: adventureTuned,
		nodeKey: "rank",
		slot: "params",
		path: "share",
		value: { relationships: 0.2, worldLore: 0.2 }
	})

	// W2 · the graph's share raised beside the ceiling of 0 every saved map
	// carried: the one case the old cap changed an outcome (every relationship
	// left as over its ceiling), so it is culled with a notice that says so —
	// where `tuned`'s identical 0 behind a share of 0 is swept in silence.
	;[{ id: graphTuned }] = await db
		.insert(schema.pipelineConfigs)
		.values({ specId: respondSpecId, name: "Graph tuned", isImmutable: false })
		.returning({ id: schema.pipelineConfigs.id })
	await db.insert(schema.pipelineConfigValues).values([
		{
			configId: graphTuned,
			nodeKey: "rank",
			slot: "params",
			path: "share",
			value: { relationships: 0.2 }
		},
		{
			configId: graphTuned,
			nodeKey: "rank",
			slot: "params",
			path: "maxEntries",
			value: { relationships: 0 }
		}
	])

	// W1 · `narrate` scans through one `lorebook-triggers` node (`lore`): a
	// tuned lore band on its ranker has that node as its owner, under the
	// band's namespaced field. A session selects it so the moved row can be
	// shown resolving.
	;[{ id: narrateTuned }] = await db
		.insert(schema.pipelineConfigs)
		.values({ specId: narrateSpecId, name: "Narrate tuned", isImmutable: false })
		.returning({ id: schema.pipelineConfigs.id })
	await db.insert(schema.pipelineConfigValues).values([
		{
			configId: narrateTuned,
			nodeKey: "rank",
			slot: "params",
			path: "share",
			// worldLore raised; history at the shipped number; and the
			// `relationships: 0` every saved map carries, on a pipeline with
			// no graph read to own it — swept, not "no source" (the ranker's
			// fallback held that same 0).
			value: { worldLore: 0.3, history: 0.1666, relationships: 0 }
		},
		{
			configId: narrateTuned,
			nodeKey: "rank",
			slot: "params",
			path: "maxEntries",
			value: { history: 4 }
		},
		{
			configId: narrateTuned,
			nodeKey: "rank",
			slot: "params",
			path: "minEntries",
			// A lore floor: R6 holds on the one-node scan as on the lanes.
			value: { characterLore: 2 }
		}
	])
	const [user] = await db
		.insert(schema.users)
		.values({ username: "weights-to-source", isAdmin: false })
		.returning()
	await db
		.insert(schema.sessions)
		.values({ id: NARRATE_SESSION, userId: user!.id, isGroup: false })
	await db.insert(schema.pipelineConfigSelections).values({
		specId: narrateSpecId,
		scopeKind: "session",
		scopeId: NARRATE_SESSION,
		configId: narrateTuned
	})

	// W3 · two rankers, one member each, one address between them.
	const saved = await saveDocument(db, twoRankers(), { publish: true })
	;[{ id: twoRankersTuned }] = await db
		.insert(schema.pipelineConfigs)
		.values({ specId: saved.specId, name: "Two rankers", isImmutable: false })
		.returning({ id: schema.pipelineConfigs.id })
	await db.insert(schema.pipelineConfigValues).values([
		{
			configId: twoRankersTuned,
			nodeKey: "first",
			slot: "params",
			path: "share",
			value: { worldLore: 0.3 }
		},
		{
			configId: twoRankersTuned,
			nodeKey: "second",
			slot: "params",
			path: "share",
			value: { worldLore: 0.4 }
		}
	])

	for (const stmt of statementsOf(MIGRATION)) await db.execute(sql.raw(stmt))
}, 120_000)

describe("the journal", () => {
	it("carries 0135 above every applied index, so it is not skipped", () => {
		const journal = JSON.parse(fs.readFileSync(JOURNAL, "utf8")) as {
			entries: Array<{ idx: number; tag: string }>
		}
		const at = journal.entries.findIndex(
			(e) => e.tag === "0135_weights_to_the_source"
		)
		expect(at).toBeGreaterThan(0)
		// Above everything applied BEFORE it — a lower index is silently
		// skipped. Not "the journal's max": later migrations (0136 …) land
		// above it on the same terms, and this line must not break on each.
		const before = journal.entries.slice(0, at).map((e) => e.idx)
		expect(journal.entries[at]!.idx).toBeGreaterThan(Math.max(...before))
		// And the whole journal keeps that order, so none of them is skipped.
		for (let i = 1; i < journal.entries.length; i++)
			expect(journal.entries[i]!.idx).toBeGreaterThan(
				journal.entries[i - 1]!.idx
			)
	})
})

describe("configuration rows move to the source that owns the band", () => {
	it("re-homes a deviation on the owner, with a backfilled notice naming both addresses", async () => {
		// history's share was 0.0333 on the ranker; it is the history lane's now.
		const history = await valuesAt(tuned, OWNER.history)
		expect(history.map((r) => [r.path, r.value])).toEqual([["share", 0.0333]])
		// The conversation's minimum of 8, on the node that produces the conversation.
		const conversation = await valuesAt(tuned, OWNER.messages)
		expect(conversation.map((r) => [r.path, r.value])).toEqual([
			["minEntries", 8]
		])

		// The configuration's own; the session's ride the same table and are
		// asserted below.
		const backfilled = (await noticesOf(tuned)).filter(
			(n) => n.kind === "backfilled" && !/^session /.test(n.label ?? "")
		)
		expect(
			backfilled.map((n) => [n.nodeKey, n.path, n.previousValue]).sort()
		).toEqual(
			[
				[OWNER.history, "share", 0.0333],
				[OWNER.messages, "minEntries", 8]
			].sort()
		)
		for (const n of backfilled) {
			expect(n.label).toMatch(/^rank\/(share|minEntries)\.\w+ → gather\./)
			expect(n.label).toMatch(/R-7 P5/)
		}
	})

	it("sweeps a member holding the shipped number — no row, no notice", async () => {
		// messages 0.5, characterLore 0.1667, relationships 0; every ceiling.
		expect(await valuesAt(tuned, OWNER.characterLore)).toEqual([])
		expect(
			(await valuesAt(tuned, OWNER.messages)).map((r) => r.path)
		).not.toContain("share")
		expect(
			(await valuesAt(tuned, OWNER.messages)).map((r) => r.path)
		).not.toContain("maxEntries")
		const notices = await noticesOf(tuned)
		expect(
			notices.filter(
				(n) => n.path === "maxEntries" && /\.(messages|worldLore|characterLore|history)\b/.test(n.label ?? "")
			)
		).toEqual([])
		expect(
			notices.filter((n) => /share\.(messages|characterLore|relationships)\b/.test(n.label ?? ""))
		).toEqual([])
	})

	it("lets the owner win a collision, and notices the loser with its value", async () => {
		const world = await valuesAt(tuned, OWNER.worldLore)
		expect(world.map((r) => [r.path, r.value])).toEqual([["share", 0.25]])
		const culled = (await noticesOf(tuned)).find(
			(n) => n.kind === "culled" && /share\.worldLore/.test(n.label ?? "")
		)
		expect(culled).toBeTruthy()
		expect(culled!.nodeKey).toBe("rank")
		expect(culled!.previousValue).toBe(0.3)
		expect(culled!.label).toMatch(/already held a value/)
	})

	it("culls a lore floor (R6), saying why", async () => {
		const culled = (await noticesOf(tuned)).filter((n) => n.kind === "culled")
		const floor = culled.find((n) => /minEntries\.worldLore/.test(n.label ?? ""))
		expect(floor).toBeTruthy()
		expect(floor!.previousValue).toBe(2)
		expect(floor!.label).toMatch(/declares no floor/)
	})

	it("sweeps the graph's ceiling of 0 behind a share of 0 in silence — the pair every saved map carried (W2)", async () => {
		// `tuned` stored the shipped map whole: share.relationships 0 and
		// maxEntries.relationships 0. A cap of nothing behind a share of
		// nothing changed no outcome, so it is no more a deviation than the
		// other four ceilings are — no row on the graph read, no notice.
		expect(await valuesAt(tuned, OWNER.relationships)).toEqual([])
		expect(
			(await noticesOf(tuned)).filter((n) =>
				/maxEntries\.relationships/.test(n.label ?? "")
			)
		).toEqual([])
	})

	it("culls the graph's ceiling of 0 behind a RAISED share, saying what it did and what happens now (W2)", async () => {
		// The share moves; the ceiling that used to nullify it does not.
		expect(
			(await valuesAt(graphTuned, OWNER.relationships)).map((r) => [r.path, r.value])
		).toEqual([["share", 0.2]])
		const cap = (await noticesOf(graphTuned)).find(
			(n) => n.kind === "culled" && /maxEntries\.relationships/.test(n.label ?? "")
		)
		expect(cap).toBeTruthy()
		expect(cap!.nodeKey).toBe("rank")
		expect(cap!.previousValue).toBe(0)
		expect(cap!.label).toMatch(/kept every relationship out over its ceiling, behind a share of 0\.2/)
		expect(cap!.label).toMatch(/would switch the source off/)
		expect(cap!.label).toMatch(/the graph now competes for its share/)
		expect(await valuesAt(graphTuned, "rank")).toEqual([])
	})

	it("culls a member whose band has no source in that pipeline", async () => {
		// adventure-respond ranks no relationships; its worldLore share moves.
		const notices = await noticesOf(adventureTuned)
		const noHome = notices.find((n) => /share\.relationships/.test(n.label ?? ""))
		expect(noHome?.kind).toBe("culled")
		expect(noHome!.label).toMatch(/no relationships source in this pipeline/)
		expect(noHome!.previousValue).toBe(0.2)
		expect(
			(await valuesAt(adventureTuned, OWNER.worldLore)).map((r) => [r.path, r.value])
		).toEqual([["share", 0.2]])
	})

	it("leaves nothing at the ranker's old addresses", async () => {
		for (const configId of [tuned, adventureTuned, graphTuned, narrateTuned])
			expect(await valuesAt(configId, "rank")).toEqual([])
		for (const rankKey of ["first", "second"])
			expect(await valuesAt(twoRankersTuned, rankKey)).toEqual([])
	})
})

describe("a pipeline that scans through one node owns its three lore bands there (W1)", () => {
	it("moves a tuned lore share on narrate's ranker to the `lorebook-triggers` node, under the band's namespaced field", async () => {
		// `narrate` has no world-lore lane; `lore` produces all three bands
		// and declares an intent per band — `worldLoreShare`,
		// `historyMaxEntries` … — so that is where the members go.
		const lore = await valuesAt(narrateTuned, "lore")
		expect(lore.map((r) => [r.path, r.value]).sort()).toEqual(
			[
				["worldLoreShare", 0.3],
				["historyMaxEntries", 4]
			].sort()
		)
		const notices = await noticesOf(narrateTuned)
		const moved = notices.filter((n) => n.kind === "backfilled")
		expect(moved.map((n) => [n.nodeKey, n.path, n.previousValue]).sort()).toEqual(
			[
				["lore", "worldLoreShare", 0.3],
				["lore", "historyMaxEntries", 4]
			].sort()
		)
		expect(moved.find((n) => n.path === "worldLoreShare")!.label).toMatch(
			/^rank\/share\.worldLore → lore\/worldLoreShare — the worldLore source now declares its own share/
		)
		// history's share at the shipped number was swept; the lore floor is
		// culled on the scan node's terms too (R6).
		expect(notices.filter((n) => /share\.history\b/.test(n.label ?? ""))).toEqual([])
		const floor = notices.find((n) => n.kind === "culled" && /minEntries\.characterLore/.test(n.label ?? ""))
		expect(floor).toBeTruthy()
		expect(floor!.previousValue).toBe(2)
		expect(floor!.label).toMatch(/declares no floor/)
		// Nothing was left with "no source in this pipeline": every lore band
		// HAS one here, and the graph's shipped 0 — which has none — is swept
		// in silence rather than noticed as homeless.
		expect(notices.filter((n) => /no \w+ source in this pipeline/.test(n.label ?? ""))).toEqual([])
		expect(notices.filter((n) => /relationships/.test(n.label ?? ""))).toEqual([])
	})

	it("the moved row resolves at the scan node for the session that selects the configuration", async () => {
		const { buildWorld } = await import("$lib/server/pipelines/config/world")
		const world = await buildWorld(db, {
			sessionId: NARRATE_SESSION,
			specId: "core:spec/narrate"
		})
		const sourced: any = resolveConfigSources(world as any, ["lore"])
		expect(sourced.lore.params.worldLoreShare).toMatchObject({
			value: 0.3,
			scopeKind: "preset"
		})
		expect(sourced.lore.params.historyMaxEntries).toMatchObject({ value: 4 })
		// The untouched bands read the declaration — the same numbers the
		// lanes declare, from one table (`LORE_BANDS`).
		expect(sourced.lore.params.characterLoreShare).toMatchObject({
			value: 0.1667,
			scopeKind: "author"
		})
		expect(sourced.lore.params.historyShare).toMatchObject({ value: 0.1666 })
	}, 60_000)

	it("`lorebook-triggers@1` declares the three bands at the lanes' numbers, under the lanes' labels", () => {
		const scan = C.lorebookTriggers.descriptor.slots?.params?.schema as Record<string, any>
		const lanes = {
			worldLore: C.worldLore,
			characterLore: C.characterLore,
			history: C.historyEntries
		} as const
		for (const [band, lane] of Object.entries(lanes)) {
			const own = lane.descriptor.slots?.params?.schema as Record<string, any>
			for (const field of ["share", "maxEntries", "priority"]) {
				const key = `${band}${field[0]!.toUpperCase()}${field.slice(1)}`
				expect(scan[key], `${key} on lorebook-triggers`).toBeTruthy()
				expect(scan[key].default, `${key} default`).toBe(own[field].default)
				expect(scan[key].i18n, `${key} label`).toEqual(own[field].i18n)
				expect(scan[key].shared, `${key} is the node's own`).toBeUndefined()
			}
			expect(`${band}MinEntries` in scan, `${band} floor on the scan (R6)`).toBe(false)
		}
	})
})

describe("two rankers in one spec leave one row and one notice per address (W3)", () => {
	it("the earlier ranker's member moves; the later one is culled naming the winner; the migration did not abort", async () => {
		// The first assertion is that this file's `beforeAll` completed: with
		// both claims inserted, `pipeline_config_values_addr_idx` threw and
		// the migration rolled back.
		expect(
			(await valuesAt(twoRankersTuned, "worldLore")).map((r) => [r.path, r.value])
		).toEqual([["share", 0.3]])
		const notices = await noticesOf(twoRankersTuned)
		expect(notices.filter((n) => n.kind === "backfilled").map((n) => [n.nodeKey, n.path, n.previousValue])).toEqual([
			["worldLore", "share", 0.3]
		])
		const culled = notices.filter((n) => n.kind === "culled")
		expect(culled.length).toBe(1)
		expect(culled[0]!.nodeKey).toBe("second")
		expect(culled[0]!.path).toBe("share")
		expect(culled[0]!.previousValue).toBe(0.4)
		expect(culled[0]!.label).toBe(
			"second/share.worldLore — folded into worldLore/share, which first/share.worldLore also moved to — the earlier step's value wins (one owner per setting, R-7 P5) (was 0.4)"
		)
	})
})

describe("session overrides move the same way", () => {
	it("re-homes the deviation at session scope and notices it under the session's configuration", async () => {
		const overrides = await db
			.select()
			.from(schema.pipelineNodeOverrides)
			.where(eq(schema.pipelineNodeOverrides.scopeId, SESSION))
		expect(
			overrides.map((o) => [o.nodeKey, o.slot, o.path, o.value])
		).toEqual([[OWNER.worldLore, "params", "share", 0.4]])
		const notice = (await noticesOf(tuned)).find(
			(n) => n.kind === "backfilled" && /^session 4242 · /.test(n.label ?? "")
		)
		expect(notice).toBeTruthy()
		expect(notice!.nodeKey).toBe(OWNER.worldLore)
		expect(notice!.previousValue).toBe(0.4)
	})
})

describe("the defaults reproduce today's effective values", () => {
	/**
	 * The migration's `shipped` numbers, the ranker's fallback table and the
	 * five definitions' declared defaults are ONE set. Any two disagreeing
	 * would move an untouched install's split on upgrade.
	 */
	const declared = (def: { descriptor: any }, field: string) =>
		def.descriptor.slots?.params?.schema?.[field]?.default
	const SOURCES = {
		messages: C.sessionHistory,
		worldLore: C.worldLore,
		characterLore: C.characterLore,
		history: C.historyEntries,
		relationships: C.relationshipSearch
	} as const

	it("declares on each source exactly what the ranker's map held", () => {
		for (const [band, def] of Object.entries(SOURCES)) {
			expect(declared(def, "share"), `${band} share`).toBe(
				DEFAULT_GROUPS.share[band as keyof typeof DEFAULT_GROUPS.share]
			)
			expect(declared(def, "maxEntries"), `${band} maxEntries`).toBe(
				DEFAULT_GROUPS.maxEntries[band as keyof typeof DEFAULT_GROUPS.maxEntries]
			)
			expect(declared(def, "priority"), `${band} priority`).toBe("normal")
		}
		// The one floor: the conversation's six; the lore lanes and the graph
		// declare none (R6).
		expect(declared(C.sessionHistory, "minEntries")).toBe(6)
		for (const def of [C.worldLore, C.characterLore, C.historyEntries, C.relationshipSearch])
			expect(declared(def, "minEntries")).toBeUndefined()
		expect(DEFAULT_GROUPS.share).toEqual({
			messages: 0.5,
			worldLore: 0.1667,
			characterLore: 0.1667,
			history: 0.1666,
			relationships: 0
		})
		expect(DEFAULT_GROUPS.minEntries.messages).toBe(6)
	})

	it("resolves the same table from no intents at all as from the declared ones", () => {
		const fromNothing = bandsFromIntents([]).groups
		const fromDeclared = bandsFromIntents(
			Object.entries(SOURCES).map(([band, def]) => ({
				band,
				intent: {
					share: declared(def, "share"),
					maxEntries: declared(def, "maxEntries"),
					minEntries: declared(def, "minEntries"),
					priority: declared(def, "priority")
				}
			}))
		).groups
		expect(fromDeclared).toEqual(fromNothing)
	})

	it("declares none of the three maps on the ranker any more", () => {
		const schema = C.rankHybrid.descriptor.slots?.params?.schema ?? {}
		for (const gone of ["share", "maxEntries", "minEntries"])
			expect(gone in schema, `${gone} still on rank-hybrid`).toBe(false)
	})
})
