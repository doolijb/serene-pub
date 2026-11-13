/**
 * 0155 (ST3): "Old `rewind_taken` survives the upgrade." A turn that Back took
 * BEFORE the upgrade holds an old-shape record (`annexDeltas`, `seatBenches`,
 * `conversions` inside `state`); Forward AFTER the upgrade turns it into
 * session imprint rows and restores them: the seat is benched again, the
 * ruleset version converted again, the annex key back, the rows filed. A second
 * boot changes nothing.
 */
import { afterAll, describe, expect, it, vi } from "vitest"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { migrate } from "drizzle-orm/pglite/migrator"
import { sql } from "drizzle-orm"
import path from "node:path"
import { rawRows } from "../rawRows"
import * as schema from "../schema"
import { runMigrationsWithUpgrades } from "./index"
import { migrationsFolderThrough } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

const disposers: Array<() => Promise<void>> = []
afterAll(async () => {
	for (const d of disposers) await d()
})

describe("0155: Back before the upgrade, Forward after", () => {
	it("restores the bench, the conversion and the annex write from an old-shape record, files the rows, and a second boot changes nothing", async () => {
		const { folder, dispose } = await migrationsFolderThrough(
			"0154_red_the_watchers"
		)
		disposers.push(dispose)
		const client = new PGlite()
		try {
			const db = drizzle(client, { schema })
			const q = async (s: string) =>
				rawRows<any>(await db.execute(sql.raw(s)))
			await migrate(db, { migrationsFolder: folder })

			// ── a 0154 install with one rewound turn ─────────────────────
			const [{ id: userId }] = await q(
				`SELECT id FROM users ORDER BY id LIMIT 1`
			)
			const [{ id: cardId }] = await q(
				`INSERT INTO characters (user_id, name, description) VALUES (${userId}, 'Mara', 'A miller.') RETURNING id`
			)
			// The session as Back left it: the annex key at its old value, the version unconverted.
			const [{ id: sessionId }] = await q(
				`INSERT INTO sessions (user_id, is_group, name, primary_ruleset, ruleset_version, annex)
				 VALUES (${userId}, false, 'Rewound', 'acme:ruleset/r1@1', '1', '{"acme":{"plan":1}}'::jsonb) RETURNING id`
			)
			const [{ id: seatId }] = await q(
				`INSERT INTO session_characters (session_id, character_id, is_active) VALUES (${sessionId}, ${cardId}, true) RETURNING id`
			)
			const message = async (role: string) => {
				const id = (
					await q(
						`INSERT INTO session_messages (session_id, role, content) VALUES (${sessionId}, '${role}', 'x') RETURNING id`
					)
				)[0].id as number
				await q(
					`INSERT INTO messages (id, session_id, role) VALUES (${id}, ${sessionId}, '${role}')`
				)
				return id
			}
			const person = await message("user")
			const reply = await message("assistant")
			// The old-shape record, as `rewindTurn` wrote it before ST3.
			const side = (document: unknown) => ({ document, audiences: null })
			const record = {
				v: 1,
				wasHidden: false,
				state: {
					messageId: reply,
					values: [],
					configs: [],
					proposals: [],
					clockSessions: [],
					scenes: [],
					annexDeltas: [
						{
							row: {
								owner: "acme",
								messageId: reply,
								runId: "run-1",
								ownerVersion: "1.0.0",
								before: side({ plan: 1 }),
								after: side({ plan: 2, extra: 1 }),
								createdAt: "2026-11-01T10:00:00.000Z"
							},
							reverted: true
						}
					],
					seatBenches: [
						{
							messageId: reply,
							kind: "character",
							seatId,
							from: false,
							to: true
						}
					],
					conversions: [
						{
							messageId: reply,
							rulesetId: "acme:ruleset/r1@1",
							from: "1",
							to: "2"
						}
					]
				},
				turn: {
					tally: null,
					elsewhere: {
						values: [],
						configs: [],
						proposals: [],
						imprints: []
					}
				}
			}
			for (const id of [person, reply])
				await q(
					`UPDATE session_messages SET is_hidden = true, rewind_ordinal = 1, rewind_taken = '${JSON.stringify(
						id === person
							? { v: 1, wasHidden: false, state: null }
							: record
					)}'::json WHERE id = ${id}`
				)
			await q(
				`UPDATE messages SET is_hidden = true, rewind_ordinal = 1 WHERE session_id = ${sessionId}`
			)

			// ── upgrade ──────────────────────────────────────────────────
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
			const upgradeLog = logged.filter((l) =>
				l.includes("[upgrade 0155]")
			)
			// no runtime key to move, no annex delta, no settled row: the upgrade logs nothing and leaves the record alone
			expect(upgradeLog).toEqual([])
			// nothing was filed by the upgrade: the record has not been read yet
			expect(await q(`SELECT id FROM session_imprints`)).toEqual([])

			// ── Forward, after ───────────────────────────────────────────
			const { forwardTurn } = await import("$lib/server/sessions/rewind")
			const out = await forwardTurn(db as never, { sessionId, userId })
			expect(out, JSON.stringify(out)).toMatchObject({ ok: true })

			const [seat] = await q(
				`SELECT is_active FROM session_characters WHERE id = ${seatId}`
			)
			expect(seat.is_active).toBe(false) // benched again
			const [session] = await q(
				`SELECT ruleset_version, annex FROM sessions WHERE id = ${sessionId}`
			)
			expect(session.ruleset_version).toBe("2") // converted again
			expect(session.annex).toEqual({ acme: { plan: 2, extra: 1 } }) // the annex key back

			const rows = await q(
				`SELECT subject_kind, subject_key, message_id, "before", "after", status, run_id
				 FROM session_imprints WHERE session_id = ${sessionId} ORDER BY subject_kind, subject_key`
			)
			expect(
				rows.map((r: any) => [
					r.subject_kind,
					r.subject_key,
					r.message_id,
					r.status
				])
			).toEqual([
				["annex", "acme/extra", reply, "standing"],
				["annex", "acme/plan", reply, "standing"],
				["ruleset-conversion", "acme:ruleset/r1@1", reply, "standing"],
				["seat-bench", `character:${seatId}`, reply, "standing"]
			])
			const rowOf = (key: string) =>
				rows.find((r: any) => r.subject_key === key)
			expect(rowOf("acme/plan")).toMatchObject({
				before: { v: 1 },
				after: { v: 2 },
				run_id: "run-1"
			})
			expect(rowOf("acme/extra")).toMatchObject({
				before: null,
				after: { v: 1 }
			})
			expect(rowOf("acme:ruleset/r1@1")).toMatchObject({
				before: { v: "1" },
				after: { v: "2" }
			})
			expect(rowOf(`character:${seatId}`)).toMatchObject({
				before: { v: false },
				after: { v: true }
			})
			// the turn is back in the history
			expect(
				await q(
					`SELECT rewind_ordinal, rewind_taken, is_hidden FROM session_messages WHERE session_id = ${sessionId}`
				)
			).toEqual([
				{ rewind_ordinal: null, rewind_taken: null, is_hidden: false },
				{ rewind_ordinal: null, rewind_taken: null, is_hidden: false }
			])

			// ── a second boot changes nothing ────────────────────────────
			const dump = async () => ({
				sessions: await q(`SELECT * FROM sessions ORDER BY id`),
				imprints: await q(`SELECT * FROM session_imprints ORDER BY id`),
				messages: await q(`SELECT * FROM session_messages ORDER BY id`),
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
