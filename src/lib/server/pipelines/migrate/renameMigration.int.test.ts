/**
 * The one-shot rename migration (`drizzle/0134_rename_definitions_clauses_events.sql`;
 * plans/30 §U3) against a database built from the shipped seeds AT THE
 * PRE-RENAME SCHEMA.
 *
 * ## The fixture
 *
 * `fixtures/preRename0133.json` is a dump of the pipeline tables after a
 * fresh `bootstrapPipelines` on the 0133 schema with the pre-rename SDK —
 * 17 specs, 105 definitions, 197 nodes, 21 blocks — plus two configs carrying
 * deviations (one on the owner lore lane, two on the loser lanes with one
 * collision at the owner's path, one on the loser embed node, one on
 * `generate`), the two seeded session presets, and two receipts pinned to the
 * pre-rename `respond` hash with node rows in the pre-rename vocabulary. It was
 * taken once, before the rename landed, by a one-shot script that booted the
 * old code and dumped `SELECT * FROM <table> ORDER BY id` per table; it cannot
 * be regenerated from this tree, which is the point of keeping it.
 *
 * ## What is proved
 *
 * The migrations 0000–0133 are applied as raw SQL, the fixture rows are
 * inserted, 0134 runs, and then: every definition slug is renamed and the old
 * one resolvable through `renamed_from`; every stored document loads and hashes
 * to EXACTLY what the new SDK compiles for that slug (the identity check — the
 * rewrite changed the words and nothing else); folded config rows sit at the
 * owner's address with the collision recorded as a notice carrying its value;
 * preset bindings are keyed by event id; the receipts still open by hash and
 * their old id strings resolve; no `user`/`instance` scope rows exist; the
 * subscriptions table is gone; and a boot against the migrated database
 * publishes once and then never again.
 *
 * ## Seeded beside the fixture, before the migration runs
 *
 * The dump has no retired version row and no session override, so the U3
 * review's cases (W2, W3) are inserted by `beforeAll` at the pre-rename
 * schema rather than hand-written into the dump: a `respond` version an edit
 * had already retired, with a receipt pinned to it, and three session-scope
 * overrides — two at loser lore-lane addresses (one colliding with the
 * owner's own session row) and the owner's.
 *
 * ## 0135 runs after 0134, on the same rows (U3b review W4)
 *
 * The dump predates the ranker's maps leaving too, and holds none, so the
 * maps are seeded the same way: a `respond` configuration and a `narrate`
 * configuration each carrying a `share` map on `rank`, and a session-scope
 * `share` map on `respond`'s `rank`. 0134 renames the world they live in
 * (`type_id` → `definition_id`, the columns 0135 finds its rankers by), then
 * 0135 moves each member to the node that owns it — the lane in `respond`,
 * the one-node scan in `narrate` under the band's namespaced field. Before
 * this file applied 0135 the chain was proved only from a database seeded by
 * new code, which is not the database an upgrade sees.
 */
import { describe, it, expect, beforeAll, vi } from "vitest"
import fs from "fs"
import path from "path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

/**
 * `sockets/pipelines.ts` reads the app's `db` binding; the W2 assertion needs
 * it to read THIS database. The holder is filled once the client exists.
 */
const routed = vi.hoisted(() => ({ db: null as unknown }))
vi.mock("$lib/server/db", () => ({
	db: new Proxy({} as Record<string, unknown>, {
		get: (_t, k) => {
			const real = routed.db as Record<string, unknown>
			if (!real) throw new Error("the migration test's db is not built yet")
			const v = real[k as string]
			return typeof v === "function" ? (v as Function).bind(real) : v
		}
	}),
	getCryptoSecretKey: () => "rename-migration-test-secret"
}))

const FIXTURE = path.resolve(
	process.cwd(),
	"src/lib/server/pipelines/migrate/fixtures/preRename0133.json"
)
const MIGRATIONS = path.resolve(process.cwd(), "drizzle")
const RENAME_TAG = "0134_rename_definitions_clauses_events"
const WEIGHTS_TAG = "0135_weights_to_the_source"

interface Journal {
	entries: Array<{ idx: number; tag: string }>
}

const statementsOf = (file: string): string[] =>
	fs
		.readFileSync(file, "utf8")
		.split("--> statement-breakpoint")
		.map((s) => s.trim())
		.filter((s) => s.length && !/^(--[^\n]*\n?)+$/.test(s))

/** Apply the migrations whose index is below `before`, as raw SQL. */
async function applyUpTo(client: PGlite, before: string): Promise<void> {
	const journal = JSON.parse(
		fs.readFileSync(path.join(MIGRATIONS, "meta/_journal.json"), "utf8")
	) as Journal
	const stop = journal.entries.find((e) => e.tag === before)
	if (!stop) throw new Error(`no migration ${before} in the journal`)
	for (const e of journal.entries) {
		if (e.idx >= stop.idx) break
		for (const stmt of statementsOf(path.join(MIGRATIONS, `${e.tag}.sql`)))
			await client.exec(stmt)
	}
}

async function applyOne(client: PGlite, tag: string): Promise<void> {
	for (const stmt of statementsOf(path.join(MIGRATIONS, `${tag}.sql`)))
		await client.exec(stmt)
}

/** Load the fixture's rows table by table, in the order the dump wrote them. */
async function loadFixture(
	client: PGlite,
	fixture: Record<string, Array<Record<string, unknown>>>
): Promise<void> {
	for (const [table, rows] of Object.entries(fixture)) {
		// A `json` column takes its value JSON-encoded whatever the JS type — a
		// config value of `"on"` is the JSON string `"on"`, not the text `on`.
		const jsonCols = new Set(
			(
				await client.query<{ column_name: string }>(
					`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND data_type IN ('json', 'jsonb')`,
					[table]
				)
			).rows.map((r) => r.column_name)
		)
		for (const row of rows) {
			const cols = Object.keys(row)
			const params = cols.map((c) => {
				const v = row[c]
				if (v === null || v === undefined) return null
				if (jsonCols.has(c) || typeof v === "object") return JSON.stringify(v)
				return v
			})
			const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ")
			// `users` carries the seeded admin (id 1) the migrations already
			// wrote; everything else is the dump's alone.
			const conflict = table === "users" ? " ON CONFLICT DO NOTHING" : ""
			await client.query(
				`INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(", ")}) VALUES (${placeholders})${conflict}`,
				params
			)
		}
	}
	// The dump carried explicit ids; move every identity sequence past them.
	await client.exec(`
		DO $$
		DECLARE rec RECORD;
		BEGIN
			FOR rec IN
				SELECT seq.relname AS seq_name, tab.relname AS table_name, attr.attname AS col_name
				FROM pg_class seq
				JOIN pg_namespace ns ON ns.oid = seq.relnamespace
				JOIN pg_depend dep ON dep.objid = seq.oid AND dep.deptype IN ('a', 'i')
				JOIN pg_class tab ON dep.refobjid = tab.oid
				JOIN pg_attribute attr ON attr.attrelid = tab.oid AND attr.attnum = dep.refobjsubid
				WHERE seq.relkind = 'S' AND ns.nspname = 'public'
			LOOP
				EXECUTE format('SELECT setval(%L, COALESCE((SELECT MAX(%I) FROM public.%I), 1))', rec.seq_name, rec.col_name, rec.table_name);
			END LOOP;
		END $$;
	`)
}

const rows = async <T = Record<string, any>>(client: PGlite, q: string, params: unknown[] = []) =>
	(await client.query<T>(q, params)).rows

const OLD_KIND = /:(input|provider|consumer)\//

/** `respond` in the dump — the spec the seeded rows below hang off. */
const RESPOND_SPEC_ROW_ID = 8
/** The version row an edit retired before the rename; its hash is its own. */
const EDITED_AWAY_HASH = "editedaway-fixture"
const EDITED_AWAY_RUN = "fixture-run-edited-away"
/** A session id for the override rows — no `sessions` row is needed to fold them. */
const OVERRIDE_SESSION = 4242
/** `narrate` in the dump — scans through one `lorebook-triggers` node keyed `lore`. */
const NARRATE_SPEC_ROW_ID = 9

describe("0134 — the one-shot rename, against the pre-rename seeds", () => {
	let client: PGlite
	let db: TestDb
	let fixture: Record<string, Array<Record<string, any>>>

	beforeAll(async () => {
		fixture = JSON.parse(fs.readFileSync(FIXTURE, "utf8"))
		client = new PGlite()
		await applyUpTo(client, RENAME_TAG)
		await loadFixture(client, fixture)
		// The pre-rename state is what the fixture says it is.
		const kinds = await rows(client, `SELECT DISTINCT kind FROM pipeline_nodes ORDER BY kind`)
		expect(kinds.map((r) => r.kind)).toEqual(["consumer", "input", "provider", "query", "task"])

		// W2 · a `respond` version an EDIT retired before the rename, and a
		// receipt pinned to it. Same semver as the active row — the unique key
		// is (spec, semver, hash) — under a hash of its own.
		const [retired] = await rows(
			client,
			`INSERT INTO pipeline_spec_versions (spec_id, semver, status, canonical_hash, schema_version, input_genre, input_event)
			 VALUES ($1, '1.20.0', 'retired', $2, 1, 'core:genre/chat', 'message-respond') RETURNING id`,
			[RESPOND_SPEC_ROW_ID, EDITED_AWAY_HASH]
		)
		const template = fixture.pipeline_runs[0]!
		await client.query(
			`INSERT INTO pipeline_runs (run_id, spec_slug, spec_version, spec_version_id, session_id, user_id, outcome, trigger_source, seed, is_preview, started_at, ended_at, elapsed_ms, tokens_spent, receipt, spec_hash)
			 VALUES ($1, $2, $3, $4, NULL, $5, 'ok', 'input', 'fixture', false, $6, $7, 1, 0, $8, $9)`,
			[
				EDITED_AWAY_RUN,
				template.spec_slug,
				template.spec_version,
				retired!.id,
				template.user_id,
				template.started_at,
				template.ended_at,
				JSON.stringify({ runId: EDITED_AWAY_RUN, specId: template.spec_slug, nodes: [] }),
				EDITED_AWAY_HASH
			]
		)

		// W3 · session-scope overrides on `respond`: the owner's own row, a
		// loser row that collides with it, and a loser row that does not.
		for (const [nodeKey, path, value] of [
			["gather.worldLore.read", "scanDepth", 4],
			["gather.characterLore.read", "scanDepth", 9],
			["gather.historyEntries.read", "titleWeight", 3]
		] as const)
			await client.query(
				`INSERT INTO pipeline_node_overrides (spec_id, scope_kind, scope_id, node_key, slot, path, value)
				 VALUES ($1, 'session', $2, $3, 'params', $4, $5)`,
				[RESPOND_SPEC_ROW_ID, OVERRIDE_SESSION, nodeKey, path, JSON.stringify(value)]
			)

		// W4 (U3b) · the ranker's maps, as the panel stored them before the
		// weights moved to the sources: a whole map, most members at the
		// shipped number. One `respond` configuration, one `narrate`
		// configuration, one session override on `respond`.
		for (const [specId, name] of [
			[RESPOND_SPEC_ROW_ID, "U3b respond"],
			[NARRATE_SPEC_ROW_ID, "U3b narrate"]
		] as const) {
			const [cfg] = await rows(
				client,
				`INSERT INTO pipeline_configs (spec_id, name, is_immutable, is_default) VALUES ($1, $2, false, false) RETURNING id`,
				[specId, name]
			)
			await client.query(
				`INSERT INTO pipeline_config_values (config_id, node_key, slot, path, value) VALUES ($1, 'rank', 'params', 'share', $2)`,
				[
					cfg!.id,
					JSON.stringify({
						messages: 0.5,
						worldLore: 0.3,
						characterLore: 0.1667,
						history: 0.0333,
						relationships: 0
					})
				]
			)
		}
		await client.query(
			`INSERT INTO pipeline_node_overrides (spec_id, scope_kind, scope_id, node_key, slot, path, value)
			 VALUES ($1, 'session', $2, 'rank', 'params', 'share', $3)`,
			[RESPOND_SPEC_ROW_ID, OVERRIDE_SESSION, JSON.stringify({ characterLore: 0.2 })]
		)

		await applyOne(client, RENAME_TAG)
		await applyOne(client, WEIGHTS_TAG)
		db = drizzle(client, { schema }) as unknown as TestDb
		routed.db = db
	}, 120_000)

	it("renamed every definition slug and left the old one resolvable through renamed_from", async () => {
		const reg = await rows(client, `SELECT definition_id, renamed_from, renamed_at FROM pipeline_definition_registry`)
		expect(reg.some((r) => OLD_KIND.test(r.definition_id))).toBe(false)
		const renamed = reg.filter((r) => r.renamed_from)
		// The dump is keyed by the PRE-rename table name — that is the point of it.
		const oldIds = fixture.pipeline_type_registry
			.map((r) => r.type_id as string)
			.filter((id) => OLD_KIND.test(id))
		// Every old slug but the culled inlet is reachable by its old spelling.
		for (const old of oldIds) {
			if (old === "core:input/message-created") continue
			const hit = renamed.find((r) => r.renamed_from === old)
			expect(hit, `${old} has no renamed_from row`).toBeTruthy()
			expect(hit!.definition_id).toBe(
				old.replace(":input/", ":inlet/").replace(":provider/", ":oracle/").replace(":consumer/", ":outlet/")
			)
			expect(hit!.renamed_at).toBeTruthy()
		}
		expect(renamed.length).toBe(oldIds.length - 1)
		expect(reg.some((r) => r.definition_id === "core:inlet/message-created")).toBe(false)
		// The archive followed, and its material did not move.
		const decl = await rows(client, `SELECT definition_id, material FROM pipeline_definition_declarations`)
		expect(decl.some((r) => OLD_KIND.test(r.definition_id))).toBe(false)
		const userMessage = decl.find((r) => r.definition_id === "core:inlet/user-message")!
		expect(userMessage.material.kind).toBe("input")
	})

	it("rewrote the registry's and the archive's `kind` too, so they agree with the node rows before any boot", async () => {
		// W1 · §1 rewrote `pipeline_nodes.kind`; the registry row's `kind` is
		// the same word read from the other side, and a reader between the
		// migration and the first boot (or a boot whose hash move never came)
		// must not see `input` on one and `inlet` on the other.
		const reg = await rows(client, `SELECT definition_id, kind FROM pipeline_definition_registry`)
		expect(reg.some((r) => ["input", "provider", "consumer"].includes(r.kind))).toBe(false)
		const byId = new Map(reg.map((r) => [r.definition_id, r.kind]))
		const referenced = await rows(client, `SELECT DISTINCT definition_id, kind FROM pipeline_nodes`)
		expect(referenced.length).toBeGreaterThan(0)
		for (const n of referenced)
			expect(byId.get(n.definition_id), `${n.definition_id}: registry kind vs node kind`).toBe(n.kind)
		// The archive's column followed (an attribute, like its `definition_id`);
		// its `material.kind` did not — that is what was hashed.
		const decl = await rows(client, `SELECT kind, material FROM pipeline_definition_declarations`)
		expect(decl.some((r) => ["input", "provider", "consumer"].includes(r.kind))).toBe(false)
		expect(decl.some((r) => r.material.kind === "input")).toBe(true)
	})

	it("rewrote every node and clause row into the new vocabulary", async () => {
		const kinds = await rows(client, `SELECT DISTINCT kind FROM pipeline_nodes ORDER BY kind`)
		expect(kinds.map((r) => r.kind)).toEqual(["inlet", "oracle", "outlet", "query", "task"])
		const ids = await rows(client, `SELECT definition_id FROM pipeline_nodes`)
		expect(ids.some((r) => OLD_KIND.test(r.definition_id))).toBe(false)
		const clauseKinds = await rows(client, `SELECT DISTINCT kind FROM pipeline_clauses ORDER BY kind`)
		expect(clauseKinds.map((r) => r.kind)).toEqual(["each", "gather", "junction", "loop"])
		const nodeClauseKinds = await rows(client, `SELECT DISTINCT clause_kind FROM pipeline_nodes WHERE clause_kind IS NOT NULL ORDER BY clause_kind`)
		expect(nodeClauseKinds.map((r) => r.clause_kind)).toEqual(["each", "gather", "junction", "loop"])
		// The tool loop is keyed `tools`.
		const agent = await rows(client, `SELECT node_key FROM pipeline_nodes WHERE node_key LIKE 'agent.%' OR clause_id LIKE 'agent%'`)
		expect(agent).toEqual([])
		const tools = await rows(client, `SELECT clause_id FROM pipeline_clauses WHERE clause_id = 'tools'`)
		expect(tools.length).toBe(1)
		// Pool keys followed the ids.
		const pools = await rows(client, `SELECT node_definition_id FROM pipeline_prompts UNION SELECT node_definition_id FROM pipeline_context_templates`)
		expect(pools.some((r) => OLD_KIND.test(r.node_definition_id))).toBe(false)
	})

	it("every stored document loads and hashes to exactly what the new SDK compiles — the identity check", async () => {
		const { loadDocument } = await import("$lib/server/pipelines/boot/store")
		const { canonicalHash } = await import("@serene-pub/sdk")
		const { CORE_SPECS } = await import("$lib/server/pipelines/specs")
		const specs = await rows(client, `SELECT slug, active_version_id FROM pipeline_specs ORDER BY id`)
		/**
		 * Specs that did not exist at the rename, so the pre-rename fixture
		 * holds no row for them and the migration has nothing of theirs to
		 * rewrite; the boot after it publishes them fresh (the last case
		 * below sees them arrive). U5b (R-15): the five built-in writes.
		 * U5g (R-18): the guide genre's two — its create pipeline and its
		 * reply.
		 */
		const PUBLISHED_SINCE_RENAME = new Set(
			CORE_SPECS.map((c) => c.slug).filter(
				(slug) =>
					slug.startsWith("core:spec/builtin-") ||
					slug === "core:spec/create-guide" ||
					slug === "core:spec/guide-respond"
			)
		)
		expect(PUBLISHED_SINCE_RENAME.size).toBe(7)
		const atRename = CORE_SPECS.length - PUBLISHED_SINCE_RENAME.size
		expect(specs.length).toBe(atRename)
		/**
		 * Documents edited AFTER the rename landed, with the hash the shipped
		 * document carried at the rename. The identity this case proves is
		 * "the rewrite changed the words and nothing else", which is a fact
		 * about the document as it stood on 2026-09-16; a later edit moves
		 * the shipped hash without touching that fact, so the stored document
		 * is held to the hash it was rewritten TO, recorded from
		 * `boot/specHashes.test.ts`'s "(was …)" lines in the same change as
		 * the edit. U3b (R-7 P5): the lore pool concatenates the
		 * conversation's `band` port; `adventure-look` gains a `lore` concat.
		 * U5a (R-18 (3)): `respond` wires the inlet's `speaker` reference into
		 * its turn strategy; `narrate-character` and `adventure-respond` take
		 * the side-character fact on `sideCharacter` — three specs already
		 * held here, so the map's hashes (the at-rename ones) do not move.
		 * U5c (R-15): `contributes.triggers` became `contributes.actions` on
		 * every contributing spec — four more join the map at the hash they
		 * were rewritten TO (the pins U5c replaced), and the three already here
		 * keep theirs.
		 * A later edit wired `narrate-character`'s placeholder to
		 * `speaker: $.input.speaker`, so a side character picked from the
		 * cast carries `metadata.speaker = character:<id>` like a migrated
		 * row (0138) — another edit already covered by its entry here, so
		 * its pin does not move either.
		 */
		const EDITED_SINCE_RENAME: Record<string, string> = {
			"core:spec/respond": "19cac7b1208d4e",
			"core:spec/adventure-respond": "1cce782246906a",
			"core:spec/adventure-look": "11669b8b5b66fd",
			"core:spec/narrate-character": "1dcc060b10f7fb",
			"core:spec/narrate": "1be02ac2c726fc",
			"core:spec/adventure-rest": "4e32a33712802",
			"core:spec/adventure-advance-time": "17168783bd30d0",
			"core:spec/echo": "19cc4810162b94",
			"core:spec/generate-image": "19338b1db2497c"
		}
		let checked = 0
		for (const s of specs) {
			const shipped = CORE_SPECS.find((c) => c.slug === s.slug)
			expect(shipped, `${s.slug} is not a shipped spec`).toBeTruthy()
			const stored = await loadDocument(db, s.active_version_id)
			const fresh = shipped!.build()
			expect(canonicalHash(stored), `${s.slug} does not hash like the shipped document`).toBe(
				EDITED_SINCE_RENAME[s.slug] ?? canonicalHash(fresh)
			)
			checked++
		}
		expect(checked).toBe(atRename)
		// …and the pre-rename hash column is deliberately NOT that hash: the row
		// keeps naming the document it was pinned as, marked renamed.
		const versions = await rows(
			client,
			`SELECT canonical_hash, renamed_at FROM pipeline_spec_versions WHERE id IN (SELECT active_version_id FROM pipeline_specs)`
		)
		expect(versions.length).toBe(atRename)
		for (const v of versions) expect(v.renamed_at).toBeTruthy()
		const respond = specs.find((s) => s.slug === "core:spec/respond")!
		const [respondRow] = await rows(client, `SELECT canonical_hash FROM pipeline_spec_versions WHERE id = $1`, [respond.active_version_id])
		const respondFixtureHash = fixture.pipeline_spec_versions.find((v) => v.id === respond.active_version_id)!.canonical_hash
		expect(respondRow.canonical_hash).toBe(respondFixtureHash)
	})

	it("folded the loser lore-lane and embed rows to the owner, with the collision as a notice carrying its value", async () => {
		const a = fixture.pipeline_configs.find((c) => c.name === "Fixture A")!
		const b = fixture.pipeline_configs.find((c) => c.name === "Fixture B")!
		const valuesOf = async (configId: number) =>
			rows(client, `SELECT node_key, slot, path, value FROM pipeline_config_values WHERE config_id = $1 ORDER BY node_key, path`, [configId])
		const va = await valuesOf(a.id)
		// Owner wins the collision: scanDepth stays 7.
		expect(va.find((r) => r.node_key === "gather.worldLore.read" && r.path === "scanDepth")?.value).toBe(7)
		// The uncontested loser rows moved.
		expect(va.find((r) => r.node_key === "gather.worldLore.read" && r.path === "titleWeight")?.value).toBe(2)
		expect(va.find((r) => r.node_key === "semantic.arm.embed" && r.path === "enabled")?.value).toBe("on")
		// Nothing is left at a loser address.
		expect(va.filter((r) => ["gather.characterLore.read", "gather.historyEntries.read", "names.arm.embed"].includes(r.node_key))).toEqual([])
		// The loser that collided is a `culled` notice carrying what it held;
		// every row that MOVED is a `backfilled` notice on the owner's address
		// saying where it came from and what it was (W4) — a person who tuned
		// only one lane now has all three at that number, and this is the
		// only thing that says so.
		const noticesOf = async (configId: number) =>
			rows(client, `SELECT kind, node_key, slot, path, label, previous_value FROM pipeline_config_notices WHERE config_id = $1 ORDER BY id`, [configId])
		const na = await noticesOf(a.id)
		expect(na.filter((n) => n.kind === "culled")).toEqual([
			{
				kind: "culled",
				node_key: "gather.characterLore.read",
				slot: "params",
				path: "scanDepth",
				label: "gather.characterLore.read/scanDepth — folded into gather.worldLore.read, which already held 7 (one owner per setting, R-7 P2)",
				previous_value: 5
			}
		])
		expect(na.filter((n) => n.kind === "backfilled")).toEqual([
			{
				kind: "backfilled",
				node_key: "gather.worldLore.read",
				slot: "params",
				path: "titleWeight",
				label: "gather.historyEntries.read/titleWeight → gather.worldLore.read/titleWeight — one setting now governs world lore, character lore and history (was 2)",
				previous_value: 2
			},
			{
				kind: "backfilled",
				node_key: "semantic.arm.embed",
				slot: "params",
				path: "enabled",
				label: 'names.arm.embed/enabled → semantic.arm.embed/enabled — one switch now governs both embed steps (was "on")',
				previous_value: "on"
			}
		])
		const vb = await valuesOf(b.id)
		expect(vb.find((r) => r.node_key === "gather.worldLore.read" && r.path === "admitThreshold")?.value).toBe(0.5)
		expect(vb.find((r) => r.node_key === "generate" && r.path === "stopSequences")?.value).toEqual(["\nUser:"])
		const nb = await noticesOf(b.id)
		expect(nb).toEqual([
			{
				kind: "backfilled",
				node_key: "gather.worldLore.read",
				slot: "params",
				path: "admitThreshold",
				label: "gather.characterLore.read/admitThreshold → gather.worldLore.read/admitThreshold — one setting now governs world lore, character lore and history (was 0.5)",
				previous_value: 0.5
			}
		])
		// The notice count IS the moved-row count: every loser row in the dump
		// either moved (backfilled) or lost a collision (culled), nothing else.
		const loserRows = fixture.pipeline_config_values.filter(
			(v) => v.slot === "params" && ["gather.characterLore.read", "gather.historyEntries.read", "names.arm.embed"].includes(v.node_key)
		)
		const [{ backfilled, culled }] = await rows<{ backfilled: string; culled: string }>(
			client,
			`SELECT count(*) FILTER (WHERE kind = 'backfilled')::text AS backfilled, count(*) FILTER (WHERE kind = 'culled')::text AS culled
			 FROM pipeline_config_notices n JOIN pipeline_configs c ON c.id = n.config_id WHERE c.name LIKE 'Fixture %'`
		)
		expect(Number(culled)).toBe(1)
		expect(Number(backfilled)).toBe(loserRows.length - Number(culled))
	})

	it("folded a session's overrides the same way — owner wins, the loser's collision is a notice on the session's configuration (W3)", async () => {
		const overrides = await rows(
			client,
			`SELECT node_key, slot, path, value FROM pipeline_node_overrides WHERE spec_id = $1 AND scope_kind = 'session' AND scope_id = $2 ORDER BY node_key, path`,
			[RESPOND_SPEC_ROW_ID, OVERRIDE_SESSION]
		)
		expect(overrides).toEqual([
			// 0135's move (W4): the session's `share.characterLore` on the
			// ranker is the character-lore lane's own `share` now.
			{ node_key: "gather.characterLore.read", slot: "params", path: "share", value: 0.2 },
			{ node_key: "gather.worldLore.read", slot: "params", path: "scanDepth", value: 4 },
			{ node_key: "gather.worldLore.read", slot: "params", path: "titleWeight", value: 3 }
		])
		// The session selected no configuration, so its notices hang off the
		// pipeline's shipped default — the one place the panel can show them.
		const [dflt] = await rows(client, `SELECT id FROM pipeline_configs WHERE spec_id = $1 AND is_default`, [RESPOND_SPEC_ROW_ID])
		const notices = await rows(
			client,
			`SELECT kind, node_key, path, label, previous_value FROM pipeline_config_notices WHERE config_id = $1 ORDER BY id`,
			[dflt!.id]
		)
		expect(notices).toEqual([
			{
				kind: "culled",
				node_key: "gather.characterLore.read",
				path: "scanDepth",
				label: `session ${OVERRIDE_SESSION} · gather.characterLore.read/scanDepth — folded into gather.worldLore.read, which already held 4 (one owner per setting, R-7 P2)`,
				previous_value: 9
			},
			{
				kind: "backfilled",
				node_key: "gather.worldLore.read",
				path: "titleWeight",
				label: `session ${OVERRIDE_SESSION} · gather.historyEntries.read/titleWeight → gather.worldLore.read/titleWeight — one setting now governs world lore, character lore and history (was 3)`,
				previous_value: 3
			},
			// 0135's, after 0134's (W4), on the same configuration for the
			// same reason: the session selected none.
			{
				kind: "backfilled",
				node_key: "gather.characterLore.read",
				path: "share",
				label: `session ${OVERRIDE_SESSION} · rank/share.characterLore → gather.characterLore.read/share — the characterLore source now declares its own share (weights live on the source, R-7 P5; was 0.2)`,
				previous_value: 0.2
			}
		])
	})

	it("0135, run after 0134 on the pre-rename rows, moved the ranker's maps to the owners (U3b W4)", async () => {
		const configOf = async (name: string) =>
			(await rows(client, `SELECT id FROM pipeline_configs WHERE name = $1`, [name]))[0]!.id as number
		const valuesOf = async (configId: number) =>
			rows(client, `SELECT node_key, slot, path, value FROM pipeline_config_values WHERE config_id = $1 ORDER BY node_key, path`, [configId])
		const noticesOf = async (configId: number) =>
			rows(client, `SELECT kind, node_key, path, label, previous_value FROM pipeline_config_notices WHERE config_id = $1 ORDER BY id`, [configId])

		// `respond`: the two deviations on their lanes, the three shipped
		// members swept, nothing on the ranker.
		const respond = await configOf("U3b respond")
		expect(await valuesOf(respond)).toEqual([
			{ node_key: "gather.historyEntries.read", slot: "params", path: "share", value: 0.0333 },
			{ node_key: "gather.worldLore.read", slot: "params", path: "share", value: 0.3 }
		])
		expect((await noticesOf(respond)).map((n) => [n.kind, n.node_key, n.path, n.previous_value])).toEqual([
			["backfilled", "gather.historyEntries.read", "share", 0.0333],
			["backfilled", "gather.worldLore.read", "share", 0.3]
		])

		// `narrate`: no lane per band — the one-node scan owns all three, under
		// the band's namespaced field (W1).
		const narrate = await configOf("U3b narrate")
		expect(await valuesOf(narrate)).toEqual([
			{ node_key: "lore", slot: "params", path: "historyShare", value: 0.0333 },
			{ node_key: "lore", slot: "params", path: "worldLoreShare", value: 0.3 }
		])
		const narrateNotices = await noticesOf(narrate)
		expect(narrateNotices.map((n) => [n.kind, n.node_key, n.path, n.previous_value])).toEqual([
			["backfilled", "lore", "historyShare", 0.0333],
			["backfilled", "lore", "worldLoreShare", 0.3]
		])
		expect(narrateNotices[1]!.label).toBe(
			"rank/share.worldLore → lore/worldLoreShare — the worldLore source now declares its own share (weights live on the source, R-7 P5; was 0.3)"
		)
		// Nothing was culled for want of an owner: every band had one.
		expect(narrateNotices.some((n) => n.kind === "culled")).toBe(false)
	})

	it("stamped `renamed_at` on the active version only — a row an edit retired stays superseded, not renamed (W2)", async () => {
		const [retired] = await rows(client, `SELECT id, status, renamed_at FROM pipeline_spec_versions WHERE canonical_hash = $1`, [EDITED_AWAY_HASH])
		expect(retired!.status).toBe("retired")
		expect(retired!.renamed_at).toBeNull()
		const [{ n }] = await rows<{ n: string }>(client, `SELECT count(*)::text AS n FROM pipeline_spec_versions WHERE renamed_at IS NOT NULL`)
		expect(Number(n)).toBe(fixture.pipeline_spec_versions.length)
		// …and the inspector reads exactly that: the receipt pinned to the
		// edited-away row says nothing about a rename, the one pinned to the
		// active row names the date.
		const { pipelinesRun } = await import("$lib/server/sockets/pipelines")
		const socket = { user: { id: 2, isAdmin: false } } as any
		const noop = () => {}
		const edited: any = await pipelinesRun.handler(socket, { runId: EDITED_AWAY_RUN }, noop)
		expect(edited.run?.specHash).toBe(EDITED_AWAY_HASH)
		expect(edited.run?.specHashRenamedAt).toBeNull()
		const renamed: any = await pipelinesRun.handler(socket, { runId: "fixture-run-0" }, noop)
		expect(renamed.run?.specHashRenamedAt).toBeTruthy()
	})

	it("keyed the inlet locks and the preset bindings by event id", async () => {
		const locks = await rows(client, `SELECT DISTINCT input_event FROM pipeline_spec_versions WHERE input_event IS NOT NULL ORDER BY input_event`)
		expect(locks.map((r) => r.input_event)).toEqual([
			"core:event/message-respond@1",
			"core:event/session-action@1",
			"core:event/session-created@1"
		])
		const presets = await rows(client, `SELECT seed_key, bindings FROM session_presets ORDER BY id`)
		expect(presets.length).toBe(2)
		for (const p of presets) {
			const keys = Object.keys(p.bindings)
			expect(keys.length).toBeGreaterThan(0)
			for (const k of keys) expect(k).toMatch(/^core:event\/[a-z-]+@1$/)
		}
		expect(presets[0]!.bindings["core:event/message-respond@1"]).toEqual({ spec: "core:spec/respond" })
	})

	it("culled trigger kind/pick and the taxonomy zone; triggers say venue", async () => {
		const versions = await rows(client, `SELECT contributes, taxonomy FROM pipeline_spec_versions`)
		let triggers = 0
		for (const v of versions) {
			expect(v.taxonomy?.zone).toBeUndefined()
			for (const t of v.contributes?.triggers ?? []) {
				triggers++
				expect(["composer", "message"]).toContain(t.venue)
				expect(t.kind).toBeUndefined()
				expect(t.pick).toBeUndefined()
			}
		}
		expect(triggers).toBeGreaterThan(0)
	})

	it("did not touch a receipt: the old hash still names its version row and the old ids still resolve", async () => {
		const runs = await rows(client, `SELECT spec_hash, spec_version_id FROM pipeline_runs WHERE run_id <> $1 ORDER BY id`, [EDITED_AWAY_RUN])
		expect(runs.length).toBe(2)
		for (const r of runs) {
			const [v] = await rows(client, `SELECT id, renamed_at FROM pipeline_spec_versions WHERE canonical_hash = $1`, [r.spec_hash])
			expect(v?.id).toBe(r.spec_version_id)
			expect(v.renamed_at).toBeTruthy()
		}
		const nodes = await rows(client, `SELECT kind, definition_id FROM pipeline_run_nodes ORDER BY id`)
		expect(nodes.some((n) => n.kind === "input")).toBe(true)
		for (const n of nodes) {
			const bare = (n.definition_id as string).replace(/@\d+$/, "")
			const [hit] = await rows(client, `SELECT definition_id FROM pipeline_definition_registry WHERE definition_id = $1 OR renamed_from = $1`, [bare])
			expect(hit, `${n.definition_id} does not resolve`).toBeTruthy()
		}
	})

	it("has no user/instance scope rows and no subscriptions table", async () => {
		const [{ n }] = await rows<{ n: string }>(client, `SELECT count(*)::text AS n FROM pipeline_node_overrides WHERE scope_kind IN ('user', 'instance')`)
		expect(Number(n)).toBe(0)
		const gone = await rows(client, `SELECT to_regclass('public.pipeline_event_subscriptions') AS t`)
		expect(gone[0]!.t).toBeNull()
	})

	it("boots once with a republish, and a second boot moves nothing", async () => {
		const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
		const poolCounts = async () =>
			rows<{ prompts: string; templates: string }>(
				client,
				`SELECT (SELECT count(*) FROM pipeline_prompts)::text AS prompts, (SELECT count(*) FROM pipeline_context_templates)::text AS templates`
			).then(([r]) => ({ prompts: Number(r!.prompts), templates: Number(r!.templates) }))
		const poolsBefore = await poolCounts()

		// An install whose archive never saw the pre-rename declaration (it
		// last booted before 0119) adopts it from the registry row at this
		// boot. The row's `kind` now says `inlet` while its hash was taken over
		// `input`, so the adopted material must be the one the hash names.
		const [pre] = await rows(client, `SELECT content_hash FROM pipeline_definition_registry WHERE definition_id = 'core:inlet/user-message'`)
		await client.query(`DELETE FROM pipeline_definition_declarations WHERE definition_id = 'core:inlet/user-message'`)

		const first = await bootstrapPipelines(db)
		// Every stored spec republished — same content, new hash — and the
		// definitions whose kind changed moved their pointer.
		expect(first.specs.every((s) => s.action === "published")).toBe(true)
		expect(first.types.republished.length).toBeGreaterThan(0)
		const retired = await rows(client, `SELECT count(*)::text AS n FROM pipeline_spec_versions WHERE status = 'retired' AND renamed_at IS NOT NULL`)
		expect(Number(retired[0]!.n)).toBe(fixture.pipeline_spec_versions.length)
		// The receipts still open: their hash names the retired row.
		const runs = await rows(client, `SELECT spec_hash FROM pipeline_runs`)
		for (const r of runs) {
			const hit = await rows(client, `SELECT id FROM pipeline_spec_versions WHERE canonical_hash = $1`, [r.spec_hash])
			expect(hit.length).toBe(1)
		}
		// The adopted declaration sits under the pre-rename hash with the
		// material that hash was taken over, and the new declaration beside it.
		const adopted = await rows(client, `SELECT source, material, entry FROM pipeline_definition_declarations WHERE definition_id = 'core:inlet/user-message' AND content_hash = $1`, [pre!.content_hash])
		expect(adopted.length).toBe(1)
		expect(adopted[0]!.source).toBe("adopted")
		expect(adopted[0]!.material.kind).toBe("input")
		const { definitionContentHash } = await import("$lib/server/pipelines/boot/registrySync")
		expect(definitionContentHash(adopted[0]!.entry as any)).toBe(pre!.content_hash)
		const { snapshotRegistry, getDefinition } = await import("@serene-pub/sdk")
		const [current] = await rows(client, `SELECT content_hash FROM pipeline_definition_registry WHERE definition_id = 'core:inlet/user-message'`)
		expect(current!.content_hash).not.toBe(pre!.content_hash)
		const [fresh] = snapshotRegistry([getDefinition("core:inlet/user-message@1")!], { release: "test" })
		expect(definitionContentHash(fresh!)).toBe(current!.content_hash)

		// The prompt and template pools: the `seed_key` rewrite (§2) exists so
		// the boot finds every shipped prompt under its new key rather than
		// inserting a twin into a pool that already holds the name.
		expect(await poolCounts()).toEqual(poolsBefore)

		const second = await bootstrapPipelines(db)
		expect(second.specs.every((s) => s.action === "present")).toBe(true)
		expect(second.types.republished).toEqual([])
		expect(second.types.inserted).toBe(0)
		expect(await poolCounts()).toEqual(poolsBefore)
	}, 120_000)

	it("a folded session override resolves for the session through world.ts — at the owner, for every lane (W3)", async () => {
		// After the boot above, the session exists only as an id on the override
		// rows; `buildWorld` reads the session row, so one is made under that id.
		await client.query(`INSERT INTO sessions (id, user_id, is_group) VALUES ($1, 2, false)`, [OVERRIDE_SESSION])
		const { buildWorld } = await import("$lib/server/pipelines/config/world")
		const { resolveConfigSources } = await import("@serene-pub/sdk")
		const { RESPOND_SPEC_ID } = await import("$lib/server/pipelines/specs")
		const world = await buildWorld(db, { sessionId: OVERRIDE_SESSION, specId: RESPOND_SPEC_ID })
		const sourced: any = resolveConfigSources(world as any, ["gather.worldLore.read", "gather.historyEntries.read"])
		// The moved row wins at the owner, at session scope, for that session.
		expect(sourced["gather.worldLore.read"].params.titleWeight).toMatchObject({ value: 3, scopeKind: "session", scopeId: OVERRIDE_SESSION })
		// The owner's own row survived the collision.
		expect(sourced["gather.worldLore.read"].params.scanDepth).toMatchObject({ value: 4, scopeKind: "session" })
		// No SHARED knob resolves at the loser's address any more: the node
		// reads the owner's slot through `ofNode` at run time, and `world.ts`
		// pushes no row for one there. The loser's OWN fields — its band
		// intent, `share` / `maxEntries` / `priority` (R-7 P5, U3b) — do
		// resolve at its own address, at `author`, and that is the other half
		// of the same line rather than a leak.
		const SHARED = ["scanDepth", "guaranteedMessages", "maxRecursionDepth", "admitThreshold", "lexicalScoring", "trigramFolding", "titleWeight"]
		expect(sourced["gather.historyEntries.read"].params?.titleWeight?.scopeKind ?? "author").toBe("author")
		expect(world.overrides.some((o: any) => o.nodeKey === "gather.historyEntries.read" && o.slot === "params" && SHARED.includes(o.path))).toBe(false)
		expect(sourced["gather.historyEntries.read"].params?.share).toMatchObject({ value: 0.1666, scopeKind: "author" })
		// …and the share 0135 moved off the ranker for this session resolves at
		// the lane, at session scope (U3b W4).
		const characterLore: any = resolveConfigSources(world as any, ["gather.characterLore.read"])
		expect(characterLore["gather.characterLore.read"].params.share).toMatchObject({ value: 0.2, scopeKind: "session", scopeId: OVERRIDE_SESSION })
	}, 60_000)
})
