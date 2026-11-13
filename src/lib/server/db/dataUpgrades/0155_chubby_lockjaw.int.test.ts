/**
 * 0155 (ST3): core's runtime keys leave `annex.core` for columns, seat
 * benches and conversions become session imprints, the saved annex deltas
 * become per-key imprints, `annex_deltas` goes; and a second boot changes
 * nothing. On a database built at 0154, then the real folder.
 */
import { afterAll, describe, expect, it, vi } from "vitest"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { migrate } from "drizzle-orm/pglite/migrator"
import { sql } from "drizzle-orm"
import path from "node:path"
import { rawRows } from "../rawRows"
import { runMigrationsWithUpgrades } from "./index"
import { annexDeltaKeys } from "./0155_chubby_lockjaw"
import { migrationsFolderThrough } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

const disposers: Array<() => Promise<void>> = []
afterAll(async () => {
	for (const d of disposers) await d()
})

describe("annexDeltaKeys (pure)", () => {
	it("one entry per key whose value or audience differs; skips the legacy owner and core's runtime keys", () => {
		const before = {
			document: { a: 1, same: 0, turnOrder: 1 },
			audiences: { same: ["x"] }
		}
		const after = {
			document: { a: 2, same: 0, turnOrder: 2, b: 1 },
			audiences: { same: ["x", "y"] }
		}
		expect(annexDeltaKeys("acme", before, after).map((k) => k.key)).toEqual(
			["a", "b", "same", "turnOrder"]
		)
		expect(annexDeltaKeys("core", before, after).map((k) => k.key)).toEqual(
			["a", "b", "same"]
		)
		expect(annexDeltaKeys("core:revision-points", before, after)).toEqual(
			[]
		)
		expect(
			annexDeltaKeys(
				"acme",
				{ document: null, audiences: null },
				{ document: null, audiences: null }
			)
		).toEqual([])
	})
})

describe("0155", () => {
	it("moves the runtime keys, files the imprints, drops annex_deltas, and a second boot changes nothing", async () => {
		const { folder, dispose } = await migrationsFolderThrough(
			"0154_red_the_watchers"
		)
		disposers.push(dispose)
		const client = new PGlite()
		try {
			const db = drizzle(client)
			const q = async (s: string) =>
				rawRows<any>(await db.execute(sql.raw(s)))
			await migrate(db, { migrationsFolder: folder })

			// ── a 0154-shaped install ────────────────────────────────────
			// the chain seeds a user of its own; borrow it
			const [{ id: userId }] = await q(
				`SELECT id FROM users ORDER BY id LIMIT 1`
			)
			const insertSession = async (
				name: string,
				extra = "",
				annex: unknown = {}
			) =>
				(
					await q(
						`INSERT INTO sessions (user_id, is_group, name, annex${extra ? ", " + extra.split("=")[0] : ""})
						 VALUES (${userId}, false, '${name}', '${JSON.stringify(annex).replace(/'/g, "''")}'::jsonb${extra ? ", " + extra.split("=")[1] : ""}) RETURNING id`
					)
				)[0].id as number
			// a message is a legacy row and its projection, one id (what `annex_deltas` references)
			const message = async (sessionId: number) => {
				const id = (
					await q(
						`INSERT INTO session_messages (session_id, role, content) VALUES (${sessionId}, 'user', 'x') RETURNING id`
					)
				)[0].id as number
				await q(
					`INSERT INTO messages (id, session_id, role) VALUES (${id}, ${sessionId}, 'user')`
				)
				return id
			}

			const aMsgs: number[] = []
			// Session A first so its messages are created before its annex needs their ids.
			const a = await insertSession("A")
			for (let i = 0; i < 4; i++) aMsgs.push(await message(a))
			const [m1, m2, m3, m4] = aMsgs
			const core = {
				turnOrder: { order: ["x"], runId: null },
				turnTally: { x: 2 },
				laneReads: { lane: 5 },
				rulesetDecks: { d: { cards: [2, 3] } },
				rulesetConversions: [
					{ messageId: m3, rulesetId: "r1", from: "1", to: "2" },
					{ messageId: 999999, rulesetId: "r1", from: "2", to: "3" },
					{ messageId: "bad" }
				],
				seatBenches: [
					{
						messageId: m1,
						kind: "character",
						seatId: 11,
						from: false,
						to: true
					},
					{
						messageId: m4,
						kind: "player",
						seatId: 12,
						from: true,
						to: false
					}
				],
				"retake-quietly": true
			}
			await q(
				`UPDATE sessions SET settled_message_id = ${m2},
				 annex = '${JSON.stringify({ core, acme: { plan: 3, note: "n" } })}'::jsonb WHERE id = ${a}`
			)
			// a branch with its own document: only a turn order, nothing else in core
			const b = await insertSession("B", `branch_of_session_id=${a}`, {
				core: { turnOrder: { order: ["y"], runId: "r" } }
			})
			// a session with no runtime keys, a core document it keeps
			const c = await insertSession("C", "", {
				core: { "retake-quietly": false }
			})
			// a session whose core document holds one runtime key and nothing else: the document goes
			const d = await insertSession("D", "", {
				core: { turnTally: { x: 1 } }
			})

			const delta = async (
				sessionId: number,
				messageId: number,
				owner: string,
				beforeSide: unknown,
				afterSide: unknown,
				runId: string | null
			) =>
				q(
					`INSERT INTO annex_deltas (session_id, message_id, owner, owner_version, "before", "after", run_id)
					 VALUES (${sessionId}, ${messageId}, '${owner}', ${owner === "acme" ? "'1.0.0'" : "NULL"},
					 '${JSON.stringify(beforeSide)}'::jsonb, '${JSON.stringify(afterSide)}'::jsonb, ${runId ? `'${runId}'` : "NULL"})`
				)
			// a core row whose snapshots include runtime keys: only the declared key counts
			await delta(
				a,
				m1,
				"core",
				{
					document: {
						turnOrder: { order: [] },
						"retake-quietly": false
					},
					audiences: null
				},
				{
					document: {
						turnOrder: { order: ["x"] },
						"retake-quietly": true
					},
					audiences: null
				},
				null
			)
			// two writes of one plugin key
			await delta(
				a,
				m3,
				"acme",
				{ document: { plan: 1 }, audiences: null },
				{ document: { plan: 2 }, audiences: null },
				"run-3"
			)
			await delta(
				a,
				m4,
				"acme",
				{ document: { plan: 2 }, audiences: null },
				{ document: { plan: 3 }, audiences: null },
				"run-4"
			)
			// an audience change with the value unchanged, and a key that appears
			await delta(
				a,
				m4,
				"acme",
				{ document: { note: "n" }, audiences: null },
				{
					document: { note: "n", extra: 1 },
					audiences: { note: ["me"] }
				},
				"run-4"
			)
			await delta(
				a,
				m4,
				"core:revision-points",
				{ document: { a: 1 }, audiences: null },
				{ document: { a: 2 }, audiences: null },
				null
			)

			// ── the real folder ──────────────────────────────────────────
			const real = path.resolve(process.cwd(), "drizzle")
			const logged: string[] = []
			const spy = vi
				.spyOn(console, "log")
				.mockImplementation(
					(...args) => void logged.push(args.join(" "))
				)
			const first = await runMigrationsWithUpgrades(db as never, {
				migrationsFolder: real
			})
			spy.mockRestore()
			expect(first.upgradesRun).toContain("0155_chubby_lockjaw")
			expect(logged.filter((l) => l.includes("[upgrade 0155]"))).toEqual([
				"[upgrade 0155] moved the runtime keys of 3 session(s) (6 column value(s)); filed 2 seat-bench, 1 ruleset-conversion and 5 annex session imprint(s)"
			])

			// columns
			const sessions = await q(
				`SELECT id, annex, turn_order, turn_tally, lane_reads, ruleset_decks FROM sessions ORDER BY id`
			)
			const by = (id: number) => sessions.find((s: any) => s.id === id)
			expect(by(a)).toMatchObject({
				turn_order: core.turnOrder,
				turn_tally: core.turnTally,
				lane_reads: core.laneReads,
				ruleset_decks: core.rulesetDecks,
				annex: {
					core: { "retake-quietly": true },
					acme: { plan: 3, note: "n" }
				}
			})
			expect(by(b)).toMatchObject({
				turn_order: { order: ["y"], runId: "r" },
				turn_tally: null,
				annex: {}
			})
			expect(by(c)).toMatchObject({
				turn_order: null,
				annex: { core: { "retake-quietly": false } }
			})
			expect(by(d)).toMatchObject({ turn_tally: { x: 1 }, annex: {} })

			// rows
			const rows = await q(
				`SELECT id, session_id, message_id, run_id, subject_kind, subject_key, "before", "after", owner_version,
				 audience_before, audience_after, status FROM session_imprints ORDER BY id`
			)
			const shape = rows.map((r: any) => [
				r.subject_kind,
				r.subject_key,
				r.message_id,
				r.status
			])
			expect(shape).toEqual([
				["ruleset-conversion", "r1", m3, "standing"],
				["seat-bench", "character:11", m1, "settled"],
				["seat-bench", "player:12", m4, "standing"],
				["annex", "core/retake-quietly", m1, "settled"],
				["annex", "acme/plan", m3, "standing"],
				["annex", "acme/plan", m4, "standing"],
				["annex", "acme/extra", m4, "standing"],
				["annex", "acme/note", m4, "standing"]
			])
			expect(rows[0]).toMatchObject({
				before: { v: "1" },
				after: { v: "2" }
			})
			expect(rows[1]).toMatchObject({ before: null, after: { v: true } }) // settled: before gone
			expect(rows[2]).toMatchObject({
				before: { v: true },
				after: { v: false }
			})
			expect(rows[3]).toMatchObject({
				before: null,
				after: { v: true },
				owner_version: null
			})
			expect(rows[4]).toMatchObject({
				before: { v: 1 },
				after: { v: 2 },
				owner_version: "1.0.0",
				run_id: "run-3"
			})
			expect(rows[5]).toMatchObject({
				before: { v: 2 },
				after: { v: 3 },
				run_id: "run-4"
			})
			expect(rows[6]).toMatchObject({
				before: null,
				after: { v: 1 },
				audience_before: null,
				audience_after: null
			})
			expect(rows[7]).toMatchObject({
				before: { v: "n" },
				after: { v: "n" },
				audience_before: null,
				audience_after: ["me"]
			})
			// the core `retake-quietly` row sits at message m1, at or below the settle line m2
			expect(rows.every((r: any) => [a].includes(r.session_id))).toBe(
				true
			)

			// annex_deltas gone
			expect(
				await q(`SELECT to_regclass('public.annex_deltas')::text AS t`)
			).toEqual([{ t: null }])

			// ── a second boot changes nothing ────────────────────────────
			const dump = async () => ({
				sessions: await q(`SELECT * FROM sessions ORDER BY id`),
				imprints: await q(`SELECT * FROM session_imprints ORDER BY id`),
				ledger: await q(
					`SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id`
				)
			})
			const before1 = await dump()
			const second = await runMigrationsWithUpgrades(db as never, {
				migrationsFolder: real
			})
			expect(second.upgradesRun).toEqual([])
			expect(second.applied).toEqual([])
			expect(await dump()).toEqual(before1)
		} finally {
			await client.close()
		}
	})
})
