/**
 * 🚧 The `seat-keys` gate, attic upgrade → boot passes (plan §34.5, S4): a
 * 0.5.3 install upgraded through the attic, then the boot passes in startup
 * order (`own-books`, `seat-members`, `character-versions`), then `seat-keys`.
 * No row of the five owner tables is card form except what the report counts
 * in `left`, nothing fails, and a second run changes nothing.
 *
 * Its own file: the fixture harness owns the database module (one fixture per
 * file). Does not import `$lib/server/startup` (it starts `appReady` at module
 * scope).
 */
import { beforeAll, describe, expect, test, vi } from "vitest"
import { sql } from "drizzle-orm"
import { rawRows } from "$lib/server/db/rawRows"
import { SEAT_KEY_STORES, seatKeys } from "./seatKeys"
import {
	bootFixture,
	placeFixture,
	runUpgradeTasks
} from "$lib/server/attic/testFixture"

vi.setConfig({ testTimeout: 120_000, hookTimeout: 300_000 })

let db: Db

const TOUCHED = [
	"attribute_values",
	"attribute_configs",
	"zone_contents",
	"owner_sheets",
	"attribute_carries",
	"state_proposals",
	"sessions",
	"widget_settings",
	"session_messages",
	"message_parts",
	"session_imprints"
]
async function snapshot() {
	const out: Record<string, string[]> = {}
	for (const t of TOUCHED) {
		const rs = await db.execute(
			sql.raw(`select to_jsonb(t)::text as j from ${t} t order by id`)
		)
		out[t] = rawRows<{ j: string }>(rs).map((r) => r.j)
	}
	return out
}
const count = async (q: string) =>
	Number(rawRows<{ n: number }>(await db.execute(sql.raw(q)))[0]!.n)

const REKEYED_ZERO = Object.fromEntries(SEAT_KEY_STORES.map((s) => [s, 0]))
const ZEROS = {
	sessions: 0,
	rekeyed: REKEYED_ZERO,
	copied: 0,
	dropped: 0,
	left: 0,
	failed: 0
}

let upgraded: Awaited<ReturnType<typeof runUpgradeTasks>>
const passes: Record<string, unknown> = {}

beforeAll(async () => {
	placeFixture("tiny")
	db = await bootFixture()
	upgraded = await runUpgradeTasks(db)
	// The boot passes, in `startupTasks` order.
	const { ensureOwnBooks } = await import("$lib/server/lorebooks/ownBook")
	passes.ownBooks = await ensureOwnBooks(db)
	const { seatMembers } = await import("$lib/server/sessions/seatMembers")
	passes.seatMembers = await seatMembers(db)
	const { liftCharacterVersions } = await import(
		"$lib/server/characters/versionsLift"
	)
	passes.versions = await liftCharacterVersions(db)
}, 300_000)

describe("attic upgrade, then the pass", () => {
	test("no card-form owner row but what `left` counts; nothing failed; a second run changes nothing", async () => {
		expect(upgraded).toBeTruthy()
		const before = await snapshot()
		const report = await seatKeys(db)
		console.log("seat-keys over the tiny fixture:", JSON.stringify(report))
		console.log("boot passes before it:", JSON.stringify(passes))
		expect(report.failed).toBe(0)
		let cardForm = 0
		for (const t of [
			"attribute_values",
			"attribute_configs",
			"zone_contents",
			"owner_sheets",
			"attribute_carries"
		])
			cardForm += await count(
				`select count(*)::int as n from ${t} where owner_kind = 'session_cast'`
			)
		// Each left item is one card-form item; a left row is at most one row.
		expect(cardForm).toBeLessThanOrEqual(report.left)

		const after = await snapshot()
		const second = await seatKeys(db)
		expect(second.failed).toBe(0)
		expect({ ...second, left: 0 }).toEqual(ZEROS)
		expect(second.left).toBe(report.left)
		expect(await snapshot()).toEqual(after)
		// The passes before it left the owner tables for it: its own writes are all it adds.
		expect(Object.keys(before)).toEqual(Object.keys(after))
	}, 120_000)

	test("state written in card form on the upgraded session's seats is rekeyed to the members the passes gave them", async () => {
		const seats = rawRows<{
			session_id: number
			character_id: number
			cast_member_id: number
		}>(
			await db.execute(
				sql`select session_id, character_id, cast_member_id from session_characters where character_id is not null and cast_member_id is not null order by id limit 1`
			)
		)
		expect(seats).toHaveLength(1)
		const {
			session_id: sid,
			character_id: card,
			cast_member_id: m
		} = seats[0]!
		await db.execute(
			sql`insert into attribute_values (session_id, owner_kind, owner_id, slot_id, value, updated_by, state_version) values (${sid}, 'session_cast', ${card}, 'core:slot/hp@1', '{"v":1}'::jsonb, 'user:1', 1)`
		)
		await db.execute(
			sql`insert into state_proposals (session_id, kind, payload) values (${sid}, 'value', ${JSON.stringify({ owner: { kind: "session_cast", id: card }, slotId: "core:slot/hp@1", value: 2 })}::jsonb)`
		)
		await db.execute(
			sql`update sessions set annex_audiences = ${JSON.stringify({ core: { goals: [`character:${card}`] } })}::jsonb where id = ${sid}`
		)
		const first = await seatKeys(db)
		expect(first.failed).toBe(0)
		expect(first.sessions).toBe(1)
		expect(first.rekeyed).toMatchObject({
			attribute_values: 1,
			state_proposals: 1,
			annex_audiences: 1
		})
		expect(
			rawRows(
				await db.execute(
					sql`select owner_kind, owner_id from attribute_values where session_id = ${sid}`
				)
			)
		).toEqual([{ owner_kind: "seated_member", owner_id: m }])
		const after = await snapshot()
		expect(await seatKeys(db)).toEqual({ ...ZEROS, left: first.left })
		expect(await snapshot()).toEqual(after)
	}, 120_000)
})
